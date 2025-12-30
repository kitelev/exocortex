import {
  setupButtonGroupsBuilderTest,
  ButtonGroupsBuilderTestContext,
  TFile,
} from "./ButtonGroupsBuilder.fixtures";

describe("ButtonGroupsBuilder - build", () => {
  let ctx: ButtonGroupsBuilderTestContext;

  beforeEach(() => {
    ctx = setupButtonGroupsBuilderTest();
  });

  it("should return only maintenance buttons for non-creation asset classes", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "folder" },
      basename: "test",
    } as TFile;
    const metadata = { exo__Instance_class: "[[unsupported]]" };

    ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue(
      "[[unsupported]]",
    );
    ctx.mockMetadataExtractor.extractStatus.mockReturnValue(null);
    ctx.mockMetadataExtractor.extractIsArchived.mockReturnValue(false);
    ctx.mockFolderRepairService.getExpectedFolder.mockResolvedValue(null);

    const groups = await ctx.builder.build(mockFile);

    const creationGroup = groups.find((g) => g.id === "creation");
    expect(creationGroup).toBeUndefined();
  });

  it("should build creation buttons group for Area", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "Areas" },
      basename: "TestArea",
    } as TFile;
    const metadata = { exo__Instance_class: "[[ems__Area]]" };

    ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue(
      "[[ems__Area]]",
    );
    ctx.mockMetadataExtractor.extractStatus.mockReturnValue(null);
    ctx.mockMetadataExtractor.extractIsArchived.mockReturnValue(false);
    ctx.mockFolderRepairService.getExpectedFolder.mockResolvedValue(
      "Areas/TestArea",
    );

    const groups = await ctx.builder.build(mockFile);

    const creationGroup = groups.find((g) => g.id === "creation");
    expect(creationGroup).toBeDefined();
    expect(creationGroup?.buttons.some((b) => b.id === "create-task")).toBe(
      true,
    );
    expect(
      creationGroup?.buttons.some((b) => b.id === "create-project"),
    ).toBe(true);
    expect(creationGroup?.buttons.some((b) => b.id === "create-area")).toBe(
      true,
    );
  });

  it("should build status buttons group for Task with Draft status", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "Tasks" },
      basename: "TestTask",
    } as TFile;
    const metadata = {
      exo__Instance_class: "[[ems__Task]]",
      ems__Effort_status: "[[ems__EffortStatusDraft]]",
    };

    ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue(
      "[[ems__Task]]",
    );
    ctx.mockMetadataExtractor.extractStatus.mockReturnValue(
      "[[ems__EffortStatusDraft]]",
    );
    ctx.mockMetadataExtractor.extractIsArchived.mockReturnValue(false);
    ctx.mockFolderRepairService.getExpectedFolder.mockResolvedValue("Tasks");

    const groups = await ctx.builder.build(mockFile);

    const statusGroup = groups.find((g) => g.id === "status");
    expect(statusGroup).toBeDefined();
    expect(
      statusGroup?.buttons.some(
        (b) => b.id === "move-to-backlog" && b.visible,
      ),
    ).toBe(true);
  });

  it("should build planning buttons group for Task with Backlog status", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "Tasks" },
      basename: "TestTask",
    } as TFile;
    const metadata = {
      exo__Instance_class: "[[ems__Task]]",
      ems__Effort_status: "[[ems__EffortStatusBacklog]]",
    };

    ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue(
      "[[ems__Task]]",
    );
    ctx.mockMetadataExtractor.extractStatus.mockReturnValue(
      "[[ems__EffortStatusBacklog]]",
    );
    ctx.mockMetadataExtractor.extractIsArchived.mockReturnValue(false);
    ctx.mockFolderRepairService.getExpectedFolder.mockResolvedValue("Tasks");

    const groups = await ctx.builder.build(mockFile);

    const planningGroup = groups.find((g) => g.id === "planning");
    expect(planningGroup).toBeDefined();
    expect(
      planningGroup?.buttons.some(
        (b) => b.id === "plan-on-today" && b.visible,
      ),
    ).toBe(true);
    expect(
      planningGroup?.buttons.some(
        (b) => b.id === "vote-on-effort" && b.visible,
      ),
    ).toBe(true);
  });

  it("should build maintenance buttons group", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "Tasks" },
      basename: "TestTask",
    } as TFile;
    const metadata = {
      exo__Instance_class: "[[ems__Task]]",
      ems__Effort_status: "[[ems__EffortStatusBacklog]]",
    };

    ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue(
      "[[ems__Task]]",
    );
    ctx.mockMetadataExtractor.extractStatus.mockReturnValue(
      "[[ems__EffortStatusBacklog]]",
    );
    ctx.mockMetadataExtractor.extractIsArchived.mockReturnValue(false);
    ctx.mockFolderRepairService.getExpectedFolder.mockResolvedValue("Tasks");

    const groups = await ctx.builder.build(mockFile);

    const maintenanceGroup = groups.find((g) => g.id === "maintenance");
    expect(maintenanceGroup).toBeDefined();
    expect(maintenanceGroup?.buttons.some((b) => b.id === "trash")).toBe(
      true,
    );
    expect(
      maintenanceGroup?.buttons.some((b) => b.id === "clean-properties"),
    ).toBe(true);
  });

  it("should show repair folder button when folder mismatch", async () => {
    const mockFile = {
      path: "wrong/test.md",
      parent: { path: "wrong" },
      basename: "TestTask",
    } as TFile;
    const metadata = {
      exo__Instance_class: "[[ems__Task]]",
      ems__Effort_status: "[[ems__EffortStatusBacklog]]",
    };

    ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue(
      "[[ems__Task]]",
    );
    ctx.mockMetadataExtractor.extractStatus.mockReturnValue(
      "[[ems__EffortStatusBacklog]]",
    );
    ctx.mockMetadataExtractor.extractIsArchived.mockReturnValue(false);
    ctx.mockFolderRepairService.getExpectedFolder.mockResolvedValue("Tasks");

    const groups = await ctx.builder.build(mockFile);

    const maintenanceGroup = groups.find((g) => g.id === "maintenance");
    const repairButton = maintenanceGroup?.buttons.find(
      (b) => b.id === "repair-folder",
    );
    expect(repairButton?.visible).toBe(true);
  });

  it("should show rename to UID button when filename != UID", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "Tasks" },
      basename: "wrong-name",
    } as TFile;
    const metadata = {
      exo__Instance_class: "[[ems__Task]]",
      exo__Asset_uid: "correct-uid",
      ems__Effort_status: "[[ems__EffortStatusBacklog]]",
    };

    ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue(
      "[[ems__Task]]",
    );
    ctx.mockMetadataExtractor.extractStatus.mockReturnValue(
      "[[ems__EffortStatusBacklog]]",
    );
    ctx.mockMetadataExtractor.extractIsArchived.mockReturnValue(false);
    ctx.mockFolderRepairService.getExpectedFolder.mockResolvedValue("Tasks");

    const groups = await ctx.builder.build(mockFile);

    const maintenanceGroup = groups.find((g) => g.id === "maintenance");
    const renameButton = maintenanceGroup?.buttons.find(
      (b) => b.id === "rename-to-uid",
    );
    expect(renameButton?.visible).toBe(true);
  });

  it("should show vote count in button label when votes exist", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "Tasks" },
      basename: "TestTask",
    } as TFile;
    const metadata = {
      exo__Instance_class: "[[ems__Task]]",
      ems__Effort_status: "[[ems__EffortStatusBacklog]]",
      ems__Effort_votes: 5,
    };

    ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue(
      "[[ems__Task]]",
    );
    ctx.mockMetadataExtractor.extractStatus.mockReturnValue(
      "[[ems__EffortStatusBacklog]]",
    );
    ctx.mockMetadataExtractor.extractIsArchived.mockReturnValue(false);
    ctx.mockFolderRepairService.getExpectedFolder.mockResolvedValue("Tasks");

    const groups = await ctx.builder.build(mockFile);

    const planningGroup = groups.find((g) => g.id === "planning");
    const voteButton = planningGroup?.buttons.find(
      (b) => b.id === "vote-on-effort",
    );
    expect(voteButton?.label).toBe("Vote (5)");
  });

  it("should show 'Vote' label when no votes exist", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "Tasks" },
      basename: "TestTask",
    } as TFile;
    const metadata = {
      exo__Instance_class: "[[ems__Task]]",
      ems__Effort_status: "[[ems__EffortStatusBacklog]]",
    };

    ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue(
      "[[ems__Task]]",
    );
    ctx.mockMetadataExtractor.extractStatus.mockReturnValue(
      "[[ems__EffortStatusBacklog]]",
    );
    ctx.mockMetadataExtractor.extractIsArchived.mockReturnValue(false);
    ctx.mockFolderRepairService.getExpectedFolder.mockResolvedValue("Tasks");

    const groups = await ctx.builder.build(mockFile);

    const planningGroup = groups.find((g) => g.id === "planning");
    const voteButton = planningGroup?.buttons.find(
      (b) => b.id === "vote-on-effort",
    );
    expect(voteButton?.label).toBe("Vote");
  });

  it("should show 'Set Active Focus' when no active focus set", async () => {
    ctx.mockSettings.activeFocusArea = null;
    const mockFile = {
      path: "test.md",
      parent: { path: "Areas" },
      basename: "TestArea",
    } as TFile;
    const metadata = { exo__Instance_class: "[[ems__Area]]" };

    ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue(
      "[[ems__Area]]",
    );
    ctx.mockMetadataExtractor.extractStatus.mockReturnValue(null);
    ctx.mockMetadataExtractor.extractIsArchived.mockReturnValue(false);
    ctx.mockFolderRepairService.getExpectedFolder.mockResolvedValue(
      "Areas/TestArea",
    );

    const groups = await ctx.builder.build(mockFile);

    const planningGroup = groups.find((g) => g.id === "planning");
    const focusButton = planningGroup?.buttons.find(
      (b) => b.id === "set-active-focus",
    );
    expect(focusButton?.label).toBe("Set Active Focus");
  });

  it("should show 'Clear Active Focus' when this area is active focus", async () => {
    ctx.mockSettings.activeFocusArea = "TestArea";
    const mockFile = {
      path: "test.md",
      parent: { path: "Areas" },
      basename: "TestArea",
    } as TFile;
    const metadata = { exo__Instance_class: "[[ems__Area]]" };

    ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue(
      "[[ems__Area]]",
    );
    ctx.mockMetadataExtractor.extractStatus.mockReturnValue(null);
    ctx.mockMetadataExtractor.extractIsArchived.mockReturnValue(false);
    ctx.mockFolderRepairService.getExpectedFolder.mockResolvedValue(
      "Areas/TestArea",
    );

    const groups = await ctx.builder.build(mockFile);

    const planningGroup = groups.find((g) => g.id === "planning");
    const focusButton = planningGroup?.buttons.find(
      (b) => b.id === "set-active-focus",
    );
    expect(focusButton?.label).toBe("Clear Active Focus");
  });

  it("should handle array of instance classes", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "Tasks" },
      basename: "TestTask",
    } as TFile;
    const metadata = {
      exo__Instance_class: ["[[ems__Task]]", "[[ems__Meeting]]"],
      ems__Effort_status: "[[ems__EffortStatusBacklog]]",
    };

    ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue([
      "[[ems__Task]]",
      "[[ems__Meeting]]",
    ]);
    ctx.mockMetadataExtractor.extractStatus.mockReturnValue(
      "[[ems__EffortStatusBacklog]]",
    );
    ctx.mockMetadataExtractor.extractIsArchived.mockReturnValue(false);
    ctx.mockFolderRepairService.getExpectedFolder.mockResolvedValue("Tasks");

    const groups = await ctx.builder.build(mockFile);

    expect(groups.length).toBeGreaterThan(0);
  });

  it("should handle null expected folder", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "Tasks" },
      basename: "TestTask",
    } as TFile;
    const metadata = {
      exo__Instance_class: "[[ems__Task]]",
      ems__Effort_status: "[[ems__EffortStatusBacklog]]",
    };

    ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue(
      "[[ems__Task]]",
    );
    ctx.mockMetadataExtractor.extractStatus.mockReturnValue(
      "[[ems__EffortStatusBacklog]]",
    );
    ctx.mockMetadataExtractor.extractIsArchived.mockReturnValue(false);
    ctx.mockFolderRepairService.getExpectedFolder.mockResolvedValue(null);

    const groups = await ctx.builder.build(mockFile);

    const maintenanceGroup = groups.find((g) => g.id === "maintenance");
    const repairButton = maintenanceGroup?.buttons.find(
      (b) => b.id === "repair-folder",
    );
    expect(repairButton?.visible).toBe(false);
  });

  it("should not show buttons for archived assets", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "Tasks" },
      basename: "TestTask",
    } as TFile;
    const metadata = {
      exo__Instance_class: "[[ems__Task]]",
      ems__Effort_status: "[[ems__EffortStatusBacklog]]",
      exo__Asset_isArchived: true,
    };

    ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue(
      "[[ems__Task]]",
    );
    ctx.mockMetadataExtractor.extractStatus.mockReturnValue(
      "[[ems__EffortStatusBacklog]]",
    );
    ctx.mockMetadataExtractor.extractIsArchived.mockReturnValue(true);
    ctx.mockFolderRepairService.getExpectedFolder.mockResolvedValue("Tasks");

    const groups = await ctx.builder.build(mockFile);

    const planningGroup = groups.find((g) => g.id === "planning");
    const voteButton = planningGroup?.buttons.find(
      (b) => b.id === "vote-on-effort",
    );
    expect(voteButton?.visible).toBe(false);
  });

  it("should show rollback button for Done status", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "Tasks" },
      basename: "TestTask",
    } as TFile;
    const metadata = {
      exo__Instance_class: "[[ems__Task]]",
      ems__Effort_status: "[[ems__EffortStatusDone]]",
    };

    ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue(
      "[[ems__Task]]",
    );
    ctx.mockMetadataExtractor.extractStatus.mockReturnValue(
      "[[ems__EffortStatusDone]]",
    );
    ctx.mockMetadataExtractor.extractIsArchived.mockReturnValue(false);
    ctx.mockFolderRepairService.getExpectedFolder.mockResolvedValue("Tasks");

    const groups = await ctx.builder.build(mockFile);

    const statusGroup = groups.find((g) => g.id === "status");
    const rollbackButton = statusGroup?.buttons.find(
      (b) => b.id === "rollback-status",
    );
    expect(rollbackButton?.visible).toBe(true);
  });

  it("should handle Concept class", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "Concepts" },
      basename: "TestConcept",
    } as TFile;
    const metadata = { exo__Instance_class: "[[ims__Concept]]" };

    ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue(
      "[[ims__Concept]]",
    );
    ctx.mockMetadataExtractor.extractStatus.mockReturnValue(null);
    ctx.mockMetadataExtractor.extractIsArchived.mockReturnValue(false);
    ctx.mockFolderRepairService.getExpectedFolder.mockResolvedValue("Concepts");

    const groups = await ctx.builder.build(mockFile);

    const creationGroup = groups.find((g) => g.id === "creation");
    const narrowerButton = creationGroup?.buttons.find(
      (b) => b.id === "create-narrower-concept",
    );
    expect(narrowerButton?.visible).toBe(true);
  });

  it("should handle TaskPrototype", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "TaskPrototypes" },
      basename: "TestPrototype",
    } as TFile;
    const metadata = { exo__Instance_class: "[[ems__TaskPrototype]]" };

    ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue(
      "[[ems__TaskPrototype]]",
    );
    ctx.mockMetadataExtractor.extractStatus.mockReturnValue(null);
    ctx.mockMetadataExtractor.extractIsArchived.mockReturnValue(false);
    ctx.mockFolderRepairService.getExpectedFolder.mockResolvedValue(
      "TaskPrototypes",
    );

    const groups = await ctx.builder.build(mockFile);

    const creationGroup = groups.find((g) => g.id === "creation");
    const instanceButton = creationGroup?.buttons.find(
      (b) => b.id === "create-instance",
    );
    expect(instanceButton?.visible).toBe(true);
  });

  it("should handle Initiative", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "Initiatives" },
      basename: "TestInitiative",
    } as TFile;
    const metadata = { exo__Instance_class: "[[ems__Initiative]]" };

    ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue(
      "[[ems__Initiative]]",
    );
    ctx.mockMetadataExtractor.extractStatus.mockReturnValue(null);
    ctx.mockMetadataExtractor.extractIsArchived.mockReturnValue(false);
    ctx.mockFolderRepairService.getExpectedFolder.mockResolvedValue(
      "Initiatives",
    );

    const groups = await ctx.builder.build(mockFile);

    const creationGroup = groups.find((g) => g.id === "creation");
    const projectButton = creationGroup?.buttons.find(
      (b) => b.id === "create-project",
    );
    expect(projectButton?.visible).toBe(true);
  });

  it("should not show copy label to aliases when no label", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "Concepts" },
      basename: "TestConcept",
    } as TFile;
    const metadata = {
      exo__Instance_class: "[[ims__Concept]]",
    };

    ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue(
      "[[ims__Concept]]",
    );
    ctx.mockMetadataExtractor.extractStatus.mockReturnValue(null);
    ctx.mockMetadataExtractor.extractIsArchived.mockReturnValue(false);
    ctx.mockFolderRepairService.getExpectedFolder.mockResolvedValue("Concepts");

    const groups = await ctx.builder.build(mockFile);

    const maintenanceGroup = groups.find((g) => g.id === "maintenance");
    const copyButton = maintenanceGroup?.buttons.find(
      (b) => b.id === "copy-label-to-aliases",
    );
    expect(copyButton?.visible).toBe(false);
  });

  it("should show archive button for Done tasks", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "Tasks" },
      basename: "TestTask",
    } as TFile;
    const metadata = {
      exo__Instance_class: "[[ems__Task]]",
      ems__Effort_status: "[[ems__EffortStatusDone]]",
    };

    ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue(
      "[[ems__Task]]",
    );
    ctx.mockMetadataExtractor.extractStatus.mockReturnValue(
      "[[ems__EffortStatusDone]]",
    );
    ctx.mockMetadataExtractor.extractIsArchived.mockReturnValue(false);
    ctx.mockFolderRepairService.getExpectedFolder.mockResolvedValue("Tasks");

    const groups = await ctx.builder.build(mockFile);

    const maintenanceGroup = groups.find((g) => g.id === "maintenance");
    const archiveButton = maintenanceGroup?.buttons.find(
      (b) => b.id === "archive",
    );
    expect(archiveButton?.visible).toBe(true);
  });

  it("should hide archive button for already archived tasks", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "Tasks" },
      basename: "TestTask",
    } as TFile;
    const metadata = {
      exo__Instance_class: "[[ems__Task]]",
      ems__Effort_status: "[[ems__EffortStatusDone]]",
      exo__Asset_isArchived: true,
      emptyProp: "",
    };

    ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue(
      "[[ems__Task]]",
    );
    ctx.mockMetadataExtractor.extractStatus.mockReturnValue(
      "[[ems__EffortStatusDone]]",
    );
    ctx.mockMetadataExtractor.extractIsArchived.mockReturnValue(true);
    ctx.mockFolderRepairService.getExpectedFolder.mockResolvedValue("Tasks");

    const groups = await ctx.builder.build(mockFile);

    const maintenanceGroup = groups.find((g) => g.id === "maintenance");

    if (maintenanceGroup) {
      const archiveButton = maintenanceGroup.buttons.find(
        (b) => b.id === "archive",
      );
      expect(archiveButton).toBeDefined();
      expect(archiveButton?.visible).toBe(false);
    } else {
      expect(maintenanceGroup).toBeUndefined();
    }
  });

  it("should handle Project with ToDo status", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "Projects" },
      basename: "TestProject",
    } as TFile;
    const metadata = {
      exo__Instance_class: "[[ems__Project]]",
      ems__Effort_status: "[[ems__EffortStatusToDo]]",
    };

    ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue(
      "[[ems__Project]]",
    );
    ctx.mockMetadataExtractor.extractStatus.mockReturnValue(
      "[[ems__EffortStatusToDo]]",
    );
    ctx.mockMetadataExtractor.extractIsArchived.mockReturnValue(false);
    ctx.mockFolderRepairService.getExpectedFolder.mockResolvedValue("Projects");

    const groups = await ctx.builder.build(mockFile);

    const statusGroup = groups.find((g) => g.id === "status");
    const startButton = statusGroup?.buttons.find(
      (b) => b.id === "start-effort",
    );
    expect(startButton?.visible).toBe(true);
  });

  it("should handle Task with Doing status", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "Tasks" },
      basename: "TestTask",
    } as TFile;
    const metadata = {
      exo__Instance_class: "[[ems__Task]]",
      ems__Effort_status: "[[ems__EffortStatusDoing]]",
    };

    ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue(
      "[[ems__Task]]",
    );
    ctx.mockMetadataExtractor.extractStatus.mockReturnValue(
      "[[ems__EffortStatusDoing]]",
    );
    ctx.mockMetadataExtractor.extractIsArchived.mockReturnValue(false);
    ctx.mockFolderRepairService.getExpectedFolder.mockResolvedValue("Tasks");

    const groups = await ctx.builder.build(mockFile);

    const statusGroup = groups.find((g) => g.id === "status");
    const doneButton = statusGroup?.buttons.find((b) => b.id === "mark-done");
    expect(doneButton?.visible).toBe(true);
  });

  it("should show Create Task button for DailyNote with past date", async () => {
    const mockFile = {
      path: "2020-01-01.md",
      parent: { path: "Daily" },
      basename: "2020-01-01",
    } as TFile;
    const metadata = {
      exo__Instance_class: "[[pn__DailyNote]]",
      pn__DailyNote_day: "2020-01-01",
    };

    ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue(
      "[[pn__DailyNote]]",
    );
    ctx.mockMetadataExtractor.extractStatus.mockReturnValue(null);
    ctx.mockMetadataExtractor.extractIsArchived.mockReturnValue(false);
    ctx.mockFolderRepairService.getExpectedFolder.mockResolvedValue("Daily");

    const groups = await ctx.builder.build(mockFile);

    const creationGroup = groups.find((g) => g.id === "creation");
    const createTaskButton = creationGroup?.buttons.find(
      (b) => b.id === "create-task-for-dailynote",
    );
    expect(createTaskButton?.visible).toBe(true);
    expect(createTaskButton?.label).toBe("Create Task");
  });

  it("should show Create Task button for DailyNote with future date", async () => {
    const mockFile = {
      path: "2099-12-31.md",
      parent: { path: "Daily" },
      basename: "2099-12-31",
    } as TFile;
    const metadata = {
      exo__Instance_class: "[[pn__DailyNote]]",
      pn__DailyNote_day: "2099-12-31",
    };

    ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue(
      "[[pn__DailyNote]]",
    );
    ctx.mockMetadataExtractor.extractStatus.mockReturnValue(null);
    ctx.mockMetadataExtractor.extractIsArchived.mockReturnValue(false);
    ctx.mockFolderRepairService.getExpectedFolder.mockResolvedValue("Daily");

    const groups = await ctx.builder.build(mockFile);

    const creationGroup = groups.find((g) => g.id === "creation");
    const createTaskButton = creationGroup?.buttons.find(
      (b) => b.id === "create-task-for-dailynote",
    );
    expect(createTaskButton?.visible).toBe(true);
  });

  it("should handle DailyNote with wiki-link date format", async () => {
    const mockFile = {
      path: "2020-01-01.md",
      parent: { path: "Daily" },
      basename: "2020-01-01",
    } as TFile;
    const metadata = {
      exo__Instance_class: "[[pn__DailyNote]]",
      pn__DailyNote_day: "[[2020-01-01]]",
    };

    ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue(
      "[[pn__DailyNote]]",
    );
    ctx.mockMetadataExtractor.extractStatus.mockReturnValue(null);
    ctx.mockMetadataExtractor.extractIsArchived.mockReturnValue(false);
    ctx.mockFolderRepairService.getExpectedFolder.mockResolvedValue("Daily");

    const groups = await ctx.builder.build(mockFile);

    const creationGroup = groups.find((g) => g.id === "creation");
    const createTaskButton = creationGroup?.buttons.find(
      (b) => b.id === "create-task-for-dailynote",
    );
    expect(createTaskButton?.visible).toBe(true);
  });

  it("should handle DailyNote with array day property", async () => {
    const mockFile = {
      path: "2020-01-01.md",
      parent: { path: "Daily" },
      basename: "2020-01-01",
    } as TFile;
    const metadata = {
      exo__Instance_class: "[[pn__DailyNote]]",
      pn__DailyNote_day: ["2020-01-01"],
    };

    ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue(
      "[[pn__DailyNote]]",
    );
    ctx.mockMetadataExtractor.extractStatus.mockReturnValue(null);
    ctx.mockMetadataExtractor.extractIsArchived.mockReturnValue(false);
    ctx.mockFolderRepairService.getExpectedFolder.mockResolvedValue("Daily");

    const groups = await ctx.builder.build(mockFile);

    const creationGroup = groups.find((g) => g.id === "creation");
    const createTaskButton = creationGroup?.buttons.find(
      (b) => b.id === "create-task-for-dailynote",
    );
    expect(createTaskButton?.visible).toBe(true);
  });

  it("should handle DailyNote with array containing wiki-link", async () => {
    const mockFile = {
      path: "2020-01-01.md",
      parent: { path: "Daily" },
      basename: "2020-01-01",
    } as TFile;
    const metadata = {
      exo__Instance_class: "[[pn__DailyNote]]",
      pn__DailyNote_day: ["[[2020-01-01]]"],
    };

    ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue(
      "[[pn__DailyNote]]",
    );
    ctx.mockMetadataExtractor.extractStatus.mockReturnValue(null);
    ctx.mockMetadataExtractor.extractIsArchived.mockReturnValue(false);
    ctx.mockFolderRepairService.getExpectedFolder.mockResolvedValue("Daily");

    const groups = await ctx.builder.build(mockFile);

    const creationGroup = groups.find((g) => g.id === "creation");
    const createTaskButton = creationGroup?.buttons.find(
      (b) => b.id === "create-task-for-dailynote",
    );
    expect(createTaskButton?.visible).toBe(true);
  });
});
