/**
 * Integration test for the Dynamic Command System pipeline (RFC-009).
 *
 * Simulates the "Remove Start Timestamp" example from RFC-009 §6:
 * CommandResolver → PreconditionEvaluator → GroundingExecutor
 *
 * Uses InMemoryTripleStore with manually added triples matching
 * the vault example files in docs/examples/rfc-009/.
 *
 * Issue #2434
 */
import { CommandResolver } from "../../../src/services/CommandResolver";
import { PreconditionEvaluator } from "../../../src/services/PreconditionEvaluator";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";

// -- UUIDs matching docs/examples/rfc-009/ --
const PRE_UID = "25b8c47e-0c88-44e8-93ce-7c4f0bc141a4";
const GND_UID = "58714ab2-c155-47d8-a8bb-38da317817ad";
const CMD_UID = "a7d3573a-bb3a-4068-9792-d715e4b104b2";
const BIND_UID = "46a8b410-5454-4e90-a8e5-8ecd406479ce";

const TARGET_ASSET_IRI = "obsidian://vault/test-task-001.md";

async function loadExampleTriples(store: InMemoryTripleStore): Promise<void> {
  const preSub = new IRI(`obsidian://vault/${PRE_UID}.md`);
  const gndSub = new IRI(`obsidian://vault/${GND_UID}.md`);
  const cmdSub = new IRI(`obsidian://vault/${CMD_UID}.md`);
  const bindSub = new IRI(`obsidian://vault/${BIND_UID}.md`);

  // Precondition asset
  await store.addAll([
    new Triple(preSub, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Precondition")),
    new Triple(preSub, Namespace.EXO.term("Asset_uid"), new Literal(PRE_UID)),
    new Triple(preSub, Namespace.EXO.term("Asset_label"), new Literal("Has start timestamp")),
    new Triple(
      preSub,
      Namespace.EXOCMD.term("Precondition_sparqlAsk"),
      new Literal("PREFIX ems: <https://exocortex.my/ontology/ems#>\nASK { $target ems:Effort_startTimestamp ?ts . }"),
    ),
  ]);

  // Grounding asset
  await store.addAll([
    new Triple(gndSub, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Grounding")),
    new Triple(gndSub, Namespace.EXO.term("Asset_uid"), new Literal(GND_UID)),
    new Triple(gndSub, Namespace.EXO.term("Asset_label"), new Literal("Remove start timestamp")),
    new Triple(gndSub, Namespace.EXOCMD.term("Grounding_type"), new Literal("property_delete")),
    new Triple(gndSub, Namespace.EXOCMD.term("Grounding_targetProperty"), new Literal("ems__Effort_startTimestamp")),
  ]);

  // Command asset
  await store.addAll([
    new Triple(cmdSub, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Command")),
    new Triple(cmdSub, Namespace.EXO.term("Asset_uid"), new Literal(CMD_UID)),
    new Triple(cmdSub, Namespace.EXO.term("Asset_label"), new Literal("Remove Start Timestamp")),
    new Triple(cmdSub, Namespace.EXOCMD.term("Command_icon"), new Literal("clock-x")),
    new Triple(cmdSub, Namespace.EXOCMD.term("Command_precondition"), preSub),
    new Triple(cmdSub, Namespace.EXOCMD.term("Command_grounding"), gndSub),
    new Triple(cmdSub, Namespace.EXOCMD.term("Command_confirmMessage"), new Literal("Remove start timestamp from this asset?")),
    new Triple(cmdSub, Namespace.EXOCMD.term("Command_successMessage"), new Literal("Start timestamp removed")),
    new Triple(cmdSub, Namespace.EXOCMD.term("Command_category"), new Literal("maintenance")),
  ]);

  // Binding asset
  await store.addAll([
    new Triple(bindSub, Namespace.RDF.term("type"), Namespace.EXOCMD.term("CommandBinding")),
    new Triple(bindSub, Namespace.EXO.term("Asset_uid"), new Literal(BIND_UID)),
    new Triple(bindSub, Namespace.EXO.term("Asset_label"), new Literal("Remove Start Timestamp for Tasks")),
    new Triple(bindSub, Namespace.EXOCMD.term("CommandBinding_command"), cmdSub),
    new Triple(bindSub, Namespace.EXOCMD.term("CommandBinding_targetClass"), new Literal("ems__Task")),
    new Triple(bindSub, Namespace.EXOCMD.term("CommandBinding_position"), new Literal("inline")),
    new Triple(bindSub, Namespace.EXOCMD.term("CommandBinding_order"), new Literal("10")),
    new Triple(bindSub, Namespace.EXOCMD.term("CommandBinding_group"), new Literal("maintenance")),
  ]);
}

describe("Dynamic Command Pipeline — Remove Start Timestamp (RFC-009 §6)", () => {
  let store: InMemoryTripleStore;
  let resolver: CommandResolver;
  let evaluator: PreconditionEvaluator;

  beforeEach(async () => {
    store = new InMemoryTripleStore();
    resolver = new CommandResolver(store);
    evaluator = new PreconditionEvaluator(store);
    await loadExampleTriples(store);
  });

  describe("CommandResolver", () => {
    it("should resolve the command for ems__Task assets", async () => {
      const commands = await resolver.resolveForAsset(TARGET_ASSET_IRI, "ems__Task");

      expect(commands).toHaveLength(1);
      expect(commands[0].command.name).toBe("Remove Start Timestamp");
      expect(commands[0].command.icon).toBe("clock-x");
      expect(commands[0].command.category).toBe("maintenance");
      expect(commands[0].binding.position).toBe("inline");
      expect(commands[0].binding.order).toBe(10);
    });

    it("should load full command with precondition and grounding", async () => {
      const cmd = await resolver.loadCommand(CMD_UID);

      expect(cmd).not.toBeNull();
      expect(cmd!.name).toBe("Remove Start Timestamp");
      expect(cmd!.precondition).toBeDefined();
      expect(cmd!.precondition!.sparqlAsk).toContain("ASK");
      expect(cmd!.grounding.type).toBe("property_delete");
      expect(cmd!.grounding.targetProperty).toBe("ems__Effort_startTimestamp");
      expect(cmd!.confirmMessage).toBe("Remove start timestamp from this asset?");
      expect(cmd!.successMessage).toBe("Start timestamp removed");
    });

    it("should not resolve command for non-Task assets", async () => {
      const commands = await resolver.resolveForAsset(TARGET_ASSET_IRI, "ems__Project");

      expect(commands).toHaveLength(0);
    });
  });

  describe("PreconditionEvaluator", () => {
    it("should return true when asset has startTimestamp", async () => {
      // Add startTimestamp triple for the target asset
      const target = new IRI(TARGET_ASSET_IRI);
      await store.add(
        new Triple(target, Namespace.EMS.term("Effort_startTimestamp"), new Literal("2026-03-30T10:00:00+0500")),
      );

      const commands = await resolver.resolveForAsset(TARGET_ASSET_IRI, "ems__Task");
      const result = await evaluator.evaluate(commands[0].command.precondition, TARGET_ASSET_IRI);

      expect(result).toBe(true);
    });

    it("should return false when asset has no startTimestamp", async () => {
      // No startTimestamp triple for the target asset
      const commands = await resolver.resolveForAsset(TARGET_ASSET_IRI, "ems__Task");
      const result = await evaluator.evaluate(commands[0].command.precondition, TARGET_ASSET_IRI);

      expect(result).toBe(false);
    });
  });

  describe("Full pipeline: resolve → evaluate → verify grounding", () => {
    it("should complete the full pipeline for a task with startTimestamp", async () => {
      // Setup: asset with startTimestamp
      const target = new IRI(TARGET_ASSET_IRI);
      await store.add(
        new Triple(target, Namespace.EMS.term("Effort_startTimestamp"), new Literal("2026-03-30T10:00:00+0500")),
      );

      // Step 1: Resolve commands
      const commands = await resolver.resolveForAsset(TARGET_ASSET_IRI, "ems__Task");
      expect(commands).toHaveLength(1);

      const { command, binding } = commands[0];

      // Step 2: Evaluate precondition
      const available = await evaluator.evaluate(command.precondition, TARGET_ASSET_IRI);
      expect(available).toBe(true);

      // Step 3: Verify grounding definition is correct for execution
      expect(command.grounding.type).toBe("property_delete");
      expect(command.grounding.targetProperty).toBe("ems__Effort_startTimestamp");

      // Step 4: Verify binding metadata
      expect(binding.group).toBe("maintenance");
      expect(binding.position).toBe("inline");
    });

    it("should hide command when asset has no startTimestamp", async () => {
      // No startTimestamp — precondition should fail
      const commands = await resolver.resolveForAsset(TARGET_ASSET_IRI, "ems__Task");
      expect(commands).toHaveLength(1);

      const available = await evaluator.evaluate(commands[0].command.precondition, TARGET_ASSET_IRI);
      expect(available).toBe(false);

      // UI should NOT show the button
    });
  });
});
