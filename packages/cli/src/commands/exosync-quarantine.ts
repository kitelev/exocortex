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
 *    #3477 anomaly). `--fix` assigns a fresh uuid to every duplicate but the
 *    first (frontmatter rewrite only — never a rename). `--auto` is the
 *    zero-loss auto-resolver: byte/whitespace-IDENTICAL copies are deleted
 *    (their content survives verbatim in the kept file), while DISTINCT
 *    variants that merely share a uid are re-uuid'd (both survive). It is
 *    DRY-RUN by default — `--apply` is the explicit opt-in to actually
 *    delete/re-uuid. The classifier is conservative: a file is deleted ONLY
 *    when its normalized content equals a kept copy's, so differing content can
 *    never be destroyed (mis-classification at worst re-uuids harmlessly).
 */

import { Command } from "commander";
import { promises as fsp, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import * as path from "node:path";
import {
  CONFLICT_CACHE_STORE_FILENAME,
  FileWatermarkStore,
  LocalConflictCacheStore,
  LocalOutboxStore,
  OUTBOX_STORE_FILENAME,
  QuarantineResolver,
  extractAssetUid,
  type ResolveChoice,
  type SyncRepoSpec,
} from "exocortex";
import { collectVaultSpecs } from "./exosync-parity.js";
import {
  nodeLocalFilesPort,
  nodeSha1,
  nodeWatermarkFileIO,
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
  // Device-local conflict cache (PR-2) — the resolver's OFFLINE source for a
  // conflict's remote+base versions (same `.local.` store the engine writes).
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
  // Deferred-push outbox (PR-3b) — resolve() queues offline resolutions here;
  // the engine flushes them on the next `exosync sync`.
  const outboxPath = path.join(
    vaultPath,
    configDir,
    "plugins",
    "exocortex",
    OUTBOX_STORE_FILENAME,
  );
  const outbox = new LocalOutboxStore({ io: nodeWatermarkFileIO(outboxPath) });

  const resolver = new QuarantineResolver({
    transport,
    watermarkStore: new FileWatermarkStore(nodeWatermarkFileIO(watermarkPath)),
    localFilesFor: (spec) =>
      nodeLocalFilesPort(path.join(vaultPath, spec.localPath)),
    sha1: nodeSha1,
    ...(opts.apiBase !== undefined ? { baseURL: opts.apiBase } : {}),
    redact: (m) => pushService.redact(m),
    conflictCache,
    outbox,
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

  const outcome =
    result.awaitingPush === true
      ? " — awaiting push (run `exosync sync` to push it)"
      : result.pushedSha !== undefined
        ? ` — pushed @${result.pushedSha.slice(0, 7)}`
        : " — remote already matched";
  out(`Resolved ${target.path} (${result.resolvedTo}) in ${target.repoKey}${outcome}.`);
  if (result.discardedLocalBackupPath !== undefined) {
    out(
      `  ↳ your discarded local version is preserved at ${spec.localPath}/${result.discardedLocalBackupPath}`,
    );
  }
  return 0;
}

/**
 * Rewrite the `exo__Asset_uid` scalar to a fresh value, scoped to the `---`
 * frontmatter block exactly like {@link extractAssetUid} reads it (same block
 * isolation + same lenient value shape `[^\s"']+`). Scoping the WRITE to the
 * same region as the READ avoids re-stamping a `exo__Asset_uid:` token that
 * happens to appear in the body (code-reviewer MEDIUM-1). Returns the content
 * unchanged when there is no frontmatter uid line.
 */
function rewriteUid(content: string, fresh: string): string {
  const fm = /^(---\r?\n)([\s\S]*?)(\r?\n---(?=\r?\n|$))/.exec(content);
  if (fm === null) return content;
  const rewrittenBlock = fm[2].replace(
    /^(exo__Asset_uid:[ \t]*["']?)[^\s"']+(["']?[ \t]*)$/m,
    `$1${fresh}$2`,
  );
  if (rewrittenBlock === fm[2]) return content;
  return (
    content.slice(0, fm.index) +
    fm[1] +
    rewrittenBlock +
    fm[3] +
    content.slice(fm.index + fm[0].length)
  );
}

/**
 * Content-preserving whitespace normalization for the IDENTICAL-copy test.
 * Two files equal after this carry the SAME semantic content (only cosmetic
 * whitespace differs: line endings, trailing whitespace, trailing blank lines)
 * — so deleting one is provably zero-loss. Deliberately does NOT touch
 * frontmatter field VALUES (e.g. a differing `exo__Asset_updatedAt`) or the
 * body text, and reorders nothing: ANY real content difference must surface as
 * DIFFERING (→ re-uuid, never delete). Conservative by construction — the only
 * bytes it collapses are whitespace that no markdown/RDF reader treats as data.
 */
export function normalizeForCompare(content: string): string {
  return content
    .replace(/\r\n?/g, "\n") // CRLF / lone CR → LF
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, "")) // strip trailing whitespace per line
    .join("\n")
    .replace(/\n+$/, ""); // ignore trailing blank lines / final-newline differences
}

/** One planned action for a file in a duplicate-uid group. */
export type DedupDecision =
  | { action: "keep"; path: string; uid: string }
  | { action: "reuuid"; path: string; fromUid: string; toUid: string }
  | { action: "delete"; path: string; identicalTo: string };

/**
 * Zero-loss auto-resolution plan for ONE duplicate-uid group. Files sharing a
 * uid are partitioned into content-equivalence classes (by
 * {@link normalizeForCompare}), processed in lexicographic path order:
 *  - the class of the lexicographically-first path KEEPS the uid (its first
 *    member is kept); every other member is a whitespace-identical copy →
 *    DELETE (zero-loss: its content survives verbatim in the kept file);
 *  - every OTHER class is a DISTINCT variant that merely shares the duplicate
 *    uid → its first member is RE-UUID'd (zero-loss: it survives with a fresh
 *    uid); the rest of that class are identical to it → DELETE.
 *
 * ⛔ INVARIANT (the zero-loss safety property a reviewer must trust): a
 * `delete` is emitted ONLY for a file whose normalized content equals an
 * ALREADY-KEPT representative's. A file whose content matches no kept
 * representative is KEPT (anchor) or RE-UUID'd — NEVER deleted. Differing
 * content is therefore impossible to destroy. Mis-classifying identical as
 * differing is harmless (extra re-uuid); the classifier errs that way at every
 * doubt because equality is required, not assumed.
 *
 * @param freshUid injected uuid generator (deterministic in tests).
 */
export function planDedupGroup(
  uid: string,
  files: ReadonlyArray<{ path: string; content: string }>,
  freshUid: () => string,
): DedupDecision[] {
  const ordered = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const kept: Array<{ path: string; norm: string }> = [];
  const decisions: DedupDecision[] = [];
  for (const f of ordered) {
    const norm = normalizeForCompare(f.content);
    const rep = kept.find((k) => k.norm === norm);
    if (rep !== undefined) {
      // Content-identical to an already-kept file → safe to delete (zero-loss).
      decisions.push({ action: "delete", path: f.path, identicalTo: rep.path });
      continue;
    }
    kept.push({ path: f.path, norm });
    if (kept.length === 1) {
      // Anchor of the group — keeps the original (duplicate) uid.
      decisions.push({ action: "keep", path: f.path, uid });
    } else {
      // A distinct variant sharing the duplicate uid → re-uuid (never delete).
      decisions.push({
        action: "reuuid",
        path: f.path,
        fromUid: uid,
        toUid: freshUid(),
      });
    }
  }
  return decisions;
}

/** `exosync dedup-uids` — report (and optionally fix / auto-resolve) duplicate uids on disk. */
export async function runDedupUids(
  opts: QuarantineCliOptions & { fix?: boolean; auto?: boolean; apply?: boolean },
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

  const rel = (p: string): string => path.relative(vaultPath, p);

  // `--auto` (zero-loss auto-resolve): identical copies → delete the extras,
  // distinct variants → re-uuid. Destructive, so DRY-RUN by default — `--apply`
  // is the explicit opt-in to actually delete/re-uuid (never destructive
  // without it). Supersedes `--fix`.
  if (opts.auto === true) {
    // Plan every group from a single content snapshot (read each dup file once).
    const plans: Array<{
      uid: string;
      decisions: DedupDecision[];
      snap: Map<string, string>;
    }> = [];
    for (const [uid, paths] of dups) {
      const files: Array<{ path: string; content: string }> = [];
      const snap = new Map<string, string>();
      for (const p of paths) {
        const c = await fsp.readFile(p, "utf-8");
        files.push({ path: p, content: c });
        snap.set(p, c);
      }
      plans.push({ uid, decisions: planDedupGroup(uid, files, randomUUID), snap });
    }

    let plannedDeletes = 0;
    let plannedReuuids = 0;
    out(`${dups.length} duplicate uid(s) on disk — zero-loss plan:`);
    for (const { uid, decisions } of plans) {
      out(`  ${uid}:`);
      for (const d of decisions) {
        if (d.action === "keep") {
          out(`    KEEP    ${rel(d.path)}  (keeps uid ${uid})`);
        } else if (d.action === "reuuid") {
          plannedReuuids++;
          out(
            `    RE-UUID ${rel(d.path)}  (content differs → fresh uid; both survive, zero-loss)`,
          );
        } else {
          plannedDeletes++;
          out(
            `    DELETE  ${rel(d.path)}  (identical content → ${rel(d.identicalTo)}; zero-loss)`,
          );
        }
      }
    }

    if (opts.apply !== true) {
      out("");
      out(
        `Plan: delete ${plannedDeletes} identical copy(ies), re-uuid ${plannedReuuids} differing variant(s).`,
      );
      out(
        "DRY-RUN — nothing changed. Re-run with `--auto --apply` to execute (deletes are recoverable via the git remote).",
      );
      return 1; // duplicates still present → "needs attention"
    }

    let deleted = 0;
    let reuuided = 0;
    let skipped = 0;
    for (const { decisions, snap } of plans) {
      // Deletes first: each targets a file identical to a kept representative,
      // so this never touches a file we still need to re-uuid.
      for (const d of decisions) {
        if (d.action !== "delete") continue;
        let current: string;
        try {
          current = await fsp.readFile(d.path, "utf-8");
        } catch {
          continue; // already gone
        }
        // TOCTOU guard: only delete if the file is byte/whitespace-identical to
        // the snapshot we classified — refuse to delete anything that changed.
        if (
          normalizeForCompare(current) !==
          normalizeForCompare(snap.get(d.path) ?? "")
        ) {
          out(
            `  ! skipped delete ${rel(d.path)} (changed since scan — re-run dedup-uids)`,
          );
          skipped++;
          continue;
        }
        await fsp.rm(d.path, { force: true });
        out(`  deleted ${rel(d.path)} (identical to ${rel(d.identicalTo)})`);
        deleted++;
      }
      // Re-uuid the distinct variants (frontmatter rewrite only — never a rename).
      for (const d of decisions) {
        if (d.action !== "reuuid") continue;
        let current: string;
        try {
          current = await fsp.readFile(d.path, "utf-8");
        } catch {
          continue;
        }
        if (extractAssetUid(current) !== d.fromUid) {
          out(
            `  ! skipped re-uuid ${rel(d.path)} (uid changed since scan — re-run dedup-uids)`,
          );
          skipped++;
          continue;
        }
        const rewritten = rewriteUid(current, d.toUid);
        if (rewritten !== current) {
          await fsp.writeFile(d.path, rewritten, "utf-8");
          out(`  re-uuid ${rel(d.path)} → uid=${d.toUid} (content differs from kept copy)`);
          reuuided++;
        }
      }
    }
    out(
      `Resolved: deleted ${deleted} identical copy(ies), re-uuid ${reuuided} differing variant(s).${
        skipped > 0 ? ` ${skipped} skipped (re-run).` : ""
      } Run \`exosync sync\` to propagate.`,
    );
    return skipped > 0 ? 1 : 0; // unresolved leftovers → exit 1
  }

  if (opts.apply === true) {
    out("Note: --apply only applies with --auto; running in report mode.");
  }

  out(`${dups.length} duplicate uid(s) on disk:`);
  for (const [uid, paths] of dups) {
    out(`  ${uid} — ${paths.length} files:`);
    for (const p of paths) out(`    ${rel(p)}`);
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
        "Report duplicate exo__Asset_uid on disk (#3477); --fix re-uuids all but the first; --auto zero-loss auto-resolve (identical→delete, differing→re-uuid; dry-run unless --apply)",
      )
      .option("--fix", "Assign a fresh uuid to every duplicate but the first")
      .option(
        "--auto",
        "Zero-loss auto-resolve: delete identical copies, re-uuid distinct variants (DRY-RUN unless --apply). Supersedes --fix.",
      )
      .option(
        "--apply",
        "Execute the --auto plan (without it --auto is a dry-run; deletes are recoverable via the git remote)",
      ),
  ).action(
    async (
      options: QuarantineCliOptions & {
        fix?: boolean;
        auto?: boolean;
        apply?: boolean;
      },
    ) => {
      try {
        process.exitCode = await runDedupUids(options);
      } catch (error) {
        ErrorHandler.handle(error, { command: "exosync dedup-uids" });
        process.exitCode = 1;
      }
    },
  );
}
