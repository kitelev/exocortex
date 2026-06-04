# FocusProfile — Vault-Declared Context Switching

> **Status:** Production-ready since v16.51 (soft + hard switch shipped).
> **RFC:** [22b50a17](https://github.com/kitelev/exocortex) — Phase 5 hard switch.
> **Audience:** Engineers and technical Obsidian users.
> **Position:** Architectural cornerstone — the feature that makes Exocortex genuinely multi-context.

> ⚠️ **Terminology update (v16.59, RFC 13da049f).** This page predates the
> **Knowledge profile vs Focus profile** split. Since then the two switch modes
> are first-class, separately-named profile types: the **hard switch** described
> below is now the **Knowledge profile** (`exo__KnowledgeProfile`), and the
> **soft switch** is the **Focus profile** (`exo__FocusProfile`). For the
> distinction, examples, and which one to edit, start with
> **[profiles.md](./profiles.md)**; read the "hard switch" sections here as the
> Knowledge-profile machinery.

---

## What FocusProfile is

A **FocusProfile** is a vault-declared subset of ontologies that the Exocortex plugin activates at runtime. It is a regular Markdown asset with class `exo__FocusProfile` and three declarative properties:

- `exo__FocusProfile_includes` — list of AssetSpace (ontology submodule package) wikilinks that this profile activates.
- `exo__FocusProfile_extends` — optional parent profile to inherit from (chain depth ≤ 5, cycle-free).
- `exo__FocusProfile_alwaysOnOverlay` — AssetSpaces that always materialize regardless of which profile is active (the **TS-floor**: `shared-identities`, `exo`, `exocmd`).

Concrete profiles already shipping in production vaults:

- **profile-personal** — 8 AssetSpaces (kitelev personal stack, GTD, EMS for life tasks).
- **profile-work** — 5 AssetSpaces (T-Bank areas, professional KPC).
- **profile-reading** — 3 AssetSpaces (research, lit conspects, ZTLK notes).
- **profile-base** — overlay anchor; declares the TS-floor that every other profile inherits.

A switch consumes a target profile UID and the plugin's `FocusProfileSwitchManager` orchestrates the rest.

---

## The problem it solves

Knowledge management at scale runs into four predictable failure modes:

1. **iPhone reindex storm.** Open vault on mobile after several weeks of desktop authoring → Obsidian's indexer rescans the entire vault, hangs the UI for 8–12 minutes, drains battery. Root cause: every file in `assetspaces/` is parsed, even ontologies the user does not currently need (e.g. `pmbok-ontology` weighing 30 MB across hundreds of UID-named files when the user only wants to capture a fleeting note about a book).
2. **Cognitive load from irrelevant assets.** Search results, SPARQL queries, graph view, and command palette surface every asset across every ontology — including ones the user installed years ago and forgot. The signal-to-noise ratio collapses as ontology count grows.
3. **Privacy boundary leakage between work and personal contexts.** Same Obsidian window shows tasks from both T-Bank and personal projects. Screen sharing during a call leaks unrelated context; a colleague glancing at your laptop sees your therapy session notes. Workaround — separate vaults — destroys cross-context queries ("show me all tasks across all areas") that are the whole point of a unified knowledge graph.
4. **Tight coupling without declared imports.** Ontologies depend on each other transitively (e.g. `kpc` references `shared-identities`; `pmbok-ontology` references `ems`), but the dependencies live nowhere as data. Removing an ontology breaks downstream queries silently. There is no `package.json`-style declared import system for ontologies — except FocusProfile.

FocusProfile addresses all four by separating **declared profile membership** (homoiconic, in the vault) from **runtime activation state** (per-device, in `data.local.json`) and offering two switching modes that trade off between immediacy and physical isolation.

---

## Architecture — Vault-as-Graph foundation

Exocortex treats the vault as an **RDF triple store**, not a document store with metadata. Every Markdown file with YAML frontmatter contributes triples; every wikilink is a typed edge; every property is a predicate from a namespace (`exo:`, `ems:`, `exocmd:`, ...). SPARQL queries are the first-class navigation primitive.

FocusProfile inhabits this graph as **first-class data**, not configuration. The class definition lives in the `exo` ontology submodule:

```yaml
# exo__FocusProfile (UID 3de846cd-1f0e-4f98-8613-b8587aa15174)
exo__Asset_label: exo__FocusProfile
exo__Class_superClass: "[[exo__Asset]]"
exo__Class_description: |
  Vault-declared subset of ontologies for runtime activation.
  Drives RDF graph filtering (soft) and submodule materialization (hard).
```

The plugin's `VaultProfileResolver` discovers profile assets by scanning the metadata cache for `exo__Instance_class: [[exo__FocusProfile]]`. The active profile UID is stored in `data.local.json._activeProfileUid` (Sync-excluded by Obsidian convention) so the same vault can have different active contexts on phone, laptop, and tablet without conflict.

Because the profile is data, **`git diff` shows the change**: adding an AssetSpace to a profile is a one-line edit to the profile's `_includes` list, reviewable, version-controlled, revertable. There is no buried plugin setting that drifts between machines.

The **homoiconic invariant** (RFC `c78cc5c8`) — user-configurable semantics live in the vault, not in TypeScript — is what makes this possible. The plugin code is the runtime engine; the profile is the program it executes.

---

## Privacy through normalization — UID-canon framing

This is the architectural angle that does not exist in any competing tool.

**Claim:** when (a) every asset filename is `<uuid>.md`, (b) every wikilink uses canonical UID form `[[<uuid>|<label>]]`, and (c) `exo__Asset_label` is the only source of human-readable naming — then vault content becomes **semantically opaque at the file-byte / git-diff / shared-file layer** without the ontology + label lookup.

Concretely (raw bytes / git diffs / files exported outside the vault):

- A raw `.md` file shared via email, Slack, or git URL references other assets only by UUID. A reader cannot derive what `[[1b20a8f0-d745-4e93-91db-4531b3df120e|something]]` actually means without the rest of the graph.
- A `git diff` shows UUID-named files and UUID-targeted wikilinks; the change is structurally visible but semantically opaque.
- An attacker with cold-disk access sees the structure but not the labels (when not paired with the rest of the vault).

**Important caveat — rendered Obsidian views are not protected.** Obsidian renders wikilinks live with the target's `exo__Asset_label`, so screenshots and screen shares of the active editor view typically display **labels**, not UUIDs. UID-canon obfuscation protects:

- **Raw file sharing** — sending a single asset's `.md` via Slack/email reveals UUIDs but not domain meaning of references.
- **Git diff review** — code-review tools show UUIDs in additions/deletions.
- **Public knowledge graph publishing** — exposing the graph topology without exposing the labels (e.g., a published RDF dump using only UUIDs).
- **AI-agent collaboration on raw vault bytes** — agents reading filesystem-level bytes see UUIDs only; supplying labels is an explicit step.

For **rendered-view protection** (screen sharing live calls, demo videos showing the editor), additional measures are needed — a UID-only viewer mode that bypasses the label-resolution step is not yet shipped. Hard switch is the strongest protection: AssetSpaces holding sensitive content are physically absent from disk in the non-active profile, so their labels cannot be resolved at all.

Compared to Obsidian Sync's at-rest encryption:

| Property      | Obsidian Sync E2E encryption                                        | UID-canon obfuscation               |
| ------------- | ------------------------------------------------------------------- | ----------------------------------- |
| Threat model  | Bytes intercepted in transit / at rest in cloud                     | Bytes visible but meaning opaque    |
| Defense layer | Cryptographic (AES-256)                                             | Naming convention + ontology lookup |
| Compose?      | Yes — encrypted bytes that, even decrypted, reveal UUIDs not labels | —                                   |
| Suited for    | Adversary with cloud access                                         | Adversary with on-screen visibility |

Both are valid. They protect different surfaces. UID-canon is the unique angle Exocortex offers; encryption is what every cloud sync product offers.

FocusProfile's **hard switch** strengthens this: AssetSpaces holding sensitive content (e.g. therapy notes, personal-finance specifics) physically leave the disk when not in the active profile. A forensic snapshot of the laptop in work-profile context contains zero bytes of personal-profile content. This is privacy beyond obfuscation — it is **absence**.

---

## Soft vs Hard switch

The plugin offers two switching modes that trade off between immediacy and physical isolation.

### Soft switch (shipped v16.40–v16.50)

- **Mechanism:** runtime RDF graph filter. The `VaultRDFIndexer` ignores files in AssetSpaces outside the effective set during `convertVault`.
- **Side effects:** none on disk. `assetspaces/*` folders stay materialized; only the in-memory triple store changes.
- **Latency:** ~1–2 seconds (just a reindex pass).
- **Crash recovery:** trivial — `_switchInProgress` flag in `data.local.json`, re-applied idempotently on plugin reload.
- **When to use:** quick context shift during work hours; you want focus without losing the option to switch back instantly.

### Hard switch (shipped v16.51)

- **Mechanism:** 2-phase commit filesystem mutation. AssetSpaces outside the target profile are torn down (cached then `rm -rf`); AssetSpaces in the target are restored from cache or freshly pulled from GitHub via REST tarballs.
- **Side effects:** `assetspaces/*` changes physically. `.gitmodules` is rewritten. `.git/modules/<as>/` cleanup.
- **Latency:** seconds for cache-hit AssetSpaces, ~30 seconds per fresh-pull AssetSpace from GitHub.
- **Crash recovery:** journal-based. `recoverIncompleteSwitch()` runs on plugin onload, reads the per-AS journal events, restores destroyed-but-not-materialized AssetSpaces from `SwitchCacheLayer`.
- **When to use:** crossing the work/personal boundary; preparing the iPhone Sync to only see one context; demonstrating the system; releasing privacy-sensitive ontologies from physical disk.

Both modes use the same vault declaration. Switching mode is a CLI flag (`--hard` / `--soft`) or a palette command (`Exocortex: Hard switch focus profile` / `Exocortex: Switch focus profile`).

---

## 2-phase commit safety

Hard switch destroys local files. That demands the same discipline as a database write.

The orchestration in `FocusProfileSwitchManager.hardSwitchProfile()` runs in two strict phases:

```
Phase 1 — Pull all target AssetSpaces to staging dirs
   For each AS in toMaterialize:
     - If SwitchCacheLayer.has(AS, validSha) → restore from cache to staging.
     - Else: GitHubRestClient.pullTarball() → TarExtractor.extract() to staging.
   ABORT IF any pull fails (no destruction has happened yet — vault is intact).

Phase 2 — Atomic destroy + extract (only after Phase 1 fully succeeds)
   For each AS in toDestroy:
     - SwitchCacheLayer.cache(AS) — tar -czf, verified non-empty + parseable.
     - rm -rf vault/assetspaces/<AS> — destroyed.
   For each AS in toMaterialize:
     - mv staging/<AS> → vault/assetspaces/<AS>.
     - git submodule add — rewrite .gitmodules.
```

The key invariant: **no AS is destroyed before every AS in `toMaterialize` is staged successfully**. If GitHub is unreachable mid-Phase-1, the user's vault is identical to before the switch attempt. If the plugin crashes mid-Phase-2 (between destroy and materialize), the per-AS journal allows `recoverIncompleteSwitch()` to read which AS were destroyed-but-not-yet-materialized and restore them from `SwitchCacheLayer`.

The cache verification gate — `SwitchCacheLayer.cache()` validates the archive is non-empty and parseable before allowing destroy — closes the silent-data-loss footgun: disk full mid-tar can produce a zero-byte archive that "succeeds" with exit 0. The verification step refuses the destroy if the tar is not whole.

```
                              ┌─────────────────────────┐
                              │  hardSwitchProfile()    │
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
            │            │   git submodule add        │                 │
            │            └─────────────┬──────────────┘                 │
            │                          │                                │
            │                          ▼                                │
            │            ┌────────────────────────────┐                 │
            │            │ journal: completed         │                 │
            │            └────────────────────────────┘                 │
            └─────────────────────────────────────────────────────────-─┘
```

Crash recovery worker `recoverIncompleteSwitch()` runs on every plugin onload when `_switchInProgress=true` is detected:

1. Reads journal tail.
2. Identifies destroyed-but-not-materialized AS UIDs.
3. Restores each from `SwitchCacheLayer` to vault.
4. Logs recovery outcome. Clears `_switchInProgress` flag.

---

## Cross-device sync model

A subtle design decision: the active profile **must not** sync across devices. Otherwise, switching to "work" on the laptop forces the phone into work too, defeating mobile's whole reason to be on a different profile.

The split:

- **Synced (lives in vault git submodules + main vault repo):**
  - All `exo__FocusProfile` assets (the profile declarations themselves).
  - `.gitmodules` — which AssetSpaces are physically present (changes only on hard switch).
  - `assetspaces/*` — the actual ontology content.

- **Per-device (lives in `data.local.json`, Sync-excluded by `.local.` infix convention):**
  - `activeProfileUid` — which profile this device currently has active.
  - `_switchInProgress` — crash-recovery flag.
  - `_activeStagingDirs[]` — orphan-cleanup pointers for `mktemp` staging.

When the device starts up, `FocusProfileSwitchManager.reconcileToLocal()` detects divergence between the synced `.gitmodules` state and the per-device active profile, prompts the user if needed, and resolves. The full divergence matrix is handled in code; users typically never see the prompt unless they manually swap submodules outside the plugin.

---

## CLI parity

Every palette command has a CLI equivalent for automation and AI-agent scripting:

```bash
# Soft switch (RDF filter only, no disk changes)
exocortex-cli command focus-profile-switch <profile-uid> --vault <path>

# Hard switch (filesystem mutation, 2-phase commit)
exocortex-cli command focus-profile-hard-switch <profile-uid> --vault <path> --yes

# List profiles
exocortex-cli command focus-profile-list --vault <path>

# Clear switch cache (drop `SwitchCacheLayer` tarballs)
exocortex-cli command focus-profile-clear-cache --vault <path> --yes
```

The CLI uses the same `FocusProfileSwitchManager` core (RFC 22b50a17 Phase 1b — `IConfirmGate` + Headless adapter), so behavior is bit-identical between plugin palette and CLI invocation. `--yes` flag bypasses interactive confirmation for non-interactive contexts (CI, AI agents).

---

## Vision Lock decisions

The RFC interview process (RFC 22b50a17 §Vision Lock) captured 16 architectural decisions that shaped the implementation. Key ones:

- **Decision #1 — Two switch modes, not one.** Soft remains the daily-driver default; hard is the privacy/perf escalation. Forcing all-or-nothing destroys the immediacy win.
- **Decision #6 — Cache retention indefinite by default.** SwitchCacheLayer holds prior AssetSpace tarballs forever (LRU eviction is a future Phase 5 docs follow-up). Switching back is instant; the disk cost is bounded by ontology growth rate.
- **Decision #7 — Atomic intent.** Destroy depends on cache success. Cache write verification gates destroy.
- **Decision #12 — Materialization is runtime-derived.** `exo__AssetSpace_materialized` is computed from filesystem, not persisted. Manual `rm`/`cp` cannot create stale state in SPARQL or UI.
- **Decision (cross-device)** — Active profile is per-device, not synced. The `.local.` infix convention is the boundary.
- **Decision (TS-floor preservation)** — `shared-identities`, `exo`, `exocmd` always materialize regardless of profile. Stripping the TS-floor would self-brick the plugin (no class definitions, no commands).

For the full list and trade-off reasoning, read the RFC body. It is intentionally written for deep readers; everything above is the user-facing distillation.

---

## See also

- **[README.md — FocusProfile section](../README.md)** — high-level feature blurb.
- **[VISION.md — Vault-as-Graph + Homoiconic Profiles + UID-canon](../VISION.md)** — philosophical positioning.
- **[CHANGELOG.md](../CHANGELOG.md)** — v16.40 → v16.52 release progression.
- **RFC `b6ba5595`** — original FocusProfile RFC (soft switch).
- **RFC `0a0791c1`** — Phase 4 RFC (Settings UI, palette commands, CLI parity).
- **RFC `22b50a17`** — Phase 5 RFC (hard switch, 2-phase commit, materialization tracker).
