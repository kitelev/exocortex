# T3.3 — Tracking Issues Index

**Task:** `16039bb7-4631-44e2-bf92-ec9f2f5ced83`
**Phase:** RFC Phase 3.3 — Quarantine activation (admin/docs deliverable; no code change)
**Generated:** 2026-05-01 (Asia/Almaty)
**RFC:** `32a64ed9-9a74-4e0c-bb26-e455605aa384`
**Charter:** `4cd6f7bd-73e4-47f3-b0f2-c1f2438ed619`
**Predecessor:** T3.1 — `T3_1_QUARANTINE_DECISION_MATRIX.md` (commit `8486faf5` on `task-4bb1bace`)

---

## §1 Summary

Per the T3.1 decision matrix, 5 GitHub issues were filed in `kitelev/exocortex` to provide actionable tracking for the **fix** (2) and **track** (3) buckets. No quarantines were filed — the matrix concluded zero specs warrant disable at the current sample size (see T3.1 §5).

All issues carry a 30-day expiry (**2026-05-31**) and link back to the T3.1 matrix for context. Per the matrix §4 aggregate: stabilize=5 (no issue, dashboard-tracked), fix=2 (issues below), quarantine=0 (none), track=3 (issues below), delete=0.

---

## §2 Filed issues

### Fix bucket (2 issues, label `flaky-fix`)

Recurrent specs (≥2 incidents) with actionable root-cause hypothesis. Keep enabled, schedule root-cause work.

| # | Issue | Spec | Hypothesis | T3.1 row |
|--:|---|---|---|:---:|
| 1 | [#2985](https://github.com/kitelev/exocortex/issues/2985) | `featured-binding-promotion.spec.ts` | Setup race against `featuredBinding` layout render — add `await waitFor(...)` on render signal | #1 |
| 2 | [#2986](https://github.com/kitelev/exocortex/issues/2986) | `daily-note-tasks.spec.ts` | Time-dependent "current day" predicate — install deterministic clock via `page.clock.install()` | #2 |

### Track bucket (3 issues, label `flaky-track`)

Single-incident specs without `retry(1)` coverage. Insufficient evidence to discriminate flake vs regression at N=41. Keep enabled, no retry (per Charter Risk 1), rely on Phase 3.4 dashboard to disambiguate.

| # | Issue | Spec | Watch criterion | T3.1 row |
|--:|---|---|---|:---:|
| 3 | [#2987](https://github.com/kitelev/exocortex/issues/2987) | `alias-sync-on-label-change.spec.ts` | Incident #2 → escalate to **fix** | #6 |
| 4 | [#2988](https://github.com/kitelev/exocortex/issues/2988) | `daily-archive-filter.spec.ts` | Incident #2 → escalate to **fix** | #7 |
| 5 | [#2989](https://github.com/kitelev/exocortex/issues/2989) | `file-explorer-icons.spec.ts` | Incident #2 → escalate to **fix** with FileExplorerIconPatch owner | #9 |

---

## §3 Labels used

- `flaky-fix` — flaky spec with actionable root-cause fix scheduled (RFC Phase 3.3)
- `flaky-track` — flaky spec under track-watch, awaiting incident #2 or N≥100 (RFC Phase 3.3)
- `tech-debt` — standard tech-debt classification (per AC)
- `ci` — CI-impacting (per AC)

The two new labels (`flaky-fix`, `flaky-track`) were created in this session to make Phase 3.3 buckets queryable across issues. The pre-existing `flaky-test` label remains in use for general flaky-test reports outside the RFC framework.

---

## §4 Acceptance criteria check

- [x] N issues filed (5: 2 fix + 3 track)
- [x] Each issue has DoD / watch criterion + 30-day expiry (2026-05-31) in body
- [x] Issue numbers captured here for cross-link from future work (T3.4 PR, Phase 3.4 dashboard)
- [x] Labels applied: `flaky-fix` / `flaky-track` + `tech-debt` + `ci`

## §5 Downstream

- **Phase 3.4 dashboard** — already lists `track`-bucket specs in its watchlist (per T3.1 §6 #4). Should auto-surface incident #2 occurrences via rerun-rate trend.
- **30-day review (2026-05-31)** — re-evaluate each issue: close stale (zero further incidents), escalate (incident #2 → fix), or extend (active fix in progress).
- **`tests/quarantine.ts`** — remains `QUARANTINED_TESTS = []` per T3.1 §6 #3. Re-evaluate after Phase 3.4 dashboard reports non-zero `totalFlaky` at N≥100.
