/**
 * Smoke test: Vault Commands Pipeline (RFC-011/012).
 *
 * Verifies the full command pipeline for each category of vault commands:
 *   - Status commands: load, precondition filtering, grounding sets status
 *   - Criticality commands: zone property updates
 *   - Planning commands: property_set and property_delete groundings
 *   - Maintenance commands: removeProperty groundings
 *   - Creation commands: service_call grounding with inputSchema
 *
 * Uses real (non-mocked) services: InMemoryTripleStore, CommandResolver,
 * PreconditionEvaluator, GroundingExecutor, ServiceRegistry.
 */

import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { CommandResolver } from "../../../src/services/CommandResolver";
import { PreconditionEvaluator } from "../../../src/services/PreconditionEvaluator";
import {
  GroundingExecutor,
  ServiceRegistry,
  type IGroundingService,
  type UserInput,
} from "../../../src/services/GroundingExecutor";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";
import { GroundingType } from "../../../src/domain/constants/GroundingType";
import { IFileSystemReader, IFileSystemWriter } from "../../../src/interfaces/IFileSystemAdapter";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TASK_IRI = "https://exocortex.my/ontology/ems/task-smoke-001";
const FILE_PATH = "/vault/task-smoke-001.md";

// RFC 9d20c91f Phase 3: `exocmd__Grounding_type` is a wikilink-form UID ref into
// the `exocmd__GroundingType` catalog (mirror of
// packages/core/src/domain/constants/GroundingTypeUIDs.ts), NOT a bare
// string. A bare string fails CommandResolver.resolveGroundingTypeReference →
// grounding inert → command dropped from resolveForAsset.
const GROUNDING_TYPE_WIKILINK: Record<string, string> = {
  property_set: "[[cf3bb923-f1f1-40be-b728-782844402426]]",
  property_delete: "[[4bdf1d0b-e9da-4d96-bafe-c5aaef8c2bd5]]",
  composite: "[[8f9a57db-3865-4886-92fb-c5ab7f3c3fa3]]",
  service_call: "[[9bf9fc99-ac37-4e51-b9f5-bd920099947c]]",
  create_instance: "[[4367e2d6-6c92-450a-becb-abce1fb07682]]",
  property_append: "[[572f7e69-a8a1-42f6-8113-5aa65cc4b552]]",
  property_increment: "[[afc29f90-45eb-4f94-9fe2-2ce738759161]]",
  property_shift: "[[f4e5266f-f3cc-49fd-a5a5-ce1e8b7847a4]]",
  sparql_update: "[[79c3e709-8d1d-4694-bcc6-b9ff07d59b86]]",
  workflow_transition: "[[5c1a2552-d576-496d-8823-563573dd1e2f]]",
};

const TASK_FRONTMATTER = [
  "---",
  "exo__Asset_uid: task-smoke-001",
  "exo__Instance_class: '[[ems__Task]]'",
  "ems__Effort_status: '[[ems__EffortStatusBacklog]]'",
  "ems__Effort_zone: green",
  "ems__Effort_startTimestamp: '2026-04-01T09:00:00.000Z'",
  "ems__Effort_plannedEndTimestamp: '2026-04-05T18:00:00.000Z'",
  "---",
  "",
  "# Smoke Test Task",
].join("\n");

// ---------------------------------------------------------------------------
// In-memory file system
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
}

// ---------------------------------------------------------------------------
// Command seeding helpers
// ---------------------------------------------------------------------------

