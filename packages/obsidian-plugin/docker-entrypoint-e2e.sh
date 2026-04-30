#!/bin/bash
# docker-entrypoint-e2e.sh
# Runs E2E tests via xvfb-run with parametrized Xvfb config (XVFB_VARIANT).
#
# Variants (RFC Phase 3.5 ADR — packages/obsidian-plugin/docs/phase3/ADR_FLAKY_X11_STRATEGY.md):
#   v1+v2     (default) — T5.1 V1 (-extension MIT-SHM) + V2 (lean 720p+dpi). Closes Cat I X11 SHM
#                         contention at protocol layer; reduces framebuffer payload by 30%.
#   baseline           — Status-quo Xvfb args (rollback). Set XVFB_VARIANT=baseline to revert.
#   per-spec           — Rung 1 fallback (T5.2 V2). Stub; activated by escalation task if v1+v2 misses DoD.
#   xpra               — Rung 2 fallback (T5.3 V1). Stub; activated only with xpra in image.
#   weston             — Rung 3 fallback (T5.3 V3). Stub; activated only with Weston in image.
#
# Future contributors: V2 lean dimensions (1280x720) align with Playwright viewport.
# Adding pixel-level mouse.click({x,y}) interactions in tests/e2e/specs/** that rely on a
# >720px-tall framebuffer will silently misbehave under v1+v2. Use baseline variant or
# adjust spec to viewport-relative coordinates.

set -e

# Set Docker flag for Electron --no-sandbox
export DOCKER=1
export CI=1
export DEBUG=pw:browser*
export ELECTRON_ENABLE_LOGGING=0

XVFB_VARIANT="${XVFB_VARIANT:-v1+v2}"

echo "========================================" >&2
echo "OBSIDIAN_PATH: $OBSIDIAN_PATH" >&2
echo "OBSIDIAN_VAULT: $OBSIDIAN_VAULT" >&2
echo "XVFB_VARIANT:  $XVFB_VARIANT" >&2
echo "Command: $@" >&2
echo "========================================" >&2

# Filter pattern for harmless Chrome/dbus stderr noise.
NOISE_FILTER='(LaunchProcess: failed to execvp:|ERROR:dbus/bus.cc:|ERROR:dbus/object_proxy.cc:|WARNING:ui/gfx/linux/gpu_memory_buffer_support_x11.cc:|WARNING:device/bluetooth/dbus/bluez_dbus_manager.cc:|WARNING:electron/shell/browser/ui/accelerator_util.cc:|xdg-settings)'

case "$XVFB_VARIANT" in
  v1+v2)
    # Primary mitigation per ADR §2:
    #  -extension MIT-SHM : disables X11 shared-memory extension → eliminates SHM allocator
    #                       contention root cause of Category I (X11 Shm::PutImageRequest).
    #  -screen 0 1280x720x24 : matches Playwright viewport; reduces framebuffer 3.93MB→2.76MB.
    #  -dpi 96            : pins layout deterministic across jammy kernel variants.
    #  -nolisten tcp      : preserves existing security default.
    echo "Launching with xvfb-run (v1+v2: -extension MIT-SHM + lean 720p)..." >&2
    xvfb-run --auto-servernum \
      --server-args="-screen 0 1280x720x24 -dpi 96 -extension MIT-SHM -nolisten tcp" \
      "$@" 2>&1 | grep -v -E "$NOISE_FILTER"
    exit ${PIPESTATUS[0]}
    ;;
  baseline)
    # Status-quo Xvfb args (pre-Phase-3.5). Use only for rollback or A/B measurement.
    echo "Launching with xvfb-run (baseline: status quo)..." >&2
    xvfb-run --auto-servernum "$@" 2>&1 | grep -v -E "$NOISE_FILTER"
    exit ${PIPESTATUS[0]}
    ;;
  per-spec|xpra|weston)
    echo "ERROR: XVFB_VARIANT=$XVFB_VARIANT is a fallback-ladder stub (see ADR §4)." >&2
    echo "Activate via dedicated escalation task; do not enable until T6.1 N=50 of v1+v2 misses DoD." >&2
    exit 2
    ;;
  *)
    echo "ERROR: Unknown XVFB_VARIANT='$XVFB_VARIANT'." >&2
    echo "Valid: v1+v2 (default) | baseline | per-spec | xpra | weston" >&2
    exit 2
    ;;
esac
