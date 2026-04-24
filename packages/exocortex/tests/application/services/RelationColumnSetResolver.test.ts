/**
 * RelationColumnSetResolver unit tests.
 *
 * Phase 2 of RFC be70f741-a8e3-4826-aab1-d3f950068861.
 *
 * Coverage plan (RFC §"Unit-тесты (обязательные)")
 * - Base matrix: 4 tiers × {single-match, 2-match collision, 0-match} = 12 cases.
 * - Tiebreaker: priority > (DESC), priority = + uid < (ASC).
 * - Normalization roundtrip — all wikilink forms exercised via `resolve`.
 * - Multi-class ladder: 3 classes, collision on tier-2 → first class wins.
 * - Empty rowClasses / empty property → null.
 * - Multi-class array в config.targetClasses — expand в N tuples via `.includes`.
 * - Property-based determinism invariant lives in the sibling `.property.test.ts`.
 */

import { RelationColumnSetResolver } from "../../../src/application/services/RelationColumnSetResolver";
import type { RelationColumnSet } from "../../../src/domain/layout/RelationColumnSet";

function mk(overrides: Partial<RelationColumnSet> = {}): RelationColumnSet {
  return {
    uid: overrides.uid ?? "uid-default",
    label: overrides.label ?? "default",
    targetClasses: overrides.targetClasses ?? null,
    referencingProperty: overrides.referencingProperty ?? null,
    columns: overrides.columns ?? ["exo__Asset_label"],
    priority: overrides.priority ?? 0,
    sourcePath: overrides.sourcePath ?? "mock.md",
  };
}

function warnSpy() {
  const messages: string[] = [];
  return {
    logger: { warn: (msg: string) => messages.push(msg) },
    messages,
  };
}

