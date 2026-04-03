export type PropertyFieldType =
  | "text"
  | "status-select"
  | "size-select"
  | "wikilink"
  | "number"
  | "boolean"
  | "timestamp";

export interface PropertySchemaDefinition {
  name: string;
  type: PropertyFieldType;
  required: boolean;
  label: string;
  description?: string;
  options?: string[];
  filter?: string[];
  min?: number;
  max?: number;
  readOnly?: boolean;
}

import { EFFORT_STATUS_OPTIONS as CORE_STATUS_OPTIONS } from "exocortex";

/**
 * Effort status values derived from the core EFFORT_STATUS_OPTIONS (single source of truth).
 * Issue #2463
 */
export const EFFORT_STATUS_VALUES = CORE_STATUS_OPTIONS;

export const TASK_SIZE_VALUES = [
  { value: "[[ems__TaskSize_XXS]]", label: "XXS" },
  { value: "[[ems__TaskSize_XS]]", label: "XS" },
  { value: "[[ems__TaskSize_S]]", label: "S" },
  { value: "[[ems__TaskSize_M]]", label: "M" },
  { value: "[[ems__TaskSize_L]]", label: "L" },
  { value: "[[ems__TaskSize_XL]]", label: "XL" },
];

const COMMON_ASSET_PROPERTIES: PropertySchemaDefinition[] = [
  {
    name: "exo__Asset_label",
    type: "text",
    required: true,
    label: "Label",
    description: "Display name for the asset",
  },
  {
    name: "exo__Asset_uid",
    type: "text",
    required: true,
    label: "UID",
    description: "Unique identifier (read-only)",
    readOnly: true,
  },
  {
    name: "exo__Asset_createdAt",
    type: "timestamp",
    required: true,
    label: "Created at",
    description: "Creation timestamp",
    readOnly: true,
  },
  {
    name: "exo__Asset_isArchived",
    type: "boolean",
    required: false,
    label: "Archived",
    description: "Whether the asset is archived",
  },
];

const EFFORT_PROPERTIES: PropertySchemaDefinition[] = [
  {
    name: "ems__Effort_status",
    type: "status-select",
    required: true,
    label: "Status",
    description: "Current workflow status",
  },
  {
    name: "ems__Effort_area",
    type: "wikilink",
    required: false,
    label: "Area",
    description: "Parent area",
    filter: ["ems__Area"],
  },
  {
    name: "ems__Effort_parent",
    type: "wikilink",
    required: false,
    label: "Parent",
    description: "Parent project or initiative",
    filter: ["ems__Project", "ems__Initiative"],
  },
  {
    name: "ems__Effort_votes",
    type: "number",
    required: false,
    label: "Votes",
    description: "Priority votes",
    min: 0,
  },
  {
    name: "ems__Effort_day",
    type: "wikilink",
    required: false,
    label: "Planned day",
    description: "Scheduled day for this effort",
    filter: ["pn__DailyNote"],
  },
  {
    name: "ems__Effort_startTimestamp",
    type: "timestamp",
    required: false,
    label: "Started at",
    description: "When work began",
    readOnly: true,
  },
  {
    name: "ems__Effort_endTimestamp",
    type: "timestamp",
    required: false,
    label: "Ended at",
    description: "When work paused/stopped",
    readOnly: true,
  },
];

const TASK_SPECIFIC_PROPERTIES: PropertySchemaDefinition[] = [
  {
    name: "ems__Task_size",
    type: "size-select",
    required: false,
    label: "Size",
    description: "Task size estimate",
  },
];

const AREA_SPECIFIC_PROPERTIES: PropertySchemaDefinition[] = [
  {
    name: "ems__Area_parent",
    type: "wikilink",
    required: false,
    label: "Parent area",
    description: "Parent area in hierarchy",
    filter: ["ems__Area"],
  },
];

export const PROPERTY_SCHEMAS: Record<string, PropertySchemaDefinition[]> = {
  ems__Task: [
    ...COMMON_ASSET_PROPERTIES,
    ...EFFORT_PROPERTIES,
    ...TASK_SPECIFIC_PROPERTIES,
  ],
  ems__Meeting: [
    ...COMMON_ASSET_PROPERTIES,
    ...EFFORT_PROPERTIES,
    ...TASK_SPECIFIC_PROPERTIES,
  ],
  ems__Project: [...COMMON_ASSET_PROPERTIES, ...EFFORT_PROPERTIES],
  ems__Initiative: [...COMMON_ASSET_PROPERTIES, ...EFFORT_PROPERTIES],
  ems__Area: [...COMMON_ASSET_PROPERTIES, ...AREA_SPECIFIC_PROPERTIES],
  ims__Concept: [...COMMON_ASSET_PROPERTIES],
};

export function getPropertySchemaForClass(
  instanceClass: string,
): PropertySchemaDefinition[] {
  const cleanClass = instanceClass.replace(/\[\[|\]\]/g, "");
  return PROPERTY_SCHEMAS[cleanClass] || COMMON_ASSET_PROPERTIES;
}

export function getEditableProperties(
  instanceClass: string,
): PropertySchemaDefinition[] {
  const schema = getPropertySchemaForClass(instanceClass);
  return schema.filter((prop) => !prop.readOnly);
}

export function getPropertyByName(
  instanceClass: string,
  propertyName: string,
): PropertySchemaDefinition | undefined {
  const schema = getPropertySchemaForClass(instanceClass);
  return schema.find((prop) => prop.name === propertyName);
}

/**
 * Converts an effort status URI to a human-readable label.
 * Delegates to core getEffortStatusLabel (single source of truth, Issue #2463).
 *
 * Preserves case-insensitive label matching for backward compatibility.
 */
export { getEffortStatusLabel as getStatusLabel } from "exocortex";
