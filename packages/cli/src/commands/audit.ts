import { Command } from "commander";
import { auditGroundingTypeLiteralFormCommand } from "./audit-grounding-type-literal-form.js";
import { auditCoLocationCommand } from "./audit-co-location.js";

/**
 * Creates the 'audit' parent command with regression-detection subcommands:
 * - audit grounding-type-literal-form — RFC 9d20c91f Phase 4+1 regression
 *   detector for `exocmd__Grounding_type` literal-string form.
 * - audit co-location — RFC 0b7a2fad asset–ontology co-location invariant.
 *
 * @example
 * exocortex audit grounding-type-literal-form --vault /path/to/vault
 * exocortex audit co-location --vault /path/to/vault
 */
export function auditCommand(): Command {
  const cmd = new Command("audit").description(
    "Audit vault for regression patterns (RFC cutover detectors)",
  );

  cmd.addCommand(auditGroundingTypeLiteralFormCommand());
  cmd.addCommand(auditCoLocationCommand());

  return cmd;
}
