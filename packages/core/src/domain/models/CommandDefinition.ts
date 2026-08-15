import { GroundingType } from "../constants/GroundingType";
import type {
  CommandVariant,
  LabelClass,
  StyleSource,
} from "../constants/CommandBindingStyleEnums";

/**
 * Domain model for a dynamic command (RFC-009 Section 4.2.1).
 *
 * Represents WHAT to do and WHEN it is available.
 * Immutable after construction.
 */
export interface CommandDefinition {
  /** Asset UID of the command */
  readonly id: string;
  /** Human-readable label (e.g., "Remove start timestamp") */
  readonly name: string;
  /**
   * SPARQL-based template for the BUTTON label with `{sparql}` placeholders.
   * Each `{...}` block is executed as a SPARQL SELECT query;
   * the first binding of the first result row replaces the placeholder.
   *
   * Example: `"Vote ({SELECT (COUNT(?v) AS ?n) WHERE { $target exo:vote ?v }})"` → `"Vote (3)"`
   *
   * Variable substitution (same as PreconditionEvaluator):
   * - `$target` → `<targetIRI>`
   *
   * NOTE — distinct from {@link GroundingDefinition.labelTemplate}. That
   * sibling is a substitution-token template for the NEW INSTANCE's
   * `exo__Asset_label` consulted by `executeCreateInstance` during one-click
   * flows. Two distinct concepts, two distinct interfaces, same English word.
   */
  readonly labelTemplate?: string;
  /** Lucide icon name (e.g., "clock-x") */
  readonly icon?: string;
  /** Precondition that determines when the command is available */
  readonly precondition?: PreconditionDefinition;
  /** Action to execute when the command is invoked */
  readonly grounding: GroundingDefinition;
  /** Text shown in confirmation dialog */
  readonly confirmMessage?: string;
  /** Text shown after successful execution */
  readonly successMessage?: string;
  /** Category for grouping (e.g., "maintenance", "status") */
  readonly category?: string;
  /**
   * RFC ce27e55d: when true, the platform file opener navigates to the
   * newly-created instance in the CURRENT active leaf (Obsidian
   * `getLeaf(false)`) instead of opening a new tab (`getLeaf("tab")`).
   * Authored as the `exocmd__Command_openInSameTab` RDF triple
   * (`xsd:boolean`). Default `false` keeps existing commands unchanged.
   */
  readonly openInSameTab?: boolean;
}

/**
 * Domain model for a precondition (RFC-009 Section 4.2.2).
 *
 * Determines WHEN a command button should be visible.
 *
 * A precondition is one of:
 *   - **atomic** — an evaluation leaf carrying exactly one of `sparqlAsk`,
 *     `query`, or `hostFunction`;
 *   - **composite** — a boolean combinator over child preconditions:
 *     `composite` (AND/OR over `children`) or `not` (a single negated child);
 *   - **broken** — an explicit fail-closed sentinel for a child precondition
 *     that could not be resolved (unmounted / cyclic / malformed). Only ever
 *     appears as a *child* node inside a composite tree.
 *
 * onto-RFC df602adc (Composable homoiconic preconditions) — способ A (boolean
 * composition). The tree is authored entirely in RDF (`exocmd__AllPrecondition`
 * / `AnyPrecondition` / `NotPrecondition` combinator assets); the engine (this
 * interface + {@link PreconditionEvaluator}) is a pure recursive interpreter.
 *
 * Fail-open/fail-closed boundary (RFC Vision Lock 6):
 *   - a command with NO precondition → always available (top-level fail-OPEN);
 *   - a top-level precondition that cannot be resolved → `null` → same fail-open;
 *   - a broken/empty/cyclic *child* → `false` (fail-CLOSED, command hidden).
 *
 * Variables in SPARQL (atomic leaves):
 * - `$target` replaced with IRI of the current asset
 * - `$now` replaced with current timestamp (ISO 8601)
 * - `$user` replaced with IRI of the current user
 *
 * The interface uses OPTIONAL fields (not a discriminated union) so adding the
 * combinator/broken fields is backward-compatible — existing atomic
 * constructors (`WorkflowCommandAdapter.buildPrecondition`, the loader's atomic
 * branch) stay valid without touching them.
 */
