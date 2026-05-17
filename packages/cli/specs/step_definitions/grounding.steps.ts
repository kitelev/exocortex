import {
  Given,
  When,
  Then,
  Before,
  BeforeAll,
  AfterAll,
  setDefaultTimeout,
} from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, cpSync, existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import {
  GroundingExecutor,
  ServiceRegistry,
  GroundingType,
  type GroundingDefinition,
  ArchiveAssetService,
  FixMissingLabelService,
  FolderRepairService,
  GenericAssetCreationService,
  PropertyCleanupService,
  RenameToUidService,
  TaskStatusService,
  EffortStatusWorkflow,
  StatusTimestampService,
} from "exocortex";
import { FileSystemVaultAdapter } from "../../src/adapters/FileSystemVaultAdapter.js";
import { NodeFsAdapter } from "../../src/adapters/NodeFsAdapter.js";
import { populateCliServiceRegistry } from "../../src/services/CliServiceRegistryPopulator.js";
import { CliBddWorld } from "../support/world.js";

setDefaultTimeout(60_000);

const __dirname = dirname(fileURLToPath(import.meta.url));
const specsRoot = resolve(__dirname, "..");
const repoRoot = resolve(specsRoot, "..", "..", "..");
const fixtureDir = join(specsRoot, "fixtures", "groundings");
const testTargetTemplate = join(specsRoot, "fixtures", "test-target.template.md");
const TEST_TARGET_REL = "01 Inbox/bdd-test-target.md";

// Shared fixture vault — populated once by BeforeAll, reused across all 48
// scenarios. Per-scenario `Before` hook restores the test target file from
// the template so each grounding executes against a known shape.
let SHARED_VAULT_PATH: string | null = null;
let UID_INDEX: Map<string, string> = new Map();

function findStarterKit(): string {
  const candidates = [
    resolve(repoRoot, "..", "exocortex-starter-kit"),
    resolve(repoRoot, "..", "..", "exocortex-starter-kit"),
  ];
  for (const c of candidates) {
    if (existsSync(join(c, "exocmd"))) return c;
  }
  throw new Error(
    `Cannot locate exocortex-starter-kit in any of: ${candidates.join(", ")}`,
  );
}

function buildUidIndex(rootDir: string): Map<string, string> {
  const idx = new Map<string, string>();
  function walk(dir: string) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        walk(p);
      } else if (e.isFile() && e.name.endsWith(".md")) {
        try {
          const txt = readFileSync(p, "utf8");
          const m = txt.match(/^exo__Asset_uid:\s*([0-9a-f-]+)/m);
          if (m) idx.set(m[1], p);
        } catch {
          // ignore
        }
      }
    }
  }
  walk(rootDir);
  return idx;
}

