import type {
  AlgebraOperation,
  AggregateExpression,
  Expression,
  IRI as AlgebraIRI,
  PropertyPath,
  Triple as AlgebraTriple,
  TripleElement,
} from "../algebra/AlgebraOperation";
import { Namespace } from "../../../domain/models/rdf/Namespace";
import type { ITripleStore } from "../../../interfaces/ITripleStore";
import { PropertyHierarchyResolvingStore } from "../PropertyHierarchyResolvingStore";

/**
 * Query predicate analyzer — phase 1a of RFC 308a52c3 «Загрузка по запросу».
 *
 * Answers ONE question: which predicates must be loaded so that the engine
 * (`ExoQLQueryExecutor` with both store decorators, the CLI default) returns the
 * same answer as over the full graph. It does NOT change loading, the cache or the
 * engine; `query --prune-report` (phase 1b) prints its result, the oracle (phase 2)
 * checks it, the cache layout (phase 3b) consumes it.
 *
 * The answer is derived from what the engine READS, not from a list:
 * - every constant predicate of every triple pattern and property path, after
 *   prefix expansion (sparqljs expands prefixes at parse time);
 * - the class bridge (`ClassHierarchyResolvingStore`) reads class labels to map a
 *   symbolic class IRI to its file IRI — RFC Д1 adds its six predicates when a
 *   predicate of P' that can reach the store is a hierarchy or membership predicate
 *   (a constant of the query, a predicate a namespace filter admits — a bound
 *   variable still goes through the class decorator — or a sub-property the
 *   decorator widens to);
 * - `exo:byUUID` looks a subject up by the UUID index of every LOADED subject — not
 *   only assets with `exo:Asset_uid` (a materialized statement edge, a note without
 *   the key): no predicate set guarantees it, so it is a full load;
 * - the sub-property decorator (`PropertyHierarchyResolvingStore`) widens a constant
 *   predicate to its transitive sub-properties AND builds that index from the store
 *   itself (`exo:Property_superProperty` + `exo:Asset_label` of the declaration
 *   ends) — both the sub-properties and the declarations must be loaded;
 * - the inferred layer is part of the default graph and splits by predicate like
 *   any other triple: nothing to add here (the loader must take it with P').
 *
 * Anything the analyzer cannot bound returns `mode: "full"` with the reason — never
 * a guess (fail-safe, RFC Д1).
 */

/** Why the analyzer refuses to prune. */
export type FullLoadReason =
  | { kind: "update" }
  | { kind: "describe" }
  | { kind: "service"; endpoint: string }
  | { kind: "graph" }
  | { kind: "quoted-triple" }
  | { kind: "variable-predicate"; variable: string }
  | { kind: "zero-length-path-free-subject" }
  | { kind: "class-bridge-path-free-subject" }
  | { kind: "free-subject-path-order" }
  | { kind: "namespace-filter-order" }
  | { kind: "uuid-lookup" }
  | { kind: "namespace-filter-without-predicate-list"; variable: string };

/** Why a predicate is in P'. */
export type PredicateSource =
  | "query"
  | "class-bridge"
  | "sub-property"
  | "sub-property-declarations"
  | "namespace-filter";

export interface PredicateAnalysisContext {
  /**
   * Parent predicate IRI → its TRANSITIVE sub-properties, exactly as
   * `PropertyHierarchyResolvingStore` computes them over the FULL graph
   * (`getSubPropertyIndex()`). Phase 1b takes it from the loaded store, phase 3b
   * from the cache manifest.
   */
  subPropertyIndex: ReadonlyMap<string, readonly string[]>;
  /**
   * Every predicate present in the graph (for VL-3: a variable predicate bounded by
   * a namespace filter loads the matching predicates of this list). Absent ⇒ a
   * namespace-bounded variable predicate falls back to full load.
   */
  storePredicates?: Iterable<string>;
}

export type PredicateAnalysis =
  | {
      mode: "prune";
      /** P' — the predicates to load. */
      predicates: ReadonlySet<string>;
      /** Per predicate, every reason it is in P' (for --prune-report). */
      sources: ReadonlyMap<string, ReadonlySet<PredicateSource>>;
    }
  | {
      mode: "full";
      /** Every reason found (deduplicated), in discovery order. */
      reasons: readonly FullLoadReason[];
    };

