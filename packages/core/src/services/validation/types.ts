/**
 * Homoiconic vault-validation engine (RFC f402002b, M1.4).
 *
 * The engine is the **code** half of the Homoiconicity Invariant (Q3 exc.1 —
 * algorithm in TS); WHICH checks are enabled is **data** (validation-check
 * `setting__Setting` instances, read by the `Validate vault` command, M1.5).
 *
 * Desktop↔Mobile parity: every check operates on a `CheckContext` that is built
 * ONCE per run from a warm source — the plugin reader builds it from
 * `metadataCache.getFileCache` (+ `getTripleStore()`), NEVER by re-reading +
 * re-parsing each file (the "iPhone reindex 10 minutes" anti-pattern); the CLI
 * reader builds it from a single fs-walk. Both satisfy {@link IVaultCheckReader}.
 */

/** One vault asset, as the warm reader surfaces it: path + already-parsed frontmatter. */
export interface VaultAssetRecord {
  /** Vault-relative path (e.g. `assetspaces/kitelev/exoas-exo/exo/abc.md`). */
  readonly path: string;
  /** Parsed YAML frontmatter (warm — from metadataCache / fs-walk; never re-read per check). */
  readonly frontmatter: Readonly<Record<string, unknown>>;
}

/** A SHACL violation, structurally minimal so the engine does not depend on the validator package. */
export interface ShaclViolationLike {
  readonly focusNode?: string;
  readonly path?: string;
  readonly message: string;
}

/**
 * Everything a check needs, built ONCE per run from a warm source.
 *
 * `assets` powers the asset-array checks (uid-uniqueness, co-location) directly
 * in core (mobile-portable, no platform deps). `runShacl` / `runDag` are
 * pre-bound runners injected by the reader for the two checks whose machinery is
 * platform-specific and heavy — SHACL needs a triple-store (plugin wraps
 * `ShaclLiteValidator.validate` over the warm `getTripleStore()`; CLI wraps
 * `runShapesValidation`), DAG needs the ontology-imports graph derivation
 * (validated against the existing CLI `audit ontology-imports`). Kept as thunks
 * so the core engine carries neither; absent when the reader cannot provide one
 * → the runner reports that check **fail-loud** (never silently skipped).
 */
export interface CheckContext {
  readonly assets: readonly VaultAssetRecord[];
  readonly runShacl?: () => Promise<readonly ShaclViolationLike[]>;
  readonly runDag?: () => Promise<readonly CheckFinding[]>;
}

/** One problem a check found. */
export interface CheckFinding {
  /** Vault-relative path the finding is about (omitted for vault-wide findings). */
  readonly path?: string;
  /** Human-readable description. */
  readonly message: string;
}

export type CheckStatus = "pass" | "fail" | "error";

/** Per-check outcome in a {@link VaultCheckReport}. */
export interface CheckResult {
  /** The check-id (a validation-check `setting__SettingKey` UID). */
  readonly checkId: string;
  /** Human label for the check (from the registry). */
  readonly label: string;
  readonly status: CheckStatus;
  readonly findings: readonly CheckFinding[];
  /** Present when `status === "error"` (fail-loud), e.g. unregistered check-id or runner threw. */
  readonly errorMessage?: string;
}

/** Full report of one `Validate vault` run. */
export interface VaultCheckReport {
  readonly totalAssets: number;
  readonly results: readonly CheckResult[];
  /** True iff every enabled check `pass`ed (no `fail`, no `error`). */
  readonly ok: boolean;
}

/** A check function: pure over the warm context (may be async — SHACL is). */
export type CheckFn = (
  ctx: CheckContext,
) => readonly CheckFinding[] | Promise<readonly CheckFinding[]>;

/** A registered check: stable id (check-key UID) + label + runner. */
export interface CheckRegistryEntry {
  readonly id: string;
  readonly label: string;
  readonly run: CheckFn;
}

/**
 * The warm reader that builds a {@link CheckContext} ONCE. Plugin and CLI each
 * provide a concrete implementation (M1.5); the engine depends only on this.
 */
export interface IVaultCheckReader {
  read(): Promise<CheckContext>;
}
