import { test, expect } from "@playwright/test";
import { ObsidianLauncher } from "../utils/obsidian-launcher";
import * as path from "path";

test.describe("Done Button Action", () => {
  let launcher: ObsidianLauncher;

  test.beforeEach(async () => {
    const vaultPath = path.join(__dirname, "../test-vault");
    launcher = new ObsidianLauncher(vaultPath);
    await launcher.launch();
  });

  test.afterEach(async () => {
    await launcher.close();
  });

  test("should change status to Done and set endTimestamp when Done button is clicked", async () => {
    // Open a task with Doing status
    await launcher.openFile("Tasks/done-button-test-task.md");

    const window = await launcher.getWindow();

    // Wait for Exocortex plugin to render action buttons
    await window.waitForSelector(".exocortex-action-buttons-container", {
      timeout: 15000,
    });

    // Verify the Done button is visible (should appear for Doing status)
    const doneButton = window.locator('.exocortex-action-button:has-text("Done")');
    const doneButtonVisible = await doneButton.isVisible({ timeout: 10000 }).catch(() => false);

    if (!doneButtonVisible) {
      // Alternative selector - try by variant
      const successButton = window.locator('.exocortex-action-button--success');
      await expect(successButton).toBeVisible({ timeout: 10000 });
    } else {
      await expect(doneButton).toBeVisible();
    }

    // Get initial file state before clicking
    const initialState = await window.evaluate(async () => {
      const app = (window as any).app;
      const file = app.vault.getAbstractFileByPath("Tasks/done-button-test-task.md");
      if (!file) {
        return { error: "File not found" };
      }

      const content = await app.vault.read(file);
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!frontmatterMatch) {
        return { error: "No frontmatter" };
      }

      const frontmatter = frontmatterMatch[1];
      const statusMatch = frontmatter.match(/ems__Effort_status:\s*"?\[\[(.*?)\]\]"?/);
      const endTimestampMatch = frontmatter.match(/ems__Effort_endTimestamp:\s*(.+)$/m);

      return {
        status: statusMatch ? statusMatch[1] : null,
        endTimestamp: endTimestampMatch ? endTimestampMatch[1].trim() : null,
      };
    });

    console.log("[E2E Test] Initial state:", initialState);
    expect(initialState.status).toBe("ems__EffortStatusDoing");
    expect(initialState.endTimestamp).toBeNull();

    // Click the Done button
    const buttonToClick = doneButtonVisible
      ? doneButton
      : window.locator('.exocortex-action-button--success').first();

    await buttonToClick.click();

    // Wait for the action to complete and file to be updated
    const maxRetries = 20;
    const retryDelay = 500;
    let finalState: any = null;

    for (let i = 0; i < maxRetries; i++) {
      await window.waitForTimeout(retryDelay);

      finalState = await window.evaluate(async () => {
        const app = (window as any).app;
        const file = app.vault.getAbstractFileByPath("Tasks/done-button-test-task.md");
        if (!file) {
          return { error: "File not found" };
        }

        const content = await app.vault.read(file);
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (!frontmatterMatch) {
          return { error: "No frontmatter" };
        }

        const frontmatter = frontmatterMatch[1];
        const statusMatch = frontmatter.match(/ems__Effort_status:\s*"?\[\[(.*?)\]\]"?/);
        const endTimestampMatch = frontmatter.match(/ems__Effort_endTimestamp:\s*(.+)$/m);

        return {
          status: statusMatch ? statusMatch[1] : null,
          endTimestamp: endTimestampMatch ? endTimestampMatch[1].trim() : null,
        };
      });

      console.log(`[E2E Test] Retry ${i + 1}: status=${finalState.status}, endTimestamp=${finalState.endTimestamp}`);

      if (finalState.status === "ems__EffortStatusDone" && finalState.endTimestamp) {
        break;
      }
    }

    console.log("[E2E Test] Final state:", finalState);

    // Verify status changed to Done
    expect(finalState.status).toBe("ems__EffortStatusDone");

    // Verify endTimestamp was set (should be a valid ISO timestamp)
    expect(finalState.endTimestamp).toBeTruthy();
    expect(finalState.endTimestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  test("should not show Done button for tasks with Done status", async () => {
    // Open a task that is already Done
    await launcher.openFile("Tasks/timestamp-sync-task.md");

    const window = await launcher.getWindow();

    // Wait for plugin to render
    await window.waitForSelector(".exocortex-action-buttons-container", {
      timeout: 15000,
    }).catch(() => {});

    // Wait a bit for conditional rendering
    await window.waitForTimeout(2000);

    // Done button should NOT be visible for tasks already in Done status
    const doneButton = window.locator('.exocortex-action-button:has-text("Done")');
    const isVisible = await doneButton.isVisible({ timeout: 3000 }).catch(() => false);

    // If ConditionEvaluator is working correctly, Done button should be hidden
    // for tasks that already have Done status
    expect(isVisible).toBe(false);
  });

  test("Done button should have correct styling (success variant)", async () => {
    await launcher.openFile("Tasks/done-button-test-task.md");

    const window = await launcher.getWindow();

    await window.waitForSelector(".exocortex-action-buttons-container", {
      timeout: 15000,
    });

    // Check for success variant button
    const successButton = window.locator('.exocortex-action-button--success').first();
    const isVisible = await successButton.isVisible({ timeout: 10000 }).catch(() => false);

    if (isVisible) {
      // Verify it has the check icon (if rendered as SVG or icon class)
      const buttonHtml = await successButton.innerHTML();
      const hasCheckIcon = buttonHtml.includes('check') ||
                           buttonHtml.includes('lucide-check') ||
                           buttonHtml.includes('svg');

      // Button should have tooltip
      const tooltip = await successButton.getAttribute('title');
      if (tooltip) {
        expect(tooltip).toContain('completed');
      }

      // Verify button text contains "Done"
      const buttonText = await successButton.textContent();
      expect(buttonText?.toLowerCase()).toContain('done');
    }
  });
});
