import { injectable } from "tsyringe";
import type { ILogger } from "../interfaces/ILogger";
import { PropertyFieldType, rangeToFieldType } from "../domain/types/PropertyFieldType";
import { extractPropertyLabel } from "../domain/types/PropertyDefinition";

export interface PropertySchema {
  type: PropertyFieldType;
  label: string;
  readOnly?: boolean;
  options?: PropertySchemaOption[];
  validation?: PropertySchemaValidation;
}

export interface PropertySchemaOption {
  value: string;
  label: string;
}

export interface PropertySchemaValidation {
  required?: boolean;
  minValue?: number;
  maxValue?: number;
  maxLength?: number;
  pattern?: string;
}

export interface PropertySchemaBinding {
  type?: string;
  label?: string;
  rangeType?: string;
  description?: string;
  required?: string;
  readOnly?: string;
  minValue?: string;
  maxValue?: string;
  maxLength?: string;
  pattern?: string;
  optionValue?: string;
  optionLabel?: string;
}

export interface ISPARQLQueryable {
  query(sparql: string): Promise<Map<string, unknown>[]>;
}

@injectable()
export class PropertySchemaResolver {
  private cache = new Map<string, PropertySchema>();
  private allSchemasLoaded = false;

  constructor(
    private readonly sparqlService: ISPARQLQueryable,
    private readonly logger?: ILogger,
  ) {}

  async getSchema(propertyIRI: string): Promise<PropertySchema | null> {
    const normalizedIRI = this.normalizeIRI(propertyIRI);

    const cached = this.cache.get(normalizedIRI);
    if (cached) {
      return cached;
    }

    try {
      const schema = await this.loadSchemaFromStore(normalizedIRI);
      if (schema) {
        this.cache.set(normalizedIRI, schema);
      }
      return schema;
    } catch (error) {
      this.logger?.warn(`Failed to load schema for ${propertyIRI}`, { error: String(error) });
      return null;
    }
  }

  async getAllSchemas(): Promise<Map<string, PropertySchema>> {
    if (this.allSchemasLoaded) {
      return new Map(this.cache);
    }

    try {
      const schemas = await this.loadAllSchemasFromStore();
      for (const [iri, schema] of schemas) {
        this.cache.set(iri, schema);
      }
      this.allSchemasLoaded = true;
      return new Map(this.cache);
    } catch (error) {
      this.logger?.warn("Failed to load all schemas", { error: String(error) });
      return new Map(this.cache);
    }
  }

  invalidateCache(): void {
    this.cache.clear();
    this.allSchemasLoaded = false;
  }

  private async loadSchemaFromStore(propertyIRI: string): Promise<PropertySchema | null> {
    const fullIRI = this.toFullIRI(propertyIRI);

    const query = `
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      PREFIX owl: <http://www.w3.org/2002/07/owl#>
      PREFIX exo: <https://exocortex.my/ontology/exo#>
      PREFIX ems: <https://exocortex.my/ontology/ems#>

      SELECT ?type ?label ?rangeType ?description ?required ?readOnly ?minValue ?maxValue ?maxLength ?pattern ?optionValue ?optionLabel WHERE {
        <${fullIRI}> rdfs:range ?rangeType .
        OPTIONAL { <${fullIRI}> rdfs:label ?label . }
        OPTIONAL { <${fullIRI}> rdfs:comment ?description . }
        OPTIONAL { <${fullIRI}> exo:schema_required ?required . }
        OPTIONAL { <${fullIRI}> exo:schema_readOnly ?readOnly . }
        OPTIONAL { <${fullIRI}> exo:schema_minValue ?minValue . }
        OPTIONAL { <${fullIRI}> exo:schema_maxValue ?maxValue . }
        OPTIONAL { <${fullIRI}> exo:schema_maxLength ?maxLength . }
        OPTIONAL { <${fullIRI}> exo:schema_pattern ?pattern . }
        OPTIONAL {
          ?rangeType owl:oneOf ?list .
          ?list rdfs:member ?optionValue .
          OPTIONAL { ?optionValue rdfs:label ?optionLabel . }
        }
      }
    `;

    const results = await this.sparqlService.query(query);
    if (results.length === 0) {
      return null;
    }

    return this.buildSchemaFromBindings(propertyIRI, results);
  }

