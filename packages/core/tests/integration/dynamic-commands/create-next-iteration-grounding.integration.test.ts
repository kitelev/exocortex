/**
 * Integration test (req 2d1ffced): the re-instated ems__Task «Create Next
 * Iteration» command spawns a fresh Backlog copy of a Done task carrying all of
 * the original's substantive properties + an ems__Effort_prevIteration back-link,
 * WITHOUT mutating the finished task, and is offered ONLY on a Done, non-archived,
 * non-prototype task.
 *
 * Production-shape: the command + create_instance grounding + InheritanceRules +
 * PropertyDefault + AllPrecondition (Done+not-prototype AND not-archived) + binding
 * + a Done / Doing / Backlog / Archived / prototype task are authored as MARKDOWN
 * and run through the REAL
 * `NoteToRDFConverter.convertVault()` → `CommandResolver.loadCommand()` →
 * `GroundingExecutor.execute()` / `PreconditionEvaluator.evaluate()` pipeline — the
 * exact path the CLI `apply` command and the Obsidian inline button both take
 * (test-fixture-realism: no hand-injected triples).
 *
 * @req:2d1ffced-185b-4eff-8544-21b90a683f93
 *
 * Behaviour asserted (spec §2.3, req Gherkin):
 *  - executing the grounding on a Done task creates a NEW ems__Task in Backlog,
 *    copying the original's substantive properties (label / area / parent / zone /
 *    relates / deadline / estimate / body) and linking back via
 *    ems__Effort_prevIteration; fresh uid; NOT inheriting execution timestamps or
 *    ems__Effort_partiallyDone; co-located (same folder) with the original;
 *  - the ORIGINAL Done task is left unchanged (Create Next Iteration ≠ Partially
 *    Done — it never mutates the source);
 *  - the command's precondition is TRUE only for a Done, non-archived,
 *    non-prototype task and FALSE for Doing / Backlog / Archived / prototype.
 *
 * REVERT-VERIFY (integration-test-revert-verify rule):
 *  - BEHAVIOUR: removing IR_PREV (uid→prevIteration) from the grounding's
 *    inheritanceRule list makes the "links back via prevIteration" assertion RED;
 *    changing the PropertyDefault value from EffortStatusBacklog makes the "new
 *    task is Backlog" assertion RED. Restore → GREEN.
 *  - VISIBILITY: flipping the Done+not-prototype atomic's status-IRI (Done→Doing)
 *    makes the "visible on Done" assertion RED. Restore → GREEN.
 * Empirically verified (see PR body). Also end-to-end verified via the real CLI
 * `apply create-next-iteration` on an isolated temp vault + `resolve-buttons`
 * visibility (Done ✓; Doing / Backlog / Archived / prototype hidden).
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
// Fixture UIDs — the REAL production asset UIDs (exoas-exocmd + exoas-public).
// ---------------------------------------------------------------------------

const GT_CREATE_INSTANCE = "4367e2d6-6c92-450a-becb-abce1fb07682";

const CLS_TASK = "1b20a8f0-d745-4e93-91db-4531b3df120e";
const CLS_TASK_PROTO = "df7e579d-02d4-4f3a-971f-3d1d785b689b"; // ems__TaskPrototype
const ENUM_DOING = "027e78f4-6e16-4b36-b8fb-5510507d5745";
const ENUM_DONE = "7b9b3116-7c3c-438c-9618-94fe301320a6";
const ENUM_BACKLOG = "753a44d5-846c-4b82-9196-4fd9a4d48777";

// Command chain (my authored assets — re-instated in exoas-exocmd).
const CMD = "267ceae0-0392-4775-8804-b97959f92de3";
const BINDING = "c20d2304-d501-46e8-8884-c338ce2c7558";
const G_CREATE = "d240c457-3d62-4813-99c4-922134789771"; // modernized create_instance
const PD_BACKLOG = "ce287f1a-44a1-4dc6-b858-74a94919140a"; // reused (Partially Done)

// Precondition composite (my new AllPrecondition) + reused atomic leaves.
const PRECOND_ALL = "4090169b-9c6d-4937-b7e9-ebbf281b6462"; // AllPrecondition
const PRECOND_DONE = "2bee97b7-da01-4309-925b-f605e7816ba1"; // Done + not-prototype (reused, Re-open)
const PRECOND_NOTARCH = "28f722ba-cd01-44c6-b69d-b1c59b0e14fd"; // Not archived (reused, archived-gate)

// InheritanceRules (reused — the «Partially Done» clone mechanism).
const IR_AREA = "9f9ede48-ffaa-4ffb-85b8-81aa314d1021";
const IR_PARENT = "e9761329-2b48-449c-9453-e7d804102175";
const IR_ZONE = "0f8c1d14-9b30-4e1e-8111-d8a2b720c1d2";
const IR_RELATES = "2b9004cf-ca1d-4a68-9018-7d95993992fb";
const IR_DEADLINE = "563f5c90-b5db-4fe0-bca5-1c253938751d";
const IR_ESTIMATE = "b0817fa9-fbd7-45c3-9c5b-277a105b9d7f";
const IR_PREV = "6ebb59d0-3a0f-4deb-bc94-16ba51af2863"; // uid→prevIteration

// Property defs (label = plain prefix__local form — resolved by resolveLabelByUID).
const P_STATUS = "44c6e9e3-955f-4afc-9ca5-b4bd70667051";
const P_AREA = "9be36e9d-de67-4ed2-90b0-99cdf103e9bf";
const P_PARENT = "6528ecfa-a03d-47f1-a819-9ba5fea8fc28";
const P_ZONE = "9e82c952-0c6b-4528-bfab-61e0d5f1a2e7";
const P_RELATES = "e3a71d16-14b3-4aff-adf7-c9eccd1077b4";
const P_DEADLINE = "b2a403de-14ac-4e36-b3e4-1261810d7abd";
const P_ESTIMATE = "01d6e68e-6ff6-408f-85ef-36b1f8768a4d";
const P_UID = "fada7446-b0a4-4100-88f4-6d4421c175fb";
const P_PREV = "3104b383-90b2-41be-b561-995ac8001af7";

// Fixture-owned instances.
const DONE_TASK = "a1a1a1a1-1111-4111-8111-111111111111";
const DOING_TASK = "a2a2a2a2-2222-4222-8222-222222222222";
const BACKLOG_TASK = "a3a3a3a3-3333-4333-8333-333333333333";
const ARCHIVED_TASK = "a4a4a4a4-4444-4444-8444-444444444444";
const PROTO_TASK = "a5a5a5a5-5555-4555-8555-555555555555";
const T_AREA = "b2b2b2b2-2222-4222-8222-222222222222";
const T_PARENT = "b3b3b3b3-3333-4333-8333-333333333333";
const T_ZONE = "b4b4b4b4-4444-4444-8444-444444444444";
const T_RELATED = "b5b5b5b5-5555-4555-8555-555555555555";

const DIR = "assetspaces/my";

function fm(...lines: string[]): string {
  return ["---", ...lines, "---", ""].join("\n");
}

function propDef(uid: string, label: string): [string, string] {
  return [
    `${DIR}/${uid}.md`,
    fm(
      `exo__Asset_uid: ${uid}`,
      `exo__Asset_label: ${label}`,
      "exo__Instance_class:",
      '  - "[[exo__Property]]"',
    ),
  ];
}

function inheritanceRule(uid: string, src: string, tgt: string): [string, string] {
  return [
    `${DIR}/${uid}.md`,
    fm(
      `exo__Asset_uid: ${uid}`,
      `exo__Asset_label: "IR ${uid}"`,
      "exo__Instance_class:",
      '  - "[[exocmd__InheritanceRule]]"',
      `exocmd__InheritanceRule_sourceProperty: "[[${src}]]"`,
      `exocmd__InheritanceRule_targetProperty: "[[${tgt}]]"`,
      "exocmd__InheritanceRule_priority: 50",
    ),
  ];
}

/** A Done+not-prototype ASK line (single-line; naive parser captures via first colon). */
const ASK_DONE_NOT_PROTO =
  "exocmd__Precondition_sparqlAsk: " +
  'PREFIX ems: <https://exocortex.my/ontology/ems#> ASK { ' +
  'FILTER NOT EXISTS { $target <https://exocortex.my/ontology/exo#Instance_class> ?protoMarkerClass . ' +
  'FILTER(STRENDS(STR(?protoMarkerClass), "Prototype")) } ' +
  "$target ems:Effort_status ?s . " +
  "FILTER(?s IN ( <https://exocortex.my/ontology/ems#EffortStatusDone> )) }";