const EXO_ONTOLOGY_BASE = Namespace.EXOCORTEX_ONTOLOGY_BASE;

const EXO_CLASS_SUPER_CLASS = Namespace.EXO.term("Class_superClass").value;
const RDFS_SUBCLASS_OF = Namespace.RDFS.term("subClassOf").value;
const RDFS_LABEL = Namespace.RDFS.term("label").value;
const EXO_ASSET_LABEL = Namespace.EXO.term("Asset_label").value;
const EXO_INSTANCE_CLASS = Namespace.EXO.term("Instance_class").value;
const RDF_TYPE = Namespace.RDF.term("type").value;
const EXO_PROPERTY_SUPER_PROPERTY = Namespace.EXO.term(
  "Property_superProperty",
).value;

/** `ClassHierarchyResolvingStore.HIERARCHY_PREDICATES`. */
const HIERARCHY_PREDICATES: ReadonlySet<string> = new Set([
  EXO_CLASS_SUPER_CLASS,
  RDFS_SUBCLASS_OF,
]);
/** `ClassHierarchyResolvingStore.MEMBERSHIP_PREDICATES`. */
const MEMBERSHIP_PREDICATES: ReadonlySet<string> = new Set([
  EXO_INSTANCE_CLASS,
  RDF_TYPE,
]);
/** Every predicate on which the class bridge acts (hierarchy ∪ membership). */
const BRIDGE_PREDICATES: ReadonlySet<string> = new Set([
  ...HIERARCHY_PREDICATES,
  ...MEMBERSHIP_PREDICATES,
]);
/**
 * RFC 308a52c3 Д1: the class bridge skeleton — six predicates. ⚠ By mechanism the
 * bridge itself reads only the two LABEL predicates (`buildIndex`); the hierarchy and
 * membership predicates reach the store only as predicates of P'. The list is the
 * RFC's (principle 7); narrowing it is a cost question for the layout spike.
 */
export const CLASS_BRIDGE_SKELETON: readonly string[] = [
  EXO_CLASS_SUPER_CLASS,
  RDFS_SUBCLASS_OF,
  RDFS_LABEL,
  EXO_ASSET_LABEL,
  EXO_INSTANCE_CLASS,
  RDF_TYPE,
];
/** What `PropertyHierarchyResolvingStore.buildIndex` reads from the store. */
export const SUB_PROPERTY_DECLARATION_SKELETON: readonly string[] = [
  EXO_PROPERTY_SUPER_PROPERTY,
  EXO_ASSET_LABEL,
];
/** `PropertyHierarchyResolvingStore.CLASS_BRIDGE_PREDICATES` — never widened. */
const NOT_WIDENED: ReadonlySet<string> = new Set([
  EXO_CLASS_SUPER_CLASS,
  EXO_INSTANCE_CLASS,
]);

/** A namespace test on a variable predicate: `CONTAINS|STRSTARTS(STR(?p), "lit")`. */
interface NamespaceTest {
  variable: string;
  kind: "contains" | "strstarts";
  literal: string;
  /** The group of the FILTER — it bounds the variable in this group only. */
  group: number;
}

interface VariablePredicateOccurrence {
  variable: string;
  group: number;
}

class AnalysisState {
  readonly queryPredicates = new Set<string>();
  readonly reasons: FullLoadReason[] = [];
  readonly variablePredicates: VariablePredicateOccurrence[] = [];
  readonly namespaceTests: NamespaceTest[] = [];
  /** The predicate IRIs of every property path whose subject is free. */
  readonly freeSubjectPaths: string[][] = [];
  /**
   * LIMIT/OFFSET, SAMPLE, GROUP_CONCAT, SUM/AVG (floating-point addition in row order),
   * a custom aggregate or GROUP BY with variables: the answer depends on row ORDER.
   */
  orderSensitive = false;
  private lastGroup = 0;
  classBridge = false;

  /** A new group: OPTIONAL, UNION and MINUS right sides, subqueries, EXISTS, LATERAL. */
  newGroup(): number {
    this.lastGroup += 1;
    return this.lastGroup;
  }

  fail(reason: FullLoadReason): void {
    const key = JSON.stringify(reason);
    if (!this.reasons.some((r) => JSON.stringify(r) === key))
      this.reasons.push(reason);
  }
}

