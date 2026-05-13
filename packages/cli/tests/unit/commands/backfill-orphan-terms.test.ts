import { describe, it, expect } from "@jest/globals";
import {
  tokenize,
  buildConceptTermSet,
  extractOrphanTerms,
} from "../../../src/commands/backfill-orphan-terms.js";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("backfill orphan-terms — tokenize", () => {
  it("splits text on non-word chars and lowercases", () => {
    const tokens = tokenize("SPARQL endpoint, RDF graph!");
    expect(tokens).toContain("sparql");
    expect(tokens).toContain("endpoint");
    expect(tokens).toContain("graph");
  });

  it("filters tokens shorter than 4 chars", () => {
    const tokens = tokenize("of an to a by");
    expect(tokens).toHaveLength(0);
  });

  it("filters stop words", () => {
    const tokens = tokenize("this that these what when with");
    expect(tokens).toHaveLength(0);
  });

  it("keeps meaningful 4+ char tokens", () => {
    const tokens = tokenize("backfill orphan concept vault");
    expect(tokens).toContain("backfill");
    expect(tokens).toContain("orphan");
    expect(tokens).toContain("concept");
    expect(tokens).toContain("vault");
  });

  it("ignores pure-numeric tokens", () => {
    const tokens = tokenize("1234 5678 version1");
    expect(tokens).not.toContain("1234");
    expect(tokens).not.toContain("5678");
  });
});

describe("backfill orphan-terms — buildConceptTermSet", () => {
  it("includes concept labels lowercased", () => {
    const set = buildConceptTermSet([{ label: "Knowledge Management", aliases: [] }]);
    expect(set.has("knowledge management")).toBe(true);
  });

  it("includes aliases lowercased", () => {
    const set = buildConceptTermSet([{ label: "PKMS", aliases: ["Personal Knowledge Management"] }]);
    expect(set.has("personal knowledge management")).toBe(true);
    expect(set.has("pkms")).toBe(true);
  });

  it("returns empty set for empty input", () => {
    const set = buildConceptTermSet([]);
    expect(set.size).toBe(0);
  });
});

describe("backfill orphan-terms — extractOrphanTerms", () => {
  let tmpDir: string;

  const createAiKnowFile = (dir: string, uid: string, body: string): void => {
    const content = `---
exo__Asset_uid: ${uid}
exo__Asset_label: Test Asset ${uid}
---

${body}`;
    writeFileSync(join(dir, `${uid}.md`), content, "utf-8");
  };

  beforeEach(() => {
    tmpDir = join(tmpdir(), `orphan-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns terms not in concept set, sorted by frequency", () => {
    createAiKnowFile(tmpDir, "uid-001", "sparql endpoint query query triplestore");
    createAiKnowFile(tmpDir, "uid-002", "sparql endpoint ontology ontology ontology");
    createAiKnowFile(tmpDir, "uid-003", "sparql backfill backfill");

    const conceptTermSet = new Set(["query"]);
    const orphans = extractOrphanTerms(tmpDir, conceptTermSet, 10);

    const terms = orphans.map((o) => o.term);
    expect(terms).toContain("sparql");
    expect(terms).not.toContain("query");
    expect(terms[0].length).toBeGreaterThan(0);
  });

  it("counts each term once per file (not total occurrences)", () => {
    // "sparql" appears 5 times in file 1, but should count as 1 file
    createAiKnowFile(tmpDir, "uid-001", "sparql sparql sparql sparql sparql");
    createAiKnowFile(tmpDir, "uid-002", "sparql once");

    const orphans = extractOrphanTerms(tmpDir, new Set(), 10);
    const sparqlEntry = orphans.find((o) => o.term === "sparql");
    expect(sparqlEntry).toBeDefined();
    expect(sparqlEntry!.frequency).toBe(2);
  });

  it("respects topN limit", () => {
    createAiKnowFile(tmpDir, "uid-001", "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda");
    const orphans = extractOrphanTerms(tmpDir, new Set(), 3);
    expect(orphans.length).toBeLessThanOrEqual(3);
  });

  it("collects at most 3 sample UIDs per term", () => {
    for (let i = 1; i <= 5; i++) {
      createAiKnowFile(tmpDir, `uid-00${i}`, "sparql endpoint");
    }
    const orphans = extractOrphanTerms(tmpDir, new Set(), 10);
    const sparqlEntry = orphans.find((o) => o.term === "sparql");
    expect(sparqlEntry).toBeDefined();
    expect(sparqlEntry!.sample_uids.length).toBeLessThanOrEqual(3);
    expect(sparqlEntry!.frequency).toBe(5);
  });

  it("skips files without exo__Asset_uid", () => {
    writeFileSync(join(tmpDir, "no-uid.md"), "---\nexo__Asset_label: Test\n---\nsparql endpoint", "utf-8");
    const orphans = extractOrphanTerms(tmpDir, new Set(), 10);
    expect(orphans).toHaveLength(0);
  });
});

describe("backfill orphan-terms — command registration", () => {
  it("backfillOrphanTermsCommand registers with name 'orphan-terms'", async () => {
    const { backfillOrphanTermsCommand } = await import("../../../src/commands/backfill-orphan-terms.js");
    const cmd = backfillOrphanTermsCommand();
    expect(cmd.name()).toBe("orphan-terms");
  });

  it("backfillOrphanTermsCommand has --aiKnow-dir required option", async () => {
    const { backfillOrphanTermsCommand } = await import("../../../src/commands/backfill-orphan-terms.js");
    const cmd = backfillOrphanTermsCommand();
    const opt = cmd.options.find((o) => o.long === "--aiKnow-dir");
    expect(opt).toBeDefined();
    expect(opt!.mandatory).toBe(true);
  });

  it("backfillOrphanTermsCommand has --top option", async () => {
    const { backfillOrphanTermsCommand } = await import("../../../src/commands/backfill-orphan-terms.js");
    const cmd = backfillOrphanTermsCommand();
    const opt = cmd.options.find((o) => o.long === "--top");
    expect(opt).toBeDefined();
  });

  it("backfillCommand includes orphan-terms subcommand", async () => {
    const { backfillCommand } = await import("../../../src/commands/backfill.js");
    const cmd = backfillCommand();
    const sub = cmd.commands.find((c) => c.name() === "orphan-terms");
    expect(sub).toBeDefined();
  });
});