export interface PreconditionDefinition {
  /** Asset UID of the precondition */
  readonly id: string;
  /** Human-readable description (e.g., "Asset has startTimestamp") */
  readonly label: string;
  /** SPARQL ASK query (evaluated against triple store) */
  readonly sparqlAsk?: string;
  /** Host function name (evaluated via registered TypeScript function) */
  readonly hostFunction?: string;
  /**
   * Reference (UID) of an `exoql__Query` asset whose body holds an ASK SPARQL
   * block (RFC c78cc5c8 Phase 1a). Evaluated through the `evaluateWithExoEval`
   * pipeline (allowlist + flag + executor). Mutually exclusive with `sparqlAsk`.
   */
  readonly query?: string;
  /**
   * onto-RFC df602adc — AND/OR combinator over child preconditions.
   * `op: 'all'` (`exocmd__AllPrecondition`) → available iff EVERY child is true;
   * `op: 'any'` (`exocmd__AnyPrecondition`) → available iff at least one child
   * is true. An empty `children` list evaluates to `false` (fail-closed).
   * Disjoint with {@link not} and the atomic fields — a well-formed node carries
   * exactly one combinator (enforced at authoring time by the Phase-3 sh:xone
   * integrity guard; the loader picks all > any > not deterministically).
   */
  readonly composite?: {
    readonly op: "all" | "any";
    readonly children: readonly PreconditionDefinition[];
  };
  /**
   * onto-RFC df602adc — NOT combinator (`exocmd__NotPrecondition`). Available
   * iff the single nested child is NOT satisfied. Disjoint with
   * {@link composite} and the atomic fields.
   */
  readonly not?: PreconditionDefinition;
  /**
   * onto-RFC df602adc (Impl-HIGH — explicit fail-closed sentinel). Marks a child
   * precondition that could NOT be loaded — an unresolvable wikilink, a cycle
   * caught by the loader's visited-set, an over-depth reference, or a malformed
   * atomic (no `sparqlAsk`/`query`/`hostFunction`).
   *
   * {@link PreconditionEvaluator} treats it as a THREE-VALUED (Kleene) `unknown`:
   * it PROPAGATES through the boolean combinators — `not(broken) = broken`,
   * `all` becomes `unknown` unless a child is definitively `false`, `any` becomes
   * `unknown` unless a child is definitively `true` — and is collapsed to
   * fail-CLOSED (`false` → command hidden) only at the top level. This is what
   * keeps the fail-closed guarantee alive under negation/nesting: a naive
   * `broken → false` would leak (`not[broken]` → `!false = true` → shown) in
   * exactly the unmounted-assetspace scenario this sentinel targets.
   *
   * ⛔ This is a DISTINCT contract from the loader returning `null`. `null` is
   * the fail-OPEN top-level boundary (no usable precondition → command shown);
   * `broken` is the fail-CLOSED child boundary (a sub-precondition is broken →
   * command hidden, and stays hidden through negation). Never conflate the two.
   */
  readonly broken?: true;
}

/**
 * Domain model for a grounding action (RFC-009 Section 4.2.3).
 *
 * Defines WHAT happens when a command is executed.
 */
