/**
 * vault-exodev ems__Bug 0cae1d41 — the plugin draws ONE button for a command
 * that two classes of the asset both bind.
 *
 * Before the fix `CommandResolver.resolveForAssetMulti` returned one entry per
 * matching binding, and `DynamicCommandButtonGroupBuilder` turned each into a
 * button with the id `dynamic-cmd-<command.id>` — two buttons, one React key
 * (`ActionButtonsGroup` renders `key={button.id}`). Founder decision
 * 2026-11-11: one command — one button.
 *
 * Realism: REAL `InMemoryTripleStore` + `CommandResolver` +
 * `PreconditionEvaluator` + `DynamicCommandButtonGroupBuilder.build`; the only
 * stub is `CommandExecutionFlow` (invoked on click, never during resolution).
 * Co-located under `tests/unit/integration/` — the plugin jest `testMatch`
 * runs `tests/unit/**` only (precedent: alias-instance-class-exocmd-resolution).
 *
 * Axis names are the FIRST token of the test title (mutant-driver `red_re`).
 */

import {
  InMemoryTripleStore,
  CommandResolver,
  PreconditionEvaluator,
  CommandExecutionFlow,
  Triple,
  IRI,
  Literal,
  Namespace,
} from "@kitelev/exocortex-core";
import { DynamicCommandButtonGroupBuilder } from "../../../src/presentation/builders/button-groups/DynamicCommandButtonGroupBuilder";
import type { ButtonBuilderContext } from "../../../src/presentation/builders/button-groups/ButtonBuilderTypes";

const CMD_BLOCKER = "0cae0102-0000-4000-8000-000000000001";
const CMD_OTHER = "0cae0102-0000-4000-8000-000000000002";
const PROPERTY_SET_GND_TYPE = "[[cf3bb923-f1f1-40be-b728-782844402426]]";

async function addCommand(
  store: InMemoryTripleStore,
  uid: string,
  label: string,
  gndUid: string,
): Promise<void> {
  const cmd = new IRI(`obsidian://vault/${uid}.md`);
  // The grounding needs its OWN uuid: a file name like `gnd-<command uuid>.md`
  // makes the grounding-ref resolver pick the embedded COMMAND uuid.
  const gnd = new IRI(`obsidian://vault/${gndUid}.md`);
  await store.addAll([
    new Triple(gnd, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Grounding")),
    new Triple(gnd, Namespace.EXO.term("Asset_uid"), new Literal(gndUid)),
    new Triple(gnd, Namespace.EXO.term("Asset_label"), new Literal(`Gnd ${label}`)),
    new Triple(gnd, Namespace.EXOCMD.term("Grounding_type"), new Literal(PROPERTY_SET_GND_TYPE)),
    new Triple(gnd, Namespace.EXOCMD.term("Grounding_targetProperty"), new Literal("ems__Effort_status")),
    new Triple(gnd, Namespace.EXOCMD.term("Grounding_targetValueLiteral"), new Literal("done")),
    new Triple(cmd, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Command")),
    new Triple(cmd, Namespace.EXO.term("Asset_uid"), new Literal(uid)),
    new Triple(cmd, Namespace.EXO.term("Asset_label"), new Literal(label)),
    new Triple(cmd, Namespace.EXOCMD.term("Command_grounding"), gnd),
    new Triple(cmd, Namespace.EXOCMD.term("Command_category"), new Literal("maintenance")),
  ]);
}

async function addBinding(
  store: InMemoryTripleStore,
  uid: string,
  commandUid: string,
  targetClass: string,
  order: number,
): Promise<void> {
  const b = new IRI(`obsidian://vault/${uid}.md`);
  await store.addAll([
    new Triple(b, Namespace.RDF.term("type"), Namespace.EXOCMD.term("CommandBinding")),
    new Triple(b, Namespace.EXO.term("Asset_uid"), new Literal(uid)),
    new Triple(b, Namespace.EXO.term("Asset_label"), new Literal(`Bind ${uid}`)),
    new Triple(b, Namespace.EXOCMD.term("CommandBinding_command"), new IRI(`obsidian://vault/${commandUid}.md`)),
    new Triple(b, Namespace.EXOCMD.term("CommandBinding_targetClass"), new Literal(targetClass)),
    new Triple(b, Namespace.EXOCMD.term("CommandBinding_order"), new Literal(String(order))),
  ]);
}

function context(instanceClass: string[]): ButtonBuilderContext {
  return {
    app: {} as ButtonBuilderContext["app"],
    settings: {} as ButtonBuilderContext["settings"],
    plugin: {} as ButtonBuilderContext["plugin"],
    file: {
      path: "efforts/dt-task.md",
      basename: "dt-task",
      parent: { path: "efforts" },
    } as ButtonBuilderContext["file"],
    metadata: {
      exo__Asset_uid: "obsidian://vault/efforts/dt-task.md",
      exo__Instance_class: instanceClass,
    },
    instanceClass,
    visibilityContext: {
      instanceClass,
      currentStatus: null,
      metadata: {},
      isArchived: false,
      currentFolder: "efforts",
      expectedFolder: "efforts",
      classIsPrototype: false,
    },
    logger: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as unknown as ButtonBuilderContext["logger"],
    refresh: jest.fn().mockResolvedValue(undefined),
  };
}

describe("plugin buttons — one command, one button (ems__Bug 0cae1d41)", () => {
  let builder: DynamicCommandButtonGroupBuilder;

  beforeEach(async () => {
    const store = new InMemoryTripleStore();
    await addCommand(store, CMD_BLOCKER, "Set blocker", "0cae0103-0000-4000-8000-000000000001");
    await addCommand(store, CMD_OTHER, "Other", "0cae0103-0000-4000-8000-000000000002");
    await addBinding(store, "0cae0106-0000-4000-8000-000000000001", CMD_BLOCKER, "test__Act", 217);
    await addBinding(store, "0cae0106-0000-4000-8000-000000000002", CMD_BLOCKER, "test__Dt", 217);
    await addBinding(store, "0cae0106-0000-4000-8000-000000000003", CMD_OTHER, "test__Act", 300);

    builder = new DynamicCommandButtonGroupBuilder({
      commandResolver: new CommandResolver(store),
      preconditionEvaluator: new PreconditionEvaluator(store),
      commandExecutionFlow: { run: jest.fn() } as unknown as CommandExecutionFlow,
    });
  });

  it("P1 a command bound on both classes of the asset gets exactly one button", async () => {
    const buttons = await builder.build(context(["[[test__Act]]", "[[test__Dt]]"]));
    const ids = buttons.map((b) => b.id);
    expect(ids.filter((id) => id === `dynamic-cmd-${CMD_BLOCKER}`)).toHaveLength(1);
  });

  it("P3 another command on the same asset keeps its own button, after the collapsed one", async () => {
    const buttons = await builder.build(context(["[[test__Act]]", "[[test__Dt]]"]));
    const ids = buttons.map((b) => b.id);
    expect(ids.indexOf(`dynamic-cmd-${CMD_OTHER}`)).toBeGreaterThan(
      ids.indexOf(`dynamic-cmd-${CMD_BLOCKER}`),
    );
    expect(ids).toContain(`dynamic-cmd-${CMD_BLOCKER}`);
  });

  it("P2 control — an asset with one bound class gets the same command once", async () => {
    const buttons = await builder.build(context(["[[test__Dt]]"]));
    expect(buttons.map((b) => b.id)).toEqual([`dynamic-cmd-${CMD_BLOCKER}`]);
  });
});
