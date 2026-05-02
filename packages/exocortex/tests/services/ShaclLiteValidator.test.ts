import {
  validate,
  ShapeRegistry,
  Shape,
  Violation,
  ValidationReport,
  ClassHierarchy,
} from '../../src/services/ShaclLiteValidator';
import type { Triple } from '../../src/infrastructure/sparql/algebra/AlgebraOperation';

// ── Constants ─────────────────────────────────────────────────────────────────

const TYPE_IRI = 'https://exocortex.my/ontology/exo#Instance_class';
const EMS = 'https://exocortex.my/ontology/ems#';
const EXO = 'https://exocortex.my/ontology/exo#';
const XSD = 'http://www.w3.org/2001/XMLSchema#';

// ── Triple builders ───────────────────────────────────────────────────────────

function iriTriple(s: string, p: string, o: string): Triple {
  return {
    subject: { type: 'iri', value: s },
    predicate: { type: 'iri', value: p },
    object: { type: 'iri', value: o },
  };
}

function litTriple(s: string, p: string, value: string, datatype?: string): Triple {
  return {
    subject: { type: 'iri', value: s },
    predicate: { type: 'iri', value: p },
    object: { type: 'literal', value, datatype },
  };
}

function typeTriple(s: string, cls: string): Triple {
  return iriTriple(s, TYPE_IRI, cls);
}

// ── Minimal ClassHierarchy stub ───────────────────────────────────────────────

function makeHierarchy(subclassOf: Record<string, string[]> = {}): ClassHierarchy {
  return {
    isSubClassOf(child: string, parent: string): boolean {
      if (child === parent) return true;
      const visited = new Set<string>();
      const queue = [child];
      while (queue.length > 0) {
        const cur = queue.shift()!;
        if (visited.has(cur)) continue;
        visited.add(cur);
        for (const p of subclassOf[cur] ?? []) {
          if (p === parent) return true;
          if (!visited.has(p)) queue.push(p);
        }
      }
      return false;
    },
  };
}

// ── Shape builders ────────────────────────────────────────────────────────────

function makeShape(overrides: Partial<Shape> & Pick<Shape, 'propertyIRI'>): Shape {
  return {
    domain: [`${EMS}Effort`],
    severity: 'sh:Violation',
    ...overrides,
  };
}

function makeRegistry(shapes: Shape[], typePredicateIRI?: string): ShapeRegistry {
  return new ShapeRegistry(shapes, typePredicateIRI ?? TYPE_IRI);
}

const flatHierarchy = makeHierarchy();

// ═════════════════════════════════════════════════════════════════════════════
// Suite 1: Basic conformance
// ═════════════════════════════════════════════════════════════════════════════

