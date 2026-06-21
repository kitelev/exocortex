import "reflect-metadata";
import { NoteToRDFConverter } from "../../../src/services/NoteToRDFConverter";
import { IVaultAdapter, IFile } from "../../../src/interfaces/IVaultAdapter";
import type { ILogger } from "../../../src/interfaces/ILogger";

/**
 * #al-activitylog-progress — `convertVaultWithValidation` must emit PERIODIC
 * `onProgress(processed, total)` during a long walk so the activity log shows
 * indexing advancing, not just the one-shot completion notice (#3472).
 *
 * Contract pinned here:
 *   1. Emits at every `progressIntervalFiles`-th file with `(processed, total)`.
 *   2. NEVER emits the redundant terminal `total of total` (completion is the
 *      caller's own notice) — and a vault smaller than one interval stays quiet.
 *   3. `total` is the post-exclusion file count; `processed` counts every file
 *      visited (indexed AND skipped), so progress advances even on a dirty vault.
 *   4. Best-effort — a throwing observer never aborts the walk.
 *
 * Revert-verify: delete the `onProgress(...)` call from the walk loop and tests
 * 1/3 fail (zero emissions); restore → pass.
 */

function createMockLogger(): jest.Mocked<ILogger> {
  return { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

function mkFile(path: string): IFile {
  const name = path.split("/").pop()!;
  return { path, basename: name.replace(/\.md$/, ""), name, parent: null };
}

function mkVault(files: IFile[]): jest.Mocked<IVaultAdapter> {
  return {
    getFrontmatter: jest.fn(() => ({
      // Empty Instance_class → invariant violation → file is SKIPPED, but the
      // loop still visits it and increments `processed` (the progress counter
      // covers skipped files too — point 3). Keeps the fixture trivially small.
      exo__Asset_uid: "u",
      exo__Asset_label: "L",
      exo__Instance_class: "",
    })),
    getAllFiles: jest.fn(() => files),
    read: jest.fn(),
    create: jest.fn(),
    modify: jest.fn(),
    delete: jest.fn(),
    exists: jest.fn(),
    getAbstractFileByPath: jest.fn(),
    updateFrontmatter: jest.fn(),
    rename: jest.fn(),
    createFolder: jest.fn(),
    getFirstLinkpathDest: jest.fn(),
    process: jest.fn(),
    updateLinks: jest.fn(),
    getDefaultNewFileParent: jest.fn(),
  } as unknown as jest.Mocked<IVaultAdapter>;
}

describe("NoteToRDFConverter — periodic index progress (#al-activitylog-progress)", () => {
  it("emits onProgress every N files with (processed, total)", async () => {
    const files = Array.from({ length: 10 }, (_, i) => mkFile(`a${i}.md`));
    const converter = new NoteToRDFConverter(mkVault(files), createMockLogger());
    const ticks: Array<[number, number]> = [];

    await converter.convertVaultWithValidation({
      progressIntervalFiles: 3,
      onProgress: (processed, total) => ticks.push([processed, total]),
    });

    // Multiples of 3 below the total of 10 → 3, 6, 9. NOT 10 (no terminal tick).
    expect(ticks).toEqual([
      [3, 10],
      [6, 10],
      [9, 10],
    ]);
  });

  it("stays quiet for a vault smaller than one interval (no spam, no terminal tick)", async () => {
    const files = Array.from({ length: 2 }, (_, i) => mkFile(`b${i}.md`));
    const converter = new NoteToRDFConverter(mkVault(files), createMockLogger());
    const ticks: Array<[number, number]> = [];

    await converter.convertVaultWithValidation({
      progressIntervalFiles: 3,
      onProgress: (processed, total) => ticks.push([processed, total]),
    });

    expect(ticks).toEqual([]);
  });

  it("defaults to the class interval when none is supplied (sparse on large vault)", async () => {
    const files = Array.from({ length: 450 }, (_, i) => mkFile(`c${i}.md`));
    const converter = new NoteToRDFConverter(mkVault(files), createMockLogger());
    const ticks: Array<[number, number]> = [];

    await converter.convertVaultWithValidation({
      onProgress: (processed) => ticks.push([processed, NoteToRDFConverter.INDEX_PROGRESS_INTERVAL]),
    });

    // Default INDEX_PROGRESS_INTERVAL = 200 → ticks at 200 and 400 (not 450).
    expect(ticks.map(([p]) => p)).toEqual([200, 400]);
  });

  it("a throwing observer never aborts the walk", async () => {
    const files = Array.from({ length: 6 }, (_, i) => mkFile(`d${i}.md`));
    const converter = new NoteToRDFConverter(mkVault(files), createMockLogger());

    const result = await converter.convertVaultWithValidation({
      progressIntervalFiles: 2,
      onProgress: () => {
        throw new Error("hostile observer");
      },
    });

    // Walk completed despite every progress tick throwing.
    expect(result.summary.total).toBe(6);
  });

  it("omitting onProgress is a zero-cost no-op (CLI / non-plugin path)", async () => {
    const files = Array.from({ length: 5 }, (_, i) => mkFile(`e${i}.md`));
    const converter = new NoteToRDFConverter(mkVault(files), createMockLogger());

    await expect(
      converter.convertVaultWithValidation({ progressIntervalFiles: 1 }),
    ).resolves.toMatchObject({ summary: { total: 5 } });
  });
});
