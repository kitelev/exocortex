/**
 * Integration test (production-shape, revert-verified) for RFC 78572fa9 Phase 0
 * = Candidate A2 "structural symbolic-space completion".
 *
 * req: 0cf3f6ed-8038-44d6-bf38-a3319ef09712
 *
 * The #3805 dual-IRI seam: a class reference is emitted into the store as a
 * SYMBOLIC class IRI (`.../ontology/<prefix>#<LocalName>`) when the target's
 * label parses as `prefix__LocalName`, but the structural
 * `exo__Class_superClass` triples historically exist ONLY on the class file's
 * FILE-IRI subject. So a pure-SPARQL transitive walk
 *   `?s exo:Instance_class ?c . ?c exo:Class_superClass* <X>`
 * yielded ZERO for the ~99.8% of assets whose `exo__Instance_class` object is
 * the symbolic class IRI (only the zero-length `*` seed matched).
 *
 * A2 completes the SYMBOLIC shadow node: when a class-def is converted,
 * `NoteToRDFConverter` ALSO emits `<symbolic-class> exo:Class_superClass
 * <symbolic-parent>` for each declared superclass — so the transitive walk is
 * native.
 *
 * This suite goes through the REAL `NoteToRDFConverter.convertVault()` over a
 * fixture in-memory vault (NOT hand-injected triples — a hand-injected
 * `<symbolic> Class_superClass <symbolic>` would mask a converter-emission bug,
 * see test-fixture-realism). Revert-verify: delete the class-def symbolic
 * emission block in `convertLegacyNote` → the CQ1 walk returns nothing (RED);
 * restore → returns the instance (GREEN).
 */

import { NoteToRDFConverter } from "../../../src/services/NoteToRDFConverter";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { SPARQLParser } from "../../../src/infrastructure/sparql/SPARQLParser";
import { ExoQLAlgebraTranslator } from "../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import { ExoQLQueryExecutor } from "../../../src/infrastructure/sparql/executors/QueryExecutor";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";
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
// In-memory file system + vault adapter (mirrors the production-shape pattern
// in create-instance-isDefinedBy-inheritance.integration.test.ts)
// ---------------------------------------------------------------------------