const ASK_NOT_ARCHIVED =
  "exocmd__Precondition_sparqlAsk: " +
  "PREFIX exo: <https://exocortex.my/ontology/exo#> ASK { " +
  'FILTER NOT EXISTS { $target exo:Asset_archived "true" } }';

function statusTask(
  uid: string,
  statusEnum: string,
  statusLabel: string,
  classUids: string[],
): [string, string] {
  return [
    `${DIR}/${uid}.md`,
    [
      "---",
      `exo__Asset_uid: ${uid}`,
      'exo__Asset_isDefinedBy: "[[!kitelev]]"',
      "exo__Instance_class:",
      ...classUids.map((c) => `  - "[[${c}]]"`),
      `exo__Asset_label: "Task ${uid}"`,
      `ems__Effort_status: "[[${statusEnum}|${statusLabel}]]"`,
      "---",
      "",
      "body",
    ].join("\n"),
  ];
}

async function seedVault(fs: InMemoryFileSystem): Promise<void> {
  const files: Array<[string, string]> = [
    // ---- Class + enum defs (label resolution) ----
    [
      `${DIR}/${CLS_TASK}.md`,
      fm(
        `exo__Asset_uid: ${CLS_TASK}`,
        "exo__Asset_label: ems__Task",
        'exo__Instance_class:\n  - "[[exo__Class]]"',
      ),
    ],
    [
      `${DIR}/${CLS_TASK_PROTO}.md`,
      fm(
        `exo__Asset_uid: ${CLS_TASK_PROTO}`,
        "exo__Asset_label: ems__TaskPrototype",
        'exo__Instance_class:\n  - "[[exo__Class]]"',
      ),
    ],
    [
      `${DIR}/${ENUM_DOING}.md`,
      fm(`exo__Asset_uid: ${ENUM_DOING}`, "exo__Asset_label: ems__EffortStatusDoing"),
    ],
    [
      `${DIR}/${ENUM_DONE}.md`,
      fm(`exo__Asset_uid: ${ENUM_DONE}`, "exo__Asset_label: ems__EffortStatusDone"),
    ],
    [
      `${DIR}/${ENUM_BACKLOG}.md`,
      fm(`exo__Asset_uid: ${ENUM_BACKLOG}`, "exo__Asset_label: ems__EffortStatusBacklog"),
    ],
    // ---- Property defs (plain-label) ----
    propDef(P_STATUS, "ems__Effort_status"),
    propDef(P_AREA, "ems__Effort_area"),
    propDef(P_PARENT, "ems__Effort_parent"),
    propDef(P_ZONE, "ems__Task_zone"),
    propDef(P_RELATES, "exo__Asset_relates"),
    propDef(P_DEADLINE, "ems__Effort_deadlineTimestamp"),
    propDef(P_ESTIMATE, "ems__Effort_timeEstimateMinutes"),
    propDef(P_UID, "exo__Asset_uid"),
    propDef(P_PREV, "ems__Effort_prevIteration"),
    // ---- InheritanceRules (the reused «Partially Done» clone mechanism) ----
    inheritanceRule(IR_AREA, P_AREA, P_AREA),
    inheritanceRule(IR_PARENT, P_PARENT, P_PARENT),
    inheritanceRule(IR_ZONE, P_ZONE, P_ZONE),
    inheritanceRule(IR_RELATES, P_RELATES, P_RELATES),
    inheritanceRule(IR_DEADLINE, P_DEADLINE, P_DEADLINE),
    inheritanceRule(IR_ESTIMATE, P_ESTIMATE, P_ESTIMATE),
    inheritanceRule(IR_PREV, P_UID, P_PREV),
    // ---- PropertyDefault: status = Backlog (reused) ----
    [
      `${DIR}/${PD_BACKLOG}.md`,
      fm(
        `exo__Asset_uid: ${PD_BACKLOG}`,
        'exo__Asset_label: "PD status Backlog"',
        "exo__Instance_class:",
        '  - "[[exocmd__PropertyDefault]]"',
        `exocmd__PropertyDefault_property: "[[${P_STATUS}]]"`,
        `exocmd__PropertyDefault_value: "[[${ENUM_BACKLOG}]]"`,
      ),
    ],
    // ---- create_instance grounding (modernized d240c457) ----
    [
      `${DIR}/${G_CREATE}.md`,
      fm(
        `exo__Asset_uid: ${G_CREATE}`,
        'exo__Asset_label: "Create Next Iteration grounding"',
        "exo__Instance_class:",
        '  - "[[exocmd__Grounding]]"',
        `exocmd__Grounding_type: "[[${GT_CREATE_INSTANCE}]]"`,
        "exocmd__Grounding_targetFolder: $targetFolder",
        "exocmd__Grounding_targetClass: ems__Task",
        "exocmd__Grounding_labelTemplate: $target.exo__Asset_label",
        "exocmd__Grounding_cloneTargetBody: true",
        "exocmd__Grounding_inheritanceRule:",
        `  - "[[${IR_AREA}]]"`,
        `  - "[[${IR_PARENT}]]"`,
        `  - "[[${IR_ZONE}]]"`,
        `  - "[[${IR_RELATES}]]"`,
        `  - "[[${IR_DEADLINE}]]"`,
        `  - "[[${IR_ESTIMATE}]]"`,
        `  - "[[${IR_PREV}]]"`,
        "exocmd__Grounding_propertyDefault:",
        `  - "[[${PD_BACKLOG}]]"`,
      ),
    ],
    // ---- precondition leaves (single-line ASK) ----
    [
      `${DIR}/${PRECOND_DONE}.md`,
      fm(
        `exo__Asset_uid: ${PRECOND_DONE}`,
        'exo__Asset_label: "Allow re-open (when status = Done)"',
        "exo__Instance_class:",
        '  - "[[exocmd__AtomicPrecondition]]"',
        ASK_DONE_NOT_PROTO,
      ),
    ],
    [
      `${DIR}/${PRECOND_NOTARCH}.md`,
      fm(
        `exo__Asset_uid: ${PRECOND_NOTARCH}`,
        'exo__Asset_label: "Not archived"',
        "exo__Instance_class:",
        '  - "[[exocmd__AtomicPrecondition]]"',
        ASK_NOT_ARCHIVED,
      ),
    ],
    // ---- AllPrecondition (AND): Done+not-prototype AND not-archived ----
    [
      `${DIR}/${PRECOND_ALL}.md`,
      fm(
        `exo__Asset_uid: ${PRECOND_ALL}`,
        'exo__Asset_label: "Is Done, not a prototype, and not archived"',
        "exo__Instance_class:",
        '  - "[[exocmd__AllPrecondition]]"',
        "exocmd__AllPrecondition_preconditions:",
        `  - "[[${PRECOND_DONE}]]"`,
        `  - "[[${PRECOND_NOTARCH}]]"`,
      ),
    ],
    // ---- command + binding ----
    [
      `${DIR}/${CMD}.md`,
      fm(
        `exo__Asset_uid: ${CMD}`,
        'exo__Asset_label: "Create Next Iteration"',
        "exo__Instance_class:",
        '  - "[[exocmd__Command]]"',
        `exocmd__Command_grounding: "[[${G_CREATE}]]"`,
        `exocmd__Command_precondition: "[[${PRECOND_ALL}]]"`,
        "exocmd__Command_cliName: create-next-iteration",
        "exocmd__Command_category: status",
      ),
    ],
    [
      `${DIR}/${BINDING}.md`,
      fm(
        `exo__Asset_uid: ${BINDING}`,
        'exo__Asset_label: "Create Next Iteration binding"',
        "exo__Instance_class:",
        '  - "[[exocmd__CommandBinding]]"',
        `exocmd__CommandBinding_command: "[[${CMD}]]"`,
        'exocmd__CommandBinding_targetClass: "ems__Task"',
        'exocmd__CommandBinding_position: "inline"',
      ),
    ],
    // ---- the Done click-target task (with substantive properties + body) ----
    [
      `${DIR}/${DONE_TASK}.md`,
      [
        "---",
        `exo__Asset_uid: ${DONE_TASK}`,
        'exo__Asset_isDefinedBy: "[[!kitelev]]"',
        "exo__Instance_class:",
        `  - "[[${CLS_TASK}]]"`,
        'exo__Asset_label: "Write the report"',
        `ems__Effort_status: "[[${ENUM_DONE}|ems__EffortStatusDone]]"`,
        "ems__Effort_startTimestamp: 2026-07-05T09:00:00",
        "ems__Effort_endTimestamp: 2026-07-05T11:00:00",
        "ems__Effort_resolutionTimestamp: 2026-07-05T11:00:00",
        `ems__Effort_area: "[[${T_AREA}]]"`,
        `ems__Effort_parent: "[[${T_PARENT}]]"`,
        `ems__Task_zone: "[[${T_ZONE}]]"`,
        `exo__Asset_relates: "[[${T_RELATED}]]"`,
        "ems__Effort_deadlineTimestamp: 2026-07-10T18:00:00",
        "ems__Effort_timeEstimateMinutes: 45",
        "---",
        "",
        "Body notes: draft outline, gather data, review with team.",
      ].join("\n"),
    ],
    // ---- status fixtures for the visibility matrix ----
    statusTask(DOING_TASK, ENUM_DOING, "ems__EffortStatusDoing", [CLS_TASK]),
    statusTask(BACKLOG_TASK, ENUM_BACKLOG, "ems__EffortStatusBacklog", [CLS_TASK]),
    // Archived = Done + top-level archived flag.
    [
      `${DIR}/${ARCHIVED_TASK}.md`,
      [
        "---",
        `exo__Asset_uid: ${ARCHIVED_TASK}`,
        'exo__Asset_isDefinedBy: "[[!kitelev]]"',
        "exo__Instance_class:",
        `  - "[[${CLS_TASK}]]"`,
        'exo__Asset_label: "Archived task"',
        `ems__Effort_status: "[[${ENUM_DONE}|ems__EffortStatusDone]]"`,
        "archived: true",
        "---",
        "",
        "body",
      ].join("\n"),
    ],
    // Prototype = Done + a *Prototype Instance_class marker (still an ems__Task).
    statusTask(PROTO_TASK, ENUM_DONE, "ems__EffortStatusDone", [
      CLS_TASK,
      CLS_TASK_PROTO,
    ]),
  ];
  for (const [path, content] of files) {
    await fs.createFile(path, content);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const DONE_PATH = `${DIR}/${DONE_TASK}.md`;
const DONE_IRI = `obsidian://vault/${DONE_PATH}`;
const iri = (uid: string) => `obsidian://vault/${DIR}/${uid}.md`;

describe("Integration (req 2d1ffced): ems__Task «Create Next Iteration» re-bind", () => {
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

  it("@req:2d1ffced-185b-4eff-8544-21b90a683f93 spawns a Backlog next iteration copying the Done task's properties WITHOUT mutating it", async () => {
    const command = await resolver.loadCommand(CMD);
    expect(command).not.toBeNull();
    // Standalone create_instance grounding (NOT a composite — no source mutation).
    expect(command!.grounding.type).toBe("create_instance");

    const before = fs.getContent(DONE_PATH)!;

    const executor = new GroundingExecutor(fs, fs, new ServiceRegistry());
    const result = await executor.execute(command!.grounding, DONE_IRI, DONE_PATH);
    expect(result.success).toBe(true);

    // -- ORIGINAL Done task: left completely unchanged (create-only, no mutation) --
    const after = fs.getContent(DONE_PATH)!;
    expect(after).toBe(before);

    // -- NEW task: fresh Backlog next iteration (exactly one created) --
    const fresh = fs
      .getAllPaths()
      .filter((p) => p.endsWith(".md") && isFreshInstance(p));
    expect(fresh).toHaveLength(1);
    const next = fs.getContent(fresh[0])!;

    // status Backlog (NOT Done).
    expect(next).toContain(`ems__Effort_status: "[[${ENUM_BACKLOG}]]"`);
    expect(next).not.toContain(`ems__Effort_status: "[[${ENUM_DONE}]]"`);
    // substantive properties carried forward.
    expect(next).toContain("Write the report"); // label (labelTemplate)
    expect(next).toContain(`ems__Effort_area: "[[${T_AREA}]]"`);
    expect(next).toContain(`ems__Effort_parent: "[[${T_PARENT}]]"`);
    expect(next).toContain(`ems__Task_zone: "[[${T_ZONE}]]"`);
    expect(next).toContain(`exo__Asset_relates: "[[${T_RELATED}]]"`);
    expect(next).toContain("ems__Effort_deadlineTimestamp: 2026-07-10T18:00:00");
    expect(next).toContain("ems__Effort_timeEstimateMinutes: 45");
    // body cloned forward.
    expect(next).toContain("Body notes: draft outline");
    // links back to the original via prevIteration.
    expect(next).toContain(`ems__Effort_prevIteration: "[[${DONE_TASK}]]"`);
    // fresh uid (NOT the original's).
    expect(next).not.toContain(`exo__Asset_uid: ${DONE_TASK}`);

    // Deliberately NOT inherited: partiallyDone flag + execution timestamps.
    expect(next).not.toContain("ems__Effort_partiallyDone");
    expect(next).not.toContain("ems__Effort_startTimestamp");
    expect(next).not.toContain("ems__Effort_endTimestamp");
    expect(next).not.toContain("ems__Effort_resolutionTimestamp");
  });

  it("@req:2d1ffced-185b-4eff-8544-21b90a683f93 is visible ONLY on a Done, non-archived, non-prototype task (precondition)", async () => {
    const command = await resolver.loadCommand(CMD);
    expect(command).not.toBeNull();
    expect(command!.precondition).toBeDefined();

    const evaluator = new PreconditionEvaluator(store);

    // Visible on the Done task…
    expect(await evaluator.evaluate(command!.precondition, DONE_IRI)).toBe(true);
    // …hidden everywhere else.
    expect(await evaluator.evaluate(command!.precondition, iri(DOING_TASK))).toBe(false);
    expect(await evaluator.evaluate(command!.precondition, iri(BACKLOG_TASK))).toBe(false);
    expect(await evaluator.evaluate(command!.precondition, iri(ARCHIVED_TASK))).toBe(false);
    expect(await evaluator.evaluate(command!.precondition, iri(PROTO_TASK))).toBe(false);
  });

  it("@req:2d1ffced-185b-4eff-8544-21b90a683f93 binds «Create Next Iteration» to ems__Task", async () => {
    const resolved = await resolver.resolveForAssetMulti(
      DONE_IRI,
      ["ems__Task"],
      undefined,
    );
    const names = resolved.map((r) => r.command.name);
    expect(names).toContain("Create Next Iteration");
  });
});

/** A freshly created instance file (uuid-named, not one of the seeded fixtures). */
function isFreshInstance(path: string): boolean {
  const base = path.split("/").pop()!.replace(".md", "");
  const seeded = new Set([
    DONE_TASK, DOING_TASK, BACKLOG_TASK, ARCHIVED_TASK, PROTO_TASK,
    T_AREA, T_PARENT, T_ZONE, T_RELATED, CMD, BINDING, G_CREATE, PD_BACKLOG,
    PRECOND_ALL, PRECOND_DONE, PRECOND_NOTARCH,
    IR_AREA, IR_PARENT, IR_ZONE, IR_RELATES, IR_DEADLINE, IR_ESTIMATE, IR_PREV,
    P_STATUS, P_AREA, P_PARENT, P_ZONE, P_RELATES, P_DEADLINE, P_ESTIMATE,
    P_UID, P_PREV, CLS_TASK, CLS_TASK_PROTO,
    ENUM_DOING, ENUM_DONE, ENUM_BACKLOG,
  ]);
  return !seeded.has(base);
}
