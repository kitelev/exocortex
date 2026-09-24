/**
 * Ticket d8c3c86b — `create` / `set-property` must refuse an
 * `exo__Asset_isDefinedBy` whose target RESOLVES but is not an `exo__Ontology`.
 *
 * The incident: the ExoAssistant bot, asked for a sleep task "by the matching
 * prototype", put the PROTOTYPE into the anchor. `create` validated that the
 * wikilink resolves and never checked the property's declared RANGE, so it
 * exited 0 — and `beb2600c` carried an `sh:class` violation for 15 days,
 * holding vault-my's SHACL baseline red.
 *
 * ⛤ V1/V3/V4/V9 drive the REAL pair, read off the data repo's git history
 * (`exoas-my`): commit `5ff28539` wrote
 * `exo__Asset_isDefinedBy: "[[628bc0e5-…]]"` and the repair `6a5e4fce` replaced
 * it with `[[a2f5ac16-…]]`. On the live vault `628bc0e5` ("Сон") is an instance
 * of `868c2297` (a session prototype) and `a2f5ac16` ("$kitelev") is an instance
 * of `829b9b3b` — the ontology class itself. So the refusal and the control are
 * the two sides of one real repair, not invented values.
 *
 * ⛔ The guard must NOT touch the four fail-open forms co-location declares.
 * Measured over the three canonical vaults they cover 745 live assets
 * `[three canonical vaults, index 40,953 assets, 2026-09-24]`: `!`-anchors 699,
 * property absent 45, unresolvable 1, empty 0. Assets the guard would refuse on
 * that corpus: 0 — the data was repaired (ticket b80442aa), so the defect is off
 * the corpus but still on the WRITE path. V6/V7 pin two of those forms.
 *
 * Revert-verify (req b2f31fcb-6cac-41c3-a0c4-40387c4cf57c): un-wiring either command reddens that
 * command's axes; emptying the guard reddens all four refusal axes; dropping the
 * subsumption walk reddens V8; dropping either fail-open reddens V6 / V7;
 * skipping the guard under --dry-run reddens V3.
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const { createCommand } = await import("../../src/commands/create.js");
const { setPropertyCommand } = await import("../../src/commands/set-property.js");

const ONTOLOGY_CLASS = "829b9b3b-6fc3-4276-be6a-27d3398c012e";
/** The real anchor the repair pointed at ("$kitelev"). */
const ANCHOR_UID = "a2f5ac16-5c1d-4463-a092-04e85e1ed20f";
/** The real prototype the bot mistakenly passed ("Сон"). */
const PROTOTYPE_UID = "628bc0e5-e26b-4609-8e09-64cb46e785c1";
/** Its class on the live vault — a session prototype, not an ontology. */
const PROTOTYPE_CLASS_UID = "868c2297-42ac-4397-bac1-465a1ef793b8";
/** A class whose superClass IS the ontology class — subsumption must accept it. */
const SUB_ONTOLOGY_CLASS_UID = "11111111-2222-4333-8444-555555555555";
const SUB_ONTOLOGY_ANCHOR_UID = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const NOTE_CLASS_UID = "65b58c34-7451-4b89-bea3-483f7c65fe73"; // pass-through
const TARGET_UID = "d1d1d1d1-0000-4000-8000-000000000001";

const DIR = "assetspaces/kitelev/exoas-my/kitelev";

