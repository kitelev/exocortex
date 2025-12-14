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

    if (input.type === "join") {
      const filterVars = this.getFilterVariables(filter.expression);
      const leftVars = this.getOperationVariables(input.left);
      const rightVars = this.getOperationVariables(input.right);

      const leftOnly = filterVars.every((v) => leftVars.has(v));
      const rightOnly = filterVars.every((v) => rightVars.has(v));

      if (leftOnly && !rightOnly) {
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

      if (rightOnly && !leftOnly) {
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

  private getFilterVariables(expr: Expression): string[] {
    const vars: string[] = [];

    if (expr.type === "variable") {
      vars.push(expr.name);
    } else if (expr.type === "comparison") {
      vars.push(...this.getFilterVariables(expr.left));
      vars.push(...this.getFilterVariables(expr.right));
    } else if (expr.type === "logical") {
      for (const operand of expr.operands) {
        vars.push(...this.getFilterVariables(operand));
      }
    } else if (expr.type === "function") {
      for (const arg of expr.args) {
        vars.push(...this.getFilterVariables(arg));
      }
    }

    return Array.from(new Set(vars));
  }

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
    }

    return vars;
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

  private estimateCost(operation: AlgebraOperation): number {
    if (operation.type === "bgp") {
      let cost = operation.triples.length * 100;

      for (const triple of operation.triples) {
        if (triple.subject.type === "variable") cost += 10;
        if (triple.predicate.type === "variable") cost += 20;
        if (triple.object.type === "variable") cost += 10;
      }

      return cost;
    }

    if (operation.type === "filter") {
      return this.estimateCost(operation.input) * 0.3;
    }

    if (operation.type === "join") {
      return this.estimateCost(operation.left) * this.estimateCost(operation.right);
    }

    if (operation.type === "leftjoin") {
      return this.estimateCost(operation.left) + this.estimateCost(operation.right) * 0.5;
    }

    if (operation.type === "union") {
      return this.estimateCost(operation.left) + this.estimateCost(operation.right);
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
