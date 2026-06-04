/**
 * Empirical integration test for Issue #3286 — canonical IRI form for
 * cross-vault entities.
 *
 * Fixture design: two vaults sharing a single UID under different layouts.
 *   - vault-A (primary) owns the prototype at the canonical full-path
 *       `assetspaces/shared-identities/<uid>.md`
 *   - vault-B (also) owns a task that references the prototype by UUID
 *     wikilink. Vault-B's converter cannot resolve <uid> locally and
 *     therefore falls through to `NoteToRDFConverter.synthesizeWikilinkTargetIRI`,
 *     emitting the lossy basename-only synth-A form
 *       `obsidian://vault/<uid>.md`.
 *
 * Ground truth JOIN query:
 *   `?task <exo:Asset_prototype> ?proto . ?proto <exo:Asset_label> ?label`
 *
 *   - Pre-fix (canonicalizer OFF): `?proto` from vault-B equals synth-A,
 *     prototype's actual subject IRI in vault-A is full-path → JOIN returns
 *     ZERO labels.
 *   - Post-fix (canonicalizer ON): synth-A remapped to full-path → JOIN
 *     returns the prototype's label.
 *
 * This is the revert→fail / restore→pass empirical proof per
 *   ~/dotfiles/.claude/rules/integration-test-revert-verify.md.
 * We do not revert source code; we flip the env-var feature flag.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs-extra";
import path from "path";
import os from "os";
import {
  InMemoryTripleStore,
  IRI,
  Literal,
  vaultPathToIRI,
} from "exocortex";
import { buildCombinedTriples } from "../../src/cache/buildCombinedTriples.js";

const EXO_ASSET_PROTOTYPE_IRI =
  "https://exocortex.my/ontology/exo#Asset_prototype";
const EXO_ASSET_LABEL_IRI = "https://exocortex.my/ontology/exo#Asset_label";

const PROTOTYPE_UID = "fb3d12b2-9552-4866-a31e-2b5f65ea433c";
const TASK_UID = "01234567-89ab-4cde-8123-456789abcdef";

// Any well-formed UUID-form Instance_class wikilink target satisfies the
// loader's required-property validation (`validateExocortexAsset`). The
// canonical IRI of the class itself is irrelevant for this test — we only
// JOIN on `exo__Asset_prototype` ↔ `exo__Asset_label`. Use the well-known
// `exo__Class` metaclass UID as a stable target.
const CLASS_META_UID = "8619c4fc-64f1-4869-b17e-e34186cacca9";

// Canonical full-path subject IRI of the prototype owned by vault-A.
const CANONICAL_PROTO_IRI = vaultPathToIRI(
  `assetspaces/shared-identities/${PROTOTYPE_UID}.md`,
);
// Synth-A IRI emitted by vault-B's converter when it can't resolve PROTOTYPE_UID locally.
const SYNTH_A_PROTO_IRI = `obsidian://vault/${PROTOTYPE_UID}.md`;

async function writeAsset(
  vaultRoot: string,
  relPath: string,
  frontmatter: Record<string, string>,
): Promise<void> {
  const fullPath = path.join(vaultRoot, relPath);
  await fs.ensureDir(path.dirname(fullPath));
  const fmLines: string[] = ["---"];
  for (const [key, value] of Object.entries(frontmatter)) {
    fmLines.push(`${key}: "${value}"`);
  }
  fmLines.push("---", "");
  await fs.writeFile(fullPath, fmLines.join("\n"));
}

describe("IRI canonicalization integration (Issue #3286)", () => {
  let tempRoot: string;
  let vaultA: string;
  let vaultB: string;
  const originalFlag = process.env.EXOCORTEX_IRI_CANONICALIZE;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "exoc-3286-"));
    vaultA = path.join(tempRoot, "vault-A");
    vaultB = path.join(tempRoot, "vault-B");
    await fs.ensureDir(vaultA);
    await fs.ensureDir(vaultB);

    // Vault-A owns the prototype at the canonical full-path subject IRI.
    await writeAsset(
      vaultA,
      `assetspaces/shared-identities/${PROTOTYPE_UID}.md`,
      {
        exo__Asset_uid: PROTOTYPE_UID,
        exo__Asset_label: "Canonical Prototype Label",
        exo__Instance_class: `[[${CLASS_META_UID}]]`,
      },
    );

    // Vault-B owns a task whose `exo__Asset_prototype` references the
    // prototype by UUID. Its NoteToRDFConverter cannot resolve the UUID
    // locally, so it falls through to synth-A.
    await writeAsset(vaultB, `${TASK_UID}.md`, {
      exo__Asset_uid: TASK_UID,
      exo__Asset_label: "Cross-vault Task",
      exo__Instance_class: `[[${CLASS_META_UID}]]`,
      exo__Asset_prototype: `[[${PROTOTYPE_UID}]]`,
    });
  });

  afterEach(async () => {
    await fs.remove(tempRoot);
    if (originalFlag === undefined) {
      delete process.env.EXOCORTEX_IRI_CANONICALIZE;
    } else {
      process.env.EXOCORTEX_IRI_CANONICALIZE = originalFlag;
    }
  });

  /** Counts prototype-label JOIN results from the materialised triple set. */
  async function runPrototypeLabelJoin(triples: ReadonlyArray<unknown>) {
    const store = new InMemoryTripleStore();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await store.addAll(triples as any);

    // Step 1: find task → prototype IRI.
    const protoTriples = await store.match(
      undefined,
      new IRI(EXO_ASSET_PROTOTYPE_IRI),
    );
    const prototypeIris = new Set<string>();
    for (const t of protoTriples) {
      if (t.object instanceof IRI) {
        prototypeIris.add(t.object.value);
      }
    }

    // Step 2: for each prototype IRI, find its label.
    const labels: string[] = [];
    for (const protoIri of prototypeIris) {
      const labelTriples = await store.match(
        new IRI(protoIri),
        new IRI(EXO_ASSET_LABEL_IRI),
      );
      for (const t of labelTriples) {
        if (t.object instanceof Literal) {
          labels.push(t.object.value);
        }
      }
    }

    return { prototypeIris: [...prototypeIris], labels };
  }

  it("FAILS (revert state) when canonicalizer is off: synth-A ↔ full-path JOIN misses", async () => {
    delete process.env.EXOCORTEX_IRI_CANONICALIZE;

    const result = await buildCombinedTriples(vaultA, [vaultB], {
      silent: true,
      noInference: true, // isolate canonicalization from RDFS/prototype materialization
    });

    // Sanity: vault-B emitted the synth-A form, vault-A emitted the canonical form.
    expect(result.canonicalizedTripleCount).toBe(0);
    const join = await runPrototypeLabelJoin(result.triples);
    // The synth-A IRI appears as the prototype reference; no label hit for it.
    expect(join.prototypeIris).toEqual(
      expect.arrayContaining([SYNTH_A_PROTO_IRI]),
    );
    // Recall: 0 labels matched. This is the empirical signal of the bug.
    expect(join.labels).toEqual([]);
  });

  it("PASSES (restore state) when canonicalizer is on: synth-A remapped to full-path", async () => {
    process.env.EXOCORTEX_IRI_CANONICALIZE = "true";

    const result = await buildCombinedTriples(vaultA, [vaultB], {
      silent: true,
      noInference: true,
    });

    // At least one triple was canonicalized (the task's prototype reference).
    expect(result.canonicalizedTripleCount).toBeGreaterThanOrEqual(1);
    const join = await runPrototypeLabelJoin(result.triples);
    // Prototype reference is now the canonical full-path IRI, not synth-A.
    expect(join.prototypeIris).toEqual([CANONICAL_PROTO_IRI]);
    expect(join.prototypeIris).not.toContain(SYNTH_A_PROTO_IRI);
    // Recall: the prototype label is found via the canonical IRI.
    expect(join.labels).toEqual(["Canonical Prototype Label"]);
  });

  it("revert-restore differential: post-fix labels = 1, pre-fix labels = 0", async () => {
    // Pre-fix
    delete process.env.EXOCORTEX_IRI_CANONICALIZE;
    const preFix = await buildCombinedTriples(vaultA, [vaultB], {
      silent: true,
      noInference: true,
    });
    const preJoin = await runPrototypeLabelJoin(preFix.triples);

    // Post-fix
    process.env.EXOCORTEX_IRI_CANONICALIZE = "true";
    const postFix = await buildCombinedTriples(vaultA, [vaultB], {
      silent: true,
      noInference: true,
    });
    const postJoin = await runPrototypeLabelJoin(postFix.triples);

    expect(preJoin.labels.length).toBe(0);
    expect(postJoin.labels.length).toBe(1);
    expect(postFix.canonicalizedTripleCount).toBeGreaterThan(
      preFix.canonicalizedTripleCount,
    );
  });

  it("no canonicalization when running with no --also vaults (single-vault path bypass)", async () => {
    // Even with flag ON, a single-vault build should be a no-op: there is no
    // synth-A pathway because only the owning vault is loaded. This also
    // verifies that buildCombinedTriples gracefully handles alsoVaults=[].
    process.env.EXOCORTEX_IRI_CANONICALIZE = "true";

    const result = await buildCombinedTriples(vaultA, [], {
      silent: true,
      noInference: true,
    });

    expect(result.canonicalizedTripleCount).toBe(0);
  });

  it("UID with no canonical entry in any loaded vault is preserved unchanged", async () => {
    // Add an orphan task whose prototype UID is not in vault-A or vault-B.
    const orphanProtoUid = "deadbeef-dead-4ead-8ead-deadbeefdead";
    const orphanTaskUid = "aaaa1111-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    await writeAsset(vaultB, `${orphanTaskUid}.md`, {
      exo__Asset_uid: orphanTaskUid,
      exo__Asset_label: "Orphan task",
      exo__Instance_class: `[[${CLASS_META_UID}]]`,
      exo__Asset_prototype: `[[${orphanProtoUid}]]`,
    });

    process.env.EXOCORTEX_IRI_CANONICALIZE = "true";

    const result = await buildCombinedTriples(vaultA, [vaultB], {
      silent: true,
      noInference: true,
    });

    // The orphan synth-A IRI is preserved because no vault owns its UID.
    const orphanSynth = `obsidian://vault/${orphanProtoUid}.md`;
    const protoObjects = result.triples
      .filter(
        (t) =>
          t.predicate instanceof IRI &&
          t.predicate.value === EXO_ASSET_PROTOTYPE_IRI,
      )
      .map((t) => (t.object instanceof IRI ? t.object.value : null))
      .filter((v): v is string => v !== null);

    expect(protoObjects).toEqual(
      expect.arrayContaining([orphanSynth, CANONICAL_PROTO_IRI]),
    );
  });

  it("primary-first precedence: prototype's full-path from primary vault wins", async () => {
    // Add a sibling vault that also owns the prototype UID at a different
    // path. The primary's full-path should still be the canonical mapping.
    const vaultC = path.join(tempRoot, "vault-C");
    await fs.ensureDir(vaultC);
    await writeAsset(vaultC, `archived/${PROTOTYPE_UID}.md`, {
      exo__Asset_uid: PROTOTYPE_UID,
      exo__Asset_label: "Archived Copy",
    });

    process.env.EXOCORTEX_IRI_CANONICALIZE = "true";

    const result = await buildCombinedTriples(vaultA, [vaultB, vaultC], {
      silent: true,
      noInference: true,
    });

    const join = await runPrototypeLabelJoin(result.triples);
    // The task's synth-A reference is remapped to the primary's canonical
    // full-path, NOT to vault-C's archived/<uid>.md form.
    expect(join.prototypeIris).toContain(CANONICAL_PROTO_IRI);
    expect(join.prototypeIris).not.toContain(SYNTH_A_PROTO_IRI);
    // Either label can resolve through this primary-canonical IRI; we just
    // verify the canonical IRI is the one used for the JOIN.
    expect(join.labels.length).toBeGreaterThanOrEqual(1);
  });
});
