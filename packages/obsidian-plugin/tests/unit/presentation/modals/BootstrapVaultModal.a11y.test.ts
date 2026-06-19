/**
 * Accessibility (RFC 0002 §3.11 / P16) unit tests for BootstrapVaultModal — the
 * onboarding "Set up the engine" (Bootstrap) modal.
 *
 * jsdom + a MockModal mounting `contentEl` into `document.body` on `open()` with
 * the recursive `createEl` (cls / text / type / placeholder / href / attr) the
 * production code relies on, so DOM-attribute assertions and native `focus()`
 * behave like real Obsidian.
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
      if (o?.type) (child as HTMLInputElement).type = o.type;
      if (o?.placeholder) {
        (child as HTMLInputElement).placeholder = o.placeholder;
      }
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
import { BootstrapVaultModal } from "../../../../src/presentation/modals/BootstrapVaultModal";

const fakeApp = {} as unknown as App;

function open(): BootstrapVaultModal {
  const modal = new BootstrapVaultModal(fakeApp, () => {
    /* resolution not asserted in these a11y tests */
  });
  modal.open();
  return modal;
}

function exoInput(): HTMLInputElement {
  return document.querySelector(
    "input.bootstrap-vault-input",
  ) as HTMLInputElement;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("BootstrapVaultModal — accessibility (P16, §3.11)", () => {
  it("the engine-URL input carries an aria-label", () => {
    open();
    expect(exoInput().getAttribute("aria-label")).toMatch(/engine repository/i);
  });

  it("the visible <label> is programmatically associated with the input (for/id)", () => {
    open();
    const label = document.querySelector(
      ".bootstrap-vault-field label",
    ) as HTMLLabelElement;
    const input = exoInput();
    const id = input.getAttribute("id");
    expect(id).toBeTruthy();
    expect(label.getAttribute("for")).toBe(id);
  });

  it("manages focus — the engine-URL field is focused on open", () => {
    open();
    expect(document.activeElement).toBe(exoInput());
  });

  it("the floor-repo link is a keyboard-focusable <a> with an aria-label and noopener (no reverse-tabnabbing)", () => {
    open();
    const link = document.querySelector(
      "a.bootstrap-vault-floor-link",
    ) as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute("aria-label")).toBeTruthy();
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("uses plain-text affordances only — no emoji-glyph-only button labels", () => {
    open();
    for (const btn of Array.from(document.querySelectorAll("button"))) {
      const txt = (btn.textContent ?? "").trim();
      expect(txt.length).toBeGreaterThan(1);
      expect(
        /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+$/u.test(txt),
      ).toBe(false);
    }
  });
});
