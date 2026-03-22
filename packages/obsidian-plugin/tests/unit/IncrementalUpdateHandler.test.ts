import "reflect-metadata";
import { IncrementalUpdateHandler } from "../../src/presentation/renderers/helpers/IncrementalUpdateHandler";
import { LayoutSection } from "../../src/application/services/PropertyDependencyResolver";

describe("IncrementalUpdateHandler", () => {
  let mockDeps: any;
  let handler: IncrementalUpdateHandler;
  let mockRootContainer: HTMLElement;
  let mockFile: any;

  beforeEach(() => {
    mockFile = {
      path: "test.md",
      basename: "test",
    };

    mockRootContainer = document.createElement("div");

    mockDeps = {
      buttonGroupsBuilder: {
        build: jest.fn().mockResolvedValue([]),
      },
      dailyTasksRenderer: {
        render: jest.fn().mockResolvedValue(undefined),
      },
      areaTreeRenderer: {
        render: jest.fn().mockResolvedValue(undefined),
      },
      relationsRenderer: {
        render: jest.fn().mockResolvedValue(undefined),
        getAssetRelations: jest.fn().mockResolvedValue([]),
      },
      reactRenderer: {
        render: jest.fn(),
      },
      backlinksCacheManager: {
        getBacklinks: jest.fn().mockReturnValue(new Map()),
      },
      sectionStateManager: {
        isCollapsed: jest.fn().mockReturnValue(false),
        renderHeader: jest.fn(),
      },
      eventListenerManager: {},
    };

    handler = new IncrementalUpdateHandler(mockDeps);
  });

  describe("version tracking", () => {
    it("should increment version on each updateSections call", async () => {
      expect(handler.getCurrentVersion()).toBe(0);

      await handler.updateSections(mockRootContainer, mockFile, [], {});
      expect(handler.getCurrentVersion()).toBe(1);

      await handler.updateSections(mockRootContainer, mockFile, [], {});
      expect(handler.getCurrentVersion()).toBe(2);
    });
  });

  describe("queue mechanism", () => {
    it("should process updates sequentially and track versions", async () => {
      const sectionContainer = document.createElement("div");
      sectionContainer.className = "exocortex-daily-tasks-section";
      sectionContainer.empty = jest.fn();
      mockRootContainer.appendChild(sectionContainer);

      const executionOrder: number[] = [];

      mockDeps.dailyTasksRenderer.render.mockImplementation(async () => {
        executionOrder.push(handler.getCurrentVersion());
      });

      const update1 = handler.updateSections(
        mockRootContainer, mockFile, [LayoutSection.DAILY_TASKS], {});
      const update2 = handler.updateSections(
        mockRootContainer, mockFile, [LayoutSection.DAILY_TASKS], {});

      await Promise.all([update1, update2]);

      expect(handler.getCurrentVersion()).toBe(2);
      expect(executionOrder.length).toBeGreaterThan(0);
    });

    it("should skip intermediate updates when multiple are queued rapidly", async () => {
      const sectionContainer = document.createElement("div");
      sectionContainer.className = "exocortex-daily-tasks-section";
      sectionContainer.empty = jest.fn();
      mockRootContainer.appendChild(sectionContainer);

      const executedVersions: number[] = [];

      mockDeps.dailyTasksRenderer.render.mockImplementation(async () => {
        executedVersions.push(handler.getCurrentVersion());
        await new Promise(resolve => setTimeout(resolve, 5));
      });

      const updates = [];
      for (let i = 0; i < 5; i++) {
        updates.push(handler.updateSections(
          mockRootContainer, mockFile, [LayoutSection.DAILY_TASKS], {}));
      }

      await Promise.all(updates);

      expect(handler.getCurrentVersion()).toBe(5);
      expect(executedVersions).toContain(5);
      expect(executedVersions.length).toBeLessThanOrEqual(5);
    });
  });

  describe("concurrent update handling", () => {
    it("should handle rapid concurrent updates safely", async () => {
      const sectionContainer = document.createElement("div");
      sectionContainer.className = "exocortex-daily-tasks-section";
      sectionContainer.empty = jest.fn();
      mockRootContainer.appendChild(sectionContainer);

      const updates = [];
      for (let i = 0; i < 10; i++) {
        updates.push(handler.updateSections(
          mockRootContainer, mockFile, [LayoutSection.DAILY_TASKS], {}));
      }

      await Promise.all(updates);

      expect(handler.getCurrentVersion()).toBe(10);
      expect(mockDeps.dailyTasksRenderer.render.mock.calls.length).toBeLessThanOrEqual(10);
    });

    it("should not corrupt DOM when updates overlap", async () => {
      const sectionContainer = document.createElement("div");
      sectionContainer.className = "exocortex-daily-tasks-section";
      const emptyMock = jest.fn();
      sectionContainer.empty = emptyMock;
      mockRootContainer.appendChild(sectionContainer);

      let concurrentCount = 0;
      let maxConcurrent = 0;

      mockDeps.dailyTasksRenderer.render.mockImplementation(async () => {
        concurrentCount++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCount);
        await new Promise(resolve => setTimeout(resolve, 10));
        concurrentCount--;
      });

      const updates = [];
      for (let i = 0; i < 5; i++) {
        updates.push(handler.updateSections(
          mockRootContainer, mockFile, [LayoutSection.DAILY_TASKS], {}));
      }

      await Promise.all(updates);

      expect(maxConcurrent).toBe(1);
    });
  });

  describe("updateSections", () => {
    it("should handle empty sections array", async () => {
      await expect(
        handler.updateSections(mockRootContainer, mockFile, [], {})
      ).resolves.toBeUndefined();
    });

    it("should skip sections without matching containers", async () => {
      await handler.updateSections(
        mockRootContainer,
        mockFile,
        [LayoutSection.BUTTONS],
        {}
      );

      expect(mockDeps.buttonGroupsBuilder.build).not.toHaveBeenCalled();
    });

    it("should update buttons section and create new container", async () => {
      const sectionContainer = document.createElement("div");
      sectionContainer.className = "exocortex-buttons-section";
      sectionContainer.remove = jest.fn();
      mockRootContainer.appendChild(sectionContainer);

      mockDeps.buttonGroupsBuilder.build.mockResolvedValue([{ buttons: [] }]);
      mockRootContainer.createDiv = jest.fn().mockReturnValue(document.createElement("div"));

      await handler.updateSections(
        mockRootContainer,
        mockFile,
        [LayoutSection.BUTTONS],
        {}
      );

      expect(sectionContainer.remove).toHaveBeenCalled();
      expect(mockDeps.buttonGroupsBuilder.build).toHaveBeenCalledWith(mockFile);
    });

    it("should not create buttons container when no button groups", async () => {
      const sectionContainer = document.createElement("div");
      sectionContainer.className = "exocortex-buttons-section";
      sectionContainer.remove = jest.fn();
      mockRootContainer.appendChild(sectionContainer);

      mockDeps.buttonGroupsBuilder.build.mockResolvedValue([]);
      mockRootContainer.createDiv = jest.fn().mockReturnValue(document.createElement("div"));

      await handler.updateSections(
        mockRootContainer,
        mockFile,
        [LayoutSection.BUTTONS],
        {}
      );

      expect(sectionContainer.remove).toHaveBeenCalled();
      expect(mockRootContainer.createDiv).not.toHaveBeenCalled();
    });

    it("should update daily tasks section", async () => {
      const sectionContainer = document.createElement("div");
      sectionContainer.className = "exocortex-daily-tasks-section";
      sectionContainer.empty = jest.fn();
      mockRootContainer.appendChild(sectionContainer);

      await handler.updateSections(
        mockRootContainer,
        mockFile,
        [LayoutSection.DAILY_TASKS],
        {}
      );

      expect(sectionContainer.empty).toHaveBeenCalled();
      expect(mockDeps.dailyTasksRenderer.render).toHaveBeenCalled();
    });

    it("should update area tree section", async () => {
      const sectionContainer = document.createElement("div");
      sectionContainer.className = "exocortex-area-tree-section";
      sectionContainer.empty = jest.fn();
      mockRootContainer.appendChild(sectionContainer);

      await handler.updateSections(
        mockRootContainer,
        mockFile,
        [LayoutSection.AREA_TREE],
        {}
      );

      expect(sectionContainer.empty).toHaveBeenCalled();
      expect(mockDeps.areaTreeRenderer.render).toHaveBeenCalled();
    });

    it("should update relations section", async () => {
      const sectionContainer = document.createElement("div");
      sectionContainer.className = "exocortex-assets-relations";
      sectionContainer.empty = jest.fn();
      mockRootContainer.appendChild(sectionContainer);

      await handler.updateSections(
        mockRootContainer,
        mockFile,
        [LayoutSection.RELATIONS],
        {}
      );

      expect(sectionContainer.empty).toHaveBeenCalled();
      expect(mockDeps.relationsRenderer.render).toHaveBeenCalled();
    });

    it("should update multiple sections in sequence", async () => {
      const buttonsContainer = document.createElement("div");
      buttonsContainer.className = "exocortex-buttons-section";
      buttonsContainer.remove = jest.fn();
      mockRootContainer.appendChild(buttonsContainer);

      const tasksContainer = document.createElement("div");
      tasksContainer.className = "exocortex-daily-tasks-section";
      tasksContainer.empty = jest.fn();
      mockRootContainer.appendChild(tasksContainer);

      mockDeps.buttonGroupsBuilder.build.mockResolvedValue([]);
      mockRootContainer.createDiv = jest.fn().mockReturnValue(document.createElement("div"));

      await handler.updateSections(
        mockRootContainer,
        mockFile,
        [LayoutSection.BUTTONS, LayoutSection.DAILY_TASKS],
        {}
      );

      expect(buttonsContainer.remove).toHaveBeenCalled();
      expect(tasksContainer.empty).toHaveBeenCalled();
      expect(mockDeps.dailyTasksRenderer.render).toHaveBeenCalled();
    });
  });
});
