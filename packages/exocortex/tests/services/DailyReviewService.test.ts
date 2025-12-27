import "reflect-metadata";
import { DailyReviewService } from "../../src/services/DailyReviewService";
import { type IVaultAdapter, type IFile } from "../../src/interfaces/IVaultAdapter";
import { container } from "tsyringe";
import { DI_TOKENS } from "../../src/interfaces/tokens";
import { DateFormatter } from "../../src/utilities/DateFormatter";

// Helper to get today's date string (YYYY-MM-DD)
const getTodayStr = () => DateFormatter.toDateString(new Date());

describe("DailyReviewService", () => {
  let dailyReviewService: DailyReviewService;
  let mockVault: jest.Mocked<IVaultAdapter>;

  const createMockFile = (path: string): IFile => ({
    path,
    basename: path.split("/").pop()?.replace(".md", "") || "",
    name: path.split("/").pop() || "",
    stat: { ctime: Date.now(), mtime: Date.now() },
    parent: null,
  });

  const createPrototypeContent = (options: {
    uid: string;
    label: string;
    recurringRule?: string;
    estimatedDuration?: number;
  }): string => {
    const lines = ["---"];
    lines.push(`exo__Asset_uid: "${options.uid}"`);
    lines.push(`exo__Asset_label: "${options.label}"`);
    lines.push(`exo__Instance_class: "[[ems__TaskPrototype]]"`);

    if (options.recurringRule) {
      lines.push(`ems__Recurring_rule: "${options.recurringRule}"`);
    }
    if (options.estimatedDuration) {
      lines.push(`ems__Task_estimatedDuration: ${options.estimatedDuration}`);
    }

    lines.push("---");
    lines.push("");
    lines.push("Content here");

    return lines.join("\n");
  };

  const createTaskContent = (options: {
    uid: string;
    label: string;
    status?: string;
    startTimestamp?: string;
    endTimestamp?: string;
    prototypeUid?: string;
    plannedStartTimestamp?: string;
  }): string => {
    const lines = ["---"];
    lines.push(`exo__Asset_uid: "${options.uid}"`);
    lines.push(`exo__Asset_label: "${options.label}"`);
    lines.push(`exo__Instance_class: "[[ems__Task]]"`);

    if (options.status) {
      lines.push(`ems__Effort_status: "[[${options.status}]]"`);
    }
    if (options.startTimestamp) {
      lines.push(`ems__Effort_startTimestamp: ${options.startTimestamp}`);
    }
    if (options.endTimestamp) {
      lines.push(`ems__Effort_endTimestamp: ${options.endTimestamp}`);
    }
    if (options.prototypeUid) {
      lines.push(
        `exo__Asset_prototype: "obsidian://vault/03%20Knowledge%2Fkitelev%2F${options.prototypeUid}.md"`,
      );
    }
    if (options.plannedStartTimestamp) {
      lines.push(
        `ems__Effort_plannedStartTimestamp: ${options.plannedStartTimestamp}`,
      );
    }

    lines.push("---");
    lines.push("");
    lines.push("Content here");

    return lines.join("\n");
  };

  beforeEach(() => {
    container.clearInstances();

    mockVault = {
      read: jest.fn(),
      modify: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      rename: jest.fn(),
      createFolder: jest.fn(),
      getAllFiles: jest.fn(),
      getAbstractFileByPath: jest.fn(),
      getFirstLinkpathDest: jest.fn(),
      getFrontmatter: jest.fn(),
      setFrontmatter: jest.fn(),
      exists: jest.fn(),
      trash: jest.fn(),
    } as unknown as jest.Mocked<IVaultAdapter>;

    container.registerInstance(DI_TOKENS.IVaultAdapter, mockVault);

    dailyReviewService = container.resolve(DailyReviewService);
  });

  describe("getPractices", () => {
    it("should return empty array when no files exist", async () => {
      mockVault.getAllFiles.mockReturnValue([]);

      const practices = await dailyReviewService.getPractices();

      expect(practices).toEqual([]);
    });

    it("should return only TaskPrototype files", async () => {
      const protoFile = createMockFile("03 Knowledge/kitelev/proto-1.md");
      const taskFile = createMockFile("03 Knowledge/kitelev/task-1.md");

      mockVault.getAllFiles.mockReturnValue([protoFile, taskFile]);
      mockVault.read.mockImplementation(async (file: IFile) => {
        if (file.path.includes("proto")) {
          return createPrototypeContent({
            uid: "proto-uid-1",
            label: "Morning Shower",
            recurringRule: "daily",
            estimatedDuration: 20,
          });
        }
        return createTaskContent({
          uid: "task-uid-1",
          label: "Morning Shower 2025-01-01",
          status: "ems__EffortStatusDone",
        });
      });

      const practices = await dailyReviewService.getPractices();

      expect(practices).toHaveLength(1);
      expect(practices[0].label).toBe("Morning Shower");
      expect(practices[0].uid).toBe("proto-uid-1");
      expect(practices[0].recurringRule).toBe("daily");
      expect(practices[0].estimatedDuration).toBe(20);
    });

    it("should detect done today status from instance", async () => {
      const today = getTodayStr();
      const protoFile = createMockFile("03 Knowledge/kitelev/proto-1.md");
      const instanceFile = createMockFile("03 Knowledge/kitelev/instance-1.md");

      mockVault.getAllFiles.mockReturnValue([protoFile, instanceFile]);

      const protoContent = createPrototypeContent({
        uid: "proto-uid-1",
        label: "Morning Shower",
        recurringRule: "daily",
      });
      const instanceContent = createTaskContent({
        uid: "instance-uid-1",
        label: `Morning Shower ${today}`,
        status: "ems__EffortStatusDone",
        prototypeUid: "proto-uid-1",
        startTimestamp: DateFormatter.toISOTimestamp(new Date()),
      });

      mockVault.read.mockImplementation(async (file: IFile) => {
        if (file.path.includes("proto-1")) {
          return protoContent;
        }
        return instanceContent;
      });

      const practices = await dailyReviewService.getPractices();

      expect(practices).toHaveLength(1);
      expect(practices[0].doneToday).toBe(true);
      expect(practices[0].inProgressToday).toBe(false);
    });

    it("should sort practices by label", async () => {
      const fileA = createMockFile("03 Knowledge/kitelev/a.md");
      const fileZ = createMockFile("03 Knowledge/kitelev/z.md");

      mockVault.getAllFiles.mockReturnValue([fileZ, fileA]);
      mockVault.read.mockImplementation(async (file: IFile) => {
        if (file.path.includes("a.md")) {
          return createPrototypeContent({
            uid: "uid-a",
            label: "A Practice",
          });
        }
        return createPrototypeContent({
          uid: "uid-z",
          label: "Z Practice",
        });
      });

      const practices = await dailyReviewService.getPractices();

      expect(practices[0].label).toBe("A Practice");
      expect(practices[1].label).toBe("Z Practice");
    });
  });

  describe("getDailyReviewSummary", () => {
    it("should return zeros when no tasks exist", async () => {
      mockVault.getAllFiles.mockReturnValue([]);

      const summary = await dailyReviewService.getDailyReviewSummary();

      expect(summary.plannedCount).toBe(0);
      expect(summary.completedCount).toBe(0);
      expect(summary.inProgressCount).toBe(0);
      expect(summary.completionPercentage).toBe(0);
      expect(summary.totalTimeMinutes).toBe(0);
    });

    it("should count tasks planned for today", async () => {
      const today = new Date();
      const todayStr = DateFormatter.toLocalTimestamp(today);

      const taskFile = createMockFile("03 Knowledge/kitelev/task-1.md");

      mockVault.getAllFiles.mockReturnValue([taskFile]);
      mockVault.read.mockResolvedValue(
        createTaskContent({
          uid: "task-uid-1",
          label: "Some Task",
          status: "ems__EffortStatusBacklog",
          plannedStartTimestamp: todayStr,
        }),
      );

      const summary = await dailyReviewService.getDailyReviewSummary();

      expect(summary.plannedCount).toBe(1);
    });

    it("should count completed tasks and calculate time", async () => {
      const today = new Date();
      const startTime = new Date(today);
      startTime.setHours(9, 0, 0, 0);
      const endTime = new Date(today);
      endTime.setHours(10, 30, 0, 0); // 90 minutes later

      const taskFile = createMockFile("03 Knowledge/kitelev/task-1.md");

      mockVault.getAllFiles.mockReturnValue([taskFile]);
      mockVault.read.mockResolvedValue(
        createTaskContent({
          uid: "task-uid-1",
          label: "Completed Task",
          status: "ems__EffortStatusDone",
          startTimestamp: DateFormatter.toLocalTimestamp(startTime),
          endTimestamp: DateFormatter.toLocalTimestamp(endTime),
        }),
      );

      const summary = await dailyReviewService.getDailyReviewSummary();

      expect(summary.completedCount).toBe(1);
      expect(summary.totalTimeMinutes).toBe(90);
      expect(summary.completionPercentage).toBe(100);
    });

    it("should count in-progress tasks", async () => {
      const today = new Date();
      const startTime = new Date(today);
      startTime.setHours(9, 0, 0, 0);

      const taskFile = createMockFile("03 Knowledge/kitelev/task-1.md");

      mockVault.getAllFiles.mockReturnValue([taskFile]);
      mockVault.read.mockResolvedValue(
        createTaskContent({
          uid: "task-uid-1",
          label: "In Progress Task",
          status: "ems__EffortStatusDoing",
          startTimestamp: DateFormatter.toLocalTimestamp(startTime),
        }),
      );

      const summary = await dailyReviewService.getDailyReviewSummary();

      expect(summary.inProgressCount).toBe(1);
    });
  });

  describe("quickCapture", () => {
    it("should create a started task by default", async () => {
      mockVault.create.mockResolvedValue(createMockFile("03 Knowledge/kitelev/test-file.md"));

      const result = await dailyReviewService.quickCapture("Quick task");

      expect(mockVault.create).toHaveBeenCalled();
      expect(result.label).toBe("Quick task");
      expect(result.started).toBe(true);
      expect(result.uid).toBeDefined();
      expect(result.path).toContain(".md");

      // Check content contains status Doing
      const createCall = mockVault.create.mock.calls[0];
      const content = createCall[1];
      expect(content).toContain("ems__EffortStatusDoing");
      expect(content).toContain("ems__Effort_startTimestamp");
    });

    it("should create a backlog task when startImmediately is false", async () => {
      mockVault.create.mockResolvedValue(createMockFile("03 Knowledge/kitelev/test-file.md"));

      const result = await dailyReviewService.quickCapture("Backlog task", false);

      expect(result.started).toBe(false);

      const createCall = mockVault.create.mock.calls[0];
      const content = createCall[1];
      expect(content).toContain("ems__EffortStatusBacklog");
      expect(content).not.toContain("ems__Effort_startTimestamp");
    });

    it("should link to prototype when provided", async () => {
      mockVault.create.mockResolvedValue(createMockFile("03 Knowledge/kitelev/test-file.md"));

      const result = await dailyReviewService.quickCapture(
        "From prototype",
        true,
        { prototypeUid: "proto-123" },
      );

      const createCall = mockVault.create.mock.calls[0];
      const content = createCall[1];
      expect(content).toContain("exo__Asset_prototype");
      expect(content).toContain("proto-123");
    });
  });

  describe("createFromPractice", () => {
    it("should throw error when practice not found", async () => {
      mockVault.getAllFiles.mockReturnValue([]);

      await expect(
        dailyReviewService.createFromPractice({
          prototypeUid: "non-existent",
        }),
      ).rejects.toThrow("Practice not found");
    });

    it("should throw error when practice already done today", async () => {
      const today = getTodayStr();
      const protoFile = createMockFile("03 Knowledge/kitelev/proto-1.md");
      const instanceFile = createMockFile("03 Knowledge/kitelev/instance-1.md");

      mockVault.getAllFiles.mockReturnValue([protoFile, instanceFile]);
      mockVault.read.mockImplementation(async (file: IFile) => {
        if (file.path.includes("proto")) {
          return createPrototypeContent({
            uid: "proto-uid-1",
            label: "Morning Shower",
            recurringRule: "daily",
          });
        }
        return createTaskContent({
          uid: "instance-uid-1",
          label: `Morning Shower ${today}`,
          status: "ems__EffortStatusDone",
          prototypeUid: "proto-uid-1",
          startTimestamp: DateFormatter.toISOTimestamp(new Date()),
        });
      });

      await expect(
        dailyReviewService.createFromPractice({
          prototypeUid: "proto-uid-1",
        }),
      ).rejects.toThrow("already completed today");
    });

    it("should return existing instance if in progress", async () => {
      const today = getTodayStr();
      const protoFile = createMockFile("03 Knowledge/kitelev/proto-1.md");
      const instanceFile = createMockFile("03 Knowledge/kitelev/instance-1.md");

      mockVault.getAllFiles.mockReturnValue([protoFile, instanceFile]);
      mockVault.read.mockImplementation(async (file: IFile) => {
        if (file.path.includes("proto")) {
          return createPrototypeContent({
            uid: "proto-uid-1",
            label: "Morning Shower",
            recurringRule: "daily",
          });
        }
        return createTaskContent({
          uid: "instance-uid-1",
          label: `Morning Shower ${today}`,
          status: "ems__EffortStatusDoing",
          prototypeUid: "proto-uid-1",
          startTimestamp: DateFormatter.toISOTimestamp(new Date()),
        });
      });

      const result = await dailyReviewService.createFromPractice({
        prototypeUid: "proto-uid-1",
      });

      expect(result.path).toBe("03 Knowledge/kitelev/instance-1.md");
      expect(result.started).toBe(true);
      expect(mockVault.create).not.toHaveBeenCalled();
    });

    it("should create new instance with date in label", async () => {
      const today = getTodayStr();
      const protoFile = createMockFile("03 Knowledge/kitelev/proto-1.md");

      mockVault.getAllFiles.mockReturnValue([protoFile]);
      mockVault.read.mockResolvedValue(
        createPrototypeContent({
          uid: "proto-uid-1",
          label: "Morning Shower",
          recurringRule: "daily",
        }),
      );
      mockVault.create.mockResolvedValue(createMockFile("03 Knowledge/kitelev/test-file.md"));

      const result = await dailyReviewService.createFromPractice({
        prototypeUid: "proto-uid-1",
      });

      expect(result.label).toBe(`Morning Shower ${today}`);
      expect(result.started).toBe(true);
      expect(mockVault.create).toHaveBeenCalled();
    });
  });

  describe("markPracticeDone", () => {
    it("should throw error when practice not found", async () => {
      mockVault.getAllFiles.mockReturnValue([]);

      await expect(
        dailyReviewService.markPracticeDone("non-existent"),
      ).rejects.toThrow("Practice not found");
    });

    it("should throw error when no active instance today", async () => {
      const protoFile = createMockFile("03 Knowledge/kitelev/proto-1.md");

      mockVault.getAllFiles.mockReturnValue([protoFile]);
      mockVault.read.mockResolvedValue(
        createPrototypeContent({
          uid: "proto-uid-1",
          label: "Morning Shower",
          recurringRule: "daily",
        }),
      );

      await expect(
        dailyReviewService.markPracticeDone("proto-uid-1"),
      ).rejects.toThrow("No active instance");
    });

    it("should mark in-progress practice as done", async () => {
      const today = getTodayStr();
      const protoFile = createMockFile("03 Knowledge/kitelev/proto-1.md");
      const instanceFile = createMockFile("03 Knowledge/kitelev/instance-1.md");

      mockVault.getAllFiles.mockReturnValue([protoFile, instanceFile]);
      mockVault.read.mockImplementation(async (file: IFile) => {
        if (file.path.includes("proto")) {
          return createPrototypeContent({
            uid: "proto-uid-1",
            label: "Morning Shower",
            recurringRule: "daily",
          });
        }
        return createTaskContent({
          uid: "instance-uid-1",
          label: `Morning Shower ${today}`,
          status: "ems__EffortStatusDoing",
          prototypeUid: "proto-uid-1",
          startTimestamp: DateFormatter.toISOTimestamp(new Date()),
        });
      });
      mockVault.getAbstractFileByPath.mockReturnValue(instanceFile);
      mockVault.modify.mockResolvedValue(undefined);

      await dailyReviewService.markPracticeDone("proto-uid-1");

      expect(mockVault.modify).toHaveBeenCalled();
      const modifyCall = mockVault.modify.mock.calls[0];
      const updatedContent = modifyCall[1];
      expect(updatedContent).toContain("ems__EffortStatusDone");
      expect(updatedContent).toContain("ems__Effort_endTimestamp");
    });

    it("should do nothing if practice already done", async () => {
      const today = getTodayStr();
      const protoFile = createMockFile("03 Knowledge/kitelev/proto-1.md");
      const instanceFile = createMockFile("03 Knowledge/kitelev/instance-1.md");

      mockVault.getAllFiles.mockReturnValue([protoFile, instanceFile]);
      mockVault.read.mockImplementation(async (file: IFile) => {
        if (file.path.includes("proto")) {
          return createPrototypeContent({
            uid: "proto-uid-1",
            label: "Morning Shower",
            recurringRule: "daily",
          });
        }
        return createTaskContent({
          uid: "instance-uid-1",
          label: `Morning Shower ${today}`,
          status: "ems__EffortStatusDone",
          prototypeUid: "proto-uid-1",
          startTimestamp: DateFormatter.toISOTimestamp(new Date()),
        });
      });

      await dailyReviewService.markPracticeDone("proto-uid-1");

      expect(mockVault.modify).not.toHaveBeenCalled();
    });
  });
});
