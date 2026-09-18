/**
 * CacheManager unit axes (#4263 — per-file manifest validity, delta refresh,
 * inferred layer, legacy/corrupt fallback).
 *
 * The converter is replaced by a deterministic FAKE via `jest.spyOn` on the
 * real class's prototype: it turns every `.md` file into exactly one label
 * triple (`<file-IRI> exo:Asset_label "<content>"`), records which files it
 * was asked to convert, and honours the `files` / `fileSpacePrefixes` /
 * `onFileTriples` contract — so these axes isolate the CACHE's decisions from
 * the converter's semantics (the real converter is exercised in
 * `tests/integration/cache-manifest-delta-4263.integration.test.ts`).
 *
 * Requirement: @req:42812747-8b76-4525-aaaa-00857ea98599
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
  Literal,
  vaultPathToIRI,
  type IFile,
} from "@kitelev/exocortex-core";
import {
  CacheManager,
  CACHE_FORMAT_VERSION,
  DELTA_REBUILD_RATIO,
  diffManifest,
} from "../../../src/cache/CacheManager.js";

const REQ = "@req:42812747-8b76-4525-aaaa-00857ea98599";
const LABEL = new IRI("https://exocortex.my/ontology/exo#Asset_label");
const FILE_SPACE_CLASS_UID = "aad8913e-5e9f-4047-879d-93cc46befd52";

type ConvertOptions = Parameters<
  NoteToRDFConverter["convertVaultWithValidation"]
>[0];

describe(`CacheManager (#4263) ${REQ}`, () => {
  let tempDir: string;
  let vaultPath: string;
  let clock: number;
  let convertCalls: ConvertOptions[];
  let convertedPaths: string[][];

  async function writeFile(rel: string, content: string): Promise<void> {
    const full = path.join(vaultPath, rel);
    await fs.ensureDir(path.dirname(full));
    await fs.writeFile(full, content, "utf-8");
    clock += 1000;
    await fs.utimes(full, clock / 1000, clock / 1000);
  }

  function labelOf(triples: Triple[], rel: string): string[] {
    const s = vaultPathToIRI(rel);
    return triples
      .filter(
        (t) =>
          (t.subject as IRI).value === s &&
          (t.predicate as IRI).value === LABEL.value,
      )
      .map((t) => (t.object as Literal).value);
  }

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cache-unit-4263-"));
    vaultPath = path.join(tempDir, "vault");
    clock = Date.now() - 60_000;
    convertCalls = [];
    convertedPaths = [];

    // Fake converter: one label triple per file, content = the file's text.
    jest
      .spyOn(NoteToRDFConverter.prototype, "convertVaultWithValidation")
      .mockImplementation(async function (
        this: NoteToRDFConverter,
        options: ConvertOptions = {},
      ) {
        convertCalls.push(options);
        const adapter = (
          this as unknown as { vault: { getAllFiles(): IFile[] } }
        ).vault;
        const walked = options.files ?? adapter.getAllFiles();
        const prefixes = options.fileSpacePrefixes ?? ["filespace/"];
        const converted: string[] = [];
        const triples: Triple[] = [];
        for (const file of walked) {
          if (prefixes.some((p) => file.path.startsWith(p))) continue;
          const content = await fs.readFile(
            path.join(vaultPath, file.path),
            "utf-8",
          );
          if (content.trim() === "SKIP") continue; // simulates an invariant-violating file
          converted.push(file.path);
          const own = [
            new Triple(
              new IRI(vaultPathToIRI(file.path)),
              LABEL,
              new Literal(content.trim()),
            ),
          ];
          triples.push(...own);
          options.onFileTriples?.(file, own);
        }
        convertedPaths.push(converted);
        return {
          triples,
          skippedFiles: [],
          summary: {
            total: walked.length,
            indexed: converted.length,
            skipped: walked.length - converted.length,
          },
          fileSpaces: { prefixes, declarationPaths: [], warnings: [] },
        };
      });

    await writeFile("a.md", "A");
    await writeFile("nested/deep/b.md", "B");
    await writeFile("nested/deep/c.md", "C");
    await writeFile("filespace/blob.md", "BLOB"); // excluded by the (fake) FileSpace prefix
    await writeFile(".obsidian/hidden.md", "HIDDEN"); // hidden dir: never walked
    await writeFile("notes.txt", "not markdown"); // never walked
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.remove(tempDir);
  });

  it(`U1 an absent cache is built in format v2 with one entry per walked .md (hidden dirs / non-md excluded) ${REQ}`, async () => {
    const cache = new CacheManager(vaultPath);
    const result = await cache.loadOrBuild();
    expect(result.mode).toBe("rebuild");
    expect(result.cacheHit).toBe(false);
    expect(result.reparsedFiles).toBe(4);
    expect(labelOf(result.triples, "nested/deep/b.md")).toEqual(["B"]);

    const data = await fs.readJson(cache.getCachePath());
    expect(data.metadata.formatVersion).toBe(CACHE_FORMAT_VERSION);
    expect(data.metadata.fileCount).toBe(4);
    expect(data.metadata.inferredCount).toBe(0);
    expect(data.metadata.fileSpacePrefixes).toEqual(["filespace/"]);
    expect(data.metadata).not.toHaveProperty("vaultMtime");
    const paths = data.files.map((f: { path: string }) => f.path).sort();
    expect(paths).toEqual([
      "a.md",
      "filespace/blob.md",
      "nested/deep/b.md",
      "nested/deep/c.md",
    ]);
    // excluded file keeps an (empty) entry so its later edit still counts
    const blob = data.files.find(
      (f: { path: string }) => f.path === "filespace/blob.md",
    );
    expect(blob.triples).toEqual([]);
    expect(await cache.isCacheValid()).toBe(true);
  });

  it(`U2 an unchanged vault is a hit that converts nothing ${REQ}`, async () => {
    const cache = new CacheManager(vaultPath);
    await cache.loadOrBuild();
    convertCalls.length = 0;
    const hit = await cache.loadOrBuild();
    expect(hit.mode).toBe("hit");
    expect(hit.cacheHit).toBe(true);
    expect(hit.reparsedFiles).toBe(0);
    expect(convertCalls).toHaveLength(0);
    expect(labelOf(hit.triples, "a.md")).toEqual(["A"]);
  });

  it(`U3 a nested modification is refreshed as a delta: only the changed file is converted, with the persisted FileSpace prefixes ${REQ}`, async () => {
    const cache = new CacheManager(vaultPath);
    await cache.loadOrBuild();
    convertCalls.length = 0;
    convertedPaths.length = 0;

    await writeFile("nested/deep/b.md", "B2");
    expect(await cache.isCacheValid()).toBe(false);
    const delta = await cache.loadOrBuild();
    expect(delta.mode).toBe("delta");
    expect(delta.cacheHit).toBe(true);
    expect(delta.reparsedFiles).toBe(1);
    expect(convertCalls).toHaveLength(1);
    expect(convertCalls[0]?.files?.map((f) => f.path)).toEqual([
      "nested/deep/b.md",
    ]);
    expect(convertCalls[0]?.fileSpacePrefixes).toEqual(["filespace/"]);
    expect(convertedPaths[0]).toEqual(["nested/deep/b.md"]);
    expect(labelOf(delta.triples, "nested/deep/b.md")).toEqual(["B2"]);
    expect(labelOf(delta.triples, "a.md")).toEqual(["A"]);
    expect(labelOf(delta.triples, "nested/deep/c.md")).toEqual(["C"]);
    expect(delta.triples).toHaveLength(3);

    // persisted → plain hit next time
    convertCalls.length = 0;
    const hit = await cache.loadOrBuild();
    expect(hit.mode).toBe("hit");
    expect(convertCalls).toHaveLength(0);
    expect(labelOf(hit.triples, "nested/deep/b.md")).toEqual(["B2"]);
  });

  it(`U4 an added file is converted and appended; a removed file's entry and triples disappear ${REQ}`, async () => {
    const cache = new CacheManager(vaultPath);
    await cache.loadOrBuild();

    await writeFile("nested/deep/d.md", "D");
    convertCalls.length = 0;
    const added = await cache.loadOrBuild();
    expect(added.mode).toBe("delta");
    expect(convertCalls[0]?.files?.map((f) => f.path)).toEqual([
      "nested/deep/d.md",
    ]);
    expect(labelOf(added.triples, "nested/deep/d.md")).toEqual(["D"]);
    expect(added.triples).toHaveLength(4);

    await fs.remove(path.join(vaultPath, "nested/deep/c.md"));
    convertCalls.length = 0;
    const removed = await cache.loadOrBuild();
    expect(removed.mode).toBe("delta");
    expect(convertCalls).toHaveLength(1);
    expect(convertCalls[0]?.files).toEqual([]); // nothing to re-parse, only to drop
    expect(labelOf(removed.triples, "nested/deep/c.md")).toEqual([]);
    expect(removed.triples).toHaveLength(3);
    const data = await fs.readJson(cache.getCachePath());
    expect(data.files.map((f: { path: string }) => f.path)).not.toContain(
      "nested/deep/c.md",
    );
    expect(data.metadata.fileCount).toBe(4);
  });

  it(`U5 a diff above DELTA_REBUILD_RATIO falls back to a full rebuild ${REQ}`, async () => {
    const cache = new CacheManager(vaultPath);
    await cache.loadOrBuild();
    convertCalls.length = 0;

    // 3 of 4 changed (> 50 %)
    await writeFile("a.md", "A2");
    await writeFile("nested/deep/b.md", "B2");
    await writeFile("nested/deep/c.md", "C2");
    const result = await cache.loadOrBuild();
    expect(result.mode).toBe("rebuild");
    expect(result.rebuildReason).toContain(`> ${DELTA_REBUILD_RATIO * 100}%`);
    expect(convertCalls[0]?.files?.length).toBe(4);
    expect(convertCalls[0]?.fileSpacePrefixes).toBeUndefined(); // full walk re-discovers
    expect(labelOf(result.triples, "a.md")).toEqual(["A2"]);
  });

  it(`U6 a legacy (root-mtime) or corrupt cache is invalid and rebuilt once into v2 ${REQ}`, async () => {
    const cache = new CacheManager(vaultPath);
    const cachePath = cache.getCachePath();
    await fs.ensureDir(path.dirname(cachePath));
    await fs.writeJson(cachePath, {
      metadata: {
        version: "1.0.0",
        timestamp: Date.now(),
        vaultPath,
        tripleCount: 1,
        vaultMtime: (await fs.stat(vaultPath)).mtimeMs, // "valid" by the retired root-mtime rule
      },
      triples: [
        {
          subject: { type: "IRI", value: vaultPathToIRI("a.md") },
          predicate: { type: "IRI", value: LABEL.value },
          object: { type: "Literal", value: "STALE" },
        },
      ],
    });
    expect(await cache.isCacheValid()).toBe(false);
    const stats = await cache.getCacheStats();
    expect(stats?.isValid).toBe(false);

    const rebuilt = await cache.loadOrBuild();
    expect(rebuilt.mode).toBe("rebuild");
    expect(labelOf(rebuilt.triples, "a.md")).toEqual(["A"]);
    expect((await fs.readJson(cachePath)).metadata.formatVersion).toBe(
      CACHE_FORMAT_VERSION,
    );

    await fs.writeFile(cachePath, "{ definitely not json", "utf-8");
    expect(await cache.isCacheValid()).toBe(false);
    expect((await cache.loadOrBuild()).mode).toBe("rebuild");
    expect(await cache.isCacheValid()).toBe(true);
  });

  it(`U7 saveInferredTriples persists a separate layer that hits return after the explicit triples, is re-materialized on delta, and requires an existing cache ${REQ}`, async () => {
    const cache = new CacheManager(vaultPath);
    await expect(cache.saveInferredTriples([])).rejects.toThrow(
      /build the cache first/,
    );

    await cache.loadOrBuild();
    const inferred = new Triple(
      new IRI(vaultPathToIRI("a.md")),
      new IRI("https://exocortex.my/ontology/exo#Instance_class"),
      new IRI("https://exocortex.my/ontology/exo#Asset"),
    );
    await cache.saveInferredTriples([inferred]);
    const data = await fs.readJson(cache.getCachePath());
    expect(data.metadata.inferredCount).toBe(1);
    expect(data.metadata.tripleCount).toBe(4); // 3 explicit + 1 inferred
    expect(data.inferred).toHaveLength(1);
    expect(data.files).toHaveLength(4);
    expect((await cache.getCacheStats())?.tripleCount).toBe(4);

    const hit = await cache.loadOrBuild();
    expect(hit.mode).toBe("hit");
    expect(hit.triples).toHaveLength(4);
    expect((hit.triples[3].object as IRI).value).toBe(
      "https://exocortex.my/ontology/exo#Asset",
    );

    // A delta re-materializes the layer from the merged explicit set: the
    // fake converter emits only label triples, so the real engines infer
    // nothing and the hand-seeded (now stale) triple must be gone — while a
    // cache that never had a layer must not grow one.
    await writeFile("a.md", "A2");
    const delta = await cache.loadOrBuild();
    expect(delta.mode).toBe("delta");
    expect(delta.triples).toHaveLength(3);
    expect(
      (await fs.readJson(cache.getCachePath())).metadata.inferredCount,
    ).toBe(0);
  });

  it(`U8 a changed file that declares exo__FileSpace forces a full rebuild (exclusion prefixes must be re-discovered) ${REQ}`, async () => {
    const cache = new CacheManager(vaultPath);
    await cache.loadOrBuild();
    convertCalls.length = 0;

    await writeFile(
      "spaces.md",
      `---\nexo__Asset_uid: 11111111-2222-4333-8444-555555555555\nexo__Instance_class: "[[${FILE_SPACE_CLASS_UID}]]"\n---\n`,
    );
    const result = await cache.loadOrBuild();
    expect(result.mode).toBe("rebuild");
    expect(result.rebuildReason).toMatch(/FileSpace declaration/);
    expect(convertCalls[0]?.files?.length).toBe(5);
  });

  it(`U9 a skipped (invariant-violating) file keeps an empty entry, and fixing it is a delta that converts only it ${REQ}`, async () => {
    await writeFile("nested/deep/broken.md", "SKIP");
    const cache = new CacheManager(vaultPath);
    const built = await cache.loadOrBuild();
    expect(labelOf(built.triples, "nested/deep/broken.md")).toEqual([]);
    const data = await fs.readJson(cache.getCachePath());
    expect(
      data.files.find(
        (f: { path: string }) => f.path === "nested/deep/broken.md",
      ).triples,
    ).toEqual([]);

    await writeFile("nested/deep/broken.md", "FIXED");
    convertCalls.length = 0;
    const fixed = await cache.loadOrBuild();
    expect(fixed.mode).toBe("delta");
    expect(convertCalls[0]?.files?.map((f) => f.path)).toEqual([
      "nested/deep/broken.md",
    ]);
    expect(labelOf(fixed.triples, "nested/deep/broken.md")).toEqual(["FIXED"]);
  });

  it(`U10 diffManifest classifies added / modified / removed ${REQ}`, () => {
    const cached = [
      { path: "a.md", mtimeMs: 1, triples: [] },
      { path: "b.md", mtimeMs: 2, triples: [] },
      { path: "c.md", mtimeMs: 3, triples: [] },
    ];
    const current = new Map<string, number>([
      ["a.md", 1],
      ["b.md", 20],
      ["d.md", 4],
    ]);
    expect(diffManifest(cached, current)).toEqual({
      added: ["d.md"],
      modified: ["b.md"],
      removed: ["c.md"],
    });
    expect(
      diffManifest(
        cached,
        new Map([
          ["a.md", 1],
          ["b.md", 2],
          ["c.md", 3],
        ]),
      ),
    ).toEqual({
      added: [],
      modified: [],
      removed: [],
    });
  });

  it(`U11 invalidate() removes the cache file and a stats query on a missing cache returns null ${REQ}`, async () => {
    const cache = new CacheManager(vaultPath);
    expect(await cache.getCacheStats()).toBeNull();
    await cache.loadOrBuild();
    expect(await fs.pathExists(cache.getCachePath())).toBe(true);
    const stats = await cache.getCacheStats();
    expect(stats?.isValid).toBe(true);
    expect(stats?.tripleCount).toBe(3);
    await cache.invalidate();
    expect(await fs.pathExists(cache.getCachePath())).toBe(false);
    await expect(cache.invalidate()).resolves.not.toThrow();
    expect(await cache.getCacheStats()).toBeNull();
  });
});
