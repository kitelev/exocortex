#!/usr/bin/env node
// RFC 94e520da Phase 6 / T6.2 — generate per-grounding `expected.json` fixtures
// + a single `groundings.feature` Scenario Outline with 48 examples.
//
// Inputs:
//   - docs/rfc-94e520da/starter-kit-grounding-status.json   (T1.5 audit output)
//   - exocortex-starter-kit/exocmd/**/*.md                  (per-grounding details)
//
// Outputs:
//   - packages/cli/specs/fixtures/groundings/<uid>.expected.json   (48 files)
//   - packages/cli/specs/features/groundings.feature               (1 outline, 48 rows)

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const yaml = require("js-yaml");

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const auditPath = resolve(
  repoRoot,
  "docs/rfc-94e520da/starter-kit-grounding-status.json",
);
// Default points to the sibling starter-kit checkout used both in main repo
// and worktrees (parent of `worktrees/`). Override with --starter-kit <path>.
const argv = process.argv.slice(2);
let starterKitOverride = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--starter-kit") starterKitOverride = argv[++i];
}
const starterKitRoot =
  starterKitOverride ??
  resolve(repoRoot, "..", "exocortex-starter-kit");
const fallbackStarterKit = resolve(
  repoRoot,
  "..",
  "..",
  "exocortex-starter-kit",
);
const fixtureDir = resolve(
  repoRoot,
  "packages/cli/specs/fixtures/groundings",
);
const featurePath = resolve(
  repoRoot,
  "packages/cli/specs/features/groundings.feature",
);

// --- frontmatter parser (minimal — handles starter-kit shape only) ---

