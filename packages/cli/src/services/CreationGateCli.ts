import {
  CREATION_GATE_CLASS_LABEL,
  CREATION_GATE_CLASS_UID,
  CreationGateRefusedError,
  CreationGateSession,
  IRI,
  iriToVaultPath,
  isUuid,
  type CreationGatePolicy,
  type CreationGatePolicySource,
  type CreationGateVerdict,
  type FrontmatterByRef,
  type InMemoryTripleStore,
} from "@kitelev/exocortex-core";
import type { NodeFsAdapter } from "../adapters/NodeFsAdapter.js";
import { PlanningFsAdapter } from "../adapters/PlanningFsAdapter.js";
import { CreationGateRefusedCliError } from "../utils/errors/index.js";
import { StderrLogger } from "../infrastructure/StderrLogger.js";

/**
 * req f5b79260 (ticket 316dd2be) — the CLI's side of the creation gate: where
 * rule assets come from and how a reference resolves, on each command's own
 * vault index. The semantics live in core; nothing here knows a rule's values.
 */

/**
 * A reference (UID, label, alias or basename) → the frontmatter of the asset it
 * names, through the command's own adapter. A UID is looked up in ONE listing
 * of the vault's file names, taken lazily once per session (UID-canon vaults:
 * the file is named after its UID — no file read) and only then by
 * frontmatter; anything else by label, then by linkpath (basename, label or
 * alias — the adapter's one-pass fallback). Label lookups ride whatever the
 * adapter narrows: `create`'s planning adapter answers them from the triple
 * cache (#4291).
 *
 * ⛔ Only the name listing is kept, never frontmatter: a composite command may
 * rewrite an asset between two judgements, and a kept frontmatter would judge
 * the earlier state (plugin-getfrontmatter-stale-in-composite). A file created
 * in the same session is found through the session's journal, not here.
 */
export function createFsFrontmatterByRef(fs: NodeFsAdapter): FrontmatterByRef {
  let uidNamed: Promise<Map<string, string>> | undefined;
  const uidNamedFiles = (): Promise<Map<string, string>> => {
    uidNamed ??= (async () => {
      const byUid = new Map<string, string>();
      const exactHeads = new Set<string>();
      for (const rel of await fs.getMarkdownFiles()) {
        // the directories `findFileByUidFilename` skips
        const dirs = rel.split("/").slice(0, -1);
        if (dirs.some((dir) => dir.startsWith(".") || dir === "node_modules")) continue;
        const base = rel.slice(rel.lastIndexOf("/") + 1).toLowerCase();
        const head = base.slice(0, 36);
        const rest = base.slice(36);
        // the name shapes `findFileByUidFilename` accepts: `<uid>.md`, `<uid> …`, `<uid>-…`
        const exact = rest === ".md";
        if (!isUuid(head) || !(exact || rest.startsWith(" ") || rest.startsWith("-"))) continue;
        // the gate's convention for duplicates: `<uid>.md` wins over `<uid> 2.md` /
        // `<uid>-copy.md`, and of two `<uid>.md` the first in path order wins (as
        // `findFileByUID` picks; `findFileByUidFilename` walks in readdir order and
        // has no preference — the fallback only runs when this listing failed)
        if (exactHeads.has(head)) continue;
        if (exact) exactHeads.add(head);
        if (exact || !byUid.has(head)) byUid.set(head, rel);
      }
      return byUid;
    })();
    // a failed listing is not kept: the next lookup tries again
    const listing = uidNamed;
    listing.catch(() => {
      if (uidNamed === listing) uidNamed = undefined;
    });
    return listing;
  };
  const readFrontmatter = async (path: string): Promise<Record<string, unknown> | null> => {
    try {
      return (await fs.getFileMetadata(path)) as Record<string, unknown>;
    } catch {
      return null;
    }
  };
  return async (ref: string) => {
    const wanted = ref.trim();
    if (wanted.length === 0) return null;
    try {
      if (isUuid(wanted)) {
        let listed: string | undefined;
        let listingFailed = false;
        try {
          listed = (await uidNamedFiles()).get(wanted.toLowerCase());
        } catch {
          listingFailed = true;
        }
        const fromListing = listed ? await readFrontmatter(listed) : null;
        if (fromListing) return fromListing;
        // not named after the UID, the listing failed, or the listed file could
        // not be read: the adapter's own lookups (the name walk only when the
        // listing itself failed — otherwise it would search the same names again)
        const path =
          (listingFailed ? await fs.findFileByUidFilename(wanted) : null) ??
          (await fs.findFileByUID(wanted));
        return path ? await readFrontmatter(path) : null;
      }
      const path =
        (await fs.findFilesByMetadata({ exo__Asset_label: wanted }))[0] ??
        (await fs.findFileByLinkpath(wanted));
      return path ? await readFrontmatter(path) : null;
    } catch {
      return null;
    }
  };
}

