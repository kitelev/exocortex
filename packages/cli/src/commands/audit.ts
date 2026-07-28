import { Command } from "commander";
import { auditCoLocationCommand } from "./audit-co-location.js";
import { auditOntologyImportsCommand } from "./audit-ontology-imports.js";
import { auditOntologyMembershipCommand } from "./audit-ontology-membership.js";
import { auditOntologyUrlCommand } from "./audit-ontology-url.js";

/**
 * Creates the 'audit' parent command with regression-detection subcommands:
 * - audit co-location — RFC 0b7a2fad asset–ontology co-location invariant.
 * - audit ontology-imports — RFC df39007b ontology imports DAG invariant (coupling-side ArchUnit).
 * - audit ontology-membership — KSD ArchUnit (req c23f6f50) ontology exo__Ontology_admits allow-list (cohesion-side).
 * - audit ontology-url — issue #3824 exo__Ontology_url trailing-# separator invariant.
 *
 * @example
 * exocortex audit co-location --vault /path/to/vault
 * exocortex audit ontology-imports --vault /path/to/vault
 * exocortex audit ontology-membership --vault /path/to/vault
 * exocortex audit ontology-url --vault /path/to/vault
 */
export function auditCommand(): Command {
  const cmd = new Command("audit").description(
    "Audit vault for regression patterns (RFC cutover detectors)",
  );

  cmd.addCommand(auditCoLocationCommand());
  cmd.addCommand(auditOntologyImportsCommand());
  cmd.addCommand(auditOntologyMembershipCommand());
  cmd.addCommand(auditOntologyUrlCommand());

  return cmd;
}
