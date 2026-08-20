module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFiles: ['reflect-metadata'],
  roots: ['<rootDir>/tests'],
  moduleNameMapper: {
    // `test-utils` is a private workspace package with no build step; tests
    // resolve it straight from source. Mapped to the helper FILE rather than the
    // package index on purpose — the index also re-exports Obsidian mocks and
    // the flaky reporter, which a node-environment core test has no business
    // loading.
    '^@kitelev/exocortex-test-utils$':
      '<rootDir>/../test-utils/src/helpers/frontmatter.helpers.ts',
  },
  testMatch: ['**/?(*.)+(spec|test).ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 95,
      functions: 95,
      lines: 95,
      statements: 95,
    },
  },
  // Handle ES modules from node_modules (uuid v13)
  transformIgnorePatterns: ['node_modules/(?!(uuid)/)'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
    '^.+\\.(js|mjs)$': 'babel-jest',
  },
};