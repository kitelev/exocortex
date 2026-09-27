/**
 * Data-guard (issue #4358) — asserts the REAL `packages/exoas-exocmd` data creates a
 * narrower concept HOMOICONICALLY: `create_instance` driven by PropertyDefault +
 * InheritanceRule, with no TypeScript service in the path.
 *
 * ⛤ Why this file exists at all. Until 2026-09-27 the command was a homoiconic
 * WRAPPER over `ConceptCreationService.generateConceptFrontmatter` — the command was
 * data, the semantics (which properties a new concept gets) were code. That violates
 * the Homoiconicity Invariant Q1, and the founder called it out directly. The service
 * was then deleted, which removes the two mutant specs that used to lock its
 * behaviour (`concept-folder-4357.service`, `concept-namespace-45895b5f.service`).
 *
 * ⛔ Those guarantees are not dropped — they MOVE here, because the mechanism moved:
 *
 * | old axis (service) | what it locked | where it lives now |
 * |---|---|---|
 * | C5 / C6 | created beside the parent, not in a hardcoded `concepts/` | H4 (`targetFolder`) |
 * | C7 / C9 / C10 | the parent's anchor is inherited | H5 (`inheritanceRule`) |
 * | C1 | genus written under the CANONICAL `concept__` key, not retired `ims__` | H6 (PropertyDefault → property UID) |
 * | C2 | definition written under the canonical key | H7 (`inputSchema` key) |
 * | C3 | the asset is typed as a Concept | H3 (`targetClass`) |
 *
 * ⚠ ONE guarantee is genuinely not carried over, and it is named rather than hidden:
 * old C8 locked a FALLBACK anchor (`inheritedAnchor ?? "[[!concepts]]"`) for a parent
 * with no `exo__Asset_isDefinedBy`. `InheritanceRule` has no fallback. Measured
 * 2026-09-27: **0 of 3183** concepts lack an anchor (canary: the same query returns
 * 3183 with the filter dropped), and the co-location invariant plus SHACL forbid that
 * state anyway — so the branch guarded a condition the data cannot reach.
 */
import * as fs from "fs";
import * as path from "path";
import { parseYamlFrontmatterTolerant } from "../../../src/utilities/parseYamlFrontmatter";

const SUBMODULE_EXOCMD = path.resolve(
  __dirname,
  "../../../../exoas-exocmd/exocmd",
);

/** The command a user clicks / `apply`s. */
const CMD_NARROWER = "f13ed9d8-c344-427c-a83e-e46586e3912e";
/** Its grounding since #4358 — homoiconic. */
const GROUNDING_CREATE = "85c40d1e-02b7-43c6-832b-d0b481ed19fb";
/** The grounding it replaced — `service_call` into TypeScript. */
const GROUNDING_SERVICE_CALL = "e6500fe3-241a-4ba9-aaa0-1ab8a8e0b866";

const TYPE_CREATE_INSTANCE = "4367e2d6-6c92-450a-becb-abce1fb07682";
const CLASS_CONCEPT = "dda12c48-6886-4624-8710-ed4ba92ce2b3";
/** InheritanceRule: isDefinedBy→isDefinedBy (unconditional, prio 10) — pre-existing. */
const RULE_INHERIT_ANCHOR = "cbe000c4-b29a-4405-876d-790fb2296121";
/** PropertyDefault: concept__Concept_genus = $target. */
const PD_GENUS = "f1ef295a-be32-4b52-994e-0d89aa0ae78c";
const PROP_GENUS = "06d389ff-f54f-4272-b3b6-5efb0f0638d3";
const TOKEN_TARGET = "4c4b6a77-9cbf-4ec1-a615-3b33e4fd7c1f";
/** The metaclass that marks the old grounding retired. */
const CLASS_DEPRECATED_ASSET = "8eb223b1-5a8d-4ae5-9746-d7f879b2b5a6";

function readAsset(uid: string): string {
  const file = path.join(SUBMODULE_EXOCMD, `${uid}.md`);
  if (!fs.existsSync(file)) {
    throw new Error(
      `exoas-exocmd asset ${uid}.md not found at ${file} — is the submodule checked out? ` +
        "(a fresh worktree carries none; `git submodule update --init`)",
    );
  }
  return fs.readFileSync(file, "utf-8");
}

/**
 * ⛤ `parseYamlFrontmatterTolerant` takes the YAML BLOCK, not the whole file — feeding
 * it the markdown yields an empty parse and every axis below would read "" and fail
 * for the same non-reason. The block is cut here and the parser is production's own.
 */
