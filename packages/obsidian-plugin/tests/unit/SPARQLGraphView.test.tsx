import React from "react";
import { render } from "@testing-library/react";
import { SPARQLGraphView, extractPredicateName } from "../../src/presentation/components/sparql/SPARQLGraphView";
import type { Triple, GraphNode } from "exocortex";

jest.mock("d3", () => ({
  select: jest.fn(() => ({
    selectAll: jest.fn(() => ({ remove: jest.fn() })),
    attr: jest.fn().mockReturnThis(),
    append: jest.fn().mockReturnThis(),
    call: jest.fn().mockReturnThis(),
  })),
  zoom: jest.fn(() => ({
    scaleExtent: jest.fn().mockReturnThis(),
    on: jest.fn().mockReturnThis(),
  })),
  forceSimulation: jest.fn(() => ({
    force: jest.fn().mockReturnThis(),
    on: jest.fn().mockReturnThis(),
    stop: jest.fn(),
    alphaTarget: jest.fn().mockReturnThis(),
    restart: jest.fn(),
  })),
  forceLink: jest.fn(() => ({
    id: jest.fn().mockReturnThis(),
    distance: jest.fn().mockReturnThis(),
  })),
  forceManyBody: jest.fn(() => ({
    strength: jest.fn().mockReturnThis(),
  })),
  forceCenter: jest.fn(),
  forceCollide: jest.fn(() => ({
    radius: jest.fn().mockReturnThis(),
  })),
  drag: jest.fn(() => ({
    on: jest.fn().mockReturnThis(),
  })),
}));

