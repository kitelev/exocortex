/**
 * @req:af71d01c-8790-4dc5-b01c-f35239bb5c87
 *
 * obsplugin__Setting export — Periodic Notes pilot (RFC f402002b, M4.1).
 * Exercises the REAL M2 engine (`exportSettings`) over the obsplugin Periodic
 * Notes source built from a parsed `data.json` fixture; the rendered asset
 * markdown is re-parsed (production-shape — the test reads exactly what the
 * export wrote, not handcrafted frontmatter). Revert-verified: neutralising the
 * dot-path accessor (`resolveConfigPath`) makes the live-value assertions RED.
 */
import * as yaml from "js-yaml";
import { exportSettings } from "../../../../src/services/settings";
import {
  OBSPLUGIN_SETTING_CLASS_UID,
  PERIODIC_NOTES_DECLARED_KEYS,
  buildPeriodicNotesSource,
  resolveConfigPath,
} from "../../../../src/services/settings/obsPluginSource";

/** A realistic Periodic Notes `data.json` (shape mirrors a live install). */
const FIXTURE = {
  showGettingStartedBanner: true,
  hasMigratedDailyNoteSettings: false,
  daily: {
    format: "YYYY-MM-DD [Note]",
    template: "09 Templates/periodic-notes/{{Daily Note}}.md",
    folder: "assetspaces/kitelev",
    enabled: true,
  },
  weekly: { format: "", folder: "x/y", template: "", enabled: true },
};

/** Re-parse the frontmatter of one rendered `obsplugin__Setting` asset. */
function parseFrontmatter(content: string): Record<string, unknown> {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (m === null) throw new Error("rendered asset has no frontmatter");
  return yaml.load(m[1]) as Record<string, unknown>;
}

describe("obsplugin Periodic Notes settings export (M4.1)", () => {
  it("@req:af71d01c-8790-4dc5-b01c-f35239bb5c87 exports each declared Daily-Notes key into an obsplugin__Setting asset carrying the dot-path live value + key ref", () => {
    const source = buildPeriodicNotesSource(FIXTURE);
    const assets = exportSettings(source, {
      ontologyUid: "ont-1234",
      nowIso: "2026-06-28T00:00:00.000Z",
    });

    // One asset per declared key — no more (allowlist-by-construction).
    expect(assets).toHaveLength(PERIODIC_NOTES_DECLARED_KEYS.length);
    const byField = new Map(
      assets.map((a) => [a.field, parseFrontmatter(a.content)]),
    );

    const folder = byField.get("daily.folder")!;
    // Typed obsplugin__Setting, co-located under the chosen ontology, fixed uid.
    expect(folder["exo__Instance_class"]).toEqual([
      `[[${OBSPLUGIN_SETTING_CLASS_UID}]]`,
    ]);
    expect(folder["exo__Asset_isDefinedBy"]).toBe("[[ont-1234]]");
    expect(folder["exo__Asset_uid"]).toBe(
      "2bb137e5-b2c7-4fc8-b234-60639de674a9",
    );
    expect(folder["setting__Setting_key"]).toBe(
      "[[6ba6a073-3ee9-4527-8958-34596e072a31]]",
    );
    // The M4.1 heart: dot-path `daily.folder` → the live value from data.json.
    expect(folder["setting__Setting_value"]).toBe("assetspaces/kitelev");

    expect(byField.get("daily.format")!["setting__Setting_value"]).toBe(
      "YYYY-MM-DD [Note]",
    );
    expect(byField.get("daily.template")!["setting__Setting_value"]).toBe(
      "09 Templates/periodic-notes/{{Daily Note}}.md",
    );
    // boolean datatype round-trips as a real boolean (not a string).
    expect(byField.get("daily.enabled")!["setting__Setting_value"]).toBe(true);

    // The fixed deterministic basenames (byte-identical across devices).
    const fileNames = assets.map((a) => a.fileName).sort();
    expect(fileNames).toEqual([
      "2bb137e5-b2c7-4fc8-b234-60639de674a9.md",
      "411646dd-1a87-40d8-853d-01c37af7fb2c.md",
      "5430a6c5-6be5-483e-bb94-d740d6dd2541.md",
      "6ed5cfdf-551b-49bc-a467-56756b822da5.md",
    ]);
  });

  it("@req:af71d01c-8790-4dc5-b01c-f35239bb5c87 allowlist-by-construction: only declared daily.* keys exported — never weekly.* / banner / arbitrary live keys", () => {
    const source = buildPeriodicNotesSource(FIXTURE);
    const assets = exportSettings(source, { ontologyUid: "o", nowIso: "t" });
    expect(assets.map((a) => a.field).sort()).toEqual([
      "daily.enabled",
      "daily.folder",
      "daily.format",
      "daily.template",
    ]);
    // weekly.* + showGettingStartedBanner present in fixture but NOT declared.
    expect(assets.some((a) => a.field.startsWith("weekly"))).toBe(false);
  });

  describe("resolveConfigPath (dot-path accessor)", () => {
    it("resolves nested paths to their live value", () => {
      expect(resolveConfigPath(FIXTURE, "daily.folder")).toBe(
        "assetspaces/kitelev",
      );
      expect(resolveConfigPath(FIXTURE, "daily.enabled")).toBe(true);
    });

    it("returns undefined for a missing segment or non-object traversal", () => {
      expect(resolveConfigPath(FIXTURE, "daily.nope")).toBeUndefined();
      expect(resolveConfigPath(FIXTURE, "missing.x")).toBeUndefined();
      expect(resolveConfigPath(null, "a.b")).toBeUndefined();
      expect(resolveConfigPath("scalar", "a")).toBeUndefined();
    });

    it("reads own properties only — inherited / prototype segments yield undefined", () => {
      expect(resolveConfigPath({}, "__proto__")).toBeUndefined();
      expect(resolveConfigPath({}, "constructor")).toBeUndefined();
      expect(resolveConfigPath({ daily: {} }, "daily.toString")).toBeUndefined();
    });
  });
});
