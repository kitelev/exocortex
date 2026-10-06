/**
 * The SCHEMA CONTRACT of the creation gate (onto-RFC 4a8d887a, req
 * f5b79260-f87c-4e73-8a34-19da341c7ec9) — the only identifiers the engine knows
 * by heart.
 *
 * ⛔ Homoiconicity (Q3): this file names the rule CLASS and the nine rule
 * PROPERTIES — the shape a rule asset has — and nothing else. Which classes are
 * guarded, which chain leads to an approved direction, which statuses allow,
 * what is exempt and by which evidence: all of that is DATA of a rule asset in
 * the vault, read at run time. A value of a rule written here would make the
 * rule un-editable without a release (AC7 of the onto-RFC greps this module for
 * every value of the first rule and expects zero hits).
 *
 * A rule field is recognised by the UID of its property asset, not by the
 * frontmatter key: the key resolves to a property asset (by label or alias) and
 * that asset's UID is looked up here. Renaming a property's label while keeping
 * the old one as an alias therefore keeps the rule working; a key that resolves
 * to nothing known leaves the field missing, and a missing field is fail-closed
 * (see `evaluateCreationGate`).
 */

/** `exocmd__CreationGate` — the class of a rule asset. */
export const CREATION_GATE_CLASS_UID = "d4cde00a-c211-437b-9ba1-71223a15551b";

/**
 * The class LABEL, accepted next to the UID when a rule asset names its class
 * in label form (`[[exocmd__CreationGate]]`). Finding a rule must not depend on
 * how its class reference is spelled — a rule that is not found is a gate that
 * is silently off.
 */
export const CREATION_GATE_CLASS_LABEL = "exocmd__CreationGate";

/** The nine rule fields, keyed by the UID of their property asset. */
export const CREATION_GATE_FIELD_UIDS = {
  guardedClass: "6c16eb5b-28da-4182-a692-6450731dcf7e",
  excludedClass: "30340ea7-036c-4050-bc8d-84b14830498a",
  exemptClass: "5a9aff21-f1da-4e7b-a7b7-0b0c98000dde",
  exemptEvidence: "3cee39fa-9aee-4cf8-9015-0e954465acd6",
  chainProperty: "42f9721a-844a-495b-ad68-3c41b6dbc7dc",
  anchorClass: "b7b2749e-bfeb-48a4-9698-25cc981a9e86",
  directionProperty: "f827a1ad-6936-4da1-b33a-388b59e81642",
  statusProperty: "9f817e90-6353-4214-ac9a-ec0053be4980",
  allowedStatus: "16035576-ed4a-42d4-bddf-27edd50d5f98",
} as const;

export type CreationGateField = keyof typeof CREATION_GATE_FIELD_UIDS;

/** Hops along the chain property before the walk gives up ("глубина"). */
export const CREATION_GATE_MAX_DEPTH = 12;

/**
 * Stable ASCII prefix of every refusal message. ASCII on purpose: the CLI is
 * bundled by esbuild without `charset: "utf8"`, so Cyrillic is escaped in the
 * published bundle and cannot be grepped there; and the grounding engine turns
 * a thrown error into a plain message string, so callers classify a refusal by
 * this substring rather than by error type.
 */
export const CREATION_GATE_REFUSED_PREFIX = "CREATION_GATE_REFUSED:";