describe("SPARQLGraphView", () => {
  const mockOnAssetClick = jest.fn();

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("Basic rendering", () => {
    it("should render empty container when no triples provided", () => {
      const { container } = render(<SPARQLGraphView triples={[]} onAssetClick={mockOnAssetClick} />);

      const graphView = container.querySelector(".sparql-graph-view");
      expect(graphView).toBeInTheDocument();
      expect(graphView?.querySelector("svg")).toBeInTheDocument();
    });

    it("should render with valid triples", () => {
      const triples: Triple[] = [
        {
          subject: { toString: () => "<https://example.org/note1>" } as any,
          predicate: { toString: () => "<https://example.org/relatesTo>" } as any,
          object: { toString: () => "<https://example.org/note2>" } as any,
        },
      ];

      const { container } = render(<SPARQLGraphView triples={triples} onAssetClick={mockOnAssetClick} />);

      const graphView = container.querySelector(".sparql-graph-view");
      expect(graphView).toBeInTheDocument();
      expect(graphView?.querySelector("svg")).toBeInTheDocument();
    });

    it("should render SVG element", () => {
      const triples: Triple[] = [
        {
          subject: { toString: () => "<https://example.org/note1>" } as any,
          predicate: { toString: () => "<https://example.org/relatesTo>" } as any,
          object: { toString: () => "<https://example.org/note2>" } as any,
        },
      ];

      const { container } = render(<SPARQLGraphView triples={triples} onAssetClick={mockOnAssetClick} />);

      expect(container.querySelector("svg")).toBeInTheDocument();
    });
  });

  describe("Props handling", () => {
    it("should accept triples prop", () => {
      const triples: Triple[] = [
        {
          subject: { toString: () => "<https://example.org/note1>" } as any,
          predicate: { toString: () => "<https://example.org/relatesTo>" } as any,
          object: { toString: () => "<https://example.org/note2>" } as any,
        },
      ];

      expect(() => {
        render(<SPARQLGraphView triples={triples} onAssetClick={mockOnAssetClick} />);
      }).not.toThrow();
    });

    it("should accept onAssetClick callback", () => {
      const triples: Triple[] = [];
      const customCallback = jest.fn();

      expect(() => {
        render(<SPARQLGraphView triples={triples} onAssetClick={customCallback} />);
      }).not.toThrow();
    });

    it("should handle multiple triples", () => {
      const triples: Triple[] = [
        {
          subject: { toString: () => "<https://example.org/note1>" } as any,
          predicate: { toString: () => "<https://example.org/relatesTo>" } as any,
          object: { toString: () => "<https://example.org/note2>" } as any,
        },
        {
          subject: { toString: () => "<https://example.org/note2>" } as any,
          predicate: { toString: () => "<https://example.org/links>" } as any,
          object: { toString: () => "<https://example.org/note3>" } as any,
        },
      ];

      expect(() => {
        render(<SPARQLGraphView triples={triples} onAssetClick={mockOnAssetClick} />);
      }).not.toThrow();
    });
  });

  describe("Edge cases", () => {
    it("should handle empty triples array gracefully", () => {
      const { container } = render(<SPARQLGraphView triples={[]} onAssetClick={mockOnAssetClick} />);

      expect(container.querySelector(".sparql-graph-view")).toBeInTheDocument();
    });

    it("should handle triples with labels", () => {
      const triples: Triple[] = [
        {
          subject: { toString: () => "<https://example.org/note1>" } as any,
          predicate: { toString: () => "<http://www.w3.org/2000/01/rdf-schema#label>" } as any,
          object: { toString: () => '"My Note"' } as any,
        },
      ];

      expect(() => {
        render(<SPARQLGraphView triples={triples} onAssetClick={mockOnAssetClick} />);
      }).not.toThrow();
    });

    it("should handle triples without angle brackets (plain IRIs)", () => {
      const triples: Triple[] = [
        {
          subject: { toString: () => "https://example.org/note1" } as any,
          predicate: { toString: () => "https://example.org/relatesTo" } as any,
          object: { toString: () => "https://example.org/note2" } as any,
        },
      ];

      expect(() => {
        render(<SPARQLGraphView triples={triples} onAssetClick={mockOnAssetClick} />);
      }).not.toThrow();
    });

    it("should handle malformed triple IRIs", () => {
      const triples: Triple[] = [
        {
          subject: { toString: () => "not-an-iri" } as any,
          predicate: { toString: () => "also-not-an-iri" } as any,
          object: { toString: () => "invalid" } as any,
        },
      ];

      expect(() => {
        render(<SPARQLGraphView triples={triples} onAssetClick={mockOnAssetClick} />);
      }).not.toThrow();
    });
  });

  describe("Component lifecycle", () => {
    it("should render on mount", () => {
      const triples: Triple[] = [
        {
          subject: { toString: () => "<https://example.org/note1>" } as any,
          predicate: { toString: () => "<https://example.org/relatesTo>" } as any,
          object: { toString: () => "<https://example.org/note2>" } as any,
        },
      ];

      const { container } = render(<SPARQLGraphView triples={triples} onAssetClick={mockOnAssetClick} />);

      expect(container.querySelector(".sparql-graph-view")).toBeInTheDocument();
    });

    it("should handle re-render with new triples", () => {
      const triples1: Triple[] = [
        {
          subject: { toString: () => "<https://example.org/note1>" } as any,
          predicate: { toString: () => "<https://example.org/relatesTo>" } as any,
          object: { toString: () => "<https://example.org/note2>" } as any,
        },
      ];

      const triples2: Triple[] = [
        {
          subject: { toString: () => "<https://example.org/note3>" } as any,
          predicate: { toString: () => "<https://example.org/links>" } as any,
          object: { toString: () => "<https://example.org/note4>" } as any,
        },
      ];

      const { rerender, container } = render(<SPARQLGraphView triples={triples1} onAssetClick={mockOnAssetClick} />);

      expect(container.querySelector(".sparql-graph-view")).toBeInTheDocument();

      rerender(<SPARQLGraphView triples={triples2} onAssetClick={mockOnAssetClick} />);

      expect(container.querySelector(".sparql-graph-view")).toBeInTheDocument();
    });

    it("should handle unmount gracefully", () => {
      const triples: Triple[] = [
        {
          subject: { toString: () => "<https://example.org/note1>" } as any,
          predicate: { toString: () => "<https://example.org/relatesTo>" } as any,
          object: { toString: () => "<https://example.org/note2>" } as any,
        },
      ];

      const { unmount } = render(<SPARQLGraphView triples={triples} onAssetClick={mockOnAssetClick} />);

      expect(() => unmount()).not.toThrow();
    });
  });

  describe("Container structure", () => {
    it("should have correct container class", () => {
      const { container } = render(<SPARQLGraphView triples={[]} onAssetClick={mockOnAssetClick} />);

      const graphView = container.querySelector(".sparql-graph-view");
      expect(graphView).toBeInTheDocument();
      expect(graphView?.tagName.toLowerCase()).toBe("div");
    });

    it("should contain SVG element inside container", () => {
      const { container } = render(<SPARQLGraphView triples={[]} onAssetClick={mockOnAssetClick} />);

      const graphView = container.querySelector(".sparql-graph-view");
      const svg = graphView?.querySelector("svg");
      expect(svg).toBeInTheDocument();
    });
  });

  describe("extractPredicateName", () => {
    describe("Basic extraction", () => {
      it("should extract predicate name from IRI with angle brackets", () => {
        const triples: Triple[] = [
          {
            subject: { toString: () => "<https://example.org/note1>" } as any,
            predicate: { toString: () => "<https://example.org/relatesTo>" } as any,
            object: { toString: () => "<https://example.org/note2>" } as any,
          },
        ];

        const result = extractPredicateName("https://example.org/note1", "https://example.org/note2", triples);
        expect(result).toBe("relatesTo");
      });

      it("should extract predicate name with hash separator", () => {
        const triples: Triple[] = [
          {
            subject: { toString: () => "<https://example.org/note1>" } as any,
            predicate: { toString: () => "<http://www.w3.org/2000/01/rdf-schema#label>" } as any,
            object: { toString: () => "<https://example.org/note2>" } as any,
          },
        ];

        const result = extractPredicateName("https://example.org/note1", "https://example.org/note2", triples);
        expect(result).toBe("label");
      });

      it("should extract predicate name with slash separator", () => {
        const triples: Triple[] = [
          {
            subject: { toString: () => "<https://example.org/note1>" } as any,
            predicate: { toString: () => "<https://example.org/predicate/links>" } as any,
            object: { toString: () => "<https://example.org/note2>" } as any,
          },
        ];

        const result = extractPredicateName("https://example.org/note1", "https://example.org/note2", triples);
        expect(result).toBe("links");
      });
    });

    describe("GraphNode inputs", () => {
      it("should handle GraphNode source", () => {
        const triples: Triple[] = [
          {
            subject: { toString: () => "<https://example.org/note1>" } as any,
            predicate: { toString: () => "<https://example.org/connects>" } as any,
            object: { toString: () => "<https://example.org/note2>" } as any,
          },
        ];

        const source: GraphNode = { path: "https://example.org/note1", label: "Note 1" };
        const result = extractPredicateName(source, "https://example.org/note2", triples);
        expect(result).toBe("connects");
      });

      it("should handle GraphNode target", () => {
        const triples: Triple[] = [
          {
            subject: { toString: () => "<https://example.org/note1>" } as any,
            predicate: { toString: () => "<https://example.org/points>" } as any,
            object: { toString: () => "<https://example.org/note2>" } as any,
          },
        ];

        const target: GraphNode = { path: "https://example.org/note2", label: "Note 2" };
        const result = extractPredicateName("https://example.org/note1", target, triples);
        expect(result).toBe("points");
      });

      it("should handle both GraphNode source and target", () => {
        const triples: Triple[] = [
          {
            subject: { toString: () => "<https://example.org/note1>" } as any,
            predicate: { toString: () => "<https://example.org/references>" } as any,
            object: { toString: () => "<https://example.org/note2>" } as any,
          },
        ];

        const source: GraphNode = { path: "https://example.org/note1", label: "Note 1" };
        const target: GraphNode = { path: "https://example.org/note2", label: "Note 2" };
        const result = extractPredicateName(source, target, triples);
        expect(result).toBe("references");
      });
    });

    describe("Fallback behavior", () => {
      it("should return default when triple not found", () => {
        const triples: Triple[] = [
          {
            subject: { toString: () => "<https://example.org/note1>" } as any,
            predicate: { toString: () => "<https://example.org/relatesTo>" } as any,
            object: { toString: () => "<https://example.org/note2>" } as any,
          },
        ];

        const result = extractPredicateName("https://example.org/note3", "https://example.org/note4", triples);
        expect(result).toBe("relates-to");
      });

      it("should return default when triples array is empty", () => {
        const triples: Triple[] = [];

        const result = extractPredicateName("https://example.org/note1", "https://example.org/note2", triples);
        expect(result).toBe("relates-to");
      });

      it("should return default when predicate IRI does not have angle brackets", () => {
        const triples: Triple[] = [
          {
            subject: { toString: () => "<https://example.org/note1>" } as any,
            predicate: { toString: () => "invalid-predicate" } as any,
            object: { toString: () => "<https://example.org/note2>" } as any,
          },
        ];

        const result = extractPredicateName("https://example.org/note1", "https://example.org/note2", triples);
        expect(result).toBe("relates-to");
      });
    });

    describe("Edge cases", () => {
      it("should handle predicate with multiple slashes", () => {
        const triples: Triple[] = [
          {
            subject: { toString: () => "<https://example.org/note1>" } as any,
            predicate: { toString: () => "<https://example.org/predicate/sub/category/deepLink>" } as any,
            object: { toString: () => "<https://example.org/note2>" } as any,
          },
        ];

        const result = extractPredicateName("https://example.org/note1", "https://example.org/note2", triples);
        expect(result).toBe("deepLink");
      });

      it("should handle predicate with multiple hashes", () => {
        const triples: Triple[] = [
          {
            subject: { toString: () => "<https://example.org/note1>" } as any,
            predicate: { toString: () => "<http://www.w3.org/2000/01/rdf-schema#sub#property>" } as any,
            object: { toString: () => "<https://example.org/note2>" } as any,
          },
        ];

        const result = extractPredicateName("https://example.org/note1", "https://example.org/note2", triples);
        expect(result).toBe("property");
      });

      it("should handle predicate with mixed separators", () => {
        const triples: Triple[] = [
          {
            subject: { toString: () => "<https://example.org/note1>" } as any,
            predicate: { toString: () => "<https://example.org/predicate#sub/mixed>" } as any,
            object: { toString: () => "<https://example.org/note2>" } as any,
          },
        ];

        const result = extractPredicateName("https://example.org/note1", "https://example.org/note2", triples);
        expect(result).toBe("mixed");
      });

      it("should handle predicate ending with separator", () => {
        const triples: Triple[] = [
          {
            subject: { toString: () => "<https://example.org/note1>" } as any,
            predicate: { toString: () => "<https://example.org/predicate/>" } as any,
            object: { toString: () => "<https://example.org/note2>" } as any,
          },
        ];

        const result = extractPredicateName("https://example.org/note1", "https://example.org/note2", triples);
        expect(result).toBe("https://example.org/predicate/");
      });

      it("should handle short predicate IRI", () => {
        const triples: Triple[] = [
          {
            subject: { toString: () => "<https://example.org/note1>" } as any,
            predicate: { toString: () => "<p>" } as any,
            object: { toString: () => "<https://example.org/note2>" } as any,
          },
        ];

        const result = extractPredicateName("https://example.org/note1", "https://example.org/note2", triples);
        expect(result).toBe("p");
      });
    });

    describe("Subject/Object matching", () => {
      it("should match correct triple when multiple triples exist", () => {
        const triples: Triple[] = [
          {
            subject: { toString: () => "<https://example.org/note1>" } as any,
            predicate: { toString: () => "<https://example.org/first>" } as any,
            object: { toString: () => "<https://example.org/note2>" } as any,
          },
          {
            subject: { toString: () => "<https://example.org/note1>" } as any,
            predicate: { toString: () => "<https://example.org/second>" } as any,
            object: { toString: () => "<https://example.org/note3>" } as any,
          },
        ];

        const result1 = extractPredicateName("https://example.org/note1", "https://example.org/note2", triples);
        expect(result1).toBe("first");

        const result2 = extractPredicateName("https://example.org/note1", "https://example.org/note3", triples);
        expect(result2).toBe("second");
      });

      it("should not match when subject matches but object doesn't", () => {
        const triples: Triple[] = [
          {
            subject: { toString: () => "<https://example.org/note1>" } as any,
            predicate: { toString: () => "<https://example.org/relatesTo>" } as any,
            object: { toString: () => "<https://example.org/note2>" } as any,
          },
        ];

        const result = extractPredicateName("https://example.org/note1", "https://example.org/note3", triples);
        expect(result).toBe("relates-to");
      });

      it("should not match when object matches but subject doesn't", () => {
        const triples: Triple[] = [
          {
            subject: { toString: () => "<https://example.org/note1>" } as any,
            predicate: { toString: () => "<https://example.org/relatesTo>" } as any,
            object: { toString: () => "<https://example.org/note2>" } as any,
          },
        ];

        const result = extractPredicateName("https://example.org/note3", "https://example.org/note2", triples);
        expect(result).toBe("relates-to");
      });
    });
  });
});
