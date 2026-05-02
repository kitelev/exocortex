import type { FilterOperation, Expression, AlgebraOperation, ExistsExpression, ArithmeticExpression, InExpression } from "../algebra/AlgebraOperation";
import type { SolutionMapping } from "../SolutionMapping";
import type { ITripleStore } from "../../../interfaces/ITripleStore";
import { BuiltInFunctions } from "../filters/BuiltInFunctions";
import { functionHandlers, type FunctionContext } from "../filters/FunctionRegistry";
import { IRI } from "../../../domain/models/rdf/IRI";
import { Literal } from "../../../domain/models/rdf/Literal";

export class FilterExecutorError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, cause ? { cause } : undefined);
    this.name = "FilterExecutorError";
  }
}

/**
 * Result type for SPARQL expression evaluation.
 * Represents the possible runtime values produced by evaluating SPARQL expressions:
 * - IRI/Literal/BlankNode: RDF term references
 * - boolean/number/string: Native JS values from comparisons, arithmetic, etc.
 * - undefined: Unbound variable or null result
 *
 * This uses `any` intentionally because expression evaluation crosses type boundaries
 * between RDF terms, native JS values, and domain objects. The dynamic nature of
 * SPARQL expression evaluation makes strict typing impractical at this boundary.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ExpressionResult = any;

/**
 * Callback type for evaluating EXISTS patterns.
 * The callback executes the pattern with the given solution bindings
 * and returns true if at least one result is found.
 */
export type ExistsEvaluator = (pattern: AlgebraOperation, solution: SolutionMapping) => Promise<boolean>;

export class FilterExecutor {
  private existsEvaluator: ExistsEvaluator | null = null;
  private tripleStore: ITripleStore | null = null;
  private uuidCache: Map<string, IRI | null> = new Map();

  /**
   * Set the EXISTS evaluator callback.
   * Must be called before evaluating expressions with EXISTS/NOT EXISTS.
   */
  setExistsEvaluator(evaluator: ExistsEvaluator): void {
    this.existsEvaluator = evaluator;
  }

  /**
   * Set the triple store for UUID lookups.
   * Required for exo:byUUID() function to perform O(1) index lookups.
   */
  setTripleStore(store: ITripleStore): void {
    this.tripleStore = store;
    this.uuidCache.clear();
  }

  async *execute(
    operation: FilterOperation,
    inputSolutions: AsyncIterableIterator<SolutionMapping>
  ): AsyncIterableIterator<SolutionMapping> {
    // Check if expression contains EXISTS to decide sync vs async evaluation
    const hasExists = this.expressionContainsExists(operation.expression);

    for await (const solution of inputSolutions) {
      try {
        let result: boolean;
        if (hasExists) {
          result = await this.evaluateExpressionAsync(operation.expression, solution);
        } else {
          result = this.evaluateExpression(operation.expression, solution);
        }
        if (result === true) {
          yield solution;
        }
      } catch {
        continue;
      }
    }
  }

  /**
   * Check if an expression contains EXISTS or NOT EXISTS.
   *
   * Recurses into logical, comparison, arithmetic, IN, and function-call
   * arguments so that nested EXISTS — e.g. `BIND(IF(EXISTS {...}, a, b))` —
   * triggers the async evaluation path instead of throwing in sync mode.
   */
  expressionContainsExists(expr: Expression): boolean {
    if (!expr || typeof expr !== "object") return false;

    if (expr.type === "exists") {
      return true;
    }

    if (expr.type === "logical") {
      return (expr as import("../algebra/AlgebraOperation").LogicalExpression).operands.some((op: Expression) => this.expressionContainsExists(op));
    }

    if (expr.type === "comparison") {
      const compExpr = expr as import("../algebra/AlgebraOperation").ComparisonExpression;
      return (
        this.expressionContainsExists(compExpr.left) ||
        this.expressionContainsExists(compExpr.right)
      );
    }

    if (expr.type === "arithmetic") {
      const arithExpr = expr as ArithmeticExpression;
      return (
        this.expressionContainsExists(arithExpr.left) ||
        this.expressionContainsExists(arithExpr.right)
      );
    }

    if (expr.type === "in") {
      const inExpr = expr as InExpression;
      return (
        this.expressionContainsExists(inExpr.expression) ||
        inExpr.list.some((item) => this.expressionContainsExists(item))
      );
    }

    if (expr.type === "function" || expr.type === "functionCall") {
      const fnExpr = expr as { args?: Expression[] };
      return Array.isArray(fnExpr.args)
        ? fnExpr.args.some((arg) => this.expressionContainsExists(arg))
        : false;
    }

    return false;
  }

