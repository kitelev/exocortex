import type { CachingNodeFsAdapter } from "../adapters/CachingNodeFsAdapter.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve a wikilink target (linkpath — alias/anchor already stripped) to a
 * vault-relative path inside one indexed vault, for the ontology-imports audit
 * (RFC df39007b §Решение Шаг 1).
 *
 * Normative order (R5):
 *   1. path-form (`a/b/c`): exact vault-relative path, else fall through to the
 *      last segment's basename (Obsidian shortest-path behaviour);
 *   2. UID-first: a UID-shaped target resolves through the UID index;
 *   3. basename: a single match resolves, ≥2 distinct matches return
 *      `"ambiguous"` (three resolution mechanisms could disagree — counted,
 *      never guessed), nothing returns `null`.
 *
 * Shared by the primary scan and the `--also` cross-vault classifier so both
 * resolve targets identically (PR2). Pure over the adapter — no graph state.
 */
export async function resolveTargetPath(
  adapter: CachingNodeFsAdapter,
  target: string,
): Promise<string | "ambiguous" | null> {
  // Path-form targets: exact vault-relative path first.
  if (target.includes("/")) {
    const cleaned = target.replace(/^\//, "");
    const candidate = cleaned.endsWith(".md") ? cleaned : `${cleaned}.md`;
    if (await adapter.hasIndexedPath(candidate)) return candidate;
    // fall through to basename of the last segment (Obsidian shortest-path)
    target = cleaned.slice(cleaned.lastIndexOf("/") + 1);
  }
  if (target.endsWith(".md")) target = target.slice(0, -3);
  // UID-first (R5 normative order), then basename.
  if (UUID_RE.test(target)) {
    const byUid = await adapter.findFileByUID(target);
    if (byUid) return byUid;
  }
  const byBasename = await adapter.findPathsByBasename(target);
  if (byBasename.length === 1) return byBasename[0];
  if (byBasename.length > 1) {
    // R5: ambiguous basename — three resolution mechanisms could disagree;
    // counted separately, never guessed.
    const distinct = new Set(byBasename);
    return distinct.size === 1 ? byBasename[0] : "ambiguous";
  }
  return null;
}
