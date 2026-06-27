/**
 * Cross-modal step-sync between the first-run onboarding panel and the durable
 * bootstrap-result modal (#3705).
 *
 * The panel (`FirstRunOnboardingModal`) and the result modal
 * (`BootstrapResultModal`) are separate modal instances; the result modal's
 * success-path next-step CTA («Add the AssetSpace registry») performs the
 * panel's Step 3, but historically only the panel's OWN step button ticked the
 * step done, so advancing via the result-modal CTA left the checklist desynced.
 * The fix threads an optional `onStepCompleted` hook from the result modal that
 * the wiring binds to `panel.markStepDoneByKey(addRegistry)`.
 *
 * These tests drive the REAL modal classes (the production button handlers)
 * over a jsdom DOM, mirroring the `ExocortexPlugin` wiring, so they exercise the
 * actual cross-modal coordination — not a stub.
 *
 * Revert-verify: dropping the result modal's `this.actions.onStepCompleted?.()`
 * call (BootstrapResultModal) makes the "marks the matching panel step done"
 * assertion FAIL (Step 3 stays un-ticked); restoring it PASSES.
 */
import { describe, it, expect, beforeEach, jest } from "@jest/globals";

jest.mock("obsidian", () => {
  interface CreateOpts {
    cls?: string;
    text?: string;
    type?: string;
    placeholder?: string;
    href?: string;
    attr?: Record<string, string>;
  }
  function augment(el: HTMLElement): void {
    (
      el as unknown as { createEl: (tag: string, o?: CreateOpts) => HTMLElement }
    ).createEl = function (tag: string, o?: CreateOpts): HTMLElement {
      const child = document.createElement(tag);
      if (o?.cls) child.className = o.cls;
      if (o?.text) child.textContent = o.text;
      if (o?.type) child.setAttribute("type", o.type);
      if (o?.placeholder) child.setAttribute("placeholder", o.placeholder);
      if (o?.href) child.setAttribute("href", o.href);
      if (o?.attr) {
        for (const [name, value] of Object.entries(o.attr)) {
          child.setAttribute(name, value);
        }
      }
      this.appendChild(child);
      augment(child);
      return child;
    }.bind(el);
    (el as unknown as { addClass: (c: string) => void }).addClass = function (
      c: string,
    ): void {
      this.classList.add(c);
    }.bind(el);
    (el as unknown as { empty: () => void }).empty = function (): void {
      while (this.firstChild) this.removeChild(this.firstChild);
    }.bind(el);
  }
  class MockModal {
    app: unknown;
    contentEl: HTMLElement;
    constructor(app: unknown) {
      this.app = app;
      this.contentEl = document.createElement("div");
      augment(this.contentEl);
    }
    open(): void {
      document.body.appendChild(this.contentEl);
      this.onOpen();
    }
    close(): void {
      this.onClose();
      if (this.contentEl.parentNode) {
        this.contentEl.parentNode.removeChild(this.contentEl);
      }
    }
    onOpen(): void {}
    onClose(): void {}
  }
  return { Modal: MockModal, App: class {} };
});

import type { App } from "obsidian";
import {
  FirstRunOnboardingModal,
  ONBOARDING_STEP_KEYS,
  type FirstRunOnboardingActions,
} from "../../../../src/presentation/modals/FirstRunOnboardingModal";
import {
  BootstrapResultModal,
  type BootstrapResultModalActions,
} from "../../../../src/presentation/modals/BootstrapResultModal";
import type { BootstrapResultInfo } from "../../../../src/infrastructure/adapters/BootstrapAssetSpaceCommands";

const fakeApp = {} as unknown as App;

const BOOTSTRAPPED: BootstrapResultInfo = {
  kind: "bootstrapped",
  folderName: "assetspaces/kitelev/exoas-exo",
  sha: "abc1234",
};

function noopActions(): FirstRunOnboardingActions {
  return {
    onSavePat: async () => undefined,
    onSetupEngine: () => undefined,
    onAddRegistry: () => undefined,
    onAddProfiles: () => undefined,
    onApplyProfile: () => undefined,
  };
}

/** The panel's own Step 3 `<li>` (queried within the panel's contentEl). */
function panelStep3Li(panel: FirstRunOnboardingModal): HTMLElement {
  const btn = Array.from(
    panel.contentEl.querySelectorAll<HTMLButtonElement>(
      "button.exocortex-onboarding-step-action",
    ),
  ).find((b) => b.textContent === "Add the AssetSpace registry")!;
  return btn.closest("li.exocortex-onboarding-step") as HTMLElement;
}

