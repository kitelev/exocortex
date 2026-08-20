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
import {
  createDisplayMatcherHostFunctions,
  type VaultMetadataPort,
} from "@kitelev/exocortex-core";

export type {
  ValueEqualityMatcher,
  HostFunctionMatcher,
  DisplayNameMatcher,
  PrintNameRule,
  ParticipatingRule,
} from "@kitelev/exocortex-core";

/**
 * A host-function predicate as the PLUGIN types it: the host is Obsidian's `App`. Core keeps
 * the host opaque (it never inspects it), so the concrete typing belongs on this side.
 *
 * ⛤ The plugin no longer keeps a registry of its own (issue #4054): the built-ins are derived
 * from the core factory, which closes over the port and ignores `host` entirely. This type
 * remains because callers may still inject their OWN predicates, and those legitimately want
 * `App` rather than `unknown`.
 */
export type DisplayMatcherHostFunction = (
  app: App,
  metadata: Record<string, unknown>,
) => boolean;
export type DisplayMatcherHostFunctionRegistry = Record<string, DisplayMatcherHostFunction>;

export class PrintNameRuleService extends CorePrintNameRuleService {
  /**
   * Builds the constructor arguments as a tuple so the port is created ONCE and
   * handed both to the engine and to the default registry.
   *
   * ⛤ The default registry is DERIVED from `createDisplayMatcherHostFunctions`
   * rather than restated here (issue #4054). A hand-written literal on this side
   * meant adding a predicate to the core factory shipped it to the CLI alone —
   * silently, because the engine is fail-closed: the plugin would simply never
   * run the new spec, with no error and no warning. Deriving makes "both
   * surfaces see the same names" true by construction instead of by discipline.
   *
   * An explicit registry still wins, which is what the tests that inject a
   * stub rely on; passing none now means "the built-ins", not "none".
   */
  private static wire(
    app: App,
    hostFunctions?: DisplayMatcherHostFunctionRegistry,
  ): [
    VaultMetadataPort,
    Record<string, (host: unknown, md: Record<string, unknown>) => boolean>,
  ] {
    const vault = new ObsidianVaultMetadataAdapter(app);
    const registry =
      hostFunctions ??
      (createDisplayMatcherHostFunctions(
        vault,
      ) as unknown as DisplayMatcherHostFunctionRegistry);
    return [
      vault,
      registry as unknown as Record<
        string,
        (host: unknown, md: Record<string, unknown>) => boolean
      >,
    ];
  }

  constructor(app: App, hostFunctions?: DisplayMatcherHostFunctionRegistry) {
    super(...PrintNameRuleService.wire(app, hostFunctions), app);
  }
}
