import { CREATION_GATE_REFUSED_PREFIX } from "./CreationGateContract";
import type { CreationGateVerdict } from "./evaluateCreationGate";

type Refusal = Extract<CreationGateVerdict, { allowed: false }>;

/**
 * The refusal text: the stable ASCII prefix, the rule's label and short UID,
 * the reason, and — on its own line — the rule's "how to do it right"
 * (`exo__Asset_description`).
 */
export function formatCreationGateRefusal(refusal: Refusal): string {
  const head =
    `${CREATION_GATE_REFUSED_PREFIX} ⛔ Правило допуска «${refusal.policyLabel}» ` +
    `(${refusal.policyUid.slice(0, 8)}) отклонило создание: ${refusal.reason}.`;
  return refusal.hint ? `${head}\n${refusal.hint}` : head;
}

/**
 * Does this message carry a creation-gate refusal? Substring, not prefix: the
 * grounding engine reports a failed step inside its own wording
 * (`Step 2 failed: …`), and only the message string survives that.
 */
export function isCreationGateRefusal(message: string | undefined | null): boolean {
  return typeof message === "string" && message.includes(CREATION_GATE_REFUSED_PREFIX);
}

/** Thrown by a gated writer when a rule refuses the file it was asked to create. */
export class CreationGateRefusedError extends Error {
  readonly policyUid: string;
  readonly policyLabel: string;
  readonly reason: string;
  readonly hint: string | null;
  /** The vault-relative path that was NOT written. */
  readonly candidatePath: string;

  constructor(refusal: Refusal, candidatePath: string) {
    super(formatCreationGateRefusal(refusal));
    this.name = "CreationGateRefusedError";
    this.policyUid = refusal.policyUid;
    this.policyLabel = refusal.policyLabel;
    this.reason = refusal.reason;
    this.hint = refusal.hint;
    this.candidatePath = candidatePath;
  }
}
