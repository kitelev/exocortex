import type { App } from "obsidian";
import {
  ActionButton,
  ActionButtonVariant,
  ButtonGroup,
} from "@plugin/presentation/components/ActionButtonsGroup";
import type {
  CommandResolver,
  ResolvedCommand,
  PreconditionEvaluator,
  EvalContext,
  CommandExecutionFlow,
} from "@kitelev/exocortex-core";
import {
  IButtonGroupBuilder,
  ButtonBuilderContext,
} from "./ButtonBuilderTypes";
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
  /**
   * Pipeline that handles confirm → modal → execute → notify when a
   * button is clicked. Shared with the global Command Palette registrar
   * (RFC `1429fcd0`). Construct it with a `GroundingExecutor` +
   * `INotificationService` + an Obsidian-side `CommandPromptAdapter`.
   */
  commandExecutionFlow: CommandExecutionFlow;
  /**
   * Optional. When omitted a default no-op resolver is used (no panel
   * declared for any class) so existing call-sites and tests remain
   * non-breaking.
   */
  panelResolver?: PanelResolver;
}
// RFC c7da0bca Phase 3c-3 — dropped the cold-start `fastResolver` +
// `isFullPathReady` + `bindingsCache` optional fields. They paired
// with `ExocmdFastResolver` + `ExocmdBindingsCache` which were
// deleted in 3c-2 once `LazyAssetGraphLoader` became
// render-authoritative (PR #3257).

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
  // T3 «Create Instance» (project bbe40f8c) — `number` / `boolean` added so the
  // required-property resolver can map xsd:integer/decimal/… → number and
  // xsd:boolean → boolean from a property's range.
  readonly type:
    | "text"
    | "date"
    | "number"
    | "boolean"
    | "enum"
    | "multiline"
    | "assetRef";
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
  /**
   * T1 "Create Instance" (project bbe40f8c) — for `assetRef` fields, the UID of
   * the class whose instances populate the reusable fuzzy reference-picker.
   * The form layer resolves candidate `{uid, label}` pairs of this class from
   * the vault. Generic: parameterises the picker by class (ontology here;
   * any range class for future commands).
   */
  readonly targetClassUid?: string;
}

/**
 * A selectable asset for the fuzzy reference-picker — an instance of a field's
 * `targetClassUid`, shown by `label`, committed as a wikilink to `uid`.
 */
