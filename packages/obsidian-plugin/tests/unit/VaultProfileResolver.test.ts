import { VaultProfileResolver } from "../../src/infrastructure/adapters/VaultProfileResolver";
import {
  FOCUS_PROFILE_CLASS_UID,
  KNOWLEDGE_PROFILE_CLASS_UID,
} from "../../src/infrastructure/adapters/FocusProfileSwitchManager";

interface FakeFile {
  path: string;
  basename: string;
}

function makeApp(files: { file: FakeFile; fm: Record<string, unknown> }[]) {
  const fileList = files.map((f) => f.file);
  const fmByPath = new Map(files.map((f) => [f.file.path, f.fm]));
  return {
    vault: {
      getMarkdownFiles: () => fileList,
    },
    metadataCache: {
      getFileCache: (file: FakeFile) => {
        const fm = fmByPath.get(file.path);
        return fm !== undefined ? { frontmatter: fm } : null;
      },
    },
  } as any;
}

describe("VaultProfileResolver.listFocusProfileFiles", () => {
  it("returns files whose Instance_class wikilink contains the FocusProfile UID", () => {
    const app = makeApp([
      {
        file: { path: "a.md", basename: "a" },
        fm: {
          exo__Instance_class: `[[${FOCUS_PROFILE_CLASS_UID}|exo__FocusProfile]]`,
          exo__Asset_uid: "p1",
          exo__Asset_label: "Profile One",
        },
      },
      {
        file: { path: "b.md", basename: "b" },
        fm: {
          exo__Instance_class: "[[some-other-class]]",
          exo__Asset_uid: "x",
        },
      },
      {
        file: { path: "c.md", basename: "c" },
        fm: {
          exo__Instance_class: [
            "[[ems__Project]]",
            `[[${FOCUS_PROFILE_CLASS_UID}|exo__FocusProfile]]`,
          ],
          exo__Asset_uid: "p2",
        },
      },
    ]);
    const resolver = new VaultProfileResolver(app);
    const found = resolver.listFocusProfileFiles().map((f) => f.path);
    expect(found.sort()).toEqual(["a.md", "c.md"]);
  });

  it("ignores files без frontmatter", () => {
    const app = makeApp([
      {
        file: { path: "a.md", basename: "a" },
        fm: {
          exo__Instance_class: `[[${FOCUS_PROFILE_CLASS_UID}]]`,
          exo__Asset_uid: "p1",
        },
      },
    ]);
    // Inject a file без frontmatter mapping
    app.vault.getMarkdownFiles = () => [
      { path: "a.md", basename: "a" },
      { path: "b.md", basename: "b" },
    ];
    const resolver = new VaultProfileResolver(app);
    expect(resolver.listFocusProfileFiles().map((f) => f.path)).toEqual([
      "a.md",
    ]);
  });

  it("findFocusProfileFileByUid returns null when UID is empty", () => {
    const app = makeApp([]);
    expect(
      new VaultProfileResolver(app).findFocusProfileFileByUid(""),
    ).toBeNull();
  });

  it("findFocusProfileFileByUid matches by exo__Asset_uid", () => {
    const app = makeApp([
      {
        file: { path: "a.md", basename: "a" },
        fm: {
          exo__Instance_class: `[[${FOCUS_PROFILE_CLASS_UID}]]`,
          exo__Asset_uid: "p1",
        },
      },
      {
        file: { path: "b.md", basename: "b" },
        fm: {
          exo__Instance_class: `[[${FOCUS_PROFILE_CLASS_UID}]]`,
          exo__Asset_uid: "p2",
        },
      },
    ]);
    const resolver = new VaultProfileResolver(app);
    const file = resolver.findFocusProfileFileByUid("p2");
    expect(file?.path).toBe("b.md");
  });
});

describe("VaultProfileResolver.resolve", () => {
  it("returns null when profile UID is empty or missing", async () => {
    const app = makeApp([]);
    const resolver = new VaultProfileResolver(app);
    expect(await resolver.resolve("")).toBeNull();
    expect(await resolver.resolve("missing")).toBeNull();
  });

  it("normalises wikilink list fields, strips aliases, drops empties", async () => {
    const app = makeApp([
      {
        file: { path: "p.md", basename: "p" },
        fm: {
          exo__Instance_class: `[[${FOCUS_PROFILE_CLASS_UID}]]`,
          exo__Asset_uid: "p1",
          exo__Asset_label: "Personal",
          exo__FocusProfile_includes: [
            "[[https://exocortex.my/ontology/ems|ems]]",
            "[[https://exocortex.my/ontology/ims]]",
            "",
          ],
          exo__FocusProfile_alwaysOnOverlay:
            "[[https://exocortex.my/ontology/exocmd]]",
          exo__FocusProfile_extends: "[[parent-uid|profile-base]]",
        },
      },
    ]);
    const resolver = new VaultProfileResolver(app);
    const r = await resolver.resolve("p1");
    expect(r).not.toBeNull();
    expect(r!.uid).toBe("p1");
    expect(r!.label).toBe("Personal");
    expect(r!.includes).toEqual([
      "https://exocortex.my/ontology/ems",
      "https://exocortex.my/ontology/ims",
    ]);
    expect(r!.alwaysOnOverlay).toEqual([
      "https://exocortex.my/ontology/exocmd",
    ]);
    expect(r!.extends).toBe("parent-uid");
  });

  it("falls back к file basename when label is absent", async () => {
    const app = makeApp([
      {
        file: { path: "fallback.md", basename: "fallback" },
        fm: {
          exo__Instance_class: `[[${FOCUS_PROFILE_CLASS_UID}]]`,
          exo__Asset_uid: "p1",
        },
      },
    ]);
    const r = await new VaultProfileResolver(app).resolve("p1");
    expect(r?.label).toBe("fallback");
  });

  it("returns extends=null when the field is missing", async () => {
    const app = makeApp([
      {
        file: { path: "p.md", basename: "p" },
        fm: {
          exo__Instance_class: `[[${FOCUS_PROFILE_CLASS_UID}]]`,
          exo__Asset_uid: "p1",
        },
      },
    ]);
    const r = await new VaultProfileResolver(app).resolve("p1");
    expect(r?.extends).toBeNull();
  });
});

