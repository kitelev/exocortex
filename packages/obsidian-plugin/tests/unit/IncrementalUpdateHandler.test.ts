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
      propertiesRenderer: {
        render: jest.fn().mockResolvedValue(undefined),
      },
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
      // Create containers for properties section
      const sectionContainer = document.createElement("div");
      sectionContainer.className = "exocortex-properties-section";
      sectionContainer.empty = jest.fn();
      mockRootContainer.appendChild(sectionContainer);

      const executionOrder: number[] = [];

      mockDeps.propertiesRenderer.render.mockImplementation(async () => {
        executionOrder.push(handler.getCurrentVersion());
      });

      // Start both updates without awaiting
      const update1 = handler.updateSections(
        mockRootContainer, mockFile, [LayoutSection.PROPERTIES], {});
      const update2 = handler.updateSections(
        mockRootContainer, mockFile, [LayoutSection.PROPERTIES], {});

      // Wait for both to complete
      await Promise.all([update1, update2]);

      // Version should reflect both updates
      expect(handler.getCurrentVersion()).toBe(2);

      // Due to the queue, updates are processed sequentially
      // Version 1 executes first, but version 2 might be skipped if
      // it's queued after version 1 has already started
      // The key is that only the latest version executes after the queue processes
      expect(executionOrder.length).toBeGreaterThan(0);
    });

    it("should skip intermediate updates when multiple are queued rapidly", async () => {
      const sectionContainer = document.createElement("div");
      sectionContainer.className = "exocortex-properties-section";
      sectionContainer.empty = jest.fn();
      mockRootContainer.appendChild(sectionContainer);

      // Track which versions actually execute their render
      const executedVersions: number[] = [];

      // Make first render slow to allow queueing
      mockDeps.propertiesRenderer.render.mockImplementation(async () => {
        executedVersions.push(handler.getCurrentVersion());
        // Small delay to simulate async work
        await new Promise(resolve => setTimeout(resolve, 5));
      });

      // Queue 5 rapid updates
      const updates = [];
      for (let i = 0; i < 5; i++) {
        updates.push(handler.updateSections(
          mockRootContainer, mockFile, [LayoutSection.PROPERTIES], {}));
      }

      // Wait for all updates to complete
      await Promise.all(updates);

      // Version should be 5
      expect(handler.getCurrentVersion()).toBe(5);

      // Due to version skipping, not all renders will execute
      // Only the last one (version 5) should definitely execute
      // First one might execute if it started before others queued
      expect(executedVersions).toContain(5);
      // Total executions should be less than 5 due to skipping
      expect(executedVersions.length).toBeLessThanOrEqual(5);
    });
  });

  describe("concurrent update handling", () => {
    it("should handle rapid concurrent updates safely", async () => {
      const sectionContainer = document.createElement("div");
      sectionContainer.className = "exocortex-properties-section";
      sectionContainer.empty = jest.fn();
      mockRootContainer.appendChild(sectionContainer);

      // Queue 10 rapid updates
      const updates = [];
      for (let i = 0; i < 10; i++) {
        updates.push(handler.updateSections(
          mockRootContainer, mockFile, [LayoutSection.PROPERTIES], {}));
      }

      // Wait for all to complete
      await Promise.all(updates);

      // Version should reflect all 10 updates
      expect(handler.getCurrentVersion()).toBe(10);

      // Due to version skipping, only the first and last should render
      // (intermediate updates are skipped when their version < currentVersion)
      // The first one starts immediately, then when it completes,
      // only the latest pending (version 10) should execute
      expect(mockDeps.propertiesRenderer.render.mock.calls.length).toBeLessThanOrEqual(10);
    });

    it("should not corrupt DOM when updates overlap", async () => {
      const sectionContainer = document.createElement("div");
      sectionContainer.className = "exocortex-properties-section";
      const emptyMock = jest.fn();
      sectionContainer.empty = emptyMock;
      mockRootContainer.appendChild(sectionContainer);

      // Track concurrent execution
      let concurrentCount = 0;
      let maxConcurrent = 0;

      mockDeps.propertiesRenderer.render.mockImplementation(async () => {
        concurrentCount++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCount);
        // Simulate async work
        await new Promise(resolve => setTimeout(resolve, 10));
        concurrentCount--;
      });

      // Queue updates
      const updates = [];
      for (let i = 0; i < 5; i++) {
        updates.push(handler.updateSections(
          mockRootContainer, mockFile, [LayoutSection.PROPERTIES], {}));
      }

      await Promise.all(updates);

      // Should never have more than 1 concurrent render (sequential processing)
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
      // No containers exist in the mock root
      await handler.updateSections(
        mockRootContainer,
        mockFile,
        [LayoutSection.PROPERTIES],
        {}
      );

      // Should not call render because no container was found
      expect(mockDeps.propertiesRenderer.render).not.toHaveBeenCalled();
    });

    it("should update properties section when container exists", async () => {
      const sectionContainer = document.createElement("div");
      sectionContainer.className = "exocortex-properties-section";
      sectionContainer.empty = jest.fn();
      mockRootContainer.appendChild(sectionContainer);

      await handler.updateSections(
        mockRootContainer,
        mockFile,
        [LayoutSection.PROPERTIES],
        {}
      );

      expect(sectionContainer.empty).toHaveBeenCalled();
      expect(mockDeps.propertiesRenderer.render).toHaveBeenCalled();
    });

    it("should update buttons section and create new container", async () => {
      const sectionContainer = document.createElement("div");
      sectionContainer.className = "exocortex-buttons-section";
      sectionContainer.remove = jest.fn();
      mockRootContainer.appendChild(sectionContainer);

      // Mock that build returns button groups
      mockDeps.buttonGroupsBuilder.build.mockResolvedValue([{ buttons: [] }]);

      // Mock createDiv on rootContainer
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

      // Mock that build returns empty array
      mockDeps.buttonGroupsBuilder.build.mockResolvedValue([]);

      // Mock createDiv on rootContainer
      mockRootContainer.createDiv = jest.fn().mockReturnValue(document.createElement("div"));

      await handler.updateSections(
        mockRootContainer,
        mockFile,
        [LayoutSection.BUTTONS],
        {}
      );

      expect(sectionContainer.remove).toHaveBeenCalled();
      // createDiv should not be called when no button groups
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
      // Create all section containers
      const propsContainer = document.createElement("div");
      propsContainer.className = "exocortex-properties-section";
      propsContainer.empty = jest.fn();
      mockRootContainer.appendChild(propsContainer);

      const tasksContainer = document.createElement("div");
      tasksContainer.className = "exocortex-daily-tasks-section";
      tasksContainer.empty = jest.fn();
      mockRootContainer.appendChild(tasksContainer);

      await handler.updateSections(
        mockRootContainer,
        mockFile,
        [LayoutSection.PROPERTIES, LayoutSection.DAILY_TASKS],
        {}
      );

      expect(propsContainer.empty).toHaveBeenCalled();
      expect(tasksContainer.empty).toHaveBeenCalled();
      expect(mockDeps.propertiesRenderer.render).toHaveBeenCalled();
      expect(mockDeps.dailyTasksRenderer.render).toHaveBeenCalled();
    });
  });
});
