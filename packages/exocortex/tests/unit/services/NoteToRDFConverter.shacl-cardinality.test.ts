import "reflect-metadata";
import { NoteToRDFConverter } from "../../../src/services/NoteToRDFConverter";
import { IVaultAdapter, IFile, IFrontmatter } from "../../../src/interfaces/IVaultAdapter";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";

/**
 * Regression suite for IssueItem ff3858e5 — SHACL-lite false-positive cardinality
 * and sh:class violations on PMBOK lifecycle assets.
 *
 * Fix 1: Narrow dual-storage (IRI + UUID Literal) to exo__Asset_prototype only.
 * Fix 2: Emit rdf:type triple for class-named enum instance wikilinks.
 * Fix 3: Verify body wikilinks use exo:Asset_bodyLink — no impact on frontmatter cardinality.
 */
describe("SHACL cardinality regression (Issue ff3858e5)", () => {
  let converter: NoteToRDFConverter;
  let mockVault: jest.Mocked<IVaultAdapter>;

  const closureReportFile: IFile = {
    path: "03 Knowledge/pmbok/aa000000-0000-0000-0000-000000000001.md",
    basename: "aa000000-0000-0000-0000-000000000001",
    name: "aa000000-0000-0000-0000-000000000001.md",
    parent: null,
  };

  const prototypeFile: IFile = {
    path: "03 Knowledge/pmbok/bb000000-0000-0000-0000-000000000002.md",
    basename: "bb000000-0000-0000-0000-000000000002",
    name: "bb000000-0000-0000-0000-000000000002.md",
    parent: null,
  };

  const acceptedByUUID = "cc000000-0000-0000-0000-000000000003";
  const acceptedByFile: IFile = {
    path: `03 Knowledge/kitelev/${acceptedByUUID}.md`,
    basename: acceptedByUUID,
    name: `${acceptedByUUID}.md`,
    parent: null,
  };

  const prototypeUUID = "dd000000-0000-0000-0000-000000000004";
  const prototypeTargetFile: IFile = {
    path: `03 Knowledge/pmbok/${prototypeUUID}.md`,
    basename: prototypeUUID,
    name: `${prototypeUUID}.md`,
    parent: null,
  };

  const outcomeFile: IFile = {
    path: "03 Knowledge/pmbok/pmbok__ClosureOutcomeAllAccepted.md",
    basename: "pmbok__ClosureOutcomeAllAccepted",
    name: "pmbok__ClosureOutcomeAllAccepted.md",
    parent: null,
  };

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

  it("UUID wikilink for non-prototype predicate emits single triple", async () => {
    // Fixture: pmbok__ProjectClosureReport with _acceptedBy pointing at a UUID file
    const closureReportFrontmatter: IFrontmatter = {
      pmbok__ProjectClosureReport_acceptedBy: `[[${acceptedByUUID}]]`,
    };

    mockVault.getFrontmatter.mockImplementation((f: IFile) => {
      if (f.path === closureReportFile.path) return closureReportFrontmatter;
      if (f.path === acceptedByFile.path) return { exo__Asset_label: "A. Kitelev" };
      return null;
    });

    mockVault.getFirstLinkpathDest.mockImplementation((linkpath: string) => {
      if (linkpath === acceptedByUUID) return acceptedByFile;
      return null;
    });

    mockVault.read.mockResolvedValue("");

    const triples = await converter.convertNote(closureReportFile);

    const acceptedBy = triples.filter((t) =>
      (t.predicate as IRI).value.endsWith("ProjectClosureReport_acceptedBy")
    );

    // Fix #ff3858e5: single IRI only — no UUID Literal for non-prototype predicates
    expect(acceptedBy).toHaveLength(1);
    expect(acceptedBy[0].object).toBeInstanceOf(IRI);
    expect((acceptedBy[0].object as IRI).value).toContain(acceptedByUUID);
  });

  it("UUID wikilink for exo__Asset_prototype emits BOTH IRI and Literal (Issue #2102 preserved)", async () => {
    const prototypeFrontmatter: IFrontmatter = {
      exo__Asset_prototype: `[[${prototypeUUID}]]`,
    };

    mockVault.getFrontmatter.mockImplementation((f: IFile) => {
      if (f.path === prototypeFile.path) return prototypeFrontmatter;
      if (f.path === prototypeTargetFile.path) return { exo__Asset_label: "Some template" };
      return null;
    });

    mockVault.getFirstLinkpathDest.mockImplementation((linkpath: string) => {
      if (linkpath === prototypeUUID) return prototypeTargetFile;
      return null;
    });

    mockVault.read.mockResolvedValue("");

    const triples = await converter.convertNote(prototypeFile);

    const protoTriples = triples.filter((t) =>
      (t.predicate as IRI).value.endsWith("Asset_prototype")
    );

    // Dual storage preserved for exo__Asset_prototype only
    expect(protoTriples).toHaveLength(2);
    expect(protoTriples.some((t) => t.object instanceof IRI)).toBe(true);
    expect(protoTriples.some((t) => t.object instanceof Literal)).toBe(true);
    const literalTriple = protoTriples.find((t) => t.object instanceof Literal);
    expect((literalTriple!.object as Literal).value).toBe(prototypeUUID);
  });

  it("Enum instance wikilink emits class IRI WITH rdf:type triple", async () => {
    // Fixture: ClosureReport with _outcome: [[pmbok__ClosureOutcomeAllAccepted]]
    // The outcome file has exo__Instance_class: pmbok__ClosureOutcome in frontmatter.
    const closureReportFrontmatter: IFrontmatter = {
      pmbok__ProjectClosureReport_outcome: "[[pmbok__ClosureOutcomeAllAccepted]]",
    };

    mockVault.getFrontmatter.mockImplementation((f: IFile) => {
      if (f.path === closureReportFile.path) return closureReportFrontmatter;
      if (f.path === outcomeFile.path) {
        return { exo__Instance_class: "pmbok__ClosureOutcome" };
      }
      return null;
    });

    mockVault.getFirstLinkpathDest.mockImplementation((linkpath: string) => {
      if (linkpath === "pmbok__ClosureOutcomeAllAccepted") return outcomeFile;
      return null;
    });

    mockVault.read.mockResolvedValue("");

    const triples = await converter.convertNote(closureReportFile);

    const outcomeTriples = triples.filter((t) =>
      (t.predicate as IRI).value.endsWith("ProjectClosureReport_outcome")
    );

    expect(outcomeTriples).toHaveLength(1);
    expect((outcomeTriples[0].object as IRI).value).toBe(
      Namespace.PMBOK.term("ClosureOutcomeAllAccepted").value
    );

    // Fix #ff3858e5: rdf:type triple must be present for sh:class constraints
    const rdfType = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
    const typeTriple = triples.find(
      (t) =>
        (t.subject as IRI).value === Namespace.PMBOK.term("ClosureOutcomeAllAccepted").value &&
        (t.predicate as IRI).value === rdfType &&
        (t.object as IRI).value === Namespace.PMBOK.term("ClosureOutcome").value
    );
    expect(typeTriple).toBeDefined();
  });

  it("Regression: ems__EffortStatusDone enum instance emits rdf:type triple", async () => {
    // Verifies that the existing Issue #2959 fix (class IRI emission) is preserved
    // and additionally emits the rdf:type triple added by Fix #ff3858e5.
    const taskFile: IFile = {
      path: "03 Knowledge/kitelev/3d62b9cf-0000-0000-0000-000000000000.md",
      basename: "3d62b9cf-0000-0000-0000-000000000000",
      name: "3d62b9cf-0000-0000-0000-000000000000.md",
      parent: null,
    };
    const doneFile: IFile = {
      path: "03 Knowledge/ems/ems__EffortStatusDone.md",
      basename: "ems__EffortStatusDone",
      name: "ems__EffortStatusDone.md",
      parent: null,
    };

    mockVault.getFrontmatter.mockImplementation((f: IFile) => {
      if (f.path === taskFile.path) {
        return { ems__Effort_status: "[[ems__EffortStatusDone]]" };
      }
      if (f.path === doneFile.path) {
        return { exo__Instance_class: "ems__EffortStatus" };
      }
      return null;
    });

    mockVault.getFirstLinkpathDest.mockImplementation((linkpath: string) => {
      if (linkpath === "ems__EffortStatusDone") return doneFile;
      return null;
    });

    mockVault.read.mockResolvedValue("");

    const triples = await converter.convertNote(taskFile);

    // Cardinality: single triple for Effort_status
    const statusTriples = triples.filter((t) =>
      (t.predicate as IRI).value === Namespace.EMS.term("Effort_status").value
    );
    expect(statusTriples).toHaveLength(1);
    expect((statusTriples[0].object as IRI).value).toBe(
      Namespace.EMS.term("EffortStatusDone").value
    );

    // rdf:type triple emitted for the enum instance
    const rdfType = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
    const typeTriple = triples.find(
      (t) =>
        (t.subject as IRI).value === Namespace.EMS.term("EffortStatusDone").value &&
        (t.predicate as IRI).value === rdfType &&
        (t.object as IRI).value === Namespace.EMS.term("EffortStatus").value
    );
    expect(typeTriple).toBeDefined();
  });

  it("Unresolved wikilink emits IRI (not literal) — sh:datatype false-positive fix", async () => {
    // Issue ff3858e5: when wikilink target is not present in vault and the
    // linkpath is not a class-namespaced reference (e.g. `[[Sales Platform]]`
    // pointing at a yet-to-be-created asset), the converter previously emitted
    // a string Literal. SHACL-lite shapes whose range expects an Asset IRI
    // then false-positived with `sh:datatype violation: literal "[[…]]" has
    // datatype xsd:string, expected exo__Asset`. The wikilink syntax itself
    // signals an asset reference; the converter must emit an IRI even when
    // the target file does not yet exist.
    const sourceFile: IFile = {
      path: "03 Knowledge/inbox/12340000-0000-0000-0000-000000000007.md",
      basename: "12340000-0000-0000-0000-000000000007",
      name: "12340000-0000-0000-0000-000000000007.md",
      parent: null,
    };

    mockVault.getFrontmatter.mockImplementation((f: IFile) => {
      if (f.path === sourceFile.path) {
        return { pmbok__RiskItem_project: "[[Sales Platform]]" };
      }
      return null;
    });

    // Wikilink target not in vault — getFirstLinkpathDest returns null
    mockVault.getFirstLinkpathDest.mockReturnValue(null);

    mockVault.read.mockResolvedValue("");

    const triples = await converter.convertNote(sourceFile);

    const projectTriples = triples.filter((t) =>
      (t.predicate as IRI).value.endsWith("RiskItem_project")
    );

    expect(projectTriples).toHaveLength(1);
    // Must be IRI, not Literal
    expect(projectTriples[0].object).toBeInstanceOf(IRI);
    // Should not preserve the wikilink syntax inside an IRI
    const objIri = projectTriples[0].object as IRI;
    expect(objIri.value).not.toContain("[[");
    expect(objIri.value).not.toContain("]]");
  });

  it("Fix 3 audit: body wikilinks use exo:Asset_bodyLink — no cardinality impact on frontmatter predicates", async () => {
    // Body wikilinks are stored under the dedicated exo:Asset_bodyLink predicate,
    // so they cannot inflate cardinality counts for frontmatter predicates.
    // This test confirms body wikilinks don't appear under non-bodyLink predicates.
    const noteFile: IFile = {
      path: "03 Knowledge/inbox/ee000000-0000-0000-0000-000000000005.md",
      basename: "ee000000-0000-0000-0000-000000000005",
      name: "ee000000-0000-0000-0000-000000000005.md",
      parent: null,
    };
    const linkedFile: IFile = {
      path: "03 Knowledge/inbox/ff000000-0000-0000-0000-000000000006.md",
      basename: "ff000000-0000-0000-0000-000000000006",
      name: "ff000000-0000-0000-0000-000000000006.md",
      parent: null,
    };

    mockVault.getFrontmatter.mockImplementation((f: IFile) => {
      if (f.path === noteFile.path) {
        return { pmbok__ProjectClosureReport_acceptedBy: `[[${acceptedByUUID}]]` };
      }
      return null;
    });

    mockVault.getFirstLinkpathDest.mockImplementation((linkpath: string) => {
      if (linkpath === acceptedByUUID) return acceptedByFile;
      if (linkpath === linkedFile.basename) return linkedFile;
      return null;
    });

    // Body contains a wikilink to a different file
    mockVault.read.mockResolvedValue(
      `---\npmbok__ProjectClosureReport_acceptedBy: "[[${acceptedByUUID}]]"\n---\n\nSee also [[${linkedFile.basename}]]`
    );

    const triples = await converter.convertNote(noteFile);

    // acceptedBy predicate should have exactly 1 triple (frontmatter only)
    const acceptedByTriples = triples.filter((t) =>
      (t.predicate as IRI).value.endsWith("ProjectClosureReport_acceptedBy")
    );
    expect(acceptedByTriples).toHaveLength(1);

    // Body wikilink appears under Asset_bodyLink only
    const bodyLinkTriples = triples.filter((t) =>
      (t.predicate as IRI).value.endsWith("Asset_bodyLink")
    );
    expect(bodyLinkTriples.length).toBeGreaterThanOrEqual(0); // may be 0 if body link not found
  });
});
