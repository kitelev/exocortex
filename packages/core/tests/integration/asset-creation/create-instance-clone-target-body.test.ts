/**
 * Integration test: create_instance `cloneTargetBody` (req 915b20b2 —
 * ems__WaitingCheckTask «Следующая итерация»).
 *
 * When a `create_instance` grounding sets `cloneTargetBody: true`, the new
 * instance's markdown BODY is cloned from the click-target ($target) body
 * (frontmatter is NOT copied — only the body). This carries the waiting-check's
 * context notes forward across iterations without a template asset. Precedence:
 * explicit non-empty `userInput.body` > cloned target body > empty.
 *
 * Exercises the real `create_instance` pipeline through GroundingExecutor with
 * an in-memory file system (no mock of the executor logic). Mirrors the harness
 * of `create-instance-body.test.ts`.
 *
 * Revert-verify ([[integration-test-revert-verify]]): with the `cloneTargetBody`
 * handling neutralised, AC#1 ("new body == target body") goes RED; restored →
 * GREEN. The "empty target body → empty new body" scenario stays GREEN both
 * ways (intended no-op guard against spurious body writes).
 *
 * @req:915b20b2-e0d7-4198-80c0-5561293149f0
 */

import "reflect-metadata";
import {
  GroundingExecutor,
  ServiceRegistry,
} from "../../../src/services/GroundingExecutor";
import { GroundingType } from "../../../src/domain/constants/GroundingType";
import { GroundingDefinition } from "../../../src/domain/models/CommandDefinition";
import {
  IFileSystemReader,
  IFileSystemWriter,
} from "../../../src/interfaces/IFileSystemAdapter";

// ---------------------------------------------------------------------------
// In-memory file system (shared between GroundingExecutor reads + writes)
// ---------------------------------------------------------------------------

class InMemoryFileSystem implements IFileSystemReader, IFileSystemWriter {
  private files = new Map<string, string>();

  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`File not found: ${path}`);
    return content;
  }
  async fileExists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
  async getMarkdownFiles(): Promise<string[]> {
    return Array.from(this.files.keys()).filter((p) => p.endsWith(".md"));
  }
  async createFile(path: string, content: string): Promise<string> {
    this.files.set(path, content);
    return path;
  }
  async updateFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
  async deleteFile(path: string): Promise<void> {
    this.files.delete(path);
  }
  async renameFile(oldPath: string, newPath: string): Promise<void> {
    const content = this.files.get(oldPath);
    if (content !== undefined) {
      this.files.set(newPath, content);
      this.files.delete(oldPath);
    }
  }
  getContent(path: string): string | undefined {
    return this.files.get(path);
  }
  getAllPaths(): string[] {
    return Array.from(this.files.keys());
  }
}

function splitFrontmatterAndBody(content: string): { fm: string; body: string } {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---/);
  if (!match) return { fm: "", body: content };
  const fm = match[0];
  const body = content.slice(fm.length).replace(/^\r?\n/, "");
  return { fm, body };
}

// The click-target: an existing ems__WaitingCheckTask with a real body + the
// clonable fields. Mirrors the shape the «Следующая итерация» button operates on.
const TARGET_PATH = "/vault/current-check.md";
const TARGET_BODY = [
  "We are waiting for the consultant's reply on the residence permit.",
  "",
  "- asked on 2026-06-30",
  "- context: [[89a48f55-adc9-4c1a-8a37-e94a4c9d1d66|Сделать ВНЖ]]",
].join("\n");
const TARGET_CONTENT = [
  "---",
  'exo__Asset_uid: "current-check-uid"',
  'exo__Asset_label: "Проверить ответ консультанта по ВНЖ"',
  "exo__Instance_class:",
  '  - "[[915bc0de-0000-4000-a000-00000000c0de]]"',
  'ems__Effort_parent: "[[89a48f55-adc9-4c1a-8a37-e94a4c9d1d66]]"',
  'ems__Effort_status: "[[753a44d5-846c-4b82-9196-4fd9a4d48777]]"',
  "---",
  TARGET_BODY,
].join("\n");

