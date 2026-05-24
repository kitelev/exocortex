import {
  registerOrderSpecLoader,
  clearOrderSpecLoader,
  loadDefaultSpec,
  orderProperties,
  FrontmatterOrderSpec,
} from "../../src/services/OrderSpecResolver";

const USER_HEAD = [
  "exo__Asset_isDefinedBy",
  "exo__Asset_uid",
  "exo__Asset_createdAt",
  "exo__Instance_class",
  "exo__Asset_prototype",
  "ems__Effort_status",
  "ems__Effort_area",
  "ems__Effort_parent",
];

const USER_TAIL = ["exo__Asset_relates", "exo__Asset_label", "aliases"];

const DEFAULT_SPEC: FrontmatterOrderSpec = {
  head: USER_HEAD,
  tail: USER_TAIL,
  middleStrategy: "alphabetical",
};

describe("OrderSpecResolver", () => {
  beforeEach(() => {
    clearOrderSpecLoader();
  });
  afterAll(() => {
    clearOrderSpecLoader();
  });

  describe("loadDefaultSpec", () => {
    it("returns null when no loader registered", () => {
      expect(loadDefaultSpec()).toBeNull();
    });

    it("returns the spec from registered loader", () => {
      registerOrderSpecLoader(() => DEFAULT_SPEC);
      expect(loadDefaultSpec()).toEqual(DEFAULT_SPEC);
    });

    it("caches the loader result across calls", () => {
      const loader = jest.fn(() => DEFAULT_SPEC);
      registerOrderSpecLoader(loader);
      loadDefaultSpec();
      loadDefaultSpec();
      loadDefaultSpec();
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("returns null and does not throw when loader throws", () => {
      const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
      registerOrderSpecLoader(() => {
        throw new Error("vault unreadable");
      });
      expect(loadDefaultSpec()).toBeNull();
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it("invalidates cache when a new loader is registered", () => {
      registerOrderSpecLoader(() => DEFAULT_SPEC);
      expect(loadDefaultSpec()).toEqual(DEFAULT_SPEC);

      const alt: FrontmatterOrderSpec = {
        head: ["a"],
        tail: ["z"],
        middleStrategy: "alphabetical",
      };
      registerOrderSpecLoader(() => alt);
      expect(loadDefaultSpec()).toEqual(alt);
    });
  });

  describe("orderProperties", () => {
    it("returns input unchanged when spec is null", () => {
      const input = { z: 1, a: 2, m: 3 };
      expect(orderProperties(input, null)).toBe(input);
    });

    it("returns input unchanged when spec head AND tail are both empty", () => {
      const input = { z: 1, a: 2 };
      const empty: FrontmatterOrderSpec = {
        head: [],
        tail: [],
        middleStrategy: "alphabetical",
      };
      expect(orderProperties(input, empty)).toBe(input);
    });

    it("places head fields first in spec order", () => {
      const input = {
        ems__Effort_area: "x",
        exo__Asset_uid: "u",
        exo__Asset_isDefinedBy: "i",
      };
      const result = orderProperties(input, DEFAULT_SPEC);
      expect(Object.keys(result)).toEqual([
        "exo__Asset_isDefinedBy",
        "exo__Asset_uid",
        "ems__Effort_area",
      ]);
    });

    it("places tail fields last in spec order", () => {
      const input = {
        aliases: ["a"],
        exo__Asset_label: "Label",
        exo__Asset_relates: ["[[x]]"],
      };
      const result = orderProperties(input, DEFAULT_SPEC);
      expect(Object.keys(result)).toEqual([
        "exo__Asset_relates",
        "exo__Asset_label",
        "aliases",
      ]);
    });

    it("sorts middle fields alphabetically", () => {
      const input = { zeta: 1, alpha: 2, omega: 3, beta: 4 };
      const result = orderProperties(input, DEFAULT_SPEC);
      expect(Object.keys(result)).toEqual(["alpha", "beta", "omega", "zeta"]);
    });

    it("applies head + middle (alphabetical) + tail in full canonical order", () => {
      const input = {
        // randomized insertion order on purpose
        ems__Effort_responsible: "[[a]]",
        aliases: ["alias1"],
        exo__Asset_uid: "uid",
        ims__Concept_broader: "[[c]]",
        exo__Asset_label: "Label",
        exo__Asset_isDefinedBy: "[[onto]]",
        ems__Effort_status: "Doing",
        exo__Asset_relates: ["[[r]]"],
        exo__Instance_class: ["[[c]]"],
      };
      const result = orderProperties(input, DEFAULT_SPEC);
      expect(Object.keys(result)).toEqual([
        // head
        "exo__Asset_isDefinedBy",
        "exo__Asset_uid",
        "exo__Instance_class",
        "ems__Effort_status",
        // middle (alphabetical)
        "ems__Effort_responsible",
        "ims__Concept_broader",
        // tail
        "exo__Asset_relates",
        "exo__Asset_label",
        "aliases",
      ]);
    });

    it("skips head entries that are not present in properties", () => {
      const input = { exo__Asset_uid: "u" };
      const result = orderProperties(input, DEFAULT_SPEC);
      expect(Object.keys(result)).toEqual(["exo__Asset_uid"]);
    });

    it("skips tail entries that are not present in properties", () => {
      const input = { aliases: ["x"] };
      const result = orderProperties(input, DEFAULT_SPEC);
      expect(Object.keys(result)).toEqual(["aliases"]);
    });

    it("preserves values exactly", () => {
      const arr = ["one", "two"];
      const input = { exo__Asset_uid: "u", aliases: arr, zeta: 42 };
      const result = orderProperties(input, DEFAULT_SPEC);
      expect(result["exo__Asset_uid"]).toBe("u");
      expect(result["aliases"]).toBe(arr);
      expect(result["zeta"]).toBe(42);
    });

    it("handles empty properties record", () => {
      expect(orderProperties({}, DEFAULT_SPEC)).toEqual({});
    });

    it("falls back to insertion order for unknown middleStrategy", () => {
      const input = { zeta: 1, alpha: 2, omega: 3 };
      const spec: FrontmatterOrderSpec = {
        head: [],
        tail: [],
        middleStrategy: "insertion-as-yet-unimplemented",
      };
      // empty head+tail short-circuits — returns input unchanged
      expect(orderProperties(input, spec)).toBe(input);
    });

    it("does not sort middle when strategy is unrecognised but head/tail set", () => {
      const input = { zeta: 1, alpha: 2, exo__Asset_label: "L" };
      const spec: FrontmatterOrderSpec = {
        head: [],
        tail: ["exo__Asset_label"],
        middleStrategy: "future-strategy",
      };
      const result = orderProperties(input, spec);
      // middle stays in insertion order (zeta, alpha), then tail
      expect(Object.keys(result)).toEqual(["zeta", "alpha", "exo__Asset_label"]);
    });
  });
});
