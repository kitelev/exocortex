import {
  CommandExecutionFlow,
  type CommandPromptAdapter,
  type IFileOpener,
} from "../../src/services/CommandExecutionFlow";
import type {
  GroundingExecutor,
  ExecutionResult,
  UserInput,
} from "../../src/services/GroundingExecutor";
import type { ResolvedCommand } from "../../src/services/CommandResolver";
import type { INotificationService } from "../../src/interfaces/INotificationService";
import type { ILogger } from "../../src/interfaces/ILogger";
import type { GroundingDefinition } from "../../src/domain/models/CommandDefinition";
import { GroundingType } from "../../src/domain/constants/GroundingType";
import { DateFormatter } from "../../src/utilities/DateFormatter";
import { InMemoryTripleStore } from "../../src/infrastructure/rdf/InMemoryTripleStore";
import { IRI } from "../../src/domain/models/rdf/IRI";
import { Literal } from "../../src/domain/models/rdf/Literal";
import { Namespace } from "../../src/domain/models/rdf/Namespace";
import { Triple } from "../../src/domain/models/rdf/Triple";

const baseGrounding: GroundingDefinition = {
  id: "grounding-1",
  label: "g",
  type: GroundingType.PROPERTY_SET,
  targetProperty: "ems__Effort_status",
  // RFC 918a2b65 Phase 4: legacy `targetValue` was dropped from
  // GroundingDefinition; the typed ref-form replacement is `targetValueRef`.
  targetValueRef: "[[ems__EffortStatusDone]]",
};

function makeRC(
  commandOverrides?: Partial<ResolvedCommand["command"]>,
  groundingOverrides?: Partial<GroundingDefinition> & Record<string, unknown>,
): ResolvedCommand {
  return {
    command: {
      id: "cmd-1",
      name: "Test cmd",
      grounding: { ...baseGrounding, ...(groundingOverrides ?? {}) },
      ...commandOverrides,
    },
    binding: {
      id: "binding-1",
      label: "Test binding",
      commandRef: "cmd-1",
      targetClass: "ems__Task",
    },
  };
}

function makeFlow(overrides?: {
  groundingResult?: ExecutionResult;
  confirmResult?: boolean;
  promptResult?: UserInput | null;
  tripleStore?: InMemoryTripleStore;
  fileOpener?: IFileOpener;
  requiredPropertyResolver?: (
    hostClassUid: string,
  ) => Promise<
    Array<{
      propertyKey: string;
      label: string;
      fieldType: "text" | "date" | "number" | "boolean" | "assetRef";
      targetClassUid?: string;
    }>
  >;
}) {
  const groundingExecutor = {
    execute: jest
      .fn<Promise<ExecutionResult>, [unknown, string, string, UserInput?]>()
      .mockResolvedValue(overrides?.groundingResult ?? { success: true }),
  } as unknown as GroundingExecutor;

  const notificationService: jest.Mocked<INotificationService> = {
    info: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    confirm: jest.fn(),
  };

  const logger: jest.Mocked<ILogger> = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  const prompts: jest.Mocked<CommandPromptAdapter> = {
    confirm: jest.fn().mockResolvedValue(overrides?.confirmResult ?? true),
    promptInputSchema: jest
      .fn()
      .mockResolvedValue(overrides?.promptResult ?? null),
  };

  const tripleStore = overrides?.tripleStore;
  const fileOpener = overrides?.fileOpener;

  const flow = new CommandExecutionFlow(
    groundingExecutor,
    notificationService,
    logger,
    prompts,
    tripleStore,
    fileOpener,
    overrides?.requiredPropertyResolver,
  );

  return {
    flow,
    groundingExecutor,
    notificationService,
    logger,
    prompts,
    tripleStore,
    fileOpener,
  };
}

/**
 * Seed an InMemoryTripleStore with an asset whose `exo__Asset_label` is the
 * provided literal. Returns the store ready for use as `tripleStore` in
 * `makeFlow({ tripleStore })`.
 */
