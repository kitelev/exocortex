import { test, expect } from "@playwright/test";
import type { ConsoleMessage } from "@playwright/test";
import { ObsidianLauncher } from "../utils/obsidian-launcher";
import { waitForExocortexPluginViaPlaywright } from "../utils/waitForExocortexPlugin";
import * as path from "path";

/**
 * E2E render smoke for the «Exocortex: Apply profile» command
 * (`hard-switch-focus-profile`, wired in
 * `ExocortexPlugin.registerFocusProfileCommands`).
 *
 * RFC 0a0791c1 Phase 5 T2 consolidated the former soft «Switch focus profile»
 * (`switch-focus-profile`) + mount-state «Switch knowledge profile» commands
 * into the single «Apply profile» command. The command id is kept as the legacy
 * `hard-switch-focus-profile` (Obsidian persists hotkeys by id). This spec
 * exercises the picker render only (Escape without selecting), so the
 * destructive mount path never runs. Tracking issue #3434.
 *
 * What this asserts (deliberately NON-vacuous — see below):
 *   1. The plugin loads and the `hard-switch-focus-profile` command is registered.
 *   2. Executing the command opens the `ProfileFuzzyModal`
 *      (`FuzzySuggestModal`) and renders the **fixture profile assets by
 *      label** — i.e. NOT the «No profiles found in vault» empty state.
 *   3. No `pageerror` (uncaught exception) fires across load + picker open, and
 *      no `console.error` fires during the trigger → modal-open window (the
 *      focus-profile surface this spec owns). The load-phase `console.error`
 *      count is logged as a diagnostic (observed 0 in local Docker) but NOT
 *      hard-asserted — it would otherwise couple this spec to unrelated
 *      load-path catch branches (e.g. hard-switch / SHACL wiring), per
 *      code-reviewer MEDIUM. `create-fleeting-note-palette.spec.ts` omits the
 *      console check entirely for the same reason; here it is kept but scoped.
 *
 * Why this is NOT vacuous (contrast with `create-fleeting-note-palette.spec.ts`):
 *   That sibling spec is intentionally lenient («plugin loads without
 *   throwing») because `ExocmdCommandPaletteRegistrar` resolves commands via
 *   SPARQL, which expects the expanded `exocmd:Command` IRI while the test
 *   vault uses symbolic `[[exocmd__Command]]` class wikilinks — a
 *   fixture-resolution gap. The profile picker has NO such gap:
 *   `VaultProfileResolver.listFocusProfileFiles` discovers profiles by a plain
 *   substring match on the raw `exo__Instance_class` frontmatter string
 *   (`instanceClassContains` → `c.includes(PROFILE_CLASS_UID)`), reading
 *   straight from `metadataCache` — no triple-store IRI expansion. The
 *   fixtures therefore carry the class in UUID form
 *   (`[[3de846cd-1f0e-4f98-8613-b8587aa15174]]`) and the picker list is
 *   asserted strictly by label.
 *
 * Fixtures:
 *   - `focus-profiles/5326e715-…md` — "E2E Focus Profile Base"
 *   - `focus-profiles/cb6a3c63-…md` — "E2E Focus Profile Work" (imports base)
 *
 * Revert-verify (documented in the PR body): removing the fixtures (or
 * downgrading their class wikilink to symbolic form) makes `profileLister`
 * return `[]`, so `invokeSwitchKnowledgeProfile` early-returns with the
 * «No profiles found in vault» Notice and NEVER opens the modal — the
 * `.suggestion-item` assertion then times out and this spec FAILS.
 */

const PROFILE_CLASS_UID = "3de846cd-1f0e-4f98-8613-b8587aa15174";
const APPLY_PROFILE_COMMAND_ID = "exocortex:hard-switch-focus-profile";
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

  test("apply-profile opens picker rendering fixture profiles", async () => {
    // The in-test waits stack three 30s ceilings (plugin-wait,
    // command-registration poll, discoverability poll) plus a 10s modal-drain
    // and a 15s modal-visible wait (~115s worst case). Each resolves in <1s
    // normally, but shard-4 has documented slow plugin-load incidents
    // (Issue #3216) and the e2e config runs with retries: 0, so raise the
    // per-test ceiling above the 60s default to keep a slow plugin-load from
    // tripping a compounding-timeout flake (code-reviewer LOW).
    test.setTimeout(120000);

    const window = await launcher.getWindow();

    // Drain any leftover startup notices before probing (mirrors the sibling
    // flake-mitigation in vault-commands-smoke / create-fleeting-note-palette).
    await launcher.waitForModalsToClose(10000);

    // Plugin must be loaded before its commands are registered. Uses the
    // shared 30s default (PLUGIN_WAIT_TIMEOUT_MS_DEFAULT) — same budget all
    // sibling e2e specs rely on; CI P99 plugin-load is ~11s.
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
          }, APPLY_PROFILE_COMMAND_ID),
        {
          timeout: 30000,
          message: `command ${APPLY_PROFILE_COMMAND_ID} not registered`,
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
          }, PROFILE_CLASS_UID),
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
    // invokeSwitchKnowledgeProfile()`): it lists profiles then opens ProfileFuzzyModal.
    await window.evaluate((id) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const app = (window as any).app;
      app.commands.executeCommandById(id);
    }, APPLY_PROFILE_COMMAND_ID);

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
    expect(joined).not.toContain("No profiles found");

    // The picker placeholder confirms this is the focus-profile modal
    // (set via ProfileFuzzyModal → setPlaceholder("Apply profile")).
    const placeholder = await window
      .locator(".prompt-input")
      .first()
      .getAttribute("placeholder");
    expect(placeholder).toBe("Apply profile");

    // Zero console errors during the picker surface (trigger → modal open) —
    // scoped so unrelated load-path catch branches (hard-switch / SHACL wiring)
    // cannot red this spec (code-reviewer MEDIUM).
    const pickerConsoleErrors = consoleErrors.slice(loadPhaseConsoleErrors);
    expect(
      pickerConsoleErrors,
      `console errors during picker open: ${JSON.stringify(pickerConsoleErrors)}`,
    ).toEqual([]);
    // Zero uncaught exceptions across the WHOLE session (load + open) — a
    // pageerror is unambiguous and owned by no other subsystem.
    expect(
      pageErrors,
      `pageerrors during load + picker open: ${JSON.stringify(pageErrors)}`,
    ).toEqual([]);

    // Diagnostic: surface the load-phase console-error count (not hard-asserted
    // — see the file docstring). Observed 0 in local Docker.
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