  async executeAll(operation: FilterOperation, inputSolutions: SolutionMapping[]): Promise<SolutionMapping[]> {
    const results: SolutionMapping[] = [];

    async function* generator() {
      for (const solution of inputSolutions) {
        yield solution;
      }
    }

    for await (const solution of this.execute(operation, generator())) {
      results.push(solution);
    }

    return results;
  }

  /**
   * Evaluate a SPARQL expression against a solution mapping.
   * Public to allow reuse in QueryExecutor for BIND evaluation.
   * Note: EXISTS expressions require async evaluation - use evaluateExpressionAsync for those.
   */
  evaluateExpression(expr: Expression, solution: SolutionMapping): ExpressionResult {
    // Handle sparqljs native format (termType) - used by raw parsed expressions
    const exprRecord = expr as unknown as Record<string, unknown>;
    if ("termType" in expr) {
      switch (exprRecord.termType) {
        case "Variable":
          return solution.get(exprRecord.value as string);
        case "Literal":
          return exprRecord.value as string;
        case "NamedNode":
          return exprRecord.value as string;
        default:
          throw new FilterExecutorError(`Unsupported termType: ${String(exprRecord.termType)}`);
      }
    }

    switch (expr.type) {
      case "comparison":
        return this.evaluateComparison(expr, solution);

      case "logical":
        return this.evaluateLogical(expr, solution);

      case "arithmetic":
        return this.evaluateArithmetic(expr as ArithmeticExpression, solution);

      case "function":
      case "functionCall":
        return this.evaluateFunction(expr, solution);

      case "variable":
        return solution.get(expr.name);

      case "literal":
        return expr.value;

      case "in":
        return this.evaluateIn(expr as InExpression, solution);

      case "exists":
        // EXISTS requires async evaluation; throw error if called synchronously
        throw new FilterExecutorError(
          "EXISTS expressions require async evaluation. Use evaluateExpressionAsync instead."
        );

      default:
        throw new FilterExecutorError(`Unsupported expression type: ${(expr as { type: string }).type}`);
    }
  }

  /**
   * Evaluate a SPARQL expression asynchronously.
   * Required for EXISTS/NOT EXISTS which need to execute subqueries.
   *
   * Recurses through expression shapes that can host EXISTS (logical,
   * comparison, arithmetic, IN, and function calls such as IF/COALESCE).
   * Sub-expressions without EXISTS fall back to the synchronous path.
   */
  async evaluateExpressionAsync(expr: Expression, solution: SolutionMapping): Promise<ExpressionResult> {
    if (!this.expressionContainsExists(expr)) {
      return this.evaluateExpression(expr, solution);
    }

    if (expr.type === "exists") {
      return this.evaluateExists(expr as ExistsExpression, solution);
    }

    if (expr.type === "logical") {
      return this.evaluateLogicalAsync(expr, solution);
    }

    if (expr.type === "comparison") {
      const compExpr = expr as import("../algebra/AlgebraOperation").ComparisonExpression;
      const left = await this.evaluateExpressionAsync(compExpr.left, solution);
      const right = await this.evaluateExpressionAsync(compExpr.right, solution);
      return BuiltInFunctions.compare(left, right, compExpr.operator);
    }

    if (expr.type === "in") {
      return this.evaluateInAsync(expr as InExpression, solution);
    }

    if (expr.type === "function" || expr.type === "functionCall") {
      return this.evaluateFunctionAsync(expr, solution);
    }

    return this.evaluateExpression(expr, solution);
  }

  /**
   * Evaluate EXISTS or NOT EXISTS expression.
   * Executes the subpattern with current bindings and checks for any results.
   */
  private async evaluateExists(expr: ExistsExpression, solution: SolutionMapping): Promise<boolean> {
    if (!this.existsEvaluator) {
      throw new FilterExecutorError(
        "EXISTS evaluator not set. Call setExistsEvaluator before evaluating EXISTS expressions."
      );
    }

    const exists = await this.existsEvaluator(expr.pattern, solution);
    return expr.negated ? !exists : exists;
  }

