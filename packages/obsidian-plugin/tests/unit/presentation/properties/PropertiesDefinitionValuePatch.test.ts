import { TFile } from "obsidian";
import type { App, Plugin } from "obsidian";
import { PropertiesDefinitionValuePatch } from "@plugin/presentation/properties/PropertiesDefinitionValuePatch";

/**
 * Delta-2 concept definition-renderer (req eb18a3a4), SURFACE half: the native Properties-panel
 * definition VALUE row renders the computed "<differentia> <genus>" phrase where genus is
 * present (Reading Mode), leaving the stored free-text untouched where genus is absent. Drives
 * the REAL patch over a jsdom .metadata-container carrying a concept__Concept_definition row.
 *
 * Revert-verify (recorded in the PR body): neutralizing the patch's resolver call
 * (resolveComputed → always null) makes the "computed value shown" assertion RED; restore →
 * GREEN. The negative controls (no genus → native value untouched) stay GREEN both ways.
 */

const CONCEPT_CLASS_UID = "dda12c48-40f3-4f1a-9f5b-8c1e2d3a4b5c";
const CONCEPT_DEFINITION_SPEC_CLASS_UID = "26358178-cf0e-4e5f-b92a-f59c6ac71908";
const PRINTED_PROPERTY_UID = "7d58de40-d941-4a66-88e2-13afc4fdc41d";
const PRINTED_LITERAL_UID = "4d5437c9-788e-4a6d-9be0-4af3a84554f4";
const SPEC_UID = "e8e8475c-2e58-44a6-9f77-f907569e156e";
const OKR_UID = "0a11c0de-0000-4000-8000-000000000001";
const QUARTERLY_UID = "0a11c0de-0000-4000-8000-000000000002";
const CONCEPT_PATH = "concept-under-test.md";
const STORED_TEXT = "an outdated hand-written definition";

interface FrontmatterFile {
  file: TFile;
  frontmatter: Record<string, unknown>;
}

/** The vault-declared composition spec + parts (so the patch's spec service compiles a template). */
function specFiles(): FrontmatterFile[] {
  return [
    {
      file: mkFile(`${SPEC_UID}.md`),
      frontmatter: {
        exo__Asset_uid: SPEC_UID,
        exo__Instance_class: [
          `[[${CONCEPT_DEFINITION_SPEC_CLASS_UID}|concept__ConceptDefinitionSpec]]`,
        ],
        concept__ConceptDefinitionSpec_appliesToClass: `[[${CONCEPT_CLASS_UID}|concept__Concept]]`,
      },
    },
    {
      file: mkFile("part-differentia.md"),
      frontmatter: {
        exo__Asset_uid: "part-diff",
        exo__Instance_class: [`[[${PRINTED_PROPERTY_UID}|exo__PrintedProperty]]`],
        exo__DisplayNamePart_of: `[[${SPEC_UID}]]`,
        exo__DisplayNamePart_order: 0,
        exo__PrintedProperty_property: "[[dp|concept__Concept_differentia]]",
      },
    },
    {
      file: mkFile("part-literal.md"),
      frontmatter: {
        exo__Asset_uid: "part-lit",
        exo__Instance_class: [`[[${PRINTED_LITERAL_UID}|exo__PrintedLiteral]]`],
        exo__DisplayNamePart_of: `[[${SPEC_UID}]]`,
        exo__DisplayNamePart_order: 1,
        exo__PrintedLiteral_literal: " ",
      },
    },
    {
      file: mkFile("part-genus.md"),
      frontmatter: {
        exo__Asset_uid: "part-genus",
        exo__Instance_class: [`[[${PRINTED_PROPERTY_UID}|exo__PrintedProperty]]`],
        exo__DisplayNamePart_of: `[[${SPEC_UID}]]`,
        exo__DisplayNamePart_order: 2,
        exo__PrintedProperty_property: "[[gp|concept__Concept_genus]]",
      },
    },
  ];
}

