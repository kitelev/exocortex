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

describe("resolveTemplateBody — inline date format + offset tokens (Веха 5)", () => {
  // Pin "now" to a fixed LOCAL noon so date assertions are TZ-independent.
  // 2026-06-21 is a Sunday.
  beforeEach(() => {
    clearResolvers();
    installDefaultResolvers();
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-21T12:30:45"));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("resolves a bare $date / $now / $tomorrow / $yesterday in body text", () => {
    expect(resolveTemplateBody("Today: $date")).toBe("Today: 2026-06-21");
    expect(resolveTemplateBody("Now: $now")).toBe("Now: 2026-06-21T12:30:45");
    expect(resolveTemplateBody("Due $tomorrow")).toBe("Due 2026-06-22");
    expect(resolveTemplateBody("Was $yesterday")).toBe("Was 2026-06-20");
  });

  it("resolves an inline format suffix $date:DD.MM.YYYY", () => {
    expect(resolveTemplateBody("Дата: $date:DD.MM.YYYY")).toBe(
      "Дата: 21.06.2026",
    );
  });

  it("resolves an inline offset suffix $date+7d", () => {
    expect(resolveTemplateBody("Review by $date+7d")).toBe(
      "Review by 2026-06-28",
    );
  });

  it("resolves offset + format together $date+1M:YYYY-MM", () => {
    expect(resolveTemplateBody("Sprint $date+1M:YYYY-MM end")).toBe(
      "Sprint 2026-07 end",
    );
  });

  it("keeps a time format's internal colons but stops at whitespace", () => {
    expect(resolveTemplateBody("Logged at $now:HH:mm:ss today")).toBe(
      "Logged at 12:30:45 today",
    );
  });

  it("stops the format at a comma (surrounding prose survives)", () => {
    expect(resolveTemplateBody("Due $date:YYYY-MM-DD, then ship")).toBe(
      "Due 2026-06-21, then ship",
    );
  });

  it("resolves multiple date tokens with distinct modifiers in one body", () => {
    expect(resolveTemplateBody("from $date to $date+7d ($date+7d:dddd)")).toBe(
      "from 2026-06-21 to 2026-06-28 (Sunday)",
    );
  });

  it("ZERO REGRESSION — legacy modifier-UNAWARE token reproduces the suffix verbatim", () => {
    // `today` is legacy (UTC, modifier-unaware). Its value with the suffix
    // re-appended must equal the pre-feature output (old regex stopped at the
    // first non-identifier char, leaving `+7d` / `:foo` literal). We register a
    // deterministic `today` so the assertion is exact regardless of UTC offset.
    registerResolver("today", () => "2026-06-21");
    expect(resolveTemplateBody("$today+7d")).toBe("2026-06-21+7d");
    expect(resolveTemplateBody("$today:YYYY")).toBe("2026-06-21:YYYY");
  });

  it("ZERO REGRESSION — $today.md / $today-end / $today/x still split at punctuation", () => {
    registerResolver("today", () => "2026-06-21");
    // `.md` has no leading `:` → not a format suffix; `-end` has no digit after
    // `-` → not an offset; `/x` is neither. All capture an empty suffix.
    expect(resolveTemplateBody("$today.md $today-end $today/x")).toBe(
      "2026-06-21.md 2026-06-21-end 2026-06-21/x",
    );
  });

  it("leaves an UNKNOWN token-with-suffix fully literal (whole match preserved)", () => {
    expect(resolveTemplateBody("$bogus+7d:YYYY-MM-DD stays")).toBe(
      "$bogus+7d:YYYY-MM-DD stays",
    );
  });

  it("leaves a literal $5.00 price untouched (no letter after $)", () => {
    expect(resolveTemplateBody("Costs $5.00 total")).toBe("Costs $5.00 total");
  });

  it("LIMITATION — a space/comma in a body format truncates it at that char", () => {
    // Documents the body-path boundary (the format charset excludes space/comma):
    // `$now:h:mm A` resolves only `:h:mm` → `12:30`; the ` A` survives as prose.
    // Multi-word formats are reachable only via TokenInvocation_parameter.
    expect(resolveTemplateBody("Time $now:h:mm A done")).toBe(
      "Time 12:30 A done",
    );
    expect(resolveTemplateBody("$date:dddd, MMMM Do YYYY")).toBe(
      "Sunday, MMMM Do YYYY",
    );
  });

  it("leaves a malformed offset as prose ($date+abc → <date>+abc)", () => {
    // `+abc` is not a date-shaped offset (no digit after `+`) → suffix is empty,
    // `$date` resolves, `+abc` stays literal prose.
    expect(resolveTemplateBody("$date+abc")).toBe("2026-06-21+abc");
  });
});
