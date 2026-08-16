import { describe, it, expect } from "@jest/globals";
import { DisplayNameResolver } from "../../../src/domain/display-name/DisplayNameResolver";
import { DEFAULT_DISPLAY_NAME_SETTINGS } from "../../../src/domain/display-name/DisplayNameSettings";
import type { DisplayNameSettings } from "../../../src/domain/display-name/DisplayNameSettings";

/**
 * req 1da8e1bf — `DisplayNameResolver.resolveRenderSpec` reads `settings.classTemplates` as an
 * OWN property (issue #4061).
 *
 * ⛔ The FIFTH read of this class and the only one that THREW. Its four siblings — the
 * host-function registry (`5cd9fffe`), the key-path walk (`4a2e6b80`), the flat matcher read
 * (#4060) and the blocker link (#4062) — are all rescued downstream by a non-string being
 * dropped, so their worst case is "the spec does not participate". Here the guard
 * `if (firstClass && classTemplates[firstClass])` PASSED on `toString`, because
 * `Function.prototype.toString` is truthy, and a FUNCTION left as `template` →
 * `DisplayNameTemplateEngine` called `.trim()` on it → uncaught TypeError. Neither
 * `BodyLinkPatch` nor `GraphViewPatch` wraps `resolve()`, so that breaks naming wholesale.
 *
 * ⛤ These drive the REAL `resolve()`, not `resolveRenderSpec` directly: the private method is
 * where the guard lives, so asserting on it could not observe whether the public path routes
 * through the guard — the same reason #4060's axis had to be a call-site axis.
 *
 * ⚠ Reachability is low (it needs a class LABEL equal to an `Object.prototype` member, and labels
 * follow `prefix__Name`). Closed on principle, exactly as `4a2e6b80`'s own Known-boundaries say —
 * stated rather than implied.
 */
const REQ = "@req:1da8e1bf-22e7-4f2b-b0ec-86dde1adf3e8";

const TASK_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e";

function settingsWith(classTemplates: Record<string, unknown>): DisplayNameSettings {
  return {
    ...DEFAULT_DISPLAY_NAME_SETTINGS,
    defaultTemplate: "{{exo__Asset_label}}",
    classTemplates: classTemplates as Record<string, string>,
  };
}

/** An ordinary ABox asset whose class ALIAS is `alias` — the shape `cleanClassValue` reads. */
function assetWithClassAlias(alias: string): { metadata: Record<string, unknown>; basename: string } {
  return {
    metadata: {
      exo__Instance_class: [`[[${TASK_UID}|${alias}]]`],
      exo__Asset_label: "Ship the release",
    },
    basename: "t1",
  };
}

describe("DisplayNameResolver — classTemplates is read own-only [req 1da8e1bf / #4061]", () => {
  it(`${REQ} a class label equal to an Object.prototype member does NOT throw — the discriminating input`, () => {
    // Pre-fix: `classTemplates["toString"]` walked the prototype chain, returned a function, the
    // truthiness guard passed, and the engine threw `TypeError: this.template.trim is not a
    // function`. `toThrow` is the wrong assertion to leave here — the point is the RESULT.
    const resolver = new DisplayNameResolver(settingsWith({}));

    expect(resolver.resolve(assetWithClassAlias("toString"))).toBe("Ship the release");
  });

  it(`${REQ} the same holds for every other Object.prototype member a label could collide with`, () => {
    const resolver = new DisplayNameResolver(settingsWith({}));

    for (const member of ["constructor", "valueOf", "hasOwnProperty", "toLocaleString", "isPrototypeOf"]) {
      expect(resolver.resolve(assetWithClassAlias(member))).toBe("Ship the release");
    }
  });

  it(`${REQ} an OWN non-string value does not reach the engine either`, () => {
    // ⛤ NOT redundant with the own-property guard, and this axis is what proves it: the key here
    // IS own, so `ownProperty` returns it; only the `typeof` check keeps a non-string out. The
    // `Record<string, string>` type is a claim about data the USER writes, not a guarantee.
    const resolver = new DisplayNameResolver(
      settingsWith({ ems__Task: { not: "a string" } }),
    );

    expect(resolver.resolve(assetWithClassAlias("ems__Task"))).toBe("Ship the release");
  });

  it(`${REQ} CONTROL — an OWN classTemplates entry still applies byte-identically`, () => {
    // The whole change is worthless if it also stops the feature working. Green both ways.
    const resolver = new DisplayNameResolver(
      settingsWith({ ems__Task: "📋 {{exo__Asset_label}}" }),
    );

    expect(resolver.resolve(assetWithClassAlias("ems__Task"))).toBe("📋 Ship the release");
  });

  it(`${REQ} CONTROL — an ordinary class with NO entry falls through to the default template`, () => {
    // Guards the other direction: the fix must not turn "no entry" into something other than the
    // default. Green both ways; recorded so the pair cannot be reduced to the discriminator alone.
    const resolver = new DisplayNameResolver(
      settingsWith({ ems__Project: "📁 {{exo__Asset_label}}" }),
    );

    expect(resolver.resolve(assetWithClassAlias("ems__Task"))).toBe("Ship the release");
  });

  it(`${REQ} an OWN entry holding an EMPTY STRING falls through to the default, name AND provenance`, () => {
    // ⛤ Locks the `&& classTemplate` sub-clause, which review showed was carrying real behaviour
    // while no axis observed it: dropping only that clause reds NOTHING, yet an empty per-class
    // template then reaches the engine and `displayName` becomes **null** — the name vanishes
    // entirely — while provenance wrongly reports "classTemplate" to the CLI naming oracle.
    //
    // ⛔ Assert the PAIR, not just the name: provenance is the half that would still be wrong if
    // someone "simplified" this to `typeof classTemplate === "string"` and the engine happened to
    // fall back on its own.
    const resolver = new DisplayNameResolver(settingsWith({ ems__Task: "" }));

    expect(resolver.resolveWithProvenance(assetWithClassAlias("ems__Task"))).toEqual({
      displayName: "Ship the release",
      provenance: "default",
    });
  });

  it(`${REQ} the CONFIGURED-CLASS counters agree with what actually renders`, () => {
    // Tightening the render path to "a NON-EMPTY STRING applies" would otherwise leave
    // `hasClassTemplates()` counting by `Object.keys` — true while nothing renders. Same predicate
    // both places, so the two cannot drift.
    const resolver = new DisplayNameResolver(
      settingsWith({ ems__Task: "", ems__Project: { not: "a string" } }),
    );

    expect(resolver.hasClassTemplates()).toBe(false);
    expect(resolver.getConfiguredClasses()).toEqual([]);
  });
});
