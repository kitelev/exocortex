/**
 * RelColSetToExoLayoutMigratorService — pure transform from legacy
 * `ui__RelationColumnSet` configs to the equivalent `exo__Layout` +
 * `exo__BacklinksTableBlock` asset pair.
 *
 * Part B of RFC exo__Layout Phase 4 (task 07ceb846).
 *
 * Transform semantics
 * -------------------
 * A `ui__RelationColumnSet` encodes the pair
 *   (rowClass = targetClass, referencingProperty, columns, priority, label)
 * and participates in the `RelationColumnSetResolver` ladder to inject extra
 * columns into the UniversalLayout Asset Relations table (additive).
 *
 * The migration produces a self-contained `exo__Layout` + `exo__BacklinksTableBlock`
 * pair that reproduces the (rowClass, referencingProperty, columns) tuple as
 * a standalone block. The `exo__Layout.targetClass` intentionally carries the
 * RelColSet's `targetClass` as a **placeholder** — in RelColSet the target is
 * the row-asset class, but `exo__Layout.targetClass` is the class of the
 * **page** the layout renders on. The two can differ, and the CLI cannot
 * infer page-class from the RelColSet alone. The generated Layout includes an
 * inline `# TODO` note the user must resolve. Behavioural equivalence is the
 * column set (rowClass, referencingProperty, columns); page-binding is a
 * per-vault decision.
 *
 * Determinism (advisor-locked 2026-04-25)
 * ---------------------------------------
 * Generated UIDs are derived **deterministically** from the source RelColSet
 * UID + a stable suffix via SHA-256 (128 bits truncated to v4 UUID shape).
 * Re-running `--apply` against the same input vault produces **identical**
 * UIDs and file contents — it does NOT create duplicate Layout+Block pairs.
 * This closes the same class of defect that RFC be70f741 Task 2 v15.121.0
 * tripped on (path-only idempotency that missed UID-aware).  Tests may
 * inject an alternative generator for assertions.
 *
 * See memory entry `project_rfc_relcolset_complete.md` for the RelColSet
 * shape this migration reads from, and
 * `feedback_advisor_warning_equals_requirement.md` for the lesson that
 * drove this determinism requirement.
 */

import { createHash } from "node:crypto";

export interface RelColSetConfig {
  /** `exo__Asset_uid` of the RelColSet source asset. */
  readonly uid: string;
  /** Vault-relative path of the RelColSet source asset. */
  readonly path: string;
  /** Human-readable label (optional; defaults to basename). */
  readonly label: string | null;
  /**
   * `ui__RelationColumnSet_targetClass` (single or first-match) —
   * carried through as the row-asset class in the generated BacklinksTableBlock
   * and (for lack of better signal) as a **placeholder** `exo__Layout.targetClass`.
   */
  readonly targetClass: string | null;
  /** `ui__RelationColumnSet_referencingProperty`. */
  readonly referencingProperty: string | null;
  /** Ordered array from `ui__RelationColumnSet_columns`. */
  readonly columns: readonly string[];
  /** Optional numeric priority (defaults to 0 when absent). */
  readonly priority: number | null;
}

export interface GeneratedLayoutPair {
  readonly sourceUid: string;
  readonly sourcePath: string;
  readonly layout: {
    readonly uid: string;
    readonly filename: string;
    readonly content: string;
  };
  readonly block: {
    readonly uid: string;
    readonly filename: string;
    readonly content: string;
  };
  /** Human-readable warnings attached to this pair (rendered by the CLI). */
  readonly warnings: readonly string[];
}

export interface MigrationResult {
  readonly pairs: readonly GeneratedLayoutPair[];
  readonly skipped: readonly {
    readonly sourcePath: string;
    readonly reason: string;
  }[];
}

export interface RelColSetToExoLayoutMigratorOptions {
  /**
   * UID generator for the two generated assets. Receives a seed (source UID)
   * and a suffix (`"layout"` or `"block"`) and returns a stable UUID-shaped
   * string. Default: SHA-1 derivation from seed + suffix + migration-version
   * salt — deterministic, so re-running produces identical UIDs (idempotent
   * `--apply`). Tests may inject alternative stubs.
   */
  readonly uidFor?: (seed: string, suffix: "layout" | "block") => string;
}

function wikilinkInner(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const match = trimmed.match(/^\[\[([^|\]]+)(?:\|[^\]]*)?\]\]$/);
  if (match) return match[1].trim();
  return trimmed;
}

