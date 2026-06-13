import { injectable } from "tsyringe";
import type { ITripleStore } from "../interfaces/ITripleStore";
import type { IQueryBodyResolver } from "../interfaces/IQueryBodyResolver";
import { IRI } from "../domain/models/rdf/IRI";
import { Literal } from "../domain/models/rdf/Literal";
import { evaluateWithExoEval } from "../exoql/evaluateWithExoEval";
import type { ExoQLEvalResult } from "../exoql/evaluateWithExoEval";
import { iriToObsidianName } from "../utilities/iriToObsidianName";

/**
 * RFC 78c2b7d0 C4 — read side of the homoiconic CQRS-lite model.
 *
 * Runs a `query__NamedQuery` asset (read-only SELECT / ASK) by UID and returns
 * either the raw discriminated envelope ({@link run}) or a single scalar value
 * extracted from the first binding of the first row ({@link runScalar}).
 *
 * The SPARQL body is the single source of truth — it lives in the asset's
 * markdown ```sparql code-block (M2 lock, RFC c78cc5c8) and is resolved through
 * the same {@link IQueryBodyResolver} seam the precondition path uses. Execution
 * routes through {@link evaluateWithExoEval}, whose always-on AST allowlist
 * rejects UPDATE / SERVICE / FROM / LOAD at parse stage — so a NamedQuery
 * physically *cannot* mutate the graph (CQRS read-only guarantee, not a policy
 * the runner has to enforce itself).
 *
 * ## Parameters & auto-context
 *
 * Tokens in the query body are substituted by the engine BEFORE parsing, the
 * same controlled-substitution discipline `PreconditionEvaluator` uses for
 * `$target` (the engine, not the caller, decides the syntactic form, so a value
 * can never break out of its position):
 *
 *   - `$currentAsset` → `<currentAsset-IRI>` — the asset the capability is being
 *     invoked on (e.g. the click target / `apply` target). Auto-injected.
 *   - `$currentClass`  → `<currentClass-IRI>` — auto-injected when the caller
 *     supplies it.
 *   - explicit params  → `<iri>` or escaped `"literal"` depending on declared
 *     `kind`. Param values come from vault-authored bindings, not free user
 *     text; combined with read-only execution this is the RFC's injection
 *     mitigation (explicit contract + trusted context + read-only).
 *
 * Auto-context IRIs and params are the only substituted tokens; everything else
 * passes through to the SPARQL engine verbatim.
 */
export interface NamedQueryParam {
  /** Value to substitute (an IRI string, or a literal lexical form). */
  readonly value: string;
  /** How the value is formatted into the query: `iri` → `<value>`; `literal` → escaped `"value"`. */
  readonly kind: "iri" | "literal";
}

export interface NamedQueryContext {
  /** IRI of the asset the capability is invoked on. Injected as `$currentAsset`. */
  readonly currentAsset?: string;
  /** IRI of the asset's class. Injected as `$currentClass` when present. */
  readonly currentClass?: string;
  /** Explicit named parameters. Token `$<name>` is replaced by the formatted value. */
  readonly params?: Record<string, NamedQueryParam>;
}

/**
 * A scalar value extracted from a NamedQuery result.
 *
 * - `kind: "iri"`   → `value` is the Obsidian name (UID-canon basename or
 *   `prefix__local`) of the bound IRI — ready to be wrapped as `"[[<value>]]"`.
 * - `kind: "literal"` → `value` is the literal lexical form (or `"true"`/`"false"`
 *   for an ASK result).
 */
export interface NamedQueryScalar {
  readonly value: string;
  readonly kind: "iri" | "literal";
}

/**
 * Narrow port consumed by `GroundingExecutor` for the `property_set`
 * `targetValueQuery` value-source. Keeps the executor decoupled from the full
 * runner (mirrors the `WorkflowResolverPort` / `GroundingLoaderPort` pattern).
 */
export type NamedQueryRunnerPort = {
  runScalar(
    queryUid: string,
    context: NamedQueryContext,
  ): Promise<NamedQueryScalar | null>;
};

@injectable()
export class NamedQueryRunner implements NamedQueryRunnerPort {
  constructor(
    private readonly queryBodyResolver: IQueryBodyResolver,
    private readonly tripleStore: ITripleStore,
  ) {}

