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
  registerResolver,
  type ResolverContext,
} from "../../../src/services/SubstitutionResolverRegistry";

describe("SubstitutionResolverRegistry — RFC 727572d2 Phase A2 vocabulary", () => {
  beforeEach(() => {
    clearResolvers();
    installDefaultResolvers();
  });

  it("registers all 15 expected resolver-ids (4 legacy + 10 new + targetClassSelf)", () => {
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
  });
});
