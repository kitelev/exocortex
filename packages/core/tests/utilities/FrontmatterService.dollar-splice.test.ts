/**
 * #3795 review H1 — `FrontmatterService.updateProperty` / `removeProperty` must
 * NOT interpret `$`-patterns (`$&`, `$1`-`$9`, `` $` ``, `$'`, `$$`) in the value
 * as `String.prototype.replace` replacement patterns. An ordinary value like a
 * price `$1` or `$&` would otherwise splice a capture group / the whole match
 * (`FRONTMATTER_REGEX` has a group 1 = the entire frontmatter) into the file →
 * duplicated `---` block / injected frontmatter = unparseable YAML data-loss
 * (the #3748 corruption class).
 *
 * Revert-verify: reverting the function-replacers in updateProperty/removeProperty
 * (back to string replacements) reds these; restored → GREEN.
 */
import { describe, it, expect } from "@jest/globals";
import { FrontmatterService } from "../../src/utilities/FrontmatterService";

const DOLLAR_VALUES = ["$1", "$&", "$$", "$`", "$'", "$100 & $2", "$9$1"];

describe("FrontmatterService — `$`-bearing value splice safety (#3795 H1)", () => {
  const fm = new FrontmatterService();

  it.each(DOLLAR_VALUES)(
    "updateProperty preserves a $-bearing value verbatim (existing property): %s",
    (val) => {
      const content = "---\ntitle: X\nprice: old\n---\nbody\n";
      const out = fm.updateProperty(content, "price", val);

      // Exactly ONE frontmatter block — no duplicated `---` (the #3748 tell).
      expect((out.match(/^---$/gm) ?? []).length).toBe(2);
      // The value round-trips literally through a real YAML parse.
      const parsed = fm.parseObject(out);
      expect(parsed?.price).toBe(val);
      // Unrelated property untouched.
      expect(parsed?.title).toBe("X");
    },
  );

  it.each(DOLLAR_VALUES)(
    "updateProperty preserves a $-bearing value verbatim (new property): %s",
    (val) => {
      const content = "---\ntitle: X\n---\nbody\n";
      const out = fm.updateProperty(content, "note", val);

      expect((out.match(/^---$/gm) ?? []).length).toBe(2);
      const parsed = fm.parseObject(out);
      expect(parsed?.note).toBe(val);
      expect(parsed?.title).toBe("X");
    },
  );

  it("removeProperty does not corrupt a surviving $-bearing value", () => {
    // `price` carries a `$`-value; removing an UNRELATED property must not let
    // the surviving `price: $1` be re-interpreted in the outer block replace.
    const content = "---\ntitle: X\nprice: $1\ndrop: me\n---\nbody\n";
    const out = fm.removeProperty(content, "drop");

    expect((out.match(/^---$/gm) ?? []).length).toBe(2);
    const parsed = fm.parseObject(out);
    expect(parsed?.price).toBe("$1");
    expect(parsed?.title).toBe("X");
    expect(parsed?.drop).toBeUndefined();
  });
});
