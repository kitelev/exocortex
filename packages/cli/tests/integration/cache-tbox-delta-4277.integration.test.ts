/**
 * #4277 — CacheManager: a MODIFIED TBox-form asset whose referrer-visible
 * projection (own `exo:Asset_label` IRI object, TBox-form `exo:Asset_aliases`
 * set, `exo:Instance_class` objects in order) is unchanged refreshes as a
 * DELTA; every projection change keeps the #4263 rebuild; a reader's rebuild
 * inherits the inferred layer of the cache it displaces. Driven through the
 * REAL `NoteToRDFConverter` + `FileSystemVaultAdapter` on a temp vault that
 * carries the traps a live vault has: a TBox-form label + TBox-form alias on
 * one asset (the `exo__SettingKey*` shape of vault-bot-kitelev), a `[[uid]]`
 * referrer (symbolic IRI + co-emitted type triples), a `[[prefix__Name]]`
 * referrer (alias index → file-IRI), a case-different alias referrer, a body
 * link, a duplicate TBox label, a human-labelled asset with a TBox-form alias,
 * and a prototype chain for the inferred layer.
 *
 * Requirement: @req:1117f9fe-925f-4d9c-9368-d58eea4b07dc
 *
 * Axes (machine key for the mutant driver — `T<N>`):
 *   T1  touch a TBox-form asset (datatype + body changed, projection same) with an inferred cache
 *       → delta, 1 file re-parsed, layer kept, explicit == full parse, inferred == full materialisation
 *   T2  the same touch on a layer-less cache → delta without a layer
 *   T3  label VALUE change (exo__A → exo__B) → rebuild "TBox-form asset changed", == full parse
 *   T4  label lost / gained → rebuild with the #4263 reasons
 *   T5  TBox-form alias added / removed on the TBox-labelled asset → rebuild "TBox-form alias"
 *   T6  exo__Instance_class change on the TBox-form asset → rebuild, the [[uid]] referrer's type triples follow
 *   T7  added / removed TBox-form file → rebuild (unchanged from #4263)
 *   T8  a converter-SKIPPED TBox-labelled entry that loses its label → rebuild (projection unreadable)
 *   T9  warm rebuild (inferenceEnabled: true, rebuild-class diff) → layer inherited: flag true, inferredCount > 0,
 *       triples = explicit + inferred, explicitCount = explicit, inferred == full materialisation
 *   T10 cold / layer-less / legacy rebuild → no layer (explicitCount === triples.length, flag false)
 *   T11 write-through: unchanged projection → "delta"; label change → "skipped" with the reason
 *   T12 `buildCacheWithValidation` (what `index` runs) still builds layer-less
 *   T13 human-labelled asset with an unchanged TBox-form alias + a changed body → delta; alias-set change → rebuild
 *   T14 the second copy of a duplicate TBox label: touching one is a delta, renaming it is a rebuild
 *   T15 the exo__Instance_class list of a TBox-form asset re-ordered → rebuild (referrers co-emit the FIRST one)
 *   T16 a modified TBox-form file the converter THROWS on (empty exo__* literal) → rebuild, never a crashed reader;
 *       the write-through reports "skipped", not "failed"                                 (review r1, F1)
 *   T17 cacheLoadNotice names the inherited layer on a rebuild, and only then                  (review r1, L3)
 *
 * Revert-verify (mutants applied to a COPY of the tree by the driver spec
 * `tests/integration/cache-tbox-delta-4277.spec.json`): every-TBox-change-is-a-delta →
 * T3/T4/T5/T6 RED; presence-not-value compare → T3 RED; alias set ignored → T5 RED;
 * Instance_class ignored → T6 RED; rebuild always materialises → T10 RED; never → T9 RED.
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs-extra";
import path from "path";
import os from "os";
import {
  NoteToRDFConverter,
  vaultPathToIRI,
  type Triple as TripleT,
} from "@kitelev/exocortex-core";
import { FileSystemVaultAdapter } from "../../src/adapters/FileSystemVaultAdapter.js";
import { CacheManager, serializeNode } from "../../src/cache/CacheManager.js";
import { cacheLoadNotice, loadVaultTriples } from "../../src/cache/loadVaultTriples.js";
import { materializeInferredTriples, tripleKey } from "../../src/cache/materializeInferred.js";

const REQ = "@req:1117f9fe-925f-4d9c-9368-d58eea4b07dc";

// UID-named assets (UID-canon TBox/ABox, CLAUDE.md)
const CLASS_CLASS = "42770000-0000-4000-8000-000000000001"; // exo__Class
const CLASS_TASK = "42770000-0000-4000-8000-000000000002"; // ems__Task
const CLASS_SETTINGKEY = "42770000-0000-4000-8000-000000000003"; // exo__SettingKey
const CLASS_STATUS = "42770000-0000-4000-8000-000000000004"; // ems__EffortStatus
const KEY_A = "42770000-0000-4000-8000-000000000010"; // exo__SettingKeyAlpha — label + alias TBox-form (the bot's shape)
const KEY_DUP1 = "42770000-0000-4000-8000-000000000011"; // exo__SettingKeyDup (duplicate label, copy 1)
const KEY_DUP2 = "42770000-0000-4000-8000-000000000012"; // exo__SettingKeyDup (duplicate label, copy 2)
const STATUS_DONE = "42770000-0000-4000-8000-000000000013"; // ems__EffortStatusDone
const ALIASED = "42770000-0000-4000-8000-000000000014"; // human label, TBox-form alias zz__Aliased + alias "Zz__Case"
const PROTO = "42770000-0000-4000-8000-000000000020";
const TASK_A = "42770000-0000-4000-8000-000000000021"; // [[uid]] referrer of KEY_A + STATUS_DONE
const TASK_B = "42770000-0000-4000-8000-000000000022"; // [[prefix__Name]] referrers (alias index) + case-different alias
const TASK_C = "42770000-0000-4000-8000-000000000023"; // body-link referrer
const TASK_D = "42770000-0000-4000-8000-000000000024"; // prototype-bearing instance (inferred layer)

const TBOX_DIR = "assetspaces/kitelev/exoas-exo/exo";
const TASKS_DIR = "assetspaces/kitelev/exoas-my/my-tasks";

function fm(props: Record<string, string>, body = ""): string {
  const lines = Object.entries(props).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join("\n")}\n---\n${body}`;
}

function sortedKeys(triples: TripleT[]): string[] {
  return triples.map(tripleKey).sort();
}

function objectsOf(triples: TripleT[], subjectRel: string): string[] {
  const subject = vaultPathToIRI(subjectRel);
  return triples
    .filter((t) => serializeNode(t.subject).value === subject)
    .map((t) => `${serializeNode(t.predicate).value} -> ${serializeNode(t.object).value}`);
}

interface PersistedMeta {
  inferenceEnabled: boolean;
  inferredCount: number;
  tripleCount: number;
}

describe(`CacheManager — delta on an unchanged-projection TBox-form asset, rebuild inherits the inferred layer (#4277) ${REQ}`, () => {
  let tempDir: string;
  let vaultPath: string;
  let clock: number;

  // Distinct, monotonic mtimes so a write landing within the same ms as the
  // build is never mistaken for "unchanged".
  async function writeFile(rel: string, content: string): Promise<void> {
    const full = path.join(vaultPath, rel);
    await fs.ensureDir(path.dirname(full));
    await fs.writeFile(full, content, "utf-8");
    clock += 1000;
    await fs.utimes(full, clock / 1000, clock / 1000);
  }

  const keyARel = `${TBOX_DIR}/${KEY_A}.md`;
  const keyDup2Rel = `${TBOX_DIR}/${KEY_DUP2}.md`;
  const aliasedRel = `${TBOX_DIR}/${ALIASED}.md`;
  const taskARel = `${TASKS_DIR}/${TASK_A}.md`;

  /** The bot's `exo__SettingKey*` shape: TBox label, the same TBox alias, class by uid. */
  function keyA(opts: {
    label?: string;
    aliases?: string[];
    instanceClass?: string;
    datatype?: string;
    body?: string;
  } = {}): string {
    const aliases = opts.aliases ?? ["exo__SettingKeyAlpha"];
    return fm(
      {
        exo__Asset_uid: KEY_A,
        exo__Instance_class: `"[[${opts.instanceClass ?? CLASS_SETTINGKEY}]]"`,
        exo__Asset_label: opts.label ?? "exo__SettingKeyAlpha",
        exo__Asset_description: '"A setting key"',
        aliases: `[${aliases.map((a) => `"${a}"`).join(", ")}]`,
        setting__SettingKey_datatype: opts.datatype ?? "boolean",
      },
      opts.body ?? "",
    );
  }

  function aliased(opts: { aliases?: string[]; body?: string } = {}): string {
    const aliases = opts.aliases ?? ["zz__Aliased", "Zz__Case"];
    return fm(
      {
        exo__Asset_uid: ALIASED,
        exo__Instance_class: `"[[${CLASS_TASK}]]"`,
        exo__Asset_label: '"Human thing"',
        aliases: `[${aliases.map((a) => `"${a}"`).join(", ")}]`,
      },
      opts.body ?? "",
    );
  }

  async function fullParse(): Promise<TripleT[]> {
    const converter = new NoteToRDFConverter(new FileSystemVaultAdapter(vaultPath));
    return converter.convertVault();
  }

  /** What `index` does: build, materialise over the explicit set, persist the layer. */
  async function indexLike(cache: CacheManager): Promise<number> {
    const built = await cache.loadOrBuild();
    const materialized = await materializeInferredTriples(built.triples);
    await cache.saveInferredTriples(materialized.inferred);
    return materialized.inferredCount;
  }

  async function persistedMeta(cache: CacheManager): Promise<PersistedMeta> {
    const data = (await fs.readJson(cache.getCachePath())) as { metadata: PersistedMeta };
    return data.metadata;
  }

  async function expectParity(result: { triples: TripleT[]; explicitCount: number }): Promise<void> {
    const explicit = result.triples.slice(0, result.explicitCount);
    const inferred = result.triples.slice(result.explicitCount);
    const parsed = await fullParse();
    expect(sortedKeys(explicit)).toEqual(sortedKeys(parsed));
    if (inferred.length > 0) {
      const materialized = await materializeInferredTriples(parsed);
      expect(sortedKeys(inferred)).toEqual(sortedKeys(materialized.inferred));
    }
  }

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cache-tbox-4277-"));
    vaultPath = path.join(tempDir, "vault");
    clock = Date.now() - 120_000;

    await writeFile(`${TBOX_DIR}/${CLASS_CLASS}.md`, fm({ exo__Asset_uid: CLASS_CLASS, exo__Asset_label: "exo__Class" }));
    for (const [uid, label] of [
      [CLASS_TASK, "ems__Task"],
      [CLASS_SETTINGKEY, "exo__SettingKey"],
      [CLASS_STATUS, "ems__EffortStatus"],
    ] as const) {
      await writeFile(
        `${TBOX_DIR}/${uid}.md`,
        fm({ exo__Asset_uid: uid, exo__Instance_class: `"[[${CLASS_CLASS}]]"`, exo__Asset_label: label }),
      );
    }
    await writeFile(keyARel, keyA());
    for (const uid of [KEY_DUP1, KEY_DUP2]) {
      await writeFile(
        `${TBOX_DIR}/${uid}.md`,
        fm({
          exo__Asset_uid: uid,
          exo__Instance_class: `"[[${CLASS_SETTINGKEY}]]"`,
          exo__Asset_label: "exo__SettingKeyDup",
          setting__SettingKey_datatype: "string",
        }),
      );
    }
    await writeFile(
      `${TBOX_DIR}/${STATUS_DONE}.md`,
      fm({ exo__Asset_uid: STATUS_DONE, exo__Instance_class: `"[[${CLASS_STATUS}]]"`, exo__Asset_label: "ems__EffortStatusDone" }),
    );
    await writeFile(aliasedRel, aliased());
    // Prototype + instance: the inferred layer (prototype-chain inheritance).
    await writeFile(
      `${TASKS_DIR}/${PROTO}.md`,
      fm({
        exo__Asset_uid: PROTO,
        exo__Instance_class: `"[[${CLASS_TASK}]]"`,
        exo__Asset_label: '"Task prototype"',
        test__Owner: '"Alice"',
      }),
    );
    await writeFile(
      `${TASKS_DIR}/${TASK_D}.md`,
      fm({
        exo__Asset_uid: TASK_D,
        exo__Instance_class: `"[[${CLASS_TASK}]]"`,
        exo__Asset_label: '"Task D (prototype-bearing)"',
        exo__Asset_prototype: `"[[${PROTO}]]"`,
      }),
    );
    // Referrers.
    await writeFile(
      taskARel,
      fm({
        exo__Asset_uid: TASK_A,
        exo__Instance_class: `"[[${CLASS_TASK}]]"`,
        exo__Asset_label: '"Task A"',
        ems__Effort_status: `"[[${STATUS_DONE}]]"`,
        setting__Setting_key: `"[[${KEY_A}]]"`,
        setting__Setting_dupKey: `"[[${KEY_DUP2}]]"`,
      }),
    );
    await writeFile(
      `${TASKS_DIR}/${TASK_B}.md`,
      fm({
        exo__Asset_uid: TASK_B,
        exo__Instance_class: `"[[${CLASS_TASK}]]"`,
        exo__Asset_label: '"Task B"',
        setting__Setting_key: '"[[exo__SettingKeyAlpha]]"',
        test__aliasRef: '"[[zz__Aliased]]"',
        test__caseRef: '"[[zz__case]]"',
      }),
    );
    await writeFile(
      `${TASKS_DIR}/${TASK_C}.md`,
      fm(
        {
          exo__Asset_uid: TASK_C,
          exo__Instance_class: `"[[${CLASS_TASK}]]"`,
          exo__Asset_label: '"Task C"',
        },
        "See [[exo__SettingKeyAlpha]] and [[zz__Aliased]].\n",
      ),
    );
    await writeFile(".obsidian/workspace.md", "not an asset");
    clock += 1000;
    await fs.utimes(vaultPath, clock / 1000, clock / 1000);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.remove(tempDir);
  });

  it(`T1 touching a TBox-form asset (datatype + body changed, label / alias / class unchanged) with an inferred cache is a delta that keeps the layer and equals a full parse ${REQ}`, async () => {
    const cache = new CacheManager(vaultPath);
    const inferredCount = await indexLike(cache);
    expect(inferredCount).toBeGreaterThan(0);
    const before = await persistedMeta(cache);
    expect(before.inferenceEnabled).toBe(true);

    // The referrers' emission before the touch — the symbolic IRI and the
    // co-emitted type triples derived from KEY_A's projection.
    const warm = await cache.loadOrBuild();
    expect(warm.mode).toBe("hit");
    const referrerBefore = objectsOf(warm.triples, taskARel).filter((x) => x.includes("Setting_key"));
    expect(referrerBefore.join("\n")).toContain("exo#SettingKeyAlpha");

    await writeFile(keyARel, keyA({ datatype: "string", body: "Renamed datatype, same identity.\n" }));
    const spy = jest.spyOn(NoteToRDFConverter.prototype, "convertVaultWithValidation");
    const result = await cache.loadOrBuild();
    expect(result.mode).toBe("delta");
    expect(result.rebuildReason).toBeUndefined();
    expect(result.reparsedFiles).toBe(1);
    // the delta re-parsed exactly the touched file, not the vault
    const opts = spy.mock.calls[0]?.[0] as { files?: { path: string }[] } | undefined;
    expect(opts?.files?.map((f) => f.path)).toEqual([keyARel]);
    spy.mockRestore();
    // KEY_A touches no engine input → the layer is kept verbatim …
    expect(result.inferredRecomputed).toBe(false);
    const after = await persistedMeta(cache);
    expect(after.inferenceEnabled).toBe(true);
    expect(after.inferredCount).toBe(before.inferredCount);
    expect(result.triples.length - result.explicitCount).toBe(before.inferredCount);
    // … the referrers are untouched and still correct, and the whole set
    // equals a from-scratch parse (explicit) + materialisation (inferred).
    expect(objectsOf(result.triples, taskARel).filter((x) => x.includes("Setting_key"))).toEqual(referrerBefore);
    expect(objectsOf(result.triples, keyARel).join("\n")).toContain("SettingKey_datatype -> string");
    await expectParity(result);
    // and the next reader is a plain hit
    expect((await new CacheManager(vaultPath).loadOrBuild()).mode).toBe("hit");
  });

  it(`T2 the same touch on a cache WITHOUT an inferred layer is a delta that stays layer-less ${REQ}`, async () => {
    const cache = new CacheManager(vaultPath);
    expect((await cache.loadOrBuild()).mode).toBe("rebuild");
    expect((await persistedMeta(cache)).inferenceEnabled).toBe(false);

    await writeFile(keyARel, keyA({ datatype: "string" }));
    const result = await cache.loadOrBuild();
    expect(result.mode).toBe("delta");
    expect(result.reparsedFiles).toBe(1);
    expect(result.explicitCount).toBe(result.triples.length);
    expect((await persistedMeta(cache)).inferenceEnabled).toBe(false);
    await expectParity(result);
  });

  it(`T3 a change to the TBox-form label VALUE (exo__A → exo__B) rebuilds — the [[uid]] referrer's symbolic object changes ${REQ}`, async () => {
    const cache = new CacheManager(vaultPath);
    await cache.loadOrBuild();
    await writeFile(keyARel, keyA({ label: "exo__SettingKeyBeta" }));
    const spy = jest.spyOn(NoteToRDFConverter.prototype, "convertVaultWithValidation");
    const result = await cache.loadOrBuild();
    expect(result.mode).toBe("rebuild");
    expect(result.rebuildReason).toBe(`TBox-form asset changed: ${keyARel}`);
    // the rebuild walked the WHOLE vault, and no delta parse preceded it
    const opts = spy.mock.calls[0]?.[0] as { files?: unknown[] } | undefined;
    expect(spy).toHaveBeenCalledTimes(1);
    expect(opts?.files?.length).toBe(await countFiles());
    spy.mockRestore();
    const referrer = objectsOf(result.triples, taskARel).filter((x) => x.includes("Setting_key ->"));
    expect(referrer.join("\n")).toContain("exo#SettingKeyBeta");
    expect(referrer.join("\n")).not.toContain("exo#SettingKeyAlpha");
    await expectParity(result);
  });

  it(`T4 losing or gaining the TBox form of the label rebuilds with the #4263 reasons ${REQ}`, async () => {
    const cache = new CacheManager(vaultPath);
    await cache.loadOrBuild();
    // lost: TBox label → human label (aliases unchanged)
    await writeFile(keyARel, keyA({ label: '"Setting key alpha"' }));
    const lost = await cache.loadOrBuild();
    expect(lost.mode).toBe("rebuild");
    expect(lost.rebuildReason).toBe(`asset lost its TBox-form label: ${keyARel}`);
    await expectParity(lost);
    // gained: back to the TBox form
    await writeFile(keyARel, keyA());
    const gained = await cache.loadOrBuild();
    expect(gained.mode).toBe("rebuild");
    expect(gained.rebuildReason).toBe(`TBox-form asset changed: ${keyARel}`);
    await expectParity(gained);
  });

  it(`T5 a change to the TBox-form ALIAS set of the TBox-labelled asset rebuilds; the same set in a different order is a delta ${REQ}`, async () => {
    const cache = new CacheManager(vaultPath);
    await cache.loadOrBuild();
    // added a second TBox-form alias
    await writeFile(keyARel, keyA({ aliases: ["exo__SettingKeyAlpha", "exo__SettingKeyAlpha2"] }));
    const added = await cache.loadOrBuild();
    expect(added.mode).toBe("rebuild");
    expect(added.rebuildReason).toBe(`TBox-form alias: ${keyARel}`);
    await expectParity(added);
    // the same two aliases, reversed + a human alias appended → the TBox-form
    // SET is unchanged, the human alias goes through the ordinary alias diff
    await writeFile(keyARel, keyA({ aliases: ["exo__SettingKeyAlpha2", "exo__SettingKeyAlpha", "alpha key"] }));
    const reordered = await cache.loadOrBuild();
    expect(reordered.mode).toBe("delta");
    await expectParity(reordered);
    // removed one
    await writeFile(keyARel, keyA({ aliases: ["exo__SettingKeyAlpha"] }));
    const removed = await cache.loadOrBuild();
    expect(removed.mode).toBe("rebuild");
    expect(removed.rebuildReason).toBe(`TBox-form alias: ${keyARel}`);
    await expectParity(removed);
  });

  it(`T6 a change to the TBox-form asset's exo__Instance_class rebuilds — the [[uid]] referrer co-emits the target's class as type triples ${REQ}`, async () => {
    const cache = new CacheManager(vaultPath);
    const built = await cache.loadOrBuild();
    // emitTypeTripleForEnumInstance: TASK_A carries <exo#SettingKeyAlpha> rdf:type / exo:Instance_class <exo#SettingKey>
    const typeTriplesBefore = objectsOf(built.triples, keyARel); // own triples only
    expect(typeTriplesBefore.join("\n")).toContain("Instance_class -> https://exocortex.my/ontology/exo#SettingKey");
    const coEmittedBefore = sortedKeys(
      built.triples.filter(
        (t) =>
          serializeNode(t.subject).value === "https://exocortex.my/ontology/exo#SettingKeyAlpha" &&
          serializeNode(t.predicate).value.endsWith("#Instance_class"),
      ),
    );
    expect(coEmittedBefore).toHaveLength(1);
    expect(coEmittedBefore[0]).toContain("exo#SettingKey");

    await writeFile(keyARel, keyA({ instanceClass: CLASS_TASK }));
    const result = await cache.loadOrBuild();
    expect(result.mode).toBe("rebuild");
    expect(result.rebuildReason).toBe(`TBox-form asset class changed: ${keyARel}`);
    const coEmittedAfter = sortedKeys(
      result.triples.filter(
        (t) =>
          serializeNode(t.subject).value === "https://exocortex.my/ontology/exo#SettingKeyAlpha" &&
          serializeNode(t.predicate).value.endsWith("#Instance_class"),
      ),
    );
    expect(coEmittedAfter).toHaveLength(1);
    expect(coEmittedAfter[0]).toContain("ems#Task");
    await expectParity(result);
  });

  it(`T7 an added or removed TBox-form file still rebuilds ${REQ}`, async () => {
    const cache = new CacheManager(vaultPath);
    await cache.loadOrBuild();
    const newRel = `${TBOX_DIR}/42770000-0000-4000-8000-000000000099.md`;
    await writeFile(
      newRel,
      fm({
        exo__Asset_uid: "42770000-0000-4000-8000-000000000099",
        exo__Instance_class: `"[[${CLASS_SETTINGKEY}]]"`,
        exo__Asset_label: "exo__SettingKeyGamma",
      }),
    );
    const added = await cache.loadOrBuild();
    expect(added.mode).toBe("rebuild");
    expect(added.rebuildReason).toBe(`TBox-form asset changed: ${newRel}`);
    await fs.remove(path.join(vaultPath, newRel));
    const removed = await cache.loadOrBuild();
    expect(removed.mode).toBe("rebuild");
    expect(removed.rebuildReason).toBe(`TBox-form asset removed: ${newRel}`);
    await expectParity(removed);
  });

  it(`T8 a TBox-labelled file the converter SKIPPED (no readable projection) rebuilds when it changes, even into a human label ${REQ}`, async () => {
    // Referrers read a skipped target's frontmatter directly and emit
    // symbolically; the cached entry holds only the marker, so the old
    // projection cannot be compared — the rebuild is the only safe answer.
    const skippedUid = "42770000-0000-4000-8000-000000000098";
    const skippedRel = `${TBOX_DIR}/${skippedUid}.md`;
    await writeFile(
      skippedRel,
      fm({ exo__Asset_uid: skippedUid, exo__Instance_class: '""', exo__Asset_label: "exo__SettingKeySkipped" }),
    );
    const cache = new CacheManager(vaultPath);
    const built = await cache.loadOrBuild();
    expect(objectsOf(built.triples, skippedRel)).toEqual([]);
    const persisted = (await fs.readJson(cache.getCachePath())) as {
      files: { path: string; triples: unknown[]; tboxLabel?: true }[];
    };
    const entry = persisted.files.find((f) => f.path === skippedRel);
    expect(entry?.triples).toEqual([]);
    expect(entry?.tboxLabel).toBe(true);

    // fixed AND relabelled to a human label in one edit: a projection-only
    // compare would see "no IRI label before, none after" and call it a delta
    await writeFile(
      skippedRel,
      fm({ exo__Asset_uid: skippedUid, exo__Instance_class: `"[[${CLASS_SETTINGKEY}]]"`, exo__Asset_label: '"Skipped key"' }),
    );
    const changed = await cache.loadOrBuild();
    expect(changed.mode).toBe("rebuild");
    expect(changed.rebuildReason).toBe(`asset lost its TBox-form label: ${skippedRel}`);
    await expectParity(changed);
  });

  it(`T9 a reader's rebuild on a cache with inferenceEnabled inherits the layer: flag kept, layer re-materialised, triples = explicit + inferred ${REQ}`, async () => {
    const cache = new CacheManager(vaultPath);
    const inferredCount = await indexLike(cache);
    expect(inferredCount).toBeGreaterThan(0);

    // a rebuild-class diff: the label VALUE of the TBox-form asset changes
    await writeFile(keyARel, keyA({ label: "exo__SettingKeyBeta" }));
    const result = await new CacheManager(vaultPath).loadOrBuild();
    expect(result.mode).toBe("rebuild");
    expect(result.cacheHit).toBe(false);
    expect(result.triples.length).toBeGreaterThan(result.explicitCount);
    const meta = await persistedMeta(new CacheManager(vaultPath));
    expect(meta.inferenceEnabled).toBe(true);
    expect(meta.inferredCount).toBe(result.triples.length - result.explicitCount);
    expect(meta.inferredCount).toBeGreaterThan(0);
    // the inherited layer is what `index` would materialise over this tree
    await expectParity(result);
    // TASK_D still carries the inherited owner without a compensating `index`
    expect(objectsOf(result.triples, `${TASKS_DIR}/${TASK_D}.md`).join("\n")).toContain("test#Owner -> Alice");
    // and a later delta keeps re-materialising (the flag is what gates it)
    await writeFile(`${TASKS_DIR}/${PROTO}.md`, fm({
      exo__Asset_uid: PROTO,
      exo__Instance_class: `"[[${CLASS_TASK}]]"`,
      exo__Asset_label: '"Task prototype"',
      test__Owner: '"Bob"',
    }));
    const delta = await new CacheManager(vaultPath).loadOrBuild();
    expect(delta.mode).toBe("delta");
    expect(delta.inferredRecomputed).toBe(true);
    expect(objectsOf(delta.triples, `${TASKS_DIR}/${TASK_D}.md`).join("\n")).toContain("test#Owner -> Bob");
  });

  it(`T10 a cold, layer-less or legacy rebuild stays layer-less ${REQ}`, async () => {
    // cold: no cache at all
    const cold = await new CacheManager(vaultPath).loadOrBuild();
    expect(cold.mode).toBe("rebuild");
    expect(cold.explicitCount).toBe(cold.triples.length);
    expect((await persistedMeta(new CacheManager(vaultPath))).inferenceEnabled).toBe(false);
    // layer-less (inferenceEnabled: false) + a rebuild-class diff
    await writeFile(keyARel, keyA({ label: "exo__SettingKeyBeta" }));
    const layerless = await new CacheManager(vaultPath).loadOrBuild();
    expect(layerless.mode).toBe("rebuild");
    expect(layerless.explicitCount).toBe(layerless.triples.length);
    const meta = await persistedMeta(new CacheManager(vaultPath));
    expect(meta.inferenceEnabled).toBe(false);
    expect(meta.inferredCount).toBe(0);
    // legacy (pre-#4263) cache: unreadable → rebuild without a layer, even
    // though the file carries an inferred array
    const cache = new CacheManager(vaultPath);
    await fs.writeJson(cache.getCachePath(), {
      metadata: { version: "0", timestamp: 0, vaultPath, tripleCount: 1, vaultMtime: 0 },
      triples: [],
      inferred: [{ subject: { type: "IRI", value: "x" }, predicate: { type: "IRI", value: "y" }, object: { type: "IRI", value: "z" } }],
    });
    const legacy = await cache.loadOrBuild();
    expect(legacy.mode).toBe("rebuild");
    expect(legacy.rebuildReason).toMatch(/absent, corrupt or legacy/);
    expect(legacy.explicitCount).toBe(legacy.triples.length);
    expect((await persistedMeta(cache)).inferenceEnabled).toBe(false);
  });

  it(`T11 the write-through folds an unchanged-projection TBox-form change in as a delta, and skips a label change with the reason ${REQ}`, async () => {
    const cache = new CacheManager(vaultPath);
    await indexLike(cache);
    expect((await cache.loadOrBuild()).mode).toBe("hit");

    await writeFile(keyARel, keyA({ datatype: "string" }));
    const folded = await cache.refreshAfterWrite();
    expect(folded).toEqual({ mode: "delta", reparsedFiles: 1 });
    const next = await new CacheManager(vaultPath).loadOrBuild();
    expect(next.mode).toBe("hit");
    expect(objectsOf(next.triples, keyARel).join("\n")).toContain("SettingKey_datatype -> string");
    expect((await persistedMeta(cache)).inferenceEnabled).toBe(true);

    await writeFile(keyARel, keyA({ datatype: "string", label: "exo__SettingKeyBeta" }));
    const skipped = await cache.refreshAfterWrite();
    expect(skipped.mode).toBe("skipped");
    expect(skipped.reason).toBe(`rebuild needed (TBox-form asset changed: ${keyARel}) — left to the next reader`);
    expect((await new CacheManager(vaultPath).loadOrBuild()).mode).toBe("rebuild");
  });

  it(`T12 buildCacheWithValidation (what \`index\` runs) still builds layer-less — index persists its own layer afterwards ${REQ}`, async () => {
    const cache = new CacheManager(vaultPath);
    await indexLike(cache);
    expect((await persistedMeta(cache)).inferenceEnabled).toBe(true);
    // `index --force`: invalidate + buildCacheWithValidation
    await cache.invalidate();
    await cache.buildCacheWithValidation({ strict: false });
    const meta = await persistedMeta(cache);
    expect(meta.inferenceEnabled).toBe(false);
    expect(meta.inferredCount).toBe(0);
  });

  it(`T13 a human-labelled asset with a TBox-form alias: a body change is a delta, an alias-set change rebuilds ${REQ}`, async () => {
    const cache = new CacheManager(vaultPath);
    await cache.loadOrBuild();
    await writeFile(aliasedRel, aliased({ body: "Notes.\n" }));
    const touched = await cache.loadOrBuild();
    expect(touched.mode).toBe("delta");
    await expectParity(touched);
    // TASK_B's `[[zz__Aliased]]` / `[[zz__case]]` still resolve to the file-IRI
    const refs = objectsOf(touched.triples, `${TASKS_DIR}/${TASK_B}.md`);
    expect(refs.join("\n")).toContain(`test#aliasRef -> ${vaultPathToIRI(aliasedRel)}`);
    expect(refs.join("\n")).toContain(`test#caseRef -> ${vaultPathToIRI(aliasedRel)}`);

    await writeFile(aliasedRel, aliased({ aliases: ["Zz__Case"] }));
    const dropped = await cache.loadOrBuild();
    expect(dropped.mode).toBe("rebuild");
    expect(dropped.rebuildReason).toBe(`TBox-form alias: ${aliasedRel}`);
    await expectParity(dropped);
    // without the alias the referrer falls back to the symbolic IRI
    expect(objectsOf(dropped.triples, `${TASKS_DIR}/${TASK_B}.md`).join("\n")).toContain(
      "test#aliasRef -> https://exocortex.my/ontology/zz#Aliased",
    );
  });

  it(`T14 duplicate TBox labels: touching one copy is a delta, renaming it is a rebuild ${REQ}`, async () => {
    const cache = new CacheManager(vaultPath);
    await cache.loadOrBuild();
    await writeFile(
      keyDup2Rel,
      fm({
        exo__Asset_uid: KEY_DUP2,
        exo__Instance_class: `"[[${CLASS_SETTINGKEY}]]"`,
        exo__Asset_label: "exo__SettingKeyDup",
        setting__SettingKey_datatype: "number",
      }),
    );
    const touched = await cache.loadOrBuild();
    expect(touched.mode).toBe("delta");
    await expectParity(touched);
    await writeFile(
      keyDup2Rel,
      fm({
        exo__Asset_uid: KEY_DUP2,
        exo__Instance_class: `"[[${CLASS_SETTINGKEY}]]"`,
        exo__Asset_label: "exo__SettingKeyDup2",
        setting__SettingKey_datatype: "number",
      }),
    );
    const renamed = await cache.loadOrBuild();
    expect(renamed.mode).toBe("rebuild");
    expect(renamed.rebuildReason).toBe(`TBox-form asset changed: ${keyDup2Rel}`);
    await expectParity(renamed);
  });

  it(`T15 re-ordering the exo__Instance_class list of a TBox-form asset rebuilds — a [[uid]] referrer co-emits the FIRST class ${REQ}`, async () => {
    const twoClasses = (first: string, second: string) =>
      fm({
        exo__Asset_uid: KEY_A,
        exo__Instance_class: `["[[${first}]]", "[[${second}]]"]`,
        exo__Asset_label: "exo__SettingKeyAlpha",
        aliases: '["exo__SettingKeyAlpha"]',
        setting__SettingKey_datatype: "boolean",
      });
    await writeFile(keyARel, twoClasses(CLASS_SETTINGKEY, CLASS_TASK));
    const cache = new CacheManager(vaultPath);
    const built = await cache.loadOrBuild();
    // the OBJECTS of `<exo#SettingKeyAlpha> exo:Instance_class ?c` (the referrer's co-emission)
    const coEmitted = (triples: TripleT[]): string[] =>
      triples
        .filter(
          (t) =>
            serializeNode(t.subject).value === "https://exocortex.my/ontology/exo#SettingKeyAlpha" &&
            serializeNode(t.predicate).value.endsWith("#Instance_class"),
        )
        .map((t) => serializeNode(t.object).value)
        .sort();
    expect(coEmitted(built.triples)).toEqual(["https://exocortex.my/ontology/exo#SettingKey"]);
    // same set, other order → the referrer's co-emitted class flips
    await writeFile(keyARel, twoClasses(CLASS_TASK, CLASS_SETTINGKEY));
    const swapped = await cache.loadOrBuild();
    expect(swapped.mode).toBe("rebuild");
    expect(swapped.rebuildReason).toBe(`TBox-form asset class changed: ${keyARel}`);
    expect(coEmitted(swapped.triples)).toEqual(["https://exocortex.my/ontology/ems#Task"]);
    await expectParity(swapped);
  });

  it(`T16 a modified TBox-form file whose conversion THROWS (an empty exo__* literal the walk skips) rebuilds instead of crashing the reader; the write-through skips it ${REQ}`, async () => {
    const cache = new CacheManager(vaultPath);
    await indexLike(cache);
    expect((await cache.loadOrBuild()).mode).toBe("hit");
    // `exo__Asset_description: ""` is not in the converter's skip-list, so
    // `new Literal("")` throws inside convertNote; the walk catches it and
    // skips the file (zero triples) — the probe must not propagate it.
    await writeFile(
      keyARel,
      fm({
        exo__Asset_uid: KEY_A,
        exo__Instance_class: `"[[${CLASS_SETTINGKEY}]]"`,
        exo__Asset_label: "exo__SettingKeyAlpha",
        exo__Asset_description: '""',
        aliases: '["exo__SettingKeyAlpha"]',
        setting__SettingKey_datatype: "boolean",
      }),
    );
    // write-through first (in-memory snapshot): skipped with the reason, not "failed"
    const wt = await cache.refreshAfterWrite();
    expect(wt).toEqual({
      mode: "skipped",
      reparsedFiles: 0,
      reason: `rebuild needed (TBox-form asset changed: ${keyARel}) — left to the next reader`,
    });
    // a reader: rebuild, no throw, the file is walk-skipped (zero triples) and
    // the referrers still emit symbolically from its frontmatter
    const result = await new CacheManager(vaultPath).loadOrBuild();
    expect(result.mode).toBe("rebuild");
    expect(result.rebuildReason).toBe(`TBox-form asset changed: ${keyARel}`);
    expect(result.zeroTriplePaths).toContain(keyARel);
    expect(objectsOf(result.triples, taskARel).join("\n")).toContain("exo#SettingKeyAlpha");
    await expectParity(result);
  });

  it(`T17 cacheLoadNotice names the inherited inferred layer on a rebuild — and prints the pre-#4277 line without one ${REQ}`, async () => {
    const cache = new CacheManager(vaultPath);
    await indexLike(cache);
    await writeFile(keyARel, keyA({ label: "exo__SettingKeyBeta" }));
    const warm = await loadVaultTriples(vaultPath, { useCache: true });
    expect(warm.mode).toBe("rebuild");
    const inferred = warm.triples.length - warm.explicitCount;
    expect(inferred).toBeGreaterThan(0);
    expect(cacheLoadNotice(warm)).toBe(
      `🔨 triple cache: rebuild (${warm.reparsedFiles} file(s) parsed, cache written + inferred layer (${inferred}))`,
    );
    // layer-less (cold) rebuild: the pre-#4277 line, byte for byte
    await cache.invalidate();
    const cold = await loadVaultTriples(vaultPath, { useCache: true });
    expect(cold.mode).toBe("rebuild");
    expect(cacheLoadNotice(cold)).toBe(
      `🔨 triple cache: rebuild (${cold.reparsedFiles} file(s) parsed, cache written)`,
    );
  });

  async function countFiles(): Promise<number> {
    return new FileSystemVaultAdapter(vaultPath).getAllFiles().length;
  }
});
