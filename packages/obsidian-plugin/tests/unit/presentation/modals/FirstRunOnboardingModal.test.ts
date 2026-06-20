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
      // Mirror Obsidian's DomElementInfo so the reused §3.5 patSetupHelper
      // (link href + target/rel/aria via `attr`) renders faithfully here.
      if (o?.href) (child as HTMLAnchorElement).setAttribute("href", o.href);
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
  type FirstRunOnboardingActions,
} from "../../../../src/presentation/modals/FirstRunOnboardingModal";

const fakeApp = {} as unknown as App;

function makeActions(over: Partial<FirstRunOnboardingActions> = {}): {
  actions: FirstRunOnboardingActions;
  calls: string[];
  savedPats: string[];
} {
  const calls: string[] = [];
  const savedPats: string[] = [];
  const actions: FirstRunOnboardingActions = {
    onSavePat: async (pat: string) => {
      calls.push("savePat");
      savedPats.push(pat);
    },
    onPastePat: async () => "github_pat_pasted",
    onSetupEngine: () => calls.push("engine"),
    onAddRegistry: () => calls.push("registry"),
    onAddProfiles: () => calls.push("profiles"),
    onApplyProfile: () => calls.push("profile"),
    onClosePanel: () => calls.push("close"),
    ...over,
  };
  return { actions, calls, savedPats };
}

