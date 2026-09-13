import { Command } from "commander";
import { existsSync, statSync } from "fs";
import { resolve } from "path";
import {
  extractAssetReference,
  transitiveDependsOnClosure,
} from "@kitelev/exocortex-core";
import {
  CachingNodeFsAdapter,
  type IndexedAsset,
} from "../adapters/CachingNodeFsAdapter.js";
import {
  ASSET_SPACE_CLASS_UID,
  parseWikilinkArray,
} from "../services/CliProfileResolver.js";
import { ownerRepoSlug } from "../services/RegistryDependencyResolver.js";
import {
  isNodeModulesPath,
  isTemplatesPath,
} from "../utils/vaultPathFilters.js";
import { ErrorHandler, type OutputFormat } from "../utils/ErrorHandler.js";
import { VaultNotFoundError } from "../utils/errors/index.js";

/**
 * `exocortex audit assetspace-depends` — the AssetSpace dependency-declaration
 * COVERAGE gate (RFC 306dcb5c, founder frame 2026-09-12; req 04208713).
 *
 * Two graphs, two invariants — and this verb judges ONE of them:
 *
 *   • FACTS — definition-tier cross-AssetSpace edges: an asset under
 *     `assetspaces/<o>/<A>/` whose definition-tier property (see
 *     {@link DEFINITION_TIER_PREDICATES}) references an asset under
 *     `assetspaces/<o>/<B>/` is a fact edge A→B.
 *   • DECLARATIONS — `exo__AssetSpace_dependsOn` on the `exo__AssetSpace`
 *     descriptors of the central registry (`kitelev/exoas-registry`), keyed
 *     by `owner/repo` derived from `exo__AssetSpace_source` (peer descriptors
 *     of testers share NAMES, never `owner/repo`).
 *
 * Invariant (one-sided, judged BY CLOSURE): every fact edge A→B must have B in
 * the transitive `dependsOn` closure of A — the same closure the engine walks
 * ({@link transitiveDependsOnClosure}, shared with `resolve-deps` and
 * profile-apply), so the gate can never be stricter than the mechanism it
 * guards. A declaration WITHOUT a fact is never a violation: it is reported
 * informationally when the target's `exo__AssetSpace_dependsOnKind` is TBox or
 * absent; a Reference-kind target is packaging by definition (frame p.4) and
 * is only counted. ⛔ The declared graph is NOT checked for
 * cycles here: `dependsOn` is packaging and its cycles are legitimate (frame
 * p.1); acyclicity is a property of the FACTS graph and lives in the scheduled
 * cycle detector (N3), not in this verb.
 *
 * Verdict = `uncoveredByClosure`. `uncoveredDirect` (fact edges whose target is
 * not a DIRECT `dependsOn` of the source) is printed next to it, always, and is
 * informational — a single number is never the criterion (frame p.2).
 *
 * Three verdicts, not two: `OK` (rc 0) / `FAIL` (rc 1) / `BROKEN` (rc 2). A
 * degenerate population — zero fact edges in vault mode, zero descriptors, or
 * `--self` naming an unregistered AssetSpace — is BROKEN, never clean: a
 * gate that says "covered" over an empty input is indistinguishable from a
 * dead collector.
 *
 * `--self <owner/repo>` is the per-repo CI mode (N2, `exoas-ci`): only fact
 * edges whose source is self are judged, and a definition-tier reference from
 * self that resolves to NO asset in the (merged) vault counts as uncovered —
 * in the merged vault "target absent" ⟺ "not in the resolved closure".
 * ⛔ Known N2 limitation, named here as the frame requires: a per-repo run
 * fires on the AssetSpace repo's push, so it cannot observe a declaration
 * being DELETED from the registry — that is the N1/N3 side.
 */

/** UUID-shaped reference (bare or wikilink inner). */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Bare symbolic label (`prefix__Local`) — the RDF engine emits such a string as
 * a symbolic IRI, so it IS a reference even without wikilink brackets. Anything
 * else without brackets (`xsd:string`, `URL`, `1`) is a literal, not a fact.
 */
const SYMBOLIC_LABEL_RE = /^[A-Za-z][A-Za-z0-9-]*__[A-Za-z0-9_-]+$/;

/** `assetspaces/<owner>/<repo>/…` → the owner/repo segments. */
const ASSETSPACE_PATH_RE = /^assetspaces\/([^/]+)\/([^/]+)\//;

