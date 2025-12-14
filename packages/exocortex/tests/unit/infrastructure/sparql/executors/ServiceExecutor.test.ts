import { ServiceExecutor, ServiceExecutorError } from "../../../../../src/infrastructure/sparql/executors/ServiceExecutor";
import type { ServiceOperation } from "../../../../../src/infrastructure/sparql/algebra/AlgebraOperation";
import { SolutionMapping } from "../../../../../src/infrastructure/sparql/SolutionMapping";
import { IRI } from "../../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../../src/domain/models/rdf/Literal";

describe("ServiceExecutor", () => {
  // Mock HTTP client for testing
  const createMockHttpClient = (responseData: any, status = 200, statusText = "OK") => {
    return jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText,
      json: jest.fn().mockResolvedValue(responseData),
    } as unknown as Response);
  };

  // Mock query generator - just wraps the pattern in a simple SELECT
  const mockQueryGenerator = jest.fn((pattern) => {
    return `SELECT * WHERE { PATTERN }`;
  });

  beforeEach(() => {
    mockQueryGenerator.mockClear();
  });

  describe("Basic execution", () => {
    it("should execute SERVICE against remote endpoint and return results", async () => {
      const mockResponse = {
        head: { vars: ["s", "name"] },
        results: {
          bindings: [
            {
              s: { type: "uri", value: "http://example.org/entity1" },
              name: { type: "literal", value: "Entity One" },
            },
            {
              s: { type: "uri", value: "http://example.org/entity2" },
              name: { type: "literal", value: "Entity Two" },
            },
          ],
        },
      };

      const mockHttp = createMockHttpClient(mockResponse);
      const executor = new ServiceExecutor({ httpClient: mockHttp });

      const operation: ServiceOperation = {
        type: "service",
        endpoint: "http://example.org/sparql",
        pattern: {
          type: "bgp",
          triples: [
            {
              subject: { type: "variable", value: "s" },
              predicate: { type: "iri", value: "http://example.org/name" },
              object: { type: "variable", value: "name" },
            },
          ],
        },
        silent: false,
      };

      const results: SolutionMapping[] = [];
      for await (const solution of executor.execute(operation, mockQueryGenerator)) {
        results.push(solution);
      }

      expect(results).toHaveLength(2);
      expect((results[0].get("s") as IRI).value).toBe("http://example.org/entity1");
      expect((results[0].get("name") as Literal).value).toBe("Entity One");
      expect((results[1].get("s") as IRI).value).toBe("http://example.org/entity2");
      expect((results[1].get("name") as Literal).value).toBe("Entity Two");

      // Verify HTTP call
      expect(mockHttp).toHaveBeenCalledTimes(1);
      expect(mockHttp).toHaveBeenCalledWith(
        "http://example.org/sparql",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/sparql-query",
            "Accept": "application/sparql-results+json",
          }),
        })
      );
    });

    it("should handle empty results from remote endpoint", async () => {
      const mockResponse = {
        head: { vars: ["s", "name"] },
        results: { bindings: [] },
      };

      const mockHttp = createMockHttpClient(mockResponse);
      const executor = new ServiceExecutor({ httpClient: mockHttp });

      const operation: ServiceOperation = {
        type: "service",
        endpoint: "http://example.org/sparql",
        pattern: {
          type: "bgp",
          triples: [],
        },
        silent: false,
      };

      const results: SolutionMapping[] = [];
      for await (const solution of executor.execute(operation, mockQueryGenerator)) {
        results.push(solution);
      }

      expect(results).toHaveLength(0);
    });
  });

  describe("RDF term parsing", () => {
    it("should parse URI terms correctly", async () => {
      const mockResponse = {
        head: { vars: ["entity"] },
        results: {
          bindings: [
            { entity: { type: "uri", value: "http://dbpedia.org/resource/Paris" } },
          ],
        },
      };

      const mockHttp = createMockHttpClient(mockResponse);
      const executor = new ServiceExecutor({ httpClient: mockHttp });

      const operation: ServiceOperation = {
        type: "service",
        endpoint: "http://example.org/sparql",
        pattern: { type: "bgp", triples: [] },
        silent: false,
      };

      const results: SolutionMapping[] = [];
      for await (const solution of executor.execute(operation, mockQueryGenerator)) {
        results.push(solution);
      }

      expect(results).toHaveLength(1);
      const entity = results[0].get("entity") as IRI;
      expect(entity).toBeInstanceOf(IRI);
      expect(entity.value).toBe("http://dbpedia.org/resource/Paris");
    });

    it("should parse plain literals correctly", async () => {
      const mockResponse = {
        head: { vars: ["label"] },
        results: {
          bindings: [
            { label: { type: "literal", value: "Hello World" } },
          ],
        },
      };

      const mockHttp = createMockHttpClient(mockResponse);
      const executor = new ServiceExecutor({ httpClient: mockHttp });

      const operation: ServiceOperation = {
        type: "service",
        endpoint: "http://example.org/sparql",
        pattern: { type: "bgp", triples: [] },
        silent: false,
      };

      const results: SolutionMapping[] = [];
      for await (const solution of executor.execute(operation, mockQueryGenerator)) {
        results.push(solution);
      }

      expect(results).toHaveLength(1);
      const label = results[0].get("label") as Literal;
      expect(label).toBeInstanceOf(Literal);
      expect(label.value).toBe("Hello World");
    });

    it("should parse language-tagged literals correctly", async () => {
      const mockResponse = {
        head: { vars: ["label"] },
        results: {
          bindings: [
            { label: { type: "literal", value: "Bonjour", "xml:lang": "fr" } },
          ],
        },
      };

      const mockHttp = createMockHttpClient(mockResponse);
      const executor = new ServiceExecutor({ httpClient: mockHttp });

      const operation: ServiceOperation = {
        type: "service",
        endpoint: "http://example.org/sparql",
        pattern: { type: "bgp", triples: [] },
        silent: false,
      };

      const results: SolutionMapping[] = [];
      for await (const solution of executor.execute(operation, mockQueryGenerator)) {
        results.push(solution);
      }

      expect(results).toHaveLength(1);
      const label = results[0].get("label") as Literal;
      expect(label.value).toBe("Bonjour");
      expect(label.language).toBe("fr");
    });

    it("should parse typed literals correctly", async () => {
      const mockResponse = {
        head: { vars: ["count"] },
        results: {
          bindings: [
            {
              count: {
                type: "literal",
                value: "42",
                datatype: "http://www.w3.org/2001/XMLSchema#integer",
              },
            },
          ],
        },
      };

      const mockHttp = createMockHttpClient(mockResponse);
      const executor = new ServiceExecutor({ httpClient: mockHttp });

      const operation: ServiceOperation = {
        type: "service",
        endpoint: "http://example.org/sparql",
        pattern: { type: "bgp", triples: [] },
        silent: false,
      };

      const results: SolutionMapping[] = [];
      for await (const solution of executor.execute(operation, mockQueryGenerator)) {
        results.push(solution);
      }

      expect(results).toHaveLength(1);
      const count = results[0].get("count") as Literal;
      expect(count.value).toBe("42");
      expect(count.datatype?.value).toBe("http://www.w3.org/2001/XMLSchema#integer");
    });

    it("should parse blank nodes correctly", async () => {
      const mockResponse = {
        head: { vars: ["bnode"] },
        results: {
          bindings: [
            { bnode: { type: "bnode", value: "b0" } },
          ],
        },
      };

      const mockHttp = createMockHttpClient(mockResponse);
      const executor = new ServiceExecutor({ httpClient: mockHttp });

      const operation: ServiceOperation = {
        type: "service",
        endpoint: "http://example.org/sparql",
        pattern: { type: "bgp", triples: [] },
        silent: false,
      };

      const results: SolutionMapping[] = [];
      for await (const solution of executor.execute(operation, mockQueryGenerator)) {
        results.push(solution);
      }

      expect(results).toHaveLength(1);
      const bnode = results[0].get("bnode");
      expect(bnode).toBeDefined();
    });
  });

  describe("SILENT mode", () => {
    it("should suppress errors and return empty results when SILENT is true", async () => {
      const mockHttp = jest.fn().mockRejectedValue(new Error("Network error"));
      const executor = new ServiceExecutor({ httpClient: mockHttp });

      const operation: ServiceOperation = {
        type: "service",
        endpoint: "http://example.org/sparql",
        pattern: { type: "bgp", triples: [] },
        silent: true, // SILENT mode enabled
      };

      const results: SolutionMapping[] = [];
      // Should NOT throw
      for await (const solution of executor.execute(operation, mockQueryGenerator)) {
        results.push(solution);
      }

      expect(results).toHaveLength(0);
    });

    it("should throw error when SILENT is false and request fails", async () => {
      const mockHttp = jest.fn().mockRejectedValue(new Error("Network error"));
      const executor = new ServiceExecutor({ httpClient: mockHttp, maxRetries: 0 });

      const operation: ServiceOperation = {
        type: "service",
        endpoint: "http://example.org/sparql",
        pattern: { type: "bgp", triples: [] },
        silent: false, // SILENT mode disabled
      };

      const results: SolutionMapping[] = [];
      await expect(async () => {
        for await (const solution of executor.execute(operation, mockQueryGenerator)) {
          results.push(solution);
        }
      }).rejects.toThrow(ServiceExecutorError);
    });

    it("should suppress HTTP 4xx errors in SILENT mode", async () => {
      const mockHttp = createMockHttpClient({}, 404, "Not Found");
      const executor = new ServiceExecutor({ httpClient: mockHttp });

      const operation: ServiceOperation = {
        type: "service",
        endpoint: "http://example.org/sparql",
        pattern: { type: "bgp", triples: [] },
        silent: true,
      };

      const results: SolutionMapping[] = [];
      for await (const solution of executor.execute(operation, mockQueryGenerator)) {
        results.push(solution);
      }

      expect(results).toHaveLength(0);
    });

    it("should suppress HTTP 5xx errors in SILENT mode", async () => {
      const mockHttp = createMockHttpClient({}, 503, "Service Unavailable");
      const executor = new ServiceExecutor({ httpClient: mockHttp, maxRetries: 0 });

      const operation: ServiceOperation = {
        type: "service",
        endpoint: "http://example.org/sparql",
        pattern: { type: "bgp", triples: [] },
        silent: true,
      };

      const results: SolutionMapping[] = [];
      for await (const solution of executor.execute(operation, mockQueryGenerator)) {
        results.push(solution);
      }

      expect(results).toHaveLength(0);
    });
  });

  describe("Error handling", () => {
    it("should throw ServiceExecutorError for HTTP errors when not SILENT", async () => {
      const mockHttp = createMockHttpClient({}, 500, "Internal Server Error");
      const executor = new ServiceExecutor({ httpClient: mockHttp, maxRetries: 0 });

      const operation: ServiceOperation = {
        type: "service",
        endpoint: "http://example.org/sparql",
        pattern: { type: "bgp", triples: [] },
        silent: false,
      };

      await expect(async () => {
        for await (const _solution of executor.execute(operation, mockQueryGenerator)) {
          // consume iterator
        }
      }).rejects.toThrow(ServiceExecutorError);
    });

    it("should include endpoint URL in error message", async () => {
      const mockHttp = createMockHttpClient({}, 404, "Not Found");
      const executor = new ServiceExecutor({ httpClient: mockHttp, maxRetries: 0 });

      const operation: ServiceOperation = {
        type: "service",
        endpoint: "http://example.org/special-sparql",
        pattern: { type: "bgp", triples: [] },
        silent: false,
      };

      try {
        for await (const _solution of executor.execute(operation, mockQueryGenerator)) {
          // consume iterator
        }
        fail("Should have thrown");
      } catch (error) {
        expect((error as Error).message).toContain("http://example.org/special-sparql");
      }
    });
  });

  describe("Retry behavior", () => {
    it("should retry on transient failures", async () => {
      let callCount = 0;
      const mockHttp = jest.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error("ECONNRESET");
        }
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({
            head: { vars: ["x"] },
            results: { bindings: [{ x: { type: "literal", value: "success" } }] },
          }),
        };
      });

      const executor = new ServiceExecutor({
        httpClient: mockHttp,
        maxRetries: 2,
        retryDelay: 10, // Short delay for tests
      });

      const operation: ServiceOperation = {
        type: "service",
        endpoint: "http://example.org/sparql",
        pattern: { type: "bgp", triples: [] },
        silent: false,
      };

      const results: SolutionMapping[] = [];
      for await (const solution of executor.execute(operation, mockQueryGenerator)) {
        results.push(solution);
      }

      expect(results).toHaveLength(1);
      expect(callCount).toBe(2); // First failed, second succeeded
    });

    it("should not retry on non-retryable errors", async () => {
      let callCount = 0;
      const mockHttp = jest.fn().mockImplementation(async () => {
        callCount++;
        return {
          ok: false,
          status: 400,
          statusText: "Bad Request",
          json: async () => ({}),
        };
      });

      const executor = new ServiceExecutor({
        httpClient: mockHttp,
        maxRetries: 2,
        retryDelay: 10,
      });

      const operation: ServiceOperation = {
        type: "service",
        endpoint: "http://example.org/sparql",
        pattern: { type: "bgp", triples: [] },
        silent: false,
      };

      await expect(async () => {
        for await (const _solution of executor.execute(operation, mockQueryGenerator)) {
          // consume iterator
        }
      }).rejects.toThrow();

      expect(callCount).toBe(1); // No retries for 400 error
    });

    it("should retry on 5xx errors", async () => {
      let callCount = 0;
      const mockHttp = jest.fn().mockImplementation(async () => {
        callCount++;
        if (callCount <= 2) {
          return {
            ok: false,
            status: 503,
            statusText: "Service Unavailable",
            json: async () => ({}),
          };
        }
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({
            head: { vars: ["x"] },
            results: { bindings: [] },
          }),
        };
      });

      const executor = new ServiceExecutor({
        httpClient: mockHttp,
        maxRetries: 2,
        retryDelay: 10,
      });

      const operation: ServiceOperation = {
        type: "service",
        endpoint: "http://example.org/sparql",
        pattern: { type: "bgp", triples: [] },
        silent: false,
      };

      const results: SolutionMapping[] = [];
      for await (const solution of executor.execute(operation, mockQueryGenerator)) {
        results.push(solution);
      }

      expect(callCount).toBe(3); // Two retries then success
    });
  });

  describe("Configuration", () => {
    it("should use custom timeout", async () => {
      // This test verifies the timeout is passed to abort controller
      const mockHttp = jest.fn().mockImplementation(async (url, options) => {
        // Verify signal is present
        expect(options.signal).toBeDefined();
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({
            head: { vars: [] },
            results: { bindings: [] },
          }),
        };
      });

      const executor = new ServiceExecutor({
        httpClient: mockHttp,
        timeout: 5000,
      });

      const operation: ServiceOperation = {
        type: "service",
        endpoint: "http://example.org/sparql",
        pattern: { type: "bgp", triples: [] },
        silent: false,
      };

      for await (const _solution of executor.execute(operation, mockQueryGenerator)) {
        // consume iterator
      }

      expect(mockHttp).toHaveBeenCalled();
    });
  });

  describe("Query generation", () => {
    it("should call query generator with the pattern", async () => {
      const mockResponse = {
        head: { vars: [] },
        results: { bindings: [] },
      };

      const mockHttp = createMockHttpClient(mockResponse);
      const executor = new ServiceExecutor({ httpClient: mockHttp });
      const customGenerator = jest.fn(() => "SELECT ?s WHERE { ?s ?p ?o }");

      const innerPattern = {
        type: "bgp" as const,
        triples: [
          {
            subject: { type: "variable" as const, value: "s" },
            predicate: { type: "iri" as const, value: "http://example.org/prop" },
            object: { type: "variable" as const, value: "o" },
          },
        ],
      };

      const operation: ServiceOperation = {
        type: "service",
        endpoint: "http://example.org/sparql",
        pattern: innerPattern,
        silent: false,
      };

      for await (const _solution of executor.execute(operation, customGenerator)) {
        // consume iterator
      }

      expect(customGenerator).toHaveBeenCalledWith(innerPattern);
    });

    it("should send generated query to remote endpoint", async () => {
      const mockResponse = {
        head: { vars: [] },
        results: { bindings: [] },
      };

      const mockHttp = createMockHttpClient(mockResponse);
      const executor = new ServiceExecutor({ httpClient: mockHttp });
      const customGenerator = jest.fn(() => "SELECT ?custom WHERE { ?custom a ?type }");

      const operation: ServiceOperation = {
        type: "service",
        endpoint: "http://example.org/sparql",
        pattern: { type: "bgp", triples: [] },
        silent: false,
      };

      for await (const _solution of executor.execute(operation, customGenerator)) {
        // consume iterator
      }

      expect(mockHttp).toHaveBeenCalledWith(
        "http://example.org/sparql",
        expect.objectContaining({
          body: "SELECT ?custom WHERE { ?custom a ?type }",
        })
      );
    });
  });

  describe("Multiple bindings in row", () => {
    it("should handle rows with multiple variable bindings", async () => {
      const mockResponse = {
        head: { vars: ["person", "name", "age"] },
        results: {
          bindings: [
            {
              person: { type: "uri", value: "http://example.org/person/1" },
              name: { type: "literal", value: "Alice" },
              age: { type: "literal", value: "30", datatype: "http://www.w3.org/2001/XMLSchema#integer" },
            },
            {
              person: { type: "uri", value: "http://example.org/person/2" },
              name: { type: "literal", value: "Bob" },
              age: { type: "literal", value: "25", datatype: "http://www.w3.org/2001/XMLSchema#integer" },
            },
          ],
        },
      };

      const mockHttp = createMockHttpClient(mockResponse);
      const executor = new ServiceExecutor({ httpClient: mockHttp });

      const operation: ServiceOperation = {
        type: "service",
        endpoint: "http://example.org/sparql",
        pattern: { type: "bgp", triples: [] },
        silent: false,
      };

      const results: SolutionMapping[] = [];
      for await (const solution of executor.execute(operation, mockQueryGenerator)) {
        results.push(solution);
      }

      expect(results).toHaveLength(2);

      // First row
      expect((results[0].get("person") as IRI).value).toBe("http://example.org/person/1");
      expect((results[0].get("name") as Literal).value).toBe("Alice");
      expect((results[0].get("age") as Literal).value).toBe("30");

      // Second row
      expect((results[1].get("person") as IRI).value).toBe("http://example.org/person/2");
      expect((results[1].get("name") as Literal).value).toBe("Bob");
      expect((results[1].get("age") as Literal).value).toBe("25");
    });

    it("should handle rows with missing bindings (unbound variables)", async () => {
      const mockResponse = {
        head: { vars: ["x", "y"] },
        results: {
          bindings: [
            {
              x: { type: "literal", value: "1" },
              // y is unbound
            },
            {
              x: { type: "literal", value: "2" },
              y: { type: "literal", value: "Y" },
            },
          ],
        },
      };

      const mockHttp = createMockHttpClient(mockResponse);
      const executor = new ServiceExecutor({ httpClient: mockHttp });

      const operation: ServiceOperation = {
        type: "service",
        endpoint: "http://example.org/sparql",
        pattern: { type: "bgp", triples: [] },
        silent: false,
      };

      const results: SolutionMapping[] = [];
      for await (const solution of executor.execute(operation, mockQueryGenerator)) {
        results.push(solution);
      }

      expect(results).toHaveLength(2);

      // First row - y is unbound
      expect((results[0].get("x") as Literal).value).toBe("1");
      expect(results[0].get("y")).toBeUndefined();

      // Second row - both bound
      expect((results[1].get("x") as Literal).value).toBe("2");
      expect((results[1].get("y") as Literal).value).toBe("Y");
    });
  });
});