  /**
   * Evaluate logical expression asynchronously to handle nested EXISTS.
   */
  private async evaluateLogicalAsync(expr: import("../algebra/AlgebraOperation").LogicalExpression, solution: SolutionMapping): Promise<boolean> {
    if (expr.operator === "!") {
      const operand = await this.evaluateExpressionAsync(expr.operands[0], solution);
      return BuiltInFunctions.logicalNot(operand as boolean);
    }

    const results: boolean[] = [];
    for (const op of expr.operands) {
      const result = await this.evaluateExpressionAsync(op, solution);
      results.push(result as boolean);
    }

    if (expr.operator === "&&") {
      return BuiltInFunctions.logicalAnd(results);
    }

    if (expr.operator === "||") {
      return BuiltInFunctions.logicalOr(results);
    }

    throw new FilterExecutorError(`Unknown logical operator: ${String(expr.operator)}`);
  }

  /**
   * Evaluate IN / NOT IN asynchronously, threading EXISTS-aware evaluation
   * through the tested expression and list items.
   */
  private async evaluateInAsync(expr: InExpression, solution: SolutionMapping): Promise<boolean> {
    const testValue = await this.evaluateExpressionAsync(expr.expression, solution);
    let found = false;
    for (const listItem of expr.list) {
      const listValue = await this.evaluateExpressionAsync(listItem, solution);
      if (BuiltInFunctions.compare(testValue, listValue, "=")) {
        found = true;
        break;
      }
    }
    return expr.negated ? !found : found;
  }

  /**
   * Evaluate a function-call expression asynchronously when it contains
   * a nested EXISTS. Handles IF/COALESCE lazily (only the selected branch
   * is evaluated), and falls back to awaiting each argument before
   * delegating to the synchronous handler for everything else.
   */
  private async evaluateFunctionAsync(expr: Expression, solution: SolutionMapping): Promise<ExpressionResult> {
    const typedExpr = expr as { type: string; function: string | { value: string }; args: Expression[] };
    const funcName = this.extractFunctionName(typedExpr.function);
    const args = typedExpr.args ?? [];

    if (funcName === "if") {
      if (args.length !== 3) {
        throw new FilterExecutorError("IF requires exactly 3 arguments");
      }
      const condition = await this.evaluateExpressionAsync(args[0], solution);
      const conditionBool = this.toBoolean(condition);
      return conditionBool
        ? this.evaluateExpressionAsync(args[1], solution)
        : this.evaluateExpressionAsync(args[2], solution);
    }

    if (funcName === "coalesce") {
      for (const arg of args) {
        try {
          const value = await this.evaluateExpressionAsync(arg, solution);
          if (value !== undefined && value !== null) {
            return value;
          }
        } catch {
          continue;
        }
      }
      return undefined;
    }

    // For generic functions, materialize args async (so nested EXISTS is
    // resolved) and delegate to the sync handler by shadowing args with
    // pre-computed literal values.
    const resolvedArgs: Expression[] = [];
    for (const arg of args) {
      const value = await this.evaluateExpressionAsync(arg, solution);
      resolvedArgs.push(this.wrapAsLiteralExpression(value));
    }
    const syntheticExpr = { ...typedExpr, args: resolvedArgs } as unknown;
    return this.evaluateFunction(syntheticExpr, solution);
  }

