import {
  DomainIRI as IRI,
  InMemoryTripleStore,
  Namespace,
} from "exocortex";

import {
  ASSET_SPACE_MATERIALIZED_PREDICATE,
  injectAssetSpaceMaterializationTriples,
  XSD_BOOLEAN_DATATYPE,
} from "../../../../src/infrastructure/adapters/injectAssetSpaceMaterializationTriples";
import type { AssetSpaceMaterializationStatus } from "../../../../src/infrastructure/adapters/AssetSpaceMaterializationTracker";

describe("injectAssetSpaceMaterializationTriples", () => {
  it("uses canonical exo namespace + xsd:boolean datatype", () => {
    expect(ASSET_SPACE_MATERIALIZED_PREDICATE.value).toBe(
      "https://exocortex.my/ontology/exo#AssetSpace_materialized",
    );
    expect(XSD_BOOLEAN_DATATYPE.value).toBe(
      "http://www.w3.org/2001/XMLSchema#boolean",
    );
  });

  it("injects one triple per AssetSpace with materialized=true literal", async () => {
    const store = new InMemoryTripleStore();
    const statuses: AssetSpaceMaterializationStatus[] = [
      {
        asUid: "uid-ems",
        asFilePath: "assetspaces/ems/uid-ems.md",
        namespace: "ems",
        materialized: true,
      },
    ];

    await injectAssetSpaceMaterializationTriples(store, statuses);

    const triples = await store.match(
      undefined,
      ASSET_SPACE_MATERIALIZED_PREDICATE,
      undefined,
    );
    expect(triples.length).toBe(1);
    const t = triples[0];
    expect((t.subject as IRI).value).toBe(
      "obsidian://vault/assetspaces/ems/uid-ems.md",
    );
    expect(t.predicate.value).toBe(
      "https://exocortex.my/ontology/exo#AssetSpace_materialized",
    );
    expect(t.object.toString()).toContain("true");
  });

  it("injects materialized=false literal for un-materialized AS", async () => {
    const store = new InMemoryTripleStore();
    const statuses: AssetSpaceMaterializationStatus[] = [
      {
        asUid: "uid-kpc",
        asFilePath: "assetspaces/shared-identities/uid-kpc.md",
        namespace: "kpc",
        materialized: false,
      },
    ];

    await injectAssetSpaceMaterializationTriples(store, statuses);

    const triples = await store.match(
      undefined,
      ASSET_SPACE_MATERIALIZED_PREDICATE,
      undefined,
    );
    expect(triples.length).toBe(1);
    expect(triples[0].object.toString()).toContain("false");
  });

  it("URL-encodes special characters in vault paths", async () => {
    const store = new InMemoryTripleStore();
    const statuses: AssetSpaceMaterializationStatus[] = [
      {
        asUid: "uid-x",
        asFilePath: "assetspaces/my space/uid-x.md",
        namespace: "my space",
        materialized: true,
      },
    ];

    await injectAssetSpaceMaterializationTriples(store, statuses);

    const triples = await store.match(
      undefined,
      ASSET_SPACE_MATERIALIZED_PREDICATE,
      undefined,
    );
    expect(triples.length).toBe(1);
    expect((triples[0].subject as IRI).value).toBe(
      "obsidian://vault/assetspaces/my%20space/uid-x.md",
    );
  });

  it("emits triples for both materialized and un-materialized states", async () => {
    const store = new InMemoryTripleStore();
    const statuses: AssetSpaceMaterializationStatus[] = [
      {
        asUid: "uid-ems",
        asFilePath: "assetspaces/ems/uid-ems.md",
        namespace: "ems",
        materialized: true,
      },
      {
        asUid: "uid-kpc",
        asFilePath: "assetspaces/shared-identities/uid-kpc.md",
        namespace: "kpc",
        materialized: false,
      },
      {
        asUid: "uid-exo",
        asFilePath: "assetspaces/exo/uid-exo.md",
        namespace: "exo",
        materialized: true,
      },
    ];

    await injectAssetSpaceMaterializationTriples(store, statuses);

    const triples = await store.match(
      undefined,
      ASSET_SPACE_MATERIALIZED_PREDICATE,
      undefined,
    );
    expect(triples.length).toBe(3);
    const byPath = new Map(
      triples.map((t) => [
        (t.subject as IRI).value.replace("obsidian://vault/", ""),
        t.object.toString(),
      ]),
    );
    expect(byPath.get("assetspaces/ems/uid-ems.md")).toContain("true");
    expect(byPath.get("assetspaces/shared-identities/uid-kpc.md")).toContain(
      "false",
    );
    expect(byPath.get("assetspaces/exo/uid-exo.md")).toContain("true");
  });

  it("supports SPARQL-shaped filter (POS index) by predicate + object", async () => {
    const store = new InMemoryTripleStore();
    const statuses: AssetSpaceMaterializationStatus[] = [
      {
        asUid: "uid-ems",
        asFilePath: "assetspaces/ems/uid-ems.md",
        namespace: "ems",
        materialized: true,
      },
      {
        asUid: "uid-kpc",
        asFilePath: "assetspaces/shared-identities/uid-kpc.md",
        namespace: "kpc",
        materialized: false,
      },
    ];

    await injectAssetSpaceMaterializationTriples(store, statuses);

    // Filter to materialized=true only — emulates SPARQL FILTER(?m = true)
    const materializedTriples = await store.match(
      undefined,
      ASSET_SPACE_MATERIALIZED_PREDICATE,
      undefined,
    );
    const trueOnly = materializedTriples.filter((t) =>
      t.object.toString().includes("true"),
    );
    expect(trueOnly.length).toBe(1);
    expect((trueOnly[0].subject as IRI).value).toContain("uid-ems");
  });

  it("uses canonical exo namespace alignment with Namespace.EXO term", () => {
    expect(Namespace.EXO.term("AssetSpace_materialized").value).toBe(
      ASSET_SPACE_MATERIALIZED_PREDICATE.value,
    );
  });
});
