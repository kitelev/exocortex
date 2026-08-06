import {
  DEPENDENCY_KIND_REFERENCE_UID,
  DEPENDENCY_KIND_TBOX_UID,
  resolveDependencyKind,
} from "../../../../src/domain/profile/dependencyKind";

describe("resolveDependencyKind", () => {
  it("resolves every emitted form of the SOFT value @req:18ecf16f-a163-4b78-9bee-605db7e75f8e", () => {
    // The plugin reads FRONTMATTER while the graph emits the same value as a
    // symbolic IRI (the enum label parses as `prefix__Local`), so both shapes
    // are legitimate authoring/migration outputs and both must resolve.
    expect(resolveDependencyKind(`[[${DEPENDENCY_KIND_REFERENCE_UID}]]`)).toBe(
      "reference",
    );
    expect(
      resolveDependencyKind(
        `[[${DEPENDENCY_KIND_REFERENCE_UID}|exo__DependencyKindReference]]`,
      ),
    ).toBe("reference");
    expect(resolveDependencyKind(DEPENDENCY_KIND_REFERENCE_UID)).toBe(
      "reference",
    );
    expect(resolveDependencyKind("exo__DependencyKindReference")).toBe(
      "reference",
    );
    expect(
      resolveDependencyKind(
        "https://exocortex.my/ontology/exo#DependencyKindReference",
      ),
    ).toBe("reference");
    // `Single` cardinality, but metadataCache hands back a list when the author
    // writes YAML list syntax.
    expect(
      resolveDependencyKind([`[[${DEPENDENCY_KIND_REFERENCE_UID}]]`]),
    ).toBe("reference");
  });

  it("resolves the HARD value in the same forms @req:18ecf16f-a163-4b78-9bee-605db7e75f8e", () => {
    expect(resolveDependencyKind(`[[${DEPENDENCY_KIND_TBOX_UID}]]`)).toBe(
      "tbox",
    );
    expect(
      resolveDependencyKind(
        `[[${DEPENDENCY_KIND_TBOX_UID}|exo__DependencyKindTBox]]`,
      ),
    ).toBe("tbox");
    expect(resolveDependencyKind("exo__DependencyKindTBox")).toBe("tbox");
  });

  it("defaults ABSENT / empty / wrong-typed input to HARD, never soft @req:18ecf16f-a163-4b78-9bee-605db7e75f8e", () => {
    // AC4 boundary: "kind not set" must NOT read as "parkable".
    for (const raw of [undefined, null, "", "   ", 42, true, {}, []]) {
      expect(resolveDependencyKind(raw)).toBe("tbox");
    }
  });

  it("defaults an UNRECOGNISED value to HARD @req:18ecf16f-a163-4b78-9bee-605db7e75f8e", () => {
    // Soft is the outcome that silently loses a class type, so it is the one
    // made to require positive evidence — a typo must not park an AssetSpace.
    expect(resolveDependencyKind("[[00000000-0000-0000-0000-000000000000]]")).toBe(
      "tbox",
    );
    expect(resolveDependencyKind("exo__DependencyKindRefrence")).toBe("tbox");
    expect(resolveDependencyKind("soft")).toBe("tbox");
  });

  it("lets the UID win over a CONFLICTING alias @req:18ecf16f-a163-4b78-9bee-605db7e75f8e", () => {
    // A mismatched alias is authoring drift; the UID is the link target, i.e.
    // what the graph actually resolves — and here it is also the safe side.
    expect(
      resolveDependencyKind(
        `[[${DEPENDENCY_KIND_TBOX_UID}|exo__DependencyKindReference]]`,
      ),
    ).toBe("tbox");
  });
});
