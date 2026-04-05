import { DynamicCommandButtonGroupBuilder } from "../../../../src/presentation/builders/button-groups/DynamicCommandButtonGroupBuilder";
import {
  GroundingType,
} from "exocortex";

const mockResolveForAsset = jest.fn();
const mockEvaluate = jest.fn();
const mockExecute = jest.fn();

const mockCommandResolver = {
  resolveForAsset: mockResolveForAsset,
  loadCommand: jest.fn(),
  findBindings: jest.fn(),
  invalidateCache: jest.fn(),
};

const mockPreconditionEvaluator = {
  evaluate: mockEvaluate,
  registerHostFunction: jest.fn(),
  hasHostFunction: jest.fn(),
  substituteVariables: jest.fn(),
};

const mockGroundingExecutor = {
  execute: mockExecute,
  substituteVariables: jest.fn(),
};

function createGrounding(overrides?: Partial<GroundingDefinition>): GroundingDefinition {
  return {
    id: "grounding-1",
    label: "Test grounding",
    type: GroundingType.PROPERTY_SET,
    targetProperty: "ems__Effort_status",
    targetValue: "done",
    ...overrides,
  };
}

function createCommand(overrides?: Partial<CommandDefinition>): CommandDefinition {
  return {
    id: "cmd-1",
    name: "Test command",
    grounding: createGrounding(),
    ...overrides,
  };
}

function createBinding(overrides?: Partial<CommandBindingDefinition>): CommandBindingDefinition {
  return {
    id: "binding-1",
    label: "Test binding",
    commandRef: "cmd-1",
    targetClass: "ems__Task",
    ...overrides,
  };
}

function createResolvedCommand(
  commandOverrides?: Partial<CommandDefinition>,
  bindingOverrides?: Partial<CommandBindingDefinition>,
): ResolvedCommand {
  return {
    command: createCommand(commandOverrides),
    binding: createBinding(bindingOverrides),
  };
}

function createContext(metadataOverrides?: Record<string, unknown>): ButtonBuilderContext {
  return {
    app: {} as ButtonBuilderContext["app"],
    settings: {} as ButtonBuilderContext["settings"],
    plugin: {} as ButtonBuilderContext["plugin"],
    file: { path: "test/file.md", parent: { path: "test" } } as ButtonBuilderContext["file"],
    metadata: {
      exo__Asset_uid: "asset-uid-123",
      exo__Instance_class: "ems__Task",
      ...metadataOverrides,
    },
    instanceClass: "ems__Task",
    visibilityContext: {
      instanceClass: "ems__Task",
      currentStatus: null,
      metadata: {},
      isArchived: false,
      currentFolder: "test",
      expectedFolder: "test",
      classIsPrototype: false,
    },
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() } as unknown as ButtonBuilderContext["logger"],
    refresh: jest.fn().mockResolvedValue(undefined),
  };
}

const NoticeSpy = jest.fn();

jest.mock("obsidian", () => {
  const actual = jest.requireActual("obsidian");
  return {
    ...actual,
    Notice: class MockNotice {
      constructor(message: string) {
        NoticeSpy(message);
      }
    },
  };
});

