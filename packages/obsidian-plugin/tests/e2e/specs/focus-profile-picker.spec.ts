import { test, expect } from "@playwright/test";
import type { ConsoleMessage } from "@playwright/test";
import { ObsidianLauncher } from "../utils/obsidian-launcher";
import { waitForExocortexPluginViaPlaywright } from "../utils/waitForExocortexPlugin";
import * as path from "path";

/**
 * E2E render smoke for the «Exocortex: Switch focus profile» command
 * (`switch-focus-profile`, wired in `ExocortexPlugin.registerFocusProfileCommands`).
 *
 * Closes the CI coverage gap surfaced during RFC v10 (exo-as-SDK) Phase 3.5
 * closure — the picker was covered ONLY by unit tests
 * (`FocusProfileSwitchManager.*`, `FocusProfileCommands.test.ts`); no e2e
 * exercised it against a real Obsidian runtime. Tracking issue #3434.
 *
 * What this asserts (deliberately NON-vacuous — see below):
 *   1. The plugin loads and the `switch-focus-profile` command is registered.
 *   2. Executing the command opens the `ProfileFuzzyModal`
 *      (`FuzzySuggestModal`) and renders the **fixture FocusProfile assets by
 *      label** — i.e. NOT the «No FocusProfile assets found in vault» empty
 *      state.
 *   3. No `console.error` and no `pageerror` (uncaught exception) fire across
 *      load + picker open (empirically clean — local Docker run reports
 *      `loadPhaseConsoleErrors=0`).
 *
 * Why this is NOT vacuous (contrast with `create-fleeting-note-palette.spec.ts`):
 *   That sibling spec is intentionally lenient («plugin loads without
 *   throwing») because `ExocmdCommandPaletteRegistrar` resolves commands via
 *   SPARQL, which expects the expanded `exocmd:Command` IRI while the test
 *   vault uses symbolic `[[exocmd__Command]]` class wikilinks — a
 *   fixture-resolution gap. The FocusProfile picker has NO such gap:
 *   `VaultProfileResolver.listFocusProfileFiles` discovers profiles by a plain
 *   substring match on the raw `exo__Instance_class` frontmatter string
 *   (`instanceClassContains` → `c.includes(FOCUS_PROFILE_CLASS_UID)`), reading
 *   straight from `metadataCache` — no triple-store IRI expansion. The
 *   fixtures therefore carry the class in UUID form
 *   (`[[3de846cd-1f0e-4f98-8613-b8587aa15174]]`) and the picker list is
 *   asserted strictly by label.
 *
 * Fixtures (added in this PR):
 *   - `focus-profiles/5326e715-…md` — "E2E Focus Profile Base"
 *   - `focus-profiles/cb6a3c63-…md` — "E2E Focus Profile Work" (imports base)
 *
 * Revert-verify (documented in the PR body): removing the fixtures (or
 * downgrading their class wikilink to symbolic form) makes `profileLister`
 * return `[]`, so `invokeSwitchProfile` early-returns with the
 * «No FocusProfile assets found» Notice and NEVER opens the modal — the
 * `.suggestion-item` assertion then times out and this spec FAILS.
 */

const FOCUS_PROFILE_CLASS_UID = "3de846cd-1f0e-4f98-8613-b8587aa15174";
const SWITCH_FOCUS_PROFILE_COMMAND_ID = "exocortex:switch-focus-profile";
const FIXTURE_LABELS = [
  "E2E Focus Profile Base",
  "E2E Focus Profile Work",
];

