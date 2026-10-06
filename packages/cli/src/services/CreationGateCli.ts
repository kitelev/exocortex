import {
  CREATION_GATE_CLASS_LABEL,
  CREATION_GATE_CLASS_UID,
  CreationGateRefusedError,
  CreationGateSession,
  IRI,
  iriToVaultPath,
  isUuid,
  type CreationGatePolicySource,
  type FrontmatterByRef,
  type InMemoryTripleStore,
} from "@kitelev/exocortex-core";
import type { NodeFsAdapter } from "../adapters/NodeFsAdapter.js";
import { CreationGateRefusedCliError } from "../utils/errors/index.js";

/**
 * req f5b79260 (ticket 316dd2be) — the CLI's side of the creation gate: where
 * rule assets come from and how a reference resolves, on each command's own
 * vault index. The semantics live in core; nothing here knows a rule's values.
 */

/**
 * A reference (UID, label, alias or basename) → the frontmatter of the asset it
 * names, through the command's own adapter — so the lookups ride the same
 * memo / cache-narrowed / triple-indexed paths the command already pays for.
 * A UID is tried by filename first (UID-canon vaults: no file read), then by
 * frontmatter; anything else by label, then by linkpath (basename, label or
 * alias — the adapter's one-pass fallback).
 */
export function createFsFrontmatterByRef(fs: NodeFsAdapter): FrontmatterByRef {
  return async (ref: string) => {
    const wanted = ref.trim();
    if (wanted.length === 0) return null;
    let path: string | null = null;
    try {
      if (isUuid(wanted)) {
        path =
          (await fs.findFileByUidFilename(wanted)) ??
          (await fs.findFileByUID(wanted));
      } else {
        path =
          (await fs.findFilesByMetadata({ exo__Asset_label: wanted }))[0] ??
          (await fs.findFileByLinkpath(wanted));
      }
      if (!path) return null;
      return (await fs.getFileMetadata(path)) as Record<string, unknown>;
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
 * candidates for every lookup) — the same conservative bound #4291 uses.
 */
const MAX_UNKNOWN_PATHS = 200;

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
 */
export function createFsPolicySource(
  fs: NodeFsAdapter,
  narrow?: CreationGateCacheNarrowing,
): CreationGatePolicySource {
  return {
    async candidates() {
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
      paths ??= await fs.getMarkdownFiles();
      const out: { path: string; frontmatter: Record<string, unknown> }[] = [];
      for (const path of paths) {
        let text: string;
        try {
          text = await fs.readFile(path);
        } catch {
          continue;
        }
        if (
          !text.includes(CREATION_GATE_CLASS_UID) &&
          !text.includes(CREATION_GATE_CLASS_LABEL)
        ) {
          continue;
        }
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

/** A gate session over the command's own adapter. */
export function createCliCreationGateSession(
  fs: NodeFsAdapter,
  source: CreationGatePolicySource = createFsPolicySource(fs),
): CreationGateSession {
  return new CreationGateSession({ source, frontmatterByRef: createFsFrontmatterByRef(fs) });
}

/** A core refusal as the CLI's typed error (exit code 4); anything else unchanged. */
export function toCliCreationGateError(error: unknown): unknown {
  return error instanceof CreationGateRefusedError
    ? new CreationGateRefusedCliError(error)
    : error;
}
