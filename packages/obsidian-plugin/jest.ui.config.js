/**
 * Jest configuration for UI/Integration tests with Obsidian environment
 * Uses jest-environment-obsidian for better Obsidian API mocking
 * Note: Modal class is not stubbed in jest-environment-obsidian but
 * UniversalLayoutRenderer imports LabelInputModal which extends Modal.
 * The Modal is only used in button click handlers which are not tested here.
 */
module.exports = {
  preset: "jest-environment-obsidian",
  roots: ["<rootDir>/tests/ui"],
  testMatch: ["**/?(*.)+(ui|integration).test.ts"],
  testEnvironment: "jest-environment-obsidian",
  transform: {
    "^.+\\.(ts|tsx)$": [
      "ts-jest",
      {
        tsconfig: {
          jsx: "react",
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
  },
  transformIgnorePatterns: ["node_modules/(?!(react|react-dom)/)"],
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
    "\\.(css|less|scss|sass)$": "identity-obj-proxy",
    "^obsidian$": "<rootDir>/tests/__mocks__/obsidian.ts",
  },
  collectCoverageFrom: ["<rootDir>/src/presentation/**/*.ts"],
  coveragePathIgnorePatterns: ["/node_modules/", "/tests/"],
  testTimeout: 30000,
  verbose: true,
  setupFilesAfterEnv: ["<rootDir>/tests/setup-reflect-metadata.ts"],
};
