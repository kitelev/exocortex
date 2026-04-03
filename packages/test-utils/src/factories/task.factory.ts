/**
 * Task factory for creating test data.
 *
 * @example
 * // Simple task
 * const task = TaskFactory.create();
 *
 * // Task with specific status
 * const doingTask = TaskFactory.doing();
 *
 * // Task with custom properties
 * const customTask = TaskFactory.create({
 *   label: "Custom Task",
 *   status: "To Do",
 *   votes: 5,
 * });
 *
 * // DailyTask for React components
 * const dailyTask = TaskFactory.createDailyTask();
 *
 * // Multiple tasks
 * const tasks = TaskFactory.createMany(5);
 */

import type {
  TaskFixture,
  DailyTask,
  EffortStatus,
  EffortStatusName,
  TaskSize,
  FileInfo,
  Metadata,
} from "../types";
import {
  STATUS_MAP,
  normalizeStatus,
  isDoneStatus,
  isTrashedStatus,
  isDoingStatus,
} from "../helpers/status.helpers";

let taskCounter = 0;

/**
 * Reset the task counter. Call this in beforeEach() to ensure deterministic IDs.
 */
export function resetTaskCounter(): void {
  taskCounter = 0;
}

/**
 * Map task sizes to wikilink format.
 */
const SIZE_MAP: Record<TaskSize, string> = {
  XXS: "[[ems__TaskSize_XXS]]",
  XS: "[[ems__TaskSize_XS]]",
  S: "[[ems__TaskSize_S]]",
  M: "[[ems__TaskSize_M]]",
  L: "[[ems__TaskSize_L]]",
  XL: "[[ems__TaskSize_XL]]",
};

/**
 * Generate a unique ID for tasks.
 */
function generateId(): string {
  taskCounter++;
  return `task-${taskCounter}`;
}

/**
 * Default task fixture values.
 */
const DEFAULT_TASK: Omit<TaskFixture, "path" | "basename" | "label"> = {
  status: "ems__EffortStatusDraft",
  votes: 0,
  isArchived: false,
  createdAt: Date.now(),
};

/**
 * Task factory for creating test fixtures.
 */