function parseFrontmatter(text: string): Record<string, unknown> {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  try {
    // JSON_SCHEMA keeps ISO timestamps as strings instead of coercing them to
    // Date objects — the grounding executor writes `$nowLocal` substitutions
    // verbatim and assertions need to compare against the string form.
    const parsed = yaml.load(m[1], { schema: yaml.JSON_SCHEMA });
    return (typeof parsed === "object" && parsed !== null)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function normalizeWikilink(value: unknown): string {
  if (typeof value !== "string") return "";
  const stripped = value.replace(/["'[\]]/g, "").trim();
  const pipe = stripped.indexOf("|");
  return pipe >= 0 ? stripped.slice(0, pipe).trim() : stripped;
}

function readGroundingDef(uid: string, depth = 0): GroundingDefinition {
  if (depth > 20) {
    throw new Error(`Composite recursion depth exceeded resolving ${uid}`);
  }
  const path = UID_INDEX.get(uid);
  if (!path) throw new Error(`Grounding ${uid} not found in fixture vault`);
  const fm = parseFrontmatter(readFileSync(path, "utf8"));
  const type = fm["exocmd__Grounding_type"] as GroundingType;
  const targetProperty =
    type === "service_call"
      ? (fm["exocmd__Grounding_serviceId"] as string | undefined) ??
        (fm["exocmd__Grounding_targetProperty"] as string | undefined)
      : (fm["exocmd__Grounding_targetProperty"] as string | undefined);
  let steps: GroundingDefinition[] | undefined;
  if (type === "composite") {
    const rawSteps = fm["exocmd__Grounding_steps"];
    if (Array.isArray(rawSteps)) {
      steps = rawSteps.map((ref) => readGroundingDef(normalizeWikilink(ref), depth + 1));
    }
  }
  const incrementByRaw = fm["exocmd__Grounding_incrementBy"];
  let incrementBy: number | undefined;
  if (incrementByRaw !== undefined && incrementByRaw !== null && incrementByRaw !== "") {
    const parsed = Number.parseInt(String(incrementByRaw), 10);
    if (Number.isFinite(parsed)) incrementBy = parsed;
  }
  const propertyDefaultsRaw = fm["exocmd__Grounding_propertyDefaults"];
  let propertyDefaults: Record<string, string> | undefined;
  if (typeof propertyDefaultsRaw === "string" && propertyDefaultsRaw.length > 0) {
    try {
      const parsed = JSON.parse(propertyDefaultsRaw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        propertyDefaults = parsed as Record<string, string>;
      }
    } catch {
      // fail loud at executor layer if needed
    }
  }
  return {
    id: uid,
    label: (fm["exo__Asset_label"] as string) ?? "",
    type,
    targetProperty,
    targetValue: fm["exocmd__Grounding_targetValue"] as string | undefined,
    targetClass: fm["exocmd__Grounding_targetClass"] as string | undefined,
    targetPrototype: fm["exocmd__Grounding_targetPrototype"] as string | undefined,
    targetFolder: fm["exocmd__Grounding_targetFolder"] as string | undefined,
    shiftDelta: fm["exocmd__Grounding_shiftDelta"] as string | undefined,
    incrementBy,
    linkBackProperty: fm["exocmd__Grounding_linkBackProperty"] as string | undefined,
    propertyDefaults,
    steps,
  };
}

interface ExpectedFixture {
  uid: string;
  type: string;
  cliStatus: "real" | "stub" | "unregistered";
  serviceId: string | null;
  userInput: Record<string, unknown> | null;
  expect:
    | { outcome: "success"; frontmatterAfter?: Record<string, unknown>; frontmatterRemoved?: string[] }
    | { outcome: "failure"; errorPattern: string };
}

function loadFixture(uid: string): ExpectedFixture {
  return JSON.parse(readFileSync(join(fixtureDir, `${uid}.expected.json`), "utf8"));
}

function buildExecutor(vaultPath: string): {
  executor: GroundingExecutor;
  serviceRegistry: ServiceRegistry;
} {
  const fsAdapter = new NodeFsAdapter(vaultPath);
  const vaultAdapter = new FileSystemVaultAdapter(vaultPath);
  const serviceRegistry = new ServiceRegistry();
  populateCliServiceRegistry(serviceRegistry, {
    vaultAdapter,
    fsAdapter,
    genericAssetCreationService: new GenericAssetCreationService(vaultAdapter),
    archiveAssetService: new ArchiveAssetService(vaultAdapter),
    propertyCleanupService: new PropertyCleanupService(vaultAdapter),
    fixMissingLabelService: new FixMissingLabelService(vaultAdapter),
    renameToUidService: new RenameToUidService(vaultAdapter),
    folderRepairService: new FolderRepairService(vaultAdapter),
    taskStatusService: new TaskStatusService(
      vaultAdapter,
      new EffortStatusWorkflow(),
      new StatusTimestampService(vaultAdapter),
    ),
  });
  const executor = new GroundingExecutor(fsAdapter, fsAdapter, serviceRegistry);
  return { executor, serviceRegistry };
}

function resetTestTarget(vaultPath: string): void {
  const targetAbs = join(vaultPath, TEST_TARGET_REL);
  mkdirSync(dirname(targetAbs), { recursive: true });
  const template = readFileSync(testTargetTemplate, "utf8");
  writeFileSync(targetAbs, template, "utf8");
}

// --- hooks ---

BeforeAll({ timeout: 120_000 }, async function () {
  const starterKit = findStarterKit();
  SHARED_VAULT_PATH = mkdtempSync(join(tmpdir(), "exocortex-bdd-vault-"));
  cpSync(starterKit, SHARED_VAULT_PATH, {
    recursive: true,
    filter: (src) => !src.includes("node_modules") && !src.endsWith(".git"),
  });
  UID_INDEX = buildUidIndex(SHARED_VAULT_PATH);
});

AfterAll(function () {
  if (SHARED_VAULT_PATH) {
    try {
      rmSync(SHARED_VAULT_PATH, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
    SHARED_VAULT_PATH = null;
  }
});

Before(function (this: CliBddWorld) {
  if (!SHARED_VAULT_PATH) throw new Error("Fixture vault not initialized");
  this.fixtureVaultPath = SHARED_VAULT_PATH;
  this.testTargetRelPath = TEST_TARGET_REL;
  resetTestTarget(SHARED_VAULT_PATH);
  this.groundingResult = null;
});

// --- steps ---

Given("the starter-kit fixture vault is initialized", function (this: CliBddWorld) {
  assert.ok(this.fixtureVaultPath, "fixture vault must be initialized by BeforeAll");
  assert.ok(UID_INDEX.size > 0, "uid index must be populated");
});

Given("a fresh test target asset in the fixture vault", function (this: CliBddWorld) {
  assert.ok(this.fixtureVaultPath, "vault path missing");
  const targetAbs = join(this.fixtureVaultPath!, TEST_TARGET_REL);
  assert.ok(existsSync(targetAbs), "test target file must exist after reset");
});

When(
  "I exec grounding {string} via the CLI grounding executor",
  async function (this: CliBddWorld, uid: string) {
    const vault = this.fixtureVaultPath!;
    const fixture = loadFixture(uid);
    const grounding = readGroundingDef(uid);
    // Some service factories (createRelatedTask, archiveAsset, …) call
    // `vault.getAbstractFileByPath(<targetIRI>.md)` directly, expecting the
    // IRI to be a bare vault-relative path (the convention used by the
    // plugin's CommandManager). The path-resolver-based services (update/
    // remove/setStatus) handle both shapes via createCliPathResolver. So we
    // pass the bare path (sans .md) here — works for both code paths.
    const targetIRI = TEST_TARGET_REL.replace(/\.md$/, "");
    const targetAbs = join(vault, TEST_TARGET_REL);

    const before = parseFrontmatter(readFileSync(targetAbs, "utf8"));
    const { executor } = buildExecutor(vault);
    const result = await executor.execute(
      grounding,
      targetIRI,
      TEST_TARGET_REL,
      fixture.userInput ?? undefined,
    );

    let after: Record<string, unknown> = {};
    if (existsSync(targetAbs)) {
      after = parseFrontmatter(readFileSync(targetAbs, "utf8"));
    }
    this.groundingResult = {
      success: result.success,
      error: result.error,
      frontmatterBefore: before,
      frontmatterAfter: after,
    };
  },
);

// --- Task 4.3 — create_instance + linkBackProperty bespoke scenario ---

const LINKBACK_TARGET_REL = "01 Inbox/bdd-linkback-target.md";
const LINKBACK_CREATED_FOLDER = "01 Inbox/bdd-linkback-created";

Given(
  "a Grounding with type {string}",
  function (this: CliBddWorld, type: string) {
    this.groundingDraft = { type };
    // Use a dedicated subfolder for the new instance so we can find it
    // deterministically without scanning the entire vault.
    this.groundingDraft.targetFolder = LINKBACK_CREATED_FOLDER;
    this.customCreatedFrontmatter = null;
  },
);

Given(
  "targetClass {string}",
  function (this: CliBddWorld, targetClass: string) {
    assert.ok(this.groundingDraft, "Grounding draft must be initialized");
    this.groundingDraft!.targetClass = targetClass;
  },
);

Given(
  "linkBackProperty {string}",
  function (this: CliBddWorld, prop: string) {
    assert.ok(this.groundingDraft, "Grounding draft must be initialized");
    this.groundingDraft!.linkBackProperty = prop;
  },
);

Given(
  "a $target {string} with frontmatter {string}",
  function (this: CliBddWorld, _instanceClass: string, fmLine: string) {
    assert.ok(this.fixtureVaultPath, "vault path missing");
    const vault = this.fixtureVaultPath!;
    const targetAbs = join(vault, LINKBACK_TARGET_REL);
    mkdirSync(dirname(targetAbs), { recursive: true });

    const colonIdx = fmLine.indexOf(":");
    assert.ok(colonIdx > 0, `Malformed frontmatter line: ${fmLine}`);
    const key = fmLine.slice(0, colonIdx).trim();
    const rawValue = fmLine.slice(colonIdx + 1).trim();
    // Wrap wikilink values in quotes so YAML keeps them as strings.
    const yamlValue = /^\[\[.*\]\]$/.test(rawValue) ? `"${rawValue}"` : rawValue;

    const content = `---\nexo__Asset_uid: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee\nexo__Asset_label: "Linkback BDD Target"\nexo__Instance_class:\n  - "[[${_instanceClass}]]"\n${key}: ${yamlValue}\n---\n\n# Linkback BDD Target\n`;
    writeFileSync(targetAbs, content, "utf8");
    this.customTargetRelPath = LINKBACK_TARGET_REL;
  },
);

When("I execute the grounding", async function (this: CliBddWorld) {
  assert.ok(this.fixtureVaultPath, "vault path missing");
  assert.ok(this.groundingDraft, "grounding draft missing");
  assert.ok(this.customTargetRelPath, "custom target path missing");
  const vault = this.fixtureVaultPath!;
  const targetRel = this.customTargetRelPath!;
  const targetIRI = targetRel.replace(/\.md$/, "");
  const draft = this.groundingDraft!;

  const grounding: GroundingDefinition = {
    id: "bdd-task-4.3-linkback",
    label: "Task 4.3 — linkBackProperty BDD",
    type: draft.type as GroundingType,
    targetClass: draft.targetClass,
    targetFolder: draft.targetFolder,
    targetPrototype: draft.targetPrototype,
    linkBackProperty: draft.linkBackProperty,
  };

  // Clean any leftover created files from a prior run so we can deterministically
  // find the single new file the executor produces.
  const createdFolderAbs = join(vault, LINKBACK_CREATED_FOLDER);
  if (existsSync(createdFolderAbs)) {
    rmSync(createdFolderAbs, { recursive: true, force: true });
  }

  const { executor } = buildExecutor(vault);
  const result = await executor.execute(grounding, targetIRI, targetRel, undefined);

  this.groundingResult = {
    success: result.success,
    error: result.error,
  };

  if (!result.success) return;

  // Locate the single .md file the executor wrote inside targetFolder.
  assert.ok(existsSync(createdFolderAbs), `targetFolder missing: ${createdFolderAbs}`);
  const created = readdirSync(createdFolderAbs).filter((n) => n.endsWith(".md"));
  assert.equal(created.length, 1, `Expected exactly 1 created file, got ${created.length}`);
  const createdAbs = join(createdFolderAbs, created[0]);
  this.customCreatedFrontmatter = parseFrontmatter(readFileSync(createdAbs, "utf8"));
});

Then(
  "a new {string} is created",
  function (this: CliBddWorld, instanceClass: string) {
    assert.ok(this.groundingResult?.success, `grounding failed: ${this.groundingResult?.error}`);
    assert.ok(this.customCreatedFrontmatter, "created frontmatter missing");
    const cls = this.customCreatedFrontmatter!["exo__Instance_class"];
    const flat = Array.isArray(cls) ? cls.join(",") : String(cls ?? "");
    assert.ok(
      flat.includes(instanceClass),
      `Expected exo__Instance_class to contain ${instanceClass}, got ${flat}`,
    );
  },
);

Then(
  "the created asset has {string}",
  function (this: CliBddWorld, fmLine: string) {
    assert.ok(this.customCreatedFrontmatter, "created frontmatter missing");
    const colonIdx = fmLine.indexOf(":");
    assert.ok(colonIdx > 0, `Malformed frontmatter expectation: ${fmLine}`);
    const key = fmLine.slice(0, colonIdx).trim();
    const expected = fmLine.slice(colonIdx + 1).trim();
    const actualRaw = this.customCreatedFrontmatter![key];
    const actual = typeof actualRaw === "string" ? actualRaw : String(actualRaw);
    // Normalize wikilink shape — copied values are stored as "[[X]]" but the
    // YAML parser strips the wrapping quotes leaving [[X]].
    const normalize = (s: string) => s.replace(/^"|"$/g, "").trim();
    assert.equal(
      normalize(actual),
      normalize(expected),
      `Property ${key} mismatch: expected ${expected}, got ${actualRaw}`,
    );
  },
);

Then(
  "the created asset has {string} pointing to $target",
  function (this: CliBddWorld, key: string) {
    assert.ok(this.customCreatedFrontmatter, "created frontmatter missing");
    assert.ok(this.customTargetRelPath, "custom target path missing");
    const targetIRI = this.customTargetRelPath!.replace(/\.md$/, "");
    const value = this.customCreatedFrontmatter![key];
    const flat = typeof value === "string" ? value : String(value);
    assert.ok(
      flat.includes(targetIRI),
      `Expected ${key} to wikilink-reference ${targetIRI}, got ${flat}`,
    );
  },
);

Then(
  "the created asset does NOT have {string}",
  function (this: CliBddWorld, key: string) {
    assert.ok(this.customCreatedFrontmatter, "created frontmatter missing");
    assert.equal(
      this.customCreatedFrontmatter![key],
      undefined,
      `Property ${key} should be absent, got ${JSON.stringify(this.customCreatedFrontmatter![key])}`,
    );
  },
);

Then(
  "the result should match the expected fixture for {string}",
  function (this: CliBddWorld, uid: string) {
    const fixture = loadFixture(uid);
    const result = this.groundingResult;
    assert.ok(result, "grounding result must be captured");
    if (fixture.expect.outcome === "success") {
      assert.equal(
        result!.success,
        true,
        `Expected success for ${uid} (${fixture.cliStatus} ${fixture.type}), got error: ${result!.error}`,
      );
      // Optional state-delta assertions for property_set/property_delete.
      if ("frontmatterAfter" in fixture.expect && fixture.expect.frontmatterAfter) {
        for (const [key, expectedRaw] of Object.entries(fixture.expect.frontmatterAfter)) {
          const actual = result!.frontmatterAfter?.[key];
          if (
            typeof expectedRaw === "object" &&
            expectedRaw !== null &&
            "__regex" in (expectedRaw as Record<string, unknown>)
          ) {
            const pattern = new RegExp((expectedRaw as { __regex: string }).__regex);
            assert.ok(
              typeof actual === "string" && pattern.test(actual),
              `Property ${key} expected to match ${pattern}, got ${JSON.stringify(actual)}`,
            );
          } else {
            assert.equal(
              actual,
              expectedRaw,
              `Property ${key} mismatch on ${uid}`,
            );
          }
        }
      }
      if ("frontmatterRemoved" in fixture.expect && fixture.expect.frontmatterRemoved) {
        for (const key of fixture.expect.frontmatterRemoved) {
          assert.equal(
            result!.frontmatterAfter?.[key],
            undefined,
            `Property ${key} should be removed on ${uid}`,
          );
        }
      }
    } else {
      assert.equal(
        result!.success,
        false,
        `Expected failure for ${uid} (${fixture.cliStatus}), but grounding succeeded`,
      );
      const pattern = new RegExp(fixture.expect.errorPattern);
      assert.ok(
        result!.error && pattern.test(result!.error),
        `Error for ${uid} expected to match /${fixture.expect.errorPattern}/, got: ${result!.error}`,
      );
    }
  },
);
