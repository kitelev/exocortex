/**
 * Issue #3488 — false-positive SHACL violations from IRI-representation artifacts.
 *
 * The SHACL-lite validator co-exists with three IRI schemes:
 *   1. filename-form  `obsidian://vault/<path>/<uuid>.md`
 *   2. symbolic       `https://exocortex.my/ontology/<prefix>#<LocalName>`
 *   3. synthetic      `uid:<uuid>` (a value-class JOIN key, never a real subject)
 *
 * These tests pin the two engine-level fixes that distinguish genuine data
 * problems from representation artifacts:
 *
 *   M1 / M4b / M5 — a sh:class range failure against a value whose type cannot
 *   be resolved in the store (cross-vault target, symbolic property-IRI with no
 *   backing subject, Exo003 anchor file with no rdf:type) is an *open-world*
 *   condition: emit `sh:Warning`, not `sh:Violation`. A value that IS a typed
 *   subject whose class genuinely does not conform stays `sh:Violation`.
 *
 *   M2 — `uid:<uuid>` synthetic join-keys must NOT be iterated as focus
 *   subjects. They carry only class info (for cross-vault value resolution) and
 *   never carry property triples, so they produce phantom `sh:minCount`
 *   violations for every required property of their class.
 *
 * Production shapes are mirrored from the 2026-06-12 vault-2025 baseline:
 *   - `exo__Setting_key minCount` phantom on `uid:<uuid>` (22 cases)
 *   - `exo__Asset_relates` class-failure on cross-vault target (69 cases)
 *   - `exocmd__Grounding_targetProperty` class-failure on symbolic IRI (M5)
 */
import {
  validate,
  ShapeRegistry,
  Shape,
  ClassHierarchy,
} from '../../src/services/ShaclLiteValidator';
import type { Triple } from '../../src/infrastructure/sparql/algebra/AlgebraOperation';

const TYPE_IRI = 'https://exocortex.my/ontology/exo#Instance_class';
const EMS = 'https://exocortex.my/ontology/ems#';
const EXO = 'https://exocortex.my/ontology/exo#';
const EXOCMD = 'https://exocortex.my/ontology/exocmd#';

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
const flatHierarchy = makeHierarchy();

function makeShape(overrides: Partial<Shape> & Pick<Shape, 'propertyIRI'>): Shape {
  return { domain: [`${EMS}Effort`], severity: 'sh:Violation', ...overrides };
}
function makeRegistry(shapes: Shape[]): ShapeRegistry {
  return new ShapeRegistry(shapes, TYPE_IRI);
}

// ═════════════════════════════════════════════════════════════════════════════
// M1 / M4b / M5 — unresolvable-ref class failures → sh:Warning, not sh:Violation
// ═════════════════════════════════════════════════════════════════════════════

describe('Issue #3488 M1 — cross-vault ref → warning, not violation', () => {
  const SUBJ = 'obsidian://vault/assetspaces/kitelev/exoas-kitelev/kitelev/0206315e-f12c-4645-b254-f2be937dabd7.md';
  // Target asset lives in this vault but its class definition is cross-vault,
  // so it carries NO rdf:type triple → classless value node.
  const TARGET = 'obsidian://vault/assetspaces/kitelev/exoas-shared-identities/shared-identities/c8a3f1d2-7e45-4b98-a6c1-9d2f5e8b3a17.md';

  it('M1.1: exo__Asset_relates to a classless cross-vault target → sh:Warning (conforms stays true)', () => {
    const shape = makeShape({
      propertyIRI: `${EXO}Asset_relates`,
      domain: [`${EXO}Asset`],
      range: [`${EXO}Asset`],
    });
    const triples = [
      typeTriple(SUBJ, `${EXO}Asset`),
      iriTriple(SUBJ, `${EXO}Asset_relates`, TARGET),
    ];
    const report = validate(triples, makeRegistry([shape]), flatHierarchy);

    expect(report.conforms).toBe(true); // warnings do not break conformance
    const ref = report.violations.find((v) => v.actualValue === TARGET);
    expect(ref).toBeDefined();
    expect(ref!.severity).toBe('sh:Warning');
    expect(ref!.constraint).toBe('class');
    expect(report.violations.some((v) => v.severity === 'sh:Violation')).toBe(false);
  });

  it('M1.2: ems__Effort_blocker to a synthesized root-level UUID IRI (target absent) → sh:Warning', () => {
    const SUBJ_K = 'obsidian://vault/assetspaces/kitelev/exoas-kitelev/kitelev/ea874bc3-57b1-4de6-847d-be50f960aa5a.md';
    const BLOCKER = 'obsidian://vault/8499facc-81f1-4c0a-ba80-151c95af45d9.md';
    const shape = makeShape({
      propertyIRI: `${EMS}Effort_blocker`,
      domain: [`${EMS}Effort`],
      range: [`${EMS}Effort`],
    });
    const triples = [
      typeTriple(SUBJ_K, `${EMS}Effort`),
      iriTriple(SUBJ_K, `${EMS}Effort_blocker`, BLOCKER),
    ];
    const report = validate(triples, makeRegistry([shape]), flatHierarchy);

    expect(report.conforms).toBe(true);
    const ref = report.violations.find((v) => v.actualValue === BLOCKER);
    expect(ref).toBeDefined();
    expect(ref!.severity).toBe('sh:Warning');
  });
});

