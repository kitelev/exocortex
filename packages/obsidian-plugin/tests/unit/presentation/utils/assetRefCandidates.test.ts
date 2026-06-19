import { findAssetRefCandidates } from "@plugin/presentation/utils/assetRefCandidates";

// T1 "Create Instance" (project bbe40f8c) — candidate resolution for the
// reusable fuzzy reference-picker (assetRef fields parameterised by class).

const ONTOLOGY_CLASS_UID = "829b9b3b-6fc3-4276-be6a-27d3398c012e";

interface FakeFile {
  basename: string;
  path: string;
}

function makeApp(
  fileFrontmatters: Array<{ file: FakeFile; fm: Record<string, unknown> }>,
): any {
  const files = fileFrontmatters.map((f) => f.file);
  const byBasename = new Map(
    fileFrontmatters.map((f) => [f.file.basename, f.fm]),
  );
  return {
    vault: { getMarkdownFiles: () => files },
    metadataCache: {
      getFileCache: (file: FakeFile) => ({
        frontmatter: byBasename.get(file.basename),
      }),
    },
  };
}

describe("findAssetRefCandidates (T1 fuzzy reference-picker)", () => {
  it("returns instances of the target class as {uid, label}, sorted by label", () => {
    const app = makeApp([
      // The class definition itself (so its label can be resolved).
      {
        file: { basename: ONTOLOGY_CLASS_UID, path: `exo/${ONTOLOGY_CLASS_UID}.md` },
        fm: { exo__Asset_uid: ONTOLOGY_CLASS_UID, exo__Asset_label: "exo__Ontology" },
      },
      // UID-form instance.
      {
        file: { basename: "uid-ems", path: "ems/uid-ems.md" },
        fm: {
          exo__Asset_uid: "uid-ems",
          exo__Asset_label: "ems (Effort Management)",
          exo__Instance_class: [`"[[${ONTOLOGY_CLASS_UID}]]"`],
        },
      },
      // Symbolic-form instance (label-form wikilink).
      {
        file: { basename: "uid-exo", path: "exo/uid-exo.md" },
        fm: {
          exo__Asset_uid: "uid-exo",
          exo__Asset_label: "exo (Core)",
          exo__Instance_class: "[[exo__Ontology]]",
        },
      },
      // Not an ontology — excluded.
      {
        file: { basename: "uid-task", path: "ems/uid-task.md" },
        fm: {
          exo__Asset_uid: "uid-task",
          exo__Asset_label: "Some Task",
          exo__Instance_class: ["[[1b20a8f0-d745-4e93-91db-4531b3df120e]]"],
        },
      },
    ]);

    const result = findAssetRefCandidates(app, ONTOLOGY_CLASS_UID);

    expect(result).toEqual([
      { uid: "uid-ems", label: "ems (Effort Management)" },
      { uid: "uid-exo", label: "exo (Core)" },
    ]);
  });

  it("matches UID-form even when the class label cannot be resolved", () => {
    const app = makeApp([
      {
        file: { basename: "uid-a", path: "x/uid-a.md" },
        fm: {
          exo__Asset_uid: "uid-a",
          exo__Asset_label: "A",
          exo__Instance_class: `"[[${ONTOLOGY_CLASS_UID}]]"`,
        },
      },
    ]);
    const result = findAssetRefCandidates(app, ONTOLOGY_CLASS_UID);
    expect(result).toEqual([{ uid: "uid-a", label: "A" }]);
  });

  it("falls back to basename when uid/label frontmatter is absent", () => {
    const app = makeApp([
      {
        file: { basename: "raw-file", path: "x/raw-file.md" },
        fm: { exo__Instance_class: `"[[${ONTOLOGY_CLASS_UID}]]"` },
      },
    ]);
    const result = findAssetRefCandidates(app, ONTOLOGY_CLASS_UID);
    expect(result).toEqual([{ uid: "raw-file", label: "raw-file" }]);
  });

  it("returns empty array when classUid is empty or API unavailable", () => {
    expect(findAssetRefCandidates(makeApp([]), "")).toEqual([]);
    expect(findAssetRefCandidates({} as any, ONTOLOGY_CLASS_UID)).toEqual([]);
  });

  it("tolerates piped wikilinks in exo__Instance_class", () => {
    const app = makeApp([
      {
        file: { basename: "uid-p", path: "x/uid-p.md" },
        fm: {
          exo__Asset_uid: "uid-p",
          exo__Asset_label: "Piped",
          exo__Instance_class: `"[[${ONTOLOGY_CLASS_UID}|exo__Ontology]]"`,
        },
      },
    ]);
    expect(findAssetRefCandidates(app, ONTOLOGY_CLASS_UID)).toEqual([
      { uid: "uid-p", label: "Piped" },
    ]);
  });
});
