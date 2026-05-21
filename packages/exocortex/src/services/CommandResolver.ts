import { injectable } from "tsyringe";
import type { ITripleStore } from "../interfaces/ITripleStore";
import type { ILogger } from "../interfaces/ILogger";
import { NullLogger } from "../infrastructure/NullLogger";
import { IRI } from "../domain/models/rdf/IRI";
import { Literal } from "../domain/models/rdf/Literal";
import { Namespace } from "../domain/models/rdf/Namespace";
import { GroundingType } from "../domain/constants/GroundingType";
import {
  COMMAND_VARIANT_VALUES,
  LABEL_CLASS_VALUES,
  STYLE_SOURCE_VALUES,
  type CommandVariant,
  type LabelClass,
  type StyleSource,
} from "../domain/constants/CommandBindingStyleEnums";
import { ExoQLParser } from "../infrastructure/sparql/SPARQLParser";
import { ExoQLAlgebraTranslator } from "../infrastructure/sparql/algebra/AlgebraTranslator";
import { ExoQLQueryExecutor } from "../infrastructure/sparql/executors/QueryExecutor";
import type {
  CommandDefinition,
  PreconditionDefinition,
  GroundingDefinition,
  CommandBindingDefinition,
  CommandBindingStyleDefinition,
} from "../domain/models/CommandDefinition";

/**
 * A resolved command: a CommandDefinition bound to a specific context.
 */
export interface ResolvedCommand {
  readonly command: CommandDefinition;
  readonly binding: CommandBindingDefinition;
}

/** Maximum depth for transitive loading to prevent infinite loops */
const MAX_TRANSITIVE_DEPTH = 10;

/**
 * Resolves dynamic commands from vault assets stored in an ITripleStore (RFC-009 §5.3).
 *
 * Binding priority (specific → general):
 * 1. targetAsset — only for a specific asset
 * 2. targetPrototype — for all instances of a prototype
 * 3. targetClass — for all assets of a class
 *
 * Issue #2428
 */
@injectable()
export class CommandResolver {
  private readonly cache = new Map<string, ResolvedCommand[]>();
  private readonly multiCache = new Map<string, ResolvedCommand[]>();

  /**
   * @param tripleStore - RDF triple store backing vault assets.
   * @param logger - Optional structured logger; defaults to no-op.
   *                 RFC-024 §5: invalid enum values warn (capped 200 chars)
   *                 then fall back — never crash.
   */
  constructor(
    private readonly tripleStore: ITripleStore,
    private readonly logger: ILogger = NullLogger,
  ) {}

  /**
   * Resolve commands for an asset declaring multiple classes (RFC-009 §5.3, Issue #2958).
   *
   * Iterates each class in `assetClasses`, merges results, and deduplicates by `binding.id`
   * (NOT `commandRef` — the same command may have multiple bindings, each must surface once).
   *
   * Caller-side multi-class dispatch enables universal bindings (`targetClass: exo__Asset`)
   * to match subclass instances when the caller appends `exo__Asset` to the classes array.
   *
   * @param subjectIRI - IRI of the target asset (subject)
   * @param assetClasses - All declared classes of the asset (typically `exo__Instance_class`
   *                      array + universal `exo__Asset` superclass appended by caller)
   * @param prototypeIRI - Optional prototype IRI for prototype-scoped bindings
   * @returns Resolved commands sorted by binding priority then order; deduped by binding.id
   */
  async resolveForAssetMulti(
    subjectIRI: string,
    assetClasses: string[],
    prototypeIRI?: string,
  ): Promise<ResolvedCommand[]> {
    if (assetClasses.length === 0) return [];

    // Cache key uses sorted classes — stable across permutations
    const sortedClasses = [...assetClasses].sort().join(",");
    const cacheKey = `${subjectIRI}::${sortedClasses}::${prototypeIRI ?? ""}`;
    const cached = this.multiCache.get(cacheKey);
    if (cached) return cached;

    const seen = new Set<string>();
    const merged: ResolvedCommand[] = [];

    for (const cls of assetClasses) {
      const bindings = await this.resolveForAsset(subjectIRI, cls, prototypeIRI);
      for (const rc of bindings) {
        if (!seen.has(rc.binding.id)) {
          seen.add(rc.binding.id);
          merged.push(rc);
        }
      }
    }

    // Re-sort across merged classes: priority (asset > prototype > class) then order
    merged.sort((a, b) => {
      const priorityA = this.getBindingPriority(a.binding);
      const priorityB = this.getBindingPriority(b.binding);
      if (priorityA !== priorityB) return priorityA - priorityB;
      return (a.binding.order ?? 100) - (b.binding.order ?? 100);
    });

    this.multiCache.set(cacheKey, merged);
    return merged;
  }