/**
 * Definition-tier predicates — the ones by which an ontology/TBox declares a
 * dependency on a FOREIGN definition. Identical to `TIER_DEFS` of the
 * reference detector `assetspace-cycle-detect.py` so both measurers count the
 * same population (RFC 306dcb5c §Гейт, R3).
 */
export const DEFINITION_TIER_PREDICATES: readonly string[] = [
  "exo__Ontology_imports",
  "exo__Ontology_admits",
  "exo__Property_range",
  "exo__Property_domain",
  "exo__Class_superClass",
  "exo__Property_superProperty",
  "exo__Property_cardinality",
  "exo__Property_minCount",
];

/** `exo__DependencyKind` enum members (TBox `exoas-exo`). */
export const DEPENDENCY_KIND_TBOX_UID = "e1d7fb5c-d334-448d-935b-953b7b033e78";
export const DEPENDENCY_KIND_REFERENCE_UID =
  "fe529085-5370-4ac0-bbe4-1c7351242dee";

export type DependencyKindLabel = "TBox" | "Reference" | "unkinded" | "unknown";

const MAX_EXAMPLES = 5;
const MAX_LISTED = 200;

/**
 * Derive the `owner/repo` AssetSpace key of a vault-relative path from its
 * `assetspaces/<owner>/<repo>/` prefix (lower-cased to match
 * {@link ownerRepoSlug}). `null` for anything outside an assetspace folder.
 */
export function assetspaceOfPath(relPath: string): string | null {
  const m = ASSETSPACE_PATH_RE.exec(relPath.replace(/\\/g, "/"));
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}

/** One registry descriptor as this audit needs it. */
export interface DependsDescriptor {
  uid: string;
  /** `owner/repo` derived from `exo__AssetSpace_source`; null if underivable. */
  slug: string | null;
  label: string;
  path: string;
  /** Raw `exo__AssetSpace_dependsOn` target UIDs (direct edges only). */
  dependsOn: string[];
  kind: DependencyKindLabel;
}

export interface FactEdge {
  source: string;
  target: string;
  /** Distinct (asset, predicate, reference) occurrences behind this edge. */
  occurrences: number;
  /** Occurrences per definition-tier predicate. */
  predicates: Record<string, number>;
  /** Up to {@link MAX_EXAMPLES} `<sourcePath> --<predicate>--> <ref>`. */
  examples: string[];
  /** target ∈ direct `dependsOn` of source. */
  coveredDirect: boolean;
  /** target ∈ transitive `dependsOn` closure of source (THE verdict input). */
  coveredByClosure: boolean;
}

export interface UnresolvedRef {
  source: string;
  sourcePath: string;
  predicate: string;
  ref: string;
  /** `ambiguous` = ≥2 distinct candidates (counted, never guessed). */
  reason: "not-found" | "ambiguous";
}

export interface DeclaredEdge {
  source: string;
  target: string;
  targetKind: DependencyKindLabel;
  /** true ⟺ at least one definition-tier fact edge source→target exists. */
  hasFact: boolean;
}

export type DependsVerdict = "OK" | "FAIL" | "BROKEN";

