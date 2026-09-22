// The launcher imports @playwright/test at module scope; loading the real bundle
// under jsdom pulls in the whole MCP browser stack. Nothing under test touches
// it — `chromium` is only used inside `launchAttempt`, which these axes never call.
jest.mock("@playwright/test", () => ({ chromium: {} }));

import { ObsidianLauncher } from "../../e2e/utils/obsidian-launcher";

/**
 * Guards the fix for the `pluginLoaded` e2e flake.
 *
 * BEFORE: `launchAttempt` waited for the VAULT (`waitForVaultReady`, 30s) and
 * stopped there. Each spec then spun its own `for (let i = 0; i < 20; i++)
 * { …500ms }` loop — a hard 10s ceiling — and failed as
 * `expect(result.pluginLoaded).toBe(true)`, a message that names the symptom and
 * hides the cause. Measured on origin/main over 20 runs × all attempts:
 * e2e-shard (1)/(3)/(5) flaked ~5% each, the aggregate `e2e-tests` 15%, and every
 * sampled failure log carried `pluginLoaded`.
 *
 * AFTER: the launcher itself waits for the plugin, with a ceiling consistent with
 * its neighbours (CDP port 45s, window 30s, vault 30s → plugin 30s) and a
 * failure that carries evidence. Because the wait lives inside `launchAttempt`,
 * a plugin that never loads now also triggers `launch()`'s existing 3-attempt
 * relaunch with backoff instead of failing the spec outright.
 */
const REQ = "@req:675d37a6-054a-4acb-873b-cba9e90c6d3e";

/**
 * The launcher's window surface as the axes below see it: `evaluate` (plugin /
 * vault polls), `locator(...).first()` → `{ isVisible, click }` (the trust
 * probe) and `waitForSelector` (the post-click hidden wait). Everything else on
 * a Playwright `Page` is out of the tested paths.
 */
type FakeTrustButton = { isVisible: jest.Mock; click: jest.Mock };
type FakeWindow = {
  evaluate: jest.Mock;
  locator: jest.Mock;
  waitForSelector: jest.Mock;
};

const makeWindow = (
  evaluate: jest.Mock,
  trustButton: FakeTrustButton = {
    isVisible: jest.fn().mockResolvedValue(false),
    click: jest.fn().mockResolvedValue(undefined),
  },
): FakeWindow => ({
  evaluate,
  locator: jest.fn(() => ({ first: () => trustButton })),
  waitForSelector: jest.fn().mockResolvedValue(undefined),
});

describe("ObsidianLauncher.waitForPluginReady", () => {
  const makeLauncher = (
    evaluate: jest.Mock,
    trustButton?: FakeTrustButton,
  ): ObsidianLauncher => {
    const launcher = new ObsidianLauncher("/tmp/does-not-matter");
    // A fake window is enough and keeps the test free of Playwright/Obsidian.
    // Default trust button: never visible → the wait behaves exactly as before
    // the late-dialog fix (the control for the axes in the second describe).
    (launcher as unknown as { window: FakeWindow }).window = makeWindow(
      evaluate,
      trustButton,
    );
    return launcher;
  };

  const callWait = (launcher: ObsidianLauncher): Promise<void> =>
    (
      launcher as unknown as { waitForPluginReady: () => Promise<void> }
    ).waitForPluginReady();

  it("resolves once the exocortex plugin is reachable", async () => {
    // Not loaded on the first poll, loaded on the second — proves it actually
    // waits rather than sampling once.
    const evaluate = jest
      .fn()
      .mockResolvedValueOnce({ loaded: false, enabled: ["dataview"] })
      .mockResolvedValueOnce({
        loaded: true,
        enabled: ["dataview", "exocortex"],
      });

    await expect(callWait(makeLauncher(evaluate))).resolves.toBeUndefined();
    expect(evaluate).toHaveBeenCalledTimes(2);
  });

  it("throws with the loaded-plugin list when the plugin never appears", async () => {
    // ⛤ The evidence half: a bare `pluginLoaded: false` cannot distinguish "still
    // loading" from "failed to load / not installed". The plugin list can.
    const evaluate = jest
      .fn()
      .mockResolvedValue({ loaded: false, enabled: ["dataview", "templater"] });

    const launcher = makeLauncher(evaluate);
    const nowSpy = jest.spyOn(Date, "now");
    // t0, then a value past the 30s ceiling on the first ceiling check.
    nowSpy.mockReturnValueOnce(0).mockReturnValue(30_001);

    await expect(callWait(launcher)).rejects.toThrow(
      /exocortex plugin did not load within 30000ms.*dataview, templater/s,
    );

    nowSpy.mockRestore();
  });

  it("throws a distinct error when there is no window at all", async () => {
    const launcher = new ObsidianLauncher("/tmp/does-not-matter");
    await expect(callWait(launcher)).rejects.toThrow("Window not available");
  });

  it("is wired into launchAttempt AFTER the vault wait", () => {
    // ⛤ Structural, and deliberately so: the behaviour axes above pin the helper,
    // but nothing in them would notice if the CALL were dropped from
    // `launchAttempt` — the helper would keep passing while the flake returned.
    // Driving the real `launchAttempt` would mean spawning Obsidian, so this axis
    // reads the compiled method body instead. It is weaker than an execution axis
    // and is stated as such; it exists to catch a silent removal of the wiring.
    const body = (
      ObsidianLauncher.prototype as unknown as {
        launchAttempt: () => Promise<void>;
      }
    ).launchAttempt.toString();

    const vaultCall = body.indexOf("waitForVaultReady");
    const pluginCall = body.indexOf("waitForPluginReady");

    expect(vaultCall).toBeGreaterThan(-1);
    expect(pluginCall).toBeGreaterThan(-1);
    expect(pluginCall).toBeGreaterThan(vaultCall);
  });
});

