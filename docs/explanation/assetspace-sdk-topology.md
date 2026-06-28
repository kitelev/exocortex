# Exo-as-SDK: AssetSpaces, the `exoas-*` repos, and Profiles

> **Audience:** contributors and technical users trying to understand _why the vault is
> split across many git repositories_ and _what gets mounted when_.
> **Position:** conceptual orientation. For the runtime mechanics of mounting see
> [ARCHITECTURE.md → Profiles & AssetSpace Mounting](../../ARCHITECTURE.md#profiles--assetspace-mounting);
> for the full Profile model see [profile.md](profile.md); for syncing see
> [how-to/exosync.md](../how-to/exosync.md).

## The one mental model: Exo is an SDK, the vault is data

Exocortex deliberately separates **the engine** from **the data it operates on**:

- **`exo` is the SDK / platform** — the RDF parser, SPARQL engine, layout renderer, command
  machinery. It ships as code (the plugin + the `@kitelev/exocortex-cli`) and as a small core
  of class/property/command _definitions_. It knows nothing about _your_ domain.
- **The vault is the data** — your notes, projects, people, ontologies. The product is the
  vault _plus_ the SDK, and [every client must be able to drive the full system](../../VISION.md)
  (the no-lock-in north star, enforced by the UI/CLI Parity Invariant).

Borrowing from the JVM ecosystem, the rest of this doc uses one analogy throughout:

| Exocortex concept          | SDK-ecosystem analogy                                             |
| -------------------------- | ----------------------------------------------------------------- |
| `exo` (engine + core defs) | the platform / runtime                                            |
| an **AssetSpace**          | a **library (a jar)** — a versioned, shareable package of assets  |
| a **Profile**              | a **BOM / manifest** — the named set of libraries you want loaded |

The three questions below are just the three nouns in that table.

## 1. What is an AssetSpace?

An **AssetSpace** is a **git-backed repository of vault assets** that is mounted under
`assetspaces/` in your vault. Concretely it is described by a vault asset of class
`exo__AssetSpace` carrying a `exo__AssetSpace_source` (the GitHub `owner/repo` it clones
from); when mounted, its files live on disk at `assetspaces/<owner>/<repo>/`.

An AssetSpace is the **unit of packaging, sharing, and mounting**:

- **Packaging** — related assets travel together as one versioned repo (one ontology and its
  instances, one team's shared data, one person's private notes). Co-location is an invariant:
  an asset lives in the folder of the ontology its `exo__Asset_isDefinedBy` points at.
- **Sharing** — because it is a normal git repo, an AssetSpace can be public, private, or
  shared with a specific set of collaborators, independently of every other AssetSpace.
- **Mounting** — an AssetSpace is either _materialized_ (present on disk, indexed into the
  triple store) or _unmounted_ (absent). Only mounted, UID-bearing markdown participates in
  the graph. Two examples that always-or-often ship as AssetSpaces: `exoas-exo` (the core
  `exo` ontology) and `exoas-exocmd` (UI command definitions) — both also vendored as npm
  data submodules under `packages/`.

> An AssetSpace is **not** an Obsidian feature — it is an Exocortex concept layered on top of
> ordinary folders + git submodules. Obsidian just sees folders of markdown.

## 2. Why are there so many `exoas-*` repos?

Because the **axis of separation is sharing-audience, not topic**. The question each
AssetSpace answers is _"who is this allowed to be shared with?"_ — and that has many distinct
answers, so there are many repos. A single big vault repo could not give _personal_,
_work_, and _shared-with-one-collaborator_ data different visibility and different remotes.

The naming convention encodes the audience directly:

- **`exoas-<domain>`** — a domain you own (e.g. a personal-knowledge space, a work space).
  Private by default unless the domain is meant to be public.
- **`exoas-shared-<audience>`** — data deliberately shared with a named audience (a team, a
  specific collaborator).
- **Public spaces** — `exoas-exo` (the SDK floor), `exoas-exocmd`, and the W3C-vocabulary
  space are public because the SDK and its vocabulary are not secret.

This split buys four things that a monorepo-vault cannot:

1. **Privacy boundaries are physical.** A private AssetSpace that is not in your active
   Profile is _not on disk_ — it cannot leak into search, SPARQL, or a screenshot.
2. **Per-audience remotes & permissions.** Each repo has its own GitHub visibility and
   collaborators; sharing one space with someone never exposes another.
3. **Independent versioning.** A library you depend on can be updated (pointer-bumped) without
   touching unrelated data.
4. **Faster indexing on constrained devices.** A phone mounts only the spaces it needs instead
   of reindexing everything.

The set of available spaces is itself data: a **registry** AssetSpace holds the
`exo__AssetSpace` descriptors (and their dependency edges), and a **profiles** space holds the
Profile assets that compose them. Bootstrapping a fresh vault is therefore: clone the `exo`
core → add the registry + profiles spaces → apply the profile you want.

## 3. What is a Profile?

A **Profile** (`exo__Profile`) is a **vault-declared, named set of AssetSpaces to mount** — the
BOM in the analogy. It is a regular markdown asset with two declarative properties:

- `exo__Profile_includes` — the AssetSpaces this profile activates.
- `exo__Profile_imports` — an optional parent profile to compose (so a "reading" profile can
  import a "base" profile rather than re-listing its spaces).

There is **one** operation over a profile — **`Cmd+P → Exocortex: Apply profile`** — and it
performs a **mount-state strict replace**: the profile's _effective set_ is materialized on
disk and everything else is unmounted. The effective set is:

```
exo__Profile_includes  ∪  transitive(exo__Profile_imports)  ∪  the TS-floor
```

The **TS-floor** is the always-mounted minimum — `{exo}` (the SDK core; `exocmd` and
shared-identity spaces are optional add-ons). Applying a profile that omits `exo` is
**refused**, not silently repaired, because stripping the core would self-brick the plugin
(no class definitions, no commands). Applying is crash-safe (2-phase commit + journal +
recovery on load) and works on mobile through a REST/tarball transport when no git binary is
present.

The result: switching from a _work_ context to a _personal_ one is a single command that
physically swaps which repositories exist on disk — privacy, focus, and index size all follow
from the mount state.

## Where to go next

- [profile.md](profile.md) — the complete Profile model (apply semantics, atomicity, recovery).
- [ARCHITECTURE.md → Profiles & AssetSpace Mounting](../../ARCHITECTURE.md#profiles--assetspace-mounting) — the runtime components (`ProfileApplyManager`, `TsFloorGuard`, transports).
- [how-to/exosync.md](../how-to/exosync.md) — how mounted AssetSpaces sync with their GitHub remotes.
- [VISION.md](../../VISION.md) — the no-lock-in / vault-is-the-product rationale behind the SDK split.