describe("Ticket d8c3c86b: isDefinedBy must resolve to an exo__Ontology", () => {
  let vault: string;
  let exitSpy: ReturnType<typeof jest.spyOn>;
  let stdoutSpy: ReturnType<typeof jest.spyOn>;
  let stderrSpy: ReturnType<typeof jest.spyOn>;
  let logSpy: ReturnType<typeof jest.spyOn>;
  let errorSpy: ReturnType<typeof jest.spyOn>;
  let stdoutChunks: string[];
  let stderrChunks: string[];
  let errChunks: string[];
  let exitCodes: number[];

  const targetRel = `${DIR}/${TARGET_UID}.md`;
  const targetAbs = (): string => path.join(vault, targetRel);

  function writeAsset(uid: string, front: string): void {
    fs.writeFileSync(
      path.join(vault, DIR, `${uid}.md`),
      `---\nexo__Asset_uid: ${uid}\n${front}---\nbody\n`,
      "utf-8",
    );
  }

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-d8c3c86b-"));
    fs.mkdirSync(path.join(vault, DIR), { recursive: true });
    fs.mkdirSync(path.join(vault, "01 Inbox"), { recursive: true });

    // The ontology class itself, the real anchor, the real prototype and its class.
    writeAsset(ONTOLOGY_CLASS, `exo__Asset_label: exo__Ontology\n`);
    writeAsset(
      ANCHOR_UID,
      `exo__Asset_label: $kitelev\nexo__Instance_class:\n  - "[[${ONTOLOGY_CLASS}]]"\n`,
    );
    writeAsset(PROTOTYPE_CLASS_UID, `exo__Asset_label: ems__SessionPrototype\n`);
    writeAsset(
      PROTOTYPE_UID,
      `exo__Asset_label: Сон\nexo__Instance_class:\n  - "[[${PROTOTYPE_CLASS_UID}]]"\n`,
    );
    // A subclass of the ontology class + an anchor typed with it (subsumption).
    writeAsset(
      SUB_ONTOLOGY_CLASS_UID,
      `exo__Asset_label: test__ScopedOntology\nexo__Class_superClass:\n  - "[[${ONTOLOGY_CLASS}]]"\n`,
    );
    writeAsset(
      SUB_ONTOLOGY_ANCHOR_UID,
      `exo__Asset_label: $scoped\nexo__Instance_class:\n  - "[[${SUB_ONTOLOGY_CLASS_UID}]]"\n`,
    );
    // The asset set-property repoints.
    fs.writeFileSync(
      targetAbs(),
      `---\nexo__Asset_uid: ${TARGET_UID}\nexo__Asset_label: "A note"\n` +
        `exo__Asset_isDefinedBy: "[[${ANCHOR_UID}]]"\n---\nbody\n`,
      "utf-8",
    );

    stdoutChunks = [];
    stderrChunks = [];
    errChunks = [];
    exitCodes = [];
    exitSpy = jest.spyOn(process, "exit").mockImplementation(((code?: number) => {
      exitCodes.push(code ?? 0);
      return undefined as never;
    }) as never);
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(((c: unknown) => {
        stdoutChunks.push(String(c));
        return true;
      }) as never);
    stderrSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation(((c: unknown) => {
        stderrChunks.push(String(c));
        return true;
      }) as never);
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(((...a: unknown[]) => {
        errChunks.push(a.map(String).join(" "));
      }) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    fs.rmSync(vault, { recursive: true, force: true });
  });

  const GUARD_MSG = /must reference an exo__Ontology/;

  async function runCreate(anchor: string, extra: string[] = []): Promise<void> {
    await createCommand().parseAsync(
      [
        "--class",
        NOTE_CLASS_UID,
        "--label",
        "Sleep session",
        "--vault",
        vault,
        "--property",
        `exo__Asset_isDefinedBy=${anchor}`,
        ...extra,
      ],
      { from: "user" },
    );
  }

  function inboxCount(): number {
    return fs.readdirSync(path.join(vault, "01 Inbox")).length;
  }

  it("V1: create refuses the REAL prototype the bot passed (628bc0e5) and creates nothing @req:b2f31fcb-6cac-41c3-a0c4-40387c4cf57c", async () => {
    const before = inboxCount();
    const dirBefore = fs.readdirSync(path.join(vault, DIR)).length;
    await runCreate(`[[${PROTOTYPE_UID}]]`);
    const err = errChunks.join("\n");
    expect(err).toMatch(GUARD_MSG);
    expect(err).toContain(PROTOTYPE_CLASS_UID); // names the target's class
    expect(exitCodes).not.toContain(0);
    expect(inboxCount()).toBe(before);
    expect(fs.readdirSync(path.join(vault, DIR)).length).toBe(dirBefore);
  });

  it("V2: create with the REAL anchor the repair used ($kitelev) still works @req:b2f31fcb-6cac-41c3-a0c4-40387c4cf57c", async () => {
    await runCreate(`[[${ANCHOR_UID}]]`);
    expect(errChunks.join("\n")).not.toMatch(GUARD_MSG);
    expect(stdoutChunks.join("")).toContain("uuid");
  });

  it("V3: create --dry-run refuses BEFORE the preview — no preview, nothing written @req:b2f31fcb-6cac-41c3-a0c4-40387c4cf57c", async () => {
    // The guard must precede the dry-run branch, not just the write: a guard
    // wired only into the write path leaves the preview accepting the value,
    // and V1 (which runs without --dry-run) cannot see that.
    const before = inboxCount();
    await runCreate(`[[${PROTOTYPE_UID}]]`, ["--dry-run"]);
    expect(errChunks.join("\n")).toMatch(GUARD_MSG);
    expect(exitCodes).not.toContain(0);
    expect(stderrChunks.join("")).not.toContain("DRY RUN PREVIEW");
    expect(inboxCount()).toBe(before);
  });

  it("V4: set-property refuses a repoint onto the prototype, file byte-identical @req:b2f31fcb-6cac-41c3-a0c4-40387c4cf57c", async () => {
    const before = fs.readFileSync(targetAbs());
    await setPropertyCommand().parseAsync(
      [
        targetRel,
        "--vault",
        vault,
        "--property",
        "exo__Asset_isDefinedBy",
        "--value",
        `[[${PROTOTYPE_UID}]]`,
      ],
      { from: "user" },
    );
    expect(errChunks.join("\n")).toMatch(GUARD_MSG);
    expect(exitCodes).not.toContain(0);
    expect(fs.readFileSync(targetAbs()).equals(before)).toBe(true);
  });

  it("V5: set-property accepts a repoint onto a real ontology @req:b2f31fcb-6cac-41c3-a0c4-40387c4cf57c", async () => {
    await setPropertyCommand().parseAsync(
      [
        targetRel,
        "--vault",
        vault,
        "--property",
        "exo__Asset_isDefinedBy",
        "--value",
        `[[${SUB_ONTOLOGY_ANCHOR_UID}]]`,
      ],
      { from: "user" },
    );
    expect(errChunks.join("\n")).not.toMatch(GUARD_MSG);
    expect(fs.readFileSync(targetAbs(), "utf-8")).toContain(SUB_ONTOLOGY_ANCHOR_UID);
  });

  it("V6: a `!`-prefixed anchor stays legal — 699 live assets carry one @req:b2f31fcb-6cac-41c3-a0c4-40387c4cf57c", async () => {
    await runCreate("[[!kitelev]]", ["--skip-wikilink-validation"]);
    expect(errChunks.join("\n")).not.toMatch(GUARD_MSG);
    expect(stdoutChunks.join("")).toContain("uuid");
  });

  it("V7: an unresolvable anchor stays legal (fail-open, as co-location declares) @req:b2f31fcb-6cac-41c3-a0c4-40387c4cf57c", async () => {
    await runCreate("[[99999999-0000-4000-8000-000000000000]]", [
      "--skip-wikilink-validation",
    ]);
    expect(errChunks.join("\n")).not.toMatch(GUARD_MSG);
    expect(stdoutChunks.join("")).toContain("uuid");
  });

  it("V8: an anchor typed with a SUBCLASS of exo__Ontology is accepted (subsumption, not equality) @req:b2f31fcb-6cac-41c3-a0c4-40387c4cf57c", async () => {
    await runCreate(`[[${SUB_ONTOLOGY_ANCHOR_UID}]]`);
    expect(errChunks.join("\n")).not.toMatch(GUARD_MSG);
    expect(stdoutChunks.join("")).toContain("uuid");
  });

  it("V9: the second door — set-property --input — is guarded too @req:b2f31fcb-6cac-41c3-a0c4-40387c4cf57c", async () => {
    const before = fs.readFileSync(targetAbs());
    await setPropertyCommand().parseAsync(
      [
        targetRel,
        "--vault",
        vault,
        "--input",
        JSON.stringify({
          property: "exo__Asset_isDefinedBy",
          value: `[[${PROTOTYPE_UID}]]`,
        }),
      ],
      { from: "user" },
    );
    expect(errChunks.join("\n")).toMatch(GUARD_MSG);
    expect(fs.readFileSync(targetAbs()).equals(before)).toBe(true);
  });
});
