/**
 * @jest-environment node
 *
 * Reason: TarExtractor consumes Web Streams (ReadableStream,
 * CompressionStream/DecompressionStream, Response) which are provided by
 * Node 18+'s globalThis but NOT exposed by jest-environment-jsdom. Switching
 * to the node env makes them available. TarExtractor itself is DOM-free —
 * no React, no Obsidian UI surface — so the node env is the right fit.
 */
import { createTar } from "nanotar";

import {
  ExtractedTarFile,
  TarExtractor,
  ZipSlipError,
  normalizePath,
  validateEntry,
} from "../../src/infrastructure/adapters/TarExtractor";

// ─── Fixture helpers (real nanotar encoding for realism per test-fixture-realism rule) ───

/** Build a gzipped tarball from file/dir entries via real nanotar.createTar + native gzip. */
async function makeTarball(
  entries: Array<{ name: string; data?: Uint8Array }>,
): Promise<Uint8Array> {
  const files = entries.map((e) => ({
    name: e.name,
    data: e.data === undefined ? undefined : e.data,
  }));
  const tarBuf = createTar(files);
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(tarBuf);
      c.close();
    },
  }).pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Build a gzipped tarball with one or more entries' type-byte patched at
 * header offset 156 — used to generate symlink ('2') / hardlink ('1') fixtures
 * since nanotar.createTar emits only files ('0') or directories ('5').
 *
 * nanotar's parser doesn't verify the header checksum, so we leave it stale
 * after patching — the parser still emits the patched `type` via tarItemTypeMap.
 */
async function makeAdversarialTarball(
  entries: Array<{ name: string; data?: Uint8Array; typeByte?: string }>,
): Promise<Uint8Array> {
  const files = entries.map((e) => ({
    name: e.name,
    data: e.data ?? new Uint8Array(0),
  }));
  const tarBuf = createTar(files);
  let offset = 0;
  for (const entry of entries) {
    if (entry.typeByte) {
      tarBuf[offset + 156] = entry.typeByte.charCodeAt(0);
    }
    const size = entry.data?.length ?? 0;
    offset += 512;
    if (size > 0) {
      offset += 512 * Math.trunc(size / 512);
      if (size % 512) offset += 512;
    }
  }
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(tarBuf);
      c.close();
    },
  }).pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function collect(
  it: AsyncIterable<ExtractedTarFile>,
): Promise<ExtractedTarFile[]> {
  const out: ExtractedTarFile[] = [];
  for await (const e of it) out.push(e);
  return out;
}

// ─── normalizePath ──────────────────────────────────────────────────────────

describe("normalizePath", () => {
  it("converts backslashes to forward slashes", () => {
    expect(normalizePath("foo\\bar\\baz")).toBe("foo/bar/baz");
  });
  it("collapses runs of forward slashes", () => {
    expect(normalizePath("foo//bar///baz")).toBe("foo/bar/baz");
  });
  it("strips a single leading ./", () => {
    expect(normalizePath("./foo/bar")).toBe("foo/bar");
  });
  it("strips repeated leading ./ runs", () => {
    expect(normalizePath("././foo")).toBe("foo");
  });
  it("strips a single leading /", () => {
    expect(normalizePath("/foo/bar")).toBe("foo/bar");
  });
  it("leaves benign paths unchanged", () => {
    expect(normalizePath("staging/foo/bar.txt")).toBe("staging/foo/bar.txt");
  });
});

// ─── validateEntry — zip-slip checks via synthetic entries ──────────────────

