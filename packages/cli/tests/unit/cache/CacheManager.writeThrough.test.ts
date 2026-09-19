/**
 * CacheManager.refreshAfterWrite unit axes (#4264 — write-through).
 *
 * Same deterministic FAKE converter as `CacheManager.test.ts` (one label
 * triple per file, `convertVaultWithValidation` honours `files` /
 * `fileSpacePrefixes` / `onFileTriples`), so these axes isolate the cache's
 * write-through decisions from the converter; the real converter and the real
 * commands are exercised in
 * `tests/integration/use-cache-apply-write-through-4264.integration.test.ts`.
 *
 * Requirement: @req:cb707868-356f-495d-825a-182e66ba8bcd
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
import { CacheManager } from "../../../src/cache/CacheManager.js";

const REQ = "@req:cb707868-356f-495d-825a-182e66ba8bcd";
const LABEL = new IRI("https://exocortex.my/ontology/exo#Asset_label");

type ConvertOptions = Parameters<
  NoteToRDFConverter["convertVaultWithValidation"]
>[0];

describe(`CacheManager.refreshAfterWrite (#4264) ${REQ}`, () => {
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

  async function persistedLabel(rel: string): Promise<string[]> {
    const data = (await fs.readJson(
      path.join(vaultPath, ".exocortex", "cache", "triples.json"),
    )) as {
      files: Array<{
        path: string;
        triples: Array<{ object: { value: string } }>;
      }>;
    };
    const entry = data.files.find((f) => f.path === rel);
    return entry ? entry.triples.map((t) => t.object.value) : [];
  }

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cache-wt-4264-"));
    vaultPath = path.join(tempDir, "vault");
    clock = Date.now() - 60_000;
    convertCalls = [];
    convertedPaths = [];

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
        const prefixes = options.fileSpacePrefixes ?? [];
        const converted: string[] = [];
        const triples: Triple[] = [];
        for (const file of walked) {
          if (prefixes.some((p) => file.path.startsWith(p))) continue;
          const content = await fs.readFile(
            path.join(vaultPath, file.path),
            "utf-8",
          );
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
    await writeFile("nested/b.md", "B");
    await writeFile("nested/c.md", "C");
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.remove(tempDir);
  });

  it(`U1 without a cache on disk the write-through is skipped and builds nothing ${REQ}`, async () => {
    const cache = new CacheManager(vaultPath);
    await writeFile("nested/d.md", "D");
    const result = await cache.refreshAfterWrite();
    expect(result).toEqual({
      mode: "skipped",
      reparsedFiles: 0,
      reason: "no cache to refresh",
    });
    expect(convertCalls).toHaveLength(0);
    expect(await fs.pathExists(cache.getCachePath())).toBe(false);
  });

  it(`U2 after a hit the write-through diffs against the LOADED state — the cache file is not read again, only the written file is converted, and the persisted entry carries its new triples + stamp ${REQ}`, async () => {
    const cache = new CacheManager(vaultPath);
    await cache.loadOrBuild(); // rebuild + persist
    const reader = new CacheManager(vaultPath);
    expect((await reader.loadOrBuild()).mode).toBe("hit");
    convertCalls.length = 0;
    convertedPaths.length = 0;
    const readJson = jest.spyOn(fs, "readJson");

    await writeFile("nested/b.md", "B2");
    const result = await reader.refreshAfterWrite();

    expect(result).toEqual({ mode: "delta", reparsedFiles: 1 });
    expect(readJson).not.toHaveBeenCalled();
    expect(convertCalls).toHaveLength(1);
    expect(convertedPaths).toEqual([["nested/b.md"]]);
    expect(await persistedLabel("nested/b.md")).toEqual(["B2"]);
    const data = (await fs.readJson(cache.getCachePath())) as {
      files: Array<{ path: string; mtimeMs: number; size: number }>;
    };
    const entry = data.files.find((f) => f.path === "nested/b.md")!;
    const stat = await fs.stat(path.join(vaultPath, "nested/b.md"));
    expect(entry.mtimeMs).toBe(stat.mtimeMs);
    expect(entry.size).toBe(stat.size);
    // The next process is a plain hit.
    expect((await new CacheManager(vaultPath).loadOrBuild()).mode).toBe("hit");
  });

  it(`U3 without a load in this process the write-through falls back to the cache on disk (create without --validate) ${REQ}`, async () => {
    await new CacheManager(vaultPath).loadOrBuild();
    convertCalls.length = 0;
    convertedPaths.length = 0;

    await writeFile("nested/new.md", "NEW");
    const result = await new CacheManager(vaultPath).refreshAfterWrite();
    expect(result).toEqual({ mode: "delta", reparsedFiles: 1 });
    expect(convertedPaths).toEqual([["nested/new.md"]]);
    expect(await persistedLabel("nested/new.md")).toEqual(["NEW"]);
    expect((await new CacheManager(vaultPath).loadOrBuild()).mode).toBe("hit");
  });

  it(`U4 nothing changed since the loaded state → noop, no write ${REQ}`, async () => {
    const cache = new CacheManager(vaultPath);
    await cache.loadOrBuild();
    const before = await fs.stat(cache.getCachePath());
    convertCalls.length = 0;
    const writeJson = jest.spyOn(fs, "writeJson");

    const result = await cache.refreshAfterWrite();
    expect(result).toEqual({ mode: "noop", reparsedFiles: 0 });
    expect(convertCalls).toHaveLength(0);
    expect(writeJson).not.toHaveBeenCalled();
    expect((await fs.stat(cache.getCachePath())).mtimeMs).toBe(before.mtimeMs);
  });

  it(`U5 a rebuild-class change (TBox-form label) is skipped with the reason — no convert, no write; the next reader rebuilds ${REQ}`, async () => {
    const cache = new CacheManager(vaultPath);
    await cache.loadOrBuild();
    const before = await fs.readFile(cache.getCachePath(), "utf-8");
    convertCalls.length = 0;

    // The fake converter turns the CONTENT into the label; planDelta reads
    // the real frontmatter, so give the file a TBox-form exo__Asset_label.
    await writeFile("nested/c.md", "---\nexo__Asset_label: zz__Tbox\n---\n");
    const result = await cache.refreshAfterWrite();
    expect(result.mode).toBe("skipped");
    expect(result.reparsedFiles).toBe(0);
    expect(result.reason).toMatch(
      /^rebuild needed \(TBox-form asset changed: nested\/c\.md\) — left to the next reader$/,
    );
    expect(convertCalls).toHaveLength(0);
    expect(await fs.readFile(cache.getCachePath(), "utf-8")).toBe(before);
    expect((await new CacheManager(vaultPath).loadOrBuild()).mode).toBe(
      "rebuild",
    );
  });

  it(`U6 the write-through updates the loaded state: a second write-through in the same process sees only the SECOND write ${REQ}`, async () => {
    const cache = new CacheManager(vaultPath);
    await cache.loadOrBuild();
    convertedPaths.length = 0;

    await writeFile("a.md", "A2");
    expect(await cache.refreshAfterWrite()).toEqual({
      mode: "delta",
      reparsedFiles: 1,
    });
    // The second write-through diffs against what the FIRST one published —
    // in memory (no cache re-read) and with the first one's stamp.
    const readJson = jest.spyOn(fs, "readJson");
    await writeFile("nested/b.md", "B2");
    expect(await cache.refreshAfterWrite()).toEqual({
      mode: "delta",
      reparsedFiles: 1,
    });
    expect(readJson).not.toHaveBeenCalled();
    expect(convertedPaths).toEqual([["a.md"], ["nested/b.md"]]);
    expect(await cache.refreshAfterWrite()).toEqual({
      mode: "noop",
      reparsedFiles: 0,
    });
    expect(await persistedLabel("a.md")).toEqual(["A2"]);
    expect(await persistedLabel("nested/b.md")).toEqual(["B2"]);
  });

  it(`U8 after a DELTA load the write-through diffs against the refreshed state: only the file written afterwards is converted ${REQ}`, async () => {
    await new CacheManager(vaultPath).loadOrBuild();
    await writeFile("nested/b.md", "B2"); // makes the next load a delta
    const cache = new CacheManager(vaultPath);
    expect((await cache.loadOrBuild()).mode).toBe("delta");
    convertedPaths.length = 0;
    const readJson = jest.spyOn(fs, "readJson");

    await writeFile("nested/c.md", "C2");
    expect(await cache.refreshAfterWrite()).toEqual({
      mode: "delta",
      reparsedFiles: 1,
    });
    expect(convertedPaths).toEqual([["nested/c.md"]]);
    expect(readJson).not.toHaveBeenCalled();
    expect(await persistedLabel("nested/b.md")).toEqual(["B2"]);
    expect(await persistedLabel("nested/c.md")).toEqual(["C2"]);
  });

  it(`U9 after a REBUILD in the same process the write-through uses the built state (no cache re-read) ${REQ}`, async () => {
    const cache = new CacheManager(vaultPath);
    expect((await cache.loadOrBuild()).mode).toBe("rebuild");
    convertedPaths.length = 0;
    const readJson = jest.spyOn(fs, "readJson");

    await writeFile("a.md", "A2");
    expect(await cache.refreshAfterWrite()).toEqual({
      mode: "delta",
      reparsedFiles: 1,
    });
    expect(convertedPaths).toEqual([["a.md"]]);
    expect(readJson).not.toHaveBeenCalled();
    expect((await new CacheManager(vaultPath).loadOrBuild()).mode).toBe("hit");
  });

  it(`U10 loaded state and its stamp move TOGETHER on every read: after a concurrent index and an intermediate isCacheValid(), the write-through folds into index's layer (stamp fresh ⇒ snapshot fresh) ${REQ}`, async () => {
    const a = new CacheManager(vaultPath);
    expect((await a.loadOrBuild()).mode).toBe("rebuild");
    // Concurrent `index` persists an inferred layer (cache file only).
    const marker = new Triple(
      new IRI(vaultPathToIRI("a.md")),
      new IRI("https://exocortex.my/ontology/exo#Instance_class"),
      new IRI("https://exocortex.my/ontology/ems#Marker"),
    );
    await new CacheManager(vaultPath).saveInferredTriples([marker]);
    // A re-reads for an unrelated reason (validity check) — the stamp is now
    // the new file's; the snapshot MUST be the new content too.
    expect(await a.isCacheValid()).toBe(true);
    await writeFile("nested/b.md", "B2");
    const readJson = jest.spyOn(fs, "readJson");
    expect(await a.refreshAfterWrite()).toEqual({
      mode: "delta",
      reparsedFiles: 1,
    });
    expect(readJson).not.toHaveBeenCalled(); // trusted the (fresh) snapshot
    const data = (await fs.readJson(a.getCachePath())) as {
      metadata: { inferenceEnabled: boolean; inferredCount: number };
      inferred: Array<{ object: { value: string } }>;
    };
    expect(data.metadata.inferenceEnabled).toBe(true);
    expect(data.inferred.map((t) => t.object.value)).toEqual([
      "https://exocortex.my/ontology/ems#Marker",
    ]);
    expect(await persistedLabel("nested/b.md")).toEqual(["B2"]);
  });

  it(`U11 a write-through after a concurrent index WITHOUT any intermediate read: the stamp guard drops the stale snapshot, re-reads once, keeps index's layer ${REQ}`, async () => {
    const a = new CacheManager(vaultPath);
    await a.loadOrBuild();
    const marker = new Triple(
      new IRI(vaultPathToIRI("a.md")),
      new IRI("https://exocortex.my/ontology/exo#Instance_class"),
      new IRI("https://exocortex.my/ontology/ems#Marker"),
    );
    await new CacheManager(vaultPath).saveInferredTriples([marker]);
    await writeFile("nested/c.md", "C2");
    const readJson = jest.spyOn(fs, "readJson");
    expect(await a.refreshAfterWrite()).toEqual({
      mode: "delta",
      reparsedFiles: 1,
    });
    expect(readJson).toHaveBeenCalledTimes(1); // the fallback read, exactly once
    const data = (await fs.readJson(a.getCachePath())) as {
      metadata: { inferenceEnabled: boolean };
      inferred: Array<{ object: { value: string } }>;
    };
    expect(data.metadata.inferenceEnabled).toBe(true);
    expect(data.inferred).toHaveLength(1);
    expect(await persistedLabel("nested/c.md")).toEqual(["C2"]);
    // …and the re-read state is now the trusted snapshot for the next one
    // (the two reads above are this test's own `fs.readJson` calls).
    const readsSoFar = readJson.mock.calls.length;
    await writeFile("a.md", "A2");
    expect(await a.refreshAfterWrite()).toEqual({
      mode: "delta",
      reparsedFiles: 1,
    });
    expect(readJson.mock.calls.length).toBe(readsSoFar);
  });

  it(`U12 a write-through deserializes NONE of the cached triples when the inferred layer needs no recompute: the command keeps its own store, so only the changed file is parsed and the snapshot is merged serialized-to-serialized (the memory axis, counted by calls, not by RSS) ${REQ}`, async () => {
    const a = new CacheManager(vaultPath);
    expect((await a.loadOrBuild()).mode).toBe("rebuild"); // 3 files
    // An inferred layer is present (as after `index`) — but a label edit feeds
    // neither engine, so the layer is retained as-is, not re-materialized.
    const marker = new Triple(
      new IRI(vaultPathToIRI("a.md")),
      new IRI("https://exocortex.my/ontology/exo#Instance_class"),
      new IRI("https://exocortex.my/ontology/ems#Marker"),
    );
    await new CacheManager(vaultPath).saveInferredTriples([marker]);
    expect(await a.isCacheValid()).toBe(true); // snapshot refreshed to index's file
    await writeFile("nested/b.md", "B2");
    const deserialize = jest.spyOn(
      CacheManager.prototype as unknown as {
        deserializeTriple: (t: unknown) => unknown;
      },
      "deserializeTriple",
    );
    expect(await a.refreshAfterWrite()).toEqual({
      mode: "delta",
      reparsedFiles: 1,
    });
    // 0, not 3 (explicit) + 1 (inferred): a full deserialized copy of the
    // vault's triples is exactly the second store the write-through must not
    // build in a process that already holds one.
    expect(deserialize).not.toHaveBeenCalled();
    expect(convertedPaths).toEqual([
      ["a.md", "nested/b.md", "nested/c.md"],
      ["nested/b.md"],
    ]);
    // …and the persisted result is still complete: new label, layer intact.
    expect(await persistedLabel("nested/b.md")).toEqual(["B2"]);
    const data = (await fs.readJson(a.getCachePath())) as {
      metadata: { inferenceEnabled: boolean };
      inferred: Array<{ object: { value: string } }>;
    };
    expect(data.metadata.inferenceEnabled).toBe(true);
    expect(data.inferred.map((t) => t.object.value)).toEqual([
      "https://exocortex.my/ontology/ems#Marker",
    ]);
  });

  it(`U7 a persist failure propagates from refreshAfterWrite (the command layer turns it into a stderr warning) and leaves the previous cache file intact ${REQ}`, async () => {
    const cache = new CacheManager(vaultPath);
    await cache.loadOrBuild();
    const before = await fs.readFile(cache.getCachePath(), "utf-8");
    jest
      .spyOn(fs, "rename")
      .mockRejectedValue(new Error("EACCES (injected)") as never);

    await writeFile("a.md", "A2");
    await expect(cache.refreshAfterWrite()).rejects.toThrow(
      "EACCES (injected)",
    );
    expect(await fs.readFile(cache.getCachePath(), "utf-8")).toBe(before);
    // No orphaned temp file is left behind by the failed write.
    const siblings = (
      await fs.readdir(path.dirname(cache.getCachePath()))
    ).filter((n) => n.endsWith(".tmp"));
    expect(siblings).toEqual([]);
  });
});
