/**
 * req 4a2e6b80 — key-path segments are read as OWN properties only.
 *
 * A segment comes from user frontmatter (`exo__DisplayNameSpec_matchPath`, printed-part key
 * paths), so a bare `obj[part]` reaches `Object.prototype`. Verified by execution before fixing:
 * `({} as any)["toString"]` is a FUNCTION, so the walk continued over a function instead of
 * stopping — and `({a:1})["toString"]` did the same, meaning every asset WITH frontmatter was
 * already exposed, not just the empty-frontmatter case req 5cd9fffe introduced.
 *
 * This is the twin of the registry hole closed in `PrintNameRuleService.matcherSatisfied`. Both
 * are "a string from the vault indexes a plain object", and fixing only the one that happened to
 * surface in review would have left the other in place.
 */
import { describe, it, expect } from "@jest/globals";
import { resolveKeyPath } from "../../../src/domain/display-name/keyPathResolver";

const REQ = "@req:4a2e6b80-bd46-47b1-a8c5-08c40837879a";

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

  it(`${REQ} closes the RESOLVER-hop entry point too — a separate branch from the plain object`, () => {
    // ⛔ The two entry points are different code, and one axis leaves the other unpinned. The
    // tests above walk a plain nested object (the `typeof current !== "object"` fall-through);
    // this one crosses a wikilink hop, where the resolver hands back the object being indexed.
    // A req-5cd9fffe adapter returns `{}` for a file with no frontmatter, so this is exactly the
    // shape that made me notice the hole in the first place.
    const md = { a: "[[some-uid]]" } as Record<string, unknown>;
    const resolver = () => ({}) as Record<string, unknown>;

    expect(resolveKeyPath(md, "a.toString", resolver)).toBeUndefined();
    // …and the same hop still reads a genuine own property, so the guard is not just "return
    // undefined for everything crossing a hop".
    const resolver2 = () => ({ real: "value" }) as Record<string, unknown>;
    expect(resolveKeyPath(md, "a.real", resolver2)).toBe("value");
  });

  it(`${REQ} closes the ARRAY-hop entry point — the third index site`, () => {
    // `resolveKeyPath` indexes in three places; the array branch (first element is a wikilink)
    // is the third and is reached by neither test above.
    const md = { a: ["[[some-uid]]"] } as Record<string, unknown>;
    expect(resolveKeyPath(md, "a.constructor", () => ({}))).toBeUndefined();
    expect(resolveKeyPath(md, "a.real", () => ({ real: 7 }))).toBe(7);
  });

  it(`${REQ} returns undefined for a missing segment, as before`, () => {
    const md = { a: { b: 1 } } as Record<string, unknown>;
    expect(resolveKeyPath(md, "a.nope")).toBeUndefined();
  });
});
