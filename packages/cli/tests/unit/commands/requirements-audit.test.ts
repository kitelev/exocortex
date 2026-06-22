import { describe, it, expect } from "@jest/globals";
import {
  parsePriority,
  parseBindingClasses,
  parseStatus,
  parseEvidence,
  extractReqTags,
  auditTraceability,
  isHardFail,
  requirementsAuditCommand,
  type RequirementRecord,
  type TagOccurrence,
  type TraceabilityReport,
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
    evidence: [],
    evidenceMissing: [],
    ...partial,
  };
}

function tag(uid: string, file = "a.test.ts", line = 1): TagOccurrence {
  return { uid, file, line };
}

/**
 * A `@req` tag living in a GUI-in-CI runner (`eka-gui`) spec — the AUTOMATED
 * ui-acceptance sub-mode (al-gui-ci-runner dedup). Path mirrors the real
 * `packages/obsidian-plugin/tests/e2e/eka-gui/*.spec.ts` runner location.
 */
function guiTag(
  uid: string,
  file = "packages/obsidian-plugin/tests/e2e/eka-gui/create-instance-buttons.spec.ts",
  line = 1,
): TagOccurrence {
  return { uid, file, line };
}

describe("requirements — Commander wiring", () => {
  it("registers 'audit' under the 'requirements' parent command", () => {
    const parent = requirementsCommand();
    expect(parent.name()).toBe("requirements");
    const sub = parent.commands.find((c) => c.name() === "audit");
    expect(sub).toBeDefined();
  });

  it("audit subcommand declares --reqs (required) + --tests + --output + --strict + --gate", () => {
    const sub = requirementsAuditCommand();
    expect(sub.name()).toBe("audit");
    const opts = sub.options.map((o) => o.long);
    expect(opts).toContain("--reqs");
    expect(opts).toContain("--tests");
    expect(opts).toContain("--output");
    expect(opts).toContain("--strict");
    expect(opts).toContain("--gate");
    const reqsOpt = sub.options.find((o) => o.long === "--reqs");
    expect(reqsOpt?.required).toBe(true);
    // --gate defaults to "soft" so the CI flip is a one-flag change.
    const gateOpt = sub.options.find((o) => o.long === "--gate");
    expect(gateOpt?.defaultValue).toBe("soft");
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
        "[[u5|req__RequirementBindingClassUiAcceptance]]",
      ]),
    ).toEqual(["unit", "integration", "e2e", "gui-bdd", "ui-acceptance"]);
  });

  it("maps the PUBLISHED ui-acceptance enum IRI (exoas-req 9709619c) to ui-acceptance", () => {
    // Pins the contract against the real enum asset's local-name (so a rename in
    // exoas-req cannot silently break the ui-acceptance exemption + P0 floor).
    expect(
      parseBindingClasses(
        "[[9709619c-e16d-4501-89ed-3c2abd6af87d|req__RequirementBindingClassUiAcceptance]]",
      ),
    ).toEqual(["ui-acceptance"]);
  });
  it("maps the component enum local-name to a distinct `component` token (not collapsed into unit)", () => {
    // SDD-hardening A: component (.test.tsx / jsdom) is its own tier, parsed to
    // "component" — NOT "unit". Pins the contract against the real exoas-req enum
    // asset's local-name (req__RequirementBindingClassComponent, aefdb1a3).
    expect(
      parseBindingClasses(
        "[[aefdb1a3-ae87-4d4e-93fb-fb989a243c0c|req__RequirementBindingClassComponent]]",
      ),
    ).toEqual(["component"]);
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
  it("parses the SDD feature-lifecycle statuses (proposed/active)", () => {
    expect(parseStatus("[[uid|req__RequirementStatusProposed]]")).toBe("Proposed");
    expect(parseStatus("[[uid|req__RequirementStatusActive]]")).toBe("Active");
    expect(parseStatus("[[uid|req__RequirementStatusDeprecated]]")).toBe("Deprecated");
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

  // SDD-hardening A (al-night-component): `component` (.test.tsx / jsdom) is a
  // distinct binding-class classified BELOW the real-prod floor — like `unit`,
  // a jsdom component test does not exercise live production. This is the
  // binding for req 547ef066. Revert-verified: temporarily adding "component"
  // to REAL_PROD_CLASSES makes assertions (2)/(3) FAIL (no floor violation);
  // restored → PASS (RFC 0003 §3.6).
  it("@req:547ef066-9155-4ec2-9893-fdc31c4674ea recognizes component as a distinct binding class and treats it as below the P0 real-prod floor", () => {
    // (1) component is parsed to a distinct token — NOT collapsed into "unit"
    expect(
      parseBindingClasses(
        "[[aefdb1a3-ae87-4d4e-93fb-fb989a243c0c|req__RequirementBindingClassComponent]]",
      ),
    ).toEqual(["component"]);

    // (2) a P0 requirement bound SOLELY to component → floor violation
    const solely = auditTraceability(
      [req({ uid: UID_D, priority: "P0", bindingClasses: ["component"] })],
      [tag(UID_D)],
    );
    expect(solely.floorViolations.map((f) => f.uid)).toEqual([UID_D]);
    expect(solely.clean).toBe(false);

    // (3) component + unit (both below-floor) → STILL a floor violation
    const bothBelow = auditTraceability(
      [req({ uid: UID_D, priority: "P0", bindingClasses: ["component", "unit"] })],
      [tag(UID_D)],
    );
    expect(bothBelow.floorViolations).toHaveLength(1);

    // (4) component + a real-prod class (integration) → floor satisfied
    const withRealProd = auditTraceability(
      [req({ uid: UID_D, priority: "P0", bindingClasses: ["component", "integration"] })],
      [tag(UID_D)],
    );
    expect(withRealProd.floorViolations).toHaveLength(0);
    expect(withRealProd.clean).toBe(true);
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

describe("auditTraceability — P0 checklist + ramp-readiness (RFC 0003 §3.7)", () => {
  it("counts P0 totals and ramp is ready when every P0 is bound with a real-prod floor", () => {
    const reqs = [
      req({ uid: UID_A, priority: "P0", bindingClasses: ["integration"] }),
      req({ uid: UID_B, priority: "P0", bindingClasses: ["e2e"] }),
      // a P1 requirement does not arm/disarm the ramp
      req({ uid: UID_C, priority: "P1", bindingClasses: ["unit"] }),
    ];
    const r = auditTraceability(reqs, [tag(UID_A), tag(UID_B), tag(UID_C)]);
    expect(r.p0Total).toBe(2);
    expect(r.p0Bound).toBe(2);
    expect(r.p0Orphans).toBe(0);
    expect(r.rampReady).toBe(true);
  });

  it("is NOT ramp-ready when a P0 requirement is unbound (orphan)", () => {
    const reqs = [
      req({ uid: UID_A, priority: "P0" }),
      req({ uid: UID_B, priority: "P0" }),
    ];
    const r = auditTraceability(reqs, [tag(UID_A)]); // UID_B unbound
    expect(r.p0Total).toBe(2);
    expect(r.p0Bound).toBe(1);
    expect(r.p0Orphans).toBe(1);
    expect(r.rampReady).toBe(false);
    // ...but a P0 orphan is still only a warning for `clean` (soft gate)
    expect(r.clean).toBe(true);
  });

  it("is NOT ramp-ready when a P0 binding-class floor is violated", () => {
    const reqs = [req({ uid: UID_A, priority: "P0", bindingClasses: ["unit"] })];
    const r = auditTraceability(reqs, [tag(UID_A)]);
    expect(r.p0Bound).toBe(1);
    expect(r.floorViolations).toHaveLength(1);
    expect(r.rampReady).toBe(false);
  });

  it("is NOT ramp-ready when a tag is dangling", () => {
    const reqs = [req({ uid: UID_A, priority: "P0" })];
    const r = auditTraceability(reqs, [tag(UID_A), tag(UID_D, "stale.test.ts", 7)]);
    expect(r.dangling).toHaveLength(1);
    expect(r.rampReady).toBe(false);
  });

  it("is NOT ramp-ready (fail-safe) when there are no P0 requirements at all", () => {
    const reqs = [req({ uid: UID_A, priority: "P1" })];
    const r = auditTraceability(reqs, [tag(UID_A)]);
    expect(r.p0Total).toBe(0);
    expect(r.rampReady).toBe(false);
  });

  it("a P1 orphan does not disarm the ramp (only P0 arms it)", () => {
    const reqs = [
      req({ uid: UID_A, priority: "P0" }),
      req({ uid: UID_B, priority: "P1" }), // unbound P1 — not part of the checklist
    ];
    const r = auditTraceability(reqs, [tag(UID_A)]);
    expect(r.p0Orphans).toBe(0);
    expect(r.rampReady).toBe(true);
  });
});

describe("isHardFail — soft/hard exit-code contract (P3 flip)", () => {
  /** Build a minimal clean+ramp-ready report, override fields per case. */
  function report(over: Partial<TraceabilityReport> = {}): TraceabilityReport {
    return {
      requirementCount: 1,
      tagCount: 1,
      bound: 1,
      manuallyVerified: 0,
      coverage: 1,
      orphans: [],
      dangling: [],
      duplicates: [],
      floorViolations: [],
      unknownPriority: 0,
      clean: true,
      activeTotal: 0,
      activeViolations: [],
      p0Total: 1,
      p0Bound: 1,
      p0Orphans: 0,
      rampReady: true,
      ...over,
    };
  }

  it("a clean ramp-ready report never fails, in either mode", () => {
    expect(isHardFail(report(), "soft", false)).toBe(false);
    expect(isHardFail(report(), "hard", false)).toBe(false);
  });

  it("hard findings (not clean) fail in BOTH modes", () => {
    const dirty = report({
      clean: false,
      dangling: [{ uid: UID_C, file: "x.test.ts", line: 1 }],
      rampReady: false,
    });
    expect(isHardFail(dirty, "soft", false)).toBe(true);
    expect(isHardFail(dirty, "hard", false)).toBe(true);
  });

  it("a P0 coverage gap (clean but not ramp-ready) fails ONLY in hard mode", () => {
    const gap = report({ p0Bound: 0, p0Orphans: 1, rampReady: false });
    // soft: a P0 orphan is a warning — does not fail
    expect(isHardFail(gap, "soft", false)).toBe(false);
    // hard: the P3 gate blocks on the coverage gap
    expect(isHardFail(gap, "hard", false)).toBe(true);
  });

  it("--strict fails on any orphan in soft mode (back-compat)", () => {
    const orphaned = report({
      orphans: [{ uid: UID_B, label: "b", path: "p" }],
      // a non-P0 orphan keeps ramp-ready true, so only --strict catches it
      rampReady: true,
    });
    expect(isHardFail(orphaned, "soft", false)).toBe(false);
    expect(isHardFail(orphaned, "soft", true)).toBe(true);
  });

  it("an active-requirement invariant violation fails in BOTH modes (always-on)", () => {
    // clean is false when activeViolations is non-empty (auditTraceability sets
    // it); a report with the violation must block regardless of gate mode — the
    // SDD invariant is independent of the soft→hard P0 ramp.
    const v = report({
      clean: false,
      activeTotal: 1,
      activeViolations: [
        { uid: UID_A, label: "active req", path: "p", reason: "no @req binding" },
      ],
      // ramp is otherwise fine — only the active-gate is tripped
      rampReady: true,
    });
    expect(isHardFail(v, "soft", false)).toBe(true);
    expect(isHardFail(v, "hard", false)).toBe(true);
  });
});

describe("auditTraceability — active-requirement invariant (SDD feature-lifecycle)", () => {
  it("an active requirement WITH a @req binding is satisfied (no violation, clean)", () => {
    const reqs = [req({ uid: UID_A, status: "Active" })];
    const r = auditTraceability(reqs, [tag(UID_A)]);
    expect(r.activeTotal).toBe(1);
    expect(r.activeViolations).toHaveLength(0);
    expect(r.clean).toBe(true);
  });

  it("an active requirement with NO binding is an invariant violation (hard, not clean)", () => {
    const reqs = [req({ uid: UID_A, status: "Active", bindingClasses: ["unit"] })];
    const r = auditTraceability(reqs, []); // no @req tag
    expect(r.activeTotal).toBe(1);
    expect(r.activeViolations.map((a) => a.uid)).toEqual([UID_A]);
    expect(r.clean).toBe(false);
    // also surfaces as an orphan (the informational view), but the active-gate
    // is the hard one
    expect(r.orphans.map((o) => o.uid)).toEqual([UID_A]);
  });

  it("an active ui-acceptance requirement WITH resolving committed evidence is satisfied — no violation", () => {
    const reqs = [
      req({
        uid: UID_A,
        status: "Active",
        bindingClasses: ["ui-acceptance"],
        evidence: ["evidence/a.md"],
        evidenceMissing: [], // resolves
      }),
    ];
    const r = auditTraceability(reqs, []); // no jest tag — manual tier
    expect(r.activeTotal).toBe(1);
    expect(r.activeViolations).toHaveLength(0);
    expect(r.clean).toBe(true);
  });

  it("an active ui-acceptance requirement WITHOUT evidence is an invariant violation (hard, not clean)", () => {
    // RFC 0003 §3.6 evidence-attestation (al-night-uiaccept): the ui-acceptance
    // binding IS the recorded evidence — an active ui-acceptance req must link a
    // resolving committed artifact, else the tier is a "trust the prose" no-op.
    const reqs = [
      req({ uid: UID_A, status: "Active", bindingClasses: ["ui-acceptance"] }),
    ];
    const r = auditTraceability(reqs, []); // no jest tag, no evidence
    expect(r.activeTotal).toBe(1);
    expect(r.activeViolations.map((a) => a.uid)).toEqual([UID_A]);
    expect(r.activeViolations[0].reason).toMatch(/evidence/i);
    expect(r.clean).toBe(false);
  });

  it("an active ui-acceptance requirement with a DANGLING (non-resolving) evidence link is a violation", () => {
    const reqs = [
      req({
        uid: UID_A,
        status: "Active",
        bindingClasses: ["ui-acceptance"],
        evidence: ["evidence/gone.md"],
        evidenceMissing: ["evidence/gone.md"], // declared but not committed
      }),
    ];
    const r = auditTraceability(reqs, []);
    expect(r.activeViolations.map((a) => a.uid)).toEqual([UID_A]); // active gate
    expect(r.danglingEvidence.map((e) => e.uid)).toEqual([UID_A]); // also dangling
    expect(r.clean).toBe(false);
  });

  it("@req:58326e2f-2b89-49f2-af1d-78829fd78b57 an active ui-acceptance requirement bound by a GUI-in-CI runner (eka-gui) @req tag is satisfied WITHOUT committed evidence (AUTOMATED sub-mode)", () => {
    // al-gui-ci-runner dedup: a `@req` binding in an eka-gui runner spec IS the
    // auto-evidence (the eka-gui run drives real plugin UI on native-amd64 CI),
    // so the active ui-acceptance req is satisfied without a hand-written
    // committed attestation. ONE engine — no parallel ui-acceptance runner.
    const reqs = [
      req({ uid: UID_A, status: "Active", bindingClasses: ["ui-acceptance"] }),
    ];
    const r = auditTraceability(reqs, [guiTag(UID_A)]); // eka-gui-bound → automated
    expect(r.activeViolations).toHaveLength(0);
    expect(r.uiAcceptanceAutomated).toBe(1);
    expect(r.uiAcceptanceManual).toBe(0);
    expect(r.clean).toBe(true);
  });

  it("an active ui-acceptance requirement bound ONLY by a NON-GUI @req tag, no committed evidence, is an invariant violation (revert-verify: a jsdom/CLI tag cannot auto-evidence a live-UI acceptance)", () => {
    // Closes the `if (isBound) continue;` hole: before al-gui-ci-runner, ANY
    // @req tag (even in a unit/jsdom test) satisfied an active ui-acceptance req.
    // A non-GUI tag is not a live-UI run → it does NOT auto-evidence the tier.
    // REVERT-VERIFY: restoring the broad `if (isBound) continue;` for the
    // ui-acceptance branch makes this expectation FAIL (the unit-test tag would
    // spuriously satisfy the req); the al-gui-ci-runner logic makes it PASS.
    const reqs = [
      req({ uid: UID_A, status: "Active", bindingClasses: ["ui-acceptance"] }),
    ];
    const r = auditTraceability(reqs, [tag(UID_A)]); // non-GUI unit-test tag only
    expect(r.activeViolations.map((a) => a.uid)).toEqual([UID_A]);
    expect(r.activeViolations[0].reason).toMatch(/eka-gui|live-UI/i);
    expect(r.uiAcceptanceAutomated).toBe(0);
    expect(r.clean).toBe(false);
  });

  it("an active ui-acceptance requirement satisfied by committed evidence (no GUI-runner tag) counts as MANUAL sub-mode", () => {
    const reqs = [
      req({
        uid: UID_A,
        status: "Active",
        bindingClasses: ["ui-acceptance"],
        evidence: ["evidence/a.md"],
        evidenceMissing: [],
      }),
    ];
    const r = auditTraceability(reqs, []); // no tag — manual committed evidence
    expect(r.activeViolations).toHaveLength(0);
    expect(r.uiAcceptanceAutomated).toBe(0);
    expect(r.uiAcceptanceManual).toBe(1);
    expect(r.clean).toBe(true);
  });

  it("a ui-acceptance req with BOTH a GUI-runner tag AND committed evidence counts as automated (reproducible verification wins)", () => {
    const reqs = [
      req({
        uid: UID_A,
        status: "Active",
        bindingClasses: ["ui-acceptance"],
        evidence: ["evidence/a.md"],
        evidenceMissing: [],
      }),
    ];
    const r = auditTraceability(reqs, [guiTag(UID_A)]);
    expect(r.activeViolations).toHaveLength(0);
    expect(r.uiAcceptanceAutomated).toBe(1);
    expect(r.uiAcceptanceManual).toBe(0);
  });

  it("a PROPOSED requirement with no binding is NOT an active violation (only an orphan warning)", () => {
    // priority P2 isolates the active-gate from the P0 binding-class floor.
    const reqs = [
      req({ uid: UID_A, status: "Proposed", priority: "P2", bindingClasses: ["unit"] }),
    ];
    const r = auditTraceability(reqs, []);
    expect(r.activeTotal).toBe(0);
    expect(r.activeViolations).toHaveLength(0);
    // proposed-unbound is a (non-blocking) orphan, not an active-gate violation
    expect(r.orphans.map((o) => o.uid)).toEqual([UID_A]);
    expect(r.clean).toBe(true);
  });

  it("is vacuous when zero requirements are active (forward-only safety)", () => {
    const reqs = [
      req({ uid: UID_A, status: "Proposed" }),
      req({ uid: UID_B, status: "Approved" }),
    ];
    const r = auditTraceability(reqs, []); // none bound, none active
    expect(r.activeTotal).toBe(0);
    expect(r.activeViolations).toHaveLength(0);
    expect(r.clean).toBe(true); // active-gate does not fire
  });

  it("a non-canonically-cased active status still trips the gate (case-insensitive)", () => {
    // defense-in-depth: a hand-authored `...Statusactive` must not silently escape.
    const reqs = [req({ uid: UID_A, status: "active", bindingClasses: ["unit"] })];
    const r = auditTraceability(reqs, []);
    expect(r.activeTotal).toBe(1);
    expect(r.activeViolations.map((a) => a.uid)).toEqual([UID_A]);
  });

  it("counts only the unbound active reqs as violations (mixed set)", () => {
    const reqs = [
      req({ uid: UID_A, status: "Active" }), // bound below → ok
      req({ uid: UID_B, status: "Active", bindingClasses: ["unit"] }), // unbound → violation
      req({ uid: UID_C, status: "Proposed" }), // proposed unbound → not a violation
    ];
    const r = auditTraceability(reqs, [tag(UID_A)]);
    expect(r.activeTotal).toBe(2);
    expect(r.activeViolations.map((a) => a.uid)).toEqual([UID_B]);
    expect(r.clean).toBe(false);
  });
});

describe("auditTraceability — ui-acceptance verification tier (RFC 0003 §3.6)", () => {
  it("a ui-acceptance requirement with NO jest tag is manually-verified, not an orphan", () => {
    const reqs = [req({ uid: UID_A, bindingClasses: ["ui-acceptance"] })];
    const r = auditTraceability(reqs, []); // no @req tag at all
    expect(r.orphans).toHaveLength(0);
    expect(r.manuallyVerified).toBe(1);
    expect(r.bound).toBe(0);
    expect(r.coverage).toBe(1); // (bound 0 + manual 1) / 1
    expect(r.clean).toBe(true);
  });

  it("a P0 ui-acceptance requirement is covered (does NOT block the ramp)", () => {
    const reqs = [
      req({ uid: UID_A, priority: "P0", bindingClasses: ["integration"] }),
      req({ uid: UID_B, priority: "P0", bindingClasses: ["ui-acceptance"] }),
    ];
    const r = auditTraceability(reqs, [tag(UID_A)]); // only UID_A jest-bound
    expect(r.p0Total).toBe(2);
    expect(r.p0Bound).toBe(2); // UID_B covered by manual ui-acceptance
    expect(r.p0Orphans).toBe(0);
    expect(r.rampReady).toBe(true);
  });

  it("ui-acceptance satisfies the P0 binding-class floor (real-prod-exercising)", () => {
    const reqs = [req({ uid: UID_A, priority: "P0", bindingClasses: ["ui-acceptance"] })];
    const r = auditTraceability(reqs, []);
    expect(r.floorViolations).toHaveLength(0);
  });

  it("a ui-acceptance requirement that ALSO has a jest tag counts as jest-bound", () => {
    const reqs = [
      req({ uid: UID_A, bindingClasses: ["ui-acceptance", "integration"] }),
    ];
    const r = auditTraceability(reqs, [tag(UID_A)]);
    expect(r.bound).toBe(1);
    expect(r.manuallyVerified).toBe(0); // jest tag takes precedence in the count
    expect(r.orphans).toHaveLength(0);
  });

  it("a plain (non-ui-acceptance) requirement with no tag is STILL an orphan", () => {
    const reqs = [req({ uid: UID_A, bindingClasses: ["unit"] })];
    const r = auditTraceability(reqs, []);
    expect(r.orphans.map((o) => o.uid)).toEqual([UID_A]);
    expect(r.manuallyVerified).toBe(0);
  });

  it("a P0 [ui-acceptance, integration] req with NO jest tag is manually-verified (not orphan, floor met)", () => {
    const reqs = [
      req({ uid: UID_A, priority: "P0", bindingClasses: ["ui-acceptance", "integration"] }),
    ];
    const r = auditTraceability(reqs, []); // no jest tag
    expect(r.manuallyVerified).toBe(1);
    expect(r.orphans).toHaveLength(0);
    expect(r.floorViolations).toHaveLength(0);
    expect(r.p0Bound).toBe(1);
    expect(r.rampReady).toBe(true);
  });
});

describe("parseEvidence", () => {
  it("parses a scalar evidence path", () => {
    expect(parseEvidence("evidence/a.md")).toEqual(["evidence/a.md"]);
  });

  it("parses a list of evidence paths", () => {
    expect(parseEvidence(["evidence/a.md", "evidence/b.png"])).toEqual([
      "evidence/a.md",
      "evidence/b.png",
    ]);
  });

  it("trims and drops blank entries", () => {
    expect(parseEvidence(["  evidence/a.md  ", "", "   "])).toEqual([
      "evidence/a.md",
    ]);
  });

  it("returns [] for null / non-string", () => {
    expect(parseEvidence(undefined)).toEqual([]);
    expect(parseEvidence(null)).toEqual([]);
    expect(parseEvidence(42)).toEqual([]);
  });
});

describe("auditTraceability — evidence-attestation (RFC 0003 §3.6, al-night-uiaccept)", () => {
  it("flags a declared evidence link that does not resolve (danglingEvidence, hard)", () => {
    const reqs = [
      req({
        uid: UID_A,
        status: "Proposed",
        priority: "P2",
        bindingClasses: ["ui-acceptance"],
        evidence: ["evidence/gone.md"],
        evidenceMissing: ["evidence/gone.md"],
      }),
    ];
    const r = auditTraceability(reqs, []);
    expect(r.danglingEvidence.map((e) => e.uid)).toEqual([UID_A]);
    expect(r.danglingEvidence[0].missing).toEqual(["evidence/gone.md"]);
    expect(r.clean).toBe(false);
  });

  it("a resolving evidence link is NOT dangling", () => {
    const reqs = [
      req({
        uid: UID_A,
        status: "Proposed",
        priority: "P2",
        bindingClasses: ["ui-acceptance"],
        evidence: ["evidence/a.md"],
        evidenceMissing: [],
      }),
    ];
    const r = auditTraceability(reqs, []);
    expect(r.danglingEvidence).toHaveLength(0);
    expect(r.clean).toBe(true);
  });

  it("danglingEvidence applies to ANY req that declares evidence, not just ui-acceptance", () => {
    const reqs = [
      req({
        uid: UID_A,
        status: "Proposed",
        priority: "P2",
        bindingClasses: ["unit"],
        evidence: ["evidence/missing.png"],
        evidenceMissing: ["evidence/missing.png"],
      }),
    ];
    const r = auditTraceability(reqs, []);
    expect(r.danglingEvidence.map((e) => e.uid)).toEqual([UID_A]);
    expect(r.clean).toBe(false);
  });

  it("reports ui-acceptance evidence coverage stats", () => {
    const reqs = [
      req({
        uid: UID_A,
        bindingClasses: ["ui-acceptance"],
        evidence: ["evidence/a.md"],
        evidenceMissing: [],
      }),
      req({ uid: UID_B, bindingClasses: ["ui-acceptance"] }), // no evidence
      req({ uid: UID_C, bindingClasses: ["integration"] }), // not ui-acceptance
    ];
    const r = auditTraceability(reqs, []);
    expect(r.uiAcceptanceTotal).toBe(2);
    expect(r.uiAcceptanceEvidenced).toBe(1);
    expect(r.uiAcceptanceMissingEvidence).toBe(1);
  });

  it("a Proposed ui-acceptance req with no evidence is reported but does NOT block (warning, clean)", () => {
    // evidence is HARD only for the in-force `active` subset (migration-friendly).
    const reqs = [
      req({
        uid: UID_A,
        status: "Proposed",
        priority: "P2",
        bindingClasses: ["ui-acceptance"],
      }),
    ];
    const r = auditTraceability(reqs, []);
    expect(r.uiAcceptanceMissingEvidence).toBe(1);
    expect(r.activeViolations).toHaveLength(0);
    expect(r.clean).toBe(true);
  });
});
