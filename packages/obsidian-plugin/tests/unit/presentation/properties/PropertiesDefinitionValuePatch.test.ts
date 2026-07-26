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
const OKR_UID = "0a11c0de-0000-4000-8000-000000000001";
const QUARTERLY_UID = "0a11c0de-0000-4000-8000-000000000002";
const CONCEPT_PATH = "concept-under-test.md";
const STORED_TEXT = "an outdated hand-written definition";

interface FrontmatterFile {
  file: TFile;
  frontmatter: Record<string, unknown>;
}

/** Build a fake App whose metadataCache resolves the genus/differentia targets to their labels. */
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
    ...targets,
    { file: conceptFile, frontmatter: activeFrontmatter },
  ];

  const app = {
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
    { view: { containerEl, file } },
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

  it("@req:eb18a3a4-42b0-47d3-98a7-16b31c5ba6da hides the native editable value control and shows the computed value when the value row carries an input", () => {
    const { app, conceptFile } = buildApp({
      concept__Concept_genus: `[[${OKR_UID}]]`,
      concept__Concept_differentia: [`[[${QUARTERLY_UID}]]`],
    });
    const { valueEl } = mountPropertiesBlock(app, conceptFile);
    // Replace the text value with an editable input (Live-Preview-leak shape).
    valueEl.textContent = "";
    const valueInput = document.createElement("input");
    valueInput.value = STORED_TEXT;
    valueEl.appendChild(valueInput);

    const patch = new PropertiesDefinitionValuePatch(makePlugin(app));
    patch.enable();

    const span = valueEl.querySelector<HTMLElement>(".exo-definition-display");
    expect(span?.textContent).toBe("quarterly OKR");
    // The native input is hidden (never mutated) and the stored value is preserved on it.
    expect(valueInput.classList.contains("exo-definition-hidden")).toBe(true);
    expect(valueInput.value).toBe(STORED_TEXT);

    patch.disable();
    expect(valueInput.classList.contains("exo-definition-hidden")).toBe(false);
    expect(valueEl.querySelector(".exo-definition-display")).toBeNull();
  });
});
