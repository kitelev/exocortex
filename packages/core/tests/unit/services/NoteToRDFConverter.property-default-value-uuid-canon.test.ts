import "reflect-metadata";
import { NoteToRDFConverter } from "../../../src/services/NoteToRDFConverter";
import { IVaultAdapter, IFile, IFrontmatter } from "../../../src/interfaces/IVaultAdapter";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";

/**
 * Regression: `exocmd__PropertyDefault_value` UUID identity preservation.
 *
 * Bug observed 2026-05-24 with prototype `f2dccb6a` ("Заполнить таблетницу"):
 * clicking "Create Task Instance" produced a new task whose
 * `ems__Effort_status` was written as `"[[ems__EffortStatusDraft]]"`
 * (symbolic, label-form) instead of the UID-form
 * `"[[c42245d0-01de-4c35-bfcf-d910445ea28e]]"` that the
 * `PropertyDefault` asset actually declares.
 *
 * Root cause: `valueToRDFObject`'s class-IRI substitution branch
 * (Issue #2782/#2959) rewrites the triple object for any wikilink whose
 * target carries a class-prefixed `exo__Asset_label`. The
 * `PropertyDefault_value` predicate was not in the bypass list, so the
 * declared `[[c42245d0-...]]` ref got rewritten to
 * `<ems#EffortStatusDraft>` (because target's label is
 * `ems__EffortStatusDraft`). `CommandResolver.resolvePropertyDefaultValue`
 * then read that as `"ems__EffortStatusDraft"`, failed `looksLikeUUID`,
 * and returned label-form — defeating UID-canon for the entire
 * PropertyDefault story.
 *
 * Fix: add `#PropertyDefault_value` to the `isGroundingRef` bypass list
 * in `NoteToRDFConverter.valueToRDFObject`. The triple object stays as
 * the file IRI; `iriToObsidianName` extracts the UUID basename; the
 * resolver writes UID-form.
 */
