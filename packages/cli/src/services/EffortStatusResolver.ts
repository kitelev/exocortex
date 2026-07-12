import { NodeFsAdapter } from "../adapters/NodeFsAdapter.js";

/**
 * Label of the ontology root class that carries `ems__Effort_status`. A class
 * is "status-bearing" iff it is `ems__Effort` or a transitive subclass of it —
 * i.e. `ems__Effort` appears in its `exo__Class_superClass` chain. Detected by
 * walking the chain (no hardcoded list of status-bearing class names).
 */
const EFFORT_CLASS_LABEL = "ems__Effort";

/** `exo__Asset_label` prefix for the effort-status enum assets. */
const STATUS_ENUM_LABEL_PREFIX = "ems__EffortStatus";

/**
 * Resolves effort-status semantics for `cli create` against a vault's TBox
 * (Node filesystem). Two concerns:
 *
 *  - {@link isStatusBearing} — does a class carry `ems__Effort_status`? (walks
 *    `exo__Class_superClass` from the class up to `ems__Effort`).
 *  - {@link resolveStatusUid} — map a status short name (e.g. `Backlog`,
 *    `Draft`) to the `ems__EffortStatus<Name>` enum asset's UID.
 *
 * The bare `exocortex create` verb bypasses homoiconic groundings (per
 * homoiconic-gap-triage), so its set-time status default is an engine concern
 * (Homoiconicity Invariant Q3). Kept CLI-side because the determination needs
 * vault TBox access; the core `GenericAssetCreationService` stays
 * vault-agnostic and byte-identical for the plugin / apply paths.
 */
export class EffortStatusResolver {
  /** Cache: status label → resolved enum UID (or `null` if not found). */
  private statusUidCache = new Map<string, string | null>();

  constructor(private readonly fsAdapter: NodeFsAdapter) {}

  /**
   * True iff `classUid`'s class definition is `ems__Effort` or a transitive
   * subclass (so it can carry `ems__Effort_status`). Walks the
   * `exo__Class_superClass` chain (cycle-safe). Returns `false` when the class
   * definition is not found on disk (a made-up / pass-through UUID with no
   * class file is treated as non-status-bearing — no default status injected).
   *
   * No hardcoded list of status-bearing class names: `ems__Effort` is
   * identified by its `exo__Asset_label`, discovered by walking the vault.
   */
  async isStatusBearing(classUid: string): Promise<boolean> {
    const visited = new Set<string>();
    // The queue holds class references — either a UID (UID-canon superClass
    // form) or a label (legacy `[[ems__Effort]]` form). Both are handled.
    const queue: string[] = [classUid];

    while (queue.length > 0) {
      const ref = queue.shift();
      if (ref === undefined) break;
      if (visited.has(ref)) continue;
      visited.add(ref);

      // Direct label short-circuit — a legacy label-form superClass ref that
      // is literally `ems__Effort` needs no file resolution.
      if (ref === EFFORT_CLASS_LABEL) return true;

      const file = await this.resolveClassFile(ref);
      if (!file) continue;

      let metadata: Record<string, unknown>;
      try {
        metadata = await this.fsAdapter.getFileMetadata(file);
      } catch {
        continue;
      }

      if (metadata.exo__Asset_label === EFFORT_CLASS_LABEL) return true;

      const superClass = metadata.exo__Class_superClass;
      const superRefs = Array.isArray(superClass)
        ? superClass
        : superClass !== null && superClass !== undefined
          ? [superClass]
          : [];
      for (const raw of superRefs) {
        const target = extractRef(String(raw));
        if (target && !visited.has(target)) {
          queue.push(target);
        }
      }
    }

    return false;
  }

  /**
   * Resolve a status short name to the `ems__EffortStatus<Name>` enum asset's
   * UID. Accepts either a bare name (`Backlog`, `Draft`, `Doing`) or the full
   * enum label (`ems__EffortStatusBacklog`). Returns `null` when no enum with
   * that label exists in the vault — the caller decides fail-open (default
   * status → skip) vs fail-loud (explicit `--status` → error).
   */
  async resolveStatusUid(statusName: string): Promise<string | null> {
    const label = toStatusEnumLabel(statusName);
    const cached = this.statusUidCache.get(label);
    if (cached !== undefined) return cached;

    let uid: string | null = null;
    const files = await this.fsAdapter.findFilesByMetadata({
      exo__Asset_label: label,
    });
    for (const file of files) {
      try {
        const metadata = await this.fsAdapter.getFileMetadata(file);
        if (metadata.exo__Asset_uid) {
          uid = String(metadata.exo__Asset_uid);
          break;
        }
      } catch {
        continue;
      }
    }

    this.statusUidCache.set(label, uid);
    return uid;
  }

  /**
   * Resolve a class reference (UID or label) to its on-disk file path.
   * UID refs use the filename-based lookup (cheap, name-only walk); label refs
   * fall back to a metadata scan (rare in UID-canon vaults, where
   * `exo__Class_superClass` is stored UID-form).
   */
  private async resolveClassFile(ref: string): Promise<string | null> {
    if (isUuid(ref)) {
      return this.fsAdapter.findFileByUidFilename(ref);
    }
    const byLabel = await this.fsAdapter.findFilesByMetadata({
      exo__Asset_label: ref,
    });
    return byLabel.length > 0 ? byLabel[0] : null;
  }
}

/**
 * Normalise a status short name to its `ems__EffortStatus<Name>` enum label.
 * A name already in `ems__` form is used verbatim; otherwise the first letter
 * is upper-cased (Backlog / Draft / Doing / WaitingCheck) and prefixed.
 */
function toStatusEnumLabel(name: string): string {
  const trimmed = name.trim();
  if (trimmed.startsWith("ems__")) return trimmed;
  const cap = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return `${STATUS_ENUM_LABEL_PREFIX}${cap}`;
}

/**
 * Extract a class reference target from a wikilink value. Strips surrounding
 * quotes and `[[ ]]`, then takes the target before any `|alias`. Mirrors the
 * core `extractAssetReference` behaviour without importing it (keeps this
 * module free of core mocks).
 */
function extractRef(raw: string): string | null {
  const stripped = raw
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^\[\[|\]\]$/g, "")
    .split("|")[0]
    .trim();
  return stripped || null;
}

/** Test whether a string is a UUID (v4-shaped). */
function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}