/**
 * Does an `exo__Instance_class` OBJECT (as the converter emits it) name the
 * rule class? Every IRI form carries either the class UID (file or pathless
 * `obsidian://vault/<uid>.md`, where the class does not resolve) or the
 * symbolic local name (`…/exocmd#CreationGate`, where it does).
 */
export function isCreationGateClassObject(value: string): boolean {
  const symbolicTail = `#${CREATION_GATE_CLASS_LABEL.replace(/^[^_]+__/, "")}`;
  return value.toLowerCase().includes(CREATION_GATE_CLASS_UID) || value.endsWith(symbolicTail);
}

/** What a persistent cache can say about where rule assets live (see `CacheManager.instanceClassPaths`). */
export type CreationGateCacheNarrowing = () => Promise<
  { paths: string[]; unknownPaths: string[] } | null | undefined
>;

/**
 * Above this many cache-unjudgeable files the narrowing is declined (they are
 * candidates for every lookup) — the bound #4291's lookup narrowing uses, read
 * from there so the two cannot drift apart.
 */
const MAX_UNKNOWN_PATHS = PlanningFsAdapter.MAX_UNKNOWN_PATHS;

const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * a7181947 — "does this text mention the rule class", case-insensitively,
 * WITHOUT lowering the whole text: the per-file `toLowerCase()` copied every
 * file of the vault on the un-narrowed path (~230 ms on vault-exodev, 48 498
 * files, measured 2026-10-19).
 *
 * Same files as `text.toLowerCase().includes(needle)`: both needles are ASCII
 * and the pattern has no `u` flag, so `i` folds ASCII letters only and no
 * non-ASCII code unit can match a needle character. The lowered text could
 * gain ASCII only through `İ` → `i` + U+0307 and `K` (U+212A) → `k`: the
 * needles hold no `k`, and their `i`s are never last, so the combining mark
 * after a produced `i` always breaks the match. Measured: 3 870 024 inputs
 * (every code unit in every needle position + 200 000 random strings), 0
 * differences.
 */
const RULE_CLASS_MENTION = new RegExp(
  `${escapeRegExp(CREATION_GATE_CLASS_UID)}|${escapeRegExp(CREATION_GATE_CLASS_LABEL)}`,
  "i",
);

/**
 * Rule candidates for `create` / `create-batch`: every markdown file whose
 * text mentions the rule class (by UID or label), parsed.
 *
 * With a valid persistent cache (`narrow`), only the files the cache types as
 * the rule class — plus the few it holds no triples for — are read at all, so
 * `create`'s cache-narrowed planning (#4291) stays narrowed. Without one, every
 * file is considered, through the adapter's read memo: the un-narrowed
 * planning already reads every file once, so that pass is a substring search,
 * not a second read of the vault.
 *
 * ⛤ a7181947: this pass was the SMALLER part of the un-narrowed price — on
 * vault-exodev ~0.34 s of the gate's ~1.62 s, most of it the per-file
 * `toLowerCase()` (see `RULE_CLASS_MENTION`). The bulk was the rule parser's
 * per-key label lookups (`parseCreationGatePolicy`), each a full cloning scan
 * of the vault's metadata — see `PlanningFsAdapter.scanUncloned`.
 */
