import type {
  PropertySchemaResolver,
  ClassHierarchyResolver,
  EnumValueResolver,
  EnumValue,
  ClassPropertyField,
  ClassPropertyResolver,
  RequiredPropertyFieldType,
} from "@kitelev/exocortex-core";
import { EFFORT_STATUS_UID, EffortStatus } from "@kitelev/exocortex-core/domain/constants";
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
//
// Because the UUIDs are written into user frontmatter verbatim, a UUID whose
// TBox asset no longer exists becomes a dangling wikilink. Analysis
// (cde3525c-…) and To Do (6a0e933a-…) were deleted from the shared ontology
// (exoas-public@c35a660d, 2026-08-13) and dropped here; Waiting (0610947c-…)
// took their place — req fcbde537-f09a-410e-8bee-d3d607a70302. Resolve any
// new UUID on disk before adding it.
/**
 * Порядок ВЫПАДАЮЩЕГО СПИСКА — не порядок канона, и это намеренно.
 *
 * `EFFORT_STATUS_UID` перечисляет статусы по жизненному циклу
 * (`Draft → Backlog → Doing → Waiting → Done → Trashed`), а список показывает
 * сперва рабочие статусы и уводит `Draft` в конец. Это два разных решения:
 * канон — про модель, порядок ниже — про UX. Поэтому он объявлен ЯВНО, а из
 * канона берутся только UID.
 *
 * ⛔ Не заменять на `Object.keys(EFFORT_STATUS_UID)` — это молча переставит
 * `Draft` на первую позицию.
 */
const FALLBACK_STATUS_ORDER: readonly EffortStatus[] = [
  EffortStatus.BACKLOG,
  EffortStatus.DOING,
  EffortStatus.WAITING,
  EffortStatus.DONE,
  EffortStatus.TRASHED,
  EffortStatus.DRAFT,
];

/**
 * Выведено из канона: UID больше не дублируются здесь литералами. До этого
 * шесть UID жили копией, и расхождение с `EFFORT_STATUS_UID` прошло бы молча —
 * ни один тест не сравнивал два списка.
 */
const FALLBACK_EFFORT_STATUS_VALUES: StatusEnumValue[] = FALLBACK_STATUS_ORDER.map(
  (symbol) => {
    const uid = EFFORT_STATUS_UID[symbol];
    const label = symbol.replace(/^ems__EffortStatus/, "");
    return { value: `[[${uid}]]`, wikilink: `[[${uid}|${label}]]`, label };
  },
);

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
    // req 960d7a3f: the TBox-declared archive flag (exoas-exo 79ca4e3e).
    // `exo__Asset_isArchived` is a read-only compat alias and is not offered
    // for editing; the property editor writes the canonical key.
    name: "exo__Asset_archived",
    type: "boolean",
    required: false,
    label: "Archived",
  },
];

/* ---------------------------------------------------------------------------
 * req 9e19f141 — the schema provider is fed by the DECLARED-property resolver
 * (`createTripleStoreClassPropertyResolver`, req 07509cf9, v16.246.0) instead of
 * the OWL layer below, which is dead on live data: nothing ever calls
 * `initPropertySchemaService`, so `_schemaService` is `null` and EVERY class got
 * the four `FALLBACK_PROPERTIES` (two of them read-only ⇒ two editable fields,
 * and zero `wikilink` keys ⇒ an always-empty relations picker).
 *
 * Measured on vault-exodev (--no-cache, 2026-09-22): the `ems__Task` chain
 * (Task + Effort + Asset) DECLARES 72 properties; 37 carry `exo__Property_range`
 * (all 37 object ranges — zero datatype ones) and 35 carry none, so those 35 get
 * `text` from the engine's `fieldTypeFromRange` fallback. Retiring the OWL layer
 * itself is ticket bd752a24, so it stays wired as the middle fallback here.
 * ------------------------------------------------------------------------- */

/**
 * Engine field type → property-editor field type. Every branch is load-bearing:
 * `assetRef` is what turns a declared object property into a reference picker
 * (and therefore into a Relations-section option), and `date` is the engine's
 * name for both `xsd:date` and `xsd:dateTime`, which this editor renders with
 * its `TimestampField`.
 */
const SCHEMA_FIELD_TYPE: Record<RequiredPropertyFieldType, PropertyFieldType> = {
  text: "text",
  date: "timestamp",
  number: "number",
  boolean: "boolean",
  assetRef: "wikilink",
};

