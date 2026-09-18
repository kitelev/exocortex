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
  return triples
    .map((t) => {
      const s = serializeNode(t.subject);
      const p = serializeNode(t.predicate);
      const o = serializeNode(t.object);
      return `${s.value} ${p.value} ${o.type}:${o.value}`;
    })
    .sort();
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
    await fs.utimes(vaultPath, rootBefore / 1000, rootBefore / 1000);
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
    await fs.utimes(vaultPath, rootBefore / 1000, rootBefore / 1000);
    expect(await cache.isCacheValid()).toBe(false);
    expect((await cache.computeManifestDiff())?.added).toEqual([
      `${TASKS_DIR}/${TASK_D}.md`,
    ]);
    await cache.loadOrBuild();
    expect(await cache.isCacheValid()).toBe(true);

    // delete
    await fs.remove(path.join(vaultPath, `${TASKS_DIR}/${TASK_D}.md`));
    await fs.utimes(vaultPath, rootBefore / 1000, rootBefore / 1000);
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

    // B changes → delta → the layer is recomputed by the SAME engines index
    // runs. With this fixture's TBox (no exo__Class_superClass edges, no
    // prototypes) the engines infer nothing, so the correct post-delta layer
    // is EMPTY: the hand-seeded triple must be gone (it would be stale), the
    // explicit triples must be intact, and a cache that never had a layer
    // must not grow one.
    await writeFile(
      bRel,
      fm({
        exo__Asset_uid: TASK_B,
        exo__Instance_class: `"[[${CLASS_TASK}]]"`,
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
    const withProto = await cache.loadOrBuild(); // add + modify → delta, no layer yet
    expect(withProto.mode).toBe("delta");
    const { materializeInferredTriples } =
      await import("../../src/cache/materializeInferred.js");
    const materialized = await materializeInferredTriples(withProto.triples);
    expect(materialized.inferredCount).toBeGreaterThan(0);
    await cache.saveInferredTriples(materialized.inferred);
    const inheritedArea = `https://exocortex.my/ontology/ems#Effort_area -> ${vaultPathToIRI(`${PROJECTS_DIR}/${PROJECT_P}.md`)}`;
    expect(objectsOf((await cache.loadOrBuild()).triples, aRel)).toContain(
      inheritedArea,
    );

    // A delta on Task C (unrelated to A) keeps A's inherited triple: the layer
    // is recomputed, not dropped, and lands at the same size.
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
});
