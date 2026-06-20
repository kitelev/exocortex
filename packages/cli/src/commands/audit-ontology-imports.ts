import { Command } from "commander";
import { existsSync, statSync } from "fs";
import { resolve } from "path";
import { extractAssetReference } from "exocortex";
import { CachingNodeFsAdapter } from "../adapters/CachingNodeFsAdapter.js";
import { findReferencedFile } from "../executors/folderRepairHelpers.js";
import {
  tarjanSCC,
  transitiveClosure,
  condense,
  transitiveReduction,
  greedyFeedbackArcSet,
  type AdjacencyMap,
  type WeightedEdge,
} from "../services/ontologyImportsGraph.js";
import { extractFileWikilinkTargets } from "../services/wikilinkExtraction.js";
import { resolveTargetPath } from "../services/ontologyImportsResolve.js";
import {
  isNodeModulesPath,
  isTemplatesPath,
} from "../utils/vaultPathFilters.js";
import { ErrorHandler, type OutputFormat } from "../utils/ErrorHandler.js";
import { VaultNotFoundError } from "../utils/errors/index.js";

/** `exo__Ontology` class UID — an ontology is any asset instancing it. */
export const ONTOLOGY_CLASS_UID = "829b9b3b-6fc3-4276-be6a-27d3398c012e";

/**
 * EKA Phase B / Vision de77fe27 VL#30 — curated associative (Zettelkasten /
 * provenance) frontmatter predicates excluded from edge extraction under
 * `--structural-only`. These are an orthogonal linking layer, NOT
 * import/dependency edges, so they should not constitute the import-DAG nor
 * the SCC. Excluding them isolates the STRUCTURAL backbone (superClass,
 * Instance_class, domain/range, isDefinedBy, …) for re-layering analysis.
 *
 * Opt-in only — never applied by default, so the default audit output stays
 * byte-identical. The set is extensible at the CLI via `--exclude-predicate`.
 */
export const ASSOCIATIVE_PREDICATES: readonly string[] = [
  "exo__Asset_relates",
  "ims__Concept_related",
  "ims__Concept_broader",
  "ims__Concept_synonym",
  "exo__Asset_createdBy",
];

/**
 * Why an asset has no valid ontology. Per RFC df39007b VL#6 these are NOT
 * fail-open skips (unlike broken wikilinks) — they are reported as a distinct
 * data-gap category (closed by migration Phase 4), informational for the
 * exit code of THIS audit (whose violations are link-level).
 */
export type NoOntologyReason =
  | "empty-isDefinedBy"
  | "bang-prefix"
  | "unresolvable"
  | "not-an-ontology";

/**
 * Fail-open link skips (RFC VL#6/R5): counted with reasons, never violations.
 * - broken: target resolves nowhere in this vault (validate-wikilinks zone).
 * - dup-basename: ≥2 files share the basename — ambiguity is counted, not
 *   guessed (R5).
 * - non-markdown: media/canvas embeds — not asset-graph edges.
 */
export type LinkSkipReason = "broken" | "dup-basename" | "non-markdown";

export interface OntologyRef {
  uid: string;
  label: string;
  path: string;
}

/** Per-ontology report entry (per-ontology stats are an AC of `--output json`). */
export interface OntologyReport extends OntologyRef {
  /** Resolved ontology UIDs declared via `exo__Ontology_imports`. */
  declaredImports: string[];
  /** Raw declared import refs that resolve to nothing / to a non-ontology (R7). */
  unresolvedImports: string[];
  /** R7: self-import declared — warning, excluded from the graph. */
  selfImport: boolean;
  /** Assets mapped to this ontology via isDefinedBy (templates excluded). */
  assetCount: number;
  /** Distinct incoming/outgoing derived edges. */
  inDegree: number;
  outDegree: number;
  /** Link occurrences staying inside this ontology. */
  internalLinks: number;
  /** Cross-ontology occurrences out of / into this ontology (valid + violating). */
  externalLinksOut: number;
  externalLinksIn: number;
  /** Violating subset of externalLinksOut. */
  violatingOut: number;
}

export interface DerivedEdge {
  source: string;
  target: string;
  occurrences: number;
  /** true ⟺ target ∈ transitive closure of source's declared imports. */
  valid: boolean;
}

export interface ViolationPair {
  source: OntologyRef;
  target: OntologyRef;
  occurrences: number;
  /** Up to {@link MAX_EXAMPLES} source files containing offending links. */
  examples: string[];
}

