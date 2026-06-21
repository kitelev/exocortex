import { Command } from "commander";
import { existsSync, readdirSync, readFileSync } from "fs";
import { resolve, join } from "path";
import {
  FrontmatterService,
  WikiLinkHelpers,
  WorkflowEngine,
  AssetClass,
  EffortStatus,
  type WorkflowDefinition,
  type WorkflowStateDefinition,
  type WorkflowTransitionDefinition,
} from "@kitelev/exocortex-core";
import { ErrorHandler, type OutputFormat } from "../utils/ErrorHandler.js";
import { VaultNotFoundError } from "../utils/errors/index.js";
import { ResponseBuilder } from "../responses/index.js";

export interface WorkflowCommandOptions {
  vault: string;
  output?: OutputFormat;
}

interface WorkflowFileInfo {
  filePath: string;
  uid: string;
  label: string;
  targetClass: string;
  isDefault: boolean;
  stateCount: number;
  transitionCount: number;
}

/**
 * Creates the 'workflow' command group for listing, showing, and validating
 * custom workflow definitions in the vault.
 *
 * Issue #2365
 */
export function workflowCommand(): Command {
  const workflow = new Command("workflow")
    .description("Manage custom workflow definitions");

  workflow
    .command("list")
    .description("List all workflow definitions in the vault")
    .option("--vault <path>", "Path to Obsidian vault", process.cwd())
    .option("--output <type>", "Response format: text|json", "text")
    .action(async (options: WorkflowCommandOptions) => {
      const outputFormat = (options.output || "text") as OutputFormat;
      ErrorHandler.setFormat(outputFormat);

      try {
        const vaultPath = resolve(options.vault);
        if (!existsSync(vaultPath)) {
          throw new VaultNotFoundError(vaultPath);
        }

        const workflows = scanWorkflows(vaultPath);

        if (outputFormat === "json") {
          const response = ResponseBuilder.success({
            workflows,
            totalWorkflows: workflows.length,
          });
          console.log(JSON.stringify(response, null, 2));
        } else {
          if (workflows.length === 0) {
            console.log("No workflows found in vault.");
            return;
          }

          console.log(`\n📋 Found ${workflows.length} workflow(s):\n`);

          const maxName = Math.max(...workflows.map(w => w.label.length), 4);
          const maxClass = Math.max(...workflows.map(w => w.targetClass.length), 12);

          console.log("┌" + "─".repeat(maxName + 2) + "┬" + "─".repeat(maxClass + 2) + "┬" + "─".repeat(8) + "┬" + "─".repeat(13) + "┬" + "─".repeat(9) + "┐");
          console.log("│ " + "Name".padEnd(maxName) + " │ " + "Target Class".padEnd(maxClass) + " │ " + "States".padEnd(6) + " │ " + "Transitions".padEnd(11) + " │ " + "Default".padEnd(7) + " │");
          console.log("├" + "─".repeat(maxName + 2) + "┼" + "─".repeat(maxClass + 2) + "┼" + "─".repeat(8) + "┼" + "─".repeat(13) + "┼" + "─".repeat(9) + "┤");

          for (const w of workflows) {
            console.log(
              "│ " + w.label.padEnd(maxName) +
              " │ " + w.targetClass.padEnd(maxClass) +
              " │ " + w.stateCount.toString().padStart(6) +
              " │ " + w.transitionCount.toString().padStart(11) +
              " │ " + (w.isDefault ? "  yes  " : "   no  ") + " │"
            );
          }

          console.log("└" + "─".repeat(maxName + 2) + "┴" + "─".repeat(maxClass + 2) + "┴" + "─".repeat(8) + "┴" + "─".repeat(13) + "┴" + "─".repeat(9) + "┘");
        }
      } catch (error) {
        ErrorHandler.handle(error as Error);
      }
    });

  workflow
    .command("show")
    .description("Show details of a workflow definition")
    .argument("<uid>", "UID of the workflow asset")
    .option("--vault <path>", "Path to Obsidian vault", process.cwd())
    .option("--output <type>", "Response format: text|json", "text")
    .action(async (uid: string, options: WorkflowCommandOptions) => {
      const outputFormat = (options.output || "text") as OutputFormat;
      ErrorHandler.setFormat(outputFormat);

      try {
        const vaultPath = resolve(options.vault);
        if (!existsSync(vaultPath)) {
          throw new VaultNotFoundError(vaultPath);
        }

        const definition = loadWorkflowByUid(vaultPath, uid);
        if (!definition) {
          if (outputFormat === "json") {
            const response = ResponseBuilder.success({
              error: `Workflow with UID "${uid}" not found`,
            });
            console.log(JSON.stringify(response, null, 2));
          } else {
            console.log(`❌ Workflow with UID "${uid}" not found.`);
          }
          process.exitCode = 1;
          return;
        }

        if (outputFormat === "json") {
          const response = ResponseBuilder.success(definition);
          console.log(JSON.stringify(response, null, 2));
        } else {
          console.log(`\n📋 Workflow: ${definition.name}\n`);
          console.log(`   ID: ${definition.id}`);
          console.log(`   Target class: ${definition.targetClass}`);
          console.log(`   Initial state: ${definition.initialState}`);
          console.log(`   Terminal states: ${definition.terminalStates.join(", ")}`);
          console.log(`   Default: ${definition.isDefault ? "yes" : "no"}`);

          console.log(`\n   States (${definition.states.length}):`);
          for (const s of definition.states) {
            const optStr = s.optional ? " (optional)" : "";
            const tsStr = s.timestampOnEnter.length > 0
              ? ` [timestamps: ${s.timestampOnEnter.join(", ")}]`
              : "";
            console.log(`     ${s.order}. ${s.status}${optStr}${tsStr}`);
          }

          console.log(`\n   Transitions (${definition.transitions.length}):`);
          for (const t of definition.transitions) {
            const rollback = t.isRollback ? " (rollback)" : "";
            console.log(`     ${t.label}: ${t.from} → ${t.to}${rollback}`);
          }
        }
      } catch (error) {
        ErrorHandler.handle(error as Error);
      }
    });

  workflow
    .command("validate")
    .description("Validate a workflow definition")
    .argument("<uid>", "UID of the workflow asset")
    .option("--vault <path>", "Path to Obsidian vault", process.cwd())
    .option("--output <type>", "Response format: text|json", "text")
    .action(async (uid: string, options: WorkflowCommandOptions) => {
      const outputFormat = (options.output || "text") as OutputFormat;
      ErrorHandler.setFormat(outputFormat);

      try {
        const vaultPath = resolve(options.vault);
        if (!existsSync(vaultPath)) {
          throw new VaultNotFoundError(vaultPath);
        }

        const definition = loadWorkflowByUid(vaultPath, uid);
        if (!definition) {
          if (outputFormat === "json") {
            const response = ResponseBuilder.success({
              error: `Workflow with UID "${uid}" not found`,
            });
            console.log(JSON.stringify(response, null, 2));
          } else {
            console.log(`❌ Workflow with UID "${uid}" not found.`);
          }
          process.exitCode = 1;
          return;
        }

        const engine = new WorkflowEngine(definition);
        const result = engine.validate();

        if (outputFormat === "json") {
          const response = ResponseBuilder.success({
            workflow: definition.name,
            uid: definition.id,
            ...result,
          });
          console.log(JSON.stringify(response, null, 2));
        } else {
          if (result.valid) {
            console.log(`✅ Workflow "${definition.name}" is valid.`);
          } else {
            console.log(`❌ Workflow "${definition.name}" has ${result.errors.length} error(s):\n`);
            for (const err of result.errors) {
              console.log(`   • ${err}`);
            }
            process.exitCode = 1;
          }
        }
      } catch (error) {
        ErrorHandler.handle(error as Error);
      }
    });

  return workflow;
}

