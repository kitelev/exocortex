import { App } from "obsidian";
import {
  ActionButton,
  ButtonGroup,
} from "@plugin/presentation/components/ActionButtonsGroup";
import type {
  CommandResolver,
  ResolvedCommand,
  PreconditionEvaluator,
  GroundingExecutor,
  UserInput,
  EvalContext,
  INotificationService,
} from "exocortex";
import { ILogger } from "@plugin/adapters/logging/ILogger";
import {
  IButtonGroupBuilder,
  ButtonBuilderContext,
} from "./ButtonBuilderTypes";
import { DynamicFormModal } from "@plugin/presentation/modals/DynamicFormModal";
import { resolveVariantForGroup } from "./categoryDefaultVariants";

/**
 * Configuration for DynamicCommandButtonGroupBuilder.
 * Injects the three core RFC-009 services.
 */
export interface DynamicCommandBuilderConfig {
  commandResolver: CommandResolver;
  preconditionEvaluator: PreconditionEvaluator;
  groundingExecutor: GroundingExecutor;
  notificationService: INotificationService;
}

/**
 * Option entry for enum fields — supports both simple strings and value/label pairs.
 */
export interface EnumOption {
  readonly value: string;
  readonly label: string;
}

/**
 * Schema field definition for input modals.
 *
 * Supported types:
 * - `text`      — single-line text input (default)
 * - `date`      — date picker (ISO 8601)
 * - `enum`      — dropdown with static options or dynamic SPARQL-sourced options
 * - `multiline` — multi-line textarea
 * - `assetRef`  — asset reference picker with optional SPARQL filter
 */
export interface InputSchemaField {
  readonly name: string;
  readonly type: "text" | "date" | "enum" | "multiline" | "assetRef";
  readonly label?: string;
  readonly required?: boolean;
  readonly defaultValue?: string;
  /** Enum options — accepts both simple strings and {value, label} pairs. */
  readonly options?: ReadonlyArray<string | EnumOption>;
  /** SPARQL SELECT query returning dynamic enum options (columns: ?value, ?label). */
  readonly sparqlQuery?: string;
  /** Number of visible rows for multiline fields (default: 4). */
  readonly rows?: number;
  /** SPARQL SELECT query returning candidate asset IRIs for assetRef fields. */
  readonly filterQuery?: string;
}

/**
 * Builds dynamic command buttons from vault-defined command assets (RFC-009 §5.5).
 *
 * This builder bridges the core command system (CommandResolver, PreconditionEvaluator,
 * GroundingExecutor) with the Obsidian layout rendering system. It:
 *
 * 1. Resolves commands for the current asset via CommandResolver
 * 2. Evaluates preconditions in PARALLEL via Promise.all
 * 3. Sorts by binding order and groups by binding group
 * 4. Creates ActionButtons for each visible command
 * 5. Handles confirmMessage, inputSchema modal, and successMessage
 *
 * Issue #2432
 */
export class DynamicCommandButtonGroupBuilder implements IButtonGroupBuilder {
  constructor(private readonly config: DynamicCommandBuilderConfig) {}

  getGroupId(): string {
    return "dynamic-commands";
  }

  getGroupTitle(): string {
    return "Commands";
  }

  async build(context: ButtonBuilderContext): Promise<ActionButton[]> {
    const resolved = await this.resolveVisibleCommands(context);
    if (resolved === null) return [];
    const { visibleCommands, subjectIRI } = resolved;
    const { app, file, logger, refresh } = context;
    return visibleCommands.map((rc) =>
      this.createButton(rc, subjectIRI, file.path, app as App, logger, refresh),
    );
  }

