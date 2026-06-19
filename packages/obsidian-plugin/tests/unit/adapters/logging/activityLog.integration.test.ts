/**
 * Integration test for the #3540 activity-log fan-in: composes the REAL
 * collaborating units exactly as `ExocortexPlugin.onload()` wires them —
 *   - ExoSync `logInfo`/`log` → activityLog.record({category:"exosync", ...})
 *   - ProfileApplyManager `onPhase` → activityLog.record(journalEntryToActivity)
 *   - every toast via ObsidianNotificationService → record({category:"notice"})
 *     (bootstrap / add-assetspace / unmount progress flow through here now —
 *     the central notifier is the single sink, #3540 follow-up)
 * — feeds simulated producer events, then renders an ActivityLogModal over the
 * resulting buffer and asserts the categories surface correctly (AC2/AC3/AC6).
 *
 * This is the contract the plugin relies on; it does not stand up the whole
 * plugin (the wiring is one-liners verified here against the real mappers).
 */
import { describe, it, expect, beforeEach } from "@jest/globals";

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
      if (o?.text !== undefined) child.textContent = o.text;
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
      this.contentEl.parentNode?.removeChild(this.contentEl);
    }
    onOpen(): void {}
    onClose(): void {}
  }
  return {
    Modal: MockModal,
    App: class {},
    // The real ObsidianNotificationService constructs `new Notice(...)`; a noop
    // class is enough for the recording-path assertions below.
    Notice: class {
      constructor(_message?: string, _duration?: number) {}
    },
  };
});

import type { App } from "obsidian";
import { ActivityLogService } from "../../../../src/adapters/logging/ActivityLogService";
import { journalEntryToActivity } from "../../../../src/adapters/logging/activityFanIn";
import { ActivityLogModal } from "../../../../src/presentation/modals/ActivityLogModal";
import { ObsidianNotificationService } from "../../../../src/infrastructure/di/ObsidianNotificationService";
import type { SwitchJournalEntry } from "../../../../src/infrastructure/adapters/ProfileApplyManager";

const fakeApp = {} as unknown as App;

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("activity-log fan-in (integration)", () => {
  it("fans ExoSync + profile + mount + bootstrap events into one categorized stream", () => {
    const svc = new ActivityLogService({ now: () => 0 });

    // Wire exactly as ExocortexPlugin.onload does.
    const onSyncInfo = (message: string): void =>
      svc.record({ category: "exosync", level: "info", message });
    const onPhase = (entry: SwitchJournalEntry): void =>
      svc.record(journalEntryToActivity(entry));
    const onBootstrap = (message: string): void =>
      svc.record({ category: "bootstrap", level: "info", message });

    // --- Simulate producers (the events these sources actually emit) ---
    onBootstrap("Bootstrapping vault...");
    onSyncInfo("Detecting changes for exo");
    onSyncInfo("Fully synced");
    onPhase({ phase: "apply-starting", targetUid: "p1", ts: "t" });
    onPhase({
      phase: "phase2-materialized",
      targetUid: "p1",
      ts: "t",
      as: "1b20a8f0-d745-4e93-91db-4531b3df120e",
    });
    onPhase({
      phase: "phase2-destroyed",
      targetUid: "p1",
      ts: "t",
      as: "abcd1234-0000-0000-0000-000000000000",
    });
    onPhase({ phase: "apply-completed", targetUid: "p1", ts: "t", elapsedMs: 50 });

    const snap = svc.getSnapshot();
    const byCategory = snap.reduce<Record<string, number>>((acc, e) => {
      acc[e.category] = (acc[e.category] ?? 0) + 1;
      return acc;
    }, {});
    expect(byCategory).toEqual({
      bootstrap: 1,
      exosync: 2,
      profile: 2, // apply-starting + apply-completed
      mount: 2, // materialized + destroyed (per-AS)
    });

    // --- Render the modal over the captured history (AC3) ---
    new ActivityLogModal(fakeApp, svc).open();
    const text = document.querySelector(
      ".exocortex-activity-log-list",
    )?.textContent;
    expect(text).toMatch(/\[bootstrap\] Bootstrapping vault/);
    expect(text).toMatch(/\[exosync\] Fully synced/);
    expect(text).toMatch(/\[mount\] Mounted 1b20a8f0/);
    expect(text).toMatch(/\[mount\] Unmounted abcd1234/);
    expect(text).toMatch(/\[profile\] Apply completed \(50ms\)/);
  });

  it("Bug 1 — the real notifier fans EVERY toast into the activity log (category 'notice')", () => {
    // Production-shape: wire the REAL ObsidianNotificationService to the REAL
    // ActivityLogService exactly as ExocortexPlugin.onload does, then emit the
    // four toast kinds and assert each lands in the stream. Pre-fix, these
    // toasts bypassed the log entirely (the bug).
    jest.spyOn(console, "debug").mockImplementation(() => undefined);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);

    const svc = new ActivityLogService({ now: () => 0 });
    const notifier = new ObsidianNotificationService({
      recordActivity: ({ level, message }) =>
        svc.record({ category: "notice", level, message }),
    });

    notifier.info("Saved settings");
    notifier.warn("PAT not set");
    notifier.error("Sync failed: 403");
    notifier.success("Applied profile");

    expect(
      svc.getSnapshot().map((e) => ({
        category: e.category,
        level: e.level,
        message: e.message,
      })),
    ).toEqual([
      { category: "notice", level: "info", message: "Saved settings" },
      { category: "notice", level: "warn", message: "PAT not set" },
      { category: "notice", level: "error", message: "Sync failed: 403" },
      { category: "notice", level: "info", message: "Applied profile" },
    ]);

    // Surfaces in the modal with the level marker rendered (AC3).
    new ActivityLogModal(fakeApp, svc).open();
    const text = document.querySelector(
      ".exocortex-activity-log-list",
    )?.textContent;
    expect(text).toMatch(/\[notice\] Saved settings/);
    expect(text).toMatch(/\[notice\] WARN PAT not set/);
    expect(text).toMatch(/\[notice\] ERROR Sync failed: 403/);
    expect(text).toMatch(/\[notice\] Applied profile/);

    jest.restoreAllMocks();
  });

  it("AC2 — events recorded after the modal opens append live", () => {
    const svc = new ActivityLogService({ now: () => 0 });
    const onPhase = (entry: SwitchJournalEntry): void =>
      svc.record(journalEntryToActivity(entry));

    new ActivityLogModal(fakeApp, svc).open();
    onPhase({
      phase: "phase2-materializing",
      targetUid: "p1",
      ts: "t",
      as: "deadbeef-0000-0000-0000-000000000000",
    });
    const text = document.querySelector(
      ".exocortex-activity-log-list",
    )?.textContent;
    expect(text).toMatch(/\[mount\] Materializing deadbeef/);
  });
});
