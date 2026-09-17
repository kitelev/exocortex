// The launcher imports @playwright/test at module scope; loading the real bundle
// under jsdom pulls in the whole MCP browser stack. Only `chromium.connectOverCDP`
// is on a tested path here (A2 pins that it is NOT reached after an abandon), so
// it is a spy; nothing else from the bundle is touched.
const connectOverCDP = jest.fn();
jest.mock("@playwright/test", () => ({
  chromium: { connectOverCDP: (...args: unknown[]) => connectOverCDP(...args) },
}));

// The axes drive the real `launchAttempt` (spawn → port wait → CDP connect) with
// the process layer out: the spawn is a stub, the config write a no-op, and the
// `/json/version` probe goes to a scripted `http.request` (the launcher reaches
// it through `await import("http")`, which jest routes to this factory).
// (Plain functions, not jest.fn: this config runs with `resetMocks`, which
// would strip a jest.fn's implementation before the first test.)
jest.mock("child_process", () => ({
  spawn: () => ({ pid: 4242, kill: () => undefined }),
}));
let request: jest.Mock = jest.fn();
jest.mock("http", () => ({
  request: (...args: unknown[]) => request(...args),
}));

import { ObsidianLauncher } from "../../e2e/utils/obsidian-launcher";

// `launchAttempt` first checks that the Obsidian binary exists — point it at a
// file that does (this spec), so no `fs` stub is needed.
process.env.OBSIDIAN_PATH = __filename;

/**
 * Guards ticket 4abffc07 (LOW-1 of the #4252 review): `close()` on a launcher
 * whose launch is in flight CANCELS the in-flight attempt, it does not merely
 * stop the NEXT one (that half is req dad111a2, C1–C7 in the sibling file).
 *
 * BEFORE: `waitForPort(this.cdpPort, 45000)` polled `/json/version` every 500 ms
 * and its `retryCheck` read only `Date.now() - startTime > timeout`; the
 * `chromium.connectOverCDP` call after it read nothing. So after
 * `afterAll → close()` the abandoned attempt kept polling :9222 for up to 45 s —
 * and if the NEXT spec's `beforeAll` brought its own Obsidian up on :9222 in that
 * window, the orphan resolved against the foreign process and went on to
 * `connectOverCDP` it. Reproduced on 6c89b6b3 with the A1 fixture: after
 * `close()` the wait stayed pending, a poll timer stayed armed, and 45 s of fake
 * time later it rejected with "Timeout waiting for port" — not with the
 * abandonment.
 *
 * AFTER: the wait that is blocking the attempt registers itself with the
 * launcher; `close()` (while a launch is in flight) sets `abandoned` AND fires
 * that registration, so `waitForPort` rejects on the abandon itself — no poll
 * timer left armed, no further request. `launchAttempt` additionally refuses to
 * `connectOverCDP` once `abandoned` is set (defence in depth for the window
 * between the port coming up and the connect).
 *
 * Mutant matrix (driver `mutants-4abffc07.py`, round 2 2026-09-17, copied from its
 * output; CONTROL plugin-unit=37 failed=0):
 *   M1 launcher: waitForPort does not register its cancel slot                → RED: ['A1', 'A1d']
 *   M2 launcher: no `abandoned` check before connectOverCDP                   → RED: ['A2']
 *   M4 launcher: retryCheck re-arms the poll after the abandon (late error)   → RED: ['A1d']
 *   M6 launcher: no entry check in waitForPort (close() before registration)  → RED: ['A1e']
 *   M0 semantic revert M1+M2+M3a+M3b+M4+M6 → RED: ['A1', 'A1d', 'A1e', 'A2', 'A3', 'A3b', 'A3d']
 *   (A1b / A1c / A2b and the C1–C7 axes of the sibling file stay GREEN under every mutant)
 */
const REQ = "@req:d6c2acd4-6993-4b3b-8305-dcf5b1ba6d8f";

type LauncherInternals = {
  waitForPort: (port: number, timeout: number) => Promise<void>;
  launchAttempt: (attempt: number) => Promise<void>;
  teardown: () => Promise<void>;
  createObsidianConfig: () => void;
  launchInFlight: boolean;
};

const internals = (l: ObsidianLauncher): LauncherInternals =>
  l as unknown as LauncherInternals;