export interface AssetRefCandidate {
  readonly uid: string;
  readonly label: string;
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
    const { file, refresh } = context;
    return visibleCommands.map((rc) =>
      this.createButton(rc, subjectIRI, file.path, refresh, panelClassRef),
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
    const { file, refresh } = context;

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
          this.createButton(rc, subjectIRI, file.path, refresh, panelClassRef),
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

    const assetClasses = await this.extractAssetClasses(
      metadata,
      context.app as App,
      logger,
    );
    if (assetClasses.length === 0) return null;

    // RFC-024 Phase 3: panels are resolved against the most-specific
    // declared class — i.e. the first non-`exo__Asset` class. Universal
    // `exo__Asset` is the appended superclass and would over-broadly bind
    // to every asset's panel. Symbolic names (e.g. `ems__Task`) are
    // preferred over UUID-form refs for panel lookup since panel configs
    // are authored against symbolic class names.
    const panelClassRef =
      assetClasses.find((c) => c !== "exo__Asset" && !this.isUuidRef(c)) ??
      assetClasses.find((c) => c !== "exo__Asset") ??
      null;

    const prototypeIRI = this.extractPrototypeIRI(metadata);
    const assetUid = this.extractAssetUid(metadata);

    // Issue #3183 — persistent disk cache. Cache stores binding-resolution
    // output (NOT precondition-filter output): the indexer's representative
    // target cannot speak for every future asset of the same class — its
    // frontmatter state determines target-state preconditions like
    // `ASK { $target ems:Effort_startTimestamp ?x }` differently than a
    // sibling task that does have that property. So the cache only saves
    // the binding-resolution SPARQL hop; preconditions are re-evaluated
    // per-render against the live triple store, matching the full-path
    // contract byte-for-byte. Class-hierarchy preconditions (CREATE
    // category) still need the full store to evaluate correctly — once
    // it is ready they pass and the buttons appear; in the cold-start
    // window before convertVault() they remain hidden (same as today's
    // fast path).
    //
    // Lookup tries every non-`exo__Asset` class key the asset declares
    // — UUID-canonical first (post-2026-05-16) then symbolic aliases —
    // so cache writes keyed by either form resolve correctly.
    // RFC c7da0bca Phase 3c-3 — deleted the cached-bindings short-
    // circuit + cold-start fast-path branch. `LazyAssetGraphLoader`
    // populates the triple store before every render (PR #3257),
    // so the full-path resolver always has the asset + class chain
    // available. The branching that previously chose between cache
    // hit → fast-path → full-path is now reduced to "always
    // full-path".
    const preconditionPassed: ResolvedCommand[] | null =
      await this.resolveViaFullPath(
        subjectIRI,
        assetClasses,
        prototypeIRI,
        file,
        logger,
        assetUid,
      );

    if (preconditionPassed === null) return null;

    // RFC-024 Phase 3 — apply class-level panel filter (excludeCommands
    // trumps includeGroups). When no panel is declared this is a pure
    // pass-through. Filter dimension is `command.category` (RFC f1dc284a
    // — sectioning axis is `Command_category`).
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

  /**
   * Production path: resolves bindings against the fully-populated global
   * triple store and evaluates preconditions in PARALLEL. Returns `null`
   * when bindings resolution itself throws (logged), or an empty array
   * when no binding matches.
   */
  private async resolveViaFullPath(
    subjectIRI: string,
    assetClasses: string[],
    prototypeIRI: string | undefined,
    file: ButtonBuilderContext["file"],
    logger: ButtonBuilderContext["logger"],
    assetUid: string | undefined,
  ): Promise<ResolvedCommand[] | null> {
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

    // Run preconditions in PARALLEL against the live evaluator and
    // return only the commands whose preconditions evaluated to true.
    // RFC c7da0bca Phase 3c-3 — body inlined here from the previously-
    // extracted `evaluatePreconditions` helper (the helper was needed
    // only because the cache-hit path also used it; that path is gone).
    const evalContext: EvalContext = {
      targetIRI: subjectIRI,
      fileBasename: file.basename,
      currentFolder: file.parent?.path,
      filePath: file.path,
      assetUid,
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
    return availabilityChecks
      .filter(({ available }) => available)
      .map(({ rc }) => rc);
  }

  // RFC c7da0bca Phase 3c-3 — deleted `resolveViaFastPath` +
  // `resolveViaCache` private helpers and the `fastpathReadyMarked` +
  // `cacheAppliedMarked` state flags. They implemented the cold-
  // start cache + fast-resolver branches that are gone with
  // `LazyAssetGraphLoader` becoming render-authoritative (PR #3257).
  // `resolveViaFullPath` is now the sole resolution path; its body
  // also absorbed the `evaluatePreconditions` helper.

  private createButton(
    rc: ResolvedCommand,
    targetIRI: string,
    filePath: string,
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
        await this.config.commandExecutionFlow.run(rc, {
          targetIRI,
          filePath,
          onComplete: refresh,
        });
      },
    };
  }

