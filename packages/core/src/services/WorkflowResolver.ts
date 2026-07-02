import { injectable } from "tsyringe";
import type { ITripleStore } from "../interfaces/ITripleStore";
import type { Triple, Object as RDFObject } from "../domain/models/rdf/Triple";
import { IRI } from "../domain/models/rdf/IRI";
import { Literal } from "../domain/models/rdf/Literal";
import { Namespace } from "../domain/models/rdf/Namespace";
import { AssetClass } from "../domain/constants/AssetClass";
import { EffortStatus } from "../domain/constants/EffortStatus";
import type {
  WorkflowDefinition,
  WorkflowStateDefinition,
  WorkflowTransitionDefinition,
} from "../domain/models/WorkflowDefinition";
import {
  PROJECT_DEFAULT_WORKFLOW,
  TASK_DEFAULT_WORKFLOW,
} from "../domain/defaults/DefaultWorkflows";
import { CLASS_UID_TO_LABEL } from "../domain/constants/WorkflowClassUids";
import { iriToObsidianName } from "../utilities/iriToObsidianName";

/**
 * Resolves WorkflowDefinitions from vault assets stored in an ITripleStore.
 *
 * Resolution priority:
 * 1. Asset-specific workflow (ems__Effort_workflow property)
 * 2. Class default workflow (ems__Workflow_isDefault = true)
 * 3. Hardcoded fallback (backward compatibility)
 *
 * Issue #2359
 */
@injectable()
export class WorkflowResolver {
  private readonly cache = new Map<string, WorkflowDefinition>();

  /** req 915b20b2 — bound on the subclass-workflow ancestry BFS (cycle guard +
   * pathological-depth backstop). Real class chains are ≤ ~4 deep. */
  private static readonly MAX_HIERARCHY_DEPTH = 16;

  constructor(private readonly tripleStore: ITripleStore) {}

