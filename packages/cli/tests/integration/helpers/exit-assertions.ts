/**
 * Exit-code predicates for CLI commands whose success path does NOT call
 * `process.exit` (issue #4444, and #4436 / #4434 before it for `set-body` /
 * `get-body`).
 *
 * WHY THESE EXIST, and why the obvious forms are wrong once the exit is gone:
 *
 * `process.exit(0)` on a success path terminates the process synchronously and
 * therefore does NOT wait for an asynchronous write to drain. stderr and stdout are
 * asynchronous whenever they are a PIPE, which is exactly how a `--dry-run` preview
 * is read (`| less`, `| head`, captured by a wrapper). The preview these commands
 * write is the WHOLE rebuilt document, so it was cut at the pipe buffer — measured
 * on the built bundle with a 605 686-byte asset: `set-property` delivered 73 728 of
 * 605 729 bytes, `remove-property` 73 728 of 605 708, `create` 65 536 of 605 895 —
 * 87.8-89.2 % silently lost from a surface whose entire purpose is to be read
 * before applying (dry-run-preview-not-real-output).
 *
 * ⛔ `expect(codes).toContain(0)` therefore cannot stay: with the exit gone, the
 * success path records NO exit call at all, so the array is empty. Replacing it
 * with the stronger `toEqual([])` is not just a mechanical fix — it is the IN-JEST
 * half of the truncation guard: restoring `process.exit(0)` reddens every success
 * axis that uses it. The DELIVERED-bytes half cannot live in jest at all (its axes
 * mock `process.stderr.write` and `process.exit`, so no pipe and no flush is ever
 * exercised — integration-test-revert-verify §A66); it lives in
 * `dryrun-4444-pipe.harness.ts`.
 *
 * ⛔ And `expect(codes).not.toContain(0)` cannot stay on the REFUSAL side, for the
 * mirror reason: a negated predicate is satisfied by MANY outcomes
 * (integration-test-revert-verify §A38), including "exit was never called". Before
 * this change that was unreachable — the success path always called exit(0), so an
 * empty array meant nothing had run. Now the success path produces exactly that
 * empty array, so the weak form would pass on a command that silently did nothing
 * instead of refusing. `expectRefused` demands an actual non-zero code.
 *
 * ⛤ Shared rather than copied per file: this change touched 16 suites, and the same
 * two predicates pasted 16 times is 16 places for them to drift. `set-body`'s two
 * suites define them locally (#4443) and are left alone deliberately — moving them
 * would be a second concern in this PR, and their local copies are anchors of live
 * mutants in `set-body-4436.guard.spec.json` (integration-test-revert-verify §A127:
 * a decorator or a move that silently voids someone else's proof).
 */
import { expect } from "@jest/globals";

/**
 * The command completed and never asked to exit — the shape of a success path with
 * no `process.exit(0)`. Strictly stronger than `not.toContain(<non-zero>)`: it also
 * rules out a stray exit(0) sneaking back in.
 */
export function expectNaturalExit(codes: number[]): void {
  expect(codes).toEqual([]);
}

/**
 * The command REFUSED: it asked to exit, with a non-zero code. Refusals route
 * through `ErrorHandler.handle()`, which calls `process.exit` with a non-zero code
 * (`ErrorHandler.ts`) — untouched by #4444 — so this is the faithful shape, not a
 * tightening that guesses.
 */
export function expectRefused(codes: number[]): void {
  expect(codes.length).toBeGreaterThan(0);
  expect(codes.some((c) => c !== 0)).toBe(true);
}
