/**
 * OrderSpecResolver — declarative frontmatter field ordering driven by a vault asset.
 *
 * Spec (`exo__FrontmatterOrderSpec`, class UID `15270ad1-d29d-4677-bd52-23078983cae8`):
 *   - head: ordered list of property local-names placed at the top
 *   - tail: ordered list of property local-names placed at the bottom
 *   - middleStrategy: "alphabetical" (v1)
 *
 * Loader pattern: callers (CLI / Obsidian plugin) register a loader at startup.
 * If no loader is registered or loader returns null, ordering is a no-op
 * (legacy insertion order is preserved).
 *
 * RFC `27a7a877-691f-46b0-bc0a-4c746b4ccb17` (vault-exodev/inbox/).
 */

export interface FrontmatterOrderSpec {
  readonly head: ReadonlyArray<string>;
  readonly tail: ReadonlyArray<string>;
  readonly middleStrategy: string;
}

export type OrderSpecLoader = () => FrontmatterOrderSpec | null;

let _loader: OrderSpecLoader | null = null;
let _cached: FrontmatterOrderSpec | null | undefined = undefined;
let _warnedMissing = false;

export function registerOrderSpecLoader(loader: OrderSpecLoader): void {
  _loader = loader;
  _cached = undefined;
  _warnedMissing = false;
}

export function clearOrderSpecLoader(): void {
  _loader = null;
  _cached = undefined;
  _warnedMissing = false;
}

export function loadDefaultSpec(): FrontmatterOrderSpec | null {
  if (_cached !== undefined) return _cached;
  if (!_loader) {
    _cached = null;
    return null;
  }
  try {
    _cached = _loader();
  } catch (e) {
    if (!_warnedMissing) {
      console.warn("[OrderSpecResolver] loader threw, falling back to insertion order:", e);
      _warnedMissing = true;
    }
    _cached = null;
  }
  return _cached;
}

/**
 * Pure function: reorder `properties` per spec.
 *
 * Order: head (in spec order, skipping absent keys)
 *      → middle (keys not in head/tail, sorted by middleStrategy)
 *      → tail (in spec order, skipping absent keys).
 *
 * Returns `properties` unchanged when `spec` is null or has empty head AND tail.
 *
 * @param properties original record (insertion order)
 * @param spec ordering specification, or null for no-op
 */
export function orderProperties(
  properties: Record<string, unknown>,
  spec: FrontmatterOrderSpec | null,
): Record<string, unknown> {
  if (!spec) return properties;
  if (spec.head.length === 0 && spec.tail.length === 0) return properties;

  const keys = Object.keys(properties);
  const headSet = new Set(spec.head);
  const tailSet = new Set(spec.tail);

  const headKeys = spec.head.filter((k) => Object.prototype.hasOwnProperty.call(properties, k));
  const tailKeys = spec.tail.filter((k) => Object.prototype.hasOwnProperty.call(properties, k));
  const middleKeys = keys.filter((k) => !headSet.has(k) && !tailSet.has(k));

  if (spec.middleStrategy === "alphabetical") {
    middleKeys.sort((a, b) => a.localeCompare(b));
  }
  // Other strategies (insertion, byOntologyPrefix) — future scope.

  const ordered: Record<string, unknown> = {};
  for (const k of headKeys) ordered[k] = properties[k];
  for (const k of middleKeys) ordered[k] = properties[k];
  for (const k of tailKeys) ordered[k] = properties[k];
  return ordered;
}
