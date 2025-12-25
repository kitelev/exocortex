/**
 * Unit tests for StringTable
 */

import { StringTable } from "../../../../src/infrastructure/memory/StringTable";

describe("StringTable", () => {
  let table: StringTable;

  beforeEach(() => {
    table = new StringTable();
  });

  describe("intern", () => {
    it("should return 0 for the first interned string", () => {
      const index = table.intern("test");
      expect(index).toBe(0);
    });

    it("should return sequential indices for different strings", () => {
      expect(table.intern("first")).toBe(0);
      expect(table.intern("second")).toBe(1);
      expect(table.intern("third")).toBe(2);
    });

    it("should return the same index for duplicate strings", () => {
      const index1 = table.intern("test");
      const index2 = table.intern("test");
      expect(index1).toBe(index2);
    });

    it("should handle empty strings", () => {
      const index = table.intern("");
      expect(index).toBe(0);
      expect(table.getString(index)).toBe("");
    });

    it("should handle unicode strings", () => {
      const index = table.intern("こんにちは");
      expect(table.getString(index)).toBe("こんにちは");
    });

    it("should handle URIs", () => {
      const uri = "https://exocortex.my/ontology/ems#Task";
      const index = table.intern(uri);
      expect(table.getString(index)).toBe(uri);
    });
  });

  describe("getIndex", () => {
    it("should return the index for an interned string", () => {
      table.intern("test");
      expect(table.getIndex("test")).toBe(0);
    });

    it("should return -1 for a non-interned string", () => {
      expect(table.getIndex("nonexistent")).toBe(-1);
    });
  });

  describe("getString", () => {
    it("should return the string at a valid index", () => {
      table.intern("hello");
      expect(table.getString(0)).toBe("hello");
    });

    it("should throw RangeError for negative index", () => {
      expect(() => table.getString(-1)).toThrow(RangeError);
    });

    it("should throw RangeError for out of bounds index", () => {
      table.intern("test");
      expect(() => table.getString(100)).toThrow(RangeError);
    });
  });

  describe("has", () => {
    it("should return true for interned strings", () => {
      table.intern("test");
      expect(table.has("test")).toBe(true);
    });

    it("should return false for non-interned strings", () => {
      expect(table.has("nonexistent")).toBe(false);
    });
  });

  describe("hasIndex", () => {
    it("should return true for valid indices", () => {
      table.intern("test");
      expect(table.hasIndex(0)).toBe(true);
    });

    it("should return false for invalid indices", () => {
      expect(table.hasIndex(0)).toBe(false);
      expect(table.hasIndex(-1)).toBe(false);
    });
  });

  describe("size", () => {
    it("should return 0 for empty table", () => {
      expect(table.size).toBe(0);
    });

    it("should return the number of unique strings", () => {
      table.intern("a");
      table.intern("b");
      table.intern("a"); // duplicate
      expect(table.size).toBe(2);
    });
  });

  describe("getMemoryBytes", () => {
    it("should return 0 for empty table", () => {
      expect(table.getMemoryBytes()).toBe(0);
    });

    it("should increase when strings are added", () => {
      table.intern("test");
      expect(table.getMemoryBytes()).toBeGreaterThan(0);
    });

    it("should not increase for duplicate strings", () => {
      table.intern("test");
      const mem1 = table.getMemoryBytes();
      table.intern("test");
      expect(table.getMemoryBytes()).toBe(mem1);
    });
  });

  describe("entries", () => {
    it("should iterate over all entries", () => {
      table.intern("a");
      table.intern("b");
      table.intern("c");

      const entries = Array.from(table.entries());
      expect(entries).toEqual([
        [0, "a"],
        [1, "b"],
        [2, "c"],
      ]);
    });
  });

  describe("values", () => {
    it("should iterate over all values", () => {
      table.intern("x");
      table.intern("y");

      const values = Array.from(table.values());
      expect(values).toEqual(["x", "y"]);
    });
  });

  describe("toArray", () => {
    it("should return a copy of all strings", () => {
      table.intern("a");
      table.intern("b");

      const arr = table.toArray();
      expect(arr).toEqual(["a", "b"]);
    });
  });

  describe("clear", () => {
    it("should remove all strings", () => {
      table.intern("a");
      table.intern("b");
      table.clear();

      expect(table.size).toBe(0);
      expect(table.getMemoryBytes()).toBe(0);
      expect(table.has("a")).toBe(false);
    });
  });

  describe("fromJSON / toJSON", () => {
    it("should serialize and deserialize correctly", () => {
      table.intern("first");
      table.intern("second");

      const json = table.toJSON();
      const restored = StringTable.fromJSON(json);

      expect(restored.size).toBe(2);
      expect(restored.getString(0)).toBe("first");
      expect(restored.getString(1)).toBe("second");
    });
  });

  describe("internAll", () => {
    it("should intern multiple strings at once", () => {
      const indices = table.internAll(["a", "b", "c"]);
      expect(indices).toEqual([0, 1, 2]);
    });

    it("should handle duplicates in the input", () => {
      const indices = table.internAll(["a", "b", "a"]);
      expect(indices).toEqual([0, 1, 0]);
    });
  });

  describe("getStrings", () => {
    it("should return multiple strings by indices", () => {
      table.internAll(["x", "y", "z"]);
      const strings = table.getStrings([0, 2]);
      expect(strings).toEqual(["x", "z"]);
    });
  });

  describe("search", () => {
    it("should find strings matching a pattern", () => {
      table.internAll(["ems__Task", "ems__Project", "exo__Asset"]);

      const results = table.search(/ems__/);
      expect(results).toEqual([
        [0, "ems__Task"],
        [1, "ems__Project"],
      ]);
    });

    it("should accept string patterns", () => {
      table.internAll(["foo_bar", "foo_baz", "other"]);

      const results = table.search("foo_");
      expect(results.length).toBe(2);
    });
  });

  describe("getStats", () => {
    it("should return correct statistics", () => {
      table.internAll(["short", "medium_length", "a_very_long_string_here"]);

      const stats = table.getStats();
      expect(stats.count).toBe(3);
      expect(stats.memoryBytes).toBeGreaterThan(0);
      expect(stats.avgStringLength).toBeGreaterThan(0);
    });

    it("should return 0 avg for empty table", () => {
      const stats = table.getStats();
      expect(stats.avgStringLength).toBe(0);
    });
  });

  describe("constructor with initial strings", () => {
    it("should pre-populate from initial strings", () => {
      const populated = new StringTable(["a", "b", "c"]);
      expect(populated.size).toBe(3);
      expect(populated.getString(0)).toBe("a");
    });
  });
});
