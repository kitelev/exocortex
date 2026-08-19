/**
 * Tests for factory functions.
 */

import {
  TaskFactory,
  ProjectFactory,
  AreaFactory,
  MeetingFactory,
  resetAllCounters,
} from "../src";

describe("TaskFactory", () => {
  beforeEach(() => {
    resetAllCounters();
  });

  describe("create", () => {
    it("should create a task with default values", () => {
      const task = TaskFactory.create();

      expect(task.path).toBe("tasks/task-1.md");
      expect(task.basename).toBe("task-1");
      expect(task.label).toBe("Test Task 1");
      expect(task.status).toBe("ems__EffortStatusDraft");
      expect(task.votes).toBe(0);
      expect(task.isArchived).toBe(false);
    });

    it("should create a task with custom values", () => {
      const task = TaskFactory.create({
        label: "Custom Task",
        status: "Waiting",
        votes: 5,
      });

      expect(task.label).toBe("Custom Task");
      expect(task.status).toBe("ems__EffortStatusWaiting");
      expect(task.votes).toBe(5);
    });

    it("should generate sequential IDs", () => {
      const task1 = TaskFactory.create();
      const task2 = TaskFactory.create();
      const task3 = TaskFactory.create();

      expect(task1.basename).toBe("task-1");
      expect(task2.basename).toBe("task-2");
      expect(task3.basename).toBe("task-3");
    });
  });

  describe("createMany", () => {
    it("should create multiple tasks", () => {
      const tasks = TaskFactory.createMany(3);

      expect(tasks).toHaveLength(3);
      expect(tasks[0].basename).toBe("task-1");
      expect(tasks[1].basename).toBe("task-2");
      expect(tasks[2].basename).toBe("task-3");
    });

    it("should apply overrides to all tasks", () => {
      const tasks = TaskFactory.createMany(3, { status: "Doing" });

      expect(tasks[0].status).toBe("ems__EffortStatusDoing");
      expect(tasks[1].status).toBe("ems__EffortStatusDoing");
      expect(tasks[2].status).toBe("ems__EffortStatusDoing");
    });
  });

  describe("status convenience methods", () => {
    it("should create draft task", () => {
      const task = TaskFactory.draft();
      expect(task.status).toBe("ems__EffortStatusDraft");
    });

    it("should create backlog task", () => {
      const task = TaskFactory.backlog();
      expect(task.status).toBe("ems__EffortStatusBacklog");
    });

    it("should create waiting task", () => {
      const task = TaskFactory.waiting();
      expect(task.status).toBe("ems__EffortStatusWaiting");
    });

    it("should create doing task with startTimestamp", () => {
      const task = TaskFactory.doing();
      expect(task.status).toBe("ems__EffortStatusDoing");
      expect(task.startTimestamp).toBeDefined();
    });

    it("should create done task with timestamps", () => {
      const task = TaskFactory.done();
      expect(task.status).toBe("ems__EffortStatusDone");
      expect(task.startTimestamp).toBeDefined();
      expect(task.endTimestamp).toBeDefined();
    });

    it("should create trashed task", () => {
      const task = TaskFactory.trashed();
      expect(task.status).toBe("ems__EffortStatusTrashed");
    });

    it("should create archived task", () => {
      const task = TaskFactory.archived();
      expect(task.status).toBe("ems__EffortStatusDone");
      expect(task.isArchived).toBe(true);
    });
  });

  describe("relationship methods", () => {
    it("should create task with parent", () => {
      const task = TaskFactory.withParent("project-1");
      expect(task.parent).toBe("project-1");
    });

    it("should create task in area", () => {
      const task = TaskFactory.inArea("work-area");
      expect(task.area).toBe("work-area");
    });

    it("should create task for day", () => {
      const task = TaskFactory.forDay("2024-01-15");
      expect(task.day).toBe("2024-01-15");
    });
  });

  describe("createDailyTask", () => {
    it("should create a DailyTask with correct structure", () => {
      const dailyTask = TaskFactory.createDailyTask();

      expect(dailyTask.file).toBeDefined();
      expect(dailyTask.file.path).toBe(dailyTask.path);
      expect(dailyTask.status).toBe("ems__EffortStatusDraft");
      expect(dailyTask.isDone).toBe(false);
      expect(dailyTask.isTrashed).toBe(false);
      expect(dailyTask.isDoing).toBe(false);
      expect(dailyTask.isMeeting).toBe(false);
      expect(dailyTask.isBlocked).toBe(false);
    });

    it("should create DailyTask with Doing status", () => {
      const dailyTask = TaskFactory.dailyTaskDoing();

      expect(dailyTask.status).toBe("ems__EffortStatusDoing");
      expect(dailyTask.isDoing).toBe(true);
      expect(dailyTask.startTime).toBe("09:00");
    });

    it("should create DailyTask with Done status", () => {
      const dailyTask = TaskFactory.dailyTaskDone();

      expect(dailyTask.status).toBe("ems__EffortStatusDone");
      expect(dailyTask.isDone).toBe(true);
    });

    it("should create blocked DailyTask", () => {
      const dailyTask = TaskFactory.dailyTaskBlocked();

      expect(dailyTask.isBlocked).toBe(true);
    });

    it("should create meeting DailyTask", () => {
      const dailyTask = TaskFactory.dailyTaskMeeting();

      expect(dailyTask.isMeeting).toBe(true);
      expect(dailyTask.startTime).toBe("14:00");
      expect(dailyTask.endTime).toBe("15:00");
    });
  });

  describe("toMetadata", () => {
    it("should convert task fixture to metadata format", () => {
      const task = TaskFactory.create({
        label: "Test",
        status: "Waiting",
        votes: 3,
        size: "M",
        area: "work-area",
        parent: "project-1",
      });

      const metadata = TaskFactory.toMetadata(task);

      expect(metadata.exo__Instance_class).toBe("[[ems__Task]]");
      expect(metadata.exo__Asset_label).toBe("Test");
      expect(metadata.ems__Effort_status).toBe("[[ems__EffortStatusWaiting]]");
      expect(metadata.ems__Effort_votes).toBe(3);
      expect(metadata.ems__Task_size).toBe("[[ems__TaskSize_M]]");
      expect(metadata.ems__Effort_area).toBe("[[work-area]]");
      expect(metadata.ems__Effort_parent).toBe("[[project-1]]");
    });
  });

  describe("toFile", () => {
    it("should convert task fixture to TFile-like object", () => {
      const task = TaskFactory.create({ basename: "my-task" });
      const file = TaskFactory.toFile(task);

      expect(file.path).toBe(task.path);
      expect(file.basename).toBe("my-task");
      expect(file.name).toBe("my-task.md");
      expect(file.extension).toBe("md");
    });
  });
});

