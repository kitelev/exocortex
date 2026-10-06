import type { CreationGateRefusedError } from "@kitelev/exocortex-core";
import { ExitCodes } from "../ExitCodes.js";
import { CLIError } from "./CLIError.js";
import { ErrorCode } from "../../responses/index.js";

/**
 * req f5b79260 — a vault-declared creation rule (`exocmd__CreationGate`)
 * refused the asset this command was about to write; nothing was written.
 *
 * The text is the core refusal VERBATIM: it starts with the stable ASCII
 * prefix `CREATION_GATE_REFUSED:` (scripts and the published-bundle grep key on
 * it), names the rule and the reason, and carries the rule's own "how to do it
 * right" line. `format()` therefore prints the message as-is instead of the
 * generic `❌ <Name>: …` envelope — the rule already says what to do.
 */
export class CreationGateRefusedCliError extends CLIError {
  readonly exitCode = ExitCodes.PERMISSION_DENIED;
  readonly errorCode = ErrorCode.CREATION_GATE_REFUSED;
  readonly guidance: string;

  constructor(refusal: CreationGateRefusedError) {
    super(
      refusal.message,
      {
        policyUid: refusal.policyUid,
        policyLabel: refusal.policyLabel,
        candidatePath: refusal.candidatePath,
      },
      {
        message: refusal.hint ?? "Satisfy the creation rule named in the message",
      },
    );
    this.guidance = refusal.hint ?? "";
  }

  override format(): string {
    return this.message;
  }
}
