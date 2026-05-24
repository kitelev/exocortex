/**
 * Integration test: create_instance grounding → file → NoteToRDFConverter → triples.
 *
 * Verifies the full create_instance pipeline:
 *   1. GroundingExecutor.execute() creates a file in InMemoryFileSystem
 *   2. The file has correct frontmatter (uid, label, class, prototype)
 *   3. NoteToRDFConverter can parse the file and produce correct RDF triples
 *
 * Uses real (non-mocked) FrontmatterService and NoteToRDFConverter.
 * Only the file system and vault adapter are in-memory fakes.
 *
 * Issue #2644: create_instance grounding creates file with correct frontmatter
 */

import "reflect-metadata";
import {
  GroundingExecutor,
  ServiceRegistry,
} from "../../../src/services/GroundingExecutor";
import { NoteToRDFConverter } from "../../../src/services/NoteToRDFConverter";
import { GroundingType } from "../../../src/domain/constants/GroundingType";
import { GroundingDefinition } from "../../../src/domain/models/CommandDefinition";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";
import { IFileSystemReader, IFileSystemWriter } from "../../../src/interfaces/IFileSystemAdapter";
import { IVaultAdapter, IFile, IFolder, IFrontmatter } from "../../../src/interfaces/IVaultAdapter";

// ---------------------------------------------------------------------------
// In-memory file system (shared between GroundingExecutor and vault adapter)
// ---------------------------------------------------------------------------

/**
 * In-memory file system used by GroundingExecutor for write operations.
 * Implements both IFileSystemReader and IFileSystemWriter.
 */
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

  /** Direct access to stored content for assertions. */
  getContent(path: string): string | undefined {
    return this.files.get(path);
  }

  /** List all stored file paths. */
  getAllPaths(): string[] {
    return Array.from(this.files.keys());
  }
}

// ---------------------------------------------------------------------------
// Vault adapter backed by InMemoryFileSystem (for NoteToRDFConverter)
// ---------------------------------------------------------------------------

/**
 * Simple YAML frontmatter parser for integration tests.
 * Handles: scalars, quoted strings with wikilinks, arrays.
 */
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
      // Might be an array (next lines starting with "  - ")
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

/**
 * Vault adapter that reads from InMemoryFileSystem.
 * Provides the IVaultAdapter interface needed by NoteToRDFConverter.
 */
class InMemoryVaultAdapter implements IVaultAdapter {
  constructor(private readonly fs: InMemoryFileSystem) {}

  // -- IVaultFileReader --

  async read(file: IFile): Promise<string> {
    return this.fs.readFile(file.path);
  }

  async exists(path: string): Promise<boolean> {
    return this.fs.fileExists(path);
  }

  getAllFiles(): IFile[] {
    return this.fs.getAllPaths()
      .filter((p) => p.endsWith(".md"))
      .map((p) => this.makeFile(p));
  }

  getAbstractFileByPath(path: string): IFile | IFolder | null {
    const content = this.fs.getContent(path);
    if (content !== undefined) return this.makeFile(path);
    return null;
  }

  // -- IVaultFileWriter --

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

  // -- IVaultFileRenamer --

  async rename(file: IFile, newPath: string): Promise<void> {
    await this.fs.renameFile(file.path, newPath);
  }

  async updateLinks(): Promise<void> {
    // No-op for tests
  }

  // -- IVaultFolderManager --

  async createFolder(): Promise<void> {
    // No-op for tests
  }

  getDefaultNewFileParent(): IFolder | null {
    return null;
  }

  // -- IVaultFrontmatterManager --

  getFrontmatter(file: IFile): IFrontmatter | null {
    const content = this.fs.getContent(file.path);
    if (!content) return null;
    return parseFrontmatter(content);
  }

  async updateFrontmatter(): Promise<void> {
    // No-op for tests
  }

  // -- IVaultLinkResolver --

  getFirstLinkpathDest(linkpath: string, _sourcePath: string): IFile | null {
    // Try exact path match (with .md)
    const withMd = linkpath.endsWith(".md") ? linkpath : `${linkpath}.md`;
    if (this.fs.getContent(withMd) !== undefined) {
      return this.makeFile(withMd);
    }
    // Try all paths for basename match (simulates Obsidian link resolution)
    for (const path of this.fs.getAllPaths()) {
      const basename = path.split("/").pop()?.replace(".md", "") ?? "";
      if (basename === linkpath) {
        return this.makeFile(path);
      }
    }
    return null;
  }

