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
# ⛤ The four per-category TOTALS are DERIVED from the pair-set baseline below, not
# declared here. They exist only for the human-readable summary line; the verdict comes
# from the pairs. Two sources for one number is how a total and its set drift apart.
# (Env overrides were removed with them: a fixture drives the guard via
# ANTIPATTERN_BASELINE_FILE, which sets both the pairs and the totals at once.)
# ⛤ POPULATION baseline — how many test files the counters above were computed OVER.
# Not a debt figure: it is the SIZE OF THE INPUT, and it is here because every counter
# in this guard is `grep … | wc -l`, so an empty or moved SCAN_DIR drives all four to 0
# and every `0 <= baseline` comparison passes. Measured 2026-08-19: 904. ⛤ Only reachable when git cannot answer (a fixture corpus
# outside the repo); inside the repo the DERIVED comparison below supersedes it.
BASELINE_SCANNED="${BASELINE_SCANNED:-904}"

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

# ── (category, file, count) PAIR SET ──────────────────────────────────────────────
#
# ⛔ A TOTAL is satisfied by a SWAP. `method-exists=55/55` is green whether those 55
# occurrences are the grandfathered ones or 54 old plus a brand-new one somebody just
# added — the ratchet cannot tell, because subtraction is commutative and the number is
# all it has. Both sibling ratchets in this repo (check-cli-types.mjs, check-test-types.mjs)
# key on a SET of (file, code) pairs for exactly this reason; this guard was the last one
# still comparing totals.
#
# The baseline is a TSV rather than JSON because this stays a bash guard: `join` over two
# sorted streams is POSIX, needs no parser, and diffs one line per moved occurrence in
# review. ⛔ bash 3.2 (macOS) has no associative arrays, so streams are the portable form.
# ⛔ LC_ALL=C on every sort: `join` requires both inputs collated identically, and the
# default collation differs between macOS and the ubuntu runner.
BASELINE_FILE="${ANTIPATTERN_BASELINE_FILE:-$ROOT/scripts/test-antipattern-baseline.tsv}"
TAB="$(printf '\t')"

# Emits "<file><TAB><count>" for one category, sorted. Files with zero matches are
# dropped: a file that no longer carries the pattern is absence, not a zero entry.
current_pairs() {
  case "$1" in
    method-exists)
      grep -rcE "$ME_PATTERN" "$SCAN_DIR" --include='*.test.ts' --include='*.test.tsx' 2>/dev/null \
        | grep -v ':0$' | tr ':' "$TAB" ;;
    vacuous-length)
      grep -rcE "$VL_PATTERN" "$SCAN_DIR" --include='*.test.ts' --include='*.test.tsx' 2>/dev/null \
        | grep -v ':0$' | tr ':' "$TAB" ;;
    non-canon-service-dir)
      find "$NONCANON_SERVICE_DIR" -maxdepth 1 -name '*.test.ts' 2>/dev/null | sed "s/\$/${TAB}1/" ;;
    over-mock)
      overmock_files | sed '/^$/d' | sed "s/\$/${TAB}1/" ;;
  esac | LC_ALL=C sort
}

baseline_pairs() {
  grep -v '^#' "$BASELINE_FILE" 2>/dev/null \
    | awk -F"$TAB" -v c="$1" '$1==c {print $2 "\t" $3}' | LC_ALL=C sort
}

# Pairs that are NEW or GREW: the only two states that mean debt was ADDED.
# `-a1` keeps files absent from the baseline; `-e 0` gives them a baseline count of 0,
# so a brand-new file is "grew from 0" and needs no separate branch.
grown_pairs() {
  join -t"$TAB" -a1 -e 0 -o 0,1.2,2.2 <(current_pairs "$1") <(baseline_pairs "$1") \
    | awk -F"$TAB" '$2 > $3 { printf "     %s  %s -> %s\n", $1, $3, $2 }'
}

