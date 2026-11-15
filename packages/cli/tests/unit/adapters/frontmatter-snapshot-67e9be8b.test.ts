/**
 * ems__Bug 67e9be8b — `create --validate` re-read the frontmatter of the
 * TARGET of every wikilink from disk.
 *
 * Mechanism (measured on a vault-exodev copy, CLI v17.20.0): the vault walk
 * reads each file once for its own triples, and then `NoteToRDFConverter`
 * resolves every wikilink value through `targetFrontmatter` →
 * `FileSystemVaultAdapter.getFrontmatter`, which is `readFileSync` + parse with
 * no memory. A target referenced by N assets was read N + 2 times; on 66 244
 * files that was 745 368 reads, 43 743 of them for one file.
 *
 * The fix is a read SNAPSHOT scoped to one walk: `convertVaultWithValidation`
 * runs inside the adapter's optional `withFrontmatterSnapshot`, during which
 * `getFrontmatter` is memoised by path. These axes drive the REAL loader
 * (`loadVaultTriples` — the full-parse path `create --validate`, `query`,
 * `validate schema` share) and the REAL `CandidateShaclValidator` over a REAL
 * temp vault, and count reads at the filesystem seam the adapter uses.
 *
 * Axis names lead the test title (`R<n> …`) — the mutant driver reads them.
 */
import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { loadVaultTriples } from "../../../src/cache/loadVaultTriples.js";
import { FileSystemVaultAdapter } from "../../../src/adapters/FileSystemVaultAdapter.js";
import { CandidateShaclValidator } from "../../../src/services/CandidateShaclValidator.js";

const CLASS_UID = "11111111-1111-4111-8111-111111111111";
const TARGET_UID = "22222222-2222-4222-8222-222222222222";
const REFERRERS = 6;

function referrerUid(i: number): string {
  return `33333333-3333-4333-8333-33333333333${i}`;
}

function writeAsset(
  dir: string,
  uid: string,
  lines: string[],
  body = "",
): string {
  const file = path.join(dir, `${uid}.md`);
  fs.writeFileSync(
    file,
    ["---", `exo__Asset_uid: ${uid}`, ...lines, "---", body].join("\n"),
    "utf-8",
  );
  return file;
}

/** A vault where one target and one class are referenced by every referrer. */
function buildVault(root: string): { target: string; klass: string } {
  const dir = path.join(root, "notes");
  fs.mkdirpSync(dir);
  const klass = writeAsset(dir, CLASS_UID, [
    "exo__Asset_label: ems__Task",
    "exo__Instance_class: exo__Class",
  ]);
  const target = writeAsset(dir, TARGET_UID, [
    "exo__Asset_label: Target",
    `exo__Instance_class: "[[${CLASS_UID}]]"`,
  ]);
  for (let i = 0; i < REFERRERS; i++) {
    writeAsset(dir, referrerUid(i), [
      `exo__Asset_label: Referrer ${i}`,
      `exo__Instance_class: "[[${CLASS_UID}]]"`,
      `exo__Asset_relates: "[[${TARGET_UID}]]"`,
    ]);
  }
  return { target, klass };
}