describe("RelationColumnSetResolver — base 4×3 matrix", () => {
  // ── Tier 1: exact (targetClass + referencingProperty both match) ──
  describe("Tier 1 — exact match", () => {
    it("single-match: unique (class, property) pair wins", () => {
      const expected = mk({
        uid: "t1-single",
        targetClasses: ["period__Week"],
        referencingProperty: "ems__WeeklyObjective__week",
      });
      const resolver = new RelationColumnSetResolver(() => [expected]);
      expect(
        resolver.resolve(["period__Week"], "ems__WeeklyObjective__week"),
      ).toBe(expected);
    });

    it("2-match collision: higher priority wins + logs.warn not fired for distinct priorities", () => {
      const low = mk({
        uid: "aaa",
        targetClasses: ["C"],
        referencingProperty: "P",
        priority: 1,
      });
      const high = mk({
        uid: "zzz",
        targetClasses: ["C"],
        referencingProperty: "P",
        priority: 5,
      });
      const spy = warnSpy();
      const resolver = new RelationColumnSetResolver(() => [low, high], {
        logger: spy.logger,
      });
      expect(resolver.resolve(["C"], "P")).toBe(high);
      expect(spy.messages).toHaveLength(0);
    });

    it("0-match: class alone without property falls through to tier 2/3/null", () => {
      const config = mk({
        uid: "t1-miss",
        targetClasses: ["Other"],
        referencingProperty: "P",
      });
      const resolver = new RelationColumnSetResolver(() => [config]);
      expect(resolver.resolve(["C"], "P")).toBeNull();
    });
  });

  // ── Tier 2: class-only (targetClass match, config.referencingProperty === null) ──
  describe("Tier 2 — class-only", () => {
    it("single-match: class match + config has no referencingProperty", () => {
      const expected = mk({
        uid: "t2-single",
        targetClasses: ["ems__Task"],
        referencingProperty: null,
      });
      const resolver = new RelationColumnSetResolver(() => [expected]);
      expect(resolver.resolve(["ems__Task"], "any_property")).toBe(expected);
    });

    it("2-match collision: equal priority → uid ASC + warn fires", () => {
      const low = mk({
        uid: "zzz",
        targetClasses: ["C"],
        referencingProperty: null,
        priority: 3,
      });
      const high = mk({
        uid: "aaa",
        targetClasses: ["C"],
        referencingProperty: null,
        priority: 3,
      });
      const spy = warnSpy();
      const resolver = new RelationColumnSetResolver(() => [low, high], {
        logger: spy.logger,
      });
      expect(resolver.resolve(["C"], "P")).toBe(high);
      expect(spy.messages).toHaveLength(1);
      expect(spy.messages[0]).toMatch(/tier=2/);
      expect(spy.messages[0]).toMatch(/aaa/);
      expect(spy.messages[0]).toMatch(/zzz/);
    });

    it("0-match: config class differs", () => {
      const config = mk({
        uid: "t2-miss",
        targetClasses: ["Other"],
        referencingProperty: null,
      });
      const resolver = new RelationColumnSetResolver(() => [config]);
      expect(resolver.resolve(["C"], "P")).toBeNull();
    });
  });

  // ── Tier 3: property-only (config.targetClasses === null, referencingProperty match) ──
  describe("Tier 3 — property-only", () => {
    it("single-match: property match + config has no targetClass", () => {
      const expected = mk({
        uid: "t3-single",
        targetClasses: null,
        referencingProperty: "ems__Effort_status",
      });
      const resolver = new RelationColumnSetResolver(() => [expected]);
      expect(resolver.resolve(["any_class"], "ems__Effort_status")).toBe(
        expected,
      );
    });

    it("2-match collision: priority DESC decisive; uid ASC used only on ties", () => {
      const low = mk({
        uid: "m-mid",
        targetClasses: null,
        referencingProperty: "P",
        priority: 7,
      });
      const high = mk({
        uid: "z-top",
        targetClasses: null,
        referencingProperty: "P",
        priority: 10,
      });
      const resolver = new RelationColumnSetResolver(() => [low, high]);
      expect(resolver.resolve(["C"], "P")).toBe(high);
    });

    it("0-match: config property differs", () => {
      const config = mk({
        uid: "t3-miss",
        targetClasses: null,
        referencingProperty: "Other",
      });
      const resolver = new RelationColumnSetResolver(() => [config]);
      expect(resolver.resolve(["C"], "P")).toBeNull();
    });
  });

  // ── Tier 4: fallback to null ──
  describe("Tier 4 — null fallback", () => {
    it("single (empty snapshot) → null", () => {
      const resolver = new RelationColumnSetResolver(() => []);
      expect(resolver.resolve(["C"], "P")).toBeNull();
    });

    it("2-match collision cannot exist at tier 4 — resolver returns null when no earlier tier matches", () => {
      const unrelated = [
        mk({ targetClasses: ["Other"], referencingProperty: "P1" }),
        mk({ targetClasses: ["Other"], referencingProperty: "P2" }),
      ];
      const resolver = new RelationColumnSetResolver(() => unrelated);
      expect(resolver.resolve(["C"], "P")).toBeNull();
    });

    it("0-match (neither class nor property known)", () => {
      const resolver = new RelationColumnSetResolver(() => [
        mk({ targetClasses: ["X"], referencingProperty: "Y" }),
      ]);
      expect(resolver.resolve(["C"], "P")).toBeNull();
    });
  });
});

