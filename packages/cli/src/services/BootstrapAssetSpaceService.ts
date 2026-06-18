/**
 * Phase 6.2 + 6.3 CLI Bootstrap service — pulls AssetSpace tarballs from
 * public GitHub repos and extracts к vault `assetspaces/<folder>/`.
 *
 * Per RFC 13da049f Phase 6.2 (Bootstrap UX) + Phase 6.3 (Add AssetSpace UX).
 *
 * ## Thin adapter over the shared mount core (Issue #3423)
 *
 * The mount pipeline (fetch tarball → discover `<owner>-<repo>-<sha>/` wrapper
 * → extract SHA → zip-slip validate → materialise → `.gitmodules` mutation)
 * lives ONCE in `exocortex`'s {@link mountAssetSpaceFiles} + `.gitmodules` text
 * transforms. This service supplies the two Node-coupled ports:
 *
 *   - **{@link FileSystemPort}** over Node `fs` — `materialize()` keeps the CLI's
 *     historic **atomic stage-then-rename** strategy (temp dir → `renameSync`,
 *     EXDEV copy fallback), refusing a non-empty target. No partial state on
 *     failure.
 *   - **{@link AssetSpaceHttpClient}** over Node `fetch` — anonymous or
 *     PAT-authenticated tarball pull with 403 rate-limit / 404 hint handling
 *     and a 50 MB size cap.
 *
 * Scope (CLI-only, desktop-only):
 *  - Uses Node 18+ native `fetch` (no Obsidian deps)
 *  - Tarball pull via `https://api.github.com/repos/<owner>/<repo>/tarball/<ref>`
 *  - Atomic extraction: temp dir → rename к target (no partial state)
 *  - Idempotent `.gitmodules` mutation (text manipulation, no `git` binary)
 *
 * Security:
 *  - URL allowlist: strict `https://github.com/<owner>/<repo>` shape only
 *  - Zip-slip protection: core rejects sym/hard links + `..` + non-wrapper
 *    entries; `materialize()` keeps a defense-in-depth resolve check
 *  - PAT redaction on every error path
 */

import { mkdirSync, writeFileSync, existsSync, renameSync, rmSync, readFileSync, readdirSync, appendFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename, resolve, sep } from "node:path";
import {
  mountAssetSpaceFiles,
  appendGitmodulesEntry,
  stripGitmodulesEntry as coreStripGitmodulesEntry,
  SYNC_BRANCH,
  type FileSystemPort,
  type AssetSpaceHttpClient,
  type MountBaseStorePort,
  type MountFile,
} from "exocortex";

const REPO_URL_REGEX = /^https:\/\/github\.com\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?$/;

const MAX_TARBALL_BYTES = 50 * 1024 * 1024; // 50 MB cap (matches plugin)

export interface PullResult {
  /** Wrapper dir SHA from GitHub tarball — abbreviated (anonymous, 7-char) or full (authenticated, 40-char) hex. */
  sha: string;
  /** Number of files extracted (excludes directories). */
  fileCount: number;
}

export interface BootstrapServiceOptions {
  /** Override fetch implementation for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /**
   * GitHub PAT for authenticated tarball pulls (private repos). When empty /
   * undefined the service stays in anonymous mode (public repos only) — the
   * exact behaviour shipped before token support. Resolved by the commands
   * from `--token` flag OR `GITHUB_TOKEN`/`GH_TOKEN` env (option > env).
   */
  token?: string;
  /**
   * #3590 — records the mounted commit SHA (the first-sync 3-way merge base)
   * keyed by `repoKey`, the instant an AssetSpace is pulled. Optional: absent ⇒
   * no base recorded ⇒ first-sync of a diverged repo stays the conservative
   * full-conflict (zero regression). The CLI commands build it over the vault's
   * device-local `exosync-mountbase.local.json` (same file `exosync sync`
   * reads). See {@link MountBaseStorePort}.
   */
  mountBaseStore?: MountBaseStorePort;
}

export class BootstrapAssetSpaceService {
  private readonly fetchImpl: typeof fetch;
  private readonly token: string;
  private readonly mountBaseStore?: MountBaseStorePort;

  // PAT redaction (mirrors plugin GitHubRestClient.PAT_REGEX) — replaces any
  // PAT-shaped substring that may leak into an error message / underlying
  // fetch error before it reaches stderr / --json. Covers classic family
  // (ghp_/gho_/ghu_/ghs_/ghr_, 36+ urlsafe chars) + fine-grained
  // github_pat_<22+ id>_<59+ secret> tokens.
  private static readonly PAT_REGEX =
    /(?:gh[pousr]_[A-Za-z0-9_]{36,}|github_pat_[A-Za-z0-9_]{22,}_[A-Za-z0-9_]{59,})/g;

