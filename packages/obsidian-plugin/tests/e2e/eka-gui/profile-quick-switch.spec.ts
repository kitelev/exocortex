import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ObsidianLauncher } from "../utils/obsidian-launcher";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import {
  launchObsidianWithPlugin,
  log,
  pollUntil,
  setupGuiVault,
  waitForStoreSettled,
} from "./eka-gui-helpers";

/**
 * ============================================================================
 *  EKA GUI BDD — profile quick-switch indicator + ordering (req 38e2fdd5)
 * ============================================================================
 *
 * The VISUAL gate for the quick-switch affordance. Its unit tests
 * (`tests/unit/domain/profile/quickSwitch.test.ts`) prove the ordering
 * arithmetic and the indicator text against injected fakes; this spec proves
 * what a USER actually sees — a real status-bar item rendered by real Obsidian,
 * a real ribbon entry, and a real `ProfileFuzzyModal` whose first row came out
 * of the real `PluginLocalDataStore`.
 *
 * ---------------------------------------------------------------------------
 * WHY an e2e (and why in CI, never locally)
 * ---------------------------------------------------------------------------
 * Standing directive (Andrey, 2026-08-02): anything that needs VISUAL
 * verification gets an explicit E2E UI test with Docker, **run in CI** — local
 * Docker/QEMU runs OOM the machine (and, per
 * `rules/docker-qemu-e2e-multichild-panic.md`, can kernel-panic it).
 *
 * ---------------------------------------------------------------------------
 * WHAT makes this non-vacuous (the discriminators)
 * ---------------------------------------------------------------------------
 * 1. **Ordering.** The fixture seeds three profiles whose labels sort
 *    A < B < C, and writes `previousProfileUid` = the LAST one alphabetically
 *    into the device-local store. The picker must therefore open with C first —
 *    a regression that dropped the promotion would render the plain
 *    alphabetical A, B, C, which is asserted against explicitly. No magic
 *    numbers: the expectation is derived from the seeded UID, not from a
 *    hard-coded position.
 * 2. **Indicator.** `activeProfileUid` is seeded to the MIDDLE profile, so the
 *    status bar must name that one specifically — not merely "some non-empty
 *    text", and not the first or last row.
 * 3. **Two taps.** The picker is opened by CLICKING the status-bar item, not by
 *    invoking the command — that is the ≤2-tap claim, and it is the one thing a
 *    unit test with an injected `openSwitcher` cannot establish.
 *
 * Render-only: the picker is dismissed with Escape and nothing is applied, so
 * the ephemeral vault's mount state is never mutated
 * (`rules/gui-mutation-test-on-temp-vault.md`).
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS SPEC DOES *NOT* COVER (stated honestly)
 * ---------------------------------------------------------------------------
 * The mobile half of AC3. Obsidian's `addStatusBarItem` is documented "Not
 * available on mobile", which is exactly why the ribbon entry exists — but this
 * container runs desktop Obsidian, so the spec asserts the ribbon is REGISTERED
 * (the mobile affordance exists) without being able to assert how iOS chrome
 * renders it. That remains a manual confirmation.
 */

/** `exo__Profile` class UID — what `VaultProfileResolver.listProfileFiles` matches. */
const PROFILE_CLASS_UID = "3de846cd-1f0e-4f98-8613-b8587aa15174";

/** Stable fixture UIDs (`e2e0 5w17ch` ≈ "e2e switch"), distinct from other specs. */
const PROFILE_A_UID = "e2e05w17-0000-4000-a000-0000000000a1";
const PROFILE_B_UID = "e2e05w17-0000-4000-a000-0000000000b2";
const PROFILE_C_UID = "e2e05w17-0000-4000-a000-0000000000c3";

// Labels chosen so the plain alphabetical order is unambiguously A, B, C —
// that is the order a regression would render.
const PROFILE_A_LABEL = "E2E Switch A (first alphabetically)";
const PROFILE_B_LABEL = "E2E Switch B (seeded ACTIVE)";
const PROFILE_C_LABEL = "E2E Switch C (seeded PREVIOUS)";

const FIXTURE_DIR = "e2e-quick-switch";
const STATUS_BAR_SELECTOR = ".exocortex-profile-indicator";

function profileAsset(uid: string, label: string): string {
  return (
    `---\n` +
    `exo__Asset_uid: ${uid}\n` +
    `exo__Instance_class:\n  - "[[${PROFILE_CLASS_UID}]]"\n` +
    `exo__Asset_label: "${label}"\n` +
    `exo__Profile_includes: []\n` +
    `---\n\nEphemeral e2e profile. Recreated fresh every run.\n`
  );
}

/**
 * Seed three profiles plus the device-local switch state.
 *
 * `data.local.json` is the store `PluginLocalDataStore` reads at onload, so
 * writing it here is how the test says "you were in B, and before that you were
 * in C" without performing an actual mount switch (which would mutate the vault
 * and need git-backed AssetSpaces).
 */
