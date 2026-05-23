/**
 * User-input factory — Phase 1 integration helper (RFC v4 §7.1a contract).
 *
 * Synthesises `--input '<JSON>'` payloads for starter-kit commands whose
 * `exocmd__Grounding_inputSchema` declares a JSON Schema object. The factory
 * is deliberately narrow: it maps the 5 conceptual field types documented in
 * memory `reference_inputschema_field_mapping` (text / date / enum / multiline
 * / assetRef) to deterministic fixture values, so the same parametrized test
 * case emits the same `--input` payload across runs.
 *
 * Field name contract: downstream `GroundingExecutor.substituteVariables`
 * substitutes `$input` / `$value` with `userInput.value`. Schemas with the
 * field `value` are passed through; schemas with the field `label` (used by
 * `create_instance` groundings) are also passed through under that name.
 * Any other property name is flagged as unsupported — we don't silently
 * rename fields.
 *
 * RFC v4 §12 gate: matching unit test lives at
 * `packages/cli/tests/unit/test-helpers/user-input-factory.test.ts`.
 */

/** Conceptual field-type families recognised by the factory. */
export type FieldType =
  | "text"
  | "multiline"
  | "date"
  | "enum"
  | "assetRef";

/** JSON-Schema shape (narrow subset the starter-kit actually uses). */
export interface JsonSchemaField {
  readonly type?: string;
  readonly format?: string;
  readonly enum?: readonly unknown[];
  readonly title?: string;
  /** Non-standard marker for multi-line input (mirrors plugin convention). */
  readonly multiline?: boolean;
}

export interface JsonSchemaObject {
  readonly type?: "object";
  readonly properties?: Readonly<Record<string, JsonSchemaField>>;
  readonly required?: readonly string[];
}

/** Result emitted by `buildUserInputForSchema`. */
export interface UserInputResult {
  /** JSON object suitable for `dyncommand exec --input`. */
  readonly payload: Record<string, unknown>;
  /** Conceptual type recognised for the payload field. */
  readonly fieldType: FieldType;
  /** Payload property name (`value` for $input/$value substitution). */
  readonly fieldName: string;
}

/** Deterministic constants per RFC §7.1a § "buildUserInputFor contract". */
export const DEFAULT_DATE = "2026-04-20";
export const DEFAULT_TEXT_PREFIX = "test-input-";
export const DEFAULT_MULTILINE_PREFIX = "test-multiline-";

/**
 * Classify a JSON-schema field into one of the 5 conceptual families.
 *
 * Algorithm:
 *   - `enum` present                               → `enum`
 *   - `format === "asset-reference"` or `"assetRef"` → `assetRef`
 *   - `format === "date"` or `"date-time"`         → `date`
 *   - `format === "textarea"` or `multiline === true` → `multiline`
 *   - otherwise (incl. `type === "string"` bare)  → `text`
 */
export function classifyField(field: JsonSchemaField | undefined): FieldType {
  if (!field) return "text";
  if (Array.isArray(field.enum) && field.enum.length > 0) return "enum";
  const fmt = field.format?.toLowerCase();
  if (fmt === "asset-reference" || fmt === "assetref") return "assetRef";
  if (fmt === "date" || fmt === "date-time") return "date";
  if (fmt === "textarea" || field.multiline === true) return "multiline";
  return "text";
}

/**
 * Synthesise a deterministic value for a single field.
 *
 * `seed` is incorporated into text-like results so parametrized tests over
 * distinct commands emit distinct payloads. `assetRefSeedUuid` is the UUID
 * of a pre-created seed fixture the caller will have materialised via
 * `fixture-factory` — reused as the `[[<uuid>]]` value.
 */
export function synthesiseFieldValue(
  fieldType: FieldType,
  field: JsonSchemaField | undefined,
  seed: string,
  assetRefSeedUuid?: string,
): unknown {
  switch (fieldType) {
    case "enum": {
      const first = field?.enum?.[0];
      if (first === undefined) {
        throw new Error(
          "user-input-factory: classified as enum but schema has no options",
        );
      }
      return first;
    }
    case "date":
      return DEFAULT_DATE;
    case "multiline":
      return `${DEFAULT_MULTILINE_PREFIX}${seed}`;
    case "assetRef":
      if (!assetRefSeedUuid) {
        throw new Error(
          "user-input-factory: assetRef field requires `assetRefSeedUuid`",
        );
      }
      return `[[${assetRefSeedUuid}]]`;
    case "text":
    default:
      return `${DEFAULT_TEXT_PREFIX}${seed}`;
  }
}

export interface BuildUserInputOptions {
  readonly seed: string;
  /** UUID of a pre-materialised asset fixture used for `assetRef` fields. */
  readonly assetRefSeedUuid?: string;
}

/**
 * Build a deterministic `{ [fieldName]: value }` payload from a JSON schema.
 * Returns `undefined` when the schema has no properties (the command does
 * not require userInput — `--input` flag should be omitted entirely).
 *
 * Throws on unsupported shapes rather than guessing — silent fallback is the
 * class of bug that caused the CLI parity sprint's `userInput` silent-fail
 * memories.
 */
export function buildUserInputForSchema(
  schema: JsonSchemaObject | undefined,
  opts: BuildUserInputOptions,
): UserInputResult | undefined {
  if (!schema || !schema.properties) return undefined;
  const entries = Object.entries(schema.properties);
  if (entries.length === 0) return undefined;
  if (entries.length > 1) {
    throw new Error(
      `user-input-factory: multi-field schemas unsupported (${entries.length} fields); starter-kit commands use single-field inputs`,
    );
  }
  const [fieldName, field] = entries[0];
  if (fieldName !== "value" && fieldName !== "label") {
    throw new Error(
      `user-input-factory: unsupported field name "${fieldName}" — only "value" (for $input/$value substitution) and "label" (for create_instance) are recognised`,
    );
  }
  const fieldType = classifyField(field);
  const payload: Record<string, unknown> = {
    [fieldName]: synthesiseFieldValue(
      fieldType,
      field,
      opts.seed,
      opts.assetRefSeedUuid,
    ),
  };
  return { payload, fieldName, fieldType };
}

/**
 * Parse the inline `exocmd__Grounding_inputSchema` frontmatter string into a
 * `JsonSchemaObject`. Starter-kit stores schemas as inline JSON strings in the
 * grounding frontmatter. Returns `undefined` when the field is absent or
 * malformed (so tests skip `--input` gracefully instead of crashing).
 */
export function parseInputSchemaFromGroundingRaw(
  raw: unknown,
): JsonSchemaObject | undefined {
  if (typeof raw !== "string" || raw.trim().length === 0) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as JsonSchemaObject;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * Convenience: given a grounding frontmatter record + build options, resolve
 * the inputSchema and synthesise the payload in one call. Production call
 * sites use this; unit tests exercise `buildUserInputForSchema` directly.
 */
export function buildUserInputForGroundingFrontmatter(
  groundingFrontmatter: Record<string, unknown> | undefined,
  opts: BuildUserInputOptions,
): UserInputResult | undefined {
  const schema = parseInputSchemaFromGroundingRaw(
    groundingFrontmatter?.["exocmd__Grounding_inputSchema"],
  );
  return buildUserInputForSchema(schema, opts);
}