# Pairs that shrank or disappeared — never fatal, but the baseline should follow so the
# guard keeps its teeth.
shrunk_pairs() {
  join -t"$TAB" -a2 -e 0 -o 0,1.2,2.2 <(current_pairs "$1") <(baseline_pairs "$1") \
    | awk -F"$TAB" '$2 < $3 { printf "     %s  %s -> %s\n", $1, $3, $2 }'
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

baseline_total() {
  grep -v '^#' "$BASELINE_FILE" 2>/dev/null | awk -F"$TAB" -v c="$1" '$1==c {s+=$3} END {print s+0}'
}
BASELINE_METHOD_EXISTS="$(baseline_total method-exists)"
BASELINE_VACUOUS_LENGTH="$(baseline_total vacuous-length)"
BASELINE_NONCANON_SERVICE_DIR="$(baseline_total non-canon-service-dir)"
BASELINE_OVERMOCK="$(baseline_total over-mock)"

ME_COUNT="$(count "$ME_PATTERN")"
VL_COUNT="$(count "$VL_PATTERN")"
# Top-level .test.ts files in the legacy non-canon service dir (flat dir).
NONCANON_COUNT="$(find "$NONCANON_SERVICE_DIR" -maxdepth 1 -name '*.test.ts' 2>/dev/null | wc -l | tr -d ' ')"
OVERMOCK_COUNT="$(overmock_files | sed '/^$/d' | wc -l | tr -d ' ')"
# Size of the corpus the four counters above were computed over.
SCANNED_COUNT="$(grep -rl . "$SCAN_DIR" --include='*.test.ts' --include='*.test.tsx' 2>/dev/null | wc -l | tr -d ' ')"

# ── POSITIVE proof that the run examined a corpus at all ──────────────────────────
#
# ⛔ Demonstrated 2026-08-19, and the reason this block exists: point the scan at an
# empty directory and the guard printed
#
#     ✅ test anti-pattern guard OK — method-exists=0/55, vacuous-length=0/21, …
#     ℹ️  method-exists dropped to 0 (baseline 55) — ratchet BASELINE_METHOD_EXISTS down…
#
# and exited 0. Two things are wrong at once: `0/55` READS AS AN ACHIEVEMENT ("we fixed
# everything") rather than as "the scan found nothing", and the guard then INVITES the
# operator to ratchet the baselines to 0 — after which it is green forever no matter how
# many anti-patterns are added. The failure arrives through the SUCCESS path.
#
# ⚠ ANTIPATTERN_NONCANON_DIR defaults to a path INSIDE a package
# (packages/core/tests/services), and this repo has already renamed a package
# (packages/exocortex -> packages/core, M5a). That rename would have zeroed that counter
# silently. This is not a hypothetical — and see the DERIVED floor below for why a
# proportional floor would not have caught a repeat of it either.
#
# ⛤ Placed ABOVE the --update-baseline branch deliberately: that branch used to run
# first, so an operator on a collapsed scan could still print (and commit) 0/0/0/0.
if [ "$SCANNED_COUNT" -eq 0 ]; then
  echo "❌ test anti-pattern guard: scanned 0 test files under '$SCAN_DIR'."
  echo "   All four counters are \`grep | wc -l\`, so they are 0 because NOTHING WAS"
  echo "   READ — not because the debt was paid. This run has no verdict to give."
  echo "   ⛔ Do NOT run --update-baseline: it would write 0/0/0/0 and the guard would"
  echo "   pass forever regardless of how many anti-patterns are introduced."
  echo "   Fix the scan root (ANTIPATTERN_SCAN_DIR / the SCAN_DIR default) instead."
  exit 1
fi

# Second layer: a PARTIAL collapse drives the counters down proportionally and is
# invisible to the check above.
#
# ⛤ DERIVED, not proportional. An earlier draft used BASELINE_SCANNED/2, and review
# measured what that accepts: with the corpus at core=375, obsidian-plugin=359, cli=160,
# req-audit=5, test-utils=3, services=1, a floor of 451 lets the loss of ANY SINGLE
# package pass silently — dropping packages/core leaves 528. That is a repeat of the very
# M5a rename cited above, un-caught, which made the proportional floor the same defect it
# was written to close, one notch narrower.
#
# git declares the TRACKED corpus while the counters grep the WORKING TREE — two
# different artefacts, so this is a derivation and not a self-check. Measured 2026-08-19:
# both yield 903 and their file LISTS are identical (diff: 0 lines).
#
# `git ls-files` returns nothing for a path outside the repo (the guard's own fixture
# corpus lives in a tmpdir), so the ratchet below is the fallback for exactly that case —
# and only that case.
#
# ⛔ `|| true`, not `|| echo 0`: grep -c exits 1 on zero matches, and the echo form would
# emit "0\n0" and break the arithmetic (bash-loop-eval-pitfalls Г3e).
EXPECTED_SCANNED="$(git ls-files -- "$SCAN_DIR" 2>/dev/null | grep -cE '\.test\.tsx?$' || true)"
EXPECTED_SCANNED=$((EXPECTED_SCANNED))
if [ "$EXPECTED_SCANNED" -gt 0 ]; then
  if [ "$SCANNED_COUNT" -lt "$EXPECTED_SCANNED" ]; then
    echo "❌ test anti-pattern guard: scanned $SCANNED_COUNT of the $EXPECTED_SCANNED test file(s)"
    echo "   git tracks under '$SCAN_DIR'. The corpus collapsed rather than the debt"
    echo "   shrinking, so the four counters below mean nothing."
    echo "   A tracked test file that the scan cannot read is the failure this guards."
    exit 1
  fi
else
  # Not a git path (fixture corpus): fall back to the recorded population.
  SCANNED_FLOOR=$((BASELINE_SCANNED / 2))
  if [ "$SCANNED_COUNT" -lt "$SCANNED_FLOOR" ]; then
    echo "❌ test anti-pattern guard: scanned $SCANNED_COUNT test file(s), less than half of"
    echo "   the $BASELINE_SCANNED recorded in BASELINE_SCANNED, and git tracks nothing under"
    echo "   '$SCAN_DIR' to derive an exact expectation from."
    echo "   If the shrink is legitimate, re-run with --update-baseline and commit the new"
    echo "   BASELINE_SCANNED together with the new counter baselines."
    exit 1
  fi
fi

if [ "${1:-}" = "--update-baseline" ]; then
  # Emits the regenerated TSV on stdout — redirect it over the baseline file. Printing
  # rather than writing in place keeps the guard read-only by default, so a broken run
  # cannot silently rewrite its own reference.
  printf '# test-antipattern baseline — (category, file, count) SET, not a total.\n'
  printf '# A total is satisfied by a SWAP: fix one occurrence, add another elsewhere, and\n'
  printf '# the number is unchanged while the debt moved. Regenerate: bash scripts/check-test-antipatterns.sh --update-baseline\n'
  for _cat in method-exists vacuous-length non-canon-service-dir over-mock; do
    current_pairs "$_cat" | sed "s/^/${_cat}${TAB}/"
  done
  exit 0
fi

fail=0


GROWN_ME="$(grown_pairs method-exists)"
if [ -n "$GROWN_ME" ]; then
  echo "❌ method-exists asserts ADDED — file(s) that are new or grew (baseline -> now):"
  echo "$GROWN_ME"
  echo "   A \`expect(typeof x).toBe(\"function\")\` assert verifies nothing TypeScript"
  echo "   doesn't already (a method rename is a compile error). Test the method's"
  echo "   BEHAVIOUR instead, or remove the assert."
  fail=1
fi

GROWN_VL="$(grown_pairs vacuous-length)"
if [ -n "$GROWN_VL" ]; then
  echo "❌ vacuous length asserts ADDED — file(s) that are new or grew (baseline -> now):"
  echo "$GROWN_VL"
  echo "   \`expect(x.length).toBeGreaterThanOrEqual(0)\` is always true and verifies"
  echo "   nothing. Assert the real length/shape, or drop it."
  fail=1
fi

GROWN_NC="$(grown_pairs non-canon-service-dir)"
if [ -n "$GROWN_NC" ]; then
  echo "❌ legacy non-canon service-test dir GREW — new file(s):"
  echo "$GROWN_NC"
  echo "   The canon location for NEW core service tests is"
  echo "   packages/core/tests/unit/services/. Move the new file there; the existing"
  echo "   legacy files are grandfathered by NAME in the baseline, not by count — so"
  echo "   deleting one and adding another no longer nets out to green."
  fail=1
fi

GROWN_OM="$(grown_pairs over-mock)"
if [ -n "$GROWN_OM" ]; then
  echo "❌ over-mock pass-through service-wrapper(s) ADDED:"
  echo "$GROWN_OM"
  echo "   A new test file wholesale-mocks a central collaborator"
  echo "   (@kitelev/exocortex-core/-services, or /services//adapters//infrastructure/,"
  echo "   VaultRDFIndexer) and asserts ONLY delegation (toHaveBeenCalled*) with no"
  echo "   output-value assertion — it verifies a call was forwarded but never"
  echo "   exercises real behaviour. Lift it to a *.integration.test.ts that drives"
  echo "   the real collaborator and faking only the Obsidian boundary (see"
  echo "   TESTING.md §\"Lift over-mock service-wrappers to integration\")."
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
SHRUNK_ALL=""
for _cat in method-exists vacuous-length non-canon-service-dir over-mock; do
  _sh="$(shrunk_pairs "$_cat")"
  [ -n "$_sh" ] && SHRUNK_ALL="${SHRUNK_ALL}   $_cat:
$_sh
"
done
if [ -n "$SHRUNK_ALL" ]; then
  echo "ℹ️  Debt shrank — ratchet the baseline down so the guard keeps its teeth:"
  printf '%s' "$SHRUNK_ALL"
  echo "   bash scripts/check-test-antipatterns.sh --update-baseline > scripts/test-antipattern-baseline.tsv"
fi

exit $fail
