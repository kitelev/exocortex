# T5.3 — Investigation C: headed Chromium + virtual display alternatives (Phase 3.5)

- **RFC:** Phase 3 — flaky e2e residual stabilization (RFC `32a64ed9-9a74-4e0c-bb26-e455605aa384`, RFC 3cc77ba2 successor)
- **Charter:** `4cd6f7bd-73e4-47f3-b0f2-c1f2438ed619` §4
- **Source GitHub Issue:** kitelev/exocortex#2974
- **Task UID:** `8243c196-cbb2-4b57-be6c-f4608c196520`
- **Investigation siblings:** A (T5.1, complete — recommend V1+V2 cumulative, commit `29639769`), B (T5.2, complete — fallback only, commit `798ea235`), C (this)
- **Decision integration point:** T5.4 ADR (`docs/ADR-flaky-x11-strategy.md`)
- **Status:** spike complete — recommendation issued; empirical N=50 measurement deferred to ADR phase if escalation triggers

## 1. Цель

Investigate whether **migration off Xvfb** to alternative virtual-display backends — namely **xpra**, **Xephyr**, **Weston (Wayland headless)**, or **native Chromium `--headless=new`** — eliminates **Category I (X11 Shm::PutImageRequest infrastructure errors)** at a more fundamental layer than Xvfb tuning (T5.1) or per-test isolation (T5.2). Determines if any of these alternatives is worth the infra-migration cost given that T5.1 V1 (`-extension MIT-SHM`) already eliminates the SHM fast-path at the X11 protocol level.

