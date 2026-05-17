import { TFile } from "obsidian";
import {
  setupDailyTasksRendererTest,
  createMockElement,
  DailyTasksRendererTestContext,
} from "./DailyTasksRenderer.fixtures";

/**
 * Consolidated core tests for DailyTasksRenderer:
 * - Main rendering logic
 * - Timestamp formatting
 *
 * These tests verify the primary render() method behavior
 * including file type detection, task rendering, and timestamp handling.
 */

describe("DailyTasksRenderer - render", () => {
  let ctx: DailyTasksRendererTestContext;

  beforeEach(() => {
    jest.clearAllMocks();
    ctx = setupDailyTasksRendererTest();
  });

  it("should not render for non-daily-note files", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "Tasks" },
      basename: "TestTask",
    } as TFile;
    const metadata = { exo__Instance_class: ["[[ems__Task]]"] };

    ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue(
      "[[ems__Task]]",
    );

    const mockEl = createMockElement();
    await ctx.renderer.render(mockEl, mockFile);

    expect(mockEl.children.length).toBe(0);
    expect(ctx.mockReactRenderer.render).not.toHaveBeenCalled();
  });

  it("should not render when pn__DailyNote_day is missing AND basename has no YYYY-MM-DD prefix", async () => {
    // Both `pn__DailyNote_day` and the basename-fallback (YYYY-MM-DD
    // prefix) are absent, so `extractDailyNoteInfo` returns day=null
    // and the renderer must bail.
    const mockFile = {
      path: "daily.md",
      parent: { path: "DailyNotes" },
      basename: "daily",
    } as TFile;
    const metadata = { exo__Instance_class: ["[[pn__DailyNote]]"] };

    ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue(
      "[[pn__DailyNote]]",
    );

    const mockEl = createMockElement();
    await ctx.renderer.render(mockEl, mockFile);

    expect(ctx.mockLogger.debug).toHaveBeenCalledWith(
      "No pn__DailyNote_day or YYYY-MM-DD basename for daily note",
    );
    expect(ctx.mockReactRenderer.render).not.toHaveBeenCalled();
  });

  it("should not render when no tasks found for the day", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "DailyNotes" },
      basename: "2025-10-20",
    } as TFile;
    const metadata = {
      exo__Instance_class: ["[[pn__DailyNote]]"],
      pn__DailyNote_day: "[[2025-10-20]]",
    };

    ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue(
      "[[pn__DailyNote]]",
    );
    ctx.mockVaultAdapter.getAllFiles.mockReturnValue([]);

    const mockEl = createMockElement();
    await ctx.renderer.render(mockEl, mockFile);

    expect(ctx.mockLogger.debug).toHaveBeenCalledWith(
      "No tasks found for day: 2025-10-20",
    );
    expect(ctx.mockReactRenderer.render).not.toHaveBeenCalled();
  });

  it("should render tasks section when tasks exist", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "DailyNotes" },
      basename: "2025-10-20",
    } as TFile;
    const metadata = {
      exo__Instance_class: ["[[pn__DailyNote]]"],
      pn__DailyNote_day: "[[2025-10-20]]",
    };

    const taskFile = {
      path: "task.md",
      basename: "test-task",
    } as TFile;

    const taskMetadata = {
      exo__Instance_class: ["[[ems__Task]]"],
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

    expect(
      mockEl.querySelector(".exocortex-daily-tasks-section"),
    ).toBeTruthy();
    expect(mockEl.querySelector("h3")).toBeTruthy();
    expect(mockEl.querySelector("h3")?.textContent).toBe("Tasks");
    expect(ctx.mockReactRenderer.render).toHaveBeenCalled();
    expect(ctx.mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining("Rendered 1 tasks"),
    );
  });

  it("should filter out projects from daily tasks", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "DailyNotes" },
      basename: "2025-10-20",
    } as TFile;
    const metadata = {
      exo__Instance_class: ["[[pn__DailyNote]]"],
      pn__DailyNote_day: "[[2025-10-20]]",
    };

    const projectFile = {
      path: "project.md",
      basename: "test-project",
    } as TFile;

    const projectMetadata = {
      exo__Instance_class: ["[[ems__Project]]"],
      ems__Effort_day: "[[2025-10-20]]",
      ems__Effort_startTimestamp: "2025-10-20T09:00:00",
      ems__Effort_status: "[[ems__EffortStatusToDo]]",
    };

    ctx.mockMetadataExtractor.extractMetadata
      .mockReturnValueOnce(metadata)
      .mockReturnValueOnce(projectMetadata);

    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValueOnce(
      "[[pn__DailyNote]]",
    );

    ctx.mockVaultAdapter.getAllFiles.mockReturnValue([projectFile]);

    const mockEl = createMockElement();
    await ctx.renderer.render(mockEl, mockFile);

    expect(ctx.mockLogger.debug).toHaveBeenCalledWith(
      "No tasks found for day: 2025-10-20",
    );
    expect(ctx.mockReactRenderer.render).not.toHaveBeenCalled();
  });

  it("should handle pn__DailyNote_day without brackets", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "DailyNotes" },
      basename: "2025-10-20",
    } as TFile;
    const metadata = {
      exo__Instance_class: ["[[pn__DailyNote]]"],
      pn__DailyNote_day: "2025-10-20",
    };

    const taskFile = {
      path: "task.md",
      basename: "test-task",
    } as TFile;

    const taskMetadata = {
      exo__Instance_class: ["[[ems__Task]]"],
      ems__Effort_day: "2025-10-20",
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
    expect(ctx.mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining("Rendered 1 tasks"),
    );
  });

  it("should handle instance class without brackets", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "DailyNotes" },
      basename: "2025-10-20",
    } as TFile;
    const metadata = {
      exo__Instance_class: ["[[pn__DailyNote]]"],
      pn__DailyNote_day: "[[2025-10-20]]",
    };

    ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue(
      "pn__DailyNote",
    );

    const mockEl = createMockElement();
    await ctx.renderer.render(mockEl, mockFile);

    expect(ctx.mockLogger.debug).toHaveBeenCalled();
  });

  it("should handle array of instance classes", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "DailyNotes" },
      basename: "2025-10-20",
    } as TFile;
    const metadata = {
      exo__Instance_class: ["[[pn__DailyNote]]", "[[other]]"],
      pn__DailyNote_day: "[[2025-10-20]]",
    };

    ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue([
      "[[pn__DailyNote]]",
      "[[other]]",
    ]);

    ctx.mockVaultAdapter.getAllFiles.mockReturnValue([]);

    const mockEl = createMockElement();
    await ctx.renderer.render(mockEl, mockFile);

    expect(ctx.mockLogger.debug).toHaveBeenCalled();
  });

  it("should handle task with blockers", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "DailyNotes" },
      basename: "2025-10-20",
    } as TFile;
    const metadata = {
      exo__Instance_class: ["[[pn__DailyNote]]"],
      pn__DailyNote_day: "[[2025-10-20]]",
    };

    const taskFile = {
      path: "task.md",
      basename: "test-task",
    } as TFile;

    const blockerFile = {
      path: "blocker.md",
      basename: "blocker-task",
    } as TFile;

    const taskMetadata = {
      exo__Instance_class: ["[[ems__Task]]"],
      ems__Effort_day: "[[2025-10-20]]",
      ems__Effort_startTimestamp: "2025-10-20T09:00:00",
      ems__Effort_status: "[[ems__EffortStatusBacklog]]",
      ems__Effort_blocker: "[[blocker-task]]",
    };

    const blockerMetadata = {
      ems__Effort_status: "[[ems__EffortStatusBacklog]]",
    };

    ctx.mockMetadataExtractor.extractMetadata
      .mockReturnValueOnce(metadata)
      .mockReturnValueOnce(taskMetadata);

    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValueOnce(
      "[[pn__DailyNote]]",
    );

    ctx.mockVaultAdapter.getAllFiles.mockReturnValue([taskFile]);
    ctx.mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(blockerFile);
    ctx.mockApp.metadataCache.getFileCache.mockReturnValue({
      frontmatter: blockerMetadata,
    });

    const mockEl = createMockElement();
    await ctx.renderer.render(mockEl, mockFile);

    expect(ctx.mockReactRenderer.render).toHaveBeenCalled();
    const renderCall = ctx.mockReactRenderer.render.mock.calls[0];
    const tasks = renderCall[1].props.tasks;
    expect(tasks[0].isBlocked).toBe(true);
  });

  it("should mark task as not blocked when blocker is done", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "DailyNotes" },
      basename: "2025-10-20",
    } as TFile;
    const metadata = {
      exo__Instance_class: ["[[pn__DailyNote]]"],
      pn__DailyNote_day: "[[2025-10-20]]",
    };

    const taskFile = {
      path: "task.md",
      basename: "test-task",
    } as TFile;

    const blockerFile = {
      path: "blocker.md",
      basename: "blocker-task",
    } as TFile;

    const taskMetadata = {
      exo__Instance_class: ["[[ems__Task]]"],
      ems__Effort_day: "[[2025-10-20]]",
      ems__Effort_startTimestamp: "2025-10-20T09:00:00",
      ems__Effort_status: "[[ems__EffortStatusBacklog]]",
      ems__Effort_blocker: "[[blocker-task]]",
    };

    const blockerMetadata = {
      ems__Effort_status: "[[ems__EffortStatusDone]]",
    };

    ctx.mockMetadataExtractor.extractMetadata
      .mockReturnValueOnce(metadata)
      .mockReturnValueOnce(taskMetadata);

    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValueOnce(
      "[[pn__DailyNote]]",
    );

    ctx.mockVaultAdapter.getAllFiles.mockReturnValue([taskFile]);
    ctx.mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(blockerFile);
    ctx.mockApp.metadataCache.getFileCache.mockReturnValue({
      frontmatter: blockerMetadata,
    });

    const mockEl = createMockElement();
    await ctx.renderer.render(mockEl, mockFile);

    expect(ctx.mockReactRenderer.render).toHaveBeenCalled();
    const renderCall = ctx.mockReactRenderer.render.mock.calls[0];
    const tasks = renderCall[1].props.tasks;
    expect(tasks[0].isBlocked).toBe(false);
  });

  it("should return all tasks without artificial limit", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "DailyNotes" },
      basename: "2025-10-20",
    } as TFile;
    const metadata = {
      exo__Instance_class: ["[[pn__DailyNote]]"],
      pn__DailyNote_day: "[[2025-10-20]]",
    };

    const taskFiles = Array.from(
      { length: 60 },
      (_, i) =>
        ({
          path: `task-${i}.md`,
          basename: `task-${i}`,
        }) as TFile,
    );

    const taskMetadata = {
      exo__Instance_class: ["[[ems__Task]]"],
      ems__Effort_day: "[[2025-10-20]]",
      ems__Effort_startTimestamp: "2025-10-20T09:00:00",
      ems__Effort_status: "[[ems__EffortStatusBacklog]]",
    };

    ctx.mockMetadataExtractor.extractMetadata.mockReturnValueOnce(metadata);

    taskFiles.forEach(() => {
      ctx.mockMetadataExtractor.extractMetadata.mockReturnValueOnce(
        taskMetadata,
      );
    });

    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValueOnce(
      "[[pn__DailyNote]]",
    );

    ctx.mockVaultAdapter.getAllFiles.mockReturnValue(taskFiles);

    const mockEl = createMockElement();
    await ctx.renderer.render(mockEl, mockFile);

    expect(ctx.mockReactRenderer.render).toHaveBeenCalled();
    const renderCall = ctx.mockReactRenderer.render.mock.calls[0];
    const tasks = renderCall[1].props.tasks;
    // No artificial limit - all 60 tasks should be returned
    // UI component handles virtualization for large lists
    expect(tasks.length).toBe(60);
  });

  it("should handle error gracefully", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "DailyNotes" },
      basename: "2025-10-20",
    } as TFile;
    const metadata = {
      exo__Instance_class: ["[[pn__DailyNote]]"],
      pn__DailyNote_day: "[[2025-10-20]]",
    };

    ctx.mockMetadataExtractor.extractMetadata.mockReturnValue(metadata);
    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue(
      "[[pn__DailyNote]]",
    );
    ctx.mockVaultAdapter.getAllFiles.mockImplementation(() => {
      throw new Error("Vault error");
    });

    const mockEl = createMockElement();
    await ctx.renderer.render(mockEl, mockFile);

    expect(ctx.mockLogger.debug).toHaveBeenCalledWith(
      "No tasks found for day: 2025-10-20",
    );
    expect(ctx.mockReactRenderer.render).not.toHaveBeenCalled();
  });

  it("should format timestamps correctly", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "DailyNotes" },
      basename: "2025-10-20",
    } as TFile;
    const metadata = {
      exo__Instance_class: ["[[pn__DailyNote]]"],
      pn__DailyNote_day: "[[2025-10-20]]",
    };

    const taskFile = {
      path: "task.md",
      basename: "test-task",
    } as TFile;

    const taskMetadata = {
      exo__Instance_class: ["[[ems__Task]]"],
      ems__Effort_day: "[[2025-10-20]]",
      ems__Effort_status: "[[ems__EffortStatusDoing]]",
      ems__Effort_startTimestamp: "2025-10-20T09:00:00.000Z",
      ems__Effort_endTimestamp: "2025-10-20T17:00:00.000Z",
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
    expect(tasks[0].startTime).toBeTruthy();
    expect(tasks[0].endTime).toBeTruthy();
  });
});

