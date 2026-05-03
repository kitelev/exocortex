import { describe, it, expect } from "@jest/globals";
import type { ConceptEntry, BackfillCandidate } from "../../../src/commands/backfill-suggest.js";
import {
  scoreMatch,
  computeCandidates,
  isAutoApproved,
  isConceptFile,
  MIN_LABEL_FOR_SUBSTRING,
} from "../../../src/commands/backfill-suggest.js";

describe("backfill suggest — scoreMatch", () => {
  it("returns 1.0 for exact case-insensitive match", () => {
    expect(scoreMatch("knowledge management", "Knowledge Management")).toBe(1.0);
  });

  it("returns 0.85 for substring match", () => {
    expect(scoreMatch("knowledge management system", "knowledge management")).toBe(0.85);
  });

  it("returns 0 when no match", () => {
    expect(scoreMatch("totally different text", "knowledge management")).toBe(0);
  });

  it("returns 0 for empty term", () => {
    expect(scoreMatch("some text", "")).toBe(0);
  });

  it("returns 0 for single-char term (too short)", () => {
    expect(scoreMatch("a text", "a")).toBe(0);
  });

  it("MIN_LABEL_FOR_SUBSTRING constant equals 4", () => {
    expect(MIN_LABEL_FOR_SUBSTRING).toBe(4);
  });

  it("returns 0 for 2-char term substring (below MIN_LABEL_FOR_SUBSTRING)", () => {
    expect(scoreMatch("a beautiful day", "be")).toBe(0);
  });

  it("returns 0 for 3-char term substring (below MIN_LABEL_FOR_SUBSTRING)", () => {
    expect(scoreMatch("knowledge management", "man")).toBe(0);
  });

  it("still returns 1.0 exact match for short term", () => {
    expect(scoreMatch("ai", "AI")).toBe(1.0);
  });

  it("returns 0.85 for substring with term of exactly 4 chars", () => {
    expect(scoreMatch("knowledge management", "know")).toBe(0.85);
  });
});

describe("backfill suggest — isConceptFile", () => {
  const CONCEPT_UUID = "dda12c48-6886-4624-8710-ed4ba92ce2b3";

  const conceptFrontmatter = `---
exo__Asset_uid: abc-123
exo__Asset_label: My Concept
exo__Instance_class: "[[${CONCEPT_UUID}|ims__Concept]]"
---
This is the body text.`;

  const nonConceptFrontmatter = `---
exo__Asset_uid: def-456
exo__Asset_label: My Task
exo__Instance_class: "[[1b20a8f0-d745-4e93-91db-4531b3df120e|ems__Task]]"
---
This text references a concept wikilink [[${CONCEPT_UUID}|ims__Concept]] in the body.`;

  const noFrontmatter = `Just plain body text mentioning ${CONCEPT_UUID} without frontmatter.`;

  it("returns true when exo__Instance_class frontmatter contains concept UUID", () => {
    expect(isConceptFile(conceptFrontmatter)).toBe(true);
  });

  it("returns false when concept UUID appears only in body, not in frontmatter class", () => {
    expect(isConceptFile(nonConceptFrontmatter)).toBe(false);
  });

  it("returns false for file with no frontmatter", () => {
    expect(isConceptFile(noFrontmatter)).toBe(false);
  });

  it("returns false for file with empty content", () => {
    expect(isConceptFile("")).toBe(false);
  });
});

