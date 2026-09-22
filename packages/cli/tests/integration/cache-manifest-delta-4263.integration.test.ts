/**
 * #4263 — CacheManager per-file manifest validity + delta refresh + shared
 * loader, driven through the REAL `NoteToRDFConverter` + `FileSystemVaultAdapter`
 * on a temp vault with nested `assetspaces/**` folders (the exact shape whose
 * edits the pre-#4263 root-mtime check never saw).
 *
 * Requirement: @req:42812747-8b76-4525-aaaa-00857ea98599
 *
 * Axes (names are the machine key the mutant driver extracts — `A<N>`):
 *   A1  nested edit / add / delete invalidates while the root mtime is untouched
 *   A2  delta re-parses ONLY the changed files (convertNote call count) and equals a full rebuild
 *   A3  deleted / renamed file leaves no stale subject behind
 *   A4  referrers of an added / removed link target are re-parsed (both directions)
 *   A5  a TBox-form asset change falls back to a full rebuild
 *   A6  legacy / corrupt cache and an over-threshold diff fall back to a full rebuild
 *   A7  the inferred layer is re-materialized after a delta (not stale, not dropped)
 *   A8  loadVaultTriples: no-cache path = plain convertVault (no cache file), cache path = same set
 *   A9  body-link (bare literal) referrers of an added target are re-parsed          (review HIGH-1)
 *   A10 alias change on a non-TBox target re-parses its alias-resolving referrers    (review MEDIUM-2)
 *   A11 TBox guards: class removed / label-named file added+removed / label lost → rebuild
 *   A12 a TBox-labelled file the converter skipped still forces a rebuild on removal (review MEDIUM-5)
 *   A13 two concurrent loadOrBuild() after an edit — atomic write, no torn cache      (review HIGH-2)
 *   A14 inference flag survives an empty layer; layer recomputed only on engine-input change (MEDIUM-3/4)
 *   A15 FileSpace declaration removed / edited / added in label form → rebuild       (review MEDIUM-1)
 *   A16 a TBox-form ALIAS on a human-labelled target → rebuild in all three directions (review r2 N1)
 *   A17 a pure alias ADDITION re-parses only needle referrers, not every IRI referrer (review r2 N7)
 *
 * Revert-verify (mutants applied to a COPY of the tree by the driver spec
 * `tests/integration/cache-manifest-delta-4263.spec.json`): root-mtime validity → A1 RED;
 * delta replaced by a full re-parse → A2 RED; referrer scan removed → A4 RED; TBox guard
 * removed → A5 RED; inferred layer dropped on delta → A7 RED.
 */
import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import fs from "fs-extra";
import path from "path";
import os from "os";
import {
  NoteToRDFConverter,
  Triple,
  IRI,
  vaultPathToIRI,
  type Triple as TripleT,
} from "@kitelev/exocortex-core";
import { FileSystemVaultAdapter } from "../../src/adapters/FileSystemVaultAdapter.js";
import {
  CacheManager,
  CACHE_FORMAT_VERSION,
  serializeNode,
} from "../../src/cache/CacheManager.js";
import { loadVaultTriples } from "../../src/cache/loadVaultTriples.js";
import {
  materializeInferredTriples,
  tripleKey,
} from "../../src/cache/materializeInferred.js";

const REQ = "@req:42812747-8b76-4525-aaaa-00857ea98599";

// UID-named assets (UID-canon TBox/ABox, CLAUDE.md)
const CLASS_TASK = "7f2f0a4b-0f2e-4a1c-9d1e-4263a0000001"; // label ems__Task (TBox form)
const CLASS_PROJECT = "7f2f0a4b-0f2e-4a1c-9d1e-4263a0000002"; // label ems__Project (TBox form)
const PROJECT_P = "7f2f0a4b-0f2e-4a1c-9d1e-4263a0000010";
const TASK_A = "7f2f0a4b-0f2e-4a1c-9d1e-4263a0000011";
const TASK_B = "7f2f0a4b-0f2e-4a1c-9d1e-4263a0000012";
const TASK_C = "7f2f0a4b-0f2e-4a1c-9d1e-4263a0000013";
const TASK_D = "7f2f0a4b-0f2e-4a1c-9d1e-4263a0000014"; // link target that does not exist at first
const PROTO = "7f2f0a4b-0f2e-4a1c-9d1e-4263a0000015"; // prototype for the inferred-layer axis

const TBOX_DIR = "assetspaces/kitelev/exoas-public/ems";
const TASKS_DIR = "assetspaces/kitelev/exoas-my/my-tasks";
const PROJECTS_DIR = "assetspaces/kitelev/exoas-my/my-projects";

