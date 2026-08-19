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
#   4. over-mock pass-through service-wrappers — a test file that wholesale-mocks
#      a CENTRAL internal collaborator (`@kitelev/exocortex-core`/`-services`, or
#      a relative mock of `/services/`, `/adapters/`, `/infrastructure/`,
#      `VaultRDFIndexer`) AND asserts ONLY delegation (`toHaveBeenCalled*`) with
#      ZERO output-value assertions in the whole file. Such a test verifies the
#      service forwarded a call but NEVER exercises the real behaviour — exactly
#      the shape the audit's Testing-Trophy shift targets (P2 + P3). The
#      canonical example (`SPARQLQueryService.test.ts`) was DELETED and lifted to
#      `SPARQLQueryService.integration.test.ts` (real engine stack, faking only
#      the Obsidian boundary), so the current baseline is 0 — there are no pure
#      pass-through over-mock files today. This ratchet bans INTRODUCING a new
#      one: a new plugin service-wrapper test must drive a real collaborator
#      (lift to `*.integration.test.ts`) instead of mocking it and asserting
#      delegation. See TESTING.md §"Lift over-mock service-wrappers to integration".
#      Like the method-exists guard the detection is heuristic (FP-tolerant): the
#      file-level "no output-value assertion anywhere" filter is narrow (almost
#      every real test asserts an output), and a justified exception bumps the
#      baseline UP with a PR comment (the same escape hatch as the other ratchets).
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
#
# Testability (the @req binding test drives the guard against a fixture tree):
#   ANTIPATTERN_SCAN_DIR    — test-corpus root to scan (default: packages)
#   ANTIPATTERN_NONCANON_DIR— legacy non-canon service dir (default: packages/core/tests/services)
#   BASELINE_METHOD_EXISTS / BASELINE_VACUOUS_LENGTH /
#   BASELINE_NONCANON_SERVICE_DIR / BASELINE_OVERMOCK — override the committed
#   baselines (used by the guard's own revert-verify test, never in CI).

set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# --- Baselines (grandfathered existing occurrences). Ratchet DOWN as cleaned. ---
# Env-overridable so the guard's own @req binding test can force a RED/GREEN
# verdict against a fixture corpus without touching the real tree (the defaults
# are the committed baselines used in CI).
BASELINE_METHOD_EXISTS="${BASELINE_METHOD_EXISTS:-55}"
BASELINE_VACUOUS_LENGTH="${BASELINE_VACUOUS_LENGTH:-21}"
# Legacy non-canon core service-test dir. Canon for NEW tests is
# packages/core/tests/unit/services/. This grandfathers the existing files and
# bans growth (see header item 3). Ratchet DOWN if legacy files are removed.
BASELINE_NONCANON_SERVICE_DIR="${BASELINE_NONCANON_SERVICE_DIR:-19}"
# Over-mock pass-through service-wrappers (header item 4). Baseline 0 — the
# canonical over-mock was lifted to an integration suite, so no pure pass-through
# over-mock file exists today. Bans introducing one.
BASELINE_OVERMOCK="${BASELINE_OVERMOCK:-0}"
# ⛤ POPULATION baseline — how many test files the counters above were computed OVER.
# Not a debt figure: it is the SIZE OF THE INPUT, and it is here because every counter
# in this guard is `grep … | wc -l`, so an empty or moved SCAN_DIR drives all four to 0
# and every `0 <= baseline` comparison passes. Measured 2026-08-19: 903 (901 before this change added two guard tests).
BASELINE_SCANNED="${BASELINE_SCANNED:-903}"

# Scan root (default: the whole monorepo packages tree). Overridable for the
# guard's revert-verify test (points at a fixture corpus).
SCAN_DIR="${ANTIPATTERN_SCAN_DIR:-packages}"

# --- Patterns (must match the grep used to compute the baselines above). ---
ME_PATTERN="\.toBe\((\"|')function(\"|')\)"
VL_PATTERN="toBeGreaterThanOrEqual\(0\)"

# over-mock detection patterns (header item 4):
#  - OM_MOCK: a wholesale jest.mock() of a CENTRAL internal collaborator. Matches
#    the core/services workspace packages and relative mocks into the
#    service/adapter/infrastructure layers (the central-collaborator surface),
#    NOT platform mocks like jest.mock("obsidian").
#  - OM_OUTPUT_ASSERT: any output-VALUE assertion. A file carrying one is NOT a
#    pure pass-through (it exercises real behaviour) → excluded.
OM_MOCK="jest\.mock\((\"|')[^\"']*(@kitelev/exocortex-(core|services)|/services/|/adapters/|/infrastructure/|VaultRDFIndexer)"
OM_OUTPUT_ASSERT="\.(toEqual|toStrictEqual|toMatchObject|toMatchSnapshot|toContain|toContainEqual|toHaveLength|toHaveProperty|toMatch|toThrow|toThrowError|toBeTruthy|toBeFalsy|toBeDefined|toBeNull|toBeNaN|toBeInstanceOf|toBeGreaterThan|toBeGreaterThanOrEqual|toBeLessThan|toBeLessThanOrEqual|toBeCloseTo)\(|\.toBe\(|resolves|rejects"

