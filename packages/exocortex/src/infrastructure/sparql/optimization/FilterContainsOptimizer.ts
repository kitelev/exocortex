import type {
  AlgebraOperation,
  FilterOperation,
  Expression,
  FunctionCallExpression,
  VariableExpression,
  LiteralExpression,
  BGPOperation,
  JoinOperation,
  Triple as AlgebraTriple,
  TripleElement,
} from "../algebra/AlgebraOperation";
import type { ITripleStore } from "../../../interfaces/ITripleStore";
import { IRI } from "../../../domain/models/rdf/IRI";

/**
 * UUID pattern regex for standard UUID v4 format.
 * Matches both lowercase and uppercase UUIDs.
 */
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Result of analyzing a FILTER(CONTAINS()) expression for UUID patterns.
 */
export interface ContainsUUIDPattern {
  /** The variable being checked (e.g., "s" for ?s) */
  variable: string;
  /** The UUID string extracted from the CONTAINS literal */
  uuid: string;
  /** The original expression for reference */
  originalExpression: Expression;
}

/**
 * Optimization hint returned when a query can be optimized.
 */
export interface OptimizationHint {
  type: "uuid-index-lookup";
  originalPattern: string;
  suggestedRewrite: string;
  estimatedSpeedup: string;
  matchedUri?: string;
}

/**
 * FilterContainsOptimizer detects and optimizes FILTER(CONTAINS(STR(?s), 'uuid'))
 * patterns by using UUID index lookups instead of full table scans.
 *
 * Problem:
 * ```sparql
 * SELECT * WHERE {
 *   ?s ?p ?o .
 *   FILTER(CONTAINS(STR(?s), '550e8400-e29b-41d4-a716-446655440000'))
 * }
 * ```
 * This performs a full scan of all triples (O(n)), converting each subject to string
 * and checking if it contains the UUID substring.
 *
 * Solution:
 * 1. Detect the CONTAINS(STR(?var), 'uuid') pattern
 * 2. Extract the UUID from the literal
 * 3. Look up subjects containing that UUID in the triple store
 * 4. Rewrite to use exact subject match or VALUES clause
 *
 * Result: O(1) lookup instead of O(n) scan.
 */
export class FilterContainsOptimizer {
  private tripleStore: ITripleStore | null = null;
  private lastOptimizationHints: OptimizationHint[] = [];

  /**
   * Set the triple store for performing index lookups during optimization.
   * When set, the optimizer can look up subjects containing the UUID.
   */
  setTripleStore(store: ITripleStore): void {
    this.tripleStore = store;
  }

  /**
   * Get hints from the last optimization run.
   * Useful for --explain mode to show users what optimizations are possible.
   */
  getLastOptimizationHints(): OptimizationHint[] {
    return this.lastOptimizationHints;
  }

  /**
   * Clear optimization hints from previous runs.
   */
  clearHints(): void {
    this.lastOptimizationHints = [];
  }

  /**
   * Optimize an algebra operation by detecting and rewriting FILTER(CONTAINS())
   * patterns that search for UUIDs.
   */
  async optimize(operation: AlgebraOperation): Promise<AlgebraOperation> {
    this.clearHints();
    return this.optimizeRecursive(operation);
  }

  /**
   * Synchronous version of optimize for use in pipeline where async is not available.
   * Uses cached subjects if triple store is available.
   */
  optimizeSync(operation: AlgebraOperation, subjectUris?: string[]): AlgebraOperation {
    this.clearHints();
    return this.optimizeSyncRecursive(operation, subjectUris);
  }

  private async optimizeRecursive(operation: AlgebraOperation): Promise<AlgebraOperation> {
    if (operation.type === "filter") {
      return this.optimizeFilter(operation);
    }

    // Recurse into nested operations
    if (operation.type === "join") {
      return {
        type: "join",
        left: await this.optimizeRecursive(operation.left),
        right: await this.optimizeRecursive(operation.right),
      };
    }

    if (operation.type === "leftjoin") {
      return {
        ...operation,
        left: await this.optimizeRecursive(operation.left),
        right: await this.optimizeRecursive(operation.right),
      };
    }

    if (operation.type === "union") {
      return {
        type: "union",
        left: await this.optimizeRecursive(operation.left),
        right: await this.optimizeRecursive(operation.right),
      };
    }

    if (operation.type === "minus") {
      return {
        ...operation,
        left: await this.optimizeRecursive(operation.left),
        right: await this.optimizeRecursive(operation.right),
      };
    }

    if (operation.type === "project") {
      return {
        ...operation,
        input: await this.optimizeRecursive(operation.input),
      };
    }

    if (operation.type === "orderby") {
      return {
        ...operation,
        input: await this.optimizeRecursive(operation.input),
      };
    }

    if (operation.type === "slice") {
      return {
        ...operation,
        input: await this.optimizeRecursive(operation.input),
      };
    }

    if (operation.type === "distinct") {
      return {
        ...operation,
        input: await this.optimizeRecursive(operation.input),
      };
    }

    if (operation.type === "reduced") {
      return {
        ...operation,
        input: await this.optimizeRecursive(operation.input),
      };
    }

    if (operation.type === "group") {
      return {
        ...operation,
        input: await this.optimizeRecursive(operation.input),
      };
    }

    if (operation.type === "extend") {
      return {
        ...operation,
        input: await this.optimizeRecursive(operation.input),
      };
    }

    return operation;
  }

