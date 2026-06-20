# Concepts — a tester's glossary

> **Audience:** alpha testers and new users.
> **What this is:** a fast, plain-language tour of the handful of Exocortex
> concepts you meet during setup and troubleshooting. Each entry links to the
> deep doc if you want the full story.

For the hands-on install path see [Getting Started](../tutorials/Getting-Started.md);
for the architectural narrative behind the vault split see
[assetspace-sdk-topology.md](assetspace-sdk-topology.md).

---

## The one-line mental model

**Exo is an SDK; your vault is the data.** The engine — the Obsidian plugin plus
the `@kitelev/exocortex-cli` — ships as code and a small core of class/property
definitions. Everything _about your domain_ (notes, projects, ontologies, and
even the action buttons and settings) lives in your vault **as data**. The
product is the vault _plus_ the engine, and every client can drive the whole
system. See [VISION.md](../../VISION.md).

---

## Glossary

### AssetSpace — _a library (a jar)_

A git-backed repository of vault assets, mounted under
`assetspaces/<owner>/<repo>/`. It is the unit of **packaging, sharing, and
mounting**: one ontology and its instances, one team's shared data, or your
private notes — each a separate repo with its own GitHub visibility. An
AssetSpace is either **materialized** (present on disk, indexed into the graph)
or **unmounted** (absent — invisible to search and SPARQL). The axis of
separation is _sharing-audience_, not topic — that is why there are many
`exoas-*` repos.
→ [assetspace-sdk-topology.md § What is an AssetSpace](assetspace-sdk-topology.md#1-what-is-an-assetspace)

### Profile — _a BOM / manifest_

A vault-declared, named set of AssetSpaces to mount: an `exo__Profile` asset with
`exo__Profile_includes` (the AssetSpaces it activates) and optional
`exo__Profile_imports` (a parent profile to compose). There is **one** operation
over it — **`Exocortex: Apply profile`** — and it performs a **mount-state strict
replace**: materialize the profile's effective set, unmount everything else.
Switching a _work_ context to a _personal_ one is a single command that
physically swaps which repositories exist on disk, so privacy, focus, and index
size all follow from the mount state.
→ [profile.md](profile.md) · [assetspace-sdk-topology.md § What is a Profile](assetspace-sdk-topology.md#3-what-is-a-profile)

### Mount-state

"Materialized" means the AssetSpace folder exists on disk — and the on-disk
directory is the **source of truth** for what's active, **not** `.gitmodules`
membership (the `.gitmodules` entry is kept as a per-vault URL registry even
while an AssetSpace is unmounted, so re-applying a profile can re-pull it).
Apply reconciles the on-disk set to the target profile's effective set.
→ [profile.md](profile.md)

### TS-floor — _the always-mounted minimum_

The core AssetSpace the engine cannot run without — currently `{exo}` (the
class/property definitions). It is **never unmounted**, and applying a profile
that omits it is **refused** (not silently repaired), because stripping the floor
would self-brick the plugin. `exocmd` (the UI-command library that draws the
action buttons) and shared-identity spaces are **optional** add-ons, not floor
members — a read-only / SPARQL-only vault works without them.
→ [profile.md](profile.md)

### Homoiconicity — _behaviour is data, not code_

Borrowing from LISP: the things you should be able to change **without editing
source code** — which buttons appear, layout structure, which classes/properties
exist, query logic for analytics — are all described by **vault assets (RDF)**,
not hardcoded. Hardcode is reserved for the engine, platform integration, and
graph-integrity guards. This is why action buttons come from the `exocmd`
AssetSpace and why plugin settings show up as `exo__Setting` notes in your vault.
→ [VISION.md](../../VISION.md) · [settings-homoiconization.md](settings-homoiconization.md) · [CLAUDE.md → Homoiconicity Invariant](../../CLAUDE.md)

### Co-location

Every asset physically lives in the folder of the ontology its
`exo__Asset_isDefinedBy` points at. Keeping an asset next to the ontology that
defines it is an invariant (enforced when notes are written), so an AssetSpace
stays a self-contained, movable package.

### UID-canon — _why files are named by UUID_

Most assets are filenamed by their `exo__Asset_uid` (a UUID), with the
human-readable name in `exo__Asset_label`. UUID filenames give every asset a
stable identity that survives renames and bridges the two IRI schemes the engine
uses — so links never break when you rename a note. (A short whitelist — the
daily / weekly calendar notes — keeps date-based filenames so calendar plugins
still recognise them.)
→ [CLAUDE.md → UUID-canon TBox](../../CLAUDE.md)

### PAT — _GitHub Personal Access Token_

A fine-grained GitHub token the plugin uses to **pull private** AssetSpaces and
**push** your changes. It is stored device-local in `data.local.json` (never
synced, never committed). The fully-public starter onboarding needs none.
→ [Getting Started → Plugin Settings](../tutorials/Getting-Started.md#plugin-settings) · [Troubleshooting → GitHub auth](../how-to/Troubleshooting.md#github-auth--personal-access-token-pat)

### ExoSync — _GitHub-backed vault sync_

Synchronizes your mounted AssetSpaces directly against their GitHub repos over
the REST API — no Obsidian Sync subscription and no `git` binary, so the same
path works on desktop and iOS. One **`Exocortex: Sync`** runs pull → merge → push
per repo; conflicts it cannot safely merge go to **quarantine** and re-derive
every sync until you make the two sides converge.
→ [exosync.md](../how-to/exosync.md)

### FileSpace — _an attachments space_

Like an AssetSpace, but for opaque binary blobs (`exo__FileSpace`): its contents
are never parsed into the graph. Conflicts are deterministic remote-wins, so
file-mode sync requires a quarantine repo to preserve the losing local copy.
→ [exosync.md § FileSpaces (attachments)](../how-to/exosync.md#filespaces-attachments)

### BRAT

The community plugin that installs and auto-updates Exocortex straight from its
GitHub releases (Exocortex is not in the Obsidian community-plugin store yet).
Adding and updating the plugin run through BRAT's **command-palette** actions.
→ [Getting Started → Install via BRAT](../tutorials/Getting-Started.md#step-1-install-via-brat)

---

## Where to go next

- [Getting Started](../tutorials/Getting-Started.md) — install + first vault, hands-on.
- [assetspace-sdk-topology.md](assetspace-sdk-topology.md) — the full "exo is an SDK" narrative.
- [profile.md](profile.md) — the complete Profile model (apply semantics, atomicity, recovery).
- [exosync.md](../how-to/exosync.md) — syncing mounted AssetSpaces with their GitHub remotes.
- [Troubleshooting → Setup, auth & sync](../how-to/Troubleshooting.md#setup-auth--sync) — when something operational goes wrong.
