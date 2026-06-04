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

import { mkdirSync, writeFileSync, existsSync, renameSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve, sep } from "node:path";
import { parseTarGzip } from "nanotar";

const REPO_URL_REGEX = /^https:\/\/github\.com\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?$/;

const MAX_TARBALL_BYTES = 50 * 1024 * 1024; // 50 MB cap (matches plugin)

export interface PullResult {
  /** Wrapper dir SHA from GitHub tarball (7-char hex). */
  sha: string;
  /** Number of files extracted (excludes directories). */
  fileCount: number;
}

export interface BootstrapServiceOptions {
  /** Override fetch implementation for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export class BootstrapAssetSpaceService {
  private readonly fetchImpl: typeof fetch;

  constructor(opts: BootstrapServiceOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
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
    // Code-reviewer MEDIUM: fetch timeout (60s) prevents indefinite hang
    // on slow/stalled GitHub response. Cap matches typical CI test timeouts.
    const response = await this.fetchImpl(tarballUrl, {
      signal: AbortSignal.timeout(60_000),
    });
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
      throw new Error(
        `pullAssetSpace: fetch failed (${response.status} ${response.statusText}) for ${tarballUrl}`,
      );
    }
    const arrayBuf = await response.arrayBuffer();
    if (arrayBuf.byteLength > MAX_TARBALL_BYTES) {
      throw new Error(
        `pullAssetSpace: tarball too large (${arrayBuf.byteLength} bytes > ${MAX_TARBALL_BYTES})`,
      );
    }
    const buffer = new Uint8Array(arrayBuf);
    const entries = await parseTarGzip(buffer);
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

    // Extract SHA from wrapper.
    const shaMatch = wrapper.match(/-([0-9a-f]{7})$/);
    if (shaMatch === null) {
      throw new Error(
        `pullAssetSpace: cannot extract SHA from wrapper "${wrapper}"`,
      );
    }
    const sha = shaMatch[1];

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

    if (!existsSync(gitmodulesPath)) {
      writeFileSync(gitmodulesPath, newEntry, "utf8");
      return { added: true };
    }

    const existing = readFileSync(gitmodulesPath, "utf8");
    // Code-reviewer LOW: anchor regex avoids false-positive on commented-out
    // headers (e.g. `# [submodule "..."]`).
    const escaped = submodulePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const headerRegex = new RegExp(`^\\s*\\[submodule "${escaped}"\\]`, "m");
    if (headerRegex.test(existing)) {
      return { added: false };
    }

    const sep = existing.endsWith("\n") ? "" : "\n";
    writeFileSync(gitmodulesPath, existing + sep + newEntry, "utf8");
    return { added: true };
  }
}

