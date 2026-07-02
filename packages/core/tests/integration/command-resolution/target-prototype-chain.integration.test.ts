/**
 * Integration test (@req:5ad0d6b4-2c9a-4375-bb5b-04e754861bec): a
 * `exocmd__CommandBinding` with `CommandBinding_targetPrototype = [[P]]`
 * matches instances whose TRANSITIVE `exo__Asset_prototype` chain contains P
 * — instances of child prototypes inherit a binding declared on the parent
 * prototype.
 *
 * Production-shape: prototypes, instances, the command, its grounding and the
 * binding are authored as MARKDOWN and run through the REAL
 * `NoteToRDFConverter.convertVault()` → `CommandResolver.resolveForAssetMulti()`
 * pipeline (no hand-injected triples — test-fixture-realism: the
 * `exo__Asset_prototype` objects land in the store in their real dual-IRI
 * forms, and the wikilink/UID normalisation is part of the behavior under
 * test). The `prototypeIRI` argument mirrors what the plugin render path
 * passes (`DynamicCommandButtonGroupBuilder.extractPrototypeIRI` — the bare
 * direct prototype UID from the instance's frontmatter).
 *
 * Motivating case: prototype «Покурить» a717a21b with child prototypes
 * «Покурить сигарету» / «Покурить ploom» — a single «Mark Done Post Factum»
 * binding on the parent must surface the button on instances of all three.
 *
 * REVERT-VERIFY (integration-test-revert-verify rule): reverting the
 * chain-walk (single-hop targetPrototype matching restored) turns the
 * child-prototype / grandchild cases RED while the direct-instance case stays
 * GREEN.
 */

import "reflect-metadata";
import { NoteToRDFConverter } from "../../../src/services/NoteToRDFConverter";
import { CommandResolver } from "../../../src/services/CommandResolver";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
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
// In-memory file system + vault adapter (mirrors
// create-instance-isDefinedBy-inheritance.integration.test)
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
// Fixture UIDs
// ---------------------------------------------------------------------------

// Real catalog UID (must match production for grounding-type resolution).
const CREATE_INSTANCE_TYPE = "4367e2d6-6c92-450a-becb-abce1fb07682";

// Prototype family: GRANDCHILD → CHILD → PARENT.
const PROTO_PARENT_UID = "aaaa1111-1111-4111-8111-111111111111";
const PROTO_CHILD_UID = "bbbb2222-2222-4222-8222-222222222222";
const PROTO_GRANDCHILD_UID = "cccc3333-3333-4333-8333-333333333333";
// Unrelated prototype (no chain to PARENT).
const PROTO_UNRELATED_UID = "dddd4444-4444-4444-8444-444444444444";
// Malformed cycle: X → Y → X.
const PROTO_CYCLE_X_UID = "eeee5555-5555-4555-8555-555555555555";
const PROTO_CYCLE_Y_UID = "ffff6666-6666-4666-8666-666666666666";

// Instances (one per resolution scenario).
const INST_DIRECT_UID = "11117777-7777-4777-8777-777777777777";
const INST_CHILD_UID = "22228888-8888-4888-8888-888888888888";
const INST_GRANDCHILD_UID = "33339999-9999-4999-8999-999999999999";
const INST_UNRELATED_UID = "4444aaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const INST_CYCLE_UID = "5555bbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

// Command + grounding + bindings.
const CMD_UID = "6666cccc-cccc-4ccc-8ccc-cccccccccccc";
const GROUNDING_UID = "7777dddd-dddd-4ddd-8ddd-dddddddddddd";
const TARGETCLASS_UID = "8888eeee-eeee-4eee-8eee-eeeeeeeeeeee";
const BINDING_PARENT_UID = "9999ffff-ffff-4fff-8fff-ffffffffffff";
const BINDING_CYCLE_Y_UID = "aaaa9999-9999-4999-8999-999999999991";

const EXOCMD_DIR = "assetspaces/exocmd";
const MY_DIR = "assetspaces/my";

function prototypeMd(uid: string, label: string, parentUid?: string): string {
  return [
    "---",
    `exo__Asset_uid: ${uid}`,
    `exo__Asset_label: "${label}"`,
    "exo__Instance_class:",
    '  - "[[ems__TaskPrototype]]"',
    ...(parentUid ? [`exo__Asset_prototype: "[[${parentUid}]]"`] : []),
    "---",
    "Prototype body",
  ].join("\n");
}

function instanceMd(uid: string, label: string, protoUid?: string): string {
  return [
    "---",
    `exo__Asset_uid: ${uid}`,
    `exo__Asset_label: "${label}"`,
    "exo__Instance_class:",
    '  - "[[ems__Task]]"',
    ...(protoUid ? [`exo__Asset_prototype: "[[${protoUid}]]"`] : []),
    "---",
    "Instance body",
  ].join("\n");
}