test.describe("Focus profile picker — render smoke", () => {
  let launcher: ObsidianLauncher;
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  test.beforeAll(async () => {
    const vaultPath = path.join(__dirname, "../test-vault");
    launcher = new ObsidianLauncher(vaultPath);
    await launcher.launch();

    // Attach error listeners as early as the page exists (immediately after
    // launch). Captures the post-load idle, the command trigger, and the
    // modal-open phase. A boot crash would have prevented `launch()` from
    // resolving (plugin / app would be absent), so load-phase fatal errors are
    // additionally guarded by the plugin-loaded + command-registered asserts.
    const window = await launcher.getWindow();
    window.on("console", (msg: ConsoleMessage) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    window.on("pageerror", (err: Error) => {
      pageErrors.push(err.message);
    });
  });

  test.afterAll(async () => {
    if (launcher) {
      await launcher.close();
    }
  });

  test("switch-focus-profile opens picker rendering fixture profiles", async () => {
    const window = await launcher.getWindow();

    // Drain any leftover startup notices before probing (mirrors the sibling
    // flake-mitigation in vault-commands-smoke / create-fleeting-note-palette).
    await launcher.waitForModalsToClose(10000);

    // Plugin must be loaded before its commands are registered.
    await waitForExocortexPluginViaPlaywright(window, {
      specName: "focus-profile-picker",
    });

    // The command is registered only after `registerFocusProfileCommands()`
    // runs during onload. Poll for it so the spec does not race the boot
    // pipeline. A missing command id here means a load-time regression.
    await expect
      .poll(
        async () =>
          window.evaluate((id) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const app = (window as any).app;
            const commands = app?.commands?.commands ?? {};
            return Object.prototype.hasOwnProperty.call(commands, id);
          }, SWITCH_FOCUS_PROFILE_COMMAND_ID),
        {
          timeout: 30000,
          message: `command ${SWITCH_FOCUS_PROFILE_COMMAND_ID} not registered`,
        },
      )
      .toBe(true);

    // Poll until metadataCache has the FocusProfile fixtures indexed the same
    // way `VaultProfileResolver.instanceClassContains` discovers them — a
    // substring match on the raw `exo__Instance_class` string. This makes the
    // command trigger deterministic (Docker Obsidian populates the cache
    // asynchronously after file load). Asserting >= 2 here proves the fixtures
    // are discoverable BEFORE we open the picker.
    await expect
      .poll(
        async () =>
          window.evaluate((classUid) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const app = (window as any).app;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const files = app?.vault?.getMarkdownFiles?.() ?? [];
            let count = 0;
            for (const file of files) {
              const cache = app.metadataCache.getFileCache(file);
              const raw = cache?.frontmatter?.["exo__Instance_class"];
              const classes = Array.isArray(raw) ? raw : raw ? [raw] : [];
              if (
                classes.some(
                  (c: unknown) =>
                    typeof c === "string" && c.includes(classUid),
                )
              ) {
                count++;
              }
            }
            return count;
          }, FOCUS_PROFILE_CLASS_UID),
        {
          timeout: 30000,
          message: "FocusProfile fixtures not discoverable in metadataCache",
        },
      )
      .toBeGreaterThanOrEqual(2);

    // Record the load-phase console-error count (everything captured between
    // launch and the command trigger) for the diagnostic log below. The hard
    // assertion further down covers the WHOLE session (load + open).
    const loadPhaseConsoleErrors = consoleErrors.length;

    // Trigger the command. The callback is fire-and-forget (`void
    // invokeSwitchProfile()`): it lists profiles then opens ProfileFuzzyModal.
    await window.evaluate((id) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const app = (window as any).app;
      app.commands.executeCommandById(id);
    }, SWITCH_FOCUS_PROFILE_COMMAND_ID);

    // The FuzzySuggestModal renders suggestions as `.suggestion-item` rows.
    // If the picker had hit the empty-state path, no modal (and no suggestion
    // items) would ever appear and this would time out → non-vacuous gate.
    const suggestionItems = window.locator(".suggestion-item");
    await expect(suggestionItems.first()).toBeVisible({ timeout: 15000 });

    const itemTexts = await suggestionItems.allTextContents();
    const joined = itemTexts.join(" | ");

    // STRICT, non-vacuous assertions: both fixture profiles render by label.
    for (const label of FIXTURE_LABELS) {
      expect(
        itemTexts.some((t) => t.includes(label)),
        `picker must render profile "${label}". Rendered items: [${joined}]`,
      ).toBe(true);
    }

    // The empty-state Notice text must never be a rendered suggestion.
    expect(joined).not.toContain("No FocusProfile assets found");

    // The picker placeholder confirms this is the focus-profile modal
    // (set via ProfileFuzzyModal → setPlaceholder("Switch focus profile")).
    const placeholder = await window
      .locator(".prompt-input")
      .first()
      .getAttribute("placeholder");
    expect(placeholder).toBe("Switch focus profile");

    // Zero console errors AND zero uncaught exceptions across load + open.
    expect(
      consoleErrors,
      `console errors during load + picker open: ${JSON.stringify(consoleErrors)}`,
    ).toEqual([]);
    expect(
      pageErrors,
      `pageerrors during load + picker open: ${JSON.stringify(pageErrors)}`,
    ).toEqual([]);

    // Diagnostic: surface the load-phase console-error count (subset of the
    // assertion above) so the CI/revert-verify run shows the split.
    // eslint-disable-next-line no-console
    console.log(
      `[focus-profile-picker smoke] loadPhaseConsoleErrors=${loadPhaseConsoleErrors} items=${JSON.stringify(itemTexts)}`,
    );

    // Render-only smoke — dismiss without selecting (no soft switch → no
    // test-vault mutation, keeps the fixture-drift reporter quiet).
    await window.keyboard.press("Escape");
    await window
      .waitForSelector(".suggestion-item", { state: "hidden", timeout: 5000 })
      .catch(() => {});
  });
});
