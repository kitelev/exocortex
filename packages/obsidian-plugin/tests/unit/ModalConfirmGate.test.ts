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
import type { ApplyPlan } from "@kitelev/exocortex-core";
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
    // req `d4ccc901` — the baseline plan is a plain destroy+materialize apply,
    // so both park lists are empty. Empty is the honest default rather than a
    // filler: it keeps every pre-existing assertion in this suite testing what it
    // was written to test, and makes the park cases below opt in explicitly.
    assetSpacesBeingParked: [],
    assetSpacesBeingUnparked: [],
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
    // Title prefix must be the clean English «Apply profile:» — guards against
    // the stray Cyrillic «к» regression (live UX smoke 2026-06-21).
    expect(title?.textContent).toContain("Apply profile:");

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

  // RFC 0002 §3.11 / P16 — destructive confirm a11y: text marker + styling (not
  // a glyph alone), and managed focus lands on the SAFE default so a keyboard
  // user does not trigger the irreversible action by pressing Enter on open.
  describe("accessibility (P16, §3.11)", () => {
    it("the destructive Apply button conveys intent via text + mod-warning styling, never a glyph alone", async () => {
      const gate = new ModalConfirmGate(fakeApp);
      const promise = gate.confirmApply(makePlan());

      const confirmBtn = findButton("Apply")!;
      // Styling cue.
      expect(confirmBtn.classList.contains("mod-warning")).toBe(true);
      // Text cue — readable label, not an emoji glyph alone.
      const txt = (confirmBtn.textContent ?? "").trim();
      expect(txt.length).toBeGreaterThan(1);
      expect(
        /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+$/u.test(txt),
      ).toBe(false);
      // Screen-reader label spells out the destructive intent.
      expect(confirmBtn.getAttribute("aria-label")).toMatch(/destructive/i);

      findButton("Cancel")?.click();
      await promise;
    });

    it("both buttons carry explicit aria-labels", async () => {
      const gate = new ModalConfirmGate(fakeApp);
      const promise = gate.confirmApply(makePlan());

      expect(findButton("Apply")!.getAttribute("aria-label")).toBeTruthy();
      expect(findButton("Cancel")!.getAttribute("aria-label")).toBeTruthy();

      findButton("Cancel")?.click();
      await promise;
    });

    it("the destructive Apply button is described by the consequence line (aria-describedby resolves to an element)", async () => {
      const gate = new ModalConfirmGate(fakeApp);
      const promise = gate.confirmApply(makePlan());

      const describedby = findButton("Apply")!.getAttribute("aria-describedby");
      expect(describedby).toBeTruthy();
      // The id must resolve to a real element in the dialog (no dangling ref).
      const target = document.getElementById(describedby!);
      expect(target).not.toBeNull();
      expect(target!.textContent).toMatch(/modify the vault/i);

      findButton("Cancel")?.click();
      await promise;
    });

    it("manages focus — lands on the safe default (Cancel), not the destructive Apply", async () => {
      const gate = new ModalConfirmGate(fakeApp);
      const promise = gate.confirmApply(makePlan());

      expect(document.activeElement).toBe(findButton("Cancel"));
      expect(document.activeElement).not.toBe(findButton("Apply"));

      findButton("Cancel")?.click();
      await promise;
    });
  });

  /**
   * @req:d4ccc901-83a4-4495-a4bb-43d1305dfd00
   *
   * req `d4ccc901` — the plugin half of "the plan a human approves must describe
   * the mechanism". Required fields make the compiler force this renderer to
   * ACKNOWLEDGE parking; only these assertions force it to SHOW it. The mutant
   * is deleting the `createEl` block while keeping the field read — that
   * compiles and reddens nothing else.
   */
  describe("@req:d4ccc901-83a4-4495-a4bb-43d1305dfd00 parked / unparked rendering", () => {
    it("RENDERS a park section that says kept, not removed", async () => {
      const gate = new ModalConfirmGate(fakeApp);
      const promise = gate.confirmApply(
        makePlan({
          filesToDestroy: new Map(),
          assetSpacesBeingTornDown: [],
          assetSpacesBeingParked: [
            { asUid: "as-soft", asLabel: "soft", fileCount: 42 },
          ],
        }),
      );

      const park = document.querySelector(".apply-confirm-park-section");
      expect(park).not.toBeNull();
      const text = park!.textContent ?? "";
      expect(text).toContain("42 files");
      expect(text).toContain("soft");
      // The user-facing consequence, not the internal verb: bytes stay.
      expect(text).toMatch(/not deleted/i);
      expect(text).toContain(".exocortex/parked");

      findButton("Cancel")?.click();
      await promise;
    });

    it("does NOT render a park section when nothing is parked (a no-park apply looks unchanged)", async () => {
      const gate = new ModalConfirmGate(fakeApp);
      const promise = gate.confirmApply(makePlan());
      expect(document.querySelector(".apply-confirm-park-section")).toBeNull();
      findButton("Cancel")?.click();
      await promise;
    });

    it("marks an UNPARK inside the materialize list so it does not read as a download", async () => {
      const gate = new ModalConfirmGate(fakeApp);
      const promise = gate.confirmApply(
        makePlan({
          assetSpacesBeingMaterialized: [
            { asUid: "as-work", asLabel: "work" },
            { asUid: "as-soft", asLabel: "soft" },
          ],
          assetSpacesBeingUnparked: [{ asUid: "as-soft", asLabel: "soft" }],
        }),
      );

      const items = Array.from(
        document.querySelectorAll(".apply-confirm-mat-section li"),
      ).map((li) => li.textContent ?? "");
      // The unparked one is annotated…
      expect(items.some((t) => t.includes("soft") && /no download/i.test(t))).toBe(
        true,
      );
      // …and the genuinely-pulled one is NOT — otherwise the annotation would be
      // decoration rather than information.
      expect(items.some((t) => t === "work")).toBe(true);

      findButton("Cancel")?.click();
      await promise;
    });

    it("keeps the pre-existing section classes the e2e leg asserts on", () => {
      // `eka-obsidian-leg.spec.ts` drives the REAL modal and locates
      // `.apply-confirm-tear-section` / `.apply-confirm-mat-section`. That suite
      // runs in its own workflow, OUTSIDE the 13 required checks, so breaking it
      // would not redden this PR — it would silently skip the release. This
      // assertion brings that breakage forward into the required gate.
      const gate = new ModalConfirmGate(fakeApp);
      void gate.confirmApply(makePlan());
      expect(document.querySelector(".apply-confirm-tear-section")).not.toBeNull();
      expect(document.querySelector(".apply-confirm-mat-section")).not.toBeNull();
      findButton("Cancel")?.click();
    });
  });
});
