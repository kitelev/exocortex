/**
 * ExoSync composite quarantine sink — fan-out to several QuarantinePort members
 * with zero-loss ordering (every member runs even when an earlier one throws;
 * the first error is re-thrown after all ran).
 */

import { describe, expect, it } from "@jest/globals";
import {
  CompositeQuarantineStore,
  type QuarantineEntry,
  type QuarantinePort,
} from "../../../../src";

const ENTRY: QuarantineEntry = {
  repoKey: "o/r#main",
  path: "a.md",
  reason: "x",
  localContent: "L",
  remoteContent: "R",
};

/** Spy QuarantinePort recording calls, optionally throwing. */
function spy(
  opts: { hasAll?: boolean; throwOn?: "quarantine" | "markResolved" } = {},
): {
  port: QuarantinePort;
  quarantined: QuarantineEntry[];
  resolved: string[];
} {
  const quarantined: QuarantineEntry[] = [];
  const resolved: string[] = [];
  const port: QuarantinePort = {
    async quarantine(entry) {
      if (opts.throwOn === "quarantine") throw new Error("quarantine boom");
      quarantined.push(entry);
    },
    async markResolved(repoKey, path) {
      if (opts.throwOn === "markResolved") throw new Error("markResolved boom");
      resolved.push(`${repoKey}\0${path}`);
    },
  };
  if (opts.hasAll === true) {
    port.quarantineAll = async (entries): Promise<void> => {
      if (opts.throwOn === "quarantine") throw new Error("quarantineAll boom");
      quarantined.push(...entries);
    };
  }
  return { port, quarantined, resolved };
}

describe("CompositeQuarantineStore", () => {
  it("fans out quarantine to every member (prefers quarantineAll, falls back to per-entry)", async () => {
    const a = spy({ hasAll: true });
    const b = spy({ hasAll: false }); // no quarantineAll → per-entry fallback
    const composite = new CompositeQuarantineStore([a.port, b.port]);

    await composite.quarantineAll([ENTRY, { ...ENTRY, path: "b.md" }]);

    expect(a.quarantined.map((e) => e.path)).toEqual(["a.md", "b.md"]);
    expect(b.quarantined.map((e) => e.path)).toEqual(["a.md", "b.md"]);
  });

  it("fans out markResolved to every member", async () => {
    const a = spy();
    const b = spy();
    const composite = new CompositeQuarantineStore([a.port, b.port]);

    await composite.markResolved("o/r#main", "a.md");

    expect(a.resolved).toEqual(["o/r#main\0a.md"]);
    expect(b.resolved).toEqual(["o/r#main\0a.md"]);
  });

  it("zero-loss ordering: a later member's failure does NOT skip the durable first member", async () => {
    const cache = spy({ hasAll: true }); // durability-critical, listed first
    const synced = spy({ hasAll: true, throwOn: "quarantine" }); // network fails
    const composite = new CompositeQuarantineStore([cache.port, synced.port]);

    // The composite re-throws (engine degrades conservatively) BUT the cache
    // write must have happened first — the data is durable.
    await expect(composite.quarantineAll([ENTRY])).rejects.toThrow(/boom/);
    expect(cache.quarantined).toHaveLength(1);
  });

  it("markResolved still runs every member even if one throws, then re-throws", async () => {
    const a = spy({ throwOn: "markResolved" });
    const b = spy();
    const composite = new CompositeQuarantineStore([a.port, b.port]);

    await expect(composite.markResolved("o/r#main", "a.md")).rejects.toThrow(
      /boom/,
    );
    expect(b.resolved).toEqual(["o/r#main\0a.md"]); // member b still ran
  });

  it("quarantineAll([]) is a no-op", async () => {
    const a = spy({ hasAll: true });
    const composite = new CompositeQuarantineStore([a.port]);
    await composite.quarantineAll([]);
    expect(a.quarantined).toHaveLength(0);
  });
});
