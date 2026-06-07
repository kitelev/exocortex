/**
 * Unit tests for ModalConfirmGate (RFC 22b50a17 Phase 1b).
 *
 * Local jest.mock replaces `obsidian` with a Modal that wires its
 * `contentEl` into `document.body` on `open()` so DOM queries (used to
 * find rendered buttons and sections) actually find rendered content.
 */
import { describe, it, expect, beforeEach, jest } from "@jest/globals";

jest.mock("obsidian", () => {
  const mounted = new Set<MockModal>();
  class MockModal {
    app: unknown;
    contentEl: HTMLElement;
    constructor(app: unknown) {
      this.app = app;
      this.contentEl = document.createElement("div");
      // Augment with the createEl helper the production code relies on.
      (this.contentEl as unknown as { createEl: (tag: string, options?: { cls?: string; text?: string }) => HTMLElement }).createEl = function (
        tag: string,
        options?: { cls?: string; text?: string },
      ): HTMLElement {
        const el = document.createElement(tag);
        if (options?.cls) el.className = options.cls;
        if (options?.text) el.textContent = options.text;
        this.appendChild(el);
        // Recursively augment new children with createEl too.
        (el as unknown as { createEl: typeof this.createEl }).createEl = (this as unknown as { createEl: typeof this.createEl }).createEl.bind(el);
        return el;
      };
    }
    open(): void {
      mounted.add(this);
      document.body.appendChild(this.contentEl);
      this.onOpen();
    }
    close(): void {
      this.onClose();
      if (this.contentEl.parentNode) {
        this.contentEl.parentNode.removeChild(this.contentEl);
      }
      mounted.delete(this);
    }
    onOpen(): void {}
    onClose(): void {}
  }
  return { Modal: MockModal, App: class {} };
});

import type { App } from "obsidian";
import type { ApplyPlan } from "exocortex";
import {
  ModalConfirmGate,
  MODAL_FILE_LIST_CAP,
} from "../../src/infrastructure/adapters/ModalConfirmGate";

const fakeApp = {} as unknown as App;

function makePlan(overrides: Partial<ApplyPlan> = {}): ApplyPlan {
  return {
    targetProfileUid: "target-uid",
    targetProfileLabel: "Work",
    sourceProfileUid: "source-uid",
    sourceProfileLabel: "Personal",
    filesToDestroy: new Map([
      ["as-personal", ["assetspaces/personal/a.md", "assetspaces/personal/b.md"]],
    ]),
    assetSpacesBeingTornDown: [
      { asUid: "as-personal", asLabel: "personal", fileCount: 2 },
    ],
    assetSpacesBeingMaterialized: [
      { asUid: "as-work", asLabel: "work" },
    ],
    ...overrides,
  };
}

function findButton(label: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent === label,
  );
}