describe("ProjectFactory", () => {
  beforeEach(() => {
    resetAllCounters();
  });

  it("should create a project with default values", () => {
    const project = ProjectFactory.create();

    expect(project.path).toBe("projects/project-1.md");
    expect(project.basename).toBe("project-1");
    expect(project.label).toBe("Test Project 1");
    expect(project.status).toBe("ems__EffortStatusDraft");
  });

  it("should create project with custom status", () => {
    const project = ProjectFactory.doing();
    expect(project.status).toBe("ems__EffortStatusDoing");
  });

  it("should convert project to metadata", () => {
    const project = ProjectFactory.create({ label: "My Project", area: "work" });
    const metadata = ProjectFactory.toMetadata(project);

    expect(metadata.exo__Instance_class).toBe("[[ems__Project]]");
    expect(metadata.exo__Asset_label).toBe("My Project");
    expect(metadata.ems__Effort_area).toBe("[[work]]");
  });
});

describe("AreaFactory", () => {
  beforeEach(() => {
    resetAllCounters();
  });

  it("should create an area with default values", () => {
    const area = AreaFactory.create();

    expect(area.path).toBe("areas/area-1.md");
    expect(area.basename).toBe("area-1");
    expect(area.label).toBe("Test Area 1");
    expect(area.isArchived).toBe(false);
  });

  it("should create area with parent", () => {
    const area = AreaFactory.withParent("parent-area");
    expect(area.parent).toBe("parent-area");
  });

  it("should create work area", () => {
    const area = AreaFactory.work();
    expect(area.label).toBe("Work");
    expect(area.basename).toBe("work-area");
  });

  it("should create personal area", () => {
    const area = AreaFactory.personal();
    expect(area.label).toBe("Personal");
    expect(area.basename).toBe("personal-area");
  });

  it("should create area hierarchy", () => {
    const { root, child1, child2, grandchild } = AreaFactory.hierarchy();

    expect(root.parent).toBeUndefined();
    expect(child1.parent).toBe(root.basename);
    expect(child2.parent).toBe(root.basename);
    expect(grandchild.parent).toBe(child1.basename);
  });

  it("should convert area to metadata", () => {
    const area = AreaFactory.withParent("parent-area", { label: "Sub Area" });
    const metadata = AreaFactory.toMetadata(area);

    expect(metadata.exo__Instance_class).toBe("[[ems__Area]]");
    expect(metadata.exo__Asset_label).toBe("Sub Area");
    expect(metadata.ems__Area_parent).toBe("[[parent-area]]");
  });
});

