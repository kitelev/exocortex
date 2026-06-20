import { Command } from "commander";
import { requirementsAuditCommand } from "./requirements-audit.js";

/**
 * RFC 0003 (requirements management) — the `requirements` parent command.
 *
 * Subcommands:
 *  - requirements audit — traceability checker (req↔test `@req:<uid>` bindings,
 *    orphans/dangling/duplicates/coverage + P0 binding-class floor).
 *
 * @example
 * exocortex requirements audit --reqs /path/to/exoas-exo-reqs --tests .
 */
export function requirementsCommand(): Command {
  const cmd = new Command("requirements").description(
    "Requirements-management tooling (RFC 0003): traceability checker",
  );

  cmd.addCommand(requirementsAuditCommand());

  return cmd;
}