export interface GroundingDefinition {
  /** Asset UID of the grounding */
  readonly id: string;
  /** Human-readable description (e.g., "Delete startTimestamp") */
  readonly label: string;
  /** Type of grounding action */
  readonly type: GroundingType;
  /** Frontmatter property name (for property_delete / property_set). Resolved
   *  from `exocmd__Grounding_targetProperty` — symbolic-string form
   *  (`"ems__Effort_status"`) OR UUID-wikilink form (`"[[<UID>]]"`) which is
   *  resolved by CommandResolver to the property's `exo__Asset_label` before
   *  reaching here. RFC 31c1a0be Phase 3: never bare UUID. */
  readonly targetProperty?: string;
  /** RFC 31c1a0be Phase 1: typed RDF reference to the value asset. When set,
   *  emits `"[[<UID>]]"` wikilink as the property_set value. Mutually exclusive
   *  with `targetValueLiteral` / `targetValueSubstitution`. */
  readonly targetValueRef?: string;
  /** RFC 31c1a0be Phase 1: literal string value for property_set. */
  readonly targetValueLiteral?: string;
  /** RFC 31c1a0be Phase 1: UUID of SubstitutionToken instance whose label
   *  (e.g. `$nowLocal`) becomes the substituted value. */
  readonly targetValueSubstitution?: string;
  /** RFC 78c2b7d0 C4 (NamedQuery value-source): UUID of a `query__NamedQuery`
   *  asset whose scalar result (first binding of first row, run read-only via
   *  `NamedQueryRunner` with auto-injected `$currentAsset`/`$currentClass`)
   *  becomes the `property_set` value. This is the CQRS bridge — the read side
   *  computes a write-input. Mutually exclusive with
   *  targetValueRef/targetValueLiteral/targetValueSubstitution. Resolved from
   *  `exocmd__Grounding_targetValueQuery` (wikilink → bare UID). Generic /
   *  reusable; C5 (ontological archive) is the first consumer. */
  readonly targetValueQuery?: string;
  /**
   * req faf269bf — TARGET-side NamedQuery: UUID of a `query__NamedQuery` asset
   * whose first projection identifies the asset this `property_set` step writes
   * INTO. Orthogonal to `targetValueQuery` (which computes the VALUE): this one
   * answers "which asset", not "which value", so the two compose freely.
   *
   * The query runs read-only with `$currentAsset` auto-injected = the
   * click-target IRI, so a reified link can be found FROM one of its ends —
   * the gap this closes. A reified statement is neither the click-target nor an
   * asset a previous step created, so before this field it was unaddressable.
   *
   * Absent (every existing grounding) → the step targets the click-target, or
   * the created instance when `targetsCreatedInstance` is set: byte-identical
   * prior behaviour. Mutually exclusive with `targetsCreatedInstance` — two
   * incompatible addressings must never be silently arbitrated. A query that
   * matches nothing is fail-loud: the click-target is NEVER a fallback, since
   * writing to it would put the value on the wrong asset.
   *
   * Authored as the `exocmd__Grounding_targetQuery` RDF triple (wikilink → bare
   * UID, resolved by `CommandResolver.loadGroundingDefinition`).
   */
  readonly targetQuery?: string;
  /** RFC 918a2b65 Phase 1: Opaque JSON config payload for `service_call`
   *  groundings. Resolved through `substituteVariables` before `JSON.parse`;
   *  merged into `userInput` defaults at `GroundingExecutor.executeServiceCall`.
   *  Replaces legacy `targetValue` for service_call semantics. Disjoint with
   *  `appendExpression`. */
  readonly serviceCallPayload?: string;
  /** RFC 918a2b65 Phase 1: Substitution expression for `property_append`
   *  groundings. Resolved by `substituteVariables` (supports standard tokens +
   *  property-accessor postfix like `$target.<property>`). Replaces legacy
   *  `targetValue` for property_append semantics. Disjoint with
   *  `serviceCallPayload`. */
  readonly appendExpression?: string;
  /** SPARQL UPDATE query (for sparql_update) */
  readonly sparqlUpdate?: string;
  /** Ordered sub-steps (for composite type) */
  readonly steps?: readonly GroundingDefinition[];
  /** Class to instantiate (for create_instance, e.g., "gtd__InboxItem") */
  readonly targetClass?: string;
  /** Prototype asset IRI or UUID (for create_instance) */
  readonly targetPrototype?: string;
  /** Vault-relative folder path (for create_instance, e.g., "01 Inbox") */
  readonly targetFolder?: string;
  /**
   * Frontmatter property name on the newly created instance where the plugin
   * writes the `[[$target]]` wikilink back to the source asset (for
   * `create_instance` grounding).
   *
   * If absent → fallback to hardcoded `exo__Asset_source`.
   */
  readonly linkBackProperty?: string;
  /**
   * Integer delta for `property_increment` grounding (Issue #3134).
   * Supports negative values. Default 1 when omitted.
   */
  readonly incrementBy?: number;
  /**
   * ISO-8601 duration literal for `property_shift` grounding (Issue #3134).
   * Accepts xsd:dayTimeDuration (`P1D`, `-PT2H`, `P1DT12H`) and
   * xsd:yearMonthDuration (`P1M`, `P1Y2M`) shapes.
   */
  readonly shiftDelta?: string;
  /**
   * RFC v2 Phase 1+2: declarative ref-form property defaults. Multi-valued
   * list of `exocmd__PropertyDefault` instances attached via
   * `Grounding_propertyDefault` predicate.
   *
   * Each PropertyDefault asset declares (property, value) pair. Values that
   * point to a `SubstitutionToken` instance are resolved at parse time via
   * the SubstitutionToken resolver registry (today / todayStart) when the
   * resolver is context-independent. Context-dependent resolvers
   * (targetFolder / target) are encoded as marker string
   * `__SUBSTITUTE__<resolver-id>__<token-uid>__` for the Phase 3b executor.
   *
   * The legacy JSON-literal form (`exocmd__Grounding_propertyDefaults`,
   * plural) was removed in RFC v2 Phase 5 (#3167) after vault migration to
   * ref-form completed (Phase 4a, #3165).
   */
  readonly propertyDefault?: ReadonlyArray<PropertyDefaultResolved>;
  /**
   * RFC v2 Phase 1+2: declarative ref-form mapping rules. Multi-valued list of
   * `exocmd__InheritanceRule` instances attached via `Grounding_inheritanceRule`
   * predicate. Engine (Phase 3b) applies them in priority-descending order
   * with class condition / exclusion filters relative to the target IRI.
   */
  readonly inheritanceRule?: ReadonlyArray<InheritanceRuleResolved>;
  /**
   * Standalone wikilink to the owner identity asset pinned by this grounding.
   * Injected into `userInput.isDefinedBy` for the `service_call` createAsset
   * service, where it becomes `exo__Asset_isDefinedBy` on the new asset.
   *
   * Encoded as the `exocmd__Grounding_isDefinedBy` RDF triple — a real
   * frontmatter wikilink, not a value embedded in `Grounding_serviceCallPayload`
   * JSON. This makes the relationship discoverable in the referenced
   * identity asset's incoming-links / layout.
   */
  readonly isDefinedBy?: string;
  /**
   * Opt-in flag for `create_instance` groundings: when `true`, the modal
   * pre-fills the `label` input with `${prototype.exo__Asset_label} YYYY-MM-DD`
   * (e.g. `Morning Wim Hof 2026-05-17`).
   *
   * Restores the legacy v15.38 `CreateInstanceCommand` behaviour that was lost
   * when commands migrated to the vault-driven exocmd pipeline (commit
   * abdb19a3 / PR #2733 stripped `default` from the inputSchema mapping).
   *
   * Authored as the `exocmd__Grounding_prefillLabelWithDate` RDF triple
   * (`xsd:boolean`). Default `false` keeps existing groundings unchanged.
   */
  readonly prefillLabelWithDate?: boolean;
  /**
   * RFC ce27e55d: substitution-token string used by `executeCreateInstance`
   * to derive `exo__Asset_label` on the newly created asset when the user
   * supplied no `userInput.label` (i.e. no input modal). Supports the same
   * tokens as `substituteVariables` — `$target`, `$target.<prop>`, `$today`,
   * `$nowLocal`, `$nowCompact`, `$todayStart`. Typical value:
   * `"$target.exo__Asset_label $nowCompact"` → `"Осознал, что делаю шелуху 2026-05-28-22-51"`.
   *
   * Authored as the `exocmd__Grounding_labelTemplate` RDF triple. Disjoint
   * from `prefillLabelWithDate` — labelTemplate is consulted only when no
   * modal collects user input (one-click flow), whereas prefillLabelWithDate
   * pre-fills the modal's default value.
   *
   * NOTE — distinct from {@link CommandDefinition.labelTemplate}. That sibling
   * is a SPARQL-placeholder template for the BUTTON label (e.g.
   * `"Vote ({SELECT (COUNT(?v) AS ?n) WHERE { $target exo:vote ?v }})"`).
   * This field is the template for the NEW ASSET's `exo__Asset_label`.
   * Two distinct concepts, two distinct interfaces, same English word.
   */
  readonly labelTemplate?: string;
  /**
   * RFC 36347daf Phase 2: direction facet for `workflow_transition`
   * groundings. `"forward"` (default when omitted) selects transitions with
   * `isRollback=false`; `"rollback"` selects `isRollback=true`. Ignored by
   * other grounding types.
   *
   * Authored as the `exocmd__Grounding_direction` RDF triple (xsd:string).
   */
  readonly direction?: "forward" | "rollback";
  /**
   * Subproject 17f58ebe Веха 3 — `body_template` grounding. Inline markdown
   * literal used as the body template. `$token` markers resolve via the shared
   * SubstitutionResolverRegistry at execute time. Disjoint with
   * {@link templateRef} (templateRef takes priority when both are present).
   *
   * Authored as the `exocmd__Grounding_bodyTemplate` RDF triple (xsd:string).
   */
  readonly bodyTemplate?: string;
  /**
   * Subproject 17f58ebe Веха 3 — `body_template` grounding. Bare UID of an
   * `exotemplate__Template` asset whose markdown BODY is loaded (via the
   * injected TemplateLoaderPort) and used as the body template. Preferred over
   * the inline {@link bodyTemplate} when both are set; when no loader is wired
   * (CLI/test) the step falls back to {@link bodyTemplate} or fails loud.
   *
   * Authored as the `exocmd__Grounding_templateRef` RDF triple (UID wikilink,
   * normalized to a bare UID by the parser).
   */
  readonly templateRef?: string;
  /**
   * `create_instance` grounding — when `true`, the new instance's markdown BODY
   * is cloned from the click-target's ($target) body (frontmatter is NOT copied
   * — only the body after the leading frontmatter block). Enables an
   * "iterate this asset" button (e.g. `ems__WaitingCheckTask` «Следующая
   * итерация», req 915b20b2) to carry the context notes forward across
   * iterations without a template asset. Disjoint from `body_template`
   * (which sources a template) and from the reserved `userInput.body`
   * (which wins when both a non-empty user body and this flag are present).
   * Domain-agnostic engine primitive — platform-agnostic (reads the target
   * file via the injected reader; no Node fs), so it holds identically on
   * desktop and mobile (Desktop↔Mobile Command Parity invariant).
   *
   * Authored as the `exocmd__Grounding_cloneTargetBody` RDF triple
   * (xsd:boolean — `true`/`false`; absent → not cloned).
   */
  readonly cloneTargetBody?: boolean;
  /**
   * Issue #3867 — opt-in composite-step target selector. When `true`, AND this
   * grounding runs as a `composite` step AFTER a `create_instance` step in the
   * same composite has produced an asset, `GroundingExecutor.executeComposite`
   * runs this step against the CREATED asset's file (its `filePath` =
   * `lastCreatedPath`) instead of the composite click-target. Only the step's
   * `filePath` is re-pointed — `targetIRI` stays the click-target (so `$target`
   * substitution still resolves to the source asset for link-back, and because
   * the just-created asset is not yet indexed in the triple store).
   *
   * Issue #4046 — `service_call` steps needed one extra hop for the same
   * guarantee: a service resolves its file from the IRI it is handed
   * (`IGroundingService.execute` has no file-path channel), so a re-pointed
   * `filePath` alone left the service operating on the click-target and
   * "succeeding" silently. `GroundingExecutor.executeServiceCall` therefore
   * hands the service `vaultPathToIRI(filePath)` — and ONLY when this flag is
   * set. `$target` substitution inside `serviceCallPayload` is unaffected and
   * still uses the click-target `targetIRI`. The plugin resolver can find the
   * just-created asset because `FileSystemAdapter.write` awaits
   * `reconcileInternalFile` in a `finally` (→ `Vault.onChange("file-created")`
   * → `fileMap[path]`), so the `TFile` is registered before the write resolves
   * — measured in Obsidian 1.13.7, not assumed.
   *
   * Absent/`false` (the default) → the step operates on the click-target
   * exactly as today. Existing composites whose `property_set` steps
   * intentionally close the CURRENT click-target (e.g. `ems__WaitingCheckTask`
   * «Следующая итерация», grounding `a49471de-...`) are therefore unchanged —
   * this is a zero-regression, opt-in addition. Threading is a no-op unless a
   * `create_instance` step ran earlier in the same composite. It has no effect
   * outside a composite (a top-level non-composite grounding has no
   * `lastCreatedPath` context).
   *
   * Authored as the `exocmd__Grounding_targetsCreatedInstance` RDF triple
   * (xsd:boolean — `true`/`false`; absent → click-target).
   */
  readonly targetsCreatedInstance?: boolean;
  /**
   * Opt-in for `create_instance`: an ABSENT `exo__Asset_label` is the INTENDED
   * end state, not a degraded fallback.
   *
   * By default, when nothing supplies a label (no `userInput.label`, no
   * `labelTemplate`, or a template that substitutes to blank), the executor
   * writes the literal `"Untitled"`, derives `aliases: ["Untitled"]`-free but
   * flags `exo__Asset_label` in `missing[]`, which logs "Vault may be in an
   * unhealthy state". That default is right for an ACCIDENTAL blank and stays
   * unchanged.
   *
   * It is wrong for a class whose name is DERIVED at render time from an
   * `exo__DisplayNameSpec` (e.g. `ems__Action`, whose display name composes the
   * prototype's label with the action's timestamp). There a stored label is not
   * missing data — it is duplicated, stale-prone data: the asset would carry a
   * frozen string next to a spec that recomputes the name on every render, and
   * the two would disagree the moment either side changes.
   *
   * When `true` AND nothing resolved a label, the executor:
   *   - REMOVES `exo__Asset_label` from the written frontmatter (rather than
   *     writing `"Untitled"` or an empty literal — an empty literal is worse
   *     than either, see the blank-substitution guard);
   *   - writes no label-derived `aliases`;
   *   - does NOT push `exo__Asset_label` to `missing[]`, so the unhealthy-vault
   *     ERROR is not raised for a designed outcome.
   *
   * A label that IS supplied still wins: `userInput.label` and a
   * `labelTemplate` that substitutes non-blank both take the normal path, so
   * this flag only ever changes the FALLBACK, never an explicit name. Absent /
   * `false` (the default) → byte-identical to prior behaviour.
   *
   * ⛔ Only meaningful for `create_instance`; other grounding types never reach
   * the label top-up.
   *
   * Authored as the `exocmd__Grounding_omitLabel` RDF triple
   * (xsd:boolean — `true`/`false`; absent → the `"Untitled"` fallback).
   */
  readonly omitLabel?: boolean;
}

