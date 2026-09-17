// The helper module imports the launcher (which imports @playwright/test at
// module scope) and the plugin wait. Both are replaced: the launcher by a
// counting fake with a controllable launch(), the plugin wait by a scripted
// promise. Nothing here touches Playwright or Obsidian.
jest.mock("@playwright/test", () => ({ chromium: {} }));

type FakeLauncher = {
  vaultPath: string;
  launch: () => Promise<void>;
  close: jest.Mock;
  getWindow: () => Promise<unknown>;
  waitForModalsToClose: () => Promise<void>;
  resolveLaunch: () => void;
  rejectLaunch: (e: Error) => void;
};
// Every ObsidianLauncher the helper constructs, in order — attempt N+1 is a
// second entry here.
let instances: FakeLauncher[] = [];

jest.mock("../../e2e/utils/obsidian-launcher", () => ({
  ObsidianLauncher: class {
    vaultPath: string;
    resolveLaunch: () => void = () => undefined;
    rejectLaunch: (e: Error) => void = () => undefined;
    close: jest.Mock;
    constructor(vaultPath: string) {
      this.vaultPath = vaultPath;
      // The real close() on an in-flight launch cancels its wait, so launch()
      // rejects with the abandonment — mirrored here so the helper's own
      // reaction to that rejection is what the axes measure.
      this.close = jest.fn(async () => {
        this.rejectLaunch(new Error("launch abandoned by its caller (fake)"));
      });
      instances.push(this as unknown as FakeLauncher);
    }
    launch(): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        this.resolveLaunch = resolve;
        this.rejectLaunch = reject;
      });
    }
    getWindow(): Promise<unknown> {
      return Promise.resolve({
        evaluate: async () => ({ hasManifest: true, loaded: true }),
      });
    }
    waitForModalsToClose(): Promise<void> {
      return Promise.resolve();
    }
  },
}));

let pluginWait: () => Promise<number> = () => Promise.resolve(1);
jest.mock("../../e2e/utils/waitForExocortexPlugin", () => ({
  waitForExocortexPluginViaPlaywright: () => pluginWait(),
}));

import * as fs from "fs";
import * as path from "path";
import { launchObsidianWithPlugin } from "../../e2e/utils/launch-obsidian-with-plugin";

/**
 * Guards ticket 4abffc07 (LOW-2 of the #4252 review): `launchObsidianWithPlugin`
 * is ONE helper and it is abandonable.
 *
 * BEFORE: two copies (eka-gui-helpers.ts, a local one in eka-obsidian-leg.spec.ts)
 * looped up to 8 times with a FRESH `new ObsidianLauncher(vaultPath)` per
 * attempt. A spec's `launcher` variable is null until the helper returns, so
 * its `afterAll` (`if (launcher) await launcher.close()`) had nothing to close
 * while an attempt was in flight. Reproduced on 6c89b6b3: after the simulated
 * afterAll and one failed attempt, a second launcher existed that nobody held
 * — and the loop would have gone on to 8.
 *
 * AFTER: `launchObsidianWithPlugin(vaultPath, label, { signal })` — on abort the
 * helper closes the in-flight launcher (which cancels its wait and stops its
 * retries, reqs d6c2acd4 / dad111a2) and starts no further attempt; once a
 * launcher is returned the helper stops listening (the caller owns it).
 * Without a signal the loop is unchanged.
 *
 * Mutant matrix (driver `mutants-4abffc07.py`, round 2 2026-09-17, copied from its
 * output; CONTROL plugin-unit=37 failed=0):
 *   M3a helper: no signal.aborted checks (loop relaunches after an abort) → RED: ['A3', 'A3b', 'A3d']
 *   M3b helper: abort does not close the in-flight launcher             → RED: ['A3', 'A3b']
 *   M3c helper: abort listener not removed once a launcher is returned  → RED: ['A3e']
 *   M0 semantic revert M1+M2+M3a+M3b+M4+M6 → RED: ['A1', 'A1d', 'A1e', 'A2', 'A3', 'A3b', 'A3d']
 *   (A3c / A3f / A4 / A4b / A4c stay GREEN under every mutant)
 */
const REQ = "@req:d6c2acd4-6993-4b3b-8305-dcf5b1ba6d8f";

