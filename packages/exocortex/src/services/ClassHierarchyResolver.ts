import { injectable } from "tsyringe";
import type { ILogger } from "../interfaces/ILogger";
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
