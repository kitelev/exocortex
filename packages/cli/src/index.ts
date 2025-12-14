#!/usr/bin/env node

import "reflect-metadata";
import { Command } from "commander";
import { sparqlQueryCommand } from "./commands/sparql-query.js";
import { commandCommand } from "./commands/command.js";
import { watchCommand } from "./commands/watch.js";
import { batchCommand } from "./commands/batch.js";
import { batchRepairCommand } from "./commands/batch-repair.js";
import { resolveCommand } from "./commands/resolve.js";

// Version injected at build time by esbuild (see esbuild.config.mjs)
declare const __CLI_VERSION__: string;

const program = new Command();

program
  .name("exocortex")
  .description("CLI tool for Exocortex knowledge management system")
  .version(__CLI_VERSION__);

program
  .command("sparql")
  .description("SPARQL query execution")
  .addCommand(sparqlQueryCommand());

program.addCommand(commandCommand());
program.addCommand(watchCommand());
program.addCommand(batchCommand());
program.addCommand(batchRepairCommand());
program.addCommand(resolveCommand());

program.parse();
