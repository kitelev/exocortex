/**
 * RFC exo__Layout Phase 3 — docs example CI gate (M5 usability).
 *
 * Parallel to `docs-example-renders.spec.tsx` (RelationColumnSet gate): reads
 * `docs/EXO_LAYOUT.md`, extracts the two ```yaml fenced blocks (Layout +
 * BacklinksTableBlock) from the Quickstart section, parses each through the
 * production factories (`createLayoutFromFrontmatter` /
 * `createLayoutBlockFromFrontmatter`), and mounts `BacklinksTableBlockView`
 * with the parsed block's columns.  If someone edits the docs in a way that
 * silently breaks the copy-pasteable example, this test fails in CI — the
 * RFC M5 "falsifiable usability" guarantee extended to Layout.
 */

import { test, expect } from "@playwright/experimental-ct-react";
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import React from "react";

import {
  createLayoutFromFrontmatter,
  createLayoutBlockFromFrontmatter,
  isBacklinksTableBlock,
  type Layout,
  type LayoutBlock,
} from "../../../exocortex/src/domain/layout";

import { BacklinksTableBlockView } from "../../src/presentation/components/LayoutBlocks";
import type { AssetRelation } from "../../src/presentation/renderers/layout/types";

const DOCS_PATH = path.resolve(__dirname, "../../docs/EXO_LAYOUT.md");
const YAML_FENCE = /```yaml\n([\s\S]+?)\n```/g;

function stripObsidianFences(raw: string): string {
  // The docs YAML blocks are wrapped in Obsidian-style `---` fences for
  // copy-paste fidelity.  js-yaml treats each `---` as a document separator,
  // so strip the leading/trailing fences before parsing.
  return raw.replace(/^---\s*\n/, "").replace(/\n---\s*$/, "");
}

function loadDocsYamlBlocks(): Record<string, unknown>[] {
  const md = fs.readFileSync(DOCS_PATH, "utf8");
  const blocks: Record<string, unknown>[] = [];
  for (const match of md.matchAll(YAML_FENCE)) {
    const parsed = yaml.load(stripObsidianFences(match[1])) as Record<
      string,
      unknown
    >;
    blocks.push(parsed);
  }
  if (blocks.length < 2) {
    throw new Error(
      `exo-layout-docs-renders: expected ≥2 \`\`\`yaml blocks in ${DOCS_PATH}, found ${blocks.length}`,
    );
  }
  return blocks;
}

const WEEK_CREATED = new Date("2026-03-01T00:00:00Z").getTime();

const weeklyObjectiveRows: AssetRelation[] = [
  {
    path: "Objectives/wo-1.md",
    title: "Ship RFC exo__Layout Phase 3",
    propertyName: "ems__WeeklyObjective__week",
    isBodyLink: false,
    created: WEEK_CREATED + 10 * 60_000,
    modified: WEEK_CREATED + 60 * 60_000,
    metadata: {
      exo__Instance_class: ["[[ems__WeeklyObjective]]"],
      exo__Asset_label: "Ship RFC exo__Layout Phase 3",
      exo__Asset_createdAt: "2026-03-01T00:10:00+0500",
    },
    file: { path: "Objectives/wo-1.md", basename: "wo-1" },
  } as AssetRelation,
  {
    path: "Objectives/wo-2.md",
    title: "Close defect remediation follow-up",
    propertyName: "ems__WeeklyObjective__week",
    isBodyLink: false,
    created: WEEK_CREATED + 20 * 60_000,
    modified: WEEK_CREATED + 30 * 60_000,
    metadata: {
      exo__Instance_class: ["[[ems__WeeklyObjective]]"],
      exo__Asset_label: "Close defect remediation follow-up",
      exo__Asset_createdAt: "2026-03-01T00:20:00+0500",
    },
    file: { path: "Objectives/wo-2.md", basename: "wo-2" },
  } as AssetRelation,
];

test.describe("docs/EXO_LAYOUT.md example renders", () => {
  test("Quickstart YAML parses into a valid Layout + BacklinksTableBlock; BacklinksTableBlockView renders exactly the declared columns", async ({
    mount,
  }) => {
    const [layoutFm, blockFm] = loadDocsYamlBlocks();

    const layout = createLayoutFromFrontmatter(layoutFm, {
      sourcePath: DOCS_PATH,
      warn: (msg) => {
        throw new Error(`docs Layout parse warning: ${msg}`);
      },
    });
    if (layout === null) {
      throw new Error(
        `docs Layout parse returned null for first YAML block in ${DOCS_PATH}`,
      );
    }
    expect(layout.targetClass).toBe("period__Week");
    expect(layout.coexistsWithDefault).toBe(false);
    expect(layout.blocks.length).toBe(1);

    const block: LayoutBlock | null = createLayoutBlockFromFrontmatter(blockFm, {
      sourcePath: DOCS_PATH,
      warn: (msg) => {
        throw new Error(`docs LayoutBlock parse warning: ${msg}`);
      },
    });
    if (block === null || !isBacklinksTableBlock(block)) {
      throw new Error(
        `docs Quickstart second YAML block must be an exo__BacklinksTableBlock`,
      );
    }

    // The Layout references the block by uid (post-normalisation).
    expect(layout.blocks[0]).toBe(block.uid);

    // Post-parse columns are normalised to bare property names so the renderer
    // can index frontmatter directly without further transform.
    expect(block.columns).toEqual([
      "exo__Asset_createdAt",
      "exo__Asset_label",
    ]);
    expect(block.rowClass).toBe("ems__WeeklyObjective");
    expect(block.referencingProperty).toBe("ems__WeeklyObjective__week");

    const component = await mount(
      <BacklinksTableBlockView
        title={block.title}
        columns={[...block.columns]}
        rows={weeklyObjectiveRows}
      />,
    );

    const headers = component.getByRole("columnheader");
    await expect(headers).toHaveCount(2);
    await expect(
      component.getByRole("columnheader", { name: "exo__Asset_createdAt" }),
    ).toBeVisible();
    await expect(
      component.getByRole("columnheader", { name: "exo__Asset_label" }),
    ).toBeVisible();

    // Must NOT contain the default Asset Relations columns.
    await expect(
      component.getByRole("columnheader", { name: /^Name$/i }),
    ).toHaveCount(0);
    await expect(
      component.getByRole("columnheader", { name: /Instance Class/i }),
    ).toHaveCount(0);

    // Row count matches fixture; columns render the declared frontmatter values.
    await expect(component.locator("tbody tr")).toHaveCount(
      weeklyObjectiveRows.length,
    );
    await expect(
      component.getByText("Ship RFC exo__Layout Phase 3"),
    ).toBeVisible();
  });
});
