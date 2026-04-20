#!/usr/bin/env bash
# Phase 0 wall-time benchmark — subprocess (cold-start) path.
#
# Invokes the CLI once per (command × scenario) combination, recording
# wall-time for each invocation via `date +%s%N` bracketing. Matches the
# user-facing cost of running the CLI directly (NOT the Phase 1 jest-suite
# amortized cost — see benchmark.test.ts for that).
#
# Outputs: /tmp/phase0-benchmark-subprocess.json (array of measurements)
# and a human-readable table on stdout.
#
# Usage: STARTER_KIT_PATH=/path/to/starter-kit CLI_DIST=/path/to/dist/index.js \
#        bash scripts/phase0-benchmark-subprocess.sh
#
# Bug #2883 workaround: CLI normalizes --target as vault-relative path; positive
# ASK preconditions never bind $target → met scenarios report precondition-fail.
# Timings are still meaningful (cold-start + full pipeline up to the ASK),
# but subprocess success-rates must be interpreted with that caveat.

set -u -o pipefail

STARTER_KIT_PATH="${STARTER_KIT_PATH:-../exocortex-starter-kit}"
CLI_DIST="${CLI_DIST:-packages/cli/dist/index.js}"
OUT_PATH="${PHASE0_BENCHMARK_SUBPROCESS_OUT:-/tmp/phase0-benchmark-subprocess.json}"
VAULT_PATH="$(mktemp -d)/phase0-bench-vault"

if [[ ! -d "$STARTER_KIT_PATH/exocmd" ]]; then
  echo "starter-kit not found at $STARTER_KIT_PATH — skipping subprocess benchmark" >&2
  echo '[]' > "$OUT_PATH"
  exit 0
fi

if [[ ! -f "$CLI_DIST" ]]; then
  echo "CLI dist bundle not found at $CLI_DIST — skipping subprocess benchmark" >&2
  echo '[]' > "$OUT_PATH"
  exit 0
fi

