import { DynamicCommandButtonGroupBuilder } from "../../../../src/presentation/builders/button-groups/DynamicCommandButtonGroupBuilder";
import { PanelResolver } from "../../../../src/application/services/PanelResolver";
import type { CommandPanel } from "../../../../src/domain/layout/CommandPanel";
import { GroundingType, CommandExecutionFlow } from "exocortex";
import type { CommandPromptAdapter, UserInput } from "exocortex";

const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
};

/**
 * Test prompt adapter that defers to `window.confirm` (matching the
 * production `ObsidianCommandPromptAdapter`) and never opens a real modal.
 * Tests that exercise `inputSchema`-driven modal flow live in
 * `CommandExecutionFlow.test.ts`, not here.
 */
class TestPromptAdapter implements CommandPromptAdapter {
  async confirm(message: string): Promise<boolean> {
    // eslint-disable-next-line no-alert -- mirrors production adapter
    return window.confirm(message);
  }
  async promptInputSchema(): Promise<UserInput | null> {
    return null;
  }
}

function buildCommandExecutionFlow(): CommandExecutionFlow {
  return new CommandExecutionFlow(
    mockGroundingExecutor as unknown as Parameters<
      typeof CommandExecutionFlow.prototype.run
    >[0] extends never
      ? never
      : any,
    mockNotificationService as any,
    mockLogger as any,
    new TestPromptAdapter(),
  );
}

const mockResolveForAsset = jest.fn();
const mockResolveForAssetMulti = jest.fn();
const mockResolveLabelByUID = jest.fn();
const mockEvaluate = jest.fn();
const mockExecute = jest.fn();

