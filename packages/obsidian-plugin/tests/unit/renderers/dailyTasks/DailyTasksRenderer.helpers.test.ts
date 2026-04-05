import {
  setupDailyTasksRendererTest,
  createMockElement,
  DailyTasksRendererTestContext,
  TFile,
} from "./DailyTasksRenderer.fixtures";

/**
 * Consolidated tests for DailyTasksRenderer helper methods:
 * - extractFirstValue
 * - getAssetLabel
 * - getEffortArea
 *
 * These tests verify the behavior of private helper methods
 * accessed through the React component props.
 */

describe("DailyTasksRenderer - extractFirstValue helper", () => {
  let ctx: DailyTasksRendererTestContext;

  beforeEach(() => {
    jest.clearAllMocks();
    ctx = setupDailyTasksRendererTest();
  });

  it("should extract string value without brackets", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "DailyNotes" },
      basename: "2025-10-20",
    } as TFile;
    const metadata = {
      exo__Instance_class: "[[pn__DailyNote]]",
      pn__DailyNote_day: "[[2025-10-20]]",
    };

    const taskFile = {
      path: "task.md",
      basename: "task",
    } as TFile;

    const taskMetadata = {
      exo__Instance_class: "[[ems__Task]]",
      ems__Effort_day: "[[2025-10-20]]",
      ems__Effort_startTimestamp: "2025-10-20T09:00:00",
      ems__Effort_status: "[[ems__EffortStatusBacklog]]",
      ems__Effort_area: "[[Development]]",
    };

    ctx.mockMetadataExtractor.extractMetadata
      .mockReturnValueOnce(metadata)
      .mockReturnValueOnce(taskMetadata);

    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValueOnce(
      "[[pn__DailyNote]]",
    );

    ctx.mockVaultAdapter.getAllFiles.mockReturnValue([taskFile]);

    const mockEl = createMockElement();
    await ctx.renderer.render(mockEl, mockFile);

    const renderCall = ctx.mockReactRenderer.render.mock.calls[0];
    const getEffortArea = renderCall[1].props.getEffortArea;
    const result = getEffortArea(taskMetadata);
    expect(result).toBe("Development");
  });

  it("should extract first value from array", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "DailyNotes" },
      basename: "2025-10-20",
    } as TFile;
    const metadata = {
      exo__Instance_class: "[[pn__DailyNote]]",
      pn__DailyNote_day: "[[2025-10-20]]",
    };

    const taskFile = {
      path: "task.md",
      basename: "task",
    } as TFile;

    const taskMetadata = {
      exo__Instance_class: "[[ems__Task]]",
      ems__Effort_day: "[[2025-10-20]]",
      ems__Effort_startTimestamp: "2025-10-20T09:00:00",
      ems__Effort_status: "[[ems__EffortStatusBacklog]]",
      ems__Effort_area: ["[[Development]]", "[[Backend]]"],
    };

    ctx.mockMetadataExtractor.extractMetadata
      .mockReturnValueOnce(metadata)
      .mockReturnValueOnce(taskMetadata);

    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValueOnce(
      "[[pn__DailyNote]]",
    );

    ctx.mockVaultAdapter.getAllFiles.mockReturnValue([taskFile]);

    const mockEl = createMockElement();
    await ctx.renderer.render(mockEl, mockFile);

    const renderCall = ctx.mockReactRenderer.render.mock.calls[0];
    const getEffortArea = renderCall[1].props.getEffortArea;
    const result = getEffortArea(taskMetadata);
    expect(result).toBe("Development");
  });

  it("should return null for empty value", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "DailyNotes" },
      basename: "2025-10-20",
    } as TFile;
    const metadata = {
      exo__Instance_class: "[[pn__DailyNote]]",
      pn__DailyNote_day: "[[2025-10-20]]",
    };

    const taskFile = {
      path: "task.md",
      basename: "task",
    } as TFile;

    const taskMetadata = {
      exo__Instance_class: "[[ems__Task]]",
      ems__Effort_day: "[[2025-10-20]]",
      ems__Effort_startTimestamp: "2025-10-20T09:00:00",
      ems__Effort_status: "[[ems__EffortStatusBacklog]]",
    };

    ctx.mockMetadataExtractor.extractMetadata
      .mockReturnValueOnce(metadata)
      .mockReturnValueOnce(taskMetadata);

    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValueOnce(
      "[[pn__DailyNote]]",
    );

    ctx.mockVaultAdapter.getAllFiles.mockReturnValue([taskFile]);

    const mockEl = createMockElement();
    await ctx.renderer.render(mockEl, mockFile);

    const renderCall = ctx.mockReactRenderer.render.mock.calls[0];
    const getEffortArea = renderCall[1].props.getEffortArea;
    const result = getEffortArea(taskMetadata);
    expect(result).toBeNull();
  });

  it("should return null for empty array", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "DailyNotes" },
      basename: "2025-10-20",
    } as TFile;
    const metadata = {
      exo__Instance_class: "[[pn__DailyNote]]",
      pn__DailyNote_day: "[[2025-10-20]]",
    };

    const taskFile = {
      path: "task.md",
      basename: "task",
    } as TFile;

    const taskMetadata = {
      exo__Instance_class: "[[ems__Task]]",
      ems__Effort_day: "[[2025-10-20]]",
      ems__Effort_startTimestamp: "2025-10-20T09:00:00",
      ems__Effort_status: "[[ems__EffortStatusBacklog]]",
      ems__Effort_area: [],
    };

    ctx.mockMetadataExtractor.extractMetadata
      .mockReturnValueOnce(metadata)
      .mockReturnValueOnce(taskMetadata);

    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValueOnce(
      "[[pn__DailyNote]]",
    );

    ctx.mockVaultAdapter.getAllFiles.mockReturnValue([taskFile]);

    const mockEl = createMockElement();
    await ctx.renderer.render(mockEl, mockFile);

    const renderCall = ctx.mockReactRenderer.render.mock.calls[0];
    const getEffortArea = renderCall[1].props.getEffortArea;
    const result = getEffortArea(taskMetadata);
    expect(result).toBeNull();
  });

  it("should return null for whitespace-only string", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "DailyNotes" },
      basename: "2025-10-20",
    } as TFile;
    const metadata = {
      exo__Instance_class: "[[pn__DailyNote]]",
      pn__DailyNote_day: "[[2025-10-20]]",
    };

    const taskFile = {
      path: "task.md",
      basename: "task",
    } as TFile;

    const taskMetadata = {
      exo__Instance_class: "[[ems__Task]]",
      ems__Effort_day: "[[2025-10-20]]",
      ems__Effort_startTimestamp: "2025-10-20T09:00:00",
      ems__Effort_status: "[[ems__EffortStatusBacklog]]",
      ems__Effort_area: "   ",
    };

    ctx.mockMetadataExtractor.extractMetadata
      .mockReturnValueOnce(metadata)
      .mockReturnValueOnce(taskMetadata);

    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValueOnce(
      "[[pn__DailyNote]]",
    );

    ctx.mockVaultAdapter.getAllFiles.mockReturnValue([taskFile]);

    const mockEl = createMockElement();
    await ctx.renderer.render(mockEl, mockFile);

    const renderCall = ctx.mockReactRenderer.render.mock.calls[0];
    const getEffortArea = renderCall[1].props.getEffortArea;
    const result = getEffortArea(taskMetadata);
    expect(result).toBeNull();
  });
});

