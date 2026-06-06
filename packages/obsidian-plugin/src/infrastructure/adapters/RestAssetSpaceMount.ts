import type { App, DataAdapter } from "obsidian";
import { GitHubRestClient } from "./GitHubRestClient";
import { TarExtractor, type ExtractedTarFile } from "./TarExtractor";
import {
  parseGitHubURL,
  discoverWrapperDir,
  extractShaFromWrapper,
} from "./AssetSpaceManager";
import {
  validateVaultPathArg,
  stripGitmodulesEntry,
  escapeRegex,
} from "./GitSubmoduleOps";

/**
 * RestAssetSpaceMount — cross-platform (incl. iOS) AssetSpace mount/unmount
 * via the GitHub REST tarball API, RFC 01a83de8 Phase 3 (T1).
 *
 * ## Why this exists
 *
 * The desktop hard-switch path materialises AssetSpaces through the `git`
 * binary (`git submodule add` / `deinit` — see {@link GitSubmoduleOps}). That
 * binary is unavailable on mobile Obsidian, so the whole hard-switch /
 * mount-state visibility model could not reach iOS. This adapter replaces the
 * single `execFile("git")` mount/unmount mechanics with a pure
 * `requestUrl` + tarball + `vault.adapter` pipeline that runs identically on
 * desktop and mobile:
 *
 *   - **mount**: `GitHubRestClient.fetchTarballBuffer` → `TarExtractor`
 *     (zip-slip safe) → write each file into `<submodulePath>/...` via
 *     `vault.adapter.writeBinary` → append a plain-text `[submodule …]` entry
 *     to `.gitmodules`. No `.git/modules` / `.git/config` state is created —
 *     mount-state visibility is "folder exists", not "git knows about it".
 *   - **unmount**: `vault.adapter.rmdir(path, recursive)` → strip the
 *     `.gitmodules` entry. No `git submodule deinit` needed.
 *
 * Desktop keeps the git-binary path as a gated fallback (RFC v9 EV4); this
 * adapter is the mobile-capable path that Phase 3 T2 wires into the profile
 * switch / mount-state visibility orchestration.
 *
 * ## Security shape (inherited + local)
 *
 *   - Repo URL allowlist via {@link GitHubRestClient.validateRepoURL}
 *     (rejects non-github hosts, path traversal, scheme injection).
 *   - Submodule path validated via {@link validateVaultPathArg}
 *     (`..` / absolute / shell-meta / leading-dash rejected).
 *   - PAT redaction + rate-limit gate handled inside `GitHubRestClient`.
 *   - Tarball entries pass `TarExtractor`'s 4 zip-slip checks; a second
 *     defense-in-depth check confirms each resolved write target stays under
 *     the mount folder before any `writeBinary`.
 *   - `.gitmodules` written as plain text (no shell) — the `[submodule "…"]`
 *     header path is constrained to the already-validated, metacharacter-free
 *     `submodulePath`.
 */
export interface RestAssetSpaceMountOptions {
  app: App;
  client: GitHubRestClient;
  /** Optional injection — defaults to a fresh `new TarExtractor()`. */
  tarExtractor?: TarExtractor;
}

/** Outcome of a successful {@link RestAssetSpaceMount.mount}. */
export interface RestMountResult {
  /** Commit SHA discovered from the GitHub tarball wrapper dir. */
  sha: string;
  /** Number of files written into the vault under the mount folder. */
  fileCount: number;
}

const GITMODULES = ".gitmodules";

export class RestAssetSpaceMount {
  private readonly app: App;
  private readonly client: GitHubRestClient;
  private readonly tarExtractor: TarExtractor;

  constructor(opts: RestAssetSpaceMountOptions) {
    if (!opts || !opts.app) {
      throw new Error("RestAssetSpaceMount: app is required");
    }
    if (!opts.client) {
      throw new Error("RestAssetSpaceMount: client is required");
    }
    this.app = opts.app;
    this.client = opts.client;
    this.tarExtractor = opts.tarExtractor ?? new TarExtractor();
  }

  private get adapter(): DataAdapter {
    return this.app.vault.adapter;
  }