  private optimizeSyncRecursive(
    operation: AlgebraOperation,
    subjectUris?: string[]
  ): AlgebraOperation {
    if (operation.type === "filter") {
      return this.optimizeFilterSync(operation, subjectUris);
    }

    // Recurse into nested operations
    if (operation.type === "join") {
      return {
        type: "join",
        left: this.optimizeSyncRecursive(operation.left, subjectUris),
        right: this.optimizeSyncRecursive(operation.right, subjectUris),
      };
    }

    if (operation.type === "leftjoin") {
      return {
        ...operation,
        left: this.optimizeSyncRecursive(operation.left, subjectUris),
        right: this.optimizeSyncRecursive(operation.right, subjectUris),
      };
    }

    if (operation.type === "union") {
      return {
        type: "union",
        left: this.optimizeSyncRecursive(operation.left, subjectUris),
        right: this.optimizeSyncRecursive(operation.right, subjectUris),
      };
    }

    if (operation.type === "minus") {
      return {
        ...operation,
        left: this.optimizeSyncRecursive(operation.left, subjectUris),
        right: this.optimizeSyncRecursive(operation.right, subjectUris),
      };
    }

    if (operation.type === "project") {
      return {
        ...operation,
        input: this.optimizeSyncRecursive(operation.input, subjectUris),
      };
    }

    if (operation.type === "orderby") {
      return {
        ...operation,
        input: this.optimizeSyncRecursive(operation.input, subjectUris),
      };
    }

    if (operation.type === "slice") {
      return {
        ...operation,
        input: this.optimizeSyncRecursive(operation.input, subjectUris),
      };
    }

    if (operation.type === "distinct") {
      return {
        ...operation,
        input: this.optimizeSyncRecursive(operation.input, subjectUris),
      };
    }

    if (operation.type === "reduced") {
      return {
        ...operation,
        input: this.optimizeSyncRecursive(operation.input, subjectUris),
      };
    }

    if (operation.type === "group") {
      return {
        ...operation,
        input: this.optimizeSyncRecursive(operation.input, subjectUris),
      };
    }

    if (operation.type === "extend") {
      return {
        ...operation,
        input: this.optimizeSyncRecursive(operation.input, subjectUris),
      };
    }

    return operation;
  }

  private async optimizeFilter(filter: FilterOperation): Promise<AlgebraOperation> {
    const pattern = this.detectContainsUUIDPattern(filter.expression);

    if (!pattern) {
      // No optimization possible, recurse into input
      return {
        type: "filter",
        expression: filter.expression,
        input: await this.optimizeRecursive(filter.input),
      };
    }

    // Find matching URIs in the triple store
    let matchingUris: string[] = [];
    if (this.tripleStore) {
      matchingUris = await this.findSubjectsContainingUUID(pattern.uuid);
    }

    return this.rewriteFilter(filter, pattern, matchingUris);
  }

  private optimizeFilterSync(
    filter: FilterOperation,
    subjectUris?: string[]
  ): AlgebraOperation {
    const pattern = this.detectContainsUUIDPattern(filter.expression);

    if (!pattern) {
      // No optimization possible, recurse into input
      return {
        type: "filter",
        expression: filter.expression,
        input: this.optimizeSyncRecursive(filter.input, subjectUris),
      };
    }

    // Find matching URIs from provided subjects
    const matchingUris = subjectUris
      ? subjectUris.filter((uri) => uri.includes(pattern.uuid))
      : [];

    return this.rewriteFilter(filter, pattern, matchingUris);
  }

