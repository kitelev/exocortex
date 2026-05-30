#!/usr/bin/env node
// RFC 94e520da Phase 1 / T1.5 — starter-kit grounding audit.
// Walks <starter-kit>/exocmd/**/*.md, extracts exocmd__Grounding_type +
// exocmd__Grounding_serviceId, classifies each grounding against the CLI
// service registry, and writes a JSON fixture consumed by Phase 6 BDD.

import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

// Mirror of CliServiceRegistryPopulator.ts on origin/main (post-T1.4).
// Source of truth: packages/cli/src/services/CliServiceRegistryPopulator.ts
const KNOWN_REAL_SERVICE_IDS = new Set([
  "createRelatedTask",
  "createRelatedProject",
  "archiveAsset",
  "planForEvening",
  "cleanProperties",
  "renameToUid",
  "repairFolder",
  "fixMissingLabel",
  "updateProperty",
  "removeProperty",
  "setStatus",
  // Phase 3.5 (Issue #3164, 2026-05-23): createAsset ported from CLI stub to
  // real handler via shared `createCreateAssetService` factory
  // (@kitelev/exocortex-services). Mirrors the plugin's inlined handler
  // one-for-one; Phase 4b will remove both implementations once vault
  // Groundings migrate from service_call to create_instance type.
  "createAsset",
]);

const KNOWN_STUB_SERVICE_IDS = new Set([
  "openFile",
  "sparqlSelect",
  "getActiveFileIRI",
  "getActiveFilePath",
  "trashFile",
  "duplicateFile",
]);

// Plugin-only services with no shared-package factory yet — RFC § Phase 1
// follow-up (T1.6). Listed explicitly so the drift gate exits zero today
// and exits non-zero the moment a brand-new service id appears.
const KNOWN_UNREGISTERED_SERVICE_IDS = new Set([
  // copyLabelToAliases removed in Issue #3132 — grounding a85668fa-… migrated
  // to declarative `property_append` (Homoiconicity Q1 remediation).
  // shiftDay (×2) + incrementVotes (×1) removed in Issue #3134 — migrated to
  // declarative `property_shift` / `property_increment` (RFC
  // 18407cb2-9554-4897-9213-17321f9dd434 Path B).
  // planOnToday + createTaskForDailyNote removed in Issue #3136 — migrated
  // to declarative `property_set` (with new $todayStart token) and
  // `create_instance` (with new $targetFolder token + propertyDefaults
  // JSON literal) respectively.
  // rollbackStatus removed (kitelev/exocortex-starter-kit#103 +
  // exocortex PR #3297) — the universal Rollback Status button was broken
  // by UUID-canon TBox migration; replaced by per-status backward Commands
  // (Re-open, Rollback to Backlog/ToDo/Analysis/Draft) using composite
  // groundings (UUID status refs only — no WorkflowEngine string matching).
]);

function parseArgs(argv) {
  const args = { starterKit: null, out: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--starter-kit") args.starterKit = argv[++i];
    else if (argv[i] === "--out") args.out = argv[++i];
  }
  if (!args.starterKit) {
    args.starterKit = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "exocortex-starter-kit",
    );
  }
  if (!args.out) {
    args.out = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "docs",
      "rfc-94e520da",
      "starter-kit-grounding-status.json",
    );
  }
  return args;
}

async function* walkMarkdown(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      yield* walkMarkdown(full);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      yield full;
    }
  }
}

const TYPE_RE = /^exocmd__Grounding_type:\s*"([^"]+)"\s*$/m;
const SERVICE_RE = /^exocmd__Grounding_serviceId:\s*"([^"]+)"\s*$/m;
const UID_RE = /^exo__Asset_uid:\s*([0-9a-f-]+)\s*$/m;
const LABEL_RE = /^exo__Asset_label:\s*"?([^"\n]+)"?\s*$/m;

// RFC 9d20c91f Phase 2 dual-read: after Phase 3 migration, ABox stores
// `exocmd__Grounding_type: "[[<uid>]]"`. Resolve wikilink form to the
// canonical enum string. Replicates packages/exocortex/src/domain/constants/
// GroundingTypeUIDs.ts reverse map (this script is .mjs, can't import TS).
// Parity verified by GroundingTypeParity.test.ts.
const GROUNDING_TYPE_UID_TO_ENUM = Object.freeze({
  "cf3bb923-f1f1-40be-b728-782844402426": "property_set",
  "4bdf1d0b-e9da-4d96-bafe-c5aaef8c2bd5": "property_delete",
  "8f9a57db-3865-4886-92fb-c5ab7f3c3fa3": "composite",
  "9bf9fc99-ac37-4e51-b9f5-bd920099947c": "service_call",
  "4367e2d6-6c92-450a-becb-abce1fb07682": "create_instance",
  "572f7e69-a8a1-42f6-8113-5aa65cc4b552": "property_append",
  "afc29f90-45eb-4f94-9fe2-2ce738759161": "property_increment",
  "f4e5266f-f3cc-49fd-a5a5-ce1e8b7847a4": "property_shift",
  "79c3e709-8d1d-4694-bcc6-b9ff07d59b86": "sparql_update",
});
const WIKILINK_TYPE_RE = /^\[\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\|[^\]]*)?\]\]$/i;

