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
 * own flush-then-exit helper). It is NOT consolidated here on purpose: its copy
 * is the anchor of a live mutant in `create-batch-1848dff9.spec.json`, so moving
 * it would silently void that proof. Consolidating the two — and applying this
 * guard to `get-body` (#4434) and to the three commands in #4444, which share the
 * defect — is tracked separately.
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