describe("DynamicCommandButtonGroupBuilder", () => {
  let builder: DynamicCommandButtonGroupBuilder;

  beforeEach(() => {
    jest.clearAllMocks();
    builder = new DynamicCommandButtonGroupBuilder({
      commandResolver: mockCommandResolver as unknown as Parameters<typeof DynamicCommandButtonGroupBuilder.prototype.build>[0] extends never ? never : any,
      preconditionEvaluator: mockPreconditionEvaluator as unknown as any,
      groundingExecutor: mockGroundingExecutor as unknown as any,
    });
  });

  describe("getGroupId", () => {
    it("should return dynamic-commands", () => {
      expect(builder.getGroupId()).toBe("dynamic-commands");
    });
  });

  describe("getGroupTitle", () => {
    it("should return Commands", () => {
      expect(builder.getGroupTitle()).toBe("Commands");
    });
  });

  describe("build", () => {
    it("should use file path as fallback when no Asset UID in metadata", async () => {
      mockResolveForAsset.mockResolvedValue([]);
      const context = createContext({ exo__Asset_uid: undefined });
      const result = await builder.build(context);
      expect(result).toEqual([]);
      // Falls back to file.path as subject IRI
      expect(mockResolveForAsset).toHaveBeenCalledWith("test/file.md", "ems__Task", undefined);
    });

    it("should return empty array when no instance class in metadata", async () => {
      const context = createContext({ exo__Instance_class: undefined });
      const result = await builder.build(context);
      expect(result).toEqual([]);
    });

    it("should return empty array when no commands resolved", async () => {
      mockResolveForAsset.mockResolvedValue([]);
      const context = createContext();
      const result = await builder.build(context);
      expect(result).toEqual([]);
    });

    it("should return empty array when CommandResolver throws", async () => {
      mockResolveForAsset.mockRejectedValue(new Error("resolver error"));
      const context = createContext();
      const result = await builder.build(context);
      expect(result).toEqual([]);
    });

    it("should return buttons for commands with passing preconditions", async () => {
      const rc = createResolvedCommand({ name: "Do something" });
      mockResolveForAsset.mockResolvedValue([rc]);
      mockEvaluate.mockResolvedValue(true);

      const context = createContext();
      const result = await builder.build(context);

      expect(result).toHaveLength(1);
      expect(result[0].label).toBe("Do something");
      expect(result[0].id).toBe("dynamic-cmd-cmd-1");
      expect(result[0].visible).toBe(true);
    });

    it("should filter out commands with failing preconditions", async () => {
      const rc1 = createResolvedCommand({ id: "cmd-pass", name: "Passing" });
      const rc2 = createResolvedCommand({ id: "cmd-fail", name: "Failing" });
      mockResolveForAsset.mockResolvedValue([rc1, rc2]);
      mockEvaluate
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      const context = createContext();
      const result = await builder.build(context);

      expect(result).toHaveLength(1);
      expect(result[0].label).toBe("Passing");
    });

    it("should evaluate preconditions in parallel", async () => {
      const rc1 = createResolvedCommand({ id: "cmd-1", name: "Cmd 1" });
      const rc2 = createResolvedCommand({ id: "cmd-2", name: "Cmd 2" });
      const rc3 = createResolvedCommand({ id: "cmd-3", name: "Cmd 3" });
      mockResolveForAsset.mockResolvedValue([rc1, rc2, rc3]);
      mockEvaluate.mockResolvedValue(true);

      const context = createContext();
      await builder.build(context);

      expect(mockEvaluate).toHaveBeenCalledTimes(3);
    });

    it("should handle precondition evaluation errors gracefully", async () => {
      const rc = createResolvedCommand();
      mockResolveForAsset.mockResolvedValue([rc]);
      mockEvaluate.mockRejectedValue(new Error("eval error"));

      const context = createContext();
      const result = await builder.build(context);
      expect(result).toEqual([]);
    });

    it("should pass correct arguments to CommandResolver", async () => {
      mockResolveForAsset.mockResolvedValue([]);
      const context = createContext({
        exo__Asset_uid: "my-uid",
        exo__Instance_class: "ems__Task",
        exo__Asset_prototype: "proto-uid",
      });
      await builder.build(context);

      expect(mockResolveForAsset).toHaveBeenCalledWith(
        "my-uid",
        "ems__Task",
        "proto-uid",
      );
    });

    it("should handle array instance class", async () => {
      mockResolveForAsset.mockResolvedValue([]);
      const context = createContext({
        exo__Instance_class: ["ems__Task", "ems__Meeting"],
      });
      await builder.build(context);

      expect(mockResolveForAsset).toHaveBeenCalledWith(
        "asset-uid-123",
        "ems__Task",
        undefined,
      );
    });

    it("should normalize wikilink brackets from instance class", async () => {
      mockResolveForAsset.mockResolvedValue([]);
      const context = createContext({
        exo__Instance_class: "[[ems__Task]]",
      });
      await builder.build(context);

      expect(mockResolveForAsset).toHaveBeenCalledWith(
        "asset-uid-123",
        "ems__Task",
        undefined,
      );
    });

    it("should resolve variant from binding group", async () => {
      const rc = createResolvedCommand(
        { name: "Danger action" },
        { group: "danger" },
      );
      mockResolveForAsset.mockResolvedValue([rc]);
      mockEvaluate.mockResolvedValue(true);

      const context = createContext();
      const result = await builder.build(context);

      expect(result[0].variant).toBe("danger");
    });

    it("should default variant to secondary when no group", async () => {
      const rc = createResolvedCommand(
        { name: "Default action" },
        { group: undefined },
      );
      mockResolveForAsset.mockResolvedValue([rc]);
      mockEvaluate.mockResolvedValue(true);

      const context = createContext();
      const result = await builder.build(context);

      expect(result[0].variant).toBe("secondary");
    });
  });

  describe("button onClick", () => {
    it("should execute grounding on click", async () => {
      const rc = createResolvedCommand({ name: "Execute me" });
      mockResolveForAsset.mockResolvedValue([rc]);
      mockEvaluate.mockResolvedValue(true);
      mockExecute.mockResolvedValue({ success: true } as ExecutionResult);

      const context = createContext();
      const result = await builder.build(context);

      await result[0].onClick();

      expect(mockExecute).toHaveBeenCalledWith(
        rc.command.grounding,
        "asset-uid-123",
        "test/file.md",
        undefined,
      );
    });

    it("should show success notice when successMessage is set", async () => {
      const rc = createResolvedCommand({
        name: "Success cmd",
        successMessage: "Done!",
      });
      mockResolveForAsset.mockResolvedValue([rc]);
      mockEvaluate.mockResolvedValue(true);
      mockExecute.mockResolvedValue({ success: true } as ExecutionResult);

      const context = createContext();
      const result = await builder.build(context);

      await result[0].onClick();

      expect(NoticeSpy).toHaveBeenCalledWith("Done!");
    });

    it("should refresh layout after successful execution", async () => {
      const rc = createResolvedCommand();
      mockResolveForAsset.mockResolvedValue([rc]);
      mockEvaluate.mockResolvedValue(true);
      mockExecute.mockResolvedValue({ success: true } as ExecutionResult);

      const context = createContext();
      const result = await builder.build(context);

      await result[0].onClick();

      expect(context.refresh).toHaveBeenCalled();
    });

    it("should show error notice when execution fails", async () => {
      const rc = createResolvedCommand();
      mockResolveForAsset.mockResolvedValue([rc]);
      mockEvaluate.mockResolvedValue(true);
      mockExecute.mockResolvedValue({
        success: false,
        error: "Something went wrong",
      } as ExecutionResult);

      const context = createContext();
      const result = await builder.build(context);

      await result[0].onClick();

      expect(NoticeSpy).toHaveBeenCalledWith("Command failed: Something went wrong");
    });

    it("should show confirmation dialog when confirmMessage is set", async () => {
      const rc = createResolvedCommand({
        name: "Dangerous",
        confirmMessage: "Are you sure?",
      });
      mockResolveForAsset.mockResolvedValue([rc]);
      mockEvaluate.mockResolvedValue(true);

      const originalConfirm = window.confirm;
      window.confirm = jest.fn().mockReturnValue(true);
      mockExecute.mockResolvedValue({ success: true } as ExecutionResult);

      const context = createContext();
      const result = await builder.build(context);
      await result[0].onClick();

      expect(window.confirm).toHaveBeenCalledWith("Are you sure?");
      expect(mockExecute).toHaveBeenCalled();

      window.confirm = originalConfirm;
    });

    it("should not execute when confirmation is cancelled", async () => {
      const rc = createResolvedCommand({
        name: "Dangerous",
        confirmMessage: "Are you sure?",
      });
      mockResolveForAsset.mockResolvedValue([rc]);
      mockEvaluate.mockResolvedValue(true);

      const originalConfirm = window.confirm;
      window.confirm = jest.fn().mockReturnValue(false);

      const context = createContext();
      const result = await builder.build(context);
      await result[0].onClick();

      expect(window.confirm).toHaveBeenCalledWith("Are you sure?");
      expect(mockExecute).not.toHaveBeenCalled();

      window.confirm = originalConfirm;
    });

    it("should not show success notice when no successMessage", async () => {
      const rc = createResolvedCommand({
        name: "No message",
        successMessage: undefined,
      });
      mockResolveForAsset.mockResolvedValue([rc]);
      mockEvaluate.mockResolvedValue(true);
      mockExecute.mockResolvedValue({ success: true } as ExecutionResult);

      const context = createContext();
      const result = await builder.build(context);

      await result[0].onClick();

      expect(NoticeSpy).not.toHaveBeenCalled();
    });
  });

  describe("multiple commands", () => {
    it("should return buttons for all passing commands", async () => {
      const rc1 = createResolvedCommand({ id: "c1", name: "Cmd A" });
      const rc2 = createResolvedCommand({ id: "c2", name: "Cmd B" });
      const rc3 = createResolvedCommand({ id: "c3", name: "Cmd C" });
      mockResolveForAsset.mockResolvedValue([rc1, rc2, rc3]);
      mockEvaluate.mockResolvedValue(true);

      const context = createContext();
      const result = await builder.build(context);

      expect(result).toHaveLength(3);
      expect(result.map((b) => b.label)).toEqual(["Cmd A", "Cmd B", "Cmd C"]);
    });

    it("should preserve command order from resolver", async () => {
      const rc1 = createResolvedCommand({ id: "c1", name: "First" }, { order: 1 });
      const rc2 = createResolvedCommand({ id: "c2", name: "Second" }, { order: 2 });
      mockResolveForAsset.mockResolvedValue([rc1, rc2]);
      mockEvaluate.mockResolvedValue(true);

      const context = createContext();
      const result = await builder.build(context);

      expect(result[0].label).toBe("First");
      expect(result[1].label).toBe("Second");
    });
  });
});
