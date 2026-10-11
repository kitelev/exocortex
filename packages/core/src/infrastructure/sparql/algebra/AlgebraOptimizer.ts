import type {
  AlgebraOperation,
  FilterOperation,
  JoinOperation,
  Expression,
} from "./AlgebraOperation";
import {
  FilterContainsOptimizer,
  OptimizationHint,
} from "../optimization/FilterContainsOptimizer";
import type { ITripleStore } from "../../../interfaces/ITripleStore";

export interface OptimizationStats {
  tripleCount: number;
  selectivity: number;
}

export class AlgebraOptimizer {
  private stats: Map<string, OptimizationStats> = new Map();
  private filterContainsOptimizer: FilterContainsOptimizer;
  private tripleStore: ITripleStore | null = null;

  constructor() {
    this.filterContainsOptimizer = new FilterContainsOptimizer();
  }

  /**
   * Set the triple store for UUID index lookups during optimization.
   * When set, FILTER(CONTAINS(STR(?s), 'uuid')) patterns can be optimized
   * using O(1) index lookup instead of O(n) scan.
   */
  setTripleStore(store: ITripleStore): void {
    this.tripleStore = store;
    this.filterContainsOptimizer.setTripleStore(store);
  }

  /**
   * Get optimization hints from the last optimization run.
   * Useful for --explain mode to show users what optimizations are possible.
   */
  getOptimizationHints(): OptimizationHint[] {
    return this.filterContainsOptimizer.getLastOptimizationHints();
  }

  /**
   * Analyze a query for potential optimizations without applying them.
   * Returns hints about what optimizations could be applied.
   */
  analyzeQuery(operation: AlgebraOperation): OptimizationHint[] {
    return this.filterContainsOptimizer.analyzeQuery(operation);
  }

  optimize(operation: AlgebraOperation): AlgebraOperation {
    let optimized = operation;

    // First pass: eliminate empty BGPs in joins with filters
    optimized = this.eliminateEmptyBGPInFilterJoin(optimized);

    optimized = this.filterPushDown(optimized);

    optimized = this.joinReordering(optimized);

    return optimized;
  }

  /**
   * Async version of optimize that can perform UUID index lookups.
   * Use this when you have a triple store set and want FILTER(CONTAINS())
   * optimizations to use the index.
   */
  async optimizeAsync(operation: AlgebraOperation): Promise<AlgebraOperation> {
    let optimized = operation;

    // First pass: eliminate empty BGPs in joins with filters
    optimized = this.eliminateEmptyBGPInFilterJoin(optimized);

    // Optimize FILTER(CONTAINS()) patterns using UUID index
    if (this.tripleStore) {
      optimized = await this.filterContainsOptimizer.optimize(optimized);
    }

    optimized = this.filterPushDown(optimized);

    optimized = this.joinReordering(optimized);

    return optimized;
  }

  /**
   * Synchronous version with subject URIs for FILTER(CONTAINS()) optimization.
   * Use when you have pre-fetched subject URIs.
   */
  optimizeWithSubjects(operation: AlgebraOperation, subjectUris: string[]): AlgebraOperation {
    let optimized = operation;

    // First pass: eliminate empty BGPs in joins with filters
    optimized = this.eliminateEmptyBGPInFilterJoin(optimized);

    // Optimize FILTER(CONTAINS()) patterns using provided subjects
    optimized = this.filterContainsOptimizer.optimizeSync(optimized, subjectUris);

    optimized = this.filterPushDown(optimized);

    optimized = this.joinReordering(optimized);

    return optimized;
  }

