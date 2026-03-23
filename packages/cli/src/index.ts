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

// Version injected at build time by esbuild (see esbuild.config.mjs)
declare const __CLI_VERSION__: string;

const program = new Command();

program
  .name("exocortex")
  .description("CLI tool for Exocortex knowledge management system")
  .version(__CLI_VERSION__);

const sparqlCommand = program
  .command("sparql")
  .description("SPARQL query execution and cache management");

sparqlCommand.addCommand(sparqlQueryCommand());
sparqlCommand.addCommand(sparqlIndexCommand());
sparqlCommand.addCommand(sparqlTemplatesCommand());

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

program.parse();
