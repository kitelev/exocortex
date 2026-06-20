/**
 * StructuredMerger — 3-way structured merge (RFC 4e4dc453 A2, D1/D20/D21).
 *
 * Curated M3 set: non-overlapping / overlapping / delete-vs-modify of
 * multi-valued keys / tombstone non-resurrection / body section + paragraph
 * merge. The codec mirrors the production contract: js-yaml CORE_SCHEMA
 * (date-like scalars stay strings — advisor HIGH catch).
 */

import * as yaml from "js-yaml";
import {
  StructuredMerger,
  splitSections,
  type YamlCodec,
} from "../../../../src/services/sync/StructuredMerger";

const codec: YamlCodec = {
  parse: (text) => yaml.load(text, { schema: yaml.CORE_SCHEMA }),
  stringify: (value) =>
    yaml.dump(value, { schema: yaml.CORE_SCHEMA, lineWidth: -1 }),
};

const merger = new StructuredMerger(codec);

function asset(opts: {
  uid?: string;
  label?: string;
  aliases?: string[];
  classes?: string[];
  extra?: Record<string, string>;
  body?: string;
}): string {
  const lines = ["---"];
  lines.push(`exo__Asset_uid: ${opts.uid ?? "u1"}`);
  if (opts.label !== undefined) lines.push(`exo__Asset_label: "${opts.label}"`);
  if (opts.classes) {
    lines.push("exo__Instance_class:");
    for (const c of opts.classes) lines.push(`  - "${c}"`);
  }
  if (opts.aliases) {
    lines.push("aliases:");
    for (const a of opts.aliases) lines.push(`  - "${a}"`);
  }
  for (const [k, v] of Object.entries(opts.extra ?? {})) {
    lines.push(`${k}: ${v}`);
  }
  lines.push("---");
  lines.push("");
  lines.push(opts.body ?? "body text");
  lines.push("");
  return lines.join("\n");
}

function fmOf(content: string): Record<string, unknown> {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(content);
  expect(m).not.toBeNull();
  return yaml.load((m as RegExpExecArray)[1], {
    schema: yaml.CORE_SCHEMA,
  }) as Record<string, unknown>;
}

describe("StructuredMerger — file-level outcomes", () => {
  it("delete-vs-modify → conflict (both directions)", () => {
    const base = asset({});
    expect(
      merger.mergeAsset({ path: "a.md", base, local: undefined, remote: asset({ label: "x" }) }),
    ).toMatchObject({ status: "conflict", reason: expect.stringMatching(/delete-vs-modify/) });
    expect(
      merger.mergeAsset({ path: "a.md", base, local: asset({ label: "x" }), remote: undefined }),
    ).toMatchObject({ status: "conflict" });
  });

  it("one side unchanged → other side verbatim", () => {
    const base = asset({ label: "old" });
    const local = asset({ label: "new local" });
    expect(merger.mergeAsset({ path: "a.md", base, local, remote: base })).toEqual({
      status: "merged",
      content: local,
      warnings: [],
    });
  });
});

describe("StructuredMerger — frontmatter per-key 3-way (D1)", () => {
  it("@req:40b1be4d-0aae-4c1b-8047-998e7f3ebf8b non-overlapping scalar edits on different keys merge", () => {
    const base = asset({ label: "L0", extra: { ems__Effort_status: '"[[s0]]"' } });
    const local = asset({ label: "L1", extra: { ems__Effort_status: '"[[s0]]"' } });
    const remote = asset({ label: "L0", extra: { ems__Effort_status: '"[[s1]]"' } });
    const r = merger.mergeAsset({ path: "a.md", base, local, remote });
    expect(r.status).toBe("merged");
    if (r.status === "merged") {
      const fm = fmOf(r.content);
      expect(fm.exo__Asset_label).toBe("L1");
      expect(fm.ems__Effort_status).toBe("[[s1]]");
    }
  });

  it("same scalar key changed differently on both sides → conflict", () => {
    const base = asset({ label: "old" });
    const r = merger.mergeAsset({
      path: "a.md",
      base,
      local: asset({ label: "local!" }),
      remote: asset({ label: "remote!" }),
    });
    expect(r).toMatchObject({
      status: "conflict",
      reason: expect.stringMatching(/exo__Asset_label/),
    });
  });

  it("scalar key deleted on one side + modified on the other → conflict", () => {
    const base = asset({ label: "old" });
    const local = asset({}); // label deleted locally
    const remote = asset({ label: "edited remotely" });
    expect(merger.mergeAsset({ path: "a.md", base, local, remote }).status).toBe(
      "conflict",
    );
  });

  it("key added on both sides with the same value is convergent", () => {
    const base = asset({});
    const local = asset({ extra: { newKey: "same" } });
    const remote = asset({ extra: { newKey: "same" } });
    const r = merger.mergeAsset({ path: "a.md", base, local, remote });
    expect(r.status).toBe("merged");
    if (r.status === "merged") expect(fmOf(r.content).newKey).toBe("same");
  });
});

