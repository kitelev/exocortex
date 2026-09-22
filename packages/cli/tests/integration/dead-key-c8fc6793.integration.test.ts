/**
 * Ticket c8fc6793 — `set-property` must not write a dead frontmatter key.
 *
 * Drives the REAL `setPropertyCommand()` against a temp fixture vault and reads
 * the bytes back from disk (test-fixture-realism): the subject is the PHYSICAL
 * key, so a helper's return value would not judge it.
 *
 * ⛤ The fixture mounts a small TBox on purpose. `PropertyNameValidator` fails
 * OPEN when no property defs are mounted, so a def-less fixture would exercise
 * neither the validator nor its interaction with the normalisation — and that
 * interaction is where the second half of this ticket lives (DK18).
 *
 * Measured on vault-exodev BEFORE the fix (why the fixture below is shaped this
 * way): the validator is BLIND to the full-IRI shape — it accepted
 * `…/ontology/zzz#Totally_Made_Up` (a namespace that does not exist) while
 * rejecting `zzz__Totally_Made_Up`. So an IRI-named property skipped the name
 * check entirely and went straight to disk as a raw key.
 *
 * @req:eac1690d-4d17-4f00-a221-0f8bee3c697c
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const { setPropertyCommand } = await import("../../src/commands/set-property.js");
const { GUARDED_PROPERTIES, IMMUTABLE_PROPERTIES } = await import(
  "../../src/commands/propertyMutationShared.js"
);
const { FrontmatterService } = await import("@kitelev/exocortex-core");

const DIR = "assetspaces/kitelev/exoas-probe/probe";
const ANCHOR = "a0a0a0a0-0000-4000-8000-000000000001";
const TARGET = "b0b0b0b0-0000-4000-8000-000000000002";
/** The `exo__Property` metaclass UID the validator recognises. */
const PROPERTY_METACLASS = "38277bfa-d7f9-4a75-b856-b23276ab0db3";

/** An out-of-map namespace (`flow` is NOT one of the nine) that EXISTS in the TBox. */
const OOM_IRI = "https://exocortex.my/ontology/flow#Attempt_item";
const OOM_KEY = "flow__Attempt_item";
/**
 * An in-map namespace — the paired control. ⛔ `lit` IS one of the nine;
 * `concept` is NOT, and using it here made this "control" a second out-of-map
 * case that reddened under MD1 alongside the real ones. Caught by the mutant
 * matrix, not by reading.
 */
const INMAP_IRI = "https://exocortex.my/ontology/lit#Note_source";
const INMAP_KEY = "lit__Note_source";
/** Out-of-map AND absent from the TBox — the validator must now refuse it. */
const ABSENT_IRI = "https://exocortex.my/ontology/zzz#Totally_Made_Up";

function md(fm: Record<string, string>, body = "body"): string {
  return ["---", ...Object.entries(fm).map(([k, v]) => `${k}: ${v}`), "---", body, ""].join("\n");
}

