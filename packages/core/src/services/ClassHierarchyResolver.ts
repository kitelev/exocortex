import { injectable } from "tsyringe";
import type { ILogger } from "../interfaces/ILogger";
import { Namespace } from "../domain/models/rdf/Namespace";
import type { ISPARQLQueryable } from "./PropertySchemaResolver";

@injectable()
export class ClassHierarchyResolver {
  private cache = new Map<string, string[]>();

  constructor(
    private readonly sparqlService: ISPARQLQueryable,
    private readonly logger?: ILogger,
  ) {}

  async resolve(className: string): Promise<string[]> {
    const cached = this.cache.get(className);
    if (cached) {
      return [...cached];
    }

    try {
      const hierarchy = await this.loadHierarchy(className);
      this.cache.set(className, hierarchy);
      return [...hierarchy];
    } catch (error) {
      this.logger?.warn(`Failed to resolve class hierarchy for ${className}`, {
        error: String(error),
      });
      return this.fallback(className);
    }
  }

  invalidateCache(): void {
    this.cache.clear();
  }

  private async loadHierarchy(className: string): Promise<string[]> {
    const fullIRI = this.toFullIRI(className);

    const query = `
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      PREFIX exo: <https://exocortex.my/ontology/exo#>

      SELECT ?ancestor WHERE {
        <${fullIRI}> rdfs:subClassOf+ ?ancestorFull .
        BIND(STR(?ancestorFull) AS ?ancestor)
      }
    `;

    const results = await this.sparqlService.query(query);

    if (results.length === 0) {
      return this.fallback(className);
    }

    const ancestors: string[] = [className];
    for (const binding of results) {
      const ancestorIRI = binding.get("ancestor");
      if (ancestorIRI) {
        const prefixed = this.fromFullIRI(String(ancestorIRI));
        if (!ancestors.includes(prefixed)) {
          ancestors.push(prefixed);
        }
      }
    }

    if (!ancestors.includes("exo__Asset") && ancestors.length > 1) {
      ancestors.push("exo__Asset");
    }

    return ancestors;
  }

  private fallback(className: string): string[] {
    return [className, "exo__Asset"];
  }

  /**
   * `prefix__LocalName` → full class IRI, derived from the SHARED grammar
   * (`Namespace.fromPropertyKey` → `Namespace.forPrefix`).
   *
   * ⛔ Issue #4353: this used to be a private `^([a-z]+)__(.+)$` regex plus a
   * two-case `switch`. The regex refused any prefix carrying a capital, a digit
   * or a hyphen, so `aiKnow__Memory`, `exo003__Alias` and
   * `adapter-exo-ims__relatesToConcept` fell through to the final pass-through
   * and were handed to SPARQL as a bare frontmatter key inside `<…>` — no
   * binding matched, `loadHierarchy` took the empty-result branch, and the class
   * silently resolved to the two-element {@link fallback} instead of its real
   * ancestors. Measured on the three live vaults: 10 / 13 / 22 TBox labels carry
   * such a prefix. The `switch` was dead weight besides — both named cases
   * produced byte-identical output to `default`.
   *
   * Same migration as `PropertySchemaResolver.toFullIRI` (ticket `6572f3f3`,
   * req `38e3f174`); the two now share one grammar instead of two copies. A
   * registered W3C prefix (`rdfs__subClassOf`) consequently mints its canonical
   * `http://www.w3.org/…` IRI rather than a nonexistent `…/ontology/rdfs#` one.
   *
   * Pass-through on an unparseable name is DELIBERATE: the caller embeds the
   * result as the `<…>` term of the hierarchy query.
   */
  private toFullIRI(propertyName: string): string {
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
   * Full term IRI → `prefix__LocalName`, the exact inverse of {@link toFullIRI}
   * derived from the SAME namespace array via `Namespace.fromTermIRI`.
   *
   * ⛔ Issue #4353: the regex it replaces refused the same three prefix shapes,
   * so an ancestor IRI under `…/ontology/aiKnow#` came back RAW and entered the
   * returned hierarchy as a full IRI — a value no caller can match against a
   * frontmatter class name.
   */
  private fromFullIRI(iri: string): string {
    const term = Namespace.fromTermIRI(iri);
    if (term) {
      return `${term.namespace.prefix}__${term.localName}`;
    }
    return iri;
  }
}
