# Templating reference

> Subproject `17f58ebe` (vision `09a3fbec`) · PRs #3637 (v16.116.0), #3641 (v16.121.0)
> Task guide: [Insert tokens & apply body templates](../how-to/templating.md) ·
> Rationale: [Why homoiconic templating](../explanation/templating.md)

Authoritative reference for Exocortex's homoiconic templating: the editor
commands, the `exotemplate__Template` class, the `body_template` grounding
step, and the substitution-token vocabulary.

---

## Editor commands

Both commands are editor-only (registered with an `editorCallback`, so Obsidian
auto-hides them outside an active Markdown editor) and contain no `git`/Node/fs
dependency, so they are registered unconditionally on desktop and iOS.

| Command name | Command id | Effect |
|---|---|---|
| **Insert template token** | `insert-template-token` | Opens a fuzzy picker of three fixed token choices; inserts the resolved scalar value at the cursor. |
| **Insert template** | `insert-template` | Opens a fuzzy picker over the vault's `exotemplate__Template` assets; inserts the chosen template's body (with `$token` markers resolved) at the cursor. |

### `Insert template token` choices

| Menu label | Resolver | Output format | Notes |
|---|---|---|---|
| Random UUID | `randomUUIDv4` | bare v4, lowercase | `crypto.randomUUID()`; throws if no Web Crypto / Node crypto |
| Current Timestamp | `nowTimestamp` | `YYYY-MM-DDTHH:MM:SS` | **local** time, no timezone suffix |
| Current Date | `nowDate` | `YYYY-MM-DD` | **local** date |

A dismissed picker (`Escape`) is a silent no-op; the inserted text is its own
success feedback.

### `Insert template` behaviour

- Enumerates every vault asset whose `exo__Instance_class` names the
  `exotemplate__Template` class (by UID or by the symbolic label
  `exotemplate__Template`), sorted case-insensitively by `exo__Asset_label`
  (falling back to the file basename).
- An empty result surfaces the notice
  `No templates found. Create an exotemplate__Template asset (with a body) to insert it here.`
- On selection: the chosen file is read, its leading frontmatter is stripped,
  `$token` markers in the body are resolved, and the result replaces the current
  selection at the cursor.

---

## `exotemplate__Template` class

A body template is an ordinary vault note: the markdown **body** (everything
after the frontmatter) is the template content. There is **no dedicated body
property** — homoiconicity means "an `exotemplate__Template` asset's body is its
file body."

| Attribute | Value |
|---|---|
| Class UID | `8bdf4506-80bf-4999-8fda-1ea0808b4ee5` |
| Symbolic label | `exotemplate__Template` |
| Metaclass (`exo__Instance_class`) | `exo__Class` (`8619c4fc-…`) |
| `exo__Class_superClass` | `exo__Asset` (`493c2ae2-…`) |
| Ontology (`exo__Asset_isDefinedBy`) | `$exotemplate` (`d6947db1-…`), in the `exoas-public` AssetSpace |

Minimal authoring frontmatter:

```yaml
exo__Instance_class: "[[8bdf4506-80bf-4999-8fda-1ea0808b4ee5]]"
exo__Asset_label: My template
```

> There is **no** `exotemplate__Variable` class. The vision's "variables" are
> the existing `exocmd__SubstitutionToken` vocabulary (see
> [substitution tokens](#substitution-tokens)) — one source of truth.

---

## `body_template` grounding

A grounding step that copies a resolved body template into the body of its
target file, preserving the target's frontmatter.

| Attribute | Value |
|---|---|
| Grounding type | `body_template` |
| Catalog asset (`exocmd__Grounding_type`) | `exocmd__GroundingTypeBodyTemplate` (`6093bfcb-cf9b-4565-86c3-ff74d8bc11c0`) |

### Source fields (one required)

| Field | Type | Meaning |
|---|---|---|
| `exocmd__Grounding_templateRef` | UID wikilink → `exotemplate__Template` | Load that asset's body as the template. **Preferred** when both are set. |
| `exocmd__Grounding_bodyTemplate` | inline markdown literal | Used directly as the template. Fallback when `templateRef` cannot be loaded. |

Resolution order: `templateRef` (via the injected template loader) wins; if no
loader is wired (e.g. a headless CLI/test run) it degrades to the inline
`bodyTemplate`, and if neither yields a body the step **fails loudly** — a no-op
body write is a configuration error.

### Target inside a `composite`

When a `body_template` step runs inside a `composite` grounding
(`exocmd__Grounding_steps`), the composite threads the **most-recently-created
asset's** path (from a preceding `create_instance` step) to the `body_template`
step, so the template lands in the new asset rather than the click target. Every
other step type keeps operating on the original target — a zero-regression
addition for existing composites.

---

## Substitution tokens

Template bodies (and the `Insert template token` command) draw on the shared
`SubstitutionResolverRegistry` — the same registry the RDF-driven
asset-creation pipeline dispatches. A token is written `$name` in a body;
`$name` is a `$` followed by a letter then letters/digits/underscore (greedy,
so `$todayX` is the token `todayX`, not `today`).

### Context-free tokens

Resolve anywhere, including the editor `Insert template` command (which runs
with no command context):

| Token | Resolves to |
|---|---|
| `$today` | UTC date `YYYY-MM-DD` (`toISOString`) |
| `$todayStart` | start of today, ISO timestamp (UTC) |
| `$nowTimestamp` | **local** date-time `YYYY-MM-DDTHH:MM:SS` (no TZ) |
| `$nowDate` | **local** date `YYYY-MM-DD` |
| `$nowYear` | current year, e.g. `2026` |
| `$nowMonth` | current month, zero-padded, e.g. `06` |
| `$randomUUIDv4` | a random UUID v4, lowercase |

### Context-dependent tokens

Resolve only when the command supplies context (e.g. inside a `body_template`
grounding with a target/user-input). With no context they yield an empty string
and so are left **literal** in editor inserts:

| Token | Resolves to (with context) |
|---|---|
| `$target` | `"[[<target IRI>]]"` wikilink |
| `$targetFolder` | the target file's folder path |
| `$userInputLabel` | the user-entered label |
| `$userInput` | a named user-input parameter (`$userInput` family) |
| `$targetProperty` | a frontmatter property of the target |
| `$labelAsArray` | the user label wrapped as a single-element list |
| `$groundingTargetClass` | the grounding's target class wikilink |
| `$targetClassSelf` | the host file's own UID as a class wikilink |

### Leniency contract

Body-template substitution is deliberately lenient (a markdown body is freeform
prose). A `$token` is replaced **only** when the token is known **and** resolves
to a non-empty scalar string. In every other case — unknown token, a list-typed
or `null` result, **or an empty string** (the context-less case above) — the
literal `$name` text is left untouched. So `$5.00`, `$totallyUnknown`, and a
context-missing `$target` all survive unchanged. A visible unresolved token you
can fix beats a silently deleted one.

---

## Related

- [How-to: insert tokens & apply body templates](../how-to/templating.md)
- [Explanation: why homoiconic templating](../explanation/templating.md)
- [PROPERTY_SCHEMA.md](PROPERTY_SCHEMA.md) — full frontmatter property vocabulary
