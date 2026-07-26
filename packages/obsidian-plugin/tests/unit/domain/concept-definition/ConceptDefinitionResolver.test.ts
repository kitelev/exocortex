import { TFile } from "obsidian";
import type { App, CachedMetadata } from "obsidian";
import { ConceptDefinitionResolver } from "@plugin/domain/concept-definition/ConceptDefinitionResolver";
import { ConceptDefinitionSpecService } from "@plugin/domain/concept-definition/ConceptDefinitionSpecService";
import { PrintNameRuleService } from "@plugin/domain/display-name/PrintNameRuleService";

/**
 * Delta-2 of concept-typization (req eb18a3a4): a concept's concept__Concept_definition is a
 * HOMOICONIC COMPUTED VIEW — the composition template ("<differentia> <genus>", order, separators)
 * is VAULT-DECLARED (a concept__ConceptDefinitionSpec + ordered exo__PrintedProperty/PrintedLiteral
 * parts), loaded by ConceptDefinitionSpecService and rendered by ConceptDefinitionResolver over the
 * reused DisplayNameTemplateEngine. Production-shape: the spec + parts live in an in-memory vault,
 * compiled by the REAL spec service, resolved through a REAL metadataResolver — no hand-injected
 * template, no stubbed resolver (test-fixture-realism).
 *
 * ⛤ Homoiconicity revert-verify (axis-1) — the composition changes when the VAULT SPEC changes
 * (same concept data): the spec is the single source of truth, no hardcoded compose() in TS.
 */

const CONCEPT_DEFINITION_SPEC_CLASS_UID = "26358178-cf0e-4e5f-b92a-f59c6ac71908";
const CONCEPT_CLASS_UID = "dda12c48-40f3-4f1a-9f5b-8c1e2d3a4b5c";
const PRINTED_PROPERTY_UID = "7d58de40-d941-4a66-88e2-13afc4fdc41d";
const PRINTED_LITERAL_UID = "4d5437c9-788e-4a6d-9be0-4af3a84554f4";
const DIFF_PROP_UID = "5cc92949-0000-4000-8000-000000000001";
const GENUS_PROP_UID = "06d389ff-0000-4000-8000-000000000002";

const SPEC_UID = "e8e8475c-2e58-44a6-9f77-f907569e156e";
const OKR_UID = "0a11c0de-0000-4000-8000-000000000001";
const QUARTERLY_UID = "0a11c0de-0000-4000-8000-000000000002";
const RECURRING_UID = "0a11c0de-0000-4000-8000-000000000003";

type Fm = { path: string; frontmatter: Record<string, unknown> };

function createVaultApp(files: Fm[]): App {
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
      getFileCache: jest.fn().mockImplementation((file: TFile) => fileCache.get(file.path) ?? null),
      getFirstLinkpathDest: jest.fn().mockImplementation((path: string) => {
        const clean = path.endsWith(".md") ? path : path + ".md";
        return mockFiles.find((f) => f.path === clean) ?? null;
      }),
    },
  } as unknown as App;
}

const conceptTarget = (uid: string, label: string): Fm => ({
  path: `${uid}.md`,
  frontmatter: {
    exo__Asset_uid: uid,
    exo__Instance_class: [`[[${CONCEPT_CLASS_UID}|concept__Concept]]`],
    exo__Asset_label: label,
  },
});

/** The VAULT-DECLARED composition spec + parts. `includeGenusPart` drives revert-verify axis-1. */
function specFiles(includeGenusPart = true): Fm[] {
  const parts: Fm[] = [
    {
      path: "part-differentia.md",
      frontmatter: {
        exo__Asset_uid: "part-diff",
        exo__Instance_class: [`[[${PRINTED_PROPERTY_UID}|exo__PrintedProperty]]`],
        exo__DisplayNamePart_of: `[[${SPEC_UID}]]`,
        exo__DisplayNamePart_order: 0,
        exo__PrintedProperty_property: `[[${DIFF_PROP_UID}|concept__Concept_differentia]]`,
      },
    },
    {
      path: "part-literal.md",
      frontmatter: {
        exo__Asset_uid: "part-lit",
        exo__Instance_class: [`[[${PRINTED_LITERAL_UID}|exo__PrintedLiteral]]`],
        exo__DisplayNamePart_of: `[[${SPEC_UID}]]`,
        exo__DisplayNamePart_order: 1,
        exo__PrintedLiteral_literal: " ",
      },
    },
  ];
  if (includeGenusPart) {
    parts.push({
      path: "part-genus.md",
      frontmatter: {
        exo__Asset_uid: "part-genus",
        exo__Instance_class: [`[[${PRINTED_PROPERTY_UID}|exo__PrintedProperty]]`],
        exo__DisplayNamePart_of: `[[${SPEC_UID}]]`,
        exo__DisplayNamePart_order: 2,
        exo__PrintedProperty_property: `[[${GENUS_PROP_UID}|concept__Concept_genus]]`,
      },
    });
  }
  return [
    {
      path: `${SPEC_UID}.md`,
      frontmatter: {
        exo__Asset_uid: SPEC_UID,
        exo__Instance_class: [
          `[[${CONCEPT_DEFINITION_SPEC_CLASS_UID}|concept__ConceptDefinitionSpec]]`,
        ],
        concept__ConceptDefinitionSpec_appliesToClass: `[[${CONCEPT_CLASS_UID}|concept__Concept]]`,
        exo__Asset_label: "concept definition composition — <differentia> <genus>",
      },
    },
    ...parts,
    conceptTarget(OKR_UID, "OKR"),
    conceptTarget(QUARTERLY_UID, "quarterly"),
    conceptTarget(RECURRING_UID, "recurring"),
  ];
}