  /**
   * Mount an AssetSpace: fetch its GitHub tarball, materialise the content
   * directly into `<submodulePath>/...` inside the vault, and register the
   * `.gitmodules` entry.
   *
   * The mount is **additive** at the file level — colliding paths are
   * overwritten, but files present locally yet absent from the tarball are
   * left untouched. Callers that need a pristine tree should
   * {@link unmount} first (the profile-switch orchestrator does
   * destroy-then-materialise).
   *
   * @throws on invalid URL / path, rate-limit exhaustion, network/HTTP
   *   failure, empty or malformed tarball, or zip-slip violation. Partial
   *   writes are NOT rolled back here — the orchestrator owns recovery.
   */
  public async mount(
    gitUrl: string,
    submodulePath: string,
    ref: string = "main",
  ): Promise<RestMountResult> {
    const safePath = validateVaultPathArg(submodulePath);
    // Allowlist + owner/repo extraction (throws on traversal / non-github).
    GitHubRestClient.validateRepoURL(gitUrl);
    const { owner, repo } = parseGitHubURL(gitUrl);

    // Pre-flight rate-limit gate — fetchTarballBuffer is one REST call. The
    // PAT (D3 REST-push reuse) lives inside `client`; an insufficient scope
    // surfaces as a redacted HTTP 401/404 from fetchTarballBuffer below.
    await this.client.ensureRateLimit(1);

    const blob = await this.client.fetchTarballBuffer(owner, repo, ref);

    // Collect entries so we can do the two-pass discover-wrapper-then-strip
    // pattern (same shape as AssetSpaceManager.pullAssetSpace). Memory is
    // already O(tarball.size) — nanotar buffers internally.
    const entries: ExtractedTarFile[] = [];
    for await (const entry of this.tarExtractor.extract(blob, {
      // Wrapper prefix unknown until the first entry is read — let the prefix
      // gate accept any path. Zip-slip protections 1-3 (absolute, `..`,
      // sym/hard links) stay active.
      stagingDirPrefix: "",
    })) {
      entries.push(entry);
    }
    if (entries.length === 0) {
      throw new Error(
        `RestAssetSpaceMount.mount: tarball empty for ${owner}/${repo}@${ref}`,
      );
    }

    const wrapper = discoverWrapperDir(entries);
    const sha = extractShaFromWrapper(wrapper);
    const wrapperPrefix = wrapper + "/";

    await this.ensureDir(safePath);
    const createdDirs = new Set<string>([safePath]);
    let fileCount = 0;

    for (const entry of entries) {
      if (!entry.path.startsWith(wrapperPrefix)) {
        throw new Error(
          `RestAssetSpaceMount.mount: tarball entry "${entry.path}" not under wrapper "${wrapper}"`,
        );
      }
      const rel = entry.path.slice(wrapperPrefix.length);
      if (rel.length === 0) continue;
      const target = `${safePath}/${rel}`;
      // Defense-in-depth — TarExtractor already rejected `..` / absolute, but
      // confirm the joined target stays under the mount folder regardless.
      if (target !== safePath && !target.startsWith(safePath + "/")) {
        throw new Error(
          `RestAssetSpaceMount.mount: entry "${rel}" escapes mount folder "${safePath}"`,
        );
      }
      const parent = parentDir(target);
      if (parent.length > 0) await this.ensureDirChain(parent, createdDirs);
      await this.adapter.writeBinary(target, toArrayBuffer(entry.content));
      fileCount++;
    }

    await this.appendGitmodulesEntry(safePath, gitUrl);
    return { sha, fileCount };
  }

  /**
   * Unmount an AssetSpace: remove its vault folder recursively and strip its
   * `.gitmodules` entry. Idempotent — a missing folder or absent
   * `.gitmodules` stanza is a no-op.
   */
  public async unmount(submodulePath: string): Promise<void> {
    const safePath = validateVaultPathArg(submodulePath);
    if (await this.adapter.exists(safePath)) {
      await this.adapter.rmdir(safePath, true);
    }
    await this.removeGitmodulesEntry(safePath);
  }

  // ───────────────────────────── internals ─────────────────────────────

  /** Create one directory level if it does not already exist. */
  private async ensureDir(dir: string): Promise<void> {
    if (dir.length === 0) return;
    if (!(await this.adapter.exists(dir))) {
      await this.adapter.mkdir(dir);
    }
  }

  /**
   * Create a directory and all its missing parents (Obsidian's
   * `DataAdapter.mkdir` is NOT guaranteed recursive on every platform).
   * `created` memoises already-ensured dirs to avoid redundant
   * `exists`/`mkdir` round-trips during a multi-file mount.
   */
  private async ensureDirChain(
    dir: string,
    created: Set<string>,
  ): Promise<void> {
    if (dir.length === 0 || created.has(dir)) return;
    const parent = parentDir(dir);
    if (parent.length > 0) await this.ensureDirChain(parent, created);
    if (!created.has(dir)) {
      await this.ensureDir(dir);
      created.add(dir);
    }
  }

  /**
   * Idempotent `.gitmodules` stanza insertion over `vault.adapter` — the
   * mobile-capable counterpart of {@link GitSubmoduleOps.appendGitmodulesEntry}
   * (which uses `node:fs`). Re-mounting an already-registered path is a no-op.
   */
  private async appendGitmodulesEntry(
    submodulePath: string,
    url: string,
  ): Promise<void> {
    let existing = "";
    if (await this.adapter.exists(GITMODULES)) {
      existing = await this.adapter.read(GITMODULES);
    }
    const headerRegex = new RegExp(
      `^\\s*\\[submodule\\s+"${escapeRegex(submodulePath)}"\\]`,
      "m",
    );
    if (existing.length > 0 && headerRegex.test(existing)) return;
    const sep = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
    const newEntry = `[submodule "${submodulePath}"]\n\tpath = ${submodulePath}\n\turl = ${url}\n`;
    await this.adapter.write(GITMODULES, existing + sep + newEntry);
  }

  /**
   * Strip a `.gitmodules` stanza over `vault.adapter`, reusing the pure
   * {@link stripGitmodulesEntry} text transform. No-op when `.gitmodules`
   * is absent or has no matching stanza.
   */
  private async removeGitmodulesEntry(submodulePath: string): Promise<void> {
    if (!(await this.adapter.exists(GITMODULES))) return;
    const original = await this.adapter.read(GITMODULES);
    const rewritten = stripGitmodulesEntry(original, submodulePath);
    if (rewritten === original) return;
    await this.adapter.write(GITMODULES, rewritten);
  }
}

/** Parent directory of a vault-relative path; `""` if top-level. */
function parentDir(p: string): string {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "" : p.slice(0, i);
}

/**
 * Convert a `Uint8Array` (possibly a view over a larger buffer, as nanotar
 * may emit) into a standalone `ArrayBuffer` for `DataAdapter.writeBinary`.
 */
function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(
    u8.byteOffset,
    u8.byteOffset + u8.byteLength,
  ) as ArrayBuffer;
}