/**
 * The sub-property index of a LOADED store, computed by the decorator itself
 * (`PropertyHierarchyResolvingStore`), so the analyzer and the engine share one
 * index. Which predicates the decorator widens at all (ontology predicates except
 * the two class-bridge ones) is MIRRORED here in `closureOf` — not shared; axes
 * pin it on both sides.
 */
export function computeSubPropertyIndex(
  store: ITripleStore,
): Promise<Map<string, string[]>> {
  return new PropertyHierarchyResolvingStore(store).getSubPropertyIndex();
}

/**
 * Analyze a translated query — the output of `ExoQLAlgebraTranslator.translate`,
 * before the optimizer. The CLI's `AlgebraOptimizer.optimize` reorders and pushes
 * filters without reading the store (`optimizeAsync` with a store — the UUID rewrite
 * of `FilterContainsOptimizer` — has no production caller).
 */
export function analyzeAlgebraPredicates(
  operation: AlgebraOperation,
  context: PredicateAnalysisContext,
): PredicateAnalysis {
  const state = new AnalysisState();
  walkOperation(operation, state.newGroup(), state);
  return finish(state, context);
}

/**
 * Analyze a parsed query (`ExoQLParser.parse`). An UPDATE is a full load; anything
 * else is translated and analyzed (the translator throws on what the engine
 * cannot run, so does this function).
 */
export function analyzeParsedQuery(
  parsed: { type: string },
  translate: (query: never) => AlgebraOperation,
  context: PredicateAnalysisContext,
): PredicateAnalysis {
  if (parsed.type === "update") {
    return { mode: "full", reasons: [{ kind: "update" }] };
  }
  return analyzeAlgebraPredicates(translate(parsed as never), context);
}

function finish(
  state: AnalysisState,
  context: PredicateAnalysisContext,
): PredicateAnalysis {
  // VL-3 — a variable predicate is admitted only when a namespace filter of its own
  // group bounds it; otherwise it reads every predicate.
  let storePredicates: string[] | null = null;
  let admittedVariablePredicate = false;
  const namespacePredicates = new Set<string>();
  for (const occurrence of state.variablePredicates) {
    const tests = state.namespaceTests.filter(
      (test) =>
        test.variable === occurrence.variable && covers(test, occurrence),
    );
    if (tests.length === 0) {
      state.fail({ kind: "variable-predicate", variable: occurrence.variable });
      continue;
    }
    if (context.storePredicates === undefined) {
      state.fail({
        kind: "namespace-filter-without-predicate-list",
        variable: occurrence.variable,
      });
      continue;
    }
    storePredicates ??= [...context.storePredicates];
    admittedVariablePredicate = true;
    for (const predicate of storePredicates) {
      if (tests.every((test) => namespaceTestHolds(test, predicate))) {
        namespacePredicates.add(predicate);
      }
    }
  }

  // The sub-property closure of every CONSTANT ontology predicate of the query: the
  // decorator widens only those (a bound variable goes through `matchExactPredicate`),
  // except the two class-bridge predicates. The closure in the index is already
  // transitive — one lookup is the fixed point.
  const closureOf = (predicate: string): readonly string[] =>
    predicate.startsWith(EXO_ONTOLOGY_BASE) && !NOT_WIDENED.has(predicate)
      ? (context.subPropertyIndex.get(predicate) ?? [])
      : [];

  // A free subject takes its start nodes from EVERY triple; the class bridge then
  // acts on a symbolic class node that may occur only under some other predicate.
  for (const iris of state.freeSubjectPaths) {
    const reached = [...iris, ...iris.flatMap((iri) => closureOf(iri))];
    if (reached.some((iri) => BRIDGE_PREDICATES.has(iri))) {
      state.fail({ kind: "class-bridge-path-free-subject" });
    }
  }

  // Row ORDER: a pattern with a CONSTANT predicate keeps the relative order of its
  // matches in a cut store (the store indexes by predicate and the cut keeps all of
  // it), but a free subject takes its start nodes in the order each node FIRST appears
  // in the whole graph — and that order moves when other predicates are cut away. An
  // answer that depends on order (LIMIT/OFFSET, SAMPLE, GROUP_CONCAT, SUM/AVG, GROUP BY) differs.
  if (state.freeSubjectPaths.length > 0 && state.orderSensitive) {
    state.fail({ kind: "free-subject-path-order" });
  }
  // A variable predicate admitted by a namespace filter reorders too: with a constant
  // object the store answers through its object index, grouped by subject in the order
  // each subject FIRST meets that object under ANY predicate — a cut predicate moves it.
  if (admittedVariablePredicate && state.orderSensitive) {
    state.fail({ kind: "namespace-filter-order" });
  }

  if (state.reasons.length > 0) {
    return { mode: "full", reasons: state.reasons };
  }

  const sources = new Map<string, Set<PredicateSource>>();
  const add = (predicate: string, source: PredicateSource): void => {
    let set = sources.get(predicate);
    if (!set) {
      set = new Set<PredicateSource>();
      sources.set(predicate, set);
    }
    set.add(source);
  };

  for (const predicate of state.queryPredicates) add(predicate, "query");
  for (const predicate of namespacePredicates)
    add(predicate, "namespace-filter");

  const closure: string[] = [];
  for (const predicate of state.queryPredicates) {
    for (const sub of closureOf(predicate)) closure.push(sub);
  }
  for (const sub of closure) add(sub, "sub-property");
  if (closure.length > 0) {
    for (const predicate of SUB_PROPERTY_DECLARATION_SKELETON)
      add(predicate, "sub-property-declarations");
  }

  // The bridge acts on every predicate of P' that reaches the store through the class
  // decorator: a namespace-admitted predicate bound at match time (VALUES, a join) and
  // a sub-property the decorator matches below a widened parent, not only a constant.
  const bridge =
    state.classBridge ||
    [...namespacePredicates, ...closure].some((p) => BRIDGE_PREDICATES.has(p));
  if (bridge) {
    for (const predicate of CLASS_BRIDGE_SKELETON)
      add(predicate, "class-bridge");
  }

  return { mode: "prune", predicates: new Set(sources.keys()), sources };
}

