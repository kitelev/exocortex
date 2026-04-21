import { test, expect, Page } from "@playwright/test";
import { ObsidianLauncher } from "../utils/obsidian-launcher";
import * as path from "path";

/**
 * RFC-CI-Tests Phase 3 — L3 E2E smoke for starter-kit dynamic commands.
 *
 * Validates 7 representative commands (one per category + edge case)
 * end-to-end through real Obsidian (Docker) + plugin. Each test covers:
 * Click → grounding dispatch → file-on-disk mutation.
 *
 * Subset is regression-significant: 5/7 commands were dispatch-only stubs in
 * Phase 2 ServiceRegistry (CLI integration suite). Phase 3 validates the real
 * plugin implementations end-to-end.
 *
 * Performance pattern (RFC v5 §7.2 — meta hint applied):
 * - test.beforeAll(launcher.launch) + test.afterAll(launcher.close) — single
 *   Obsidian launch per worker, NOT per test. Existing 13 specs use the
 *   beforeEach antipattern (~30s × 13 = ~6.5min sunk cost).
 * - test.describe.configure({ mode: 'parallel' }) — Playwright distributes
 *   tests across workers; each worker shares one launcher.
 *
 * Fixture dependencies (wired by sibling task 025847de):
 * - test-vault/Tasks/smoke-<slug>.md — per-test task fixtures (one per command)
 * - test-vault/exocmd/<category>/<uuid>.md — 6 starter-kit Command + supporting
 *   Precondition/Grounding/Binding files. Physically resident under
 *   tests/e2e/test-vault/ because Dockerfile.e2e only COPYs that subtree.
 *
 * Test #7 (Set Zone to Today) is intentionally skipped: the UX RFC P0-2
 * rename has not merged yet (no command with this label exists in
 * starter-kit-fixtures as of 2026-04-20). Unskip after rename lands.
 */
test.describe.configure({ mode: "parallel" });

