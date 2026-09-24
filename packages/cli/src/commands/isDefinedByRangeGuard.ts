/**
 * Shared guard for the writer-side verbs `create` and `set-property`: refuse an
 * `exo__Asset_isDefinedBy` whose target RESOLVES but is not an `exo__Ontology`.
 *
 * Why it exists (ticket d8c3c86b): the ExoAssistant bot, asked to create a sleep
 * task "by the matching prototype", built a `create` call that put the PROTOTYPE
 * (`ems__SessionPrototype`, 628bc0e5) into `exo__Asset_isDefinedBy`. `create`
 * validates that the wikilink RESOLVES but never checks the declared RANGE of
 * the property (`exo__Property_range` of `exo__Asset_isDefinedBy` is
 * `exo__Ontology`), so the call exited 0 — and the asset `beb2600c` carried an
 * `sh:class` violation for 15 days, holding vault-my's SHACL baseline red.
 *
 * ## Why a WRITER-SIDE guard and not a wider audit
 *
 * `audit ontology-membership` already detects this shape — but POST HOC: it
 * judges what is already on disk. The ticket is about the write never happening,
 * so an audit cannot be the answer however good it is; the 15 days above are the
 * gap between "written" and "somebody ran the audit".
 *
 * ## Why UNCONDITIONAL, when req dd9ab956 put SHACL behind `--validate`
 *
 * That requirement deferred the FULL conformance check because it costs a
 * `convertVault` per create. This guard costs neither: `create` ALREADY resolves
 * `isDefinedBy` to place the asset (co-location), so the extra work is reading
 * the target's frontmatter — plus, rarely, one or two superClass hops. The
 * deferred cost is not being reintroduced, so the reason for the flag does not
 * apply here. dd9ab956's clause stays true for every other shape of violation.
 *
 * ## What it does NOT refuse (the four fail-open forms, measured)
 *
 * Co-location declares four legal forms of `isDefinedBy` and this guard passes
 * every one of them — on the three canonical vaults they cover **745 live
 * assets** `[three canonical vaults, index 40,953 assets, 2026-09-24]`:
 * `!`-prefixed anchors (699), the property being absent (45), an unresolvable
 * reference (1) and an empty value (0). Refusing them would break a living
 * layer, exactly as a naive predicate would have. Assets whose target resolves
 * to a real ontology: 40,208; assets the guard would refuse: **0** — the data
 * was repaired under ticket b80442aa, so the defect is off the corpus but still
 * on the WRITE path, which is what this closes.
 */
import { extractAssetReference } from "@kitelev/exocortex-core";
import type { NodeFsAdapter } from "../adapters/NodeFsAdapter.js";
import { findReferencedFile } from "../executors/folderRepairHelpers.js";
import { ONTOLOGY_CLASS_UID } from "./audit-ontology-membership.js";

/**
 * Depth cap for the `exo__Class_superClass` walk. A class hierarchy is a few
 * levels deep; the cap plus the visited-set makes the walk total even on a
 * cyclic or adversarial graph (a recursive model must be paired with a bounded
 * interpreter — the same discipline as `resolveChain`'s MAX_PROTOTYPE_DEPTH).
 */
const MAX_SUPERCLASS_DEPTH = 16;

/** Class refs as a flat list of references, wikilink or bare, quoted or not. */
function asRefList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [value];
  return raw
    .map((v) => extractAssetReference(v))
    .filter((v): v is string => typeof v === "string" && v.length > 0);
}

/**
 * Is `classRef` the ontology class, or a subclass of it? Walks
 * `exo__Class_superClass` upwards, reading one class-def file per hop.
 *
 * ⛤ The walk is done over FILES, not over the triple store: the store emits a
 * symbolic `Instance_class` IRI carrying 0 superClass edges, so a SPARQL walk
 * silently finds nothing (the dual-IRI gap `audit ontology-membership` documents
 * for the same reason).
 */
async function subsumesOntology(
  fsAdapter: NodeFsAdapter,
  classRef: string,
): Promise<boolean> {
  const seen = new Set<string>();
  let frontier = [classRef];
  for (let depth = 0; depth < MAX_SUPERCLASS_DEPTH && frontier.length; depth++) {
    const next: string[] = [];
    for (const ref of frontier) {
      const key = ref.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      if (key === ONTOLOGY_CLASS_UID.toLowerCase()) return true;
      const file = await findReferencedFile(fsAdapter, ref, "");
      if (!file) continue;
      let meta: Record<string, unknown>;
      try {
        meta = await fsAdapter.getFileMetadata(file);
      } catch {
        continue;
      }
      // A class named exo__Ontology is the class itself under a label-shaped ref.
      const label = meta["exo__Asset_label"];
      if (typeof label === "string" && label.trim() === "exo__Ontology") {
        return true;
      }
      next.push(...asRefList(meta["exo__Class_superClass"]));
    }
    frontier = next;
  }
  return false;
}

/**
 * Fail-loud guard. Throws when `rawValue` resolves to an asset that is not an
 * `exo__Ontology`; returns quietly for every fail-open form (absent, empty,
 * `!`-prefixed, unresolvable) and for a legal ontology target.
 *
 * `sourceFilePath` is the vault-relative path the value belongs to (`""` for a
 * not-yet-written asset) — it only steers `findReferencedFile`'s same-folder
 * lookup, mirroring co-location's resolution so the guard and the placement
 * agree on WHICH asset the reference means.
 */
export async function assertIsDefinedByIsOntology(
  rawValue: unknown,
  fsAdapter: NodeFsAdapter,
  sourceFilePath: string,
  verb: string,
): Promise<void> {
  const first = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  const reference = extractAssetReference(first);
  // ⛤ The `!` test is an EARLY EXIT, not a second line of defence, and saying so
  // matters: a `!`-anchor never resolves anyway (files named `!*.md` in the three
  // canonical vaults: 0, measured 2026-09-24), so the `!targetPath` return below
  // would catch it regardless. What it saves is the cost — `findReferencedFile`'s
  // last resort scans EVERY markdown file in the vault, and 699 live assets carry
  // a `!`-anchor. Calling it a guard would invite an axis that cannot fail.
  if (!reference || reference.startsWith("!")) {
    return; // absent / empty / `!`-anchored — fail-open by co-location's contract
  }
  const targetPath = await findReferencedFile(fsAdapter, reference, sourceFilePath);
  if (!targetPath) {
    return; // unresolvable or cross-vault — fail-open, same contract
  }
  let meta: Record<string, unknown>;
  try {
    meta = await fsAdapter.getFileMetadata(targetPath);
  } catch {
    return; // unreadable target — fail-open rather than block on an I/O hiccup
  }
  const classRefs = asRefList(meta["exo__Instance_class"]);
  if (classRefs.length === 0) {
    return; // a target with no class at all is not evidence of a wrong range
  }
  for (const ref of classRefs) {
    if (await subsumesOntology(fsAdapter, ref)) {
      return;
    }
  }
  const shown = classRefs.join(", ");
  const label = meta["exo__Asset_label"];
  const named = typeof label === "string" && label ? ` ("${label}")` : "";
  throw new Error(
    `exo__Asset_isDefinedBy must reference an exo__Ontology, but ${reference}${named} ` +
      `is an instance of: ${shown}. ${verb} resolved it to ${targetPath}. ` +
      `The property's declared range is exo__Ontology — pointing it at a prototype, a class or ` +
      `an ordinary asset writes an sh:class violation that only a later SHACL run would find ` +
      `(ticket d8c3c86b: one such asset held a vault's baseline red for 15 days). ` +
      `Pass the ontology anchor of the assetspace this asset belongs to.`,
  );
}
