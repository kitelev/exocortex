import { Command } from "commander";
import { auditCoLocationCommand } from "./audit-co-location.js";
import { auditOntologyImportsCommand } from "./audit-ontology-imports.js";

/**
 * Creates the 'audit' parent command with regression-detection subcommands:
 * - audit co-location — RFC 0b7a2fad asset–ontology co-location invariant.
 * - audit ontology-imports — RFC df39007b ontology imports DAG invariant.
 *
 * @example
 * exocortex audit co-location --vault /path/to/vault
 * exocortex audit ontology-imports --vault /path/to/vault
 */
export function auditCommand(): Command {
  const cmd = new Command("audit").description(
    "Audit vault for regression patterns (RFC cutover detectors)",
  );

  cmd.addCommand(auditCoLocationCommand());
  cmd.addCommand(auditOntologyImportsCommand());

  return cmd;
}