  /**
   * Eliminates patterns like Join(Filter(emptyBGP, expr), BGP)
   * which sparqljs creates for inline FILTER syntax.
   * Rewrites to: Filter(BGP, expr)
   */
  private eliminateEmptyBGPInFilterJoin(operation: AlgebraOperation): AlgebraOperation {
    if (operation.type === "join") {
      // Check for Join(Filter(emptyBGP), anything)
      if (operation.left.type === "filter") {
        const leftFilter = operation.left;
        if (leftFilter.input.type === "bgp" && leftFilter.input.triples.length === 0) {
          // Rewrite: Join(Filter(emptyBGP, expr), right) → Filter(right, expr)
          return {
            type: "filter",
            expression: leftFilter.expression,
            input: this.eliminateEmptyBGPInFilterJoin(operation.right),
          };
        }
      }

      // Check for Join(anything, Filter(emptyBGP))
      if (operation.right.type === "filter") {
        const rightFilter = operation.right;
        if (rightFilter.input.type === "bgp" && rightFilter.input.triples.length === 0) {
          // Rewrite: Join(left, Filter(emptyBGP, expr)) → Filter(left, expr)
          return {
            type: "filter",
            expression: rightFilter.expression,
            input: this.eliminateEmptyBGPInFilterJoin(operation.left),
          };
        }
      }

      // No empty BGP pattern found, recurse
      return {
        type: "join",
        left: this.eliminateEmptyBGPInFilterJoin(operation.left),
        right: this.eliminateEmptyBGPInFilterJoin(operation.right),
      };
    }

    // Recurse into other operation types
    if (operation.type === "filter") {
      return {
        ...operation,
        input: this.eliminateEmptyBGPInFilterJoin(operation.input),
      };
    }

    if (operation.type === "leftjoin") {
      return {
        ...operation,
        left: this.eliminateEmptyBGPInFilterJoin(operation.left),
        right: this.eliminateEmptyBGPInFilterJoin(operation.right),
      };
    }

    if (operation.type === "union") {
      return {
        ...operation,
        left: this.eliminateEmptyBGPInFilterJoin(operation.left),
        right: this.eliminateEmptyBGPInFilterJoin(operation.right),
      };
    }

    if (operation.type === "minus") {
      return {
        ...operation,
        left: this.eliminateEmptyBGPInFilterJoin(operation.left),
        right: this.eliminateEmptyBGPInFilterJoin(operation.right),
      };
    }

    if (operation.type === "project") {
      return {
        ...operation,
        input: this.eliminateEmptyBGPInFilterJoin(operation.input),
      };
    }

    if (operation.type === "orderby") {
      return {
        ...operation,
        input: this.eliminateEmptyBGPInFilterJoin(operation.input),
      };
    }

    if (operation.type === "slice") {
      return {
        ...operation,
        input: this.eliminateEmptyBGPInFilterJoin(operation.input),
      };
    }

    if (operation.type === "distinct") {
      return {
        ...operation,
        input: this.eliminateEmptyBGPInFilterJoin(operation.input),
      };
    }

    return operation;
  }

  filterPushDown(operation: AlgebraOperation): AlgebraOperation {
    if (operation.type === "filter") {
      return this.pushDownFilter(operation);
    }

    if (operation.type === "join") {
      return {
        type: "join",
        left: this.filterPushDown(operation.left),
        right: this.filterPushDown(operation.right),
      };
    }

    if (operation.type === "leftjoin") {
      return {
        ...operation,
        left: this.filterPushDown(operation.left),
        right: this.filterPushDown(operation.right),
      };
    }

    if (operation.type === "union") {
      return {
        type: "union",
        left: this.filterPushDown(operation.left),
        right: this.filterPushDown(operation.right),
      };
    }

    if (operation.type === "minus") {
      return {
        ...operation,
        left: this.filterPushDown(operation.left),
        right: this.filterPushDown(operation.right),
      };
    }

    if (operation.type === "project") {
      return {
        ...operation,
        input: this.filterPushDown(operation.input),
      };
    }

    if (operation.type === "orderby") {
      return {
        ...operation,
        input: this.filterPushDown(operation.input),
      };
    }

    if (operation.type === "slice") {
      return {
        ...operation,
        input: this.filterPushDown(operation.input),
      };
    }

    if (operation.type === "distinct") {
      return {
        ...operation,
        input: this.filterPushDown(operation.input),
      };
    }

    return operation;
  }

