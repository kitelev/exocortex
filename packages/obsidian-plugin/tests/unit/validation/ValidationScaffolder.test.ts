/**
 * ValidationScaffolder tests (RFC f402002b, M1.5 plugin half). The scaffold
 * writes exactly the 4 validation-check setting__Setting instances, co-located
 * in the chosen ontology's folder, with the M1 default (uid-uniqueness ON, rest
 * OFF). The `trueCount === 1` assertion IS the revert-verify: flipping a second
 * default to true breaks it.
 */
import {
  ValidationScaffolder,
  SCAFFOLD_DEFAULTS,
  type ScaffoldFileWriter,
} from "../../../src/infrastructure/adapters/ValidationScaffolder";
import { CHECK_ID_UID_UNIQUENESS } from "@kitelev/exocortex-core";

function fakeWriter(): { writer: ScaffoldFileWriter; written: Map<string, string> } {
  const written = new Map<string, string>();
  return {
    written,
    writer: {
      exists: (path) => Promise.resolve(written.has(path)),
      write: (path, content) => {
        written.set(path, content);
        return Promise.resolve();
      },
    },
  };
}

describe("ValidationScaffolder", () => {
  const ONTOLOGY_UID = "abcd1234-0000-0000-0000-000000000000";
  const FOLDER = "assetspaces/kitelev/exoas-exo/exo";

  it("writes the 4 check-settings co-located in the chosen folder, exactly one true (uid-uniqueness), isDefinedBy=ontology — @req:0b7ce59c-0486-45b7-94a4-66f266484b1f", async () => {
    const { writer, written } = fakeWriter();
    let n = 0;
    const scaffolder = new ValidationScaffolder(
      writer,
      () => `uid-${n++}`,
      () => "2026-06-27T16:20:00+05:00",
    );

    const created = await scaffolder.scaffold(ONTOLOGY_UID, FOLDER);

    expect(created).toHaveLength(4);
    // co-located: every file under the chosen folder
    for (const c of created) expect(c.path.startsWith(`${FOLDER}/`)).toBe(true);

    // exactly one default is enabled, and it is uid-uniqueness (revert-verify anchor)
    const trueCount = created.filter((c) => c.value).length;
    expect(trueCount).toBe(1);
    const enabled = created.find((c) => c.value);
    expect(enabled?.checkId).toBe(CHECK_ID_UID_UNIQUENESS);

    // every written asset carries the chosen ontology as isDefinedBy + the setting class
    for (const content of written.values()) {
      expect(content).toContain(`exo__Asset_isDefinedBy: "[[${ONTOLOGY_UID}]]"`);
      expect(content).toContain(`"[[35cf35fb-935f-4d35-a150-939f29109aec]]"`);
      expect(content).toMatch(/setting__Setting_key: "\[\[[a-f0-9-]+\]\]"/);
    }
  });

  it("the M1 default is uid-uniqueness only (guards the safe default)", () => {
    const enabled = SCAFFOLD_DEFAULTS.filter((d) => d.value);
    expect(enabled).toHaveLength(1);
    expect(enabled[0].checkId).toBe(CHECK_ID_UID_UNIQUENESS);
  });

  it("never clobbers an existing asset (skips when the path already exists)", async () => {
    const { writer, written } = fakeWriter();
    written.set(`${FOLDER}/uid-0.md`, "PRE-EXISTING");
    const scaffolder = new ValidationScaffolder(
      writer,
      () => "uid-0", // collide on the first write only
      () => "2026-06-27T16:20:00+05:00",
    );
    const created = await scaffolder.scaffold(ONTOLOGY_UID, FOLDER);
    // the colliding write is skipped → fewer than 4, and the pre-existing file is untouched
    expect(written.get(`${FOLDER}/uid-0.md`)).toBe("PRE-EXISTING");
    expect(created.every((c) => c.path !== `${FOLDER}/uid-0.md`)).toBe(true);
  });
});
