import { App } from "obsidian";
import {
  ActionButton,
  ActionButtonVariant,
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
import { resolveDefaultVariantForCategory } from "./categoryDefaultVariants";
import {
  FALLBACK_CATEGORY_ORDER,
  resolveCategoryCollapsed,
  resolveCategoryTitle,
} from "./categoryDisplayDefaults";
import { PanelResolver } from "@plugin/application/services/PanelResolver";

/**
 * Configuration for DynamicCommandButtonGroupBuilder.
 * Injects the three core RFC-009 services plus the optional RFC-024 Phase 3
 * {@link PanelResolver} that consults `exo__Layout_commandPanel` for
 * per-class command filtering / regrouping / featured-binding overrides.
 */
export interface DynamicCommandBuilderConfig {
  commandResolver: CommandResolver;
  preconditionEvaluator: PreconditionEvaluator;
  groundingExecutor: GroundingExecutor;
  notificationService: INotificationService;
  /**
   * Optional. When omitted a default no-op resolver is used (no panel
   * declared for any class) so existing call-sites and tests remain
   * non-breaking.
   */
  panelResolver?: PanelResolver;
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
 * 3. Applies the class-level `exo__Layout_commandPanel` filter
 *    (RFC-024 Phase 3 — `excludeCommands` trumps `includeGroups`)
 * 4. Sorts by binding order and groups by command category
 * 5. Creates ActionButtons for each visible command, promoting the
 *    panel's `featuredBinding` to the `primary` variant
 * 6. Handles confirmMessage, inputSchema modal, and successMessage
 *
 * Issue #2432
 */
export class DynamicCommandButtonGroupBuilder implements IButtonGroupBuilder {
  private readonly panelResolver: PanelResolver;

  constructor(private readonly config: DynamicCommandBuilderConfig) {
    this.panelResolver = config.panelResolver ?? new PanelResolver();
  }

  getGroupId(): string {
    return "dynamic-commands";
  }

  getGroupTitle(): string {
    return "Commands";
  }

  async build(context: ButtonBuilderContext): Promise<ActionButton[]> {
    const resolved = await this.resolveVisibleCommands(context);
    if (resolved === null) return [];
    const { visibleCommands, subjectIRI, panelClassRef } = resolved;
    const { app, file, logger, refresh } = context;
    return visibleCommands.map((rc) =>
      this.createButton(
        rc,
        subjectIRI,
        file.path,
        app as App,
        logger,
        refresh,
        panelClassRef,
      ),
    );
  }

  /**
   * Build COMMANDS panel as category-grouped ButtonGroups (RFC-009 polish,
   * RFC-024 Phase 3 panel-aware ordering).
   *
   * Ordering rules (RFC-024 §5 precedence):
   * - When the resolved panel for the asset's class declares
   *   `includeGroups`, that array determines the section order. Categories
   *   present in commands but absent from `includeGroups` are appended
   *   afterwards in insertion order so nothing is silently dropped.
   * - When no panel is declared, the plugin-built-in
   *   {@link FALLBACK_CATEGORY_ORDER} is used as a sensible default
   *   (creation → status → planning → criticality → maintenance).
   *
   * Titles and `collapsedByDefault` come from
   * {@link resolveCategoryTitle}/{@link resolveCategoryCollapsed} — these
   * are display defaults, not ordering authority.
   *
   * Groups with zero visible commands are omitted.
   */
  async buildCategoryGroups(
    context: ButtonBuilderContext,
  ): Promise<ButtonGroup[]> {
    const resolved = await this.resolveVisibleCommands(context);
    if (resolved === null) return [];
    const { visibleCommands, subjectIRI, panelClassRef } = resolved;
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

    const panel =
      panelClassRef !== null
        ? (this.panelResolver.resolve(panelClassRef) ?? undefined)
        : undefined;
    const orderedKeys = this.resolveCategoryOrder(panel, byCategory);

    const groups: ButtonGroup[] = [];
    for (const key of orderedKeys) {
      const commands = byCategory.get(key);
      if (!commands || commands.length === 0) continue;
      const isOther = key === "other";
      groups.push({
        id: `dynamic-commands-${key}`,
        title: isOther ? "Other" : resolveCategoryTitle(key),
        collapsedByDefault: isOther
          ? undefined
          : resolveCategoryCollapsed(key, panel),
        buttons: commands.map((rc) =>
          this.createButton(
            rc,
            subjectIRI,
            file.path,
            app as App,
            logger,
            refresh,
            panelClassRef,
          ),
        ),
      });
    }

    return groups;
  }

  /**
   * Compute the rendering order of category section keys for the resolved
   * panel. `includeGroups` (when present) wins; remaining categories are
   * appended in insertion order so unexpected values are never silently
   * dropped.
   */
  private resolveCategoryOrder(
    panel: { includeGroups?: readonly string[] } | undefined,
    byCategory: ReadonlyMap<string, ResolvedCommand[]>,
  ): string[] {
    const present = new Set(byCategory.keys());
    const ordered: string[] = [];
    const seen = new Set<string>();

    const includeGroups = panel?.includeGroups;

    const primary =
      includeGroups && includeGroups.length > 0
        ? includeGroups
        : FALLBACK_CATEGORY_ORDER;

    for (const key of primary) {
      const normalized = key.trim().toLowerCase();
      if (!seen.has(normalized) && present.has(normalized)) {
        ordered.push(normalized);
        seen.add(normalized);
      }
    }
    for (const key of byCategory.keys()) {
      if (!seen.has(key)) {
        ordered.push(key);
        seen.add(key);
      }
    }
    return ordered;
  }

  private async resolveVisibleCommands(context: ButtonBuilderContext): Promise<{
    visibleCommands: ResolvedCommand[];
    subjectIRI: string;
    panelClassRef: string | null;
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

    // RFC-024 Phase 3: panels are resolved against the most-specific
    // declared class — i.e. the first non-`exo__Asset` class. Universal
    // `exo__Asset` is the appended superclass and would over-broadly bind
    // to every asset's panel.
    const panelClassRef = assetClasses.find((c) => c !== "exo__Asset") ?? null;

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

    const preconditionPassed = availabilityChecks
      .filter(({ available }) => available)
      .map(({ rc }) => rc);

    // RFC-024 Phase 3 — apply class-level panel filter (excludeCommands
    // trumps includeGroups). When no panel is declared this is a pure
    // pass-through. Filter dimension uses `command.category` (post-RFC
    // f1dc284a — sectioning axis is `Command_category`, no longer routed
    // through the synthesised `binding.group` bridge).
    const visibleCommands =
      panelClassRef !== null
        ? this.panelResolver
            .applyFilter(
              panelClassRef,
              preconditionPassed.map((rc) => ({
                uid: rc.binding.id,
                category: rc.command.category,
                rc,
              })),
            )
            .map((entry) => entry.rc)
        : preconditionPassed;

    if (visibleCommands.length === 0) return null;

    return { visibleCommands, subjectIRI, panelClassRef };
  }

  private createButton(
    rc: ResolvedCommand,
    targetIRI: string,
    filePath: string,
    app: App,
    logger: ILogger,
    refresh: () => Promise<void>,
    panelClassRef: string | null,
  ): ActionButton {
    const { command, binding } = rc;

    // Variant precedence (RFC f1dc284a-eadc-4d0e-8e72-323e999ea510):
    //   binding.variant > featuredBinding > category default > "secondary"
    // Explicit per-binding override wins over panel-level featuredBinding so
    // a destructive `maintenance` command can be rendered as `danger` even
    // when nominated featured (cf. RFC §Кейс A). Featured binding still
    // promotes to `primary` when no explicit variant is set.
    const featured =
      panelClassRef !== null &&
      this.panelResolver.isFeatured(panelClassRef, binding.id);

    const variant: ActionButtonVariant =
      binding.variant ??
      (featured
        ? "primary"
        : resolveDefaultVariantForCategory(command.category));

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

    // RFC-024 §4 Phase 2 — T5.4: propagate accessibility properties from
    // the resolved CommandBindingStyle. `ariaLabel` overrides the
    // screen-reader name; `tooltip` populates the `title` attribute. Both
    // are populated by CommandResolver (T5.2) and forwarded as-is so the
    // UI layer remains a passthrough — no defaults / coercion here.
    const ariaLabel = binding.style?.ariaLabel;
    const tooltip = binding.style?.tooltip;

    return {
      id: `dynamic-cmd-${command.id}`,
      label: command.name,
      variant,
      icon,
      ariaLabel,
      tooltip,
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
