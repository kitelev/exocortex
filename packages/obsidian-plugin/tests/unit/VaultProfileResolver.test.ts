import { VaultProfileResolver } from "../../src/infrastructure/adapters/VaultProfileResolver";
import { PROFILE_CLASS_UID } from "../../src/infrastructure/adapters/ProfileApplyManager";

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
          exo__Instance_class: `[[${PROFILE_CLASS_UID}|exo__FocusProfile]]`,
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
            `[[${PROFILE_CLASS_UID}|exo__FocusProfile]]`,
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
          exo__Instance_class: `[[${PROFILE_CLASS_UID}]]`,
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
          exo__Instance_class: `[[${PROFILE_CLASS_UID}]]`,
          exo__Asset_uid: "p1",
        },
      },
      {
        file: { path: "b.md", basename: "b" },
        fm: {
          exo__Instance_class: `[[${PROFILE_CLASS_UID}]]`,
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

  it("normalises Profile_includes (AssetSpace UIDs), strips aliases, drops empties; reads _imports", async () => {
    const app = makeApp([
      {
        file: { path: "p.md", basename: "p" },
        fm: {
          exo__Instance_class: `[[${PROFILE_CLASS_UID}]]`,
          exo__Asset_uid: "p1",
          exo__Asset_label: "Personal",
          // RFC 01a83de8 Phase 2 — _includes now AssetSpace UID wikilinks
          exo__Profile_includes: [
            "[[as-ems-uid|kitelev/exoas-ems]]",
            "[[as-ims-uid]]",
            "",
          ],
          // _extends renamed → _imports (single-parent MVP)
          exo__Profile_imports: "[[parent-uid|profile-base]]",
        },
      },
    ]);
    const resolver = new VaultProfileResolver(app);
    const r = await resolver.resolve("p1");
    expect(r).not.toBeNull();
    expect(r!.uid).toBe("p1");
    expect(r!.label).toBe("Personal");
    expect(r!.includes).toEqual(["as-ems-uid", "as-ims-uid"]);
    expect(r!.extends).toBe("parent-uid");
  });

  it("reads _imports from a single-element array form", async () => {
    const app = makeApp([
      {
        file: { path: "p.md", basename: "p" },
        fm: {
          exo__Instance_class: `[[${PROFILE_CLASS_UID}]]`,
          exo__Asset_uid: "p1",
          exo__Profile_imports: ["[[parent-uid]]"],
        },
      },
    ]);
    const r = await new VaultProfileResolver(app).resolve("p1");
    expect(r?.extends).toBe("parent-uid");
  });

  it("falls back к file basename when label is absent", async () => {
    const app = makeApp([
      {
        file: { path: "fallback.md", basename: "fallback" },
        fm: {
          exo__Instance_class: `[[${PROFILE_CLASS_UID}]]`,
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
          exo__Instance_class: `[[${PROFILE_CLASS_UID}]]`,
          exo__Asset_uid: "p1",
        },
      },
    ]);
    const r = await new VaultProfileResolver(app).resolve("p1");
    expect(r?.extends).toBeNull();
  });
});


// RFC 01a83de8 Phase 3 T4 — listKnowledgeProfileFiles removed (the former
// per-class KnowledgeProfile picker collapsed into the single exo__Profile
// class; the mount-state picker now uses listFocusProfileFiles).

describe("VaultProfileResolver.discoverSharedOntologies", () => {
  it("returns empty array (v3 backward-compat — TS-floor pattern handles shared- prefix)", async () => {
    expect(
      await new VaultProfileResolver(makeApp([])).discoverSharedOntologies(),
    ).toEqual([]);
  });
});
