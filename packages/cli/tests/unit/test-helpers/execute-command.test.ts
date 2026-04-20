/**
 * Unit tests for the integration-layer `execute-command.ts` wrapper.
 *
 * Covers the node-fs adapters + `toGroundingDefinition` transformer. The
 * end-to-end `executeCommandHarness` path is covered by the parametrized
 * integration suite (to be added in Phase 1 follow-up tasks); this suite
 * keeps the transformer honest without touching the submodule.
 */
import { describe, it, expect } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { GroundingType, ServiceRegistry } from "exocortex";
import {
  NodeFileSystemReader,
  NodeFileSystemWriter,
  executeCommandHarness,
  toGroundingDefinition,
} from "../../integration/starter-kit/test-helpers/execute-command.js";
import type { GroundingData } from "../../integration/starter-kit/test-helpers/extract-target-class.js";

// ---------------------------------------------------------------------------
// toGroundingDefinition
// ---------------------------------------------------------------------------

describe("toGroundingDefinition", () => {
  it("maps property_set", () => {
    const out = toGroundingDefinition({
      uid: "g-1",
      label: "Set Status",
      type: "property_set",
      targetProperty: "ems__Effort_status",
      targetValue: `"[[ems__EffortStatusDoing]]"`,
      raw: {},
    });
    expect(out).toMatchObject({
      id: "g-1",
      label: "Set Status",
      type: GroundingType.PROPERTY_SET,
      targetProperty: "ems__Effort_status",
      targetValue: `"[[ems__EffortStatusDoing]]"`,
    });
  });

  it("maps property_delete", () => {
    const out = toGroundingDefinition({
      uid: "g-2",
      label: "Delete",
      type: "property_delete",
      targetProperty: "ems__Effort_endTimestamp",
      raw: {},
    });
    expect(out.type).toBe(GroundingType.PROPERTY_DELETE);
  });

  it("maps service_call and copies serviceId into targetProperty", () => {
    const out = toGroundingDefinition({
      uid: "g-3",
      label: "Convert",
      type: "service_call",
      serviceId: "updateProperty",
      targetValue: `"[[ems__Task]]"`,
      raw: {},
    });
    expect(out.type).toBe(GroundingType.SERVICE_CALL);
    expect(out.targetProperty).toBe("updateProperty");
    expect(out.targetValue).toBe(`"[[ems__Task]]"`);
  });

  it("prefers serviceId over targetProperty for service_call (mirrors CommandResolver:465-468)", () => {
    // Starter-kit fixtures split serviceId + targetProperty fields
    // (e.g. abdbdf09 Convert to task: serviceId=updateProperty,
    // targetProperty=exo__Instance_class). CommandResolver resolves this
    // ambiguity by letting serviceId win; the YAML-path helper does the
    // same so both entry points produce the same GroundingDefinition shape.
    const out = toGroundingDefinition({
      uid: "g-3b",
      label: "Convert",
      type: "service_call",
      targetProperty: "exo__Instance_class",
      serviceId: "updateProperty",
      targetValue: `"[[ems__Task]]"`,
      raw: {},
    });
    expect(out.targetProperty).toBe("updateProperty");
  });

  it("falls back to targetProperty when serviceId is absent (vault grounding shape)", () => {
    const out = toGroundingDefinition({
      uid: "g-3c",
      label: "Vault convert",
      type: "service_call",
      targetProperty: "updateProperty",
      targetValue: `"[[ems__Task]]"`,
      raw: {},
    });
    expect(out.targetProperty).toBe("updateProperty");
  });

  it("maps composite and recurses into steps", () => {
    const data: GroundingData = {
      uid: "g-4",
      label: "Transition",
      type: "composite",
      steps: [
        {
          uid: "s-1",
          label: "Set status",
          type: "property_set",
          targetProperty: "ems__Effort_status",
          targetValue: `"[[ems__EffortStatusDoing]]"`,
          raw: {},
        },
        {
          uid: "s-2",
          label: "Set timestamp",
          type: "property_set",
          targetProperty: "ems__Effort_startTimestamp",
          targetValue: "$nowLocal",
          raw: {},
        },
      ],
      raw: {},
    };
    const out = toGroundingDefinition(data);
    expect(out.type).toBe(GroundingType.COMPOSITE);
    expect(out.steps).toHaveLength(2);
    expect(out.steps?.[0].type).toBe(GroundingType.PROPERTY_SET);
    expect(out.steps?.[1].targetValue).toBe("$nowLocal");
  });

  it("defaults to PROPERTY_SET for unknown types (executor will reject)", () => {
    const out = toGroundingDefinition({
      uid: "g-5",
      label: "Unknown",
      type: "nonsense",
      raw: {},
    });
    expect(out.type).toBe(GroundingType.PROPERTY_SET);
  });
});

