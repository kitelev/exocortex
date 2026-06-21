/**
 * UniversalDefaultTemplateResolver — lazy-loaded reference to the RFC 727572d2
 * `exocmd__UniversalDefaultTemplate` singleton ABox instance.
 *
 * Loader pattern mirrors {@link OrderSpecResolver}: callers (CLI / Obsidian
 * plugin) register a `UniversalDefaultLoader` at startup. The loader returns
 * the singleton's contents (or null if the asset is absent). Result is cached;
 * vault updates may call {@link clearUniversalDefault} to invalidate.
 *
 * Engine-side (CommandResolver) merges Universal entries into each Grounding's
 * propertyDefault / inheritanceRule lists at parse time; Grounding entries
 * override Universal entries by propertyName / targetPropertyName key.
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

export type UniversalDefaultLoader = () =>
  | UniversalDefaultTemplate
  | null
  | Promise<UniversalDefaultTemplate | null>;

let _loader: UniversalDefaultLoader | null = null;
let _cached: UniversalDefaultTemplate | null | undefined = undefined;
let _warnedMissing = false;

export function registerUniversalDefaultLoader(
  loader: UniversalDefaultLoader,
): void {
  _loader = loader;
  _cached = undefined;
  _warnedMissing = false;
}

export function clearUniversalDefaultLoader(): void {
  _loader = null;
  _cached = undefined;
  _warnedMissing = false;
}

/** Invalidate the cache; loader will be re-invoked on next access. */
export function clearUniversalDefault(): void {
  _cached = undefined;
  _warnedMissing = false;
}

/**
 * Fetch the Universal Default Template singleton contents.
 *
 * Returns `null` when:
 *   - No loader registered (test/CLI harnesses that intentionally bypass)
 *   - Loader returned null (singleton absent from vault → safety-net fallback)
 *   - Loader threw (warn once, fall back to null)
 *
 * Callers (GroundingExecutor) treat `null` as a signal to fall back to legacy
 * TS primitives WITH a loud warn log — the RFC 727572d2 design intentionally
 * leaves this safety net active because Universal singleton can race with
 * cold-start file-watcher debounce on mobile boot paths.
 */
export async function loadUniversalDefault(): Promise<UniversalDefaultTemplate | null> {
  if (_cached !== undefined) return _cached;
  if (!_loader) {
    _cached = null;
    return null;
  }
  try {
    const result = await _loader();
    _cached = result ?? null;
  } catch (e) {
    if (!_warnedMissing) {
       
      console.warn(
        "[UniversalDefaultTemplateResolver] loader threw, falling back to legacy primitives:",
        e,
      );
      _warnedMissing = true;
    }
    _cached = null;
  }
  return _cached;
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