  /**
   * Resolve workflow for a given asset class.
   * Returns default workflow for the class, or hardcoded fallback.
   */
  async resolveForClass(assetClass: AssetClass): Promise<WorkflowDefinition> {
    const cacheKey = `class:${assetClass}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const definition = await this.findDefaultWorkflow(assetClass);
    const result = definition ?? this.getHardcodedFallback(assetClass);

    this.cache.set(cacheKey, result);
    return result;
  }

  /**
   * Resolve workflow for a specific asset by its subject IRI.
   * Checks ems__Effort_workflow property first, then falls back to class default.
   */
  async resolveForAsset(
    subjectIRI: IRI,
    assetClass: AssetClass,
  ): Promise<WorkflowDefinition> {
    // Check for asset-specific workflow override
    const workflowTriples = await this.tripleStore.match(
      subjectIRI,
      Namespace.EMS.term("Effort_workflow"),
      undefined,
    );

    if (workflowTriples.length > 0) {
      const workflowRef = workflowTriples[0].object;
      if (workflowRef instanceof IRI) {
        const specific = await this.loadWorkflowBySubject(workflowRef);
        if (specific) return specific;
      }
    }

    // Fall back to class default
    return this.resolveForClass(assetClass);
  }

  /**
   * RFC 36347daf (generalised, fix wf-transition crash) — data-driven workflow
   * resolution for the `workflow_transition` grounding. Accepts the RAW class
   * references from the target's `exo__Instance_class` (each UID-canon `"<uid>"`,
   * alias `"<uid>|label"`, or bare `"label"`; `exo__Instance_class` may be
   * multi-valued) — NOT constrained to a hardcoded class set — and returns the
   * applicable workflow, or `null` when no class has one.
   *
   * Resolution priority (all vault-data-driven except the built-in defaults):
   *   1. Per-asset override — `ems__Effort_workflow` on the asset itself
   *      (works for ANY class, e.g. a one-off `ems__Bug` with its own workflow).
   *   2. Built-in default — Task / Project / Meeting resolve their
   *      class-default workflow (a vault `ems__Workflow` ABox with matching
   *      `Workflow_targetClass` if present, else the hardcoded fallback).
   *   3. `null` — the class is neither overridden nor a built-in workflow class
   *      (e.g. `ems__Action`'s own one-shot lifecycle, `exo__Asset`, or any
   *      class for which no workflow has been declared). The caller treats this
   *      as "no status workflow" and degrades gracefully — no crash.
   *
   * To make a NEW class status-managed without code changes: add an
   * `ems__Effort_workflow` to its assets (step 1) — Homoiconicity Invariant.
   * (Per-class `ems__Workflow` ABox support for arbitrary non-built-in classes
   * is a follow-up; today only the built-in three resolve a class default.)
   */
  async resolveForAssetOrNull(
    subjectIRI: IRI,
    classRefs: readonly string[],
  ): Promise<WorkflowDefinition | null> {
    // 1. Per-asset workflow override — class-independent.
    const workflowTriples = await this.tripleStore.match(
      subjectIRI,
      Namespace.EMS.term("Effort_workflow"),
      undefined,
    );
    if (workflowTriples.length > 0) {
      const workflowRef = workflowTriples[0].object;
      if (workflowRef instanceof IRI) {
        const specific = await this.loadWorkflowBySubject(workflowRef);
        if (specific) return specific;
      }
    }

    // 2. Built-in class default (Task / Project / Meeting only) — try EACH class
    //    ref so a multi-valued `exo__Instance_class` still resolves when a
    //    built-in class is not listed first.
    for (const classRef of classRefs) {
      const builtIn = this.classRefToBuiltInClass(classRef);
      if (builtIn !== null) {
        return this.resolveForClass(builtIn);
      }
    }

    // 2.5. Subclass inheritance (req 915b20b2) — a class that is a transitive
    //   subClass (via `exo__Class_superClass`) of a built-in Task/Project/Meeting
    //   inherits that built-in's workflow. This makes the standard status
    //   buttons (start-effort / mark-done / move-to-backlog `workflow_transition`
    //   groundings) work on ANY Task subclass — e.g. `ems__WaitingCheckTask` —
    //   which previously resolved `null` (only the exact built-in three matched)
    //   and silently no-op'd. Data-driven walk over the vault class hierarchy;
    //   degrades to `null` (benign) on any resolution failure.
    const inherited = await this.findBuiltInWorkflowByAncestry(classRefs);
    if (inherited) return inherited;

    // 3. No applicable workflow — benign, NOT an error.
    return null;
  }

  /**
   * Map a raw `exo__Instance_class` reference to a built-in workflow
   * {@link AssetClass} (Task / Project / Meeting), or `null` when it is not one
   * of them. Tolerates UID-canon (`"<uid>"`), alias (`"<uid>|ems__Task"`), and
   * bare-label (`"ems__Task"`) forms. Case-insensitive on the UID.
   */
  private classRefToBuiltInClass(classRef: string): AssetClass | null {
    const norm = this.normalizeWikilink(classRef);
    const bare = norm.includes("|")
      ? (norm.split("|").pop() ?? "").trim()
      : norm.trim();

    const BUILT_IN = new Set<string>([
      AssetClass.TASK,
      AssetClass.PROJECT,
      AssetClass.MEETING,
    ]);
    if (BUILT_IN.has(bare)) return bare as AssetClass;

    const uuidMatch = norm.match(
      /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    );
    if (uuidMatch) {
      const label = CLASS_UID_TO_LABEL[uuidMatch[1].toLowerCase()];
      if (label && BUILT_IN.has(label)) return label as AssetClass;
    }
    return null;
  }

  /**
   * req 915b20b2 — resolve the built-in workflow inherited by a class that is a
   * transitive subClass (via `exo__Class_superClass`) of Task/Project/Meeting.
   *
   * BFS over the vault class hierarchy from each declared class ref. At each
   * `exo__Class_superClass` parent, {@link iriToObsidianName} maps the parent
   * IRI — symbolic (`https://exocortex.my/ontology/ems#Task`) OR class-file
   * (`obsidian://vault/.../<uid>.md`) — to the `ems__Task` / `<uid>` form
   * {@link classRefToBuiltInClass} understands. A parent that IS built-in wins
   * immediately; otherwise the parent is mapped back to its class-file IRI (the
   * BFS-walkable subject form — symbolic IRIs are not themselves subjects of
   * `exo__Class_superClass` triples) and enqueued. Cycle-safe (visited Set on
   * file IRIs), depth-bounded, and consumes only the triple store. Returns
   * `null` (benign) when no built-in ancestor exists or any lookup fails.
   */
  private async findBuiltInWorkflowByAncestry(
    classRefs: readonly string[],
  ): Promise<WorkflowDefinition | null> {
    try {
      const visited = new Set<string>();
      let frontier: IRI[] = [];
      for (const ref of classRefs) {
        const fileIRI = await this.resolveClassFileIRI(ref);
        if (fileIRI) frontier.push(fileIRI);
      }
      let depth = 0;
      while (frontier.length > 0 && depth < WorkflowResolver.MAX_HIERARCHY_DEPTH) {
        const next: IRI[] = [];
        for (const fileIRI of frontier) {
          if (visited.has(fileIRI.value)) continue;
          visited.add(fileIRI.value);
          const parentTriples = await this.tripleStore.match(
            fileIRI,
            Namespace.EXO.term("Class_superClass"),
            undefined,
          );
          for (const triple of parentTriples) {
            const obj = triple.object;
            if (!(obj instanceof IRI)) continue;
            const parentName = iriToObsidianName(obj.value);
            if (parentName) {
              const builtIn = this.classRefToBuiltInClass(parentName);
              if (builtIn !== null) return this.resolveForClass(builtIn);
            }
            // Map the parent to its class-file IRI subject to walk further up.
            const parentFileIRI = obj.value.startsWith("obsidian://vault/")
              ? obj
              : parentName
                ? await this.resolveClassFileIRI(parentName)
                : null;
            if (parentFileIRI && !visited.has(parentFileIRI.value)) {
              next.push(parentFileIRI);
            }
          }
        }
        frontier = next;
        depth++;
      }
      return null;
    } catch {
      // Benign: any resolution failure degrades to "no subclass workflow".
      return null;
    }
  }

  /**
   * req 915b20b2 — resolve a class ref (`"[[<uid>]]"`, `"<uid>"`,
   * `"<uid>|<label>"`, or bare `"<label>"`) to the class-file IRI subject under
   * which its `exo__Class_superClass` triples are stored. `null` when unknown.
   */
  private async resolveClassFileIRI(classRef: string): Promise<IRI | null> {
    const norm = this.normalizeWikilink(classRef);
    const uuidMatch = norm.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
    if (uuidMatch) return this.findSubjectByUID(uuidMatch[0]);
    const bare = norm.includes("|")
      ? (norm.split("|").pop() ?? "").trim()
      : norm.trim();
    if (!bare) return null;
    const uid = await this.findUidByLabel(bare);
    if (!uid) return null;
    return this.findSubjectByUID(uid);
  }

  /**
   * req 915b20b2 — find the subject IRI of the asset whose `exo__Asset_uid`
   * equals `uid`. Prefers the optional optimized UUID index; falls back to a
   * literal scan. Mirrors {@link CommandResolver}'s resolver (self-contained
   * here to keep WorkflowResolver dependency-free).
   */
  private async findSubjectByUID(uid: string): Promise<IRI | null> {
    if (this.tripleStore.findSubjectsByUUID) {
      const subjects = await this.tripleStore.findSubjectsByUUID(uid);
      if (subjects.length > 0) return subjects[0] as IRI;
    }
    const uidTriples = await this.tripleStore.match(
      undefined,
      Namespace.EXO.term("Asset_uid"),
      undefined,
    );
    for (const triple of uidTriples) {
      if (triple.object instanceof Literal && triple.object.value === uid) {
        return triple.subject as IRI;
      }
    }
    return null;
  }

  /**
   * req 915b20b2 — resolve a class label (`ems__WaitingCheckTask`) to the
   * `exo__Asset_uid` of the asset that carries it. `null` when unknown.
   */
  private async findUidByLabel(label: string): Promise<string | null> {
    const labelTriples = await this.tripleStore.match(
      undefined,
      Namespace.EXO.term("Asset_label"),
      undefined,
    );
    for (const triple of labelTriples) {
      if (
        triple.object instanceof Literal &&
        triple.object.value === label &&
        triple.subject instanceof IRI
      ) {
        const uidTriples = await this.tripleStore.match(
          triple.subject,
          Namespace.EXO.term("Asset_uid"),
          undefined,
        );
        if (uidTriples.length > 0 && uidTriples[0].object instanceof Literal) {
          return uidTriples[0].object.value;
        }
      }
    }
    return null;
  }

  /**
   * Invalidate all cached workflow definitions.
   * Call when workflow asset files change.
   */
  invalidateCache(): void {
    this.cache.clear();
  }

  /**
   * Find the default workflow for a given asset class from the triple store.
   */
  private async findDefaultWorkflow(
    assetClass: AssetClass,
  ): Promise<WorkflowDefinition | null> {
    // Find all ems__Workflow instances
    const workflowTriples = await this.tripleStore.match(
      undefined,
      Namespace.RDF.term("type"),
      Namespace.EMS.term("Workflow"),
    );

    for (const triple of workflowTriples) {
      const subject = triple.subject as IRI;

      // Check targetClass matches
      const targetClassTriples = await this.tripleStore.match(
        subject,
        Namespace.EMS.term("Workflow_targetClass"),
        undefined,
      );

      const matchesClass = targetClassTriples.some((t) => {
        const obj = t.object;
        if (obj instanceof IRI) {
          return obj.value.endsWith(assetClass.replace(/^ems__/, ""));
        }
        if (obj instanceof Literal) {
          return this.normalizeWikilink(obj.value) === assetClass;
        }
        return false;
      });

      if (!matchesClass) continue;

      // Check isDefault
      const isDefaultTriples = await this.tripleStore.match(
        subject,
        Namespace.EMS.term("Workflow_isDefault"),
        undefined,
      );

      const isDefault = isDefaultTriples.some((t) => {
        const val = t.object instanceof Literal ? t.object.value : "";
        return val === "true" || val === "1";
      });

      if (!isDefault) continue;

      // Found default workflow for this class — load it
      return this.loadWorkflowBySubject(subject);
    }

    return null;
  }

  /**
   * Load a complete WorkflowDefinition from a workflow subject IRI.
   */
  private async loadWorkflowBySubject(
    workflowSubject: IRI,
  ): Promise<WorkflowDefinition | null> {
    // Get workflow properties
    const labelTriples = await this.tripleStore.match(
      workflowSubject,
      Namespace.EXO.term("Asset_label"),
      undefined,
    );
    const name =
      labelTriples.length > 0 && labelTriples[0].object instanceof Literal
        ? labelTriples[0].object.value
        : "Unknown Workflow";

    const uidTriples = await this.tripleStore.match(
      workflowSubject,
      Namespace.EXO.term("Asset_uid"),
      undefined,
    );
    const id =
      uidTriples.length > 0 && uidTriples[0].object instanceof Literal
        ? uidTriples[0].object.value
        : workflowSubject.value;

    const targetClassTriples = await this.tripleStore.match(
      workflowSubject,
      Namespace.EMS.term("Workflow_targetClass"),
      undefined,
    );
    const targetClass = this.resolveAssetClass(targetClassTriples);

    const initialStateTriples = await this.tripleStore.match(
      workflowSubject,
      Namespace.EMS.term("Workflow_initialState"),
      undefined,
    );
    const initialState = this.resolveEffortStatus(initialStateTriples) ?? EffortStatus.DRAFT;

    const terminalStateTriples = await this.tripleStore.match(
      workflowSubject,
      Namespace.EMS.term("Workflow_terminalStates"),
      undefined,
    );
    const terminalStates = this.resolveEffortStatuses(terminalStateTriples);

    const isDefaultTriples = await this.tripleStore.match(
      workflowSubject,
      Namespace.EMS.term("Workflow_isDefault"),
      undefined,
    );
    const isDefault = isDefaultTriples.some((t) => {
      const val = t.object instanceof Literal ? t.object.value : "";
      return val === "true" || val === "1";
    });

    // Load states
    const states = await this.loadStates(workflowSubject);

    // Load transitions
    const transitions = await this.loadTransitions(workflowSubject);

    if (states.length === 0 && transitions.length === 0) {
      return null;
    }

    return {
      id,
      name,
      targetClass,
      states,
      transitions,
      initialState,
      terminalStates: terminalStates.length > 0
        ? terminalStates
        : [EffortStatus.DONE, EffortStatus.TRASHED],
      isDefault,
    };
  }

  /**
   * Load all WorkflowState assets linked to a workflow.
   */
  private async loadStates(
    workflowSubject: IRI,
  ): Promise<WorkflowStateDefinition[]> {
    // Find all WorkflowState instances that reference this workflow
    const stateTypeTriples = await this.tripleStore.match(
      undefined,
      Namespace.RDF.term("type"),
      Namespace.EMS.term("WorkflowState"),
    );

    const states: WorkflowStateDefinition[] = [];

    for (const triple of stateTypeTriples) {
      const stateSubject = triple.subject as IRI;

      // Check this state belongs to our workflow
      const workflowRefTriples = await this.tripleStore.match(
        stateSubject,
        Namespace.EMS.term("WorkflowState_workflow"),
        undefined,
      );

      const belongsToWorkflow = workflowRefTriples.some(
        (t) => this.isSameSubject(t.object, workflowSubject),
      );

      if (!belongsToWorkflow) continue;

      // Load state properties
      const statusTriples = await this.tripleStore.match(
        stateSubject,
        Namespace.EMS.term("WorkflowState_status"),
        undefined,
      );
      const status = this.resolveEffortStatus(statusTriples);
      if (!status) continue;

      const orderTriples = await this.tripleStore.match(
        stateSubject,
        Namespace.EMS.term("WorkflowState_order"),
        undefined,
      );
      const order =
        orderTriples.length > 0 && orderTriples[0].object instanceof Literal
          ? parseInt(orderTriples[0].object.value, 10) || 0
          : 0;

      const optionalTriples = await this.tripleStore.match(
        stateSubject,
        Namespace.EMS.term("WorkflowState_optional"),
        undefined,
      );
      const optional = optionalTriples.some((t) => {
        const val = t.object instanceof Literal ? t.object.value : "";
        return val === "true" || val === "1";
      });

      const timestampTriples = await this.tripleStore.match(
        stateSubject,
        Namespace.EMS.term("WorkflowState_timestampOnEnter"),
        undefined,
      );
      const timestampOnEnter = timestampTriples
        .map((t) => (t.object instanceof Literal ? t.object.value : ""))
        .filter((v) => v.length > 0);

      const badgeColorTriples = await this.tripleStore.match(
        stateSubject,
        Namespace.EMS.term("WorkflowState_badgeColor"),
        undefined,
      );
      const badgeColor =
        badgeColorTriples.length > 0 &&
        badgeColorTriples[0].object instanceof Literal
          ? badgeColorTriples[0].object.value
          : undefined;

      states.push({
        status,
        order,
        optional,
        timestampOnEnter,
        badgeColor,
      });
    }

    return states.sort((a, b) => a.order - b.order);
  }

  /**
   * Load all WorkflowTransition assets linked to a workflow.
   */
  private async loadTransitions(
    workflowSubject: IRI,
  ): Promise<WorkflowTransitionDefinition[]> {
    const transTypeTriples = await this.tripleStore.match(
      undefined,
      Namespace.RDF.term("type"),
      Namespace.EMS.term("WorkflowTransition"),
    );

    const transitions: WorkflowTransitionDefinition[] = [];

    for (const triple of transTypeTriples) {
      const transSubject = triple.subject as IRI;

      // Check this transition belongs to our workflow
      const workflowRefTriples = await this.tripleStore.match(
        transSubject,
        Namespace.EMS.term("WorkflowTransition_workflow"),
        undefined,
      );

      const belongsToWorkflow = workflowRefTriples.some(
        (t) => this.isSameSubject(t.object, workflowSubject),
      );

      if (!belongsToWorkflow) continue;

      // Load transition properties
      const fromTriples = await this.tripleStore.match(
        transSubject,
        Namespace.EMS.term("WorkflowTransition_from"),
        undefined,
      );
      const from = this.resolveEffortStatus(fromTriples);

      const toTriples = await this.tripleStore.match(
        transSubject,
        Namespace.EMS.term("WorkflowTransition_to"),
        undefined,
      );
      const to = this.resolveEffortStatus(toTriples);

      if (!from || !to) continue;

      const labelTriples = await this.tripleStore.match(
        transSubject,
        Namespace.EMS.term("WorkflowTransition_label"),
        undefined,
      );
      const label =
        labelTriples.length > 0 && labelTriples[0].object instanceof Literal
          ? labelTriples[0].object.value
          : `${from} → ${to}`;

      const iconTriples = await this.tripleStore.match(
        transSubject,
        Namespace.EMS.term("WorkflowTransition_icon"),
        undefined,
      );
      const icon =
        iconTriples.length > 0 && iconTriples[0].object instanceof Literal
          ? iconTriples[0].object.value
          : undefined;

      const rollbackTriples = await this.tripleStore.match(
        transSubject,
        Namespace.EMS.term("WorkflowTransition_isRollback"),
        undefined,
      );
      const isRollback = rollbackTriples.some((t) => {
        const val = t.object instanceof Literal ? t.object.value : "";
        return val === "true" || val === "1";
      });

      // RFC 36347daf Phase 2 — postActions: ordered Grounding UIDs that the
      // GroundingExecutor.executeWorkflowTransition dispatcher executes
      // sequentially after status mutation. Each triple object is parsed for
      // a UUID (file IRI → basename UUID, or wikilink-literal `"[[<uid>]]"`).
      // YAML frontmatter array order is preserved by the triple store.
      const postActionTriples = await this.tripleStore.match(
        transSubject,
        Namespace.EMS.term("WorkflowTransition_postActions"),
        undefined,
      );
      const postActions = postActionTriples
        .map((t) => this.extractUid(t.object))
        .filter((u): u is string => u !== null);

      transitions.push({
        from,
        to,
        label,
        icon,
        isRollback,
        postActions: postActions.length > 0 ? postActions : undefined,
      });
    }

    return transitions;
  }

  /**
   * RFC 36347daf Phase 2 — extract a UUID from a triple object. The triple
   * store may yield either an IRI (file IRI `obsidian://vault/.../<uid>.md`
   * or symbolic class IRI) or a Literal (wikilink-form `"[[<uid>]]"` or
   * `"[[<uid>|<alias>]]"`). Returns the bare UUID (lowercased) or null if
   * no UUID could be extracted — never throws.
   */
  private extractUid(obj: RDFObject): string | null {
    const uuidRegex =
      /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
    const raw = obj instanceof IRI ? obj.value
      : obj instanceof Literal ? obj.value
      : null;
    if (raw === null) return null;
    const match = raw.match(uuidRegex);
    return match ? match[1].toLowerCase() : null;
  }

  // ─── Helpers ────────────────────────────────────────────────

  private normalizeWikilink(value: string): string {
    return value.replace(/["'[\]]/g, "").trim();
  }

  private resolveAssetClass(triples: Triple[]): AssetClass {
    if (triples.length === 0) return AssetClass.TASK;

    const obj = triples[0].object;
    if (obj instanceof IRI) {
      // e.g., https://exocortex.my/ontology/ems#Project → ems__Project
      const localName = obj.value.split("#").pop() ?? "";
      const fullName = `ems__${localName}`;
      return (Object.values(AssetClass).includes(fullName as AssetClass)
        ? fullName
        : AssetClass.TASK) as AssetClass;
    }
    if (obj instanceof Literal) {
      const normalized = this.normalizeWikilink(obj.value);
      return (Object.values(AssetClass).includes(normalized as AssetClass)
        ? normalized
        : AssetClass.TASK) as AssetClass;
    }
    return AssetClass.TASK;
  }

  private resolveEffortStatus(triples: Triple[]): EffortStatus | null {
    if (triples.length === 0) return null;

    const obj = triples[0].object;
    let raw: string;

    if (obj instanceof IRI) {
      const localName = obj.value.split("#").pop() ?? "";
      raw = `ems__${localName}`;
    } else if (obj instanceof Literal) {
      raw = this.normalizeWikilink(obj.value);
    } else {
      return null;
    }

    return Object.values(EffortStatus).includes(raw as EffortStatus)
      ? (raw as EffortStatus)
      : null;
  }

  private resolveEffortStatuses(triples: Triple[]): EffortStatus[] {
    return triples
      .map((t) => this.resolveEffortStatus([t]))
      .filter((s): s is EffortStatus => s !== null);
  }

  private isSameSubject(
    a: RDFObject,
    b: IRI,
  ): boolean {
    if (a instanceof IRI) {
      return a.value === b.value;
    }
    // For literal references (wikilinks), check if they resolve to the same asset
    if (a instanceof Literal) {
      const normalized = this.normalizeWikilink(a.value);
      return b.value.includes(normalized);
    }
    return false;
  }

  // ─── Hardcoded Fallbacks ────────────────────────────────────

  /**
   * Returns the hardcoded fallback workflow for backward compatibility
   * when no workflow assets exist in the vault.
   *
   * Delegates to DefaultWorkflows single source of truth (Issue #2463).
   */
  getHardcodedFallback(assetClass: AssetClass): WorkflowDefinition {
    if (assetClass === AssetClass.PROJECT) {
      return { ...PROJECT_DEFAULT_WORKFLOW };
    }
    return { ...TASK_DEFAULT_WORKFLOW };
  }
}
