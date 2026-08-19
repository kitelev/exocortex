/**
 * Meeting factory for creating test data.
 *
 * @example
 * // Simple meeting
 * const meeting = MeetingFactory.create();
 *
 * // Meeting scheduled for tomorrow
 * const futureMeeting = MeetingFactory.scheduled(Date.now() + 86400000);
 *
 * // Completed meeting
 * const completedMeeting = MeetingFactory.done();
 */

import type {
  MeetingFixture,
  DailyTask,
  EffortStatus,
  EffortStatusName,
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

let meetingCounter = 0;

/**
 * Reset the meeting counter. Call this in beforeEach() to ensure deterministic IDs.
 */
export function resetMeetingCounter(): void {
  meetingCounter = 0;
}

/**
 * Generate a unique ID for meetings.
 */
function generateId(): string {
  meetingCounter++;
  return `meeting-${meetingCounter}`;
}

/**
 * Default meeting fixture values.
 */
const DEFAULT_MEETING: Omit<MeetingFixture, "path" | "basename" | "label"> = {
  status: "ems__EffortStatusDraft",
  votes: 0,
  isArchived: false,
  createdAt: Date.now(),
};

/**
 * Meeting factory for creating test fixtures.
 */
export const MeetingFactory = {
  /**
   * Create a meeting fixture with optional overrides.
   */
  create(overrides: Partial<MeetingFixture> = {}): MeetingFixture {
    const id = generateId();
    const basename = overrides.basename ?? id;
    const normalizedStatus = normalizeStatus(
      overrides.status ?? DEFAULT_MEETING.status
    );

    return {
      path: overrides.path ?? `meetings/${basename}.md`,
      basename,
      label: overrides.label ?? `Test Meeting ${meetingCounter}`,
      status: normalizedStatus,
      votes: overrides.votes ?? DEFAULT_MEETING.votes,
      area: overrides.area,
      parent: overrides.parent,
      day: overrides.day,
      isArchived: overrides.isArchived ?? DEFAULT_MEETING.isArchived,
      createdAt: overrides.createdAt ?? DEFAULT_MEETING.createdAt,
      startTimestamp: overrides.startTimestamp,
      endTimestamp: overrides.endTimestamp,
      scheduledAt: overrides.scheduledAt,
      blockers: overrides.blockers,
    };
  },

  /**
   * Create multiple meeting fixtures.
   */
  createMany(count: number, overrides: Partial<MeetingFixture> = {}): MeetingFixture[] {
    return Array.from({ length: count }, () => MeetingFactory.create(overrides));
  },

  // Convenience methods for common states

  /**
   * Create a meeting scheduled at a specific time.
   */
  scheduled(scheduledAt: number, overrides: Partial<MeetingFixture> = {}): MeetingFixture {
    return MeetingFactory.create({
      status: "Backlog",
      scheduledAt,
      ...overrides,
    });
  },

  /**
   * Create a meeting scheduled for today.
   */
  today(overrides: Partial<MeetingFixture> = {}): MeetingFixture {
    const today = new Date();
    today.setHours(14, 0, 0, 0); // 2 PM today
    return MeetingFactory.scheduled(today.getTime(), overrides);
  },

  /**
   * Create a meeting scheduled for tomorrow.
   */
  tomorrow(overrides: Partial<MeetingFixture> = {}): MeetingFixture {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(14, 0, 0, 0); // 2 PM tomorrow
    return MeetingFactory.scheduled(tomorrow.getTime(), overrides);
  },

  /**
   * Create a past meeting.
   */
  past(overrides: Partial<MeetingFixture> = {}): MeetingFixture {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(14, 0, 0, 0);
    return MeetingFactory.scheduled(yesterday.getTime(), overrides);
  },

  /**
   * Create a Doing meeting (in progress).
   */
  doing(overrides: Partial<MeetingFixture> = {}): MeetingFixture {
    return MeetingFactory.create({
      status: "Doing",
      startTimestamp: overrides.startTimestamp ?? Date.now(),
      scheduledAt: Date.now(),
      ...overrides,
    });
  },

  /**
   * Create a Done meeting.
   */
  done(overrides: Partial<MeetingFixture> = {}): MeetingFixture {
    const defaultStart = Date.now() - 3600000;
    const startTimestamp = overrides.startTimestamp ?? defaultStart;
    const scheduledAtValue = typeof startTimestamp === "number" ? startTimestamp : defaultStart;
    return MeetingFactory.create({
      status: "Done",
      startTimestamp,
      endTimestamp: overrides.endTimestamp ?? Date.now(),
      scheduledAt: scheduledAtValue,
      ...overrides,
    });
  },

  /**
   * Create a Trashed meeting.
   */
  trashed(overrides: Partial<MeetingFixture> = {}): MeetingFixture {
    return MeetingFactory.create({ status: "Trashed", ...overrides });
  },

  /**
   * Create a meeting under a project.
   */
  withParent(parent: string, overrides: Partial<MeetingFixture> = {}): MeetingFixture {
    return MeetingFactory.create({ parent, ...overrides });
  },

  // DailyTask factory methods for React component tests (meetings appear as DailyTask with isMeeting=true)

  /**
   * Create a DailyTask representing a meeting for React component tests.
   */
  createDailyMeeting(overrides: Partial<DailyTask> = {}): DailyTask {
    const id = generateId();
    const basename = overrides.file?.basename ?? id;
    const path = overrides.path ?? overrides.file?.path ?? `meetings/${basename}.md`;
    const status = overrides.status ?? "ems__EffortStatusBacklog";
    const normalizedStatus = status.startsWith("ems__")
      ? status
      : STATUS_MAP[status as EffortStatusName] ?? "ems__EffortStatusBacklog";

    return {
      file: {
        path,
        basename,
        ...overrides.file,
      },
      path,
      title: overrides.title ?? basename,
      label: overrides.label ?? `Test Meeting ${meetingCounter}`,
      startTime: overrides.startTime ?? "14:00",
      endTime: overrides.endTime ?? "15:00",
      startTimestamp: overrides.startTimestamp ?? null,
      endTimestamp: overrides.endTimestamp ?? null,
      status: normalizedStatus,
      metadata: overrides.metadata ?? {},
      isDone: overrides.isDone ?? isDoneStatus(normalizedStatus as EffortStatus),
      isTrashed: overrides.isTrashed ?? isTrashedStatus(normalizedStatus as EffortStatus),
      isDoing: overrides.isDoing ?? isDoingStatus(normalizedStatus as EffortStatus),
      isMeeting: overrides.isMeeting ?? true, // Always true for meetings
      isBlocked: overrides.isBlocked ?? false,
      isEmptySlot: overrides.isEmptySlot,
    };
  },

  /**
   * Create multiple DailyMeetings.
   */
  createManyDailyMeetings(
    count: number,
    overrides: Partial<DailyTask> = {}
  ): DailyTask[] {
    return Array.from({ length: count }, () =>
      MeetingFactory.createDailyMeeting(overrides)
    );
  },

  // Metadata conversion

  /**
   * Convert a MeetingFixture to frontmatter metadata format.
   */
  toMetadata(fixture: MeetingFixture): Metadata {
    const normalizedStatus = normalizeStatus(fixture.status);
    const metadata: Metadata = {
      exo__Instance_class: "[[ems__Meeting]]",
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

    if (fixture.day) {
      metadata.ems__Effort_day = `[[${fixture.day}]]`;
    }

    if (fixture.startTimestamp) {
      metadata.ems__Effort_startTimestamp = fixture.startTimestamp;
    }

    if (fixture.endTimestamp) {
      metadata.ems__Effort_endTimestamp = fixture.endTimestamp;
    }

    if (fixture.scheduledAt) {
      metadata.ems__Meeting_scheduledAt = fixture.scheduledAt;
    }

    return metadata;
  },

  /**
   * Convert a MeetingFixture to a TFile-like object.
   */
  toFile(fixture: MeetingFixture): FileInfo & { stat: object; vault: null; parent: null; extension: string } {
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

export default MeetingFactory;
