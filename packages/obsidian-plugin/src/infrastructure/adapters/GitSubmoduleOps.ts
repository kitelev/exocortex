/* eslint-disable no-restricted-imports, import/no-nodejs-modules */
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
/* eslint-enable no-restricted-imports, import/no-nodejs-modules */
import { Platform } from "obsidian";

const execFile = promisify(execFileCb);

/**
 * GitSubmoduleOps — security-hardened wrapper for the git subprocess calls
 * needed by `FocusProfileSwitchManager.hardSwitchProfile` per RFC 22b50a17
 * §Solution Architecture lines 127-137.
 *
 * Operations covered:
 *   - `git submodule deinit -f assetspaces/<as>`
 *   - `rm -rf .git/modules/<as>` (M2 BLOCKER orphan cleanup)
 *   - `rm -rf <vault>/assetspaces/<as>` (filesystem destroy)
 *   - `git submodule add <url> assetspaces/<as>`
 *   - `.gitmodules` atomic entry removal (temp-file + rename, не in-place truncate)
 *   - `git add .gitmodules / assetspaces/`
 *   - `git commit -m "<msg>"`
 *   - `git status --porcelain assetspaces/<as>/`
 *
 * ## Security shape
 *
 * - Uses `child_process.execFile` (NOT `exec` — no shell interpolation).
 * - Path args rejected if they contain `..`, absolute, or shell metacharacters.
 * - Working directory pinned to `vaultRootPath` (resolved absolute).
 * - 60s default timeout per operation (long enough for `submodule add` over
 *   tarball / clone; short enough to surface hangs).
 * - Captures stderr for diagnostic propagation through thrown errors.
 *
 * Mobile guard: every public method throws — Phase 5 hard switch is
 * desktop-only (RFC R24 scope).
 */
export interface GitSubmoduleOpsOptions {
  vaultRootPath: string;
  /** Timeout per git operation, milliseconds. Default 60_000. */
  timeoutMs?: number;
  /** Test injection: override the underlying `execFile`. */
  execFileFn?: typeof execFile;
}

/**
 * Validate a vault-relative path segment used as an argument to git.
 *
 * Rejects:
 *   - empty string
 *   - absolute paths (`/` prefix)
 *   - parent traversal (`..` segment)
 *   - shell metacharacters (`;`, `|`, `&`, `$`, `` ` ``, `(`, `)`, `<`, `>`)
 *   - leading `-` (would be parsed as flag by git)
 *
 * Throws on any violation. Otherwise returns the normalized path (forward
 * slashes, no trailing slash).
 */
