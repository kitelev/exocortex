# Profile — Vault-Declared Context

> **Status:** Production-ready.
> **Audience:** Engineers and technical Obsidian users.
> **Position:** Architectural cornerstone — the feature that makes Exocortex genuinely multi-context.

> ℹ️ **One model, one operation.** A profile is a vault-declared **group of
> AssetSpaces**, and there is a **single** operation over it —
> **`Exocortex: Apply profile`** (mount-state strict replace: materialize the
> profile's effective AssetSpaces, unmount the rest; the TS-floor is never
> unmounted). Earlier iterations split profile activation into two mechanisms
> and, earlier still, into two separate profile classes; both splits were
> superseded. There is now one `exo__Profile` class (same UID `3de846cd`) and one
> apply operation — the former query-time RDF filter was removed (it was a no-op
> reindex), so profile activation is mount-state only. The historical class names
> and the prior two-mechanism design live in `CHANGELOG.md`.

---

## What a Profile is

A **Profile** (`exo__Profile`) is a vault-declared subset of AssetSpaces that the
Exocortex plugin materializes on disk at runtime. It is a regular Markdown asset
with class `exo__Profile` and two declarative properties:

- `exo__Profile_includes` — list of **AssetSpace** UID wikilinks (library
  packages) that this profile activates.
- `exo__Profile_imports` — optional parent profile to compose (single-parent
  MVP, 0..1; transitive 0..N + cycle-guard is a future phase).

There is no "always-on overlay" property — "always-on" is the **TS-floor**
(`exo` only — RFC `5aa2a73a`), enforced at AssetSpace-UID level regardless of
profile config. The TS-floor holds the core class definitions the knowledge
engine needs to function, so it is never unmounted. `exocmd` (UI commands) and
`shared-identities` (cross-cutting anchors) are **optional** AssetSpaces, not
floor members — a read-only/SPARQL-only vault works without them (no buttons,
no crash).

Concrete profiles already shipping in production vaults:

- **profile-personal** — the kitelev personal stack (GTD, EMS for life tasks).
- **profile-work** — T-Bank areas, professional KPC.
- **profile-reading** — research, lit conspects, ZTLK notes.
- **profile-base** — the anchor every other profile composes via `_imports`.

Applying a profile consumes a target profile UID and the plugin's
`ProfileApplyManager` orchestrates the rest.

---

## The problem it solves

Knowledge management at scale runs into four predictable failure modes:

1. **iPhone reindex storm.** Open the vault on mobile after several weeks of
   desktop authoring → Obsidian's indexer rescans the entire vault, hangs the UI
   for 8–12 minutes, drains battery. Root cause: every file in `assetspaces/` is
   parsed, even ontologies the user does not currently need.
2. **Cognitive load from irrelevant assets.** Search, SPARQL, graph view, and the
   command palette surface every asset across every ontology — including ones
   installed years ago and forgotten. Signal-to-noise collapses as ontology count
   grows.
3. **Privacy boundary leakage between work and personal contexts.** A single
   Obsidian window shows both T-Bank and personal projects. Screen sharing during
   a call leaks unrelated context. The naive workaround — separate vaults —
   destroys the cross-context queries ("show me all tasks across all areas") that
   are the whole point of a unified knowledge graph.
4. **Tight coupling without declared imports.** Ontologies depend on each other
   transitively, but the dependencies live nowhere as data. Removing one breaks
   downstream queries silently. There is no `package.json`-style declared import
   system for ontologies — except Profile.

Profile addresses all four by separating **declared profile membership**
(homoiconic, in the vault) from **runtime mount state** (per-device, in
`data.local.json`) and reconciling them with one apply operation.

---

## Architecture — Vault-as-Graph foundation

Exocortex treats the vault as an **RDF triple store**, not a document store with
metadata. Every Markdown file with YAML frontmatter contributes triples; every
wikilink is a typed edge; every property is a predicate from a namespace
(`exo:`, `ems:`, `exocmd:`, ...). SPARQL queries are the first-class navigation
primitive.

Profile inhabits this graph as **first-class data**, not configuration. The class
definition lives in the `exo` ontology submodule:

```yaml
# exo__Profile (UID 3de846cd-1f0e-4f98-8613-b8587aa15174)
exo__Asset_label: exo__Profile
exo__Class_superClass: "[[exo__Asset]]"
exo__Class_description: |
  Vault-declared group of AssetSpaces for runtime materialization.
  Drives which submodules are mounted on disk via the Apply profile operation.
```

