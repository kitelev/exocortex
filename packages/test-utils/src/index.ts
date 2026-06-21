/**
 * @kitelev/exocortex-test-utils
 *
 * Shared test utilities and mock factories for Exocortex packages.
 *
 * @example
 * import {
 *   TaskFactory,
 *   ProjectFactory,
 *   AreaFactory,
 *   MeetingFactory,
 *   createMockApp,
 *   createMockPlugin,
 *   flushPromises,
 *   waitForCondition,
 *   resetAllCounters,
 * } from "@kitelev/exocortex-test-utils";
 *
 * describe("MyComponent", () => {
 *   beforeEach(() => {
 *     resetAllCounters(); // Reset factory counters for deterministic IDs
 *   });
 *
 *   it("should render tasks", () => {
 *     const tasks = [
 *       TaskFactory.doing({ label: "In Progress Task" }),
 *       TaskFactory.done({ label: "Completed Task" }),
 *     ];
 *     // ... test with tasks
 *   });
 *
 *   it("should use mock app", () => {
 *     const mockApp = createMockApp();
 *     // ... test with mockApp
 *   });
 * });
 */

// Types
export * from "./types";

// Factories
export {
  TaskFactory,
  resetTaskCounter,
} from "./factories/task.factory";

export {
  ProjectFactory,
  resetProjectCounter,
} from "./factories/project.factory";

export {
  AreaFactory,
  resetAreaCounter,
} from "./factories/area.factory";

export {
  MeetingFactory,
  resetMeetingCounter,
} from "./factories/meeting.factory";

export { resetAllCounters } from "./factories";

// Helpers
export {
  // Obsidian mocks
  createMockTFile,
  createMockElement,
  createMockApp,
  createMockPlugin,
  createMockMetadata,
  createMockLogger,
  createMockReactRenderer,
  createMockVaultAdapter,
  createMockMetadataExtractor,
  createMockBacklinksCacheManager,
  // Types
  type MockVault,
  type MockMetadataCache,
  type MockWorkspace,
  type MockFileManager,
  type MockApp,
  type MockSettings,
  type MockPlugin,
  type MockLogger,
  type MockReactRenderer,
  type MockVaultAdapter,
  type MockMetadataExtractor,
  type MockBacklinksCacheManager,
} from "./helpers/obsidian.helpers";

export {
  // Async helpers
  flushPromises,
  waitForReact,
  waitForCondition,
  waitForDomElement,
  waitForDomElements,
  waitForDomElementRemoval,
  retry,
  delay,
  rejectAfter,
  withTimeout,
  // Types
  type WaitForConditionOptions,
  type WaitForDomElementOptions,
  type RetryOptions,
} from "./helpers/async.helpers";

// Reporters and Flaky Test Detection
export {
  FlakyReporter,
  QuarantineManager,
  loadQuarantine,
  getQuarantineManager,
  isTestQuarantined,
  shouldSkipTest,
  type FlakyTestInfo,
  type FlakyReport,
  type FlakyReporterOptions,
  type QuarantinedTest,
  type QuarantineConfig,
} from "./reporters";
