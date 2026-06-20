import { describe, it, expect } from "@jest/globals";
import {
  parsePriority,
  parseBindingClasses,
  parseStatus,
  extractReqTags,
  auditTraceability,
  requirementsAuditCommand,
  type RequirementRecord,
  type TagOccurrence,
} from "../../../src/commands/requirements-audit.js";
import { requirementsCommand } from "../../../src/commands/requirements.js";

const UID_A = "449f29ce-cbd5-4ac8-94d4-28aa56a013c2";
const UID_B = "830ef788-0631-42cf-8b78-481ec6cfdeac";
const UID_C = "a863ecc1-9230-4457-880b-d3a18b33494f";
const UID_D = "f640c8f8-3d29-43da-8610-0187ac488876";

function req(partial: Partial<RequirementRecord> & { uid: string }): RequirementRecord {
  return {
    label: `req ${partial.uid}`,
    path: `exo-reqs/${partial.uid}.md`,
    priority: "P0",
    bindingClasses: ["integration"],
    status: "Draft",
    ...partial,
  };
}

function tag(uid: string, file = "a.test.ts", line = 1): TagOccurrence {
  return { uid, file, line };
}

describe("requirements — Commander wiring", () => {
  it("registers 'audit' under the 'requirements' parent command", () => {
    const parent = requirementsCommand();
    expect(parent.name()).toBe("requirements");
    const sub = parent.commands.find((c) => c.name() === "audit");
    expect(sub).toBeDefined();
  });

  it("audit subcommand declares --reqs (required) + --tests + --output + --strict", () => {
    const sub = requirementsAuditCommand();
    expect(sub.name()).toBe("audit");
    const opts = sub.options.map((o) => o.long);
    expect(opts).toContain("--reqs");
    expect(opts).toContain("--tests");
    expect(opts).toContain("--output");
    expect(opts).toContain("--strict");
    const reqsOpt = sub.options.find((o) => o.long === "--reqs");
    expect(reqsOpt?.required).toBe(true);
  });
});

describe("parsePriority", () => {
  it("parses P0 from an aliased enum wikilink", () => {
    expect(parsePriority("[[01d50c3d-ade2-4b5f-a35c-f9fd120debd3|req__RequirementPriorityP0]]")).toBe("P0");
  });
  it("parses P3", () => {
    expect(parsePriority("[[uid|req__RequirementPriorityP3]]")).toBe("P3");
  });
  it("returns null for a strip-canon (no alias) wikilink", () => {
    expect(parsePriority("[[01d50c3d-ade2-4b5f-a35c-f9fd120debd3]]")).toBeNull();
  });
  it("returns null for empty / non-string", () => {
    expect(parsePriority(undefined)).toBeNull();
    expect(parsePriority([])).toBeNull();
    expect(parsePriority(42)).toBeNull();
  });
});

describe("parseBindingClasses", () => {
  it("maps each enum local-name to a canonical class token", () => {
    expect(
      parseBindingClasses([
        "[[u1|req__RequirementBindingClassUnit]]",
        "[[u2|req__RequirementBindingClassIntegration]]",
        "[[u3|req__RequirementBindingClassE2e]]",
        "[[u4|req__RequirementBindingClassGuiBdd]]",
      ]),
    ).toEqual(["unit", "integration", "e2e", "gui-bdd"]);
  });
  it("ignores free-text (non-enum) bindingClass entries", () => {
    expect(
      parseBindingClasses([
        "[[u1|req__RequirementBindingClassUnit]]",
        "eka-gui link-label scenario (PR #3622, gui-bdd) — floor binding",
      ]),
    ).toEqual(["unit"]);
  });
  it("accepts a scalar value", () => {
    expect(parseBindingClasses("[[u|req__RequirementBindingClassIntegration]]")).toEqual([
      "integration",
    ]);
  });
  it("returns [] when nothing parses", () => {
    expect(parseBindingClasses(undefined)).toEqual([]);
    expect(parseBindingClasses("no enum here")).toEqual([]);
  });
});

describe("parseStatus", () => {
  it("parses lifecycle local-name", () => {
    expect(parseStatus("[[uid|req__RequirementStatusDraft]]")).toBe("Draft");
    expect(parseStatus("[[uid|req__RequirementStatusApproved]]")).toBe("Approved");
  });
  it("returns null when absent", () => {
    expect(parseStatus(undefined)).toBeNull();
  });
});

describe("extractReqTags", () => {
  it("extracts a @req tag from an it() title with the right line number", () => {
    const content = [
      "describe('x', () => {",
      `  it("@req:${UID_A} does the thing", () => {});`,
      "});",
    ].join("\n");
    const occ = extractReqTags("x.test.ts", content);
    expect(occ).toEqual([{ uid: UID_A, file: "x.test.ts", line: 2 }]);
  });

  it("extracts multiple tags including two on the same line", () => {
    const content = `it("@req:${UID_A} and @req:${UID_B}", () => {});`;
    const occ = extractReqTags("x.test.ts", content);
    expect(occ.map((o) => o.uid)).toEqual([UID_A, UID_B]);
    expect(occ.every((o) => o.line === 1)).toBe(true);
  });

  it("lower-cases the captured uid (case-insensitive binding)", () => {
    const occ = extractReqTags("x.test.ts", `it("@req:${UID_A.toUpperCase()}", () => {});`);
    expect(occ[0].uid).toBe(UID_A);
  });

  it("returns [] when there is no tag", () => {
    expect(extractReqTags("x.test.ts", "it('plain', () => {});")).toEqual([]);
  });
});

