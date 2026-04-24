#!/usr/bin/env bash
# phase2-2-measurement.sh — collect per-shard test-step timing from main CI runs
#
# Related: RFC 3cc77ba2 Phase 2.2 decision (Option C, 2026-04-25). This script
# captures the inputs that fed the decision so a future session can re-measure
# cheaply if drift-correlated retries appear and Option A/B revisit is needed.
#
# Usage:
#   scripts/phase2-2-measurement.sh [NUM_RUNS] [OUTPUT_DIR]
#     NUM_RUNS   : how many recent successful main CI runs to sample (default 20)
#     OUTPUT_DIR : where per-run / aggregate JSON is written (default $PWD/phase2-measurement)
#
# Requires: gh (authenticated against kitelev/exocortex), jq, python3.
#
# Notes:
# - Only post-D0 runs are 6-shard; if you reach back that far the Python
#   aggregator will drop runs missing shards.
# - run_attempt=2 jobs are treated as retries and excluded from the "clean"
#   variance aggregate; they are reported separately as flake signal.
# - Output format matches phase2-2-test-step-variance-2026-04-25.json.

set -euo pipefail

NUM_RUNS="${1:-20}"
OUTPUT_DIR="${2:-$PWD/phase2-measurement}"
REPO="${REPO:-kitelev/exocortex}"
WORKFLOW="${WORKFLOW:-CI}"
BRANCH="${BRANCH:-main}"

mkdir -p "$OUTPUT_DIR"

echo "→ listing last $NUM_RUNS successful $BRANCH runs of workflow $WORKFLOW"
mapfile -t RUN_IDS < <(
  gh run list --repo "$REPO" --workflow="$WORKFLOW" --branch="$BRANCH" \
    --status=success --limit "$NUM_RUNS" --json databaseId --jq '.[].databaseId'
)

if [[ ${#RUN_IDS[@]} -eq 0 ]]; then
  echo "no successful runs found" >&2
  exit 1
fi

echo "→ collecting step-level timing for ${#RUN_IDS[@]} runs"
for rid in "${RUN_IDS[@]}"; do
  out="$OUTPUT_DIR/steps-${rid}.json"
  if [[ -s "$out" ]]; then
    continue
  fi
  gh api "repos/$REPO/actions/runs/${rid}/jobs?per_page=100" \
    --jq '[.jobs[] | select(.name | contains("e2e-shard")) | {name, run_attempt, steps: [.steps[] | select(.name | startswith("Run E2E tests")) | {name, started_at, completed_at}]}]' \
    > "$out"
done

echo "→ aggregating"
python3 - "$OUTPUT_DIR" "${RUN_IDS[@]}" <<'PY'
import json, statistics as S, sys
from datetime import datetime
from pathlib import Path

base = Path(sys.argv[1])
ids = sys.argv[2:]

def parse(s): return datetime.strptime(s.replace("Z", ""), "%Y-%m-%dT%H:%M:%S")

clean, retried = [], []
for rid in ids:
    f = base / f"steps-{rid}.json"
    if not f.exists(): continue
    data = json.loads(f.read_text())
    if any(j.get("run_attempt", 1) == 2 for j in data):
        retried.append(rid); continue
    row = {"run_id": rid}
    for job in data:
        if job.get("run_attempt", 1) != 1: continue
        steps = job.get("steps") or []
        if not steps: continue
        s = steps[0]
        row[job["name"]] = int((parse(s["completed_at"]) - parse(s["started_at"])).total_seconds())
    clean.append(row)

per_shard = {f"e2e-shard ({i})": [] for i in range(1, 7)}
for row in clean:
    for i in range(1, 7):
        v = row.get(f"e2e-shard ({i})")
        if v is not None:
            per_shard[f"e2e-shard ({i})"].append(v)

stats = {}
for name, vals in per_shard.items():
    if not vals: continue
    n = len(vals)
    stats[name] = {
        "n": n, "min": min(vals), "max": max(vals), "range": max(vals) - min(vals),
        "avg": round(S.mean(vals), 1), "median": S.median(vals),
        "stdev": round(S.stdev(vals), 1) if n > 1 else 0,
    }

max_range = max((s["range"] for s in stats.values()), default=0)
decision = "B" if max_range > 15 else "A" if max_range < 5 else "C"

report = {
    "generated_at": datetime.utcnow().isoformat() + "Z",
    "N_total": len(ids), "N_clean": len(clean), "N_retried": len(retried),
    "retry_rate_pct": round(len(retried) / max(len(ids), 1) * 100, 1),
    "per_shard_stats": stats,
    "max_range_s": max_range,
    "rfc_v2_decision_candidate": f"Option {decision}",
    "clean_runs": clean,
    "retried_runs": retried,
}
out = base / "phase2-2-variance.json"
out.write_text(json.dumps(report, indent=2))
print(f"clean={len(clean)} retried={len(retried)} max_range={max_range}s => Option {decision}")
print(f"saved: {out}")
PY