class InMemoryFileSystem implements IFileSystemReader, IFileSystemWriter {
  private files = new Map<string, string>();
  async readFile(path: string): Promise<string> {
    const c = this.files.get(path);
    if (c === undefined) throw new Error(`File not found: ${path}`);
    return c;
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
    const c = this.files.get(oldPath);
    if (c !== undefined) {
      this.files.set(newPath, c);
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
// Fixture — UID-named class-defs (production-realistic: UID-canon TBox) whose
// `exo__Asset_label` parses as `prefix__LocalName`, so their references are
// emitted in SYMBOLIC form. Hierarchy: C1 ⊑ C2 ⊑ C3 (C3 root). Instance A is
// classified DIRECTLY as C1 — the LEAF class, never itself referenced as a
// superClass. This is the regression that a hand-injected triple would mask:
// the instance's `exo__Instance_class` reference does NOT trigger the
// enum-instance emission path, so C1's own symbolic superclass edge is only
// present because A2 hooks at class-def conversion (not enum-reference).
// ---------------------------------------------------------------------------

const C1_UID = "aaaa1111-1111-4111-8111-111111111111";
const C2_UID = "bbbb2222-2222-4222-8222-222222222222";
const C3_UID = "cccc3333-3333-4333-8333-333333333333";
const A_UID = "dddd4444-4444-4444-8444-444444444444";
const A2_UID = "eeee5555-5555-4555-8555-555555555555";
// exo__Class metaclass (realistic Instance_class for a class-def).
const EXO_CLASS_METACLASS = "8619c4fc-64f1-4869-b17e-e34186cacca9";

const DIR = "assetspaces/test";

// Symbolic class IRIs the converter builds from the `test__Cn` labels.
const NS_TEST = Namespace.forPrefix("test")!;
const C1_SYM = NS_TEST.term("C1");
const C2_SYM = NS_TEST.term("C2");
const C3_SYM = NS_TEST.term("C3");
const superClassPred = Namespace.EXO.term("Class_superClass");
const instanceClassPred = Namespace.EXO.term("Instance_class");

function classDef(
  uid: string,
  localName: string,
  superClassUid?: string,
): string {
  const lines = [
    "---",
    `exo__Asset_uid: ${uid}`,
    `exo__Asset_label: test__${localName}`,
    `exo__Instance_class: "[[${EXO_CLASS_METACLASS}|exo__Class]]"`,
  ];
  if (superClassUid) {
    lines.push(`exo__Class_superClass: "[[${superClassUid}]]"`);
  }
  lines.push("---", "");
  return lines.join("\n");
}

function instance(uid: string, classUid: string): string {
  return [
    "---",
    `exo__Asset_uid: ${uid}`,
    `exo__Asset_label: Instance ${uid.slice(0, 4)}`,
    `exo__Instance_class: "[[${classUid}]]"`,
    "---",
    "",
  ].join("\n");
}

async function buildStore(
  fs: InMemoryFileSystem,
): Promise<InMemoryTripleStore> {
  const vault = new InMemoryVaultAdapter(fs);
  const converter = new NoteToRDFConverter(vault);
  const triples = await converter.convertVault();
  const store = new InMemoryTripleStore();
  await store.addAll(triples);
  return store;
}

async function queryValues(
  store: InMemoryTripleStore,
  sparql: string,
  variable: string,
): Promise<string[]> {
  const parser = new SPARQLParser();
  const translator = new ExoQLAlgebraTranslator();
  const ast = parser.parse(sparql);
  const algebra = translator.translate(ast);
  const executor = new ExoQLQueryExecutor(store);
  const solutions = await executor.executeAll(algebra);
  return solutions
    .map((sol) => {
      const val = sol.get(variable);
      if (val instanceof IRI) return val.value;
      if (val instanceof Literal) return val.value;
      return undefined;
    })
    .filter((v): v is string => v !== undefined);
}

const A_IRI = `obsidian://vault/${DIR}/${A_UID}.md`;
const A2_IRI = `obsidian://vault/${DIR}/${A2_UID}.md`;

describe("Integration: symbolic-space Class_superClass walk (A2, RFC 78572fa9 Phase 0)", () => {
  async function seedHierarchy(): Promise<InMemoryFileSystem> {
    const fs = new InMemoryFileSystem();
    await fs.createFile(`${DIR}/${C3_UID}.md`, classDef(C3_UID, "C3")); // root
    await fs.createFile(`${DIR}/${C2_UID}.md`, classDef(C2_UID, "C2", C3_UID));
    await fs.createFile(`${DIR}/${C1_UID}.md`, classDef(C1_UID, "C1", C2_UID));
    await fs.createFile(`${DIR}/${A_UID}.md`, instance(A_UID, C1_UID)); // leaf-class instance
    return fs;
  }

  it("@req:0cf3f6ed-8038-44d6-bf38-a3319ef09712 CQ1: transitive hierarchy walk is native for symbolic-form leaf-class instances", async () => {
    const store = await buildStore(await seedHierarchy());

    // The instance's Instance_class object is the SYMBOLIC leaf class IRI.
    const directClass = await queryValues(
      store,
      `SELECT ?c WHERE { <${A_IRI}> <${instanceClassPred.value}> ?c }`,
      "c",
    );
    expect(directClass).toContain(C1_SYM.value);

    // CQ1 — the whole point: walk from the instance's class up to a transitive
    // ANCESTOR purely in symbolic space. Reaching C3 (2 hops above C1) proves
    // both C1→C2 (leaf-class edge) and C2→C3 are present in symbolic space.
    const reachC3 = await queryValues(
      store,
      `SELECT ?s WHERE { ?s <${instanceClassPred.value}> ?c . ?c <${superClassPred.value}>* <${C3_SYM.value}> }`,
      "s",
    );
    expect(reachC3).toContain(A_IRI);

    // Also reaches the mid ancestor C2, and matches its own class C1 (zero-length `*`).
    const reachC2 = await queryValues(
      store,
      `SELECT ?s WHERE { ?s <${instanceClassPred.value}> ?c . ?c <${superClassPred.value}>* <${C2_SYM.value}> }`,
      "s",
    );
    expect(reachC2).toContain(A_IRI);

    const reachC1 = await queryValues(
      store,
      `SELECT ?s WHERE { ?s <${instanceClassPred.value}> ?c . ?c <${superClassPred.value}>* <${C1_SYM.value}> }`,
      "s",
    );
    expect(reachC1).toContain(A_IRI);
  });

  it("@req:0cf3f6ed-8038-44d6-bf38-a3319ef09712 emits the symbolic superclass edges (C1→C2, C2→C3) directly on the symbolic class subjects", async () => {
    const store = await buildStore(await seedHierarchy());

    const c1Parents = await store.match(C1_SYM, superClassPred, undefined);
    expect(c1Parents.map((t) => (t.object as IRI).value)).toEqual([
      C2_SYM.value,
    ]);

    const c2Parents = await store.match(C2_SYM, superClassPred, undefined);
    expect(c2Parents.map((t) => (t.object as IRI).value)).toEqual([
      C3_SYM.value,
    ]);

    // C3 is the root — no symbolic superclass edge.
    const c3Parents = await store.match(C3_SYM, superClassPred, undefined);
    expect(c3Parents).toHaveLength(0);
  });

  it("@req:0cf3f6ed-8038-44d6-bf38-a3319ef09712 emit-once: the symbolic C1→C2 edge appears once even with N instances of C1", async () => {
    const fs = await seedHierarchy();
    // Add a second instance of the same leaf class C1.
    await fs.createFile(`${DIR}/${A2_UID}.md`, instance(A2_UID, C1_UID));
    const store = await buildStore(fs);

    // Emission is at class-def conversion (once per class file), NOT per
    // referencing instance — the store holds exactly one C1→C2 triple.
    const edge = await store.match(C1_SYM, superClassPred, C2_SYM);
    expect(edge).toHaveLength(1);

    // Both instances are transitively classified under C3.
    const reachC3 = await queryValues(
      store,
      `SELECT ?s WHERE { ?s <${instanceClassPred.value}> ?c . ?c <${superClassPred.value}>* <${C3_SYM.value}> }`,
      "s",
    );
    expect(reachC3).toEqual(expect.arrayContaining([A_IRI, A2_IRI]));
  });

  it("@req:0cf3f6ed-8038-44d6-bf38-a3319ef09712 cycle-safe: a malformed A ⊑ B ⊑ A class-def does not loop", async () => {
    const X_UID = "ffff6666-6666-4666-8666-666666666666";
    const Y_UID = "99997777-7777-4777-8777-777777777777";
    const INST_UID = "aaaa8888-8888-4888-8888-888888888888";
    const fs = new InMemoryFileSystem();
    await fs.createFile(`${DIR}/${X_UID}.md`, classDef(X_UID, "X", Y_UID));
    await fs.createFile(`${DIR}/${Y_UID}.md`, classDef(Y_UID, "Y", X_UID)); // cycle
    await fs.createFile(`${DIR}/${INST_UID}.md`, instance(INST_UID, X_UID));

    // Conversion must complete (no infinite loop building the store).
    const store = await buildStore(fs);

    // Both symbolic cycle edges are present (dedup + no-self-edge did not drop
    // the legitimate cross-edges), and the transitive `*` walk TERMINATES
    // (the SPARQL property-path executor is visited-set cycle-safe).
    const X_SYM = NS_TEST.term("X");
    const walk = await queryValues(
      store,
      `SELECT ?s WHERE { ?s <${instanceClassPred.value}> ?c . ?c <${superClassPred.value}>* <${X_SYM.value}> }`,
      "s",
    );
    expect(walk).toContain(`obsidian://vault/${DIR}/${INST_UID}.md`);
  });
});