test.describe("Starter-kit smoke (RFC-CI-Tests Phase 3)", () => {
  let launcher: ObsidianLauncher;

  test.beforeAll(async () => {
    const vaultPath = path.join(__dirname, "../test-vault");
    launcher = new ObsidianLauncher(vaultPath);
    await launcher.launch();
  });

  test.afterAll(async () => {
    await launcher.close();
  });

  test("Create Child Task: creation, async service_call, no confirm", async () => {
    const fixturePath = "Tasks/smoke-create-child-task.md";
    await launcher.openFile(fixturePath);
    const window = await launcher.getWindow();

    await primeDynamicLayout(launcher, window);

    const button = window.locator(
      '.exocortex-buttons-section .exocortex-action-button:has-text("Create Child Task")',
    );
    await expect(button).toBeVisible({ timeout: 20000 });
    await button.click();

    await fillDynamicFormModal(window, { value: "Smoke child task" });

    // Scan ALL vault files for one whose exo__Asset_label contains our marker.
    // The grounding creates the child file at a path independent of alphabetical
    // ordering, so filter by label (intent) rather than by path (incidental).
    await expect
      .poll(
        async () => {
          return window.evaluate(async () => {
            const app = (window as any).app;
            const files = app.vault.getMarkdownFiles();
            for (const f of files) {
              const cache = app.metadataCache.getFileCache(f);
              const label = cache?.frontmatter?.exo__Asset_label;
              if (typeof label === "string" && label.includes("Smoke child task")) {
                return label;
              }
            }
            return null;
          });
        },
        { timeout: 20000, message: "Child Task file with label 'Smoke child task' not found" },
      )
      .toContain("Smoke child task");
  });

  test("Archive Completed: maintenance, confirm + destructive", async () => {
    const fixturePath = "Tasks/smoke-archive-completed.md";
    await launcher.openFile(fixturePath);
    const window = await launcher.getWindow();

    await primeDynamicLayout(launcher, window);

    // Pre-accept any window.confirm — DynamicCommandButtonGroupBuilder uses
    // window.confirm for confirmMessage gating (line 334).
    await window.evaluate(() => {
      (window as any).confirm = () => true;
    });

    // Maintenance is collapsedByDefault — its buttons are not in the DOM until expanded.
    await expandGroupIfCollapsed(window, "Maintenance");

    const button = window.locator(
      '.exocortex-buttons-section .exocortex-action-button:has-text("Archive Completed")',
    );
    await expect(button).toBeVisible({ timeout: 20000 });
    await button.click();

    await expect
      .poll(
        async () => {
          return window.evaluate(async () => {
            const app = (window as any).app;
            const file = app.vault.getAbstractFileByPath(
              "Tasks/smoke-archive-completed.md",
            );
            if (!file) {
              // File may have been moved to Archive folder
              const files = app.vault.getMarkdownFiles();
              const archived = files.find((f: { path: string }) =>
                f.path.toLowerCase().includes("archive"),
              );
              return archived ? "moved-to-archive" : null;
            }
            const raw = await app.vault.read(file);
            // Archive grounding sets ems__Effort_archived: true OR moves file
            return raw.includes("ems__Effort_archived: true")
              ? "archived-flag-set"
              : raw.includes("ems__Effort_archived: \"true\"")
                ? "archived-flag-set"
                : null;
          });
        },
        {
          timeout: 20000,
          message: "Archive grounding did not mutate file or move it to Archive",
        },
      )
      .not.toBeNull();
  });

  test("Set Result: maintenance, input modal, no confirm", async () => {
    const fixturePath = "Tasks/smoke-set-result.md";
    await launcher.openFile(fixturePath);
    const window = await launcher.getWindow();

    await primeDynamicLayout(launcher, window);

    // Maintenance is collapsedByDefault — expand before locating button.
    await expandGroupIfCollapsed(window, "Maintenance");

    const button = window.locator(
      '.exocortex-buttons-section .exocortex-action-button:has-text("Set Result")',
    );
    await expect(button).toBeVisible({ timeout: 20000 });
    await button.click();

    await fillDynamicFormModal(window, { value: "Smoke result text" });

    await expect
      .poll(
        async () => {
          return window.evaluate(async () => {
            const app = (window as any).app;
            const file = app.vault.getAbstractFileByPath(
              "Tasks/smoke-set-result.md",
            );
            if (!file) return null;
            return await app.vault.read(file);
          });
        },
        { timeout: 20000, message: "Set Result grounding did not write to disk" },
      )
      .toContain("Smoke result text");
  });

  test("Set Planned Start: planning, input modal (UX RFC P1-3 fix holds)", async () => {
    const fixturePath = "Tasks/smoke-set-planned-start.md";
    await launcher.openFile(fixturePath);
    const window = await launcher.getWindow();

    await primeDynamicLayout(launcher, window);

    const button = window.locator(
      '.exocortex-buttons-section .exocortex-action-button:has-text("Set Planned Start")',
    );
    await expect(button).toBeVisible({ timeout: 20000 });
    await button.click();

    const targetDate = "2026-05-01";
    await fillDynamicFormModal(window, { value: targetDate });

    // Regression guard for UX RFC P1-3: literal "$input"/"$value" must NOT be
    // persisted; the actual user-entered date is what lands in frontmatter.
    await expect
      .poll(
        async () => {
          return window.evaluate(async () => {
            const app = (window as any).app;
            const file = app.vault.getAbstractFileByPath(
              "Tasks/smoke-set-planned-start.md",
            );
            if (!file) return null;
            return await app.vault.read(file);
          });
        },
        {
          timeout: 20000,
          message: "Set Planned Start did not write date to frontmatter",
        },
      )
      .toContain(targetDate);

    const raw = await window.evaluate(async () => {
      const app = (window as any).app;
      const file = app.vault.getAbstractFileByPath(
        "Tasks/smoke-set-planned-start.md",
      );
      return file ? await app.vault.read(file) : "";
    });
    expect(raw).not.toContain("$input");
    expect(raw).not.toContain("$value");
  });

  test("Plan on Today: planning, direct fast-path (no modal)", async () => {
    const fixturePath = "Tasks/smoke-plan-on-today.md";
    await launcher.openFile(fixturePath);
    const window = await launcher.getWindow();

    await primeDynamicLayout(launcher, window);

    const button = window.locator(
      '.exocortex-buttons-section .exocortex-action-button:has-text("Plan on Today")',
    );
    await expect(button).toBeVisible({ timeout: 20000 });
    await button.click();

    const today = new Date().toISOString().slice(0, 10);

    await expect
      .poll(
        async () => {
          return window.evaluate(async () => {
            const app = (window as any).app;
            const file = app.vault.getAbstractFileByPath(
              "Tasks/smoke-plan-on-today.md",
            );
            if (!file) return null;
            return await app.vault.read(file);
          });
        },
        { timeout: 20000, message: "Plan on Today did not write today's date" },
      )
      .toContain(today);
  });

  test("Set Status Doing: status, composite grounding (status + startTimestamp)", async () => {
    const fixturePath = "Tasks/smoke-set-status-doing.md";
    await launcher.openFile(fixturePath);
    const window = await launcher.getWindow();

    await primeDynamicLayout(launcher, window);

    const button = window.locator(
      '.exocortex-buttons-section .exocortex-action-button:has-text("Start")',
    );
    await expect(button).toBeVisible({ timeout: 20000 });
    await button.click();

    await expect
      .poll(
        async () => {
          return window.evaluate(async () => {
            const app = (window as any).app;
            const file = app.vault.getAbstractFileByPath(
              "Tasks/smoke-set-status-doing.md",
            );
            if (!file) return null;
            const raw = await app.vault.read(file);
            return {
              hasDoing: raw.includes("Doing"),
              hasStartTimestamp: /ems__Effort_startTimestamp:\s*\S/.test(raw),
            };
          });
        },
        {
          timeout: 20000,
          message: "Composite Set Status Doing did not mutate both fields",
        },
      )
      .toMatchObject({ hasDoing: true, hasStartTimestamp: true });
  });

  // GATED: UX RFC P0-2 "Set Zone to Today" rename has not merged. No command
  // with this label exists in starter-kit-fixtures as of 2026-04-20 (verified
  // via grep of exo__Asset_label across exocmd/**). Unskip after the rename
  // PR lands and starter-kit-fixtures submodule is bumped.
  test.skip("Set Zone to Today: post-UX-RFC P0-2 rename", async () => {
    // Intentionally empty — see skip rationale above.
  });
});

