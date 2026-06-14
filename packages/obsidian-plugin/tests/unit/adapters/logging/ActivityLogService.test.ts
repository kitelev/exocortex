/**
 * Unit tests for ActivityLogService — the in-memory ring buffer + pub/sub that
 * backs the «Exocortex: Open activity log» modal (GitHub #3540).
 *
 * No Obsidian dependency — pure data structure, runs in plain jsdom/node.
 */
import { describe, it, expect, jest } from "@jest/globals";
import {
  ActivityLogService,
  type ActivityEntry,
} from "../../../../src/adapters/logging/ActivityLogService";

describe("ActivityLogService", () => {
  it("record → getSnapshot returns recorded entries in order, stamping ts", () => {
    let t = 1000;
    const svc = new ActivityLogService({ now: () => (t += 5) });
    svc.record({ category: "exosync", level: "info", message: "a" });
    svc.record({ category: "profile", level: "warn", message: "b" });

    const snap = svc.getSnapshot();
    expect(snap).toHaveLength(2);
    expect(snap[0]).toEqual({
      ts: 1005,
      category: "exosync",
      level: "info",
      message: "a",
    });
    expect(snap[1]).toEqual({
      ts: 1010,
      category: "profile",
      level: "warn",
      message: "b",
    });
  });

  it("getSnapshot returns a copy — mutating it does not affect the buffer", () => {
    const svc = new ActivityLogService();
    svc.record({ category: "mount", level: "info", message: "x" });
    const snap = svc.getSnapshot() as ActivityEntry[];
    snap.push({ ts: 0, category: "bootstrap", level: "error", message: "z" });
    expect(svc.getSnapshot()).toHaveLength(1);
  });

  it("evicts oldest entries when capacity is exceeded (ring buffer)", () => {
    const svc = new ActivityLogService({ capacity: 3, now: () => 0 });
    for (const m of ["1", "2", "3", "4", "5"]) {
      svc.record({ category: "exosync", level: "info", message: m });
    }
    const snap = svc.getSnapshot();
    expect(snap).toHaveLength(3);
    expect(snap.map((e) => e.message)).toEqual(["3", "4", "5"]);
  });

  it("defaults capacity to ~1000 when not specified", () => {
    const svc = new ActivityLogService({ now: () => 0 });
    for (let i = 0; i < 1100; i++) {
      svc.record({ category: "exosync", level: "info", message: String(i) });
    }
    expect(svc.getSnapshot()).toHaveLength(1000);
    expect(svc.getSnapshot()[0].message).toBe("100"); // 0..99 evicted
  });

  it("invalid/zero/negative capacity falls back to default (not a broken buffer)", () => {
    const svc = new ActivityLogService({ capacity: 0, now: () => 0 });
    for (let i = 0; i < 1001; i++) {
      svc.record({ category: "exosync", level: "info", message: String(i) });
    }
    expect(svc.getSnapshot()).toHaveLength(1000);
  });

  it("subscribe receives newly recorded entries", () => {
    const svc = new ActivityLogService({ now: () => 42 });
    const received: ActivityEntry[] = [];
    svc.subscribe((e) => received.push(e));
    svc.record({ category: "bootstrap", level: "info", message: "hello" });
    expect(received).toEqual([
      { ts: 42, category: "bootstrap", level: "info", message: "hello" },
    ]);
  });

  it("unsubscribe stops further delivery", () => {
    const svc = new ActivityLogService({ now: () => 0 });
    const received: ActivityEntry[] = [];
    const unsub = svc.subscribe((e) => received.push(e));
    svc.record({ category: "exosync", level: "info", message: "1" });
    unsub();
    svc.record({ category: "exosync", level: "info", message: "2" });
    expect(received.map((e) => e.message)).toEqual(["1"]);
  });

  it("supports multiple independent subscribers", () => {
    const svc = new ActivityLogService({ now: () => 0 });
    const a: string[] = [];
    const b: string[] = [];
    svc.subscribe((e) => a.push(e.message));
    svc.subscribe((e) => b.push(e.message));
    svc.record({ category: "mount", level: "info", message: "m" });
    expect(a).toEqual(["m"]);
    expect(b).toEqual(["m"]);
  });

  it("a throwing subscriber does not break recording or other subscribers", () => {
    const svc = new ActivityLogService({ now: () => 0 });
    const ok: string[] = [];
    svc.subscribe(() => {
      throw new Error("boom");
    });
    svc.subscribe((e) => ok.push(e.message));
    expect(() =>
      svc.record({ category: "exosync", level: "error", message: "still" }),
    ).not.toThrow();
    expect(ok).toEqual(["still"]);
    expect(svc.getSnapshot()).toHaveLength(1); // entry still buffered
  });

  it("clear empties the buffer", () => {
    const svc = new ActivityLogService({ now: () => 0 });
    svc.record({ category: "exosync", level: "info", message: "1" });
    svc.record({ category: "exosync", level: "info", message: "2" });
    expect(svc.size).toBe(2);
    svc.clear();
    expect(svc.getSnapshot()).toEqual([]);
    expect(svc.size).toBe(0);
  });

  it("clear notifies clear-subscribers", () => {
    const svc = new ActivityLogService({ now: () => 0 });
    const onClear = jest.fn();
    svc.onClear(onClear);
    svc.record({ category: "exosync", level: "info", message: "1" });
    svc.clear();
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("size reflects buffer length", () => {
    const svc = new ActivityLogService({ now: () => 0 });
    expect(svc.size).toBe(0);
    svc.record({ category: "exosync", level: "info", message: "1" });
    expect(svc.size).toBe(1);
  });
});
