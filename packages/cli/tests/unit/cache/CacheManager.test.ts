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
  STALE_TMP_MAX_AGE_MS,
  diffManifest,
  isSafeRelativePath,
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
          // `CLASS:<Name>` content also emits an Instance_class triple — an
          // inference-engine INPUT (U7 uses it to force a re-materialization).
          if (content.trim().startsWith("CLASS:")) {
            own.push(
              new Triple(
                new IRI(vaultPathToIRI(file.path)),
                new IRI("https://exocortex.my/ontology/exo#Instance_class"),
                new IRI(
                  `https://exocortex.my/ontology/ems#${content.trim().slice(6)}`,
                ),
              ),
            );
          }
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

    // A label-only delta touches no engine input → the layer is kept
    // verbatim (still 3 + 1) …
    await writeFile("a.md", "A2");
    const kept = await cache.loadOrBuild();
    expect(kept.mode).toBe("delta");
    expect(kept.triples).toHaveLength(4);
    expect(
      (await fs.readJson(cache.getCachePath())).metadata.inferredCount,
    ).toBe(1);
    // … while a delta that changes an engine input (Instance_class) makes the
    // cache re-run the real engines over the merged explicit set: they infer
    // nothing from this fixture, so the hand-seeded (now stale) triple is gone.
    await writeFile("a.md", "CLASS:Task");
    const delta = await cache.loadOrBuild();
    expect(delta.mode).toBe("delta");
    expect(delta.triples).toHaveLength(4); // 3 labels + 1 Instance_class, 0 inferred
    expect(
      (await fs.readJson(cache.getCachePath())).metadata.inferredCount,
    ).toBe(0);
    expect(
      (await fs.readJson(cache.getCachePath())).metadata.inferenceEnabled,
    ).toBe(true);
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

  it(`U10 diffManifest classifies added / modified (mtime OR size) / removed ${REQ}`, () => {
    const cached = [
      { path: "a.md", mtimeMs: 1, size: 10, triples: [] },
      { path: "b.md", mtimeMs: 2, size: 10, triples: [] },
      { path: "c.md", mtimeMs: 3, size: 10, triples: [] },
      { path: "e.md", mtimeMs: 5, size: 10, triples: [] },
    ];
    const current = new Map([
      ["a.md", { mtimeMs: 1, size: 10 }],
      ["b.md", { mtimeMs: 20, size: 10 }], // mtime moved
      ["e.md", { mtimeMs: 5, size: 11 }], // same mtime (touch -r / rsync -t), different size
      ["d.md", { mtimeMs: 4, size: 10 }],
    ]);
    expect(diffManifest(cached, current)).toEqual({
      added: ["d.md"],
      modified: ["b.md", "e.md"],
      removed: ["c.md"],
    });
    expect(
      diffManifest(
        cached,
        new Map([
          ["a.md", { mtimeMs: 1, size: 10 }],
          ["b.md", { mtimeMs: 2, size: 10 }],
          ["c.md", { mtimeMs: 3, size: 10 }],
          ["e.md", { mtimeMs: 5, size: 10 }],
        ]),
      ),
    ).toEqual({ added: [], modified: [], removed: [] });
  });

  it(`U12 a v2-shaped cache with a foreign formatVersion, a malformed entry, or an unsafe path is invalid and rebuilt ${REQ}`, async () => {
    const cache = new CacheManager(vaultPath);
    const cachePath = cache.getCachePath();
    await cache.loadOrBuild();
    const good = await fs.readJson(cachePath);
    expect(await cache.isCacheValid()).toBe(true);

    // foreign formatVersion, otherwise identical
    await fs.writeJson(cachePath, {
      ...good,
      metadata: { ...good.metadata, formatVersion: 1 },
    });
    expect(await cache.isCacheValid()).toBe(false);
    expect((await cache.loadOrBuild()).mode).toBe("rebuild");

    // malformed entry (mtimeMs as a string)
    const bad = await fs.readJson(cachePath);
    bad.files[0].mtimeMs = String(bad.files[0].mtimeMs);
    await fs.writeJson(cachePath, bad);
    expect(await cache.isCacheValid()).toBe(false);
    expect((await cache.loadOrBuild()).mode).toBe("rebuild");

    // unsafe path (would escape the vault when resolved)
    const evil = await fs.readJson(cachePath);
    evil.files[0].path = "../outside.md";
    await fs.writeJson(cachePath, evil);
    expect(await cache.isCacheValid()).toBe(false);
    expect((await cache.loadOrBuild()).mode).toBe("rebuild");
    expect(await cache.isCacheValid()).toBe(true);

    // the validator treats BOTH separators as segment boundaries: a
    // Windows-relative entry is safe (the adapter's path.relative yields
    // backslashes there — rejecting them would mean "never valid"), while
    // `..` and absolute forms are rejected whichever separator they use
    expect(isSafeRelativePath("notes\\sub\\a.md")).toBe(true);
    expect(isSafeRelativePath("notes/sub/a.md")).toBe(true);
    expect(isSafeRelativePath("..\\outside.md")).toBe(false);
    expect(isSafeRelativePath("notes\\..\\..\\outside.md")).toBe(false);
    expect(isSafeRelativePath("C:\\vault\\a.md")).toBe(false);
    expect(isSafeRelativePath("\\server\\share\\a.md")).toBe(false);
    expect(isSafeRelativePath("/etc/passwd")).toBe(false);
    expect(isSafeRelativePath("")).toBe(false);
  });

  it(`U16 orphaned temp files of a killed writer are swept on the next write and on invalidate(); a live writer's fresh temp file is left alone ${REQ}`, async () => {
    const cache = new CacheManager(vaultPath);
    const cachePath = cache.getCachePath();
    await fs.ensureDir(path.dirname(cachePath));
    const stale = `${cachePath}.111.deadbeef0001.tmp`;
    const fresh = `${cachePath}.222.deadbeef0002.tmp`;
    const unrelated = path.join(path.dirname(cachePath), "other.json.333.tmp");
    for (const f of [stale, fresh, unrelated]) {
      await fs.writeFile(f, "{}", "utf-8");
    }
    const old = (Date.now() - STALE_TMP_MAX_AGE_MS - 60_000) / 1000;
    await fs.utimes(stale, old, old);
    await fs.utimes(unrelated, old, old);

    // first write (a build) sweeps the orphan, keeps the fresh one and
    // ignores files that are not this cache's temp files
    await cache.loadOrBuild();
    expect(await fs.pathExists(stale)).toBe(false);
    expect(await fs.pathExists(fresh)).toBe(true);
    expect(await fs.pathExists(unrelated)).toBe(true);

    // invalidate() sweeps too (index --force path)
    await fs.writeFile(stale, "{}", "utf-8");
    await fs.utimes(stale, old, old);
    await cache.invalidate();
    expect(await fs.pathExists(stale)).toBe(false);
    expect(await fs.pathExists(fresh)).toBe(true);
    await fs.remove(fresh);
  });

  it(`U13 saveInferredTriples replaces the layer (index is idempotent) and flags inference on even for an empty layer ${REQ}`, async () => {
    const cache = new CacheManager(vaultPath);
    await cache.loadOrBuild();
    expect(
      (await fs.readJson(cache.getCachePath())).metadata.inferenceEnabled,
    ).toBe(false);
    const inferred = new Triple(
      new IRI(vaultPathToIRI("a.md")),
      new IRI("https://exocortex.my/ontology/exo#Instance_class"),
      new IRI("https://exocortex.my/ontology/exo#Asset"),
    );
    await cache.saveInferredTriples([inferred]);
    await cache.saveInferredTriples([inferred]); // second `index` run
    const data = await fs.readJson(cache.getCachePath());
    expect(data.inferred).toHaveLength(1);
    expect(data.metadata.inferredCount).toBe(1);
    expect(data.metadata.inferenceEnabled).toBe(true);
    expect((await cache.loadOrBuild()).triples).toHaveLength(4);

    await cache.saveInferredTriples([]);
    const empty = await fs.readJson(cache.getCachePath());
    expect(empty.metadata.inferredCount).toBe(0);
    expect(empty.metadata.inferenceEnabled).toBe(true);

    // a full rebuild switches inference off again (index re-enables it)
    await cache.invalidate();
    await cache.loadOrBuild();
    expect(
      (await fs.readJson(cache.getCachePath())).metadata.inferenceEnabled,
    ).toBe(false);
  });

  it(`U14 the rebuild threshold is a strict "more than half": exactly 50 % is still a delta ${REQ}`, async () => {
    const cache = new CacheManager(vaultPath);
    await cache.loadOrBuild(); // 4 files
    convertCalls.length = 0;
    await writeFile("a.md", "A2");
    await writeFile("nested/deep/b.md", "B2"); // 2 of 4 = 50 %
    const half = await cache.loadOrBuild();
    expect(half.mode).toBe("delta");
    expect(convertCalls[0]?.files?.map((f) => f.path).sort()).toEqual([
      "a.md",
      "nested/deep/b.md",
    ]);
    convertCalls.length = 0;
    await writeFile("a.md", "A3");
    await writeFile("nested/deep/b.md", "B3");
    await writeFile("nested/deep/c.md", "C3"); // 3 of 4 > 50 %
    expect((await cache.loadOrBuild()).mode).toBe("rebuild");
  });

  it(`U15 a vault that cannot be walked is "not valid / no diff", never a null-manifest crash ${REQ}`, async () => {
    const cache = new CacheManager(vaultPath);
    await cache.loadOrBuild();
    expect(await cache.isCacheValid()).toBe(true);
    // A non-permission failure of the walk (the adapter re-throws anything
    // but EPERM/EACCES — e.g. the vault root turned into a file, ENOTDIR).
    const { FileSystemVaultAdapter } =
      await import("../../../src/adapters/FileSystemVaultAdapter.js");
    const walk = jest
      .spyOn(FileSystemVaultAdapter.prototype, "getAllFiles")
      .mockImplementation(() => {
        throw Object.assign(new Error("ENOTDIR: not a directory"), {
          code: "ENOTDIR",
        });
      });
    try {
      expect(await cache.computeManifestDiff()).toBeNull();
      expect(await cache.isCacheValid()).toBe(false);
    } finally {
      walk.mockRestore();
    }
    expect(await cache.isCacheValid()).toBe(true);
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