/**
 * Domain model for a resolved `exocmd__PropertyDefault` instance
 * (RFC v2 Phase 1+2 — ref-form replacement for legacy `propertyDefaults` JSON).
 *
 * Each instance binds one property (resolved to its `exo__Asset_label`) to a
 * value. Values may be:
 *   - wikilink-form `"[[<UID>]]"` when the value asset is a regular asset;
 *   - already-resolved string for context-independent SubstitutionToken
 *     resolvers (e.g. `today` → `"2026-05-21"`);
 *   - marker `__SUBSTITUTE__<resolver-id>__<token-uid>__` for
 *     context-dependent SubstitutionToken resolvers (Phase 3b executor
 *     replaces the marker at execution time).
 */
export interface PropertyDefaultResolved {
  /** Resolved `exo__Asset_label` of the target `exo__Property` asset. */
  readonly propertyName: string;
  /** Resolved value string (see interface docstring for shapes). */
  readonly value: string;
}

/**
 * Domain model for a resolved `exocmd__InheritanceRule` instance
 * (RFC v2 Phase 1+2 — ref-form mapping rule attached to a Grounding).
 *
 * `targetClassCondition` absent → rule applies unconditionally.
 * `targetClassExclusion` empty → no class is excluded.
 * `priority` default 50 — higher first when Phase 3b engine sorts rules.
 */
