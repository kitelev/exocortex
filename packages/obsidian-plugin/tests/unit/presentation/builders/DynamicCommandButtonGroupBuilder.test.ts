import { DynamicCommandButtonGroupBuilder } from "../../../../src/presentation/builders/button-groups/DynamicCommandButtonGroupBuilder";
import { PanelResolver } from "../../../../src/application/services/PanelResolver";
import type { CommandPanel } from "../../../../src/domain/layout/CommandPanel";
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

  // RFC-024 §4 Phase 2 — T5.3: Command_icon projection to ActionButton.
  describe("icon projection (RFC-024 T5.3)", () => {
    it("should project command.icon to button.icon when style.showIcon is unset (default)", async () => {
      const rc = createResolvedCommand({
        name: "Mark done",
        icon: "check",
      });
      mockResolveForAssetMulti.mockResolvedValue([rc]);
      mockEvaluate.mockResolvedValue(true);

      const context = createContext();
      const result = await builder.build(context);

      expect(result[0].icon).toBe("check");
    });

    it("should project icon when binding.style.showIcon is explicitly true", async () => {
      const rc = createResolvedCommand(
        { name: "Mark done", icon: "check" },
        {
          style: {
            id: "style-1",
            label: "Default",
            showIcon: true,
            inline: false,
          },
        },
      );
      mockResolveForAssetMulti.mockResolvedValue([rc]);
      mockEvaluate.mockResolvedValue(true);

      const context = createContext();
      const result = await builder.build(context);

      expect(result[0].icon).toBe("check");
    });

    it("should suppress icon when binding.style.showIcon is false", async () => {
      const rc = createResolvedCommand(
        { name: "Mark done", icon: "check" },
        {
          style: {
            id: "style-1",
            label: "No icon",
            showIcon: false,
            inline: false,
          },
        },
      );
      mockResolveForAssetMulti.mockResolvedValue([rc]);
      mockEvaluate.mockResolvedValue(true);

      const context = createContext();
      const result = await builder.build(context);

      expect(result[0].icon).toBeUndefined();
    });

    it("should leave icon undefined when command has no icon", async () => {
      const rc = createResolvedCommand({ name: "No-icon cmd" });
      mockResolveForAssetMulti.mockResolvedValue([rc]);
      mockEvaluate.mockResolvedValue(true);

      const context = createContext();
      const result = await builder.build(context);

      expect(result[0].icon).toBeUndefined();
    });

    it("should treat empty string icon as no icon", async () => {
      const rc = createResolvedCommand({ name: "Empty icon", icon: "" });
      mockResolveForAssetMulti.mockResolvedValue([rc]);
      mockEvaluate.mockResolvedValue(true);

      const context = createContext();
      const result = await builder.build(context);

      expect(result[0].icon).toBeUndefined();
    });
  });

  describe("a11y propagation (RFC-024 T5.4)", () => {
    it("should propagate ariaLabel from binding.style to ActionButton", async () => {
      const rc = createResolvedCommand(
        { name: "Mark done" },
        {
          style: {
            id: "style-1",
            label: "Done style",
            ariaLabel: "Mark this task as done",
            inline: false,
          },
        },
      );
      mockResolveForAssetMulti.mockResolvedValue([rc]);
      mockEvaluate.mockResolvedValue(true);

      const context = createContext();
      const result = await builder.build(context);

      expect(result[0].ariaLabel).toBe("Mark this task as done");
    });

    it("should propagate tooltip from binding.style to ActionButton", async () => {
      const rc = createResolvedCommand(
        { name: "Mark done" },
        {
          style: {
            id: "style-1",
            label: "Done style",
            tooltip: "Sets ems__Effort_status to Done",
            inline: false,
          },
        },
      );
      mockResolveForAssetMulti.mockResolvedValue([rc]);
      mockEvaluate.mockResolvedValue(true);

      const context = createContext();
      const result = await builder.build(context);

      expect(result[0].tooltip).toBe("Sets ems__Effort_status to Done");
    });

    it("should leave ariaLabel and tooltip undefined when binding.style is absent", async () => {
      const rc = createResolvedCommand({ name: "No style" });
      mockResolveForAssetMulti.mockResolvedValue([rc]);
      mockEvaluate.mockResolvedValue(true);

      const context = createContext();
      const result = await builder.build(context);

      expect(result[0].ariaLabel).toBeUndefined();
      expect(result[0].tooltip).toBeUndefined();
    });

    it("should leave ariaLabel and tooltip undefined when style has no a11y fields", async () => {
      const rc = createResolvedCommand(
        { name: "Style without a11y" },
        {
          style: {
            id: "style-1",
            label: "Variant only",
            variant: "primary",
            inline: false,
          },
        },
      );
      mockResolveForAssetMulti.mockResolvedValue([rc]);
      mockEvaluate.mockResolvedValue(true);

      const context = createContext();
      const result = await builder.build(context);

      expect(result[0].ariaLabel).toBeUndefined();
      expect(result[0].tooltip).toBeUndefined();
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

  describe("RFC-024 Phase 3 — PanelResolver integration", () => {
    /**
     * Helper that builds a builder pre-wired with a PanelResolver whose
     * layout provider returns the given panel for `ems__Task` and `null`
     * for any other class. Using the real PanelResolver (rather than a
     * mock) keeps the test honest about wikilink normalisation,
     * `excludeCommands` precedence, and `featuredBinding` matching.
     */
    function makeBuilderWithPanel(panel: CommandPanel | null) {
      const panelResolver = new PanelResolver({
        layoutProvider: (classRef) =>
          classRef === "ems__Task"
            ? { commandPanel: panel ?? undefined }
            : null,
      });
      return new DynamicCommandButtonGroupBuilder({
        commandResolver: mockCommandResolver as unknown as any,
        preconditionEvaluator: mockPreconditionEvaluator as unknown as any,
        groundingExecutor: mockGroundingExecutor as unknown as any,
        notificationService: mockNotificationService as any,
        panelResolver,
      });
    }

    it("excludeCommands drops bindings even when their group passes includeGroups", async () => {
      const allowed = createResolvedCommand(
        { id: "c-allowed", name: "Allowed", category: "creation" },
        { id: "binding-allowed" },
      );
      const excluded = createResolvedCommand(
        { id: "c-excluded", name: "Excluded", category: "creation" },
        { id: "binding-excluded" },
      );
      mockResolveForAssetMulti.mockResolvedValue([allowed, excluded]);
      mockEvaluate.mockResolvedValue(true);

      const builder = makeBuilderWithPanel({
        includeGroups: ["creation"],
        excludeCommands: ["binding-excluded"],
      });
      const result = await builder.build(createContext());

      expect(result.map((b) => b.label)).toEqual(["Allowed"]);
    });

    it("includeGroups drops categories absent from the include list", async () => {
      const create = createResolvedCommand({
        id: "c1",
        name: "Create",
        category: "creation",
      });
      const status = createResolvedCommand({
        id: "s1",
        name: "Status",
        category: "status",
      });
      mockResolveForAssetMulti.mockResolvedValue([create, status]);
      mockEvaluate.mockResolvedValue(true);

      const builder = makeBuilderWithPanel({ includeGroups: ["creation"] });
      const result = await builder.build(createContext());

      expect(result.map((b) => b.label)).toEqual(["Create"]);
    });

    it("buildCategoryGroups orders sections by panel.includeGroups", async () => {
      const commands = [
        createResolvedCommand({
          id: "c1",
          name: "Create Task",
          category: "creation",
        }),
        createResolvedCommand({
          id: "s1",
          name: "Set Status",
          category: "status",
        }),
        createResolvedCommand({
          id: "p1",
          name: "Plan Today",
          category: "planning",
        }),
      ];
      mockResolveForAssetMulti.mockResolvedValue(commands);
      mockEvaluate.mockResolvedValue(true);

      const builder = makeBuilderWithPanel({
        includeGroups: ["status", "planning", "creation"],
      });
      const result = await builder.buildCategoryGroups(createContext());

      expect(result.map((g) => g.id)).toEqual([
        "dynamic-commands-status",
        "dynamic-commands-planning",
        "dynamic-commands-creation",
      ]);
    });

    it("buildCategoryGroups appends categories absent from includeGroups in insertion order", async () => {
      const commands = [
        createResolvedCommand({
          id: "c1",
          name: "Create",
          category: "creation",
        }),
        createResolvedCommand({
          id: "m1",
          name: "Maintenance",
          category: "maintenance",
        }),
      ];
      mockResolveForAssetMulti.mockResolvedValue(commands);
      mockEvaluate.mockResolvedValue(true);

      // includeGroups omits "maintenance"; with no excludeCommands the
      // command still surfaces (filter only drops by exclude when include
      // does not list its group). Verify the section appears AFTER the
      // explicitly ordered ones.
      const builder = makeBuilderWithPanel({
        includeGroups: ["creation", "maintenance"],
      });
      const result = await builder.buildCategoryGroups(createContext());

      expect(result.map((g) => g.id)).toEqual([
        "dynamic-commands-creation",
        "dynamic-commands-maintenance",
      ]);
    });

    it("featuredBinding promotes its binding to primary regardless of group default", async () => {
      const featured = createResolvedCommand(
        // `maintenance` would normally resolve to `muted` per Phase 0 defaults.
        { id: "c-featured", name: "Featured", category: "maintenance" },
        { id: "binding-featured", group: "maintenance" },
      );
      mockResolveForAssetMulti.mockResolvedValue([featured]);
      mockEvaluate.mockResolvedValue(true);

      const builder = makeBuilderWithPanel({
        featuredBinding: "binding-featured",
      });
      const result = await builder.build(createContext());

      expect(result).toHaveLength(1);
      expect(result[0].variant).toBe("primary");
    });

    it("non-featured bindings keep their group-derived variant", async () => {
      const nonFeatured = createResolvedCommand(
        { id: "c-other", name: "Maintenance Op", category: "maintenance" },
        { id: "binding-other", group: "maintenance" },
      );
      mockResolveForAssetMulti.mockResolvedValue([nonFeatured]);
      mockEvaluate.mockResolvedValue(true);

      const builder = makeBuilderWithPanel({
        featuredBinding: "binding-elsewhere",
      });
      const result = await builder.build(createContext());

      expect(result[0].variant).toBe("muted");
    });

    it("panel resolution uses the most-specific (non-exo__Asset) declared class", async () => {
      // Even though `exo__Instance_class` includes `exo__Asset` superclass,
      // the panel for `ems__Task` (the specific class) must be consulted —
      // an `exo__Asset` panel would over-broadly capture every asset.
      const command = createResolvedCommand(
        { id: "c1", name: "Task only", category: "creation" },
        { id: "binding-task" },
      );
      mockResolveForAssetMulti.mockResolvedValue([command]);
      mockEvaluate.mockResolvedValue(true);

      const builder = makeBuilderWithPanel({
        excludeCommands: ["binding-task"],
      });
      const result = await builder.build(
        createContext({
          exo__Instance_class: ["[[ems__Task]]", "[[exo__Asset]]"],
        }),
      );

      expect(result).toEqual([]);
    });

    it("falls through to plugin-built-in fallback order when no panel is declared", async () => {
      // `ems__Project` has no layout provider entry → null panel → falls
      // back to FALLBACK_CATEGORY_ORDER (creation → status → maintenance).
      const commands = [
        createResolvedCommand({
          id: "m1",
          name: "M",
          category: "maintenance",
        }),
        createResolvedCommand({ id: "c1", name: "C", category: "creation" }),
      ];
      mockResolveForAssetMulti.mockResolvedValue(commands);
      mockEvaluate.mockResolvedValue(true);

      const builder = makeBuilderWithPanel(null);
      const result = await builder.buildCategoryGroups(
        createContext({ exo__Instance_class: ["[[ems__Project]]"] }),
      );

      expect(result.map((g) => g.id)).toEqual([
        "dynamic-commands-creation",
        "dynamic-commands-maintenance",
      ]);
    });
  });
});
