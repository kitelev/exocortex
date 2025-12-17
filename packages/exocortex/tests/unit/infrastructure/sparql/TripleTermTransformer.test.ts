import {
  TripleTermTransformer,
  TripleTermTransformerError,
} from "../../../../src/infrastructure/sparql/TripleTermTransformer";

describe("TripleTermTransformer", () => {
  let transformer: TripleTermTransformer;

  beforeEach(() => {
    transformer = new TripleTermTransformer();
  });

  describe("hasTripleTermSyntax", () => {
    it("should return true for query with <<( syntax", () => {
      const query = `SELECT * WHERE { <<( :Alice :knows :Bob )>> ?p ?o }`;
      expect(transformer.hasTripleTermSyntax(query)).toBe(true);
    });

    it("should return true for query with whitespace in <<( syntax", () => {
      const query = `SELECT * WHERE { << ( :Alice :knows :Bob ) >> ?p ?o }`;
      expect(transformer.hasTripleTermSyntax(query)).toBe(true);
    });

    it("should return false for query with standard << >> syntax", () => {
      const query = `SELECT * WHERE { << :Alice :knows :Bob >> ?p ?o }`;
      expect(transformer.hasTripleTermSyntax(query)).toBe(false);
    });

    it("should return false for query without triple terms", () => {
      const query = `SELECT * WHERE { ?s ?p ?o }`;
      expect(transformer.hasTripleTermSyntax(query)).toBe(false);
    });

    it("should return false for <<( inside a string literal", () => {
      const query = `SELECT * WHERE { ?s ?p "test <<( not a triple )>>" }`;
      expect(transformer.hasTripleTermSyntax(query)).toBe(false);
    });
  });

  describe("transform", () => {
    describe("basic transformation", () => {
      it("should transform simple <<( )>> to << >>", () => {
        const query = `SELECT * WHERE { <<( :Alice :knows :Bob )>> ?p ?o }`;
        const result = transformer.transform(query);
        expect(result).toBe(`SELECT * WHERE { << :Alice :knows :Bob >> ?p ?o }`);
      });

      it("should transform with extra whitespace", () => {
        const query = `SELECT * WHERE { <<(  :Alice  :knows  :Bob  )>> ?p ?o }`;
        const result = transformer.transform(query);
        expect(result).toBe(`SELECT * WHERE { << :Alice  :knows  :Bob >> ?p ?o }`);
      });

      it("should transform with whitespace around brackets", () => {
        const query = `SELECT * WHERE { << ( :Alice :knows :Bob ) >> ?p ?o }`;
        const result = transformer.transform(query);
        expect(result).toBe(`SELECT * WHERE { << :Alice :knows :Bob >> ?p ?o }`);
      });

      it("should transform with variables", () => {
        const query = `SELECT * WHERE { <<( ?s :knows ?o )>> ?p ?v }`;
        const result = transformer.transform(query);
        expect(result).toBe(`SELECT * WHERE { << ?s :knows ?o >> ?p ?v }`);
      });

      it("should transform with full IRIs", () => {
        const query = `SELECT * WHERE { <<( <http://example.org/Alice> <http://example.org/knows> <http://example.org/Bob> )>> ?p ?o }`;
        const result = transformer.transform(query);
        expect(result).toBe(`SELECT * WHERE { << <http://example.org/Alice> <http://example.org/knows> <http://example.org/Bob> >> ?p ?o }`);
      });

      it("should transform with literal object", () => {
        const query = `SELECT * WHERE { <<( :Alice :name "Alice Smith" )>> ?p ?o }`;
        const result = transformer.transform(query);
        expect(result).toBe(`SELECT * WHERE { << :Alice :name "Alice Smith" >> ?p ?o }`);
      });

      it("should transform with typed literal object", () => {
        const query = `SELECT * WHERE { <<( :Alice :age "30"^^xsd:integer )>> ?p ?o }`;
        const result = transformer.transform(query);
        expect(result).toBe(`SELECT * WHERE { << :Alice :age "30"^^xsd:integer >> ?p ?o }`);
      });

      it("should transform with language-tagged literal object", () => {
        const query = `SELECT * WHERE { <<( :Alice :name "Alice"@en )>> ?p ?o }`;
        const result = transformer.transform(query);
        expect(result).toBe(`SELECT * WHERE { << :Alice :name "Alice"@en >> ?p ?o }`);
      });

      it("should transform with blank node subject", () => {
        const query = `SELECT * WHERE { <<( _:b1 :knows :Bob )>> ?p ?o }`;
        const result = transformer.transform(query);
        expect(result).toBe(`SELECT * WHERE { << _:b1 :knows :Bob >> ?p ?o }`);
      });
    });

    describe("multiple triple terms", () => {
      it("should transform multiple triple terms in a query", () => {
        const query = `SELECT * WHERE {
          <<( :Alice :knows :Bob )>> :source ?src1 .
          <<( :Bob :knows :Carol )>> :source ?src2 .
        }`;
        const result = transformer.transform(query);
        expect(result).toContain("<< :Alice :knows :Bob >>");
        expect(result).toContain("<< :Bob :knows :Carol >>");
        expect(result).not.toContain("<<(");
        expect(result).not.toContain(")>>");
      });
    });

    describe("nested triple terms", () => {
      it("should transform nested triple term (triple as subject)", () => {
        const query = `SELECT * WHERE { <<( <<( :Alice :knows :Bob )>> :source :Wikipedia )>> ?p ?o }`;
        const result = transformer.transform(query);
        expect(result).toBe(`SELECT * WHERE { << << :Alice :knows :Bob >> :source :Wikipedia >> ?p ?o }`);
      });

      it("should transform nested triple term (triple as object)", () => {
        const query = `SELECT * WHERE { ?s ?p <<( :doc :claims <<( :Alice :knows :Bob )>> )>> }`;
        const result = transformer.transform(query);
        expect(result).toBe(`SELECT * WHERE { ?s ?p << :doc :claims << :Alice :knows :Bob >> >> }`);
      });

      it("should transform deeply nested triple terms", () => {
        const query = `SELECT * WHERE { <<( <<( <<( :A :b :C )>> :source :D )>> :time ?t )>> ?p ?o }`;
        const result = transformer.transform(query);
        expect(result).toBe(`SELECT * WHERE { << << << :A :b :C >> :source :D >> :time ?t >> ?p ?o }`);
      });
    });

    describe("triple terms in expressions", () => {
      it("should transform triple term in FILTER", () => {
        const query = `PREFIX : <http://example.org/>
SELECT * WHERE {
  ?triple ?p ?o .
  FILTER(?triple = <<( :Alice :knows :Bob )>>)
}`;
        const result = transformer.transform(query);
        expect(result).toContain("FILTER(?triple = << :Alice :knows :Bob >>)");
      });

      it("should transform triple term in BIND", () => {
        const query = `PREFIX : <http://example.org/>
SELECT * WHERE {
  BIND(<<( :Alice :knows :Bob )>> AS ?triple)
  ?triple ?p ?o .
}`;
        const result = transformer.transform(query);
        expect(result).toContain("BIND(<< :Alice :knows :Bob >> AS ?triple)");
      });

      it("should transform triple term in SELECT expression", () => {
        const query = `PREFIX : <http://example.org/>
SELECT (<<( :Alice :knows :Bob )>> AS ?triple) WHERE { ?s ?p ?o }`;
        const result = transformer.transform(query);
        expect(result).toContain("(<< :Alice :knows :Bob >> AS ?triple)");
      });
    });

    describe("preserves standard syntax", () => {
      it("should not modify standard << >> syntax", () => {
        const query = `SELECT * WHERE { << :Alice :knows :Bob >> ?p ?o }`;
        const result = transformer.transform(query);
        expect(result).toBe(query);
      });

      it("should not modify queries without triple terms", () => {
        const query = `SELECT ?s ?p ?o WHERE { ?s ?p ?o }`;
        const result = transformer.transform(query);
        expect(result).toBe(query);
      });
    });

    describe("string literal handling", () => {
      it("should not transform <<( inside single-quoted string", () => {
        const query = `SELECT * WHERE { ?s ?p '<<( not a triple )>>' }`;
        const result = transformer.transform(query);
        expect(result).toBe(query);
      });

      it("should not transform <<( inside double-quoted string", () => {
        const query = `SELECT * WHERE { ?s ?p "<<( not a triple )>>" }`;
        const result = transformer.transform(query);
        expect(result).toBe(query);
      });

      it("should not transform <<( inside triple-quoted string", () => {
        const query = `SELECT * WHERE { ?s ?p """<<( not a triple )>>""" }`;
        const result = transformer.transform(query);
        expect(result).toBe(query);
      });

      it("should handle query with both string and real triple term", () => {
        const query = `SELECT * WHERE {
          <<( :Alice :knows :Bob )>> :comment "this is not <<( a triple )>>" .
        }`;
        const result = transformer.transform(query);
        expect(result).toContain("<< :Alice :knows :Bob >>");
        expect(result).toContain('"this is not <<( a triple )>>"');
      });
    });

    describe("error handling", () => {
      it("should throw error for unclosed triple term", () => {
        const query = `SELECT * WHERE { <<( :Alice :knows :Bob ?p ?o }`;
        expect(() => transformer.transform(query)).toThrow(TripleTermTransformerError);
        expect(() => transformer.transform(query)).toThrow("Unclosed triple term");
      });

      it("should handle deeply nested triple terms without error", () => {
        // Even deeply nested triple terms should transform successfully
        // The max iterations only guards against infinite loops, not deep nesting
        let nestedQuery = ":A :b :C";
        for (let i = 0; i < 50; i++) {
          nestedQuery = `<<( ${nestedQuery} )>>`;
        }
        const query = `SELECT * WHERE { ${nestedQuery} ?p ?o }`;
        const result = transformer.transform(query);
        // Should have transformed all <<( )>> to << >>
        expect(result).not.toContain("<<(");
        expect(result).not.toContain(")>>");
        // Should contain the standard syntax
        expect(result).toContain("<< :A :b :C >>");
      });
    });

    describe("edge cases", () => {
      it("should handle empty query", () => {
        const result = transformer.transform("");
        expect(result).toBe("");
      });

      it("should handle query with only whitespace", () => {
        const result = transformer.transform("   \n\t  ");
        expect(result).toBe("   \n\t  ");
      });

      it("should handle mixed << >> and <<( )>> syntax", () => {
        const query = `SELECT * WHERE {
          << :Alice :knows :Bob >> :source ?src1 .
          <<( :Bob :knows :Carol )>> :source ?src2 .
        }`;
        const result = transformer.transform(query);
        expect(result).toContain("<< :Alice :knows :Bob >>");
        expect(result).toContain("<< :Bob :knows :Carol >>");
        expect(result).not.toContain("<<(");
      });

      it("should handle annotation syntax with standard << >>", () => {
        const query = `PREFIX : <http://example.org/>
SELECT * WHERE {
  ?s :knows ?o {| :source ?doc |} .
}`;
        const result = transformer.transform(query);
        expect(result).toBe(query);
      });
    });
  });
});
