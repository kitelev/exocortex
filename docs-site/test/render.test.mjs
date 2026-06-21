import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escapeHtml,
  mdToHtml,
  statusBadge,
  coverageBadge,
  requirementPage,
  adrPage,
  indexPage,
  safeSegment,
} from "../lib/render.mjs";

test("safeSegment is identity for real ids but strips path separators", () => {
  assert.equal(safeSegment("14b1c592-9879-4523-bc6e-5cebd81d4ac4"), "14b1c592-9879-4523-bc6e-5cebd81d4ac4");
  assert.equal(safeSegment("ARCH-001"), "ARCH-001"); // case preserved
  assert.equal(safeSegment("../../etc/passwd"), "..-..-etc-passwd"); // no separators survive
  assert.doesNotMatch(safeSegment("../../etc/x"), /\//);
  assert.equal(safeSegment(".."), "_invalid_");
  assert.equal(safeSegment(""), "_invalid_");
});

test("escapeHtml neutralizes injection characters", () => {
  assert.equal(escapeHtml(`<script>"&'`), "&lt;script&gt;&quot;&amp;&#39;");
});

test("mdToHtml renders fenced gherkin code blocks", () => {
  const html = mdToHtml("```gherkin\nGiven x\nWhen y\nThen z\n```");
  assert.match(html, /<pre><code class="language-gherkin">/);
  assert.match(html, /Given x/);
});

test("mdToHtml renders GFM tables", () => {
  const html = mdToHtml("| A | B |\n|---|---|\n| 1 | 2 |");
  assert.match(html, /<table>/);
  assert.match(html, /<td>1<\/td>/);
});

test("statusBadge colors by lifecycle status", () => {
  assert.match(statusBadge("Approved"), /badge-ok/);
  assert.match(statusBadge("Draft"), /badge-warn/);
  assert.match(statusBadge("Deprecated"), /badge-muted/);
});

test("coverageBadge reflects covered/uncovered", () => {
  assert.match(coverageBadge(true, 2), /covered/);
  assert.match(coverageBadge(false, 0), /uncovered/);
});

test("requirementPage renders status, gherkin body, and coverage", () => {
  const req = {
    uid: "u1",
    label: "req: thing happens",
    file: "u1.md",
    status: "Approved",
    priority: "P0",
    bindingClasses: ["integration"],
    covers: ["the behaviour"],
    verifiedBy: ["a.test.ts::case"],
    implementedBy: ["Service.method"],
    area: "Exocortex",
    author: "ExoAssistant",
    covered: true,
    body: "## Statement (Gherkin)\n\n```gherkin\nGiven a\nWhen b\nThen c\n```",
  };
  const html = requirementPage(req);
  assert.match(html, /req: thing happens/);
  assert.match(html, /badge-ok/); // Approved + covered
  assert.match(html, /language-gherkin/);
  assert.match(html, /Given a/);
  assert.match(html, /a\.test\.ts::case/); // verifiedBy listed
  assert.match(html, /the behaviour/); // covers listed
  assert.match(html, /\.\.\/assets\/style\.css/); // subpage relative asset path
});

test("requirementPage escapes a label with HTML metacharacters", () => {
  const req = {
    uid: "u2",
    label: "req: a < b && c",
    file: "u2.md",
    status: "Draft",
    priority: null,
    bindingClasses: [],
    covers: [],
    verifiedBy: [],
    implementedBy: [],
    area: null,
    author: null,
    covered: false,
    body: "x",
  };
  const html = requirementPage(req);
  assert.match(html, /a &lt; b &amp;&amp; c/);
  assert.doesNotMatch(html, /a < b && c/);
});

test("adrPage renders enforcement badge from rules flag", () => {
  const enforced = adrPage({
    id: "ARCH-008",
    title: "Clean Arch",
    domain: "architecture",
    rules: true,
    file: "x.md",
    body: "# Clean Arch\n\ntext",
  });
  assert.match(enforced, /enforced/);
  const documented = adrPage({
    id: "DOC-001",
    title: "Docs",
    domain: "quality",
    rules: false,
    file: "y.md",
    body: "text",
  });
  assert.match(documented, /documented/);
});

test("indexPage renders summary tables + links", () => {
  const reqs = [
    {
      uid: "u1",
      label: "req one",
      status: "Approved",
      priority: "P0",
      verifiedBy: ["t"],
      covered: true,
    },
  ];
  const adrs = [{ id: "ARCH-001", title: "Filenames", domain: "data", rules: false }];
  const stats = { total: 1, covered: 1, coverage: 1, byStatus: { Approved: 1 }, byPriority: { P0: 1 } };
  const html = indexPage({ reqs, adrs, stats, ontology: { classes: [], properties: [] } });
  assert.match(html, /requirements\/u1\.html/);
  assert.match(html, /adrs\/ARCH-001\.html/);
  assert.match(html, /100%/); // coverage stat
  assert.match(html, /req one/);
});