describe("VaultProfileResolver.resolve — appliesTo (RFC 13da049f AC13)", () => {
  it("reads exo__FocusProfile_appliesTo as a bare Knowledge UID", async () => {
    const app = makeApp([
      {
        file: { path: "p.md", basename: "p" },
        fm: {
          exo__Instance_class: `[[${FOCUS_PROFILE_CLASS_UID}]]`,
          exo__Asset_uid: "focus-1",
          exo__FocusProfile_appliesTo: "[[knowledge-9|exo__KnowledgeProfile]]",
        },
      },
    ]);
    const r = await new VaultProfileResolver(app).resolve("focus-1");
    expect(r?.appliesTo).toBe("knowledge-9");
  });

  it("accepts a single-element array form for appliesTo", async () => {
    const app = makeApp([
      {
        file: { path: "p.md", basename: "p" },
        fm: {
          exo__Instance_class: `[[${FOCUS_PROFILE_CLASS_UID}]]`,
          exo__Asset_uid: "focus-1",
          exo__FocusProfile_appliesTo: ["[[knowledge-9]]"],
        },
      },
    ]);
    const r = await new VaultProfileResolver(app).resolve("focus-1");
    expect(r?.appliesTo).toBe("knowledge-9");
  });

  it("returns appliesTo=null when the field is absent", async () => {
    const app = makeApp([
      {
        file: { path: "p.md", basename: "p" },
        fm: {
          exo__Instance_class: `[[${FOCUS_PROFILE_CLASS_UID}]]`,
          exo__Asset_uid: "focus-1",
        },
      },
    ]);
    const r = await new VaultProfileResolver(app).resolve("focus-1");
    expect(r?.appliesTo).toBeNull();
  });
});

describe("VaultProfileResolver.listKnowledgeProfileFiles (RFC 13da049f AC17)", () => {
  it("returns files whose Instance_class contains the KnowledgeProfile UID", () => {
    const app = makeApp([
      {
        file: { path: "k.md", basename: "k" },
        fm: {
          exo__Instance_class: `[[${KNOWLEDGE_PROFILE_CLASS_UID}|exo__KnowledgeProfile]]`,
          exo__Asset_uid: "k1",
        },
      },
      {
        file: { path: "f.md", basename: "f" },
        fm: {
          exo__Instance_class: `[[${FOCUS_PROFILE_CLASS_UID}]]`,
          exo__Asset_uid: "f1",
        },
      },
    ]);
    const resolver = new VaultProfileResolver(app);
    expect(resolver.listKnowledgeProfileFiles().map((f) => f.path)).toEqual([
      "k.md",
    ]);
    expect(resolver.listFocusProfileFiles().map((f) => f.path)).toEqual([
      "f.md",
    ]);
  });

  it("dual-class asset appears in BOTH Focus and Knowledge lists", () => {
    const app = makeApp([
      {
        file: { path: "dual.md", basename: "dual" },
        fm: {
          exo__Instance_class: [
            `[[${FOCUS_PROFILE_CLASS_UID}|exo__FocusProfile]]`,
            `[[${KNOWLEDGE_PROFILE_CLASS_UID}|exo__KnowledgeProfile]]`,
          ],
          exo__Asset_uid: "dual-1",
        },
      },
    ]);
    const resolver = new VaultProfileResolver(app);
    expect(resolver.listFocusProfileFiles().map((f) => f.path)).toEqual([
      "dual.md",
    ]);
    expect(resolver.listKnowledgeProfileFiles().map((f) => f.path)).toEqual([
      "dual.md",
    ]);
  });
});

describe("VaultProfileResolver.discoverSharedOntologies", () => {
  it("returns empty array (v3 backward-compat — TS-floor pattern handles shared- prefix)", async () => {
    expect(
      await new VaultProfileResolver(makeApp([])).discoverSharedOntologies(),
    ).toEqual([]);
  });
});
