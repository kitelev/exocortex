import { TFile } from "obsidian";
import type { App, CachedMetadata } from "obsidian";
import { ConceptDefinitionResolver } from "@plugin/domain/concept-definition/ConceptDefinitionResolver";
import { PrintNameRuleService } from "@plugin/domain/display-name/PrintNameRuleService";

/**
 * Delta-2 of concept-typization (req eb18a3a4): a concept's concept__Concept_definition is a
 * COMPUTED VIEW from its genus + differentia. Production-shape: the resolver runs over a REAL
 * PrintNameRuleService.createMetadataResolver() (the same 1-hop label resolution the native
 * displayName patches use) against an in-memory vault carrying SYNTHETIC typed concepts — no
 * hand-injected label, no stubbed resolver (test-fixture-realism).
 *
 * Revert-verify axes (recorded in the PR body):
 *  - Break the composition (drop the differentia OR the genus from compose) → the
 *    "quarterly OKR" assertions go RED; restore → GREEN.
 *  - Negative controls (no genus → stored free-text; neither → null) stay GREEN both ways.
 */

// Canonical concept-typization UIDs (Delta-1 TBox, verified in-vault this session).
const CONCEPT_CLASS_UID = "dda12c48-40f3-4f1a-9f5b-8c1e2d3a4b5c"; // concept__Concept (label-form used below)
const OKR_UID = "0a11c0de-0000-4000-8000-000000000001";
const QUARTERLY_UID = "0a11c0de-0000-4000-8000-000000000002";
const RECURRING_UID = "0a11c0de-0000-4000-8000-000000000003";
const PROFESSION_UID = "0a11c0de-0000-4000-8000-000000000004";
const ROLE_UID = "0a11c0de-0000-4000-8000-000000000005";
const PM_UID = "0a11c0de-0000-4000-8000-000000000006";

/**
 * In-memory vault mock exposing the surface PrintNameRuleService.createMetadataResolver reads
 * (getFirstLinkpathDest + getFileCache). The concept targets carry real exo__Asset_label so the
 * 1-hop resolution is exercised end-to-end.
 */
function createConceptVaultApp(
  files: Array<{ path: string; frontmatter: Record<string, unknown> }>,
): App {
  const fileCache = new Map<string, CachedMetadata>();
  const mockFiles: TFile[] = [];
  for (const f of files) {
    const tfile = new TFile(f.path);
    tfile.basename = f.path.replace(".md", "");
    tfile.extension = "md";
    mockFiles.push(tfile);
    fileCache.set(f.path, { frontmatter: f.frontmatter } as CachedMetadata);
  }
  return {
    vault: { getMarkdownFiles: jest.fn().mockReturnValue(mockFiles) },
    metadataCache: {
      getFileCache: jest
        .fn()
        .mockImplementation((file: TFile) => fileCache.get(file.path) ?? null),
      getFirstLinkpathDest: jest.fn().mockImplementation((path: string) => {
        const clean = path.endsWith(".md") ? path : path + ".md";
        return mockFiles.find((f) => f.path === clean) ?? null;
      }),
    },
  } as unknown as App;
}

/** Concept target assets (genus/differentia values point at these) carrying their labels. */
function conceptTargetFiles(): Array<{ path: string; frontmatter: Record<string, unknown> }> {
  const concept = (uid: string, label: string) => ({
    path: `${uid}.md`,
    frontmatter: {
      exo__Asset_uid: uid,
      exo__Instance_class: [`[[${CONCEPT_CLASS_UID}|concept__Concept]]`],
      exo__Asset_label: label,
    },
  });
  return [
    concept(OKR_UID, "OKR"),
    concept(QUARTERLY_UID, "quarterly"),
    concept(RECURRING_UID, "recurring"),
    concept(PROFESSION_UID, "Profession"),
    concept(ROLE_UID, "Project Role"),
    concept(PM_UID, "Project Manager"),
  ];
}

/** Build a ConceptDefinitionResolver wired to a REAL PrintNameRuleService metadataResolver. */
function resolverOverVault(): ConceptDefinitionResolver {
  const app = createConceptVaultApp(conceptTargetFiles());
  const printNameRuleService = new PrintNameRuleService(app);
  return new ConceptDefinitionResolver(printNameRuleService.createMetadataResolver());
}

