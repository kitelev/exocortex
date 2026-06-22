#!/usr/bin/env bash
#
# check-test-antipatterns.sh — ratchet guard against low-value test anti-patterns.
#
# Source: test-quality audit 2026-06-22, recommendation P4 ("guideline для
# ревью/линта — предотвращение рецидива"). The audit found two recurring
# zero-value assertion shapes in the test suite:
#
#   1. method-exists asserts — `expect(typeof x.foo).toBe("function")`.
#      TypeScript already turns a method rename into a compile error, so these
#      verify nothing. Test the method's BEHAVIOUR instead.
#
#   2. vacuous length asserts — `expect(arr.length).toBeGreaterThanOrEqual(0)`.
#      Always true for any array length; asserts nothing. Assert the real
#      expected length/shape, or drop the assertion.
#
# Discriminator (audit §3 "Ключевой дискриминатор"): pinning an exact value is
# fine when the value IS a user-facing contract, brittle when it's an internal
# choice. The two shapes above are pure coverage filler — that is what this
# guard targets. We intentionally do NOT ban standalone `typeof x === "function"`
# in control flow (if-conditions, .map callbacks), only the `.toBe("function")`
# assertion form.
#
#   3. dual-dir drift — NEW core service tests landing in the legacy
#      `packages/core/tests/services/` directory. The audit (§2 LOW) flagged
#      that `tests/services/` (24 grandfathered files) and `tests/unit/services/`
#      coexist, making "where does a new test go?" ambiguous. CANON for NEW
#      core service tests is `packages/core/tests/unit/services/`. The legacy
#      24 files are intentionally NOT moved (zero churn — Andrey's call); this
#      ratchet only prevents the legacy dir from GROWING. A new test added there
#      fails the guard with a pointer to the canon dir.
#
# Mechanism: count current occurrences across all test files and FAIL if the
# count exceeds the committed baseline. This bans NEW occurrences (recidivism)
# while grandfathering the existing debt. As the debt is cleaned, ratchet the
# baselines DOWN (re-run with --update-baseline and commit the new numbers).
# A justified new use requires bumping the baseline UP with a PR comment.
#
# Usage:
#   bash scripts/check-test-antipatterns.sh                 # CI gate
#   bash scripts/check-test-antipatterns.sh --update-baseline  # print current counts

set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# --- Baselines (grandfathered existing occurrences). Ratchet DOWN as cleaned. ---
BASELINE_METHOD_EXISTS=55
BASELINE_VACUOUS_LENGTH=22
# Legacy non-canon core service-test dir. Canon for NEW tests is
# packages/core/tests/unit/services/. This grandfathers the existing files and
# bans growth (see header item 3). Ratchet DOWN if legacy files are removed.
BASELINE_NONCANON_SERVICE_DIR=24

# --- Patterns (must match the grep used to compute the baselines above). ---
ME_PATTERN="\.toBe\((\"|')function(\"|')\)"
VL_PATTERN="toBeGreaterThanOrEqual\(0\)"

# Canon-dir guideline: count .test.ts files in the legacy non-canon dir.
NONCANON_SERVICE_DIR="packages/core/tests/services"

count() {
  # Line count of matches across all test files. grep exits 1 on no match;
  # the trailing `| wc -l` makes the pipeline's exit status wc's (0), and we
  # avoid `set -e`/pipefail so a zero count never aborts the script.
  grep -rnE "$1" packages --include='*.test.ts' --include='*.test.tsx' 2>/dev/null | wc -l | tr -d ' '
}

list_files() {
  grep -rlE "$1" packages --include='*.test.ts' --include='*.test.tsx' 2>/dev/null | sed 's/^/     /'
}

ME_COUNT="$(count "$ME_PATTERN")"
VL_COUNT="$(count "$VL_PATTERN")"
# Top-level .test.ts files in the legacy non-canon service dir (flat dir).
NONCANON_COUNT="$(find "$NONCANON_SERVICE_DIR" -maxdepth 1 -name '*.test.ts' 2>/dev/null | wc -l | tr -d ' ')"

if [ "${1:-}" = "--update-baseline" ]; then
  echo "Current counts (paste into this script's BASELINE_* values):"
  echo "  BASELINE_METHOD_EXISTS=$ME_COUNT"
  echo "  BASELINE_VACUOUS_LENGTH=$VL_COUNT"
  echo "  BASELINE_NONCANON_SERVICE_DIR=$NONCANON_COUNT"
  exit 0
fi

fail=0

if [ "$ME_COUNT" -gt "$BASELINE_METHOD_EXISTS" ]; then
  echo "❌ method-exists asserts increased: $ME_COUNT > baseline $BASELINE_METHOD_EXISTS"
  echo "   A new \`expect(typeof x).toBe(\"function\")\` assert was added. It verifies"
  echo "   nothing TypeScript doesn't already (a method rename is a compile error)."
  echo "   Test the method's BEHAVIOUR instead, or remove the assert."
  echo "   Files with this pattern:"
  list_files "$ME_PATTERN"
  fail=1
fi

if [ "$VL_COUNT" -gt "$BASELINE_VACUOUS_LENGTH" ]; then
  echo "❌ vacuous length asserts increased: $VL_COUNT > baseline $BASELINE_VACUOUS_LENGTH"
  echo "   A new \`expect(x.length).toBeGreaterThanOrEqual(0)\` assert was added — it is"
  echo "   always true and verifies nothing. Assert the real length/shape, or drop it."
  echo "   Files with this pattern:"
  list_files "$VL_PATTERN"
  fail=1
fi

if [ "$NONCANON_COUNT" -gt "$BASELINE_NONCANON_SERVICE_DIR" ]; then
  echo "❌ legacy non-canon service-test dir grew: $NONCANON_COUNT > baseline $BASELINE_NONCANON_SERVICE_DIR"
  echo "   A new test was added to $NONCANON_SERVICE_DIR/ — the canon location for"
  echo "   NEW core service tests is packages/core/tests/unit/services/. Move the new"
  echo "   file there. The existing $BASELINE_NONCANON_SERVICE_DIR legacy files are grandfathered (not moved)."
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "✅ test anti-pattern guard OK — method-exists=$ME_COUNT/$BASELINE_METHOD_EXISTS, vacuous-length=$VL_COUNT/$BASELINE_VACUOUS_LENGTH, non-canon-service-dir=$NONCANON_COUNT/$BASELINE_NONCANON_SERVICE_DIR (no recurrence)"
fi

# Non-fatal nudge: when counts drop, the baseline should be ratcheted down so the
# guard keeps its teeth.
if [ "$ME_COUNT" -lt "$BASELINE_METHOD_EXISTS" ]; then
  echo "ℹ️  method-exists dropped to $ME_COUNT (baseline $BASELINE_METHOD_EXISTS) — ratchet BASELINE_METHOD_EXISTS down via --update-baseline."
fi
if [ "$VL_COUNT" -lt "$BASELINE_VACUOUS_LENGTH" ]; then
  echo "ℹ️  vacuous-length dropped to $VL_COUNT (baseline $BASELINE_VACUOUS_LENGTH) — ratchet BASELINE_VACUOUS_LENGTH down via --update-baseline."
fi
if [ "$NONCANON_COUNT" -lt "$BASELINE_NONCANON_SERVICE_DIR" ]; then
  echo "ℹ️  non-canon service-dir dropped to $NONCANON_COUNT (baseline $BASELINE_NONCANON_SERVICE_DIR) — ratchet BASELINE_NONCANON_SERVICE_DIR down via --update-baseline."
fi

exit $fail
