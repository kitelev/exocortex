/**
 * Registry-driven AssetSpace dependency resolver (issue #3513, builds on #3511).
 *
 * In the EKA Alpha 16-repo topology every AssetSpace is its own git repo and the
 * central registry (`kitelev/exoas-registry`) holds one `exo__AssetSpace`
 * descriptor per repo. Each descriptor carries:
 *   - `exo__AssetSpace_source`    — the repo's git clone URL
 *   - `exo__AssetSpace_namespace` — the short namespace (e.g. "exo", "public")
 *   - `exo__AssetSpace_dependsOn` — wikilinks to the descriptors it depends on
 *     (the D18 DAG, #3511)
 *
 * The per-repo SHACL CI gate (issue #3513) needs the **dependent TBox** checked
 * out alongside the repo under validation so that cross-repo class references
 * resolve — otherwise `validate schema --shapes-mode` has no shapes to apply and
 * trivially passes (a false-negative gate), OR demotes every in-scope reference
 * to a warning. This resolver, given the cloned registry + the calling repo's
 * identity, computes the repo's transitive `dependsOn` closure and returns the
 * git URLs of every dependency to clone.
 *
 * The closure walk reuses the single core primitive
 * `transitiveDependsOnClosure` (#3511) so the CI gate and the profile-apply
 * engine share identical DAG semantics (`multi-parser-predicate-migration`
 * parity rule). Pure + filesystem-only — no network, fully unit-testable.
 */

import fs from "fs-extra";
import path from "path";
import yaml from "js-yaml";

import { transitiveDependsOnClosure, derivePath } from "exocortex";

import {
  ASSET_SPACE_CLASS_UID,
  parseWikilinkArray,
} from "./CliProfileResolver.js";

/** One `exo__AssetSpace` descriptor as held in the central registry. */
export interface AssetSpaceDescriptor {
  /** `exo__Asset_uid`. */
  uid: string;
  /** `exo__AssetSpace_namespace` (short namespace, e.g. "exo"); null if absent. */
  namespace: string | null;
  /** `exo__AssetSpace_source` / `exo__AssetSpace_git` (clone URL); null if absent. */
  source: string | null;
  /** `exo__AssetSpace_dependsOn` target UIDs (direct edges only). */
  dependsOn: string[];
}

export type ResolveDepsOutcome =
  | {
      outcome: "resolved";
      /** The matched self descriptor. */
      self: AssetSpaceDescriptor;
      /** Transitive dependency descriptors (closure minus self), in BFS order. */
      dependencies: AssetSpaceDescriptor[];
      /**
       * Closure dependency UIDs that have no descriptor in the registry (dangling
       * `dependsOn` edges) — surfaced for diagnostics; never silently dropped.
       */
      missingDescriptors: string[];
      /**
       * Closure dependency descriptors that have no `source` URL — cannot be
       * cloned; surfaced for diagnostics.
       */
      sourceless: AssetSpaceDescriptor[];
      /**
       * Closure dependency descriptors whose `source` is NOT a safe `git clone`
       * target (option-injection / command-executing transport / whitespace —
       * see {@link isSafeCloneUrl}). Surfaced + never emitted as a clone URL, so
       * a malformed/hostile descriptor source can't reach `git clone` in CI.
       */
      unsafeSources: AssetSpaceDescriptor[];
    }
  | {
      /** No descriptor in the registry matched the self identifier. */
      outcome: "self-not-found";
      selfIdentifier: string;
      /** Number of descriptors scanned (diagnostic). */
      descriptorCount: number;
    };

export interface RegistryScanOptions {
  /** Injectable logger for warn-level diagnostics (defaults to no-op). */
  warn?: (msg: string) => void;
}

/**
 * Pure, single-shot registry resolver. Instantiate, call `resolve()`, discard.
 */
export class RegistryDependencyResolver {
  private readonly warn: (msg: string) => void;

  constructor(options: RegistryScanOptions = {}) {
    this.warn = options.warn ?? (() => undefined);
  }

