import { Command } from "commander";
import { resolve } from "path";
import { existsSync } from "fs";
import { readFileSync } from "fs";
import { ShapeLoader, type ShapeRegistry } from "exocortex";
import { NodeFsAdapter } from "../adapters/NodeFsAdapter.js";
import { ClassResolverService } from "../services/ClassResolverService.js";
import { WikilinkValidator } from "../services/WikilinkValidator.js";
import { AssetCreationService } from "../services/AssetCreationService.js";
import { ErrorHandler } from "../utils/ErrorHandler.js";
import { VaultNotFoundError } from "../utils/errors/index.js";
import { registerOrderSpecFromVault } from "../services/registerOrderSpec.js";

/**
 * Options parsed from CLI flags for the create command.
 */
interface CreateCommandOptions {
  vault: string;
  class: string;
  label: string;
  aliases?: string[];
  property?: string[];
  body?: string;
  bodyFile?: string;
  dryRun?: boolean;
  createdBy?: string;
  timezone?: string;
  skipWikilinkValidation?: boolean;
}

/**
 * Parse --property flags into a key-value map.
 *
 * Each --property flag has the format "key=value".
 * Multiple values for the same key are concatenated with commas.
 *
 * @example
 * parseProperties(["ztlk__Note_developedFrom=[[uuid|Label]]", "custom_prop=value"])
 * // => { "ztlk__Note_developedFrom": "[[uuid|Label]]", "custom_prop": "value" }
 */
function parseProperties(
  propertyArgs: string[] | undefined,
): Record<string, string> {
  if (!propertyArgs || propertyArgs.length === 0) {
    return {};
  }

  const properties: Record<string, string> = {};

  for (const prop of propertyArgs) {
    const eqIndex = prop.indexOf("=");
    if (eqIndex === -1) {
      throw new Error(
        `Invalid property format: "${prop}". Expected "key=value" format.`,
      );
    }

    const key = prop.substring(0, eqIndex).trim();
    const value = prop.substring(eqIndex + 1).trim();

    if (!key) {
      throw new Error(
        `Invalid property format: "${prop}". Key cannot be empty.`,
      );
    }

    properties[key] = value;
  }

  return properties;
}

/**
 * Read body content from the specified source.
 *
 * Sources:
 * - "--body <text>" - Inline text
 * - "--body -" - Read from stdin
 * - "--body-file <path>" - Read from file
 *
 * @returns Body content string, or undefined if no body source specified
 */
async function resolveBody(options: CreateCommandOptions): Promise<string | undefined> {
  // --body-file takes precedence if both specified
  if (options.bodyFile) {
    if (!existsSync(options.bodyFile)) {
      throw new Error(`Body file not found: ${options.bodyFile}`);
    }
    return readFileSync(options.bodyFile, "utf-8");
  }

  if (options.body === "-") {
    // Read from stdin with timeout
    return readStdin(30_000);
  }

  if (options.body) {
    return options.body;
  }

  return undefined;
}

/**
 * Read all content from stdin with a timeout.
 *
 * @param timeoutMs - Timeout in milliseconds (default: 30s)
 * @returns Content read from stdin
 */
function readStdin(timeoutMs: number): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];

    const timer = setTimeout(() => {
      process.stdin.removeAllListeners();
      process.stdin.destroy();
      reject(new Error(`Stdin read timed out after ${timeoutMs}ms. Ensure you pipe content to stdin or close the pipe.`));
    }, timeoutMs);

    process.stdin.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    process.stdin.on("end", () => {
      clearTimeout(timer);
      resolvePromise(Buffer.concat(chunks).toString("utf-8"));
    });

    process.stdin.on("error", (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });

    // If stdin is a TTY (not piped), end immediately with empty
    if (process.stdin.isTTY) {
      clearTimeout(timer);
      resolvePromise("");
    }

    process.stdin.resume();
  });
}

/**
 * Creates the 'create' subcommand for universal asset creation.
 *
 * @returns Commander Command instance configured for asset creation
 *
 * @example
 * ```bash
 * # Create a permanent note
 * exocortex create --class ztlk__PermanentNote --label "My Note" --vault /path/to/vault
 *
 * # With properties and body
 * exocortex create --class ztlk__PermanentNote \
 *   --label "My Note" \
 *   --property "ztlk__Note_developedFrom=[[uuid|Label]]" \
 *   --body "# Content here" \
 *   --vault /path/to/vault
 *
 * # Dry run
 * exocortex create --class ztlk__PermanentNote --label "Test" --dry-run --vault /path/to/vault
 *
 * # Body from file
 * exocortex create --class ztlk__PermanentNote --label "Test" --body-file /tmp/content.md --vault /path/to/vault
 *
 * # Body from stdin
 * echo "# Content" | exocortex create --class ztlk__PermanentNote --label "Test" --body - --vault /path/to/vault
 * ```
 */
