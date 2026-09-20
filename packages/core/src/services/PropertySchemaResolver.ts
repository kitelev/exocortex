import { injectable } from "tsyringe";
import type { ILogger } from "../interfaces/ILogger";
import { PropertyFieldType, rangeToFieldType } from "../domain/types/PropertyFieldType";
import { extractPropertyLabel } from "../domain/types/PropertyDefinition";
import { Namespace } from "../domain/models/rdf/Namespace";

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

  /**
   * `prefix__LocalName` → full term IRI, derived from
   * {@link Namespace.KNOWN_NAMESPACES} via `Namespace.fromPropertyKey`.
   *
   * ⛔ This used to be a private regex pair — the THIRD independent IRI↔prefix
   * implementation (ticket `6572f3f3`, req `38e3f174`). Its `switch` sent EVERY
   * prefix to `https://exocortex.my/ontology/<prefix>#`, so a registered W3C
   * vocabulary was minted under a namespace that does not exist:
   * `rdfs__subClassOf` → `…/ontology/rdfs#subClassOf` instead of the canonical
   * `http://www.w3.org/2000/01/rdf-schema#subClassOf`. Its `^([a-z]+)__` also
   * refused any prefix carrying a capital or a digit, so `aiKnow__…` / `ns2__…`
   * were handed to SPARQL as bare frontmatter keys.
   *
   * Pass-through is DELIBERATE and load-bearing: an unparseable name is
   * returned as-is (not `null`), because the caller uses the result as a cache
   * key and as the `<…>` term of the schema query.
   */
  private toFullIRI(propertyName: string): string {
    // ⛤ DEFENSIVE by arithmetic, and saying so is the point (no mutant can
    // distinguish it): without this early return a full IRI falls to
    // `fromPropertyKey`, which cannot parse it, and the final pass-through
    // returns the very same string. Measured — removing it reddened nothing.
    // Kept because it states the intent and costs one comparison.
    if (propertyName.startsWith("http://") || propertyName.startsWith("https://")) {
      return propertyName;
    }

    const parsed = Namespace.fromPropertyKey(propertyName);
    if (parsed) {
      return parsed.namespace.term(parsed.localName).value;
    }

    return propertyName;
  }

  /**
   * Full term IRI → `prefix__LocalName`, the exact inverse of {@link toFullIRI},
   * derived from the SAME array via `Namespace.fromTermIRI`.
   *
   * ⛔ The regex it replaces (`/https:\/\/exocortex\.my\/ontology\/([a-z]+)#(.+)$/`)
   * differed from the canon in four measured ways (req `38e3f174`): it knew no
   * W3C vocabulary; it refused a prefix with a capital or a digit; it accepted a
   * local name containing `/` or `#`, which is not a frontmatter key at all; and
   * — having no `^` anchor — it matched a `…/ontology/<ns>#` fragment ANYWHERE
   * in the string, so `https://evil.example/x/https://exocortex.my/ontology/ems#Pwned`
   * yielded `ems__Pwned`. That last one is drift hygiene rather than a
   * vulnerability, and the reason is the enumerated input set, not the noise
   * level: the only two inputs are graph IRIs emitted by our own forward path
   * and the caller-supplied name of {@link getSchema}, whose sole in-repo caller
   * is unreachable (`initPropertySchemaService` has zero production callers).
   */
  private fromFullIRI(iri: string): string {
    const term = Namespace.fromTermIRI(iri);
    if (term) {
      return `${term.namespace.prefix}__${term.localName}`;
    }
    return iri;
  }
}