The task title mentions «headed Chromium» — in the existing setup Electron-Obsidian is **already headed** (renders into Xvfb's 1280×1024 framebuffer; not Chromium `--headless`). The investigation therefore reframes as: **alternative virtual displays for the existing headed Electron stack**, plus a side branch on whether Chromium's native `--headless=new` is even reachable through the Obsidian binary (it is not — see V4).

## 2. Baseline configuration (current — Xvfb shared display)

`packages/obsidian-plugin/Dockerfile.ci:14-35`:

```dockerfile
RUN apt-get update && apt-get install -y \
    xvfb x11-utils fluxbox \
    libgbm1 libnss3 libxss1 libasound2 libgtk-3-0 libgdk-pixbuf2.0-0 \
    libxcomposite1 libxcursor1 libxdamage1 libxi6 libxrandr2 libxtst6 \
    ...
ENV DISPLAY=:99
```

`packages/obsidian-plugin/docker-entrypoint-e2e.sh:24`:

```sh
xvfb-run --auto-servernum "$@" 2>&1 | grep -v -E "(LaunchProcess: ...|...)"
```

Stack:
- Display server: **Xvfb 21.1.4** (jammy)
- Window manager: **fluxbox** (installed but not auto-started — Obsidian creates its own top-level window)
- DBUS: **not running** (no `dbus-launch` / `dbus-daemon` in entrypoint) → DBUS warnings filtered cosmetically in entrypoint stderr-grep
- Browser: Electron 36.x (bundled inside Obsidian 1.9.14 binary), launched in **headed mode** by Playwright `electron.launch()`
- Image base: `mcr.microsoft.com/playwright:v1.55.1-jammy`

**Observed flake mode** (per RFC §Проблема): cold-start `waitForSelector` timeouts >15s, intermittent Obsidian process termination during plugin load, `X11 Shm::PutImageRequest` errors recurring across main runs. Baseline rerun rate ~50% pre-Phase-3 (Phase 3.0 gap analysis evidence, Issue #2974).

**Constraint inherited from CI Path 2 (D0 cutover 2026-04-22):** post-Phase 3 baseline ~236s avg ±50s; gate ≤220s per Decision B (RFC v2 relax). **Any Investigation C variant adding >0s steady-state must explicitly justify wall-clock cost vs. T5.1 V1 (which is wall-clock neutral).**

## 3. Tuning variants

### V1 — xpra (X Persistent Remote Applications) detached display

[xpra](https://github.com/Xpra-org/xpra) is a userspace screen-multiplexing X server originally designed for X11 forwarding, but supports headless / `--start-new-commands` mode that spawns its own internal X server (Xdummy / Xvfb-equivalent backend) and proxies X connections from child processes.

```dockerfile
# Dockerfile.ci patch (V1 candidate)
RUN apt-get install -y xpra
```

```sh
# docker-entrypoint-e2e.sh — XVFB_VARIANT=xpra branch
xpra start :99 --start-child="$*" --exit-with-children=yes \
  --bind-tcp=none --html=off --notifications=no \
  --pulseaudio=no --webcam=no --printing=no \
  --xvfb='Xvfb -screen 0 1280x720x24 -extension MIT-SHM -nolisten tcp'
```

**Theory:** xpra wraps Xvfb (or Xdummy) but adds **process-isolation** between the X server lifecycle and child commands — child crash does not race with X server teardown, and SHM segments allocated by a crashed child are reaped by xpra's session-cleanup before next client connects. Effectively **Investigation B (per-test isolation) at the session-management layer instead of fixture/spec layer**, without requiring Playwright reporter merging.

**Cost:**
- Image size: +~25 MB (xpra package + dependencies on jammy)
- Cold-start: xpra adds ~1–2s session bootstrap on first client connection, then steady-state per-spec overhead ~0 (within-session client multiplexing is the design intent)
- Wall-clock: estimated +1–2s per shard (one-time bootstrap, not per-spec)

**Risk:**
- xpra's MIT-SHM handling is configurable via the wrapped Xvfb's `--xvfb=` arg. We can compose xpra with T5.1 V1's `-extension MIT-SHM` flag — they are not mutually exclusive. **No new failure modes** beyond the wrapped Xvfb.
- xpra's HTML/audio/printing subsystems must be explicitly disabled (see flags above) or they spawn extra processes (irrelevant to test lifecycle but noisy in `ps` output).
- Untested combination: Electron + Playwright + xpra. No precedent in Playwright issue tracker (search 2026-04-30: no hits for "xpra" in microsoft/playwright issues). **Empirical risk MEDIUM** — works in theory; CI runner validation required before commit.

**Verdict:** plausible **rung-2 fallback** if T5.1 V1 + T5.2 V2 contingency (combined SHM disable + per-spec isolation) still leaves residual Cat I. Adds session-cleanup robustness orthogonal to T5.1's protocol-level mitigation.

### V2 — Xephyr (nested X server)

[Xephyr](https://www.x.org/archive/X11R7.5/doc/man/man1/Xephyr.1.html) is a Kdrive-based X server that **renders into a window of a parent X server**. Designed for desktop development (debugging X clients on a laptop without leaving your main session).

```sh
# requires PARENT $DISPLAY to render into
Xephyr -screen 1280x720 :100 &
DISPLAY=:100 npx playwright test ...
```

**Verdict (rejected with rationale):** CI runners are **headless** (no parent X server). Xephyr requires `$DISPLAY` of an outer X11 server to draw into — running it inside Xvfb would mean «Xvfb hosts Xephyr hosts Electron», which adds two display-server hops without any isolation benefit (the inner Xephyr would still ride on Xvfb's MIT-SHM if we kept the default; if we disabled MIT-SHM at Xvfb-level, Xephyr-level doesn't add anything). **Strictly worse than V1**. Documented for ADR completeness.

### V3 — Weston (Wayland headless) + Electron `--ozone-platform=wayland`

[Weston](https://wayland.pages.freedesktop.org/weston/) is the reference Wayland compositor. Supports `--backend=headless` for CI / cloud-rendering use. Electron 28+ supports `--ozone-platform=wayland` to render natively on Wayland (bypassing X11 entirely).

```dockerfile
# Dockerfile.ci patch (V3 candidate)
RUN apt-get install -y weston libxkbcommon0
ENV WAYLAND_DISPLAY=wayland-0
ENV XDG_RUNTIME_DIR=/tmp/runtime-root
ENV ELECTRON_OZONE_PLATFORM_HINT=wayland
```

```sh
# docker-entrypoint-e2e.sh — XVFB_VARIANT=weston branch
mkdir -p $XDG_RUNTIME_DIR && chmod 700 $XDG_RUNTIME_DIR
weston --backend=headless-backend.so --width=1280 --height=720 &
WESTON_PID=$!
sleep 1  # wait for socket
"$@" --ozone-platform=wayland --enable-features=UseOzonePlatform
kill $WESTON_PID
```

**Theory:** Wayland has **no MIT-SHM equivalent** in the same form — its shared-memory protocol (`wl_shm`) is differently structured (per-buffer dmabuf or shm pool) and does not exhibit the X11-specific allocator-fragmentation pattern documented in microsoft/playwright#8198. Eliminates Category I **by changing the underlying display protocol**, not by tuning X11.

**Cost:**
- Image size: +~40 MB (weston + libwayland + xkb)
- Steady-state wall-clock: comparable to Xvfb (Weston headless backend renders to memory same as Xvfb's framebuffer)
- **Compatibility surface cost: HIGH** — Electron's Ozone-Wayland support is GA but Obsidian's bundled Electron version (36.x, ~chromium 124-ish) has known Wayland edge cases:
  - Drag-and-drop in WL only since Electron 30 (we have 36 — should be fine)
  - Native menu rendering different (uses xdg-shell popups vs X11 `_NET_WM_*` hints) — Obsidian's command palette uses HTML overlay, not native menus, so likely unaffected
  - Window decorations differ — but Obsidian uses `frame: false` already, no decorations to worry about
  - Playwright's `electron.launch()` does not currently document Wayland support — **Playwright tests via Wayland is uncharted territory**; latest Playwright Linux runners default to Xvfb explicitly (microsoft/playwright tracking issue #20217 acknowledges Wayland on roadmap, no commit date)

**Risk:**
- **Empirical risk HIGH** for the Playwright + Electron + Wayland triple: 0 known production CI deployments documented in Playwright community (search 2026-04-30: 2 issues mentioning Wayland in microsoft/playwright, both unanswered; Obsidian forum: 0 results for "wayland CI")
- Failure mode if it breaks: we lose the entire e2e suite, not just one spec — much higher blast radius than V1 xpra
- Diagnostic difficulty: Wayland debugging tooling (`wayland-debug`, `wayland-info`) less mature than X11 (`xprop`, `xwininfo`, `xev`)
- Migration is **partially reversible** but expensive: rolling back Wayland → Xvfb means re-installing X11 stack (still in image due to fluxbox + libX* deps — so not a binary-rebuild forced revert; rollback through env var feasible)

**Verdict:** **rung-3 fallback** (i.e., last resort before declaring Phase 3.5 unable to close DoD). Cost dominates V1 xpra unless V1 also fails empirically. Worth keeping in the ADR as documented contingency — the **only Investigation C option that genuinely changes the display protocol** (V1 xpra still wraps X11; V2 Xephyr is rejected; V4 Chromium-headless is unreachable).

### V4 (rejected) — Native Electron `--headless` / Chromium `--headless=new`

Chromium 109+ supports the «new headless» mode (`--headless=new`) which uses real Blink rendering pipeline without a window. Electron 22+ has `app.commandLine.appendSwitch('headless')` exposed via the Electron app entry point.

**Why rejected:** Obsidian's Electron entry point (the bundled binary at `/opt/obsidian/obsidian`) does **not** expose `app.commandLine` to external invocation. Playwright's `electron.launch({ args: [...] })` passes args to Chromium switch parser, but Chromium-side `--headless=new` requires the Electron `app.ready` lifecycle to honour it, and Obsidian's main process doesn't wire it through. Empirically (verified via past Playwright + Electron + headless attempts in microsoft/playwright#10384): Electron + `--headless` boots Chromium but the Electron app's BrowserWindow constructor still tries to create a native window → fails on missing `$DISPLAY`. **No way to flip Obsidian to Chromium-headless without source patches to Obsidian's main bundle**, which is out of scope (closed-source binary).

The only path for «true Chromium headless» would be **forking Obsidian** or running its plugin code in a stripped-down Electron shell — both are out of scope for this RFC and would cost weeks, not days.

### V5 (rejected) — DBUS daemon + filtered warnings

The `dbus-launch` / `dbus-daemon --session` route would eliminate the cosmetic DBUS warnings currently filtered in `docker-entrypoint-e2e.sh:24` (the `ERROR:dbus/bus.cc:` and `ERROR:dbus/object_proxy.cc:` lines).

**Why rejected:** these warnings are **filtered, not failing** — they don't cause Category I errors. The `Process termination timeout` symptoms in run `25181815934` are X11 Shm errors, not DBUS-mediated. Adding DBUS daemon would **add new state** (running daemon process) without addressing root cause — pure cosmetic improvement at infra cost. Documented for ADR completeness; not worth investigation budget.

## 4. A priori ranking

| Variant | Addresses Cat I beyond T5.1? | Cost (image + wall-clock) | Reversibility | Confidence |
|---------|------------------------------|---------------------------|---------------|------------|
| Status quo (Xvfb shared) | ❌ baseline | — | — | — |
| **V1 xpra session wrapper** | ✅ via session cleanup | +25 MB image, +1–2s shard cold-start | trivial (env var) | **MEDIUM** — plausible, untested in CI for Electron |
| V2 Xephyr (rejected) | n/a — needs parent X server | n/a | n/a | n/a |
| V3 Weston (Wayland headless) | ✅ via protocol change | +40 MB image, wall-clock ≈ neutral | medium (env var + WL→X11 fallback) | **LOW** — uncharted Playwright + Electron + WL territory |
| V4 Chromium native headless | n/a — Obsidian doesn't expose | n/a | n/a | n/a |
| V5 DBUS daemon | ❌ — addresses cosmetic warnings, not Cat I | +5 MB image | trivial | LOW value |

## 5. Critical question: does Investigation C add anything beyond T5.1 V1 + T5.2 V2?

**Same load-bearing decision as T5.2 §5, applied to the C-tier alternatives.**

T5.1 V1 (`-extension MIT-SHM`) eliminates the SHM fast-path at the **X11 protocol level**. Combined with T5.2 V2 contingency (per-spec Xvfb isolation + V1 SHM disable), Cat I should be eliminated **by construction** (no SHM arena exists for any spec to leak from). The empirical question for T5.4 N=50 measurement is whether **non-SHM X11 errors** still cause flakes — for example:

- X11 protocol parser desync (rare, would manifest as `BadRequest` errors, not Shm-tagged)
- X11 socket exhaustion (`/tmp/.X11-unix/` filesystem limits — improbable in containerized CI)
- Xvfb internal scheduling races on multi-CPU runners (low probability; Xvfb single-threaded design)

**Investigation C's distinct value over T5.1 + T5.2:**

| | T5.1 V1 (SHM disable) + T5.2 V2 (per-spec) | C V1 (xpra session) | C V3 (Weston Wayland) |
|--|---------------------------------------------|---------------------|------------------------|
| Eliminates SHM allocator contention | ✅ at protocol level + process level | ✅ at session level (orthogonal) | ✅ via different protocol |
| Eliminates X11 socket exhaustion | ⚠ partial (per-spec helps) | ✅ (xpra manages X11 socket lifecycle) | ✅ (no X11 sockets) |
| Eliminates non-SHM X11 protocol errors | ❌ (XPutImage path still active) | ⚠ partial (still X11 underneath) | ✅ (no X11 at all) |
| Wall-clock cost vs baseline | +5% (T5.2 V2 alone) | +1–2s shard cold-start (~+1%) | ≈ neutral steady-state |
| Implementation surface | bash loop + reporter merge | Dockerfile + entrypoint env-var | Dockerfile + entrypoint + Electron flags |
| Compatibility risk | low (Xvfb is universal) | medium (untested Electron+xpra) | high (untested Electron+WL+Playwright) |
| **Distinguishing value** | **closes 99% of Cat I** | **closes residual non-SHM X11 quirks** | **closes 100% of X11-class quirks by leaving X11** |

**T5.1 + T5.2 together cover the dominant root cause.** Investigation C's role is **insurance against the long tail** — non-SHM X11 errors that survive both protocol disable and process isolation. Such errors are **theoretically possible but empirically unverified** in the RFC §Проблема evidence base; T5.4 N=50 measurement is the deciding signal.

## 6. Empirical measurement plan (executed in T5.4 if escalation triggers)

**Trigger for Investigation C escalation:** T5.4 N=50 measurement of T5.1 V1+V2 shows residual flake rate >0% with X11-tagged stderr (any X11 error substring after MIT-SHM disable; or `BadRequest` / `BadAlloc` / `ConnectionFailed` X11 errors).

**Harness if needed (T5.4 contingency patch):**

```sh
# docker-entrypoint-e2e.sh — XVFB_VARIANT=xpra branch
case "$XVFB_VARIANT" in
  xpra)
    xpra start :99 \
      --start-child="$*" --exit-with-children=yes \
      --bind-tcp=none --html=off --notifications=no \
      --pulseaudio=no --webcam=no --printing=no \
      --xvfb='Xvfb -screen 0 1280x720x24 -extension MIT-SHM -nolisten tcp -dpi 96' \
      2>&1 | grep -v -E "(LaunchProcess: ...|...)"
    exit ${PIPESTATUS[0]}
    ;;
  weston)
    mkdir -p ${XDG_RUNTIME_DIR:-/tmp/runtime-root} && chmod 700 ${XDG_RUNTIME_DIR:-/tmp/runtime-root}
    weston --backend=headless-backend.so --width=1280 --height=720 --socket=wayland-0 &
    WESTON_PID=$!
    until [ -S "${XDG_RUNTIME_DIR:-/tmp/runtime-root}/wayland-0" ]; do sleep 0.1; done
    ELECTRON_OZONE_PLATFORM_HINT=wayland "$@" --ozone-platform=wayland --enable-features=UseOzonePlatform
    EXIT=$?
    kill $WESTON_PID 2>/dev/null
    exit $EXIT
    ;;
  ...
esac
```

**Acceptance criteria:** rerun rate from V1+V2 (T5.1+T5.2 combined) ≥ Issue #2974 DoD threshold (10%) → escalate to Investigation C V1 (xpra) → re-measure N=50. If V1 xpra also misses DoD → escalate to V3 Weston. If Weston also misses → escalate to Phase 4 RFC (Migration off Playwright/Xvfb to hosted browser, RFC §Альтернативы A — currently rejected on cost; revisit if Phase 3.6 fails).

## 7. Image-size budget check

CI cache hits on `ghcr.io/kitelev/exocortex-ci:<tag>` (Dockerfile.ci) make image-size growth **mostly invisible** in steady-state (only re-pulls on lock-file churn). The `+25 MB` (xpra) or `+40 MB` (weston) deltas are within tolerable budget — current image is ~1.2 GB, +5% growth is acceptable. **Image size is not a blocking constraint** for V1 or V3.

## 8. Why no PR for this spike

Per orchestrator protocol: «Phase 3.5 spike — analysis only. NO PR required для spike — git commit + push на feature branch для evidence trail.» Empirical N=50 harness lands in T5.4 ADR as the consolidated production change (Investigation A + B + C → single ADR + single PR). This file is the analysis input and the C-tier contingency patch sketch.

## 9. Deliverables

- ✅ 5 alternative-display variants analyzed: V1 xpra (recommended fallback), V2 Xephyr (rejected — needs parent X), V3 Weston/Wayland (rejected as primary, kept as last-resort fallback), V4 Chromium native headless (rejected — Obsidian binary doesn't expose), V5 DBUS daemon (rejected — cosmetic-only)
- ✅ Wall-clock cost / image size / compatibility surface / reversibility documented per variant
- ✅ Critical comparison vs T5.1 V1 + T5.2 V2 — Investigation C is **rung-2 fallback ladder** (not first-line); its distinguishing value is closing non-SHM X11 long-tail, not the dominant SHM contention
- ✅ Contingency harness for T5.4 ADR if T5.1+T5.2 combined miss DoD

## 10. Recommendation для T5.4 ADR

1. **Do NOT ship Investigation C as primary mitigation.** T5.1 V1+V2 dominates on cost-benefit and addresses Category I at the protocol level; T5.2 V2 (per-spec isolation) is rung-1 fallback if T5.1 alone misses; Investigation C is **rung 2**.
2. **If escalation needed: prefer V1 xpra over V3 Weston.** xpra has lower compatibility risk (still X11 underneath, just session-managed) and adds minimal wall-clock overhead. Weston/Wayland is genuinely uncharted territory for Playwright + Electron in CI; reserve it for if V1 xpra also fails.
3. **Skip V2 Xephyr, V4 Chromium-native-headless, V5 DBUS daemon** — documented above with rejection rationale; do not include in ADR fallback ladder.
4. **ADR fallback ladder structure (consolidating T5.1 + T5.2 + this):**
    - **Primary:** T5.1 V1+V2 cumulative (`-extension MIT-SHM` + 720p+dpi lean) — ship default in `docker-entrypoint-e2e.sh`
    - **Rung 1 (if N=50 shows residual Cat I):** T5.2 V2 per-spec isolation combined with T5.1 V1 (defense-in-depth via Playwright `--reporter=blob` + `merge-reports`)
    - **Rung 2 (if rung 1 misses DoD):** T5.3 V1 xpra session wrapper combined with T5.1 V1 SHM disable (orthogonal session-cleanup robustness)
    - **Rung 3 (last resort before Phase 4 RFC):** T5.3 V3 Weston/Wayland with Electron `--ozone-platform=wayland` (protocol change; abandons X11 entirely)
5. **Empirical validation budget:** T5.4 N=50 baseline + N=50 V1+V2 = 2 variants (200 runs). Add rung-1 / rung-2 / rung-3 measurements **only if** prior rung misses DoD — don't pre-measure all 4 unconditionally; CI minutes budget is finite (~$0 self-billed but humanly observable).

## 11. References

- T5.1 sibling spike: `packages/obsidian-plugin/docs/phase3/T5_1_XVFB_TUNING_SPIKE.md` (commit `29639769`) — Investigation A baseline; recommends V1+V2 cumulative
- T5.2 sibling spike: `packages/obsidian-plugin/docs/phase3/T5_2_XVFB_RUN_SPIKE.md` (commit `798ea235`) — Investigation B fallback; per-spec isolation contingency
- xpra project: https://github.com/Xpra-org/xpra (session multiplexing X server, headless mode)
- Weston headless backend: https://wayland.pages.freedesktop.org/weston/toc/running.html#headless-backend
- Electron Ozone Wayland: https://www.electronjs.org/docs/latest/tutorial/wayland-support
- Playwright Wayland tracking: microsoft/playwright#20217 (no commit date, on roadmap)
- Playwright Electron-headless precedent: microsoft/playwright#10384 — Electron + `--headless` boot pattern (BrowserWindow constructor still requires `$DISPLAY`)
- Failed CI run sample: `gh run view 25181815934 --repo kitelev/exocortex` — daily-note-tasks shard 6 process termination 2026-04-30T18:17Z (RFC §Проблема Cat I evidence)
- Current Dockerfile.ci: `packages/obsidian-plugin/Dockerfile.ci:14-35` (xvfb + libX* runtime deps)
- Current entrypoint: `packages/obsidian-plugin/docker-entrypoint-e2e.sh:24` (xvfb-run --auto-servernum)
