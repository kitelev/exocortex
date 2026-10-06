import {
  CREATION_GATE_CLASS_LABEL,
  CREATION_GATE_CLASS_UID,
  CREATION_GATE_MAX_DEPTH,
} from "./CreationGateContract";
import {
  missingChainFields,
  type CreationGateDeps,
  type CreationGatePolicy,
} from "./CreationGatePolicy";
import { refsOf, textOf, type ParsedRef } from "./refs";

/** The asset about to be written: its path and its assembled bytes. */
export interface CreationGateCandidate {
  readonly path: string;
  /** The whole file as it will be written (frontmatter + body). */
  readonly content: string;
  /** `content`'s frontmatter, parsed. */
  readonly frontmatter: Record<string, unknown>;
}

export type CreationGateVerdict =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly policyUid: string;
      readonly policyLabel: string;
      readonly reason: string;
      readonly hint: string | null;
    };

/** Upper bound on classes visited per superclass closure (cycle-safe anyway). */
const MAX_CLASS_CLOSURE = 256;

/**
 * Per-evaluation memo of class identities and superclass closures. Classes are
 * compared by identity KEYS — the lower-cased UID and label of the class asset
 * a reference resolves to (an unresolvable reference keeps its own target and
 * alias) — so `[[uid]]`, `[[uid|label]]` and `[[label]]` of one class match
 * each other (onto-RFC §Семантика п.3).
 */
class ClassReasoner {
  private readonly keyMemo = new Map<string, Promise<Set<string>>>();
  private readonly closureMemo = new Map<string, Promise<Set<string>>>();

  constructor(private readonly deps: CreationGateDeps) {}

  /** Identity keys of the class a reference names. */
  keysOf(ref: ParsedRef): Promise<Set<string>> {
    const memoKey = `${ref.target}\u0000${ref.alias ?? ""}`;
    let pending = this.keyMemo.get(memoKey);
    if (!pending) {
      pending = this.computeKeys(ref);
      this.keyMemo.set(memoKey, pending);
    }
    return pending;
  }

  private async computeKeys(ref: ParsedRef): Promise<Set<string>> {
    const keys = new Set<string>([ref.target.toLowerCase()]);
    const asset = await this.deps.frontmatterByRef(ref.target);
    if (asset) {
      const uid = textOf(asset.exo__Asset_uid);
      const label = textOf(asset.exo__Asset_label);
      if (uid) keys.add(uid.toLowerCase());
      if (label) keys.add(label.toLowerCase());
    } else if (ref.alias) {
      keys.add(ref.alias.toLowerCase());
    }
    return keys;
  }

  /** Union of the identity keys of every class in `refs`. */
  async keysOfAll(refs: readonly ParsedRef[]): Promise<Set<string>> {
    const all = new Set<string>();
    for (const ref of refs) {
      for (const key of await this.keysOf(ref)) all.add(key);
    }
    return all;
  }

  /** Identity keys of a class AND all its `exo__Class_superClass` ancestors. */
  closureOf(ref: ParsedRef): Promise<Set<string>> {
    const memoKey = `${ref.target}\u0000${ref.alias ?? ""}`;
    let pending = this.closureMemo.get(memoKey);
    if (!pending) {
      pending = this.computeClosure(ref);
      this.closureMemo.set(memoKey, pending);
    }
    return pending;
  }

  private async computeClosure(start: ParsedRef): Promise<Set<string>> {
    const closure = new Set<string>();
    const visited = new Set<string>();
    const queue: ParsedRef[] = [start];
    while (queue.length > 0 && visited.size < MAX_CLASS_CLOSURE) {
      const ref = queue.shift() as ParsedRef;
      const visitKey = ref.target.toLowerCase();
      if (visited.has(visitKey)) continue;
      visited.add(visitKey);
      for (const key of await this.keysOf(ref)) closure.add(key);
      const asset = await this.deps.frontmatterByRef(ref.target);
      if (asset) queue.push(...refsOf(asset.exo__Class_superClass));
    }
    return closure;
  }