/**
 * Guards the fix for the SECOND `pluginLoaded` flake (ticket be9e9b46,
 * req 675d37a6): a "Trust author and enable plugins" dialog that Obsidian
 * renders AFTER `handleTrustDialog`'s single look.
 *
 * `Locator.isVisible()` in playwright-core 1.62.1 is a one-shot snapshot — its
 * `timeout` option is `@deprecated This option is ignored … returns
 * immediately` (types.d.ts) and the runtime sends `kNoTimeout`. So the old
 * `isVisible({ timeout: 10000 })` never waited: the probe fired the instant
 * `window.app` appeared, a dialog rendered later stayed on screen, the vault
 * sat in Restricted Mode, and `waitForPluginReady` ran its full 30 s to
 * `Loaded plugins: [none]` (two red e2e-shard-6 runs in one day, both green on
 * rerun; 40 green launches loaded the plugin in 9–33 ms). The fix re-probes on
 * every poll while the plugin is absent and clicks the dialog at most once.
 */
describe(`ObsidianLauncher late trust dialog (${REQ})`, () => {
  // Date.now: t0 = 0, then +10 s per call → the 30 s ceiling is reached on the
  // 3rd ceiling check, so a wait that never sees the plugin fails after ~1 s of
  // real time (2 × 500 ms sleeps) instead of 30 s.
  const stepClock = (): jest.SpyInstance => {
    let t = -10_000;
    return jest.spyOn(Date, "now").mockImplementation(() => {
      t += 10_000;
      return t;
    });
  };

  const callWait = (launcher: ObsidianLauncher): Promise<void> =>
    (
      launcher as unknown as { waitForPluginReady: () => Promise<void> }
    ).waitForPluginReady();

  it(`clicks a trust dialog that appears during the plugin wait and then resolves ${REQ}`, async () => {
    // The plugin loads only AFTER the click — exactly the Restricted-Mode
    // shape: without the click `loaded` stays false forever.
    let clicked = false;
    const trustButton: FakeTrustButton = {
      // poll 0: not rendered yet; poll 1: on screen.
      isVisible: jest.fn().mockResolvedValueOnce(false).mockResolvedValue(true),
      click: jest.fn(async () => {
        clicked = true;
      }),
    };
    const evaluate = jest.fn(async () => ({
      loaded: clicked,
      enabled: clicked ? ["exocortex"] : [],
    }));
    const launcher = new ObsidianLauncher("/tmp/does-not-matter");
    const fakeWindow = makeWindow(evaluate, trustButton);
    (launcher as unknown as { window: FakeWindow }).window = fakeWindow;
    const clock = stepClock();
    const log = jest.spyOn(console, "log").mockImplementation(() => {});

    await expect(callWait(launcher)).resolves.toBeUndefined();

    expect(trustButton.click).toHaveBeenCalledTimes(1);
    // poll 0 (not loaded, not visible) → poll 1 (not loaded, visible → click)
    // → poll 2 (loaded).
    expect(evaluate).toHaveBeenCalledTimes(3);
    expect(trustButton.isVisible).toHaveBeenCalledTimes(2);
    // The click goes through the same post-click hidden-wait as the fast path.
    expect(fakeWindow.waitForSelector).toHaveBeenCalledWith(
      'button:has-text("Trust author and enable plugins")',
      expect.objectContaining({ state: "hidden" }),
    );
    expect(
      log.mock.calls.some((c) =>
        String(c[0]).includes("Trust dialog appeared late (poll 1)"),
      ),
    ).toBe(true);

    clock.mockRestore();
    log.mockRestore();
  });

  it(`without a dialog the wait is unchanged — resolves after 2 polls, never clicks (control) ${REQ}`, async () => {
    // ⛤ Control axis: green with AND without the fix, by design — it pins the
    // no-op property (no dialog → no click, same poll count as before).
    const trustButton: FakeTrustButton = {
      isVisible: jest.fn().mockResolvedValue(false),
      click: jest.fn(),
    };
    const evaluate = jest
      .fn()
      .mockResolvedValueOnce({ loaded: false, enabled: [] })
      .mockResolvedValueOnce({ loaded: true, enabled: ["exocortex"] });
    const launcher = new ObsidianLauncher("/tmp/does-not-matter");
    (launcher as unknown as { window: FakeWindow }).window = makeWindow(
      evaluate,
      trustButton,
    );

    await expect(callWait(launcher)).resolves.toBeUndefined();
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(trustButton.click).not.toHaveBeenCalled();
  });

  it(`probes the trust button with a bare isVisible() — no deprecated timeout option ${REQ}`, async () => {
    // playwright-core 1.62.1 ignores `{ timeout }` on isVisible(); passing it
    // would only document a wait that does not happen.
    const trustButton: FakeTrustButton = {
      isVisible: jest.fn().mockResolvedValue(false),
      click: jest.fn(),
    };
    const evaluate = jest
      .fn()
      .mockResolvedValueOnce({ loaded: false, enabled: [] })
      .mockResolvedValueOnce({ loaded: true, enabled: ["exocortex"] });
    const launcher = new ObsidianLauncher("/tmp/does-not-matter");
    (launcher as unknown as { window: FakeWindow }).window = makeWindow(
      evaluate,
      trustButton,
    );

    await callWait(launcher);
    expect(trustButton.isVisible).toHaveBeenCalledTimes(1);
    expect(trustButton.isVisible).toHaveBeenCalledWith();
  });

  it(`a refused click is bounded (5 s) and NOT latched — the next poll re-probes and clicks again ${REQ}`, async () => {
    // LOW-2 (review): without `{ timeout }` click() waits for actionability
    // under Playwright's 30 s default, eating the whole plugin-wait budget
    // behind the ceiling check; without try/catch a refused click would
    // reject the wait with a foreign TimeoutError. Here the first click is
    // refused (element detached between snapshot and click), the second
    // succeeds and the plugin loads.
    let clicked = false;
    const trustButton: FakeTrustButton = {
      isVisible: jest.fn().mockResolvedValue(true),
      click: jest
        .fn()
        .mockRejectedValueOnce(
          new Error("locator.click: Timeout 5000ms exceeded"),
        )
        .mockImplementation(async () => {
          clicked = true;
        }),
    };
    const evaluate = jest.fn(async () => ({
      loaded: clicked,
      enabled: clicked ? ["exocortex"] : [],
    }));
    const launcher = new ObsidianLauncher("/tmp/does-not-matter");
    (launcher as unknown as { window: FakeWindow }).window = makeWindow(
      evaluate,
      trustButton,
    );
    const clock = stepClock();
    const log = jest.spyOn(console, "log").mockImplementation(() => {});

    await expect(callWait(launcher)).resolves.toBeUndefined();

    // poll 0: refused → not latched; poll 1: clicked; poll 2: loaded.
    expect(trustButton.click).toHaveBeenCalledTimes(2);
    expect(trustButton.click).toHaveBeenCalledWith({ timeout: 5000 });
    expect(evaluate).toHaveBeenCalledTimes(3);
    expect(
      log.mock.calls.some((c) =>
        String(c[0]).includes("Trust button click refused"),
      ),
    ).toBe(true);

    clock.mockRestore();
    log.mockRestore();
  });

  it(`the trust helper keeps using the window it captured when close() nulls this.window mid-click ${REQ}`, async () => {
    // LOW-1 (review): the helper spans two awaits; if close() (afterAll) nulls
    // this.window between them, a re-read of this.window would surface as
    // TypeError (reading 'waitForSelector'). Capturing once means the helper
    // finishes on the page it started on, and the LOOP then reports the
    // explicit window-closed error on its next poll.
    const launcher = new ObsidianLauncher("/tmp/does-not-matter");
    const trustButton: FakeTrustButton = {
      isVisible: jest.fn().mockResolvedValue(true),
      click: jest.fn(async () => {
        (launcher as unknown as { window: FakeWindow | null }).window = null;
      }),
    };
    const evaluate = jest
      .fn()
      .mockResolvedValue({ loaded: false, enabled: [] });
    const fakeWindow = makeWindow(evaluate, trustButton);
    (launcher as unknown as { window: FakeWindow }).window = fakeWindow;
    const clock = stepClock();
    const log = jest.spyOn(console, "log").mockImplementation(() => {});

    await expect(callWait(launcher)).rejects.toThrow(
      /window closed during plugin wait/,
    );
    // The post-click hidden-wait ran on the captured page, not on `null`.
    expect(fakeWindow.waitForSelector).toHaveBeenCalledTimes(1);

    clock.mockRestore();
    log.mockRestore();
  });

  it(`fails with an explicit "window closed" error when close() nulls the window mid-wait ${REQ}`, async () => {
    // afterAll → close() → this.window = null while a retry's wait loop is
    // still polling (the 60 s beforeAll budget overflow). Before the fix this
    // surfaced as `TypeError: Cannot read properties of null (reading
    // 'evaluate')` — a misleading second failure.
    const launcher = new ObsidianLauncher("/tmp/does-not-matter");
    const evaluate = jest.fn(async () => {
      (launcher as unknown as { window: FakeWindow | null }).window = null;
      return { loaded: false, enabled: [] };
    });
    (launcher as unknown as { window: FakeWindow }).window =
      makeWindow(evaluate);
    const clock = stepClock();

    // The regex is the discriminator: the pre-fix TypeError does not match it.
    await expect(callWait(launcher)).rejects.toThrow(
      /window closed during plugin wait/,
    );

    clock.mockRestore();
  });
});

