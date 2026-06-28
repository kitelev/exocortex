/**
 * Generic Settings Distribution engine (RFC f402002b, M2.1) — public types.
 *
 * The engine is the **code** half of the Homoiconicity Invariant (Q3 exc.1 —
 * algorithm in TS): it transforms a domain's DECLARED setting keys into
 * `setting__Setting` assets (Export) and back (Import). WHICH keys a domain
 * distributes, and their current live values, are **data** owned by a concrete
 * {@link SettingsSource}.
 *
 * Allowlist-by-construction (RFC sec F1, R2/R4): the engine iterates ONLY
 * `source.declaredKeys()` and matches imports against that same set. It never
 * discovers keys from the live keyspace, so a field absent from the allowlist
 * (a secret, a structural setting) can never be exported nor imported —
 * regardless of what extra keys the live config carries.
 *
 * Desktop↔Mobile parity: the engine is pure over its source + asset arrays;
 * all I/O (vault.adapter write on plugin/mobile, warm metadataCache read, CLI
 * fs) is injected by the caller — there are no platform deps here.
 */

/** Declared value datatype of a setting (mirrors `setting__SettingKey_datatype`). */
export type SettingDatatype = "boolean" | "string" | "stringList";

/**
 * One declared setting key in a domain's allowlist — the binding between a
 * live field, its `setting__SettingKey` individual, and the deterministic
 * `setting__Setting` instance that carries its value.
 */
export interface SettingKeySpec {
  /** Live field id the source reads/writes (e.g. a data.json key). */
  readonly field: string;
  /** `setting__SettingKey` (or subclass) individual UID. */
  readonly keyUid: string;
  /** `setting__SettingKey` label (accepted as an alternative key-ref on import). */
  readonly keyLabel: string;
  /** Declared datatype — drives YAML rendering + tolerant import coercion. */
  readonly datatype: SettingDatatype;
  /**
   * Canonical `exo__Asset_uid` AND basename of the `setting__Setting` instance.
   * Fixed (not generated) so independent exports on two devices/vaults produce
   * byte-identical paths and file-level sync converges instead of duplicating.
   */
  readonly settingUid: string;
}

/**
 * A settings source = a domain (exocortex / obsidian-core / a plugin) that owns
 * a declared SettingKey set (the allowlist) and can read/write live values.
 * Export iterates ONLY {@link declaredKeys}; Import applies ONLY keys in it.
 */
export interface SettingsSource {
  /** `exo__Instance_class` UID exported assets are typed with (e.g. `exo__Setting`). */
  readonly settingClassUid: string;
  /** The allowlist — the ONLY keys the engine will ever export or import. */
  declaredKeys(): readonly SettingKeySpec[];
  /** Read the current live value for a key (undefined → treated per datatype default). */
  readLiveValue(key: SettingKeySpec): unknown;
  /** Apply a live value + run the field's side-effect hook (Import). */
  writeLiveValue(key: SettingKeySpec, value: unknown): Promise<void>;
}

/** Options for {@link exportSettings} — target placement + deterministic clock. */
export interface ExportOptions {
  /** `exo__Asset_isDefinedBy` of exported assets (target ontology UID) — co-location. */
  readonly ontologyUid: string;
  /** ISO timestamp for `exo__Asset_createdAt` (injected for determinism). */
  readonly nowIso: string;
}

/** One asset the export produced: deterministic file name + full markdown content. */
export interface ExportedSettingAsset {
  /** Live field this asset carries (for logging / reporting). */
  readonly field: string;
  /** Deterministic basename within the target folder (`<settingUid>.md`). */
  readonly fileName: string;
  /** Full markdown (frontmatter + body) — full-overwrite on write. */
  readonly content: string;
}

/** A parsed `setting__Setting` asset surfaced by an import reader (warm frontmatter). */
export interface ImportableSettingAsset {
  readonly path: string;
  readonly frontmatter: Readonly<Record<string, unknown>>;
}

/** Why an asset was skipped during import (never silently dropped — reported). */
export interface ImportSkip {
  readonly path: string;
  /** `unknown-key` = key not in the allowlist; `uncoercible` = value invalid for the datatype. */
  readonly reason: "unknown-key" | "uncoercible";
  readonly detail?: string;
}

/** Outcome of {@link importSettings}. */
export interface ImportResult {
  /** Fields whose live value was written. */
  readonly applied: readonly string[];
  /** Assets that were not applied, with the reason (allowlist / coercion). */
  readonly skipped: readonly ImportSkip[];
}
