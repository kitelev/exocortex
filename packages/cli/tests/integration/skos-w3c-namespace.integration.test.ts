/**
 * req e750782f — the `skos` prefix resolves to the W3C SKOS namespace, end to end
 * through the CLI consumers of the prefix table (RFC 14217015 §5, decision №6).
 *
 * The author-comparison desk ("стол") records a mapping as an `exo__Statement`
 * [author term, `skos__exactMatch`, neutral concept]; the property's domain and
 * range are `skos__Concept`, and the desk's adapter states
 * `concept__Concept ⊂ skos__Concept` (another `exo__Statement`, predicate by UID).
 * Production shape on a temp vault, REAL converter + REAL SHACL validator:
 *
 *   K1  SHACL: a mapping between two concept__Concept instances raises NO
 *       sh:class violation — the skos__Concept subClassOf edge the CLI builds
 *       (`labelToOntologyIRI`) must sit under the SAME W3C IRI the converter
 *       emits for the range.
 *   K2  SHACL: a mapping to an ems__Task raises exactly one sh:class violation on
 *       `http://www.w3.org/2004/02/skos/core#exactMatch` naming the W3C range —
 *       proof the range is enforced, not merely vacuous.
 *   K4  SHACL: the same edge written the OTHER way the vault writes it — as
 *       `exo__Class_superClass` in a class file's frontmatter — also raises no
 *       violation. (Neither K1 nor K4 needs the CLI map entry — measured: in both
 *       the converter emits the edge's OBJECT `skos__Concept` as the W3C IRI
 *       itself, so `labelToOntologyIRI` is never asked for it.)
 *   K5  SHACL: the edge where `skos__Concept` is the SUBJECT (`skos__Concept ⊂
 *       test__Thing`). The CLI maps the class FILE to its ontology IRI through
 *       `labelToOntologyIRI("skos__Concept")`; without the `skos__` map entry that
 *       IRI is the ad-hoc one while instances carry the W3C one, so an instance
 *       of the stub would fail a range of `test__Thing`. The live stub has no
 *       superClass today (measured 2026-10-12), so this edge is the one a future
 *       `$skos` schema would add — the axis pins the entry before that happens.
 *   K6  resolve-buttons: an instance of the stub reports `skos__Concept` among
 *       its classes — the CLI reads the store's W3C class IRI back through
 *       `Namespace.fromTermIRI`; the `/ontology/<p>#` regex it replaced dropped
 *       it, so a binding authored against `skos__Concept` never matched.
 *   K7  pre-write gate (`CandidateShaclValidator`): a violation on the W3C
 *       predicate names the frontmatter KEY `skos__exactMatch`, not the raw IRI.
 *   K3  cache format: a cache written before e750782f (formatVersion 4, the ad-hoc
 *       `https://exocortex.my/ontology/skos#` IRI for UNCHANGED files) is invalid
 *       and rebuilt — otherwise the W3C IRI never reaches a `--use-cache` caller.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { NoteToRDFConverter, vaultPathToIRI } from "@kitelev/exocortex-core";
import { runShapesValidation } from "../../src/commands/validate-schema.js";
import { FileSystemVaultAdapter } from "../../src/adapters/FileSystemVaultAdapter.js";
import {
  CacheManager,
  CACHE_FORMAT_VERSION,
  serializeNode,
} from "../../src/cache/CacheManager.js";
import { resolveButtons } from "../../src/commands/resolve-buttons.js";
import { CandidateShaclValidator } from "../../src/services/CandidateShaclValidator.js";

const W3C_SKOS = "http://www.w3.org/2004/02/skos/core#";
const ADHOC_SKOS = "https://exocortex.my/ontology/skos#";
const EXACT_PATH = `${W3C_SKOS}exactMatch`;

// Class TBox (UUID-named, production shape; superClass property by its live UID)
const EXO_CLASS_UID = "e7510000-0000-4000-8000-000000000001"; // exo__Class
const EXO_ASSET_UID = "e7510000-0000-4000-8000-000000000002"; // exo__Asset
const STMT_UID = "7920028c-8613-4756-9761-95846155ce9c"; // exo__Statement (live)
const SUPER_PROP_UID = "d04bcde4-ef02-48d6-823a-5de2622626cb"; // exo__Class_superClass (live)
const SKOS_CONCEPT_UID = "e7510000-0000-4000-8000-000000000003"; // skos__Concept stub
const CONCEPT_UID = "e7510000-0000-4000-8000-000000000004"; // concept__Concept
const TASK_CLASS_UID = "e7510000-0000-4000-8000-000000000005"; // ems__Task
const EXACT_UID = "e7510000-0000-4000-8000-000000000006"; // skos__exactMatch
const ADAPTER_UID = "e7510000-0000-4000-8000-000000000007"; // concept__Concept ⊂ skos__Concept
const DESK_CLASS_UID = "e7510000-0000-4000-8000-000000000008"; // desk__Neutral ⊂ skos__Concept (frontmatter edge)

// ABox
const TERM_OK_UID = "e7510000-0000-4000-8000-000000000010";
const NEUTRAL_UID = "e7510000-0000-4000-8000-000000000011";
const TERM_BAD_UID = "e7510000-0000-4000-8000-000000000012";
const TASK_UID = "e7510000-0000-4000-8000-000000000013";
const MAP_OK_UID = "e7510000-0000-4000-8000-000000000020";
const MAP_BAD_UID = "e7510000-0000-4000-8000-000000000021";
const FM_A_UID = "e7510000-0000-4000-8000-000000000030";
const FM_B_UID = "e7510000-0000-4000-8000-000000000031";
const MAP_FM_UID = "e7510000-0000-4000-8000-000000000032";
const ABOUT_PROP_UID = "e7510000-0000-4000-8000-000000000040"; // test__Note_about, range test__Thing
const THING_CLASS_UID = "e7510000-0000-4000-8000-000000000044"; // test__Thing ⊂ exo__Asset; skos__Concept ⊂ test__Thing
const NOTE_CLASS_UID = "e7510000-0000-4000-8000-000000000041"; // test__Note
const NOTE_UID = "e7510000-0000-4000-8000-000000000042"; // about → PMBOK_UID
const PMBOK_UID = "e7510000-0000-4000-8000-000000000043"; // instance of the skos__Concept stub
const ABOUT_PATH = "https://exocortex.my/ontology/test#Note_about";

function writeAll(root: string, files: Record<string, string>): void {
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
}

const cls = (uid: string, label: string, superUid?: string): string => `---
exo__Asset_uid: ${uid}
exo__Asset_label: ${label}
aliases:
  - ${label}
exo__Instance_class:
  - "[[exo__Class]]"${
    superUid
      ? `
exo__Class_superClass:
  - "[[${superUid}]]"`
      : ""
  }
---
`;

const inst = (uid: string, label: string, classUid: string): string => `---
exo__Asset_uid: ${uid}
exo__Asset_label: "${label}"
exo__Instance_class:
  - "[[${classUid}]]"
---
`;

const stmt = (uid: string, s: string, p: string, o: string): string => `---
exo__Asset_uid: ${uid}
exo__Instance_class:
  - "[[${STMT_UID}]]"
exo__Statement_subject: "[[${s}]]"
exo__Statement_predicate: "[[${p}]]"
exo__Statement_object: "[[${o}]]"
---
`;

function deskFiles(): Record<string, string> {
  return {
    [`exo/${EXO_CLASS_UID}.md`]: cls(
      EXO_CLASS_UID,
      "exo__Class",
      EXO_ASSET_UID,
    ),
    [`exo/${EXO_ASSET_UID}.md`]: cls(EXO_ASSET_UID, "exo__Asset"),
    [`exo/${STMT_UID}.md`]: cls(STMT_UID, "exo__Statement", EXO_ASSET_UID),
    [`exo/${SUPER_PROP_UID}.md`]: `---
exo__Asset_uid: ${SUPER_PROP_UID}
exo__Asset_label: exo__Class_superClass
aliases:
  - exo__Class_superClass
exo__Instance_class:
  - "[[exo__ObjectProperty]]"
---
`,
    [`test/${THING_CLASS_UID}.md`]: cls(
      THING_CLASS_UID,
      "test__Thing",
      EXO_ASSET_UID,
    ),
    [`skos/${SKOS_CONCEPT_UID}.md`]: cls(
      SKOS_CONCEPT_UID,
      "skos__Concept",
      THING_CLASS_UID,
    ),
    [`concept/${CONCEPT_UID}.md`]: cls(
      CONCEPT_UID,
      "concept__Concept",
      EXO_ASSET_UID,
    ),
    [`ems/${TASK_CLASS_UID}.md`]: cls(
      TASK_CLASS_UID,
      "ems__Task",
      EXO_ASSET_UID,
    ),
    [`desk/${DESK_CLASS_UID}.md`]: cls(
      DESK_CLASS_UID,
      "desk__Neutral",
      SKOS_CONCEPT_UID,
    ),
    [`test/${NOTE_CLASS_UID}.md`]: cls(
      NOTE_CLASS_UID,
      "test__Note",
      EXO_ASSET_UID,
    ),
    [`test/${ABOUT_PROP_UID}.md`]: `---
exo__Asset_uid: ${ABOUT_PROP_UID}
exo__Asset_label: test__Note_about
exo__Instance_class:
  - "[[exo__ObjectProperty]]"
exo__Property_domain:
  - "[[${NOTE_CLASS_UID}]]"
exo__Property_range:
  - "[[${THING_CLASS_UID}]]"
---
`,
    [`${PMBOK_UID}.md`]: inst(PMBOK_UID, "Риск", SKOS_CONCEPT_UID),
    [`${NOTE_UID}.md`]: `---
exo__Asset_uid: ${NOTE_UID}
exo__Asset_label: "Заметка о риске"
exo__Instance_class:
  - "[[${NOTE_CLASS_UID}]]"
test__Note_about: "[[${PMBOK_UID}]]"
---
`,
    [`skos/${EXACT_UID}.md`]: `---
exo__Asset_uid: ${EXACT_UID}
exo__Asset_label: skos__exactMatch
aliases:
  - skos__exactMatch
exo__Instance_class:
  - "[[exo__ObjectProperty]]"
exo__Property_domain:
  - "[[${SKOS_CONCEPT_UID}]]"
exo__Property_range:
  - "[[${SKOS_CONCEPT_UID}]]"
---
`,
    // The desk adapter: concept__Concept ⊂ skos__Concept, predicate by bare UID.
    [`desk-mappings/${ADAPTER_UID}.md`]: stmt(
      ADAPTER_UID,
      CONCEPT_UID,
      SUPER_PROP_UID,
      SKOS_CONCEPT_UID,
    ),
    [`${TERM_OK_UID}.md`]: inst(TERM_OK_UID, "Растворение «я»", CONCEPT_UID),
    [`${NEUTRAL_UID}.md`]: inst(NEUTRAL_UID, "Растворение эго", CONCEPT_UID),
    [`${TERM_BAD_UID}.md`]: inst(TERM_BAD_UID, "Отпускание", CONCEPT_UID),
    [`${TASK_UID}.md`]: inst(TASK_UID, "Купить хлеб", TASK_CLASS_UID),
    [`desk-mappings/${MAP_OK_UID}.md`]: stmt(
      MAP_OK_UID,
      TERM_OK_UID,
      EXACT_UID,
      NEUTRAL_UID,
    ),
    [`desk-mappings/${MAP_BAD_UID}.md`]: stmt(
      MAP_BAD_UID,
      TERM_BAD_UID,
      EXACT_UID,
      TASK_UID,
    ),
    [`${FM_A_UID}.md`]: inst(FM_A_UID, "Нейтральное A", DESK_CLASS_UID),
    [`${FM_B_UID}.md`]: inst(FM_B_UID, "Нейтральное B", DESK_CLASS_UID),
    [`desk-mappings/${MAP_FM_UID}.md`]: stmt(
      MAP_FM_UID,
      FM_A_UID,
      EXACT_UID,
      FM_B_UID,
    ),
  };
}

let fixtureDir: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let violations: any[];

beforeAll(async () => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-e750782f-skos-"));
  writeAll(fixtureDir, deskFiles());
  const converter = new NoteToRDFConverter(
    new FileSystemVaultAdapter(fixtureDir),
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const triples = (await converter.convertVault()) as any[];
  violations = (await runShapesValidation(fixtureDir, triples)).violations;
}, 30_000);

afterAll(() => {
  if (fixtureDir) fs.rmSync(fixtureDir, { recursive: true, force: true });
});

const exactViolations = (focusUid: string) =>
  violations.filter(
    (v) =>
      v.propertyPath === EXACT_PATH &&
      v.focusNode === `obsidian://vault/${focusUid}.md` &&
      v.severity === "sh:Violation",
  );

describe("req e750782f — the skos prefix through the CLI", () => {
  it("K1 @req:e750782f-907b-4573-99ce-f9a5e3150418 a mapping between two concepts raises no sh:class violation on the W3C exactMatch", () => {
    // Non-vacuity canary: the validator saw the materialised mapping at all.
    expect(violations.length).toBeGreaterThan(0);
    expect(exactViolations(TERM_OK_UID)).toEqual([]);
  });

  it("K2 @req:e750782f-907b-4573-99ce-f9a5e3150418 a mapping to a task raises exactly one sh:class violation naming the W3C range", () => {
    const found = exactViolations(TERM_BAD_UID);
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain(`${W3C_SKOS}Concept`);
    expect(found[0].message).not.toContain(ADHOC_SKOS);
  });

  it("K4 @req:e750782f-907b-4573-99ce-f9a5e3150418 a frontmatter superClass edge to skos__Concept is built under the W3C IRI — no false sh:class", () => {
    expect(exactViolations(FM_A_UID)).toEqual([]);
  });

  it("K5 @req:e750782f-907b-4573-99ce-f9a5e3150418 an instance of the skos__Concept stub satisfies a range that is the stub's superclass (the edge is built under the W3C IRI)", () => {
    const about = violations.filter(
      (v) =>
        v.propertyPath === ABOUT_PATH &&
        v.focusNode === `obsidian://vault/${NOTE_UID}.md`,
    );
    expect(about).toEqual([]);
  });

  it("K6 @req:e750782f-907b-4573-99ce-f9a5e3150418 resolve-buttons names skos__Concept among the classes of an instance of the stub", async () => {
    const result = await resolveButtons(fixtureDir, `${PMBOK_UID}.md`);
    expect(result.classes).toContain("skos__Concept");
  }, 30_000);

  it("K7 @req:e750782f-907b-4573-99ce-f9a5e3150418 the pre-write gate names the frontmatter KEY skos__exactMatch, not the raw W3C IRI", async () => {
    const uid = "e7510000-0000-4000-8000-0000000000aa";
    const result = await new CandidateShaclValidator(
      fixtureDir,
    ).validateCandidate(
      `${uid}.md`,
      `---
exo__Asset_uid: ${uid}
exo__Asset_label: "Кандидат"
exo__Instance_class:
  - "[[${CONCEPT_UID}]]"
skos__exactMatch: "[[${TASK_UID}]]"
---
`,
    );
    const exact = result.violations.filter((v) => v.propertyIri === EXACT_PATH);
    expect(exact).toHaveLength(1);
    expect(exact[0].propertyPath).toBe("skos__exactMatch");
  }, 30_000);

  it("K3 @req:e750782f-907b-4573-99ce-f9a5e3150418 a cache written before e750782f (formatVersion 4, ad-hoc skos IRI) is invalid and rebuilt", async () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), "exo-e750782f-cache-"));
    try {
      writeAll(vault, deskFiles());
      const termIri = vaultPathToIRI(`${TERM_OK_UID}.md`);
      const exactOf = (
        triples: { subject: unknown; predicate: unknown; object: unknown }[],
      ) =>
        triples
          .filter((t) => serializeNode(t.subject as never).value === termIri)
          .map((t) => serializeNode(t.predicate as never).value)
          .filter((p) => p.endsWith("#exactMatch"));

      const cache = new CacheManager(vault);
      const cachePath = cache.getCachePath();
      const fresh = await cache.loadOrBuild();
      expect(exactOf(fresh.triples)).toEqual([EXACT_PATH]);
      const written = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
      expect(written.metadata.formatVersion).toBe(CACHE_FORMAT_VERSION);

      // Rewrite the cache as the previous CLI left it: same manifest (every entry
      // still "fresh" by mtime), format 4, every skos IRI in its ad-hoc form.
      const stale = JSON.parse(
        JSON.stringify(written).split(W3C_SKOS).join(ADHOC_SKOS),
      );
      stale.metadata.formatVersion = 4;
      fs.writeFileSync(cachePath, JSON.stringify(stale));
      expect(JSON.stringify(stale)).not.toContain(W3C_SKOS);

      expect(await cache.isCacheValid()).toBe(false);
      const rebuilt = await cache.loadOrBuild();
      expect(rebuilt.mode).toBe("rebuild");
      expect(exactOf(rebuilt.triples)).toEqual([EXACT_PATH]);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  }, 30_000);
});
