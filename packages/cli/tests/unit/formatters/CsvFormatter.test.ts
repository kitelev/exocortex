import { describe, it, expect } from "@jest/globals";

// We need to import the CsvFormatter that doesn't exist yet
// This will fail until we create it
describe("CsvFormatter", () => {
  describe("format", () => {
    it("should format results as CSV with header row", async () => {
      // Dynamically import to get fresh module
      const { CsvFormatter } = await import("../../../src/formatters/CsvFormatter.js");
      const formatter = new CsvFormatter();

      // Create mock solution mappings
      const mockResults = [
        {
          variables: () => ["name", "age"],
          get: (key: string) => key === "name" ? { toString: () => "Alice" } : { toString: () => "30" },
          toJSON: () => ({ name: "Alice", age: "30" }),
        },
        {
          variables: () => ["name", "age"],
          get: (key: string) => key === "name" ? { toString: () => "Bob" } : { toString: () => "25" },
          toJSON: () => ({ name: "Bob", age: "25" }),
        },
      ];

      const result = formatter.format(mockResults as any);

      // Variables are sorted alphabetically, so "age" comes before "name"
      expect(result).toContain("age,name");
      expect(result).toContain("30,Alice");
      expect(result).toContain("25,Bob");
    });

    it("should escape values containing commas", async () => {
      const { CsvFormatter } = await import("../../../src/formatters/CsvFormatter.js");
      const formatter = new CsvFormatter();

      const mockResults = [
        {
          variables: () => ["description"],
          get: (key: string) => ({ toString: () => "Hello, World" }),
          toJSON: () => ({ description: "Hello, World" }),
        },
      ];

      const result = formatter.format(mockResults as any);

      // Values with commas should be quoted
      expect(result).toContain('"Hello, World"');
    });

    it("should escape values containing quotes", async () => {
      const { CsvFormatter } = await import("../../../src/formatters/CsvFormatter.js");
      const formatter = new CsvFormatter();

      const mockResults = [
        {
          variables: () => ["description"],
          get: (key: string) => ({ toString: () => 'She said "Hello"' }),
          toJSON: () => ({ description: 'She said "Hello"' }),
        },
      ];

      const result = formatter.format(mockResults as any);

      // Values with quotes should have quotes escaped and be wrapped
      expect(result).toContain('"She said ""Hello"""');
    });

    it("should handle empty results", async () => {
      const { CsvFormatter } = await import("../../../src/formatters/CsvFormatter.js");
      const formatter = new CsvFormatter();

      const result = formatter.format([]);

      expect(result).toBe("");
    });

    it("should escape values containing newlines", async () => {
      const { CsvFormatter } = await import("../../../src/formatters/CsvFormatter.js");
      const formatter = new CsvFormatter();

      const mockResults = [
        {
          variables: () => ["text"],
          get: (key: string) => ({ toString: () => "Line1\nLine2" }),
          toJSON: () => ({ text: "Line1\nLine2" }),
        },
      ];

      const result = formatter.format(mockResults as any);

      // Values with newlines should be quoted
      expect(result).toContain('"Line1\nLine2"');
    });
  });
});
