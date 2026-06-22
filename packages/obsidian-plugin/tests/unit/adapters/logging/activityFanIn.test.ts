/**
 * Unit tests for activityFanIn — pure mapping of ProfileApplyManager journal
 * entries to activity-log records (#3540). The integration contract that the
 * modal surfaces profile/mount events correctly hinges on this mapping.
 */
import { describe, it, expect } from "@jest/globals";
import {
  journalEntryToActivity,
  progressToActivity,
  indexProgressToActivity,
} from "../../../../src/adapters/logging/activityFanIn";
import type {
  ApplyProgressEvent,
  SwitchJournalEntry,
} from "../../../../src/infrastructure/adapters/ProfileApplyManager";

const base = { targetUid: "profile-xyz-uid", ts: "2026-06-15T00:00:00.000Z" };

describe("journalEntryToActivity", () => {
  it("overall apply phases (no `as`) → category 'profile'", () => {
    const e: SwitchJournalEntry = { ...base, phase: "starting" };
    expect(journalEntryToActivity(e)).toEqual({
      category: "profile",
      level: "info",
      message: "Apply starting",
    });
  });

  it("per-AssetSpace phase (carries `as`) → category 'mount' with 8-char prefix", () => {
    const e: SwitchJournalEntry = {
      ...base,
      phase: "phase2-materialized",
      as: "1b20a8f0-d745-4e93-91db-4531b3df120e",
    };
    expect(journalEntryToActivity(e)).toEqual({
      category: "mount",
      level: "info",
      message: "Mounted 1b20a8f0",
    });
  });

  it("unmount (phase2-destroyed + as) → mount category, 'Unmounted'", () => {
    const e: SwitchJournalEntry = {
      ...base,
      phase: "phase2-destroyed",
      as: "abcd1234-5678-90ab-cdef-1234567890ab",
    };
    const r = journalEntryToActivity(e);
    expect(r.category).toBe("mount");
    expect(r.message).toBe("Unmounted abcd1234");
  });

  it("failed phases → level 'error', error text appended", () => {
    const e: SwitchJournalEntry = {
      ...base,
      phase: "apply-failed",
      error: "PAT rejected",
    };
    expect(journalEntryToActivity(e)).toEqual({
      category: "profile",
      level: "error",
      message: "Apply failed: PAT rejected",
    });
  });

  it("aborted phase → level 'error'", () => {
    const e: SwitchJournalEntry = { ...base, phase: "aborted-phase1" };
    expect(journalEntryToActivity(e).level).toBe("error");
  });

  it("completed phase appends elapsed time", () => {
    const e: SwitchJournalEntry = {
      ...base,
      phase: "apply-completed",
      elapsedMs: 1234,
    };
    expect(journalEntryToActivity(e)).toEqual({
      category: "profile",
      level: "info",
      message: "Apply completed (1234ms)",
    });
  });

  it("every declared journal phase maps to a non-empty info/error record", () => {
    const phases: SwitchJournalEntry["phase"][] = [
      "starting",
      "completed",
      "failed",
      "apply-starting",
      "phase1-pulling",
      "phase1-pulled",
      "phase1-done",
      "aborted-phase1",
      "phase2-start",
      "phase2-destroy-cached",
      "phase2-destroyed",
      "phase2-materializing",
      "phase2-materialized",
      "phase2-done",
      "git-commit-done",
      "apply-completed",
      "apply-failed",
      "recovery-restoring",
      "recovery-completed",
    ];
    for (const phase of phases) {
      const r = journalEntryToActivity({ ...base, phase });
      expect(r.message.length).toBeGreaterThan(0);
      expect(["info", "error"]).toContain(r.level);
      // phase string should not leak raw unless intentionally unmapped
      expect(r.message).not.toBe(phase);
    }
  });
});

type PerAsProgress = Extract<ApplyProgressEvent, { as: string }>;