export interface InheritanceRuleResolved {
  /** Resolved `exo__Asset_label` of the source `exo__Property`. */
  readonly sourcePropertyName: string;
  /** Resolved `exo__Asset_label` of the target `exo__Property`. */
  readonly targetPropertyName: string;
  /** Resolved `exo__Asset_label` of the class condition; absent = unconditional. */
  readonly targetClassCondition?: string;
  /**
   * UID-canon form of the class condition — the `exo__Asset_uid` that the
   * `exocmd__InheritanceRule_targetClassCondition` wikilink points to, when it
   * is authored as a UUID ref (the production UID-canon shape).
   *
   * Issue #3562: carried alongside the label so the executor can match the
   * condition against a UID-canon target class **UID↔UID directly**, with no
   * dependency on the label→UID resolver (Obsidian `metadataCache` in the
   * plugin, fs scan in the CLI). That resolver lags right after
   * `Apply profile` materialises the class TBox, which silently skipped
   * conditional inheritance rules until the next reload. Absent for legacy
   * label-form conditions (then matching falls back to the label + resolver).
   */
  readonly targetClassConditionUid?: string;
  /** Resolved labels of excluded classes; empty = no exclusion. */
  readonly targetClassExclusion: readonly string[];
  /**
   * UID-canon forms of excluded classes (Issue #3562 — same rationale as
   * {@link targetClassConditionUid}). Treated as an independent set of UID-form
   * exclusion refs, NOT a positional parallel to {@link targetClassExclusion}.
   */
  readonly targetClassExclusionUids?: readonly string[];
  /** Priority for ordering when Phase 3b engine applies multiple rules. */
  readonly priority: number;
}