function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  try {
    const parsed = yaml.load(m[1]);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function stripOuterQuotes(s) {
  if (typeof s !== "string" || s.length < 2) return s;
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

function normalizeWikilink(value) {
  if (typeof value !== "string") return "";
  const stripped = value.replace(/["'[\]]/g, "").trim();
  const pipe = stripped.indexOf("|");
  return pipe >= 0 ? stripped.slice(0, pipe).trim() : stripped;
}

// --- locate grounding file in starter-kit by uid ---

async function buildUidIndex(rootDir) {
  const idx = new Map();
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        await walk(p);
      } else if (e.isFile() && e.name.endsWith(".md")) {
        const txt = await readFile(p, "utf8");
        const m = txt.match(/^exo__Asset_uid:\s*([0-9a-f-]+)/m);
        if (m) idx.set(m[1], p);
      }
    }
  }
  await walk(join(rootDir, "exocmd"));
  return idx;
}

// --- userInput defaults per service / per substitution token ---

function inferUserInput(grounding, fm) {
  const input = {};
  // $input / $value substitution in targetValue
  const targetValue = fm.exocmd__Grounding_targetValue ?? "";
  if (/\$(input|value)\b/.test(targetValue)) {
    input.value = "bdd-input-value";
  }
  // service_call services that consume `value` from inputSchema:
  // updateProperty (link-to-parent), createRelatedTask, createRelatedProject etc.
  const serviceId = fm.exocmd__Grounding_serviceId;
  if (
    serviceId === "updateProperty" &&
    /"value"\s*:/.test(fm.exocmd__Grounding_inputSchema ?? "")
  ) {
    input.value = input.value ?? "[[bdd-parent-asset]]";
  }
  if (
    serviceId === "createRelatedTask" ||
    serviceId === "createRelatedProject" ||
    grounding.type === "create_instance"
  ) {
    input.label = "BDD Test";
  }
  return Object.keys(input).length > 0 ? input : null;
}

// --- expected outcome per cliStatus + grounding type ---

function buildExpect(grounding, fm) {
  const { type, cliStatus, serviceId } = grounding;
  // service_call stub → fail-loud CliServiceNotImplementedError
  if (cliStatus === "stub") {
    return {
      outcome: "failure",
      errorPattern: `Service \\"${serviceId}\\" is not implemented`,
    };
  }
  // service_call unregistered → "Service not found: <id>"
  if (cliStatus === "unregistered") {
    return {
      outcome: "failure",
      errorPattern: `Service not found: \\"${serviceId}\\"`,
    };
  }
  // Real groundings — verify success and (where cheaply possible) the
  // observable frontmatter delta on the test target.
  const expect = { outcome: "success" };
  if (type === "property_set") {
    // FrontmatterService.updateProperty writes targetValue verbatim into the
    // YAML, so a value like '"[[uuid]]"' (literal quotes from grounding source)
    // round-trips through js-yaml as bare `[[uuid]]`. Strip one quote layer
    // so the fixture matches what the test reads back via yaml.load.
    let raw = fm.exocmd__Grounding_targetValue;
    if (typeof raw === "string") {
      raw = stripOuterQuotes(raw);
    }
    expect.frontmatterAfter = {
      [fm.exocmd__Grounding_targetProperty]: substituteTokens(raw),
    };
  } else if (type === "property_delete") {
    expect.frontmatterRemoved = [fm.exocmd__Grounding_targetProperty];
  }
  return expect;
}

// Best-effort token substitution recorder — used only for fixture authoring,
// step layer performs the *actual* substitution at runtime against $now.
function substituteTokens(value) {
  if (typeof value !== "string") return value;
  // We assert via regex match in the step layer for $-token values.
  if (/\$(now|nowLocal|today|target|input|value)\b/.test(value)) {
    return { __regex: tokenRegex(value) };
  }
  return value;
}

function tokenRegex(raw) {
  // Convert literal -> regex, replacing tokens with permissive patterns.
  // `\b` (word boundary) is the regex anchor, not the two-char string `\b`.
  let escaped = raw.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  escaped = escaped
    .replace(/\\\$nowLocal\b/g, "\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}")
    .replace(/\\\$now\b/g, "\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}.*")
    .replace(/\\\$today\b/g, "\\d{4}-\\d{2}-\\d{2}")
    .replace(/\\\$target\b/g, ".+")
    .replace(/\\\$input\b/g, ".+")
    .replace(/\\\$value\b/g, ".+");
  return `^${escaped}$`;
}

// --- main ---

async function main() {
  const audit = JSON.parse(await readFile(auditPath, "utf8"));
  const groundings = audit.groundings;
  if (groundings.length !== 48) {
    console.warn(
      `[gen-bdd] expected 48 groundings in audit, got ${groundings.length}`,
    );
  }

  let resolvedStarterKit = starterKitRoot;
  try {
    await readdir(join(resolvedStarterKit, "exocmd"));
  } catch {
    resolvedStarterKit = fallbackStarterKit;
  }
  const uidIndex = await buildUidIndex(resolvedStarterKit);
  await mkdir(fixtureDir, { recursive: true });

  const examplesRows = [];
  for (const g of groundings) {
    const path = uidIndex.get(g.uid);
    if (!path) {
      throw new Error(
        `[gen-bdd] grounding ${g.uid} listed in audit but not found in starter-kit`,
      );
    }
    const text = await readFile(path, "utf8");
    const fm = parseFrontmatter(text);
    const fixture = {
      uid: g.uid,
      label: g.label,
      type: g.type,
      cliStatus: g.cliStatus,
      serviceId: g.serviceId,
      sourcePath: g.path,
      userInput: inferUserInput(g, fm),
      expect: buildExpect(g, fm),
    };
    if (g.type === "create_instance") {
      fixture.targetClass = fm.exocmd__Grounding_targetClass;
      fixture.targetFolder = fm.exocmd__Grounding_targetFolder;
    }
    if (g.type === "composite") {
      // resolve sub-step uids via Grounding_steps wikilinks
      const steps = fm.exocmd__Grounding_steps;
      fixture.compositeStepUids = Array.isArray(steps)
        ? steps.map(normalizeWikilink)
        : [];
    }
    await writeFile(
      join(fixtureDir, `${g.uid}.expected.json`),
      JSON.stringify(fixture, null, 2) + "\n",
      "utf8",
    );
    const safeLabel = (g.label ?? "").replace(/\|/g, "\\|");
    examplesRows.push(
      `      | ${g.uid} | ${g.type.padEnd(15)} | ${(g.cliStatus + "").padEnd(12)} | ${safeLabel} |`,
    );
  }

  const featureBody = `Feature: Starter-kit grounding execution (RFC 94e520da § Phase 6)
  As an Exocortex CLI user
  I want every starter-kit grounding to behave deterministically when invoked via dyncommand exec
  So that any regression breaking a grounding is caught by the test-bdd CI gate

  All 48 starter-kit groundings (T1.5 audit) are exercised. Per-grounding
  expected outcomes live in packages/cli/specs/fixtures/groundings/<uid>.expected.json.

  Background:
    Given the starter-kit fixture vault is initialized

  Scenario Outline: Grounding "<label>" (<uid>)
    Given a fresh test target asset in the fixture vault
    When I exec grounding "<uid>" via the CLI grounding executor
    Then the result should match the expected fixture for "<uid>"

    Examples:
      | uid | type | cliStatus | label |
${examplesRows.join("\n")}
`;

  await mkdir(dirname(featurePath), { recursive: true });
  await writeFile(featurePath, featureBody, "utf8");

  console.log(
    `[gen-bdd] wrote ${groundings.length} fixtures + ${featurePath}`,
  );
}

await main();
