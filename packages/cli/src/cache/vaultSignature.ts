import fs from "fs-extra";
import path from "path";
import crypto from "crypto";

/**
 * Compute a coarse content signature of a vault's markdown assets: the SHA-256 of
 * the sorted `relPath:mtimeMs` list of every `.md` file under `vaultPath`. Any
 * in-place edit, addition, or deletion of an asset changes the signature (a write
 * always advances the file mtime), so the query-result cache can detect a vault
 * change and invalidate WITHOUT re-loading + re-parsing the whole vault.
 *
 * Why a file-mtime fingerprint and not the vault-DIR mtime (the CacheManager
 * triple-cache precedent, issue #3983): a nested asset edit — the exact
 * `set-property` / `apply` read-after-write case this feature targets — does NOT
 * bump the vault root dir mtime. Only the edited file's own mtime (and, for an
 * atomic temp+rename write, its immediate parent dir) change; the root stays put.
 * So `fs.stat(vaultPath).mtimeMs` would silently miss the read-after-write
 * mutation. The fingerprint catches it. Empirically ~74ms over ~8.5k files — a
 * `stat`-only walk (no file reads), ~1.4% of a ~5s full vault load.
 *
 * Best-effort: returns `null` if the vault directory cannot be walked at all
 * (the caller then falls back to TTL-only invalidation, i.e. prior behaviour);
 * individual unreadable dirs/files are skipped rather than failing the walk.
 *
 * @param vaultPath absolute path to the vault root
 * @returns 64-char hex signature, or null if the vault could not be walked
 */
export async function computeVaultSignature(
  vaultPath: string,
): Promise<string | null> {
  const entries: string[] = [];

  const walk = async (dir: string): Promise<void> => {
    let dirents: fs.Dirent[];
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory — skip (best-effort)
    }
    for (const d of dirents) {
      const full = path.join(dir, d.name);
      if (d.isDirectory()) {
        // Skip VCS / dependency / derived-cache dirs — they hold no queried assets
        // and would only add churn (e.g. .exocortex/cache is rebuilt independently).
        if (d.name === ".git" || d.name === "node_modules" || d.name === ".exocortex") {
          continue;
        }
        await walk(full);
      } else if (d.name.endsWith(".md")) {
        try {
          const stat = await fs.stat(full);
          entries.push(`${path.relative(vaultPath, full)}:${stat.mtimeMs}`);
        } catch {
          // file vanished between readdir and stat — skip
        }
      }
    }
  };

  try {
    await walk(vaultPath);
  } catch {
    return null;
  }

  // A vault path that resolved to nothing walkable yields an empty set; treat
  // that as "cannot determine" so we never invalidate on a bogus empty signature.
  if (entries.length === 0) {
    return null;
  }

  entries.sort();
  return crypto.createHash("sha256").update(entries.join("\n")).digest("hex");
}
