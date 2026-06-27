/**
 * Integration test: create_instance grounding → reserved `body` userInput key.
 *
 * Issue #3744 — `body` is a reserved engine input (symmetric to `label`):
 *   - when present & non-empty → written as the new asset's markdown body
 *     (after the frontmatter), in the SAME `apply` (no composite grounding,
 *     no literal `$userInput` token).
 *   - absent / empty → frontmatter-only content (current behavior preserved).
 *   - `body` never appears as a frontmatter key.
 *
 * Exercises the real `create_instance` pipeline through GroundingExecutor with
 * an in-memory file system (no mock of the executor logic). Mirrors the harness
 * shape of `create-instance-grounding.test.ts`.
 *
 * Revert-verify: with the body-handling lines reverted, AC#1 (body written +
 * not a frontmatter key) FAILS; restored → PASSES. Empirically verified.
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Split a markdown file into [frontmatterBlock, body]. body is "" when none. */
function splitFrontmatterAndBody(content: string): { fm: string; body: string } {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---/);
  if (!match) return { fm: "", body: content };
  const fm = match[0];
  const body = content.slice(fm.length).replace(/^\r?\n/, "");
  return { fm, body };
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe("Integration: create_instance reserved `body` key (#3744)", () => {
  let fs: InMemoryFileSystem;
  let groundingExecutor: GroundingExecutor;

  // InheritanceRule grounding so AC#4 (parent backlink) is exercised: the rule
  // copies $target's uid into `ems__Effort_parent`, mirroring real groundings.
  const PARENT_FILE_PATH = "/vault/parent.md";
  const PARENT_FILE_CONTENT = [
    "---",
    'exo__Asset_uid: "parent-uid-3744"',
    'exo__Asset_label: "Parent project"',
    "exo__Instance_class:",
    '  - "[[ems__Project]]"',
    "---",
    "Parent body",
  ].join("\n");

  const GROUNDING: GroundingDefinition = {
    id: "gnd-create-task-3744",
    label: "Create Task",
    type: GroundingType.CREATE_INSTANCE,
    targetClass: "ems__Task",
    targetFolder: "01 Inbox",
    inheritanceRule: [
      {
        sourcePropertyName: "exo__Asset_uid",
        targetPropertyName: "ems__Effort_parent",
        targetClassExclusion: [],
        priority: 50,
      },
    ],
  };

  beforeEach(async () => {
    fs = new InMemoryFileSystem();
    await fs.createFile(PARENT_FILE_PATH, PARENT_FILE_CONTENT);
    const serviceRegistry = new ServiceRegistry();
    groundingExecutor = new GroundingExecutor(fs, fs, serviceRegistry);
  });

  function createdContent(): string {
    const path = fs.getAllPaths().find((p) => p !== PARENT_FILE_PATH);
    if (!path) throw new Error("No created file");
    return fs.getContent(path)!;
  }

  // AC#1 — body written as markdown body; `body` NOT a frontmatter key.
  it("writes `body` as the new asset's markdown body and not as a frontmatter key", async () => {
    const result = await groundingExecutor.execute(
      GROUNDING,
      "https://exocortex.my/assets/parent",
      PARENT_FILE_PATH,
      { label: "L", body: "some [[wikilink]] text" },
    );
    expect(result.success).toBe(true);

    const content = createdContent();
    const { fm, body } = splitFrontmatterAndBody(content);

    // Body region carries the supplied markdown verbatim (wikilink intact).
    expect(body).toBe("some [[wikilink]] text");
    // `body` did NOT leak into frontmatter as a key.
    expect(fm).not.toMatch(/^body:/m);
    expect(content).not.toContain("\nbody:");
  });

  // AC#2 — no body → frontmatter-only content (no regression, no token).
  it("writes frontmatter-only content when `body` is absent (no regression, no literal token)", async () => {
    const result = await groundingExecutor.execute(
      GROUNDING,
      "https://exocortex.my/assets/parent",
      PARENT_FILE_PATH,
      { label: "L" },
    );
    expect(result.success).toBe(true);

    const content = createdContent();
    const { body } = splitFrontmatterAndBody(content);

    expect(body).toBe("");
    // No literal $userInput token, no stray `body:` frontmatter key.
    expect(content).not.toContain("$userInput");
    expect(content).not.toContain("\nbody:");
  });

  // AC#2 (edge) — empty-string body behaves like absent (no body written).
  it("treats empty-string `body` as no body", async () => {
    await groundingExecutor.execute(
      GROUNDING,
      "https://exocortex.my/assets/parent",
      PARENT_FILE_PATH,
      { label: "L", body: "" },
    );
    const { body } = splitFrontmatterAndBody(createdContent());
    expect(body).toBe("");
  });

  // AC#3 — other extra userInput keys still flow to frontmatter.
  it("still passes extra userInput keys through to frontmatter alongside body", async () => {
    await groundingExecutor.execute(
      GROUNDING,
      "https://exocortex.my/assets/parent",
      PARENT_FILE_PATH,
      {
        label: "L",
        ems__Effort_blocker: "[[eb277e2b-uid]]",
        body: "task body [[x]]",
      },
    );
    const content = createdContent();
    const { fm, body } = splitFrontmatterAndBody(content);

    expect(fm).toContain("ems__Effort_blocker");
    expect(content).toContain("eb277e2b-uid");
    expect(body).toBe("task body [[x]]");
  });

  // AC#4 — label → exo__Asset_label; InheritanceRule (parent backlink) fires.
  it("still maps label to exo__Asset_label and fires the InheritanceRule when body is supplied", async () => {
    await groundingExecutor.execute(
      GROUNDING,
      "https://exocortex.my/assets/parent",
      PARENT_FILE_PATH,
      { label: "My Task", body: "body text" },
    );
    const { fm } = splitFrontmatterAndBody(createdContent());

    expect(fm).toMatch(/exo__Asset_label: "?My Task"?/);
    // InheritanceRule copied the parent uid into ems__Effort_parent.
    expect(fm).toContain("ems__Effort_parent");
    expect(fm).toContain("parent-uid-3744");
  });
});