function seedQuickSwitchFixture(vaultPath: string): void {
  const dir = path.join(vaultPath, FIXTURE_DIR);
  fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(
    path.join(dir, `${PROFILE_A_UID}.md`),
    profileAsset(PROFILE_A_UID, PROFILE_A_LABEL),
  );
  fs.writeFileSync(
    path.join(dir, `${PROFILE_B_UID}.md`),
    profileAsset(PROFILE_B_UID, PROFILE_B_LABEL),
  );
  fs.writeFileSync(
    path.join(dir, `${PROFILE_C_UID}.md`),
    profileAsset(PROFILE_C_UID, PROFILE_C_LABEL),
  );

  const pluginDir = path.join(vaultPath, ".obsidian", "plugins", "exocortex");
  fs.mkdirSync(pluginDir, { recursive: true });
  const localPath = path.join(pluginDir, "data.local.json");
  const existing: Record<string, unknown> = fs.existsSync(localPath)
    ? (JSON.parse(fs.readFileSync(localPath, "utf8")) as Record<
        string,
        unknown
      >)
    : {};
  existing["activeProfileUid"] = PROFILE_B_UID;
  existing["previousProfileUid"] = PROFILE_C_UID;
  existing["_switchInProgress"] = false;
  fs.writeFileSync(localPath, JSON.stringify(existing, null, 2));

  const git = (args: string[]): void => {
    execFileSync("git", args, {
      cwd: vaultPath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  };
  git(["add", "-A"]);
  git([
    "commit",
    "-q",
    "-m",
    "seed quick-switch fixture (3 profiles + local state)",
  ]);
  log(`quick-switch fixture seeded under ${FIXTURE_DIR}/`);
}

test.describe.configure({ mode: "default" });

test.describe("EKA GUI — profile quick-switch (req 38e2fdd5)", () => {
  let vaultPath = "";
  let launcher: ObsidianLauncher | null = null;
  let window: Page;

  test.beforeAll(async () => {
    test.setTimeout(600_000);
    vaultPath = setupGuiVault();
    seedQuickSwitchFixture(vaultPath);
    launcher = await launchObsidianWithPlugin(
      vaultPath,
      "eka-gui-quick-switch",
    );
    window = await launcher.getWindow();
    await waitForStoreSettled(window);
  });

  test.afterAll(async () => {
    if (launcher) await launcher.close().catch(() => undefined);
    if (vaultPath && fs.existsSync(vaultPath)) {
      fs.rmSync(vaultPath, { recursive: true, force: true });
      log(`cleaned up vault ${vaultPath}`);
    }
  });

  test("@req:38e2fdd5-8768-4354-8cb8-f1c77856ddb8 the status bar names the active context, one click opens the switcher, and the previous context is the first row", async () => {
    test.setTimeout(300_000);

    // ── AC1 — the indicator exists and names the ACTIVE profile ─────────────
    const statusBar = window.locator(STATUS_BAR_SELECTOR);
    await expect(
      statusBar,
      "the profile indicator must be registered in the status bar on desktop",
    ).toBeVisible({ timeout: 60_000 });

    // The label resolves asynchronously (the lister walks the vault), so poll
    // for the resolved name rather than asserting the initial placeholder.
    await pollUntil(
      "status bar resolves the active profile label",
      async () =>
        ((await statusBar.textContent()) ?? "").includes("E2E Switch"),
      120_000,
    );
    const indicatorText = (await statusBar.textContent()) ?? "";
    log(`status bar reads: ${indicatorText}`);

    // Specifically the seeded ACTIVE profile — not merely "some text", and not
    // one of the two others.
    expect(indicatorText).toContain(PROFILE_B_LABEL);
    expect(indicatorText).not.toContain(PROFILE_A_LABEL);
    expect(indicatorText).not.toContain(PROFILE_C_LABEL);

    // ── AC3 (desktop half) — the ribbon entry is registered ─────────────────
    // It is the ONLY affordance on mobile, where there is no status bar. This
    // container is desktop, so we can assert registration but not iOS chrome.
    const ribbonLabels: string[] = await window.evaluate(() =>
      Array.from(
        document.querySelectorAll(".side-dock-ribbon-action, .clickable-icon"),
      ).map((el) => el.getAttribute("aria-label") ?? ""),
    );
    expect(
      ribbonLabels.some((l) => l.includes("profile") || l.includes("Profile")),
      `a profile ribbon entry must be registered (the mobile affordance). Ribbon: ${JSON.stringify(ribbonLabels)}`,
    ).toBe(true);

    // ── AC2b — ONE click on the indicator opens the switcher ────────────────
    // Driving the click (not `executeCommandById`) is what makes this the
    // two-tap claim rather than a restatement of the palette command.
    await statusBar.click();
    await expect(
      window.locator(".exocortex-profile-suggestion").first(),
      "clicking the indicator must open the profile switcher",
    ).toBeVisible({ timeout: 60_000 });

    // ── AC2 — the profile you came FROM is the first row ────────────────────
    const rowLabels: string[] = await window.evaluate(() =>
      Array.from(
        document.querySelectorAll(".exocortex-profile-suggestion__label"),
      ).map((el) => el.textContent ?? ""),
    );
    log(`picker rows: ${JSON.stringify(rowLabels)}`);

    const seeded = rowLabels.filter((l) => l.includes("E2E Switch"));
    expect(
      seeded.length,
      `all three seeded profiles must be listed. Got: ${JSON.stringify(rowLabels)}`,
    ).toBe(3);

    // The discriminator: alphabetically C is LAST, so a dropped promotion would
    // render A, B, C. Promoted, it must be first.
    expect(
      seeded[0],
      `the previously-active profile must lead the picker (alphabetical order would put "${PROFILE_A_LABEL}" first)`,
    ).toContain(PROFILE_C_LABEL);
    // …and the rest keep their alphabetical order behind it.
    expect(seeded[1]).toContain(PROFILE_A_LABEL);
    expect(seeded[2]).toContain(PROFILE_B_LABEL);

    // Render-only: dismiss without applying — mount state is never mutated.
    await window.keyboard.press("Escape");
    await window
      .waitForSelector(".exocortex-profile-suggestion", {
        state: "hidden",
        timeout: 5_000,
      })
      .catch(() => undefined);
  });
});
