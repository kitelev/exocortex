/**
 * `exocortex exosync <sync|pull|push>` — ExoSync from the CLI (RFC 4e4dc453
 * Phase B parity, EKA M3.7 PA-exosync).
 *
 * Desktop counterpart to the plugin's «Exocortex: Sync / Pull / Push»
 * commands: it drives the SAME platform-free {@link SyncEngine} the plugin
 * composes in `SyncDepsFactory.buildSyncEngine`, but wires it from `node:fs`
 * instead of Obsidian's `vault.adapter`. ZERO engine edits — the only
 * platform-specific pieces are the injected ports below
 * (`nodeLocalFilesPort`, `nodeWatermarkFileIO`, `nodeMaterializationCheck`,
 * `nodeSha1`). The merge layer (`GatedStructuredMerger` + `StructuredMerger`),
 * quarantine sink (`LocalConflictCacheStore`), watermark store
 * (`FileWatermarkStore`) and sync-unit collection (`collectVaultSpecs`, shared
 * with `exosync-parity`) are reused verbatim from the core package.
 *
 * Directions (#3473): `sync` = full pull→merge→push cycle; `pull` applies
 * remote changes only (nothing leaves the device); `push` sends the local
 * delta only (remote changes are pinned to re-derive). Split runs never
 * resolve conflicts — they defer to a full `sync`.
 *
 * Unlike `exosync-parity` (read-only by construction) this command WRITES:
 *  - pulled remote changes land on disk through a writable `LocalFilesPort`
 *    (atomic temp+rename, parent-dir creation, no-op delete);
 *  - the per-device watermark (`exosync-watermarks.local.json`) is updated
 *    through a writable IO at the SAME path the plugin uses, so a subsequent
 *    plugin sync sees a consistent base.
 *
 * ⚠ Cross-process watermark caveat: the engine's D11 guard is per-process.
 * Do NOT run this while the plugin is mid-sync on the same vault — the
 * watermark write is last-writer-wins across processes (same limitation the
 * `exosync-parity` read-only IO documents).
 */

