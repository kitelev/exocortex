import { createHash } from "crypto";
import * as yaml from "js-yaml";
import { StructuredMerger, type YamlCodec } from "../../../../src/services/sync/StructuredMerger";

/**
 * ems__Bug 1fdfd7fb — sections are keyed by heading text, so a heading renamed
 * on BOTH sides to DIFFERENT texts used to read as "removed on both sides" +
 * "local-only addition" + "remote-only addition", and the merge kept the
 * section twice (exoas-aiknow@17ca903). Axes H1/H2/H9/H10 pin the conflict;
 * H3/H4/H5/H8 are controls that must keep merging. H7, H11, H18 and H25 are
 * the named prices: the guard counts ANY one-sided new key (an added section,
 * a one-sided rename, a level change, text put before the first heading when
 * the base has no preamble), so a base section gone from both sides next to
 * such an edit on each side conflicts — an unrelated delete-and-add (H7), the
 * SAME rename plus an addition on each side (H11), the SAME rename plus a
 * one-sided rename on each side (H18), new preamble text against an addition
 * (H25). H26 is its control: with a blank line after the base frontmatter the
 * same text is a preamble edit and merges.
 * H12/H13 keep a one-sided addition next to a convergent rename merging,
 * H14/H15/H17 keep a blank preamble out of the guard and H22 keeps a non-blank
 * one in it, H19-H21 pin each conjunct of the guard's key sets, H16/H22/H23/H24
 * pin the reason: the preamble label, the first three keys of each group in
 * document order, then the count of the rest.
 */

const codec: YamlCodec = {
  parse: (text) => yaml.load(text, { schema: yaml.CORE_SCHEMA }),
  stringify: (value) => yaml.dump(value, { schema: yaml.CORE_SCHEMA, lineWidth: -1 }),
};
const merger = new StructuredMerger(codec);
const FM = "---\nexo__Asset_uid: u1\n---\n";
const bodied = (body: string): string => `${FM}\n${body}\n`;
const counter = (n: number): string =>
  `## Счётчик рецидивов (**${n} задокументированных повторов**)\n\nтело счётчика`;
