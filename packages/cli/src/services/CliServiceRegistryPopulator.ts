import { ServiceRegistry, type IGroundingService } from "exocortex";

/**
 * The 10 well-known service IDs the plugin registers via
 * ServiceRegistryPopulator. CLI stubs exist so that `dyncommand validate` can
 * verify grounding service references point to a known service, and so that
 * `dyncommand exec` fails loudly instead of silently fake-succeeding.
 *
 * Issue #2518, #2864
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

/**
 * Thrown when a stub `IGroundingService` is invoked. Callers that want to
 * branch on CLI-parity gaps can narrow on this class; string matchers
 * should look for the `serviceId` substring in the message.
 */
export class CliServiceNotImplementedError extends Error {
  constructor(public readonly serviceId: string) {
    super(
      `Service "${serviceId}" is not implemented in the CLI (no-op stub). ` +
        `dyncommand exec on this service_call grounding cannot change vault state. ` +
        `See CLI parity issues #2865-#2868 for port status.`,
    );
    this.name = "CliServiceNotImplementedError";
  }
}

function notImplementedService(serviceId: string): IGroundingService {
  return {
    async execute(): Promise<void> {
      throw new CliServiceNotImplementedError(serviceId);
    },
  };
}

/**
 * Populate a ServiceRegistry with fail-loud stubs for all well-known services.
 *
 * Pre-#2864 the stubs resolved silently, so `dyncommand exec` on service_call
 * groundings reported success without touching the vault — tests relying on
 * that path would pass while production behavior diverged. Post-fix each stub
 * throws `CliServiceNotImplementedError`, surfaced by `GroundingExecutor` as
 * `{success:false, error}`, which the CLI prints and returns non-zero exit.
 */
export function populateCliServiceRegistry(registry: ServiceRegistry): void {
  for (const id of CLI_STUB_SERVICE_IDS) {
    registry.register(id, notImplementedService(id));
  }
}
