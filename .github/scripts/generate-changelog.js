#!/usr/bin/env node

/**
 * Changelog Generator for Conventional Commits
 *
 * Features:
 * - Preserves scope in output (e.g., "feat(rdf): add predicate" stays visible)
 * - Converts PR/Issue references to clickable links
 * - Groups by scope within each type
 * - Supports all conventional commit types
 * - Highlights breaking changes
 * - Hides empty sections
 */

const fs = require("fs");

// Configuration
const REPO_URL = "https://github.com/kitelev/exocortex";

const COMMIT_TYPES = {
  feat: { title: "Features", emoji: "rocket", order: 1 },
  fix: { title: "Bug Fixes", emoji: "bug", order: 2 },
  perf: { title: "Performance", emoji: "zap", order: 3 },
  refactor: { title: "Refactoring", emoji: "recycle", order: 4 },
  docs: { title: "Documentation", emoji: "books", order: 5 },
  test: { title: "Tests", emoji: "test_tube", order: 6 },
  chore: { title: "Maintenance", emoji: "wrench", order: 7 },
  ci: { title: "CI/CD", emoji: "construction_worker", order: 8 },
  style: { title: "Style", emoji: "lipstick", order: 9 },
  build: { title: "Build", emoji: "package", order: 10 },
};

/**
 * Parse a conventional commit message
 * Format: type(scope)!: description (#123)
 */
function parseCommit(message) {
  // Match: type(scope)!: description or type!: description or type: description
  const regex =
    /^(?<type>[a-z]+)(?:\((?<scope>[a-z0-9-]+)\))?(?<breaking>!)?:\s*(?<description>.+)$/i;
  const match = message.match(regex);

  if (!match || !match.groups) {
    return null;
  }

  const { type, scope, breaking, description } = match.groups;

  // Extract PR/Issue references from description
  const prMatch = description.match(/\(#(\d+)\)/);
  const prNumber = prMatch ? prMatch[1] : null;

  // Clean description (remove PR reference for cleaner display)
  const cleanDescription = description.replace(/\s*\(#\d+\)\s*$/, "").trim();

  return {
    type: type.toLowerCase(),
    scope: scope || null,
    breaking: breaking === "!" || description.includes("BREAKING CHANGE"),
    description: cleanDescription,
    prNumber,
    raw: message,
  };
}

/**
 * Convert PR/Issue number to clickable markdown link
 */
function prLink(prNumber) {
  if (!prNumber) return "";
  return ` ([#${prNumber}](${REPO_URL}/pull/${prNumber}))`;
}

/**
 * Format a single commit entry
 */
function formatCommit(commit) {
  const breakingPrefix = commit.breaking ? "**BREAKING** " : "";
  const scopePrefix = commit.scope ? `**${commit.scope}**: ` : "";
  const link = prLink(commit.prNumber);

  return `- ${breakingPrefix}${scopePrefix}${commit.description}${link}`;
}

/**
 * Group commits by type and scope
 */
function groupCommits(commits) {
  const groups = {};

  for (const commit of commits) {
    const type = commit.type;
    if (!groups[type]) {
      groups[type] = {
        byScope: {},
        noScope: [],
      };
    }

    if (commit.scope) {
      if (!groups[type].byScope[commit.scope]) {
        groups[type].byScope[commit.scope] = [];
      }
      groups[type].byScope[commit.scope].push(commit);
    } else {
      groups[type].noScope.push(commit);
    }
  }

  return groups;
}

/**
 * Generate markdown changelog from commits
 */
function generateChangelog(commitsText, version, date) {
  // Parse all commits
  const lines = commitsText.split("\n").filter((line) => line.trim());
  const parsed = [];
  const unparsed = [];

  for (const line of lines) {
    const commit = parseCommit(line);
    if (commit) {
      parsed.push(commit);
    } else {
      unparsed.push(line);
    }
  }

  // Separate breaking changes
  const breakingChanges = parsed.filter((c) => c.breaking);
  const regularCommits = parsed.filter((c) => !c.breaking);

  // Group commits by type
  const grouped = groupCommits(regularCommits);

  // Start building changelog
  const sections = [];

  // Header
  sections.push(`## [${version}] - ${date}\n`);

  // Breaking changes section (always first if present)
  if (breakingChanges.length > 0) {
    sections.push("### Breaking Changes\n");
    for (const commit of breakingChanges) {
      sections.push(formatCommit({ ...commit, breaking: false }));
    }
    sections.push("");
  }

  // Sort types by order
  const sortedTypes = Object.keys(grouped).sort((a, b) => {
    const orderA = COMMIT_TYPES[a]?.order || 99;
    const orderB = COMMIT_TYPES[b]?.order || 99;
    return orderA - orderB;
  });

  // Generate sections for each type
  for (const type of sortedTypes) {
    const typeConfig = COMMIT_TYPES[type] || { title: type, emoji: "gear" };
    const group = grouped[type];

    // Skip empty groups
    const totalCommits =
      group.noScope.length +
      Object.values(group.byScope).reduce((sum, arr) => sum + arr.length, 0);
    if (totalCommits === 0) continue;

    sections.push(`### ${typeConfig.title}\n`);

    // Group by scope first
    const sortedScopes = Object.keys(group.byScope).sort();

    for (const scope of sortedScopes) {
      const scopeCommits = group.byScope[scope];
      for (const commit of scopeCommits) {
        sections.push(formatCommit(commit));
      }
    }

    // Then commits without scope
    for (const commit of group.noScope) {
      sections.push(formatCommit(commit));
    }

    sections.push("");
  }

  // Other changes (unparsed commits that don't match conventional format)
  if (unparsed.length > 0) {
    sections.push("### Other Changes\n");
    for (const line of unparsed) {
      // Try to extract PR reference even from unparsed commits
      const prMatch = line.match(/\(#(\d+)\)/);
      if (prMatch) {
        const cleanLine = line.replace(/\s*\(#\d+\)\s*$/, "").trim();
        sections.push(`- ${cleanLine}${prLink(prMatch[1])}`);
      } else {
        sections.push(`- ${line}`);
      }
    }
    sections.push("");
  }

  return sections.join("\n");
}

// Main execution
function main() {
  const version = process.env.VERSION || "0.0.0";
  const date = process.env.DATE || new Date().toISOString().split("T")[0];
  const outputFile = process.env.OUTPUT_FILE || "release_notes.md";

  // Read commits from stdin or file
  let commitsText = "";

  if (process.env.COMMITS_FILE && fs.existsSync(process.env.COMMITS_FILE)) {
    commitsText = fs.readFileSync(process.env.COMMITS_FILE, "utf8");
  } else {
    // Read from stdin
    try {
      commitsText = fs.readFileSync(0, "utf8"); // fd 0 is stdin
    } catch {
      console.error("No commits provided via COMMITS_FILE or stdin");
      process.exit(1);
    }
  }

  if (!commitsText.trim()) {
    console.error("No commits to process");
    process.exit(1);
  }

  const changelog = generateChangelog(commitsText, version, date);

  // Write to output file
  fs.writeFileSync(outputFile, changelog);

  console.log(`Generated changelog for version ${version}:`);
  console.log(changelog);
}

main();
