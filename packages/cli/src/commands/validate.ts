import { Command } from "commander";
import { existsSync } from "fs";
import { resolve } from "path";
import { CacheManager } from "../cache/CacheManager.js";
import { ErrorHandler, type OutputFormat } from "../utils/ErrorHandler.js";
import { VaultNotFoundError } from "../utils/errors/index.js";
import { ResponseBuilder } from "../responses/index.js";
import { validateSchemaCommand } from "./validate-schema.js";
import { validateFrontmatterCommand } from "./validate-frontmatter.js";

export interface ValidateOptions {
  vault: string;
  output?: OutputFormat;
}

/**
 * Creates the 'validate iri' subcommand for checking vault files for IRI issues.
 *
 * Issue #2205: This command checks vault files for IRI issues
 * without actually building the cache. Useful for identifying
 * problematic files before indexing.
 */
function validateIriCommand(): Command {
  return new Command("iri")
    .description("Check vault files for IRI issues (Issue #2205)")
    .option("--vault <path>", "Path to Obsidian vault", process.cwd())
    .option("--output <type>", "Response format: text|json (for MCP tools)", "text")
    .action(async (options: ValidateOptions) => {
      const outputFormat = (options.output || "text") as OutputFormat;
      ErrorHandler.setFormat(outputFormat);

      try {
        const vaultPath = resolve(options.vault);
        if (!existsSync(vaultPath)) {
          throw new VaultNotFoundError(vaultPath);
        }

        const cacheManager = new CacheManager(vaultPath);

        if (outputFormat === "text") {
          console.log(`🔍 Validating vault: ${vaultPath}...`);
        }

        const issues = await cacheManager.validateVault();

        if (outputFormat === "json") {
          const response = ResponseBuilder.success({
            vaultPath,
            issueCount: issues.length,
            issues,
            healthy: issues.length === 0,
          });
          console.log(JSON.stringify(response, null, 2));
        } else {
          if (issues.length === 0) {
            console.log("✅ Vault is healthy! No IRI issues found.");
          } else {
            console.log(`\n⚠️  Found ${issues.length} file(s) with IRI issues:\n`);
            for (const issue of issues) {
              console.log(`   ❌ ${issue.path}`);
              console.log(`      ${issue.reason}`);
            }
            console.log("\n📝 To fix these issues:");
            console.log("   - Rename files to remove spaces and special characters");
            console.log("   - Use dashes (-) or underscores (_) instead of spaces");
            console.log("   - Avoid angle brackets (<>) and other special characters");
            console.log("\n💡 Run 'exocortex index --strict' to fail on first issue");
          }
        }

        // Exit with code 1 if there are issues (for CI/CD pipelines)
        if (issues.length > 0) {
          process.exitCode = 1;
        }
      } catch (error) {
        ErrorHandler.handle(error as Error);
      }
    });
}

/**
 * Creates the 'validate' parent command with subcommands:
 * - validate iri    — Check vault files for IRI issues (Issue #2205)
 * - validate schema — Check frontmatter properties against ontology (Issue #2713)
 *
 * @returns Commander Command instance with subcommands
 *
 * @example
 * exocortex validate iri --vault /path/to/vault
 * exocortex validate schema --vault /path/to/vault
 * exocortex validate schema --staged --vault /path/to/vault
 */
export function validateCommand(): Command {
  const cmd = new Command("validate")
    .description(
      "Validate vault files (IRI checks, schema linting, frontmatter shapes)",
    );

  cmd.addCommand(validateIriCommand());
  cmd.addCommand(validateSchemaCommand());
  cmd.addCommand(validateFrontmatterCommand());

  return cmd;
}
