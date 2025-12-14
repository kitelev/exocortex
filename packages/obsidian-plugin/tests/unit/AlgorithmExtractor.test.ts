import { AlgorithmExtractor } from "exocortex";

describe("AlgorithmExtractor", () => {
  let extractor: AlgorithmExtractor;

  beforeEach(() => {
    extractor = new AlgorithmExtractor();
  });

  describe("extractH2Section", () => {
    it("should extract content between H2 headings", () => {
      const markdown = `## First Section

Content of first section.

## Second Section

Content of second section.
Multiple lines here.

## Third Section

Content of third section.`;

      const result = extractor.extractH2Section(markdown, "Second Section");

      expect(result).toBe("Content of second section.\nMultiple lines here.");
    });

    it("should extract content when H2 is followed by H1", () => {
      const markdown = `## Algorithm

Step 1: First step
Step 2: Second step

# Main Heading

Other content.`;

      const result = extractor.extractH2Section(markdown, "Algorithm");

      expect(result).toBe("Step 1: First step\nStep 2: Second step");
    });

    it("should return null when section not found", () => {
      const markdown = `## First Section

Content here.

## Second Section

More content.`;

      const result = extractor.extractH2Section(markdown, "Missing Section");

      expect(result).toBeNull();
    });

    it("should return null when section is empty", () => {
      const markdown = `## Algorithm

## Next Section

Content here.`;

      const result = extractor.extractH2Section(markdown, "Algorithm");

      expect(result).toBeNull();
    });

    it("should handle section at end of document", () => {
      const markdown = `## First Section

Some content.

## Algorithm

Final step 1
Final step 2`;

      const result = extractor.extractH2Section(markdown, "Algorithm");

      expect(result).toBe("Final step 1\nFinal step 2");
    });

    it("should trim whitespace from extracted content", () => {
      const markdown = `## Algorithm



Step with spaces


## Next Section`;

      const result = extractor.extractH2Section(markdown, "Algorithm");

      expect(result).toBe("Step with spaces");
    });

    it("should handle section with only whitespace as empty", () => {
      const markdown = `## Algorithm



## Next Section`;

      const result = extractor.extractH2Section(markdown, "Algorithm");

      expect(result).toBeNull();
    });

    it("should preserve internal line breaks in content", () => {
      const markdown = `## Algorithm

Step 1: Do this

Step 2: Do that

Step 3: Finish

## Notes`;

      const result = extractor.extractH2Section(markdown, "Algorithm");

      expect(result).toBe(
        "Step 1: Do this\n\nStep 2: Do that\n\nStep 3: Finish",
      );
    });

    it("should not match partial heading names", () => {
      const markdown = `## Algorithm Details

Some content

## Algorithm

The actual algorithm

## Next Section`;

      const result = extractor.extractH2Section(markdown, "Algorithm");

      expect(result).toBe("The actual algorithm");
    });

    it("should handle heading with extra whitespace", () => {
      const markdown = `## Algorithm

Content here

## Next Section`;

      const result = extractor.extractH2Section(markdown, "Algorithm");

      expect(result).toBe("Content here");
    });
  });
});
