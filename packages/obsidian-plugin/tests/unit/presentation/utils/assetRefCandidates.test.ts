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

  // req 15f48fa1 (ticket 8df9e6eb) — SUBSUMPTION: a `targetClassUid` naming
  // an abstract / parent class (ems__Effort has no direct instances) collects
  // the instances of every class whose `exo__Class_superClass` chain reaches it.
  // Fixture = the live exoas-public/ems hierarchy (2026-09-16).
  describe("subsumption-aware resolution (req 15f48fa1)", () => {
    const EFFORT = "086f71fa-dd30-4284-90cf-e609f2a6c461";
    const TASK = "1b20a8f0-d745-4e93-91db-4531b3df120e";
    const PROJECT = "7db5eeff-718a-49b0-8d2b-39b084a356e3";
    const PARENT_EFFORT = "17c5cf45-ce6a-4142-8d2a-65ac447f1168";
    const MEETING = "1b0a5e34-dd7f-4ead-b43a-6c7c5a5ecaca";
    const AREA_AWARE = "f3892308-7a8b-4b81-8a01-a088d4bad97b";
    const ACTION = "6a99d2ca-d402-4734-a10b-33f5f1a1aa42";
    const AREA = "aaaaaaaa-0000-4000-8000-000000000001";

    const classFile = (uid: string, label: string, supers: string[]) => ({
      file: { basename: uid, path: `exoas-public/ems/${uid}.md` },
      fm: {
        exo__Asset_uid: uid,
        exo__Asset_label: label,
        exo__Instance_class: ['"[[8619c4fc-0000-4000-8000-000000000000]]"'],
        ...(supers.length > 0
          ? { exo__Class_superClass: supers.map((u) => `"[[${u}]]"`) }
          : {}),
      },
    });
    // `set-property --property/--value` writes a SCALAR `exo__Class_superClass`
    // (a string, not a list) — the live form PR #4247 review LOW-3 asked to lock.
    const classFileScalarSuper = (uid: string, label: string, sup: string) => ({
      file: { basename: uid, path: `exoas-public/ems/${uid}.md` },
      fm: {
        exo__Asset_uid: uid,
        exo__Asset_label: label,
        exo__Instance_class: ['"[[8619c4fc-0000-4000-8000-000000000000]]"'],
        exo__Class_superClass: `"[[${sup}]]"`,
      },
    });
    const hierarchy = [
      classFile(AREA_AWARE, "ems__AreaAware", []),
      classFile(EFFORT, "ems__Effort", [AREA_AWARE]),
      // Meeting listed BEFORE its parent Task: only a fixpoint walk reaches it.
      classFile(MEETING, "ems__Meeting", [TASK]),
      classFile(TASK, "ems__Task", [EFFORT]),
      classFile(PROJECT, "ems__Project", [EFFORT, PARENT_EFFORT]),
      classFile(PARENT_EFFORT, "ems__ParentEffort", [EFFORT]),
      classFileScalarSuper(ACTION, "ems__Action", EFFORT),
      classFile(AREA, "ems__Area", [AREA_AWARE]),
    ];
    const instances = [
      {
        file: { basename: "t1", path: "exoas-my/my-efforts/t1.md" },
        fm: { exo__Asset_uid: "t1", exo__Asset_label: "Task one", exo__Instance_class: [`"[[${TASK}]]"`] },
      },
      {
        file: { basename: "p1", path: "exoas-my/my-efforts/p1.md" },
        fm: { exo__Asset_uid: "p1", exo__Asset_label: "Project one", exo__Instance_class: [`"[[${PROJECT}]]"`] },
      },
      {
        file: { basename: "m1", path: "exoas-my/my-efforts/m1.md" },
        fm: { exo__Asset_uid: "m1", exo__Asset_label: "Meeting one", exo__Instance_class: `"[[${MEETING}|ems__Meeting]]"` },
      },
      {
        file: { basename: "t2", path: "legacy/t2.md" },
        fm: { exo__Asset_uid: "t2", exo__Asset_label: "Symbolic task", exo__Instance_class: "[[ems__Task]]" },
      },
      {
        file: { basename: "a1", path: "exoas-my/my-areas/a1.md" },
        fm: { exo__Asset_uid: "a1", exo__Asset_label: "Area one", exo__Instance_class: [`"[[${AREA}]]"`] },
      },
      {
        file: { basename: "ac1", path: "exoas-my/my-efforts/ac1.md" },
        fm: { exo__Asset_uid: "ac1", exo__Asset_label: "Action one", exo__Instance_class: [`"[[${ACTION}]]"`] },
      },
    ];

    it("C1 targetClassUid = ems__Effort collects Task, Project, Meeting (two hops), an Action (scalar superClass) and a symbolic-form Task, sorted by label, and not the Area @req:15f48fa1-a3a6-4df1-972e-efd639bfa344", () => {
      const app = makeApp([...hierarchy, ...instances]);
      expect(findAssetRefCandidates(app, EFFORT)).toEqual([
        { uid: "ac1", label: "Action one" },
        { uid: "m1", label: "Meeting one" },
        { uid: "p1", label: "Project one" },
        { uid: "t2", label: "Symbolic task" },
        { uid: "t1", label: "Task one" },
      ]);
    });

    it("C1b a class outside the hierarchy yields only its own instances; a leaf class yields only its own (exact-class preserved) @req:15f48fa1-a3a6-4df1-972e-efd639bfa344", () => {
      const app = makeApp([...hierarchy, ...instances]);
      expect(findAssetRefCandidates(app, AREA)).toEqual([
        { uid: "a1", label: "Area one" },
      ]);
      expect(findAssetRefCandidates(app, MEETING)).toEqual([
        { uid: "m1", label: "Meeting one" },
      ]);
      // A sibling / ancestor of the target is never subsumed: AreaAware ⇒ nothing
      // is a direct instance, and its SUBclasses (Effort, Area) do count.
      expect(findAssetRefCandidates(app, AREA_AWARE).map((c) => c.uid).sort()).toEqual(
        ["a1", "ac1", "m1", "p1", "t1", "t2"],
      );
    });

    // PR #4247 review LOW-1: `classUid` may be a LABEL (`exo__Asset`,
    // `exo__Ontology`) and a ROOT class declares no `exo__Class_superClass` —
    // its definition must still be collected so its UID key joins the match
    // set (UID-form instances and UID-form subclass edges resolve).
    it("C3 target given by LABEL of a root class (no superClass) still collects its UID-form instances and its UID-form subclasses @req:15f48fa1-a3a6-4df1-972e-efd639bfa344", () => {
      const ROOT = "bbbbbbbb-0000-4000-8000-000000000002";
      const CHILD = "bbbbbbbb-0000-4000-8000-000000000003";
      const app = makeApp([
        classFile(ROOT, "exo__Asset", []),
        classFile(CHILD, "custom__Child", [ROOT]),
        {
          file: { basename: "r1", path: "x/r1.md" },
          fm: { exo__Asset_uid: "r1", exo__Asset_label: "Root instance", exo__Instance_class: [`"[[${ROOT}]]"`] },
        },
        {
          file: { basename: "c1", path: "x/c1.md" },
          fm: { exo__Asset_uid: "c1", exo__Asset_label: "Child instance", exo__Instance_class: [`"[[${CHILD}]]"`] },
        },
      ]);
      expect(findAssetRefCandidates(app, "exo__Asset")).toEqual([
        { uid: "c1", label: "Child instance" },
        { uid: "r1", label: "Root instance" },
      ]);
    });
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
