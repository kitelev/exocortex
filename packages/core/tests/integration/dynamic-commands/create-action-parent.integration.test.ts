/**
 * Integration test (req 2821fdf0): «Create Action» on an `ems__Task` nests the
 * created `ems__Action` under that task.
 *
 *  - TASK TARGET: `ems__Effort_parent` = the task. Before the fix the grounding
 *    carried only an Area rule, a Project-conditioned parent rule and an
 *    isDefinedBy pass-through, so a Task matched none of them and the action was
 *    created with NO parent at all.
 *  - PROJECT TARGET: unchanged — still parented to the project (no regression).
 *  - PROTOTYPE TARGET: still gets no parent (regression guard for the 2026-05-24
 *    defect that narrowed the Project rule in the first place). The condition is
 *    matched DIRECTLY by class, so `ems__TaskPrototype ⊂ ems__Task` must not
 *    inherit the Task rule.
 *  - NON-EFFORT TARGET: gets no parent, so nothing outside the property's range
 *    is ever written (the shipped precondition admits status-less targets, so
 *    this is reachable through the CLI).
 *
 * WHERE THE RULE LIVES — and why the fixture mirrors that. `mergeInheritanceRules`
 * deduplicates by `targetPropertyName`: a Grounding can express at most ONE rule
 * per property and that rule also shadows every Universal rule for the same
 * property. So the Project and Task parent rules cannot both sit on the
 * grounding — they live on the `exocmd__UniversalDefaultTemplate` singleton,
 * whose own list is not deduplicated against itself, and the grounding declares
 * no parent rule at all. The fixture reproduces exactly that topology.
 *
 * The template fixture carries only its InheritanceRules — no PropertyDefaults.
 * The executor then fills the scalar primitives from its legacy TS fallback and
 * logs a warning; that path is deliberately out of scope here (it has its own
 * coverage) and cannot affect these axes, which read `ems__Effort_parent` only.
 *
 * Production-shape (test-fixture-realism): class defs, the Universal Default
 * Template singleton with its InheritanceRules, the create_instance grounding,
 * and the four targets are authored as MARKDOWN and run through the REAL
 * `NoteToRDFConverter.convertVault()` → `CommandResolver.loadCommand()` →
 * `GroundingExecutor.execute()` pipeline, then the CREATED FILE is read back —
 * the same path the CLI `apply create-action` and the Obsidian inline button
 * both take (no hand-injected triples, no hand-built GroundingDefinition).
 *
 * @req:2821fdf0-bf65-4afe-96cd-59da980ffe84
 *
 * REVERT-VERIFY (integration-test-revert-verify rule): `seedVault(fs, {
 * withTaskRule: false })` removes ONLY the Task rule from the Universal
 * Template — the exact pre-fix data state. Reverted, the Task assertion goes RED
 * while Project / prototype / non-Effort stay GREEN, i.e. the axis fails for its
 * own reason and nothing else moves. Measured both ways in
 * `describe("revert-verify")` below.
 */

import "reflect-metadata";
import { NoteToRDFConverter } from "../../../src/services/NoteToRDFConverter";
import { CommandResolver } from "../../../src/services/CommandResolver";
import {
  GroundingExecutor,
  ServiceRegistry,
} from "../../../src/services/GroundingExecutor";
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
// In-memory fs + vault adapter (mirrors trashed-terminal-status / archived-gate)
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
// Fixture UIDs — the REAL production UIDs for every shared asset.
// ---------------------------------------------------------------------------

const CLS_TASK = "1b20a8f0-d745-4e93-91db-4531b3df120e";
const CLS_PROJECT = "7db5eeff-718a-49b0-8d2b-39b084a356e3";
const CLS_TASK_PROTOTYPE = "df7e579d-02d4-4f3a-971f-3d1d785b689b";
const CLS_ACTION = "6a99d2ca-d402-4734-a10b-33f5f1a1aa42";
const CLS_CONCEPT = "dda12c48-6886-4624-8710-ed4ba92ce2b3";

const PROP_UID = "fada7446-b0a4-4100-88f4-6d4421c175fb"; // exo__Asset_uid
const PROP_PARENT = "6528ecfa-a03d-47f1-a819-9ba5fea8fc28"; // ems__Effort_parent
const PROP_ISDEFINEDBY = "3a1b1e35-0000-4000-8000-00000000dbef"; // fixture-owned stand-in