/** Count `fs.readFileSync` calls per absolute path, passing every call through. */
function countReads(): { counts: Map<string, number>; restore: () => void } {
  const counts = new Map<string, number>();
  const real = fs.readFileSync;
  const spy = jest
    .spyOn(fs, "readFileSync")
    .mockImplementation(((p: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
      if (typeof p === "string") {
        const key = path.resolve(p);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return (real as (...a: unknown[]) => unknown).call(fs, p, ...rest);
    }) as typeof fs.readFileSync);
  return { counts, restore: () => spy.mockRestore() };
}

function canonical(triples: Array<{ toString(): string }>): string[] {
  return triples.map((t) => t.toString()).sort();
}

describe("ems__Bug 67e9be8b — one read per file per vault walk", () => {
  let root: string;
  let files: { target: string; klass: string };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "fm-snapshot-67e9be8b-"));
    files = buildVault(root);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.removeSync(root);
  });

  it("R1 the full-parse loader reads a target referenced N times exactly once", async () => {
    const { counts, restore } = countReads();
    let loaded;
    try {
      loaded = await loadVaultTriples(root, { useCache: false });
    } finally {
      restore();
    }
    // Canary: the walk really happened and really resolved the references —
    // otherwise "1 read" would be the read count of a walk that did nothing.
    const relates = canonical(loaded.triples).filter(
      (t) => t.includes("Asset_relates") && t.includes(TARGET_UID),
    );
    expect(relates).toHaveLength(REFERRERS);
    expect(counts.get(path.resolve(files.target))).toBe(1);
    expect(counts.get(path.resolve(files.klass))).toBe(1);
    // No file of the vault is read twice by one walk.
    expect(Math.max(...counts.values())).toBe(1);
  });

  it("R2 the snapshot changes no triple and no skip decision", async () => {
    const withSnapshot = await loadVaultTriples(root, { useCache: false });
    // The same walk on an adapter WITHOUT the capability — the pre-fix path.
    const bare = new FileSystemVaultAdapter(root) as FileSystemVaultAdapter & {
      withFrontmatterSnapshot?: unknown;
    };
    Object.defineProperty(bare, "withFrontmatterSnapshot", { value: undefined });
    const without = await loadVaultTriples(root, {
      useCache: false,
      vaultAdapter: bare,
    });
    expect(canonical(withSnapshot.triples)).toEqual(canonical(without.triples));
    expect(withSnapshot.skippedFiles).toEqual(without.skippedFiles);
    expect(withSnapshot.zeroTriplePaths).toEqual(without.zeroTriplePaths);
    expect(withSnapshot.triples.length).toBeGreaterThan(REFERRERS);
  });

  it("R3 `create --validate`'s validator reads the target once", async () => {
    const candidateUid = "44444444-4444-4444-8444-444444444444";
    const content = [
      "---",
      `exo__Asset_uid: ${candidateUid}`,
      "exo__Asset_label: Candidate",
      `exo__Instance_class: "[[${CLASS_UID}]]"`,
      `exo__Asset_relates: "[[${TARGET_UID}]]"`,
      "---",
      "",
    ].join("\n");
    const { counts, restore } = countReads();
    try {
      await new CandidateShaclValidator(root).validateCandidate(
        `notes/${candidateUid}.md`,
        content,
      );
    } finally {
      restore();
    }
    // The candidate's own conversion runs OUTSIDE the walk (a single file, by
    // design), so its two lookups may add up to one read each on top of the
    // walk's one. Before the fix the target alone was read N + 2 times more.
    expect(counts.get(path.resolve(files.target)) ?? 0).toBeLessThanOrEqual(3);
    expect(counts.get(path.resolve(files.target)) ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("R4 a write through the adapter inside the snapshot is read back fresh", async () => {
    const adapter = new FileSystemVaultAdapter(root);
    const file = adapter.getAbstractFileByPath(`notes/${TARGET_UID}.md`);
    if (!file || !("basename" in file)) throw new Error("fixture missing");
    const labels = await adapter.withFrontmatterSnapshot(async () => {
      const before = adapter.getFrontmatter(file)?.exo__Asset_label;
      await adapter.modify(
        file,
        fs
          .readFileSync(files.target, "utf-8")
          .replace("exo__Asset_label: Target", "exo__Asset_label: Renamed"),
      );
      return [before, adapter.getFrontmatter(file)?.exo__Asset_label];
    });
    expect(labels).toEqual(["Target", "Renamed"]);
  });

  it("R5 the memory ends with the snapshot — an outside write is seen afterwards", async () => {
    const adapter = new FileSystemVaultAdapter(root);
    const file = adapter.getAbstractFileByPath(`notes/${TARGET_UID}.md`);
    if (!file || !("basename" in file)) throw new Error("fixture missing");
    await adapter.withFrontmatterSnapshot(async () => {
      expect(adapter.getFrontmatter(file)?.exo__Asset_label).toBe("Target");
    });
    // Written behind the adapter's back (another process), after the walk.
    fs.writeFileSync(
      files.target,
      fs
        .readFileSync(files.target, "utf-8")
        .replace("exo__Asset_label: Target", "exo__Asset_label: Outside"),
    );
    expect(adapter.getFrontmatter(file)?.exo__Asset_label).toBe("Outside");
  });

  // Two axes, one per end of the inner scope, so that "the inner START replaces
  // the outer memory" and "the inner END drops it" redden different axes
  // (§A147: one mutant set per guard).
  async function nestedReads(): Promise<{ inner: number; after: number }> {
    const adapter = new FileSystemVaultAdapter(root);
    const file = adapter.getAbstractFileByPath(`notes/${TARGET_UID}.md`);
    if (!file || !("basename" in file)) throw new Error("fixture missing");
    const key = path.resolve(files.target);
    const { counts, restore } = countReads();
    const at = (): number => counts.get(key) ?? 0;
    let inner = -1;
    let after = -1;
    try {
      await adapter.withFrontmatterSnapshot(async () => {
        adapter.getFrontmatter(file);
        const beforeInner = at();
        await adapter.withFrontmatterSnapshot(async () => {
          adapter.getFrontmatter(file);
          inner = at() - beforeInner;
        });
        const beforeAfter = at();
        adapter.getFrontmatter(file);
        after = at() - beforeAfter;
      });
    } finally {
      restore();
    }
    return { inner, after };
  }

  it("R6a a nested snapshot starts on the outer memory (no read inside it)", async () => {
    expect((await nestedReads()).inner).toBe(0);
  });

  it("R6b a nested snapshot's end leaves the outer memory in place", async () => {
    expect((await nestedReads()).after).toBe(0);
  });

  it("R7 a walk that throws still ends the snapshot", async () => {
    const adapter = new FileSystemVaultAdapter(root);
    const file = adapter.getAbstractFileByPath(`notes/${TARGET_UID}.md`);
    if (!file || !("basename" in file)) throw new Error("fixture missing");
    await expect(
      adapter.withFrontmatterSnapshot(async () => {
        adapter.getFrontmatter(file);
        throw new Error("walk failed");
      }),
    ).rejects.toThrow("walk failed");
    fs.writeFileSync(
      files.target,
      fs
        .readFileSync(files.target, "utf-8")
        .replace("exo__Asset_label: Target", "exo__Asset_label: AfterThrow"),
    );
    expect(adapter.getFrontmatter(file)?.exo__Asset_label).toBe("AfterThrow");
  });

  // One axis per adapter write path that must drop the memory (§A6: a shared
  // invalidation helper called from several branches is pinned branch by branch).
  it("R9 a file created inside the snapshot is read back, not the remembered absence", async () => {
    const adapter = new FileSystemVaultAdapter(root);
    const rel = "notes/55555555-5555-4555-8555-555555555555.md";
    const ghost = { path: rel, basename: path.basename(rel, ".md"), name: path.basename(rel), parent: null } as Parameters<
      typeof adapter.getFrontmatter
    >[0];
    const seen = await adapter.withFrontmatterSnapshot(async () => {
      const before = adapter.getFrontmatter(ghost);
      await adapter.create(rel, "---\nexo__Asset_label: Born\n---\n");
      return [before, adapter.getFrontmatter(ghost)?.exo__Asset_label];
    });
    expect(seen).toEqual([null, "Born"]);
  });

  it("R10 a file deleted inside the snapshot reads as absent", async () => {
    const adapter = new FileSystemVaultAdapter(root);
    const file = adapter.getAbstractFileByPath(`notes/${TARGET_UID}.md`);
    if (!file || !("basename" in file)) throw new Error("fixture missing");
    const seen = await adapter.withFrontmatterSnapshot(async () => {
      const before = adapter.getFrontmatter(file)?.exo__Asset_label;
      await adapter.delete(file);
      return [before, adapter.getFrontmatter(file)];
    });
    expect(seen).toEqual(["Target", null]);
  });

  async function renameInsideSnapshot(): Promise<{ oldPath: unknown; newPath: unknown }> {
    const adapter = new FileSystemVaultAdapter(root);
    const file = adapter.getAbstractFileByPath(`notes/${TARGET_UID}.md`);
    if (!file || !("basename" in file)) throw new Error("fixture missing");
    const rel = "moved/target.md";
    const moved = { path: rel, basename: "target", name: "target.md", parent: null } as Parameters<
      typeof adapter.getFrontmatter
    >[0];
    return adapter.withFrontmatterSnapshot(async () => {
      // Both paths remembered first: the old one with content, the new one as absent.
      expect(adapter.getFrontmatter(file)?.exo__Asset_label).toBe("Target");
      expect(adapter.getFrontmatter(moved)).toBeNull();
      await adapter.rename(file, rel);
      return {
        oldPath: adapter.getFrontmatter(file),
        newPath: adapter.getFrontmatter(moved)?.exo__Asset_label,
      };
    });
  }

  it("R11a after a rename inside the snapshot the old path reads as absent", async () => {
    expect((await renameInsideSnapshot()).oldPath).toBeNull();
  });

  it("R11b after a rename inside the snapshot the new path reads the moved file", async () => {
    expect((await renameInsideSnapshot()).newPath).toBe("Target");
  });

  it("R12 `updateLinks` (vault-wide rewrite) is seen inside the snapshot", async () => {
    const adapter = new FileSystemVaultAdapter(root);
    const referrer = adapter.getAbstractFileByPath(`notes/${referrerUid(0)}.md`);
    if (!referrer || !("basename" in referrer)) throw new Error("fixture missing");
    const seen = await adapter.withFrontmatterSnapshot(async () => {
      const before = adapter.getFrontmatter(referrer)?.exo__Asset_relates;
      await adapter.updateLinks(
        `notes/${TARGET_UID}.md`,
        "notes/renamed-target.md",
        TARGET_UID,
      );
      return [before, adapter.getFrontmatter(referrer)?.exo__Asset_relates];
    });
    expect(seen).toEqual([`[[${TARGET_UID}]]`, "[[renamed-target]]"]);
  });

  it("R8 outside a snapshot every read is fresh (default behaviour unchanged)", () => {
    const adapter = new FileSystemVaultAdapter(root);
    const file = adapter.getAbstractFileByPath(`notes/${TARGET_UID}.md`);
    if (!file || !("basename" in file)) throw new Error("fixture missing");
    expect(adapter.getFrontmatter(file)?.exo__Asset_label).toBe("Target");
    fs.writeFileSync(
      files.target,
      fs
        .readFileSync(files.target, "utf-8")
        .replace("exo__Asset_label: Target", "exo__Asset_label: Fresh"),
    );
    expect(adapter.getFrontmatter(file)?.exo__Asset_label).toBe("Fresh");
  });
});
