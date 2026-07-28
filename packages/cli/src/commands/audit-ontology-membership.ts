import { Command } from "commander";
import { existsSync, statSync } from "fs";
import { resolve } from "path";
import { extractAssetReference } from "@kitelev/exocortex-core";
import { CachingNodeFsAdapter } from "../adapters/CachingNodeFsAdapter.js";
import { findReferencedFile } from "../executors/folderRepairHelpers.js";
import {
  isNodeModulesPath,
  isTemplatesPath,
} from "../utils/vaultPathFilters.js";
import { ErrorHandler, type OutputFormat } from "../utils/ErrorHandler.js";
import { VaultNotFoundError } from "../utils/errors/index.js";

/** `exo__Ontology` class UID — an ontology is any asset instancing it. */
export const ONTOLOGY_CLASS_UID = "829b9b3b-6fc3-4276-be6a-27d3398c012e";

/**
 * Why an asset mapped to no admits-checked ontology is fail-open SKIPPED (not a
 * violation, but also not proven a member). Reported explicitly so "0
 * violations" never masks "nothing was actually checked".
 * - `no-isDefinedBy`: empty / `!`-prefixed `exo__Asset_isDefinedBy` — no
 *   ontology to check against.
 * - `ontology-unresolvable`: the `isDefinedBy` reference resolves to nothing (or
 *   to a non-ontology) in this vault (cross-vault / missing / not an ontology).
 * - `ontology-no-admits`: mapped to an ontology that declares NO
 *   `exo__Ontology_admits` — audit-first / fail-open: no allow-list, no
 *   constraint. This is the intended dormant state for ontologies not yet
 *   opted into the ratchet.
 * - `no-instance-class`: the asset carries no `exo__Instance_class` — its
 *   membership cannot be classified.
 * - `unresolvable-class`: the asset's `exo__Instance_class` refs resolve to no
 *   known class UID (dangling / cross-vault class) — cannot classify.
 */
export type MembershipSkipReason =
  | "no-isDefinedBy"
  | "ontology-unresolvable"
  | "ontology-no-admits"
  | "no-instance-class"
  | "unresolvable-class";

export interface MembershipViolation {
  path: string;
  /** Ontology (uid|label|path) the asset is co-located under. */
  ontologyUid: string;
  ontologyLabel: string;
  /** Resolved class UIDs of the asset (`exo__Instance_class`). */
  classUids: string[];
  /** The ontology's declared admits allow-list (resolved class UIDs). */
  admits: string[];
}

export interface OntologyMembershipResult {
  vaultPath: string;
  totalFiles: number;
  /** Ontologies (instances of exo__Ontology) discovered. */
  ontologies: number;
  /** Ontologies that DECLARED a non-empty exo__Ontology_admits allow-list. */
  ontologiesWithAdmits: number;
  /** Assets whose membership was actually checked (mapped to an admits ontology). */
  checked: number;
  violations: MembershipViolation[];
  skips: Record<MembershipSkipReason, number>;
  /** Up to a few example paths per skip reason, for human triage. */
  skipExamples: Record<MembershipSkipReason, string[]>;
}

const MAX_SKIP_EXAMPLES = 5;

/** First non-array string, or null. */
function firstString(value: unknown): string | null {
  if (Array.isArray(value)) {
    const s = value.find((v) => typeof v === "string");
    return (s as string) ?? null;
  }
  return typeof value === "string" ? value : null;
}

/**
 * Extract the wikilink *targets* of a frontmatter value as a list of references
 * (UID-form → the UID, label/symbolic-form → the label), robust to YAML parsing
 * a bare `[[uid]]` into a nested array. Mirrors `audit ontology-imports`'
 * `asRefList` + `folderRepairHelpers`' array descent.
 */