describe(`ObsidianLauncher.handleTrustDialog fast path (${REQ})`, () => {
  const callHandle = (launcher: ObsidianLauncher): Promise<void> =>
    (
      launcher as unknown as { handleTrustDialog: () => Promise<void> }
    ).handleTrustDialog();

  it(`clicks a dialog that is already visible and waits for it to hide ${REQ}`, async () => {
    const trustButton: FakeTrustButton = {
      isVisible: jest.fn().mockResolvedValue(true),
      click: jest.fn().mockResolvedValue(undefined),
    };
    const launcher = new ObsidianLauncher("/tmp/does-not-matter");
    const fakeWindow = makeWindow(jest.fn(), trustButton);
    (launcher as unknown as { window: FakeWindow }).window = fakeWindow;
    const log = jest.spyOn(console, "log").mockImplementation(() => {});

    await callHandle(launcher);

    expect(trustButton.click).toHaveBeenCalledTimes(1);
    expect(fakeWindow.waitForSelector).toHaveBeenCalledWith(
      'button:has-text("Trust author and enable plugins")',
      expect.objectContaining({ state: "hidden", timeout: 5000 }),
    );
    expect(
      log.mock.calls.some((c) =>
        String(c[0]).includes("Trust dialog handled successfully"),
      ),
    ).toBe(true);
    log.mockRestore();
  });

  it(`clicks nothing when the dialog is not on screen ${REQ}`, async () => {
    const trustButton: FakeTrustButton = {
      isVisible: jest.fn().mockResolvedValue(false),
      click: jest.fn(),
    };
    const launcher = new ObsidianLauncher("/tmp/does-not-matter");
    const fakeWindow = makeWindow(jest.fn(), trustButton);
    (launcher as unknown as { window: FakeWindow }).window = fakeWindow;
    const log = jest.spyOn(console, "log").mockImplementation(() => {});

    await callHandle(launcher);

    expect(trustButton.click).not.toHaveBeenCalled();
    expect(fakeWindow.waitForSelector).not.toHaveBeenCalled();
    expect(
      log.mock.calls.some((c) =>
        String(c[0]).includes("Trust dialog not present"),
      ),
    ).toBe(true);
    log.mockRestore();
  });
});

