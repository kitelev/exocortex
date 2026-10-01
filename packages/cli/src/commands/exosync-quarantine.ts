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
  CONDITIONAL_STORE_FILENAME,
  CONFLICT_CACHE_STORE_FILENAME,
  FileWatermarkStore,
  LocalConflictCacheStore,
  LocalOutboxStore,
  OUTBOX_STORE_FILENAME,
  QuarantineResolver,
  extractAssetUid,
  rewriteAssetUid,
  findDuplicateUidGroups,
  planDuplicateUidFix,
  type DedupUidFile,
  type PinnedPath,
  type PinnedPathKind,
  type ResolveChoice,
  type SyncRepoSpec,
} from "@kitelev/exocortex-core";
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
import {
  nodeConditionalStoreIO,
  wireConditionalRequests,
} from "../services/conditionalRequestTransport.js";
import { wireObjectCache } from "../services/objectCacheTransport.js";
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
  const rawTransport =
    deps.transportFactory?.(token, opts.apiBase) ?? pushService.transport();

  const { specs, warnings } = collectVaultSpecs(vaultPath);
  const configDir = opts.configDir ?? ".obsidian";
  // req af002ec4 — same conditional reads as sync/parity; a resolve re-reads
  // refs and trees the sync that created the conflict already validated.
  const etagPath = path.join(
    vaultPath,
    configDir,
    "plugins",
    "exocortex",
    CONDITIONAL_STORE_FILENAME,
  );
  // req af002ec4 × req 086df113 — ORDER MATTERS and the two do not overlap.
  // The SHA cache sits OUTSIDE: an immutable object it already holds costs no
  // request at all, so it must answer before a conditional request is even
  // built. Conditional reads sit INSIDE, for what the cache cannot serve —
  // mutable `git/refs`, and a SHA it has not seen.
  const { transport: conditionalTransport } = wireConditionalRequests(
    rawTransport,
    {
      ...(opts.conditionalRequests !== undefined
        ? { enabled: opts.conditionalRequests }
        : {}),
      io: nodeConditionalStoreIO(etagPath),
    },
  );
  const { transport } = wireObjectCache(conditionalTransport, {
    ...(opts.objectCache !== undefined ? { enabled: opts.objectCache } : {}),
    sha1: nodeSha1,
  });
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

  // One pass classifies every pin: the open conflicts (unchanged) and the pins
  // that are NOT conflicts but still keep their path out of push (#4225).
  const { conflicts, pinned } = await resolver.classifyPins(specs);
  if (opts.json === true) {
    // The open-conflict array, unchanged in shape — machine consumers read it.
    out(JSON.stringify(conflicts, null, 2));
    return 0;
  }
  if (conflicts.length === 0) {
    out("No open conflicts — nothing to resolve. ✅");
    printPinnedNotConflicting(pinned, vaultPath, out);
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
  // ⛔ The hint is COPIED VERBATIM by a user who has an open conflict, so it must
  //    parse. `resolve` takes exactly ONE positional (the conflict path); the merged
  //    file is the VALUE OF `--file`, never a second positional. The old wording
  //    `--take local|remote|file <path>` read as "the third choice takes a positional"
  //    and died with `too many arguments for 'resolve'`. Req 85630457, issue #4206.
  out(
    "Resolve with: exosync quarantine resolve <path> --take local|remote|file --vault <vault> --token-from-gh",
  );
  out("              (--take file also needs --file <merged-content-path>)");
  printPinnedNotConflicting(pinned, vaultPath, out);
  return 0;
}

const PINNED_KIND_TEXT: Record<PinnedPathKind, string> = {
  "remote-pending": "remote change not applied here yet — this copy is behind",
  "local-withheld": "local change, not pushed yet — the next push or sync delivers it",
  converged: "converged, clears on the next sync",
  unclassified: "unclassified (remote tree unavailable, or a file-mode space)",
};

/**
 * #4225 — pins that are not conflicts. `list` used to answer only «No open
 * conflicts ✅» over them, and a push-only device never runs the pull that
 * clears them. What a pin costs depends on its kind: a `remote-pending` pin is an
 * incoming change this copy has not applied (the vault reads stale data); a
 * `local-withheld` one is a local change not pushed yet — the next push delivers
 * it: a pin does NOT exclude a local change from push, push re-reads the remote
 * diff for pinned paths (review of #4391, probed on the real engine; locked by
 * axis X4), and the same push clears the pin once nothing is left to reconcile
 * (also X4). A `remote-pending` pin is the kind only a pull/sync clears — which
 * is why push-only vaults accumulate them.
 * The remedy for every kind is `exosync sync` (pull + push); a pull alone
 * applies incoming changes but ships nothing.
 */
