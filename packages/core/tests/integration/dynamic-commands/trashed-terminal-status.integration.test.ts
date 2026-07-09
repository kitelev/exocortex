/**
 * Integration test (req 127763f8): Trashed is a SECOND terminal status equal to
 * Done.
 *
 *  - ARCHIVABILITY: «Archive Completed» becomes available on a Trashed (not yet
 *    archived) task — its gate widens from «Is Done and not archived» (8762ddc2)
 *    to `AllPrecondition[«Is terminal (Done or Trashed)» 9b85e89a, «Not archived»
 *    28f722ba]` (7a055a10). Behavior-preserving on a Done task (still archivable).
 *  - ACTIVE-WORK HIDING: every command that is meaningless on a finished effort —
 *    modelled here by «Plan on Today» (shares the composite c57642c4) and «Create
 *    Action» (the wrap-the-wrapper utility gate) — is hidden on Trashed exactly
 *    like on Done. The «Visible until Done» conjunct (37517554) is replaced by the
 *    «Visible until terminal» NotPrecondition (067e481d = Not[«Is terminal»]).
 *    c57642c4 is edited in place; the utility command is repointed to a new
 *    per-command wrapper that NESTS its shipped utility-gate composite (99da8e4b)
 *    AND «Visible until terminal» — the utility-gate composite is NOT mutated
 *    (wrap-the-wrapper, 3-level nesting exercised end-to-end).
 *  - «Un-archive» (archived-only, ungated) is unchanged: a Trashed + archived task
 *    shows ONLY «Un-archive».
 *
 * Production-shape (test-fixture-realism): the commands + preconditions (the new
 * «Is terminal» atomic, its «Visible until terminal» NotPrecondition, the
 * AllPrecondition composites, the wrap-the-wrapper, the reverted 8762ddc2 /
 * 37517554 atomics) + bindings + a Backlog / a Done / a Trashed / a Trashed+archived
 * ems__Task are authored as MARKDOWN and run through the REAL
 * `NoteToRDFConverter.convertVault()` → `CommandResolver.loadCommand()` /
 * `resolveForAssetMulti()` → `PreconditionEvaluator.evaluate()` pipeline — the exact
 * path the CLI `resolve-buttons` oracle and the Obsidian inline buttons both take
 * (no hand-injected triples).
 *
 * @req:127763f8-b97d-472f-872d-7c21ecdaacf6
 *
 * REVERT-VERIFY (integration-test-revert-verify rule): the `gated=false` seeding
 * reverts each command/composite to its pre-req state (Archive → «Is Done and not
 * archived» 8762ddc2; c57642c4 → [«Visible until Done» 37517554, not-a-prototype];
 * Create Action → its utility-gate composite 99da8e4b WITHOUT the «Visible until
 * terminal» wrapper). Reverted: «Archive Completed» disappears from the Trashed
 * task (RED) and «Plan on Today» / «Create Action» re-appear on the Trashed task
 * (RED). The shipped `gated=true` state turns all three GREEN. The full status ×
 * archived matrix is additionally verified end-to-end via the CLI `resolve-buttons`
 * oracle on the live vault (see PR body).
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
// In-memory fs + vault adapter (mirrors archived-gate / utility-status-gates)
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
// Fixture UIDs — the REAL production asset UIDs (exoas-exocmd) for shared assets.
// ---------------------------------------------------------------------------

const CLS_TASK = "1b20a8f0-d745-4e93-91db-4531b3df120e";
const ENUM_DONE = "7b9b3116-7c3c-438c-9618-94fe301320a6";
const ENUM_TRASHED = "5d14f18d-db2b-4847-9ac1-144cb93b2541";
const ENUM_BACKLOG = "753a44d5-846c-4b82-9196-4fd9a4d48777";
const GT_PROPERTY_DELETE = "4bdf1d0b-e9da-4d96-bafe-c5aaef8c2bd5";

// Reusable atomics (real UIDs).
const IS_TERMINAL = "9b85e89a-8162-492f-b85f-2f8a1f21dded"; // NEW — Done ∪ Trashed
const NOT_ARCHIVED = "28f722ba-cd01-44c6-b69d-b1c59b0e14fd";
const VISIBLE_UNTIL_DONE = "37517554-8308-4b38-9841-a9b1619ae092"; // reverted-state atomic
const NOT_PROTO = "5b49ef19-7eb9-4b67-bb4e-c9002537000b"; // modelled as atomic (orthogonal to terminal)
const IS_DONE_NOT_ARCHIVED = "8762ddc2-ce04-485a-adb8-bcb093283c9f"; // reverted Archive gate

// NEW composites/negation (real UIDs).
const VISIBLE_UNTIL_TERMINAL = "067e481d-ba2e-4022-a4ec-9e7741a0b7af"; // NotPrecondition[IS_TERMINAL]
const A_TERMINAL = "7a055a10-e17d-434a-9a2d-8f7c0ba13a4e"; // AllPrecondition[IS_TERMINAL, NOT_ARCHIVED]
const C57642C4 = "c57642c4-28be-45af-b37b-bb42d0e46c7c"; // Execute/planning composite (edited in place)

// Utility (Create Action) wrap-the-wrapper chain (real UIDs).
const CA_INNER = "6dd007b8-c4e8-4159-a496-e2383e7e0476"; // [NOT_PROTO, NOT_ARCHIVED] (req f1fbea08)
const CA_UTILITY = "99da8e4b-fce9-4e9f-bbe2-53cd1b0c7645"; // [CA_INNER, VISIBLE_UNTIL_DONE] (req f6c2b98c, unchanged)
const CA_WRAPPER = "365095bc-0980-4360-bcfb-742abfba3c15"; // NEW [CA_UTILITY, VISIBLE_UNTIL_TERMINAL]

// «Un-archive» (real UIDs) — ungated, archived-only.
const UNARCH_PRECOND = "008c6d16-e7aa-44f9-bff3-7406c4aafa45";

// Commands (real UIDs).
const ARCHIVE_CMD = "52c88678-7721-4583-b254-20670cccb1ff";
const PLAN_CMD = "98660cd8-0000-4000-8000-000000000001"; // fixture stand-in for Plan on Today
const CREATE_ACTION_CMD = "48a70029-8485-4969-a050-4f4f21289c08";
const UNARCH_CMD = "e2e2e2e2-1111-4111-8111-111111111111";

// Fixture-owned bindings + grounding.
const ARCHIVE_BINDING = "b1b1b1b1-1111-4111-8111-111111111111";
const PLAN_BINDING = "b2b2b2b2-2222-4222-8222-222222222222";
const CA_BINDING = "b3b3b3b3-3333-4333-8333-333333333333";
const UNARCH_BINDING = "b4b4b4b4-4444-4444-8444-444444444444";
const SHARED_GROUNDING = "b5b5b5b5-5555-4555-8555-555555555555";

// Fixture-owned tasks.
const BACKLOG_TASK = "d1d1d1d1-1111-4111-8111-111111111111";
const DONE_TASK = "d2d2d2d2-2222-4222-8222-222222222222";
const TRASHED_TASK = "d3d3d3d3-3333-4333-8333-333333333333";
const TRASHED_ARCHIVED_TASK = "d4d4d4d4-4444-4444-8444-444444444444";

const DIR = "assetspaces/my";

// Flattened single-line ASKs (naive fixture parser can't read block scalars).
const IS_TERMINAL_ASK =
  'PREFIX ems: <https://exocortex.my/ontology/ems#> ASK { { $target ems:Effort_status <https://exocortex.my/ontology/ems#EffortStatusDone> } UNION { $target ems:Effort_status <https://exocortex.my/ontology/ems#EffortStatusTrashed> } }';
const VISIBLE_UNTIL_DONE_ASK =
  'PREFIX ems: <https://exocortex.my/ontology/ems#> ASK { FILTER NOT EXISTS { $target ems:Effort_status <https://exocortex.my/ontology/ems#EffortStatusDone> } }';
const NOT_ARCHIVED_ASK =
  'PREFIX exo: <https://exocortex.my/ontology/exo#> ASK { FILTER NOT EXISTS { $target exo:Asset_archived "true" } }';
const ARCHIVED_ONLY_ASK =
  'PREFIX exo: <https://exocortex.my/ontology/exo#> ASK { $target exo:Asset_archived "true" }';
const NOT_PROTO_ASK =
  'PREFIX exo: <https://exocortex.my/ontology/exo#> ASK { FILTER NOT EXISTS { $target exo:Instance_class ?protoMarkerClass . FILTER(STRENDS(STR(?protoMarkerClass), "Prototype")) } }';
const IS_DONE_NOT_ARCHIVED_ASK =
  'PREFIX ems: <https://exocortex.my/ontology/ems#> PREFIX exo: <https://exocortex.my/ontology/exo#> ASK { $target ems:Effort_status <https://exocortex.my/ontology/ems#EffortStatusDone> . FILTER NOT EXISTS { $target exo:Asset_archived "true" } }';

function fm(...lines: string[]): string {
  return ["---", ...lines, "---", ""].join("\n");
}

function atomic(uid: string, label: string, ask: string): [string, string] {
  return [
    `${DIR}/${uid}.md`,
    fm(
      `exo__Asset_uid: ${uid}`,
      `exo__Asset_label: "${label}"`,
      "exo__Instance_class:",
      '  - "[[exocmd__AtomicPrecondition]]"',
      `exocmd__Precondition_sparqlAsk: ${ask}`,
    ),
  ];
}

function notPrecond(uid: string, label: string, child: string): [string, string] {
  return [
    `${DIR}/${uid}.md`,
    fm(
      `exo__Asset_uid: ${uid}`,
      `exo__Asset_label: "${label}"`,
      "exo__Instance_class:",
      '  - "[[exocmd__NotPrecondition]]"',
      `exocmd__NotPrecondition_precondition: "[[${child}]]"`,
    ),
  ];
}

function allPrecond(uid: string, label: string, ...children: string[]): [string, string] {
  return [
    `${DIR}/${uid}.md`,
    fm(
      `exo__Asset_uid: ${uid}`,
      `exo__Asset_label: "${label}"`,
      "exo__Instance_class:",
      '  - "[[exocmd__AllPrecondition]]"',
      "exocmd__AllPrecondition_preconditions:",
      ...children.map((c) => `  - "[[${c}]]"`),
    ),
  ];
}

function grounding(uid: string): [string, string] {
  return [
    `${DIR}/${uid}.md`,
    fm(
      `exo__Asset_uid: ${uid}`,
      'exo__Asset_label: "placeholder grounding"',
      "exo__Instance_class:",
      '  - "[[exocmd__Grounding]]"',
      `exocmd__Grounding_type: "[[${GT_PROPERTY_DELETE}]]"`,
      "exocmd__Grounding_targetProperty: ems__Effort_endTimestamp",
    ),
  ];
}

function command(uid: string, label: string, precond: string): [string, string] {
  return [
    `${DIR}/${uid}.md`,
    fm(
      `exo__Asset_uid: ${uid}`,
      `exo__Asset_label: "${label}"`,
      "exo__Instance_class:",
      '  - "[[exocmd__Command]]"',
      `exocmd__Command_grounding: "[[${SHARED_GROUNDING}]]"`,
      `exocmd__Command_precondition: "[[${precond}]]"`,
      "exocmd__Command_category: status",
    ),
  ];
}

function binding(uid: string, cmd: string): [string, string] {
  return [
    `${DIR}/${uid}.md`,
    fm(
      `exo__Asset_uid: ${uid}`,
      'exo__Asset_label: "binding"',
      "exo__Instance_class:",
      '  - "[[exocmd__CommandBinding]]"',
      `exocmd__CommandBinding_command: "[[${cmd}]]"`,
      'exocmd__CommandBinding_targetClass: "ems__Task"',
      'exocmd__CommandBinding_position: "inline"',
    ),
  ];
}

function task(
  uid: string,
  label: string,
  statusUid: string,
  statusLabel: string,
  archived = false,
): [string, string] {
  const lines = [
    "---",
    `exo__Asset_uid: ${uid}`,
    'exo__Asset_isDefinedBy: "[[!kitelev]]"',
    "exo__Instance_class:",
    `  - "[[${CLS_TASK}]]"`,
    `exo__Asset_label: "${label}"`,
    `ems__Effort_status: "[[${statusUid}|${statusLabel}]]"`,
  ];
  if (archived) lines.push("archived: true");
  lines.push("---", "", "Body notes.");
  return [`${DIR}/${uid}.md`, lines.join("\n")];
}

/**
 * @param gated when true each command/composite is in the shipped (req 127763f8)
 *   state: «Archive Completed» → A_TERMINAL; c57642c4 → [«Visible until terminal»,
 *   not-proto, not-archived]; «Create Action» → CA_WRAPPER (nests utility gate +
 *   «Visible until terminal»). When false each is reverted to its pre-req state:
 *   «Archive Completed» → «Is Done and not archived» (8762ddc2); c57642c4 →
 *   [«Visible until Done» 37517554, not-proto]; «Create Action» → CA_UTILITY (the
 *   utility gate WITHOUT the terminal wrapper).
 */
