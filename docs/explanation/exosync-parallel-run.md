# ExoSync parallel-run mode — validation harness (M1/M2)

> RFC 4e4dc453 Phase E (E1). Companion to [exosync.md](../how-to/exosync.md) — read
> that first for the sync model itself.

The **parallel-run window** is the validation period between "ExoSync ships
a working bidirectional engine" and "Obsidian Sync gets decommissioned"
(Phase E2). During this window both channels coexist and an automatic
harness measures the RFC's two safety metrics on every sync round.

## Operational mode (R2)

Running two sync channels over the same files is the project's top
irreversible risk (R2: write races → corruption). The RFC allows two
configurations:

1. **ExoSync primary + Obsidian Sync as backup** — both active; ExoSync is
   the authoritative channel for materialized AssetSpaces, Obsidian Sync
   keeps replicating as a safety net. This is the _transitional, de-facto_
   configuration. Discipline: avoid editing the same asset on two devices
   inside one sync gap; the harness detects any divergence on the next
   round and the conservation detector flags anything that vanished.
2. **Secondary-device validation** — Obsidian Sync disabled on a secondary
   device; ExoSync is its only channel. The strictest configuration —
   eliminates the dual-writer race entirely on that device.

The harness journals which configuration was live (`obsidianSync:
enabled/disabled/unknown` per round, via a guarded internal-plugin probe) —
the window evidence must show parity held _while Obsidian Sync was active_,
otherwise the parallel-run claim is vacuous.

**No machine flag.** Validation is constitutive of a parallel-run sync
round, so the harness is always on; a user-visible off-switch would
undermine the evidence window. If a kill-switch is ever needed, the escape
hatch is a per-device key in `data.local.json` (`PluginLocalDataStore`) —
never a vault setting (it must not replicate).

## What runs when

- **After every sync round** (`Exocortex: Sync`) — automatic parity pass:
  pre-sync conservation snapshot → sync → classification + detectors →
  Notice summary (`ExoSync parity: M1=0, M2=∅ (N repo(s) checked)`) +
  journal append. Best-effort: a parity failure never affects the sync
  result.
- **On demand** — palette command `Exocortex: Check sync status`
  (standalone round, same journal), or from a desktop shell:

  ```bash
  npx @kitelev/exocortex-cli exosync-parity --vault <vault> --token-from-gh
  # exit 0 = M1=0 AND M2=∅ · 1 = violations · 2 = vacuous (nothing checked)
  ```

- **Journal** — `.obsidian/plugins/exocortex/exosync-parity-log.local.jsonl`
  (per-device, Sync-excluded, 1 MB single-generation rotation). One JSON
  line per round; this is the 14-day window evidence the E2 decommission
  gate audits.

## How the metrics are measured

Each device compares **itself against the remote head** of every
materialized sync unit. Cross-device parity follows by transitivity
through the shared remote (the _rendezvous argument_): after a fully
successful sync, device A ≅ head and device B ≅ head ⇒ A ≅ B. No
device-to-device channel exists or is needed — this argument is what makes
single-device rounds count as N-device evidence, so it is stated here
explicitly.

### M2 — recall parity (`triple-set diff = ∅`)