// ---------------------------------------------------------------------------
// NodeFileSystemReader / NodeFileSystemWriter
// ---------------------------------------------------------------------------

describe("NodeFileSystemReader / NodeFileSystemWriter", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "execute-command-unit-"));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const reader = new NodeFileSystemReader();
  const writer = new NodeFileSystemWriter();

  it("readFile round-trips writeFile", async () => {
    const file = path.join(tmp, "a.md");
    await writer.writeFile(file, "hello");
    expect(await reader.readFile(file)).toBe("hello");
  });

  it("fileExists returns true/false", async () => {
    const existing = path.join(tmp, "b.md");
    await writer.writeFile(existing, "x");
    expect(await reader.fileExists(existing)).toBe(true);
    expect(await reader.fileExists(path.join(tmp, "missing.md"))).toBe(false);
  });

  it("updateFile overwrites existing content", async () => {
    const file = path.join(tmp, "c.md");
    await writer.writeFile(file, "before");
    await writer.updateFile(file, "after");
    expect(await reader.readFile(file)).toBe("after");
  });

  it("createFile fails when file already exists", async () => {
    const file = path.join(tmp, "d.md");
    await writer.createFile(file, "v1");
    await expect(writer.createFile(file, "v2")).rejects.toThrow();
  });

  it("deleteFile + renameFile behave as expected", async () => {
    const a = path.join(tmp, "rename-a.md");
    const b = path.join(tmp, "rename-b.md");
    await writer.writeFile(a, "content");
    await writer.renameFile(a, b);
    expect(await reader.fileExists(a)).toBe(false);
    expect(await reader.fileExists(b)).toBe(true);
    await writer.deleteFile(b);
    expect(await reader.fileExists(b)).toBe(false);
  });

  it("getMarkdownFiles walks subdirectories and filters .md", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "md-walk-"));
    try {
      fs.mkdirSync(path.join(root, "sub"));
      fs.writeFileSync(path.join(root, "a.md"), "");
      fs.writeFileSync(path.join(root, "b.txt"), "");
      fs.writeFileSync(path.join(root, "sub", "c.md"), "");
      const files = await reader.getMarkdownFiles(root);
      const rel = files.map((p) => path.relative(root, p)).sort();
      expect(rel).toEqual(["a.md", "sub/c.md"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// executeCommandHarness — smoke via real GroundingExecutor
// ---------------------------------------------------------------------------

describe("executeCommandHarness (real GroundingExecutor end-to-end)", () => {
  it("dispatches a property_set grounding and mutates the target file", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "execute-smoke-"));
    try {
      const filePath = path.join(tmp, "host.md");
      fs.writeFileSync(
        filePath,
        [
          "---",
          `exo__Asset_uid: host-uid`,
          `exo__Asset_label: "Host"`,
          `exo__Instance_class:`,
          `  - "[[ems__Task]]"`,
          "---",
          "",
          "# Host",
          "",
        ].join("\n"),
      );
      const result = await executeCommandHarness({
        grounding: {
          uid: "g-smoke",
          label: "Set Status",
          type: "property_set",
          targetProperty: "ems__Effort_status",
          targetValue: `"[[ems__EffortStatusDoing]]"`,
          raw: {},
        },
        filePath,
        targetIRI: "obsidian://vault/host",
      });
      expect(result.success).toBe(true);
      const after = fs.readFileSync(filePath, "utf8");
      expect(after).toContain("ems__Effort_status");
      expect(after).toContain("ems__EffortStatusDoing");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("accepts a custom ServiceRegistry", async () => {
    const registry = new ServiceRegistry();
    expect(registry.getRegisteredIds()).toEqual([]);
    // Harness must accept and forward the registry — no crash on generic
    // service_call with unknown serviceId (error surfaces as result.success=false).
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "execute-registry-"));
    try {
      const filePath = path.join(tmp, "h.md");
      fs.writeFileSync(filePath, "---\n---\n");
      const result = await executeCommandHarness({
        grounding: {
          uid: "g-sc",
          label: "Unknown service",
          type: "service_call",
          serviceId: "notRegistered",
          raw: {},
        },
        filePath,
        targetIRI: "obsidian://vault/h",
        serviceRegistry: registry,
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Service not found/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
