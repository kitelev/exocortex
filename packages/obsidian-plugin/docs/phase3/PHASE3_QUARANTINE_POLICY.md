# Phase 3.3 — Quarantine Policy (consolidated)

**Task:** `cd261dbb-803b-44af-8b9a-7135d86484a3` (T3.4)
**Phase:** RFC Phase 3.3 — Quarantine activation (consolidation)
**Generated:** 2026-05-01 (Asia/Almaty)
**RFC:** `32a64ed9-9a74-4e0c-bb26-e455605aa384`
**Charter:** `4cd6f7bd-73e4-47f3-b0f2-c1f2438ed619`

---

## §1 What this PR consolidates

This PR bundles the three Phase 3.3 deliverables into a single landing on `main`:

| Sub-task | Deliverable | Source commit |
|---|---|---|
| T3.1 | Per-spec decision matrix → [`T3_1_QUARANTINE_DECISION_MATRIX.md`](./T3_1_QUARANTINE_DECISION_MATRIX.md) | `8486faf5` (cherry-picked as `3f18a2fb`) |
| T3.2 | Quarantine list scaffold → [`tests/quarantine.ts`](../../tests/quarantine.ts) (empty `QUARANTINED_TESTS`, ready for Phase 3.4 evidence) | `ae08eb98` (cherry-picked as `a6512cdb`) |
| T3.3 | Tracking issues index → [`T3_3_TRACKING_ISSUES.md`](./T3_3_TRACKING_ISSUES.md) (5 issues: #2985, #2986, #2987, #2988, #2989) | `62c7661e` (cherry-picked as `fc7e64ac`) |

---

## §2 Decision summary (per T3.1)

At post-cutover N=41, the matrix concluded **zero specs warrant quarantine**:

| Bucket | Count | Action |
|---|---:|---|
| stabilize | 5 | Rely on existing `retry(1)` + Phase 3.1 cold-start helpers; trend-watch via Phase 3.4 dashboard |
| fix | 2 | Issues [#2985](https://github.com/kitelev/exocortex/issues/2985), [#2986](https://github.com/kitelev/exocortex/issues/2986) — root-cause work scheduled |
| quarantine | 0 | None disable at current sample size |
| track | 3 | Issues [#2987](https://github.com/kitelev/exocortex/issues/2987), [#2988](https://github.com/kitelev/exocortex/issues/2988), [#2989](https://github.com/kitelev/exocortex/issues/2989) — flake-vs-regression unresolvable at N=41, re-evaluate at N≥100 |
| delete | 0 | None obsolete |

`tests/quarantine.ts` stays at `QUARANTINED_TESTS = []`; the file exists so future Phase 3.4 evidence has a populated, conventional landing site.

---

## §3 Future workflow — when to populate `quarantine.ts`

Re-run the T3.1 decision matrix when **any** of these triggers fire:

1. **Phase 3.4 dashboard reports non-zero `totalFlaky` at N≥100** (RFC §3.4) — sample size now sufficient to discriminate flake vs regression on the `track` bucket.
2. **A `track`-bucket spec accrues incident #2** within its 30-day expiry window (issues #2987–#2989, expiry **2026-05-31**) — escalate that row to `fix` per matrix §6 promotion rules.
3. **A `fix`-bucket spec fails to stabilize within one sprint** despite landed root-cause work — reassess for `quarantine` per Charter Risk 4 (cannot-stabilize escape hatch).

For each new evidence cycle, repeat T3.1's analysis on the updated cohort, then update `QUARANTINED_TESTS` in `tests/quarantine.ts` with the spec ids + tracking-issue link + 30-day auto-revert deadline. The list is intentionally code (not RDF) because it's an infrastructure guard rail for the test runner, not user-configurable semantics (per Homoiconicity Q3 exclusion (c) — see project `CLAUDE.md`).

---

## §4 Acceptance criteria (Phase 3.3 — overall)

- [x] T3.1 — per-spec decision matrix landed
- [x] T3.2 — `tests/quarantine.ts` scaffold landed with documented contract
- [x] T3.3 — 5 tracking issues filed with 30-day expiry + cross-link to matrix
- [x] T3.4 — Phase 3.3 PR consolidates above + this policy doc; CI green; merged

## §5 Downstream

- **Phase 3.4** (T4.x) — flaky dashboard already deployed (PRs #2979, #2980, #2984). Watchlist surfaces `track`-bucket specs.
- **30-day review (2026-05-31)** — re-evaluate the 5 issues; close stale, escalate, or extend.