describe("RelationColumnSetResolver — tier precedence", () => {
  it("Tier 1 wins over Tier 2 for same class", () => {
    const tier1 = mk({
      uid: "t1",
      targetClasses: ["C"],
      referencingProperty: "P",
      priority: 0,
    });
    const tier2 = mk({
      uid: "t2",
      targetClasses: ["C"],
      referencingProperty: null,
      priority: 999,
    });
    const resolver = new RelationColumnSetResolver(() => [tier2, tier1]);
    expect(resolver.resolve(["C"], "P")).toBe(tier1);
  });

  it("Tier 2 wins over Tier 3 for same class", () => {
    const tier2 = mk({
      uid: "t2",
      targetClasses: ["C"],
      referencingProperty: null,
      priority: 0,
    });
    const tier3 = mk({
      uid: "t3",
      targetClasses: null,
      referencingProperty: "P",
      priority: 999,
    });
    const resolver = new RelationColumnSetResolver(() => [tier3, tier2]);
    expect(resolver.resolve(["C"], "P")).toBe(tier2);
  });

  it("Tier 3 matches when no class config exists for the rowClass", () => {
    const tier3 = mk({
      uid: "t3",
      targetClasses: null,
      referencingProperty: "P",
      priority: 0,
    });
    const unrelated = mk({
      uid: "u",
      targetClasses: ["Other"],
      referencingProperty: "P",
      priority: 999,
    });
    const resolver = new RelationColumnSetResolver(() => [unrelated, tier3]);
    expect(resolver.resolve(["C"], "P")).toBe(tier3);
  });
});

describe("RelationColumnSetResolver — tiebreaker", () => {
  it("priority DESC: 10 > 5 > 0", () => {
    const p0 = mk({ uid: "a", targetClasses: ["C"], referencingProperty: "P", priority: 0 });
    const p5 = mk({ uid: "b", targetClasses: ["C"], referencingProperty: "P", priority: 5 });
    const p10 = mk({ uid: "c", targetClasses: ["C"], referencingProperty: "P", priority: 10 });
    const resolver = new RelationColumnSetResolver(() => [p5, p0, p10]);
    expect(resolver.resolve(["C"], "P")).toBe(p10);
  });

  it("priority equal → uid ASC (localeCompare)", () => {
    const aUid = mk({ uid: "aaa", targetClasses: ["C"], referencingProperty: "P", priority: 5 });
    const zUid = mk({ uid: "zzz", targetClasses: ["C"], referencingProperty: "P", priority: 5 });
    const mUid = mk({ uid: "mmm", targetClasses: ["C"], referencingProperty: "P", priority: 5 });
    const resolver = new RelationColumnSetResolver(() => [zUid, mUid, aUid]);
    expect(resolver.resolve(["C"], "P")).toBe(aUid);
  });

  it("priority 0 loses to priority 1 (no defensive fallback needed)", () => {
    const zero = mk({ uid: "a", targetClasses: ["C"], referencingProperty: "P", priority: 0 });
    const higher = mk({ uid: "b", targetClasses: ["C"], referencingProperty: "P", priority: 1 });
    const resolver = new RelationColumnSetResolver(() => [zero, higher]);
    expect(resolver.resolve(["C"], "P")).toBe(higher);
  });

  it("log.warn fires once per resolve when winning tier has priority tie", () => {
    const a = mk({ uid: "a", targetClasses: ["C"], referencingProperty: "P", priority: 5 });
    const b = mk({ uid: "b", targetClasses: ["C"], referencingProperty: "P", priority: 5 });
    const c = mk({ uid: "c", targetClasses: ["C"], referencingProperty: "P", priority: 5 });
    const spy = warnSpy();
    const resolver = new RelationColumnSetResolver(() => [a, b, c], {
      logger: spy.logger,
    });
    expect(resolver.resolve(["C"], "P")).toBe(a);
    expect(spy.messages).toHaveLength(1);
    expect(spy.messages[0]).toContain("tier=1");
    expect(spy.messages[0]).toContain("priority=5");
  });

  it("log.warn silent when winning priority unique but lower-priority match also exists", () => {
    const low = mk({ uid: "a", targetClasses: ["C"], referencingProperty: "P", priority: 1 });
    const winner = mk({ uid: "b", targetClasses: ["C"], referencingProperty: "P", priority: 9 });
    const spy = warnSpy();
    const resolver = new RelationColumnSetResolver(() => [low, winner], {
      logger: spy.logger,
    });
    expect(resolver.resolve(["C"], "P")).toBe(winner);
    expect(spy.messages).toHaveLength(0);
  });
});