  private rewriteFilter(
    filter: FilterOperation,
    pattern: ContainsUUIDPattern,
    matchingUris: string[]
  ): AlgebraOperation {
    // Record optimization hint
    this.lastOptimizationHints.push({
      type: "uuid-index-lookup",
      originalPattern: `FILTER(CONTAINS(STR(?${pattern.variable}), "${pattern.uuid}"))`,
      suggestedRewrite:
        matchingUris.length === 1
          ? `VALUES ?${pattern.variable} { <${matchingUris[0]}> }`
          : matchingUris.length > 1
            ? `VALUES ?${pattern.variable} { ${matchingUris.map((u) => `<${u}>`).join(" ")} }`
            : `No matching URIs found for UUID`,
      estimatedSpeedup: matchingUris.length > 0 ? "O(n) → O(1)" : "N/A",
      matchedUri: matchingUris.length === 1 ? matchingUris[0] : undefined,
    });

    if (matchingUris.length === 0) {
      // No matching URIs found, keep original filter
      // But still recurse into input
      return {
        type: "filter",
        expression: filter.expression,
        input: this.optimizeSyncRecursive(filter.input),
      };
    }

    if (matchingUris.length === 1) {
      // Single match: rewrite BGP to use exact subject match
      const optimizedInput = this.injectSubjectConstraint(
        filter.input,
        pattern.variable,
        matchingUris[0]
      );

      // The FILTER is now redundant since we've constrained the subject,
      // but we keep it for safety (in case the injection didn't work)
      if (optimizedInput !== filter.input) {
        // Successfully injected - can remove filter
        return optimizedInput;
      }
    }

    // Multiple matches or couldn't inject: use VALUES clause
    return this.createValuesJoin(filter, pattern, matchingUris);
  }

  /**
   * Detect if an expression matches the pattern CONTAINS(STR(?var), 'uuid').
   */
  detectContainsUUIDPattern(expr: Expression): ContainsUUIDPattern | null {
    // Handle direct function call
    if (expr.type === "function" || expr.type === "functionCall") {
      const funcExpr = expr as FunctionCallExpression;
      const funcName =
        typeof funcExpr.function === "string"
          ? funcExpr.function.toLowerCase()
          : (funcExpr.function as any)?.value?.toLowerCase() ?? "";

      if (funcName === "contains" && funcExpr.args.length === 2) {
        return this.analyzeContainsArgs(funcExpr.args[0], funcExpr.args[1], expr);
      }
    }

    // Handle logical AND - check each operand
    if (expr.type === "logical" && (expr as any).operator === "&&") {
      for (const operand of (expr as any).operands) {
        const pattern = this.detectContainsUUIDPattern(operand);
        if (pattern) {
          return pattern;
        }
      }
    }

    return null;
  }

  private analyzeContainsArgs(
    firstArg: Expression,
    secondArg: Expression,
    originalExpr: Expression
  ): ContainsUUIDPattern | null {
    // Check if first arg is STR(?variable)
    let variable: string | null = null;

    if (firstArg.type === "function" || firstArg.type === "functionCall") {
      const strFunc = firstArg as FunctionCallExpression;
      const strFuncName =
        typeof strFunc.function === "string"
          ? strFunc.function.toLowerCase()
          : (strFunc.function as any)?.value?.toLowerCase() ?? "";

      if (strFuncName === "str" && strFunc.args.length === 1) {
        const varArg = strFunc.args[0];
        if (varArg.type === "variable") {
          variable = (varArg as VariableExpression).name;
        }
      }
    }

    // Also check for direct variable (without STR wrapping)
    if (!variable && firstArg.type === "variable") {
      variable = (firstArg as VariableExpression).name;
    }

    if (!variable) {
      return null;
    }

    // Check if second arg is a literal containing a UUID
    if (secondArg.type === "literal") {
      const literalExpr = secondArg as LiteralExpression;
      const literalValue = String(literalExpr.value);
      const uuidMatch = literalValue.match(UUID_PATTERN);

      if (uuidMatch) {
        return {
          variable,
          uuid: uuidMatch[0].toLowerCase(),
          originalExpression: originalExpr,
        };
      }
    }

    return null;
  }

  /**
   * Find all subjects in the triple store that contain the given UUID.
   * Uses the UUID index for O(1) lookup if available, falls back to O(n) scan otherwise.
   */
  private async findSubjectsContainingUUID(uuid: string): Promise<string[]> {
    if (!this.tripleStore) {
      return [];
    }

    // Try to use the optimized UUID index lookup first
    if (this.tripleStore.findSubjectsByUUID) {
      const indexedSubjects = await this.tripleStore.findSubjectsByUUID(uuid);
      return indexedSubjects.map((s) => (s as IRI).value);
    }

    // Fallback to O(n) scan if UUID index not available
    const subjects = await this.tripleStore.subjects();
    const matchingUris: string[] = [];

    for (const subject of subjects) {
      if (subject instanceof IRI) {
        if (subject.value.toLowerCase().includes(uuid.toLowerCase())) {
          matchingUris.push(subject.value);
        }
      }
    }

    return matchingUris;
  }