describe('Issue #3488 M5 — symbolic property-IRI value with no backing subject → warning', () => {
  it('M5.1: exocmd__Grounding_targetProperty → ems#Effort_votes (symbolic, no subject) → sh:Warning', () => {
    const SUBJ = 'obsidian://vault/assetspaces/kitelev/exoas-exocmd/exocmd/506f031e-007f-4c74-8257-158550c64956.md';
    const VALUE = `${EMS}Effort_votes`; // symbolic IRI; no subject in the store carries this IRI
    const shape = makeShape({
      propertyIRI: `${EXOCMD}Grounding_targetProperty`,
      domain: [`${EXOCMD}Grounding`],
      range: [`${EXO}Property`],
    });
    const triples = [
      typeTriple(SUBJ, `${EXOCMD}Grounding`),
      iriTriple(SUBJ, `${EXOCMD}Grounding_targetProperty`, VALUE),
    ];
    const report = validate(triples, makeRegistry([shape]), flatHierarchy);

    expect(report.conforms).toBe(true);
    const ref = report.violations.find((v) => v.actualValue === VALUE);
    expect(ref).toBeDefined();
    expect(ref!.severity).toBe('sh:Warning');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Regression — genuine class violations must STILL be reported as sh:Violation
// ═════════════════════════════════════════════════════════════════════════════

describe('Issue #3488 regression — genuine wrong-class still violates', () => {
  it('R1: value IS a typed subject whose class does not conform → sh:Violation (NOT downgraded)', () => {
    const shape = makeShape({
      propertyIRI: `${EMS}Effort_parent`,
      range: [`${EMS}Effort`],
    });
    const triples = [
      typeTriple('node:A', `${EMS}Effort`),
      typeTriple('node:B', `${EMS}Task`), // node:B IS typed, but Task ⊄ Effort
      iriTriple('node:A', `${EMS}Effort_parent`, 'node:B'),
    ];
    const report = validate(triples, makeRegistry([shape]), flatHierarchy);

    expect(report.conforms).toBe(false);
    const v = report.violations.find((x) => x.actualValue === 'node:B');
    expect(v).toBeDefined();
    expect(v!.severity).toBe('sh:Violation');
    expect(v!.message).toContain('sh:class');
  });

  it('R2: cross-vault value resolved via uid: join-key still conforms (no false warning)', () => {
    // The value is a root-level synth IRI but its class IS known via the uid:
    // secondary index (another vault converter typed the full-path subject).
    const SUBJ = 'obsidian://vault/a.md';
    const FULLPATH = 'obsidian://vault/assetspaces/x/c8a3f1d2-7e45-4b98-a6c1-9d2f5e8b3a17.md';
    const SYNTH = 'obsidian://vault/c8a3f1d2-7e45-4b98-a6c1-9d2f5e8b3a17.md';
    const shape = makeShape({
      propertyIRI: `${EXO}Asset_relates`,
      domain: [`${EXO}Asset`],
      range: [`${EXO}Asset`],
    });
    const triples = [
      typeTriple(SUBJ, `${EXO}Asset`),
      typeTriple(FULLPATH, `${EXO}Asset`), // builds uid:c8a3f1d2 → [exo#Asset]
      iriTriple(SUBJ, `${EXO}Asset_relates`, SYNTH), // resolves via uid: join
    ];
    const report = validate(triples, makeRegistry([shape]), flatHierarchy);

    expect(report.conforms).toBe(true);
    expect(report.violations.some((v) => v.actualValue === SYNTH)).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// M2 — uid:<uuid> synthetic join-keys must not be focus subjects
// ═════════════════════════════════════════════════════════════════════════════

describe('Issue #3488 M2 — uid: synthetic subject must not produce phantom minCount', () => {
  const UID = '2a348086-8be4-442e-946e-84f1abe7f612';
  const SUBJ = `obsidian://vault/exocortex-settings/${UID}.md`;
  const SETTING = `${EXO}Setting`;

  it('M2.1: settings asset with Setting_key present → 0 minCount violations (no phantom on uid: key)', () => {
    const shape = makeShape({
      propertyIRI: `${EXO}Setting_key`,
      domain: [SETTING],
      minCount: 1,
    });
    const triples = [
      typeTriple(SUBJ, SETTING), // also synthesizes uid:<uid> → [Setting]
      litTriple(SUBJ, `${EXO}Setting_key`, 'some.key'),
    ];
    const report = validate(triples, makeRegistry([shape]), flatHierarchy);

    expect(report.conforms).toBe(true);
    expect(report.violations).toHaveLength(0);
    // explicitly: the synthetic uid: key must NOT appear as a focus node
    expect(report.violations.some((v) => v.focusNode.startsWith('uid:'))).toBe(false);
  });

  it('M2.2: a genuinely missing Setting_key still violates on the REAL subject (not the uid: key)', () => {
    const shape = makeShape({
      propertyIRI: `${EXO}Setting_key`,
      domain: [SETTING],
      minCount: 1,
    });
    const triples = [
      typeTriple(SUBJ, SETTING),
      // no Setting_key value at all
    ];
    const report = validate(triples, makeRegistry([shape]), flatHierarchy);

    expect(report.conforms).toBe(false);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].focusNode).toBe(SUBJ); // the real obsidian:// subject
    expect(report.violations[0].focusNode.startsWith('uid:')).toBe(false);
  });
});
