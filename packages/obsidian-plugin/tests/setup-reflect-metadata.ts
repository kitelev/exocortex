// Global setup for TSyringe dependency injection in tests
import "reflect-metadata";

// jsdom does not implement the Web Performance API marks/measures used
// by the exocmd cold-start observability instrumentation (Issue #3175).
// Stub no-op implementations so production code that calls
// `performance.mark` / `performance.measure` does not throw in unit
// tests; tests that assert on these calls override with `jest.fn()`.
const perf = performance as unknown as Record<string, unknown>;
if (typeof perf["mark"] !== "function") {
  perf["mark"] = () => undefined;
}
if (typeof perf["measure"] !== "function") {
  perf["measure"] = () => undefined;
}
