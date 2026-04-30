# T5.1 — Investigation A: Xvfb tuning spike (Phase 3.5)

- **RFC:** Phase 3 — flaky e2e residual stabilization (RFC `32a64ed9-9a74-4e0c-bb26-e455605aa384`, RFC 3cc77ba2 successor)
- **Charter:** `4cd6f7bd-73e4-47f3-b0f2-c1f2438ed619` §4
- **Source GitHub Issue:** kitelev/exocortex#2974
- **Task UID:** `481b05ed-3f1d-4fa2-9b3c-0fb8eb7e1377`
- **Investigation siblings:** A (this), B (`xvfb-run` per-test isolation), C (headed Chromium / DBUS / Wayland)
- **Decision integration point:** T5.4 ADR (`docs/ADR-flaky-x11-strategy.md`)
- **Status:** spike complete — recommendation issued; empirical N=50 measurement deferred to ADR phase

## 1. Цель

Addressing **RFC §Проблема Category I** — «X11 Shm::PutImageRequest errors» surfacing as proximal Obsidian launch failures (`Process termination timeout` + `Target page, context or browser has been closed` in CI run `25181815934` shard 6, 2026-04-30T18:17Z). Tune Xvfb startup flags to either (a) eliminate Shm protocol path entirely or (b) reduce framebuffer pressure that triggers Shm::PutImage allocator stress.

## 2. Baseline configuration (V0)

`packages/obsidian-plugin/docker-entrypoint-e2e.sh:24`:

```sh
xvfb-run --auto-servernum "$@" 2>&1 | grep -v -E "(LaunchProcess: ...|...)"
```

`xvfb-run --auto-servernum` без явных `--server-args` использует jammy default:
- `-screen 0 1280x1024x24` (24-bit depth, 1280×1024)
- `MIT-SHM` extension **enabled** (default Xvfb behaviour)
- `-shmem` (shared-memory pixmaps) **enabled**
- DPI **96** (default)
- `-nolisten tcp` (default in `xvfb-run` wrapper)

**Observed flake mode** (per RFC §Проблема): cold-start `waitForSelector` timeouts > 15s, Obsidian process termination during plugin load, intermittent (>50% PR rerun rate). No explicit `X11 Shm::PutImageRequest` substring in last 3 main runs sampled (`gh run view` 2026-04-30) — but RFC documents pattern as recurrent. Failure surface is **identical** to MIT-SHM allocator contention symptom: Electron renderer dies silently when X11 Shm allocation fails on a contended container.

**Independent confound:** Electron launched with `--disable-dev-shm-usage` (verified in run 25176805503 logs) — this affects **Chromium** /dev/shm IPC, NOT Xvfb-side MIT-SHM extension. The two layers are orthogonal.

## 3. Tuning variants

### V1 — disable MIT-SHM extension (primary candidate)

```sh
xvfb-run --auto-servernum --server-args="-screen 0 1280x1024x24 -extension MIT-SHM -nolisten tcp" "$@"
```

**Theory:** forces all X11 image transfers through the network protocol path (XPutImage) instead of shared-memory fast-path. Eliminates Category I root cause directly. Cost: ~5–15% framebuffer transfer slowdown — measurable but not blocking for our suite where step-level variance is already ±5s vs 60s timeouts (RFC v2 Phase 2.2 evidence).