/**
 * VL-3 scope: a FILTER bounds a variable predicate only in its own group — the
 * filter applies to every row of that group (SPARQL places it over the whole
 * group), and only to those. A pattern behind OPTIONAL, UNION, MINUS, a subquery,
 * EXISTS or LATERAL is another group: rows the filter never sees reach the answer.
 */
function covers(
  test: NamespaceTest,
  occurrence: VariablePredicateOccurrence,
): boolean {
  return test.group === occurrence.group;
}

function namespaceTestHolds(test: NamespaceTest, predicate: string): boolean {
  return test.kind === "contains"
    ? predicate.includes(test.literal)
    : predicate.startsWith(test.literal);
}

/**
 * Exhaustive walk over `AlgebraOperation` — the model is
 * `PatternTranslator.translatePattern` (`switch` + `default: throw`), NOT
 * `AlgebraOptimizer` (which silently skips unknown types). A new operation type
 * fails to compile here (`never`) and throws at run time.
 *
 * `group` — the SPARQL group the node belongs to (VL-3). It stays the same through
 * join, the left of OPTIONAL / MINUS / LATERAL and the input of FILTER and BIND;
 * every other edge starts a new group.
 */
function walkOperation(
  op: AlgebraOperation,
  group: number,
  state: AnalysisState,
): void {
  switch (op.type) {
    case "bgp":
      for (const triple of op.triples) walkTriple(triple, group, state);
      return;
    case "filter": {
      walkExpression(op.expression, state);
      for (const test of namespaceTests(op.expression, group))
        state.namespaceTests.push(test);
      walkOperation(op.input, group, state);
      return;
    }
    case "join":
      walkOperation(op.left, group, state);
      walkOperation(op.right, group, state);
      return;
    case "leftjoin":
      walkOperation(op.left, group, state);
      walkOperation(op.right, state.newGroup(), state);
      if (op.expression) walkExpression(op.expression, state);
      return;
    case "union":
      walkOperation(op.left, state.newGroup(), state);
      walkOperation(op.right, state.newGroup(), state);
      return;
    case "minus":
      walkOperation(op.left, group, state);
      walkOperation(op.right, state.newGroup(), state);
      return;
    case "values":
      return;
    case "slice":
      state.orderSensitive = true;
      walkOperation(op.input, group, state);
      return;
    case "project":
    case "distinct":
    case "reduced":
      walkOperation(op.input, group, state);
      return;
    case "orderby":
      for (const comparator of op.comparators)
        walkExpression(comparator.expression, state);
      walkOperation(op.input, group, state);
      return;
    case "group":
      // GROUP BY keys a group by the LEXICAL value of its terms and binds the group
      // variable to the term of the group's FIRST row (AggregateExecutor), so "5" and
      // "5"^^xsd:integer share a group and row order picks the term (review round 2).
      if (op.variables.length > 0) state.orderSensitive = true;
      for (const aggregate of op.aggregates)
        walkAggregate(aggregate.expression, state);
      for (const having of op.having ?? []) walkExpression(having, state);
      walkOperation(op.input, group, state);
      return;
    case "extend":
      if (op.expression.type === "aggregate")
        walkAggregate(op.expression, state);
      else walkExpression(op.expression, state);
      walkOperation(op.input, group, state);
      return;
    case "subquery":
      walkOperation(op.query, state.newGroup(), state);
      return;
    case "lateraljoin":
      walkOperation(op.left, group, state);
      walkOperation(op.right, state.newGroup(), state);
      return;
    case "construct":
      // The template only WRITES the answer; the WHERE clause is what is read.
      walkOperation(op.where, state.newGroup(), state);
      return;
    case "ask":
      walkOperation(op.where, state.newGroup(), state);
      return;
    case "describe":
      state.fail({ kind: "describe" });
      return;
    case "service":
      state.fail({ kind: "service", endpoint: op.endpoint });
      return;
    case "graph":
      // Named graphs route through `matchInGraph` / `getNamedGraphs` — outside the
      // predicate model of the cache. Not in the RFC list; fail-safe.
      state.fail({ kind: "graph" });
      return;
    default: {
      const unknown: never = op;
      throw new Error(
        `QueryPredicateAnalyzer: unsupported operation type ${(unknown as { type: string }).type}`,
      );
    }
  }
}