/** Build (specService, resolver) over an in-memory vault carrying the spec + parts + targets. */
function harness(includeGenusPart = true): {
  template: string | null;
  resolver: ConceptDefinitionResolver;
} {
  const app = createVaultApp(specFiles(includeGenusPart));
  const specService = new ConceptDefinitionSpecService(app);
  specService.initialize(); // REAL scanVault — compiles the vault-declared template
  const template = specService.getTemplate("concept__Concept");
  const printName = new PrintNameRuleService(app);
  const resolver = new ConceptDefinitionResolver(printName.createMetadataResolver());
  return { template, resolver };
}

describe("ConceptDefinitionResolver — vault-declared composition (req eb18a3a4)", () => {
  it("@req:eb18a3a4-42b0-47d3-98a7-16b31c5ba6da compiles the vault spec to the composition template", () => {
    const { template } = harness();
    expect(template).toBe("{{concept__Concept_differentia}} {{concept__Concept_genus}}");
  });

  it("@req:eb18a3a4-42b0-47d3-98a7-16b31c5ba6da renders '<differentia> <genus>' from the vault template + a concept's genus/differentia (1-hop labels)", () => {
    const { template, resolver } = harness();
    const definition = resolver.resolve(
      {
        concept__Concept_genus: `[[${OKR_UID}]]`,
        concept__Concept_differentia: [`[[${QUARTERLY_UID}]]`],
      },
      template,
    );
    expect(definition).toBe("quarterly OKR");
  });

  it("@req:eb18a3a4-42b0-47d3-98a7-16b31c5ba6da joins multiple differentia (authored order) via the engine's opt-in array-join", () => {
    const { template, resolver } = harness();
    const definition = resolver.resolve(
      {
        concept__Concept_genus: `[[${OKR_UID}]]`,
        concept__Concept_differentia: [`[[${RECURRING_UID}]]`, `[[${QUARTERLY_UID}]]`],
      },
      template,
    );
    expect(definition).toBe("recurring quarterly OKR");
  });

  it("@req:eb18a3a4-42b0-47d3-98a7-16b31c5ba6da resolves the [[uid|alias]] forms via the alias", () => {
    const { template, resolver } = harness();
    expect(
      resolver.resolve(
        {
          concept__Concept_genus: `[[${OKR_UID}|OKR]]`,
          concept__Concept_differentia: [`[[${QUARTERLY_UID}|quarterly]]`],
        },
        template,
      ),
    ).toBe("quarterly OKR");
  });

  // ⛤ HOMOICONICITY REVERT-VERIFY (axis-1): the composition is the VAULT SPEC, not TS.
  it("@req:eb18a3a4-42b0-47d3-98a7-16b31c5ba6da REVERT-VERIFY axis-1: editing the vault spec (dropping the genus part) changes the composition for the SAME concept — the spec is the source of truth", () => {
    const concept = {
      concept__Concept_genus: `[[${OKR_UID}]]`,
      concept__Concept_differentia: [`[[${QUARTERLY_UID}]]`],
    };
    // Spec WITH the genus part → "quarterly OKR".
    const withGenus = harness(true);
    expect(withGenus.resolver.resolve(concept, withGenus.template)).toBe("quarterly OKR");
    // Spec WITHOUT the genus part (same concept data) → the genus drops out of the composition.
    const withoutGenus = harness(false);
    expect(withoutGenus.template).toBe("{{concept__Concept_differentia}} ");
    expect(withoutGenus.resolver.resolve(concept, withoutGenus.template)).toBe("quarterly");
  });

  // --- Negative controls (materialized-OR-computed + fail-closed) ---

  it("@req:eb18a3a4-42b0-47d3-98a7-16b31c5ba6da genus ABSENT → the stored free-text is returned unchanged (materialized), resolveComputed null", () => {
    const { template, resolver } = harness();
    const stored = "A branch of inquiry into the fundamental nature of being, knowledge, and value.";
    const metadata = { concept__Concept_definition: stored };
    expect(resolver.resolve(metadata, template)).toBe(stored);
    expect(resolver.resolveComputed(metadata, template)).toBeNull();
  });

  it("@req:eb18a3a4-42b0-47d3-98a7-16b31c5ba6da FAIL-CLOSED on an UNRESOLVABLE genus: genus=[[deleted-uid]] + stored text → renders STORED (never a raw UID), resolveComputed null", () => {
    const { template, resolver } = harness();
    const stored = "the human-written definition that must be preserved";
    const metadata = {
      concept__Concept_genus: "[[deadbeef-0000-4000-8000-00000000dead]]",
      concept__Concept_definition: stored,
    };
    expect(resolver.resolve(metadata, template)).toBe(stored);
    expect(resolver.resolveComputed(metadata, template)).toBeNull();
  });

  it("@req:eb18a3a4-42b0-47d3-98a7-16b31c5ba6da NO vault spec authored (template null) → stored fallback / null (fail-closed)", () => {
    const { resolver } = harness();
    expect(
      resolver.resolve({ concept__Concept_genus: `[[${OKR_UID}]]` }, null),
    ).toBeNull();
    const stored = "kept narrative";
    expect(
      resolver.resolve(
        { concept__Concept_genus: `[[${OKR_UID}]]`, concept__Concept_definition: stored },
        null,
      ),
    ).toBe(stored);
  });

  it("@req:eb18a3a4-42b0-47d3-98a7-16b31c5ba6da fail-closed: neither genus nor stored → null (never fabricated)", () => {
    const { template, resolver } = harness();
    expect(resolver.resolve({ exo__Asset_label: "orphan concept" }, template)).toBeNull();
    expect(resolver.resolve({ concept__Concept_definition: "   " }, template)).toBeNull();
  });
});
