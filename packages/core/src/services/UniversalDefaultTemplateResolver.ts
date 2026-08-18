/**
 * UniversalDefaultTemplateResolver — the shape of the RFC 727572d2
 * `exocmd__UniversalDefaultTemplate` singleton, plus the merge semantics that
 * fold it into each Grounding.
 *
 * Engine-side (CommandResolver) merges Universal entries into each Grounding's
 * propertyDefault / inheritanceRule lists at parse time; Grounding entries
 * override Universal entries by propertyName / targetPropertyName key.
 *
 * ⛔ This module deliberately has NO host-loader registry. It used to expose
 * one — `registerUniversalDefaultLoader` / `clearUniversalDefaultLoader` /
 * `loadUniversalDefault` / `clearUniversalDefault`, mirroring OrderSpecResolver
 * — and its docstring described hosts registering a loader at startup. No host
 * ever did: the measurement in issue #4083 found ZERO production callers of
 * `registerUniversalDefaultLoader` on `origin/main`, so `loadUniversalDefault()`
 * returned null on every single call while `CommandResolver.getUniversalCache`
 * awaited it. The description of intent read like a description of behaviour —
 * the same defect class as issue #4080 (`clearUniversalCache`, zero callers,
 * green test, no wiring), found in the same subsystem one issue apart.
 *
 * The singleton is resolved where it is actually used: `CommandResolver`
 * queries the triple store directly (indexed `Instance_class` match, PR #4082),
 * caches the verdict on the instance, and drops it in `invalidateCache()`.
 * One path, and it is the one the tests exercise.
 *
 * ⚠ If a host-side fast path is ever wanted again, do NOT restore this registry
 * as-is: a plugin loader would read `metadataCache`, which is COLD at startup,
 * so a cached null verdict would strip `createdAt`/`updatedAt` from every asset
 * created afterwards — see rules/obsidian-plugin-indicator-surface-and-cold-resolve.
 *
 * RFC 727572d2-194b-4a4d-8a5a-585a1d3bac8e.
 */

import type {
  PropertyDefaultResolved,
  InheritanceRuleResolved,
} from "../domain/models/CommandDefinition";

/**
 * Contents of the `UniversalDefaultTemplate` singleton, post-resolution by the
 * loader. Both lists are already resolved to the executor-ready shape
 * (PropertyDefaultResolved, InheritanceRuleResolved) — the loader is expected
 * to invoke CommandResolver helpers internally (or to be invoked AFTER the
 * triple store has parsed the singleton's referenced PropertyDefault /
 * InheritanceRule assets).
 *
 * Empty arrays are valid (e.g. a fresh vault with the singleton present but
 * no entries yet).
 */
export interface UniversalDefaultTemplate {
  readonly propertyDefaults: ReadonlyArray<PropertyDefaultResolved>;
  readonly inheritanceRules: ReadonlyArray<InheritanceRuleResolved>;
}

/**
 * Merge Universal PropertyDefaults with Grounding-local entries.
 * Grounding entries win when their `propertyName` matches a Universal entry —
 * RFC 727572d2 §Engine semantics (parse-time merge in CommandResolver).
 *
 * Result preserves order: Universal entries (in original order) followed by
 * Grounding entries that don't conflict. Grounding-overridden Universal
 * entries are replaced in their original position (so output stays stable).
 */
export function mergePropertyDefaults(
  universal: ReadonlyArray<PropertyDefaultResolved>,
  grounding: ReadonlyArray<PropertyDefaultResolved>,
): PropertyDefaultResolved[] {
  const groundingByName = new Map<string, PropertyDefaultResolved>();
  for (const g of grounding) groundingByName.set(g.propertyName, g);

  const out: PropertyDefaultResolved[] = [];
  const usedFromGrounding = new Set<string>();
  for (const u of universal) {
    const override = groundingByName.get(u.propertyName);
    if (override) {
      out.push(override);
      usedFromGrounding.add(override.propertyName);
    } else {
      out.push(u);
    }
  }
  for (const g of grounding) {
    if (!usedFromGrounding.has(g.propertyName)) out.push(g);
  }
  return out;
}

/**
 * Merge Universal InheritanceRules with Grounding-local entries.
 * Same semantics as {@link mergePropertyDefaults} but keyed by
 * `targetPropertyName`. Priority sort happens downstream in the executor.
 */
export function mergeInheritanceRules(
  universal: ReadonlyArray<InheritanceRuleResolved>,
  grounding: ReadonlyArray<InheritanceRuleResolved>,
): InheritanceRuleResolved[] {
  const groundingByName = new Map<string, InheritanceRuleResolved>();
  for (const g of grounding) groundingByName.set(g.targetPropertyName, g);

  const out: InheritanceRuleResolved[] = [];
  const usedFromGrounding = new Set<string>();
  for (const u of universal) {
    const override = groundingByName.get(u.targetPropertyName);
    if (override) {
      out.push(override);
      usedFromGrounding.add(override.targetPropertyName);
    } else {
      out.push(u);
    }
  }
  for (const g of grounding) {
    if (!usedFromGrounding.has(g.targetPropertyName)) out.push(g);
  }
  return out;
}