export interface AssetSpaceDependsResult {
  /** The vault measured — the scope label every number belongs to. */
  vaultPath: string;
  /** Where descriptors came from: an explicit `--registry` path or the vault(s). */
  registrySource: string;
  self: string | null;
  verdict: DependsVerdict;
  brokenReason: string | null;
  descriptors: {
    count: number;
    /** Descriptors whose `exo__AssetSpace_source` yields no owner/repo (unkeyable). */
    sourceless: string[];
    /** Same owner/repo on ≥2 descriptor UIDs (registry data error). */
    duplicateSlugs: Array<{ slug: string; uids: string[] }>;
    declaredEdgeCount: number;
    carriers: number;
    targets: number;
    /** `dependsOn` refs that resolve to no descriptor (dangling). */
    danglingDeclarations: Array<{ source: string; ref: string }>;
  };
  facts: {
    /** Distinct cross-AssetSpace fact edges (source→target pairs). */
    edgeCount: number;
    occurrences: number;
    sources: number;
    targets: number;
    /** Canary: edges covered by closure. Zero with edgeCount>0 ⇒ suspect the walk. */
    coveredByClosure: number;
    /** Informational — NOT the criterion. */
    uncoveredDirect: number;
    /** THE criterion (includes unresolved refs when `--self`). */
    uncoveredByClosure: number;
    edges: FactEdge[];
  };
  unresolved: {
    count: number;
    /** true in `--self` mode: an absent target is an uncovered edge. */
    countedAsUncovered: boolean;
    refs: UnresolvedRef[];
  };
  /** Definition-tier references whose target lives outside `assetspaces/` (skipped). */
  targetsOutsideAssetspaces: number;
  /** Assets scanned as fact sources (in `--self`: only self's). */
  scannedSources: number;
  /**
   * Declarations with no definition-tier fact behind them, LISTED ONLY when the
   * target's `dependsOnKind` is TBox / absent / unknown — a possibly stale
   * declaration worth a look. One-sided: never a violation.
   */
  declaredWithoutFact: {
    total: number;
    byKind: Record<Exclude<DependencyKindLabel, "Reference">, number>;
    edges: DeclaredEdge[];
  };
  /**
   * Declarations whose target is `DependencyKindReference` — packaging by
   * definition (frame p.4): a Reference target carries no definitions, so a
   * missing definition-tier fact is EXPECTED there. Counted, never listed as
   * "without fact".
   */
  packaging: number;
  /** Declared `dependsOn` targets lacking `exo__AssetSpace_dependsOnKind` (closes the CLASS of task 41cf584d). */
  targetsWithoutKind: string[];
  clean: boolean;
}

export interface ScanAssetSpaceDependsOptions {
  /**
   * The ONE vault root (absolute). A vault is an environment (RFC eacf04c0 —
   * the cross-vault union was retired): whatever must resolve is mounted here,
   * and every printed number carries this vault as its scope label.
   */
  vault: string;
  /** Registry checkout to read descriptors from (default: the vault). */
  registry?: string;
  /** Per-repo mode: judge only fact edges whose source is this owner/repo. */
  self?: string;
}

/** Resolution index over the vault (UID · exact path · label/alias · basename). */
class VaultIndex {
  readonly assets: IndexedAsset[] = [];
  private readonly uidToPath = new Map<string, string>();
  private readonly pathSet = new Set<string>();
  private readonly labelToPaths = new Map<string, Set<string>>();
  private readonly basenameToPaths = new Map<string, Set<string>>();

  add(asset: IndexedAsset): void {
    const rel = asset.path.replace(/\\/g, "/");
    this.assets.push({ ...asset, path: rel });
    this.pathSet.add(rel);
    const uidRaw = asset.metadata["exo__Asset_uid"];
    for (const u of Array.isArray(uidRaw) ? uidRaw : [uidRaw]) {
      if (typeof u === "string") {
        const key = u.trim().toLowerCase();
        if (key.length > 0 && !this.uidToPath.has(key))
          this.uidToPath.set(key, rel);
      }
    }
    const base = rel.slice(rel.lastIndexOf("/") + 1).replace(/\.md$/, "");
    addTo(this.basenameToPaths, base, rel);
    const label = asset.metadata["exo__Asset_label"];
    if (typeof label === "string" && label.trim().length > 0) {
      addTo(this.labelToPaths, label.trim(), rel);
    }
    const aliases = asset.metadata["aliases"];
    for (const a of Array.isArray(aliases) ? aliases : [aliases]) {
      if (typeof a === "string" && a.trim().length > 0)
        addTo(this.labelToPaths, a.trim(), rel);
    }
  }

