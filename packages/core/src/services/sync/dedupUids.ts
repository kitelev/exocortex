/**
 * dedupUids — the platform-free core of `exosync dedup-uids` (#3477) shared by
 * BOTH surfaces (Desktop↔Mobile Command Parity, #3676):
 *
 *  - the CLI `runDedupUids` (`exosync-quarantine.ts`) injects a Node-backed file
 *    enumeration; and
 *  - the in-plugin «Exocortex: Deduplicate uids» command injects a
 *    `vault.adapter`-backed enumeration (mobile-safe, no Node `fs`).
 *
 * Both compose the SAME report + fix semantics here, so a phone user who hits a
 * dissonance message ("run dedup-uids") can act on it. The functions are pure
 * (no fs/path/io) — each surface owns its own enumeration + persistence.
 *
 * Semantics (mirrors the CLI `--fix` path, NOT the `--auto` zero-loss resolver):
 *  - **report-first** — group files by their frontmatter `exo__Asset_uid` and
 *    surface every uid shared by >1 file (with their paths);
 *  - **confirm-gated fix** — keep the lexicographically-first path's uid and
 *    reassign a FRESH uuid to every other file in the group via a frontmatter
 *    rewrite ONLY (the file is NEVER renamed). Deterministic ordering makes a
 *    re-run idempotent (the first stays first).
 */

import { extractAssetUid } from "./ChangeDetector";

/** A file's path + content, as the dedup pass sees it. */
export interface DedupUidFile {
  readonly path: string;
  readonly content: string;
}

/** One uid shared by >1 file, with the paths declaring it. */
export interface DedupUidGroup {
  readonly uid: string;
  readonly paths: readonly string[];
}

/** One concrete fix to persist: rewrite `path`'s uid `fromUid` → `toUid`. */
export interface DedupUidRewrite {
  readonly path: string;
  readonly fromUid: string;
  readonly toUid: string;
  /** The full file content with the frontmatter uid scalar rewritten. */
  readonly content: string;
}

/**
 * Rewrite the `exo__Asset_uid` scalar to a fresh value, scoped to the `---`
 * frontmatter block exactly like {@link extractAssetUid} reads it (same block
 * isolation + same lenient value shape `[^\s"']+`). Scoping the WRITE to the
 * same region as the READ avoids re-stamping a `exo__Asset_uid:` token that
 * happens to appear in the body. Returns the content unchanged when there is no
 * frontmatter uid line. (Moved verbatim from the CLI `rewriteUid` so both
 * surfaces rewrite identically — #3676.)
 */
export function rewriteAssetUid(content: string, fresh: string): string {
  const fm = /^(---\r?\n)([\s\S]*?)(\r?\n---(?=\r?\n|$))/.exec(content);
  if (fm === null) return content;
  const rewrittenBlock = fm[2].replace(
    /^(exo__Asset_uid:[ \t]*["']?)[^\s"']+(["']?[ \t]*)$/m,
    `$1${fresh}$2`,
  );
  if (rewrittenBlock === fm[2]) return content;
  return (
    content.slice(0, fm.index) +
    fm[1] +
    rewrittenBlock +
    fm[3] +
    content.slice(fm.index + fm[0].length)
  );
}

/**
 * Report-first: group `files` by their frontmatter `exo__Asset_uid` and return
 * only the groups a uid is shared by >1 file (the #3477 anomaly). Groups are
 * sorted by uid for a stable report; the paths within a group keep INPUT order
 * (the caller's enumeration order — CLI report output is unchanged). Files
 * without a uid are ignored.
 */
export function findDuplicateUidGroups(
  files: ReadonlyArray<DedupUidFile>,
): DedupUidGroup[] {
  const byUid = new Map<string, string[]>();
  for (const f of files) {
    const uid = extractAssetUid(f.content);
    if (uid === undefined) continue;
    const list = byUid.get(uid) ?? [];
    list.push(f.path);
    byUid.set(uid, list);
  }
  return [...byUid.entries()]
    .filter(([, paths]) => paths.length > 1)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([uid, paths]) => ({ uid, paths }));
}

/**
 * Confirm-gated fix plan: for every duplicate-uid group, keep the
 * lexicographically-first path's uid and reassign a fresh uuid (from
 * `freshUid`) to every OTHER file — a frontmatter rewrite only, never a rename.
 * Pure: returns the concrete rewrites (path + new content); the caller
 * persists them. A file whose content carries no rewritable uid line is skipped
 * (defensive — every grouped file does have one). `freshUid` is injected so a
 * test can make it deterministic.
 */
export function planDuplicateUidFix(
  files: ReadonlyArray<DedupUidFile>,
  freshUid: () => string,
): DedupUidRewrite[] {
  const contentByPath = new Map(files.map((f) => [f.path, f.content]));
  const rewrites: DedupUidRewrite[] = [];
  for (const group of findDuplicateUidGroups(files)) {
    // Deterministic order — keep the first path, re-uuid the rest (a re-run is
    // idempotent because the first stays first).
    const ordered = [...group.paths].sort((a, b) => a.localeCompare(b));
    for (const path of ordered.slice(1)) {
      const content = contentByPath.get(path);
      if (content === undefined) continue;
      const toUid = freshUid();
      const rewritten = rewriteAssetUid(content, toUid);
      if (rewritten === content) continue; // no frontmatter uid line — skip
      rewrites.push({ path, fromUid: group.uid, toUid, content: rewritten });
    }
  }
  return rewrites;
}