  /** Is `classRef` (by closure) a subclass of — or the same as — any of `ruleKeys`? */
  async within(classRef: ParsedRef, ruleKeys: ReadonlySet<string>): Promise<boolean> {
    if (ruleKeys.size === 0) return false;
    for (const key of await this.closureOf(classRef)) {
      if (ruleKeys.has(key)) return true;
    }
    return false;
  }
}

function nameOf(frontmatter: Record<string, unknown>, fallback: string): string {
  return (
    textOf(frontmatter.exo__Asset_label) ??
    textOf(frontmatter.exo__Asset_uid) ??
    fallback
  );
}

async function isRuleAsset(
  classes: readonly ParsedRef[],
  reasoner: ClassReasoner,
): Promise<boolean> {
  for (const ref of classes) {
    const keys = await reasoner.keysOf(ref);
    if (
      keys.has(CREATION_GATE_CLASS_UID) ||
      keys.has(CREATION_GATE_CLASS_LABEL.toLowerCase())
    ) {
      return true;
    }
  }
  return false;
}

/** One rule against one candidate (onto-RFC §Семантика п.4–8). */
async function evaluateOne(
  candidate: CreationGateCandidate,
  policy: CreationGatePolicy,
  reasoner: ClassReasoner,
  deps: CreationGateDeps,
): Promise<CreationGateVerdict> {
  const refuse = (reason: string): CreationGateVerdict => ({
    allowed: false,
    policyUid: policy.uid,
    policyLabel: policy.label,
    reason,
    hint: policy.description,
  });
  const classes = refsOf(candidate.frontmatter.exo__Instance_class);
  const candidateName = nameOf(candidate.frontmatter, candidate.path);

  // п.8 — no recognised guardedClass: the rule's area is UNKNOWN, so every
  // creation is refused except a new rule asset (otherwise a broken rule could
  // never be replaced).
  if (policy.guardedClass.length === 0) {
    if (await isRuleAsset(classes, reasoner)) return { allowed: true };
    return refuse(
      "в правиле нет распознанного guardedClass — область правила неизвестна, создание закрыто до починки правила (новый ассет правила создать можно)",
    );
  }

  // п.4 — applicability, judged PER CLASS of the candidate.
  const guardedKeys = await reasoner.keysOfAll(policy.guardedClass);
  const excludedKeys = await reasoner.keysOfAll(policy.excludedClass);
  const guarded: ParsedRef[] = [];
  for (const ref of classes) {
    if (
      (await reasoner.within(ref, guardedKeys)) &&
      !(await reasoner.within(ref, excludedKeys))
    ) {
      guarded.push(ref);
    }
  }
  if (guarded.length === 0) return { allowed: true };

  // п.5 — exemption by evidence: EVERY guarded class is exempt and the
  // evidence is found in the assembled text.
  let evidenceNote = "";
  const exemptKeys = await reasoner.keysOfAll(policy.exemptClass);
  let allExempt = exemptKeys.size > 0;
  for (const ref of guarded) {
    if (!allExempt) break;
    allExempt = await reasoner.within(ref, exemptKeys);
  }
  if (allExempt && policy.exemptEvidence) {
    if (policy.exemptEvidence.regex) {
      if (policy.exemptEvidence.regex.test(candidate.content)) {
        return { allowed: true };
      }
    } else {
      evidenceNote = ` (улика не проверялась: регэксп exemptEvidence не компилируется — ${policy.exemptEvidence.error ?? "ошибка разбора"})`;
    }
  }

  // п.8 — a rule without its chain fields cannot judge the chain.
  const missing = missingChainFields(policy);
  if (missing.length > 0) {
    return refuse(
      `правило неполно — нет ${missing.join(", ")}, цепочку нечем проверить${evidenceNote}`,
    );
  }

  // п.6 — the chain, starting from the candidate itself.
  const anchorKeys = await reasoner.keysOfAll(policy.anchorClass);
  const allowedKeys = await reasoner.keysOfAll(policy.allowedStatus);
  const chainKey = policy.chainKey as string;
  const directionKey = policy.directionKey as string;
  const statusKey = policy.statusKey as string;

  const hasAllowedDirection = async (
    node: Record<string, unknown>,
  ): Promise<boolean> => {
    for (const directionRef of refsOf(node[directionKey])) {
      const direction = await deps.frontmatterByRef(directionRef.target);
      if (!direction) continue;
      for (const statusRef of refsOf(direction[statusKey])) {
        for (const key of await reasoner.keysOf(statusRef)) {
          if (allowedKeys.has(key)) return true;
        }
      }
    }
    return false;
  };
  const isAnchor = async (node: Record<string, unknown>): Promise<boolean> => {
    for (const ref of refsOf(node.exo__Instance_class)) {
      if (await reasoner.within(ref, anchorKeys)) return true;
    }
    return false;
  };

  let node: Record<string, unknown> = candidate.frontmatter;
  let name = candidateName;
  const visited = new Set<string>();
  const candidateUid = textOf(candidate.frontmatter.exo__Asset_uid);
  if (candidateUid) visited.add(candidateUid.toLowerCase());
  for (let hops = 0; ; hops++) {
    if ((await isAnchor(node)) && (await hasAllowedDirection(node))) {
      return { allowed: true };
    }
    const parent = refsOf(node[chainKey])[0];
    if (!parent) {
      const anchorNames: string[] = [];
      for (const ref of policy.anchorClass) {
        const anchor = await deps.frontmatterByRef(ref.target);
        anchorNames.push(
          (anchor ? textOf(anchor.exo__Asset_label) : null) ?? ref.alias ?? ref.target,
        );
      }
      return refuse(
        `цепочка ${chainKey} оборвалась на «${name}» — не дошла до ${anchorNames.join(
          " / ",
        )} с направлением в разрешённом статусе${evidenceNote}`,
      );
    }
    if (hops + 1 > CREATION_GATE_MAX_DEPTH) {
      return refuse(
        `цепочка ${chainKey} глубже ${CREATION_GATE_MAX_DEPTH} — разрешающий якорь не найден${evidenceNote}`,
      );
    }
    const parentFrontmatter = await deps.frontmatterByRef(parent.target);
    if (!parentFrontmatter) {
      return refuse(
        `родитель «${parent.alias ?? parent.target}» (${chainKey} у «${name}») не найден${evidenceNote}`,
      );
    }
    const identity = (
      textOf(parentFrontmatter.exo__Asset_uid) ?? parent.target
    ).toLowerCase();
    const parentName = nameOf(parentFrontmatter, parent.target);
    if (visited.has(identity)) {
      return refuse(
        `цикл в цепочке ${chainKey}: «${parentName}» встречается дважды${evidenceNote}`,
      );
    }
    visited.add(identity);
    node = parentFrontmatter;
    name = parentName;
  }
}

/**
 * Judge a candidate against every rule in force (onto-RFC §Семантика п.7 —
 * conjunction: creation passes only if every rule that concerns it passes it).
 * No rules ⇒ allowed: in a vault without a rule asset the engine does nothing.
 */
export async function evaluateCreationGate(
  candidate: CreationGateCandidate,
  policies: readonly CreationGatePolicy[],
  deps: CreationGateDeps,
): Promise<CreationGateVerdict> {
  if (policies.length === 0) return { allowed: true };
  const reasoner = new ClassReasoner(deps);
  for (const policy of policies) {
    const verdict = await evaluateOne(candidate, policy, reasoner, deps);
    if (!verdict.allowed) return verdict;
  }
  return { allowed: true };
}