  /**
   * Three-channel resolution (mirrors the reference detector): UID → exact
   * path → label/alias (symbolic form) → basename. Distinct candidates are
   * de-duplicated by UID (a duplicate mount of one asset is ONE candidate, not
   * an ambiguity); ≥2 distinct UIDs = ambiguous, counted never guessed.
   */
  resolve(ref: string): string | "ambiguous" | null {
    let target = ref;
    if (UUID_RE.test(target))
      return this.uidToPath.get(target.toLowerCase()) ?? null;
    if (target.includes("/")) {
      const cleaned = target.replace(/^\//, "");
      const candidate = cleaned.endsWith(".md") ? cleaned : `${cleaned}.md`;
      if (this.pathSet.has(candidate)) return candidate;
      target = cleaned.slice(cleaned.lastIndexOf("/") + 1);
    }
    if (target.endsWith(".md")) target = target.slice(0, -3);
    const byLabel = this.pick(this.labelToPaths.get(target));
    if (byLabel !== null) return byLabel;
    return this.pick(this.basenameToPaths.get(target));
  }

  private pick(paths: Set<string> | undefined): string | "ambiguous" | null {
    if (!paths || paths.size === 0) return null;
    if (paths.size === 1) return [...paths][0];
    // De-dup by asset UID: a duplicate mount of the same asset is one target.
    const uids = new Set<string>();
    let first: string | null = null;
    for (const p of paths) {
      const asset = this.assets.find((a) => a.path === p);
      const u = asset ? asset.metadata["exo__Asset_uid"] : undefined;
      const key = typeof u === "string" ? u.trim().toLowerCase() : `path:${p}`;
      uids.add(key);
      if (first === null) first = p;
    }
    return uids.size === 1 ? first : "ambiguous";
  }
}

function addTo(
  map: Map<string, Set<string>>,
  key: string,
  value: string,
): void {
  const set = map.get(key);
  if (set) set.add(value);
  else map.set(key, new Set([value]));
}

function firstString(value: unknown): string | null {
  if (Array.isArray(value)) {
    const s = value.find((v) => typeof v === "string");
    return typeof s === "string" ? s : null;
  }
  return typeof value === "string" ? value : null;
}

function kindOf(rawKind: unknown): DependencyKindLabel {
  const refs = parseWikilinkArray(rawKind);
  if (refs.length === 0) return "unkinded";
  const uid = refs[0].toLowerCase();
  if (uid === DEPENDENCY_KIND_TBOX_UID) return "TBox";
  if (uid === DEPENDENCY_KIND_REFERENCE_UID) return "Reference";
  return "unknown";
}

/**
 * Turn one frontmatter value into reference strings. Wikilinks yield their
 * linkpath (alias + anchor stripped); a bare string is a reference only when
 * it is a symbolic label (`prefix__Local`) or UUID-shaped.
 */
function referencesOf(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : value === undefined || value === null
      ? []
      : [value];
  const refs: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim().replace(/^["']|["']$/g, "");
    const isWikilink = trimmed.startsWith("[[") && trimmed.endsWith("]]");
    const inner = extractAssetReference(trimmed);
    if (!inner) continue;
    const linkpath = inner.split("#")[0].trim();
    if (linkpath.length === 0) continue;
    if (
      isWikilink ||
      UUID_RE.test(linkpath) ||
      SYMBOLIC_LABEL_RE.test(linkpath)
    ) {
      refs.push(linkpath);
    }
  }
  return refs;
}

function collectDescriptors(
  assets: IndexedAsset[],
): Map<string, DependsDescriptor> {
  const out = new Map<string, DependsDescriptor>();
  for (const asset of assets) {
    if (isNodeModulesPath(asset.path) || isTemplatesPath(asset.path)) continue;
    const classes = parseWikilinkArray(asset.metadata["exo__Instance_class"]);
    if (!classes.some((c) => c.toLowerCase() === ASSET_SPACE_CLASS_UID))
      continue;
    const uid = firstString(asset.metadata["exo__Asset_uid"]);
    if (!uid) continue;
    const key = uid.trim().toLowerCase();
    if (out.has(key)) continue; // first-wins (the same registry mounted twice)
    const source =
      firstString(asset.metadata["exo__AssetSpace_source"]) ??
      firstString(asset.metadata["exo__AssetSpace_git"]);
    out.set(key, {
      uid: key,
      slug: source ? ownerRepoSlug(source) : null,
      label: firstString(asset.metadata["exo__Asset_label"]) ?? asset.path,
      path: asset.path,
      dependsOn: parseWikilinkArray(
        asset.metadata["exo__AssetSpace_dependsOn"],
      ).map((d) => d.toLowerCase()),
      kind: kindOf(asset.metadata["exo__AssetSpace_dependsOnKind"]),
    });
  }
  return out;
}

/**
 * Core scan — pure over the filesystem, no graph state. Builds the union index,
 * collects descriptors (explicit registry or the vault(s)), derives fact
 * edges, and classifies each against the declared closure.
 */
export async function scanAssetSpaceDepends(
  options: ScanAssetSpaceDependsOptions,
): Promise<AssetSpaceDependsResult> {
  const index = new VaultIndex();
  const seenUids = new Set<string>();
  const adapter = new CachingNodeFsAdapter(options.vault, {
    cacheContent: false,
  });
  for (const asset of await adapter.indexedAssets()) {
    if (isNodeModulesPath(asset.path) || isTemplatesPath(asset.path)) continue;
    // An asset mounted twice inside one vault (registry mounted under two
    // profiles, a stale duplicate) is ONE asset: first-wins by UID so its
    // references are not counted once per mount.
    const uid = firstString(asset.metadata["exo__Asset_uid"]);
    const dedupKey = uid ? uid.trim().toLowerCase() : `path:${asset.path}`;
    if (seenUids.has(dedupKey)) continue;
    seenUids.add(dedupKey);
    index.add(asset);
  }

  // ---- Descriptors (declarations) ----
  let registrySource: string;
  let descriptors: Map<string, DependsDescriptor>;
  if (options.registry) {
    const regAdapter = new CachingNodeFsAdapter(options.registry, {
      cacheContent: false,
    });
    descriptors = collectDescriptors(await regAdapter.indexedAssets());
    registrySource = options.registry;
  } else {
    descriptors = collectDescriptors(index.assets);
    registrySource = "vault";
  }

  const slugByUid = new Map<string, string>();
  const sourceless: string[] = [];
  const slugOwners = new Map<string, string[]>();
  for (const d of descriptors.values()) {
    if (d.slug === null) {
      sourceless.push(d.label);
      continue;
    }
    slugByUid.set(d.uid, d.slug);
    const owners = slugOwners.get(d.slug);
    if (owners) owners.push(d.uid);
    else slugOwners.set(d.slug, [d.uid]);
  }
  const duplicateSlugs = [...slugOwners.entries()]
    .filter(([, uids]) => uids.length > 1)
    .map(([slug, uids]) => ({ slug, uids }));

  const kindBySlug = new Map<string, DependencyKindLabel>();
  for (const d of descriptors.values())
    if (d.slug) kindBySlug.set(d.slug, d.kind);

  const declared = new Map<string, string[]>(); // slug → direct target slugs
  const danglingDeclarations: Array<{ source: string; ref: string }> = [];
  let declaredEdgeCount = 0;
  const declaredTargets = new Set<string>();
  for (const d of descriptors.values()) {
    if (d.slug === null) continue;
    for (const depUid of d.dependsOn) {
      const targetSlug = slugByUid.get(depUid);
      if (targetSlug === undefined) {
        danglingDeclarations.push({ source: d.slug, ref: depUid });
        continue;
      }
      if (targetSlug === d.slug) continue; // self-edge: inert
      let list = declared.get(d.slug);
      if (!list) {
        list = [];
        declared.set(d.slug, list);
      }
      if (!list.includes(targetSlug)) {
        list.push(targetSlug);
        declaredEdgeCount++;
        declaredTargets.add(targetSlug);
      }
    }
  }

  // ---- Self (per-repo) mode ----
  let selfSlug: string | null = null;
  if (options.self !== undefined) {
    selfSlug = ownerRepoSlug(options.self);
    if (selfSlug === null) selfSlug = options.self.trim().toLowerCase();
  }

  // ---- Facts (definition tier) ----
  const closureCache = new Map<string, Set<string>>();
  const closureOf = (slug: string): Set<string> => {
    const cached = closureCache.get(slug);
    if (cached !== undefined) return cached;
    // The SAME primitive resolve-deps / profile-apply walk (#3511): the gate
    // can never be stricter than the mechanism it guards.
    const c = transitiveDependsOnClosure([slug], declared);
    closureCache.set(slug, c);
    return c;
  };

  const edgeMap = new Map<string, FactEdge>();
  const unresolvedRefs: UnresolvedRef[] = [];
  let unresolvedCount = 0;
  let targetsOutsideAssetspaces = 0;
  let scannedSources = 0;
  let occurrencesTotal = 0;

  for (const asset of index.assets) {
    const sourceSlug = assetspaceOfPath(asset.path);
    if (sourceSlug === null) continue;
    if (selfSlug !== null && sourceSlug !== selfSlug) continue;
    scannedSources++;
    for (const predicate of DEFINITION_TIER_PREDICATES) {
      const refs = referencesOf(asset.metadata[predicate]);
      for (const ref of refs) {
        const resolved = index.resolve(ref);
        if (resolved === null || resolved === "ambiguous") {
          unresolvedCount++;
          if (unresolvedRefs.length < MAX_LISTED) {
            unresolvedRefs.push({
              source: sourceSlug,
              sourcePath: asset.path,
              predicate,
              ref,
              reason: resolved === "ambiguous" ? "ambiguous" : "not-found",
            });
          }
          continue;
        }
        const targetSlug = assetspaceOfPath(resolved);
        if (targetSlug === null) {
          targetsOutsideAssetspaces++;
          continue;
        }
        if (targetSlug === sourceSlug) continue; // internal — not a fact edge
        occurrencesTotal++;
        const key = `${sourceSlug} ${targetSlug}`;
        let edge = edgeMap.get(key);
        if (!edge) {
          edge = {
            source: sourceSlug,
            target: targetSlug,
            occurrences: 0,
            predicates: {},
            examples: [],
            coveredDirect:
              declared.get(sourceSlug)?.includes(targetSlug) ?? false,
            coveredByClosure: closureOf(sourceSlug).has(targetSlug),
          };
          edgeMap.set(key, edge);
        }
        edge.occurrences++;
        edge.predicates[predicate] = (edge.predicates[predicate] ?? 0) + 1;
        if (edge.examples.length < MAX_EXAMPLES) {
          edge.examples.push(`${asset.path} --${predicate}--> ${ref}`);
        }
      }
    }
  }

  const edges = [...edgeMap.values()].sort(
    (a, b) =>
      Number(a.coveredByClosure) - Number(b.coveredByClosure) ||
      Number(a.coveredDirect) - Number(b.coveredDirect) ||
      a.source.localeCompare(b.source) ||
      a.target.localeCompare(b.target),
  );
  const coveredByClosure = edges.filter((e) => e.coveredByClosure).length;
  const uncoveredDirect = edges.filter((e) => !e.coveredDirect).length;
  const countedAsUncovered = selfSlug !== null;
  const uncoveredByClosure =
    edges.filter((e) => !e.coveredByClosure).length +
    (countedAsUncovered ? unresolvedCount : 0);

  // ---- Declared without fact (one-sided: informational) ----
  const factKeys = new Set(edges.map((e) => `${e.source} ${e.target}`));
  const declaredEdges: DeclaredEdge[] = [];
  const byKind: Record<Exclude<DependencyKindLabel, "Reference">, number> = {
    TBox: 0,
    unkinded: 0,
    unknown: 0,
  };
  let packaging = 0;
  for (const [source, targets] of declared) {
    if (selfSlug !== null && source !== selfSlug) continue;
    for (const target of targets) {
      const targetKind = kindBySlug.get(target) ?? "unknown";
      if (targetKind === "Reference") {
        // Packaging by definition (frame p.4): never "without fact".
        packaging++;
        continue;
      }
      const hasFact = factKeys.has(`${source} ${target}`);
      if (!hasFact) {
        declaredEdges.push({ source, target, targetKind, hasFact });
        byKind[targetKind]++;
      }
    }
  }
  declaredEdges.sort(
    (a, b) =>
      a.source.localeCompare(b.source) || a.target.localeCompare(b.target),
  );
  const targetsWithoutKind = [...declaredTargets]
    .filter((slug) => (kindBySlug.get(slug) ?? "unknown") === "unkinded")
    .sort();

  // ---- Verdict (three outcomes) ----
  let verdict: DependsVerdict;
  let brokenReason: string | null = null;
  if (descriptors.size === 0) {
    verdict = "BROKEN";
    brokenReason = `no exo__AssetSpace descriptor found (registry: ${registrySource}) — nothing to judge against`;
  } else if (selfSlug !== null && !slugOwners.has(selfSlug)) {
    verdict = "BROKEN";
    brokenReason = `--self '${options.self}' (${selfSlug}) is not a registered AssetSpace (${descriptors.size} descriptor(s) scanned)`;
  } else if (selfSlug !== null && scannedSources === 0) {
    verdict = "BROKEN";
    brokenReason = `--self '${selfSlug}': no asset under assetspaces/${selfSlug}/ in the vault — the self content was not merged`;
  } else if (selfSlug === null && edges.length === 0) {
    verdict = "BROKEN";
    brokenReason =
      "zero definition-tier cross-AssetSpace fact edges — an empty population cannot be declared covered";
  } else {
    verdict = uncoveredByClosure === 0 ? "OK" : "FAIL";
  }

  return {
    vaultPath: options.vault,
    registrySource,
    self: selfSlug,
    verdict,
    brokenReason,
    descriptors: {
      count: descriptors.size,
      sourceless,
      duplicateSlugs,
      declaredEdgeCount,
      carriers: declared.size,
      targets: declaredTargets.size,
      danglingDeclarations,
    },
    facts: {
      edgeCount: edges.length,
      occurrences: occurrencesTotal,
      sources: new Set(edges.map((e) => e.source)).size,
      targets: new Set(edges.map((e) => e.target)).size,
      coveredByClosure,
      uncoveredDirect,
      uncoveredByClosure,
      edges,
    },
    unresolved: {
      count: unresolvedCount,
      countedAsUncovered,
      refs: unresolvedRefs,
    },
    targetsOutsideAssetspaces,
    scannedSources,
    declaredWithoutFact: {
      total: declaredEdges.length,
      byKind,
      edges: declaredEdges,
    },
    packaging,
    targetsWithoutKind,
    clean: verdict === "OK",
  };
}

function formatPredicates(p: Record<string, number>): string {
  return Object.entries(p)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k, v]) => `${k.replace(/^exo__/, "")}×${v}`)
    .join(", ");
}