  private pushDownFilter(filter: FilterOperation): AlgebraOperation {
    const input = filter.input;

    // ⛔ A filter with EXISTS stays above the join: its pattern reads variables the
    // expression walk does not see (the pattern's own), so neither side can be
    // proven to bind them all (PR #4557 review round 3, H2).
    if (input.type === "join" && !this.expressionContainsExists(filter.expression)) {
      const filterVars = this.getFilterVariables(filter.expression);
      const leftVars = this.getOperationVariables(input.left);
      const rightVars = this.getOperationVariables(input.right);

      const leftOnly = filterVars.every((v) => leftVars.has(v));
      const rightOnly = filterVars.every((v) => rightVars.has(v));

      // ⛔ Symmetric to the right-push guard below: only when NO filter variable can
      // be bound on the right. A filter pushed left onto a variable the right side
      // shares is moved to the RIGHT of a bind join by the later join reordering
      // (constrained side first), and the substituted IRI then drops every row (bug
      // 4e3ce943). With no shared variable the filter reads the same bindings before
      // and after the join, whichever side ends up on the left (PR #4557 review round
      // 4, HIGH-1: `{ ?s label ?l . ?s ?p ?o } { ?s a C } FILTER(?s IN (…))` → 0).
      if (leftOnly && !rightOnly && !filterVars.some((v) => rightVars.has(v))) {
        return {
          type: "join",
          left: {
            type: "filter",
            expression: filter.expression,
            input: this.filterPushDown(input.left),
          },
          right: this.filterPushDown(input.right),
        };
      }

      // ⛔ Only when NO filter variable is bound on the left: the bind join
      // substitutes the left solution into the right operand, filter expression
      // included, and a substituted IRI is not an evaluable expression node — the
      // filter then drops every row (`?s != ?o` with ?s shared; bug 4e3ce943). A
      // positional BIND made this shape common (PR #4557 review round 2, HIGH).
      if (rightOnly && !leftOnly && !filterVars.some((v) => leftVars.has(v))) {
        return {
          type: "join",
          left: this.filterPushDown(input.left),
          right: {
            type: "filter",
            expression: filter.expression,
            input: this.filterPushDown(input.right),
          },
        };
      }

      return {
        type: "filter",
        expression: filter.expression,
        input: {
          type: "join",
          left: this.filterPushDown(input.left),
          right: this.filterPushDown(input.right),
        },
      };
    }

    if (input.type === "union") {
      return {
        type: "union",
        left: {
          type: "filter",
          expression: filter.expression,
          input: this.filterPushDown(input.left),
        },
        right: {
          type: "filter",
          expression: filter.expression,
          input: this.filterPushDown(input.right),
        },
      };
    }

    return {
      type: "filter",
      expression: filter.expression,
      input: this.filterPushDown(input),
    };
  }

  /**
   * Every variable the expression reads. ⛔ It walks EVERY expression node that
   * holds sub-expressions — arithmetic, raw function calls and IN included: a
   * variable it misses is invisible to the pushdown guard, so a filter reading a
   * positional BIND inside `?window * 1` was pushed to the side where that BIND is
   * unbound and dropped every row (PR #4557 review round 3, H2: 0 rows instead of
   * 52). EXISTS is not walked here — `pushDownFilter` keeps such a filter above
   * the join (`expressionContainsExists`).
   */
  private getFilterVariables(expr: Expression): string[] {
    const vars: string[] = [];

    if (expr.type === "variable") {
      vars.push(expr.name);
    } else if (expr.type === "comparison" || expr.type === "arithmetic") {
      vars.push(...this.getFilterVariables(expr.left));
      vars.push(...this.getFilterVariables(expr.right));
    } else if (expr.type === "logical") {
      for (const operand of expr.operands) {
        vars.push(...this.getFilterVariables(operand));
      }
    } else if (expr.type === "function" || expr.type === "functionCall") {
      for (const arg of expr.args) {
        vars.push(...this.getFilterVariables(arg));
      }
    } else if (expr.type === "in") {
      vars.push(...this.getFilterVariables(expr.expression));
      for (const item of expr.list) {
        vars.push(...this.getFilterVariables(item));
      }
    }

    return Array.from(new Set(vars));
  }

