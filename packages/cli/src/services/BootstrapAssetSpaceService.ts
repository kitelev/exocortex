/**
 * Phase 6.2 + 6.3 CLI Bootstrap service — pulls AssetSpace tarballs from
 * public GitHub repos and extracts к vault `assetspaces/<folder>/`.
 *
 * Per RFC 13da049f Phase 6.2 (Bootstrap UX) + Phase 6.3 (Add AssetSpace UX).
 *
 * Scope (CLI-only, desktop-only):
 *  - Uses Node 18+ native `fetch` (no Obsidian deps)
 *  - Anonymous GitHub access (public repos only)
 *  - Tarball pull via `https://codeload.github.com/<owner>/<repo>/tar.gz/refs/heads/<ref>`
 *  - Atomic extraction: temp dir → rename к target (no partial state)
 *  - Idempotent `.gitmodules` mutation (text manipulation, no `git` binary needed)
 *
 * Security:
 *  - URL allowlist: strict `https://github.com/<owner>/<repo>` shape only
 *  - Zip-slip protection: all extracted paths verified к stay under target dir
 *  - Per-entry filesystem path validation
 *
 * Plugin-equivalent: AssetSpaceManager.pullAssetSpace (different runtime
 * constraints — plugin uses Obsidian's `requestUrl`, CLI uses native `fetch`).
 */

import { mkdirSync, writeFileSync, existsSync, renameSync, rmSync, readFileSync, readdirSync, appendFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve, sep } from "node:path";
import { parseTarballGzip } from "exocortex";

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
}

export class BootstrapAssetSpaceService {
  private readonly fetchImpl: typeof fetch;
  private readonly token: string;

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
   * Pull tarball from public GitHub repo and extract к target dir.
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

    if (existsSync(targetDir)) {
      const contents = readdirSync(targetDir);
      if (contents.length > 0) {
        throw new Error(
          `pullAssetSpace: target ${targetDir} exists и not empty — refusing к overwrite`,
        );
      }
    }

