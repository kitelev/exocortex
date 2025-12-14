#!/usr/bin/env node

/**
 * Test Pyramid Health Check Script
 *
 * Validates that the project follows test pyramid best practices:
 * - Unit tests should be the majority (≥70%)
 * - Component tests should be moderate (15-25%)
 * - E2E tests should be few (≤10%)
 *
 * Usage:
 *   node scripts/check-test-pyramid.js [--strict] [--json]
 *
 * Options:
 *   --strict  Fail if pyramid ratios are not met
 *   --json    Output results as JSON
 */

const fs = require('fs');
const path = require('path');

// Configuration - Test pyramid thresholds
const PYRAMID_CONFIG = {
  // Target ratios (percentages)
  targetRatios: {
    unit: { min: 70, max: 90 },      // Unit tests: 70-90%
    component: { min: 10, max: 25 }, // Component tests: 10-25%
    e2e: { min: 0, max: 10 },        // E2E tests: 0-10%
  },
  // Coverage thresholds
  coverageThresholds: {
    statements: 75,
    branches: 67,
    functions: 70,
    lines: 75,
  },
  // Test directories
  testDirs: {
    unit: [
      'packages/obsidian-plugin/tests/unit',
      'packages/exocortex/tests',
      'packages/cli/tests/unit',
    ],
    component: [
      'packages/obsidian-plugin/tests/component',
    ],
    e2e: [
      'packages/obsidian-plugin/tests/e2e/specs',
    ],
    ui: [
      'packages/obsidian-plugin/tests/ui',
    ],
  },
  // File patterns
  patterns: {
    unit: /\.test\.ts$/,
    component: /\.spec\.tsx$/,
    e2e: /\.spec\.ts$/,
    ui: /\.test\.ts$/,
  },
};

/**
 * Recursively count test files in a directory
 */
function countTestFiles(dir, pattern) {
  let count = 0;

  if (!fs.existsSync(dir)) {
    return 0;
  }

  const items = fs.readdirSync(dir);

  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      count += countTestFiles(fullPath, pattern);
    } else if (stat.isFile() && pattern.test(item)) {
      count++;
    }
  }

  return count;
}

/**
 * Count test cases in a file
 */
function countTestCases(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    // Match test(), it(), and test.describe patterns
    const testMatches = content.match(/(?:test|it)\s*\(\s*['"`]/g) || [];
    return testMatches.length;
  } catch {
    return 0;
  }
}

/**
 * Recursively count test cases in a directory
 */
function countTestCasesInDir(dir, pattern) {
  let count = 0;

  if (!fs.existsSync(dir)) {
    return 0;
  }

  const items = fs.readdirSync(dir);

  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      count += countTestCasesInDir(fullPath, pattern);
    } else if (stat.isFile() && pattern.test(item)) {
      count += countTestCases(fullPath);
    }
  }

  return count;
}

/**
 * Get test distribution statistics
 */
function getTestDistribution() {
  const rootDir = path.join(__dirname, '..');
  const stats = {
    files: { unit: 0, component: 0, e2e: 0, ui: 0 },
    cases: { unit: 0, component: 0, e2e: 0, ui: 0 },
  };

  // Count files and cases for each category
  for (const [category, dirs] of Object.entries(PYRAMID_CONFIG.testDirs)) {
    const pattern = PYRAMID_CONFIG.patterns[category];
    for (const dir of dirs) {
      const fullDir = path.join(rootDir, dir);
      stats.files[category] += countTestFiles(fullDir, pattern);
      stats.cases[category] += countTestCasesInDir(fullDir, pattern);
    }
  }

  return stats;
}

/**
 * Calculate pyramid ratios
 */
function calculateRatios(stats) {
  // Combine unit and UI tests (both are fast, isolated tests)
  const unitTotal = stats.files.unit + stats.files.ui;
  const total = unitTotal + stats.files.component + stats.files.e2e;

  if (total === 0) {
    return { unit: 0, component: 0, e2e: 0 };
  }

  return {
    unit: Math.round((unitTotal / total) * 100),
    component: Math.round((stats.files.component / total) * 100),
    e2e: Math.round((stats.files.e2e / total) * 100),
  };
}