The plugin discovers profile assets by scanning the metadata cache for
`exo__Instance_class: [[exo__Profile]]`. The active profile UID is stored in
`data.local.json` (Sync-excluded by Obsidian convention) so the same vault can
have different active contexts on phone, laptop, and tablet without conflict.

Because the profile is data, **`git diff` shows the change**: adding an AssetSpace
to a profile is a one-line edit to its `_includes` list — reviewable,
version-controlled, revertable. There is no buried plugin setting that drifts
between machines.

The **homoiconic invariant** (RFC `c78cc5c8`) — user-configurable semantics live
in the vault, not in TypeScript — is what makes this possible. The plugin code is
the runtime engine; the profile is the program it executes.

---

## The Apply profile operation

There is one operation: **`Exocortex: Apply profile`**. It is a **mount-state
strict replace** — it reconciles the on-disk set of AssetSpaces to exactly the
target profile's effective set.

**Effective set** of a target profile:

```
effective(P) = P._includes
             ∪ transitive(P._imports*)      (parent-profile composition)
             ∪ TS-floor                       (exo only)
```

Apply then computes a diff against what is currently materialized on disk and:

- **Materializes** every AssetSpace in the effective set that is not present
  (restore from cache or pull from GitHub).
- **Unmounts** every AssetSpace currently present that is not in the effective
  set (cache, then tear down).
- **Leaves the TS-floor untouched** — it is always materialized.

After a successful apply, the target profile UID is persisted as
`activeProfileUid` in `data.local.json` — a **last-applied cache**, not a live
filter. It records "which profile this device last reconciled to"; the on-disk
state is the source of truth.

### Apply on a git-backed vault (commit first)

On a **git-backed vault** (the recommended setup for submodule mode), apply
**refuses to tear down an AssetSpace that has uncommitted changes** — it would
otherwise destroy un-pushed work. This is the Vision Lock #5 _uncommitted abort_
guard, surfaced as `UncommittedChangesAbortError`:

```
Apply aborted — N uncommitted file(s) in M AssetSpace(s) this profile would
remove. Commit or stash the vault before applying.
```

This trips up a **fresh** onboarding flow, because the 3-step setup
(**Bootstrap → Add registry/profiles → Apply profile**) pulls the AssetSpace
folders into `assetspaces/` as **untracked** files. Git sees those untracked
files as "uncommitted", so the very first apply that needs to unmount one of them
aborts.

**Fix — commit the vault once before the first apply:**

```bash
# From the vault root, after Bootstrap + Add-AssetSpace, before Apply profile:
git add -A
git commit -m "vault setup"
```

Then re-run **`Exocortex: Apply profile`**.

> **⚠️ Protect your PAT.** A fresh vault has no `.gitignore`, so `git add -A`
> would commit `.obsidian/data.local.json` — which holds your GitHub **personal
> access token**. Before committing, add a `.gitignore` at the vault root:
>
> ```gitignore
> .obsidian/
> .exocortex/
> ```
>
> (`.obsidian/` keeps the PAT + device-local plugin state out of git;
> `.exocortex/` is the local switch-cache / journal, also device-local.)

Apply does **not** auto-commit for you — committing is an explicit, user-owned
git action (auto-commit-then-apply would blur the apply atomicity boundary; see
_Partial-failure boundary_ below). The guard is intentional: it never silently
destroys uncommitted work.

### Floor policy (R24) — refuse, don't rescue

Apply is destructive, so it requires **explicit intent**. Before any mutation, a
TS-floor assertion checks the profile's **declared** `_includes` (not the
floor-injected effective set). If the target profile would omit a TS-floor
AssetSpace, apply **refuses** (`TsFloorViolationError`) rather than silently
re-adding the floor — stripping the floor would self-brick the plugin (no core
class definitions). The floor is still injected into the actual mutation
diff for completeness, but only after the guard has approved the user's intent.

---

## 2-phase commit safety

Apply destroys local files. That demands the same discipline as a database write.

The orchestration in `ProfileApplyManager.applyProfile()` runs in two strict
phases:

