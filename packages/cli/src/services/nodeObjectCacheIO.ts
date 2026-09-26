/**
 * Node adapter for the platform-free {@link ObjectCacheIO} port (req
 * `086df113-16bb-4912-bb09-3a13ee187043`, issue #4410).
 *
 * One file per cached git object, laid out as
 * `<root>/<owner>/<repo>/<type>/<sha>[~<variant>].json`. The key's segments are
 * already refused by the core unless they match `[A-Za-z0-9._-]` (and the SHA
 * is hex), so the path is safe by construction rather than by sanitising here.
 *
 * ⛤ The root is DEVICE-wide, not per-vault, and that is the point: the same
 * AssetSpace is mounted in several vaults (35 of 81 mounts are duplicates),
 * so the second and third vault of a serial sync reuse the first vault's
 * objects instead of re-downloading `exoas-public`'s 751 files each time.
 *
 * `lastUsedMs` is the file mtime, refreshed by {@link markUsed} via `utimes`
 * — `atime` alone is unreliable (`noatime` mounts do not update it).
 */

import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ObjectCacheEntry, ObjectCacheIO } from "@kitelev/exocortex-core";

/** Cache-root resolution, in precedence order. */
export function resolveObjectCacheRoot(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const explicit = env.EXOCORTEX_EXOSYNC_CACHE_DIR;
  if (explicit !== undefined && explicit.length > 0) return explicit;
  const xdg = env.XDG_CACHE_HOME;
  if (xdg !== undefined && xdg.length > 0) {
    return path.join(xdg, "exocortex", "exosync-objects");
  }
  return path.join(os.homedir(), ".cache", "exocortex", "exosync-objects");
}

/** `256 MiB` default ceiling, overridable for constrained devices. */
export function resolveObjectCacheMaxBytes(
  env: NodeJS.ProcessEnv = process.env,
): number | undefined {
  const raw = env.EXOCORTEX_EXOSYNC_CACHE_MAX_BYTES;
  if (raw === undefined || raw.length === 0) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function keyToPath(root: string, key: string): string {
  return `${path.join(root, ...key.split("/"))}.json`;
}

function pathToKey(root: string, filePath: string): string | null {
  const rel = path.relative(root, filePath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  if (!rel.endsWith(".json")) return null;
  return rel.slice(0, -".json".length).split(path.sep).join("/");
}

async function* walk(dir: string): AsyncGenerator<string> {
  let names: Awaited<ReturnType<typeof fsp.readdir>>;
  try {
    names = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of names) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

export function nodeObjectCacheIO(root: string): ObjectCacheIO {
  return {
    async read(key: string): Promise<string | null> {
      // read-then-catch (not exists-then-read): a stat/read pair on the same
      // path is a `js/file-system-race` (CodeQL), and ENOENT is the normal miss.
      try {
        return await fsp.readFile(keyToPath(root, key), "utf-8");
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "EISDIR" || code === "ENOTDIR") {
          return null;
        }
        throw err;
      }
    },

    async write(key: string, content: string): Promise<void> {
      const target = keyToPath(root, key);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      // temp+rename: a crash mid-write must not leave a torn entry that would
      // later fail its integrity check and abort a sync fail-loud.
      const tmp = `${target}.${process.pid}.tmp`;
      await fsp.writeFile(tmp, content, "utf-8");
      await fsp.rename(tmp, target);
    },

    async remove(key: string): Promise<void> {
      await fsp.rm(keyToPath(root, key), { force: true });
    },

    async list(): Promise<ObjectCacheEntry[]> {
      const out: ObjectCacheEntry[] = [];
      for await (const filePath of walk(root)) {
        if (filePath.endsWith(".tmp")) continue;
        const key = pathToKey(root, filePath);
        if (key === null) continue;
        try {
          const st = await fsp.stat(filePath);
          out.push({ key, size: st.size, lastUsedMs: st.mtimeMs });
        } catch {
          continue;
        }
      }
      return out;
    },

    async markUsed(key: string): Promise<void> {
      const now = new Date();
      await fsp.utimes(keyToPath(root, key), now, now);
    },
  };
}