describe("auditTraceability — coverage + orphans", () => {
  it("reports all bound with 100% coverage when every requirement has a tag", () => {
    const reqs = [req({ uid: UID_A }), req({ uid: UID_B })];
    const r = auditTraceability(reqs, [tag(UID_A), tag(UID_B, "b.test.ts")]);
    expect(r.requirementCount).toBe(2);
    expect(r.bound).toBe(2);
    expect(r.coverage).toBe(1);
    expect(r.orphans).toHaveLength(0);
    expect(r.clean).toBe(true);
  });

  it("reports an unbound requirement as an orphan (warning, still clean)", () => {
    const reqs = [req({ uid: UID_A }), req({ uid: UID_B })];
    const r = auditTraceability(reqs, [tag(UID_A)]);
    expect(r.bound).toBe(1);
    expect(r.coverage).toBe(0.5);
    expect(r.orphans.map((o) => o.uid)).toEqual([UID_B]);
    // orphan is a warning — does not make the report dirty
    expect(r.clean).toBe(true);
  });

  it("coverage is 1 for an empty requirement set (no division by zero)", () => {
    const r = auditTraceability([], []);
    expect(r.coverage).toBe(1);
    expect(r.clean).toBe(true);
  });
});

describe("auditTraceability — dangling tags (hard)", () => {
  it("flags a tag whose uid resolves to no requirement", () => {
    const r = auditTraceability([req({ uid: UID_A })], [
      tag(UID_A),
      tag(UID_C, "stale.test.ts", 9),
    ]);
    expect(r.dangling).toEqual([{ uid: UID_C, file: "stale.test.ts", line: 9 }]);
    expect(r.clean).toBe(false);
  });
});

describe("auditTraceability — duplicate bindings (warning)", () => {
  it("flags a uid claimed by >1 distinct test occurrence", () => {
    const reqs = [req({ uid: UID_A })];
    const r = auditTraceability(reqs, [
      tag(UID_A, "one.test.ts", 3),
      tag(UID_A, "two.test.ts", 4),
    ]);
    expect(r.duplicates).toHaveLength(1);
    expect(r.duplicates[0].uid).toBe(UID_A);
    expect(r.duplicates[0].occurrences).toHaveLength(2);
    // duplicate is a warning, not a hard finding
    expect(r.clean).toBe(true);
  });

  it("does not flag a single binding as duplicate", () => {
    const r = auditTraceability([req({ uid: UID_A })], [tag(UID_A)]);
    expect(r.duplicates).toHaveLength(0);
  });

  it("a dangling uid claimed twice is dangling, not a duplicate binding", () => {
    const r = auditTraceability([], [tag(UID_C), tag(UID_C, "b.test.ts")]);
    expect(r.duplicates).toHaveLength(0);
    expect(r.dangling).toHaveLength(2);
  });
});

describe("auditTraceability — binding-class floor (P0, hard)", () => {
  it("flags a P0 requirement bound solely to unit", () => {
    const reqs = [req({ uid: UID_D, priority: "P0", bindingClasses: ["unit"] })];
    const r = auditTraceability(reqs, [tag(UID_D)]);
    expect(r.floorViolations).toHaveLength(1);
    expect(r.floorViolations[0].uid).toBe(UID_D);
    expect(r.clean).toBe(false);
  });

  it("passes a P0 requirement with unit + a real-prod class", () => {
    const reqs = [
      req({ uid: UID_B, priority: "P0", bindingClasses: ["unit", "gui-bdd"] }),
    ];
    const r = auditTraceability(reqs, [tag(UID_B)]);
    expect(r.floorViolations).toHaveLength(0);
    expect(r.clean).toBe(true);
  });

  it("does not apply the floor to P1+ requirements", () => {
    const reqs = [req({ uid: UID_D, priority: "P1", bindingClasses: ["unit"] })];
    const r = auditTraceability(reqs, [tag(UID_D)]);
    expect(r.floorViolations).toHaveLength(0);
    expect(r.clean).toBe(true);
  });

  it("fails open when bindingClass is empty (nothing to judge)", () => {
    const reqs = [req({ uid: UID_A, priority: "P0", bindingClasses: [] })];
    const r = auditTraceability(reqs, [tag(UID_A)]);
    expect(r.floorViolations).toHaveLength(0);
  });

  it("counts unparseable priority as a fail-open skip", () => {
    const reqs = [req({ uid: UID_A, priority: null, bindingClasses: ["unit"] })];
    const r = auditTraceability(reqs, [tag(UID_A)]);
    expect(r.unknownPriority).toBe(1);
    expect(r.floorViolations).toHaveLength(0);
  });
});
