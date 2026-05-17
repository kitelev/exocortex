import type { IRI, Literal, Triple } from '../infrastructure/sparql/algebra/AlgebraOperation';

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

export interface Violation {
  focusNode: string;
  propertyPath: string;
  severity: Severity;
  message: string;
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
 *    the static whitelist (`KNOWN_NAMESPACES` in Namespace.ts). This currently affects
 *    `xsd__`, `rdf__`, `rdfs__`, `owl__` keys in vault frontmatter:
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

function extractUid(iri: string): string | null {
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
        const uid = extractUid(subjectIRI);
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
            // Class range: value's class(es) must satisfy range via hierarchy.
            // Direct lookup first; if it misses and the value IRI ends with a
            // UUID-named markdown file, fall back to the UID-keyed index so
            // cross-vault synth IRIs (`obsidian://vault/<uid>.md` without dir)
            // join with full-path subject IRIs produced by another vault's
            // converter for the same underlying asset.
            let valueClasses = subjectClasses.get(obj.value) ?? [];
            if (valueClasses.length === 0) {
              const uid = extractUid(obj.value);
              if (uid) {
                valueClasses = subjectClasses.get(`uid:${uid}`) ?? [];
              }
            }
            // R13: ANY-of semantics — any value class matching any range class satisfies
            const rangeConforms = shape.range.some((expectedClass) =>
              valueClasses.some(
                (vc) => vc === expectedClass || hierarchy.isSubClassOf(vc, expectedClass),
              ),
            );
            if (!rangeConforms) {
              violations.push({
                focusNode: subjectIRI,
                propertyPath: shape.propertyIRI,
                severity: shape.severity,
                message:
                  shape.message ??
                  `sh:class violation: <${obj.value}> does not conform to expected class ${shape.range.join(' | ')}`,
                actualValue: obj.value,
                expectedRange: shape.range.join(' | '),
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
            const datatypeConforms = datatypeRanges.some((r) => r === literalDatatype);
            if (!datatypeConforms) {
              violations.push({
                focusNode: subjectIRI,
                propertyPath: shape.propertyIRI,
                severity: shape.severity,
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
