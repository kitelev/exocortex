/**
 * Row provider of the `query-table` block (RFC 9821a379 §Шаг 2, ticket
 * 058bad52) — the plugin half of `query__TableBlock`.
 *
 * Runs the block's `query__NamedQuery` through the core `NamedQueryRunner`
 * with `$currentAsset` = the IRI of the open page, and turns the SELECT result
 * into a table model the view draws as is:
 *
 *  - columns — `result.variables`, the SELECT projection in the order the query
 *    declares it (NOT `rows[0].variables()`, which follows binding order —
 *    core axis V1, ticket 035da1eb);
 *  - an IRI of a vault file that exists → a link whose text is the asset's
 *    display name (homoiconic `exo__DisplayNameSpec`, same resolver as the
 *    Relations table); any other IRI → text (its Obsidian name);
 *  - a literal → its LEXICAL form, verbatim. Never through `Date`: timestamps
 *    are written without a zone and the engine emits them with a false `Z`, so
 *    a Date round-trip would shift the shown time by the device's offset;
 *  - unbound → empty text.
 *
 * Every failure is an outcome, never a throw: the block draws it with the
 * query's label instead of breaking the page (AC11). A `$<name>` token left
 * unsubstituted is refused before evaluation (AC7, bypass of 2bc09942).
 *
 * No Node/Obsidian dependency here — the Obsidian-specific lookups arrive as
 * functions (Desktop↔Mobile parity: the runner is core, the reads are
 * metadataCache/vault).
 */
import type {
  ExoQLEvalResult,
  NamedQueryContext,
  NamedQueryRunOptions,
  QueryTableBlock,
} from "@kitelev/exocortex-core";
import {
  IRI,
  Literal,
  BlankNode,
  UnsetQueryTokenError,
  iriToObsidianName,
  iriToVaultPath,
  vaultPathToIRI,
} from "@kitelev/exocortex-core";

export type QueryTableCell =
  | { readonly kind: "link"; readonly path: string; readonly text: string }
  | { readonly kind: "text"; readonly text: string };

export type QueryTableOutcome =
  | {
      readonly kind: "rows";
      readonly queryLabel: string;
      readonly columns: readonly string[];
      readonly rows: readonly (readonly QueryTableCell[])[];
      /** Rows the query returned; `rows.length` is capped by the block limit. */
      readonly total: number;
      /** Query + cell building, ms (AC10 — shown in the block footer). */
      readonly elapsedMs: number;
    }
  | {
      readonly kind: "unset-token";
      readonly queryLabel: string;
      readonly tokens: readonly string[];
    }
  | { readonly kind: "not-found"; readonly queryLabel: string }
  | {
      readonly kind: "not-select";
      readonly queryLabel: string;
      readonly resultKind: string;
    }
  | {
      readonly kind: "error";
      readonly queryLabel: string;
      readonly message: string;
    };

export type QueryTableProvider = (
  file: { readonly path: string },
  block: QueryTableBlock,
) => Promise<QueryTableOutcome>;

/** Display text of an existing vault file, or `null` when no such file. */
export type QueryTableLinkText = (vaultPath: string) => string | null;

export interface QueryTableProviderDeps {
  readonly runner: {
    run(
      queryUid: string,
      context?: NamedQueryContext,
      options?: NamedQueryRunOptions,
    ): Promise<ExoQLEvalResult | null>;
  };
  /** `exo__Asset_label` of the query asset by uid, `null` when unknown. */
  readonly queryLabel: (queryUid: string) => string | null;
  /** Built once per block evaluation (one display-name resolver per table). */
  readonly createLinkText: () => QueryTableLinkText;
  /** Injectable clock (tests); `performance.now()` otherwise. */
  readonly now?: () => number;
}

export function createQueryTableProvider(
  deps: QueryTableProviderDeps,
): QueryTableProvider {
  const now = deps.now ?? (() => performance.now());
  return async (file, block) => {
    // The clock starts FIRST: the label lookup builds the vault-wide uid index
    // the body lookup then reuses, so it is part of what the block costs.
    const startedAt = now();
    let queryLabel = block.query;
    try {
      queryLabel = deps.queryLabel(block.query) ?? block.query;
    } catch {
      // The label only names the query; its uid names it too.
    }
    try {
      let result: ExoQLEvalResult | null;
      try {
        result = await deps.runner.run(
          block.query,
          { currentAsset: vaultPathToIRI(file.path) },
          { refuseUnsetTokens: true },
        );
      } catch (error) {
        if (error instanceof UnsetQueryTokenError) {
          return { kind: "unset-token", queryLabel, tokens: [...error.tokens] };
        }
        throw error;
      }
      if (result === null) return { kind: "not-found", queryLabel };
      if (result.kind !== "select") {
        return { kind: "not-select", queryLabel, resultKind: result.kind };
      }
      const columns = [...result.variables];
      const linkText = deps.createLinkText();
      const rows = result.rows
        .slice(0, block.limit)
        .map((row) => columns.map((name) => toCell(row.get(name), linkText)));
      return {
        kind: "rows",
        queryLabel,
        columns,
        rows,
        total: result.rows.length,
        elapsedMs: Math.round(now() - startedAt),
      };
    } catch (error) {
      // Evaluation AND cell building (display-name resolution reads vault
      // metadata): any failure is an outcome named by the query's label.
      return {
        kind: "error",
        queryLabel,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  };
}

function toCell(term: unknown, linkText: QueryTableLinkText): QueryTableCell {
  if (term === undefined || term === null) return { kind: "text", text: "" };
  if (term instanceof IRI) {
    const path = iriToVaultPath(term.value);
    if (path !== null) {
      const text = linkText(path);
      if (text !== null) return { kind: "link", path, text };
    }
    return { kind: "text", text: iriToObsidianName(term.value) ?? term.value };
  }
  if (term instanceof Literal) return { kind: "text", text: term.value };
  if (term instanceof BlankNode) return { kind: "text", text: `_:${term.id}` };
  return { kind: "text", text: String(term) };
}

/**
 * The text a non-row outcome shows in the block (AC7, AC11) — named by the
 * query's label so the reader knows WHICH query to fix.
 */
export function describeQueryTableProblem(
  outcome: Exclude<QueryTableOutcome, { kind: "rows" }>,
): string {
  const q = `Запрос «${outcome.queryLabel}»`;
  switch (outcome.kind) {
    case "unset-token": {
      const names = outcome.tokens.map((t) => `$${t}`).join(", ");
      return outcome.tokens.length === 1
        ? `${q}: в запросе не задан ${names}`
        : `${q}: в запросе не заданы ${names}`;
    }
    case "not-found":
      return `${q} не найден или у него нет блока sparql`;
    case "not-select":
      return `${q}: таблица показывает только SELECT, а запрос — ${outcome.resultKind.toUpperCase()}`;
    case "error":
      return `${q}: ${outcome.message}`;
  }
}