  /**
   * Resolve all available commands for a specific asset.
   *
   * Returns commands ordered by binding priority (asset > prototype > class),
   * then by binding order within the same priority level.
   */
  async resolveForAsset(
    subjectIRI: string,
    assetClass: string,
    prototypeIRI?: string,
  ): Promise<ResolvedCommand[]> {
    const cacheKey = `${subjectIRI}:${assetClass}:${prototypeIRI ?? ""}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const bindings = await this.findBindings(assetClass, prototypeIRI, subjectIRI);

    const resolved: ResolvedCommand[] = [];
    for (const binding of bindings) {
      const command = await this.loadCommand(binding.commandRef);
      if (!command) continue;

      // Apply binding-level precondition override
      const finalCommand = binding.precondition
        ? { ...command, precondition: binding.precondition }
        : command;

      resolved.push({ command: finalCommand, binding });
    }

    // Sort by binding priority: targetAsset (0) > targetPrototype (1) > targetClass (2)
    // Within same priority, sort by order
    resolved.sort((a, b) => {
      const priorityA = this.getBindingPriority(a.binding);
      const priorityB = this.getBindingPriority(b.binding);
      if (priorityA !== priorityB) return priorityA - priorityB;
      return (a.binding.order ?? 100) - (b.binding.order ?? 100);
    });

    this.cache.set(cacheKey, resolved);
    return resolved;
  }

  /**
   * Load a single command definition by UID, including linked Precondition and Grounding.
   * Returns null if the command is not found.
   */
  async loadCommand(commandUID: string): Promise<CommandDefinition | null> {
    // Find the command subject by UID
    const subject = await this.findSubjectByUID(commandUID);
    if (!subject) return null;

    // Verify it's a Command type
    const typeTriples = await this.tripleStore.match(
      subject,
      Namespace.RDF.term("type"),
      Namespace.EXOCMD.term("Command"),
    );
    if (typeTriples.length === 0) return null;

    // Load command properties
    const name = await this.getLiteralValue(subject, Namespace.EXO.term("Asset_label")) ?? "Unknown Command";
    const labelTemplate = await this.getLiteralValue(subject, Namespace.EXOCMD.term("Command_labelTemplate"));
    const icon = await this.getLiteralValue(subject, Namespace.EXOCMD.term("Command_icon"));
    const confirmMessage = await this.getLiteralValue(subject, Namespace.EXOCMD.term("Command_confirmMessage"));
    const successMessage = await this.getLiteralValue(subject, Namespace.EXOCMD.term("Command_successMessage"));
    const category = await this.getLiteralValue(subject, Namespace.EXOCMD.term("Command_category"));

    // Transitively load linked Precondition
    const precondition = await this.loadLinkedPrecondition(subject);

    // Transitively load linked Grounding
    const grounding = await this.loadLinkedGrounding(subject, 0);
    if (!grounding) return null; // Grounding is required

    return {
      id: commandUID,
      name,
      labelTemplate: labelTemplate ?? undefined,
      icon: icon ?? undefined,
      precondition: precondition ?? undefined,
      grounding,
      confirmMessage: confirmMessage ?? undefined,
      successMessage: successMessage ?? undefined,
      category: category ?? undefined,
    };
  }

  /**
   * Find all command bindings matching the given filters.
   *
   * Returns bindings for:
   * - targetAsset matching subjectIRI
   * - targetPrototype matching prototypeIRI
   * - targetClass matching assetClass
   */
  async findBindings(
    assetClass?: string,
    prototypeIRI?: string,
    assetIRI?: string,
  ): Promise<CommandBindingDefinition[]> {
    // Find all CommandBinding instances
    const bindingTriples = await this.tripleStore.match(
      undefined,
      Namespace.RDF.term("type"),
      Namespace.EXOCMD.term("CommandBinding"),
    );

    const bindings: CommandBindingDefinition[] = [];

    for (const triple of bindingTriples) {
      const bindingSubject = triple.subject as IRI;
      const binding = await this.loadBindingDefinition(bindingSubject);
      if (!binding) continue;

      // Check if this binding applies to the given context
      if (this.bindingMatches(binding, assetClass, prototypeIRI, assetIRI)) {
        bindings.push(binding);
      }
    }

    return bindings;
  }

  /**
   * Find all commands that opt-in to Obsidian Command Palette registration via
   * `exocmd__Command_paletteEnabled: true`. Used by
   * `ExocmdCommandPaletteRegistrar` to surface global commands at plugin load.
   *
   * The palette id used for `plugin.addCommand({ id })` is derived per command:
   *   1. `exocmd__Command_paletteId` literal (if present)
   *   2. `exocmd__Command_cliName` literal (fallback — shared CLI surface)
   *   3. `exo__Asset_uid` (last-resort, always present)
   *
   * Duplicate ids across the vault are dropped after the first occurrence and
   * warned through the logger — first match wins, deterministically ordered by
   * triple store iteration order.
   *
   * Source: code-RFC `1429fcd0-0948-4a42-89c4-8d1426e9bc7a` (PR-2).
   */
  async findPaletteEnabledCommands(): Promise<
    Array<{ command: CommandDefinition; paletteId: string }>
  > {
    const typeTriples = await this.tripleStore.match(
      undefined,
      Namespace.RDF.term("type"),
      Namespace.EXOCMD.term("Command"),
    );

    const results: Array<{ command: CommandDefinition; paletteId: string }> =
      [];
    const seenIds = new Set<string>();

    for (const triple of typeTriples) {
      const subject = triple.subject as IRI;

      const enabledRaw = await this.getLiteralValue(
        subject,
        Namespace.EXOCMD.term("Command_paletteEnabled"),
      );
      if (enabledRaw?.toLowerCase() !== "true") continue;

      const uid = await this.getLiteralValue(
        subject,
        Namespace.EXO.term("Asset_uid"),
      );
      if (!uid) {
        this.logger.warn(
          `[CommandResolver] paletteEnabled command at ${subject.value} has no exo__Asset_uid — skipped`,
        );
        continue;
      }

      const command = await this.loadCommand(uid);
      if (!command) {
        this.logger.warn(
          `[CommandResolver] paletteEnabled command ${uid} could not be loaded (missing grounding?) — skipped`,
        );
        continue;
      }

      const explicitPaletteId = await this.getLiteralValue(
        subject,
        Namespace.EXOCMD.term("Command_paletteId"),
      );
      const cliName = await this.getLiteralValue(
        subject,
        Namespace.EXOCMD.term("Command_cliName"),
      );
      const paletteId = explicitPaletteId ?? cliName ?? uid;

      if (seenIds.has(paletteId)) {
        this.logger.warn(
          `[CommandResolver] duplicate paletteId "${paletteId}" — first registration wins, dropping ${uid}`,
        );
        continue;
      }
      seenIds.add(paletteId);

      results.push({ command, paletteId });
    }

    return results;
  }

  /**
   * Invalidate all cached command resolutions.
   * Call when vault files change.
   */
  invalidateCache(): void {
    this.cache.clear();
    this.multiCache.clear();
  }

  /**
   * Resolve a dynamic label for a command bound to a specific target asset.
   *
   * If the command has a `labelTemplate`, each `{...}` placeholder is executed
   * as a SPARQL SELECT query (with `$target` substituted for the target IRI).
   * The first binding value of the first result row replaces the placeholder.
   * On error or empty result, the placeholder is replaced with an empty string.
   *
   * If the command has no `labelTemplate`, returns the static `name`.
   *
   * @param command - The command definition (may have labelTemplate)
   * @param targetIRI - IRI of the current asset (substituted for $target)
   * @returns The resolved label string
   */
  async resolveLabel(
    command: CommandDefinition,
    targetIRI: string,
  ): Promise<string> {
    if (!command.labelTemplate) {
      return command.name;
    }

    let result = command.labelTemplate;
    const placeholders = this.extractPlaceholders(command.labelTemplate);

    for (const { full, body } of placeholders) {
      const resolved = await this.evaluateSelectSnippet(body, targetIRI);
      result = result.replace(full, resolved);
    }

    return result;
  }

  // -- Private helpers --

  /**
   * Extract top-level `{...}` placeholders from a label template,
   * correctly handling nested braces in SPARQL WHERE clauses.
   *
   * Returns array of { full: "{...}", body: "..." } for each placeholder.
   */
  private extractPlaceholders(template: string): Array<{ full: string; body: string }> {
    const results: Array<{ full: string; body: string }> = [];
    let i = 0;

    while (i < template.length) {
      if (template[i] === "{") {
        let depth = 1;
        let j = i + 1;
        while (j < template.length && depth > 0) {
          if (template[j] === "{") depth++;
          else if (template[j] === "}") depth--;
          j++;
        }
        if (depth === 0) {
          const full = template.slice(i, j);
          const body = template.slice(i + 1, j - 1);
          results.push({ full, body });
        }
        i = j;
      } else {
        i++;
      }
    }

    return results;
  }

  /**
   * Execute a SPARQL SELECT snippet and return the first binding value
   * of the first result row, or empty string on failure / no results.
   */
  private async evaluateSelectSnippet(
    sparqlBody: string,
    targetIRI: string,
  ): Promise<string> {
    try {
      const query = sparqlBody.replace(/\$target/g, `<${targetIRI}>`);
      const parser = new ExoQLParser();
      const parsed = parser.parse(query);
      const translator = new ExoQLAlgebraTranslator();
      const algebra = translator.translate(parsed);
      const executor = new ExoQLQueryExecutor(this.tripleStore);
      const solutions = await executor.executeAll(algebra);

      if (solutions.length === 0) return "";

      // Return the first binding value of the first solution
      const firstSolution = solutions[0];
      const vars = firstSolution.variables();
      if (vars.length === 0) return "";

      const value = firstSolution.get(vars[0]);
      if (!value) return "";
      if (value instanceof Literal) return value.value;
      if (value instanceof IRI) return value.value;
      return String(value);
    } catch {
      return "";
    }
  }

  private async loadBindingDefinition(subject: IRI): Promise<CommandBindingDefinition | null> {
    const uid = await this.getLiteralValue(subject, Namespace.EXO.term("Asset_uid"));
    if (!uid) return null;

    const label = await this.getLiteralValue(subject, Namespace.EXO.term("Asset_label")) ?? "";

    // Load command reference
    const commandRef = await this.getLinkedUID(subject, Namespace.EXOCMD.term("CommandBinding_command"));
    if (!commandRef) return null;

    // Load target filters
    const targetClass = await this.getLinkedValue(subject, Namespace.EXOCMD.term("CommandBinding_targetClass"));
    const targetPrototype = await this.getLinkedValue(subject, Namespace.EXOCMD.term("CommandBinding_targetPrototype"));
    const targetAsset = await this.getLinkedValue(subject, Namespace.EXOCMD.term("CommandBinding_targetAsset"));

    // At least one target is required
    if (!targetClass && !targetPrototype && !targetAsset) return null;

    // Load display options
    const position = await this.getLiteralValue(subject, Namespace.EXOCMD.term("CommandBinding_position"));
    const orderStr = await this.getLiteralValue(subject, Namespace.EXOCMD.term("CommandBinding_order"));

    // RFC command-variant-split (f1dc284a) — top-level variant override.
    // Read `_variant` literal directly so callers can use `binding.variant`
    // without having to walk the legacy RFC-024 inline-style path.
    //
    // Legacy `exocmd__CommandBinding_group` was removed in RFC f1dc284a
    // Phase 8 (`drop _group parsing`). Existing vaults with `_group`
    // frontmatter remain valid markdown — the parser silently ignores the
    // unknown property.
    const variantRawForBinding = await this.getLiteralValue(
      subject,
      Namespace.EXOCMD.term("CommandBinding_variant"),
    );
    const variant =
      variantRawForBinding !== null
        ? this.coerceVariant(variantRawForBinding, uid)
        : undefined;

    // Load binding-level precondition override
    const precondition = await this.loadLinkedPreconditionFromProperty(
      subject,
      Namespace.EXOCMD.term("CommandBinding_precondition"),
    );

    // RFC-024 §4 Phase 2 — resolve visual style with fallback chain
    const style = await this.loadLinkedStyle(subject, uid);

    return {
      id: uid,
      label,
      commandRef,
      targetClass: targetClass ?? undefined,
      targetPrototype: targetPrototype ?? undefined,
      targetAsset: targetAsset ?? undefined,
      position: position ?? undefined,
      order: orderStr ? parseInt(orderStr, 10) : undefined,
      variant,
      precondition: precondition ?? undefined,
      style: style ?? undefined,
    };
  }

  /**
   * Resolve a binding's visual style via the RFC-024 §4 Phase 2 fallback chain.
   *
   * Step 1 (preferred): follow `exocmd__CommandBinding_style` wikilink to a
   * CommandBindingStyle asset and project all 7 properties.
   *
   * Step 2 (shorthand): if no style asset reference, read inline literal
   * `exocmd__CommandBinding_variant` and synthesize a minimal style with
   * only `variant` populated. Coerce via `String(v).trim().toLowerCase()`,
   * whitelist via `COMMAND_VARIANT_VALUES`, drop with capped warning on miss.
   *
   * Returns `null` when neither source is present — caller treats as
   * "delegate to UI-level category default" (`categoryDefaultVariant`).
   *
   * Strategy: split-query (separate `match()` calls per property), **not**
   * SPARQL OPTIONAL — see RFC-024 §3 architectural principle.
   */
  private async loadLinkedStyle(
    bindingSubject: IRI,
    bindingUid: string,
  ): Promise<CommandBindingStyleDefinition | null> {
    // Step 1 — explicit style asset reference (preferred)
    const styleRefTriples = await this.tripleStore.match(
      bindingSubject,
      Namespace.EXOCMD.term("CommandBinding_style"),
      undefined,
    );

    if (styleRefTriples.length > 0) {
      const ref = styleRefTriples[0].object;
      let styleSubject: IRI | null = null;

      if (ref instanceof IRI) {
        styleSubject = ref;
      } else if (ref instanceof Literal) {
        const refUid = this.normalizeWikilink(ref.value);
        styleSubject = await this.findSubjectByUID(refUid);
      }

      if (styleSubject) {
        const fromAsset = await this.loadStyleAsset(styleSubject);
        if (fromAsset) return fromAsset;
      }
      // Reference present but didn't yield a usable style asset — log + try inline
      this.logger.warn(
        this.capWarning(
          `CommandBinding ${bindingUid}: style reference unresolved, falling back to inline variant`,
        ),
      );
    }

    // Step 2 — inline shorthand `CommandBinding_variant` literal
    const inlineVariantRaw = await this.getLiteralValue(
      bindingSubject,
      Namespace.EXOCMD.term("CommandBinding_variant"),
    );

    if (inlineVariantRaw !== null) {
      const variant = this.coerceVariant(inlineVariantRaw, bindingUid);
      if (variant !== undefined) {
        return {
          id: `inline:${bindingUid}`,
          label: "",
          variant,
          inline: true,
        };
      }
    }

    return null;
  }

  /**
   * Project a CommandBindingStyle asset to a {@link CommandBindingStyleDefinition}.
   * Invalid enum values are coerced and dropped with warning (RFC-024 §5).
   * Returns `null` if the asset is missing the mandatory `Asset_uid` property.
   */
  private async loadStyleAsset(
    subject: IRI,
  ): Promise<CommandBindingStyleDefinition | null> {
    const uid = await this.getLiteralValue(subject, Namespace.EXO.term("Asset_uid"));
    if (!uid) return null;

    const label =
      (await this.getLiteralValue(subject, Namespace.EXO.term("Asset_label"))) ?? "";

    const variantRaw = await this.getLiteralValue(
      subject,
      Namespace.EXOCMD.term("CommandBindingStyle_variant"),
    );
    const variant =
      variantRaw !== null ? this.coerceVariant(variantRaw, uid) : undefined;

    const showIconRaw = await this.getLiteralValue(
      subject,
      Namespace.EXOCMD.term("CommandBindingStyle_showIcon"),
    );
    const showIcon = this.coerceBoolean(showIconRaw);

    const labelClassRaw = await this.getLiteralValue(
      subject,
      Namespace.EXOCMD.term("CommandBindingStyle_labelClass"),
    );
    const labelClass =
      labelClassRaw !== null ? this.coerceLabelClass(labelClassRaw, uid) : undefined;

    const ariaLabel = await this.getLiteralValue(
      subject,
      Namespace.EXOCMD.term("CommandBindingStyle_ariaLabel"),
    );
    const tooltip = await this.getLiteralValue(
      subject,
      Namespace.EXOCMD.term("CommandBindingStyle_tooltip"),
    );
    const keyboardShortcut = await this.getLiteralValue(
      subject,
      Namespace.EXOCMD.term("CommandBindingStyle_keyboardShortcut"),
    );

    const sourceRaw = await this.getLiteralValue(
      subject,
      Namespace.EXOCMD.term("CommandBindingStyle_source"),
    );
    const source =
      sourceRaw !== null ? this.coerceStyleSource(sourceRaw, uid) : undefined;

    return {
      id: uid,
      label,
      variant,
      showIcon,
      labelClass,
      ariaLabel: ariaLabel ?? undefined,
      tooltip: tooltip ?? undefined,
      keyboardShortcut: keyboardShortcut ?? undefined,
      source,
      inline: false,
    };
  }

  /**
   * Coerce raw input to a {@link CommandVariant} or warn and drop.
   * RFC-024 §5: trim + lowercase + whitelist → never crash.
   */
  private coerceVariant(
    raw: unknown,
    contextUid: string,
  ): CommandVariant | undefined {
    if (raw == null) return undefined;
    const normalized = String(raw).trim().toLowerCase();
    if (normalized === "") return undefined;
    if ((COMMAND_VARIANT_VALUES as readonly string[]).includes(normalized)) {
      return normalized as CommandVariant;
    }
    this.logger.warn(
      this.capWarning(
        `CommandBindingStyle variant "${normalized}" not in whitelist [${COMMAND_VARIANT_VALUES.join(",")}]; dropped (asset ${contextUid})`,
      ),
    );
    return undefined;
  }

  private coerceLabelClass(
    raw: unknown,
    contextUid: string,
  ): LabelClass | undefined {
    if (raw == null) return undefined;
    const normalized = String(raw).trim().toLowerCase();
    if (normalized === "") return undefined;
    if ((LABEL_CLASS_VALUES as readonly string[]).includes(normalized)) {
      return normalized as LabelClass;
    }
    this.logger.warn(
      this.capWarning(
        `CommandBindingStyle labelClass "${normalized}" not in whitelist [${LABEL_CLASS_VALUES.join(",")}]; dropped (asset ${contextUid})`,
      ),
    );
    return undefined;
  }

  private coerceStyleSource(
    raw: unknown,
    contextUid: string,
  ): StyleSource | undefined {
    if (raw == null) return undefined;
    const normalized = String(raw).trim().toLowerCase();
    if (normalized === "") return undefined;
    if ((STYLE_SOURCE_VALUES as readonly string[]).includes(normalized)) {
      return normalized as StyleSource;
    }
    this.logger.warn(
      this.capWarning(
        `CommandBindingStyle source "${normalized}" not in whitelist [${STYLE_SOURCE_VALUES.join(",")}]; dropped (asset ${contextUid})`,
      ),
    );
    return undefined;
  }

  /** Returns boolean for "true"/"false" (case-insensitive); undefined otherwise. */
  private coerceBoolean(raw: string | null): boolean | undefined {
    if (raw === null) return undefined;
    const normalized = raw.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
    return undefined;
  }

  /** Cap warning messages at 200 chars per RFC-024 §5 logging policy. */
  private capWarning(message: string): string {
    return message.length <= 200 ? message : message.slice(0, 197) + "...";
  }

  private bindingMatches(
    binding: CommandBindingDefinition,
    assetClass?: string,
    prototypeIRI?: string,
    assetIRI?: string,
  ): boolean {
    // targetAsset: match specific asset
    if (binding.targetAsset && assetIRI) {
      if (this.matchesReference(binding.targetAsset, assetIRI)) return true;
    }

    // targetPrototype: match prototype
    if (binding.targetPrototype && prototypeIRI) {
      if (this.matchesReference(binding.targetPrototype, prototypeIRI)) return true;
    }

    // targetClass: match asset class
    if (binding.targetClass && assetClass) {
      if (this.matchesReference(binding.targetClass, assetClass)) return true;
    }

    return false;
  }

  private matchesReference(bindingValue: string, target: string): boolean {
    // Normalize both sides: remove wikilink brackets, quotes, extract UID
    const normalized = this.normalizeWikilink(bindingValue);
    const normalizedTarget = this.normalizeWikilink(target);
    if (normalized === normalizedTarget) return true;

    // Issue #2896: targetAsset bindings store the referenced file basename
    // (via iriToObsidianName on the resolved fileIRI), while assetIRI arrives
    // as full `obsidian://vault/<path>/<basename>.md` URL. Compare basenames
    // to bridge path-based IRIs with wikilink-style references.
    const targetBasename = this.extractPathBasename(normalizedTarget);
    if (targetBasename && targetBasename === normalized) return true;
    const bindingBasename = this.extractPathBasename(normalized);
    if (bindingBasename && bindingBasename === normalizedTarget) return true;

    // Cross-match aliases: when one side is UUID|alias and the other is just alias,
    // the UUID part won't match the alias. Try matching against the alias part too.
    // Issue #2740
    const targetAlias = this.extractAlias(target);
    if (targetAlias && normalized === targetAlias) return true;

    const bindingAlias = this.extractAlias(bindingValue);
    if (bindingAlias && bindingAlias === normalizedTarget) return true;

    return false;
  }

