/**
 * Integration test (req f9da9867): the ems__Task «Un-archive» command removes
 * the top-level `archived` flag from an archived task, and is offered ONLY when
 * the task carries `exo__Asset_archived "true"`.
 *
 * Production-shape: the command + grounding (property_delete) + precondition
 * (archived-only ASK) + binding + an archived / an active ems__Task are authored
 * as MARKDOWN and run through the REAL
 * `NoteToRDFConverter.convertVault()` → `CommandResolver.loadCommand()` →
 * `GroundingExecutor.execute()` / `PreconditionEvaluator.evaluate()` pipeline —
 * the exact path the CLI `apply` command and the Obsidian inline button both
 * take (test-fixture-realism: no hand-injected triples).
 *
 * @req:f9da9867-6b4e-441b-b2d6-6c393cceb055
 *
 * Behaviour asserted (spec §2.2, req Gherkin):
 *  - executing the «Un-archive» grounding on an archived task removes its
 *    top-level `archived` frontmatter flag (property_delete of `archived`);
 *  - the command's precondition is TRUE for a task carrying
 *    `exo__Asset_archived "true"` and FALSE for one that does not.
 *
 * Design note: the archive flag is set in place by the `archiveAsset` service
 * (`ArchiveAssetService` — sets `archived: "true"`, no file move), so Un-archive
 * is the pure inverse (delete the one flag) — homoiconic, zero engine code.
 *
 * REVERT-VERIFY (integration-test-revert-verify rule):
 *  - BEHAVIOUR: change the grounding's `targetProperty` from `archived` to a
 *    non-existent key → the "archived flag removed" assertion goes RED (the
 *    real flag survives). Restore → GREEN.
 *  - PRECONDITION: change the precondition ASK to match a different flag →
 *    "visible on archived" goes RED. Restore → GREEN.
 * Empirically verified (see PR body). Also end-to-end verified via the real CLI
 * `apply un-archive` on an isolated temp vault + `resolve-buttons` visibility
 * (archived ✓, non-archived hidden).
 */

import "reflect-metadata";
import {
  GroundingExecutor,
  ServiceRegistry,
} from "../../../src/services/GroundingExecutor";
import { NoteToRDFConverter } from "../../../src/services/NoteToRDFConverter";
import { CommandResolver } from "../../../src/services/CommandResolver";
import { PreconditionEvaluator } from "../../../src/services/PreconditionEvaluator";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { installDefaultResolvers } from "../../../src/services/SubstitutionResolverRegistry";
import {
  IFileSystemReader,
  IFileSystemWriter,
} from "../../../src/interfaces/IFileSystemAdapter";
import {
  IVaultAdapter,
  IFile,
  IFolder,
  IFrontmatter,
} from "../../../src/interfaces/IVaultAdapter";

// ---------------------------------------------------------------------------
// In-memory fs + vault adapter (mirrors partially-done-grounding.integration)
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

function parseFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const frontmatter: Record<string, unknown> = {};
  const lines = match[1].split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const colonIndex = line.indexOf(":");
    if (colonIndex <= 0) continue;
    const key = line.substring(0, colonIndex).trim();
    const rawValue = line.substring(colonIndex + 1).trim();
    if (rawValue === "") {
      const arrayValues: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j];
        if (nextLine.startsWith("  - ")) {
          arrayValues.push(nextLine.substring(4).trim());
        } else {
          break;
        }
      }
      frontmatter[key] = arrayValues.length > 0 ? arrayValues : "";
    } else {
      frontmatter[key] = rawValue;
    }
  }
  return frontmatter;
}

class InMemoryVaultAdapter implements IVaultAdapter {
  constructor(private readonly fs: InMemoryFileSystem) {}
  async read(file: IFile): Promise<string> {
    return this.fs.readFile(file.path);
  }
  async exists(path: string): Promise<boolean> {
    return this.fs.fileExists(path);
  }
  getAllFiles(): IFile[] {
    return this.fs
      .getAllPaths()
      .filter((p) => p.endsWith(".md"))
      .map((p) => this.makeFile(p));
  }
  getAbstractFileByPath(path: string): IFile | IFolder | null {
    return this.fs.getContent(path) !== undefined ? this.makeFile(path) : null;
  }
  async create(path: string, content: string): Promise<IFile> {
    await this.fs.createFile(path, content);
    return this.makeFile(path);
  }
  async modify(file: IFile, newContent: string): Promise<void> {
    await this.fs.updateFile(file.path, newContent);
  }
  async delete(file: IFile): Promise<void> {
    await this.fs.deleteFile(file.path);
  }
  async process(file: IFile, fn: (content: string) => string): Promise<string> {
    const content = await this.fs.readFile(file.path);
    const updated = fn(content);
    await this.fs.updateFile(file.path, updated);
    return updated;
  }
  async rename(file: IFile, newPath: string): Promise<void> {
    await this.fs.renameFile(file.path, newPath);
  }
  async updateLinks(): Promise<void> {}
  async createFolder(): Promise<void> {}
  getDefaultNewFileParent(): IFolder | null {
    return null;
  }
  getFrontmatter(file: IFile): IFrontmatter | null {
    const content = this.fs.getContent(file.path);
    if (!content) return null;
    return parseFrontmatter(content);
  }
  async updateFrontmatter(): Promise<void> {}
  getFirstLinkpathDest(linkpath: string, _sourcePath: string): IFile | null {
    const bare = linkpath.includes("|") ? linkpath.split("|")[0] : linkpath;
    const withMd = bare.endsWith(".md") ? bare : `${bare}.md`;
    for (const path of this.fs.getAllPaths()) {
      const basename = path.split("/").pop()?.replace(".md", "") ?? "";
      if (basename === bare || path === withMd || path.endsWith(`/${withMd}`)) {
        return this.makeFile(path);
      }
    }
    return null;
  }
  private makeFile(path: string): IFile {
    const name = path.split("/").pop() || path;
    const basename = name.replace(".md", "");
    const parentPath = path.split("/").slice(0, -1).join("/");
    return {
      path,
      name,
      basename,
      parent: parentPath
        ? { path: parentPath, name: parentPath.split("/").pop() || "" }
        : null,
    };
  }
}

