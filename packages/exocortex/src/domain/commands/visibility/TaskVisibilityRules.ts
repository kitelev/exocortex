import type { CommandVisibilityContext } from "./types";
import { hasClass, isAreaOrProject, isAssetArchived } from "./helpers";
import { AssetClass } from "../../constants";

/**
 * Task Visibility Rules
 *
 * Contains visibility logic for Task-specific commands.
 */

/**
 * Can execute "Create Task" command
 * Available for: ems__Area and ems__Project assets
 */
export function canCreateTask(context: CommandVisibilityContext): boolean {
  return isAreaOrProject(context.instanceClass);
}

/**
 * Can execute "Create Related Task" command
 * Available for: ems__Task assets (not archived)
 */
export function canCreateRelatedTask(
  context: CommandVisibilityContext,
): boolean {
  if (!hasClass(context.instanceClass, AssetClass.TASK)) return false;

  if (isAssetArchived(context.isArchived)) return false;

  return true;
}

/**
 * Can execute "Convert Task to Project" command
 * Available for: ems__Task assets only
 */
export function canConvertTaskToProject(
  context: CommandVisibilityContext,
): boolean {
  return hasClass(context.instanceClass, AssetClass.TASK);
}
