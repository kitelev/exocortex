import {
  setupDailyTasksRendererTest,
  createMockElement,
  DailyTasksRendererTestContext,
  TFile,
} from "./DailyTasksRenderer.fixtures";

describe("DailyTasksRenderer - edge cases and error handling", () => {
  let ctx: DailyTasksRendererTestContext;

  beforeEach(() => {
    jest.clearAllMocks();
    ctx = setupDailyTasksRendererTest();
  });

  it("should handle blocker with trashed status", async () => {
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
      basename: "task",
    } as TFile;

    const blockerFile = {
      path: "blocker.md",
      basename: "blocker",
    } as TFile;

    const taskMetadata = {
      exo__Instance_class: ["[[ems__Task]]"],
      ems__Effort_day: "[[2025-10-20]]",
      ems__Effort_startTimestamp: "2025-10-20T09:00:00",
      ems__Effort_status: "[[ems__EffortStatusBacklog]]",
      ems__Effort_blocker: "[[blocker]]",
    };

    const blockerMetadata = {
      ems__Effort_status: "[[ems__EffortStatusTrashed]]",
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

  it("should handle blocker file not found", async () => {
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
      basename: "task",
    } as TFile;

    const taskMetadata = {
      exo__Instance_class: ["[[ems__Task]]"],
      ems__Effort_day: "[[2025-10-20]]",
      ems__Effort_startTimestamp: "2025-10-20T09:00:00",
      ems__Effort_status: "[[ems__EffortStatusBacklog]]",
      ems__Effort_blocker: "[[nonexistent]]",
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

    expect(ctx.mockReactRenderer.render).toHaveBeenCalled();
    const renderCall = ctx.mockReactRenderer.render.mock.calls[0];
    const tasks = renderCall[1].props.tasks;
    expect(tasks[0].isBlocked).toBe(false);
  });

  it("should handle mixed instance class formats", async () => {
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
      basename: "task",
    } as TFile;

    const taskMetadata = {
      exo__Instance_class: ["[[ems__Task]]"],
      ems__Effort_day: "[[2025-10-20]]",
      ems__Effort_startTimestamp: "2025-10-20T09:00:00",
      ems__Effort_status: "ems__EffortStatusBacklog",
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
    expect(tasks.length).toBe(1);
  });

  it("should handle numeric timestamp values", async () => {
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
      basename: "task",
    } as TFile;

    const taskMetadata = {
      exo__Instance_class: ["[[ems__Task]]"],
      ems__Effort_day: "[[2025-10-20]]",
      ems__Effort_status: "[[ems__EffortStatusDoing]]",
      ems__Effort_startTimestamp: 1760932800000,
      ems__Effort_endTimestamp: 1760961600000,
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

  // Issue #2135: Prototype class resolution uses wrong property name
  it("should resolve prototype classes using exo__Asset_prototype (Issue #2135)", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "DailyNotes" },
      basename: "2025-10-20",
    } as TFile;
    const dailyNoteMetadata = {
      exo__Instance_class: ["[[pn__DailyNote]]"],
      pn__DailyNote_day: "[[2025-10-20]]",
    };

    const taskFile = {
      path: "task.md",
      basename: "task",
    } as TFile;

    const prototypeFile = {
      path: "fb3d12b2-9552-4866-a31e-2b5f65ea433c.md",
      basename: "fb3d12b2-9552-4866-a31e-2b5f65ea433c",
    } as TFile;

    // Task has exo__Asset_prototype (correct property used in vault)
    const taskMetadata = {
      exo__Instance_class: ["[[ems__Task]]"],
      ems__Effort_day: "[[2025-10-20]]",
      ems__Effort_startTimestamp: "2025-10-20T09:00:00",
      ems__Effort_status: "[[ems__EffortStatusDoing]]",
      exo__Asset_prototype: "[[fb3d12b2-9552-4866-a31e-2b5f65ea433c]]",
    };

    // Prototype has ems__Context class (should exclude from overlap detection)
    const prototypeMetadata = {
      exo__Instance_class: ["[[ems__Task]]", "[[ems__Context]]"],
    };

    // The metadata extractor is called in this order:
    // 1. For the DailyNote file (in render method)
    // 2. For the task file (in getDailyTasks loop - first the task, then prototype is skipped since it's not a task for the day)
    // 3. For the prototype file (in getDailyTasks - it doesn't match day filter, but we check prototype file anyway)
    // 4. For the prototype file (in resolvePrototypeClasses)
    ctx.mockMetadataExtractor.extractMetadata
      .mockImplementation((file: any) => {
        if (file.path === "test.md") return dailyNoteMetadata;
        if (file.path === "task.md") return taskMetadata;
        if (file.path === "fb3d12b2-9552-4866-a31e-2b5f65ea433c.md") return prototypeMetadata;
        return {};
      });

    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue(
      "[[pn__DailyNote]]",
    );

    ctx.mockVaultAdapter.getAllFiles.mockReturnValue([taskFile, prototypeFile]);

    const mockEl = createMockElement();
    await ctx.renderer.render(mockEl, mockFile);

    expect(ctx.mockReactRenderer.render).toHaveBeenCalled();
    const renderCall = ctx.mockReactRenderer.render.mock.calls[0];
    const tasks = renderCall[1].props.tasks;

    // _prototypeClasses should be resolved from prototype's exo__Instance_class
    expect(tasks[0].metadata._prototypeClasses).toEqual(["[[ems__Task]]", "[[ems__Context]]"]);
  });

  // Same as the test above, but the prototype ref is written as a single-item
  // YAML list instead of a scalar. Both shapes occur in production vaults —
  // `exocortex-cli create` emits the scalar, hand-authored / list-migrated
  // assets carry the list (19.5% of bearers in the live personal vault).
  // Before the unwrap, `resolvePrototypeClasses` failed the
  // `typeof !== 'string'` guard and returned null, so overlap detection
  // silently lost the prototype's classes for those tasks.
  //
  // REVERT-VERIFY anchor: drop the `Array.isArray(rawPrototype) ? ... : ...`
  // unwrap in `resolvePrototypeClasses` → this axis goes RED
  // (_prototypeClasses undefined), while the scalar axis above stays GREEN.
  it("should resolve prototype classes when exo__Asset_prototype is a single-item LIST", async () => {
    const mockFile = {
      path: "test.md",
      parent: { path: "DailyNotes" },
      basename: "2025-10-20",
    } as TFile;
    const dailyNoteMetadata = {
      exo__Instance_class: ["[[pn__DailyNote]]"],
      pn__DailyNote_day: "[[2025-10-20]]",
    };

    const taskFile = { path: "task.md", basename: "task" } as TFile;
    const prototypeFile = {
      path: "fb3d12b2-9552-4866-a31e-2b5f65ea433c.md",
      basename: "fb3d12b2-9552-4866-a31e-2b5f65ea433c",
    } as TFile;

    const taskMetadata = {
      exo__Instance_class: ["[[ems__Task]]"],
      ems__Effort_day: "[[2025-10-20]]",
      ems__Effort_startTimestamp: "2025-10-20T09:00:00",
      ems__Effort_status: "[[ems__EffortStatusDoing]]",
      // Single-item YAML list — the shape that used to yield null.
      exo__Asset_prototype: ["[[fb3d12b2-9552-4866-a31e-2b5f65ea433c]]"],
    };

    const prototypeMetadata = {
      exo__Instance_class: ["[[ems__Task]]", "[[ems__Context]]"],
    };

    ctx.mockMetadataExtractor.extractMetadata.mockImplementation((file: any) => {
      if (file.path === "test.md") return dailyNoteMetadata;
      if (file.path === "task.md") return taskMetadata;
      if (file.path === "fb3d12b2-9552-4866-a31e-2b5f65ea433c.md")
        return prototypeMetadata;
      return {};
    });

    ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue(
      "[[pn__DailyNote]]",
    );

    ctx.mockVaultAdapter.getAllFiles.mockReturnValue([taskFile, prototypeFile]);

    const mockEl = createMockElement();
    await ctx.renderer.render(mockEl, mockFile);

    expect(ctx.mockReactRenderer.render).toHaveBeenCalled();
    // `mock.calls[0][1]` is `unknown` under the tests tsconfig; the sibling
    // tests above carry that as baselined TS2571 debt — a new test must not
    // add another instance (scripts/check-test-types.mjs ratchet).
    const renderCall = ctx.mockReactRenderer.render.mock.calls[0] as unknown as [
      unknown,
      { props: { tasks: Array<{ metadata: Record<string, unknown> }> } },
    ];
    const tasks = renderCall[1].props.tasks;

    expect(tasks[0].metadata._prototypeClasses).toEqual([
      "[[ems__Task]]",
      "[[ems__Context]]",
    ]);
  });
});
