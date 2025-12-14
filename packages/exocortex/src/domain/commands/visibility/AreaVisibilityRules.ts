import type { CommandVisibilityContext } from "./types";
import { hasClass } from "./helpers";
import { AssetClass } from "../../constants";

/**
 * Area Visibility Rules
 *
 * Contains visibility logic for Area-specific commands.
 */

/**
 * Can execute "Create Child Area" command
 * Available for: ems__Area assets only
 */
export function canCreateChildArea(context: CommandVisibilityContext): boolean {
  return hasClass(context.instanceClass, AssetClass.AREA);
}

/**
 * Can execute "Set Active Focus" command
 * Available for: ems__Area assets only
 */
export function canSetActiveFocus(context: CommandVisibilityContext): boolean {
  return hasClass(context.instanceClass, AssetClass.AREA);
}