  /**
   * Build COMMANDS panel as category-grouped ButtonGroups (RFC-009 polish).
   *
   * Fixed category order: creation → status → planning → criticality → maintenance.
   * Commands with no category land in a trailing "Other" group. Maintenance is
   * marked collapsedByDefault because those commands are power-user repair tools
   * that rarely apply during normal work and otherwise dominate panel real-estate.
   *
   * Groups with zero visible commands are omitted — the React component re-filters
   * too, but returning them empty here keeps the payload lean.
   */
  async buildCategoryGroups(
    context: ButtonBuilderContext,
  ): Promise<ButtonGroup[]> {
    const resolved = await this.resolveVisibleCommands(context);
    if (resolved === null) return [];
    const { visibleCommands, subjectIRI } = resolved;
    const { app, file, logger, refresh } = context;

    const byCategory = new Map<string, ResolvedCommand[]>();
    for (const rc of visibleCommands) {
      const key = (rc.command.category ?? "").trim().toLowerCase() || "other";
      const bucket = byCategory.get(key);
      if (bucket) {
        bucket.push(rc);
      } else {
        byCategory.set(key, [rc]);
      }
    }

    const groups: ButtonGroup[] = [];
    for (const spec of DynamicCommandButtonGroupBuilder.CATEGORY_ORDER) {
      const commands = byCategory.get(spec.id);
      byCategory.delete(spec.id);
      if (!commands || commands.length === 0) continue;
      groups.push({
        id: `dynamic-commands-${spec.id}`,
        title: spec.title,
        collapsedByDefault: spec.collapsedByDefault,
        buttons: commands.map((rc) =>
          this.createButton(
            rc,
            subjectIRI,
            file.path,
            app as App,
            logger,
            refresh,
          ),
        ),
      });
    }

    // Any leftover categories (unexpected values) go into a single Other group
    // at the end, in insertion order, so nothing is silently dropped.
    const leftover: ResolvedCommand[] = [];
    for (const commands of byCategory.values()) {
      leftover.push(...commands);
    }
    if (leftover.length > 0) {
      groups.push({
        id: "dynamic-commands-other",
        title: "Other",
        buttons: leftover.map((rc) =>
          this.createButton(
            rc,
            subjectIRI,
            file.path,
            app as App,
            logger,
            refresh,
          ),
        ),
      });
    }

    return groups;
  }

  private static readonly CATEGORY_ORDER: ReadonlyArray<{
    id: string;
    title: string;
    collapsedByDefault?: boolean;
  }> = [
    { id: "creation", title: "Create" },
    { id: "status", title: "Status" },
    { id: "planning", title: "Planning" },
    { id: "criticality", title: "Criticality" },
    { id: "maintenance", title: "Maintenance", collapsedByDefault: true },
  ];

  private async resolveVisibleCommands(context: ButtonBuilderContext): Promise<{
    visibleCommands: ResolvedCommand[];
    subjectIRI: string;
  } | null> {
    const { file, metadata, logger } = context;

    // CRITICAL: subjectIRI MUST match triple store subject IRI.
    // NoteToRDFConverter indexes triples by `obsidian://vault/${encodeURI(file.path)}`,
    // not by exo__Asset_uid. Using UID here would cause SPARQL $target substitution
    // in PreconditionEvaluator to create queries that don't match any stored triples,
    // making all preconditions return false and no buttons to render.
    const subjectIRI = `obsidian://vault/${encodeURI(file.path)}`;

    const assetClasses = this.extractAssetClasses(metadata);
    if (assetClasses.length === 0) return null;

    const prototypeIRI = this.extractPrototypeIRI(metadata);

    let resolved: ResolvedCommand[];
    try {
      resolved = await this.config.commandResolver.resolveForAssetMulti(
        subjectIRI,
        assetClasses,
        prototypeIRI,
      );
    } catch (error) {
      logger.info(
        `[DynamicCommands] Failed to resolve commands: ${String(error)}`,
      );
      return null;
    }

    if (resolved.length === 0) return null;

    const evalContext: EvalContext = {
      targetIRI: subjectIRI,
      fileBasename: file.basename,
      currentFolder: file.parent?.path,
    };

    const availabilityChecks = await Promise.all(
      resolved.map(async (rc) => {
        try {
          const available = await this.config.preconditionEvaluator.evaluate(
            rc.command.precondition,
            subjectIRI,
            evalContext,
          );
          return { rc, available };
        } catch {
          return { rc, available: false };
        }
      }),
    );

    const visibleCommands = availabilityChecks
      .filter(({ available }) => available)
      .map(({ rc }) => rc);

    if (visibleCommands.length === 0) return null;

    return { visibleCommands, subjectIRI };
  }

