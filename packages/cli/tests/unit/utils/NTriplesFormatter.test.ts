import { describe, it, expect } from "@jest/globals";
import { NTriplesFormatter } from "../../../src/utils/NTriplesFormatter.js";

/**
 * Test suite for NTriplesFormatter utility
 * Issue #2226: Fix incomplete string escaping (code scanning alert js/incomplete-sanitization)
 *
 * N-Triples specification requires proper escaping of:
 * - Backslash: \ → \\
 * - Double quote: " → \"
 * - Newline: \n → \\n (in string representation)
 * - Carriage return: \r → \\r
 * - Tab: \t → \\t
 *
 * CRITICAL: Backslash MUST be escaped FIRST, otherwise a literal \"
 * in the input becomes \\\" which represents an escaped backslash followed
 * by an unescaped quote - breaking the string.
 */
describe("NTriplesFormatter", () => {
  describe("formatObject", () => {
    describe("URI handling", () => {
      it("should wrap http URIs in angle brackets", () => {
        const result = NTriplesFormatter.formatObject("http://example.org/resource");
        expect(result).toBe("<http://example.org/resource>");
      });

      it("should wrap https URIs in angle brackets", () => {
        const result = NTriplesFormatter.formatObject("https://example.org/resource");
        expect(result).toBe("<https://example.org/resource>");
      });

      it("should wrap urn URIs in angle brackets", () => {
        const result = NTriplesFormatter.formatObject("urn:uuid:12345678-1234-1234-1234-123456789012");
        expect(result).toBe("<urn:uuid:12345678-1234-1234-1234-123456789012>");
      });
    });

    describe("literal handling", () => {
      it("should wrap plain literals in double quotes", () => {
        const result = NTriplesFormatter.formatObject("Hello World");
        expect(result).toBe('"Hello World"');
      });

      it("should escape double quotes in literals", () => {
        const result = NTriplesFormatter.formatObject('He said "Hello"');
        expect(result).toBe('"He said \\"Hello\\""');
      });

      it("should escape backslashes in literals", () => {
        const result = NTriplesFormatter.formatObject("path\\to\\file");
        expect(result).toBe('"path\\\\to\\\\file"');
      });

      /**
       * CRITICAL TEST for Issue #2226
       * This test demonstrates the vulnerability: if backslashes are not escaped
       * BEFORE quotes, a literal backslash-quote sequence becomes ambiguous.
       *
       * Input: test\"value (contains literal backslash followed by quote)
       * Expected: "test\\\"value" (backslash escaped, then quote escaped)
       * Bug result: "test\\"value" (only quote escaped, backslash unescaped - WRONG!)
       */
      it("should escape backslash before quote (prevents incomplete sanitization)", () => {
        // This is the key test for the security vulnerability
        // Input contains a literal backslash followed by a quote: \"
        const input = 'test\\"value';
        const result = NTriplesFormatter.formatObject(input);
        // Correct: backslash becomes \\, quote becomes \"
        // So \" in input becomes \\\" in output
        expect(result).toBe('"test\\\\\\"value"');
      });

      it("should handle multiple backslashes followed by quotes", () => {
        // Input: a\\\"b (two backslashes, one quote)
        const input = 'a\\\\"b';
        const result = NTriplesFormatter.formatObject(input);
        // Each backslash becomes \\, quote becomes \"
        expect(result).toBe('"a\\\\\\\\\\"b"');
      });

      it("should escape newlines in literals", () => {
        const result = NTriplesFormatter.formatObject("line1\nline2");
        expect(result).toBe('"line1\\nline2"');
      });

      it("should escape carriage returns in literals", () => {
        const result = NTriplesFormatter.formatObject("line1\rline2");
        expect(result).toBe('"line1\\rline2"');
      });

      it("should escape tabs in literals", () => {
        const result = NTriplesFormatter.formatObject("col1\tcol2");
        expect(result).toBe('"col1\\tcol2"');
      });

      it("should handle all escape sequences together", () => {
        // Complex string with all escapable characters
        const input = 'path\\file\t"quoted"\nline2\rend';
        const result = NTriplesFormatter.formatObject(input);
        expect(result).toBe('"path\\\\file\\t\\"quoted\\"\\nline2\\rend"');
      });

      it("should handle empty string", () => {
        const result = NTriplesFormatter.formatObject("");
        expect(result).toBe('""');
      });
    });
  });

  describe("escapeString", () => {
    it("should be accessible for direct escaping needs", () => {
      const result = NTriplesFormatter.escapeString('test\\"value');
      // Returns just the escaped content without surrounding quotes
      expect(result).toBe('test\\\\\\"value');
    });
  });
});
