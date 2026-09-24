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
 * `convertVault` per create. This guard does not reintroduce that cost — but the
 * first version of this sentence was a CLAIM, not a mechanism, and review caught
 * it: the guard resolved the anchor and `create` then resolved the SAME anchor
 * again for co-location, because `findReferencedFile`'s last resort globs the
 * vault and parses every file's frontmatter uncached. Measured then: ~1.0x the
 * cost of co-location itself, ≈3.4 s on a 40,977-asset vault.
 *
 * So the mechanism was changed rather than the wording: the guard now RETURNS the
 * resolutions it paid for and `create` feeds them to
 * {@link coLocationFolderFromPath} instead of resolving again. Re-measured after
 * that change, five runs each, live vault-my (40,977 assets): with the guard a
 * median of 2,722 ms, without it 2,827 ms — a delta of −105 ms against a spread of
 * 2,667-3,080, i.e. INDISTINGUISHABLE FROM ZERO. The claim is now true by
 * construction, and the number is here so the next reader re-measures instead of
 * re-deriving the intent. dd9ab956's clause stays true for every other shape.
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
 * Depth cap for the `exo__Class_superClass` walk. The visited-set alone already
 * makes the walk total (a cycle revisits and stops); the cap bounds the work on
 * an adversarially DEEP but acyclic chain — a recursive model has to be paired
 * with a bounded interpreter, the same discipline as `resolveChain`'s
 * MAX_PROTOTYPE_DEPTH.
 *
 * ⛔ A cycle is the ONE place this guard is fail-CLOSED while everything else in
 * it fails OPEN: the walk runs out of depth, returns false, and the value is
 * REFUSED. That is deliberate — an anchor whose class chain loops is not a legal
 * form the guard should wave through, and the alternative (accepting on
 * exhaustion) would make a malformed graph a bypass. Live cycles: 0, so the
 * asymmetry costs nothing today; it is named here because it is asymmetric.
 *
 * 16 is not a guess: across the three canonical vaults 417 classes declare a
 * superClass, the DEEPEST real chain is **7** and cycles are **0**
 * `[three canonical vaults, 2026-09-24]` — so the cap sits at 2.3× the observed
 * maximum. ⚠ A chain deeper than the cap would be a false REFUSAL (the walk
 * stops before reaching the ontology class), which is why the number is stated
 * with its measurement rather than left to taste: the next reader can re-run the
 * count instead of re-deriving the intent.
 */
const MAX_SUPERCLASS_DEPTH = 16;

/**
 * Class refs as a FLAT list of references, wikilink or bare, quoted or not.
 *
 * ⛤ Descends into NESTED arrays, matching the same-named helper in
 * `audit-ontology-membership.ts`. That parity is load-bearing rather than tidy:
 * an UNQUOTED `exo__Instance_class` parses as a nested list, and a one-level
 * flatten would read the incident's own value as classless (accepting it) while
 * reading a legal anchor as unclassed (refusing it) — i.e. the write-time guard
 * would be WEAKER than the post-hoc audit this feature argues it complements.
 * Live assets in that shape: 0; the parity is what keeps it that way.
 */
function asRefList(value: unknown): string[] {
  const out: string[] = [];
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) {
      v.forEach(visit);
      return;
    }
    const ref = extractAssetReference(v);
    if (typeof ref === "string" && ref.length > 0) {
      out.push(ref);
    }
  };
  visit(value);
  return out;
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
      // ⛤ The visited-set bounds WORK, it does not guarantee termination —
      // MAX_SUPERCLASS_DEPTH already does that, and a mutant removing this line
      // reddens no axis (the outcome is identical). What it saves: on an A→B→A
      // cycle the walk would otherwise run all 16 levels re-reading the same two
      // class files, and on a diamond hierarchy the re-reading compounds. No axis
      // asserts that difference — it is a cost, and an axis on cost is a
      // wall-clock assertion, i.e. a CI flake. ⛔ So mutant N9 in the guard spec
      // carries an EMPTY `expect` on purpose: that is the measurement above, not
      // a missing axis. Read its note before "fixing" either.
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
      // A LABEL-shaped ref (`[[exo__Ontology]]`) resolves to a file whose uid the
      // string comparison above never saw, so the identity is re-checked HERE —
      // on the resolved file's own `exo__Asset_uid`.
      //
      // ⛔ NOT on its `exo__Asset_label`. Keying on the label would admit any asset
      // merely NAMED `exo__Ontology`: a label is free text a writer chooses, a uid
      // is the identity the class actually has. Live assets carrying that label
      // today: 3 — all three the SAME class file `829b9b3b`, mounted once per vault
      // (`[three canonical vaults, 2026-09-24]`), so the hole is empty right now —
      // but it is REACHABLE, since `create --label "exo__Ontology"` would fill it.
      // An empty hole one command away from being filled is worth closing.
      const targetUid = meta["exo__Asset_uid"];
      if (
        typeof targetUid === "string" &&
        targetUid.trim().toLowerCase() === ONTOLOGY_CLASS_UID.toLowerCase()
      ) {
        return true;
      }
      next.push(...asRefList(meta["exo__Class_superClass"]));
    }
    frontier = next;
  }
  return false;
}