const GT_CREATE_INSTANCE = "4367e2d6-6c92-450a-becb-abce1fb07682";
const UDT_CLASS = "29e2c8f8-2d27-4e58-b467-2e85d46f8122"; // exocmd__UniversalDefaultTemplate

// Universal Default Template singleton + its parent rules (real UIDs).
const UDT_SINGLETON = "62907ff4-bf91-4c94-8e02-92b3ca2bc798";
const IR_PROJECT_PARENT = "01f570c9-3bf2-4ec8-af27-0aa4d9cbc29f"; // shipped
const IR_TASK_PARENT = "65acce2f-e0eb-48e2-bcb3-8d5c9664e799"; // NEW (req 2821fdf0)

// «Create action» grounding (real UID) — carries NO parent rule by design.
const GROUNDING_CREATE_ACTION = "1bc1e938-d07b-41b0-8264-d9ca81104af2";
const IR_ISDEFINEDBY = "cbe000c4-b29a-4405-876d-790fb2296121"; // unconditional pass-through

// Fixture-owned targets.
const TASK_TARGET = "aa000001-1111-4111-8111-111111111111";
const PROJECT_TARGET = "aa000002-2222-4222-8222-222222222222";
const PROTOTYPE_TARGET = "aa000003-3333-4333-8333-333333333333";
const CONCEPT_TARGET = "aa000004-4444-4444-8444-444444444444";

const DIR = "assetspaces/my";

function fm(...lines: string[]): string {
  return ["---", ...lines, "---", ""].join("\n");
}

function classDef(
  uid: string,
  label: string,
  ...superClasses: string[]
): [string, string] {
  const lines = [
    `exo__Asset_uid: ${uid}`,
    `exo__Asset_label: ${label}`,
    'exo__Instance_class:\n  - "[[exo__Class]]"',
  ];
  if (superClasses.length > 0) {
    lines.push(
      [
        "exo__Class_superClass:",
        ...superClasses.map((s) => `  - "[[${s}]]"`),
      ].join("\n"),
    );
  }
  return [`${DIR}/${uid}.md`, fm(...lines)];
}

function propertyDef(uid: string, label: string): [string, string] {
  return [
    `${DIR}/${uid}.md`,
    fm(
      `exo__Asset_uid: ${uid}`,
      `exo__Asset_label: ${label}`,
      'exo__Instance_class:\n  - "[[exo__Property]]"',
    ),
  ];
}

/** An InheritanceRule asset; `condition` is optional (absent = unconditional). */
function inheritanceRule(
  uid: string,
  label: string,
  src: string,
  tgt: string,
  condition?: string,
): [string, string] {
  const lines = [
    `exo__Asset_uid: ${uid}`,
    `exo__Asset_label: "${label}"`,
    "exo__Instance_class:",
    '  - "[[exocmd__InheritanceRule]]"',
    `exocmd__InheritanceRule_sourceProperty: "[[${src}]]"`,
    `exocmd__InheritanceRule_targetProperty: "[[${tgt}]]"`,
    "exocmd__InheritanceRule_priority: 50",
  ];
  if (condition) {
    lines.push(
      `exocmd__InheritanceRule_targetClassCondition: "[[${condition}]]"`,
    );
  }
  return [`${DIR}/${uid}.md`, fm(...lines)];
}

function target(
  uid: string,
  label: string,
  classUid: string,
): [string, string] {
  return [
    `${DIR}/${uid}.md`,
    [
      "---",
      `exo__Asset_uid: ${uid}`,
      'exo__Asset_isDefinedBy: "[[!kitelev]]"',
      "exo__Instance_class:",
      `  - "[[${classUid}]]"`,
      `exo__Asset_label: "${label}"`,
      "---",
      "",
      "body",
    ].join("\n"),
  ];
}

interface SeedOptions {
  /** false = the pre-fix data state: the Task rule is not on the template. */
  withTaskRule: boolean;
}