function patInput(): HTMLInputElement {
  return document.querySelector(
    "input.exocortex-onboarding-pat-input",
  ) as HTMLInputElement;
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
  it("renders the welcome heading + a 5-step ordered checklist (token-first)", () => {
    const { actions } = makeActions();
    new FirstRunOnboardingModal(fakeApp, actions).open();

    expect(
      document.querySelector(".exocortex-onboarding-title")?.textContent,
    ).toBe("Welcome to Exocortex");

    const list = document.querySelector("ol.exocortex-onboarding-steps");
    expect(list).not.toBeNull();
    const items = document.querySelectorAll("li.exocortex-onboarding-step");
    expect(items).toHaveLength(5);

    // Each step has a plain-text marker (not a glyph) — P16. Step 1 is the
    // optional token step (cd9444bd), then the four EKA materialise steps.
    const markers = Array.from(
      document.querySelectorAll(".exocortex-onboarding-step-marker"),
    ).map((m) => m.textContent);
    expect(markers).toEqual([
      "Step 1 — ",
      "Step 2 — ",
      "Step 3 — ",
      "Step 4 — ",
      "Step 5 — ",
    ]);
  });

  it("step 2 button fires onSetupEngine (opens Bootstrap)", () => {
    const { actions, calls } = makeActions();
    new FirstRunOnboardingModal(fakeApp, actions).open();
    findButton("Set up the engine")!.click();
    expect(calls).toEqual(["engine"]);
  });

  it("step 3 button fires onAddRegistry (Add the AssetSpace registry)", () => {
    const { actions, calls } = makeActions();
    new FirstRunOnboardingModal(fakeApp, actions).open();
    findButton("Add the AssetSpace registry")!.click();
    expect(calls).toEqual(["registry"]);
  });

  it("step 4 button fires onAddProfiles (Add the profiles AssetSpace)", () => {
    const { actions, calls } = makeActions();
    new FirstRunOnboardingModal(fakeApp, actions).open();
    findButton("Add the profiles AssetSpace")!.click();
    expect(calls).toEqual(["profiles"]);
  });

  it("step 5 button fires onApplyProfile (Apply a profile)", () => {
    const { actions, calls } = makeActions();
    new FirstRunOnboardingModal(fakeApp, actions).open();
    findButton("Apply a profile")!.click();
    expect(calls).toEqual(["profile"]);
  });

  it("each materialise-step action is a keyboard-navigable button with an aria-label (P16)", () => {
    const { actions } = makeActions();
    new FirstRunOnboardingModal(fakeApp, actions).open();
    const actionButtons = Array.from(
      document.querySelectorAll("button.exocortex-onboarding-step-action"),
    ) as HTMLButtonElement[];
    expect(actionButtons).toHaveLength(4);
    // Steps 2-5 (the token step is step 1 and has its own Save button).
    expect(actionButtons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Step 2: Set up the engine",
      "Step 3: Add the AssetSpace registry",
      "Step 4: Add the profiles AssetSpace",
      "Step 5: Apply a profile",
    ]);
  });

  it("manages focus — the token input (first actionable control) is focused on open (P16)", () => {
    const { actions } = makeActions();
    new FirstRunOnboardingModal(fakeApp, actions).open();
    expect(document.activeElement).toBe(patInput());
  });

  it("clicking a step does NOT close the panel (sub-dialogs stack on top)", () => {
    const { actions, calls } = makeActions();
    new FirstRunOnboardingModal(fakeApp, actions).open();
    findButton("Add the AssetSpace registry")!.click();
    // No close persisted yet — the panel stays open underneath the sub-dialog.
    expect(calls).toEqual(["registry"]);
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

describe("FirstRunOnboardingModal — token-first step (cd9444bd, RFC 0002 §3.1)", () => {
  it("renders the PAT step FIRST — before the Bootstrap (Set up the engine) step", () => {
    const { actions } = makeActions();
    new FirstRunOnboardingModal(fakeApp, actions).open();

    const steps = Array.from(
      document.querySelectorAll("li.exocortex-onboarding-step"),
    );
    // The first <li> is the token step; it carries the dedicated class and the
    // password input, and the Bootstrap button lives in a LATER step.
    expect(steps[0].classList.contains("exocortex-onboarding-step-pat")).toBe(
      true,
    );
    expect(steps[0].querySelector("input.exocortex-onboarding-pat-input")).not.toBeNull();

    const patIndex = steps.findIndex((li) =>
      li.classList.contains("exocortex-onboarding-step-pat"),
    );
    const engineIndex = steps.findIndex(
      (li) => li.querySelector("button")?.textContent === "Set up the engine",
    );
    expect(patIndex).toBe(0);
    expect(engineIndex).toBeGreaterThan(patIndex);
  });

  it("the step is labelled optional and reuses the §3.5 create-token helper", () => {
    const { actions } = makeActions();
    new FirstRunOnboardingModal(fakeApp, actions).open();

    const title = document.querySelector(
      ".exocortex-onboarding-step-pat .exocortex-onboarding-step-title",
    );
    expect(title?.textContent).toMatch(/optional/i);

    // §3.5 helper reuse — create-token deep-link + scope list rendered inside
    // the step (single source; no copy drift with the Settings PAT section).
    const link = document.querySelector(
      ".exocortex-onboarding-step-pat a.exocortex-pat-setup-create-link",
    ) as HTMLAnchorElement | null;
    expect(link?.textContent).toBe("Create token on GitHub");
    expect(link?.getAttribute("href")).toBe(
      "https://github.com/settings/personal-access-tokens/new",
    );
    expect(
      document.querySelector(
        ".exocortex-onboarding-step-pat ul.exocortex-pat-setup-scopes",
      ),
    ).not.toBeNull();
  });

  it("the token input is a masked, keyboard-accessible field (a11y, P16)", () => {
    const { actions } = makeActions();
    new FirstRunOnboardingModal(fakeApp, actions).open();
    const input = patInput();
    expect(input).not.toBeNull();
    expect(input.type).toBe("password");
    expect(input.getAttribute("aria-label")).toMatch(/token/i);
  });

  it("Save token persists the entered token device-local (private-repo access)", async () => {
    const { actions, calls, savedPats } = makeActions();
    new FirstRunOnboardingModal(fakeApp, actions).open();

    patInput().value = "github_pat_secret123";
    findButton("Save token")!.click();
    await Promise.resolve();

    expect(calls).toContain("savePat");
    expect(savedPats).toEqual(["github_pat_secret123"]);
  });

  it("Save token with an empty field passes '' (the clear / skip path)", async () => {
    const { actions, savedPats } = makeActions();
    new FirstRunOnboardingModal(fakeApp, actions).open();

    // Field left blank — clicking Save clears any prior token; the wiring turns
    // "" into a null setSecret, so a public-only tester ends up with no PAT.
    findButton("Save token")!.click();
    await Promise.resolve();

    expect(savedPats).toEqual([""]);
  });

  it("is skippable — going straight to step 2 fires Bootstrap without any PAT save (public flow intact)", () => {
    const { actions, calls } = makeActions();
    new FirstRunOnboardingModal(fakeApp, actions).open();

    // User ignores the optional token step and clicks the engine step directly.
    findButton("Set up the engine")!.click();
    expect(calls).toEqual(["engine"]);
    expect(calls).not.toContain("savePat");
  });

  it("Save-token failure is swallowed in the modal (never throws into the click handler)", async () => {
    const { actions } = makeActions({
      onSavePat: async () => {
        throw new Error("disk full");
      },
    });
    new FirstRunOnboardingModal(fakeApp, actions).open();
    patInput().value = "github_pat_x";
    expect(() => findButton("Save token")!.click()).not.toThrow();
    await Promise.resolve();
  });

  it("offers a Paste affordance (mobile parity §3.9) that fills the field", async () => {
    const { actions } = makeActions({
      onPastePat: async () => "github_pat_from_clipboard",
    });
    new FirstRunOnboardingModal(fakeApp, actions).open();

    const paste = findButton("Paste");
    expect(paste).toBeDefined();
    paste!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(patInput().value).toBe("github_pat_from_clipboard");
  });

  it("hides the Paste button when no clipboard reader is wired", () => {
    const { actions } = makeActions({ onPastePat: undefined });
    new FirstRunOnboardingModal(fakeApp, actions).open();
    expect(findButton("Paste")).toBeUndefined();
    // The Save button + input still render — paste is a pure nicety.
    expect(findButton("Save token")).toBeDefined();
    expect(patInput()).not.toBeNull();
  });
});

describe("FirstRunOnboardingModal — Test connection (RFC 0002)", () => {
  function patStatus(): HTMLElement | null {
    return document.querySelector("p.exocortex-onboarding-pat-status");
  }

  it("renders a Test connection button only when onTestPat is wired", () => {
    const { actions } = makeActions({
      onTestPat: async () => ({ ok: false, reason: "x" }),
    });
    new FirstRunOnboardingModal(fakeApp, actions).open();
    expect(findButton("Test connection")).toBeDefined();
    expect(patStatus()).not.toBeNull();
  });

  it("hides the Test connection button when no validator is wired", () => {
    const { actions } = makeActions({ onTestPat: undefined });
    new FirstRunOnboardingModal(fakeApp, actions).open();
    expect(findButton("Test connection")).toBeUndefined();
    expect(patStatus()).toBeNull();
  });

  it("the Test connection button is keyboard-accessible with an aria-label (P16)", () => {
    const { actions } = makeActions({
      onTestPat: async () => ({ ok: false, reason: "x" }),
    });
    new FirstRunOnboardingModal(fakeApp, actions).open();
    const btn = findButton("Test connection")!;
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.getAttribute("aria-label")).toMatch(/test.*connection/i);
  });

  it("the status line is an aria-live region (assistive tech announces the outcome)", () => {
    const { actions } = makeActions({
      onTestPat: async () => ({ ok: false, reason: "x" }),
    });
    new FirstRunOnboardingModal(fakeApp, actions).open();
    const status = patStatus()!;
    expect(status.getAttribute("role")).toBe("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
  });

  it("validates the CURRENT input value (not a saved token) and shows a success status", async () => {
    const seen: string[] = [];
    const { actions } = makeActions({
      onTestPat: async (pat: string) => {
        seen.push(pat);
        return {
          ok: true,
          remaining: 4321,
          resetAt: new Date("2026-06-20T10:00:00.000Z"),
          repos: ["kitelev/exoas-exo"],
        };
      },
    });
    new FirstRunOnboardingModal(fakeApp, actions).open();

    patInput().value = "github_pat_typed_but_not_saved";
    findButton("Test connection")!.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(seen).toEqual(["github_pat_typed_but_not_saved"]);
    const status = patStatus()!;
    expect(status.classList.contains("is-valid")).toBe(true);
    expect(status.classList.contains("is-invalid")).toBe(false);
    // aria-busy is transient — cleared once the result lands.
    expect(status.hasAttribute("aria-busy")).toBe(false);
    // Reuses describePatConnection → the same wording as the Settings notice.
    expect(status.textContent).toContain("GitHub OK");
    expect(status.textContent).toContain("4321 requests remaining");
    expect(status.textContent).toContain("kitelev/exoas-exo");
  });

  it("shows an invalid status with the reason when the token is rejected", async () => {
    const { actions } = makeActions({
      onTestPat: async () => ({
        ok: false,
        reason: "HTTP 401: Bad credentials",
      }),
    });
    new FirstRunOnboardingModal(fakeApp, actions).open();

    patInput().value = "github_pat_revoked";
    findButton("Test connection")!.click();
    await Promise.resolve();
    await Promise.resolve();

    const status = patStatus()!;
    expect(status.classList.contains("is-invalid")).toBe(true);
    expect(status.classList.contains("is-valid")).toBe(false);
    expect(status.textContent).toContain("Test connection failed");
    expect(status.textContent).toContain("HTTP 401");
  });

  it("re-enables the button and surfaces an invalid status if onTestPat unexpectedly throws", async () => {
    const { actions } = makeActions({
      onTestPat: async () => {
        throw new Error("wiring bug");
      },
    });
    new FirstRunOnboardingModal(fakeApp, actions).open();

    const btn = findButton("Test connection")!;
    patInput().value = "github_pat_x";
    expect(() => btn.click()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();

    expect(btn.disabled).toBe(false);
    expect(patStatus()!.classList.contains("is-invalid")).toBe(true);
  });
});
