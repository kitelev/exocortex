import {
  buildAssetSpaceDescriptor,
  deriveAssetSpaceNamespace,
  classifySpaceDeclaration,
} from "../../../../src/index";

describe("registerForSync — buildAssetSpaceDescriptor (#3707)", () => {
  const UID = "f3465725-b02d-4d20-b05a-69881a783552";
  const CREATED = "2026-06-28T14:30:00+05:00";

  it("builds a uid-named exo__AssetSpace descriptor with self-anchor, source, namespace", () => {
    const d = buildAssetSpaceDescriptor({
      uid: UID,
      sourceUrl: "https://github.com/kitelev/exoas-pmbok",
      createdAt: CREATED,
    });
    expect(d).not.toBeNull();
    expect(d!.fileName).toBe(`${UID}.md`);
    const fm = d!.frontmatter;
    expect(fm["exo__Asset_uid"]).toBe(UID);
    // SELF-anchor isDefinedBy → descriptor stays co-located in the pack folder.
    expect(fm["exo__Asset_isDefinedBy"]).toBe(`[[${UID}]]`);
    expect(fm["exo__Instance_class"]).toEqual([
      "[[73bd00e4-ccc0-4f3f-b20d-c4388c4588fb]]",
    ]);
    expect(fm["exo__AssetSpace_source"]).toBe(
      "https://github.com/kitelev/exoas-pmbok",
    );
    expect(fm["exo__AssetSpace_namespace"]).toBe("pmbok");
    expect(fm["exo__Asset_label"]).toBe("kitelev/exoas-pmbok");
    expect(fm["exo__Asset_createdAt"]).toBe(CREATED);
    expect(fm["aliases"]).toEqual(["$pmbok AssetSpace"]);
    expect(d!.body).toContain("registered for ExoSync");
  });

  it("is recognised by the REAL ExoSync discriminator as a sync candidate", () => {
    // The genuine end-to-end claim: a descriptor this builder produces makes the
    // pack sync-eligible per classifySpaceDeclaration (the sync-set discriminator).
    const d = buildAssetSpaceDescriptor({
      uid: UID,
      sourceUrl: "https://github.com/kitelev/exoas-pmbok",
      createdAt: CREATED,
    })!;
    const verdict = classifySpaceDeclaration(
      d.frontmatter,
      `assetspaces/kitelev/exoas-pmbok/${d.fileName}`,
    );
    expect(verdict.kind).toBe("candidate");
    if (verdict.kind === "candidate") {
      expect(verdict.candidate.spec.repoKey).toBe("kitelev/exoas-pmbok#main");
      expect(verdict.candidate.spec.localPath).toBe(
        "assetspaces/kitelev/exoas-pmbok",
      );
    }
  });

  it("strips the .git suffix from the source URL and derives the namespace", () => {
    const d = buildAssetSpaceDescriptor({
      uid: UID,
      sourceUrl: "https://github.com/mudriy/exoas-tbank.git",
      createdAt: CREATED,
    })!;
    expect(d.frontmatter["exo__AssetSpace_source"]).toBe(
      "https://github.com/mudriy/exoas-tbank",
    );
    expect(d.frontmatter["exo__AssetSpace_namespace"]).toBe("tbank");
  });

  it("honours an explicit namespace override", () => {
    const d = buildAssetSpaceDescriptor({
      uid: UID,
      sourceUrl: "https://github.com/acme/widgets",
      namespace: "custom-ns",
      createdAt: CREATED,
    })!;
    expect(d.frontmatter["exo__AssetSpace_namespace"]).toBe("custom-ns");
    // No `exoas-` prefix on `widgets` → label is owner/repo verbatim.
    expect(d.frontmatter["exo__Asset_label"]).toBe("acme/widgets");
  });

  it("returns null for a non-GitHub / malformed source URL", () => {
    expect(
      buildAssetSpaceDescriptor({
        uid: UID,
        sourceUrl: "https://gitlab.com/owner/repo",
        createdAt: CREATED,
      }),
    ).toBeNull();
    expect(
      buildAssetSpaceDescriptor({
        uid: UID,
        sourceUrl: "not-a-url",
        createdAt: CREATED,
      }),
    ).toBeNull();
  });

  it("returns null for a blank uid", () => {
    expect(
      buildAssetSpaceDescriptor({
        uid: "   ",
        sourceUrl: "https://github.com/kitelev/exoas-pmbok",
        createdAt: CREATED,
      }),
    ).toBeNull();
  });
});

describe("registerForSync — deriveAssetSpaceNamespace", () => {
  it("strips the exoas- prefix", () => {
    expect(
      deriveAssetSpaceNamespace("https://github.com/kitelev/exoas-pmbok"),
    ).toBe("pmbok");
  });
  it("keeps a repo without the exoas- prefix verbatim", () => {
    expect(deriveAssetSpaceNamespace("https://github.com/acme/widgets")).toBe(
      "widgets",
    );
  });
  it("returns null for a non-GitHub URL", () => {
    expect(deriveAssetSpaceNamespace("https://example.com/x/y")).toBeNull();
  });
});
