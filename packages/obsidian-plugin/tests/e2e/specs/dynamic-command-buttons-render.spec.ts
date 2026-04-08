import { test, expect } from "@playwright/test";
import { ObsidianLauncher } from "../utils/obsidian-launcher";
import * as path from "path";
import * as fs from "fs";

/**
 * E2E test for dynamic command button rendering AND functionality (RFC-009 §5.5).
 *
 * Validates the FULL pipeline:
 *   Vault command files → TripleStore → CommandResolver → PreconditionEvaluator
 *   → DynamicCommandButtonGroupBuilder → ActionButtonsGroup → DOM → click
 *   → window.confirm → GroundingExecutor → frontmatter update → Notice → re-render
 *
 * Issue #2666
 *
 * Vault fixtures (Issue #2435):
 * - 03 Knowledge/commands/cmd-remove-start-timestamp.md  (Command)
 * - 03 Knowledge/commands/pre-has-start-timestamp.md     (Precondition: SPARQL ASK)
 * - 03 Knowledge/commands/gnd-remove-start-timestamp.md  (Grounding: property_delete)
 * - 03 Knowledge/commands/bind-remove-start-for-tasks.md (Binding: ems__Task)
 * - Tasks/dynamic-cmd-test-with-ts.md    (WITH startTimestamp)
 * - Tasks/dynamic-cmd-test-without-ts.md (WITHOUT startTimestamp)
 */
const FIXTURE_PATH = path.join(
  __dirname, "../test-vault/Tasks/dynamic-cmd-test-with-ts.md"
);

