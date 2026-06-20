# DynamicForm reference-picker (`assetRef` fuzzy picker)

> Generic, reusable fuzzy reference-picker for `DynamicForm`. Extracted from the
> T1 «Create Instance» button (project bbe40f8c, T2) so any future command form
> can embed the same combobox without reimplementing it.
>
> Source: `packages/obsidian-plugin/src/presentation/components/dynamic-form/ReferencePicker.tsx`.

## What it is

A controlled React combobox that lets the user fuzzy-search a list of candidate
assets (by `exo__Asset_label`) and commit the chosen one as a quoted frontmatter
wikilink (`"[[<uid>]]"`). It is **parameterised by class** — the caller decides
which class's instances become candidates — so it is a building block, not a
one-off.

## Using it from a grounding's `inputSchema`

Declare an `assetRef` field with a `targetClassUid`. The picker offers every
vault asset that is an instance of that class:

```jsonc
{
  "type": "object",
  "properties": {
    "exo__Asset_isDefinedBy": {
      "type": "assetRef",
      "title": "Ontology",
      "targetClassUid": "829b9b3b-6fc3-4276-be6a-27d3398c012e", // exo__Ontology
    },
  },
  "required": ["exo__Asset_isDefinedBy"],
}
```

Resolution path (no code needed per command):

1. `CommandResolver` parses the JSON into an `InputSchemaField` with
   `type: "assetRef"` + `targetClassUid`.
2. `DynamicFormModal.buildCandidates()` resolves candidates for each such field
   via `findAssetRefCandidates(app, targetClassUid)` (matches the dual IRI
   scheme — UID-canon or symbolic — desktop **and** mobile, metadata-cache only,
   no `Platform.isMobile` gating).
3. `DynamicForm` renders `<ReferencePicker>` for the field.

Object-typed **required** properties (T3) reuse the exact same path: the
required-property resolver emits an `assetRef` field whose `targetClassUid` is
the property's `exo__Property_range` class.

## Embedding the component directly (non-`inputSchema` callers)

`ReferencePicker` is decoupled from `InputSchemaField` — it takes primitives:

| Prop          | Meaning                                                                        |
| ------------- | ------------------------------------------------------------------------------ |
| `name`        | Stable id segment for `data-testid` (typically the field name).                |
| `value`       | Committed value: a quoted wikilink `"[[<uid>]]"`, or `""`.                     |
| `candidates`  | `{ uid, label }[]` the user may pick.                                          |
| `onChange`    | Receives `"[[<uid>]]"` on select, `""` while typing (free text never commits). |
| `picker`      | `true` → fuzzy combobox; `false` → plain text passthrough (legacy).            |
| `placeholder` | Optional input placeholder.                                                    |

Contract guarantees:

- **No free-text leak** — typing clears the committed value until a candidate is
  chosen, so only real `"[[<uid>]]"` references reach frontmatter.
- **Value round-trip** — a committed `"[[<uid>]]"` that matches a candidate
  shows that candidate's label on mount (re-opening a pre-filled form is
  readable).
- **Accessibility** — ARIA combobox: ArrowDown/ArrowUp move the active option,
  Enter selects, Escape closes; `aria-controls` / `aria-activedescendant` wired.
- **Graceful degrade** — `picker={false}` (no candidates / no target class)
  renders a plain text input, so existing `assetRef` groundings keep working.

## Tests

- `packages/obsidian-plugin/tests/unit/presentation/components/ReferencePicker.test.tsx`
  — filter / select / keyboard / value round-trip / free-text degrade.
- `packages/obsidian-plugin/tests/unit/presentation/components/DynamicForm.test.tsx`
  — integration within the form.