  /**
   * Extract all declared classes from `exo__Instance_class`, plus the universal
   * `exo__Asset` superclass appended last so that bindings with `targetClass: exo__Asset`
   * match every asset in the vault (RFC-009 semantics, Issue #2958).
   *
   * Issue #3141: After UUID-canon TBox migration (CLAUDE.md §UUID-canon, 2026-05-16)
   * and the subsequent strip-aliases pass (2026-05-17 — `[[<uid>|<symbolic>]]` →
   * `[[<uid>]]`), `exo__Instance_class` references are bare UUIDs. CommandBinding
   * `targetClass` literals (e.g. `"ems__Task"`) are authored as symbolic names and
   * are compared by `CommandResolver.matchesReference` at JS-string level — no
   * IRI resolution, no triple-store lookup. The previous alias-form
   * `[[<uid>|<symbolic>]]` worked because `extractAlias` extracted the symbolic
   * tail. After strip-aliases, that path collapsed and class-targeted bindings
   * silently stopped matching.
   *
   * Fix: when a class ref looks like a UUID, resolve it through Obsidian's
   * metadata cache and append the class file's symbolic `exo__Asset_label`
   * (e.g. `ems__Task`) alongside the UUID. Both forms then participate in
   * `resolveForAssetMulti`'s per-class binding scan. Universal `exo__Asset`
   * bindings already work because `extractAssetClasses` appends the literal
   * `"exo__Asset"` regardless of UUID-canon — that path was never broken.
   *
   * Returns an empty array when no `exo__Instance_class` is declared.
   */
  private async extractAssetClasses(
    metadata: Record<string, unknown>,
    app?: App,
    logger?: ButtonBuilderContext["logger"],
  ): Promise<string[]> {
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

    // Issue #3141 — expand UUID class refs to also include their symbolic
    // `exo__Asset_label` so CommandBindings with `targetClass: "ems__Task"`
    // match instances whose `exo__Instance_class` is UUID-canonicalised.
    //
    // Two-tier resolution (#3141 follow-up, 2026-05-21):
    //   1. `app.metadataCache.getFirstLinkpathDest()` — fast, in-process.
    //   2. `commandResolver.resolveLabelByUID()` — triple-store fallback
    //      when Obsidian's metadata cache has not yet indexed the class
    //      file (cold-start, post-reload, or class file lives under
    //      `assetspaces/` that the cache hasn't visited yet).
    // Without (2), class-targeted bindings silently fail to match in the
    // race window — empirically observed on `1-2-1 a.kayukova`
    // (ems__MeetingPrototype instance) where buttons disappeared until
    // a forced re-open warmed the metadata cache.
    const symbolicAliases: string[] = [];
    for (const cls of classes) {
      if (!this.isUuidRef(cls)) continue;

      let label: string | null = null;

      const classFile = app?.metadataCache?.getFirstLinkpathDest?.(cls, "");
      if (classFile) {
        const cache = app?.metadataCache?.getFileCache?.(classFile);
        const cachedLabel = cache?.frontmatter?.["exo__Asset_label"];
        if (typeof cachedLabel === "string" && cachedLabel.length > 0) {
          label = cachedLabel;
        }
      }

      if (!label) {
        try {
          label = await this.config.commandResolver.resolveLabelByUID(cls);
        } catch (error) {
          logger?.info(
            `[DynamicCommands] resolveLabelByUID(${cls}) threw: ${String(error)}`,
          );
        }
      }

      if (label && label.length > 0) {
        if (!classes.includes(label) && !symbolicAliases.includes(label)) {
          symbolicAliases.push(label);
        }
      } else {
        logger?.info(
          `[DynamicCommands] no symbolic exo__Asset_label resolved for UUID class ref ${cls} (metadata cache + triple store both empty); class-targeted bindings may silently fail to match.`,
        );
      }
    }
    for (const alias of symbolicAliases) {
      if (!classes.includes(alias)) classes.push(alias);
    }

    // Issue #3295 — Walk `exo__Class_superClass` chain so that bindings
    // targeted at intermediate superclasses (e.g. `ems__Task`) match
    // subclass instances (e.g. `ems__Meeting ⊑ ems__Task`). Without
    // this, only universal `exo__Asset` bindings and same-class
    // bindings render; everything between leaf and root is silently
    // dropped because `CommandResolver.bindingMatches` does string-
    // equality on `targetClass` literals (no hierarchy walk).
    //
    // The walk consumes only the triple store and is cycle-safe + depth-
    // bounded inside `CommandResolver.getClassAncestors`. We iterate the
    // SNAPSHOT of classes captured before the walk to avoid revisiting
    // every newly-appended ancestor (the resolver walks the full chain
    // from each leaf already).
    const leafClasses = [...classes];
    for (const cls of leafClasses) {
      if (cls === "exo__Asset") continue;
      let ancestors: string[];
      try {
        ancestors = await this.config.commandResolver.getClassAncestors(cls);
      } catch (error) {
        logger?.info(
          `[DynamicCommands] getClassAncestors(${cls}) threw: ${String(error)}`,
        );
        continue;
      }
      for (const ancestor of ancestors) {
        if (!classes.includes(ancestor)) classes.push(ancestor);
      }
    }

    // Universal-root guard. After the superClass walk above this is
    // usually idempotent (the chain typically terminates at exo__Asset),
    // but the explicit append remains the safety net for two cases:
    //   1. The class file is unknown to the triple store (cold-start
    //      race; `getClassAncestors` returns []).
    //   2. The class chain skips `exo__Asset` because the leaf is a
    //      root concept itself (e.g. shared-identities).
    if (!classes.includes("exo__Asset")) classes.push("exo__Asset");

    return classes;
  }

  /**
   * Bare-UUID-v4 sniff used to decide whether a class ref needs symbolic
   * expansion via the metadata cache (Issue #3141).
   */
  private isUuidRef(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    );
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

  private extractAssetUid(
    metadata: Record<string, unknown>,
  ): string | undefined {
    const raw = metadata["exo__Asset_uid"];
    if (typeof raw !== "string") return undefined;
    const trimmed = raw.trim();
    return trimmed === "" ? undefined : trimmed;
  }
}
