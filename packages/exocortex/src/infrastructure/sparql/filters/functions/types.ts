import type { Subject, Predicate, Object as RDFObject } from "../../../../domain/models/rdf/Triple";

export type RDFTerm = Subject | Predicate | RDFObject;