  /**
   * Scan a cloned registry path and resolve the dependency closure for the
   * AssetSpace identified by `selfIdentifier`.
   *
   * @param registryPath Filesystem path to the checked-out registry repo (it
   *   contains the descriptor `.md` files anywhere in its tree).
   * @param selfIdentifier Identity of the calling repo. Accepts, in match
   *   priority: an `owner/repo` slug or full git URL (matched against each
   *   descriptor's `source` via `derivePath`), or a bare namespace string
   *   (matched against `exo__AssetSpace_namespace`).
   */
  async resolve(
    registryPath: string,
    selfIdentifier: string,
  ): Promise<ResolveDepsOutcome> {
    const descriptors = await this.scanRegistry(registryPath);
    const self = this.matchSelf(descriptors, selfIdentifier);
    if (self === null) {
      return {
        outcome: "self-not-found",
        selfIdentifier,
        descriptorCount: descriptors.size,
      };
    }

    // Build the dependsOn edge map (UID → direct dep UIDs) for the core closure
    // primitive (#3511). Only descriptors with edges need an entry.
    const dependsOn = new Map<string, ReadonlyArray<string>>();
    for (const d of descriptors.values()) {
      if (d.dependsOn.length > 0) dependsOn.set(d.uid, d.dependsOn);
    }

    // AUTHORITATIVE membership: the transitive `dependsOn` closure from self,
    // computed by the shared core primitive (#3511) — identical DAG semantics to
    // the profile-apply engine. The BFS below only ORDERS this set for stable CI
    // logs; it never decides membership, and `missingDescriptors` derives from
    // the closure too, so the primitive's result is the single source of truth.
    const closure = transitiveDependsOnClosure([self.uid], dependsOn);
    closure.delete(self.uid); // dependencies only — exclude self

    // Deterministic BFS ordering over the closure (dependency-before-dependent-ish).
    const orderedUids: string[] = [];
    const orderedSet = new Set<string>();
    const seen = new Set<string>([self.uid]);
    const queue: string[] = [...self.dependsOn];
    while (queue.length > 0) {
      const uid = queue.shift();
      if (uid === undefined || seen.has(uid)) continue;
      seen.add(uid);
      if (closure.has(uid) && !orderedSet.has(uid)) {
        orderedUids.push(uid);
        orderedSet.add(uid);
      }
      const d = descriptors.get(uid);
      if (d !== undefined) {
        for (const next of d.dependsOn) {
          if (!seen.has(next)) queue.push(next);
        }
      }
    }
    // Defensive: any closure member the BFS didn't reach (reachable only via a
    // missing intermediate descriptor) — append in stable iteration order so the
    // ordered list always covers the full closure membership.
    for (const uid of closure) {
      if (!orderedSet.has(uid)) {
        orderedUids.push(uid);
        orderedSet.add(uid);
      }
    }

    // Partition the ordered closure into present descriptors vs dangling edges.
    const ordered: AssetSpaceDescriptor[] = [];
    const missingDescriptors: string[] = [];
    for (const uid of orderedUids) {
      const d = descriptors.get(uid);
      if (d === undefined) missingDescriptors.push(uid);
      else ordered.push(d);
    }

    const sourceless = ordered.filter(
      (d) => d.source === null || d.source.length === 0,
    );
    const unsafeSources = ordered.filter(
      (d) => d.source !== null && d.source.length > 0 && !isSafeCloneUrl(d.source),
    );

    return {
      outcome: "resolved",
      self,
      dependencies: ordered,
      missingDescriptors,
      sourceless,
      unsafeSources,
    };
  }

  /**
   * Match a self identifier against the descriptor set. Match priority:
   *   1. `owner/repo` slug equality (derived from each descriptor's source)
   *   2. namespace equality
   *
   * A full git URL is normalised via `derivePath` → `assetspaces/<owner>/<repo>`
   * → compared on the `<owner>/<repo>` tail, so https/ssh/scp forms all match.
   */
  matchSelf(
    descriptors: ReadonlyMap<string, AssetSpaceDescriptor>,
    selfIdentifier: string,
  ): AssetSpaceDescriptor | null {
    const wantSlug = ownerRepoSlug(selfIdentifier);

    if (wantSlug !== null) {
      for (const d of descriptors.values()) {
        if (d.source === null) continue;
        const slug = ownerRepoSlug(d.source);
        if (slug !== null && slug === wantSlug) return d;
      }
    }

    // Namespace fallback — exact match (case-sensitive, mirrors descriptor data).
    for (const d of descriptors.values()) {
      if (d.namespace !== null && d.namespace === selfIdentifier) return d;
    }

    return null;
  }

  /**
   * Walk a registry checkout and parse every `exo__AssetSpace` descriptor.
   * Last-write-wins on duplicate UID (registry is the single source of truth;
   * duplicates are a data error surfaced via warn).
   */
  async scanRegistry(
    registryPath: string,
  ): Promise<Map<string, AssetSpaceDescriptor>> {
    const out = new Map<string, AssetSpaceDescriptor>();
    const resolvedRoot = path.resolve(registryPath);
    if (!(await fs.pathExists(resolvedRoot))) {
      this.warn(
        `[RegistryDependencyResolver] registry path does not exist: ${resolvedRoot}`,
      );
      return out;
    }

    const stack: string[] = [resolvedRoot];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      let entries: fs.Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (
            entry.name.startsWith(".") ||
            entry.name === "node_modules" ||
            entry.name === ".obsidian" ||
            entry.name === ".exocortex"
          ) {
            continue;
          }
          stack.push(full);
          continue;
        }
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
        const fm = await this.tryReadFrontmatter(full);
        if (fm === null) continue;
        const classes = parseWikilinkArray(fm["exo__Instance_class"]);
        if (!classes.some((c) => c === ASSET_SPACE_CLASS_UID)) continue;
        const uid = fm["exo__Asset_uid"];
        if (typeof uid !== "string" || uid.length === 0) continue;