test.describe("Dynamic Command Button Rendering & Functionality", () => {
  let launcher: ObsidianLauncher;
  let fixtureOriginal: string;

  test.beforeEach(async () => {
    fixtureOriginal = fs.readFileSync(FIXTURE_PATH, "utf-8");
    const vaultPath = path.join(__dirname, "../test-vault");
    launcher = new ObsidianLauncher(vaultPath);
    await launcher.launch();
    await launcher.waitForModalsToClose(10000);
  });

  test.afterEach(async () => {
    await launcher.close();
    fs.writeFileSync(FIXTURE_PATH, fixtureOriginal, "utf-8");
  });

  // FIXME(#2673): SPARQL query engine intermittently fails in Docker CI.
  // Timing fix (onLayoutReady) is in place but Docker SPARQL init is flaky.
  // Works in shard 1 but fails in shard 2 on retry. Needs Docker-level fix.
  test.fixme("renders button from RDF config and executes grounding on click", async () => {
    const page = await launcher.getWindow();

    // ── Step 1: Wait for plugin + force triple store init + diagnostics ──

    const diag = await page.evaluate(async () => {
      const app = (window as any).app;
      for (let i = 0; i < 20; i++) {
        if (app?.plugins?.plugins?.exocortex) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      const plugin = app?.plugins?.plugins?.exocortex;
      if (!plugin) return { error: "plugin not loaded" };

      const hasSparql = !!plugin.sparql;
      const hasResolver = !!plugin.commandResolver;
      const hasGrounding = !!plugin.groundingExecutor;

      let tripleStoreSize = -1;
      let initError: string | null = null;
      let queryResult: string | null = null;

      // Try to force-initialize SPARQL via internal queryService
      try {
        const qs = (plugin.sparql as any)?.queryService;
        if (qs && !qs.isInitialized) {
          await qs.initialize();
          initError = "OK";
        } else if (qs?.isInitialized) {
          initError = "already initialized";
        } else {
          initError = "no queryService found";
        }
      } catch (e: any) {
        initError = `INIT ERROR: ${e.message} | cause: ${e.details?.originalError ?? "none"} | STACK: ${(e.stack || "").substring(0, 400)}`;
      }

      // Try direct triple store access (match() is async!)
      let tsInfo: any = null;
      try {
        const ts = plugin.sparql?.getTripleStore?.();
        const matchAll = await ts?.match?.(undefined, undefined, undefined);
        const allTriples = Array.isArray(matchAll) ? matchAll : [];
        tripleStoreSize = allTriples.length;
        const bindingTriples = allTriples.filter((t: any) =>
          String(t?.object?.value ?? "").includes("CommandBinding") ||
          String(t?.predicate?.value ?? "").includes("CommandBinding")
        );
        const rdfTypeTriples = allTriples.filter((t: any) =>
          String(t?.predicate?.value ?? "").includes("rdf-syntax-ns#type") ||
          String(t?.predicate?.value ?? "").includes("/type")
        );
        const exocmdTriples = allTriples.filter((t: any) =>
          String(t?.predicate?.value ?? "").includes("exocmd") ||
          String(t?.object?.value ?? "").includes("exocmd")
        );
        const cmdBindingType = rdfTypeTriples.filter((t: any) =>
          String(t?.object?.value ?? "").includes("CommandBinding")
        );
        const allRdfTypes = rdfTypeTriples.map((t: any) => String(t?.object?.value ?? "").split("#").pop()).filter(Boolean);
        tsInfo = {
          total: allTriples.length,
          bindings: bindingTriples.length,
          rdfTypeCount: rdfTypeTriples.length,
          cmdBindingTypeCount: cmdBindingType.length,
          allRdfTypeClasses: [...new Set(allRdfTypes)],
          cmdBindingSample: cmdBindingType.slice(0, 2).map((t: any) => `s=${t?.subject?.value?.slice(-40)} o=${t?.object?.value}`),
          exocmdCount: exocmdTriples.length,
        };
      } catch (e: any) {
        tsInfo = `TS ERROR: ${e.message}`;
      }

      // Try simplest query
      try {
        const sparql = plugin.sparql;
        if (sparql?.query) {
          const r = await sparql.query("ASK { ?s ?p ?o }");
          queryResult = JSON.stringify(r);
        }
      } catch (e: any) {
        queryResult = `QUERY ERROR: ${e.message}`;
      }


      let resolverResult: string | null = null;
      try {
        if (plugin.commandResolver?.resolveForAsset) {
          const cmds = await plugin.commandResolver.resolveForAsset(
            "e2e-task-with-start-timestamp", "ems__Task", undefined
          );
          resolverResult = `found ${cmds.length} commands: ${cmds.map((c: any) => c.command?.name).join(", ")}`;
        }
      } catch (e: any) {
        resolverResult = `ERROR: ${e.message}`;
      }

      const allButtons = document.querySelectorAll("button");
      const exoButtons = document.querySelectorAll(".exocortex-action-button");

      return {
        hasSparql, hasResolver, hasGrounding,
        tripleStoreSize, initError, tsInfo, queryResult, resolverResult,
        allButtonsCount: allButtons.length,
        exoButtonsCount: exoButtons.length,
      };
    });

    console.log("[DIAG] Step 1 results:", JSON.stringify(diag, null, 2));

    // ── Step 2: Open task WITH startTimestamp → button MUST appear ──

    await launcher.openFile("Tasks/dynamic-cmd-test-with-ts.md");

    await expect.poll(async () => {
      return page.evaluate(() => {
        const app = (window as any).app;
        return app?.workspace?.getActiveFile()?.name ?? "";
      });
    }, { timeout: 10000 }).toBe("dynamic-cmd-test-with-ts.md");

    await page
      .locator(".exocortex-buttons-section, .exocortex-action-buttons-container")
      .first()
      .waitFor({ state: "visible", timeout: 20000 })
      .catch(() => {
        // Timeout is expected if no buttons section renders for this file type
      });

    const removeTimestampButton = page.locator(
      'button.exocortex-action-button:has-text("Remove Start Timestamp")'
    );

    await expect(
      removeTimestampButton,
      'Button "Remove Start Timestamp" must render for task WITH startTimestamp.'
    ).toBeVisible({ timeout: 15000 });

    await expect(
      page.locator('.exocortex-button-group-title:has-text("Commands")'),
      'Button must be in "Commands" group (from DynamicCommandButtonGroupBuilder)'
    ).toBeVisible({ timeout: 5000 });

    // ── Step 3: Open task WITHOUT startTimestamp → button must NOT appear ──

    await launcher.openFile("Tasks/dynamic-cmd-test-without-ts.md");

    await expect.poll(async () => {
      return page.evaluate(() => {
        const app = (window as any).app;
        return app?.workspace?.getActiveFile()?.name ?? "";
      });
    }, { timeout: 10000 }).toBe("dynamic-cmd-test-without-ts.md");

    await page
      .locator(".exocortex-buttons-section, .exocortex-action-buttons-container")
      .first()
      .waitFor({ state: "visible", timeout: 10000 })
      .catch(() => {
        // Timeout is expected if no buttons section renders for this file type
      });

    await expect(
      page.locator('button:has-text("Remove Start Timestamp")'),
      'Button must NOT render when precondition (SPARQL ASK for startTimestamp) returns false.'
    ).not.toBeVisible({ timeout: 10000 });

    // ── Step 4: Functionality — click button, confirm, verify action ──

    await launcher.openFile("Tasks/dynamic-cmd-test-with-ts.md");

    await expect.poll(async () => {
      return page.evaluate(() => {
        const app = (window as any).app;
        return app?.workspace?.getActiveFile()?.name ?? "";
      });
    }, { timeout: 10000 }).toBe("dynamic-cmd-test-with-ts.md");

    const buttonForClick = page.locator(
      'button.exocortex-action-button:has-text("Remove Start Timestamp")'
    );
    await expect(buttonForClick).toBeVisible({ timeout: 15000 });

    // Verify startTimestamp exists BEFORE click
    const hasTsBefore = await page.evaluate(() => {
      const app = (window as any).app;
      const file = app?.workspace?.getActiveFile();
      if (!file) return false;
      const cache = app.metadataCache.getFileCache(file);
      return !!cache?.frontmatter?.ems__Effort_startTimestamp;
    });
    expect(hasTsBefore, "Task must have startTimestamp before click").toBe(true);

    // Set up dialog handler BEFORE clicking — window.confirm() is used
    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("confirm");
      expect(dialog.message()).toContain("Remove start timestamp");
      await dialog.accept();
    });

    // Click the dynamic command button
    await buttonForClick.click();

    // Wait for grounding execution + refresh cycle
    // GroundingExecutor removes ems__Effort_startTimestamp, then refresh() re-renders layout
    await expect.poll(async () => {
      return page.evaluate(() => {
        const app = (window as any).app;
        const file = app?.workspace?.getActiveFile();
        if (!file) return true; // conservative — don't fail on missing file
        const cache = app.metadataCache.getFileCache(file);
        return !!cache?.frontmatter?.ems__Effort_startTimestamp;
      });
    }, {
      timeout: 15000,
      message: "ems__Effort_startTimestamp should be removed from frontmatter after grounding",
    }).toBe(false);

    // Button must disappear after action — precondition no longer met
    await expect(
      page.locator('button:has-text("Remove Start Timestamp")'),
      "Button must disappear after startTimestamp removed (precondition fails on re-render)"
    ).not.toBeVisible({ timeout: 10000 });
  });
});
