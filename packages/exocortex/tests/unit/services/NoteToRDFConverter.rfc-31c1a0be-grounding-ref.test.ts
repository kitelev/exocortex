import "reflect-metadata";
import { NoteToRDFConverter } from "../../../src/services/NoteToRDFConverter";
import { IVaultAdapter, IFile, IFrontmatter } from "../../../src/interfaces/IVaultAdapter";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";

/**
 * RFC 31c1a0be — regression suite for `exocmd__Grounding_targetValueRef`
 * UUID identity preservation.
 *
 * Bug: when a typed grounding ref predicate points at a UUID-named target
 * whose `exo__Asset_label` is a class-prefixed string (e.g.
 * `ems__EffortStatusDoing`), the Issue #2959 / #2782 class-IRI substitution
 * upstream of `CommandResolver.iriToObsidianName` rewrites the triple object
 * to the namespace class IRI. The resolver then unwraps that to the bare
 * symbolic name and `GroundingExecutor.executePropertySet` writes
 * `"[[ems__EffortStatusDoing]]"` (symbolic) instead of
 * `"[[<UUID>]]"` (UUID-canon), defeating the whole point of the typed
 * predicate migration (Phase 1-3).
 *
 * Fix: bypass the class-IRI substitution for grounding-ref predicates,
 * emitting the file IRI instead. `iriToObsidianName` extracts the UUID
 * basename → executor wraps to `"[[<UUID>]]"`. The Issue #2959 path for
 * `ems__Effort_status` on tasks is unaffected (different predicate).
 */