/**
 * `close()` used to leave its 10 s "termination timeout" timer armed after the
 * Electron process had already terminated, so every red log carried
 * `Process N terminated` followed 10 s later by `Process N termination timeout
 * (continuing anyway)` — pure noise that reads as a race. The success path now
 * disarms the timer; the timeout path is kept for a process that will not die.
 */
describe(`ObsidianLauncher.close termination timer (${REQ})`, () => {
  const makeClosable = (): {
    launcher: ObsidianLauncher;
    kill: jest.Mock;
  } => {
    const launcher = new ObsidianLauncher("/tmp/does-not-matter");
    const kill = jest.fn();
    (
      launcher as unknown as {
        electronProcess: { pid: number; kill: jest.Mock };
      }
    ).electronProcess = { pid: 4242, kill };
    // Real close() would probe TCP :9222 (Docker CDP port); not a unit concern.
    (
      launcher as unknown as { waitForPortClosed: jest.Mock }
    ).waitForPortClosed = jest.fn().mockResolvedValue(undefined);
    return { launcher, kill };
  };

  const timeoutLogged = (log: jest.SpyInstance): boolean =>
    log.mock.calls.some((c) =>
      String(c[0]).includes("termination timeout (continuing anyway)"),
    );

  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    // (spies are restored by jest.config `restoreMocks: true`)
  });

  it(`does not log "termination timeout" once the process has terminated ${REQ}`, async () => {
    const { launcher, kill } = makeClosable();
    // process.kill(pid, 0) throwing = the process is gone.
    jest.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });
    const log = jest.spyOn(console, "log").mockImplementation(() => {});

    const closing = launcher.close();
    await jest.advanceTimersByTimeAsync(100); // first liveness check → gone
    await jest.advanceTimersByTimeAsync(1000); // trailing settle delay
    await expect(closing).resolves.toBeUndefined();
    expect(kill).toHaveBeenCalledWith("SIGKILL");
    expect(
      log.mock.calls.some((c) =>
        String(c[0]).includes("Process 4242 terminated"),
      ),
    ).toBe(true);

    // The old code's leftover timer fired here.
    await jest.advanceTimersByTimeAsync(10_000);
    expect(timeoutLogged(log)).toBe(false);
  });

  it(`still gives up after 10 s when the process never terminates (control) ${REQ}`, async () => {
    const { launcher } = makeClosable();
    // process.kill(pid, 0) NOT throwing = still alive on every check.
    jest.spyOn(process, "kill").mockImplementation(() => true);
    const log = jest.spyOn(console, "log").mockImplementation(() => {});

    const closing = launcher.close();
    await jest.advanceTimersByTimeAsync(9_900);
    expect(timeoutLogged(log)).toBe(false);
    await jest.advanceTimersByTimeAsync(100); // 10 s → timeout path
    await jest.advanceTimersByTimeAsync(1000); // trailing settle delay
    await expect(closing).resolves.toBeUndefined();
    expect(timeoutLogged(log)).toBe(true);
  });
});