import { Command } from "commander";
import { promises as fsp, existsSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import yaml from "js-yaml";
import {
  CONFLICT_CACHE_STORE_FILENAME,
  FileLocalManifestStore,
  FileMountBaseStore,
  FileWatermarkStore,
  GatedStructuredMerger,
  LOCAL_MANIFEST_STORE_FILENAME,
  LocalConflictCacheStore,
  LocalOutboxStore,
  MOUNT_BASE_STORE_FILENAME,
  OUTBOX_STORE_FILENAME,
  StructuredMerger,
  SyncEngine,
  WATERMARK_STORE_FILENAME,
  aggregateTimings,
  formatRepoTimings,
  formatTimingsLine,
  orderChildrenFirst,
  syncProgressPhaseText,
  totalMs,
  type LocalFilesPort,
  type MaterializationCheckPort,
  type QuarantinePort,
  type RepoSyncResult,
  type RestCommitTransport,
  type Sha1Fn,
  type SyncDirection,
  type SyncProgressEvent,
  type SyncRepoSpec,
  type WatermarkFileIO,
  type YamlCodec,
} from "@kitelev/exocortex-core";
import { collectVaultSpecs } from "./exosync-parity.js";
import { registerQuarantineCommands } from "./exosync-quarantine.js";
import { RestPushService } from "../services/RestPushService.js";
import { ErrorHandler } from "../utils/ErrorHandler.js";

export interface ExosyncSyncOptions {
  vault: string;
  /** Obsidian config dir NAME (watermark + plugin-data location). */
  configDir?: string;
  json?: boolean;
  token?: string;
  tokenFromGh?: boolean;
  apiBase?: string;
}

/** Injectable dependencies (tests). */
export interface ExosyncSyncDeps {
  transportFactory?: (token: string, apiBase?: string) => RestCommitTransport;
  ghTokenRunner?: () => string;
  env?: NodeJS.ProcessEnv;
  out?: (line: string) => void;
}

/**
 * Git blob content addressing (NOT a security context): the remote IS git,
 * which addresses blobs by SHA-1. WebCrypto via `node:crypto`, mirroring the
 * plugin's `webCryptoSha1` and `exosync-parity`'s `nodeSha1` (the CLI and
 * plugin deliberately keep separate per-runtime impls of the same Sha1Fn).
 */
export const nodeSha1: Sha1Fn = async (bytes) => {
  const digest = await webcrypto.subtle.digest(
    "SHA-1",
    bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer,
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

/** js-yaml CORE_SCHEMA codec — date-like scalars MUST round-trip as strings
 * (the YamlCodec contract the StructuredMerger relies on). Same codec the
 * plugin's `coreSchemaYamlCodec` and `exosync-parity` use. */
const coreSchemaYaml: YamlCodec = {
  parse: (text) => yaml.load(text, { schema: yaml.CORE_SCHEMA }),
  stringify: (value) =>
    yaml.dump(value, { schema: yaml.CORE_SCHEMA, lineWidth: -1 }),
};

/** Token precedence mirrors `exosync-parity` / `experimental rest-push`.
 * Sync touches PRIVATE repos (404-hidden without a PAT) and pushes commits,
 * so a token is always required. */
export function resolveToken(
  opts: ExosyncSyncOptions,
  deps: ExosyncSyncDeps,
): string {
  if (opts.tokenFromGh === true) {
    return RestPushService.resolveGhToken(deps.ghTokenRunner);
  }
  const env = deps.env ?? process.env;
  const token = opts.token || env.GITHUB_TOKEN || env.GH_TOKEN || "";
  if (token.length === 0) {
    throw new Error(
      "A GitHub token is required (private sync units read as 404 and push needs write scope). Use --token-from-gh, --token <pat>, or set GITHUB_TOKEN / GH_TOKEN.",
    );
  }
  return token;
}

/** Parse `https://github.com/<owner>/<repo>` → {owner, repo}; throws on a
 * non-GitHub / malformed URL (same allowlist as the REST mount/quarantine
 * path). */
export function parseGitHubRepoUrl(url: string): { owner: string; repo: string } {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(
    url.trim(),
  );
  if (m === null) {
    throw new Error(
      `Invalid quarantine repo URL (expected https://github.com/<owner>/<repo>): ${url}`,
    );
  }
  return { owner: m[1], repo: m[2] };
}

/** Parent directory of a forward-slash path; `""` if top-level. */
function parentDir(p: string): string {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "" : p.slice(0, i);
}

/**
 * WRITABLE `LocalFilesPort` over `node:fs`, scoped to one repo mount folder.
 * Repo-relative forward-slash paths (the engine's contract). Writes are
 * atomic (temp + rename) and create parent folders; deletes are no-ops when
 * the path is already absent — mirroring the plugin's `vaultLocalFilesPort`.
 */
export function nodeLocalFilesPort(root: string): LocalFilesPort {
  const abs = (rel: string): string => path.join(root, rel);
  const walk = async (dir: string, out: string[]): Promise<void> => {
    let entries: Awaited<ReturnType<typeof fsp.readdir>>;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === ".git") continue; // submodule plumbing, never content
        await walk(full, out);
      } else if (entry.isFile()) {
        out.push(path.relative(root, full).split(path.sep).join("/"));
      }
    }
  };
  /** Atomic write: temp (`.local.tmp` — refused by isSyncablePath) → rename. */
  const writeAtomic = async (
    target: string,
    write: (tmp: string) => Promise<void>,
  ): Promise<void> => {
    const parent = path.dirname(target);
    await fsp.mkdir(parent, { recursive: true });
    const tmp = `${target}.local.tmp`;
    await write(tmp);
    await fsp.rename(tmp, target);
  };
  return {
    async list(): Promise<string[]> {
      const out: string[] = [];
      if (existsSync(root)) await walk(root, out);
      return out;
    },
    read: (rel) => fsp.readFile(abs(rel), "utf-8"),
    async write(rel, content): Promise<void> {
      await writeAtomic(abs(rel), (tmp) => fsp.writeFile(tmp, content, "utf-8"));
    },
    async delete(rel): Promise<void> {
      await fsp.rm(abs(rel), { force: true });
    },
    async readBinary(rel): Promise<Uint8Array> {
      return new Uint8Array(await fsp.readFile(abs(rel)));
    },
    async writeBinary(rel, bytes): Promise<void> {
      const buf = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      await writeAtomic(abs(rel), (tmp) => fsp.writeFile(tmp, Buffer.from(buf)));
    },
    // mtime-manifest (perf): cheap metadata, no content read. `null` on ENOENT.
    async stat(rel): Promise<{ mtimeMs: number; size: number } | null> {
      try {
        const s = await fsp.stat(abs(rel));
        return { mtimeMs: s.mtimeMs, size: s.size };
      } catch {
        return null;
      }
    },
  };
}