/** Open a result modal whose `onStepCompleted` mirrors the plugin wiring. */
function openResultModal(
  panel: FirstRunOnboardingModal | null,
  over: Partial<BootstrapResultModalActions> = {},
): BootstrapResultModal {
  const actions: BootstrapResultModalActions = {
    onAddRegistry: () => undefined,
    // Mirror ExocortexPlugin's wiring: the result-modal CTA performs Step 3, so
    // tick that panel step done (no-op when the panel is gone — markStepDoneByKey
    // guards on its closed flag).
    onStepCompleted: () =>
      panel?.markStepDoneByKey(ONBOARDING_STEP_KEYS.addRegistry),
    ...over,
  };
  const modal = new BootstrapResultModal(fakeApp, BOOTSTRAPPED, actions);
  modal.open();
  return modal;
}

/** The result modal's success-path next-step CTA button. */
function resultCtaButton(modal: BootstrapResultModal): HTMLButtonElement {
  return modal.contentEl.querySelector<HTMLButtonElement>(
    "button.bootstrap-result-next-action",
  )!;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("Onboarding ↔ bootstrap-result step sync (#3705)", () => {
  it("@req:e4d8a948-0928-4519-b7e0-ffb1e4440248 the result-modal next-step CTA marks the onboarding panel's matching step done", () => {
    const panel = new FirstRunOnboardingModal(fakeApp, noopActions());
    panel.open();

    // Step 3 starts un-ticked (the user has NOT clicked the panel's own button).
    const step3 = panelStep3Li(panel);
    expect(step3.classList.contains("is-done")).toBe(false);
    expect(step3.querySelector(".exocortex-onboarding-step-done")).toBeNull();

    // Advance via the result-modal CTA instead (the desync repro).
    const result = openResultModal(panel);
    resultCtaButton(result).click();

    // The panel's Step 3 is now ticked, in sync with what was actually done.
    expect(step3.classList.contains("is-done")).toBe(true);
    const marker = step3.querySelector(".exocortex-onboarding-step-done")!;
    expect(marker.textContent).toContain("Done");
  });

  it("@req:e4d8a948-0928-4519-b7e0-ffb1e4440248 only the matching step ticks — sibling panel steps stay un-done", () => {
    const panel = new FirstRunOnboardingModal(fakeApp, noopActions());
    panel.open();

    const result = openResultModal(panel);
    resultCtaButton(result).click();

    // Exactly one done-marker across the panel — Step 3 only (the result-modal
    // CTA must not tick steps 1/2/4/5).
    const markers = panel.contentEl.querySelectorAll(
      ".exocortex-onboarding-step-done",
    );
    expect(markers).toHaveLength(1);
    expect(panelStep3Li(panel).classList.contains("is-done")).toBe(true);
  });

  it("@req:e4d8a948-0928-4519-b7e0-ffb1e4440248 is idempotent — repeated result-modal CTAs keep a single ✓ Done marker on the step", () => {
    const panel = new FirstRunOnboardingModal(fakeApp, noopActions());
    panel.open();

    // Fire the result-modal CTA three times (the sub-dialogs let a user re-run it).
    for (let i = 0; i < 3; i++) {
      const result = openResultModal(panel);
      resultCtaButton(result).click();
    }

    const step3 = panelStep3Li(panel);
    expect(
      step3.querySelectorAll(".exocortex-onboarding-step-done"),
    ).toHaveLength(1);
  });

  it("@req:e4d8a948-0928-4519-b7e0-ffb1e4440248 is a safe no-op when the panel is already closed (no throw, no marker)", () => {
    const panel = new FirstRunOnboardingModal(fakeApp, noopActions());
    panel.open();
    const step3 = panelStep3Li(panel);
    panel.close();

    // The result modal fires its CTA after the panel closed (panel is gone).
    const result = openResultModal(panel);
    expect(() => resultCtaButton(result).click()).not.toThrow();

    // The (detached) Step 3 element was never ticked.
    expect(step3.classList.contains("is-done")).toBe(false);
    expect(step3.querySelector(".exocortex-onboarding-step-done")).toBeNull();
  });

  it("the result modal fires onStepCompleted exactly once per success CTA click (the cross-modal contract)", () => {
    let calls = 0;
    const result = openResultModal(null, {
      onStepCompleted: () => {
        calls++;
      },
    });
    resultCtaButton(result).click();
    expect(calls).toBe(1);
  });

  it("the result modal works standalone — no onStepCompleted wired (no throw)", () => {
    const modal = new BootstrapResultModal(fakeApp, BOOTSTRAPPED, {
      onAddRegistry: () => undefined,
    });
    modal.open();
    expect(() => resultCtaButton(modal).click()).not.toThrow();
  });
});
