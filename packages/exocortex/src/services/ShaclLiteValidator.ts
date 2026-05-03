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

    if (predicateIRI === registry.typePredicateIRI) {
      if (obj.type === 'iri') {
        const classes = subjectClasses.get(subjectIRI) ?? [];
        classes.push(obj.value);
        subjectClasses.set(subjectIRI, classes);
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
            // Class range: value's class(es) must satisfy range via hierarchy
            const valueClasses = subjectClasses.get(obj.value) ?? [];
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
            // Datatype range: literal datatype must match declared range IRI
            const literalDatatype =
              obj.datatype ?? 'http://www.w3.org/2001/XMLSchema#string';
            const datatypeConforms = shape.range.some((r) => r === literalDatatype);
            if (!datatypeConforms) {
              violations.push({
                focusNode: subjectIRI,
                propertyPath: shape.propertyIRI,
                severity: shape.severity,
                message:
                  shape.message ??
                  `sh:datatype violation: literal "${obj.value}" has datatype <${literalDatatype}>, expected ${shape.range.join(' | ')}`,
                actualValue: obj.value,
                expectedRange: shape.range.join(' | '),
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
