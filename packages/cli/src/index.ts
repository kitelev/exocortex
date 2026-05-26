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
import { archiveCommand } from "./commands/archive.js";
import { unarchiveCommand } from "./commands/unarchive.js";
import { workflowCommand } from "./commands/workflow.js";
import { migrateRelColSetToExoLayoutCommand } from "./commands/migrate-relcolset-to-exolayout.js";
import { daemonCommand } from "./commands/daemon.js";
import { backfillCommand } from "./commands/backfill.js";
import { recoverCommand } from "./commands/recover.js";
import { findCommand } from "./commands/find.js";
import { applyCommand } from "./commands/apply.js";
import { auditCommand } from "./commands/audit.js";

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
  program.addCommand(archiveCommand());
  program.addCommand(unarchiveCommand());
  program.addCommand(workflowCommand());
  program.addCommand(migrateRelColSetToExoLayoutCommand());
  program.addCommand(daemonCommand());
  program.addCommand(backfillCommand());
  program.addCommand(recoverCommand());

  // RFC 9d20c91f Phase 4+1 — regression-detection audits
  program.addCommand(auditCommand());

  return program;
}

createProgram().parse();
