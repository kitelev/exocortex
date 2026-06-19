/**
 * Unit tests for the RFC 0002 §3.1 first-run onboarding panel.
 *
 * Local `jest.mock("obsidian")` provides a Modal that mounts `contentEl` into
 * `document.body` on `open()`, plus `addClass` and a recursive `createEl` that
 * copies the attributes the panel relies on (cls / text), so DOM queries,
 * `addEventListener`, `setAttribute`, and `focus()` behave like real Obsidian.
 */
import { describe, it, expect, beforeEach, jest } from "@jest/globals";

jest.mock("obsidian", () => {
  interface CreateOpts {
    cls?: string;
    text?: string;
  }
  function augment(el: HTMLElement): void {
    (
      el as unknown as { createEl: (tag: string, o?: CreateOpts) => HTMLElement }
    ).createEl = function (tag: string, o?: CreateOpts): HTMLElement {
      const child = document.createElement(tag);
      if (o?.cls) child.className = o.cls;
      if (o?.text) child.textContent = o.text;
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
  type FirstRunOnboardingActions,
} from "../../../../src/presentation/modals/FirstRunOnboardingModal";

const fakeApp = {} as unknown as App;

function makeActions(
  over: Partial<FirstRunOnboardingActions> = {},
): { actions: FirstRunOnboardingActions; calls: string[] } {
  const calls: string[] = [];
  const actions: FirstRunOnboardingActions = {
    onSetupEngine: () => calls.push("engine"),
    onAddStarter: () => calls.push("starter"),
    onApplyStarterProfile: () => calls.push("profile"),
    onClosePanel: () => calls.push("close"),
    ...over,
  };
  return { actions, calls };
}

function findButton(label: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent === label,
  );
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("FirstRunOnboardingModal", () => {
  it("renders the welcome heading + a 3-step ordered checklist", () => {
    const { actions } = makeActions();
    new FirstRunOnboardingModal(fakeApp, actions).open();

    expect(
      document.querySelector(".exocortex-onboarding-title")?.textContent,
    ).toBe("Welcome to Exocortex");

    const list = document.querySelector("ol.exocortex-onboarding-steps");
    expect(list).not.toBeNull();
    const items = document.querySelectorAll("li.exocortex-onboarding-step");
    expect(items).toHaveLength(3);

    // Each step has a plain-text marker (not a glyph) — P16.
    const markers = Array.from(
      document.querySelectorAll(".exocortex-onboarding-step-marker"),
    ).map((m) => m.textContent);
    expect(markers).toEqual(["Step 1 — ", "Step 2 — ", "Step 3 — "]);
  });

  it("step 1 button fires onSetupEngine (opens Bootstrap)", () => {
    const { actions, calls } = makeActions();
    new FirstRunOnboardingModal(fakeApp, actions).open();
    findButton("Set up the engine")!.click();
    expect(calls).toEqual(["engine"]);
  });

  it("step 2 button fires onAddStarter (Add starter content)", () => {
    const { actions, calls } = makeActions();
    new FirstRunOnboardingModal(fakeApp, actions).open();
    findButton("Add the starter content")!.click();
    expect(calls).toEqual(["starter"]);
  });

  it("step 3 button fires onApplyStarterProfile (Apply starter profile)", () => {
    const { actions, calls } = makeActions();
    new FirstRunOnboardingModal(fakeApp, actions).open();
    findButton("Apply the starter profile")!.click();
    expect(calls).toEqual(["profile"]);
  });

  it("each step action is a keyboard-navigable button with an aria-label (P16)", () => {
    const { actions } = makeActions();
    new FirstRunOnboardingModal(fakeApp, actions).open();
    const actionButtons = Array.from(
      document.querySelectorAll("button.exocortex-onboarding-step-action"),
    ) as HTMLButtonElement[];
    expect(actionButtons).toHaveLength(3);
    expect(actionButtons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Step 1: Set up the engine",
      "Step 2: Add the starter content",
      "Step 3: Apply the starter profile",
    ]);
  });

  it("manages focus — the first action button is focused on open (P16)", () => {
    const { actions } = makeActions();
    new FirstRunOnboardingModal(fakeApp, actions).open();
    expect(document.activeElement).toBe(findButton("Set up the engine"));
  });

  it("clicking a step does NOT close the panel (sub-dialogs stack on top)", () => {
    const { actions, calls } = makeActions();
    new FirstRunOnboardingModal(fakeApp, actions).open();
    findButton("Add the starter content")!.click();
    // No close persisted yet — the panel stays open underneath the sub-dialog.
    expect(calls).toEqual(["starter"]);
    expect(document.querySelector("ol.exocortex-onboarding-steps")).not.toBeNull();
  });

  it("persists the one-time flag exactly once on close", () => {
    const { actions, calls } = makeActions();
    const modal = new FirstRunOnboardingModal(fakeApp, actions);
    modal.open();
    modal.close();
    expect(calls).toEqual(["close"]);
    // Idempotent — a second close (Obsidian can double-fire) does not re-persist.
    modal.close();
    expect(calls).toEqual(["close"]);
  });

  it("the explicit Close button closes the panel and persists the flag", () => {
    const { actions, calls } = makeActions();
    new FirstRunOnboardingModal(fakeApp, actions).open();
    findButton("Close")!.click();
    expect(calls).toEqual(["close"]);
  });

  it("a throwing onClosePanel never breaks teardown", () => {
    const { actions } = makeActions({
      onClosePanel: () => {
        throw new Error("disk full");
      },
    });
    const modal = new FirstRunOnboardingModal(fakeApp, actions);
    modal.open();
    expect(() => modal.close()).not.toThrow();
  });

  it("works without an onClosePanel callback (optional)", () => {
    const { actions } = makeActions({ onClosePanel: undefined });
    const modal = new FirstRunOnboardingModal(fakeApp, actions);
    modal.open();
    expect(() => modal.close()).not.toThrow();
  });
});
