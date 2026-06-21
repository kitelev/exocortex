/**
 * Unit tests for the shared `iriToObsidianName` pure utility
 * (RFC 78c2b7d0 C4 — extracted from CommandResolver so NamedQueryRunner can
 * reverse-map SELECT IRI bindings without duplicating the regex).
 */
import { iriToObsidianName } from "../../../src/utilities/iriToObsidianName";

describe("iriToObsidianName", () => {
  it("maps a symbolic ontology IRI to prefix__local", () => {
    expect(
      iriToObsidianName("https://exocortex.my/ontology/ems#EffortStatusDoing"),
    ).toBe("ems__EffortStatusDoing");
  });

  it("supports ad-hoc namespaces under the same base (Issue #3274)", () => {
    expect(
      iriToObsidianName("https://exocortex.my/ontology/query#NamedQuery"),
    ).toBe("query__NamedQuery");
    expect(
      iriToObsidianName("https://exocortex.my/ontology/kitelev#Foo"),
    ).toBe("kitelev__Foo");
  });

  it("maps an obsidian:// vault URL to the file basename (UID-canon)", () => {
    expect(
      iriToObsidianName(
        "obsidian://vault/assetspaces/onto/9f1c0b2a-archive.md",
      ),
    ).toBe("9f1c0b2a-archive");
  });

  it("maps any path ending in /<basename>.md to the basename", () => {
    expect(iriToObsidianName("file:///x/y/ems__Task.md")).toBe("ems__Task");
  });

  it("returns null for an unrecognised IRI shape", () => {
    expect(iriToObsidianName("https://example.org/not-an-onto")).toBeNull();
    expect(iriToObsidianName("urn:uuid:1234")).toBeNull();
  });
});
