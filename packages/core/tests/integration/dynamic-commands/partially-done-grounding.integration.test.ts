/**
 * Integration test (req 87361a62): the ems__Task «Partially Done» composite
 * command closes a Doing task done-but-partial AND spawns a fresh Backlog next
 * iteration that copies the original's substantive properties.
 *
 * Production-shape: the command + composite + create_instance + InheritanceRules +
 * PropertyDefault + property_set groundings + property defs + a Doing task are
 * authored as MARKDOWN and run through the REAL
 * `NoteToRDFConverter.convertVault()` → `CommandResolver` → `GroundingExecutor.execute()`
 * pipeline — the exact path the CLI `apply` command and the Obsidian inline button
 * both take (test-fixture-realism: no hand-injected triples).
 *
 * @req:87361a62-76a3-4ba9-b008-432838743800
 *
 * Behaviour asserted (spec §2.1, req Gherkin):
 *  - the ORIGINAL (clicked) task → ems__Effort_status Done + end/resolution
 *    timestamps + ems__Effort_partiallyDone=true (startTimestamp preserved);
 *  - a NEW ems__Task is created in Backlog, copying the original's substantive
 *    properties (label / area / parent / zone / relates / deadline / estimate /
 *    body) and linking back via ems__Effort_prevIteration;
 *  - the NEW task carries NEITHER ems__Effort_partiallyDone NOR the execution
 *    timestamps (start / end / resolution), and has a fresh uid.
 *
 * REVERT-VERIFY (integration-test-revert-verify rule): removing the partiallyDone
 * property_set step (`6dede0b0`) from the composite `steps` list makes the
 * "original.partiallyDone === true" assertion RED; removing the status=Backlog
 * PropertyDefault makes the "new task is Backlog" assertion RED. Restoring →
 * GREEN. Empirically verified (see PR body). The behaviour is also end-to-end
 * verified via the real CLI `apply partially-done` on an isolated temp vault.
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
// In-memory fs + vault adapter (mirrors create-instance-isDefinedBy-inheritance)
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

// Grounding-type / class catalog (must match production for resolution).
const GT_COMPOSITE = "8f9a57db-3865-4886-92fb-c5ab7f3c3fa3";
const GT_CREATE_INSTANCE = "4367e2d6-6c92-450a-becb-abce1fb07682";
const GT_PROPERTY_SET = "cf3bb923-f1f1-40be-b728-782844402426";

const CLS_TASK = "1b20a8f0-d745-4e93-91db-4531b3df120e";
const ENUM_DOING = "027e78f4-6e16-4b36-b8fb-5510507d5745";
const ENUM_DONE = "7b9b3116-7c3c-438c-9618-94fe301320a6";
const ENUM_BACKLOG = "753a44d5-846c-4b82-9196-4fd9a4d48777";

// Command chain (my authored assets).
const CMD = "fefb9f38-fc15-45a1-80ed-4f97147e248c";
const BINDING = "04cf1c27-db29-4956-a89d-7a3498ef6a55";
const PRECOND = "577f798f-d280-44d3-9013-e699dfeeaa6b"; // reused (Doing + not-prototype)
const COMPOSITE = "d6c77239-1758-4f3a-8bdc-84c362de73ff";
const G_CREATE = "1abb0211-dfe3-4c3e-913f-ca39f13b5b09";
const G_STATUS_DONE = "bdf3c81f-3531-48a8-a680-eaf5543ea042"; // reused
const G_END_TS = "b2ba56b9-cdfe-4d3b-9f85-5d2e95add772"; // reused
const G_RES_TS = "ee5c36a3-f697-4f98-8f78-4331c5c7cc27"; // reused
const G_PARTIAL = "6dede0b0-7c0a-465c-938d-333099182ef7";
const PD_BACKLOG = "ce287f1a-44a1-4dc6-b858-74a94919140a";

// InheritanceRules.
const IR_AREA = "9f9ede48-ffaa-4ffb-85b8-81aa314d1021";
const IR_PARENT = "e9761329-2b48-449c-9453-e7d804102175";
const IR_ZONE = "0f8c1d14-9b30-4e1e-8111-d8a2b720c1d2";
const IR_RELATES = "2b9004cf-ca1d-4a68-9018-7d95993992fb";
const IR_DEADLINE = "563f5c90-b5db-4fe0-bca5-1c253938751d";
const IR_ESTIMATE = "b0817fa9-fbd7-45c3-9c5b-277a105b9d7f";
const IR_PREV = "6ebb59d0-3a0f-4deb-bc94-16ba51af2863";

// Property defs (label = plain prefix__local form — resolved by resolveLabelByUID).
const P_STATUS = "44c6e9e3-955f-4afc-9ca5-b4bd70667051";
const P_END_TS = "b36d6953-d66e-495d-86af-4be1008495cd";
const P_RES_TS = "6c5ea4a6-b592-40cb-9253-ea8f29ee0f56";
const P_PARTIAL = "e0da2778-a61f-4c6c-b899-5b1547beec0b";
const P_AREA = "9be36e9d-de67-4ed2-90b0-99cdf103e9bf";
const P_PARENT = "6528ecfa-a03d-47f1-a819-9ba5fea8fc28";
const P_ZONE = "9e82c952-0c6b-4528-bfab-61e0d5f1a2e7";
const P_RELATES = "e3a71d16-14b3-4aff-adf7-c9eccd1077b4";
const P_DEADLINE = "b2a403de-14ac-4e36-b3e4-1261810d7abd";
const P_ESTIMATE = "01d6e68e-6ff6-408f-85ef-36b1f8768a4d";
const P_UID = "fada7446-b0a4-4100-88f4-6d4421c175fb";
const P_PREV = "3104b383-90b2-41be-b561-995ac8001af7";
const TOKEN_NOWLOCAL = "8bc0c038-1fd1-4ad3-a4a4-178a64b492b8";
const CLS_SUBST_TOKEN = "660e7539-9ad3-4645-abef-e3c58120f1e0";

// Fixture-owned instances.
const TASK = "a1a1a1a1-1111-4111-8111-111111111111";
const T_AREA = "a2a2a2a2-2222-4222-8222-222222222222";
const T_PARENT = "a3a3a3a3-3333-4333-8333-333333333333";
const T_ZONE = "a4a4a4a4-4444-4444-8444-444444444444";
const T_RELATED = "a5a5a5a5-5555-4555-8555-555555555555";

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
    propDef(P_END_TS, "ems__Effort_endTimestamp"),
    propDef(P_RES_TS, "ems__Effort_resolutionTimestamp"),
    propDef(P_PARTIAL, "ems__Effort_partiallyDone"),
    propDef(P_AREA, "ems__Effort_area"),
    propDef(P_PARENT, "ems__Effort_parent"),
    propDef(P_ZONE, "ems__Task_zone"),
    propDef(P_RELATES, "exo__Asset_relates"),
    propDef(P_DEADLINE, "ems__Effort_deadlineTimestamp"),
    propDef(P_ESTIMATE, "ems__Effort_timeEstimateMinutes"),
    propDef(P_UID, "exo__Asset_uid"),
    propDef(P_PREV, "ems__Effort_prevIteration"),
    // ---- $nowLocal SubstitutionToken ----
    [
      `${DIR}/${TOKEN_NOWLOCAL}.md`,
      fm(
        `exo__Asset_uid: ${TOKEN_NOWLOCAL}`,
        'exo__Asset_label: "$nowLocal"',
        "exo__Instance_class:",
        `  - "[[${CLS_SUBST_TOKEN}]]"`,
      ),
    ],
    // ---- InheritanceRules ----
    inheritanceRule(IR_AREA, P_AREA, P_AREA),
    inheritanceRule(IR_PARENT, P_PARENT, P_PARENT),
    inheritanceRule(IR_ZONE, P_ZONE, P_ZONE),
    inheritanceRule(IR_RELATES, P_RELATES, P_RELATES),
    inheritanceRule(IR_DEADLINE, P_DEADLINE, P_DEADLINE),
    inheritanceRule(IR_ESTIMATE, P_ESTIMATE, P_ESTIMATE),
    inheritanceRule(IR_PREV, P_UID, P_PREV),
    // ---- PropertyDefault: status = Backlog ----
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
    // ---- create_instance grounding ----
    [
      `${DIR}/${G_CREATE}.md`,
      fm(
        `exo__Asset_uid: ${G_CREATE}`,
        'exo__Asset_label: "Create Partially Done next iteration"',
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
    // ---- reused close steps ----
    [
      `${DIR}/${G_STATUS_DONE}.md`,
      fm(
        `exo__Asset_uid: ${G_STATUS_DONE}`,
        'exo__Asset_label: "Set status to Done"',
        "exo__Instance_class:",
        '  - "[[exocmd__Grounding]]"',
        `exocmd__Grounding_type: "[[${GT_PROPERTY_SET}]]"`,
        `exocmd__Grounding_targetProperty: "[[${P_STATUS}]]"`,
        `exocmd__Grounding_targetValueRef: "[[${ENUM_DONE}]]"`,
      ),
    ],
    [
      `${DIR}/${G_END_TS}.md`,
      fm(
        `exo__Asset_uid: ${G_END_TS}`,
        'exo__Asset_label: "Set endTimestamp to now"',
        "exo__Instance_class:",
        '  - "[[exocmd__Grounding]]"',
        `exocmd__Grounding_type: "[[${GT_PROPERTY_SET}]]"`,
        `exocmd__Grounding_targetProperty: "[[${P_END_TS}]]"`,
        `exocmd__Grounding_targetValueSubstitution: "[[${TOKEN_NOWLOCAL}]]"`,
      ),
    ],
    [
      `${DIR}/${G_RES_TS}.md`,
      fm(
        `exo__Asset_uid: ${G_RES_TS}`,
        'exo__Asset_label: "Set resolutionTimestamp to now"',
        "exo__Instance_class:",
        '  - "[[exocmd__Grounding]]"',
        `exocmd__Grounding_type: "[[${GT_PROPERTY_SET}]]"`,
        `exocmd__Grounding_targetProperty: "[[${P_RES_TS}]]"`,
        `exocmd__Grounding_targetValueSubstitution: "[[${TOKEN_NOWLOCAL}]]"`,
      ),
    ],
    // ---- partiallyDone property_set ----
    [
      `${DIR}/${G_PARTIAL}.md`,
      fm(
        `exo__Asset_uid: ${G_PARTIAL}`,
        'exo__Asset_label: "Set partiallyDone true"',
        "exo__Instance_class:",
        '  - "[[exocmd__Grounding]]"',
        `exocmd__Grounding_type: "[[${GT_PROPERTY_SET}]]"`,
        "exocmd__Grounding_targetProperty: ems__Effort_partiallyDone",
        'exocmd__Grounding_targetValueLiteral: "true"',
      ),
    ],
    // ---- composite grounding ----
    [
      `${DIR}/${COMPOSITE}.md`,
      fm(
        `exo__Asset_uid: ${COMPOSITE}`,
        'exo__Asset_label: "Partially Done composite"',
        "exo__Instance_class:",
        '  - "[[exocmd__Grounding]]"',
        `exocmd__Grounding_type: "[[${GT_COMPOSITE}]]"`,
        "exocmd__Grounding_steps:",
        `  - "[[${G_CREATE}]]"`,
        `  - "[[${G_STATUS_DONE}]]"`,
        `  - "[[${G_END_TS}]]"`,
        `  - "[[${G_RES_TS}]]"`,
        `  - "[[${G_PARTIAL}]]"`,
      ),
    ],
    // ---- precondition (reused: Doing + not-prototype) ----
    [
      `${DIR}/${PRECOND}.md`,
      [
        "---",
        `exo__Asset_uid: ${PRECOND}`,
        'exo__Asset_label: "Allow transition to Done (from Doing)"',
        "exo__Instance_class:",
        '  - "[[exocmd__AtomicPrecondition]]"',
        "exocmd__Precondition_sparqlAsk: >",
        "  PREFIX ems: <https://exocortex.my/ontology/ems#>",
        "  ASK { FILTER NOT EXISTS { $target <https://exocortex.my/ontology/exo#Instance_class> ?protoMarkerClass . FILTER(STRENDS(STR(?protoMarkerClass), \"Prototype\")) }",
        "    $target ems:Effort_status ?s .",
        "    FILTER(?s IN (",
        "      <https://exocortex.my/ontology/ems#EffortStatusDoing>",
        "    ))",
        "  }",
        "---",
        "",
      ].join("\n"),
    ],
    // ---- command + binding ----
    [
      `${DIR}/${CMD}.md`,
      fm(
        `exo__Asset_uid: ${CMD}`,
        'exo__Asset_label: "Partially Done"',
        "exo__Instance_class:",
        '  - "[[exocmd__Command]]"',
        `exocmd__Command_grounding: "[[${COMPOSITE}]]"`,
        `exocmd__Command_precondition: "[[${PRECOND}]]"`,
        "exocmd__Command_cliName: partially-done",
        "exocmd__Command_category: status",
      ),
    ],
    [
      `${DIR}/${BINDING}.md`,
      fm(
        `exo__Asset_uid: ${BINDING}`,
        'exo__Asset_label: "Partially Done binding"',
        "exo__Instance_class:",
        '  - "[[exocmd__CommandBinding]]"',
        `exocmd__CommandBinding_command: "[[${CMD}]]"`,
        'exocmd__CommandBinding_targetClass: "ems__Task"',
        'exocmd__CommandBinding_position: "inline"',
      ),
    ],
    // ---- the Doing click-target task (with substantive properties + body) ----
    [
      `${DIR}/${TASK}.md`,
      [
        "---",
        `exo__Asset_uid: ${TASK}`,
        'exo__Asset_isDefinedBy: "[[!kitelev]]"',
        "exo__Instance_class:",
        `  - "[[${CLS_TASK}]]"`,
        'exo__Asset_label: "Write the report"',
        `ems__Effort_status: "[[${ENUM_DOING}|ems__EffortStatusDoing]]"`,
        "ems__Effort_startTimestamp: 2026-07-05T09:00:00",
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
  ];
  for (const [path, content] of files) {
    await fs.createFile(path, content);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const TASK_PATH = `${DIR}/${TASK}.md`;
const TASK_IRI = `obsidian://vault/${TASK_PATH}`;

describe("Integration (req 87361a62): ems__Task «Partially Done» composite", () => {
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

  it("@req:87361a62-76a3-4ba9-b008-432838743800 closes the Doing task done-but-partial AND spawns a Backlog next iteration copying its properties", async () => {
    const command = await resolver.loadCommand(CMD);
    expect(command).not.toBeNull();
    // The grounding is the 5-step composite.
    expect(command!.grounding.type).toBe("composite");
    expect(command!.grounding.steps).toHaveLength(5);

    const executor = new GroundingExecutor(fs, fs, new ServiceRegistry());
    const result = await executor.execute(command!.grounding, TASK_IRI, TASK_PATH);
    expect(result.success).toBe(true);

    // -- ORIGINAL task: closed done-but-partial --
    const original = fs.getContent(TASK_PATH)!;
    expect(original).toContain(`ems__Effort_status: "[[${ENUM_DONE}]]"`);
    expect(original).toContain("ems__Effort_partiallyDone: true");
    expect(original).toMatch(/ems__Effort_endTimestamp: \d{4}-\d{2}-\d{2}T/);
    expect(original).toMatch(/ems__Effort_resolutionTimestamp: \d{4}-\d{2}-\d{2}T/);
    // startTimestamp preserved (not wiped).
    expect(original).toContain("ems__Effort_startTimestamp: 2026-07-05T09:00:00");

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
    expect(next).toContain(`ems__Effort_prevIteration: "[[${TASK}]]"`);
    // fresh uid (NOT the original's).
    expect(next).not.toContain(`exo__Asset_uid: ${TASK}`);

    // Deliberately NOT inherited: partiallyDone flag + execution timestamps.
    expect(next).not.toContain("ems__Effort_partiallyDone");
    expect(next).not.toContain("ems__Effort_startTimestamp");
    expect(next).not.toContain("ems__Effort_endTimestamp");
    expect(next).not.toContain("ems__Effort_resolutionTimestamp");
  });

  it("@req:87361a62-76a3-4ba9-b008-432838743800 is offered on a Doing task (binding ∩ precondition)", async () => {
    const resolved = await resolver.resolveForAssetMulti(
      TASK_IRI,
      ["ems__Task"],
      undefined,
    );
    const names = resolved.map((r) => r.command.name);
    expect(names).toContain("Partially Done");
  });
});

/** A freshly created instance file (uuid-named, not one of the seeded fixtures). */
function isFreshInstance(path: string): boolean {
  const base = path.split("/").pop()!.replace(".md", "");
  const seeded = new Set([
    TASK, T_AREA, T_PARENT, T_ZONE, T_RELATED, CMD, BINDING, PRECOND, COMPOSITE,
    G_CREATE, G_STATUS_DONE, G_END_TS, G_RES_TS, G_PARTIAL, PD_BACKLOG,
    IR_AREA, IR_PARENT, IR_ZONE, IR_RELATES, IR_DEADLINE, IR_ESTIMATE, IR_PREV,
    P_STATUS, P_END_TS, P_RES_TS, P_PARTIAL, P_AREA, P_PARENT, P_ZONE, P_RELATES,
    P_DEADLINE, P_ESTIMATE, P_UID, P_PREV, TOKEN_NOWLOCAL, CLS_TASK,
    ENUM_DOING, ENUM_DONE, ENUM_BACKLOG,
  ]);
  return !seeded.has(base);
}