/**
 * Domain model for a command binding (RFC-009 Section 4.2.4).
 *
 * Binds a command to a context: WHO sees the button.
 *
 * Resolution priority (specific → general):
 * 1. targetAsset — only for a specific asset
 * 2. targetPrototype — for all instances of a prototype
 * 3. targetClass — for all assets of a class
 *
 * At least one of targetClass, targetPrototype, targetAsset is required.
 */
export interface CommandBindingDefinition {
  /** Asset UID of the binding */
  readonly id: string;
  /** Human-readable description */
  readonly label: string;
  /** Reference to the Command asset (UID) */
  readonly commandRef: string;
  /** Apply to all assets of this class */
  readonly targetClass?: string;
  /** Apply to all instances of this prototype */
  readonly targetPrototype?: string;
  /** Apply to a specific asset */
  readonly targetAsset?: string;
  /** Where to render the button */
  readonly position?: string;
  /** Sort order (default: 100) */
  readonly order?: number;
  /**
   * Per-binding button variant override (RFC command-variant-split,
   * f1dc284a-eadc-4d0e-8e72-323e999ea510). Populated from
   * `exocmd__CommandBinding_variant` frontmatter literal. When absent, UI
   * falls back to category-default variant (then `secondary`).
   */
  readonly variant?: CommandVariant;
  /** Binding-level precondition overriding command-level precondition */
  readonly precondition?: PreconditionDefinition;
  /**
   * Resolved visual style (RFC-024 §4 Phase 2).
   *
   * Populated by CommandResolver applying the fallback chain:
   * 1. `exocmd__CommandBinding_style` wikilink → load referenced
   *    CommandBindingStyle asset (preferred — reusable across bindings).
   * 2. `exocmd__CommandBinding_variant` inline literal → synthesize
   *    minimal style with only `variant` set.
   * 3. Neither present → `style` is `undefined`; UI applies category-based
   *    default via `resolveDefaultVariantForCategory(command.category)`.
   *
   * Invalid enum values are coerced (lowercase + trim) and dropped to
   * `undefined` after warning (RFC-024 §5 — never crash).
   */
  readonly style?: CommandBindingStyleDefinition;
  /**
   * C3 capability-inheritance (RFC 78c2b7d0, the ХРЕБЕТ child RFC) — UIDs of
   * sibling/ancestor bindings this binding absolutely overrides. Populated from
   * `exocmd__CommandBinding_overrides` references.
   *
   * Semantics (resolved by `CommandResolver.resolveForAssetMulti` AFTER the
   * superClass BFS expansion): every UID listed here is removed from the merged
   * capability set **absolutely** — independent of which ancestor contributed
   * it and independent of class-distance. A dangling UID (no such binding in
   * the merged set) is fail-open: it is simply a no-op, never an error.
   */
  readonly overrides?: readonly string[];
}