        const source =
          typeof fm["exo__AssetSpace_source"] === "string"
            ? (fm["exo__AssetSpace_source"] as string)
            : typeof fm["exo__AssetSpace_git"] === "string"
              ? (fm["exo__AssetSpace_git"] as string)
              : null;
        const namespace =
          typeof fm["exo__AssetSpace_namespace"] === "string"
            ? (fm["exo__AssetSpace_namespace"] as string)
            : null;
        const dependsOn = parseWikilinkArray(fm["exo__AssetSpace_dependsOn"]);

        if (out.has(uid)) {
          this.warn(
            `[RegistryDependencyResolver] duplicate AssetSpace descriptor for uid=${uid} — last wins (${full})`,
          );
        }
        out.set(uid, { uid, namespace, source, dependsOn });
      }
    }
    return out;
  }

  private async tryReadFrontmatter(
    filePath: string,
  ): Promise<Record<string, unknown> | null> {
    let content: string;
    try {
      content = await fs.readFile(filePath, "utf-8");
    } catch {
      return null;
    }
    if (!content.startsWith("---")) return null;
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (match === null) return null;
    try {
      const parsed = yaml.load(match[1]);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }
}

/**
 * Extract a normalised `owner/repo` slug from a git URL OR a bare `owner/repo`
 * string. Returns null when no `<owner>/<repo>` pair can be derived.
 *
 * Reuses `derivePath` (which yields `assetspaces/<owner>/<repo>`) for full URLs;
 * a bare `owner/repo` (no scheme, exactly two non-empty segments) is accepted
 * directly so callers can pass `github.repository`.
 */
export function ownerRepoSlug(identifier: string): string | null {
  const trimmed = identifier.trim();
  if (trimmed.length === 0) return null;

  const derived = derivePath(trimmed);
  if (derived !== null) {
    // `assetspaces/<owner>/<repo>` → `<owner>/<repo>`
    return derived.replace(/^assetspaces\//, "").toLowerCase();
  }

  // Bare `owner/repo` (no scheme, no host) — accept exactly two clean segments.
  if (!trimmed.includes("://") && !trimmed.includes("@")) {
    const segs = trimmed.replace(/\.git$/i, "").replace(/\/+$/, "").split("/");
    const clean = segs.filter((s) => s.length > 0);
    if (clean.length === 2) {
      return `${clean[0]}/${clean[1]}`.toLowerCase();
    }
  }
  return null;
}

/**
 * Whether a descriptor `source` is a safe `git clone` target. The CI gate feeds
 * this value straight into `git clone <url>`, so anything git would interpret as
 * an OPTION or a command-executing TRANSPORT is a remote-code-execution vector.
 * Reject:
 *   - leading `-`           — parsed as an option (`--upload-pack=…`, `-c …`)
 *   - `ext::`/`file::`/`fd::` transports — git runs arbitrary shell
 *   - embedded whitespace / control chars / newlines — arg/line splitting
 * Allow only well-formed http(s)/ssh/git URLs and scp-like `user@host:path`.
 * Defence-in-depth: even though descriptor sources come from the trusted central
 * registry, this resolver does the validation so a malformed/hostile source can
 * never reach `git clone` (the workflow adds `--` + `GIT_ALLOW_PROTOCOL` too).
 */
export function isSafeCloneUrl(source: string): boolean {
  if (typeof source !== "string" || source.length === 0) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\s\x00-\x1f]/.test(source)) return false; // whitespace / control chars
  if (source.startsWith("-")) return false; // git option injection
  if (/^(ext|file|fd|ftp|ftps)::/i.test(source)) return false; // command/odd transports
  if (/^https?:\/\/[^\s]+$/i.test(source)) return true;
  if (/^ssh:\/\/[^\s]+$/i.test(source)) return true;
  if (/^git:\/\/[^\s]+$/i.test(source)) return true;
  // scp-like SSH: user@host:owner/repo (no leading dash already excluded above)
  if (/^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:[^\s]+$/.test(source)) return true;
  return false;
}
