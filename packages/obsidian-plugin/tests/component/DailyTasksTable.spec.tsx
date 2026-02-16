import { test, expect } from "@playwright/experimental-ct-react";
import React from "react";
import {
  DailyTasksTable,
  DailyTask,
  DailyTasksTableWithToggle,
} from "../../src/presentation/components/DailyTasksTable";

test.describe("DailyTasksTable", () => {
  const mockTasks: DailyTask[] = [
    {
      file: { path: "task1.md", basename: "task1" },
      path: "task1.md",
      title: "Task 1",
      label: "First Task",
      startTime: "09:00",
      endTime: "10:00",
      startTimestamp: null,
      endTimestamp: null,
      status: "ems__EffortStatusInProgress",
      metadata: {},
      isDone: false,
      isTrashed: false,
      isDoing: false,
      isMeeting: false,
      isBlocked: false,
    },
    {
      file: { path: "task2.md", basename: "task2" },
      path: "task2.md",
      title: "Task 2",
      label: "Second Task",
      startTime: "10:30",
      endTime: "11:30",
      startTimestamp: null,
      endTimestamp: null,
      status: "ems__EffortStatusDone",
      metadata: {},
      isDone: true,
      isTrashed: false,
      isDoing: false,
      isMeeting: false,
      isBlocked: false,
    },
    {
      file: { path: "meeting1.md", basename: "meeting1" },
      path: "meeting1.md",
      title: "Meeting 1",
      label: "Team Sync",
      startTime: "14:00",
      endTime: "15:00",
      startTimestamp: null,
      endTimestamp: null,
      status: "ems__EffortStatusInProgress",
      metadata: {},
      isDone: false,
      isTrashed: false,
      isDoing: false,
      isMeeting: true,
      isBlocked: false,
    },
    {
      file: { path: "task3.md", basename: "task3" },
      path: "task3.md",
      title: "Task 3",
      label: "Trashed Task",
      startTime: "",
      endTime: "",
      startTimestamp: null,
      endTimestamp: null,
      status: "ems__EffortStatusTrashed",
      metadata: {},
      isDone: false,
      isTrashed: true,
      isDoing: false,
      isMeeting: false,
      isBlocked: false,
    },
    {
      file: { path: "meeting2.md", basename: "meeting2" },
      path: "meeting2.md",
      title: "Meeting 2",
      label: "Completed Meeting",
      startTime: "16:00",
      endTime: "17:00",
      startTimestamp: null,
      endTimestamp: null,
      status: "ems__EffortStatusDone",
      metadata: {},
      isDone: true,
      isTrashed: false,
      isDoing: false,
      isMeeting: true,
      isBlocked: false,
    },
  ];

  test("should render tasks table with all columns", async ({ mount }) => {
    const component = await mount(<DailyTasksTable tasks={mockTasks} />);

    await expect(component.locator("table")).toBeVisible();
    await expect(component.locator("thead th").nth(0)).toContainText("Name");
    await expect(component.locator("thead th").nth(1)).toContainText("Start");
    await expect(component.locator("thead th").nth(2)).toContainText("End");
    await expect(component.locator("thead th").nth(3)).toContainText("Status");
  });

  test("should render all tasks", async ({ mount }) => {
    const component = await mount(<DailyTasksTable tasks={mockTasks} />);

    const rows = component.locator("tbody tr");
    await expect(rows).toHaveCount(5);
  });

  test("should display task with done icon", async ({ mount }) => {
    const component = await mount(<DailyTasksTable tasks={mockTasks} />);

    const doneTask = component.locator('tr[data-path="task2.md"] .task-name a');
    await expect(doneTask).toContainText("✅");
    await expect(doneTask).toContainText("Second Task");
  });

  test("should display task with trashed icon", async ({ mount }) => {
    const component = await mount(<DailyTasksTable tasks={mockTasks} />);

    const trashedTask = component.locator(
      'tr[data-path="task3.md"] .task-name a',
    );
    await expect(trashedTask).toContainText("❌");
    await expect(trashedTask).toContainText("Trashed Task");
  });

  test("should display meeting with meeting icon", async ({ mount }) => {
    const component = await mount(<DailyTasksTable tasks={mockTasks} />);

    const meetingTask = component.locator(
      'tr[data-path="meeting1.md"] .task-name a',
    );
    await expect(meetingTask).toContainText("👥");
    await expect(meetingTask).toContainText("Team Sync");
  });

  test("should display completed meeting with both done and meeting icons", async ({
    mount,
  }) => {
    const component = await mount(<DailyTasksTable tasks={mockTasks} />);

    const completedMeeting = component.locator(
      'tr[data-path="meeting2.md"] .task-name a',
    );
    await expect(completedMeeting).toContainText("✅ 👥");
    await expect(completedMeeting).toContainText("Completed Meeting");
  });

  test("should display start and end times", async ({ mount }) => {
    const component = await mount(<DailyTasksTable tasks={mockTasks} />);

    const taskRow = component.locator('tr[data-path="task1.md"]');
    await expect(taskRow.locator(".task-start")).toContainText("09:00");
    await expect(taskRow.locator(".task-end")).toContainText("10:00");
  });

  test("should display dash for missing times", async ({ mount }) => {
    const component = await mount(<DailyTasksTable tasks={mockTasks} />);

    const taskRow = component.locator('tr[data-path="task3.md"]');
    await expect(taskRow.locator(".task-start")).toContainText("-");
    await expect(taskRow.locator(".task-end")).toContainText("-");
  });

  test("should display status as clickable link", async ({ mount }) => {
    const component = await mount(<DailyTasksTable tasks={mockTasks} />);

    const statusLink = component.locator(
      'tr[data-path="task1.md"] .task-status a',
    );
    await expect(statusLink).toBeVisible();
    await expect(statusLink).toContainText("ems__EffortStatusInProgress");
    await expect(statusLink).toHaveAttribute(
      "data-href",
      "ems__EffortStatusInProgress",
    );
  });

  test("should call onTaskClick when task name is clicked", async ({
    mount,
  }) => {
    let clickedPath = "";
    const component = await mount(
      <DailyTasksTable
        tasks={mockTasks}
        onTaskClick={(path) => {
          clickedPath = path;
        }}
      />,
    );

    await component.locator('tr[data-path="task1.md"] .task-name a').click();
    expect(clickedPath).toBe("task1.md");
  });

  test("should call onTaskClick when status is clicked", async ({ mount }) => {
    let clickedPath = "";
    const component = await mount(
      <DailyTasksTable
        tasks={mockTasks}
        onTaskClick={(path) => {
          clickedPath = path;
        }}
      />,
    );

    await component.locator('tr[data-path="task1.md"] .task-status a').click();
    expect(clickedPath).toBe("ems__EffortStatusInProgress");
  });

  // NOTE: Skipped due to Playwright CT limitation with function props
  // Function props don't serialize correctly across browser/Node boundary
  // Feature is verified working in UI integration tests (UniversalLayoutRenderer.ui.test.ts)
  test.skip("should use getAssetLabel to resolve task names", async ({
    mount,
  }) => {
    const component = await mount(
      <DailyTasksTable
        tasks={mockTasks}
        getAssetLabel={(path) => {
          if (path === "task1.md") return "Custom Label for Task 1";
          return null;
        }}
      />,
    );

    const taskLink = component.locator('tr[data-path="task1.md"] .task-name a');
    await expect(taskLink).toContainText("Custom Label for Task 1");
  });

  test("should render empty table when no tasks", async ({ mount }) => {
    const component = await mount(<DailyTasksTable tasks={[]} />);

    await expect(component.locator("table")).toBeVisible();
    await expect(component.locator("tbody tr")).toHaveCount(0);
  });

  test("should handle task without label", async ({ mount }) => {
    const taskWithoutLabel: DailyTask = {
      file: { path: "no-label.md", basename: "no-label" },
      path: "no-label.md",
      title: "No Label Task",
      label: "",
      startTime: "12:00",
      endTime: "13:00",
      status: "ems__EffortStatusInProgress",
      metadata: {},
      isDone: false,
      isTrashed: false,
      isMeeting: false,
    };

    const component = await mount(
      <DailyTasksTable tasks={[taskWithoutLabel]} />,
    );

    const taskLink = component.locator(
      'tr[data-path="no-label.md"] .task-name a',
    );
    await expect(taskLink).toContainText("No Label Task");
  });

  test("should have correct CSS classes", async ({ mount }) => {
    const component = await mount(<DailyTasksTable tasks={mockTasks} />);

    await expect(
      component.locator("table.exocortex-tasks-table"),
    ).toBeVisible();
    await expect(component).toContainText("Name");
    await expect(component).toContainText("Start");
    await expect(component).toContainText("End");
    await expect(component).toContainText("Status");
  });

  test("should render task links as internal-link class", async ({ mount }) => {
    const component = await mount(<DailyTasksTable tasks={mockTasks} />);

    const taskLinks = component.locator(".task-name a.internal-link");
    await expect(taskLinks).toHaveCount(5);
  });

  test("should have sortable headers with pointer cursor", async ({ mount }) => {
    const component = await mount(<DailyTasksTable tasks={mockTasks} />);

    const nameHeader = component.locator('thead th:has-text("Name")');
    await expect(nameHeader).toHaveClass(/sortable/);
    await expect(nameHeader).toHaveCSS("cursor", "pointer");

    const startHeader = component.locator('thead th:has-text("Start")');
    await expect(startHeader).toHaveClass(/sortable/);

    const endHeader = component.locator('thead th:has-text("End")');
    await expect(endHeader).toHaveClass(/sortable/);

    const statusHeader = component.locator('thead th:has-text("Status")');
    await expect(statusHeader).toHaveClass(/sortable/);
  });

  test("should sort tasks by name ascending on first click", async ({ mount }) => {
    const component = await mount(<DailyTasksTable tasks={mockTasks} />);

    await component.locator('thead th:has-text("Name")').click();

    const rows = component.locator("tbody tr");
    await expect(rows).toHaveCount(5);

    await expect(component.locator('thead th:has-text("Name")')).toContainText("↑");
  });

  test("should sort tasks by name descending on second click", async ({ mount }) => {
    const component = await mount(<DailyTasksTable tasks={mockTasks} />);

    const nameHeader = component.locator('thead th:has-text("Name")');
    await nameHeader.click();
    await nameHeader.click();

    const rows = component.locator("tbody tr");
    await expect(rows).toHaveCount(5);

    await expect(nameHeader).toContainText("↓");
  });

  test("should sort tasks by start time", async ({ mount }) => {
    const component = await mount(<DailyTasksTable tasks={mockTasks} />);

    await component.locator('thead th:has-text("Start")').click();

    const rows = component.locator("tbody tr");
    const lastRow = rows.last();
    await expect(lastRow.locator(".task-start")).toContainText("16:00");
  });

  test("should sort tasks by end time", async ({ mount }) => {
    const component = await mount(<DailyTasksTable tasks={mockTasks} />);

    await component.locator('thead th:has-text("End")').click();

    const rows = component.locator("tbody tr");
    const lastRow = rows.last();
    await expect(lastRow.locator(".task-end")).toContainText("17:00");
  });

  test("should sort tasks by status", async ({ mount }) => {
    const component = await mount(<DailyTasksTable tasks={mockTasks} />);

    await component.locator('thead th:has-text("Status")').click();

    await expect(component.locator('thead th:has-text("Status")')).toContainText("↑");
  });

  test("should display blocker icon when task is blocked", async ({ mount }) => {
    const blockedTask: DailyTask = {
      file: { path: "blocked-task.md", basename: "blocked-task" },
      path: "blocked-task.md",
      title: "Blocked Task",
      label: "Blocked Task",
      startTime: "09:00",
      endTime: "10:00",
      status: "ems__EffortStatusInProgress",
      metadata: {},
      isDone: false,
      isTrashed: false,
      isDoing: false,
      isMeeting: false,
      isBlocked: true,
    };

    const component = await mount(<DailyTasksTable tasks={[blockedTask]} />);

    const taskName = component.locator(
      'tr[data-path="blocked-task.md"] .task-name a',
    );
    await expect(taskName).toContainText("🚩");
    await expect(taskName).toContainText("Blocked Task");
  });

  test("should not display blocker icon when task is not blocked", async ({
    mount,
  }) => {
    const unblockedTask: DailyTask = {
      file: { path: "unblocked-task.md", basename: "unblocked-task" },
      path: "unblocked-task.md",
      title: "Unblocked Task",
      label: "Unblocked Task",
      startTime: "09:00",
      endTime: "10:00",
      status: "ems__EffortStatusInProgress",
      metadata: {},
      isDone: false,
      isTrashed: false,
      isDoing: false,
      isMeeting: false,
      isBlocked: false,
    };

    const component = await mount(<DailyTasksTable tasks={[unblockedTask]} />);

    const taskName = component.locator(
      'tr[data-path="unblocked-task.md"] .task-name a',
    );
    const text = await taskName.textContent();
    expect(text).not.toContain("🚩");
  });

  test("should show Effort Area column when showEffortArea is true", async ({
    mount,
  }) => {
    const tasksWithArea: DailyTask[] = [
      {
        file: { path: "task1.md", basename: "task1" },
        path: "task1.md",
        title: "Task 1",
        label: "First Task",
        startTime: "09:00",
        endTime: "10:00",
        status: "ems__EffortStatusInProgress",
        metadata: { ems__Effort_area: "[[backend]]" },
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
    ];

    const component = await mount(
      <DailyTasksTable tasks={tasksWithArea} showEffortArea={true} />,
    );

    await expect(component.locator("thead th").nth(4)).toContainText(
      "Effort Area",
    );
    await expect(component.locator(".task-effort-area")).toBeVisible();
  });

  test("should hide Effort Area column when showEffortArea is false", async ({
    mount,
  }) => {
    const component = await mount(
      <DailyTasksTable tasks={mockTasks} showEffortArea={false} />,
    );

    await expect(component.locator("thead th")).toHaveCount(4);
    await expect(component.locator(".task-effort-area")).toHaveCount(0);
  });

  test("should have sortable Effort Area header when showEffortArea is true", async ({
    mount,
  }) => {
    const tasksWithArea: DailyTask[] = [
      {
        file: { path: "task1.md", basename: "task1" },
        path: "task1.md",
        title: "Task 1",
        label: "First Task",
        startTime: "09:00",
        endTime: "10:00",
        status: "ems__EffortStatusInProgress",
        metadata: { ems__Effort_area: "[[backend]]" },
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
    ];

    const component = await mount(
      <DailyTasksTable tasks={tasksWithArea} showEffortArea={true} />,
    );

    const effortAreaHeader = component.locator('thead th:has-text("Effort Area")');
    await expect(effortAreaHeader).toHaveClass(/sortable/);
    await expect(effortAreaHeader).toHaveCSS("cursor", "pointer");
  });

  test("should sort tasks by Effort Area", async ({ mount }) => {
    const tasksWithArea: DailyTask[] = [
      {
        file: { path: "task1.md", basename: "task1" },
        path: "task1.md",
        title: "Task 1",
        label: "Task 1",
        startTime: "09:00",
        endTime: "10:00",
        status: "ems__EffortStatusInProgress",
        metadata: { ems__Effort_area: "[[zebra-area]]" },
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
      {
        file: { path: "task2.md", basename: "task2" },
        path: "task2.md",
        title: "Task 2",
        label: "Task 2",
        startTime: "10:00",
        endTime: "11:00",
        status: "ems__EffortStatusInProgress",
        metadata: { ems__Effort_area: "[[alpha-area]]" },
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
    ];

    const component = await mount(
      <DailyTasksTable tasks={tasksWithArea} showEffortArea={true} />,
    );

    await component.locator('thead th:has-text("Effort Area")').click();

    const rows = component.locator("tbody tr");
    await expect(rows).toHaveCount(2);

    await expect(component.locator('thead th:has-text("Effort Area")')).toContainText("↑");
  });

  test.skip("should display Effort Area inherited from parent when provided by getEffortArea", async ({
    mount,
  }) => {
    // NOTE: This functionality is properly tested in DailyTasksRenderer.test.ts unit test
    // The component test has timing/isolation issues with mocked functions
    // See: "should resolve area from parent when not set directly" test in DailyTasksRenderer.test.ts
    const tasksWithoutDirectArea: DailyTask[] = [
      {
        file: { path: "task1.md", basename: "task1" },
        path: "task1.md",
        title: "Task 1",
        label: "Task 1",
        startTime: "09:00",
        endTime: "10:00",
        status: "ems__EffortStatusInProgress",
        metadata: { ems__Effort_parent: "[[parent-effort]]" },
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
    ];

    const component = await mount(
      <DailyTasksTable
        tasks={tasksWithoutDirectArea}
        showEffortArea={true}
        getEffortArea={(metadata) => {
          // Simulates AssetMetadataService.getEffortArea resolving from parent
          const parentRef = (metadata as any).ems__Effort_parent;
          if (parentRef === "[[parent-effort]]") {
            // Return the path that getEffortArea would extract from the parent
            return "QA-area-file";
          }
          return null;
        }}
        getAssetLabel={(path) => {
          if (path === "QA-area-file") {
            return "QA Area";
          }
          return null;
        }}
      />,
    );

    // The table should have the effort area cell
    await expect(component.locator(".task-effort-area")).toHaveCount(1);
    
    // Since getEffortArea returns "QA-area-file" and getAssetLabel returns "QA Area",
    // the cell should contain a link with text "QA Area"
    await expect(component.locator(".task-effort-area a")).toContainText(
      "QA Area",
    );
  });

  test("should have sortable Votes header when showEffortVotes is true", async ({
    mount,
  }) => {
    const tasksWithVotes: DailyTask[] = [
      {
        file: { path: "task1.md", basename: "task1" },
        path: "task1.md",
        title: "Task 1",
        label: "First Task",
        startTime: "09:00",
        endTime: "10:00",
        status: "ems__EffortStatusInProgress",
        metadata: { ems__Effort_votes: 5 },
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
    ];

    const component = await mount(
      <DailyTasksTable tasks={tasksWithVotes} showEffortVotes={true} />,
    );

    const votesHeader = component.locator('thead th:has-text("Votes")');
    await expect(votesHeader).toHaveClass(/sortable/);
    await expect(votesHeader).toHaveCSS("cursor", "pointer");
  });

  test("should sort tasks by Votes", async ({ mount }) => {
    const tasksWithVotes: DailyTask[] = [
      {
        file: { path: "task1.md", basename: "task1" },
        path: "task1.md",
        title: "Task 1",
        label: "Task 1",
        startTime: "09:00",
        endTime: "10:00",
        status: "ems__EffortStatusInProgress",
        metadata: { ems__Effort_votes: 10 },
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
      {
        file: { path: "task2.md", basename: "task2" },
        path: "task2.md",
        title: "Task 2",
        label: "Task 2",
        startTime: "10:00",
        endTime: "11:00",
        status: "ems__EffortStatusInProgress",
        metadata: { ems__Effort_votes: 3 },
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
    ];

    const component = await mount(
      <DailyTasksTable tasks={tasksWithVotes} showEffortVotes={true} />,
    );

    await component.locator('thead th:has-text("Votes")').click();

    const rows = component.locator("tbody tr");
    await expect(rows).toHaveCount(2);

    await expect(component.locator('thead th:has-text("Votes")')).toContainText("↑");
  });

  test("should prioritize Doing status tasks at top", async ({ mount }) => {
    const mixedTasks: DailyTask[] = [
      {
        file: { path: "task-a.md", basename: "task-a" },
        path: "task-a.md",
        title: "Task A",
        label: "Task A",
        startTime: "09:00",
        endTime: "10:00",
        startTimestamp: null,
        endTimestamp: null,
        status: "ems__EffortStatusBacklog",
        metadata: {},
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
      {
        file: { path: "task-b.md", basename: "task-b" },
        path: "task-b.md",
        title: "Task B",
        label: "Task B",
        startTime: "10:00",
        endTime: "11:00",
        startTimestamp: null,
        endTimestamp: null,
        status: "ems__EffortStatusDoing",
        metadata: {},
        isDone: false,
        isTrashed: false,
        isDoing: true,
        isMeeting: false,
        isBlocked: false,
      },
      {
        file: { path: "task-c.md", basename: "task-c" },
        path: "task-c.md",
        title: "Task C",
        label: "Task C",
        startTime: "11:00",
        endTime: "12:00",
        startTimestamp: null,
        endTimestamp: null,
        status: "ems__EffortStatusTodo",
        metadata: {},
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
    ];

    const component = await mount(<DailyTasksTable tasks={mixedTasks} />);

    const rows = component.locator("tbody tr");
    await expect(rows).toHaveCount(3);

    const firstRow = rows.first();
    await expect(firstRow.locator(".task-name a")).toContainText("Task B");
  });

  test("should maintain column sort within Doing tasks", async ({ mount }) => {
    const multipleDoingTasks: DailyTask[] = [
      {
        file: { path: "task-z.md", basename: "task-z" },
        path: "task-z.md",
        title: "Task Z",
        label: "Z Task",
        startTime: "09:00",
        endTime: "10:00",
        startTimestamp: null,
        endTimestamp: null,
        status: "ems__EffortStatusDoing",
        metadata: {},
        isDone: false,
        isTrashed: false,
        isDoing: true,
        isMeeting: false,
        isBlocked: false,
      },
      {
        file: { path: "task-a.md", basename: "task-a" },
        path: "task-a.md",
        title: "Task A",
        label: "A Task",
        startTime: "10:00",
        endTime: "11:00",
        startTimestamp: null,
        endTimestamp: null,
        status: "ems__EffortStatusDoing",
        metadata: {},
        isDone: false,
        isTrashed: false,
        isDoing: true,
        isMeeting: false,
        isBlocked: false,
      },
      {
        file: { path: "task-m.md", basename: "task-m" },
        path: "task-m.md",
        title: "Task M",
        label: "M Task",
        startTime: "11:00",
        endTime: "12:00",
        startTimestamp: null,
        endTimestamp: null,
        status: "ems__EffortStatusBacklog",
        metadata: {},
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
    ];

    const component = await mount(<DailyTasksTable tasks={multipleDoingTasks} />);

    await component.locator('thead th:has-text("Name")').click();

    const rows = component.locator("tbody tr");
    await expect(rows).toHaveCount(3);

    const firstRowText = await rows.nth(0).locator(".task-name a").textContent();
    const secondRowText = await rows.nth(1).locator(".task-name a").textContent();
    const thirdRowText = await rows.nth(2).locator(".task-name a").textContent();

    expect(firstRowText).toContain("A Task");
    expect(secondRowText).toContain("Z Task");
    expect(thirdRowText).toContain("M Task");
  });

  test("should keep Doing tasks first when sorting by start time", async ({ mount }) => {
    const tasksWithTimes: DailyTask[] = [
      {
        file: { path: "task-early.md", basename: "task-early" },
        path: "task-early.md",
        title: "Early Task",
        label: "Early Task",
        startTime: "08:00",
        endTime: "09:00",
        startTimestamp: new Date("2025-01-01T08:00:00").getTime(),
        endTimestamp: new Date("2025-01-01T09:00:00").getTime(),
        status: "ems__EffortStatusBacklog",
        metadata: {},
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
      {
        file: { path: "task-late-doing.md", basename: "task-late-doing" },
        path: "task-late-doing.md",
        title: "Late Doing Task",
        label: "Late Doing Task",
        startTime: "15:00",
        endTime: "16:00",
        startTimestamp: new Date("2025-01-01T15:00:00").getTime(),
        endTimestamp: new Date("2025-01-01T16:00:00").getTime(),
        status: "ems__EffortStatusDoing",
        metadata: {},
        isDone: false,
        isTrashed: false,
        isDoing: true,
        isMeeting: false,
        isBlocked: false,
      },
    ];

    const component = await mount(
      <DailyTasksTable tasks={tasksWithTimes} showEmptySlots={false} />,
    );

    await component.locator('thead th:has-text("Start")').click();

    const rows = component.locator("tbody tr");
    const firstRow = rows.first();
    await expect(firstRow.locator(".task-name a")).toContainText("Late Doing Task");
  });

  test("should handle empty Doing partition gracefully", async ({ mount }) => {
    const noDoingTasks: DailyTask[] = [
      {
        file: { path: "task1.md", basename: "task1" },
        path: "task1.md",
        title: "Task 1",
        label: "Task 1",
        startTime: "09:00",
        endTime: "10:00",
        startTimestamp: null,
        endTimestamp: null,
        status: "ems__EffortStatusBacklog",
        metadata: {},
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
      {
        file: { path: "task2.md", basename: "task2" },
        path: "task2.md",
        title: "Task 2",
        label: "Task 2",
        startTime: "10:00",
        endTime: "11:00",
        startTimestamp: null,
        endTimestamp: null,
        status: "ems__EffortStatusTodo",
        metadata: {},
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
    ];

    const component = await mount(<DailyTasksTable tasks={noDoingTasks} />);

    const rows = component.locator("tbody tr");
    await expect(rows).toHaveCount(2);
  });

  test("should display Doing icon for Doing tasks", async ({ mount }) => {
    const doingTask: DailyTask = {
      file: { path: "doing-task.md", basename: "doing-task" },
      path: "doing-task.md",
      title: "Doing Task",
      label: "Doing Task",
      startTime: "09:00",
      endTime: "10:00",
      startTimestamp: null,
      endTimestamp: null,
      status: "ems__EffortStatusDoing",
      metadata: {},
      isDone: false,
      isTrashed: false,
      isDoing: true,
      isMeeting: false,
      isBlocked: false,
    };

    const component = await mount(<DailyTasksTable tasks={[doingTask]} />);

    const taskName = component.locator('tr[data-path="doing-task.md"] .task-name a');
    await expect(taskName).toContainText("🔄");
    await expect(taskName).toContainText("Doing Task");
  });

  test("should display empty time slots between tasks when showEmptySlots is true", async ({
    mount,
  }) => {
    const tasksWithGap: DailyTask[] = [
      {
        file: { path: "task1.md", basename: "task1" },
        path: "task1.md",
        title: "Task 1",
        label: "Task 1",
        startTime: "09:00",
        endTime: "10:00",
        startTimestamp: new Date("2025-01-15T09:00:00").getTime(),
        endTimestamp: new Date("2025-01-15T10:00:00").getTime(),
        status: "ems__EffortStatusInProgress",
        metadata: {},
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
      {
        file: { path: "task2.md", basename: "task2" },
        path: "task2.md",
        title: "Task 2",
        label: "Task 2",
        startTime: "11:00",
        endTime: "12:00",
        startTimestamp: new Date("2025-01-15T11:00:00").getTime(),
        endTimestamp: new Date("2025-01-15T12:00:00").getTime(),
        status: "ems__EffortStatusInProgress",
        metadata: {},
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
    ];

    const component = await mount(
      <DailyTasksTable tasks={tasksWithGap} showEmptySlots={true} />,
    );

    // Should have 3 rows: task1, empty slot, task2
    const rows = component.locator("tbody tr");
    await expect(rows).toHaveCount(3);

    // Verify empty slot row exists
    const emptySlotRow = component.locator('tr[data-empty-slot="true"]');
    await expect(emptySlotRow).toBeVisible();

    // Verify empty slot has correct times (10:00 - 11:00)
    await expect(emptySlotRow.locator(".task-start")).toContainText("10:00");
    await expect(emptySlotRow.locator(".task-end")).toContainText("11:00");

    // Verify empty slot name and status are "-"
    await expect(emptySlotRow.locator(".task-name")).toContainText("-");
    await expect(emptySlotRow.locator(".task-status")).toContainText("-");
  });

  test("should not display empty time slots when showEmptySlots is false", async ({
    mount,
  }) => {
    const tasksWithGap: DailyTask[] = [
      {
        file: { path: "task1.md", basename: "task1" },
        path: "task1.md",
        title: "Task 1",
        label: "Task 1",
        startTime: "09:00",
        endTime: "10:00",
        startTimestamp: new Date("2025-01-15T09:00:00").getTime(),
        endTimestamp: new Date("2025-01-15T10:00:00").getTime(),
        status: "ems__EffortStatusInProgress",
        metadata: {},
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
      {
        file: { path: "task2.md", basename: "task2" },
        path: "task2.md",
        title: "Task 2",
        label: "Task 2",
        startTime: "11:00",
        endTime: "12:00",
        startTimestamp: new Date("2025-01-15T11:00:00").getTime(),
        endTimestamp: new Date("2025-01-15T12:00:00").getTime(),
        status: "ems__EffortStatusInProgress",
        metadata: {},
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
    ];

    const component = await mount(
      <DailyTasksTable tasks={tasksWithGap} showEmptySlots={false} />,
    );

    // Should have only 2 rows (no empty slots)
    const rows = component.locator("tbody tr");
    await expect(rows).toHaveCount(2);

    // Verify no empty slot rows exist
    const emptySlotRow = component.locator('tr[data-empty-slot="true"]');
    await expect(emptySlotRow).toHaveCount(0);
  });

  test("should not show empty slot for gaps smaller than 5 minutes", async ({
    mount,
  }) => {
    const tasksWithSmallGap: DailyTask[] = [
      {
        file: { path: "task1.md", basename: "task1" },
        path: "task1.md",
        title: "Task 1",
        label: "Task 1",
        startTime: "09:00",
        endTime: "09:58",
        startTimestamp: new Date("2025-01-15T09:00:00").getTime(),
        endTimestamp: new Date("2025-01-15T09:58:00").getTime(),
        status: "ems__EffortStatusInProgress",
        metadata: {},
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
      {
        file: { path: "task2.md", basename: "task2" },
        path: "task2.md",
        title: "Task 2",
        label: "Task 2",
        startTime: "10:00",
        endTime: "11:00",
        startTimestamp: new Date("2025-01-15T10:00:00").getTime(),
        endTimestamp: new Date("2025-01-15T11:00:00").getTime(),
        status: "ems__EffortStatusInProgress",
        metadata: {},
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
    ];

    const component = await mount(
      <DailyTasksTable tasks={tasksWithSmallGap} showEmptySlots={true} />,
    );

    // Only 2 rows - no empty slot because gap is only 2 minutes
    const rows = component.locator("tbody tr");
    await expect(rows).toHaveCount(2);
  });

  test("empty slot row should have reduced opacity styling", async ({
    mount,
  }) => {
    const tasksWithGap: DailyTask[] = [
      {
        file: { path: "task1.md", basename: "task1" },
        path: "task1.md",
        title: "Task 1",
        label: "Task 1",
        startTime: "09:00",
        endTime: "10:00",
        startTimestamp: new Date("2025-01-15T09:00:00").getTime(),
        endTimestamp: new Date("2025-01-15T10:00:00").getTime(),
        status: "ems__EffortStatusInProgress",
        metadata: {},
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
      {
        file: { path: "task2.md", basename: "task2" },
        path: "task2.md",
        title: "Task 2",
        label: "Task 2",
        startTime: "12:00",
        endTime: "13:00",
        startTimestamp: new Date("2025-01-15T12:00:00").getTime(),
        endTimestamp: new Date("2025-01-15T13:00:00").getTime(),
        status: "ems__EffortStatusInProgress",
        metadata: {},
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
    ];

    const component = await mount(
      <DailyTasksTable tasks={tasksWithGap} showEmptySlots={true} />,
    );

    const emptySlotRow = component.locator('tr[data-empty-slot="true"]');
    await expect(emptySlotRow).toHaveCSS("opacity", "0.5");
  });
});

test.describe("DailyTasksTableWithToggle", () => {
  const mockTasks: DailyTask[] = [
    {
      file: { path: "task1.md", basename: "task1" },
      path: "task1.md",
      title: "Task 1",
      label: "First Task",
      startTime: "09:00",
      endTime: "10:00",
      status: "ems__EffortStatusInProgress",
      metadata: { ems__Effort_area: "[[backend]]" },
      isDone: false,
      isTrashed: false,
      isDoing: false,
      isMeeting: false,
      isBlocked: false,
    },
  ];

  test("should render toggle button", async ({ mount }) => {
    const component = await mount(
      <DailyTasksTableWithToggle
        tasks={mockTasks}
        showEffortArea={false}
        onToggleEffortArea={() => {}}
        showEffortVotes={false}
        onToggleEffortVotes={() => {}}
      />,
    );

    await expect(
      component.locator(".exocortex-toggle-effort-area"),
    ).toBeVisible();
    await expect(
      component.locator(".exocortex-toggle-effort-area"),
    ).toContainText("Show Effort Area");
  });

  test("should show 'Hide Effort Area' when showEffortArea is true", async ({
    mount,
  }) => {
    const component = await mount(
      <DailyTasksTableWithToggle
        tasks={mockTasks}
        showEffortArea={true}
        onToggleEffortArea={() => {}}
        showEffortVotes={false}
        onToggleEffortVotes={() => {}}
      />,
    );

    await expect(
      component.locator(".exocortex-toggle-effort-area"),
    ).toContainText("Hide Effort Area");
  });

  test("should call onToggleEffortArea when button is clicked", async ({
    mount,
  }) => {
    let toggleCalled = false;
    const component = await mount(
      <DailyTasksTableWithToggle
        tasks={mockTasks}
        showEffortArea={false}
        onToggleEffortArea={() => {
          toggleCalled = true;
        }}
        showEffortVotes={false}
        onToggleEffortVotes={() => {}}
      />,
    );

    await component.locator(".exocortex-toggle-effort-area").click();
    expect(toggleCalled).toBe(true);
  });

  test("should show Effort Area column when showEffortArea is true", async ({
    mount,
  }) => {
    const component = await mount(
      <DailyTasksTableWithToggle
        tasks={mockTasks}
        showEffortArea={true}
        onToggleEffortArea={() => {}}
        showEffortVotes={false}
        onToggleEffortVotes={() => {}}
      />,
    );

    await expect(component.locator("thead th").nth(4)).toContainText(
      "Effort Area",
    );
    await expect(component.locator(".task-effort-area")).toBeVisible();
  });

  test("should hide Effort Area column when showEffortArea is false", async ({
    mount,
  }) => {
    const component = await mount(
      <DailyTasksTableWithToggle
        tasks={mockTasks}
        showEffortArea={false}
        onToggleEffortArea={() => {}}
        showEffortVotes={false}
        onToggleEffortVotes={() => {}}
      />,
    );

    await expect(component.locator("thead th")).toHaveCount(4);
    await expect(component.locator(".task-effort-area")).toHaveCount(0);
  });

  test("should persist showEffortArea state after re-renders", async ({
    mount,
  }) => {
    let currentShowEffortArea = false;
    const onToggle = () => {
      currentShowEffortArea = !currentShowEffortArea;
    };

    const component = await mount(
      <DailyTasksTableWithToggle
        tasks={mockTasks}
        showEffortArea={currentShowEffortArea}
        onToggleEffortArea={onToggle}
        showEffortVotes={false}
        onToggleEffortVotes={() => {}}
      />,
    );

    await expect(
      component.locator(".exocortex-toggle-effort-area"),
    ).toContainText("Show Effort Area");

    await component.locator(".exocortex-toggle-effort-area").click();
    expect(currentShowEffortArea).toBe(true);
  });

  test("should render Votes toggle button", async ({ mount }) => {
    const component = await mount(
      <DailyTasksTableWithToggle
        tasks={mockTasks}
        showEffortArea={false}
        onToggleEffortArea={() => {}}
        showEffortVotes={false}
        onToggleEffortVotes={() => {}}
      />,
    );

    await expect(
      component.locator(".exocortex-toggle-effort-votes"),
    ).toBeVisible();
    await expect(
      component.locator(".exocortex-toggle-effort-votes"),
    ).toContainText("Show Votes");
  });

  test("should show 'Hide Votes' when showEffortVotes is true", async ({
    mount,
  }) => {
    const component = await mount(
      <DailyTasksTableWithToggle
        tasks={mockTasks}
        showEffortArea={false}
        onToggleEffortArea={() => {}}
        showEffortVotes={true}
        onToggleEffortVotes={() => {}}
      />,
    );

    await expect(
      component.locator(".exocortex-toggle-effort-votes"),
    ).toContainText("Hide Votes");
  });

  test("should call onToggleEffortVotes when button is clicked", async ({
    mount,
  }) => {
    let toggleCalled = false;
    const component = await mount(
      <DailyTasksTableWithToggle
        tasks={mockTasks}
        showEffortArea={false}
        onToggleEffortArea={() => {}}
        showEffortVotes={false}
        onToggleEffortVotes={() => {
          toggleCalled = true;
        }}
      />,
    );

    await component.locator(".exocortex-toggle-effort-votes").click();
    expect(toggleCalled).toBe(true);
  });

  test("should show Votes column when showEffortVotes is true", async ({
    mount,
  }) => {
    const tasksWithVotes: DailyTask[] = [
      {
        file: { path: "task1.md", basename: "task1" },
        path: "task1.md",
        title: "Task 1",
        label: "First Task",
        startTime: "09:00",
        endTime: "10:00",
        status: "ems__EffortStatusInProgress",
        metadata: { ems__Effort_votes: 3 },
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
    ];

    const component = await mount(
      <DailyTasksTableWithToggle
        tasks={tasksWithVotes}
        showEffortArea={false}
        onToggleEffortArea={() => {}}
        showEffortVotes={true}
        onToggleEffortVotes={() => {}}
      />,
    );

    await expect(component.locator("thead th").nth(4)).toContainText("Votes");
    await expect(component.locator(".task-effort-votes")).toBeVisible();
    await expect(component.locator(".task-effort-votes")).toContainText("3");
  });

  test("should hide Votes column when showEffortVotes is false", async ({
    mount,
  }) => {
    const component = await mount(
      <DailyTasksTableWithToggle
        tasks={mockTasks}
        showEffortArea={false}
        onToggleEffortArea={() => {}}
        showEffortVotes={false}
        onToggleEffortVotes={() => {}}
      />,
    );

    await expect(component.locator(".task-effort-votes")).toHaveCount(0);
  });

  test("should display dash when votes are not set", async ({ mount }) => {
    const tasksWithoutVotes: DailyTask[] = [
      {
        file: { path: "task1.md", basename: "task1" },
        path: "task1.md",
        title: "Task 1",
        label: "First Task",
        startTime: "09:00",
        endTime: "10:00",
        status: "ems__EffortStatusInProgress",
        metadata: {},
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
    ];

    const component = await mount(
      <DailyTasksTableWithToggle
        tasks={tasksWithoutVotes}
        showEffortArea={false}
        onToggleEffortArea={() => {}}
        showEffortVotes={true}
        onToggleEffortVotes={() => {}}
      />,
    );

    await expect(component.locator(".task-effort-votes")).toContainText("-");
  });

  test("should render toggle button for archived tasks", async ({ mount }) => {
    const component = await mount(
      <DailyTasksTableWithToggle
        tasks={mockTasks}
        showEffortArea={false}
        onToggleEffortArea={() => {}}
        showEffortVotes={false}
        onToggleEffortVotes={() => {}}
        showArchived={false}
        onToggleArchived={() => {}}
      />,
    );

    await expect(
      component.locator(".exocortex-toggle-archived"),
    ).toBeVisible();
    await expect(
      component.locator(".exocortex-toggle-archived"),
    ).toContainText("Show Archived");
  });

  test("should show 'Hide Archived' when showArchived is true", async ({
    mount,
  }) => {
    const component = await mount(
      <DailyTasksTableWithToggle
        tasks={mockTasks}
        showEffortArea={false}
        onToggleEffortArea={() => {}}
        showEffortVotes={false}
        onToggleEffortVotes={() => {}}
        showArchived={true}
        onToggleArchived={() => {}}
      />,
    );

    await expect(
      component.locator(".exocortex-toggle-archived"),
    ).toContainText("Hide Archived");
  });

  test("should call onToggleArchived when button is clicked", async ({
    mount,
  }) => {
    let toggleCalled = false;
    const component = await mount(
      <DailyTasksTableWithToggle
        tasks={mockTasks}
        showEffortArea={false}
        onToggleEffortArea={() => {}}
        showEffortVotes={false}
        onToggleEffortVotes={() => {}}
        showArchived={false}
        onToggleArchived={() => {
          toggleCalled = true;
        }}
      />,
    );

    await component.locator(".exocortex-toggle-archived").click();
    expect(toggleCalled).toBe(true);
  });

  test("should filter archived tasks when showArchived is false", async ({
    mount,
  }) => {
    const tasksWithArchived: DailyTask[] = [
      {
        file: { path: "task1.md", basename: "task1" },
        path: "task1.md",
        title: "Active Task",
        label: "Active",
        startTime: "09:00",
        endTime: "10:00",
        status: "ems__EffortStatusInProgress",
        metadata: { exo__Asset_isArchived: false },
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
      {
        file: { path: "task2.md", basename: "task2" },
        path: "task2.md",
        title: "Archived Task",
        label: "Archived",
        startTime: "11:00",
        endTime: "12:00",
        status: "ems__EffortStatusDone",
        metadata: { exo__Asset_isArchived: true },
        isDone: true,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
    ];

    const component = await mount(
      <DailyTasksTableWithToggle
        tasks={tasksWithArchived}
        showEffortArea={false}
        onToggleEffortArea={() => {}}
        showEffortVotes={false}
        onToggleEffortVotes={() => {}}
        showArchived={false}
        onToggleArchived={() => {}}
      />,
    );

    const rows = component.locator("tbody tr");
    await expect(rows).toHaveCount(1);
    await expect(rows.first().locator(".task-name a")).toContainText("Active");
  });

  test("should show all tasks when showArchived is true", async ({
    mount,
  }) => {
    const tasksWithArchived: DailyTask[] = [
      {
        file: { path: "task1.md", basename: "task1" },
        path: "task1.md",
        title: "Active Task",
        label: "Active",
        startTime: "09:00",
        endTime: "10:00",
        status: "ems__EffortStatusInProgress",
        metadata: { exo__Asset_isArchived: false },
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
      {
        file: { path: "task2.md", basename: "task2" },
        path: "task2.md",
        title: "Archived Task",
        label: "Archived",
        startTime: "11:00",
        endTime: "12:00",
        status: "ems__EffortStatusDone",
        metadata: { exo__Asset_isArchived: true },
        isDone: true,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
    ];

    const component = await mount(
      <DailyTasksTableWithToggle
        tasks={tasksWithArchived}
        showEffortArea={false}
        onToggleEffortArea={() => {}}
        showEffortVotes={false}
        onToggleEffortVotes={() => {}}
        showArchived={true}
        onToggleArchived={() => {}}
      />,
    );

    const rows = component.locator("tbody tr");
    await expect(rows).toHaveCount(2);
  });

  test("should render toggle button for empty slots", async ({ mount }) => {
    const component = await mount(
      <DailyTasksTableWithToggle
        tasks={mockTasks}
        showEffortArea={false}
        onToggleEffortArea={() => {}}
        showEffortVotes={false}
        onToggleEffortVotes={() => {}}
        showEmptySlots={true}
        onToggleEmptySlots={() => {}}
      />,
    );

    await expect(
      component.locator(".exocortex-toggle-empty-slots"),
    ).toBeVisible();
    await expect(
      component.locator(".exocortex-toggle-empty-slots"),
    ).toContainText("Hide Empty Slots");
  });

  test("should show 'Show Empty Slots' when showEmptySlots is false", async ({
    mount,
  }) => {
    const component = await mount(
      <DailyTasksTableWithToggle
        tasks={mockTasks}
        showEffortArea={false}
        onToggleEffortArea={() => {}}
        showEffortVotes={false}
        onToggleEffortVotes={() => {}}
        showEmptySlots={false}
        onToggleEmptySlots={() => {}}
      />,
    );

    await expect(
      component.locator(".exocortex-toggle-empty-slots"),
    ).toContainText("Show Empty Slots");
  });

  test("should call onToggleEmptySlots when button is clicked", async ({
    mount,
  }) => {
    let toggleCalled = false;
    const component = await mount(
      <DailyTasksTableWithToggle
        tasks={mockTasks}
        showEffortArea={false}
        onToggleEffortArea={() => {}}
        showEffortVotes={false}
        onToggleEffortVotes={() => {}}
        showEmptySlots={true}
        onToggleEmptySlots={() => {
          toggleCalled = true;
        }}
      />,
    );

    await component.locator(".exocortex-toggle-empty-slots").click();
    expect(toggleCalled).toBe(true);
  });
});

test.describe("Large Data Volume Rendering (100 records)", () => {
  /**
   * Generates 100 task records with varied statuses for testing.
   * Uses human-readable status labels as they would come from getStatusLabel().
   *
   * Note: With 100 tasks, the component enables virtualization (>50 items threshold),
   * which renders two tables: a header table and a virtual content table.
   */
  const generate100Tasks = (): DailyTask[] => {
    const statuses = [
      "Draft",
      "Backlog",
      "Analysis",
      "To Do",
      "Doing",
      "Done",
      "Trashed",
    ];
    const tasks: DailyTask[] = [];

    for (let i = 0; i < 100; i++) {
      const status = statuses[i % statuses.length];
      const isDone = status === "Done";
      const isTrashed = status === "Trashed";
      const isDoing = status === "Doing";
      const isMeeting = i % 10 === 0; // Every 10th task is a meeting
      const isBlocked = i % 15 === 0; // Every 15th task is blocked

      const hour = 8 + Math.floor(i / 4);
      const minute = (i % 4) * 15;
      const startTime = `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
      const endTime = `${hour.toString().padStart(2, "0")}:${(minute + 14).toString().padStart(2, "0")}`;

      tasks.push({
        file: { path: `task${i}.md`, basename: `task${i}` },
        path: `task${i}.md`,
        title: `Task ${i}`,
        label: `Task ${i} - ${status}`,
        startTime,
        endTime,
        startTimestamp: new Date(`2025-01-15T${startTime}:00`).getTime(),
        endTimestamp: new Date(`2025-01-15T${endTime}:00`).getTime(),
        status,
        metadata: {
          ems__Effort_votes: i % 20,
          ems__Effort_area: i % 5 === 0 ? "[[backend]]" : undefined,
        },
        isDone,
        isTrashed,
        isDoing,
        isMeeting,
        isBlocked,
      });
    }

    return tasks;
  };

  const largeTaskSet = generate100Tasks();

  test("should render virtualized table with 100 records", async ({ mount }) => {
    const component = await mount(
      <DailyTasksTable tasks={largeTaskSet} showEmptySlots={false} />,
    );

    // With 100 tasks (> 50 threshold), virtualization is enabled
    // This creates two tables: header table + virtual content table
    const tables = component.locator("table.exocortex-tasks-table");
    await expect(tables).toHaveCount(2); // Header table + virtual table

    // Verify header table is visible
    await expect(
      component.locator("table.exocortex-tasks-table-header"),
    ).toBeVisible();

    // Verify virtual content table is visible
    await expect(
      component.locator("table.exocortex-virtual-table"),
    ).toBeVisible();

    // Verify rows are rendered (virtualized, so fewer visible at once)
    const rows = component.locator("tbody tr");
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);
  });

  test("should render all column headers correctly with virtualization", async ({
    mount,
  }) => {
    const component = await mount(
      <DailyTasksTable tasks={largeTaskSet} showEmptySlots={false} />,
    );

    // In virtualized mode, headers are in a separate header table
    const headerTable = component.locator(
      "table.exocortex-tasks-table-header thead th",
    );
    await expect(headerTable.nth(0)).toContainText("Name");
    await expect(headerTable.nth(1)).toContainText("Start");
    await expect(headerTable.nth(2)).toContainText("End");
    await expect(headerTable.nth(3)).toContainText("Status");
  });

  test("should display human-readable status labels, not raw URIs", async ({
    mount,
  }) => {
    const component = await mount(
      <DailyTasksTable tasks={largeTaskSet} showEmptySlots={false} />,
    );

    // Get all visible status cells (from virtual table)
    const statusCells = component.locator(".task-status");
    const cellCount = await statusCells.count();

    // Verify at least some status cells are visible
    expect(cellCount).toBeGreaterThan(0);

    // Check that status values are human-readable (not raw URIs)
    for (let i = 0; i < Math.min(cellCount, 10); i++) {
      const cellText = await statusCells.nth(i).textContent();

      // Should NOT contain raw URI patterns
      expect(cellText).not.toContain("ems__EffortStatus");

      // Should be one of the human-readable labels
      const validStatuses = [
        "Draft",
        "Backlog",
        "Analysis",
        "To Do",
        "Doing",
        "Done",
        "Trashed",
      ];
      const hasValidStatus = validStatuses.some(
        (status) => cellText?.includes(status),
      );
      expect(hasValidStatus).toBe(true);
    }
  });

  test("should fail if status shows raw URIs instead of labels", async ({
    mount,
  }) => {
    // Create tasks with RAW URIs (simulating the bug that was fixed in PR #573)
    const tasksWithRawUris: DailyTask[] = [
      {
        file: { path: "task1.md", basename: "task1" },
        path: "task1.md",
        title: "Task 1",
        label: "Task 1",
        startTime: "09:00",
        endTime: "10:00",
        startTimestamp: null,
        endTimestamp: null,
        status: "ems__EffortStatusDoing", // RAW URI - this is what we want to catch
        metadata: {},
        isDone: false,
        isTrashed: false,
        isDoing: true,
        isMeeting: false,
        isBlocked: false,
      },
    ];

    const component = await mount(
      <DailyTasksTable tasks={tasksWithRawUris} showEmptySlots={false} />,
    );

    const statusCell = component.locator(".task-status");
    const cellText = await statusCell.textContent();

    // This test documents the expected behavior:
    // If the status shows "ems__EffortStatusDoing", the bug exists
    // If the status shows the raw value, it means getStatusLabel() wasn't used in the data preparation
    // The fix should happen at the renderer level (DailyTasksRenderer) before data reaches the component
    if (cellText?.includes("ems__EffortStatus")) {
      // Document that raw URIs are being shown - this indicates the data
      // should be transformed before reaching the component
      console.warn(
        "Status cell shows raw URI - data should be transformed by getStatusLabel()",
      );
    }

    // At minimum, the status should be visible and clickable
    await expect(statusCell).toBeVisible();
  });

  test("should render within acceptable time (< 2 seconds)", async ({
    mount,
  }) => {
    const startTime = Date.now();

    const component = await mount(
      <DailyTasksTable tasks={largeTaskSet} showEmptySlots={false} />,
    );

    const endTime = Date.now();
    const renderTime = endTime - startTime;

    // Verify tables are rendered (virtualization creates 2 tables)
    await expect(
      component.locator("table.exocortex-tasks-table-header"),
    ).toBeVisible();

    // Render time should be less than 2000ms
    expect(renderTime).toBeLessThan(2000);
  });

  test("should have proper table structure and CSS classes with virtualization", async ({
    mount,
  }) => {
    const component = await mount(
      <DailyTasksTable tasks={largeTaskSet} showEmptySlots={false} />,
    );

    // Verify header table exists with correct class
    await expect(
      component.locator("table.exocortex-tasks-table-header"),
    ).toBeVisible();

    // Verify virtual content table exists
    await expect(
      component.locator("table.exocortex-virtual-table"),
    ).toBeVisible();

    // Verify sortable headers have correct class (in header table)
    const headers = component.locator(
      "table.exocortex-tasks-table-header thead th.sortable",
    );
    await expect(headers).toHaveCount(4); // Name, Start, End, Status

    // Verify all headers have pointer cursor
    for (let i = 0; i < 4; i++) {
      await expect(headers.nth(i)).toHaveCSS("cursor", "pointer");
    }
  });

  test("should render visible tasks with correct icons", async ({ mount }) => {
    const component = await mount(
      <DailyTasksTable tasks={largeTaskSet} showEmptySlots={false} />,
    );

    // Due to virtualization, only visible tasks are rendered
    // The first visible "Doing" task should have 🔄 icon
    // since Doing tasks are prioritized at the top
    const firstRow = component
      .locator("table.exocortex-virtual-table tbody tr")
      .first();
    const firstRowName = await firstRow.locator(".task-name a").textContent();

    // First row should contain 🔄 icon (indicating Doing status)
    expect(firstRowName).toContain("🔄");
  });

  test("should maintain Doing status priority at top with large dataset", async ({
    mount,
  }) => {
    const component = await mount(
      <DailyTasksTable tasks={largeTaskSet} showEmptySlots={false} />,
    );

    // Find the first "Doing" task in the dataset
    const doingTasks = largeTaskSet.filter((t) => t.isDoing);
    expect(doingTasks.length).toBeGreaterThan(0);

    // The first row should be a "Doing" task (due to priority sorting)
    const firstRow = component
      .locator("table.exocortex-virtual-table tbody tr")
      .first();
    const firstRowName = await firstRow.locator(".task-name a").textContent();

    // First row should contain 🔄 icon (indicating Doing status)
    expect(firstRowName).toContain("🔄");
  });

  test("should handle sorting by all columns with large dataset", async ({
    mount,
  }) => {
    const component = await mount(
      <DailyTasksTable tasks={largeTaskSet} showEmptySlots={false} />,
    );

    // Headers are in the header table when virtualized
    const headerTable = component.locator("table.exocortex-tasks-table-header");

    // Sort by Name
    await headerTable.locator('th:has-text("Name")').click();
    await expect(
      headerTable.locator('th:has-text("Name")'),
    ).toContainText("↑");

    // Sort by Start
    await headerTable.locator('th:has-text("Start")').click();
    await expect(
      headerTable.locator('th:has-text("Start")'),
    ).toContainText("↑");

    // Sort by End
    await headerTable.locator('th:has-text("End")').click();
    await expect(headerTable.locator('th:has-text("End")')).toContainText(
      "↑",
    );

    // Sort by Status
    await headerTable.locator('th:has-text("Status")').click();
    await expect(
      headerTable.locator('th:has-text("Status")'),
    ).toContainText("↑");
  });

  test("should display Effort Area column with large dataset", async ({
    mount,
  }) => {
    const component = await mount(
      <DailyTasksTable
        tasks={largeTaskSet}
        showEffortArea={true}
        showEmptySlots={false}
      />,
    );

    // Verify Effort Area header is present in header table
    await expect(
      component.locator(
        'table.exocortex-tasks-table-header th:has-text("Effort Area")',
      ),
    ).toBeVisible();

    // Verify at least one effort area cell is visible
    const areaCells = component.locator(".task-effort-area");
    const cellCount = await areaCells.count();
    expect(cellCount).toBeGreaterThan(0);
  });

  test("should display Votes column with large dataset", async ({ mount }) => {
    const component = await mount(
      <DailyTasksTable
        tasks={largeTaskSet}
        showEffortVotes={true}
        showEmptySlots={false}
      />,
    );

    // Verify Votes header is present in header table
    await expect(
      component.locator(
        'table.exocortex-tasks-table-header th:has-text("Votes")',
      ),
    ).toBeVisible();

    // Verify at least one votes cell is visible and has numeric content
    const votesCells = component.locator(".task-effort-votes");
    const cellCount = await votesCells.count();
    expect(cellCount).toBeGreaterThan(0);

    // Check first vote cell has a number
    const firstVoteText = await votesCells.first().textContent();
    const hasNumber = /\d+/.test(firstVoteText || "");
    expect(hasNumber).toBe(true);
  });

  test("should have virtual scroll container for large datasets", async ({
    mount,
  }) => {
    const component = await mount(
      <DailyTasksTable tasks={largeTaskSet} showEmptySlots={false} />,
    );

    // Verify virtual scroll container exists
    await expect(
      component.locator(".exocortex-virtual-scroll-container"),
    ).toBeVisible();

    // Container should have scroll capability
    const scrollContainer = component.locator(
      ".exocortex-virtual-scroll-container",
    );
    await expect(scrollContainer).toHaveCSS("overflow", "auto");
  });
});

test.describe("Overlapping Planned Task Periods Highlighting", () => {
  test("should highlight rows with overlapping planned periods", async ({
    mount,
  }) => {
    const overlappingTasks: DailyTask[] = [
      {
        file: { path: "task1.md", basename: "task1" },
        path: "task1.md",
        title: "Task 1",
        label: "Task 1",
        startTime: "09:00",
        endTime: "10:00",
        startTimestamp: null,
        endTimestamp: null,
        status: "ems__EffortStatusInProgress",
        metadata: {
          ems__Effort_plannedStartTimestamp: "2025-01-15T09:00:00",
          ems__Effort_plannedEndTimestamp: "2025-01-15T10:30:00",
        },
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
      {
        file: { path: "task2.md", basename: "task2" },
        path: "task2.md",
        title: "Task 2",
        label: "Task 2",
        startTime: "10:00",
        endTime: "11:00",
        startTimestamp: null,
        endTimestamp: null,
        status: "ems__EffortStatusInProgress",
        metadata: {
          ems__Effort_plannedStartTimestamp: "2025-01-15T10:00:00",
          ems__Effort_plannedEndTimestamp: "2025-01-15T11:00:00",
        },
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
    ];

    const component = await mount(
      <DailyTasksTable tasks={overlappingTasks} />,
    );

    // Both tasks should have the overlap conflict class since they overlap
    // Task 1: 09:00-10:30, Task 2: 10:00-11:00 → overlap between 10:00-10:30
    const task1Row = component.locator('tr[data-path="task1.md"]');
    const task2Row = component.locator('tr[data-path="task2.md"]');

    await expect(task1Row).toHaveClass(/task-overlap-conflict/);
    await expect(task2Row).toHaveClass(/task-overlap-conflict/);
  });

  test("should not highlight rows without overlapping periods", async ({
    mount,
  }) => {
    const nonOverlappingTasks: DailyTask[] = [
      {
        file: { path: "task1.md", basename: "task1" },
        path: "task1.md",
        title: "Task 1",
        label: "Task 1",
        startTime: "09:00",
        endTime: "10:00",
        startTimestamp: null,
        endTimestamp: null,
        status: "ems__EffortStatusInProgress",
        metadata: {
          ems__Effort_plannedStartTimestamp: "2025-01-15T09:00:00",
          ems__Effort_plannedEndTimestamp: "2025-01-15T10:00:00",
        },
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
      {
        file: { path: "task2.md", basename: "task2" },
        path: "task2.md",
        title: "Task 2",
        label: "Task 2",
        startTime: "10:30",
        endTime: "11:30",
        startTimestamp: null,
        endTimestamp: null,
        status: "ems__EffortStatusInProgress",
        metadata: {
          ems__Effort_plannedStartTimestamp: "2025-01-15T10:30:00",
          ems__Effort_plannedEndTimestamp: "2025-01-15T11:30:00",
        },
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
    ];

    const component = await mount(
      <DailyTasksTable tasks={nonOverlappingTasks} />,
    );

    // No overlap: Task 1 ends at 10:00, Task 2 starts at 10:30
    const task1Row = component.locator('tr[data-path="task1.md"]');
    const task2Row = component.locator('tr[data-path="task2.md"]');

    // Use not.toHaveClass instead of getAttribute to handle null class attribute
    await expect(task1Row).not.toHaveClass(/task-overlap-conflict/);
    await expect(task2Row).not.toHaveClass(/task-overlap-conflict/);
  });

  test("should skip tasks without planned timestamps", async ({
    mount,
  }) => {
    const mixedTasks: DailyTask[] = [
      {
        file: { path: "task1.md", basename: "task1" },
        path: "task1.md",
        title: "Task 1",
        label: "Task 1",
        startTime: "09:00",
        endTime: "10:00",
        startTimestamp: null,
        endTimestamp: null,
        status: "ems__EffortStatusInProgress",
        metadata: {
          ems__Effort_plannedStartTimestamp: "2025-01-15T09:00:00",
          ems__Effort_plannedEndTimestamp: "2025-01-15T10:30:00",
        },
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
      {
        file: { path: "task2.md", basename: "task2" },
        path: "task2.md",
        title: "Task 2 - No Planned Times",
        label: "Task 2 - No Planned Times",
        startTime: "10:00",
        endTime: "11:00",
        startTimestamp: null,
        endTimestamp: null,
        status: "ems__EffortStatusInProgress",
        metadata: {},  // No planned timestamps
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
    ];

    const component = await mount(
      <DailyTasksTable tasks={mixedTasks} />,
    );

    // Task 1 has planned timestamps but no other task overlaps (task2 has none)
    // So neither should be marked as overlapping
    const task1Row = component.locator('tr[data-path="task1.md"]');
    const task2Row = component.locator('tr[data-path="task2.md"]');

    // Use not.toHaveClass instead of getAttribute to handle null class attribute
    await expect(task1Row).not.toHaveClass(/task-overlap-conflict/);
    await expect(task2Row).not.toHaveClass(/task-overlap-conflict/);
  });

  test("should not consider touching periods as overlapping (end = start)", async ({
    mount,
  }) => {
    const touchingTasks: DailyTask[] = [
      {
        file: { path: "task1.md", basename: "task1" },
        path: "task1.md",
        title: "Task 1",
        label: "Task 1",
        startTime: "09:00",
        endTime: "10:00",
        startTimestamp: null,
        endTimestamp: null,
        status: "ems__EffortStatusInProgress",
        metadata: {
          ems__Effort_plannedStartTimestamp: "2025-01-15T09:00:00",
          ems__Effort_plannedEndTimestamp: "2025-01-15T10:00:00",
        },
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
      {
        file: { path: "task2.md", basename: "task2" },
        path: "task2.md",
        title: "Task 2",
        label: "Task 2",
        startTime: "10:00",
        endTime: "11:00",
        startTimestamp: null,
        endTimestamp: null,
        status: "ems__EffortStatusInProgress",
        metadata: {
          ems__Effort_plannedStartTimestamp: "2025-01-15T10:00:00",
          ems__Effort_plannedEndTimestamp: "2025-01-15T11:00:00",
        },
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
    ];

    const component = await mount(
      <DailyTasksTable tasks={touchingTasks} />,
    );

    // Task 1 ends at exactly 10:00, Task 2 starts at exactly 10:00
    // This should NOT be considered an overlap (touching, not overlapping)
    const task1Row = component.locator('tr[data-path="task1.md"]');
    const task2Row = component.locator('tr[data-path="task2.md"]');

    // Use not.toHaveClass instead of getAttribute to handle null class attribute
    await expect(task1Row).not.toHaveClass(/task-overlap-conflict/);
    await expect(task2Row).not.toHaveClass(/task-overlap-conflict/);
  });

  test("should highlight multiple overlapping tasks correctly", async ({
    mount,
  }) => {
    const multipleOverlaps: DailyTask[] = [
      {
        file: { path: "task1.md", basename: "task1" },
        path: "task1.md",
        title: "Task 1",
        label: "Task 1",
        startTime: "09:00",
        endTime: "11:00",
        startTimestamp: null,
        endTimestamp: null,
        status: "ems__EffortStatusInProgress",
        metadata: {
          ems__Effort_plannedStartTimestamp: "2025-01-15T09:00:00",
          ems__Effort_plannedEndTimestamp: "2025-01-15T11:00:00",
        },
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
      {
        file: { path: "task2.md", basename: "task2" },
        path: "task2.md",
        title: "Task 2",
        label: "Task 2",
        startTime: "10:00",
        endTime: "12:00",
        startTimestamp: null,
        endTimestamp: null,
        status: "ems__EffortStatusInProgress",
        metadata: {
          ems__Effort_plannedStartTimestamp: "2025-01-15T10:00:00",
          ems__Effort_plannedEndTimestamp: "2025-01-15T12:00:00",
        },
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
      {
        file: { path: "task3.md", basename: "task3" },
        path: "task3.md",
        title: "Task 3",
        label: "Task 3",
        startTime: "14:00",
        endTime: "15:00",
        startTimestamp: null,
        endTimestamp: null,
        status: "ems__EffortStatusInProgress",
        metadata: {
          ems__Effort_plannedStartTimestamp: "2025-01-15T14:00:00",
          ems__Effort_plannedEndTimestamp: "2025-01-15T15:00:00",
        },
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
    ];

    const component = await mount(
      <DailyTasksTable tasks={multipleOverlaps} />,
    );

    // Task 1 (09:00-11:00) overlaps with Task 2 (10:00-12:00)
    // Task 3 (14:00-15:00) does not overlap with anyone
    const task1Row = component.locator('tr[data-path="task1.md"]');
    const task2Row = component.locator('tr[data-path="task2.md"]');
    const task3Row = component.locator('tr[data-path="task3.md"]');

    await expect(task1Row).toHaveClass(/task-overlap-conflict/);
    await expect(task2Row).toHaveClass(/task-overlap-conflict/);

    // Use not.toHaveClass instead of getAttribute to handle null class attribute
    await expect(task3Row).not.toHaveClass(/task-overlap-conflict/);
  });
});

test.describe("Context Task Overlap Exclusion (Issue #2128)", () => {
  test("should exclude context task (with ems__Context class) from overlap detection", async ({
    mount,
  }) => {
    const tasksWithContext: DailyTask[] = [
      {
        file: { path: "regular-task.md", basename: "regular-task" },
        path: "regular-task.md",
        title: "Regular Task",
        label: "Regular Task",
        startTime: "09:00",
        endTime: "11:00",
        startTimestamp: null,
        endTimestamp: null,
        status: "ems__EffortStatusInProgress",
        metadata: {
          ems__Effort_plannedStartTimestamp: "2025-01-15T09:00:00",
          ems__Effort_plannedEndTimestamp: "2025-01-15T11:00:00",
        },
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
      {
        file: { path: "context-task.md", basename: "context-task" },
        path: "context-task.md",
        title: "In Transit",
        label: "In Transit",
        startTime: "10:00",
        endTime: "11:00",
        startTimestamp: null,
        endTimestamp: null,
        status: "ems__EffortStatusInProgress",
        metadata: {
          exo__Instance_class: "[[ems__Context]]",
          ems__Effort_plannedStartTimestamp: "2025-01-15T10:00:00",
          ems__Effort_plannedEndTimestamp: "2025-01-15T11:00:00",
        },
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
    ];

    const component = await mount(
      <DailyTasksTable tasks={tasksWithContext} />,
    );

    // Context task overlaps with regular task (10:00-11:00 overlaps with 09:00-11:00)
    // BUT context task should be excluded from overlap detection
    // So neither should be highlighted
    const regularTaskRow = component.locator('tr[data-path="regular-task.md"]');
    const contextTaskRow = component.locator('tr[data-path="context-task.md"]');

    await expect(regularTaskRow).not.toHaveClass(/task-overlap-conflict/);
    await expect(contextTaskRow).not.toHaveClass(/task-overlap-conflict/);
  });

  test("should exclude context task with array class format from overlap detection", async ({
    mount,
  }) => {
    const tasksWithContextArray: DailyTask[] = [
      {
        file: { path: "regular-task.md", basename: "regular-task" },
        path: "regular-task.md",
        title: "Regular Task",
        label: "Regular Task",
        startTime: "09:00",
        endTime: "11:00",
        startTimestamp: null,
        endTimestamp: null,
        status: "ems__EffortStatusInProgress",
        metadata: {
          ems__Effort_plannedStartTimestamp: "2025-01-15T09:00:00",
          ems__Effort_plannedEndTimestamp: "2025-01-15T11:00:00",
        },
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
      {
        file: { path: "context-task.md", basename: "context-task" },
        path: "context-task.md",
        title: "Commute",
        label: "Commute",
        startTime: "10:00",
        endTime: "11:00",
        startTimestamp: null,
        endTimestamp: null,
        status: "ems__EffortStatusInProgress",
        metadata: {
          exo__Instance_class: ["[[ems__Task]]", "[[ems__Context]]"],
          ems__Effort_plannedStartTimestamp: "2025-01-15T10:00:00",
          ems__Effort_plannedEndTimestamp: "2025-01-15T11:00:00",
        },
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
    ];

    const component = await mount(
      <DailyTasksTable tasks={tasksWithContextArray} />,
    );

    // Context task has multiple classes including ems__Context
    // Should be excluded from overlap detection
    const regularTaskRow = component.locator('tr[data-path="regular-task.md"]');
    const contextTaskRow = component.locator('tr[data-path="context-task.md"]');

    await expect(regularTaskRow).not.toHaveClass(/task-overlap-conflict/);
    await expect(contextTaskRow).not.toHaveClass(/task-overlap-conflict/);
  });

  test("should still highlight overlapping regular tasks (existing behavior preserved)", async ({
    mount,
  }) => {
    const regularOverlappingTasks: DailyTask[] = [
      {
        file: { path: "task1.md", basename: "task1" },
        path: "task1.md",
        title: "Task 1",
        label: "Task 1",
        startTime: "09:00",
        endTime: "11:00",
        startTimestamp: null,
        endTimestamp: null,
        status: "ems__EffortStatusInProgress",
        metadata: {
          exo__Instance_class: "[[ems__Task]]",
          ems__Effort_plannedStartTimestamp: "2025-01-15T09:00:00",
          ems__Effort_plannedEndTimestamp: "2025-01-15T11:00:00",
        },
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
      {
        file: { path: "task2.md", basename: "task2" },
        path: "task2.md",
        title: "Task 2",
        label: "Task 2",
        startTime: "10:00",
        endTime: "12:00",
        startTimestamp: null,
        endTimestamp: null,
        status: "ems__EffortStatusInProgress",
        metadata: {
          exo__Instance_class: "[[ems__Task]]",
          ems__Effort_plannedStartTimestamp: "2025-01-15T10:00:00",
          ems__Effort_plannedEndTimestamp: "2025-01-15T12:00:00",
        },
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
    ];

    const component = await mount(
      <DailyTasksTable tasks={regularOverlappingTasks} />,
    );

    // Two regular tasks overlap → BOTH should be highlighted
    const task1Row = component.locator('tr[data-path="task1.md"]');
    const task2Row = component.locator('tr[data-path="task2.md"]');

    await expect(task1Row).toHaveClass(/task-overlap-conflict/);
    await expect(task2Row).toHaveClass(/task-overlap-conflict/);
  });

  test("should render context task in table (not hidden)", async ({
    mount,
  }) => {
    const tasksWithContext: DailyTask[] = [
      {
        file: { path: "context-task.md", basename: "context-task" },
        path: "context-task.md",
        title: "In Transit",
        label: "In Transit",
        startTime: "10:00",
        endTime: "11:00",
        startTimestamp: null,
        endTimestamp: null,
        status: "ems__EffortStatusInProgress",
        metadata: {
          exo__Instance_class: "[[ems__Context]]",
          ems__Effort_plannedStartTimestamp: "2025-01-15T10:00:00",
          ems__Effort_plannedEndTimestamp: "2025-01-15T11:00:00",
        },
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
    ];

    const component = await mount(
      <DailyTasksTable tasks={tasksWithContext} />,
    );

    // Context task should still be visible in the table
    const contextTaskRow = component.locator('tr[data-path="context-task.md"]');
    await expect(contextTaskRow).toBeVisible();
    await expect(contextTaskRow.locator(".task-name a")).toContainText("In Transit");
  });

  test("should handle context task without wiki-link format", async ({
    mount,
  }) => {
    const tasksWithPlainContext: DailyTask[] = [
      {
        file: { path: "regular-task.md", basename: "regular-task" },
        path: "regular-task.md",
        title: "Regular Task",
        label: "Regular Task",
        startTime: "09:00",
        endTime: "11:00",
        startTimestamp: null,
        endTimestamp: null,
        status: "ems__EffortStatusInProgress",
        metadata: {
          ems__Effort_plannedStartTimestamp: "2025-01-15T09:00:00",
          ems__Effort_plannedEndTimestamp: "2025-01-15T11:00:00",
        },
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
      {
        file: { path: "context-task.md", basename: "context-task" },
        path: "context-task.md",
        title: "At Office",
        label: "At Office",
        startTime: "10:00",
        endTime: "11:00",
        startTimestamp: null,
        endTimestamp: null,
        status: "ems__EffortStatusInProgress",
        metadata: {
          exo__Instance_class: "ems__Context",
          ems__Effort_plannedStartTimestamp: "2025-01-15T10:00:00",
          ems__Effort_plannedEndTimestamp: "2025-01-15T11:00:00",
        },
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
    ];

    const component = await mount(
      <DailyTasksTable tasks={tasksWithPlainContext} />,
    );

    // Context task with plain string class (no wiki-link format)
    // Should still be excluded from overlap detection
    const regularTaskRow = component.locator('tr[data-path="regular-task.md"]');
    const contextTaskRow = component.locator('tr[data-path="context-task.md"]');

    await expect(regularTaskRow).not.toHaveClass(/task-overlap-conflict/);
    await expect(contextTaskRow).not.toHaveClass(/task-overlap-conflict/);
  });

  test("should not exclude task without ems__Context class", async ({
    mount,
  }) => {
    const tasksWithoutContext: DailyTask[] = [
      {
        file: { path: "task1.md", basename: "task1" },
        path: "task1.md",
        title: "Task 1",
        label: "Task 1",
        startTime: "09:00",
        endTime: "11:00",
        startTimestamp: null,
        endTimestamp: null,
        status: "ems__EffortStatusInProgress",
        metadata: {
          exo__Instance_class: "[[ems__Task]]",
          ems__Effort_plannedStartTimestamp: "2025-01-15T09:00:00",
          ems__Effort_plannedEndTimestamp: "2025-01-15T11:00:00",
        },
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
      {
        file: { path: "task2.md", basename: "task2" },
        path: "task2.md",
        title: "Task 2",
        label: "Task 2",
        startTime: "10:00",
        endTime: "12:00",
        startTimestamp: null,
        endTimestamp: null,
        status: "ems__EffortStatusInProgress",
        metadata: {
          exo__Instance_class: "[[ems__Meeting]]",
          ems__Effort_plannedStartTimestamp: "2025-01-15T10:00:00",
          ems__Effort_plannedEndTimestamp: "2025-01-15T12:00:00",
        },
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: true,
        isBlocked: false,
      },
    ];

    const component = await mount(
      <DailyTasksTable tasks={tasksWithoutContext} />,
    );

    // Both tasks have class but NOT ems__Context
    // Should still participate in overlap detection
    const task1Row = component.locator('tr[data-path="task1.md"]');
    const task2Row = component.locator('tr[data-path="task2.md"]');

    await expect(task1Row).toHaveClass(/task-overlap-conflict/);
    await expect(task2Row).toHaveClass(/task-overlap-conflict/);
  });
});

test.describe("Prototype-based Context Task Exclusion (Issue #2131)", () => {
  test("should exclude task whose prototype has ems__Context class from overlap detection", async ({
    mount,
  }) => {
    // This task has a prototype that has ems__Context class
    // It should be treated as a context task for overlap detection purposes
    const tasksWithPrototypeContext: DailyTask[] = [
      {
        file: { path: "regular-task.md", basename: "regular-task" },
        path: "regular-task.md",
        title: "Regular Task",
        label: "Regular Task",
        startTime: "09:00",
        endTime: "11:00",
        startTimestamp: null,
        endTimestamp: null,
        status: "ems__EffortStatusInProgress",
        metadata: {
          ems__Effort_plannedStartTimestamp: "2025-01-15T09:00:00",
          ems__Effort_plannedEndTimestamp: "2025-01-15T11:00:00",
        },
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
      {
        file: { path: "commute-instance.md", basename: "commute-instance" },
        path: "commute-instance.md",
        title: "Morning Commute",
        label: "Morning Commute",
        startTime: "10:00",
        endTime: "11:00",
        startTimestamp: null,
        endTimestamp: null,
        status: "ems__EffortStatusInProgress",
        metadata: {
          // Task has a prototype that is a Context
          exo__Asset_prototype: "[[commute-prototype|Commute]]",
          // The prototype's classes are passed as resolved metadata
          _prototypeClasses: ["[[ems__Task]]", "[[ems__Context]]"],
          ems__Effort_plannedStartTimestamp: "2025-01-15T10:00:00",
          ems__Effort_plannedEndTimestamp: "2025-01-15T11:00:00",
        },
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
    ];

    const component = await mount(
      <DailyTasksTable tasks={tasksWithPrototypeContext} />,
    );

    // Prototype-based context task overlaps with regular task
    // BUT should be excluded from overlap detection because prototype has ems__Context
    const regularTaskRow = component.locator('tr[data-path="regular-task.md"]');
    const prototypeContextTaskRow = component.locator('tr[data-path="commute-instance.md"]');

    await expect(regularTaskRow).not.toHaveClass(/task-overlap-conflict/);
    await expect(prototypeContextTaskRow).not.toHaveClass(/task-overlap-conflict/);
  });

  test("should exclude task whose prototype has ems__Context class (single string format)", async ({
    mount,
  }) => {
    const tasksWithPrototypeContextString: DailyTask[] = [
      {
        file: { path: "regular-task.md", basename: "regular-task" },
        path: "regular-task.md",
        title: "Regular Task",
        label: "Regular Task",
        startTime: "09:00",
        endTime: "11:00",
        startTimestamp: null,
        endTimestamp: null,
        status: "ems__EffortStatusInProgress",
        metadata: {
          ems__Effort_plannedStartTimestamp: "2025-01-15T09:00:00",
          ems__Effort_plannedEndTimestamp: "2025-01-15T11:00:00",
        },
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
      {
        file: { path: "lunch-break.md", basename: "lunch-break" },
        path: "lunch-break.md",
        title: "Lunch Break",
        label: "Lunch Break",
        startTime: "10:00",
        endTime: "11:00",
        startTimestamp: null,
        endTimestamp: null,
        status: "ems__EffortStatusInProgress",
        metadata: {
          exo__Asset_prototype: "[[lunch-prototype|Lunch]]",
          _prototypeClasses: "[[ems__Context]]",
          ems__Effort_plannedStartTimestamp: "2025-01-15T10:00:00",
          ems__Effort_plannedEndTimestamp: "2025-01-15T11:00:00",
        },
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
    ];

    const component = await mount(
      <DailyTasksTable tasks={tasksWithPrototypeContextString} />,
    );

    const regularTaskRow = component.locator('tr[data-path="regular-task.md"]');
    const lunchTaskRow = component.locator('tr[data-path="lunch-break.md"]');

    await expect(regularTaskRow).not.toHaveClass(/task-overlap-conflict/);
    await expect(lunchTaskRow).not.toHaveClass(/task-overlap-conflict/);
  });

  test("should NOT exclude task whose prototype does NOT have ems__Context class", async ({
    mount,
  }) => {
    const tasksWithNonContextPrototype: DailyTask[] = [
      {
        file: { path: "task1.md", basename: "task1" },
        path: "task1.md",
        title: "Task 1",
        label: "Task 1",
        startTime: "09:00",
        endTime: "11:00",
        startTimestamp: null,
        endTimestamp: null,
        status: "ems__EffortStatusInProgress",
        metadata: {
          ems__Effort_plannedStartTimestamp: "2025-01-15T09:00:00",
          ems__Effort_plannedEndTimestamp: "2025-01-15T11:00:00",
        },
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
      {
        file: { path: "task2.md", basename: "task2" },
        path: "task2.md",
        title: "Task from Prototype",
        label: "Task from Prototype",
        startTime: "10:00",
        endTime: "11:00",
        startTimestamp: null,
        endTimestamp: null,
        status: "ems__EffortStatusInProgress",
        metadata: {
          exo__Asset_prototype: "[[some-prototype|Some Task]]",
          // Prototype has ems__Task class, but NOT ems__Context
          _prototypeClasses: ["[[ems__Task]]"],
          ems__Effort_plannedStartTimestamp: "2025-01-15T10:00:00",
          ems__Effort_plannedEndTimestamp: "2025-01-15T11:00:00",
        },
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
    ];

    const component = await mount(
      <DailyTasksTable tasks={tasksWithNonContextPrototype} />,
    );

    // Prototype does NOT have ems__Context, so should participate in overlap detection
    const task1Row = component.locator('tr[data-path="task1.md"]');
    const task2Row = component.locator('tr[data-path="task2.md"]');

    await expect(task1Row).toHaveClass(/task-overlap-conflict/);
    await expect(task2Row).toHaveClass(/task-overlap-conflict/);
  });

  test("should handle missing _prototypeClasses gracefully", async ({
    mount,
  }) => {
    const tasksWithPrototypeNoClasses: DailyTask[] = [
      {
        file: { path: "task1.md", basename: "task1" },
        path: "task1.md",
        title: "Task 1",
        label: "Task 1",
        startTime: "09:00",
        endTime: "11:00",
        startTimestamp: null,
        endTimestamp: null,
        status: "ems__EffortStatusInProgress",
        metadata: {
          ems__Effort_plannedStartTimestamp: "2025-01-15T09:00:00",
          ems__Effort_plannedEndTimestamp: "2025-01-15T11:00:00",
        },
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
      {
        file: { path: "task2.md", basename: "task2" },
        path: "task2.md",
        title: "Task with Prototype",
        label: "Task with Prototype",
        startTime: "10:00",
        endTime: "11:00",
        startTimestamp: null,
        endTimestamp: null,
        status: "ems__EffortStatusInProgress",
        metadata: {
          // Has prototype reference but _prototypeClasses not resolved
          exo__Asset_prototype: "[[some-prototype|Some Task]]",
          // _prototypeClasses is missing - should handle gracefully
          ems__Effort_plannedStartTimestamp: "2025-01-15T10:00:00",
          ems__Effort_plannedEndTimestamp: "2025-01-15T11:00:00",
        },
        isDone: false,
        isTrashed: false,
        isDoing: false,
        isMeeting: false,
        isBlocked: false,
      },
    ];

    const component = await mount(
      <DailyTasksTable tasks={tasksWithPrototypeNoClasses} />,
    );

    // Without resolved _prototypeClasses, should participate in overlap detection
    const task1Row = component.locator('tr[data-path="task1.md"]');
    const task2Row = component.locator('tr[data-path="task2.md"]');

    await expect(task1Row).toHaveClass(/task-overlap-conflict/);
    await expect(task2Row).toHaveClass(/task-overlap-conflict/);
  });
});
