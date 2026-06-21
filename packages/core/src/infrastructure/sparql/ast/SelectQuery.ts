import { ASTNode, PrefixDeclaration, Variable, GraphPattern, SolutionModifier } from "./ASTNode";

export interface SelectQuery extends ASTNode {
  type: "query";
  queryType: "SELECT";
  prefixes: PrefixDeclaration[];
  variables: Variable[] | ["*"];
  where: GraphPattern[];
  modifiers: SolutionModifier;
}