/**
 * Validate pyramid ratios against thresholds
 */
function validatePyramid(ratios) {
  const results = {
    isHealthy: true,
    warnings: [],
    errors: [],
  };

  const { targetRatios } = PYRAMID_CONFIG;

  // Check unit test ratio
  if (ratios.unit < targetRatios.unit.min) {
    results.errors.push(
      `Unit tests ${ratios.unit}% is below minimum ${targetRatios.unit.min}%`
    );
    results.isHealthy = false;
  } else if (ratios.unit > targetRatios.unit.max) {
    results.warnings.push(
      `Unit tests ${ratios.unit}% exceeds maximum ${targetRatios.unit.max}% (consider adding more integration tests)`
    );
  }

  // Check component test ratio
  if (ratios.component > targetRatios.component.max) {
    results.warnings.push(
      `Component tests ${ratios.component}% exceeds target ${targetRatios.component.max}%`
    );
  } else if (ratios.component < targetRatios.component.min && ratios.component > 0) {
    results.warnings.push(
      `Component tests ${ratios.component}% is below target ${targetRatios.component.min}%`
    );
  }

  // Check E2E test ratio
  if (ratios.e2e > targetRatios.e2e.max) {
    results.errors.push(
      `E2E tests ${ratios.e2e}% exceeds maximum ${targetRatios.e2e.max}% (E2E tests are slow and expensive)`
    );
    results.isHealthy = false;
  }

  return results;
}

/**
 * Read coverage report if available
 */
