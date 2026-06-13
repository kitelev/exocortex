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
 *      → new asset frontmatter MUST contain `ems__Effort_prevIteration: "[[<UID>]]"`
 *        in BARE-UID form (#3195 strip-canon — UUID-named targets drop the folder
 *        prefix), NOT legacy `exo__Asset_source` nor the path-form `[[03 Knowledge/…]]`.
 *   2. `targetClass` reference (full IRI in store) → emitted as short
 *        `exo__Instance_class: "[[ems__Task]]"`, NOT full IRI form.
 *   3. RFC 32445c1c homoiconic cutover — Grounding without any
 *        `exocmd__Grounding_inheritanceRule` MUST NOT inherit any property
 *        from $target (Step 4 copy-from-target removed; explicit rules only).
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
  // Issue #3184 B3 added `ems__Effort_area` to the blacklist; without
  // another non-blacklisted ems__Effort_* property the fixture would only
  // cover 2 inherited keys instead of the documented "≥3" contract. Pick
  // `ems__Effort_priority` — already used in vault, still copyable.
  'ems__Effort_priority: "[[priority-high]]"',
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
    new Triple(gnd, Namespace.EXOCMD.term("Grounding_type"), new Literal("[[4367e2d6-6c92-450a-becb-abce1fb07682]]")),
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
    // #3195 strip-canon (2026-05-17): the back-link target is a UUID-named file,
    // so GroundingExecutor.extractBacklinkTarget emits the BARE UID
    // (`[[<uid>]]`), NOT the legacy path-form (`[[03 Knowledge/inbox/<uid>]]`).
    expect(content).toContain(`ems__Effort_prevIteration: "[[${SOURCE_UID}]]"`);
    // Strip-canon guard: the folder prefix MUST be stripped (path-form leak is
    // the #3195 regression marker). Anchored on the inbox prefix used by the
    // fixture's SOURCE_FILE_PATH.
    expect(content).not.toContain("[[03 Knowledge/inbox/");
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

  it("Fixture 2b: targetClass IRI pointing at a UUID-named class TBox file → UID-form wikilink (#3212)", async () => {
    // Issue #3212 — UUID-canon TBox: when Grounding_targetClass points at a
    // UUID-named class file (e.g. `1b20a8f0-...md` whose label is
    // `ems__Task`), the executor must emit `exo__Instance_class: "[[<UID>]]"`,
    // NOT the legacy label-form `"[[ems__Task]]"`. The fix is at the parser
    // layer (NoteToRDFConverter Phase 3 hotfix bypass extended to
    // `Grounding_targetClass`); this fixture seeds the store with the
    // parser's post-fix output (file IRI for the class TBox) and asserts
    // the resolver+executor chain produces UID-form.
    const CLASS_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e";
    const CLASS_FILE_IRI = new IRI(
      `obsidian://vault/assetspaces/ems/${CLASS_UID}.md`,
    );

    // Seed the class TBox file's identity (uid + label). Required so the
    // resolver's IRI → UUID basename mapping has a well-formed target.
    await store.addAll([
      new Triple(
        CLASS_FILE_IRI,
        Namespace.RDF.term("type"),
        Namespace.EXO.term("Class"),
      ),
      new Triple(
        CLASS_FILE_IRI,
        Namespace.EXO.term("Asset_uid"),
        new Literal(CLASS_UID),
      ),
      new Triple(
        CLASS_FILE_IRI,
        Namespace.EXO.term("Asset_label"),
        new Literal("ems__Task"),
      ),
    ]);

    // Manually seed grounding with file IRI for targetClass (simulating
    // the parser's post-fix output for `Grounding_targetClass: [[<UID>]]`).
    const gnd = new IRI(`obsidian://vault/${GND_UID}.md`);
    await store.addAll([
      new Triple(gnd, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Grounding")),
      new Triple(gnd, Namespace.EXO.term("Asset_uid"), new Literal(GND_UID)),
      new Triple(
        gnd,
        Namespace.EXO.term("Asset_label"),
        new Literal("Create Task Instance grounding"),
      ),
      new Triple(
        gnd,
        Namespace.EXOCMD.term("Grounding_type"),
        new Literal("[[4367e2d6-6c92-450a-becb-abce1fb07682]]"),
      ),
      new Triple(
        gnd,
        Namespace.EXOCMD.term("Grounding_targetClass"),
        CLASS_FILE_IRI,
      ),
      new Triple(
        gnd,
        Namespace.EXOCMD.term("Grounding_targetFolder"),
        new Literal("03 Knowledge/inbox"),
      ),
      new Triple(
        gnd,
        Namespace.EXOCMD.term("Grounding_linkBackProperty"),
        new Literal(`[[${PROPERTY_UID}|ems__Effort_prevIteration]]`),
      ),
    ]);
    await seedCommand(store);

    const grounding = await loadGrounding(resolver, store);
    // CommandResolver.iriToObsidianName extracts the UUID basename for
    // `obsidian://vault/...` IRIs — yielding the canonical UID.
    expect(grounding.targetClass).toBe(CLASS_UID);

    const result = await executor.execute(
      grounding as never,
      SOURCE_IRI,
      SOURCE_FILE_PATH,
    );
    expect(result.success).toBe(true);

    const createdPath = fs.listCreated().find((p) => p !== SOURCE_FILE_PATH);
    const content = fs.getContent(createdPath!)!;

    // UID-form, NOT label-form.
    expect(content).toContain(
      `exo__Instance_class:\n  - "[[${CLASS_UID}]]"`,
    );
    expect(content).not.toContain('"[[ems__Task]]"');
  });

  it("Fixture 2c: targetClass plain literal + class TBox in store → UID-form via CommandResolver label→UID lookup (#3212)", async () => {
    // Issue #3212 — vault grounding `a6ef8fda-...` ("Create TaskPrototype
    // instance") stores `exocmd__Grounding_targetClass: "ems__Task"` as a
    // plain string literal (not a wikilink). The Phase 3 parser bypass does
    // not fire (no UUID wikilink, no IRI). The CommandResolver then performs
    // a label→UID lookup against the seeded class TBox file so the executor
    // emits UID-form regardless of legacy storage shape.
    const CLASS_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e";
    const CLASS_FILE_IRI = new IRI(
      `obsidian://vault/assetspaces/ems/${CLASS_UID}.md`,
    );

    await store.addAll([
      new Triple(
        CLASS_FILE_IRI,
        Namespace.RDF.term("type"),
        Namespace.EXO.term("Class"),
      ),
      new Triple(
        CLASS_FILE_IRI,
        Namespace.EXO.term("Asset_uid"),
        new Literal(CLASS_UID),
      ),
      new Triple(
        CLASS_FILE_IRI,
        Namespace.EXO.term("Asset_label"),
        new Literal("ems__Task"),
      ),
    ]);

    // Plain literal short-name — empirical reproduction of vault grounding
    // `a6ef8fda-...` (see issue body).
    await seedGrounding(store, {
      linkBackPropertyLiteral: `[[${PROPERTY_UID}|ems__Effort_prevIteration]]`,
    });
    await seedCommand(store);

    const grounding = await loadGrounding(resolver, store);
    expect(grounding.targetClass).toBe(CLASS_UID);

    const result = await executor.execute(
      grounding as never,
      SOURCE_IRI,
      SOURCE_FILE_PATH,
    );
    expect(result.success).toBe(true);

    const createdPath = fs.listCreated().find((p) => p !== SOURCE_FILE_PATH);
    const content = fs.getContent(createdPath!)!;

    expect(content).toContain(
      `exo__Instance_class:\n  - "[[${CLASS_UID}]]"`,
    );
    expect(content).not.toContain('"[[ems__Task]]"');
  });

  it("Fixture 2d: PRODUCTION-SHAPE — class TBox absent from store (cold-start) → resolver-time findUidByLabel returns null → execution-time ClassLabelToUidResolver yields UID-form (#3220)", async () => {
    // Issue #3220 — the #3212 resolver-layer fix (CommandResolver.findUidByLabel,
    // exercised by Fixture 2c) works ONLY when the class TBox label triple is in
    // the SAME store the resolver queries. Production cold-start paths violate
    // that precondition:
    //   - ExocmdFastResolver (#3171) builds a mini-store from the open asset +
    //     `assetspaces/exocmd` only — NEVER `assetspaces/ems` where the class
    //     TBox lives.
    //   - the persisted binding cache (#3183) bakes the resolved grounding and
    //     survives an Obsidian restart.
    // This fixture reproduces that shape: the grounding stores the plain literal
    // `"ems__Task"` (vault grounding `a6ef8fda-...`) but — UNLIKE Fixture 2c —
    // the class TBox file is DELIBERATELY NOT seeded into the store. So
    // findUidByLabel returns null and the grounding bakes the bare label.
    const CLASS_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e";

    await seedGrounding(store, {
      linkBackPropertyLiteral: `[[${PROPERTY_UID}|ems__Effort_prevIteration]]`,
    });
    await seedCommand(store);

    const grounding = await loadGrounding(resolver, store);
    // The production gap: with no class TBox in the store, the resolver-layer
    // fix degrades to the bare label. This is the value baked into the disk
    // cache / fast-path ResolvedCommand that production executes.
    expect(grounding.targetClass).toBe("ems__Task");

    // --- Execution WITHOUT a resolver (tests/CLI/headless) → label-form. ---
    // Backward-compatibility guard: the prior behaviour is preserved when no
    // ClassLabelToUidResolver is injected.
    const fsNoResolver = new InMemoryFileSystem({
      [SOURCE_FILE_PATH]: SOURCE_CONTENT,
    });
    const executorNoResolver = new GroundingExecutor(
      fsNoResolver,
      fsNoResolver,
      new ServiceRegistry(),
    );
    const resNoResolver = await executorNoResolver.execute(
      grounding as never,
      SOURCE_IRI,
      SOURCE_FILE_PATH,
    );
    expect(resNoResolver.success).toBe(true);
    const pathNoResolver = fsNoResolver
      .listCreated()
      .find((p) => p !== SOURCE_FILE_PATH)!;
    expect(fsNoResolver.getContent(pathNoResolver)!).toContain(
      'exo__Instance_class:\n  - "[[ems__Task]]"',
    );

    // --- Execution WITH the metadata-cache-backed resolver → UID-form. ---
    // Simulates the always-warm Obsidian metadata cache that DOES know the
    // class (the plugin wires `createObsidianClassLabelResolver`). This is the
    // assertion that FAILS before the #3220 fix — executeCreateInstance ignored
    // the label and wrote `"[[ems__Task]]"` regardless.
    const fsWithResolver = new InMemoryFileSystem({
      [SOURCE_FILE_PATH]: SOURCE_CONTENT,
    });
    const calls: string[] = [];
    const executorWithResolver = new GroundingExecutor(
      fsWithResolver,
      fsWithResolver,
      new ServiceRegistry(),
      (label: string) => {
        calls.push(label);
        return label === "ems__Task" ? CLASS_UID : null;
      },
    );
    const resWithResolver = await executorWithResolver.execute(
      grounding as never,
      SOURCE_IRI,
      SOURCE_FILE_PATH,
    );
    expect(resWithResolver.success).toBe(true);
    const pathWithResolver = fsWithResolver
      .listCreated()
      .find((p) => p !== SOURCE_FILE_PATH)!;
    const contentWithResolver = fsWithResolver.getContent(pathWithResolver)!;

    expect(calls).toContain("ems__Task");
    expect(contentWithResolver).toContain(
      `exo__Instance_class:\n  - "[[${CLASS_UID}]]"`,
    );
    expect(contentWithResolver).not.toContain('"[[ems__Task]]"');
  });

  it("Fixture 2e: resolver is NOT invoked for already-UUID targetClass — and never overrides it (#3220)", async () => {
    // Guards against a resolver that mis-resolves a UUID back to something else:
    // when grounding.targetClass is already UUID-canon (full-path resolution /
    // parser-layer bypass #3212), executeCreateInstance must short-circuit and
    // emit it verbatim without calling the resolver.
    const CLASS_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e";

    // Seed the class TBox so the resolver-layer fix produces UID-form, mirroring
    // a warm full-path resolution.
    const CLASS_FILE_IRI = new IRI(
      `obsidian://vault/assetspaces/ems/${CLASS_UID}.md`,
    );
    await store.addAll([
      new Triple(CLASS_FILE_IRI, Namespace.RDF.term("type"), Namespace.EXO.term("Class")),
      new Triple(CLASS_FILE_IRI, Namespace.EXO.term("Asset_uid"), new Literal(CLASS_UID)),
      new Triple(CLASS_FILE_IRI, Namespace.EXO.term("Asset_label"), new Literal("ems__Task")),
    ]);
    await seedGrounding(store, {
      linkBackPropertyLiteral: `[[${PROPERTY_UID}|ems__Effort_prevIteration]]`,
    });
    await seedCommand(store);

    const grounding = await loadGrounding(resolver, store);
    expect(grounding.targetClass).toBe(CLASS_UID);

    const calls: string[] = [];
    const executorWithResolver = new GroundingExecutor(fs, fs, new ServiceRegistry(), (label: string) => {
      calls.push(label);
      return "SHOULD-NOT-BE-USED";
    });
    const result = await executorWithResolver.execute(
      grounding as never,
      SOURCE_IRI,
      SOURCE_FILE_PATH,
    );
    expect(result.success).toBe(true);
    // Resolver MUST be skipped for UUID refs.
    expect(calls).toHaveLength(0);
    const createdPath = fs.listCreated().find((p) => p !== SOURCE_FILE_PATH)!;
    expect(fs.getContent(createdPath)!).toContain(
      `exo__Instance_class:\n  - "[[${CLASS_UID}]]"`,
    );
    expect(fs.getContent(createdPath)!).not.toContain("SHOULD-NOT-BE-USED");
  });

  it("Fixture 3 (RFC 32445c1c): NO implicit copy-from-target — source-only fields do not leak", async () => {
    // RFC 32445c1c removed Step 4 (copy-from-target + BLACKLIST). After this
    // cutover, a Grounding WITHOUT any `exocmd__Grounding_inheritanceRule`
    // attached MUST NOT inherit any property from $target — implicit copy is
    // the bug, explicit declarative rules are the fix.
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

    // Source-only fields MUST NOT appear in the new instance.
    const sourceOnlyKeys = [
      "ems__Effort_parent",
      "ems__Effort_priority",
      "ems__Effort_responsible",
      "ems__Effort_area",
      "ems__Effort_status",
    ];
    for (const key of sourceOnlyKeys) {
      expect(content).not.toContain(`${key}:`);
    }
    // Identity/lifecycle fields also do not leak.
    expect(content).not.toMatch(/\nexo__Asset_uid: 36e54b4c/);
    expect(content).not.toMatch(/^aliases:\n.*- "Source Task"/m);
    // Back-link still wired by Step 5 (engine scaffolding, independent of
    // Step 4 removal). Use a regex anchored on the back-link prop name so
    // the assertion survives the pre-existing $target → UUID-form quirk
    // (see also Fixture 1).
    expect(content).toMatch(/ems__Effort_prevIteration: "\[\[/);
  });
});
