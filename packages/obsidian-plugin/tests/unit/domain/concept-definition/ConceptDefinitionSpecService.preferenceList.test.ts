/**
 * Issue #4050 — `exo__PrintedProperty_property` meant two things.
 *
 * PR #4048 gave a multi-value property PREFERENCE-LIST semantics in the
 * display-name engine ("print the first candidate that has a value"). The other
 * consumer of the same vault predicate — `ConceptDefinitionSpecService` — kept
 * its own resolver that silently took `value[0]` and dropped the rest. Its own
 * docstring claimed it used "the SAME part vocabulary", so this was drift, not
 * a dialect: an author writing a 4-candidate list here got the first printed
 * unconditionally, with no diagnostic.
 *
 * Option 1 of the issue was taken — share the semantics — because it removes the
 * divergence rather than describing it, and because nothing downstream had to
 * change: concept-definition parts render through the SAME
 * `DisplayNameTemplateEngine`, which already walks an `a|b|c` placeholder.
 *
 * ⛤ Live radius when written: ZERO. Measured over vault-my, 44 parts carry the
 * predicate and every one is single-valued. This is a trap being closed before
 * anyone falls in, which is why the axes below are the ONLY thing pinning the
 * behaviour in either direction — there was no coverage of multi-value here at all.
 *
 * Revert-verify: restoring the `value[0]` unwrap turns the multi-value axis RED;
 * the single-value and empty axes stay GREEN in both states.
 */
import { TFile } from "obsidian";
import type { App, CachedMetadata } from "obsidian";
import { ConceptDefinitionSpecService } from "@plugin/domain/concept-definition/ConceptDefinitionSpecService";

const SPEC_CLASS_UID = "26358178-cf0e-4e5f-b92a-f59c6ac71908";
const CONCEPT_CLASS_UID = "dda12c48-40f3-4f1a-9f5b-8c1e2d3a4b5c";
const PRINTED_PROPERTY_UID = "7d58de40-d941-4a66-88e2-13afc4fdc41d";
const SPEC_UID = "e8e8475c-2e58-44a6-9f77-f907569e156e";

type Fm = { path: string; frontmatter: Record<string, unknown> };

function app(files: Fm[]): App {
  const cache = new Map<string, CachedMetadata>();
  const mockFiles: TFile[] = [];
  for (const f of files) {
    // ⛔ Built field-by-field rather than `new TFile(path)`: the runtime mock
    // accepts a path argument but obsidian's own type does not, so the sibling
    // suite's shape carries a baselined TS2554. Copying it would reproduce that
    // debt in a clean file.
    const t = Object.assign(new TFile(), {
      path: f.path,
      basename: f.path.replace(".md", ""),
      extension: "md",
    });
    mockFiles.push(t);
    cache.set(f.path, { frontmatter: f.frontmatter } as CachedMetadata);
  }
  return {
    vault: { getMarkdownFiles: jest.fn().mockReturnValue(mockFiles) },
    metadataCache: {
      getFileCache: jest
        .fn()
        .mockImplementation((f: TFile) => cache.get(f.path) ?? null),
      getFirstLinkpathDest: jest.fn().mockImplementation((p: string) => {
        const clean = p.endsWith(".md") ? p : p + ".md";
        return mockFiles.find((f) => f.path === clean) ?? null;
      }),
    },
  } as unknown as App;
}

/**
 * The vault under test, mirroring the fixture shape of the sibling suite
 * (`exo__DisplayNamePart_of` / `_order`, `appliesToClass` as an aliased wikilink).
 */
function vaultWith(property: unknown): Fm[] {
  return [
    {
      path: `${SPEC_UID}.md`,
      frontmatter: {
        exo__Asset_uid: SPEC_UID,
        exo__Instance_class: [
          `[[${SPEC_CLASS_UID}|concept__ConceptDefinitionSpec]]`,
        ],
        concept__ConceptDefinitionSpec_appliesToClass: `[[${CONCEPT_CLASS_UID}|concept__Concept]]`,
      },
    },
    {
      path: "part-under-test.md",
      frontmatter: {
        exo__Asset_uid: "part-under-test",
        exo__Instance_class: [
          `[[${PRINTED_PROPERTY_UID}|exo__PrintedProperty]]`,
        ],
        exo__DisplayNamePart_of: `[[${SPEC_UID}]]`,
        exo__DisplayNamePart_order: 0,
        exo__PrintedProperty_property: property,
      },
    },
  ];
}

function templateFor(property: unknown): string | null {
  const service = new ConceptDefinitionSpecService(app(vaultWith(property)));
  service.initialize();
  return service.getTemplate("concept__Concept");
}

describe("Issue #4050: concept-definition honours the preference list", () => {
  it("compiles a MULTI-value property into an a|b placeholder", () => {
    // The defect: this used to compile to `{{concept__Concept_definition}}`,
    // dropping the second candidate without a word.
    expect(
      templateFor([
        `[[x|concept__Concept_definition]]`,
        `[[x|concept__Concept_summary]]`,
      ]),
    ).toBe("{{concept__Concept_definition|concept__Concept_summary}}");
  });

  it("keeps the order the author wrote", () => {
    // A preference list is ORDERED — reversing it must reverse the placeholder,
    // otherwise "first that has a value" is meaningless.
    expect(
      templateFor([
        `[[x|concept__Concept_summary]]`,
        `[[x|concept__Concept_definition]]`,
      ]),
    ).toBe("{{concept__Concept_summary|concept__Concept_definition}}");
  });

  it("leaves a SINGLE-value property byte-identical", () => {
    // Canary — green in BOTH states. Every one of the 44 live parts is this shape.
    expect(templateFor(`[[x|concept__Concept_definition]]`)).toBe(
      "{{concept__Concept_definition}}",
    );
  });

  it("leaves a ONE-element list byte-identical", () => {
    // Canary — green in BOTH states. A one-element list is not a preference.
    expect(templateFor([`[[x|concept__Concept_definition]]`])).toBe(
      "{{concept__Concept_definition}}",
    );
  });

  it("yields no template when the list is empty", () => {
    // Canary — green in BOTH states.
    expect(templateFor([])).toBeNull();
  });
});
