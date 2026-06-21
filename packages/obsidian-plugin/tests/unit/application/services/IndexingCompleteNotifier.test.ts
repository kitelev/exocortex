import { IndexingCompleteNotifier } from "../../../../src/application/services/IndexingCompleteNotifier";
import type { VaultWalkStats } from "../../../../src/infrastructure/VaultRDFIndexer";
import type { INotificationService } from "@kitelev/exocortex-core";

/**
 * Issue #3472 — one-shot «indexing complete» notice.
 *
 * Production-shape fake: a full INotificationService implementation that
 * records every call per channel, mirroring ObsidianNotificationService's
 * contract (info() shows the message verbatim as a Notice; no prefix).
 */
class RecordingNotificationService implements INotificationService {
  readonly infoCalls: Array<{ message: string; duration?: number }> = [];
  readonly successCalls: string[] = [];
  readonly errorCalls: string[] = [];
  readonly warnCalls: string[] = [];

  info(message: string, duration?: number): void {
    this.infoCalls.push({ message, duration });
  }
  success(message: string): void {
    this.successCalls.push(message);
  }
  error(message: string): void {
    this.errorCalls.push(message);
  }
  warn(message: string): void {
    this.warnCalls.push(message);
  }
  async confirm(): Promise<boolean> {
    return false;
  }
}

function makeStats(overrides: Partial<VaultWalkStats> = {}): VaultWalkStats {
  return {
    total: 100,
    indexed: 97,
    skipped: 3,
    durationMs: 4230,
    finishedAt: 1000,
    ...overrides,
  };
}

describe("IndexingCompleteNotifier (Issue #3472)", () => {
  let notifier: RecordingNotificationService;
  let emitter: IndexingCompleteNotifier;

  beforeEach(() => {
    notifier = new RecordingNotificationService();
    emitter = new IndexingCompleteNotifier(notifier);
  });

  describe("first full indexing pass", () => {
    it("emits exactly one info notice with N files / M skipped / duration", () => {
      emitter.notifyOnce(makeStats(), 500);

      expect(notifier.infoCalls).toHaveLength(1);
      expect(notifier.infoCalls[0].message).toBe(
        "Exocortex: indexing complete (97 files, 3 skipped, 4.2s)",
      );
    });

    it("does not use warn/error/success channels", () => {
      emitter.notifyOnce(makeStats(), 500);

      expect(notifier.warnCalls).toHaveLength(0);
      expect(notifier.errorCalls).toHaveLength(0);
      expect(notifier.successCalls).toHaveLength(0);
    });

    it("uses singular 'file' when exactly one file was indexed", () => {
      emitter.notifyOnce(makeStats({ indexed: 1, skipped: 0 }), 500);

      expect(notifier.infoCalls).toHaveLength(1);
      expect(notifier.infoCalls[0].message).toBe(
        "Exocortex: indexing complete (1 file, 0 skipped, 4.2s)",
      );
    });

    it("formats sub-second durations with one decimal", () => {
      emitter.notifyOnce(makeStats({ durationMs: 850 }), 500);

      expect(notifier.infoCalls[0].message).toBe(
        "Exocortex: indexing complete (97 files, 3 skipped, 0.9s)",
      );
    });

    it("reports an empty vault as 0 files, 0 skipped", () => {
      emitter.notifyOnce(
        makeStats({ total: 0, indexed: 0, skipped: 0, durationMs: 12 }),
        500,
      );

      expect(notifier.infoCalls).toHaveLength(1);
      expect(notifier.infoCalls[0].message).toBe(
        "Exocortex: indexing complete (0 files, 0 skipped, 0.0s)",
      );
    });
  });

  describe("one-shot semantics", () => {
    it("stays quiet on a second call (subsequent full refreshes are silent)", () => {
      emitter.notifyOnce(makeStats(), 500);
      emitter.notifyOnce(makeStats({ finishedAt: 9000 }), 500);

      expect(notifier.infoCalls).toHaveLength(1);
    });

    it("stays quiet on every later call regardless of stats", () => {
      emitter.notifyOnce(makeStats(), 500);
      for (let i = 0; i < 5; i++) {
        emitter.notifyOnce(makeStats({ finishedAt: 10_000 + i }), 0);
      }

      expect(notifier.infoCalls).toHaveLength(1);
    });
  });

  describe("guards that must NOT latch the one-shot flag", () => {
    it("does nothing when stats are null (no walk recorded yet)", () => {
      emitter.notifyOnce(null, 500);

      expect(notifier.infoCalls).toHaveLength(0);
    });

    it("still emits later after a null-stats call (null did not latch)", () => {
      emitter.notifyOnce(null, 500);
      emitter.notifyOnce(makeStats(), 500);

      expect(notifier.infoCalls).toHaveLength(1);
    });

    it("does nothing when stats are stale (finished before the caller's walk started)", () => {
      // Coalesced-refresh false-positive guard: the post-resolve chain's
      // refresh() may coalesce into an in-flight refresh that fails with
      // a swallowed error; getLastWalkStats() would then still hold the
      // stats of the EARLIER eager-init walk. Those must not be reported.
      emitter.notifyOnce(makeStats({ finishedAt: 400 }), 500);

      expect(notifier.infoCalls).toHaveLength(0);
    });

    it("still emits later after a stale-stats call (stale did not latch)", () => {
      emitter.notifyOnce(makeStats({ finishedAt: 400 }), 500);
      emitter.notifyOnce(makeStats({ finishedAt: 600 }), 500);

      expect(notifier.infoCalls).toHaveLength(1);
      expect(notifier.infoCalls[0].message).toBe(
        "Exocortex: indexing complete (97 files, 3 skipped, 4.2s)",
      );
    });

    it("accepts stats that finished exactly at the notBefore boundary", () => {
      emitter.notifyOnce(makeStats({ finishedAt: 500 }), 500);

      expect(notifier.infoCalls).toHaveLength(1);
    });
  });
});
