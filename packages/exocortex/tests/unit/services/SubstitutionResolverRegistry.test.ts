/**
 * Unit tests — SubstitutionResolverRegistry (RFC 727572d2 Phase C).
 *
 * Each new resolver function is exercised in isolation:
 * - Parameterless resolvers receive a fresh ResolverContext, return expected shape
 * - Parameterised resolvers receive parameter, look up via context
 * - Missing context yields null (resolver chain skips entry)
 *
 * Registry register/clear lifecycle is also tested so test isolation works.
 */

import {
  clearResolvers,
  getRegisteredResolverIds,
  getResolver,
  installDefaultResolvers,
  isResolverModifierAware,
  registerResolver,
  type ResolverContext,
} from "../../../src/services/SubstitutionResolverRegistry";

describe("SubstitutionResolverRegistry — RFC 727572d2 Phase A2 vocabulary", () => {
  beforeEach(() => {
    clearResolvers();
    installDefaultResolvers();
  });

  it("registers all 19 expected resolver-ids (4 legacy + 10 new + targetClassSelf + 4 date-modifier tokens Веха 5)", () => {
    const ids = getRegisteredResolverIds().sort();
    expect(ids).toEqual(
      [
        "groundingTargetClass",
        "labelAsArray",
        "nowDate",
        "nowMonth",
        "nowTimestamp",
        "nowYear",
        "randomUUIDv4",
        "target",
        "targetClassSelf",
        "targetFolder",
        "targetProperty",
        "today",
        "todayStart",
        "userInput",
        "userInputLabel",
        // Веха 5 — Templater `tp.date.*` parity (date format + offset tokens)
        "date",
        "now",
        "tomorrow",
        "yesterday",
      ].sort(),
    );
  });

  describe("targetClassSelf (T1 Create Instance — host IS the class)", () => {
    it("returns a quoted wikilink to the host file's own UID (basename)", () => {
      const fn = getResolver("targetClassSelf")!;
      const result = fn({
        targetFilePath:
          "assetspaces/kitelev/exoas-ems/ems/1b20a8f0-d745-4e93-91db-4531b3df120e.md",
      } as ResolverContext);
      expect(result).toBe('"[[1b20a8f0-d745-4e93-91db-4531b3df120e]]"');
    });

    it("strips a leading slash from the path before extracting basename", () => {
      const fn = getResolver("targetClassSelf")!;
      const result = fn({
        targetFilePath: "/8619c4fc-64f1-4869-b17e-e34186cacca9.md",
      } as ResolverContext);
      expect(result).toBe('"[[8619c4fc-64f1-4869-b17e-e34186cacca9]]"');
    });

    it("returns null when no target file path is in context (CLI/test harness)", () => {
      const fn = getResolver("targetClassSelf")!;
      expect(fn({} as ResolverContext)).toBeNull();
    });

    it("returns null when the path has no basename after stripping .md", () => {
      const fn = getResolver("targetClassSelf")!;
      expect(fn({ targetFilePath: ".md" } as ResolverContext)).toBeNull();
    });
  });

  describe("randomUUIDv4", () => {
    it("produces a UUID v4 shape on each call", () => {
      const fn = getResolver("randomUUIDv4")!;
      const a = fn({} as ResolverContext) as string;
      const b = fn({} as ResolverContext) as string;
      expect(a).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(b).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(a).not.toBe(b);
    });
  });

  describe("nowTimestamp / nowDate / nowYear / nowMonth", () => {
    it("nowTimestamp matches local ISO 8601 shape (no Z suffix)", () => {
      const ts = getResolver("nowTimestamp")!({} as ResolverContext) as string;
      expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    });

    it("nowDate matches YYYY-MM-DD shape", () => {
      const d = getResolver("nowDate")!({} as ResolverContext) as string;
      expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("nowYear is current 4-digit year", () => {
      const y = getResolver("nowYear")!({} as ResolverContext) as string;
      expect(y).toBe(String(new Date().getFullYear()));
    });

    it("nowMonth is zero-padded 2-digit month", () => {
      const m = getResolver("nowMonth")!({} as ResolverContext) as string;
      expect(m).toMatch(/^(0[1-9]|1[0-2])$/);
    });
  });

  describe("userInputLabel", () => {
    it("returns userInput.label when present", () => {
      const fn = getResolver("userInputLabel")!;
      expect(fn({ userInput: { label: "Hello" } })).toBe("Hello");
    });
    it("returns empty when userInput.label missing", () => {
      const fn = getResolver("userInputLabel")!;
      expect(fn({})).toBe("");
      expect(fn({ userInput: {} })).toBe("");
    });
  });

  describe("userInput (parameterised)", () => {
    it("returns userInput[param] when present", () => {
      const fn = getResolver("userInput")!;
      expect(fn({ userInput: { description: "Desc" } }, "description")).toBe(
        "Desc",
      );
    });
    it("returns null when parameter missing", () => {
      const fn = getResolver("userInput")!;
      expect(fn({ userInput: { description: "Desc" } })).toBeNull();
    });
    it("returns null when key not in userInput", () => {
      const fn = getResolver("userInput")!;
      expect(fn({ userInput: { description: "Desc" } }, "missing")).toBeNull();
    });
  });

  describe("targetProperty (parameterised)", () => {
    it("extracts scalar from targetFm[param]", () => {
      const fn = getResolver("targetProperty")!;
      expect(
        fn(
          { targetFm: { exo__Asset_isDefinedBy: "[[ems-ontology]]" } },
          "exo__Asset_isDefinedBy",
        ),
      ).toBe("[[ems-ontology]]");
    });
    it("returns string[] for list-typed targetFm value", () => {
      const fn = getResolver("targetProperty")!;
      expect(
        fn(
          { targetFm: { aliases: ["a", "b"] } },
          "aliases",
        ),
      ).toEqual(["a", "b"]);
    });
    it("returns null when parameter missing or targetFm missing", () => {
      const fn = getResolver("targetProperty")!;
      expect(fn({})).toBeNull();
      expect(fn({ targetFm: {} }, "exo__Asset_uid")).toBeNull();
    });
  });

  describe("labelAsArray", () => {
    it("returns [label] when userInput.label is non-empty string", () => {
      const fn = getResolver("labelAsArray")!;
      expect(fn({ userInput: { label: "X" } })).toEqual(["X"]);
    });
    it("returns empty array when label absent or empty", () => {
      const fn = getResolver("labelAsArray")!;
      expect(fn({})).toEqual([]);
      expect(fn({ userInput: { label: "" } })).toEqual([]);
    });
  });

  describe("groundingTargetClass", () => {
    it("emits wikilink-form when targetClass UID set", () => {
      const fn = getResolver("groundingTargetClass")!;
      expect(
        fn({ groundingTargetClassUid: "1b20a8f0-d745-4e93-91db-4531b3df120e" }),
      ).toBe('"[[1b20a8f0-d745-4e93-91db-4531b3df120e]]"');
    });
    it("returns null when targetClass UID missing", () => {
      const fn = getResolver("groundingTargetClass")!;
      expect(fn({})).toBeNull();
    });
  });

  describe("registry lifecycle", () => {
    it("registerResolver overwrites existing", () => {
      registerResolver("test_id", () => "v1");
      registerResolver("test_id", () => "v2");
      expect(getResolver("test_id")!({})).toBe("v2");
    });
    it("clearResolvers empties registry", () => {
      registerResolver("temp", () => "x");
      clearResolvers();
      expect(getResolver("temp")).toBeUndefined();
    });
    it("registerResolver marks modifier-aware when flagged; default false", () => {
      registerResolver("mod_on", () => "x", true);
      registerResolver("mod_off", () => "y");
      expect(isResolverModifierAware("mod_on")).toBe(true);
      expect(isResolverModifierAware("mod_off")).toBe(false);
    });
    it("clearResolvers also clears modifier-aware flags", () => {
      registerResolver("mod_on", () => "x", true);
      clearResolvers();
      expect(isResolverModifierAware("mod_on")).toBe(false);
    });
  });
});

describe("date format + offset tokens (Веха 5 — Templater `tp.date.*` parity)", () => {
  // Pin "now" to a fixed LOCAL instant (noon, far from midnight so no TZ/DST
  // flip) — both setSystemTime and the resolvers' local getters interpret it in
  // local time, so assertions are TZ-independent. 2026-06-21 is a Sunday.
  beforeEach(() => {
    clearResolvers();
    installDefaultResolvers();
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-21T12:30:45"));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const call = (id: string, param?: string): string =>
    getResolver(id)!({} as ResolverContext, param) as string;

  describe("default format (no modifier)", () => {
    it("$date → YYYY-MM-DD of today", () => {
      expect(call("date")).toBe("2026-06-21");
    });
    it("$now → local datetime YYYY-MM-DDTHH:mm:ss", () => {
      expect(call("now")).toBe("2026-06-21T12:30:45");
    });
    it("$tomorrow → today + 1 day", () => {
      expect(call("tomorrow")).toBe("2026-06-22");
    });
    it("$yesterday → today − 1 day", () => {
      expect(call("yesterday")).toBe("2026-06-20");
    });
  });

  describe("format strings", () => {
    it("Russian/European DD.MM.YYYY", () => {
      expect(call("date", ":DD.MM.YYYY")).toBe("21.06.2026");
    });
    it("slashed YYYY/MM/DD", () => {
      expect(call("date", ":YYYY/MM/DD")).toBe("2026/06/21");
    });
    it("time-only HH:mm:ss (format retains its own colons)", () => {
      expect(call("now", ":HH:mm:ss")).toBe("12:30:45");
    });
    it("12-hour clock with meridiem (h:mm A)", () => {
      expect(call("now", ":h:mm A")).toBe("12:30 PM");
    });
    it("full month + ordinal day + weekday (English names)", () => {
      expect(call("date", ":dddd, MMMM Do YYYY")).toBe(
        "Sunday, June 21st 2026",
      );
    });
    it("short month + 2-digit year (MMM YY)", () => {
      expect(call("date", ":MMM YY")).toBe("Jun 26");
    });
    it("separator characters (-, /, ., :, T, space, digits) pass through literally", () => {
      // ISO datetime: the 'T' and all separators are non-tokens → reproduced
      // verbatim; only YYYY/MM/DD/HH/mm/ss are substituted.
      expect(call("now", ":YYYY-MM-DDTHH:mm:ss")).toBe("2026-06-21T12:30:45");
    });
  });

  describe("offset (no format → default format applied to shifted date)", () => {
    it("+7d → +7 days", () => {
      expect(call("date", "+7d")).toBe("2026-06-28");
    });
    it("-3d → −3 days", () => {
      expect(call("date", "-3d")).toBe("2026-06-18");
    });
    it("bare number defaults to days (+5)", () => {
      expect(call("date", "+5")).toBe("2026-06-26");
    });
    it("+2w → +2 weeks", () => {
      expect(call("date", "+2w")).toBe("2026-07-05");
    });
    it("+1M → +1 month (crosses month boundary)", () => {
      expect(call("date", "+1M")).toBe("2026-07-21");
    });
    it("+1y → +1 year", () => {
      expect(call("date", "+1y")).toBe("2027-06-21");
    });
    it("month offset overflows the year (+7M from June → January next year)", () => {
      expect(call("date", "+7M")).toBe("2027-01-21");
    });
  });

  describe("offset + format combined", () => {
    it("+7d:YYYY-MM-DD", () => {
      expect(call("date", "+7d:YYYY-MM-DD")).toBe("2026-06-28");
    });
    it("+1M:YYYY-MM", () => {
      expect(call("date", "+1M:YYYY-MM")).toBe("2026-07");
    });
    it("$tomorrow with extra offset stacks on the base shift (+1 then +6 = +7)", () => {
      expect(call("tomorrow", "+6d")).toBe("2026-06-28");
    });
    it("$yesterday with format", () => {
      expect(call("yesterday", ":DD.MM.YYYY")).toBe("20.06.2026");
    });
  });

  describe("leniency — malformed modifier never throws", () => {
    it("malformed offset leaves the date unshifted (default format)", () => {
      expect(call("date", "+abc")).toBe("2026-06-21");
    });
    it("empty format after colon falls back to the default format", () => {
      expect(call("date", "+7d:")).toBe("2026-06-28");
    });
    it("offset with unknown unit char is treated as no-match (unshifted)", () => {
      expect(call("date", "+3q")).toBe("2026-06-21");
    });
  });

  it("date tokens are registered modifier-aware; legacy date tokens are not", () => {
    for (const id of ["date", "now", "tomorrow", "yesterday"]) {
      expect(isResolverModifierAware(id)).toBe(true);
    }
    for (const id of ["today", "nowDate", "nowTimestamp", "nowYear"]) {
      expect(isResolverModifierAware(id)).toBe(false);
    }
  });
});