  private async loadAllSchemasFromStore(): Promise<Map<string, PropertySchema>> {
    const query = `
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      PREFIX owl: <http://www.w3.org/2002/07/owl#>
      PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
      PREFIX exo: <https://exocortex.my/ontology/exo#>
      PREFIX ems: <https://exocortex.my/ontology/ems#>

      SELECT ?property ?rangeType ?label ?description ?required ?readOnly ?minValue ?maxValue ?maxLength ?pattern ?optionValue ?optionLabel WHERE {
        ?property rdf:type owl:DatatypeProperty .
        OPTIONAL { ?property rdfs:range ?rangeType . }
        OPTIONAL { ?property rdfs:label ?label . }
        OPTIONAL { ?property rdfs:comment ?description . }
        OPTIONAL { ?property exo:schema_required ?required . }
        OPTIONAL { ?property exo:schema_readOnly ?readOnly . }
        OPTIONAL { ?property exo:schema_minValue ?minValue . }
        OPTIONAL { ?property exo:schema_maxValue ?maxValue . }
        OPTIONAL { ?property exo:schema_maxLength ?maxLength . }
        OPTIONAL { ?property exo:schema_pattern ?pattern . }
        OPTIONAL {
          ?rangeType owl:oneOf ?list .
          ?list rdfs:member ?optionValue .
          OPTIONAL { ?optionValue rdfs:label ?optionLabel . }
        }
      }
    `;

    const results = await this.sparqlService.query(query);
    const grouped = new Map<string, Map<string, unknown>[]>();

    for (const binding of results) {
      const propertyUri = binding.get("property");
      if (!propertyUri) continue;

      const iri = this.fromFullIRI(String(propertyUri));
      const existing = grouped.get(iri);
      if (existing) {
        existing.push(binding);
      } else {
        grouped.set(iri, [binding]);
      }
    }

    const schemas = new Map<string, PropertySchema>();
    for (const [iri, bindings] of grouped) {
      const schema = this.buildSchemaFromBindings(iri, bindings);
      if (schema) {
        schemas.set(iri, schema);
      }
    }

    return schemas;
  }

  private buildSchemaFromBindings(
    propertyIRI: string,
    bindings: Map<string, unknown>[],
  ): PropertySchema | null {
    if (bindings.length === 0) return null;

    const first = bindings[0];
    const rangeType = this.getBindingValue(first, "rangeType");
    const label = this.getBindingValue(first, "label") || extractPropertyLabel(propertyIRI);
    const fieldType = rangeType ? rangeToFieldType(rangeType) : PropertyFieldType.Text;

    const readOnly = this.getBindingValue(first, "readOnly");
    const options = this.extractOptions(bindings);

    const validation = this.extractValidation(first);

    const schema: PropertySchema = {
      type: fieldType,
      label,
    };

    if (readOnly === "true") {
      schema.readOnly = true;
    }

    if (options.length > 0) {
      schema.options = options;
    }

    if (validation) {
      schema.validation = validation;
    }

    return schema;
  }

  private extractOptions(bindings: Map<string, unknown>[]): PropertySchemaOption[] {
    const options: PropertySchemaOption[] = [];
    const seen = new Set<string>();

    for (const binding of bindings) {
      const optionValue = this.getBindingValue(binding, "optionValue");
      if (optionValue && !seen.has(optionValue)) {
        seen.add(optionValue);
        const optionLabel = this.getBindingValue(binding, "optionLabel") || optionValue;
        options.push({ value: optionValue, label: optionLabel });
      }
    }

    return options;
  }

  private extractValidation(binding: Map<string, unknown>): PropertySchemaValidation | undefined {
    const required = this.getBindingValue(binding, "required");
    const minValue = this.getBindingValue(binding, "minValue");
    const maxValue = this.getBindingValue(binding, "maxValue");
    const maxLength = this.getBindingValue(binding, "maxLength");
    const pattern = this.getBindingValue(binding, "pattern");

    const hasValidation = required || minValue || maxValue || maxLength || pattern;
    if (!hasValidation) return undefined;

    const validation: PropertySchemaValidation = {};

    if (required === "true") {
      validation.required = true;
    }
    if (minValue !== undefined) {
      const num = Number(minValue);
      if (!isNaN(num)) validation.minValue = num;
    }
    if (maxValue !== undefined) {
      const num = Number(maxValue);
      if (!isNaN(num)) validation.maxValue = num;
    }
    if (maxLength !== undefined) {
      const num = Number(maxLength);
      if (!isNaN(num)) validation.maxLength = num;
    }
    if (pattern) {
      validation.pattern = pattern;
    }

    return validation;
  }

  private getBindingValue(binding: Map<string, unknown>, key: string): string | undefined {
    const value = binding.get(key);
    if (value === undefined || value === null) return undefined;
    return String(value);
  }

  private normalizeIRI(iri: string): string {
    if (iri.startsWith("http://") || iri.startsWith("https://")) {
      return this.fromFullIRI(iri);
    }
    return iri;
  }

  private toFullIRI(propertyName: string): string {
    if (propertyName.startsWith("http://") || propertyName.startsWith("https://")) {
      return propertyName;
    }

    const match = propertyName.match(/^([a-z]+)__(.+)$/);
    if (match) {
      const [, prefix, localName] = match;
      switch (prefix) {
        case "ems":
          return `https://exocortex.my/ontology/ems#${localName}`;
        case "exo":
          return `https://exocortex.my/ontology/exo#${localName}`;
        default:
          return `https://exocortex.my/ontology/${prefix}#${localName}`;
      }
    }

    return propertyName;
  }

  private fromFullIRI(iri: string): string {
    const match = iri.match(/https:\/\/exocortex\.my\/ontology\/([a-z]+)#(.+)$/);
    if (match) {
      const [, prefix, localName] = match;
      return `${prefix}__${localName}`;
    }
    return iri;
  }
}