/** WRITABLE single-file watermark IO over `node:fs` (atomic temp + rename),
 * at the SAME `<configDir>/plugins/exocortex/exosync-watermarks.local.json`
 * the plugin writes — so plugin and CLI share one consistent base. */
export function nodeWatermarkFileIO(filePath: string): WatermarkFileIO {
  return {
    async read(): Promise<string | null> {
      try {
        return await fsp.readFile(filePath, "utf-8");
      } catch {
        return null;
      }
    },
    async writeAtomic(content: string): Promise<void> {
      await fsp.mkdir(path.dirname(filePath), { recursive: true });
      const tmp = `${filePath}.local.tmp`;
      await fsp.writeFile(tmp, content, "utf-8");
      await fsp.rename(tmp, filePath);
    },
  };
}

/**
 * #3590 — node-backed mount-base store over the vault's device-local
 * `exosync-mountbase.local.json`. SINGLE source of the path convention so the
 * WRITE side (apply / mount commands) and the READ side (`exosync sync`) always
 * agree on the file — a mismatch would silently lose the recorded merge base
 * (safe, but the fix would not fire). `configDir` defaults to `.obsidian`,
 * matching the sync command's default.
 */
export function nodeMountBaseStore(
  vaultPath: string,
  configDir = ".obsidian",
): FileMountBaseStore {
  const filePath = path.join(
    vaultPath,
    configDir,
    "plugins",
    "exocortex",
    MOUNT_BASE_STORE_FILENAME,
  );
  return new FileMountBaseStore(nodeWatermarkFileIO(filePath));
}

const execFile = promisify(execFileCb);

/**
 * #3590 FULL fix — node-backed base BACKFILL source for AssetSpaces mounted
 * BEFORE the mount layer recorded their base (no `exosync-mountbase.local.json`
 * entry). Returns the commit SHA the submodule's working tree is checked out at
 * (`git submodule status <path>` → leading 40-hex SHA) — the genuine 3-way merge
 * base (local edits sit uncommitted on top; a true remote-head ancestor, which
 * the engine re-verifies before trusting — M1-safe). Returns `null` — never
 * throws — when the path is not an initialized submodule, git is unavailable, or
 * the output is unparseable; the engine then keeps its conservative
 * full-conflict fallback. Read-only `execFile` (no shell — injection-safe).
 */
