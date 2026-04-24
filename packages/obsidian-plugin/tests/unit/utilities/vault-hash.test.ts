import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  diffSnapshots,
  snapshotVault,
} from "../../e2e/utils/vault-hash";

describe("vault-hash utility (Phase 2.2 data-flake detector)", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vault-hash-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function writeFile(relPath: string, content: string): void {
    const abs = path.join(tmpRoot, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf-8");
  }

  it("returns empty files list for empty vault", () => {
    const snap = snapshotVault(tmpRoot);
    expect(snap.files).toEqual([]);
    expect(snap.vaultPath).toBe(tmpRoot);
  });

  it("produces stable hashes sorted by relPath", () => {
    writeFile("z.md", "z-content");
    writeFile("a.md", "a-content");
    writeFile("dir/b.md", "b-content");

    const snap = snapshotVault(tmpRoot);
    expect(snap.files.map((f) => f.relPath)).toEqual([
      "a.md",
      "dir/b.md",
      "z.md",
    ]);
    for (const file of snap.files) {
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(file.size).toBeGreaterThan(0);
    }
  });

  it("ignores .obsidian directory by default", () => {
    writeFile(".obsidian/workspace.json", '{"foo":"bar"}');
    writeFile("Tasks/task-1.md", "task body");

    const snap = snapshotVault(tmpRoot);
    expect(snap.files).toHaveLength(1);
    expect(snap.files[0].relPath).toBe("Tasks/task-1.md");
  });

  it("diffSnapshots detects added files", () => {
    writeFile("a.md", "a");
    const before = snapshotVault(tmpRoot);
    writeFile("b.md", "b");
    const after = snapshotVault(tmpRoot);
    const drift = diffSnapshots(before, after);
    expect(drift.added).toEqual(["b.md"]);
    expect(drift.removed).toEqual([]);
    expect(drift.modified).toEqual([]);
    expect(drift.totalChanged).toBe(1);
  });

  it("diffSnapshots detects removed files", () => {
    writeFile("a.md", "a");
    writeFile("b.md", "b");
    const before = snapshotVault(tmpRoot);
    fs.unlinkSync(path.join(tmpRoot, "b.md"));
    const after = snapshotVault(tmpRoot);
    const drift = diffSnapshots(before, after);
    expect(drift.added).toEqual([]);
    expect(drift.removed).toEqual(["b.md"]);
    expect(drift.modified).toEqual([]);
    expect(drift.totalChanged).toBe(1);
  });

  it("diffSnapshots detects modified files by content hash", () => {
    writeFile("a.md", "before");
    const before = snapshotVault(tmpRoot);
    writeFile("a.md", "after");
    const after = snapshotVault(tmpRoot);
    const drift = diffSnapshots(before, after);
    expect(drift.added).toEqual([]);
    expect(drift.removed).toEqual([]);
    expect(drift.modified).toEqual(["a.md"]);
    expect(drift.totalChanged).toBe(1);
  });

  it("diffSnapshots reports no drift when vault is untouched", () => {
    writeFile("Tasks/timestamp-sync-task.md", "# task");
    writeFile("Projects/p.md", "# project");
    const before = snapshotVault(tmpRoot);
    const after = snapshotVault(tmpRoot);
    const drift = diffSnapshots(before, after);
    expect(drift.totalChanged).toBe(0);
    expect(drift.added).toEqual([]);
    expect(drift.removed).toEqual([]);
    expect(drift.modified).toEqual([]);
  });

  it("diffSnapshots handles multi-category drift (Category F canonical case)", () => {
    writeFile("Tasks/t1.md", "original");
    writeFile("Tasks/t2.md", "stable");
    const before = snapshotVault(tmpRoot);
    writeFile("Tasks/t1.md", "mutated by processFrontMatter");
    fs.unlinkSync(path.join(tmpRoot, "Tasks/t2.md"));
    writeFile("Tasks/t3.md", "created by test");
    const after = snapshotVault(tmpRoot);
    const drift = diffSnapshots(before, after);
    expect(drift.modified).toEqual(["Tasks/t1.md"]);
    expect(drift.removed).toEqual(["Tasks/t2.md"]);
    expect(drift.added).toEqual(["Tasks/t3.md"]);
    expect(drift.totalChanged).toBe(3);
  });
});
