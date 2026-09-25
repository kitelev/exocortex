/**
 * Issue #4350 — hyphenated namespace prefixes (`device-work-macbook__`,
 * `tbank-crm__`) end to end through the CLI consumers of the prefix grammar.
 *
 * Core `Namespace` learned the hyphen; every CLI module that holds its own copy
 * of the grammar (`utils/namespacePrefix.ts`) has to agree, or the two halves
 * disagree about the same asset. Each axis below pins one consumer through its
 * REAL production path on a temp vault:
 *
 *   H1  SHACL (`runShapesValidation`): an instance of a hyphen-prefixed class
 *       that IS a subclass of the range raises NO sh:class violation — the
 *       class is now emitted as `…/tbank-crm#Contact`, so `labelToOntologyIRI`
 *       must derive that IRI's subClassOf edge (validate-schema).
 *   H2  SHACL: a hyphen-prefixed PROPERTY pointing at a non-member raises
 *       exactly one violation on `…/device-work-macbook#Area_owner` — proof the
 *       property is emitted AND validated, not silently dropped (the bug).
 *   H3  pre-write gate (`CandidateShaclValidator`): that violation names the
 *       frontmatter KEY `device-work-macbook__Area_owner`, not the raw IRI.
 *   H4  `find --class tbank-crm__Contact` binds the value as the class IRI and
 *       finds the instance (find.ts `SLUG_RE`).
 *   H5  cache (`CacheManager`): a class that GAINS a hyphen-prefixed TBox label
 *       (human label → `tbank-crm__Contact`) is a TBox change → rebuild, and the
 *       referrer's class follows from the file IRI to `…/tbank-crm#Contact`; a
 *       delta would keep the stale file IRI (`TBOX_FORM`). ⛤ Deliberately the
 *       GAIN, not a relabel of an already-TBox class: for a relabel the rebuild
 *       is carried by `entryHasTBoxLabel`'s IRI-object check (core emits a TBox
 *       label as an IRI), so `TBOX_FORM` is defensive there and a mutant of it
 *       reddens nothing (measured) — only the gain reaches it.
 *   H6  cache format: a cache written before #4350 (formatVersion 3, the hyphen
 *       class still a FILE IRI) is invalid and rebuilt — unchanged files would
 *       otherwise keep the old graph and a delta would mix both (#4352 review).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, jest } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { NoteToRDFConverter, vaultPathToIRI } from "@kitelev/exocortex-core";
import { runShapesValidation } from "../../src/commands/validate-schema.js";
import { FileSystemVaultAdapter } from "../../src/adapters/FileSystemVaultAdapter.js";
import { CandidateShaclValidator } from "../../src/services/CandidateShaclValidator.js";
import { findCommand } from "../../src/commands/find.js";
import { CacheManager, CACHE_FORMAT_VERSION, serializeNode } from "../../src/cache/CacheManager.js";

const ONT = "https://exocortex.my/ontology/";

// Class TBox (UUID-named, production shape)
const EXO_CLASS_UID = "43500000-0000-4000-8000-000000000001"; // exo__Class
const EXO_ASSET_UID = "43500000-0000-4000-8000-000000000002"; // exo__Asset
const AGENT_CLASS_UID = "43500000-0000-4000-8000-000000000003"; // ems__Agent
const AREA_CLASS_UID = "43500000-0000-4000-8000-000000000004"; // ems__Area
const CONTACT_CLASS_UID = "43500000-0000-4000-8000-000000000005"; // tbank-crm__Contact ⊂ ems__Agent
const OWNER_PROP_UID = "43500000-0000-4000-8000-000000000006"; // device-work-macbook__Area_owner
const ALIAS_UID = "43500000-0000-4000-8000-000000000007"; // find__Alias "class"

// ABox
const CONTACT_UID = "43500000-0000-4000-8000-000000000010";
const AREA_OK_UID = "43500000-0000-4000-8000-000000000011"; // owner → CONTACT (an agent)
const AREA_BAD_UID = "43500000-0000-4000-8000-000000000012"; // owner → AREA_OK (not an agent)

const OWNER_PATH = `${ONT}device-work-macbook#Area_owner`;
const AGENT_IRI = `${ONT}ems#Agent`;

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
exo__Instance_class:
  - "[[exo__Class]]"${superUid ? `
exo__Class_superClass:
  - "[[${superUid}]]"` : ""}
---
`;

const area = (uid: string, label: string, ownerUid: string): string => `---
exo__Asset_uid: ${uid}
exo__Asset_label: "${label}"
exo__Instance_class:
  - "[[${AREA_CLASS_UID}]]"
device-work-macbook__Area_owner: "[[${ownerUid}]]"
---
`;

let fixtureDir: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let violations: any[];

beforeAll(async () => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-4350-hyphen-ns-"));
  writeAll(fixtureDir, {
    [`exo/${EXO_CLASS_UID}.md`]: cls(EXO_CLASS_UID, "exo__Class", EXO_ASSET_UID),
    [`exo/${EXO_ASSET_UID}.md`]: cls(EXO_ASSET_UID, "exo__Asset"),
    [`ems/${AGENT_CLASS_UID}.md`]: cls(AGENT_CLASS_UID, "ems__Agent", EXO_ASSET_UID),
    [`ems/${AREA_CLASS_UID}.md`]: cls(AREA_CLASS_UID, "ems__Area", EXO_ASSET_UID),
    [`tbank-crm/${CONTACT_CLASS_UID}.md`]: cls(CONTACT_CLASS_UID, "tbank-crm__Contact", AGENT_CLASS_UID),
    [`device-work-macbook/${OWNER_PROP_UID}.md`]: `---
exo__Asset_uid: ${OWNER_PROP_UID}
exo__Asset_label: device-work-macbook__Area_owner
exo__Instance_class:
  - "[[exo__Property]]"
exo__Property_domain:
  - "[[${AREA_CLASS_UID}]]"
exo__Property_range:
  - "[[${AGENT_CLASS_UID}]]"
---
`,
    [`find/${ALIAS_UID}.md`]: `---
exo__Asset_isDefinedBy: "[[!find]]"
exo__Asset_uid: ${ALIAS_UID}
exo__Asset_label: "class"
exo__Instance_class:
  - "[[6b98cd5e-485b-4d53-b54e-402eb8f06fca|find__Alias]]"
find__Alias_sparql: "?path <https://exocortex.my/ontology/exo#Instance_class> ?value"
---
`,
    [`${CONTACT_UID}.md`]: `---
exo__Asset_uid: ${CONTACT_UID}
exo__Asset_label: "Контакт"
exo__Instance_class:
  - "[[${CONTACT_CLASS_UID}]]"
---
`,
    [`${AREA_OK_UID}.md`]: area(AREA_OK_UID, "Area (contact owner)", CONTACT_UID),
    [`${AREA_BAD_UID}.md`]: area(AREA_BAD_UID, "Area (area owner)", AREA_OK_UID),
  });

  const converter = new NoteToRDFConverter(new FileSystemVaultAdapter(fixtureDir));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const triples = (await converter.convertVault()) as any[];
  violations = (await runShapesValidation(fixtureDir, triples)).violations;
});

afterAll(() => {
  if (fixtureDir) fs.rmSync(fixtureDir, { recursive: true, force: true });
});

const ownerViolations = (focusUid: string) =>
  violations.filter(
    (v) =>
      v.propertyPath === OWNER_PATH &&
      v.focusNode === `obsidian://vault/${focusUid}.md` &&
      v.severity === "sh:Violation" &&
      v.message.includes(AGENT_IRI),
  );

describe("Issue #4350 — hyphenated namespace prefixes through the CLI", () => {
  it("[H1] an instance of a hyphen-prefixed subclass of the range raises no sh:class violation", () => {
    expect(ownerViolations(AREA_OK_UID)).toEqual([]);
  });

  it("[H2] a hyphen-prefixed property pointing at a non-member raises exactly one sh:class violation", () => {
    expect(ownerViolations(AREA_BAD_UID)).toHaveLength(1);
  });

  it("[H3] the pre-write gate names the violated frontmatter KEY, not the raw predicate IRI", async () => {
    const result = await new CandidateShaclValidator(fixtureDir).validateCandidate(
      "43500000-0000-4000-8000-0000000000aa.md",
      area("43500000-0000-4000-8000-0000000000aa", "Candidate area", AREA_OK_UID),
    );
    const owner = result.violations.filter((v) => v.propertyIri === OWNER_PATH);
    expect(owner).toHaveLength(1);
    expect(owner[0].propertyPath).toBe("device-work-macbook__Area_owner");
  }, 30_000);

  describe("[H4] find --class", () => {
    let captured: string;
    let capturedErr: string;
    let spies: Array<{ mockRestore: () => void }>;

    beforeEach(() => {
      captured = "";
      capturedErr = "";
      spies = [
        jest.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array): boolean => {
          captured += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8");
          return true;
        }),
        jest.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array): boolean => {
          capturedErr += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8");
          return true;
        }),
        jest.spyOn(process, "exit").mockImplementation((() => undefined) as never),
      ];
    });

    afterEach(() => {
      for (const s of spies) s.mockRestore();
    });

    it("[H4] binds a hyphen-prefixed class label as its IRI and finds the instance", async () => {
      await findCommand().parseAsync(["--vault", fixtureDir, "--class", "tbank-crm__Contact"], {
        from: "user",
      });
      expect(capturedErr).not.toContain("Error");
      const lines = captured.split("\n").filter((l) => l.length > 0);
      expect(lines).toEqual([`${CONTACT_UID}.md`]);
    }, 30_000);
  });

  it("[H5] a class gaining a hyphen-prefixed TBox label rebuilds the cache and the referrer's class follows", async () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), "exo-4350-hyphen-cache-"));
    try {
      const classRel = `tbank-crm/${CONTACT_CLASS_UID}.md`;
      const instRel = `${CONTACT_UID}.md`;
      let clock = Date.now() - 120_000;
      const write = (rel: string, body: string) => {
        writeAll(vault, { [rel]: body });
        clock += 1000;
        fs.utimesSync(path.join(vault, rel), clock / 1000, clock / 1000);
      };
      write(`exo/${EXO_CLASS_UID}.md`, cls(EXO_CLASS_UID, "exo__Class"));
      write(classRel, cls(CONTACT_CLASS_UID, '"Контрагент"'));
      write(instRel, `---
exo__Asset_uid: ${CONTACT_UID}
exo__Asset_label: "Контакт"
exo__Instance_class:
  - "[[${CONTACT_CLASS_UID}]]"
---
`);
      const classesOf = (triples: { subject: unknown; predicate: unknown; object: unknown }[]) =>
        triples
          .filter(
            (t) =>
              serializeNode(t.subject as never).value === vaultPathToIRI(instRel) &&
              serializeNode(t.predicate as never).value === `${ONT}exo#Instance_class`,
          )
          .map((t) => serializeNode(t.object as never).value);

      const cache = new CacheManager(vault);
      const first = await cache.loadOrBuild();
      // human label → the class is referenced by its FILE IRI
      expect(classesOf(first.triples)).toEqual([vaultPathToIRI(classRel)]);

      write(classRel, cls(CONTACT_CLASS_UID, "tbank-crm__Contact"));
      const second = await cache.loadOrBuild();
      expect(second.mode).toBe("rebuild");
      expect(classesOf(second.triples)).toEqual([`${ONT}tbank-crm#Contact`]);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  }, 30_000);

  it("[H6] a cache written before #4350 (formatVersion 3, hyphen class as a file IRI) is invalid and rebuilt", async () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), "exo-4350-hyphen-fmt-"));
    try {
      const classRel = `tbank-crm/${CONTACT_CLASS_UID}.md`;
      const instRel = `${CONTACT_UID}.md`;
      writeAll(vault, {
        [`exo/${EXO_CLASS_UID}.md`]: cls(EXO_CLASS_UID, "exo__Class"),
        [classRel]: cls(CONTACT_CLASS_UID, "tbank-crm__Contact"),
        [instRel]: `---
exo__Asset_uid: ${CONTACT_UID}
exo__Asset_label: "Контакт"
exo__Instance_class:
  - "[[${CONTACT_CLASS_UID}]]"
---
`,
      });
      const symbolic = `${ONT}tbank-crm#Contact`;
      const fileIri = vaultPathToIRI(classRel);
      const classesOf = (triples: { subject: unknown; predicate: unknown; object: unknown }[]) =>
        triples
          .filter(
            (t) =>
              serializeNode(t.subject as never).value === vaultPathToIRI(instRel) &&
              serializeNode(t.predicate as never).value === `${ONT}exo#Instance_class`,
          )
          .map((t) => serializeNode(t.object as never).value);

      const cache = new CacheManager(vault);
      const cachePath = cache.getCachePath();
      const fresh = await cache.loadOrBuild();
      expect(classesOf(fresh.triples)).toEqual([symbolic]);
      const written = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
      expect(written.metadata.formatVersion).toBe(CACHE_FORMAT_VERSION);

      // Rewrite the cache as the previous CLI left it: same manifest (every
      // entry still "fresh" by mtime), format 3, the class as its file IRI.
      const stale = JSON.parse(JSON.stringify(written).split(symbolic).join(fileIri));
      stale.metadata.formatVersion = 3;
      fs.writeFileSync(cachePath, JSON.stringify(stale));
      expect(JSON.stringify(stale)).not.toContain(symbolic);

      expect(await cache.isCacheValid()).toBe(false);
      const rebuilt = await cache.loadOrBuild();
      expect(rebuilt.mode).toBe("rebuild");
      expect(classesOf(rebuilt.triples)).toEqual([symbolic]);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  }, 30_000);
});