function fm(props: Record<string, string>): string {
  const lines = Object.entries(props).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

function tripleKeys(triples: TripleT[]): string[] {
  return triples.map(tripleKey).sort();
}

function objectsOf(triples: TripleT[], subjectRel: string): string[] {
  const subject = vaultPathToIRI(subjectRel);
  return triples
    .filter((t) => serializeNode(t.subject).value === subject)
    .map(
      (t) =>
        `${serializeNode(t.predicate).value} -> ${serializeNode(t.object).value}`,
    );
}

describe(`CacheManager — per-file manifest, delta refresh, shared loader (#4263) ${REQ}`, () => {
  let tempDir: string;
  let vaultPath: string;
  let clock: number;

  // Distinct, monotonic mtimes so a write landing within the same ms as the
  // build is never mistaken for "unchanged" (the vault-under-test edits are
  // deliberately faster than a human's).
  async function writeFile(rel: string, content: string): Promise<void> {
    const full = path.join(vaultPath, rel);
    await fs.ensureDir(path.dirname(full));
    await fs.writeFile(full, content, "utf-8");
    clock += 1000;
    await fs.utimes(full, clock / 1000, clock / 1000);
  }

  async function rootMtime(): Promise<number> {
    return (await fs.stat(vaultPath)).mtimeMs;
  }

  async function fullRebuildKeys(): Promise<string[]> {
    const adapter = new FileSystemVaultAdapter(vaultPath);
    const converter = new NoteToRDFConverter(adapter);
    return tripleKeys(await converter.convertVault());
  }

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cache-delta-4263-"));
    vaultPath = path.join(tempDir, "vault");
    clock = Date.now() - 60_000;

    await writeFile(
      `${TBOX_DIR}/${CLASS_TASK}.md`,
      fm({
        exo__Asset_uid: CLASS_TASK,
        exo__Instance_class: '"[[exo__Class]]"',
        exo__Asset_label: "ems__Task",
      }),
    );
    await writeFile(
      `${TBOX_DIR}/${CLASS_PROJECT}.md`,
      fm({
        exo__Asset_uid: CLASS_PROJECT,
        exo__Instance_class: '"[[exo__Class]]"',
        exo__Asset_label: "ems__Project",
      }),
    );
    await writeFile(
      `${PROJECTS_DIR}/${PROJECT_P}.md`,
      fm({
        exo__Asset_uid: PROJECT_P,
        exo__Instance_class: `"[[${CLASS_PROJECT}]]"`,
        exo__Asset_label: '"Project P"',
      }),
    );
    for (const [uid, label] of [
      [TASK_A, "Task A"],
      [TASK_B, "Task B"],
      [TASK_C, "Task C"],
    ] as const) {
      await writeFile(
        `${TASKS_DIR}/${uid}.md`,
        fm({
          exo__Asset_uid: uid,
          exo__Instance_class: `"[[${CLASS_TASK}]]"`,
          exo__Asset_label: `"${label}"`,
          ems__Effort_parent: `"[[${PROJECT_P}]]"`,
        }),
      );
    }
    // Hidden dir content must be invisible to both the converter and the manifest.
    await writeFile(".obsidian/workspace.md", "not an asset");
    // Freeze the root dir mtime AFTER the tree exists so later nested edits
    // cannot be mistaken for a root-mtime change.
    clock += 1000;
    await fs.utimes(vaultPath, clock / 1000, clock / 1000);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.remove(tempDir);
  });

  it(`A1 a nested edit / add / delete invalidates the cache while the vault root mtime is unchanged ${REQ}`, async () => {
    const cache = new CacheManager(vaultPath);
    const built = await cache.loadOrBuild();
    expect(built.mode).toBe("rebuild");
    expect(await cache.isCacheValid()).toBe(true);
    // Pin the root dir mtime to an integer-second value and read it BACK
    // through the FS: the float round-trip of a sub-ms stamp differs per
    // platform (CI ext4 vs APFS), and the axis is about FILES, not about the
    // root timestamp's precision.
    const rootPinSeconds = Math.floor(clock / 1000) + 5;
    await fs.utimes(vaultPath, rootPinSeconds, rootPinSeconds);
    const rootBefore = await rootMtime();

    // modify (nested, two directories below an assetspace)
    await writeFile(
      `${TASKS_DIR}/${TASK_A}.md`,
      fm({
        exo__Asset_uid: TASK_A,
        exo__Instance_class: `"[[${CLASS_TASK}]]"`,
        exo__Asset_label: '"Task A renamed"',
        ems__Effort_parent: `"[[${PROJECT_P}]]"`,
      }),
    );
    // keep the root dir mtime frozen (a nested write does not touch it on
    // any platform, but the fixture pins it so the axis is about FILES)
    await fs.utimes(vaultPath, rootPinSeconds, rootPinSeconds);
    expect(await rootMtime()).toBe(rootBefore);

    expect(await cache.isCacheValid()).toBe(false);
    const diff = await cache.computeManifestDiff();
    expect(diff).toEqual({
      added: [],
      modified: [`${TASKS_DIR}/${TASK_A}.md`],
      removed: [],
    });

    const fresh = await cache.loadOrBuild();
    const labels = objectsOf(fresh.triples, `${TASKS_DIR}/${TASK_A}.md`).filter(
      (x) => x.includes("#Asset_label"),
    );
    expect(labels.join("\n")).toContain("Task A renamed");
    expect(labels.join("\n")).not.toContain("-> Task A\n");
    expect(await cache.isCacheValid()).toBe(true);

    // add
    await writeFile(
      `${TASKS_DIR}/${TASK_D}.md`,
      fm({
        exo__Asset_uid: TASK_D,
        exo__Instance_class: `"[[${CLASS_TASK}]]"`,
        exo__Asset_label: '"Task D"',
      }),
    );
    await fs.utimes(vaultPath, rootPinSeconds, rootPinSeconds);
    expect(await rootMtime()).toBe(rootBefore);
    expect(await cache.isCacheValid()).toBe(false);
    expect((await cache.computeManifestDiff())?.added).toEqual([
      `${TASKS_DIR}/${TASK_D}.md`,
    ]);
    await cache.loadOrBuild();
    expect(await cache.isCacheValid()).toBe(true);

    // delete
    await fs.remove(path.join(vaultPath, `${TASKS_DIR}/${TASK_D}.md`));
    await fs.utimes(vaultPath, rootPinSeconds, rootPinSeconds);
    expect(await rootMtime()).toBe(rootBefore);
    expect(await cache.isCacheValid()).toBe(false);
    expect((await cache.computeManifestDiff())?.removed).toEqual([
      `${TASKS_DIR}/${TASK_D}.md`,
    ]);
  });

  it(`A2 a delta re-parses only the changed files and equals a from-scratch rebuild ${REQ}`, async () => {
    const cache = new CacheManager(vaultPath);
    await cache.loadOrBuild();

    // 2 of 6 files change
    for (const [uid, label] of [
      [TASK_B, "Task B v2"],
      [TASK_C, "Task C v2"],
    ] as const) {
      await writeFile(
        `${TASKS_DIR}/${uid}.md`,
        fm({
          exo__Asset_uid: uid,
          exo__Instance_class: `"[[${CLASS_TASK}]]"`,
          exo__Asset_label: `"${label}"`,
          ems__Effort_parent: `"[[${PROJECT_P}]]"`,
        }),
      );
    }

    const convertNote = jest.spyOn(NoteToRDFConverter.prototype, "convertNote");
    const result = await cache.loadOrBuild();
    const reparsed = convertNote.mock.calls
      .map((c) => (c[0] as { path: string }).path)
      .sort();
    convertNote.mockRestore();

    expect(result.mode).toBe("delta");
    expect(result.cacheHit).toBe(true);
    expect(result.reparsedFiles).toBe(2);
    expect(reparsed).toEqual([
      `${TASKS_DIR}/${TASK_B}.md`,
      `${TASKS_DIR}/${TASK_C}.md`,
    ]);

    expect(tripleKeys(result.triples)).toEqual(await fullRebuildKeys());

    // persisted: the next call is a plain hit that re-parses nothing
    const again = jest.spyOn(NoteToRDFConverter.prototype, "convertNote");
    const hit = await cache.loadOrBuild();
    expect(hit.mode).toBe("hit");
    expect(again).not.toHaveBeenCalled();
    expect(tripleKeys(hit.triples)).toEqual(tripleKeys(result.triples));
  });

  it(`A3 a deleted or renamed file leaves no stale subject in the result or the persisted cache ${REQ}`, async () => {
    const cache = new CacheManager(vaultPath);
    await cache.loadOrBuild();

    const oldRel = `${TASKS_DIR}/${TASK_C}.md`;
    const oldIri = vaultPathToIRI(oldRel);

    // delete
    await fs.remove(path.join(vaultPath, oldRel));
    const afterDelete = await cache.loadOrBuild();
    expect(afterDelete.mode).toBe("delta");
    expect(objectsOf(afterDelete.triples, oldRel)).toEqual([]);
    const persisted = await fs.readJson(cache.getCachePath());
    expect(persisted.files.map((f: { path: string }) => f.path)).not.toContain(
      oldRel,
    );
    expect(JSON.stringify(persisted)).not.toContain(oldIri);
    expect(tripleKeys(afterDelete.triples)).toEqual(await fullRebuildKeys());

    // rename (= removed + added for the manifest)
    const fromRel = `${TASKS_DIR}/${TASK_B}.md`;
    const toRel = `${TASKS_DIR}/moved/${TASK_B}.md`;
    await fs.ensureDir(path.dirname(path.join(vaultPath, toRel)));
    await fs.move(path.join(vaultPath, fromRel), path.join(vaultPath, toRel));
    const afterRename = await cache.loadOrBuild();
    expect(afterRename.mode).toBe("delta");
    expect(objectsOf(afterRename.triples, fromRel)).toEqual([]);
    expect(objectsOf(afterRename.triples, toRel).join("\n")).toContain(
      "Task B",
    );
    expect(tripleKeys(afterRename.triples)).toEqual(await fullRebuildKeys());
  });

  it(`A4 referrers of an added / removed link target are re-parsed in both directions ${REQ}`, async () => {
    // Task A links to Task D, which does not exist yet → synthesized IRI.
    const aRel = `${TASKS_DIR}/${TASK_A}.md`;
    const dRel = `${TASKS_DIR}/${TASK_D}.md`;
    await writeFile(
      aRel,
      fm({
        exo__Asset_uid: TASK_A,
        exo__Instance_class: `"[[${CLASS_TASK}]]"`,
        exo__Asset_label: '"Task A"',
        ems__Effort_blockedBy: `"[[${TASK_D}]]"`,
      }),
    );
    const cache = new CacheManager(vaultPath);
    const built = await cache.loadOrBuild();
    const dangling = vaultPathToIRI(`${TASK_D}.md`);
    expect(objectsOf(built.triples, aRel).join("\n")).toContain(
      `-> ${dangling}`,
    );

    // D appears → A must be re-parsed (it is untouched on disk) and now point
    // at D's real file-IRI.
    await writeFile(
      dRel,
      fm({
        exo__Asset_uid: TASK_D,
        exo__Instance_class: `"[[${CLASS_TASK}]]"`,
        exo__Asset_label: '"Task D"',
      }),
    );
    const spy = jest.spyOn(NoteToRDFConverter.prototype, "convertNote");
    const added = await cache.loadOrBuild();
    const reparsed = spy.mock.calls
      .map((c) => (c[0] as { path: string }).path)
      .sort();
    spy.mockRestore();
    expect(added.mode).toBe("delta");
    expect(reparsed).toEqual([aRel, dRel].sort());
    expect(objectsOf(added.triples, aRel).join("\n")).toContain(
      `-> ${vaultPathToIRI(dRel)}`,
    );
    expect(objectsOf(added.triples, aRel).join("\n")).not.toContain(
      `-> ${dangling}`,
    );
    expect(tripleKeys(added.triples)).toEqual(await fullRebuildKeys());

    // D disappears → A must be re-parsed again and fall back to the
    // synthesized form.
    await fs.remove(path.join(vaultPath, dRel));
    const spy2 = jest.spyOn(NoteToRDFConverter.prototype, "convertNote");
    const removed = await cache.loadOrBuild();
    const reparsed2 = spy2.mock.calls
      .map((c) => (c[0] as { path: string }).path)
      .sort();
    spy2.mockRestore();
    expect(removed.mode).toBe("delta");
    expect(reparsed2).toEqual([aRel]);
    expect(objectsOf(removed.triples, aRel).join("\n")).toContain(
      `-> ${dangling}`,
    );
    expect(tripleKeys(removed.triples)).toEqual(await fullRebuildKeys());
  });

  it(`A5 a change to a TBox-form asset (label prefix__Name) falls back to a full rebuild ${REQ}`, async () => {
    const cache = new CacheManager(vaultPath);
    await cache.loadOrBuild();

    // Rename the class label: every task's exo__Instance_class object is a
    // SYMBOLIC IRI derived from this label, so a per-file delta of the class
    // file alone would leave every referrer stale.
    await writeFile(
      `${TBOX_DIR}/${CLASS_TASK}.md`,
      fm({
        exo__Asset_uid: CLASS_TASK,
        exo__Instance_class: '"[[exo__Class]]"',
        exo__Asset_label: "ems__Todo",
      }),
    );
    const spy = jest.spyOn(
      NoteToRDFConverter.prototype,
      "convertVaultWithValidation",
    );
    const result = await cache.loadOrBuild();
    expect(result.mode).toBe("rebuild");
    expect(result.rebuildReason).toMatch(/TBox-form/);
    // the rebuild walked the WHOLE vault, not a subset
    const opts = spy.mock.calls[0]?.[0] as { files?: unknown[] } | undefined;
    expect(opts?.files?.length).toBe(6);
    spy.mockRestore();

    const taskClass = objectsOf(
      result.triples,
      `${TASKS_DIR}/${TASK_A}.md`,
    ).filter((x) => x.includes("#Instance_class"));
    expect(taskClass.join("\n")).toContain("ems#Todo");
    expect(taskClass.join("\n")).not.toContain("ems#Task");
    expect(tripleKeys(result.triples)).toEqual(await fullRebuildKeys());
  });

  it(`A6 an absent, legacy or corrupt cache and an over-threshold diff fall back to a full rebuild ${REQ}`, async () => {
    const cache = new CacheManager(vaultPath);
    const cachePath = cache.getCachePath();

    // absent
    expect((await cache.loadOrBuild()).mode).toBe("rebuild");
    const written = await fs.readJson(cachePath);
    expect(written.metadata.formatVersion).toBe(CACHE_FORMAT_VERSION);
    expect(written.files).toHaveLength(6);
    expect(written.inferred).toEqual([]);

    // legacy (pre-#4263 shape: flat triples + root mtime) → invalid, rebuilt once
    await fs.writeJson(cachePath, {
      metadata: {
        version: "1.0.0",
        timestamp: Date.now(),
        vaultPath,
        tripleCount: 1,
        vaultMtime: (await fs.stat(vaultPath)).mtimeMs,
      },
      triples: [
        {
          subject: { type: "IRI", value: "obsidian://vault/stale.md" },
          predicate: {
            type: "IRI",
            value: "https://exocortex.my/ontology/exo#Asset_label",
          },
          object: { type: "Literal", value: "STALE" },
        },
      ],
    });
    expect(await cache.isCacheValid()).toBe(false);
    const fromLegacy = await cache.loadOrBuild();
    expect(fromLegacy.mode).toBe("rebuild");
    expect(JSON.stringify(tripleKeys(fromLegacy.triples))).not.toContain(
      "STALE",
    );
    expect((await fs.readJson(cachePath)).metadata.formatVersion).toBe(
      CACHE_FORMAT_VERSION,
    );

    // corrupt
    await fs.writeFile(cachePath, "{not json", "utf-8");
    expect(await cache.isCacheValid()).toBe(false);
    expect((await cache.loadOrBuild()).mode).toBe("rebuild");
    expect(await cache.isCacheValid()).toBe(true);

    // over threshold: 4 of 6 files change (> 50 %)
    for (const [uid, label] of [
      [TASK_A, "A2"],
      [TASK_B, "B2"],
      [TASK_C, "C2"],
    ] as const) {
      await writeFile(
        `${TASKS_DIR}/${uid}.md`,
        fm({
          exo__Asset_uid: uid,
          exo__Instance_class: `"[[${CLASS_TASK}]]"`,
          exo__Asset_label: `"${label}"`,
        }),
      );
    }
    await writeFile(
      `${PROJECTS_DIR}/${PROJECT_P}.md`,
      fm({
        exo__Asset_uid: PROJECT_P,
        exo__Instance_class: `"[[${CLASS_PROJECT}]]"`,
        exo__Asset_label: '"P2"',
      }),
    );
    const bulk = await cache.loadOrBuild();
    expect(bulk.mode).toBe("rebuild");
    expect(bulk.rebuildReason).toMatch(/4 of 6 files changed/);
    expect(tripleKeys(bulk.triples)).toEqual(await fullRebuildKeys());
  });

  it(`A7 the inferred layer persisted by index is re-materialized after a delta — neither stale nor dropped ${REQ}`, async () => {
    const cache = new CacheManager(vaultPath);
    await cache.loadOrBuild();

    // Stand-in for `index`'s materialization: an inferred triple whose
    // subject is Task B (so a delta touching B can go stale).
    const bRel = `${TASKS_DIR}/${TASK_B}.md`;
    const inferredPredicate =
      "https://exocortex.my/ontology/exo#Instance_class";
    const inferredObject = "https://exocortex.my/ontology/exo#Asset";
    await cache.saveInferredTriples([
      new Triple(
        new IRI(vaultPathToIRI(bRel)),
        new IRI(inferredPredicate),
        new IRI(inferredObject),
      ),
    ]);
    const withLayer = await cache.loadOrBuild();
    expect(withLayer.mode).toBe("hit");
    expect(objectsOf(withLayer.triples, bRel)).toContain(
      `${inferredPredicate} -> ${inferredObject}`,
    );

    // B's CLASS changes (an engine input) → delta → the layer is recomputed
    // by the SAME engines index runs. With this fixture's TBox (no
    // exo__Class_superClass edges, no prototypes) the engines infer nothing,
    // so the correct post-delta layer is EMPTY: the hand-seeded triple must be
    // gone (it would be stale), the explicit triples must be intact, and a
    // cache that never had a layer must not grow one.
    await writeFile(
      bRel,
      fm({
        exo__Asset_uid: TASK_B,
        exo__Instance_class: `"[[${CLASS_PROJECT}]]"`,
        exo__Asset_label: '"Task B v2"',
      }),
    );
    const delta = await cache.loadOrBuild();
    expect(delta.mode).toBe("delta");
    expect(objectsOf(delta.triples, bRel)).not.toContain(
      `${inferredPredicate} -> ${inferredObject}`,
    );
    expect(tripleKeys(delta.triples)).toEqual(await fullRebuildKeys());
    const persisted = await fs.readJson(cache.getCachePath());
    expect(persisted.metadata.inferredCount).toBe(0);

    // Now seed a layer the engines DO reproduce: Task A gets a PROTOTYPE that
    // owns ems__Effort_area, so PrototypeChainMaterializer inherits it onto A.
    const protoRel = `${TASKS_DIR}/${PROTO}.md`;
    const aRel = `${TASKS_DIR}/${TASK_A}.md`;
    await writeFile(
      protoRel,
      fm({
        exo__Asset_uid: PROTO,
        exo__Instance_class: `"[[${CLASS_TASK}]]"`,
        exo__Asset_label: '"Task prototype"',
        ems__Effort_area: `"[[${PROJECT_P}]]"`,
      }),
    );
    await writeFile(
      aRel,
      fm({
        exo__Asset_uid: TASK_A,
        exo__Instance_class: `"[[${CLASS_TASK}]]"`,
        exo__Asset_label: '"Task A"',
        exo__Asset_prototype: `"[[${PROTO}]]"`,
      }),
    );
    // Inference stayed ENABLED through the empty layer above, and A now
    // carries an Asset_prototype (an engine input) → the delta re-materializes
    // and the inherited triple is already in what loadOrBuild returns.
    const withProto = await cache.loadOrBuild();
    expect(withProto.mode).toBe("delta");
    const inheritedArea = `https://exocortex.my/ontology/ems#Effort_area -> ${vaultPathToIRI(`${PROJECTS_DIR}/${PROJECT_P}.md`)}`;
    expect(objectsOf(withProto.triples, aRel)).toContain(inheritedArea);
    const materialized = {
      inferredCount: (await fs.readJson(cache.getCachePath())).metadata
        .inferredCount as number,
    };
    expect(materialized.inferredCount).toBeGreaterThan(0);
    // and it equals what index's materialization computes from the explicit set
    const explicitOnly = withProto.triples.filter(
      (t) => !objectsOf([t], aRel).includes(inheritedArea),
    );
    expect((await materializeInferredTriples(explicitOnly)).inferredCount).toBe(
      materialized.inferredCount,
    );
    expect(objectsOf((await cache.loadOrBuild()).triples, aRel)).toContain(
      inheritedArea,
    );

    // A delta on Task C (unrelated to A, no engine input touched) keeps A's
    // inherited triple: the layer is kept, not dropped, at the same size.
    const cRel = `${TASKS_DIR}/${TASK_C}.md`;
    await writeFile(
      cRel,
      fm({
        exo__Asset_uid: TASK_C,
        exo__Instance_class: `"[[${CLASS_TASK}]]"`,
        exo__Asset_label: '"Task C v2"',
      }),
    );
    const delta2 = await cache.loadOrBuild();
    expect(delta2.mode).toBe("delta");
    expect(objectsOf(delta2.triples, aRel)).toContain(inheritedArea);
    const persisted2 = await fs.readJson(cache.getCachePath());
    expect(persisted2.metadata.inferredCount).toBe(materialized.inferredCount);
    expect(persisted2.metadata.inferredCount).toBeGreaterThan(0);

    // And once A stops pointing at the prototype, the recomputed layer no
    // longer carries the inherited value (a stale layer would).
    await writeFile(
      aRel,
      fm({
        exo__Asset_uid: TASK_A,
        exo__Instance_class: `"[[${CLASS_TASK}]]"`,
        exo__Asset_label: '"Task A"',
      }),
    );
    const delta3 = await cache.loadOrBuild();
    expect(delta3.mode).toBe("delta");
    expect(objectsOf(delta3.triples, aRel)).not.toContain(inheritedArea);
  });

  it(`A9 body-link referrers (bare linkpath literal) of an added target are re-parsed ${REQ}`, async () => {
    // A links to D in its BODY; D does not exist → `exo:Asset_bodyLink "<uid>"`
    // (a bare literal, not a wikilink) — HIGH-1 of the orchestrator review.
    const aRel = `${TASKS_DIR}/${TASK_A}.md`;
    const dRel = `${TASKS_DIR}/${TASK_D}.md`;
    await writeFile(
      aRel,
      fm({
        exo__Asset_uid: TASK_A,
        exo__Instance_class: `"[[${CLASS_TASK}]]"`,
        exo__Asset_label: '"Task A"',
      }) + `See also [[${TASK_D}]] in the body.\n`,
    );
    const cache = new CacheManager(vaultPath);
    const built = await cache.loadOrBuild();
    const bodyLinks = objectsOf(built.triples, aRel).filter((x) =>
      x.includes("#Asset_bodyLink"),
    );
    expect(bodyLinks).toEqual([
      `https://exocortex.my/ontology/exo#Asset_bodyLink -> ${TASK_D}`,
    ]);

    await writeFile(
      dRel,
      fm({
        exo__Asset_uid: TASK_D,
        exo__Instance_class: `"[[${CLASS_TASK}]]"`,
        exo__Asset_label: '"Task D"',
      }),
    );
    const spy = jest.spyOn(NoteToRDFConverter.prototype, "convertNote");
    const added = await cache.loadOrBuild();
    const reparsed = spy.mock.calls
      .map((c) => (c[0] as { path: string }).path)
      .sort();
    spy.mockRestore();
    expect(added.mode).toBe("delta");
    expect(reparsed).toEqual([aRel, dRel].sort());
    expect(
      objectsOf(added.triples, aRel).filter((x) =>
        x.includes("#Asset_bodyLink"),
      ),
    ).toEqual([
      `https://exocortex.my/ontology/exo#Asset_bodyLink -> ${vaultPathToIRI(dRel)}`,
    ]);
    expect(tripleKeys(added.triples)).toEqual(await fullRebuildKeys());
  });

  it(`A10 an alias change on a non-TBox target re-parses the referrers that resolve through it ${REQ}`, async () => {
    // B links to P by ALIAS (frontmatter link, non-UUID linkpath) — MEDIUM-2.
    const pRel = `${PROJECTS_DIR}/${PROJECT_P}.md`;
    const bRel = `${TASKS_DIR}/${TASK_B}.md`;
    const projectFm = (alias: string) =>
      fm({
        exo__Asset_uid: PROJECT_P,
        exo__Instance_class: `"[[${CLASS_PROJECT}]]"`,
        exo__Asset_label: '"Project P"',
        aliases: `["${alias}"]`,
      });
    await writeFile(pRel, projectFm("Project Alpha"));
    await writeFile(
      bRel,
      fm({
        exo__Asset_uid: TASK_B,
        exo__Instance_class: `"[[${CLASS_TASK}]]"`,
        exo__Asset_label: '"Task B"',
        ems__Effort_parent: '"[[Project Alpha]]"',
      }),
    );
    const cache = new CacheManager(vaultPath);
    const built = await cache.loadOrBuild();
    const resolvedParent = `#Effort_parent -> ${vaultPathToIRI(pRel)}`;
    expect(objectsOf(built.triples, bRel).join("\n")).toContain(resolvedParent);

    // the alias is renamed → B's link no longer resolves → B must be re-parsed
    await writeFile(pRel, projectFm("Project Beta"));
    const spy = jest.spyOn(NoteToRDFConverter.prototype, "convertNote");
    const renamed = await cache.loadOrBuild();
    const reparsed = spy.mock.calls
      .map((c) => (c[0] as { path: string }).path)
      .sort();
    spy.mockRestore();
    expect(renamed.mode).toBe("delta");
    // P itself + every file holding P's file-IRI (the cache cannot tell which
    // of them resolved through the alias, so all of them — a superset — are
    // re-parsed; B is the one whose emission actually changes)
    expect(reparsed).toEqual(expect.arrayContaining([bRel, pRel]));
    expect(reparsed).not.toContain(`${TBOX_DIR}/${CLASS_TASK}.md`);
    expect(objectsOf(renamed.triples, bRel).join("\n")).not.toContain(
      resolvedParent,
    );
    expect(tripleKeys(renamed.triples)).toEqual(await fullRebuildKeys());

    // and back (case differs — the adapter's alias index is case-insensitive):
    // B holds the raw link literal now and must be re-parsed by needle
    await writeFile(pRel, projectFm("project alpha"));
    const back = await cache.loadOrBuild();
    expect(back.mode).toBe("delta");
    expect(objectsOf(back.triples, bRel).join("\n")).toContain(resolvedParent);
    expect(tripleKeys(back.triples)).toEqual(await fullRebuildKeys());
  });

  it(`A11 TBox guards on removal / basename / lost label each force a rebuild ${REQ}`, async () => {
    const cache = new CacheManager(vaultPath);
    await cache.loadOrBuild();

    // (a) the UID-named class file (TBox label in its cached triples) is removed
    await fs.remove(path.join(vaultPath, `${TBOX_DIR}/${CLASS_PROJECT}.md`));
    const removedClass = await cache.loadOrBuild();
    expect(removedClass.mode).toBe("rebuild");
    expect(removedClass.rebuildReason).toMatch(/TBox-form asset removed/);
    expect(tripleKeys(removedClass.triples)).toEqual(await fullRebuildKeys());

    // (b) a label-NAMED TBox file (legacy basename form) is added, then removed
    const legacyRel = `${TBOX_DIR}/ems__Area.md`;
    await writeFile(
      legacyRel,
      fm({
        exo__Asset_uid: "7f2f0a4b-0f2e-4a1c-9d1e-4263a0000099",
        exo__Instance_class: '"[[exo__Class]]"',
      }),
    );
    const addedLegacy = await cache.loadOrBuild();
    expect(addedLegacy.mode).toBe("rebuild");
    expect(addedLegacy.rebuildReason).toMatch(/TBox-form file changed/);
    await fs.remove(path.join(vaultPath, legacyRel));
    const removedLegacy = await cache.loadOrBuild();
    expect(removedLegacy.mode).toBe("rebuild");
    expect(removedLegacy.rebuildReason).toMatch(/TBox-form file removed/);

    // (c) the task class file LOSES its TBox label (becomes a human label)
    await writeFile(
      `${TBOX_DIR}/${CLASS_TASK}.md`,
      fm({
        exo__Asset_uid: CLASS_TASK,
        exo__Instance_class: '"[[exo__Class]]"',
        exo__Asset_label: '"Task class"',
      }),
    );
    const lost = await cache.loadOrBuild();
    expect(lost.mode).toBe("rebuild");
    expect(lost.rebuildReason).toMatch(/lost its TBox-form label/);
    expect(tripleKeys(lost.triples)).toEqual(await fullRebuildKeys());
  });

  it(`A12 a TBox-labelled file the converter SKIPPED still forces a rebuild when removed ${REQ}`, async () => {
    // MEDIUM-5: no triples were committed for it (invariant violation), yet
    // referrers read its frontmatter directly and emit symbolically.
    const skippedRel = `${TBOX_DIR}/7f2f0a4b-0f2e-4a1c-9d1e-4263a0000098.md`;
    await writeFile(
      skippedRel,
      fm({
        exo__Asset_uid: "7f2f0a4b-0f2e-4a1c-9d1e-4263a0000098",
        exo__Instance_class: '""',
        exo__Asset_label: "ems__Sprint",
      }),
    );
    const cache = new CacheManager(vaultPath);
    const built = await cache.loadOrBuild();
    expect(objectsOf(built.triples, skippedRel)).toEqual([]);
    const persisted = await fs.readJson(cache.getCachePath());
    const entry = persisted.files.find(
      (f: { path: string }) => f.path === skippedRel,
    );
    expect(entry.triples).toEqual([]);
    expect(entry.tboxLabel).toBe(true);

    await fs.remove(path.join(vaultPath, skippedRel));
    const removed = await cache.loadOrBuild();
    expect(removed.mode).toBe("rebuild");
    expect(removed.rebuildReason).toMatch(/TBox-form asset removed/);
  });

  it(`A13 two concurrent loadOrBuild() calls after an edit both return a complete, parseable cache ${REQ}`, async () => {
    // HIGH-2: the write is tmp+rename, so a reader never sees a half-written file.
    const cache = new CacheManager(vaultPath);
    await cache.loadOrBuild();
    await writeFile(
      `${TASKS_DIR}/${TASK_C}.md`,
      fm({
        exo__Asset_uid: TASK_C,
        exo__Instance_class: `"[[${CLASS_TASK}]]"`,
        exo__Asset_label: '"Task C v2"',
      }),
    );
    // The write protocol itself: nothing is ever written IN PLACE — every
    // JSON write targets a sibling temp file that is then renamed over the
    // cache path (a reader can only ever see a complete file).
    const writeJson = jest.spyOn(fs, "writeJson");
    const rename = jest.spyOn(fs, "rename");
    const [r1, r2] = await Promise.all([
      new CacheManager(vaultPath).loadOrBuild(),
      new CacheManager(vaultPath).loadOrBuild(),
    ]);
    const cachePath = cache.getCachePath();
    const writeTargets = writeJson.mock.calls.map((c) => String(c[0]));
    expect(writeTargets.length).toBeGreaterThan(0);
    for (const target of writeTargets) {
      expect(target).not.toBe(cachePath);
      expect(path.dirname(target)).toBe(path.dirname(cachePath));
      expect(target.endsWith(".tmp")).toBe(true);
    }
    const renamedOnto = rename.mock.calls.map((c) => String(c[1]));
    expect(renamedOnto).toContain(cachePath);
    writeJson.mockRestore();
    rename.mockRestore();
    expect(["delta", "hit"]).toContain(r1.mode);
    expect(["delta", "hit"]).toContain(r2.mode);
    const expected = await fullRebuildKeys();
    expect(tripleKeys(r1.triples)).toEqual(expected);
    expect(tripleKeys(r2.triples)).toEqual(expected);
    const persisted = await fs.readJson(cache.getCachePath()); // parses → complete
    expect(persisted.metadata.formatVersion).toBe(CACHE_FORMAT_VERSION);
    expect(await cache.isCacheValid()).toBe(true);
    const leftovers = (
      await fs.readdir(path.dirname(cache.getCachePath()))
    ).filter((f) => f.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it(`A14 inference stays enabled across deltas: the layer is recomputed only when an engine input changed, and an emptied layer comes back ${REQ}`, async () => {
    // MEDIUM-4 (flag, not `inferred.length`) + MEDIUM-3 (no recomputation
    // when no engine input moved).
    const protoRel = `${TASKS_DIR}/${PROTO}.md`;
    const aRel = `${TASKS_DIR}/${TASK_A}.md`;
    const cRel = `${TASKS_DIR}/${TASK_C}.md`;
    const protoFm = (area: string) =>
      fm({
        exo__Asset_uid: PROTO,
        exo__Instance_class: `"[[${CLASS_TASK}]]"`,
        exo__Asset_label: '"Task prototype"',
        ems__Effort_area: `"[[${area}]]"`,
      });
    const taskAFm = (withProto: boolean) =>
      fm({
        exo__Asset_uid: TASK_A,
        exo__Instance_class: `"[[${CLASS_TASK}]]"`,
        exo__Asset_label: '"Task A"',
        ...(withProto ? { exo__Asset_prototype: `"[[${PROTO}]]"` } : {}),
      });
    await writeFile(protoRel, protoFm(PROJECT_P));
    await writeFile(aRel, taskAFm(true));
    const cache = new CacheManager(vaultPath);
    const built = await cache.loadOrBuild();
    const materialized = await materializeInferredTriples(built.triples);
    expect(materialized.inferredCount).toBeGreaterThan(0);
    await cache.saveInferredTriples(materialized.inferred);
    const areaP = `https://exocortex.my/ontology/ems#Effort_area -> ${vaultPathToIRI(`${PROJECTS_DIR}/${PROJECT_P}.md`)}`;
    const areaB = `https://exocortex.my/ontology/ems#Effort_area -> ${vaultPathToIRI(`${TASKS_DIR}/${TASK_B}.md`)}`;
    expect(
      (await fs.readJson(cache.getCachePath())).metadata.inferenceEnabled,
    ).toBe(true);

    // (1) a label edit on plain Task C touches no engine input → the layer is
    // kept verbatim (no re-materialization) and still served
    await writeFile(
      cRel,
      fm({
        exo__Asset_uid: TASK_C,
        exo__Instance_class: `"[[${CLASS_TASK}]]"`,
        exo__Asset_label: '"Task C v2"',
      }),
    );
    const d1 = await cache.loadOrBuild();
    expect(d1.mode).toBe("delta");
    expect(d1.inferredRecomputed).toBe(false);
    expect(objectsOf(d1.triples, aRel)).toContain(areaP);

    // (2) the prototype's own property changes → engine input → recomputed
    await writeFile(protoRel, protoFm(TASK_B));
    const d2 = await cache.loadOrBuild();
    expect(d2.mode).toBe("delta");
    expect(d2.inferredRecomputed).toBe(true);
    expect(objectsOf(d2.triples, aRel)).not.toContain(areaP);
    expect(objectsOf(d2.triples, aRel)).toContain(areaB);

    // (3) the only prototype-bearing instance drops its prototype → the layer
    // becomes EMPTY but inference stays enabled …
    await writeFile(aRel, taskAFm(false));
    const d3 = await cache.loadOrBuild();
    expect(d3.mode).toBe("delta");
    expect(d3.inferredRecomputed).toBe(true);
    expect(objectsOf(d3.triples, aRel)).not.toContain(areaB);
    const emptied = await fs.readJson(cache.getCachePath());
    expect(emptied.metadata.inferredCount).toBe(0);
    expect(emptied.metadata.inferenceEnabled).toBe(true);

    // … and comes back when the prototype link returns (a length-based flag
    // would have left the cache without a layer forever)
    await writeFile(aRel, taskAFm(true));
    const d4 = await cache.loadOrBuild();
    expect(d4.mode).toBe("delta");
    expect(d4.inferredRecomputed).toBe(true);
    expect(objectsOf(d4.triples, aRel)).toContain(areaB);
    expect(
      (await fs.readJson(cache.getCachePath())).metadata.inferredCount,
    ).toBeGreaterThan(0);
  });

  it(`A16 a TBox-form alias on a human-labelled target forces a rebuild when the alias is added, removed, or arrives with a new file ${REQ}`, async () => {
    // Review round 2, N1. P keeps its human label; the alias `ems__Sprint` is
    // emitted as a SYMBOLIC IRI, and B's `[[ems__Sprint]]` link resolves to
    // P's file-IRI while the alias exists and to the symbolic `ems#Sprint`
    // while it does not — a flip no literal needle and no file-IRI scan can
    // find, so the cache must rebuild.
    const pRel = `${PROJECTS_DIR}/${PROJECT_P}.md`;
    const bRel = `${TASKS_DIR}/${TASK_B}.md`;
    const sRel = `${PROJECTS_DIR}/7f2f0a4b-0f2e-4a1c-9d1e-4263a0000016.md`;
    const projectFm = (alias: string | null) =>
      fm({
        exo__Asset_uid: PROJECT_P,
        exo__Instance_class: `"[[${CLASS_PROJECT}]]"`,
        exo__Asset_label: '"Project P"',
        ...(alias ? { aliases: `["${alias}"]` } : {}),
      });
    await writeFile(
      bRel,
      fm({
        exo__Asset_uid: TASK_B,
        exo__Instance_class: `"[[${CLASS_TASK}]]"`,
        exo__Asset_label: '"Task B"',
        ems__Effort_parent: '"[[ems__Sprint]]"',
      }),
    );
    const symbolic =
      "#Effort_parent -> https://exocortex.my/ontology/ems#Sprint";
    const viaP = `#Effort_parent -> ${vaultPathToIRI(pRel)}`;
    const viaS = `#Effort_parent -> ${vaultPathToIRI(sRel)}`;
    const cache = new CacheManager(vaultPath);
    const built = await cache.loadOrBuild();
    expect(objectsOf(built.triples, bRel).join("\n")).toContain(symbolic);

    // (c) alias ADDED to the existing P → B now resolves to P's file-IRI
    await writeFile(pRel, projectFm("ems__Sprint"));
    const added = await cache.loadOrBuild();
    expect(added.mode).toBe("rebuild");
    expect(added.rebuildReason).toContain("alias");
    expect(objectsOf(added.triples, bRel).join("\n")).toContain(viaP);
    expect(objectsOf(added.triples, bRel).join("\n")).not.toContain(symbolic);
    expect(tripleKeys(added.triples)).toEqual(await fullRebuildKeys());

    // (a) alias REMOVED from P → B falls back to the symbolic IRI. The old
    // alias never was a literal in P's cached triples, so only the persisted
    // IRI-typed alias object can tell the cache that P carried one.
    await writeFile(pRel, projectFm(null));
    const removed = await cache.loadOrBuild();
    expect(removed.mode).toBe("rebuild");
    expect(removed.rebuildReason).toContain("alias");
    expect(objectsOf(removed.triples, bRel).join("\n")).toContain(symbolic);
    expect(objectsOf(removed.triples, bRel).join("\n")).not.toContain(viaP);
    expect(tripleKeys(removed.triples)).toEqual(await fullRebuildKeys());

    // (b) a NEW file S arrives carrying the alias → B resolves to S
    await writeFile(
      sRel,
      fm({
        exo__Asset_uid: "7f2f0a4b-0f2e-4a1c-9d1e-4263a0000016",
        exo__Instance_class: `"[[${CLASS_PROJECT}]]"`,
        exo__Asset_label: '"Sprint (human label)"',
        aliases: '["ems__Sprint"]',
      }),
    );
    const arrived = await cache.loadOrBuild();
    expect(arrived.mode).toBe("rebuild");
    expect(arrived.rebuildReason).toContain("alias");
    expect(objectsOf(arrived.triples, bRel).join("\n")).toContain(viaS);
    expect(objectsOf(arrived.triples, bRel).join("\n")).not.toContain(symbolic);
    expect(tripleKeys(arrived.triples)).toEqual(await fullRebuildKeys());

    // control: a human-form alias on the same file stays on the delta path
    await fs.remove(path.join(vaultPath, sRel));
    await cache.loadOrBuild();
    await writeFile(pRel, projectFm("Sprint P"));
    const human = await cache.loadOrBuild();
    expect(human.mode).toBe("delta");
    expect(tripleKeys(human.triples)).toEqual(await fullRebuildKeys());
  });

  it(`A17 a pure alias addition re-parses the referrers that will resolve through the new alias, not every holder of the target's file-IRI ${REQ}`, async () => {
    // Review round 2, N7. A links P by UID (holds P's file-IRI — unaffected
    // by a NEW alias), B links P by the future alias (raw literal until the
    // alias exists). Adding the alias must re-parse B, not A.
    const pRel = `${PROJECTS_DIR}/${PROJECT_P}.md`;
    const aRel = `${TASKS_DIR}/${TASK_A}.md`;
    const bRel = `${TASKS_DIR}/${TASK_B}.md`;
    const projectFm = (aliases: string[]) =>
      fm({
        exo__Asset_uid: PROJECT_P,
        exo__Instance_class: `"[[${CLASS_PROJECT}]]"`,
        exo__Asset_label: '"Project P"',
        ...(aliases.length
          ? { aliases: `[${aliases.map((a) => `"${a}"`).join(", ")}]` }
          : {}),
      });
    await writeFile(
      bRel,
      fm({
        exo__Asset_uid: TASK_B,
        exo__Instance_class: `"[[${CLASS_TASK}]]"`,
        exo__Asset_label: '"Task B"',
        ems__Effort_parent: '"[[Project Alpha]]"',
      }),
    );
    const cache = new CacheManager(vaultPath);
    const built = await cache.loadOrBuild();
    const viaP = `#Effort_parent -> ${vaultPathToIRI(pRel)}`;
    expect(objectsOf(built.triples, aRel).join("\n")).toContain(viaP);
    expect(objectsOf(built.triples, bRel).join("\n")).not.toContain(viaP);

    // pure ADDITION (no alias existed before)
    await writeFile(pRel, projectFm(["Project Alpha"]));
    const spy = jest.spyOn(NoteToRDFConverter.prototype, "convertNote");
    const withAlias = await cache.loadOrBuild();
    const reparsed = spy.mock.calls
      .map((c) => (c[0] as { path: string }).path)
      .sort();
    spy.mockRestore();
    expect(withAlias.mode).toBe("delta");
    expect(reparsed).toEqual([bRel, pRel].sort());
    expect(reparsed).not.toContain(aRel);
    expect(objectsOf(withAlias.triples, bRel).join("\n")).toContain(viaP);
    expect(tripleKeys(withAlias.triples)).toEqual(await fullRebuildKeys());

    // adding a SECOND alias (still no removal) — same rule
    await writeFile(pRel, projectFm(["Project Alpha", "Project Alpha 2"]));
    const spy2 = jest.spyOn(NoteToRDFConverter.prototype, "convertNote");
    const second = await cache.loadOrBuild();
    const reparsed2 = spy2.mock.calls
      .map((c) => (c[0] as { path: string }).path)
      .sort();
    spy2.mockRestore();
    expect(second.mode).toBe("delta");
    expect(reparsed2).toEqual([pRel]);
    expect(tripleKeys(second.triples)).toEqual(await fullRebuildKeys());
  });

  it(`A15 a FileSpace declaration removed or edited forces a rebuild, and a label-form declaration is detected ${REQ}`, async () => {
    // MEDIUM-1. The declaration lives OUTSIDE its mount (convention); the
    // mount is derived from exo__AssetSpace_source → assetspaces/owner/files-repo/.
    const declRel = "spaces/files.md";
    const blobRel = "assetspaces/owner/files-repo/blob.md";
    const declFm = (classRef: string) =>
      fm({
        exo__Asset_uid: "7f2f0a4b-0f2e-4a1c-9d1e-4263a0000097",
        exo__Instance_class: `"${classRef}"`,
        exo__Asset_label: '"Attachments"',
        exo__AssetSpace_source: "https://github.com/owner/files-repo",
      });
    await writeFile(
      declRel,
      declFm("[[aad8913e-5e9f-4047-879d-93cc46befd52|exo__FileSpace]]"),
    );
    await writeFile(
      blobRel,
      fm({
        exo__Asset_uid: "7f2f0a4b-0f2e-4a1c-9d1e-4263a0000096",
        exo__Instance_class: `"[[${CLASS_TASK}]]"`,
        exo__Asset_label: '"Blob"',
      }),
    );
    const cache = new CacheManager(vaultPath);
    const built = await cache.loadOrBuild();
    expect(objectsOf(built.triples, blobRel)).toEqual([]);
    const persisted = await fs.readJson(cache.getCachePath());
    expect(persisted.metadata.fileSpacePrefixes).toEqual([
      "assetspaces/owner/files-repo/",
    ]);
    expect(persisted.metadata.fileSpaceDeclarations).toEqual([declRel]);

    // remove the declaration → the mount must be indexed again → rebuild
    await fs.remove(path.join(vaultPath, declRel));
    const removed = await cache.loadOrBuild();
    expect(removed.mode).toBe("rebuild");
    expect(removed.rebuildReason).toMatch(/FileSpace declaration removed/);
    expect(objectsOf(removed.triples, blobRel).join("\n")).toContain("Blob");

    // a NEW declaration in LABEL form (not the UUID the cheap probe knows) → rebuild
    await writeFile(declRel, declFm("[[exo__FileSpace]]"));
    const labelForm = await cache.loadOrBuild();
    expect(labelForm.mode).toBe("rebuild");
    expect(labelForm.rebuildReason).toMatch(/FileSpace declaration changed/);

    // editing the (persisted) declaration itself → rebuild too
    await writeFile(
      declRel,
      declFm("[[aad8913e-5e9f-4047-879d-93cc46befd52|exo__FileSpace]]"),
    );
    const edited = await cache.loadOrBuild();
    expect(edited.mode).toBe("rebuild");
    expect(edited.rebuildReason).toMatch(/FileSpace declaration changed/);
  });

  it(`A8 loadVaultTriples: the no-cache path is a plain convertVault (no cache file) and the cache path yields the same set ${REQ}`, async () => {
    const cachePath = new CacheManager(vaultPath).getCachePath();

    const plain = await loadVaultTriples(vaultPath, { useCache: false });
    expect(plain.mode).toBe("full-parse");
    expect(plain.cacheHit).toBe(false);
    expect(await fs.pathExists(cachePath)).toBe(false);
    expect(tripleKeys(plain.triples)).toEqual(await fullRebuildKeys());

    const cached = await loadVaultTriples(vaultPath, { useCache: true });
    expect(cached.mode).toBe("rebuild");
    expect(await fs.pathExists(cachePath)).toBe(true);
    expect(tripleKeys(cached.triples)).toEqual(tripleKeys(plain.triples));

    const hit = await loadVaultTriples(vaultPath, { useCache: true });
    expect(hit.mode).toBe("hit");
    expect(hit.cacheHit).toBe(true);
    expect(tripleKeys(hit.triples)).toEqual(tripleKeys(plain.triples));
  });

  // Ticket d5ad5217 (founder decision 2026-09-19): the converter tags a whole YAML
  // number xsd:integer (was xsd:decimal for every number). The cache persists the
  // tag, and its entries are keyed by file mtime — so a cache written by the
  // previous CLI (formatVersion 2, `"3"^^xsd:decimal`) is byte-for-byte VALID by
  // manifest and would keep serving the old tag for every unchanged file. The
  // format bump (2 → 3) is what retires it; this axis pins the bump: RED when
  // CACHE_FORMAT_VERSION is set back to 2 (the v2 cache is then accepted and the
  // decimal tag served), GREEN at 3 (rebuilt, integer tag).
  it(`A18 @req:d553b1a4-c312-4819-964d-fe6dae0a50e1 a warm pre-d5ad5217 cache (formatVersion 2, integer stored as "3"^^xsd:decimal) is invalid and rebuilt — the integer tag reaches the caller`, async () => {
    const WEIGHT = "https://exocortex.my/ontology/ems#Task_weight";
    const XSD = "http://www.w3.org/2001/XMLSchema#";
    await writeFile(
      `${TASKS_DIR}/${TASK_A}.md`,
      fm({
        exo__Asset_uid: TASK_A,
        exo__Instance_class: `"[[${CLASS_TASK}]]"`,
        exo__Asset_label: '"Task A"',
        ems__Effort_parent: `"[[${PROJECT_P}]]"`,
        ems__Task_weight: "3",
      }),
    );
    const weightTag = (triples: TripleT[]): string[] =>
      triples
        .filter(
          (t) =>
            serializeNode(t.subject).value ===
              vaultPathToIRI(`${TASKS_DIR}/${TASK_A}.md`) &&
            serializeNode(t.predicate).value === WEIGHT,
        )
        .map(
          (t) =>
            `${serializeNode(t.object).value}^^${serializeNode(t.object).datatype}`,
        );

    const cache = new CacheManager(vaultPath);
    const cachePath = cache.getCachePath();
    const fresh = await cache.loadOrBuild();
    expect(fresh.mode).toBe("rebuild");
    expect(weightTag(fresh.triples)).toEqual([`3^^${XSD}integer`]);
    const written = await fs.readJson(cachePath);
    expect(written.metadata.formatVersion).toBe(CACHE_FORMAT_VERSION);

    // Rewrite the persisted cache as the previous CLI would have left it:
    // same manifest (mtimes unchanged ⇒ every entry "fresh"), v2 format, and
    // the pre-parity decimal tag on the whole number.
    const stale = JSON.parse(
      JSON.stringify(written).split(`${XSD}integer`).join(`${XSD}decimal`),
    );
    stale.metadata.formatVersion = 2;
    await fs.writeJson(cachePath, stale);
    expect(JSON.stringify(stale)).toContain(`3","datatype":"${XSD}decimal`);

    expect(await cache.isCacheValid()).toBe(false);
    const rebuilt = await cache.loadOrBuild();
    expect(rebuilt.mode).toBe("rebuild");
    expect(weightTag(rebuilt.triples)).toEqual([`3^^${XSD}integer`]);
    expect((await fs.readJson(cachePath)).metadata.formatVersion).toBe(
      CACHE_FORMAT_VERSION,
    );

    // and the shared loader's cache path surfaces the same tag
    const viaLoader = await loadVaultTriples(vaultPath, { useCache: true });
    expect(viaLoader.mode).toBe("hit");
    expect(weightTag(viaLoader.triples)).toEqual([`3^^${XSD}integer`]);
  });
});
