/**
 * Issue #3352 — broader synthesis for label-form wikilinks targeting an
 * `--also` vault. Sub-task A of #3282.
 *
 * Scenario:
 *   primaryVault/  — contains an asset whose frontmatter has a label-form
 *     wikilink (`ems__Effort_area: "[[Барик (Area)]]"`). The target file
 *     does NOT exist in this vault.
 *
 *   additionalRoot/assetspaces/areas/  — contains the target file, a
 *     UID-named area asset with `aliases: ["Барик (Area)"]`. The user
 *     loads this vault via `--also`.
 *
 * Pre-fix:
 *   Primary's `FileSystemVaultAdapter.getFirstLinkpathDest` only scans its
 *   own root. The label-form wikilink misses, falls through the
 *   non-UUID synthesis branch in `NoteToRDFConverter`, and is emitted as
 *   a bare Literal `"[[Барик (Area)]]"`. SPARQL queries on
 *   `ems:Effort_area` see a Literal where they expect an IRI.
 *
 * Post-fix:
 *   Primary adapter is constructed with `siblingAdapters` populated by
 *   the sparql-query.ts `--also` plumbing. Step 5 of
 *   `getFirstLinkpathDest` iterates the siblings, finds the alias match
 *   in the additional vault, and returns an `IFile` whose `path` is the
 *   logical cross-vault path (`assetspaces/areas/<area-uid>.md`).
 *   `NoteToRDFConverter` emits the canonical IRI
 *   `obsidian://vault/assetspaces/areas/<area-uid>.md`.
 *
 * Empirical revert-verify discipline: this test FAILS pre-fix and PASSES
 * post-fix (see `~/dotfiles/.claude/rules/integration-test-revert-verify.md`).
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const { NoteToRDFConverter, IRI, Literal } = await import("exocortex");
const { FileSystemVaultAdapter } = await import(
  "../../src/adapters/FileSystemVaultAdapter.js"
);
const { deriveSubjectIriPrefix } = await import(
  "../../src/utils/AlsoVaultMountPrefix.js"
);

const AREA_UID = "e266a2e9-9eb0-431d-b1fe-b95b9d3e9a3f";
const TASK_UID = "9a3f0b5e-1234-4abc-9def-fedcba987654";
const TASK_CLASS_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e";
const AREA_CLASS_UID = "9b88b0d9-1234-4abc-9def-cafebabe0001";
const AREA_LABEL = "Барик (Area)";

let tmpRoot: string;
let primaryVault: string;
let additionalRoot: string;
let additionalAreasSubdir: string;

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "exo-3352-"));
  primaryVault = path.join(tmpRoot, "primary");
  additionalRoot = path.join(tmpRoot, "additional");
  additionalAreasSubdir = path.join(additionalRoot, "assetspaces", "areas");

  fs.mkdirSync(primaryVault, { recursive: true });
  fs.mkdirSync(additionalAreasSubdir, { recursive: true });

  // Primary vault: task asset that wikilinks the label-form area target.
  // The target file does NOT exist in this vault.
  // `exo__Instance_class` is required by `NoteToRDFConverter.validateExocortexAsset`;
  // pointing it at a UID-form wikilink (not declared cross-vault) keeps the
  // shape valid without polluting the test's wikilink-resolution surface.
  fs.writeFileSync(
    path.join(primaryVault, `${TASK_UID}.md`),
    `---
exo__Asset_uid: ${TASK_UID}
exo__Asset_label: Test Task
exo__Instance_class: "[[${TASK_CLASS_UID}]]"
ems__Effort_area: "[[${AREA_LABEL}]]"
---
Task body.
`,
  );

  // Additional vault: area asset, UID-named, with the label as an alias.
  fs.writeFileSync(
    path.join(additionalAreasSubdir, `${AREA_UID}.md`),
    `---
exo__Asset_uid: ${AREA_UID}
exo__Asset_label: ${AREA_LABEL}
exo__Instance_class: "[[${AREA_CLASS_UID}]]"
aliases:
  - ${AREA_LABEL}
---
Area body.
`,
  );
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("Issue #3352: broader synthesis for label-form wikilinks in --also vault", () => {
  describe("FileSystemVaultAdapter Step 5 sibling fallback", () => {
    it("resolves alias-match in a sibling adapter and returns the logical cross-vault path", () => {
      const subjectIriPrefix = deriveSubjectIriPrefix(additionalAreasSubdir);
      expect(subjectIriPrefix).toBe("assetspaces/areas");

      const siblingAdapter = new FileSystemVaultAdapter(
        additionalAreasSubdir,
        { subjectIriPrefix },
      );
      const primaryAdapter = new FileSystemVaultAdapter(primaryVault, {
        siblingAdapters: [siblingAdapter],
      });

      const resolved = primaryAdapter.getFirstLinkpathDest(
        AREA_LABEL,
        `${TASK_UID}.md`,
      );

      expect(resolved).not.toBeNull();
      expect(resolved!.path).toBe(`assetspaces/areas/${AREA_UID}.md`);
      expect(resolved!.basename).toBe(AREA_UID);
    });

    it("returns null when sibling list is empty (regression guard for single-vault behaviour)", () => {
      const primaryAdapter = new FileSystemVaultAdapter(primaryVault);
      const resolved = primaryAdapter.getFirstLinkpathDest(
        AREA_LABEL,
        `${TASK_UID}.md`,
      );
      expect(resolved).toBeNull();
    });

    it("skips siblings without a subjectIriPrefix (cannot disambiguate paths)", () => {
      // Sibling with empty prefix — Step 5 should silently skip it so the
      // sibling's files don't leak into primary's namespace.
      const siblingNoPrefix = new FileSystemVaultAdapter(additionalAreasSubdir);
      const primaryAdapter = new FileSystemVaultAdapter(primaryVault, {
        siblingAdapters: [siblingNoPrefix],
      });
      const resolved = primaryAdapter.getFirstLinkpathDest(
        AREA_LABEL,
        `${TASK_UID}.md`,
      );
      expect(resolved).toBeNull();
    });
  });

  describe("End-to-end: cross-vault label-form wikilink emits IRI, not Literal", () => {
    it("primary converter (with sibling adapter) emits canonical cross-vault IRI for the area reference", async () => {
      const subjectIriPrefix = deriveSubjectIriPrefix(additionalAreasSubdir);
      const siblingAdapter = new FileSystemVaultAdapter(
        additionalAreasSubdir,
        { subjectIriPrefix },
      );
      const primaryAdapter = new FileSystemVaultAdapter(primaryVault, {
        siblingAdapters: [siblingAdapter],
      });
      const primaryConverter = new NoteToRDFConverter(primaryAdapter);
      const triples = await primaryConverter.convertVault();

      const expectedAreaIRI = `obsidian://vault/assetspaces/areas/${AREA_UID}.md`;
      const taskSubjectIRI = `obsidian://vault/${TASK_UID}.md`;
      const areaPredicateIRI =
        "https://exocortex.my/ontology/ems#Effort_area";

      let foundAreaIRITriple = false;
      let foundAreaLiteralTriple = false;
      for (const t of triples as Array<{
        subject: IRI;
        predicate: IRI;
        object: IRI | Literal;
      }>) {
        if (
          !(t.subject instanceof IRI) ||
          t.subject.value !== taskSubjectIRI ||
          !(t.predicate instanceof IRI) ||
          t.predicate.value !== areaPredicateIRI
        ) {
          continue;
        }
        if (t.object instanceof IRI && t.object.value === expectedAreaIRI) {
          foundAreaIRITriple = true;
        }
        if (
          t.object instanceof Literal &&
          t.object.value.includes(AREA_LABEL)
        ) {
          foundAreaLiteralTriple = true;
        }
      }

      // Post-fix: IRI triple present, bare-Literal triple absent.
      expect(foundAreaIRITriple).toBe(true);
      expect(foundAreaLiteralTriple).toBe(false);
    });

    it("without siblings, primary emits bare Literal for the same label-form wikilink (single-vault regression guard)", async () => {
      const primaryAdapter = new FileSystemVaultAdapter(primaryVault);
      const primaryConverter = new NoteToRDFConverter(primaryAdapter);
      const triples = await primaryConverter.convertVault();

      const taskSubjectIRI = `obsidian://vault/${TASK_UID}.md`;
      const areaPredicateIRI =
        "https://exocortex.my/ontology/ems#Effort_area";

      let foundLiteral = false;
      for (const t of triples as Array<{
        subject: IRI;
        predicate: IRI;
        object: IRI | Literal;
      }>) {
        if (
          t.subject instanceof IRI &&
          t.subject.value === taskSubjectIRI &&
          t.predicate instanceof IRI &&
          t.predicate.value === areaPredicateIRI &&
          t.object instanceof Literal &&
          t.object.value.includes(AREA_LABEL)
        ) {
          foundLiteral = true;
          break;
        }
      }
      expect(foundLiteral).toBe(true);
    });
  });
});