export function nodeLocalBaseShaProvider(
  vaultPath: string,
): (spec: SyncRepoSpec) => Promise<string | null> {
  return async (spec) => {
    // A leading-dash localPath could be misread by git as an option — refuse it.
    if (spec.localPath.length === 0 || spec.localPath.startsWith("-")) {
      return null;
    }
    try {
      const { stdout } = await execFile(
        "git",
        ["-C", vaultPath, "submodule", "status", spec.localPath],
        { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
      );
      const m = stdout.match(/^[ +\-U]?([0-9a-f]{40})\b/m);
      return m ? m[1] : null;
    } catch {
      return null;
    }
  };
}

/**
 * CLI full-materialization gate (D19). The CLI has no plugin profile-apply /
 * staging state to consult, so the floor check is: mount folder exists +
 * (for non-file spaces) non-empty. An empty FileSpace folder is a legitimate
 * first-sync state (remote-wins pulls everything; no delete is inferred from
 * an empty synthetic base), so it is NOT vetoed.
 */
export function nodeMaterializationCheck(
  vaultPath: string,
): MaterializationCheckPort {
  return {
    async check(spec: SyncRepoSpec) {
      const dir = path.join(vaultPath, spec.localPath);
      if (!existsSync(dir)) {
        return {
          fullyMaterialized: false,
          reason: `mount folder ${spec.localPath} does not exist`,
        };
      }
      let entries = 0;
      try {
        entries = (await fsp.readdir(dir)).length;
      } catch {
        return {
          fullyMaterialized: false,
          reason: `mount folder ${spec.localPath} is not readable`,
        };
      }
      if (entries === 0 && spec.spaceKind !== "file") {
        return {
          fullyMaterialized: false,
          reason: `mount folder ${spec.localPath} is empty (mid-mount?)`,
        };
      }
      return { fullyMaterialized: true };
    },
  };
}

function printRepoResult(
  r: RepoSyncResult,
  out: (line: string) => void,
): void {
  const head = r.pushedSha !== undefined ? ` →@${r.pushedSha.slice(0, 7)}` : "";
  const resolvedSuffix =
    (r.outboxPushedCount ?? 0) > 0
      ? `, pushed ${r.outboxPushedCount} resolved`
      : "";
  const reconflictSuffix =
    (r.outboxReconflictedCount ?? 0) > 0
      ? `, ${r.outboxReconflictedCount} re-conflicted (remote moved)`
      : "";
  out(
    `${r.repoKey}${head}: ${r.status} — pulled ${r.pulledCount}, pushed ${r.pushedCount}, merged ${r.mergedCount}, quarantined ${r.quarantinedCount}${(r.pushedDeletes?.length ?? 0) > 0 ? `, deleted ${r.pushedDeletes!.length}` : ""}${resolvedSuffix}${reconflictSuffix}`,
  );
  if (r.detail !== undefined) out(`  ${r.detail}`);
  for (const w of r.warnings) out(`  warn: ${w}`);
  // Surface the actual quarantined PATHS, not just the count — without this the
  // user only sees "quarantined N" and has no idea WHICH files need resolving
  // (finding a0a3d1d6). The resolver picks them up via `exosync quarantine list`.
  if ((r.quarantinedPaths?.length ?? 0) > 0) {
    out(
      `  quarantined (→ exosync quarantine resolve): ${r.quarantinedPaths!.join(", ")}`,
    );
  }
  if ((r.deferredPaths?.length ?? 0) > 0) {
    out(`  deferred (→ full sync): ${r.deferredPaths!.join(", ")}`);
  }
  if ((r.deferredDeletes?.length ?? 0) > 0) {
    out(`  deferred deletes: ${r.deferredDeletes.join(", ")}`);
  }
  // ExoSync Phase 0 (measure-first) — per-AS phase breakdown for desktop runs.
  if (r.timings !== undefined && totalMs(r.timings) > 0) {
    out(`  ${formatRepoTimings(r.repoKey, r.timings)}`);
  }
}

/** A repo result is a FAILURE (non-zero exit) when it left unresolved
 * divergence or could not run. `synced` and `skipped-not-materialized` are
 * clean. */
function isFailureStatus(status: RepoSyncResult["status"]): boolean {
  return (
    status === "conflict" ||
    status === "full-conflict" ||
    status === "retry-exhausted" ||
    status === "busy" ||
    status === "auth-required" ||
    status === "error"
  );
}

/** Core flow, exported for tests. Returns the intended exit code:
 * 0 = all repos clean; 1 = at least one repo unresolved/errored;
 * 2 = VACUOUS (no materialized sync units found — a green 0 here would be a
 * false certificate). */
export async function runExosyncSync(
  direction: SyncDirection,
  opts: ExosyncSyncOptions,
  deps: ExosyncSyncDeps = {},
): Promise<number> {
  const out = deps.out ?? ((line: string): void => console.log(line));
  const vaultPath = path.resolve(opts.vault);
  if (!existsSync(vaultPath)) {
    throw new Error(`Vault path does not exist: ${vaultPath}`);
  }

  const token = resolveToken(opts, deps);
  const pushService = new RestPushService({
    token,
    ...(opts.apiBase !== undefined ? { apiBase: opts.apiBase } : {}),
  });
  const transport =
    deps.transportFactory?.(token, opts.apiBase) ?? pushService.transport();

  const { specs, warnings } = collectVaultSpecs(vaultPath);
  for (const w of warnings) out(`warn: ${w}`);
  if (specs.length === 0) {
    out(
      "Nothing to sync — no materialized AssetSpaces with a GitHub source found in this vault.",
    );
    return 2;
  }

  const configDir = opts.configDir ?? ".obsidian";
  const watermarkPath = path.join(
    vaultPath,
    configDir,
    "plugins",
    "exocortex",
    WATERMARK_STORE_FILENAME,
  );
  // mtime-manifest (perf) — sits next to the watermark in the same device-local
  // (`.local.`, Sync-excluded) store dir. Same single-file IO contract as the
  // watermark, so `nodeWatermarkFileIO` is reused verbatim.
  const manifestPath = path.join(
    vaultPath,
    configDir,
    "plugins",
    "exocortex",
    LOCAL_MANIFEST_STORE_FILENAME,
  );
  // Device-local conflict cache (offline-resolution foundation) — ALWAYS wired,
  // same `.local.` (Sync-excluded) store family as the watermark; reuses
  // `nodeWatermarkFileIO` verbatim. Captures the 3 versions of every conflict on
  // disk so the resolver works offline (PR-3) and conflicts are never dropped.
  const conflictCachePath = path.join(
    vaultPath,
    configDir,
    "plugins",
    "exocortex",
    CONFLICT_CACHE_STORE_FILENAME,
  );
  const conflictCache = new LocalConflictCacheStore({
    io: nodeWatermarkFileIO(conflictCachePath),
  });
  // Deferred-push outbox (PR-3b) — the engine flushes queued offline resolutions
  // on each non-pull sync (TOCTOU-guarded). Same `.local.` store family.
  const outboxPath = path.join(
    vaultPath,
    configDir,
    "plugins",
    "exocortex",
    OUTBOX_STORE_FILENAME,
  );
  const outbox = new LocalOutboxStore({ io: nodeWatermarkFileIO(outboxPath) });

  // The device-local conflict cache is the SOLE quarantine sink (the synced
  // git-repo quarantine store was retired — offline-resolution program).
  const quarantine: QuarantinePort = conflictCache;

  const engine = new SyncEngine({
    transport,
    watermarkStore: new FileWatermarkStore(nodeWatermarkFileIO(watermarkPath)),
    // mtime-manifest local-hash skip (perf) — same IO/store family as the
    // watermark; skips reading+re-hashing unchanged asset files each sync.
    localManifestStore: new FileLocalManifestStore(
      nodeWatermarkFileIO(manifestPath),
    ),
    mountBaseStore: nodeMountBaseStore(vaultPath, configDir),
    localBaseShaProvider: nodeLocalBaseShaProvider(vaultPath),
    materializationCheck: nodeMaterializationCheck(vaultPath),
    localFilesFor: (spec) =>
      nodeLocalFilesPort(path.join(vaultPath, spec.localPath)),
    sha1: nodeSha1,
    redact: (m) => pushService.redact(m),
    commitMessage: (_spec, fileCount, deleteCount = 0) =>
      `exosync: ${fileCount} change(s)${deleteCount > 0 ? `, ${deleteCount} deletion(s)` : ""} (CLI)`,
    // GatedStructuredMerger without a SHACL gate still quarantines
    // unresolvable merges (D17) — parity with the plugin's Phase B wiring.
    mergeLayer: new GatedStructuredMerger(new StructuredMerger(coreSchemaYaml)),
    quarantine,
    outbox,
    ...(opts.apiBase !== undefined ? { baseURL: opts.apiBase } : {}),
  });

  out(
    `ExoSync ${direction}: ${specs.length} repo(s), vault ${vaultPath}`,
  );
  // Children before parents (deeper mount paths first) — D12 ordering.
  const ordered = orderChildrenFirst(specs);
  // Live in-flight trace so a long pull (the dominant restBlob phase) never
  // looks hung on the CLI, mirroring the plugin's step feed. `out` streams to
  // stdout as each phase fires. Suppressed under --json so the progress lines
  // never corrupt the machine-readable result blob.
  const onProgress =
    opts.json === true
      ? undefined
      : (event: SyncProgressEvent): void => {
          out(`[ExoSync] ${event.repoKey}: ${syncProgressPhaseText(event)}`);
        };
  const results = await engine.syncAll(ordered, direction, onProgress);

  if (opts.json === true) {
    out(JSON.stringify(results, null, 2));
  } else {
    for (const r of results) printRepoResult(r, out);
    const totals = results.reduce(
      (acc, r) => ({
        pulled: acc.pulled + r.pulledCount,
        pushed: acc.pushed + r.pushedCount,
        merged: acc.merged + r.mergedCount,
        quarantined: acc.quarantined + r.quarantinedCount,
      }),
      { pulled: 0, pushed: 0, merged: 0, quarantined: 0 },
    );
    out(
      `Summary: ${results.length} repo(s) — pulled ${totals.pulled}, pushed ${totals.pushed}, merged ${totals.merged}, quarantined ${totals.quarantined}`,
    );
    // ExoSync Phase 0 (measure-first) — run-total per-phase breakdown so the
    // dominant phase is visible (which optimisation Phase 1 picks).
    const aggTimings = aggregateTimings(results);
    if (totalMs(aggTimings) > 0) out(formatTimingsLine(aggTimings));
  }

  return results.some((r) => isFailureStatus(r.status)) ? 1 : 0;
}

/** Shared option wiring for the three direction subcommands. */
function withSyncOptions(cmd: Command): Command {
  return cmd
    .requiredOption("--vault <path>", "Vault root path")
    .option(
      "--config-dir <name>",
      "Obsidian config dir name (watermark location)",
      ".obsidian",
    )
    .option(
      "--token <pat>",
      "GitHub PAT (or env GITHUB_TOKEN / GH_TOKEN). Prefer --token-from-gh.",
    )
    .option("--token-from-gh", "Resolve the PAT via `gh auth token`")
    .option("--json", "Print the full per-repo result array as JSON")
    .option("--api-base <url>", "GitHub API base (testing)");
}

function makeDirectionAction(direction: SyncDirection) {
  return async (options: ExosyncSyncOptions): Promise<void> => {
    try {
      process.exitCode = await runExosyncSync(direction, options);
    } catch (error) {
      ErrorHandler.handle(error, { command: `exosync ${direction}` });
      process.exitCode = 1;
    }
  };
}

export function exosyncCommand(): Command {
  const cmd = new Command("exosync").description(
    "ExoSync over the GitHub REST API: sync/pull/push the materialized AssetSpace set (CLI parity with the plugin; RFC 4e4dc453 Phase B). Read-only divergence check: `exosync-parity`.",
  );

  withSyncOptions(
    cmd
      .command("sync")
      .description("Full pull→merge→push cycle for every materialized repo"),
  ).action(makeDirectionAction("sync"));

  withSyncOptions(
    cmd
      .command("pull")
      .description(
        "Apply remote changes only (nothing leaves the device; local changes re-derive)",
      ),
  ).action(makeDirectionAction("pull"));

  withSyncOptions(
    cmd
      .command("push")
      .description(
        "Send the local delta only (remote changes are pinned to re-derive on the next pull/sync)",
      ),
  ).action(makeDirectionAction("push"));

  // Quarantine resolver + dedup-uids (finding a0a3d1d6) — kept in a sibling
  // module so this file stays focused on the sync directions.
  registerQuarantineCommands(cmd);

  return cmd;
}
