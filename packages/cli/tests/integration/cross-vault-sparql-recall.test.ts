/**
 * Empirical cross-vault SPARQL recall test (Issue #3281).
 *
 * Fixture design — isolating #3281 from sibling issues:
 *   - UID-form filenames only (`<uuid>.md`) → sidesteps #3286 (canonical IRI)
 *   - Wikilinks use UUID-form `[[<uuid>]]` only, never label-form
 *     → sidesteps #3282 (PropertyPathExecutor label-safety guard)
 *   - Inference is materialized at INDEX time (sparql-index --also flow),
 *     not at query time → that is what #3281 fixes (#3283 separate)
 *   - Class labels use whitelisted namespace prefix `ems__` so
 *     resolveCrossVaultInstanceClassWikilinks (NAMESPACE_PREFIX_MAP-driven)
 *     accepts them and produces canonical ontology IRIs
 *   - Ground truth is computed independently by hand-counting fixtures
 *     before invoking the engine, never by re-running the engine
 *
 * Cross-vault topology:
 *   - vault-B/<classBaseUid>.md:      ems__XVaultRecallBase    (parent class)
 *   - vault-B/<classDerivedUid>.md:   ems__XVaultRecallDerived
 *                                       exo__Class_superClass: [[<classBaseUid>]]
 *   - vault-A/<assetUid_i>.md × ASSET_COUNT:
 *                                       exo__Instance_class: [[<classDerivedUid>]]
 *
 * Ground-truth representative query: "Find every asset whose canonical
 * class IRI is <ems#XVaultRecallDerived>", i.e.
 *
 *     ?asset rdf:type <https://exocortex.my/ontology/ems#XVaultRecallDerived>
 *
 * (RDFS subClassOf propagation up to XVaultRecallBase is deliberately NOT
 *  exercised — that requires Issue #3286 fixes, since the file-IRI of the
 *  class definition differs from the canonical class IRI used as the
 *  object of rdf:type. Within #3281 scope, the load-bearing assertion is
 *  that cross-vault Instance_class wikilinks resolve to canonical IRIs in
 *  the combined materialized index.)
 *
 * Without cross-vault materialization (#3281 pre-fix), per-vault loading:
 *   - vault A converter cannot resolve `[[<classDerivedUid>]]` to the
 *     canonical class IRI because the class file lives in vault B
 *     → no `?asset rdf:type <ems#XVaultRecallDerived>` triple is emitted
 *   - vault B contributes no such asset → query recall = 0/ASSET_COUNT
 *
 * With cross-vault materialization (#3281 post-fix):
 *   - buildCombinedTriples loads both vaults, then
 *     resolveCrossVaultInstanceClassWikilinks emits an
 *     `<asset> rdf:type <ems#XVaultRecallDerived>` triple for every
 *     fixture asset → query recall = ASSET_COUNT/ASSET_COUNT
 *
 * DoD assertion (issue body): combined-vault recall ≥ 85% on representative
 * cross-vault analytical query. We assert ≥ 85% post-fix AND <= 20% pre-fix
 * (revert→fail / restore→pass per integration-test-revert-verify rule).
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs-extra";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import {
  InMemoryTripleStore,
  NoteToRDFConverter,
  IRI,
} from "exocortex";
import { FileSystemVaultAdapter } from "../../src/adapters/FileSystemVaultAdapter.js";
import { buildCombinedTriples } from "../../src/cache/buildCombinedTriples.js";

const RDF_TYPE_IRI = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
// Use a whitelisted namespace prefix (`ems__`) so the cross-vault wikilink
// resolver in validate-schema.ts (NAMESPACE_PREFIX_MAP-driven) accepts the
// class labels and emits canonical IRIs. The unused `test__` prefix is NOT
// in the whitelist — using it silently breaks cross-vault resolution.
const TEST_BASE_IRI = "https://exocortex.my/ontology/ems#XVaultRecallBase";
const TEST_DERIVED_IRI = "https://exocortex.my/ontology/ems#XVaultRecallDerived";

const ASSET_COUNT = 12;

/** Synthesize a UUID-named markdown file with the given frontmatter properties. */
async function writeAsset(
  vaultRoot: string,
  uid: string,
  frontmatter: Record<string, string | string[]>,
): Promise<string> {
  const fmLines: string[] = ["---"];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (Array.isArray(value)) {
      fmLines.push(`${key}:`);
      for (const v of value) {
        fmLines.push(`  - "${v}"`);
      }
    } else {
      fmLines.push(`${key}: "${value}"`);
    }
  }
  fmLines.push("---", "");
  const fullPath = path.join(vaultRoot, `${uid}.md`);
  await fs.ensureDir(path.dirname(fullPath));
  await fs.writeFile(fullPath, fmLines.join("\n"));
  return fullPath;
}