    // GitHub API tarball — wrapper format `<owner>-<repo>-<sha7>` (matches
    // plugin's AssetSpaceManager.pullAssetSpace contract). Codeload tarball
    // uses `<repo>-<branch>` wrapper which loses SHA — use API endpoint.
    const tarballUrl = `https://api.github.com/repos/${owner}/${repo}/tarball/${ref}`;
    // Authenticated mode: attach Authorization + GitHub-required headers ONLY
    // when a token is present. Empty token → anonymous request shape is left
    // byte-identical to the pre-token behaviour (public repos, no headers).
    // The authenticated endpoint returns a full-40-char-SHA wrapper which the
    // SHA matcher (7..40 hex) and #3390 ustar-prefix parser already handle.
    const init: RequestInit = { signal: AbortSignal.timeout(60_000) };
    if (this.token.length > 0) {
      init.headers = {
        Authorization: `Bearer ${this.token}`,
        "User-Agent": "exocortex-cli",
        "X-GitHub-Api-Version": "2022-11-28",
      };
    }
    // Code-reviewer MEDIUM: fetch timeout (60s) prevents indefinite hang
    // on slow/stalled GitHub response. Cap matches typical CI test timeouts.
    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      response = await this.fetchImpl(tarballUrl, init);
    } catch (err) {
      // Redact before re-throw: some fetch implementations embed the request
      // (incl. Authorization header) in the thrown error.
      throw new Error(
        this.redact(
          `pullAssetSpace: fetch error for ${tarballUrl}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }
    if (!response.ok) {
      // Code-reviewer MEDIUM: surface GitHub anonymous rate-limit (60 req/hour)
      // с actionable message instead of generic "fetch failed".
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
      // GitHub returns 404 (not 403) for private repos the caller can't see —
      // it deliberately hides existence. If we pulled anonymously, hint that a
      // token may be required. With a token, 404 means genuinely-missing repo
      // OR the token lacks access — surface both possibilities.
      if (response.status === 404) {
        const hint = this.token.length > 0
          ? "repo not found, or the provided token lacks access to it"
          : "if this is a private repo, pass --token <pat> (or set GITHUB_TOKEN / GH_TOKEN)";
        throw new Error(
          this.redact(
            `pullAssetSpace: fetch failed (404 Not Found) for ${tarballUrl} — ${hint}`,
          ),
        );
      }
      throw new Error(
        this.redact(
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
    const buffer = new Uint8Array(arrayBuf);
    const entries = await parseTarballGzip(buffer);
    if (entries.length === 0) {
      throw new Error(`pullAssetSpace: empty tarball for ${owner}/${repo}@${ref}`);
    }

    // Discover wrapper dir (GitHub tarballs wrap all entries в <owner>-<repo>-<sha7>/).
    // Code-reviewer HIGH: skip pax_global_header / extended-header entries when
    // picking first wrapper-bearing entry — those don't share the wrapper prefix.
    const isHeaderType = (t: string | undefined): boolean =>
      t === "globalExtendedHeader" || t === "extendedHeader";
    const firstContentEntry = entries.find(
      (e) => !isHeaderType(e.type) && e.name.includes("/"),
    );
    if (firstContentEntry === undefined) {
      throw new Error(`pullAssetSpace: no wrapper-bearing entry in tarball`);
    }
    const slashIdx = firstContentEntry.name.indexOf("/");
    const wrapper = firstContentEntry.name.slice(0, slashIdx);
    const wrapperPrefix = wrapper + "/";

    // Verify all non-header entries share the wrapper.
    for (const entry of entries) {
      if (isHeaderType(entry.type)) continue;
      if (entry.name === wrapper || entry.name === wrapperPrefix) continue;
      if (!entry.name.startsWith(wrapperPrefix)) {
        throw new Error(
          `pullAssetSpace: entry "${entry.name}" not under wrapper "${wrapper}"`,
        );
      }
    }

    // Extract SHA from wrapper. Length is auth-dependent: anonymous tarballs
    // carry a 7-char abbreviated SHA, authenticated ones the full 40-char SHA
    // (matching only 7 broke private-repo pulls). Accept 7..40 hex.
    const shaMatch = wrapper.match(/-([0-9a-fA-F]{7,40})$/);
    if (shaMatch === null) {
      throw new Error(
        `pullAssetSpace: cannot extract SHA from wrapper "${wrapper}"`,
      );
    }
    const sha = shaMatch[1].toLowerCase(); // parity with plugin extractShaFromWrapper

    // Stage к temp dir, then atomic rename.
    const stagingDir = await mkdtemp(join(tmpdir(), `exo-bootstrap-${owner}-${repo}-`));
    let fileCount = 0;
    try {
      for (const entry of entries) {
        // Code-reviewer HIGH: explicit symlink/hardlink rejection (parity с
        // plugin TarExtractor.validateEntry). Tarballs from compromised
        // upstream could embed symlinks pointing outside vault — security risk.
        if (entry.type === "symbolicLink" || entry.type === "hardLink") {
          throw new Error(
            `pullAssetSpace: ${entry.type} entry "${entry.name}" rejected for security`,
          );
        }
        // Skip extended headers (no payload to extract).
        if (isHeaderType(entry.type)) continue;
        const rel = entry.name.slice(wrapperPrefix.length);
        if (rel.length === 0) continue;
        // Skip directory-type entries; they'll be created on-demand.
        if (entry.type === "directory") continue;
        if (entry.data === undefined) continue;

        // Code-reviewer MEDIUM: segment-based `..` check (substring rejects
        // legitimate names like `foo..bar.md`).
        if (rel.split("/").some((s) => s === "..")) {
          throw new Error(`pullAssetSpace: path traversal detected for entry "${entry.name}"`);
        }
        // Zip-slip defense: resolve target, verify it stays under stagingDir.
        const target = resolve(stagingDir, rel);
        if (target !== stagingDir && !target.startsWith(stagingDir + sep)) {
          throw new Error(`pullAssetSpace: zip-slip detected for entry "${entry.name}"`);
        }
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, entry.data);
        fileCount++;
      }

      // Atomic move к target.
      mkdirSync(dirname(targetDir), { recursive: true });
      try {
        renameSync(stagingDir, targetDir);
      } catch (err) {
        // Code-reviewer LOW: EXDEV fallback. mkdtemp may put staging on different
        // filesystem than vault (macOS /private/var/folders/ vs ~). Copy + rm.
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

    return { sha, fileCount };
  }

  /**
   * Idempotent `.gitmodules` entry insertion via text manipulation.
   * Uses standard git-submodule.git format (one `[submodule "..."]` stanza
   * per entry с `path` + `url`).
   *
   * If entry already present (by `submodulePath` key), no change made.
   */
  ensureGitmodulesEntry(
    vaultPath: string,
    submodulePath: string,
    repoUrl: string,
  ): { added: boolean } {
    const gitmodulesPath = join(vaultPath, ".gitmodules");
    const entryHeader = `[submodule "${submodulePath}"]`;
    const newEntry = `${entryHeader}\n\tpath = ${submodulePath}\n\turl = ${repoUrl}\n`;
    // Code-reviewer LOW: anchor regex avoids false-positive on commented-out
    // headers (e.g. `# [submodule "..."]`).
    const escaped = submodulePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const headerRegex = new RegExp(`^\\s*\\[submodule "${escaped}"\\]`, "m");

    // CodeQL HIGH: avoid TOCTOU race between existsSync→writeFileSync.
    // Open с flag `a` (append, creates if missing) gives single atomic call.
    // Then re-read to check idempotency. If header already present, no-op;
    // otherwise append the new entry. Using `a` instead of `w` preserves
    // existing content if file appeared between calls.
    let existing = "";
    try {
      existing = readFileSync(gitmodulesPath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    if (existing.length > 0 && headerRegex.test(existing)) {
      return { added: false };
    }
    const sep = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
    // appendFileSync = open(flag='a') + write + close — single syscall chain,
    // no separate exists check needed. Created с 0o644 by default.
    appendFileSync(gitmodulesPath, sep + newEntry, { encoding: "utf8" });
    return { added: true };
  }

  /**
   * Idempotent `.gitmodules` entry removal via text manipulation — the
   * unmount counterpart of {@link ensureGitmodulesEntry}. Strips the
   * `[submodule "<submodulePath>"]` stanza (header + all following lines until
   * the next `[` header or EOF) and collapses the double-blank line the strip
   * may leave behind.
   *
   * Mirrors the plugin's pure `stripGitmodulesEntry` text transform
   * (`GitSubmoduleOps.ts`) so the CLI hard-switch produces byte-equivalent
   * `.gitmodules` output to the Obsidian REST unmount path. No-op (returns
   * `{ removed: false }`) when `.gitmodules` is absent or has no matching
   * stanza.
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
    const rewritten = BootstrapAssetSpaceService.stripGitmodulesEntry(
      original,
      submodulePath,
    );
    if (rewritten === original) return { removed: false };
    writeFileSync(gitmodulesPath, rewritten, { encoding: "utf8" });
    return { removed: true };
  }

  /**
   * Pure `.gitmodules` stanza strip — header + body lines up to the next
   * `[…]` header or EOF, then double-blank collapse. Static + side-effect free
   * for unit testing. Byte-parity with plugin `GitSubmoduleOps.stripGitmodulesEntry`.
   */
  static stripGitmodulesEntry(content: string, submodulePath: string): string {
    const escaped = submodulePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const lines = content.split(/\r?\n/);
    const out: string[] = [];
    let skipping = false;
    const headerPattern = new RegExp(`^\\[submodule\\s+"${escaped}"\\]\\s*$`);
    for (const line of lines) {
      if (skipping) {
        // Next stanza starts — stop skipping (do NOT consume the new header).
        if (/^\[.+\]\s*$/.test(line)) {
          skipping = false;
          out.push(line);
          continue;
        }
        continue;
      }
      if (headerPattern.test(line)) {
        skipping = true;
        continue;
      }
      out.push(line);
    }
    // Collapse double-blank lines created by the strip.
    const collapsed: string[] = [];
    let prevBlank = false;
    for (const line of out) {
      const blank = line.trim().length === 0;
      if (blank && prevBlank) continue;
      collapsed.push(line);
      prevBlank = blank;
    }
    return collapsed.join("\n");
  }

  /**
   * Unmount an AssetSpace: strip its `.gitmodules` stanza, then recursively
   * remove its vault folder. Idempotent — a missing folder or absent
   * `.gitmodules` stanza is a no-op.
   *
   * Ordering (stanza-first) mirrors the plugin's `RestAssetSpaceMount.unmount`:
   * if a step fails mid-unmount, a leftover empty folder (manifest already says
   * "not mounted") is more benign than a dangling `[submodule …]` stanza
   * pointing at a folder that no longer exists.
   *
   * @param vaultPath absolute vault root.
   * @param submodulePath vault-relative mount folder (e.g. `assetspaces/kitelev/exoas-testlib`).
   */
  unmountAssetSpace(vaultPath: string, submodulePath: string): void {
    this.removeGitmodulesEntry(vaultPath, submodulePath);
    const target = join(vaultPath, submodulePath);
    if (existsSync(target)) {
      rmSync(target, { recursive: true, force: true });
    }
  }
}

