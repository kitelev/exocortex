import { injectable } from "tsyringe";
import type { ITripleStore } from "../interfaces/ITripleStore";
import type { ILogger } from "../interfaces/ILogger";
import { NullLogger } from "../infrastructure/NullLogger";
import { IRI } from "../domain/models/rdf/IRI";
import { Literal } from "../domain/models/rdf/Literal";
import { Namespace } from "../domain/models/rdf/Namespace";
import { GroundingType } from "../domain/constants/GroundingType";
import { resolveGroundingTypeFromIRI } from "../domain/constants/GroundingTypeUIDs";
import { utf8ToBase64 } from "../utilities/base64";
import { iriToObsidianName } from "../utilities/iriToObsidianName";
import { DateFormatter } from "../utilities/DateFormatter";
import {
  COMMAND_VARIANT_VALUES,
  LABEL_CLASS_VALUES,
  STYLE_SOURCE_VALUES,
  type CommandVariant,
  type LabelClass,
  type StyleSource,
} from "../domain/constants/CommandBindingStyleEnums";
import {
  clearUniversalDefault,
  loadUniversalDefault,
  mergePropertyDefaults,
  mergeInheritanceRules,
  type UniversalDefaultTemplate,
} from "./UniversalDefaultTemplateResolver";
import { ExoQLParser } from "../infrastructure/sparql/SPARQLParser";
import { ExoQLAlgebraTranslator } from "../infrastructure/sparql/algebra/AlgebraTranslator";
import { ExoQLQueryExecutor } from "../infrastructure/sparql/executors/QueryExecutor";
import type {
  CommandDefinition,
  PreconditionDefinition,
  GroundingDefinition,
  CommandBindingDefinition,
  CommandBindingStyleDefinition,
  PropertyDefaultResolved,
  InheritanceRuleResolved,
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
 * C3 capability-inheritance (RFC 78c2b7d0) — symbolic label of the universal
 * root class. Every asset implicitly specialises `exo__Asset`, so a binding
 * targeting it must match every asset (the universal-root guard appends it to
 * the expanded class set when the declared superClass chain omits it).
 */
const UNIVERSAL_ROOT_CLASS = "exo__Asset";

/**
 * C3 — sentinel ancestor-depth assigned to the universal root when it is NOT
 * reached by the BFS (e.g. a root-concept leaf whose chain does not terminate
 * at `exo__Asset`). Larger than any real BFS depth so universal bindings sort
 * LAST among class-targeted bindings (least specific → "nearer class higher").
 */
const UNIVERSAL_FALLBACK_DEPTH = MAX_TRANSITIVE_DEPTH + 1;

/**
 * RFC v2 Phase 3a — UID of the canonical `exocmd__SubstitutionToken` class
 * file (UUID-named TBox per RFC-004). Used to detect whether the value asset
 * of a `PropertyDefault_value` reference is a SubstitutionToken instance, in
 * which case the parser invokes a resolver from the registry below.
 */
const SUBSTITUTION_TOKEN_CLASS_UID = "08cec529-90eb-4d43-88de-ceecccea12b0";

/**
 * RFC v2 Phase 3a — IRI form of `exocmd__SubstitutionToken`. NoteToRDFConverter
 * normalises every `exo__Instance_class` triple to namespace IRI form via
 * `valueToClassURI` regardless of whether the authoring shape is symbolic
 * (`[[exocmd__SubstitutionToken]]`) or UUID-canon (`[[<UID>]]`). Comparing
 * class IRIs against this constant is the cheapest detection path; UID
 * fallback exists for the unlikely case where label expansion failed.
 */
const SUBSTITUTION_TOKEN_CLASS_IRI =
  Namespace.EXOCMD.term("SubstitutionToken").value;

/**
 * RFC v2 Phase 3a — known SubstitutionToken resolver-ids. RDF vocabulary
 * (the token assets themselves) lives in vault; this Set is the TS-side
 * validation surface so the parser can warn loudly on unknown resolver-ids
 * instead of silently emitting a marker the executor can't honour.
 */
const KNOWN_SUBSTITUTION_RESOLVER_IDS: ReadonlySet<string> = new Set([
  // RFC v2 Phase 3a — bootstrap vocabulary
  "today",
  // req 915b20b2 — `$tomorrow` (today + 1 day, YYYY-MM-DD) soft daily tickler
  // for ems__WaitingCheckTask. The resolver exists in SubstitutionResolverRegistry
  // (Веха 5) but was never whitelisted here (no vault token used it) — a
  // parameterless SubstitutionToken referencing it fell back to wikilink form.
  "tomorrow",
  "todayStart",
  "targetFolder",
  "target",
  // RFC 727572d2 Phase A2 — full RDF-driven creation vocabulary
  "randomUUIDv4",
  "nowTimestamp",
  "nowDate",
  "nowYear",
  "nowMonth",
  "userInputLabel",
  "userInput",
  "targetProperty",
  "labelAsArray",
  "groundingTargetClass",
  // T1 "Create Instance" homoiconic button (project bbe40f8c): host page IS
  // the class definition, so the new instance's exo__Instance_class points at
  // the host's own UID (resolved from targetFilePath basename at exec time).
  "targetClassSelf",
]);

/**
 * Marker for context-dependent SubstitutionToken resolvers — executor
 * substitutes at runtime when the click target IRI / file path / userInput /
 * Grounding metadata are known. Context-independent resolvers (today,
 * todayStart, nowDate, nowYear, nowMonth, nowTimestamp, randomUUIDv4) are
 * resolved at parse time and never produce this marker.
 *
 * Shape: `__SUBSTITUTE__<resolver-id>__<token-uid>__`
 *
 * Parameterised form for TokenInvocation wrappers (RFC 727572d2):
 *   `__SUBSTITUTE_P__<resolver-id>__<token-uid>__<base64-param>__`
 * where `<base64-param>` is URL-safe base64 of the parameter literal.
 */
function buildSubstitutionMarker(resolverId: string, tokenUid: string): string {
  return `__SUBSTITUTE__${resolverId}__${tokenUid}__`;
}

/**
 * RFC 727572d2 — parameterised marker for TokenInvocation values. URL-safe
 * base64 keeps the parameter free of `__` separator collisions (property
 * labels like `exo__Asset_isDefinedBy` legitimately contain `__`).
 */
function buildParameterisedMarker(
  resolverId: string,
  tokenUid: string,
  parameter: string,
): string {
  const encoded = utf8ToBase64(parameter)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `__SUBSTITUTE_P__${resolverId}__${tokenUid}__${encoded}__`;
}

/** RFC 727572d2 — UID of `exocmd__TokenInvocation` class. */
const TOKEN_INVOCATION_CLASS_UID = "3f28af98-c031-4718-8ba2-44ad0b012c52";
const TOKEN_INVOCATION_CLASS_IRI =
  Namespace.EXOCMD.term("TokenInvocation").value;

/** RFC 727572d2 — UID of `exocmd__UniversalDefaultTemplate` class. */
const UNIVERSAL_DEFAULT_TEMPLATE_CLASS_UID =
  "29e2c8f8-2d27-4e58-b467-2e85d46f8122";

/** Context-uid label appended to warn messages from Universal Template ABox. */
const UNIVERSAL_DEFAULT_TEMPLATE_CTX = "universal-default-template";

/**
 * RFC 727572d2 — context-independent date/time resolvers safely baked at
 * parse time. Matches the existing behaviour for `today` / `todayStart`
 * (resolved when CommandResolver parses Groundings; cached for session).
 *
 * `randomUUIDv4` is intentionally NOT here: parse-time UUID baking would
 * produce the same UUID for every click on a cached Grounding until cache
 * invalidates — unsafe. It emits a marker for runtime resolution instead.
 */
const PARSE_TIME_RESOLVERS: ReadonlySet<string> = new Set([
  "today",
  // req 915b20b2 — `$tomorrow` is context-free (today + 1 day), baked at parse
  // time exactly like `$today` (same session-cache semantics).
  "tomorrow",
  "todayStart",
  "nowTimestamp",
  "nowDate",
  "nowYear",
  "nowMonth",
]);

/**
 * Resolves dynamic commands from vault assets stored in an ITripleStore (RFC-009 §5.3).
 *
 * Binding priority (specific → general):
 * 1. targetAsset — only for a specific asset
 * 2. targetPrototype — for all instances of a prototype, including instances
 *    of its (transitive) child prototypes: the target's `exo__Asset_prototype`
 *    chain is expanded through the store (cycle-safe, depth-capped) and the
 *    binding matches if ANY ancestor matches (@req:5ad0d6b4-2c9a-4375-bb5b-04e754861bec)
 * 3. targetClass — for all assets of a class
 *
 * Issue #2428
 */
@injectable()
export class CommandResolver {
  private readonly cache = new Map<string, ResolvedCommand[]>();
  private readonly multiCache = new Map<string, ResolvedCommand[]>();
  /**
   * Issue #3295 — memoize `getClassAncestors` results per class ref so
   * the per-render BFS over `exo__Class_superClass` (called once per
   * leaf class declared by the rendered asset) does not re-walk the
   * triple store on every Obsidian render tick. TBox is static within
   * a session unless `invalidateCache()` is called by indexer hooks
   * after a TBox file write.
   */
  private readonly _ancestorDepthCache = new Map<
    string,
    Array<{ ref: string; depth: number }>
  >();

  /**
   * RFC v2 Phase 5 (#3167) — once-per-session-per-Grounding warning suppression
   * for hand-edited / third-party Groundings that still carry the deprecated
   * legacy `Grounding_propertyDefaults` (plural) JSON predicate. The parser was
   * removed but the predicate value is silently ignored at engine level; this
   * Set lets us emit a single audible warn per Grounding-uid so the regression
   * surfaces in logs rather than as a quiet behavior change. Transitional —
   * remove after one minor release window.
   */
  private readonly _legacyPropertyDefaultsWarnedGroundings = new Set<string>();

  /**
   * RFC 727572d2 — Universal Default Template singleton cache. Loaded once
   * per CommandResolver instance via {@link getUniversalCache}. Vault file
   * change adapters may externally call
   * {@link clearUniversalDefault} (UniversalDefaultTemplateResolver) AND
   * recreate the CommandResolver to fully invalidate.
   */
  private _universalCacheReady = false;
  private _universalCacheValue: UniversalDefaultTemplate | null = null;

  /**
   * RFC 727572d2 — invalidate the per-instance Universal Default Template
   * cache. Vault file-watcher adapters (Obsidian plugin / CLI) should call
   * this when the singleton ABox asset (62907ff4) or any referenced
   * PropertyDefault / InheritanceRule changes on disk, then either
   * re-create the CommandResolver or simply rely on lazy re-load on next
   * `resolvePropertyDefaults` invocation. Also clears the module-level
   * loader cache so external loader sources stay aligned.
   */
  clearUniversalCache(): void {
    this._universalCacheReady = false;
    this._universalCacheValue = null;
    clearUniversalDefault();
  }

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
   * Resolve commands for an asset declaring one or more classes (RFC-009 §5.3,
   * Issue #2958) with **resolver-side capability inheritance** (C3, RFC
   * 78c2b7d0 — the ХРЕБЕТ child RFC).
   *
   * The resolver itself expands `assetClasses` along the `exo__Class_superClass`
   * chain (via {@link expandClassHierarchy}), so EVERY consumer inherits
   * `targetClass` bindings from ancestor classes — not only the plugin-UI
   * caller that historically pre-expanded the array in `extractAssetClasses`.
   * CLI `apply`, `CommandRegistry`, and any future consumer get inheritance
   * for free.
   *
   * Resolution semantics:
   * - `targetClass` bindings are inherited (opt-out) through the whole superClass
   *   chain; `targetAsset` bindings are NOT inherited (they match by asset IRI,
   *   which class-distance never widens). `targetPrototype` bindings are NOT
   *   class-inherited either, but they ARE inherited along the target's own
   *   `exo__Asset_prototype` chain (see {@link expandPrototypeChain},
   *   @req:5ad0d6b4-2c9a-4375-bb5b-04e754861bec): a binding on a parent
   *   prototype matches instances of its transitive child prototypes.
   * - Each binding is tagged with the nearest ancestor-depth at which it matched
   *   (declared leaf = 0, direct superclass = 1, …). The merged set is sorted by
   *   `(priority, depth, order)` — nearest-wins ("nearer class higher" in the UI).
   *   `targetAsset` (priority 0) and `targetPrototype` (1) still beat any
   *   `targetClass` binding (2) regardless of depth.
   * - An explicit `overrides` edge (`exocmd__CommandBinding_overrides`) removes
   *   the targeted binding from the merged set ABSOLUTELY — independent of the
   *   contributing ancestor and of distance, resolved AFTER BFS expansion. A
   *   dangling override ref is fail-open (no-op, never an error). Override edges
   *   are collected across the whole expanded set, so transitive chains
   *   (A→B→C) remove both B and C.
   * - A universal-root guard ensures `exo__Asset` bindings keep matching even
   *   when the declared chain does not terminate at `exo__Asset`.
   *
   * Dedup is by `binding.id` (NOT `commandRef` — one command may surface via
   * several bindings, each once), keeping the nearest (minimum-depth) match.
   *
   * Idempotent under caller pre-expansion: passing a fully-expanded chain yields
   * the SAME result as passing only the declared leaves, because depth is
   * derived from the class hierarchy (true-leaf detection in
   * {@link expandClassHierarchy}), not from input-array position.
   *
   * @param subjectIRI - IRI of the target asset (subject)
   * @param assetClasses - Declared classes of the asset (`exo__Instance_class`).
   *                      May be the bare leaves OR a pre-expanded chain — both
   *                      resolve identically.
   * @param prototypeIRI - Optional DIRECT prototype ref of the target
   *   (`exo__Asset_prototype`); expanded resolver-side into the transitive
   *   prototype chain for `targetPrototype` matching (@req:5ad0d6b4)
   * @returns Resolved commands sorted by `(priority, depth, order)`; deduped by
   *          binding.id; overridden bindings removed
   */
  async resolveForAssetMulti(
    subjectIRI: string,
    assetClasses: string[],
    prototypeIRI?: string,
  ): Promise<ResolvedCommand[]> {
    if (assetClasses.length === 0) return [];

    // Cache key uses sorted INPUT classes — stable across permutations and
    // deterministic w.r.t. the resolver-side expansion they drive. The raw
    // prototypeIRI stays the key: its expanded chain is a deterministic
    // derivative of (prototypeIRI, store state), and store mutations clear
    // the caches via invalidateCache().
    const sortedClasses = [...assetClasses].sort().join(",");
    const cacheKey = `${subjectIRI}::${sortedClasses}::${prototypeIRI ?? ""}`;
    const cached = this.multiCache.get(cacheKey);
    if (cached) return cached;

    // 0. Expand the direct prototype ref into its transitive prototype chain
    //    ONCE for the whole per-class loop (@req:5ad0d6b4).
    const prototypeChain = prototypeIRI
      ? await this.expandPrototypeChain(prototypeIRI)
      : undefined;

    // 1. Expand the declared classes along the superClass chain, tagging each
    //    resolved class ref with its nearest ancestor-depth.
    const classDepths = await this.expandClassHierarchy(assetClasses);

    // 2. Resolve bindings per expanded class, keeping the nearest (min-depth)
    //    match per binding.id. Non-class bindings (asset / prototype) are
    //    distance-independent, so they are pinned to depth 0.
    const byBindingId = new Map<
      string,
      { rc: ResolvedCommand; depth: number }
    >();
    for (const [cls, classDepth] of classDepths) {
      const bindings = await this.resolveForAsset(
        subjectIRI,
        cls,
        prototypeChain,
      );
      for (const rc of bindings) {
        const matchDepth =
          this.getBindingPriority(rc.binding) === 2 ? classDepth : 0;
        const existing = byBindingId.get(rc.binding.id);
        if (!existing || matchDepth < existing.depth) {
          byBindingId.set(rc.binding.id, { rc, depth: matchDepth });
        }
      }
    }

    // 3. Collect override targets across the WHOLE expanded set BEFORE removal,
    //    so an `overrides` edge is absolute regardless of distance and
    //    transitive chains (A→B→C) drop both B and C. Dangling refs (no such
    //    binding in the set) are fail-open — they simply match nothing.
    const overridden = new Set<string>();
    for (const { rc } of byBindingId.values()) {
      if (rc.binding.overrides) {
        for (const target of rc.binding.overrides) overridden.add(target);
      }
    }

    // 4. Build the merged list (excluding overridden bindings) and sort by
    //    (priority, depth, order) — nearest-wins among same-priority bindings.
    const merged = Array.from(byBindingId.entries())
      .filter(([id]) => !overridden.has(id))
      .map(([, value]) => value);

    merged.sort((a, b) => {
      const priorityA = this.getBindingPriority(a.rc.binding);
      const priorityB = this.getBindingPriority(b.rc.binding);
      if (priorityA !== priorityB) return priorityA - priorityB;
      if (a.depth !== b.depth) return a.depth - b.depth;
      return (a.rc.binding.order ?? 100) - (b.rc.binding.order ?? 100);
    });

    const result = merged.map((entry) => entry.rc);
    this.multiCache.set(cacheKey, result);
    return result;
  }

  /**
   * C3 capability-inheritance (RFC 78c2b7d0) — expand the declared classes of
   * an asset into the full set of class refs that should participate in binding
   * resolution, each tagged with its nearest ancestor-depth (declared leaf = 0,
   * direct superclass = 1, …).
   *
   * Robust to caller pre-expansion: the plugin caller historically appends the
   * superClass chain + `exo__Asset` to the class array. To keep depth correct
   * whether the caller passed bare leaves (CLI `apply`) OR a pre-expanded chain
   * (plugin), we first detect the **true leaves** — input classes that are NOT
   * an ancestor of any sibling input class — and derive depth from those. A
   * pre-expanded `ems__Task` is recognised as an ancestor of `ems__Meeting`,
   * so it correctly lands at depth 1, not depth 0.
   *
   * Includes the universal-root guard: `exo__Asset` is appended at a sentinel
   * depth when the declared chain does not reach it, so universal bindings keep
   * matching root-concept leaves.
   *
   * @returns Map of class-ref → nearest depth (both symbolic and UID-canon
   *          forms of each ancestor are present so bindings authored in either
   *          form match).
   */
  private async expandClassHierarchy(
    inputClasses: string[],
  ): Promise<Map<string, number>> {
    // Ancestor set per input class (memoised by getClassAncestors).
    const ancestorSets = new Map<string, Set<string>>();
    for (const cls of inputClasses) {
      if (cls === UNIVERSAL_ROOT_CLASS) {
        ancestorSets.set(cls, new Set());
        continue;
      }
      let ancestors: string[] = [];
      try {
        ancestors = await this.getClassAncestors(cls);
      } catch {
        ancestors = []; // fail-open: unknown / cold-start class
      }
      ancestorSets.set(cls, new Set(ancestors));
    }

    // True leaves = input classes that are NOT an ancestor of any sibling
    // input class. This makes depth assignment invariant to whether the caller
    // pre-expanded the chain.
    //
    // Cycle guard: under a malformed cyclic TBox (`A ⊑ B ⊑ A`), a pre-expanded
    // caller passes BOTH A and B and each is the other's ancestor. Demoting
    // both would leave neither as a true leaf, so the BFS seeds nothing and
    // every class binding silently vanishes. Demote `cls` only when a sibling
    // is its ancestor AND `cls` is NOT also that sibling's ancestor — so a
    // mutually-ancestral cycle keeps both as leaves (depth 0), preserving the
    // bare-leaf ↔ pre-expanded invariant.
    const isAncestorOfSibling = (cls: string): boolean => {
      for (const other of inputClasses) {
        if (other === cls) continue;
        if (
          ancestorSets.get(other)?.has(cls) &&
          !ancestorSets.get(cls)?.has(other)
        ) {
          return true;
        }
      }
      return false;
    };
    const trueLeaves = inputClasses.filter((cls) => !isAncestorOfSibling(cls));

    const depths = new Map<string, number>();
    const setMin = (ref: string, depth: number): void => {
      const current = depths.get(ref);
      if (current === undefined || depth < current) depths.set(ref, depth);
    };

    for (const leaf of trueLeaves) {
      setMin(leaf, 0);
      // Resolver-side leaf UUID→label so symbolic class-bindings match even for
      // consumers that pass only the UID-canon leaf (CLI `apply`). Idempotent
      // with the plugin caller's metadata-cache expansion.
      if (this.looksLikeUUID(leaf)) {
        try {
          const label = await this.resolveLabelByUID(leaf);
          if (label) setMin(label, 0);
        } catch {
          /* fail-open */
        }
      }
      if (leaf === UNIVERSAL_ROOT_CLASS) continue;
      let ancestors: Array<{ ref: string; depth: number }> = [];
      try {
        ancestors = await this.getClassAncestorsWithDepth(leaf);
      } catch {
        ancestors = [];
      }
      for (const { ref, depth } of ancestors) setMin(ref, depth);
    }

    // Universal-root guard — keep `exo__Asset` bindings matching even when the
    // declared chain does not terminate at the root (e.g. root-concept leaf).
    if (!depths.has(UNIVERSAL_ROOT_CLASS)) {
      depths.set(UNIVERSAL_ROOT_CLASS, UNIVERSAL_FALLBACK_DEPTH);
    }

    return depths;
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
    prototypeIRI?: string | readonly string[],
  ): Promise<ResolvedCommand[]> {
    // A string is the raw direct prototype ref (public callers); an array is
    // an already-expanded chain (internal resolveForAssetMulti fast path).
    // Both key deterministically w.r.t. the same store state. A form prefix +
    // NUL separator rule out a collision between a raw string ref that
    // contains "|" (alias-form refs) and a joined chain (PR #3804 review).
    const protoKey =
      typeof prototypeIRI === "string"
        ? `s:${prototypeIRI}`
        : prototypeIRI
          ? `c:${prototypeIRI.join("\u0000")}`
          : "";
    const cacheKey = `${subjectIRI}:${assetClass}:${protoKey}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const prototypeChain =
      typeof prototypeIRI === "string"
        ? await this.expandPrototypeChain(prototypeIRI)
        : prototypeIRI;

    const bindings = await this.findBindings(
      assetClass,
      prototypeChain,
      subjectIRI,
    );

    const resolved: ResolvedCommand[] = [];
    for (const binding of bindings) {
      // Pass binding.targetClass so loadLinkedGrounding can pick the
      // prototype-matching grounding when a command exposes N groundings
      // (one per targetPrototype). Without context the loader falls back
      // to first-by-iteration-order — see fix(grounding) below.
      const command = await this.loadCommand(binding.commandRef, {
        targetClass: binding.targetClass,
      });
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
   *
   * @param commandUID — UID of the command asset.
   * @param context — optional dispatch context. When `targetClass` is set and the
   *   command exposes multiple `Command_grounding` refs (e.g. universal Create
   *   Instance pattern), the matching grounding is picked by
   *   `Grounding_targetPrototype === context.targetClass`. Single-grounding
   *   commands and palette/no-context callers preserve legacy first-wins
   *   behaviour.
   *
   * **Scope limit:** the picker is wired off the binding's `targetClass`. A
   *   binding that declares only `targetPrototype` or `targetAsset` (per
   *   `loadBindingDefinition`: «at least one target is required») will pass
   *   `context.targetClass = undefined`, hit the fast path, and resolve to
   *   the first grounding by iteration order. This matches the empirically-
   *   observed bug scope (2026-05-25: MeetingPrototype binding via
   *   `targetClass`). If a future universal-N-grounding command is bound via
   *   `targetPrototype`/`targetAsset`, extend `context` to cover those keys
   *   and update the loop to try each.
   */
  async loadCommand(
    commandUID: string,
    context?: { targetClass?: string },
  ): Promise<CommandDefinition | null> {
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
    const name =
      (await this.getLiteralValue(
        subject,
        Namespace.EXO.term("Asset_label"),
      )) ?? "Unknown Command";
    const labelTemplate = await this.getLiteralValue(
      subject,
      Namespace.EXOCMD.term("Command_labelTemplate"),
    );
    const icon = await this.getLiteralValue(
      subject,
      Namespace.EXOCMD.term("Command_icon"),
    );
    const confirmMessage = await this.getLiteralValue(
      subject,
      Namespace.EXOCMD.term("Command_confirmMessage"),
    );
    const successMessage = await this.getLiteralValue(
      subject,
      Namespace.EXOCMD.term("Command_successMessage"),
    );
    const category = await this.getLiteralValue(
      subject,
      Namespace.EXOCMD.term("Command_category"),
    );
    // RFC ce27e55d: parse boolean openInSameTab — when true, platform opener
    // navigates to the new instance in the current leaf instead of a new tab.
    const openInSameTabRaw = await this.getLiteralValue(
      subject,
      Namespace.EXOCMD.term("Command_openInSameTab"),
    );
    const openInSameTab =
      openInSameTabRaw !== null &&
      String(openInSameTabRaw).trim().toLowerCase() === "true";

    // Transitively load linked Precondition
    const precondition = await this.loadLinkedPrecondition(subject);

    // Transitively load linked Grounding
    const grounding = await this.loadLinkedGrounding(subject, 0, context);
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
      openInSameTab: openInSameTab || undefined,
    };
  }

  /**
   * Find all command bindings matching the given filters.
   *
   * Returns bindings for:
   * - targetAsset matching subjectIRI
   * - targetPrototype matching ANY element of the target's prototype chain
   *   (a bare string is expanded via {@link expandPrototypeChain} first —
   *   @req:5ad0d6b4-2c9a-4375-bb5b-04e754861bec)
   * - targetClass matching assetClass
   */
  async findBindings(
    assetClass?: string,
    prototypeIRI?: string | readonly string[],
    assetIRI?: string,
  ): Promise<CommandBindingDefinition[]> {
    const prototypeChain =
      typeof prototypeIRI === "string"
        ? await this.expandPrototypeChain(prototypeIRI)
        : prototypeIRI;

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
      if (this.bindingMatches(binding, assetClass, prototypeChain, assetIRI)) {
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
    this._ancestorDepthCache.clear();
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
  private extractPlaceholders(
    template: string,
  ): Array<{ full: string; body: string }> {
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

  private async loadBindingDefinition(
    subject: IRI,
  ): Promise<CommandBindingDefinition | null> {
    const uid = await this.getLiteralValue(
      subject,
      Namespace.EXO.term("Asset_uid"),
    );
    if (!uid) return null;

    const label =
      (await this.getLiteralValue(
        subject,
        Namespace.EXO.term("Asset_label"),
      )) ?? "";

    // Load command reference
    const commandRef = await this.getLinkedUID(
      subject,
      Namespace.EXOCMD.term("CommandBinding_command"),
    );
    if (!commandRef) return null;

    // Load target filters
    const targetClass = await this.getLinkedValue(
      subject,
      Namespace.EXOCMD.term("CommandBinding_targetClass"),
    );
    const targetPrototype = await this.getLinkedValue(
      subject,
      Namespace.EXOCMD.term("CommandBinding_targetPrototype"),
    );
    const targetAsset = await this.getLinkedValue(
      subject,
      Namespace.EXOCMD.term("CommandBinding_targetAsset"),
    );

    // At least one target is required
    if (!targetClass && !targetPrototype && !targetAsset) return null;

    // Load display options
    const position = await this.getLiteralValue(
      subject,
      Namespace.EXOCMD.term("CommandBinding_position"),
    );
    const orderStr = await this.getLiteralValue(
      subject,
      Namespace.EXOCMD.term("CommandBinding_order"),
    );

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

    // C3 capability-inheritance (RFC 78c2b7d0) — explicit override refs. Each
    // resolves to the target binding's UID (= its `binding.id`), which
    // `resolveForAssetMulti` removes from the merged set absolutely.
    const overrides = await this.getLinkedUIDs(
      subject,
      Namespace.EXOCMD.term("CommandBinding_overrides"),
    );

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
      overrides: overrides.length > 0 ? overrides : undefined,
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
    const uid = await this.getLiteralValue(
      subject,
      Namespace.EXO.term("Asset_uid"),
    );
    if (!uid) return null;

    const label =
      (await this.getLiteralValue(
        subject,
        Namespace.EXO.term("Asset_label"),
      )) ?? "";

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
      labelClassRaw !== null
        ? this.coerceLabelClass(labelClassRaw, uid)
        : undefined;

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
    prototypeChain?: readonly string[],
    assetIRI?: string,
  ): boolean {
    // targetAsset: match specific asset
    if (binding.targetAsset && assetIRI) {
      if (this.matchesReference(binding.targetAsset, assetIRI)) return true;
    }

    // targetPrototype: match ANY ancestor in the target's prototype chain
    // (chain[0] = the direct prototype — @req:5ad0d6b4).
    if (binding.targetPrototype && prototypeChain) {
      for (const prototypeRef of prototypeChain) {
        if (this.matchesReference(binding.targetPrototype, prototypeRef))
          return true;
      }
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

  private async loadLinkedPrecondition(
    commandSubject: IRI,
  ): Promise<PreconditionDefinition | null> {
    return this.loadLinkedPreconditionFromProperty(
      commandSubject,
      Namespace.EXOCMD.term("Command_precondition"),
    );
  }

  /**
   * Top-level precondition loader (onto-RFC df602adc — способ A).
   *
   * Resolves the precondition referenced from `predicate` on `subject`
   * (`Command_precondition` / `CommandBinding_precondition`) into a — possibly
   * composite — {@link PreconditionDefinition} tree via
   * {@link loadPreconditionSubject}.
   *
   * Fail-OPEN boundary (unchanged from the pre-composite behaviour): returns
   * `null` when there is no ref, the ref does not resolve, OR the resolved
   * top-level precondition is a malformed atomic (no `sparqlAsk`/`query`/
   * `hostFunction` and no combinator). `null` → `PreconditionEvaluator.evaluate`
   * treats it as "no precondition" → command SHOWN. A *broken child* deep inside
   * the tree is fail-CLOSED instead — see {@link loadChildPrecondition}.
   */
  private async loadLinkedPreconditionFromProperty(
    subject: IRI,
    predicate: IRI,
  ): Promise<PreconditionDefinition | null> {
    const refTriples = await this.tripleStore.match(
      subject,
      predicate,
      undefined,
    );
    if (refTriples.length === 0) return null;

    const preconditionSubject = await this.resolvePreconditionRef(
      refTriples[0].object,
    );
    if (!preconditionSubject) return null;

    // Top-level: a malformed/atomic-without-source precondition yields `null`
    // (fail-open, backward compatible). Composite/not/valid-atomic yields a
    // definition; any broken descendants are embedded (fail-closed) inside it.
    return this.loadPreconditionSubject(
      preconditionSubject,
      new Set<string>(),
      0,
    );
  }

  /**
   * Resolve a precondition object reference (IRI or Literal wikilink) to the
   * referenced precondition asset's IRI subject. Returns `null` when the
   * reference cannot be resolved (UID not indexed). Mirrors
   * {@link resolveGroundingRef} for the precondition domain.
   */
  private async resolvePreconditionRef(
    ref: IRI | Literal | unknown,
  ): Promise<IRI | null> {
    if (ref instanceof IRI) return ref;
    if (ref instanceof Literal) {
      const uid = this.normalizeWikilink(ref.value);
      return await this.findSubjectByUID(uid);
    }
    return null;
  }

  /**
   * Recursively load a precondition subject into a (possibly composite) tree.
   *
   * Kind is decided by PROPERTY PRESENCE (onto-RFC df602adc — dual-IRI-safe, no
   * class-IRI walk): `AllPrecondition_preconditions` → `all`;
   * `AnyPrecondition_preconditions` → `any`; `NotPrecondition_precondition` →
   * `not`; otherwise atomic. Precedence all > any > not is deterministic (the
   * Phase-3 sh:xone integrity guard ensures ≤1 combinator per instance, but the
   * loader must never be ambiguous even for malformed authoring).
   *
   * Returns `null` ONLY for a malformed atomic (no combinator property AND no
   * `sparqlAsk`/`query`/`hostFunction`, or no `Asset_uid`). The caller decides
   * what `null` means: the top-level entry treats it as fail-OPEN (no
   * precondition), while {@link loadChildPrecondition} converts it to a broken
   * node (fail-CLOSED). Cycles (visited-set) and over-depth are returned as
   * explicit `broken` nodes (fail-CLOSED) regardless of caller.
   *
   * @param visited UIDs of ancestor combinator nodes on the current path
   *   (copy-on-recurse; read-only for the callee) — cycle guard.
   * @param depth   recursion depth — capped by {@link MAX_TRANSITIVE_DEPTH}.
   */
  private async loadPreconditionSubject(
    subject: IRI,
    visited: ReadonlySet<string>,
    depth: number,
  ): Promise<PreconditionDefinition | null> {
    const uid = await this.getLiteralValue(
      subject,
      Namespace.EXO.term("Asset_uid"),
    );
    const label =
      (await this.getLiteralValue(
        subject,
        Namespace.EXO.term("Asset_label"),
      )) ?? "";

    // Cycle / over-depth guards (fail-closed). Only combinator subjects recurse,
    // but checking here keeps both boundaries in one place. At the top level
    // (depth 0, empty visited) neither fires.
    if (uid && visited.has(uid)) return this.brokenPreconditionNode(uid, label);
    if (depth >= MAX_TRANSITIVE_DEPTH)
      return this.brokenPreconditionNode(uid ?? "", label);

    const allRefs = await this.tripleStore.match(
      subject,
      Namespace.EXOCMD.term("AllPrecondition_preconditions"),
      undefined,
    );
    const anyRefs = await this.tripleStore.match(
      subject,
      Namespace.EXOCMD.term("AnyPrecondition_preconditions"),
      undefined,
    );
    const notRefs = await this.tripleStore.match(
      subject,
      Namespace.EXOCMD.term("NotPrecondition_precondition"),
      undefined,
    );

    if (allRefs.length > 0 || anyRefs.length > 0 || notRefs.length > 0) {
      const nextVisited = new Set<string>(visited);
      if (uid) nextVisited.add(uid);

      if (allRefs.length > 0 || anyRefs.length > 0) {
        const op: "all" | "any" = allRefs.length > 0 ? "all" : "any";
        const listRefs = allRefs.length > 0 ? allRefs : anyRefs;
        const children: PreconditionDefinition[] = [];
        for (const triple of listRefs) {
          children.push(
            await this.loadChildPrecondition(
              triple.object,
              nextVisited,
              depth + 1,
            ),
          );
        }
        return { id: uid ?? "", label, composite: { op, children } };
      }

      // NotPrecondition — exactly one child (Phase-3 Single cardinality; take
      // the first defensively if authoring somehow yields more).
      const child = await this.loadChildPrecondition(
        notRefs[0].object,
        nextVisited,
        depth + 1,
      );
      return { id: uid ?? "", label, not: child };
    }

    // Atomic leaf.
    const sparqlAsk = await this.getLiteralValue(
      subject,
      Namespace.EXOCMD.term("Precondition_sparqlAsk"),
    );
    const hostFunction = await this.getLiteralValue(
      subject,
      Namespace.EXOCMD.term("Precondition_hostFunction"),
    );
    const query = await this.loadPreconditionQueryRef(subject);

    if (!uid) return null;

    // A concrete atomic precondition must carry at least one evaluation source.
    // Malformed atomic → null (top-level: fail-open; child: converted to broken).
    if (!sparqlAsk && !hostFunction && !query) return null;

    return {
      id: uid,
      label,
      ...(sparqlAsk && { sparqlAsk }),
      ...(hostFunction && { hostFunction }),
      ...(query && { query }),
    };
  }

  /**
   * Load a CHILD precondition reference into a node. Unlike the top-level
   * boundary, a child that cannot be loaded is fail-CLOSED: an unresolvable
   * ref, a cyclic/over-depth subject, or a malformed atomic all become an
   * explicit `broken` node (evaluated to `false` → command hidden). A child is
   * therefore NEVER dropped from a composite's `children` list.
   */
  private async loadChildPrecondition(
    ref: IRI | Literal | unknown,
    visited: ReadonlySet<string>,
    depth: number,
  ): Promise<PreconditionDefinition> {
    const childSubject = await this.resolvePreconditionRef(ref);
    if (!childSubject) {
      // Unresolvable wikilink (UID not indexed / precondition unmounted).
      const hint =
        ref instanceof Literal ? this.normalizeWikilink(ref.value) : "";
      return this.brokenPreconditionNode(hint, "");
    }

    const def = await this.loadPreconditionSubject(
      childSubject,
      visited,
      depth,
    );
    if (def) return def;

    // Malformed atomic child (loadPreconditionSubject returned null) → broken.
    const uid = await this.getLiteralValue(
      childSubject,
      Namespace.EXO.term("Asset_uid"),
    );
    return this.brokenPreconditionNode(uid ?? "", "");
  }

  /**
   * Resolve `Precondition_query` (wikilink → `exoql__Query` asset UID) so
   * PreconditionEvaluator can fetch the body through the asset-loader.
   * RFC c78cc5c8 Phase 1a (T4). Returns `undefined` when no query ref exists.
   */
  private async loadPreconditionQueryRef(
    subject: IRI,
  ): Promise<string | undefined> {
    const queryRefTriples = await this.tripleStore.match(
      subject,
      Namespace.EXOCMD.term("Precondition_query"),
      undefined,
    );
    if (queryRefTriples.length === 0) return undefined;

    const queryRef = queryRefTriples[0].object;
    if (queryRef instanceof IRI) {
      const queryUid = await this.getLiteralValue(
        queryRef,
        Namespace.EXO.term("Asset_uid"),
      );
      return queryUid ?? undefined;
    }
    if (queryRef instanceof Literal) {
      return this.normalizeWikilink(queryRef.value);
    }
    return undefined;
  }

  /**
   * Build a fail-closed `broken` sentinel node (onto-RFC df602adc Impl-HIGH).
   * Distinct from the top-level `null` fail-open boundary.
   */
  private brokenPreconditionNode(
    id: string,
    label: string,
  ): PreconditionDefinition {
    return { id, label, broken: true };
  }

  /**
   * Resolves the Grounding linked from a Command's `exocmd__Command_grounding`.
   *
   * **Canonical pattern (#3272, decision 2026-05-26):** Command-per-prototype.
   * Each prototype-class has its own dedicated `exocmd__Command` with a
   * single `Command_grounding` reference, surfaced via a dedicated
   * `exocmd__CommandBinding` (`targetClass=<prototype-class>`). In this
   * canonical case `refTriples.length === 1` and the fast path below returns
   * the only grounding. The contract guarantees `refTriples[0]` is the
   * intended one — no dispatch needed.
   *
   * **Legacy multi-Grounding shape:** earlier vault assets (e.g. `bb00efed`
   * pre-#3272 "universal Create Instance" README) declared multiple
   * Groundings per Command, *intending* dispatch by prototype. The original
   * executor returned `refTriples[0]` unconditionally — clicking any
   * prototype always created an `ems__Task`. The "universal" pattern was
   * documentation drift, never implemented. Production vault was migrated
   * to one-Command-per-prototype (2026-05-26): new dedicated Commands for
   * Meeting / FleetingNote / SelfObservation, `bb00efed` trimmed to
   * Task-only, catch-all binding `90f56f1b` removed.
   *
   * The multi-Grounding dispatch loop below remains as a defensive runtime
   * for any residual legacy asset: it matches `Grounding_targetPrototype`
   * against `context.targetClass` so a stray multi-Grounding declaration
   * still dispatches to the right Grounding instead of silently
   * mis-creating a `ems__Task`. Fallback (no match) logs a warning and
   * returns `refTriples[0]` so the button surfaces rather than disappears.
   *
   * **Scope limit:** dispatch keys off `context.targetClass`. Bindings that
   * declare only `targetPrototype` / `targetAsset` (no `targetClass`) hit
   * the fast path — acceptable given the canonical contract guarantees
   * single-grounding.
   *
   * **Future hardening (deferred — #3272 AC #5):** add SHACL
   * `sh:maxCount 1` on `Command_grounding` to enforce the single-Grounding
   * contract at vault-validation time. Once that lands, the dispatch loop
   * below can be removed.
   *
   * @returns the resolved {@link GroundingDefinition}, or `null` when no
   *   `Command_grounding` ref exists, no ref resolves, or the
   *   {@link MAX_TRANSITIVE_DEPTH} bound is reached.
   */
  private async loadLinkedGrounding(
    parentSubject: IRI,
    depth: number,
    context?: { targetClass?: string },
  ): Promise<GroundingDefinition | null> {
    if (depth >= MAX_TRANSITIVE_DEPTH) return null;

    const refTriples = await this.tripleStore.match(
      parentSubject,
      Namespace.EXOCMD.term("Command_grounding"),
      undefined,
    );
    if (refTriples.length === 0) return null;

    // Fast path: single grounding OR no targetClass context — preserve
    // legacy first-by-iteration-order behaviour. Palette commands and
    // single-grounding bindings land here.
    if (refTriples.length === 1 || !context?.targetClass) {
      const groundingSubject = await this.resolveGroundingRef(
        refTriples[0].object,
      );
      if (!groundingSubject) return null;
      return this.loadGroundingDefinition(groundingSubject, depth);
    }

    // Multi-grounding dispatch: pick the grounding whose
    // `Grounding_targetPrototype` matches the binding's `targetClass`.
    // Enables the "1 Command + N Grounding (per prototype) + N Binding
    // (per targetClass)" universal pattern (e.g. bb00efed Create Task
    // Instance with TaskPrototype/ProjectPrototype/MeetingPrototype/…
    // variant groundings). Before this fix, `refTriples[0]` was picked
    // unconditionally — MeetingPrototype binding could end up creating
    // an `ems__Task` if the TaskPrototype grounding happened to be first
    // in iteration order.
    for (const triple of refTriples) {
      const groundingSubject = await this.resolveGroundingRef(triple.object);
      if (!groundingSubject) continue;
      const targetPrototype = await this.getObsidianName(
        groundingSubject,
        Namespace.EXOCMD.term("Grounding_targetPrototype"),
      );
      if (
        targetPrototype &&
        this.matchesReference(targetPrototype, context.targetClass)
      ) {
        return this.loadGroundingDefinition(groundingSubject, depth);
      }
    }

    // Fallback: no grounding declared targetPrototype matching the
    // binding's targetClass. Preserve legacy behaviour (first wins) so
    // existing single-purpose commands attached via multi-grounding
    // pattern by mistake still surface a button rather than disappear
    // silently. The empirical case that motivated this picker (issue
    // surfaced 2026-05-25) is now covered by the loop above.
    //
    // Defensive logging: silent fallback masks future misconfiguration
    // (typo in `Grounding_targetPrototype`, missing variant for a new
    // prototype, etc.) — same failure shape as the original bug this
    // fix addresses. Warn so misconfig is visible in plugin logs.
    this.logger.warn(
      `Command ${parentSubject.value}: ${refTriples.length} groundings declared, ` +
        `none matched context.targetClass='${context.targetClass}' via ` +
        `Grounding_targetPrototype — falling back to first grounding by ` +
        `iteration order (legacy behaviour). Check that one grounding's ` +
        `Grounding_targetPrototype references this targetClass.`,
    );
    const fallback = await this.resolveGroundingRef(refTriples[0].object);
    if (!fallback) return null;
    return this.loadGroundingDefinition(fallback, depth);
  }

  /**
   * Resolve a `Command_grounding` object reference (IRI or Literal wikilink)
   * to the grounding asset's IRI subject. Returns null when the reference
   * cannot be resolved (UID not indexed).
   */
  private async resolveGroundingRef(
    ref: IRI | Literal | unknown,
  ): Promise<IRI | null> {
    if (ref instanceof IRI) return ref;
    if (ref instanceof Literal) {
      const uid = this.normalizeWikilink(ref.value);
      return await this.findSubjectByUID(uid);
    }
    return null;
  }

  /**
   * RFC 36347daf Phase 2 — public entry point for loading a Grounding by
   * UID. Used by `GroundingExecutor.executeWorkflowTransition` to resolve
   * `WorkflowTransition_postActions` references at execution time. Returns
   * null when the UID is not indexed or the asset is not a valid Grounding.
   *
   * Mirrors the private resolution chain used by Command_grounding loader;
   * starts depth=0 so transitive composite/postAction references are bounded
   * by the same MAX_TRANSITIVE_DEPTH safeguard.
   */
  async loadGroundingByUid(uid: string): Promise<GroundingDefinition | null> {
    const subject = await this.findSubjectByUID(uid);
    if (!subject) return null;
    return this.loadGroundingDefinition(subject, 0);
  }

  private async loadGroundingDefinition(
    subject: IRI,
    depth: number,
  ): Promise<GroundingDefinition | null> {
    if (depth >= MAX_TRANSITIVE_DEPTH) return null;

    const uid = await this.getLiteralValue(
      subject,
      Namespace.EXO.term("Asset_uid"),
    );
    if (!uid) return null;

    const label =
      (await this.getLiteralValue(
        subject,
        Namespace.EXO.term("Asset_label"),
      )) ?? "";
    const type = await this.resolveGroundingTypeReference(subject);
    if (!type) return null;

    let targetProperty = await this.getObsidianName(
      subject,
      Namespace.EXOCMD.term("Grounding_targetProperty"),
    );
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
      const serviceId = await this.getLiteralValue(
        subject,
        Namespace.EXOCMD.term("Grounding_serviceId"),
      );
      if (serviceId) {
        targetProperty = serviceId;
      }
    }
    // RFC 31c1a0be Phase 1 typed predicates — emit wikilink/literal/token-label
    // for property_set dispatch in GroundingExecutor.
    // targetValueRef: use getObsidianName so the value is unwrapped to the
    // bare UID (executor re-wraps to `"[[<UID>]]"`). Avoids
    // getObsidianWikilinkValue's `"[[...]]"`-with-alias output that would
    // double-wrap the wikilink at dispatch time.
    const targetValueRef = await this.getObsidianName(
      subject,
      Namespace.EXOCMD.term("Grounding_targetValueRef"),
    );
    const targetValueLiteral = await this.getLiteralValue(
      subject,
      Namespace.EXOCMD.term("Grounding_targetValueLiteral"),
    );
    // SubstitutionToken reference — read the token's exo__Asset_label
    // (e.g. "$nowLocal") so executePropertySet's substituteVariables can
    // resolve it via the existing regex paths.
    const substitutionRefRaw = await this.getObsidianName(
      subject,
      Namespace.EXOCMD.term("Grounding_targetValueSubstitution"),
    );
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
    // RFC 78c2b7d0 C4 — `targetValueQuery` value-source: wikilink ref to a
    // `query__NamedQuery` asset. `getObsidianName` unwraps to the bare UID
    // (executor passes it to the NamedQueryRunner; cold-start label-form refs
    // pass through unchanged, like targetValueRef). Read-side computes the
    // write value — the CQRS bridge consumed by C5.
    const targetValueQuery = await this.getObsidianName(
      subject,
      Namespace.EXOCMD.term("Grounding_targetValueQuery"),
    );
    // RFC 918a2b65 Phase 1 typed predicates for service_call + property_append.
    // Plain string literals (JSON config / substitution expression); resolution
    // is identical to `targetValueLiteral`. Phase 4 (#3242) removed the legacy
    // `Grounding_targetValue` loader + transitional deprecation warn.
    const serviceCallPayload = await this.getLiteralValue(
      subject,
      Namespace.EXOCMD.term("Grounding_serviceCallPayload"),
    );
    const appendExpression = await this.getLiteralValue(
      subject,
      Namespace.EXOCMD.term("Grounding_appendExpression"),
    );
    const isDefinedBy = await this.getObsidianWikilinkValue(
      subject,
      Namespace.EXOCMD.term("Grounding_isDefinedBy"),
    );
    const sparqlUpdate = await this.getLiteralValue(
      subject,
      Namespace.EXOCMD.term("Grounding_sparqlUpdate"),
    );
    // Issue #3212: `Grounding_targetClass` must yield UID-form for UUID-canon
    // TBox (vault aiKnow `[[152e39df-cc1b-4175-a4f2-2c2913018937]]`). Three
    // storage shapes flow through here:
    //   (a) IRI to a UUID-named class TBox file (post-NoteToRDFConverter Phase
    //       3 bypass extension) — `getObsidianName` extracts the UUID basename
    //       via `iriToObsidianName`. Already UID-form.
    //   (b) Plain literal short-name `"ems__Task"` (legacy ABox shape, still
    //       prevalent in vault — e.g. grounding `a6ef8fda-...` "Create
    //       TaskPrototype instance"). Resolver returns `"ems__Task"`.
    //   (c) Wikilink-to-label `"[[ems__Task]]"` (legacy) — resolver returns
    //       `"ems__Task"` via `unwrapWikilink`.
    // For (b) and (c) we look up the class file by `exo__Asset_label` and
    // substitute the UID. Falls back to the short-name when no class file
    // matches (test fixtures without a seeded TBox, ABox typos, etc.).
    let targetClass = await this.getObsidianName(
      subject,
      Namespace.EXOCMD.term("Grounding_targetClass"),
    );
    if (targetClass && !this.looksLikeUUID(targetClass)) {
      const classUid = await this.findUidByLabel(targetClass);
      if (classUid) {
        targetClass = classUid;
      }
    }
    const targetPrototype = await this.getObsidianName(
      subject,
      Namespace.EXOCMD.term("Grounding_targetPrototype"),
    );
    const targetFolder = await this.getLiteralValue(
      subject,
      Namespace.EXOCMD.term("Grounding_targetFolder"),
    );
    const linkBackProperty = await this.getObsidianName(
      subject,
      Namespace.EXOCMD.term("Grounding_linkBackProperty"),
    );
    const inputSchemaRaw = await this.getLiteralValue(
      subject,
      Namespace.EXOCMD.term("Grounding_inputSchema"),
    );
    // Issue #3134: property_increment / property_shift control fields.
    const incrementByRaw = await this.getLiteralValue(
      subject,
      Namespace.EXOCMD.term("Grounding_incrementBy"),
    );
    const shiftDelta = await this.getLiteralValue(
      subject,
      Namespace.EXOCMD.term("Grounding_shiftDelta"),
    );
    let incrementBy: number | undefined;
    if (
      incrementByRaw !== undefined &&
      incrementByRaw !== null &&
      incrementByRaw !== ""
    ) {
      const parsed = Number.parseInt(String(incrementByRaw), 10);
      if (Number.isFinite(parsed)) {
        incrementBy = parsed;
      }
    }

    // RFC v2 Phase 3a — declarative ref-form. Multi-valued list of
    // `exocmd__PropertyDefault` assets attached via `Grounding_propertyDefault`.
    // The legacy JSON-literal `Grounding_propertyDefaults` (plural) parser and
    // its coexistence guard were removed in RFC v2 Phase 5 (#3167) after the
    // vault migration to ref-form completed (Phase 4a, #3165).
    const propertyDefault = await this.resolvePropertyDefaults(subject, uid);
    // RFC v2 Phase 3a — multi-valued list of `exocmd__InheritanceRule` assets
    // attached via `Grounding_inheritanceRule`. Phase 3b executor applies them.
    const inheritanceRule = await this.resolveInheritanceRules(subject, uid);

    // RFC v2 Phase 5 (#3167) — transitional deprecation warn for hand-edited /
    // third-party Groundings still carrying the legacy JSON-literal predicate.
    // The value is silently dropped (parser is gone), so log once per
    // Grounding-uid so the behavior change surfaces audibly rather than as a
    // missing-default silent regression. Remove after one minor release.
    const legacyPropertyDefaultsRaw = await this.getLiteralValue(
      subject,
      Namespace.EXOCMD.term("Grounding_propertyDefaults"),
    );
    if (
      legacyPropertyDefaultsRaw !== null &&
      legacyPropertyDefaultsRaw !== "" &&
      !this._legacyPropertyDefaultsWarnedGroundings.has(uid)
    ) {
      this.logger.warn(
        `Grounding ${uid}: deprecated exocmd__Grounding_propertyDefaults (plural) JSON predicate detected — the parser was removed in RFC v2 Phase 5 (#3167); value is ignored. Migrate to ref-form exocmd__Grounding_propertyDefault (singular) pointing to exocmd__PropertyDefault assets. See vault TBox c8f87363-d39c-45cb-9d4d-1be96d70f892 for the canonical replacement.`,
      );
      this._legacyPropertyDefaultsWarnedGroundings.add(uid);
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
          inputSchema = Object.entries(
            parsed.properties as Record<string, Record<string, unknown>>,
          ).map(([name, prop]) => {
            const rawType = prop.type;
            const fieldType = rawType === "string" ? "text" : rawType;
            const rawDefault =
              prop.defaultValue !== undefined
                ? prop.defaultValue
                : prop.default;
            const field: Record<string, unknown> = {
              name,
              type: fieldType,
              label: prop.title ?? name,
              required:
                Array.isArray(parsed.required) &&
                parsed.required.includes(name),
            };
            if (rawDefault !== undefined && rawDefault !== null) {
              field.defaultValue = String(rawDefault);
            }
            // T1 "Create Instance" (project bbe40f8c): an `assetRef` field may
            // declare `targetClassUid` so the form's fuzzy reference-picker can
            // fetch candidate instances of that class (e.g. the ontology picker
            // targets exo__Ontology). Generic — parameterises the reusable
            // picker by class. Propagated verbatim for the plugin form layer.
            if (typeof prop.targetClassUid === "string") {
              field.targetClassUid = prop.targetClassUid;
            }
            return field;
          });
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

    // RFC ce27e55d: substitution-token template для auto-label при one-click
    // (когда нет inputSchema modal). Resolved at execution time by
    // `GroundingExecutor.substituteVariables` — supports `$target`,
    // `$target.<prop>`, `$nowCompact`, etc.
    const labelTemplate = await this.getLiteralValue(
      subject,
      Namespace.EXOCMD.term("Grounding_labelTemplate"),
    );

    // RFC 36347daf Phase 2: direction facet for workflow_transition
    // groundings. Literal xsd:string {"forward","rollback"}; defaults to
    // "forward" at dispatch time when omitted. Ignored by other types.
    const directionRaw = await this.getLiteralValue(
      subject,
      Namespace.EXOCMD.term("Grounding_direction"),
    );
    let direction: "forward" | "rollback" | undefined;
    if (directionRaw !== null && directionRaw !== undefined) {
      const normalized = String(directionRaw).trim().toLowerCase();
      if (normalized === "forward" || normalized === "rollback") {
        direction = normalized;
      } else if (normalized !== "") {
        this.logger.warn(
          `Grounding ${uid}: exocmd__Grounding_direction value '${directionRaw}' is not 'forward' or 'rollback' — treating as undefined (will default to 'forward' at dispatch).`,
        );
      }
    }

    // Subproject 17f58ebe Веха 3 — body_template grounding fields. bodyTemplate
    // is the inline markdown literal; templateRef points at an
    // exotemplate__Template asset (UID-canon → its obsidian name is the UID).
    const bodyTemplate = await this.getLiteralValue(
      subject,
      Namespace.EXOCMD.term("Grounding_bodyTemplate"),
    );
    const templateRef = await this.getObsidianName(
      subject,
      Namespace.EXOCMD.term("Grounding_templateRef"),
    );

    // req 915b20b2 — create_instance target-body clone flag. Boolean coercion
    // mirrors `prefillLabelWithDate` (tolerates `true` boolean or `"true"`
    // literal). MUST be read HERE (the production loader) — the sibling
    // GroundingFrontmatterParser has no production consumers (CLI BDD/tests
    // only), so reading it there alone leaves the flag inert in every real
    // apply (plugin button + CLI both go through CommandResolver.loadCommand).
    const cloneTargetBodyRaw = await this.getLiteralValue(
      subject,
      Namespace.EXOCMD.term("Grounding_cloneTargetBody"),
    );
    const cloneTargetBody =
      cloneTargetBodyRaw !== null &&
      String(cloneTargetBodyRaw).trim().toLowerCase() === "true";

    // Issue #3867 — composite-step opt-in: mutate the just-created instance
    // instead of the click-target. Boolean coercion mirrors `cloneTargetBody`.
    // MUST be read HERE (the production loader — plugin button + CLI both go
    // through CommandResolver.loadCommand); the sibling GroundingFrontmatterParser
    // has no production consumers.
    const targetsCreatedInstanceRaw = await this.getLiteralValue(
      subject,
      Namespace.EXOCMD.term("Grounding_targetsCreatedInstance"),
    );
    const targetsCreatedInstance =
      targetsCreatedInstanceRaw !== null &&
      String(targetsCreatedInstanceRaw).trim().toLowerCase() === "true";

    const grounding: GroundingDefinition = {
      id: uid,
      label,
      type,
      targetProperty: targetProperty ?? undefined,
      targetValueRef: targetValueRef ?? undefined,
      targetValueLiteral: targetValueLiteral ?? undefined,
      targetValueSubstitution: targetValueSubstitution ?? undefined,
      targetValueQuery: targetValueQuery ?? undefined,
      serviceCallPayload: serviceCallPayload ?? undefined,
      appendExpression: appendExpression ?? undefined,
      sparqlUpdate: sparqlUpdate ?? undefined,
      steps,
      targetClass: targetClass ?? undefined,
      targetPrototype: targetPrototype ?? undefined,
      targetFolder: targetFolder ?? undefined,
      linkBackProperty: linkBackProperty ?? undefined,
      incrementBy,
      shiftDelta: shiftDelta ?? undefined,
      propertyDefault: propertyDefault.length > 0 ? propertyDefault : undefined,
      inheritanceRule: inheritanceRule.length > 0 ? inheritanceRule : undefined,
      isDefinedBy: isDefinedBy ?? undefined,
      prefillLabelWithDate: prefillLabelWithDate || undefined,
      labelTemplate: labelTemplate ?? undefined,
      direction,
      bodyTemplate: bodyTemplate ?? undefined,
      templateRef: templateRef ?? undefined,
      cloneTargetBody: cloneTargetBody || undefined,
      targetsCreatedInstance: targetsCreatedInstance || undefined,
    };

    if (inputSchema) {
      (
        grounding as GroundingDefinition & { inputSchema: unknown[] }
      ).inputSchema = inputSchema;
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

  // ────────────────────────────────────────────────────────────────────────
  // RFC v2 Phase 3a — ref-form Grounding extensions (Phase 3b executor wires)
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Resolve the multi-valued `exocmd__Grounding_propertyDefault` predicate
   * into a list of {@link PropertyDefaultResolved} entries.
   *
   * Each referenced `exocmd__PropertyDefault` asset must carry:
   *   - `exocmd__PropertyDefault_property` → wikilink to an `exo__Property`
   *     asset; resolved to that property's `exo__Asset_label`.
   *   - `exocmd__PropertyDefault_value` → wikilink to the value asset; if the
   *     value asset is a SubstitutionToken instance, its
   *     `exocmd__SubstitutionToken_resolver` is invoked (today / todayStart
   *     resolve at parse time; targetFolder / target emit a marker for the
   *     Phase 3b executor). Otherwise the value is emitted as
   *     wikilink-form `"[[<UID>]]"`.
   *
   * Refs that cannot be resolved (target asset missing, property has no
   * label) are skipped with a `logger.warn` — never silently dropped, never
   * fail-loud (would mask other valid PropertyDefault entries on the same
   * Grounding).
   */
  private async resolvePropertyDefaults(
    grounding: IRI,
    groundingUid: string,
  ): Promise<PropertyDefaultResolved[]> {
    const groundingPDs = await this.resolvePropertyDefaultsForSubject(
      grounding,
      groundingUid,
      Namespace.EXOCMD.term("Grounding_propertyDefault"),
    );

    // RFC 727572d2 — merge Universal Default Template entries. Grounding
    // entries override Universal by `propertyName` key. Universal singleton
    // is loaded once per CommandResolver instance via lazy session cache.
    const universal = await this.getUniversalCache();
    if (universal && universal.propertyDefaults.length > 0) {
      return mergePropertyDefaults(universal.propertyDefaults, groundingPDs);
    }
    return groundingPDs;
  }

  /**
   * Generalised PropertyDefault resolver — applies the same per-asset
   * resolution logic to entries reached via any predicate (originally only
   * `Grounding_propertyDefault`; extended in RFC 727572d2 to also serve
   * `Template_propertyDefault` on the Universal Default Template singleton).
   *
   * `contextUid` appears in warn messages so missing/broken refs are
   * attributable to the originating Grounding OR the Universal Template.
   */
  private async resolvePropertyDefaultsForSubject(
    subject: IRI,
    contextUid: string,
    refPredicate: IRI,
  ): Promise<PropertyDefaultResolved[]> {
    const refTriples = await this.tripleStore.match(
      subject,
      refPredicate,
      undefined,
    );

    const resolved: PropertyDefaultResolved[] = [];
    for (const triple of refTriples) {
      const refSubject = await this.resolveRefTripleObject(triple.object);
      if (!refSubject) continue;

      // -- property → exo__Asset_label of the referenced exo__Property
      const propertyRefUid = await this.getObsidianName(
        refSubject,
        Namespace.EXOCMD.term("PropertyDefault_property"),
      );
      if (!propertyRefUid) {
        this.logger.warn(
          `Grounding ${contextUid}: PropertyDefault asset missing exocmd__PropertyDefault_property — entry skipped.`,
        );
        continue;
      }
      const propertyName = this.looksLikeUUID(propertyRefUid)
        ? await this.resolveLabelByUID(propertyRefUid)
        : propertyRefUid;
      if (!propertyName) {
        this.logger.warn(
          `Grounding ${contextUid}: PropertyDefault property UID '${propertyRefUid}' is not resolvable to exo__Asset_label — entry skipped.`,
        );
        continue;
      }

      // -- value → either SubstitutionToken-resolved string, or wikilink form
      const valueRefUid = await this.getObsidianName(
        refSubject,
        Namespace.EXOCMD.term("PropertyDefault_value"),
      );
      if (!valueRefUid) {
        this.logger.warn(
          `Grounding ${contextUid}: PropertyDefault '${propertyName}' missing exocmd__PropertyDefault_value — entry skipped.`,
        );
        continue;
      }

      const value = await this.resolvePropertyDefaultValue(
        valueRefUid,
        contextUid,
        propertyName,
      );
      if (value === null) continue;

      resolved.push({ propertyName, value });
    }
    return resolved;
  }

  /**
   * RFC 727572d2 — Universal Default Template singleton lazy loader. Returns
   * the cached UniversalDefaultTemplate or null when:
   *   - Singleton asset not in vault (cold-start race or absent)
   *   - Loader threw (logged once, falls back to null)
   *
   * The session-level cache is populated on first call; vault file-watcher
   * adapters may call {@link clearUniversalDefault} to invalidate after a
   * Universal Template asset change.
   *
   * Universal singleton lookup is in-band — finds first asset whose
   * `exo__Instance_class` includes the UniversalDefaultTemplate class UID
   * (29e2c8f8) or IRI form. Multiple singletons → deterministic selection by
   * lexicographic UID order with a warn.
   */
  private async getUniversalCache(): Promise<UniversalDefaultTemplate | null> {
    if (this._universalCacheReady) return this._universalCacheValue;
    this._universalCacheReady = true;

    // External loader takes precedence (lets host wire a cheaper lookup
    // path, e.g. via metadataCache rather than triple-store scan).
    const external = await loadUniversalDefault();
    if (external) {
      this._universalCacheValue = external;
      return external;
    }

    // In-store fallback: scan triple store for the singleton.
    const singletonIRI = await this.findUniversalSingleton();
    if (!singletonIRI) {
      this._universalCacheValue = null;
      return null;
    }
    const pd = await this.resolvePropertyDefaultsForSubject(
      singletonIRI,
      UNIVERSAL_DEFAULT_TEMPLATE_CTX,
      Namespace.EXOCMD.term("Template_propertyDefault"),
    );
    const ir = await this.resolveInheritanceRulesForSubject(
      singletonIRI,
      UNIVERSAL_DEFAULT_TEMPLATE_CTX,
      Namespace.EXOCMD.term("Template_inheritanceRule"),
    );
    this._universalCacheValue = {
      propertyDefaults: pd,
      inheritanceRules: ir,
    };
    return this._universalCacheValue;
  }

  /**
   * RFC 727572d2 — locate the UniversalDefaultTemplate singleton ABox
   * instance via triple store scan. Returns first match; warns and picks
   * lexicographically smallest UID when multiple are found.
   */
  private async findUniversalSingleton(): Promise<IRI | null> {
    const templateClassIRI = Namespace.EXOCMD.term(
      "UniversalDefaultTemplate",
    ).value;
    const classTriples = await this.tripleStore.match(
      undefined,
      Namespace.EXO.term("Instance_class"),
      undefined,
    );
    const candidates: IRI[] = [];
    for (const t of classTriples) {
      let match = false;
      if (t.object instanceof IRI) {
        match =
          t.object.value === templateClassIRI ||
          t.object.value.includes(UNIVERSAL_DEFAULT_TEMPLATE_CLASS_UID);
      } else if (t.object instanceof Literal) {
        const unwrapped = this.unwrapWikilink(t.object.value);
        match =
          unwrapped === "exocmd__UniversalDefaultTemplate" ||
          unwrapped === UNIVERSAL_DEFAULT_TEMPLATE_CLASS_UID;
      }
      if (match && t.subject instanceof IRI) candidates.push(t.subject);
    }
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];
    candidates.sort((a, b) => a.value.localeCompare(b.value));
    this.logger.warn(
      `Multiple UniversalDefaultTemplate singletons found (${candidates.length}); selecting deterministically by lexicographic UID order: ${candidates[0].value}`,
    );
    return candidates[0];
  }

  /**
   * Resolve the multi-valued `exocmd__Grounding_inheritanceRule` predicate
   * into a list of {@link InheritanceRuleResolved} entries.
   *
   * Each `exocmd__InheritanceRule` asset declares 5 properties:
   *   - `InheritanceRule_sourceProperty`  (REQUIRED — UID → label)
   *   - `InheritanceRule_targetProperty`  (REQUIRED — UID → label)
   *   - `InheritanceRule_targetClassCondition` (optional — UID → label)
   *   - `InheritanceRule_targetClassExclusion` (optional, multi-valued — list of UIDs → labels)
   *   - `InheritanceRule_priority`  (xsd:integer literal; defaults to 50)
   *
   * Missing REQUIRED fields cause the entry to be skipped with a warn;
   * optional fields default to absent/empty/50.
   */
  private async resolveInheritanceRules(
    grounding: IRI,
    groundingUid: string,
  ): Promise<InheritanceRuleResolved[]> {
    const groundingIRs = await this.resolveInheritanceRulesForSubject(
      grounding,
      groundingUid,
      Namespace.EXOCMD.term("Grounding_inheritanceRule"),
    );

    // RFC 727572d2 — merge Universal Default Template entries.
    const universal = await this.getUniversalCache();
    if (universal && universal.inheritanceRules.length > 0) {
      return mergeInheritanceRules(universal.inheritanceRules, groundingIRs);
    }
    return groundingIRs;
  }

  /**
   * Generalised InheritanceRule resolver — applies the same per-asset
   * resolution logic to entries reached via any predicate (originally only
   * `Grounding_inheritanceRule`; extended in RFC 727572d2 to also serve
   * `Template_inheritanceRule` on the Universal Default Template singleton).
   */
  private async resolveInheritanceRulesForSubject(
    subject: IRI,
    contextUid: string,
    refPredicate: IRI,
  ): Promise<InheritanceRuleResolved[]> {
    const refTriples = await this.tripleStore.match(
      subject,
      refPredicate,
      undefined,
    );

    const resolved: InheritanceRuleResolved[] = [];
    const groundingUid = contextUid;
    for (const triple of refTriples) {
      const refSubject = await this.resolveRefTripleObject(triple.object);
      if (!refSubject) continue;

      const sourcePropertyName = await this.resolveLabelRef(
        refSubject,
        Namespace.EXOCMD.term("InheritanceRule_sourceProperty"),
      );
      if (!sourcePropertyName) {
        this.logger.warn(
          `Grounding ${groundingUid}: InheritanceRule missing/unresolvable exocmd__InheritanceRule_sourceProperty — entry skipped.`,
        );
        continue;
      }

      const targetPropertyName = await this.resolveLabelRef(
        refSubject,
        Namespace.EXOCMD.term("InheritanceRule_targetProperty"),
      );
      if (!targetPropertyName) {
        this.logger.warn(
          `Grounding ${groundingUid}: InheritanceRule missing/unresolvable exocmd__InheritanceRule_targetProperty — entry skipped.`,
        );
        continue;
      }

      // HIGH fix (PR #3224 review, 2026-05-22): distinguish "no triple authored"
      // from "broken ref" for optional class predicates. If the triple exists
      // but resolution fails, scope of the rule changes — for exclusion in
      // particular, dropping a broken excluded class makes the rule apply to
      // MORE classes than authored (asymmetric failure direction). Safer:
      // skip the entire rule on data-integrity issues.
      const conditionTriples = await this.tripleStore.match(
        refSubject,
        Namespace.EXOCMD.term("InheritanceRule_targetClassCondition"),
        undefined,
      );
      let targetClassCondition: string | undefined = undefined;
      let targetClassConditionUid: string | undefined = undefined;
      if (conditionTriples.length > 0) {
        // Issue #3562: extract the condition ref directly (UID-canon when the
        // wikilink points to a UUID-named class TBox). Previously this resolved
        // straight to a label via `resolveLabelRef` and skipped the ENTIRE rule
        // when label resolution failed — which happens right after
        // `Apply profile` materialises the class TBox before the triple store
        // / metadataCache have indexed it, masking the #3555 fix. We now keep
        // the UID so the executor can match it UID↔UID without the lagging
        // resolver; the label is resolved best-effort (for legacy label-form
        // targets) and its failure no longer drops the rule.
        const refName = await this.getObsidianName(
          refSubject,
          Namespace.EXOCMD.term("InheritanceRule_targetClassCondition"),
        );
        // A nameless/blank ref (no parseable name — e.g. an empty- or
        // whitespace-only literal object) genuinely cannot anchor the
        // condition; retaining it would make the rule unconditional (scope
        // broadening), so skip the entire rule (PR #3224 safety). `.trim()`
        // hardens against `unwrapWikilink` ever surfacing a whitespace-only
        // name (today it already trims to "").
        if (!refName || !refName.trim()) {
          this.logger.warn(
            `Grounding ${groundingUid}: InheritanceRule has exocmd__InheritanceRule_targetClassCondition triple but ref is unresolvable — entire rule skipped (would otherwise apply unconditionally, broadening scope).`,
          );
          continue;
        }
        if (this.looksLikeUUID(refName)) {
          targetClassConditionUid = refName;
          targetClassCondition =
            (await this.resolveLabelByUID(refName)) ?? undefined;
        } else {
          // Legacy label-form condition (e.g. `[[ems__Area]]` / `ems__Area`).
          targetClassCondition = refName;
        }
      }

      const exclusionTriples = await this.tripleStore.match(
        refSubject,
        Namespace.EXOCMD.term("InheritanceRule_targetClassExclusion"),
        undefined,
      );
      const targetClassExclusion: string[] = [];
      const targetClassExclusionUids: string[] = [];
      let exclusionBroken = false;
      for (const triple of exclusionTriples) {
        let name: string | null = null;
        if (triple.object instanceof IRI) {
          name =
            this.iriToObsidianName(triple.object.value) ?? triple.object.value;
        } else if (triple.object instanceof Literal) {
          name = this.unwrapWikilink(triple.object.value);
        }
        if (!name) {
          exclusionBroken = true;
          continue;
        }
        // Issue #3562: same UID-canon treatment as the condition. A UUID-form
        // exclusion is enforced via its UID even when the label can't be
        // resolved (post-apply lag) — dropping it would broaden the rule's
        // scope, so keeping the UID-only exclusion is the safe direction.
        if (this.looksLikeUUID(name)) {
          targetClassExclusionUids.push(name);
          const label = await this.resolveLabelByUID(name);
          if (label) targetClassExclusion.push(label);
        } else {
          targetClassExclusion.push(name);
        }
      }
      if (exclusionBroken) {
        this.logger.warn(
          `Grounding ${groundingUid}: InheritanceRule has unresolvable exocmd__InheritanceRule_targetClassExclusion entry — entire rule skipped (would otherwise expand scope by silently dropping the excluded class).`,
        );
        continue;
      }

      const priorityRaw = await this.getLiteralValue(
        refSubject,
        Namespace.EXOCMD.term("InheritanceRule_priority"),
      );
      let priority = 50;
      if (priorityRaw !== null && priorityRaw !== "") {
        const parsed = Number.parseInt(String(priorityRaw), 10);
        if (Number.isFinite(parsed)) {
          priority = parsed;
        }
      }

      resolved.push({
        sourcePropertyName,
        targetPropertyName,
        targetClassCondition,
        targetClassConditionUid,
        targetClassExclusion,
        targetClassExclusionUids,
        priority,
      });
    }
    return resolved;
  }

  /**
   * Helper: given a triple object that points to another asset (IRI or
   * literal wikilink), resolve it to the asset's subject IRI in the store.
   *
   * Mirrors `loadCompositeSteps`' pattern: accept either IRI (direct) or
   * Literal (UUID wikilink → `findSubjectByUID`).
   */
  private async resolveRefTripleObject(object: unknown): Promise<IRI | null> {
    if (object instanceof IRI) return object;
    if (object instanceof Literal) {
      const uid = this.normalizeWikilink(object.value);
      if (!uid) return null;
      return this.findSubjectByUID(uid);
    }
    return null;
  }

  /**
   * Helper: read a single wikilink predicate, resolve it to the referenced
   * asset's `exo__Asset_label`. UUID short-name path returns the asset label
   * via `resolveLabelByUID`; non-UUID short-name is treated as already-symbolic
   * (legacy authoring) and returned unchanged.
   */
  private async resolveLabelRef(
    subject: IRI,
    predicate: IRI,
  ): Promise<string | null> {
    const refUid = await this.getObsidianName(subject, predicate);
    if (!refUid) return null;
    if (!this.looksLikeUUID(refUid)) return refUid;
    return this.resolveLabelByUID(refUid);
  }

  /**
   * Resolve the value side of a PropertyDefault entry. If the value asset is
   * a SubstitutionToken instance, dispatch via the resolver registry; else
   * emit wikilink-form `"[[<UID>]]"`.
   *
   * Returns `null` to signal "skip this entry" (e.g. value asset has no
   * SubstitutionToken_resolver despite being typed as one — fail-loud per
   * the brief).
   */
  private async resolvePropertyDefaultValue(
    valueRefUid: string,
    groundingUid: string,
    propertyName: string,
  ): Promise<string | null> {
    // Non-UUID-form values (legacy symbolic shape) pass through as wikilinks.
    if (!this.looksLikeUUID(valueRefUid)) {
      return `"[[${valueRefUid}]]"`;
    }

    const valueSubject = await this.findSubjectByUID(valueRefUid);
    if (!valueSubject) {
      // Asset not in store yet (cold-start race / pruned vault) — emit
      // wikilink anyway; downstream UI / executor renders it as a dead link.
      return `"[[${valueRefUid}]]"`;
    }

    // RFC 727572d2 — TokenInvocation wrapper detection. When the value asset
    // is a TokenInvocation, unwrap it: read its `_token` ref (giving the
    // underlying SubstitutionToken) and `_parameter` literal, then emit a
    // parameterised marker for execute-time resolution.
    const isTokenInvocation = await this.assetIsTokenInvocation(valueSubject);
    if (isTokenInvocation) {
      return this.resolveTokenInvocation(
        valueSubject,
        valueRefUid,
        groundingUid,
        propertyName,
      );
    }

    const isSubstitutionToken =
      await this.assetIsSubstitutionToken(valueSubject);
    if (!isSubstitutionToken) {
      return `"[[${valueRefUid}]]"`;
    }

    return this.dispatchSubstitutionToken(
      valueSubject,
      valueRefUid,
      groundingUid,
      propertyName,
      undefined,
    );
  }

  /**
   * RFC 727572d2 — common dispatch path for both bare SubstitutionToken refs
   * (no parameter) and TokenInvocation-wrapped refs (with parameter literal).
   *
   * Reads the SubstitutionToken's `_resolver` literal, validates it against
   * the TS-side allow list, then either bakes the value at parse time
   * (context-independent resolvers) or emits a marker for execute-time
   * resolution (context-dependent resolvers + all parameterised ones).
   */
  private async dispatchSubstitutionToken(
    tokenSubject: IRI,
    tokenUid: string,
    groundingUid: string,
    propertyName: string,
    parameter: string | undefined,
  ): Promise<string | null> {
    const resolverIdRaw = await this.getLiteralValue(
      tokenSubject,
      Namespace.EXOCMD.term("SubstitutionToken_resolver"),
    );
    if (!resolverIdRaw || !resolverIdRaw.trim()) {
      this.logger.warn(
        `Grounding ${groundingUid}: PropertyDefault '${propertyName}' references SubstitutionToken '${tokenUid}' with no exocmd__SubstitutionToken_resolver — falling back to wikilink form.`,
      );
      return `"[[${tokenUid}]]"`;
    }
    const resolverId = resolverIdRaw.trim();

    if (!KNOWN_SUBSTITUTION_RESOLVER_IDS.has(resolverId)) {
      this.logger.warn(
        `Grounding ${groundingUid}: PropertyDefault '${propertyName}' SubstitutionToken '${tokenUid}' declares unknown resolver-id '${resolverId}' — falling back to wikilink form. Known ids: ${Array.from(KNOWN_SUBSTITUTION_RESOLVER_IDS).join(", ")}.`,
      );
      return `"[[${tokenUid}]]"`;
    }

    // Parameterised resolvers always emit marker (parameter encoded inside).
    if (parameter !== undefined) {
      return buildParameterisedMarker(resolverId, tokenUid, parameter);
    }

    // Context-independent resolvers — invoke at parse time.
    if (PARSE_TIME_RESOLVERS.has(resolverId)) {
      return CommandResolver.parseTimeResolve(resolverId);
    }

    // Context-dependent resolvers — executor substitutes at runtime.
    return buildSubstitutionMarker(resolverId, tokenUid);
  }

  /**
   * RFC 727572d2 — parse-time dispatch table for context-independent
   * resolvers. Mirrors the production resolvers in
   * {@link SubstitutionResolverRegistry} for parity.
   */
  private static parseTimeResolve(resolverId: string): string {
    const d = new Date();
    const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
    switch (resolverId) {
      case "today":
        // req 5c47471a / #3807 — today's LOCAL calendar day, YYYY-MM-DD.
        // The former UTC form (`d.toISOString().slice(0,10)`) mis-fired just
        // after local midnight in a UTC+N timezone to YESTERDAY's local date.
        // Local `getFullYear()/getMonth()/getDate()` mirrors the registry
        // resolvers `date` (makeDateResolver(0)) and `tomorrow` (#3806), so
        // `$today` and `$date` now agree on the local calendar day.
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      case "tomorrow": {
        // req 915b20b2 / FIX-2 — the next LOCAL calendar day, YYYY-MM-DD.
        // Vision Lock 5: `$tomorrow` is a soft daily tickler that must advance
        // to the user's next LOCAL day. The former UTC form (setUTCDate +
        // toISOString) mis-fired a click just after local midnight in a UTC+N
        // timezone to the SAME local day (UTC was still the previous date).
        // Local `new Date(y, m, d+1)` arithmetic mirrors the registry resolver
        // `makeDateResolver(1, "YYYY-MM-DD")` (local getDate/setDate) in
        // SubstitutionResolverRegistry, so both `$tomorrow` paths now agree.
        const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
        return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
      }
      case "todayStart":
        // #3811 — today's LOCAL day at midnight, timezone-naive
        // `YYYY-MM-DDT00:00:00` (via `DateFormatter.getTodayStartTimestamp`),
        // matching the executor `$todayStart` (`${today}T00:00:00`), the
        // registry resolver, and the effort/timestamp frontmatter convention.
        // The former `new Date(...setHours(0,0,0,0)).toISOString()` emitted a
        // UTC Z-instant (`...T00:00:00.000Z`) — same instant, different string
        // shape that disagreed with the executor form.
        return DateFormatter.getTodayStartTimestamp();
      case "nowTimestamp":
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      case "nowDate":
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      case "nowYear":
        return String(d.getFullYear());
      case "nowMonth":
        return pad(d.getMonth() + 1);
      default:
        return "";
    }
  }

  /**
   * RFC 727572d2 — TokenInvocation unwrapping. Reads `_token` ref and
   * `_parameter` literal, dispatches the wrapped SubstitutionToken with the
   * literal parameter. Missing `_token` → skip with warn.
   */
  private async resolveTokenInvocation(
    invocationSubject: IRI,
    invocationUid: string,
    groundingUid: string,
    propertyName: string,
  ): Promise<string | null> {
    const tokenRefUid = await this.getObsidianName(
      invocationSubject,
      Namespace.EXOCMD.term("TokenInvocation_token"),
    );
    if (!tokenRefUid) {
      this.logger.warn(
        `Grounding ${groundingUid}: PropertyDefault '${propertyName}' TokenInvocation '${invocationUid}' missing exocmd__TokenInvocation_token — entry skipped.`,
      );
      return null;
    }
    const parameter =
      (await this.getLiteralValue(
        invocationSubject,
        Namespace.EXOCMD.term("TokenInvocation_parameter"),
      )) ?? "";

    if (!this.looksLikeUUID(tokenRefUid)) {
      this.logger.warn(
        `Grounding ${groundingUid}: PropertyDefault '${propertyName}' TokenInvocation '${invocationUid}' references non-UUID token '${tokenRefUid}' — entry skipped.`,
      );
      return null;
    }
    const tokenSubject = await this.findSubjectByUID(tokenRefUid);
    if (!tokenSubject) {
      this.logger.warn(
        `Grounding ${groundingUid}: PropertyDefault '${propertyName}' TokenInvocation '${invocationUid}' token ref '${tokenRefUid}' not found in store — entry skipped.`,
      );
      return null;
    }
    return this.dispatchSubstitutionToken(
      tokenSubject,
      tokenRefUid,
      groundingUid,
      propertyName,
      parameter,
    );
  }

  /**
   * RFC 727572d2 — detect whether `subject` is an instance of
   * `exocmd__TokenInvocation`. Symmetric to {@link assetIsSubstitutionToken}.
   */
  private async assetIsTokenInvocation(subject: IRI): Promise<boolean> {
    const classTriples = await this.tripleStore.match(
      subject,
      Namespace.EXO.term("Instance_class"),
      undefined,
    );
    for (const triple of classTriples) {
      if (triple.object instanceof IRI) {
        if (triple.object.value === TOKEN_INVOCATION_CLASS_IRI) return true;
        if (triple.object.value.includes(TOKEN_INVOCATION_CLASS_UID))
          return true;
      } else if (triple.object instanceof Literal) {
        const unwrapped = this.unwrapWikilink(triple.object.value);
        if (unwrapped === "exocmd__TokenInvocation") return true;
        if (unwrapped === TOKEN_INVOCATION_CLASS_UID) return true;
      }
    }
    return false;
  }

  /**
   * Detect whether `subject` is an instance of `exocmd__SubstitutionToken`.
   *
   * Primary path: iterate the asset's `exo__Instance_class` triples and
   * compare each to `SUBSTITUTION_TOKEN_CLASS_IRI` (NoteToRDFConverter
   * normalises every Instance_class triple to the namespace IRI regardless
   * of authoring shape — symbolic, UUID-canon, or full IRI — via
   * `valueToClassURI`).
   *
   * Fallback: when the class triple's object is a Literal wikilink (e.g.
   * `[[<UID>|exocmd__SubstitutionToken]]` shape that didn't fully expand),
   * unwrap to short-name and compare; or when the value is a bare UUID,
   * compare to `SUBSTITUTION_TOKEN_CLASS_UID`.
   */
  private async assetIsSubstitutionToken(subject: IRI): Promise<boolean> {
    const classTriples = await this.tripleStore.match(
      subject,
      Namespace.EXO.term("Instance_class"),
      undefined,
    );
    for (const triple of classTriples) {
      if (triple.object instanceof IRI) {
        if (triple.object.value === SUBSTITUTION_TOKEN_CLASS_IRI) return true;
        // Edge case: class IRI is the UUID-named TBox file URL itself.
        if (triple.object.value.includes(SUBSTITUTION_TOKEN_CLASS_UID))
          return true;
      } else if (triple.object instanceof Literal) {
        const unwrapped = this.unwrapWikilink(triple.object.value);
        if (unwrapped === "exocmd__SubstitutionToken") return true;
        if (unwrapped === SUBSTITUTION_TOKEN_CLASS_UID) return true;
      }
    }
    return false;
  }

  /**
   * RFC 9d20c91f Phase 4+1: wikilink-only resolution for `exocmd__Grounding_type`.
   *
   * Phase 1 added the `exocmd__GroundingType` catalog + 9 instances in the
   * shared `exoas-exocmd` submodule. Phase 3 migrated all ABox values from
   * literal-string form (`"property_set"`) to wikilink form (`"[[<uid>]]"`).
   * Phase 4 made wikilink the default; Phase 4+1 (this revision) removed the
   * `EXOCORTEX_GROUNDING_TYPE_BC` env-flag escape hatch entirely.
   *
   * Resolution priority:
   * 1. Triple object is IRI (post-Phase-3 ABox after vault sync) — map via
   *    `resolveGroundingTypeFromIRI` (symbolic class IRI OR file IRI fallback).
   * 2. Triple object is Literal in wikilink form `"[[<uid>]]"` — resolve via
   *    file-IRI form (defensive: NoteToRDFConverter may not substitute the
   *    wikilink to an IRI for non-class-keyed predicates).
   * 3. Any other Literal (bare-string legacy) — return null + emit a single
   *    warn (grounding inert, caller skips). The CLI audit subcommand
   *    `exocortex-cli audit grounding-type-literal-form` detects regressions.
   *
   * Returns `null` for unknown values (caller treats grounding as inert).
   */
  private async resolveGroundingTypeReference(
    subject: IRI,
  ): Promise<GroundingType | null> {
    const triples = await this.tripleStore.match(
      subject,
      Namespace.EXOCMD.term("Grounding_type"),
      undefined,
    );
    if (triples.length === 0) return null;

    const ref = triples[0].object;

    if (ref instanceof IRI) {
      return resolveGroundingTypeFromIRI(ref.value);
    }

    if (ref instanceof Literal) {
      const raw = ref.value;
      const wikilinkMatch = raw.match(
        /^\[\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\|[^\]]*)?\]\]$/i,
      );
      if (wikilinkMatch) {
        return resolveGroundingTypeFromIRI(
          `obsidian://vault/${wikilinkMatch[1].toLowerCase()}.md`,
        );
      }

      this.logger.warn(
        `[exocmd-grounding-type-literal-form] legacy literal-string form '${raw}' for exocmd__Grounding_type on <${subject.value}>. Migrate to wikilink form per RFC 9d20c91f Phase 3.`,
      );
      return null;
    }

    return null;
  }

  // -- Triple store helpers --

  /**
   * Expand a direct prototype reference into its transitive prototype chain
   * (@req:5ad0d6b4-2c9a-4375-bb5b-04e754861bec).
   *
   * Walks `exo__Asset_prototype` hop by hop through the triple store: each
   * hop resolves the current reference to its store subject via UID lookup
   * (bridging the dual reference forms — bare UID / wikilink / file-IRI —
   * that {@link normalizeWikilink} + {@link extractPathBasename} cover), then
   * reads that subject's own `exo__Asset_prototype`.
   *
   * Guards: a visited set (normalized, case-insensitive) breaks reference
   * cycles (A → B → A), and the walk is capped at {@link MAX_TRANSITIVE_DEPTH}
   * hops — a malformed vault can never hang resolution. Unresolvable hops
   * (prototype file absent from the store, non-UUID reference) terminate the
   * walk fail-open: the chain built so far still matches.
   *
   * @param prototypeRef - The target's direct `exo__Asset_prototype` reference
   *   (bare UID, wikilink, or file-IRI form).
   * @returns `[direct, parent, grandparent, …]` — the direct reference itself
   *   is element 0, preserving single-hop behavior. An empty/blank ref yields
   *   `[]` (no prototype matching — mirrors the legacy falsy-guard skip).
   */
  private async expandPrototypeChain(
    prototypeRef: string,
  ): Promise<readonly string[]> {
    // Legacy falsy-guard parity: an empty ref must NOT produce a chain [""]
    // that a pathological `targetPrototype: "[[]]"` binding could match
    // (PR #3804 review).
    if (!prototypeRef || !this.normalizeWikilink(prototypeRef)) return [];

    const chain: string[] = [prototypeRef];
    const visited = new Set<string>([
      this.normalizeWikilink(prototypeRef).toLowerCase(),
    ]);

    let current = prototypeRef;
    for (let hop = 0; hop < MAX_TRANSITIVE_DEPTH; hop++) {
      const uid = this.extractUuidFromRef(current);
      if (!uid) break;

      let parentRef: string | null = null;
      try {
        const subject = await this.findSubjectByUID(uid);
        if (!subject) break;
        parentRef = await this.getLinkedValue(
          subject,
          Namespace.EXO.term("Asset_prototype"),
        );
      } catch (error) {
        // fail-open: keep the chain built so far, but leave a diagnostic
        // trail — a silently shortened chain is a silently missing button
        // (PR #3804 review).
        this.logger.debug(
          this.capWarning(
            `[expandPrototypeChain] store lookup failed at hop ${hop} for '${current}': ${String(error)}`,
          ),
        );
        break;
      }
      if (!parentRef) break;

      const key = this.normalizeWikilink(parentRef).toLowerCase();
      if (visited.has(key)) break; // cycle guard
      visited.add(key);

      chain.push(parentRef);
      current = parentRef;
    }

    return chain;
  }

  /**
   * Extract a bare UUID from a prototype reference in any of its forms:
   * bare UUID, `[[uuid]]` / `[[uuid|alias]]` wikilink, or
   * `obsidian://vault/.../uuid.md` file-IRI (UUID-named asset).
   * Returns null when the reference carries no UUID (e.g. a label-named
   * legacy reference) — the chain walk stops there.
   */
  private extractUuidFromRef(ref: string): string | null {
    const normalized = this.normalizeWikilink(ref);
    if (this.looksLikeUUID(normalized)) return normalized;
    const basename = this.extractPathBasename(normalized);
    if (basename && this.looksLikeUUID(basename)) return basename;
    return null;
  }

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
      if (triple.object instanceof Literal && triple.object.value === uid) {
        return triple.subject as IRI;
      }
    }

    return null;
  }

  private async getLiteralValue(
    subject: IRI,
    predicate: IRI,
  ): Promise<string | null> {
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
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    );
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
   *
   * The helper does NOT type-check the resolved asset — it returns the
   * label of whatever asset bears the given UID. Callers are responsible
   * for ensuring the UID refers to an asset whose label is meaningful in
   * their context (e.g., a class file when expanding `exo__Instance_class`
   * UUID refs).
   */
  async resolveLabelByUID(uid: string): Promise<string | null> {
    const subject = await this.findSubjectByUID(uid);
    if (!subject) return null;
    return this.getLiteralValue(subject, Namespace.EXO.term("Asset_label"));
  }

  /**
   * Issue #3295 — Walk the `exo__Class_superClass` chain from `classRef`
   * and return the deduplicated set of transitive ancestor refs in BOTH
   * symbolic (e.g. `ems__Task`) and UID-canon (e.g. `1b20a8f0-...`) form.
   *
   * Motivation: `bindingMatches` does string-equality on `targetClass`
   * literals (e.g. `"ems__Task"`). Without an ancestor walk, an
   * `ems__Meeting` asset (declared `ems__Meeting ⊑ ems__Task` via
   * `exo__Class_superClass`) would never match a Task-targeted binding —
   * because the caller-side class array contains only the leaf
   * (`ems__Meeting`) plus the universal-root hardcode (`exo__Asset`).
   * Intermediate superclasses are silently dropped.
   *
   * The walk is cycle-safe (visited Set keyed on the class file IRI),
   * depth-bounded by `MAX_TRANSITIVE_DEPTH`, and consumes only the
   * already-populated triple store — no metadata-cache or DI wiring
   * changes required at the call site beyond invoking this method.
   *
   * Excludes the input `classRef` itself; callers are expected to keep
   * the leaf in their own array. Returns `[]` when the class is unknown
   * to the store, the chain is empty, or every parent IRI is malformed.
   *
   * @param classRef — Either a symbolic class name (`ems__Meeting`) or
   *                   the UID of the class file (`1b0a5e34-...`). Both
   *                   forms are resolved to the same file IRI subject.
   */
  async getClassAncestors(classRef: string): Promise<string[]> {
    const withDepth = await this.getClassAncestorsWithDepth(classRef);
    return withDepth.map((entry) => entry.ref);
  }

  /**
   * C3 capability-inheritance (RFC 78c2b7d0) — depth-aware variant of
   * {@link getClassAncestors}. Returns each transitive ancestor ref tagged with
   * its nearest BFS depth from `classRef` (direct superclass = 1, grandparent =
   * 2, …). Both symbolic (`ems__Task`) and UID-canon (`1b20a8f0-…`) forms of an
   * ancestor surface at the same depth so bindings authored in either form
   * match. The nearest-depth tag powers the `(priority, depth, order)`
   * sort-key (nearest-wins) in {@link resolveForAssetMulti}.
   *
   * The walk is cycle-safe (visited Set keyed on the class file IRI),
   * depth-bounded by `MAX_TRANSITIVE_DEPTH`, and consumes only the
   * already-populated triple store. Excludes the input `classRef` itself.
   * Returns `[]` (NOT cached — cold-start safety, Issue #3295) when the class
   * is unknown to the store.
   *
   * @param classRef — Either a symbolic class name (`ems__Meeting`) or the UID
   *                   of the class file. Both resolve to the same file IRI.
   */
  async getClassAncestorsWithDepth(
    classRef: string,
  ): Promise<Array<{ ref: string; depth: number }>> {
    const cached = this._ancestorDepthCache.get(classRef);
    if (cached) return cached;

    const result = new Map<string, number>(); // ref → nearest BFS depth
    const visited = new Set<string>();
    const seedFileIRI = await this.resolveClassFileIRI(classRef);
    if (!seedFileIRI) {
      // Deliberately NOT cached: a null `seedFileIRI` means the class
      // file is not yet in the triple store. During cold-start the
      // `LazyAssetGraphLoader` populates TBox asynchronously and the
      // global `invalidateCache()` reindex hook fires only after the
      // eager-init promise completes. Caching `[]` here would lock the
      // broken empty result across renders that fire in the window
      // before that completion → subclass-to-superclass bindings stay
      // silently absent (the exact regression Issue #3295 fixes).
      // The wasted cost on retry is one label-scan via
      // `findUidByLabel` per leaf class per render — accepted.
      return [];
    }

    // Track the input class's own symbolic + UID forms so they NEVER
    // appear in the result, even if the chain is cyclic
    // (`A ⊑ B ⊑ A` would otherwise surface `A` as its own ancestor on
    // the second hop). Callers already keep the leaf in their own array.
    const excluded = new Set<string>([classRef]);
    const seedUid = await this.getLiteralValue(
      seedFileIRI,
      Namespace.EXO.term("Asset_uid"),
    );
    if (seedUid) excluded.add(seedUid);
    const seedLabel = await this.getLiteralValue(
      seedFileIRI,
      Namespace.EXO.term("Asset_label"),
    );
    if (seedLabel) excluded.add(seedLabel);

    // Record an ancestor ref at its nearest depth. BFS first-reach is the
    // minimum depth, but `setMin` is explicit so a later shorter path (diamond)
    // never loses to an earlier longer one.
    const setMin = (ref: string, depth: number): void => {
      if (excluded.has(ref)) return;
      const current = result.get(ref);
      if (current === undefined || depth < current) result.set(ref, depth);
    };

    const queue: Array<{ fileIRI: IRI; depth: number }> = [
      { fileIRI: seedFileIRI, depth: 0 },
    ];

    while (queue.length > 0) {
      const head = queue.shift();
      if (!head) break;
      const { fileIRI, depth } = head;
      if (depth >= MAX_TRANSITIVE_DEPTH) continue;
      if (visited.has(fileIRI.value)) continue;
      visited.add(fileIRI.value);

      const parentTriples = await this.tripleStore.match(
        fileIRI,
        Namespace.EXO.term("Class_superClass"),
        undefined,
      );

      for (const triple of parentTriples) {
        const obj = triple.object;
        if (!(obj instanceof IRI)) continue;

        // Two forms are possible: namespace IRI (e.g.
        // `https://exocortex.my/ontology/ems#Task` — emitted by
        // `valueToRDFObject` for UUID-wikilink class refs that resolve
        // to a labelled class file) OR file IRI
        // (e.g. `obsidian://vault/.../<uid>.md` — fallback when the
        // class file has no namespace-derivable label, Issue #3242).
        // `iriToObsidianName` returns the `prefix__local` symbolic
        // form for namespace IRIs and the bare UUID basename for file
        // IRIs; both go into the result so caller arrays match
        // either form of binding (symbolic targetClass like
        // `"ems__Task"` AND UID-form `"[[<uid>]]"`).
        const parentDepth = depth + 1;
        const isFileIRI = obj.value.startsWith("obsidian://vault/");
        const parentRef = this.iriToObsidianName(obj.value);
        if (parentRef) setMin(parentRef, parentDepth);

        // Map back to file IRI (the BFS-walkable subject form) so we
        // can recurse. Symbolic-namespace IRIs are NOT themselves
        // subjects of `exo__Class_superClass` triples — the file IRI
        // of the class file is.
        let parentFileIRI: IRI | null = null;
        if (isFileIRI) {
          parentFileIRI = obj;
        } else if (parentRef) {
          parentFileIRI = await this.resolveClassFileIRI(parentRef);
        }

        if (!parentFileIRI) continue;

        // Surface the UID form alongside the symbolic name so caller
        // arrays satisfying UUID-form bindings (post-UID-canon) also
        // match transitively.
        const parentUid = await this.getLiteralValue(
          parentFileIRI,
          Namespace.EXO.term("Asset_uid"),
        );
        if (parentUid) setMin(parentUid, parentDepth);

        if (!visited.has(parentFileIRI.value)) {
          queue.push({ fileIRI: parentFileIRI, depth: parentDepth });
        }
      }
    }

    const ancestors = Array.from(result.entries()).map(([ref, depth]) => ({
      ref,
      depth,
    }));
    this._ancestorDepthCache.set(classRef, ancestors);
    return ancestors;
  }

  /**
   * Issue #3295 helper — resolve a class ref (symbolic name OR UID) to
   * the file IRI subject under which `exo__Class_superClass` triples are
   * stored. Returns `null` when the class is unknown to the store.
   */
  private async resolveClassFileIRI(classRef: string): Promise<IRI | null> {
    if (this.looksLikeUUID(classRef)) {
      return this.findSubjectByUID(classRef);
    }
    const uid = await this.findUidByLabel(classRef);
    if (!uid) return null;
    return this.findSubjectByUID(uid);
  }

  /**
   * Reverse-direction lookup: given an `exo__Asset_label` literal value
   * (e.g. `"ems__Task"`), find the matching asset's `exo__Asset_uid` in
   * the triple store. Used by `loadGroundingDefinition` (#3212) to
   * substitute the canonical UID when `Grounding_targetClass` is stored
   * as a plain short-name literal or wikilink-to-label rather than as
   * a UUID wikilink. Returns null when no asset bears that label or
   * the labelled asset has no UID literal.
   */
  private async findUidByLabel(label: string): Promise<string | null> {
    const labelTriples = await this.tripleStore.match(
      undefined,
      Namespace.EXO.term("Asset_label"),
      undefined,
    );
    for (const triple of labelTriples) {
      if (
        triple.object instanceof Literal &&
        triple.object.value === label &&
        triple.subject instanceof IRI
      ) {
        const uidTriples = await this.tripleStore.match(
          triple.subject,
          Namespace.EXO.term("Asset_uid"),
          undefined,
        );
        if (uidTriples.length > 0 && uidTriples[0].object instanceof Literal) {
          return uidTriples[0].object.value;
        }
      }
    }
    return null;
  }

  private async getLinkedUID(
    subject: IRI,
    predicate: IRI,
  ): Promise<string | null> {
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

  /**
   * C3 capability-inheritance (RFC 78c2b7d0) — multi-valued variant of
   * {@link getLinkedUID}. Resolves EVERY object of `predicate` to the linked
   * asset's UID (IRI → its `Asset_uid` or path basename; Literal → normalised
   * wikilink). Used for `exocmd__CommandBinding_overrides`, which may list
   * several target bindings. Returns `[]` when the predicate is absent.
   */
  private async getLinkedUIDs(subject: IRI, predicate: IRI): Promise<string[]> {
    const triples = await this.tripleStore.match(subject, predicate, undefined);
    const uids: string[] = [];
    for (const triple of triples) {
      const obj = triple.object;
      if (obj instanceof IRI) {
        const uidTriples = await this.tripleStore.match(
          obj,
          Namespace.EXO.term("Asset_uid"),
          undefined,
        );
        if (uidTriples.length > 0 && uidTriples[0].object instanceof Literal) {
          uids.push(uidTriples[0].object.value);
        } else {
          const fromPath = obj.value.split("/").pop()?.replace(".md", "");
          if (fromPath) uids.push(fromPath);
        }
      } else if (obj instanceof Literal) {
        const uid = this.normalizeWikilink(obj.value);
        if (uid) uids.push(uid);
      }
    }
    return uids;
  }

  private async getLinkedValue(
    subject: IRI,
    predicate: IRI,
  ): Promise<string | null> {
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
  private async getObsidianName(
    subject: IRI,
    predicate: IRI,
  ): Promise<string | null> {
    const triples = await this.tripleStore.match(subject, predicate, undefined);
    if (triples.length === 0) return null;

    const obj = triples[0].object;
    if (obj instanceof Literal) return this.unwrapWikilink(obj.value);
    if (obj instanceof IRI)
      return this.iriToObsidianName(obj.value) ?? obj.value;
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
  private async getObsidianWikilinkValue(
    subject: IRI,
    predicate: IRI,
  ): Promise<string | null> {
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
    const match = value.match(
      /\[\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]\]/,
    );
    if (!match) return value;

    const uuid = match[1];
    const assetSubject = await this.findSubjectByUID(uuid);
    if (!assetSubject) return value;

    const label = await this.getLiteralValue(
      assetSubject,
      Namespace.EXO.term("Asset_label"),
    );
    if (!label) return value;

    return value.replace(`[[${uuid}]]`, `[[${uuid}|${label}]]`);
  }

  private iriToObsidianName(iri: string): string | null {
    // RFC 78c2b7d0 C4 — delegates to the shared pure utility (single source of
    // truth) so the read-side `NamedQueryRunner` can perform the identical
    // IRI→name reverse-mapping for SELECT bindings without duplicating the
    // regex. Behaviour unchanged (Issue #3274 ad-hoc namespace support).
    return iriToObsidianName(iri);
  }

  private normalizeWikilink(value: string): string {
    const cleaned = value.replace(/["'[\]]/g, "").trim();
    const pipeIndex = cleaned.indexOf("|");
    return pipeIndex >= 0 ? cleaned.substring(0, pipeIndex) : cleaned;
  }
}
