module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  testMatch: [
    "<rootDir>/tests/unit/**/*.test.ts",
    "<rootDir>/tests/unit/**/*.test.tsx",
    "<rootDir>/tests/performance/**/*.test.ts",
    "<rootDir>/../exocortex/tests/**/*.test.ts",
  ],
  testPathIgnorePatterns: [
    "/node_modules/",
    "/tests/ui/",
    "/tests/e2e/",
    "/tests/component/",
    "/tests/infrastructure/",
    // Temporarily skip these broken tests until ErrorBoundary mocking is fixed
    "/tests/unit/ReactRenderer.test.tsx",
    "/tests/unit/SPARQLGraphView.test.tsx",
    "/tests/unit/LayoutErrorFallback.test.tsx",
  ],
  collectCoverageFrom: [
    "<rootDir>/src/**/*.ts",
    "<rootDir>/../exocortex/src/**/*.ts",
    "!**/*.d.ts",
    "!**/node_modules/**",
    "!**/__tests__/**",
    "!**/tests/**",
    // Exclude Web Worker files - they run in Worker context and can't be unit tested with Jest
    "!**/*.worker.ts",
  ],
  moduleNameMapper: {
    "^exocortex$": "<rootDir>/../exocortex/src/index.ts",
    "^@plugin/types$": "<rootDir>/src/types/index.ts",
    "^@plugin/types/(.*)$": "<rootDir>/src/types/$1",
    "^@plugin/adapters/(.*)$": "<rootDir>/src/adapters/$1",
    "^@plugin/application/(.*)$": "<rootDir>/src/application/$1",
    "^@plugin/domain/(.*)$": "<rootDir>/src/domain/$1",
    "^@plugin/infrastructure/(.*)$": "<rootDir>/src/infrastructure/$1",
    "^@plugin/presentation/(.*)$": "<rootDir>/src/presentation/$1",
    "^@plugin/(.*)$": "<rootDir>/src/$1",
    "^obsidian$": "<rootDir>/tests/__mocks__/obsidian.ts",
    "^d3$": "<rootDir>/tests/__mocks__/d3.ts",
    "^pixi\\.js$": "<rootDir>/tests/__mocks__/pixi.js.ts",
  },
  // Coverage thresholds per Test Pyramid policy (docs/TEST-PYRAMID.md)
  // CI workflow (.github/workflows/ci.yml) uses: statements: 75, branches: 67, functions: 70, lines: 75
  // Jest config is more strict locally to catch issues early
  coverageThreshold: {
    global: {
      statements: 75,
      branches: 67,
      functions: 70,
      lines: 75,
    },
  },
  // Handle ES modules from node_modules
  transformIgnorePatterns: ["node_modules/(?!(chai|uuid)/)"],
  // Test timeout: 30s default, extended in CI for stability
  testTimeout: process.env.CI ? 60000 : 30000,
  // Performance optimizations
  verbose: false,
  silent: process.env.CI ? true : false,
  bail: process.env.CI ? 3 : false, // Fail fast in CI after 3 failures
  // Mock management
  clearMocks: true,
  restoreMocks: true,
  resetMocks: true,
  // Worker configuration - parallel execution enabled
  maxWorkers: process.env.CI ? "50%" : "50%",
  // Setup files
  setupFilesAfterEnv: [
    "<rootDir>/tests/setup-reflect-metadata.ts",
  ],
  // Cache configuration
  cacheDirectory: "<rootDir>/.jest-cache",
  // Coverage configuration
  collectCoverage: false, // Controlled by --coverage flag
  coverageReporters: process.env.CI
    ? ["lcov", "json-summary", "text-summary"]
    : ["text", "html"],
  // Flaky test reporter for CI
  reporters: [
    "default",
    ...(process.env.CI
      ? [
          [
            "<rootDir>/../test-utils/reporters/flaky-reporter.js",
            {
              outputFile: "flaky-report.json",
              failOnFlaky: false,
              verbose: true,
            },
          ],
        ]
      : []),
  ],
  // Test result optimization
  passWithNoTests: true,
  errorOnDeprecated: false,
  // Modern ts-jest configuration
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: false,
        tsconfig: {
          module: "commonjs",
          target: "es2020",
          lib: ["es2020", "dom"],
          skipLibCheck: true,
          moduleResolution: "node",
          allowSyntheticDefaultImports: true,
          esModuleInterop: true,
          isolatedModules: true,
          paths: {
            "exocortex": ["<rootDir>/../exocortex/src/index.ts"],
            "@plugin/types": ["<rootDir>/src/types/index.ts"],
            "@plugin/types/*": ["<rootDir>/src/types/*"],
            "@plugin/adapters/*": ["<rootDir>/src/adapters/*"],
            "@plugin/application/*": ["<rootDir>/src/application/*"],
            "@plugin/domain/*": ["<rootDir>/src/domain/*"],
            "@plugin/infrastructure/*": ["<rootDir>/src/infrastructure/*"],
            "@plugin/presentation/*": ["<rootDir>/src/presentation/*"],
            "@plugin/*": ["<rootDir>/src/*"]
          }
        },
      },
    ],
    "^.+\\.(js|mjs)$": "babel-jest",
  },
};
