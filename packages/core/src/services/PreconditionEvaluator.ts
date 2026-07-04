import { injectable } from "tsyringe";
import type { ITripleStore } from "../interfaces/ITripleStore";
import type { IQueryBodyResolver } from "../interfaces/IQueryBodyResolver";
import type { PreconditionDefinition } from "../domain/models/CommandDefinition";
import { ExoQLParser } from "../infrastructure/sparql/SPARQLParser";
import { ExoQLAlgebraTranslator } from "../infrastructure/sparql/algebra/AlgebraTranslator";
import { ExoQLQueryExecutor } from "../infrastructure/sparql/executors/QueryExecutor";
import type { AskOperation } from "../infrastructure/sparql/algebra/AlgebraOperation";
import { evaluateWithExoEval } from "../exoql/evaluateWithExoEval";
import { DateFormatter } from "../utilities/DateFormatter";
import type { IClock } from "./IClock";
import { liveClock } from "./IClock";

/**
 * Context passed to host function evaluators.
 */
export interface EvalContext {
  readonly targetIRI: string;
  readonly fileBasename?: string;
  readonly currentFolder?: string;
  readonly filePath?: string;
  readonly assetUid?: string;
  readonly [key: string]: unknown;
}

/** Host function type: receives context, returns availability boolean */
export type HostFunction = (context: EvalContext) => boolean;

/**
 * Evaluates preconditions for dynamic commands (RFC-009 §5.4).
 *
 * Supports two evaluation strategies:
 * 1. SPARQL ASK — query evaluated against ITripleStore
 * 2. Host functions — TypeScript functions for non-SPARQL checks
 *
 * Variable substitution (text preprocessing before SPARQL parser):
 * - `$target` → `<targetIRI>` (IRI of the current asset)
 * - `$now` → current ISO 8601 timestamp
 * - `$today` → current date (YYYY-MM-DD)
 *
 * Default behavior:
 * - No precondition → true (permissive: command always available)
 * - SPARQL engine error → false (fail closed for safety)
 * - Registered host function throws → false (fail closed for safety)
 * - Unregistered host function → true on the async {@link evaluate} path
 *   (fail open, permissive for inline buttons); `null` on
 *   {@link evaluateHostFunctionSync} (caller decides — the palette registrar
 *   treats `null` as fail closed to surface misconfiguration). This
 *   asymmetry is intentional and regression-guarded by unit tests.
 *
 * Issue #2429
 */
@injectable()
export class PreconditionEvaluator {
  private readonly hostFunctions = new Map<string, HostFunction>();
  private readonly tripleStore: ITripleStore;
  // Keyed by the RAW sparqlAsk text → at most ONE entry per distinct query (no
  // per-day accumulation). For temporal-token queries the entry records the LOCAL
  // day its `$today`/`$now`/… values were compiled for; a day change REPLACES the
  // entry (the stale-day compiled ASK is overwritten, never leaked). `day` is
  // null for token-free queries (day-independent, never recompiled). Fixes #3819.
  private readonly askCache = new Map<
    string,
    { readonly day: string | null; readonly compiled: AskOperation }
  >();
  private readonly queryBodyResolver?: IQueryBodyResolver;
  private readonly clock: IClock;

  constructor(
    tripleStore: ITripleStore,
    queryBodyResolver?: IQueryBodyResolver,
    options?: { clock?: IClock },
  ) {
    this.tripleStore = tripleStore;
    this.queryBodyResolver = queryBodyResolver;
    this.clock = options?.clock ?? liveClock();
  }

  /**
   * Evaluate whether a command precondition is satisfied.
   *
   * @param precondition - The precondition to evaluate (undefined = always true)
   * @param targetIRI - IRI of the asset being checked
   * @param context - Optional additional context for host functions
   * @returns true if the command should be available, false otherwise
   */
  async evaluate(
    precondition: PreconditionDefinition | undefined,
    targetIRI: string,
    context?: EvalContext,
  ): Promise<boolean> {
    // No precondition = always available (top-level fail-open boundary).
    if (!precondition) return true;

    // Render-scoped result memo (onto-RFC df602adc — SPARQL-M). Keyed by
    // `sparqlAsk` (targetIRI is invariant per memo), lives ONLY for THIS command's
    // availability check — so a leaf reused across sub-branches of the composite
    // tree (the reuse the composite feature introduces — e.g. a factored-out
    // "не-прототип" ASK referenced by both an `all` and a `not` branch) executes
    // the SPARQL ASK once, not once per occurrence. Discarded when evaluate()
    // returns → zero cross-render staleness (the store cannot change mid-tree),
    // and fully independent from the day-aware `askCache` compile cache (#3819).
    const memo = new Map<string, Promise<boolean>>();
    return this.evaluateNode(precondition, targetIRI, context, memo);
  }

