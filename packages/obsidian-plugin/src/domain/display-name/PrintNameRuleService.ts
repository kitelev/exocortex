// Adapter shim (req f17f7c57). The engine moved to `packages/core` so the CLI composes names
// through the SAME implementation; this file keeps BOTH the original import path and the
// original `new PrintNameRuleService(app)` signature alive — which is why not one of the 31
// importers and not one of the 13 engine test-files had to change.
//
// ⛤ The shim is the plugin's ADAPTER BOUNDARY, not decoration: it wraps `App` into the
// VaultMetadataPort the core engine now takes, and forwards `app` as the opaque host that
// display-matcher host functions receive. ⛔ Do not add naming logic here.
import type { App } from "obsidian";
import { PrintNameRuleService as CorePrintNameRuleService } from "@kitelev/exocortex-core";
import { ObsidianVaultMetadataAdapter } from "./ObsidianVaultMetadataAdapter";

export type {
  ValueEqualityMatcher,
  HostFunctionMatcher,
  DisplayNameMatcher,
  PrintNameRule,
  ParticipatingRule,
} from "@kitelev/exocortex-core";

/**
 * A host-function predicate as the PLUGIN types it: the host is Obsidian's `App`. Core keeps
 * the host opaque (it never inspects it), so the concrete typing belongs on this side and the
 * registry in `displayMatcherHostFunctions.ts` stays exactly as it was.
 */
export type DisplayMatcherHostFunction = (
  app: App,
  metadata: Record<string, unknown>,
) => boolean;
export type DisplayMatcherHostFunctionRegistry = Record<string, DisplayMatcherHostFunction>;

export class PrintNameRuleService extends CorePrintNameRuleService {
  constructor(app: App, hostFunctions: DisplayMatcherHostFunctionRegistry = {}) {
    super(
      new ObsidianVaultMetadataAdapter(app),
      hostFunctions as Record<string, (host: unknown, md: Record<string, unknown>) => boolean>,
      app,
    );
  }
}
