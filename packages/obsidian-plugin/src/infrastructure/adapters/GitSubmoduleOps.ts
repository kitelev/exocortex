import { Platform } from "obsidian";
import {
  nodeChildProcess,
  nodeCrypto,
  nodeFsPromises,
  nodePath,
  nodeUtil,
} from "./lazyNodeModules";

/**
 * Minimal shape of `promisify(child_process.execFile)` that this class
 * consumes. Declared explicitly (instead of `typeof promisify(execFile)`)
 * because the promisified default is now constructed LAZILY — a module-eval
 * `promisify(execFileCb)` would require `node:*` at bundle load and crash
 * Obsidian mobile (Issue #3464).
 */
export type ExecFileFn = (
  file: string,
  args: string[],
  options: {
    cwd?: string;
    timeout?: number;
    maxBuffer?: number;
    env?: NodeJS.ProcessEnv;
  },
) => Promise<{ stdout: string | Buffer; stderr: string | Buffer }>;

let defaultExecFile: ExecFileFn | null = null;

/** Lazily build (and cache) the promisified `execFile` — desktop-only path. */
function getDefaultExecFile(): ExecFileFn {
  if (defaultExecFile === null) {
    const { execFile } = nodeChildProcess();
    const { promisify } = nodeUtil();
    defaultExecFile = promisify(execFile) as unknown as ExecFileFn;
  }
  return defaultExecFile;
}

/**
 * GitSubmoduleOps — security-hardened wrapper for the git subprocess calls
 * needed by `ProfileApplyManager.applyProfile` per RFC 22b50a17
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
 * Mobile guard: every public method throws — Phase 5 apply is
 * desktop-only (RFC R24 scope).
 */
export interface GitSubmoduleOpsOptions {
  vaultRootPath: string;
  /**
   * Timeout per git operation, milliseconds. Default 60_000 for fs-local
   * ops (deinit, add, commit, status). Use {@link networkTimeoutMs} for
   * the network-bound submoduleAdd path.
   */
  timeoutMs?: number;
  /**
   * Timeout for network-bound `git submodule add` (clones the upstream
   * repository, which can be large or run over slow connections).
   * Default 300_000 (5 min) — generous margin для ~50MB submodule over
   * cellular tethering. Other ops use {@link timeoutMs}.
   */
  networkTimeoutMs?: number;
  /** Test injection: override the underlying `execFile`. */
  execFileFn?: ExecFileFn;
}

/**
 * Validate a vault-relative path segment used as an argument to git.
 *
 * Rejects:
 *   - empty string
 *   - absolute paths (`/` prefix)
 *   - parent traversal (`..` segment)
 *   - shell metacharacters (`;`, `|`, `&`, `$`, `` ` ``, `(`, `)`, `<`, `>`)
 *     plus `"`, `[`, `]` (also protect the `.gitmodules` quoted header)
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
    throw new Error(
      `GitSubmoduleOps: leading-dash arg rejected (looks like flag): ${arg}`,
    );
  }
  const normalized = arg.replace(/\\/g, "/").replace(/\/+$/, "");
  const segments = normalized.split("/");
  for (const seg of segments) {
    if (seg === "..") {
      throw new Error(`GitSubmoduleOps: parent traversal in path: ${arg}`);
    }
  }
  // Disallow shell metas — execFile doesn't interpret them, но this is
  // defense-in-depth in case the path leaks into a logged shell string. The
  // `"` / `[` / `]` set additionally protects the `.gitmodules` writer
  // (`appendGitmodulesEntry`) — these characters would otherwise let a path
  // break out of the `[submodule "<path>"]` quoted header.
  if (/[;|&$`()<>\n\r"[\]]/.test(normalized)) {
    throw new Error(`GitSubmoduleOps: shell metacharacter in path: ${arg}`);
  }
  return normalized;
}

/**
 * Validate a GitHub URL passed to `git submodule add`. Reuses the same
 * shape rules as `GitHubRestClient.validateRepoURL` без importing that class
 * (avoids circular dependency between Phase 5 adapters). Mirror the regex
 * exactly so any allowlist drift is caught by code-review.
 *
 * `file://` URLs allowed ONLY in test mode (`NODE_ENV === "test"`). In
 * production они bypass the GitHub allowlist and would permit malicious
 * `exo__AssetSpace_git: file:///some/attacker/repo` declarations to
 * materialize local content into the vault on apply. Test code that
 * legitimately needs file:// (offline integration smoke) gets it via the
 * automatic NODE_ENV that jest sets; production never sees it.
 */