  /**
   * Inject a subject constraint into a BGP operation.
   * If the BGP uses the variable as subject, replace it with the exact IRI.
   */
  private injectSubjectConstraint(
    operation: AlgebraOperation,
    variable: string,
    uri: string
  ): AlgebraOperation {
    if (operation.type === "bgp") {
      const newTriples: AlgebraTriple[] = operation.triples.map((triple) => {
        if (triple.subject.type === "variable" && triple.subject.value === variable) {
          // Replace variable with exact IRI
          return {
            ...triple,
            subject: { type: "iri", value: uri } as TripleElement,
          };
        }
        return triple;
      });

      const hasChanges = newTriples.some(
        (t, i) => t.subject !== operation.triples[i].subject
      );

      if (hasChanges) {
        return {
          type: "bgp",
          triples: newTriples,
        } as BGPOperation;
      }
    }

    if (operation.type === "join") {
      const leftOpt = this.injectSubjectConstraint(operation.left, variable, uri);
      const rightOpt = this.injectSubjectConstraint(operation.right, variable, uri);
      if (leftOpt !== operation.left || rightOpt !== operation.right) {
        return {
          type: "join",
          left: leftOpt,
          right: rightOpt,
        } as JoinOperation;
      }
    }

    if (operation.type === "filter") {
      const inputOpt = this.injectSubjectConstraint(operation.input, variable, uri);
      if (inputOpt !== operation.input) {
        return {
          ...operation,
          input: inputOpt,
        };
      }
    }

    return operation;
  }

  /**
   * Create a VALUES clause join to pre-filter subjects.
   */
  private createValuesJoin(
    filter: FilterOperation,
    pattern: ContainsUUIDPattern,
    matchingUris: string[]
  ): AlgebraOperation {
    // Create VALUES operation
    const valuesOp: AlgebraOperation = {
      type: "values",
      variables: [pattern.variable],
      bindings: matchingUris.map((uri) => ({
        [pattern.variable]: { type: "iri", value: uri },
      })),
    };

    // Join VALUES with the original input
    const joinOp: AlgebraOperation = {
      type: "join",
      left: valuesOp,
      right: this.optimizeSyncRecursive(filter.input),
    };

    // The FILTER is now redundant but keep for safety
    // Actually, we can remove it since VALUES guarantees the constraint
    return joinOp;
  }

  /**
   * Analyze a query for potential FILTER(CONTAINS()) optimizations
   * without applying them. Useful for --explain mode.
   */
  analyzeQuery(operation: AlgebraOperation): OptimizationHint[] {
    const hints: OptimizationHint[] = [];
    this.analyzeRecursive(operation, hints);
    return hints;
  }

  private analyzeRecursive(operation: AlgebraOperation, hints: OptimizationHint[]): void {
    if (operation.type === "filter") {
      const pattern = this.detectContainsUUIDPattern(operation.expression);
      if (pattern) {
        hints.push({
          type: "uuid-index-lookup",
          originalPattern: `FILTER(CONTAINS(STR(?${pattern.variable}), "${pattern.uuid}"))`,
          suggestedRewrite: `Use --optimize flag or rewrite as VALUES ?${pattern.variable} { <uri-containing-uuid> }`,
          estimatedSpeedup: "O(n) → O(1) with UUID index lookup",
        });
      }
      this.analyzeRecursive(operation.input, hints);
      return;
    }

    // Recurse into nested operations
    if (operation.type === "join") {
      this.analyzeRecursive(operation.left, hints);
      this.analyzeRecursive(operation.right, hints);
    } else if (operation.type === "leftjoin") {
      this.analyzeRecursive(operation.left, hints);
      this.analyzeRecursive(operation.right, hints);
    } else if (operation.type === "union") {
      this.analyzeRecursive(operation.left, hints);
      this.analyzeRecursive(operation.right, hints);
    } else if (operation.type === "minus") {
      this.analyzeRecursive(operation.left, hints);
      this.analyzeRecursive(operation.right, hints);
    } else if (operation.type === "project") {
      this.analyzeRecursive(operation.input, hints);
    } else if (operation.type === "orderby") {
      this.analyzeRecursive(operation.input, hints);
    } else if (operation.type === "slice") {
      this.analyzeRecursive(operation.input, hints);
    } else if (operation.type === "distinct") {
      this.analyzeRecursive(operation.input, hints);
    } else if (operation.type === "reduced") {
      this.analyzeRecursive(operation.input, hints);
    } else if (operation.type === "group") {
      this.analyzeRecursive(operation.input, hints);
    } else if (operation.type === "extend") {
      this.analyzeRecursive(operation.input, hints);
    }
  }
}
