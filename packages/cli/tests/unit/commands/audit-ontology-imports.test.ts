import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  scanVaultForOntologyImports,
  auditOntologyImportsCommand,
  ONTOLOGY_CLASS_UID,
} from "../../../src/commands/audit-ontology-imports.js";
import { auditCommand } from "../../../src/commands/audit.js";

const ONTO_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ONTO_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ONTO_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

interface AssetSpec {
  uid: string;
  label?: string;
  isDefinedBy?: string;
  instanceClass?: string[];
  imports?: string[];
  body?: string;
  filename?: string;
}

function writeAsset(dir: string, spec: AssetSpec): string {
  mkdirSync(dir, { recursive: true });
  const lines = [
    "---",
    `exo__Asset_uid: ${spec.uid}`,
    `exo__Asset_label: "${spec.label ?? `Asset ${spec.uid}`}"`,
  ];
  if (spec.instanceClass) {
    lines.push("exo__Instance_class:");
    for (const c of spec.instanceClass) lines.push(`  - "[[${c}]]"`);
  }
  if (spec.isDefinedBy !== undefined) {
    lines.push(`exo__Asset_isDefinedBy: "${spec.isDefinedBy}"`);
  }
  if (spec.imports) {
    lines.push("exo__Ontology_imports:");
    for (const i of spec.imports) lines.push(`  - "[[${i}]]"`);
  }
  lines.push("---", "", spec.body ?? "Body.", "");
  const file = join(dir, `${spec.filename ?? spec.uid}.md`);
  writeFileSync(file, lines.join("\n"), "utf-8");
  return file;
}

function writeOntology(
  dir: string,
  uid: string,
  label: string,
  imports?: string[],
): string {
  return writeAsset(dir, {
    uid,
    label,
    instanceClass: [ONTOLOGY_CLASS_UID],
    isDefinedBy: `[[${uid}]]`, // namespace ontologies are self-referential
    imports,
  });
}

describe("audit ontology-imports — Commander wiring", () => {
  it("registers under 'audit' parent command", () => {
    const parent = auditCommand();
    const sub = parent.commands.find((c) => c.name() === "ontology-imports");
    expect(sub).toBeDefined();
  });

  it("subcommand declares --vault required + --output options", () => {
    const sub = auditOntologyImportsCommand();
    expect(sub.name()).toBe("ontology-imports");
    const opts = sub.options.map((o) => o.long);
    expect(opts).toContain("--vault");
    expect(opts).toContain("--output");
  });
});

