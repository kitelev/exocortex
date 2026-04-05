import { Command } from "commander";
import { existsSync, readdirSync, readFileSync } from "fs";
import { resolve, join, basename } from "path";
import {
  FrontmatterService,
  InMemoryTripleStore,
  NoteToRDFConverter,
  CommandResolver,
  PreconditionEvaluator,
  GroundingExecutor,
  ServiceRegistry,
  GroundingType,
  type GroundingDefinition,
  type CommandBindingDefinition,
} from "exocortex";
import { ErrorHandler, type OutputFormat } from "../utils/ErrorHandler.js";
import { VaultNotFoundError } from "../utils/errors/index.js";
import { ResponseBuilder } from "../responses/index.js";
import { ExitCodes } from "../utils/ExitCodes.js";
import { FileSystemVaultAdapter } from "../adapters/FileSystemVaultAdapter.js";
import { NodeFsAdapter } from "../adapters/NodeFsAdapter.js";
import { populateCliServiceRegistry, CLI_STUB_SERVICE_IDS } from "../services/CliServiceRegistryPopulator.js";

export interface DynCommandOptions {
  vault: string;
  output?: OutputFormat;
  target?: string;
  dryRun?: boolean;
}

interface CommandFileInfo {
  filePath: string;
  uid: string;
  label: string;
  category?: string;
  icon?: string;
  hasPrecondition: boolean;
  groundingType?: string;
}

interface ValidationIssue {
  uid: string;
  label: string;
  filePath: string;
  issues: string[];
}

const frontmatterService = new FrontmatterService();

/**
 * Creates the 'dyncommand' command group for listing, showing, executing,
 * and validating vault-defined dynamic commands (RFC-009).
 *
 * Issue #2433
 */