describe('validate — basic conformance', () => {
  it('T01: conforms=true with empty triples and empty registry', () => {
    const report = validate([], makeRegistry([]), flatHierarchy);
    expect(report.conforms).toBe(true);
    expect(report.violations).toHaveLength(0);
  });

  it('T02: conforms=true when registry has no shapes', () => {
    const triples = [typeTriple('node:A', `${EMS}Effort`), litTriple('node:A', `${EMS}Effort_status`, 'Doing')];
    const report = validate(triples, makeRegistry([]), flatHierarchy);
    expect(report.conforms).toBe(true);
  });

  it('T03: conforms=true when subject class does not match shape domain', () => {
    const shape = makeShape({ propertyIRI: `${EMS}Effort_status`, domain: [`${EMS}Task`] });
    const triples = [typeTriple('node:A', `${EMS}Effort`)];
    const report = validate(triples, makeRegistry([shape]), flatHierarchy);
    expect(report.conforms).toBe(true);
    expect(report.violations).toHaveLength(0);
  });

  it('T04: conforms=true when no subjects exist', () => {
    const shape = makeShape({ propertyIRI: `${EMS}Effort_status`, minCount: 1 });
    const report = validate([], makeRegistry([shape]), flatHierarchy);
    expect(report.conforms).toBe(true);
  });

  it('T05: conforms=true when shape domain is empty — applies to all subjects', () => {
    const shape = makeShape({ propertyIRI: `${EMS}Effort_label`, domain: [] });
    const triples = [
      typeTriple('node:X', `${EMS}Effort`),
      litTriple('node:X', `${EMS}Effort_label`, 'hello'),
    ];
    const report = validate(triples, makeRegistry([shape]), flatHierarchy);
    expect(report.conforms).toBe(true);
  });

  it('T06: non-IRI subject triples are ignored', () => {
    const triples: Triple[] = [
      {
        subject: { type: 'literal', value: '_blank' },
        predicate: { type: 'iri', value: TYPE_IRI },
        object: { type: 'iri', value: `${EMS}Effort` },
      },
    ];
    const shape = makeShape({ propertyIRI: `${EMS}Effort_status`, minCount: 1 });
    const report = validate(triples, makeRegistry([shape]), flatHierarchy);
    expect(report.conforms).toBe(true);
  });

  it('T07: non-IRI predicate triples are ignored', () => {
    const triples: Triple[] = [
      {
        subject: { type: 'iri', value: 'node:A' },
        predicate: { type: 'literal', value: 'some-predicate' },
        object: { type: 'iri', value: `${EMS}Effort` },
      },
    ];
    const report = validate(triples, makeRegistry([]), flatHierarchy);
    expect(report.conforms).toBe(true);
    expect(report.violations).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 2: minCount violations
// ═════════════════════════════════════════════════════════════════════════════

describe('validate — minCount', () => {
  it('T08: minCount=1 passes when value present', () => {
    const shape = makeShape({ propertyIRI: `${EMS}Effort_status`, minCount: 1 });
    const triples = [
      typeTriple('node:A', `${EMS}Effort`),
      litTriple('node:A', `${EMS}Effort_status`, 'Doing'),
    ];
    const report = validate(triples, makeRegistry([shape]), flatHierarchy);
    expect(report.conforms).toBe(true);
    expect(report.violations).toHaveLength(0);
  });

  it('T09: minCount=1 fails when no value present', () => {
    const shape = makeShape({ propertyIRI: `${EMS}Effort_status`, minCount: 1 });
    const triples = [typeTriple('node:A', `${EMS}Effort`)];
    const report = validate(triples, makeRegistry([shape]), flatHierarchy);
    expect(report.conforms).toBe(false);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].focusNode).toBe('node:A');
    expect(report.violations[0].propertyPath).toBe(`${EMS}Effort_status`);
  });

  it('T10: minCount=2 fails when only one value present', () => {
    const shape = makeShape({ propertyIRI: `${EMS}Effort_tags`, minCount: 2 });
    const triples = [
      typeTriple('node:A', `${EMS}Effort`),
      litTriple('node:A', `${EMS}Effort_tags`, 'tag1'),
    ];
    const report = validate(triples, makeRegistry([shape]), flatHierarchy);
    expect(report.violations).toHaveLength(1);
  });

  it('T11: minCount=0 never triggers (zero = no requirement)', () => {
    const shape = makeShape({ propertyIRI: `${EMS}Effort_status`, minCount: 0 });
    const triples = [typeTriple('node:A', `${EMS}Effort`)];
    const report = validate(triples, makeRegistry([shape]), flatHierarchy);
    expect(report.violations).toHaveLength(0);
  });

  it('T12: minCount violation uses custom message when provided', () => {
    const shape = makeShape({
      propertyIRI: `${EMS}Effort_status`,
      minCount: 1,
      message: 'Status is required',
    });
    const triples = [typeTriple('node:A', `${EMS}Effort`)];
    const report = validate(triples, makeRegistry([shape]), flatHierarchy);
    expect(report.violations[0].message).toBe('Status is required');
  });

  it('T13: minCount violation contains default message mentioning minCount', () => {
    const shape = makeShape({ propertyIRI: `${EMS}Effort_status`, minCount: 1 });
    const triples = [typeTriple('node:A', `${EMS}Effort`)];
    const report = validate(triples, makeRegistry([shape]), flatHierarchy);
    expect(report.violations[0].message).toContain('minCount');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 3: Cardinality
// ═════════════════════════════════════════════════════════════════════════════

describe('validate — cardinality', () => {
  it('T14: cardinality=Single passes with one value', () => {
    const shape = makeShape({ propertyIRI: `${EMS}Effort_status`, cardinality: 'Single' });
    const triples = [
      typeTriple('node:A', `${EMS}Effort`),
      litTriple('node:A', `${EMS}Effort_status`, 'Doing'),
    ];
    const report = validate(triples, makeRegistry([shape]), flatHierarchy);
    expect(report.violations).toHaveLength(0);
  });

  it('T15: cardinality=Single fails with two values', () => {
    const shape = makeShape({ propertyIRI: `${EMS}Effort_status`, cardinality: 'Single' });
    const triples = [
      typeTriple('node:A', `${EMS}Effort`),
      litTriple('node:A', `${EMS}Effort_status`, 'Doing'),
      litTriple('node:A', `${EMS}Effort_status`, 'Done'),
    ];
    const report = validate(triples, makeRegistry([shape]), flatHierarchy);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].message).toContain('maxCount');
  });

  it('T16: cardinality=Single fails with three values', () => {
    const shape = makeShape({ propertyIRI: `${EMS}Effort_status`, cardinality: 'Single' });
    const triples = [
      typeTriple('node:A', `${EMS}Effort`),
      litTriple('node:A', `${EMS}Effort_status`, 'Doing'),
      litTriple('node:A', `${EMS}Effort_status`, 'Done'),
      litTriple('node:A', `${EMS}Effort_status`, 'Backlog'),
    ];
    const report = validate(triples, makeRegistry([shape]), flatHierarchy);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].message).toContain('3');
  });

  it('T17: cardinality=Multiple passes with multiple values', () => {
    const shape = makeShape({ propertyIRI: `${EMS}Effort_tags`, cardinality: 'Multiple' });
    const triples = [
      typeTriple('node:A', `${EMS}Effort`),
      litTriple('node:A', `${EMS}Effort_tags`, 'tag1'),
      litTriple('node:A', `${EMS}Effort_tags`, 'tag2'),
    ];
    const report = validate(triples, makeRegistry([shape]), flatHierarchy);
    expect(report.violations).toHaveLength(0);
  });

  it('T18: cardinality=Single violation uses custom message', () => {
    const shape = makeShape({
      propertyIRI: `${EMS}Effort_status`,
      cardinality: 'Single',
      message: 'Only one status allowed',
    });
    const triples = [
      typeTriple('node:A', `${EMS}Effort`),
      litTriple('node:A', `${EMS}Effort_status`, 'Doing'),
      litTriple('node:A', `${EMS}Effort_status`, 'Done'),
    ];
    const report = validate(triples, makeRegistry([shape]), flatHierarchy);
    expect(report.violations[0].message).toBe('Only one status allowed');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 4: Severity tiers
// ═════════════════════════════════════════════════════════════════════════════

describe('validate — severity tiers', () => {
  it('T19: sh:Violation makes conforms=false', () => {
    const shape = makeShape({
      propertyIRI: `${EMS}Effort_status`,
      minCount: 1,
      severity: 'sh:Violation',
    });
    const triples = [typeTriple('node:A', `${EMS}Effort`)];
    const report = validate(triples, makeRegistry([shape]), flatHierarchy);
    expect(report.conforms).toBe(false);
  });

  it('T20: sh:Warning does not affect conforms (stays true)', () => {
    const shape = makeShape({
      propertyIRI: `${EMS}Effort_status`,
      minCount: 1,
      severity: 'sh:Warning',
    });
    const triples = [typeTriple('node:A', `${EMS}Effort`)];
    const report = validate(triples, makeRegistry([shape]), flatHierarchy);
    expect(report.conforms).toBe(true);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].severity).toBe('sh:Warning');
  });

  it('T21: sh:Info does not affect conforms (stays true)', () => {
    const shape = makeShape({
      propertyIRI: `${EMS}Effort_label`,
      minCount: 1,
      severity: 'sh:Info',
    });
    const triples = [typeTriple('node:A', `${EMS}Effort`)];
    const report = validate(triples, makeRegistry([shape]), flatHierarchy);
    expect(report.conforms).toBe(true);
    expect(report.violations[0].severity).toBe('sh:Info');
  });

  it('T22: mixed severities — conforms=false only if sh:Violation present', () => {
    const shapes = [
      makeShape({ propertyIRI: `${EMS}Effort_status`, minCount: 1, severity: 'sh:Warning' }),
      makeShape({ propertyIRI: `${EMS}Effort_parent`, minCount: 1, severity: 'sh:Violation' }),
    ];
    const triples = [typeTriple('node:A', `${EMS}Effort`)];
    const report = validate(triples, makeRegistry(shapes), flatHierarchy);
    expect(report.conforms).toBe(false);
    expect(report.violations).toHaveLength(2);
  });

  it('T23: only sh:Warning violations → conforms=true despite violations array non-empty', () => {
    const shapes = [
      makeShape({ propertyIRI: `${EMS}Effort_status`, minCount: 1, severity: 'sh:Warning' }),
      makeShape({ propertyIRI: `${EMS}Effort_label`, minCount: 1, severity: 'sh:Info' }),
    ];
    const triples = [typeTriple('node:A', `${EMS}Effort`)];
    const report = validate(triples, makeRegistry(shapes), flatHierarchy);
    expect(report.conforms).toBe(true);
    expect(report.violations).toHaveLength(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 5: Range conformance — IRI values
// ═════════════════════════════════════════════════════════════════════════════

describe('validate — range conformance (IRI values)', () => {
  it('T24: IRI value matches range class exactly → no violation', () => {
    const shape = makeShape({
      propertyIRI: `${EMS}Effort_parent`,
      range: [`${EMS}Effort`],
    });
    const triples = [
      typeTriple('node:A', `${EMS}Effort`),
      typeTriple('node:B', `${EMS}Effort`),
      iriTriple('node:A', `${EMS}Effort_parent`, 'node:B'),
    ];
    const report = validate(triples, makeRegistry([shape]), flatHierarchy);
    expect(report.violations).toHaveLength(0);
  });

  it('T25: IRI value does not match range class → sh:class violation', () => {
    const shape = makeShape({
      propertyIRI: `${EMS}Effort_parent`,
      range: [`${EMS}Effort`],
    });
    const triples = [
      typeTriple('node:A', `${EMS}Effort`),
      typeTriple('node:B', `${EMS}Task`),
      iriTriple('node:A', `${EMS}Effort_parent`, 'node:B'),
    ];
    const report = validate(triples, makeRegistry([shape]), flatHierarchy);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].message).toContain('sh:class');
    expect(report.violations[0].actualValue).toBe('node:B');
    expect(report.violations[0].expectedRange).toBe(`${EMS}Effort`);
  });

  it('T26: IRI value with no type info → no classes → range violation', () => {
    const shape = makeShape({
      propertyIRI: `${EMS}Effort_parent`,
      range: [`${EMS}Effort`],
    });
    const triples = [
      typeTriple('node:A', `${EMS}Effort`),
      iriTriple('node:A', `${EMS}Effort_parent`, 'node:B'),
    ];
    const report = validate(triples, makeRegistry([shape]), flatHierarchy);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].actualValue).toBe('node:B');
  });

  it('T27: range with multiple options — ANY-of semantics — first class matches', () => {
    const shape = makeShape({
      propertyIRI: `${EMS}Effort_parent`,
      range: [`${EMS}Effort`, `${EMS}Task`],
    });
    const triples = [
      typeTriple('node:A', `${EMS}Effort`),
      typeTriple('node:B', `${EMS}Effort`),
      iriTriple('node:A', `${EMS}Effort_parent`, 'node:B'),
    ];
    const report = validate(triples, makeRegistry([shape]), flatHierarchy);
    expect(report.violations).toHaveLength(0);
  });

  it('T28: range with multiple options — ANY-of semantics — second class matches', () => {
    const shape = makeShape({
      propertyIRI: `${EMS}Effort_parent`,
      range: [`${EMS}Effort`, `${EMS}Task`],
    });
    const triples = [
      typeTriple('node:A', `${EMS}Effort`),
      typeTriple('node:B', `${EMS}Task`),
      iriTriple('node:A', `${EMS}Effort_parent`, 'node:B'),
    ];
    const report = validate(triples, makeRegistry([shape]), flatHierarchy);
    expect(report.violations).toHaveLength(0);
  });

  it('T29: IRI value satisfies range via subclass hierarchy', () => {
    const hierarchy = makeHierarchy({ [`${EMS}SubEffort`]: [`${EMS}Effort`] });
    const shape = makeShape({
      propertyIRI: `${EMS}Effort_parent`,
      range: [`${EMS}Effort`],
    });
    const triples = [
      typeTriple('node:A', `${EMS}Effort`),
      typeTriple('node:B', `${EMS}SubEffort`),
      iriTriple('node:A', `${EMS}Effort_parent`, 'node:B'),
    ];
    const report = validate(triples, makeRegistry([shape]), hierarchy);
    expect(report.violations).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 6: Range conformance — Literal values
// ═════════════════════════════════════════════════════════════════════════════

describe('validate — range conformance (literal values)', () => {
  it('T30: literal with matching datatype → no violation', () => {
    const shape = makeShape({
      propertyIRI: `${EMS}Effort_plannedStart`,
      range: [`${XSD}dateTime`],
    });
    const triples = [
      typeTriple('node:A', `${EMS}Effort`),
      litTriple('node:A', `${EMS}Effort_plannedStart`, '2026-01-01T00:00:00Z', `${XSD}dateTime`),
    ];
    const report = validate(triples, makeRegistry([shape]), flatHierarchy);
    expect(report.violations).toHaveLength(0);
  });

  it('T31: literal with wrong datatype → sh:datatype violation', () => {
    const shape = makeShape({
      propertyIRI: `${EMS}Effort_plannedStart`,
      range: [`${XSD}dateTime`],
    });
    const triples = [
      typeTriple('node:A', `${EMS}Effort`),
      litTriple('node:A', `${EMS}Effort_plannedStart`, 'not-a-date', `${XSD}string`),
    ];
    const report = validate(triples, makeRegistry([shape]), flatHierarchy);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].message).toContain('sh:datatype');
    expect(report.violations[0].actualValue).toBe('not-a-date');
  });

  it('T32: literal without datatype defaults to xsd:string', () => {
    const shape = makeShape({
      propertyIRI: `${EMS}Effort_label`,
      range: [`${XSD}string`],
    });
    const triples = [
      typeTriple('node:A', `${EMS}Effort`),
      litTriple('node:A', `${EMS}Effort_label`, 'My Label'),
    ];
    const report = validate(triples, makeRegistry([shape]), flatHierarchy);
    expect(report.violations).toHaveLength(0);
  });

  it('T33: literal without datatype fails non-string range', () => {
    const shape = makeShape({
      propertyIRI: `${EMS}Effort_count`,
      range: [`${XSD}integer`],
    });
    const triples = [
      typeTriple('node:A', `${EMS}Effort`),
      litTriple('node:A', `${EMS}Effort_count`, '42'),
    ];
    const report = validate(triples, makeRegistry([shape]), flatHierarchy);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].expectedRange).toBe(`${XSD}integer`);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 7: Domain matching & hierarchy
// ═════════════════════════════════════════════════════════════════════════════

describe('validate — domain matching', () => {
  it('T34: shape applies when subject class matches domain directly', () => {
    const shape = makeShape({
      propertyIRI: `${EMS}Effort_status`,
      domain: [`${EMS}Effort`],
      minCount: 1,
    });
    const triples = [typeTriple('node:A', `${EMS}Effort`)];
    const report = validate(triples, makeRegistry([shape]), flatHierarchy);
    expect(report.violations).toHaveLength(1);
  });

  it('T35: shape applies when subject class is subclass of domain class', () => {
    const hierarchy = makeHierarchy({ [`${EMS}Task`]: [`${EMS}Effort`] });
    const shape = makeShape({
      propertyIRI: `${EMS}Effort_status`,
      domain: [`${EMS}Effort`],
      minCount: 1,
    });
    const triples = [typeTriple('node:A', `${EMS}Task`)];
    const report = validate(triples, makeRegistry([shape]), hierarchy);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].focusNode).toBe('node:A');
  });

  it('T36: shape does not apply when subject class is unrelated to domain', () => {
    const shape = makeShape({
      propertyIRI: `${EMS}Effort_status`,
      domain: [`${EMS}Task`],
      minCount: 1,
    });
    const triples = [typeTriple('node:A', `${EMS}Effort`)];
    const report = validate(triples, makeRegistry([shape]), flatHierarchy);
    expect(report.violations).toHaveLength(0);
  });

  it('T37: multi-class subject — shape applies if any class matches domain', () => {
    const shape = makeShape({
      propertyIRI: `${EMS}Effort_status`,
      domain: [`${EMS}Task`],
      minCount: 1,
    });
    const triples = [
      typeTriple('node:A', `${EMS}Effort`),
      typeTriple('node:A', `${EMS}Task`),
    ];
    const report = validate(triples, makeRegistry([shape]), flatHierarchy);
    expect(report.violations).toHaveLength(1);
  });

  it('T38: empty domain shape applies to all subjects regardless of class', () => {
    const shape = makeShape({
      propertyIRI: `${EMS}Effort_label`,
      domain: [],
      minCount: 1,
    });
    const triples = [
      typeTriple('node:A', `${EMS}Effort`),
      typeTriple('node:B', `${EMS}Task`),
    ];
    const report = validate(triples, makeRegistry([shape]), flatHierarchy);
    expect(report.violations).toHaveLength(2);
    const nodes = report.violations.map((v) => v.focusNode).sort();
    expect(nodes).toEqual(['node:A', 'node:B']);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 8: Cyclic hierarchy
// ═════════════════════════════════════════════════════════════════════════════

describe('validate — cyclic hierarchy', () => {
  it('T39: cyclic hierarchy A→B→A does not cause infinite loop in domain check', () => {
    const hierarchy = makeHierarchy({
      [`${EMS}A`]: [`${EMS}B`],
      [`${EMS}B`]: [`${EMS}A`],
    });
    const shape = makeShape({
      propertyIRI: `${EMS}Effort_status`,
      domain: [`${EMS}Task`],
      minCount: 1,
    });
    const triples = [typeTriple('node:X', `${EMS}A`)];
    expect(() => validate(triples, makeRegistry([shape]), hierarchy)).not.toThrow();
  });

  it('T40: cyclic hierarchy does not cause infinite loop in range check', () => {
    const hierarchy = makeHierarchy({
      [`${EMS}A`]: [`${EMS}B`],
      [`${EMS}B`]: [`${EMS}A`],
    });
    const shape = makeShape({
      propertyIRI: `${EMS}Effort_parent`,
      range: [`${EMS}C`],
    });
    const triples = [
      typeTriple('node:X', `${EMS}Effort`),
      typeTriple('node:Y', `${EMS}A`),
      iriTriple('node:X', `${EMS}Effort_parent`, 'node:Y'),
    ];
    expect(() => validate(triples, makeRegistry([shape]), hierarchy)).not.toThrow();
    const report = validate(triples, makeRegistry([shape]), hierarchy);
    expect(report.violations).toHaveLength(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 9: Output structure & sorting
// ═════════════════════════════════════════════════════════════════════════════

describe('validate — output structure', () => {
  it('T41: violations sorted by focusNode then propertyPath', () => {
    const shapes = [
      makeShape({ propertyIRI: `${EMS}Effort_z`, minCount: 1, severity: 'sh:Warning' }),
      makeShape({ propertyIRI: `${EMS}Effort_a`, minCount: 1, severity: 'sh:Warning' }),
    ];
    const triples = [
      typeTriple('node:B', `${EMS}Effort`),
      typeTriple('node:A', `${EMS}Effort`),
    ];
    const report = validate(triples, makeRegistry(shapes), flatHierarchy);
    expect(report.violations).toHaveLength(4);
    expect(report.violations[0].focusNode).toBe('node:A');
    expect(report.violations[0].propertyPath).toBe(`${EMS}Effort_a`);
    expect(report.violations[1].focusNode).toBe('node:A');
    expect(report.violations[1].propertyPath).toBe(`${EMS}Effort_z`);
    expect(report.violations[2].focusNode).toBe('node:B');
  });

  it('T42: violation contains all required fields', () => {
    const shape = makeShape({ propertyIRI: `${EMS}Effort_status`, minCount: 1 });
    const triples = [typeTriple('node:A', `${EMS}Effort`)];
    const report = validate(triples, makeRegistry([shape]), flatHierarchy);
    const v = report.violations[0];
    expect(v).toHaveProperty('focusNode');
    expect(v).toHaveProperty('propertyPath');
    expect(v).toHaveProperty('severity');
    expect(v).toHaveProperty('message');
  });

  it('T43: range violation sets actualValue and expectedRange', () => {
    const shape = makeShape({
      propertyIRI: `${EMS}Effort_parent`,
      range: [`${EMS}Effort`],
    });
    const triples = [
      typeTriple('node:A', `${EMS}Effort`),
      typeTriple('node:B', `${EMS}Task`),
      iriTriple('node:A', `${EMS}Effort_parent`, 'node:B'),
    ];
    const report = validate(triples, makeRegistry([shape]), flatHierarchy);
    expect(report.violations[0].actualValue).toBe('node:B');
    expect(report.violations[0].expectedRange).toBe(`${EMS}Effort`);
  });

  it('T44: conforms=true when all violations are sh:Warning or sh:Info', () => {
    const shapes = [
      makeShape({ propertyIRI: `${EMS}Effort_a`, minCount: 1, severity: 'sh:Warning' }),
      makeShape({ propertyIRI: `${EMS}Effort_b`, minCount: 1, severity: 'sh:Info' }),
    ];
    const triples = [typeTriple('node:A', `${EMS}Effort`)];
    const report = validate(triples, makeRegistry(shapes), flatHierarchy);
    expect(report.conforms).toBe(true);
    expect(report.violations.length).toBeGreaterThan(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 10: ShapeRegistry (inline in ShaclLiteValidator)
// ═════════════════════════════════════════════════════════════════════════════

describe('ShapeRegistry (ShaclLiteValidator)', () => {
  it('T45: getShape returns undefined for unknown propertyIRI', () => {
    const registry = new ShapeRegistry([]);
    expect(registry.getShape('unknown')).toBeUndefined();
  });

  it('T46: getShape returns shape for known propertyIRI', () => {
    const shape = makeShape({ propertyIRI: `${EMS}Effort_status` });
    const registry = new ShapeRegistry([shape]);
    expect(registry.getShape(`${EMS}Effort_status`)).toEqual(shape);
  });

  it('T47: getAllShapes returns all registered shapes', () => {
    const shapes = [
      makeShape({ propertyIRI: `${EMS}Effort_a` }),
      makeShape({ propertyIRI: `${EMS}Effort_b` }),
    ];
    const registry = new ShapeRegistry(shapes);
    expect(registry.getAllShapes()).toHaveLength(2);
  });

  it('T48: hasShape returns true for registered propertyIRI', () => {
    const registry = new ShapeRegistry([makeShape({ propertyIRI: `${EMS}Effort_status` })]);
    expect(registry.hasShape(`${EMS}Effort_status`)).toBe(true);
  });

  it('T49: hasShape returns false for unknown propertyIRI', () => {
    const registry = new ShapeRegistry([]);
    expect(registry.hasShape('none')).toBe(false);
  });

  it('T50: default typePredicateIRI is exo#Instance_class', () => {
    const registry = new ShapeRegistry([]);
    expect(registry.typePredicateIRI).toBe('https://exocortex.my/ontology/exo#Instance_class');
  });

  it('T51: custom typePredicateIRI is stored', () => {
    const registry = new ShapeRegistry([], 'http://example.org/type');
    expect(registry.typePredicateIRI).toBe('http://example.org/type');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 11: Edge cases
// ═════════════════════════════════════════════════════════════════════════════

describe('validate — edge cases', () => {
  it('T52: empty frontmatter (subject with no properties, no types) with empty-domain shape', () => {
    const shape = makeShape({ propertyIRI: `${EMS}Effort_label`, domain: [], minCount: 1 });
    const triples: Triple[] = [];
    const report = validate(triples, makeRegistry([shape]), flatHierarchy);
    expect(report.violations).toHaveLength(0);
  });

  it('T53: subject has only type triples, shape with domain match and minCount', () => {
    const shape = makeShape({ propertyIRI: `${EMS}Effort_status`, minCount: 1 });
    const triples = [typeTriple('node:A', `${EMS}Effort`)];
    const report = validate(triples, makeRegistry([shape]), flatHierarchy);
    expect(report.violations).toHaveLength(1);
  });

  it('T54: broken wikilink (IRI value exists but has no class info) treated as range violation', () => {
    const shape = makeShape({
      propertyIRI: `${EMS}Effort_parent`,
      range: [`${EMS}Effort`],
    });
    const triples = [
      typeTriple('node:A', `${EMS}Effort`),
      iriTriple('node:A', `${EMS}Effort_parent`, 'node:MISSING'),
    ];
    const report = validate(triples, makeRegistry([shape]), flatHierarchy);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].actualValue).toBe('node:MISSING');
  });

  it('T55: multiple violations across multiple subjects are all collected', () => {
    const shape = makeShape({ propertyIRI: `${EMS}Effort_status`, minCount: 1 });
    const triples = [
      typeTriple('node:A', `${EMS}Effort`),
      typeTriple('node:B', `${EMS}Effort`),
      typeTriple('node:C', `${EMS}Effort`),
    ];
    const report = validate(triples, makeRegistry([shape]), flatHierarchy);
    expect(report.violations).toHaveLength(3);
    expect(report.conforms).toBe(false);
  });

  it('T56: property with no shape defined → no violations', () => {
    const triples = [
      typeTriple('node:A', `${EMS}Effort`),
      litTriple('node:A', `${EMS}Effort_unknown_prop`, 'value'),
    ];
    const report = validate(triples, makeRegistry([]), flatHierarchy);
    expect(report.violations).toHaveLength(0);
  });

  it('T57: blank node object is ignored (not IRI or literal)', () => {
    const triples: Triple[] = [
      { subject: { type: 'iri', value: 'node:A' }, predicate: { type: 'iri', value: TYPE_IRI }, object: { type: 'blank', value: 'b0' } },
    ];
    const report = validate(triples, makeRegistry([]), flatHierarchy);
    expect(report.violations).toHaveLength(0);
  });
});