function asRefList(value: unknown): string[] {
  const raw =
    value === undefined || value === null
      ? []
      : Array.isArray(value)
        ? value
        : [value];
  const refs: string[] = [];
  for (const item of raw) {
    // Descend nested arrays (unquoted `[[uid]]` parses to ["uid"] / [["uid"]]).
    let cur: unknown = item;
    while (Array.isArray(cur)) cur = cur[0];
    const ref = extractAssetReference(cur);
    if (ref) refs.push(ref);
  }
  return refs;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Audit a single vault for the ontology-MEMBERSHIP invariant (cohesion-side KSD
 * ArchUnit): every asset co-located under an ontology O that DECLARES an
 * `exo__Ontology_admits` allow-list must carry an `exo__Instance_class` that is
 * admitted by O — i.e. the class, or one of its `exo__Class_superClass`
 * ancestors, is in O's allow-list.
 *
 * Discovery + isDefinedBy asset→ontology mapping mirror `audit co-location` /
 * `audit ontology-imports` (instances of {@link ONTOLOGY_CLASS_UID};
 * {@link findReferencedFile} resolver). Subsumption (F8/F9) is a TS-side
 * superClass BFS over class-def files — pure SPARQL cannot walk it because the
 * store emits a symbolic Instance_class IRI with 0 superClass edges (dual-IRI
 * gap). Every class ref (admits value, Instance_class, superClass) is unified to
 * a canonical class UID: a UID-form ref is its own UID; a label/symbolic-form
 * ref is resolved via a first-wins `exo__Asset_label → uid` index (class-def
 * files are UID-named, so a label wikilink cannot resolve by basename).
 *
 * Fail-open (audit-first): an ontology with NO `_admits` has ALL its members
 * skipped; assets with no `isDefinedBy` / no `Instance_class` / unresolvable
 * refs are skip-accounted by reason, never violations.
 */
export async function scanVaultForOntologyMembership(
  vaultPath: string,
): Promise<OntologyMembershipResult> {
  const adapter = new CachingNodeFsAdapter(vaultPath);
  const assets = await adapter.indexedAssets();

  // ---- indexes over all (non-excluded) assets ----
  const metaByUid = new Map<string, Record<string, unknown>>(); // uid → metadata (first-wins)
  const labelToUid = new Map<string, string>(); // label → uid (first-wins)
  const ontologyByPath = new Map<string, string>(); // ontology file path → uid
  const ontologyLabelByUid = new Map<string, string>();
  // ontology uid → resolved admits class-UID set (only for ontologies that
  // declared a NON-EMPTY exo__Ontology_admits).
  const admitsByOntologyUid = new Map<string, Set<string>>();
  const admitsRawByOntologyUid = new Map<string, string[]>(); // for reporting

  for (const asset of assets) {
    if (isNodeModulesPath(asset.path) || isTemplatesPath(asset.path)) continue;
    const uid = firstString(asset.metadata["exo__Asset_uid"]);
    if (uid) {
      if (!metaByUid.has(uid)) metaByUid.set(uid, asset.metadata);
      const label = firstString(asset.metadata["exo__Asset_label"]);
      if (label && !labelToUid.has(label)) labelToUid.set(label, uid);
    }
    const classRefs = asRefList(asset.metadata["exo__Instance_class"]);
    if (uid && classRefs.includes(ONTOLOGY_CLASS_UID)) {
      ontologyByPath.set(asset.path, uid);
      const label = firstString(asset.metadata["exo__Asset_label"]) ?? asset.path;
      if (!ontologyLabelByUid.has(uid)) ontologyLabelByUid.set(uid, label);
    }
  }

  // Resolve any class ref (UID-form or label/symbolic-form) to a canonical class
  // UID. A UID-form ref IS its own canonical UID (trusted regardless of whether
  // the class-def file is mounted in THIS vault — enables direct admits-match
  // for a cross-vault class; subsumption still needs the class-def present, and
  // degrades to direct-match-only when absent). A label/symbolic-form ref
  // (`[[concept__Concept]]`) cannot resolve by basename (class-def files are
  // UID-named), so it is resolved via the first-wins `label → uid` index.
  const resolveClassRefToUid = (ref: string): string | null => {
    if (UUID_RE.test(ref)) return ref;
    return labelToUid.get(ref) ?? null;
  };

  // Populate admits sets (second pass — needs the resolver + label index built).
  for (const asset of assets) {
    if (isNodeModulesPath(asset.path) || isTemplatesPath(asset.path)) continue;
    const uid = ontologyByPath.get(asset.path);
    if (!uid) continue;
    const admitRefs = asRefList(asset.metadata["exo__Ontology_admits"]);
    if (admitRefs.length === 0) continue; // no allow-list → fail-open (not tracked)
    const set = new Set<string>();
    for (const ref of admitRefs) {
      const cu = resolveClassRefToUid(ref);
      if (cu) set.add(cu);
    }
    if (set.size > 0) {
      admitsByOntologyUid.set(uid, set);
      admitsRawByOntologyUid.set(uid, [...set]);
    }
  }

  // Transitive superClass closure of a class UID (cycle-safe), memoized.
  const closureCache = new Map<string, Set<string>>();
  const classClosure = (startUid: string): Set<string> => {
    const cached = closureCache.get(startUid);
    if (cached) return cached;
    const out = new Set<string>();
    const queue = [startUid];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (out.has(cur)) continue;
      out.add(cur);
      const meta = metaByUid.get(cur);
      if (!meta) continue;
      for (const superRef of asRefList(meta["exo__Class_superClass"])) {
        const superUid = resolveClassRefToUid(superRef);
        if (superUid && !out.has(superUid)) queue.push(superUid);
      }
    }
    closureCache.set(startUid, out);
    return out;
  };

  // ---- per-asset membership check ----
  const violations: MembershipViolation[] = [];
  const skips: Record<MembershipSkipReason, number> = {
    "no-isDefinedBy": 0,
    "ontology-unresolvable": 0,
    "ontology-no-admits": 0,
    "no-instance-class": 0,
    "unresolvable-class": 0,
  };
  const skipExamples: Record<MembershipSkipReason, string[]> = {
    "no-isDefinedBy": [],
    "ontology-unresolvable": [],
    "ontology-no-admits": [],
    "no-instance-class": [],
    "unresolvable-class": [],
  };
  let checked = 0;

  const skip = (reason: MembershipSkipReason, path: string): void => {
    skips[reason]++;
    if (skipExamples[reason].length < MAX_SKIP_EXAMPLES) {
      skipExamples[reason].push(path);
    }
  };

  for (const asset of assets) {
    if (isNodeModulesPath(asset.path) || isTemplatesPath(asset.path)) continue;

    const ref = extractAssetReference(asset.metadata["exo__Asset_isDefinedBy"]);
    if (!ref || ref.startsWith("!")) {
      skip("no-isDefinedBy", asset.path);
      continue;
    }
    const ontologyPath = await findReferencedFile(adapter, ref, asset.path);
    const ontologyUid = ontologyPath ? ontologyByPath.get(ontologyPath) : undefined;
    if (!ontologyUid) {
      skip("ontology-unresolvable", asset.path);
      continue;
    }
    const admits = admitsByOntologyUid.get(ontologyUid);
    if (!admits) {
      skip("ontology-no-admits", asset.path);
      continue;
    }

    const classRefs = asRefList(asset.metadata["exo__Instance_class"]);
    if (classRefs.length === 0) {
      skip("no-instance-class", asset.path);
      continue;
    }
    const classUids = classRefs
      .map(resolveClassRefToUid)
      .filter((u): u is string => u !== null);
    if (classUids.length === 0) {
      skip("unresolvable-class", asset.path);
      continue;
    }

    checked++;
    // Admitted iff any of the asset's classes, or a superClass ancestor of one,
    // is in the ontology's allow-list (subsumption — F8/F9 metaclass-mixing).
    const admitted = classUids.some((cu) => {
      for (const ancestor of classClosure(cu)) {
        if (admits.has(ancestor)) return true;
      }
      return false;
    });
    if (!admitted) {
      violations.push({
        path: asset.path,
        ontologyUid,
        ontologyLabel: ontologyLabelByUid.get(ontologyUid) ?? ontologyUid,
        classUids,
        admits: admitsRawByOntologyUid.get(ontologyUid) ?? [...admits],
      });
    }
  }

  return {
    vaultPath,
    totalFiles: assets.length,
    ontologies: ontologyByPath.size,
    ontologiesWithAdmits: admitsByOntologyUid.size,
    checked,
    violations,
    skips,
    skipExamples,
  };
}

