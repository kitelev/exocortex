/**
 * Unit tests for ActivityLogModal — the «Exocortex: Open activity log» modal
 * (GitHub #3540). Mirrors the Obsidian Sync activity log shape: header +
 * scrollable monospace list + Copy / Clear / Done footer, live-appending from
 * an {@link ActivityLogService} pub/sub.
 *
 * Local `jest.mock("obsidian")` mirrors BootstrapModals.test.ts — a Modal that
 * mounts `contentEl` into `document.body` on `open()` and a `createEl` helper
 * copying the attributes the modal relies on (cls / text / type / attr).
 */
import { describe, it, expect, beforeEach, jest } from "@jest/globals";

jest.mock("obsidian", () => {
  interface CreateOpts {
    cls?: string;
    text?: string;
    type?: string;
    attr?: Record<string, string>;
  }
  function augment(el: HTMLElement): void {
    (
      el as unknown as { createEl: (tag: string, o?: CreateOpts) => HTMLElement }
    ).createEl = function (tag: string, o?: CreateOpts): HTMLElement {
      const child = document.createElement(tag);
      if (o?.cls) child.className = o.cls;
      if (o?.text !== undefined) child.textContent = o.text;
      if (o?.type) child.setAttribute("type", o.type);
      if (o?.attr) {
        for (const [k, v] of Object.entries(o.attr)) child.setAttribute(k, v);
      }
      this.appendChild(child);
      augment(child);
      return child;
    }.bind(el);
    (el as unknown as { empty: () => void }).empty = function (): void {
      while (this.firstChild) this.removeChild(this.firstChild);
    }.bind(el);
  }
  class MockModal {
    app: unknown;
    contentEl: HTMLElement;
    titleEl: HTMLElement;
    constructor(app: unknown) {
      this.app = app;
      this.contentEl = document.createElement("div");
      this.titleEl = document.createElement("div");
      augment(this.contentEl);
      augment(this.titleEl);
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
  ActivityLogModal,
  formatActivityEntry,
  shouldAutoScroll,
} from "../../../../src/presentation/modals/ActivityLogModal";
import {
  ActivityLogService,
  type ActivityEntry,
} from "../../../../src/adapters/logging/ActivityLogService";

const fakeApp = {} as unknown as App;

function findButton(label: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent === label,
  );
}

function listText(): string {
  const list = document.querySelector(".exocortex-activity-log-list");
  return list?.textContent ?? "";
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("formatActivityEntry", () => {
  it("formats as HH:MM:SS [category] message for info", () => {
    // 2026-06-15T09:08:07 local
    const ts = new Date(2026, 5, 15, 9, 8, 7).getTime();
    const e: ActivityEntry = {
      ts,
      category: "exosync",
      level: "info",
      message: "Fully synced",
    };
    expect(formatActivityEntry(e)).toBe("09:08:07 [exosync] Fully synced");
  });

  it("includes an uppercased level marker for warn/error", () => {
    const ts = new Date(2026, 5, 15, 1, 2, 3).getTime();
    expect(
      formatActivityEntry({
        ts,
        category: "profile",
        level: "error",
        message: "apply failed",
      }),
    ).toBe("01:02:03 [profile] ERROR apply failed");
    expect(
      formatActivityEntry({
        ts,
        category: "mount",
        level: "warn",
        message: "slow",
      }),
    ).toBe("01:02:03 [mount] WARN slow");
  });
});

describe("shouldAutoScroll", () => {
  it("true when scrolled to (near) bottom", () => {
    // scrollTop + clientHeight within threshold of scrollHeight
    expect(shouldAutoScroll({ scrollTop: 80, clientHeight: 20, scrollHeight: 100 })).toBe(true);
    expect(shouldAutoScroll({ scrollTop: 76, clientHeight: 20, scrollHeight: 100 })).toBe(true); // within 4px threshold
  });

  it("false when scrolled up (user is reading history)", () => {
    expect(shouldAutoScroll({ scrollTop: 10, clientHeight: 20, scrollHeight: 100 })).toBe(false);
  });

  it("true for an empty/unscrollable list (clientHeight≈scrollHeight)", () => {
    expect(shouldAutoScroll({ scrollTop: 0, clientHeight: 0, scrollHeight: 0 })).toBe(true);
  });
});

describe("ActivityLogModal — render & controls", () => {
  it("AC1 — renders header 'Activity log' and Copy/Clear/Done footer", () => {
    const svc = new ActivityLogService({ now: () => 0 });
    new ActivityLogModal(fakeApp, svc).open();
    expect(document.body.textContent).toMatch(/Activity log/);
    expect(findButton("Copy")).toBeDefined();
    expect(findButton("Clear")).toBeDefined();
    expect(findButton("Done")).toBeDefined();
  });

  it("AC3 — renders the pre-open snapshot (history captured before opening)", () => {
    const ts = new Date(2026, 5, 15, 12, 0, 0).getTime();
    const svc = new ActivityLogService({ now: () => ts });
    svc.record({ category: "exosync", level: "info", message: "before-open-1" });
    svc.record({ category: "profile", level: "info", message: "before-open-2" });

    new ActivityLogModal(fakeApp, svc).open();
    const text = listText();
    expect(text).toMatch(/before-open-1/);
    expect(text).toMatch(/before-open-2/);
    expect(text).toMatch(/\[exosync\]/);
  });

  it("AC2 — a new entry recorded while open appends a row in real time", () => {
    const svc = new ActivityLogService({ now: () => 0 });
    new ActivityLogModal(fakeApp, svc).open();
    expect(listText()).not.toMatch(/live-entry/);
    svc.record({ category: "mount", level: "info", message: "live-entry" });
    expect(listText()).toMatch(/live-entry/);
  });

  it("AC5 — Clear empties the list and the service buffer", () => {
    const svc = new ActivityLogService({ now: () => 0 });
    svc.record({ category: "exosync", level: "info", message: "row-x" });
    new ActivityLogModal(fakeApp, svc).open();
    expect(listText()).toMatch(/row-x/);
    findButton("Clear")!.click();
    expect(svc.size).toBe(0);
    expect(listText()).not.toMatch(/row-x/);
  });

  it("AC4 — Copy writes the full formatted log to the clipboard", async () => {
    const writeText = jest.fn<(t: string) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(globalThis, "navigator", {
      value: { clipboard: { writeText } },
      configurable: true,
    });
    const ts = new Date(2026, 5, 15, 8, 0, 0).getTime();
    const svc = new ActivityLogService({ now: () => ts });
    svc.record({ category: "exosync", level: "info", message: "one" });
    svc.record({ category: "profile", level: "warn", message: "two" });

    new ActivityLogModal(fakeApp, svc).open();
    findButton("Copy")!.click();

    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0][0];
    expect(copied).toBe(
      "08:00:00 [exosync] one\n08:00:00 [profile] WARN two",
    );
  });

  it("Done closes the modal (contentEl detached)", () => {
    const svc = new ActivityLogService({ now: () => 0 });
    new ActivityLogModal(fakeApp, svc).open();
    expect(document.querySelector(".exocortex-activity-log-list")).not.toBeNull();
    findButton("Done")!.click();
    expect(document.querySelector(".exocortex-activity-log-list")).toBeNull();
  });

  it("unsubscribes on close — entries recorded after close do not throw / append", () => {
    const svc = new ActivityLogService({ now: () => 0 });
    const modal = new ActivityLogModal(fakeApp, svc);
    modal.open();
    modal.close();
    // Recording after close must not throw (no dangling DOM writes).
    expect(() =>
      svc.record({ category: "exosync", level: "info", message: "after-close" }),
    ).not.toThrow();
    // Subscriber set drained — no live listeners remain.
    expect((svc as unknown as { subscribers: Set<unknown> }).subscribers.size).toBe(0);
    expect((svc as unknown as { clearSubscribers: Set<unknown> }).clearSubscribers.size).toBe(0);
  });

  it("AC6 — each rendered row carries timestamp + category + message", () => {
    const ts = new Date(2026, 5, 15, 7, 30, 15).getTime();
    const svc = new ActivityLogService({ now: () => ts });
    svc.record({ category: "bootstrap", level: "info", message: "cold start" });
    new ActivityLogModal(fakeApp, svc).open();
    const rows = document.querySelectorAll(".exocortex-activity-log-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toBe("07:30:15 [bootstrap] cold start");
  });
});