# Canon-dir guideline: count .test.ts files in the legacy non-canon dir.
NONCANON_SERVICE_DIR="${ANTIPATTERN_NONCANON_DIR:-packages/core/tests/services}"

count() {
  # Line count of matches across all test files. grep exits 1 on no match;
  # the trailing `| wc -l` makes the pipeline's exit status wc's (0), and we
  # avoid `set -e`/pipefail so a zero count never aborts the script.
  grep -rnE "$1" "$SCAN_DIR" --include='*.test.ts' --include='*.test.tsx' 2>/dev/null | wc -l | tr -d ' '
}

list_files() {
  grep -rlE "$1" "$SCAN_DIR" --include='*.test.ts' --include='*.test.tsx' 2>/dev/null | sed 's/^/     /'
}

# Count test files that are over-mock pass-through service-wrappers: wholesale
# mock a central collaborator AND assert delegation (toHaveBeenCalled) AND have
# NO output-value assertion anywhere in the file. Emits one path per match on
# stdout; callers `| wc -l` to count or read the list directly.
overmock_files() {
  grep -rlE "$OM_MOCK" "$SCAN_DIR" --include='*.test.ts' --include='*.test.tsx' 2>/dev/null |
    while IFS= read -r f; do
      [ -z "$f" ] && continue
      # Must assert delegation …
      grep -qE 'toHaveBeenCalled' "$f" || continue
      # … and carry NO output-value assertion (pure pass-through).
      grep -qE "$OM_OUTPUT_ASSERT" "$f" && continue
      echo "$f"
    done
}

ME_COUNT="$(count "$ME_PATTERN")"
VL_COUNT="$(count "$VL_PATTERN")"
# Top-level .test.ts files in the legacy non-canon service dir (flat dir).
NONCANON_COUNT="$(find "$NONCANON_SERVICE_DIR" -maxdepth 1 -name '*.test.ts' 2>/dev/null | wc -l | tr -d ' ')"
OVERMOCK_COUNT="$(overmock_files | sed '/^$/d' | wc -l | tr -d ' ')"
# Size of the corpus the four counters above were computed over.
SCANNED_COUNT="$(grep -rl . "$SCAN_DIR" --include='*.test.ts' --include='*.test.tsx' 2>/dev/null | wc -l | tr -d ' ')"

if [ "${1:-}" = "--update-baseline" ]; then
  echo "Current counts (paste into this script's BASELINE_* values):"
  echo "  BASELINE_METHOD_EXISTS=$ME_COUNT"
  echo "  BASELINE_VACUOUS_LENGTH=$VL_COUNT"
  echo "  BASELINE_NONCANON_SERVICE_DIR=$NONCANON_COUNT"
  echo "  BASELINE_OVERMOCK=$OVERMOCK_COUNT"
  echo "  BASELINE_SCANNED=$SCANNED_COUNT"
  exit 0
fi

fail=0

# ── POSITIVE proof that the run examined a corpus at all ──────────────────────────
#
# ⛔ Demonstrated 2026-08-19, and the reason this block exists: point the scan at an
# empty directory and the guard prints
#
#     ✅ test anti-pattern guard OK — method-exists=0/55, vacuous-length=0/21, …
#     ℹ️  method-exists dropped to 0 (baseline 55) — ratchet BASELINE_METHOD_EXISTS down…
#
# and exits 0. Two things are wrong at once: `0/55` READS AS AN ACHIEVEMENT ("we fixed
# everything") rather than as "the scan found nothing, so all four counters collapsed",
# and the guard then INVITES the operator to ratchet the baselines to 0 — after which it
# is green forever no matter how many anti-patterns are added. The failure arrives
# through the SUCCESS path, so no amount of care reading a red build would catch it.
#
# ⚠ ANTIPATTERN_NONCANON_DIR defaults to a path INSIDE a package
# (packages/core/tests/services), and this repo has already renamed a package
# (packages/exocortex -> packages/core, M5a). That rename would have zeroed that counter
# silently. This is not a hypothetical.
if [ "$SCANNED_COUNT" -eq 0 ]; then
  echo "❌ test anti-pattern guard: scanned 0 test files under '$SCAN_DIR'."
  echo "   All four counters are \`grep | wc -l\`, so they are 0 because NOTHING WAS"
  echo "   READ — not because the debt was paid. This run has no verdict to give."
  echo "   ⛔ Do NOT run --update-baseline: it would write 0/0/0/0 and the guard would"
  echo "   pass forever regardless of how many anti-patterns are introduced."
  echo "   Fix the scan root (ANTIPATTERN_SCAN_DIR / the SCAN_DIR default) instead."
  exit 1
