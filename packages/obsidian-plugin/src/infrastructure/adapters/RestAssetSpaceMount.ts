import type { App, DataAdapter } from "obsidian";
import { GitHubRestClient } from "./GitHubRestClient";
import { parseGitHubURL } from "./AssetSpaceManager";
import {
  validateVaultPathArg,
  parseGitmodulesEntries,
  type GitmodulesEntry,
} from "./GitSubmoduleOps";
import {
  mountAssetSpaceFiles,
  appendGitmodulesEntry,
  stripGitmodulesEntry,
  SYNC_BRANCH,
  type FileSystemPort,
  type AssetSpaceHttpClient,
  type MountBaseStorePort,
  type MountFile,
  type MountResult,
  type MountProgressPhase,
} from "exocortex";

/**
 * RestAssetSpaceMount — cross-platform (incl. iOS) AssetSpace mount/unmount
 * via the GitHub REST tarball API, RFC 01a83de8 Phase 3 (T1).
 *
 * ## Thin adapter over the shared mount core (Issue #3423)
 *
 * The mount/unmount pipeline (fetch tarball → discover `<owner>-<repo>-<sha>/`
 * wrapper → extract SHA → zip-slip validate → materialise files → `.gitmodules`
 * mutation) lives ONCE in `exocortex`'s {@link mountAssetSpaceFiles} +
 * `.gitmodules` text transforms. This adapter supplies the two Obsidian-coupled
 * ports:
 *
 *   - **{@link FileSystemPort}** over `vault.adapter` — `materialize()` writes
 *     files **additively** (overwrite collisions, leave files absent from the
 *     tarball; callers needing a pristine tree {@link unmount} first), the same
 *     direct-write strategy this adapter has always used. No `.git/modules` /
 *     `.git/config` state — mount-state visibility is "folder exists".
 *   - **{@link AssetSpaceHttpClient}** over {@link GitHubRestClient} — a
 *     rate-limit-gated `requestUrl` tarball fetch.
 *
 * Desktop keeps the git-binary path as a gated fallback (RFC v9 EV4); this
 * adapter is the mobile-capable path that Phase 3 T2 wires into the profile
 * switch / mount-state visibility orchestration.
 *
 * ## Security shape (inherited + local)
 *
 *   - Repo URL allowlist via {@link GitHubRestClient.validateRepoURL}.
 *   - Submodule path validated via {@link validateVaultPathArg}.
 *   - PAT redaction + rate-limit gate handled inside `GitHubRestClient`.
 *   - The core rejects sym/hard links + `..` traversal + non-wrapper entries;
 *     `materialize()` adds a defense-in-depth check that each resolved target
 *     stays under the mount folder before any `writeBinary`.
 *   - `.gitmodules` written as plain text (no shell) — the `[submodule "…"]`
 *     header path is the already-validated, metacharacter-free `submodulePath`.
 */
export interface RestAssetSpaceMountOptions {
  app: App;
  client: GitHubRestClient;
  /**
   * #3590 — records the mounted commit SHA (the first-sync 3-way merge base)
   * keyed by `repoKey`, the instant the working tree is materialized. Optional:
   * absent ⇒ no base recorded ⇒ first-sync of a diverged repo stays the
   * conservative full-conflict (zero regression). See {@link MountBaseStorePort}.
   */
  mountBaseStore?: MountBaseStorePort;
}

/** Outcome of a successful {@link RestAssetSpaceMount.mount}. */
export type RestMountResult = MountResult;

const GITMODULES = ".gitmodules";

export class RestAssetSpaceMount {
  private readonly app: App;
  private readonly client: GitHubRestClient;
  private readonly mountBaseStore?: MountBaseStorePort;

