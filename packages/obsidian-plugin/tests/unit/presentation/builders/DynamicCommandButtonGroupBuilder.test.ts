import { DynamicCommandButtonGroupBuilder } from "../../../../src/presentation/builders/button-groups/DynamicCommandButtonGroupBuilder";
import { GroundingType } from "exocortex";

const mockResolveForAsset = jest.fn();
const mockResolveForAssetMulti = jest.fn();
const mockEvaluate = jest.fn();
const mockExecute = jest.fn();

const mockCommandResolver = {
  resolveForAsset: mockResolveForAsset,
  resolveForAssetMulti: mockResolveForAssetMulti,
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

function createGrounding(
  overrides?: Partial<GroundingDefinition>,
): GroundingDefinition {
  return {
    id: "grounding-1",
    label: "Test grounding",
    type: GroundingType.PROPERTY_SET,
    targetProperty: "ems__Effort_status",
    targetValue: "done",
    ...overrides,
  };
}

function createCommand(
  overrides?: Partial<CommandDefinition>,
): CommandDefinition {
  return {
    id: "cmd-1",
    name: "Test command",
    grounding: createGrounding(),
    ...overrides,
  };
}

function createBinding(
  overrides?: Partial<CommandBindingDefinition>,
): CommandBindingDefinition {
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

function createContext(
  metadataOverrides?: Record<string, unknown>,
): ButtonBuilderContext {
  return {
    app: {} as ButtonBuilderContext["app"],
    settings: {} as ButtonBuilderContext["settings"],
    plugin: {} as ButtonBuilderContext["plugin"],
    file: {
      path: "test/file.md",
      parent: { path: "test" },
    } as ButtonBuilderContext["file"],
    metadata: {
      exo__Asset_uid: "obsidian://vault/test/file.md",
      exo__Instance_class: ["[[ems__Task]]"],
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
    logger: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as unknown as ButtonBuilderContext["logger"],
    refresh: jest.fn().mockResolvedValue(undefined),
  };
}

const mockNotificationService = {
  info: jest.fn(),
  success: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  confirm: jest.fn().mockResolvedValue(true),
};

describe("DynamicCommandButtonGroupBuilder", () => {
  let builder: DynamicCommandButtonGroupBuilder;

  beforeEach(() => {
    jest.clearAllMocks();
    builder = new DynamicCommandButtonGroupBuilder({
      commandResolver: mockCommandResolver as unknown as Parameters<
        typeof DynamicCommandButtonGroupBuilder.prototype.build
      >[0] extends never
        ? never
        : any,
      preconditionEvaluator: mockPreconditionEvaluator as unknown as any,
      groundingExecutor: mockGroundingExecutor as unknown as any,
      notificationService: mockNotificationService as any,
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
      mockResolveForAssetMulti.mockResolvedValue([]);
      const context = createContext({ exo__Asset_uid: undefined });
      const result = await builder.build(context);
      expect(result).toEqual([]);
      // subjectIRI is always constructed from file.path as obsidian://vault/ IRI
      // Issue #2958: classes array always includes universal "exo__Asset" superclass
      expect(mockResolveForAssetMulti).toHaveBeenCalledWith(
        "obsidian://vault/test/file.md",
        ["ems__Task", "exo__Asset"],
        undefined,
      );
    });

    it("should return empty array when no instance class in metadata", async () => {
      const context = createContext({ exo__Instance_class: undefined });
      const result = await builder.build(context);
      expect(result).toEqual([]);
    });

    it("should return empty array when no commands resolved", async () => {
      mockResolveForAssetMulti.mockResolvedValue([]);
      const context = createContext();
      const result = await builder.build(context);
      expect(result).toEqual([]);
    });

    it("should return empty array when CommandResolver throws", async () => {
      mockResolveForAssetMulti.mockRejectedValue(new Error("resolver error"));
      const context = createContext();
      const result = await builder.build(context);
      expect(result).toEqual([]);
    });

    it("should return buttons for commands with passing preconditions", async () => {
      const rc = createResolvedCommand({ name: "Do something" });
      mockResolveForAssetMulti.mockResolvedValue([rc]);
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
      mockResolveForAssetMulti.mockResolvedValue([rc1, rc2]);
      mockEvaluate.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      const context = createContext();
      const result = await builder.build(context);

      expect(result).toHaveLength(1);
      expect(result[0].label).toBe("Passing");
    });

    it("should evaluate preconditions in parallel", async () => {
      const rc1 = createResolvedCommand({ id: "cmd-1", name: "Cmd 1" });
      const rc2 = createResolvedCommand({ id: "cmd-2", name: "Cmd 2" });
      const rc3 = createResolvedCommand({ id: "cmd-3", name: "Cmd 3" });
      mockResolveForAssetMulti.mockResolvedValue([rc1, rc2, rc3]);
      mockEvaluate.mockResolvedValue(true);

      const context = createContext();
      await builder.build(context);

      expect(mockEvaluate).toHaveBeenCalledTimes(3);
    });

    it("should handle precondition evaluation errors gracefully", async () => {
      const rc = createResolvedCommand();
      mockResolveForAssetMulti.mockResolvedValue([rc]);
      mockEvaluate.mockRejectedValue(new Error("eval error"));

      const context = createContext();
      const result = await builder.build(context);
      expect(result).toEqual([]);
    });

    it("should pass correct arguments to CommandResolver", async () => {
      mockResolveForAssetMulti.mockResolvedValue([]);
      const context = createContext({
        exo__Asset_uid: "obsidian://vault/test/file.md",
        exo__Instance_class: ["[[ems__Task]]"],
        exo__Asset_prototype: "proto-uid",
      });
      await builder.build(context);

      expect(mockResolveForAssetMulti).toHaveBeenCalledWith(
        "obsidian://vault/test/file.md",
        ["ems__Task", "exo__Asset"],
        "proto-uid",
      );
    });

    it("should handle array instance class — pass all classes plus universal exo__Asset (Issue #2958)", async () => {
      mockResolveForAssetMulti.mockResolvedValue([]);
      const context = createContext({
        exo__Instance_class: ["ems__Task", "ems__Meeting"],
      });
      await builder.build(context);

      expect(mockResolveForAssetMulti).toHaveBeenCalledWith(
        "obsidian://vault/test/file.md",
        ["ems__Task", "ems__Meeting", "exo__Asset"],
        undefined,
      );
    });

    it("should normalize wikilink brackets from instance class", async () => {
      mockResolveForAssetMulti.mockResolvedValue([]);
      const context = createContext({
        exo__Instance_class: ["[[ems__Task]]"],
      });
      await builder.build(context);

      expect(mockResolveForAssetMulti).toHaveBeenCalledWith(
        "obsidian://vault/test/file.md",
        ["ems__Task", "exo__Asset"],
        undefined,
      );
    });

    it("should not duplicate exo__Asset when already declared in instance class (Issue #2958)", async () => {
      mockResolveForAssetMulti.mockResolvedValue([]);
      const context = createContext({
        exo__Instance_class: ["[[exo__Asset]]"],
      });
      await builder.build(context);

      expect(mockResolveForAssetMulti).toHaveBeenCalledWith(
        "obsidian://vault/test/file.md",
        ["exo__Asset"],
        undefined,
      );
    });

    it("should preserve order — declared classes first, exo__Asset appended (Issue #2958)", async () => {
      mockResolveForAssetMulti.mockResolvedValue([]);
      const context = createContext({
        exo__Instance_class: ["[[ems__Project]]", "[[custom__Class]]"],
      });
      await builder.build(context);

      expect(mockResolveForAssetMulti).toHaveBeenCalledWith(
        "obsidian://vault/test/file.md",
        ["ems__Project", "custom__Class", "exo__Asset"],
        undefined,
      );
    });

    it("should resolve variant from binding group via categoryDefaultVariant map", async () => {
      // RFC-024 Phase 0: `creation` group maps to `primary` by built-in defaults
      const rc = createResolvedCommand(
        { name: "Create action" },
        { group: "creation" },
      );
      mockResolveForAssetMulti.mockResolvedValue([rc]);
      mockEvaluate.mockResolvedValue(true);

      const context = createContext();
      const result = await builder.build(context);

      expect(result[0].variant).toBe("primary");
    });

    it("should map maintenance group to muted variant (RFC-024 Phase 0)", async () => {
      const rc = createResolvedCommand(
        { name: "Rebuild index" },
        { group: "maintenance" },
      );
      mockResolveForAssetMulti.mockResolvedValue([rc]);
      mockEvaluate.mockResolvedValue(true);

      const context = createContext();
      const result = await builder.build(context);

      expect(result[0].variant).toBe("muted");
    });

    it("should default variant to secondary when no group", async () => {
      const rc = createResolvedCommand(
        { name: "Default action" },
        { group: undefined },
      );
      mockResolveForAssetMulti.mockResolvedValue([rc]);
      mockEvaluate.mockResolvedValue(true);

      const context = createContext();
      const result = await builder.build(context);

      expect(result[0].variant).toBe("secondary");
    });

    it("should default variant to secondary for unknown group", async () => {
      const rc = createResolvedCommand(
        { name: "Future action" },
        { group: "future-uncategorized" },
      );
      mockResolveForAssetMulti.mockResolvedValue([rc]);
      mockEvaluate.mockResolvedValue(true);

      const context = createContext();
      const result = await builder.build(context);

      expect(result[0].variant).toBe("secondary");
    });
  });

  describe("button onClick", () => {
    it("should execute grounding on click", async () => {
      const rc = createResolvedCommand({ name: "Execute me" });
      mockResolveForAssetMulti.mockResolvedValue([rc]);
      mockEvaluate.mockResolvedValue(true);
      mockExecute.mockResolvedValue({ success: true } as ExecutionResult);

      const context = createContext();
      const result = await builder.build(context);

      await result[0].onClick();

      expect(mockExecute).toHaveBeenCalledWith(
        rc.command.grounding,
        "obsidian://vault/test/file.md",
        "test/file.md",
        undefined,
      );
    });

    it("should show success notice when successMessage is set", async () => {
      const rc = createResolvedCommand({
        name: "Success cmd",
        successMessage: "Done!",
      });
      mockResolveForAssetMulti.mockResolvedValue([rc]);
      mockEvaluate.mockResolvedValue(true);
      mockExecute.mockResolvedValue({ success: true } as ExecutionResult);

      const context = createContext();
      const result = await builder.build(context);

      await result[0].onClick();

      expect(mockNotificationService.success).toHaveBeenCalledWith("Done!");
    });

    it("should refresh layout after successful execution", async () => {
      const rc = createResolvedCommand();
      mockResolveForAssetMulti.mockResolvedValue([rc]);
      mockEvaluate.mockResolvedValue(true);
      mockExecute.mockResolvedValue({ success: true } as ExecutionResult);

      const context = createContext();
      const result = await builder.build(context);

      await result[0].onClick();

      expect(context.refresh).toHaveBeenCalled();
    });

    it("should show error notice when execution fails", async () => {
      const rc = createResolvedCommand();
      mockResolveForAssetMulti.mockResolvedValue([rc]);
      mockEvaluate.mockResolvedValue(true);
      mockExecute.mockResolvedValue({
        success: false,
        error: "Something went wrong",
      } as ExecutionResult);

      const context = createContext();
      const result = await builder.build(context);

      await result[0].onClick();

      expect(mockNotificationService.error).toHaveBeenCalledWith(
        "Command failed: Something went wrong",
      );
    });

    it("should show confirmation dialog when confirmMessage is set", async () => {
      const rc = createResolvedCommand({
        name: "Dangerous",
        confirmMessage: "Are you sure?",
      });
      mockResolveForAssetMulti.mockResolvedValue([rc]);
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
      mockResolveForAssetMulti.mockResolvedValue([rc]);
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
      mockResolveForAssetMulti.mockResolvedValue([rc]);
      mockEvaluate.mockResolvedValue(true);
      mockExecute.mockResolvedValue({ success: true } as ExecutionResult);

      const context = createContext();
      const result = await builder.build(context);

      await result[0].onClick();

      expect(mockNotificationService.success).not.toHaveBeenCalled();
    });
  });

  describe("multiple commands", () => {
    it("should return buttons for all passing commands", async () => {
      const rc1 = createResolvedCommand({ id: "c1", name: "Cmd A" });
      const rc2 = createResolvedCommand({ id: "c2", name: "Cmd B" });
      const rc3 = createResolvedCommand({ id: "c3", name: "Cmd C" });
      mockResolveForAssetMulti.mockResolvedValue([rc1, rc2, rc3]);
      mockEvaluate.mockResolvedValue(true);

      const context = createContext();
      const result = await builder.build(context);

      expect(result).toHaveLength(3);
      expect(result.map((b) => b.label)).toEqual(["Cmd A", "Cmd B", "Cmd C"]);
    });

    it("should preserve command order from resolver", async () => {
      const rc1 = createResolvedCommand(
        { id: "c1", name: "First" },
        { order: 1 },
      );
      const rc2 = createResolvedCommand(
        { id: "c2", name: "Second" },
        { order: 2 },
      );
      mockResolveForAssetMulti.mockResolvedValue([rc1, rc2]);
      mockEvaluate.mockResolvedValue(true);

      const context = createContext();
      const result = await builder.build(context);

      expect(result[0].label).toBe("First");
      expect(result[1].label).toBe("Second");
    });
  });

  describe("buildCategoryGroups", () => {
    it("should return groups in fixed order (creation → status → planning → criticality → maintenance)", async () => {
      const commands = [
        createResolvedCommand({
          id: "m1",
          name: "Rename to UID",
          category: "maintenance",
        }),
        createResolvedCommand({
          id: "c1",
          name: "Create Task",
          category: "creation",
        }),
        createResolvedCommand({
          id: "s1",
          name: "Set Status Doing",
          category: "status",
        }),
        createResolvedCommand({
          id: "p1",
          name: "Plan on Today",
          category: "planning",
        }),
        createResolvedCommand({
          id: "k1",
          name: "Set Criticality High",
          category: "criticality",
        }),
      ];
      mockResolveForAssetMulti.mockResolvedValue(commands);
      mockEvaluate.mockResolvedValue(true);

      const result = await builder.buildCategoryGroups(createContext());

      expect(result.map((g) => g.id)).toEqual([
        "dynamic-commands-creation",
        "dynamic-commands-status",
        "dynamic-commands-planning",
        "dynamic-commands-criticality",
        "dynamic-commands-maintenance",
      ]);
      expect(result.map((g) => g.title)).toEqual([
        "Create",
        "Status",
        "Planning",
        "Criticality",
        "Maintenance",
      ]);
    });

    it("should mark maintenance group collapsedByDefault", async () => {
      mockResolveForAssetMulti.mockResolvedValue([
        createResolvedCommand({
          id: "c1",
          name: "Create Task",
          category: "creation",
        }),
        createResolvedCommand({
          id: "m1",
          name: "Rename to UID",
          category: "maintenance",
        }),
      ]);
      mockEvaluate.mockResolvedValue(true);

      const result = await builder.buildCategoryGroups(createContext());

      const creation = result.find((g) => g.id === "dynamic-commands-creation");
      const maintenance = result.find(
        (g) => g.id === "dynamic-commands-maintenance",
      );
      expect(creation?.collapsedByDefault).toBeFalsy();
      expect(maintenance?.collapsedByDefault).toBe(true);
    });

    it("should omit categories that have zero visible commands", async () => {
      mockResolveForAssetMulti.mockResolvedValue([
        createResolvedCommand({
          id: "c1",
          name: "Create Task",
          category: "creation",
        }),
        createResolvedCommand({
          id: "s1",
          name: "Set Status Doing",
          category: "status",
        }),
      ]);
      mockEvaluate.mockResolvedValue(true);

      const result = await builder.buildCategoryGroups(createContext());

      expect(result.map((g) => g.id)).toEqual([
        "dynamic-commands-creation",
        "dynamic-commands-status",
      ]);
      expect(
        result.find((g) => g.id === "dynamic-commands-maintenance"),
      ).toBeUndefined();
    });

    it("should drop categories where preconditions filter out every command", async () => {
      mockResolveForAssetMulti.mockResolvedValue([
        createResolvedCommand({
          id: "c1",
          name: "Create Task",
          category: "creation",
        }),
        createResolvedCommand({
          id: "m1",
          name: "Rename to UID",
          category: "maintenance",
        }),
      ]);
      mockEvaluate.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      const result = await builder.buildCategoryGroups(createContext());

      expect(result.map((g) => g.id)).toEqual(["dynamic-commands-creation"]);
    });

    it("should route commands without category into Other group at the end", async () => {
      mockResolveForAssetMulti.mockResolvedValue([
        createResolvedCommand({
          id: "c1",
          name: "Create Task",
          category: "creation",
        }),
        createResolvedCommand({ id: "u1", name: "Uncategorized" }),
      ]);
      mockEvaluate.mockResolvedValue(true);

      const result = await builder.buildCategoryGroups(createContext());

      expect(result.map((g) => g.id)).toEqual([
        "dynamic-commands-creation",
        "dynamic-commands-other",
      ]);
      const other = result.find((g) => g.id === "dynamic-commands-other");
      expect(other?.buttons.map((b) => b.label)).toEqual(["Uncategorized"]);
    });

    it("should return [] when no commands resolved", async () => {
      mockResolveForAssetMulti.mockResolvedValue([]);
      const result = await builder.buildCategoryGroups(createContext());
      expect(result).toEqual([]);
    });

    it("should return [] when resolver throws", async () => {
      mockResolveForAssetMulti.mockRejectedValue(new Error("boom"));
      const result = await builder.buildCategoryGroups(createContext());
      expect(result).toEqual([]);
    });
  });
});