// RFC 9d20c91f Phase 4+1: wikilink-only — env-flag escape hatch removed.
// Legacy literal-string encountered post-cutover emits stderr error and
// flags the audit run as failure (exit non-zero). Audit script is the
// regression detector for any post-Phase-3 ABox drift.
const _legacyAuditSawLiteralForm = { value: false };
function resolveGroundingType(raw) {
  const m = raw.match(WIKILINK_TYPE_RE);
  if (m) return GROUNDING_TYPE_UID_TO_ENUM[m[1].toLowerCase()] ?? raw;
  _legacyAuditSawLiteralForm.value = true;
  process.stderr.write(
    `[exocmd-grounding-type-literal-form] ERROR audit encountered legacy literal-string '${raw}' for exocmd__Grounding_type post-cutover. Migrate to wikilink form per RFC 9d20c91f Phase 3.\n`,
  );
  return raw;
}

function classify(type, serviceId) {
  if (type !== "service_call") return "real"; // generic handler
  if (KNOWN_REAL_SERVICE_IDS.has(serviceId)) return "real";
  if (KNOWN_STUB_SERVICE_IDS.has(serviceId)) return "stub";
  if (KNOWN_UNREGISTERED_SERVICE_IDS.has(serviceId)) return "unregistered";
  return "drift";
}

async function main() {
  const args = parseArgs(process.argv);
  const exocmdDir = join(args.starterKit, "exocmd");
  const groundings = [];

  for await (const path of walkMarkdown(exocmdDir)) {
    const text = await readFile(path, "utf8");
    const fm = text.split(/^---$/m)[1] ?? "";
    const typeMatch = fm.match(TYPE_RE);
    if (!typeMatch) continue;
    const type = resolveGroundingType(typeMatch[1]);
    const serviceId = fm.match(SERVICE_RE)?.[1] ?? null;
    const uid = fm.match(UID_RE)?.[1] ?? null;
    const label = fm.match(LABEL_RE)?.[1]?.trim() ?? null;
    const cliStatus = classify(type, serviceId);
    groundings.push({
      uid,
      label,
      path: path.slice(args.starterKit.length + 1),
      type,
      serviceId,
      cliStatus,
    });
  }

  groundings.sort((a, b) => (a.path < b.path ? -1 : 1));

  const drift = groundings.filter((g) => g.cliStatus === "drift");
  if (drift.length > 0) {
    console.error(
      `[audit] DRIFT: ${drift.length} grounding(s) reference unknown service ids:`,
    );
    for (const g of drift) {
      console.error(`  - ${g.path} → serviceId="${g.serviceId}"`);
    }
    process.exitCode = 1;
  }

  if (_legacyAuditSawLiteralForm.value) {
    console.error(
      `[audit] LITERAL-FORM: at least one exocmd__Grounding_type literal-string form encountered (see stderr above). RFC 9d20c91f Phase 4+1 cutover violated.`,
    );
    process.exitCode = 1;
  }

  const byType = {};
  const byCliStatus = {};
  const serviceIdCounts = {};
  for (const g of groundings) {
    byType[g.type] = (byType[g.type] ?? 0) + 1;
    byCliStatus[g.cliStatus] = (byCliStatus[g.cliStatus] ?? 0) + 1;
    if (g.serviceId) {
      serviceIdCounts[g.serviceId] = (serviceIdCounts[g.serviceId] ?? 0) + 1;
    }
  }

  const summary = {
    rfc: "94e520da",
    phase: 1,
    task: "T1.5",
    auditedAt: new Date().toISOString(),
    starterKitPath: args.starterKit,
    totalGroundings: groundings.length,
    byType,
    byCliStatus,
    serviceIdCounts,
  };

  await writeFile(
    args.out,
    JSON.stringify({ summary, groundings }, null, 2) + "\n",
    "utf8",
  );

  console.log(`[audit] wrote ${args.out}`);
  console.log(`[audit] total: ${groundings.length}`);
  console.log(`[audit] byType: ${JSON.stringify(byType)}`);
  console.log(`[audit] byCliStatus: ${JSON.stringify(byCliStatus)}`);
}

await main();
