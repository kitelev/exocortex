import {
  setupButtonGroupsBuilderTest,
  ButtonGroupsBuilderTestContext,
  TFile,
} from "./ButtonGroupsBuilder.fixtures";

describe("ButtonGroupsBuilder - onClick handlers (dynamic commands)", () => {
  let ctx: ButtonGroupsBuilderTestContext;

  beforeEach(() => {
    ctx = setupButtonGroupsBuilderTest();
  });

  it("should execute grounding when dynamic command button clicked", async () => {
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
          precondition: { type: "always_true" },
          grounding: { type: "set_frontmatter_value", property: "status", value: "doing" },
        },
        binding: { order: 0, group: "primary" },
      },
    ]);
    ctx.mockPreconditionEvaluator.evaluate.mockResolvedValue(true);
    ctx.mockGroundingExecutor.execute.mockResolvedValue({ success: true });

    const groups = await ctx.builder.build(mockFile);
    const dynamicGroup = groups.find((g) => g.id === "dynamic-commands");
    const button = dynamicGroup?.buttons[0];

    expect(button).toBeDefined();
    if (button?.onClick) {
      await button.onClick();
    }

    expect(ctx.mockGroundingExecutor.execute).toHaveBeenCalledWith(
      { type: "set_frontmatter_value", property: "status", value: "doing" },
      "obsidian://vault/test.md",
      "test.md",
      undefined,
    );
    expect(ctx.mockRefresh).toHaveBeenCalled();
  });

  it("should call refresh after successful command execution", async () => {
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
          name: "Mark Done",
          precondition: { type: "always_true" },
          grounding: { type: "set_frontmatter_value", property: "status", value: "done" },
        },
        binding: { order: 0, group: "success" },
      },
    ]);
    ctx.mockPreconditionEvaluator.evaluate.mockResolvedValue(true);
    ctx.mockGroundingExecutor.execute.mockResolvedValue({ success: true });

    const groups = await ctx.builder.build(mockFile);
    const dynamicGroup = groups.find((g) => g.id === "dynamic-commands");
    const button = dynamicGroup?.buttons[0];

    expect(button).toBeDefined();
    if (button?.onClick) {
      await button.onClick();
    }

    expect(ctx.mockRefresh).toHaveBeenCalled();
    expect(ctx.mockLogger.info).toHaveBeenCalled();
  });

  it("should log info when command execution fails", async () => {
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
          name: "Failing Command",
          precondition: { type: "always_true" },
          grounding: { type: "set_frontmatter_value" },
        },
        binding: { order: 0 },
      },
    ]);
    ctx.mockPreconditionEvaluator.evaluate.mockResolvedValue(true);
    ctx.mockGroundingExecutor.execute.mockResolvedValue({
      success: false,
      error: "Permission denied",
    });

    const groups = await ctx.builder.build(mockFile);
    const dynamicGroup = groups.find((g) => g.id === "dynamic-commands");
    const button = dynamicGroup?.buttons[0];

    expect(button).toBeDefined();
    if (button?.onClick) {
      await button.onClick();
    }

    expect(ctx.mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining("Failed"),
    );
  });
});