describe("DailyTasksRenderer - getAssetLabel helper with prototype fallback", () => {
  let ctx: DailyTasksRendererTestContext;

  beforeEach(() => {
    jest.clearAllMocks();
    ctx = setupDailyTasksRendererTest();
  });

  it("should return label from file when available", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "DailyNotes" },
      basename: "2025-10-20",
    } as TFile;
    const metadata = {
      exo__Instance_class: "[[pn__DailyNote]]",
      pn__DailyNote_day: "[[2025-10-20]]",
    };

    const taskFile = {
      path: "task.md",
      basename: "task",
    } as TFile;

    const taskMetadata = {
      exo__Instance_class: "[[ems__Task]]",
      ems__Effort_day: "[[2025-10-20]]",
      ems__Effort_startTimestamp: "2025-10-20T09:00:00",
      ems__Effort_status: "[[ems__EffortStatusBacklog]]",
    };

    ctx.mockMetadataExtractor.extractMetadata
      .mockReturnValueOnce(metadata)
      .mockReturnValueOnce(taskMetadata);

    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValueOnce(
      "[[pn__DailyNote]]",
    );

    ctx.mockVaultAdapter.getAllFiles.mockReturnValue([taskFile]);

    const linkedFile = new TFile();
    Object.assign(linkedFile, { path: "linked.md", basename: "linked" });

    const linkedMetadata = {
      exo__Asset_label: "Linked Label",
    };

    ctx.mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(linkedFile);
    ctx.mockApp.metadataCache.getFileCache.mockReturnValue({
      frontmatter: linkedMetadata,
    });

    const mockEl = createMockElement();
    await ctx.renderer.render(mockEl, mockFile);

    const renderCall = ctx.mockReactRenderer.render.mock.calls[0];
    const getAssetLabel = renderCall[1].props.getAssetLabel;
    const result = getAssetLabel("linked");
    expect(result).toBe("Linked Label");
  });

  it("should return null when file not found", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "DailyNotes" },
      basename: "2025-10-20",
    } as TFile;
    const metadata = {
      exo__Instance_class: "[[pn__DailyNote]]",
      pn__DailyNote_day: "[[2025-10-20]]",
    };

    const taskFile = {
      path: "task.md",
      basename: "task",
    } as TFile;

    const taskMetadata = {
      exo__Instance_class: "[[ems__Task]]",
      ems__Effort_day: "[[2025-10-20]]",
      ems__Effort_startTimestamp: "2025-10-20T09:00:00",
      ems__Effort_status: "[[ems__EffortStatusBacklog]]",
    };

    ctx.mockMetadataExtractor.extractMetadata
      .mockReturnValueOnce(metadata)
      .mockReturnValueOnce(taskMetadata);

    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValueOnce(
      "[[pn__DailyNote]]",
    );

    ctx.mockVaultAdapter.getAllFiles.mockReturnValue([taskFile]);
    ctx.mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(null);

    const mockEl = createMockElement();
    await ctx.renderer.render(mockEl, mockFile);

    const renderCall = ctx.mockReactRenderer.render.mock.calls[0];
    const getAssetLabel = renderCall[1].props.getAssetLabel;
    const result = getAssetLabel("nonexistent");
    expect(result).toBeNull();
  });

  it("should try adding .md extension when file not found", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "DailyNotes" },
      basename: "2025-10-20",
    } as TFile;
    const metadata = {
      exo__Instance_class: "[[pn__DailyNote]]",
      pn__DailyNote_day: "[[2025-10-20]]",
    };

    const taskFile = {
      path: "task.md",
      basename: "task",
    } as TFile;

    const taskMetadata = {
      exo__Instance_class: "[[ems__Task]]",
      ems__Effort_day: "[[2025-10-20]]",
      ems__Effort_startTimestamp: "2025-10-20T09:00:00",
      ems__Effort_status: "[[ems__EffortStatusBacklog]]",
    };

    ctx.mockMetadataExtractor.extractMetadata
      .mockReturnValueOnce(metadata)
      .mockReturnValueOnce(taskMetadata);

    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValueOnce(
      "[[pn__DailyNote]]",
    );

    ctx.mockVaultAdapter.getAllFiles.mockReturnValue([taskFile]);

    const linkedFile = new TFile();
    Object.assign(linkedFile, { path: "linked.md", basename: "linked" });

    const linkedMetadata = {
      exo__Asset_label: "Found with .md",
    };

    ctx.mockApp.metadataCache.getFirstLinkpathDest
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(linkedFile);

    ctx.mockApp.metadataCache.getFileCache.mockReturnValue({
      frontmatter: linkedMetadata,
    });

    const mockEl = createMockElement();
    await ctx.renderer.render(mockEl, mockFile);

    const renderCall = ctx.mockReactRenderer.render.mock.calls[0];
    const getAssetLabel = renderCall[1].props.getAssetLabel;
    const result = getAssetLabel("linked");
    expect(result).toBe("Found with .md");
  });

  it("should return null when label is whitespace only", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "DailyNotes" },
      basename: "2025-10-20",
    } as TFile;
    const metadata = {
      exo__Instance_class: "[[pn__DailyNote]]",
      pn__DailyNote_day: "[[2025-10-20]]",
    };

    const taskFile = {
      path: "task.md",
      basename: "task",
    } as TFile;

    const taskMetadata = {
      exo__Instance_class: "[[ems__Task]]",
      ems__Effort_day: "[[2025-10-20]]",
      ems__Effort_startTimestamp: "2025-10-20T09:00:00",
      ems__Effort_status: "[[ems__EffortStatusBacklog]]",
    };

    ctx.mockMetadataExtractor.extractMetadata
      .mockReturnValueOnce(metadata)
      .mockReturnValueOnce(taskMetadata);

    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValueOnce(
      "[[pn__DailyNote]]",
    );

    ctx.mockVaultAdapter.getAllFiles.mockReturnValue([taskFile]);

    const linkedFile = {
      path: "linked.md",
      basename: "linked",
    } as TFile;

    const linkedMetadata = {
      exo__Asset_label: "   ",
    };

    ctx.mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(linkedFile);
    ctx.mockApp.metadataCache.getFileCache.mockReturnValue({
      frontmatter: linkedMetadata,
    });

    const mockEl = createMockElement();
    await ctx.renderer.render(mockEl, mockFile);

    const renderCall = ctx.mockReactRenderer.render.mock.calls[0];
    const getAssetLabel = renderCall[1].props.getAssetLabel;
    const result = getAssetLabel("linked");
    expect(result).toBeNull();
  });
});

