/** diff3 — generic 3-way sequence merge (RFC 4e4dc453 A2, D21 building block). */

import { diff3 } from "../../../../src/services/sync/diff3";

describe("diff3", () => {
  it("all equal → unchanged", () => {
    const r = diff3(["a", "b"], ["a", "b"], ["a", "b"]);
    expect(r).toEqual({ ok: true, merged: ["a", "b"] });
  });

  it("local-only edit → local wins", () => {
    const r = diff3(["a", "b", "c"], ["a", "B", "c"], ["a", "b", "c"]);
    expect(r).toEqual({ ok: true, merged: ["a", "B", "c"] });
  });

  it("remote-only edit → remote wins", () => {
    const r = diff3(["a", "b", "c"], ["a", "b", "c"], ["a", "R", "c"]);
    expect(r).toEqual({ ok: true, merged: ["a", "R", "c"] });
  });

  it("non-overlapping edits on different elements merge", () => {
    const r = diff3(["a", "b", "c"], ["A", "b", "c"], ["a", "b", "C"]);
    expect(r).toEqual({ ok: true, merged: ["A", "b", "C"] });
  });

  it("convergent identical edits are not a conflict", () => {
    const r = diff3(["a", "b"], ["a", "X"], ["a", "X"]);
    expect(r).toEqual({ ok: true, merged: ["a", "X"] });
  });

  it("overlapping divergent edits → conflict with slices", () => {
    const r = diff3(["a", "b", "c"], ["a", "L", "c"], ["a", "R", "c"]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.conflict).toEqual({ base: ["b"], local: ["L"], remote: ["R"] });
    }
  });

  it("insertions at different positions merge", () => {
    const r = diff3(["a", "b"], ["x", "a", "b"], ["a", "b", "y"]);
    expect(r).toEqual({ ok: true, merged: ["x", "a", "b", "y"] });
  });

  it("insertions at the SAME position with different content → conflict", () => {
    const r = diff3(["a", "b"], ["a", "x", "b"], ["a", "y", "b"]);
    expect(r.ok).toBe(false);
  });

  it("delete on one side, untouched on the other → deleted", () => {
    const r = diff3(["a", "b", "c"], ["a", "c"], ["a", "b", "c"]);
    expect(r).toEqual({ ok: true, merged: ["a", "c"] });
  });

  it("delete-vs-modify of the same element → conflict", () => {
    const r = diff3(["a", "b", "c"], ["a", "c"], ["a", "B", "c"]);
    expect(r.ok).toBe(false);
  });

  it("empty base: identical additions merge, divergent additions conflict", () => {
    expect(diff3([], ["x"], ["x"])).toEqual({ ok: true, merged: ["x"] });
    expect(diff3([], ["x"], ["y"]).ok).toBe(false);
  });

  it("appends on both ends merge", () => {
    const r = diff3(["m"], ["pre", "m"], ["m", "post"]);
    expect(r).toEqual({ ok: true, merged: ["pre", "m", "post"] });
  });
});