describe("MeetingFactory", () => {
  beforeEach(() => {
    resetAllCounters();
  });

  it("should create a meeting with default values", () => {
    const meeting = MeetingFactory.create();

    expect(meeting.path).toBe("meetings/meeting-1.md");
    expect(meeting.basename).toBe("meeting-1");
    expect(meeting.label).toBe("Test Meeting 1");
  });

  it("should create scheduled meeting", () => {
    const scheduledAt = Date.now() + 86400000; // tomorrow
    const meeting = MeetingFactory.scheduled(scheduledAt);

    expect(meeting.status).toBe("ems__EffortStatusBacklog");
    expect(meeting.scheduledAt).toBe(scheduledAt);
  });

  it("should create meeting for today", () => {
    const meeting = MeetingFactory.today();

    expect(meeting.scheduledAt).toBeDefined();
    const scheduledDate = new Date(meeting.scheduledAt!);
    const today = new Date();
    expect(scheduledDate.getDate()).toBe(today.getDate());
  });

  it("should create done meeting", () => {
    const meeting = MeetingFactory.done();

    expect(meeting.status).toBe("ems__EffortStatusDone");
    expect(meeting.startTimestamp).toBeDefined();
    expect(meeting.endTimestamp).toBeDefined();
  });

  it("should create DailyMeeting", () => {
    const dailyMeeting = MeetingFactory.createDailyMeeting();

    expect(dailyMeeting.isMeeting).toBe(true);
    expect(dailyMeeting.startTime).toBe("14:00");
    expect(dailyMeeting.endTime).toBe("15:00");
  });

  it("should convert meeting to metadata", () => {
    const meeting = MeetingFactory.scheduled(Date.now(), { parent: "project-1" });
    const metadata = MeetingFactory.toMetadata(meeting);

    expect(metadata.exo__Instance_class).toBe("[[ems__Meeting]]");
    expect(metadata.ems__Meeting_scheduledAt).toBeDefined();
    expect(metadata.ems__Effort_parent).toBe("[[project-1]]");
  });
});

describe("resetAllCounters", () => {
  it("should reset all factory counters", () => {
    // Create some items
    TaskFactory.create();
    TaskFactory.create();
    ProjectFactory.create();
    AreaFactory.create();
    MeetingFactory.create();

    // Reset
    resetAllCounters();

    // New items should start from 1
    const task = TaskFactory.create();
    const project = ProjectFactory.create();
    const area = AreaFactory.create();
    const meeting = MeetingFactory.create();

    expect(task.basename).toBe("task-1");
    expect(project.basename).toBe("project-1");
    expect(area.basename).toBe("area-1");
    expect(meeting.basename).toBe("meeting-1");
  });
});
