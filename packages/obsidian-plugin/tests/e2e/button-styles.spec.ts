import { test, expect } from "@playwright/test";

test.describe("Button CSS Styles Tests", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("http://localhost:8080");
    await page.waitForSelector(".exocortex-action-buttons-container", {
      timeout: 10000,
    });
  });

  test("should render buttons with different variant colors", async ({
    page,
  }) => {
    const primaryButton = page
      .locator(".exocortex-action-button--primary")
      .first();
    const secondaryButton = page
      .locator(".exocortex-action-button--secondary")
      .first();
    const successButton = page
      .locator(".exocortex-action-button--success")
      .first();
    const warningButton = page
      .locator(".exocortex-action-button--warning")
      .first();
    const dangerButton = page
      .locator(".exocortex-action-button--danger")
      .first();

    const primaryVisible = await primaryButton.isVisible().catch(() => false);
    if (primaryVisible) {
      const bgColor = await primaryButton.evaluate((el) => {
        return window.getComputedStyle(el).backgroundColor;
      });
      expect(bgColor).toBeTruthy();

      const borderColor = await primaryButton.evaluate((el) => {
        return window.getComputedStyle(el).borderColor;
      });
      expect(borderColor).toBeTruthy();
    }

    const secondaryVisible = await secondaryButton
      .isVisible()
      .catch(() => false);
    if (secondaryVisible) {
      const bgColor = await secondaryButton.evaluate((el) => {
        return window.getComputedStyle(el).backgroundColor;
      });
      expect(bgColor).toBeTruthy();

      const borderColor = await secondaryButton.evaluate((el) => {
        return window.getComputedStyle(el).borderColor;
      });
      expect(borderColor).toBeTruthy();
    }

    const successVisible = await successButton.isVisible().catch(() => false);
    if (successVisible) {
      const color = await successButton.evaluate((el) => {
        return window.getComputedStyle(el).color;
      });
      expect(color).toMatch(/rgb\(76,\s*175,\s*80\)|rgb\(102,\s*187,\s*106\)/);
    }

    const warningVisible = await warningButton.isVisible().catch(() => false);
    if (warningVisible) {
      const color = await warningButton.evaluate((el) => {
        return window.getComputedStyle(el).color;
      });
      expect(color).toMatch(/rgb\(255,\s*152,\s*0\)|rgb\(255,\s*167,\s*38\)/);
    }

    const dangerVisible = await dangerButton.isVisible().catch(() => false);
    if (dangerVisible) {
      const color = await dangerButton.evaluate((el) => {
        return window.getComputedStyle(el).color;
      });
      expect(color).toMatch(/rgb\(244,\s*67,\s*54\)|rgb\(239,\s*83,\s*80\)/);
    }
  });

  test("should have proper hover effects on buttons", async ({ page }) => {
    const firstButton = page.locator(".exocortex-action-button").first();
    await expect(firstButton).toBeVisible();

    const initialTransform = await firstButton.evaluate((el) => {
      return window.getComputedStyle(el).transform;
    });

    const initialBoxShadow = await firstButton.evaluate((el) => {
      return window.getComputedStyle(el).boxShadow;
    });

    await firstButton.hover();

    // Structured poll: wait for hover-transform to diverge from initial,
    // replaces blind 200ms sleep.
    await expect
      .poll(
        async () =>
          firstButton.evaluate(
            (el) => window.getComputedStyle(el).transform,
          ),
        { timeout: 2000 },
      )
      .not.toBe(initialTransform);

    const hoverTransform = await firstButton.evaluate((el) => {
      return window.getComputedStyle(el).transform;
    });

    const hoverBoxShadow = await firstButton.evaluate((el) => {
      return window.getComputedStyle(el).boxShadow;
    });

    expect(hoverTransform).not.toBe(initialTransform);
    expect(hoverBoxShadow).not.toBe(initialBoxShadow);
    expect(hoverBoxShadow).not.toBe("none");
  });

  test("should have proper spacing between buttons in a group", async ({
    page,
  }) => {
    const buttonGroups = page.locator(".exocortex-button-group");
    const groupCount = await buttonGroups.count();

    if (groupCount > 0) {
      const firstGroup = buttonGroups.first();
      const buttons = firstGroup.locator(".exocortex-action-button");
      const buttonCount = await buttons.count();

      if (buttonCount > 1) {
        const firstButtonBox = await buttons.nth(0).boundingBox();
        const secondButtonBox = await buttons.nth(1).boundingBox();

        expect(firstButtonBox).toBeTruthy();
        expect(secondButtonBox).toBeTruthy();

        if (firstButtonBox && secondButtonBox) {
          const gap =
            secondButtonBox.y - (firstButtonBox.y + firstButtonBox.height);
          expect(gap).toBeGreaterThanOrEqual(10);
          expect(gap).toBeLessThanOrEqual(14);
        }
      }
    }
  });

  test("should have consistent button heights", async ({ page }) => {
    const buttons = page.locator(".exocortex-action-button");
    const count = await buttons.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < Math.min(count, 5); i++) {
      const button = buttons.nth(i);
      const box = await button.boundingBox();
      expect(box).toBeTruthy();
      expect(box!.height).toBeGreaterThanOrEqual(32);
    }
  });

  test("should have proper border radius on buttons", async ({ page }) => {
    const firstButton = page.locator(".exocortex-action-button").first();
    await expect(firstButton).toBeVisible();

    const borderRadius = await firstButton.evaluate((el) => {
      return window.getComputedStyle(el).borderRadius;
    });

    expect(borderRadius).toBeTruthy();
    expect(borderRadius).not.toBe("0px");
  });

  test("should have proper padding on buttons", async ({ page }) => {
    const firstButton = page.locator(".exocortex-action-button").first();
    await expect(firstButton).toBeVisible();

    const paddingTop = await firstButton.evaluate((el) => {
      return window.getComputedStyle(el).paddingTop;
    });

    const paddingLeft = await firstButton.evaluate((el) => {
      return window.getComputedStyle(el).paddingLeft;
    });

    expect(paddingTop).toBeTruthy();
    expect(paddingLeft).toBeTruthy();

    const paddingTopValue = parseFloat(paddingTop);
    const paddingLeftValue = parseFloat(paddingLeft);

    expect(paddingTopValue).toBeGreaterThan(0);
    expect(paddingLeftValue).toBeGreaterThan(0);
  });

  test("should have proper transition properties", async ({ page }) => {
    const firstButton = page.locator(".exocortex-action-button").first();
    await expect(firstButton).toBeVisible();

    const transition = await firstButton.evaluate((el) => {
      return window.getComputedStyle(el).transition;
    });

    expect(transition).toBeTruthy();
    expect(transition).not.toBe("all 0s ease 0s");
  });

  test("should have proper font styling", async ({ page }) => {
    const firstButton = page.locator(".exocortex-action-button").first();
    await expect(firstButton).toBeVisible();

    const fontSize = await firstButton.evaluate((el) => {
      return window.getComputedStyle(el).fontSize;
    });

    const fontWeight = await firstButton.evaluate((el) => {
      return window.getComputedStyle(el).fontWeight;
    });

    expect(fontSize).toBeTruthy();
    expect(fontWeight).toBeTruthy();

    const fontSizeValue = parseFloat(fontSize);
    expect(fontSizeValue).toBeGreaterThan(0);
  });
});
