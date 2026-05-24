import { shouldRunExocmdIndexer } from "@plugin/cache/shouldRunExocmdIndexer";

describe("shouldRunExocmdIndexer (issue #3250)", () => {
  describe("desktop branch — toggle is ignored", () => {
    it("runs on desktop when mobile-toggle is off", () => {
      expect(shouldRunExocmdIndexer(false, false)).toBe(true);
    });

    it("runs on desktop when mobile-toggle is on", () => {
      expect(shouldRunExocmdIndexer(false, true)).toBe(true);
    });
  });

  describe("mobile branch — toggle is honoured", () => {
    it("skips on mobile when mobile-toggle is off (default behaviour)", () => {
      expect(shouldRunExocmdIndexer(true, false)).toBe(false);
    });

    it("runs on mobile when mobile-toggle is on (opt-in)", () => {
      expect(shouldRunExocmdIndexer(true, true)).toBe(true);
    });
  });
});
