/**
 * Unit tests for ClearSwitchCacheConfirmModal (RFC 22b50a17 Decision #6) +
 * its RFC 0002 §3.11 / P16 accessibility contract.
 *
 * jsdom + a MockModal mounting `contentEl` into `document.body` on `open()` with
 * the recursive `createEl` the production code relies on, so DOM queries and
 * native `focus()` behave like real Obsidian.
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
import { ClearSwitchCacheConfirmModal } from "../../src/infrastructure/adapters/ClearSwitchCacheConfirmModal";

const fakeApp = {} as unknown as App;

function open(
  summary: { entryCount: number; totalSize: number } = {
    entryCount: 3,
    totalSize: 2_500_000,
  },
): { promise: Promise<boolean> } {
  let resolveRef: (v: boolean) => void = () => undefined;
  const promise = new Promise<boolean>((r) => {
    resolveRef = r;
  });
  new ClearSwitchCacheConfirmModal(fakeApp, summary, resolveRef).open();
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

describe("ClearSwitchCacheConfirmModal", () => {
  it("resolves true on «Clear» and renders the destructive styling", async () => {
    const { promise } = open();
    const clearBtn = findButton("Clear")!;
    expect(clearBtn.classList.contains("mod-warning")).toBe(true);
    clearBtn.click();
    await expect(promise).resolves.toBe(true);
  });

  it("resolves false on «Cancel»", async () => {
    const { promise } = open();
    findButton("Cancel")!.click();
    await expect(promise).resolves.toBe(false);
  });

  it("renders the entry count + size in the body", () => {
    open({ entryCount: 1, totalSize: 512 });
    expect(document.body.textContent).toContain("1 cached AssetSpace entry");
    expect(document.body.textContent).toContain("512 B");
  });

  describe("accessibility (P16, §3.11)", () => {
    it("the destructive Clear button uses text + styling, never a glyph alone", () => {
      open();
      const clearBtn = findButton("Clear")!;
      expect(clearBtn.classList.contains("mod-warning")).toBe(true);
      const txt = (clearBtn.textContent ?? "").trim();
      expect(txt.length).toBeGreaterThan(1);
      expect(
        /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+$/u.test(txt),
      ).toBe(false);
      expect(clearBtn.getAttribute("aria-label")).toMatch(/cannot be undone/i);
    });

    it("both buttons carry explicit aria-labels", () => {
      open();
      expect(findButton("Clear")!.getAttribute("aria-label")).toBeTruthy();
      expect(findButton("Cancel")!.getAttribute("aria-label")).toBeTruthy();
    });

    it("the destructive Clear button is described by the consequence line (count + size + irreversibility)", () => {
      open({ entryCount: 2, totalSize: 4096 });
      const describedby = findButton("Clear")!.getAttribute("aria-describedby");
      expect(describedby).toBeTruthy();
      const target = document.getElementById(describedby!);
      expect(target).not.toBeNull();
      expect(target!.textContent).toMatch(/cannot be undone/i);
      expect(target!.textContent).toContain("2 cached AssetSpace entries");
    });

    it("manages focus — lands on the safe default (Cancel), not the destructive Clear", () => {
      open();
      expect(document.activeElement).toBe(findButton("Cancel"));
      expect(document.activeElement).not.toBe(findButton("Clear"));
    });
  });
});
