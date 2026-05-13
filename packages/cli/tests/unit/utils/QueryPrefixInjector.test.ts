import { injectExocortexPrefixes, transformShorthandNotation, filterOntologyPrefixes } from "../../../src/utils/QueryPrefixInjector";

describe("QueryPrefixInjector", () => {
  describe("injectExocortexPrefixes", () => {
    it("should inject all prefixes when none are declared", () => {
      const query = "SELECT ?s WHERE { ?s exo:Instance_class ems:Task }";
      const result = injectExocortexPrefixes(query);

      expect(result).toContain("PREFIX exo: <https://exocortex.my/ontology/exo#>");
      expect(result).toContain("PREFIX ems: <https://exocortex.my/ontology/ems#>");
      expect(result).toContain("PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>");
      expect(result).toContain(query); // original query preserved at end
    });

    it("should not duplicate already-declared prefixes", () => {
      const query = "PREFIX exo: <https://exocortex.my/ontology/exo#>\nSELECT ?s WHERE { ?s exo:Instance_class ?o }";
      const result = injectExocortexPrefixes(query);

      // exo: should NOT appear in injected section (already declared)
      const exoCount = (result.match(/PREFIX exo:/gi) || []).length;
      expect(exoCount).toBe(1);

      // Other prefixes should be injected
      expect(result).toContain("PREFIX ems:");
    });

    it("should handle case-insensitive PREFIX matching", () => {
      const query = "prefix EXO: <https://exocortex.my/ontology/exo#>\nSELECT ?s WHERE { ?s EXO:Instance_class ?o }";
      const result = injectExocortexPrefixes(query);

      const exoCount = (result.match(/PREFIX exo:/gi) || []).length;
      expect(exoCount).toBe(1);
    });

    it("should return query unchanged when all prefixes are declared", () => {
      const query = `PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>
PREFIX ims: <https://exocortex.my/ontology/ims#>
PREFIX gtd: <https://exocortex.my/ontology/gtd#>
PREFIX period: <https://exocortex.my/ontology/period#>
PREFIX lit: <https://exocortex.my/ontology/lit#>
PREFIX inbox: <https://exocortex.my/ontology/inbox#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
SELECT ?s WHERE { ?s exo:Instance_class ems:Task }`;
      const result = injectExocortexPrefixes(query);
      expect(result).toBe(query);
    });
  });

  describe("transformShorthandNotation", () => {
    it("should transform <exo__Instance_class> to exo:Instance_class", () => {
      const query = "SELECT ?s WHERE { ?s <exo__Instance_class> <ems__Meeting> }";
      const result = transformShorthandNotation(query);
      expect(result).toBe("SELECT ?s WHERE { ?s exo:Instance_class ems:Meeting }");
    });

    it("should transform <ems__Effort_status> correctly", () => {
      const query = "SELECT ?s ?status WHERE { ?s <ems__Effort_status> ?status }";
      const result = transformShorthandNotation(query);
      expect(result).toBe("SELECT ?s ?status WHERE { ?s ems:Effort_status ?status }");
    });

    it("should not transform unknown namespace shorthands", () => {
      const query = "SELECT ?s WHERE { ?s <custom__property> ?o }";
      const result = transformShorthandNotation(query);
      expect(result).toBe("SELECT ?s WHERE { ?s <custom__property> ?o }");
    });

    it("should not transform full IRIs in angle brackets", () => {
      const query = "SELECT ?s WHERE { ?s <https://example.org/property> ?o }";
      const result = transformShorthandNotation(query);
      expect(result).toBe(query);
    });

    it("should handle multiple shorthands in one query", () => {
      const query = "SELECT ?s WHERE { ?s <exo__Instance_class> <ems__Task> . ?s <exo__Asset_label> ?l }";
      const result = transformShorthandNotation(query);
      expect(result).toBe("SELECT ?s WHERE { ?s exo:Instance_class ems:Task . ?s exo:Asset_label ?l }");
    });

    it("should not transform bare names without angle brackets", () => {
      const query = "SELECT ?s WHERE { ?s exo__Instance_class ?o }";
      const result = transformShorthandNotation(query);
      // No angle brackets — no transformation
      expect(result).toBe(query);
    });
  });

  describe("filterOntologyPrefixes", () => {
    it("should remove ontology prefixes from vault prefix map", () => {
      const vaultPrefixes = new Map([
        ["exo", "obsidian://vault/03%20Knowledge/exo/"],
        ["ems", "obsidian://vault/03%20Knowledge/ems/"],
        ["kitelev", "obsidian://vault/03%20Knowledge/kitelev/"],
        ["concepts", "obsidian://vault/03%20Knowledge/concepts/"],
      ]);

      const filtered = filterOntologyPrefixes(vaultPrefixes);

      expect(filtered.has("exo")).toBe(false);
      expect(filtered.has("ems")).toBe(false);
      expect(filtered.has("kitelev")).toBe(true);
      expect(filtered.has("concepts")).toBe(true);
      expect(filtered.size).toBe(2);
    });

    it("should not modify the original map", () => {
      const vaultPrefixes = new Map([
        ["exo", "obsidian://vault/03%20Knowledge/exo/"],
      ]);

      filterOntologyPrefixes(vaultPrefixes);
      expect(vaultPrefixes.has("exo")).toBe(true);
    });

    it("should handle empty map", () => {
      const filtered = filterOntologyPrefixes(new Map());
      expect(filtered.size).toBe(0);
    });

    it("auto-declares non-whitelisted prefixes used in the query body", () => {
      // RFC: SHACL namespace whitelist relaxation — `aiKnow:` referenced in the
      // query body must get an auto-injected PREFIX declaration using the
      // standard ontology IRI convention, mirroring NoteToRDFConverter.
      const query =
        "SELECT ?s ?c WHERE { ?s aiKnow:Memory_aboutConcept ?c }";
      const result = injectExocortexPrefixes(query);

      expect(result).toContain(
        "PREFIX aiKnow: <https://exocortex.my/ontology/aiKnow#>",
      );
      // Static whitelist still injected
      expect(result).toContain("PREFIX exo: <https://exocortex.my/ontology/exo#>");
    });

    it("does not auto-declare a prefix when user already supplied one", () => {
      const query = `PREFIX aiKnow: <https://example.org/custom#>
SELECT ?s WHERE { ?s aiKnow:Memory_aboutConcept ?c }`;
      const result = injectExocortexPrefixes(query);

      const aiKnowDecls = (result.match(/PREFIX aiKnow:/gi) || []).length;
      expect(aiKnowDecls).toBe(1);
      // User's custom IRI must be preserved (no override)
      expect(result).toContain("<https://example.org/custom#>");
      expect(result).not.toContain("<https://exocortex.my/ontology/aiKnow#>");
    });

    it("should filter all standard ontology prefixes", () => {
      const allOntology = new Map([
        ["exo", "a"], ["ems", "b"], ["ims", "c"],
        ["gtd", "d"], ["period", "e"], ["lit", "f"],
        ["inbox", "g"], ["rdf", "h"], ["rdfs", "i"],
        ["owl", "j"], ["xsd", "k"],
      ]);

      const filtered = filterOntologyPrefixes(allOntology);
      expect(filtered.size).toBe(0);
    });
  });
});