export interface OntologyImportsResult {
  vaultPath: string;
  totalFiles: number;
  /** Files actually scanned as link sources (templates/node_modules excluded). */
  scannedFiles: number;
  ontologies: OntologyReport[];
  /** R7 hard error: same ontology UID on ≥2 files. Forces exit 1. */
  duplicateOntologyUids: Array<{ uid: string; paths: string[] }>;
  declared: {
    edgeCount: number;
    /** Cycles (SCCs of size ≥2) in the declared imports graph. */
    sccs: string[][];
    acyclic: boolean;
  };
  /** Full derived graph — every cross-ontology edge with occurrence count. */
  derivedEdges: DerivedEdge[];
  /** Violating pairs grouped src→tgt, sorted by occurrences desc (VL#8). */
  violations: ViolationPair[];
  /**
   * Always empty (POST-3, RFC eacf04c0): cross-vault classification was removed
   * with the cross-vault flag. Links whose target resolves nowhere in the vault
   * are counted in {@link skips}.broken (fail-open, VL#6). Retained for
   * output-shape backward compatibility.
   */
  crossVault: ViolationPair[];
  linkCounts: {
    total: number;
    internal: number;
    crossOntologyValid: number;
    crossOntologyViolation: number;
    crossVault: number;
    /** Occurrences whose source or target asset lacks a valid ontology. */
    noOntology: number;
  };
  skips: Record<LinkSkipReason, number>;
  skipExamples: Record<LinkSkipReason, string[]>;
  noOntologyAssets: {
    count: number;
    byReason: Record<NoOntologyReason, number>;
    examples: string[];
  };
  warnings: {
    selfImports: string[];
    multipleIsDefinedBy: number;
    ontologiesWithoutUid: string[];
  };
  /**
   * true ⟺ 0 violating occurrences AND 0 cross-vault AND declared graph
   * acyclic AND no duplicate-UID hard errors. No-ontology assets and fail-open
   * skips are reported but do not affect cleanliness (they are Phase-4 data
   * gaps / validate-wikilinks territory, not imports-invariant violations).
   */
  clean: boolean;
  /**
   * EKA Phase B / VL#30 — present only when edge extraction excluded one or
   * more associative predicates (`--structural-only` / `--exclude-predicate`).
   * Absent in the default run, so the default JSON output is byte-identical.
   */
  excludedPredicates?: string[];
  /**
   * Import-additions proposal — present only with `--propose-imports`
   * ({@link computeImportProposal}). Read-only suggestion; the audit verdict
   * ({@link clean}) is unaffected.
   */
  proposal?: ImportProposal;
}

/** One proposed (or evidential) ontology→ontology import edge. */
export interface ProposedImport {
  source: OntologyRef;
  target: OntologyRef;
  /** Direct derived occurrences on this a→b edge (evidence / cut cost). */
  occurrences: number;
}

/** A derived-graph cycle (SCC ≥ 2) that imports cannot legitimize (Phase 3). */
export interface IntraSccComponent {
  /** Ontologies forming the strongly-connected component (label-sorted). */
  ontologies: OntologyRef[];
  /** Intra-SCC derived edges / occurrences trapped in the cycle. */
  edgeCount: number;
  occurrenceCount: number;
  /**
   * Suggested feedback-arc-set: edges to cut to break the cycle (Phase 3),
   * cheapest (lowest occurrence) first — the R1 «backward edges, min
   * link-count» heuristic.
   */
  suggestedCuts: ProposedImport[];
}

/**
 * RFC df39007b §Решение Шаг 1b — `--propose-imports` result. Additions-only:
 * {@link additions} is the minimal set of `exo__Ontology_imports` edges to add
 * so the declared closure covers the acyclic part of the derived graph;
 * declared imports are never proposed for removal (R8).
 */
export interface ImportProposal {
  /** Minimal import additions (transitive reduction of the acyclic part). */
  additions: ProposedImport[];
  /** Cross-SCC derived edges (the acyclic part the proposal must cover). */
  acyclicEdgeCount: number;
  /** Cross-SCC derived edges already covered by the declared closure. */
  alreadyCovered: number;
  /**
   * Cross-SCC derived edges that cannot be added as an import without creating
   * a cycle in the declared graph (a declared edge already points the other
   * way) — these need a Phase-3 re-home/remove, not an import.
   */
  conflicts: ProposedImport[];
  /** Derived-graph cycles needing Phase 3, each with a suggested FAS. */
  intraScc: IntraSccComponent[];
  /**
   * Declared imports that are transitively redundant (reachable without the
   * direct edge) — informational only (R8); never auto-removed.
   */
  redundantDeclared: ProposedImport[];
}

const MAX_EXAMPLES = 5;
const MAX_NO_ONTOLOGY_EXAMPLES = 10;

const NON_MARKDOWN_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico", "avif",
  "pdf", "mp3", "wav", "m4a", "ogg", "flac",
  "mp4", "mov", "webm", "avi", "mkv",
  "zip", "gz", "tar",
  "canvas", "base", "json", "css", "js", "ts", "html",
]);

function nonMarkdownExtension(target: string): boolean {
  const dot = target.lastIndexOf(".");
  if (dot === -1 || dot === target.length - 1) return false;
  const ext = target.slice(dot + 1).toLowerCase();
  return NON_MARKDOWN_EXTENSIONS.has(ext);
}

function firstString(value: unknown): { value: string | null; multiple: boolean } {
  if (Array.isArray(value)) {
    const strings = value.filter((v) => typeof v === "string");
    return { value: (strings[0] as string) ?? null, multiple: strings.length > 1 };
  }
  return { value: typeof value === "string" ? value : null, multiple: false };
}

function asRefList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  const refs: string[] = [];
  for (const item of raw) {
    const ref = extractAssetReference(item);
    if (ref) refs.push(ref);
  }
  return refs;
}

function pushExample(list: string[], example: string, cap = MAX_EXAMPLES): void {
  if (list.length < cap) list.push(example);
}

interface OntologyMeta extends OntologyRef {
  metadata: Record<string, unknown>;
}

