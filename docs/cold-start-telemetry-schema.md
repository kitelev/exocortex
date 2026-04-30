# Cold-Start Telemetry — JSON Schema (RFC 32a64ed9 §3.1, Phase 3.1)

> **Status:** Phase 3.1 — analysis + instrumentation only. No CI gating yet.
> **Source of truth:** `packages/obsidian-plugin/tests/e2e/utils/coldStartTelemetry.ts`

## Purpose

Per-step P50/P95/P99 timing of the E2E cold-start lifecycle. Phase 3.0 gap analysis
(commit `d72569e4`, `PHASE3_GAP_ANALYSIS.md`) confirmed Cat H (cache cold-start)
correlation Pearson r = +0.358 between cache-cold runs and slow rerun-rate halves.
Phase 3.1 instruments the lifecycle so subsequent phases can attribute variance
to specific steps (Xvfb startup, Obsidian process spawn, plugin load, vault
index) rather than treating cold-start as an opaque blob.

## Six instrumented steps

| # | Step                | Emitter                                  | Context  | Definition                                                              |
|---|---------------------|------------------------------------------|----------|-------------------------------------------------------------------------|
| 1 | `docker_pull`       | CI workflow (out-of-process)             | `shell`  | Image pull duration. Optional — out of entrypoint scope.                |
| 2 | `container_start`   | `docker-entrypoint-e2e.sh`               | `shell`  | Entrypoint invoked → just-before `xvfb-run` dispatch.                   |
| 3 | `xvfb_ready`        | `docker-entrypoint-e2e.sh`               | `shell`  | `xvfb-run` spawn → user command (Playwright runner) exits.              |
| 4 | `obsidian_spawn`    | `waitForExocortexPluginViaPlaywright`    | `node`   | Test start → `window.app` available in Electron renderer.               |
| 5 | `plugin_load`       | `waitForExocortexPluginViaPlaywright`    | `node`   | `window.app` available → `exocortex` plugin registered.                 |
| 6 | `vault_index`       | `waitForVaultIndex`                      | `node`   | Plugin registered → `vault.adapter.list("/")` resolves.                 |
| 7 | `first_interaction` | `recordFirstInteraction`                 | `node`   | Vault ready → first user-facing action closure completes.               |

(`docker_pull` is an out-of-process step. The aggregator reports it as `n/a`
when absent, rather than treating absence as failure.)

## JSONL record schema

One record per step, appended to `$COLD_START_TELEMETRY_LOG`:

```json
{
  "ts":      1714500000000,
  "step":    "plugin_load",
  "ms":      2500,
  "spec":    "alias-sync-on-label-change.spec.ts",
  "shard":   "1",
  "context": "node"
}
```

| Field     | Type     | Required | Notes                                                          |
|-----------|----------|----------|----------------------------------------------------------------|
| `ts`      | `number` | yes      | Epoch milliseconds at emission.                                |
| `step`    | `enum`   | yes      | One of the 7 step names above.                                 |
| `ms`      | `number` | yes      | Step duration in milliseconds.                                 |
| `spec`    | `string` | no       | Spec/test identifier. `unknown` when not provided.             |
| `shard`   | `string` | no       | CI shard ID from `$E2E_SHARD_ID`. `unknown` when unset.        |
| `context` | `enum`   | yes      | Emission origin: `shell`, `node`, or `browser`.                |

## Stderr line format (always emitted)

In addition to the JSONL sink, every record is mirrored to stderr in a
grep-compatible single-line format:

```
[COLD_START_TELEMETRY] step=<step> ms=<ms> spec=<spec> shard=<shard> context=<ctx>
```

Mirrors the existing `[PLUGIN_WAIT_MS]` channel for forward compatibility.

## Aggregation summary line

`summarizeColdStartTelemetry(logPath)` reads the JSONL and emits, per step:

```
[COLD_START_TELEMETRY_SUMMARY] step=<step> count=<n> p50=<n> p95=<n> p99=<n>
```

Steps with zero samples emit `count=0 (n/a)`. Percentiles use Type-7 linear
interpolation (numpy / R default).

## Activation

| Variable                     | Required? | Effect                                                |
|------------------------------|-----------|-------------------------------------------------------|
| `COLD_START_TELEMETRY_LOG`   | optional  | Path to JSONL sink. Unset ⇒ stderr-only.              |
| `E2E_SHARD_ID`               | optional  | Tags records with shard. Unset ⇒ `shard=unknown`.     |
| `E2E_SPEC_NAME`              | optional  | Shell-side step tag (entrypoint).                     |

When `COLD_START_TELEMETRY_LOG` is unset, the helpers and entrypoint script
are still safe to call — they emit only the stderr lines and skip file I/O.

## Backwards-compatibility contract

- Existing `[PLUGIN_WAIT_MS]` channel preserved — no callers needed to change.
- `waitForExocortexPluginViaPlaywright` signature unchanged.
- New helpers (`waitForVaultIndex`, `recordFirstInteraction`) are opt-in.
- All emission is best-effort: I/O failures are swallowed and never fail tests.

## Phase 3.1 next steps (out of scope here)

- T1.2: CI artifact upload of `$COLD_START_TELEMETRY_LOG` per shard.
- T1.3: Aggregator workflow combining shard JSONL into a single summary that
  feeds into the existing flaky-reporter dashboard.
