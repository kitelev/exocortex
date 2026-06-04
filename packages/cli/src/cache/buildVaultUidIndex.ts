import { vaultPathToIRI } from "exocortex";
import { FileSystemVaultAdapter } from "../adapters/FileSystemVaultAdapter.js";

/**
 * UUID basename pattern: a file is considered UUID-named when its basename
 * (stripped of `.md`) matches the standard 8-4-4-4-12 hexadecimal form.
 */
const UUID_BASENAME_RE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.md$/i;

/**
 * Issue #3286 — builds a UID → canonical IRI lookup map by walking the file
 * trees of the supplied vault adapters.
 *
 * Each UUID-named `.md` file contributes one entry whose value is the
 * canonical IRI form `obsidian://vault/<subjectIriPrefix><relPath>` —
 * exactly the form `NoteToRDFConverter` would emit as the subject IRI for
 * that file when loaded by an adapter carrying the given prefix.
 *
 * Precedence: **first-wins** in the order adapters are supplied. Callers
 * should pass the primary adapter first, followed by any `--also` siblings.
 * Rationale: in the empirical setup that drove this issue (Issue #3286),
 * the canonical full-path form is owned by the primary vault, while the
 * sibling vault produces the lossy synth-A form for the same UID.
 *
 * Map keys are lowercased UUIDs; values are full IRI strings ready for
 * direct `IRI` instantiation.
 *
 * @returns Read-only map from `uid` (lowercase) to canonical IRI string.
 */
export function buildVaultUidIndex(
  adapters: FileSystemVaultAdapter[],
): ReadonlyMap<string, string> {
  const map = new Map<string, string>();

  for (const adapter of adapters) {
    const prefix = adapter.getSubjectIriPrefix();
    // `getAllFiles` returns vault-relative paths; combined with the
    // adapter's `subjectIriPrefix`, the resulting IRI matches the subject
    // IRI form the converter emits for the file.
    for (const file of adapter.getAllFiles()) {
      // Use forward-slash basename detection; vault-relative paths are
      // always POSIX form (FileSystemVaultAdapter normalises during walk).
      const lastSlash = file.path.lastIndexOf("/");
      const basename =
        lastSlash === -1 ? file.path : file.path.substring(lastSlash + 1);
      const match = UUID_BASENAME_RE.exec(basename);
      if (!match) continue;

      const uid = match[1].toLowerCase();
      if (map.has(uid)) {
        // First adapter that owns this UID wins. Skip duplicates so an
        // archive sibling cannot override the primary's canonical form.
        continue;
      }

      const relPathForIri = prefix
        ? `${prefix}/${file.path}`
        : file.path;
      map.set(uid, vaultPathToIRI(relPathForIri));
    }
  }

  return map;
}

/**
 * Feature-flag gate for Issue #3286 canonicalization.
 *
 * Default OFF for v1 (per RFC body) — users opt in once the recall fix has
 * been empirically validated on their cross-vault setup. Default may flip
 * to ON in a future release once a longer soak window has elapsed.
 */
export function isCanonicalizationEnabled(): boolean {
  return process.env.EXOCORTEX_IRI_CANONICALIZE === "true";
}
