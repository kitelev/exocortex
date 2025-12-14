/**
 * @type {import('@stryker-mutator/api').PartialStrykerOptions}
 *
 * Stryker Mutation Testing Configuration
 *
 * Mutation testing reveals "weak" tests by modifying source code (mutations)
 * and checking if tests detect the changes. If tests still pass with mutated
 * code, the mutation "survived" = weak test detected.
 *
 * Mutation Score = killed mutants / total mutants
 *
 * Usage:
 *   npm run test:mutation              # Run on critical files (fast)
 *   npm run test:mutation:core         # Run on exocortex package utilities
 *   npm run test:mutation:report       # Open HTML report
 *
 * Note: This configuration is optimized for the exocortex package utilities.
 * Uses inPlace mode to avoid sandbox copying issues with monorepo structure.
 *
 * @see https://stryker-mutator.io/docs/stryker-js/configuration/
 */
export default {
  // Package manager for installing dependencies
  packageManager: "npm",

  // Reporter plugins for output
  reporters: ["html", "clear-text", "progress", "json"],

  // Use Jest as the test runner (project uses Jest, not Vitest)
  testRunner: "jest",

  // Jest configuration - inline config for proper monorepo test resolution
  // This runs tests from packages/exocortex against mutations in core utilities
  jest: {
    projectType: "custom",
    config: {
      preset: "ts-jest",
      testEnvironment: "node",
      // Run tests from core package
      rootDir: "packages/exocortex",
      // Only run utility tests - other tests have pre-existing failures
      testMatch: ["<rootDir>/tests/utilities/**/*.test.ts"],
      // Setup reflect-metadata for TSyringe
      setupFilesAfterEnv: ["<rootDir>/tests/setup-reflect-metadata.ts"],
      // Handle ES modules from node_modules (uuid v13)
      transformIgnorePatterns: ["node_modules/(?!(uuid)/)"],
      transform: {
        "^.+\\.ts$": [
          "ts-jest",
          {
            // Skip type checking in ts-jest to allow tests to run despite pre-existing type errors
            isolatedModules: true,
          },
        ],
        "^.+\\.(js|mjs)$": "babel-jest",
      },
      // Performance settings
      forceExit: true,
      maxWorkers: 1,
      testTimeout: 60000,
    },
    enableFindRelatedTests: true,
  },

  // TypeScript checker disabled to avoid type errors in test files
  // These are pre-existing issues in the codebase that need separate fixes
  // Enable checkers: ["typescript"] once test type issues are resolved
  checkers: [],

  // TypeScript configuration (used when checker is enabled)
  tsconfigFile: "tsconfig.json",

  // Coverage analysis - use "all" for monorepo compatibility
  coverageAnalysis: "all",

  // Mutation testing timeout multiplier (mutations may cause infinite loops)
  timeoutMS: 60000,
  timeoutFactor: 2.5,

  // Concurrency settings (respect CI resource limits)
  concurrency: process.env.CI ? 2 : 4,

  // Run tests in place to avoid sandbox copying issues with monorepo
  // This modifies source files in place and restores them after testing
  inPlace: true,

  // Start with critical files only (mutation testing is slow)
  // These files have high business logic impact and comprehensive tests
  mutate: [
    // Core utilities - high value, well-tested
    "packages/exocortex/src/utilities/FrontmatterService.ts",
    "packages/exocortex/src/utilities/DateFormatter.ts",
    "packages/exocortex/src/utilities/MetadataHelpers.ts",
    "packages/exocortex/src/utilities/WikiLinkHelpers.ts",

    // Command visibility rules - critical business logic
    "packages/exocortex/src/domain/commands/visibility/TaskVisibilityRules.ts",
    "packages/exocortex/src/domain/commands/visibility/EffortVisibilityRules.ts",
    "packages/exocortex/src/domain/commands/visibility/ProjectVisibilityRules.ts",
    "packages/exocortex/src/domain/commands/visibility/AreaVisibilityRules.ts",
    "packages/exocortex/src/domain/commands/visibility/AssetVisibilityRules.ts",
    "packages/exocortex/src/domain/commands/visibility/helpers.ts",
  ],

  // Ignore generated/external/test code
  ignorePatterns: [
    "node_modules",
    "dist",
    "**/*.test.ts",
    "**/*.spec.ts",
    "**/tests/**",
    "**/__tests__/**",
    "**/__mocks__/**",
    "*.d.ts",
    "*.js",
    "*.mjs",
    "**/*.config.js",
    "**/*.config.mjs",
    "**/*.config.ts",
    ".stryker-tmp",
  ],

  // Mutation thresholds for quality gates
  // Start with lower thresholds, increase as test quality improves
  thresholds: {
    high: 80, // Green: >= 80% mutation score
    low: 60, // Yellow: 60-80% mutation score
    break: null, // Disabled initially - set to 50 once baseline is established
  },

  // Log level for debugging
  logLevel: process.env.CI ? "info" : "debug",

  // HTML report output directory
  htmlReporter: {
    fileName: "mutation-report.html",
  },

  // JSON report output (for CI integration)
  jsonReporter: {
    fileName: "mutation-report.json",
  },

  // Temp directory for test runner (for backups)
  tempDirName: ".stryker-tmp",

  // Clear text reporter settings
  clearTextReporter: {
    maxTestsToLog: 10,
    allowColor: true,
    logTests: true,
  },
};