  /**
   * Recursive precondition evaluator (onto-RFC df602adc — способ A). Handles the
   * boolean-combinator tree BEFORE the terminal atomic dispatch:
   *   - `broken` sentinel → `false` (fail-CLOSED — an unresolvable/cyclic/
   *     malformed child hides the command);
   *   - `composite {op:'all'}` → every child true; empty list → `false`;
   *   - `composite {op:'any'}` → some child true; empty list → `false`;
   *   - `not` → negation of the single child;
   *   - otherwise the existing atomic dispatch (sparqlAsk / query / hostFunction)
   *     and the terminal `return true` (an atomic with no eval source is
   *     fail-OPEN — unchanged from the pre-composite behaviour).
   *
   * Children are evaluated concurrently (`Promise.all`) and share the render
   * memo, so a reused atomic leaf runs its ASK once even across parallel
   * branches.
   */
  private async evaluateNode(
    precondition: PreconditionDefinition,
    targetIRI: string,
    context: EvalContext | undefined,
    memo: Map<string, Promise<boolean>>,
  ): Promise<boolean> {
    // Broken child sentinel — fail-closed (command hidden).
    if (precondition.broken) return false;

    // AND / OR combinator.
    if (precondition.composite) {
      const { op, children } = precondition.composite;
      // Empty combinator → fail-closed (an `all`/`any` with no children can't be
      // "satisfied" in a meaningful way; matches the RFC's fail-closed default).
      if (children.length === 0) return false;
      const results = await Promise.all(
        children.map((child) =>
          this.evaluateNode(child, targetIRI, context, memo),
        ),
      );
      return op === "all" ? results.every(Boolean) : results.some(Boolean);
    }

    // NOT combinator.
    if (precondition.not) {
      return !(await this.evaluateNode(
        precondition.not,
        targetIRI,
        context,
        memo,
      ));
    }

    // SPARQL ASK evaluation (inline body — legacy path), memoized per render.
    if (precondition.sparqlAsk) {
      return this.evaluateSparqlAskMemoized(
        precondition.sparqlAsk,
        targetIRI,
        memo,
      );
    }

    // exoql__Query reference (RFC c78cc5c8 Phase 1a) — resolve body
    // through IQueryBodyResolver, then route through evaluateWithExoEval
    // (allowlist + flag + executor). Fail closed if resolver is absent
    // or the query asset cannot be loaded.
    if (precondition.query) {
      return this.evaluateQueryRef(precondition.query, targetIRI);
    }

    // Host function evaluation
    if (precondition.hostFunction) {
      return this.evaluateHostFunction(
        precondition.hostFunction,
        targetIRI,
        context,
      );
    }

    return true;
  }

  /**
   * Render-scoped memoized wrapper over {@link evaluateSparqlAsk}. Caches the
   * in-flight PROMISE (not the resolved boolean) keyed by `sparqlAsk` (targetIRI
   * is constant across one memo — see below), so concurrent siblings in one
   * composite tree that reference the same atomic leaf await ONE execution.
   * Cross-tree/cross-render calls each get a fresh memo (see {@link evaluate}) →
   * no staleness.
   */
  private evaluateSparqlAskMemoized(
    sparqlAsk: string,
    targetIRI: string,
    memo: Map<string, Promise<boolean>>,
  ): Promise<boolean> {
    // Keyed by `sparqlAsk` ALONE — collision-free with no separator, because
    // `targetIRI` is INVARIANT across a single render memo: one memo is created
    // per top-level `evaluate()` call and `targetIRI` is threaded unchanged
    // through the whole `evaluateNode` recursion, so every leaf in this tree is
    // evaluated against the same target. Distinct commands / targets each get a
    // fresh memo (see {@link evaluate}).
    const cached = memo.get(sparqlAsk);
    if (cached !== undefined) return cached;
    const pending = this.evaluateSparqlAsk(sparqlAsk, targetIRI);
    memo.set(sparqlAsk, pending);
    return pending;
  }

