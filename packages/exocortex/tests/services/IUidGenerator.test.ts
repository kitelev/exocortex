import { liveUidGenerator, seededUidGenerator } from "../../src/services/IUidGenerator";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("IUidGenerator", () => {
  describe("liveUidGenerator", () => {
    it("returns valid UUIDs", () => {
      const g = liveUidGenerator();
      expect(g.next()).toMatch(UUID_REGEX);
    });

    it("returns unique UUIDs across calls", () => {
      const g = liveUidGenerator();
      const a = g.next();
      const b = g.next();
      expect(a).not.toBe(b);
    });
  });

  describe("seededUidGenerator", () => {
    it("with same seed yields identical sequence", () => {
      const seed = "test-seed-001";
      const a = seededUidGenerator(seed);
      const b = seededUidGenerator(seed);
      const aSeq = [a.next(), a.next(), a.next()];
      const bSeq = [b.next(), b.next(), b.next()];
      expect(aSeq).toEqual(bSeq);
      aSeq.forEach((u) => expect(u).toMatch(UUID_REGEX));
    });

    it("with different seeds yields different sequences", () => {
      const a = seededUidGenerator("seed-A");
      const b = seededUidGenerator("seed-B");
      expect(a.next()).not.toBe(b.next());
    });

    it("monotonic counter produces distinct UUIDs within one generator", () => {
      const g = seededUidGenerator("monotonic-test");
      const ids = [g.next(), g.next(), g.next(), g.next()];
      const unique = new Set(ids);
      expect(unique.size).toBe(ids.length);
      ids.forEach((u) => expect(u).toMatch(UUID_REGEX));
    });
  });
});
