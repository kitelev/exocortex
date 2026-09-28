/**
 * Axes for `guardStdioAgainstClosedReader` (issue #4436).
 *
 * The guard exists because dropping `process.exit(0)` from a success path — the
 * fix for the piped-preview truncation — lets the process live long enough to
 * receive the asynchronous EPIPE a reader causes when it closes its end early.
 * With no `'error'` listener that is an uncaught exception: rc=1, often with a
 * stack trace. Measured on the built bundle, `set-body --dry-run … | head -c 200`:
 * origin/main rc=0 5/5, the exit-less fix WITHOUT the guard rc=1 5/5.
 *
 * ⛤ These axes judge the guard's BRANCHES in-process; the delivered effect (a real
 * child, a real pipe, a reader that leaves) is axis S7 of
 * `tests/integration/set-body-4436-pipe.harness.ts`. Both are needed: the harness
 * cannot reach the rethrow branch (no reachable non-EPIPE stdio error in
 * set-body's inputs), and these cannot prove the process survives.
 */
import {
  guardStdioAgainstClosedReader,
  resetStdioGuardForTests,
} from "../../../src/utils/stdioClosedReader.js";

/** Listeners present before a test, so the test removes only what it added. */
function snapshotListeners(): Map<NodeJS.WriteStream, unknown[]> {
  const snapshot = new Map<NodeJS.WriteStream, unknown[]>();
  for (const stream of [process.stdout, process.stderr]) {
    snapshot.set(stream, [...stream.listeners("error")]);
  }
  return snapshot;
}

describe("guardStdioAgainstClosedReader (issue #4436)", () => {
  let before: Map<NodeJS.WriteStream, unknown[]>;

  beforeEach(() => {
    resetStdioGuardForTests();
    before = snapshotListeners();
  });

  afterEach(() => {
    // Remove exactly the listeners this test installed — the streams are the
    // real process-wide ones, shared with every other suite in this worker.
    for (const [stream, original] of before) {
      for (const listener of stream.listeners("error")) {
        if (!original.includes(listener)) {
          stream.off("error", listener as (...args: unknown[]) => void);
        }
      }
    }
    resetStdioGuardForTests();
  });

  it("E1: EPIPE on stdout is swallowed — the reader left, the command did not fail", () => {
    guardStdioAgainstClosedReader();
    const epipe: NodeJS.ErrnoException = new Error("write EPIPE");
    epipe.code = "EPIPE";
    expect(() => process.stdout.emit("error", epipe)).not.toThrow();
  });

  it("E2: EPIPE on stderr is swallowed too — the preview channel is the one that truncates", () => {
    guardStdioAgainstClosedReader();
    const epipe: NodeJS.ErrnoException = new Error("write EPIPE");
    epipe.code = "EPIPE";
    expect(() => process.stderr.emit("error", epipe)).not.toThrow();
  });

  it("E3: a NON-EPIPE stdio error still surfaces — the guard narrows, it does not silence", () => {
    guardStdioAgainstClosedReader();
    const other: NodeJS.ErrnoException = new Error("write ECONNRESET");
    other.code = "ECONNRESET";
    expect(() => process.stderr.emit("error", other)).toThrow(
      "write ECONNRESET",
    );
  });

  it("E4: installing the guard repeatedly adds exactly ONE listener per stream", () => {
    const baseline = [process.stdout, process.stderr].map(
      (s) => s.listenerCount("error"),
    );
    guardStdioAgainstClosedReader();
    guardStdioAgainstClosedReader();
    guardStdioAgainstClosedReader();
    const after = [process.stdout, process.stderr].map((s) =>
      s.listenerCount("error"),
    );
    // Every command in the CLI may install it, and jest runs many suites in one
    // worker: a per-call listener would accumulate into MaxListenersExceeded.
    expect(after).toEqual(baseline.map((n) => n + 1));
  });
});