function printText(result: AssetSpaceDependsResult): void {
  const log = result.verdict === "OK" ? console.log : console.error;
  const vaultName =
    result.vaultPath.replace(/\/+$/, "").split("/").pop() ?? result.vaultPath;
  const scopeLabel = `[${vaultName}${result.self ? `, self=${result.self}` : ""}, tier=definitions]`;

  log(
    `${result.verdict} ${result.vaultPath}: assetspace-depends audit ${scopeLabel} — ` +
      `uncovered by CLOSURE: ${result.facts.uncoveredByClosure} (verdict), ` +
      `uncovered DIRECTLY: ${result.facts.uncoveredDirect} (informational, not a criterion)`,
  );
  if (result.brokenReason) log(`⛔ BROKEN: ${result.brokenReason}`);
  log(
    `Registry (${result.registrySource}): ${result.descriptors.count} descriptor(s), ` +
      `declared dependsOn edges: ${result.descriptors.declaredEdgeCount} ` +
      `(carriers ${result.descriptors.carriers} → targets ${result.descriptors.targets}), ` +
      `dangling: ${result.descriptors.danglingDeclarations.length}, ` +
      `sourceless: ${result.descriptors.sourceless.length}, duplicate owner/repo: ${result.descriptors.duplicateSlugs.length}`,
  );
  log(
    `Facts (definition tier, ${DEFINITION_TIER_PREDICATES.length} predicates): ` +
      `${result.facts.edgeCount} cross-AssetSpace edge(s) / ${result.facts.occurrences} occurrence(s) ` +
      `(sources ${result.facts.sources} → targets ${result.facts.targets}, scanned ${result.scannedSources} source asset(s)); ` +
      `canary covered-by-closure = ${result.facts.coveredByClosure}`,
  );
  log(
    `Unresolved definition-tier refs: ${result.unresolved.count} ` +
      (result.unresolved.countedAsUncovered
        ? "(--self: counted as uncovered — target absent from the merged vault)"
        : "(fail-open, listed, NOT counted — validate-wikilinks territory)") +
      `; targets outside assetspaces/: ${result.targetsOutsideAssetspaces}`,
  );
  log(
    `Declared without a definition-tier fact (one-sided, never a violation; Reference-kind targets excluded): ` +
      `${result.declaredWithoutFact.total} — TBox: ${result.declaredWithoutFact.byKind.TBox}, ` +
      `unkinded: ${result.declaredWithoutFact.byKind.unkinded}, unknown-kind: ${result.declaredWithoutFact.byKind.unknown}; ` +
      `packaging declarations (Reference-kind targets, frame p.4): ${result.packaging}`,
  );
  log(
    `Declared targets without exo__AssetSpace_dependsOnKind: ${result.targetsWithoutKind.length}` +
      (result.targetsWithoutKind.length > 0
        ? ` — ${result.targetsWithoutKind.join(", ")}`
        : ""),
  );
  log(
    `Declared-graph cycles are NOT judged by this verb (dependsOn = packaging, RFC 306dcb5c frame p.1); ` +
      `facts-graph acyclicity is the scheduled detector's job.`,
  );

  const uncovered = result.facts.edges.filter((e) => !e.coveredByClosure);
  if (uncovered.length > 0) {
    console.error(
      `\nUNCOVERED by closure (src → tgt, occurrences, predicates):`,
    );
    for (const e of uncovered) {
      console.error(
        `  ${e.source} → ${e.target}: ${e.occurrences} [${formatPredicates(e.predicates)}]`,
      );
      for (const ex of e.examples) console.error(`      ${ex}`);
    }
  }
  if (result.unresolved.refs.length > 0) {
    const w = result.unresolved.countedAsUncovered ? console.error : log;
    w(`\nUnresolved definition-tier references (${result.unresolved.count}):`);
    for (const u of result.unresolved.refs.slice(0, 50)) {
      w(
        `  ${u.source}: ${u.sourcePath} --${u.predicate}--> ${u.ref} (${u.reason})`,
      );
    }
    if (result.unresolved.count > 50)
      w(`  … ${result.unresolved.count - 50} more`);
  }
  const directOnly = result.facts.edges.filter(
    (e) => e.coveredByClosure && !e.coveredDirect,
  );
  if (directOnly.length > 0) {
    log(
      `\nCovered transitively only (informational — not required, not forbidden):`,
    );
    for (const e of directOnly)
      log(`  ${e.source} → ${e.target}: ${e.occurrences}`);
  }
  if (result.declaredWithoutFact.edges.length > 0) {
    log(`\nDeclared without a definition-tier fact (informational):`);
    for (const d of result.declaredWithoutFact.edges) {
      log(`  ${d.source} → ${d.target} [${d.targetKind}]`);
    }
  }
  if (result.descriptors.danglingDeclarations.length > 0) {
    log(
      `\nDangling dependsOn declarations (no descriptor for the target UID):`,
    );
    for (const d of result.descriptors.danglingDeclarations)
      log(`  ${d.source} → ${d.ref}`);
  }
}

