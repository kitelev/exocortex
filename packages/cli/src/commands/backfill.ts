import { Command } from "commander";
import { backfillSuggestCommand } from "./backfill-suggest.js";

export function backfillCommand(): Command {
  const cmd = new Command("backfill")
    .description("Concept backfill tools for aiKnow assets");

  cmd.addCommand(backfillSuggestCommand());

  return cmd;
}
