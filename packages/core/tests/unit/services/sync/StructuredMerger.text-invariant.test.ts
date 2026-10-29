import * as yaml from "js-yaml";
import { StructuredMerger, type YamlCodec } from "../../../../src/services/sync/StructuredMerger";

/**
 * ems__Bug 96a86732 — sections are keyed by heading text, so heading changes
 * the keys cannot pair either resurrect a section the other side deleted
 * (T1, its mirror T10, T11 with the text right under the heading) or keep one
 * paragraph under two keys (T3, T5-T8). The output invariant on base
 * paragraphs refuses both. T2/T4/T9 conflicted before through other guards
 * and must keep conflicting. C1-C8 must keep merging: independent additions
 * of a shared separator (C1), a paragraph repeated in two sections (C2), an
 * unrelated deletion next to a rename (C3), text new on both sides (C4), a
 * one-sided copy (C5 — the other side edits elsewhere; C8 — the other side
 * deletes the original), blank units (C6 — a heading-only section has no
 * text at stake), a repeated base paragraph re-written elsewhere (C7 —
 * judged for duplication only). T12-T17 are the inputs adversarial review of
 * the specification found unlocked: a repeated tail (T12), a one-character
 * tail (T13), preamble text right after the frontmatter (T14), trailing
 * spaces stripped by the renaming side (T15), whitespace-only blank lines
 * (T16), CRLF (T17). Review of the implementation added: a heading taken off
 * against a delete in a note without a trailing newline, where the preamble
 * lands last and would fuse with the last paragraph (T18), a divergent move
 * of one item with no heading change at all (T19), the reason staying one
 * line (T20) and truncated (T21). P1, P2 and P3 are the named price: counts
 * cannot tell a move from a delete + identical re-add, so a paragraph moved
 * on one side and deleted on the other (P1), or deleted on both and written
 * again — by one side (P2) or by each side in its own place (P3) — conflicts.
 */

const codec: YamlCodec = {
  parse: (text) => yaml.load(text, { schema: yaml.CORE_SCHEMA }),
  stringify: (value) => yaml.dump(value, { schema: yaml.CORE_SCHEMA, lineWidth: -1 }),
};
const merger = new StructuredMerger(codec);
const FM = "---\nexo__Asset_uid: u1\n---\n";
const bodied = (body: string): string => `${FM}\n${body}\n`;
const occurrences = (c: string, s: string): number => c.split(s).length - 1;
const run = (base: string, local: string, remote: string) =>
  merger.mergeAsset({ path: "a.md", base, local, remote });

