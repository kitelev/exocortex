/**
 * @file UID maps for GroundingType catalog homoiconization (RFC 9d20c91f Phase 1).
 *
 * Maps GroundingType enum values to vault asset UIDs (and back) so the
 * dispatcher can read `exocmd__Grounding_type` as a wikilink reference
 * into the `exocmd__GroundingType` class catalog (vault assets under
 * shared submodule `kitelev/exoas-exocmd@4f49881`).
 *
 * Pattern mirrors `TaskTrackingService.ts:97-107` (ems__EffortStatus
 * UID-identity dispatch precedent verified during RFC 9d20c91f Phase 0.4
 * multi-agent review).
 *
 * Updates to this file MUST keep the bijection invariant — enforced by
 * `tests/unit/domain/constants/GroundingTypeParity.test.ts`.
 */

import { GroundingType } from "./GroundingType";

/**
 * Vault asset UID for each GroundingType enum value.
 * UIDs allocated in RFC 9d20c91f Phase 1 commit `4f49881`.
 *
 * Stability contract: these UIDs are load-bearing forever. Do not rename
 * vault assets without coordinating a TS update + parity-guard test pass.
 */
export const GROUNDING_TYPE_UIDS: Readonly<Record<GroundingType, string>> = {
  [GroundingType.PROPERTY_SET]:        "cf3bb923-f1f1-40be-b728-782844402426",
  [GroundingType.PROPERTY_DELETE]:     "4bdf1d0b-e9da-4d96-bafe-c5aaef8c2bd5",
  [GroundingType.COMPOSITE]:           "8f9a57db-3865-4886-92fb-c5ab7f3c3fa3",
  [GroundingType.SERVICE_CALL]:        "9bf9fc99-ac37-4e51-b9f5-bd920099947c",
  [GroundingType.CREATE_INSTANCE]:     "4367e2d6-6c92-450a-becb-abce1fb07682",
  [GroundingType.PROPERTY_APPEND]:     "572f7e69-a8a1-42f6-8113-5aa65cc4b552",
  [GroundingType.PROPERTY_INCREMENT]:  "afc29f90-45eb-4f94-9fe2-2ce738759161",
  [GroundingType.PROPERTY_SHIFT]:      "f4e5266f-f3cc-49fd-a5a5-ce1e8b7847a4",
  [GroundingType.SPARQL_UPDATE]:       "79c3e709-8d1d-4694-bcc6-b9ff07d59b86",
  // RFC 36347daf Phase 2 — workflow_transition catalog instance
  [GroundingType.WORKFLOW_TRANSITION]: "5c1a2552-d576-496d-8823-563573dd1e2f",
  // Subproject 17f58ebe Веха 3 — body_template catalog instance (exoas-exocmd)
  [GroundingType.BODY_TEMPLATE]:       "6093bfcb-cf9b-4565-86c3-ff74d8bc11c0",
} as const;

/**
 * Reverse map: UID → GroundingType. Used to resolve a wikilink-form
 * frontmatter value (`exocmd__Grounding_type: "[[<uid>]]"`) back to the
 * enum dispatched by `GroundingExecutor`.
 */
export const GROUNDING_TYPE_UID_TO_ENUM: Readonly<Record<string, GroundingType>> =
  Object.freeze(
    Object.fromEntries(
      (Object.entries(GROUNDING_TYPE_UIDS) as [GroundingType, string][]).map(
        ([k, v]) => [v, k],
      ),
    ) as Record<string, GroundingType>,
  );

const EXOCMD_NAMESPACE = "https://exocortex.my/ontology/exocmd#";

/**
 * Symbolic class-IRI → GroundingType. Emitted by NoteToRDFConverter when
 * the wikilink target's `exo__Asset_label` matches the namespace prefix
 * regex (Issue #2782 class-IRI substitution path).
 *
 * Empirically verified 2026-05-25: a frontmatter value
 * `exocmd__Grounding_type: "[[cf3bb923-...]]"` results in a triple
 * `<grounding> exocmd:Grounding_type <https://exocortex.my/ontology/exocmd#GroundingTypePropertySet>`
 * (symbolic, not file-IRI) because the resolved vault asset's label is
 * `exocmd__GroundingTypePropertySet`.
 */
