import { test, expect, type Page } from "@playwright/test";
import { ObsidianLauncher } from "../utils/obsidian-launcher";
import * as path from "path";

/**
 * E2E smoke tests for vault commands rendering in Obsidian.
 *
 * Validates:
 * 1. Task note renders vault command buttons (status buttons visible)
 * 2. Current status button is hidden (precondition filtering)
 * 3. Click status button changes status
 * 4. ExoQL code block renders table output
 * 5. Active file's frontmatter parses and is reachable through the loaded plugin
 *
 * Test vault fixtures (status transition commands):
 * - 03 Knowledge/commands/pre-status-is-backlog.md (Precondition: status == Backlog)
 * - 03 Knowledge/commands/pre-status-is-doing.md   (Precondition: status == Doing)
 * - 03 Knowledge/commands/gnd-set-status-doing.md   (Grounding: set status to Doing)
 * - 03 Knowledge/commands/gnd-set-status-done.md    (Grounding: set status to Done)
 * - 03 Knowledge/commands/cmd-set-status-doing.md   (Command: Start)
 * - 03 Knowledge/commands/cmd-set-status-done.md    (Command: Complete)
 * - 03 Knowledge/commands/bind-status-doing-for-tasks.md (Binding: Start → ems__Task)
 * - 03 Knowledge/commands/bind-status-done-for-tasks.md  (Binding: Complete → ems__Task)
 * - Tasks/dynamic-cmd-test-without-ts.md (Task with status Backlog)
 * - Tasks/dynamic-cmd-test-with-ts.md    (Task with status Doing)
 */
test.describe.configure({ mode: "parallel" });

