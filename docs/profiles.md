# Knowledge Profiles vs Focus Profiles

> **Status:** Production since v16.59 (Knowledge/Focus split, RFC 13da049f Phase 6.5b).
> **RFC:** [13da049f](https://github.com/kitelev/exocortex) — Knowledge/Focus profile split (AC13–AC17).
> **Class declaration:** [52f2acdd](https://github.com/kitelev/exocortex) — `exo__KnowledgeProfile` TBox class + properties (sibling onto-RFC).
> **Audience:** Anyone who saw two profile commands in the palette and asked "which profile do I edit?".

Exocortex has **two independent profile types**. They sound similar but do
completely different things, and confusing them is the single most common
source of "why didn't my switch do anything?" (RFC 13da049f R35). This page
is the one-paragraph answer plus the details.

---

## TL;DR

|                     | **Knowledge profile**                                                           | **Focus profile**                           |
| ------------------- | ------------------------------------------------------------------------------- | ------------------------------------------- |
| Question it answers | "What knowledge **exists on disk** right now?"                                  | "What am I **looking at** right now?"       |
| Mechanism           | Hard switch — materializes / tears down AssetSpace submodules on the filesystem | Soft switch — query-time RDF filter         |
| Touches disk?       | **Yes** — writes/deletes files, rewrites `.gitmodules`                          | **No** — in-memory triple-store filter only |
| Speed               | Heavyweight (~30 s per freshly-pulled AssetSpace)                               | Lightweight (~1–2 s reindex)                |
| Reversible?         | Yes, but re-materializing costs time                                            | Instantly                                   |
| Changes how often?  | Rarely (weeks / months)                                                         | Often (hours / days)                        |
| Active state        | `data.local.json.activeKnowledgeProfileUid`                                     | `data.local.json.activeFocusProfileUid`     |
| Class               | `exo__KnowledgeProfile`                                                         | `exo__FocusProfile`                         |
| Palette command     | `Exocortex: Switch knowledge profile`                                           | `Exocortex: Switch focus profile`           |
| Guarded by          | Confirmation prompt + uncommitted-changes abort                                 | Nothing — safe, non-destructive             |

The two are **separate slots**. You can have a Knowledge profile and a Focus
profile active at the same time, and switching one never touches the other.
`Exocortex: Show current state` reports both, e.g. `Knowledge: Work · Focus: Sprint-23`.

---

## Industry analogs

If you have used any of these tools, you already understand the split — it is
the same "what is installed" vs "what am I filtering to" distinction (RFC 13da049f v1.3).

| System    | "Knowledge layout" (hard switch)      | "Focus filter" (soft switch) |
| --------- | ------------------------------------- | ---------------------------- |
| VS Code   | workspace folders (`.code-workspace`) | file / symbol search filter  |
| Browser   | installed extensions                  | active tabs / tab groups     |
| Music     | library / albums on disk              | playlist / current queue     |
| Linux     | `apt install` packages                | `grep` / `ps` filter         |
| Git       | branch checkout (materialized files)  | `git log --grep` filter      |
| Exocortex | `exo__KnowledgeProfile`               | `exo__FocusProfile`          |

Installing a VS Code extension changes what code exists in your environment;
typing in the search box only changes what you currently see. Knowledge and
Focus profiles are exactly that pair.

---

## Knowledge profile — storage

A **Knowledge profile** (`exo__KnowledgeProfile`) declares **what knowledge is
materialized in the vault**. Switching it is a _hard switch_: the plugin
physically pulls in or tears down AssetSpace submodules under `assetspaces/`
and rewrites `.gitmodules`.

- **Semantic:** "What knowledge IS materialized in the vault right now."
- **Controls:** filesystem materialization — the actual `assetspaces/<as>/` content presence.
- **Persistence:** permanent vault state (`.gitmodules` + materialized AS dirs), so it survives reloads and is the same across devices that synced the vault.
- **User intent:** _"Install the pmbok ontology bundle — I'm starting project work."_
- **Properties:**
  - `exo__KnowledgeProfile_includes` — Ontology / AssetSpace UIDs to materialize.
  - `exo__KnowledgeProfile_extends` — another KnowledgeProfile to inherit from (materialization is unioned).
  - `exo__KnowledgeProfile_alwaysOnOverlay` — AssetSpaces always materialized regardless of which profile is active (the TS-floor).

**When to reach for it:** installing or removing whole ontology bundles;
shrinking the vault so an iPhone reindex is fast; keeping privacy-sensitive
content physically off a device (a forensic snapshot in the wrong profile
contains _zero bytes_ of the other profile's content).

Because a hard switch deletes local files, it is deliberately gated:

1. A **TS-floor assertion** refuses targets that would brick the plugin (no `exo` / `exocmd` / `profiles` → no class definitions, no commands).
2. An **uncommitted-changes abort** stops the switch and lists affected files if any AssetSpace has unsaved work — commit or stash first.
3. A **confirmation prompt** (the `ModalConfirmGate`) requires explicit consent before any destruction.

The full 2-phase-commit mechanics, crash recovery, and cache layer are
documented in [focus-profile.md](./focus-profile.md) (written before the
terminology split — read its "hard switch" sections as the **Knowledge
profile** machinery).

---

## Focus profile — filter

A **Focus profile** (`exo__FocusProfile`) declares **what slice of the
already-materialized vault you want to see**. Switching it is a _soft switch_:
a query-time RDF filter. Nothing on disk changes.

- **Semantic:** "What I'm focused on right NOW, within the materialized vault."
- **Controls:** an RDF filter applied at query time — search, SPARQL, graph view, and command palette only surface the included slice.
- **Persistence:** ephemeral, per-device session state. Switching focus on the laptop does not drag the phone along.
- **User intent:** _"Show only the ems\_\_Task instances of this sprint."_
- **Properties:**
  - `exo__FocusProfile_includes` — Ontology / AssetSpace UIDs to filter to. Must be a subset of the active Knowledge profile's effective set (you can only focus on things that are actually on disk).
  - `exo__FocusProfile_extends` — another FocusProfile to inherit from.
  - `exo__FocusProfile_appliesTo` — the KnowledgeProfile this focus is designed for (a compatibility hint; see "Compatibility" below).

**When to reach for it:** narrowing the noise during work hours without losing
the option to switch back instantly. It is the daily driver; the Knowledge
profile is the occasional escalation.

You can drive the Focus slot from the **Settings → "Active focus profile"
dropdown** as well as the palette command.

---

## Composition — Focus slices within Knowledge

A Knowledge profile defines the **container universe on disk**. A Focus profile
**slices within** that container. They stack:

```
KnowledgeProfile  P-work  materializes:  {exo, exocmd, profiles, ems, pmbok, kitelev-work}
                                          ↑ container universe ON DISK (hard switch)

  FocusProfile  F-sprint-23  filters to:  {ems-tasks-current-sprint}
  FocusProfile  F-pmbok-risks filters to: {pmbok-risks-active}
  FocusProfile  F-mentoring   filters to: {ems-meetings-with-juniors}
                                          ↑ slices WITHIN P-work's materialized container (soft switch)
```

Active dual state at any moment:

- `activeKnowledgeProfileUid: <P-work-uid>` — rarely changes.
- `activeFocusProfileUid: <F-sprint-23-uid>` — changes frequently.

A Focus profile can only include AssetSpaces present in the active Knowledge
profile's effective set. Focusing on `pmbok` while the active Knowledge profile
hasn't materialized `pmbok` has nothing to filter — materialize it first.

---

## ⚠️ No transitive expansion (R31)

**Adding an ontology to a profile is NOT transitive.** Listing `pmbok` in a
profile's `_includes` does **not** auto-add `ems`, even though `pmbok`
references `ems`. You must add **every** AssetSpace the profile needs,
explicitly, by hand.

```yaml
# WRONG — assumes pmbok pulls in its dependencies. It does not.
exo__KnowledgeProfile_includes:
  - "[[<pmbok-uid>]]"

# RIGHT — list each AssetSpace the profile actually needs.
exo__KnowledgeProfile_includes:
  - "[[<pmbok-uid>]]"
  - "[[<ems-uid>]]"
  - "[[<shared-identities-uid>]]"
```

This is a deliberate Phase 6 limitation (RFC 13da049f R31, BLOCKER-level):
`.gitmodules` is a flat manifest and cannot express the semver-range /
transitive-resolution graph that an `npm`-style `package.json` would. A future
"Phase 7 transitive" RFC may lift this once an ecosystem need emerges. Until
then: **if a switch leaves a query empty, check that you listed every
AssetSpace it depends on.**

---

## Dual-class instances (backward compatibility)

The profiles that existed before the split — `profile-base`,
`profile-personal`, `profile-work`, `profile-reading` — were migrated to be
**dual-class**: each carries _both_ `exo__KnowledgeProfile` and
`exo__FocusProfile` in its `exo__Instance_class`.

```yaml
# Before the split — a single FocusProfile
exo__Instance_class:
  - "[[<exo__FocusProfile-class-uid>]]"
exo__FocusProfile_includes: [Ontology UIDs]

# After migration — dual-class (appears in BOTH palettes)
exo__Instance_class:
  - "[[<exo__KnowledgeProfile-class-uid>]]"   # NEW
  - "[[<exo__FocusProfile-class-uid>]]"        # preserved
exo__KnowledgeProfile_includes: [Ontology UIDs]   # copied from FocusProfile_includes
exo__FocusProfile_includes: [Ontology UIDs]       # preserved (same list)
```

The same `_includes` list serves both roles initially, which preserves exactly
the pre-split behavior. Practical consequences:

- A dual-class profile shows up in **both** `Switch knowledge profile` and `Switch focus profile` pickers — that is expected, not a bug.
- You can **demote** a dual-class profile to a single role anytime by editing the asset: drop the class you don't want and its matching `_includes` property. A profile you only ever filter with should be FocusProfile-only; a heavyweight on-disk bundle should be KnowledgeProfile-only.
- Demotion is a plain vault edit — no migration tool, no plugin restart beyond the usual reindex.

---

## Compatibility (AC16) — WARN, don't break

If a Focus profile's `_includes` is not a subset of the active Knowledge
profile's effective set, the soft switch **does not throw and does not
silently drop your filter**. It logs a WARN and applies no filter for the
out-of-set AssetSpaces, matching the "graceful degradation" pattern that
browser extensions (disable cleanly) and music apps (grey-out missing tracks)
use. The `exo__FocusProfile_appliesTo` property documents the intended
Knowledge profile so you can see the mismatch coming.

---

## Quick decision guide

- "I want a whole ontology to **exist** / stop existing on disk" → **Knowledge profile** (`Switch knowledge profile`).
- "I want to **see less** without changing what's installed" → **Focus profile** (`Switch focus profile`, or the Settings dropdown).
- "My switch did nothing visible" → you probably edited the wrong slot, or hit the no-transitive gap. Run `Show current state` and re-check `_includes`.
- "Which slot is active?" → `Exocortex: Show current state`, or Settings → Active focus profile (the status line shows both slots).

---

## See also

- **[focus-profile.md](./focus-profile.md)** — deep mechanics of the soft / hard switch (2-phase commit, crash recovery, cross-device sync, CLI parity). Predates the terminology split: its "hard switch" is the Knowledge-profile machinery.
- **[../README.md](../README.md)** — high-level feature blurb.
- **[../VISION.md](../VISION.md)** — Vault-as-Graph + homoiconic profiles + UID-canon positioning.
- **RFC `13da049f`** — Knowledge/Focus split (this distinction, R31 no-transitive, R35 confusion, AC13–AC17).
- **RFC `52f2acdd`** — `exo__KnowledgeProfile` TBox class declaration.
- **RFC `b6ba5595`** — original FocusProfile RFC (soft switch).
- **RFC `22b50a17`** — Phase 5 RFC (hard switch, 2-phase commit, materialization tracker).
