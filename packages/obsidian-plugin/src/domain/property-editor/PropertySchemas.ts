import type { PropertySchemaResolver } from "exocortex";
import { PropertySchemaService } from "./PropertySchemaService";

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

export const EFFORT_STATUS_VALUES = [
  { value: "[[ems__EffortStatusBacklog]]", wikilink: "[[ems__EffortStatusBacklog|Backlog]]", label: "Backlog" },
  { value: "[[ems__EffortStatusAnalysis]]", wikilink: "[[ems__EffortStatusAnalysis|Analysis]]", label: "Analysis" },
  { value: "[[ems__EffortStatusToDo]]", wikilink: "[[ems__EffortStatusToDo|To Do]]", label: "To Do" },
  { value: "[[ems__EffortStatusDoing]]", wikilink: "[[ems__EffortStatusDoing|Doing]]", label: "Doing" },
  { value: "[[ems__EffortStatusDone]]", wikilink: "[[ems__EffortStatusDone|Done]]", label: "Done" },
  { value: "[[ems__EffortStatusTrashed]]", wikilink: "[[ems__EffortStatusTrashed|Trashed]]", label: "Trashed" },
  { value: "[[ems__EffortStatusDraft]]", wikilink: "[[ems__EffortStatusDraft|Draft]]", label: "Draft" },
];

export const TASK_SIZE_VALUES = [
  { value: "[[ems__TaskSize_XXS]]", label: "XXS" },
  { value: "[[ems__TaskSize_XS]]", label: "XS" },
  { value: "[[ems__TaskSize_S]]", label: "S" },
  { value: "[[ems__TaskSize_M]]", label: "M" },
  { value: "[[ems__TaskSize_L]]", label: "L" },
  { value: "[[ems__TaskSize_XL]]", label: "XL" },
];

const FALLBACK_PROPERTIES: PropertySchemaDefinition[] = [
  {
    name: "exo__Asset_label",
    type: "text",
    required: true,
    label: "Label",
  },
  {
    name: "exo__Asset_uid",
    type: "text",
    required: true,
    label: "UID",
    readOnly: true,
  },
  {
    name: "exo__Asset_createdAt",
    type: "timestamp",
    required: true,
    label: "Created at",
    readOnly: true,
  },
  {
    name: "exo__Asset_isArchived",
    type: "boolean",
    required: false,
    label: "Archived",
  },
];

let _schemaService: PropertySchemaService | null = null;

export function initPropertySchemaService(resolver: PropertySchemaResolver): void {
  _schemaService = new PropertySchemaService(resolver);
}

export function getPropertySchemaService(): PropertySchemaService | null {
  return _schemaService;
}

export async function getPropertySchemaForClass(
  instanceClass: string,
): Promise<PropertySchemaDefinition[]> {
  if (_schemaService) {
    const resolved = await _schemaService.getPropertySchemaForClass(instanceClass);
    if (resolved.length > 0) {
      return resolved;
    }
  }
  return FALLBACK_PROPERTIES;
}

export function getPropertySchemaForClassSync(
  _instanceClass: string,
): PropertySchemaDefinition[] {
  return FALLBACK_PROPERTIES;
}

export function getEditableProperties(
  schema: PropertySchemaDefinition[],
): PropertySchemaDefinition[] {
  return schema.filter((prop) => !prop.readOnly);
}

export function getPropertyByName(
  schema: PropertySchemaDefinition[],
  propertyName: string,
): PropertySchemaDefinition | undefined {
  return schema.find((prop) => prop.name === propertyName);
}

export function getStatusLabel(statusUri: string | null | undefined): string {
  if (!statusUri || statusUri.trim() === "") return "-";
  const normalized = statusUri.replace(/[[\]"']/g, "").trim().toLowerCase();
  const match = EFFORT_STATUS_VALUES.find(
    (v) =>
      v.value.replace(/[[\]]/g, "").toLowerCase() === normalized ||
      v.label.toLowerCase() === normalized,
  );
  return match?.label ?? statusUri;
}
