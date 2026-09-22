/**
 * req c4adae42 (ticket efe33c5d) — `format: "asset-reference"` on a string
 * input-schema property is projected by the loader as an `assetRef` form
 * field, and what the picker commits (`"[[uid]]"`) — or the text fallback's
 * bare uid — reaches the executor in a form it accepts.
 *
 * Production-shape, end to end on the REAL pipeline: the REAL `CommandResolver`
 * loads a `property_set` grounding from an in-memory store (the live
 * set-parent shape, exoas-exocmd `18f12de2`), the REAL `CommandExecutionFlow`
 * prompts through a `CommandPromptAdapter` that ASSERTS the schema it is
 * handed (this is what distinguishes the loader from the executor — without
 * it the axis would stay green on a loader that projects `text`) and returns
 * the picker's / the text field's value, and the REAL `GroundingExecutor` over
 * the REAL `FrontmatterService` writes the frontmatter. Only the fs ports
 * (reader / writer) are faked — the same seam as
 * `grounding-asset-reference-input.integration.test.ts` (req b06129dc).
 *
 * Revert-verify (PR body): mutant M1 (drop the `format` read in the loader)
 * → P1 RED at the prompt-adapter assertion; P2 (bare uid) is the text-fallback
 * control and P3 the executor-side control (already locked by b06129dc).
 */
import {
  CommandResolver,
  type ResolvedCommand,
} from "../../../src/services/CommandResolver";
import {
  CommandExecutionFlow,
  type CommandPromptAdapter,
} from "../../../src/services/CommandExecutionFlow";
import {
  GroundingExecutor,
  ServiceRegistry,
  type UserInput,
} from "../../../src/services/GroundingExecutor";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";
import type { INotificationService } from "../../../src/interfaces/INotificationService";
import type { ILogger } from "../../../src/interfaces/ILogger";
import { parseFrontmatterAsReader } from "@kitelev/exocortex-test-utils";

const REQ = "@req:c4adae42-a109-4dd8-ae85-530a58a65869";
// Real GroundingType catalog UID (packages/core/src/domain/constants/GroundingTypeUIDs.ts).
const GT_PROPERTY_SET = "cf3bb923-f1f1-40be-b728-782844402426";
const PARENT_UID = "3f1d005c-7a2e-4b8f-9c1d-5e6f7a8b9c0d";
const TARGET_IRI = "obsidian://vault/assetspaces/kitelev/exoas-my/task.md";
const FILE_PATH = "assetspaces/kitelev/exoas-my/task.md";
const TARGET_CONTENT = [
  "---",
  "exo__Asset_uid: 11111111-2222-3333-4444-555555555555",
  'exo__Asset_label: "Some task"',
  "---",
  "Body",
].join("\n");

/** The live `set-parent` grounding + command (exoas-exocmd 18f12de2 / 2d57794e), as vault triples. */
async function seedSetParent(store: InMemoryTripleStore): Promise<void> {
  const grounding = new IRI("obsidian://vault/gnd-set-parent.md");
  const command = new IRI("obsidian://vault/cmd-set-parent.md");
  await store.addAll([
    new Triple(
      grounding,
      Namespace.RDF.term("type"),
      Namespace.EXOCMD.term("Grounding"),
    ),
    new Triple(
      grounding,
      Namespace.EXO.term("Asset_uid"),
      new Literal("gnd-set-parent"),
    ),
    new Triple(
      grounding,
      Namespace.EXO.term("Asset_label"),
      new Literal("Set parent grounding"),
    ),
    new Triple(
      grounding,
      Namespace.EXOCMD.term("Grounding_type"),
      new Literal(`[[${GT_PROPERTY_SET}]]`),
    ),
    new Triple(
      grounding,
      Namespace.EXOCMD.term("Grounding_targetProperty"),
      new Literal("ems__Effort_parent"),
    ),
    new Triple(
      grounding,
      Namespace.EXOCMD.term("Grounding_targetValueRef"),
      new Literal("$input.parent"),
    ),
    new Triple(
      grounding,
      Namespace.EXOCMD.term("Grounding_inputSchema"),
      new Literal(
        JSON.stringify({
          type: "object",
          properties: {
            parent: {
              type: "string",
              title: "Parent",
              format: "asset-reference",
            },
          },
          required: ["parent"],
        }),
      ),
    ),
    new Triple(
      command,
      Namespace.RDF.term("type"),
      Namespace.EXOCMD.term("Command"),
    ),
    new Triple(
      command,
      Namespace.EXO.term("Asset_uid"),
      new Literal("cmd-set-parent"),
    ),
    new Triple(
      command,
      Namespace.EXO.term("Asset_label"),
      new Literal("Set Parent"),
    ),
    new Triple(command, Namespace.EXOCMD.term("Command_grounding"), grounding),
  ]);
}