describe("NoteToRDFConverter — RFC 31c1a0be grounding-ref UUID identity", () => {
  let converter: NoteToRDFConverter;
  let mockVault: jest.Mocked<IVaultAdapter>;

  beforeEach(() => {
    mockVault = {
      getFrontmatter: jest.fn(),
      getAllFiles: jest.fn(),
      read: jest.fn(),
      create: jest.fn(),
      modify: jest.fn(),
      delete: jest.fn(),
      exists: jest.fn(),
      getAbstractFileByPath: jest.fn(),
      updateFrontmatter: jest.fn(),
      rename: jest.fn(),
      createFolder: jest.fn(),
      getFirstLinkpathDest: jest.fn(),
      process: jest.fn(),
      updateLinks: jest.fn(),
      getDefaultNewFileParent: jest.fn(),
    } as jest.Mocked<IVaultAdapter>;

    converter = new NoteToRDFConverter(mockVault);
  });

  const groundingFile: IFile = {
    path: "assetspaces/exocmd/status/d5deac7a-149d-43a1-b249-875d91834b60.md",
    basename: "d5deac7a-149d-43a1-b249-875d91834b60",
    name: "d5deac7a-149d-43a1-b249-875d91834b60.md",
    parent: null,
  };

  const doingStatusFile: IFile = {
    path: "assetspaces/ems/027e78f4-6e16-4b36-b8fb-5510507d5745.md",
    basename: "027e78f4-6e16-4b36-b8fb-5510507d5745",
    name: "027e78f4-6e16-4b36-b8fb-5510507d5745.md",
    parent: null,
  };

  it("preserves UUID identity for Grounding_targetValueRef even when target label is a class-prefixed string", async () => {
    // Empirical reproduction — vault-2025 grounding `d5deac7a` with
    // targetValueRef `[[027e78f4-...]]` (UUID-named EffortStatusDoing, label
    // `ems__EffortStatusDoing`). Pre-fix: triple object becomes class IRI
    // <ems#EffortStatusDoing>. Post-fix: triple object is file IRI
    // obsidian://vault/.../027e78f4-...md (UUID identity intact).
    const groundingFrontmatter: IFrontmatter = {
      exo__Asset_uid: "d5deac7a-149d-43a1-b249-875d91834b60",
      exo__Asset_label: "Set status to Doing",
      exo__Instance_class: ["[[11579feb-2e42-491c-af59-b89b1129a539]]"],
      exocmd__Grounding_type: "property_set",
      exocmd__Grounding_targetProperty: "[[44c6e9e3-955f-4afc-9ca5-b4bd70667051]]",
      exocmd__Grounding_targetValueRef: "[[027e78f4-6e16-4b36-b8fb-5510507d5745]]",
    };

    const doingStatusFrontmatter: IFrontmatter = {
      exo__Asset_uid: "027e78f4-6e16-4b36-b8fb-5510507d5745",
      exo__Asset_label: "ems__EffortStatusDoing",
    };

    mockVault.getFrontmatter.mockImplementation((f: IFile) => {
      if (f.path === groundingFile.path) return groundingFrontmatter;
      if (f.path === doingStatusFile.path) return doingStatusFrontmatter;
      return null;
    });

    mockVault.getFirstLinkpathDest.mockImplementation((linkpath: string) => {
      if (linkpath === "027e78f4-6e16-4b36-b8fb-5510507d5745") return doingStatusFile;
      return null;
    });

    const triples = await converter.convertNote(groundingFile);

    const refTriples = triples.filter(
      (t) => (t.predicate as IRI).value === Namespace.EXOCMD.term("Grounding_targetValueRef").value,
    );

    expect(refTriples).toHaveLength(1);
    const obj = refTriples[0].object;

    // Pre-fix: obj was IRI("https://exocortex.my/ontology/ems#EffortStatusDoing")
    // Post-fix: obj is the file IRI carrying the UUID in its basename.
    expect(obj).toBeInstanceOf(IRI);
    const value = (obj as IRI).value;
    expect(value).not.toBe(Namespace.EMS.term("EffortStatusDoing").value);
    expect(value).toMatch(/027e78f4-6e16-4b36-b8fb-5510507d5745\.md$/);
  });

  it("preserves UUID identity for Grounding_targetValueSubstitution when token label looks like a class reference", async () => {
    // Future-proofing: a SubstitutionToken whose `exo__Asset_label` happens to
    // be a class-prefixed string (synthetic name like `ems__SomeToken`) would
    // hit the same class-IRI substitution bug as `targetValueRef`. The current
    // production vault tokens use `$nowLocal` / `$todayStart` which are not
    // class references, so the bug never manifested for substitution in vivo —
    // but a token authored as `ems__Foo` would trip it. The bypass must cover
    // both ref predicates.
    const tokenFile: IFile = {
      path: "assetspaces/exocmd/substitution-tokens/8bc0c038-1fd1-4ad3-a4a4-178a64b492b8.md",
      basename: "8bc0c038-1fd1-4ad3-a4a4-178a64b492b8",
      name: "8bc0c038-1fd1-4ad3-a4a4-178a64b492b8.md",
      parent: null,
    };

    const groundingFrontmatter: IFrontmatter = {
      exo__Asset_uid: "bd5e5573-d222-4dfa-ac99-0d8b599e7c65",
      exo__Asset_label: "Set startTimestamp to now",
      exocmd__Grounding_type: "property_set",
      exocmd__Grounding_targetProperty: "[[0c52de78-a6f2-4e3b-86c8-6794cb8476d1]]",
      exocmd__Grounding_targetValueSubstitution:
        "[[8bc0c038-1fd1-4ad3-a4a4-178a64b492b8]]",
    };

    const tokenFrontmatter: IFrontmatter = {
      exo__Asset_uid: "8bc0c038-1fd1-4ad3-a4a4-178a64b492b8",
      // Class-prefixed label that *would* be class-IRI-substituted without
      // the bypass — exercises the bypass directly (vs `$nowLocal` which is
      // a no-op for class substitution).
      exo__Asset_label: "ems__SyntheticSubstitutionToken",
    };

    const subGroundingFile: IFile = {
      path: "assetspaces/exocmd/status/bd5e5573-d222-4dfa-ac99-0d8b599e7c65.md",
      basename: "bd5e5573-d222-4dfa-ac99-0d8b599e7c65",
      name: "bd5e5573-d222-4dfa-ac99-0d8b599e7c65.md",
      parent: null,
    };

    mockVault.getFrontmatter.mockImplementation((f: IFile) => {
      if (f.path === subGroundingFile.path) return groundingFrontmatter;
      if (f.path === tokenFile.path) return tokenFrontmatter;
      return null;
    });

    mockVault.getFirstLinkpathDest.mockImplementation((linkpath: string) => {
      if (linkpath === "8bc0c038-1fd1-4ad3-a4a4-178a64b492b8") return tokenFile;
      return null;
    });

    const triples = await converter.convertNote(subGroundingFile);

    const subTriples = triples.filter(
      (t) =>
        (t.predicate as IRI).value ===
        Namespace.EXOCMD.term("Grounding_targetValueSubstitution").value,
    );

    expect(subTriples).toHaveLength(1);
    const obj = subTriples[0].object;
    expect(obj).toBeInstanceOf(IRI);
    expect((obj as IRI).value).toMatch(
      /8bc0c038-1fd1-4ad3-a4a4-178a64b492b8\.md$/,
    );
  });

  it("Issue #2782 path (ems__Effort_status with UUID wikilink + class-like label) remains class-IRI normalized", async () => {
    // Guard against scope creep — when a task's `ems__Effort_status` points
    // at a UUID-named status file with a class-prefixed label, the legacy
    // class-IRI substitution (Issue #2782) MUST still fire for SPARQL ASK
    // preconditions to work. The bypass is predicate-scoped to grounding refs
    // only.
    const taskFile: IFile = {
      path: "03 Knowledge/kitelev/some-task.md",
      basename: "some-task",
      name: "some-task.md",
      parent: null,
    };

    const enumFile: IFile = {
      path: "assetspaces/ems/027e78f4-6e16-4b36-b8fb-5510507d5745.md",
      basename: "027e78f4-6e16-4b36-b8fb-5510507d5745",
      name: "027e78f4-6e16-4b36-b8fb-5510507d5745.md",
      parent: null,
    };

    const taskFrontmatter: IFrontmatter = {
      exo__Instance_class: ["[[ems__Task]]"],
      ems__Effort_status: "[[027e78f4-6e16-4b36-b8fb-5510507d5745]]",
    };

    const enumFrontmatter: IFrontmatter = {
      exo__Asset_uid: "027e78f4-6e16-4b36-b8fb-5510507d5745",
      exo__Asset_label: "ems__EffortStatusDoing",
    };

    mockVault.getFrontmatter.mockImplementation((f: IFile) => {
      if (f.path === taskFile.path) return taskFrontmatter;
      if (f.path === enumFile.path) return enumFrontmatter;
      return null;
    });

    mockVault.getFirstLinkpathDest.mockImplementation((linkpath: string) => {
      if (linkpath === "027e78f4-6e16-4b36-b8fb-5510507d5745") return enumFile;
      return null;
    });

    const triples = await converter.convertNote(taskFile);

    const statusTriples = triples.filter(
      (t) => (t.predicate as IRI).value === Namespace.EMS.term("Effort_status").value,
    );

    // Issue #2782 substitution must still apply on non-grounding predicates.
    expect(statusTriples).toHaveLength(1);
    expect(statusTriples[0].object).toBeInstanceOf(IRI);
    expect((statusTriples[0].object as IRI).value).toBe(
      "https://exocortex.my/ontology/ems#EffortStatusDoing",
    );
  });

  it("preserves UUID identity for Grounding_targetClass when target is UUID-named class TBox file (#3212)", async () => {
    // Issue #3212 — create_instance grounding emits `exo__Instance_class: "[[ems__Task]]"`
    // (label-form) instead of `"[[<UID>]]"` (UID-form, UUID-canon TBox).
    // Root cause: `Grounding_targetClass` wikilink pointing at a UUID-named
    // class TBox file (e.g. `1b20a8f0-...md`, label `ems__Task`) is rewritten
    // to the namespace class IRI `<ems#Task>` by the Issue #2782/#2959
    // substitution. CommandResolver.iriToObsidianName then yields `ems__Task`
    // and GroundingExecutor.executeCreateInstance wraps it as
    // `"[[ems__Task]]"` — defeating the UUID-canon TBox invariant.
    //
    // Fix: extend the Phase 3 hotfix bypass list to include
    // `Grounding_targetClass`, emitting the file IRI so the resolver
    // returns the UUID basename and the executor emits `"[[<UID>]]"`.
    const classTBoxFile: IFile = {
      path: "assetspaces/ems/1b20a8f0-d745-4e93-91db-4531b3df120e.md",
      basename: "1b20a8f0-d745-4e93-91db-4531b3df120e",
      name: "1b20a8f0-d745-4e93-91db-4531b3df120e.md",
      parent: null,
    };

    const groundingFile: IFile = {
      path: "assetspaces/exocmd/create-instance/c8d10000-0000-0000-0000-000000000001.md",
      basename: "c8d10000-0000-0000-0000-000000000001",
      name: "c8d10000-0000-0000-0000-000000000001.md",
      parent: null,
    };

    const groundingFrontmatter: IFrontmatter = {
      exo__Asset_uid: "c8d10000-0000-0000-0000-000000000001",
      exo__Asset_label: "Create Task Instance grounding",
      exocmd__Grounding_type: "create_instance",
      exocmd__Grounding_targetClass:
        "[[1b20a8f0-d745-4e93-91db-4531b3df120e]]",
      exocmd__Grounding_targetFolder: "03 Knowledge/inbox",
    };

    const classTBoxFrontmatter: IFrontmatter = {
      exo__Asset_uid: "1b20a8f0-d745-4e93-91db-4531b3df120e",
      exo__Asset_label: "ems__Task",
    };

    mockVault.getFrontmatter.mockImplementation((f: IFile) => {
      if (f.path === groundingFile.path) return groundingFrontmatter;
      if (f.path === classTBoxFile.path) return classTBoxFrontmatter;
      return null;
    });

    mockVault.getFirstLinkpathDest.mockImplementation((linkpath: string) => {
      if (linkpath === "1b20a8f0-d745-4e93-91db-4531b3df120e")
        return classTBoxFile;
      return null;
    });

    const triples = await converter.convertNote(groundingFile);

    const classTriples = triples.filter(
      (t) =>
        (t.predicate as IRI).value ===
        Namespace.EXOCMD.term("Grounding_targetClass").value,
    );

    expect(classTriples).toHaveLength(1);
    const obj = classTriples[0].object;

    // Pre-fix: obj was IRI("https://exocortex.my/ontology/ems#Task")
    // Post-fix: obj is the file IRI carrying the UUID in its basename.
    expect(obj).toBeInstanceOf(IRI);
    const value = (obj as IRI).value;
    expect(value).not.toBe(Namespace.EMS.term("Task").value);
    expect(value).toMatch(/1b20a8f0-d745-4e93-91db-4531b3df120e\.md$/);
  });

  it("Issue #2959 path (ems__Effort_status on a task) remains class-IRI normalized", async () => {
    // Guard against scope creep — the fix must NOT regress the Issue #2959
    // behaviour where `ems__Effort_status: "[[ems__EffortStatusDone]]"` on
    // a Task asset normalizes to the namespace class IRI for SPARQL ASK
    // preconditions. The fix is predicate-scoped to grounding refs only.
    const taskFile: IFile = {
      path: "03 Knowledge/kitelev/some-task.md",
      basename: "some-task",
      name: "some-task.md",
      parent: null,
    };

    const enumFile: IFile = {
      path: "assetspaces/ems/ems__EffortStatusDone.md",
      basename: "ems__EffortStatusDone",
      name: "ems__EffortStatusDone.md",
      parent: null,
    };

    const taskFrontmatter: IFrontmatter = {
      exo__Instance_class: ["[[ems__Task]]"],
      ems__Effort_status: "[[ems__EffortStatusDone]]",
    };

    mockVault.getFrontmatter.mockImplementation((f: IFile) => {
      if (f.path === taskFile.path) return taskFrontmatter;
      return null;
    });

    mockVault.getFirstLinkpathDest.mockImplementation((linkpath: string) => {
      if (linkpath === "ems__EffortStatusDone") return enumFile;
      return null;
    });

    const triples = await converter.convertNote(taskFile);

    const statusTriples = triples.filter(
      (t) => (t.predicate as IRI).value === Namespace.EMS.term("Effort_status").value,
    );

    expect(statusTriples).toHaveLength(1);
    expect(statusTriples[0].object).toBeInstanceOf(IRI);
    expect((statusTriples[0].object as IRI).value).toBe(
      "https://exocortex.my/ontology/ems#EffortStatusDone",
    );
  });

  it("preserves UUID identity for Grounding_type when target is GroundingType catalog instance (RFC 9d20c91f Phase 4)", async () => {
    // RFC 9d20c91f Phase 4 cutover: `Grounding_type` reshaped to ObjectProperty
    // with range `exocmd__GroundingType`. ABox stores `"[[<uid>]]"` pointing
    // at a catalog instance (e.g. `cf3bb923-...md`, label
    // `exocmd__GroundingTypePropertySet`). Without the Phase 4 bypass-list
    // extension, the label matches `^[a-z]+__[A-Z][a-zA-Z0-9_]+$` regex →
    // Issue #2782/#2959 substitution rewrites the triple object to
    // `<exocmd#GroundingTypePropertySet>` (symbolic class IRI), and
    // CommandResolver's UID-identity dispatch (GROUNDING_TYPE_UID_TO_ENUM
    // keyed on UID, not label) cannot resolve it → grounding inert.
    //
    // Fix: extend bypass list with `Grounding_type`, emitting the file IRI
    // so resolveGroundingTypeFromIRI can extract the UUID and dispatch.
    const catalogInstanceFile: IFile = {
      path: "assetspaces/exocmd/cf3bb923-f1f1-40be-b728-782844402426.md",
      basename: "cf3bb923-f1f1-40be-b728-782844402426",
      name: "cf3bb923-f1f1-40be-b728-782844402426.md",
      parent: null,
    };

    const groundingFile: IFile = {
      path: "assetspaces/exocmd/9d20c000-0000-0000-0000-000000000001.md",
      basename: "9d20c000-0000-0000-0000-000000000001",
      name: "9d20c000-0000-0000-0000-000000000001.md",
      parent: null,
    };

    const groundingFrontmatter: IFrontmatter = {
      exo__Asset_uid: "9d20c000-0000-0000-0000-000000000001",
      exo__Asset_label: "RFC 9d20c91f Phase 4 dispatch fixture",
      exocmd__Grounding_type:
        "[[cf3bb923-f1f1-40be-b728-782844402426]]",
      exocmd__Grounding_targetProperty: "ems__Effort_status",
    };

    const catalogInstanceFrontmatter: IFrontmatter = {
      exo__Asset_uid: "cf3bb923-f1f1-40be-b728-782844402426",
      exo__Asset_label: "exocmd__GroundingTypePropertySet",
    };

    mockVault.getFrontmatter.mockImplementation((f: IFile) => {
      if (f.path === groundingFile.path) return groundingFrontmatter;
      if (f.path === catalogInstanceFile.path) return catalogInstanceFrontmatter;
      return null;
    });

    mockVault.getFirstLinkpathDest.mockImplementation((linkpath: string) => {
      if (linkpath === "cf3bb923-f1f1-40be-b728-782844402426")
        return catalogInstanceFile;
      return null;
    });

    const triples = await converter.convertNote(groundingFile);

    const typeTriples = triples.filter(
      (t) =>
        (t.predicate as IRI).value ===
        Namespace.EXOCMD.term("Grounding_type").value,
    );

    expect(typeTriples).toHaveLength(1);
    const obj = typeTriples[0].object;

    // Pre-fix: obj was IRI("https://exocortex.my/ontology/exocmd#GroundingTypePropertySet")
    // Post-fix: obj is the file IRI carrying the UUID in its basename.
    expect(obj).toBeInstanceOf(IRI);
    const value = (obj as IRI).value;
    expect(value).not.toBe(
      "https://exocortex.my/ontology/exocmd#GroundingTypePropertySet",
    );
    expect(value).toMatch(
      /cf3bb923-f1f1-40be-b728-782844402426\.md$/,
    );
  });
});