describe("validateEntry — zip-slip protection (unit, synthetic entries)", () => {
  const prefix = "staging/";

  it("accepts a valid entry under prefix", () => {
    expect(() =>
      validateEntry({ name: "staging/foo.txt", type: "file" }, prefix),
    ).not.toThrow();
  });

  it("rejects empty name", () => {
    expect(() => validateEntry({ name: "" }, prefix)).toThrow(ZipSlipError);
  });

  it("rejects non-string name (defensive coerce)", () => {
    expect(() =>
      validateEntry({ name: null as unknown as string }, prefix),
    ).toThrow(ZipSlipError);
  });

  it("rejects absolute POSIX path", () => {
    expect(() =>
      validateEntry({ name: "/etc/passwd", type: "file" }, prefix),
    ).toThrow(/Absolute path rejected/);
  });

  it("rejects absolute backslash path", () => {
    expect(() =>
      validateEntry({ name: "\\foo\\bar", type: "file" }, prefix),
    ).toThrow(/Absolute path rejected/);
  });

  it("rejects Windows drive-letter path", () => {
    expect(() =>
      validateEntry(
        { name: "C:/Windows/system32/cmd.exe", type: "file" },
        prefix,
      ),
    ).toThrow(/Absolute path rejected/);
  });

  it("rejects Windows drive-letter backslash path", () => {
    expect(() =>
      validateEntry({ name: "C:\\foo\\bar", type: "file" }, prefix),
    ).toThrow(/Absolute path rejected/);
  });

  it("rejects leading ../ segment", () => {
    expect(() =>
      validateEntry({ name: "../foo", type: "file" }, prefix),
    ).toThrow(/Parent-dir traversal/);
  });

  it("rejects embedded /../ segment", () => {
    expect(() =>
      validateEntry(
        { name: "staging/sub/../../etc/passwd", type: "file" },
        prefix,
      ),
    ).toThrow(/Parent-dir traversal/);
  });

  it("rejects symbolicLink type even with benign path", () => {
    expect(() =>
      validateEntry(
        { name: "staging/inside.txt", type: "symbolicLink" },
        prefix,
      ),
    ).toThrow(/Symbolic-link/);
  });

  it("rejects hardLink type even with benign path", () => {
    expect(() =>
      validateEntry({ name: "staging/inside.txt", type: "hardLink" }, prefix),
    ).toThrow(/Hard-link/);
  });

  it("rejects path outside staging prefix", () => {
    expect(() =>
      validateEntry({ name: "other/foo.txt", type: "file" }, prefix),
    ).toThrow(/outside staging prefix/);
  });

  it("accepts any path when prefix is empty (gate disabled)", () => {
    expect(() =>
      validateEntry({ name: "any/path/foo.txt", type: "file" }, ""),
    ).not.toThrow();
  });

  it("ZipSlipError instances have correct .name", () => {
    try {
      validateEntry({ name: "" }, prefix);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ZipSlipError);
      expect((e as Error).name).toBe("ZipSlipError");
    }
  });

  it("includes the offending raw name in the error message", () => {
    try {
      validateEntry({ name: "/etc/passwd", type: "file" }, prefix);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as Error).message).toContain("/etc/passwd");
    }
  });

  it("link checks fire BEFORE absolute-path checks (link is more dangerous)", () => {
    // A symlink with absolute name → caught by symbolicLink check, not absolute-path check.
    try {
      validateEntry({ name: "/etc/passwd", type: "symbolicLink" }, prefix);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as Error).message).toMatch(/Symbolic-link/);
      expect((e as Error).message).not.toMatch(/Absolute path/);
    }
  });
});

// ─── TarExtractor — end-to-end via real nanotar createTar + parseTarGzip ───

