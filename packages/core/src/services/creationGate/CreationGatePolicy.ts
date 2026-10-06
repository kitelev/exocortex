import {
  CREATION_GATE_FIELD_UIDS,
  type CreationGateField,
} from "./CreationGateContract";
import {
  isUuid,
  refsOf,
  textOf,
  valuesOf,
  type ParsedRef,
} from "./refs";

/**
 * Resolve a bare reference target (a UID, a label, an alias or a file
 * basename) to the frontmatter of the asset it names; `null` when nothing in
 * the vault answers to it.
 */
export type FrontmatterByRef = (
  ref: string,
) => Promise<Record<string, unknown> | null>;

export interface CreationGateDeps {
  readonly frontmatterByRef: FrontmatterByRef;
}

/** The compiled `exemptEvidence` field. */
export interface CreationGateEvidence {
  readonly source: string;
  /** `null` when the pattern does not compile — the evidence path is then closed. */
  readonly regex: RegExp | null;
  readonly error: string | null;
}

/**
 * One rule asset, parsed. Every field is DATA read from the asset; an empty
 * list / `null` means the field is absent (or present under a key that does not
 * resolve to the field's property asset) — the evaluator treats that as a
 * broken rule, fail-closed within the area the rule is known to cover.
 */
export interface CreationGatePolicy {
  readonly uid: string;
  readonly label: string;
  readonly path: string;
  /** `exo__Asset_description` — the "how to do it right" line of a refusal. */
  readonly description: string | null;
  readonly guardedClass: readonly ParsedRef[];
  readonly excludedClass: readonly ParsedRef[];
  readonly exemptClass: readonly ParsedRef[];
  readonly exemptEvidence: CreationGateEvidence | null;
  /** Frontmatter key of the chain property (the property asset's label). */
  readonly chainKey: string | null;
  readonly anchorClass: readonly ParsedRef[];
  readonly directionKey: string | null;
  readonly statusKey: string | null;
  readonly allowedStatus: readonly ParsedRef[];
}

const FIELD_BY_UID = new Map<string, CreationGateField>(
  (Object.entries(CREATION_GATE_FIELD_UIDS) as [CreationGateField, string][]).map(
    ([field, uid]) => [uid.toLowerCase(), field],
  ),
);

/**
 * Only `<prefix>__<Name>` keys can name a property asset; `aliases` and other
 * plain keys are not looked up at all (a miss would cost a vault-wide label /
 * alias pass for nothing).
 */
const PROPERTY_KEY_SHAPE = /^[A-Za-z][A-Za-z0-9]*__\S+$/;

/**
 * The asset-level platform keys every asset carries (`exo__Asset_uid`,
 * `exo__Asset_label`, `exo__Instance_class`, …) have their own meaning and can
 * never be a rule field, so they are not looked up: a vault whose TBox lacks
 * one of them would otherwise pay a vault-wide label/alias pass per key and
 * undo `create`'s cache-narrowed planning (#4291).
 */
const PLATFORM_KEY = /^exo__(Asset|Instance)_/;

/** The frontmatter key a property reference stands for. */
async function propertyKeyOf(
  values: readonly unknown[],
  deps: CreationGateDeps,
): Promise<string | null> {
  const ref = refsOf(values)[0];
  if (!ref) return null;
  const property = await deps.frontmatterByRef(ref.target);
  const label = property ? textOf(property.exo__Asset_label) : null;
  if (label) return label;
  // Unresolvable: a label-form reference already IS the key; for a bare UID
  // the alias is the only name left.
  if (!isUuid(ref.target)) return ref.target;
  return ref.alias;
}

function compileEvidence(values: readonly unknown[]): CreationGateEvidence | null {
  const source = valuesOf(values).find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  if (source === undefined) return null;
  try {
    // `i`: evidence is matched without regard to case (onto-RFC §Семантика
    // п.5/п.10) — "pr #12" and "PR #12" are the same evidence.
    return { source, regex: new RegExp(source, "i"), error: null };
  } catch (error) {
    return {
      source,
      regex: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Parse a rule asset's frontmatter. A rule field is recognised by the UID of
 * the property asset its key resolves to (label or alias), never by the key's
 * spelling (onto-RFC §Семантика п.2).
 */
export async function parseCreationGatePolicy(
  frontmatter: Record<string, unknown>,
  path: string,
  deps: CreationGateDeps,
): Promise<CreationGatePolicy> {
  const fields: Partial<Record<CreationGateField, unknown[]>> = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    if (!PROPERTY_KEY_SHAPE.test(key) || PLATFORM_KEY.test(key)) continue;
    const property = await deps.frontmatterByRef(key);
    const propertyUid = property ? textOf(property.exo__Asset_uid) : null;
    const field = propertyUid
      ? FIELD_BY_UID.get(propertyUid.toLowerCase())
      : undefined;
    if (!field) continue;
    (fields[field] ??= []).push(...valuesOf(value));
  }

  const basename = path.replace(/^.*\//, "").replace(/\.md$/i, "");
  const uid = textOf(frontmatter.exo__Asset_uid) ?? basename;
  return {
    uid,
    label: textOf(frontmatter.exo__Asset_label) ?? uid,
    path,
    description: textOf(frontmatter.exo__Asset_description),
    guardedClass: refsOf(fields.guardedClass),
    excludedClass: refsOf(fields.excludedClass),
    exemptClass: refsOf(fields.exemptClass),
    exemptEvidence: compileEvidence(fields.exemptEvidence ?? []),
    chainKey: await propertyKeyOf(fields.chainProperty ?? [], deps),
    anchorClass: refsOf(fields.anchorClass),
    directionKey: await propertyKeyOf(fields.directionProperty ?? [], deps),
    statusKey: await propertyKeyOf(fields.statusProperty ?? [], deps),
    allowedStatus: refsOf(fields.allowedStatus),
  };
}

/** The chain fields a rule lacks, by their RFC names (empty when complete). */
export function missingChainFields(policy: CreationGatePolicy): string[] {
  const missing: string[] = [];
  if (!policy.chainKey) missing.push("chainProperty");
  if (policy.anchorClass.length === 0) missing.push("anchorClass");
  if (!policy.directionKey) missing.push("directionProperty");
  if (!policy.statusKey) missing.push("statusProperty");
  if (policy.allowedStatus.length === 0) missing.push("allowedStatus");
  return missing;
}