describe("DailyTasksRenderer - timestamp formatting", () => {
  let ctx: DailyTasksRendererTestContext;

  beforeEach(() => {
    jest.clearAllMocks();
    ctx = setupDailyTasksRendererTest();
  });

  it("should format valid timestamps correctly", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "DailyNotes" },
      basename: "2025-10-20",
    } as TFile;
    const metadata = {
      exo__Instance_class: ["[[pn__DailyNote]]"],
      pn__DailyNote_day: "[[2025-10-20]]",
    };

    const taskFile = {
      path: "task.md",
      basename: "test-task",
    } as TFile;

    const taskMetadata = {
      exo__Instance_class: ["[[ems__Task]]"],
      ems__Effort_day: "[[2025-10-20]]",
      ems__Effort_status: "[[ems__EffortStatusDoing]]",
      ems__Effort_startTimestamp: "2025-10-20T09:00:00.000Z",
      ems__Effort_endTimestamp: "2025-10-20T17:00:00.000Z",
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
    expect(tasks[0].startTime).toBeTruthy();
    expect(tasks[0].endTime).toBeTruthy();
  });

  it("should handle invalid timestamps gracefully", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "DailyNotes" },
      basename: "2025-10-20",
    } as TFile;
    const metadata = {
      exo__Instance_class: ["[[pn__DailyNote]]"],
      pn__DailyNote_day: "[[2025-10-20]]",
    };

    const taskFile = {
      path: "task.md",
      basename: "test-task",
    } as TFile;

    const taskMetadata = {
      exo__Instance_class: ["[[ems__Task]]"],
      ems__Effort_day: "[[2025-10-20]]",
      ems__Effort_plannedStartTimestamp: "2025-10-20T09:00:00",
      ems__Effort_status: "[[ems__EffortStatusDoing]]",
      ems__Effort_startTimestamp: "invalid",
      ems__Effort_endTimestamp: "also-invalid",
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
    expect(tasks[0].startTime).toBe("09:00");
    expect(tasks[0].endTime).toBe("");
  });

  it("should handle null/undefined timestamps", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "DailyNotes" },
      basename: "2025-10-20",
    } as TFile;
    const metadata = {
      exo__Instance_class: ["[[pn__DailyNote]]"],
      pn__DailyNote_day: "[[2025-10-20]]",
    };

    const taskFile = {
      path: "task.md",
      basename: "test-task",
    } as TFile;

    const taskMetadata = {
      exo__Instance_class: ["[[ems__Task]]"],
      ems__Effort_day: "[[2025-10-20]]",
      ems__Effort_status: "[[ems__EffortStatusDoing]]",
      ems__Effort_plannedEndTimestamp: "2025-10-20T18:00:00",
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
    expect(tasks[0].startTime).toBe("");
    expect(tasks[0].endTime).toBe("18:00");
  });

  it("should fallback to planned timestamps when actual not available", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "DailyNotes" },
      basename: "2025-10-20",
    } as TFile;
    const metadata = {
      exo__Instance_class: ["[[pn__DailyNote]]"],
      pn__DailyNote_day: "[[2025-10-20]]",
    };

    const taskFile = {
      path: "task.md",
      basename: "test-task",
    } as TFile;

    const taskMetadata = {
      exo__Instance_class: ["[[ems__Task]]"],
      ems__Effort_day: "[[2025-10-20]]",
      ems__Effort_startTimestamp: "2025-10-20T09:00:00",
      ems__Effort_status: "[[ems__EffortStatusToDo]]",
      ems__Effort_plannedStartTimestamp: "2025-10-20T10:00:00.000Z",
      ems__Effort_plannedEndTimestamp: "2025-10-20T12:00:00.000Z",
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
    expect(tasks[0].startTime).toBeTruthy();
    expect(tasks[0].endTime).toBeTruthy();
  });
});
