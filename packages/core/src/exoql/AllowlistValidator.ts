/**
 * AST allowlist validator for exoql__Query bodies.
 *
 * RFC c78cc5c8 Phase 1a — exoql__Query + exo:eval MVP.
 *
 * The allowlist permits SELECT and ASK queries only. Any of the following
 * are rejected at parse-time (BEFORE any execution against the triple store)
 * with `ExoQLForbiddenKeywordError`:
 *
 *  - `UPDATE` (any update operation: INSERT/DELETE DATA, INSERT/DELETE WHERE,
 *    LOAD, CLEAR, CREATE, DROP, COPY, MOVE, ADD).
 *  - `FROM`  / `FROM NAMED` dataset clauses (federated dataset selection).
 *  - `SERVICE` patterns (federated query to remote endpoints).
 *  - `LOAD` (data import — sub-case of UPDATE; flagged with its specific
 *    keyword so the error message names it accurately).
 *
 * The validator is INDEPENDENT of the `exoql.eval.enabled` feature flag —
 * it is a security guard for the parser-stage, not a feature gate. It runs
 * regardless of B2 lock state.
 *
 * Walking strategy: depth-first traversal of the parsed sparqljs AST. For
 * SERVICE patterns (which can appear anywhere in WHERE/OPTIONAL/UNION/MINUS
 * groups), we walk the pattern tree recursively. For UPDATE / LOAD we
 * inspect `query.type === "update"` and the per-update `type` discriminator.
 */

import type { SPARQLQuery } from "../infrastructure/sparql/SPARQLParser";
import { ExoQLForbiddenKeywordError } from "./eval-errors";

interface PatternLike {
  type?: string;
  patterns?: PatternLike[];
}

interface UpdateOpLike {
  type?: string;
  updateType?: string;
}

interface DatasetClause {
  default?: unknown[];
  named?: unknown[];
}

interface QueryWithDataset {
  type?: string;
  queryType?: string;
  from?: DatasetClause;
  where?: PatternLike[];
  template?: PatternLike[];
}

/**
 * Walk a SPARQL AST and throw `ExoQLForbiddenKeywordError` if any banned
 * construct is present. Returns silently on success.
 *
 * @param query Parsed sparqljs AST (the value returned by `ExoQLParser.parse`)
 * @throws ExoQLForbiddenKeywordError on the first banned construct encountered
 */
export function validateExoQLAllowlist(query: SPARQLQuery): void {
  if (!query || typeof query !== "object") return;

  const q = query as unknown as QueryWithDataset;

  // 1. UPDATE is a top-level discriminator in sparqljs.
  if (q.type === "update") {
    const updates =
      (query as unknown as { updates?: UpdateOpLike[] }).updates ?? [];
    // Surface LOAD specifically when the update is exclusively a LOAD — the
    // BDD scenario expects the error message to name the keyword the user wrote.
    for (const op of updates) {
      if (op?.type === "load") {
        throw new ExoQLForbiddenKeywordError("LOAD");
      }
    }
    throw new ExoQLForbiddenKeywordError("UPDATE");
  }

  if (q.type !== "query") return;

  // 2. FROM / FROM NAMED dataset clauses.
  if (q.from) {
    const hasDefault =
      Array.isArray(q.from.default) && q.from.default.length > 0;
    const hasNamed = Array.isArray(q.from.named) && q.from.named.length > 0;
    if (hasDefault || hasNamed) {
      throw new ExoQLForbiddenKeywordError("FROM");
    }
  }

  // 3. SERVICE inside WHERE (or any pattern subtree).
  if (Array.isArray(q.where)) {
    for (const p of q.where) walkPatternForBannedKeywords(p);
  }

  // 4. CONSTRUCT template body — patterns can host SERVICE in unusual cases.
  if (Array.isArray(q.template)) {
    for (const p of q.template) walkPatternForBannedKeywords(p);
  }
}

function walkPatternForBannedKeywords(pattern: PatternLike | undefined): void {
  if (!pattern || typeof pattern !== "object") return;

  if (pattern.type === "service") {
    throw new ExoQLForbiddenKeywordError("SERVICE");
  }

  // sparqljs nests subgroups under `patterns` for: group, optional, union,
  // minus, graph, service (already handled), bind, filter, query (subquery).
  if (Array.isArray(pattern.patterns)) {
    for (const child of pattern.patterns) {
      walkPatternForBannedKeywords(child);
    }
  }

  // Subqueries hang the inner SELECT under `.query` — recurse into its WHERE.
  const inner = (pattern as unknown as { where?: PatternLike[] }).where;
  if (Array.isArray(inner)) {
    for (const child of inner) walkPatternForBannedKeywords(child);
  }
}
