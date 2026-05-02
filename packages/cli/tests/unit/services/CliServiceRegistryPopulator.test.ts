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
  return { ServiceRegistry, FrontmatterService };
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
    it("should export exactly 7 service IDs (T1.4: updateProperty/removeProperty/setStatus moved to real impls)", () => {
      expect(CLI_STUB_SERVICE_IDS).toHaveLength(7);
    });

    it("should include all genuinely-unsupported well-known service IDs", () => {
      const expected = [
        "createAsset",
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
    it("should register the 7 fail-loud stubs + the 3 frontmatter handlers (10 total) when called without deps", () => {
      const registry = new ServiceRegistry();
      populateCliServiceRegistry(registry);
      // Without `deps.fsAdapter`, the 3 frontmatter handlers
      // (updateProperty/removeProperty/setStatus) fall back to fail-loud stubs
      // so `dyncommand validate` keeps recognising them as known service IDs.
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
