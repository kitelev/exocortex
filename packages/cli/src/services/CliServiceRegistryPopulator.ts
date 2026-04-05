import { ServiceRegistry, type IGroundingService } from "exocortex";

/**
 * The 10 well-known service IDs that the plugin registers via
 * ServiceRegistryPopulator. CLI stubs are no-ops — they exist so that
 * `dyncommand validate` can verify that grounding service_name references
 * point to a known service.
 *
 * Issue #2518
 */
export const CLI_STUB_SERVICE_IDS = [
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
] as const;

export type CliStubServiceId = (typeof CLI_STUB_SERVICE_IDS)[number];

function stubService(): IGroundingService {
  return {
    async execute(): Promise<void> {
      // CLI stub — no-op by design
    },
  };
}

/**
 * Populate a ServiceRegistry with no-op stubs for all well-known services.
 * This allows validation and dry-run without Obsidian dependencies.
 */
export function populateCliServiceRegistry(registry: ServiceRegistry): void {
  for (const id of CLI_STUB_SERVICE_IDS) {
    registry.register(id, stubService());
  }
}
