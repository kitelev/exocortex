import { liveClock, frozenClock } from "../../src/services/IClock";

describe("IClock", () => {
  describe("liveClock", () => {
    it("returns a Date instance", () => {
      const c = liveClock();
      expect(c.now()).toBeInstanceOf(Date);
    });

    it("returns timestamps close to system time", () => {
      const c = liveClock();
      const before = Date.now();
      const t = c.now().getTime();
      const after = Date.now();
      expect(t).toBeGreaterThanOrEqual(before);
      expect(t).toBeLessThanOrEqual(after);
    });
  });

  describe("frozenClock", () => {
    it("returns stable timestamp across calls", () => {
      const iso = "2026-05-23T09:00:00Z";
      const c = frozenClock(iso);
      const t1 = c.now().getTime();
      const t2 = c.now().getTime();
      expect(t1).toBe(t2);
      expect(t1).toBe(new Date(iso).getTime());
    });

    it("returns Date instances that are independent (mutation safety)", () => {
      const c = frozenClock("2026-01-01T00:00:00Z");
      const d = c.now();
      d.setFullYear(2030);
      expect(c.now().getFullYear()).toBe(2026);
    });

    it("two frozenClock instances with different ISO values are independent", () => {
      const a = frozenClock("2026-01-01T00:00:00Z");
      const b = frozenClock("2030-06-15T12:34:56Z");
      expect(a.now().getTime()).not.toBe(b.now().getTime());
    });
  });
});