export function dynamicCommandCommand(): Command {
  const dynCmd = new Command("dyncommand")
    .description("Manage vault-defined dynamic commands (RFC-009)");

  // --- list ---
  dynCmd
    .command("list")
    .description("List all dynamic commands defined in vault")
    .option("--vault <path>", "Path to Obsidian vault", process.cwd())
    .option("--output <type>", "Response format: text|json", "text")
    .option("--target <iri>", "Filter commands applicable to a specific asset IRI")
    .action(async (options: DynCommandOptions) => {
      const outputFormat = (options.output || "text") as OutputFormat;
      ErrorHandler.setFormat(outputFormat);

      try {
        const vaultPath = resolve(options.vault);
        if (!existsSync(vaultPath)) {
          throw new VaultNotFoundError(vaultPath);
        }

        let commands: CommandFileInfo[];
        if (options.target) {
          commands = await listCommandsForTarget(vaultPath, options.target);
        } else {
          commands = scanCommands(vaultPath);
        }

        if (outputFormat === "json") {
          const response = ResponseBuilder.success({
            commands,
            totalCommands: commands.length,
            ...(options.target && { target: options.target }),
          });
          console.log(JSON.stringify(response, null, 2));
        } else {
          if (commands.length === 0) {
            console.log("No dynamic commands found in vault.");
            return;
          }

          const targetMsg = options.target ? ` for target ${options.target}` : "";
          console.log(`\n📋 Found ${commands.length} dynamic command(s)${targetMsg}:\n`);

          const maxName = Math.max(...commands.map(c => c.label.length), 4);
          const maxCat = Math.max(...commands.map(c => (c.category ?? "").length), 8);

          console.log(
            "┌" + "─".repeat(maxName + 2) +
            "┬" + "─".repeat(maxCat + 2) +
            "┬" + "─".repeat(14) +
            "┬" + "─".repeat(14) + "┐",
          );
          console.log(
            "│ " + "Name".padEnd(maxName) +
            " │ " + "Category".padEnd(maxCat) +
            " │ " + "Precondition".padEnd(12) +
            " │ " + "Grounding".padEnd(12) + " │",
          );
          console.log(
            "├" + "─".repeat(maxName + 2) +
            "┼" + "─".repeat(maxCat + 2) +
            "┼" + "─".repeat(14) +
            "┼" + "─".repeat(14) + "┤",
          );

          for (const c of commands) {
            console.log(
              "│ " + c.label.padEnd(maxName) +
              " │ " + (c.category ?? "").padEnd(maxCat) +
              " │ " + (c.hasPrecondition ? "  yes       " : "  no        ") +
              " │ " + (c.groundingType ?? "").padEnd(12) + " │",
            );
          }

          console.log(
            "└" + "─".repeat(maxName + 2) +
            "┴" + "─".repeat(maxCat + 2) +
            "┴" + "─".repeat(14) +
            "┴" + "─".repeat(14) + "┘",
          );
        }
      } catch (error) {
        ErrorHandler.handle(error as Error);
      }
    });

  // --- show ---
  dynCmd
    .command("show")
    .description("Show full details of a dynamic command")
    .argument("<uid>", "UID of the command asset")
    .option("--vault <path>", "Path to Obsidian vault", process.cwd())
    .option("--output <type>", "Response format: text|json", "text")
    .action(async (uid: string, options: DynCommandOptions) => {
      const outputFormat = (options.output || "text") as OutputFormat;
      ErrorHandler.setFormat(outputFormat);

      try {
        const vaultPath = resolve(options.vault);
        if (!existsSync(vaultPath)) {
          throw new VaultNotFoundError(vaultPath);
        }

        const { tripleStore } = await buildTripleStore(vaultPath);
        const resolver = new CommandResolver(tripleStore);
        const command = await resolver.loadCommand(uid);

        if (!command) {
          if (outputFormat === "json") {
            const response = ResponseBuilder.success({
              error: `Command with UID "${uid}" not found`,
            });
            console.log(JSON.stringify(response, null, 2));
          } else {
            console.log(`❌ Command with UID "${uid}" not found.`);
          }
          process.exitCode = ExitCodes.FILE_NOT_FOUND;
          return;
        }

        // Find bindings for this command
        const allBindings = await resolver.findBindings();
        const commandBindings = allBindings.filter((b: CommandBindingDefinition) => b.commandRef === uid);

        if (outputFormat === "json") {
          const response = ResponseBuilder.success({
            command,
            bindings: commandBindings,
          });
          console.log(JSON.stringify(response, null, 2));
        } else {
          console.log(`\n📋 Command: ${command.name}\n`);
          console.log(`   ID: ${command.id}`);
          if (command.icon) console.log(`   Icon: ${command.icon}`);
          if (command.category) console.log(`   Category: ${command.category}`);
          if (command.confirmMessage) console.log(`   Confirm message: ${command.confirmMessage}`);
          if (command.successMessage) console.log(`   Success message: ${command.successMessage}`);

          // Precondition
          if (command.precondition) {
            console.log(`\n   Precondition:`);
            console.log(`     ID: ${command.precondition.id}`);
            console.log(`     Label: ${command.precondition.label}`);
            console.log(`     SPARQL ASK: ${command.precondition.sparqlAsk}`);
          } else {
            console.log(`\n   Precondition: none (always available)`);
          }

          // Grounding
          console.log(`\n   Grounding:`);
          printGrounding(command.grounding, "     ");

          // Bindings
          if (commandBindings.length > 0) {
            console.log(`\n   Bindings (${commandBindings.length}):`);
            for (const b of commandBindings) {
              const targets: string[] = [];
              if (b.targetClass) targets.push(`class=${b.targetClass}`);
              if (b.targetPrototype) targets.push(`prototype=${b.targetPrototype}`);
              if (b.targetAsset) targets.push(`asset=${b.targetAsset}`);
              console.log(`     • ${b.label || b.id}: ${targets.join(", ")}`);
            }
          } else {
            console.log(`\n   Bindings: none`);
          }
        }
      } catch (error) {
        ErrorHandler.handle(error as Error);
      }
    });

  // --- exec ---
  dynCmd
    .command("exec")
    .description("Execute a dynamic command on a target asset")
    .argument("<uid>", "UID of the command to execute")
    .option("--vault <path>", "Path to Obsidian vault", process.cwd())
    .option("--target <filepath>", "Path to target asset file (relative to vault)")
    .option("--output <type>", "Response format: text|json", "text")
    .option("--dry-run", "Preview changes without modifying files")
    .action(async (uid: string, options: DynCommandOptions) => {
      const outputFormat = (options.output || "text") as OutputFormat;
      ErrorHandler.setFormat(outputFormat);

      try {
        const vaultPath = resolve(options.vault);
        if (!existsSync(vaultPath)) {
          throw new VaultNotFoundError(vaultPath);
        }

        if (!options.target) {
          console.error("❌ --target option is required for exec command");
          process.exitCode = ExitCodes.INVALID_ARGUMENTS;
          return;
        }

        const targetPath = resolve(vaultPath, options.target);
        if (!existsSync(targetPath)) {
          console.error(`❌ Target file not found: ${options.target}`);
          process.exitCode = ExitCodes.FILE_NOT_FOUND;
          return;
        }

        // Build triple store for precondition evaluation
        const { tripleStore } = await buildTripleStore(vaultPath);
        const resolver = new CommandResolver(tripleStore);
        const command = await resolver.loadCommand(uid);

        if (!command) {
          if (outputFormat === "json") {
            const response = ResponseBuilder.success({
              error: `Command with UID "${uid}" not found`,
            });
            console.log(JSON.stringify(response, null, 2));
          } else {
            console.log(`❌ Command with UID "${uid}" not found.`);
          }
          process.exitCode = ExitCodes.FILE_NOT_FOUND;
          return;
        }

        // Derive IRI for precondition evaluation
        const targetIRI = options.target.replace(/\.md$/, "");

        // Evaluate precondition
        const evaluator = new PreconditionEvaluator(tripleStore);
        const preconditionPassed = await evaluator.evaluate(
          command.precondition,
          targetIRI,
        );

        if (!preconditionPassed) {
          if (outputFormat === "json") {
            const response = ResponseBuilder.success({
              command: command.name,
              target: options.target,
              preconditionPassed: false,
              executed: false,
              reason: "Precondition not satisfied",
            });
            console.log(JSON.stringify(response, null, 2));
          } else {
            console.log(`❌ Precondition not satisfied for command "${command.name}" on target "${options.target}".`);
            if (command.precondition) {
              console.log(`   Precondition: ${command.precondition.label}`);
              console.log(`   SPARQL ASK: ${command.precondition.sparqlAsk}`);
            }
          }
          process.exitCode = ExitCodes.OPERATION_FAILED;
          return;
        }

        // Dry-run mode
        if (options.dryRun) {
          if (outputFormat === "json") {
            const response = ResponseBuilder.success({
              command: command.name,
              target: options.target,
              preconditionPassed: true,
              dryRun: true,
              grounding: command.grounding,
            });
            console.log(JSON.stringify(response, null, 2));
          } else {
            console.log(`\n🔍 Dry-run: command "${command.name}" on "${options.target}"\n`);
            console.log(`   Precondition: passed ✅`);
            console.log(`   Grounding (would execute):`);
            printGrounding(command.grounding, "     ");
          }
          return;
        }

        // Execute grounding
        const serviceRegistry = new ServiceRegistry();
        populateCliServiceRegistry(serviceRegistry);
        const nodeFsAdapter = new NodeFsAdapter(vaultPath);
        const groundingExecutor = new GroundingExecutor(
          nodeFsAdapter,
          nodeFsAdapter,
          serviceRegistry,
        );

        const result = await groundingExecutor.execute(
          command.grounding,
          targetIRI,
          options.target,
        );

        if (outputFormat === "json") {
          const response = ResponseBuilder.success({
            command: command.name,
            target: options.target,
            preconditionPassed: true,
            executed: true,
            success: result.success,
            ...(result.error && { error: result.error }),
            ...(command.successMessage && result.success && { message: command.successMessage }),
          });
          console.log(JSON.stringify(response, null, 2));
        } else {
          if (result.success) {
            const msg = command.successMessage ?? `Command "${command.name}" executed successfully.`;
            console.log(`✅ ${msg}`);
          } else {
            console.log(`❌ Command "${command.name}" failed: ${result.error}`);
            process.exitCode = ExitCodes.OPERATION_FAILED;
          }
        }
      } catch (error) {
        ErrorHandler.handle(error as Error);
      }
    });

  // --- validate ---
  dynCmd
    .command("validate")
    .description("Validate all dynamic command definitions in vault")
    .option("--vault <path>", "Path to Obsidian vault", process.cwd())
    .option("--output <type>", "Response format: text|json", "text")
    .action(async (options: DynCommandOptions) => {
      const outputFormat = (options.output || "text") as OutputFormat;
      ErrorHandler.setFormat(outputFormat);

      try {
        const vaultPath = resolve(options.vault);
        if (!existsSync(vaultPath)) {
          throw new VaultNotFoundError(vaultPath);
        }

        const issues = validateCommands(vaultPath);

        if (outputFormat === "json") {
          const response = ResponseBuilder.success({
            totalCommands: scanCommands(vaultPath).length,
            totalIssues: issues.reduce((sum, i) => sum + i.issues.length, 0),
            commandsWithIssues: issues.length,
            issues,
          });
          console.log(JSON.stringify(response, null, 2));
        } else {
          const commands = scanCommands(vaultPath);
          if (issues.length === 0) {
            console.log(`✅ All ${commands.length} dynamic command(s) are valid.`);
          } else {
            const totalIssues = issues.reduce((sum, i) => sum + i.issues.length, 0);
            console.log(
              `❌ Found ${totalIssues} issue(s) in ${issues.length} command(s) out of ${commands.length} total:\n`,
            );
            for (const item of issues) {
              console.log(`  📄 ${item.label} (${item.uid}):`);
              for (const issue of item.issues) {
                console.log(`     • ${issue}`);
              }
              console.log();
            }
            process.exitCode = ExitCodes.OPERATION_FAILED;
          }
        }
      } catch (error) {
        ErrorHandler.handle(error as Error);
      }
    });

  return dynCmd;
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Scan vault for exocmd__Command assets.
 */
function scanCommands(vaultPath: string): CommandFileInfo[] {
  const commands: CommandFileInfo[] = [];
  const allFiles: Array<{ filePath: string; fm: Record<string, any> }> = [];
  collectParsedFiles(vaultPath, allFiles);

  for (const { filePath, fm } of allFiles) {
    if (!hasClass(fm, "exocmd__Command")) continue;

    const uid = fm["exo__Asset_uid"] ?? "";
    const label = fm["exo__Asset_label"] ?? extractLabelFromFilename(filePath);
    const category = fm["exocmd__Command_category"];
    const icon = fm["exocmd__Command_icon"];
    const hasPrecondition = !!fm["exocmd__Command_precondition"];
    const groundingRef = fm["exocmd__Command_grounding"];

    // Try to resolve grounding type
    let groundingType: string | undefined;
    if (groundingRef) {
      const groundingUid = normalizeWikilink(String(groundingRef));
      const groundingFile = allFiles.find(f =>
        f.fm["exo__Asset_uid"] === groundingUid && hasClass(f.fm, "exocmd__Grounding"),
      );
      if (groundingFile) {
        groundingType = groundingFile.fm["exocmd__Grounding_type"];
      }
    }

    commands.push({ filePath, uid, label, category, icon, hasPrecondition, groundingType });
  }

  return commands;
}

/**
 * List commands applicable to a specific target asset by building
 * a triple store and using CommandResolver.
 */
async function listCommandsForTarget(
  vaultPath: string,
  _targetIRI: string,
): Promise<CommandFileInfo[]> {
  const { tripleStore } = await buildTripleStore(vaultPath);
  const resolver = new CommandResolver(tripleStore);

  // We need to determine the target's class and prototype
  // For now, resolve all bindings and find matching ones
  const allBindings = await resolver.findBindings();

  const commandUids = new Set<string>();
  for (const binding of allBindings) {
    commandUids.add(binding.commandRef);
  }

  const commands: CommandFileInfo[] = [];
  for (const uid of commandUids) {
    const command = await resolver.loadCommand(uid);
    if (!command) continue;

    commands.push({
      filePath: "",
      uid: command.id,
      label: command.name,
      category: command.category,
      icon: command.icon,
      hasPrecondition: !!command.precondition,
      groundingType: command.grounding.type,
    });
  }

  return commands;
}

/**
 * Validate all command definitions for common issues.
 */
function validateCommands(vaultPath: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const allFiles: Array<{ filePath: string; fm: Record<string, any> }> = [];
  collectParsedFiles(vaultPath, allFiles);

  // Build lookup maps
  const uidMap = new Map<string, { filePath: string; fm: Record<string, any> }>();
  for (const file of allFiles) {
    const uid = file.fm["exo__Asset_uid"];
    if (uid) uidMap.set(uid, file);
  }

  // Validate each command
  for (const { filePath, fm } of allFiles) {
    if (!hasClass(fm, "exocmd__Command")) continue;

    const uid = fm["exo__Asset_uid"] ?? "";
    const label = fm["exo__Asset_label"] ?? extractLabelFromFilename(filePath);
    const commandIssues: string[] = [];

    // Check required UID
    if (!uid) {
      commandIssues.push("Missing exo__Asset_uid");
    }

    // Check label
    if (!fm["exo__Asset_label"]) {
      commandIssues.push("Missing exo__Asset_label");
    }

    // Check grounding reference
    const groundingRef = fm["exocmd__Command_grounding"];
    if (!groundingRef) {
      commandIssues.push("Missing exocmd__Command_grounding (required)");
    } else {
      const groundingUid = normalizeWikilink(String(groundingRef));
      const groundingFile = uidMap.get(groundingUid);
      if (!groundingFile) {
        commandIssues.push(`Grounding reference "${groundingUid}" not found in vault`);
      } else if (!hasClass(groundingFile.fm, "exocmd__Grounding")) {
        commandIssues.push(`Grounding reference "${groundingUid}" is not an exocmd__Grounding asset`);
      } else {
        // Validate grounding definition
        const gfm = groundingFile.fm;
        const gType = gfm["exocmd__Grounding_type"];
        if (!gType) {
          commandIssues.push(`Grounding "${groundingUid}" missing exocmd__Grounding_type`);
        } else {
          const validTypes = Object.values(GroundingType) as string[];
          if (!validTypes.includes(gType)) {
            commandIssues.push(`Grounding "${groundingUid}" has invalid type "${gType}"`);
          }

          // property_set/property_delete require targetProperty
          if ((gType === GroundingType.PROPERTY_SET || gType === GroundingType.PROPERTY_DELETE) &&
              !gfm["exocmd__Grounding_targetProperty"]) {
            commandIssues.push(`Grounding "${groundingUid}" (${gType}) missing targetProperty`);
          }

          // property_set requires targetValue
          if (gType === GroundingType.PROPERTY_SET && !gfm["exocmd__Grounding_targetValue"]) {
            commandIssues.push(`Grounding "${groundingUid}" (property_set) missing targetValue`);
          }

          // service_call: serviceId from dedicated property or fallback to targetProperty
          if (gType === GroundingType.SERVICE_CALL) {
            const serviceId = gfm["exocmd__Grounding_serviceId"] ?? gfm["exocmd__Grounding_targetProperty"];
            if (!serviceId) {
              commandIssues.push(`Grounding "${groundingUid}" (service_call) missing serviceId and targetProperty`);
            }
          }
        }
      }
    }

    // Check precondition reference if present
    const preconditionRef = fm["exocmd__Command_precondition"];
    if (preconditionRef) {
      const preconditionUid = normalizeWikilink(String(preconditionRef));
      const preconditionFile = uidMap.get(preconditionUid);
      if (!preconditionFile) {
        commandIssues.push(`Precondition reference "${preconditionUid}" not found in vault`);
      } else if (!hasClass(preconditionFile.fm, "exocmd__Precondition")) {
        commandIssues.push(`Precondition reference "${preconditionUid}" is not an exocmd__Precondition asset`);
      } else {
        // Validate precondition has either sparqlAsk or hostFunction
        const sparqlAsk = preconditionFile.fm["exocmd__Precondition_sparqlAsk"];
        const hostFunction = preconditionFile.fm["exocmd__Precondition_hostFunction"];
        if (!sparqlAsk && !hostFunction) {
          commandIssues.push(`Precondition "${preconditionUid}" missing both sparqlAsk and hostFunction`);
        }
      }
    }

    // Check bindings exist for this command
    const hasBinding = allFiles.some(f => {
      if (!hasClass(f.fm, "exocmd__CommandBinding")) return false;
      const cmdRef = normalizeWikilink(String(f.fm["exocmd__CommandBinding_command"] ?? ""));
      return cmdRef === uid;
    });
    if (!hasBinding) {
      commandIssues.push("No CommandBinding references this command (command will be unused)");
    }

    if (commandIssues.length > 0) {
      issues.push({ uid, label, filePath, issues: commandIssues });
    }
  }

  return issues;
}

/**
 * Build an InMemoryTripleStore from vault files using NoteToRDFConverter.
 */
async function buildTripleStore(vaultPath: string): Promise<{
  tripleStore: InMemoryTripleStore;
}> {
  const vaultAdapter = new FileSystemVaultAdapter(vaultPath);
  const converter = new NoteToRDFConverter(vaultAdapter);
  const triples = await converter.convertVault();
  const tripleStore = new InMemoryTripleStore();
  await tripleStore.addAll(triples);
  return { tripleStore };
}

function printGrounding(grounding: GroundingDefinition, indent: string): void {
  console.log(`${indent}ID: ${grounding.id}`);
  console.log(`${indent}Label: ${grounding.label}`);
  console.log(`${indent}Type: ${grounding.type}`);
  if (grounding.targetProperty) {
    console.log(`${indent}Target property: ${grounding.targetProperty}`);
  }
  if (grounding.targetValue !== undefined) {
    console.log(`${indent}Target value: ${grounding.targetValue}`);
  }
  if (grounding.sparqlUpdate) {
    console.log(`${indent}SPARQL UPDATE: ${grounding.sparqlUpdate}`);
  }
  if (grounding.steps && grounding.steps.length > 0) {
    console.log(`${indent}Steps (${grounding.steps.length}):`);
    for (let i = 0; i < grounding.steps.length; i++) {
      console.log(`${indent}  Step ${i + 1}:`);
      printGrounding(grounding.steps[i], indent + "    ");
    }
  }
}

function collectParsedFiles(
  dir: string,
  results: Array<{ filePath: string; fm: Record<string, any> }>,
): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      collectParsedFiles(fullPath, results);
    } else if (entry.name.endsWith(".md")) {
      try {
        const content = readFileSync(fullPath, "utf-8");
        const parsed = frontmatterService.parse(content);
        if (parsed.exists) {
          results.push({ filePath: fullPath, fm: parseYamlFrontmatter(parsed.content) });
        }
      } catch {
        // skip unparseable files
      }
    }
  }
}