function walkTriple(
  triple: AlgebraTriple,
  group: number,
  state: AnalysisState,
): void {
  if (triple.subject.type === "quoted" || triple.object.type === "quoted") {
    state.fail({ kind: "quoted-triple" });
    return;
  }
  const predicate = triple.predicate;
  if (predicate.type === "path") {
    const iris: string[] = [];
    collectPathIris(predicate, iris);
    for (const iri of iris) {
      state.queryPredicates.add(iri);
      if (HIERARCHY_PREDICATES.has(iri) || MEMBERSHIP_PREDICATES.has(iri))
        state.classBridge = true;
    }
    // A path that matches zero steps with a free SUBJECT enumerates every node of
    // the graph as a start (PropertyPathExecutor.resolveElement → match()), and the
    // zero-step row exists iff the node occurs in ANY triple.
    if (isNullable(predicate) && isFree(triple.subject)) {
      state.fail({ kind: "zero-length-path-free-subject" });
    }
    // Judged in `finish` against the sub-property closure: the class bridge rewrites
    // the edges of a SYMBOLIC class start node, and a free subject takes its start
    // nodes from every triple — a symbolic class IRI that occurs only under some other
    // predicate (a rule target, a domain) is a start in the full graph only.
    if (isFree(triple.subject)) state.freeSubjectPaths.push(iris);
    return;
  }
  if (predicate.type === "variable") {
    state.variablePredicates.push({ variable: predicate.value, group });
    return;
  }
  if (predicate.type !== "iri") {
    // A blank node or literal in predicate position is not a valid pattern; read all.
    state.fail({ kind: "variable-predicate", variable: `_:${predicate.type}` });
    return;
  }
  state.queryPredicates.add(predicate.value);
  if (HIERARCHY_PREDICATES.has(predicate.value)) state.classBridge = true;
  if (
    MEMBERSHIP_PREDICATES.has(predicate.value) &&
    objectCanBeSymbolicClass(triple.object)
  ) {
    state.classBridge = true;
  }
}

/** A membership object the bridge resolves at match time: a symbolic class IRI, or anything a binding can turn into one. */
function objectCanBeSymbolicClass(object: TripleElement): boolean {
  if (object.type === "iri") return object.value.startsWith(EXO_ONTOLOGY_BASE);
  if (object.type === "literal") return false;
  return true;
}

/**
 * A variable — or a blank node, counted as free CONSERVATIVELY: a free subject can only
 * add full-load reasons, never a predicate, so over-counting never prunes wrongly.
 */