/**
 * Read-only is NOT something the graph declares, so a DECLARED property has to
 * inherit the decision the fallback list already encodes. DERIVED from
 * `FALLBACK_PROPERTIES` rather than re-authored: a hand-copied list would be a
 * claim with no mechanism behind it and would drift from its source silently.
 *
 * ⚠ It covers exactly the keys the fallback marks — `exo__Asset_uid` and
 * `exo__Asset_createdAt`. `exo__Asset_updatedAt` and the DEPRECATED
 * `exo__Asset_isArchived` are declared on the `ems__Task` chain too and become
 * editable here. Deriving them from the graph instead is not possible today:
 * a read-only signal exists in the dead OWL layer's query (`exo:schema_readOnly`,
 * `PropertySchemaResolver`) but has ZERO live carriers — measured on vault-exodev
 * 2026-09-22 with `--no-cache`, canary `exo__Property_minCount` = 44 through the
 * same query path — and a deprecation-aware filter would change the resolver,
 * which req 9e19f141 lists as a Non-goal. Both are named in the PR body.
 */
const FALLBACK_READ_ONLY_KEYS: ReadonlySet<string> = new Set(
  FALLBACK_PROPERTIES.filter((p) => p.readOnly).map((p) => p.name),
);

/** Map the engine's declared-property fields onto the editor's schema shape. */
export function classPropertyFieldsToSchema(
  fields: readonly ClassPropertyField[],
): PropertySchemaDefinition[] {
  return fields.map((f) => ({
    name: f.propertyKey,
    type: SCHEMA_FIELD_TYPE[f.fieldType],
    // `minCount > 0` is already a FLAG on the field (req 07509cf9) — no second
    // pass over the graph is needed to tell a mandatory field from an optional.
    required: f.required,
    label: f.label || f.propertyKey,
    ...(FALLBACK_READ_ONLY_KEYS.has(f.propertyKey) ? { readOnly: true } : {}),
  }));
}

let _classPropertyResolver: ClassPropertyResolver | null = null;

/**
 * Wire (or clear, with `null`) the declared-property resolver. Called by the
 * surface that owns a live triple store — the property editor modal — so the
 * god-file `ExocortexPlugin.ts` and the three production call-sites of
 * `createTripleStoreRequiredPropertyResolver` stay byte-identical (req 07509cf9).
 */
export function initClassPropertyResolver(
  resolver: ClassPropertyResolver | null,
): void {
  _classPropertyResolver = resolver;
}

export function getClassPropertyResolver(): ClassPropertyResolver | null {
  return _classPropertyResolver;
}

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
  // req 9e19f141 — declared properties first. An empty result is the honest
  // "this class declares nothing" answer, and it falls through to the previous
  // behaviour rather than shadowing it.
  if (_classPropertyResolver) {
    const declared = await _classPropertyResolver(instanceClass);
    if (declared.length > 0) {
      return classPropertyFieldsToSchema(declared);
    }
  }
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
// This map is READ-only (rendering), never a write path, so it deliberately
// KEEPS `analysis` / `todo` even though those TBox instances were deleted
// (req fcbde537-f09a-410e-8bee-d3d607a70302): assets written before the
// 2026-08-13 migration may still carry those values, and rendering "To Do"
// beats rendering a raw URI. Do not prune them — add new statuses instead.
const SYMBOLIC_STATUS_LABEL_FALLBACK: Record<string, string> = {
  emseffortstatusdraft: "Draft",
  emseffortstatusbacklog: "Backlog",
  emseffortstatusanalysis: "Analysis",
  emseffortstatustodo: "To Do",
  emseffortstatusdoing: "Doing",
  emseffortstatuswaiting: "Waiting",
  emseffortstatusdone: "Done",
  emseffortstatustrashed: "Trashed",
};

/**
 * ⛤ One of THREE readers of the same `ems__Effort_status` vocabulary; they disagree on edge
 * shapes, so a change to the status forms has to visit all three (multi-parser-predicate-
 * migration). This one is UID-table based, via FALLBACK_EFFORT_STATUS_VALUES.
 *
 * @see GroundingExecutor.resolveStatusFromFrontmatter (core) — also UID-table based
 * @see resolveStatusLabel in core domain/display-name/hostFunctions — vault-lookup based
 */
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
