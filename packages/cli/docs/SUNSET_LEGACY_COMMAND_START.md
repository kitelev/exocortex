# Sunset checklist — legacy `command start <path>`

> **Source RFC:** `94e520da-c6f7-48af-944c-51298d68da45` § Phase 7
> **Phase 7 task ledger:** T7.1 (#3045 — Telegram bot routing doc) → T7.2 (#3046 — runtime deprecation warning) → **T7.3 (this doc — sunset planning)**.
> **Canonical replacement:** `exocortex dyncommand exec <uid>`.

The legacy invocation

```bash
exocortex command start <path-to-asset>
```

is deprecated. It still runs `executeStart` and emits a stderr deprecation warning (T7.2), but it MUST be removed once the soak window of **≥ 2 minor releases after 15.55.5** has elapsed.

## When to remove

| Gate | Condition                                                                                                                                                                                                |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | CLI version on `main` is **≥ 15.57.0** (≥ 2 minor releases past the 15.55.x line where T7.2's warning shipped).                                                                                          |
| 2    | Telegram bot Claude subprocess is verified to invoke `dyncommand exec <uid>` (T7.1 routing doc applied; no callers of `command start` remain in `examples/`, `scripts/`, ops cron, or vault automation). |
| 3    | No internal user has reported reliance on `command start <path>` in the prior minor cycle (no inbound issue / Slack thread / Telegram report referencing the deprecation warning text).                  |

If **any** gate is unmet, defer one more minor release and re-evaluate.

## Removal checklist

Once all three gates are green, open a single PR titled `chore(cli): remove deprecated 'command start <path>' (RFC 94e520da § Phase 7 sunset)`:

- [ ] **Code — `packages/cli/src/commands/command.ts`**
  - [ ] Delete the `if (commandName === "start") { console.error(... ) }` deprecation block (marked with `SUNSET-T7.3`).
  - [ ] Delete the `case "start":` branch in the action switch (marked with `SUNSET-T7.3`).
  - [ ] Verify the `<command-name>` CLI argument's help text no longer lists `start` as a supported value (line currently reads `"Command to execute (rename-to-uid, start, complete, schedule, set-deadline, etc.)"` — drop `start`).
- [ ] **Tests — `packages/cli/tests/unit/commands/command.test.ts`**
  - [ ] Delete the two T7.2 deprecation-warning tests (warning fires for `start`, does NOT fire for `complete`).
  - [ ] Add a regression test: `command start <path>` now hits the `default` branch and surfaces an "unknown command" `InvalidArgumentsError`, exactly the same way any other unknown command would.
- [ ] **Docs — `packages/cli/README.md`**
  - [ ] Remove the `# ⚠️ LEGACY (still works until Phase 7.3 sunset...)` block (currently around line 475).
  - [ ] Remove the `Backward compat: the legacy 'command start' path keeps working through Phase 7.2 (deprecation warning) and Phase 7.3 (sunset)` bullet.
  - [ ] Confirm the **NEW canonical path** (`dyncommand exec <uid>`) example is the only Telegram-bot integration code path documented.
- [ ] **Docs — `packages/cli/docs/CLI_API_REFERENCE.md`**
  - [ ] Search for `command start` and remove or rewrite stale references.
- [ ] **Docs — this file**
  - [ ] After the removal PR merges, delete `packages/cli/docs/SUNSET_LEGACY_COMMAND_START.md`. Its only purpose is to schedule the removal; once removal lands it has no consumer.
- [ ] **Vault / ops surface**
  - [ ] Confirm `examples/production-cron/` and any other runnable script no longer reference `command start`.
  - [ ] Re-grep across the monorepo: `grep -rn "command start " packages/ examples/ scripts/ docs/ tests/ specs/ | grep -v -E "(node_modules|coverage|dist|\\.test\\.ts:)"` — expect zero hits.
- [ ] **Release**
  - [ ] Removal MUST land as a `feat!:` or explicit BREAKING CHANGE-tagged commit so the auto-release flow bumps a major (or, by Decision A in the RFC, a clearly-labeled minor that is communicated as semver-breaking in the changelog).
  - [ ] Update `packages/cli/CHANGELOG.md` (or let `release-please`/auto-release) record the removal under a `### Breaking changes` heading, citing this RFC.

## Why a deferred sunset, not an immediate removal

The Phase 7 task literal (`Sunset через ≥ 2 minor releases`) physically requires real soak time across at least two minor releases — not a code-day's worth of edits. T7.3 ships the **commitment** to that sunset (this doc + code FIXME markers near both the deprecation warning and the `case "start"` branch) so the next person who touches `command.ts` cannot miss the cleanup. Actual code deletion is intentionally not part of T7.3's PR; doing so would short-circuit the soak window and re-introduce risk T7.2 was designed to detect.

This pattern (ship the contract now, ship the deletion later under a separate, smaller, mechanically-driven PR) is the one the RFC § Phase 7 explicitly endorses.

## Verification before opening the removal PR

```bash
# 1. Confirm canonical path still works:
exocortex dyncommand exec 1abe7877-a462-4bd5-9bd8-1f75fe7f50aa \
  --target "03 Knowledge/daily/$(date +%Y-%m-%d).md" \
  --dry-run --vault ~/vault --output json

# 2. Confirm legacy path emits deprecation warning *and* still runs:
exocortex command start "tasks/<some-task-uid>.md" --vault ~/vault 2>&1 \
  | grep -E "DEPRECATED.*command start"

# 3. Grep for remaining callers:
grep -rn "command start " packages/ examples/ scripts/ docs/ tests/ specs/ \
  | grep -v -E "(node_modules|coverage|dist|\\.test\\.ts:|SUNSET_LEGACY_COMMAND_START\\.md)"
# Expect: only T7.2 test-file matches and this checklist's own examples.
```

If step 3 returns any non-test, non-doc match — that caller must be migrated to `dyncommand exec <uid>` _before_ removal.