describe("ConceptDefinitionResolver — computed view from genus + differentia (req eb18a3a4)", () => {
  it("@req:eb18a3a4-42b0-47d3-98a7-16b31c5ba6da computes '<differentia> <genus>' from genus + one differentia, resolving each 1-hop to its exo__Asset_label", () => {
    const resolver = resolverOverVault();
    const definition = resolver.resolve({
      exo__Instance_class: [`[[${CONCEPT_CLASS_UID}|concept__Concept]]`],
      concept__Concept_genus: `[[${OKR_UID}]]`,
      concept__Concept_differentia: [`[[${QUARTERLY_UID}]]`],
    });
    // "quarterly OKR" — labels resolved through the REAL metadataResolver, NOT any stored text.
    expect(definition).toBe("quarterly OKR");
  });

  it("@req:eb18a3a4-42b0-47d3-98a7-16b31c5ba6da joins multiple differentia as space-separated adjectives before the genus (authored order)", () => {
    const resolver = resolverOverVault();
    const definition = resolver.resolve({
      concept__Concept_genus: `[[${OKR_UID}]]`,
      concept__Concept_differentia: [`[[${RECURRING_UID}]]`, `[[${QUARTERLY_UID}]]`],
    });
    expect(definition).toBe("recurring quarterly OKR");
  });

  it("@req:eb18a3a4-42b0-47d3-98a7-16b31c5ba6da renders the rare conjunctive upper-ontology genus as '<differentia> [genus1 ∧ genus2]'", () => {
    const resolver = resolverOverVault();
    const definition = resolver.resolve({
      concept__Concept_genus: [`[[${PROFESSION_UID}]]`, `[[${ROLE_UID}]]`],
      concept__Concept_differentia: [`[[${PM_UID}]]`],
    });
    expect(definition).toBe("Project Manager [Profession ∧ Project Role]");
  });

  it("@req:eb18a3a4-42b0-47d3-98a7-16b31c5ba6da resolves the [[uid|alias]] genus form via the alias (no hop)", () => {
    const resolver = resolverOverVault();
    const definition = resolver.resolve({
      concept__Concept_genus: `[[${OKR_UID}|OKR]]`,
      concept__Concept_differentia: [`[[${QUARTERLY_UID}|quarterly]]`],
    });
    expect(definition).toBe("quarterly OKR");
  });

  it("@req:eb18a3a4-42b0-47d3-98a7-16b31c5ba6da a genus with NO differentia renders just the genus label", () => {
    const resolver = resolverOverVault();
    expect(
      resolver.resolve({ concept__Concept_genus: `[[${OKR_UID}]]` }),
    ).toBe("OKR");
  });

  // --- Negative controls (materialized-OR-computed + fail-closed) ---

  it("@req:eb18a3a4-42b0-47d3-98a7-16b31c5ba6da genus ABSENT → the stored free-text is returned unchanged (materialized), and resolveComputed is null", () => {
    const resolver = resolverOverVault();
    const stored = "A branch of inquiry into the fundamental nature of being, knowledge, and value.";
    const metadata = { concept__Concept_definition: stored };
    expect(resolver.resolve(metadata)).toBe(stored);
    // resolveComputed distinguishes computed from stored → null (no genus) so the patch does NOT override.
    expect(resolver.resolveComputed(metadata)).toBeNull();
  });

  it("@req:eb18a3a4-42b0-47d3-98a7-16b31c5ba6da fail-closed: neither genus nor stored free-text → null (never fabricated)", () => {
    const resolver = resolverOverVault();
    expect(resolver.resolve({ exo__Asset_label: "orphan concept" })).toBeNull();
    expect(resolver.resolveComputed({ exo__Asset_label: "orphan concept" })).toBeNull();
    // empty stored text is also fail-closed
    expect(resolver.resolve({ concept__Concept_definition: "   " })).toBeNull();
  });

  it("@req:eb18a3a4-42b0-47d3-98a7-16b31c5ba6da FAIL-CLOSED on an UNRESOLVABLE genus: genus=[[deleted-uid]] + stored text → renders the STORED text (never a raw UID), resolveComputed null", () => {
    const resolver = resolverOverVault();
    const DELETED_UID = "deadbeef-0000-4000-8000-00000000dead"; // not in the vault → no label
    const stored = "the human-written definition that must be preserved";
    const metadata = {
      concept__Concept_genus: `[[${DELETED_UID}]]`,
      concept__Concept_definition: stored,
    };
    // A genus that resolves ONLY to a raw UID is not a usable token → fall through to STORED.
    expect(resolver.resolve(metadata)).toBe(stored);
    expect(resolver.resolveComputed(metadata)).toBeNull();
  });

  it("@req:eb18a3a4-42b0-47d3-98a7-16b31c5ba6da an unresolvable genus with NO stored text → null (never renders the raw UID)", () => {
    const resolver = resolverOverVault();
    expect(
      resolver.resolve({ concept__Concept_genus: "[[deadbeef-0000-4000-8000-00000000dead]]" }),
    ).toBeNull();
  });

  it("@req:eb18a3a4-42b0-47d3-98a7-16b31c5ba6da genus present + stored text → the COMPUTED value wins (materialized-OR-computed)", () => {
    const resolver = resolverOverVault();
    const metadata = {
      concept__Concept_genus: `[[${OKR_UID}]]`,
      concept__Concept_differentia: [`[[${QUARTERLY_UID}]]`],
      concept__Concept_definition: "an outdated hand-written definition",
    };
    expect(resolver.resolve(metadata)).toBe("quarterly OKR");
    expect(resolver.resolveComputed(metadata)).toBe("quarterly OKR");
  });
});