  constructor(opts: BootstrapServiceOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.token = opts.token ?? "";
    this.mountBaseStore = opts.mountBaseStore;
  }

  /**
   * Replace any PAT-shaped substring with ***REDACTED***. Idempotent. Defends
   * against a token leaking via a third-party fetch-error formatter that
   * echoes request headers. Non-string inputs coerced via String().
   */
  private redact(message: unknown): string {
    const s = typeof message === "string" ? message : String(message);
    return s.replace(BootstrapAssetSpaceService.PAT_REGEX, "***REDACTED***");
  }

  /**
   * Validate URL shape + extract owner/repo.
   * @throws if URL doesn't match strict github.com allowlist.
   */
  static parseGitHubURL(url: string): { owner: string; repo: string } {
    const m = url.match(REPO_URL_REGEX);
    if (m === null) {
      throw new Error(
        `parseGitHubURL: invalid URL shape — expected https://github.com/<owner>/<repo>, got: ${url}`,
      );
    }
    return { owner: m[1], repo: m[2] };
  }

  /**
   * Derive default folder name from URL.
   * `https://github.com/kitelev/exoas-exo` → `exo` (strips `exoas-` prefix).
   * `https://github.com/kitelev/foo` → `foo` (no prefix).
   */
  static deriveFolderName(url: string): string {
    const { repo } = BootstrapAssetSpaceService.parseGitHubURL(url);
    return repo.startsWith("exoas-") ? repo.slice("exoas-".length) : repo;
  }

  /**
   * Pull tarball from a GitHub repo and extract к target dir, delegating the
   * fetch → wrapper → SHA → zip-slip → materialise pipeline to the shared core.
   * Atomic: extracts к temp dir first, then renames к target.
   * Idempotent: if target dir already exists с non-empty content, throws
   * (caller should pass --force OR pick fresh target).
   */
  async pullAssetSpace(
    repoUrl: string,
    ref: string,
    targetDir: string,
  ): Promise<PullResult> {
    const { owner, repo } = BootstrapAssetSpaceService.parseGitHubURL(repoUrl);

    // Refuse-non-empty BEFORE the network fetch (preserves original ordering —
    // no wasted tarball download when the target is already populated).
    if (existsSync(targetDir)) {
      const contents = readdirSync(targetDir);
      if (contents.length > 0) {
        throw new Error(
          `pullAssetSpace: target ${targetDir} exists и not empty — refusing к overwrite`,
        );
      }
    }

    const result = await mountAssetSpaceFiles({
      http: this.httpPort(),
      fs: this.fsPort(),
      owner,
      repo,
      ref,
      targetPath: targetDir,
    });

    // #3590 — record the mounted commit SHA (correct-by-construction from the
    // tarball wrapper) as the first-sync 3-way merge base, keyed by the SAME
    // `repoKey` the sync engine reads. Best-effort: a store-write failure must
    // NOT fail the pull (worst case is the conservative full-conflict on first
    // sync, never data loss).
    if (this.mountBaseStore !== undefined) {
      try {
        await this.mountBaseStore.set(
          `${owner}/${repo}#${SYNC_BRANCH}`,
          result.sha,
        );
      } catch {
        /* non-fatal — first-sync falls back to full-conflict, never a loss */
      }
    }

    return result;
  }