function parseYamlFrontmatter(content: string): Record<string, any> {
  const result: Record<string, any> = {};
  const lines = content.split("\n");
  let currentKey = "";
  let currentArray: string[] | null = null;

  for (const line of lines) {
    if (line.match(/^\s+-\s+/) && currentKey) {
      const value = line.replace(/^\s+-\s+/, "").trim();
      if (!currentArray) {
        currentArray = [];
      }
      currentArray.push(value);
      result[currentKey] = currentArray;
      continue;
    }

    const kvMatch = line.match(/^([a-zA-Z0-9_]+):\s*(.*)/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      currentArray = null;
      let value: any = kvMatch[2].trim();

      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      if (value === "true") value = true;
      else if (value === "false") value = false;

      if (value === "") {
        result[currentKey] = [];
        currentArray = result[currentKey] as string[];
        continue;
      }

      result[currentKey] = value;
    }
  }

  return result;
}

function hasClass(fm: Record<string, any>, className: string): boolean {
  const instanceClass = fm["exo__Instance_class"];
  if (!instanceClass) return false;

  const classes = Array.isArray(instanceClass) ? instanceClass : [instanceClass];
  for (const cls of classes) {
    if (typeof cls !== "string") continue;
    const match = cls.match(/\[\[([^|\]]+)/);
    const extracted = match ? match[1] : cls;
    if (extracted === className) return true;
  }
  return false;
}

function normalizeWikilink(value: string): string {
  if (typeof value !== "string") return "";
  // Remove quotes and brackets, then strip "|Label" suffix (wikilink alias)
  const stripped = value.replace(/["'[\]]/g, "").trim();
  const pipeIdx = stripped.indexOf("|");
  return pipeIdx >= 0 ? stripped.substring(0, pipeIdx).trim() : stripped;
}

function extractLabelFromFilename(filePath: string): string {
  return basename(filePath, ".md");
}
