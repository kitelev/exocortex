/**
 * Issue #4219 — a POSIX bracket expression quoted in a body is not a wikilink.
 *
 * `[[:space:]]` inside a grep pattern was read by the wikilink tokenizer as a
 * link to `:space:`, which failed in two opposite directions at once:
 *   - indexing emitted a junk `exo__Asset_bodyLink` edge (no SHACL shape judges
 *     it, so it accumulated silently);
 *   - `set-body` REFUSED the same body, making such a note uneditable without
 *     `--skip-wikilink-validation` — a flag that drops validation for the WHOLE
 *     body, so the corpus floor forbids it as the fix.
 *
 * The fixtures below are the shapes MEASURED in vault-exodev on 2026-09-20
 * (`:space:` ×16 and `:слово:` ×1 out of 8627 body links), not invented ones —
 * in particular the non-Latin case is why the predicate is a SHAPE and not an
 * allow-list of the twelve POSIX class names.
 */
import { isPosixBracketExpression } from "../../../src/services/NoteToRDFConverter";

describe("isPosixBracketExpression (Issue #4219)", () => {
  describe("recognises what is NOT a link", () => {
    it.each([
      [":space:", "the shape that produced 16 of the 17 junk edges"],
      [":alpha:", "sibling POSIX class"],
      [":digit:", "sibling POSIX class"],
      [":alnum:", "sibling POSIX class"],
      [":xdigit:", "sibling POSIX class"],
      [":слово:", "MEASURED in the corpus — a doc example, non-Latin"],
    ])("%s — %s", (target) => {
      expect(isPosixBracketExpression(target)).toBe(true);
    });
  });

  describe("leaves real link targets alone", () => {
    it.each([
      ["11111111-1111-1111-1111-111111111111", "a uid"],
      ["ems__Task", "a class reference"],
      ["Some Note Title", "a label-form linkpath"],
      ["2026-09-20", "a daily note"],
      ["folder/Note", "a path-form linkpath"],
      [":space", "opening colon only — not the shape"],
      ["space:", "closing colon only — not the shape"],
      ["::", "degenerate: nothing between the colons"],
      [":a b:", "contains whitespace — a linkpath may, a class may not"],
      [":a|b:", "contains the alias separator"],
      [":a]b:", "contains a bracket"],
    ])("%s — %s", (target) => {
      expect(isPosixBracketExpression(target)).toBe(false);
    });
  });

  it("⛔ is NOT an allow-list of POSIX class names", () => {
    // A list-based predicate would pass the twelve known names and miss the
    // non-Latin doc example that is already in the corpus — equally not a link.
    expect(isPosixBracketExpression(":слово:")).toBe(true);
    expect(isPosixBracketExpression(":имя:")).toBe(true);
  });
});
