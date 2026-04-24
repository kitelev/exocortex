/**
 * LayoutSelector unit tests — explicit edge cases on the priority ladder.
 * Property-based determinism invariants live in `.property.test.ts`.
 */

import {
  LayoutSelector,
  selectByPriority,
} from "../../../src/application/services/LayoutSelector";
import type { Layout } from "../../../src/domain/layout/Layout";

function layout(overrides: Partial<Layout>): Layout {
  return {
    uid: overrides.uid ?? "uid-1",
    label: overrides.label ?? "Label",
    targetClass: overrides.targetClass ?? "ems__Task",
    blocks: overrides.blocks ?? ["block-a"],
    priority: overrides.priority ?? 0,
    coexistsWithDefault: overrides.coexistsWithDefault ?? false,
    sourcePath: overrides.sourcePath ?? "layout.md",
  };
}

describe("LayoutSelector.resolve", () => {
  test("empty snapshot → null", () => {
    const sel = new LayoutSelector({ all: [] });
    expect(sel.resolve(["[[ems__Task]]"])).toBeNull();
  });

  test("no match → null", () => {
    const sel = new LayoutSelector({
      all: [layout({ targetClass: "ems__Project" })],
    });
    expect(sel.resolve(["[[ems__Task]]"])).toBeNull();
  });

  test("single match → returns it", () => {
    const lo = layout({ targetClass: "ems__Task" });
    const sel = new LayoutSelector({ all: [lo] });
    expect(sel.resolve(["[[ems__Task]]"])).toBe(lo);
  });

  test("higher priority wins", () => {
    const lo1 = layout({ uid: "u1", priority: 1 });
    const lo2 = layout({ uid: "u2", priority: 5 });
    const sel = new LayoutSelector({ all: [lo1, lo2] });
    expect(sel.resolve(["[[ems__Task]]"])).toBe(lo2);
  });

  test("priority tie broken by uid ASC", () => {
    const alpha = layout({ uid: "aaa", priority: 3 });
    const beta = layout({ uid: "bbb", priority: 3 });
    const sel = new LayoutSelector({ all: [beta, alpha] });
    expect(sel.resolve(["[[ems__Task]]"])).toBe(alpha);
  });

  test("multi-class: first class with match wins (later classes ignored)", () => {
    const proj = layout({ uid: "p", targetClass: "ems__Project" });
    const task = layout({ uid: "t", targetClass: "ems__Task" });
    const sel = new LayoutSelector({ all: [proj, task] });
    // Classes in order → Project has match first, Task second. Project wins.
    expect(sel.resolve(["[[ems__Project]]", "[[ems__Task]]"])).toBe(proj);
    expect(sel.resolve(["[[ems__Task]]", "[[ems__Project]]"])).toBe(task);
  });

  test("bare strings (no wikilink) normalize via WikiLinkHelpers", () => {
    const lo = layout({ targetClass: "ems__Task" });
    const sel = new LayoutSelector({ all: [lo] });
    expect(sel.resolve(["ems__Task"])).toBe(lo);
  });

  test("UUID-alias wikilink normalizes to alias", () => {
    const lo = layout({ targetClass: "ems__Task" });
    const sel = new LayoutSelector({ all: [lo] });
    const uuid = "11111111-2222-3333-4444-555555555555";
    expect(sel.resolve([`[[${uuid}|ems__Task]]`])).toBe(lo);
  });

  test("non-string entries silently skipped", () => {
    const lo = layout({ targetClass: "ems__Task" });
    const sel = new LayoutSelector({ all: [lo] });
    expect(sel.resolve([null as unknown as string, "[[ems__Task]]"])).toBe(lo);
  });

  test("non-array input → null", () => {
    const sel = new LayoutSelector({ all: [layout({})] });
    expect(sel.resolve(null as unknown as readonly string[])).toBeNull();
    expect(sel.resolve(undefined as unknown as readonly string[])).toBeNull();
  });

  test("empty-string entries skipped", () => {
    const lo = layout({ targetClass: "ems__Task" });
    const sel = new LayoutSelector({ all: [lo] });
    expect(sel.resolve(["", "[[ems__Task]]"])).toBe(lo);
  });
});

describe("selectByPriority", () => {
  test("throws on empty candidates", () => {
    expect(() => selectByPriority([])).toThrow();
  });

  test("single candidate returned as-is", () => {
    const lo = layout({});
    expect(selectByPriority([lo])).toBe(lo);
  });

  test("priority DESC then uid ASC", () => {
    const a = layout({ uid: "aaa", priority: 2 });
    const b = layout({ uid: "bbb", priority: 2 });
    const c = layout({ uid: "ccc", priority: 5 });
    expect(selectByPriority([a, b, c])).toBe(c);
    expect(selectByPriority([b, a])).toBe(a);
  });
});
