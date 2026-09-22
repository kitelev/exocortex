import type { IRI, Literal, Triple } from '../infrastructure/sparql/algebra/AlgebraOperation';
import { IRI as RdfIRI } from '../domain/models/rdf/IRI';

export type Severity = 'sh:Violation' | 'sh:Warning' | 'sh:Info';

export interface Shape {
  propertyIRI: string;
  domain: string[];
  range?: string[];
  cardinality?: 'Single' | 'Multiple';
  minCount?: number;
  severity: Severity;
  message?: string;
}

/** Which SHACL constraint produced a violation — enables precise post-filtering (e.g. the ExoSync open-world merge-gate skips `class` violations for unmounted refs). */
export type ViolationConstraint =
  | 'minCount'
  | 'maxCount'
  | 'class'
  | 'datatype'
  | 'unknown-property'
  // Two or more assets emit the SAME term IRI (their `exo__Asset_label` parses as
  // `<prefix>__<LocalName>`), so a join "predicate → its definition" resolves to
  // all of them. Reported as sh:Warning by `validate schema`; not produced by the
  // shape engine itself. req `00e8079e-fb36-4ce3-b33f-abb18c212143`.
  | 'term-iri-collision';

export interface Violation {
  focusNode: string;
  propertyPath: string;
  severity: Severity;
  message: string;
  constraint: ViolationConstraint;
  actualValue?: string;
  expectedRange?: string;
}

export interface ValidationReport {
  conforms: boolean;
  violations: Violation[];
}

export interface ClassHierarchy {
  isSubClassOf(child: string, parent: string): boolean;
}

export interface ValidatorOptions {
  /**
   * When true, any property predicate that has no registered shape emits sh:Warning.
   * CQ4 SPARQL shapes are the source of truth — the legacy validate-properties whitelist
   * file is deprecated in favour of this closed-world engine mode.
   */
  closedWorldMode?: boolean;
}

export class ShapeRegistry {
  private readonly shapeMap: Map<string, Shape>;
  readonly typePredicateIRI: string;

  constructor(
    shapes: Shape[] = [],
    typePredicateIRI = 'https://exocortex.my/ontology/exo#Instance_class',
  ) {
    this.shapeMap = new Map(shapes.map((s) => [s.propertyIRI, s]));
    this.typePredicateIRI = typePredicateIRI;
  }

  getShape(propertyIRI: string): Shape | undefined {
    return this.shapeMap.get(propertyIRI);
  }

  getAllShapes(): Shape[] {
    return Array.from(this.shapeMap.values());
  }

  hasShape(propertyIRI: string): boolean {
    return this.shapeMap.has(propertyIRI);
  }
}

// Standard W3C RDF type predicate. Treated as equivalent to the registry's
// `typePredicateIRI` (default `exo__Instance_class`) for class-membership
// purposes — see Issue ff3858e5 Fix 2: enum-instance wikilinks resolve via
// rdf:type, and sh:class constraints must accept that path.
const RDF_TYPE_IRI = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';

/**
 * IRI prefixes that represent external (non-vault) ontology resources.
 *
 * Two forms appear in practice:
 *
 * 1. **Canonical W3C IRIs** — when the Namespace resolver uses the real XSD/RDF/OWL/RDFS
 *    base URIs (e.g. `http://www.w3.org/2001/XMLSchema#Date`).
 *
 * 2. **Exocortex ad-hoc IRIs** — when `Namespace.forPrefix` falls back to the ad-hoc
 *    convention `https://exocortex.my/ontology/<prefix>#` for prefixes that are not in
 *    the static whitelist (`KNOWN_NAMESPACES` in Namespace.ts).
 *
 *    ⛤ As of req `aceaa2cc-15b6-4e1c-bf63-72c7c209de51` the five W3C prefixes
 *    (`rdf`, `rdfs`, `owl`, `xsd`, `sh`) ARE whitelisted, so freshly-emitted
 *    triples use form 1. The ad-hoc entries below remain for LEGACY data — a
 *    store built before that change, or a serialized graph persisted then:
 *      • `xsd__Date`  → `https://exocortex.my/ontology/xsd#Date`
 *      • `rdf__Statement` → `https://exocortex.my/ontology/rdf#Statement`
 *      • `rdfs__Resource` → `https://exocortex.my/ontology/rdfs#Resource`
 *      • `owl__ObjectProperty` → `https://exocortex.my/ontology/owl#ObjectProperty`
 *
 * None of these are vault assets — they will never appear in `subjectClasses`.
 * An sh:class range check against them always produces a false-positive violation.
 * We skip the check for any value IRI matching these prefixes.
 *
 * See: fix(shacl): allowlist external ontology IRIs — 5 false-positive violations
 */
