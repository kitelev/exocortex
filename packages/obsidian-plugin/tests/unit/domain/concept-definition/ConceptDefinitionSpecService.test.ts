import { TFile } from "obsidian";
import type { App, CachedMetadata } from "obsidian";
import { ConceptDefinitionSpecService } from "@plugin/domain/concept-definition/ConceptDefinitionSpecService";

/**
 * ConceptDefinitionSpecService loads the VAULT-DECLARED concept-definition composition template
 * (req eb18a3a4) — a concept__ConceptDefinitionSpec + ordered exo__PrintedProperty/PrintedLiteral
 * parts compiled to a DisplayNameTemplateEngine template. No hardcoded template.
 */

const SPEC_CLASS_UID = "26358178-cf0e-4e5f-b92a-f59c6ac71908";
const CONCEPT_CLASS_UID = "dda12c48-40f3-4f1a-9f5b-8c1e2d3a4b5c";
const PRINTED_PROPERTY_UID = "7d58de40-d941-4a66-88e2-13afc4fdc41d";
const PRINTED_LITERAL_UID = "4d5437c9-788e-4a6d-9be0-4af3a84554f4";
const SPEC_UID = "e8e8475c-2e58-44a6-9f77-f907569e156e";

type Fm = { path: string; frontmatter: Record<string, unknown> };

function app(files: Fm[]): App {
  const cache = new Map<string, CachedMetadata>();
  const mockFiles: TFile[] = [];
  for (const f of files) {
    const t = new TFile(f.path);
    t.basename = f.path.replace(".md", "");
    t.extension = "md";
    mockFiles.push(t);
    cache.set(f.path, { frontmatter: f.frontmatter } as CachedMetadata);
  }
  return {
    vault: { getMarkdownFiles: jest.fn().mockReturnValue(mockFiles) },
    metadataCache: {
      getFileCache: jest.fn().mockImplementation((f: TFile) => cache.get(f.path) ?? null),
      getFirstLinkpathDest: jest.fn().mockImplementation((p: string) => {
        const clean = p.endsWith(".md") ? p : p + ".md";
        return mockFiles.find((f) => f.path === clean) ?? null;
      }),
    },
  } as unknown as App;
}

const spec = (appliesTo = `[[${CONCEPT_CLASS_UID}|concept__Concept]]`): Fm => ({
  path: `${SPEC_UID}.md`,
  frontmatter: {
    exo__Asset_uid: SPEC_UID,
    exo__Instance_class: [`[[${SPEC_CLASS_UID}|concept__ConceptDefinitionSpec]]`],
    concept__ConceptDefinitionSpec_appliesToClass: appliesTo,
  },
});
const prop = (order: number, key: string): Fm => ({
  path: `part-${key}.md`,
  frontmatter: {
    exo__Asset_uid: `part-${key}`,
    exo__Instance_class: [`[[${PRINTED_PROPERTY_UID}|exo__PrintedProperty]]`],
    exo__DisplayNamePart_of: `[[${SPEC_UID}]]`,
    exo__DisplayNamePart_order: order,
    exo__PrintedProperty_property: `[[x|${key}]]`,
  },
});
const lit = (order: number, literal: string): Fm => ({
  path: `part-lit${order}.md`,
  frontmatter: {
    exo__Asset_uid: `part-lit${order}`,
    exo__Instance_class: [`[[${PRINTED_LITERAL_UID}|exo__PrintedLiteral]]`],
    exo__DisplayNamePart_of: `[[${SPEC_UID}]]`,
    exo__DisplayNamePart_order: order,
    exo__PrintedLiteral_literal: literal,
  },
});

describe("ConceptDefinitionSpecService (req eb18a3a4)", () => {
  it("compiles ordered parts into the template", () => {
    const svc = new ConceptDefinitionSpecService(
      app([
        spec(),
        prop(0, "concept__Concept_differentia"),
        lit(1, " "),
        prop(2, "concept__Concept_genus"),
      ]),
    );
    svc.initialize();
    expect(svc.getTemplate("concept__Concept")).toBe(
      "{{concept__Concept_differentia}} {{concept__Concept_genus}}",
    );
  });

  it("dual-keys by the appliesToClass UID and label", () => {
    const svc = new ConceptDefinitionSpecService(
      app([spec(), prop(0, "concept__Concept_genus")]),
    );
    svc.initialize();
    expect(svc.getTemplate("concept__Concept")).toBe("{{concept__Concept_genus}}");
    expect(svc.getTemplate(CONCEPT_CLASS_UID)).toBe("{{concept__Concept_genus}}");
  });

  it("no spec authored → getTemplate is null (materialized-OR-computed falls through to stored)", () => {
    const svc = new ConceptDefinitionSpecService(app([]));
    svc.initialize();
    expect(svc.getTemplate("concept__Concept")).toBeNull();
  });

  it("a spec with no parts → no template (null)", () => {
    const svc = new ConceptDefinitionSpecService(app([spec()]));
    svc.initialize();
    expect(svc.getTemplate("concept__Concept")).toBeNull();
  });

  it("before initialize() → null (no vault access yet)", () => {
    const svc = new ConceptDefinitionSpecService(app([spec(), prop(0, "concept__Concept_genus")]));
    expect(svc.getTemplate("concept__Concept")).toBeNull();
  });

  it("scheduleRefresh() DEBOUNCES a burst of changes into ONE scanVault (iPhone-Jetsam crash-loop guard)", () => {
    jest.useFakeTimers();
    const a = app([spec(), prop(0, "concept__Concept_genus")]);
    const getMarkdownFiles = (a.vault as unknown as { getMarkdownFiles: jest.Mock })
      .getMarkdownFiles;
    const svc = new ConceptDefinitionSpecService(a);
    svc.initialize(); // 1 immediate scan
    getMarkdownFiles.mockClear();

    // A burst of 20 "changed" events → 20 scheduleRefresh() calls.
    for (let i = 0; i < 20; i++) svc.scheduleRefresh();
    expect(getMarkdownFiles).not.toHaveBeenCalled(); // debounced — no O(N) scan per change

    jest.advanceTimersByTime(300);
    expect(getMarkdownFiles).toHaveBeenCalledTimes(1); // ONE scan for the whole burst
    expect(svc.getTemplate("concept__Concept")).toBe("{{concept__Concept_genus}}");
    jest.useRealTimers();
  });

  it("tolerates a vault mock without a working getMarkdownFiles (does not throw)", () => {
    // The plugin's own test harness mock vault may not return an array — initialize() must not
    // throw "files is not iterable" (regression guard).
    const bare = { vault: {}, metadataCache: {} } as unknown as App;
    const svc = new ConceptDefinitionSpecService(bare);
    expect(() => svc.initialize()).not.toThrow();
    expect(svc.getTemplate("concept__Concept")).toBeNull();
  });
});