/**
 * RFC df39007b §Решение Шаг 1 — ontology-imports invariant audit.
 *
 * Builds the asset→ontology map via `exo__Asset_isDefinedBy` (same
 * {@link findReferencedFile} resolver as `audit co-location` / `apply
 * repair-folder`), extracts every wikilink (frontmatter + body, fenced code
 * blocks excluded per R10, templates excluded per R6), resolves targets
 * UID-first with an ambiguous-basename counter (R5), and classifies each
 * occurrence against the declared `exo__Ontology_imports` transitive closure
 * (VL#2): internal / cross-ontology valid / cross-ontology violation /
 * no-ontology, with broken links fail-open skip-accounted (VL#6).
 *
 * The declared graph itself is checked for acyclicity via Tarjan SCC; R7
 * edge-cases: duplicate ontology UID = hard error, self-import = warning
 * (excluded from the graph), unresolvable import = `unresolvedImports`.
 */
export interface ScanOntologyImportsOptions {
  /**
   * EKA Phase B / Vision VL#30 (opt-in): top-level frontmatter keys
   * (predicates) whose wikilinks are NOT counted as import/dependency edges —
   * associative Zettelkasten / provenance links. Body wikilinks are never
   * predicate-attributed and stay counted (conservative). Empty/undefined ⟹
   * default behaviour (every wikilink counts), byte-identical to pre-flag
   * output. See {@link ASSOCIATIVE_PREDICATES} for the `--structural-only` set.
   */
  excludePredicates?: Iterable<string>;
}