/**
 * Domain model for `exocmd__CommandBindingStyle` (RFC-024 §4 Phase 2).
 *
 * Resolved visual properties for a command binding. Constructed by
 * CommandResolver from either a referenced style asset (full definition)
 * or an inline `CommandBinding_variant` shorthand (variant only).
 *
 * All fields are optional — caller (UI layer) supplies its own defaults.
 */
export interface CommandBindingStyleDefinition {
  /** Asset UID of the style asset (or synthetic `inline:<binding-uid>` for shorthand) */
  readonly id: string;
  /** Human-readable label of the style asset (empty for inline shorthand) */
  readonly label: string;
  /** Semantic button variant whitelist value */
  readonly variant?: CommandVariant;
  /** Boolean — render the existing Command_icon (default true at UI layer) */
  readonly showIcon?: boolean;
  /** Typographic modifier whitelist value */
  readonly labelClass?: LabelClass;
  /** Literal text for the aria-label attribute */
  readonly ariaLabel?: string;
  /** Literal text for the title attribute (Obsidian tooltip convention) */
  readonly tooltip?: string;
  /** Chord string (e.g. "Mod+Shift+D") — registered with `exo-cmd-` namespace */
  readonly keyboardShortcut?: string;
  /** Governance marker — user wins over vendor per precedence matrix */
  readonly source?: StyleSource;
  /** True iff this style was synthesized from inline `CommandBinding_variant` */
  readonly inline: boolean;
}

