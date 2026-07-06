/**
 * Integration test (req f6c2b98c): status-correct visibility of utility commands
 * on an ems__Task.
 *
 *  - The create/convert/plan/prioritize/maintenance utilities that only make
 *    sense on active work (here: «Create Action», «Convert to Project») are
 *    hidden once the task is Done (and, since Archived ⊂ Done, on Archived too)
 *    while staying visible on Backlog / Doing. A per-command `AllPrecondition`
 *    wrapper ANDs the reusable «Visible until Done» atomic (37517554) with the
 *    command's existing (archived-gate) precondition composite.
 *  - «Create Related Task» — which spins off a follow-up from a COMPLETED task —
 *    gets the INVERSE, Done-only gate (`AllPrecondition[«Done + not-prototype»
 *    2bee97b7, «Not archived» 28f722ba]`): hidden on Backlog / Doing, visible on
 *    Done. It is split from the not-a-prototype precondition (6dd007b8) it
 *    previously shared with «Create Action», because the two now need opposite
 *    sides of Done.
 *
 * Production-shape (test-fixture-realism): the commands + preconditions (the new
 * AllPrecondition wrappers, the reusable atomics, the nested archived-gate
 * composites) + bindings + a Backlog / a Doing / a Done ems__Task are authored as
 * MARKDOWN and run through the REAL `NoteToRDFConverter.convertVault()` →
 * `CommandResolver.loadCommand()` / `resolveForAssetMulti()` →
 * `PreconditionEvaluator.evaluate()` pipeline — the exact path the CLI
 * `resolve-buttons` oracle and the Obsidian inline buttons both take (no
 * hand-injected triples). The wrappers are 2-level composites (a wrapper nests
 * the archived-gate composite which itself nests atomics), exercising the
 * recursive composite loader + evaluator end-to-end.
 *
 * @req:f6c2b98c-4882-47ed-a79d-2e56266e39d1
 *
 * REVERT-VERIFY (integration-test-revert-verify rule): the `gated=false` seeding
 * reverts each command to its pre-req#5 precondition (Create Action / Convert →
 * their archived-gate composite WITHOUT the «Visible until Done» conjunct; Create
 * Related Task → the shared not-a-prototype composite it had before the split).
 * Reverted: «Create Action» / «Convert to Project» re-appear on the Done task
 * (RED) and «Create Related Task» re-appears on the Backlog task (RED). The
 * shipped `gated=true` state turns all three GREEN. The full 4-status matrix is
 * additionally verified end-to-end via the CLI `resolve-buttons` oracle on the
 * live vault (see PR body).
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
// In-memory fs + vault adapter (mirrors archived-gate.integration)
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
// Fixture UIDs — the REAL production asset UIDs (exoas-exocmd).
// ---------------------------------------------------------------------------

const CLS_TASK = "1b20a8f0-d745-4e93-91db-4531b3df120e";
const ENUM_DONE = "7b9b3116-7c3c-438c-9618-94fe301320a6";
const ENUM_BACKLOG = "753a44d5-846c-4b82-9196-4fd9a4d48777";
const ENUM_DOING = "027e78f4-6e16-4b36-b8fb-5510507d5745";
const GT_PROPERTY_DELETE = "4bdf1d0b-e9da-4d96-bafe-c5aaef8c2bd5";

// Reusable atomics.
const VISIBLE_UNTIL_DONE = "37517554-8308-4b38-9841-a9b1619ae092";
const NOT_PROTO = "847c37e0-9812-4dc7-9a92-923dac7cda56";
const NOT_ARCHIVED = "28f722ba-cd01-44c6-b69d-b1c59b0e14fd";
const DONE_NOTPROTO = "2bee97b7-da01-4309-925b-f605e7816ba1";
const IS_NOT_PROJECT = "43a02c67-f2cd-4626-8e4b-6509317068a7";

// Archived-gate (req f1fbea08) composites — the inner nested wrappers (unchanged).
const CA_INNER = "6dd007b8-c4e8-4159-a496-e2383e7e0476"; // [NOT_PROTO, NOT_ARCHIVED]
const CONVERT_INNER = "c5319f3b-ff82-4284-be0f-692a15bc3cab"; // [IS_NOT_PROJECT, NOT_ARCHIVED]

// req f6c2b98c per-command wrappers.
const CA_WRAPPER = "99da8e4b-fce9-4e9f-bbe2-53cd1b0c7645"; // [CA_INNER, VISIBLE_UNTIL_DONE]
const CONVERT_WRAPPER = "ebea3a6a-7d96-45a2-b197-0f6165e3d6c1"; // [CONVERT_INNER, VISIBLE_UNTIL_DONE]
const CRT_WRAPPER = "10de25c6-51e8-41fb-8300-fff16238364b"; // [DONE_NOTPROTO, NOT_ARCHIVED]

// Commands + fixture-owned bindings/groundings.
const CREATE_ACTION_CMD = "48a70029-8485-4969-a050-4f4f21289c08";
const CONVERT_CMD = "b1b6978e-a565-43f0-a5e8-5291e5b813c8";
const CRT_CMD = "62b8c49c-4b07-4911-b23f-db6edc8d201d";
const CA_BINDING = "b1b1b1b1-1111-4111-8111-111111111111";
const CONVERT_BINDING = "b2b2b2b2-2222-4222-8222-222222222222";
const CRT_BINDING = "b3b3b3b3-3333-4333-8333-333333333333";
const SHARED_GROUNDING = "b4b4b4b4-4444-4444-8444-444444444444";

// Fixture-owned tasks.
const BACKLOG_TASK = "d1d1d1d1-1111-4111-8111-111111111111";
const DOING_TASK = "d2d2d2d2-2222-4222-8222-222222222222";
const DONE_TASK = "d3d3d3d3-3333-4333-8333-333333333333";

const DIR = "assetspaces/my";

// Flattened single-line ASKs (naive fixture parser can't read block scalars).
const VISIBLE_UNTIL_DONE_ASK =
  'PREFIX ems: <https://exocortex.my/ontology/ems#> ASK { FILTER NOT EXISTS { $target ems:Effort_status <https://exocortex.my/ontology/ems#EffortStatusDone> } }';
const NOT_PROTO_ASK =
  'PREFIX exo: <https://exocortex.my/ontology/exo#> ASK { FILTER NOT EXISTS { $target exo:Instance_class ?protoMarkerClass . FILTER(STRENDS(STR(?protoMarkerClass), "Prototype")) } }';
const NOT_ARCHIVED_ASK =
  'PREFIX exo: <https://exocortex.my/ontology/exo#> ASK { FILTER NOT EXISTS { $target exo:Asset_archived "true" } }';
const DONE_NOTPROTO_ASK =
  'PREFIX ems: <https://exocortex.my/ontology/ems#> ASK { FILTER NOT EXISTS { $target <https://exocortex.my/ontology/exo#Instance_class> ?protoMarkerClass . FILTER(STRENDS(STR(?protoMarkerClass), "Prototype")) } $target ems:Effort_status ?s . FILTER(?s IN ( <https://exocortex.my/ontology/ems#EffortStatusDone> )) }';
const IS_NOT_PROJECT_ASK =
  'PREFIX exo: <https://exocortex.my/ontology/exo#> PREFIX ems: <https://exocortex.my/ontology/ems#> ASK { FILTER NOT EXISTS { $target <https://exocortex.my/ontology/exo#Instance_class> ?protoMarkerClass . FILTER(STRENDS(STR(?protoMarkerClass), "Prototype")) } $target exo:Instance_class ?c . FILTER(?c != ems:Project) }';

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
      "exocmd__Command_category: create",
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

function task(uid: string, label: string, statusUid: string, statusLabel: string): [string, string] {
  return [
    `${DIR}/${uid}.md`,
    [
      "---",
      `exo__Asset_uid: ${uid}`,
      'exo__Asset_isDefinedBy: "[[!kitelev]]"',
      "exo__Instance_class:",
      `  - "[[${CLS_TASK}]]"`,
      `exo__Asset_label: "${label}"`,
      `ems__Effort_status: "[[${statusUid}|${statusLabel}]]"`,
      "---",
      "",
      "Body notes.",
    ].join("\n"),
  ];
}

/**
 * @param gated when true each command points at its req#5 wrapper (the shipped
 *   state): Create Action → CA_WRAPPER, Convert → CONVERT_WRAPPER, Create Related
 *   Task → CRT_WRAPPER (Done-only). When false each is reverted to its pre-req#5
 *   precondition: Create Action → CA_INNER, Convert → CONVERT_INNER, Create
 *   Related Task → CA_INNER (the shared not-a-prototype composite it had before
 *   the split — i.e. NOT Done-only).
 */
