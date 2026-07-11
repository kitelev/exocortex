import {
  setupDailyTasksRendererTest,
  createMockElement,
  DailyTasksRendererTestContext,
  TFile,
} from "./DailyTasksRenderer.fixtures";

describe("DailyTasksRenderer - task properties", () => {
  let ctx: DailyTasksRendererTestContext;

  beforeEach(() => {
    jest.clearAllMocks();
    ctx = setupDailyTasksRendererTest();
  });

  it("should retain the meeting class and normalize its status", async () => {
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
      path: "meeting.md",
      basename: "meeting",
    } as TFile;

    const taskMetadata = {
      exo__Instance_class: ["[[ems__Task]]", "[[ems__Meeting]]"],
      ems__Effort_day: "[[2025-10-20]]",
      ems__Effort_startTimestamp: "2025-10-20T09:00:00",
      ems__Effort_status: "[[ems__EffortStatusToDo]]",
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

    expect(ctx.mockReactRenderer.render).toHaveBeenCalled();
    const renderCall = ctx.mockReactRenderer.render.mock.calls[0];
    const tasks = renderCall[1].props.tasks;
    expect(String(tasks[0].metadata.exo__Instance_class)).toContain(
      "ems__Meeting",
    );
    expect(tasks[0].status).toBe("To Do");
  });

  it("should normalize done status (dual-IRI)", async () => {
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
      ems__Effort_status: "[[ems__EffortStatusDone]]",
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

    expect(ctx.mockReactRenderer.render).toHaveBeenCalled();
    const renderCall = ctx.mockReactRenderer.render.mock.calls[0];
    const tasks = renderCall[1].props.tasks;
    expect(tasks[0].status).toBe("Done");
    expect(tasks[0].isDoing).toBe(false);
  });

  it("should normalize trashed status (dual-IRI)", async () => {
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
      ems__Effort_status: "[[ems__EffortStatusTrashed]]",
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

    expect(ctx.mockReactRenderer.render).toHaveBeenCalled();
    const renderCall = ctx.mockReactRenderer.render.mock.calls[0];
    const tasks = renderCall[1].props.tasks;
    expect(tasks[0].status).toBe("Trashed");
    expect(tasks[0].isDoing).toBe(false);
  });

  it("should correctly identify doing tasks", async () => {
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
      ems__Effort_status: "[[ems__EffortStatusDoing]]",
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

    expect(ctx.mockReactRenderer.render).toHaveBeenCalled();
    const renderCall = ctx.mockReactRenderer.render.mock.calls[0];
    const tasks = renderCall[1].props.tasks;
    expect(tasks[0].isDoing).toBe(true);
    expect(tasks[0].status).toBe("Doing");
  });

  // Regression axis #2 (req a577316f): the retained isDoing sort flag must be
  // dual-IRI-robust. A UID-canon status "[[<doing-uid>]]" (NOT the label form) must
  // still be detected as Doing — the naive `=== EffortStatus.DOING` bug returned false here.
  it("should detect Doing from a UID-canon status (dual-IRI sort flag)", async () => {
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
      // UID-canon Doing status — the exact form the naive strict-equality never matched.
      ems__Effort_status: "[[027e78f4-6e16-4b36-b8fb-5510507d5745]]",
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

    expect(ctx.mockReactRenderer.render).toHaveBeenCalled();
    const renderCall = ctx.mockReactRenderer.render.mock.calls[0];
    const tasks = renderCall[1].props.tasks;
    expect(tasks[0].isDoing).toBe(true);
    expect(tasks[0].status).toBe("Doing");
  });

  it("should use exo__Asset_label when available", async () => {
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
      basename: "task-filename",
    } as TFile;

    const taskMetadata = {
      exo__Instance_class: "[[ems__Task]]",
      ems__Effort_day: "[[2025-10-20]]",
      ems__Effort_startTimestamp: "2025-10-20T09:00:00",
      ems__Effort_status: "[[ems__EffortStatusBacklog]]",
      exo__Asset_label: "Custom Task Label",
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

    expect(ctx.mockReactRenderer.render).toHaveBeenCalled();
    const renderCall = ctx.mockReactRenderer.render.mock.calls[0];
    const tasks = renderCall[1].props.tasks;
    expect(tasks[0].label).toBe("Custom Task Label");
  });

  it("should fallback to basename when no label", async () => {
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
      basename: "task-filename",
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

    expect(ctx.mockReactRenderer.render).toHaveBeenCalled();
    const renderCall = ctx.mockReactRenderer.render.mock.calls[0];
    const tasks = renderCall[1].props.tasks;
    expect(tasks[0].label).toBe("task-filename");
  });
});