async function seedVault(fs: InMemoryFileSystem): Promise<void> {
  // Prototype family P ← C ← G.
  await fs.createFile(
    `${MY_DIR}/${PROTO_PARENT_UID}.md`,
    prototypeMd(PROTO_PARENT_UID, "Parent Prototype"),
  );
  await fs.createFile(
    `${MY_DIR}/${PROTO_CHILD_UID}.md`,
    prototypeMd(PROTO_CHILD_UID, "Child Prototype", PROTO_PARENT_UID),
  );
  await fs.createFile(
    `${MY_DIR}/${PROTO_GRANDCHILD_UID}.md`,
    prototypeMd(PROTO_GRANDCHILD_UID, "Grandchild Prototype", PROTO_CHILD_UID),
  );
  await fs.createFile(
    `${MY_DIR}/${PROTO_UNRELATED_UID}.md`,
    prototypeMd(PROTO_UNRELATED_UID, "Unrelated Prototype"),
  );

  // Malformed cycle X → Y → X.
  await fs.createFile(
    `${MY_DIR}/${PROTO_CYCLE_X_UID}.md`,
    prototypeMd(PROTO_CYCLE_X_UID, "Cycle X", PROTO_CYCLE_Y_UID),
  );
  await fs.createFile(
    `${MY_DIR}/${PROTO_CYCLE_Y_UID}.md`,
    prototypeMd(PROTO_CYCLE_Y_UID, "Cycle Y", PROTO_CYCLE_X_UID),
  );

  // Instances.
  await fs.createFile(
    `${MY_DIR}/${INST_DIRECT_UID}.md`,
    instanceMd(INST_DIRECT_UID, "Direct instance", PROTO_PARENT_UID),
  );
  await fs.createFile(
    `${MY_DIR}/${INST_CHILD_UID}.md`,
    instanceMd(INST_CHILD_UID, "Child-prototype instance", PROTO_CHILD_UID),
  );
  await fs.createFile(
    `${MY_DIR}/${INST_GRANDCHILD_UID}.md`,
    instanceMd(
      INST_GRANDCHILD_UID,
      "Grandchild-prototype instance",
      PROTO_GRANDCHILD_UID,
    ),
  );
  await fs.createFile(
    `${MY_DIR}/${INST_UNRELATED_UID}.md`,
    instanceMd(INST_UNRELATED_UID, "Unrelated instance", PROTO_UNRELATED_UID),
  );
  await fs.createFile(
    `${MY_DIR}/${INST_CYCLE_UID}.md`,
    instanceMd(INST_CYCLE_UID, "Cycle instance", PROTO_CYCLE_X_UID),
  );

  // Command + grounding (proven-to-load shape mirroring the
  // isDefinedBy-inheritance harness).
  await fs.createFile(
    `${EXOCMD_DIR}/${CMD_UID}.md`,
    [
      "---",
      `exo__Asset_uid: ${CMD_UID}`,
      'exo__Asset_label: "Test Prototype-Scoped Command"',
      "exo__Instance_class:",
      '  - "[[exocmd__Command]]"',
      `exocmd__Command_grounding: "[[${GROUNDING_UID}]]"`,
      "exocmd__Command_cliName: test-prototype-scoped",
      "---",
    ].join("\n"),
  );
  await fs.createFile(
    `${EXOCMD_DIR}/${GROUNDING_UID}.md`,
    [
      "---",
      `exo__Asset_uid: ${GROUNDING_UID}`,
      'exo__Asset_label: "Test grounding"',
      "exo__Instance_class:",
      '  - "[[exocmd__Grounding]]"',
      `exocmd__Grounding_type: "[[${CREATE_INSTANCE_TYPE}]]"`,
      'exocmd__Grounding_targetFolder: "01 Inbox"',
      `exocmd__Grounding_targetClass: "[[${TARGETCLASS_UID}]]"`,
      "---",
    ].join("\n"),
  );

  // The binding under test: targetPrototype = PARENT prototype.
  await fs.createFile(
    `${EXOCMD_DIR}/${BINDING_PARENT_UID}.md`,
    [
      "---",
      `exo__Asset_uid: ${BINDING_PARENT_UID}`,
      'exo__Asset_label: "Test command → Parent prototype binding"',
      "exo__Instance_class:",
      '  - "[[exocmd__CommandBinding]]"',
      `exocmd__CommandBinding_command: "[[${CMD_UID}]]"`,
      `exocmd__CommandBinding_targetPrototype: "[[${PROTO_PARENT_UID}]]"`,
      'exocmd__CommandBinding_position: "inline"',
      "exocmd__CommandBinding_order: 131",
      'exocmd__CommandBinding_group: "status"',
      "---",
    ].join("\n"),
  );

  // A second binding targeting Cycle Y — proves the cycle-guarded walk still
  // matches ancestors visited BEFORE the cycle closes (X → Y).
  await fs.createFile(
    `${EXOCMD_DIR}/${BINDING_CYCLE_Y_UID}.md`,
    [
      "---",
      `exo__Asset_uid: ${BINDING_CYCLE_Y_UID}`,
      'exo__Asset_label: "Test command → Cycle Y binding"',
      "exo__Instance_class:",
      '  - "[[exocmd__CommandBinding]]"',
      `exocmd__CommandBinding_command: "[[${CMD_UID}]]"`,
      `exocmd__CommandBinding_targetPrototype: "[[${PROTO_CYCLE_Y_UID}]]"`,
      'exocmd__CommandBinding_position: "inline"',
      "exocmd__CommandBinding_order: 132",
      'exocmd__CommandBinding_group: "status"',
      "---",
    ].join("\n"),
  );
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("CommandBinding targetPrototype transitive chain (@req:5ad0d6b4-2c9a-4375-bb5b-04e754861bec)", () => {
  let fs: InMemoryFileSystem;
  let resolver: CommandResolver;

  const subjectIRI = (uid: string) => `obsidian://vault/${MY_DIR}/${uid}.md`;

  const resolveFor = (instanceUid: string, directProtoUid?: string) =>
    resolver.resolveForAssetMulti(
      subjectIRI(instanceUid),
      ["ems__Task"],
      // Mirrors DynamicCommandButtonGroupBuilder.extractPrototypeIRI: the
      // bare direct prototype UID from the instance's own frontmatter.
      directProtoUid,
    );

  const parentBindingIn = (
    resolved: Awaited<ReturnType<CommandResolver["resolveForAssetMulti"]>>,
  ) => resolved.find((rc) => rc.binding.id.includes(BINDING_PARENT_UID));

  beforeEach(async () => {
    fs = new InMemoryFileSystem();
    await seedVault(fs);
    const converter = new NoteToRDFConverter(new InMemoryVaultAdapter(fs));
    const triples = await converter.convertVault();
    const store = new InMemoryTripleStore();
    await store.addAll(triples);
    resolver = new CommandResolver(store);
  });

  it("@req:5ad0d6b4-2c9a-4375-bb5b-04e754861bec resolves the parent-prototype binding for a DIRECT instance (single-hop behavior preserved)", async () => {
    const resolved = await resolveFor(INST_DIRECT_UID, PROTO_PARENT_UID);
    const match = parentBindingIn(resolved);
    expect(match).toBeDefined();
    expect(match!.binding.targetPrototype).toContain(PROTO_PARENT_UID);
  });

  it("@req:5ad0d6b4-2c9a-4375-bb5b-04e754861bec resolves the parent-prototype binding for a CHILD-prototype instance (1-hop chain-walk)", async () => {
    // REVERT-VERIFY anchor: with single-hop matching restored (no chain
    // walk), the direct prototype is PROTO_CHILD_UID ≠ binding target → RED.
    const resolved = await resolveFor(INST_CHILD_UID, PROTO_CHILD_UID);
    expect(parentBindingIn(resolved)).toBeDefined();
  });

  it("@req:5ad0d6b4-2c9a-4375-bb5b-04e754861bec resolves the parent-prototype binding for a GRANDCHILD-prototype instance (2-hop transitive chain)", async () => {
    const resolved = await resolveFor(
      INST_GRANDCHILD_UID,
      PROTO_GRANDCHILD_UID,
    );
    expect(parentBindingIn(resolved)).toBeDefined();
  });

  it("@req:5ad0d6b4-2c9a-4375-bb5b-04e754861bec does NOT resolve the binding for an instance whose chain never reaches the parent (no over-broadening)", async () => {
    const resolved = await resolveFor(INST_UNRELATED_UID, PROTO_UNRELATED_UID);
    expect(parentBindingIn(resolved)).toBeUndefined();
  });

  it("@req:5ad0d6b4-2c9a-4375-bb5b-04e754861bec does NOT resolve the binding for an instance with no exo__Asset_prototype at all", async () => {
    const resolved = await resolveFor(INST_DIRECT_UID, undefined);
    expect(parentBindingIn(resolved)).toBeUndefined();
  });

  it("@req:5ad0d6b4-2c9a-4375-bb5b-04e754861bec terminates on a prototype cycle (X → Y → X) and still matches ancestors visited before the cycle closes", async () => {
    // Must not hang (visited-set cycle guard + depth cap)…
    const resolved = await resolveFor(INST_CYCLE_UID, PROTO_CYCLE_X_UID);
    // …and the chain [X, Y] built before the cycle closed still matches the
    // binding declared on Y.
    const cycleMatch = resolved.find((rc) =>
      rc.binding.id.includes(BINDING_CYCLE_Y_UID),
    );
    expect(cycleMatch).toBeDefined();
    // The parent-prototype binding is unrelated to the cycle family.
    expect(parentBindingIn(resolved)).toBeUndefined();
  });
});