test.describe("Vault Commands Smoke Tests", () => {
  let launcher: ObsidianLauncher;

  test.beforeAll(async () => {
    const vaultPath = path.join(__dirname, "../test-vault");
    launcher = new ObsidianLauncher(vaultPath);
    await launcher.launch();
  });

  test.afterAll(async () => {
    if (launcher) {
      await launcher.close();
    }
  });

  test("should render vault command buttons on a Task note", async () => {
    await launcher.openFile("Tasks/dynamic-cmd-test-without-ts.md");
    const window = await launcher.getWindow();

    await launcher.waitForModalsToClose(10000);

    // Wait for the layout to render (plugin loaded signal)
    await launcher.waitForElement(".exocortex-layout-rendered", 30000);

    // Wait for metadataCache to have ANY frontmatter for the active file.
    // Obsidian may not have finished indexing immediately after file-open.
    await expect.poll(async () => {
      return window.evaluate(() => {
        const app = (window as any).app;
        const file = app?.workspace?.getActiveFile();
        if (!file) return null;
        const cache = app.metadataCache.getFileCache(file);
        return cache?.frontmatter ? JSON.stringify(Object.keys(cache.frontmatter)) : null;
      });
    }, { timeout: 15000, message: "metadataCache frontmatter not populated" }).not.toBeNull();

    // Diagnose: check what DynamicCommandButtonGroupBuilder sees
    const diag = await window.evaluate(async () => {
      const app = (window as any).app;
      const plugin = app?.plugins?.plugins?.exocortex;
      if (!plugin) return { error: "no plugin" };

      const file = app.workspace.getActiveFile();
      if (!file) return { error: "no active file" };

      const cache = app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter;
      const uid = fm?.exo__Asset_uid;
      const cls = fm?.exo__Instance_class;

      let resolvedCount = -1;
      try {
        const cmds = await plugin.commandResolver?.resolveForAsset(
          uid ?? file.path, Array.isArray(cls) ? cls[0]?.replace(/["'[\]]/g, "").trim() : cls, undefined
        );
        resolvedCount = cmds?.length ?? 0;
      } catch (e: any) { resolvedCount = -2; }

      plugin?.commandResolver?.invalidateCache();

      // Diagnose autoRenderLayout blockers via activeLeaf (avoid require("obsidian"))
      const view = app.workspace.activeLeaf?.view;
      const viewMode = view?.getMode?.() ?? "no-view";
      const hasMetadataContainer = !!view?.containerEl?.querySelector(".metadata-container");
      const layoutVisible = plugin?.settings?.layoutVisible ?? "undefined";
      const hasLayoutRenderer = !!plugin?.layoutRenderer;

      plugin?.refreshLayout?.();

      // Check DOM after refresh
      const hasButtonsSection = !!document.querySelector(".exocortex-buttons-section");
      const hasAutoLayout = !!document.querySelector(".exocortex-auto-layout");
      const hasLayoutRendered = !!document.querySelector(".exocortex-layout-rendered");

      return {
        uid, cls: JSON.stringify(cls), resolvedCount,
        fmKeys: Object.keys(fm || {}),
        viewMode, hasMetadataContainer, layoutVisible,
        hasLayoutRenderer, hasButtonsSection, hasAutoLayout, hasLayoutRendered,
      };
    });

    // Assert buttons section visible — include diagnostics in error message
    const buttonsSection = window.locator(".exocortex-buttons-section");
    await expect(
      buttonsSection,
      `Buttons section must be visible. DIAG: ${JSON.stringify(diag)}`,
    ).toBeVisible({ timeout: 20000 });

    const actionContainer = window.locator(
      ".exocortex-buttons-section .exocortex-action-buttons-container",
    );
    await expect(actionContainer).toBeVisible({ timeout: 5000 });

    const buttons = window.locator(
      ".exocortex-buttons-section .exocortex-action-button",
    );
    const buttonCount = await buttons.count();
    expect(buttonCount).toBeGreaterThan(0);
  });

  test("should hide current status button via precondition filtering", async () => {
    // Task with status Backlog should NOT show "Complete" (precondition: status==Doing)
    // Also "Remove Start Timestamp" should NOT appear (task has no startTimestamp)
    await launcher.openFile("Tasks/dynamic-cmd-test-without-ts.md");
    const window = await launcher.getWindow();

    await launcher.waitForModalsToClose(10000);
    await launcher.waitForElement(".exocortex-layout-rendered", 30000);

    // Wait for metadataCache frontmatter to populate (#2693)
    await expect.poll(async () => {
      return window.evaluate(() => {
        const app = (window as any).app;
        const file = app?.workspace?.getActiveFile();
        if (!file) return null;
        const cache = app.metadataCache.getFileCache(file);
        return cache?.frontmatter ? JSON.stringify(Object.keys(cache.frontmatter)) : null;
      });
    }, { timeout: 15000 }).not.toBeNull();

    // Force re-render with populated triple store + metadataCache
    await window.evaluate(() => {
      const plugin = (window as any).app?.plugins?.plugins?.exocortex;
      plugin?.commandResolver?.invalidateCache?.();
      plugin?.refreshLayout?.();
    });

    const buttonsSection = window.locator(".exocortex-buttons-section");
    await expect(buttonsSection).toBeVisible({ timeout: 20000 });

    const buttonLabels = await window
      .locator(".exocortex-buttons-section .exocortex-action-button")
      .allTextContents();

    // "Remove Start Timestamp" must NOT appear (task has no startTimestamp)
    expect(buttonLabels).not.toContain("Remove Start Timestamp");

    // "Complete" must NOT appear (precondition: status==Doing, task is Backlog)
    expect(buttonLabels).not.toContain("Complete");
  });

  test("should show different commands based on task status", async () => {
    // Task with status Doing should NOT show "Start"
    // (precondition: status==Backlog fails for a Doing task)
    await launcher.openFile("Tasks/dynamic-cmd-test-with-ts.md");
    const window = await launcher.getWindow();

    await launcher.waitForModalsToClose(10000);
    await launcher.waitForElement(".exocortex-layout-rendered", 30000);

    // Wait for metadataCache frontmatter to populate (#2693)
    await expect.poll(async () => {
      return window.evaluate(() => {
        const app = (window as any).app;
        const file = app?.workspace?.getActiveFile();
        if (!file) return null;
        const cache = app.metadataCache.getFileCache(file);
        return cache?.frontmatter ? JSON.stringify(Object.keys(cache.frontmatter)) : null;
      });
    }, { timeout: 15000 }).not.toBeNull();

    // Force re-render with populated triple store + metadataCache
    await window.evaluate(() => {
      const plugin = (window as any).app?.plugins?.plugins?.exocortex;
      plugin?.commandResolver?.invalidateCache?.();
      plugin?.refreshLayout?.();
    });

    const buttonsSection = window.locator(".exocortex-buttons-section");
    await expect(buttonsSection).toBeVisible({ timeout: 20000 });

    const buttonLabels = await window
      .locator(".exocortex-buttons-section .exocortex-action-button")
      .allTextContents();

    // "Start" must NOT appear (precondition: status==Backlog, task is Doing)
    expect(buttonLabels).not.toContain("Start");
  });

  // Issue #2699 resolved: grounding does update the file on disk,
  // but app.metadataCache lags behind disk writes in Docker Obsidian.
  // Reading vault file directly via app.vault.read() bypasses the cache.
  test("should change status when clicking status button", async () => {
    // Use the Backlog task - click "Start" to transition to Doing
    await launcher.openFile("Tasks/dynamic-cmd-test-without-ts.md");
    const window = await launcher.getWindow();

    await launcher.waitForModalsToClose(10000);
    await launcher.waitForElement(".exocortex-layout-rendered", 30000);

    // Wait for metadataCache frontmatter (#2693)
    await expect.poll(async () => {
      return window.evaluate(() => {
        const app = (window as any).app;
        const file = app?.workspace?.getActiveFile();
        if (!file) return null;
        const cache = app.metadataCache.getFileCache(file);
        return cache?.frontmatter ? JSON.stringify(Object.keys(cache.frontmatter)) : null;
      });
    }, { timeout: 15000 }).not.toBeNull();

    // Force re-render with populated triple store
    await window.evaluate(() => {
      const plugin = (window as any).app?.plugins?.plugins?.exocortex;
      plugin?.commandResolver?.invalidateCache?.();
      plugin?.refreshLayout?.();
    });

    const buttonsSection = window.locator(".exocortex-buttons-section");
    await expect(buttonsSection).toBeVisible({ timeout: 20000 });

    const startButton = window.locator(
      '.exocortex-buttons-section .exocortex-action-button:has-text("Start")',
    );
    await expect(startButton).toBeVisible({ timeout: 10000 });

    // Click Start
    await startButton.click();

    // Poll vault file contents directly — grounding writes to disk,
    // metadataCache may lag behind in Docker. Reading vault bypasses the cache.
    await expect.poll(async () => {
      return window.evaluate(async () => {
        const app = (window as any).app;
        const activeFile = app.workspace.getActiveFile();
        if (!activeFile) return null;
        // vault.read() reads from disk (bypasses metadataCache)
        return await app.vault.read(activeFile);
      });
    }, { timeout: 15000 }).toContain("Doing");
  });

  /**
   * req 9e19f141 — Layer-3 smoke: the property editor's schema provider is fed
   * by the DECLARED-property resolver (`createTripleStoreClassPropertyResolver`,
   * req 07509cf9), not by the four-entry `FALLBACK_PROPERTIES`.
   *
   * ⛤ This test REPLACES the body ticket afb25c43 renamed. The old name read
   * `should load property editor schemas from resolver` while the body only read
   * the active file's frontmatter and asserted success/hasPlugin/instanceClass/
   * hasMetadata — green with the provider working, broken, or ABSENT. The name
   * was what a reader grepped to answer "is the property editor smoke-covered?",
   * so it asserted a guarantee the body did not carry
   * (decision-surface-must-derive-from-mechanism). The rename made the name
   * honest; this body makes the guarantee real.
   *
   * ⛤ Driven through the USER path (`exocortex:edit-properties` → modal → DOM),
   * NOT through a bridge on the plugin object: `getPropertySchemaForClass` is a
   * MODULE function of `PropertySchemas.ts`, and the resolver is installed by
   * `PropertyEditorModal.initSchemaResolver()` — it exists only while that modal
   * is open. Exposing it on the plugin would be an `src` change made for a test.
   *
   * ⛤ The vault carries a TBox seed under `03 Knowledge/tbox/`: six
   * `exo__Property` definitions whose `exo__Property_domain` is `[[ems__Task]]`.
   * Without it the provider would honestly return the fallback and every
   * assertion here would be vacuous — measured 2026-09-22 on this tree, the
   * vault held ZERO `exo__Property_domain` files against a canary of 95 files
   * mentioning `ems__Task`. The seed's domains are FLATTENED onto `ems__Task`
   * (live TBox declares them across the Task → Effort → Asset chain): the vault
   * has no class assets for that chain, and seeding it would widen the blast
   * radius for every other spec sharing this vault. Two ranges are `xsd:` even
   * though the live chain declares zero datatype ranges — they are what makes
   * the range→field-type mapping OBSERVABLE as a field kind rather than only as
   * a picker option.
   *
   * ⛤ The composition is read from TWO surfaces because that is what a human
   * sees: an object-range property (`assetRef` → `wikilink`) is NOT rendered as
   * a field once the Relations section is active — `PropertyEditorForm` filters
   * `type === "wikilink"` out of the editable fields and
   * `PropertyEditorModal.buildRelationsDeps` turns exactly those keys into the
   * create-row predicate options.
   *
   * DISCRIMINATOR — why this cannot be green on the fallback: the fallback
   * yields TWO editable fields (`exo__Asset_label` text + `exo__Asset_archived`
   * boolean, the other two entries being read-only) and ZERO wikilink keys, so
   * `predicateOptions` is empty and the `relation-create` block is not rendered
   * at all. Neither the `timestamp`/`number` field kinds nor any predicate
   * option can appear without the provider.
   */
  const SEEDED_FIELD_KEYS = [
    "exo__Asset_label",
    "ems__Effort_plannedStartTimestamp",
    "ems__Effort_votes",
  ];
  const SEEDED_PREDICATE_KEYS = [
    "ems__Effort_area",
    "ems__Effort_status",
    "ems__Task_size",
  ];

  interface EditorComposition {
    fields: { key: string; kind: string }[];
    options: string[];
  }

  /**
   * Open the property editor through the command palette entry and read the
   * composition the user sees. Re-openable on purpose: the schema is resolved in
   * a `useEffect` against the live triple store, so an open that lands while the
   * store is still filling answers from the fallback. The caller polls.
   */
  async function openEditorAndReadComposition(
    window: Page,
  ): Promise<EditorComposition> {
    // Close whatever is open, then force a full re-index so this open resolves
    // against the most complete store the metadataCache can back (the same
    // discipline `waitForCreateCommandsResolvable` uses in the eka-gui suite).
    await window.keyboard.press("Escape");
    await window.evaluate(async () => {
      const plugin = (window as any).app?.plugins?.plugins?.exocortex;
      try {
        await plugin?.sparql?.refresh?.();
      } catch {
        /* transient mid-refresh — the caller polls */
      }
      plugin?.lazyAssetGraphLoader?.clearAll?.();
      (window as any).app.commands.executeCommandById(
        "exocortex:edit-properties",
      );
    });

    await window
      .locator(".property-editor-modal .property-editor-field")
      .first()
      .waitFor({ state: "visible", timeout: 20000 });

    return window.evaluate(() => {
      const root = document.querySelector(".property-editor-modal");
      if (!root) return { fields: [], options: [] };
      const fields = Array.from(
        root.querySelectorAll(".property-editor-field"),
      ).map((el) => ({
        key: (el.querySelector(".property-editor-label")?.textContent ?? "")
          .replace("*", "")
          .trim(),
        kind: /property-editor-([a-z]+)-field/.exec(el.className)?.[1] ?? "?",
      }));
      const options = Array.from(
        root.querySelectorAll(
          '[data-testid="relation-predicate-select"] option',
        ),
      ).map((o) => o.getAttribute("value") ?? "");
      return { fields, options };
    });
  }

  test("should feed the property editor from the DECLARED-property provider, not the fallback @req:9e19f141-13f5-451c-abb8-34e24ff0e9d3", async () => {
    // Re-opening the modal against a still-filling store is the expected path on
    // a cold container, so this test budgets for several attempts.
    test.setTimeout(180000);

    await launcher.openFile("Tasks/dynamic-cmd-test-without-ts.md");
    const window = await launcher.getWindow();

    await launcher.waitForModalsToClose(10000);
    await launcher.waitForElement(".exocortex-layout-rendered", 30000);

    // CANARY — the seed must be discoverable at all. A zero here would make
    // every assertion below a statement about an empty vault, not about the
    // provider.
    await expect
      .poll(
        async () =>
          window.evaluate(() => {
            const app = (window as any).app;
            return app.vault
              .getMarkdownFiles()
              .filter((f: any) => {
                const fm = app.metadataCache.getFileCache(f)?.frontmatter;
                return fm?.["exo__Property_domain"] !== undefined;
              }).length;
          }),
        {
          timeout: 60000,
          message: "TBox seed (exo__Property_domain) not visible in metadataCache",
        },
      )
      .toBeGreaterThanOrEqual(
        SEEDED_FIELD_KEYS.length + SEEDED_PREDICATE_KEYS.length,
      );

    let composition: EditorComposition = { fields: [], options: [] };
    const seeded = [...SEEDED_FIELD_KEYS, ...SEEDED_PREDICATE_KEYS];

    await expect
      .poll(
        async () => {
          // An open that lands before the modal renders throws out of
          // `waitFor`. Playwright's poll does NOT catch a throw from the
          // generator, so one such attempt would abort the whole 150s poll
          // instead of retrying — report "nothing matched" and let it retry.
          try {
            composition = await openEditorAndReadComposition(window);
          } catch {
            composition = { fields: [], options: [] };
            return seeded.length;
          }
          const seen = new Set<string>([
            ...composition.fields.map((f) => f.key),
            ...composition.options,
          ]);
          const missing = seeded.filter((k) => !seen.has(k)).length;
          // ⛤ The keys alone are a WEAKER gate than the assertions below, and
          // the gap is a real window rather than a theoretical one: the form
          // starts on `getPropertySchemaForClassSync` (the fallback) and, until
          // `buildRelationsDeps` resolves, renders the wikilink properties as
          // FIELDS. An open caught in that window shows all six keys with an
          // EMPTY picker — `missing` is 0, the poll exits, and the picker
          // assertion reds on a perfectly working provider. Waiting for the
          // picker too makes the poll gate on the same shape it asserts.
          return missing + (composition.options.length === 0 ? 1 : 0);
        },
        {
          timeout: 150000,
          intervals: [2000, 3000, 5000, 5000, 10000, 10000, 15000, 15000],
          message:
            "the property editor never showed the declared properties with a populated relations picker (it stayed on FALLBACK_PROPERTIES)",
        },
      )
      .toBe(0);

    const fieldKeys = composition.fields.map((f) => f.key);
    const fieldKinds = composition.fields.map((f) => f.kind);
    const rendered = `fields=${JSON.stringify(composition.fields)} options=${JSON.stringify(composition.options)}`;

    // 1. COMPOSITION — at least as many keys as the seed declares. Deliberately
    //    `>=` and against the SEED, not an absolute count: the number drifts
    //    with the TBox (integration-test-revert-verify §A53).
    expect(
      new Set([...fieldKeys, ...composition.options]).size,
      `composition must cover the seed. ${rendered}`,
    ).toBeGreaterThanOrEqual(seeded.length);

    // 2. BY NAME — the scalar keys are fields, the object-range keys are
    //    predicate options. `exo__Asset_label` is in the fallback too, so the
    //    discrimination is carried by the other five.
    for (const key of SEEDED_FIELD_KEYS) {
      expect(fieldKeys, `field "${key}" must be rendered. ${rendered}`).toContain(key);
    }
    for (const key of SEEDED_PREDICATE_KEYS) {
      expect(
        composition.options,
        `relation predicate "${key}" must be offered. ${rendered}`,
      ).toContain(key);
    }

    // 3. FIELD TYPE DERIVED FROM RANGE — `xsd:date` → timestamp, `xsd:integer`
    //    → number. The fallback renders only text + boolean (its timestamp entry
    //    is read-only and its boolean is `exo__Asset_archived`), so neither kind
    //    can appear without the provider.
    expect(fieldKinds, `a timestamp field must be rendered. ${rendered}`).toContain("timestamp");
    expect(fieldKinds, `a number field must be rendered. ${rendered}`).toContain("number");

    // 4. RELATIONS PICKER — the create-row block does not render at all when
    //    `predicateOptions` is empty, which is exactly the fallback's shape.
    expect(
      composition.options.length,
      `the relations predicate picker must be populated. ${rendered}`,
    ).toBeGreaterThan(0);
  });

  test("should verify all status command definition files exist in vault", async () => {
    const window = await launcher.getWindow();

    const result = await window.evaluate(async () => {
      const app = (window as any).app;
      const expectedFiles = [
        "03 Knowledge/commands/pre-status-is-backlog.md",
        "03 Knowledge/commands/pre-status-is-doing.md",
        "03 Knowledge/commands/gnd-set-status-doing.md",
        "03 Knowledge/commands/gnd-set-status-done.md",
        "03 Knowledge/commands/cmd-set-status-doing.md",
        "03 Knowledge/commands/cmd-set-status-done.md",
        "03 Knowledge/commands/bind-status-doing-for-tasks.md",
        "03 Knowledge/commands/bind-status-done-for-tasks.md",
      ];

      const results: { path: string; exists: boolean; hasClass: boolean; uid: string | null }[] = [];

      for (const filePath of expectedFiles) {
        const file = app.vault.getAbstractFileByPath(filePath);
        if (!file) {
          results.push({ path: filePath, exists: false, hasClass: false, uid: null });
          continue;
        }

        const metadata = app.metadataCache.getFileCache(file);
        const frontmatter = metadata?.frontmatter;
        const hasClass = !!frontmatter?.exo__Instance_class;
        const uid = frontmatter?.exo__Asset_uid ?? null;

        results.push({ path: filePath, exists: true, hasClass, uid });
      }

      return {
        success: true,
        files: results,
        allExist: results.every((r) => r.exists),
        allHaveClass: results.every((r) => r.hasClass),
        allHaveUid: results.every((r) => r.uid !== null),
      };
    });

    expect(result.success).toBe(true);
    expect(result.allExist).toBe(true);
    expect(result.allHaveClass).toBe(true);
    expect(result.allHaveUid).toBe(true);
  });
});
