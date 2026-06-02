import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// Use real ServiceRegistry since it's a simple Map wrapper
// and the function under test just calls .register() on the passed instance
jest.unstable_mockModule("exocortex", () => {
  class ServiceRegistry {
    private services = new Map<string, any>();
    register(id: string, service: any) { this.services.set(id, service); }
    get(id: string) { return this.services.get(id); }
    has(id: string) { return this.services.has(id); }
    getRegisteredIds() { return Array.from(this.services.keys()); }
  }
  // T1.4: CliServiceRegistryPopulator imports FrontmatterService at module
  // load time to wire the new updateProperty/removeProperty/setStatus
  // factories. The constructor is never invoked from this suite (deps left
  // out → stubs path), so a no-op shape is sufficient for the import to
  // resolve under ESM mocking.
  class FrontmatterService {}
  // Phase 3.5 (#3164): the shared `@kitelev/exocortex-services` factory used
  // by the new createAsset registration imports `WikiLinkHelpers` and
  // `DateFormatter` from the `exocortex` package at module-evaluation time.
  // The deps-omitted code path tested here never invokes the factory body, so
  // shape stubs are sufficient — the imports just need to resolve.
  class WikiLinkHelpers {
    static resolveSymbolic(value: string): string {
      return value;
    }
    static normalize(value: string): string {
      return value;
    }
  }
  class DateFormatter {
    static toISOTimestamp(date: Date): string {
      return date.toISOString();
    }
  }
  // Issue #3301: the path-based target resolver factory now imports
  // `iriToVaultPath` from `exocortex` at module-evaluation time. The
  // deps-omitted code path tested here never invokes the resolver, so a
  // shape stub returning null (treated as "not a vault scheme IRI", caller
  // falls back to the raw IRI) is sufficient for the import to resolve.
  const iriToVaultPath = (_iri: string): string | null => null;
  return {
    ServiceRegistry,
    FrontmatterService,
    WikiLinkHelpers,
    DateFormatter,
    iriToVaultPath,
  };
});

let populateCliServiceRegistry: any;
let CLI_STUB_SERVICE_IDS: readonly string[];
let ServiceRegistry: any;

beforeEach(async () => {
  jest.clearAllMocks();
  const popMod = await import("../../../src/services/CliServiceRegistryPopulator.js");
  populateCliServiceRegistry = popMod.populateCliServiceRegistry;
  CLI_STUB_SERVICE_IDS = popMod.CLI_STUB_SERVICE_IDS;
  const exoMod = await import("exocortex");
  ServiceRegistry = (exoMod as any).ServiceRegistry;
});

describe("CliServiceRegistryPopulator", () => {
  describe("CLI_STUB_SERVICE_IDS", () => {
    it("should export exactly 6 service IDs (T1.4 + Phase 3.5: updateProperty/removeProperty/setStatus + createAsset moved to real impls)", () => {
      expect(CLI_STUB_SERVICE_IDS).toHaveLength(6);
    });

    it("should include all genuinely-unsupported well-known service IDs", () => {
      const expected = [
        "openFile",
        "sparqlSelect",
        "getActiveFileIRI",
        "getActiveFilePath",
        "trashFile",
        "duplicateFile",
      ];
      expect([...CLI_STUB_SERVICE_IDS]).toEqual(expected);
    });
  });

  describe("populateCliServiceRegistry", () => {
    it("should register the 6 fail-loud stubs + the 4 fsAdapter-gated handlers (10 total) when called without deps", () => {
      const registry = new ServiceRegistry();
      populateCliServiceRegistry(registry);
      // Without `deps.fsAdapter`, the 4 fsAdapter-gated handlers
      // (updateProperty/removeProperty/setStatus/createAsset) fall back to
      // fail-loud stubs so `dyncommand validate` keeps recognising them as
      // known service IDs.
      expect(registry.getRegisteredIds()).toHaveLength(10);
    });

    it("should register each service with correct ID", () => {
      const registry = new ServiceRegistry();
      populateCliServiceRegistry(registry);

      for (const id of CLI_STUB_SERVICE_IDS) {
        expect(registry.has(id)).toBe(true);
      }
    });

    it("should register services with execute method", () => {
      const registry = new ServiceRegistry();
      populateCliServiceRegistry(registry);

      for (const id of CLI_STUB_SERVICE_IDS) {
        const service = registry.get(id);
        expect(typeof service.execute).toBe("function");
      }
    });

    it("stub execute should throw NotImplementedError naming the serviceId (#2864)", async () => {
      const registry = new ServiceRegistry();
      populateCliServiceRegistry(registry);

      const service = registry.get("updateProperty");
      await expect(service.execute("test-iri")).rejects.toThrow(/updateProperty/);
    });

    it("stub execute should throw when invoked with userInput (#2864)", async () => {
      const registry = new ServiceRegistry();
      populateCliServiceRegistry(registry);

      const service = registry.get("setStatus");
      await expect(
        service.execute("test-iri", { statusUID: "some-uid" }),
      ).rejects.toThrow(/setStatus/);
    });

    it("every stub should throw an error that names its serviceId (#2864)", async () => {
      const registry = new ServiceRegistry();
      populateCliServiceRegistry(registry);

      for (const id of CLI_STUB_SERVICE_IDS) {
        const service = registry.get(id);
        await expect(service.execute("test-iri")).rejects.toThrow(
          new RegExp(id),
        );
      }
    });
  });
});
