import { v4 as uuidv4 } from "uuid";
import { AssetClass } from "../constants/AssetClass";
import { EffortStatus } from "../constants/EffortStatus";
import type { WorkflowDefinition } from "../models/WorkflowDefinition";
import {
  WorkflowProperty,
  WorkflowStateProperty,
  WorkflowTransitionProperty,
} from "../constants/WorkflowProperty";
import { MetadataHelpers } from "../../utilities/MetadataHelpers";

/**
 * Default workflow definition for ems__Project assets.
 *
 * States: Draft -> Backlog -> Analysis -> ToDo -> Doing -> Done | Trashed
 * Issue #2363
 */
export const PROJECT_DEFAULT_WORKFLOW: WorkflowDefinition = {
  id: "a1b2c3d4-1111-4000-a000-000000000001",
  name: "Project Default Workflow",
  targetClass: AssetClass.PROJECT,
  initialState: EffortStatus.DRAFT,
  terminalStates: [EffortStatus.DONE, EffortStatus.TRASHED],
  isDefault: true,
  states: [
    { status: EffortStatus.DRAFT, order: 1, optional: false, timestampOnEnter: [] },
    { status: EffortStatus.BACKLOG, order: 2, optional: false, timestampOnEnter: [] },
    { status: EffortStatus.ANALYSIS, order: 3, optional: true, timestampOnEnter: [] },
    { status: EffortStatus.TODO, order: 4, optional: true, timestampOnEnter: [] },
    { status: EffortStatus.DOING, order: 5, optional: false, timestampOnEnter: ["ems__Effort_startTimestamp"] },
    { status: EffortStatus.DONE, order: 6, optional: false, timestampOnEnter: ["ems__Effort_endTimestamp", "ems__Effort_resolutionTimestamp"] },
    { status: EffortStatus.TRASHED, order: 7, optional: false, timestampOnEnter: ["ems__Effort_resolutionTimestamp"] },
  ],
  transitions: [
    { from: EffortStatus.DRAFT, to: EffortStatus.BACKLOG, label: "\u2192 Backlog", isRollback: false },
    { from: EffortStatus.BACKLOG, to: EffortStatus.ANALYSIS, label: "\u2192 Analysis", isRollback: false },
    { from: EffortStatus.ANALYSIS, to: EffortStatus.TODO, label: "\u2192 ToDo", isRollback: false },
    { from: EffortStatus.TODO, to: EffortStatus.DOING, label: "\u25B6 Start", isRollback: false },
    { from: EffortStatus.DOING, to: EffortStatus.DONE, label: "\u2713 Done", isRollback: false },
    { from: EffortStatus.BACKLOG, to: EffortStatus.DRAFT, label: "\u2190 Draft", isRollback: true },
    { from: EffortStatus.ANALYSIS, to: EffortStatus.BACKLOG, label: "\u2190 Backlog", isRollback: true },
    { from: EffortStatus.TODO, to: EffortStatus.ANALYSIS, label: "\u2190 Analysis", isRollback: true },
    { from: EffortStatus.DOING, to: EffortStatus.TODO, label: "\u2190 ToDo", isRollback: true },
    { from: EffortStatus.DONE, to: EffortStatus.DOING, label: "\u2190 Doing", isRollback: true },
  ],
};

/**
 * Default workflow definition for ems__Task assets.
 *
 * States: Draft -> Backlog -> Doing -> Done | Trashed
 * Issue #2363
 */
export const TASK_DEFAULT_WORKFLOW: WorkflowDefinition = {
  id: "a1b2c3d4-2222-4000-a000-000000000002",
  name: "Task Default Workflow",
  targetClass: AssetClass.TASK,
  initialState: EffortStatus.DRAFT,
  terminalStates: [EffortStatus.DONE, EffortStatus.TRASHED],
  isDefault: true,
  states: [
    { status: EffortStatus.DRAFT, order: 1, optional: false, timestampOnEnter: [] },
    { status: EffortStatus.BACKLOG, order: 2, optional: false, timestampOnEnter: [] },
    { status: EffortStatus.DOING, order: 3, optional: false, timestampOnEnter: ["ems__Effort_startTimestamp"] },
    { status: EffortStatus.DONE, order: 4, optional: false, timestampOnEnter: ["ems__Effort_endTimestamp", "ems__Effort_resolutionTimestamp"] },
    { status: EffortStatus.TRASHED, order: 5, optional: false, timestampOnEnter: ["ems__Effort_resolutionTimestamp"] },
  ],
  transitions: [
    { from: EffortStatus.DRAFT, to: EffortStatus.BACKLOG, label: "\u2192 Backlog", isRollback: false },
    { from: EffortStatus.BACKLOG, to: EffortStatus.DOING, label: "\u25B6 Start", isRollback: false },
    { from: EffortStatus.DOING, to: EffortStatus.DONE, label: "\u2713 Done", isRollback: false },
    { from: EffortStatus.BACKLOG, to: EffortStatus.DRAFT, label: "\u2190 Draft", isRollback: true },
    { from: EffortStatus.DOING, to: EffortStatus.BACKLOG, label: "\u2190 Backlog", isRollback: true },
    { from: EffortStatus.DONE, to: EffortStatus.DOING, label: "\u2190 Doing", isRollback: true },
  ],
};

