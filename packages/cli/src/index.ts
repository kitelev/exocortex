#!/usr/bin/env node

import "reflect-metadata";
import { Command } from "commander";
import { sparqlQueryCommand } from "./commands/sparql-query.js";
import { sparqlIndexCommand } from "./commands/sparql-index.js";
import { watchCommand } from "./commands/watch.js";
import { resolveCommand } from "./commands/resolve.js";
import { askCommand } from "./commands/ask.js";
import { validateCommand } from "./commands/validate.js";
import { classesCommand } from "./commands/classes.js";
import { createCommand } from "./commands/create.js";
import { workflowCommand } from "./commands/workflow.js";
import { daemonCommand } from "./commands/daemon.js";
import { recoverCommand } from "./commands/recover.js";
import { findCommand } from "./commands/find.js";
import { applyCommand } from "./commands/apply.js";
import { auditCommand } from "./commands/audit.js";
import { applyProfileCommand } from "./commands/apply-profile.js";
import { bootstrapCommand } from "./commands/bootstrap.js";
import { assetSpaceAddCommand } from "./commands/assetspace-add.js";
import { experimentalCommand } from "./commands/experimental.js";
import { exosyncParityCommand } from "./commands/exosync-parity.js";

// Version injected at build time by esbuild (see esbuild.config.mjs)
declare const __CLI_VERSION__: string;

/**
 * Create the CLI program with all commands registered.
 * Exported for testing.
 *
 * RFC 8e83442b (CLI v16.0) — Unix-style surface:
 *   5 verbs: find, apply, query, index, validate.
 *   Removed: batch, batch-repair, command, dyncommand, exoql, convert, sparql (deprecated alias).
 */
export function createProgram(version?: string): Command {
  const program = new Command();

  program
    .name("exocortex")
    .description("CLI tool for Exocortex knowledge management system")
    .version(version ?? __CLI_VERSION__);

  // Five core verbs (RFC 8e83442b)
  program.addCommand(findCommand());
  program.addCommand(applyCommand());
  program.addCommand(sparqlQueryCommand());
  program.addCommand(sparqlIndexCommand());
  program.addCommand(validateCommand());

  // Auxiliary commands retained from v15
  program.addCommand(watchCommand());
  program.addCommand(resolveCommand());
  program.addCommand(askCommand());
  program.addCommand(classesCommand());
  program.addCommand(createCommand());
  program.addCommand(workflowCommand());
  program.addCommand(daemonCommand());
  program.addCommand(recoverCommand());

  // RFC 9d20c91f Phase 4+1 — regression-detection audits
  program.addCommand(auditCommand());

  // RFC 22b50a17 Phase 1b — apply CLI scaffold (Phase 3 wires orchestrator)
  program.addCommand(applyProfileCommand());

  // RFC 13da049f Phase 6.2 + 6.3 — Bootstrap + Add AssetSpace CLI
  program.addCommand(bootstrapCommand());
  program.addCommand(assetSpaceAddCommand());

  // RFC 01a83de8 Phase 0 — experimental REST commit+push PoC (opt-in, no git binary)
  program.addCommand(experimentalCommand());

  // RFC 4e4dc453 Phase E (E1) — ExoSync M1/M2 parity report (read-only)
  program.addCommand(exosyncParityCommand());

  return program;
}

createProgram().parse();
