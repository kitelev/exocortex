import { GroundingType } from "../constants/GroundingType";
import { resolveGroundingTypeFromWikilinkLiteral } from "../constants/GroundingTypeUIDs";
import type { GroundingDefinition } from "./CommandDefinition";

/**
 * Normalize a raw `exocmd__Grounding_*` wikilink/ref value to the bare
 * identifier used to look the referenced asset up by UID.
 *
 * Strips surrounding quote + bracket characters, trims, and keeps the portion
 * BEFORE any `|` alias separator (i.e. the wikilink target). Non-string input
 * yields `""`.
 *
 * ⚠️ Intentionally NOT `WikiLinkHelpers.normalize`. Two behaviours diverge:
 *   1. For UUID-alias form `"[[<uuid>|<alias>]]"`, `WikiLinkHelpers.normalize`
 *      returns the ALIAS (the uuid is treated as an opaque pointer), whereas
 *      grounding refs need the TARGET uuid to resolve the step / value asset
 *      by UID — so this helper returns the part before `|`.
 *   2. This helper also strips surrounding quote chars (`"` / `'`), which
 *      `WikiLinkHelpers.normalize` does not.
 * Sharing the helper would silently change grounding-parsing behaviour, so the
 * grounding-specific normalization is kept local and identical to the form the
 * CLI BDD parser relied on.
 */