  private createButton(
    rc: ResolvedCommand,
    targetIRI: string,
    filePath: string,
    app: App,
    logger: ILogger,
    refresh: () => Promise<void>,
  ): ActionButton {
    const { command, binding } = rc;
    const variant = resolveVariantForGroup(binding.group);

    // RFC-024 §4 Phase 2 — T5.3: render `Command_icon` by default. The
    // resolved `binding.style.showIcon` (populated in T5.2 by CommandResolver)
    // can opt out per-binding; absence of style or `showIcon=true` keeps the
    // existing icon — covers the 44 starter-kit bindings that already declare
    // `Command_icon` in RDF without any user configuration.
    const showIcon = binding.style?.showIcon !== false;
    const icon =
      showIcon && command.icon && command.icon.length > 0
        ? command.icon
        : undefined;

    return {
      id: `dynamic-cmd-${command.id}`,
      label: command.name,
      variant,
      icon,
      visible: true,
      onClick: async () => {
        await this.handleClick(rc, targetIRI, filePath, app, logger, refresh);
      },
    };
  }

  private async handleClick(
    rc: ResolvedCommand,
    targetIRI: string,
    filePath: string,
    app: App,
    logger: ILogger,
    refresh: () => Promise<void>,
  ): Promise<void> {
    const { command } = rc;

    if (command.confirmMessage) {
      const confirmed = await this.showConfirmation(command.confirmMessage);
      if (!confirmed) return;
    }

    let userInput: UserInput | undefined;
    const inputSchema = this.extractInputSchema(rc);
    if (inputSchema && inputSchema.length > 0) {
      const modal = new DynamicFormModal(app, inputSchema);
      const collected = await modal.waitForResult();
      if (collected === null) return;
      userInput = collected;
    }

    const result = await this.config.groundingExecutor.execute(
      command.grounding,
      targetIRI,
      filePath,
      userInput,
    );

    if (result.success) {
      if (command.successMessage) {
        this.config.notificationService.success(command.successMessage);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      await refresh();
      logger.info(
        `[DynamicCommands] Executed "${command.name}" on ${filePath}`,
      );
    } else {
      this.config.notificationService.error(
        `Command failed: ${result.error ?? "unknown error"}`,
      );
      logger.info(
        `[DynamicCommands] Failed "${command.name}": ${result.error}`,
      );
    }
  }

  private async showConfirmation(message: string): Promise<boolean> {
    return new Promise((resolve) => {
      // eslint-disable-next-line no-alert -- simple confirmation until a proper Obsidian modal is implemented
      const confirmed = window.confirm(message);
      resolve(confirmed);
    });
  }

  private extractInputSchema(rc: ResolvedCommand): InputSchemaField[] | null {
    const grounding = rc.command.grounding;
    const raw = (grounding as unknown as Record<string, unknown>)[
      "inputSchema"
    ];
    if (!raw || !Array.isArray(raw)) return null;

    return raw.filter(
      (field): field is InputSchemaField =>
        typeof field === "object" &&
        field !== null &&
        typeof (field as Record<string, unknown>)["name"] === "string" &&
        typeof (field as Record<string, unknown>)["type"] === "string",
    );
  }

  /**
   * Extract all declared classes from `exo__Instance_class`, plus the universal
   * `exo__Asset` superclass appended last so that bindings with `targetClass: exo__Asset`
   * match every asset in the vault (RFC-009 semantics, Issue #2958).
   *
   * Returns an empty array when no `exo__Instance_class` is declared — the builder
   * treats this as "no asset class context" and skips command resolution. This
   * preserves the pre-fix behavior of returning no buttons for unclassed files.
   *
   * If `exo__Asset` is already declared explicitly, it is not duplicated.
   */
  private extractAssetClasses(metadata: Record<string, unknown>): string[] {
    const raw = metadata["exo__Instance_class"];
    const classes: string[] = [];

    const collect = (value: unknown): void => {
      if (typeof value !== "string") return;
      const cleaned = value.replace(/["'[\]]/g, "").trim();
      if (cleaned && !classes.includes(cleaned)) classes.push(cleaned);
    };

    if (typeof raw === "string") {
      collect(raw);
    } else if (Array.isArray(raw)) {
      for (const item of raw) collect(item);
    }

    if (classes.length === 0) return [];

    if (!classes.includes("exo__Asset")) classes.push("exo__Asset");

    return classes;
  }

  private extractPrototypeIRI(
    metadata: Record<string, unknown>,
  ): string | undefined {
    const raw = metadata["exo__Asset_prototype"];
    if (typeof raw === "string") {
      return raw.replace(/["'[\]]/g, "").trim();
    }
    return undefined;
  }
}
