/**
 * Issue #3179 — integration test for `create` command cardinality emission.
 *
 * Builds a fixture vault with:
 *   - cardinality enum assets (Single, Multiple) at their canonical UIDs
 *   - a single-cardinality property (`ems__Effort_status`) referencing the
 *     Single enum via pure-UID wikilink (post-UID-canon vault shape)
 *   - a multi-cardinality property (`ems__Effort_relatesTo`) referencing the
 *     Multiple enum via pure-UID wikilink
 *   - a property with NO cardinality declared (`ems__Effort_unknown`)
 *
 * Then invokes the real `AssetCreationService` wired with a real
 * `ShapeLoader.loadFromVaultFS` registry, and asserts the produced
 * frontmatter emission matches acceptance criteria #1, #2 and #3 of the
 * issue:
 *   - Single → scalar
 *   - No cardinality declared → scalar (vault convention default)
 *   - Multiple → array
 *
 * Mirrors real production code path; verifies that the fix in `ShapeLoader`
 * (UID-form parsing) and `AssetCreationService` (default flip) work
 * together — neither alone is sufficient.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const { ShapeLoader } = await import("exocortex");
const { AssetCreationService } = await import(
  "../../src/services/AssetCreationService.js"
);
const { NodeFsAdapter } = await import(
  "../../src/adapters/NodeFsAdapter.js"
);
const { ClassResolverService } = await import(
  "../../src/services/ClassResolverService.js"
);
const { WikilinkValidator } = await import(
  "../../src/services/WikilinkValidator.js"
);

const CARDINALITY_SINGLE_UID = "c93c4b2f-b43d-4cc9-8dd0-31514d608da2";
const CARDINALITY_MULTIPLE_UID = "59a37aa7-ffbe-4e0d-ba60-06ae370d880f";
const STATUS_BACKLOG_UID = "753a44d5-846c-4b82-9196-4fd9a4d48777";
const TASK_CLASS_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e";

function md(frontmatter: Record<string, string | string[]>): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(frontmatter)) {
    if (Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const item of v) {
        lines.push(`  - ${item}`);
      }
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  lines.push("---");
  lines.push("");
  return lines.join("\n");
}

describe("Issue #3179: create command respects exo__Property_cardinality (integration)", () => {
  let vault: string;

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-3179-"));

    const exoDir = path.join(vault, "assetspaces", "exo");
    const emsDir = path.join(vault, "assetspaces", "ems");
    fs.mkdirSync(exoDir, { recursive: true });
    fs.mkdirSync(emsDir, { recursive: true });
    fs.mkdirSync(path.join(vault, "01 Inbox"), { recursive: true });

    // Cardinality enum assets — real vault shape.
    fs.writeFileSync(
      path.join(exoDir, `${CARDINALITY_SINGLE_UID}.md`),
      md({
        exo__Asset_uid: CARDINALITY_SINGLE_UID,
        exo__Asset_label: "exo__PropertyCardinalitySingle",
      }),
    );
    fs.writeFileSync(
      path.join(exoDir, `${CARDINALITY_MULTIPLE_UID}.md`),
      md({
        exo__Asset_uid: CARDINALITY_MULTIPLE_UID,
        exo__Asset_label: "exo__PropertyCardinalityMultiple",
      }),
    );

    // ems__Effort_status — Single cardinality via pure-UID wikilink.
    fs.writeFileSync(
      path.join(emsDir, "44c6e9e3-955f-4afc-9ca5-b4bd70667051.md"),
      md({
        exo__Asset_uid: "44c6e9e3-955f-4afc-9ca5-b4bd70667051",
        exo__Instance_class: ['"[[exo__ObjectProperty]]"'],
        exo__Property_domain: '"[[ems__Effort]]"',
        exo__Property_range: '"[[ems__EffortStatus]]"',
        exo__Property_cardinality: `"[[${CARDINALITY_SINGLE_UID}]]"`,
        exo__Asset_label: "ems__Effort_status",
      }),
    );

    // ems__Effort_relatesTo — Multiple cardinality via pure-UID wikilink.
    fs.writeFileSync(
      path.join(emsDir, "abababab-1234-5678-9999-aaaaaaaaaaaa.md"),
      md({
        exo__Asset_uid: "abababab-1234-5678-9999-aaaaaaaaaaaa",
        exo__Instance_class: ['"[[exo__ObjectProperty]]"'],
        exo__Property_domain: '"[[ems__Effort]]"',
        exo__Property_cardinality: `"[[${CARDINALITY_MULTIPLE_UID}]]"`,
        exo__Asset_label: "ems__Effort_relatesTo",
      }),
    );

    // ems__Task class file (target for --class lookup)
    fs.writeFileSync(
      path.join(emsDir, `${TASK_CLASS_UID}.md`),
      md({
        exo__Asset_uid: TASK_CLASS_UID,
        exo__Asset_label: "ems__Task",
      }),
    );

    // Backlog status target (for property value wikilink validation)
    fs.writeFileSync(
      path.join(emsDir, `${STATUS_BACKLOG_UID}.md`),
      md({
        exo__Asset_uid: STATUS_BACKLOG_UID,
        exo__Asset_label: "ems__EffortStatusBacklog",
      }),
    );
  });

  afterEach(() => {
    fs.rmSync(vault, { recursive: true, force: true });
  });

  const buildService = async () => {
    const fsAdapter = new NodeFsAdapter(vault);
    const classResolver = new ClassResolverService(fsAdapter);
    const wikilinkValidator = new WikilinkValidator(fsAdapter);
    const shapeRegistry = await ShapeLoader.loadFromVaultFS(vault);
    return new AssetCreationService(
      fsAdapter,
      classResolver,
      wikilinkValidator,
      shapeRegistry,
    );
  };

  it("ShapeLoader resolves Single cardinality from UID-form wikilink", async () => {
    // Pre-condition for the rest of the suite: without UID resolution,
    // the registry would silently fall back to undefined cardinality and
    // all property emissions would degrade to the default path.
    const registry = await ShapeLoader.loadFromVaultFS(vault);
    const shape = registry.get(
      "https://exocortex.my/ontology/ems#Effort_status",
    );
    expect(shape).toBeDefined();
    expect(shape!.cardinality).toBe("Single");
  });

  it("AC#1: ems__Effort_status (Single cardinality) → scalar form", async () => {
    const service = await buildService();
    const result = await service.create({
      classShortName: TASK_CLASS_UID,
      label: "TEST-3179-single",
      vault,
      properties: {
        ems__Effort_status: `[[${STATUS_BACKLOG_UID}]]`,
      },
      skipWikilinkValidation: true,
    });

    expect(result.frontmatter["ems__Effort_status"]).toBe(
      `"[[${STATUS_BACKLOG_UID}]]"`,
    );

    const content = fs.readFileSync(
      path.join(vault, result.path),
      "utf-8",
    );
    expect(content).toContain(
      `ems__Effort_status: "[[${STATUS_BACKLOG_UID}]]"`,
    );
    expect(content).not.toMatch(
      /ems__Effort_status:\s*\n\s*-\s+"\[\[/,
    );
  });

  it("AC#2: undeclared property → scalar (vault convention default)", async () => {
    const service = await buildService();
    const result = await service.create({
      classShortName: TASK_CLASS_UID,
      label: "TEST-3179-default",
      vault,
      properties: {
        ems__Effort_unknown: `[[${STATUS_BACKLOG_UID}]]`,
      },
      skipWikilinkValidation: true,
    });

    expect(result.frontmatter["ems__Effort_unknown"]).toBe(
      `"[[${STATUS_BACKLOG_UID}]]"`,
    );
  });

  it("AC#1: ems__Effort_relatesTo (Multiple cardinality) → array form", async () => {
    const service = await buildService();
    const result = await service.create({
      classShortName: TASK_CLASS_UID,
      label: "TEST-3179-multi",
      vault,
      properties: {
        ems__Effort_relatesTo: `[[${STATUS_BACKLOG_UID}]]`,
      },
      skipWikilinkValidation: true,
    });

    expect(result.frontmatter["ems__Effort_relatesTo"]).toEqual([
      `"[[${STATUS_BACKLOG_UID}]]"`,
    ]);

    const content = fs.readFileSync(
      path.join(vault, result.path),
      "utf-8",
    );
    expect(content).toMatch(
      /ems__Effort_relatesTo:\s*\n\s*-\s+"\[\[753a44d5/,
    );
  });

  it("AC#3 regression: exo__Instance_class + aliases stay as arrays", async () => {
    const service = await buildService();
    const result = await service.create({
      classShortName: TASK_CLASS_UID,
      label: "TEST-3179-regression",
      vault,
      aliases: ["alt-label"],
      skipWikilinkValidation: true,
    });

    expect(Array.isArray(result.frontmatter["exo__Instance_class"])).toBe(
      true,
    );
    expect(Array.isArray(result.frontmatter["aliases"])).toBe(true);
  });
});