const mockCommandResolver = {
  resolveForAsset: mockResolveForAsset,
  resolveForAssetMulti: mockResolveForAssetMulti,
  resolveLabelByUID: mockResolveLabelByUID,
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
      commandExecutionFlow: buildCommandExecutionFlow(),
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

    it("Issue #3141 — should expand UUID-form instance class refs to symbolic Asset_label so class-targeted bindings match after UUID-canon strip-aliases", async () => {
      mockResolveForAssetMulti.mockResolvedValue([]);
      const classUid = "1b20a8f0-d745-4e93-91db-4531b3df120e";
      const mockClassFile = { path: "assetspaces/ems/" + classUid + ".md" };
      const context = createContext({
        exo__Instance_class: ["[[" + classUid + "]]"],
      });
      // Wire metadataCache so the resolver finds the class file and reads its label
      (context.app as any).metadataCache = {
        getFirstLinkpathDest: jest.fn((link: string) =>
          link === classUid ? mockClassFile : null,
        ),
        getFileCache: jest.fn((file: any) =>
          file === mockClassFile
            ? { frontmatter: { exo__Asset_label: "ems__Task" } }
            : null,
        ),
      };

      await builder.build(context);

      // Expect both UUID and symbolic forms passed through to the resolver,
      // plus the universal exo__Asset superclass appended last.
      expect(mockResolveForAssetMulti).toHaveBeenCalledWith(
        "obsidian://vault/test/file.md",
        [classUid, "ems__Task", "exo__Asset"],
        undefined,
      );
    });

    it("Issue #3141 — should gracefully no-op symbolic expansion when both metadataCache and triple-store have no label", async () => {
      mockResolveForAssetMulti.mockResolvedValue([]);
      const classUid = "1b20a8f0-d745-4e93-91db-4531b3df120e";
      const context = createContext({
        exo__Instance_class: ["[[" + classUid + "]]"],
      });
      // No metadataCache wired — must not throw, just pass UUID through.
      (context.app as any) = {};
      // Triple-store fallback also empty in this scenario (asset graph cold).
      mockResolveLabelByUID.mockResolvedValue(null);

      await builder.build(context);

      expect(mockResolveForAssetMulti).toHaveBeenCalledWith(
        "obsidian://vault/test/file.md",
        [classUid, "exo__Asset"],
        undefined,
      );
    });

    it("Issue #3141 follow-up — should fall back to commandResolver.resolveLabelByUID when metadataCache cannot find the class file (cold-start race)", async () => {
      mockResolveForAssetMulti.mockResolvedValue([]);
      const classUid = "7ab483c7-aafc-4ac8-8aca-0de52db34a93";
      const context = createContext({
        exo__Instance_class: ["[[" + classUid + "]]"],
      });
      // metadataCache wired but returns null — simulates cold-start window
      // where Obsidian hasn't yet indexed `assetspaces/ems/<uid>.md`.
      (context.app as any).metadataCache = {
        getFirstLinkpathDest: jest.fn().mockReturnValue(null),
        getFileCache: jest.fn(),
      };
      // Triple store has the class indexed (NoteToRDFConverter runs first).
      mockResolveLabelByUID.mockResolvedValue("ems__MeetingPrototype");

      await builder.build(context);

      expect(mockResolveLabelByUID).toHaveBeenCalledWith(classUid);
      expect(mockResolveForAssetMulti).toHaveBeenCalledWith(
        "obsidian://vault/test/file.md",
        [classUid, "ems__MeetingPrototype", "exo__Asset"],
        undefined,
      );
    });

    it("Issue #3141 follow-up — should prefer metadataCache hit over triple-store fallback (fast path stays fast)", async () => {
      mockResolveForAssetMulti.mockResolvedValue([]);
      const classUid = "1b20a8f0-d745-4e93-91db-4531b3df120e";
      const mockClassFile = { path: "assetspaces/ems/" + classUid + ".md" };
      const context = createContext({
        exo__Instance_class: ["[[" + classUid + "]]"],
      });
      (context.app as any).metadataCache = {
        getFirstLinkpathDest: jest.fn((link: string) =>
          link === classUid ? mockClassFile : null,
        ),
        getFileCache: jest.fn((file: any) =>
          file === mockClassFile
            ? { frontmatter: { exo__Asset_label: "ems__Task" } }
            : null,
        ),
      };
      // resolveLabelByUID must NOT be called when metadataCache already
      // produced the symbolic label — avoids an unnecessary triple-store
      // round-trip in the warm path.
      mockResolveLabelByUID.mockResolvedValue("SHOULD_NOT_BE_USED");

      await builder.build(context);

      expect(mockResolveLabelByUID).not.toHaveBeenCalled();
      expect(mockResolveForAssetMulti).toHaveBeenCalledWith(
        "obsidian://vault/test/file.md",
        [classUid, "ems__Task", "exo__Asset"],
        undefined,
      );
    });

    it("Issue #3141 follow-up — should log a warning when both metadataCache and triple-store fail to resolve a UUID class ref", async () => {
      mockResolveForAssetMulti.mockResolvedValue([]);
      const classUid = "deadbeef-0000-4000-8000-000000000000";
      const context = createContext({
        exo__Instance_class: ["[[" + classUid + "]]"],
      });
      (context.app as any).metadataCache = {
        getFirstLinkpathDest: jest.fn().mockReturnValue(null),
        getFileCache: jest.fn(),
      };
      mockResolveLabelByUID.mockResolvedValue(null);

      await builder.build(context);

      const infoLogs = (context.logger.info as jest.Mock).mock.calls;
      const matched = infoLogs.find(
        ([msg]: [string]) =>
          typeof msg === "string" &&
          msg.includes(classUid) &&
          msg.includes("no symbolic"),
      );
      expect(matched).toBeDefined();
    });

    it("Issue #3141 follow-up — should log a warning and continue when triple-store fallback throws", async () => {
      mockResolveForAssetMulti.mockResolvedValue([]);
      const classUid = "cafebabe-0000-4000-8000-000000000000";
      const context = createContext({
        exo__Instance_class: ["[[" + classUid + "]]"],
      });
      (context.app as any).metadataCache = {
        getFirstLinkpathDest: jest.fn().mockReturnValue(null),
        getFileCache: jest.fn(),
      };
      mockResolveLabelByUID.mockRejectedValue(new Error("triple-store-down"));

      await builder.build(context);

      const infoLogs = (context.logger.info as jest.Mock).mock.calls;
      const threwLog = infoLogs.find(
        ([msg]: [string]) =>
          typeof msg === "string" &&
          msg.includes(classUid) &&
          msg.includes("threw"),
      );
      expect(threwLog).toBeDefined();
      // Builder still calls into the resolver with UUID alone (and exo__Asset),
      // i.e. throw does not abort the whole render pipeline.
      expect(mockResolveForAssetMulti).toHaveBeenCalledWith(
        "obsidian://vault/test/file.md",
        [classUid, "exo__Asset"],
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

    it("should resolve variant from command category via categoryDefaultVariant map", async () => {
      // RFC f1dc284a: `creation` category maps to `primary` by built-in defaults.
      const rc = createResolvedCommand({
        name: "Create action",
        category: "creation",
      });
      mockResolveForAssetMulti.mockResolvedValue([rc]);
      mockEvaluate.mockResolvedValue(true);

      const context = createContext();
      const result = await builder.build(context);

      expect(result[0].variant).toBe("primary");
    });

    it("should map maintenance category to muted variant", async () => {
      const rc = createResolvedCommand({
        name: "Rebuild index",
        category: "maintenance",
      });
      mockResolveForAssetMulti.mockResolvedValue([rc]);
      mockEvaluate.mockResolvedValue(true);

      const context = createContext();
      const result = await builder.build(context);

      expect(result[0].variant).toBe("muted");
    });

    it("should default variant to secondary when no category", async () => {
      const rc = createResolvedCommand({
        name: "Default action",
        category: undefined,
      });
      mockResolveForAssetMulti.mockResolvedValue([rc]);
      mockEvaluate.mockResolvedValue(true);

      const context = createContext();
      const result = await builder.build(context);

      expect(result[0].variant).toBe("secondary");
    });

    it("binding.variant override wins over category default and featuredBinding (RFC f1dc284a)", async () => {
      // Кейс A: destructive maintenance command rendered as `danger`.
      const rc = createResolvedCommand(
        { name: "Delete asset", category: "maintenance" },
        { variant: "danger" },
      );
      mockResolveForAssetMulti.mockResolvedValue([rc]);
      mockEvaluate.mockResolvedValue(true);

      const context = createContext();
      const result = await builder.build(context);

      expect(result[0].variant).toBe("danger");
    });

    it("should default variant to secondary for unknown category", async () => {
      const rc = createResolvedCommand(
        { name: "Future action", category: "future-uncategorized" },
        { id: "binding-unknown-category" },
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
        commandExecutionFlow: buildCommandExecutionFlow(),
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

    it("buildCategoryGroups collapses categories listed in panel.collapsedGroups (vault override)", async () => {
      const commands = [
        createResolvedCommand({
          id: "c1",
          name: "Create",
          category: "creation",
        }),
        createResolvedCommand({
          id: "m1",
          name: "Mark Done",
          category: "maintenance",
        }),
      ];
      mockResolveForAssetMulti.mockResolvedValue(commands);
      mockEvaluate.mockResolvedValue(true);

      // Vault collapses creation (which TS-defaults expanded) and overrides
      // maintenance to expanded by omitting it from collapsedGroups.
      const builder = makeBuilderWithPanel({ collapsedGroups: ["creation"] });
      const result = await builder.buildCategoryGroups(createContext());
      const byId = new Map(result.map((g) => [g.id, g]));

      expect(byId.get("dynamic-commands-creation")?.collapsedByDefault).toBe(
        true,
      );
      expect(
        byId.get("dynamic-commands-maintenance")?.collapsedByDefault,
      ).toBeFalsy();
    });

    it("buildCategoryGroups falls back to TS defaults when panel.collapsedGroups absent", async () => {
      const commands = [
        createResolvedCommand({
          id: "c1",
          name: "Create",
          category: "creation",
        }),
        createResolvedCommand({
          id: "m1",
          name: "Mark Done",
          category: "maintenance",
        }),
      ];
      mockResolveForAssetMulti.mockResolvedValue(commands);
      mockEvaluate.mockResolvedValue(true);

      const builder = makeBuilderWithPanel({});
      const result = await builder.buildCategoryGroups(createContext());
      const byId = new Map(result.map((g) => [g.id, g]));

      expect(byId.get("dynamic-commands-creation")?.collapsedByDefault).toBe(
        false,
      );
      expect(byId.get("dynamic-commands-maintenance")?.collapsedByDefault).toBe(
        true,
      );
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

    it("featuredBinding promotes its binding to primary regardless of category default", async () => {
      const featured = createResolvedCommand(
        // `maintenance` would normally resolve to `muted` per Phase 0 defaults.
        { id: "c-featured", name: "Featured", category: "maintenance" },
        { id: "binding-featured" },
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

    it("non-featured bindings keep their category-derived variant", async () => {
      const nonFeatured = createResolvedCommand(
        { id: "c-other", name: "Maintenance Op", category: "maintenance" },
        { id: "binding-other" },
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

  // -- T3 — RFC f1dc284a variant precedence chain ----------------------------
  // Six explicit branches of:
  //   binding.variant > featuredBinding > category default > "secondary"
  // Each test labels its branch (a–f) so the AC checklist on
  // task 4ed5c130-6aae-4e36-acb0-6292852be67d can be verified by name.
  describe("variant precedence chain (RFC f1dc284a, T3)", () => {
    function makeBuilderWithFeatured(featuredBindingId: string | undefined) {
      const panelResolver = new PanelResolver({
        layoutProvider: (classRef) =>
          classRef === "ems__Task"
            ? {
                commandPanel: featuredBindingId
                  ? { featuredBinding: featuredBindingId }
                  : {},
              }
            : null,
      });
      return new DynamicCommandButtonGroupBuilder({
        commandResolver: mockCommandResolver as unknown as any,
        preconditionEvaluator: mockPreconditionEvaluator as unknown as any,
        commandExecutionFlow: buildCommandExecutionFlow(),
        panelResolver,
      });
    }

    it("(a) binding.variant=danger wins over featuredBinding and category default", async () => {
      // featuredBinding would normally promote to `primary`; category
      // `creation` would normally default to `primary`. Explicit
      // `binding.variant=danger` must beat both.
      const rc = createResolvedCommand(
        { name: "Hard delete", category: "creation" },
        { id: "binding-a", variant: "danger" },
      );
      mockResolveForAssetMulti.mockResolvedValue([rc]);
      mockEvaluate.mockResolvedValue(true);

      const builder = makeBuilderWithFeatured("binding-a");
      const result = await builder.build(createContext());

      expect(result).toHaveLength(1);
      expect(result[0].variant).toBe("danger");
    });

    it("(b) no variant + category=creation → primary", async () => {
      const rc = createResolvedCommand(
        { name: "Create Task", category: "creation" },
        { id: "binding-b" },
      );
      expect(rc.binding.variant).toBeUndefined();
      mockResolveForAssetMulti.mockResolvedValue([rc]);
      mockEvaluate.mockResolvedValue(true);

      const result = await builder.build(createContext());

      expect(result[0].variant).toBe("primary");
    });

    it("(c) no variant + unknown category → secondary fallback", async () => {
      const rc = createResolvedCommand(
        { name: "Mystery action", category: "future-uncategorized-bucket" },
        { id: "binding-c" },
      );
      mockResolveForAssetMulti.mockResolvedValue([rc]);
      mockEvaluate.mockResolvedValue(true);

      const result = await builder.build(createContext());

      expect(result[0].variant).toBe("secondary");
    });

    it("(d) variant=danger on a maintenance category → variant wins over category default `muted`", async () => {
      // Sanity check that an explicit `_variant` override always beats the
      // category-derived default. (Pre-RFC f1dc284a Phase 8 this branch was
      // labelled "legacy `group` + `variant` coexistence"; with `_group`
      // parsing dropped only the variant axis remains.)
      const rc = createResolvedCommand(
        { name: "Wipe cache", category: "maintenance" },
        { id: "binding-d", variant: "danger" },
      );
      mockResolveForAssetMulti.mockResolvedValue([rc]);
      mockEvaluate.mockResolvedValue(true);

      const result = await builder.build(createContext());

      expect(result[0].variant).toBe("danger");
    });

    it("(e) backward compat — binding without _variant produces stable UI snapshot", async () => {
      // Pre-RFC fixture: explicit `_variant` absent, only category drives
      // colour. Snapshot pins the full button shape so a future regression
      // (e.g. accidental field reorder, default flip) flags here.
      const rc = createResolvedCommand(
        {
          id: "cmd-legacy",
          name: "Mark Done",
          category: "status",
          icon: "check",
        },
        { id: "binding-legacy" },
      );
      expect(rc.binding.variant).toBeUndefined();
      mockResolveForAssetMulti.mockResolvedValue([rc]);
      mockEvaluate.mockResolvedValue(true);

      const result = await builder.build(createContext());

      expect(result).toHaveLength(1);
      const { onClick: _onClick, ...snapshot } = result[0];
      expect(snapshot).toMatchInlineSnapshot(`
{
  "ariaLabel": undefined,
  "icon": "check",
  "id": "dynamic-cmd-cmd-legacy",
  "label": "Mark Done",
  "tooltip": undefined,
  "variant": "secondary",
  "visible": true,
}
`);
    });

    it("(f) binding.variant=warning + featuredBinding=this → explicit variant beats featured promotion", async () => {
      const rc = createResolvedCommand(
        { name: "Caution action", category: "creation" },
        { id: "binding-f", variant: "warning" },
      );
      mockResolveForAssetMulti.mockResolvedValue([rc]);
      mockEvaluate.mockResolvedValue(true);

      const builder = makeBuilderWithFeatured("binding-f");
      const result = await builder.build(createContext());

      // Without binding.variant, featured would have promoted to `primary`.
      // With explicit `warning`, that wins per RFC §Кейс A precedence.
      expect(result[0].variant).toBe("warning");
    });
  });

  // -- Issue #3175 — performance.mark cold-start observability ----------------
  // Replaces console.time markers from PR #3173 with Web Performance API so
  // the cold-start cold-start latency is programmatic-queryable
  // (`performance.getEntriesByName('exocmd-fastpath')[0].duration`) and visible
  // without Verbose log level in DevTools.
  describe("Issue #3175: performance.mark on fast-path first render", () => {
    // jsdom does not implement Web Performance API marks — install jest
    // mocks directly on the global performance object and restore the
    // originals after each test.
    let markSpy: jest.Mock;
    let measureSpy: jest.Mock;
    let originalMark: unknown;
    let originalMeasure: unknown;

    beforeEach(() => {
      originalMark = (performance as unknown as Record<string, unknown>)[
        "mark"
      ];
      originalMeasure = (performance as unknown as Record<string, unknown>)[
        "measure"
      ];
      markSpy = jest.fn();
      measureSpy = jest.fn();
      (performance as unknown as Record<string, unknown>)["mark"] = markSpy;
      (performance as unknown as Record<string, unknown>)["measure"] =
        measureSpy;
    });

    afterEach(() => {
      (performance as unknown as Record<string, unknown>)["mark"] =
        originalMark;
      (performance as unknown as Record<string, unknown>)["measure"] =
        originalMeasure;
    });

    function makeBuilderWithFastPath(opts: {
      visibleCommands: ResolvedCommand[];
      fullPathReady: boolean;
    }) {
      const fastResolver = {
        resolveVisibleCommands: jest
          .fn()
          .mockResolvedValue(opts.visibleCommands),
        invalidateCache: jest.fn(),
      };
      return {
        builder: new DynamicCommandButtonGroupBuilder({
          commandResolver: mockCommandResolver as unknown as any,
          preconditionEvaluator: mockPreconditionEvaluator as unknown as any,
          commandExecutionFlow: buildCommandExecutionFlow(),
          fastResolver: fastResolver as unknown as any,
          isFullPathReady: () => opts.fullPathReady,
        }),
        fastResolver,
      };
    }

    it("emits performance.mark('exocmd-fastpath-ready') + measure on first fast-path render with visible commands", async () => {
      const rc = createResolvedCommand();
      const { builder } = makeBuilderWithFastPath({
        visibleCommands: [rc],
        fullPathReady: false,
      });

      await builder.build(createContext());

      expect(markSpy).toHaveBeenCalledWith("exocmd-fastpath-ready");
      expect(measureSpy).toHaveBeenCalledWith(
        "exocmd-fastpath",
        "exocmd-fastpath-start",
        "exocmd-fastpath-ready",
      );
    });

    it("emits the fastpath marker exactly once across multiple build() calls (guarded by fastpathReadyMarked)", async () => {
      const rc = createResolvedCommand();
      const { builder } = makeBuilderWithFastPath({
        visibleCommands: [rc],
        fullPathReady: false,
      });

      await builder.build(createContext());
      await builder.build(createContext());
      await builder.build(createContext());

      const readyMarkCalls = markSpy.mock.calls.filter(
        ([label]) => label === "exocmd-fastpath-ready",
      );
      expect(readyMarkCalls).toHaveLength(1);
      const fastpathMeasureCalls = measureSpy.mock.calls.filter(
        ([label]) => label === "exocmd-fastpath",
      );
      expect(fastpathMeasureCalls).toHaveLength(1);
    });

    it("emits the fastpath marker even when fast-path returns zero visible commands (Issue #3190)", async () => {
      // Issue #3190 contract amendment: the mark documents "fast-path
      // branch executed to completion" — independent of whether anything
      // matched. Pre-#3190 the mark was guarded by `visible.length > 0`,
      // which conflated "fast-path never ran" (no mark) with "fast-path
      // ran but the open file's metadata cache was not yet warm so it
      // returned []" (also no mark) — empirical evidence for #3190 showed
      // the mark perpetually missing in the latter case.
      const { builder } = makeBuilderWithFastPath({
        visibleCommands: [],
        fullPathReady: false,
      });

      await builder.build(createContext());

      expect(markSpy).toHaveBeenCalledWith("exocmd-fastpath-ready");
      expect(measureSpy).toHaveBeenCalledWith(
        "exocmd-fastpath",
        "exocmd-fastpath-start",
        "exocmd-fastpath-ready",
      );
    });

    it("does NOT emit the fastpath marker when full path is ready (fast-path branch skipped)", async () => {
      const rc = createResolvedCommand();
      mockResolveForAssetMulti.mockResolvedValue([rc]);
      mockEvaluate.mockResolvedValue(true);
      const { builder } = makeBuilderWithFastPath({
        visibleCommands: [rc],
        fullPathReady: true,
      });

      await builder.build(createContext());

      expect(markSpy).not.toHaveBeenCalledWith("exocmd-fastpath-ready");
    });
  });
});
