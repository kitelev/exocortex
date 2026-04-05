#!/usr/bin/env node

import "reflect-metadata";
import { Command } from "commander";
import { sparqlQueryCommand } from "./commands/sparql-query.js";
import { sparqlIndexCommand } from "./commands/sparql-index.js";
import { sparqlTemplatesCommand } from "./commands/sparql-templates.js";
import { commandCommand } from "./commands/command.js";
import { watchCommand } from "./commands/watch.js";
import { batchCommand } from "./commands/batch.js";
import { batchRepairCommand } from "./commands/batch-repair.js";
import { resolveCommand } from "./commands/resolve.js";
import { askCommand } from "./commands/ask.js";
import { dailyReviewCommand } from "./commands/daily-review.js";
import { validateCommand } from "./commands/validate.js";
import { classesCommand } from "./commands/classes.js";
import { createCommand } from "./commands/create.js";
import { archiveCommand } from "./commands/archive.js";
import { unarchiveCommand } from "./commands/unarchive.js";
import { workflowCommand } from "./commands/workflow.js";
import { dynamicCommandCommand } from "./commands/dynamic-command.js";

// Version injected at build time by esbuild (see esbuild.config.mjs)
declare const __CLI_VERSION__: string;

/**
 * Attach query subcommands (query, index, templates) to a parent command.
 */
function addQuerySubcommands(parent: Command): void {
  parent.addCommand(sparqlQueryCommand());
  parent.addCommand(sparqlIndexCommand());
  parent.addCommand(sparqlTemplatesCommand());
}

/**
 * Create the CLI program with all commands registered.
 * Exported for testing.
 */
export function createProgram(version?: string): Command {
  const program = new Command();

  program
    .name("exocortex")
    .description("CLI tool for Exocortex knowledge management system")
    .version(version ?? __CLI_VERSION__);

  // Primary command: exoql
  const exoqlCommand = program
    .command("exoql")
    .description("ExoQL query execution and cache management");

  addQuerySubcommands(exoqlCommand);

  // Deprecated alias: sparql → exoql (prints deprecation warning)
  const sparqlCommand = program
    .command("sparql")
    .description("(deprecated) Use 'exoql' instead");

  addQuerySubcommands(sparqlCommand);

  // Hook fires before any sparql subcommand action runs
  sparqlCommand.hook("preAction", () => {
    console.error('⚠️  "sparql" is deprecated. Use "exoql" instead.');
  });

  program.addCommand(commandCommand());
  program.addCommand(watchCommand());
  program.addCommand(batchCommand());
  program.addCommand(batchRepairCommand());
  program.addCommand(resolveCommand());
  program.addCommand(askCommand());
  program.addCommand(dailyReviewCommand());
  program.addCommand(validateCommand());
  program.addCommand(classesCommand());
  program.addCommand(createCommand());
  program.addCommand(archiveCommand());
  program.addCommand(unarchiveCommand());
  program.addCommand(workflowCommand());
  program.addCommand(dynamicCommandCommand());

  return program;
}

createProgram().parse();