export function createFsPolicySource(
  fs: NodeFsAdapter,
  narrow?: CreationGateCacheNarrowing,
): CreationGatePolicySource {
  return {
    async candidates() {
      const started = performance.now();
      let paths: string[] | null = null;
      if (narrow) {
        try {
          const narrowed = await narrow();
          if (narrowed && narrowed.unknownPaths.length <= MAX_UNKNOWN_PATHS) {
            paths = [...narrowed.paths, ...narrowed.unknownPaths];
          }
        } catch {
          paths = null; // fail-open to the walk: never a missed rule
        }
      }
      const narrowed = paths !== null;
      paths ??= await fs.getMarkdownFiles();
      const out: { path: string; frontmatter: Record<string, unknown> }[] = [];
      for (const path of paths) {
        let text: string;
        try {
          text = await fs.readFile(path);
        } catch {
          continue;
        }
        // case-insensitive, as `namesCreationGateClass` judges the class
        if (!RULE_CLASS_MENTION.test(text)) continue;
        try {
          out.push({
            path,
            frontmatter: (await fs.getFileMetadata(path)) as Record<string, unknown>,
          });
        } catch {
          continue;
        }
      }
      StderrLogger.debug("creation gate: rule candidates", {
        narrowed,
        scanned: paths.length,
        candidates: out.length,
        ms: Math.round(performance.now() - started),
      });
      return out;
    },
  };
}

const INSTANCE_CLASS = new IRI("https://exocortex.my/ontology/exo#Instance_class");

/**
 * Rule candidates for `apply`: the subjects its already-loaded triple store
 * types as the rule class — in any of the IRI forms the converter emits (the
 * symbolic `…/exocmd#CreationGate` where the class resolves, a file or
 * pathless `obsidian://vault/<uid>.md` where it does not) — read FRESH from
 * disk. No extra walk of the vault.
 */
export function createTripleStorePolicySource(
  store: InMemoryTripleStore,
  fs: NodeFsAdapter,
): CreationGatePolicySource {
  return {
    async candidates() {
      const paths = new Set<string>();
      for (const triple of await store.match(undefined, INSTANCE_CLASS, undefined)) {
        const object = String((triple.object as { value?: unknown }).value ?? "");
        if (!isCreationGateClassObject(object)) continue;
        const subject = String((triple.subject as { value?: unknown }).value ?? "");
        const path = iriToVaultPath(subject);
        if (path) paths.add(path);
      }
      const out: { path: string; frontmatter: Record<string, unknown> }[] = [];
      for (const path of paths) {
        try {
          out.push({
            path,
            frontmatter: (await fs.getFileMetadata(path)) as Record<string, unknown>,
          });
        } catch {
          continue;
        }
      }
      return out;
    },
  };
}

/**
 * a7181947 (P1 of the T4 spec §5) — the gate's own time in the debug output
 * (`EXOCORTEX_DEBUG`): one line per verdict, with the session's running total.
 * `sessionMs` is a SUM of durations, not wall-clock: two verdicts awaiting the
 * same first rule load would both count it (no caller runs verdicts
 * concurrently today — create, create-batch and apply's writers are serial).
 */
class TimedCreationGateSession extends CreationGateSession {
  private spentMs = 0;
  /** >0 while a verdict runs: its own time already covers the rule load. */
  private judging = 0;

  override async policies(): Promise<CreationGatePolicy[]> {
    if (this.judging > 0) return super.policies();
    const started = performance.now();
    let count: number | null = null;
    try {
      const policies = await super.policies();
      count = policies.length;
      return policies;
    } finally {
      const ms = performance.now() - started;
      this.spentMs += ms;
      StderrLogger.debug("creation gate: rules", {
        policies: count,
        ms: Math.round(ms),
        sessionMs: Math.round(this.spentMs),
      });
    }
  }

  override async judge(path: string, content: string): Promise<CreationGateVerdict> {
    const started = performance.now();
    let verdict: CreationGateVerdict | undefined;
    this.judging += 1;
    try {
      verdict = await super.judge(path, content);
      return verdict;
    } finally {
      this.judging -= 1;
      const ms = performance.now() - started;
      this.spentMs += ms;
      StderrLogger.debug("creation gate: verdict", {
        path,
        allowed: verdict?.allowed ?? null,
        ms: Math.round(ms),
        sessionMs: Math.round(this.spentMs),
      });
    }
  }
}

/** A gate session over the command's own adapter. */
export function createCliCreationGateSession(
  fs: NodeFsAdapter,
  source: CreationGatePolicySource = createFsPolicySource(fs),
): CreationGateSession {
  return new TimedCreationGateSession({ source, frontmatterByRef: createFsFrontmatterByRef(fs) });
}

/** A core refusal as the CLI's typed error (exit code 4); anything else unchanged. */
export function toCliCreationGateError(error: unknown): unknown {
  return error instanceof CreationGateRefusedError
    ? new CreationGateRefusedCliError(error)
    : error;
}