  /**
   * Resolve a NamedQuery body by UID, substitute context/params, and evaluate
   * it read-only. Returns the discriminated envelope, or `null` when the asset
   * has no resolvable SPARQL body. Parse / allowlist errors (e.g. an UPDATE
   * body) propagate so callers can surface a precise message.
   */
  async run(
    queryUid: string,
    context: NamedQueryContext = {},
  ): Promise<ExoQLEvalResult | null> {
    if (!queryUid) return null;
    const body = await this.queryBodyResolver.resolveSparql(queryUid);
    if (!body) return null;
    const substituted = this.substitute(body, context);
    return evaluateWithExoEval(substituted, { store: this.tripleStore });
  }

  /**
   * Run a NamedQuery and return a single scalar.
   *
   * - SELECT → first binding of the first row (or the named `variable` when
   *   provided). IRI terms are reverse-mapped to their Obsidian name; literals
   *   yield their lexical value. Empty result set → `null`.
   * - ASK    → `{ value: "true" | "false", kind: "literal" }`.
   * - CONSTRUCT → `null` (not a scalar-bearing shape).
   *
   * Throws when the body cannot be resolved (fail-loud — the caller needs a
   * value and a missing query is a misconfiguration, not "no match").
   */
  async runScalar(
    queryUid: string,
    context: NamedQueryContext = {},
    variable?: string,
  ): Promise<NamedQueryScalar | null> {
    if (!queryUid) {
      throw new Error("NamedQueryRunner.runScalar: empty queryUid");
    }
    const body = await this.queryBodyResolver.resolveSparql(queryUid);
    if (!body) {
      throw new Error(
        `NamedQueryRunner: query__NamedQuery '${queryUid}' has no resolvable SPARQL body (asset missing or no \`\`\`sparql block).`,
      );
    }
    const substituted = this.substitute(body, context);
    const result = await evaluateWithExoEval(substituted, {
      store: this.tripleStore,
    });

    if (result.kind === "ask") {
      return { value: result.result ? "true" : "false", kind: "literal" };
    }
    if (result.kind === "construct") {
      return null;
    }
    // SELECT
    const firstRow = result.rows[0];
    if (!firstRow) return null;
    const vars = firstRow.variables();
    const targetVar = variable ?? vars[0];
    if (!targetVar) return null;
    const term = firstRow.get(targetVar);
    if (term === undefined) return null;

    if (term instanceof IRI) {
      const name = iriToObsidianName(term.value) ?? term.value;
      return { value: name, kind: "iri" };
    }
    if (term instanceof Literal) {
      return { value: term.value, kind: "literal" };
    }
    // BlankNode or any other term shape — not a usable scalar value-source.
    return null;
  }

  /**
   * Controlled token substitution. Auto-context first (`$currentAsset`,
   * `$currentClass`), then explicit params (longest name first so a shorter
   * param name is not a prefix of a longer one). Each substituted form is
   * engine-decided (`<iri>` or escaped `"literal"`), never raw interpolation.
   */
  private substitute(body: string, context: NamedQueryContext): string {
    let out = body;

    if (context.currentAsset) {
      out = out.replace(
        /\$currentAsset\b/g,
        `<${context.currentAsset}>`,
      );
    }
    if (context.currentClass) {
      out = out.replace(
        /\$currentClass\b/g,
        `<${context.currentClass}>`,
      );
    }

    const params = context.params;
    if (params) {
      const names = Object.keys(params).sort((a, b) => b.length - a.length);
      for (const name of names) {
        const param = params[name];
        const formatted =
          param.kind === "iri"
            ? `<${param.value}>`
            : `"${NamedQueryRunner.escapeLiteral(param.value)}"`;
        // Escape regex metachars in the param name (names are author-controlled
        // but defensive — a `.` in a name must not act as a wildcard).
        const safeName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        out = out.replace(new RegExp(`\\$${safeName}\\b`, "g"), formatted);
      }
    }

    return out;
  }

  /** Minimal SPARQL string-literal escaping (backslash, quote, newlines, tab). */
  private static escapeLiteral(value: string): string {
    return value
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t");
  }
}
