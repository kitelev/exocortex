/**
 * Types for test utilities and mock factories.
 * These types mirror production interfaces but are simplified for testing.
 */

/**
 * Effort status values matching the domain constants.
 */
export type EffortStatus =
  | "ems__EffortStatusDraft"
  | "ems__EffortStatusBacklog"
  | "ems__EffortStatusDoing"
  | "ems__EffortStatusWaiting"
  | "ems__EffortStatusDone"
  | "ems__EffortStatusTrashed";

/**
 * Human-readable status names for convenience.
 */
export type EffortStatusName =
  | "Draft"
  | "Backlog"
  | "Doing"
  | "Waiting"
  | "Done"
  | "Trashed";

/**
 * Task size values matching the domain constants.
 */
export type TaskSize = "XXS" | "XS" | "S" | "M" | "L" | "XL";

/**
 * Asset class values matching the domain constants.
 */
export type AssetClass =
  | "ems__Area"
  | "ems__Task"
  | "ems__Project"
  | "ems__Meeting"
  | "ems__Initiative"
  | "ems__TaskPrototype"
  | "ems__MeetingPrototype"
  | "exo__EventPrototype"
  | "ems__ProjectPrototype"
  | "exo__Event"
  | "pn__DailyNote"
  | "ims__Concept"
  | "ems__SessionStartEvent"
  | "ems__SessionEndEvent"
  | "exo__Prototype"
  | "exo__Class";

/**
 * File info structure (simplified TFile).
 */
export interface FileInfo {
  path: string;
  basename: string;
  name?: string;
  extension?: string;
}

/**
 * Base interface for all fixture types.
 */
export interface BaseFixture {
  path: string;
  basename: string;
  label: string;
  isArchived?: boolean;
  createdAt?: number;
}

/**
 * Task fixture for unit tests.
 */
export interface TaskFixture extends BaseFixture {
  status: EffortStatus | EffortStatusName;
  size?: TaskSize;
  votes?: number;
  area?: string;
  parent?: string;
  day?: string;
  startTimestamp?: number | string | null;
  endTimestamp?: number | string | null;
  blockers?: string[];
}

/**
 * Project fixture for unit tests.
 */
export interface ProjectFixture extends BaseFixture {
  status: EffortStatus | EffortStatusName;
  votes?: number;
  area?: string;
  parent?: string;
  blockers?: string[];
}

/**
 * Area fixture for unit tests.
 */
export interface AreaFixture extends BaseFixture {
  parent?: string;
}

/**
 * Meeting fixture for unit tests.
 */
export interface MeetingFixture extends TaskFixture {
  scheduledAt?: number;
}

/**
 * Concept fixture for unit tests.
 */
export type ConceptFixture = BaseFixture;

/**
 * DailyTask interface matching the React component interface.
 */
export interface DailyTask {
  file: FileInfo;
  path: string;
  title: string;
  label: string;
  startTime: string;
  endTime: string;
  startTimestamp: string | number | null;
  endTimestamp: string | number | null;
  status: string;
  metadata: Record<string, unknown>;
  isDone: boolean;
  isTrashed: boolean;
  isDoing: boolean;
  isMeeting: boolean;
  isBlocked: boolean;
  isEmptySlot?: boolean;
}

/**
 * Asset relation for backlinks/relations tests.
 */
export interface AssetRelation {
  file: FileInfo;
  path: string;
  title: string;
  metadata: Record<string, unknown>;
  propertyName: string;
  isBodyLink: boolean;
  isArchived: boolean;
  isBlocked: boolean;
  created: number;
  modified: number;
}

/**
 * Metadata record type.
 */
export type Metadata = Record<string, unknown>;
