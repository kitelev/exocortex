/**
 * Production MergeLayerPort composition (RFC 4e4dc453 A2): StructuredMerger
 * (D1/D20/D21) + optional open-world SHACL merge-gate. An unresolvable
 * merge OR a SHACL-invalid merged result quarantines BOTH versions (D17) —
 * an invalid merge never ships.
 */

import type {
  MergeConflictInput,
  MergeDecision,
  MergeLayerPort,
} from "./syncTypes";
import type { StructuredMerger } from "./StructuredMerger";
import type { MergeShaclGate } from "./MergeShaclGate";

export class GatedStructuredMerger implements MergeLayerPort {
  constructor(
    private readonly merger: StructuredMerger,
    private readonly gate?: MergeShaclGate,
  ) {}

  async resolve(input: MergeConflictInput): Promise<MergeDecision> {
    const outcome = this.merger.mergeAsset(input);
    if (outcome.status === "conflict") {
      return { action: "quarantine", reason: outcome.reason };
    }
    if (this.gate !== undefined) {
      const verdict = await this.gate.checkMergedAsset(
        input.path,
        outcome.content,
      );
      if (!verdict.ok) {
        const sample = verdict.violations
          .slice(0, 3)
          .map((v) => v.message)
          .join("; ");
        return {
          action: "quarantine",
          reason: `merged result is SHACL-invalid: ${sample}`,
        };
      }
    }
    return {
      action: "use-merged",
      content: outcome.content,
      warnings: outcome.warnings,
    };
  }
}