/**
 * Wait for plugin → metadataCache → layout pipeline to be ready before
 * asserting on .exocortex-buttons-section. Mirrors the pattern from
 * vault-commands-smoke.spec.ts (it.beforeEach incantation).
 */
async function primeDynamicLayout(
  launcher: ObsidianLauncher,
  window: Page,
): Promise<void> {
  await launcher.waitForModalsToClose(10000);
  await launcher.waitForElement(".exocortex-layout-rendered", 30000);

  await expect
    .poll(
      async () =>
        window.evaluate(() => {
          const app = (window as any).app;
          const file = app?.workspace?.getActiveFile();
          if (!file) return null;
          const cache = app.metadataCache.getFileCache(file);
          return cache?.frontmatter
            ? JSON.stringify(Object.keys(cache.frontmatter))
            : null;
        }),
      { timeout: 15000, message: "metadataCache frontmatter not populated" },
    )
    .not.toBeNull();

  await window.evaluate(() => {
    const plugin = (window as any).app?.plugins?.plugins?.exocortex;
    plugin?.commandResolver?.invalidateCache?.();
    plugin?.refreshLayout?.();
  });
}

/**
 * Expand a collapsed button group (if collapsible) so its inner buttons enter
 * the DOM. Groups with `collapsedByDefault: true` (e.g. Maintenance) render
 * only the title button until expanded — `.exocortex-button-group-buttons`
 * is absent, so `:has-text(...)` locators timeout without this helper.
 */
async function expandGroupIfCollapsed(window: Page, title: string): Promise<void> {
  const titleButton = window.locator(
    `.exocortex-button-group-title--collapsible:has-text("${title}")`,
  );
  const count = await titleButton.count();
  if (count === 0) return;
  const expanded = await titleButton.first().getAttribute("aria-expanded");
  if (expanded === "false") {
    await titleButton.first().click();
  }
}

/**
 * Fill the DynamicFormModal with given values and submit. Production renders
 * inputs as `<input class="dynamic-form-input" data-testid="field-<name>" />`
 * (see DynamicForm.tsx:101-172) inside `.dynamic-form-modal`. Submit button
 * is `.modal-button-container button[type="submit"]`.
 *
 * For commands with a single-field schema (the Phase 3 subset uses a `value`
 * field — see InputSchemaField contract in CommandResolver), pass
 * `{ value: "<text>" }`. Multi-field schemas extend trivially.
 */
async function fillDynamicFormModal(
  window: Page,
  values: Record<string, string>,
): Promise<void> {
  const modal = window.locator(".dynamic-form-modal");
  await expect(modal).toBeVisible({ timeout: 15000 });

  for (const [name, val] of Object.entries(values)) {
    const field = modal.locator(`[data-testid="field-${name}"]`);
    await expect(field).toBeVisible({ timeout: 5000 });
    await field.fill(val);
  }

  const submit = modal.locator('.modal-button-container button[type="submit"]');
  await submit.click();

  await expect(modal).toBeHidden({ timeout: 15000 });
}