// ─── Helpers ────────────────────────────────────────────────────────

const frontmatterService = new FrontmatterService();

/**
 * Scan vault for workflow definition files.
 * Recursively finds .md files with exo__Instance_class containing ems__Workflow.
 */
function scanWorkflows(vaultPath: string): WorkflowFileInfo[] {
  const workflows: WorkflowFileInfo[] = [];
  const allFiles: Array<{ filePath: string; fm: Record<string, any> }> = [];
  collectParsedFiles(vaultPath, allFiles);

  // Build UUID → exo__Asset_label map so `exo__Instance_class` refs stored
  // in UID-canon form `[[<uuid>]]` (post RFC-004, 2026-05-16) resolve back
  // to their symbolic class names (`ems__Workflow`, `ems__WorkflowState`,
  // `ems__WorkflowTransition`) before the substring discriminator runs.
  const labelByUid = new Map<string, string>();
  for (const { fm } of allFiles) {
    const uid = fm["exo__Asset_uid"];
    const label = fm["exo__Asset_label"];
    if (uid && label) labelByUid.set(String(uid), String(label));
  }
  const resolver = (uid: string): string | null =>
    labelByUid.get(uid) ?? null;

  const isWorkflowClass = (c: unknown): boolean => {
    const sym = WikiLinkHelpers.resolveSymbolic(
      typeof c === "string" ? c : String(c ?? ""),
      resolver,
    );
    return (
      sym.includes("ems__Workflow") &&
      !sym.includes("WorkflowState") &&
      !sym.includes("WorkflowTransition")
    );
  };
  const isWorkflowStateClass = (c: unknown): boolean =>
    WikiLinkHelpers.resolveSymbolic(
      typeof c === "string" ? c : String(c ?? ""),
      resolver,
    ).includes("ems__WorkflowState");
  const isWorkflowTransitionClass = (c: unknown): boolean =>
    WikiLinkHelpers.resolveSymbolic(
      typeof c === "string" ? c : String(c ?? ""),
      resolver,
    ).includes("ems__WorkflowTransition");

  for (const { filePath, fm } of allFiles) {
    const instanceClass = fm["exo__Instance_class"];
    if (!instanceClass) continue;

    const isWorkflow = Array.isArray(instanceClass)
      ? instanceClass.some(isWorkflowClass)
      : isWorkflowClass(instanceClass);

    if (!isWorkflow) continue;

    const uid = fm["exo__Asset_uid"] ?? "";
    const label = fm["exo__Asset_label"] ?? extractLabelFromFilename(filePath);
    const targetClass = normalizeWikilink(fm["ems__Workflow_targetClass"] ?? "ems__Task");
    const isDefault = fm["ems__Workflow_isDefault"] === true || fm["ems__Workflow_isDefault"] === "true";

    // Count linked states and transitions by scanning all parsed files
    let stateCount = 0;
    let transitionCount = 0;
    for (const { fm: otherFm } of allFiles) {
      const otherClass = otherFm["exo__Instance_class"];
      const otherWorkflowRef = normalizeWikilink(
        otherFm["ems__WorkflowState_workflow"] ?? otherFm["ems__WorkflowTransition_workflow"] ?? ""
      );
      const referencesThisWorkflow = otherWorkflowRef.includes(uid);

      if (!referencesThisWorkflow) continue;

      const isState = Array.isArray(otherClass)
        ? otherClass.some(isWorkflowStateClass)
        : isWorkflowStateClass(otherClass);

      const isTransition = Array.isArray(otherClass)
        ? otherClass.some(isWorkflowTransitionClass)
        : isWorkflowTransitionClass(otherClass);

      if (isState) stateCount++;
      if (isTransition) transitionCount++;
    }

    workflows.push({
      filePath,
      uid,
      label,
      targetClass,
      isDefault,
      stateCount,
      transitionCount,
    });
  }

  return workflows;
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

/**
 * Load a full WorkflowDefinition by scanning vault for a workflow with matching UID.
 */
function loadWorkflowByUid(
  vaultPath: string,
  uid: string,
): WorkflowDefinition | null {
  const workflows = scanWorkflows(vaultPath);
  const found = workflows.find(w => w.uid === uid);
  if (!found) return null;

  try {
    const content = readFileSync(found.filePath, "utf-8");
    const parsed = frontmatterService.parse(content);
    if (!parsed.exists) return null;

    const fm = parseYamlFrontmatter(parsed.content);

    const targetClass = normalizeWikilink(fm["ems__Workflow_targetClass"] ?? "ems__Task") as AssetClass;
    const initialStateRaw = normalizeWikilink(fm["ems__Workflow_initialState"] ?? "ems__EffortStatusDraft");
    const initialState = resolveEffortStatus(initialStateRaw) ?? EffortStatus.DRAFT;

    const terminalStatesRaw: string[] = Array.isArray(fm["ems__Workflow_terminalStates"])
      ? fm["ems__Workflow_terminalStates"].map((s: string) => normalizeWikilink(s))
      : [];
    const terminalStates = terminalStatesRaw
      .map(resolveEffortStatus)
      .filter((s): s is EffortStatus => s !== null);

    const isDefault = fm["ems__Workflow_isDefault"] === true || fm["ems__Workflow_isDefault"] === "true";

    // Build states from inline YAML or linked files
    const statesRaw: any[] = Array.isArray(fm["ems__Workflow_states"]) ? fm["ems__Workflow_states"] : [];
    const states: WorkflowStateDefinition[] = statesRaw.map((s: any, idx: number) => {
      if (typeof s === "string") {
        const status = resolveEffortStatus(normalizeWikilink(s));
        return {
          status: status ?? EffortStatus.DRAFT,
          order: idx + 1,
          optional: false,
          timestampOnEnter: [],
        };
      }
      return {
        status: resolveEffortStatus(normalizeWikilink(s.status ?? "")) ?? EffortStatus.DRAFT,
        order: s.order ?? idx + 1,
        optional: s.optional === true || s.optional === "true",
        timestampOnEnter: Array.isArray(s.timestampOnEnter) ? s.timestampOnEnter : [],
        badgeColor: s.badgeColor,
      };
    });

    const transitionsRaw: any[] = Array.isArray(fm["ems__Workflow_transitions"]) ? fm["ems__Workflow_transitions"] : [];
    const transitions: WorkflowTransitionDefinition[] = transitionsRaw
      .map((t: any) => {
        const from = resolveEffortStatus(normalizeWikilink(t.from ?? ""));
        const to = resolveEffortStatus(normalizeWikilink(t.to ?? ""));
        if (!from || !to) return null;
        return {
          from,
          to,
          label: t.label ?? `${from} → ${to}`,
          icon: t.icon,
          isRollback: t.isRollback === true || t.isRollback === "true",
        };
      })
      .filter((t): t is WorkflowTransitionDefinition => t !== null);

    return {
      id: uid,
      name: found.label,
      targetClass,
      states,
      transitions,
      initialState,
      terminalStates: terminalStates.length > 0
        ? terminalStates
        : [EffortStatus.DONE, EffortStatus.TRASHED],
      isDefault,
    };
  } catch {
    return null;
  }
}

/**
 * Simple YAML frontmatter parser for key-value pairs.
 * Handles basic YAML: strings, booleans, arrays.
 */
function parseYamlFrontmatter(content: string): Record<string, any> {
  const result: Record<string, any> = {};
  const lines = content.split("\n");
  let currentKey = "";
  let currentArray: string[] | null = null;

  for (const line of lines) {
    // Array item
    if (line.match(/^\s+-\s+/) && currentKey) {
      const value = line.replace(/^\s+-\s+/, "").trim();
      if (!currentArray) {
        currentArray = [];
      }
      currentArray.push(value);
      result[currentKey] = currentArray;
      continue;
    }

    // Key-value pair
    const kvMatch = line.match(/^([a-zA-Z0-9_]+):\s*(.*)/);
    if (kvMatch) {
      // Save previous array
      currentKey = kvMatch[1];
      currentArray = null;
      let value: any = kvMatch[2].trim();

      // Remove quotes
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      // Boolean conversion
      if (value === "true") value = true;
      else if (value === "false") value = false;

      // Empty value means possible array follows
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

function normalizeWikilink(value: string): string {
  if (typeof value !== "string") return "";
  return value.replace(/["'[\]]/g, "").trim();
}

function extractLabelFromFilename(filePath: string): string {
  const parts = filePath.split("/");
  const filename = parts[parts.length - 1];
  return filename.replace(/\.md$/, "");
}

function resolveEffortStatus(raw: string): EffortStatus | null {
  return Object.values(EffortStatus).includes(raw as EffortStatus)
    ? (raw as EffortStatus)
    : null;
}