describe("RelationColumnSetResolver — normalization roundtrip", () => {
  // The resolver delegates to `normalizeRef` from domain/layout.  These cases
  // assert that ALL wikilink forms accepted by `normalizeRef` flow through
  // `resolve` correctly, covering the RFC-mandated normalization gate at the
  // service boundary.
  it("raw identifier matches wikilink-form config", () => {
    const config = mk({
      targetClasses: ["ems__Task"],
      referencingProperty: "ems__Effort_status",
    });
    const resolver = new RelationColumnSetResolver(() => [config]);
    expect(
      resolver.resolve(["[[ems__Task]]"], "[[ems__Effort_status]]"),
    ).toBe(config);
  });

  it("wikilink with alias — alias after `|` is dropped", () => {
    const config = mk({
      targetClasses: ["uuid-123"],
      referencingProperty: "prop-uuid",
    });
    const resolver = new RelationColumnSetResolver(() => [config]);
    expect(
      resolver.resolve(
        ["[[uuid-123|Display Name]]"],
        "[[prop-uuid|Friendly]]",
      ),
    ).toBe(config);
  });

  it("whitespace trimmed consistently both sides", () => {
    const config = mk({ targetClasses: ["C"], referencingProperty: "P" });
    const resolver = new RelationColumnSetResolver(() => [config]);
    expect(resolver.resolve(["  C  "], "  P  ")).toBe(config);
  });

  it("empty string rowClass entry skipped; next entry used", () => {
    const config = mk({ targetClasses: ["C"], referencingProperty: "P" });
    const resolver = new RelationColumnSetResolver(() => [config]);
    expect(resolver.resolve(["", "C"], "P")).toBe(config);
  });

  it("non-string rowClass entry skipped", () => {
    const config = mk({ targetClasses: ["C"], referencingProperty: "P" });
    const resolver = new RelationColumnSetResolver(() => [config]);
    // Cast through unknown — mimics lax frontmatter inputs
    const rowClasses = [null as unknown as string, "C"];
    expect(resolver.resolve(rowClasses, "P")).toBe(config);
  });

  it("malformed half-wikilink is tolerated — outer brackets stripped (delegates to WikiLinkHelpers)", () => {
    // After issue #2941 consolidation, `normalizeRef` delegates to
    // `WikiLinkHelpers.normalize`, which permissively strips any `[[` / `]]`
    // substrings.  `"[[C"` therefore collapses to `"C"` and matches config `C`.
    const config = mk({ targetClasses: ["C"], referencingProperty: "P" });
    const resolver = new RelationColumnSetResolver(() => [config]);
    expect(resolver.resolve(["[[C"], "P")).toBe(config);
  });

  it("null rowClass element skipped gracefully (type-cast)", () => {
    const config = mk({ targetClasses: ["C"], referencingProperty: "P" });
    const resolver = new RelationColumnSetResolver(() => [config]);
    const rowClasses = [undefined as unknown as string, "C"];
    expect(resolver.resolve(rowClasses, "P")).toBe(config);
  });
});