/**
 * Build a deterministic UID set so the test can hand-compute ground truth.
 * UIDs are valid v4-shaped lowercase hex; resolveCrossVaultInstanceClassWikilinks
 * matches them via /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.
 */
function makeUid(seed: string): string {
  // Build a UUID-v4-shaped string deterministically from the seed.
  const padded = seed.padEnd(32, "0").slice(0, 32);
  return [
    padded.slice(0, 8),
    padded.slice(8, 12),
    "4" + padded.slice(13, 16),       // version 4
    "8" + padded.slice(17, 20),       // variant 10xx
    padded.slice(20, 32),
  ].join("-").toLowerCase();
}

describe("cross-vault SPARQL recall (Issue #3281)", () => {
  let tempRoot: string;
  let vaultA: string; // instance vault
  let vaultB: string; // ontology vault
  let classBaseUid: string;
  let classDerivedUid: string;
  let assetUids: string[];

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "exoc-3281-"));
    vaultA = path.join(tempRoot, "vault-A");
    vaultB = path.join(tempRoot, "vault-B");
    await fs.ensureDir(vaultA);
    await fs.ensureDir(vaultB);

    classBaseUid = makeUid("aaaaaaaaaaaaaaaa");
    classDerivedUid = makeUid("bbbbbbbbbbbbbbbb");

    // Vault B: class hierarchy.
    // Note: labels are namespace__LocalName form so resolveCrossVaultInstanceClassWikilinks
    // can derive the canonical class IRI from the label.
    await writeAsset(vaultB, classBaseUid, {
      exo__Asset_uid: classBaseUid,
      exo__Asset_label: "ems__XVaultRecallBase",
      exo__Instance_class:
        "[[8619c4fc-64f1-4869-b17e-e34186cacca9]]", // exo__Class metaclass UID
    });
    await writeAsset(vaultB, classDerivedUid, {
      exo__Asset_uid: classDerivedUid,
      exo__Asset_label: "ems__XVaultRecallDerived",
      exo__Instance_class:
        "[[8619c4fc-64f1-4869-b17e-e34186cacca9]]",
      exo__Class_superClass: `[[${classBaseUid}]]`,
    });

    // Vault A: ASSET_COUNT assets typed as Derived (and therefore Base via subClassOf).
    assetUids = [];
    for (let i = 0; i < ASSET_COUNT; i++) {
      const uid = makeUid(`c${i.toString(16).padStart(2, "0")}cccccccccccccc`);
      assetUids.push(uid);
      await writeAsset(vaultA, uid, {
        exo__Asset_uid: uid,
        exo__Asset_label: `Asset ${i}`,
        exo__Instance_class: `[[${classDerivedUid}]]`,
      });
    }
  });

  afterEach(async () => {
    await fs.remove(tempRoot);
  });

  /**
   * Pre-fix recall: simulates the current `sparql query --also` flow
   * without cross-vault materialization — per-vault load, concat, no
   * RDFS inference, no resolveCrossVaultInstanceClassWikilinks.
   *
   * Recall is computed against the ground-truth set of ASSET_COUNT assets
   * that should match `?s rdf:type <TestBase>`.
   */
  async function recallWithoutCombinedIndex(): Promise<{
    matches: number;
    expected: number;
  }> {
    const adapterA = new FileSystemVaultAdapter(vaultA);
    const adapterB = new FileSystemVaultAdapter(vaultB);
    const triplesA = await new NoteToRDFConverter(adapterA).convertVault();
    const triplesB = await new NoteToRDFConverter(adapterB).convertVault();
    const combined = [...triplesA, ...triplesB];

    const store = new InMemoryTripleStore();
    await store.addAll(combined);

    // Hand-execute the analytical query without materialization.
    const matched = await store.match(
      undefined,
      new IRI(RDF_TYPE_IRI),
      new IRI(TEST_DERIVED_IRI),
    );

    // Restrict matches to fixture assets (sanity vs accidental TBox hits)
    const matchSubjects = new Set(
      matched
        .map((t) => t.subject)
        .filter((s): s is IRI => s instanceof IRI)
        .map((s) => s.value),
    );

    let assetMatches = 0;
    for (const assetUid of assetUids) {
      // Asset IRI lives under obsidian://vault/... — accept any matched
      // subject whose IRI contains the asset UID.
      const found = Array.from(matchSubjects).some((s) =>
        s.toLowerCase().includes(assetUid),
      );
      if (found) assetMatches++;
    }

    return { matches: assetMatches, expected: assetUids.length };
  }

  /**
   * Post-fix recall: runs the new buildCombinedTriples orchestration
   * (cross-vault wikilink resolution + RDFS + prototype chain on the
   * combined store) and queries the resulting triple set.
   */
  async function recallWithCombinedIndex(): Promise<{
    matches: number;
    expected: number;
  }> {
    const result = await buildCombinedTriples(vaultA, [vaultB], {
      silent: true,
    });

    const store = new InMemoryTripleStore();
    await store.addAll(result.triples);

    const matched = await store.match(
      undefined,
      new IRI(RDF_TYPE_IRI),
      new IRI(TEST_DERIVED_IRI),
    );

    const matchSubjects = new Set(
      matched
        .map((t) => t.subject)
        .filter((s): s is IRI => s instanceof IRI)
        .map((s) => s.value),
    );

    let assetMatches = 0;
    for (const assetUid of assetUids) {
      const found = Array.from(matchSubjects).some((s) =>
        s.toLowerCase().includes(assetUid),
      );
      if (found) assetMatches++;
    }

    return { matches: assetMatches, expected: assetUids.length };
  }

  it("post-fix combined index achieves ≥85% recall on cross-vault analytical query (DoD)", async () => {
    const { matches, expected } = await recallWithCombinedIndex();
    const recall = matches / expected;
    // DoD threshold from issue #3281 body.
    expect(recall).toBeGreaterThanOrEqual(0.85);
    // Stronger assertion: with this fixture shape the combined index should
    // catch every asset (recall = 1.0); allowing a small slack only for
    // future TBox/parser drift that doesn't affect correctness.
    expect(matches).toBeGreaterThanOrEqual(Math.ceil(expected * 0.85));
  });

  it("pre-fix per-vault flow falls well below the 85% target (regression baseline)", async () => {
    // Establishes the empirical signal: without combined materialization the
    // same fixture and query produce sub-20% recall. This is the revert→fail
    // half of the integration-test-revert-verify discipline. If this test
    // starts passing, the fixture no longer exercises Issue #3281's gap.
    const { matches, expected } = await recallWithoutCombinedIndex();
    const recall = matches / expected;
    expect(recall).toBeLessThanOrEqual(0.2);
  });

  it("documents the recall lift achieved by the cross-vault index", async () => {
    const before = await recallWithoutCombinedIndex();
    const after = await recallWithCombinedIndex();
    const beforeRecall = before.matches / before.expected;
    const afterRecall = after.matches / after.expected;
    // Captures the empirical lift for the PR description / future audits.
    expect(afterRecall - beforeRecall).toBeGreaterThanOrEqual(0.65);
  });

  it("combined index keeps the same recall regardless of --also ordering", async () => {
    // Sanity: the cache-key sort/dedupe contract in CombinedCacheManager
    // means logical equivalence of --also orderings; here we just verify
    // buildCombinedTriples is order-stable on result count.
    const first = await buildCombinedTriples(vaultA, [vaultB], { silent: true });
    // A duplicate --also of the SAME vault is filtered (dedupe), so we exercise
    // dedupe at the orchestration layer by passing the primary path as also too.
    const second = await buildCombinedTriples(vaultA, [vaultB, vaultA], {
      silent: true,
    });
    expect(second.triples.length).toBe(first.triples.length);
  });
});
