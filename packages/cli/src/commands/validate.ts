import { Command } from "commander";
import { validateSchemaCommand } from "./validate-schema.js";
import { validateVaultCommand } from "./validate-vault.js";

/**
 * Creates the 'validate' parent command with subcommands:
 * - validate schema — Check frontmatter properties against ontology (Issue #2713)
 * - validate vault  — Homoiconic vault-integrity check-runner (RFC f402002b, M1.5)
 *
 * The legacy `validate iri` (Issue #2205) and `validate frontmatter`
 * (Issue #2997 Phase 4) subcommands were removed — both are superseded by
 * `validate schema --shapes-mode` and were dormant (no consumer, no active
 * requirement bound to them).
 *
 * @returns Commander Command instance with subcommands
 *
 * @example
 * exocortex validate schema --vault /path/to/vault
 * exocortex validate schema --staged --vault /path/to/vault
 * exocortex validate vault --vault /path/to/vault
 */
export function validateCommand(): Command {
  const cmd = new Command("validate").description(
    "Validate vault files (schema linting, homoiconic vault-integrity checks)",
  );

  cmd.addCommand(validateSchemaCommand());
  cmd.addCommand(validateVaultCommand());

  return cmd;
}
