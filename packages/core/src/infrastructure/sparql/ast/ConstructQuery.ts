import { ASTNode, PrefixDeclaration, TriplePattern, GraphPattern, SolutionModifier } from "./ASTNode";

export interface ConstructQuery extends ASTNode {
  type: "query";
  queryType: "CONSTRUCT";
  prefixes: PrefixDeclaration[];
  template: TriplePattern[];
  where: GraphPattern[];
  modifiers: SolutionModifier;
}