function printPinnedNotConflicting(
  pinned: readonly PinnedPath[],
  vaultPath: string,
  out: (line: string) => void,
): void {
  if (pinned.length === 0) return;
  out("");
  out(`${pinned.length} pinned path(s) are not conflicts:`);
  for (const kind of Object.keys(PINNED_KIND_TEXT) as PinnedPathKind[]) {
    const n = pinned.filter((p) => p.kind === kind).length;
    if (n > 0) out(`  ${String(n).padStart(5)}  ${PINNED_KIND_TEXT[kind]}`);
  }
  for (const p of pinned.filter((x) => x.kind === "local-withheld")) {
    out(`  ${p.repoKey}  ${p.path}  [${PINNED_KIND_TEXT["local-withheld"]}]`);
  }
  // ⛔ A sync, never a hand-edit of the watermark: a pin on a deferred incoming
  //    change keeps the OLD watermark entry, and dropping it without a pull makes
  //    a later push send the old disk copy over the remote (#4225).
  out(`Clear with: exosync sync --vault ${vaultPath} --token-from-gh`);
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
  // ⛔ Review of #4342, MEDIUM-1: with NO mounted AssetSpace the conflict set is
  // empty for a reason that has nothing to do with conflicts, and "no open
  // conflicts" would be a quantifier over the empty set — formally true, and it
  // tells the reader the opposite cause. `runQuarantineList` already guards this
  // (`specs.length === 0` → "No materialized AssetSpaces …"); the same sentence
  // is used here for parity. `resolve` RETURNS 1 where `list` returns 0: for
  // `list` an empty vault is a complete answer, for `resolve` it is a refusal.
  if (specs.length === 0) {
    out("No materialized AssetSpaces with a GitHub source found in this vault.");
    return 1;
  }

  const conflicts = await resolver.listOpenConflicts(specs);
  const repoFilter = opts.repo;
  const byPath = conflicts.filter((c) => c.path === conflictPath);
  const matches =
    repoFilter === undefined ? byPath : byPath.filter((c) => c.repoKey === repoFilter);
  if (matches.length === 0) {
    // Ticket 21123711 / #4226 — the refusal names the ARGUMENT that did not
    // match, not a claim about state. The filter above is CONJUNCTIVE (path AND
    // repoKey), so three different inputs used to collapse into one sentence —
    // "No open conflict for …, run `exosync quarantine list`" — which was
    // measurably false for two of them: `list` shows the conflict both before
    // and after. `conflicts` is already in hand one line up, so distinguishing
    // the three costs nothing (decision-surface-must-derive-from-mechanism §A9:
    // a pointer to `list` here was a signature, not a mechanism).
    //
    // ⛤ Form mirrors the `matches.length > 1` branch below, which already
    // enumerates `  --repo <repoKey>`; parity by citation, not by analogy.
    if (conflicts.length === 0) {
      // The ONLY input for which a statement about the conflict set is true.
      out(`No open conflicts in any mounted assetspace — nothing to resolve.`);
    } else if (repoFilter !== undefined && byPath.length > 0) {
      // The path IS open; the `--repo` filter is what excluded it. Naming the
      // VALUE passed is the point of this branch — review MEDIUM/LOW-2: the
      // sentence being replaced did print it, and dropping it here would be a
      // regression in the very branch that is about that value.
      out(
        `"${conflictPath}" is an open conflict, but not in "${repoFilter}" — a repoKey carries ` +
          `the sync branch (owner/repo#branch). It conflicts in:`,
      );
      for (const c of byPath) out(`  --repo ${c.repoKey}`);
    } else {
      // The path matched nothing. ⛤ When `--repo` was given, enumerate only that
      // repo's conflicts (review LOW-1: listing another repo's paths invites the
      // caller to copy one and earn a second refusal for the same mistake);
      // otherwise print the `repoKey  path` pair, mirroring `quarantine list`,
      // because two repos can hold the SAME repo-relative path and bare paths
      // would print as two identical lines.
      const candidates =
        repoFilter === undefined
          ? conflicts
          : conflicts.filter((c) => c.repoKey === repoFilter);
      out(
        `"${conflictPath}" is not among the ${candidates.length} open conflict(s)` +
          (repoFilter === undefined ? "" : ` in "${repoFilter}"`) +
          ` — the path is repo-relative, exactly as \`exosync quarantine list\` prints it:`,
      );
      for (const c of candidates) {
        out(repoFilter === undefined ? `  ${c.repoKey}  ${c.path}` : `  ${c.path}`);
      }
    }
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
    // Ticket 21123711 — the backup STAYS. req `e85487a7` (Active) guarantees it
    // "ALWAYS backs up the discarded local version to a SIBLING
    // .conflict.local.txt", so the word `sibling` pins the LOCATION: neither
    // deleting it nor moving it out of the assetspace is available here. What was
    // missing is the two facts a reader needs to act — that it never leaves this
    // device, and when it is safe to remove. An explicit opt-in removal is a
    // question about whose risk it is, and lives in ticket 10150529.
    out(
      `     it stays on this device only — '.conflict.' paths are excluded from BOTH sync ` +
        `predicates, so the backup never reaches the remote. Delete it yourself once you have ` +
        `checked you do not need the discarded version.`,
    );
  }
  return 0;
}