  // -- Helper --

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
// Triple assertion helpers
// ---------------------------------------------------------------------------

function findTriples(triples: Triple[], predicate: IRI): Triple[] {
  return triples.filter((t) => t.predicate.equals(predicate));
}

function hasTripleWithObject(triples: Triple[], predicate: IRI, objectValue: string): boolean {
  return triples.some(
    (t) =>
      t.predicate.equals(predicate) &&
      ((t.object instanceof Literal && t.object.value === objectValue) ||
       (t.object instanceof IRI && t.object.value === objectValue)),
  );
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe("Integration: create_instance grounding → NoteToRDFConverter", () => {
  let fs: InMemoryFileSystem;
  let vaultAdapter: InMemoryVaultAdapter;
  let groundingExecutor: GroundingExecutor;
  let converter: NoteToRDFConverter;

  // RFC 32445c1c removed Step 4 (copy-from-target). The executor still
  // reads `$target` via `fs.readFile(targetFilePath)` whenever the grounding
  // declares at least one `inheritanceRule`; even when no rule is attached,
  // every test in this suite uses TARGET_IRI so the read still happens
  // (and would fail with "File not found" without seeding). Seed a minimal
  // parent.md so the read succeeds and the executor proceeds to write the
  // new instance.
  const PARENT_FILE_PATH = "/vault/parent.md";
  const PARENT_FILE_CONTENT = [
    "---",
    'exo__Asset_uid: "parent-uid"',
    'exo__Asset_label: "Parent prototype"',
    "exo__Instance_class:",
    '  - "[[ems__TaskPrototype]]"',
    "---",
    "Body",
  ].join("\n");

  beforeEach(async () => {
    fs = new InMemoryFileSystem();
    await fs.createFile(PARENT_FILE_PATH, PARENT_FILE_CONTENT);
    vaultAdapter = new InMemoryVaultAdapter(fs);
    const serviceRegistry = new ServiceRegistry();
    groundingExecutor = new GroundingExecutor(fs, fs, serviceRegistry);
    converter = new NoteToRDFConverter(vaultAdapter);
  });

  /**
   * Return the single newly-created `IFile` (the parent.md seed file is
   * excluded). Tests that expect exactly one created file get a friendlier
   * failure message via the length assertion than a silent `files[0]` that
   * picks parent.md when nothing was created.
   */
  function getCreatedFile(): IFile {
    const created = vaultAdapter
      .getAllFiles()
      .filter((f) => f.path !== PARENT_FILE_PATH);
    if (created.length !== 1) {
      throw new Error(
        `Expected exactly 1 created file, got ${created.length}: ${created
          .map((f) => f.path)
          .join(", ")}`,
      );
    }
    return created[0];
  }

  // -----------------------------------------------------------------------
  // Full pipeline: with prototype
  // -----------------------------------------------------------------------

  describe("full pipeline with prototype", () => {
    const GROUNDING: GroundingDefinition = {
      id: "gnd-create-task",
      label: "Create Task",
      type: GroundingType.CREATE_INSTANCE,
      targetClass: "ems__Task",
      targetPrototype: "proto-task-template-001",
      targetFolder: "01 Inbox",
    };

    it("should create file at targetFolder/<uuid>.md", async () => {
      const result = await groundingExecutor.execute(
        GROUNDING,
        "https://exocortex.my/assets/parent",
        "/vault/parent.md",
        { label: "Test Task" },
      );

      expect(result.success).toBe(true);

      const createdPaths = fs
        .getAllPaths()
        .filter((p) => p !== PARENT_FILE_PATH);
      expect(createdPaths).toHaveLength(1);
      const allPaths = createdPaths;
      expect(allPaths[0]).toMatch(/^01 Inbox\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.md$/);
    });

    it("should produce file content parseable by NoteToRDFConverter", async () => {
      await groundingExecutor.execute(
        GROUNDING,
        "https://exocortex.my/assets/parent",
        "/vault/parent.md",
        { label: "Test Task" },
      );

      const file = getCreatedFile();
      const triples = await converter.convertNote(file);
      expect(triples.length).toBeGreaterThan(0);
    });

    it("should produce rdf:type ems:Task triple", async () => {
      await groundingExecutor.execute(
        GROUNDING,
        "https://exocortex.my/assets/parent",
        "/vault/parent.md",
        { label: "Test Task" },
      );

      const file = getCreatedFile();
      const triples = await converter.convertNote(file);

      const rdfType = Namespace.RDF.term("type");
      const emsTask = Namespace.EMS.term("Task");

      const typeTriples = findTriples(triples, rdfType);
      expect(typeTriples.length).toBeGreaterThanOrEqual(1);

      const hasTaskType = typeTriples.some((t) =>
        t.object instanceof IRI && t.object.equals(emsTask),
      );
      expect(hasTaskType).toBe(true);
    });

    it("should produce exo:Asset_label triple with correct value", async () => {
      await groundingExecutor.execute(
        GROUNDING,
        "https://exocortex.my/assets/parent",
        "/vault/parent.md",
        { label: "Test Task" },
      );

      const file = getCreatedFile();
      const triples = await converter.convertNote(file);

      const labelPredicate = Namespace.EXO.term("Asset_label");
      expect(hasTripleWithObject(triples, labelPredicate, "Test Task")).toBe(true);
    });

    it("should produce exo:Asset_uid triple with valid UUID", async () => {
      await groundingExecutor.execute(
        GROUNDING,
        "https://exocortex.my/assets/parent",
        "/vault/parent.md",
        { label: "Test Task" },
      );

      const file = getCreatedFile();
      const triples = await converter.convertNote(file);

      const uidPredicate = Namespace.EXO.term("Asset_uid");
      const uidTriples = findTriples(triples, uidPredicate);
      expect(uidTriples).toHaveLength(1);

      const uidValue = (uidTriples[0].object as Literal).value;
      const UUID_REGEX = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
      expect(uidValue).toMatch(UUID_REGEX);
    });

    it("should produce exo:Instance_class triple for ems__Task", async () => {
      await groundingExecutor.execute(
        GROUNDING,
        "https://exocortex.my/assets/parent",
        "/vault/parent.md",
        { label: "Test Task" },
      );

      const file = getCreatedFile();
      const triples = await converter.convertNote(file);

      const instanceClassPredicate = Namespace.EXO.term("Instance_class");
      const classTriples = findTriples(triples, instanceClassPredicate);
      expect(classTriples.length).toBeGreaterThanOrEqual(1);

      // NoteToRDFConverter expands ems__Task to namespace IRI for Instance_class
      const emsTask = Namespace.EMS.term("Task");
      const hasEmsTask = classTriples.some(
        (t) => t.object instanceof IRI && t.object.equals(emsTask),
      );
      expect(hasEmsTask).toBe(true);
    });

    it("should produce exo:Asset_prototype triple linking to the prototype-instance ($target, Issue #3184 B1)", async () => {
      await groundingExecutor.execute(
        GROUNDING,
        "https://exocortex.my/assets/parent",
        "/vault/parent.md",
        { label: "Test Task" },
      );

      const file = getCreatedFile();
      const triples = await converter.convertNote(file);

      const prototypePredicate = Namespace.EXO.term("Asset_prototype");
      const protoTriples = findTriples(triples, prototypePredicate);
      expect(protoTriples.length).toBeGreaterThanOrEqual(1);

      // After Issue #3184 the prototype back-link points at the
      // prototype-INSTANCE (the file the user clicked on, i.e. parent.md),
      // not the class UID declared in `grounding.targetPrototype`. The
      // converter resolves wikilink targets to the linked asset's basename
      // (`parent`) — strip the path and `.md` extension before matching.
      const hasParentRef = protoTriples.some((t) => {
        if (t.object instanceof Literal) {
          return t.object.value.includes("parent");
        }
        if (t.object instanceof IRI) {
          return t.object.value.includes("parent");
        }
        return false;
      });
      expect(hasParentRef).toBe(true);
      // Class UID is NOT materialised as the prototype reference.
      const leaksClassUID = protoTriples.some((t) => {
        if (t.object instanceof Literal) {
          return t.object.value.includes("proto-task-template-001");
        }
        if (t.object instanceof IRI) {
          return t.object.value.includes("proto-task-template-001");
        }
        return false;
      });
      expect(leaksClassUID).toBe(false);
    });

    it("should produce exo:Asset_filename triple with basename", async () => {
      await groundingExecutor.execute(
        GROUNDING,
        "https://exocortex.my/assets/parent",
        "/vault/parent.md",
        { label: "Test Task" },
      );

      const file = getCreatedFile();
      const triples = await converter.convertNote(file);

      const fileNamePredicate = Namespace.EXO.term("Asset_filename");
      const fileNameTriples = findTriples(triples, fileNamePredicate);
      expect(fileNameTriples).toHaveLength(1);

      // basename should be the UUID (without .md)
      const basename = (fileNameTriples[0].object as Literal).value;
      const UUID_REGEX = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
      expect(basename).toMatch(UUID_REGEX);
    });
  });

  // -----------------------------------------------------------------------
  // Full pipeline: without prototype
  // -----------------------------------------------------------------------

  describe("full pipeline without prototype", () => {
    const GROUNDING: GroundingDefinition = {
      id: "gnd-create-task-no-proto",
      label: "Create Task (no proto)",
      type: GroundingType.CREATE_INSTANCE,
      targetClass: "ems__Task",
      targetFolder: "01 Inbox",
    };

    it("should still write exo__Asset_prototype linked to $target (Issue #3184 B2 default)", async () => {
      // Before Issue #3184 a grounding lacking `targetPrototype` produced
      // no `exo__Asset_prototype` line. After Issue #3184 the back-link
      // default is `exo__Asset_prototype`, so the field is always present
      // when targetIRI is non-empty — it just points to the parent file
      // (the asset the user clicked on) instead of a synthetic class UID.
      await groundingExecutor.execute(
        GROUNDING,
        "https://exocortex.my/assets/parent",
        "/vault/parent.md",
        { label: "No Proto Task" },
      );

      const createdPaths = fs
        .getAllPaths()
        .filter((p) => p !== PARENT_FILE_PATH);
      expect(createdPaths).toHaveLength(1);
      const allPaths = createdPaths;

      const content = fs.getContent(allPaths[0])!;
      expect(content).toContain('exo__Asset_prototype: "[[vault/parent]]"');
      // Issue #3184 B2: legacy `exo__Asset_source` default no longer
      // applied for create_instance.
      expect(content).not.toContain("exo__Asset_source:");
    });

    it("should produce exo:Asset_prototype triple linking to $target", async () => {
      await groundingExecutor.execute(
        GROUNDING,
        "https://exocortex.my/assets/parent",
        "/vault/parent.md",
        { label: "No Proto Task" },
      );

      const file = getCreatedFile();
      const triples = await converter.convertNote(file);

      const prototypePredicate = Namespace.EXO.term("Asset_prototype");
      const protoTriples = findTriples(triples, prototypePredicate);
      expect(protoTriples.length).toBeGreaterThanOrEqual(1);
      // Same expectation as the "with prototype" case — the prototype
      // back-link always references the parent file's basename.
      const hasParentRef = protoTriples.some((t) => {
        if (t.object instanceof Literal) {
          return t.object.value.includes("parent");
        }
        if (t.object instanceof IRI) {
          return t.object.value.includes("parent");
        }
        return false;
      });
      expect(hasParentRef).toBe(true);
    });

    it("should still produce rdf:type, label, uid, and Instance_class triples", async () => {
      await groundingExecutor.execute(
        GROUNDING,
        "https://exocortex.my/assets/parent",
        "/vault/parent.md",
        { label: "No Proto Task" },
      );

      const file = getCreatedFile();
      const triples = await converter.convertNote(file);

      // rdf:type
      const rdfType = Namespace.RDF.term("type");
      const emsTask = Namespace.EMS.term("Task");
      expect(triples.some((t) =>
        t.predicate.equals(rdfType) &&
        t.object instanceof IRI &&
        t.object.equals(emsTask),
      )).toBe(true);

      // exo:Asset_label
      expect(hasTripleWithObject(triples, Namespace.EXO.term("Asset_label"), "No Proto Task")).toBe(true);

      // exo:Asset_uid
      const uidTriples = findTriples(triples, Namespace.EXO.term("Asset_uid"));
      expect(uidTriples).toHaveLength(1);

      // exo:Instance_class
      const classTriples = findTriples(triples, Namespace.EXO.term("Instance_class"));
      expect(classTriples.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -----------------------------------------------------------------------
  // UUID uniqueness across multiple executions
  // -----------------------------------------------------------------------

  describe("multiple executions produce unique files", () => {
    it("should create files with different UUIDs", async () => {
      const grounding: GroundingDefinition = {
        id: "gnd-create-multi",
        label: "Create Multi",
        type: GroundingType.CREATE_INSTANCE,
        targetClass: "ems__Task",
        targetFolder: "01 Inbox",
      };

      await groundingExecutor.execute(
        grounding,
        "https://exocortex.my/assets/parent",
        "/vault/parent.md",
        { label: "Task A" },
      );

      await groundingExecutor.execute(
        grounding,
        "https://exocortex.my/assets/parent",
        "/vault/parent.md",
        { label: "Task B" },
      );

      const createdPaths = fs
        .getAllPaths()
        .filter((p) => p !== PARENT_FILE_PATH);
      expect(createdPaths).toHaveLength(2);

      // Extract UUIDs from paths
      const uuids = createdPaths.map((p) =>
        p.replace("01 Inbox/", "").replace(".md", ""),
      );
      expect(uuids[0]).not.toBe(uuids[1]);
    });
  });
});