export interface AuditOntologyMembershipOptions {
  vault: string;
  output?: OutputFormat;
}

/**
 * KSD ArchUnit Phase 2 (req c23f6f50, project 531dd440, RFC 2a41ef6e v3 F5–F10)
 * — cohesion-side ontology-membership audit (source of truth, CI). The
 * coupling-side (`audit ontology-imports`) checks cross-ontology links; this
 * checks that every member of an ontology is a class its `exo__Ontology_admits`
 * allow-list permits (subsumption-aware).
 *
 * `exocortex audit ontology-membership --vault <path>` walks the vault and
 * reports any asset whose `exo__Instance_class` is not admitted (directly or via
 * superClass subsumption) by its `isDefinedBy` ontology's `_admits` allow-list.
 * Exit 0 = 0 violations (fail-open skips are still reported); exit 1 = ≥1
 * violation. Ontologies without a declared `_admits`, and unclassifiable assets,
 * are skipped — never affect the exit code (audit-first, fail-open by design).
 */
export function auditOntologyMembershipCommand(): Command {
  return new Command("ontology-membership")
    .description(
      "Detect ontology-membership violations: any asset whose exo__Instance_class (or a superClass ancestor) is not in its isDefinedBy ontology's exo__Ontology_admits allow-list (subsumption-aware superClass walk, dual-IRI-safe, fail-open when no allow-list is declared, skip-accounted)",
    )
    .requiredOption("--vault <path>", "Vault root directory")
    .option("--output <type>", "Response format: text|json", "text")
    .action(async (options: AuditOntologyMembershipOptions) => {
      const outputFormat = (options.output ?? "text") as OutputFormat;
      ErrorHandler.setFormat(outputFormat);

      try {
        const vaultPath = resolve(options.vault);
        if (!existsSync(vaultPath) || !statSync(vaultPath).isDirectory()) {
          throw new VaultNotFoundError(vaultPath);
        }

        const result = await scanVaultForOntologyMembership(vaultPath);
        const skipTotal = Object.values(result.skips).reduce((a, b) => a + b, 0);

        if (outputFormat === "json") {
          console.log(
            JSON.stringify(
              {
                vaultPath: result.vaultPath,
                totalFiles: result.totalFiles,
                ontologies: result.ontologies,
                ontologiesWithAdmits: result.ontologiesWithAdmits,
                checked: result.checked,
                violationCount: result.violations.length,
                violations: result.violations,
                skips: result.skips,
                skipTotal,
                skipExamples: result.skipExamples,
                clean: result.violations.length === 0,
              },
              null,
              2,
            ),
          );
        } else {
          if (result.violations.length === 0) {
            console.log(
              `OK ${vaultPath}: 0 ontology-membership violations ` +
                `(${result.checked} checked; ${result.ontologiesWithAdmits}/${result.ontologies} ontologies declare exo__Ontology_admits)`,
            );
          } else {
            console.error(
              `FAIL ${vaultPath}: ${result.violations.length} ontology-membership violation(s) ` +
                `(${result.checked} checked; ${result.ontologiesWithAdmits}/${result.ontologies} ontologies declare exo__Ontology_admits):`,
            );
            for (const v of result.violations) {
              console.error(
                `  ${v.path}\n      isDefinedBy=${v.ontologyUid} (${v.ontologyLabel})` +
                  ` instance_class=[${v.classUids.join(", ")}] not in admits=[${v.admits.join(", ")}]`,
              );
            }
          }
          // Skip-accounting is always printed — "0 violations" ≠ "everything checked".
          console.error(
            `\nSkipped (fail-open, NOT verified): ${skipTotal} — ` +
              `no-isDefinedBy=${result.skips["no-isDefinedBy"]}, ` +
              `ontology-unresolvable=${result.skips["ontology-unresolvable"]}, ` +
              `ontology-no-admits=${result.skips["ontology-no-admits"]}, ` +
              `no-instance-class=${result.skips["no-instance-class"]}, ` +
              `unresolvable-class=${result.skips["unresolvable-class"]}`,
          );
        }

        if (result.violations.length > 0) process.exitCode = 1;
      } catch (error) {
        ErrorHandler.handle(error as Error);
      }
    });
}