async function seedVault(
  fs: InMemoryFileSystem,
  { withTaskRule }: SeedOptions,
): Promise<void> {
  const templateRules = [
    IR_PROJECT_PARENT,
    ...(withTaskRule ? [IR_TASK_PARENT] : []),
  ];

  const files: Array<[string, string]> = [
    // ---- Class defs. TaskPrototype ⊂ Task on purpose: the condition must be
    // matched DIRECTLY, so the prototype must NOT inherit the Task rule.
    classDef(CLS_TASK, "ems__Task"),
    classDef(CLS_PROJECT, "ems__Project"),
    classDef(CLS_TASK_PROTOTYPE, "ems__TaskPrototype", CLS_TASK),
    classDef(CLS_ACTION, "ems__Action"),
    classDef(CLS_CONCEPT, "concept__Concept"),

    // ---- Property defs (source/target of the rules) ----
    propertyDef(PROP_UID, "exo__Asset_uid"),
    propertyDef(PROP_PARENT, "ems__Effort_parent"),
    propertyDef(PROP_ISDEFINEDBY, "exo__Asset_isDefinedBy"),

    // ---- InheritanceRules ----
    inheritanceRule(
      IR_PROJECT_PARENT,
      "Universal IR: Project.uid → new.ems__Effort_parent",
      PROP_UID,
      PROP_PARENT,
      CLS_PROJECT,
    ),
    inheritanceRule(
      IR_TASK_PARENT,
      "InheritanceRule: uid→parent (condition: ems__Task, prio 50)",
      PROP_UID,
      PROP_PARENT,
      CLS_TASK,
    ),
    inheritanceRule(
      IR_ISDEFINEDBY,
      "InheritanceRule: isDefinedBy→isDefinedBy (unconditional, prio 10)",
      PROP_ISDEFINEDBY,
      PROP_ISDEFINEDBY,
    ),

    // ---- Universal Default Template singleton (carries BOTH parent rules) ----
    [
      `${DIR}/${UDT_SINGLETON}.md`,
      fm(
        `exo__Asset_uid: ${UDT_SINGLETON}`,
        'exo__Asset_label: "Universal Default Template (singleton)"',
        "exo__Instance_class:",
        `  - "[[${UDT_CLASS}]]"`,
        "exocmd__Template_inheritanceRule:",
        ...templateRules.map((r) => `  - "[[${r}]]"`),
      ),
    ],

    // ---- «Create action» grounding — NO parent rule of its own ----
    [
      `${DIR}/${GROUNDING_CREATE_ACTION}.md`,
      fm(
        `exo__Asset_uid: ${GROUNDING_CREATE_ACTION}`,
        'exo__Asset_label: "Create action"',
        "exo__Instance_class:",
        '  - "[[exocmd__Grounding]]"',
        `exocmd__Grounding_type: "[[${GT_CREATE_INSTANCE}]]"`,
        'exocmd__Grounding_targetFolder: "$targetFolder"',
        `exocmd__Grounding_targetClass: "${CLS_ACTION}|ems__Action"`,
        'exocmd__Grounding_inputSchema: \'{"type":"object","properties":{"label":{"type":"string"}},"required":["label"]}\'',
        "exocmd__Grounding_inheritanceRule:",
        `  - "[[${IR_ISDEFINEDBY}]]"`,
      ),
    ],

    // ---- Targets ----
    target(TASK_TARGET, "Task target", CLS_TASK),
    target(PROJECT_TARGET, "Project target", CLS_PROJECT),
    target(PROTOTYPE_TARGET, "Prototype target", CLS_TASK_PROTOTYPE),
    target(CONCEPT_TARGET, "Concept target", CLS_CONCEPT),
  ];

  for (const [path, content] of files) {
    await fs.createFile(path, content);
  }
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const iriOf = (uid: string) => `obsidian://vault/${DIR}/${uid}.md`;
const pathOf = (uid: string) => `${DIR}/${uid}.md`;

/**
 * label → UID resolver over the seeded vault. Production parity: the CLI passes
 * `createVaultFrontmatterClassLabelResolver(nodeFsAdapter)` and the plugin its
 * metadataCache equivalent, because an InheritanceRule's
 * `targetClassCondition` resolves to a class LABEL (the class asset has a
 * parseable `prefix__Name`, so its wikilink emits the symbolic IRI) while a
 * target's `exo__Instance_class` is authored as a bare UID. Without this bridge
 * the condition can never match and every parent axis would be vacuously
 * "no parent" — an executor built without it does not exercise the shipped path.
 */
function classLabelToUid(fs: InMemoryFileSystem) {
  return async (label: string): Promise<string | null> => {
    for (const path of fs.getAllPaths()) {
      const fmap = parseFrontmatter(fs.getContent(path) ?? "");
      if (
        fmap &&
        String(fmap["exo__Asset_label"] ?? "").replace(/^"|"$/g, "") === label
      ) {
        return String(fmap["exo__Asset_uid"] ?? "") || null;
      }
    }
    return null;
  };
}

/**
 * Runs the real pipeline and returns the frontmatter of the file the grounding
 * created (the seeded assets are known, so the new path is the set difference).
 */
async function createActionOn(
  targetUid: string,
  options: SeedOptions,
): Promise<{ created: string; frontmatter: Record<string, unknown> }> {
  installDefaultResolvers();
  const fs = new InMemoryFileSystem();
  await seedVault(fs, options);
  const before = new Set(fs.getAllPaths());

  const converter = new NoteToRDFConverter(new InMemoryVaultAdapter(fs));
  const store = new InMemoryTripleStore();
  await store.addAll(await converter.convertVault());

  const resolver = new CommandResolver(store);
  const grounding = await resolver.loadGroundingByUid(GROUNDING_CREATE_ACTION);
  if (!grounding)
    throw new Error("grounding 1bc1e938 did not load from the fixture");

  const executor = new GroundingExecutor(
    fs,
    fs,
    new ServiceRegistry(),
    classLabelToUid(fs),
  );
  const result = await executor.execute(
    grounding,
    iriOf(targetUid),
    pathOf(targetUid),
    { label: "smoke action" },
  );
  expect(result.success).toBe(true);

  const fresh = fs.getAllPaths().filter((p) => !before.has(p));
  expect(fresh).toHaveLength(1);
  const content = fs.getContent(fresh[0])!;
  return { created: fresh[0], frontmatter: parseFrontmatter(content) ?? {} };
}

const parentOf = (frontmatter: Record<string, unknown>): string | undefined =>
  frontmatter["ems__Effort_parent"] as string | undefined;

// ---------------------------------------------------------------------------
// Axes
// ---------------------------------------------------------------------------

describe("req 2821fdf0 — «Create Action» parents the new action to its target", () => {
  it("@req:2821fdf0-bf65-4afe-96cd-59da980ffe84 a Task target becomes the action's ems__Effort_parent", async () => {
    const { frontmatter } = await createActionOn(TASK_TARGET, {
      withTaskRule: true,
    });
    expect(parentOf(frontmatter)).toBe(`"[[${TASK_TARGET}]]"`);
  });

  it("@req:2821fdf0-bf65-4afe-96cd-59da980ffe84 a Project target is unchanged (no regression)", async () => {
    const { frontmatter } = await createActionOn(PROJECT_TARGET, {
      withTaskRule: true,
    });
    expect(parentOf(frontmatter)).toBe(`"[[${PROJECT_TARGET}]]"`);
  });

  it("@req:2821fdf0-bf65-4afe-96cd-59da980ffe84 a TaskPrototype target still gets NO parent (2026-05-24 regression guard)", async () => {
    const { frontmatter } = await createActionOn(PROTOTYPE_TARGET, {
      withTaskRule: true,
    });
    expect(parentOf(frontmatter)).toBeUndefined();
  });

  it("@req:2821fdf0-bf65-4afe-96cd-59da980ffe84 a non-Effort target gets NO parent (nothing outside the range is written)", async () => {
    const { frontmatter } = await createActionOn(CONCEPT_TARGET, {
      withTaskRule: true,
    });
    expect(parentOf(frontmatter)).toBeUndefined();
  });

  it("@req:2821fdf0-bf65-4afe-96cd-59da980ffe84 the action is created with the grounding's target class either way", async () => {
    const { frontmatter } = await createActionOn(TASK_TARGET, {
      withTaskRule: true,
    });
    expect(String(frontmatter["exo__Instance_class"])).toContain(CLS_ACTION);
  });
});

describe("req 2821fdf0 — revert-verify (the Task rule removed from the Universal Template)", () => {
  it("RED axis: without the Task rule the action loses its parent entirely", async () => {
    const { frontmatter } = await createActionOn(TASK_TARGET, {
      withTaskRule: false,
    });
    // This is the shipped-before-fix behaviour: no parent at all, which is the
    // defect req 2821fdf0 fixes. If this ever starts returning the task, the
    // Task axis above has stopped depending on the rule and is vacuous.
    expect(parentOf(frontmatter)).toBeUndefined();
  });

  it("control: removing the Task rule does NOT disturb the Project target", async () => {
    const { frontmatter } = await createActionOn(PROJECT_TARGET, {
      withTaskRule: false,
    });
    expect(parentOf(frontmatter)).toBe(`"[[${PROJECT_TARGET}]]"`);
  });

  it("control: removing the Task rule does NOT disturb the prototype target", async () => {
    const { frontmatter } = await createActionOn(PROTOTYPE_TARGET, {
      withTaskRule: false,
    });
    expect(parentOf(frontmatter)).toBeUndefined();
  });
});