/** Build a fake App whose vault carries the spec + parts and resolves genus/differentia to labels. */
function buildApp(
  activeFrontmatter: Record<string, unknown>,
): { app: App; conceptFile: TFile } {
  const targets: FrontmatterFile[] = [
    {
      file: mkFile(`${OKR_UID}.md`),
      frontmatter: { exo__Asset_uid: OKR_UID, exo__Asset_label: "OKR" },
    },
    {
      file: mkFile(`${QUARTERLY_UID}.md`),
      frontmatter: { exo__Asset_uid: QUARTERLY_UID, exo__Asset_label: "quarterly" },
    },
  ];
  const conceptFile = mkFile(CONCEPT_PATH);
  const all: FrontmatterFile[] = [
    ...specFiles(),
    ...targets,
    { file: conceptFile, frontmatter: activeFrontmatter },
  ];

  const app = {
    vault: { getMarkdownFiles: jest.fn().mockReturnValue(all.map((x) => x.file)) },
    metadataCache: {
      getFileCache: jest.fn().mockImplementation((f: TFile) => {
        const found = all.find((x) => x.file.path === f.path);
        return found ? { frontmatter: found.frontmatter } : null;
      }),
      getFirstLinkpathDest: jest.fn().mockImplementation((path: string) => {
        const clean = path.endsWith(".md") ? path : path + ".md";
        return all.find((x) => x.file.path === clean)?.file ?? null;
      }),
      on: jest.fn().mockReturnValue({ id: "ref" }),
    },
    workspace: {
      getLeavesOfType: jest.fn(),
      on: jest.fn().mockReturnValue({ id: "ref" }),
    },
  } as unknown as App;

  return { app, conceptFile };
}

function mkFile(path: string): TFile {
  const f = new TFile(path);
  f.basename = path.replace(".md", "");
  f.extension = "md";
  return f;
}

/**
 * Build a Reading-Mode Properties block DOM for a file with a concept__Concept_definition row,
 * attach it to document.body, and register a fake markdown leaf (view.containerEl + view.file)
 * on the app's workspace. Returns the value element for assertions.
 */
function mountPropertiesBlock(
  app: App,
  file: TFile,
  mode: "preview" | "source" = "preview",
): { valueEl: HTMLElement; containerEl: HTMLElement } {
  const containerEl = document.createElement("div");
  const metadataContainer = document.createElement("div");
  metadataContainer.className = "metadata-container";

  const propertyEl = document.createElement("div");
  propertyEl.className = "metadata-property";
  propertyEl.setAttribute("data-property-key", "concept__concept_definition");

  const keyEl = document.createElement("div");
  keyEl.className = "metadata-property-key";
  const keyInput = document.createElement("input");
  keyInput.value = "concept__Concept_definition"; // original-case predicate
  keyEl.appendChild(keyInput);

  const valueEl = document.createElement("div");
  valueEl.className = "metadata-property-value";
  valueEl.textContent = STORED_TEXT; // native Reading-Mode text value

  propertyEl.appendChild(keyEl);
  propertyEl.appendChild(valueEl);
  metadataContainer.appendChild(propertyEl);
  containerEl.appendChild(metadataContainer);
  document.body.appendChild(containerEl);

  (app.workspace.getLeavesOfType as jest.Mock).mockReturnValue([
    { view: { containerEl, file, getMode: () => mode } },
  ]);

  return { valueEl, containerEl };
}

function makePlugin(app: App): Plugin {
  return {
    app,
    registerEvent: jest.fn(),
  } as unknown as Plugin;
}