describe("RelationColumnSetResolver — multi-class rowClasses", () => {
  it("3 classes: first class hits tier 1 → wins", () => {
    const forFirst = mk({
      uid: "first",
      targetClasses: ["Cls1"],
      referencingProperty: "P",
    });
    const forSecond = mk({
      uid: "second",
      targetClasses: ["Cls2"],
      referencingProperty: "P",
    });
    const resolver = new RelationColumnSetResolver(() => [forFirst, forSecond]);
    expect(resolver.resolve(["Cls1", "Cls2", "Cls3"], "P")).toBe(forFirst);
  });

  it("3 classes: first class has NO match → fall through to second class", () => {
    const secondOnly = mk({
      uid: "second",
      targetClasses: ["Cls2"],
      referencingProperty: "P",
    });
    const resolver = new RelationColumnSetResolver(() => [secondOnly]);
    expect(resolver.resolve(["Cls1", "Cls2", "Cls3"], "P")).toBe(secondOnly);
  });

  it("3 classes: collision on tier-2 for first class → first class wins, later classes untouched", () => {
    const t2First = mk({
      uid: "aaa",
      targetClasses: ["Cls1"],
      referencingProperty: null,
      priority: 3,
    });
    const t1Second = mk({
      uid: "zzz",
      targetClasses: ["Cls2"],
      referencingProperty: "P",
      priority: 999,
    });
    const resolver = new RelationColumnSetResolver(() => [t2First, t1Second]);
    // Tier 2 match on Cls1 short-circuits — Cls2's tier-1 never evaluated.
    expect(resolver.resolve(["Cls1", "Cls2"], "P")).toBe(t2First);
  });

  it("config.targetClasses is multi-value array — each class is a hit candidate", () => {
    const multi = mk({
      uid: "multi",
      targetClasses: ["Cls1", "Cls2", "Cls3"],
      referencingProperty: "P",
    });
    const resolver = new RelationColumnSetResolver(() => [multi]);
    expect(resolver.resolve(["Cls2"], "P")).toBe(multi);
    expect(resolver.resolve(["Cls3"], "P")).toBe(multi);
    expect(resolver.resolve(["NotInSet"], "P")).toBeNull();
  });
});

describe("RelationColumnSetResolver — empty / degenerate inputs", () => {
  it("rowClasses empty array → null", () => {
    const resolver = new RelationColumnSetResolver(() => [
      mk({ targetClasses: ["C"], referencingProperty: "P" }),
    ]);
    expect(resolver.resolve([], "P")).toBeNull();
  });

  it("rowClasses is null → null", () => {
    const resolver = new RelationColumnSetResolver(() => [
      mk({ targetClasses: ["C"], referencingProperty: "P" }),
    ]);
    expect(resolver.resolve(null, "P")).toBeNull();
  });

  it("rowClasses is undefined → null", () => {
    const resolver = new RelationColumnSetResolver(() => [
      mk({ targetClasses: ["C"], referencingProperty: "P" }),
    ]);
    expect(resolver.resolve(undefined, "P")).toBeNull();
  });

  it("referencingProperty is empty string → normalizeRef returns null → only tier 2 possible", () => {
    const tier2 = mk({
      targetClasses: ["C"],
      referencingProperty: null,
      uid: "t2",
    });
    const tier1 = mk({
      targetClasses: ["C"],
      referencingProperty: "P",
      uid: "t1",
    });
    const resolver = new RelationColumnSetResolver(() => [tier1, tier2]);
    expect(resolver.resolve(["C"], "")).toBe(tier2);
  });

  it("referencingProperty is null → only tier 2 possible", () => {
    const tier2 = mk({ targetClasses: ["C"], referencingProperty: null });
    const resolver = new RelationColumnSetResolver(() => [tier2]);
    expect(resolver.resolve(["C"], null)).toBe(tier2);
  });

  it("referencingProperty is undefined → only tier 2 possible", () => {
    const tier2 = mk({ targetClasses: ["C"], referencingProperty: null });
    const resolver = new RelationColumnSetResolver(() => [tier2]);
    expect(resolver.resolve(["C"], undefined)).toBe(tier2);
  });

  it("snapshot empty → null for any inputs", () => {
    const resolver = new RelationColumnSetResolver(() => []);
    expect(resolver.resolve(["C"], "P")).toBeNull();
  });

  it("provider returns same snapshot on repeated resolve calls (stability)", () => {
    const config = mk({ targetClasses: ["C"], referencingProperty: "P" });
    let callCount = 0;
    const resolver = new RelationColumnSetResolver(() => {
      callCount += 1;
      return [config];
    });
    resolver.resolve(["C"], "P");
    resolver.resolve(["C"], "P");
    expect(callCount).toBe(2);
  });
});

