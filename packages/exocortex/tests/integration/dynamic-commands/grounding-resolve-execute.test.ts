/**
 * Integration test: RDF → CommandResolver → GroundingExecutor (CREATE_INSTANCE).
 *
 * Regression coverage for RFC `da3a7555-08aa-46d0-9e2b-6c82415a6aba` (Fix wikilink
 * unwrap regression in v15.173.0). Unit tests mock `grounding` with pre-parsed bare
 * values, sidestepping the RDF → Grounding resolver — exactly the gap that let the
 * v15.173.0 regression ship green. These fixtures exercise the full resolver +
 * executor pipeline against a realistic triple store.
 *
 * Fixtures:
 *   1. `linkBackProperty` declared as wikilink `[[<UID>|ems__Effort_prevIteration]]`
 *      → new asset frontmatter MUST contain `ems__Effort_prevIteration: "[[...]]"`,
 *        NOT legacy `exo__Asset_source`.
 *   2. `targetClass` reference (full IRI in store) → emitted as short
 *        `exo__Instance_class: "[[ems__Task]]"`, NOT full IRI form.
 *   3. `copyFromTarget` semantics — ≥3 non-blacklisted fields copied from source
 *        asset's frontmatter into the new instance.
 */

import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { CommandResolver } from "../../../src/services/CommandResolver";
import {
  GroundingExecutor,
  ServiceRegistry,
} from "../../../src/services/GroundingExecutor";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";
import {
  IFileSystemReader,
  IFileSystemWriter,
} from "../../../src/interfaces/IFileSystemAdapter";

// ---------------------------------------------------------------------------
// In-memory fs adapter (mirrors remove-start-timestamp.test.ts setup)
// ---------------------------------------------------------------------------

class InMemoryFileSystem implements IFileSystemReader, IFileSystemWriter {
  private files = new Map<string, string>();

  constructor(initial?: Record<string, string>) {
    if (initial) {
      for (const [path, content] of Object.entries(initial)) {
        this.files.set(path, content);
      }
    }
  }

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
  listCreated(): string[] {
    return Array.from(this.files.keys());
  }
}

// ---------------------------------------------------------------------------
// Shared fixture builders
// ---------------------------------------------------------------------------

const SOURCE_UID = "36e54b4c-8e9f-4364-9756-7ce7512da3cd";
const SOURCE_FILE_PATH = `03 Knowledge/inbox/${SOURCE_UID}.md`;
const SOURCE_IRI = `obsidian://vault/${encodeURI(SOURCE_FILE_PATH)}`;

const PROPERTY_UID = "3104b383-90b2-41be-b561-995ac8001af7";

const GND_UID = "d240c457-3d62-4813-99c4-922134789771";
const CMD_UID = "cmd-create-next-iteration";

const SOURCE_CONTENT = [
  "---",
  `exo__Asset_uid: ${SOURCE_UID}`,
  "exo__Instance_class:",
  '  - "[[ems__Task]]"',
  'exo__Asset_label: "Source Task"',
  'ems__Effort_status: "[[ems__EffortStatusDoing]]"',
  'ems__Effort_parent: "[[parent-project-uid]]"',
  'ems__Effort_area: "[[area-uid]]"',
  'ems__Effort_responsible: "[[user-uid]]"',
  "---",
  "",
  "# Source Task",
].join("\n");

/**
 * Seed a Grounding + Command pair into the triple store. Caller picks
 * variant for each of the three fixtures via flags.
 */