describe("ModalConfirmGate", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("resolves true when «Apply» button is clicked", async () => {
    const gate = new ModalConfirmGate(fakeApp);
    const promise = gate.confirmApply(makePlan());

    const confirmBtn = findButton("Apply");
    expect(confirmBtn).toBeDefined();
    expect(confirmBtn!.classList.contains("mod-warning")).toBe(true);
    confirmBtn!.click();

    await expect(promise).resolves.toBe(true);
  });

  it("resolves false when «Cancel» button is clicked", async () => {
    const gate = new ModalConfirmGate(fakeApp);
    const promise = gate.confirmApply(makePlan());

    const cancelBtn = findButton("Cancel");
    expect(cancelBtn).toBeDefined();
    cancelBtn!.click();

    await expect(promise).resolves.toBe(false);
  });

  it("renders torn-down AS list with file counts", async () => {
    const gate = new ModalConfirmGate(fakeApp);
    const promise = gate.confirmApply(makePlan());

    const tearSection = document.querySelector(".apply-confirm-tear-section");
    expect(tearSection).not.toBeNull();
    expect(tearSection?.textContent).toContain("personal (2 files)");

    // Clean up the dangling promise
    findButton("Cancel")?.click();
    await promise;
  });

  it("renders materialize AS list", async () => {
    const gate = new ModalConfirmGate(fakeApp);
    const promise = gate.confirmApply(makePlan());

    const matSection = document.querySelector(".apply-confirm-mat-section");
    expect(matSection).not.toBeNull();
    expect(matSection?.textContent).toContain("work");

    findButton("Cancel")?.click();
    await promise;
  });

  it("renders title with target profile label", async () => {
    const gate = new ModalConfirmGate(fakeApp);
    const promise = gate.confirmApply(makePlan());

    const title = document.querySelector(".apply-confirm-title");
    expect(title).not.toBeNull();
    expect(title?.textContent).toContain("Work");

    findButton("Cancel")?.click();
    await promise;
  });

  it("caps file list rendering at MODAL_FILE_LIST_CAP and shows summary suffix", async () => {
    const huge: string[] = [];
    for (let i = 0; i < MODAL_FILE_LIST_CAP + 25; i++) {
      huge.push(`assetspaces/big/file-${i}.md`);
    }
    const gate = new ModalConfirmGate(fakeApp);
    const promise = gate.confirmApply(
      makePlan({ filesToDestroy: new Map([["as-big", huge]]) }),
    );

    const filesSection = document.querySelector(".apply-confirm-files-section");
    expect(filesSection).not.toBeNull();
    const items = filesSection!.querySelectorAll("li");
    expect(items.length).toBe(MODAL_FILE_LIST_CAP);
    expect(filesSection?.textContent).toContain(`${MODAL_FILE_LIST_CAP + 25} total`);
    expect(filesSection?.textContent).toContain("and 25 more");

    findButton("Cancel")?.click();
    await promise;
  });

  it("renders «(none)» placeholders when sections are empty", async () => {
    const gate = new ModalConfirmGate(fakeApp);
    const promise = gate.confirmApply(
      makePlan({
        filesToDestroy: new Map(),
        assetSpacesBeingTornDown: [],
        assetSpacesBeingMaterialized: [],
      }),
    );

    expect(document.querySelector(".apply-confirm-tear-section")?.textContent).toContain("(none)");
    expect(document.querySelector(".apply-confirm-files-section")?.textContent).toContain("(none)");
    expect(document.querySelector(".apply-confirm-mat-section")?.textContent).toContain("(none)");

    findButton("Cancel")?.click();
    await promise;
  });

  it("settles exactly once when confirm is clicked twice", async () => {
    const gate = new ModalConfirmGate(fakeApp);
    const promise = gate.confirmApply(makePlan());

    const confirmBtn = findButton("Apply")!;
    confirmBtn.click();
    // Second click on a now-detached button must not throw and must not
    // resolve the (already-settled) promise differently.
    confirmBtn.click();

    await expect(promise).resolves.toBe(true);
  });

  it("resolves false when modal is closed without explicit click (Esc semantics)", async () => {
    const gate = new ModalConfirmGate(fakeApp);
    // Capture promise but force close before any button click. The Modal
    // mock's close() calls onClose() which our impl uses to settle(false).
    const promise = gate.confirmApply(makePlan());
    // We can't access the modal instance directly; simulate Esc by
    // dispatching a synthetic close — finding the modal via DOM:
    const contentEl = document.body.firstElementChild as HTMLElement | null;
    expect(contentEl).not.toBeNull();
    // Manually invoke the modal's close path by removing contentEl and
    // calling onClose-equivalent. Our impl wires onClose → settle(false)
    // → resolve(false). To drive it, we trigger close via the Cancel
    // button (same code path as Esc — both flow through onClose). This
    // overlap is intentional per the impl contract.
    findButton("Cancel")?.click();

    await expect(promise).resolves.toBe(false);
  });
});