describe("backfill suggest — computeCandidates", () => {
  const concepts: ConceptEntry[] = [
    { uid: "uid-1", label: "Knowledge Management", aliases: ["KM", "PKMS"], filePath: "/vault/c1.md" },
    { uid: "uid-2", label: "Distributed Systems", aliases: ["DS"], filePath: "/vault/c2.md" },
    { uid: "uid-3", label: "Graph Database", aliases: ["Graph DB"], filePath: "/vault/c3.md" },
    { uid: "uid-4", label: "Totally Unrelated Topic", aliases: [], filePath: "/vault/c4.md" },
    { uid: "uid-5", label: "Blockchain", aliases: ["DLT", "Distributed Ledger"], filePath: "/vault/c5.md" },
  ];

  it("returns top-3 candidates sorted by confidence", () => {
    const candidates = computeCandidates(
      "Knowledge Management System",
      "A system for managing distributed knowledge",
      "graph database notes here",
      concepts,
    );
    expect(candidates.length).toBeLessThanOrEqual(3);
    for (let i = 0; i < candidates.length - 1; i++) {
      expect(candidates[i].confidence).toBeGreaterThanOrEqual(candidates[i + 1].confidence);
    }
  });

  it("detects exact label match with confidence 1.0", () => {
    const candidates = computeCandidates(
      "Blockchain",
      "",
      "",
      concepts,
    );
    const top = candidates[0];
    expect(top.concept_uid).toBe("uid-5");
    expect(top.confidence).toBe(1.0);
    expect(top.match_type).toBe("label_exact");
  });

  it("detects label substring match with confidence 0.85", () => {
    const candidates = computeCandidates(
      "Introduction to Graph Database concepts",
      "",
      "",
      concepts,
    );
    const graphCandidate = candidates.find((c) => c.concept_uid === "uid-3");
    expect(graphCandidate).toBeDefined();
    expect(graphCandidate!.confidence).toBe(0.85);
    expect(graphCandidate!.match_type).toBe("label_substring");
  });

  it("returns empty array when no concepts match", () => {
    const candidates = computeCandidates(
      "Xyzzy Plugh Frotz",
      "",
      "",
      concepts,
    );
    expect(candidates).toHaveLength(0);
  });

  it("detects alias match with lower confidence than direct label match", () => {
    const candidates = computeCandidates(
      "PKMS notes",
      "",
      "",
      concepts,
    );
    const kmCandidate = candidates.find((c) => c.concept_uid === "uid-1");
    expect(kmCandidate).toBeDefined();
    expect(kmCandidate!.confidence).toBeLessThan(1.0);
    expect(kmCandidate!.match_type).toContain("alias");
  });

  it("does NOT match 3-char alias as substring (MIN_LABEL_FOR_SUBSTRING=4)", () => {
    // "PKM" is 3 chars — below MIN_LABEL_FOR_SUBSTRING, so no substring match
    const candidates = computeCandidates("PKM notes", "", "", concepts);
    const kmCandidate = candidates.find((c) => c.concept_uid === "uid-1");
    expect(kmCandidate).toBeUndefined();
  });

  it("body match has lower confidence than label match", () => {
    const labelCandidates = computeCandidates("Blockchain", "", "", concepts);
    const bodyCandidates = computeCandidates("XyzzyFrotz", "", "blockchain reference in body", concepts);
    const labelTop = labelCandidates.find((c) => c.concept_uid === "uid-5");
    const bodyTop = bodyCandidates.find((c) => c.concept_uid === "uid-5");
    if (labelTop && bodyTop) {
      expect(labelTop.confidence).toBeGreaterThan(bodyTop.confidence);
    }
  });
});

describe("backfill suggest — isAutoApproved", () => {
  const exactLabelCandidate: BackfillCandidate = {
    concept_uid: "uid-1",
    concept_label: "Knowledge Management",
    concept_file: "/vault/c1.md",
    confidence: 1.0,
    match_type: "label_exact",
  };

  const substringCandidate: BackfillCandidate = {
    concept_uid: "uid-2",
    concept_label: "Distributed Systems",
    concept_file: "/vault/c2.md",
    confidence: 0.85,
    match_type: "label_substring",
  };

  const lowConfidenceExact: BackfillCandidate = {
    concept_uid: "uid-3",
    concept_label: "Graph Database",
    concept_file: "/vault/c3.md",
    confidence: 0.5,
    match_type: "label_exact",
  };

  it("auto-approves when confidence ≥ threshold AND match_type is label_exact", () => {
    expect(isAutoApproved(exactLabelCandidate, 0.8)).toBe(true);
  });

  it("does NOT auto-approve label_substring even above threshold", () => {
    expect(isAutoApproved(substringCandidate, 0.8)).toBe(false);
  });

  it("does NOT auto-approve label_exact below threshold", () => {
    expect(isAutoApproved(lowConfidenceExact, 0.8)).toBe(false);
  });

  it("respects custom threshold", () => {
    expect(isAutoApproved(substringCandidate, 0.5)).toBe(false);
    expect(isAutoApproved(exactLabelCandidate, 1.1)).toBe(false);
  });
});

describe("backfill suggest — command registration", () => {
  it("backfillSuggestCommand registers with name 'suggest'", async () => {
    const { backfillSuggestCommand } = await import("../../../src/commands/backfill-suggest.js");
    const cmd = backfillSuggestCommand();
    expect(cmd.name()).toBe("suggest");
  });

  it("backfillSuggestCommand has --aiKnow-dir option", async () => {
    const { backfillSuggestCommand } = await import("../../../src/commands/backfill-suggest.js");
    const cmd = backfillSuggestCommand();
    const opt = cmd.options.find((o) => o.long === "--aiKnow-dir");
    expect(opt).toBeDefined();
    expect(opt!.mandatory).toBe(true);
  });

  it("backfillSuggestCommand has --auto-threshold option", async () => {
    const { backfillSuggestCommand } = await import("../../../src/commands/backfill-suggest.js");
    const cmd = backfillSuggestCommand();
    const opt = cmd.options.find((o) => o.long === "--auto-threshold");
    expect(opt).toBeDefined();
  });

  it("backfillCommand registers with name 'backfill' and has suggest subcommand", async () => {
    const { backfillCommand } = await import("../../../src/commands/backfill.js");
    const cmd = backfillCommand();
    expect(cmd.name()).toBe("backfill");
    const sub = cmd.commands.find((c) => c.name() === "suggest");
    expect(sub).toBeDefined();
  });
});