  private extractPathBasename(value: string): string | null {
    const m = value.match(/\/([^/]+)\.md$/);
    return m ? m[1] : null;
  }

  private extractAlias(value: string): string | null {
    const cleaned = value.replace(/["'[\]]/g, "").trim();
    const pipeIndex = cleaned.indexOf("|");
    return pipeIndex >= 0 ? cleaned.substring(pipeIndex + 1).trim() : null;
  }

  private getBindingPriority(binding: CommandBindingDefinition): number {
    if (binding.targetAsset) return 0;
    if (binding.targetPrototype) return 1;
    return 2; // targetClass
  }

  private async loadLinkedPrecondition(commandSubject: IRI): Promise<PreconditionDefinition | null> {
    return this.loadLinkedPreconditionFromProperty(
      commandSubject,
      Namespace.EXOCMD.term("Command_precondition"),
    );
  }

  private async loadLinkedPreconditionFromProperty(
    subject: IRI,
    predicate: IRI,
  ): Promise<PreconditionDefinition | null> {
    const refTriples = await this.tripleStore.match(subject, predicate, undefined);
    if (refTriples.length === 0) return null;

    const ref = refTriples[0].object;
    let preconditionSubject: IRI | null = null;

    if (ref instanceof IRI) {
      preconditionSubject = ref;
    } else if (ref instanceof Literal) {
      // Wikilink reference: resolve by UID
      const uid = this.normalizeWikilink(ref.value);
      preconditionSubject = await this.findSubjectByUID(uid);
    }

    if (!preconditionSubject) return null;

    const uid = await this.getLiteralValue(preconditionSubject, Namespace.EXO.term("Asset_uid"));
    const label = await this.getLiteralValue(preconditionSubject, Namespace.EXO.term("Asset_label")) ?? "";
    const sparqlAsk = await this.getLiteralValue(preconditionSubject, Namespace.EXOCMD.term("Precondition_sparqlAsk"));
    const hostFunction = await this.getLiteralValue(preconditionSubject, Namespace.EXOCMD.term("Precondition_hostFunction"));

    // Precondition_query — wikilink reference to an exoql__Query asset.
    // Resolved to its UID so PreconditionEvaluator can fetch the body
    // through the existing asset-loader. RFC c78cc5c8 Phase 1a (T4).
    const queryRefTriples = await this.tripleStore.match(
      preconditionSubject,
      Namespace.EXOCMD.term("Precondition_query"),
      undefined,
    );
    let query: string | undefined = undefined;
    if (queryRefTriples.length > 0) {
      const queryRef = queryRefTriples[0].object;
      if (queryRef instanceof IRI) {
        const queryUid = await this.getLiteralValue(queryRef, Namespace.EXO.term("Asset_uid"));
        if (queryUid) query = queryUid;
      } else if (queryRef instanceof Literal) {
        query = this.normalizeWikilink(queryRef.value);
      }
    }

    if (!uid) return null;

    // A precondition must have at least one evaluation source.
    if (!sparqlAsk && !hostFunction && !query) return null;

    return {
      id: uid,
      label,
      ...(sparqlAsk && { sparqlAsk }),
      ...(hostFunction && { hostFunction }),
      ...(query && { query }),
    };
  }

  private async loadLinkedGrounding(
    parentSubject: IRI,
    depth: number,
  ): Promise<GroundingDefinition | null> {
    if (depth >= MAX_TRANSITIVE_DEPTH) return null;

    const refTriples = await this.tripleStore.match(
      parentSubject,
      Namespace.EXOCMD.term("Command_grounding"),
      undefined,
    );
    if (refTriples.length === 0) return null;

    const ref = refTriples[0].object;
    let groundingSubject: IRI | null = null;

    if (ref instanceof IRI) {
      groundingSubject = ref;
    } else if (ref instanceof Literal) {
      const uid = this.normalizeWikilink(ref.value);
      groundingSubject = await this.findSubjectByUID(uid);
    }

    if (!groundingSubject) return null;
    return this.loadGroundingDefinition(groundingSubject, depth);
  }

  private async loadGroundingDefinition(
    subject: IRI,
    depth: number,
  ): Promise<GroundingDefinition | null> {
    if (depth >= MAX_TRANSITIVE_DEPTH) return null;

    const uid = await this.getLiteralValue(subject, Namespace.EXO.term("Asset_uid"));
    if (!uid) return null;

    const label = await this.getLiteralValue(subject, Namespace.EXO.term("Asset_label")) ?? "";
    const typeStr = await this.getLiteralValue(subject, Namespace.EXOCMD.term("Grounding_type"));
    if (!typeStr) return null;

    const type = this.resolveGroundingType(typeStr);
    if (!type) return null;

    let targetProperty = await this.getObsidianName(subject, Namespace.EXOCMD.term("Grounding_targetProperty"));
    // RFC 31c1a0be Phase 3: resolve UUID-form (`"[[<UID>]]"`) targetProperty
    // to the property asset's exo__Asset_label. Otherwise GroundingExecutor
    // would write the bare UUID as a frontmatter key (data corruption per
    // HIGH-4 in self-review). Symbolic-string form passes through unchanged.
    //
    // Fail-loud: a UUID that resolves to nothing (asset missing or has no
    // exo__Asset_label) MUST skip this grounding entirely. Returning the bare
    // UUID would defeat the corruption fix (post-merge adversarial review of
    // PR #3197 caught this fail-open). Caller already treats `null` as
    // "grounding inert" — UI silently omits its button instead of corrupting.
    if (targetProperty && this.looksLikeUUID(targetProperty)) {
      const resolved = await this.resolveLabelByUID(targetProperty);
      if (!resolved) {
        this.logger.warn(
          `Grounding ${uid}: targetProperty wikilink UID '${targetProperty}' is not resolvable to exo__Asset_label — grounding skipped (would otherwise write a UUID-named frontmatter key).`,
        );
        return null;
      }
      targetProperty = resolved;
    }
    // For service_call groundings, serviceId takes priority over targetProperty
    if (type === GroundingType.SERVICE_CALL) {
      const serviceId = await this.getLiteralValue(subject, Namespace.EXOCMD.term("Grounding_serviceId"));
      if (serviceId) {
        targetProperty = serviceId;
      }
    }
    const targetValue = await this.getObsidianWikilinkValue(subject, Namespace.EXOCMD.term("Grounding_targetValue"));
    // RFC 31c1a0be Phase 1 typed predicates — emit wikilink/literal/token-label
    // for property_set dispatch in GroundingExecutor.
    // targetValueRef: use getObsidianName so the value is unwrapped to the
    // bare UID (executor re-wraps to `"[[<UID>]]"`). Avoids
    // getObsidianWikilinkValue's `"[[...]]"`-with-alias output that would
    // double-wrap the wikilink at dispatch time.
    const targetValueRef = await this.getObsidianName(subject, Namespace.EXOCMD.term("Grounding_targetValueRef"));
    const targetValueLiteral = await this.getLiteralValue(subject, Namespace.EXOCMD.term("Grounding_targetValueLiteral"));
    // SubstitutionToken reference — read the token's exo__Asset_label
    // (e.g. "$nowLocal") so executePropertySet's substituteVariables can
    // resolve it via the existing regex paths.
    const substitutionRefRaw = await this.getObsidianName(subject, Namespace.EXOCMD.term("Grounding_targetValueSubstitution"));
    let targetValueSubstitution: string | null = null;
    if (substitutionRefRaw && this.looksLikeUUID(substitutionRefRaw)) {
      // Fail-loud: same pattern as targetProperty above. Missing/labelless
      // SubstitutionToken instance → skip grounding rather than silently
      // dropping the substitution.
      const resolved = await this.resolveLabelByUID(substitutionRefRaw);
      if (!resolved) {
        this.logger.warn(
          `Grounding ${uid}: targetValueSubstitution UID '${substitutionRefRaw}' is not resolvable to exo__Asset_label (SubstitutionToken instance missing or unlabelled) — grounding skipped.`,
        );
        return null;
      }
      targetValueSubstitution = resolved;
    } else if (substitutionRefRaw) {
      targetValueSubstitution = substitutionRefRaw;
    }
    const isDefinedBy = await this.getObsidianWikilinkValue(subject, Namespace.EXOCMD.term("Grounding_isDefinedBy"));
    const sparqlUpdate = await this.getLiteralValue(subject, Namespace.EXOCMD.term("Grounding_sparqlUpdate"));
    const targetClass = await this.getObsidianName(subject, Namespace.EXOCMD.term("Grounding_targetClass"));
    const targetPrototype = await this.getObsidianName(subject, Namespace.EXOCMD.term("Grounding_targetPrototype"));
    const targetFolder = await this.getLiteralValue(subject, Namespace.EXOCMD.term("Grounding_targetFolder"));
    const linkBackProperty = await this.getObsidianName(subject, Namespace.EXOCMD.term("Grounding_linkBackProperty"));
    const inputSchemaRaw = await this.getLiteralValue(subject, Namespace.EXOCMD.term("Grounding_inputSchema"));
    // Issue #3134: property_increment / property_shift control fields.
    const incrementByRaw = await this.getLiteralValue(subject, Namespace.EXOCMD.term("Grounding_incrementBy"));
    const shiftDelta = await this.getLiteralValue(subject, Namespace.EXOCMD.term("Grounding_shiftDelta"));
    let incrementBy: number | undefined;
    if (incrementByRaw !== undefined && incrementByRaw !== null && incrementByRaw !== "") {
      const parsed = Number.parseInt(String(incrementByRaw), 10);
      if (Number.isFinite(parsed)) {
        incrementBy = parsed;
      }
    }

    // Issue #3136: propertyDefaults JSON literal — declarative replacement for
    // the legacy `createTaskForDailyNote` service_call (Q3.b closure). Authored
    // as `exocmd__Grounding_propertyDefaults: '{"prop": "$today"}'`. Invalid
    // JSON or non-object payload → fail-loud (skip silently would mask typos).
    const propertyDefaultsRaw = await this.getLiteralValue(
      subject,
      Namespace.EXOCMD.term("Grounding_propertyDefaults"),
    );
    let propertyDefaults: Record<string, string> | undefined;
    if (propertyDefaultsRaw) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(propertyDefaultsRaw);
      } catch (error) {
        throw new Error(
          `Grounding ${uid}: exocmd__Grounding_propertyDefaults is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error(
          `Grounding ${uid}: exocmd__Grounding_propertyDefaults must be a JSON object literal`,
        );
      }
      const map: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value !== "string") {
          throw new Error(
            `Grounding ${uid}: exocmd__Grounding_propertyDefaults["${key}"] must be a string (got ${typeof value})`,
          );
        }
        map[key] = value;
      }
      propertyDefaults = map;
    }

    // Load composite steps if applicable
    let steps: GroundingDefinition[] | undefined;
    if (type === GroundingType.COMPOSITE) {
      steps = await this.loadCompositeSteps(subject, depth + 1);
    }

    // Parse inputSchema JSON into array of field descriptors for form modals.
    // `default` / `defaultValue` are propagated so static prefills authored in
    // the JSON Schema survive the projection (restoration of v15.38 behaviour
    // — pre-PR #2733 this field was silently dropped).
    let inputSchema: unknown[] | undefined;
    if (inputSchemaRaw) {
      try {
        const parsed = JSON.parse(inputSchemaRaw);
        if (parsed?.properties) {
          inputSchema = Object.entries(parsed.properties as Record<string, Record<string, unknown>>).map(
            ([name, prop]) => {
              const rawType = prop.type;
              const fieldType = rawType === "string" ? "text" : rawType;
              const rawDefault =
                prop.defaultValue !== undefined ? prop.defaultValue : prop.default;
              const field: Record<string, unknown> = {
                name,
                type: fieldType,
                label: prop.title ?? name,
                required: Array.isArray(parsed.required) && parsed.required.includes(name),
              };
              if (rawDefault !== undefined && rawDefault !== null) {
                field.defaultValue = String(rawDefault);
              }
              return field;
            },
          );
        }
      } catch {
        // Invalid JSON — skip inputSchema
      }
    }

    // Restoration regression v15.38: opt-in pre-fill of the `label` modal field
    // with `${currentAsset.exo__Asset_label} YYYY-MM-DD`. Only the boolean flag
    // is parsed here. The label source (= the current asset the user clicked
    // the button on) is resolved at click-time in `CommandExecutionFlow`, since
    // the grounding definition is cached and the click target varies per-call.
    const prefillRaw = await this.getLiteralValue(
      subject,
      Namespace.EXOCMD.term("Grounding_prefillLabelWithDate"),
    );
    const prefillLabelWithDate =
      prefillRaw !== null && String(prefillRaw).trim().toLowerCase() === "true";

    const grounding: GroundingDefinition = {
      id: uid,
      label,
      type,
      targetProperty: targetProperty ?? undefined,
      targetValue: targetValue ?? undefined,
      targetValueRef: targetValueRef ?? undefined,
      targetValueLiteral: targetValueLiteral ?? undefined,
      targetValueSubstitution: targetValueSubstitution ?? undefined,
      sparqlUpdate: sparqlUpdate ?? undefined,
      steps,
      targetClass: targetClass ?? undefined,
      targetPrototype: targetPrototype ?? undefined,
      targetFolder: targetFolder ?? undefined,
      linkBackProperty: linkBackProperty ?? undefined,
      incrementBy,
      shiftDelta: shiftDelta ?? undefined,
      propertyDefaults,
      isDefinedBy: isDefinedBy ?? undefined,
      prefillLabelWithDate: prefillLabelWithDate || undefined,
    };

    if (inputSchema) {
      (grounding as GroundingDefinition & { inputSchema: unknown[] }).inputSchema = inputSchema;
    }

    return grounding;
  }

  private async loadCompositeSteps(
    compositeSubject: IRI,
    depth: number,
  ): Promise<GroundingDefinition[]> {
    if (depth >= MAX_TRANSITIVE_DEPTH) return [];

    const stepsTriples = await this.tripleStore.match(
      compositeSubject,
      Namespace.EXOCMD.term("Grounding_steps"),
      undefined,
    );

    const steps: GroundingDefinition[] = [];
    for (const triple of stepsTriples) {
      let stepSubject: IRI | null = null;

      if (triple.object instanceof IRI) {
        stepSubject = triple.object;
      } else if (triple.object instanceof Literal) {
        const uid = this.normalizeWikilink(triple.object.value);
        stepSubject = await this.findSubjectByUID(uid);
      }

      if (!stepSubject) continue;

      const step = await this.loadGroundingDefinition(stepSubject, depth);
      if (step) steps.push(step);
    }

    return steps;
  }

  private resolveGroundingType(value: string): GroundingType | null {
    const normalized = value.toLowerCase().trim();
    const values = Object.values(GroundingType) as string[];
    return values.includes(normalized) ? (normalized as GroundingType) : null;
  }

  // -- Triple store helpers --

  private async findSubjectByUID(uid: string): Promise<IRI | null> {
    // Try optimized UUID lookup first (works for UUID v4 format)
    if (this.tripleStore.findSubjectsByUUID) {
      const subjects = await this.tripleStore.findSubjectsByUUID(uid);
      if (subjects.length > 0) return subjects[0] as IRI;
    }

    // Fallback: scan for Asset_uid literal (handles non-UUID identifiers)
    const uidTriples = await this.tripleStore.match(
      undefined,
      Namespace.EXO.term("Asset_uid"),
      undefined,
    );

    for (const triple of uidTriples) {
      if (
        triple.object instanceof Literal &&
        triple.object.value === uid
      ) {
        return triple.subject as IRI;
      }
    }

    return null;
  }

  private async getLiteralValue(subject: IRI, predicate: IRI): Promise<string | null> {
    const triples = await this.tripleStore.match(subject, predicate, undefined);
    if (triples.length === 0) return null;

    const obj = triples[0].object;
    if (obj instanceof Literal) return obj.value;
    if (obj instanceof IRI) return obj.value;
    return null;
  }

  /**
   * RFC 31c1a0be Phase 3 helper. UUID v4 detection — used to decide whether a
   * resolved name from `getObsidianName` is actually a bare UUID basename
   * (from UUID-named asset file) vs an already-symbolic identifier.
   */
  private looksLikeUUID(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }

  /**
   * Resolve a UID to the linked asset's `exo__Asset_label` via the triple
   * store. Returns null if no asset with that UID exists in the store or
   * if the asset has no `exo__Asset_label` literal.
   *
   * Originally an RFC 31c1a0be Phase 3 helper (private). Promoted to
   * public as a triple-store fallback for the UI builder's UUID→symbolic
   * class-label expansion (#3141 follow-up, 2026-05-21): when
   * `app.metadataCache.getFirstLinkpathDest()` cannot find the class file
   * during cold-start / post-reload race windows, the builder falls back
   * here so class-targeted CommandBindings do not silently fail to match.
   */
  async resolveLabelByUID(uid: string): Promise<string | null> {
    const subject = await this.findSubjectByUID(uid);
    if (!subject) return null;
    return this.getLiteralValue(subject, Namespace.EXO.term("Asset_label"));
  }

  private async getLinkedUID(subject: IRI, predicate: IRI): Promise<string | null> {
    const triples = await this.tripleStore.match(subject, predicate, undefined);
    if (triples.length === 0) return null;

    const obj = triples[0].object;
    if (obj instanceof IRI) {
      // Try to find UID of the linked asset
      const uidTriples = await this.tripleStore.match(
        obj,
        Namespace.EXO.term("Asset_uid"),
        undefined,
      );
      if (uidTriples.length > 0 && uidTriples[0].object instanceof Literal) {
        return uidTriples[0].object.value;
      }
      // Fallback: extract from IRI
      return obj.value.split("/").pop()?.replace(".md", "") ?? null;
    }

    if (obj instanceof Literal) {
      return this.normalizeWikilink(obj.value);
    }

    return null;
  }

  private async getLinkedValue(subject: IRI, predicate: IRI): Promise<string | null> {
    const triples = await this.tripleStore.match(subject, predicate, undefined);
    if (triples.length === 0) return null;

    const obj = triples[0].object;
    if (obj instanceof Literal) return this.normalizeWikilink(obj.value);
    if (obj instanceof IRI) {
      return this.iriToObsidianName(obj.value) ?? obj.value;
    }
    return null;
  }

  /**
   * Reverse-map an IRI to Obsidian-style property name (e.g., ems__Effort_status).
   * Falls back to unwrapWikilink for Literal objects (which may carry
   * wikilink-wrapped property references like "[[<UID>|ems__Effort_prevIteration]]").
   */
  private async getObsidianName(subject: IRI, predicate: IRI): Promise<string | null> {
    const triples = await this.tripleStore.match(subject, predicate, undefined);
    if (triples.length === 0) return null;

    const obj = triples[0].object;
    if (obj instanceof Literal) return this.unwrapWikilink(obj.value);
    if (obj instanceof IRI) return this.iriToObsidianName(obj.value) ?? obj.value;
    return null;
  }

  /**
   * Unwrap a property-style reference into a bare short-name. Accepts:
   *   - `[[<UID>|<short-name>]]` → `<short-name>` (alias path — primary case)
   *   - `[[<short-name>]]` → `<short-name>`
   *   - `<full-IRI>` (e.g. `https://exocortex.my/ontology/ems#Task`) → `ems__Task`
   *   - bare `<short-name>` → unchanged
   * Returns the input unchanged when no pattern matches (legacy fallback).
   */
  private unwrapWikilink(value: string): string {
    if (!value) return value;
    const trimmed = value.trim().replace(/^"|"$/g, "");
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      return this.iriToObsidianName(trimmed) ?? trimmed;
    }
    const aliasMatch = trimmed.match(/^\[\[([^\]|]+)\|([^\]]+)\]\]$/);
    if (aliasMatch) return aliasMatch[2].trim();
    const plainMatch = trimmed.match(/^\[\[([^\]|]+)\]\]$/);
    if (plainMatch) {
      const inner = plainMatch[1].trim();
      if (inner.startsWith("http://") || inner.startsWith("https://")) {
        return this.iriToObsidianName(inner) ?? inner;
      }
      return inner;
    }
    return trimmed;
  }

