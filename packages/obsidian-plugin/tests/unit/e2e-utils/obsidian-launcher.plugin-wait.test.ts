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
describe("ObsidianLauncher.waitForPluginReady", () => {
  const makeLauncher = (evaluate: jest.Mock): ObsidianLauncher => {
    const launcher = new ObsidianLauncher("/tmp/does-not-matter");
    // The method only touches `this.window.evaluate`; a fake window is enough and
    // keeps the test free of Playwright/Obsidian.
    (launcher as unknown as { window: { evaluate: jest.Mock } }).window = {
      evaluate,
    };
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
      .mockResolvedValueOnce({ loaded: true, enabled: ["dataview", "exocortex"] });

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
