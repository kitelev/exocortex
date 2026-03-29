import { TFile } from "obsidian";
import { StatusButtonGroupBuilder } from "../../../../src/presentation/builders/button-groups/StatusButtonGroupBuilder";
import {
  ButtonBuilderContext,
  ButtonBuilderServices,
} from "../../../../src/presentation/builders/button-groups/ButtonBuilderTypes";
import {
  TaskStatusService,
  CommandVisibilityContext,
  EffortStatus,
} from "exocortex";
import { ILogger } from "../../../../src/infrastructure/logging/ILogger";
import { createMockMetadata } from "../../helpers/testHelpers";

function createMockServices(): ButtonBuilderServices {
  return {
    app: {} as any,
    taskCreationService: {} as any,
    projectCreationService: {} as any,
    areaCreationService: {} as any,
    classCreationService: {} as any,
    conceptCreationService: {} as any,
    taskStatusService: {
      setDraftStatus: jest.fn(),
      moveToBacklog: jest.fn(),
      moveToAnalysis: jest.fn(),
      moveToToDo: jest.fn(),
      startEffort: jest.fn(),
      markTaskAsDone: jest.fn(),
      rollbackStatus: jest.fn(),
    } as unknown as TaskStatusService,
    propertyCleanupService: {} as any,
    folderRepairService: {} as any,
    renameToUidService: {} as any,
    effortVotingService: {} as any,
    labelToAliasService: {} as any,
    assetConversionService: {} as any,
  };
}

function createMockLogger(): jest.Mocked<ILogger> {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as jest.Mocked<ILogger>;
}

function createMockFile(path = "test.md"): TFile {
  return {
    path,
    name: "test.md",
    basename: "test",
    extension: "md",
    parent: null,
    vault: {
      read: jest.fn().mockResolvedValue('---\nems__Effort_status: "[[ems__EffortStatusBacklog]]"\n---\n'),
      modify: jest.fn().mockResolvedValue(undefined),
    },
    stat: { ctime: Date.now(), mtime: Date.now(), size: 100 },
  } as unknown as TFile;
}

function createContext(overrides: {
  instanceClass?: string | string[] | null;
  currentStatus?: string | null;
  isArchived?: boolean;
  metadata?: Record<string, unknown>;
}): ButtonBuilderContext {
  const {
    instanceClass = "ems__Task",
    currentStatus = `[[${EffortStatus.BACKLOG}]]`,
    isArchived = false,
    metadata = {},
  } = overrides;

  const visibilityContext: CommandVisibilityContext = {
    instanceClass,
    currentStatus,
    metadata: metadata as Record<string, unknown>,
    isArchived,
    currentFolder: "Tasks",
    expectedFolder: "Tasks",
  };

  const mergedMetadata: Record<string, unknown> = {
    ...createMockMetadata({
      exo__Instance_class: instanceClass,
      ems__Effort_status: currentStatus,
    }),
    ...metadata,
  };

  return {
    app: {} as any,
    settings: {} as any,
    plugin: {} as any,
    file: createMockFile(),
    metadata: mergedMetadata,
    instanceClass,
    visibilityContext,
    logger: createMockLogger(),
    refresh: jest.fn().mockResolvedValue(undefined),
  };
}

