import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSite } from "../lib/site.mjs";

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), "livingdocs-"));
  const reqs = join(root, "reqs");
  const archgate = join(root, ".archgate");
  await mkdir(reqs, { recursive: true });
  await mkdir(join(archgate, "adrs"), { recursive: true });
  await writeFile(
    join(reqs, "11111111-1111-1111-1111-111111111111.md"),
    `---
exo__Asset_uid: 11111111-1111-1111-1111-111111111111
exo__Asset_label: "req: a thing must happen"
req__Requirement_status: "[[u|req__RequirementStatusApproved]]"
req__Requirement_priority: "[[u|req__RequirementPriorityP0]]"
req__Requirement_bindingClass:
  - "[[u|req__RequirementBindingClassIntegration]]"
req__Requirement_verifiedBy:
  - "x.test.ts::case"
---
## Statement (Gherkin)

\`\`\`gherkin
Given a
When b
Then c
\`\`\`
`,
  );
  // A non-requirement asset (anchor) — must be ignored.
  await writeFile(join(reqs, "anchor.md"), `---\nexo__Asset_label: "$reqs"\n---\nanchor`);
  await writeFile(
    join(archgate, "adrs", "ARCH-001-x.md"),
    `---\nid: ARCH-001\ntitle: A Decision\ndomain: data\nrules: true\n---\n# A Decision\n\n## Context\n\nbecause.`,
  );
  // A companion rules file — must be ignored by the ADR loader.
  await writeFile(join(archgate, "adrs", "ARCH-001-x.rules.ts"), `export const x = 1;`);
  return { root, reqs, archgate };
}

test("buildSite emits a complete static site from fixtures", async () => {
  const { root, reqs, archgate } = await makeFixture();
  const out = join(root, "_site");
  try {
    const summary = await buildSite({ reqs, archgate, out });

    assert.equal(summary.requirements, 1, "the anchor asset must be excluded");
    assert.equal(summary.adrs, 1, "the .rules.ts companion must be excluded");

    // Jekyll-free marker + stylesheet present.
    assert.ok(existsSync(join(out, ".nojekyll")));
    assert.ok(existsSync(join(out, "assets/style.css")));

    const index = await readFile(join(out, "index.html"), "utf-8");
    assert.match(index, /req: a thing must happen/);
    assert.match(index, /requirements\/11111111-1111-1111-1111-111111111111\.html/);
    assert.match(index, /adrs\/ARCH-001\.html/);
    assert.match(index, /by construction/i); // privacy lede

    const reqPage = await readFile(
      join(out, "requirements/11111111-1111-1111-1111-111111111111.html"),
      "utf-8",
    );
    assert.match(reqPage, /language-gherkin/);
    assert.match(reqPage, /Given a/);
    assert.match(reqPage, /covered/); // coverage badge

    const adr = await readFile(join(out, "adrs/ARCH-001.html"), "utf-8");
    assert.match(adr, /A Decision/);
    assert.match(adr, /enforced/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("buildSite is idempotent / cleans output dir", async () => {
  const { root, reqs, archgate } = await makeFixture();
  const out = join(root, "_site");
  try {
    await buildSite({ reqs, archgate, out });
    // Stray file from a prior build must be removed by the clean step.
    await writeFile(join(out, "stale.html"), "old");
    await buildSite({ reqs, archgate, out });
    assert.ok(!existsSync(join(out, "stale.html")), "stale output must be cleaned");
    assert.ok(existsSync(join(out, "index.html")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
