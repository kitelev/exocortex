# T5.2 — Investigation B: `xvfb-run` per-test display isolation (Phase 3.5)

- **RFC:** Phase 3 — flaky e2e residual stabilization (RFC `32a64ed9-9a74-4e0c-bb26-e455605aa384`, RFC 3cc77ba2 successor)
- **Charter:** `4cd6f7bd-73e4-47f3-b0f2-c1f2438ed619` §4
- **Source GitHub Issue:** kitelev/exocortex#2974
- **Task UID:** `537d4fd2-d336-4124-91bf-2d362b299d0d`
- **Investigation siblings:** A (T5.1, complete — recommend V1+V2 cumulative), B (this), C (headed Chromium / DBUS / Wayland)
- **Decision integration point:** T5.4 ADR (`docs/ADR-flaky-x11-strategy.md`)
- **Status:** spike complete — recommendation issued; empirical N=50 measurement deferred to ADR phase

## 1. Цель

Investigate whether per-test isolation of the Xvfb display server (each spec / each worker spawning its own dedicated Xvfb instance) eliminates **Category I — X11 Shm::PutImageRequest infrastructure errors** that survive Investigation A's framebuffer-level mitigations. Determines if cross-test contention on a *shared* MIT-SHM segment is a residual root cause separate from extension-level allocator pressure (which V1 in T5.1 covers).

## 2. Baseline configuration (current — single shared display)

`packages/obsidian-plugin/docker-entrypoint-e2e.sh:24`:

```sh
xvfb-run --auto-servernum "$@"
```

Semantics of `xvfb-run --auto-servernum` (jammy `xvfb` 21.1.4, `xvfb-run` 1.20.x wrapper):

1. Picks an unused display number (e.g. `:99`), starts a single `Xvfb :99` background process.
2. Exports `DISPLAY=:99` to the child.
3. Runs the child command (`npx playwright test ...`) **once** — the child orchestrates ALL test cases, ALL workers, ALL projects under that one `DISPLAY`.
4. On child exit, kills the Xvfb instance.

**Worker model interaction** (`packages/obsidian-plugin/playwright-e2e.config.ts`):

```
fullyParallel: false
workers: 1
```

→ E2E suite runs **serially within a shard**. One Xvfb : one Playwright runner : one Electron-Obsidian process at a time. Across the **6 shards** (CI matrix), each shard is a separate runner / separate container / separate `xvfb-run` invocation → **already** has shard-level isolation. Per-test isolation would only differ from the status quo *within* a single shard's serial test sequence.

**This is the load-bearing observation for Investigation B's relevance.**

## 3. Tuning variants

### V1 — `xvfb-run` per Playwright test (Playwright globalSetup spawn)

```ts
// playwright-e2e.config.ts (sketch)
globalSetup: './tests/e2e/xvfb-per-test-setup.ts',
use: {
  launchOptions: {
    env: {
      DISPLAY: process.env.DISPLAY, // injected per-worker by setup
    },
  },
},
```

```ts
// xvfb-per-test-setup.ts (sketch — NOT a true per-test, per-worker)
test.beforeEach(async ({}, testInfo) => {
  const display = `:${100 + testInfo.parallelIndex}`;
  spawn('Xvfb', [display, '-screen', '0', '1280x720x24']);
  process.env.DISPLAY = display;
});
test.afterEach(async () => {
  // SIGTERM Xvfb pid
});
```

**Problem with V1 (fundamental):** Playwright's Electron launcher reads `DISPLAY` at `electron.launch()` time, which fires per-test if `beforeEach` does fresh launch — but in our suite Electron is launched once per spec via fixture and reused across tests in that spec. Per-**test** isolation requires reorganizing the fixture lifecycle, which is high-blast-radius vs. the actual contention surface (single-worker serial suite — see §2 worker model).

**Per-spec isolation is the realistic granularity** — equivalent to V2.

### V2 — `xvfb-run` per spec file (Playwright project / shard sub-grouping)

Wrap each spec invocation in its own `xvfb-run` shell call. Possible via Playwright `globalSetup` per project, OR (simpler) via `test.use({ launchOptions })` with a fixture that spawns Xvfb on entry and tears it down on exit.

Practical implementation candidate:

```sh
# docker-entrypoint-e2e.sh (T5.4 patch — V2 variant)
# Replace single xvfb-run wrap with per-spec invocation orchestrated by a
# small bash loop emitted by Playwright's --list mode.
specs=$(npx playwright test --list --reporter=line | grep -oE 'tests/e2e/specs/[^ ]+\.spec\.ts' | sort -u)
for spec in $specs; do
  xvfb-run --auto-servernum --server-args="-screen 0 1280x720x24" \
    npx playwright test "$spec" --reporter=line || exit_code=$?
done
exit ${exit_code:-0}
```

