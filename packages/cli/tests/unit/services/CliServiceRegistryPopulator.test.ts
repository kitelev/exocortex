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
  return { ServiceRegistry };
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
    it("should export exactly 10 service IDs", () => {
      expect(CLI_STUB_SERVICE_IDS).toHaveLength(10);
    });

    it("should include all well-known service IDs", () => {
      const expected = [
        "updateProperty",
        "removeProperty",
        "setStatus",
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
    it("should register all 10 stub services", () => {
      const registry = new ServiceRegistry();
      populateCliServiceRegistry(registry);
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

    it("stub execute should be a no-op that resolves", async () => {
      const registry = new ServiceRegistry();
      populateCliServiceRegistry(registry);

      const service = registry.get("updateProperty");
      await expect(service.execute("test-iri")).resolves.toBeUndefined();
    });

    it("stub execute should accept userInput parameter", async () => {
      const registry = new ServiceRegistry();
      populateCliServiceRegistry(registry);

      const service = registry.get("setStatus");
      await expect(
        service.execute("test-iri", { statusUID: "some-uid" }),
      ).resolves.toBeUndefined();
    });
  });
});