// ---------------------------------------------------------------------------
// Fixture UIDs — the REAL production asset UIDs (exoas-public/ems-commands + ems).
// ---------------------------------------------------------------------------

const GT_PROPERTY_DELETE = "4bdf1d0b-e9da-4d96-bafe-c5aaef8c2bd5";
const CLS_TASK = "1b20a8f0-d745-4e93-91db-4531b3df120e";
const ENUM_DONE = "7b9b3116-7c3c-438c-9618-94fe301320a6";

// Un-archive command chain (my authored assets in exoas-public/ems-commands).
const CMD = "59aaf685-d404-4702-9857-075bf27ed088";
const BINDING = "aab754fb-a1df-4f3e-9298-8451c20aae47";
const PRECOND = "008c6d16-e7aa-44f9-bff3-7406c4aafa45";
const GROUNDING = "ec4b6e20-9d82-4053-85e0-b8bdea94fd79";

// Fixture-owned instances.
const ARCHIVED_TASK = "c1c1c1c1-1111-4111-8111-111111111111";
const ACTIVE_TASK = "c2c2c2c2-2222-4222-8222-222222222222";

const DIR = "assetspaces/my";

function fm(...lines: string[]): string {
  return ["---", ...lines, "---", ""].join("\n");
}

async function seedVault(fs: InMemoryFileSystem): Promise<void> {
  const files: Array<[string, string]> = [
    // ---- Class def (label resolution) ----
    [
      `${DIR}/${CLS_TASK}.md`,
      fm(
        `exo__Asset_uid: ${CLS_TASK}`,
        "exo__Asset_label: ems__Task",
        'exo__Instance_class:\n  - "[[exo__Class]]"',
      ),
    ],
    [
      `${DIR}/${ENUM_DONE}.md`,
      fm(`exo__Asset_uid: ${ENUM_DONE}`, "exo__Asset_label: ems__EffortStatusDone"),
    ],
    // ---- property_delete grounding (removes the `archived` key) ----
    [
      `${DIR}/${GROUNDING}.md`,
      fm(
        `exo__Asset_uid: ${GROUNDING}`,
        'exo__Asset_label: "Un-archive: remove the archived flag"',
        "exo__Instance_class:",
        '  - "[[exocmd__Grounding]]"',
        `exocmd__Grounding_type: "[[${GT_PROPERTY_DELETE}]]"`,
        "exocmd__Grounding_targetProperty: archived",
      ),
    ],
    // ---- precondition: archived-only (single-line ASK; naive parser captures it) ----
    [
      `${DIR}/${PRECOND}.md`,
      fm(
        `exo__Asset_uid: ${PRECOND}`,
        'exo__Asset_label: "Visible only when the task is archived"',
        "exo__Instance_class:",
        '  - "[[exocmd__AtomicPrecondition]]"',
        'exocmd__Precondition_sparqlAsk: PREFIX exo: <https://exocortex.my/ontology/exo#> ASK { $target exo:Asset_archived "true" }',
      ),
    ],
    // ---- command + binding ----
    [
      `${DIR}/${CMD}.md`,
      fm(
        `exo__Asset_uid: ${CMD}`,
        'exo__Asset_label: "Un-archive"',
        "exo__Instance_class:",
        '  - "[[exocmd__Command]]"',
        `exocmd__Command_grounding: "[[${GROUNDING}]]"`,
        `exocmd__Command_precondition: "[[${PRECOND}]]"`,
        "exocmd__Command_cliName: un-archive",
        "exocmd__Command_category: status",
      ),
    ],
    [
      `${DIR}/${BINDING}.md`,
      fm(
        `exo__Asset_uid: ${BINDING}`,
        'exo__Asset_label: "Un-archive binding"',
        "exo__Instance_class:",
        '  - "[[exocmd__CommandBinding]]"',
        `exocmd__CommandBinding_command: "[[${CMD}]]"`,
        'exocmd__CommandBinding_targetClass: "ems__Task"',
        'exocmd__CommandBinding_position: "inline"',
      ),
    ],
    // ---- ARCHIVED ems__Task (archived flag set in place, mirrors ArchiveAssetService) ----
    [
      `${DIR}/${ARCHIVED_TASK}.md`,
      [
        "---",
        `exo__Asset_uid: ${ARCHIVED_TASK}`,
        'exo__Asset_isDefinedBy: "[[!kitelev]]"',
        "exo__Instance_class:",
        `  - "[[${CLS_TASK}]]"`,
        'exo__Asset_label: "Archived report"',
        `ems__Effort_status: "[[${ENUM_DONE}|ems__EffortStatusDone]]"`,
        "archived: true",
        "---",
        "",
        "Body notes.",
      ].join("\n"),
    ],
    // ---- ACTIVE ems__Task (no archived flag) ----
    [
      `${DIR}/${ACTIVE_TASK}.md`,
      [
        "---",
        `exo__Asset_uid: ${ACTIVE_TASK}`,
        'exo__Asset_isDefinedBy: "[[!kitelev]]"',
        "exo__Instance_class:",
        `  - "[[${CLS_TASK}]]"`,
        'exo__Asset_label: "Active report"',
        `ems__Effort_status: "[[${ENUM_DONE}|ems__EffortStatusDone]]"`,
        "---",
        "",
        "Body notes.",
      ].join("\n"),
    ],
  ];
  for (const [path, content] of files) {
    await fs.createFile(path, content);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const ARCHIVED_PATH = `${DIR}/${ARCHIVED_TASK}.md`;
const ARCHIVED_IRI = `obsidian://vault/${ARCHIVED_PATH}`;
const ACTIVE_IRI = `obsidian://vault/${DIR}/${ACTIVE_TASK}.md`;

describe("Integration (req f9da9867): ems__Task «Un-archive»", () => {
  let fs: InMemoryFileSystem;
  let store: InMemoryTripleStore;
  let resolver: CommandResolver;

  beforeEach(async () => {
    installDefaultResolvers();
    fs = new InMemoryFileSystem();
    await seedVault(fs);
    const converter = new NoteToRDFConverter(new InMemoryVaultAdapter(fs));
    store = new InMemoryTripleStore();
    await store.addAll(await converter.convertVault());
    resolver = new CommandResolver(store);
  });

  it("@req:f9da9867-6b4e-441b-b2d6-6c393cceb055 removes the top-level `archived` flag from an archived task", async () => {
    const command = await resolver.loadCommand(CMD);
    expect(command).not.toBeNull();
    // The grounding is a property_delete of the `archived` key.
    expect(command!.grounding.type).toBe("property_delete");
    expect(command!.grounding.targetProperty).toBe("archived");

    // Precondition holds for the archived target (guard: not vacuous).
    const before = fs.getContent(ARCHIVED_PATH)!;
    expect(before).toContain("archived: true");

    const executor = new GroundingExecutor(fs, fs, new ServiceRegistry());
    const result = await executor.execute(
      command!.grounding,
      ARCHIVED_IRI,
      ARCHIVED_PATH,
    );
    expect(result.success).toBe(true);

    // The `archived` flag is gone → task is back in active views.
    const after = fs.getContent(ARCHIVED_PATH)!;
    expect(after).not.toMatch(/^archived:/m);
    // The rest of the task is untouched (label + status preserved).
    expect(after).toContain('exo__Asset_label: "Archived report"');
    expect(after).toContain(`ems__Effort_status: "[[${ENUM_DONE}`);
  });

  it("@req:f9da9867-6b4e-441b-b2d6-6c393cceb055 is offered ONLY when the task is archived (precondition)", async () => {
    const command = await resolver.loadCommand(CMD);
    expect(command).not.toBeNull();
    expect(command!.precondition).toBeDefined();

    const evaluator = new PreconditionEvaluator(store);

    // Visible on the archived task…
    const onArchived = await evaluator.evaluate(
      command!.precondition,
      ARCHIVED_IRI,
    );
    expect(onArchived).toBe(true);

    // …hidden on the non-archived task.
    const onActive = await evaluator.evaluate(
      command!.precondition,
      ACTIVE_IRI,
    );
    expect(onActive).toBe(false);
  });

  it("@req:f9da9867-6b4e-441b-b2d6-6c393cceb055 binds «Un-archive» to ems__Task", async () => {
    const resolved = await resolver.resolveForAssetMulti(
      ARCHIVED_IRI,
      ["ems__Task"],
      undefined,
    );
    const names = resolved.map((r) => r.command.name);
    expect(names).toContain("Un-archive");
  });
});
