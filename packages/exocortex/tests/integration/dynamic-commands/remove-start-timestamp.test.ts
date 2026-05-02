/**
 * Integration test: "Remove Start Timestamp" dynamic command pipeline.
 *
 * Verifies the full RFC-009 dynamic command lifecycle end-to-end at the service level:
 *   1. CommandResolver resolves commands from vault triples in a real InMemoryTripleStore
 *   2. PreconditionEvaluator evaluates SPARQL ASK preconditions against the store
 *   3. GroundingExecutor executes property_delete on a realistic markdown file
 *   4. After execution, precondition re-evaluates to false (button disappears)
 *
 * Acceptance criteria (Issue #2494):
 *   - Task WITH  startTimestamp  → button appears  (precondition true)
 *   - Click button               → property removed (grounding succeeds)
 *   - After click                → button disappears (precondition false)
 *   - Task WITHOUT startTimestamp → button absent    (precondition false)
 *
 * Uses real (non-mocked) services: InMemoryTripleStore, CommandResolver,
 * PreconditionEvaluator, GroundingExecutor, FrontmatterService.
 */

import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { CommandResolver } from "../../../src/services/CommandResolver";
import { PreconditionEvaluator } from "../../../src/services/PreconditionEvaluator";
import {
  GroundingExecutor,
  ServiceRegistry,
} from "../../../src/services/GroundingExecutor";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";
import { IFileSystemReader, IFileSystemWriter } from "../../../src/interfaces/IFileSystemAdapter";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ASSET_IRI = "https://exocortex.my/ontology/ems/task-abc-123";
const FILE_PATH = "/vault/task-abc-123.md";

const TASK_WITH_START = [
  "---",
  "exo__Asset_uid: task-abc-123",
  "exo__Instance_class: '[[ems__Task]]'",
  "ems__Effort_status: '[[ems__EffortStatusDoing]]'",
  "ems__Effort_startTimestamp: '2026-03-30T10:00:00.000Z'",
  "---",
  "",
  "# My Task",
  "",
  "Some body content.",
].join("\n");

const TASK_WITHOUT_START = [
  "---",
  "exo__Asset_uid: task-def-456",
  "exo__Instance_class: '[[ems__Task]]'",
  "ems__Effort_status: '[[ems__EffortStatusBacklog]]'",
  "---",
  "",
  "# Another Task",
].join("\n");

// ---------------------------------------------------------------------------
// Vault command asset UIDs (mimic real vault files under 03 Knowledge/exocmd/)
// ---------------------------------------------------------------------------

const CMD_UID = "cmd-remove-start-timestamp";
const PRE_UID = "pre-has-start-timestamp";
const GND_UID = "gnd-delete-start-timestamp";
const BIND_UID = "bind-remove-start-task";

// ---------------------------------------------------------------------------
// Helpers: populate the triple store with vault command triples
// ---------------------------------------------------------------------------

/**
 * Seed the triple store with the "Remove Start Timestamp" command ecosystem.
 *
 * This mirrors what NoteToRDFConverter would produce from vault markdown files:
 *   - exocmd__Precondition: "Has startTimestamp" (SPARQL ASK)
 *   - exocmd__Grounding:    "Delete startTimestamp" (property_delete)
 *   - exocmd__Command:      "Remove Start Timestamp" (links precondition + grounding)
 *   - exocmd__CommandBinding: targets ems__Task class
 */