export function createCommand(): Command {
  return new Command("create")
    .description("Create a new vault asset with auto-generated UUID, timestamp, and frontmatter")
    .requiredOption("--class <name>", "Class short name (e.g. ztlk__PermanentNote) or UUID")
    .requiredOption("--label <text>", "Human-readable label for the asset")
    .option("--vault <path>", "Path to Obsidian vault", process.cwd())
    .option("--aliases <names...>", "Additional aliases for the asset")
    .option("--property <key=value...>", "Property key-value pairs (repeatable)", collect, [])
    .option("--body <text>", "Markdown body content (use '-' to read from stdin)")
    .option("--body-file <path>", "Read body content from file")
    .option("--dry-run", "Preview frontmatter without writing file")
    .option("--created-by <uuid>", "Creator UUID (defaults to ExoAssistant)")
    .option("--timezone <tz>", "Timezone for timestamps (defaults to Asia/Almaty)")
    .option("--skip-wikilink-validation", "Skip wikilink existence validation")
    .action(async (options: CreateCommandOptions) => {
      try {
        const vaultPath = resolve(options.vault);

        if (!existsSync(vaultPath)) {
          throw new VaultNotFoundError(vaultPath);
        }
        registerOrderSpecFromVault(vaultPath);

        // Parse properties from --property flags
        const properties = parseProperties(options.property);

        // Resolve body content and parse escape sequences
        let body = await resolveBody(options);
        if (body) {
          body = body.replace(/\\n/g, "\n");
        }

        // Create services
        const fsAdapter = new NodeFsAdapter(vaultPath);
        const classResolver = new ClassResolverService(fsAdapter);
        const wikilinkValidator = new WikilinkValidator(fsAdapter);

        // Load SHACL-lite shape registry from vault for cardinality-aware
        // property serialization (issues #3099, #3179). Failure here is
        // non-fatal — proceed with default scalar emission if shapes cannot
        // be loaded (vault convention default per #3179).
        let shapeRegistry: ShapeRegistry | undefined;
        try {
          shapeRegistry = await ShapeLoader.loadFromVaultFS(vaultPath);
        } catch {
          shapeRegistry = undefined;
        }

        const creationService = new AssetCreationService(
          fsAdapter,
          classResolver,
          wikilinkValidator,
          shapeRegistry,
        );

        // Execute creation
        const result = await creationService.create({
          classShortName: options.class,
          label: options.label,
          aliases: options.aliases,
          properties: Object.keys(properties).length > 0 ? properties : undefined,
          body,
          vault: vaultPath,
          dryRun: options.dryRun,
          createdBy: options.createdBy,
          timezone: options.timezone,
          skipWikilinkValidation: options.skipWikilinkValidation,
        });

        if (options.dryRun) {
          // In dry-run mode, output frontmatter preview to stderr and JSON to stdout
          const preview = formatFrontmatterPreview(result.frontmatter, body);
          process.stderr.write(preview + "\n");
        }

        // Always output JSON to stdout on success
        const output = {
          uuid: result.uuid,
          path: result.path,
          label: result.label,
        };
        process.stdout.write(JSON.stringify(output) + "\n");

        process.exit(0);
      } catch (error) {
        ErrorHandler.handle(error as Error);
      }
    });
}

/**
 * Commander.js collector for repeatable options.
 * Accumulates multiple --property flags into an array.
 */
function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

/**
 * Format frontmatter as a human-readable preview for dry-run mode.
 */
function formatFrontmatterPreview(
  frontmatter: Record<string, unknown>,
  body?: string,
): string {
  const lines = ["--- DRY RUN PREVIEW ---", "---"];

  for (const [key, value] of Object.entries(frontmatter)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${item}`);
      }
    } else {
      lines.push(`${key}: ${value}`);
    }
  }

  lines.push("---");

  if (body) {
    lines.push("");
    lines.push(body);
  }

  lines.push("--- END PREVIEW ---");
  return lines.join("\n");
}
