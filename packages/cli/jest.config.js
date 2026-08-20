module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: ".",
  testMatch: ["<rootDir>/tests/**/*.test.ts"],
  setupFilesAfterEnv: ["<rootDir>/tests/setup.ts"],
  moduleNameMapper: {
    // `test-utils` is a private workspace package with no build step; tests
    // resolve it straight from source. Mapped to the helper FILE rather than the
    // package index on purpose — the index also re-exports Obsidian mocks and
    // the flaky reporter, which these suites have no business loading.
    "^@kitelev/exocortex-test-utils$":
      "<rootDir>/../test-utils/src/helpers/frontmatter.helpers.ts",
    "^@kitelev/exocortex-core$": "<rootDir>/../core/src/index.ts",
    "^@kitelev/exocortex-services$": "<rootDir>/../services/src/index.ts",
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: {
          module: "ESNext",
          moduleResolution: "node",
          esModuleInterop: true,
        },
      },
    ],
  },
  transformIgnorePatterns: [
    "node_modules/(?!(uuid)/)",
  ],
  extensionsToTreatAsEsm: [".ts"],
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.d.ts",
    "!src/**/*.test.ts",
    // Exclude daily-review.ts from coverage - actual logic tested in DailyReviewService.test.ts
    "!src/commands/daily-review.ts",
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html", "json-summary"],
  // Force exit after all tests complete (prevents CI timeout from open handles)
  forceExit: process.env.CI ? true : false,
  // Coverage thresholds per Test Pyramid policy (docs/TEST-PYRAMID.md)
  coverageThreshold: {
    global: {
      statements: 65,
      branches: 60,
      functions: 70,
      lines: 65,
    },
  },
};
