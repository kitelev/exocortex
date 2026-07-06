/**
 * Integration test (req f1fbea08): an archived ems__Task shows ONLY the
 * «Un-archive» command — every other task-bound command is hidden by a reusable
 * «Not archived» precondition conjunct AND-ed (via an AllPrecondition wrapper)
 * into that command's precondition.
 *
 * Production-shape: the commands + preconditions (the AllPrecondition wrapper,
 * the reusable «Not archived» AtomicPrecondition, the wrapped status atomic,
 * the archived-only atomic) + bindings + an archived / an active ems__Task are
 * authored as MARKDOWN and run through the REAL
 * `NoteToRDFConverter.convertVault()` → `CommandResolver.loadCommand()` /
 * `resolveForAssetMulti()` → `PreconditionEvaluator.evaluate()` pipeline — the
 * exact path the CLI `resolve-buttons` oracle and the Obsidian inline buttons
 * both take (test-fixture-realism: no hand-injected triples).
 *
 * @req:f1fbea08-f08f-4605-9c41-bf20c90b395f
 *
 * Behaviour asserted (req Gherkin):
 *  - the archived-guard AllPrecondition wrapper evaluates FALSE on an archived
 *    task (Done + `archived "true"`) and TRUE on a non-archived Done task —
 *    so a gated command (here «Re-open», a Done-visible command) is hidden on
 *    the archived task and unchanged on the active one;
 *  - «Un-archive» (deliberately NOT gated) stays visible on the archived task;
 *  - the resolved visible command-set on an archived task is exactly
 *    {«Un-archive»}.
 *
 * Design note (homoiconic, zero engine code): the archived-guard is a single
 * reusable AtomicPrecondition `ASK { FILTER NOT EXISTS { $target
 * exo:Asset_archived "true" } }`, added as one conjunct of a per-command
 * `AllPrecondition` wrapper. In production it gates nine task commands (Create
 * Action, Create Related Task, Convert to Project, Re-open, Clean Properties,
 * Copy Label to Aliases, Repair Folder, Fix Missing Label, Rename to UID). This
 * test exercises the mechanism through «Re-open» (a status-gated command) as the
 * representative gated exemplar plus «Un-archive» as the ungated one. The full
 * nine-command aggregate `{Un-archive}`-only end-state is verified via the real
 * CLI `resolve-buttons` on the live vault (see PR body).
 *
 * REVERT-VERIFY (integration-test-revert-verify rule): the 4th test removes the
 * «Not archived» conjunct from the wrapper (the reverted state) → «Re-open»
 * becomes visible again on the archived task (RED), proving the guard is
 * load-bearing. Empirically verified GREEN with the guard / RED without it (see
 * PR body); also end-to-end verified via `resolve-buttons` on the live vault
 * (archived task = {Un-archive} only; Done/Doing unchanged).
 */

import "reflect-metadata";
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
// In-memory fs + vault adapter (mirrors unarchive-grounding.integration)
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

const CLS_TASK = "1b20a8f0-d745-4e93-91db-4531b3df120e";
const ENUM_DONE = "7b9b3116-7c3c-438c-9618-94fe301320a6";

// The reusable archived-guard atomic (my authored asset, exoas-exocmd).
const NOT_ARCHIVED = "28f722ba-cd01-44c6-b69d-b1c59b0e14fd";

// «Re-open» chain — the representative gated command.
const REOPEN_CMD = "96321da8-728f-483b-82ef-db1d7376691e";
const REOPEN_BINDING = "9c8894b4-4691-4398-b85c-056496f2886a";
const REOPEN_WRAPPER = "ca0d7bde-8913-47a2-ac11-f460c5a89a44"; // AllPrecondition[status, NotArchived]
const REOPEN_ATOMIC = "2bee97b7-da01-4309-925b-f605e7816ba1"; // "Allow re-open (when status = Done)"
const REOPEN_GROUNDING = "7eb97e7d-dff7-4bd1-a14d-a9509352bb7a";

