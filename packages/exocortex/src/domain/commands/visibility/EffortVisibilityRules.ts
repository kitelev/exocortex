import { WikiLinkHelpers } from "../../../utilities/WikiLinkHelpers";
import type { CommandVisibilityContext } from "./types";
import {
  hasClass,
  isEffort,
  hasStatus,
  isAssetArchived,
  isPlannedForToday,
  hasPlannedStartTimestamp,
} from "./helpers";
import { AssetClass, EffortStatus } from "../../constants";

/**
 * Effort Visibility Rules
 *
 * Contains visibility logic for Effort-related commands (Task, Project, Meeting workflow).
 */

/**
 * Can execute "Plan on today" command
 * Available for: Task and Project (any effort) that are NOT already planned for today
 */
export function canPlanOnToday(context: CommandVisibilityContext): boolean {
  if (!isEffort(context.instanceClass)) return false;

  if (isPlannedForToday(context.metadata)) return false;

  return true;
}

/**
 * Can execute "Plan for Evening" command
 * Available for: Task or Meeting with Backlog status
 */
export function canPlanForEvening(context: CommandVisibilityContext): boolean {
  if (
    !hasClass(context.instanceClass, AssetClass.TASK) &&
    !hasClass(context.instanceClass, AssetClass.MEETING)
  )
    return false;

  return hasStatus(context.currentStatus, EffortStatus.BACKLOG);
}

/**
 * Can execute "Shift Day Backward" command
 * Available for: Task and Project with ems__Effort_plannedStartTimestamp property
 */
export function canShiftDayBackward(
  context: CommandVisibilityContext,
): boolean {
  if (!isEffort(context.instanceClass)) return false;
  return hasPlannedStartTimestamp(context.metadata);
}

/**
 * Can execute "Shift Day Forward" command
 * Available for: Task and Project with ems__Effort_plannedStartTimestamp property
 */
export function canShiftDayForward(context: CommandVisibilityContext): boolean {
  if (!isEffort(context.instanceClass)) return false;
  return hasPlannedStartTimestamp(context.metadata);
}

/**
 * Can execute "Set Draft Status" command
 * Available for: Task/Project without any status
 */
export function canSetDraftStatus(context: CommandVisibilityContext): boolean {
  if (!isEffort(context.instanceClass)) return false;

  return !context.currentStatus;
}

/**
 * Can execute "Move to Backlog" command
 * Available for: Task/Project with Draft status
 */
export function canMoveToBacklog(context: CommandVisibilityContext): boolean {
  if (!isEffort(context.instanceClass)) return false;

  return hasStatus(context.currentStatus, EffortStatus.DRAFT);
}

/**
 * Can execute "Start Effort" command
 * Available for: Task or Meeting with Backlog status OR Project with ToDo status
 */
export function canStartEffort(context: CommandVisibilityContext): boolean {
  if (!isEffort(context.instanceClass)) return false;

  if (
    hasClass(context.instanceClass, AssetClass.TASK) ||
    hasClass(context.instanceClass, AssetClass.MEETING)
  ) {
    return hasStatus(context.currentStatus, EffortStatus.BACKLOG);
  }

  if (hasClass(context.instanceClass, AssetClass.PROJECT)) {
    return hasStatus(context.currentStatus, EffortStatus.TODO);
  }

  return false;
}

/**
 * Can execute "Mark as Done" command
 * Available for: Task/Project with Doing status
 */
export function canMarkDone(context: CommandVisibilityContext): boolean {
  if (!isEffort(context.instanceClass)) return false;

  return hasStatus(context.currentStatus, EffortStatus.DOING);
}

/**
 * Can execute "Trash" command
 * Available for: Task/Project without Trashed or Done status
 */
export function canTrashEffort(context: CommandVisibilityContext): boolean {
  if (!isEffort(context.instanceClass)) return false;

  if (!context.currentStatus) return true;

  const statuses = Array.isArray(context.currentStatus)
    ? context.currentStatus
    : [context.currentStatus];

  const hasTrashedOrDone = statuses.some((status) => {
    const cleanStatus = WikiLinkHelpers.normalize(status);
    return (
      cleanStatus === EffortStatus.TRASHED || cleanStatus === EffortStatus.DONE
    );
  });

  return !hasTrashedOrDone;
}

/**
 * Can execute "Vote on Effort" command
 * Available for: Task and Project efforts (not archived)
 */
export function canVoteOnEffort(context: CommandVisibilityContext): boolean {
  if (!isEffort(context.instanceClass)) return false;

  if (isAssetArchived(context.isArchived)) return false;

  return true;
}

/**
 * Can execute "Rollback Status" command
 * Available for: Efforts with non-null, non-Trashed status (workflow-based rollback)
 */
export function canRollbackStatus(context: CommandVisibilityContext): boolean {
  if (!isEffort(context.instanceClass)) return false;

  if (isAssetArchived(context.isArchived)) return false;

  if (!context.currentStatus) return false;

  const statusValue = Array.isArray(context.currentStatus)
    ? context.currentStatus[0]
    : context.currentStatus;

  if (!statusValue) return false;

  const cleanStatus = WikiLinkHelpers.normalize(statusValue);

  if (cleanStatus === EffortStatus.TRASHED) return false;

  return true;
}

/**
 * Can execute "Archive Task" command
 * Available for: Any asset that is not already archived
 */
export function canArchiveTask(context: CommandVisibilityContext): boolean {
  return !isAssetArchived(context.isArchived);
}