function normaliseColumns(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry === "string" && entry.trim().length > 0) {
      out.push(entry.trim());
    }
  }
  return out;
}

function normaliseInstanceClass(raw: unknown): readonly string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((e) => (typeof e === "string" ? wikilinkInner(e) : null))
      .filter((e): e is string => e !== null);
  }
  if (typeof raw === "string") {
    const inner = wikilinkInner(raw);
    return inner ? [inner] : [];
  }
  return [];
}

/**
 * Predicate: does this frontmatter represent a `ui__RelationColumnSet` asset?
 *
 * Accepts either the bare label `ui__RelationColumnSet` or the canonical
 * class UID `97fc9862-c886-4d86-9a60-e0cf9d778575` (`ui__RelationColumnSet`).
 */
export function isRelColSetFrontmatter(
  fm: Record<string, unknown>,
): boolean {
  const classes = normaliseInstanceClass(fm["exo__Instance_class"]);
  for (const c of classes) {
    if (c === "ui__RelationColumnSet") return true;
    if (c === "97fc9862-c886-4d86-9a60-e0cf9d778575") return true;
    // Tolerate pipe-aliased wikilinks like `[[uid|ui__RelationColumnSet]]`.
    if (c.includes("ui__RelationColumnSet")) return true;
  }
  return false;
}

/**
 * Extract a `RelColSetConfig` from frontmatter. Returns null when the asset
 * is missing the mandatory `exo__Asset_uid`.
 */
export function extractRelColSetConfig(
  path: string,
  fm: Record<string, unknown>,
): RelColSetConfig | null {
  const uid = fm["exo__Asset_uid"];
  if (typeof uid !== "string" || uid.trim().length === 0) return null;

  const labelRaw = fm["exo__Asset_label"];
  const label =
    typeof labelRaw === "string" && labelRaw.trim().length > 0
      ? labelRaw.trim()
      : null;

  const targetClassRaw = fm["ui__RelationColumnSet_targetClass"];
  const targetClass = Array.isArray(targetClassRaw)
    ? wikilinkInner(targetClassRaw[0] as unknown)
    : wikilinkInner(targetClassRaw);

  const referencingProperty = wikilinkInner(
    fm["ui__RelationColumnSet_referencingProperty"],
  );

  const columns = normaliseColumns(fm["ui__RelationColumnSet_columns"]);

  const priorityRaw = fm["ui__RelationColumnSet_priority"];
  const priority =
    typeof priorityRaw === "number"
      ? priorityRaw
      : typeof priorityRaw === "string" && priorityRaw.trim() !== ""
        ? Number.parseInt(priorityRaw, 10)
        : null;

  return {
    uid: uid.trim(),
    path,
    label,
    targetClass,
    referencingProperty,
    columns,
    priority: priority !== null && Number.isNaN(priority) ? null : priority,
  };
}

function wikilinkOf(value: string | null): string {
  if (value === null || value.trim().length === 0) return "";
  const trimmed = value.trim();
  if (trimmed.startsWith("[[") && trimmed.endsWith("]]")) return trimmed;
  return `[[${trimmed}]]`;
}

/**
 * Deterministic UID derivation: SHA-256 of `<seed>:<suffix>:<salt>`
 * truncated to 128 bits and formatted as an RFC-4122 v4-shaped UUID
 * (version nibble 4, variant nibble 8-b).  SHA-256 (not SHA-1) per
 * archgate `no-weak-hash` — even though this is not a security-sensitive
 * ID, sticking to SHA-256 keeps the migration consistent with the rest of
 * the codebase's hash policy.
 *
 * The `:exo-layout-migration-v1` salt is a stable string — if the
 * migration algorithm ever changes in a way that should produce new UIDs
 * for existing inputs (e.g. the Layout/Block split changes), bump the salt
 * version to force regeneration.
 *
 * Idempotency guarantee: `defaultUidFor(uid, "layout")` is a pure function
 * of `uid` and returns the same string on every call. Re-running `--apply`
 * against the same vault produces identical Layout+Block UIDs, so the
 * downstream idempotency check (file already exists) is a true no-op.
 */
function defaultUidFor(seed: string, suffix: "layout" | "block"): string {
  const hex = createHash("sha256")
    .update(`${seed}:${suffix}:exo-layout-migration-v1`)
    .digest("hex");
  // RFC-4122 v4-shaped: set the high nibble of the 7th byte (time_hi_and_version)
  // to 4 and the high two bits of the 9th byte (clock_seq_hi_and_reserved) to 10.
  return (
    hex.slice(0, 8) +
    "-" +
    hex.slice(8, 12) +
    "-" +
    "4" +
    hex.slice(13, 16) +
    "-" +
    "8" +
    hex.slice(17, 20) +
    "-" +
    hex.slice(20, 32)
  );
}