export function validateGitUrl(url: string): string {
  if (typeof url !== "string" || url.length === 0) {
    throw new Error(`GitSubmoduleOps: empty git URL`);
  }
  if (url.startsWith("-")) {
    throw new Error(`GitSubmoduleOps: leading-dash URL rejected: ${url}`);
  }
  const githubOk =
    /^https:\/\/github\.com\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+?(?:\.git)?$/.test(
      url,
    );
  const isTestEnv = process.env.NODE_ENV === "test";
  const fileOk = isTestEnv && /^file:\/\/\/[a-zA-Z0-9_./-]+$/.test(url);
  if (!githubOk && !fileOk) {
    throw new Error(
      `GitSubmoduleOps: invalid git URL shape (must be https://github.com/...): ${url}`,
    );
  }
  if (/[;|&$`()<>\n\r]/.test(url)) {
    throw new Error(`GitSubmoduleOps: shell metacharacter in URL: ${url}`);
  }
  return url;
}

export class GitSubmoduleOps {
  private readonly vaultRootPath: string;
  private readonly timeoutMs: number;
  private readonly networkTimeoutMs: number;
  /**
   * `null` = use the lazily-built promisified `execFile` (resolved on first
   * {@link run} call, NOT at construction — keeps the ctor free of
   * `node:child_process` so merely constructing on mobile can't crash).
   */
  private readonly execFileFn: ExecFileFn | null;

  constructor(options: GitSubmoduleOpsOptions) {
    if (
      !options ||
      typeof options.vaultRootPath !== "string" ||
      options.vaultRootPath.length === 0
    ) {
      throw new Error("GitSubmoduleOps: vaultRootPath is required");
    }
    // NOTE: `nodePath()` performs a lazy `require("node:path")` — the ctor is
    // only reached on desktop (all construction sites are gated by
    // `Platform.isMobile`; see buildApplyDeps). Methods are additionally
    // guarded via assertDesktop.
    this.vaultRootPath = nodePath().resolve(options.vaultRootPath);
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.networkTimeoutMs = options.networkTimeoutMs ?? 300_000;
    this.execFileFn = options.execFileFn ?? null;
  }

  /**
   * Run an arbitrary `git <args>` command from the vault root.
   *
   * @param args  git CLI arguments
   * @param opts.timeoutMs  override default fs-local timeout (use for
   *   network-bound commands like `submodule add`).
   */
  async run(
    args: ReadonlyArray<string>,
    opts: { timeoutMs?: number } = {},
  ): Promise<{ stdout: string; stderr: string }> {
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
        throw new Error(
          `GitSubmoduleOps.run: disallowed flag argument: ${arg}`,
        );
      }
    }
    const effectiveTimeout = opts.timeoutMs ?? this.timeoutMs;
    const execFileFn = this.execFileFn ?? getDefaultExecFile();
    try {
      const { stdout, stderr } = await execFileFn("git", Array.from(args), {
        cwd: this.vaultRootPath,
        timeout: effectiveTimeout,
        maxBuffer: 16 * 1024 * 1024,
        // Strip inherited GIT_* env vars — if Obsidian is launched from a
        // shell with GIT_DIR/GIT_INDEX_FILE set (e.g. during a husky hook
        // or active rebase), they would hijack every git call we make
        // away from `vaultRootPath`. Same hardening reused by integration
        // tests where lint-staged sets these vars on the parent process.
        env: stripGitEnv(),
      });
      return {
        stdout:
          typeof stdout === "string"
            ? stdout
            : (stdout as Buffer).toString("utf8"),
        stderr:
          typeof stderr === "string"
            ? stderr
            : (stderr as Buffer).toString("utf8"),
      };
    } catch (err) {
      const e = err as {
        stderr?: string | Buffer;
        stdout?: string | Buffer;
        message?: string;
      };
      const stderr = e?.stderr
        ? typeof e.stderr === "string"
          ? e.stderr
          : e.stderr.toString("utf8")
        : "";
      const msg = e?.message ?? String(err);
      throw new Error(
        `git ${args.join(" ")} failed: ${msg}${stderr ? ` — stderr: ${stderr}` : ""}`,
      );
    }
  }

  /** `git submodule deinit -f assetspaces/<as>` */
  async submoduleDeinit(submodulePath: string): Promise<void> {
    const safe = validateVaultPathArg(submodulePath);
    await this.run(["submodule", "deinit", "-f", safe]);
  }

  /**
   * `git submodule add <url> assetspaces/<as>`
   *
   * Uses the longer network timeout — `submodule add` clones the entire
   * upstream history which can run minutes on slow connections.
   */
  async submoduleAdd(url: string, submodulePath: string): Promise<void> {
    const safeUrl = validateGitUrl(url);
    const safePath = validateVaultPathArg(submodulePath);
    try {
      await this.run(["submodule", "add", safeUrl, safePath], {
        timeoutMs: this.networkTimeoutMs,
      });
    } catch (err) {
      // Partial-clone cleanup: if `submodule add` failed AFTER creating
      // `.git/modules/<path>/` (e.g. timeout mid-clone), a retry would hit
      // «'<path>' already exists in the index» — best-effort cleanup
      // before re-throwing.
      await this.removeGitModulesDir(submodulePath).catch(() => undefined);
      throw err;
    }
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
      throw new Error(
        "GitSubmoduleOps.commit: newline in commit message rejected (use repeated -m args if needed)",
      );
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
    const fs = nodeFsPromises();
    const path = nodePath();
    const safe = validateVaultPathArg(submodulePath);
    // Resolve and verify the target is inside `<vault>/.git/modules/`.
    const target = path.resolve(this.vaultRootPath, ".git", "modules", safe);
    const expectedPrefix =
      path.resolve(this.vaultRootPath, ".git", "modules") + path.sep;
    if (!target.startsWith(expectedPrefix)) {
      throw new Error(
        `GitSubmoduleOps.removeGitModulesDir: escape attempt: ${target}`,
      );
    }
    await fs.rm(target, { recursive: true, force: true });
  }

  /**
   * `rm -rf <vault>/<submodulePath>` — destroys the working tree of the
   * AssetSpace. Validated against vault root.
   */
  async removeWorkingTree(submodulePath: string): Promise<void> {
    this.assertDesktop("removeWorkingTree");
    const fs = nodeFsPromises();
    const path = nodePath();
    const safe = validateVaultPathArg(submodulePath);
    const target = path.resolve(this.vaultRootPath, safe);
    const expectedPrefix = this.vaultRootPath + path.sep;
    if (!target.startsWith(expectedPrefix)) {
      throw new Error(
        `GitSubmoduleOps.removeWorkingTree: escape attempt: ${target}`,
      );
    }
    await fs.rm(target, { recursive: true, force: true });
  }

  /**
   * `mv <stagingPath> <vault>/<submodulePath>` — materialize tarball
   * contents into vault location. Both args validated.
   */
  async renameIntoVault(
    stagingPath: string,
    submodulePath: string,
  ): Promise<void> {
    this.assertDesktop("renameIntoVault");
    const fs = nodeFsPromises();
    const path = nodePath();
    if (typeof stagingPath !== "string" || stagingPath.length === 0) {
      throw new Error(`GitSubmoduleOps.renameIntoVault: stagingPath required`);
    }
    const safeStaging = path.resolve(stagingPath);
    const safeSub = validateVaultPathArg(submodulePath);
    const target = path.resolve(this.vaultRootPath, safeSub);
    const expectedPrefix = this.vaultRootPath + path.sep;
    if (!target.startsWith(expectedPrefix)) {
      throw new Error(
        `GitSubmoduleOps.renameIntoVault: escape attempt: ${target}`,
      );
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
    const fs = nodeFsPromises();
    const path = nodePath();
    const { randomBytes } = nodeCrypto();
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
    const fs = nodeFsPromises();
    const path = nodePath();
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

  /**
   * Read `.gitmodules` and parse the `(path, url)` pairs of all
   * `[submodule "<path>"]` stanzas. Missing `.gitmodules` returns `[]`.
   *
   * Used by the Phase 6.2 bootstrap «clone-from-another-machine» (EC2) flow:
   * a vault cloned without `--recurse-submodules` has a populated `.gitmodules`
   * but empty `assetspaces/*` folders — the bootstrap command reads these
   * preserved URLs to re-materialise each tracked AssetSpace.
   */
  async readGitmodulesEntries(): Promise<GitmodulesEntry[]> {
    const fs = nodeFsPromises();
    const path = nodePath();
    const gitmodulesPath = path.resolve(this.vaultRootPath, ".gitmodules");
    let raw: string;
    try {
      raw = await fs.readFile(gitmodulesPath, "utf8");
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e?.code === "ENOENT") return [];
      throw err;
    }
    return parseGitmodulesEntries(raw);
  }

  /**
   * Idempotent `.gitmodules` entry insertion via text manipulation — the
   * plugin-side counterpart of CLI `BootstrapAssetSpaceService.ensureGitmodulesEntry`.
   * Adds a standard `[submodule "<path>"]` stanza (with `path` + `url`) without
   * invoking the `git` binary, so it works in non-`submodule add` flows (cold
   * bootstrap / add-by-URL where the content was already materialised via
   * `renameIntoVault`).
   *
   * If a stanza for `submodulePath` already exists, this is a no-op
   * (`{ added: false }`). Both args are validated (path-traversal / shell
   * metacharacters / URL allowlist) before any filesystem mutation.
   */
  async appendGitmodulesEntry(
    submodulePath: string,
    url: string,
  ): Promise<{ added: boolean }> {
    this.assertDesktop("appendGitmodulesEntry");
    const fs = nodeFsPromises();
    const path = nodePath();
    const safePath = validateVaultPathArg(submodulePath);
    const safeUrl = validateGitUrl(url);
    const gitmodulesPath = path.resolve(this.vaultRootPath, ".gitmodules");

    let existing = "";
    try {
      existing = await fs.readFile(gitmodulesPath, "utf8");
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e?.code !== "ENOENT") throw err;
    }

    // Anchor on a real `[submodule "<path>"]` header (line start) so a
    // commented-out / quoted occurrence does not yield a false-positive.
    const headerRegex = new RegExp(
      `^\\s*\\[submodule\\s+"${escapeRegex(safePath)}"\\]`,
      "m",
    );
    if (existing.length > 0 && headerRegex.test(existing)) {
      return { added: false };
    }

    const sep = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
    const newEntry = `[submodule "${safePath}"]\n\tpath = ${safePath}\n\turl = ${safeUrl}\n`;
    await fs.appendFile(gitmodulesPath, sep + newEntry, { encoding: "utf8" });
    return { added: true };
  }

  private assertDesktop(op: string): void {
    if (isPlatformMobile()) {
      throw new Error(
        `GitSubmoduleOps.${op}: mobile not supported (RFC 22b50a17 desktop-only)`,
      );
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
 * Build a clean env object stripped of `GIT_*` session-state variables that
 * could redirect `git` subprocess to the wrong index/dir. Strips the
 * dangerous-on-inherit subset (GIT_DIR / GIT_INDEX_FILE / GIT_WORK_TREE etc.)
 * — set by an outer husky hook, active rebase, or stash operation.
 *
 * Preserves `GIT_CONFIG_*` family (used to override config via env, e.g.
 * tests setting `protocol.file.allow=always`) and other harmless vars.
 *
 * Exported for unit testing.
 */
export function stripGitEnv(): NodeJS.ProcessEnv {
  const STRIP = new Set<string>([
    "GIT_DIR",
    "GIT_INDEX_FILE",
    "GIT_WORK_TREE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_NAMESPACE",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_REFLOG_ACTION",
    "GIT_AUTHOR_DATE",
    "GIT_COMMITTER_DATE",
    "GIT_PREFIX",
    "GIT_TEMPLATE_DIR",
  ]);
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(env)) {
    if (STRIP.has(k)) delete env[k];
  }
  return env;
}

/**
 * Strip a `[submodule "<path>"]` stanza (header + all following lines until
 * the next `[` header or EOF) from `.gitmodules` content.
 *
 * Exported for unit testing.
 */
export function stripGitmodulesEntry(
  content: string,
  submodulePath: string,
): string {
  const lines = content.split(/\r?\n/);
  const out: string[] = [];
  let skipping = false;
  const headerPattern = new RegExp(
    `^\\[submodule\\s+"${escapeRegex(submodulePath)}"\\]\\s*$`,
  );
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

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A parsed `.gitmodules` stanza — the `path` + `url` of one submodule entry.
 */
export interface GitmodulesEntry {
  submodulePath: string;
  url: string;
}

/**
 * Parse `.gitmodules` content into `(path, url)` pairs. Each
 * `[submodule "<name>"]` header opens a stanza; the stanza's `path` and `url`
 * key=value lines are collected until the next `[...]` header or EOF. A stanza
 * missing either key is skipped (incomplete — cannot be materialised).
 *
 * Exported for unit testing.
 */
export function parseGitmodulesEntries(content: string): GitmodulesEntry[] {
  const out: GitmodulesEntry[] = [];
  const lines = content.split(/\r?\n/);
  let inSubmodule = false;
  let curPath: string | null = null;
  let curUrl: string | null = null;
  const flush = (): void => {
    if (curPath !== null && curUrl !== null) {
      out.push({ submodulePath: curPath, url: curUrl });
    }
    curPath = null;
    curUrl = null;
  };
  for (const line of lines) {
    if (/^\[.+\]\s*$/.test(line)) {
      // New header of any kind — flush the previous stanza first.
      flush();
      inSubmodule = /^\[submodule\s+"[^"]+"\]\s*$/.test(line);
      continue;
    }
    if (!inSubmodule) continue;
    const pathMatch = line.match(/^\s*path\s*=\s*(.+?)\s*$/);
    if (pathMatch !== null) {
      curPath = pathMatch[1];
      continue;
    }
    const urlMatch = line.match(/^\s*url\s*=\s*(.+?)\s*$/);
    if (urlMatch !== null) {
      curUrl = urlMatch[1];
    }
  }
  flush();
  return out;
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
  const fs = nodeFsPromises();
  const path = nodePath();
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