async function seedCommandTriples(store: InMemoryTripleStore): Promise<void> {
  // -- Precondition: asset has ems:Effort_startTimestamp --
  const preSubject = new IRI(`obsidian://vault/${PRE_UID}.md`);
  await store.addAll([
    new Triple(preSubject, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Precondition")),
    new Triple(preSubject, Namespace.EXO.term("Asset_uid"), new Literal(PRE_UID)),
    new Triple(preSubject, Namespace.EXO.term("Asset_label"), new Literal("Has startTimestamp")),
    new Triple(
      preSubject,
      Namespace.EXOCMD.term("Precondition_sparqlAsk"),
      new Literal(
        "PREFIX ems: <https://exocortex.my/ontology/ems#>\nASK { $target ems:Effort_startTimestamp ?ts }",
      ),
    ),
  ]);

  // -- Grounding: property_delete ems__Effort_startTimestamp --
  const gndSubject = new IRI(`obsidian://vault/${GND_UID}.md`);
  await store.addAll([
    new Triple(gndSubject, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Grounding")),
    new Triple(gndSubject, Namespace.EXO.term("Asset_uid"), new Literal(GND_UID)),
    new Triple(gndSubject, Namespace.EXO.term("Asset_label"), new Literal("Delete startTimestamp")),
    new Triple(gndSubject, Namespace.EXOCMD.term("Grounding_type"), new Literal("property_delete")),
    new Triple(
      gndSubject,
      Namespace.EXOCMD.term("Grounding_targetProperty"),
      new Literal("ems__Effort_startTimestamp"),
    ),
  ]);

  // -- Command: links precondition + grounding --
  const cmdSubject = new IRI(`obsidian://vault/${CMD_UID}.md`);
  await store.addAll([
    new Triple(cmdSubject, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Command")),
    new Triple(cmdSubject, Namespace.EXO.term("Asset_uid"), new Literal(CMD_UID)),
    new Triple(cmdSubject, Namespace.EXO.term("Asset_label"), new Literal("Remove Start Timestamp")),
    new Triple(cmdSubject, Namespace.EXOCMD.term("Command_icon"), new Literal("clock-x")),
    new Triple(cmdSubject, Namespace.EXOCMD.term("Command_precondition"), preSubject),
    new Triple(cmdSubject, Namespace.EXOCMD.term("Command_grounding"), gndSubject),
    new Triple(
      cmdSubject,
      Namespace.EXOCMD.term("Command_confirmMessage"),
      new Literal("Remove the start timestamp from this task?"),
    ),
    new Triple(
      cmdSubject,
      Namespace.EXOCMD.term("Command_successMessage"),
      new Literal("Start timestamp removed"),
    ),
    new Triple(cmdSubject, Namespace.EXOCMD.term("Command_category"), new Literal("maintenance")),
  ]);

  // -- Binding: apply to all ems__Task assets --
  const bindSubject = new IRI(`obsidian://vault/${BIND_UID}.md`);
  await store.addAll([
    new Triple(bindSubject, Namespace.RDF.term("type"), Namespace.EXOCMD.term("CommandBinding")),
    new Triple(bindSubject, Namespace.EXO.term("Asset_uid"), new Literal(BIND_UID)),
    new Triple(bindSubject, Namespace.EXO.term("Asset_label"), new Literal("Remove Start → Task")),
    new Triple(bindSubject, Namespace.EXOCMD.term("CommandBinding_command"), cmdSubject),
    new Triple(
      bindSubject,
      Namespace.EXOCMD.term("CommandBinding_targetClass"),
      new Literal("ems__Task"),
    ),
    new Triple(bindSubject, Namespace.EXOCMD.term("CommandBinding_position"), new Literal("header")),
    new Triple(bindSubject, Namespace.EXOCMD.term("CommandBinding_order"), new Literal("10")),
    new Triple(bindSubject, Namespace.EXOCMD.term("CommandBinding_group"), new Literal("maintenance")),
  ]);
}

/**
 * Add asset-level triples representing a Task with a start timestamp.
 */
async function seedTaskWithStart(store: InMemoryTripleStore): Promise<void> {
  const subject = new IRI(ASSET_IRI);
  await store.addAll([
    new Triple(subject, Namespace.RDF.term("type"), Namespace.EMS.term("Task")),
    new Triple(subject, Namespace.EXO.term("Asset_uid"), new Literal("task-abc-123")),
    new Triple(
      subject,
      Namespace.EMS.term("Effort_startTimestamp"),
      new Literal("2026-03-30T10:00:00.000Z"),
    ),
    new Triple(
      subject,
      Namespace.EMS.term("Effort_status"),
      new Literal("ems__EffortStatusDoing"),
    ),
  ]);
}

/**
 * Add asset-level triples representing a Task WITHOUT a start timestamp.
 */
async function seedTaskWithoutStart(store: InMemoryTripleStore): Promise<void> {
  const noStartIRI = "https://exocortex.my/ontology/ems/task-def-456";
  const subject = new IRI(noStartIRI);
  await store.addAll([
    new Triple(subject, Namespace.RDF.term("type"), Namespace.EMS.term("Task")),
    new Triple(subject, Namespace.EXO.term("Asset_uid"), new Literal("task-def-456")),
    new Triple(
      subject,
      Namespace.EMS.term("Effort_status"),
      new Literal("ems__EffortStatusBacklog"),
    ),
  ]);
}

// ---------------------------------------------------------------------------
// In-memory file system for GroundingExecutor
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

  /** Test helper: read file content synchronously for assertions */
  getContent(path: string): string | undefined {
    return this.files.get(path);
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("Issue #2494: Remove Start Timestamp — dynamic command pipeline integration", () => {
  let store: InMemoryTripleStore;
  let resolver: CommandResolver;
  let evaluator: PreconditionEvaluator;
  let groundingExecutor: GroundingExecutor;
  let fs: InMemoryFileSystem;

  beforeEach(async () => {
    store = new InMemoryTripleStore();
    resolver = new CommandResolver(store);
    evaluator = new PreconditionEvaluator(store);
    fs = new InMemoryFileSystem({ [FILE_PATH]: TASK_WITH_START });
    groundingExecutor = new GroundingExecutor(fs, fs, new ServiceRegistry());

    // Seed the triple store with command assets (like NoteToRDFConverter would)
    await seedCommandTriples(store);
  });

  // -----------------------------------------------------------------------
  // Phase 1: Command resolution from vault triples
  // -----------------------------------------------------------------------

  describe("Phase 1: Command resolution", () => {
    it("should resolve 'Remove Start Timestamp' command for ems__Task class", async () => {
      const commands = await resolver.resolveForAsset(ASSET_IRI, "ems__Task");

      expect(commands).toHaveLength(1);
      expect(commands[0].command.id).toBe(CMD_UID);
      expect(commands[0].command.name).toBe("Remove Start Timestamp");
      expect(commands[0].command.icon).toBe("clock-x");
      expect(commands[0].command.category).toBe("maintenance");
      expect(commands[0].command.confirmMessage).toBe(
        "Remove the start timestamp from this task?",
      );
      expect(commands[0].command.successMessage).toBe("Start timestamp removed");
    });

    it("should load linked precondition with SPARQL ASK query", async () => {
      const commands = await resolver.resolveForAsset(ASSET_IRI, "ems__Task");
      const precondition = commands[0].command.precondition;

      expect(precondition).toBeDefined();
      expect(precondition!.id).toBe(PRE_UID);
      expect(precondition!.label).toBe("Has startTimestamp");
      expect(precondition!.sparqlAsk).toContain("ASK");
      expect(precondition!.sparqlAsk).toContain("Effort_startTimestamp");
    });

    it("should load linked grounding with property_delete type", async () => {
      const commands = await resolver.resolveForAsset(ASSET_IRI, "ems__Task");
      const grounding = commands[0].command.grounding;

      expect(grounding).toBeDefined();
      expect(grounding.id).toBe(GND_UID);
      expect(grounding.type).toBe("property_delete");
      expect(grounding.targetProperty).toBe("ems__Effort_startTimestamp");
    });

    it("should load binding metadata (position, order, targetClass) and silently ignore legacy `_group`", async () => {
      const commands = await resolver.resolveForAsset(ASSET_IRI, "ems__Task");
      const binding = commands[0].binding;

      expect(binding.position).toBe("header");
      expect(binding.order).toBe(10);
      expect(binding.targetClass).toBe("ems__Task");
      // RFC f1dc284a Phase 8 — `_group` parsing dropped. Fixture still emits
      // the legacy triple to verify parser silently ignores it.
      expect((binding as { group?: string }).group).toBeUndefined();
    });

    it("should NOT resolve command for a non-matching class (ems__Project)", async () => {
      const commands = await resolver.resolveForAsset(ASSET_IRI, "ems__Project");

      expect(commands).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Phase 2: Precondition evaluation (SPARQL ASK against real store)
  // -----------------------------------------------------------------------

  describe("Phase 2: Precondition evaluation", () => {
    it("should return TRUE when task HAS startTimestamp in triple store", async () => {
      await seedTaskWithStart(store);
      const commands = await resolver.resolveForAsset(ASSET_IRI, "ems__Task");
      const precondition = commands[0].command.precondition;

      const result = await evaluator.evaluate(precondition, ASSET_IRI);

      expect(result).toBe(true);
    });

    it("should return FALSE when task does NOT have startTimestamp in triple store", async () => {
      await seedTaskWithoutStart(store);
      const commands = await resolver.resolveForAsset(ASSET_IRI, "ems__Task");
      const precondition = commands[0].command.precondition;

      const noStartIRI = "https://exocortex.my/ontology/ems/task-def-456";
      const result = await evaluator.evaluate(precondition, noStartIRI);

      expect(result).toBe(false);
    });

    it("should return FALSE for a completely unknown asset IRI", async () => {
      const commands = await resolver.resolveForAsset(ASSET_IRI, "ems__Task");
      const precondition = commands[0].command.precondition;

      const result = await evaluator.evaluate(precondition, "https://nonexistent/asset");

      expect(result).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Phase 3: Grounding execution (property_delete on real file)
  // -----------------------------------------------------------------------

  describe("Phase 3: Grounding execution", () => {
    it("should remove ems__Effort_startTimestamp from frontmatter", async () => {
      const commands = await resolver.resolveForAsset(ASSET_IRI, "ems__Task");
      const grounding = commands[0].command.grounding;

      const result = await groundingExecutor.execute(grounding, ASSET_IRI, FILE_PATH);

      expect(result.success).toBe(true);

      const updatedContent = fs.getContent(FILE_PATH)!;
      expect(updatedContent).not.toContain("ems__Effort_startTimestamp");
      // Other properties should remain intact
      expect(updatedContent).toContain("exo__Asset_uid");
      expect(updatedContent).toContain("exo__Instance_class");
      expect(updatedContent).toContain("ems__Effort_status");
      // Body content should remain
      expect(updatedContent).toContain("# My Task");
      expect(updatedContent).toContain("Some body content.");
    });

    it("should succeed when property does not exist (idempotent delete)", async () => {
      // Use file without start timestamp
      fs = new InMemoryFileSystem({ [FILE_PATH]: TASK_WITHOUT_START });
      groundingExecutor = new GroundingExecutor(fs, fs, new ServiceRegistry());

      const commands = await resolver.resolveForAsset(ASSET_IRI, "ems__Task");
      const grounding = commands[0].command.grounding;

      const result = await groundingExecutor.execute(grounding, ASSET_IRI, FILE_PATH);

      expect(result.success).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Phase 4: Full lifecycle — button appears, click, button disappears
  // -----------------------------------------------------------------------

  describe("Phase 4: Full lifecycle (button visibility toggle)", () => {
    it("should complete the full cycle: appear → click → disappear", async () => {
      // --- STEP 1: Seed task WITH startTimestamp ---
      await seedTaskWithStart(store);

      // --- STEP 2: Resolve command ---
      const commands = await resolver.resolveForAsset(ASSET_IRI, "ems__Task");
      expect(commands).toHaveLength(1);

      const resolved = commands[0];

      // --- STEP 3: Precondition evaluates to TRUE (button appears) ---
      const beforeClick = await evaluator.evaluate(
        resolved.command.precondition,
        ASSET_IRI,
      );
      expect(beforeClick).toBe(true);

      // --- STEP 4: Execute grounding (simulate button click) ---
      const execResult = await groundingExecutor.execute(
        resolved.command.grounding,
        ASSET_IRI,
        FILE_PATH,
      );
      expect(execResult.success).toBe(true);

      // --- STEP 5: Simulate triple store update after file change ---
      // In a real plugin, NoteToRDFConverter re-parses the file and updates triples.
      // Here we manually remove the startTimestamp triple from the store.
      const subject = new IRI(ASSET_IRI);
      const startTriples = await store.match(
        subject,
        Namespace.EMS.term("Effort_startTimestamp"),
        undefined,
      );
      expect(startTriples.length).toBeGreaterThan(0);
      await store.removeAll(startTriples);

      // Invalidate caches so re-evaluation uses fresh data
      resolver.invalidateCache();
      evaluator.invalidateCache();

      // --- STEP 6: Precondition evaluates to FALSE (button disappears) ---
      const afterClick = await evaluator.evaluate(
        resolved.command.precondition,
        ASSET_IRI,
      );
      expect(afterClick).toBe(false);

      // --- STEP 7: Verify file content ---
      const finalContent = fs.getContent(FILE_PATH)!;
      expect(finalContent).not.toContain("ems__Effort_startTimestamp");
      expect(finalContent).toContain("exo__Asset_uid");
    });

    it("button should NOT appear for a task without startTimestamp", async () => {
      await seedTaskWithoutStart(store);
      const noStartIRI = "https://exocortex.my/ontology/ems/task-def-456";

      // Resolve commands (binding still applies — ems__Task class)
      const commands = await resolver.resolveForAsset(noStartIRI, "ems__Task");
      expect(commands).toHaveLength(1);

      // Precondition evaluates to FALSE → button should NOT be shown
      const shouldAppear = await evaluator.evaluate(
        commands[0].command.precondition,
        noStartIRI,
      );
      expect(shouldAppear).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe("Edge cases", () => {
    it("should handle concurrent resolution of same command", async () => {
      // Parallel resolution should not cause cache corruption
      const [result1, result2] = await Promise.all([
        resolver.resolveForAsset(ASSET_IRI, "ems__Task"),
        resolver.resolveForAsset(ASSET_IRI, "ems__Task"),
      ]);

      expect(result1).toEqual(result2);
      expect(result1).toHaveLength(1);
    });

    it("should work after cache invalidation cycle", async () => {
      await seedTaskWithStart(store);

      // First resolution + evaluation
      const commands1 = await resolver.resolveForAsset(ASSET_IRI, "ems__Task");
      const result1 = await evaluator.evaluate(
        commands1[0].command.precondition,
        ASSET_IRI,
      );
      expect(result1).toBe(true);

      // Invalidate all caches
      resolver.invalidateCache();
      evaluator.invalidateCache();

      // Second resolution + evaluation should produce same results
      const commands2 = await resolver.resolveForAsset(ASSET_IRI, "ems__Task");
      const result2 = await evaluator.evaluate(
        commands2[0].command.precondition,
        ASSET_IRI,
      );
      expect(result2).toBe(true);
      expect(commands2[0].command.id).toBe(commands1[0].command.id);
    });

    it("should not resolve commands when triple store is empty", async () => {
      const emptyStore = new InMemoryTripleStore();
      const emptyResolver = new CommandResolver(emptyStore);

      const commands = await emptyResolver.resolveForAsset(ASSET_IRI, "ems__Task");
      expect(commands).toHaveLength(0);
    });

    it("should handle precondition evaluation when store is populated but target lacks the property", async () => {
      // Add a DIFFERENT asset with startTimestamp, but not our target
      const otherSubject = new IRI("https://exocortex.my/ontology/ems/other-task");
      await store.add(
        new Triple(
          otherSubject,
          Namespace.EMS.term("Effort_startTimestamp"),
          new Literal("2026-04-01T09:00:00"),
        ),
      );

      const commands = await resolver.resolveForAsset(ASSET_IRI, "ems__Task");
      const result = await evaluator.evaluate(
        commands[0].command.precondition,
        ASSET_IRI,
      );

      // Our target asset does NOT have the property, even though another asset does
      expect(result).toBe(false);
    });
  });
});