/** A `http.request` whose every attempt fails with ECONNREFUSED on the next macrotask. */
type FakeReq = { on: jest.Mock; end: jest.Mock };
const refusingRequest = (): jest.Mock =>
  jest.fn((): FakeReq => {
    const handlers: Record<string, (e: Error) => void> = {};
    return {
      on: jest.fn((event: string, cb: (e: Error) => void) => {
        handlers[event] = cb;
      }),
      end: jest.fn(() => {
        setTimeout(() => handlers.error?.(new Error("ECONNREFUSED")), 0);
      }),
    };
  });

/** Settlement probe: the FACT the axes wait for, instead of a number of ticks. */
const settle = (p: Promise<unknown>) => {
  const s = {
    state: "pending" as "pending" | "resolved" | "rejected",
    error: undefined as unknown,
  };
  p.then(
    () => {
      s.state = "resolved";
    },
    (e) => {
      s.state = "rejected";
      s.error = e;
    },
  );
  return s;
};

/**
 * The real `launchAttempt` with the process layer out: config write no-op, spawn
 * stubbed at module level, teardown a counted no-op, `launchInFlight` set the way
 * `launch()` would set it (so `close()` marks the launch abandoned). The CDP-port
 * wait is the real one unless the axis replaces it.
 */
const attemptable = (
  waitForPort?: () => Promise<void>,
): { launcher: ObsidianLauncher; teardown: jest.SpyInstance } => {
  const launcher = new ObsidianLauncher("/tmp/does-not-matter");
  const i = internals(launcher);
  jest.spyOn(i, "createObsidianConfig").mockImplementation(() => {});
  const teardown = jest.spyOn(i, "teardown").mockResolvedValue(undefined);
  if (waitForPort) jest.spyOn(i, "waitForPort").mockImplementation(waitForPort);
  i.launchInFlight = true;
  return { launcher, teardown };
};

const ABANDONED_WAIT =
  /waiting for port 9222 was abandoned by its caller \(close\(\) ran while the launch was in flight\)/;