describe("RelationColumnSetResolver — logger default (no options)", () => {
  it("omitting logger does not throw on collision", () => {
    const a = mk({ uid: "a", targetClasses: ["C"], referencingProperty: "P", priority: 5 });
    const b = mk({ uid: "b", targetClasses: ["C"], referencingProperty: "P", priority: 5 });
    const resolver = new RelationColumnSetResolver(() => [a, b]);
    expect(() => resolver.resolve(["C"], "P")).not.toThrow();
    expect(resolver.resolve(["C"], "P")).toBe(a);
  });

  it("explicit empty-object options uses noop logger", () => {
    const a = mk({ uid: "a", targetClasses: ["C"], referencingProperty: "P", priority: 5 });
    const b = mk({ uid: "b", targetClasses: ["C"], referencingProperty: "P", priority: 5 });
    const resolver = new RelationColumnSetResolver(() => [a, b], {});
    expect(resolver.resolve(["C"], "P")).toBe(a);
  });
});

describe("RelationColumnSetResolver — wikilink pipe-order matrix (issue #2941)", () => {
  // Config-side `targetClasses` / `referencingProperty` are already normalized
  // by `createRelationColumnSetFromFrontmatter` before reaching the resolver.
  // Row-side inputs (`exo__Instance_class`, backlink property) arrive RAW from
  // Obsidian's `metadataCache`, so the resolver MUST normalize them through
  // the same `WikiLinkHelpers.normalize` semantics — issue #2941 fix.
  const TARGET_CLASS = "ems__WeeklyObjective";
  const PROPERTY = "ems__WeeklyObjective__week";
  const UUID_CLS = "5bc8d83d-34e4-4c2d-86e4-0c7dd30a2a12";
  const UUID_PROP = "8f3b9e12-4a7c-4f2e-9b1a-3c4d5e6f7a8b";

  const classForms: readonly { readonly label: string; readonly input: string }[] = [
    { label: "bare", input: TARGET_CLASS },
    { label: "[[name]]", input: `[[${TARGET_CLASS}]]` },
    { label: "[[name|uuid]] (basename-first)", input: `[[${TARGET_CLASS}|${UUID_CLS}]]` },
    { label: "[[uuid|name]] (starter-kit pipe order)", input: `[[${UUID_CLS}|${TARGET_CLASS}]]` },
  ];

  const propertyForms: readonly { readonly label: string; readonly input: string }[] = [
    { label: "bare", input: PROPERTY },
    { label: "[[name]]", input: `[[${PROPERTY}]]` },
    { label: "[[name|uuid]] (basename-first)", input: `[[${PROPERTY}|${UUID_PROP}]]` },
    { label: "[[uuid|name]] (starter-kit pipe order)", input: `[[${UUID_PROP}|${PROPERTY}]]` },
  ];

  for (const cls of classForms) {
    for (const prop of propertyForms) {
      it(`row class=${cls.label} × property=${prop.label} → Tier-1 match`, () => {
        const config = mk({
          uid: "matrix",
          targetClasses: [TARGET_CLASS],
          referencingProperty: PROPERTY,
        });
        const resolver = new RelationColumnSetResolver(() => [config]);
        expect(resolver.resolve([cls.input], prop.input)).toBe(config);
      });
    }
  }

  // Symmetric: config frontmatter in starter-kit pipe order matches plain row.
  it("config parsed from starter-kit-style `[[uuid|name]]` matches bare row", () => {
    // Simulate what `createRelationColumnSetFromFrontmatter` produces after
    // normalization: bare `TARGET_CLASS` in `targetClasses`.  (The resolver
    // itself receives already-normalized config strings by contract.)
    const config = mk({
      uid: "sym",
      targetClasses: [TARGET_CLASS],
      referencingProperty: PROPERTY,
    });
    const resolver = new RelationColumnSetResolver(() => [config]);
    expect(resolver.resolve([TARGET_CLASS], PROPERTY)).toBe(config);
  });
});
