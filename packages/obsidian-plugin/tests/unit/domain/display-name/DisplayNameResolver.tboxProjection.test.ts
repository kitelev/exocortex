import { PrintNameRuleService } from "@plugin/domain/display-name/PrintNameRuleService";
import { DisplayNameResolver } from "@plugin/domain/display-name/DisplayNameResolver";
import type { DisplayNameSettings } from "@plugin/domain/settings/ExocortexSettings";
import { TFile } from "obsidian";
import type { App, CachedMetadata } from "obsidian";

/**
 * Production-shape fixture-vault harness (mirrors PrintNameRuleService.test.ts): a mock App
 * whose metadataCache resolves getFirstLinkpathDest + getFileCache over authored fixture files,
 * so the DisplayNameResolver's REAL metadataResolver (PrintNameRuleService.createMetadataResolver)
 * performs the exo__Asset_isDefinedBy -> ontology-frontmatter two-hop just as in Obsidian.
 */
function createMockApp(
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
    vault: {
      getMarkdownFiles: jest.fn().mockReturnValue(mockFiles),
    },
    metadataCache: {
      getFileCache: jest
        .fn()
        .mockImplementation((file: TFile) => fileCache.get(file.path) ?? null),
      getFirstLinkpathDest: jest.fn().mockImplementation((path: string) => {
        const cleanPath = path.endsWith(".md") ? path : path + ".md";
        return mockFiles.find((f) => f.path === cleanPath) ?? null;
      }),
    },
  } as unknown as App;
}

// --- Slugable-mixin metaclass UIDs (verified live TBox 2026-07-29) ---
const EXO_CLASS = "8619c4fc-64f1-4869-b17e-e34186cacca9";
const EXO_DATATYPE_PROPERTY = "ae56ca4c-b610-42a4-a25d-058c23673296";
const DISPLAY_NAME_SPEC_UID = "07eab746-0874-4676-9d98-dbaad1bc6fb8";
const PRINTED_LITERAL_UID = "4d5437c9-788e-4a6d-9be0-4af3a84554f4";

// --- namespace ontologies ---
const EMS_ONTO = "f6e01f7a-d727-494a-82a3-815597d33e86"; // has exo__Ontology_shortName "ems"
const NOSN_ONTO = "aaaa1111-0000-4000-8000-000000000001"; // an ontology with NO shortName

// --- fixture frontmatters (TBox naming entities + one ABox control) ---
// Populated class-def: slug field + a namespace ontology that carries shortName.
const TASK_PROTO_FM = {
  exo__Asset_uid: "df7e579d-02d4-4f3a-971f-3d1d785b689b",
  exo__Asset_label: "ems__TaskPrototype",
  exo__Instance_class: [`[[${EXO_CLASS}]]`],
  exo__Slugable_slug: "TaskPrototype",
  exo__Asset_isDefinedBy: `[[${EMS_ONTO}]]`,
};
// Populated property-def.
const EFFORT_STATUS_FM = {
  exo__Asset_uid: "bbbb2222-0000-4000-8000-000000000002",
  exo__Asset_label: "ems__Effort_status",
  exo__Instance_class: [`[[${EXO_DATATYPE_PROPERTY}]]`],
  exo__Slugable_slug: "Effort_status",
  exo__Asset_isDefinedBy: `[[${EMS_ONTO}]]`,
};
// FALLBACK class-def: NO slug field, ontology has NO shortName → derive BOTH from the label.
const WCHECK_FM = {
  exo__Asset_uid: "cccc3333-0000-4000-8000-000000000003",
  exo__Asset_label: "ems__WaitingCheckTaskPrototype",
  exo__Instance_class: [`[[${EXO_CLASS}]]`],
  exo__Asset_isDefinedBy: `[[${NOSN_ONTO}]]`,
};
// ORPHAN-NAMESPACE class-def: slug present, ontology has NO shortName → derive prefix from label.
const OKR_FM = {
  exo__Asset_uid: "dddd4444-0000-4000-8000-000000000004",
  exo__Asset_label: "okr__Objective",
  exo__Instance_class: [`[[${EXO_CLASS}]]`],
  exo__Slugable_slug: "Objective",
  exo__Asset_isDefinedBy: `[[${NOSN_ONTO}]]`,
};
// ABox instance control — NOT a Slugable metaclass, no slug → projection never fires.
const TASK_FM = {
  exo__Asset_uid: "eeee5555-0000-4000-8000-000000000005",
  exo__Asset_label: "Купить молоко",
  exo__Instance_class: ["[[ems__Task]]"],
};
// ABox instance that DEFENSIVELY carries a slug field — detection is metaclass-only, so it must
// NOT be hijacked into a prefix#slug projection (RFC v3 points 8/11: slug is a TBox concern).
const ABOX_WITH_SLUG_FM = {
  exo__Asset_uid: "ffff8888-0000-4000-8000-000000000008",
  exo__Asset_label: "Some Free-Form Label",
  exo__Instance_class: ["[[ems__Task]]"],
  exo__Slugable_slug: "ShouldNotProject",
};