/**
 * Guards req dad111a2 (ticket 81977587, LOW-3 of the #4249 review): `launch()`
 * does NOT retry a launch its caller has abandoned.
 *
 * `launch()` retries `launchAttempt` up to 3 times with a 2 s × attempt
 * backoff on ANY failure. When a spec's `beforeAll` overflows its 60 s budget
 * mid-attempt, Playwright runs `afterAll` → `close()` while the attempt is
 * still waiting; the attempt then fails (the explicit "window closed during
 * plugin wait" error of #4249, or the older `TypeError … null` forms) and,
 * before the fix, took the ordinary retry path — `launchAttempt(N+1)` spawned
 * an Obsidian on CDP :9222 that nobody was waiting for. Reproduced on
 * e3d79024 with the C1 fixture: `launchAttempt` was called twice and
 * `launch()` resolved. The fix is a per-launch `abandoned` flag set by
 * `close()` while a launch is in flight and read by `launch()` after its
 * per-attempt cleanup and after the backoff pause; `launch()`'s own cleanup
 * goes through the private `teardown()`, never through `close()`.
 */
const REQ_ABANDON = "@req:dad111a2-d4b9-42e2-a1c7-2a9c0ea702ae";

describe(`ObsidianLauncher.launch() after its caller abandoned it (${REQ_ABANDON})`, () => {
  type LaunchInternals = {
    launchAttempt: (attempt: number) => Promise<void>;
    teardown: () => Promise<void>;
  };

  // Verbatim from waitForPluginReady — the error #4249 raises after close().
  const WINDOW_CLOSED =
    "[ObsidianLauncher] window closed during plugin wait (close() ran concurrently — the launch was abandoned by its caller)";

  const makeLaunchable = (): {
    launcher: ObsidianLauncher;
    launchAttempt: jest.SpyInstance;
    teardown: jest.SpyInstance;
    log: jest.SpyInstance;
  } => {
    const launcher = new ObsidianLauncher("/tmp/does-not-matter");
    const internals = launcher as unknown as LaunchInternals;
    // The real teardown probes TCP :9222 and sleeps 1 s; these axes are about
    // launch()'s DECISION, so the teardown is a counted no-op.
    const teardown = jest
      .spyOn(internals, "teardown")
      .mockResolvedValue(undefined);
    const launchAttempt = jest.spyOn(internals, "launchAttempt");
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    return { launcher, launchAttempt, teardown, log };
  };

  // afterAll → close() while the attempt is still waiting, then the attempt
  // fails with `error` — the production ordering (close() nulls the window,
  // the wait loop notices on its next poll).
  const abandonedAttempt =
    (launcher: ObsidianLauncher, error: Error) => async (): Promise<void> => {
      await launcher.close();
      throw error;
    };

  const abandonLogged = (log: jest.SpyInstance): boolean =>
    log.mock.calls.some((c) =>
      String(c[0]).includes("marking the launch abandoned"),
    );

  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it(`C1 close() during attempt 1 ⇒ one attempt, explicit abandonment error, no backoff armed ${REQ_ABANDON}`, async () => {
    const { launcher, launchAttempt, teardown } = makeLaunchable();
    launchAttempt
      .mockImplementationOnce(
        abandonedAttempt(launcher, new Error(WINDOW_CLOSED)),
      )
      .mockResolvedValue(undefined);

    const launching = launcher.launch();
    launching.catch(() => {});
    await jest.advanceTimersByTimeAsync(0); // drain microtasks, no timer fires

    // Discriminator vs the pre-fix loop: it armed the 2 s backoff timer here.
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(20_000);
    expect(launchAttempt).toHaveBeenCalledTimes(1);
    await expect(launching).rejects.toThrow(
      /abandoned by its caller \(close\(\) ran while it was in flight\) — not retrying/,
    );
    // The caller's close() and launch()'s own cleanup both tore down.
    expect(teardown).toHaveBeenCalledTimes(2);
  });

  it(`C7 the un-named TypeError form (window-wait / vault-wait after close()) is not retried either ${REQ_ABANDON}`, async () => {
    // Breadth control: abandonment is a fact about the caller, not about the
    // error text — the older loops fail with a TypeError, not with #4249's
    // explicit message.
    const { launcher, launchAttempt } = makeLaunchable();
    launchAttempt
      .mockImplementationOnce(
        abandonedAttempt(
          launcher,
          new TypeError("Cannot read properties of null (reading 'evaluate')"),
        ),
      )
      .mockResolvedValue(undefined);

    const launching = launcher.launch();
    launching.catch(() => {});
    await jest.advanceTimersByTimeAsync(0);

    expect(jest.getTimerCount()).toBe(0); // no backoff armed
    await jest.advanceTimersByTimeAsync(20_000);
    expect(launchAttempt).toHaveBeenCalledTimes(1);
    await expect(launching).rejects.toThrow(
      /abandoned by its caller \(close\(\) ran while it was in flight\) — not retrying/,
    );
  });

  it(`C2 an ordinary failure is still retried after the 2 s backoff (pair, behaviour unchanged) ${REQ_ABANDON}`, async () => {
    const { launcher, launchAttempt, teardown } = makeLaunchable();
    launchAttempt
      .mockRejectedValueOnce(new Error("Obsidian not found at /nope"))
      .mockResolvedValue(undefined);

    const launching = launcher.launch();
    await jest.advanceTimersByTimeAsync(0);
    expect(launchAttempt).toHaveBeenCalledTimes(1);
    expect(teardown).toHaveBeenCalledTimes(1); // own cleanup, nobody closed

    await jest.advanceTimersByTimeAsync(1_999); // still inside the backoff
    expect(launchAttempt).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1); // 2 s × attempt 1 elapsed

    await expect(launching).resolves.toBeUndefined();
    expect(launchAttempt).toHaveBeenCalledTimes(2);
    expect(launchAttempt).toHaveBeenNthCalledWith(2, 2);
  });

  it(`C4 close() during the backoff pause ⇒ no next attempt after the pause ${REQ_ABANDON}`, async () => {
    const { launcher, launchAttempt } = makeLaunchable();
    launchAttempt
      .mockRejectedValueOnce(new Error("Obsidian not found at /nope"))
      .mockResolvedValue(undefined);

    const launching = launcher.launch();
    launching.catch(() => {});
    await jest.advanceTimersByTimeAsync(1_000); // mid-backoff
    expect(launchAttempt).toHaveBeenCalledTimes(1);

    await launcher.close(); // afterAll lands during the pause
    await jest.advanceTimersByTimeAsync(20_000);

    expect(launchAttempt).toHaveBeenCalledTimes(1);
    await expect(launching).rejects.toThrow(
      /abandoned by its caller during the backoff after attempt 1/,
    );
  });

  it(`C5 a new launch() on the same instance after an abandoned one starts clean and retries normally ${REQ_ABANDON}`, async () => {
    const { launcher, launchAttempt } = makeLaunchable();
    launchAttempt
      // launch №1: abandoned on attempt 1
      .mockImplementationOnce(
        abandonedAttempt(launcher, new Error(WINDOW_CLOSED)),
      )
      // launch №2: attempt 1 ordinary failure, attempt 2 succeeds
      .mockRejectedValueOnce(new Error("Obsidian not found at /nope"))
      .mockResolvedValue(undefined);

    const first = launcher.launch();
    first.catch(() => {});
    await jest.advanceTimersByTimeAsync(20_000);
    await expect(first).rejects.toThrow(/abandoned by its caller/);
    expect(launchAttempt).toHaveBeenCalledTimes(1);

    const second = launcher.launch();
    await jest.advanceTimersByTimeAsync(2_000);
    // A leaked flag would have turned the ordinary failure into an
    // "abandoned … not retrying" rejection here.
    await expect(second).resolves.toBeUndefined();
    expect(launchAttempt).toHaveBeenCalledTimes(3);
  });

  it(`C6 close() after a completed launch is the plain teardown — no "abandoned" marking (control) ${REQ_ABANDON}`, async () => {
    const { launcher, launchAttempt, teardown, log } = makeLaunchable();
    launchAttempt.mockResolvedValue(undefined);

    await launcher.launch();
    await launcher.close();

    expect(teardown).toHaveBeenCalledTimes(1);
    expect(abandonLogged(log)).toBe(false);
  });

  it(`C1b the in-flight close() does log the abandonment (the C6 control's positive half) ${REQ_ABANDON}`, async () => {
    const { launcher, launchAttempt, log } = makeLaunchable();
    launchAttempt
      .mockImplementationOnce(
        abandonedAttempt(launcher, new Error(WINDOW_CLOSED)),
      )
      .mockResolvedValue(undefined);

    const launching = launcher.launch();
    launching.catch(() => {});
    await jest.advanceTimersByTimeAsync(20_000);
    await launching.catch(() => {}); // outcome is C1's axis, not this one's

    expect(abandonLogged(log)).toBe(true);
  });
});
