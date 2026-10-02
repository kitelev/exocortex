import { test, expect } from "@playwright/experimental-ct-react";
import React from "react";
import {
  ActionButtonsGroup,
  ButtonGroup,
} from "../../src/presentation/components/ActionButtonsGroup";

/**
 * Visual Regression Tests for ActionButtonsGroup Component
 *
 * These tests capture screenshots to detect visual regressions in:
 * - Button variants (primary, secondary, success, warning, danger)
 * - Layout and spacing
 * - Group separators
 * - Responsive behavior
 * - Hover/focus states
 *
 * Run with: npm run test:component -- ActionButtonsGroup.visual
 * Update snapshots: npx playwright test --update-snapshots
 */
test.describe("ActionButtonsGroup Visual Regression", () => {
  test("default state - single group with primary button", async ({
    mount,
  }) => {
    const groups: ButtonGroup[] = [
      {
        id: "creation",
        title: "Creation",
        buttons: [
          {
            id: "create-task",
            label: "Create Task",
            variant: "primary",
            visible: true,
            onClick: async () => {},
          },
        ],
      },
    ];

    const component = await mount(
      <div style={{ width: "400px", padding: "20px" }}>
        <ActionButtonsGroup groups={groups} />
      </div>,
    );

    await expect(component).toHaveScreenshot("single-group-primary.png");
  });

  test("all button variants in single group", async ({ mount }) => {
    const groups: ButtonGroup[] = [
      {
        id: "all-variants",
        title: "All Button Variants",
        buttons: [
          {
            id: "btn-primary",
            label: "Primary",
            variant: "primary",
            visible: true,
            onClick: async () => {},
          },
          {
            id: "btn-secondary",
            label: "Secondary",
            variant: "secondary",
            visible: true,
            onClick: async () => {},
          },
          {
            id: "btn-success",
            label: "Success",
            variant: "success",
            visible: true,
            onClick: async () => {},
          },
          {
            id: "btn-warning",
            label: "Warning",
            variant: "warning",
            visible: true,
            onClick: async () => {},
          },
          {
            id: "btn-danger",
            label: "Danger",
            variant: "danger",
            visible: true,
            onClick: async () => {},
          },
        ],
      },
    ];

    const component = await mount(
      <div style={{ width: "600px", padding: "20px" }}>
        <ActionButtonsGroup groups={groups} />
      </div>,
    );

    await expect(component).toHaveScreenshot("all-variants.png");
  });

  test("multiple groups with separators", async ({ mount }) => {
    const groups: ButtonGroup[] = [
      {
        id: "creation",
        title: "Creation",
        buttons: [
          {
            id: "create-task",
            label: "Create Task",
            variant: "primary",
            visible: true,
            onClick: async () => {},
          },
          {
            id: "create-project",
            label: "Create Project",
            variant: "primary",
            visible: true,
            onClick: async () => {},
          },
        ],
      },
      {
        id: "status",
        title: "Status",
        buttons: [
          {
            id: "start-effort",
            label: "Start Effort",
            variant: "secondary",
            visible: true,
            onClick: async () => {},
          },
          {
            id: "mark-done",
            label: "Mark Done",
            variant: "success",
            visible: true,
            onClick: async () => {},
          },
        ],
      },
      {
        id: "planning",
        title: "Planning",
        buttons: [
          {
            id: "plan-today",
            label: "Plan on Today",
            variant: "warning",
            visible: true,
            onClick: async () => {},
          },
          {
            id: "backlog",
            label: "Move to Backlog",
            variant: "secondary",
            visible: true,
            onClick: async () => {},
          },
        ],
      },
      {
        id: "maintenance",
        title: "Maintenance",
        buttons: [
          {
            id: "archive",
            label: "Archive",
            variant: "danger",
            visible: true,
            onClick: async () => {},
          },
        ],
      },
    ];

    const component = await mount(
      <div style={{ width: "500px", padding: "20px" }}>
        <ActionButtonsGroup groups={groups} />
      </div>,
    );

    await expect(component).toHaveScreenshot("multiple-groups-separators.png");
  });

  test("hover state - primary button", async ({ mount, page }) => {
    const groups: ButtonGroup[] = [
      {
        id: "test",
        title: "Hover Test",
        buttons: [
          {
            id: "btn-hover",
            label: "Hover Me",
            variant: "primary",
            visible: true,
            onClick: async () => {},
          },
        ],
      },
    ];

    const component = await mount(
      <div style={{ width: "400px", padding: "20px" }}>
        <ActionButtonsGroup groups={groups} />
      </div>,
    );

    // Hover over the button
    await component.locator("button").hover();
    // Wait for CSS transition
    await page.waitForTimeout(300);

    await expect(component).toHaveScreenshot("hover-primary.png");
  });

  test("hover state - success button", async ({ mount, page }) => {
    const groups: ButtonGroup[] = [
      {
        id: "test",
        title: "Hover Test",
        buttons: [
          {
            id: "btn-hover",
            label: "Hover Me",
            variant: "success",
            visible: true,
            onClick: async () => {},
          },
        ],
      },
    ];

    const component = await mount(
      <div style={{ width: "400px", padding: "20px" }}>
        <ActionButtonsGroup groups={groups} />
      </div>,
    );

    await component.locator("button").hover();
    await page.waitForTimeout(300);

    await expect(component).toHaveScreenshot("hover-success.png");
  });

  test("hover state - danger button", async ({ mount, page }) => {
    const groups: ButtonGroup[] = [
      {
        id: "test",
        title: "Hover Test",
        buttons: [
          {
            id: "btn-hover",
            label: "Hover Me",
            variant: "danger",
            visible: true,
            onClick: async () => {},
          },
        ],
      },
    ];

    const component = await mount(
      <div style={{ width: "400px", padding: "20px" }}>
        <ActionButtonsGroup groups={groups} />
      </div>,
    );

    await component.locator("button").hover();
    await page.waitForTimeout(300);

    await expect(component).toHaveScreenshot("hover-danger.png");
  });

  test("responsive narrow width", async ({ mount }) => {
    const groups: ButtonGroup[] = [
      {
        id: "creation",
        title: "Creation",
        buttons: [
          {
            id: "create-task",
            label: "Create Task",
            variant: "primary",
            visible: true,
            onClick: async () => {},
          },
          {
            id: "create-project",
            label: "Create Project",
            variant: "primary",
            visible: true,
            onClick: async () => {},
          },
        ],
      },
      {
        id: "status",
        title: "Status",
        buttons: [
          {
            id: "mark-done",
            label: "Mark Done",
            variant: "success",
            visible: true,
            onClick: async () => {},
          },
        ],
      },
    ];

    const component = await mount(
      <div style={{ width: "320px", padding: "10px" }}>
        <ActionButtonsGroup groups={groups} />
      </div>,
    );

    await expect(component).toHaveScreenshot("responsive-narrow.png");
  });

  test("disabled buttons appearance", async ({ mount }) => {
    // Note: Current implementation doesn't support disabled state,
    // but this test is ready for when it's added
    const groups: ButtonGroup[] = [
      {
        id: "test",
        title: "Buttons",
        buttons: [
          {
            id: "btn-enabled",
            label: "Enabled",
            variant: "primary",
            visible: true,
            onClick: async () => {},
          },
          {
            id: "btn-secondary",
            label: "Secondary",
            variant: "secondary",
            visible: true,
            onClick: async () => {},
          },
        ],
      },
    ];

    const component = await mount(
      <div style={{ width: "400px", padding: "20px" }}>
        <ActionButtonsGroup groups={groups} />
      </div>,
    );

    await expect(component).toHaveScreenshot("buttons-appearance.png");
  });

  test("long button labels wrap correctly", async ({ mount }) => {
    const groups: ButtonGroup[] = [
      {
        id: "long-labels",
        title: "Long Labels Test",
        buttons: [
          {
            id: "btn-long",
            label: "Very Long Button Label That Should Handle Well",
            variant: "primary",
            visible: true,
            onClick: async () => {},
          },
          {
            id: "btn-short",
            label: "Short",
            variant: "secondary",
            visible: true,
            onClick: async () => {},
          },
        ],
      },
    ];

    const component = await mount(
      <div style={{ width: "400px", padding: "20px" }}>
        <ActionButtonsGroup groups={groups} />
      </div>,
    );

    await expect(component).toHaveScreenshot("long-labels.png");
  });

  /**
   * Transplanted from `tests/component/visual/ActionButtonsGroup.visual.spec.tsx` when that
   * spec was removed (issue #4512). It was the ONE scenario of its seven that this file did
   * not already cover — measured, not assumed: the other six duplicate tests above, which
   * cover their shapes more widely (4 groups vs 2-3, hover in 3 variants vs 2, plus
   * responsive / disabled / long-label cases the removed spec had no equivalent for).
   *
   * `:focus-visible` styling is a different code path from `:hover`, and this file had zero
   * `.focus()` calls before this test.
   */
  test("focus state - primary button", async ({ mount, page }) => {
    const groups: ButtonGroup[] = [
      {
        id: "test",
        title: "Focus Test",
        buttons: [
          {
            id: "btn-focus",
            label: "Focus Me",
            variant: "primary",
            visible: true,
            onClick: async () => {},
          },
        ],
      },
    ];

    const component = await mount(
      <div style={{ width: "400px", padding: "20px" }}>
        <ActionButtonsGroup groups={groups} />
      </div>,
    );

    await component.locator("button").focus();
    // Wait for CSS transition, as the hover tests above do.
    await page.waitForTimeout(300);

    await expect(component).toHaveScreenshot("focus-primary.png");
  });
});