describe("DailyTasksRenderer - getEffortArea helper with prototype resolution", () => {
  let ctx: DailyTasksRendererTestContext;

  beforeEach(() => {
    jest.clearAllMocks();
    ctx = setupDailyTasksRendererTest();
  });

  it("should resolve area from parent when not set directly", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "DailyNotes" },
      basename: "2025-10-20",
    } as TFile;
    const metadata = {
      exo__Instance_class: "[[pn__DailyNote]]",
      pn__DailyNote_day: "[[2025-10-20]]",
    };

    const taskFile = {
      path: "task.md",
      basename: "task",
    } as TFile;

    const parentFile = new TFile();
    Object.assign(parentFile, { path: "parent.md", basename: "parent" });

    const taskMetadata = {
      exo__Instance_class: "[[ems__Task]]",
      ems__Effort_day: "[[2025-10-20]]",
      ems__Effort_startTimestamp: "2025-10-20T09:00:00",
      ems__Effort_status: "[[ems__EffortStatusBacklog]]",
      ems__Effort_parent: "[[parent]]",
    };

    const parentMetadata = {
      ems__Effort_area: "[[QA]]",
    };

    ctx.mockMetadataExtractor.extractMetadata
      .mockReturnValueOnce(metadata)
      .mockReturnValueOnce(taskMetadata);

    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValueOnce(
      "[[pn__DailyNote]]",
    );

    ctx.mockVaultAdapter.getAllFiles.mockReturnValue([taskFile]);
    ctx.mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(parentFile);
    ctx.mockApp.metadataCache.getFileCache.mockReturnValue({
      frontmatter: parentMetadata,
    });

    const mockEl = createMockElement();
    await ctx.renderer.render(mockEl, mockFile);

    const renderCall = ctx.mockReactRenderer.render.mock.calls[0];
    const props = renderCall[1].props;
    const tasks = props.tasks;

    expect(tasks).toHaveLength(1);
    expect(props.showEffortArea).toBe(true);

    const resolvedArea = props.getEffortArea(tasks[0].metadata);

    expect(resolvedArea).toBe("QA");
    expect(ctx.mockMetadataService.getEffortArea).toHaveBeenCalledWith(
      tasks[0].metadata,
    );
  });

  it("should prevent infinite loops with circular references", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "DailyNotes" },
      basename: "2025-10-20",
    } as TFile;
    const metadata = {
      exo__Instance_class: "[[pn__DailyNote]]",
      pn__DailyNote_day: "[[2025-10-20]]",
    };

    const taskFile = {
      path: "task.md",
      basename: "task",
    } as TFile;

    const taskMetadata = {
      exo__Instance_class: "[[ems__Task]]",
      ems__Effort_day: "[[2025-10-20]]",
      ems__Effort_startTimestamp: "2025-10-20T09:00:00",
      ems__Effort_status: "[[ems__EffortStatusBacklog]]",
      ems__Effort_parent: "[[task]]",
    };

    ctx.mockMetadataExtractor.extractMetadata
      .mockReturnValueOnce(metadata)
      .mockReturnValueOnce(taskMetadata);

    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValueOnce(
      "[[pn__DailyNote]]",
    );

    ctx.mockVaultAdapter.getAllFiles.mockReturnValue([taskFile]);
    ctx.mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(taskFile);
    ctx.mockApp.metadataCache.getFileCache.mockReturnValue({
      frontmatter: taskMetadata,
    });

    const mockEl = createMockElement();
    await ctx.renderer.render(mockEl, mockFile);

    const renderCall = ctx.mockReactRenderer.render.mock.calls[0];
    const getEffortArea = renderCall[1].props.getEffortArea;
    const result = getEffortArea(taskMetadata);
    expect(result).toBeNull();
  });

  it("should return null for invalid metadata", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "DailyNotes" },
      basename: "2025-10-20",
    } as TFile;
    const metadata = {
      exo__Instance_class: "[[pn__DailyNote]]",
      pn__DailyNote_day: "[[2025-10-20]]",
    };

    const taskFile = {
      path: "task.md",
      basename: "task",
    } as TFile;

    const taskMetadata = {
      exo__Instance_class: "[[ems__Task]]",
      ems__Effort_day: "[[2025-10-20]]",
      ems__Effort_startTimestamp: "2025-10-20T09:00:00",
      ems__Effort_status: "[[ems__EffortStatusBacklog]]",
    };

    ctx.mockMetadataExtractor.extractMetadata
      .mockReturnValueOnce(metadata)
      .mockReturnValueOnce(taskMetadata);

    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValueOnce(
      "[[pn__DailyNote]]",
    );

    ctx.mockVaultAdapter.getAllFiles.mockReturnValue([taskFile]);

    const mockEl = createMockElement();
    await ctx.renderer.render(mockEl, mockFile);

    const renderCall = ctx.mockReactRenderer.render.mock.calls[0];
    const getEffortArea = renderCall[1].props.getEffortArea;
    const result = getEffortArea(null);
    expect(result).toBeNull();
  });
});
