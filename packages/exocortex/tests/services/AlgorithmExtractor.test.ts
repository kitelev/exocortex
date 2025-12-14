import { AlgorithmExtractor } from "../../src/services/AlgorithmExtractor";

describe("AlgorithmExtractor", () => {
  let extractor: AlgorithmExtractor;

  beforeEach(() => {
    extractor = new AlgorithmExtractor();
  });

  describe("extractH2Section", () => {
    it("should extract content from ## heading section", () => {
      const content = `
# Main Heading

## Algorithm
This is the algorithm content.
Line 2 of algorithm.

## Next Section
Other content here.
`;
      const result = extractor.extractH2Section(content, "Algorithm");
      expect(result).toBe("This is the algorithm content.\nLine 2 of algorithm.");
    });

    it("should return null when heading not found", () => {
      const content = `
# Main Heading

## Other Section
Content here.
`;
      const result = extractor.extractH2Section(content, "Algorithm");
      expect(result).toBeNull();
    });

    it("should stop at next ## heading", () => {
      const content = `
## Algorithm
First line.
Second line.

## Next Section
Should not include this.
`;
      const result = extractor.extractH2Section(content, "Algorithm");
      expect(result).toBe("First line.\nSecond line.");
    });

    it("should stop at # heading", () => {
      const content = `
## Algorithm
First line.

# Top Level
Should not include this.
`;
      const result = extractor.extractH2Section(content, "Algorithm");
      expect(result).toBe("First line.");
    });

    it("should handle empty section", () => {
      const content = `
## Algorithm

## Next Section
`;
      const result = extractor.extractH2Section(content, "Algorithm");
      expect(result).toBeNull();
    });

    it("should trim whitespace", () => {
      const content = `
## Algorithm

  Content with spaces

## Next Section
`;
      const result = extractor.extractH2Section(content, "Algorithm");
      expect(result).toBe("Content with spaces");
    });

    it("should handle section at end of document", () => {
      const content = `
## Algorithm
Last section content.
More content.
`;
      const result = extractor.extractH2Section(content, "Algorithm");
      expect(result).toBe("Last section content.\nMore content.");
    });

    it("should handle exact heading match only", () => {
      const content = `
## Algorithm Details
Wrong heading.

## Algorithm
Correct content.

## Next
`;
      const result = extractor.extractH2Section(content, "Algorithm");
      expect(result).toBe("Correct content.");
    });

    it("should preserve blank lines within section", () => {
      const content = `
## Algorithm
Line 1.

Line 3 after blank.

## Next
`;
      const result = extractor.extractH2Section(content, "Algorithm");
      expect(result).toBe("Line 1.\n\nLine 3 after blank.");
    });

    it("should handle special characters in heading", () => {
      const content = `
## Algorithm: Step-by-step
Content here.

## Next
`;
      const result = extractor.extractH2Section(content, "Algorithm: Step-by-step");
      expect(result).toBe("Content here.");
    });
  });
});
