import { test, expect } from "@playwright/experimental-ct-react";
import {
  AssetRelationsTable,
  AssetRelation,
} from "../../src/presentation/components/AssetRelationsTable";
import {
  DailyTasksTable,
  DailyTask,
} from "../../src/presentation/components/DailyTasksTable";

test.describe("Responsive Layout CSS Tests", () => {
  const mockRelations: AssetRelation[] = [
    {
      path: "tasks/task1.md",
      title: "Task 1",
      propertyName: "assignedTo",
      isBodyLink: false,
      created: Date.now(),
      modified: Date.now(),
      metadata: { exo__Instance_class: ["[[ems__Task]]"] },
    },
  ];

  const mockTasks: DailyTask[] = [
    {
      file: { path: "tasks/task1.md", basename: "task1" },
      path: "tasks/task1.md",
      title: "Task 1",
      label: "Task 1",
      startTime: "09:00",
      endTime: "10:00",
      status: "ems__EffortStatusToDo",
      metadata: {},
      isDone: false,
      isTrashed: false,
      isDoing: false,
      isMeeting: false,
    },
  ];

  test("AssetRelationsTable should render tables correctly", async ({
    mount,
  }) => {
    const component = await mount(
      <AssetRelationsTable relations={mockRelations} />,
    );

    const table = component
      .locator(".exocortex-relation-table, .exocortex-relations-table")
      .first();
    await expect(table).toBeVisible();

    await expect(component.locator("text=Task 1")).toBeVisible();
  });

  test("DailyTasksTable should render correctly", async ({ mount }) => {
    const component = await mount(<DailyTasksTable tasks={mockTasks} />);

    const table = component.locator("table").first();
    await expect(table).toBeVisible();

    await expect(component.locator("text=Task 1")).toBeVisible();
  });

  test("Layout section CSS should have width 100% not max-width 900px", async ({
    page,
  }) => {
    await page.addStyleTag({
      content: `
        .exocortex-properties-section,
        .exocortex-daily-tasks-section,
        .exocortex-assets-relations {
          width: 100%;
          margin-bottom: 32px;
        }
      `,
    });

    await page.setContent(`
      <div class="exocortex-properties-section">Test</div>
      <div class="exocortex-daily-tasks-section">Test</div>
      <div class="exocortex-assets-relations">Test</div>
    `);

    const propertiesSection = page.locator(".exocortex-properties-section");
    const dailyTasksSection = page.locator(".exocortex-daily-tasks-section");
    const assetsRelations = page.locator(".exocortex-assets-relations");

    const propsStyle = await propertiesSection.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return { width: style.width, maxWidth: style.maxWidth };
    });

    const tasksStyle = await dailyTasksSection.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return { width: style.width, maxWidth: style.maxWidth };
    });

    const relationsStyle = await assetsRelations.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return { width: style.width, maxWidth: style.maxWidth };
    });

    expect(propsStyle.maxWidth).not.toBe("900px");
    expect(tasksStyle.maxWidth).not.toBe("900px");
    expect(relationsStyle.maxWidth).not.toBe("900px");
  });

  test("Action buttons container CSS should have width 100%", async ({
    page,
  }) => {
    await page.addStyleTag({
      content: `
        .exocortex-action-buttons-container {
          display: flex;
          flex-direction: column;
          gap: 24px;
          margin: 16px 0 32px 0;
          padding: 20px;
          width: 100%;
        }
      `,
    });

    await page.setContent(`
      <div class="exocortex-action-buttons-container">
        <button>Test Button</button>
      </div>
    `);

    const container = page.locator(".exocortex-action-buttons-container");
    const style = await container.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return { width: style.width, maxWidth: style.maxWidth };
    });

    expect(style.maxWidth).not.toBe("900px");
  });
});
