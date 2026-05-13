import { Command } from "commander";
import { backfillSuggestCommand } from "./backfill-suggest.js";
import { backfillOrphanTermsCommand } from "./backfill-orphan-terms.js";

export function backfillCommand(): Command {
  const cmd = new Command("backfill")
    .description("Concept backfill tools for aiKnow assets");

  cmd.addCommand(backfillSuggestCommand());
  cmd.addCommand(backfillOrphanTermsCommand());

  return cmd;
}
