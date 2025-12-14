import type { ITripleStore } from "../../../interfaces/ITripleStore";
import type { Triple } from "../../../domain/models/rdf/Triple";
import type { Subject, Predicate } from "../../../domain/models/rdf/Triple";
import { IRI } from "../../../domain/models/rdf/IRI";

export class DescribeExecutor {
  constructor(private readonly tripleStore: ITripleStore) {}

  async execute(resources: (Subject | Predicate)[]): Promise<Triple[]> {
    const resultTriples: Triple[] = [];
    const seen = new Set<string>();

    for (const resource of resources) {
      const relatedTriples = await this.describeResource(resource);

      for (const triple of relatedTriples) {
        const key = `${triple.subject.toString()}|${triple.predicate.toString()}|${triple.object.toString()}`;
        if (!seen.has(key)) {
          seen.add(key);
          resultTriples.push(triple);
        }
      }
    }

    return resultTriples;
  }

  private async describeResource(resource: Subject | Predicate): Promise<Triple[]> {
    const triples: Triple[] = [];

    const asSubject = await this.tripleStore.match(resource, undefined, undefined);
    triples.push(...asSubject);

    const asObject = await this.tripleStore.match(undefined, undefined, resource);
    triples.push(...asObject);

    return triples;
  }

  async describeByIRI(iri: string): Promise<Triple[]> {
    const resource = new IRI(iri);
    return this.execute([resource]);
  }
}
