/**
 * Integration test (Issue #3757): a `create_instance` grounding whose Universal
 * Default Template PropertyDefault uses a `$target.property(<key>)`
 * TokenInvocation inherits the click-target's frontmatter value for `<key>`.
 *
 * Production-shape: the Universal singleton + PropertyDefault + TokenInvocation +
 * SubstitutionToken + property assets are authored as MARKDOWN and run through
 * the REAL `NoteToRDFConverter.convertVault()` → `CommandResolver.loadCommand()`
 * → `GroundingExecutor.execute()` pipeline. This is the path the CLI `apply`
 * command and the Obsidian plugin button both take.
 *
 * @req:9244d216-d87f-45cb-970a-66ba8dd3f686
 *
 * Root cause (#3757): `NoteToRDFConverter.valueToRDFObject` substituted the plain
 * literal `exocmd__TokenInvocation_parameter: exo__Asset_isDefinedBy` into the
 * ontology class IRI (`<…/exo#Asset_isDefinedBy>`) because it matches the
 * `prefix__LocalName` class-reference shape. `CommandResolver` then baked the IRI
 * into the `$target.property(…)` marker, and the `targetProperty` resolver looked
 * up `targetFm[<IRI>]` (a guaranteed miss — `targetFm` is keyed by the prefixed
 * frontmatter key) → returned null → the created instance silently lost
 * `exo__Asset_isDefinedBy`. The 1-line fix bypasses class-IRI substitution for the
 * `#TokenInvocation_parameter` predicate so the resolver receives the literal key.
 *
 * REVERT-VERIFY (integration-test-revert-verify rule): with the converter bypass,
 * the created instance inherits `exo__Asset_isDefinedBy` from `$target` (GREEN);
 * removing the bypass (so the parameter mangles into the class IRI) makes the
 * property disappear (RED). Empirically verified: FAILS pre-fix, PASSES post-fix.
 *
 * The companion `CommandResolver.universalDefaultTemplate.test.ts` injects the
 * `TokenInvocation_parameter` triple DIRECTLY into the store, bypassing the
 * converter — a test-fixture-realism false-positive that could never catch this
 * bug. This suite closes that gap by going through `convertVault`.
 */

import "reflect-metadata";
import {
  GroundingExecutor,
  ServiceRegistry,
} from "../../../src/services/GroundingExecutor";
import { NoteToRDFConverter } from "../../../src/services/NoteToRDFConverter";
import { CommandResolver } from "../../../src/services/CommandResolver";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { installDefaultResolvers } from "../../../src/services/SubstitutionResolverRegistry";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { IRI } from "../../../src/domain/models/rdf/IRI";
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
// In-memory file system + vault adapter (mirrors create-instance-grounding.test)
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

// Real catalog class / type UIDs (must match production for resolution).
const UDT_CLASS = "29e2c8f8-2d27-4e58-b467-2e85d46f8122"; // exocmd__UniversalDefaultTemplate
const TI_CLASS = "3f28af98-c031-4718-8ba2-44ad0b012c52"; // exocmd__TokenInvocation
const TOKEN_CLASS = "08cec529-90eb-4d43-88de-ceecccea12b0"; // exocmd__SubstitutionToken
const CREATE_INSTANCE_TYPE = "4367e2d6-6c92-450a-becb-abce1fb07682";

// Test-owned asset UIDs.
const ONTO_UID = "aaaa1111-1111-4111-8111-111111111111";
const PROTO_UID = "bbbb2222-2222-4222-8222-222222222222";
const PROTOCLASS_UID = "cccc3333-3333-4333-8333-333333333333";
const CMD_UID = "dddd4444-4444-4444-8444-444444444444";
const GROUNDING_UID = "eeee5555-5555-4555-8555-555555555555";
const TARGETCLASS_UID = "ffff6666-6666-4666-8666-666666666666";
const SINGLETON_UID = "11117777-7777-4777-8777-777777777777";
const PD_ISDEFINEDBY_UID = "22228888-8888-4888-8888-888888888888";
const PROP_ISDEFINEDBY_UID = "33339999-9999-4999-8999-999999999999";
const TI_UID = "4444aaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TOKEN_UID = "5555bbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const EXOCMD_DIR = "assetspaces/exocmd";
const MY_DIR = "assetspaces/my";