const ONTOLOGY_FILES = [
  {
    path: `${EMS_ONTO}.md`,
    frontmatter: {
      exo__Asset_uid: EMS_ONTO,
      exo__Asset_label: "$ems",
      exo__Ontology_shortName: "ems",
    },
  },
  {
    // Mirrors today's PRODUCTION anchor shape: exo__Ontology_url present, NO shortName yet.
    path: `${NOSN_ONTO}.md`,
    frontmatter: {
      exo__Asset_uid: NOSN_ONTO,
      exo__Asset_label: "$nosn",
      exo__Ontology_url: "https://exocortex.my/ontology/nosn#",
    },
  },
];

function namingVault(): App {
  return createMockApp([
    ...ONTOLOGY_FILES,
    { path: "taskproto.md", frontmatter: TASK_PROTO_FM },
    { path: "effortstatus.md", frontmatter: EFFORT_STATUS_FM },
    { path: "wcheck.md", frontmatter: WCHECK_FM },
    { path: "okr.md", frontmatter: OKR_FM },
    { path: "task.md", frontmatter: TASK_FM },
    { path: "abox-slug.md", frontmatter: ABOX_WITH_SLUG_FM },
  ]);
}

function makeResolver(app: App, projectTBoxNames = true): DisplayNameResolver {
  const settings: DisplayNameSettings = {
    defaultTemplate: "{{exo__Asset_label}}",
    classTemplates: {},
    projectTBoxNames,
  };
  const svc = new PrintNameRuleService(app);
  svc.initialize();
  return new DisplayNameResolver(settings, svc, svc.createMetadataResolver());
}

const render = (
  r: DisplayNameResolver,
  fm: Record<string, unknown>,
  basename: string,
): string | null => r.resolve({ metadata: fm, basename });

