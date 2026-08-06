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
      // req `d4ccc901` — the two park stages belong in this enumeration too.
      // ⛔ A hand-written list is exactly the surface that goes a layer stale:
      // it stayed green through the whole park change because a MISSING entry
      // is invisible to it, which is why the semantic axes below assert on the
      // label CONTENT rather than on the list's completeness.
      "phase2-parked",
      "phase2-unparked",
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

  /**
   * @req:d4ccc901-83a4-4495-a4bb-43d1305dfd00
   *
   * req `d4ccc901` — the activity log is the SECOND carrier of the claim "these
   * files are gone" (the switch-journal is the first). A park logged as an
   * unmount is not cosmetic: this log is where a user looks AFTER the fact to
   * answer "where did my files go", and "Unmounted" sends them hunting a
   * re-download instead of the one-rename return.
   *
   * ⛔ The compiler cannot guard this. `PHASE_LABELS` / `PROGRESS_VERBS` are
   * plain maps: delete the `park` entry and the lookup silently falls back
   * (`?? entry.phase` here, `?? op` in the verb path) or — worse — someone
   * "simplifies" it by pointing park at the unmount label. Both compile. Only an
   * assertion on the label's MEANING reddens.
   *
   * Mutant per axis: point `park` at the `unmount`/`phase2-destroyed` label →
   * exactly these reden; every other test in this file stays green.
   */
  it("a PARKED stage never says removed/unmounted — it says the bytes stayed", () => {
    const r = journalEntryToActivity({
      ...base,
      phase: "phase2-parked",
      as: "abcd1234-5678-90ab-cdef-1234567890ab",
    });
    expect(r.category).toBe("mount");
    expect(r.level).toBe("info");
    // ⛔ The claim it must NOT make.
    expect(r.message).not.toMatch(/unmount|destroy|remov|delet/i);
    // …and the claim it MUST make: still on this device.
    expect(r.message).toMatch(/park/i);
    expect(r.message).toMatch(/device/i);
    expect(r.message).toContain("abcd1234");
  });

  it("an UNPARKED stage never reads as a fresh download", () => {
    const r = journalEntryToActivity({
      ...base,
      phase: "phase2-unparked",
      as: "abcd1234-5678-90ab-cdef-1234567890ab",
    });
    expect(r.category).toBe("mount");
    // "Mounted"/"Pulling" would hide that nothing crossed the network.
    expect(r.message).not.toMatch(/mounted|pull|download|fetch/i);
    expect(r.message).toMatch(/restored/i);
    expect(r.message).toMatch(/device/i);
  });

  it("park and destroy are DISTINGUISHABLE in the log (negative control)", () => {
    // The pairing is the point: a reader scanning the log must be able to tell
    // the two apart. If a future edit collapses park onto the destroy label this
    // is the assertion that notices, even if both individually "look fine".
    const parked = journalEntryToActivity({ ...base, phase: "phase2-parked", as: "aaaa1111" });
    const destroyed = journalEntryToActivity({ ...base, phase: "phase2-destroyed", as: "aaaa1111" });
    expect(parked.message).not.toBe(destroyed.message);
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

  /**
   * @req:d4ccc901-83a4-4495-a4bb-43d1305dfd00
   *
   * req `d4ccc901` — the live-feed half of the same claim. `PROGRESS_VERBS` is a
   * `Record`, so the compiler forces the two new ops to HAVE an entry — it
   * cannot force that entry to mean the right thing. Mutant: point `park` at
   * `"Unmounting"` (or drop the entry so the `?? op` fallback fires) → only
   * these two reden.
   */
  it("park → its OWN verb, never 'Unmounting'", () => {
    const m = progressToActivity(evt({ op: "park", label: "public" })).message;
    expect(m).toBe("Parking public 1b20a8f0 (1 of 3)");
    expect(m).not.toMatch(/unmount|remov|delet/i);
    // The fallback would print the raw op name — catch that too.
    expect(m).not.toContain("park 1b20a8f0");
  });

  it("unpark → its OWN verb, never 'Mounting' (nothing crosses the network)", () => {
    const m = progressToActivity(evt({ op: "unpark", label: "public" })).message;
    expect(m).toMatch(/restoring/i);
    expect(m).toMatch(/device/i);
    expect(m).not.toMatch(/mounting|pulling|download/i);
  });

  it("progress is ALWAYS category 'progress' (never toasted — distinct from journal feed)", () => {
    // req `d4ccc901` — the two new ops ride the same rule (a park must not
    // start toasting where an unmount does not).
    for (const op of ["pull", "mount", "unmount", "park", "unpark"] as const) {
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
