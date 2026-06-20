/**
 * Unit tests — TemplateBodyResolver (homoiconic templating, vehy 2-4,
 * project 17f58ebe / vision 09a3fbec).
 *
 * `resolveTemplateBody` scans a markdown body for `$token` substitution markers
 * and replaces each KNOWN token with the value produced by the SAME
 * `SubstitutionResolverRegistry` that drives the RFC 727572d2 RDF-driven
 * asset-creation pipeline (interview Q6: reuse the existing resolvers, do not
 * duplicate the vocabulary). Unknown `$word` text and non-scalar / null-yielding
 * resolvers are left untouched (lenient — a body is freeform prose where a
 * literal `$5.00` must survive, unlike a grounding value position).
 *
 * This is the shared primitive behind:
 *   - Веха 2 — editor "Insert template" (insert a Template body at the cursor)
 *   - Веха 3 — `body_template` grounding step (copy a Template body into a
 *              newly created asset)
 *   - Веха 4 — variables in body templates (the `$token` resolution itself)
 */

import {
  clearResolvers,
  installDefaultResolvers,
  registerResolver,
} from "../../../src/services/SubstitutionResolverRegistry";
import {
  resolveTemplateBody,
  stripTemplateFrontmatter,
} from "../../../src/services/TemplateBodyResolver";

describe("resolveTemplateBody — registry-driven $token substitution (vehy 2-4)", () => {
  beforeEach(() => {
    clearResolvers();
    installDefaultResolvers();
  });

  it("replaces a known scalar token with its resolver value", () => {
    registerResolver("today", () => "2026-06-20");
    expect(resolveTemplateBody("Date: $today")).toBe("Date: 2026-06-20");
  });

  it("replaces multiple distinct tokens in one pass", () => {
    registerResolver("nowDate", () => "2026-06-20");
    registerResolver("randomUUIDv4", () => "11111111-2222-3333-4444-555555555555");
    expect(
      resolveTemplateBody("## Log\n- created $nowDate (id $randomUUIDv4)"),
    ).toBe("## Log\n- created 2026-06-20 (id 11111111-2222-3333-4444-555555555555)");
  });

  it("replaces every occurrence of a repeated token", () => {
    let n = 0;
    registerResolver("counter", () => String(++n));
    // Each occurrence resolves independently (resolver is invoked per match).
    expect(resolveTemplateBody("$counter $counter $counter")).toBe("1 2 3");
  });

  it("leaves an UNKNOWN $token literal untouched (lenient — freeform prose)", () => {
    expect(resolveTemplateBody("Price is $5 and $totallyUnknownToken stays")).toBe(
      "Price is $5 and $totallyUnknownToken stays",
    );
  });

  it("leaves a token whose resolver yields a non-string (string[]) untouched", () => {
    registerResolver("labelAsArray", () => ["a", "b"]);
    expect(resolveTemplateBody("x $labelAsArray y")).toBe("x $labelAsArray y");
  });

  it("leaves a token whose resolver yields null untouched", () => {
    registerResolver("maybe", () => null);
    expect(resolveTemplateBody("x $maybe y")).toBe("x $maybe y");
  });

  it("leaves a token whose resolver yields an EMPTY string untouched (M1 — context-missing resolvers)", () => {
    // Built-in `target` returns "" when no targetIRI is in context — and the
    // editor "Insert template" path resolves with no context. A silently-deleted
    // token is worse than a visible one the user can fix.
    expect(resolveTemplateBody("link: $target end")).toBe("link: $target end");
    expect(resolveTemplateBody("$userInputLabel here")).toBe(
      "$userInputLabel here",
    );
  });

  it("does not partially match — $todayX resolves token name 'todayX', not 'today'", () => {
    registerResolver("today", () => "2026-06-20");
    // 'todayX' is unregistered → whole `$todayX` left literal; `today` NOT spliced.
    expect(resolveTemplateBody("$todayX")).toBe("$todayX");
  });

  it("stops a token name at non-identifier chars (dot, dash, slash)", () => {
    registerResolver("today", () => "2026-06-20");
    expect(resolveTemplateBody("$today.md $today-end $today/x")).toBe(
      "2026-06-20.md 2026-06-20-end 2026-06-20/x",
    );
  });

  it("passes ResolverContext through to context-dependent resolvers", () => {
    registerResolver("userInputLabel", (ctx) =>
      typeof ctx.userInput?.label === "string" ? ctx.userInput.label : "",
    );
    expect(
      resolveTemplateBody("Title: $userInputLabel", {
        userInput: { label: "My Project" },
      }),
    ).toBe("Title: My Project");
  });

  it("returns an empty string unchanged and a token-free body unchanged", () => {
    expect(resolveTemplateBody("")).toBe("");
    expect(resolveTemplateBody("## Plan\n- step one\n- step two")).toBe(
      "## Plan\n- step one\n- step two",
    );
  });

  it("resolves the live built-in vocabulary (module-load install) after beforeEach", () => {
    // beforeEach reinstalled defaults; `nowYear` is a built-in 4-digit resolver.
    expect(resolveTemplateBody("Year $nowYear")).toMatch(/^Year \d{4}$/);
  });
});

describe("stripTemplateFrontmatter (Веха 3 — template body = file body)", () => {
  it("returns the body after the frontmatter, consuming the separating newline", () => {
    expect(
      stripTemplateFrontmatter("---\nexo__Asset_uid: x\n---\n## Plan\n- step"),
    ).toBe("## Plan\n- step");
  });

  it("returns the whole content when there is no frontmatter", () => {
    expect(stripTemplateFrontmatter("## Just a body")).toBe("## Just a body");
  });

  it("returns an empty body after frontmatter", () => {
    expect(stripTemplateFrontmatter("---\na: b\n---\n")).toBe("");
  });

  it("tolerates CRLF frontmatter (Windows vault)", () => {
    expect(
      stripTemplateFrontmatter("---\r\na: b\r\n---\r\n## Plan\r\n- x"),
    ).toBe("## Plan\r\n- x");
  });

  it("differs from sparqlBlock.stripFrontmatter — no leading newline kept", () => {
    // sparqlBlock.stripFrontmatter would return "\n## Plan"; this one consumes it.
    expect(stripTemplateFrontmatter("---\na: b\n---\n## Plan")).not.toMatch(/^\n/);
  });
});