/**
 * The outcome of one checked value: the vault-relative path its reference
 * resolved to, or `null` for every fail-open form.
 */
export interface IsDefinedByResolution {
  /** Resolved target path per checked value, in the order they were given. */
  targetPaths: (string | null)[];
}

/** Check ONE value; returns its resolved path (null = fail-open) or throws. */
async function checkOneValue(
  raw: unknown,
  fsAdapter: NodeFsAdapter,
  sourceFilePath: string,
  verb: string,
): Promise<string | null> {
  const reference = extractAssetReference(raw);
  // ⛤ The `!` test is an EARLY EXIT, not a second line of defence, and saying so
  // matters: a `!`-anchor never resolves anyway (files named `!*.md` in the three
  // canonical vaults: 0, measured 2026-09-24), so the `!targetPath` return below
  // would catch it regardless. What it saves is the cost — `findReferencedFile`'s
  // last resort scans EVERY markdown file in the vault, and 699 live assets carry
  // a `!`-anchor. Calling it a guard would invite an axis that cannot fail.
  if (!reference || reference.startsWith("!")) {
    return null; // absent / empty / `!`-anchored — fail-open by co-location's contract
  }
  const targetPath = await findReferencedFile(fsAdapter, reference, sourceFilePath);
  if (!targetPath) {
    return null; // unresolvable or cross-vault — fail-open, same contract
  }
  let meta: Record<string, unknown>;
  try {
    meta = await fsAdapter.getFileMetadata(targetPath);
  } catch {
    return null; // unreadable target — fail-open rather than block on an I/O hiccup
  }
  const classRefs = asRefList(meta["exo__Instance_class"]);
  if (classRefs.length === 0) {
    return targetPath; // a target with no class at all is not evidence of a wrong range
  }
  for (const ref of classRefs) {
    if (await subsumesOntology(fsAdapter, ref)) {
      return targetPath;
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

/**
 * Fail-loud guard. Throws when ANY value of `rawValue` resolves to an asset that
 * is not an `exo__Ontology`; returns quietly for every fail-open form (absent,
 * empty, `!`-prefixed, unresolvable) and for legal ontology targets.
 *
 * ⛔ EVERY value is checked, not just the first. `isDefinedBy` is cardinality-1,
 * but the CLI accepts a repeated `--property` / an `--input` array and co-location
 * explicitly handles that shape by taking `[0]` — so a guard reading only `[0]`
 * is bypassed WHOLESALE by passing a legal anchor first and the wrong one second.
 * The incident this closes was itself a machine-built call, which is exactly the
 * caller most likely to emit a repeated flag.
 *
 * `sourceFilePath` is the vault-relative path the value belongs to (`""` for a
 * not-yet-written asset) — it only steers `findReferencedFile`'s same-folder
 * lookup, mirroring co-location's resolution so the guard and the placement
 * agree on WHICH asset the reference means.
 *
 * Returns the resolutions it already paid for, so the caller can reuse them
 * instead of resolving the same reference again (see
 * {@link coLocationFolderFromPath}).
 */
export async function assertIsDefinedByIsOntology(
  rawValue: unknown,
  fsAdapter: NodeFsAdapter,
  sourceFilePath: string,
  verb: string,
): Promise<IsDefinedByResolution> {
  const values = Array.isArray(rawValue) ? rawValue : [rawValue];
  const targetPaths: (string | null)[] = [];
  for (const value of values) {
    targetPaths.push(await checkOneValue(value, fsAdapter, sourceFilePath, verb));
  }
  return { targetPaths };
}