/** Seed a generic command+binding+precondition+grounding ecosystem in the store. */
async function seedCommand(
  store: InMemoryTripleStore,
  opts: {
    cmdUid: string;
    cmdLabel: string;
    category: string;
    preUid?: string;
    preSparqlAsk?: string;
    gndUid: string;
    gndType: string;
    gndTargetProperty?: string;
    gndTargetValueRef?: string;
    gndTargetValueLiteral?: string;
    gndTargetValueSubstitution?: string;
    bindUid: string;
    bindTargetClass: string;
    bindPosition?: string;
    bindOrder?: string;
    bindGroup?: string;
  },
): Promise<void> {
  // Precondition (optional)
  let preSubject: IRI | undefined;
  if (opts.preUid && opts.preSparqlAsk) {
    preSubject = new IRI(`obsidian://vault/${opts.preUid}.md`);
    await store.addAll([
      new Triple(preSubject, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Precondition")),
      new Triple(preSubject, Namespace.EXO.term("Asset_uid"), new Literal(opts.preUid)),
      new Triple(preSubject, Namespace.EXO.term("Asset_label"), new Literal(`Pre: ${opts.cmdLabel}`)),
      new Triple(preSubject, Namespace.EXOCMD.term("Precondition_sparqlAsk"), new Literal(opts.preSparqlAsk)),
    ]);
  }

  // Grounding
  const gndSubject = new IRI(`obsidian://vault/${opts.gndUid}.md`);
  const gndTriples: Triple[] = [
    new Triple(gndSubject, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Grounding")),
    new Triple(gndSubject, Namespace.EXO.term("Asset_uid"), new Literal(opts.gndUid)),
    new Triple(gndSubject, Namespace.EXO.term("Asset_label"), new Literal(`Gnd: ${opts.cmdLabel}`)),
    new Triple(
      gndSubject,
      Namespace.EXOCMD.term("Grounding_type"),
      new Literal(GROUNDING_TYPE_WIKILINK[opts.gndType] ?? opts.gndType),
    ),
  ];
  if (opts.gndTargetProperty) {
    gndTriples.push(
      new Triple(gndSubject, Namespace.EXOCMD.term("Grounding_targetProperty"), new Literal(opts.gndTargetProperty)),
    );
  }
  if (opts.gndTargetValueRef) {
    gndTriples.push(
      new Triple(gndSubject, Namespace.EXOCMD.term("Grounding_targetValueRef"), new Literal(opts.gndTargetValueRef)),
    );
  }
  if (opts.gndTargetValueLiteral) {
    gndTriples.push(
      new Triple(gndSubject, Namespace.EXOCMD.term("Grounding_targetValueLiteral"), new Literal(opts.gndTargetValueLiteral)),
    );
  }
  if (opts.gndTargetValueSubstitution) {
    gndTriples.push(
      new Triple(gndSubject, Namespace.EXOCMD.term("Grounding_targetValueSubstitution"), new Literal(opts.gndTargetValueSubstitution)),
    );
  }
  await store.addAll(gndTriples);

  // Command
  const cmdSubject = new IRI(`obsidian://vault/${opts.cmdUid}.md`);
  const cmdTriples: Triple[] = [
    new Triple(cmdSubject, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Command")),
    new Triple(cmdSubject, Namespace.EXO.term("Asset_uid"), new Literal(opts.cmdUid)),
    new Triple(cmdSubject, Namespace.EXO.term("Asset_label"), new Literal(opts.cmdLabel)),
    new Triple(cmdSubject, Namespace.EXOCMD.term("Command_grounding"), gndSubject),
    new Triple(cmdSubject, Namespace.EXOCMD.term("Command_category"), new Literal(opts.category)),
  ];
  if (preSubject) {
    cmdTriples.push(
      new Triple(cmdSubject, Namespace.EXOCMD.term("Command_precondition"), preSubject),
    );
  }
  await store.addAll(cmdTriples);

  // Binding
  const bindSubject = new IRI(`obsidian://vault/${opts.bindUid}.md`);
  const bindTriples: Triple[] = [
    new Triple(bindSubject, Namespace.RDF.term("type"), Namespace.EXOCMD.term("CommandBinding")),
    new Triple(bindSubject, Namespace.EXO.term("Asset_uid"), new Literal(opts.bindUid)),
    new Triple(bindSubject, Namespace.EXO.term("Asset_label"), new Literal(`Bind: ${opts.cmdLabel}`)),
    new Triple(bindSubject, Namespace.EXOCMD.term("CommandBinding_command"), cmdSubject),
    new Triple(bindSubject, Namespace.EXOCMD.term("CommandBinding_targetClass"), new Literal(opts.bindTargetClass)),
  ];
  if (opts.bindPosition) {
    bindTriples.push(
      new Triple(bindSubject, Namespace.EXOCMD.term("CommandBinding_position"), new Literal(opts.bindPosition)),
    );
  }
  if (opts.bindOrder) {
    bindTriples.push(
      new Triple(bindSubject, Namespace.EXOCMD.term("CommandBinding_order"), new Literal(opts.bindOrder)),
    );
  }
  if (opts.bindGroup) {
    bindTriples.push(
      new Triple(bindSubject, Namespace.EXOCMD.term("CommandBinding_group"), new Literal(opts.bindGroup)),
    );
  }
  await store.addAll(bindTriples);
}

/** Seed task triples for the TASK_IRI. */
async function seedTask(store: InMemoryTripleStore): Promise<void> {
  const subject = new IRI(TASK_IRI);
  await store.addAll([
    new Triple(subject, Namespace.RDF.term("type"), Namespace.EMS.term("Task")),
    new Triple(subject, Namespace.EXO.term("Asset_uid"), new Literal("task-smoke-001")),
    new Triple(subject, Namespace.EMS.term("Effort_status"), new Literal("ems__EffortStatusBacklog")),
    new Triple(subject, Namespace.EMS.term("Effort_zone"), new Literal("green")),
    new Triple(subject, Namespace.EMS.term("Effort_startTimestamp"), new Literal("2026-04-01T09:00:00.000Z")),
    new Triple(subject, Namespace.EMS.term("Effort_plannedEndTimestamp"), new Literal("2026-04-05T18:00:00.000Z")),
  ]);
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe("Smoke: Vault Commands Pipeline (all categories)", () => {
  let store: InMemoryTripleStore;
  let resolver: CommandResolver;
  let evaluator: PreconditionEvaluator;
  let groundingExecutor: GroundingExecutor;
  let fs: InMemoryFileSystem;
  let serviceRegistry: ServiceRegistry;

  beforeEach(async () => {
    store = new InMemoryTripleStore();
    resolver = new CommandResolver(store);
    evaluator = new PreconditionEvaluator(store);
    fs = new InMemoryFileSystem({ [FILE_PATH]: TASK_FRONTMATTER });
    serviceRegistry = new ServiceRegistry();
    groundingExecutor = new GroundingExecutor(fs, fs, serviceRegistry);
  });

  // -----------------------------------------------------------------------
  // Category 1: Status commands
  // -----------------------------------------------------------------------

  describe("Status commands", () => {
    const STATUS_COMMANDS = [
      { name: "Start", from: "ems__EffortStatusBacklog", to: "ems__EffortStatusDoing", uid: "cmd-start" },
      { name: "Complete", from: "ems__EffortStatusDoing", to: "ems__EffortStatusDone", uid: "cmd-complete" },
      { name: "Pause", from: "ems__EffortStatusDoing", to: "ems__EffortStatusBacklog", uid: "cmd-pause" },
      { name: "Resume", from: "ems__EffortStatusBacklog", to: "ems__EffortStatusDoing", uid: "cmd-resume" },
      { name: "Cancel", from: "ems__EffortStatusBacklog", to: "ems__EffortStatusCancelled", uid: "cmd-cancel" },
      { name: "Reopen", from: "ems__EffortStatusDone", to: "ems__EffortStatusBacklog", uid: "cmd-reopen" },
      { name: "Archive", from: "ems__EffortStatusDone", to: "ems__EffortStatusArchived", uid: "cmd-archive" },
    ];

    beforeEach(async () => {
      for (const cmd of STATUS_COMMANDS) {
        await seedCommand(store, {
          cmdUid: cmd.uid,
          cmdLabel: cmd.name,
          category: "status",
          preUid: `pre-${cmd.uid}`,
          preSparqlAsk: `PREFIX ems: <https://exocortex.my/ontology/ems#>\nASK { $target ems:Effort_status "${cmd.from}" }`,
          gndUid: `gnd-${cmd.uid}`,
          gndType: "property_set",
          gndTargetProperty: "ems__Effort_status",
          gndTargetValueRef: cmd.to,
          bindUid: `bind-${cmd.uid}`,
          bindTargetClass: "ems__Task",
          bindPosition: "header",
          bindOrder: String(STATUS_COMMANDS.indexOf(cmd) * 10),
          bindGroup: "status",
        });
      }
    });

    it("should load all 7 status commands for ems__Task", async () => {
      const commands = await resolver.resolveForAsset(TASK_IRI, "ems__Task");
      expect(commands).toHaveLength(7);
      expect(commands.every((c) => c.command.category === "status")).toBe(true);
    });

    it("should filter by precondition: only commands matching current status pass", async () => {
      await seedTask(store);

      const commands = await resolver.resolveForAsset(TASK_IRI, "ems__Task");
      const available: string[] = [];

      for (const cmd of commands) {
        const pass = await evaluator.evaluate(cmd.command.precondition, TASK_IRI);
        if (pass) available.push(cmd.command.name);
      }

      // Task is in Backlog, so "Start", "Resume", "Cancel" should pass
      // (Start and Resume both require Backlog as "from")
      expect(available).toContain("Start");
      expect(available).toContain("Cancel");
      expect(available).not.toContain("Complete");
      expect(available).not.toContain("Reopen");
    });

    it("should execute status grounding: sets ems__Effort_status in frontmatter", async () => {
      await seedTask(store);
      const commands = await resolver.resolveForAsset(TASK_IRI, "ems__Task");
      const startCmd = commands.find((c) => c.command.name === "Start");
      expect(startCmd).toBeDefined();

      const result = await groundingExecutor.execute(startCmd!.command.grounding, TASK_IRI, FILE_PATH);
      expect(result.success).toBe(true);

      const content = fs.getContent(FILE_PATH)!;
      expect(content).toContain("ems__EffortStatusDoing");
    });
  });

  // -----------------------------------------------------------------------
  // Category 2: Criticality commands
  // -----------------------------------------------------------------------

  describe("Criticality commands", () => {
    const ZONES = [
      { name: "Set Green Zone", zone: "green", uid: "cmd-green" },
      { name: "Set Yellow Zone", zone: "yellow", uid: "cmd-yellow" },
      { name: "Set Red Zone", zone: "red", uid: "cmd-red" },
    ];

    beforeEach(async () => {
      for (const z of ZONES) {
        await seedCommand(store, {
          cmdUid: z.uid,
          cmdLabel: z.name,
          category: "criticality",
          gndUid: `gnd-${z.uid}`,
          gndType: "property_set",
          gndTargetProperty: "ems__Effort_zone",
          gndTargetValueLiteral: z.zone,
          bindUid: `bind-${z.uid}`,
          bindTargetClass: "ems__Task",
          bindPosition: "header",
          bindGroup: "criticality",
        });
      }
    });

    it("should load all 3 criticality commands for ems__Task", async () => {
      const commands = await resolver.resolveForAsset(TASK_IRI, "ems__Task");
      expect(commands).toHaveLength(3);
      expect(commands.every((c) => c.command.category === "criticality")).toBe(true);
    });

    it("should execute zone grounding: sets ems__Effort_zone to red", async () => {
      const commands = await resolver.resolveForAsset(TASK_IRI, "ems__Task");
      const redCmd = commands.find((c) => c.command.name === "Set Red Zone");
      expect(redCmd).toBeDefined();

      const result = await groundingExecutor.execute(redCmd!.command.grounding, TASK_IRI, FILE_PATH);
      expect(result.success).toBe(true);

      const content = fs.getContent(FILE_PATH)!;
      expect(content).toContain("ems__Effort_zone: red");
    });
  });

  // -----------------------------------------------------------------------
  // Category 3: Planning commands (property_set + property_delete)
  // -----------------------------------------------------------------------

  describe("Planning commands", () => {
    beforeEach(async () => {
      // Set planned end date
      await seedCommand(store, {
        cmdUid: "cmd-set-deadline",
        cmdLabel: "Set Deadline",
        category: "planning",
        gndUid: "gnd-set-deadline",
        gndType: "property_set",
        gndTargetProperty: "ems__Effort_plannedEndTimestamp",
        gndTargetValueSubstitution: "$now",
        bindUid: "bind-set-deadline",
        bindTargetClass: "ems__Task",
        bindGroup: "planning",
      });

      // Remove planned end date
      await seedCommand(store, {
        cmdUid: "cmd-remove-deadline",
        cmdLabel: "Remove Deadline",
        category: "planning",
        preUid: "pre-has-deadline",
        preSparqlAsk: `PREFIX ems: <https://exocortex.my/ontology/ems#>\nASK { $target ems:Effort_plannedEndTimestamp ?ts }`,
        gndUid: "gnd-remove-deadline",
        gndType: "property_delete",
        gndTargetProperty: "ems__Effort_plannedEndTimestamp",
        bindUid: "bind-remove-deadline",
        bindTargetClass: "ems__Task",
        bindGroup: "planning",
      });
    });

    it("should load planning commands with property_set and property_delete groundings", async () => {
      const commands = await resolver.resolveForAsset(TASK_IRI, "ems__Task");
      expect(commands).toHaveLength(2);

      const types = commands.map((c) => c.command.grounding.type);
      expect(types).toContain(GroundingType.PROPERTY_SET);
      expect(types).toContain(GroundingType.PROPERTY_DELETE);
    });

    it("should execute property_set grounding with $now substitution", async () => {
      const commands = await resolver.resolveForAsset(TASK_IRI, "ems__Task");
      const setCmd = commands.find((c) => c.command.grounding.type === GroundingType.PROPERTY_SET);
      expect(setCmd).toBeDefined();

      const result = await groundingExecutor.execute(setCmd!.command.grounding, TASK_IRI, FILE_PATH);
      expect(result.success).toBe(true);

      const content = fs.getContent(FILE_PATH)!;
      // $now should be replaced with an ISO timestamp
      expect(content).toMatch(/ems__Effort_plannedEndTimestamp:.*\d{4}-\d{2}-\d{2}T/);
    });

    it("should execute property_delete grounding: removes property from frontmatter", async () => {
      await seedTask(store);

      const commands = await resolver.resolveForAsset(TASK_IRI, "ems__Task");
      const deleteCmd = commands.find((c) => c.command.grounding.type === GroundingType.PROPERTY_DELETE);
      expect(deleteCmd).toBeDefined();

      // Precondition should pass (task has planned end timestamp)
      const pass = await evaluator.evaluate(deleteCmd!.command.precondition, TASK_IRI);
      expect(pass).toBe(true);

      const result = await groundingExecutor.execute(deleteCmd!.command.grounding, TASK_IRI, FILE_PATH);
      expect(result.success).toBe(true);

      const content = fs.getContent(FILE_PATH)!;
      expect(content).not.toContain("ems__Effort_plannedEndTimestamp");
      // Other properties should remain
      expect(content).toContain("exo__Asset_uid");
    });
  });

  // -----------------------------------------------------------------------
  // Category 4: Maintenance commands (removeProperty)
  // -----------------------------------------------------------------------

  describe("Maintenance commands", () => {
    beforeEach(async () => {
      await seedCommand(store, {
        cmdUid: "cmd-remove-start",
        cmdLabel: "Remove Start Timestamp",
        category: "maintenance",
        preUid: "pre-has-start",
        preSparqlAsk: `PREFIX ems: <https://exocortex.my/ontology/ems#>\nASK { $target ems:Effort_startTimestamp ?ts }`,
        gndUid: "gnd-remove-start",
        gndType: "property_delete",
        gndTargetProperty: "ems__Effort_startTimestamp",
        bindUid: "bind-remove-start",
        bindTargetClass: "ems__Task",
        bindGroup: "maintenance",
      });
    });

    it("should resolve maintenance command with property_delete grounding", async () => {
      const commands = await resolver.resolveForAsset(TASK_IRI, "ems__Task");
      expect(commands).toHaveLength(1);

      const cmd = commands[0];
      expect(cmd.command.category).toBe("maintenance");
      expect(cmd.command.grounding.type).toBe(GroundingType.PROPERTY_DELETE);
      expect(cmd.command.grounding.targetProperty).toBe("ems__Effort_startTimestamp");
    });

    it("should remove the property from frontmatter on execution", async () => {
      const commands = await resolver.resolveForAsset(TASK_IRI, "ems__Task");
      const result = await groundingExecutor.execute(commands[0].command.grounding, TASK_IRI, FILE_PATH);
      expect(result.success).toBe(true);

      const content = fs.getContent(FILE_PATH)!;
      expect(content).not.toContain("ems__Effort_startTimestamp");
      expect(content).toContain("ems__Effort_status");
    });
  });

  // -----------------------------------------------------------------------
  // Category 5: Creation commands (service_call)
  // -----------------------------------------------------------------------

  describe("Creation commands (service_call)", () => {
    let capturedCalls: Array<{ targetIRI: string; input?: UserInput }>;

    beforeEach(async () => {
      capturedCalls = [];

      // Register a mock service
      const mockService: IGroundingService = {
        execute: async (targetIRI: string, userInput?: UserInput) => {
          capturedCalls.push({ targetIRI, input: userInput });
        },
      };
      serviceRegistry.register("CreateSubtaskService", mockService);

      await seedCommand(store, {
        cmdUid: "cmd-create-subtask",
        cmdLabel: "Create Subtask",
        category: "creation",
        gndUid: "gnd-create-subtask",
        gndType: "service_call",
        gndTargetProperty: "CreateSubtaskService", // serviceId reuses targetProperty
        bindUid: "bind-create-subtask",
        bindTargetClass: "ems__Task",
        bindGroup: "creation",
      });
    });

    it("should resolve service_call grounding type", async () => {
      const commands = await resolver.resolveForAsset(TASK_IRI, "ems__Task");
      expect(commands).toHaveLength(1);

      const cmd = commands[0];
      expect(cmd.command.grounding.type).toBe(GroundingType.SERVICE_CALL);
      expect(cmd.command.grounding.targetProperty).toBe("CreateSubtaskService");
    });

    it("should delegate to the registered service on execution", async () => {
      const commands = await resolver.resolveForAsset(TASK_IRI, "ems__Task");
      const result = await groundingExecutor.execute(
        commands[0].command.grounding,
        TASK_IRI,
        FILE_PATH,
        { title: "My Subtask" },
      );

      expect(result.success).toBe(true);
      expect(capturedCalls).toHaveLength(1);
      expect(capturedCalls[0].targetIRI).toBe(TASK_IRI);
      expect(capturedCalls[0].input).toEqual({ title: "My Subtask" });
    });

    it("should fail gracefully when service is not registered", async () => {
      // Use a fresh registry with no services
      const emptyRegistry = new ServiceRegistry();
      const executor = new GroundingExecutor(fs, fs, emptyRegistry);

      const commands = await resolver.resolveForAsset(TASK_IRI, "ems__Task");
      const result = await executor.execute(commands[0].command.grounding, TASK_IRI, FILE_PATH);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Service not found");
      expect(result.error).toContain("CreateSubtaskService");
    });
  });

  // -----------------------------------------------------------------------
  // Cross-category: mixed resolution
  // -----------------------------------------------------------------------

  describe("Cross-category resolution", () => {
    it("should resolve commands from multiple categories for the same class", async () => {
      // Seed one from each category
      await seedCommand(store, {
        cmdUid: "cmd-status-x",
        cmdLabel: "Status X",
        category: "status",
        gndUid: "gnd-status-x",
        gndType: "property_set",
        gndTargetProperty: "ems__Effort_status",
        gndTargetValueLiteral: "done",
        bindUid: "bind-status-x",
        bindTargetClass: "ems__Task",
        bindOrder: "10",
      });

      await seedCommand(store, {
        cmdUid: "cmd-maint-x",
        cmdLabel: "Maintenance X",
        category: "maintenance",
        gndUid: "gnd-maint-x",
        gndType: "property_delete",
        gndTargetProperty: "ems__Effort_zone",
        bindUid: "bind-maint-x",
        bindTargetClass: "ems__Task",
        bindOrder: "20",
      });

      const commands = await resolver.resolveForAsset(TASK_IRI, "ems__Task");
      expect(commands).toHaveLength(2);

      const categories = commands.map((c) => c.command.category);
      expect(categories).toContain("status");
      expect(categories).toContain("maintenance");
    });
  });
});