describe("StructuredMerger — text the section keys cannot pair (ems__Bug 96a86732)", () => {
  it("T1 heading renamed on one side, section deleted on the other → conflict, never resurrected", () => {
    const r = run(
      bodied("## A\n\nx\n\n## Счётчик (**94**)\n\nтело счётчика\n\n## Z\n\nz"),
      bodied("## A\n\nx\n\n## Счётчик (**97**)\n\nтело счётчика\n\n## Z\n\nz"),
      bodied("## A\n\nx\n\n## Z\n\nz"),
    );
    expect(r).toMatchObject({ status: "conflict", reason: expect.stringContaining("resurrect") });
  });

  it("T2 control: body edited on one side, section deleted on the other → conflict (as before)", () => {
    const r = run(
      bodied("## A\n\nx\n\n## Счётчик (**94**)\n\nтело счётчика\n\n## Z\n\nz"),
      bodied("## A\n\nx\n\n## Счётчик (**94**)\n\nтело счётчика правка\n\n## Z\n\nz"),
      bodied("## A\n\nx\n\n## Z\n\nz"),
    );
    expect(r).toMatchObject({ status: "conflict", reason: expect.stringContaining("deleted on one side") });
  });

  it("T3 different new headings over the preamble (blank line after frontmatter) → conflict, never the text twice", () => {
    const r = run(
      `${FM}\nintro text\n\n## A\n\na\n`,
      `${FM}\n# Title L\n\nintro text\n\n## A\n\na\n`,
      `${FM}\n# Title R\n\nintro text\n\n## A\n\na\n`,
    );
    expect(r).toMatchObject({ status: "conflict", reason: expect.stringContaining("duplicate") });
  });

  it("T4 control: the same without the blank line → conflict (the 1fdfd7fb guard, as before)", () => {
    const r = run(
      `${FM}intro text\n\n## A\n\na\n`,
      `${FM}# Title L\n\nintro text\n\n## A\n\na\n`,
      `${FM}# Title R\n\nintro text\n\n## A\n\na\n`,
    );
    expect(r).toMatchObject({ status: "conflict", reason: expect.stringContaining("removed on both sides") });
  });

  it("T5 a section split by a different heading on each side → conflict, never the tail twice", () => {
    const r = run(
      bodied("## S\n\npara one\n\npara two"),
      bodied("## S\n\npara one\n\n## L split\n\npara two"),
      bodied("## S\n\npara one\n\n## R split\n\npara two"),
    );
    expect(r).toMatchObject({ status: "conflict", reason: expect.stringContaining("duplicate") });
  });

  it("T6 X deleted and Y renamed onto X on one side, Y renamed to Y' on the other → conflict", () => {
    const r = run(
      bodied("## Текущий фокус\n\nсделать А\n\n## Следующий фокус\n\nПОДГОТОВИТЬ ОТЧЁТ"),
      bodied("## Текущий фокус\n\nПОДГОТОВИТЬ ОТЧЁТ"),
      bodied("## Текущий фокус\n\nсделать А\n\n## Следующий фокус (неделя 42)\n\nПОДГОТОВИТЬ ОТЧЁТ"),
    );
    expect(r).toMatchObject({ status: "conflict", reason: expect.stringContaining("ПОДГОТОВИТЬ ОТЧЁТ") });
  });

  it("T7 renumbering (Step 1 dropped, 2→1, 3→2) against Step 3 → Step 3 (done) → conflict", () => {
    const r = run(
      bodied("## Step 1\n\ns1\n\n## Step 2\n\ns2\n\n## Step 3\n\ns3"),
      bodied("## Step 1\n\ns2\n\n## Step 2\n\ns3"),
      bodied("## Step 1\n\ns1\n\n## Step 2\n\ns2\n\n## Step 3 (done)\n\ns3"),
    );
    expect(r.status).toBe("conflict");
  });

  it("T8 heading dropped on one side (text becomes preamble), renamed on the other, blank line after frontmatter → conflict", () => {
    const r = run(
      `${FM}\n## H\n\nsection text\n\n## Z\n\nz\n`,
      `${FM}\nsection text\n\n## Z\n\nz\n`,
      `${FM}\n## H renamed\n\nsection text\n\n## Z\n\nz\n`,
    );
    expect(r.status).toBe("conflict");
  });

  it("T9 control: the same without the blank line → conflict (as before)", () => {
    const r = run(
      `${FM}## H\n\nsection text\n\n## Z\n\nz\n`,
      `${FM}section text\n\n## Z\n\nz\n`,
      `${FM}## H renamed\n\nsection text\n\n## Z\n\nz\n`,
    );
    expect(r.status).toBe("conflict");
  });

  it("T10 mirror of T1: section deleted locally, heading renamed remotely → conflict, never resurrected", () => {
    const r = run(
      bodied("## A\n\nx\n\n## Old\n\nold text\n\n## Z\n\nz"),
      bodied("## A\n\nx\n\n## Z\n\nz"),
      bodied("## A\n\nx\n\n## New\n\nold text\n\n## Z\n\nz"),
    );
    expect(r).toMatchObject({ status: "conflict", reason: expect.stringContaining("resurrect") });
  });

  it("T11 T1 with the text right under the heading (no blank line) → conflict, never resurrected", () => {
    const r = run(
      bodied("## A\n\nx\n\n## Old\nold text\n\n## Z\n\nz"),
      bodied("## A\n\nx\n\n## New\nold text\n\n## Z\n\nz"),
      bodied("## A\n\nx\n\n## Z\n\nz"),
    );
    expect(r).toMatchObject({ status: "conflict", reason: expect.stringContaining("resurrect") });
  });

  it("C5 control: one side copies a paragraph into a new section, the other edits elsewhere → merged, both copies", () => {
    const r = run(
      bodied("## A\n\nшаблон\n\n## B\n\nb"),
      bodied("## A\n\nшаблон\n\n## B\n\nb правка"),
      bodied("## A\n\nшаблон\n\n## B\n\nb\n\n## C\n\nшаблон"),
    );
    expect(r.status).toBe("merged");
    if (r.status === "merged") {
      expect(occurrences(r.content, "шаблон")).toBe(2);
      expect(r.content).toContain("b правка");
    }
  });

  it("C1 control: both sides append an entry ending with the same separator → merged, the separator three times", () => {
    const r = run(
      bodied("## 2026-10-01\n\nзапись 1\n\n---"),
      bodied("## 2026-10-01\n\nзапись 1\n\n---\n\n## 2026-10-02\n\nзапись L\n\n---"),
      bodied("## 2026-10-01\n\nзапись 1\n\n---\n\n## 2026-10-03\n\nзапись R\n\n---"),
    );
    expect(r.status).toBe("merged");
    if (r.status === "merged") {
      // body separators only: the frontmatter's own two `---` lines excluded
      expect(r.content.split("\n").filter((line) => line === "---").length - 2).toBe(3);
      expect(occurrences(r.content, "запись L")).toBe(1);
      expect(occurrences(r.content, "запись R")).toBe(1);
    }
  });

  it("C2 control: a paragraph repeated in two sections, one side drops a section, the other edits the other copy → merged", () => {
    const r = run(
      bodied("## A\n\nTODO\n\nа\n\n## B\n\nTODO\n\nб"),
      bodied("## A\n\nTODO\n\nа"),
      bodied("## A\n\nDONE\n\nа\n\n## B\n\nTODO\n\nб"),
    );
    expect(r.status).toBe("merged");
    if (r.status === "merged") {
      expect(occurrences(r.content, "TODO")).toBe(0);
      expect(occurrences(r.content, "DONE")).toBe(1);
    }
  });

  it("C3 control: heading renamed on one side, an unrelated paragraph deleted on the other → merged", () => {
    const r = run(
      bodied("## A\n\nx\n\n## Old name\n\nkeep me\n\n## Z\n\nz1\n\nz2"),
      bodied("## A\n\nx\n\n## New name\n\nkeep me\n\n## Z\n\nz1\n\nz2"),
      bodied("## A\n\nx\n\n## Old name\n\nkeep me\n\n## Z\n\nz1"),
    );
    expect(r.status).toBe("merged");
    if (r.status === "merged") {
      expect(occurrences(r.content, "keep me")).toBe(1);
      expect(occurrences(r.content, "z2")).toBe(0);
      expect(r.content).toContain("## New name");
    }
  });

  it("C4 control: both sides write the SAME new paragraph under different new headings → merged (new text is not judged)", () => {
    const r = run(
      bodied("## A\n\nx"),
      bodied("## A\n\nx\n\n## L\n\nсозвон в 15:00"),
      bodied("## A\n\nx\n\n## R\n\nсозвон в 15:00"),
    );
    expect(r.status).toBe("merged");
  });

  it("C6 control (H14 without text; same input as an empty section renamed vs deleted — no text at stake, chosen to merge) → merged", () => {
    // no blank line after the frontmatter (as H14): a blank preamble would add a
    // second blank unit to the base and hide the choice this axis locks
    const r = run(`${FM}## A\n\nx\n\n## Old\n`, `${FM}## A\n\nx\n\n## New\n`, `${FM}## A\n\nx\n`);
    expect(r.status).toBe("merged");
    if (r.status === "merged") expect(r.content).toContain("## New");
  });

  it("C7 control: a paragraph repeated in the base, both drop the same copy, one side writes it into a new section → merged", () => {
    const r = run(
      bodied("## A\n\nTODO\n\nа\n\n## B\n\nTODO\n\nб"),
      bodied("## A\n\nа\n\n## B\n\nTODO\n\nб\n\n## C\n\nTODO"),
      bodied("## A\n\nа\n\n## B\n\nTODO\n\nб"),
    );
    expect(r.status).toBe("merged");
    if (r.status === "merged") expect(occurrences(r.content, "TODO")).toBe(2);
  });

  it("T12 a section split by different headings, its tail repeated in the base (b = 2) → conflict, never three copies", () => {
    const r = run(
      bodied("## S\n\npara one\n\nTODO\n\n## X\n\nTODO"),
      bodied("## S\n\npara one\n\n## L split\n\nTODO\n\n## X\n\nTODO"),
      bodied("## S\n\npara one\n\n## R split\n\nTODO\n\n## X\n\nTODO"),
    );
    expect(r).toMatchObject({ status: "conflict", reason: expect.stringContaining("duplicate") });
  });

  it("T13 a section split by different headings, a one-character tail → conflict", () => {
    const r = run(
      bodied("## S\n\npara one\n\n✓"),
      bodied("## S\n\npara one\n\n## L split\n\n✓"),
      bodied("## S\n\npara one\n\n## R split\n\n✓"),
    );
    expect(r).toMatchObject({ status: "conflict", reason: expect.stringContaining("duplicate") });
  });

  it("T14 preamble text right after the frontmatter moved into a section on one side, a heading put over it on the other → conflict", () => {
    const r = run(`${FM}intro\n\n## B\n\nb\n`, `${FM}## B\n\nb\n\nintro\n`, `${FM}# Title\n\nintro\n\n## B\n\nb\n`);
    expect(r).toMatchObject({ status: "conflict", reason: expect.stringContaining("duplicate") });
  });

  it("T15 T1 where the base paragraph ends with two spaces and the renaming side stripped them → conflict", () => {
    const r = run(
      bodied("## A\n\nx\n\n## Old\n\nold text  \n\n## Z\n\nz"),
      bodied("## A\n\nx\n\n## New\n\nold text\n\n## Z\n\nz"),
      bodied("## A\n\nx\n\n## Z\n\nz"),
    );
    expect(r).toMatchObject({ status: "conflict", reason: expect.stringContaining("resurrect") });
  });

  it("T16 T5 with whitespace-only blank lines → conflict, never the tail twice", () => {
    const ws = (s: string): string => s.replace(/\n\n/g, "\n \n");
    const r = run(
      ws(bodied("## S\n\npara one\n\npara two")),
      ws(bodied("## S\n\npara one\n\n## L split\n\npara two")),
      ws(bodied("## S\n\npara one\n\n## R split\n\npara two")),
    );
    expect(r).toMatchObject({ status: "conflict", reason: expect.stringContaining("duplicate") });
  });

  it("T17 T5 with CRLF line endings → conflict, never the tail twice", () => {
    const crlf = (s: string): string => s.replace(/\n/g, "\r\n");
    const r = run(
      crlf(bodied("## S\n\npara one\n\npara two")),
      crlf(bodied("## S\n\npara one\n\n## L split\n\npara two")),
      crlf(bodied("## S\n\npara one\n\n## R split\n\npara two")),
    );
    expect(r).toMatchObject({ status: "conflict", reason: expect.stringContaining("duplicate") });
  });

  it("C8 control: one side copies a paragraph into a new section, the other deletes the original → merged, one copy", () => {
    const r = run(
      bodied("## A\n\nшаблон\n\nа"),
      bodied("## A\n\nшаблон\n\nа\n\n## C\n\nшаблон"),
      bodied("## A\n\nа"),
    );
    expect(r.status).toBe("merged");
    if (r.status === "merged") expect(occurrences(r.content, "шаблон")).toBe(1);
  });

  it("P2 price: both sides pruned an old entry with its separator, one appended a new entry with its own → conflict (a move cannot be told from a re-add)", () => {
    const r = run(
      bodied("## 2026-10-27\n\nСделал отчёт.\n\n---\n\n## 2026-10-28\n\nСозвон."),
      bodied("## 2026-10-28\n\nСозвон."),
      bodied("## 2026-10-28\n\nСозвон.\n\n## 2026-10-29\n\nНовая запись.\n\n---"),
    );
    expect(r).toMatchObject({ status: "conflict", reason: expect.stringContaining("resurrect") });
  });

  it("T18 heading taken off locally, section deleted remotely, no trailing newline (the preamble lands last) → conflict, never fused", () => {
    const r = run(
      `${FM}## Контекст\n\nПроект запущен 01.10.\n\n## Итог\n\nСдано.`,
      `${FM}Проект запущен 01.10.\n\n## Итог\n\nСдано.`,
      `${FM}## Итог\n\nСдано.`,
    );
    expect(r).toMatchObject({ status: "conflict", reason: expect.stringContaining("resurrect") });
  });

  it("T19 one checklist item removed on both sides and re-added under a different existing day on each → conflict, never twice", () => {
    const r = run(
      bodied("## Пн\n\n- [ ] позвонить\n\nзаметка пн\n\n## Вт\n\nзаметка вт\n\n## Ср\n\nзаметка ср"),
      bodied("## Пн\n\nзаметка пн\n\n## Вт\n\nзаметка вт\n\n- [ ] позвонить\n\n## Ср\n\nзаметка ср"),
      bodied("## Пн\n\nзаметка пн\n\n## Вт\n\nзаметка вт\n\n## Ср\n\nзаметка ср\n\n- [ ] позвонить"),
    );
    expect(r).toMatchObject({ status: "conflict", reason: expect.stringContaining("duplicate") });
  });

  it("T20 the reason stays one line: a multi-line paragraph is quoted with its newline escaped", () => {
    const r = run(
      bodied("## S\n\npara one\n\n- [ ] a\n- [ ] b"),
      bodied("## S\n\npara one\n\n## L split\n\n- [ ] a\n- [ ] b"),
      bodied("## S\n\npara one\n\n## R split\n\n- [ ] a\n- [ ] b"),
    );
    expect(r.status).toBe("conflict");
    if (r.status === "conflict") {
      expect(r.reason).toContain('"- [ ] a\\n- [ ] b"');
      expect(r.reason).not.toContain("\n");
    }
  });

  it("T21 the reason truncates a long paragraph to 60 characters", () => {
    const long = "Длинный абзац: ".padEnd(90, "ж");
    const r = run(
      bodied(`## S\n\npara one\n\n${long}`),
      bodied(`## S\n\npara one\n\n## L split\n\n${long}`),
      bodied(`## S\n\npara one\n\n## R split\n\n${long}`),
    );
    expect(r.status).toBe("conflict");
    if (r.status === "conflict") {
      expect(r.reason).toContain(`"${long.slice(0, 60)}…"`);
      expect(r.reason).not.toContain(long);
    }
  });

  it("P3 price: both sides pruned an old entry with its separator, each appended its own entry with its own → conflict (a re-add cannot be told from a split)", () => {
    const r = run(
      bodied("## 2026-10-27\n\nСделал отчёт.\n\n---\n\n## 2026-10-28\n\nСозвон."),
      bodied("## 2026-10-28\n\nСозвон.\n\n## 2026-10-29\n\nНовая запись.\n\n---"),
      bodied("## 2026-10-28\n\nСозвон.\n\nЕщё созвон.\n\n---"),
    );
    expect(r).toMatchObject({ status: "conflict", reason: expect.stringContaining("duplicate") });
  });

  it("P1 price: a paragraph moved to another section on one side, deleted on the other → conflict", () => {
    const r = run(
      bodied("## S\n\nmoved\n\ns\n\n## T\n\nt"),
      bodied("## S\n\ns\n\n## T\n\nt\n\nmoved"),
      bodied("## S\n\ns\n\n## T\n\nt"),
    );
    expect(r).toMatchObject({ status: "conflict", reason: expect.stringContaining("resurrect") });
  });
});