describe("TarExtractor.extract — end-to-end (real nanotar round-trip)", () => {
  const PREFIX = "staging/";

  it("yields entries with path + content for a valid tarball", async () => {
    const blob = await makeTarball([
      { name: "staging/a.txt", data: new TextEncoder().encode("AAA") },
      { name: "staging/sub/b.txt", data: new TextEncoder().encode("BBB") },
    ]);
    const items = await collect(
      new TarExtractor().extract(blob, { stagingDirPrefix: PREFIX }),
    );
    expect(items.map((i) => i.path)).toEqual([
      "staging/a.txt",
      "staging/sub/b.txt",
    ]);
    expect(new TextDecoder().decode(items[0].content)).toBe("AAA");
    expect(new TextDecoder().decode(items[1].content)).toBe("BBB");
  });

  it("accepts both ArrayBuffer and Uint8Array inputs", async () => {
    const u8 = await makeTarball([
      { name: "staging/a.txt", data: new TextEncoder().encode("X") },
    ]);
    // Uint8Array path
    const fromU8 = await collect(
      new TarExtractor().extract(u8, { stagingDirPrefix: PREFIX }),
    );
    expect(fromU8).toHaveLength(1);
    // ArrayBuffer path (slice copy to ensure ArrayBuffer not SharedArrayBuffer)
    const ab = u8.buffer.slice(
      u8.byteOffset,
      u8.byteOffset + u8.byteLength,
    ) as ArrayBuffer;
    const fromAb = await collect(
      new TarExtractor().extract(ab, { stagingDirPrefix: PREFIX }),
    );
    expect(fromAb).toHaveLength(1);
  });

  it("rejects /etc/passwd (parser sanitises → prefix gate fires)", async () => {
    const blob = await makeTarball([
      { name: "/etc/passwd", data: new Uint8Array([1, 2, 3]) },
    ]);
    const it = new TarExtractor().extract(blob, { stagingDirPrefix: PREFIX });
    await expect(collect(it)).rejects.toThrow(ZipSlipError);
  });

  it("rejects ../foo (parser sanitises → prefix gate fires)", async () => {
    const blob = await makeTarball([
      { name: "../foo", data: new Uint8Array([1, 2, 3]) },
    ]);
    const it = new TarExtractor().extract(blob, { stagingDirPrefix: PREFIX });
    await expect(collect(it)).rejects.toThrow(ZipSlipError);
  });

  it("rejects path outside staging prefix (e.g. other/foo)", async () => {
    const blob = await makeTarball([
      { name: "other/foo.txt", data: new Uint8Array([1, 2, 3]) },
    ]);
    const it = new TarExtractor().extract(blob, { stagingDirPrefix: PREFIX });
    await expect(collect(it)).rejects.toThrow(/outside staging prefix/);
  });

  it("rejects symbolicLink entry (header type-byte patched to '2')", async () => {
    const blob = await makeAdversarialTarball([
      { name: "staging/evil", data: new Uint8Array(0), typeByte: "2" },
    ]);
    const it = new TarExtractor().extract(blob, { stagingDirPrefix: PREFIX });
    await expect(collect(it)).rejects.toThrow(/Symbolic-link/);
  });

  it("rejects hardLink entry (header type-byte patched to '1')", async () => {
    const blob = await makeAdversarialTarball([
      { name: "staging/evil", data: new Uint8Array(0), typeByte: "1" },
    ]);
    const it = new TarExtractor().extract(blob, { stagingDirPrefix: PREFIX });
    await expect(collect(it)).rejects.toThrow(/Hard-link/);
  });

  it("silently skips directory entries (type '5')", async () => {
    // createTar emits type '5' (directory) for entries with undefined data.
    const blob = await makeTarball([
      { name: "staging/dir" }, // → directory
      { name: "staging/dir/file.txt", data: new TextEncoder().encode("X") },
    ]);
    const items = await collect(
      new TarExtractor().extract(blob, { stagingDirPrefix: PREFIX }),
    );
    expect(items.map((i) => i.path)).toEqual(["staging/dir/file.txt"]);
  });

  it("handles an empty tarball (zero entries)", async () => {
    const blob = await makeTarball([]);
    const items = await collect(
      new TarExtractor().extract(blob, { stagingDirPrefix: PREFIX }),
    );
    expect(items).toEqual([]);
  });

  it("yields a zero-byte Uint8Array for an empty-data file entry", async () => {
    // nanotar.parseTar sets `data: undefined` for size===0 entries — the
    // `?? new Uint8Array(0)` fallback in TarExtractor ensures the yielded
    // content is always a Uint8Array (never undefined).
    const blob = await makeTarball([
      { name: "staging/empty.txt", data: new Uint8Array(0) },
    ]);
    const items = await collect(
      new TarExtractor().extract(blob, { stagingDirPrefix: PREFIX }),
    );
    expect(items).toHaveLength(1);
    expect(items[0].path).toBe("staging/empty.txt");
    expect(items[0].content).toBeInstanceOf(Uint8Array);
    expect(items[0].content.byteLength).toBe(0);
  });

  it("preserves entry order (not alphabetised)", async () => {
    const blob = await makeTarball([
      { name: "staging/03.txt", data: new TextEncoder().encode("3") },
      { name: "staging/01.txt", data: new TextEncoder().encode("1") },
      { name: "staging/02.txt", data: new TextEncoder().encode("2") },
    ]);
    const items = await collect(
      new TarExtractor().extract(blob, { stagingDirPrefix: PREFIX }),
    );
    expect(items.map((i) => i.path)).toEqual([
      "staging/03.txt",
      "staging/01.txt",
      "staging/02.txt",
    ]);
  });

  it("requires stagingDirPrefix option", () => {
    expect(() =>
      new TarExtractor().extract(
        new ArrayBuffer(0),
        {} as unknown as {
          stagingDirPrefix: string;
        },
      ),
    ).toThrow(/stagingDirPrefix is required/);
    expect(() =>
      new TarExtractor().extract(
        new ArrayBuffer(0),
        null as unknown as { stagingDirPrefix: string },
      ),
    ).toThrow(/stagingDirPrefix is required/);
  });

  it("first violation aborts iteration (later entries never yielded)", async () => {
    const blob = await makeTarball([
      { name: "other/forbidden", data: new TextEncoder().encode("F") },
      { name: "staging/ok.txt", data: new TextEncoder().encode("OK") },
    ]);
    const items: ExtractedTarFile[] = [];
    await expect(
      (async () => {
        for await (const e of new TarExtractor().extract(blob, {
          stagingDirPrefix: PREFIX,
        })) {
          items.push(e);
        }
      })(),
    ).rejects.toThrow(ZipSlipError);
    expect(items).toEqual([]); // no yield happened before the throw
  });

  it("runs finally cleanup on early caller-abort (iterator.return())", async () => {
    const blob = await makeTarball([
      { name: "staging/a.txt", data: new TextEncoder().encode("A") },
      { name: "staging/b.txt", data: new TextEncoder().encode("B") },
      { name: "staging/c.txt", data: new TextEncoder().encode("C") },
    ]);
    const iter = new TarExtractor()
      .extract(blob, { stagingDirPrefix: PREFIX })
      [Symbol.asyncIterator]() as AsyncIterableIterator<ExtractedTarFile>;
    const first = await iter.next();
    expect(first.done).toBe(false);
    expect((first.value as ExtractedTarFile).path).toBe("staging/a.txt");
    // Caller bails out — generator's finally block fires (parsed.length = 0).
    const closed = await iter.return!(undefined);
    expect(closed.done).toBe(true);
    // Subsequent next() returns done.
    const after = await iter.next();
    expect(after.done).toBe(true);
  });

  it("propagates nanotar parse failure as a regular Error (not ZipSlipError)", async () => {
    // Garbage bytes — not a valid gzip stream.
    const garbage = new Uint8Array([0xff, 0xfe, 0xfd, 0xfc, 0xfb, 0xfa]);
    const it = new TarExtractor().extract(garbage, {
      stagingDirPrefix: PREFIX,
    });
    await expect(collect(it)).rejects.toThrow();
    // The thrown error should NOT be a ZipSlipError (parse errors are
    // structurally different from access-control violations).
    await expect(collect(it)).rejects.not.toBeInstanceOf(ZipSlipError);
  });
});