/** Settlement probe: the FACT the axes wait for, instead of a number of ticks. */
const settle = (p: Promise<unknown>) => {
  const s = {
    state: "pending" as "pending" | "resolved" | "rejected",
    error: undefined as unknown,
    value: undefined as unknown,
  };
  p.then(
    (v) => {
      s.state = "resolved";
      s.value = v;
    },
    (e) => {
      s.state = "rejected";
      s.error = e;
    },
  );
  return s;
};

const drain = async (): Promise<void> => {
  // Enough microtask turns for the helper's await chain to advance.
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

describe(`launchObsidianWithPlugin is abandonable through its AbortSignal (${REQ})`, () => {
  let log: jest.Mock;

  beforeEach(() => {
    instances = [];
    pluginWait = () => Promise.resolve(1);
    log = jest.fn();
  });

  it(`A3 abort while attempt 1's launch() is in flight ⇒ that launcher is closed at once, the helper rejects as abandoned, no attempt 2 ${REQ}`, async () => {
    const abort = new AbortController();
    const probe = settle(
      launchObsidianWithPlugin("/tmp/vault", "a3", {
        signal: abort.signal,
        log,
      }),
    );
    await drain();
    expect(instances).toHaveLength(1);
    expect(probe.state).toBe("pending");

    abort.abort();
    // The FACT: the in-flight launcher was told to close by the abort itself —
    // before its launch() has failed, before any timer.
    expect(instances[0].close).toHaveBeenCalledTimes(1);
    await drain();

    expect(probe.state).toBe("rejected");
    expect(String(probe.error)).toMatch(
      /a3: launch abandoned by its caller \(abort signal\) after attempt 1 — not relaunching/,
    );
    // Discriminator vs the pre-fix loop: it constructed launcher 2 here.
    expect(instances).toHaveLength(1);
    // The fake's close() already failed the launch; the helper must not close
    // the same launcher a second time on its way out.
    expect(instances[0].close).toHaveBeenCalledTimes(1);
  });

  it(`A3b abort while the plugin-load wait is pending (launch() already returned) ⇒ same: closed, abandoned, no attempt 2 ${REQ}`, async () => {
    let failPluginWait: (e: Error) => void = () => undefined;
    pluginWait = () =>
      new Promise<number>((_resolve, reject) => {
        failPluginWait = reject;
      });
    const abort = new AbortController();
    const probe = settle(
      launchObsidianWithPlugin("/tmp/vault", "a3b", {
        signal: abort.signal,
        log,
      }),
    );
    await drain();
    instances[0].resolveLaunch();
    await drain();
    expect(probe.state).toBe("pending"); // inside tryLoadPlugin → plugin wait

    abort.abort();
    expect(instances[0].close).toHaveBeenCalledTimes(1);
    // In production close() tears the window down and the wait fails on it.
    failPluginWait(
      new Error("Target page, context or browser has been closed"),
    );
    await drain();

    expect(probe.state).toBe("rejected");
    expect(String(probe.error)).toMatch(/a3b: launch abandoned by its caller/);
    expect(instances).toHaveLength(1);
  });

  it(`A3c without a signal an ordinary failure is still retried — launcher 1 closed, launcher 2 returned (control) ${REQ}`, async () => {
    const probe = settle(
      launchObsidianWithPlugin("/tmp/vault", "a3c", { log }),
    );
    await drain();
    expect(instances).toHaveLength(1);
    instances[0].rejectLaunch(
      new Error("window.app not available after 60 seconds"),
    );
    await drain();

    expect(instances).toHaveLength(2);
    expect(instances[0].close).toHaveBeenCalledTimes(1);
    instances[1].resolveLaunch();
    await drain();

    expect(probe.state).toBe("resolved");
    expect(probe.value).toBe(instances[1]);
    expect(instances[1].close).not.toHaveBeenCalled();
  });

  it(`A3d an already-aborted signal starts nothing (control) ${REQ}`, async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(
      launchObsidianWithPlugin("/tmp/vault", "a3d", {
        signal: abort.signal,
        log,
      }),
    ).rejects.toThrow(
      /a3d: launch abandoned by its caller \(abort signal\) after attempt 0/,
    );
    expect(instances).toHaveLength(0);
  });

  it(`A3e after a launcher was returned, a later abort (the spec's afterAll) does not close it through the helper ${REQ}`, async () => {
    const abort = new AbortController();
    const probe = settle(
      launchObsidianWithPlugin("/tmp/vault", "a3e", {
        signal: abort.signal,
        log,
      }),
    );
    await drain();
    instances[0].resolveLaunch();
    await drain();
    expect(probe.state).toBe("resolved");
    expect(probe.value).toBe(instances[0]);

    abort.abort();
    await drain();
    // The caller owns the returned launcher and closes it itself; a second
    // close() from a stale listener would race that teardown.
    expect(instances[0].close).not.toHaveBeenCalled();
  });

  it(`A3f every attempt fails ⇒ gives up after 8 fresh launchers, each closed (control, budget unchanged) ${REQ}`, async () => {
    const probe = settle(
      launchObsidianWithPlugin("/tmp/vault", "a3f", { log }),
    );
    for (let i = 0; i < 8; i++) {
      await drain();
      expect(instances).toHaveLength(i + 1);
      instances[i].rejectLaunch(new Error(`attempt ${i + 1} died`));
    }
    await drain();
    expect(probe.state).toBe("rejected");
    expect(String(probe.error)).toMatch(
      /a3f: Obsidian \+ plugin failed to load after 8 attempts \(Error: attempt 8 died\)/,
    );
    expect(instances).toHaveLength(8);
    expect(instances.every((l) => l.close.mock.calls.length === 1)).toBe(true);
  });
});