describe("Ticket c8fc6793: `cli set-property` writes a canonical key for any namespace", () => {
  let vault: string;
  let exitCodes: number[];
  let stdoutChunks: string[];
  let stderrChunks: string[];
  const spies: ReturnType<typeof jest.spyOn>[] = [];

  const targetRel = `${DIR}/${TARGET}.md`;
  const targetAbs = (): string => path.join(vault, targetRel);
  const read = (): string => fs.readFileSync(targetAbs(), "utf-8");
  const keys = (): string[] =>
    read()
      .split("\n---")[0]
      .split("\n")
      .map((l) => l.split(":")[0])
      .filter((k) => k && k !== "---");

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-c8fc6793-"));
    const dir = path.join(vault, DIR);
    fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(
      path.join(dir, `${ANCHOR}.md`),
      md({ exo__Asset_uid: ANCHOR, exo__Asset_label: "$probe" }),
    );
    // A minimal mounted TBox so the validator does NOT fail open.
    const defs: [string, string][] = [
      ["c0c0c0c0-0000-4000-8000-000000000003", OOM_KEY],
      ["c0c0c0c0-0000-4000-8000-000000000004", INMAP_KEY],
    ];
    for (const [uid, label] of defs) {
      fs.writeFileSync(
        path.join(dir, `${uid}.md`),
        md({
          exo__Asset_uid: uid,
          exo__Instance_class: `"[[${PROPERTY_METACLASS}]]"`,
          exo__Asset_label: label,
        }),
      );
    }
    fs.writeFileSync(
      path.join(dir, `${PROPERTY_METACLASS}.md`),
      md({ exo__Asset_uid: PROPERTY_METACLASS, exo__Asset_label: "exo__Property" }),
    );
    fs.writeFileSync(
      targetAbs(),
      md({
        exo__Asset_uid: TARGET,
        exo__Asset_isDefinedBy: `"[[${ANCHOR}]]"`,
        exo__Asset_label: '"Probe"',
        exo__Asset_updatedAt: "2020-01-01T00:00:00",
      }),
    );

    exitCodes = [];
    stdoutChunks = [];
    stderrChunks = [];
    spies.length = 0;
    spies.push(
      jest.spyOn(process, "exit").mockImplementation(((code?: number) => {
        exitCodes.push(code ?? 0);
        return undefined as never;
      }) as never),
      jest.spyOn(process.stdout, "write").mockImplementation(((c: unknown) => {
        stdoutChunks.push(String(c));
        return true;
      }) as never),
      jest.spyOn(process.stderr, "write").mockImplementation(((c: unknown) => {
        stderrChunks.push(String(c));
        return true;
      }) as never),
      jest.spyOn(console, "log").mockImplementation(() => {}),
      jest.spyOn(console, "error").mockImplementation(() => {}),
    );
  });

  afterEach(() => {
    for (const s of spies) s.mockRestore();
    fs.rmSync(vault, { recursive: true, force: true });
  });

  async function run(property: string, value: string): Promise<void> {
    const cmd = setPropertyCommand();
    await cmd.parseAsync(
      [targetRel, "--vault", vault, "--property", property, "--value", value, "--skip-wikilink-validation"],
      { from: "user" },
    );
  }

  it("DK15 an out-of-map namespace lands as a canonical key, not a raw IRI @req:eac1690d-4d17-4f00-a221-0f8bee3c697c", async () => {
    await run(OOM_IRI, "42");
    expect(keys()).toContain(OOM_KEY);
    expect(read()).not.toContain(OOM_IRI);
  });

  it("DK16 PAIRED CONTROL — an in-map namespace is unchanged @req:eac1690d-4d17-4f00-a221-0f8bee3c697c", async () => {
    await run(INMAP_IRI, "x");
    expect(keys()).toContain(INMAP_KEY);
    expect(read()).not.toContain(INMAP_IRI);
  });

  it("DK17 one predicate, ONE key — split state through the real command @req:eac1690d-4d17-4f00-a221-0f8bee3c697c", async () => {
    await run(OOM_IRI, "42");
    await run(OOM_KEY, "99");
    const occurrences = keys().filter((k) => k === OOM_KEY).length;
    expect(occurrences).toBe(1);
    expect(read()).toContain(`${OOM_KEY}: 99`);
    // ⛔ Load-bearing: without this the axis passes either way — the second
    // (prefixed) write always lands one canonical key, so only the ABSENCE of the
    // raw-IRI key distinguishes one physical key from two.
    expect(keys()).not.toContain(OOM_IRI);
    expect(read()).not.toContain(OOM_IRI);
  });

  it("DK18 an IRI naming a property that does NOT exist is now REFUSED, not written @req:eac1690d-4d17-4f00-a221-0f8bee3c697c", async () => {
    // ⛔ BEHAVIOUR CHANGE, named on purpose: before the fix the validator was
    // blind to the full-IRI shape, so this wrote a junk key and exited 0. Now the
    // name it judges is `zzz__Totally_Made_Up`, which the mounted TBox does not
    // know — silent corruption is replaced by a loud refusal.
    const before = read();
    await run(ABSENT_IRI, "42");
    expect(exitCodes.some((c) => c !== 0)).toBe(true);
    expect(read()).toBe(before); // the file is untouched on a refusal
    expect(read()).not.toContain(ABSENT_IRI);
  });
});

/**
 * Ticket c8fc6793 — the LIST invariant behind the guard denylists.
 *
 * ⛤ Why this shape and not "the guard fires on an out-of-map IRI": that axis
 * would be identically green today, because every guarded key is `ems__`/`exo__`
 * — both inside the nine-entry map — so the defect has no input
 * (integration-test-revert-verify §A37). This one DOES discriminate: its mutant
 * INTRODUCES a new member — a guarded key in an out-of-map namespace — and the
 * axis goes red (self-satisfying-metric-weak-verifier §A17).
 *
 * @req:eac1690d-4d17-4f00-a221-0f8bee3c697c
 */
describe("Ticket c8fc6793: every guarded property name canonicalises to itself", () => {
  it("DK19 normalizeIRI maps each GUARDED/IMMUTABLE key to itself @req:eac1690d-4d17-4f00-a221-0f8bee3c697c", () => {
    const names = [
      ...Object.keys(GUARDED_PROPERTIES),
      ...Object.keys(IMMUTABLE_PROPERTIES),
    ];
    // Canary: the lists are non-empty, so a green verdict is not an empty sweep.
    expect(names.length).toBeGreaterThan(5);
    for (const name of names) {
      expect(FrontmatterService.normalizeIRI(name)).toBe(name);
    }
  });
});
