# Homoiconic templating — insert tokens & apply body templates

> Subproject `17f58ebe` (vision `09a3fbec`) · PRs #3637 (v16.116.0), #3641 (v16.121.0)
> See also: [Templating reference](../reference/templating.md) · [Why homoiconic templating](../explanation/templating.md)

Exocortex ships a built-in, homoiconic replacement for the Obsidian _Templates_
and _Templater_ plugins. Templates are ordinary vault assets (class
`exotemplate__Template`); placeholder tokens (`$today`, `$randomUUIDv4`, …)
reuse the same `exocmd__SubstitutionToken` vocabulary that the RDF-driven
asset-creation pipeline uses — so a value you insert by hand and the same token
resolved during command execution come from one source of truth.

There are three ways to use it:

1. **Insert a single token** at the cursor (`Insert template token`).
2. **Insert a whole template block** at the cursor (`Insert template`).
3. **Apply a body template when an asset is created** (the `body_template`
   grounding step).

All three are editor/runtime-only — they need no `git`, Node, or filesystem
access, so they work identically on desktop and iOS (Desktop↔Mobile Command
Parity).

---

## 1. Insert a single token

Use this to drop a fresh UUID, timestamp, or date wherever your cursor is.

1. Place the cursor in any Markdown note.
2. Run **`Exocortex: Insert template token`** (`Cmd/Ctrl-P` → search "insert
   template token"). The command is hidden when no Markdown editor is active.
3. Pick one of the three choices in the fuzzy picker:

   | Choice | Inserts | Example |
   |---|---|---|
   | **Random UUID** | a random UUID v4 (lowercase) | `9f1c2e8a-…` |
   | **Current Timestamp** | local date-time, no timezone | `2026-06-20T08:14:03` |
   | **Current Date** | today's **local** date | `2026-06-20` |

   The chosen value replaces any current selection. Press `Escape` to cancel
   (no-op).

> The date/timestamp choices use your **local** time on purpose — an early
> morning in UTC+5 should not stamp "yesterday".

## 2. Insert a whole template block

Use this for reusable section skeletons ("## Resources / ## Plan / ## Log").
The blocks are vault assets, so you edit them like any other note.

### Author a template

Create a note whose **body** is the template content, and tag it with the
`exotemplate__Template` class:

```yaml
exo__Instance_class: "[[8bdf4506-80bf-4999-8fda-1ea0808b4ee5]]"
exo__Asset_label: Project body
```

```markdown
## Resources

## Execution plan

## Log
- $nowTimestamp — created
```

Anything after the frontmatter is the template body. `$token` markers in the
body are resolved on insert (see the [token reference](../reference/templating.md#substitution-tokens)).

### Insert it

1. Place the cursor where the block should go.
2. Run **`Exocortex: Insert template`**.
3. Fuzzy-pick a template by its label. Its body is inserted at the cursor with
   tokens resolved.

If the vault has no `exotemplate__Template` assets yet, the command shows a
guiding notice (`No templates found. Create an exotemplate__Template asset…`)
instead of an empty picker.

> Unknown or context-less tokens are left **literal** rather than blanked — a
> visible `$target` you can fix beats a silently deleted one. See the
> [leniency contract](../reference/templating.md#leniency-contract).

## 3. Apply a body template when an asset is created

Use this to give every asset created by a command a pre-filled body. It is the
`body_template` grounding step, composed after a `create_instance` step.

A `body_template` grounding sources its markdown from either an inline literal
or a reference to an `exotemplate__Template` asset (the reference wins when both
are present), resolves `$token` markers, and writes the result as the target
file's body (the frontmatter is preserved).

### Reference a template asset (homoiconic — preferred)

```yaml
exo__Instance_class:
  - "[[exocmd__Grounding]]"
exo__Asset_label: "Project body template"
exocmd__Grounding_type: "[[6093bfcb-cf9b-4565-86c3-ff74d8bc11c0]]"
exocmd__Grounding_templateRef: "[[8bdf4506-80bf-4999-8fda-1ea0808b4ee5|Project body]]"
```

### Or inline the markdown

```yaml
exo__Instance_class:
  - "[[exocmd__Grounding]]"
exo__Asset_label: "Inline body template"
exocmd__Grounding_type: "[[6093bfcb-cf9b-4565-86c3-ff74d8bc11c0]]"
exocmd__Grounding_bodyTemplate: "## Log\n- $nowTimestamp — created"
```

### Compose it after `create_instance`

To create an asset _and_ fill its body, list a `create_instance` step and a
`body_template` step inside a `composite` grounding (`exocmd__Grounding_steps`).
The composite threads the just-created file's path to the `body_template` step,
so the template lands in the **new** asset, not the click target:

```yaml
exo__Instance_class:
  - "[[exocmd__Grounding]]"
exo__Asset_label: "Create project with body"
exocmd__Grounding_type: "[[8f9a57db-3865-4886-92fb-c5ab7f3c3fa3]]"
exocmd__Grounding_steps:
  - "[[<create_instance grounding UID>]]"
  - "[[<body_template grounding UID>]]"
```

Wire that grounding to an `exocmd__Command` via `exocmd__Command_grounding` as
for any other dynamic command — see
[Customizing dynamic commands](ONTOLOGY_EXTENSION.md) for the command/binding
authoring flow.

> If a `templateRef` is authored but the runtime cannot load the template
> (e.g. a headless CLI run with no template index), the step falls back to an
> inline `bodyTemplate` when present, otherwise it fails loudly — a no-op body
> write is treated as a configuration error.

---

## Related

- [Templating reference](../reference/templating.md) — commands, classes,
  grounding fields, and the full token table.
- [Why homoiconic templating](../explanation/templating.md) — design rationale.
- [ONTOLOGY_EXTENSION.md](ONTOLOGY_EXTENSION.md) — authoring dynamic commands
  and groundings.
