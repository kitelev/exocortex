#!/usr/bin/env python3
"""Aggregate flaky-reporter.json artifacts across CI runs.

Reads raw artifact zips from <raw_dir>/run-<id>/<artifact>.zip,
extracts the inner JSON, and produces:
  - aggregate.json (per-run + per-shard rollup)
  - summary.json (top-line stats)
  - top-offenders.json (per-spec rerun rate, top-N)

Usage:
  aggregate.py <raw_dir> <output_prefix>
"""
import json
import sys
import zipfile
from collections import Counter, defaultdict
from pathlib import Path


def load_artifact(zip_path: Path):
    try:
        with zipfile.ZipFile(zip_path) as zf:
            for name in zf.namelist():
                if name.endswith(".json"):
                    return json.loads(zf.read(name))
    except (zipfile.BadZipFile, json.JSONDecodeError):
        return None
    return None


def main():
    raw_dir = Path(sys.argv[1])
    out_prefix = Path(sys.argv[2])

    runs = []
    flaky_test_counter = Counter()
    flaky_test_files = defaultdict(set)
    artifact_counts = Counter()

    for run_dir in sorted(raw_dir.iterdir()):
        if not run_dir.is_dir():
            continue
        meta_path = run_dir / "_meta.json"
        if not meta_path.exists():
            continue
        meta = json.loads(meta_path.read_text())

        run_summary = {
            "id": meta["id"],
            "branch": meta.get("head_branch"),
            "event": meta.get("event"),
            "conclusion": meta.get("conclusion"),
            "created_at": meta.get("created_at"),
            "shards": {},
            "totalFlaky": 0,
            "totalTests": 0,
            "missingArtifacts": [],
        }

        expected = [
            "flaky-report-shard-1", "flaky-report-shard-2", "flaky-report-shard-3",
            "flaky-report-shard-4", "flaky-report-shard-5", "flaky-report-shard-6",
            "flaky-test-report-unit", "flaky-test-report-component",
        ]
        for art_name in expected:
            zp = run_dir / f"{art_name}.zip"
            if not zp.exists():
                run_summary["missingArtifacts"].append(art_name)
                continue
            artifact_counts[art_name] += 1
            data = load_artifact(zp)
            if data is None:
                run_summary["missingArtifacts"].append(f"{art_name}:corrupt")
                continue
            shard_summary = {
                "totalFlaky": data.get("totalFlaky", 0),
                "totalTests": data.get("summary", {}).get("totalTests", 0),
                "flakyPercentage": data.get("summary", {}).get("flakyPercentage", 0),
            }
            run_summary["shards"][art_name] = shard_summary
            run_summary["totalFlaky"] += shard_summary["totalFlaky"]
            run_summary["totalTests"] += shard_summary["totalTests"]
            for t in data.get("tests", []):
                key = t.get("title", "<unknown>")
                file_short = (t.get("file") or "").split("/")[-1]
                flaky_test_counter[(file_short, key)] += t.get("retryCount", 1)
                flaky_test_files[(file_short, key)].add(meta["id"])

        runs.append(run_summary)

    total_runs = len(runs)
    runs_failed = sum(1 for r in runs if r["conclusion"] == "failure")
    runs_success = sum(1 for r in runs if r["conclusion"] == "success")
    runs_cancelled = sum(1 for r in runs if r["conclusion"] == "cancelled")
    total_flaky = sum(r["totalFlaky"] for r in runs)
    total_tests = sum(r["totalTests"] for r in runs)
    success_rate = runs_success / total_runs * 100 if total_runs else 0
    failure_rate = runs_failed / total_runs * 100 if total_runs else 0

    # Per-event breakdown
    by_event = defaultdict(lambda: {"total": 0, "success": 0, "failure": 0, "cancelled": 0})
    for r in runs:
        e = r.get("event") or "unknown"
        by_event[e]["total"] += 1
        c = r.get("conclusion")
        if c in ("success", "failure", "cancelled"):
            by_event[e][c] += 1

    # Per-shard rollup
    per_shard = defaultdict(lambda: {"runs": 0, "totalFlaky": 0, "totalTests": 0})
    for r in runs:
        for shard_name, s in r["shards"].items():
            per_shard[shard_name]["runs"] += 1
            per_shard[shard_name]["totalFlaky"] += s["totalFlaky"]
            per_shard[shard_name]["totalTests"] += s["totalTests"]

    # Top offenders
    top_offenders = [
        {
            "file": f,
            "title": t,
            "totalRetries": cnt,
            "affectedRuns": len(flaky_test_files[(f, t)]),
        }
        for (f, t), cnt in flaky_test_counter.most_common(20)
    ]

    summary = {
        "cohort_dir": str(raw_dir),
        "total_runs_with_artifacts": total_runs,
        "runs_success": runs_success,
        "runs_failure": runs_failed,
        "runs_cancelled": runs_cancelled,
        "success_rate_pct": round(success_rate, 2),
        "failure_rate_pct": round(failure_rate, 2),
        "total_flaky_test_instances": total_flaky,
        "total_test_instances": total_tests,
        "flaky_per_run_avg": round(total_flaky / total_runs, 4) if total_runs else 0,
        "by_event": dict(by_event),
        "per_shard": dict(per_shard),
        "artifact_collection_counts": dict(artifact_counts),
        "top_flaky_specs": top_offenders[:10],
    }

    aggregate = {"summary": summary, "runs": runs}

    out_prefix.parent.mkdir(parents=True, exist_ok=True)
    Path(f"{out_prefix}-aggregate.json").write_text(json.dumps(aggregate, indent=2))
    Path(f"{out_prefix}-summary.json").write_text(json.dumps(summary, indent=2))
    Path(f"{out_prefix}-top-offenders.json").write_text(json.dumps(top_offenders, indent=2))

    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