async function makeStoreWithAssetLabel(
  targetIRI: string,
  label: string,
): Promise<InMemoryTripleStore> {
  const store = new InMemoryTripleStore();
  await store.add(
    new Triple(
      new IRI(targetIRI),
      Namespace.EXO.term("Asset_label"),
      new Literal(label),
    ),
  );
  return store;
}

describe("CommandExecutionFlow", () => {
  describe("confirm gating", () => {
    it("skips execution when confirmMessage is set and user cancels", async () => {
      const { flow, groundingExecutor, prompts } = makeFlow({
        confirmResult: false,
      });
      const rc = makeRC({ confirmMessage: "Sure?" });

      await flow.run(rc, { targetIRI: "iri://x", filePath: "x.md" });

      expect(prompts.confirm).toHaveBeenCalledWith("Sure?");
      expect(groundingExecutor.execute).not.toHaveBeenCalled();
    });

    it("proceeds when confirmMessage is set and user accepts", async () => {
      const { flow, groundingExecutor, prompts } = makeFlow({
        confirmResult: true,
      });
      const rc = makeRC({ confirmMessage: "Sure?" });

      await flow.run(rc, { targetIRI: "iri://x", filePath: "x.md" });

      expect(prompts.confirm).toHaveBeenCalledWith("Sure?");
      expect(groundingExecutor.execute).toHaveBeenCalledTimes(1);
    });

    it("skips confirm prompt entirely when no confirmMessage", async () => {
      const { flow, groundingExecutor, prompts } = makeFlow();
      const rc = makeRC();

      await flow.run(rc, { targetIRI: "iri://x", filePath: "x.md" });

      expect(prompts.confirm).not.toHaveBeenCalled();
      expect(groundingExecutor.execute).toHaveBeenCalledTimes(1);
    });
  });

  describe("inputSchema modal", () => {
    it("opens prompt when grounding declares inputSchema and executes with merged userInput", async () => {
      const { flow, groundingExecutor, prompts } = makeFlow({
        promptResult: { label: "user-typed" },
      });
      const rc = makeRC(
        {},
        {
          inputSchema: [{ name: "label", type: "text" }],
        },
      );

      await flow.run(rc, {
        targetIRI: "iri://x",
        filePath: "x.md",
        injectedUserInput: { ownerIdentity: "[[!kitelev]]" },
      });

      expect(prompts.promptInputSchema).toHaveBeenCalledTimes(1);
      expect(groundingExecutor.execute).toHaveBeenCalledWith(
        expect.anything(),
        "iri://x",
        "x.md",
        // modal-collected values shallow-merge on top of injected defaults
        { ownerIdentity: "[[!kitelev]]", label: "user-typed" },
      );
    });

    it("modal value overrides injected default on key collision", async () => {
      const { flow, groundingExecutor } = makeFlow({
        promptResult: { folder: "user-folder" },
      });
      const rc = makeRC(
        {},
        { inputSchema: [{ name: "folder", type: "text" }] },
      );

      await flow.run(rc, {
        targetIRI: null,
        filePath: null,
        injectedUserInput: { folder: "default-folder" },
      });

      expect(groundingExecutor.execute).toHaveBeenCalledWith(
        expect.anything(),
        "",
        "",
        { folder: "user-folder" },
      );
    });

    it("aborts when user cancels the modal (returns null)", async () => {
      const { flow, groundingExecutor, prompts } = makeFlow({
        promptResult: null,
      });
      const rc = makeRC(
        {},
        { inputSchema: [{ name: "label", type: "text" }] },
      );

      await flow.run(rc, { targetIRI: "iri://x", filePath: "x.md" });

      expect(prompts.promptInputSchema).toHaveBeenCalled();
      expect(groundingExecutor.execute).not.toHaveBeenCalled();
    });

    it("skips modal when inputSchema is empty array", async () => {
      const { flow, prompts, groundingExecutor } = makeFlow();
      const rc = makeRC({}, { inputSchema: [] });

      await flow.run(rc, { targetIRI: "iri://x", filePath: "x.md" });

      expect(prompts.promptInputSchema).not.toHaveBeenCalled();
      expect(groundingExecutor.execute).toHaveBeenCalledTimes(1);
    });

    it("skips modal when inputSchema is missing", async () => {
      const { flow, prompts } = makeFlow();
      const rc = makeRC();

      await flow.run(rc, { targetIRI: "iri://x", filePath: "x.md" });

      expect(prompts.promptInputSchema).not.toHaveBeenCalled();
    });
  });

  describe("applyLabelDatePrefill (v15.38 regression restoration, v16.7.5 runtime fix)", () => {
    // Patch the date helper directly — keeps the test deterministic regardless
    // of the runner's timezone (DateFormatter.toDateString uses local-tz
    // calendar parts, so fake-system-time + UTC instants drift between TZs).
    let toDateStringSpy: jest.SpyInstance<string, [Date]>;
    const TARGET_IRI = "obsidian://vault/asset-1.md";

    beforeEach(() => {
      toDateStringSpy = jest
        .spyOn(DateFormatter, "toDateString")
        .mockReturnValue("2026-05-17");
    });

    afterEach(() => {
      toDateStringSpy.mockRestore();
    });

    it("prefills label field with `${currentAsset.exo__Asset_label} YYYY-MM-DD` when flag is on", async () => {
      const store = await makeStoreWithAssetLabel(
        TARGET_IRI,
        "EMS Weekly Review Light",
      );
      const { flow } = makeFlow({ tripleStore: store });
      const grounding: GroundingDefinition = {
        ...baseGrounding,
        type: GroundingType.CREATE_INSTANCE,
        targetPrototype: "proto-uid",
        targetFolder: "01 Inbox",
        prefillLabelWithDate: true,
      };
      const schema = [{ name: "label", type: "text", required: true }];

      const result = await flow.applyLabelDatePrefill(
        schema,
        grounding,
        TARGET_IRI,
      );

      expect(result).toEqual([
        {
          name: "label",
          type: "text",
          required: true,
          defaultValue: "EMS Weekly Review Light 2026-05-17",
        },
      ]);
    });

    it("is no-op when prefillLabelWithDate is false / missing", async () => {
      const store = await makeStoreWithAssetLabel(TARGET_IRI, "Whatever");
      const { flow } = makeFlow({ tripleStore: store });
      const grounding: GroundingDefinition = {
        ...baseGrounding,
        type: GroundingType.CREATE_INSTANCE,
        targetFolder: "01 Inbox",
      };
      const schema = [{ name: "label", type: "text" }];

      const result = await flow.applyLabelDatePrefill(
        schema,
        grounding,
        TARGET_IRI,
      );
      expect(result).toBe(schema);
    });

    it("is no-op when grounding type is not create_instance", async () => {
      const store = await makeStoreWithAssetLabel(
        TARGET_IRI,
        "Morning Wim Hof",
      );
      const { flow } = makeFlow({ tripleStore: store });
      const grounding: GroundingDefinition = {
        ...baseGrounding,
        type: GroundingType.PROPERTY_SET,
        prefillLabelWithDate: true,
      };
      const schema = [{ name: "label", type: "text" }];

      const result = await flow.applyLabelDatePrefill(
        schema,
        grounding,
        TARGET_IRI,
      );
      expect(result).toBe(schema);
    });

    it("is no-op when targetIRI is null (global Palette surface without active file)", async () => {
      const store = await makeStoreWithAssetLabel(
        TARGET_IRI,
        "Morning Wim Hof",
      );
      const { flow } = makeFlow({ tripleStore: store });
      const grounding: GroundingDefinition = {
        ...baseGrounding,
        type: GroundingType.CREATE_INSTANCE,
        targetFolder: "01 Inbox",
        prefillLabelWithDate: true,
      };
      const schema = [{ name: "label", type: "text" }];

      const result = await flow.applyLabelDatePrefill(schema, grounding, null);
      expect(result).toBe(schema);
    });

    it("is no-op when tripleStore is not wired (back-compat for callers without DI)", async () => {
      const { flow } = makeFlow();
      const grounding: GroundingDefinition = {
        ...baseGrounding,
        type: GroundingType.CREATE_INSTANCE,
        targetFolder: "01 Inbox",
        prefillLabelWithDate: true,
      };
      const schema = [{ name: "label", type: "text" }];

      const result = await flow.applyLabelDatePrefill(
        schema,
        grounding,
        TARGET_IRI,
      );
      expect(result).toBe(schema);
    });

    it("is no-op when current asset has no exo__Asset_label (graceful fallback)", async () => {
      const store = new InMemoryTripleStore();
      const { flow } = makeFlow({ tripleStore: store });
      const grounding: GroundingDefinition = {
        ...baseGrounding,
        type: GroundingType.CREATE_INSTANCE,
        targetFolder: "01 Inbox",
        prefillLabelWithDate: true,
      };
      const schema = [{ name: "label", type: "text" }];

      const result = await flow.applyLabelDatePrefill(
        schema,
        grounding,
        TARGET_IRI,
      );
      expect(result).toBe(schema);
    });

    it("does not overwrite an existing non-empty defaultValue (user-explicit wins)", async () => {
      const store = await makeStoreWithAssetLabel(
        TARGET_IRI,
        "Morning Wim Hof",
      );
      const { flow } = makeFlow({ tripleStore: store });
      const grounding: GroundingDefinition = {
        ...baseGrounding,
        type: GroundingType.CREATE_INSTANCE,
        targetFolder: "01 Inbox",
        prefillLabelWithDate: true,
      };
      const schema = [
        {
          name: "label",
          type: "text",
          defaultValue: "Author Explicit Default",
        },
      ];

      const result = await flow.applyLabelDatePrefill(
        schema,
        grounding,
        TARGET_IRI,
      );
      expect(result[0]).toEqual({
        name: "label",
        type: "text",
        defaultValue: "Author Explicit Default",
      });
    });

    it("leaves non-label fields untouched even when prefill is active", async () => {
      const store = await makeStoreWithAssetLabel(
        TARGET_IRI,
        "Morning Wim Hof",
      );
      const { flow } = makeFlow({ tripleStore: store });
      const grounding: GroundingDefinition = {
        ...baseGrounding,
        type: GroundingType.CREATE_INSTANCE,
        targetFolder: "01 Inbox",
        prefillLabelWithDate: true,
      };
      const schema = [
        { name: "label", type: "text" },
        { name: "note", type: "multiline" },
      ];

      const result = await flow.applyLabelDatePrefill(
        schema,
        grounding,
        TARGET_IRI,
      );
      expect(result).toEqual([
        {
          name: "label",
          type: "text",
          defaultValue: "Morning Wim Hof 2026-05-17",
        },
        { name: "note", type: "multiline" },
      ]);
    });

    it("flow.run passes prefilled schema into promptInputSchema using current asset label", async () => {
      const store = await makeStoreWithAssetLabel(
        TARGET_IRI,
        "EMS Weekly Review Light",
      );
      const { flow, prompts } = makeFlow({
        promptResult: { label: "user-typed" },
        tripleStore: store,
      });
      const rc = makeRC(
        {},
        {
          type: GroundingType.CREATE_INSTANCE,
          targetPrototype: "proto-uid",
          targetFolder: "01 Inbox",
          prefillLabelWithDate: true,
          inputSchema: [{ name: "label", type: "text", required: true }],
        },
      );

      await flow.run(rc, { targetIRI: TARGET_IRI, filePath: "x.md" });

      expect(prompts.promptInputSchema).toHaveBeenCalledTimes(1);
      const passedSchema = prompts.promptInputSchema.mock.calls[0][0] as Array<
        Record<string, unknown>
      >;
      expect(passedSchema[0].defaultValue).toBe(
        "EMS Weekly Review Light 2026-05-17",
      );
    });
  });

  describe("injected userInput without modal", () => {
    it("passes injectedUserInput through when no inputSchema", async () => {
      const { flow, groundingExecutor } = makeFlow();
      const rc = makeRC();

      await flow.run(rc, {
        targetIRI: "iri://x",
        filePath: "x.md",
        injectedUserInput: { ownerIdentity: "[[!owner]]" },
      });

      expect(groundingExecutor.execute).toHaveBeenCalledWith(
        expect.anything(),
        "iri://x",
        "x.md",
        { ownerIdentity: "[[!owner]]" },
      );
    });
  });

  describe("targetIRI / filePath nullability", () => {
    it("passes empty strings to executor when both are null (global Palette case)", async () => {
      const { flow, groundingExecutor } = makeFlow();
      const rc = makeRC();

      await flow.run(rc, { targetIRI: null, filePath: null });

      expect(groundingExecutor.execute).toHaveBeenCalledWith(
        expect.anything(),
        "",
        "",
        undefined,
      );
    });
  });

  describe("success path", () => {
    it("fires successMessage toast and onComplete", async () => {
      const { flow, notificationService, logger } = makeFlow();
      const onComplete = jest.fn().mockResolvedValue(undefined);
      const rc = makeRC({ successMessage: "Created" });

      await flow.run(rc, {
        targetIRI: "iri://x",
        filePath: "x.md",
        onComplete,
      });

      expect(notificationService.success).toHaveBeenCalledWith("Created");
      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Executed"),
      );
    });

    it("skips success toast when successMessage absent but still calls onComplete", async () => {
      const { flow, notificationService } = makeFlow();
      const onComplete = jest.fn().mockResolvedValue(undefined);
      const rc = makeRC();

      await flow.run(rc, {
        targetIRI: "iri://x",
        filePath: "x.md",
        onComplete,
      });

      expect(notificationService.success).not.toHaveBeenCalled();
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it("skips onComplete when not provided", async () => {
      const { flow, notificationService } = makeFlow();
      const rc = makeRC({ successMessage: "Ok" });

      await flow.run(rc, { targetIRI: "iri://x", filePath: "x.md" });

      expect(notificationService.success).toHaveBeenCalledWith("Ok");
    });
  });

  describe("failure path", () => {
    it("fires error toast with executor error message", async () => {
      const { flow, notificationService, logger } = makeFlow({
        groundingResult: { success: false, error: "boom" } as ExecutionResult,
      });
      const onComplete = jest.fn();
      const rc = makeRC();

      await flow.run(rc, {
        targetIRI: "iri://x",
        filePath: "x.md",
        onComplete,
      });

      expect(notificationService.error).toHaveBeenCalledWith(
        "Command failed: boom",
      );
      expect(onComplete).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Failed"),
      );
    });

    it("fires error toast with generic message when error string missing", async () => {
      const { flow, notificationService } = makeFlow({
        groundingResult: { success: false } as ExecutionResult,
      });
      const rc = makeRC();

      await flow.run(rc, { targetIRI: "iri://x", filePath: "x.md" });

      expect(notificationService.error).toHaveBeenCalledWith(
        "Command failed: unknown error",
      );
    });
  });

  // Issue #3184 B5 — open-in-tab plumbing across IFileOpener.
  describe("openPath / IFileOpener (Issue #3184 B5)", () => {
    it("forwards openPath to fileOpener.open on success", async () => {
      const openFn = jest.fn().mockResolvedValue(undefined);
      const fileOpener: IFileOpener = { open: openFn };
      const { flow } = makeFlow({
        groundingResult: {
          success: true,
          openPath: "01 Inbox/abc-uuid.md",
        } as ExecutionResult,
        fileOpener,
      });
      const rc = makeRC();

      await flow.run(rc, { targetIRI: "iri://x", filePath: "x.md" });

      expect(openFn).toHaveBeenCalledTimes(1);
      // RFC ce27e55d: the flow forwards an opts bag carrying `sameTab`
      // (command.openInSameTab); makeRC() omits the flag → undefined.
      expect(openFn).toHaveBeenCalledWith("01 Inbox/abc-uuid.md", {
        sameTab: undefined,
      });
    });

    it("does nothing when fileOpener is omitted (CLI/headless surface)", async () => {
      const { flow } = makeFlow({
        groundingResult: {
          success: true,
          openPath: "01 Inbox/abc-uuid.md",
        } as ExecutionResult,
        // fileOpener intentionally omitted
      });
      const rc = makeRC();

      // No-throw is the spec for surfaces that don't supply IFileOpener.
      await expect(
        flow.run(rc, { targetIRI: "iri://x", filePath: "x.md" }),
      ).resolves.toBeUndefined();
    });

    it("does not call fileOpener when grounding did not surface openPath", async () => {
      const openFn = jest.fn().mockResolvedValue(undefined);
      const { flow } = makeFlow({
        groundingResult: { success: true } as ExecutionResult, // no openPath
        fileOpener: { open: openFn },
      });
      const rc = makeRC();

      await flow.run(rc, { targetIRI: "iri://x", filePath: "x.md" });

      expect(openFn).not.toHaveBeenCalled();
    });

    it("does not call fileOpener when grounding failed", async () => {
      const openFn = jest.fn().mockResolvedValue(undefined);
      const { flow } = makeFlow({
        groundingResult: {
          success: false,
          error: "boom",
          openPath: "should-not-open.md",
        } as ExecutionResult,
        fileOpener: { open: openFn },
      });
      const rc = makeRC();

      await flow.run(rc, { targetIRI: "iri://x", filePath: "x.md" });

      expect(openFn).not.toHaveBeenCalled();
    });

    it("logs but does not propagate fileOpener errors", async () => {
      const openErr = new Error("workspace busy");
      const openFn = jest.fn().mockRejectedValue(openErr);
      const { flow, logger, notificationService } = makeFlow({
        groundingResult: {
          success: true,
          openPath: "01 Inbox/abc-uuid.md",
        } as ExecutionResult,
        fileOpener: { open: openFn },
      });
      const rc = makeRC();

      await expect(
        flow.run(rc, { targetIRI: "iri://x", filePath: "x.md" }),
      ).resolves.toBeUndefined();

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Failed to open created file"),
      );
      // Success path side-effects should still have fired (no error toast).
      expect(notificationService.error).not.toHaveBeenCalled();
    });
  });

  // T3 «Create Instance» (project bbe40f8c) — SHACL required-property field
  // augmentation. Active ONLY for the host-as-class flagship (create_instance
  // with no targetClass).
  describe("required-property field augmentation (T3)", () => {
    const HOST_UID = "88b938af-1a55-451c-b3cc-2f03e5115fcf";
    const HOST_PATH = `assetspaces/x/${HOST_UID}.md`;

    // The host-as-class flagship grounding: create_instance, NO targetClass,
    // with the static label + ontology inputSchema.
    function flagshipRC() {
      return makeRC(
        {},
        {
          type: GroundingType.CREATE_INSTANCE,
          targetClass: undefined,
          inputSchema: [
            { name: "label", type: "text" },
            { name: "exo__Asset_isDefinedBy", type: "assetRef" },
          ],
        },
      );
    }

    async function schemaPassedToPrompt(
      overrides: Parameters<typeof makeFlow>[0],
      ctxOverrides?: { filePath?: string | null; rc?: ReturnType<typeof makeRC> },
    ) {
      const { flow, prompts } = makeFlow({
        promptResult: { label: "x" },
        ...overrides,
      });
      const rc = ctxOverrides?.rc ?? flagshipRC();
      await flow.run(rc, {
        targetIRI: `obsidian://vault/${HOST_PATH}`,
        filePath:
          ctxOverrides && "filePath" in ctxOverrides
            ? ctxOverrides.filePath ?? null
            : HOST_PATH,
      });
      const calls = prompts.promptInputSchema.mock.calls;
      return calls.length > 0
        ? (calls[0][0] as Array<Record<string, unknown>>)
        : null;
    }

    it("appends the host class's required properties to the form schema", async () => {
      const schema = await schemaPassedToPrompt({
        requiredPropertyResolver: async () => [
          { propertyKey: "exo__Setting_value", label: "exo__Setting_value", fieldType: "text" },
          {
            propertyKey: "exo__Setting_key",
            label: "exo__Setting_key",
            fieldType: "assetRef",
            targetClassUid: "a37d39ec-413d-4d9c-8cf2-da9b6025b00c",
          },
        ],
      });
      const names = schema!.map((f) => f.name);
      expect(names).toEqual([
        "label",
        "exo__Asset_isDefinedBy",
        "exo__Setting_value",
        "exo__Setting_key",
      ]);
      const keyField = schema!.find((f) => f.name === "exo__Setting_key")!;
      expect(keyField).toMatchObject({
        type: "assetRef",
        required: true,
        targetClassUid: "a37d39ec-413d-4d9c-8cf2-da9b6025b00c",
      });
    });

    it("gives boolean fields a defaultValue of 'false' (always submit-valid)", async () => {
      const schema = await schemaPassedToPrompt({
        requiredPropertyResolver: async () => [
          { propertyKey: "ex__C_flag", label: "ex__C_flag", fieldType: "boolean" },
        ],
      });
      const flagField = schema!.find((f) => f.name === "ex__C_flag")!;
      expect(flagField).toMatchObject({
        type: "boolean",
        required: true,
        defaultValue: "false",
      });
    });

    it("skips properties already covered by the Universal Default Template", async () => {
      const schema = await schemaPassedToPrompt({
        requiredPropertyResolver: async () => [
          { propertyKey: "exo__Instance_class", label: "x", fieldType: "text" },
          { propertyKey: "exo__Asset_label", label: "x", fieldType: "text" },
          { propertyKey: "exo__Setting_value", label: "x", fieldType: "text" },
        ],
      });
      const names = schema!.map((f) => f.name);
      expect(names).not.toContain("exo__Instance_class");
      expect(names).not.toContain("exo__Asset_label");
      expect(names).toContain("exo__Setting_value");
    });

    it("skips properties already present as a static schema field", async () => {
      const schema = await schemaPassedToPrompt({
        requiredPropertyResolver: async () => [
          { propertyKey: "exo__Asset_isDefinedBy", label: "x", fieldType: "assetRef" },
          { propertyKey: "exo__Setting_value", label: "x", fieldType: "text" },
        ],
      });
      // exo__Asset_isDefinedBy already in the static schema → not duplicated.
      const occurrences = schema!.filter(
        (f) => f.name === "exo__Asset_isDefinedBy",
      ).length;
      expect(occurrences).toBe(1);
    });

    it("is a no-op when the grounding bakes a targetClass (not the flagship)", async () => {
      const rc = makeRC(
        {},
        {
          type: GroundingType.CREATE_INSTANCE,
          targetClass: "[[ems__Task]]",
          inputSchema: [{ name: "label", type: "text" }],
        },
      );
      const resolver = jest.fn(async () => [
        { propertyKey: "exo__Setting_value", label: "x", fieldType: "text" as const },
      ]);
      const schema = await schemaPassedToPrompt(
        { requiredPropertyResolver: resolver },
        { rc },
      );
      expect(resolver).not.toHaveBeenCalled();
      expect(schema!.map((f) => f.name)).toEqual(["label"]);
    });

    it("is a no-op when no resolver is wired", async () => {
      const schema = await schemaPassedToPrompt({});
      expect(schema!.map((f) => f.name)).toEqual([
        "label",
        "exo__Asset_isDefinedBy",
      ]);
    });

    it("is a no-op when there is no filePath (global palette surface)", async () => {
      const resolver = jest.fn(async () => [
        { propertyKey: "exo__Setting_value", label: "x", fieldType: "text" as const },
      ]);
      const schema = await schemaPassedToPrompt(
        { requiredPropertyResolver: resolver },
        { filePath: null },
      );
      expect(resolver).not.toHaveBeenCalled();
      expect(schema!.map((f) => f.name)).toEqual([
        "label",
        "exo__Asset_isDefinedBy",
      ]);
    });

    it("resolves the host class UID from the file basename", async () => {
      const resolver = jest.fn(async () => []);
      await schemaPassedToPrompt({ requiredPropertyResolver: resolver });
      expect(resolver).toHaveBeenCalledWith(HOST_UID);
    });
  });
});