describe("progressToActivity (live materialize progress feed)", () => {
  const evt = (over: Partial<PerAsProgress>): ApplyProgressEvent => ({
    op: "mount",
    as: "1b20a8f0-d745-4e93-91db-4531b3df120e",
    label: "ems",
    index: 1,
    total: 3,
    ...over,
  });

  it("mount → category 'progress', info level, 'Mounting <label> <prefix> (N of M)'", () => {
    expect(progressToActivity(evt({ op: "mount", index: 2, total: 5 }))).toEqual(
      {
        category: "progress",
        level: "info",
        message: "Mounting ems 1b20a8f0 (2 of 5)",
      },
    );
  });

  it("unmount → 'Unmounting …'", () => {
    expect(progressToActivity(evt({ op: "unmount", label: "kpc" })).message).toBe(
      "Unmounting kpc 1b20a8f0 (1 of 3)",
    );
  });

  it("pull → 'Pulling …'", () => {
    expect(progressToActivity(evt({ op: "pull" })).message).toBe(
      "Pulling ems 1b20a8f0 (1 of 3)",
    );
  });

  it("progress is ALWAYS category 'progress' (never toasted — distinct from journal feed)", () => {
    for (const op of ["pull", "mount", "unmount"] as const) {
      expect(progressToActivity(evt({ op })).category).toBe("progress");
    }
  });

  it("omits a redundant label when it equals the 8-char UID prefix", () => {
    expect(
      progressToActivity(evt({ label: "1b20a8f0", index: 1, total: 1 })).message,
    ).toBe("Mounting 1b20a8f0 (1 of 1)");
  });

  // ── #al-activitylog-progress: finer within-AS sub-steps + reindex marker ──

  it("within-AS sub-step (step:'fetch') → 'Fetching …'", () => {
    expect(progressToActivity(evt({ op: "mount", step: "fetch" })).message).toBe(
      "Fetching ems 1b20a8f0 (1 of 3)",
    );
  });

  it("within-AS sub-step (step:'extract') → 'Extracting …'", () => {
    expect(
      progressToActivity(evt({ op: "mount", step: "extract" })).message,
    ).toBe("Extracting ems 1b20a8f0 (1 of 3)");
  });

  it("within-AS sub-step (step:'materialize') → 'Installing …'", () => {
    expect(
      progressToActivity(evt({ op: "mount", step: "materialize", index: 2, total: 5 }))
        .message,
    ).toBe("Installing ems 1b20a8f0 (2 of 5)");
  });

  // ── al-mount-observability: granular within-AS install file progress ──

  it("formats a within-AS materialize file tick as 'Installing <label> <uid8>: N of M files (X%)' @req:eba100d5-503f-43e0-bd31-994dd6303c37", () => {
    expect(
      progressToActivity(
        evt({
          op: "mount",
          step: "materialize",
          label: "my",
          as: "08dd15ed-0000-0000-0000-000000000000",
          fileProcessed: 400,
          fileTotal: 5000,
        }),
      ),
    ).toEqual({
      category: "progress",
      level: "info",
      message: "Installing my 08dd15ed: 400 of 5000 files (8%)",
    });
  });

  it("rounds the install percent (200 of 1000 → 20%) @req:eba100d5-503f-43e0-bd31-994dd6303c37", () => {
    expect(
      progressToActivity(
        evt({ op: "mount", step: "materialize", fileProcessed: 200, fileTotal: 1000 }),
      ).message,
    ).toBe("Installing ems 1b20a8f0: 200 of 1000 files (20%)");
  });

  it("a materialize event WITHOUT file counts keeps the per-AS '(N of M)' form (no regression)", () => {
    expect(
      progressToActivity(evt({ op: "mount", step: "materialize", index: 3, total: 7 })).message,
    ).toBe("Installing ems 1b20a8f0 (3 of 7)");
  });

  it("reindex marker → 'Reindexing vault after apply' (category 'progress', info)", () => {
    expect(progressToActivity({ op: "reindex" })).toEqual({
      category: "progress",
      level: "info",
      message: "Reindexing vault after apply",
    });
  });
});

describe("indexProgressToActivity (periodic full-walk progress)", () => {
  it("maps (processed, total) → 'Indexing vault: N of M assets', category 'progress'", () => {
    expect(indexProgressToActivity(400, 5123)).toEqual({
      category: "progress",
      level: "info",
      message: "Indexing vault: 400 of 5123 assets",
    });
  });

  it("is always category 'progress', info level", () => {
    const r = indexProgressToActivity(1, 1);
    expect(r.category).toBe("progress");
    expect(r.level).toBe("info");
  });
});