  private async evaluateQueryRef(
    queryUid: string,
    targetIRI: string,
  ): Promise<boolean> {
    if (!this.queryBodyResolver) return false;
    try {
      const body = await this.queryBodyResolver.resolveSparql(queryUid);
      if (!body) return false;
      const substituted = this.substituteVariables(body, targetIRI);
      const result = await evaluateWithExoEval(substituted, {
        store: this.tripleStore,
      });
      if (result.kind !== "ask") return false;
      return result.result;
    } catch {
      return false;
    }
  }

  /**
   * Register a host function for non-SPARQL preconditions.
   */
  registerHostFunction(name: string, fn: HostFunction): void {
    this.hostFunctions.set(name, fn);
  }

  /**
   * Check if a host function is registered.
   */
  hasHostFunction(name: string): boolean {
    return this.hostFunctions.has(name);
  }

  /**
   * Synchronously evaluate a host-function precondition (Issue #3292).
   *
   * Returns `null` when the named host function is not registered — the
   * caller decides whether absence means "deny" or "allow" (palette
   * registrar treats `null` as "fail closed = false" to surface
   * misconfiguration loudly).
   *
   * Used by surfaces that cannot await an async precondition — notably
   * Obsidian's `addCommand({ checkCallback })`, which is synchronous and
   * runs on every Command Palette open. The async {@link evaluate} method
   * remains the canonical path for inline buttons, layouts, CLI, and any
   * other surface that can wait for SPARQL ASK / `exoql__Query`.
   */
  evaluateHostFunctionSync(
    name: string,
    targetIRI: string,
    context?: EvalContext,
  ): boolean | null {
    if (!this.hostFunctions.has(name)) return null;
    return this.evaluateHostFunction(name, targetIRI, context);
  }

  invalidateCache(): void {
    this.askCache.clear();
  }

  // -- Private --

  private static readonly SENTINEL_IRI = "urn:exocortex:cache-sentinel:target";

  /**
   * Calendar/temporal tokens whose substituted value (see
   * {@link substituteVariables}) changes with the local calendar day. When a
   * `sparqlAsk` contains any of these, the compiled-ASK cache entry must NOT
   * survive across local midnight, so `evaluateSparqlAsk` scopes the cache
   * entry to the local day for such queries.
   *
   * `$today`/`$yesterday`/`$this*Start`/`$last*Start` are exactly the date
   * tokens rewritten by `substituteVariables`. `$now` is included deliberately:
   * folding it into a *day*-granular key is more honest than freezing its
   * instant forever (the prior behaviour of a raw-text key). Residual sub-day
   * staleness — the `$now` value stays frozen to the first-compile instant
   * *within* one local day — is intended: precondition availability granularity
   * is the day, not the minute. (`$target` is excluded — it is re-instantiated
   * per evaluation from the SENTINEL and never baked into a date value.)
   */
  private static readonly TEMPORAL_TOKEN =
    /\$(?:now|today|yesterday|thisWeekStart|lastWeekStart|thisMonthStart|lastMonthStart|thisYearStart)\b/;

  private compileAsk(sparqlAsk: string): AskOperation | null {
    const processedQuery = this.substituteVariables(
      sparqlAsk,
      PreconditionEvaluator.SENTINEL_IRI,
    );
    const parser = new ExoQLParser();
    const parsed = parser.parse(processedQuery);
    const translator = new ExoQLAlgebraTranslator();
    const algebra = translator.translate(parsed);

    const executor = new ExoQLQueryExecutor(this.tripleStore);
    if (!executor.isAskQuery(algebra)) {
      return null;
    }
    return algebra as AskOperation;
  }

  private evaluateHostFunction(
    name: string,
    targetIRI: string,
    context?: EvalContext,
  ): boolean {
    const fn = this.hostFunctions.get(name);
    if (!fn) return true;

    const evalContext: EvalContext = context
      ? { ...context, targetIRI }
      : { targetIRI };

    try {
      return fn(evalContext);
    } catch {
      // A registered host function that throws is treated as fail-closed
      // (command hidden), consistent with the SPARQL-engine-error policy.
      // This matters most for `evaluateHostFunctionSync`, which runs inside
      // Obsidian's synchronous `addCommand({ checkCallback })` on every
      // Command Palette open — an uncaught throw there surfaces as a
      // palette-breaking exception. The async inline-button path also relied
      // on its own caller-side catch; centralising here makes both surfaces
      // uniformly graceful. Note this only governs the registered-but-errored
      // case; the unregistered fail-open/closed asymmetry above is unchanged.
      return false;
    }
  }