describe("StructuredMerger — multi-valued set-union with tombstones (D20)", () => {
  it("AC: alias deleted on A is NOT resurrected by untouched B", () => {
    const base = asset({ aliases: ["keep", "drop"] });
    const local = asset({ aliases: ["keep"] }); // deleted "drop"
    const remote = asset({ aliases: ["keep", "drop"], label: "remote edit" });
    const r = merger.mergeAsset({ path: "a.md", base, local, remote });
    expect(r.status).toBe("merged");
    if (r.status === "merged") {
      expect(fmOf(r.content).aliases).toEqual(["keep"]); // tombstone holds
      expect(fmOf(r.content).exo__Asset_label).toBe("remote edit");
    }
  });

  it("additions from both sides union (local order first), with a warning", () => {
    const base = asset({ aliases: ["a"] });
    const local = asset({ aliases: ["a", "from-local"] });
    const remote = asset({ aliases: ["a", "from-remote"] });
    const r = merger.mergeAsset({ path: "a.md", base, local, remote });
    expect(r.status).toBe("merged");
    if (r.status === "merged") {
      expect(fmOf(r.content).aliases).toEqual(["a", "from-local", "from-remote"]);
      expect(r.warnings.join(" ")).toMatch(/both sides added .*aliases/);
    }
  });

  it("delete-vs-modify granularity: remove one element + add another merges per-element", () => {
    const base = asset({ classes: ["[[c1]]", "[[c2]]"] });
    const local = asset({ classes: ["[[c1]]"] }); // removed c2
    const remote = asset({ classes: ["[[c1]]", "[[c2]]", "[[c3]]"] }); // added c3
    const r = merger.mergeAsset({ path: "a.md", base, local, remote });
    expect(r.status).toBe("merged");
    if (r.status === "merged") {
      expect(fmOf(r.content).exo__Instance_class).toEqual(["[[c1]]", "[[c3]]"]);
    }
  });

  it("cross-tombstones that strip ALL Instance_class values → conflict (typeless refuse)", () => {
    const base = asset({ classes: ["[[c1]]", "[[c2]]"] });
    const local = asset({ classes: ["[[c1]]"] }); // kept c1 only
    const remote = asset({ classes: ["[[c2]]"] }); // kept c2 only
    const r = merger.mergeAsset({ path: "a.md", base, local, remote });
    expect(r).toMatchObject({
      status: "conflict",
      reason: expect.stringMatching(/typeless/),
    });
  });

  it("one side intentionally emptying the key is allowed", () => {
    const base = asset({ aliases: ["x", "y"] });
    const local = asset({}); // aliases key deleted entirely
    const remote = asset({ aliases: ["x", "y", "z"] }); // added z
    const r = merger.mergeAsset({ path: "a.md", base, local, remote });
    expect(r.status).toBe("merged");
    if (r.status === "merged") {
      // per-element tombstones: x,y die; the genuinely new z survives
      expect(fmOf(r.content).aliases).toEqual(["z"]);
    }
  });

  it("date-like scalars survive untouched (codec CORE_SCHEMA contract)", () => {
    const base = asset({ extra: { exo__Asset_createdAt: "2026-06-09T15:46:48" }, label: "a" });
    const local = asset({ extra: { exo__Asset_createdAt: "2026-06-09T15:46:48" }, label: "b" });
    const remote = asset({
      extra: { exo__Asset_createdAt: "2026-06-09T15:46:48", newKey: "v" },
      label: "a",
    });
    const r = merger.mergeAsset({ path: "a.md", base, local, remote });
    expect(r.status).toBe("merged");
    if (r.status === "merged") {
      expect(fmOf(r.content).exo__Asset_createdAt).toBe("2026-06-09T15:46:48");
      expect(r.content).toMatch(/2026-06-09T15:46:48/);
    }
  });

  it("non-plain values (Date from a DEFAULT_SCHEMA codec) conflict fail-loud, never merge silently", () => {
    // A consumer codec violating the CORE_SCHEMA contract turns date-like
    // scalars into Date objects. deepEqual must NOT treat two DIFFERENT
    // Dates as equal (both have zero enumerable keys) — that would silently
    // collapse divergent timestamps into one side.
    const defaultSchemaMerger = new StructuredMerger({
      parse: (text) => yaml.load(text), // DEFAULT_SCHEMA → Date objects
      stringify: (value) => yaml.dump(value, { lineWidth: -1 }),
    });
    const doc = (ts: string): string =>
      `---\nexo__Asset_uid: u1\nexo__Asset_createdAt: ${ts}\n---\nbody\n`;

    const r = defaultSchemaMerger.mergeAsset({
      path: "a.md",
      base: doc("2026-06-09T15:46:48"),
      local: doc("2026-06-10T11:00:00"),
      remote: doc("2026-06-10T22:00:00"),
    });

    expect(r.status).toBe("conflict");
    if (r.status === "conflict") {
      expect(r.reason).toMatch(/non-plain value/);
      expect(r.reason).toMatch(/exo__Asset_createdAt/);
    }
  });
});