const headingsOf = (c: string): string[] => c.split("\n").filter((l) => /^#{1,6}\s/.test(l));

// Verbatim counter section of aiknow/9b8e391a-0973-482c-ac93-cec7f03b43c6.md at
// kitelev/exoas-aiknow@2c61365 (the 3-way base of the incident), from its
// heading up to the next heading, trailing newlines dropped.
const REAL_COUNTER_SECTION =
  "## Счётчик рецидивов (**94 задокументированных повторов**, 2026-07-12 … 2026-10-11) — terminal accept-baseline\n\n<!-- Added by /session-retrospective 2026-08-09 — root: форма счётчика была `**16 повторов**`, а `rules-effectiveness.py` матчит ТОЛЬКО `**N задокументированных повтор…**` ⇒ явный счётчик не читался, метрика падала на фолбэк «подсчёт упоминаний» и давала 23 (2 в правиле + 21 в архиве) вместо 16. -->\n⛔ **Формулировку заголовка не менять произвольно — она МАШИННО-ЧИТАЕМА.** ⛤ **Механизм ДВУХСТУПЕНЧАТЫЙ** (прочитан в `scripts/rules-effectiveness.py` 2026-09-01): `COUNTER_HEADER_RE = ^##\\s+Счётчик\\b` находит СТРОКУ, `EXPLICIT_COUNT_RE` берёт **первое `**<N>` внутри неё** ⇒ несущи ровно два элемента — якорь `## Счётчик` и первое `**N`; слова после числа СВОБОДНЫ. ⛔ Прежняя редакция этой строки утверждала «требует дословно `**<N> задокументированн<…> повтор<…>**`» — **ложно**, и скрипт (стр. 95-100) прямо фиксирует, почему: требование слова «рецидивов» однажды УЖЕ вводили, и оно сломало заголовки вида `## Счётчик (**42 …**)`. Сломать метрику можно ровно двумя способами — сменить якорь строки либо поставить перед числом другое `**…**`; тогда она молча падает на фолбэк-подсчёт упоминаний слов «recurrence|рецидив», а он считает и заголовки вынесенной эмпирики, и прозу, то есть **завышает** (`self-satisfying-metric-weak-verifier` §метрика, ключующаяся на ФОРМЕ ЗАПИСИ).\n\n<!-- Added by /session-retrospective 2026-08-22 — root: число в теле («Все 17») разошлось с машинно-читаемым заголовком (21) — ровно тот дубль счёта, который §заголовок сам и запрещает («не дублировать число: счётчик уже расходился»). Снято до неколичественной формы, чтобы дрейф был невозможен by construction. -->\n⛔ Все — **self-caught, урон 0** (число — в заголовке, здесь НЕ дублировать), каждый раз правило было в system-reminder (дважды — прочитано за минуты до промаха). Хук `dogfood-vault-search.sh` срабатывает корректно и **не ужесточается**; ценность счётчика — не в назидании, а в накопленных floor'ах ниже.";

const REAL_COUNTER_SECTION_SHA256 =
  "d70349e48d0c16aa6a0faffa7794dfde164734d28acf339e8b08e7c9332c9098";

describe("StructuredMerger — heading renamed on both sides (ems__Bug 1fdfd7fb)", () => {
  it("H1 three different headings of one section → conflict, never both sections", () => {
    const base = bodied(`## A\n\nx\n\n${counter(94)}\n\n## Z\n\nz`);
    const local = bodied(`## A\n\nx\n\n${counter(97)}\n\n## Z\n\nz`);
    const remote = bodied(`## A\n\nx\n\n${counter(95)}\n\n## Z\n\nz`);
    expect(merger.mergeAsset({ path: "a.md", base, local, remote })).toMatchObject({
      status: "conflict",
      reason: expect.stringMatching(
        /removed on both sides "[^"]*\*\*94 [\s\S]*\(local "[^"]*\*\*97 [^"]*", remote "[^"]*\*\*95 /,
      ),
    });
  });

  // Held by two guards: this one and the output invariant (ems__Bug 96a86732) — the
  // section text would appear twice — so mutant M1 of this suite's spec no longer reddens it.
  it("H2 real section text (counter 94 → 95 remote / 97 local) → conflict", () => {
    expect(createHash("sha256").update(REAL_COUNTER_SECTION, "utf8").digest("hex")).toBe(
      REAL_COUNTER_SECTION_SHA256,
    );
    const at = (n: number): string =>
      bodied(
        `## Соседняя секция\n\nтекст соседа\n\n${REAL_COUNTER_SECTION.replace("(**94 ", () => `(**${n} `)}\n\n## Хвост\n\nхвост`,
      );
    expect(merger.mergeAsset({ path: "a.md", base: at(94), local: at(97), remote: at(95) }).status).toBe(
      "conflict",
    );
  });

  it("H3 control: renamed on ONE side only → merged, exactly the new heading", () => {
    const r = merger.mergeAsset({
      path: "a.md",
      base: bodied(`## A\n\nx\n\n${counter(94)}`),
      local: bodied(`## A\n\nx LOCAL\n\n${counter(94)}`),
      remote: bodied(`## A\n\nx\n\n${counter(95)}`),
    });
    expect(r.status).toBe("merged");
    if (r.status === "merged") {
      expect(headingsOf(r.content).filter((h) => h.includes("Счётчик"))).toEqual([
        "## Счётчик рецидивов (**95 задокументированных повторов**)",
      ]);
      expect(r.content).toMatch(/x LOCAL/);
    }
  });

  it("H4 control: the SAME rename on both sides → merged, one section", () => {
    const r = merger.mergeAsset({
      path: "a.md",
      base: bodied(`## A\n\nx\n\n${counter(94)}`),
      local: bodied(`## A\n\nx LOCAL\n\n${counter(95)}`),
      remote: bodied(`## A\n\nx\n\n${counter(95)}`),
    });
    expect(r.status).toBe("merged");
    if (r.status === "merged") {
      expect(headingsOf(r.content).filter((h) => h.includes("Счётчик")).length).toBe(1);
    }
  });

  it("H5 control: rename on one side + new section on the other → merged, both land", () => {
    const r = merger.mergeAsset({
      path: "a.md",
      base: bodied(`## A\n\nx\n\n${counter(94)}`),
      local: bodied(`## A\n\nx\n\n${counter(95)}`),
      remote: bodied(`## A\n\nx\n\n${counter(94)}\n\n## New\n\nnew R`),
    });
    expect(r.status).toBe("merged");
    if (r.status === "merged") {
      expect([...headingsOf(r.content)].sort()).toEqual(
        ["## A", "## Счётчик рецидивов (**95 задокументированных повторов**)", "## New"].sort(),
      );
    }
  });

  it("H7 price: same section removed on both sides + each side adds its OWN unrelated section → conflict", () => {
    expect(
      merger.mergeAsset({
        path: "a.md",
        base: bodied("## A\n\nx\n\n## Old\n\nold\n\n## Z\n\nz"),
        local: bodied("## L-new\n\nnew L\n\n## A\n\nx\n\n## Z\n\nz"),
        remote: bodied("## A\n\nx\n\n## Z\n\nz\n\n## R-new\n\nnew R"),
      }).status,
    ).toBe("conflict");
  });

  it("H8 boundary: same section removed on both sides, nothing added → merged (convergent delete)", () => {
    const r = merger.mergeAsset({
      path: "a.md",
      base: bodied("## A\n\nx\n\n## Old\n\nold\n\n## Z\n\nz"),
      local: bodied("## A\n\nx LOCAL\n\n## Z\n\nz"),
      remote: bodied("## A\n\nx\n\n## Z\n\nz REMOTE"),
    });
    expect(r.status).toBe("merged");
    if (r.status === "merged") expect(headingsOf(r.content)).toEqual(["## A", "## Z"]);
  });

  // Held by two guards: this one and the output invariant (ems__Bug 96a86732) — the
  // section text would appear twice — so mutant M1 or M8 of this suite's spec no longer reddens it.
  it("H9 divergent rename next to a NEW section on one side (position shifted) → conflict", () => {
    expect(
      merger.mergeAsset({
        path: "a.md",
        base: bodied(`## A\n\nx\n\n${counter(94)}\n\n## Z\n\nz`),
        local: bodied(`## A\n\nx\n\n## Inserted\n\nins\n\n${counter(97)}\n\n## Z\n\nz`),
        remote: bodied(`## A\n\nx\n\n${counter(95)}\n\n## Z\n\nz`),
      }).status,
    ).toBe("conflict");
  });

  // Held by two guards: this one and the output invariant (ems__Bug 96a86732) — the
  // section text would appear twice — so mutant M1 of this suite's spec no longer reddens it.
  it("H10 divergent rename where one side also MOVED the section → conflict", () => {
    expect(
      merger.mergeAsset({
        path: "a.md",
        base: bodied(`## A\n\nx\n\n${counter(94)}\n\n## Z\n\nz`),
        local: bodied(`## A\n\nx\n\n## Z\n\nz\n\n${counter(97)}`),
        remote: bodied(`## A\n\nx\n\n${counter(95)}\n\n## Z\n\nz`),
      }).status,
    ).toBe("conflict");
  });

  it("H11 price: the SAME rename on both sides + each side appends its OWN section (real text) → conflict", () => {
    const at = (n: number, tail: string): string =>
      bodied(
        `## Соседняя секция\n\nтекст соседа\n\n${REAL_COUNTER_SECTION.replace("(**94 ", () => `(**${n} `)}\n\n## Хвост\n\nхвост${tail}`,
      );
    expect(
      merger.mergeAsset({
        path: "a.md",
        base: at(94, ""),
        local: at(95, "\n\n## ⛤ Addendum L\n\nlocal addendum"),
        remote: at(95, "\n\n## ⛤ Addendum R\n\nremote addendum"),
      }).status,
    ).toBe("conflict");
  });

  it("H12 control: the SAME rename on both sides + only the REMOTE side adds a section → merged", () => {
    const r = merger.mergeAsset({
      path: "a.md",
      base: bodied(`## A\n\nx\n\n${counter(94)}`),
      local: bodied(`## A\n\nx LOCAL\n\n${counter(95)}`),
      remote: bodied(`## A\n\nx\n\n${counter(95)}\n\n## New\n\nnew R`),
    });
    expect(r.status).toBe("merged");
    if (r.status === "merged") {
      expect(headingsOf(r.content)).toEqual([
        "## A",
        "## Счётчик рецидивов (**95 задокументированных повторов**)",
        "## New",
      ]);
      expect(r.content).toMatch(/x LOCAL/);
    }
  });

  it("H13 control: the SAME rename on both sides + only the LOCAL side adds a section → merged", () => {
    const r = merger.mergeAsset({
      path: "a.md",
      base: bodied(`## A\n\nx\n\n${counter(94)}`),
      local: bodied(`## A\n\nx\n\n${counter(95)}\n\n## New\n\nnew L`),
      remote: bodied(`## A\n\nx REMOTE\n\n${counter(95)}`),
    });
    expect(r.status).toBe("merged");
    if (r.status === "merged") {
      expect(headingsOf(r.content)).toEqual([
        "## A",
        "## Счётчик рецидивов (**95 задокументированных повторов**)",
        "## New",
      ]);
      expect(r.content).toMatch(/x REMOTE/);
    }
  });

  it("H14 control: a blank line appears after the frontmatter LOCALLY, both drop a section, remote adds one → merged", () => {
    const r = merger.mergeAsset({
      path: "a.md",
      base: `${FM}## A\n\nx\n\n## Old\n\nold\n`,
      local: `${FM}\n## A\n\nx\n`,
      remote: `${FM}## A\n\nx\n\n## R-new\n\nr\n`,
    });
    expect(r.status).toBe("merged");
    if (r.status === "merged") expect(headingsOf(r.content)).toEqual(["## A", "## R-new"]);
  });

  it("H15 control: a blank line appears after the frontmatter REMOTELY, both drop a section, local adds one → merged", () => {
    const r = merger.mergeAsset({
      path: "a.md",
      base: `${FM}## A\n\nx\n\n## Old\n\nold\n`,
      local: `${FM}## A\n\nx\n\n## L-new\n\nl\n`,
      remote: `${FM}\n## A\n\nx\n`,
    });
    expect(r.status).toBe("merged");
    if (r.status === "merged") expect(headingsOf(r.content)).toEqual(["## A", "## L-new"]);
  });

  it("H16 the conflict reason names every key it judged, not just the first of each side", () => {
    const r = merger.mergeAsset({
      path: "a.md",
      base: bodied(`## A\n\nx\n\n${counter(94)}\n\n## Z\n\nz`),
      local: bodied(`## A\n\nx\n\n## Inserted\n\nins\n\n${counter(97)}\n\n## Z\n\nz`),
      remote: bodied(`## A\n\nx\n\n${counter(95)}\n\n## Z\n\nz`),
    });
    expect(r.status).toBe("conflict");
    if (r.status === "conflict") {
      for (const part of ['"## Inserted"', "(**94 ", "(**97 ", "(**95 "]) {
        expect(r.reason).toContain(part);
      }
    }
  });

  it("H17 control: empty base body, each side writes its own first section → merged, both land", () => {
    const r = merger.mergeAsset({
      path: "a.md",
      base: FM,
      local: `${FM}## Local notes\n\nl\n`,
      remote: `${FM}## Remote notes\n\nr\n`,
    });
    expect(r.status).toBe("merged");
    if (r.status === "merged") {
      expect([...headingsOf(r.content)].sort()).toEqual(["## Local notes", "## Remote notes"]);
    }
  });

  it("H18 price: the SAME rename on both sides + a one-sided rename of a DIFFERENT section on each side → conflict", () => {
    expect(
      merger.mergeAsset({
        path: "a.md",
        base: bodied(`## A\n\nx\n\n${counter(94)}\n\n## B\n\nb`),
        local: bodied(`## A2\n\nx\n\n${counter(95)}\n\n## B\n\nb`),
        remote: bodied(`## A\n\nx\n\n${counter(95)}\n\n## B2\n\nb`),
      }).status,
    ).toBe("conflict");
  });

  it("H19 control (mirror of H5): local adds a section, remote renames → merged, both land", () => {
    const r = merger.mergeAsset({
      path: "a.md",
      base: bodied(`## A\n\nx\n\n${counter(94)}`),
      local: bodied(`## A\n\nx\n\n${counter(94)}\n\n## New\n\nnew L`),
      remote: bodied(`## A\n\nx\n\n${counter(95)}`),
    });
    expect(r.status).toBe("merged");
    if (r.status === "merged") {
      expect(headingsOf(r.content)).toEqual([
        "## A",
        "## Счётчик рецидивов (**95 задокументированных повторов**)",
        "## New",
      ]);
    }
  });

  it("H20 control: both drop X, remote also drops Y the local kept, remote adds N → merged", () => {
    const r = merger.mergeAsset({
      path: "a.md",
      base: bodied("## A\n\na\n\n## X\n\nx\n\n## Y\n\ny"),
      local: bodied("## A\n\na\n\n## Y\n\ny"),
      remote: bodied("## A\n\na\n\n## N\n\nn"),
    });
    expect(r.status).toBe("merged");
    if (r.status === "merged") expect(headingsOf(r.content)).toEqual(["## A", "## N"]);
  });

  it("H21 control: both drop X, local also drops Y the remote kept, local adds N → merged", () => {
    const r = merger.mergeAsset({
      path: "a.md",
      base: bodied("## A\n\na\n\n## X\n\nx\n\n## Y\n\ny"),
      local: bodied("## A\n\na\n\n## N\n\nn"),
      remote: bodied("## A\n\na\n\n## Y\n\ny"),
    });
    expect(r.status).toBe("merged");
    if (r.status === "merged") expect(headingsOf(r.content)).toEqual(["## A", "## N"]);
  });

  it("H22 a NON-blank preamble takes part: each side puts its own heading over it → conflict, never the text twice", () => {
    const r = merger.mergeAsset({
      path: "a.md",
      base: `${FM}intro text\n\n## A\n\na\n`,
      local: `${FM}## L\n\nintro text\n\n## A\n\na\n`,
      remote: `${FM}## R\n\nintro text\n\n## A\n\na\n`,
    });
    expect(r.status).toBe("conflict");
    if (r.status === "conflict") expect(r.reason).toContain('removed on both sides "(preamble)" while');
  });

  it("H23 the reason names the first three keys of a group in document order, then counts the rest", () => {
    const r = merger.mergeAsset({
      path: "a.md",
      base: bodied("## K1\n\n1\n\n## K2\n\n2\n\n## K3\n\n3\n\n## K4\n\n4\n\n## K5\n\n5\n\n## Z\n\nz"),
      local: bodied("## L1\n\nl\n\n## Z\n\nz"),
      remote: bodied("## Z\n\nz\n\n## R1\n\nr"),
    });
    expect(r.status).toBe("conflict");
    if (r.status === "conflict") {
      expect(r.reason).toContain('sections removed on both sides "## K1", "## K2", "## K3" and 2 more while');
    }
  });

  it("H24 the reason keeps each side's keys in document order", () => {
    const r = merger.mergeAsset({
      path: "a.md",
      base: bodied("## A\n\na\n\n## Old\n\nold"),
      local: bodied("## A\n\na\n\n## L1\n\nl1\n\n## L2\n\nl2"),
      remote: bodied("## A\n\na\n\n## R1\n\nr1\n\n## R2\n\nr2"),
    });
    expect(r.status).toBe("conflict");
    if (r.status === "conflict") {
      expect(r.reason).toContain('(local "## L1", "## L2", remote "## R1", "## R2")');
    }
  });

  it("H25 price: new text before the first heading (base without a blank line after the frontmatter) against an addition → conflict", () => {
    const r = merger.mergeAsset({
      path: "a.md",
      base: `${FM}## A\n\na\n\n## Old\n\nold\n`,
      local: `${FM}intro L\n\n## A\n\na\n`,
      remote: `${FM}## A\n\na\n\n## R\n\nr\n`,
    });
    expect(r.status).toBe("conflict");
  });

  it("H26 control: the same edits with a blank line after the base frontmatter → merged, the text once", () => {
    const r = merger.mergeAsset({
      path: "a.md",
      base: `${FM}\n## A\n\na\n\n## Old\n\nold\n`,
      local: `${FM}\nintro L\n\n## A\n\na\n`,
      remote: `${FM}\n## A\n\na\n\n## R\n\nr\n`,
    });
    expect(r.status).toBe("merged");
    if (r.status === "merged") {
      expect(headingsOf(r.content)).toEqual(["## A", "## R"]);
      expect(r.content.split("intro L").length - 1).toBe(1);
    }
  });
});
