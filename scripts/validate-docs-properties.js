#!/usr/bin/env node

/**
 * Validates that property names used in docs/ YAML blocks exist in the codebase.
 *
 * Extracts property names matching the pattern `namespace__ClassName_propertyName`
 * from YAML code blocks in docs/, then verifies each one appears somewhere in
 * packages/ source code (excluding test files and node_modules).
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const DOCS_DIR = path.join(__dirname, "..", "docs");
const PACKAGES_DIR = path.join(__dirname, "..", "packages");

// Namespaces used in the ontology
const PROPERTY_PATTERN =
  /\b((?:exo|ems|pn|ims|ztlk|ptms|lit|inbox)__\w+_\w+)\b/g;

// Properties that are documentation-only examples or meta-references (not in source)
// Each entry must have a comment explaining why it's excluded.
// Review periodically: if the property is added to code, remove from exceptions.
const KNOWN_EXCEPTIONS = new Set([
  "ems__Effort_progress_percentage", // docs-only example in workflows
  "ems__Effort_started_on", // docs alias for ems__Effort_startTimestamp
  "ems__Effort_completed_on", // docs alias for ems__Effort_endTimestamp
  "ems__Effort_team", // ONTOLOGY_EXTENSION.md example of custom property
  "pn__DailyNote_date", // PROPERTY_SCHEMA.md schema reference (code uses pn__DailyNote_day)
  "ztlk__Note_type", // PROPERTY_SCHEMA.md schema reference (zettelkasten namespace)
  "ems__Effort_archived_date", // PROPERTY_SCHEMA.md schema reference
  "exo__Task_status", // sparql/User-Guide.md SPARQL example (simplified)
  "exo__Task_priority", // sparql/User-Guide.md SPARQL example (simplified)
  "ems__Session_scheduled_start_time", // workflows time-specific scheduling
  "ems__Effort_status_changes", // workflows status history YAML example
  "exo__Property_minCount", // SHACL_LITE_MAPPING.md Phase 3+ planned property (YAGNI Drop #3 in RFC 82a72aca v3)
  "exo__Property_severity", // SHACL_LITE_MAPPING.md sh:severity alignment — docs-only mapping reference (aa6615f0)
  "exo__AssetSpace_materialized", // RFC 22b50a17 Phase 4 — runtime-derived property; code constructs via Namespace.EXO.term("AssetSpace_materialized") rather than literal string (docs/focus-profile.md)
  "exo__KnowledgeProfile_includes", // docs/profiles.md — documented exo__KnowledgeProfile (hard-switch) property; its sole literal-string reference in packages/ was the migrate-shared-identities-profiles migration service, removed in PR #3394 (YAGNI). No literal-token code ref remains by design.
  "exo__KnowledgeProfile_extends", // docs/profiles.md — see exo__KnowledgeProfile_includes (same PR #3394 removal)
  "exo__KnowledgeProfile_alwaysOnOverlay", // docs/profiles.md — see exo__KnowledgeProfile_includes (same PR #3394 removal)
  "exo__FocusProfile_includes", // docs/profiles.md — pre-Phase-2 FocusProfile name (RFC 01a83de8 Phase 2 renamed FocusProfile→Profile; code uses exo__Profile_includes). Its sole literal-string reference in packages/ was a test comment in FocusProfileWiring.integration.test.ts, removed in the Phase 3 T3b soft-filter PR. Historical migration-narrative reference; no literal-token code ref remains by design.
]);

function extractPropertiesFromDocs() {
  const properties = new Map(); // property -> [{file, line}]

  function scanFile(filePath) {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    let inYamlBlock = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Track YAML code blocks (```yaml ... ```)
      if (line.trim().startsWith("```yaml")) {
        inYamlBlock = true;
        continue;
      }
      if (line.trim().startsWith("```") && inYamlBlock) {
        inYamlBlock = false;
        continue;
      }

      // Also check inline code and table cells with property names
      const matches = line.matchAll(PROPERTY_PATTERN);
      for (const match of matches) {
        const prop = match[1];
        // Skip class names (no underscore after namespace prefix + class)
        // e.g. ems__Task is a class, ems__Effort_status is a property
        if (!properties.has(prop)) {
          properties.set(prop, []);
        }
        properties.get(prop).push({
          file: path.relative(path.join(__dirname, ".."), filePath),
          line: i + 1,
        });
      }
    }
  }

  function scanDir(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.name.endsWith(".md")) {
        scanFile(fullPath);
      }
    }
  }

  scanDir(DOCS_DIR);
  return properties;
}

function propertyExistsInCode(propertyName) {
  try {
    const result = execSync(
      `grep -r --include='*.ts' -l '${propertyName}' '${PACKAGES_DIR}' 2>/dev/null`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

function main() {
  console.log("Validating documentation property names...\n");

  const docProperties = extractPropertiesFromDocs();
  const errors = [];

  for (const [prop, locations] of docProperties) {
    if (KNOWN_EXCEPTIONS.has(prop)) continue;

    if (!propertyExistsInCode(prop)) {
      errors.push({ property: prop, locations });
    }
  }

  console.log(`Found ${docProperties.size} unique property names in docs/`);
  console.log(
    `Checked against packages/ source code (${errors.length} missing)\n`,
  );

  if (errors.length > 0) {
    console.error("VALIDATION FAILED: Properties in docs not found in code:\n");
    for (const { property, locations } of errors) {
      console.error(`  ${property}`);
      for (const loc of locations.slice(0, 3)) {
        console.error(`    - ${loc.file}:${loc.line}`);
      }
      if (locations.length > 3) {
        console.error(`    ... and ${locations.length - 3} more`);
      }
    }
    console.error(
      "\nFix: Update docs to use correct property names, or add to KNOWN_EXCEPTIONS if intentional.",
    );
    process.exit(1);
  }

  console.log("All property names in docs/ exist in code.");
}

main();
