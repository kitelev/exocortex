/**
 * Command Visibility
 *
 * @deprecated Use domain/commands/visibility/* instead
 * This file re-exports for backward compatibility.
 *
 * Prefer direct imports from domain-specific files:
 *   import { canCreateTask } from "domain/commands/visibility/TaskVisibilityRules";
 *   import { canCreateProject } from "domain/commands/visibility/ProjectVisibilityRules";
 *   import { canCreateChildArea } from "domain/commands/visibility/AreaVisibilityRules";
 *   import { canStartEffort } from "domain/commands/visibility/EffortVisibilityRules";
 *   import { canCleanProperties } from "domain/commands/visibility/AssetVisibilityRules";
 */

export * from "./visibility";