export function validateVaultPathArg(arg: string): string {
  if (typeof arg !== "string" || arg.length === 0) {
    throw new Error(`GitSubmoduleOps: empty path argument`);
  }
  if (arg.startsWith("/")) {
    throw new Error(`GitSubmoduleOps: absolute path rejected: ${arg}`);
  }
  if (arg.startsWith("-")) {
    throw new Error(`GitSubmoduleOps: leading-dash arg rejected (looks like flag): ${arg}`);
  }
  const normalized = arg.replace(/\\/g, "/").replace(/\/+$/, "");
  const segments = normalized.split("/");
  for (const seg of segments) {
    if (seg === "..") {
      throw new Error(`GitSubmoduleOps: parent traversal in path: ${arg}`);
    }
  }
  // Disallow shell metas — execFile doesn't interpret them, но this is
  // defense-in-depth in case the path leaks into a logged shell string.
  if (/[;|&$`()<>\n\r]/.test(normalized)) {
    throw new Error(`GitSubmoduleOps: shell metacharacter in path: ${arg}`);
  }
  return normalized;
}

/**
 * Validate a GitHub URL passed to `git submodule add`. Reuses the same
 * shape rules as `GitHubRestClient.validateRepoURL` без importing that class
 * (avoids circular dependency between Phase 5 adapters). Mirror the regex
 * exactly so any allowlist drift is caught by code-review.
 */
export function validateGitUrl(url: string): string {
  if (typeof url !== "string" || url.length === 0) {
    throw new Error(`GitSubmoduleOps: empty git URL`);
  }
  if (url.startsWith("-")) {
    throw new Error(`GitSubmoduleOps: leading-dash URL rejected: ${url}`);
  }
  // Allow https://github.com/owner/repo[.git] AND file:// urls for tests.
  const githubOk = /^https:\/\/github\.com\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+?(?:\.git)?$/.test(url);
  const fileOk = /^file:\/\/\/[a-zA-Z0-9_./-]+$/.test(url);
  if (!githubOk && !fileOk) {
    throw new Error(`GitSubmoduleOps: invalid git URL shape (must be https://github.com/... or file://...): ${url}`);
  }
  if (/[;|&$`()<>\n\r]/.test(url)) {
    throw new Error(`GitSubmoduleOps: shell metacharacter in URL: ${url}`);
  }
  return url;
}

export class GitSubmoduleOps {
  private readonly vaultRootPath: string;
  private readonly timeoutMs: number;
  private readonly execFileFn: typeof execFile;

  constructor(options: GitSubmoduleOpsOptions) {
    if (!options || typeof options.vaultRootPath !== "string" || options.vaultRootPath.length === 0) {
      throw new Error("GitSubmoduleOps: vaultRootPath is required");
    }
    this.vaultRootPath = path.resolve(options.vaultRootPath);
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.execFileFn = options.execFileFn ?? execFile;
  }

  /** Run an arbitrary `git <args>` command from the vault root. */
  async run(args: ReadonlyArray<string>): Promise<{ stdout: string; stderr: string }> {
    this.assertDesktop("run");
    if (!Array.isArray(args) || args.length === 0) {
      throw new Error("GitSubmoduleOps.run: args required");
    }
    // Reject any arg starting with `-` UNLESS in a small allowlist of flags
    // we actually use — defense-in-depth (a stray `-c core.X=Y` could mutate
    // user's git config from the plugin if a caller misuses run()).
    const ALLOWED_FLAGS = new Set<string>([
      "-f",
      "-m",
      "--porcelain",
      "--no-edit",
      "submodule",
      "deinit",
      "add",
      "commit",
      "status",
    ]);
    for (const arg of args) {
      if (typeof arg !== "string") {
        throw new Error(`GitSubmoduleOps.run: non-string arg`);
      }
      if (arg.startsWith("-") && !ALLOWED_FLAGS.has(arg)) {
        throw new Error(`GitSubmoduleOps.run: disallowed flag argument: ${arg}`);
      }
    }
    try {
      const { stdout, stderr } = await this.execFileFn("git", Array.from(args), {
        cwd: this.vaultRootPath,
        timeout: this.timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
        // Strip inherited GIT_* env vars — if Obsidian is launched from a
        // shell with GIT_DIR/GIT_INDEX_FILE set (e.g. during a husky hook
        // or active rebase), they would hijack every git call we make
        // away from `vaultRootPath`. Same hardening reused by integration
        // tests where lint-staged sets these vars on the parent process.
        env: stripGitEnv(),
      });
      return {
        stdout: typeof stdout === "string" ? stdout : (stdout as Buffer).toString("utf8"),
        stderr: typeof stderr === "string" ? stderr : (stderr as Buffer).toString("utf8"),
      };
    } catch (err) {
      const e = err as { stderr?: string | Buffer; stdout?: string | Buffer; message?: string };
      const stderr = e?.stderr
        ? typeof e.stderr === "string"
          ? e.stderr
          : e.stderr.toString("utf8")
        : "";
      const msg = e?.message ?? String(err);
      throw new Error(`git ${args.join(" ")} failed: ${msg}${stderr ? ` — stderr: ${stderr}` : ""}`);
    }
  }

  /** `git submodule deinit -f assetspaces/<as>` */
  async submoduleDeinit(submodulePath: string): Promise<void> {
    const safe = validateVaultPathArg(submodulePath);
    await this.run(["submodule", "deinit", "-f", safe]);
  }

  /** `git submodule add <url> assetspaces/<as>` */
  async submoduleAdd(url: string, submodulePath: string): Promise<void> {
    const safeUrl = validateGitUrl(url);
    const safePath = validateVaultPathArg(submodulePath);
    await this.run(["submodule", "add", safeUrl, safePath]);
  }

  /**
   * `git status --porcelain <pathspec>` — returns raw porcelain output.
   * Caller parses for non-empty lines == dirty.
   */
  async statusPorcelain(pathspec: string): Promise<string> {
    const safe = validateVaultPathArg(pathspec);
    const { stdout } = await this.run(["status", "--porcelain", safe]);
    return stdout;
  }

  /** `git add <path>` */
  async add(pathspec: string): Promise<void> {
    const safe = validateVaultPathArg(pathspec);
    await this.run(["add", safe]);
  }

  /** `git commit -m "<message>"` */
  async commit(message: string): Promise<void> {
    if (typeof message !== "string" || message.length === 0) {
      throw new Error("GitSubmoduleOps.commit: message required");
    }
    if (/[\n\r]/.test(message)) {
      throw new Error("GitSubmoduleOps.commit: newline in commit message rejected (use repeated -m args if needed)");
    }
    await this.run(["commit", "-m", message]);
  }

  /**
   * Remove `.git/modules/<submodulePath>` directory — M2 BLOCKER orphan
   * cleanup per RFC §Solution Architecture line 132. `git submodule deinit`
   * leaves the modules tree behind; re-`submodule add` of the same path then
   * fails с «already exists в the index» если modules dir lingers.
   *
   * Git preserves the **full path structure** for submodule modules dirs:
   * `git submodule add <url> assetspaces/ems` creates
   * `.git/modules/assetspaces/ems/`, NOT `.git/modules/ems/`. We mirror
   * this exactly. Validated against vault root to prevent traversal.
   */
  async removeGitModulesDir(submodulePath: string): Promise<void> {
    this.assertDesktop("removeGitModulesDir");
    const safe = validateVaultPathArg(submodulePath);
    // Resolve and verify the target is inside `<vault>/.git/modules/`.
    const target = path.resolve(this.vaultRootPath, ".git", "modules", safe);
    const expectedPrefix = path.resolve(this.vaultRootPath, ".git", "modules") + path.sep;
    if (!target.startsWith(expectedPrefix)) {
      throw new Error(`GitSubmoduleOps.removeGitModulesDir: escape attempt: ${target}`);
    }
    await fs.rm(target, { recursive: true, force: true });
  }

  /**
   * `rm -rf <vault>/<submodulePath>` — destroys the working tree of the
   * AssetSpace. Validated against vault root.
   */
  async removeWorkingTree(submodulePath: string): Promise<void> {
    this.assertDesktop("removeWorkingTree");
    const safe = validateVaultPathArg(submodulePath);
    const target = path.resolve(this.vaultRootPath, safe);
    const expectedPrefix = this.vaultRootPath + path.sep;
    if (!target.startsWith(expectedPrefix)) {
      throw new Error(`GitSubmoduleOps.removeWorkingTree: escape attempt: ${target}`);
    }
    await fs.rm(target, { recursive: true, force: true });
  }

  /**
   * `mv <stagingPath> <vault>/<submodulePath>` — materialize tarball
   * contents into vault location. Both args validated.
   */
  async renameIntoVault(stagingPath: string, submodulePath: string): Promise<void> {
    this.assertDesktop("renameIntoVault");
    if (typeof stagingPath !== "string" || stagingPath.length === 0) {
      throw new Error(`GitSubmoduleOps.renameIntoVault: stagingPath required`);
    }
    const safeStaging = path.resolve(stagingPath);
    const safeSub = validateVaultPathArg(submodulePath);
    const target = path.resolve(this.vaultRootPath, safeSub);
    const expectedPrefix = this.vaultRootPath + path.sep;
    if (!target.startsWith(expectedPrefix)) {
      throw new Error(`GitSubmoduleOps.renameIntoVault: escape attempt: ${target}`);
    }
    // fs.rename fails across devices (EXDEV). Detect-and-fallback:
    try {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.rename(safeStaging, target);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e?.code === "EXDEV") {
        // Cross-device — copy then unlink.
        await copyDirRecursive(safeStaging, target);
        await fs.rm(safeStaging, { recursive: true, force: true });
        return;
      }
      throw err;
    }
  }

  /**
   * Atomic `.gitmodules` entry removal: read file, strip the `[submodule "<path>"]`
   * stanza + its key=value lines, write to temp, rename over the original.
   *
   * Mirrors `git submodule deinit`'s `.gitmodules` mutation but без invoking
   * git (which won't strip the stanza on its own — deinit only unregisters
   * runtime state, не the manifest).
   */
  async atomicGitmodulesEntryRemove(submodulePath: string): Promise<void> {
    this.assertDesktop("atomicGitmodulesEntryRemove");
    const safe = validateVaultPathArg(submodulePath);
    const gitmodulesPath = path.resolve(this.vaultRootPath, ".gitmodules");
    let original: string;
    try {
      original = await fs.readFile(gitmodulesPath, "utf8");
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e?.code === "ENOENT") return; // Nothing to remove.
      throw err;
    }
    const rewritten = stripGitmodulesEntry(original, safe);
    if (rewritten === original) return; // No matching stanza.
    const tmpPath = `${gitmodulesPath}.tmp-${Date.now()}-${randomBytes(4).toString("hex")}`;
    try {
      await fs.writeFile(tmpPath, rewritten, "utf8");
      await fs.rename(tmpPath, gitmodulesPath);
    } catch (err) {
      await fs.rm(tmpPath, { force: true }).catch(() => undefined);
      throw err;
    }
  }

  /**
   * Read `.gitmodules` and parse the set of `[submodule "<path>"]` entries.
   * Returns the set of submodule paths (e.g. `"assetspaces/ems"`). Missing
   * `.gitmodules` returns empty set.
   */
  async readGitmodulesPaths(): Promise<Set<string>> {
    const gitmodulesPath = path.resolve(this.vaultRootPath, ".gitmodules");
    let raw: string;
    try {
      raw = await fs.readFile(gitmodulesPath, "utf8");
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e?.code === "ENOENT") return new Set<string>();
      throw err;
    }
    return parseGitmodulesPaths(raw);
  }

  private assertDesktop(op: string): void {
    if (isPlatformMobile()) {
      throw new Error(`GitSubmoduleOps.${op}: mobile not supported (RFC 22b50a17 desktop-only)`);
    }
  }
}

function isPlatformMobile(): boolean {
  try {
    return Boolean(Platform?.isMobile);
  } catch {
    return false;
  }
}

/**
 * Build a clean env object stripped of all `GIT_*` variables. Inherited
 * vars (e.g. set by an outer pre-commit hook, husky, or active rebase)
 * would otherwise redirect `git` subprocess to the wrong index/dir.
 *
 * Exported for unit testing.
 */
export function stripGitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(env)) {
    if (k.startsWith("GIT_")) delete env[k];
  }
  return env;
}

/**
 * Strip a `[submodule "<path>"]` stanza (header + all following lines until
 * the next `[` header or EOF) from `.gitmodules` content.
 *
 * Exported for unit testing.
 */
export function stripGitmodulesEntry(content: string, submodulePath: string): string {
  const lines = content.split(/\r?\n/);
  const out: string[] = [];
  let skipping = false;
  const headerPattern = new RegExp(`^\\[submodule\\s+"${escapeRegex(submodulePath)}"\\]\\s*$`);
  for (const line of lines) {
    if (skipping) {
      // Next stanza starts — stop skipping (do NOT consume the new header).
      if (/^\[.+\]\s*$/.test(line)) {
        skipping = false;
        out.push(line);
        continue;
      }
      // Otherwise skip line.
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

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parse `.gitmodules` content and return the set of submodule path entries.
 * Strictly matches `[submodule "<path>"]` headers; ignores malformed lines.
 *
 * Exported for unit testing.
 */
export function parseGitmodulesPaths(content: string): Set<string> {
  const result = new Set<string>();
  const lines = content.split(/\r?\n/);
  let currentHeader: string | null = null;
  for (const line of lines) {
    const headerMatch = line.match(/^\[submodule\s+"([^"]+)"\]\s*$/);
    if (headerMatch !== null) {
      currentHeader = headerMatch[1];
      continue;
    }
    if (currentHeader !== null) {
      const pathMatch = line.match(/^\s*path\s*=\s*(.+?)\s*$/);
      if (pathMatch !== null) {
        result.add(pathMatch[1]);
        currentHeader = null;
      }
      // Reset header on next `[...]` block.
      if (/^\[.+\]\s*$/.test(line) && !line.startsWith("[submodule")) {
        currentHeader = null;
      }
    }
  }
  return result;
}

async function copyDirRecursive(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      await fs.copyFile(srcPath, destPath);
    }
    // skip symlinks / specials — same conservative stance as TarExtractor
  }
}