describe("StructuredMerger — body section merge (D21, not LWW)", () => {
  const bodied = (body: string): string => asset({ body });

  it("AC: different sections edited on each side both land", () => {
    const base = bodied("## One\n\nalpha\n\n## Two\n\nbeta");
    const local = bodied("## One\n\nalpha LOCAL\n\n## Two\n\nbeta");
    const remote = bodied("## One\n\nalpha\n\n## Two\n\nbeta REMOTE");
    const r = merger.mergeAsset({ path: "a.md", base, local, remote });
    expect(r.status).toBe("merged");
    if (r.status === "merged") {
      expect(r.content).toMatch(/alpha LOCAL/);
      expect(r.content).toMatch(/beta REMOTE/);
    }
  });

  it("same section, different paragraphs → paragraph-level merge", () => {
    const base = bodied("## S\n\npara one\n\npara two\n\npara three");
    const local = bodied("## S\n\npara one LOCAL\n\npara two\n\npara three");
    const remote = bodied("## S\n\npara one\n\npara two\n\npara three REMOTE");
    const r = merger.mergeAsset({ path: "a.md", base, local, remote });
    expect(r.status).toBe("merged");
    if (r.status === "merged") {
      expect(r.content).toMatch(/para one LOCAL/);
      expect(r.content).toMatch(/para two/);
      expect(r.content).toMatch(/para three REMOTE/);
    }
  });

  it("AC: same paragraph edited differently → conflict (quarantine, not LWW)", () => {
    const base = bodied("## S\n\nshared paragraph");
    const local = bodied("## S\n\nshared paragraph LOCAL");
    const remote = bodied("## S\n\nshared paragraph REMOTE");
    const r = merger.mergeAsset({ path: "a.md", base, local, remote });
    expect(r).toMatchObject({
      status: "conflict",
      reason: expect.stringMatching(/overlapping paragraph edits/),
    });
  });

  it("section deleted on one side + modified on the other → conflict", () => {
    const base = bodied("## Gone\n\nstuff\n\n## Stay\n\nok");
    const local = bodied("## Stay\n\nok");
    const remote = bodied("## Gone\n\nstuff EDITED\n\n## Stay\n\nok");
    const r = merger.mergeAsset({ path: "a.md", base, local, remote });
    expect(r).toMatchObject({
      status: "conflict",
      reason: expect.stringMatching(/deleted on one side/),
    });
  });

  it("sections added on each side both survive", () => {
    const base = bodied("## A\n\none");
    const local = bodied("## A\n\none\n\n## Local\n\nnew L");
    const remote = bodied("## Remote\n\nnew R\n\n## A\n\none");
    const r = merger.mergeAsset({ path: "a.md", base, local, remote });
    expect(r.status).toBe("merged");
    if (r.status === "merged") {
      expect(r.content).toMatch(/new L/);
      expect(r.content).toMatch(/new R/);
    }
  });

  it("heading inside a code fence does NOT split sections", () => {
    const fenced = "## Code\n\n```\n# not a heading\nline\n```\n\ntail";
    const base = bodied(fenced);
    const local = bodied(fenced.replace("tail", "tail LOCAL"));
    const remote = bodied(fenced.replace("line", "line REMOTE"));
    const r = merger.mergeAsset({ path: "a.md", base, local, remote });
    expect(r.status).toBe("merged");
    if (r.status === "merged") {
      expect(r.content).toMatch(/# not a heading/);
      expect(r.content).toMatch(/line REMOTE/);
      expect(r.content).toMatch(/tail LOCAL/);
      // fence integrity: still exactly two fence markers
      expect((r.content.match(/```/g) ?? []).length).toBe(2);
    }
  });

  it("duplicate heading with diverging counts → conflict (pairing unstable)", () => {
    const base = bodied("## Note\n\na\n\n## Note\n\nb");
    const local = bodied("## Note\n\nNEW\n\n## Note\n\na\n\n## Note\n\nb");
    const remote = bodied("## Note\n\na\n\n## Note\n\nb EDIT");
    const r = merger.mergeAsset({ path: "a.md", base, local, remote });
    expect(r).toMatchObject({
      status: "conflict",
      reason: expect.stringMatching(/duplicate heading/),
    });
  });

  it("preamble edits merge like a section", () => {
    const base = bodied("intro\n\n## A\n\nx");
    const local = bodied("intro LOCAL\n\n## A\n\nx");
    const remote = bodied("intro\n\n## A\n\nx REMOTE");
    const r = merger.mergeAsset({ path: "a.md", base, local, remote });
    expect(r.status).toBe("merged");
    if (r.status === "merged") {
      expect(r.content).toMatch(/intro LOCAL/);
      expect(r.content).toMatch(/x REMOTE/);
    }
  });
});

describe("splitSections", () => {
  it("join invariant holds", () => {
    const body = "pre\n\n# A\ntext\n\n## B\n\nmore\n";
    const sections = splitSections(body);
    expect(sections.map((s) => s.text).join("\n")).toBe(body);
  });

  it("body starting with a heading has no empty preamble", () => {
    const sections = splitSections("# A\nx");
    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBe("# A");
  });

  it("fences suppress heading detection", () => {
    const sections = splitSections("```\n# inside\n```\n# real\nx");
    expect(sections.map((s) => s.heading)).toEqual(["", "# real"]);
  });
});