```
Phase 1 — Pull all to-materialize AssetSpaces to staging dirs
   For each AS in toMaterialize:
     - If SwitchCacheLayer.has(AS, validSha) → restore from cache to staging.
     - Else: GitHubRestClient.pullTarball() → TarExtractor.extract() to staging.
   ABORT IF any pull fails (no destruction has happened yet — vault is intact).

Phase 2 — Atomic destroy + extract (only after Phase 1 fully succeeds)
   For each AS in toDestroy:
     - SwitchCacheLayer.cache(AS) — tar -czf, verified non-empty + parseable.
     - git submodule deinit + rm <vault>/assetspaces/<AS>  (.gitmodules entry preserved).
   For each AS in toMaterialize:
     - mv staging/<AS> → vault/assetspaces/<AS>; re-init or `git submodule add`.
```

The key invariant: **no AssetSpace is destroyed before every AssetSpace in
`toMaterialize` is staged successfully**. If GitHub is unreachable mid-Phase-1,
the vault is identical to before the attempt. If the plugin crashes mid-Phase-2
(between destroy and materialize), a per-AssetSpace journal lets
`recoverIncompleteSwitch()` read which AssetSpaces were destroyed-but-not-yet-materialized
and restore them from `SwitchCacheLayer`.

The `.gitmodules` entry of an unmounted AssetSpace is **preserved** (Vision Lock
#9 amendment) — it serves as a per-vault URL registry so re-applying a profile
can re-init the submodule from the known URL. Materialization state therefore is
**not** `.gitmodules` membership; the source of truth for "is currently
materialized" is the working-tree directory existing on disk.

The cache verification gate — `SwitchCacheLayer.cache()` validates the archive is
non-empty and parseable before allowing destroy — closes the silent-data-loss
footgun: a disk-full mid-tar can produce a zero-byte archive that "succeeds" with
exit 0. The verification step refuses the destroy if the tar is not whole.

```
                              ┌─────────────────────────┐
                              │     applyProfile()      │
                              └───────────┬─────────────┘
                                          │
            ┌─────────────────────────────┼─────────────────────────────┐
            │                             ▼                             │
            │            ┌────────────────────────────┐                 │
            │ Phase 1 →  │ For AS in toMaterialize:   │                 │
            │            │   cache hit? restore       │                 │
            │            │   miss? pullTarball+extract│                 │
            │            └─────────────┬──────────────┘                 │
            │                          │ all OK? no destroy yet         │
            │                          ▼                                │
            │            ┌────────────────────────────┐                 │
            │ Phase 2 →  │ For AS in toDestroy:       │                 │
            │            │   cache(AS, verify) → rm   │                 │
            │            │ For AS in toMaterialize:   │                 │
            │            │   mv staging → vault       │                 │
            │            │   git submodule re-init    │                 │
            │            └─────────────┬──────────────┘                 │
            │                          │                                │
            │                          ▼                                │
            │            ┌────────────────────────────┐                 │
            │            │ journal: completed         │                 │
            │            └────────────────────────────┘                 │
            └─────────────────────────────────────────────────────────-─┘
```

Crash recovery worker `recoverIncompleteSwitch()` runs on every plugin onload
when `_switchInProgress=true` is detected:

1. Reads journal tail.
2. Identifies destroyed-but-not-materialized AssetSpace UIDs.
3. Restores each from `SwitchCacheLayer` to vault.
4. Logs recovery outcome. Clears `_switchInProgress` flag.

### Partial-failure boundary — what the 2-phase commit does and does NOT cover

The 2-phase design makes the **common** failure modes safe, but apply is **not
fully atomic** on every partial failure. Know the exact boundary
(tracked for hardening in [issue #3548](https://github.com/kitelev/exocortex/issues/3548)):

**Covered (safe):**

- A failure **during Phase 1** (any pull fails) leaves the vault byte-identical
  to before the attempt — nothing is destroyed.
- A **crash** mid-Phase-2 is reconciled on next onload: `recoverIncompleteSwitch()`
  restores every destroyed-but-not-materialized AssetSpace from `SwitchCacheLayer`.
- A cache-verify gate prevents a corrupt/zero-byte archive from authorizing a destroy.

**Not yet atomic (desktop):** if a step **fails** mid-Phase-2 (e.g. a
`git submodule add` errors out on the 2nd of several AssetSpaces), the in-process
catch restores the _destroyed_ AssetSpaces from cache (best-effort) but does **not**
git-reset the working tree. The vault is therefore left with **uncommitted
`.gitmodules`/submodule changes** and possibly one **partially-added** AssetSpace —
the apply git-commit only runs on success. The vault content is recoverable, but
not in a clean committed state until you re-run apply (which reconciles) or reload
(which runs the recovery worker).

**Not yet atomic (mobile / REST):** the mobile path does unmount-then-mount with
**no rollback and no cache** — if a mount fails after an unmount, that AssetSpace
is simply absent until you re-run apply. The state self-heals on re-run (mount-state
is self-describing: folder-exists = active; REST mount/unmount are idempotent), but
there is no automatic restore of an interrupted unmount.

### If an apply fails or is interrupted — recovery ordering

Apply is destructive, so treat a failed/interrupted apply like an interrupted
database write. In order:

1. **Don't panic — nothing is silently corrupted.** AssetSpace content is either
   on disk, in `SwitchCacheLayer` (desktop), or re-pullable from GitHub.
2. **Reload Obsidian** (`Reload app without saving`). On load, the recovery worker
   restores any destroyed-but-not-materialized AssetSpaces from cache and clears the
   in-progress flag.
3. **Re-run «Exocortex: Apply profile»** to the same target. Apply is a strict
   mount-state reconcile — re-running converges the vault to the target's effective
   set regardless of the partial state left behind.
4. **Desktop only — if `git status` in the vault shows uncommitted
   `.gitmodules`/`assetspaces/` changes** after a failed apply, this is the
   non-atomic window above: re-running apply (step 3) recommits cleanly; or commit
   the vault manually once the mount-state is correct.

To **minimize** the chance of hitting the window: commit (or stash) local changes
before applying — the desktop path aborts on uncommitted changes in any to-destroy
AssetSpace (Vision Lock #5) — and prefer a stable network/power state for a large
cold apply (many AssetSpaces pulled sequentially).

### Obsidian hangs at "Loading plugins…" after an apply

> **Fixed in the #3554 build.** Recovery/reconcile now runs after the workspace is
> ready, so onload can no longer deadlock. The steps below are the manual recovery
> for anyone still on a pre-#3554 build (e.g. an older BRAT install).

**Symptom:** right after a successful `Apply profile`, the _next_ Obsidian load (a
`Reload app without saving`, or a full quit + relaunch) gets stuck on
"Loading plugins…" forever — the workspace never finishes loading and the vault is
unusable. `Reload app in Restricted Mode` (community plugins off) loads fine, which
points at the Exocortex plugin's load path.

**Cause (pre-#3554):** a successful apply records the chosen profile in
`data.local.json` (`activeProfileUid`). On the next load, the plugin's onload
recovery/reconcile step ran **before** the UI was ready and could open a confirm
dialog that can never be answered while Obsidian is still loading — so plugin load
never finished and `layoutReady` never fired.

**Recovery (manual, one-time):**

1. Quit Obsidian.
2. Edit `<vault>/.obsidian/plugins/exocortex/data.local.json` and set
   `"activeProfileUid": null` (or delete that key). This does **not** undo the
   apply — the reduced mount stays exactly as applied; the profile just becomes
   "untracked" (no longer cached as the active selection).
3. Relaunch Obsidian. The vault loads normally.

After updating to the #3554 build the cache is safe again — you can re-select the
profile via `Apply profile` and `activeProfileUid` will be honoured on the next
load without any hang.

### Legacy flat-mount migration

Apply locates a materialized AssetSpace by its **canonical** mount path
`assetspaces/<owner>/<repo>` (`derivePath`). Vaults set up before #3538 may have
AssetSpaces mounted at the **legacy flat** path `assetspaces/<repo>` (the
`exoas-` prefix stripped) — the old `add-assetspace` / `bootstrap` layout. Apply
does **not** recognise a flat folder as materialized, so it would re-materialize
the same AssetSpace at the canonical path → a **double mount** of one AssetSpace
UID (duplicate triples, SHACL noise).

Apply now **detects** this and shows a one-time Notice naming each affected
AssetSpace as `<label> (assetspaces/<repo> → assetspaces/<owner>/<repo>)`. Apply
does **not** auto-migrate (a runtime directory move on the destructive apply path
is intentionally out of scope — see the
[partial-failure boundary](#partial-failure-boundary--what-the-2-phase-commit-does-and-does-not-cover)).
Migrate manually, once, per affected AssetSpace:

1. **Commit or stash** any local changes in the vault first (treat this like the
   recovery flow above).
2. **Remove the legacy flat mount.** The goal is to delete the flat folder and
   its stale `.gitmodules` entry, so apply re-creates the AssetSpace at the
   canonical path.
   - **Desktop** (vault root, the flat path is a real git submodule):
     ```bash
     git submodule deinit -f assetspaces/<repo>
     git rm -f assetspaces/<repo>            # drops the .gitmodules entry + index
     rm -rf .git/modules/assetspaces/<repo>  # clear the submodule git dir
     git commit -m "chore: remove legacy flat-mount assetspaces/<repo>"
     ```
   - **Mobile** (no git binary): delete the `assetspaces/<repo>` folder (Files app,
     or from a synced desktop), and remove its `[submodule "assetspaces/<repo>"]`
     stanza from `.gitmodules`.
3. **Re-run «Exocortex: Apply profile»** to your current profile. Apply now finds
   no materialized copy and re-materializes the AssetSpace at the canonical
   `assetspaces/<owner>/<repo>` path. The warn Notice no longer appears.

Fresh vaults bootstrapped on #3538+ mount canonically from the start and never
see this Notice.

---

## Cross-device model

A subtle design decision: the active profile **must not** sync across devices.
Otherwise, applying "work" on the laptop forces the phone into work too, defeating
mobile's whole reason to be on a different profile.

The split:

- **Synced (lives in vault git submodules + main vault repo):**
  - All `exo__Profile` assets (the profile declarations themselves).
  - `.gitmodules` — the per-vault URL registry of every known AssetSpace.
  - `assetspaces/*` — the actual ontology content currently materialized.

- **Per-device (lives in `data.local.json`, Sync-excluded by the `.local.` infix convention):**
  - `activeProfileUid` — the last profile this device applied.
  - `_switchInProgress` — crash-recovery flag.
  - `_activeStagingDirs[]` — orphan-cleanup pointers for `mktemp` staging.

When a device starts up, the manager reconciles divergence between the synced
on-disk state and the per-device last-applied profile. Users typically never see
a prompt unless they manually swap submodules outside the plugin.

On **mobile**, where the git binary is unavailable, apply delegates to a
REST/tarball mount/unmount path (no staging dir, no cache, no git commit); the
desktop git-binary path is unchanged. Because the mobile path has no cache layer,
it has **no automatic rollback** on a partial failure — see the
[partial-failure boundary](#partial-failure-boundary--what-the-2-phase-commit-does-and-does-not-cover)
above (it self-heals on re-run).

---

## Privacy through normalization — UID-canon framing

This is the architectural angle that does not exist in any competing tool.

**Claim:** when (a) every asset filename is `<uuid>.md`, (b) every wikilink uses
canonical UID form `[[<uuid>|<label>]]`, and (c) `exo__Asset_label` is the only
source of human-readable naming — then vault content becomes **semantically
opaque at the file-byte / git-diff / shared-file layer** without the ontology +
label lookup.

Concretely (raw bytes / git diffs / files exported outside the vault):

- A raw `.md` file shared via email, Slack, or git URL references other assets
  only by UUID. A reader cannot derive what
  `[[1b20a8f0-d745-4e93-91db-4531b3df120e|something]]` means without the rest of
  the graph.
- A `git diff` shows UUID-named files and UUID-targeted wikilinks; the change is
  structurally visible but semantically opaque.
- An attacker with cold-disk access sees the structure but not the labels (when
  not paired with the rest of the vault).

**Important caveat — rendered Obsidian views are not protected.** Obsidian renders
wikilinks live with the target's `exo__Asset_label`, so screenshots and screen
shares of the active editor view typically display **labels**, not UUIDs.
UID-canon obfuscation protects:

- **Raw file sharing** — sending a single asset's `.md` reveals UUIDs but not
  domain meaning of references.
- **Git diff review** — code-review tools show UUIDs in additions/deletions.
- **Public knowledge graph publishing** — exposing graph topology without labels.
- **AI-agent collaboration on raw vault bytes** — agents reading filesystem bytes
  see UUIDs only; supplying labels is an explicit step.

For **rendered-view protection** (screen sharing live calls, demo videos showing
the editor), additional measures are needed. **Apply is the strongest
protection:** AssetSpaces holding sensitive content (e.g. therapy notes,
personal-finance specifics) are physically absent from disk in the non-active
profile, so their labels cannot be resolved at all. A forensic snapshot of the
laptop in work context contains zero bytes of personal content. This is privacy
beyond obfuscation — it is **absence**.

Compared to Obsidian Sync's at-rest encryption:

| Property      | Obsidian Sync E2E encryption                                        | UID-canon obfuscation               |
| ------------- | ------------------------------------------------------------------- | ----------------------------------- |
| Threat model  | Bytes intercepted in transit / at rest in cloud                     | Bytes visible but meaning opaque    |
| Defense layer | Cryptographic (AES-256)                                             | Naming convention + ontology lookup |
| Compose?      | Yes — encrypted bytes that, even decrypted, reveal UUIDs not labels | —                                   |
| Suited for    | Adversary with cloud access                                         | Adversary with on-screen visibility |

Both are valid; they protect different surfaces. Encryption protects in-transit
and cloud-at-rest; UID-canon obfuscates the meaning of bytes one already has;
apply removes sensitive AssetSpaces from disk entirely. They compose orthogonally.

---

## Materialization is runtime-derived

`exo__AssetSpace_materialized` is a **runtime-derived** property: it is computed
from the filesystem, not persisted. It reflects current on-disk presence in
SPARQL and the inline ✅ / ⏸ badge on AssetSpace pages. A manual `rm` or `cp`
cannot create stale state in SPARQL or UI — the value always tracks reality.

---

## CLI parity

Every Apply-profile capability is reachable from the CLI for automation and
AI-agent scripting — the UI/CLI Parity Invariant (see
[../VISION.md](../VISION.md#uicli-parity-invariant)). The CLI uses the same
profile-apply core as the plugin palette (`IConfirmGate` + a headless adapter),
so behavior is consistent between the two clients; the `--yes` flag bypasses
interactive confirmation for non-interactive contexts (CI, AI agents).

```bash
# See the exact profile-apply command and its flags (--vault, --yes, --ref, --token):
npx @kitelev/exocortex-cli --help
```

> The CLI binary command name is being aligned to the unified apply model; run
> `--help` for its current form rather than hardcoding it in scripts.

---

## Vision Lock decisions

The RFC interview process captured architectural decisions that shaped the
implementation. Key ones:

- **Atomic intent.** Destroy depends on cache success. Cache write verification
  gates destroy.
- **Cache retention indefinite by default.** `SwitchCacheLayer` holds prior
  AssetSpace tarballs (LRU eviction is a future follow-up). Re-applying a prior
  profile is instant; disk cost is bounded by ontology growth rate.
- **Materialization is runtime-derived.** `exo__AssetSpace_materialized` is
  computed from filesystem, not persisted. Manual `rm`/`cp` cannot create stale
  state in SPARQL or UI.
- **Active profile is per-device, not synced.** The `.local.` infix convention is
  the boundary.
- **TS-floor preservation.** `exo` always materializes regardless of profile
  (floor = `{exo}`, RFC `5aa2a73a`). Stripping the floor would self-brick the
  plugin. `exocmd` and `shared-identities` are optional AssetSpaces, not floor
  members.
- **No transitive AssetSpace expansion (yet).** Listing `pmbok` in a profile's
  `_includes` does **not** auto-add `ems`, even though `pmbok` references `ems`.
  List every AssetSpace the profile needs explicitly. `.gitmodules` is a flat
  manifest and cannot express a semver-range / transitive-resolution graph; a
  future "transitive" phase may lift this. Until then: if an apply leaves a query
  empty, check that you listed every AssetSpace it depends on.

For the full list and trade-off reasoning, read the RFC bodies.

---

## See also

- **[README.md — Profile section](../README.md)** — high-level feature blurb.
- **[VISION.md — Vault-as-Graph + Homoiconic Profiles + UID-canon](../VISION.md)** — philosophical positioning.
- **[CHANGELOG.md](../CHANGELOG.md)** — release progression and historical terminology.
- **RFC `b6ba5595`** — original Profile RFC.
- **RFC `0a0791c1`** — Phase 4/5 RFC (Settings UI, palette commands, CLI parity, apply-model consolidation).
- **RFC `22b50a17`** — 2-phase commit, materialization tracker.
