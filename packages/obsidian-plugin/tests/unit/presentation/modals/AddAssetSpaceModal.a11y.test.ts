/**
 * Accessibility (RFC 0002 §3.11 / P16) unit tests for AddAssetSpaceModal — the
 * onboarding "Add a knowledge pack" / step-3 modal.
 *
 * jsdom + a MockModal that mounts `contentEl` into `document.body` on `open()`
 * and provides the recursive `createEl` (cls / text / type / placeholder / attr)
 * the production code relies on, so DOM-attribute assertions and native
 * `focus()` behave like real Obsidian.
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

// `derivePath` lives in the `exocortex` core package; stub it so this UI test
// stays DOM-only and does not pull the core build.
jest.mock("exocortex", () => ({
  derivePath: (url: string) => {
    const m = /github\.com\/([^/]+)\/([^/]+)$/.exec(url);
    return m ? `assetspaces/${m[1]}/${m[2]}` : null;
  },
}));

import type { App } from "obsidian";
import { AddAssetSpaceModal } from "../../../../src/presentation/modals/AddAssetSpaceModal";

const fakeApp = {} as unknown as App;

function open(initialUrl?: string): AddAssetSpaceModal {
  const modal = new AddAssetSpaceModal(
    fakeApp,
    (url) => url.replace(/^.*\//, "").replace(/^exoas-/, ""),
    () => {
      /* resolution not asserted in these a11y tests */
    },
    initialUrl,
  );
  modal.open();
  return modal;
}

function urlInput(): HTMLInputElement {
  return document.querySelector(
    "input.add-assetspace-input",
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

describe("AddAssetSpaceModal — accessibility (P16, §3.11)", () => {
  it("the URL input carries an aria-label so it is named for screen readers", () => {
    open();
    expect(urlInput().getAttribute("aria-label")).toMatch(/repository url/i);
  });

  it("the visible <label> is programmatically associated with the input (for/id)", () => {
    open();
    const label = document.querySelector(
      ".add-assetspace-field label",
    ) as HTMLLabelElement;
    const input = urlInput();
    const id = input.getAttribute("id");
    expect(id).toBeTruthy();
    expect(label.getAttribute("for")).toBe(id);
  });

  it("both action buttons carry explicit aria-labels", () => {
    open();
    expect(findButton("Add")!.getAttribute("aria-label")).toBeTruthy();
    expect(findButton("Cancel")!.getAttribute("aria-label")).toBeTruthy();
  });

  it("manages focus — the URL field is focused on open", () => {
    open();
    expect(document.activeElement).toBe(urlInput());
  });

  it("focus lands on the field even when pre-filled (onboarding step 3)", () => {
    open("https://github.com/kitelev/exoas-starter-registry");
    expect(document.activeElement).toBe(urlInput());
    expect(urlInput().value).toBe(
      "https://github.com/kitelev/exoas-starter-registry",
    );
  });

  it("uses plain-text affordances only — no emoji-glyph-only button labels", () => {
    open();
    for (const btn of Array.from(document.querySelectorAll("button"))) {
      const txt = (btn.textContent ?? "").trim();
      // Every button has readable text (not an icon/emoji alone).
      expect(txt.length).toBeGreaterThan(1);
      expect(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+$/u.test(txt)).toBe(
        false,
      );
    }
  });
});