describe("PropertiesDefinitionValuePatch — Properties-panel computed definition (req eb18a3a4)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    jest.clearAllMocks();
  });

  it("@req:eb18a3a4-42b0-47d3-98a7-16b31c5ba6da overrides the concept__Concept_definition VALUE row with the computed '<differentia> <genus>' where genus is present", () => {
    const { app, conceptFile } = buildApp({
      exo__Instance_class: [`[[${CONCEPT_CLASS_UID}|concept__Concept]]`],
      concept__Concept_genus: `[[${OKR_UID}]]`,
      concept__Concept_differentia: [`[[${QUARTERLY_UID}]]`],
      concept__Concept_definition: STORED_TEXT,
    });
    const { valueEl } = mountPropertiesBlock(app, conceptFile);

    const patch = new PropertiesDefinitionValuePatch(makePlugin(app));
    patch.enable();

    // The row VALUE now shows the computed phrase, resolved 1-hop through the real resolver.
    expect(valueEl.textContent).toBe("quarterly OKR");
    // A dedicated computed-definition display span carries it (Reading-Mode display).
    const span = valueEl.querySelector<HTMLElement>(".exo-definition-display");
    expect(span?.getAttribute("data-exo-computed-definition")).toBe("true");

    // Restore leaves the native stored value intact (no frontmatter mutation — display-only).
    patch.disable();
    expect(valueEl.textContent).toBe(STORED_TEXT);
  });

  it("@req:eb18a3a4-42b0-47d3-98a7-16b31c5ba6da leaves the stored free-text VALUE untouched when genus is ABSENT (materialized, no patch)", () => {
    const { app, conceptFile } = buildApp({
      exo__Instance_class: [`[[${CONCEPT_CLASS_UID}|concept__Concept]]`],
      concept__Concept_definition: STORED_TEXT,
    });
    const { valueEl } = mountPropertiesBlock(app, conceptFile);

    const patch = new PropertiesDefinitionValuePatch(makePlugin(app));
    patch.enable();

    // No genus → nothing computed → the native stored value is shown unchanged, no display span.
    expect(valueEl.textContent).toBe(STORED_TEXT);
    expect(valueEl.querySelector(".exo-definition-display")).toBeNull();
    patch.disable();
  });

  it("@req:eb18a3a4-42b0-47d3-98a7-16b31c5ba6da does NOT override an EDITABLE value control (no edit-override — the editable definition stays editable)", () => {
    const { app, conceptFile } = buildApp({
      concept__Concept_genus: `[[${OKR_UID}]]`,
      concept__Concept_differentia: [`[[${QUARTERLY_UID}]]`],
    });
    const { valueEl } = mountPropertiesBlock(app, conceptFile);
    // The value row carries an editable input (edit-mode shape).
    valueEl.textContent = "";
    const valueInput = document.createElement("input");
    valueInput.value = STORED_TEXT;
    valueEl.appendChild(valueInput);

    const patch = new PropertiesDefinitionValuePatch(makePlugin(app));
    patch.enable();

    // Reading-mode display ONLY → the editable input is left untouched, no computed span injected.
    expect(valueEl.querySelector(".exo-definition-display")).toBeNull();
    expect(valueInput.value).toBe(STORED_TEXT);
    expect(valueEl.contains(valueInput)).toBe(true);
    patch.disable();
  });

  it("@req:eb18a3a4-42b0-47d3-98a7-16b31c5ba6da does NOT patch when the view is in EDIT (source) mode (reading-mode only)", () => {
    const { app, conceptFile } = buildApp({
      concept__Concept_genus: `[[${OKR_UID}]]`,
      concept__Concept_differentia: [`[[${QUARTERLY_UID}]]`],
      concept__Concept_definition: STORED_TEXT,
    });
    const { valueEl } = mountPropertiesBlock(app, conceptFile, "source");

    const patch = new PropertiesDefinitionValuePatch(makePlugin(app));
    patch.enable();

    // Source (edit) mode → no override; native stored value untouched.
    expect(valueEl.textContent).toBe(STORED_TEXT);
    expect(valueEl.querySelector(".exo-definition-display")).toBeNull();
    patch.disable();
  });
});
