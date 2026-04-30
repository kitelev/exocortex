#!/bin/bash
# docker-entrypoint-e2e.sh
# Runs E2E tests with xvfb-run --auto-servernum (recommended by Playwright team)
#
# Cold-start telemetry (RFC 32a64ed9 §3.1, Phase 3.1):
# Emits two timing records to $COLD_START_TELEMETRY_LOG (JSONL) when set:
#   - container_start: entrypoint invoked → just-before xvfb-run
#   - xvfb_ready:      xvfb-run spawned → user command exits
# Schema documented in tests/e2e/utils/coldStartTelemetry.ts.

set -e

# Set Docker flag for Electron --no-sandbox
export DOCKER=1
export CI=1
export DEBUG=pw:browser*
export ELECTRON_ENABLE_LOGGING=0

# --- Cold-start telemetry: capture entrypoint start time ---
_cs_entrypoint_start_ns=$(date +%s%N)

_cs_emit() {
  # $1=step, $2=ms, $3=context (default: shell)
  local step="$1"
  local ms="$2"
  local ctx="${3:-shell}"
  local shard="${E2E_SHARD_ID:-unknown}"
  local spec="${E2E_SPEC_NAME:-entrypoint}"
  echo "[COLD_START_TELEMETRY] step=${step} ms=${ms} spec=${spec} shard=${shard} context=${ctx}" >&2
  if [ -n "${COLD_START_TELEMETRY_LOG:-}" ]; then
    mkdir -p "$(dirname "$COLD_START_TELEMETRY_LOG")" 2>/dev/null || true
    local ts_ms=$(($(date +%s%N)/1000000))
    printf '{"ts":%s,"step":"%s","ms":%s,"spec":"%s","shard":"%s","context":"%s"}\n' \
      "$ts_ms" "$step" "$ms" "$spec" "$shard" "$ctx" \
      >> "$COLD_START_TELEMETRY_LOG" 2>/dev/null || true
  fi
}

echo "========================================" >&2
echo "OBSIDIAN_PATH: $OBSIDIAN_PATH" >&2
echo "OBSIDIAN_VAULT: $OBSIDIAN_VAULT" >&2
echo "Command: $@" >&2
echo "========================================" >&2

echo "Launching with xvfb-run --auto-servernum..." >&2

# Emit container_start step (time from script entry to xvfb-run dispatch).
_cs_pre_xvfb_ns=$(date +%s%N)
_cs_container_start_ms=$(( (_cs_pre_xvfb_ns - _cs_entrypoint_start_ns) / 1000000 ))
_cs_emit "container_start" "$_cs_container_start_ms"

# Use xvfb-run with --auto-servernum as recommended by Playwright team
# https://github.com/microsoft/playwright/issues/8198#issuecomment-986736585
# Filter out harmless Chrome/dbus errors that clutter logs (stderr only)
xvfb-run --auto-servernum "$@" 2>&1 | grep -v -E "(LaunchProcess: failed to execvp:|ERROR:dbus/bus.cc:|ERROR:dbus/object_proxy.cc:|WARNING:ui/gfx/linux/gpu_memory_buffer_support_x11.cc:|WARNING:device/bluetooth/dbus/bluez_dbus_manager.cc:|WARNING:electron/shell/browser/ui/accelerator_util.cc:|xdg-settings)"
_cs_exit=${PIPESTATUS[0]}

# Emit xvfb_ready step (time spent inside xvfb-run / user command).
_cs_post_xvfb_ns=$(date +%s%N)
_cs_xvfb_ready_ms=$(( (_cs_post_xvfb_ns - _cs_pre_xvfb_ns) / 1000000 ))
_cs_emit "xvfb_ready" "$_cs_xvfb_ready_ms"

exit $_cs_exit