async function seedVault(fs: InMemoryFileSystem): Promise<void> {
  // Click-target prototype with the ontology to inherit.
  await fs.createFile(
    `${MY_DIR}/${PROTO_UID}.md`,
    [
      "---",
      `exo__Asset_uid: ${PROTO_UID}`,
      `exo__Asset_isDefinedBy: "[[${ONTO_UID}]]"`,
      'exo__Asset_label: "Test Prototype"',
      "exo__Instance_class:",
      `  - "[[${PROTOCLASS_UID}]]"`,
      "---",
      "Body",
    ].join("\n"),
  );

  // Command → grounding (create_instance), no inline PDs/IRs → defaults come
  // purely from the Universal singleton merge.
  await fs.createFile(
    `${EXOCMD_DIR}/${CMD_UID}.md`,
    [
      "---",
      `exo__Asset_uid: ${CMD_UID}`,
      'exo__Asset_label: "Test Create Instance"',
      "exo__Instance_class:",
      '  - "[[exocmd__Command]]"',
      `exocmd__Command_grounding: "[[${GROUNDING_UID}]]"`,
      "exocmd__Command_cliName: test-create-instance",
      "---",
    ].join("\n"),
  );
  await fs.createFile(
    `${EXOCMD_DIR}/${GROUNDING_UID}.md`,
    [
      "---",
      `exo__Asset_uid: ${GROUNDING_UID}`,
      'exo__Asset_label: "Create Test instance"',
      "exo__Instance_class:",
      '  - "[[exocmd__Grounding]]"',
      `exocmd__Grounding_type: "[[${CREATE_INSTANCE_TYPE}]]"`,
      'exocmd__Grounding_targetFolder: "01 Inbox"',
      `exocmd__Grounding_targetClass: "[[${TARGETCLASS_UID}]]"`,
      "---",
    ].join("\n"),
  );

  // Universal Default Template singleton → ONE PropertyDefault for isDefinedBy.
  await fs.createFile(
    `${EXOCMD_DIR}/${SINGLETON_UID}.md`,
    [
      "---",
      `exo__Asset_uid: ${SINGLETON_UID}`,
      'exo__Asset_label: "Universal Default Template (singleton)"',
      "exo__Instance_class:",
      `  - "[[${UDT_CLASS}]]"`,
      "exocmd__Template_propertyDefault:",
      `  - "[[${PD_ISDEFINEDBY_UID}]]"`,
      "---",
    ].join("\n"),
  );

  // PropertyDefault: exo__Asset_isDefinedBy = $target.property(exo__Asset_isDefinedBy)
  await fs.createFile(
    `${EXOCMD_DIR}/${PD_ISDEFINEDBY_UID}.md`,
    [
      "---",
      `exo__Asset_uid: ${PD_ISDEFINEDBY_UID}`,
      'exo__Asset_label: "Universal PD: exo__Asset_isDefinedBy = $target.property(isDefinedBy)"',
      "exo__Instance_class:",
      '  - "[[exocmd__PropertyDefault]]"',
      `exocmd__PropertyDefault_property: "[[${PROP_ISDEFINEDBY_UID}]]"`,
      `exocmd__PropertyDefault_value: "[[${TI_UID}]]"`,
      "---",
    ].join("\n"),
  );

  // The exo__Property whose label IS the frontmatter key being defaulted.
  await fs.createFile(
    `${EXOCMD_DIR}/${PROP_ISDEFINEDBY_UID}.md`,
    [
      "---",
      `exo__Asset_uid: ${PROP_ISDEFINEDBY_UID}`,
      "exo__Asset_label: exo__Asset_isDefinedBy",
      "exo__Instance_class:",
      '  - "[[exo__Property]]"',
      "---",
    ].join("\n"),
  );

  // TokenInvocation wrapper: token=targetProperty, parameter=exo__Asset_isDefinedBy
  // (the prefixed KEY — the converter must NOT mangle it into a class IRI).
  await fs.createFile(
    `${EXOCMD_DIR}/${TI_UID}.md`,
    [
      "---",
      `exo__Asset_uid: ${TI_UID}`,
      'exo__Asset_label: "TokenInvocation: $target.property(exo__Asset_isDefinedBy)"',
      "exo__Instance_class:",
      `  - "[[${TI_CLASS}]]"`,
      `exocmd__TokenInvocation_token: "[[${TOKEN_UID}]]"`,
      "exocmd__TokenInvocation_parameter: exo__Asset_isDefinedBy",
      "---",
    ].join("\n"),
  );

  // SubstitutionToken declaring the `targetProperty` resolver.
  await fs.createFile(
    `${EXOCMD_DIR}/${TOKEN_UID}.md`,
    [
      "---",
      `exo__Asset_uid: ${TOKEN_UID}`,
      'exo__Asset_label: "$target.property"',
      "exo__Instance_class:",
      `  - "[[${TOKEN_CLASS}]]"`,
      "exocmd__SubstitutionToken_resolver: targetProperty",
      "---",
    ].join("\n"),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Integration #3757: create_instance $target.property(isDefinedBy) inheritance", () => {
  let fs: InMemoryFileSystem;
  let vaultAdapter: InMemoryVaultAdapter;
  let converter: NoteToRDFConverter;

  beforeEach(async () => {
    installDefaultResolvers();
    fs = new InMemoryFileSystem();
    await seedVault(fs);
    vaultAdapter = new InMemoryVaultAdapter(fs);
    converter = new NoteToRDFConverter(vaultAdapter);
  });

  // -- Converter-level gate (precise fix locus) --------------------------------

  it("@req:9244d216-d87f-45cb-970a-66ba8dd3f686 emits TokenInvocation_parameter as a literal KEY, not an ontology class IRI", async () => {
    const triples = await converter.convertVault();
    const paramTriples = triples.filter((t) =>
      t.predicate.value.endsWith("#TokenInvocation_parameter"),
    );
    expect(paramTriples).toHaveLength(1);
    const obj = paramTriples[0].object;
    // REVERT-VERIFY anchor: removing the converter bypass makes this an IRI
    // (`https://exocortex.my/ontology/exo#Asset_isDefinedBy`) → this fails.
    expect(obj).toBeInstanceOf(Literal);
    expect((obj as Literal).value).toBe("exo__Asset_isDefinedBy");
    expect(obj).not.toBeInstanceOf(IRI);
  });

  // -- End-to-end behavioural gate (orchestrator-mandated) ---------------------

  it("@req:9244d216-d87f-45cb-970a-66ba8dd3f686 creates an instance that inherits exo__Asset_isDefinedBy from $target through the real convertVault → resolver → executor path", async () => {
    const triples = await converter.convertVault();
    const store = new InMemoryTripleStore();
    await store.addAll(triples);

    const resolver = new CommandResolver(store);
    const command = await resolver.loadCommand(CMD_UID);
    expect(command).not.toBeNull();
    expect(command!.grounding).toBeDefined();

    // Sanity: the Universal isDefinedBy PD reached the grounding through the
    // in-store fallback (NOT a registered loader — the CLI has none).
    const isDefPd = (command!.grounding.propertyDefault ?? []).find(
      (p) => p.propertyName === "exo__Asset_isDefinedBy",
    );
    expect(isDefPd).toBeDefined();

    const serviceRegistry = new ServiceRegistry();
    const executor = new GroundingExecutor(fs, fs, serviceRegistry);

    const result = await executor.execute(
      command!.grounding,
      `obsidian://vault/${MY_DIR}/${PROTO_UID}.md`,
      `${MY_DIR}/${PROTO_UID}.md`,
    );
    expect(result.success).toBe(true);

    const created = fs
      .getAllPaths()
      .filter((p) => p.startsWith("01 Inbox/") && p.endsWith(".md"));
    expect(created).toHaveLength(1);
    const content = fs.getContent(created[0])!;

    // The core assertion: the new instance inherits the prototype's ontology
    // wikilink. REVERT-VERIFY: without the converter bypass the resolver gets
    // the IRI-form key, the lookup misses, and this line is absent → RED.
    expect(content).toContain(`exo__Asset_isDefinedBy: "[[${ONTO_UID}]]"`);
  });
});
