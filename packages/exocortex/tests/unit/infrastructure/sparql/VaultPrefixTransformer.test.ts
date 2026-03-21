import { VaultPrefixTransformer } from "../../../../src/infrastructure/sparql/VaultPrefixTransformer";

describe("VaultPrefixTransformer", () => {
  let transformer: VaultPrefixTransformer;

  beforeEach(() => {
    transformer = new VaultPrefixTransformer();
  });

  describe("setVaultPrefixes / getVaultPrefixes", () => {
    it("should store and return vault prefixes", () => {
      const prefixes = new Map([
        ["kitelev", "obsidian://vault/03%20Knowledge/kitelev/"],
      ]);
      transformer.setVaultPrefixes(prefixes);
      expect(transformer.getVaultPrefixes()).toEqual(prefixes);
    });

    it("should return a copy, not the original map", () => {
      const prefixes = new Map([
        ["kitelev", "obsidian://vault/03%20Knowledge/kitelev/"],
      ]);
      transformer.setVaultPrefixes(prefixes);
      const retrieved = transformer.getVaultPrefixes();
      retrieved.set("other", "http://example.com/");
      expect(transformer.getVaultPrefixes().has("other")).toBe(false);
    });
  });

  describe("transform", () => {
    it("should return query unchanged when no vault prefixes are set", () => {
      const query = `SELECT ?label WHERE {
        kitelev:uuid exo:Asset_label ?label .
      }`;
      expect(transformer.transform(query)).toBe(query);
    });

    it("should replace vault prefixed name with full IRI", () => {
      transformer.setVaultPrefixes(
        new Map([["kitelev", "obsidian://vault/03%20Knowledge/kitelev/"]])
      );

      const query = `PREFIX exo: <https://exocortex.my/ontology/exo#>
SELECT ?label WHERE {
  kitelev:dce4f087-1393-4e1b-a09f-8da39d3a5fa3 exo:Asset_label ?label .
}`;

      const result = transformer.transform(query);

      // Should replace kitelev:uuid with full IRI (including .md suffix)
      expect(result).toContain(
        "<obsidian://vault/03%20Knowledge/kitelev/dce4f087-1393-4e1b-a09f-8da39d3a5fa3.md>"
      );
      // Original PREFIX exo: should be preserved
      expect(result).toContain("PREFIX exo:");
      // The prefixed name should be replaced (no longer present)
      expect(result).not.toContain("kitelev:dce4f087-1393-4e1b-a09f-8da39d3a5fa3");
    });

    it("should not inject PREFIX if already declared by user", () => {
      transformer.setVaultPrefixes(
        new Map([["kitelev", "obsidian://vault/03%20Knowledge/kitelev/"]])
      );

      const query = `PREFIX kitelev: <obsidian://vault/03%20Knowledge/kitelev/>
PREFIX exo: <https://exocortex.my/ontology/exo#>
SELECT ?label WHERE {
  kitelev:dce4f087 exo:Asset_label ?label .
}`;

      const result = transformer.transform(query);

      // Should not have duplicate PREFIX declarations
      const kitelevPrefixCount = (
        result.match(/PREFIX kitelev:/g) || []
      ).length;
      expect(kitelevPrefixCount).toBe(1);
    });

    it("should handle multiple vault prefixes", () => {
      transformer.setVaultPrefixes(
        new Map([
          ["kitelev", "obsidian://vault/03%20Knowledge/kitelev/"],
          ["shared", "obsidian://vault/03%20Knowledge/shared/"],
        ])
      );

      const query = `SELECT ?s ?label WHERE {
  kitelev:uuid1 exo:Asset_label ?label .
  shared:uuid2 exo:Asset_label ?s .
}`;

      const result = transformer.transform(query);

      expect(result).toContain(
        "<obsidian://vault/03%20Knowledge/kitelev/uuid1.md>"
      );
      expect(result).toContain(
        "<obsidian://vault/03%20Knowledge/shared/uuid2.md>"
      );
    });

    it("should not replace unused vault prefixes", () => {
      transformer.setVaultPrefixes(
        new Map([
          ["kitelev", "obsidian://vault/03%20Knowledge/kitelev/"],
          ["unused", "obsidian://vault/03%20Knowledge/unused/"],
        ])
      );

      const query = `SELECT ?label WHERE {
  kitelev:uuid1 exo:Asset_label ?label .
}`;

      const result = transformer.transform(query);

      expect(result).toContain("<obsidian://vault/03%20Knowledge/kitelev/uuid1.md>");
      expect(result).not.toContain("unused");
    });

    it("should not match prefixes inside string literals", () => {
      transformer.setVaultPrefixes(
        new Map([["kitelev", "obsidian://vault/03%20Knowledge/kitelev/"]])
      );

      const query = `SELECT ?s WHERE {
  ?s exo:Asset_label "kitelev:some-value" .
}`;

      const result = transformer.transform(query);

      // Should NOT inject kitelev prefix since it only appears in a string
      expect(result).not.toContain("PREFIX kitelev:");
    });

    it("should not match prefixes inside URIs", () => {
      transformer.setVaultPrefixes(
        new Map([["kitelev", "obsidian://vault/03%20Knowledge/kitelev/"]])
      );

      const query = `SELECT ?s WHERE {
  ?s <http://example.org/kitelev:thing> ?o .
}`;

      const result = transformer.transform(query);

      expect(result).not.toContain("PREFIX kitelev:");
    });

    it("should handle case-insensitive PREFIX declarations", () => {
      transformer.setVaultPrefixes(
        new Map([["kitelev", "obsidian://vault/03%20Knowledge/kitelev/"]])
      );

      const query = `prefix kitelev: <obsidian://vault/03%20Knowledge/kitelev/>
SELECT ?label WHERE {
  kitelev:uuid exo:Asset_label ?label .
}`;

      const result = transformer.transform(query);

      const kitelevPrefixCount = (
        result.match(/(?:PREFIX|prefix) kitelev:/gi) || []
      ).length;
      expect(kitelevPrefixCount).toBe(1);
    });

    it("should handle query with no prefixed names", () => {
      transformer.setVaultPrefixes(
        new Map([["kitelev", "obsidian://vault/03%20Knowledge/kitelev/"]])
      );

      const query = `SELECT ?s ?p ?o WHERE {
  ?s ?p ?o .
} LIMIT 10`;

      const result = transformer.transform(query);

      expect(result).toBe(query);
    });

    it("should not treat http/https as vault prefixes", () => {
      transformer.setVaultPrefixes(
        new Map([["http", "obsidian://vault/03%20Knowledge/http/"]])
      );

      const query = `SELECT ?s WHERE {
  ?s ?p ?o .
}`;

      const result = transformer.transform(query);

      expect(result).not.toContain("PREFIX http:");
    });

    it("should handle real-world query with UUID local name", () => {
      transformer.setVaultPrefixes(
        new Map([["kitelev", "obsidian://vault/03%20Knowledge/kitelev/"]])
      );

      const query = `PREFIX exo: <https://exocortex.my/ontology/exo#>
SELECT ?label WHERE {
  kitelev:dce4f087-1393-4e1b-a09f-8da39d3a5fa3 exo:Asset_label ?label .
}`;

      const result = transformer.transform(query);

      expect(result).toContain(
        "<obsidian://vault/03%20Knowledge/kitelev/dce4f087-1393-4e1b-a09f-8da39d3a5fa3.md>"
      );
    });

    it("should not inject PREFIX for PREFIX/BASE keywords", () => {
      transformer.setVaultPrefixes(
        new Map([
          ["PREFIX", "obsidian://vault/03%20Knowledge/PREFIX/"],
          ["BASE", "obsidian://vault/03%20Knowledge/BASE/"],
        ])
      );

      const query = `PREFIX exo: <https://exocortex.my/ontology/exo#>
SELECT ?s WHERE { ?s exo:Asset_label ?o }`;

      const result = transformer.transform(query);

      expect(result).not.toContain("PREFIX PREFIX:");
      expect(result).not.toContain("PREFIX BASE:");
    });

    it("should skip prefixes inside comments", () => {
      transformer.setVaultPrefixes(
        new Map([["kitelev", "obsidian://vault/03%20Knowledge/kitelev/"]])
      );

      const query = `SELECT ?s WHERE {
  # kitelev:something is just a comment
  ?s ?p ?o .
}`;

      const result = transformer.transform(query);

      expect(result).not.toContain("PREFIX kitelev:");
    });

    it("should handle empty prefix map after setting", () => {
      transformer.setVaultPrefixes(new Map());

      const query = `SELECT ?s WHERE { ?s ?p ?o }`;
      expect(transformer.transform(query)).toBe(query);
    });

    it("should work with multiple prefixed names from same namespace", () => {
      transformer.setVaultPrefixes(
        new Map([["ns", "obsidian://vault/03%20Knowledge/ns/"]])
      );

      const query = `SELECT ?a ?b WHERE {
  ns:uuid1 ?p ?a .
  ns:uuid2 ?p ?b .
}`;

      const result = transformer.transform(query);

      // Both prefixed names should be replaced with full IRIs
      expect(result).toContain("<obsidian://vault/03%20Knowledge/ns/uuid1.md>");
      expect(result).toContain("<obsidian://vault/03%20Knowledge/ns/uuid2.md>");
    });
  });
});