/**
 * Content-preserving normalization for the IDENTICAL-copy test. Two files equal
 * after this carry the SAME content — only line-ending STYLE (CRLF vs LF) and
 * trailing blank lines / a final newline differ, which no markdown/RDF reader
 * treats as data — so deleting one is provably zero-loss. Deliberately MINIMAL:
 * it does NOT strip per-line trailing whitespace (a Markdown hard line break is
 * two trailing spaces — collapsing it would be a real rendering change), does
 * NOT touch frontmatter field VALUES (e.g. a differing `exo__Asset_updatedAt`),
 * the body text, or interior/leading whitespace, and reorders nothing. ANY such
 * difference surfaces as DIFFERING (→ re-uuid, never delete) — conservative by
 * construction, erring toward re-uuid at every doubt.
 */
export function normalizeForCompare(content: string): string {
  return content
    .replace(/\r\n?/g, "\n") // CRLF / lone CR → LF (line-ending style is not data)
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

  // Enumerate absolute paths + content across the materialized sync units (the
  // same set sync diffs), then defer the uid grouping to the shared
  // platform-free helper (#3676 — the in-plugin command composes the SAME
  // `findDuplicateUidGroups` / `planDuplicateUidFix` over `vault.adapter`).
  const files: DedupUidFile[] = [];
  for (const spec of specs) {
    const root = path.join(vaultPath, spec.localPath);
    if (!existsSync(root)) continue;
    const port = nodeLocalFilesPort(root);
    for (const rel of await port.list()) {
      if (!rel.endsWith(".md")) continue;
      try {
        files.push({ path: path.join(root, rel), content: await port.read(rel) });
      } catch {
        continue;
      }
    }
  }

  // Duplicate-uid groups, sorted by uid (paths keep enumeration order for the
  // report). Shaped as `[uid, paths]` so the report / `--auto` flow below is
  // unchanged.
  const dups: Array<[string, string[]]> = findDuplicateUidGroups(files).map(
    (g) => [g.uid, [...g.paths]],
  );

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
      const groupFiles: Array<{ path: string; content: string }> = [];
      const snap = new Map<string, string>();
      for (const p of paths) {
        const c = await fsp.readFile(p, "utf-8");
        groupFiles.push({ path: p, content: c });
        snap.set(p, c);
      }
      plans.push({
        uid,
        decisions: planDedupGroup(uid, groupFiles, randomUUID),
        snap,
      });
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
        "DRY-RUN — nothing changed. Re-run with `--auto --apply` to execute (a deleted copy's content always survives in the kept file; if previously synced it is also recoverable from the git remote).",
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
        const rewritten = rewriteAssetUid(current, d.toUid);
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

  // Keep the FIRST occurrence's uid per group, re-uuid the rest (the shared
  // `planDuplicateUidFix` plans deterministically by path so a re-run is
  // idempotent — the first stays first). The in-plugin command applies the
  // identical plan over `vault.adapter` (#3676 — same fix on both platforms).
  let fixed = 0;
  for (const r of planDuplicateUidFix(files, randomUUID)) {
    await fsp.writeFile(r.path, r.content, "utf-8");
    out(`  fixed ${rel(r.path)} → uid=${r.toUid}`);
    fixed++;
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
      ErrorHandler.handle(error as Error, { command: "exosync quarantine list" });
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
      ErrorHandler.handle(error as Error, { command: "exosync quarantine resolve" });
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
        "Execute the --auto plan (without it --auto is a dry-run; a deleted copy's content always survives in the kept file, and if previously synced is recoverable from the git remote)",
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
        ErrorHandler.handle(error as Error, { command: "exosync dedup-uids" });
        process.exitCode = 1;
      }
    },
  );
}