const EXTERNAL_ONTOLOGY_IRI_PREFIXES: readonly string[] = [
  // Canonical W3C IRIs
  'http://www.w3.org/2001/XMLSchema#',            // xsd (canonical)
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#',  // rdf (canonical)
  'http://www.w3.org/2000/01/rdf-schema#',         // rdfs (canonical)
  'http://www.w3.org/2002/07/owl#',                // owl (canonical)
  'http://www.w3.org/ns/shacl#',                   // sh (canonical)
  'http://www.w3.org/2004/02/skos/core#',          // skos
  'http://purl.org/dc/elements/1.1/',              // dc
  'http://purl.org/dc/terms/',                     // dcterms
  'http://xmlns.com/foaf/0.1/',                    // foaf
  'https://schema.org/',                           // schema.org
  // Exocortex ad-hoc IRIs for the same external namespaces
  // (produced by Namespace.forPrefix fallback when prefix is not in KNOWN_NAMESPACES)
  'https://exocortex.my/ontology/xsd#',            // xsd__ → ad-hoc
  'https://exocortex.my/ontology/rdf#',            // rdf__ → ad-hoc
  'https://exocortex.my/ontology/rdfs#',           // rdfs__ → ad-hoc
  'https://exocortex.my/ontology/owl#',            // owl__ → ad-hoc
  'https://exocortex.my/ontology/skos#',           // skos__ → ad-hoc
];

/**
 * Returns true when `iri` belongs to a well-known external ontology that is not
 * represented as vault assets. Such IRIs are exempt from sh:class range checks.
 */
function isExternalOntologyIRI(iri: string): boolean {
  return EXTERNAL_ONTOLOGY_IRI_PREFIXES.some((prefix) => iri.startsWith(prefix));
}

/**
 * XSD datatype IRI prefixes — both canonical W3C and Exocortex ad-hoc forms.
 * Range entries with these prefixes are sh:datatype constraints (apply to Literals).
 * All other range entries are sh:class constraints (apply to IRI nodes only).
 */
const XSD_DATATYPE_PREFIXES: readonly string[] = [
  'http://www.w3.org/2001/XMLSchema#',
  'https://exocortex.my/ontology/xsd#',
];

function isXSDDatatypeIRI(iri: string): boolean {
  return XSD_DATATYPE_PREFIXES.some((prefix) => iri.startsWith(prefix));
}

/** Local name of an XSD datatype IRI in either accepted prefix form; null otherwise. */
function xsdLocalName(iri: string): string | null {
  for (const prefix of XSD_DATATYPE_PREFIXES) {
    if (iri.startsWith(prefix)) return iri.substring(prefix.length);
  }
  return null;
}

const XSD_DECIMAL = 'http://www.w3.org/2001/XMLSchema#decimal';
const XSD_INTEGER = 'http://www.w3.org/2001/XMLSchema#integer';
const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string';

