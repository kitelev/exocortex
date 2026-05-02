#!/usr/bin/env bash
# lunch-tracker.sh — production cron entry that materializes a fresh `Lunch`
# instance every day at 13:00 from a vault prototype, using the generic
# `create_instance` grounding. See README.md (this directory) for setup and
# RFC 94e520da § Phase 5 for context.
#
# Cron line:
#   0 13 * * * /opt/exocortex/lunch-tracker.sh >> /var/log/exocortex-lunch.log 2>&1
#
# Exit codes:
#   0  — success (fresh Lunch instance created, or already existed and was idempotent)
#   1  — CLI invocation failed (precondition unsatisfied, command not found, etc.)
#   2  — environment misconfiguration (VAULT missing, daily note missing)

set -euo pipefail

# ---------- Required environment ----------
: "${VAULT:?VAULT must point to the Obsidian vault root (e.g. /home/user/vault)}"
: "${CREATE_INSTANCE_CMD:?CREATE_INSTANCE_CMD must be the UID of the Create Instance dyncommand (find via 'dyncommand list')}"

# ---------- Optional knobs ----------
CLI_PACKAGE="${CLI_PACKAGE:-@kitelev/exocortex-cli}"
DAILY_DIR="${DAILY_DIR:-daily}"
LABEL_PREFIX="${LABEL_PREFIX:-Lunch}"
TODAY="$(date +%Y-%m-%d)"
DAILY="${DAILY_DIR}/${TODAY}.md"

if [[ ! -f "${VAULT}/${DAILY}" ]]; then
  echo "[lunch-tracker] daily note ${DAILY} missing in vault ${VAULT}" >&2
  exit 2
fi

# ---------- Invoke the dyncommand ----------
# `--output json` makes the result machine-parsable for log greppers.
# We intentionally do NOT use --dry-run; the cron is the production path.
exec npx --yes "${CLI_PACKAGE}" dyncommand exec "${CREATE_INSTANCE_CMD}" \
  --target "${DAILY}" \
  --input "{\"label\":\"${LABEL_PREFIX} — ${TODAY}\"}" \
  --vault "${VAULT}" \
  --output json