  private async evaluateSparqlAsk(
    sparqlAsk: string,
    targetIRI: string,
  ): Promise<boolean> {
    try {
      const isTemporal = PreconditionEvaluator.TEMPORAL_TOKEN.test(sparqlAsk);
      const day = isTemporal
        ? DateFormatter.toDateString(this.clock.now())
        : null;
      let entry = this.askCache.get(sparqlAsk);
      // Recompile when absent, OR when a temporal query's cached entry was
      // compiled for a DIFFERENT local day — the day change OVERWRITES the same
      // raw-text key, so there is at most one entry per query (no stale-day
      // leak) and the compiled $today/$now/... never survives local midnight.
      // Token-free queries (day === null) are compiled once and reused forever
      // (byte-identical to the pre-fix cache-hit path).
      if (entry === undefined || (isTemporal && entry.day !== day)) {
        const result = this.compileAsk(sparqlAsk);
        if (!result) return false;
        entry = { day, compiled: result };
        this.askCache.set(sparqlAsk, entry);
      }

      const instantiated = JSON.parse(
        JSON.stringify(entry.compiled).replaceAll(
          PreconditionEvaluator.SENTINEL_IRI,
          targetIRI,
        ),
      ) as AskOperation;

      const executor = new ExoQLQueryExecutor(this.tripleStore);
      return await executor.executeAsk(instantiated);
    } catch {
      return false;
    }
  }

