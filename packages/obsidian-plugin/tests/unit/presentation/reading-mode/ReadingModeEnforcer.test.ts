import { ReadingModeEnforcer } from "../../../../src/presentation/reading-mode/ReadingModeEnforcer";

jest.mock("obsidian", () => ({
  Plugin: class {},
  TFile: class {},
  MarkdownView: class {},
  WorkspaceLeaf: class {},
  Notice: jest.fn(),
}));

interface FakeFile {
  path: string;
  basename: string;
  extension: string;
}

describe("ReadingModeEnforcer", () => {
  let enforcer: ReadingModeEnforcer;
  let mockPlugin: any;
  let mockApp: any;
  let fileOpenHandlers: Array<(file: FakeFile | null) => void>;
  let leafStates: Map<string, any>;
  let setViewStateCalls: any[];
  let frontmatters: Record<string, any>;
  let leafFiles: Map<string, FakeFile>;

  const FILE_TASK: FakeFile = {
    path: "Audit test task.md",
    basename: "Audit test task",
    extension: "md",
  };
  const FILE_PROJECT: FakeFile = {
    path: "Build API Server.md",
    basename: "Build API Server",
    extension: "md",
  };
  const FILE_PLAIN: FakeFile = {
    path: "random notes.md",
    basename: "random notes",
    extension: "md",
  };
  const FILE_EMPTY_CLASS: FakeFile = {
    path: "empty class.md",
    basename: "empty class",
    extension: "md",
  };

  function makeLeaf(file: FakeFile | null, mode: "source" | "preview"): any {
    const state = {
      type: "markdown",
      state: { mode, file: file?.path ?? null },
    };
    const leaf = {
      view: { file, containerEl: document.createElement("div") },
      getViewState: jest.fn(() => state),
      setViewState: jest.fn(async (newState: any) => {
        setViewStateCalls.push(newState);
        state.state = { ...state.state, ...(newState.state ?? {}) };
      }),
    };
    if (file) leafStates.set(file.path, leaf);
    return leaf;
  }

  beforeEach(() => {
    fileOpenHandlers = [];
    leafStates = new Map();
    setViewStateCalls = [];
    leafFiles = new Map();
    frontmatters = {
      [FILE_TASK.path]: { exo__Instance_class: ["ems__Task"] },
      [FILE_PROJECT.path]: { exo__Instance_class: "ems__Project" },
      [FILE_EMPTY_CLASS.path]: { exo__Instance_class: [] },
    };

    mockApp = {
      workspace: {
        on: jest.fn((event: string, cb: any) => {
          if (event === "file-open") fileOpenHandlers.push(cb);
          return { id: "test" };
        }),
        getLeavesOfType: jest.fn((t: string) => {
          if (t !== "markdown") return [];
          return Array.from(leafStates.values());
        }),
        getMostRecentLeaf: jest.fn(() => {
          const leaves = Array.from(leafStates.values());
          return leaves[leaves.length - 1] ?? null;
        }),
        getActiveFile: jest.fn(() => null),
      },
      metadataCache: {
        getFileCache: jest.fn((file: FakeFile) => {
          const fm = frontmatters[file.path];
          return fm ? { frontmatter: fm } : null;
        }),
      },
    };

    mockPlugin = {
      app: mockApp,
      registerEvent: jest.fn(),
    };

    enforcer = new ReadingModeEnforcer(mockPlugin);
  });

  afterEach(() => {
    enforcer.cleanup();
    jest.clearAllMocks();
  });

  describe("enable", () => {
    it("registers a file-open listener", () => {
      enforcer.enable();
      expect(mockApp.workspace.on).toHaveBeenCalledWith(
        "file-open",
        expect.any(Function)
      );
    });

    it("is idempotent — double enable registers only once", () => {
      enforcer.enable();
      const calls = mockPlugin.registerEvent.mock.calls.length;
      enforcer.enable();
      expect(mockPlugin.registerEvent).toHaveBeenCalledTimes(calls);
    });
  });

  describe("Finding 9: force preview mode for Exocortex assets", () => {
    it("switches ems__Task note from source → preview", async () => {
      makeLeaf(FILE_TASK, "source");
      enforcer.enable();

      const result = await enforcer.enforceForFile(FILE_TASK);

      expect(result).toBe(true);
      expect(setViewStateCalls).toHaveLength(1);
      expect(setViewStateCalls[0].state.mode).toBe("preview");
    });

    it("switches ems__Project note from source → preview", async () => {
      makeLeaf(FILE_PROJECT, "source");
      enforcer.enable();

      const result = await enforcer.enforceForFile(FILE_PROJECT);

      expect(result).toBe(true);
      expect(setViewStateCalls[0].state.mode).toBe("preview");
    });

    it("no-op on plain note without exo__Instance_class", async () => {
      makeLeaf(FILE_PLAIN, "source");
      enforcer.enable();

      const result = await enforcer.enforceForFile(FILE_PLAIN);

      expect(result).toBe(false);
      expect(setViewStateCalls).toHaveLength(0);
    });

    it("no-op when exo__Instance_class is an empty array", async () => {
      makeLeaf(FILE_EMPTY_CLASS, "source");
      enforcer.enable();

      const result = await enforcer.enforceForFile(FILE_EMPTY_CLASS);

      expect(result).toBe(false);
      expect(setViewStateCalls).toHaveLength(0);
    });

    it("no-op when leaf is already in preview mode", async () => {
      makeLeaf(FILE_TASK, "preview");
      enforcer.enable();

      const result = await enforcer.enforceForFile(FILE_TASK);

      expect(result).toBe(false);
      expect(setViewStateCalls).toHaveLength(0);
    });

    it("no-op when no markdown leaf hosts the file", async () => {
      // Leaf exists but for a different file.
      makeLeaf(FILE_PLAIN, "source");
      enforcer.enable();

      const result = await enforcer.enforceForFile(FILE_TASK);

      expect(result).toBe(false);
      expect(setViewStateCalls).toHaveLength(0);
    });

    it("file-open callback forwards to enforceForFile", async () => {
      makeLeaf(FILE_TASK, "source");
      enforcer.enable();
      expect(fileOpenHandlers).toHaveLength(1);

      fileOpenHandlers[0](FILE_TASK);

      // setViewState is called from an async path — wait a microtask.
      await Promise.resolve();
      await Promise.resolve();

      expect(setViewStateCalls.length).toBeGreaterThanOrEqual(1);
      expect(setViewStateCalls[0].state.mode).toBe("preview");
    });

    it("file-open callback ignores null file (file closed)", async () => {
      enforcer.enable();
      fileOpenHandlers[0](null);
      await Promise.resolve();
      expect(setViewStateCalls).toHaveLength(0);
    });
  });

  describe("initial enforcement for pre-existing active file", () => {
    it("enforces on the active file at enable() time", async () => {
      makeLeaf(FILE_TASK, "source");
      mockApp.workspace.getActiveFile = jest.fn(() => FILE_TASK);

      enforcer.enable();
      await Promise.resolve();
      await Promise.resolve();

      expect(setViewStateCalls.length).toBeGreaterThanOrEqual(1);
      expect(setViewStateCalls[0].state.mode).toBe("preview");
    });

    it("no initial enforcement when there is no active file", () => {
      enforcer.enable();
      expect(setViewStateCalls).toHaveLength(0);
    });
  });

  describe("disable", () => {
    it("enforceForFile is a no-op after disable()", async () => {
      makeLeaf(FILE_TASK, "source");
      enforcer.enable();
      enforcer.disable();

      const result = await enforcer.enforceForFile(FILE_TASK);
      expect(result).toBe(false);
      expect(setViewStateCalls).toHaveLength(0);
    });
  });
});
