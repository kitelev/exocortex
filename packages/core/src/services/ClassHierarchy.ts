import type { Triple } from '../infrastructure/sparql/algebra/AlgebraOperation';

const RDFS_SUBCLASS_OF = 'http://www.w3.org/2000/01/rdf-schema#subClassOf';

export class ClassHierarchy {
  private readonly adjacency: Map<string, Set<string>>;

  constructor(subclassTriples: Triple[]) {
    this.adjacency = new Map();
    for (const triple of subclassTriples) {
      if (triple.predicate.type !== 'iri' || triple.predicate.value !== RDFS_SUBCLASS_OF) {
        continue;
      }
      if (triple.subject.type !== 'iri' || triple.object.type !== 'iri') {
        continue;
      }
      const child = triple.subject.value;
      const parent = triple.object.value;
      let parents = this.adjacency.get(child);
      if (!parents) {
        parents = new Set();
        this.adjacency.set(child, parents);
      }
      parents.add(parent);
    }
  }

  // Transitive rdfs:subClassOf* lookup — cycle-safe via visited Set (pattern from PropertyPathExecutor.ts:224-251)
  isSubClassOf(child: string, parent: string): boolean {
    if (child === parent) return true;

    const visited = new Set<string>();
    const queue: string[] = [child];

    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      if (visited.has(current)) continue;
      visited.add(current);

      const parents = this.adjacency.get(current);
      if (!parents) continue;

      for (const p of parents) {
        if (p === parent) return true;
        if (!visited.has(p)) {
          queue.push(p);
        }
      }
    }

    return false;
  }

  getAncestors(cls: string): Set<string> {
    const result = new Set<string>();
    const visited = new Set<string>();
    const queue: string[] = [cls];

    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      if (visited.has(current)) continue;
      visited.add(current);

      const parents = this.adjacency.get(current);
      if (!parents) continue;

      for (const p of parents) {
        result.add(p);
        if (!visited.has(p)) {
          queue.push(p);
        }
      }
    }

    return result;
  }
}
