/**
 * Unit tests for the shared sparqlBlock utilities (RFC 78c2b7d0 C4 —
 * single source of truth for the M2-lock body extraction used by both
 * ObsidianQueryBodyResolver and FsQueryBodyResolver).
 */
import {
  extractSparqlBlock,
  stripFrontmatter,
} from "../../../src/utilities/sparqlBlock";

describe("extractSparqlBlock", () => {
  it("extracts the first fenced sparql block, trimmed", () => {
    const md = [
      "# Query",
      "```sparql",
      "SELECT ?s WHERE { ?s ?p ?o }",
      "```",
      "trailing",
    ].join("\n");
    expect(extractSparqlBlock(md)).toBe("SELECT ?s WHERE { ?s ?p ?o }");
  });

  it("returns null when no sparql block is present", () => {
    expect(extractSparqlBlock("# Just prose, no code block")).toBeNull();
  });

  it("returns null for an empty sparql block", () => {
    expect(extractSparqlBlock("```sparql\n\n```")).toBeNull();
  });

  it("captures only the first block when several are present", () => {
    const md = "```sparql\nASK { }\n```\n```sparql\nSELECT ?x {}\n```";
    expect(extractSparqlBlock(md)).toBe("ASK { }");
  });
});

describe("stripFrontmatter", () => {
  it("removes a leading YAML frontmatter block", () => {
    const content = "---\nexo__Asset_uid: abc\n---\n```sparql\nASK { }\n```";
    const body = stripFrontmatter(content);
    expect(body).not.toContain("exo__Asset_uid");
    expect(body).toContain("```sparql");
  });

  it("returns content unchanged when there is no frontmatter", () => {
    const content = "# No frontmatter\n```sparql\nASK { }\n```";
    expect(stripFrontmatter(content)).toBe(content);
  });
});