async function seedVault(fs: InMemoryFileSystem, gated: boolean): Promise<void> {
  const caPrecond = gated ? CA_WRAPPER : CA_INNER;
  const convertPrecond = gated ? CONVERT_WRAPPER : CONVERT_INNER;
  const crtPrecond = gated ? CRT_WRAPPER : CA_INNER;

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
    [`${DIR}/${ENUM_BACKLOG}.md`, fm(`exo__Asset_uid: ${ENUM_BACKLOG}`, "exo__Asset_label: ems__EffortStatusBacklog")],
    [`${DIR}/${ENUM_DOING}.md`, fm(`exo__Asset_uid: ${ENUM_DOING}`, "exo__Asset_label: ems__EffortStatusDoing")],

    // ---- Reusable atomics ----
    atomic(VISIBLE_UNTIL_DONE, "Visible until Done", VISIBLE_UNTIL_DONE_ASK),
    atomic(NOT_PROTO, "Target is not a prototype", NOT_PROTO_ASK),
    atomic(NOT_ARCHIVED, "Not archived", NOT_ARCHIVED_ASK),
    atomic(DONE_NOTPROTO, "Allow re-open (when status = Done)", DONE_NOTPROTO_ASK),
    atomic(IS_NOT_PROJECT, "Is not a project", IS_NOT_PROJECT_ASK),

    // ---- Archived-gate (req f1fbea08) inner composites (unchanged) ----
    allPrecond(CA_INNER, "Target is not a prototype and not archived", NOT_PROTO, NOT_ARCHIVED),
    allPrecond(CONVERT_INNER, "Is not a project and not archived", IS_NOT_PROJECT, NOT_ARCHIVED),

    // ---- req f6c2b98c wrappers (nested composites) ----
    allPrecond(CA_WRAPPER, "Not a prototype, not archived, and visible until Done", CA_INNER, VISIBLE_UNTIL_DONE),
    allPrecond(CONVERT_WRAPPER, "Is not a project, not archived, and visible until Done", CONVERT_INNER, VISIBLE_UNTIL_DONE),
    allPrecond(CRT_WRAPPER, "Is Done, not a prototype, and not archived (Create Related Task)", DONE_NOTPROTO, NOT_ARCHIVED),

    // ---- Grounding (placeholder — not executed in a visibility test) ----
    grounding(SHARED_GROUNDING),

    // ---- Commands + bindings ----
    command(CREATE_ACTION_CMD, "Create Action", caPrecond),
    binding(CA_BINDING, CREATE_ACTION_CMD),
    command(CONVERT_CMD, "Convert to Project", convertPrecond),
    binding(CONVERT_BINDING, CONVERT_CMD),
    command(CRT_CMD, "Create Related Task", crtPrecond),
    binding(CRT_BINDING, CRT_CMD),

    // ---- Tasks (one per canonical status; none archived) ----
    task(BACKLOG_TASK, "Backlog task", ENUM_BACKLOG, "ems__EffortStatusBacklog"),
    task(DOING_TASK, "Doing task", ENUM_DOING, "ems__EffortStatusDoing"),
    task(DONE_TASK, "Done task", ENUM_DONE, "ems__EffortStatusDone"),
  ];
  for (const [path, content] of files) {
    await fs.createFile(path, content);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BACKLOG_IRI = `obsidian://vault/${DIR}/${BACKLOG_TASK}.md`;
const DOING_IRI = `obsidian://vault/${DIR}/${DOING_TASK}.md`;
const DONE_IRI = `obsidian://vault/${DIR}/${DONE_TASK}.md`;

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

const REQ = "@req:f6c2b98c-4882-47ed-a79d-2e56266e39d1";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Integration (req f6c2b98c): utility commands hidden on Done; Create Related Task Done-only", () => {
  it(`${REQ} not-Done gate: «Create Action» / «Convert to Project» hidden on Done, visible on Backlog/Doing`, async () => {
    const { resolver, evaluator } = await build(true);

    // Create Action (nested wrapper [ [not-proto, not-archived], visible-until-Done ]).
    expect(await evalCmd(resolver, evaluator, CREATE_ACTION_CMD, BACKLOG_IRI)).toBe(true);
    expect(await evalCmd(resolver, evaluator, CREATE_ACTION_CMD, DOING_IRI)).toBe(true);
    expect(await evalCmd(resolver, evaluator, CREATE_ACTION_CMD, DONE_IRI)).toBe(false);

    // Convert to Project (wrapper [ [is-not-project, not-archived], visible-until-Done ]).
    expect(await evalCmd(resolver, evaluator, CONVERT_CMD, BACKLOG_IRI)).toBe(true);
    expect(await evalCmd(resolver, evaluator, CONVERT_CMD, DOING_IRI)).toBe(true);
    expect(await evalCmd(resolver, evaluator, CONVERT_CMD, DONE_IRI)).toBe(false);
  });

  it(`${REQ} Done-only gate: «Create Related Task» visible on Done, hidden on Backlog/Doing`, async () => {
    const { resolver, evaluator } = await build(true);
    expect(await evalCmd(resolver, evaluator, CRT_CMD, DONE_IRI)).toBe(true);
    expect(await evalCmd(resolver, evaluator, CRT_CMD, BACKLOG_IRI)).toBe(false);
    expect(await evalCmd(resolver, evaluator, CRT_CMD, DOING_IRI)).toBe(false);
  });

  it(`${REQ} resolved visible sets match the target matrix on Backlog and Done`, async () => {
    const { resolver, evaluator } = await build(true);

    const backlog = await visibleCommandNames(resolver, evaluator, BACKLOG_IRI);
    expect(backlog).toEqual(expect.arrayContaining(["Create Action", "Convert to Project"]));
    expect(backlog).not.toContain("Create Related Task");

    const done = await visibleCommandNames(resolver, evaluator, DONE_IRI);
    expect(done).toContain("Create Related Task");
    expect(done).not.toContain("Create Action");
    expect(done).not.toContain("Convert to Project");
  });

  it(`${REQ} REVERT-VERIFY (not-Done gate): without «Visible until Done» the utilities re-appear on the Done task`, async () => {
    const { resolver, evaluator } = await build(false);
    // Reverted: precondition is the archived-gate composite WITHOUT the not-Done
    // conjunct → true on the Done task (the RED the shipped gate turns GREEN).
    expect(await evalCmd(resolver, evaluator, CREATE_ACTION_CMD, DONE_IRI)).toBe(true);
    expect(await evalCmd(resolver, evaluator, CONVERT_CMD, DONE_IRI)).toBe(true);

    const done = await visibleCommandNames(resolver, evaluator, DONE_IRI);
    expect(done).toContain("Create Action");
    expect(done).toContain("Convert to Project");
  });

  it(`${REQ} REVERT-VERIFY (Done-only gate): without the split «Create Related Task» leaks onto Backlog/Doing`, async () => {
    const { resolver, evaluator } = await build(false);
    // Reverted: Create Related Task shares the not-a-prototype composite (no Done
    // gate) → visible on Backlog (the RED the shipped Done-only gate turns GREEN).
    expect(await evalCmd(resolver, evaluator, CRT_CMD, BACKLOG_IRI)).toBe(true);
    expect(await evalCmd(resolver, evaluator, CRT_CMD, DOING_IRI)).toBe(true);

    const backlog = await visibleCommandNames(resolver, evaluator, BACKLOG_IRI);
    expect(backlog).toContain("Create Related Task");
  });
});