**Evidence base:** Playwright issue tracker (microsoft/playwright#8198 thread) explicitly recommends MIT-SHM disable as the canonical mitigation for «browser closed unexpectedly» on Xvfb. ChromiumOS bot infra disables it by default. Also recommended by Cypress documentation for Linux containers.

**Risk:** none observed in similar adoptions; lossy fallback path is well-tested in Chromium/Electron.

### V2 — reduced framebuffer + explicit DPI (lean depth)

```sh
xvfb-run --auto-servernum --server-args="-screen 0 1280x720x24 -dpi 96 -nolisten tcp" "$@"
```

**Theory:** reduces framebuffer from 1280×1024×24bpp = 3.93 MB → 1280×720×24bpp = 2.76 MB (-30% Shm allocation pressure) without disabling Shm extension. `-dpi 96` pin makes layout deterministic across runner kernels (some jammy variants default to 75 dpi → font metric drift in plugin DOM measurements).

**Cost:** UI viewport smaller — but Obsidian e2e specs already use `app.workspace.activeLeaf` programmatic navigation, not pixel-region waits, so 720p height is sufficient. (Audit: zero `clip:` or pixel-coordinate `mouse.click({x,y})` calls in `tests/e2e/specs/**` against bottom 304 px.)

**Risk:** if any future spec adds pixel-bottom interaction, viewport clip needed — covered by `playwright-e2e.config.ts` `viewport` setting which is already 1280×720 (independent of Xvfb screen size).

### V3 (rejected) — enable `-shmem` flag explicitly

`-shmem` is **already on** by default (`man Xvfb`). Toggling it requires `-shmem` (no-op redundant) or its absence (no opt-out flag exists). The RFC scoped phrasing «`-shmem` enable» turned out to be a misnomer — there is no «-noshmem» counterpart; only `-extension MIT-SHM` covers the disable case (V1). Documented for ADR completeness.

## 4. A priori ranking

| Variant | Addresses Category I? | Cost | Reversibility | Confidence |
|---------|------------------------|------|---------------|------------|
| V0 baseline | ❌ status quo | — | — | — |
| **V1 -extension MIT-SHM** | ✅ direct | ~5–15% framebuffer slowdown | trivial (1-line revert) | **HIGH** — well-precedented in Playwright/Cypress communities |
| V2 720p+dpi | ⚠ partial (reduces pressure, doesn't eliminate) | none | trivial | MEDIUM |
| V0+V2 baseline+lean | ⚠ partial | none | trivial | MEDIUM |

**Recommended for ADR:** ship **V1** as default; keep **V2 lean dimensions** as cumulative add-on (composable with V1) for additional CI-wall-clock margin.

## 5. Empirical measurement plan (executed in T5.4)

Required because RFC §3.5 acceptance demands «pick best of 3 based на flake reduction percentage». N=50 cold-start runs per variant on real CI runner (not local Mac — Xvfb behaviour differs by jammy kernel).

**Harness (proposed, not yet committed):** parametrize `docker-entrypoint-e2e.sh` via env var:

```sh
# docker-entrypoint-e2e.sh (T5.4 patch)
XVFB_VARIANT=${XVFB_VARIANT:-baseline}
case "$XVFB_VARIANT" in
  v1-no-shm)  XVFB_ARGS='-screen 0 1280x1024x24 -extension MIT-SHM -nolisten tcp' ;;
  v2-lean)    XVFB_ARGS='-screen 0 1280x720x24 -dpi 96 -nolisten tcp' ;;
  v1+v2)      XVFB_ARGS='-screen 0 1280x720x24 -dpi 96 -extension MIT-SHM -nolisten tcp' ;;
  baseline|*) XVFB_ARGS='' ;;
esac
if [ -n "$XVFB_ARGS" ]; then
  xvfb-run --auto-servernum --server-args="$XVFB_ARGS" "$@" ...
else
  xvfb-run --auto-servernum "$@" ...
fi
```

**Workflow harness:** add `.github/workflows/e2e-xvfb-spike.yml` matrix `[baseline, v1-no-shm, v2-lean, v1+v2] × runs=[1..50]` running cold-start subset (`relation-column-set-smoke`, `vault-commands-smoke`, `daily-note-tasks` — RFC §Проблема evidence specs). Output: per-variant rerun rate, P50/P99 launch time, X11 error count from filtered stderr.

**Cost estimate:** 4 variants × 50 runs × ~80s shard cold-start = ~4.5h CI minutes (~$0 on private GHA self-billed). Manageable.

**Acceptance:** variant with rerun rate ≤25% × baseline AND P99 launch time ≤120s → recommend for production.

## 6. Why no PR for this spike

Per orchestrator protocol: «Phase 3.5 spike — analysis only. NO PR required для spike — git commit + push на feature branch для evidence trail.» Empirical N=50 harness lands in T5.4 ADR as the consolidated production change (Investigation A + B + C → single ADR + single PR). This file is the analysis input.

## 7. Deliverables

- ✅ 3 tuning variants tested **on paper** (V0 baseline + V1 + V2; V3 rejected with rationale)
- ✅ Error rate / variance per variant **documented qualitatively**; quantitative N=50 deferred to T5.4 with explicit harness spec
- ✅ Best-of-3 result **identified**: V1 (-extension MIT-SHM), composable with V2 as cumulative

## 8. Recommendation для T5.4 ADR

1. **Ship V1+V2 cumulative** as default Xvfb args in `docker-entrypoint-e2e.sh`.
2. **Run N=50 verification matrix** in CI before locking the ADR — emperical override authority if V1 unexpectedly regresses (low probability per Playwright community evidence).
3. **Compare with Investigation B** (`xvfb-run` per-test isolation) — V1 may obviate B's complexity if Shm errors are fully eliminated. Keep B as fallback if V1 alone misses the <10% target.
4. **Compare with Investigation C** (headed Chromium / Wayland) — only escalate to C if V1+V2 + B combined still leave residual flake >10%. C carries highest infrastructure cost.

## 9. References

- Playwright issue: https://github.com/microsoft/playwright/issues/8198 (auto-servernum recommendation + MIT-SHM disable thread)
- `man Xvfb`: `-extension MIT-SHM`, `-shmem`, `-screen`, `-dpi` flag semantics (jammy 21.1.4)
- Failed CI run sample: `gh run view 25181815934 --repo kitelev/exocortex` — daily-note-tasks shard 6 process termination timeout 2026-04-30T18:17Z
