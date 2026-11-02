/**
 * ems__Bug 6b4d2533 — a bare `18:00` written under a property with NO declared
 * range reached the graph as the integer 1080.
 *
 * The product's reader (js-yaml 5.3.0 `YAML11_SCHEMA`) reads the YAML 1.1-only
 * numbers — the sexagesimal form (`18:00` → 1080, `1:2:3` → 3723,
 * `1:30.5` → 90.5) and `+.5` — as numbers, while Obsidian (YAML 1.2 core)
 * keeps them as the string the author typed. The writer kept them bare unless
 * the property was string-semantic or `xsd:string`-ranged, so
 * `create --property 'kitelev-okr__KitelevPartOfDayOKR_startTime=18:00'` gave
 * `"1080"^^xsd:integer` in the graph (measured 2026-11-02 on a copy of the
 * personal bot's vault, CLI v17.17.1).
 *
 * The fix quotes such a NUMBER when the property's range is unknown. Axes
 * Y1–Y4 pin the fix through the two new-asset serializers; Y5–Y9 pin what must
 * NOT change: forms both readers agree on, a datetime, declared decimal /
 * integer ranges, and the 1.1 booleans (req 21ceea14, axis R19 control).
 * Mutants: `yamlScalar.yaml11-only-6b4d2533.spec.json`.
 */
import { needsYamlQuoting } from "../../src/utilities/yamlScalar";
import { FrontmatterService } from "../../src/utilities/FrontmatterService";
import { MetadataHelpers } from "../../src/utilities/MetadataHelpers";
import { parseFrontmatterAsReader } from "@kitelev/exocortex-test-utils";

const KEY = "kitelev-okr__KitelevPartOfDayOKR_startTime";
const SEXAGESIMAL = ["18:00", "24:00", "00:30", "1:2:3", "1:30.5"];
const YAML11_ONLY_NUMBERS = [...SEXAGESIMAL, "+.5"];

describe("ems__Bug 6b4d2533 — YAML 1.1-only numbers under an unknown range", () => {
  it.each(SEXAGESIMAL)(
    "Y1 sexagesimal %s is quoted when no range is known",
    (value) => {
      expect(needsYamlQuoting(value)).toBe(true);
    },
  );

  it("Y2 +.5 (a number only to YAML 1.1) is quoted when no range is known", () => {
    expect(needsYamlQuoting("+.5")).toBe(true);
  });

  it("Y3 create path (FrontmatterService.createFrontmatter) round-trips the typed string", () => {
    const service = new FrontmatterService();
    for (const value of YAML11_ONLY_NUMBERS) {
      const created = service.createFrontmatter("", { [KEY]: value });
      expect(created).toContain(`${KEY}: "${value}"`);
      expect(parseFrontmatterAsReader(created)[KEY]).toBe(value);
    }
  });

  it("Y4 MetadataHelpers.buildFileContent round-trips the typed string", () => {
    for (const value of YAML11_ONLY_NUMBERS) {
      const content = MetadataHelpers.buildFileContent({ [KEY]: value });
      expect(content).toContain(`${KEY}: "${value}"`);
      expect(parseFrontmatterAsReader(content)[KEY]).toBe(value);
    }
  });

  it("Y5 forms both readers agree on stay bare and keep their type", () => {
    const service = new FrontmatterService();
    const agreed: Array<[string, unknown]> = [
      ["3", 3],
      ["1.5", 1.5],
      ["true", true],
    ];
    for (const [value, typed] of agreed) {
      expect(needsYamlQuoting(value)).toBe(false);
      const created = service.createFrontmatter("", { [KEY]: value });
      expect(created).toContain(`${KEY}: ${value}`);
      expect(parseFrontmatterAsReader(created)[KEY]).toBe(typed);
    }
    for (const value of [
      "null",
      "2026-11-02",
      "1e5",
      "08",
      "0x1F",
      "Вечер 2026-11-02",
    ]) {
      expect(needsYamlQuoting(value)).toBe(false);
    }
  });

  it("Y6 a datetime stays bare (timestamps must stay xsd:dateTime)", () => {
    const service = new FrontmatterService();
    const value = "2026-11-02T18:00:00";
    expect(needsYamlQuoting(value)).toBe(false);
    expect(service.createFrontmatter("", { [KEY]: value })).toContain(
      `${KEY}: ${value}`,
    );
  });

  it("Y7 a declared xsd:decimal range keeps a sexagesimal float bare (typing decided by the range)", () => {
    expect(needsYamlQuoting("1:30.5", false, ["xsd:decimal"])).toBe(false);
  });

  it("Y8 a declared xsd:integer range keeps a sexagesimal value bare (typing decided by the range)", () => {
    expect(needsYamlQuoting("18:00", false, ["xsd:integer"])).toBe(false);
  });

  it.each(["yes", "no", "Off", "y", "N"])(
    "Y9 the YAML 1.1 boolean %s stays bare on an untyped property (req 21ceea14, R19 control)",
    (value) => {
      expect(needsYamlQuoting(value)).toBe(false);
    },
  );
});
