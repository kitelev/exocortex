module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
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
  // Handle ES modules from node_modules (uuid v13, rdf-validate-shacl and its dependencies)
  transformIgnorePatterns: [
    'node_modules/(?!(uuid|rdf-validate-shacl|@rdfjs|@vocabulary|clownface|rdf-dataset-ext|rdf-literal|rdf-validate-datatype|is-dataset-core|debug|n3)/)',
  ],
  transform: {
    '^.+\\.ts$': 'ts-jest',
    '^.+\\.(js|mjs)$': 'babel-jest',
  },
};