// -- Type Guards --

/**
 * Checks if frontmatter represents an exocmd__Command asset.
 * Uses exact class matching (not CONTAINS) to avoid false positives.
 */
export function isCommandFrontmatter(
  frontmatter: Record<string, unknown>,
): boolean {
  return hasInstanceClass(frontmatter, "exocmd__Command");
}

/**
 * Checks if frontmatter represents an exocmd__Precondition asset.
 */
export function isPreconditionFrontmatter(
  frontmatter: Record<string, unknown>,
): boolean {
  return hasInstanceClass(frontmatter, "exocmd__Precondition");
}

/**
 * Checks if frontmatter represents an exocmd__Grounding asset.
 */
export function isGroundingFrontmatter(
  frontmatter: Record<string, unknown>,
): boolean {
  return hasInstanceClass(frontmatter, "exocmd__Grounding");
}

/**
 * Checks if frontmatter represents an exocmd__CommandBinding asset.
 */
export function isCommandBindingFrontmatter(
  frontmatter: Record<string, unknown>,
): boolean {
  return hasInstanceClass(frontmatter, "exocmd__CommandBinding");
}

/**
 * Shared helper: checks if frontmatter's exo__Instance_class contains a specific class.
 * Handles both single string and array formats, with wikilink extraction.
 */
function hasInstanceClass(
  frontmatter: Record<string, unknown>,
  className: string,
): boolean {
  const instanceClass = frontmatter["exo__Instance_class"];
  if (instanceClass == null) {
    return false;
  }

  const classes = Array.isArray(instanceClass)
    ? instanceClass
    : [instanceClass];

  for (const cls of classes) {
    if (typeof cls !== "string") continue;

    // Extract class name from wikilink: [[exocmd__Command]] → exocmd__Command
    // Also handles [[uuid|Label]] format: extract the first part before |
    const match = cls.match(/\[\[([^|\]]+)/);
    const extracted = match ? match[1] : cls;

    if (extracted === className) {
      return true;
    }
  }

  return false;
}
