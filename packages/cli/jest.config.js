module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: ".",
  testMatch: ["<rootDir>/tests/**/*.test.ts"],
  setupFilesAfterEnv: ["<rootDir>/tests/setup.ts"],
  moduleNameMapper: {
    "^exocortex$": "<rootDir>/../exocortex/src/index.ts",
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
    // Exclude ask.ts from coverage - tested via e2e tests due to complex dependencies
    "!src/commands/ask.ts",
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