  /**
   * Node `fetch`-backed tarball port. Anonymous by default; attaches the PAT +
   * GitHub-required headers ONLY when a token is present (anonymous request
   * shape stays byte-identical to the pre-token behaviour). Surfaces actionable
   * 403 rate-limit / 404 hint messages, redacts PATs, and enforces the 50 MB
   * size cap.
   */
  private httpPort(): AssetSpaceHttpClient {
    const fetchImpl = this.fetchImpl;
    const token = this.token;
    const redact = (m: unknown): string => this.redact(m);
    return {
      async fetchTarball(owner, repo, ref): Promise<Uint8Array> {
        // GitHub API tarball — wrapper format `<owner>-<repo>-<sha>` (codeload
        // tarball uses `<repo>-<branch>` which loses SHA — use API endpoint).
        const tarballUrl = `https://api.github.com/repos/${owner}/${repo}/tarball/${ref}`;
        const init: RequestInit = { signal: AbortSignal.timeout(60_000) };
        if (token.length > 0) {
          init.headers = {
            Authorization: `Bearer ${token}`,
            "User-Agent": "exocortex-cli",
            "X-GitHub-Api-Version": "2022-11-28",
          };
        }
        let response: Awaited<ReturnType<typeof fetch>>;
        try {
          response = await fetchImpl(tarballUrl, init);
        } catch (err) {
          // Redact before re-throw: some fetch implementations embed the request
          // (incl. Authorization header) in the thrown error.
          throw new Error(
            redact(
              `pullAssetSpace: fetch error for ${tarballUrl}: ${err instanceof Error ? err.message : String(err)}`,
            ),
          );
        }
        if (!response.ok) {
          // Surface GitHub anonymous rate-limit (60 req/hour) with actionable
          // message instead of generic "fetch failed".
          if (response.status === 403) {
            const remaining = response.headers?.get?.("x-ratelimit-remaining");
            const resetEpoch = response.headers?.get?.("x-ratelimit-reset");
            if (remaining === "0" || (resetEpoch !== null && resetEpoch !== undefined)) {
              const resetAt = resetEpoch !== null && resetEpoch !== undefined
                ? new Date(Number(resetEpoch) * 1000).toISOString()
                : "unknown";
              throw new Error(
                `pullAssetSpace: GitHub anonymous API rate-limit exceeded (60 req/hour). Reset at ${resetAt}. Wait or use authenticated CLI.`,
              );
            }
          }
          // GitHub returns 404 (not 403) for private repos the caller can't see.
          if (response.status === 404) {
            const hint = token.length > 0
              ? "repo not found, or the provided token lacks access to it"
              : "if this is a private repo, pass --token <pat> (or set GITHUB_TOKEN / GH_TOKEN)";
            throw new Error(
              redact(
                `pullAssetSpace: fetch failed (404 Not Found) for ${tarballUrl} — ${hint}`,
              ),
            );
          }
          throw new Error(
            redact(
              `pullAssetSpace: fetch failed (${response.status} ${response.statusText}) for ${tarballUrl}`,
            ),
          );
        }
        const arrayBuf = await response.arrayBuffer();
        if (arrayBuf.byteLength > MAX_TARBALL_BYTES) {
          throw new Error(
            `pullAssetSpace: tarball too large (${arrayBuf.byteLength} bytes > ${MAX_TARBALL_BYTES})`,
          );
        }
        return new Uint8Array(arrayBuf);
      },
    };
  }

