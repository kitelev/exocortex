import {
  CREATION_GATE_CLASS_LABEL,
  CREATION_GATE_CLASS_UID,
} from "./CreationGateContract";
import {
  parseCreationGatePolicy,
  type CreationGateDeps,
  type CreationGatePolicy,
} from "./CreationGatePolicy";
import { refsOf, textOf, valuesOf } from "./refs";

/** One asset that MAY be a rule: its vault-relative path and fresh frontmatter. */
export interface CreationGatePolicyCandidate {
  readonly path: string;
  readonly frontmatter: Record<string, unknown>;
}

/**
 * Where rule assets come from. Each surface supplies its own: the CLI's
 * `create` walks the vault it already reads, `apply` asks its loaded triple
 * store, the plugin asks `metadataCache` (disk on a cold start). The source may
 * over-supply — every candidate is filtered by class here — but it must not
 * under-supply: a rule that is not found is a gate that is silently off.
 */
export interface CreationGatePolicySource {
  candidates(): Promise<readonly CreationGatePolicyCandidate[]>;
}

/**
 * Does an `exo__Instance_class` value name the rule class? By the class UID
 * appearing anywhere in a value (every reference form carries it; a vault where
 * the class does not resolve still has the literal) or by the class label in
 * label form.
 */
export function namesCreationGateClass(instanceClass: unknown): boolean {
  for (const value of valuesOf(instanceClass)) {
    if (typeof value !== "string") continue;
    if (value.toLowerCase().includes(CREATION_GATE_CLASS_UID)) return true;
  }
  const label = CREATION_GATE_CLASS_LABEL.toLowerCase();
  return refsOf(instanceClass).some(
    (ref) =>
      ref.target.toLowerCase() === label || ref.alias?.toLowerCase() === label,
  );
}

function isTrue(value: unknown): boolean {
  if (value === true) return true;
  const text = textOf(value);
  return text !== null && /^(true|yes)$/i.test(text);
}

/** A rule that is archived or superseded does not act (onto-RFC §Семантика п.1). */
export function isRetiredRule(frontmatter: Record<string, unknown>): boolean {
  if (isTrue(frontmatter.exo__Asset_archived) || isTrue(frontmatter.archived)) {
    return true;
  }
  return refsOf(frontmatter.exo__Asset_deprecatedBy).length > 0;
}

/** Every rule in force, parsed, in path order. */
export async function loadCreationGatePolicies(
  source: CreationGatePolicySource,
  deps: CreationGateDeps,
): Promise<CreationGatePolicy[]> {
  const candidates = [...(await source.candidates())].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  const policies: CreationGatePolicy[] = [];
  const seen = new Set<string>();
  for (const { path, frontmatter } of candidates) {
    if (seen.has(path)) continue;
    seen.add(path);
    if (!namesCreationGateClass(frontmatter.exo__Instance_class)) continue;
    if (isRetiredRule(frontmatter)) continue;
    policies.push(await parseCreationGatePolicy(frontmatter, path, deps));
  }
  return policies;
}
