export type QueryType = "SELECT" | "CONSTRUCT" | "ASK" | "DESCRIBE";

export interface ASTNode {
  type: string;
}

export interface PrefixDeclaration {
  prefix: string;
  iri: string;
}

export interface Variable {
  termType: "Variable";
  value: string;
}

export interface IRI {
  termType: "NamedNode";
  value: string;
}

export interface Literal {
  termType: "Literal";
  value: string;
  language?: string;
  datatype?: IRI;
}

export interface BlankNode {
  termType: "BlankNode";
  value: string;
}

export type Term = Variable | IRI | Literal | BlankNode;

export interface TriplePattern {
  subject: Term;
  predicate: Term;
  object: Term;
}

export interface FilterExpression extends ASTNode {
  type: "filter";
  expression: Expression;
}

export interface Expression extends ASTNode {
  type: string;
  operator?: string;
  args?: Expression[];
  value?: string | number | boolean;
  variable?: string;
  function?: string;
}

export interface GraphPattern extends ASTNode {
  type: "bgp" | "group" | "optional" | "union" | "filter" | "bind" | "service";
  triples?: TriplePattern[];
  patterns?: GraphPattern[];
  expression?: Expression;
}

export interface Ordering {
  expression: Expression;
  descending?: boolean;
}

export interface SolutionModifier {
  distinct?: boolean;
  reduced?: boolean;
  limit?: number;
  offset?: number;
  order?: Ordering[];
}