  /**
   * Wrap an already-evaluated value as a literal expression so that the
   * synchronous `evaluateExpression` path can reuse it without re-evaluating
   * the original sub-tree (which may contain EXISTS).
   */
  private wrapAsLiteralExpression(value: unknown): Expression {
    if (value === undefined || value === null) {
      return { type: "literal", value: "" } as unknown as Expression;
    }
    if (value !== null && typeof value === "object" && "termType" in value) {
      return value as unknown as Expression;
    }
    if (value instanceof IRI || value instanceof Literal) {
      return { type: "literal", value: (value as IRI | Literal).value } as unknown as Expression;
    }
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
      return { type: "literal", value } as unknown as Expression;
    }
    return { type: "literal", value: String(value) } as unknown as Expression;
  }

  private evaluateComparison(expr: import("../algebra/AlgebraOperation").ComparisonExpression, solution: SolutionMapping): boolean {
    const left = this.evaluateExpression(expr.left, solution);
    const right = this.evaluateExpression(expr.right, solution);

    return BuiltInFunctions.compare(left, right, expr.operator);
  }

  private evaluateLogical(expr: import("../algebra/AlgebraOperation").LogicalExpression, solution: SolutionMapping): boolean {
    if (expr.operator === "!") {
      const operand = this.evaluateExpression(expr.operands[0], solution);
      return BuiltInFunctions.logicalNot(operand as boolean);
    }

    const results = expr.operands.map((op: Expression) => {
      const result = this.evaluateExpression(op, solution);
      return result as boolean;
    });

    if (expr.operator === "&&") {
      return BuiltInFunctions.logicalAnd(results);
    }

    if (expr.operator === "||") {
      return BuiltInFunctions.logicalOr(results);
    }

    throw new FilterExecutorError(`Unknown logical operator: ${String(expr.operator)}`);
  }

  /**
   * Evaluate IN or NOT IN expression.
   * SPARQL 1.1 Section 17.4.1.5:
   * - expr IN (val1, val2, ...) returns true if expr = val_i for any value in the list
   * - expr NOT IN (val1, val2, ...) returns true if expr != val_i for all values in the list
   *
   * Uses RDF term equality semantics (same as = operator).
   */
  private evaluateIn(expr: InExpression, solution: SolutionMapping): boolean {
    const testValue = this.evaluateExpression(expr.expression, solution);

    // Check if testValue equals any value in the list
    const found = expr.list.some((listItem) => {
      const listValue = this.evaluateExpression(listItem, solution);
      return BuiltInFunctions.compare(testValue, listValue, "=");
    });

    // For IN, return true if found; for NOT IN, return true if NOT found
    return expr.negated ? !found : found;
  }

  /**
   * Evaluate arithmetic expression (+, -, *, /).
   * Supports:
   * - Numeric arithmetic
   * - xsd:date - xsd:date = xsd:dayTimeDuration (day-only format like "P14D")
   * - xsd:time - xsd:time = xsd:dayTimeDuration
   * - xsd:dateTime - xsd:dateTime = xsd:dayTimeDuration
   * - xsd:date +/- xsd:dayTimeDuration = xsd:date
   * - xsd:date +/- xsd:yearMonthDuration = xsd:date
   * - xsd:dateTime +/- xsd:dayTimeDuration = xsd:dateTime
   * - xsd:dateTime +/- xsd:yearMonthDuration = xsd:dateTime
   * - xsd:dayTimeDuration +/- xsd:dayTimeDuration = xsd:dayTimeDuration
   * - xsd:yearMonthDuration +/- xsd:yearMonthDuration = xsd:yearMonthDuration (Issue #975)
   * - xsd:dayTimeDuration * number = xsd:dayTimeDuration
   * - xsd:dayTimeDuration / number = xsd:dayTimeDuration
   */
  private evaluateArithmetic(expr: ArithmeticExpression, solution: SolutionMapping): number | Literal {
    const left = this.evaluateExpression(expr.left, solution);
    const right = this.evaluateExpression(expr.right, solution);

    // Special handling for xsd:date - xsd:date = dayTimeDuration (clean day format)
    // Must check before dateTime since isDateTimeValue also matches dates
    if (expr.operator === "-" && this.isDateValue(left) && this.isDateValue(right)) {
      return BuiltInFunctions.dateDiff(left, right);
    }

    // Special handling for xsd:time - xsd:time = dayTimeDuration
    if (expr.operator === "-" && this.isTimeValue(left) && this.isTimeValue(right)) {
      return BuiltInFunctions.timeDiff(left, right);
    }

    // Special handling for dateTime - dateTime = dayTimeDuration
    if (expr.operator === "-" && this.isDateTimeValue(left) && this.isDateTimeValue(right)) {
      return BuiltInFunctions.dateTimeDiff(left, right);
    }

    // Special handling for date + dayTimeDuration = date (Issue #973)
    if (expr.operator === "+" && this.isDateValue(left) && this.isDayTimeDurationValue(right)) {
      return BuiltInFunctions.dateAdd(left, right);
    }

    // Special handling for date - dayTimeDuration = date (Issue #973)
    if (expr.operator === "-" && this.isDateValue(left) && this.isDayTimeDurationValue(right)) {
      return BuiltInFunctions.dateSubtract(left, right);
    }

    // Special handling for date + yearMonthDuration = date (Issue #973)
    if (expr.operator === "+" && this.isDateValue(left) && this.isYearMonthDurationValue(right)) {
      return BuiltInFunctions.dateAddYearMonth(left, right);
    }

    // Special handling for date - yearMonthDuration = date (Issue #973)
    if (expr.operator === "-" && this.isDateValue(left) && this.isYearMonthDurationValue(right)) {
      return BuiltInFunctions.dateSubtractYearMonth(left, right);
    }

    // Special handling for dateTime + dayTimeDuration = dateTime
    if (expr.operator === "+" && this.isDateTimeValue(left) && this.isDayTimeDurationValue(right)) {
      return BuiltInFunctions.dateTimeAdd(left, right);
    }

    // Special handling for dateTime - dayTimeDuration = dateTime
    if (expr.operator === "-" && this.isDateTimeValue(left) && this.isDayTimeDurationValue(right)) {
      return BuiltInFunctions.dateTimeSubtract(left, right);
    }

    // Special handling for dateTime + yearMonthDuration = dateTime (Issue #973)
    if (expr.operator === "+" && this.isDateTimeValue(left) && this.isYearMonthDurationValue(right)) {
      return BuiltInFunctions.dateTimeAddYearMonth(left, right);
    }

    // Special handling for dateTime - yearMonthDuration = dateTime (Issue #973)
    if (expr.operator === "-" && this.isDateTimeValue(left) && this.isYearMonthDurationValue(right)) {
      return BuiltInFunctions.dateTimeSubtractYearMonth(left, right);
    }

    // Special handling for dayTimeDuration + dayTimeDuration = dayTimeDuration
    if (expr.operator === "+" && this.isDayTimeDurationValue(left) && this.isDayTimeDurationValue(right)) {
      return BuiltInFunctions.durationAdd(left, right);
    }

    // Special handling for dayTimeDuration - dayTimeDuration = dayTimeDuration
    if (expr.operator === "-" && this.isDayTimeDurationValue(left) && this.isDayTimeDurationValue(right)) {
      return BuiltInFunctions.durationSubtract(left, right);
    }

    // Special handling for dayTimeDuration * number = dayTimeDuration
    if (expr.operator === "*" && this.isDayTimeDurationValue(left) && !this.isDayTimeDurationValue(right)) {
      const rightNum = this.toNumericValue(right);
      return BuiltInFunctions.durationMultiply(left, rightNum);
    }

    // Special handling for number * dayTimeDuration = dayTimeDuration
    if (expr.operator === "*" && !this.isDayTimeDurationValue(left) && this.isDayTimeDurationValue(right)) {
      const leftNum = this.toNumericValue(left);
      return BuiltInFunctions.durationMultiply(right, leftNum);
    }

    // Special handling for dayTimeDuration / number = dayTimeDuration
    if (expr.operator === "/" && this.isDayTimeDurationValue(left) && !this.isDayTimeDurationValue(right)) {
      const rightNum = this.toNumericValue(right);
      if (rightNum === 0) {
        throw new FilterExecutorError("Division by zero");
      }
      return BuiltInFunctions.durationDivide(left, rightNum);
    }

    // Special handling for yearMonthDuration + yearMonthDuration = yearMonthDuration (Issue #975)
    if (expr.operator === "+" && this.isYearMonthDurationValue(left) && this.isYearMonthDurationValue(right)) {
      return BuiltInFunctions.yearMonthDurationAdd(left, right);
    }

    // Special handling for yearMonthDuration - yearMonthDuration = yearMonthDuration (Issue #975)
    if (expr.operator === "-" && this.isYearMonthDurationValue(left) && this.isYearMonthDurationValue(right)) {
      return BuiltInFunctions.yearMonthDurationSubtract(left, right);
    }

    // Standard numeric arithmetic
    const leftNum = this.toNumericValue(left);
    const rightNum = this.toNumericValue(right);

    switch (expr.operator) {
      case "+":
        return leftNum + rightNum;
      case "-":
        return leftNum - rightNum;
      case "*":
        return leftNum * rightNum;
      case "/":
        if (rightNum === 0) {
          throw new FilterExecutorError("Division by zero");
        }
        return leftNum / rightNum;
      default:
        throw new FilterExecutorError(`Unknown arithmetic operator: ${String(expr.operator)}`);
    }
  }

  /**
   * Check if a value is an xsd:dayTimeDuration.
   */
  private isDayTimeDurationValue(value: ExpressionResult): boolean {
    if (value instanceof Literal) {
      const datatypeValue = value.datatype?.value || "";
      return datatypeValue === "http://www.w3.org/2001/XMLSchema#dayTimeDuration";
    }
    return false;
  }

  /**
   * Check if a value is an xsd:yearMonthDuration.
   */
  private isYearMonthDurationValue(value: ExpressionResult): boolean {
    if (value instanceof Literal) {
      const datatypeValue = value.datatype?.value || "";
      return datatypeValue === "http://www.w3.org/2001/XMLSchema#yearMonthDuration";
    }
    return false;
  }

  /**
   * Convert a value to a numeric type.
   * Handles: number, Literal with numeric datatype, string representation.
   */
  private toNumericValue(value: ExpressionResult): number {
    if (typeof value === "number") {
      return value;
    }

    if (value instanceof Literal) {
      const datatypeValue = value.datatype?.value || "";
      // Handle numeric datatypes
      if (
        datatypeValue.includes("#integer") ||
        datatypeValue.includes("#decimal") ||
        datatypeValue.includes("#double") ||
        datatypeValue.includes("#float")
      ) {
        const num = parseFloat(value.value);
        if (!isNaN(num)) {
          return num;
        }
      }
      // Try to parse as number anyway
      const num = parseFloat(value.value);
      if (!isNaN(num)) {
        return num;
      }
    }

    if (typeof value === "string") {
      const num = parseFloat(value);
      if (!isNaN(num)) {
        return num;
      }
    }

    // If value has a .value property (like RDF terms)
    if (value && typeof value === "object" && "value" in value) {
      const num = parseFloat(String(value.value));
      if (!isNaN(num)) {
        return num;
      }
    }

    throw new FilterExecutorError(`Cannot convert to number: ${value}`);
  }

  /**
   * Check if a value represents an xsd:dateTime or xsd:date.
   */
  private isDateTimeValue(value: ExpressionResult): boolean {
    if (value instanceof Literal) {
      const datatypeValue = value.datatype?.value || "";
      if (datatypeValue.includes("#dateTime") || datatypeValue.includes("#date")) {
        return true;
      }
      // Try to detect ISO date format in string value
      const datePattern = /^\d{4}-\d{2}-\d{2}(T|\s)/;
      return datePattern.test(value.value);
    }
    if (typeof value === "string") {
      const datePattern = /^\d{4}-\d{2}-\d{2}(T|\s)/;
      return datePattern.test(value);
    }
    return false;
  }

  /**
   * Check if a value represents a pure xsd:date (not xsd:dateTime).
   * Used to distinguish date-only subtraction from dateTime subtraction.
   */
  private isDateValue(value: ExpressionResult): boolean {
    if (value instanceof Literal) {
      const datatypeValue = value.datatype?.value || "";
      // Only match xsd:date, NOT xsd:dateTime
      return datatypeValue === "http://www.w3.org/2001/XMLSchema#date";
    }
    return false;
  }

  /**
   * Check if a value represents an xsd:time.
   * Used for time subtraction (time - time = dayTimeDuration).
   */
  private isTimeValue(value: ExpressionResult): boolean {
    if (value instanceof Literal) {
      const datatypeValue = value.datatype?.value || "";
      return datatypeValue === "http://www.w3.org/2001/XMLSchema#time";
    }
    return false;
  }

  /**
   * Evaluate a SPARQL function call expression.
   *
   * Uses a function registry pattern for most functions, with special handling
   * for functions that require lazy evaluation (COALESCE, IF) or instance state (byUUID).
   *
   * @param expr - Function call expression
   * @param solution - Current solution mapping
   * @returns Function result
   */
  private evaluateFunction(expr: unknown, solution: SolutionMapping): boolean | string | number | undefined | unknown {
    const typedExpr = expr as { function: string | { value: string }; args: Expression[] };

    // Extract function name from string or IRI
    const funcName = this.extractFunctionName(typedExpr.function);

    // Handle special functions that require lazy evaluation or instance state
    const specialResult = this.evaluateSpecialFunction(funcName, typedExpr.args, solution);
    if (specialResult !== undefined) {
      return specialResult.value;
    }

    // Look up function in registry
    const handler = functionHandlers.get(funcName);
    if (!handler) {
      throw new FilterExecutorError(`Unknown function: ${funcName}`);
    }

    // Create evaluation context
    const ctx: FunctionContext = {
      evaluateExpression: (e, s) => this.evaluateExpression(e, s),
      getTermFromExpression: (e, s) => this.getTermFromExpression(e, s),
      getStringValue: (v) => this.getStringValue(v),
      solution,
      isYearMonthDurationValue: (v) => this.isYearMonthDurationValue(v),
      isDayTimeDurationValue: (v) => this.isDayTimeDurationValue(v),
    };

    return handler(typedExpr.args, ctx);
  }

  /**
   * Extract function name from string or IRI reference.
   */
  private extractFunctionName(func: string | { value: string }): string {
    if (typeof func === "string") {
      return func.toLowerCase();
    }
    if (func && typeof func === "object" && "value" in func) {
      // For IRI functions like exo:dateDiffMinutes, extract local name from IRI
      const iri = func.value;
      const localName = iri.includes("#") ? iri.split("#").pop() : iri.split("/").pop();
      return (localName || iri).toLowerCase();
    }
    throw new FilterExecutorError(`Unknown function format: ${String(func)}`);
  }

  /**
   * Handle special functions that require lazy evaluation or instance state.
   * Returns { value: result } if handled, undefined if not a special function.
   */
  private evaluateSpecialFunction(
    funcName: string,
    args: Expression[],
    solution: SolutionMapping
  ): { value: unknown } | undefined {
    switch (funcName) {
      case "coalesce":
        // COALESCE evaluates arguments lazily, returning first non-error, non-unbound value
        for (const arg of args) {
          try {
            const value = this.evaluateExpression(arg, solution);
            if (value !== undefined && value !== null) {
              return { value };
            }
          } catch {
            // Skip errors and try next argument
            continue;
          }
        }
        // All arguments were unbound or errored - return undefined (unbound)
        return { value: undefined };

      case "if": {
        // IF requires exactly 3 arguments: condition, thenExpr, elseExpr
        if (!args || args.length !== 3) {
          throw new FilterExecutorError("IF requires exactly 3 arguments");
        }
        const condition = this.evaluateExpression(args[0], solution);
        const conditionBool = this.toBoolean(condition);
        const result = conditionBool
          ? this.evaluateExpression(args[1], solution)
          : this.evaluateExpression(args[2], solution);
        return { value: result };
      }

      case "byuuid":
        // Exocortex extension function - requires instance state (tripleStore, uuidCache)
        return { value: this.evaluateByUUID({ type: "function", function: "byuuid", args } as import("../algebra/AlgebraOperation").FunctionCallExpression, solution) };

      default:
        return undefined;
    }
  }

  private getTermFromExpression(expr: Expression, solution: SolutionMapping): unknown {
    const varExpr = expr as { type: string; name?: string };
    if (varExpr.type === "variable" && varExpr.name) {
      return solution.get(varExpr.name);
    }
    return undefined;
  }

  /**
   * Extract raw string value from expression result.
   * Handles Literal/IRI objects properly (using .value instead of toString()).
   */
  private getStringValue(value: ExpressionResult): string {
    if (value === null || value === undefined) {
      return "";
    }
    // If it's an RDF term with a value property, use that
    if (typeof value === "object" && "value" in value) {
      return String(value.value);
    }
    return String(value);
  }

  /**
   * Convert a value to boolean for use in IF conditions.
   * Per SPARQL Effective Boolean Value (EBV) rules:
   * - boolean true/false → as-is
   * - numeric non-zero → true, zero/NaN → false
   * - non-empty string → true, empty string → false
   * - Literal with boolean datatype → parse as boolean
   * - Literal with numeric datatype → parse as numeric, apply numeric rules
   * - Other → truthy coercion
   */
  private toBoolean(value: ExpressionResult): boolean {
    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "number") {
      return !isNaN(value) && value !== 0;
    }

    if (typeof value === "string") {
      return value.length > 0;
    }

    if (value instanceof Literal) {
      const datatypeValue = value.datatype?.value || "";

      // Handle boolean datatype
      if (datatypeValue.includes("#boolean")) {
        return value.value === "true" || value.value === "1";
      }

      // Handle numeric datatypes
      if (
        datatypeValue.includes("#integer") ||
        datatypeValue.includes("#decimal") ||
        datatypeValue.includes("#double") ||
        datatypeValue.includes("#float")
      ) {
        const num = parseFloat(value.value);
        return !isNaN(num) && num !== 0;
      }

      // For strings, non-empty is true
      return value.value.length > 0;
    }

    // For other values (IRI, BlankNode), use truthy coercion
    return Boolean(value);
  }

  /**
   * Evaluate exo:byUUID() function.
   * Resolves a UUID string to the full obsidian://vault/... URI using O(1) index lookup.
   *
   * SPARQL Usage:
   *   BIND(exo:byUUID('uuid-string') AS ?subject)
   *   ?subject ?p ?o
   *
   * Or in FILTER:
   *   FILTER(?s = exo:byUUID('uuid-string'))
   *
   * Performance: O(1) lookup via UUID index vs O(n) scan with FILTER(CONTAINS()).
   *
   * @param expr - Function call expression with UUID string argument
   * @param solution - Current solution mapping
   * @returns IRI if UUID found, undefined if not found (results in unbound/error)
   */
  private evaluateByUUID(expr: import("../algebra/AlgebraOperation").FunctionCallExpression, solution: SolutionMapping): IRI | undefined {
    if (!expr.args || expr.args.length !== 1) {
      throw new FilterExecutorError("exo:byUUID requires exactly 1 argument (UUID string)");
    }

    // Get the UUID argument - evaluate in case it's a variable or expression
    const uuidArg = this.evaluateExpression(expr.args[0], solution);
    const uuid = this.getStringValue(uuidArg);

    if (!uuid) {
      return undefined;
    }

    // Normalize UUID to lowercase for consistent lookup
    const normalizedUUID = uuid.toLowerCase();

    // Check cache first
    if (this.uuidCache.has(normalizedUUID)) {
      const cached = this.uuidCache.get(normalizedUUID);
      return cached ?? undefined;
    }

    // If no triple store is set, we cannot perform UUID lookup
    if (!this.tripleStore) {
      this.uuidCache.set(normalizedUUID, null);
      return undefined;
    }

    // Use synchronous lookup if available (required for expression evaluation)
    if (this.tripleStore.findSubjectsByUUIDSync) {
      const subjects = this.tripleStore.findSubjectsByUUIDSync(normalizedUUID);
      if (subjects.length === 0) {
        this.uuidCache.set(normalizedUUID, null);
        return undefined;
      }
      // Return first matching subject (UUID should be unique)
      const result = subjects[0] as IRI;
      this.uuidCache.set(normalizedUUID, result);
      return result;
    }

    // Fallback: no sync method available
    this.uuidCache.set(normalizedUUID, null);
    return undefined;
  }

  /**
   * Synchronous version of UUID lookup for use in pre-cached scenarios.
   * Call this method to pre-populate the UUID cache before query execution.
   *
   * @param uuid - UUID string to look up
   * @param result - IRI result from async lookup, or null if not found
   */
  cacheUUIDResult(uuid: string, result: IRI | null): void {
    const normalizedUUID = uuid.toLowerCase();
    this.uuidCache.set(normalizedUUID, result);
  }

  /**
   * Get cached UUID result.
   * Returns undefined if not in cache, null if cached as "not found", IRI if found.
   */
  getCachedUUID(uuid: string): IRI | null | undefined {
    const normalizedUUID = uuid.toLowerCase();
    if (this.uuidCache.has(normalizedUUID)) {
      return this.uuidCache.get(normalizedUUID);
    }
    return undefined;
  }
}
