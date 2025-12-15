/**
 * ReDoS (Regular Expression Denial of Service) Security Tests
 *
 * These tests verify that regex patterns in the codebase are not vulnerable
 * to catastrophic backtracking attacks. Each test uses worst-case input
 * patterns that would cause exponential time complexity in vulnerable regexes.
 *
 * Performance requirement: All regex operations should complete in <100ms
 * even with adversarial input patterns.
 */

import { MetadataHelpers } from "../../../src/utilities/MetadataHelpers";
import { FilenameValidator } from "../../../src/utilities/FilenameValidator";
import { extractDailyNoteDate } from "../../../src/domain/commands/visibility/helpers";

describe("ReDoS Security Tests", () => {
  const TIMEOUT_MS = 100; // Maximum allowed execution time

  describe("MetadataHelpers.containsReference - wiki-link regex", () => {
    it("should handle malicious nested bracket input quickly", () => {
      // Pattern that would cause catastrophic backtracking with /\[\[([^\]]+)\]\]/
      // The attack string has many [[ that the regex tries to match
      const maliciousInput = "[[".repeat(100) + "\\\\".repeat(100);

      const startTime = Date.now();
      const result = MetadataHelpers.containsReference(maliciousInput, "test.md");
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(TIMEOUT_MS);
      expect(result).toBe(false);
    });

    it("should handle input with many bracket characters", () => {
      // Input designed to cause backtracking: [[a[[a[[a[[a...
      const maliciousInput = "[[a".repeat(1000);

      const startTime = Date.now();
      const result = MetadataHelpers.containsReference(maliciousInput, "test.md");
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(TIMEOUT_MS);
      expect(result).toBe(false);
    });

    it("should handle legitimate wiki-links correctly after fix", () => {
      expect(MetadataHelpers.containsReference("[[TestFile]]", "TestFile.md")).toBe(true);
      expect(MetadataHelpers.containsReference("[[folder/TestFile]]", "TestFile.md")).toBe(true);
      expect(MetadataHelpers.containsReference("[[TestFile|Alias]]", "TestFile.md")).toBe(true);
      expect(MetadataHelpers.containsReference("See [[TestFile]] for more", "TestFile.md")).toBe(true);
    });

    it("should correctly reject non-matching wiki-links", () => {
      expect(MetadataHelpers.containsReference("[[OtherFile]]", "TestFile.md")).toBe(false);
      expect(MetadataHelpers.containsReference("TestFile", "TestFile.md")).toBe(false);
      expect(MetadataHelpers.containsReference("", "TestFile.md")).toBe(false);
    });
  });

  describe("FilenameValidator.sanitize - trailing character removal", () => {
    it("should handle input with many trailing spaces quickly", () => {
      // Pattern that would cause catastrophic backtracking with /[. ]+$/
      const maliciousInput = "file" + " ".repeat(10000);

      const startTime = Date.now();
      const result = FilenameValidator.sanitize(maliciousInput);
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(TIMEOUT_MS);
      expect(result).toBe("file");
    });

    it("should handle input with many trailing dots quickly", () => {
      const maliciousInput = "file" + ".".repeat(10000);

      const startTime = Date.now();
      const result = FilenameValidator.sanitize(maliciousInput);
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(TIMEOUT_MS);
      expect(result).toBe("file");
    });

    it("should handle input with alternating trailing dots and spaces", () => {
      const maliciousInput = "file" + ". ".repeat(5000);

      const startTime = Date.now();
      const result = FilenameValidator.sanitize(maliciousInput);
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(TIMEOUT_MS);
      expect(result).toBe("file");
    });

    it("should handle legitimate filenames correctly after fix", () => {
      expect(FilenameValidator.sanitize("my-file.txt")).toBe("my-file.txt");
      expect(FilenameValidator.sanitize("file name")).toBe("file name");
      expect(FilenameValidator.sanitize("  trimmed  ")).toBe("trimmed");
    });
  });

  describe("FilenameValidator.sanitize - replacement character collapsing", () => {
    it("should handle input with many consecutive invalid characters", () => {
      // Many consecutive slashes that become underscores
      const maliciousInput = "/".repeat(10000);

      const startTime = Date.now();
      const result = FilenameValidator.sanitize(maliciousInput);
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(TIMEOUT_MS);
      // Should collapse to empty string (all underscores, then stripped)
      expect(result).toBe("");
    });

    it("should handle custom replacement character correctly", () => {
      const result = FilenameValidator.sanitize("a/b/c", { replacementChar: "-" });
      expect(result).toBe("a-b-c");
    });

    it("should collapse multiple replacement characters", () => {
      const result = FilenameValidator.sanitize("a///b");
      expect(result).toBe("a_b");
    });
  });

  describe("extractDailyNoteDate - wiki-link regex", () => {
    it("should handle malicious nested bracket input quickly", () => {
      // Similar attack pattern as MetadataHelpers
      const maliciousInput = "[[[[a".repeat(1000);

      const startTime = Date.now();
      const result = extractDailyNoteDate({ pn__DailyNote_day: maliciousInput });
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(TIMEOUT_MS);
      expect(result).toBe(maliciousInput); // Returns input if no match
    });

    it("should handle array with malicious input quickly", () => {
      const maliciousInput = ["[[[[a".repeat(1000)];

      const startTime = Date.now();
      extractDailyNoteDate({ pn__DailyNote_day: maliciousInput });
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(TIMEOUT_MS);
    });

    it("should correctly extract date from wiki-link after fix", () => {
      expect(extractDailyNoteDate({ pn__DailyNote_day: "[[2025-11-11]]" })).toBe("2025-11-11");
      expect(extractDailyNoteDate({ pn__DailyNote_day: "2025-11-11" })).toBe("2025-11-11");
      expect(extractDailyNoteDate({ pn__DailyNote_day: ["[[2025-12-15]]"] })).toBe("2025-12-15");
    });

    it("should return null for missing or empty property", () => {
      expect(extractDailyNoteDate({})).toBe(null);
      expect(extractDailyNoteDate({ pn__DailyNote_day: "" })).toBe("");
      expect(extractDailyNoteDate({ pn__DailyNote_day: null })).toBe(null);
    });
  });

  describe("Performance benchmarks", () => {
    const iterations = 100;

    it("should process many wiki-links efficiently", () => {
      const input = "[[Link1]] [[Link2]] [[Link3]] [[Link4]] [[Link5]]";

      const startTime = Date.now();
      for (let i = 0; i < iterations; i++) {
        MetadataHelpers.containsReference(input, "Link3.md");
      }
      const elapsed = Date.now() - startTime;

      // Should process 100 iterations well under 100ms
      expect(elapsed).toBeLessThan(TIMEOUT_MS);
    });

    it("should sanitize many filenames efficiently", () => {
      const input = "file/with:invalid*chars.txt";

      const startTime = Date.now();
      for (let i = 0; i < iterations; i++) {
        FilenameValidator.sanitize(input);
      }
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(TIMEOUT_MS);
    });
  });
});
