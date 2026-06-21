/**
 * Test factories for creating mock data.
 *
 * @example
 * import { TaskFactory, ProjectFactory, AreaFactory } from "@kitelev/exocortex-test-utils";
 *
 * // Create fixtures
 * const task = TaskFactory.doing();
 * const project = ProjectFactory.inArea("work-area");
 * const area = AreaFactory.work();
 *
 * // Create DailyTask for React components
 * const dailyTask = TaskFactory.createDailyTask();
 *
 * // Reset counters in beforeEach
 * beforeEach(() => {
 *   resetAllCounters();
 * });
 */

export { TaskFactory, resetTaskCounter } from "./task.factory";
export { ProjectFactory, resetProjectCounter } from "./project.factory";
export { AreaFactory, resetAreaCounter } from "./area.factory";
export { MeetingFactory, resetMeetingCounter } from "./meeting.factory";

import { resetTaskCounter } from "./task.factory";
import { resetProjectCounter } from "./project.factory";
import { resetAreaCounter } from "./area.factory";
import { resetMeetingCounter } from "./meeting.factory";

/**
 * Reset all factory counters. Call this in beforeEach() for deterministic test data.
 */
export function resetAllCounters(): void {
  resetTaskCounter();
  resetProjectCounter();
  resetAreaCounter();
  resetMeetingCounter();
}