export async function scanVaultForOntologyImports(
  vaultPath: string,
  options: ScanOntologyImportsOptions = {},
): Promise<OntologyImportsResult> {
  const adapter = new CachingNodeFsAdapter(vaultPath, { cacheContent: true });
  const assets = await adapter.indexedAssets();

  // EKA Phase B / VL#30 (opt-in): predicates excluded from edge extraction.
  // Empty ⟹ default behaviour (byte-identical pre-flag output).
  const excludeSet = new Set(options.excludePredicates ?? []);

  // ---- Phase B: ontology discovery (instances of exo__Ontology) ----
  const ontologyByPath = new Map<string, string>(); // path → uid
  const ontologyMeta = new Map<string, OntologyMeta>(); // uid → meta (first-wins)
  const uidPaths = new Map<string, string[]>(); // uid → all ontology paths (dup detection)
  const ontologiesWithoutUid: string[] = [];

  for (const asset of assets) {
    if (isNodeModulesPath(asset.path) || isTemplatesPath(asset.path)) continue;
    const classRefs = asRefList(asset.metadata["exo__Instance_class"]);
    if (!classRefs.includes(ONTOLOGY_CLASS_UID)) continue;

    const { value: uid } = firstString(asset.metadata["exo__Asset_uid"]);
    if (!uid) {
      ontologiesWithoutUid.push(asset.path);
      continue;
    }
    const { value: labelRaw } = firstString(asset.metadata["exo__Asset_label"]);
    const label = labelRaw ?? asset.path;

    const paths = uidPaths.get(uid);
    if (paths) {
      paths.push(asset.path);
    } else {
      uidPaths.set(uid, [asset.path]);
    }
    ontologyByPath.set(asset.path, uid);
    if (!ontologyMeta.has(uid)) {
      // first-wins so the report stays usable even under a dup-UID hard error
      ontologyMeta.set(uid, { uid, label, path: asset.path, metadata: asset.metadata });
    }
  }

  const duplicateOntologyUids = [...uidPaths.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([uid, paths]) => ({ uid, paths }));

  // ---- Phase C: asset→ontology map via isDefinedBy ----
  const assetOntology = new Map<string, string | null>(); // path → ontology uid | null
  const noOntologyByReason: Record<NoOntologyReason, number> = {
    "empty-isDefinedBy": 0,
    "bang-prefix": 0,
    unresolvable: 0,
    "not-an-ontology": 0,
  };
  const noOntologyExamples: string[] = [];
  let noOntologyCount = 0;
  let multipleIsDefinedBy = 0;
  const assetCountByOntology = new Map<string, number>();
  let scannedFiles = 0;

  const markNoOntology = (path: string, reason: NoOntologyReason): void => {
    assetOntology.set(path, null);
    noOntologyByReason[reason]++;
    noOntologyCount++;
    pushExample(noOntologyExamples, `${path} (${reason})`, MAX_NO_ONTOLOGY_EXAMPLES);
  };

  for (const asset of assets) {
    if (isNodeModulesPath(asset.path) || isTemplatesPath(asset.path)) continue;
    scannedFiles++;

    const rawIsDefinedBy = asset.metadata["exo__Asset_isDefinedBy"];
    const { value: first, multiple } = firstString(rawIsDefinedBy);
    if (multiple) multipleIsDefinedBy++; // R7: warning, first one is used

    const ref = extractAssetReference(first);
    if (!ref) {
      markNoOntology(asset.path, "empty-isDefinedBy");
      continue;
    }
    if (ref.startsWith("!")) {
      markNoOntology(asset.path, "bang-prefix");
      continue;
    }
    const ontologyPath = await findReferencedFile(adapter, ref, asset.path);
    if (!ontologyPath) {
      markNoOntology(asset.path, "unresolvable");
      continue;
    }
    const uid = ontologyByPath.get(ontologyPath);
    if (!uid) {
      markNoOntology(asset.path, "not-an-ontology");
      continue;
    }
    assetOntology.set(asset.path, uid);
    assetCountByOntology.set(uid, (assetCountByOntology.get(uid) ?? 0) + 1);
  }

  // ---- Phase D: declared imports graph + SCC + closure ----
  const ontologyUids = [...ontologyMeta.keys()];
  const declaredEdges: AdjacencyMap = new Map();
  const selfImports: string[] = [];
  const declaredImportsByUid = new Map<string, string[]>();
  const unresolvedImportsByUid = new Map<string, string[]>();
  let declaredEdgeCount = 0;

  for (const uid of ontologyUids) {
    const meta = ontologyMeta.get(uid)!;
    const refs = asRefList(meta.metadata["exo__Ontology_imports"]);
    const resolved: string[] = [];
    const unresolved: string[] = [];
    let selfImport = false;

    for (const ref of refs) {
      let targetUid: string | null = null;
      if (ontologyMeta.has(ref)) {
        targetUid = ref;
      } else {
        // Non-UID-form declared import — resolve to a file and require it to
        // be an ontology; anything else is an unresolved-import (R7 category).
        const targetPath = await findReferencedFile(adapter, ref, meta.path);
        targetUid = targetPath ? (ontologyByPath.get(targetPath) ?? null) : null;
      }
      if (targetUid === null) {
        unresolved.push(ref);
      } else if (targetUid === uid) {
        selfImport = true; // R7: warning, never a graph edge
      } else {
        resolved.push(targetUid);
        let set = declaredEdges.get(uid);
        if (!set) {
          set = new Set();
          declaredEdges.set(uid, set);
        }
        if (!set.has(targetUid)) {
          set.add(targetUid);
          declaredEdgeCount++;
        }
      }
    }

    declaredImportsByUid.set(uid, resolved);
    unresolvedImportsByUid.set(uid, unresolved);
    if (selfImport) selfImports.push(uid);
  }

  const sccs = tarjanSCC(ontologyUids, declaredEdges);
  const closure = transitiveClosure(ontologyUids, declaredEdges);

  // ---- Phase E: link scan + classification ----
  const linkCounts = {
    total: 0,
    internal: 0,
    crossOntologyValid: 0,
    crossOntologyViolation: 0,
    crossVault: 0,
    noOntology: 0,
  };
  const skips: Record<LinkSkipReason, number> = {
    broken: 0,
    "dup-basename": 0,
    "non-markdown": 0,
  };
  const skipExamples: Record<LinkSkipReason, string[]> = {
    broken: [],
    "dup-basename": [],
    "non-markdown": [],
  };
  const derivedEdgeMap = new Map<string, { source: string; target: string; occurrences: number; valid: boolean }>();
  const violationMap = new Map<string, { source: string; target: string; occurrences: number; examples: string[] }>();
  const internalByOntology = new Map<string, number>();
  const externalOutByOntology = new Map<string, number>();
  const externalInByOntology = new Map<string, number>();
  const violatingOutByOntology = new Map<string, number>();

  // Hoisted ref builder (also used by Phase F): UID → {uid,label,path}.
  const toRef = (uid: string): OntologyRef => {
    const meta = ontologyMeta.get(uid);
    return meta
      ? { uid: meta.uid, label: meta.label, path: meta.path }
      : { uid, label: uid, path: "" };
  };

  for (const asset of assets) {
    if (isNodeModulesPath(asset.path) || isTemplatesPath(asset.path)) continue;
    const sourceOntology = assetOntology.get(asset.path) ?? null;
    const targets = extractFileWikilinkTargets(
      asset.metadata,
      asset.content ?? "",
      excludeSet,
    );

    for (const target of targets) {
      linkCounts.total++;

      if (nonMarkdownExtension(target)) {
        skips["non-markdown"]++;
        pushExample(skipExamples["non-markdown"], `${asset.path} → ${target}`);
        continue;
      }

      const resolvedPath = await resolveTargetPath(adapter, target);
      if (resolvedPath === "ambiguous") {
        skips["dup-basename"]++;
        pushExample(skipExamples["dup-basename"], `${asset.path} → ${target}`);
        continue;
      }
      if (resolvedPath === null) {
        // Fail-open (VL#6): target unresolved in the vault — a broken link
        // (validate-wikilinks territory). POST-3 (RFC eacf04c0): cross-vault
        // classification was removed with the cross-vault flag, so an
        // unresolvable target is simply broken.
        skips.broken++;
        pushExample(skipExamples.broken, `${asset.path} → ${target}`);
        continue;
      }

      const targetOntology =
        assetOntology.get(resolvedPath) ??
        ontologyByPath.get(resolvedPath) ??
        null;
      if (sourceOntology === null || targetOntology === null) {
        linkCounts.noOntology++;
        continue;
      }
      if (sourceOntology === targetOntology) {
        linkCounts.internal++;
        internalByOntology.set(
          sourceOntology,
          (internalByOntology.get(sourceOntology) ?? 0) + 1,
        );
        continue;
      }

      const valid = closure.get(sourceOntology)?.has(targetOntology) ?? false;
      const edgeKey = `${sourceOntology} ${targetOntology}`;
      const edge = derivedEdgeMap.get(edgeKey);
      if (edge) {
        edge.occurrences++;
      } else {
        derivedEdgeMap.set(edgeKey, {
          source: sourceOntology,
          target: targetOntology,
          occurrences: 1,
          valid,
        });
      }
      externalOutByOntology.set(
        sourceOntology,
        (externalOutByOntology.get(sourceOntology) ?? 0) + 1,
      );
      externalInByOntology.set(
        targetOntology,
        (externalInByOntology.get(targetOntology) ?? 0) + 1,
      );

      if (valid) {
        linkCounts.crossOntologyValid++;
      } else {
        linkCounts.crossOntologyViolation++;
        violatingOutByOntology.set(
          sourceOntology,
          (violatingOutByOntology.get(sourceOntology) ?? 0) + 1,
        );
        const pair = violationMap.get(edgeKey);
        if (pair) {
          pair.occurrences++;
          pushExample(pair.examples, asset.path);
        } else {
          violationMap.set(edgeKey, {
            source: sourceOntology,
            target: targetOntology,
            occurrences: 1,
            examples: [asset.path],
          });
        }
      }
    }
  }

  // ---- Phase F: assemble report ----
  const derivedEdges = [...derivedEdgeMap.values()].sort(
    (a, b) => b.occurrences - a.occurrences,
  );
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  for (const edge of derivedEdges) {
    outDegree.set(edge.source, (outDegree.get(edge.source) ?? 0) + 1);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const ontologies: OntologyReport[] = ontologyUids
    .map((uid) => ({
      ...toRef(uid),
      declaredImports: declaredImportsByUid.get(uid) ?? [],
      unresolvedImports: unresolvedImportsByUid.get(uid) ?? [],
      selfImport: selfImports.includes(uid),
      assetCount: assetCountByOntology.get(uid) ?? 0,
      inDegree: inDegree.get(uid) ?? 0,
      outDegree: outDegree.get(uid) ?? 0,
      internalLinks: internalByOntology.get(uid) ?? 0,
      externalLinksOut: externalOutByOntology.get(uid) ?? 0,
      externalLinksIn: externalInByOntology.get(uid) ?? 0,
      violatingOut: violatingOutByOntology.get(uid) ?? 0,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const violations: ViolationPair[] = [...violationMap.values()]
    .map((v) => ({
      source: toRef(v.source),
      target: toRef(v.target),
      occurrences: v.occurrences,
      examples: v.examples,
    }))
    .sort((a, b) => b.occurrences - a.occurrences);

  // POST-3 (RFC eacf04c0): cross-vault classification removed with the
  // cross-vault flag — always empty, retained for output-shape compatibility.
  const crossVault: ViolationPair[] = [];

  const acyclic = sccs.length === 0;
  const clean =
    violations.length === 0 &&
    linkCounts.crossVault === 0 &&
    acyclic &&
    duplicateOntologyUids.length === 0;

  return {
    vaultPath,
    totalFiles: assets.length,
    scannedFiles,
    ontologies,
    duplicateOntologyUids,
    declared: { edgeCount: declaredEdgeCount, sccs, acyclic },
    derivedEdges,
    violations,
    crossVault,
    linkCounts,
    skips,
    skipExamples,
    noOntologyAssets: {
      count: noOntologyCount,
      byReason: noOntologyByReason,
      examples: noOntologyExamples,
    },
    warnings: {
      selfImports,
      multipleIsDefinedBy,
      ontologiesWithoutUid,
    },
    clean,
    // VL#30: surface the exclusion only when active — keeps the default
    // (no-flag) result object byte-identical to the pre-flag version.
    ...(excludeSet.size > 0 ? { excludedPredicates: [...excludeSet] } : {}),
  };
}

/**
 * RFC df39007b §Решение Шаг 1b — `--propose-imports`.
 *
 * Pure over an already-computed {@link OntologyImportsResult} (no I/O). The
 * derived graph is generally cyclic, and a transitive reduction is only defined
 * on a DAG — so:
 *   (a) condense the derived graph into SCCs (cycles collapse to super-nodes);
 *   (b) the cross-SCC derived edges form a DAG over ontologies — its transitive
 *       reduction, minus what the declared closure already covers, is the
 *       minimal ADDITIONS set M (closure(declared ∪ M) ⊇ acyclic-part(derived));
 *   (c) intra-SCC edges cannot be legitimized by a DAG of imports → reported per
 *       component with a suggested feedback-arc-set (Phase 3).
 *
 * Declared imports are never proposed for removal (R8); transitively-redundant
 * ones are surfaced as an informational flag.
 */
export function computeImportProposal(
  result: OntologyImportsResult,
): ImportProposal {
  const nodes = result.ontologies.map((o) => o.uid);
  // Prebuilt uid→ref map: refOf is called per reduced edge / conflict / FAS cut /
  // SCC member, so a linear scan here would be O(n·E).
  const refByUid = new Map<string, OntologyRef>();
  for (const o of result.ontologies) {
    refByUid.set(o.uid, { uid: o.uid, label: o.label, path: o.path });
  }
  const refOf = (uid: string): OntologyRef =>
    refByUid.get(uid) ?? { uid, label: uid, path: "" };

  // Declared adjacency (resolved imports) + derived adjacency + occurrences.
  const declared: AdjacencyMap = new Map();
  for (const o of result.ontologies) {
    if (o.declaredImports.length > 0) {
      declared.set(o.uid, new Set(o.declaredImports));
    }
  }
  const derived: AdjacencyMap = new Map();
  const occurrenceOf = new Map<string, number>();
  for (const edge of result.derivedEdges) {
    let set = derived.get(edge.source);
    if (!set) {
      set = new Set();
      derived.set(edge.source, set);
    }
    set.add(edge.target);
    occurrenceOf.set(`${edge.source} ${edge.target}`, edge.occurrences);
  }

  // Condense the derived graph; split derived edges into the acyclic part
  // (cross-SCC) and intra-SCC (cycle) edges.
  const { components, componentOf } = condense(nodes, derived);
  const crossEdges: Array<{ source: string; target: string; occurrences: number }> = [];
  const intraByComponent = new Map<number, WeightedEdge[]>();
  let alreadyCovered = 0;
  for (const edge of result.derivedEdges) {
    const ci = componentOf.get(edge.source);
    const cj = componentOf.get(edge.target);
    const intra = ci !== undefined && cj !== undefined && ci === cj;
    if (intra) {
      let arr = intraByComponent.get(ci);
      if (!arr) {
        arr = [];
        intraByComponent.set(ci, arr);
      }
      arr.push({ source: edge.source, target: edge.target, weight: edge.occurrences });
    } else {
      crossEdges.push({
        source: edge.source,
        target: edge.target,
        occurrences: edge.occurrences,
      });
      if (edge.valid) alreadyCovered++;
    }
  }

  // Build a DAG = declared ∪ (non-conflicting cross-SCC derived edges). A cross
  // edge a→b conflicts when the declared graph already reaches a from b (adding
  // a→b would make a cycle) — that needs a Phase-3 re-home, not an import.
  const reaches = (from: string, to: string, adj: AdjacencyMap): boolean => {
    if (from === to) return true;
    const queue = [...(adj.get(from) ?? [])];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === to) return true;
      if (seen.has(current)) continue;
      seen.add(current);
      for (const next of adj.get(current) ?? []) queue.push(next);
    }
    return false;
  };
  // `combined` = declared ∪ accepted cross edges. transitiveReduction below is
  // reachability-preserving on ANY graph (it only drops an edge when the target
  // stays reachable), so `additions` is always correct; its MINIMALITY is
  // guaranteed only while the declared graph is acyclic — the normal state, and
  // a declared cycle is itself an audit violation reported separately
  // (`result.declared.acyclic`) that the user must fix first.
  const combined: AdjacencyMap = new Map();
  for (const [from, tos] of declared) combined.set(from, new Set(tos));
  const conflicts: ProposedImport[] = [];
  const sortedCross = [...crossEdges].sort((a, b) =>
    a.source === b.source ? a.target.localeCompare(b.target) : a.source.localeCompare(b.source),
  );
  for (const edge of sortedCross) {
    if (reaches(edge.target, edge.source, combined)) {
      conflicts.push({ source: refOf(edge.source), target: refOf(edge.target), occurrences: edge.occurrences });
    } else {
      let set = combined.get(edge.source);
      if (!set) {
        set = new Set();
        combined.set(edge.source, set);
      }
      set.add(edge.target);
    }
  }

  // Minimal additions = transitive reduction of `combined`, minus declared.
  const reduced = transitiveReduction(nodes, combined);
  const additions: ProposedImport[] = [];
  for (const [from, tos] of reduced) {
    for (const to of tos) {
      if (declared.get(from)?.has(to)) continue; // already declared — not an addition
      additions.push({
        source: refOf(from),
        target: refOf(to),
        occurrences: occurrenceOf.get(`${from} ${to}`) ?? 0,
      });
    }
  }
  additions.sort(
    (a, b) =>
      b.occurrences - a.occurrences ||
      a.source.uid.localeCompare(b.source.uid) ||
      a.target.uid.localeCompare(b.target.uid),
  );

  // Intra-SCC cycles: suggested feedback-arc-set per component.
  const intraScc: IntraSccComponent[] = [];
  for (const [ci, weighted] of intraByComponent) {
    const componentNodes = components[ci];
    const fas = greedyFeedbackArcSet(componentNodes, weighted);
    const suggestedCuts = fas
      .map((e) => ({
        source: refOf(e.source),
        target: refOf(e.target),
        occurrences: e.weight,
      }))
      .sort(
        (a, b) =>
          a.occurrences - b.occurrences ||
          a.source.uid.localeCompare(b.source.uid) ||
          a.target.uid.localeCompare(b.target.uid),
      );
    intraScc.push({
      ontologies: componentNodes
        .map(refOf)
        .sort((a, b) => a.label.localeCompare(b.label)),
      edgeCount: weighted.length,
      occurrenceCount: weighted.reduce((sum, e) => sum + e.weight, 0),
      suggestedCuts,
    });
  }
  intraScc.sort(
    (a, b) => b.ontologies.length - a.ontologies.length || b.occurrenceCount - a.occurrenceCount,
  );

  // Transitively-redundant declared imports (R8 informational): edge a→b where
  // some other direct import of a already reaches b.
  const declaredClosure = transitiveClosure(nodes, declared);
  const redundantDeclared: ProposedImport[] = [];
  for (const [from, tos] of declared) {
    for (const to of tos) {
      let redundant = false;
      for (const via of tos) {
        if (via === to) continue;
        if (declaredClosure.get(via)?.has(to)) {
          redundant = true;
          break;
        }
      }
      if (redundant) {
        redundantDeclared.push({
          source: refOf(from),
          target: refOf(to),
          occurrences: occurrenceOf.get(`${from} ${to}`) ?? 0,
        });
      }
    }
  }

  return {
    additions,
    acyclicEdgeCount: crossEdges.length,
    alreadyCovered,
    conflicts,
    intraScc,
    redundantDeclared,
  };
}

export interface AuditOntologyImportsOptions {
  vault: string;
  output?: OutputFormat;
  proposeImports?: boolean;
  /** VL#30: exclude the curated {@link ASSOCIATIVE_PREDICATES} set. */
  structuralOnly?: boolean;
  /** VL#30: additional predicate(s) to exclude (repeatable). */
  excludePredicate?: string[];
}

function formatRef(ref: OntologyRef): string {
  // UID is the grouping key (labels have had duplicates — R12); label+path
  // are human context.
  return `${ref.uid}|${ref.label}|${ref.path}`;
}

function printText(result: OntologyImportsResult): void {
  const withImports = result.ontologies.filter(
    (o) => o.declaredImports.length > 0 || o.unresolvedImports.length > 0,
  ).length;
  const log = result.clean ? console.log : console.error;

  log(
    `${result.clean ? "OK" : "FAIL"} ${result.vaultPath}: ontology-imports audit — ` +
      `${result.linkCounts.crossOntologyViolation} violating occurrence(s) in ${result.violations.length} pair(s)`,
  );
  log(
    `Ontologies: ${result.ontologies.length} (${withImports} with imports declared), ` +
      `declared graph: ${result.declared.edgeCount} edge(s), ` +
      (result.declared.acyclic
        ? "acyclic"
        : `NOT ACYCLIC — ${result.declared.sccs.length} SCC(s)`),
  );

  if (result.excludedPredicates && result.excludedPredicates.length > 0) {
    log(
      `Structural-only mode (VL#30): excluded ${result.excludedPredicates.length} associative ` +
        `predicate(s) from edge extraction — ${result.excludedPredicates.join(", ")}`,
    );
  }

  if (result.duplicateOntologyUids.length > 0) {
    console.error(`\nHARD ERRORS — duplicate ontology UIDs (R7):`);
    for (const dup of result.duplicateOntologyUids) {
      console.error(`  ${dup.uid}: ${dup.paths.join(", ")}`);
    }
  }

  if (!result.declared.acyclic) {
    console.error(`\nDeclared-graph cycles (must be a DAG):`);
    for (const scc of result.declared.sccs) {
      console.error(
        `  SCC[${scc.length}]: ${scc.map((uid) => formatRef(toRefSafe(result, uid))).join(" ⇄ ")}`,
      );
    }
  }

  if (result.violations.length > 0) {
    console.error(`\nViolating pairs (src → tgt, occurrences desc):`);
    for (const pair of result.violations) {
      console.error(
        `  ${formatRef(pair.source)} → ${formatRef(pair.target)}: ${pair.occurrences}`,
      );
    }
  }

  const unresolvedTotal = result.ontologies.reduce(
    (sum, o) => sum + o.unresolvedImports.length,
    0,
  );
  log(
    `\nLinks: total=${result.linkCounts.total}, internal=${result.linkCounts.internal}, ` +
      `cross-ontology-valid=${result.linkCounts.crossOntologyValid}, ` +
      `cross-ontology-violation=${result.linkCounts.crossOntologyViolation}, ` +
      `cross-vault=${result.linkCounts.crossVault}, no-ontology=${result.linkCounts.noOntology}`,
  );
  log(
    `Skipped (fail-open, NOT verified): broken=${result.skips.broken}, ` +
      `dup-basename=${result.skips["dup-basename"]}, non-markdown=${result.skips["non-markdown"]}`,
  );
  log(
    `No-ontology assets (Phase-4 data gap): ${result.noOntologyAssets.count} — ` +
      `empty=${result.noOntologyAssets.byReason["empty-isDefinedBy"]}, ` +
      `bang-prefix=${result.noOntologyAssets.byReason["bang-prefix"]}, ` +
      `unresolvable=${result.noOntologyAssets.byReason.unresolvable}, ` +
      `not-an-ontology=${result.noOntologyAssets.byReason["not-an-ontology"]}`,
  );
  if (
    result.warnings.selfImports.length > 0 ||
    result.warnings.multipleIsDefinedBy > 0 ||
    result.warnings.ontologiesWithoutUid.length > 0 ||
    unresolvedTotal > 0
  ) {
    log(
      `Warnings: self-imports=${result.warnings.selfImports.length}, ` +
        `unresolved-imports=${unresolvedTotal}, ` +
        `multiple-isDefinedBy=${result.warnings.multipleIsDefinedBy}, ` +
        `ontologies-without-uid=${result.warnings.ontologiesWithoutUid.length}`,
    );
  }
}

function toRefSafe(result: OntologyImportsResult, uid: string): OntologyRef {
  return (
    result.ontologies.find((o) => o.uid === uid) ?? { uid, label: uid, path: "" }
  );
}

/** Human-readable `--propose-imports` section (additions / FAS / R8 flag). */
function printProposal(proposal: ImportProposal): void {
  console.log(
    `\n=== Import proposal (--propose-imports) ===\n` +
      `Acyclic part: ${proposal.acyclicEdgeCount} cross-SCC derived edge(s), ` +
      `${proposal.alreadyCovered} already covered by declared closure.`,
  );

  console.log(
    `\nAdditions (minimal — transitive reduction of the condensation), ` +
      `${proposal.additions.length} edge(s):`,
  );
  if (proposal.additions.length === 0) {
    console.log("  (none — acyclic part already covered)");
  } else {
    for (const add of proposal.additions) {
      console.log(
        `  + ${formatRef(add.source)} imports ${formatRef(add.target)}  (${add.occurrences} occ)`,
      );
    }
  }

  if (proposal.conflicts.length > 0) {
    console.log(
      `\nConflicts — derived edges that would create a declared-graph cycle ` +
        `(need Phase-3 re-home, not an import), ${proposal.conflicts.length}:`,
    );
    for (const c of proposal.conflicts) {
      console.log(
        `  ! ${formatRef(c.source)} → ${formatRef(c.target)}  (${c.occurrences} occ)`,
      );
    }
  }

  if (proposal.intraScc.length > 0) {
    console.log(
      `\nIntra-SCC cycles (require Phase 3 — imports cannot legitimize a cycle), ` +
        `${proposal.intraScc.length} component(s):`,
    );
    for (const comp of proposal.intraScc) {
      console.log(
        `  SCC[${comp.ontologies.length}] ${comp.edgeCount} edge(s) / ${comp.occurrenceCount} occ — ` +
          `members: ${comp.ontologies.map((o) => o.label).join(", ")}`,
      );
      console.log(
        `    suggested feedback-arc-set to cut (cheapest first), ${comp.suggestedCuts.length} edge(s):`,
      );
      for (const cut of comp.suggestedCuts) {
        console.log(
          `      ✂ ${formatRef(cut.source)} → ${formatRef(cut.target)}  (${cut.occurrences} occ)`,
        );
      }
    }
  }

  if (proposal.redundantDeclared.length > 0) {
    console.log(
      `\nRedundant declared imports (informational, R8 — never auto-removed), ` +
        `${proposal.redundantDeclared.length}:`,
    );
    for (const r of proposal.redundantDeclared) {
      console.log(
        `  ~ ${formatRef(r.source)} imports ${formatRef(r.target)} (reachable without the direct edge)`,
      );
    }
  }
}

/**
 * RFC df39007b Phase 1 — ontology-imports invariant audit.
 *
 * `exocortex audit ontology-imports --vault <path> [--propose-imports]` walks
 * the vault, derives the actual cross-ontology link graph, and reports every
 * occurrence not covered by the declared `exo__Ontology_imports` transitive
 * closure.
 * Exit 0 = clean (0 violations, declared graph acyclic, no duplicate-UID hard
 * errors); exit 1 otherwise. Fail-open skips (broken links, ambiguous
 * basenames) and no-ontology assets never affect the exit code.
 *
 * `--propose-imports` adds a minimal additions-only import proposal (PR2).
 */
export function auditOntologyImportsCommand(): Command {
  return new Command("ontology-imports")
    .description(
      "Detect cross-ontology wikilinks not covered by the declared exo__Ontology_imports transitive closure (DAG check, per-pair grouping, fail-open skip-accounting); --propose-imports suggests minimal import additions",
    )
    .requiredOption("--vault <path>", "Vault root directory")
    .option("--output <type>", "Response format: text|json", "text")
    .option(
      "--propose-imports",
      "Emit a minimal additions-only import proposal (SCC condensation + transitive reduction + suggested feedback-arc-set)",
    )
    .option(
      "--structural-only",
      "Exclude curated associative predicates (exo__Asset_relates, ims__Concept_related/broader/synonym, exo__Asset_createdBy) from edge extraction to measure the structural backbone import-DAG (EKA Phase B, Vision VL#30). Default: every wikilink counts.",
    )
    .option(
      "--exclude-predicate <name>",
      "Additional frontmatter predicate (top-level key) to exclude from edge extraction (repeatable; combines with --structural-only)",
      collectExcludePredicate,
      [],
    )
    .action(async (options: AuditOntologyImportsOptions) => {
      const outputFormat = (options.output ?? "text") as OutputFormat;
      ErrorHandler.setFormat(outputFormat);

      try {
        const vaultPath = resolve(options.vault);
        if (!existsSync(vaultPath) || !statSync(vaultPath).isDirectory()) {
          throw new VaultNotFoundError(vaultPath);
        }

        // VL#30 opt-in exclusion set: curated associative predicates (when
        // --structural-only) plus any explicit --exclude-predicate entries.
        // Empty when neither flag is given ⟹ default byte-identical output.
        const excludePredicates = [
          ...(options.structuralOnly ? ASSOCIATIVE_PREDICATES : []),
          ...(options.excludePredicate ?? []),
        ];

        const result = await scanVaultForOntologyImports(vaultPath, {
          excludePredicates,
        });

        if (options.proposeImports) {
          result.proposal = computeImportProposal(result);
        }

        if (outputFormat === "json") {
          console.log(JSON.stringify(result, null, 2));
        } else {
          printText(result);
          if (result.proposal) printProposal(result.proposal);
        }

        if (!result.clean) process.exitCode = 1;
      } catch (error) {
        ErrorHandler.handle(error as Error);
      }
    });
}

/**
 * Commander.js accumulator for the repeatable `--exclude-predicate` flag
 * (VL#30).
 */
function collectExcludePredicate(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}
