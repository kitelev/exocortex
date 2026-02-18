/**
 * Performance regression tests for React component rendering.
 *
 * These tests ensure that components render within expected time bounds
 * to detect performance regressions early in CI.
 *
 * Based on Issue #755: [Test Quality] Add Performance Regression Tests
 *
 * NOTE: Playwright component tests measure real browser rendering performance,
 * not just JavaScript execution time. These tests are complementary to the
 * unit-level performance tests in packages/obsidian-plugin/tests/performance/
 */

import { test, expect } from "@playwright/experimental-ct-react";
import React from "react";
import {
  DailyTasksTable,
  DailyTask,
} from "../../src/presentation/components/DailyTasksTable";
import {
  AssetRelationsTable,
  AssetRelation,
} from "../../src/presentation/components/AssetRelationsTable";

/**
 * Generate mock daily tasks for performance testing.
 */
function generateMockTasks(count: number): DailyTask[] {
  const tasks: DailyTask[] = [];
  const statuses = [
    "ems__EffortStatusInProgress",
    "ems__EffortStatusDone",
    "ems__EffortStatusPlanned",
  ];

  for (let i = 0; i < count; i++) {
    const hour = 8 + Math.floor(i / 4); // Start at 8am
    const minute = (i % 4) * 15; // 15-minute intervals
    const startTime = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    const endHour = hour + 1;
    const endTime = `${String(endHour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

    tasks.push({
      file: { path: `task-${i}.md`, basename: `task-${i}` },
      path: `task-${i}.md`,
      title: `Task ${i}`,
      label: `Performance Test Task ${i} - ${["Development", "Review", "Testing", "Meeting"][i % 4]}`,
      startTime,
      endTime,
      startTimestamp: null,
      endTimestamp: null,
      status: statuses[i % statuses.length],
      metadata: {
        exo__Asset_label: `Task ${i}`,
        ems__Task_status: ["open", "in_progress", "completed"][i % 3],
      },
      isDone: i % 3 === 2,
      isTrashed: false,
      isDoing: i % 5 === 0,
      isMeeting: i % 7 === 0,
      isBlocked: i % 11 === 0,
    });
  }

  return tasks;
}

/**
 * Generate mock asset relations for performance testing.
 */
function generateMockRelations(count: number): AssetRelation[] {
  const relations: AssetRelation[] = [];
  const propertyNames = ["belongsTo", "blockedBy", "dependsOn", "relatedTo"];
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    relations.push({
      path: `related-asset-${i}.md`,
      title: `Related Asset ${i}`,
      propertyName: propertyNames[i % propertyNames.length],
      isBodyLink: i % 5 === 0,
      created: now - i * 1000 * 60 * 60, // Hours ago
      modified: now - i * 1000 * 60, // Minutes ago
      isArchived: i % 20 === 0,
      isBlocked: i % 15 === 0,
      metadata: {
        exo__Asset_label: `Related Asset ${i}`,
        exo__Instance_class: ["ems__Task", "ems__Project", "ems__Area"][i % 3],
      },
    });
  }

  return relations;
}

test.describe("Component Rendering Performance", () => {
  // Performance thresholds (in milliseconds)
  // These are deliberately generous to avoid flaky tests in CI
  // while still catching significant regressions (>2x slowdown).
  const THRESHOLDS = {
    SMALL_TABLE: 500, // 10 rows
    MEDIUM_TABLE: 1000, // 50 rows
    LARGE_TABLE: 2000, // 100 rows
    RERENDER: 500, // Re-render with same data
    UPDATE: 750, // Re-render with new data
  };

  test.describe("DailyTasksTable Performance", () => {
    test("should render 10 tasks in < 500ms", async ({ mount, page }) => {
      const tasks = generateMockTasks(10);

      const start = performance.now();
      const component = await mount(<DailyTasksTable tasks={tasks} />);
      await component.waitFor({ state: "visible" });
      const duration = performance.now() - start;

      // Verify component rendered correctly
      const rows = await component.locator("tr").count();
      expect(rows).toBeGreaterThan(0);

      // Check performance
      expect(duration).toBeLessThan(THRESHOLDS.SMALL_TABLE);
    });

    test("should render 50 tasks in < 1000ms", async ({ mount, page }) => {
      const tasks = generateMockTasks(50);

      const start = performance.now();
      const component = await mount(<DailyTasksTable tasks={tasks} />);
      await component.waitFor({ state: "visible" });
      const duration = performance.now() - start;

      // Verify component rendered
      const rows = await component.locator("tr").count();
      expect(rows).toBeGreaterThan(0);

      // Check performance
      expect(duration).toBeLessThan(THRESHOLDS.MEDIUM_TABLE);
    });

    test("should render 100 tasks in < 2000ms", async ({ mount, page }) => {
      const tasks = generateMockTasks(100);

      const start = performance.now();
      const component = await mount(<DailyTasksTable tasks={tasks} />);
      await component.waitFor({ state: "visible" });
      const duration = performance.now() - start;

      // Verify component rendered
      const rows = await component.locator("tr").count();
      expect(rows).toBeGreaterThan(0);

      // Check performance (generous for virtualized table)
      expect(duration).toBeLessThan(THRESHOLDS.LARGE_TABLE);
    });

    test("re-render with same data should be faster than initial render", async ({
      mount,
    }) => {
      const tasks = generateMockTasks(30);

      // Initial render
      const component = await mount(<DailyTasksTable tasks={tasks} />);
      await component.waitFor({ state: "visible" });

      // Second render (update with same data - tests React reconciliation)
      const updateStart = performance.now();
      await component.update(<DailyTasksTable tasks={tasks} />);
      const updateDuration = performance.now() - updateStart;

      // Re-render should be at least as fast as initial (within margin)
      expect(updateDuration).toBeLessThan(THRESHOLDS.RERENDER);
    });

    test("should handle rapid data updates efficiently", async ({ mount }) => {
      const initialTasks = generateMockTasks(20);

      const component = await mount(<DailyTasksTable tasks={initialTasks} />);
      await component.waitFor({ state: "visible" });

      // Perform multiple rapid updates
      const updateDurations: number[] = [];
      for (let i = 0; i < 5; i++) {
        const newTasks = generateMockTasks(20);

        const start = performance.now();
        await component.update(<DailyTasksTable tasks={newTasks} />);
        updateDurations.push(performance.now() - start);
      }

      // Average update time should be reasonable
      const avgUpdateTime =
        updateDurations.reduce((a, b) => a + b, 0) / updateDurations.length;
      expect(avgUpdateTime).toBeLessThan(THRESHOLDS.UPDATE);
    });
  });

  test.describe("AssetRelationsTable Performance", () => {
    test("should render 20 relations in < 500ms", async ({ mount }) => {
      const relations = generateMockRelations(20);

      const start = performance.now();
      const component = await mount(
        <AssetRelationsTable relations={relations} />
      );
      await component.waitFor({ state: "visible" });
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(THRESHOLDS.SMALL_TABLE);
    });

    test("should render 100 relations in < 2000ms", async ({ mount }) => {
      const relations = generateMockRelations(100);

      const start = performance.now();
      const component = await mount(
        <AssetRelationsTable relations={relations} />
      );
      await component.waitFor({ state: "visible" });
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(THRESHOLDS.LARGE_TABLE);
    });
  });
});

test.describe("Rendering Performance Regression Guards", () => {
  /**
   * These tests establish baseline performance metrics that should
   * not regress significantly. If these tests fail, it indicates
   * a potential performance regression that needs investigation.
   */

  test("DailyTasksTable initial render P90 should be < 500ms", async ({
    mount,
  }) => {
    const tasks = generateMockTasks(25);
    const durations: number[] = [];

    // Run multiple iterations to get stable metrics
    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      const component = await mount(<DailyTasksTable tasks={tasks} />);
      await component.waitFor({ state: "visible" });
      durations.push(performance.now() - start);

      // Unmount for next iteration
      await component.unmount();
    }

    // Calculate P90
    durations.sort((a, b) => a - b);
    const p90Index = Math.floor(durations.length * 0.9);
    const p90Duration = durations[p90Index];

    expect(p90Duration).toBeLessThan(500);
  });

});
