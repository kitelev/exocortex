import { TestFixtureBuilder } from "./TestFixtureBuilder";

describe("TestFixtureBuilder", () => {
  beforeEach(() => {
    TestFixtureBuilder.resetFixtureCounter();
  });

  describe("task()", () => {
    it("should create task with default values", () => {
      const task = TestFixtureBuilder.task();

      expect(task.status).toBe("Draft");
      expect(task.votes).toBe(0);
      expect(task.isArchived).toBe(false);
      expect(task.path).toMatch(/^tasks\/task-.*\.md$/);
      expect(task.label).toMatch(/^Test Task /);
    });

    it("should create task with custom values", () => {
      const task = TestFixtureBuilder.task({
        label: "Custom Task",
        status: "Doing",
        size: "L",
        votes: 5,
        area: "work-area",
        parent: "project-1",
      });

      expect(task.label).toBe("Custom Task");
      expect(task.status).toBe("Doing");
      expect(task.size).toBe("L");
      expect(task.votes).toBe(5);
      expect(task.area).toBe("work-area");
      expect(task.parent).toBe("project-1");
    });

    it("should create archived task", () => {
      const task = TestFixtureBuilder.task({
        isArchived: true,
        status: "Done",
      });

      expect(task.isArchived).toBe(true);
      expect(task.status).toBe("Done");
    });

    it("should include timestamps when provided", () => {
      const now = Date.now();
      const task = TestFixtureBuilder.task({
        createdAt: now - 86400000,
        startTimestamp: now - 3600000,
        endTimestamp: now,
      });

      expect(task.createdAt).toBe(now - 86400000);
      expect(task.startTimestamp).toBe(now - 3600000);
      expect(task.endTimestamp).toBe(now);
    });
  });

  describe("project()", () => {
    it("should create project with default values", () => {
      const project = TestFixtureBuilder.project();

      expect(project.status).toBe("Draft");
      expect(project.votes).toBe(0);
      expect(project.isArchived).toBe(false);
      expect(project.path).toMatch(/^projects\/project-.*\.md$/);
    });

    it("should create project with custom values", () => {
      const project = TestFixtureBuilder.project({
        label: "My Project",
        status: "Doing",
        area: "work-area",
        votes: 10,
      });

      expect(project.label).toBe("My Project");
      expect(project.status).toBe("Doing");
      expect(project.area).toBe("work-area");
      expect(project.votes).toBe(10);
    });
  });

  describe("area()", () => {
    it("should create area with default values", () => {
      const area = TestFixtureBuilder.area();

      expect(area.isArchived).toBe(false);
      expect(area.path).toMatch(/^areas\/area-.*\.md$/);
    });

    it("should create area with parent", () => {
      const area = TestFixtureBuilder.area({
        label: "Sub Area",
        parent: "parent-area",
      });

      expect(area.label).toBe("Sub Area");
      expect(area.parent).toBe("parent-area");
    });
  });

  describe("meeting()", () => {
    it("should create meeting with default values", () => {
      const meeting = TestFixtureBuilder.meeting();

      expect(meeting.status).toBe("Draft");
      expect(meeting.path).toMatch(/^meetings\/meeting-.*\.md$/);
    });

    it("should create meeting with scheduled time", () => {
      const scheduledAt = Date.now() + 86400000;
      const meeting = TestFixtureBuilder.meeting({
        label: "Team Standup",
        scheduledAt,
      });

      expect(meeting.label).toBe("Team Standup");
      expect(meeting.scheduledAt).toBe(scheduledAt);
    });
  });

  describe("concept()", () => {
    it("should create concept with default values", () => {
      const concept = TestFixtureBuilder.concept();

      expect(concept.isArchived).toBe(false);
      expect(concept.path).toMatch(/^concepts\/concept-.*\.md$/);
    });

    it("should create concept with custom label", () => {
      const concept = TestFixtureBuilder.concept({
        label: "Design Pattern",
      });

      expect(concept.label).toBe("Design Pattern");
    });
  });

  describe("toMetadata()", () => {
    it("should convert task fixture to metadata", () => {
      const task = TestFixtureBuilder.task({
        label: "Test Task",
        status: "Doing",
        size: "M",
        votes: 3,
        area: "work",
        parent: "project-1",
      });

      const metadata = TestFixtureBuilder.toMetadata(task, "ems__Task");

      expect(metadata.exo__Instance_class).toBe("[[ems__Task]]");
      expect(metadata.exo__Asset_label).toBe("Test Task");
      expect(metadata.ems__Effort_status).toBe("[[ems__EffortStatusDoing]]");
      expect(metadata.ems__Task_size).toBe("[[ems__TaskSize_M]]");
      expect(metadata.ems__Effort_votes).toBe(3);
      expect(metadata.ems__Effort_area).toBe("[[work]]");
      expect(metadata.ems__Effort_parent).toBe("[[project-1]]");
    });

    it("should convert area fixture to metadata with correct parent property", () => {
      const area = TestFixtureBuilder.area({
        label: "Sub Area",
        parent: "parent-area",
      });

      const metadata = TestFixtureBuilder.toMetadata(area, "ems__Area");

      expect(metadata.exo__Instance_class).toBe("[[ems__Area]]");
      expect(metadata.ems__Area_parent).toBe("[[parent-area]]");
      expect(metadata.ems__Effort_parent).toBeUndefined();
    });

    it("should include timestamps in metadata", () => {
      const now = Date.now();
      const task = TestFixtureBuilder.task({
        startTimestamp: now - 3600000,
        endTimestamp: now,
      });

      const metadata = TestFixtureBuilder.toMetadata(task, "ems__Task");

      expect(metadata.ems__Effort_startTimestamp).toBe(now - 3600000);
      expect(metadata.ems__Effort_endTimestamp).toBe(now);
    });

    it("should convert all status values correctly", () => {
      const statuses = [
        "Draft",
        "Backlog",
        "Analysis",
        "To Do",
        "Doing",
        "Done",
        "Trashed",
      ] as const;

      const expectedWikilinks = [
        "[[ems__EffortStatusDraft]]",
        "[[ems__EffortStatusBacklog]]",
        "[[ems__EffortStatusAnalysis]]",
        "[[ems__EffortStatusToDo]]",
        "[[ems__EffortStatusDoing]]",
        "[[ems__EffortStatusDone]]",
        "[[ems__EffortStatusTrashed]]",
      ];

      statuses.forEach((status, index) => {
        const task = TestFixtureBuilder.task({ status });
        const metadata = TestFixtureBuilder.toMetadata(task, "ems__Task");
        expect(metadata.ems__Effort_status).toBe(expectedWikilinks[index]);
      });
    });

    it("should convert all size values correctly", () => {
      const sizes = ["XXS", "XS", "S", "M", "L", "XL"] as const;

      const expectedWikilinks = [
        "[[ems__TaskSize_XXS]]",
        "[[ems__TaskSize_XS]]",
        "[[ems__TaskSize_S]]",
        "[[ems__TaskSize_M]]",
        "[[ems__TaskSize_L]]",
        "[[ems__TaskSize_XL]]",
      ];

      sizes.forEach((size, index) => {
        const task = TestFixtureBuilder.task({ size });
        const metadata = TestFixtureBuilder.toMetadata(task, "ems__Task");
        expect(metadata.ems__Task_size).toBe(expectedWikilinks[index]);
      });
    });
  });

  describe("toTFile()", () => {
    it("should convert fixture to TFile format", () => {
      const task = TestFixtureBuilder.task({
        path: "tasks/my-task.md",
        basename: "my-task",
      });

      const tfile = TestFixtureBuilder.toTFile(task);

      expect(tfile.path).toBe("tasks/my-task.md");
      expect(tfile.name).toBe("my-task.md");
      expect(tfile.basename).toBe("my-task");
      expect(tfile.extension).toBe("md");
    });
  });

  describe("simpleVault()", () => {
    it("should create vault with basic fixtures", () => {
      const vault = TestFixtureBuilder.simpleVault();

      expect(vault.areas).toHaveLength(1);
      expect(vault.projects).toHaveLength(1);
      expect(vault.tasks).toHaveLength(3);
      expect(vault.meetings).toHaveLength(0);
      expect(vault.concepts).toHaveLength(0);
    });

    it("should create project linked to area", () => {
      const vault = TestFixtureBuilder.simpleVault();
      const project = vault.projects[0];
      const area = vault.areas[0];

      expect(project.area).toBe(area.basename);
    });

    it("should create tasks linked to project", () => {
      const vault = TestFixtureBuilder.simpleVault();
      const project = vault.projects[0];
      const linkedTasks = vault.tasks.filter((t) => t.parent === project.basename);

      expect(linkedTasks.length).toBeGreaterThan(0);
    });

    it("should include archived task", () => {
      const vault = TestFixtureBuilder.simpleVault();
      const archivedTasks = vault.tasks.filter((t) => t.isArchived);

      expect(archivedTasks).toHaveLength(1);
    });
  });

  describe("complexVault()", () => {
    it("should create vault with comprehensive fixtures", () => {
      const vault = TestFixtureBuilder.complexVault();

      expect(vault.areas.length).toBeGreaterThanOrEqual(3);
      expect(vault.projects.length).toBeGreaterThanOrEqual(3);
      expect(vault.tasks.length).toBeGreaterThanOrEqual(6);
      expect(vault.meetings.length).toBeGreaterThanOrEqual(2);
      expect(vault.concepts.length).toBeGreaterThanOrEqual(2);
    });

    it("should create area hierarchy", () => {
      const vault = TestFixtureBuilder.complexVault();
      const childAreas = vault.areas.filter((a) => a.parent);

      expect(childAreas.length).toBeGreaterThan(0);
    });

    it("should create project-task relationships", () => {
      const vault = TestFixtureBuilder.complexVault();
      const projectBasenames = vault.projects.map((p) => p.basename);
      const linkedTasks = vault.tasks.filter((t) =>
        projectBasenames.includes(t.parent || ""),
      );

      expect(linkedTasks.length).toBeGreaterThan(0);
    });
  });

  describe("withTasksByStatus()", () => {
    it("should create tasks for each status", () => {
      const statuses = ["Draft", "To Do", "Doing", "Done"] as const;
      const result = TestFixtureBuilder.withTasksByStatus([...statuses]);

      expect(result.tasks).toHaveLength(4);
      expect(result.metadata.size).toBe(4);

      statuses.forEach((status, index) => {
        expect(result.tasks[index].status).toBe(status);
      });
    });

    it("should create metadata map for each task", () => {
      const result = TestFixtureBuilder.withTasksByStatus(["Draft", "Doing"]);

      result.tasks.forEach((task) => {
        const metadata = result.metadata.get(task.path);
        expect(metadata).toBeDefined();
        expect(metadata?.exo__Instance_class).toBe("[[ems__Task]]");
      });
    });
  });

  describe("withTasksBySize()", () => {
    it("should create tasks for each size", () => {
      const sizes = ["XS", "S", "M", "L"] as const;
      const result = TestFixtureBuilder.withTasksBySize([...sizes]);

      expect(result.tasks).toHaveLength(4);
      expect(result.metadata.size).toBe(4);

      sizes.forEach((size, index) => {
        expect(result.tasks[index].size).toBe(size);
      });
    });
  });

  describe("withArchivedTasks()", () => {
    it("should create specified number of archived tasks", () => {
      const result = TestFixtureBuilder.withArchivedTasks(5);

      expect(result.tasks).toHaveLength(5);
      expect(result.tasks.every((t) => t.isArchived)).toBe(true);
      expect(result.tasks.every((t) => t.status === "Done")).toBe(true);
    });
  });

  describe("createMockFileCache()", () => {
    it("should create file cache from fixtures", () => {
      const task = TestFixtureBuilder.task({ label: "Cache Test" });
      const area = TestFixtureBuilder.area({ label: "Test Area" });

      const cache = TestFixtureBuilder.createMockFileCache([
        { fixture: task, instanceClass: "ems__Task" },
        { fixture: area, instanceClass: "ems__Area" },
      ]);

      expect(cache.size).toBe(2);
      expect(cache.get(task.path)?.frontmatter.exo__Asset_label).toBe("Cache Test");
      expect(cache.get(area.path)?.frontmatter.exo__Asset_label).toBe("Test Area");
    });
  });

  describe("resetFixtureCounter()", () => {
    it("should reset counter for deterministic fixtures", () => {
      TestFixtureBuilder.resetFixtureCounter();
      const task1 = TestFixtureBuilder.task({ basename: "first-1" });
      const task2 = TestFixtureBuilder.task({ basename: "first-2" });

      TestFixtureBuilder.resetFixtureCounter();

      const task3 = TestFixtureBuilder.task({ basename: "second-1" });
      const task4 = TestFixtureBuilder.task({ basename: "second-2" });

      expect(task1.basename).toBe("first-1");
      expect(task3.basename).toBe("second-1");
    });

    it("should allow deterministic vault creation after reset", () => {
      TestFixtureBuilder.resetFixtureCounter();
      const vault1 = TestFixtureBuilder.simpleVault();

      TestFixtureBuilder.resetFixtureCounter();
      const vault2 = TestFixtureBuilder.simpleVault();

      expect(vault1.tasks).toHaveLength(vault2.tasks.length);
      expect(vault1.projects).toHaveLength(vault2.projects.length);
      expect(vault1.areas).toHaveLength(vault2.areas.length);
    });
  });
});