  /**
   * Node `fs`-backed file-system port. `materialize()` keeps the CLI's
   * historic **atomic stage-then-rename** strategy: write every file under a
   * fresh temp dir, then `renameSync` (EXDEV copy fallback) onto the target so
   * a mid-write failure never leaves a partial tree. The core already rejected
   * `..` / non-wrapper / link entries; the per-entry resolve check below is
   * defense-in-depth against a regression in the core validation.
   */
  private fsPort(): FileSystemPort {
    return {
      async exists(p: string): Promise<boolean> {
        return existsSync(p);
      },
      async read(p: string): Promise<string> {
        return readFileSync(p, "utf8");
      },
      async write(p: string, content: string): Promise<void> {
        writeFileSync(p, content, { encoding: "utf8" });
      },
      async removeDir(p: string): Promise<void> {
        rmSync(p, { recursive: true, force: true });
      },
      async materialize(targetDir: string, files: MountFile[]): Promise<number> {
        const stagingDir = await mkdtemp(join(tmpdir(), `exo-bootstrap-${basename(targetDir)}-`));
        let fileCount = 0;
        try {
          for (const file of files) {
            const rel = file.relPath;
            // Segment-based `..` check (substring would reject legitimate names
            // like `foo..bar.md`) — defense-in-depth over the core's check.
            if (rel.split("/").some((s) => s === "..")) {
              throw new Error(`pullAssetSpace: path traversal detected for entry "${rel}"`);
            }
            // Zip-slip defense: resolve target, verify it stays under stagingDir.
            const target = resolve(stagingDir, rel);
            if (target !== stagingDir && !target.startsWith(stagingDir + sep)) {
              throw new Error(`pullAssetSpace: zip-slip detected for entry "${rel}"`);
            }
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, file.content);
            fileCount++;
          }

          // Atomic move к target.
          mkdirSync(dirname(targetDir), { recursive: true });
          try {
            renameSync(stagingDir, targetDir);
          } catch (err) {
            // EXDEV fallback. mkdtemp may put staging on a different filesystem
            // than the vault (macOS /private/var/folders/ vs ~). Copy + rm.
            if ((err as NodeJS.ErrnoException).code === "EXDEV") {
              const { cpSync } = await import("node:fs");
              cpSync(stagingDir, targetDir, { recursive: true });
              rmSync(stagingDir, { recursive: true, force: true });
            } else {
              throw err;
            }
          }
        } catch (err) {
          // Cleanup staging on any failure.
          rmSync(stagingDir, { recursive: true, force: true });
          throw err;
        }
        return fileCount;
      },
    };
  }

  /**
   * Idempotent `.gitmodules` entry insertion via the shared
   * {@link appendGitmodulesEntry} text transform. Appends only the new stanza
   * (flag `a`, TOCTOU-safe single syscall chain) when absent; no-op when the
   * `submodulePath` key is already present.
   */
  ensureGitmodulesEntry(
    vaultPath: string,
    submodulePath: string,
    repoUrl: string,
  ): { added: boolean } {
    const gitmodulesPath = join(vaultPath, ".gitmodules");
    let existing = "";
    try {
      existing = readFileSync(gitmodulesPath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    const { content, added } = appendGitmodulesEntry(existing, submodulePath, repoUrl);
    if (!added) return { added: false };
    // `content` is `existing + sep + newEntry`; append only the delta so the
    // write stays an `appendFileSync` (open flag `a`) rather than a read-modify-
    // write rewrite (CodeQL HIGH TOCTOU on the prior existsSync→writeFileSync).
    appendFileSync(gitmodulesPath, content.slice(existing.length), { encoding: "utf8" });
    return { added: true };
  }

  /**
   * Idempotent `.gitmodules` entry removal via the shared
   * {@link coreStripGitmodulesEntry} text transform — the unmount counterpart
   * of {@link ensureGitmodulesEntry}. No-op (returns `{ removed: false }`) when
   * `.gitmodules` is absent or has no matching stanza.
   */
  removeGitmodulesEntry(
    vaultPath: string,
    submodulePath: string,
  ): { removed: boolean } {
    const gitmodulesPath = join(vaultPath, ".gitmodules");
    let original: string;
    try {
      original = readFileSync(gitmodulesPath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { removed: false };
      }
      throw err;
    }
    const rewritten = coreStripGitmodulesEntry(original, submodulePath);
    if (rewritten === original) return { removed: false };
    writeFileSync(gitmodulesPath, rewritten, { encoding: "utf8" });
    return { removed: true };
  }

  /**
   * Pure `.gitmodules` stanza strip — delegates to the shared core transform.
   * Static + side-effect free, retained for backward-compatible callers.
   */
  static stripGitmodulesEntry(content: string, submodulePath: string): string {
    return coreStripGitmodulesEntry(content, submodulePath);
  }

  /**
   * Unmount an AssetSpace: strip its `.gitmodules` stanza, then recursively
   * remove its vault folder. Idempotent — a missing folder or absent
   * `.gitmodules` stanza is a no-op.
   *
   * Ordering (stanza-first) mirrors the plugin's `RestAssetSpaceMount.unmount`.
   *
   * Safety (defense-in-depth): the `rmSync` is recursive+force, so a bad
   * `submodulePath` (empty, traversal, or non-`assetspaces/`) could escape to
   * the vault root or an unrelated directory. The path is validated — and the
   * resolved target confirmed strictly under the vault root — BEFORE any
   * mutation (including the `.gitmodules` edit).
   *
   * @param vaultPath absolute vault root.
   * @param submodulePath vault-relative mount folder (e.g. `assetspaces/kitelev/exoas-testlib`).
   * @throws if `submodulePath` is empty, contains a `..`/`.` segment, is not
   *   under `assetspaces/`, or resolves outside the vault root.
   */
  unmountAssetSpace(vaultPath: string, submodulePath: string): void {
    const segments = submodulePath.split("/");
    if (
      submodulePath.length === 0 ||
      !submodulePath.startsWith("assetspaces/") ||
      segments.some((s) => s.length === 0 || s === "." || s === "..")
    ) {
      throw new Error(
        `unmountAssetSpace: refusing unsafe submodulePath "${submodulePath}"`,
      );
    }
    const root = resolve(vaultPath);
    const target = resolve(root, submodulePath);
    if (target === root || !target.startsWith(root + sep)) {
      throw new Error(
        `unmountAssetSpace: target "${target}" escapes vault root "${root}"`,
      );
    }
    this.removeGitmodulesEntry(vaultPath, submodulePath);
    if (existsSync(target)) {
      rmSync(target, { recursive: true, force: true });
    }
  }
}