function isFree(element: TripleElement): boolean {
  return element.type === "variable" || element.type === "blank";
}

function isNullable(path: PropertyPath | AlgebraIRI): boolean {
  if (path.type === "iri") return false;
  switch (path.pathType) {
    case "*":
    case "?":
      return true;
    case "+":
    case "^":
      return isNullable(path.items[0]);
    case "/":
      return path.items.every((item) => isNullable(item));
    case "|":
      return path.items.some((item) => isNullable(item));
  }
}

function collectPathIris(path: PropertyPath | AlgebraIRI, out: string[]): void {
  if (path.type === "iri") {
    out.push(path.value);
    return;
  }
  for (const item of path.items) collectPathIris(item, out);
}

function walkAggregate(
  aggregate: AggregateExpression,
  state: AnalysisState,
): void {
  const fn = aggregate.aggregation;
  if (
    typeof fn !== "string" ||
    fn === "sample" ||
    fn === "group_concat" ||
    fn === "sum" ||
    fn === "avg"
  ) {
    state.orderSensitive = true;
  }
  if (aggregate.expression) walkExpression(aggregate.expression, state);
  if (aggregate.expression2) walkExpression(aggregate.expression2, state);
}

/** Exhaustive over `Expression`: EXISTS patterns are read; `byUUID` reads the UUID index. */
function walkExpression(
  expression: Expression | AggregateExpression,
  state: AnalysisState,
): void {
  switch (expression.type) {
    case "aggregate":
      walkAggregate(expression, state);
      return;
    case "comparison":
    case "arithmetic":
      walkExpression(expression.left, state);
      walkExpression(expression.right, state);
      return;
    case "logical":
      for (const operand of expression.operands) walkExpression(operand, state);
      return;
    case "function":
    case "functionCall":
      if (functionName(expression.function) === "byuuid")
        state.fail({ kind: "uuid-lookup" });
      for (const arg of expression.args) walkExpression(arg, state);
      return;
    case "in":
      walkExpression(expression.expression, state);
      for (const item of expression.list) walkExpression(item, state);
      return;
    case "exists":
      // EXISTS substitutes the current row into its pattern — a separate group.
      walkOperation(expression.pattern, state.newGroup(), state);
      return;
    case "variable":
    case "literal":
      return;
    default: {
      const unknown: never = expression;
      throw new Error(
        `QueryPredicateAnalyzer: unsupported expression type ${(unknown as { type: string }).type}`,
      );
    }
  }
}

/** `FilterExecutor.extractFunctionName` — an IRI function matches by its local name, lower-cased. */
function functionName(fn: string | { value: string }): string {
  if (typeof fn === "string") return fn.toLowerCase();
  const iri = fn.value;
  const localName = iri.includes("#")
    ? iri.split("#").pop()
    : iri.split("/").pop();
  return (localName || iri).toLowerCase();
}

/**
 * The namespace tests a FILTER guarantees for every row it lets through: the
 * top-level conjuncts of the form `CONTAINS|STRSTARTS(STR(?p), "<plain literal>")`.
 * A disjunction, a negation or any other shape guarantees nothing.
 */
function namespaceTests(
  expression: Expression,
  group: number,
): NamespaceTest[] {
  const out: NamespaceTest[] = [];
  const visit = (e: Expression): void => {
    if (e.type === "logical" && e.operator === "&&") {
      for (const operand of e.operands) visit(operand);
      return;
    }
    if (
      e.type !== "function" ||
      (e.function !== "contains" && e.function !== "strstarts")
    )
      return;
    if (e.args.length !== 2) return;
    const [target, needle] = e.args;
    if (
      target.type !== "function" ||
      target.function !== "str" ||
      target.args.length !== 1
    )
      return;
    const variable = target.args[0];
    if (variable.type !== "variable") return;
    if (needle.type !== "literal" || typeof needle.value !== "string") return;
    if (needle.language !== undefined || needle.direction !== undefined) return;
    if (
      needle.datatype !== undefined &&
      needle.datatype !== Namespace.XSD.term("string").value
    )
      return;
    out.push({
      variable: variable.name,
      kind: e.function,
      literal: needle.value,
      group,
    });
  };
  visit(expression);
  return out;
}