Per repo: the count of paths whose content **semantically** differs between
local disk and remote head. Byte-equal paths short-circuit; byte-divergent
markdown gets a semantic comparison — canonical frontmatter equality
(key-order-insensitive, multi-valued arrays as **multisets** — RDF set
semantics, D20) plus body equality (newline/trailing-whitespace
normalised). For two contents at the same path the resolution context is
identical, so canonical-frontmatter + body equality ⇒ equal emitted triple
sets — a faithful proxy; the literal two-tree triple-set deep-compare (the
`parity-gate` CI machinery) is the designated E2 deep mechanism
(`exosync-parity --deep` is a future option, not in E1). FileSpace repos
get a byte/hash check instead: the **attachment hash-set** must be
identical (M2's sub-check).

Categories that never count into M2 (reported separately as _accounted_):

| Category                | Why it is clean                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------- |
| `quarantine-pinned`     | conflict preserved durably (D17), re-derives every sync                            |
| `deferred-local-delete` | engine defers delete propagation (documented A1 gap)                               |
| `format-only-drift`     | bytes differ, semantics equal (merger formatting) — counted + logged, never silent |

Everything else (`pending-local-*`, `pending-remote-*`,
`pending-conflict`, `unverified-divergence`) is an M2 diff. Right after a
fully successful sync the expected M2 is **0**; between syncs pending
entries are the normal in-flight state of a manual-sync system (VL#1).

### M1 — zero data loss

A single snapshot cannot observe loss directly (a wrongfully overwritten
file looks "in parity" afterwards), so M1 is measured by two detectors:

1. **Edit conservation** (post-sync rounds). Before the sync the harness
   snapshots every base-divergent path's blob SHA (a pure local walk, no
   API calls). After the sync each pre-dirty path must have survived
   _somewhere_: unchanged on disk, pushed into the new head tree,
   transformed by a recorded merge (`RepoSyncResult.mergedPaths`),
   preserved in quarantine (`quarantinedPaths`), or pinned in the
   watermark. Anything else = **conservation violation** — the
   wrongful-overwrite class (e.g. the other sync channel clobbering a file
   mid-round) that endpoint comparison alone is structurally blind to.
2. **Persistent divergence** (round N vs N-1, from the journal). A pending
   discrepancy with the _identical_ (localSha, remoteSha) pair surviving a
   sync round means the engine failed to converge it — escalated to a
   violation. Fresh pending entries never escalate, and standalone rounds
   (no sync in between) never escalate.

**M1 = 0** over the window ⇔ no round produced either kind of violation.

### Round validity guards

A round certifies a repo only when the comparison was internally
consistent:

- `inconclusive` — the remote head moved mid-check, or the sync hit its
  race window (watermark not advanced): counts discarded, next round
  re-checks.
- `no-watermark` — the repo never synced on this device: informational
  only (run a sync first).
- `auth-required` — HTTP 401/403: surface "update your PAT" (R8), never a
  green result. A 404 is reported as an unreachable repo with a hint that
  an under-scoped _fine-grained_ PAT also reads as 404 on private repos
  (existence-hiding; see exosync.md → Limitations).
- `VACUOUS` — nothing was actually checked across the whole round (all
  repos errored / never synced). The CLI exits 2: a green exit here would
  be a false certificate.

Classification is **path-keyed by design** — no uid matching, no rename
detection (a local rename reads as `pending-local-add` +
`deferred-local-delete`, which is exactly what the remote will observe).
Duplicate-uid vault anomalies therefore cannot affect the harness.

## The 14-day window (E2 gate)

E1 closes when the harness is live and the first parity check passes
(M1=0, M2=∅). The **≥14-day monitoring window** then accumulates: every
device's journal must show only `ok: true` rounds (or explained,
classified pending states that converge on the following round). That
accumulated evidence — not E1 itself — is the gate for E2
(decommission-checklist + Obsidian Sync switch-off, D27/R11).

Reading the journal:

```bash
# Quick per-round verdicts on this device:
grep -o '"ts":"[^"]*"\|"m1Total":[0-9]*\|"m2Total":[0-9]*\|"ok":[a-z]*' \
  "<vault>/.obsidian/plugins/exocortex/exosync-parity-log.local.jsonl"
```

## Source map

| Concern                                               | Source                                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| Harness core (classification, detectors, caps)        | `packages/exocortex/src/services/sync/ParityValidator.ts`                      |
| Semantic proxy (canonical frontmatter + body)         | `packages/exocortex/src/services/sync/assetSemanticCompare.ts`                 |
| Shared spec classification (plugin + CLI, one parser) | `packages/exocortex/src/services/sync/spaceSpecCore.ts`                        |
| Plugin wiring (post-sync hook, journal, Sync probe)   | `packages/obsidian-plugin/src/infrastructure/adapters/ExoSyncParityFactory.ts` |
| Palette commands                                      | `packages/obsidian-plugin/src/infrastructure/adapters/SyncCommands.ts`         |
| CLI probe                                             | `packages/cli/src/commands/exosync-parity.ts`                                  |
