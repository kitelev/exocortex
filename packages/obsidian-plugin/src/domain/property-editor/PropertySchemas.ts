import type { PropertySchemaResolver, ClassHierarchyResolver, EnumValueResolver, EnumValue } from "exocortex";
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

export interface StatusEnumValue {
  value: string;
  wikilink?: string;
  label: string;
}

export interface SizeEnumValue {
  value: string;
  label: string;
}

const FALLBACK_EFFORT_STATUS_VALUES: StatusEnumValue[] = [
  { value: "[[ems__EffortStatusBacklog]]", wikilink: "[[ems__EffortStatusBacklog|Backlog]]", label: "Backlog" },
  { value: "[[ems__EffortStatusAnalysis]]", wikilink: "[[ems__EffortStatusAnalysis|Analysis]]", label: "Analysis" },
  { value: "[[ems__EffortStatusToDo]]", wikilink: "[[ems__EffortStatusToDo|To Do]]", label: "To Do" },
  { value: "[[ems__EffortStatusDoing]]", wikilink: "[[ems__EffortStatusDoing|Doing]]", label: "Doing" },
  { value: "[[ems__EffortStatusDone]]", wikilink: "[[ems__EffortStatusDone|Done]]", label: "Done" },
  { value: "[[ems__EffortStatusTrashed]]", wikilink: "[[ems__EffortStatusTrashed|Trashed]]", label: "Trashed" },
  { value: "[[ems__EffortStatusDraft]]", wikilink: "[[ems__EffortStatusDraft|Draft]]", label: "Draft" },
];

const FALLBACK_TASK_SIZE_VALUES: SizeEnumValue[] = [
  { value: "[[ems__TaskSize_XXS]]", label: "XXS" },
  { value: "[[ems__TaskSize_XS]]", label: "XS" },
  { value: "[[ems__TaskSize_S]]", label: "S" },
  { value: "[[ems__TaskSize_M]]", label: "M" },
  { value: "[[ems__TaskSize_L]]", label: "L" },
  { value: "[[ems__TaskSize_XL]]", label: "XL" },
];

export let EFFORT_STATUS_VALUES: StatusEnumValue[] = [...FALLBACK_EFFORT_STATUS_VALUES];
export let TASK_SIZE_VALUES: SizeEnumValue[] = [...FALLBACK_TASK_SIZE_VALUES];

let _enumResolver: EnumValueResolver | null = null;

export function initEnumResolver(resolver: EnumValueResolver): void {
  _enumResolver = resolver;
}

export function getEnumResolver(): EnumValueResolver | null {
  return _enumResolver;
}

function enumValuesToStatusValues(enumValues: EnumValue[]): StatusEnumValue[] {
  return enumValues.map((ev) => {
    const uid = ev.value.replace(/\[\[|\]\]/g, "");
    return {
      value: ev.value,
      wikilink: `[[${uid}|${ev.label}]]`,
      label: ev.label,
    };
  });
}

function enumValuesToSizeValues(enumValues: EnumValue[]): SizeEnumValue[] {
  return enumValues.map((ev) => ({
    value: ev.value,
    label: ev.label,
  }));
}

export async function refreshEnumValues(): Promise<void> {
  if (!_enumResolver) return;

  const statusValues = await _enumResolver.resolve("ems__EffortStatus");
  if (statusValues.length > 0) {
    EFFORT_STATUS_VALUES = enumValuesToStatusValues(statusValues);
  } else {
    EFFORT_STATUS_VALUES = [...FALLBACK_EFFORT_STATUS_VALUES];
  }

  const sizeValues = await _enumResolver.resolve("ems__TaskSize");
  if (sizeValues.length > 0) {
    TASK_SIZE_VALUES = enumValuesToSizeValues(sizeValues);
  } else {
    TASK_SIZE_VALUES = [...FALLBACK_TASK_SIZE_VALUES];
  }
}

export async function getEffortStatusValues(): Promise<StatusEnumValue[]> {
  if (_enumResolver) {
    const resolved = await _enumResolver.resolve("ems__EffortStatus");
    if (resolved.length > 0) {
      return enumValuesToStatusValues(resolved);
    }
  }
  return FALLBACK_EFFORT_STATUS_VALUES;
}

export async function getTaskSizeValues(): Promise<SizeEnumValue[]> {
  if (_enumResolver) {
    const resolved = await _enumResolver.resolve("ems__TaskSize");
    if (resolved.length > 0) {
      return enumValuesToSizeValues(resolved);
    }
  }
  return FALLBACK_TASK_SIZE_VALUES;
}

export { FALLBACK_EFFORT_STATUS_VALUES, FALLBACK_TASK_SIZE_VALUES };

/**
 * @internal — fallback only, prefer PropertySchemaResolver.
 *
 * Used when PropertySchemaService is unavailable (e.g. before the
 * triple store has loaded). Contains only the minimal set of universal
 * Asset properties required for basic UI rendering.
 */
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

export function initPropertySchemaService(
  resolver: PropertySchemaResolver,
  hierarchyResolver?: ClassHierarchyResolver,
): void {
  _schemaService = new PropertySchemaService(resolver, hierarchyResolver);
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
  // Strip wikilink brackets and take only the first token before any space.
  // Frontmatter may store "[[ems__EffortStatusDoing 027e78f4-...]]" (class + UUID)
  // after certain status transitions; splitting on space isolates the class name.
  const normalized = statusUri.replace(/[[\]"']/g, "").trim().split(" ")[0].toLowerCase();
  const match = EFFORT_STATUS_VALUES.find(
    (v) =>
      v.value.replace(/[[\]]/g, "").toLowerCase() === normalized ||
      v.label.toLowerCase() === normalized,
  );
  return match?.label ?? statusUri;
}
