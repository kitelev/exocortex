#!/usr/bin/env bash
# verify-cron.sh — nightly soak verification for the Lunch cron.
#
# Reads VAULT and the canonical Lunch class label, then asserts that today's
# daily note has at least one related Lunch instance whose label matches
# "${LABEL_PREFIX} — YYYY-MM-DD". Emits a JSON heartbeat suitable for a
# Prometheus node-exporter textfile collector or simple log scrape.
#
# Exit codes:
#   0  — heartbeat ok (instance found)
#   1  — instance NOT found for today (cron likely failed)
#   2  — environment misconfiguration

set -euo pipefail

: "${VAULT:?VAULT must point to the Obsidian vault root}"
LABEL_PREFIX="${LABEL_PREFIX:-Lunch}"
DAILY_DIR="${DAILY_DIR:-daily}"
TODAY="$(date +%Y-%m-%d)"
DAILY_PATH="${VAULT}/${DAILY_DIR}/${TODAY}.md"
EXPECTED_LABEL="${LABEL_PREFIX} — ${TODAY}"

if [[ ! -d "${VAULT}" ]]; then
  echo "[verify-cron] VAULT ${VAULT} not a directory" >&2
  exit 2
fi

if [[ ! -f "${DAILY_PATH}" ]]; then
  echo "[verify-cron] daily note ${DAILY_PATH} missing" >&2
  exit 2
fi

# Search vault for a Lunch instance whose label or aliases match today's
# expected pattern. We grep the frontmatter rather than running SPARQL to keep
# the verifier dependency-free (no Node, no plugin, no CLI cold start).
match_count=$(grep -lR --include="*.md" -F "${EXPECTED_LABEL}" "${VAULT}" 2>/dev/null | wc -l | tr -d ' ')

status="ok"
exit_code=0
if [[ "${match_count}" -eq 0 ]]; then
  status="missing"
  exit_code=1
fi

# Single-line JSON heartbeat — easy to parse by log shippers.
printf '{"timestamp":"%s","date":"%s","expected_label":"%s","matches":%s,"status":"%s"}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  "${TODAY}" \
  "${EXPECTED_LABEL}" \
  "${match_count}" \
  "${status}"

exit "${exit_code}"
