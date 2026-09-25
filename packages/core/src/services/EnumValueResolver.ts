import { injectable } from "tsyringe";
import type { ILogger } from "../interfaces/ILogger";
import { Namespace } from "../domain/models/rdf/Namespace";
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

  /**
   * `<prefix>__<Class>` → `<prefix>__<Class>_rank`, the optional ordering
   * property the enum query reads.
   *
   * ⛔ Issue #4353: the `^([a-z]+)__(.+)$` copy this replaces refused a prefix
   * carrying a capital, a digit or a hyphen, so for `aiKnow__…`, `exo003__…` and
   * `adapter-exo-ims__…` it returned null — the query lost its `OPTIONAL { … _rank }`
   * clause entirely and the values came back ordered by instance IRI instead of
   * by the author's declared rank. Silent: the list rendered, just in the wrong
   * order. Now derived from the shared grammar.
   */
  private buildRankProperty(enumClass: string): string | null {
    const parsed = Namespace.fromPropertyKey(enumClass);
    if (!parsed) return null;
    return `${parsed.namespace.prefix}__${parsed.localName}_rank`;
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

  /**
   * `prefix__LocalName` → full term IRI, from the shared grammar
   * (`Namespace.fromPropertyKey` → `Namespace.forPrefix`).
   *
   * ⛔ Issue #4353: the `^([a-z]+)__(.+)$` copy this replaces refused a prefix
   * with a capital, a digit or a hyphen, so `aiKnow__MemoryKind` reached SPARQL
   * as a bare key inside `<…>`, matched nothing, and the enum rendered EMPTY —
   * a dropdown with no options, no error anywhere.
   *
   * Pass-through on an unparseable name is DELIBERATE (the result is embedded as
   * the `<…>` term of the query).
   */
  private toFullIRI(propertyName: string): string {
    if (
      propertyName.startsWith("http://") ||
      propertyName.startsWith("https://")
    ) {
      return propertyName;
    }

    const parsed = Namespace.fromPropertyKey(propertyName);
    if (parsed) {
      return parsed.namespace.term(parsed.localName).value;
    }

    return propertyName;
  }

  /**
   * Full term IRI → `prefix__LocalName`, the exact inverse of {@link toFullIRI}
   * derived from the SAME namespace array via `Namespace.fromTermIRI`.
   *
   * ⛔ Issue #4353: the regex it replaces refused the same three prefix shapes,
   * so an enum instance under `…/ontology/aiKnow#` was offered to the user as
   * the wikilink `[[https://exocortex.my/ontology/aiKnow#KindA]]` — a link that
   * resolves to nothing and, once written, corrupts the asset's value.
   */
  private fromFullIRI(iri: string): string {
    const term = Namespace.fromTermIRI(iri);
    if (term) {
      return `${term.namespace.prefix}__${term.localName}`;
    }
    return iri;
  }
}