  /** Whether an EXISTS / NOT EXISTS sits anywhere in the expression tree. */
  private expressionContainsExists(expr: Expression): boolean {
    switch (expr.type) {
      case "exists":
        return true;
      case "comparison":
      case "arithmetic":
        return this.expressionContainsExists(expr.left) || this.expressionContainsExists(expr.right);
      case "logical":
        return expr.operands.some((operand) => this.expressionContainsExists(operand));
      case "function":
      case "functionCall":
        return expr.args.some((arg) => this.expressionContainsExists(arg));
      case "in":
        return (
          this.expressionContainsExists(expr.expression) ||
          expr.list.some((item) => this.expressionContainsExists(item))
        );
      default:
        return false;
    }
  }

  /**
   * The variables an operand can bind. ⛔ It must OVER-approximate: the pushdown
   * guards read it as "the other side cannot bind this variable", so a type that
   * reports too few (VALUES, a subquery, LATERAL, GRAPH — once an empty set) sends a
   * filter to the side where the bind join substitutes an IRI into it and every row
   * is dropped (PR #4557 review round 4, HIGH-1). Over-approximating the operand's
   * OWN side is harmless: a variable no side binds reads the same unbound value
   * before and after the join.
   */
  private getOperationVariables(operation: AlgebraOperation): Set<string> {
    const vars = new Set<string>();

    if (operation.type === "bgp") {
      for (const triple of operation.triples) {
        if (triple.subject.type === "variable") vars.add(triple.subject.value);
        if (triple.predicate.type === "variable") vars.add(triple.predicate.value);
        if (triple.object.type === "variable") vars.add(triple.object.value);
      }
    } else if (operation.type === "join") {
      const leftVars = this.getOperationVariables(operation.left);
      const rightVars = this.getOperationVariables(operation.right);
      return new Set([...leftVars, ...rightVars]);
    } else if (operation.type === "filter") {
      return this.getOperationVariables(operation.input);
    } else if (operation.type === "leftjoin") {
      const leftVars = this.getOperationVariables(operation.left);
      const rightVars = this.getOperationVariables(operation.right);
      return new Set([...leftVars, ...rightVars]);
    } else if (operation.type === "union") {
      const leftVars = this.getOperationVariables(operation.left);
      const rightVars = this.getOperationVariables(operation.right);
      return new Set([...leftVars, ...rightVars]);
    } else if (operation.type === "minus") {
      // MINUS: variables from left side (right side only used for filtering)
      return this.getOperationVariables(operation.left);
    } else if (operation.type === "project") {
      return new Set(operation.variables);
    } else if (operation.type === "extend") {
      // A BIND keeps every variable of its input and adds its own (req 60ed88e7).
      // ⛔ Without this branch a positional BIND on the left of a join reported NO
      // variables, so a group FILTER on a shared variable was pushed into the right
      // operand alone; the bind join then substituted an IRI into the filter
      // expression and every row was dropped (PR #4557 review, CRITICAL).
      const inner = this.getOperationVariables(operation.input);
      inner.add(operation.variable);
      return inner;
    } else if (operation.type === "values") {
      return new Set(operation.variables);
    } else if (operation.type === "subquery") {
      // What the subquery projects (under its solution modifiers); `SELECT *` has
      // no project node and falls back to every variable it mentions.
      let node: AlgebraOperation = operation.query;
      while (node.type === "slice" || node.type === "distinct" || node.type === "reduced" || node.type === "orderby") {
        node = node.input;
      }
      return node.type === "project" ? new Set(node.variables) : this.mentionedVariables(operation.query);
    } else {
      // GRAPH, SERVICE, LATERAL, GROUP, … — every variable mentioned anywhere below.
      return this.mentionedVariables(operation);
    }

    // bgp
    return vars;
  }