describe("DisplayNameResolver — TBox naming projection prefix#slug (RFC 78572fa9 Candidate B Phase 2)", () => {
  it("@req:318af6a2-2c56-4db4-900e-dd0d0e36362b projects a populated class-def to prefix#slug, and the projectTBoxNames toggle is the revert axis (raw label OFF / prefix#slug ON)", () => {
    const app = namingVault();

    // GREEN: projection ON → the ontology shortName ("ems") + the slug ("TaskPrototype").
    const on = makeResolver(app, true);
    expect(
      render(on, TASK_PROTO_FM, "df7e579d-02d4-4f3a-971f-3d1d785b689b"),
    ).toBe("ems#TaskPrototype");

    // RED: projection OFF → the raw exo__Asset_label (baseline, pre-projection behaviour).
    const off = makeResolver(app, false);
    expect(
      render(off, TASK_PROTO_FM, "df7e579d-02d4-4f3a-971f-3d1d785b689b"),
    ).toBe("ems__TaskPrototype");
  });

  it("@req:318af6a2-2c56-4db4-900e-dd0d0e36362b projects a populated property-def to prefix#slug", () => {
    const r = makeResolver(namingVault(), true);
    expect(
      render(r, EFFORT_STATUS_FM, "bbbb2222-0000-4000-8000-000000000002"),
    ).toBe("ems#Effort_status");
  });

  it("@req:318af6a2-2c56-4db4-900e-dd0d0e36362b FALLBACK: an unpopulated class-def (no slug, ontology no shortName) derives prefix+slug from the label", () => {
    const r = makeResolver(namingVault(), true);
    // slug ← label local-name "WaitingCheckTaskPrototype"; prefix ← label prefix "ems".
    expect(render(r, WCHECK_FM, "cccc3333-0000-4000-8000-000000000003")).toBe(
      "ems#WaitingCheckTaskPrototype",
    );
  });

  it("@req:318af6a2-2c56-4db4-900e-dd0d0e36362b ORPHAN-NS: slug present but the ontology has no shortName → prefix derived from the label", () => {
    const r = makeResolver(namingVault(), true);
    expect(render(r, OKR_FM, "dddd4444-0000-4000-8000-000000000004")).toBe(
      "okr#Objective",
    );
  });

  it("@req:318af6a2-2c56-4db4-900e-dd0d0e36362b NO REGRESSION: an ABox instance is byte-identical (projection never fires — not a Slugable metaclass)", () => {
    const on = makeResolver(namingVault(), true);
    const off = makeResolver(namingVault(), false);
    // The default template {{exo__Asset_label}} renders the label, identical whether the projection is on or off.
    expect(render(on, TASK_FM, "eeee5555-0000-4000-8000-000000000005")).toBe(
      "Купить молоко",
    );
    expect(render(off, TASK_FM, "eeee5555-0000-4000-8000-000000000005")).toBe(
      "Купить молоко",
    );
  });

  it("@req:318af6a2-2c56-4db4-900e-dd0d0e36362b DETECTION is metaclass-only: an ABox instance that carries a slug field is NOT hijacked into a projection", () => {
    const r = makeResolver(namingVault(), true);
    // ems__Task is not a Slugable metaclass → the projection never fires, even with a slug field present.
    expect(
      render(r, ABOX_WITH_SLUG_FM, "ffff8888-0000-4000-8000-000000000008"),
    ).toBe("Some Free-Form Label");
  });

  it("@req:318af6a2-2c56-4db4-900e-dd0d0e36362b PRECEDENCE: a participating exo__DisplayNameSpec wins over the projection", () => {
    // A spec on the exo__Class metaclass (the override point for ALL class-def display) participates
    // for the class-def (its exo__Instance_class = exo__Class) → the projection is subordinate.
    const specVault = createMockApp([
      ...ONTOLOGY_FILES,
      { path: "taskproto.md", frontmatter: TASK_PROTO_FM },
      {
        path: "spec.md",
        frontmatter: {
          exo__Asset_uid: "ffff6666-0000-4000-8000-000000000006",
          exo__Instance_class: [
            `[[${DISPLAY_NAME_SPEC_UID}|exo__DisplayNameSpec]]`,
          ],
          exo__DisplayNameSpec_appliesToClass: `[[${EXO_CLASS}|exo__Class]]`,
          exo__DisplayNameSpec_priority: 5,
        },
      },
      {
        path: "spec-part.md",
        frontmatter: {
          exo__Asset_uid: "aaaa7777-0000-4000-8000-000000000007",
          exo__Instance_class: [
            `[[${PRINTED_LITERAL_UID}|exo__PrintedLiteral]]`,
          ],
          exo__DisplayNamePart_of: "[[ffff6666-0000-4000-8000-000000000006]]",
          exo__DisplayNamePart_order: 1,
          exo__PrintedLiteral_literal: "CLASS-SPEC-WINS",
        },
      },
    ]);
    const r = makeResolver(specVault, true);
    // The DisplayNameSpec template renders (NOT the ems#TaskPrototype projection).
    expect(
      render(r, TASK_PROTO_FM, "df7e579d-02d4-4f3a-971f-3d1d785b689b"),
    ).toBe("CLASS-SPEC-WINS");
  });
});
