/**
 * `exocortex exosync quarantine <list|resolve>` + `exosync dedup-uids` —
 * CLI parity (#3417) for the quarantine resolver (finding a0a3d1d6).
 *
 * The plugin's resolver modal and these commands drive the SAME platform-free
 * {@link QuarantineResolver}; the only CLI-specific pieces are the node-backed
 * ports reused verbatim from `exosync-sync` (transport, watermark IO, local
 * files, sha1). Device-local-first: conflicts come from the per-device
 * watermark pins, no quarantine repo required.
 *
 *  - `quarantine list`   — the conflicts needing a human choice (path + which
 *                          sides exist), across the materialized sync units.
 *  - `quarantine resolve <path> --take local|remote|file <path>` — apply one
 *    choice convergently (disk + remote commit), zero-loss.
 *  - `dedup-uids`        — report duplicate `exo__Asset_uid`s on disk (the
 *    #3477 anomaly) and, with `--fix`, assign a fresh uuid to every duplicate
 *    but the first (frontmatter rewrite only — never a rename).
 */

import { Command } from "commander";
import { promises as fsp, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import * as path from "node:path";
import {
  FileWatermarkStore,
  QuarantineResolver,
  SYNC_BRANCH,
  SyncedQuarantineStore,
  extractAssetUid,
  withRateLimitBackoff,
  type QuarantinePort,
  type ResolveChoice,
  type SyncRepoSpec,
} from "exocortex";
import { collectVaultSpecs } from "./exosync-parity.js";
import {
  nodeLocalFilesPort,
  nodeSha1,
  nodeWatermarkFileIO,
  parseGitHubRepoUrl,
  resolveToken,
  type ExosyncSyncDeps,
  type ExosyncSyncOptions,
} from "./exosync-sync.js";
import { RestPushService } from "../services/RestPushService.js";
import { ErrorHandler } from "../utils/ErrorHandler.js";

export interface QuarantineCliOptions extends ExosyncSyncOptions {
  /** `local` | `remote` | `file` (resolve). */
  take?: string;
  /** Path to a file whose content is the merged resolution (`--take file`). */
  file?: string;
  /** Disambiguate when the same repo-relative path conflicts in >1 repo. */
  repo?: string;
}

const WATERMARK_FILE = "exosync-watermarks.local.json";

/** Build a resolver from node primitives, mirroring `runExosyncSync`. */
function buildResolver(
  vaultPath: string,
  opts: QuarantineCliOptions,
  deps: ExosyncSyncDeps,
): { resolver: QuarantineResolver; specs: SyncRepoSpec[]; warnings: string[] } {
  const token = resolveToken(opts, deps);
  const pushService = new RestPushService({
    token,
    ...(opts.apiBase !== undefined ? { apiBase: opts.apiBase } : {}),
  });
  const transport =
    deps.transportFactory?.(token, opts.apiBase) ?? pushService.transport();

  const { specs, warnings } = collectVaultSpecs(vaultPath);
  const configDir = opts.configDir ?? ".obsidian";
  const watermarkPath = path.join(
    vaultPath,
    configDir,
    "plugins",
    "exocortex",
    WATERMARK_FILE,
  );

  let quarantine: QuarantinePort | undefined;
  const quarantineUrl = opts.quarantineRepo?.trim() ?? "";
  if (quarantineUrl.length > 0) {
    const { owner, repo } = parseGitHubRepoUrl(quarantineUrl);
    quarantine = new SyncedQuarantineStore({
      transport: withRateLimitBackoff(transport),
      sha1: nodeSha1,
      owner,
      repo,
      branch: SYNC_BRANCH,
      redact: (m) => pushService.redact(m),
    });
  }

  const resolver = new QuarantineResolver({
    transport,
    watermarkStore: new FileWatermarkStore(nodeWatermarkFileIO(watermarkPath)),
    localFilesFor: (spec) =>
      nodeLocalFilesPort(path.join(vaultPath, spec.localPath)),
    sha1: nodeSha1,
    ...(opts.apiBase !== undefined ? { baseURL: opts.apiBase } : {}),
    redact: (m) => pushService.redact(m),
    ...(quarantine !== undefined ? { quarantine } : {}),
  });
  return { resolver, specs, warnings };
}

/** `exosync quarantine list`. Exit 0 always (a list is never a failure). */
export async function runQuarantineList(
  opts: QuarantineCliOptions,
  deps: ExosyncSyncDeps = {},
): Promise<number> {
  const out = deps.out ?? ((line: string): void => console.log(line));
  const vaultPath = path.resolve(opts.vault);
  if (!existsSync(vaultPath)) {
    throw new Error(`Vault path does not exist: ${vaultPath}`);
  }

  const { resolver, specs, warnings } = buildResolver(vaultPath, opts, deps);
  for (const w of warnings) out(`warn: ${w}`);
  if (specs.length === 0) {
    out("No materialized AssetSpaces with a GitHub source found in this vault.");
    return 0;
  }

  const conflicts = await resolver.listOpenConflicts(specs);
  if (opts.json === true) {
    out(JSON.stringify(conflicts, null, 2));
    return 0;
  }
  if (conflicts.length === 0) {
    out("No open conflicts — nothing to resolve. ✅");
    return 0;
  }
  out(`${conflicts.length} open conflict(s):`);
  for (const c of conflicts) {
    const sides = `${c.hasLocal ? "local" : "(no local)"} vs ${
      c.hasRemote ? "remote" : "(no remote)"
    }`;
    out(`  ${c.repoKey}  ${c.path}  [${sides}]${c.uid ? `  uid=${c.uid}` : ""}`);
  }
  out("");
  out(
    "Resolve with: exosync quarantine resolve <path> --take local|remote|file <path> --vault <vault>",
  );
  return 0;
}

/** `exosync quarantine resolve <path> --take …`. Exit 0 on success, 1 on error. */
export async function runQuarantineResolve(
  conflictPath: string,
  opts: QuarantineCliOptions,
  deps: ExosyncSyncDeps = {},
): Promise<number> {
  const out = deps.out ?? ((line: string): void => console.log(line));
  const vaultPath = path.resolve(opts.vault);
  if (!existsSync(vaultPath)) {
    throw new Error(`Vault path does not exist: ${vaultPath}`);
  }

  const take = (opts.take ?? "").trim();
  if (take !== "local" && take !== "remote" && take !== "file") {
    throw new Error(
      "resolve requires --take local | remote | file (with --file <path> for the merged content)",
    );
  }
  let choice: ResolveChoice;
  if (take === "file") {
    if (opts.file === undefined || opts.file.length === 0) {
      throw new Error("--take file requires --file <path> to the merged content");
    }
    const merged = await fsp.readFile(path.resolve(opts.file), "utf-8");
    choice = { take: "merged", content: merged };
  } else {
    choice = { take };
  }

  const { resolver, specs, warnings } = buildResolver(vaultPath, opts, deps);
  for (const w of warnings) out(`warn: ${w}`);

  // Find the spec whose open-conflict set holds this path (the path the user
  // copied from `list`). `--repo` disambiguates the rare cross-repo collision.
  const conflicts = await resolver.listOpenConflicts(specs);
  const matches = conflicts.filter(
    (c) =>
      c.path === conflictPath &&
      (opts.repo === undefined || c.repoKey === opts.repo),
  );
  if (matches.length === 0) {
    out(
      `No open conflict for "${conflictPath}"${opts.repo ? ` in ${opts.repo}` : ""} — run \`exosync quarantine list\` to see the current set.`,
    );
    return 1;
  }
  if (matches.length > 1) {
    out(
      `"${conflictPath}" conflicts in ${matches.length} repos — disambiguate with --repo <repoKey>:`,
    );
    for (const m of matches) out(`  --repo ${m.repoKey}`);
    return 1;
  }

  const target = matches[0];
  const spec = specs.find((s) => s.repoKey === target.repoKey)!;
  const result = await resolver.resolve(spec, target.path, choice);

  out(
    `Resolved ${target.path} (${result.resolvedTo}) in ${target.repoKey}${
      result.pushedSha !== undefined
        ? ` — pushed @${result.pushedSha.slice(0, 7)}`
        : " — remote already matched"
    }.`,
  );
  if (result.discardedLocalBackupPath !== undefined) {
    out(
      `  ↳ your discarded local version is preserved at ${spec.localPath}/${result.discardedLocalBackupPath}`,
    );
  }
  return 0;
}

/**
 * Rewrite the `exo__Asset_uid` scalar to a fresh value — matches the SAME
 * lenient value shape as {@link extractAssetUid} (`[^\s"']+`), so any uid the
 * sync engine recognises can be re-stamped.
 */
function rewriteUid(content: string, fresh: string): string {
  return content.replace(
    /^(exo__Asset_uid:[ \t]*["']?)[^\s"']+(["']?[ \t]*)$/m,
    `$1${fresh}$2`,
  );
}

/** `exosync dedup-uids` — report (and optionally fix) duplicate uids on disk. */
export async function runDedupUids(
  opts: QuarantineCliOptions & { fix?: boolean },
  deps: ExosyncSyncDeps = {},
): Promise<number> {
  const out = deps.out ?? ((line: string): void => console.log(line));
  const vaultPath = path.resolve(opts.vault);
  if (!existsSync(vaultPath)) {
    throw new Error(`Vault path does not exist: ${vaultPath}`);
  }

  const { specs, warnings } = collectVaultSpecs(vaultPath);
  for (const w of warnings) out(`warn: ${w}`);

  // Group absolute file paths by the uid declared in their frontmatter, scoped
  // to the materialized sync units (the same set sync diffs).
  const byUid = new Map<string, string[]>();
  for (const spec of specs) {
    const root = path.join(vaultPath, spec.localPath);
    if (!existsSync(root)) continue;
    const port = nodeLocalFilesPort(root);
    for (const rel of await port.list()) {
      if (!rel.endsWith(".md")) continue;
      let content: string;
      try {
        content = await port.read(rel);
      } catch {
        continue;
      }
      const uid = extractAssetUid(content);
      if (uid === undefined) continue;
      const abs = path.join(root, rel);
      const list = byUid.get(uid) ?? [];
      list.push(abs);
      byUid.set(uid, list);
    }
  }

  const dups = [...byUid.entries()]
    .filter(([, paths]) => paths.length > 1)
    .sort(([a], [b]) => a.localeCompare(b));

  if (dups.length === 0) {
    out("No duplicate uids on disk. ✅");
    return 0;
  }

  out(`${dups.length} duplicate uid(s) on disk:`);
  for (const [uid, paths] of dups) {
    out(`  ${uid} — ${paths.length} files:`);
    for (const p of paths) out(`    ${path.relative(vaultPath, p)}`);
  }

  if (opts.fix !== true) {
    out("");
    out(
      "Re-run with --fix to assign a fresh uuid to every duplicate but the first (frontmatter rewrite only — never renames the file).",
    );
    return 1; // a non-fix report is a "needs attention" signal (exit 1)
  }

  let fixed = 0;
  for (const [, paths] of dups) {
    // Keep the FIRST occurrence's uid; re-uuid the rest (deterministic order
    // by path so a re-run is idempotent — the first stays first).
    const ordered = [...paths].sort((a, b) => a.localeCompare(b));
    for (const file of ordered.slice(1)) {
      const content = await fsp.readFile(file, "utf-8");
      const fresh = randomUUID();
      const rewritten = rewriteUid(content, fresh);
      if (rewritten !== content) {
        await fsp.writeFile(file, rewritten, "utf-8");
        out(`  fixed ${path.relative(vaultPath, file)} → uid=${fresh}`);
        fixed++;
      }
    }
  }
  out(`Reassigned ${fixed} uid(s). Run \`exosync sync\` to propagate.`);
  return 0;
}

/** Shared options for the quarantine subcommands (a subset of sync's). */
function withQuarantineOptions(cmd: Command): Command {
  return cmd
    .requiredOption("--vault <path>", "Vault root path")
    .option(
      "--config-dir <name>",
      "Obsidian config dir name (watermark location)",
      ".obsidian",
    )
    .option(
      "--quarantine-repo <url>",
      "Quarantine repo URL (optional — device-local pins are the default source)",
    )
    .option(
      "--token <pat>",
      "GitHub PAT (or env GITHUB_TOKEN / GH_TOKEN). Prefer --token-from-gh.",
    )
    .option("--token-from-gh", "Resolve the PAT via `gh auth token`")
    .option("--json", "Machine-readable output")
    .option("--api-base <url>", "GitHub API base (testing)");
}

/** Attach `quarantine` (list/resolve) + `dedup-uids` to the `exosync` command. */
export function registerQuarantineCommands(exosync: Command): void {
  const quarantine = new Command("quarantine").description(
    "Inspect and resolve ExoSync conflicts (quarantine resolver; RFC 4e4dc453, finding a0a3d1d6)",
  );

  withQuarantineOptions(
    quarantine
      .command("list")
      .description("List open conflicts that need a manual choice"),
  ).action(async (options: QuarantineCliOptions) => {
    try {
      process.exitCode = await runQuarantineList(options);
    } catch (error) {
      ErrorHandler.handle(error, { command: "exosync quarantine list" });
      process.exitCode = 1;
    }
  });

  withQuarantineOptions(
    quarantine
      .command("resolve <path>")
      .description(
        "Resolve one conflict: --take local | remote | file <path> (merged)",
      )
      .option("--take <choice>", "local | remote | file")
      .option("--file <path>", "Merged content file (with --take file)")
      .option("--repo <repoKey>", "Disambiguate a cross-repo path collision"),
  ).action(async (conflictPath: string, options: QuarantineCliOptions) => {
    try {
      process.exitCode = await runQuarantineResolve(conflictPath, options);
    } catch (error) {
      ErrorHandler.handle(error, { command: "exosync quarantine resolve" });
      process.exitCode = 1;
    }
  });

  exosync.addCommand(quarantine);

  withQuarantineOptions(
    exosync
      .command("dedup-uids")
      .description(
        "Report duplicate exo__Asset_uid on disk (#3477); --fix re-uuids all but the first",
      )
      .option("--fix", "Assign a fresh uuid to every duplicate but the first"),
  ).action(async (options: QuarantineCliOptions & { fix?: boolean }) => {
    try {
      process.exitCode = await runDedupUids(options);
    } catch (error) {
      ErrorHandler.handle(error, { command: "exosync dedup-uids" });
      process.exitCode = 1;
    }
  });
}
