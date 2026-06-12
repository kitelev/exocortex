import { describe, it, expect } from "@jest/globals";
import {
  stripFencedCodeBlocks,
  extractWikilinkTargets,
  collectFrontmatterStrings,
  bodyOf,
  extractFileWikilinkTargets,
} from "../../../src/services/wikilinkExtraction.js";

describe("extractWikilinkTargets", () => {
  it("extracts bare, aliased, anchored, and embedded wikilinks", () => {
    const text =
      "See [[target-a]] and [[uid-b|Alias B]] plus [[uid-c#section]] and " +
      "[[uid-d#^block|labeled]] and ![[embedded-note]].";
    expect(extractWikilinkTargets(text)).toEqual([
      "target-a",
      "uid-b",
      "uid-c",
      "uid-d",
      "embedded-note",
    ]);
  });

  it("drops pure self-anchor links like [[#heading]]", () => {
    expect(extractWikilinkTargets("Jump to [[#section]] here")).toEqual([]);
  });

  it("trims whitespace and returns empty array for no links", () => {
    expect(extractWikilinkTargets("[[  spaced  ]]")).toEqual(["spaced"]);
    expect(extractWikilinkTargets("no links here")).toEqual([]);
  });
});

describe("stripFencedCodeBlocks (R10)", () => {
  it("removes wikilinks inside ``` fences", () => {
    const text = [
      "before [[keep-me]]",
      "```sparql",
      "SELECT [[drop-me]]",
      "```",
      "after [[also-keep]]",
    ].join("\n");
    const targets = extractWikilinkTargets(stripFencedCodeBlocks(text));
    expect(targets).toEqual(["keep-me", "also-keep"]);
  });

  it("removes ~~~ fences and honors closers longer than the opener", () => {
    const text = [
      "~~~",
      "[[drop-1]]",
      "~~~~",
      "[[keep-1]]",
      "````md",
      "[[drop-2]]",
      "```",
      "still inside [[drop-3]]",
      "`````",
      "[[keep-2]]",
    ].join("\n");
    // The ``` closer is SHORTER than the ```` opener → not a closer (CommonMark).
    const targets = extractWikilinkTargets(stripFencedCodeBlocks(text));
    expect(targets).toEqual(["keep-1", "keep-2"]);
  });

  it("drops everything after an unclosed fence", () => {
    const text = "[[keep]]\n```\n[[drop]]\nmore [[drop-too]]";
    expect(extractWikilinkTargets(stripFencedCodeBlocks(text))).toEqual([
      "keep",
    ]);
  });

  it("does NOT strip inline code spans (R10 names fenced blocks only)", () => {
    const text = "inline `[[counted]]` link";
    expect(extractWikilinkTargets(stripFencedCodeBlocks(text))).toEqual([
      "counted",
    ]);
  });

  it("a line-leading inline triple-backtick span is NOT a fence opener (CommonMark: no backticks in info string)", () => {
    const text = ["```[[in-span]]``` then [[keep-a]]", "[[keep-b]]"].join("\n");
    expect(extractWikilinkTargets(stripFencedCodeBlocks(text))).toEqual([
      "in-span",
      "keep-a",
      "keep-b",
    ]);
  });
});

describe("collectFrontmatterStrings", () => {
  it("collects strings recursively from nested arrays and objects", () => {
    const metadata = {
      a: "[[one]]",
      b: ["[[two]]", { c: "[[three]]" }],
      d: 42,
      e: null,
      f: true,
    };
    const targets = collectFrontmatterStrings(metadata).flatMap(
      extractWikilinkTargets,
    );
    expect(targets).toEqual(["one", "two", "three"]);
  });
});

describe("bodyOf", () => {
  it("returns content after the frontmatter block", () => {
    const content = "---\nkey: value\n---\n\nBody [[link]].";
    expect(bodyOf(content)).toBe("\n\nBody [[link]].");
  });

  it("returns whole content when there is no frontmatter", () => {
    expect(bodyOf("just text")).toBe("just text");
  });
});

describe("extractFileWikilinkTargets", () => {
  it("merges frontmatter + body targets, excluding fenced code", () => {
    const metadata = {
      exo__Asset_isDefinedBy: "[[onto-uid]]",
      exo__Asset_relates: ["[[rel-1|Label]]"],
    };
    const content = [
      "---",
      'exo__Asset_isDefinedBy: "[[onto-uid]]"',
      "---",
      "Body [[body-target#anchor]].",
      "```",
      "[[fenced-ignored]]",
      "```",
    ].join("\n");
    expect(extractFileWikilinkTargets(metadata, content)).toEqual([
      "onto-uid",
      "rel-1",
      "body-target",
    ]);
  });
});

describe("extractFileWikilinkTargets — predicate exclusion (VL#30)", () => {
  const metadata = {
    exo__Asset_isDefinedBy: "[[onto-uid]]",
    exo__Asset_relates: ["[[rel-1|Label]]", "[[rel-2]]"],
    ims__Concept_broader: "[[broad-1]]",
  };
  const content = ["---", "x: y", "---", "Body [[body-target#anchor]]."].join(
    "\n",
  );

  it("an empty exclusion set is byte-identical to the 2-arg call (default unchanged)", () => {
    expect(extractFileWikilinkTargets(metadata, content, new Set())).toEqual(
      extractFileWikilinkTargets(metadata, content),
    );
  });

  it("excludes only the named top-level frontmatter keys; body links always kept", () => {
    const exclude = new Set(["exo__Asset_relates", "ims__Concept_broader"]);
    expect(extractFileWikilinkTargets(metadata, content, exclude)).toEqual([
      "onto-uid", // exo__Asset_isDefinedBy is not excluded
      "body-target", // body links are never predicate-attributed (conservative)
    ]);
  });

  it("an exclusion set matching no key leaves every target intact", () => {
    const exclude = new Set(["some__Unrelated_predicate"]);
    expect(extractFileWikilinkTargets(metadata, content, exclude)).toEqual(
      extractFileWikilinkTargets(metadata, content),
    );
  });
});
