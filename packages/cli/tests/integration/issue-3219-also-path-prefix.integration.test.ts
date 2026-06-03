/**
 * Issue #3219 — `query --also <path>` strips path prefix from subject IRI
 * AND stores `exo__Instance_class` wikilinks as raw string literals when the
 * referenced class file lives in another vault.
 *
 * Two-vault scenario:
 *   primaryVault/ — contains the class TBox file (`exo__AssetSpace`) at
 *     `assetspaces/exo/<class-uid>.md` with `exo__Asset_label: exo__AssetSpace`.
 *
 *   additionalVault/ — the `--also` argument points users at
 *     `additionalRoot/assetspaces/aiknow-ontology` directly. The adapter is
 *     rooted at the subdirectory so files are walked as `<inst-uid>.md`
 *     (no path components).
 *
 * Pre-fix (Bug #1 + #2):
 *   1. Instance subject IRI = `obsidian://vault/<inst-uid>.md`
 *      (stripped — no `assetspaces/aiknow-ontology/` prefix).
 *   2. `exo__Instance_class` triple stored as raw string literal
 *      `"[[<class-uid>]]"` because `getFirstLinkpathDest` cannot resolve the
 *      cross-vault target.
 *
 * Post-fix:
 *   1. Instance subject IRI = `obsidian://vault/assetspaces/aiknow-ontology/<inst-uid>.md`
 *      via `subjectIriPrefix` option on `NoteToRDFConverter`.
 *   2. `resolveCrossVaultInstanceClassWikilinks` (applied in the non-cached
 *      `--also` path) materialises `<inst> exo:Instance_class <ns#LocalName>`
 *      and `<inst> rdf:type <ns#LocalName>` after both vaults are loaded.
 *
 * Empirical revert-verify discipline: this test FAILS pre-fix and PASSES
 * post-fix (see `~/dotfiles/.claude/rules/integration-test-revert-verify.md`).
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const { NoteToRDFConverter, Triple, IRI, Literal } = await import("exocortex");
const { FileSystemVaultAdapter } = await import(
  "../../src/adapters/FileSystemVaultAdapter.js"
);
const { resolveCrossVaultInstanceClassWikilinks } = await import(
  "../../src/utils/crossVaultInstanceClassResolver.js"
);
const { deriveSubjectIriPrefix } = await import(
  "../../src/utils/AlsoVaultMountPrefix.js"
);

const CLASS_UID = "73bd00e4-ccc0-4f3f-b20d-c4388c4588fb";
const INSTANCE_UID = "78366774-d1f5-4e26-8d70-0930380bb6df";
const META_CLASS_UID = "8619c4fc-64f1-4869-b17e-e34186cacca9";

let tmpRoot: string;
let primaryVault: string;
let additionalRoot: string;
let additionalSubdir: string;

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "exo-3219-"));
  primaryVault = path.join(tmpRoot, "primary");
  additionalRoot = path.join(tmpRoot, "additional");
  additionalSubdir = path.join(additionalRoot, "assetspaces", "aiknow-ontology");

  fs.mkdirSync(path.join(primaryVault, "assetspaces", "exo"), {
    recursive: true,
  });
  fs.mkdirSync(additionalSubdir, { recursive: true });

  // Primary vault: class TBox file with parseable label
  fs.writeFileSync(
    path.join(primaryVault, "assetspaces", "exo", `${CLASS_UID}.md`),
    `---
exo__Asset_uid: ${CLASS_UID}
exo__Instance_class:
  - "[[${META_CLASS_UID}]]"
exo__Asset_label: exo__AssetSpace
---
Class definition for AssetSpace.
`,
  );

  // Additional vault: AssetSpace instance referencing the class by UID
  fs.writeFileSync(
    path.join(additionalSubdir, `${INSTANCE_UID}.md`),
    `---
exo__Asset_uid: ${INSTANCE_UID}
exo__Instance_class:
  - "[[${CLASS_UID}]]"
exo__Asset_label: exocortex-aiknow-ontology
---
AssetSpace instance.
`,
  );
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("Issue #3219: --also path prefix preservation + cross-vault wikilink resolution", () => {
  describe("deriveSubjectIriPrefix heuristic", () => {
    it("returns assetspaces/<basename> when path ends with /assetspaces/<X>", () => {
      expect(
        deriveSubjectIriPrefix("/vault-root/assetspaces/aiknow-ontology"),
      ).toBe("assetspaces/aiknow-ontology");
      expect(
        deriveSubjectIriPrefix("/vault-root/assetspaces/aiknow-ontology/"),
      ).toBe("assetspaces/aiknow-ontology");
    });

    it("returns empty string for non-assetspaces paths (backward compat)", () => {
      expect(deriveSubjectIriPrefix("/some/random/vault")).toBe("");
      expect(deriveSubjectIriPrefix("/foo/assetspaces")).toBe("");
    });
  });

  describe("NoteToRDFConverter with subjectIriPrefix", () => {
    it("preserves assetspaces/<sub>/ prefix on subject IRIs for --also-loaded files", async () => {
      const adapter = new FileSystemVaultAdapter(additionalSubdir);
      const converter = new NoteToRDFConverter(adapter, undefined, {
        subjectIriPrefix: "assetspaces/aiknow-ontology",
      });
      const triples = await converter.convertVault();

      // Find subject IRI for the instance
      const instanceSubjects = new Set<string>();
      for (const t of triples as unknown as Array<{ subject: IRI }>) {
        if (t.subject instanceof IRI) {
          instanceSubjects.add(t.subject.value);
        }
      }

      const expected = `obsidian://vault/assetspaces/aiknow-ontology/${INSTANCE_UID}.md`;
      const stripped = `obsidian://vault/${INSTANCE_UID}.md`;

      expect(instanceSubjects.has(expected)).toBe(true);
      expect(instanceSubjects.has(stripped)).toBe(false);
    });

    it("does NOT apply prefix when subjectIriPrefix is empty (backward compat)", async () => {
      const adapter = new FileSystemVaultAdapter(additionalSubdir);
      const converter = new NoteToRDFConverter(adapter);
      const triples = await converter.convertVault();

      const instanceSubjects = new Set<string>();
      for (const t of triples as unknown as Array<{ subject: IRI }>) {
        if (t.subject instanceof IRI) {
          instanceSubjects.add(t.subject.value);
        }
      }

      const stripped = `obsidian://vault/${INSTANCE_UID}.md`;
      expect(instanceSubjects.has(stripped)).toBe(true);
    });
  });

  describe("Bug #2 — cross-vault Instance_class resolution in non-cached path", () => {
    it("after concat + resolveCrossVaultInstanceClassWikilinks, instance is typed by class IRI", async () => {
      // Load primary
      const primaryAdapter = new FileSystemVaultAdapter(primaryVault);
      const primaryConverter = new NoteToRDFConverter(primaryAdapter);
      const primaryTriples = await primaryConverter.convertVault();

      // Load additional (with prefix per fix)
      const additionalAdapter = new FileSystemVaultAdapter(additionalSubdir);
      const additionalConverter = new NoteToRDFConverter(
        additionalAdapter,
        undefined,
        { subjectIriPrefix: "assetspaces/aiknow-ontology" },
      );
      const additionalTriples = await additionalConverter.convertVault();

      // Combined triples
      let combined = ([] as unknown[]).concat(primaryTriples, additionalTriples);

      // Apply cross-vault resolution (the fix in sparql-query.ts non-cached path)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      combined = resolveCrossVaultInstanceClassWikilinks(combined as any);

      // Expect: instance subject is typed by canonical class IRI
      const instanceSubject = `obsidian://vault/assetspaces/aiknow-ontology/${INSTANCE_UID}.md`;
      const expectedClassIRI =
        "https://exocortex.my/ontology/exo#AssetSpace";

      let foundInstanceClassTriple = false;
      for (const t of combined as Array<{
        subject: IRI;
        predicate: IRI;
        object: IRI | Literal;
      }>) {
        if (
          t.subject instanceof IRI &&
          t.subject.value === instanceSubject &&
          t.predicate instanceof IRI &&
          t.predicate.value === "https://exocortex.my/ontology/exo#Instance_class" &&
          t.object instanceof IRI &&
          t.object.value === expectedClassIRI
        ) {
          foundInstanceClassTriple = true;
          break;
        }
      }

      expect(foundInstanceClassTriple).toBe(true);
    });
  });

  describe("Intra-vault wikilink targets (regression guard)", () => {
    it("intra-vault resolved wikilink target IRIs also get prefix applied", async () => {
      // Add a second file to additional vault pointing at the first by UUID
      const SECOND_UID = "11111111-2222-3333-4444-555555555555";
      const secondFilePath = path.join(additionalSubdir, `${SECOND_UID}.md`);
      fs.writeFileSync(
        secondFilePath,
        `---
exo__Asset_uid: ${SECOND_UID}
exo__Instance_class:
  - "[[${CLASS_UID}]]"
exo__Asset_label: second-additional-asset
exo__Asset_relates:
  - "[[${INSTANCE_UID}]]"
---
Second asset references first by UID.
`,
      );

      try {
        const adapter = new FileSystemVaultAdapter(additionalSubdir);
        const converter = new NoteToRDFConverter(adapter, undefined, {
          subjectIriPrefix: "assetspaces/aiknow-ontology",
        });
        const triples = await converter.convertVault();

        // The relates triple should have BOTH subject and object IRIs
        // prefixed (intra-vault target resolved via getFirstLinkpathDest).
        const secondSubject = `obsidian://vault/assetspaces/aiknow-ontology/${SECOND_UID}.md`;
        const firstAsObject = `obsidian://vault/assetspaces/aiknow-ontology/${INSTANCE_UID}.md`;

        let foundIntraVaultLink = false;
        for (const t of triples as Array<{
          subject: IRI;
          predicate: IRI;
          object: IRI | Literal;
        }>) {
          if (
            t.subject instanceof IRI &&
            t.subject.value === secondSubject &&
            t.object instanceof IRI &&
            t.object.value === firstAsObject
          ) {
            foundIntraVaultLink = true;
            break;
          }
        }

        expect(foundIntraVaultLink).toBe(true);
      } finally {
        fs.unlinkSync(secondFilePath);
      }
    });
  });
});
