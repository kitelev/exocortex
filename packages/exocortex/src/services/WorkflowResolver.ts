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
export class WorkflowResolver {
  private readonly cache = new Map<string, WorkflowDefinition>();

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

      transitions.push({ from, to, label, icon, isRollback });
    }

    return transitions;
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
   */
  getHardcodedFallback(assetClass: AssetClass): WorkflowDefinition {
    if (assetClass === AssetClass.PROJECT) {
      return this.getProjectFallback();
    }
    return this.getTaskFallback();
  }

  private getProjectFallback(): WorkflowDefinition {
    return {
      id: "hardcoded-project-default",
      name: "Project Default (hardcoded)",
      targetClass: AssetClass.PROJECT,
      initialState: EffortStatus.DRAFT,
      terminalStates: [EffortStatus.DONE, EffortStatus.TRASHED],
      isDefault: true,
      states: [
        { status: EffortStatus.DRAFT, order: 1, optional: false, timestampOnEnter: [] },
        { status: EffortStatus.BACKLOG, order: 2, optional: false, timestampOnEnter: [] },
        { status: EffortStatus.ANALYSIS, order: 3, optional: true, timestampOnEnter: [] },
        { status: EffortStatus.TODO, order: 4, optional: true, timestampOnEnter: [] },
        { status: EffortStatus.DOING, order: 5, optional: false, timestampOnEnter: ["ems__Effort_startTimestamp"] },
        { status: EffortStatus.DONE, order: 6, optional: false, timestampOnEnter: ["ems__Effort_endTimestamp", "ems__Effort_resolutionTimestamp"] },
        { status: EffortStatus.TRASHED, order: 7, optional: false, timestampOnEnter: ["ems__Effort_resolutionTimestamp"] },
      ],
      transitions: [
        { from: EffortStatus.DRAFT, to: EffortStatus.BACKLOG, label: "→ Backlog", isRollback: false },
        { from: EffortStatus.BACKLOG, to: EffortStatus.ANALYSIS, label: "→ Analysis", isRollback: false },
        { from: EffortStatus.ANALYSIS, to: EffortStatus.TODO, label: "→ ToDo", isRollback: false },
        { from: EffortStatus.TODO, to: EffortStatus.DOING, label: "▶ Start", isRollback: false },
        { from: EffortStatus.DOING, to: EffortStatus.DONE, label: "✓ Done", isRollback: false },
        // Rollbacks
        { from: EffortStatus.BACKLOG, to: EffortStatus.DRAFT, label: "← Draft", isRollback: true },
        { from: EffortStatus.ANALYSIS, to: EffortStatus.BACKLOG, label: "← Backlog", isRollback: true },
        { from: EffortStatus.TODO, to: EffortStatus.ANALYSIS, label: "← Analysis", isRollback: true },
        { from: EffortStatus.DOING, to: EffortStatus.TODO, label: "← ToDo", isRollback: true },
        { from: EffortStatus.DONE, to: EffortStatus.DOING, label: "← Doing", isRollback: true },
      ],
    };
  }

  private getTaskFallback(): WorkflowDefinition {
    return {
      id: "hardcoded-task-default",
      name: "Task Default (hardcoded)",
      targetClass: AssetClass.TASK,
      initialState: EffortStatus.DRAFT,
      terminalStates: [EffortStatus.DONE, EffortStatus.TRASHED],
      isDefault: true,
      states: [
        { status: EffortStatus.DRAFT, order: 1, optional: false, timestampOnEnter: [] },
        { status: EffortStatus.BACKLOG, order: 2, optional: false, timestampOnEnter: [] },
        { status: EffortStatus.DOING, order: 3, optional: false, timestampOnEnter: ["ems__Effort_startTimestamp"] },
        { status: EffortStatus.DONE, order: 4, optional: false, timestampOnEnter: ["ems__Effort_endTimestamp", "ems__Effort_resolutionTimestamp"] },
        { status: EffortStatus.TRASHED, order: 5, optional: false, timestampOnEnter: ["ems__Effort_resolutionTimestamp"] },
      ],
      transitions: [
        { from: EffortStatus.DRAFT, to: EffortStatus.BACKLOG, label: "→ Backlog", isRollback: false },
        { from: EffortStatus.BACKLOG, to: EffortStatus.DOING, label: "▶ Start", isRollback: false },
        { from: EffortStatus.DOING, to: EffortStatus.DONE, label: "✓ Done", isRollback: false },
        // Rollbacks
        { from: EffortStatus.BACKLOG, to: EffortStatus.DRAFT, label: "← Draft", isRollback: true },
        { from: EffortStatus.DOING, to: EffortStatus.BACKLOG, label: "← Backlog", isRollback: true },
        { from: EffortStatus.DONE, to: EffortStatus.DOING, label: "← Doing", isRollback: true },
      ],
    };
  }
}