export class RelColSetToExoLayoutMigratorService {
  private readonly uidFor: (
    seed: string,
    suffix: "layout" | "block",
  ) => string;

  constructor(options: RelColSetToExoLayoutMigratorOptions = {}) {
    this.uidFor = options.uidFor ?? defaultUidFor;
  }

  /**
   * Transform a batch of RelColSet configs to Layout+Block pairs.
   */
  migrate(configs: readonly RelColSetConfig[]): MigrationResult {
    const pairs: GeneratedLayoutPair[] = [];
    const skipped: { sourcePath: string; reason: string }[] = [];

    for (const cfg of configs) {
      if (cfg.targetClass === null && cfg.referencingProperty === null) {
        skipped.push({
          sourcePath: cfg.path,
          reason:
            "RelColSet lacks both targetClass and referencingProperty — nothing to migrate",
        });
        continue;
      }
      pairs.push(this.migrateOne(cfg));
    }

    return { pairs, skipped };
  }

  private migrateOne(cfg: RelColSetConfig): GeneratedLayoutPair {
    const layoutUid = this.uidFor(cfg.uid, "layout");
    const blockUid = this.uidFor(cfg.uid, "block");
    const warnings: string[] = [];

    const labelSource = cfg.label ?? cfg.uid;
    const layoutLabel = `Migrated layout (from ${labelSource})`;
    const blockLabel = `Migrated backlinks table (from ${labelSource})`;

    const targetClassWikilink = wikilinkOf(cfg.targetClass);
    const referencingPropertyWikilink = wikilinkOf(cfg.referencingProperty);

    if (cfg.targetClass === null) {
      warnings.push(
        "RelColSet has no targetClass — using placeholder; set exo__Layout_targetClass and exo__BacklinksTableBlock_rowClass manually.",
      );
    }
    if (cfg.referencingProperty === null) {
      warnings.push(
        "RelColSet has no referencingProperty — set exo__BacklinksTableBlock_referencingProperty manually.",
      );
    }
    warnings.push(
      "RelColSet is additive (appends to Name/InstanceClass); exo__BacklinksTableBlock is replacing. The generated block renders only the configured columns.",
    );
    warnings.push(
      "exo__Layout.targetClass is the class of the PAGE the layout renders on. RelColSet encodes the row class, not the page class. Review and adjust before --apply.",
    );

    const columnsYaml =
      cfg.columns.length === 0
        ? "[]"
        : "\n" + cfg.columns.map((c) => `  - "${c}"`).join("\n");

    const priorityLine =
      cfg.priority === null ? "" : `exo__Layout_priority: ${cfg.priority}\n`;

    const layoutContent = `---
exo__Asset_uid: ${layoutUid}
exo__Asset_label: "${layoutLabel}"
exo__Instance_class:
  - "[[exo__Layout]]"
exo__Layout_targetClass: "${targetClassWikilink}"
exo__Layout_blocks:
  - "[[${blockUid}]]"
${priorityLine}exo__Layout_coexistsWithDefault: true
# Migrated from ui__RelationColumnSet ${cfg.uid} (${cfg.path}).
# TODO: verify exo__Layout_targetClass is the PAGE class (not the row class).
---
`;

    const blockContent = `---
exo__Asset_uid: ${blockUid}
exo__Asset_label: "${blockLabel}"
exo__Instance_class:
  - "[[exo__BacklinksTableBlock]]"
exo__LayoutBlock_title: "Backlinks"
exo__BacklinksTableBlock_rowClass: "${targetClassWikilink}"
exo__BacklinksTableBlock_referencingProperty: "${referencingPropertyWikilink}"
exo__BacklinksTableBlock_columns:${columnsYaml === "[]" ? " []" : columnsYaml}
# Migrated from ui__RelationColumnSet ${cfg.uid} (${cfg.path}).
---
`;

    return {
      sourceUid: cfg.uid,
      sourcePath: cfg.path,
      layout: {
        uid: layoutUid,
        filename: `${layoutUid}.md`,
        content: layoutContent,
      },
      block: {
        uid: blockUid,
        filename: `${blockUid}.md`,
        content: blockContent,
      },
      warnings,
    };
  }
}