  /**
   * Read a grounding target value, converting IRIs back to wikilink format.
   * Literal values are returned as-is (they already contain wikilink syntax).
   */
  private async getObsidianWikilinkValue(subject: IRI, predicate: IRI): Promise<string | null> {
    const triples = await this.tripleStore.match(subject, predicate, undefined);
    if (triples.length === 0) return null;

    const obj = triples[0].object;
    if (obj instanceof Literal) return this.resolveWikilinkAlias(obj.value);
    if (obj instanceof IRI) {
      const name = this.iriToObsidianName(obj.value);
      return name ? `"[[${name}]]"` : obj.value;
    }
    return null;
  }

  /**
   * Resolve UUID-only wikilinks to include alias from the triple store.
   * Converts "[[UUID]]" to "[[UUID|label]]" when the asset exists.
   * Already-aliased values ("[[UUID|alias]]") pass through unchanged.
   */
  private async resolveWikilinkAlias(value: string): Promise<string> {
    const match = value.match(/\[\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]\]/);
    if (!match) return value;

    const uuid = match[1];
    const assetSubject = await this.findSubjectByUID(uuid);
    if (!assetSubject) return value;

    const label = await this.getLiteralValue(assetSubject, Namespace.EXO.term("Asset_label"));
    if (!label) return value;