describe(`launchObsidianWithPlugin has exactly one implementation (${REQ})`, () => {
  const e2e = path.resolve(__dirname, "../../e2e");
  const read = (rel: string): string =>
    fs.readFileSync(path.join(e2e, rel), "utf8");

  it(`A4 eka-gui-helpers.ts only wraps the shared helper — no retry loop, no tryLoadPlugin, no attempt budget of its own ${REQ}`, () => {
    const src = read("eka-gui/eka-gui-helpers.ts");
    expect(src).toMatch(/from "\.\.\/utils\/launch-obsidian-with-plugin"/);
    expect(src).toMatch(/launchObsidianWithPluginShared\(/);
    expect(src).not.toMatch(/new ObsidianLauncher\(/);
    expect(src).not.toMatch(/function tryLoadPlugin\(/);
    expect(src).not.toMatch(/MAX_LAUNCH_ATTEMPTS\s*=/);
    expect(src).not.toMatch(/PLUGIN_LOAD_WAIT_MS\s*=/);
  });

  it(`A4b eka-obsidian-leg.spec.ts imports the shared helper — no local copy ${REQ}`, () => {
    const src = read("eka/eka-obsidian-leg.spec.ts");
    expect(src).toMatch(/from "\.\.\/utils\/launch-obsidian-with-plugin"/);
    expect(src).not.toMatch(/function launchObsidianWithPlugin\(/);
    expect(src).not.toMatch(/new ObsidianLauncher\(/);
    expect(src).not.toMatch(/function tryLoadPlugin\(/);
    expect(src).not.toMatch(/MAX_LAUNCH_ATTEMPTS\s*=/);
    expect(src).not.toMatch(/PLUGIN_LOAD_WAIT_MS\s*=/);
  });

  it(`A4c every consumer spec passes an abort signal and aborts it first in afterAll ${REQ}`, () => {
    const consumers = [
      "eka-gui/cold-cache-symbolic-class-iri.spec.ts",
      "eka-gui/cold-isdefinedby-precondition.spec.ts",
      "eka-gui/create-instance-buttons.spec.ts",
      "eka-gui/index-cost-visibility.spec.ts",
      "eka-gui/parked-link-placeholder.spec.ts",
      "eka-gui/profile-quick-switch.spec.ts",
      "eka/eka-obsidian-leg.spec.ts",
    ];
    for (const rel of consumers) {
      const src = read(rel);
      const calls = src.match(/launchObsidianWithPlugin\(/g) ?? [];
      const withSignal = src.match(/signal: launchAbort\.signal/g) ?? [];
      // every call site carries the signal (the import line is not a call)
      expect({
        rel,
        calls: calls.length,
        withSignal: withSignal.length,
      }).toEqual({
        rel,
        calls: calls.length,
        withSignal: calls.length,
      });
      expect(src).toMatch(
        /test\.afterAll\(async \(\) => \{\s*launchAbort\.abort\(\);/,
      );
    }
  });
});