export const TaskFactory = {
  /**
   * Create a task fixture with optional overrides.
   */
  create(overrides: Partial<TaskFixture> = {}): TaskFixture {
    const id = generateId();
    const basename = overrides.basename ?? id;
    const normalizedStatus = normalizeStatus(
      overrides.status ?? DEFAULT_TASK.status
    );

    return {
      path: overrides.path ?? `tasks/${basename}.md`,
      basename,
      label: overrides.label ?? `Test Task ${taskCounter}`,
      status: normalizedStatus,
      size: overrides.size,
      votes: overrides.votes ?? DEFAULT_TASK.votes,
      area: overrides.area,
      parent: overrides.parent,
      day: overrides.day,
      isArchived: overrides.isArchived ?? DEFAULT_TASK.isArchived,
      createdAt: overrides.createdAt ?? DEFAULT_TASK.createdAt,
      startTimestamp: overrides.startTimestamp,
      endTimestamp: overrides.endTimestamp,
      blockers: overrides.blockers,
    };
  },

  /**
   * Create multiple task fixtures.
   */
  createMany(count: number, overrides: Partial<TaskFixture> = {}): TaskFixture[] {
    return Array.from({ length: count }, () => TaskFactory.create(overrides));
  },

  // Convenience methods for common states

  /**
   * Create a Draft task.
   */
  draft(overrides: Partial<TaskFixture> = {}): TaskFixture {
    return TaskFactory.create({ status: "Draft", ...overrides });
  },

  /**
   * Create a Backlog task.
   */
  backlog(overrides: Partial<TaskFixture> = {}): TaskFixture {
    return TaskFactory.create({ status: "Backlog", ...overrides });
  },

  /**
   * Create an Analysis task.
   */
  analysis(overrides: Partial<TaskFixture> = {}): TaskFixture {
    return TaskFactory.create({ status: "Analysis", ...overrides });
  },

  /**
   * Create a To Do task.
   */
  todo(overrides: Partial<TaskFixture> = {}): TaskFixture {
    return TaskFactory.create({ status: "To Do", ...overrides });
  },

  /**
   * Create a Doing task with start timestamp.
   */
  doing(overrides: Partial<TaskFixture> = {}): TaskFixture {
    return TaskFactory.create({
      status: "Doing",
      startTimestamp: overrides.startTimestamp ?? Date.now(),
      ...overrides,
    });
  },

  /**
   * Create a Done task with start and end timestamps.
   */
  done(overrides: Partial<TaskFixture> = {}): TaskFixture {
    const startTimestamp = overrides.startTimestamp ?? Date.now() - 3600000; // 1 hour ago
    return TaskFactory.create({
      status: "Done",
      startTimestamp,
      endTimestamp: overrides.endTimestamp ?? Date.now(),
      ...overrides,
    });
  },

  /**
   * Create a Trashed task.
   */
  trashed(overrides: Partial<TaskFixture> = {}): TaskFixture {
    return TaskFactory.create({ status: "Trashed", ...overrides });
  },

  /**
   * Create an archived task (Done + isArchived).
   */
  archived(overrides: Partial<TaskFixture> = {}): TaskFixture {
    return TaskFactory.done({ isArchived: true, ...overrides });
  },

  /**
   * Create a blocked task.
   */
  blocked(overrides: Partial<TaskFixture> = {}): TaskFixture {
    const blockerTask = TaskFactory.create();
    return TaskFactory.create({
      blockers: [blockerTask.path],
      ...overrides,
    });
  },

  /**
   * Create a task with a specific size.
   */
  withSize(size: TaskSize, overrides: Partial<TaskFixture> = {}): TaskFixture {
    return TaskFactory.create({ size, ...overrides });
  },

  /**
   * Create a task with votes.
   */
  withVotes(votes: number, overrides: Partial<TaskFixture> = {}): TaskFixture {
    return TaskFactory.create({ votes, ...overrides });
  },

  /**
   * Create a task under a parent project.
   */
  withParent(parent: string, overrides: Partial<TaskFixture> = {}): TaskFixture {
    return TaskFactory.create({ parent, ...overrides });
  },

  /**
   * Create a task in an area.
   */
  inArea(area: string, overrides: Partial<TaskFixture> = {}): TaskFixture {
    return TaskFactory.create({ area, ...overrides });
  },

  /**
   * Create a task scheduled for a specific day.
   */
  forDay(day: string, overrides: Partial<TaskFixture> = {}): TaskFixture {
    return TaskFactory.create({ day, ...overrides });
  },

  // DailyTask factory methods for React component tests

  /**
   * Create a DailyTask for React component tests.
   */
  createDailyTask(overrides: Partial<DailyTask> = {}): DailyTask {
    const id = generateId();
    const basename = overrides.file?.basename ?? id;
    const path = overrides.path ?? overrides.file?.path ?? `tasks/${basename}.md`;
    const status = overrides.status ?? "ems__EffortStatusDraft";
    const normalizedStatus = status.startsWith("ems__")
      ? status
      : STATUS_MAP[status as EffortStatusName] ?? "ems__EffortStatusDraft";

    return {
      file: {
        path,
        basename,
        ...overrides.file,
      },
      path,
      title: overrides.title ?? basename,
      label: overrides.label ?? `Test Task ${taskCounter}`,
      startTime: overrides.startTime ?? "",
      endTime: overrides.endTime ?? "",
      startTimestamp: overrides.startTimestamp ?? null,
      endTimestamp: overrides.endTimestamp ?? null,
      status: normalizedStatus,
      metadata: overrides.metadata ?? {},
      isDone: overrides.isDone ?? isDoneStatus(normalizedStatus as EffortStatus),
      isTrashed: overrides.isTrashed ?? isTrashedStatus(normalizedStatus as EffortStatus),
      isDoing: overrides.isDoing ?? isDoingStatus(normalizedStatus as EffortStatus),
      isMeeting: overrides.isMeeting ?? false,
      isBlocked: overrides.isBlocked ?? false,
      isEmptySlot: overrides.isEmptySlot,
    };
  },

  /**
   * Create multiple DailyTasks for React component tests.
   */
  createManyDailyTasks(
    count: number,
    overrides: Partial<DailyTask> = {}
  ): DailyTask[] {
    return Array.from({ length: count }, () =>
      TaskFactory.createDailyTask(overrides)
    );
  },

  // DailyTask convenience methods

  /**
   * Create a DailyTask with Doing status.
   */
  dailyTaskDoing(overrides: Partial<DailyTask> = {}): DailyTask {
    return TaskFactory.createDailyTask({
      status: "ems__EffortStatusDoing",
      isDoing: true,
      startTime: overrides.startTime ?? "09:00",
      startTimestamp: overrides.startTimestamp ?? Date.now(),
      ...overrides,
    });
  },

  /**
   * Create a DailyTask with Done status.
   */
  dailyTaskDone(overrides: Partial<DailyTask> = {}): DailyTask {
    return TaskFactory.createDailyTask({
      status: "ems__EffortStatusDone",
      isDone: true,
      startTime: overrides.startTime ?? "09:00",
      endTime: overrides.endTime ?? "10:00",
      startTimestamp: overrides.startTimestamp ?? Date.now() - 3600000,
      endTimestamp: overrides.endTimestamp ?? Date.now(),
      ...overrides,
    });
  },

  /**
   * Create a DailyTask with Trashed status.
   */
  dailyTaskTrashed(overrides: Partial<DailyTask> = {}): DailyTask {
    return TaskFactory.createDailyTask({
      status: "ems__EffortStatusTrashed",
      isTrashed: true,
      ...overrides,
    });
  },

  /**
   * Create a DailyTask that is a meeting.
   */
  dailyTaskMeeting(overrides: Partial<DailyTask> = {}): DailyTask {
    return TaskFactory.createDailyTask({
      isMeeting: true,
      startTime: overrides.startTime ?? "14:00",
      endTime: overrides.endTime ?? "15:00",
      ...overrides,
    });
  },

  /**
   * Create a blocked DailyTask.
   */
  dailyTaskBlocked(overrides: Partial<DailyTask> = {}): DailyTask {
    return TaskFactory.createDailyTask({
      isBlocked: true,
      ...overrides,
    });
  },

  /**
   * Create an empty slot DailyTask.
   */
  dailyTaskEmptySlot(overrides: Partial<DailyTask> = {}): DailyTask {
    return TaskFactory.createDailyTask({
      isEmptySlot: true,
      label: "",
      title: "",
      ...overrides,
    });
  },

  // Metadata conversion

  /**
   * Convert a TaskFixture to frontmatter metadata format.
   */
  toMetadata(fixture: TaskFixture): Metadata {
    const normalizedStatus = normalizeStatus(fixture.status);
    const metadata: Metadata = {
      exo__Instance_class: "[[ems__Task]]",
      exo__Asset_label: fixture.label,
      exo__Asset_uid: fixture.basename,
      exo__Asset_createdAt: fixture.createdAt,
      exo__Asset_isArchived: fixture.isArchived,
      ems__Effort_status: `[[${normalizedStatus}]]`,
    };

    if (fixture.votes !== undefined && fixture.votes > 0) {
      metadata.ems__Effort_votes = fixture.votes;
    }

    if (fixture.area) {
      metadata.ems__Effort_area = `[[${fixture.area}]]`;
    }

    if (fixture.parent) {
      metadata.ems__Effort_parent = `[[${fixture.parent}]]`;
    }

    if (fixture.size) {
      metadata.ems__Task_size = SIZE_MAP[fixture.size];
    }

    if (fixture.day) {
      metadata.ems__Effort_day = `[[${fixture.day}]]`;
    }

    if (fixture.startTimestamp) {
      metadata.ems__Effort_startTimestamp = fixture.startTimestamp;
    }

    if (fixture.endTimestamp) {
      metadata.ems__Effort_endTimestamp = fixture.endTimestamp;
    }

    if (fixture.blockers && fixture.blockers.length > 0) {
      metadata.ems__Task_blockedBy = fixture.blockers.map((b) => `[[${b}]]`);
    }

    return metadata;
  },

  /**
   * Convert a TaskFixture to a TFile-like object.
   */
  toFile(fixture: TaskFixture): FileInfo & { stat: object; vault: null; parent: null; extension: string } {
    return {
      path: fixture.path,
      basename: fixture.basename,
      name: `${fixture.basename}.md`,
      extension: "md",
      parent: null,
      vault: null,
      stat: {
        ctime: fixture.createdAt ?? Date.now(),
        mtime: Date.now(),
        size: 0,
      },
    };
  },
};

export default TaskFactory;
