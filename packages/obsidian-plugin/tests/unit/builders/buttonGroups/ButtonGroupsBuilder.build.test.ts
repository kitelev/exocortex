import {
  setupButtonGroupsBuilderTest,
  ButtonGroupsBuilderTestContext,
  TFile,
} from "./ButtonGroupsBuilder.fixtures";

describe("ButtonGroupsBuilder - build (dynamic commands only)", () => {
  let ctx: ButtonGroupsBuilderTestContext;

  beforeEach(() => {
    ctx = setupButtonGroupsBuilderTest();
  });

  it("should return empty groups when no commands resolved", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "folder" },
      basename: "test",
    } as TFile;
    const metadata = {
      exo__Instance_class: "[[ems__Task]]",
      exo__Asset_uid: "urn:uuid:12345",
    };

    ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue("[[ems__Task]]");
    ctx.mockMetadataExtractor.extractStatus.mockReturnValue(null);
    ctx.mockMetadataExtractor.extractIsArchived.mockReturnValue(false);
    ctx.mockFolderRepairService.getExpectedFolder.mockResolvedValue(null);
    ctx.mockCommandResolver.resolveForAsset.mockResolvedValue([]);

    const groups = await ctx.builder.build(mockFile);

    expect(groups).toEqual([]);
  });

  it("should return dynamic-commands group when commands are resolved", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "Tasks" },
      basename: "TestTask",
    } as TFile;
    const metadata = {
      exo__Instance_class: "[[ems__Task]]",
      exo__Asset_uid: "urn:uuid:12345",
    };

    ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue("[[ems__Task]]");
    ctx.mockMetadataExtractor.extractStatus.mockReturnValue(null);
    ctx.mockMetadataExtractor.extractIsArchived.mockReturnValue(false);
    ctx.mockFolderRepairService.getExpectedFolder.mockResolvedValue("Tasks");
    ctx.mockCommandResolver.resolveForAsset.mockResolvedValue([
      {
        command: {
          id: "cmd-1",
          name: "Start Effort",
          category: "status",
          precondition: { type: "always_true" },
          grounding: { type: "set_frontmatter_value", property: "status", value: "doing" },
        },
        binding: { order: 0, group: "primary" },
      },
    ]);
    ctx.mockPreconditionEvaluator.evaluate.mockResolvedValue(true);

    const groups = await ctx.builder.build(mockFile);

    const dynamicGroup = groups.find((g) => g.id === "dynamic-commands-status");
    expect(dynamicGroup).toBeDefined();
    expect(dynamicGroup!.title).toBe("Status");
    expect(dynamicGroup!.buttons.length).toBe(1);
    expect(dynamicGroup!.buttons[0].label).toBe("Start Effort");
  });

  it("should filter out commands that fail precondition", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "Tasks" },
      basename: "TestTask",
    } as TFile;
    const metadata = {
      exo__Instance_class: "[[ems__Task]]",
      exo__Asset_uid: "urn:uuid:12345",
    };

    ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue("[[ems__Task]]");
    ctx.mockMetadataExtractor.extractStatus.mockReturnValue(null);
    ctx.mockMetadataExtractor.extractIsArchived.mockReturnValue(false);
    ctx.mockFolderRepairService.getExpectedFolder.mockResolvedValue("Tasks");
    ctx.mockCommandResolver.resolveForAsset.mockResolvedValue([
      {
        command: {
          id: "cmd-visible",
          name: "Visible Command",
          category: "status",
          precondition: { type: "check_status" },
          grounding: { type: "set_frontmatter_value" },
        },
        binding: { order: 0 },
      },
      {
        command: {
          id: "cmd-hidden",
          name: "Hidden Command",
          category: "status",
          precondition: { type: "check_status" },
          grounding: { type: "set_frontmatter_value" },
        },
        binding: { order: 1 },
      },
    ]);
    ctx.mockPreconditionEvaluator.evaluate
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const groups = await ctx.builder.build(mockFile);

    const dynamicGroup = groups.find((g) => g.id === "dynamic-commands-status");
    expect(dynamicGroup).toBeDefined();
    expect(dynamicGroup!.buttons.length).toBe(1);
    expect(dynamicGroup!.buttons[0].label).toBe("Visible Command");
  });

  it("should return empty groups when asset has no UID", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "Tasks" },
      basename: "TestTask",
    } as TFile;
    const metadata = {
      exo__Instance_class: "[[ems__Task]]",
    };

    ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue("[[ems__Task]]");
    ctx.mockMetadataExtractor.extractStatus.mockReturnValue(null);
    ctx.mockMetadataExtractor.extractIsArchived.mockReturnValue(false);
    ctx.mockFolderRepairService.getExpectedFolder.mockResolvedValue("Tasks");

    const groups = await ctx.builder.build(mockFile);

    expect(groups).toEqual([]);
  });

  it("should handle multiple commands with different groups", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "Tasks" },
      basename: "TestTask",
    } as TFile;
    const metadata = {
      exo__Instance_class: "[[ems__Task]]",
      exo__Asset_uid: "urn:uuid:12345",
    };

    ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue("[[ems__Task]]");
    ctx.mockMetadataExtractor.extractStatus.mockReturnValue(null);
    ctx.mockMetadataExtractor.extractIsArchived.mockReturnValue(false);
    ctx.mockFolderRepairService.getExpectedFolder.mockResolvedValue("Tasks");
    ctx.mockCommandResolver.resolveForAsset.mockResolvedValue([
      {
        command: {
          id: "cmd-status",
          name: "Move to Backlog",
          category: "status",
          precondition: { type: "always_true" },
          grounding: { type: "set_frontmatter_value" },
        },
        binding: { order: 0, group: "primary" },
      },
      {
        command: {
          id: "cmd-maintenance",
          name: "Clean Properties",
          category: "maintenance",
          precondition: { type: "always_true" },
          grounding: { type: "set_frontmatter_value" },
        },
        binding: { order: 1, group: "secondary" },
      },
      {
        command: {
          id: "cmd-danger",
          name: "Trash",
          category: "maintenance",
          precondition: { type: "always_true" },
          grounding: { type: "set_frontmatter_value" },
        },
        binding: { order: 2, group: "danger" },
      },
    ]);
    ctx.mockPreconditionEvaluator.evaluate.mockResolvedValue(true);

    const groups = await ctx.builder.build(mockFile);

    const statusGroup = groups.find((g) => g.id === "dynamic-commands-status");
    const maintenanceGroup = groups.find((g) => g.id === "dynamic-commands-maintenance");
    expect(statusGroup).toBeDefined();
    expect(statusGroup!.buttons.length).toBe(1);
    expect(statusGroup!.buttons[0].variant).toBe("primary");
    expect(maintenanceGroup).toBeDefined();
    expect(maintenanceGroup!.collapsedByDefault).toBe(true);
    expect(maintenanceGroup!.buttons.length).toBe(2);
    expect(maintenanceGroup!.buttons[0].variant).toBe("secondary");
    expect(maintenanceGroup!.buttons[1].variant).toBe("danger");
  });

  it("should handle resolver errors gracefully", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "Tasks" },
      basename: "TestTask",
    } as TFile;
    const metadata = {
      exo__Instance_class: "[[ems__Task]]",
      exo__Asset_uid: "urn:uuid:12345",
    };

    ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue("[[ems__Task]]");
    ctx.mockMetadataExtractor.extractStatus.mockReturnValue(null);
    ctx.mockMetadataExtractor.extractIsArchived.mockReturnValue(false);
    ctx.mockFolderRepairService.getExpectedFolder.mockResolvedValue("Tasks");
    ctx.mockCommandResolver.resolveForAsset.mockRejectedValue(new Error("Resolver failed"));

    const groups = await ctx.builder.build(mockFile);

    expect(groups).toEqual([]);
  });

  it("should handle array of instance classes", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "Tasks" },
      basename: "TestTask",
    } as TFile;
    const metadata = {
      exo__Instance_class: ["[[ems__Task]]", "[[ems__Meeting]]"],
      exo__Asset_uid: "urn:uuid:12345",
    };

    ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue([
      "[[ems__Task]]",
      "[[ems__Meeting]]",
    ]);
    ctx.mockMetadataExtractor.extractStatus.mockReturnValue(null);
    ctx.mockMetadataExtractor.extractIsArchived.mockReturnValue(false);
    ctx.mockFolderRepairService.getExpectedFolder.mockResolvedValue("Tasks");
    ctx.mockCommandResolver.resolveForAsset.mockResolvedValue([
      {
        command: {
          id: "cmd-1",
          name: "Test Command",
          precondition: { type: "always_true" },
          grounding: { type: "set_frontmatter_value" },
        },
        binding: { order: 0 },
      },
    ]);
    ctx.mockPreconditionEvaluator.evaluate.mockResolvedValue(true);

    const groups = await ctx.builder.build(mockFile);

    expect(groups.length).toBeGreaterThan(0);
  });
});
