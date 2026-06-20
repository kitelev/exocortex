/**
 * Unit tests for LogFileModal — the «Exocortex: Open logs» modal (RFC 0002
 * §3.8 P12, GitHub #3588). It surfaces the persisted `exocortex-logs.txt` and
 * its REAL location (the plugin data folder, not the vault root).
 *
 * Local `jest.mock("obsidian")` mirrors ActivityLogModal.test.ts — a Modal that
 * mounts `contentEl` into `document.body` on `open()` and a `createEl` helper.
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
  LogFileModal,
  EMPTY_LOG_HINT,
  type LogFileSource,
} from "@plugin/presentation/modals/LogFileModal";

const LOG_PATH = ".obsidian/plugins/exocortex/exocortex-logs.txt";

/** Production-shape fake: exposes the real LogFileSource contract. */
function makeSource(content: string): LogFileSource {
  return {
    getLogFilePath: () => LOG_PATH,
    read: jest.fn<() => Promise<string>>().mockResolvedValue(content),
  };
}

/** Let the async load() in onOpen resolve before asserting. */
const flush = () => new Promise((r) => setTimeout(r, 0));

const fakeApp = {} as App;

describe("LogFileModal", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("shows the REAL log path (plugin data folder, not vault root)", async () => {
    const modal = new LogFileModal(fakeApp, makeSource("[INFO] ready\n"));
    modal.open();
    await flush();

    const pathEl = document.body.querySelector(".exocortex-log-file-path");
    expect(pathEl?.textContent).toBe(LOG_PATH);
    expect(pathEl?.textContent).toContain(".obsidian/plugins/exocortex");
  });

  it("renders the log file content when present", async () => {
    const content = "[2026-06-19T00:00:00Z] [ERROR] [Init] boom\n";
    const modal = new LogFileModal(fakeApp, makeSource(content));
    modal.open();
    await flush();

    const row = document.body.querySelector(".exocortex-activity-log-row");
    expect(row?.textContent).toBe(content);
    // No empty hint when content exists.
    expect(document.body.querySelector(".exocortex-activity-log-empty")).toBeNull();
  });

  it("shows the empty hint (info logging off by default) when the file is empty/absent", async () => {
    const modal = new LogFileModal(fakeApp, makeSource(""));
    modal.open();
    await flush();

    const empty = document.body.querySelector(".exocortex-activity-log-empty");
    expect(empty?.textContent).toBe(EMPTY_LOG_HINT);
    expect(empty?.textContent).toContain("Open activity log");
    expect(document.body.querySelector(".exocortex-activity-log-row")).toBeNull();
  });

  it("copies the loaded content to the clipboard via Copy", async () => {
    const writeText = jest.fn<(t: string) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(globalThis, "navigator", {
      value: { clipboard: { writeText } },
      configurable: true,
    });

    const content = "[INFO] hello\n";
    const modal = new LogFileModal(fakeApp, makeSource(content));
    modal.open();
    await flush();

    const buttons = Array.from(document.body.querySelectorAll("button"));
    const copyBtn = buttons.find((b) => b.textContent === "Copy");
    copyBtn?.dispatchEvent(new Event("click"));
    await flush();

    expect(writeText).toHaveBeenCalledWith(content);
  });

  it("clears its DOM on close (no leaked rows)", async () => {
    const modal = new LogFileModal(fakeApp, makeSource("[INFO] x\n"));
    modal.open();
    await flush();
    modal.close();

    expect(document.body.querySelector(".exocortex-activity-log-row")).toBeNull();
    expect(document.body.querySelector(".exocortex-log-file-path")).toBeNull();
  });
});

// «Open logs» ↔ «Open activity log» dedup (interview decision (b), 2026-06-20):
// the file→activity half of the reciprocal cross-nav bridge. The empty-state
// hint already pointed users at the live stream; this promotes that to a
// one-click footer button (and the activity→file half lives in ActivityLogModal).
describe("LogFileModal — cross-nav to activity log", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  const findButton = (label: string): HTMLButtonElement | undefined =>
    Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent === label,
    ) as HTMLButtonElement | undefined;

  it("renders an «Open activity log» footer button when the cross-nav hook is provided", () => {
    const modal = new LogFileModal(fakeApp, makeSource(""), () => {});
    modal.open(); // button is created synchronously in onOpen, before load()
    expect(findButton("Open activity log")).toBeDefined();
    expect(findButton("Copy")).toBeDefined();
    expect(findButton("Done")).toBeDefined();
  });

  it("omits the «Open activity log» button when no cross-nav hook is given (backward compatible)", () => {
    const modal = new LogFileModal(fakeApp, makeSource(""));
    modal.open();
    expect(findButton("Open activity log")).toBeUndefined();
  });

  it("«Open activity log» invokes the hook and closes this modal (views never stack)", () => {
    const onOpenActivityLog = jest.fn();
    const modal = new LogFileModal(fakeApp, makeSource(""), onOpenActivityLog);
    modal.open();
    expect(document.body.querySelector(".exocortex-log-file-path")).not.toBeNull();
    findButton("Open activity log")!.click();
    expect(onOpenActivityLog).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector(".exocortex-log-file-path")).toBeNull();
  });
});
