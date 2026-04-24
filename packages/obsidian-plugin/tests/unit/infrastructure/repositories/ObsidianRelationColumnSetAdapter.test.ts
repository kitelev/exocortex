/**
 * Adapter unit-tests for RFC be70f741 Phase 4 — verify that each event's
 * `offref` is routed to the same `Events` instance that `on` was registered
 * against.  Historically rename was subscribed via `vault.on(…)` but its
 * unsubscribe called `metadataCache.offref(eventRef)`, which silently no-op'd
 * because the `eventRef` did not belong to `metadataCache`'s listener list.
 * Result: listener leak per plugin unload→load cycle.  The fix picks the
 * correct Events target per event kind — these tests pin that contract.
 */

import { TFile } from "obsidian";

import { ObsidianRelationColumnSetAdapter } from "../../../../src/infrastructure/repositories/ObsidianRelationColumnSetAdapter";

interface FakeEvents {
  on: jest.Mock<unknown, [string, (...args: unknown[]) => void]>;
  offref: jest.Mock<void, [unknown]>;
  trigger: (event: string, ...args: unknown[]) => number;
}

function makeEvents(): FakeEvents {
  const listeners = new Map<
    string,
    Array<{ ref: unknown; handler: (...args: unknown[]) => void }>
  >();
  const on = jest.fn((event: string, handler: (...args: unknown[]) => void) => {
    const ref = { event, handler };
    const bucket = listeners.get(event) ?? [];
    bucket.push({ ref, handler });
    listeners.set(event, bucket);
    return ref;
  });
  const offref = jest.fn((ref: unknown) => {
    for (const bucket of listeners.values()) {
      const idx = bucket.findIndex((e) => e.ref === ref);
      if (idx >= 0) {
        bucket.splice(idx, 1);
        return;
      }
    }
  });
  return {
    on,
    offref,
    trigger: (event, ...args) => {
      const bucket = listeners.get(event) ?? [];
      for (const entry of bucket) entry.handler(...args);
      return bucket.length;
    },
  };
}

function makeApp(): {
  app: {
    vault: FakeEvents & {
      getMarkdownFiles: jest.Mock;
      getAbstractFileByPath: jest.Mock;
    };
    metadataCache: FakeEvents & { getFileCache: jest.Mock };
  };
  vaultEvents: FakeEvents;
  metaEvents: FakeEvents;
} {
  const vaultEvents = makeEvents();
  const metaEvents = makeEvents();
  const vault = {
    ...vaultEvents,
    getMarkdownFiles: jest.fn(() => []),
    getAbstractFileByPath: jest.fn(() => null),
  };
  const metadataCache = {
    ...metaEvents,
    getFileCache: jest.fn(() => null),
  };
  return {
    app: { vault, metadataCache } as never,
    vaultEvents,
    metaEvents,
  };
}

describe("ObsidianRelationColumnSetAdapter — subscribe/unsubscribe symmetry", () => {
  test("changed subscribes to metadataCache and offrefs metadataCache", () => {
    const { app, metaEvents, vaultEvents } = makeApp();
    const adapter = new ObsidianRelationColumnSetAdapter(app as never);

    const unsub = adapter.on("changed", () => {});

    expect(metaEvents.on).toHaveBeenCalledTimes(1);
    expect(metaEvents.on.mock.calls[0][0]).toBe("changed");
    expect(vaultEvents.on).not.toHaveBeenCalled();

    unsub();
    expect(metaEvents.offref).toHaveBeenCalledTimes(1);
    expect(vaultEvents.offref).not.toHaveBeenCalled();
  });

  test("deleted subscribes to metadataCache and offrefs metadataCache", () => {
    const { app, metaEvents, vaultEvents } = makeApp();
    const adapter = new ObsidianRelationColumnSetAdapter(app as never);

    const unsub = adapter.on("deleted", () => {});

    expect(metaEvents.on).toHaveBeenCalledTimes(1);
    expect(metaEvents.on.mock.calls[0][0]).toBe("deleted");
    expect(vaultEvents.on).not.toHaveBeenCalled();

    unsub();
    expect(metaEvents.offref).toHaveBeenCalledTimes(1);
    expect(vaultEvents.offref).not.toHaveBeenCalled();
  });

  test("renamed subscribes to vault and offrefs vault (phase 4 leak fix)", () => {
    const { app, metaEvents, vaultEvents } = makeApp();
    const adapter = new ObsidianRelationColumnSetAdapter(app as never);

    const unsub = adapter.on("renamed", () => {});

    expect(vaultEvents.on).toHaveBeenCalledTimes(1);
    expect(vaultEvents.on.mock.calls[0][0]).toBe("rename");
    expect(metaEvents.on).not.toHaveBeenCalled();

    unsub();
    expect(vaultEvents.offref).toHaveBeenCalledTimes(1);
    expect(metaEvents.offref).not.toHaveBeenCalled();
  });

  test("rename unsubscribe actually removes the handler (not a silent no-op)", () => {
    const { app, vaultEvents } = makeApp();
    const adapter = new ObsidianRelationColumnSetAdapter(app as never);
    const handler = jest.fn();

    const unsub = adapter.on("renamed", handler);

    // Fire a matching event with a TFile payload → handler invoked.
    const file = new TFile("a.md");
    expect(vaultEvents.trigger("rename", file, "old.md")).toBe(1);
    expect(handler).toHaveBeenCalledTimes(1);

    unsub();

    // After unsubscribe the bucket must be empty — if offref routed to the
    // wrong Events instance this assertion would have fired (handler called
    // twice because the listener was never removed).
    expect(vaultEvents.trigger("rename", file, "old.md")).toBe(0);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("handler ignores non-TFile payloads", () => {
    const { app, metaEvents } = makeApp();
    const adapter = new ObsidianRelationColumnSetAdapter(app as never);
    const handler = jest.fn();

    adapter.on("changed", handler);
    // TFolder-like object — handler must NOT fire.
    metaEvents.trigger("changed", { isFolder: true });
    expect(handler).not.toHaveBeenCalled();

    const file = new TFile("a.md");
    metaEvents.trigger("changed", file);
    expect(handler).toHaveBeenCalledWith({ path: "a.md" });
  });
});
