/**
 * LayoutSelector — class refs compared after canonicalization (RFC 9821a379
 * AC4, decision 4; ticket 035da1eb).
 *
 * In vault-my 333 daily notes carry `[[uid]]`, 42 carry only `[[pn__DailyNote]]`
 * and 13 carry `[[uid|pn__DailyNote]]` (замер RFC §Контекст, 2026-10-23). A
 * Layout with `targetClass: [[b04e7a3e…]]` must apply to all three; so must a
 * Layout with `targetClass: [[pn__DailyNote]]`. The selector resolves a bare
 * UUID to its class label through the injected `resolveUid` on BOTH sides.
 *
 * Revert-verify: mutant-driver spec `LayoutSelector.canonical.spec.json`.
 */

import { LayoutSelector } from "../../../src/application/services/LayoutSelector";
import type { Layout } from "../../../src/domain/layout/Layout";

const DAILY_NOTE_UID = "b04e7a3e-6b49-4984-9f8d-b74e9f36818b";
const TASK_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e";

const LABELS: Record<string, string> = {
  [DAILY_NOTE_UID]: "pn__DailyNote",
  [TASK_UID]: "ems__Task",
};
const resolveUid = (uuid: string): string | null => LABELS[uuid] ?? null;

function layout(targetClass: string, uid = "layout-daily"): Layout {
  return {
    uid,
    label: "Daily note layout",
    targetClass,
    blocks: ["b"],
    priority: 0,
    coexistsWithDefault: true,
    sourcePath: `${uid}.md`,
  };
}

describe("LayoutSelector — [[uid]], [[uid|label]] and [[label]] of one class match (RFC 9821a379 AC4)", () => {
  const byUid = layout(DAILY_NOTE_UID); // targetClass: [[b04e7a3e…]] after normalizeRef

  test("S1 @req:ddd9b7f1-3f53-4514-ad8a-f764827fcbbe targetClass [[uid]] applies to a note whose class is only [[pn__DailyNote]] (2026-07-18 form)", () => {
    const sel = new LayoutSelector({ all: [byUid] }, { resolveUid });
    expect(sel.resolve(["[[pn__DailyNote]]"])).toBe(byUid);
  });

  test("S2 @req:ddd9b7f1-3f53-4514-ad8a-f764827fcbbe targetClass [[uid]] applies to a note whose class is [[uid|pn__DailyNote]] (2026-06-27 form)", () => {
    const sel = new LayoutSelector({ all: [byUid] }, { resolveUid });
    expect(sel.resolve([`[[${DAILY_NOTE_UID}|pn__DailyNote]]`])).toBe(byUid);
  });

  test("S3 @req:ddd9b7f1-3f53-4514-ad8a-f764827fcbbe targetClass [[uid]] applies to a note whose class is bare [[uid]] (the 333-note majority)", () => {
    const sel = new LayoutSelector({ all: [byUid] }, { resolveUid });
    expect(sel.resolve([`[[${DAILY_NOTE_UID}]]`])).toBe(byUid);
  });

  test("S4 @req:ddd9b7f1-3f53-4514-ad8a-f764827fcbbe targetClass [[pn__DailyNote]] (label) applies to a note whose class is bare [[uid]]", () => {
    const byLabel = layout("pn__DailyNote");
    const sel = new LayoutSelector({ all: [byLabel] }, { resolveUid });
    expect(sel.resolve([`[[${DAILY_NOTE_UID}]]`])).toBe(byLabel);
  });

  test("S5 @req:ddd9b7f1-3f53-4514-ad8a-f764827fcbbe a note of another class does not get the Layout (negative)", () => {
    const sel = new LayoutSelector({ all: [byUid] }, { resolveUid });
    expect(sel.resolve([`[[${TASK_UID}]]`])).toBeNull();
    expect(sel.resolve(["[[ems__Task]]"])).toBeNull();
  });

  test("S6 @req:ddd9b7f1-3f53-4514-ad8a-f764827fcbbe without a resolver a bare uid stays a uid — [[uid]] target vs [[label]] note do not match (pre-9821a379 behaviour)", () => {
    const sel = new LayoutSelector({ all: [byUid] });
    expect(sel.resolve(["[[pn__DailyNote]]"])).toBeNull();
    expect(sel.resolve([`[[${DAILY_NOTE_UID}]]`])).toBe(byUid);
  });

  test("S8 @req:ddd9b7f1-3f53-4514-ad8a-f764827fcbbe on the NOTE side [[uid|alias]] is decided by its alias — the codebase-wide class-ref convention (#2764, WikiLinkHelpers.normalize) that resolveSymbolic applies", () => {
    // RFC 9821a379 decision 4 names resolveSymbolic; this axis locks what that
    // means for a mismatched alias (exposure 2026-10-24: 0 — every alias in the
    // 388 daily notes equals the class label).
    const sel = new LayoutSelector({ all: [byUid] }, { resolveUid });
    expect(sel.resolve([`[[${TASK_UID}|pn__DailyNote]]`])).toBe(byUid);
    expect(sel.resolve([`[[${DAILY_NOTE_UID}|ems__Task]]`])).toBeNull();
  });

  test("S7 @req:ddd9b7f1-3f53-4514-ad8a-f764827fcbbe the resolver is consulted on every resolve — a cache that fills later is picked up by the next render", () => {
    let warm = false;
    const lazy = (uuid: string): string | null => (warm ? resolveUid(uuid) : null);
    const sel = new LayoutSelector({ all: [byUid] }, { resolveUid: lazy });
    expect(sel.resolve(["[[pn__DailyNote]]"])).toBeNull();
    warm = true;
    expect(sel.resolve(["[[pn__DailyNote]]"])).toBe(byUid);
  });

  test("S9 @req:ddd9b7f1-3f53-4514-ad8a-f764827fcbbe the NOTE side is resolved on every resolve too — a note whose class is [[uid]] gets the Layout once a cold cache fills", () => {
    // Mirror of S7: here the uid sits on the NOTE side (the form of most daily
    // notes) and the Layout names its class by label. A memo of the note's
    // canonical class would freeze the cold-cache miss for the whole session.
    const byLabel = layout("pn__DailyNote", "layout-by-label");
    let warm = false;
    const lazy = (uuid: string): string | null => (warm ? resolveUid(uuid) : null);
    const sel = new LayoutSelector({ all: [byLabel] }, { resolveUid: lazy });
    expect(sel.resolve([`[[${DAILY_NOTE_UID}]]`])).toBeNull();
    warm = true;
    expect(sel.resolve([`[[${DAILY_NOTE_UID}]]`])).toBe(byLabel);
  });
});
