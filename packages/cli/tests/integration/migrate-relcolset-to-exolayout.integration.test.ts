/**
 * Integration test for the RelColSet → exo__Layout migration transform
 * against a real tmp-dir vault.
 *
 * Smoke coverage:
 * - Scan a tmp vault for RelColSets (via NodeFsAdapter.findFilesByMetadata).
 * - Transform via RelColSetToExoLayoutMigratorService.
 * - Write Layout+Block pairs via fs (simulates --apply).
 * - Re-read and verify the two generated files land in the expected folder
 *   and carry the expected frontmatter.
 *
 * This test exercises the service + adapter wiring without shelling out to
 * dist/index.js (which the existing `convert.integration.test.ts` skips in
 * CI). It is hermetic and runs in CI.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import yaml from "js-yaml";
import { NodeFsAdapter } from "../../src/adapters/NodeFsAdapter.js";
import {
  RelColSetToExoLayoutMigratorService,
  extractRelColSetConfig,
  isRelColSetFrontmatter,
} from "../../src/services/RelColSetToExoLayoutMigratorService.js";

function stubUidFor(seed: string, suffix: "layout" | "block"): string {
  return `00000000-${suffix === "layout" ? "1111" : "2222"}-4444-8888-${seed.slice(0, 12).padEnd(12, "0")}`;
}

function writeAsset(
  dir: string,
  filename: string,
  frontmatter: Record<string, unknown>,
): void {
  const body = `---\n${yaml.dump(frontmatter).trimEnd()}\n---\n`;
  fs.writeFileSync(path.join(dir, filename), body, "utf-8");
}

function readFrontmatter(filePath: string): Record<string, unknown> {
  const content = fs.readFileSync(filePath, "utf-8");
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) throw new Error(`frontmatter missing in ${filePath}`);
  return yaml.load(match[1]) as Record<string, unknown>;
}

describe("migrate-relcolset-to-exolayout — integration", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-migrate-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("transforms a RelColSet in the tmp vault into a Layout+Block pair and writes both files", async () => {
    // Arrange: seed vault with 1 RelColSet + 1 unrelated asset.
    const uiDir = path.join(tempDir, "ui");
    fs.mkdirSync(uiDir, { recursive: true });
    writeAsset(uiDir, "rc-1.md", {
      exo__Asset_uid: "abc12345-1111-1111-1111-aaaaaaaaaaaa",
      exo__Asset_label: "Tasks on Projects",
      exo__Instance_class: ["[[ui__RelationColumnSet]]"],
      ui__RelationColumnSet_targetClass: "[[ems__Task]]",
      ui__RelationColumnSet_referencingProperty: "[[ems__Task_parent]]",
      ui__RelationColumnSet_columns: [
        "[[ems__Effort_status]]",
        "[[exo__Asset_label]]",
      ],
      ui__RelationColumnSet_priority: 10,
    });
    writeAsset(tempDir, "unrelated.md", {
      exo__Asset_uid: "bbb22345-1111-1111-1111-cccccccccccc",
      exo__Instance_class: ["[[ems__Task]]"],
    });

    const adapter = new NodeFsAdapter(tempDir);
    const service = new RelColSetToExoLayoutMigratorService({
      uidFor: stubUidFor,
    });

    // Act: scan, transform, apply.
    const allFiles = await adapter.getMarkdownFiles();
    const configs = [];
    for (const file of allFiles) {
      const fm = await adapter.getFileMetadata(file);
      if (!isRelColSetFrontmatter(fm)) continue;
      const cfg = extractRelColSetConfig(file, fm);
      if (cfg !== null) configs.push(cfg);
    }
    const result = service.migrate(configs);

    const outDir = "exo-layout-migrated";
    for (const pair of result.pairs) {
      await adapter.writeFile(
        `${outDir}/${pair.layout.filename}`,
        pair.layout.content,
      );
      await adapter.writeFile(
        `${outDir}/${pair.block.filename}`,
        pair.block.content,
      );
    }

    // Assert
    expect(result.pairs).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);

    const pair = result.pairs[0];
    const layoutOnDisk = path.join(tempDir, outDir, pair.layout.filename);
    const blockOnDisk = path.join(tempDir, outDir, pair.block.filename);
    expect(fs.existsSync(layoutOnDisk)).toBe(true);
    expect(fs.existsSync(blockOnDisk)).toBe(true);

    const layoutFm = readFrontmatter(layoutOnDisk);
    expect(layoutFm["exo__Asset_uid"]).toBe(pair.layout.uid);
    expect(layoutFm["exo__Instance_class"]).toEqual(["[[exo__Layout]]"]);
    expect(layoutFm["exo__Layout_targetClass"]).toBe("[[ems__Task]]");
    expect(layoutFm["exo__Layout_blocks"]).toEqual([`[[${pair.block.uid}]]`]);
    expect(layoutFm["exo__Layout_priority"]).toBe(10);
    expect(layoutFm["exo__Layout_coexistsWithDefault"]).toBe(true);

    const blockFm = readFrontmatter(blockOnDisk);
    expect(blockFm["exo__Asset_uid"]).toBe(pair.block.uid);
    expect(blockFm["exo__Instance_class"]).toEqual([
      "[[exo__BacklinksTableBlock]]",
    ]);
    expect(blockFm["exo__BacklinksTableBlock_rowClass"]).toBe("[[ems__Task]]");
    expect(blockFm["exo__BacklinksTableBlock_referencingProperty"]).toBe(
      "[[ems__Task_parent]]",
    );
    expect(blockFm["exo__BacklinksTableBlock_columns"]).toEqual([
      "[[ems__Effort_status]]",
      "[[exo__Asset_label]]",
    ]);
  });

  it("produces zero pairs when vault has no RelColSets", async () => {
    writeAsset(tempDir, "task.md", {
      exo__Asset_uid: "eee12345-1111-1111-1111-ffffffffffff",
      exo__Instance_class: ["[[ems__Task]]"],
    });

    const adapter = new NodeFsAdapter(tempDir);
    const service = new RelColSetToExoLayoutMigratorService({
      uidFor: stubUidFor,
    });

    const allFiles = await adapter.getMarkdownFiles();
    const configs = [];
    for (const file of allFiles) {
      const fm = await adapter.getFileMetadata(file);
      if (!isRelColSetFrontmatter(fm)) continue;
      const cfg = extractRelColSetConfig(file, fm);
      if (cfg !== null) configs.push(cfg);
    }
    const result = service.migrate(configs);

    expect(result.pairs).toHaveLength(0);
  });
});
