import { SPARQL_PREFIXES } from "../../src/services/SparqlPrefixes";

describe("SparqlPrefixes", () => {
  describe("SPARQL_PREFIXES", () => {
    it("should contain exo prefix", () => {
      expect(SPARQL_PREFIXES).toContain("PREFIX exo:");
      expect(SPARQL_PREFIXES).toContain("https://exocortex.my/ontology/exo#");
    });

    it("should contain ems prefix", () => {
      expect(SPARQL_PREFIXES).toContain("PREFIX ems:");
      expect(SPARQL_PREFIXES).toContain("https://exocortex.my/ontology/ems#");
    });

    it("should contain xsd prefix for datatypes", () => {
      expect(SPARQL_PREFIXES).toContain("PREFIX xsd:");
      expect(SPARQL_PREFIXES).toContain("http://www.w3.org/2001/XMLSchema#");
    });
  });
});
