/**
 * Race a promise against a deadline, platform-free.
 *
 * ## Why this lives in core rather than next to its caller
 *
 * Its only caller is the plugin's `GitHubRestClient`, and the obvious place
 * for it is that file. It cannot stay there: `eslint-plugin-obsidianmd`'s
 * `prefer-window-timers` rewrites every `setTimeout` inside
 * `packages/obsidian-plugin/src` to `window.setTimeout` on `--fix` (which
 * `lint-staged` runs on commit), and that client also runs where there is no
 * window — the CLI-parity transport, and the production-shape suite for Issue
 * #3382, which declares `@jest-environment node`.
 *
 * Measured (2026-09-26): with the rewrite in place, `BootstrapPatRefresh`
 * fails with `GitHub request failed: window is not defined` and the tarball
 * pull is never attempted. Suppressing the rule is not an option either —
 * `eslint-comments/no-restricted-disable` refuses that rule by name. The rule
 * only scans the plugin package, so moving the timer out of it is the honest
 * fix rather than a dodge: a promise deadline is not a windowing concern, and
 * every other consumer of this transport contract is platform-free already.
 *
 * ⚠ The underlying work is NOT cancelled on timeout (callers here wrap
 * non-abortable requests); it is left to settle and its result discarded. The
 * timer is always cleared, on both exit paths, so nothing is kept alive.
 */

export async function promiseWithDeadline<T>(
  work: Promise<T>,
  timeoutMs: number,
  onTimeout: () => Error,
): Promise<T> {
  if (timeoutMs <= 0) return work;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => reject(onTimeout()), timeoutMs);
    // Unref so a pending timer never keeps a Node test process alive; guarded
    // because Electron renderer / browser timers expose no `unref`.
    (timer as unknown as { unref?: () => void }).unref?.();
  });
  try {
    // Forwards the work's own resolution/rejection verbatim (the request wins)
    // or the deadline's Error (the stall loses) — no manual reject, so the
    // original rejection reason is preserved.
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