async function seedGrounding(
  store: InMemoryTripleStore,
  opts: {
    /** Literal value to emit on `Grounding_linkBackProperty`. */
    linkBackPropertyLiteral?: string;
    /** If true — emit `Grounding_targetClass` as IRI (regression form); otherwise as literal short name. */
    targetClassAsIRI?: boolean;
    /** Override targetFolder. */
    targetFolder?: string;
  } = {},
): Promise<void> {
  const gnd = new IRI(`obsidian://vault/${GND_UID}.md`);

  await store.addAll([
    new Triple(gnd, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Grounding")),
    new Triple(gnd, Namespace.EXO.term("Asset_uid"), new Literal(GND_UID)),
    new Triple(gnd, Namespace.EXO.term("Asset_label"), new Literal("Create Next Iteration grounding")),
    new Triple(gnd, Namespace.EXOCMD.term("Grounding_type"), new Literal("create_instance")),
    new Triple(
      gnd,
      Namespace.EXOCMD.term("Grounding_targetFolder"),
      new Literal(opts.targetFolder ?? "03 Knowledge/inbox"),
    ),
  ]);

  // targetClass — either as IRI (regression form before v15.173.1 fix) or
  // as literal short name. Both should yield `[[ems__Task]]` in output.
  if (opts.targetClassAsIRI) {
    await store.add(
      new Triple(
        gnd,
        Namespace.EXOCMD.term("Grounding_targetClass"),
        Namespace.EMS.term("Task"),
      ),
    );
  } else {
    await store.add(
      new Triple(
        gnd,
        Namespace.EXOCMD.term("Grounding_targetClass"),
        new Literal("ems__Task"),
      ),
    );
  }

  if (opts.linkBackPropertyLiteral !== undefined) {
    await store.add(
      new Triple(
        gnd,
        Namespace.EXOCMD.term("Grounding_linkBackProperty"),
        new Literal(opts.linkBackPropertyLiteral),
      ),
    );
  }
}

async function seedCommand(store: InMemoryTripleStore): Promise<void> {
  const cmd = new IRI(`obsidian://vault/${CMD_UID}.md`);
  const gnd = new IRI(`obsidian://vault/${GND_UID}.md`);
  await store.addAll([
    new Triple(cmd, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Command")),
    new Triple(cmd, Namespace.EXO.term("Asset_uid"), new Literal(CMD_UID)),
    new Triple(cmd, Namespace.EXO.term("Asset_label"), new Literal("Create Next Iteration")),
    new Triple(cmd, Namespace.EXOCMD.term("Command_grounding"), gnd),
  ]);
}

// ---------------------------------------------------------------------------
// Helpers: resolve grounding through CommandResolver + execute
// ---------------------------------------------------------------------------

interface GroundingDefLike {
  id: string;
  type: string;
  targetFolder?: string;
  targetClass?: string;
  linkBackProperty?: string;
}

async function loadGrounding(
  resolver: CommandResolver,
  store: InMemoryTripleStore,
): Promise<GroundingDefLike> {
  // Resolver loads a grounding only via Command → Grounding edge. Use
  // resolveForAssetMulti as the public entry point.
  const taskIRI = new IRI(SOURCE_IRI);
  await store.addAll([
    new Triple(taskIRI, Namespace.RDF.term("type"), Namespace.EMS.term("Task")),
    new Triple(taskIRI, Namespace.EXO.term("Asset_uid"), new Literal(SOURCE_UID)),
  ]);

  // Bind the Command to ems__Task class for the resolver to pick it up.
  const bindUid = "bind-create-next-iter";
  const bind = new IRI(`obsidian://vault/${bindUid}.md`);
  const cmd = new IRI(`obsidian://vault/${CMD_UID}.md`);
  await store.addAll([
    new Triple(bind, Namespace.RDF.term("type"), Namespace.EXOCMD.term("CommandBinding")),
    new Triple(bind, Namespace.EXO.term("Asset_uid"), new Literal(bindUid)),
    new Triple(bind, Namespace.EXOCMD.term("CommandBinding_command"), cmd),
    new Triple(
      bind,
      Namespace.EXOCMD.term("CommandBinding_targetClass"),
      new Literal("ems__Task"),
    ),
  ]);

  const resolved = await resolver.resolveForAssetMulti(
    SOURCE_IRI,
    ["ems__Task"],
    undefined,
  );
  if (resolved.length === 0) {
    throw new Error("test setup: resolver returned no commands");
  }
  return resolved[0].command.grounding as unknown as GroundingDefLike;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

describe("RFC da3a7555 — RDF → Resolver → Executor pipeline (create_instance)", () => {
  let store: InMemoryTripleStore;
  let resolver: CommandResolver;
  let executor: GroundingExecutor;
  let fs: InMemoryFileSystem;

  beforeEach(() => {
    store = new InMemoryTripleStore();
    resolver = new CommandResolver(store);
    fs = new InMemoryFileSystem({ [SOURCE_FILE_PATH]: SOURCE_CONTENT });
    executor = new GroundingExecutor(fs, fs, new ServiceRegistry());
  });

  it("Fixture 1: linkBackProperty wikilink-form resolves to short name and writes ems__Effort_prevIteration", async () => {
    await seedGrounding(store, {
      // Wikilink-with-alias form — this is the v15.173.0 regression case.
      linkBackPropertyLiteral: `[[${PROPERTY_UID}|ems__Effort_prevIteration]]`,
    });
    await seedCommand(store);

    const grounding = await loadGrounding(resolver, store);
    expect(grounding.linkBackProperty).toBe("ems__Effort_prevIteration");

    const result = await executor.execute(
      grounding as never,
      SOURCE_IRI,
      SOURCE_FILE_PATH,
    );
    expect(result.success).toBe(true);

    const createdPath = fs.listCreated().find((p) => p !== SOURCE_FILE_PATH);
    expect(createdPath).toBeDefined();
    const content = fs.getContent(createdPath!)!;

    // MUST use ems__Effort_prevIteration, NOT legacy exo__Asset_source.
    expect(content).toContain(`ems__Effort_prevIteration: "[[${SOURCE_UID}]]"`);
    expect(content).not.toContain("exo__Asset_source:");
    // Must NOT contain the obsidian:// URL form (regression marker).
    expect(content).not.toMatch(/\[\[obsidian:\/\/vault/);
  });

  it("Fixture 2: targetClass IRI reverse-maps to short [[ems__Task]] (not full IRI)", async () => {
    await seedGrounding(store, {
      // Store carries Grounding_targetClass as IRI — must reverse-map to ems__Task.
      targetClassAsIRI: true,
      linkBackPropertyLiteral: `[[${PROPERTY_UID}|ems__Effort_prevIteration]]`,
    });
    await seedCommand(store);

    const grounding = await loadGrounding(resolver, store);
    expect(grounding.targetClass).toBe("ems__Task");

    const result = await executor.execute(
      grounding as never,
      SOURCE_IRI,
      SOURCE_FILE_PATH,
    );
    expect(result.success).toBe(true);

    const createdPath = fs.listCreated().find((p) => p !== SOURCE_FILE_PATH);
    const content = fs.getContent(createdPath!)!;

    // Short form, NOT full IRI.
    expect(content).toContain('exo__Instance_class:\n  - "[[ems__Task]]"');
    expect(content).not.toMatch(/exo__Instance_class:.*https:\/\/exocortex/);
    expect(content).not.toContain("[[https://exocortex.my/ontology/ems#Task]]");
  });

  it("Fixture 3: copy-from-target inherits ≥3 non-blacklisted fields from source frontmatter", async () => {
    await seedGrounding(store, {
      linkBackPropertyLiteral: `[[${PROPERTY_UID}|ems__Effort_prevIteration]]`,
    });
    await seedCommand(store);

    const grounding = await loadGrounding(resolver, store);

    const result = await executor.execute(
      grounding as never,
      SOURCE_IRI,
      SOURCE_FILE_PATH,
    );
    expect(result.success).toBe(true);

    const createdPath = fs.listCreated().find((p) => p !== SOURCE_FILE_PATH);
    const content = fs.getContent(createdPath!)!;

    // ≥3 copy-from-target fields must be present.
    const copiedKeys = ["ems__Effort_parent", "ems__Effort_area", "ems__Effort_responsible"];
    const copiedCount = copiedKeys.filter((k) => content.includes(`${k}:`)).length;
    expect(copiedCount).toBeGreaterThanOrEqual(3);

    // Blacklist enforcement: must NOT copy uid, label, status, instance_class.
    expect(content).not.toMatch(/\nexo__Asset_uid: 36e54b4c/);
    expect(content).not.toMatch(/^aliases:\n.*- "Source Task"/m);
    // Back-link present.
    expect(content).toContain(`ems__Effort_prevIteration: "[[${SOURCE_UID}]]"`);
  });
});
