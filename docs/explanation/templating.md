# Why homoiconic templating

> Subproject `17f58ebe` (vision `09a3fbec`) · PRs #3637 (v16.116.0), #3641 (v16.121.0)
> Task guide: [Insert tokens & apply body templates](../how-to/templating.md) ·
> Reference: [Templating reference](../reference/templating.md)

Templating in Exocortex is **homoiconic**: a template is a vault asset, not a
file in a hidden plugin folder or a string baked into TypeScript. This page
explains why, and how it differs from the Obsidian _Templates_ / _Templater_
plugins it replaces.

## The problem with conventional templating

The Obsidian _Templates_ core plugin and the _Templater_ community plugin store
templates as plain files in a designated folder and expand a fixed set of
`{{date}}`-style placeholders. Two things sit outside the knowledge graph:

- **The templates themselves** are just files — not assets. You cannot query
  them, link to them, classify them, or reason over them the way you do every
  other thing in the vault.
- **The placeholder vocabulary** is a parallel, plugin-specific mini-language.
  A `{{date}}` in a template and a date written by some other automation are
  produced by different code with different formats.

## The homoiconic answer

Exocortex applies its [Homoiconicity Invariant](../../CLAUDE.md): anything a
user can configure should be describable as vault assets (an RDF graph), with
TypeScript reserved for the processing core, platform integration, and
structural guard rails.

Templating follows that to the letter on two axes:

### Templates are assets

A body template is an instance of the `exotemplate__Template` class. Its
markdown **body** is the template content — there is no separate "body"
property, because "an `exotemplate__Template` asset's body is its file body."
That means a template is a first-class citizen: it has a UID and a label, it
lives in an AssetSpace (`exoas-public`), it can be linked, queried, and shared
exactly like any other asset. The "Insert template" command simply enumerates
the assets of that class — there is no template folder to configure and no
hardcoded block list.

### Tokens reuse one vocabulary

The vision spoke of "variables", but there is **no** `exotemplate__Variable`
class. Placeholders are the **existing** `exocmd__SubstitutionToken`
vocabulary, resolved through the single shared `SubstitutionResolverRegistry`.
A `$today` typed into a template body and a `$today` resolved while a
`create_instance` command builds an asset go through the very same resolver —
one source of truth, identical output. Adding a new token benefits hand-insert,
template bodies, and RDF-driven creation at once.

## How the three surfaces compose

The same two primitives — "a template body" and "token resolution" — power
three user-facing surfaces, each a thin layer over shared core code:

| Surface | What it is | Shared core it reuses |
|---|---|---|
| `Insert template token` | scalar value at the cursor | the resolver registry |
| `Insert template` | a template asset's body at the cursor | body strip + token resolution |
| `body_template` grounding | a template body copied into a created asset | body strip + token resolution |

Because the strip-and-resolve logic lives once in the core package, the plugin
editor command, the plugin's create-instance pipeline, and the CLI all behave
identically — no per-consumer drift.

## Desktop ↔ mobile parity

The editor surfaces are pure editor operations — no `git`, Node, or filesystem
dependency — so they are registered unconditionally and behave the same on
desktop and iOS, per the [Desktop↔Mobile Command Parity Invariant](../../CLAUDE.md).
The `body_template` grounding writes through the same vault-adapter path the
rest of asset creation uses, so it is cross-platform too.

## A note on dates

The "Insert template token" date/timestamp choices resolve to **local** time
(`nowDate` / `nowTimestamp`), not UTC. The author works in UTC+5 in the early
morning, when a UTC date is still "yesterday" — a local date matches the user's
expectation and the no-timezone timestamp shape used elsewhere in the system.
Template bodies can use either family (`$nowDate` local, `$today` UTC); see the
[token reference](../reference/templating.md#substitution-tokens).

## Related

- [How-to: insert tokens & apply body templates](../how-to/templating.md)
- [Templating reference](../reference/templating.md)
- [assetspace-sdk-topology.md](assetspace-sdk-topology.md) — what an AssetSpace
  is and why templates live in `exoas-public`
