import type { CommandVisibilityContext } from "./types";
import { hasClass, hasStatus } from "./helpers";
import { AssetClass, EffortStatus } from "../../constants";

/**
 * Project Visibility Rules
 *
 * Contains visibility logic for Project-specific commands.
 */

/**
 * Can execute "Create Project" command
 * Available for: ems__Area, ems__Initiative, and ems__Project assets
 */
export function canCreateProject(context: CommandVisibilityContext): boolean {
  return (
    hasClass(context.instanceClass, AssetClass.AREA) ||
    hasClass(context.instanceClass, AssetClass.INITIATIVE) ||
    hasClass(context.instanceClass, AssetClass.PROJECT)
  );
}

/**
 * Can execute "Move to Analysis" command
 * Available for: Project with Backlog status
 */
export function canMoveToAnalysis(context: CommandVisibilityContext): boolean {
  if (!hasClass(context.instanceClass, AssetClass.PROJECT)) return false;

  return hasStatus(context.currentStatus, EffortStatus.BACKLOG);
}

/**
 * Can execute "Move to ToDo" command
 * Available for: Project with Analysis status
 */
export function canMoveToToDo(context: CommandVisibilityContext): boolean {
  if (!hasClass(context.instanceClass, AssetClass.PROJECT)) return false;

  return hasStatus(context.currentStatus, EffortStatus.ANALYSIS);
}

/**
 * Can execute "Convert Project to Task" command
 * Available for: ems__Project assets only
 */
export function canConvertProjectToTask(
  context: CommandVisibilityContext,
): boolean {
  return hasClass(context.instanceClass, AssetClass.PROJECT);
}