describe(`ObsidianLauncher: the in-flight port wait is cancelled by close() (${REQ})`, () => {
  let log: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    request = refusingRequest();
    log = jest.spyOn(console, "log").mockImplementation(() => {});
    connectOverCDP.mockReset();
  });
  afterEach(() => {
    jest.useRealTimers();
    log.mockRestore();
  });

  it(`A1 close() during the port wait ⇒ the attempt fails on the abandon itself — no poll timer left armed, no further request, no CDP connect ${REQ}`, async () => {
    const { launcher, teardown } = attemptable();

    const probe = settle(internals(launcher).launchAttempt(1));
    // Two refused polls: proves the wait is genuinely polling before the abandon.
    await jest.advanceTimersByTimeAsync(1_000);
    expect(request.mock.calls.length).toBeGreaterThanOrEqual(2);
    const requestsBeforeClose = request.mock.calls.length;
    expect(probe.state).toBe("pending");

    await launcher.close();
    // The FACT, not N ticks: drain microtasks only — no timer is advanced.
    await jest.advanceTimersByTimeAsync(0);

    expect(probe.state).toBe("rejected");
    expect(String(probe.error)).toMatch(ABANDONED_WAIT);
    // Discriminator vs the pre-fix loop: it kept a 500 ms poll timer armed and
    // rejected only 45 s later with "Timeout waiting for port".
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(request.mock.calls.length).toBe(requestsBeforeClose);
    expect(connectOverCDP).not.toHaveBeenCalled();
    expect(teardown).toHaveBeenCalledTimes(1); // the caller's close(), nothing else
  });

  it(`A1d [reviewer] close() while a probe is ON THE WIRE ⇒ its late error does not re-arm the poll (retryCheck after abandon) ${REQ}`, async () => {
    // Refused polls whose ECONNREFUSED arrives 100 ms after end(): probes go
    // out at 0 / 600 / 1200 ms, so close() at t=1250 lands while probe #3 is
    // ON THE WIRE (sent at 1200, its error lands at 1300 — after the abandon).
    request = jest.fn((): FakeReq => {
      const handlers: Record<string, (e: Error) => void> = {};
      return {
        on: jest.fn((event: string, cb: (e: Error) => void) => {
          handlers[event] = cb;
        }),
        end: jest.fn(() => {
          setTimeout(() => handlers.error?.(new Error("ECONNREFUSED")), 100);
        }),
      };
    });
    const { launcher } = attemptable();
    const probe = settle(internals(launcher).launchAttempt(1));
    await jest.advanceTimersByTimeAsync(1_250);
    const requestsBeforeClose = request.mock.calls.length;
    expect(requestsBeforeClose).toBe(3);
    expect(jest.getTimerCount()).toBe(1); // probe #3's pending error, no poll armed
    expect(probe.state).toBe("pending");

    await launcher.close();
    await jest.advanceTimersByTimeAsync(0);
    expect(probe.state).toBe("rejected");
    // The in-flight probe's error lands at 1300 — it must NOT re-arm the 500 ms poll.
    await jest.advanceTimersByTimeAsync(60_000);
    expect(jest.getTimerCount()).toBe(0);
    expect(request.mock.calls.length).toBe(requestsBeforeClose);
  });

  it(`A1e [reviewer] close() before the wait has registered (during the http import yield) ⇒ the wait rejects on entry, no probe is ever sent ${REQ}`, async () => {
    const { launcher, teardown } = attemptable();
    const probe = settle(internals(launcher).launchAttempt(1));
    // No tick: launchAttempt is parked on `await import("http")`, the wait's
    // executor has not run, the cancel slot is still null.
    const closing = launcher.close();
    await jest.advanceTimersByTimeAsync(0);
    await closing;
    expect(probe.state).toBe("rejected");
    expect(String(probe.error)).toMatch(/launch already abandoned/);
    expect(request).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    expect(teardown).toHaveBeenCalledTimes(1);
  });

  it(`A1b without a close() the port wait is unchanged — still times out after 45 s of refused polls (control) ${REQ}`, async () => {
    const { launcher } = attemptable();

    const probe = settle(internals(launcher).launchAttempt(1));
    await jest.advanceTimersByTimeAsync(44_000);
    expect(probe.state).toBe("pending");
    await jest.advanceTimersByTimeAsync(2_000);
    expect(probe.state).toBe("rejected");
    expect(String(probe.error)).toMatch(
      /Timeout waiting for port 9222 after 45000ms/,
    );
    // ~90 polls at 500 ms — the loop polled all the way, nothing cut it short.
    expect(request.mock.calls.length).toBeGreaterThan(80);
    expect(connectOverCDP).not.toHaveBeenCalled();
  });

  it(`A1c a port that comes up lets the attempt proceed to the CDP connect as before (control) ${REQ}`, async () => {
    const { launcher } = attemptable();
    request.mockImplementationOnce(
      (_opts: unknown, cb: (res: { statusCode: number }) => void): FakeReq => ({
        on: jest.fn(),
        end: jest.fn(() => setTimeout(() => cb({ statusCode: 200 }), 0)),
      }),
    );
    // Stop the attempt right after the connect — the window/vault/plugin waits
    // are out of scope here and would need a live page.
    const sentinel = new Error("connected — stop here");
    connectOverCDP.mockRejectedValue(sentinel);

    const probe = settle(internals(launcher).launchAttempt(1));
    await jest.advanceTimersByTimeAsync(10);
    expect(probe.state).toBe("rejected");
    expect(probe.error).toBe(sentinel);
    expect(connectOverCDP).toHaveBeenCalledTimes(1);
    expect(connectOverCDP).toHaveBeenCalledWith("http://localhost:9222", {
      timeout: 30000,
    });
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe(`ObsidianLauncher.launchAttempt: no connectOverCDP once abandoned (${REQ})`, () => {
  let log: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    connectOverCDP.mockReset();
    log = jest.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    jest.useRealTimers();
    log.mockRestore();
  });

  it(`A2 close() lands between the port coming up and the CDP connect ⇒ connectOverCDP is never called, the attempt fails as abandoned ${REQ}`, async () => {
    const { launcher, teardown } = attemptable(async () => {
      // The port check succeeded, and the caller walked away in the same window.
      await launcher.close();
    });
    connectOverCDP.mockRejectedValue(new Error("must not be reached"));

    await expect(internals(launcher).launchAttempt(1)).rejects.toThrow(
      /attempt 1 was abandoned by its caller \(close\(\) ran while the launch was in flight\) — not connecting over CDP/,
    );
    expect(connectOverCDP).not.toHaveBeenCalled();
    expect(teardown).toHaveBeenCalledTimes(1); // the caller's close(), nothing else
  });

  it(`A2b without a close() the attempt connects over CDP as before (control) ${REQ}`, async () => {
    const { launcher } = attemptable(async () => undefined);
    const sentinel = new Error("connected — stop here");
    connectOverCDP.mockRejectedValue(sentinel);

    await expect(internals(launcher).launchAttempt(1)).rejects.toBe(sentinel);
    expect(connectOverCDP).toHaveBeenCalledTimes(1);
  });
});