mkdir -p "$VAULT_PATH"
cp -R "$STARTER_KIT_PATH"/* "$VAULT_PATH"/

ASSETS_DIR="$VAULT_PATH/phase0-benchmark-assets"
mkdir -p "$ASSETS_DIR"

write_asset() {
  local uid="$1"
  local scenario="$2"
  local class_line="$3"
  local status_line="$4"
  local path="$ASSETS_DIR/$uid.$scenario.md"
  if [[ "$scenario" == "edge" ]]; then
    cat > "$path" <<EOF
---
exo__Asset_uid: edge-$uid
exo__Instance_class:
  - "[[ems__Task]]"

(missing closing ---, broken YAML)
EOF
    return
  fi
  {
    echo "---"
    echo "exo__Asset_uid: $uid-$scenario"
    echo "exo__Asset_label: \"Phase 0 benchmark fixture $uid\""
    echo "exo__Asset_createdAt: \"2026-04-20T12:00:00+0500\""
    echo "exo__Asset_updatedAt: \"2026-04-20T12:00:00+0500\""
    echo "exo__Instance_class:"
    echo "  - \"[[$class_line]]\""
    [[ -n "$status_line" ]] && echo "ems__Effort_status: \"$status_line\""
    echo "aliases:"
    echo "  - \"Phase 0 benchmark fixture\""
    echo "---"
  } > "$path"
}

# Pilot commands — same as benchmark.test.ts PILOT_COMMANDS.
write_asset "e941b3bb-d375-40d2-b271-e1d71deb014c" "met" "ems__Task" "[[ems__EffortStatusBacklog]]"
write_asset "e941b3bb-d375-40d2-b271-e1d71deb014c" "unmet" "ems__Task" "[[ems__EffortStatusDoing]]"
write_asset "e941b3bb-d375-40d2-b271-e1d71deb014c" "edge" "ems__Task" ""
write_asset "a3966e53-b819-42c9-aab2-ebd5512cf566" "met" "ems__Project" ""
write_asset "a3966e53-b819-42c9-aab2-ebd5512cf566" "unmet" "ems__Task" ""
write_asset "a3966e53-b819-42c9-aab2-ebd5512cf566" "edge" "ems__Task" ""
write_asset "2adf3655-0ab9-4578-ad2e-223108729db8" "met" "ems__Project" ""
write_asset "2adf3655-0ab9-4578-ad2e-223108729db8" "unmet" "ems__Project" ""
write_asset "2adf3655-0ab9-4578-ad2e-223108729db8" "edge" "ems__Task" ""
write_asset "6bc86da6-4e58-4441-bc9b-20d2097451df" "met" "ems__Task" "[[ems__EffortStatusBacklog]]"
write_asset "6bc86da6-4e58-4441-bc9b-20d2097451df" "unmet" "ems__Task" "[[ems__EffortStatusBacklog]]"
write_asset "6bc86da6-4e58-4441-bc9b-20d2097451df" "edge" "ems__Task" ""
write_asset "923520d1-1892-4a6c-88ea-9552250a7cbe" "met" "ems__Task" "[[ems__EffortStatusDoing]]"
write_asset "923520d1-1892-4a6c-88ea-9552250a7cbe" "unmet" "ems__Task" "[[ems__EffortStatusDone]]"
write_asset "923520d1-1892-4a6c-88ea-9552250a7cbe" "edge" "ems__Task" ""

declare -a PILOT_UIDS=(
  "e941b3bb-d375-40d2-b271-e1d71deb014c|Set Status Doing"
  "a3966e53-b819-42c9-aab2-ebd5512cf566|Convert to Task"
  "2adf3655-0ab9-4578-ad2e-223108729db8|Create Child Task"
  "6bc86da6-4e58-4441-bc9b-20d2097451df|Set Planned Start"
  "923520d1-1892-4a6c-88ea-9552250a7cbe|Set Status Done"
)

declare -a RESULTS=()

ms_now() {
  if command -v gdate >/dev/null 2>&1; then
    gdate +%s%N
  else
    date +%s%N
  fi
}

for entry in "${PILOT_UIDS[@]}"; do
  uid="${entry%%|*}"
  label="${entry#*|}"
  for scenario in met unmet edge; do
    asset_rel="phase0-benchmark-assets/$uid.$scenario.md"
    input_flag=""
    case "$uid" in
      "2adf3655-0ab9-4578-ad2e-223108729db8")
        input_flag='--input {"label":"Phase0 child","value":"Phase0 child"}'
        ;;
      "6bc86da6-4e58-4441-bc9b-20d2097451df")
        input_flag='--input {"value":"2026-04-20"}'
        ;;
    esac

    start_ns="$(ms_now)"
    # shellcheck disable=SC2086
    node "$CLI_DIST" dyncommand exec "$uid" \
      --vault "$VAULT_PATH" \
      --target "$asset_rel" \
      --dry-run \
      $input_flag \
      >/dev/null 2>&1 || true
    end_ns="$(ms_now)"

    wall_ms=$(( (end_ns - start_ns) / 1000000 ))
    RESULTS+=("{\"commandUid\":\"$uid\",\"commandLabel\":\"$label\",\"scenario\":\"$scenario\",\"wallTimeMs\":$wall_ms}")
    printf "%-9s  %-20s  scenario=%-5s  %5d ms\n" "${uid:0:8}" "$label" "$scenario" "$wall_ms"
  done
done

# Emit JSON (manual join — avoids jq dependency).
{
  printf "[\n"
  for i in "${!RESULTS[@]}"; do
    printf "  %s" "${RESULTS[$i]}"
    if (( i < ${#RESULTS[@]} - 1 )); then printf ","; fi
    printf "\n"
  done
  printf "]\n"
} > "$OUT_PATH"

total=0
for entry in "${RESULTS[@]}"; do
  ms=$(echo "$entry" | sed -E 's/.*"wallTimeMs":([0-9]+).*/\1/')
  total=$(( total + ms ))
done
count=${#RESULTS[@]}
avg=$(( total / (count > 0 ? count : 1) ))

echo "---"
echo "subprocess total: ${total} ms across ${count} invocations (avg ${avg} ms/invocation)"
echo "subprocess report → $OUT_PATH"

rm -rf "$VAULT_PATH"