describe("NoteToRDFConverter — PropertyDefault_value UUID identity", () => {
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

  const propertyDefaultFile: IFile = {
    path: "assetspaces/exocmd/d9aa9bb8-5676-4ba2-ba5e-fc8d9df02250.md",
    basename: "d9aa9bb8-5676-4ba2-ba5e-fc8d9df02250",
    name: "d9aa9bb8-5676-4ba2-ba5e-fc8d9df02250.md",
    parent: null,
  };

  const draftStatusFile: IFile = {
    path: "assetspaces/ems/c42245d0-01de-4c35-bfcf-d910445ea28e.md",
    basename: "c42245d0-01de-4c35-bfcf-d910445ea28e",
    name: "c42245d0-01de-4c35-bfcf-d910445ea28e.md",
    parent: null,
  };

  it("preserves UUID identity for PropertyDefault_value when target label is a class-prefixed string", async () => {
    // Empirical reproduction — production PropertyDefault asset `d9aa9bb8`
    // declares `exocmd__PropertyDefault_value: "[[c42245d0-...]]"` pointing
    // at UUID-named EffortStatusDraft. Pre-fix: triple object becomes class
    // IRI <ems#EffortStatusDraft>. Post-fix: triple object is the file IRI
    // (UUID intact).
    const propertyDefaultFrontmatter: IFrontmatter = {
      exo__Asset_uid: "d9aa9bb8-5676-4ba2-ba5e-fc8d9df02250",
      exo__Asset_label: "PropertyDefault: ems__Effort_status = EffortStatusDraft",
      exo__Instance_class: ["[[74d6d2d3-c435-4fd0-9c4b-d9dc9f0bb088]]"],
      exocmd__PropertyDefault_property: "[[44c6e9e3-955f-4afc-9ca5-b4bd70667051]]",
      exocmd__PropertyDefault_value: "[[c42245d0-01de-4c35-bfcf-d910445ea28e]]",
    };

    // Target EffortStatusDraft asset — its label is class-prefixed, which
    // is exactly what triggers the #2782 substitution branch.
    const draftStatusFrontmatter: IFrontmatter = {
      exo__Asset_uid: "c42245d0-01de-4c35-bfcf-d910445ea28e",
      exo__Asset_label: "ems__EffortStatusDraft",
    };

    mockVault.getFrontmatter.mockImplementation((f: IFile) => {
      if (f.path === propertyDefaultFile.path) return propertyDefaultFrontmatter;
      if (f.path === draftStatusFile.path) return draftStatusFrontmatter;
      return null;
    });

    mockVault.getFirstLinkpathDest.mockImplementation((linkpath: string) => {
      if (linkpath === "c42245d0-01de-4c35-bfcf-d910445ea28e") return draftStatusFile;
      return null;
    });

    const triples = await converter.convertNote(propertyDefaultFile);

    const valueTriples = triples.filter(
      (t) => (t.predicate as IRI).value === Namespace.EXOCMD.term("PropertyDefault_value").value,
    );

    expect(valueTriples).toHaveLength(1);
    const obj = valueTriples[0].object;

    // Pre-fix: obj was IRI("https://exocortex.my/ontology/ems#EffortStatusDraft")
    // Post-fix: obj is the file IRI carrying the UUID basename.
    expect(obj).toBeInstanceOf(IRI);
    const value = (obj as IRI).value;
    expect(value).not.toBe(Namespace.EMS.term("EffortStatusDraft").value);
    expect(value).toMatch(/c42245d0-01de-4c35-bfcf-d910445ea28e\.md$/);
  });

  it("preserves UUID identity for PropertyDefault_value even with EffortStatusBacklog (different enum, same bypass)", async () => {
    // Cross-check: bypass must apply uniformly regardless of which enum
    // member is referenced. Guards against ad-hoc per-value patches.
    const backlogFile: IFile = {
      path: "assetspaces/ems/753a44d5-846c-4b82-9196-4fd9a4d48777.md",
      basename: "753a44d5-846c-4b82-9196-4fd9a4d48777",
      name: "753a44d5-846c-4b82-9196-4fd9a4d48777.md",
      parent: null,
    };

    const propertyDefaultBacklog: IFile = {
      path: "assetspaces/exocmd/aaaa1111-aaaa-1111-aaaa-111111111111.md",
      basename: "aaaa1111-aaaa-1111-aaaa-111111111111",
      name: "aaaa1111-aaaa-1111-aaaa-111111111111.md",
      parent: null,
    };

    const propertyDefaultFm: IFrontmatter = {
      exo__Asset_uid: "aaaa1111-aaaa-1111-aaaa-111111111111",
      exo__Asset_label: "PropertyDefault: ems__Effort_status = EffortStatusBacklog",
      exo__Instance_class: ["[[74d6d2d3-c435-4fd0-9c4b-d9dc9f0bb088]]"],
      exocmd__PropertyDefault_property: "[[44c6e9e3-955f-4afc-9ca5-b4bd70667051]]",
      exocmd__PropertyDefault_value: "[[753a44d5-846c-4b82-9196-4fd9a4d48777]]",
    };

    const backlogFm: IFrontmatter = {
      exo__Asset_uid: "753a44d5-846c-4b82-9196-4fd9a4d48777",
      exo__Asset_label: "ems__EffortStatusBacklog",
    };

    mockVault.getFrontmatter.mockImplementation((f: IFile) => {
      if (f.path === propertyDefaultBacklog.path) return propertyDefaultFm;
      if (f.path === backlogFile.path) return backlogFm;
      return null;
    });

    mockVault.getFirstLinkpathDest.mockImplementation((linkpath: string) => {
      if (linkpath === "753a44d5-846c-4b82-9196-4fd9a4d48777") return backlogFile;
      return null;
    });

    const triples = await converter.convertNote(propertyDefaultBacklog);

    const valueTriples = triples.filter(
      (t) => (t.predicate as IRI).value === Namespace.EXOCMD.term("PropertyDefault_value").value,
    );

    expect(valueTriples).toHaveLength(1);
    const obj = valueTriples[0].object;
    expect(obj).toBeInstanceOf(IRI);
    expect((obj as IRI).value).not.toBe(Namespace.EMS.term("EffortStatusBacklog").value);
    expect((obj as IRI).value).toMatch(/753a44d5-846c-4b82-9196-4fd9a4d48777\.md$/);
  });
});
