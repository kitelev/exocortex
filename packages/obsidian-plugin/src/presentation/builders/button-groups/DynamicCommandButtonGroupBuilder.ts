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
} from "exocortex";
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
import type { ExocmdFastResolver } from "./ExocmdFastResolver";
import type { ExocmdBindingsCache } from "@plugin/cache/ExocmdBindingsCache";

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
  /**
   * Issue #3171 — cold-start fast path. When both `fastResolver` and
   * `isFullPathReady` are provided AND `isFullPathReady()` returns false,
   * `resolveVisibleCommands` delegates to {@link ExocmdFastResolver} using
   * a mini in-memory triple store fed exclusively from
   * `metadataCache.getFileCache()` for the open file + the ~41 exocmd
   * assets. This eliminates the ~10s/~40s desktop/mobile cold-start window
   * during which the full vault triple store is still being built.
   *
   * Once `isFullPathReady()` flips to true (background `convertVault()`
   * completion), subsequent renders take the full path; the currently
   * open file re-renders automatically when the plugin invalidates the
   * `commandResolver` cache and triggers `autoRenderLayout()`.
   *
   * Both fields are optional and independent of each other — when either
   * is missing the builder falls back to the full path always (legacy
   * behaviour, used in unit tests).
   */
  fastResolver?: ExocmdFastResolver;
  isFullPathReady?: () => boolean;
  /**
   * Issue #3183 — persistent disk cache that pre-computes visible commands
   * per class. When provided AND the warm snapshot already has an entry
   * for the open file's primary class, the builder skips both the fast
   * and full paths and returns the cached `ResolvedCommand[]` directly.
   * Cache misses (no entry for this class, snapshot empty, snapshot
   * never loaded) fall through cleanly to the existing
   * fast-path/full-path strategy selector — the cache is a strict
   * superset of fast behaviour, never a replacement.
   *
   * Wiring is opt-in: tests and other call-sites that do not pass
   * `bindingsCache` retain the original two-path behaviour byte-for-byte.
   */
  bindingsCache?: ExocmdBindingsCache;
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
    const cachedBindings = this.resolveViaCache(assetClasses);

    // Issue #3171 — cold-start fast path. When the full vault triple store
    // has NOT yet finished `convertVault()`, delegate to ExocmdFastResolver
    // which builds a mini-store from just the open file + 41 exocmd assets
    // (~42 metadata-cache lookups vs ~12k file reads). This converts the
    // ~10s/~40s desktop/mobile cold-start wait into ~tens of ms. Once the
    // background indexer finishes, `isFullPathReady()` flips to true and
    // subsequent renders use the production path — the open file
    // re-renders automatically via the plugin's resolved-cache invalidation
    // hook.
    const useFastPath =
      cachedBindings === null &&
      this.config.fastResolver !== undefined &&
      this.config.isFullPathReady !== undefined &&
      !this.config.isFullPathReady();

    let preconditionPassed: ResolvedCommand[] | null;
    if (cachedBindings !== null) {
      // Cache hit: skip binding resolution, run preconditions through
      // the live evaluator against the current target.
      preconditionPassed = await this.evaluatePreconditions(
        cachedBindings,
        subjectIRI,
        file,
      );
    } else if (useFastPath) {
      preconditionPassed = await this.resolveViaFastPath(context);
    } else {
      preconditionPassed = await this.resolveViaFullPath(
        subjectIRI,
        assetClasses,
        prototypeIRI,
        file,
        logger,
      );
    }

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

    return this.evaluatePreconditions(resolved, subjectIRI, file);
  }

  /**
   * Run preconditions in PARALLEL against the live `PreconditionEvaluator`
   * and return only the commands whose preconditions evaluated to true.
   * Extracted from {@link resolveViaFullPath} so the Issue #3183 cache
   * hit path can reuse the exact same precondition pipeline — cached
   * bindings then render through the same per-target evaluation as the
   * full path, eliminating per-target false positives/negatives that a
   * pre-filtered cache would carry.
   */
  private async evaluatePreconditions(
    resolved: ReadonlyArray<ResolvedCommand>,
    subjectIRI: string,
    file: ButtonBuilderContext["file"],
  ): Promise<ResolvedCommand[]> {
    if (resolved.length === 0) return [];
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
    return availabilityChecks
      .filter(({ available }) => available)
      .map(({ rc }) => rc);
  }

  /**
   * Issue #3171 cold-start fast path — delegates the binding +
   * precondition evaluation to {@link ExocmdFastResolver}, which uses a
   * mini in-memory triple store built solely from the open file's
   * frontmatter + the ~41 `assetspaces/exocmd/*.md` assets. Returns
   * `null` on resolver failure so the caller treats the file as having
   * no visible buttons (identical to the full-path error contract).
   *
   * Pre-conditions for entering this branch are checked by the caller —
   * `fastResolver` and `isFullPathReady` are both present, and the latter
   * returned false. The class hierarchy guards (`extractAssetClasses` /
   * `extractPrototypeIRI`) have already run on the caller side and
   * returned a non-empty class set; the fast resolver re-derives them
   * internally because it does not receive the caller's pre-computed
   * vector (keeping `ExocmdFastResolver` decoupled from this builder's
   * private helpers).
   */
  private async resolveViaFastPath(
    context: ButtonBuilderContext,
  ): Promise<ResolvedCommand[] | null> {
    const { file, logger } = context;
    const fastResolver = this.config.fastResolver;
    if (!fastResolver) return null;
    try {
      const visible = await fastResolver.resolveVisibleCommands(file);
      // Issue #3171 perf benchmark — emit the cold-start UX marker the
      // first time the fast-path branch executes to completion. Paired
      // with `performance.mark("exocmd-fastpath-start")` in
      // `ExocortexPlugin` (Issue #3175 migrated from `console.time`).
      // Guarded by `!this.fastpathReadyMarked` so we only emit once per
      // plugin session.
      //
      // Issue #3190 — the previous `visible.length > 0` guard meant
      // cold-start sessions where the first fast-path render produced no
      // visible commands (e.g. open file's metadata cache not yet warm,
      // so `getFrontmatter()` returned null) never wrote the mark, and
      // the empirical evidence for #3190 showed the mark perpetually
      // missing. The mark documents "fast-path completed" — independent
      // of whether anything matched — so we drop the `length > 0` guard.
      if (!this.fastpathReadyMarked) {
        this.fastpathReadyMarked = true;
        try {
          performance.mark("exocmd-fastpath-ready");
          performance.measure(
            "exocmd-fastpath",
            "exocmd-fastpath-start",
            "exocmd-fastpath-ready",
          );
        } catch (markErr) {
          // Performance API may throw if `exocmd-fastpath-start` is
          // missing (hot reload, embedded jest env). Never let it break
          // button rendering. Issue #3190 — surface via console.error too.
          console.error("[exocortex] cache fastpath-mark failed:", markErr);
        }
      }
      return visible;
    } catch (error) {
      logger.info(
        `[DynamicCommands] Fast-path resolver failed: ${String(error)}`,
      );
      // Issue #3190 — surface fast-path failures to DevTools console so
      // a silent fallthrough does not look identical to a successful
      // empty result. `logger.info` is channel-gated; `console.error`
      // is unconditional.
      console.error("[exocortex] cache fast-path failed:", error);
      return null;
    }
  }
  private fastpathReadyMarked = false;

  /**
   * Issue #3183 — disk-cache strategy. Returns the cached `ResolvedCommand[]`
   * for the first non-`exo__Asset` class key that has a snapshot entry,
   * or `null` when no cache is wired, no snapshot is loaded, or no key
   * matches. Cache hits emit a one-shot `exocmd-cache-applied`
   * `performance.mark` paired with `exocmd-cache-read-to-applied` so the
   * cold-start AC #1 latency target is observable in the same DevTools
   * console session as `exocmd-fastpath` / `exocmd-fullpath` (#3175).
   *
   * The lookup is synchronous — it does not touch disk; the snapshot is
   * loaded once at plugin onload, before `convertVault()` even starts.
   */
  private resolveViaCache(
    assetClasses: ReadonlyArray<string>,
  ): ResolvedCommand[] | null {
    const cache = this.config.bindingsCache;
    if (!cache) return null;
    // Issue #3183 follow-up: once the full triple store is ready, the
    // disk cache must yield — its per-class snapshot cannot represent
    // `targetAsset` / `targetPrototype` bindings (those are subject-keyed
    // and only the production `resolveForAssetMulti` against the live
    // subject IRI matches them). The cache stays useful in the
    // cold-start window where `isFullPathReady() === false`; the post-
    // ready render through full path then corrects any per-subject
    // bindings the cache could not pre-compute.
    if (this.config.isFullPathReady && this.config.isFullPathReady()) {
      return null;
    }
    for (const cls of assetClasses) {
      if (cls === "exo__Asset") continue;
      const entry = cache.lookup(cls);
      if (entry) {
        if (!this.cacheAppliedMarked) {
          this.cacheAppliedMarked = true;
          try {
            performance.mark("exocmd-cache-applied");
            // `getEntriesByName` may not be implemented by every host
            // (jsdom stubs only `mark`/`measure`). Treat its absence as
            // "start marker unknown" and skip the measure — the mark
            // alone is enough for the AC #1 visibility target.
            const hasGet =
              typeof (performance as unknown as Record<string, unknown>)[
                "getEntriesByName"
              ] === "function";
            if (
              hasGet &&
              performance.getEntriesByName("exocmd-cache-read-start").length > 0
            ) {
              performance.measure(
                "exocmd-cache-read-to-applied",
                "exocmd-cache-read-start",
                "exocmd-cache-applied",
              );
            }
          } catch (markErr) {
            // Performance API edge cases (missing start mark, browser
            // throwing on unknown name) must never break button rendering.
            // Issue #3190 — log to console.error so we can spot a future
            // regression where the mark silently fails instead of fires.
            console.error(
              "[exocortex] cache cache-applied-mark failed:",
              markErr,
            );
          }
        }
        return [...entry.commands];
      }
    }
    return null;
  }
  private cacheAppliedMarked = false;

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
}