// «Un-archive» chain — the ungated command that must remain visible.
const UNARCH_CMD = "59aaf685-d404-4702-9857-075bf27ed088";
const UNARCH_BINDING = "aab754fb-a1df-4f3e-9298-8451c20aae47";
const UNARCH_PRECOND = "008c6d16-e7aa-44f9-bff3-7406c4aafa45"; // archived-only ASK
const UNARCH_GROUNDING = "ec4b6e20-9d82-4053-85e0-b8bdea94fd79";
const GT_PROPERTY_DELETE = "4bdf1d0b-e9da-4d96-bafe-c5aaef8c2bd5";

// Fixture-owned instances.
const ARCHIVED_TASK = "c1c1c1c1-1111-4111-8111-111111111111";
const ACTIVE_TASK = "c2c2c2c2-2222-4222-8222-222222222222";

const DIR = "assetspaces/my";

// The wrapped status atomic ASK (flattened single-line — naive parser).
const REOPEN_STATUS_ASK =
  'PREFIX ems: <https://exocortex.my/ontology/ems#> ASK { FILTER NOT EXISTS { $target <https://exocortex.my/ontology/exo#Instance_class> ?protoMarkerClass . FILTER(STRENDS(STR(?protoMarkerClass), "Prototype")) } $target ems:Effort_status ?s . FILTER(?s IN ( <https://exocortex.my/ontology/ems#EffortStatusDone> )) }';
const NOT_ARCHIVED_ASK =
  'PREFIX exo: <https://exocortex.my/ontology/exo#> ASK { FILTER NOT EXISTS { $target exo:Asset_archived "true" } }';
const ARCHIVED_ONLY_ASK =
  'PREFIX exo: <https://exocortex.my/ontology/exo#> ASK { $target exo:Asset_archived "true" }';

function fm(...lines: string[]): string {
  return ["---", ...lines, "---", ""].join("\n");
}

/**
 * @param gated when true the Re-open wrapper ANDs [status, NotArchived] (the
 *   shipped state); when false it wraps [status] only (the reverted state — the
 *   archived-guard removed) for the revert-verify test.
 */