function normalizeGroundingRef(value: unknown): string {
  if (typeof value !== "string") return "";
  const stripped = value.replace(/["'[\]]/g, "").trim();
  const pipe = stripped.indexOf("|");
  return pipe >= 0 ? stripped.slice(0, pipe).trim() : stripped;
}

/**
 * Map a raw `exocmd__Grounding` frontmatter record (read directly via
 * `parseFrontmatter` / `getFileCache(file).frontmatter`, NOT through the triple
 * store) to a {@link GroundingDefinition}.
 *
 * This is the canonical, pure field-mapping for the **raw-frontmatter** path.
 * It is deliberately separate from `CommandResolver`, which builds a
 * `GroundingDefinition` from the **triple store** (async, RDF graph) — a
 * different mechanism. This function owns only the synchronous
 * `Record<string, unknown> → GroundingDefinition` contract used by CLI / BDD
 * parsers that bypass the triple store, eliminating the previously-duplicated
 * ~16-key mapping that had to be manually re-synced on every RFC migration.
 *
 * Composite sub-step resolution is delegated to the caller via {@link resolveStep}
 * (which receives an already-normalized step UID); all filesystem / index
 * lookup and recursion-depth guarding stay in the caller.
 *
 * Mapping nuances preserved verbatim:
 * - `type` resolves via {@link resolveGroundingTypeFromWikilinkLiteral}; a
 *   non-string value passes through untouched; a legacy literal-string form
 *   throws (RFC 9d20c91f Phase 4 — wikilink-only).
 * - For `service_call`, `targetProperty` reads `exocmd__Grounding_serviceId`
 *   first, falling back to `exocmd__Grounding_targetProperty`.
 * - `incrementBy` is `parseInt`-ed (finite-guarded; blank/null/undefined skip).
 * - `targetValueRef` is unwrapped via {@link normalizeGroundingRef}.
 *
 * @param uid asset UID of the grounding (becomes `id`).
 * @param fm raw frontmatter record.
 * @param resolveStep resolves a composite sub-step from its normalized UID.
 */
export function parseGroundingDefinitionFromFrontmatter(
  uid: string,
  fm: Record<string, unknown>,
  resolveStep: (stepUid: string) => GroundingDefinition,
): GroundingDefinition {
  const rawType = fm["exocmd__Grounding_type"];
  const type = ((): GroundingType => {
    if (typeof rawType !== "string") return rawType as GroundingType;
    const resolved = resolveGroundingTypeFromWikilinkLiteral(rawType);
    if (resolved !== null) return resolved;
    throw new Error(
      `[exocmd-grounding-type-literal-form] legacy literal-string '${rawType}' for exocmd__Grounding_type in fixture ${uid}. Migrate to wikilink form per RFC 9d20c91f Phase 3.`,
    );
  })();

  const targetProperty =
    type === "service_call"
      ? (fm["exocmd__Grounding_serviceId"] as string | undefined) ??
        (fm["exocmd__Grounding_targetProperty"] as string | undefined)
      : (fm["exocmd__Grounding_targetProperty"] as string | undefined);

  let steps: GroundingDefinition[] | undefined;
  if (type === "composite") {
    const rawSteps = fm["exocmd__Grounding_steps"];
    if (Array.isArray(rawSteps)) {
      steps = rawSteps.map((ref) => resolveStep(normalizeGroundingRef(ref)));
    }
  }

  const incrementByRaw = fm["exocmd__Grounding_incrementBy"];
  let incrementBy: number | undefined;
  if (
    incrementByRaw !== undefined &&
    incrementByRaw !== null &&
    incrementByRaw !== ""
  ) {
    const parsed = Number.parseInt(String(incrementByRaw), 10);
    if (Number.isFinite(parsed)) incrementBy = parsed;
  }

  const rawTargetValueRef = fm["exocmd__Grounding_targetValueRef"] as
    | string
    | undefined;
  const targetValueRef = rawTargetValueRef
    ? normalizeGroundingRef(rawTargetValueRef)
    : undefined;

  // Subproject 17f58ebe Веха 3 — body_template grounding fields. templateRef is
  // a wikilink to an exotemplate__Template asset → normalized to its bare UID.
  const rawTemplateRef = fm["exocmd__Grounding_templateRef"] as
    | string
    | undefined;
  const templateRef = rawTemplateRef
    ? normalizeGroundingRef(rawTemplateRef)
    : undefined;

  // `create_instance` target-body clone flag (req 915b20b2). Tolerates the
  // YAML boolean `true` and the string literal `"true"` (vault serialisers may
  // emit either); anything else → not cloned.
  const rawCloneTargetBody = fm["exocmd__Grounding_cloneTargetBody"];
  const cloneTargetBody =
    rawCloneTargetBody === true || rawCloneTargetBody === "true";

  // Issue #3867 — composite-step opt-in: mutate the just-created instance
  // instead of the click-target. Same boolean-tolerant coercion as
  // `cloneTargetBody`. (Parity with CommandResolver — the production loader.)
  const rawTargetsCreatedInstance = fm["exocmd__Grounding_targetsCreatedInstance"];
  const targetsCreatedInstance =
    rawTargetsCreatedInstance === true || rawTargetsCreatedInstance === "true";

  return {
    id: uid,
    label: (fm["exo__Asset_label"] as string) ?? "",
    type,
    targetProperty,
    targetValueRef,
    targetValueLiteral: fm["exocmd__Grounding_targetValueLiteral"] as
      | string
      | undefined,
    targetValueSubstitution: fm["exocmd__Grounding_targetValueSubstitution"] as
      | string
      | undefined,
    serviceCallPayload: fm["exocmd__Grounding_serviceCallPayload"] as
      | string
      | undefined,
    appendExpression: fm["exocmd__Grounding_appendExpression"] as
      | string
      | undefined,
    targetClass: fm["exocmd__Grounding_targetClass"] as string | undefined,
    targetPrototype: fm["exocmd__Grounding_targetPrototype"] as
      | string
      | undefined,
    targetFolder: fm["exocmd__Grounding_targetFolder"] as string | undefined,
    shiftDelta: fm["exocmd__Grounding_shiftDelta"] as string | undefined,
    incrementBy,
    linkBackProperty: fm["exocmd__Grounding_linkBackProperty"] as
      | string
      | undefined,
    bodyTemplate: fm["exocmd__Grounding_bodyTemplate"] as string | undefined,
    templateRef,
    cloneTargetBody,
    targetsCreatedInstance,
    steps,
  };
}
