#!/bin/bash
set -e
RUNS_JSONL="$1"
OUT_DIR="$2"
mkdir -p "$OUT_DIR"
TOTAL=$(wc -l < "$RUNS_JSONL")
i=0
while IFS= read -r line; do
  i=$((i+1))
  RUN_ID=$(echo "$line" | python3 -c 'import sys,json;print(json.loads(sys.stdin.read())["id"])')
  RUN_DIR="$OUT_DIR/run-$RUN_ID"
  if [ -d "$RUN_DIR" ]; then continue; fi
  mkdir -p "$RUN_DIR"
  echo "$line" > "$RUN_DIR/_meta.json"
  # list artifacts for this run
  gh api "repos/kitelev/exocortex/actions/runs/$RUN_ID/artifacts" --jq '.artifacts[] | select(.name | startswith("flaky-")) | "\(.id) \(.name)"' 2>/dev/null | while read -r ART_ID ART_NAME; do
    [ -z "$ART_ID" ] && continue
    OUT_FILE="$RUN_DIR/${ART_NAME}.zip"
    [ -f "$OUT_FILE" ] && continue
    gh api -H "Accept: application/vnd.github+json" "repos/kitelev/exocortex/actions/artifacts/$ART_ID/zip" > "$OUT_FILE" 2>/dev/null || rm -f "$OUT_FILE"
  done
  echo "[$i/$TOTAL] run=$RUN_ID artifacts=$(ls $RUN_DIR/*.zip 2>/dev/null | wc -l | tr -d ' ')"
done < "$RUNS_JSONL"