export const GROUNDING_TYPE_IRI_TO_ENUM: Readonly<Record<string, GroundingType>> = Object.freeze({
  [`${EXOCMD_NAMESPACE}GroundingTypePropertySet`]:       GroundingType.PROPERTY_SET,
  [`${EXOCMD_NAMESPACE}GroundingTypePropertyDelete`]:    GroundingType.PROPERTY_DELETE,
  [`${EXOCMD_NAMESPACE}GroundingTypeComposite`]:         GroundingType.COMPOSITE,
  [`${EXOCMD_NAMESPACE}GroundingTypeServiceCall`]:       GroundingType.SERVICE_CALL,
  [`${EXOCMD_NAMESPACE}GroundingTypeCreateInstance`]:    GroundingType.CREATE_INSTANCE,
  [`${EXOCMD_NAMESPACE}GroundingTypePropertyAppend`]:    GroundingType.PROPERTY_APPEND,
  [`${EXOCMD_NAMESPACE}GroundingTypePropertyIncrement`]: GroundingType.PROPERTY_INCREMENT,
  [`${EXOCMD_NAMESPACE}GroundingTypePropertyShift`]:     GroundingType.PROPERTY_SHIFT,
  [`${EXOCMD_NAMESPACE}GroundingTypeSparqlUpdate`]:      GroundingType.SPARQL_UPDATE,
  [`${EXOCMD_NAMESPACE}GroundingTypeWorkflowTransition`]: GroundingType.WORKFLOW_TRANSITION,
  [`${EXOCMD_NAMESPACE}GroundingTypeBodyTemplate`]:      GroundingType.BODY_TEMPLATE,
});

const UUID_PATTERN = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

/**
 * Resolve a triple-store IRI value of `exocmd:Grounding_type` to its
 * GroundingType enum value. Handles two IRI shapes:
 *
 * 1. Symbolic class IRI emitted by Issue #2782 substitution
 *    (`https://exocortex.my/ontology/exocmd#GroundingTypePropertySet`)
 * 2. File IRI fallback emitted when label substitution doesn't apply
 *    (`obsidian://vault/<path>/<uid>.md`) — UID extracted from basename
 *
 * Returns `null` for unknown IRIs (caller treats as inert grounding).
 */
export function resolveGroundingTypeFromIRI(iri: string): GroundingType | null {
  const symbolic = GROUNDING_TYPE_IRI_TO_ENUM[iri];
  if (symbolic !== undefined) return symbolic;

  const uidMatch = iri.match(UUID_PATTERN);
  if (uidMatch) {
    return GROUNDING_TYPE_UID_TO_ENUM[uidMatch[1].toLowerCase()] ?? null;
  }

  return null;
}

/**
 * Resolve a raw frontmatter string value (read directly via
 * `app.metadataCache.getFileCache(file).frontmatter["exocmd__Grounding_type"]`,
 * NOT through the triple store) to a GroundingType enum.
 *
 * Handles wikilink-literal form `"[[<uid>]]"` or `"[[<uid>|<alias>]]"`.
 * Returns null for unknown UIDs.
 *
 * Used by CLI BDD parsers (grounding.steps.ts, extract-target-class.ts,
 * audit-starter-kit-groundings.mjs) that bypass the triple store.
 */
export function resolveGroundingTypeFromWikilinkLiteral(value: string): GroundingType | null {
  const wikilinkMatch = value.match(/^\[\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\|[^\]]*)?\]\]$/i);
  if (!wikilinkMatch) return null;
  return GROUNDING_TYPE_UID_TO_ENUM[wikilinkMatch[1].toLowerCase()] ?? null;
}