function makeReader() {
  return {
    readFile: jest.fn().mockResolvedValue(TARGET_CONTENT),
    fileExists: jest.fn().mockResolvedValue(true),
    getMarkdownFiles: jest.fn().mockResolvedValue([]),
  };
}

function makeWriter() {
  return {
    createFile: jest.fn().mockResolvedValue(""),
    writeFile: jest.fn().mockResolvedValue(undefined),
    updateFile: jest.fn().mockResolvedValue(undefined),
    deleteFile: jest.fn().mockResolvedValue(undefined),
    renameFile: jest.fn().mockResolvedValue(undefined),
  };
}

const silentNotifications: INotificationService = {
  info: () => undefined,
  success: () => undefined,
  error: () => undefined,
  warn: () => undefined,
  confirm: async () => true,
};
const silentLogger: ILogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

describe("req c4adae42 — format: asset-reference reaches the form as assetRef and the executor as one link [REVERT-VERIFY]", () => {
  let store: InMemoryTripleStore;
  let writer: ReturnType<typeof makeWriter>;
  let seenSchema: ReadonlyArray<unknown> | null;

  beforeEach(async () => {
    store = new InMemoryTripleStore();
    await seedSetParent(store);
    writer = makeWriter();
    seenSchema = null;
  });

  /** Run the real resolver → flow → executor with a prompt that returns `answer` for `parent`. */
  async function runSetParent(
    answer: string,
  ): Promise<{ written: string; fields: Array<Record<string, unknown>> }> {
    const resolver = new CommandResolver(store);
    const command = await resolver.loadCommand("cmd-set-parent");
    if (!command) throw new Error("resolver did not load cmd-set-parent");
    const rc: ResolvedCommand = {
      command,
      binding: {
        id: "binding-1",
        label: "Set Parent",
        commandRef: "cmd-set-parent",
        targetClass: "ems__Task",
      },
    };
    const prompts: CommandPromptAdapter = {
      confirm: async () => true,
      promptInputSchema: async (
        fields: ReadonlyArray<unknown>,
      ): Promise<UserInput | null> => {
        seenSchema = fields;
        return { parent: answer };
      },
    };
    const executor = new GroundingExecutor(
      makeReader(),
      writer,
      new ServiceRegistry(),
    );
    const flow = new CommandExecutionFlow(
      executor,
      silentNotifications,
      silentLogger,
      prompts,
      store,
    );
    await flow.run(rc, { targetIRI: TARGET_IRI, filePath: FILE_PATH });
    const written =
      (writer.updateFile.mock.calls[0]?.[1] as string | undefined) ?? "";
    return {
      written,
      fields: (seenSchema ?? []) as Array<Record<string, unknown>>,
    };
  }

  it(`P1 the form receives \`parent\` as assetRef and the picker's quoted "[[uid]]" is written as ONE link ${REQ}`, async () => {
    // `ReferencePicker.toReferenceWikilink` commits the QUOTED form '"[[uid]]"'.
    const { written, fields } = await runSetParent(`"[[${PARENT_UID}]]"`);
    // Loader half: what the modal is handed. This assertion is the axis —
    // the executor accepts "[[uid]]" regardless of the field type.
    expect(fields).toEqual([
      { name: "parent", type: "assetRef", label: "Parent", required: true },
    ]);
    // Executor half: the reference lands once, never "[[[[uid]]]]".
    expect(writer.updateFile).toHaveBeenCalledTimes(1);
    expect(written).toContain(`ems__Effort_parent: "[[${PARENT_UID}]]"`);
    expect(written).not.toContain("[[[[");
    expect(parseFrontmatterAsReader(written).ems__Effort_parent).toBe(
      `[[${PARENT_UID}]]`,
    );
  });

  it(`P2 (text fallback) a bare uid typed into the plain input is written as the same single link ${REQ}`, async () => {
    const { written, fields } = await runSetParent(PARENT_UID);
    expect(fields.map((f) => f.type)).toEqual(["assetRef"]);
    expect(parseFrontmatterAsReader(written).ems__Effort_parent).toBe(
      `[[${PARENT_UID}]]`,
    );
  });

  it(`P3 (executor control, req b06129dc) an unquoted [[uid]] pasted into the text fallback is normalised too ${REQ}`, async () => {
    const { written } = await runSetParent(`[[${PARENT_UID}]]`);
    expect(parseFrontmatterAsReader(written).ems__Effort_parent).toBe(
      `[[${PARENT_UID}]]`,
    );
  });
});