export interface AuditAssetSpaceDependsOptions {
  vault: string;
  registry?: string;
  self?: string;
  output?: OutputFormat;
}

function assertDirectory(p: string): string {
  const abs = resolve(p);
  if (!existsSync(abs) || !statSync(abs).isDirectory())
    throw new VaultNotFoundError(abs);
  return abs;
}

/**
 * `exocortex audit assetspace-depends --vault <path> [--registry <path>]
 * [--self <owner/repo>] [--output text|json]`
 *
 * Exit 0 = OK (uncovered by closure = 0), 1 = FAIL, 2 = BROKEN (degenerate
 * population — never reported as clean).
 */
export function auditAssetSpaceDependsCommand(): Command {
  return new Command("assetspace-depends")
    .description(
      "Coverage gate for exo__AssetSpace_dependsOn (RFC 306dcb5c): every definition-tier cross-AssetSpace reference must have its target in the source AssetSpace's declared transitive closure. Prints uncovered-by-closure (verdict) AND uncovered-directly (informational); one-sided (declarations without facts are never violations); no cycle check on the declared graph; BROKEN (exit 2) on an empty population. --self <owner/repo> = per-repo CI mode (unresolvable targets count as uncovered).",
    )
    .requiredOption(
      "--vault <path>",
      "The ONE vault root measured (a canonical vault, or the CI merged vault) — every number carries it as its scope label",
    )
    .option(
      "--registry <path>",
      "Registry checkout holding the exo__AssetSpace descriptors (default: descriptors found in the vault(s))",
    )
    .option(
      "--self <owner/repo>",
      "Per-repo mode: judge only fact edges whose source is this AssetSpace (github.repository form); unresolvable definition-tier refs count as uncovered",
    )
    .option("--output <type>", "Response format: text|json", "text")
    .action(async (options: AuditAssetSpaceDependsOptions) => {
      const outputFormat = (options.output ?? "text") as OutputFormat;
      ErrorHandler.setFormat(outputFormat);
      try {
        const vault = assertDirectory(options.vault);
        const registry = options.registry
          ? assertDirectory(options.registry)
          : undefined;

        const result = await scanAssetSpaceDepends({
          vault,
          registry,
          self: options.self,
        });

        if (outputFormat === "json") {
          console.log(JSON.stringify(result, null, 2));
        } else {
          printText(result);
        }

        if (result.verdict === "BROKEN") process.exitCode = 2;
        else if (result.verdict === "FAIL") process.exitCode = 1;
      } catch (error) {
        ErrorHandler.handle(error as Error);
      }
    });
}
