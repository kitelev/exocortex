/**
 * Unit tests for SimpleConfirmModal (Phase 6.2 bootstrap EC2 confirm) + its
 * RFC 0002 §3.11 / P16 accessibility contract.
 *
 * jsdom + a MockModal mounting `contentEl` into `document.body` on `open()` so
 * DOM queries and native `focus()` behave like real Obsidian.
 */
import { describe, it, expect, beforeEach, jest } from "@jest/globals";

jest.mock("obsidian", () => {
  class MockModal {
    app: unknown;
    contentEl: HTMLElement;
    constructor(app: unknown) {
      this.app = app;
      this.contentEl = document.createElement("div");
      (
        this.contentEl as unknown as {
          createEl: (tag: string, o?: { cls?: string; text?: string }) => HTMLElement;
        }
      ).createEl = function (
        tag: string,
        o?: { cls?: string; text?: string },
      ): HTMLElement {
        const el = document.createElement(tag);
        if (o?.cls) el.className = o.cls;
        if (o?.text) el.textContent = o.text;
        this.appendChild(el);
        (el as unknown as { createEl: typeof this.createEl }).createEl = (
          this as unknown as { createEl: typeof this.createEl }
        ).createEl.bind(el);
        return el;
      };
      (this.contentEl as unknown as { empty: () => void }).empty = function (): void {
        while (this.firstChild) this.removeChild(this.firstChild);
      };
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
import { SimpleConfirmModal } from "../../../../src/presentation/modals/SimpleConfirmModal";

const fakeApp = {} as unknown as App;

function open(
  opts: { title: string; body: string; confirmLabel?: string } = {
    title: "Re-materialise tracked AssetSpaces?",
    body: "This will pull the recorded URLs again.",
    confirmLabel: "Re-materialise",
  },
): { promise: Promise<boolean> } {
  let resolveRef: (v: boolean) => void = () => undefined;
  const promise = new Promise<boolean>((r) => {
    resolveRef = r;
  });
  new SimpleConfirmModal(fakeApp, opts, resolveRef).open();
  return { promise };
}

function findButton(label: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent === label,
  );
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("SimpleConfirmModal", () => {
  it("resolves true on the confirm button", async () => {
    const { promise } = open();
    findButton("Re-materialise")!.click();
    await expect(promise).resolves.toBe(true);
  });

  it("resolves false on Cancel", async () => {
    const { promise } = open();
    findButton("Cancel")!.click();
    await expect(promise).resolves.toBe(false);
  });

  it("defaults the confirm label to «Confirm»", () => {
    open({ title: "T", body: "B" });
    expect(findButton("Confirm")).toBeDefined();
  });

  describe("accessibility (P16, §3.11)", () => {
    it("both buttons carry explicit aria-labels", () => {
      open();
      expect(findButton("Re-materialise")!.getAttribute("aria-label")).toBeTruthy();
      expect(findButton("Cancel")!.getAttribute("aria-label")).toBeTruthy();
    });

    it("manages focus — lands on the primary confirm action (non-destructive proceed gate)", () => {
      open();
      expect(document.activeElement).toBe(findButton("Re-materialise"));
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
});
