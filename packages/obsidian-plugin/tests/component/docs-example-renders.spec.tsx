/**
 * RFC be70f741 Phase 4 — docs example CI gate (M5 usability).
 *
 * Reads `docs/RELATION_COLUMN_SET.md`, extracts the ```yaml fenced block,
 * parses it through the same pipeline production uses
 * (`createRelationColumnSetFromFrontmatter` → `RelationColumnSetResolver`),
 * and mounts `AssetRelationsTable` with the resolver-derived columns.  If
 * anyone edits the docs in a way that silently breaks the copy-pasteable
 * example, this test fails in CI — the RFC M5 "falsifiable usability"
 * guarantee.
 */

import { test, expect } from "@playwright/experimental-ct-react";
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import React from "react";

import {
  createRelationColumnSetFromFrontmatter,
  type RelationColumnSet,
} from "../../../exocortex/src/domain/layout/RelationColumnSet";
import { RelationColumnSetResolver } from "../../../exocortex/src/application/services/RelationColumnSetResolver";

import { AssetRelationsTable } from "../../src/presentation/components/AssetRelationsTable";
import { happyPathRelations } from "./fixtures/relation-column-set";

const DOCS_PATH = path.resolve(__dirname, "../../docs/RELATION_COLUMN_SET.md");
const YAML_FENCE = /```yaml\n([\s\S]+?)\n```/;
const ROW_CLASSES = ["[[ems__WeeklyObjective]]"];
const GROUP_PROP = "[[ems__WeeklyObjective__week]]";

function loadDocsConfig(): RelationColumnSet {
  const md = fs.readFileSync(DOCS_PATH, "utf8");
  const match = md.match(YAML_FENCE);
  if (!match) {
    throw new Error(
      `docs-example-renders: no \`\`\`yaml\\n…\\n\`\`\` block found in ${DOCS_PATH}`,
    );
  }
  // The docs block is wrapped in Obsidian-style `---` fences inside the YAML
  // code block (for copy-paste fidelity).  js-yaml treats each `---` as a
  // document separator, so strip the leading/trailing fences before parsing.
  const stripped = match[1].replace(/^---\s*\n/, "").replace(/\n---\s*$/, "");
  const frontmatter = yaml.load(stripped) as Record<string, unknown>;
  const parsed = createRelationColumnSetFromFrontmatter(frontmatter, {
    sourcePath: DOCS_PATH,
    warn: (msg) => {
      // Surface any parse warning as a hard failure — the docs example must
      // validate cleanly under exactly the rules the runtime enforces.
      throw new Error(`docs-example-renders: parse warning: ${msg}`);
    },
  });
  if (!parsed) {
    throw new Error(
      `docs-example-renders: createRelationColumnSetFromFrontmatter returned null for docs YAML`,
    );
  }
  return parsed;
}

test.describe("docs/RELATION_COLUMN_SET.md example renders", () => {
  test("resolver picks docs-example config for WeeklyObjective → Week + AssetRelationsTable shows its columns", async ({
    mount,
  }) => {
    const docsConfig = loadDocsConfig();

    expect(docsConfig.targetClasses).toEqual(["ems__WeeklyObjective"]);
    expect(docsConfig.referencingProperty).toBe("ems__WeeklyObjective__week");
    // Post issue #2942: columns are normalized to bare property names during
    // parse, so the renderer can index frontmatter directly with no transform.
    expect(docsConfig.columns).toEqual([
      "exo__Asset_createdAt",
      "exo__Asset_label",
    ]);

    const resolver = new RelationColumnSetResolver(() => [docsConfig]);
    const resolved = resolver.resolve(ROW_CLASSES, GROUP_PROP);
    expect(resolved?.uid).toBe(docsConfig.uid);

    const groupSpecificProperties = {
      ems__WeeklyObjective__week: [...resolved!.columns],
    };

    const component = await mount(
      <AssetRelationsTable
        relations={happyPathRelations}
        groupByProperty={true}
        groupSpecificProperties={groupSpecificProperties}
      />,
    );

    await expect(
      component.getByRole("columnheader", { name: /Createdat/i }),
    ).toBeVisible();
    await expect(
      component.getByRole("columnheader", { name: /Label/i }),
    ).toBeVisible();
    await expect(component.locator("tbody tr")).toHaveCount(
      happyPathRelations.length,
    );
  });
});