fi

# Second layer: a PARTIAL collapse (scan finds a fraction of the corpus) drives the
# counters down proportionally and is invisible to the check above.
#
# ⛤ Unlike scripts/check-cli-types.mjs — where tsconfig `include` independently declares
# what the program must contain, so the floor is DERIVED and exact — nothing in this repo
# declares how many test files ought to exist. The previous measurement, committed above,
# is the only available reference, which is why this layer is a ratchet like the rest of
# the file rather than a derivation. Half is deliberately generous: it catches collapse,
# NOT drift. Drift stays visible because SCANNED_COUNT is printed on every run, pass or
# fail — a number nobody has an expected value for is the thing this whole guard is about.
SCANNED_FLOOR=$((BASELINE_SCANNED / 2))
if [ "$SCANNED_COUNT" -lt "$SCANNED_FLOOR" ]; then
  echo "❌ test anti-pattern guard: scanned $SCANNED_COUNT test file(s), less than half of"
  echo "   the $BASELINE_SCANNED recorded in BASELINE_SCANNED. The corpus collapsed rather"
  echo "   than the debt shrinking, so the four counters below mean nothing."
  echo "   If the shrink is legitimate, re-run with --update-baseline and commit the new"
  echo "   BASELINE_SCANNED together with the new counter baselines — deliberately, in one"
  echo "   reviewed act."
  exit 1
fi

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

if [ "$OVERMOCK_COUNT" -gt "$BASELINE_OVERMOCK" ]; then
  echo "❌ over-mock pass-through service-wrappers increased: $OVERMOCK_COUNT > baseline $BASELINE_OVERMOCK"
  echo "   A new test file wholesale-mocks a central collaborator"
  echo "   (@kitelev/exocortex-core/-services, or /services//adapters//infrastructure/,"
  echo "   VaultRDFIndexer) and asserts ONLY delegation (toHaveBeenCalled*) with no"
  echo "   output-value assertion — it verifies a call was forwarded but never"
  echo "   exercises real behaviour. Lift it to a *.integration.test.ts that drives"
  echo "   the real collaborator and faking only the Obsidian boundary (see"
  echo "   TESTING.md §\"Lift over-mock service-wrappers to integration\")."
  echo "   Files with this pattern:"
  overmock_files | sed 's/^/     /'
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  # ⛤ SCANNED is printed FIRST and on every run, ahead of the four ratios. Each ratio is
  # a fraction whose denominator is a committed number; the corpus size is the only
  # figure here with no expected value attached, which is exactly why it has to be shown
  # rather than inferred. "0/55" without it reads as success.
  echo "✅ test anti-pattern guard OK — scanned $SCANNED_COUNT test file(s) — method-exists=$ME_COUNT/$BASELINE_METHOD_EXISTS, vacuous-length=$VL_COUNT/$BASELINE_VACUOUS_LENGTH, non-canon-service-dir=$NONCANON_COUNT/$BASELINE_NONCANON_SERVICE_DIR, over-mock=$OVERMOCK_COUNT/$BASELINE_OVERMOCK (no recurrence)"
fi

# Non-fatal nudge: when counts drop, the baseline should be ratcheted down so the
# guard keeps its teeth.
#
# ⛤ Safe to say now, and it was NOT before: reaching this point means the corpus floors
# above passed, so a counter that dropped really did drop against a corpus that was
# really read. The same sentence printed after a collapsed scan was an invitation to
# write a 0 baseline and disarm the guard permanently.
if [ "$ME_COUNT" -lt "$BASELINE_METHOD_EXISTS" ]; then
  echo "ℹ️  method-exists dropped to $ME_COUNT (baseline $BASELINE_METHOD_EXISTS) — ratchet BASELINE_METHOD_EXISTS down via --update-baseline."
fi
if [ "$VL_COUNT" -lt "$BASELINE_VACUOUS_LENGTH" ]; then
  echo "ℹ️  vacuous-length dropped to $VL_COUNT (baseline $BASELINE_VACUOUS_LENGTH) — ratchet BASELINE_VACUOUS_LENGTH down via --update-baseline."
fi
if [ "$NONCANON_COUNT" -lt "$BASELINE_NONCANON_SERVICE_DIR" ]; then
  echo "ℹ️  non-canon service-dir dropped to $NONCANON_COUNT (baseline $BASELINE_NONCANON_SERVICE_DIR) — ratchet BASELINE_NONCANON_SERVICE_DIR down via --update-baseline."
fi
if [ "$OVERMOCK_COUNT" -lt "$BASELINE_OVERMOCK" ]; then
  echo "ℹ️  over-mock dropped to $OVERMOCK_COUNT (baseline $BASELINE_OVERMOCK) — ratchet BASELINE_OVERMOCK down via --update-baseline."
fi

exit $fail