**Theory:** Each spec gets a fresh Xvfb process → fresh `/tmp/.X11-unix/X{N}` socket → fresh MIT-SHM allocation arena. If any prior test leaked SHM segments (Electron crash mid-test → unreaped `shmget` regions → next test's `XPutImage` faces fragmented arena), the new server starts clean.

**Cost:** Xvfb startup ≈ 200–400ms per spec × ~30 specs per shard = 6–12s added wall-clock per shard. CI baseline is ~236s ±50s (RFC v2 Phase 3 baseline) → +5% wall-clock. Inside the gate ≤220s envelope only marginally — collides with Decision B relax.

**Risk:**
- Aggregated reporter output breaks: per-spec `playwright test` invocation produces N reporter outputs that must be merged into one `flaky-reporter.json` (T1.3 / T2.4 dependency). Requires custom merge step. **High implementation cost** for a spike.
- Shard-level rerun on retry no longer atomic — partial-spec retry semantics need re-design.
- HTML reporter / trace artifacts split across N invocations → CI artifact bundling complexity.

### V3 — `xvfb-run` per Obsidian launch (per-test, fixture-based)

Apply Xvfb spin-up/tear-down at the Electron launch boundary (`electron.launch()` fixture), not at the Playwright spec boundary. Each `obsidianApp` fixture acquisition provisions its own display.

```ts
// fixtures/obsidian-fixture.ts (sketch)
export const test = base.extend<{ obsidianApp: ElectronApplication }>({
  obsidianApp: async ({}, use, testInfo) => {
    const display = `:${200 + testInfo.workerIndex * 100 + testInfo.line}`;
    const xvfb = spawn('Xvfb', [display, '-screen', '0', '1280x720x24']);
    await waitForX11Socket(display);
    const app = await electron.launch({ args: [...], env: { ...process.env, DISPLAY: display } });
    await use(app);
    await app.close();
    xvfb.kill('SIGTERM');
  },
});
```

**Theory:** Maximum isolation — every Obsidian process gets a private X11 server. Eliminates Category I by construction (no shared SHM arena).

**Cost:** 200–400ms × ~80 Obsidian launches per shard = 16–32s added per shard. **+10–13% wall-clock** — exceeds Decision B ≤220s gate margin (currently ~236s avg → 260s+).

**Risk:**
- Display-number collision between workers — needs robust pid-based or workerIndex-based numbering.
- `xdg-settings` / dbus warnings filtered in `docker-entrypoint-e2e.sh:24` are global stderr — per-fixture spawning re-introduces them per launch unless filtering is replicated in fixture. Cosmetic but logs explode.
- Obsidian's own xdg writes (config dir cache) per display may not collide (separate `$HOME` per launch already), but the X11-side resource-manager (`xrdb`) state is duplicated per server — small memory bloat.

### V4 (rejected) — `xvfb-run` per worker (Playwright `workers > 1` parallelism with display-per-worker)

Currently `workers: 1` (E2E specs share Obsidian config dir, must run serially per shard — see comment in `playwright-e2e.config.ts:fullyParallel: false`). To use V4 we'd need to first parallelize specs (separate $HOME per worker, separate vault, etc.) — which is an entirely different RFC scope (parallelization, not flake stabilization). **Rejected as out-of-scope** for Phase 3.5.

## 4. A priori ranking

| Variant | Addresses Cat I beyond T5.1? | Cost (wall-clock) | Reversibility | Confidence |
|---------|------------------------------|--------------------|---------------|------------|
| Status quo (single shared) | ❌ baseline | — | — | — |
| V1 per-test naive | ⚠ blocked by fixture lifecycle | high impl cost, no actual per-test isolation | trivial revert | LOW — design issue |
| **V2 per-spec** | ✅ probable (clean SHM arena per spec) | +5% wall-clock; reporter merge complexity | medium (revert script + reporter logic) | **MEDIUM** |
| V3 per-launch fixture | ✅ maximal | +10–13% wall-clock — **breaks Decision B gate** | medium (revert fixture + filter dup) | LOW for prod (cost-prohibitive); HIGH for diagnostic isolation |
| V4 per-worker | n/a — orthogonal RFC | n/a | n/a | n/a |

## 5. Critical question: does V2/V3 add anything beyond T5.1's V1+V2?

**This is the load-bearing decision for Investigation B's value.**

T5.1 V1 (`-extension MIT-SHM`) **eliminates the X11 Shm fast-path entirely** at the protocol level. With MIT-SHM disabled, all image transfers go through XPutImage network protocol → no shared memory arena → no allocator fragmentation → no `Shm::PutImageRequest` errors **by construction**.

**Implication:** if T5.1 V1 ships and works (HIGH confidence per Playwright community precedent), Category I is closed. Per-display isolation (V2/V3 in this spike) addresses the same root cause via **a different mechanism** — same effect, higher cost, more complexity.

The two strategies are **redundant**, not complementary. T5.1 V1 dominates Investigation B on cost-benefit:

|  | T5.1 V1 (`-extension MIT-SHM`) | Investigation B V2 (per-spec isolation) |
|--|-------------------------------|-----------------------------------------|
| Eliminates SHM allocator contention | ✅ at protocol level | ✅ at process level |
| Wall-clock cost | ~5–15% framebuffer slowdown (offset by no SHM overhead — net ≈ neutral) | +5% wall-clock from N spawns |
| Implementation surface | 1-line `--server-args` change | reporter merge + bash loop + revert script |
| Reversibility | trivial | medium |
| Test harness churn | none | high (reporter pipeline) |

**T5.1 V1 dominates** unless V1 fails to eliminate Category I empirically (residual non-SHM X11 errors). Investigation B is therefore valuable as a **fallback**, not a first-line mitigation.

## 6. Empirical measurement plan (executed in T5.4)

If T5.4 ADR's N=50 V1 measurement shows residual Category I rate > 0 (any `X11 Shm::PutImageRequest` substring in stderr after V1 disable), escalate to V2 (per-spec isolation). Until then, V2 stays on the bench as documented contingency.

**Harness if needed (T5.4 contingency patch):**

```sh
# docker-entrypoint-e2e.sh — XVFB_VARIANT=per-spec branch
case "$XVFB_VARIANT" in
  per-spec)
    specs=$(npx playwright test --list --reporter=line | grep -oE 'tests/e2e/specs/[^ ]+\.spec\.ts' | sort -u)
    overall_exit=0
    for spec in $specs; do
      xvfb-run --auto-servernum --server-args="-screen 0 1280x720x24 -extension MIT-SHM" \
        npx playwright test "$spec" --reporter=blob --output="reports/$(basename $spec .spec.ts)" \
        || overall_exit=$?
    done
    npx playwright merge-reports --reporter=html ./reports || true
    exit $overall_exit
    ;;
  ...
esac
```

Note: combines V2 isolation **with** T5.1 V1 SHM disable (defense-in-depth fallback) — and uses Playwright's native `merge-reports` + `--reporter=blob` to avoid custom merge logic. Lowers V2 implementation cost from "high" to "medium".

**Acceptance for V2 escalation:** rerun rate from V1-alone ≥ Issue #2974 DoD threshold (10%) → escalate to V1+V2 combined → re-measure N=50.

## 7. Why no PR for this spike

Per orchestrator protocol: «Phase 3.5 spike — analysis only. NO PR required для spike — git commit + push на feature branch для evidence trail.» Empirical N=50 harness lands in T5.4 ADR as the consolidated production change (Investigation A + B + C → single ADR + single PR). This file is the analysis input and the V2 contingency patch sketch.

## 8. Deliverables

- ✅ Per-test (V1) / per-spec (V2) / per-launch (V3) isolation strategies analyzed; V4 rejected with rationale (out-of-scope parallelization)
- ✅ Wall-clock cost / implementation surface / reversibility documented per variant
- ✅ Critical comparison vs T5.1 V1 (`-extension MIT-SHM`) — Investigation B is **redundant fallback**, not first-line mitigation
- ✅ Contingency harness for T5.4 ADR if V1-alone misses DoD

## 9. Recommendation для T5.4 ADR

1. **Do NOT ship Investigation B as primary mitigation.** T5.1 V1+V2 dominates on cost-benefit and addresses Category I at the protocol level.
2. **Keep V2 (per-spec isolation) as documented contingency** in the ADR. If T5.4 N=50 measurement of T5.1 V1 shows residual Category I (any `Shm::PutImageRequest` after MIT-SHM disable — should be impossible by construction, but empirically validate), escalate to V1+V2 combined.
3. **Skip V3 (per-launch fixture)** — wall-clock cost (+10–13%) breaks the Decision B ≤220s gate. Only revisit if V1+V2 combined ALSO miss DoD AND Investigation C (headed / Wayland) is undesirable.
4. **ADR Section structure:** Investigation A (T5.1) = primary; Investigation B (this) = fallback ladder rung 1; Investigation C (T5.3) = fallback ladder rung 2.

## 10. References

- T5.1 sibling spike: `packages/obsidian-plugin/docs/phase3/T5_1_XVFB_TUNING_SPIKE.md` (commit `29639769`) — Investigation A baseline; recommends V1+V2 cumulative
- Playwright issue: https://github.com/microsoft/playwright/issues/8198 (auto-servernum thread; xvfb-run wrapper guidance)
- `man xvfb-run` (jammy): `--auto-servernum`, `--server-args`, single-display lifecycle semantics
- Playwright `merge-reports` + `--reporter=blob` API (≥1.37): https://playwright.dev/docs/test-reporters#merging-reports-from-multiple-shards
- `playwright-e2e.config.ts:fullyParallel: false; workers: 1` — load-bearing constraint that single-display contention is bounded to serial-within-shard
