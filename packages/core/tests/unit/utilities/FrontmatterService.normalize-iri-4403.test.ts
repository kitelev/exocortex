import { FrontmatterService } from "../../../src/utilities/FrontmatterService";
import { serializeYamlScalar } from "../../../src/utilities/yamlScalar";
import * as yaml from "js-yaml";

/**
 * Issue #4403 — `FrontmatterService.normalizeIRI` delegated to
 * `iriToObsidianName`, whose second shape (vault file URL → basename) is an
 * UNANCHORED `/\/([^/]+)\.md$/`. Past the "contains `#`" check, any string
 * value holding a `#` and ending in `/<name>.md` was rewritten to the wikilink
 * `[[<name>]]` — on the OBJECT write path (`applyPatch`, raw values) for any
 * such value, and on `updateProperty` for the ones its writers leave unquoted
 * (a `#/` URL; free text with ` #` is quoted by `serializeYamlScalar`).
 *
 * Measured 2026-09-26 on the three canonical vaults: 4 live values of this
 * shape, all `sess__LifecycleEvent_detail` free text in vault-exodev (a `#`
 * from a PR / issue number, a handoff path or a GitHub URL at the end). On
 * origin/main, handed RAW (as the object path hands it), one of them became
 * `"[[42812747]]"`.
 *
 * N1/N2 are the defect (both write paths), N3 the control that the legitimate
 * conversions still happen, N4 the key path. Mutants:
 * `FrontmatterService.normalize-iri-4403.spec.json`.
 */

/** The live shapes: `#` somewhere, a `/<name>.md` tail. */
const LIVE_SHAPES = [
  "#4263: requirement PROPOSED — https://github.com/kitelev/exoas-exo-reqs/blob/main/exo-reqs/42812747.md",
  "batch6l COMPLETED. PR #4293 merged. Handoff: /Users/kitelev/Developer/handoff-batch6m-facts.md",
  "https://e.com/#/docs/readme.md",
];

function writtenValue(content: string, key: string): unknown {
  const block = /^---\n([\s\S]*?)\n---/.exec(content);
  expect(block).not.toBeNull();
  return (yaml.load(block![1]) as Record<string, unknown>)[key];
}

describe("FrontmatterService.normalizeIRI — term IRIs only (issue #4403)", () => {
  const fm = new FrontmatterService();

  it("[N1] updateProperty keeps a value with `#` and a `/<name>.md` tail byte for byte", () => {
    // Writers that serialise first (`serializeYamlScalar`) quote free text with
    // ` #`, so for THEM only a `#/` URL (left plain) was rewritten. ⛔ Not every
    // writer serialises: `PropertyEditorModal` and an undeclared
    // `property_set` substitution hand RAW text, which main turned into
    // `[[<name>]]` too — the branch keeps the bytes (what YAML then reads of an
    // unquoted ` #` is a separate, pre-existing matter). The 4 live values were
    // also exposed on the object path (N2).
    for (const value of LIVE_SHAPES) {
      const written = fm.updateProperty(
        "---\nexo__Asset_uid: u1\n---\nBody\n",
        "sess__LifecycleEvent_detail",
        serializeYamlScalar(value),
      );
      expect({ value, written: writtenValue(written, "sess__LifecycleEvent_detail") }).toEqual({
        value,
        written: value,
      });
    }
  });

  it("[N2] applyPatch (the object write path) keeps the same values untouched", () => {
    for (const value of LIVE_SHAPES) {
      const target: Record<string, unknown> = {};
      FrontmatterService.applyPatch(target, { sess__LifecycleEvent_detail: value });
      expect({ value, patched: target.sess__LifecycleEvent_detail }).toEqual({
        value,
        patched: value,
      });
    }
  });

  it("[N3] control: a term IRI and a vault file IRI still become wikilinks", () => {
    expect(
      FrontmatterService.normalizeIRIValue(
        "https://exocortex.my/ontology/ems#EffortStatusDone",
      ),
    ).toBe('"[[ems__EffortStatusDone]]"');
    expect(
      FrontmatterService.normalizeIRIValue(
        "http://www.w3.org/2000/01/rdf-schema#subClassOf",
      ),
    ).toBe('"[[rdfs__subClassOf]]"');
    expect(FrontmatterService.normalizeIRIValue("obsidian://vault/a/b.md")).toBe(
      '"[[b]]"',
    );
  });

  it("[N4] the key path: a term IRI key is canonicalised, a `#…/<name>.md` key is not", () => {
    expect(
      FrontmatterService.normalizeIRI(
        "https://exocortex.my/ontology/ems#Effort_status",
      ),
    ).toBe("ems__Effort_status");
    expect(FrontmatterService.normalizeIRI("note #1 /a/b.md")).toBe(
      "note #1 /a/b.md",
    );
    expect(FrontmatterService.normalizeIRI("obsidian://vault/a/b.md")).toBe(
      "obsidian://vault/a/b.md",
    );
  });
});
