/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  globalSetup: "<rootDir>/src/jest/stripRepoGitEnv.cjs",
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  moduleFileExtensions: ["ts", "js"],
  testMatch: ["**/*.test.ts"],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: "tsconfig.json",
      },
    ],
  },
  moduleNameMapper: {
    "^@kitelev/exocortex-test-utils$": "<rootDir>/src/index.ts",
  },
};