const INTEGER_LEXICAL = /^[+-]?\d+$/;
const NON_NEGATIVE_INTEGER_LEXICAL = /^\+?\d+$/;
const DECIMAL_LEXICAL = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;
const FLOAT_LEXICAL = /^([+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?|[+-]?INF|NaN)$/;

/**
 * Lexical spaces (XSD 1.1 §3.3, the subset a YAML number can denote) that a
 * NUMBER-TAGGED literal (`xsd:integer` or `xsd:decimal` — the two tags
 * NoteToRDFConverter emits for a YAML number, ticket d5ad5217) may satisfy by
 * its lexical form. Keyed by the expected datatype's local name; a datatype
 * absent here keeps strict tag equality for a NUMBER tag (e.g. xsd:string,
 * xsd:dateTime, xsd:anyURI — a number under xsd:anyURI is a violation). The
 * STRING tag has its own two excuses below: xsd:boolean and xsd:anyURI.
 */
const DECIMAL_TAG_LEXICAL: Readonly<Record<string, RegExp>> = {
  integer: INTEGER_LEXICAL,
  long: INTEGER_LEXICAL,
  int: INTEGER_LEXICAL,
  short: INTEGER_LEXICAL,
  byte: INTEGER_LEXICAL,
  nonNegativeInteger: NON_NEGATIVE_INTEGER_LEXICAL,
  unsignedLong: NON_NEGATIVE_INTEGER_LEXICAL,
  unsignedInt: NON_NEGATIVE_INTEGER_LEXICAL,
  unsignedShort: NON_NEGATIVE_INTEGER_LEXICAL,
  unsignedByte: NON_NEGATIVE_INTEGER_LEXICAL,
  positiveInteger: /^\+?0*[1-9]\d*$/,
  nonPositiveInteger: /^(-\d+|\+?0+)$/,
  negativeInteger: /^-0*[1-9]\d*$/,
  decimal: DECIMAL_LEXICAL,
  float: FLOAT_LEXICAL,
  double: FLOAT_LEXICAL,
  gYear: /^-?\d{4,}(Z|[+-]\d{2}:\d{2})?$/,
};

const BOOLEAN_LEXICAL = /^(true|false)$/;

/**
 * sh:datatype conformance of a literal (ticket a9b55ead; integer tag d5ad5217).
 *
 * A YAML frontmatter scalar carries no datatype: NoteToRDFConverter tags a
 * whole YAML number `xsd:integer` and a fractional one `xsd:decimal`
 * (`pmi__Principle_number: 7` → `"7"^^xsd:integer`, `7.5` → `"7.5"^^xsd:decimal`;
 * parity with the JSON-LD parser, founder decision 2026-09-19), and a YAML
 * boolean as a plain literal (`"true"^^xsd:string`). Those tags are a
 * converter artefact, not the author's declaration — the declared range is.
 * So, ONLY where the tag is that artefact, the literal conforms when its
 * LEXICAL form is valid for the expected datatype:
 *   - tag xsd:integer / xsd:decimal + expected numeric family / gYear → lexical check
 *   - tag xsd:string   + expected xsd:boolean            → `true` | `false`
 *   - tag xsd:string   + expected xsd:anyURI             → `IRI.isValidIRI(value)`
 *     (ticket e55b0a07, amendment of req b0ad1160 under the same founder rule:
 *     the converter tags EVERY YAML string xsd:string, so an anyURI range was
 *     unreachable by construction). The lexicon is core's single IRI notion —
 *     an ABSOLUTE IRI: non-empty, no whitespace, scheme in the core allowlist,
 *     WHATWG-parseable or `urn:`. Relative references, empty strings and
 *     schemes outside the allowlist are violations — deliberately stricter
 *     than XSD 1.1 §3.3.17, whose lexical space admits any string.
 * Every other pairing keeps strict tag equality (W3C SHACL semantics): an ISO
 * string tagged xsd:dateTime under xsd:date, a quoted "10" (xsd:string) under
 * xsd:integer, a number under xsd:string and a number under xsd:anyURI are
 * still violations.
 */
function literalConformsToDatatype(
  value: string,
  literalDatatype: string,
  expected: string,
): boolean {
  if (literalDatatype === expected) return true;
  const local = xsdLocalName(expected);
  if (local === null) return false;
  if (literalDatatype === XSD_DECIMAL || literalDatatype === XSD_INTEGER) {
    const lexical = DECIMAL_TAG_LEXICAL[local];
    return lexical !== undefined && lexical.test(value);
  }
  if (literalDatatype === XSD_STRING && local === 'boolean') {
    return BOOLEAN_LEXICAL.test(value);
  }
  if (literalDatatype === XSD_STRING && local === 'anyURI') {
    return RdfIRI.isValidIRI(value);
  }
  return false;
}

/**
 * Extract bare UUID from a vault subject IRI of the form
 * `obsidian://vault/.../<uuid>.md` or `obsidian://vault/<uuid>.md`.
 *
 * Returns the lowercase UUID string when the IRI ends with `<uuid>.md`,
 * otherwise null. Used to build a secondary UID-keyed index of subject
 * classes so that cross-vault wikilink references resolve regardless of
 * whether the producing converter saw the file at its full vault path
 * (`obsidian://vault/assetspaces/.../<uid>.md`) or only as a synthesized
 * UUID-only IRI (`obsidian://vault/<uid>.md`) emitted when the wikilink
 * target lives outside the converter's own vault scope.
 */
const UID_SUFFIX_RE =
  /\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.md$/i;

export function extractUidFromIRI(iri: string): string | null {
  const m = UID_SUFFIX_RE.exec(iri);
  return m ? m[1].toLowerCase() : null;
}

export function validate(
  triples: Triple[],
  registry: ShapeRegistry,
  hierarchy: ClassHierarchy,
  options?: ValidatorOptions,
): ValidationReport {
  const subjectClasses = new Map<string, string[]>();
  const subjectProps = new Map<string, Map<string, Array<IRI | Literal>>>();

  for (const triple of triples) {
    const { subject, predicate, object } = triple;

    if (subject.type !== 'iri' || predicate.type !== 'iri') continue;
    if (object.type !== 'iri' && object.type !== 'literal') continue;

    const subjectIRI = subject.value;
    const predicateIRI = predicate.value;
    const obj = object as IRI | Literal;

    const isTypePredicate =
      predicateIRI === registry.typePredicateIRI ||
      predicateIRI === RDF_TYPE_IRI;

    if (isTypePredicate) {
      if (obj.type === 'iri') {
        const classes = subjectClasses.get(subjectIRI) ?? [];
        classes.push(obj.value);
        subjectClasses.set(subjectIRI, classes);
        // Secondary UID-keyed index: lets cross-vault wikilink targets
        // (synthesized as `obsidian://vault/<uid>.md` without directory)
        // resolve to the class set indexed by the full-path subject IRI
        // produced by the owning vault's converter.
        const uid = extractUidFromIRI(subjectIRI);
        if (uid) {
          const uidKey = `uid:${uid}`;
          const uidClasses = subjectClasses.get(uidKey) ?? [];
          uidClasses.push(obj.value);
          subjectClasses.set(uidKey, uidClasses);
        }
      }
    } else {
      let props = subjectProps.get(subjectIRI);
      if (!props) {
        props = new Map();
        subjectProps.set(subjectIRI, props);
      }
      const values = props.get(predicateIRI) ?? [];
      values.push(obj);
      props.set(predicateIRI, values);
    }
  }

  const violations: Violation[] = [];
  const allSubjects = new Set([...subjectClasses.keys(), ...subjectProps.keys()]);

  for (const subjectIRI of allSubjects) {
    // Issue #3488 M2: `uid:<uuid>` keys are SYNTHETIC value-class join keys
    // (added above so a cross-vault wikilink value `obsidian://vault/<uid>.md`
    // resolves to the class set indexed under the owning vault's full-path
    // subject IRI). They never carry property triples, so iterating them as
    // focus subjects produces a phantom `sh:minCount` violation for every
    // required property of their class — the real `obsidian://…/<uid>.md`
    // subject (always present alongside; see the type-predicate branch above)
    // carries the actual properties and is the proper focus node.
    if (subjectIRI.startsWith('uid:')) continue;

    const classes = subjectClasses.get(subjectIRI) ?? [];
    const props = subjectProps.get(subjectIRI) ?? new Map<string, Array<IRI | Literal>>();

    for (const shape of registry.getAllShapes()) {
      const appliesToSubject =
        shape.domain.length === 0 ||
        shape.domain.some((domainClass) =>
          classes.some(
            (sc) => sc === domainClass || hierarchy.isSubClassOf(sc, domainClass),
          ),
        );
      if (!appliesToSubject) continue;

      const values = props.get(shape.propertyIRI) ?? [];

      // sh:minCount check
      if (shape.minCount !== undefined && shape.minCount > 0 && values.length < shape.minCount) {
        violations.push({
          focusNode: subjectIRI,
          propertyPath: shape.propertyIRI,
          severity: shape.severity,
          constraint: 'minCount',
          message:
            shape.message ??
            `sh:minCount violation: expected at least ${shape.minCount} value(s) for <${shape.propertyIRI}>`,
        });
        continue;
      }

      if (values.length === 0) continue;

      // sh:maxCount=1 check (cardinality=Single)
      if (shape.cardinality === 'Single' && values.length > 1) {
        violations.push({
          focusNode: subjectIRI,
          propertyPath: shape.propertyIRI,
          severity: shape.severity,
          constraint: 'maxCount',
          message:
            shape.message ??
            `sh:maxCount violation: expected at most 1 value for <${shape.propertyIRI}>, got ${values.length}`,
        });
        continue;
      }

      // sh:class / sh:datatype range check
      if (shape.range && shape.range.length > 0) {
        for (const obj of values) {
          if (obj.type === 'iri') {
            // External ontology IRIs (xsd, rdf, rdfs, owl, …) are not vault assets
            // and are never registered in subjectClasses. Skip the sh:class check for
            // them — they are authoritative by definition (fix: 5 external IRI violations).
            if (isExternalOntologyIRI(obj.value)) continue;
            // Mirror of the Literal branch below. A range entry naming an XSD
            // datatype expresses `sh:datatype`, which by SHACL semantics
            // constrains *Literal* nodes only (see XSD_DATATYPE_PREFIXES: "All
            // other range entries are sh:class constraints (apply to IRI nodes
            // only)"). Judging an IRI against such an entry as if it were a
            // class asks whether the value is an instance of `xsd:string`,
            // which no well-formed vault asset can be — so for well-formed
            // data the check had no reachable green outcome.
            //
            // ⛔ Not "no green outcome for ANY data", which an earlier revision
            // of this comment claimed: a subject whose own `exo__Instance_class`
            // points at a datatype IRI makes `vc === expectedClass` true, and
            // the pre-fix branch did go green there (measured, PR #4304 review).
            // That input is corrupt, and both revisions treat it identically —
            // the claim was wrong, the conclusion was not.
            //
            // It would also blame the wrong actor: the node kind here is not
            // authored but INFERRED. The converter expands a bare
            // `prefix__Name` string into a symbolic IRI without consulting the
            // declared range (`valueToRDFObject` → `isClassReference`), so an
            // IRI under a datatype-only range says nothing about what the
            // author actually wrote. Issue #4268.
            const classRanges = shape.range.filter((r) => !isXSDDatatypeIRI(r));
            // ⚠ Accepted consequence: an IRI value under a datatype-only range
            // now yields no signal at all — including a genuinely dangling
            // reference, which used to surface as the `unresolvable-ref`
            // warning below. That warning was a side effect of a class check
            // that does not apply here; the dangling-reference signal for such
            // predicates belongs with the TBox fix (#4305), not here.
            if (classRanges.length === 0) continue;
            // Class range: value's class(es) must satisfy range via hierarchy.
            // Direct lookup first; if it misses and the value IRI ends with a
            // UUID-named markdown file, fall back to the UID-keyed index so
            // cross-vault synth IRIs (`obsidian://vault/<uid>.md` without dir)
            // join with full-path subject IRIs produced by another vault's
            // converter for the same underlying asset.
            let valueClasses = subjectClasses.get(obj.value) ?? [];
            if (valueClasses.length === 0) {
              const uid = extractUidFromIRI(obj.value);
              if (uid) {
                valueClasses = subjectClasses.get(`uid:${uid}`) ?? [];
              }
            }
            // R13: ANY-of semantics — any value class matching any range class satisfies
            const rangeConforms = classRanges.some((expectedClass) =>
              valueClasses.some(
                (vc) => vc === expectedClass || hierarchy.isSubClassOf(vc, expectedClass),
              ),
            );
            if (!rangeConforms) {
              // Issue #3488 M1/M4b/M5: distinguish a genuine wrong-class violation
              // from an *unresolvable reference*. When the value node has NO
              // resolvable type in this store (`valueClasses` empty after the
              // direct + uid-twin lookups above) we cannot — under open-world
              // semantics — assert that it violates the class constraint. This
              // happens for cross-vault targets, targets whose own class
              // definition lives cross-vault (so they carry no rdf:type here),
              // symbolic property-IRIs with no backing subject, and Exo003
              // anchor files. Emit `sh:Warning` (does NOT break conformance /
              // exit code) instead of a false `sh:Violation`. A value that IS a
              // typed subject whose class genuinely does not conform keeps the
              // shape's (Violation) severity.
              const unresolvableRef = valueClasses.length === 0;
              violations.push({
                focusNode: subjectIRI,
                propertyPath: shape.propertyIRI,
                severity: unresolvableRef ? 'sh:Warning' : shape.severity,
                constraint: 'class',
                message: unresolvableRef
                  ? `sh:class unresolvable-ref: <${obj.value}> has no resolvable type in this vault (cross-vault, symbolic, or external reference); not validated against ${classRanges.join(' | ')}`
                  : shape.message ??
                    `sh:class violation: <${obj.value}> does not conform to expected class ${classRanges.join(' | ')}`,
                actualValue: obj.value,
                expectedRange: classRanges.join(' | '),
              });
            }
          } else if (obj.type === 'literal') {
            // sh:datatype constraints apply only to range entries that are XSD datatypes.
            // Class-IRI range entries express sh:class — by SHACL semantics they
            // constrain non-Literal nodes only. Skip them silently for Literals.
            //
            // This also tolerates dual-storage predicates (Issue #2102) such as
            // exo__Asset_prototype, where the converter intentionally emits both
            // an IRI (for sh:class targets) and a UUID Literal (for raw-UUID SPARQL
            // lookup). Without this distinction the Literal triggered a false
            // sh:datatype violation against an exo:Asset class range (Issue #3115).
            const datatypeRanges = shape.range.filter((r) => isXSDDatatypeIRI(r));
            if (datatypeRanges.length === 0) continue;
            const literalDatatype =
              obj.datatype ?? 'http://www.w3.org/2001/XMLSchema#string';
            const datatypeConforms = datatypeRanges.some((r) =>
              literalConformsToDatatype(obj.value, literalDatatype, r),
            );
            if (!datatypeConforms) {
              violations.push({
                focusNode: subjectIRI,
                propertyPath: shape.propertyIRI,
                severity: shape.severity,
                constraint: 'datatype',
                message:
                  shape.message ??
                  `sh:datatype violation: literal "${obj.value}" has datatype <${literalDatatype}>, expected ${datatypeRanges.join(' | ')}`,
                actualValue: obj.value,
                expectedRange: datatypeRanges.join(' | '),
              });
            }
          }
        }
      }
    }
  }

  if (options?.closedWorldMode) {
    for (const subjectIRI of allSubjects) {
      const props = subjectProps.get(subjectIRI) ?? new Map<string, Array<IRI | Literal>>();
      for (const predicateIRI of props.keys()) {
        if (!registry.hasShape(predicateIRI)) {
          violations.push({
            focusNode: subjectIRI,
            propertyPath: predicateIRI,
            severity: 'sh:Warning',
            constraint: 'unknown-property',
            message: `Unknown property: <${predicateIRI}> has no registered shape`,
          });
        }
      }
    }
  }

  violations.sort((a, b) => {
    const c = a.focusNode.localeCompare(b.focusNode);
    return c !== 0 ? c : a.propertyPath.localeCompare(b.propertyPath);
  });

  return {
    conforms: !violations.some((v) => v.severity === 'sh:Violation'),
    violations,
  };
}
