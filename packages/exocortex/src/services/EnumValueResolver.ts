import { injectable } from "tsyringe";
import type { ILogger } from "../interfaces/ILogger";
import type { ISPARQLQueryable } from "./PropertySchemaResolver";

export interface EnumValue {
  readonly value: string;
  readonly label: string;
}

@injectable()
export class EnumValueResolver {
  private cache = new Map<string, EnumValue[]>();

  constructor(
    private readonly sparqlService: ISPARQLQueryable,
    private readonly logger?: ILogger,
  ) {}

  async resolve(enumClass: string): Promise<EnumValue[]> {
    const normalizedClass = this.normalizeClassName(enumClass);

    const cached = this.cache.get(normalizedClass);
    if (cached) {
      return cached;
    }

    try {
      const values = await this.queryEnumValues(normalizedClass);
      if (values.length > 0) {
        this.cache.set(normalizedClass, values);
      }
      return values;
    } catch (error) {
      this.logger?.warn(`Failed to resolve enum values for ${enumClass}`, {
        error: String(error),
      });
      return [];
    }
  }

  invalidateCache(enumClass?: string): void {
    if (enumClass) {
      const normalized = this.normalizeClassName(enumClass);
      this.cache.delete(normalized);
    } else {
      this.cache.clear();
    }
  }

  private async queryEnumValues(enumClass: string): Promise<EnumValue[]> {
    const fullClassIRI = this.toFullIRI(enumClass);
    const rankProperty = this.buildRankProperty(enumClass);
    const rankPropertyIRI = rankProperty ? this.toFullIRI(rankProperty) : null;

    const query = rankPropertyIRI
      ? `
      PREFIX exo: <https://exocortex.my/ontology/exo#>
      PREFIX ems: <https://exocortex.my/ontology/ems#>

      SELECT ?instance ?label ?rank WHERE {
        ?instance exo:Instance_class <${fullClassIRI}> .
        ?instance exo:Asset_label ?label .
        OPTIONAL { ?instance <${rankPropertyIRI}> ?rank . }
      }
      ORDER BY ?rank ?instance
    `
      : `
      PREFIX exo: <https://exocortex.my/ontology/exo#>
      PREFIX ems: <https://exocortex.my/ontology/ems#>

      SELECT ?instance ?label WHERE {
        ?instance exo:Instance_class <${fullClassIRI}> .
        ?instance exo:Asset_label ?label .
      }
      ORDER BY ?instance
    `;

    const results = await this.sparqlService.query(query);
    return this.buildEnumValues(results);
  }

  private buildEnumValues(
    bindings: Map<string, unknown>[],
  ): EnumValue[] {
    const values: EnumValue[] = [];
    const seen = new Set<string>();

    for (const binding of bindings) {
      const instanceRaw = this.getBindingValue(binding, "instance");
      if (!instanceRaw || seen.has(instanceRaw)) continue;
      seen.add(instanceRaw);

      const label = this.getBindingValue(binding, "label") ?? instanceRaw;
      const shortName = this.fromFullIRI(instanceRaw);
      const wikilinkValue = `[[${shortName}]]`;

      values.push({
        value: wikilinkValue,
        label,
      });
    }

    return values;
  }

  private buildRankProperty(enumClass: string): string | null {
    const match = enumClass.match(/^([a-z]+)__(.+)$/);
    if (!match) return null;
    const [, prefix, className] = match;
    return `${prefix}__${className}_rank`;
  }

  private normalizeClassName(name: string): string {
    return name.replace(/\[\[|\]\]/g, "").trim();
  }

  private getBindingValue(
    binding: Map<string, unknown>,
    key: string,
  ): string | undefined {
    const value = binding.get(key);
    if (value === undefined || value === null) return undefined;
    return String(value);
  }

  private toFullIRI(propertyName: string): string {
    if (
      propertyName.startsWith("http://") ||
      propertyName.startsWith("https://")
    ) {
      return propertyName;
    }

    const match = propertyName.match(/^([a-z]+)__(.+)$/);
    if (match) {
      const [, prefix, localName] = match;
      return `https://exocortex.my/ontology/${prefix}#${localName}`;
    }

    return propertyName;
  }

  private fromFullIRI(iri: string): string {
    const match = iri.match(
      /https:\/\/exocortex\.my\/ontology\/([a-z]+)#(.+)$/,
    );
    if (match) {
      const [, prefix, localName] = match;
      return `${prefix}__${localName}`;
    }
    return iri;
  }
}