  constructor(opts: RestAssetSpaceMountOptions) {
    if (!opts || !opts.app) {
      throw new Error("RestAssetSpaceMount: app is required");
    }
    if (!opts.client) {
      throw new Error("RestAssetSpaceMount: client is required");
    }
    this.app = opts.app;
    this.client = opts.client;
    this.mountBaseStore = opts.mountBaseStore;
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
   * left untouched. Callers that need a pristine tree should {@link unmount}
   * first (the profile-switch orchestrator does destroy-then-materialise).
   *
   * @throws on invalid URL / path, rate-limit exhaustion, network/HTTP
   *   failure, empty or malformed tarball, or zip-slip violation. Partial
   *   writes are NOT rolled back here — the orchestrator owns recovery.
   */
  public async mount(
    gitUrl: string,
    submodulePath: string,
    ref: string = "main",
    /**
     * Optional sub-phase progress sink (#al-activitylog-progress) — forwarded
     * into {@link mountAssetSpaceFiles} so a long mount surfaces fetch → extract
     * → materialize, finer than the caller's single "Mounting X" marker. Omitted
     * by bootstrap/fetch-tracked callers (zero cost).
     */
    onProgress?: (phase: MountProgressPhase) => void,
  ): Promise<RestMountResult> {
    const safePath = validateVaultPathArg(submodulePath);
    // Allowlist + owner/repo extraction (throws on traversal / non-github).
    GitHubRestClient.validateRepoURL(gitUrl);
    const { owner, repo } = parseGitHubURL(gitUrl);

    const result = await mountAssetSpaceFiles({
      http: this.httpPort(),
      fs: this.fsPort(),
      owner,
      repo,
      ref,
      targetPath: safePath,
      onProgress,
    });

    // #3590 — record the mounted commit SHA (correct-by-construction from the
    // tarball wrapper) as the first-sync 3-way merge base, keyed by the SAME
    // `repoKey` the sync engine reads (`<owner>/<repo>#<SYNC_BRANCH>`). Recorded
    // NOW, before the user can edit or the remote can advance, so the very
    // first ExoSync reconciles against a real base instead of false-conflicting.
    // Best-effort: a store write failure must NOT fail the mount (the worst
    // case is the conservative full-conflict on first sync, never data loss).
    if (this.mountBaseStore !== undefined) {
      try {
        await this.mountBaseStore.set(`${owner}/${repo}#${SYNC_BRANCH}`, result.sha);
      } catch {
        /* non-fatal — first-sync falls back to full-conflict, never a loss */
      }
    }

    // Record the AssetSpace in `.gitmodules` (path + source URL). This is NOT a
    // git submodule registration — a git-free REST mount creates no gitlink
    // (`.git/config` / index stay untouched; mount-state visibility is
    // folder-presence, see class doc). The stanza is an INTENTIONAL, load-bearing
    // URL registry — NOT vestigial (D6 triage, node 794a95ae) — consumed by the
    // git-free rediscovery flows that have no other source for the remote URLs:
    //   - Bootstrap «clone-needs-fetch» — after a vault is cloned/synced without
    //     `--recurse-submodules` the `assetspaces/*` folders are empty but the
    //     URLs survive here, so {@link BootstrapAssetSpaceCommands}'s
    //     `fetchTrackedAssetSpaces()` re-materialises each AssetSpace from its
    //     recorded URL.
    //   - «Unmount assetspace» — {@link readGitmodulesEntries} is the canonical
    //     "what's mounted" registry the command lists.
    // The live apply path keys mount-state on folder presence, but neither it nor
    // ExoSync (descriptor-sourced URLs) read this — so do not "clean up" the write.
    await this.appendGitmodulesEntry(safePath, gitUrl);
    return result;
  }

  /**
   * Unmount an AssetSpace: strip its `.gitmodules` entry, then remove its
   * vault folder recursively. Idempotent — a missing folder or absent
   * `.gitmodules` stanza is a no-op.
   *
   * Ordering rationale (stanza-first): if a step fails mid-unmount, a leftover
   * empty folder (manifest already says "not mounted") is more benign than a
   * dangling `[submodule …]` stanza pointing at a folder that no longer exists.
   * A subsequent {@link mount} of the same path self-heals either way (the
   * `.gitmodules` append is idempotent on the path key).
   */
  public async unmount(submodulePath: string): Promise<void> {
    const safePath = validateVaultPathArg(submodulePath);
    await this.removeGitmodulesEntry(safePath);
    if (await this.adapter.exists(safePath)) {
      await this.adapter.rmdir(safePath, true);
    }
  }

  /**
   * Read the current `.gitmodules` (path, url) entries via `vault.adapter` —
   * the mobile-capable counterpart of
   * {@link GitSubmoduleOps.readGitmodulesEntries} (#3535). Reuses the shared
   * pure-text {@link parseGitmodulesEntries} parser (no Node `fs`). A missing
   * `.gitmodules` yields `[]`.
   *
   * Used by the mobile Bootstrap / Add-AssetSpace flow
   * ({@link BootstrapAssetSpaceCommands}) to classify the vault state (empty vs
   * clone-needs-fetch vs bootstrapped) without the desktop-only
   * `GitSubmoduleOps`.
   */
  public async readGitmodulesEntries(): Promise<GitmodulesEntry[]> {
    if (!(await this.adapter.exists(GITMODULES))) return [];
    const raw = await this.adapter.read(GITMODULES);
    return parseGitmodulesEntries(raw);
  }

  // ───────────────────────────── ports ─────────────────────────────

  /**
   * Rate-limit-gated `requestUrl` tarball fetch. The PAT (D3 REST-push reuse)
   * lives inside `client`; an insufficient scope surfaces as a redacted HTTP
   * 401/404 from `fetchTarballBuffer`.
   */
  private httpPort(): AssetSpaceHttpClient {
    const client = this.client;
    return {
      async fetchTarball(owner, repo, ref): Promise<Uint8Array> {
        // Pre-flight rate-limit gate — fetchTarballBuffer is one REST call.
        await client.ensureRateLimit(1);
        const blob = await client.fetchTarballBuffer(owner, repo, ref);
        return new Uint8Array(blob);
      },
    };
  }

  /**
   * `vault.adapter`-backed file-system port. `materialize()` keeps this
   * adapter's historic **additive direct-write** strategy verbatim (ensure the
   * mount folder + each parent chain, then `writeBinary` each file).
   */
  private fsPort(): FileSystemPort {
    const adapter = this.adapter;
    return {
      exists: (p) => adapter.exists(p),
      read: (p) => adapter.read(p),
      write: (p, c) => adapter.write(p, c),
      removeDir: (p) => adapter.rmdir(p, true),
      async materialize(targetPath: string, files: MountFile[]): Promise<number> {
        const ensureDir = async (dir: string): Promise<void> => {
          if (dir.length === 0) return;
          if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
        };
        const created = new Set<string>([targetPath]);
        const ensureDirChain = async (dir: string): Promise<void> => {
          if (dir.length === 0 || created.has(dir)) return;
          const parent = parentDir(dir);
          if (parent.length > 0) await ensureDirChain(parent);
          if (!created.has(dir)) {
            await ensureDir(dir);
            created.add(dir);
          }
        };

        await ensureDir(targetPath);
        let count = 0;
        for (const file of files) {
          const target = `${targetPath}/${file.relPath}`;
          // Defense-in-depth — the core already rejected `..` / non-wrapper
          // entries; confirm the joined target stays under the mount folder.
          if (target !== targetPath && !target.startsWith(targetPath + "/")) {
            throw new Error(
              `RestAssetSpaceMount.materialize: entry "${file.relPath}" escapes mount folder "${targetPath}"`,
            );
          }
          const parent = parentDir(target);
          if (parent.length > 0) await ensureDirChain(parent);
          await adapter.writeBinary(target, toArrayBuffer(file.content));
          count++;
        }
        return count;
      },
    };
  }

  // ───────────────────────────── .gitmodules I/O ─────────────────────────────

  /**
   * Idempotent `.gitmodules` stanza insertion over `vault.adapter` using the
   * shared {@link appendGitmodulesEntry} text transform.
   */
  private async appendGitmodulesEntry(
    submodulePath: string,
    url: string,
  ): Promise<void> {
    let existing = "";
    if (await this.adapter.exists(GITMODULES)) {
      existing = await this.adapter.read(GITMODULES);
    }
    const { content, added } = appendGitmodulesEntry(existing, submodulePath, url);
    if (added) await this.adapter.write(GITMODULES, content);
  }

  /**
   * Strip a `.gitmodules` stanza over `vault.adapter`, reusing the shared
   * {@link stripGitmodulesEntry} text transform. No-op when `.gitmodules` is
   * absent or has no matching stanza.
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
 * Convert a `Uint8Array` (possibly a view over a larger buffer, as the tarball
 * parser may emit) into a standalone `ArrayBuffer` for `DataAdapter.writeBinary`.
 */
function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(
    u8.byteOffset,
    u8.byteOffset + u8.byteLength,
  ) as ArrayBuffer;
}