  /**
   * Substitute custom variables in SPARQL query string.
   * This is TEXT replacement, NOT SPARQL variable binding.
   *
   * Variables:
   * - $target → <targetIRI> (wrapped in angle brackets)
   * - $now → "2026-03-31T10:00:00.000Z"^^xsd:dateTime (UTC instant)
   * - $today → "2026-03-31"^^xsd:date (LOCAL calendar day)
   * - $yesterday → "2026-03-30"^^xsd:date (LOCAL)
   * - $thisWeekStart → "2026-03-30"^^xsd:date (Monday, LOCAL)
   * - $lastWeekStart → "2026-03-23"^^xsd:date (prev Monday, LOCAL)
   * - $thisMonthStart → "2026-03-01"^^xsd:date (LOCAL)
   * - $lastMonthStart → "2026-02-01"^^xsd:date (LOCAL)
   * - $thisYearStart → "2026-01-01"^^xsd:date (LOCAL)
   *
   * The list above is the COMPLETE set of supported tokens. EVERY token (including
   * `$target`) is matched with a trailing `\b` word boundary, so an unrecognized
   * `$token` that merely shares a prefix with a supported one is left LITERAL
   * rather than partially rewritten into malformed SPARQL. Examples of real
   * prefix-colliding tokens (all executor / SubstitutionToken forms, NOT
   * precondition tokens): `$todayStart` (else → `"…"^^xsd:dateStart`),
   * `$nowCompact`/`$nowLocal`, and `$targetFolder`/`$targetStart`/`$targetClassSelf`
   * (else `$target` → `<IRI>Folder`). Left literal, the unknown token fails to
   * compile and the precondition FAILS CLOSED (evaluateSparqlAsk's bare catch →
   * `false` → command hidden) — a predictable, safe outcome, unlike a
   * silently-mangled query that could return the wrong ASK boolean (#3811 review).
   *
   * All calendar-date tokens derive from ONE shared LOCAL wall-clock day
   * (`DateFormatter.toDateString` / local `Date` getters + plain local
   * `new Date(y, mo, d - N)` arithmetic), consistent with the rest of the
   * `$today` family (#3806/#3808/#3809). `$now` stays a UTC `xsd:dateTime`
   * instant — an instant is timezone-absolute.
   *
   * Formerly `$today` was sliced from `clock.now().toISOString()` (UTC) while
   * its sibling tokens derived from a hardcoded `ALMATY_OFFSET_MS` local shift,
   * so between local midnight and 05:00 Asia/Almaty `$today` equalled
   * `$yesterday` (internally absurd) and any visibility precondition comparing
   * an asset date against `$today` mis-fired at the boundary (#3811). Now every
   * token shares one local basis — no hardcoded timezone, portable, and
   * internally consistent.
   */
  substituteVariables(query: string, targetIRI: string): string {
    const now = this.clock.now();
    const nowIso = now.toISOString();

    // ONE local wall-clock day basis (system timezone) for every calendar-date
    // token — no hardcoded offset. `DateFormatter.toDateString` and the
    // `new Date(y, mo, d - N)` arithmetic below all read/write local components.
    const year = now.getFullYear();
    const month = now.getMonth(); // 0-based
    const date = now.getDate();
    const day = now.getDay(); // 0=Sun

    // $today
    const todayStr = DateFormatter.toDateString(now);

    // $yesterday
    const yesterdayStr = DateFormatter.toDateString(new Date(year, month, date - 1));

    // $thisWeekStart (Monday of current week)
    const daysFromMonday = (day + 6) % 7; // Mon=0, Tue=1, ..., Sun=6
    const thisWeekStartStr = DateFormatter.toDateString(
      new Date(year, month, date - daysFromMonday),
    );

    // $lastWeekStart (Monday of previous week)
    const lastWeekStartStr = DateFormatter.toDateString(
      new Date(year, month, date - daysFromMonday - 7),
    );

    // $thisMonthStart
    const thisMonthStartStr = `${year}-${String(month + 1).padStart(2, "0")}-01`;

    // $lastMonthStart
    const lastMonthIdx = month === 0 ? 11 : month - 1;
    const lastMonthYear = month === 0 ? year - 1 : year;
    const lastMonthStartStr = `${lastMonthYear}-${String(lastMonthIdx + 1).padStart(2, "0")}-01`;

    // $thisYearStart
    const thisYearStartStr = `${year}-01-01`;

    // EVERY token regex is anchored with a trailing `\b` word boundary so an
    // unrecognized `$token` that merely SHARES A PREFIX with a supported one is
    // left literal rather than partially rewritten into malformed SPARQL. Without
    // `\b`, a `sparqlAsk` containing `$todayStart` (an executor/SubstitutionToken
    // form, not a precondition token) would have its `$today` prefix replaced →
    // `"YYYY-MM-DD"^^xsd:dateStart` (mangled). With `\b` it stays `$todayStart` —
    // an unknown token the SPARQL compiler can't parse, so the precondition FAILS
    // CLOSED (evaluateSparqlAsk's bare catch → `false` → command hidden): a
    // predictable, safe outcome, unlike a silently-mangled query that could return
    // the WRONG ASK boolean (#3811 review). `$now\b`/`$yesterday\b`/… likewise won't clobber
    // `$nowCompact`/`$nowLocal`. `$target\b` is anchored for the SAME reason:
    // real grounding-only tokens share its prefix (`$targetFolder`, `$targetStart`,
    // `$targetClassSelf` — GroundingExecutor tokens, NOT precondition tokens), so
    // an unanchored `$target` would mangle e.g. `$targetFolder` → `<IRI>Folder`.
    // `\b` still matches every valid precondition `$target` (always delimited by
    // whitespace or property-path chars `/` `.` `)` `,` `<` `]` — all non-word).
    return query
      .replace(/\$target\b/g, `<${targetIRI}>`)
      .replace(/\$now\b/g, `"${nowIso}"^^xsd:dateTime`)
      .replace(/\$yesterday\b/g, `"${yesterdayStr}"^^xsd:date`)
      .replace(/\$thisWeekStart\b/g, `"${thisWeekStartStr}"^^xsd:date`)
      .replace(/\$lastWeekStart\b/g, `"${lastWeekStartStr}"^^xsd:date`)
      .replace(/\$thisMonthStart\b/g, `"${thisMonthStartStr}"^^xsd:date`)
      .replace(/\$lastMonthStart\b/g, `"${lastMonthStartStr}"^^xsd:date`)
      .replace(/\$thisYearStart\b/g, `"${thisYearStartStr}"^^xsd:date`)
      .replace(/\$today\b/g, `"${todayStr}"^^xsd:date`);
  }
}
