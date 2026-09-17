import type { Page } from "@playwright/test";
import { ObsidianLauncher } from "./obsidian-launcher";
import { waitForExocortexPluginViaPlaywright } from "./waitForExocortexPlugin";

// ---------------------------------------------------------------------------
//  Plugin-load with relaunch-retry (QEMU-emulation flake on Apple Silicon)
//
//  ⛤ ONE implementation (ticket 4abffc07, req d6c2acd4). This loop used to live
//  twice — in eka-gui-helpers.ts and as a local copy in eka-obsidian-leg.spec.ts
//  — and both had the same orphan class: every attempt built a FRESH
//  ObsidianLauncher that only this function held, so a spec's afterAll
//  (`if (launcher) await launcher.close()`, launcher still null) had nothing to
//  abandon while an attempt was in flight, and the loop kept spawning Obsidian
//  on :9222 for a caller that had already left. The AbortSignal below is what
//  afterAll now pulls.
// ---------------------------------------------------------------------------
const MAX_LAUNCH_ATTEMPTS = 8;
const PLUGIN_LOAD_WAIT_MS = 60_000;

export type LaunchLog = (msg: string) => void;

export interface LaunchWithPluginOptions {
  /**
   * Abort = the caller walked away (afterAll, test timeout). The in-flight
   * launcher is closed at once — which cancels its port wait and stops its own
   * retries (reqs d6c2acd4 / dad111a2) — and no further attempt is started.
   * Once a launcher has been RETURNED the helper no longer listens: the caller
   * owns that launcher and closes it itself.
   */
  signal?: AbortSignal;
  /** Spec-prefixed logger (every caller has one; the helper itself owns no console). */
  log: LaunchLog;
}

/** The slice of Obsidian's plugin manager the load probe reads (browser side). */
type PluginManagerLike = {
  manifests?: Record<string, unknown>;
  plugins?: Record<string, unknown>;
  enabledPlugins?: string[] | { has?: (id: string) => boolean };
  disablePlugin?: (id: string) => Promise<void>;
  enablePlugin?: (id: string) => Promise<void>;
};
type ObsidianWindowLike = { app?: { plugins?: PluginManagerLike } };

/**
 * Try to bring the exocortex plugin to `loaded` in the current Obsidian window.
 * Under QEMU-emulated amd64 the onload is both slower AND non-deterministic —
 * occasionally a launch leaves the plugin `enabled` but never runs onload. We
 * force a fresh load (disable → enable; a plain enable on an already-enabled
 * plugin is a no-op and can't recover that state) and wait. Returns whether the
 * plugin reached `loaded` within the ceiling (caller relaunches on false).
 */
async function tryLoadPlugin(
  window: Page,
  label: string,
  timeoutMs: number,
  log: LaunchLog,
): Promise<boolean> {
  const diag = await window.evaluate(() => {
    const pm = (window as unknown as ObsidianWindowLike).app?.plugins;
    const enabledPlugins = pm?.enabledPlugins;
    return {
      hasManifest: !!pm?.manifests?.exocortex,
      // Kept from the eka-obsidian-leg copy: distinguishes "enabled but onload
      // never ran" from "not enabled at all" in the relaunch log.
      enabled: Array.isArray(enabledPlugins)
        ? enabledPlugins.includes("exocortex")
        : (enabledPlugins?.has?.("exocortex") ?? null),
      loaded: !!pm?.plugins?.exocortex,
    };
  });
  log(`[${label}] plugin state: ${JSON.stringify(diag)}`);
  if (!diag.loaded) {
    const r = await window.evaluate(async () => {
      const pm = (window as unknown as ObsidianWindowLike).app?.plugins;
      try {
        if (pm?.plugins?.exocortex) return "already loaded";
        await pm?.disablePlugin?.("exocortex").catch(() => undefined);
        await pm?.enablePlugin?.("exocortex");
        return "force-reloaded (disable→enable)";
      } catch (e) {
        return `reload error: ${String(e)}`;
      }
    });
    log(`[${label}] ${r}`);
  }
  try {
    await waitForExocortexPluginViaPlaywright(window, {
      specName: label,
      timeoutMs,
    });
    return true;
  } catch {
    return false;
  }
}

const abandonedError = (label: string, attempt: number): Error =>
  new Error(
    `${label}: launch abandoned by its caller (abort signal) after attempt ${attempt} — not relaunching`,
  );

/**
 * Launch Obsidian on `vaultPath` and ensure the plugin loads, retrying the WHOLE
 * launch (close + fresh Electron) up to {@link MAX_LAUNCH_ATTEMPTS} times. The
 * plugin-load flake is per-launch under QEMU-emulated amd64, so a relaunch
 * almost always recovers it. Returns the live launcher (caller owns close);
 * throws if every attempt fails, or as soon as `opts.signal` is aborted.
 */
export async function launchObsidianWithPlugin(
  vaultPath: string,
  label: string,
  opts: LaunchWithPluginOptions,
): Promise<ObsidianLauncher> {
  const { signal, log } = opts;
  let lastErr = "";
  for (let attempt = 1; attempt <= MAX_LAUNCH_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw abandonedError(label, attempt - 1);
    const launcher = new ObsidianLauncher(vaultPath);
    // The caller's abort reaches the attempt that is running RIGHT NOW: close()
    // cancels the launcher's in-flight wait and marks its launch abandoned, and
    // it also tears down a window the plugin-load wait may be evaluating on.
    const onAbort = (): void => {
      log(
        `${label}: abort signalled during attempt ${attempt} — closing the in-flight launcher`,
      );
      void launcher.close().catch(() => undefined);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      log(`${label}: launch attempt ${attempt}/${MAX_LAUNCH_ATTEMPTS}`);
      await launcher.launch();
      const window = await launcher.getWindow();
      await launcher.waitForModalsToClose(10_000);
      if (await tryLoadPlugin(window, label, PLUGIN_LOAD_WAIT_MS, log)) {
        return launcher;
      }
      lastErr = `plugin did not reach loaded within ${PLUGIN_LOAD_WAIT_MS / 1000}s`;
    } catch (e) {
      lastErr = String(e);
      log(`${label}: launch attempt ${attempt} errored: ${lastErr}`);
    } finally {
      // Either the launcher is being returned (the caller owns it from here) or
      // this attempt is over; in both cases a later abort must not close it
      // through this listener again.
      signal?.removeEventListener("abort", onAbort);
    }
    if (signal?.aborted) throw abandonedError(label, attempt);
    log(`${label}: attempt ${attempt} failed (${lastErr}) — relaunching…`);
    await launcher.close().catch(() => undefined);
  }
  throw new Error(
    `${label}: Obsidian + plugin failed to load after ${MAX_LAUNCH_ATTEMPTS} attempts (${lastErr})`,
  );
}