  /** Every variable name mentioned anywhere in the subtree (terms, expressions, VALUES, BIND). */
  private mentionedVariables(node: unknown, out: Set<string> = new Set()): Set<string> {
    if (Array.isArray(node)) {
      for (const item of node) this.mentionedVariables(item, out);
      return out;
    }
    if (!node || typeof node !== "object") return out;
    const record = node as Record<string, unknown>;
    if (record.type === "variable") {
      const name = typeof record.value === "string" ? record.value : record.name;
      if (typeof name === "string") out.add(name);
    }
    if (typeof record.variable === "string") out.add(record.variable);
    if (Array.isArray(record.variables)) {
      for (const v of record.variables) if (typeof v === "string") out.add(v);
    }
    for (const value of Object.values(record)) {
      if (value && typeof value === "object") this.mentionedVariables(value, out);
    }
    return out;
  }

  joinReordering(operation: AlgebraOperation): AlgebraOperation {
    if (operation.type === "join") {
      return this.reorderJoin(operation);
    }

    if (operation.type === "filter") {
      return {
        ...operation,
        input: this.joinReordering(operation.input),
      };
    }

    if (operation.type === "leftjoin") {
      return {
        ...operation,
        left: this.joinReordering(operation.left),
        right: this.joinReordering(operation.right),
      };
    }

    if (operation.type === "union") {
      return {
        ...operation,
        left: this.joinReordering(operation.left),
        right: this.joinReordering(operation.right),
      };
    }

    if (operation.type === "minus") {
      return {
        ...operation,
        left: this.joinReordering(operation.left),
        right: this.joinReordering(operation.right),
      };
    }

    if (operation.type === "project") {
      return {
        ...operation,
        input: this.joinReordering(operation.input),
      };
    }

    if (operation.type === "orderby") {
      return {
        ...operation,
        input: this.joinReordering(operation.input),
      };
    }

    if (operation.type === "slice") {
      return {
        ...operation,
        input: this.joinReordering(operation.input),
      };
    }

    if (operation.type === "distinct") {
      return {
        ...operation,
        input: this.joinReordering(operation.input),
      };
    }

    return operation;
  }

  private reorderJoin(join: JoinOperation): AlgebraOperation {
    // ⛔ A BIND is never moved to the RIGHT of a pattern that follows it (req
    // 60ed88e7). It extends only the patterns that PRECEDE it (SPARQL 1.1
    // §18.2.2.4); on the right of a bind join it would be evaluated with the left
    // solution substituted INTO its expression, so `{ BIND(STR(?x) AS ?y) ?s
    // exo:Asset_label ?x }` would bind ?y — the standard leaves it unbound — and
    // only when the later pattern happens to look constrained.
    if (this.containsExtend(join.left)) {
      return {
        type: "join",
        left: this.joinReordering(join.left),
        right: this.joinReordering(join.right),
      };
    }

    // Prefer the constrained (small cardinality) side as LEFT for bind join.
    // A subtree is "constrained" if it contains VALUES, concrete BGP objects,
    // or FILTER with constants — it produces fewer intermediate results.
    const leftConstrained = this.isConstrained(join.left);
    const rightConstrained = this.isConstrained(join.right);

    // If right is constrained but left is not, swap (right → left for bind join)
    if (rightConstrained && !leftConstrained) {
      return {
        type: "join",
        left: this.joinReordering(join.right),
        right: this.joinReordering(join.left),
      };
    }

    // If left IS constrained and right is NOT, keep order (constrained side LEFT is optimal)
    if (leftConstrained && !rightConstrained) {
      return {
        type: "join",
        left: this.joinReordering(join.left),
        right: this.joinReordering(join.right),
      };
    }

    // Both constrained or neither: fall back to cost estimate
    const leftCost = this.estimateCost(join.left);
    const rightCost = this.estimateCost(join.right);

    if (rightCost < leftCost) {
      return {
        type: "join",
        left: this.joinReordering(join.right),
        right: this.joinReordering(join.left),
      };
    }

    return {
      type: "join",
      left: this.joinReordering(join.left),
      right: this.joinReordering(join.right),
    };
  }

