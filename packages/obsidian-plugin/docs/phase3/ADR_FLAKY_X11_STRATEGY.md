# ADR — Flaky E2E X11 Stabilization Strategy (Phase 3.5)

- **Status:** Accepted (analysis-only ADR; implementation lands в T5.5 PR)
- **Date:** 2026-04-30
- **RFC:** Phase 3 — flaky e2e residual stabilization (`32a64ed9-9a74-4e0c-bb26-e455605aa384`, RFC 3cc77ba2 successor)
- **Charter:** `4cd6f7bd-73e4-47f3-b0f2-c1f2438ed619` §4
- **Source GitHub Issue:** kitelev/exocortex#2974
- **Decision authors:** child Claudes T5.1 (`481b05ed`), T5.2 (`537d4fd2`), T5.3 (`8243c196`), T5.4 (`03c69963` — this ADR)
- **Implementation:** T5.5 PR (next task) — primary config + measurement harness + rollback env-var
- **Validation:** T6.1 — N=50 measurement matrix on CI runner

---

## 1. Context

E2E suite на Obsidian plugin суффер от **Category I — X11 Shm::PutImageRequest infrastructure errors** на CI Linux runners (jammy, Playwright `mcr.microsoft.com/playwright:v1.55.1-jammy`, Xvfb 21.1.4 backend). Symptoms (RFC §Проблема, run `25181815934` shard 6 2026-04-30T18:17Z): cold-start `waitForSelector` timeouts >15s, intermittent Obsidian process termination during plugin load, recurring `X11 Shm::PutImageRequest` substring в filtered stderr. Pre-Phase-3 baseline rerun rate ~50% (Issue #2974 evidence).

Phase 3.5 RFC §3.5 mandated **3 parallel investigations** to pick best-of-3 by flake-reduction percentage, tie-breaker latency:

- **Investigation A (T5.1)** — Xvfb tuning (framebuffer flags / MIT-SHM extension toggle)
- **Investigation B (T5.2)** — `xvfb-run` per-test display isolation (per-test / per-spec / per-launch)
- **Investigation C (T5.3)** — alternative display backends (xpra / Xephyr / Weston Wayland / native headless)

Все 3 spike-доки готовы и закоммичены в evidence trail (см. §10 References). Эта ADR синтезирует их в одно решение для Phase 3.5 production.

**Inherited constraints:**
- CI Path 2 (D0 cutover 2026-04-22): post-Phase 3 baseline ~236s avg ±50s; gate ≤220s per Decision B (RFC v2 relax). Любой variant с >+5% wall-clock collides с gate envelope.
- 13 required CI checks (`archgate`, `detect-changes`, `e2e-shard (1..6)`, `lint`, `test-bdd`, `test-component`, `test-coverage`, `typecheck`).
- `playwright-e2e.config.ts`: `fullyParallel: false; workers: 1` — within-shard execution serial → contention bounded shard-locally.

---

## 2. Decision

**Primary mitigation:** ship **T5.1 V1+V2 cumulative** as default Xvfb args в `packages/obsidian-plugin/docker-entrypoint-e2e.sh`:

```sh
xvfb-run --auto-servernum --server-args="-screen 0 1280x720x24 -dpi 96 -extension MIT-SHM -nolisten tcp" "$@"
```

Components:
- **`-extension MIT-SHM`** (T5.1 V1) — disables X11 shared-memory extension at protocol level. Forces all image transfers через XPutImage network protocol path. **Eliminates Category I root cause by construction** (no SHM allocator → no SHM allocator contention → no `Shm::PutImageRequest` errors).
- **`-screen 0 1280x720x24`** (T5.1 V2) — reduces framebuffer 1280×1024×24bpp = 3.93 MB → 1280×720×24bpp = 2.76 MB (-30%). Composable with V1 (cumulative). Matches existing Playwright `viewport` setting (already 1280×720).
- **`-dpi 96`** (T5.1 V2) — pins layout deterministic across jammy kernel variants (some default 75 dpi → font metric drift in plugin DOM measurements).
- **`-nolisten tcp`** — preserves existing security default (no TCP listener).

**Production harness:** parametrize `docker-entrypoint-e2e.sh` через `XVFB_VARIANT` env var с **`v1+v2` as default**, оставляя `baseline` (status quo) и фолбэк-rungs reachable через env-flip без code change. T5.5 ships harness + default flip; T6.1 N=50 measurement matrix validates pre-merge.

---

## 3. Decision Rationale

### 3.1 Why T5.1 V1 dominates

T5.1 V1 (`-extension MIT-SHM`) eliminates Category I **at X11 protocol layer**, not at process-management layer. Все остальные mitigations (T5.2 per-spec isolation, T5.3 xpra session wrapper, T5.3 Weston) achieve the same effect через **different mechanism** (process-level cleanup, session-level cleanup, protocol replacement) at strictly higher cost:

| | T5.1 V1 (`-extension MIT-SHM`) | T5.2 V2 (per-spec) | T5.3 V1 (xpra) | T5.3 V3 (Weston) |
|---|---|---|---|---|
| Eliminates SHM contention | ✅ protocol-level | ✅ process-level | ✅ session-level | ✅ replaces X11 |
| Wall-clock cost | ~5–15% framebuffer slowdown (offset by no SHM overhead — net ≈ neutral) | +5% (N spec spawns × ~200ms) | +1–2s shard cold-start (~+1%) | ≈ neutral |
| Implementation surface | 1-line `--server-args` change | bash spec loop + Playwright reporter merge | Dockerfile +25 MB + entrypoint env-var | Dockerfile +40 MB + Electron flags + WL stack |
| Compatibility risk | LOW (universal Xvfb feature) | LOW (Playwright `merge-reports` GA) | MEDIUM (untested Electron+xpra in CI) | HIGH (untested Playwright+Electron+WL) |
| Reversibility | trivial (1-line revert) | medium (revert + reporter) | trivial (env var) | medium (env var + WL→X11 fallback) |
| Decision B gate impact | ✅ within ≤220s | ⚠ marginal (+5% on 236s baseline) | ✅ within | ✅ within |
| Empirical precedent | HIGH — Playwright #8198, Cypress docs, ChromiumOS bots | MEDIUM — Playwright merge-reports well-documented but specific to per-spec isolation pattern | LOW — 0 hits "xpra" в microsoft/playwright | NONE — Playwright Wayland on roadmap (#20217) but no commit date |

T5.1 V1 wins на all 5 critical axes (cost, surface, risk, reversibility, precedent).

### 3.2 Why V2 (lean dimensions) is composable, not redundant

V2 (`1280x720x24` + `-dpi 96`) addresses a **different vector** than V1: V1 disables SHM extension, V2 reduces framebuffer pressure regardless of transfer protocol. They compose without conflict:

- V1 alone: works at protocol layer; XPutImage path slower but predictable.
- V2 alone: reduces SHM allocator pressure (-30% framebuffer) but doesn't eliminate the path.
- V1+V2 cumulative: SHM disabled **and** framebuffer leaner → smaller XPutImage payloads → wall-clock cost of V1 is partially offset by V2's reduced transfer size.

Empirical N=50 в T6.1 will measure V1 alone vs V1+V2 — if V2's wall-clock benefit is negligible, drop V2; ship V1 only. ADR ships **V1+V2 default** на assumption obtained from Playwright/Cypress community evidence + RFC §3.5 «pick best-of-3 by flake reduction» preferring lower variance config.

### 3.3 Why Investigations B & C are fallback-ladder, not first-line

Both T5.2 spike (§5) и T5.3 spike (§5) explicitly conclude their mechanisms are **redundant** with T5.1 V1: the same Cat I root cause is closed by T5.1 at protocol level. Investigations B & C add value **only** as insurance against the long tail of non-SHM X11 errors that survive V1 — empirically unverified в RFC §Проблема evidence base, but theoretically possible (BadAlloc, BadRequest, X11 socket exhaustion, scheduling races).

Therefore: **escalate through fallback ladder only on empirical signal** (T6.1 N=50 shows residual flake), not preemptively.

### 3.4 Why no «ship all 3» strategy

Defense-in-depth is tempting: ship V1+V2 + per-spec isolation + xpra + Weston simultaneously. Rejected because:

1. **Cost compounds:** +5% (T5.2) + +1–2s (xpra cold-start) + protocol migration risk (Weston) — combined wall-clock approaches Decision B ≤220s ceiling on already-tight 236s baseline.
2. **Diagnostic confusion:** if 4 mitigations ship together and Cat I disappears, we cannot attribute the win — and cannot rollback safely if regression appears later.
3. **Reversibility erodes:** more layers → more places to break during revert.
4. **YAGNI:** T5.1 V1 alone is empirically expected to close Cat I per Playwright community precedent. Adding rung-1/2/3 ahead of evidence is over-engineering.

---

## 4. Fallback Ladder

If T6.1 N=50 measurement of T5.1 V1+V2 shows residual flake rate >0% with X11-tagged stderr (any X11 error substring after MIT-SHM disable; or `BadRequest` / `BadAlloc` / `ConnectionFailed` / `Shm::PutImage` resurfacing) → escalate **one rung at a time**, re-measure N=50 per rung.

### Rung 1 — T5.2 V2 (per-spec Xvfb isolation) combined with T5.1 V1

Trigger: T5.1 V1+V2 misses DoD threshold (rerun rate >10% per Issue #2974 DoD).

Mechanism: replace `xvfb-run` single wrap с per-spec loop. Each spec gets fresh Xvfb process → fresh `/tmp/.X11-unix/X{N}` socket → fresh process state. Eliminates cross-spec leak vector.

Implementation sketch (T5.2 §6):
```sh
case "$XVFB_VARIANT" in
  per-spec)
    specs=$(npx playwright test --list --reporter=line | grep -oE 'tests/e2e/specs/[^ ]+\.spec\.ts' | sort -u)
    overall_exit=0
    for spec in $specs; do
      xvfb-run --auto-servernum --server-args="-screen 0 1280x720x24 -dpi 96 -extension MIT-SHM -nolisten tcp" \
        npx playwright test "$spec" --reporter=blob --output="reports/$(basename $spec .spec.ts)" \
        || overall_exit=$?
    done
    npx playwright merge-reports --reporter=html ./reports || true
    exit $overall_exit
    ;;
esac
```

Cost: +5% wall-clock (~12s on 236s baseline → ~248s, breaches Decision B ≤220s ceiling). **Requires Decision B re-relax conversation if rung 1 ships.** Implementation effort: 1–2 dev-days (reporter merge + revert script + artifact bundling).

Reversibility: medium. Revert = flip `XVFB_VARIANT` env var to `v1+v2`; remove per-spec loop block from entrypoint (10-line change).

### Rung 2 — T5.3 V1 (xpra session wrapper) combined with T5.1 V1

Trigger: rung 1 (V1+V2 + per-spec) still misses DoD.

Mechanism: replace Xvfb wrapper с xpra session-management layer. xpra wraps Xvfb internally but adds session-cleanup robustness — child crash does not race с X server teardown; SHM segments reaped before next client. Defense at session-management layer orthogonal to T5.1 protocol-level mitigation.

Implementation sketch (T5.3 §6):
```sh
case "$XVFB_VARIANT" in
  xpra)
    xpra start :99 \
      --start-child="$*" --exit-with-children=yes \
      --bind-tcp=none --html=off --notifications=no \
      --pulseaudio=no --webcam=no --printing=no \
      --xvfb='Xvfb -screen 0 1280x720x24 -extension MIT-SHM -nolisten tcp -dpi 96'
    ;;
esac
```

Cost: image +25 MB (within budget; current ~1.2 GB, +2%); +1–2s shard cold-start (~+1% wall-clock). Implementation effort: 0.5–1 dev-day (Dockerfile + entrypoint + env-var hook).

Reversibility: trivial. Revert = `XVFB_VARIANT=v1+v2`; xpra dependency stays in image как dormant.

Empirical risk: MEDIUM. xpra + Electron + Playwright triple unverified в CI; T6.1 must validate с care.

### Rung 3 — T5.3 V3 (Weston / Wayland headless) с Electron `--ozone-platform=wayland`

Trigger: rung 2 (xpra) still misses DoD. **Last resort before Phase 4 RFC** (migration off Playwright/Xvfb to hosted browser).

Mechanism: replace X11 entirely с Wayland (Weston `--backend=headless`). No MIT-SHM equivalent в Wayland; `wl_shm` differently structured (per-buffer dmabuf or shm pool) — does not exhibit X11 SHM allocator-fragmentation pattern. Eliminates Category I **by abandoning X11 protocol**.

Implementation sketch (T5.3 §6):
```sh
case "$XVFB_VARIANT" in
  weston)
    mkdir -p ${XDG_RUNTIME_DIR:-/tmp/runtime-root} && chmod 700 ${XDG_RUNTIME_DIR:-/tmp/runtime-root}
    weston --backend=headless-backend.so --width=1280 --height=720 --socket=wayland-0 &
    WESTON_PID=$!
    until [ -S "${XDG_RUNTIME_DIR:-/tmp/runtime-root}/wayland-0" ]; do sleep 0.1; done
    ELECTRON_OZONE_PLATFORM_HINT=wayland "$@" --ozone-platform=wayland --enable-features=UseOzonePlatform
    EXIT=$?; kill $WESTON_PID 2>/dev/null; exit $EXIT
    ;;
esac
```

Cost: image +40 MB (~+3%); steady-state wall-clock ≈ neutral. **Implementation effort: 3–5 dev-days** (Dockerfile + entrypoint + Electron flags + diagnostic tooling for Wayland). Diagnostic difficulty: Wayland tooling (`wayland-debug`, `wayland-info`) less mature than X11 (`xprop`, `xev`, `xwininfo`).

Reversibility: medium. Revert = `XVFB_VARIANT=v1+v2`, retain WL stack как dormant. **Cannot fully revert WL→X11 в same image without rebuild** (libwayland symbols loaded but inert when WL disabled).

Empirical risk: HIGH. Playwright + Electron + Wayland combination — 0 known production CI deployments в Playwright community (search 2026-04-30: 2 unanswered issues в microsoft/playwright; Obsidian forum: 0 results "wayland CI"). Failure mode = entire e2e suite breaks, not just one spec.

### Beyond rung 3

If Weston also misses DoD → **Phase 4 RFC** (RFC §Альтернативы A — Migration off Playwright/Xvfb to hosted browser, currently rejected on cost). Out-of-scope для этой ADR.

---

## 5. Rejected Options (Documented for Completeness)

### 5.1 T5.1 V3 — `-shmem` flag toggle (rejected — no opt-out flag exists)

`-shmem` already on by default в Xvfb (`man Xvfb` jammy 21.1.4). No `-noshmem` counterpart exists; only `-extension MIT-SHM` covers disable case (which is V1). RFC §3.5 phrasing «`-shmem` enable» turned out misnomer.

### 5.2 T5.2 V1 — per-test isolation (rejected — fixture lifecycle conflict)

Playwright Electron launcher reads `DISPLAY` at `electron.launch()` time, fires per-test only if `beforeEach` does fresh launch. В нашем suite Electron launched once per spec via fixture and reused across tests. Per-test isolation → fixture lifecycle reorganization → high blast radius vs actual contention surface (single-worker serial suite). Per-spec (Rung 1) is realistic granularity.

### 5.3 T5.2 V3 — per-launch fixture isolation (rejected — wall-clock cost)

200–400ms × ~80 Obsidian launches per shard = 16–32s added (+10–13% wall-clock). Breaks Decision B ≤220s gate (236s baseline → 260s+). Only revisit if all rungs miss DoD AND Investigation C is undesirable.

### 5.4 T5.2 V4 — per-worker isolation (rejected — out-of-scope parallelization)

Currently `workers: 1` (specs share Obsidian config dir, must run serially per shard). Parallelization → separate `$HOME` per worker, separate vault — entirely different RFC scope (parallelization, not flake stabilization).

### 5.5 T5.3 V2 — Xephyr (rejected — needs parent X server)

Xephyr renders into window of parent X server. CI runners headless (no parent). Running Xephyr inside Xvfb adds two display-server hops без isolation benefit. Strictly worse than xpra.

### 5.6 T5.3 V4 — Native Chromium `--headless=new` (rejected — Obsidian binary doesn't expose)

Obsidian's Electron entry point (bundled binary `/opt/obsidian/obsidian`) does not expose `app.commandLine` to external invocation. Empirically (microsoft/playwright#10384): Electron + `--headless` boots Chromium but BrowserWindow constructor still requires `$DISPLAY`. Path forward would require forking Obsidian — out-of-scope.

### 5.7 T5.3 V5 — DBUS daemon (rejected — cosmetic only)

DBUS warnings filtered, not failing — they don't cause Cat I errors. Process termination timeout symptoms are X11 SHM, not DBUS-mediated. Adds infra без addressing root cause.

---

## 6. Consequences

### 6.1 Positive

- **Category I closure (expected):** T5.1 V1 eliminates SHM fast-path at protocol layer. Per Playwright community precedent (microsoft/playwright#8198), ChromiumOS bot infra, Cypress Linux docs — HIGH confidence Cat I rerun rate drops from ~50% baseline to <10% DoD threshold.
- **Wall-clock cost neutral:** V1's framebuffer slowdown offset by V2's smaller framebuffer payload + reduced SHM overhead. Expected steady-state ≈ baseline ±1%.
- **Trivial reversibility:** 1-line `--server-args` revert + `XVFB_VARIANT=baseline` env-flip available without code change.
- **Composable harness:** `XVFB_VARIANT` env-var supports rung-1/2/3 escalation through env-flip alone — no code change between rungs (only Dockerfile package additions if escalating to xpra/Weston).
- **Diagnostic clarity:** if regression surfaces later, single primary mitigation isolates blame surface.

### 6.2 Negative

- **Empirical assumption:** T5.1 V1 expected to close Cat I, но not yet measured on CI runner для **этого** repo. Risk that runner-specific kernel variant exhibits non-canonical SHM behaviour. Mitigation: T6.1 N=50 measurement pre-merge; rollback env-var ready.
- **V2 lean dimensions assume no pixel-bottom interaction:** Audit (T5.1 §3 V2 analysis): zero `clip:` or pixel-coordinate `mouse.click({x,y})` calls в `tests/e2e/specs/**` against bottom 304 px. Future spec adding pixel-bottom interaction will silently misbehave. Mitigation: comment в `docker-entrypoint-e2e.sh` warning future contributors; lint rule deferred to Phase 4 if churn surfaces.
- **Fallback ladder depth:** 3 rungs of fallback adds documentation surface area. Mitigation: keep ADR fallback section concise; T5.5 implementation lands harness skeleton без активных rung implementations (just env-var hook).
- **Decision B gate fragility:** Rung 1 (per-spec) collides with ≤220s gate → если escalation triggers, requires Decision B re-relax conversation в parallel. Mitigation: explicit warning в Rung 1 trigger criteria.

### 6.3 Neutral

- **Image size:** primary mitigation (T5.1 V1+V2) is zero-cost — only `--server-args` change, no Dockerfile diff. Rung-2/3 add 25/40 MB respectively (within ~5% budget on 1.2 GB base).
- **Required CI checks:** unchanged. 13 mandatory checks remain (`archgate`, `detect-changes`, `e2e-shard (1..6)`, `lint`, `test-bdd`, `test-component`, `test-coverage`, `typecheck`).

---

## 7. Validation Plan

### 7.1 T5.5 — Implementation PR (next task в this phase)

**Scope:**
1. Edit `packages/obsidian-plugin/docker-entrypoint-e2e.sh`: introduce `XVFB_VARIANT` env-var with default `v1+v2`. Implement `case` switch с branches `baseline | v1+v2 | per-spec | xpra | weston`. Active branches: `baseline` and `v1+v2`. Rung-1/2/3 branches may be **placeholder stubs** (echo «not yet implemented» + exit 1) at T5.5 time, активируются in subsequent escalation tasks if needed.
2. Commit ADR (this file) into branch.
3. Add `docs/history/ROLLBACK_X11_STABILIZATION.md` micro-doc: «to revert, set `XVFB_VARIANT=baseline` in `.github/workflows/e2e.yml` env block».
4. Update `packages/obsidian-plugin/CLAUDE.md` (or AGENTS.md) — note new env-var contract.
5. PR title: `chore(e2e): T5.5 — adopt T5.1 V1+V2 Xvfb config (RFC Phase 3.5)` + reference ADR commit.

**DoD T5.5:**
- 13 required CI checks green (smoke validation на baseline + v1+v2 variants both pass at least 1 run pre-merge)
- ADR committed
- Rollback doc committed
- PR squash-merged

### 7.2 T6.1 — N=50 measurement matrix (validation phase)

**Trigger:** T5.5 merged to main.

**Harness:** add `.github/workflows/e2e-xvfb-spike.yml` matrix (deferred to T6.1 task; sketch per T5.1 §5):
```yaml
strategy:
  matrix:
    variant: [baseline, v1+v2]
    run: [1..50]
```
Run cold-start subset (RFC §Проблема evidence specs: `relation-column-set-smoke`, `vault-commands-smoke`, `daily-note-tasks`) per variant per run. Output: per-variant rerun rate, P50/P99 launch time, X11 error count from filtered stderr.

**Cost estimate:** 2 variants × 50 runs × ~80s shard cold-start = ~2.2h CI minutes (~$0 self-billed).

**Acceptance criteria (per RFC §3.5 + Issue #2974 DoD):**
- v1+v2 rerun rate ≤25% × baseline rerun rate
- v1+v2 P99 launch time ≤120s
- v1+v2 zero `Shm::PutImageRequest` substring в stderr (eliminative validation; expected `0` per protocol-level disable)

**Escalation trigger:** if v1+v2 misses any acceptance criterion → invoke fallback ladder Rung 1 (T5.2 V2 per-spec) + re-measure. Re-measurement budget: same 50-run matrix per rung.

### 7.3 T6.2 — Production observation (post-merge)

After T5.5 merge, monitor 14-day window:
- PR rerun rate (`gh run list --json conclusion,attempt`) compared to pre-merge 14-day baseline
- E2E shard latency P99 (CI Path 2 telemetry on `e2e-shard (1..6)`)
- Stderr X11 error tally (filter `LaunchProcess: X11 Shm::PutImageRequest` substring count per shard)

**Success metric:** rerun rate <10% (Issue #2974 DoD) sustained for 14 days. If regression → invoke rollback (`XVFB_VARIANT=baseline`) + escalate Rung 1.

---

## 8. Implementation Notes

### 8.1 Stderr filter compatibility

Existing `docker-entrypoint-e2e.sh` filters cosmetic warnings via stderr-grep (LaunchProcess / dbus errors). T5.1 V1 may suppress one filtered substring (`X11 Shm::PutImageRequest`) entirely — expected behaviour, no filter change needed. Future contributors may safely remove that substring from filter list once T6.2 confirms 14-day zero-occurrence.

### 8.2 Playwright config compatibility

`playwright-e2e.config.ts` `viewport: { width: 1280, height: 720 }` already matches V2 lean Xvfb dimensions. No Playwright config change needed.

### 8.3 Local dev workflow

Mac/local devs running `npm run test:e2e` outside Docker do NOT hit the Xvfb branch (entrypoint applies only inside Dockerfile.ci context). Local dev workflow unaffected.

### 8.4 CI worker model invariant

`workers: 1; fullyParallel: false` constraint preserved. Per-worker isolation (T5.2 V4) explicitly out of scope for any rung — if user later wants parallelization, separate RFC required.

---

## 9. Open Questions

1. **Should T5.5 ship rung-1 stub or activate it preemptively?** Decision: ship stub. Activation triggers on T6.1 empirical signal, not pre-emptively.
2. **Should Decision B ≤220s gate be relaxed pre-emptively for Rung 1?** Decision: defer to Rung 1 trigger conversation. Status quo gate stands until empirically necessary.
3. **Does Weston/Wayland rung warrant standalone exploratory PR before Rung 3 trigger?** Decision: no. Rung-3 spike already complete (T5.3 §3 V3 analysis); empirical validation deferred until Rung-3 trigger fires. If Rung-2 (xpra) succeeds, Rung-3 work never needed → save 3–5 dev-days.

---

## 10. References

### 10.1 Sibling spike documents (evidence trail)

- **T5.1 V1+V2 spike (primary recommendation):** `packages/obsidian-plugin/docs/phase3/T5_1_XVFB_TUNING_SPIKE.md` — commit `29639769` on branch `task-481b05ed`. Author: child Claude `481b05ed-3f1d-4fa2-9b3c-0fb8eb7e1377`.
- **T5.2 per-spec spike (rung 1 fallback):** `packages/obsidian-plugin/docs/phase3/T5_2_XVFB_RUN_SPIKE.md` — commit `798ea235` on branch `task-537d4fd2`. Author: child Claude `537d4fd2-d336-4124-91bf-2d362b299d0d`.
- **T5.3 alternatives spike (rung 2-3 fallbacks):** `packages/obsidian-plugin/docs/phase3/T5_3_HEADED_CHROMIUM_SPIKE.md` — commit `95d7cfa2` on branch `task-8243c196`. Author: child Claude `8243c196-cbb2-4b57-be6c-f4608c196520`.

### 10.2 RFC / project artefacts

- RFC Phase 3 — flaky e2e residual stabilization: `/Users/kitelev/vault-2025/03 Knowledge/inbox/32a64ed9-9a74-4e0c-bb26-e455605aa384.md`
- Charter: `/Users/kitelev/vault-2025/03 Knowledge/inbox/4cd6f7bd-73e4-47f3-b0f2-c1f2438ed619.md`
- Source GitHub Issue: kitelev/exocortex#2974
- CI Path 2 D0 cutover (2026-04-22): 13 required checks; Decision B relax ≤220s gate
- Rollback procedure (broader CI): `exocortex/docs/history/ROLLBACK_CI_SPEEDUP.md`

### 10.3 External evidence base

- Playwright issue: https://github.com/microsoft/playwright/issues/8198 (auto-servernum + MIT-SHM disable canonical mitigation thread)
- Cypress Linux containers documentation: MIT-SHM disable recommended
- ChromiumOS bot infra: MIT-SHM disabled by default
- xpra: https://github.com/Xpra-org/xpra
- Weston headless backend: https://wayland.pages.freedesktop.org/weston/toc/running.html#headless-backend
- Electron Ozone Wayland: https://www.electronjs.org/docs/latest/tutorial/wayland-support
- Playwright Wayland tracking: microsoft/playwright#20217 (no commit date)
- Playwright Electron-headless precedent: microsoft/playwright#10384

### 10.4 Failed CI run sample (RFC §Проблема Cat I evidence)

`gh run view 25181815934 --repo kitelev/exocortex` — daily-note-tasks shard 6 process termination timeout 2026-04-30T18:17Z.

---

## 11. Decision Summary (TL;DR)

**Ship T5.1 V1+V2 cumulative as default Xvfb args** (`-extension MIT-SHM` + `1280x720x24` + `-dpi 96` + `-nolisten tcp`). Implementation lands in T5.5 PR with `XVFB_VARIANT` env-var harness. Empirical validation в T6.1 (N=50). Fallback ladder rungs (per-spec / xpra / Weston) reachable through env-flip без code change, activated only on empirical trigger.