const NEXT_ITERATION: GroundingDefinition = {
  id: "gnd-next-iteration-clone",
  label: "Следующая итерация",
  type: GroundingType.CREATE_INSTANCE,
  targetClass: "ems__WaitingCheckTask",
  targetFolder: "01 Inbox",
  labelTemplate: "$target.exo__Asset_label",
  cloneTargetBody: true,
  inheritanceRule: [
    {
      sourcePropertyName: "ems__Effort_parent",
      targetPropertyName: "ems__Effort_parent",
      targetClassExclusion: [],
      priority: 50,
    },
  ],
};

describe("Integration: create_instance cloneTargetBody (req 915b20b2)", () => {
  let fs: InMemoryFileSystem;
  let executor: GroundingExecutor;

  beforeEach(async () => {
    fs = new InMemoryFileSystem();
    await fs.createFile(TARGET_PATH, TARGET_CONTENT);
    executor = new GroundingExecutor(fs, fs, new ServiceRegistry());
  });

  function createdContent(): string {
    const path = fs.getAllPaths().find((p) => p !== TARGET_PATH);
    if (!path) throw new Error("No created file");
    return fs.getContent(path)!;
  }

  // AC#1 — the new iteration's body is the CLONED target body (verbatim).
  it("clones the target's markdown body into the new instance (no userInput.body)", async () => {
    const result = await executor.execute(
      NEXT_ITERATION,
      "https://exocortex.my/assets/current-check",
      TARGET_PATH,
      undefined, // one-click flow — no modal input
    );
    expect(result.success).toBe(true);

    const content = createdContent();
    const { fm, body } = splitFrontmatterAndBody(content);

    // Body cloned verbatim (wikilinks + list intact).
    expect(body).toBe(TARGET_BODY);
    // Label cloned via labelTemplate; parent cloned via InheritanceRule.
    expect(fm).toContain("Проверить ответ консультанта по ВНЖ");
    expect(fm).toContain("ems__Effort_parent");
    expect(fm).toContain("89a48f55-adc9-4c1a-8a37-e94a4c9d1d66");
    // The body is NOT leaked into frontmatter (frontmatter is not copied blob).
    expect(fm).not.toContain("We are waiting for the consultant");
    expect(content).not.toContain("\nbody:");
  });

  // AC#2 — no-op guard: an EMPTY target body → empty new body (GREEN both ways).
  it("writes an empty body when the target body is empty (no spurious content)", async () => {
    const EMPTY_BODY_TARGET = "/vault/empty-check.md";
    await fs.createFile(
      EMPTY_BODY_TARGET,
      ["---", 'exo__Asset_uid: "empty-check-uid"', 'exo__Asset_label: "Empty check"', 'exo__Instance_class:', '  - "[[915bc0de-0000-4000-a000-00000000c0de]]"', "---", ""].join("\n"),
    );
    const result = await executor.execute(
      NEXT_ITERATION,
      "https://exocortex.my/assets/empty-check",
      EMPTY_BODY_TARGET,
      undefined,
    );
    expect(result.success).toBe(true);
    const path = fs
      .getAllPaths()
      .find((p) => p !== TARGET_PATH && p !== EMPTY_BODY_TARGET);
    const { body } = splitFrontmatterAndBody(fs.getContent(path!)!);
    expect(body).toBe("");
  });

  // AC#3 — precedence: an explicit non-empty userInput.body wins over the clone.
  it("prefers an explicit non-empty userInput.body over the cloned target body", async () => {
    await executor.execute(
      NEXT_ITERATION,
      "https://exocortex.my/assets/current-check",
      TARGET_PATH,
      { body: "explicit override body" },
    );
    const { body } = splitFrontmatterAndBody(createdContent());
    expect(body).toBe("explicit override body");
    expect(body).not.toContain("We are waiting");
  });
});
