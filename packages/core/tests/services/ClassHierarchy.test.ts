import { ClassHierarchy } from '../../src/services/ClassHierarchy';
import type { Triple } from '../../src/infrastructure/sparql/algebra/AlgebraOperation';

const RDFS_SUBCLASS_OF = 'http://www.w3.org/2000/01/rdf-schema#subClassOf';

function mkSub(child: string, parent: string): Triple {
  return {
    subject: { type: 'iri', value: child },
    predicate: { type: 'iri', value: RDFS_SUBCLASS_OF },
    object: { type: 'iri', value: parent },
  };
}

describe('ClassHierarchy', () => {
  describe('isSubClassOf', () => {
    it('returns true for identity (same class)', () => {
      const h = new ClassHierarchy([]);
      expect(h.isSubClassOf('A', 'A')).toBe(true);
    });

    it('returns true for direct subclass', () => {
      const h = new ClassHierarchy([mkSub('A', 'B')]);
      expect(h.isSubClassOf('A', 'B')).toBe(true);
    });

    it('returns false when direction is reversed', () => {
      const h = new ClassHierarchy([mkSub('A', 'B')]);
      expect(h.isSubClassOf('B', 'A')).toBe(false);
    });

    it('returns true for transitive chain A->B->C', () => {
      const h = new ClassHierarchy([mkSub('A', 'B'), mkSub('B', 'C')]);
      expect(h.isSubClassOf('A', 'C')).toBe(true);
      expect(h.isSubClassOf('A', 'B')).toBe(true);
      expect(h.isSubClassOf('B', 'C')).toBe(true);
    });

    it('handles deep transitive chain A->B->C->D', () => {
      const h = new ClassHierarchy([mkSub('A', 'B'), mkSub('B', 'C'), mkSub('C', 'D')]);
      expect(h.isSubClassOf('A', 'D')).toBe(true);
      expect(h.isSubClassOf('B', 'D')).toBe(true);
    });

    it('returns false for unrelated classes', () => {
      const h = new ClassHierarchy([mkSub('A', 'B'), mkSub('C', 'D')]);
      expect(h.isSubClassOf('A', 'D')).toBe(false);
      expect(h.isSubClassOf('C', 'B')).toBe(false);
    });

    it('does not infinite-loop on cycle A->B->A', () => {
      const h = new ClassHierarchy([mkSub('A', 'B'), mkSub('B', 'A')]);
      expect(h.isSubClassOf('A', 'B')).toBe(true);
      expect(h.isSubClassOf('B', 'A')).toBe(true);
      expect(h.isSubClassOf('A', 'X')).toBe(false);
    });

    it('does not infinite-loop on cycle A->B->C->A', () => {
      const h = new ClassHierarchy([mkSub('A', 'B'), mkSub('B', 'C'), mkSub('C', 'A')]);
      expect(h.isSubClassOf('A', 'C')).toBe(true);
      expect(h.isSubClassOf('C', 'B')).toBe(true);
      expect(h.isSubClassOf('A', 'X')).toBe(false);
    });

    it('ignores non-rdfs:subClassOf triples', () => {
      const h = new ClassHierarchy([
        {
          subject: { type: 'iri', value: 'A' },
          predicate: { type: 'iri', value: 'http://example.org/other' },
          object: { type: 'iri', value: 'B' },
        },
      ]);
      expect(h.isSubClassOf('A', 'B')).toBe(false);
    });

    it('ignores triples with non-IRI subject', () => {
      const h = new ClassHierarchy([
        {
          subject: { type: 'literal', value: 'A' },
          predicate: { type: 'iri', value: RDFS_SUBCLASS_OF },
          object: { type: 'iri', value: 'B' },
        },
      ]);
      expect(h.isSubClassOf('A', 'B')).toBe(false);
    });

    it('handles empty input', () => {
      const h = new ClassHierarchy([]);
      expect(h.isSubClassOf('A', 'B')).toBe(false);
    });
  });

  describe('getAncestors', () => {
    it('returns empty set for unknown class', () => {
      const h = new ClassHierarchy([]);
      expect(h.getAncestors('A').size).toBe(0);
    });

    it('returns direct parent', () => {
      const h = new ClassHierarchy([mkSub('A', 'B')]);
      expect(h.getAncestors('A')).toEqual(new Set(['B']));
    });

    it('returns all transitive ancestors', () => {
      const h = new ClassHierarchy([mkSub('A', 'B'), mkSub('B', 'C')]);
      expect(h.getAncestors('A')).toEqual(new Set(['B', 'C']));
    });

    it('does not include the class itself', () => {
      const h = new ClassHierarchy([mkSub('A', 'B')]);
      expect(h.getAncestors('A').has('A')).toBe(false);
    });

    it('does not infinite-loop on cycle in getAncestors', () => {
      const h = new ClassHierarchy([mkSub('A', 'B'), mkSub('B', 'A')]);
      const ancestors = h.getAncestors('A');
      expect(ancestors.has('B')).toBe(true);
    });
  });
});