async function seedVault(
  fs: InMemoryFileSystem,
  gated: boolean,
): Promise<void> {
  const reopenWrapperChildren = gated
    ? `  - "[[${REOPEN_ATOMIC}]]"\n  - "[[${NOT_ARCHIVED}]]"`
    : `  - "[[${REOPEN_ATOMIC}]]"`;

  const files: Array<[string, string]> = [
    // ---- Class def + Done enum (label → symbolic IRI resolution) ----
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
      fm(
        `exo__Asset_uid: ${ENUM_DONE}`,
        "exo__Asset_label: ems__EffortStatusDone",
      ),
    ],
    // ---- reusable «Not archived» AtomicPrecondition ----
    [
      `${DIR}/${NOT_ARCHIVED}.md`,
      fm(
        `exo__Asset_uid: ${NOT_ARCHIVED}`,
        'exo__Asset_label: "Not archived"',
        "exo__Instance_class:",
        '  - "[[exocmd__AtomicPrecondition]]"',
        `exocmd__Precondition_sparqlAsk: ${NOT_ARCHIVED_ASK}`,
      ),
    ],
    // ---- Re-open wrapped status atomic ----
    [
      `${DIR}/${REOPEN_ATOMIC}.md`,
      fm(
        `exo__Asset_uid: ${REOPEN_ATOMIC}`,
        'exo__Asset_label: "Allow re-open (when status = Done)"',
        "exo__Instance_class:",
        '  - "[[exocmd__AtomicPrecondition]]"',
        `exocmd__Precondition_sparqlAsk: ${REOPEN_STATUS_ASK}`,
      ),
    ],
    // ---- Re-open AllPrecondition wrapper [status, NotArchived] ----
    [
      `${DIR}/${REOPEN_WRAPPER}.md`,
      fm(
        `exo__Asset_uid: ${REOPEN_WRAPPER}`,
        'exo__Asset_label: "Allow re-open (when status = Done) and not archived"',
        "exo__Instance_class:",
        '  - "[[exocmd__AllPrecondition]]"',
        "exocmd__AllPrecondition_preconditions:",
        reopenWrapperChildren,
      ),
    ],
    // ---- Re-open grounding (placeholder property_delete — not executed in a visibility test) ----
    [
      `${DIR}/${REOPEN_GROUNDING}.md`,
      fm(
        `exo__Asset_uid: ${REOPEN_GROUNDING}`,
        'exo__Asset_label: "Re-open grounding"',
        "exo__Instance_class:",
        '  - "[[exocmd__Grounding]]"',
        `exocmd__Grounding_type: "[[${GT_PROPERTY_DELETE}]]"`,
        "exocmd__Grounding_targetProperty: ems__Effort_endTimestamp",
      ),
    ],
    // ---- Re-open command (precondition → the wrapper) + binding ----
    [
      `${DIR}/${REOPEN_CMD}.md`,
      fm(
        `exo__Asset_uid: ${REOPEN_CMD}`,
        'exo__Asset_label: "Re-open"',
        "exo__Instance_class:",
        '  - "[[exocmd__Command]]"',
        `exocmd__Command_grounding: "[[${REOPEN_GROUNDING}]]"`,
        `exocmd__Command_precondition: "[[${REOPEN_WRAPPER}]]"`,
        "exocmd__Command_category: status",
      ),
    ],
    [
      `${DIR}/${REOPEN_BINDING}.md`,
      fm(
        `exo__Asset_uid: ${REOPEN_BINDING}`,
        'exo__Asset_label: "Re-open → Task binding"',
        "exo__Instance_class:",
        '  - "[[exocmd__CommandBinding]]"',
        `exocmd__CommandBinding_command: "[[${REOPEN_CMD}]]"`,
        'exocmd__CommandBinding_targetClass: "ems__Task"',
        'exocmd__CommandBinding_position: "inline"',
      ),
    ],
    // ---- «Un-archive» archived-only precondition ----
    [
      `${DIR}/${UNARCH_PRECOND}.md`,
      fm(
        `exo__Asset_uid: ${UNARCH_PRECOND}`,
        'exo__Asset_label: "Visible only when the task is archived"',
        "exo__Instance_class:",
        '  - "[[exocmd__AtomicPrecondition]]"',
        `exocmd__Precondition_sparqlAsk: ${ARCHIVED_ONLY_ASK}`,
      ),
    ],
    // ---- «Un-archive» grounding (property_delete of `archived`) ----
    [
      `${DIR}/${UNARCH_GROUNDING}.md`,
      fm(
        `exo__Asset_uid: ${UNARCH_GROUNDING}`,
        'exo__Asset_label: "Un-archive: remove the archived flag"',
        "exo__Instance_class:",
        '  - "[[exocmd__Grounding]]"',
        `exocmd__Grounding_type: "[[${GT_PROPERTY_DELETE}]]"`,
        "exocmd__Grounding_targetProperty: archived",
      ),
    ],
    // ---- «Un-archive» command (NOT gated) + binding ----
    [
      `${DIR}/${UNARCH_CMD}.md`,
      fm(
        `exo__Asset_uid: ${UNARCH_CMD}`,
        'exo__Asset_label: "Un-archive"',
        "exo__Instance_class:",
        '  - "[[exocmd__Command]]"',
        `exocmd__Command_grounding: "[[${UNARCH_GROUNDING}]]"`,
        `exocmd__Command_precondition: "[[${UNARCH_PRECOND}]]"`,
        "exocmd__Command_cliName: un-archive",
        "exocmd__Command_category: status",
      ),
    ],
    [
      `${DIR}/${UNARCH_BINDING}.md`,
      fm(
        `exo__Asset_uid: ${UNARCH_BINDING}`,
        'exo__Asset_label: "Un-archive → Task binding"',
        "exo__Instance_class:",
        '  - "[[exocmd__CommandBinding]]"',
        `exocmd__CommandBinding_command: "[[${UNARCH_CMD}]]"`,
        'exocmd__CommandBinding_targetClass: "ems__Task"',
        'exocmd__CommandBinding_position: "inline"',
      ),
    ],
    // ---- ARCHIVED ems__Task (Done + archived flag set in place) ----
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
    // ---- ACTIVE Done ems__Task (no archived flag) ----
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
// Helpers
// ---------------------------------------------------------------------------

const ARCHIVED_IRI = `obsidian://vault/${DIR}/${ARCHIVED_TASK}.md`;
const ACTIVE_IRI = `obsidian://vault/${DIR}/${ACTIVE_TASK}.md`;

async function buildResolver(
  gated: boolean,
): Promise<{ resolver: CommandResolver; evaluator: PreconditionEvaluator }> {
  installDefaultResolvers();
  const fs = new InMemoryFileSystem();
  await seedVault(fs, gated);
  const converter = new NoteToRDFConverter(new InMemoryVaultAdapter(fs));
  const store = new InMemoryTripleStore();
  await store.addAll(await converter.convertVault());
  return {
    resolver: new CommandResolver(store),
    evaluator: new PreconditionEvaluator(store),
  };
}

/** The visible command names for a target = binding-match ∩ precondition-true. */
async function visibleCommandNames(
  resolver: CommandResolver,
  evaluator: PreconditionEvaluator,
  iri: string,
): Promise<string[]> {
  const resolved = await resolver.resolveForAssetMulti(
    iri,
    ["ems__Task"],
    undefined,
  );
  const visible: string[] = [];
  for (const r of resolved) {
    const precond = r.command.precondition;
    const ok = precond ? await evaluator.evaluate(precond, iri) : true;
    if (ok) visible.push(r.command.name);
  }
  return visible;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Integration (req f1fbea08): archived ems__Task shows only «Un-archive»", () => {
  it("@req:f1fbea08-f08f-4605-9c41-bf20c90b395f archived-guard hides a gated command on an archived task, keeps it on an active Done task", async () => {
    const { resolver, evaluator } = await buildResolver(true);
    const reopen = await resolver.loadCommand(REOPEN_CMD);
    expect(reopen).not.toBeNull();
    expect(reopen!.precondition).toBeDefined();

    // The wrapper (status AND not-archived) is FALSE on the archived task…
    expect(await evaluator.evaluate(reopen!.precondition, ARCHIVED_IRI)).toBe(
      false,
    );
    // …and TRUE on the active Done task (status Done, not archived).
    expect(await evaluator.evaluate(reopen!.precondition, ACTIVE_IRI)).toBe(
      true,
    );
  });

  it("@req:f1fbea08-f08f-4605-9c41-bf20c90b395f «Un-archive» (ungated) stays visible on the archived task", async () => {
    const { resolver, evaluator } = await buildResolver(true);
    const unarch = await resolver.loadCommand(UNARCH_CMD);
    expect(unarch).not.toBeNull();
    expect(unarch!.precondition).toBeDefined();

    // Archived-only precondition is TRUE on the archived task…
    expect(await evaluator.evaluate(unarch!.precondition, ARCHIVED_IRI)).toBe(
      true,
    );
    // …and FALSE on the active task (so «Un-archive» never leaks onto active tasks).
    expect(await evaluator.evaluate(unarch!.precondition, ACTIVE_IRI)).toBe(
      false,
    );
  });

  it("@req:f1fbea08-f08f-4605-9c41-bf20c90b395f the archived task's visible command-set is exactly {«Un-archive»}", async () => {
    const { resolver, evaluator } = await buildResolver(true);
    const visible = await visibleCommandNames(
      resolver,
      evaluator,
      ARCHIVED_IRI,
    );
    expect(visible.sort()).toEqual(["Un-archive"]);
    expect(visible).not.toContain("Re-open");

    // Sanity: on the active Done task the gated command IS visible (no regression).
    const active = await visibleCommandNames(resolver, evaluator, ACTIVE_IRI);
    expect(active).toContain("Re-open");
    expect(active).not.toContain("Un-archive");
  });

  it("@req:f1fbea08-f08f-4605-9c41-bf20c90b395f REVERT-VERIFY: without the «Not archived» conjunct the gated command re-appears on the archived task", async () => {
    // Reverted state: the wrapper wraps [status] only (archived-guard removed).
    const { resolver, evaluator } = await buildResolver(false);
    const reopen = await resolver.loadCommand(REOPEN_CMD);
    expect(reopen).not.toBeNull();

    // The guard is gone → Re-open's precondition is now TRUE on the archived task…
    expect(await evaluator.evaluate(reopen!.precondition, ARCHIVED_IRI)).toBe(
      true,
    );
    // …so the archived task's visible set leaks «Re-open» (this is the RED the
    // shipped guard turns GREEN).
    const visible = await visibleCommandNames(
      resolver,
      evaluator,
      ARCHIVED_IRI,
    );
    expect(visible).toContain("Re-open");
  });
});