async function seedVault(fs: InMemoryFileSystem, gated: boolean): Promise<void> {
  const archivePrecond = gated ? A_TERMINAL : IS_DONE_NOT_ARCHIVED;
  const caPrecond = gated ? CA_WRAPPER : CA_UTILITY;
  // c57642c4 is edited in place — its CHILDREN differ per gated state.
  const c57Children = gated
    ? [VISIBLE_UNTIL_TERMINAL, NOT_PROTO, NOT_ARCHIVED]
    : [VISIBLE_UNTIL_DONE, NOT_PROTO];

  const files: Array<[string, string]> = [
    // ---- Class def + status enums (label → symbolic IRI resolution) ----
    [
      `${DIR}/${CLS_TASK}.md`,
      fm(
        `exo__Asset_uid: ${CLS_TASK}`,
        "exo__Asset_label: ems__Task",
        'exo__Instance_class:\n  - "[[exo__Class]]"',
      ),
    ],
    [`${DIR}/${ENUM_DONE}.md`, fm(`exo__Asset_uid: ${ENUM_DONE}`, "exo__Asset_label: ems__EffortStatusDone")],
    [`${DIR}/${ENUM_TRASHED}.md`, fm(`exo__Asset_uid: ${ENUM_TRASHED}`, "exo__Asset_label: ems__EffortStatusTrashed")],
    [`${DIR}/${ENUM_BACKLOG}.md`, fm(`exo__Asset_uid: ${ENUM_BACKLOG}`, "exo__Asset_label: ems__EffortStatusBacklog")],

    // ---- Reusable atomics ----
    atomic(IS_TERMINAL, "Is terminal status (Done or Trashed)", IS_TERMINAL_ASK),
    atomic(NOT_ARCHIVED, "Not archived", NOT_ARCHIVED_ASK),
    atomic(VISIBLE_UNTIL_DONE, "Visible until Done", VISIBLE_UNTIL_DONE_ASK),
    atomic(NOT_PROTO, "Not a prototype", NOT_PROTO_ASK),
    atomic(IS_DONE_NOT_ARCHIVED, "Is Done and not archived", IS_DONE_NOT_ARCHIVED_ASK),
    atomic(UNARCH_PRECOND, "Visible only when the task is archived", ARCHIVED_ONLY_ASK),

    // ---- «Is terminal» negation + composites ----
    notPrecond(VISIBLE_UNTIL_TERMINAL, "Visible until terminal (not Done, not Trashed)", IS_TERMINAL),
    allPrecond(A_TERMINAL, "Is terminal and not archived", IS_TERMINAL, NOT_ARCHIVED),

    // ---- Create Action wrap-the-wrapper chain ----
    allPrecond(CA_INNER, "Not a prototype and not archived", NOT_PROTO, NOT_ARCHIVED),
    allPrecond(CA_UTILITY, "Not a prototype, not archived, and visible until Done", CA_INNER, VISIBLE_UNTIL_DONE),
    allPrecond(CA_WRAPPER, "Not a prototype, not archived, and visible until terminal", CA_UTILITY, VISIBLE_UNTIL_TERMINAL),

    // ---- c57642c4 (edited in place per gated) ----
    allPrecond(C57642C4, "Visible until Done, not a prototype", ...c57Children),

    // ---- Grounding (placeholder — not executed in a visibility test) ----
    grounding(SHARED_GROUNDING),

    // ---- Commands + bindings ----
    command(ARCHIVE_CMD, "Archive Completed", archivePrecond),
    binding(ARCHIVE_BINDING, ARCHIVE_CMD),
    command(PLAN_CMD, "Plan on Today", C57642C4),
    binding(PLAN_BINDING, PLAN_CMD),
    command(CREATE_ACTION_CMD, "Create Action", caPrecond),
    binding(CA_BINDING, CREATE_ACTION_CMD),
    command(UNARCH_CMD, "Un-archive", UNARCH_PRECOND),
    binding(UNARCH_BINDING, UNARCH_CMD),

    // ---- Tasks ----
    task(BACKLOG_TASK, "Backlog task", ENUM_BACKLOG, "ems__EffortStatusBacklog"),
    task(DONE_TASK, "Done task", ENUM_DONE, "ems__EffortStatusDone"),
    task(TRASHED_TASK, "Trashed task", ENUM_TRASHED, "ems__EffortStatusTrashed"),
    task(TRASHED_ARCHIVED_TASK, "Trashed archived task", ENUM_TRASHED, "ems__EffortStatusTrashed", true),
  ];
  for (const [path, content] of files) {
    await fs.createFile(path, content);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BACKLOG_IRI = `obsidian://vault/${DIR}/${BACKLOG_TASK}.md`;
const DONE_IRI = `obsidian://vault/${DIR}/${DONE_TASK}.md`;
const TRASHED_IRI = `obsidian://vault/${DIR}/${TRASHED_TASK}.md`;
const TRASHED_ARCHIVED_IRI = `obsidian://vault/${DIR}/${TRASHED_ARCHIVED_TASK}.md`;

async function build(
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
  const resolved = await resolver.resolveForAssetMulti(iri, ["ems__Task"], undefined);
  const visible: string[] = [];
  for (const r of resolved) {
    const precond = r.command.precondition;
    const ok = precond ? await evaluator.evaluate(precond, iri) : true;
    if (ok) visible.push(r.command.name);
  }
  return visible;
}

/** Evaluate one command's precondition at a target IRI (loads via the real resolver). */
async function evalCmd(
  resolver: CommandResolver,
  evaluator: PreconditionEvaluator,
  cmdUid: string,
  iri: string,
): Promise<boolean> {
  const cmd = await resolver.loadCommand(cmdUid);
  expect(cmd).not.toBeNull();
  // Guard against a fail-open verdict: an undefined precondition would fail-open
  // to true and mask a broken fixture (test-fixture-realism §fixture-not-loading).
  expect(cmd!.precondition).toBeDefined();
  return evaluator.evaluate(cmd!.precondition, iri);
}

const REQ = "@req:127763f8-b97d-472f-872d-7c21ecdaacf6";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Integration (req 127763f8): Trashed is a second terminal status equal to Done", () => {
  it(`${REQ} «Archive Completed» is available on a Trashed (not archived) task and on Done`, async () => {
    const { resolver, evaluator } = await build(true);
    expect(await evalCmd(resolver, evaluator, ARCHIVE_CMD, TRASHED_IRI)).toBe(true);
    expect(await evalCmd(resolver, evaluator, ARCHIVE_CMD, DONE_IRI)).toBe(true); // behavior-preserving
    // Hidden where it must be: already-archived terminal, and non-terminal active.
    expect(await evalCmd(resolver, evaluator, ARCHIVE_CMD, TRASHED_ARCHIVED_IRI)).toBe(false);
    expect(await evalCmd(resolver, evaluator, ARCHIVE_CMD, BACKLOG_IRI)).toBe(false);
  });

  it(`${REQ} active-work commands are hidden on a Trashed task, visible on Backlog`, async () => {
    const { resolver, evaluator } = await build(true);
    // c57642c4-shared «Plan on Today».
    expect(await evalCmd(resolver, evaluator, PLAN_CMD, TRASHED_IRI)).toBe(false);
    expect(await evalCmd(resolver, evaluator, PLAN_CMD, TRASHED_ARCHIVED_IRI)).toBe(false);
    expect(await evalCmd(resolver, evaluator, PLAN_CMD, DONE_IRI)).toBe(false); // regression: already hidden on Done
    expect(await evalCmd(resolver, evaluator, PLAN_CMD, BACKLOG_IRI)).toBe(true); // behavior-preserving
    // wrap-the-wrapper utility «Create Action».
    expect(await evalCmd(resolver, evaluator, CREATE_ACTION_CMD, TRASHED_IRI)).toBe(false);
    expect(await evalCmd(resolver, evaluator, CREATE_ACTION_CMD, DONE_IRI)).toBe(false);
    expect(await evalCmd(resolver, evaluator, CREATE_ACTION_CMD, BACKLOG_IRI)).toBe(true);
  });

  it(`${REQ} resolved sets: Trashed = {} active-work + Archive; Trashed+archived = {Un-archive}`, async () => {
    const { resolver, evaluator } = await build(true);

    const trashed = await visibleCommandNames(resolver, evaluator, TRASHED_IRI);
    expect(trashed).toContain("Archive Completed");
    expect(trashed).not.toContain("Plan on Today");
    expect(trashed).not.toContain("Create Action");
    expect(trashed).not.toContain("Un-archive"); // not archived → Un-archive hidden

    const trashedArchived = await visibleCommandNames(resolver, evaluator, TRASHED_ARCHIVED_IRI);
    expect(trashedArchived).toEqual(["Un-archive"]);

    // Regression: Done keeps Archive Completed; Backlog keeps active-work.
    const done = await visibleCommandNames(resolver, evaluator, DONE_IRI);
    expect(done).toContain("Archive Completed");
    expect(done).not.toContain("Plan on Today");
    const backlog = await visibleCommandNames(resolver, evaluator, BACKLOG_IRI);
    expect(backlog).toEqual(expect.arrayContaining(["Plan on Today", "Create Action"]));
    expect(backlog).not.toContain("Archive Completed");
  });

  it(`${REQ} REVERT-VERIFY (archive): the Done-only gate hides «Archive Completed» on a Trashed task`, async () => {
    const { resolver, evaluator } = await build(false);
    // Reverted Archive gate = «Is Done and not archived» → false on Trashed (RED
    // the shipped terminal gate turns GREEN); still true on Done (unchanged).
    expect(await evalCmd(resolver, evaluator, ARCHIVE_CMD, TRASHED_IRI)).toBe(false);
    expect(await evalCmd(resolver, evaluator, ARCHIVE_CMD, DONE_IRI)).toBe(true);

    const trashed = await visibleCommandNames(resolver, evaluator, TRASHED_IRI);
    expect(trashed).not.toContain("Archive Completed");
  });

  it(`${REQ} REVERT-VERIFY (active-work): without «Visible until terminal» the commands re-appear on a Trashed task`, async () => {
    const { resolver, evaluator } = await build(false);
    // Reverted active-work gates = «Visible until Done» only (Trashed ≠ Done) →
    // leak onto the Trashed task (the RED the shipped terminal gate turns GREEN).
    expect(await evalCmd(resolver, evaluator, PLAN_CMD, TRASHED_IRI)).toBe(true);
    expect(await evalCmd(resolver, evaluator, PLAN_CMD, TRASHED_ARCHIVED_IRI)).toBe(true);
    expect(await evalCmd(resolver, evaluator, CREATE_ACTION_CMD, TRASHED_IRI)).toBe(true);

    const trashed = await visibleCommandNames(resolver, evaluator, TRASHED_IRI);
    expect(trashed).toContain("Plan on Today");
    expect(trashed).toContain("Create Action");
  });
});