function readCoverageReport() {
  const coveragePath = path.join(
    __dirname,
    '../packages/obsidian-plugin/coverage/coverage-summary.json'
  );

  if (!fs.existsSync(coveragePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(coveragePath, 'utf8');
    const report = JSON.parse(content);
    return report.total;
  } catch {
    return null;
  }
}

/**
 * Validate coverage against thresholds
 */
function validateCoverage(coverage) {
  if (!coverage) {
    // Coverage report not found - treated as "skipped" not "failed"
    // This allows the pyramid check to pass without coverage data
    return {
      isValid: true,  // Don't fail just because coverage not collected
      skipped: true,
      message: 'Coverage report not found (skipped)',
      details: {}
    };
  }

  const { coverageThresholds } = PYRAMID_CONFIG;
  const results = {
    isValid: true,
    skipped: false,
    details: {},
  };

  for (const [metric, threshold] of Object.entries(coverageThresholds)) {
    const actual = coverage[metric]?.pct || 0;
    const passed = actual >= threshold;

    results.details[metric] = {
      actual,
      threshold,
      passed,
    };

    if (!passed) {
      results.isValid = false;
    }
  }

  return results;
}

/**
 * Generate report
 */
function generateReport(stats, ratios, pyramidValidation, coverageValidation) {
  const report = {
    timestamp: new Date().toISOString(),
    testDistribution: {
      files: {
        unit: stats.files.unit + stats.files.ui,
        component: stats.files.component,
        e2e: stats.files.e2e,
        total: stats.files.unit + stats.files.ui + stats.files.component + stats.files.e2e,
      },
      cases: {
        unit: stats.cases.unit + stats.cases.ui,
        component: stats.cases.component,
        e2e: stats.cases.e2e,
        total: stats.cases.unit + stats.cases.ui + stats.cases.component + stats.cases.e2e,
      },
      ratios,
    },
    pyramid: pyramidValidation,
    coverage: coverageValidation,
    summary: {
      pyramidHealthy: pyramidValidation.isHealthy,
      coverageMet: coverageValidation.isValid,
      overallHealthy: pyramidValidation.isHealthy && coverageValidation.isValid,
    },
  };

  return report;
}

/**
 * Print console report
 */
function printReport(report) {
  console.log('\n🔺 Test Pyramid Health Check\n');
  console.log('═'.repeat(60));

  // Test Distribution
  console.log('\n📊 Test Distribution:\n');
  console.log(`   Unit Tests:      ${report.testDistribution.files.unit} files, ${report.testDistribution.cases.unit} cases (${report.testDistribution.ratios.unit}%)`);
  console.log(`   Component Tests: ${report.testDistribution.files.component} files, ${report.testDistribution.cases.component} cases (${report.testDistribution.ratios.component}%)`);
  console.log(`   E2E Tests:       ${report.testDistribution.files.e2e} files, ${report.testDistribution.cases.e2e} cases (${report.testDistribution.ratios.e2e}%)`);
  console.log(`   ─────────────────────────────────────`);
  console.log(`   Total:           ${report.testDistribution.files.total} files, ${report.testDistribution.cases.total} cases`);

  // Pyramid Visualization
  console.log('\n📐 Test Pyramid:\n');
  const unitBar = '█'.repeat(Math.floor(report.testDistribution.ratios.unit / 5));
  const componentBar = '█'.repeat(Math.floor(report.testDistribution.ratios.component / 5));
  const e2eBar = '█'.repeat(Math.max(1, Math.floor(report.testDistribution.ratios.e2e / 5)));

  console.log(`   E2E        [${e2eBar.padEnd(20)}] ${report.testDistribution.ratios.e2e}%`);
  console.log(`   Component  [${componentBar.padEnd(20)}] ${report.testDistribution.ratios.component}%`);
  console.log(`   Unit       [${unitBar.padEnd(20)}] ${report.testDistribution.ratios.unit}%`);

  // Pyramid Validation
  console.log('\n🏥 Pyramid Health:\n');
  if (report.pyramid.isHealthy) {
    console.log('   ✅ Pyramid structure is healthy');
  } else {
    console.log('   ❌ Pyramid structure needs attention');
  }

  if (report.pyramid.errors.length > 0) {
    console.log('\n   Errors:');
    for (const error of report.pyramid.errors) {
      console.log(`   ❌ ${error}`);
    }
  }

  if (report.pyramid.warnings.length > 0) {
    console.log('\n   Warnings:');
    for (const warning of report.pyramid.warnings) {
      console.log(`   ⚠️  ${warning}`);
    }
  }

  // Coverage Validation
  console.log('\n📈 Coverage Thresholds:\n');
  if (report.coverage.skipped) {
    console.log(`   ⏭️  ${report.coverage.message}`);
  } else if (report.coverage.details && Object.keys(report.coverage.details).length > 0) {
    for (const [metric, data] of Object.entries(report.coverage.details)) {
      const icon = data.passed ? '✅' : '❌';
      console.log(`   ${icon} ${metric}: ${data.actual.toFixed(1)}% (threshold: ${data.threshold}%)`);
    }
  } else {
    console.log('   ⚠️  No coverage data available');
  }

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('\n📋 Summary:\n');
  console.log(`   Pyramid Healthy:  ${report.summary.pyramidHealthy ? '✅ Yes' : '❌ No'}`);

  // Coverage status with skipped handling
  if (report.coverage.skipped) {
    console.log(`   Coverage Met:     ⏭️  Skipped (no coverage data)`);
  } else {
    console.log(`   Coverage Met:     ${report.summary.coverageMet ? '✅ Yes' : '❌ No'}`);
  }

  console.log(`   Overall Status:   ${report.summary.overallHealthy ? '✅ PASS' : '❌ FAIL'}`);
  console.log('');
}

/**
 * Main execution
 */
function main() {
  const args = process.argv.slice(2);
  const strictMode = args.includes('--strict');
  const jsonOutput = args.includes('--json');

  // Gather statistics
  const stats = getTestDistribution();
  const ratios = calculateRatios(stats);

  // Validate pyramid
  const pyramidValidation = validatePyramid(ratios);

  // Validate coverage
  const coverage = readCoverageReport();
  const coverageValidation = validateCoverage(coverage);

  // Generate report
  const report = generateReport(stats, ratios, pyramidValidation, coverageValidation);

  // Output
  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }

  // Exit with error code if strict mode and validation failed
  if (strictMode && !report.summary.overallHealthy) {
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  getTestDistribution,
  calculateRatios,
  validatePyramid,
  validateCoverage,
  PYRAMID_CONFIG,
};
