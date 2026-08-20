/**
 * Issue #4054 — the plugin must DERIVE its display-matcher host-function
 * registry from core, not restate it.
 *
 * Req 5cd9fffe single-sourced the PREDICATES; the REGISTRIES stayed apart, so
 * adding a third predicate to `createDisplayMatcherHostFunctions` shipped it to
 * the CLI alone. Silently: the engine is fail-closed, so on the plugin side a
 * spec naming the new predicate simply never participates — no error, no
 * warning, just a display name missing a component on one surface and present
 * on the other.
 *
 * ⛤ The load-bearing axis enumerates the names FROM THE CORE FACTORY rather
 * than from a literal here. A hand-written expectation would have to be edited
 * alongside every new predicate — i.e. it would reproduce, in the test, exactly
 * the restatement this issue is about. Enumerated from the source of truth, the
 * axis GROWS on its own: a predicate added to core is checked on the plugin
 * without anyone remembering to extend this file.
 */
import { describe, it, expect, jest } from "@jest/globals";
import {
  createDisplayMatcherHostFunctions,
  type VaultMetadataPort,
} from "@kitelev/exocortex-core";
import { PrintNameRuleService } from "@plugin/domain/display-name/PrintNameRuleService";
import type { App } from "obsidian";

/** A port stub — the factory only closes over it; these axes never resolve anything. */
const inertPort: VaultMetadataPort = {
  resolveLinkpathFrontmatter: () => null,
} as unknown as VaultMetadataPort;

/** The names core considers built-in, read from the factory itself. */
const coreNames = Object.keys(
  createDisplayMatcherHostFunctions(inertPort),
).sort();

function makeApp(): App {
  return {
    vault: { getMarkdownFiles: () => [] },
    metadataCache: {
      getFileCache: jest.fn(() => null),
      getFirstLinkpathDest: jest.fn(() => null),
    },
  } as unknown as App;
}

/** The registry the plugin's shim actually hands the engine (private field). */
function pluginRegistryNames(): string[] {
  const service = new PrintNameRuleService(makeApp());
  const registry = (
    service as unknown as {
      hostFunctions: Record<string, unknown>;
    }
  ).hostFunctions;
  return Object.keys(registry).sort();
}

describe("Issue #4054: the plugin derives its host-function registry from core", () => {
  it("sees EVERY built-in the core factory defines", () => {
    // The DoD axis. Red if the plugin restates the list and core grows a name.
    expect(pluginRegistryNames()).toEqual(coreNames);
  });

  it("has a non-empty set to compare — the axis is not vacuous", () => {
    // Canary. Without it, a factory that returned {} would make the axis above
    // pass by comparing two empty arrays.
    expect(coreNames.length).toBeGreaterThan(0);
  });

  it("still lets a caller inject its own registry", () => {
    // Canary — green in BOTH states. Deriving is the DEFAULT, not a lock-in;
    // the suites that stub a predicate depend on this.
    const own = { somethingCustom: () => true };
    const service = new PrintNameRuleService(makeApp(), own as never);
    const registry = (
      service as unknown as {
        hostFunctions: Record<string, unknown>;
      }
    ).hostFunctions;
    expect(Object.keys(registry)).toEqual(["somethingCustom"]);
  });
});