  /**
   * Whether a BIND (`extend`) sits in the subtree, following `input` / `left` /
   * `right` only — a BIND inside a subquery, a GRAPH/SERVICE pattern or an EXISTS
   * is scoped to it and does not count.
   */
  private containsExtend(operation: AlgebraOperation): boolean {
    if (operation.type === "extend") return true;
    const op = operation as unknown as Record<string, AlgebraOperation | undefined>;
    return [op.input, op.left, op.right].some(
      (child) => child !== undefined && typeof child === "object" && this.containsExtend(child),
    );
  }

  /**
   * Check if an operation subtree is "constrained" — likely to produce
   * a small result set due to VALUES, concrete objects, or selective filters.
   */
  private isConstrained(operation: AlgebraOperation): boolean {
    if (operation.type === "values") return true;

    if (operation.type === "bgp") {
      // BGP with any concrete (non-variable) object is constrained
      return operation.triples.some(
        t => t.object.type !== "variable" || t.subject.type !== "variable"
      );
    }

    if (operation.type === "filter") {
      return this.isConstrained(operation.input);
    }

    if (operation.type === "join") {
      return this.isConstrained(operation.left) || this.isConstrained(operation.right);
    }

    if (operation.type === "union") {
      return this.isConstrained(operation.left) && this.isConstrained(operation.right);
    }

    return false;
  }

  private estimateCost(operation: AlgebraOperation): number {
    if (operation.type === "bgp") {
      let cost = 0;

      for (const triple of operation.triples) {
        let tripleCost = 10; // base cost per triple
        // Variable subject = scanning many subjects (high cost)
        if (triple.subject.type === "variable") tripleCost *= 10;
        // Variable predicate = very unselective (rare but expensive)
        if (triple.predicate.type === "variable") tripleCost *= 20;
        // Variable object = unselective (matches all values for given s/p)
        if (triple.object.type === "variable") tripleCost *= 5;
        // Concrete object = highly selective (index lookup)
        // Concrete subject = also selective
        cost += tripleCost;
      }

      return cost;
    }

    if (operation.type === "filter") {
      return this.estimateCost(operation.input) * 0.3;
    }

    if (operation.type === "join") {
      const leftCost = this.estimateCost(operation.left);
      const rightCost = this.estimateCost(operation.right);
      // If one side is VALUES, the join is highly selective (constraining)
      if (operation.left.type === "values" || operation.right.type === "values") {
        return Math.min(leftCost, rightCost) * 2;
      }
      return leftCost * rightCost;
    }

    if (operation.type === "leftjoin") {
      return this.estimateCost(operation.left) + this.estimateCost(operation.right) * 0.5;
    }

    if (operation.type === "union") {
      return this.estimateCost(operation.left) + this.estimateCost(operation.right);
    }

    if (operation.type === "values") {
      // VALUES constrains to a small set of concrete bindings
      const bindings = (operation as import("./AlgebraOperation").ValuesOperation).bindings;
      return Array.isArray(bindings) ? bindings.length * 5 : 10;
    }

    if (operation.type === "minus") {
      // MINUS cost: left side plus checking against right side
      return this.estimateCost(operation.left) + this.estimateCost(operation.right) * 0.3;
    }

    return 100;
  }

  setStatistics(operation: string, stats: OptimizationStats): void {
    this.stats.set(operation, stats);
  }

  getStatistics(operation: string): OptimizationStats | undefined {
    return this.stats.get(operation);
  }
}
