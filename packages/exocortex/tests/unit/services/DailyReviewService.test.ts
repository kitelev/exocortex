import { DailyReviewService } from "../../../src/services/DailyReviewService";
import type { IVaultAdapter, IFile, IFolder } from "../../../src/interfaces/IVaultAdapter";

describe("DailyReviewService", () => {
  let service: DailyReviewService;
  let mockVault: jest.Mocked<IVaultAdapter>;

  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const todayTimestamp = `${todayStr}T10:00:00`;

  const makeFile = (path: string, basename?: string): IFile => ({
    path,
    basename: basename || path.replace(".md", "").split("/").pop()!,
    name: path.split("/").pop()!,
    parent: { path: path.split("/").slice(0, -1).join("/") } as IFolder,
  });

  const makeFrontmatter = (props: Record<string, string | null>): string => {
    const lines = ["---"];
    for (const [key, value] of Object.entries(props)) {
      if (value === null) continue;
      lines.push(`${key}: ${value}`);
    }
    lines.push("---", "", "");
    return lines.join("\n");
  };

  beforeEach(() => {
    mockVault = {
      read: jest.fn(),
      create: jest.fn().mockImplementation((path: string) => {
        return Promise.resolve(makeFile(path));
      }),
      modify: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn(),
      rename: jest.fn(),
      getAbstractFileByPath: jest.fn(),
      createFolder: jest.fn(),
      exists: jest.fn(),
      getMetadata: jest.fn(),
      getFirstLinkpathDest: jest.fn(),
      getFilesWithTag: jest.fn(),
      getFilesInFolder: jest.fn(),
      getAllMarkdownFiles: jest.fn(),
      toTFile: jest.fn(),
      processFrontMatter: jest.fn(),
      getAllFiles: jest.fn().mockReturnValue([]),
    } as unknown as jest.Mocked<IVaultAdapter>;

    service = new DailyReviewService(mockVault);
  });

  describe("getPractices", () => {
    it("should return empty array when no files", async () => {
      mockVault.getAllFiles.mockReturnValue([]);
      const result = await service.getPractices();
      expect(result).toEqual([]);
    });

    it("should skip non-md files", async () => {
      mockVault.getAllFiles.mockReturnValue([makeFile("image.png")]);
      const result = await service.getPractices();
      expect(result).toEqual([]);
    });

    it("should skip files without frontmatter", async () => {
      const file = makeFile("note.md");
      mockVault.getAllFiles.mockReturnValue([file]);
      mockVault.read.mockResolvedValue("No frontmatter here");
      const result = await service.getPractices();
      expect(result).toEqual([]);
    });

    it("should skip files that are not TaskPrototype", async () => {
      const file = makeFile("task.md");
      mockVault.getAllFiles.mockReturnValue([file]);
      mockVault.read.mockResolvedValue(makeFrontmatter({
        exo__Instance_class: '"[[ems__Task]]"',
        exo__Asset_uid: '"test-uid"',
        exo__Asset_label: '"Test Task"',
      }));
      const result = await service.getPractices();
      expect(result).toEqual([]);
    });

    it("should skip files without uid", async () => {
      const file = makeFile("proto.md");
      mockVault.getAllFiles.mockReturnValue([file]);
      mockVault.read.mockResolvedValue(makeFrontmatter({
        exo__Instance_class: '"[[ems__TaskPrototype]]"',
        exo__Asset_label: '"Practice"',
      }));
      const result = await service.getPractices();
      expect(result).toEqual([]);
    });

    it("should skip files without label", async () => {
      const file = makeFile("proto.md");
      mockVault.getAllFiles.mockReturnValue([file]);
      mockVault.read.mockResolvedValue(makeFrontmatter({
        exo__Instance_class: '"[[ems__TaskPrototype]]"',
        exo__Asset_uid: '"test-uid"',
      }));
      const result = await service.getPractices();
      expect(result).toEqual([]);
    });

    it("should identify TaskPrototype and return practice", async () => {
      const file = makeFile("proto.md");
      mockVault.getAllFiles.mockReturnValue([file]);
      mockVault.read.mockResolvedValue(makeFrontmatter({
        exo__Instance_class: '"[[ems__TaskPrototype]]"',
        exo__Asset_uid: '"proto-uid"',
        exo__Asset_label: '"Morning Routine"',
        ems__Recurring_rule: '"daily"',
        ems__Task_estimatedDuration: "30",
      }));
      const result = await service.getPractices();
      expect(result).toHaveLength(1);
      expect(result[0].uid).toBe("proto-uid");
      expect(result[0].label).toBe("Morning Routine");
      expect(result[0].recurringRule).toBe("daily");
      expect(result[0].estimatedDuration).toBe(30);
      expect(result[0].doneToday).toBe(false);
      expect(result[0].inProgressToday).toBe(false);
      expect(result[0].todayInstancePath).toBeNull();
    });

    it("should handle non-numeric estimated duration", async () => {
      const file = makeFile("proto.md");
      mockVault.getAllFiles.mockReturnValue([file]);
      mockVault.read.mockResolvedValue(makeFrontmatter({
        exo__Instance_class: '"[[ems__TaskPrototype]]"',
        exo__Asset_uid: '"proto-uid"',
        exo__Asset_label: '"Practice"',
        ems__Task_estimatedDuration: "not-a-number",
      }));
      const result = await service.getPractices();
      expect(result[0].estimatedDuration).toBeNull();
    });

    it("should handle null recurring rule", async () => {
      const file = makeFile("proto.md");
      mockVault.getAllFiles.mockReturnValue([file]);
      mockVault.read.mockResolvedValue(makeFrontmatter({
        exo__Instance_class: '"[[ems__TaskPrototype]]"',
        exo__Asset_uid: '"proto-uid"',
        exo__Asset_label: '"Practice"',
      }));
      const result = await service.getPractices();
      expect(result[0].recurringRule).toBeNull();
    });

    it("should detect done-today instance", async () => {
      const protoFile = makeFile("proto.md");
      const instanceFile = makeFile("instance.md");
      mockVault.getAllFiles.mockReturnValue([protoFile, instanceFile]);
      mockVault.read.mockImplementation(async (file: IFile) => {
        if (file.path === "proto.md") {
          return makeFrontmatter({
            exo__Instance_class: '"[[ems__TaskPrototype]]"',
            exo__Asset_uid: '"proto-uid"',
            exo__Asset_label: '"Practice"',
          });
        }
        return makeFrontmatter({
          exo__Instance_class: '"[[ems__Task]]"',
          exo__Asset_prototype: '"obsidian://vault/proto-uid.md"',
          exo__Asset_label: `"Practice ${todayStr}"`,
          ems__Effort_status: '"[[ems__EffortStatusDone]]"',
          ems__Effort_startTimestamp: todayTimestamp,
        });
      });
      const result = await service.getPractices();
      expect(result[0].doneToday).toBe(true);
      expect(result[0].todayInstancePath).toBe("instance.md");
    });

    it("should detect in-progress-today instance", async () => {
      const protoFile = makeFile("proto.md");
      const instanceFile = makeFile("instance.md");
      mockVault.getAllFiles.mockReturnValue([protoFile, instanceFile]);
      mockVault.read.mockImplementation(async (file: IFile) => {
        if (file.path === "proto.md") {
          return makeFrontmatter({
            exo__Instance_class: '"[[ems__TaskPrototype]]"',
            exo__Asset_uid: '"proto-uid"',
            exo__Asset_label: '"Practice"',
          });
        }
        return makeFrontmatter({
          exo__Instance_class: '"[[ems__Task]]"',
          exo__Asset_prototype: '"obsidian://vault/proto-uid.md"',
          exo__Asset_label: `"Practice ${todayStr}"`,
          ems__Effort_status: '"[[ems__EffortStatusDoing]]"',
          ems__Effort_startTimestamp: todayTimestamp,
        });
      });
      const result = await service.getPractices();
      expect(result[0].inProgressToday).toBe(true);
    });

    it("should detect instance with other status", async () => {
      const protoFile = makeFile("proto.md");
      const instanceFile = makeFile("instance.md");
      mockVault.getAllFiles.mockReturnValue([protoFile, instanceFile]);
      mockVault.read.mockImplementation(async (file: IFile) => {
        if (file.path === "proto.md") {
          return makeFrontmatter({
            exo__Instance_class: '"[[ems__TaskPrototype]]"',
            exo__Asset_uid: '"proto-uid"',
            exo__Asset_label: '"Practice"',
          });
        }
        return makeFrontmatter({
          exo__Instance_class: '"[[ems__Task]]"',
          exo__Asset_prototype: '"obsidian://vault/proto-uid.md"',
          exo__Asset_label: `"Practice ${todayStr}"`,
          ems__Effort_status: '"[[ems__EffortStatusBacklog]]"',
          ems__Effort_startTimestamp: todayTimestamp,
        });
      });
      const result = await service.getPractices();
      expect(result[0].doneToday).toBe(false);
      expect(result[0].inProgressToday).toBe(false);
      expect(result[0].todayInstancePath).toBe("instance.md");
    });

    it("should handle file read errors gracefully", async () => {
      const file = makeFile("bad.md");
      mockVault.getAllFiles.mockReturnValue([file]);
      mockVault.read.mockRejectedValue(new Error("Read error"));
      const result = await service.getPractices();
      expect(result).toEqual([]);
    });

    it("should sort practices by label", async () => {
      const file1 = makeFile("b.md");
      const file2 = makeFile("a.md");
      mockVault.getAllFiles.mockReturnValue([file1, file2]);
      mockVault.read.mockImplementation(async (file: IFile) => {
        const label = file.path === "b.md" ? "Zebra Practice" : "Alpha Practice";
        return makeFrontmatter({
          exo__Instance_class: '"[[ems__TaskPrototype]]"',
          exo__Asset_uid: `"uid-${file.path}"`,
          exo__Asset_label: `"${label}"`,
        });
      });
      const result = await service.getPractices();
      expect(result[0].label).toBe("Alpha Practice");
      expect(result[1].label).toBe("Zebra Practice");
    });

    it("should recognize TaskPrototype without prefix", async () => {
      const file = makeFile("proto.md");
      mockVault.getAllFiles.mockReturnValue([file]);
      mockVault.read.mockResolvedValue(makeFrontmatter({
        exo__Instance_class: '"[[TaskPrototype]]"',
        exo__Asset_uid: '"uid-1"',
        exo__Asset_label: '"Practice"',
      }));
      const result = await service.getPractices();
      expect(result).toHaveLength(1);
    });
  });

  describe("quickCapture", () => {
    it("should create task with start status when startImmediately is true", async () => {
      const result = await service.quickCapture("Quick Task", true);
      expect(result.started).toBe(true);
      expect(result.label).toBe("Quick Task");
      expect(result.uid).toBeDefined();
      const content = mockVault.create.mock.calls[0][1];
      expect(content).toContain("ems__EffortStatusDoing");
      expect(content).toContain("ems__Effort_startTimestamp");
    });

    it("should create task with backlog status when startImmediately is false", async () => {
      const result = await service.quickCapture("Later Task", false);
      expect(result.started).toBe(false);
      const content = mockVault.create.mock.calls[0][1];
      expect(content).toContain("ems__EffortStatusBacklog");
      expect(content).not.toContain("ems__Effort_startTimestamp");
    });

    it("should include prototype URI when prototypeUid is provided", async () => {
      await service.quickCapture("Task", true, { prototypeUid: "proto-123" });
      const content = mockVault.create.mock.calls[0][1];
      expect(content).toContain("exo__Asset_prototype");
      expect(content).toContain("proto-123");
    });

    it("should include area URI when areaUid is provided", async () => {
      await service.quickCapture("Task", true, { areaUid: "area-456" });
      const content = mockVault.create.mock.calls[0][1];
      expect(content).toContain("ems__Effort_area");
      expect(content).toContain("area-456");
    });

    it("should include parent URI when parentUid is provided", async () => {
      await service.quickCapture("Task", true, { parentUid: "parent-789" });
      const content = mockVault.create.mock.calls[0][1];
      expect(content).toContain("ems__Effort_parent");
      expect(content).toContain("parent-789");
    });

    it("should default startImmediately to true", async () => {
      const result = await service.quickCapture("Task");
      expect(result.started).toBe(true);
    });
  });

  describe("getDailyReviewSummary", () => {
    it("should return zero counts when no files exist", async () => {
      mockVault.getAllFiles.mockReturnValue([]);
      const result = await service.getDailyReviewSummary();
      expect(result.plannedCount).toBe(0);
      expect(result.completedCount).toBe(0);
      expect(result.inProgressCount).toBe(0);
      expect(result.completionPercentage).toBe(0);
    });

    it("should skip non-md files", async () => {
      mockVault.getAllFiles.mockReturnValue([makeFile("image.png")]);
      const result = await service.getDailyReviewSummary();
      expect(result.plannedCount).toBe(0);
    });

    it("should skip non-Task files", async () => {
      const file = makeFile("project.md");
      mockVault.getAllFiles.mockReturnValue([file]);
      mockVault.read.mockResolvedValue(makeFrontmatter({
        exo__Instance_class: '"[[ems__Project]]"',
        ems__Effort_startTimestamp: todayTimestamp,
      }));
      const result = await service.getDailyReviewSummary();
      expect(result.plannedCount).toBe(0);
    });

    it("should skip TaskPrototype files", async () => {
      const file = makeFile("proto.md");
      mockVault.getAllFiles.mockReturnValue([file]);
      mockVault.read.mockResolvedValue(makeFrontmatter({
        exo__Instance_class: '"[[ems__TaskPrototype]]"',
        ems__Effort_startTimestamp: todayTimestamp,
      }));
      const result = await service.getDailyReviewSummary();
      expect(result.plannedCount).toBe(0);
    });

    it("should count task started today as planned", async () => {
      const file = makeFile("task.md");
      mockVault.getAllFiles.mockReturnValue([file]);
      mockVault.read.mockResolvedValue(makeFrontmatter({
        exo__Instance_class: '"[[ems__Task]]"',
        ems__Effort_startTimestamp: todayTimestamp,
        ems__Effort_status: '"[[ems__EffortStatusDoing]]"',
      }));
      const result = await service.getDailyReviewSummary(today);
      expect(result.plannedCount).toBe(1);
      expect(result.inProgressCount).toBe(1);
    });

    it("should count completed task and calculate duration", async () => {
      const file = makeFile("task.md");
      mockVault.getAllFiles.mockReturnValue([file]);
      mockVault.read.mockResolvedValue(makeFrontmatter({
        exo__Instance_class: '"[[ems__Task]]"',
        ems__Effort_startTimestamp: `${todayStr}T09:00:00`,
        ems__Effort_endTimestamp: `${todayStr}T10:30:00`,
        ems__Effort_status: '"[[ems__EffortStatusDone]]"',
      }));
      const result = await service.getDailyReviewSummary(today);
      expect(result.completedCount).toBe(1);
      expect(result.totalTimeMinutes).toBe(90);
    });

    it("should count task planned for today via plannedStartTimestamp", async () => {
      const file = makeFile("task.md");
      mockVault.getAllFiles.mockReturnValue([file]);
      mockVault.read.mockResolvedValue(makeFrontmatter({
        exo__Instance_class: '"[[ems__Task]]"',
        ems__Effort_plannedStartTimestamp: todayTimestamp,
        ems__Effort_status: '"[[ems__EffortStatusBacklog]]"',
      }));
      const result = await service.getDailyReviewSummary(today);
      expect(result.plannedCount).toBe(1);
    });

    it("should skip tasks not for today", async () => {
      const file = makeFile("task.md");
      mockVault.getAllFiles.mockReturnValue([file]);
      mockVault.read.mockResolvedValue(makeFrontmatter({
        exo__Instance_class: '"[[ems__Task]]"',
        ems__Effort_startTimestamp: "2020-01-01T10:00:00",
        ems__Effort_status: '"[[ems__EffortStatusDone]]"',
      }));
      const result = await service.getDailyReviewSummary(today);
      expect(result.plannedCount).toBe(0);
    });

    it("should handle file read errors gracefully", async () => {
      const file = makeFile("bad.md");
      mockVault.getAllFiles.mockReturnValue([file]);
      mockVault.read.mockRejectedValue(new Error("Read error"));
      const result = await service.getDailyReviewSummary();
      expect(result.plannedCount).toBe(0);
    });

    it("should calculate completion percentage", async () => {
      const file1 = makeFile("task1.md");
      const file2 = makeFile("task2.md");
      mockVault.getAllFiles.mockReturnValue([file1, file2]);
      mockVault.read.mockImplementation(async (file: IFile) => {
        if (file.path === "task1.md") {
          return makeFrontmatter({
            exo__Instance_class: '"[[ems__Task]]"',
            ems__Effort_startTimestamp: todayTimestamp,
            ems__Effort_status: '"[[ems__EffortStatusDone]]"',
          });
        }
        return makeFrontmatter({
          exo__Instance_class: '"[[ems__Task]]"',
          ems__Effort_startTimestamp: todayTimestamp,
          ems__Effort_status: '"[[ems__EffortStatusDoing]]"',
        });
      });
      const result = await service.getDailyReviewSummary(today);
      expect(result.completionPercentage).toBe(50);
    });

    it("should recognize Done status variant", async () => {
      const file = makeFile("task.md");
      mockVault.getAllFiles.mockReturnValue([file]);
      mockVault.read.mockResolvedValue(makeFrontmatter({
        exo__Instance_class: '"[[ems__Task]]"',
        ems__Effort_startTimestamp: todayTimestamp,
        ems__Effort_status: '"Done"',
      }));
      const result = await service.getDailyReviewSummary(today);
      expect(result.completedCount).toBe(1);
    });

    it("should recognize Doing status variant", async () => {
      const file = makeFile("task.md");
      mockVault.getAllFiles.mockReturnValue([file]);
      mockVault.read.mockResolvedValue(makeFrontmatter({
        exo__Instance_class: '"[[ems__Task]]"',
        ems__Effort_startTimestamp: todayTimestamp,
        ems__Effort_status: '"Doing"',
      }));
      const result = await service.getDailyReviewSummary(today);
      expect(result.inProgressCount).toBe(1);
    });

    it("should handle completed task with no endTimestamp", async () => {
      const file = makeFile("task.md");
      mockVault.getAllFiles.mockReturnValue([file]);
      mockVault.read.mockResolvedValue(makeFrontmatter({
        exo__Instance_class: '"[[ems__Task]]"',
        ems__Effort_startTimestamp: todayTimestamp,
        ems__Effort_status: '"[[ems__EffortStatusDone]]"',
      }));
      const result = await service.getDailyReviewSummary(today);
      expect(result.completedCount).toBe(1);
      expect(result.totalTimeMinutes).toBe(0);
    });

    it("should filter practices due today", async () => {
      // This test verifies the practicesDue filtering
      mockVault.getAllFiles.mockReturnValue([]);
      const result = await service.getDailyReviewSummary();
      expect(result.practicesDue).toEqual([]);
    });

    it("should use current date when no date provided", async () => {
      mockVault.getAllFiles.mockReturnValue([]);
      const result = await service.getDailyReviewSummary();
      expect(result.date).toBe(todayStr);
    });

    it("should recognize ems__Task class with [[]] syntax", async () => {
      const file = makeFile("task.md");
      mockVault.getAllFiles.mockReturnValue([file]);
      mockVault.read.mockResolvedValue(makeFrontmatter({
        exo__Instance_class: '"[[ems__Task]]"',
        ems__Effort_startTimestamp: todayTimestamp,
        ems__Effort_status: '"[[ems__EffortStatusDoing]]"',
      }));
      const result = await service.getDailyReviewSummary(today);
      expect(result.inProgressCount).toBe(1);
    });
  });

  describe("createFromPractice", () => {
    it("should throw when practice not found", async () => {
      mockVault.getAllFiles.mockReturnValue([]);
      await expect(
        service.createFromPractice({ prototypeUid: "nonexistent" }),
      ).rejects.toThrow("Practice not found");
    });

    it("should throw when practice already done today", async () => {
      const protoFile = makeFile("proto.md");
      const instanceFile = makeFile("instance.md");
      mockVault.getAllFiles.mockReturnValue([protoFile, instanceFile]);
      mockVault.read.mockImplementation(async (file: IFile) => {
        if (file.path === "proto.md") {
          return makeFrontmatter({
            exo__Instance_class: '"[[ems__TaskPrototype]]"',
            exo__Asset_uid: '"proto-uid"',
            exo__Asset_label: '"Practice"',
          });
        }
        return makeFrontmatter({
          exo__Instance_class: '"[[ems__Task]]"',
          exo__Asset_prototype: '"obsidian://vault/proto-uid.md"',
          exo__Asset_label: `"Practice ${todayStr}"`,
          ems__Effort_status: '"[[ems__EffortStatusDone]]"',
          ems__Effort_startTimestamp: todayTimestamp,
        });
      });
      await expect(
        service.createFromPractice({ prototypeUid: "proto-uid" }),
      ).rejects.toThrow("already completed today");
    });

    it("should return existing in-progress instance", async () => {
      const protoFile = makeFile("proto.md");
      const instanceFile = makeFile("instance.md");
      mockVault.getAllFiles.mockReturnValue([protoFile, instanceFile]);
      mockVault.read.mockImplementation(async (file: IFile) => {
        if (file.path === "proto.md") {
          return makeFrontmatter({
            exo__Instance_class: '"[[ems__TaskPrototype]]"',
            exo__Asset_uid: '"proto-uid"',
            exo__Asset_label: '"Practice"',
          });
        }
        return makeFrontmatter({
          exo__Instance_class: '"[[ems__Task]]"',
          exo__Asset_prototype: '"obsidian://vault/proto-uid.md"',
          exo__Asset_label: `"Practice ${todayStr}"`,
          ems__Effort_status: '"[[ems__EffortStatusDoing]]"',
          ems__Effort_startTimestamp: todayTimestamp,
        });
      });
      const result = await service.createFromPractice({ prototypeUid: "proto-uid" });
      expect(result.path).toBe("instance.md");
      expect(result.started).toBe(true);
    });

    it("should create new task from practice with default label", async () => {
      const protoFile = makeFile("proto.md");
      mockVault.getAllFiles.mockReturnValue([protoFile]);
      mockVault.read.mockResolvedValue(makeFrontmatter({
        exo__Instance_class: '"[[ems__TaskPrototype]]"',
        exo__Asset_uid: '"proto-uid"',
        exo__Asset_label: '"Morning Routine"',
      }));
      const result = await service.createFromPractice({ prototypeUid: "proto-uid" });
      expect(result.label).toContain("Morning Routine");
      expect(result.label).toContain(todayStr);
    });

    it("should use custom label when provided", async () => {
      const protoFile = makeFile("proto.md");
      mockVault.getAllFiles.mockReturnValue([protoFile]);
      mockVault.read.mockResolvedValue(makeFrontmatter({
        exo__Instance_class: '"[[ems__TaskPrototype]]"',
        exo__Asset_uid: '"proto-uid"',
        exo__Asset_label: '"Morning Routine"',
      }));
      const result = await service.createFromPractice({
        prototypeUid: "proto-uid",
        label: "Custom Label",
      });
      expect(result.label).toBe("Custom Label");
    });

    it("should not start immediately when startImmediately is false", async () => {
      const protoFile = makeFile("proto.md");
      mockVault.getAllFiles.mockReturnValue([protoFile]);
      mockVault.read.mockResolvedValue(makeFrontmatter({
        exo__Instance_class: '"[[ems__TaskPrototype]]"',
        exo__Asset_uid: '"proto-uid"',
        exo__Asset_label: '"Practice"',
      }));
      const result = await service.createFromPractice({
        prototypeUid: "proto-uid",
        startImmediately: false,
      });
      expect(result.started).toBe(false);
    });

    it("should pass areaUid and parentUid to quickCapture", async () => {
      const protoFile = makeFile("proto.md");
      mockVault.getAllFiles.mockReturnValue([protoFile]);
      mockVault.read.mockResolvedValue(makeFrontmatter({
        exo__Instance_class: '"[[ems__TaskPrototype]]"',
        exo__Asset_uid: '"proto-uid"',
        exo__Asset_label: '"Practice"',
      }));
      await service.createFromPractice({
        prototypeUid: "proto-uid",
        areaUid: "area-1",
        parentUid: "parent-1",
      });
      const content = mockVault.create.mock.calls[0][1];
      expect(content).toContain("area-1");
      expect(content).toContain("parent-1");
    });
  });

  describe("markPracticeDone", () => {
    it("should throw when practice not found", async () => {
      mockVault.getAllFiles.mockReturnValue([]);
      await expect(service.markPracticeDone("nonexistent")).rejects.toThrow(
        "Practice not found",
      );
    });

    it("should return silently when already done", async () => {
      const protoFile = makeFile("proto.md");
      const instanceFile = makeFile("instance.md");
      mockVault.getAllFiles.mockReturnValue([protoFile, instanceFile]);
      mockVault.read.mockImplementation(async (file: IFile) => {
        if (file.path === "proto.md") {
          return makeFrontmatter({
            exo__Instance_class: '"[[ems__TaskPrototype]]"',
            exo__Asset_uid: '"proto-uid"',
            exo__Asset_label: '"Practice"',
          });
        }
        return makeFrontmatter({
          exo__Instance_class: '"[[ems__Task]]"',
          exo__Asset_prototype: '"obsidian://vault/proto-uid.md"',
          exo__Asset_label: `"Practice ${todayStr}"`,
          ems__Effort_status: '"[[ems__EffortStatusDone]]"',
          ems__Effort_startTimestamp: todayTimestamp,
        });
      });
      await service.markPracticeDone("proto-uid");
      expect(mockVault.modify).not.toHaveBeenCalled();
    });

    it("should throw when no active instance today", async () => {
      const protoFile = makeFile("proto.md");
      mockVault.getAllFiles.mockReturnValue([protoFile]);
      mockVault.read.mockResolvedValue(makeFrontmatter({
        exo__Instance_class: '"[[ems__TaskPrototype]]"',
        exo__Asset_uid: '"proto-uid"',
        exo__Asset_label: '"Practice"',
      }));
      await expect(service.markPracticeDone("proto-uid")).rejects.toThrow(
        "No active instance",
      );
    });

    it("should throw when file not found at todayInstancePath", async () => {
      const protoFile = makeFile("proto.md");
      const instanceFile = makeFile("instance.md");
      mockVault.getAllFiles.mockReturnValue([protoFile, instanceFile]);
      mockVault.read.mockImplementation(async (file: IFile) => {
        if (file.path === "proto.md") {
          return makeFrontmatter({
            exo__Instance_class: '"[[ems__TaskPrototype]]"',
            exo__Asset_uid: '"proto-uid"',
            exo__Asset_label: '"Practice"',
          });
        }
        return makeFrontmatter({
          exo__Instance_class: '"[[ems__Task]]"',
          exo__Asset_prototype: '"obsidian://vault/proto-uid.md"',
          exo__Asset_label: `"Practice ${todayStr}"`,
          ems__Effort_status: '"[[ems__EffortStatusDoing]]"',
          ems__Effort_startTimestamp: todayTimestamp,
        });
      });
      mockVault.getAbstractFileByPath.mockReturnValue(null);
      await expect(service.markPracticeDone("proto-uid")).rejects.toThrow(
        "File not found",
      );
    });

    it("should mark practice as done when file found", async () => {
      const protoFile = makeFile("proto.md");
      const instanceFile = makeFile("instance.md");
      mockVault.getAllFiles.mockReturnValue([protoFile, instanceFile]);
      mockVault.read.mockImplementation(async (file: IFile) => {
        if (file.path === "proto.md") {
          return makeFrontmatter({
            exo__Instance_class: '"[[ems__TaskPrototype]]"',
            exo__Asset_uid: '"proto-uid"',
            exo__Asset_label: '"Practice"',
          });
        }
        return makeFrontmatter({
          exo__Instance_class: '"[[ems__Task]]"',
          exo__Asset_prototype: '"obsidian://vault/proto-uid.md"',
          exo__Asset_label: `"Practice ${todayStr}"`,
          ems__Effort_status: '"[[ems__EffortStatusDoing]]"',
          ems__Effort_startTimestamp: todayTimestamp,
        });
      });
      const fileObj = makeFile("instance.md");
      mockVault.getAbstractFileByPath.mockReturnValue(fileObj);
      await service.markPracticeDone("proto-uid");
      expect(mockVault.modify).toHaveBeenCalled();
    });

    it("should throw when abstractFile has no basename property", async () => {
      const protoFile = makeFile("proto.md");
      const instanceFile = makeFile("instance.md");
      mockVault.getAllFiles.mockReturnValue([protoFile, instanceFile]);
      mockVault.read.mockImplementation(async (file: IFile) => {
        if (file.path === "proto.md") {
          return makeFrontmatter({
            exo__Instance_class: '"[[ems__TaskPrototype]]"',
            exo__Asset_uid: '"proto-uid"',
            exo__Asset_label: '"Practice"',
          });
        }
        return makeFrontmatter({
          exo__Instance_class: '"[[ems__Task]]"',
          exo__Asset_prototype: '"obsidian://vault/proto-uid.md"',
          exo__Asset_label: `"Practice ${todayStr}"`,
          ems__Effort_status: '"[[ems__EffortStatusDoing]]"',
          ems__Effort_startTimestamp: todayTimestamp,
        });
      });
      // Return a folder (no basename property)
      mockVault.getAbstractFileByPath.mockReturnValue({ path: "instance.md", name: "instance" } as any);
      await expect(service.markPracticeDone("proto-uid")).rejects.toThrow(
        "File not found",
      );
    });
  });

  describe("isTask helper branches", () => {
    it("should return false for null instanceClass in isTask", async () => {
      const file = makeFile("task.md");
      mockVault.getAllFiles.mockReturnValue([file]);
      mockVault.read.mockResolvedValue(makeFrontmatter({}));
      const result = await service.getDailyReviewSummary(today);
      expect(result.plannedCount).toBe(0);
    });

    it("should return false for null status in isDoneStatus", async () => {
      const file = makeFile("task.md");
      mockVault.getAllFiles.mockReturnValue([file]);
      mockVault.read.mockResolvedValue(makeFrontmatter({
        exo__Instance_class: '"[[ems__Task]]"',
        ems__Effort_startTimestamp: todayTimestamp,
      }));
      const result = await service.getDailyReviewSummary(today);
      expect(result.completedCount).toBe(0);
      expect(result.inProgressCount).toBe(0);
    });
  });
});