describe("StatusButtonGroupBuilder - workflow fallback", () => {
  let builder: StatusButtonGroupBuilder;
  let services: ButtonBuilderServices;

  beforeEach(() => {
    services = createMockServices();
    builder = new StatusButtonGroupBuilder(services);
  });

  describe("group metadata", () => {
    it('should return groupId "status"', () => {
      expect(builder.getGroupId()).toBe("status");
    });

    it('should return groupTitle "Status"', () => {
      expect(builder.getGroupTitle()).toBe("Status");
    });
  });

  describe("standard classes use hardcoded buttons (no fallback)", () => {
    it("ems__Task with Backlog status returns standard buttons with Start Effort visible", async () => {
      const context = createContext({
        instanceClass: "ems__Task",
        currentStatus: `[[${EffortStatus.BACKLOG}]]`,
      });

      const buttons = await builder.build(context);

      const startEffort = buttons.find((b) => b.id === "start-effort");
      expect(startEffort).toBeDefined();
      expect(startEffort?.visible).toBe(true);
      expect(startEffort?.label).toBe("Start Effort");

      const hasVisibleStandard = buttons.some((b) => b.visible);
      expect(hasVisibleStandard).toBe(true);

      const workflowIds = buttons.filter((b) => b.id.startsWith("workflow-"));
      expect(workflowIds).toHaveLength(0);
    });

    it("ems__Project with ToDo status returns standard buttons with Start Effort visible", async () => {
      const context = createContext({
        instanceClass: "ems__Project",
        currentStatus: `[[${EffortStatus.TODO}]]`,
      });

      const buttons = await builder.build(context);

      const startEffort = buttons.find((b) => b.id === "start-effort");
      expect(startEffort).toBeDefined();
      expect(startEffort?.visible).toBe(true);

      const workflowIds = buttons.filter((b) => b.id.startsWith("workflow-"));
      expect(workflowIds).toHaveLength(0);
    });

    it("ems__Task with Draft status returns Move to Backlog button visible", async () => {
      const context = createContext({
        instanceClass: "ems__Task",
        currentStatus: `[[${EffortStatus.DRAFT}]]`,
      });

      const buttons = await builder.build(context);

      const moveToBacklog = buttons.find((b) => b.id === "move-to-backlog");
      expect(moveToBacklog).toBeDefined();
      expect(moveToBacklog?.visible).toBe(true);
    });

    it("ems__Task with Doing status returns Mark Done button visible", async () => {
      const context = createContext({
        instanceClass: "ems__Task",
        currentStatus: `[[${EffortStatus.DOING}]]`,
      });

      const buttons = await builder.build(context);

      const markDone = buttons.find((b) => b.id === "mark-done");
      expect(markDone).toBeDefined();
      expect(markDone?.visible).toBe(true);
    });

    it("ems__Task with no status returns Set Draft button visible", async () => {
      const context = createContext({
        instanceClass: "ems__Task",
        currentStatus: null,
      });

      const buttons = await builder.build(context);

      const setDraft = buttons.find((b) => b.id === "set-draft-status");
      expect(setDraft).toBeDefined();
      expect(setDraft?.visible).toBe(true);
    });
  });

  describe("custom class triggers workflow fallback", () => {
    it("ems__SimpleTask with Backlog status generates workflow buttons", async () => {
      const context = createContext({
        instanceClass: "ems__SimpleTask",
        currentStatus: null,
        metadata: {
          exo__Instance_class: "ems__SimpleTask",
          ems__Effort_status: `[[${EffortStatus.BACKLOG}]]`,
        },
      });

      const buttons = await builder.build(context);

      const workflowButtons = buttons.filter((b) => b.id.startsWith("workflow-"));
      expect(workflowButtons.length).toBeGreaterThan(0);
    });

    it("workflow buttons include both forward and rollback transitions", async () => {
      const context = createContext({
        instanceClass: "ems__SimpleTask",
        currentStatus: null,
        metadata: {
          exo__Instance_class: "ems__SimpleTask",
          ems__Effort_status: `[[${EffortStatus.BACKLOG}]]`,
        },
      });

      const buttons = await builder.build(context);

      const forwardButtons = buttons.filter(
        (b) => b.id.startsWith("workflow-") && b.variant === "secondary",
      );
      const rollbackButtons = buttons.filter(
        (b) => b.id.startsWith("workflow-") && b.variant === "warning",
      );

      expect(forwardButtons.length).toBeGreaterThan(0);
      expect(rollbackButtons.length).toBeGreaterThan(0);
    });

    it("workflow button labels come from VisibilityGenerator", async () => {
      const context = createContext({
        instanceClass: "ems__SimpleTask",
        currentStatus: null,
        metadata: {
          exo__Instance_class: "ems__SimpleTask",
          ems__Effort_status: `[[${EffortStatus.BACKLOG}]]`,
        },
      });

      const buttons = await builder.build(context);
      const workflowButtons = buttons.filter((b) => b.id.startsWith("workflow-"));

      for (const btn of workflowButtons) {
        expect(btn.label).toBeTruthy();
        expect(typeof btn.label).toBe("string");
        expect(btn.label.length).toBeGreaterThan(0);
      }
    });

    it("workflow button count matches task fallback transitions from Backlog", async () => {
      const context = createContext({
        instanceClass: "ems__SimpleTask",
        currentStatus: null,
        metadata: {
          exo__Instance_class: "ems__SimpleTask",
          ems__Effort_status: `[[${EffortStatus.BACKLOG}]]`,
        },
      });

      const buttons = await builder.build(context);
      const workflowButtons = buttons.filter((b) => b.id.startsWith("workflow-"));

      expect(workflowButtons).toHaveLength(2);
    });
  });

  describe("edge cases", () => {
    it("asset without ems__Effort_status returns no workflow buttons", async () => {
      const context = createContext({
        instanceClass: "ems__SimpleTask",
        currentStatus: null,
        metadata: {
          exo__Instance_class: "ems__SimpleTask",
        },
      });

      const buttons = await builder.build(context);
      const workflowButtons = buttons.filter((b) => b.id.startsWith("workflow-"));
      expect(workflowButtons).toHaveLength(0);
    });

    it("asset with unknown status string returns no workflow buttons", async () => {
      const context = createContext({
        instanceClass: "ems__SimpleTask",
        currentStatus: null,
        metadata: {
          exo__Instance_class: "ems__SimpleTask",
          ems__Effort_status: "[[ems__EffortStatusUnknownXYZ]]",
        },
      });

      const buttons = await builder.build(context);
      const workflowButtons = buttons.filter((b) => b.id.startsWith("workflow-"));
      expect(workflowButtons).toHaveLength(0);
    });

    it("custom class with Done status returns no forward buttons (terminal)", async () => {
      const context = createContext({
        instanceClass: "ems__SimpleTask",
        currentStatus: null,
        metadata: {
          exo__Instance_class: "ems__SimpleTask",
          ems__Effort_status: `[[${EffortStatus.DONE}]]`,
        },
      });

      const buttons = await builder.build(context);
      const forwardButtons = buttons.filter(
        (b) => b.id.startsWith("workflow-") && b.variant === "secondary",
      );
      expect(forwardButtons).toHaveLength(0);
    });

    it("custom class with Done status still has rollback button", async () => {
      const context = createContext({
        instanceClass: "ems__SimpleTask",
        currentStatus: null,
        metadata: {
          exo__Instance_class: "ems__SimpleTask",
          ems__Effort_status: `[[${EffortStatus.DONE}]]`,
        },
      });

      const buttons = await builder.build(context);
      const rollbackButtons = buttons.filter(
        (b) => b.id.startsWith("workflow-") && b.variant === "warning",
      );
      expect(rollbackButtons.length).toBeGreaterThan(0);
    });
  });

  describe("button properties", () => {
    it("forward buttons have variant secondary", async () => {
      const context = createContext({
        instanceClass: "ems__SimpleTask",
        currentStatus: null,
        metadata: {
          exo__Instance_class: "ems__SimpleTask",
          ems__Effort_status: `[[${EffortStatus.BACKLOG}]]`,
        },
      });

      const buttons = await builder.build(context);
      const forwardButtons = buttons.filter(
        (b) => b.id.startsWith("workflow-") && !b.id.includes("rollback"),
      );

      for (const btn of forwardButtons) {
        if (btn.variant !== "warning") {
          expect(btn.variant).toBe("secondary");
        }
      }
    });

    it("rollback buttons have variant warning", async () => {
      const context = createContext({
        instanceClass: "ems__SimpleTask",
        currentStatus: null,
        metadata: {
          exo__Instance_class: "ems__SimpleTask",
          ems__Effort_status: `[[${EffortStatus.BACKLOG}]]`,
        },
      });

      const buttons = await builder.build(context);
      const rollbackButtons = buttons.filter(
        (b) => b.id.startsWith("workflow-") && b.variant === "warning",
      );

      for (const btn of rollbackButtons) {
        expect(btn.variant).toBe("warning");
      }
    });

    it("all workflow buttons have visible=true", async () => {
      const context = createContext({
        instanceClass: "ems__SimpleTask",
        currentStatus: null,
        metadata: {
          exo__Instance_class: "ems__SimpleTask",
          ems__Effort_status: `[[${EffortStatus.BACKLOG}]]`,
        },
      });

      const buttons = await builder.build(context);
      const workflowButtons = buttons.filter((b) => b.id.startsWith("workflow-"));

      for (const btn of workflowButtons) {
        expect(btn.visible).toBe(true);
      }
    });

    it("all workflow buttons have onClick function", async () => {
      const context = createContext({
        instanceClass: "ems__SimpleTask",
        currentStatus: null,
        metadata: {
          exo__Instance_class: "ems__SimpleTask",
          ems__Effort_status: `[[${EffortStatus.BACKLOG}]]`,
        },
      });

      const buttons = await builder.build(context);
      const workflowButtons = buttons.filter((b) => b.id.startsWith("workflow-"));

      for (const btn of workflowButtons) {
        expect(typeof btn.onClick).toBe("function");
      }
    });
  });
});
