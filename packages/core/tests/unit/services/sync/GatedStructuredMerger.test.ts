/**
 * GatedStructuredMerger — production MergeLayerPort composition (D17).
 * The gate-fail branch is the enforcement point of "an invalid merge never
 * ships" — covered here with a fake gate (review HIGH catch, PR #3459).
 */

import * as yaml from "js-yaml";
import { GatedStructuredMerger } from "../../../../src/services/sync/GatedStructuredMerger";
import {
  StructuredMerger,
  type YamlCodec,
} from "../../../../src/services/sync/StructuredMerger";
import type { MergeShaclGate } from "../../../../src/services/sync/MergeShaclGate";
import type { Violation } from "../../../../src/services/ShaclLiteValidator";

const codec: YamlCodec = {
  parse: (text) => yaml.load(text, { schema: yaml.CORE_SCHEMA }),
  stringify: (value) =>
    yaml.dump(value, { schema: yaml.CORE_SCHEMA, lineWidth: -1 }),
};
const merger = new StructuredMerger(codec);

const asset = (label: string, extra?: string): string =>
  `---\nexo__Asset_uid: u1\nexo__Asset_label: ${label}\n${extra !== undefined ? `extra: ${extra}\n` : ""}---\n\nbody\n`;

const violation = (n: number): Violation => ({
  focusNode: "obsidian://vault/data/u1.md",
  propertyPath: `https://exocortex.my/ontology/ems#prop${n}`,
  severity: "sh:Violation",
  message: `violation ${n}`,
  constraint: "minCount",
});

function fakeGate(ok: boolean, violations: Violation[] = []): {
  gate: MergeShaclGate;
  calls: Array<{ path: string; content: string }>;
} {
  const calls: Array<{ path: string; content: string }> = [];
  const gate = {
    checkMergedAsset: async (path: string, content: string) => {
      calls.push({ path, content });
      return ok ? { ok: true as const, violations: [] } : { ok: false as const, violations };
    },
  } as unknown as MergeShaclGate;
  return { gate, calls };
}

const INPUT = {
  path: "data/u1.md",
  uid: "u1",
  base: asset("Base"),
  local: asset("Local"),
  remote: asset("Base", "remote-value"),
};

describe("GatedStructuredMerger (D17)", () => {
  it("gate ok → use-merged with the merged content", async () => {
    const { gate, calls } = fakeGate(true);
    const layer = new GatedStructuredMerger(merger, gate);

    const decision = await layer.resolve(INPUT);

    expect(decision.action).toBe("use-merged");
    if (decision.action !== "use-merged") throw new Error("unreachable");
    expect(decision.content).toContain("exo__Asset_label: Local");
    expect(decision.content).toContain("extra: remote-value");
    // The gate saw exactly the merged candidate, not an input version.
    expect(calls).toEqual([{ path: INPUT.path, content: decision.content }]);
  });

  it("gate fail → quarantine; an invalid merge never ships", async () => {
    const { gate } = fakeGate(false, [
      violation(1),
      violation(2),
      violation(3),
      violation(4),
    ]);
    const layer = new GatedStructuredMerger(merger, gate);

    const decision = await layer.resolve(INPUT);

    expect(decision.action).toBe("quarantine");
    if (decision.action !== "quarantine") throw new Error("unreachable");
    expect(decision.reason).toMatch(/SHACL-invalid/);
    // Sample carries the first 3 violation messages, not all 4.
    expect(decision.reason).toContain("violation 1");
    expect(decision.reason).toContain("violation 3");
    expect(decision.reason).not.toContain("violation 4");
  });

  it("merger conflict → quarantine WITHOUT invoking the gate", async () => {
    const { gate, calls } = fakeGate(true);
    const layer = new GatedStructuredMerger(merger, gate);

    // Same scalar key changed differently on both sides → merger conflict.
    const decision = await layer.resolve({
      ...INPUT,
      local: asset("Local"),
      remote: asset("Remote"),
    });

    expect(decision.action).toBe("quarantine");
    expect(calls).toHaveLength(0);
  });

  it("without a gate the merged result ships ungated", async () => {
    const layer = new GatedStructuredMerger(merger);

    const decision = await layer.resolve(INPUT);

    expect(decision.action).toBe("use-merged");
  });
});
