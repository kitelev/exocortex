import { jest, describe, it, expect } from "@jest/globals";
import { extractAssetReference } from "exocortex";
import type { NodeFsAdapter } from "../../../src/adapters/NodeFsAdapter.js";
import {
  findReferencedFile,
  normalizePath,
} from "../../../src/executors/folderRepairHelpers.js";

/**
 * Dedup regression guard for audit #3384 finding H4: folder-repair reference
 * resolution was triplicated (`extractAssetReference` byte-for-byte in core +
 * both CLI executors) and the two CLI copies of `findReferencedFile` /
 * `normalizePath` had begun to drift.
 *
 * After the dedup, both CLI executors consume the canonical
 * `extractAssetReference` (exported from `exocortex`) and the shared
 * `folderRepairHelpers` module. This suite imports those single sources
 * directly:
 *   - `import { extractAssetReference } from "exocortex"` fails to resolve
 *     pre-fix (no such export — it was a private method on three classes).
 *   - `import { findReferencedFile, normalizePath } from
 *     "../../../src/executors/folderRepairHelpers.js"` fails to resolve
 *     pre-fix (the module did not exist).
 * Either broken import fails the whole suite, so it FAILS pre-fix and PASSES
 * post-fix (revert-verify per ~/dotfiles/.claude/rules/integration-test-revert-verify.md).
 */

type FakeFs = Pick<
  NodeFsAdapter,
  "fileExists" | "findFileByUID" | "getMarkdownFiles"
>;

function makeFs(overrides: Partial<FakeFs> = {}): NodeFsAdapter {
  const base: FakeFs = {
    fileExists: jest.fn(async () => false),
    findFileByUID: jest.fn(async () => null),
    getMarkdownFiles: jest.fn(async () => []),
  };
  return { ...base, ...overrides } as unknown as NodeFsAdapter;
}

describe("folderRepairHelpers — extractAssetReference (canonical, shared)", () => {
  it("strips wiki-link brackets: [[Reference]] -> Reference", () => {
    expect(extractAssetReference("[[projects/my-project]]")).toBe(
      "projects/my-project",
    );
  });

  it('strips surrounding YAML quotes: "[[Reference]]" -> Reference', () => {
    expect(extractAssetReference('"[[projects/my-project]]"')).toBe(
      "projects/my-project",
    );
  });

  it("strips alias suffix to the TARGET: [[uid|alias]] -> uid", () => {
    expect(
      extractAssetReference(
        "[[e4bc670e-2618-41fc-87f8-9e3422f91514|$tbank-areas]]",
      ),
    ).toBe("e4bc670e-2618-41fc-87f8-9e3422f91514");
  });

  it("handles surrounding whitespace", () => {
    expect(extractAssetReference("  [[TestAsset]]  ")).toBe("TestAsset");
  });

  it("returns a plain reference unchanged", () => {
    expect(extractAssetReference("projects/my-project")).toBe(
      "projects/my-project",
    );
  });

  it("returns null for non-string input", () => {
    expect(extractAssetReference({ invalid: "object" })).toBeNull();
    expect(extractAssetReference(undefined)).toBeNull();
  });

  it("returns null for an empty result", () => {
    expect(extractAssetReference("")).toBeNull();
    expect(extractAssetReference("[[]]")).toBeNull();
  });
});

describe("folderRepairHelpers — normalizePath (shared)", () => {
  it("converts backslashes to forward slashes", () => {
    expect(normalizePath("a\\b\\c")).toBe("a/b/c");
  });

  it("strips a leading ./ and a trailing /", () => {
    expect(normalizePath("./folder/")).toBe("folder");
  });

  it("leaves a clean path and the root ('') unchanged", () => {
    expect(normalizePath("projects")).toBe("projects");
    expect(normalizePath("")).toBe("");
  });
});

describe("folderRepairHelpers — findReferencedFile (shared)", () => {
  it("Try 1: resolves a direct path reference containing '/'", async () => {
    const fs = makeFs({
      fileExists: jest.fn(async (p: string) => p === "projects/my-project.md"),
    });
    expect(
      await findReferencedFile(fs, "projects/my-project", "tasks/task.md"),
    ).toBe("projects/my-project.md");
  });

  it("Try 2: resolves in the same folder as the source file", async () => {
    const fs = makeFs({
      fileExists: jest.fn(async (p: string) => p === "tasks/def.md"),
    });
    expect(await findReferencedFile(fs, "def", "tasks/task.md")).toBe(
      "tasks/def.md",
    );
  });

  it("Try 2: root-level source resolves without a './' prefix", async () => {
    const seen: string[] = [];
    const fs = makeFs({
      fileExists: jest.fn(async (p: string) => {
        seen.push(p);
        return p === "def.md";
      }),
    });
    expect(await findReferencedFile(fs, "def", "task.md")).toBe("def.md");
    // Behavior-preserving unification: no "./def.md" form is probed.
    expect(seen).toContain("def.md");
    expect(seen).not.toContain("./def.md");
  });

  it("Try 3: resolves by UID lookup", async () => {
    const fs = makeFs({
      findFileByUID: jest.fn(async () => "projects/abc123-def456.md"),
    });
    expect(await findReferencedFile(fs, "abc123-def456", "tasks/task.md")).toBe(
      "projects/abc123-def456.md",
    );
  });

  it("Try 4: resolves by basename scan across the vault", async () => {
    const fs = makeFs({
      getMarkdownFiles: jest.fn(async () => [
        "projects/my-project.md",
        "other/some-file.md",
      ]),
    });
    expect(await findReferencedFile(fs, "my-project", "tasks/task.md")).toBe(
      "projects/my-project.md",
    );
  });

  it("returns null when nothing matches", async () => {
    expect(
      await findReferencedFile(makeFs(), "ghost", "tasks/task.md"),
    ).toBeNull();
  });
});
