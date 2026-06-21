import type { PropertySchemaResolver, ClassHierarchyResolver, EnumValueResolver, EnumValue } from "@kitelev/exocortex-core";
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

// UUID-form per RFC 31c1a0be Phase 4 PR-C (#3194). UUID-canon mapping for
// ems__EffortStatus instances in the vault TBox (assetspaces/ems/<UUID>.md).
// Fallback path: used when EnumValueResolver is unavailable (pre-triple-store
// load). Resolved path (EnumValueResolver) still emits symbolic-form short
// names — Stage 5 will migrate that. UUID-form `value` ensures property
// writes from this fallback are UUID-canon even when the resolver fails.
const FALLBACK_EFFORT_STATUS_VALUES: StatusEnumValue[] = [
  { value: "[[753a44d5-846c-4b82-9196-4fd9a4d48777]]", wikilink: "[[753a44d5-846c-4b82-9196-4fd9a4d48777|Backlog]]", label: "Backlog" },
  { value: "[[cde3525c-57ea-4efc-b477-2e7e7ccd3a1e]]", wikilink: "[[cde3525c-57ea-4efc-b477-2e7e7ccd3a1e|Analysis]]", label: "Analysis" },
  { value: "[[6a0e933a-6653-46f4-95ae-ed7508177c73]]", wikilink: "[[6a0e933a-6653-46f4-95ae-ed7508177c73|To Do]]", label: "To Do" },
  { value: "[[027e78f4-6e16-4b36-b8fb-5510507d5745]]", wikilink: "[[027e78f4-6e16-4b36-b8fb-5510507d5745|Doing]]", label: "Doing" },
  { value: "[[7b9b3116-7c3c-438c-9618-94fe301320a6]]", wikilink: "[[7b9b3116-7c3c-438c-9618-94fe301320a6|Done]]", label: "Done" },
  { value: "[[5d14f18d-db2b-4847-9ac1-144cb93b2541]]", wikilink: "[[5d14f18d-db2b-4847-9ac1-144cb93b2541|Trashed]]", label: "Trashed" },
  { value: "[[c42245d0-01de-4c35-bfcf-d910445ea28e]]", wikilink: "[[c42245d0-01de-4c35-bfcf-d910445ea28e|Draft]]", label: "Draft" },
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

// RFC 31c1a0be Phase 4 PR-C (#3194). Legacy symbolic-form short-name to label
// map. UI surfaces (table renderers, kanban) may receive stale symbolic
// values written before the UUID-canon migration; this preserves the
// human-readable label for both forms. Stage 5 will remove this map alongside
// the `EffortStatus` enum deletion.
const SYMBOLIC_STATUS_LABEL_FALLBACK: Record<string, string> = {
  emseffortstatusdraft: "Draft",
  emseffortstatusbacklog: "Backlog",
  emseffortstatusanalysis: "Analysis",
  emseffortstatustodo: "To Do",
  emseffortstatusdoing: "Doing",
  emseffortstatusdone: "Done",
  emseffortstatustrashed: "Trashed",
};

export function getStatusLabel(statusUri: string | null | undefined): string {
  if (!statusUri || statusUri.trim() === "") return "-";
  // Strip wikilink brackets and optional `|alias` suffix.
  // Frontmatter may store "[[ems__EffortStatusDoing 027e78f4-...]]" (class
  // name + UUID) after certain status transitions, or "[[<UUID>|Doing]]"
  // (UUID + alias). The space-separated trailing UUID is stripped so the
  // class-name lookup still matches.
  const normalized = statusUri
    .replace(/[[\]"']/g, "")
    .split("|")[0]
    .trim()
    .replace(
      /\s+[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      "",
    )
    .toLowerCase();

  // UUID-form lookup against the canonical EFFORT_STATUS_VALUES table.
  const match = EFFORT_STATUS_VALUES.find(
    (v) =>
      v.value.replace(/[[\]]/g, "").toLowerCase() === normalized ||
      v.label.toLowerCase() === normalized,
  );
  if (match) return match.label;

  // Backward-compatibility lookup against the legacy symbolic form. The
  // double-underscore is stripped during normalization (the `[[`/`]]` regex
  // does not strip underscores, so we collapse them here).
  const symbolicKey = normalized.replace(/_/g, "");
  const symbolicLabel = SYMBOLIC_STATUS_LABEL_FALLBACK[symbolicKey];
  if (symbolicLabel) return symbolicLabel;

  return statusUri;
}