function frontmatter(uid: string): Record<string, unknown> {
  const content = readAsset(uid);
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match) throw new Error(`${uid}.md has no frontmatter block`);
  const parsed = parseYamlFrontmatterTolerant(match[1], `${uid}.md`);
  if (parsed === null) throw new Error(`${uid}.md frontmatter did not parse`);
  return parsed;
}

/** Every value of a key, whether it is scalar or a list. */
function values(fm: Record<string, unknown>, key: string): string[] {
  const raw = fm[key];
  if (raw === undefined || raw === null) return [];
  return (Array.isArray(raw) ? raw : [raw]).map(String);
}

describe("narrower-concept creation is homoiconic (exoas-exocmd data-guard) (#4358)", () => {
  it("H1 the command points at the create_instance grounding, not the service_call one", () => {
    const fm = frontmatter(CMD_NARROWER);
    const grounding = values(fm, "exocmd__Command_grounding").join(" ");
    expect(grounding).toContain(GROUNDING_CREATE);
    expect(grounding).not.toContain(GROUNDING_SERVICE_CALL);
  });

  it("H2 that grounding is create_instance — no service_call anywhere in the path", () => {
    const fm = frontmatter(GROUNDING_CREATE);
    expect(values(fm, "exocmd__Grounding_type").join(" ")).toContain(
      TYPE_CREATE_INSTANCE,
    );
    // A service_call grounding is identified by this key; its absence is what
    // makes "no TypeScript in the path" checkable rather than asserted.
    expect(fm["exocmd__Grounding_serviceId"]).toBeUndefined();
  });

  it("H3 the created asset is typed as concept__Concept (was old C3)", () => {
    expect(values(frontmatter(GROUNDING_CREATE), "exocmd__Grounding_targetClass").join(" "))
      .toContain(CLASS_CONCEPT);
  });

  it("H4 the concept lands beside its parent, not in a hardcoded folder (was old C5/C6)", () => {
    const folder = values(
      frontmatter(GROUNDING_CREATE),
      "exocmd__Grounding_targetFolder",
    ).join(" ");
    expect(folder).toContain("$");
    // The exact defect #4357 fixed: a literal top-level folder sits outside every
    // assetspace and is therefore never carried by ExoSync.
    expect(folder).not.toMatch(/^concepts\/?$/);
  });

  it("H5 the parent's anchor is inherited via the shared InheritanceRule (was old C7/C9/C10)", () => {
    expect(values(frontmatter(GROUNDING_CREATE), "exocmd__Grounding_inheritanceRule").join(" "))
      .toContain(RULE_INHERIT_ANCHOR);
  });

  it("H6 genus is set from the click-target through a PropertyDefault (was old C1)", () => {
    expect(values(frontmatter(GROUNDING_CREATE), "exocmd__Grounding_propertyDefault").join(" "))
      .toContain(PD_GENUS);

    // ⛤ Asserted through the property's UID, not its spelling: that is exactly what
    // makes the retired `ims__` namespace unrepresentable here.
    const pd = frontmatter(PD_GENUS);
    expect(values(pd, "exocmd__PropertyDefault_property").join(" ")).toContain(PROP_GENUS);
    expect(values(pd, "exocmd__PropertyDefault_value").join(" ")).toContain(TOKEN_TARGET);
  });

  it("H7 the inputSchema key for the definition is the CANONICAL property name (was old C2)", () => {
    const schema = String(
      frontmatter(GROUNDING_CREATE)["exocmd__Grounding_inputSchema"] ?? "",
    );
    const parsed = JSON.parse(schema) as {
      properties?: Record<string, unknown>;
    };
    const keys = Object.keys(parsed.properties ?? {});

    expect(keys).toContain("concept__Concept_definition");
    // ⛔ Load-bearing: `create_instance` writes schema keys into frontmatter AS IS
    // (the #3798 normaliser only knows `label`/`parent`). A bare `definition` key
    // therefore produces a SECOND, non-canonical property beside the real one —
    // measured on a throwaway concept before this was fixed.
    expect(keys).not.toContain("definition");
  });

  it("H8 control — the superseded service_call grounding is retired, not still live", () => {
    const fm = frontmatter(GROUNDING_SERVICE_CALL);
    expect(values(fm, "exo__Instance_class").join(" ")).toContain(
      CLASS_DEPRECATED_ASSET,
    );
    expect(values(fm, "exo__DeprecatedAsset_deprecatedBy").join(" ")).toContain(
      GROUNDING_CREATE,
    );
  });
});