    return value.replace(`[[${uuid}]]`, `[[${uuid}|${label}]]`);
  }

  private iriToObsidianName(iri: string): string | null {
    const hash = iri.lastIndexOf("#");
    if (hash >= 0) {
      const ns = iri.substring(0, hash + 1);
      const local = iri.substring(hash + 1);
      if (ns === Namespace.EMS.iri.value) return `ems__${local}`;
      if (ns === Namespace.EXO.iri.value) return `exo__${local}`;
      if (ns === Namespace.EXOCMD.iri.value) return `exocmd__${local}`;
      if (ns === Namespace.IMS.iri.value) return `ims__${local}`;
      if (ns === Namespace.ZTLK.iri.value) return `ztlk__${local}`;
      if (ns === Namespace.PTMS.iri.value) return `ptms__${local}`;
      if (ns === Namespace.LIT.iri.value) return `lit__${local}`;
      if (ns === Namespace.INBOX.iri.value) return `inbox__${local}`;
    }
    // Handle obsidian:// vault URLs (e.g., obsidian://vault/ems/ems__EffortStatusDoing.md)
    const obsMatch = iri.match(/\/([^/]+)\.md$/);
    if (obsMatch) return obsMatch[1];
    return null;
  }

  private normalizeWikilink(value: string): string {
    const cleaned = value.replace(/["'[\]]/g, "").trim();
    const pipeIndex = cleaned.indexOf("|");
    return pipeIndex >= 0 ? cleaned.substring(0, pipeIndex) : cleaned;
  }
}
