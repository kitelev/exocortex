/**
 * A reader that closes its end early (`| less` quit with `q`, `| head -c 100`)
 * makes the next write to that stream fail with EPIPE — reported to the write's
 * callback AND emitted as an `'error'` event on the stream. With no listener,
 * Node treats that event as an uncaught exception: the process exits 1, often
 * after printing an internal stack trace, even though the command's own work had
 * already completed.
 *
 * ⛔ This only becomes reachable once a command stops calling `process.exit(0)`
 * on its success path. `process.exit` terminated the process synchronously,
 * before the OS delivered the asynchronous EPIPE — so dropping it to fix the
 * truncation of a piped preview (issue #4436) hands back a DIFFERENT regression
 * on the very same channel. Measured on the built bundle, `set-body --dry-run`
 * with a 300 KiB body piped into a reader that stops after 200 bytes:
 *
 *     with process.exit(0)  (origin/main)   rc=0   5/5 runs
 *     without it, no guard  (the naive fix) rc=1   5/5 runs
 *
 * The command's outcome is decided by the time anything is written, so EPIPE on
 * stdio carries no information the caller can act on: it means "the reader left",
 * not "the command failed". Ignoring it keeps the exit code saying what the
 * command DID. Any other stdio error still surfaces.
 *
 * ⛤ `create-batch.ts` carries its own private copy of this guard (added with its
 * own flush-then-exit helper). It is NOT consolidated here on purpose: mutant
 * `M22_epipe_on_stdio_rethrown` in `create-batch-1848dff9.spec.json` anchors on
 * that copy's INTERNAL rethrow line — not on its call site — so replacing the
 * copy with an import would leave that anchor with
 * zero occurrences — and since neither spec is swept by CI, the loss would only
 * show on a deliberate re-run. Verified by running the driver: M22 → red [B16],
 * control 0. Consolidating the two belongs with the siblings that still need the
 * guard — see the list below.
 *
 * ⛤ Consumers of THIS module, kept current because the list is read as fact:
 *   `set-body` (#4443) · `get-body` (#4447) · `set-property`, `remove-property`,
 *   `create` (#4444 — all three had the truncation and none had the guard).
 * `assetspace-add.ts` and `bootstrap.ts` still call `process.exit(0)` and are not
 * candidates: each emits a fixed set of short status lines, measured in #4444.
 *
 * ⛔ `create-batch.ts` DOES call `process.exit` — via its own `finish()` helper
 * (`await finish(0)` on both success paths), right after writing an unbounded
 * per-item `--dry-run` preview. It escapes this bug class by a DIFFERENT mechanism
 * than the five consumers above: `finish()` awaits an explicit flush signal on both
 * streams before exiting, instead of dropping the exit. That is why it is not a
 * sixth candidate, and why it keeps the private copy of the guard described above.
 * ⛤ The previous wording here claimed it "calls no `process.exit(0)` at all" —
 * false, and inherited unchecked from #4443 into #4444's rewrite of this list
 * (`create-batch.ts` line ~514). Corrected after review: a list introduced as
 * "read as fact" has to survive one grep, and this one did not.
 */
let stdioGuarded = false;

export function guardStdioAgainstClosedReader(): void {
  if (stdioGuarded) return;
  stdioGuarded = true;
  for (const stream of [process.stdout, process.stderr]) {
    stream.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE") throw error;
    });
  }
}

/** Test-only: forget that the guard was installed, so a fresh one can be armed. */
export function resetStdioGuardForTests(): void {
  stdioGuarded = false;
}