/**
 * Generates .md asset files for a complete workflow definition.
 *
 * Returns one file for the workflow itself, one per state, and one per transition.
 * Each file contains YAML frontmatter with proper ontology properties.
 *
 * @param workflow - The workflow definition to serialize
 * @returns Array of { filename, content } entries ready to be written to vault
 *
 * Issue #2363
 */
export function buildWorkflowAssetContent(
  workflow: WorkflowDefinition,
): Array<{ filename: string; content: string }> {
  const now = new Date().toISOString();
  const files: Array<{ filename: string; content: string }> = [];

  // 1. Workflow file
  const workflowUid = workflow.id;
  const workflowFrontmatter: Record<string, unknown> = {
    exo__Asset_uid: workflowUid,
    exo__Asset_label: `"${workflow.name}"`,
    exo__Asset_createdAt: now,
    exo__Instance_class: AssetClass.WORKFLOW,
    [WorkflowProperty.TARGET_CLASS]: `"[[${workflow.targetClass}]]"`,
    [WorkflowProperty.INITIAL_STATE]: `"[[${workflow.initialState}]]"`,
    [WorkflowProperty.TERMINAL_STATES]: workflow.terminalStates.map(
      (s) => `"[[${s}]]"`,
    ),
    [WorkflowProperty.IS_DEFAULT]: workflow.isDefault,
  };
  files.push({
    filename: `${workflowUid}.md`,
    content: MetadataHelpers.buildFileContent(workflowFrontmatter),
  });

  // 2. State files
  for (const state of workflow.states) {
    const stateUid = uuidv4();
    const stateFrontmatter: Record<string, unknown> = {
      exo__Asset_uid: stateUid,
      exo__Asset_label: `"${workflow.name} - ${state.status}"`,
      exo__Asset_createdAt: now,
      exo__Instance_class: AssetClass.WORKFLOW_STATE,
      [WorkflowStateProperty.WORKFLOW]: `"[[${workflowUid}]]"`,
      [WorkflowStateProperty.STATUS]: `"[[${state.status}]]"`,
      [WorkflowStateProperty.ORDER]: state.order,
      [WorkflowStateProperty.OPTIONAL]: state.optional,
    };
    if (state.timestampOnEnter.length > 0) {
      stateFrontmatter[WorkflowStateProperty.TIMESTAMP_ON_ENTER] =
        state.timestampOnEnter;
    }
    if (state.badgeColor) {
      stateFrontmatter[WorkflowStateProperty.BADGE_COLOR] = `"${state.badgeColor}"`;
    }
    files.push({
      filename: `${stateUid}.md`,
      content: MetadataHelpers.buildFileContent(stateFrontmatter),
    });
  }

  // 3. Transition files
  for (const transition of workflow.transitions) {
    const transUid = uuidv4();
    const transFrontmatter: Record<string, unknown> = {
      exo__Asset_uid: transUid,
      exo__Asset_label: `"${workflow.name} - ${transition.label}"`,
      exo__Asset_createdAt: now,
      exo__Instance_class: AssetClass.WORKFLOW_TRANSITION,
      [WorkflowTransitionProperty.WORKFLOW]: `"[[${workflowUid}]]"`,
      [WorkflowTransitionProperty.FROM]: `"[[${transition.from}]]"`,
      [WorkflowTransitionProperty.TO]: `"[[${transition.to}]]"`,
      [WorkflowTransitionProperty.LABEL]: `"${transition.label}"`,
      [WorkflowTransitionProperty.IS_ROLLBACK]: transition.isRollback,
    };
    if (transition.icon) {
      transFrontmatter[WorkflowTransitionProperty.ICON] = `"${transition.icon}"`;
    }
    files.push({
      filename: `${transUid}.md`,
      content: MetadataHelpers.buildFileContent(transFrontmatter),
    });
  }

  return files;
}