describe("audit ontology-imports — scanVaultForOntologyImports", () => {
  let vault: string;

  beforeEach(() => {
    vault = join(
      tmpdir(),
      `audit-onto-imports-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(vault, { recursive: true });
    // exo__Ontology class definition file — every ontology's
    // exo__Instance_class wikilink resolves here (it has no isDefinedBy, so it
    // is itself a no-ontology asset; those links classify as no-ontology).
    writeAsset(join(vault, "exo"), {
      uid: ONTOLOGY_CLASS_UID,
      label: "exo__Ontology",
    });
  });

  afterEach(() => {
    rmSync(vault, { recursive: true, force: true });
  });

  it("classifies internal / cross-ontology-valid / violation occurrences", async () => {
    // A imports C. a1 links: a2 (internal), c1 (valid via import), b1 (violation).
    writeOntology(join(vault, "alpha"), ONTO_A, "$alpha", [ONTO_C]);
    writeOntology(join(vault, "beta"), ONTO_B, "$beta");
    writeOntology(join(vault, "gamma"), ONTO_C, "$gamma");
    writeAsset(join(vault, "alpha"), {
      uid: "11111111-1111-4111-8111-111111111111",
      isDefinedBy: `[[${ONTO_A}]]`,
      body: "Links: [[22222222-2222-4222-8222-222222222222]] and [[33333333-3333-4333-8333-333333333333]] and [[44444444-4444-4444-8444-444444444444]].",
    });
    writeAsset(join(vault, "alpha"), {
      uid: "22222222-2222-4222-8222-222222222222",
      isDefinedBy: `[[${ONTO_A}]]`,
    });
    writeAsset(join(vault, "beta"), {
      uid: "33333333-3333-4333-8333-333333333333",
      isDefinedBy: `[[${ONTO_B}]]`,
    });
    writeAsset(join(vault, "gamma"), {
      uid: "44444444-4444-4444-8444-444444444444",
      isDefinedBy: `[[${ONTO_C}]]`,
    });

    const r = await scanVaultForOntologyImports(vault);

    expect(r.linkCounts.crossOntologyViolation).toBe(1);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].source.uid).toBe(ONTO_A);
    expect(r.violations[0].target.uid).toBe(ONTO_B);
    expect(r.violations[0].occurrences).toBe(1);
    // a1 → c1 plus A's own exo__Ontology_imports declaration link A → C
    // (the declaration is itself a frontmatter wikilink, valid by construction).
    expect(r.linkCounts.crossOntologyValid).toBe(2);
    // 3 ontology self-isDefinedBy + 4 asset isDefinedBy + a1→a2 = 8
    expect(r.linkCounts.internal).toBe(8);
    expect(r.declared.acyclic).toBe(true);
    expect(r.clean).toBe(false);

    // Derived graph contains both the valid and the violating edge.
    const edgeAB = r.derivedEdges.find(
      (e) => e.source === ONTO_A && e.target === ONTO_B,
    );
    const edgeAC = r.derivedEdges.find(
      (e) => e.source === ONTO_A && e.target === ONTO_C,
    );
    expect(edgeAB?.valid).toBe(false);
    expect(edgeAC?.valid).toBe(true);
    expect(edgeAC?.occurrences).toBe(2); // imports declaration + a1→c1

    // Per-ontology stats (AC: --output json carries them).
    const alpha = r.ontologies.find((o) => o.uid === ONTO_A)!;
    expect(alpha.assetCount).toBe(3); // ontology file itself + a1 + a2
    expect(alpha.outDegree).toBe(2);
    expect(alpha.violatingOut).toBe(1);
    expect(alpha.externalLinksOut).toBe(3); // imports decl + a1→c1 + a1→b1
    const beta = r.ontologies.find((o) => o.uid === ONTO_B)!;
    expect(beta.inDegree).toBe(1);
    expect(beta.externalLinksIn).toBe(1);
  });

  it("honors TRANSITIVE closure: A→B→C declared makes A→C links valid (VL#2)", async () => {
    writeOntology(join(vault, "alpha"), ONTO_A, "$alpha", [ONTO_B]);
    writeOntology(join(vault, "beta"), ONTO_B, "$beta", [ONTO_C]);
    writeOntology(join(vault, "gamma"), ONTO_C, "$gamma");
    writeAsset(join(vault, "alpha"), {
      uid: "11111111-1111-4111-8111-111111111111",
      isDefinedBy: `[[${ONTO_A}]]`,
      body: "Deep link [[55555555-5555-4555-8555-555555555555]].",
    });
    writeAsset(join(vault, "gamma"), {
      uid: "55555555-5555-4555-8555-555555555555",
      isDefinedBy: `[[${ONTO_C}]]`,
    });

    const r = await scanVaultForOntologyImports(vault);
    expect(r.linkCounts.crossOntologyViolation).toBe(0);
    // a1→c5 (transitively valid) + the two imports-declaration links A→B, B→C.
    expect(r.linkCounts.crossOntologyValid).toBe(3);
    expect(r.clean).toBe(true);
  });

  it("counts broken links as fail-open skips, never violations (VL#6)", async () => {
    writeOntology(join(vault, "alpha"), ONTO_A, "$alpha");
    writeAsset(join(vault, "alpha"), {
      uid: "11111111-1111-4111-8111-111111111111",
      isDefinedBy: `[[${ONTO_A}]]`,
      body: "Dangling [[99999999-9999-4999-8999-999999999999]] and [[No Such Note]].",
    });

    const r = await scanVaultForOntologyImports(vault);
    expect(r.skips.broken).toBe(2);
    expect(r.skipExamples.broken).toHaveLength(2);
    expect(r.linkCounts.crossOntologyViolation).toBe(0);
    expect(r.clean).toBe(true);
  });

  it("counts ambiguous basenames separately without guessing (R5)", async () => {
    writeOntology(join(vault, "alpha"), ONTO_A, "$alpha");
    writeAsset(join(vault, "alpha"), {
      uid: "11111111-1111-4111-8111-111111111111",
      isDefinedBy: `[[${ONTO_A}]]`,
      body: "Ambiguous [[Note]].",
    });
    writeAsset(join(vault, "alpha"), {
      uid: "22222222-2222-4222-8222-222222222222",
      isDefinedBy: `[[${ONTO_A}]]`,
      filename: "Note",
    });
    writeAsset(join(vault, "beta"), {
      uid: "33333333-3333-4333-8333-333333333333",
      filename: "Note",
    });

    const r = await scanVaultForOntologyImports(vault);
    expect(r.skips["dup-basename"]).toBe(1);
    expect(r.linkCounts.crossOntologyViolation).toBe(0);
  });

  it("resolves UID-form targets UID-first even when the filename differs", async () => {
    writeOntology(join(vault, "alpha"), ONTO_A, "$alpha");
    writeOntology(join(vault, "beta"), ONTO_B, "$beta");
    // Target lives under a label filename but carries the UID in frontmatter.
    writeAsset(join(vault, "beta"), {
      uid: "33333333-3333-4333-8333-333333333333",
      isDefinedBy: `[[${ONTO_B}]]`,
      filename: "Label Named Note",
    });
    writeAsset(join(vault, "alpha"), {
      uid: "11111111-1111-4111-8111-111111111111",
      isDefinedBy: `[[${ONTO_A}]]`,
      body: "UID link [[33333333-3333-4333-8333-333333333333]].",
    });

    const r = await scanVaultForOntologyImports(vault);
    expect(r.skips.broken).toBe(0);
    expect(r.linkCounts.crossOntologyViolation).toBe(1); // resolved → A→B violating
  });

  it("ignores wikilinks in fenced code blocks (R10) and templates/ sources (R6)", async () => {
    writeOntology(join(vault, "alpha"), ONTO_A, "$alpha");
    writeOntology(join(vault, "beta"), ONTO_B, "$beta");
    writeAsset(join(vault, "beta"), {
      uid: "33333333-3333-4333-8333-333333333333",
      isDefinedBy: `[[${ONTO_B}]]`,
    });
    writeAsset(join(vault, "alpha"), {
      uid: "11111111-1111-4111-8111-111111111111",
      isDefinedBy: `[[${ONTO_A}]]`,
      body: [
        "```",
        "[[33333333-3333-4333-8333-333333333333]]",
        "```",
        "No live links.",
      ].join("\n"),
    });
    // A template under templates/ links across ontologies — must not count.
    writeAsset(join(vault, "templates", "ems"), {
      uid: "77777777-7777-4777-8777-777777777777",
      isDefinedBy: `[[${ONTO_A}]]`,
      body: "Template link [[33333333-3333-4333-8333-333333333333]].",
    });
    // Legacy capitalized location stays excluded too.
    writeAsset(join(vault, "09 Templates", "ems"), {
      uid: "88888888-8888-4888-8888-888888888888",
      isDefinedBy: `[[${ONTO_A}]]`,
      body: "Template link [[33333333-3333-4333-8333-333333333333]].",
    });

    const r = await scanVaultForOntologyImports(vault);
    expect(r.linkCounts.crossOntologyViolation).toBe(0);
    expect(r.clean).toBe(true);
  });

  it("tracks no-ontology assets by reason; their links are no-ontology, not violations", async () => {
    writeOntology(join(vault, "alpha"), ONTO_A, "$alpha");
    writeAsset(join(vault, "alpha"), {
      uid: "11111111-1111-4111-8111-111111111111",
      isDefinedBy: `[[${ONTO_A}]]`,
    });
    // empty isDefinedBy
    writeAsset(join(vault, "inbox"), {
      uid: "22222222-2222-4222-8222-222222222222",
      body: "Link [[11111111-1111-4111-8111-111111111111]].",
    });
    // bang-prefix
    writeAsset(join(vault, "inbox"), {
      uid: "33333333-3333-4333-8333-333333333333",
      isDefinedBy: "[[!kitelev]]",
    });
    // unresolvable
    writeAsset(join(vault, "inbox"), {
      uid: "44444444-4444-4444-8444-444444444444",
      isDefinedBy: "[[99999999-9999-4999-8999-999999999999]]",
    });
    // resolves to a non-ontology asset
    writeAsset(join(vault, "inbox"), {
      uid: "55555555-5555-4555-8555-555555555555",
      isDefinedBy: "[[11111111-1111-4111-8111-111111111111]]",
    });

    const r = await scanVaultForOntologyImports(vault);
    // +1 empty: the exo__Ontology class-definition fixture has no isDefinedBy.
    expect(r.noOntologyAssets.byReason["empty-isDefinedBy"]).toBe(2);
    expect(r.noOntologyAssets.byReason["bang-prefix"]).toBe(1);
    expect(r.noOntologyAssets.byReason.unresolvable).toBe(1);
    expect(r.noOntologyAssets.byReason["not-an-ontology"]).toBe(1);
    expect(r.noOntologyAssets.count).toBe(5);
    expect(r.linkCounts.noOntology).toBeGreaterThanOrEqual(1);
    expect(r.linkCounts.crossOntologyViolation).toBe(0);
    // Informational only — link-level invariant is clean.
    expect(r.clean).toBe(true);
  });

  it("flags duplicate ontology UIDs as a hard error forcing clean=false (R7)", async () => {
    writeOntology(join(vault, "alpha"), ONTO_A, "$alpha");
    writeAsset(join(vault, "beta"), {
      uid: ONTO_A, // same UID, different file
      label: "$alpha-duplicate",
      instanceClass: [ONTOLOGY_CLASS_UID],
      isDefinedBy: `[[${ONTO_A}]]`,
      filename: "duplicate-alpha",
    });

    const r = await scanVaultForOntologyImports(vault);
    expect(r.duplicateOntologyUids).toHaveLength(1);
    expect(r.duplicateOntologyUids[0].uid).toBe(ONTO_A);
    expect(r.duplicateOntologyUids[0].paths).toHaveLength(2);
    expect(r.clean).toBe(false);
  });

  it("treats self-import as a warning, not a cycle (R7)", async () => {
    writeOntology(join(vault, "alpha"), ONTO_A, "$alpha", [ONTO_A]);

    const r = await scanVaultForOntologyImports(vault);
    expect(r.warnings.selfImports).toEqual([ONTO_A]);
    expect(r.declared.acyclic).toBe(true);
    expect(r.clean).toBe(true);
  });

  it("reports unresolvable declared imports as a category (R7)", async () => {
    writeOntology(join(vault, "alpha"), ONTO_A, "$alpha", [
      "99999999-9999-4999-8999-999999999999",
    ]);

    const r = await scanVaultForOntologyImports(vault);
    const alpha = r.ontologies.find((o) => o.uid === ONTO_A)!;
    expect(alpha.unresolvedImports).toEqual([
      "99999999-9999-4999-8999-999999999999",
    ]);
    expect(alpha.declaredImports).toEqual([]);
    expect(r.clean).toBe(true); // unresolved import alone is not a violation
  });

  it("detects declared-graph cycles via SCC and fails the audit", async () => {
    writeOntology(join(vault, "alpha"), ONTO_A, "$alpha", [ONTO_B]);
    writeOntology(join(vault, "beta"), ONTO_B, "$beta", [ONTO_A]);

    const r = await scanVaultForOntologyImports(vault);
    expect(r.declared.acyclic).toBe(false);
    expect(r.declared.sccs).toHaveLength(1);
    expect([...r.declared.sccs[0]].sort()).toEqual([ONTO_A, ONTO_B].sort());
    expect(r.clean).toBe(false);
  });

  it("skips non-markdown embeds with a dedicated counter", async () => {
    writeOntology(join(vault, "alpha"), ONTO_A, "$alpha");
    writeAsset(join(vault, "alpha"), {
      uid: "11111111-1111-4111-8111-111111111111",
      isDefinedBy: `[[${ONTO_A}]]`,
      body: "Image ![[diagram.png]] and [[notes.pdf]].",
    });

    const r = await scanVaultForOntologyImports(vault);
    expect(r.skips["non-markdown"]).toBe(2);
    expect(r.skips.broken).toBe(0);
  });
});
