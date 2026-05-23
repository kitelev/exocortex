import { describe, it, expect } from "@jest/globals";
import { rewriteContent } from "../../../src/utils/wikilinkRewriter.js";

/**
 * RFC 1ce2a226 Phase 3c acceptance: anchors (`#heading` / `^block`) are
 * PRESERVED when an inbound wikilink is rewritten from `oldBasename` to
 * `newBasename`. The display alias (`|Alias`) is dropped (strip-canon).
 *
 * Pre-Phase-3 behaviour collapsed every shape to bare `[[NewBase]]` — the
 * regex captured the anchor in a non-capturing group and discarded it. This
 * destroyed deep links inside long notes (e.g. `[[BAD-2026-W21#Понедельник]]`
 * lost its `Понедельник` section pointer on UUID-canon rename). Phase 3c
 * fixes that by capturing the anchor and re-emitting it under the new target.
 */
describe("wikilinkRewriter — anchor preservation (RFC 1ce2a226 Phase 3c)", () => {
  const OLD = "Choco";
  const NEW = "11111111-1111-1111-1111-111111111111";

  it("preserves #heading anchor on bare wikilink", () => {
    const { updated, replacements } = rewriteContent(
      "See [[Choco#Ingredients]] section.\n",
      OLD,
      NEW,
    );
    expect(replacements).toBe(1);
    expect(updated).toContain(`[[${NEW}#Ingredients]]`);
    expect(updated).not.toContain(`[[${NEW}]]`);
  });

  it("preserves #heading anchor when alias is also present (strips alias)", () => {
    const { updated, replacements } = rewriteContent(
      "Read [[Choco#Ingredients|See Ingredients]] now.\n",
      OLD,
      NEW,
    );
    expect(replacements).toBe(1);
    expect(updated).toContain(`[[${NEW}#Ingredients]]`);
    expect(updated).not.toContain("See Ingredients");
  });

  it("preserves ^block reference on bare wikilink", () => {
    const { updated, replacements } = rewriteContent(
      "Quote [[Choco^block-abc]] here.\n",
      OLD,
      NEW,
    );
    expect(replacements).toBe(1);
    expect(updated).toContain(`[[${NEW}^block-abc]]`);
  });

  it("preserves ^block reference when alias is also present (strips alias)", () => {
    const { updated, replacements } = rewriteContent(
      "Quote [[Choco^block-abc|callout]] here.\n",
      OLD,
      NEW,
    );
    expect(replacements).toBe(1);
    expect(updated).toContain(`[[${NEW}^block-abc]]`);
    expect(updated).not.toContain("callout");
  });

  it("collapses [[Old]] (no anchor, no alias) to bare [[uid]]", () => {
    const { updated, replacements } = rewriteContent(
      "Plain [[Choco]] link.\n",
      OLD,
      NEW,
    );
    expect(replacements).toBe(1);
    expect(updated).toContain(`[[${NEW}]]`);
  });

  it("collapses [[Old|Alias]] to bare [[uid]] (strips alias, no anchor)", () => {
    const { updated, replacements } = rewriteContent(
      "Aliased [[Choco|Display Label]] link.\n",
      OLD,
      NEW,
    );
    expect(replacements).toBe(1);
    expect(updated).toContain(`[[${NEW}]]`);
    expect(updated).not.toContain("Display Label");
  });

  it("does not rewrite links inside fenced code blocks", () => {
    const input =
      "Before [[Choco#Ingredients]].\n" +
      "```\nKeep [[Choco#Ingredients]] verbatim.\n```\n" +
      "After [[Choco#Ingredients]].\n";
    const { updated, replacements } = rewriteContent(input, OLD, NEW);
    expect(replacements).toBe(2);
    expect(updated).toContain("Keep [[Choco#Ingredients]] verbatim.");
    expect(updated).toContain(`Before [[${NEW}#Ingredients]]`);
    expect(updated).toContain(`After [[${NEW}#Ingredients]]`);
  });

  it("does not rewrite anchor links inside inline code spans", () => {
    const input = "Outside [[Choco#Ingredients]] but `[[Choco#Ingredients]]` inline.\n";
    const { updated, replacements } = rewriteContent(input, OLD, NEW);
    expect(replacements).toBe(1);
    expect(updated).toContain("`[[Choco#Ingredients]]`");
    expect(updated).toContain(`Outside [[${NEW}#Ingredients]]`);
  });

  it("does not rewrite embed anchors (![[Old#section]])", () => {
    const input = "Embed ![[Choco#Ingredients]] block.\n";
    const { updated, replacements } = rewriteContent(input, OLD, NEW);
    expect(replacements).toBe(0);
    expect(updated).toBe(input);
  });

  it("leaves unrelated targets with anchors untouched", () => {
    const input = "See [[Banana#Slicing]] doc.\n";
    const { updated, replacements } = rewriteContent(input, OLD, NEW);
    expect(replacements).toBe(0);
    expect(updated).toBe(input);
  });
});
