/**
 * req 5cd9fffe — key-path segments are read as OWN properties only.
 *
 * A segment comes from user frontmatter (`exo__DisplayNameSpec_matchPath`, printed-part key
 * paths), so a bare `obj[part]` reaches `Object.prototype`. Verified by execution before fixing:
 * `({} as any)["toString"]` is a FUNCTION, so the walk continued over a function instead of
 * stopping — and `({a:1})["toString"]` did the same, meaning every asset WITH frontmatter was
 * already exposed, not just the empty-frontmatter case this requirement introduced.
 *
 * This is the twin of the registry hole closed in `PrintNameRuleService.matcherSatisfied`. Both
 * are "a string from the vault indexes a plain object", and fixing only the one that happened to
 * surface in review would have left the other in place.
 */
import { describe, it, expect } from "@jest/globals";
import { resolveKeyPath } from "../../../src/domain/display-name/keyPathResolver";

const REQ = "@req:5cd9fffe-1fa5-4fda-8e2a-bfe6d4c88379";

describe("resolveKeyPath — own-property reads", () => {
  it(`${REQ} resolves an ordinary own key path unchanged`, () => {
    const md = { a: { b: "value" } } as Record<string, unknown>;
    expect(resolveKeyPath(md, "a.b")).toBe("value");
  });

  it(`${REQ} does NOT reach Object.prototype for a segment named toString`, () => {
    // Without the guard this returns Object.prototype.toString — a function — and any downstream
    // formatting would stringify it into the rendered name.
    const md = { a: {} } as Record<string, unknown>;
    expect(resolveKeyPath(md, "a.toString")).toBeUndefined();
  });

  it(`${REQ} does NOT reach Object.prototype for constructor either`, () => {
    const md = { a: { real: 1 } } as Record<string, unknown>;
    expect(resolveKeyPath(md, "a.constructor")).toBeUndefined();
  });

  it(`${REQ} still reads array indices and length, which ARE own properties`, () => {
    // The guard must not break the legitimate numeric/`length` access the walk already supported.
    const md = { a: ["x", "y"] } as Record<string, unknown>;
    expect(resolveKeyPath(md, "a.1")).toBe("y");
    expect(resolveKeyPath(md, "a.length")).toBe(2);
  });

  it(`${REQ} returns undefined for a missing segment, as before`, () => {
    const md = { a: { b: 1 } } as Record<string, unknown>;
    expect(resolveKeyPath(md, "a.nope")).toBeUndefined();
  });
});
