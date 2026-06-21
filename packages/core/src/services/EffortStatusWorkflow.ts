import { injectable } from "tsyringe";
import { AssetClass, EffortStatus } from "../domain/constants";
import { WorkflowEngine } from "./WorkflowEngine";
import { WorkflowResolver } from "./WorkflowResolver";
import { InMemoryTripleStore } from "../infrastructure/rdf/InMemoryTripleStore";
import type { WorkflowDefinition } from "../domain/models/WorkflowDefinition";

/**
 * Facade for effort status workflow transitions.
 *
 * Delegates to WorkflowEngine for actual transition logic.
 * Maintains backward-compatible API (wikilink format, null/undefined distinction).
 *
 * Issue #2361: Migrated from hardcoded if/else to WorkflowEngine delegation.
 *
 * RFC 36347daf Phase 2 (2026-05-30): adds {@link setResolver} so plugin/CLI
 * can swap the legacy empty-store resolver for the production triple-store-
 * backed one without changing the tsyringe-managed constructor signature
 * (TaskStatusService resolves this class from the DI container). Behavior
 * is preserved — `resolveDefinition` still routes through
 * `getHardcodedFallback` (sync). The injection prepares for a future
 * migration of `getPreviousStatus` to the async `resolveForClass` path.
 */
@injectable()
export class EffortStatusWorkflow {
  private resolver: WorkflowResolver;

  constructor() {
    // Backward-compatible: legacy empty-store wiring. tsyringe-friendly
    // (parameterless constructor, no auto-resolved dependencies).
    this.resolver = new WorkflowResolver(new InMemoryTripleStore());
  }

  /**
   * RFC 36347daf Phase 2 — swap the resolver post-construction. Used by
   * plugin/CLI consumers that have a production triple-store-backed
   * resolver to wire. No-op for callers that don't (tests, headless
   * harnesses) — the empty-store fallback installed in the constructor
   * keeps working.
   */
  setResolver(resolver: WorkflowResolver): void {
    this.resolver = resolver;
  }

  /**
   * Get the previous status for rollback.
   *
   * Return contract (preserved for backward compatibility):
   * - Draft → null (initial state, cannot rollback)
   * - Trashed/unknown → undefined (no rollback defined)
   * - Other → wrapped status string (e.g., '"[[ems__EffortStatusBacklog]]"')
   */
  getPreviousStatus(
    currentStatus: string,
    instanceClass: string | string[] | null,
  ): string | null | undefined {
    const normalizedStatus = this.normalizeStatus(currentStatus);

    // Determine which workflow to use based on asset class
    const definition = this.resolveDefinition(instanceClass);
    const engine = new WorkflowEngine(definition);

    // Check if initial state → return null (contract)
    if (engine.isInitialState(normalizedStatus as EffortStatus)) {
      return null;
    }

    // Get rollback target from engine
    const previousStatus = engine.getPreviousStatus(normalizedStatus as EffortStatus);

    // No rollback found → return undefined (contract for Trashed/unknown)
    if (previousStatus === null) {
      return undefined;
    }

    return this.wrapStatus(previousStatus);
  }

  normalizeStatus(status: string): string {
    return status.replace(/["'[\]]/g, "").trim();
  }

  wrapStatus(status: string): string {
    return `"[[${status}]]"`;
  }

  private resolveDefinition(
    instanceClass: string | string[] | null,
  ): WorkflowDefinition {
    // Use Task workflow only when explicitly a Task/Meeting.
    // For null instanceClass or unknown classes, use Project workflow
    // (superset that includes Analysis/ToDo states).
    const isTask = this.hasInstanceClass(instanceClass, AssetClass.TASK) ||
      this.hasInstanceClass(instanceClass, AssetClass.MEETING);
    return isTask
      ? this.resolver.getHardcodedFallback(AssetClass.TASK)
      : this.resolver.getHardcodedFallback(AssetClass.PROJECT);
  }

  private hasInstanceClass(
    instanceClass: string | string[] | null,
    targetClass: AssetClass,
  ): boolean {
    if (!instanceClass) return false;

    const classes = Array.isArray(instanceClass)
      ? instanceClass
      : [instanceClass];
    return classes.some(
      (cls) => cls.replace(/["'[\]]/g, "").trim() === targetClass,
    );
  }
}
