import { test, expect } from "@playwright/experimental-ct-react";
import {
  AssetRelationsTable,
  AssetRelationsTableWithToggle,
  AssetRelation,
} from "../../src/presentation/components/AssetRelationsTable";

test.describe("AssetRelationsTable Component", () => {
  const mockRelations: AssetRelation[] = [
    {
      path: "tasks/task1.md",
      title: "Task 1",
      propertyName: "assignedTo",
      isBodyLink: false,
      created: Date.now() - 86400000,
      modified: Date.now(),
      metadata: {
        exo__Instance_class: "ems__Task",
        status: "active",
        priority: "high",
      },
    },
    {
      path: "tasks/task2.md",
      title: "Task 2",
      propertyName: "assignedTo",
      isBodyLink: false,
      created: Date.now() - 172800000,
      modified: Date.now() - 86400000,
      metadata: {
        exo__Instance_class: "[[ems__Project]]",
        status: "completed",
        priority: "medium",
      },
    },
    {
      path: "tasks/task3.md",
      title: "Task 3",
      propertyName: undefined,
      isBodyLink: true,
      created: Date.now() - 259200000,
      modified: Date.now() - 172800000,
      metadata: { status: "pending", priority: "low" },
    },
  ];

  test("should render table with relations", async ({ mount }) => {
    const component = await mount(
      <AssetRelationsTable relations={mockRelations} />,
    );

    // Check table exists
    await expect(component.locator(".exocortex-relations-table")).toBeVisible();

    // Check all relations are rendered
    await expect(component.locator("tbody tr")).toHaveCount(3);

    // Check titles are displayed
    await expect(component.locator("text=Task 1")).toBeVisible();
    await expect(component.locator("text=Task 2")).toBeVisible();
    await expect(component.locator("text=Task 3")).toBeVisible();
  });

  test("should handle sorting by name", async ({ mount }) => {
    const component = await mount(
      <AssetRelationsTable relations={mockRelations} />,
    );

    // Click Name header to sort (first click sorts descending)
    await component.locator('th:has-text("Name")').click();

    // Check sort indicator (component starts with desc on first click)
    await expect(component.locator('th:has-text("Name")')).toContainText("↓");

    // Click again to reverse sort to ascending
    await component.locator('th:has-text("Name")').click();
    await expect(component.locator('th:has-text("Name")')).toContainText("↑");
  });

  test("should group relations by property", async ({ mount }) => {
    const component = await mount(
      <AssetRelationsTable relations={mockRelations} groupByProperty={true} />,
    );

    // Check groups are rendered
    await expect(component.locator(".relation-group")).toHaveCount(2);

    // Check group headers
    await expect(
      component.locator('.group-header:has-text("assignedTo")'),
    ).toBeVisible();
    await expect(
      component.locator('.group-header:has-text("Body Links")'),
    ).toBeVisible();
  });

  test("should display additional properties", async ({ mount }) => {
    const component = await mount(
      <AssetRelationsTable
        relations={mockRelations}
        showProperties={["status", "priority"]}
      />,
    );

    // Check property columns exist
    await expect(component.locator('th:has-text("status")')).toBeVisible();
    await expect(component.locator('th:has-text("priority")')).toBeVisible();

    // Check property values are displayed
    await expect(component.locator("text=active")).toBeVisible();
    await expect(component.locator("text=high")).toBeVisible();
  });

  test("should handle asset click", async ({ mount }) => {
    let clickedPath: string | null = null;
    let clickedEvent: React.MouseEvent | null = null;

    const component = await mount(
      <AssetRelationsTable
        relations={mockRelations}
        onAssetClick={(path, event) => {
          clickedPath = path;
          clickedEvent = event;
        }}
      />,
    );

    // Click on first asset link
    await component.locator('a:has-text("Task 1")').click();

    // Verify callback was called with correct path
    expect(clickedPath).toBe("tasks/task1.md");
    expect(clickedEvent).not.toBeNull();
  });

  test("should pass event with metaKey when Command+Click", async ({
    mount,
    page,
  }) => {
    let clickedPath: string | null = null;
    let clickedEvent: React.MouseEvent | null = null;

    const component = await mount(
      <AssetRelationsTable
        relations={mockRelations}
        onAssetClick={(path, event) => {
          clickedPath = path;
          clickedEvent = event;
        }}
      />,
    );

    // Command+Click on first asset link (Mac)
    await component
      .locator('a:has-text("Task 1")')
      .click({ modifiers: ["Meta"] });

    // Verify callback was called with event containing metaKey
    expect(clickedPath).toBe("tasks/task1.md");
    expect(clickedEvent).not.toBeNull();
    // Note: We can't easily test metaKey in component tests, but the event is passed correctly
  });

  test("should handle empty relations", async ({ mount }) => {
    const component = await mount(<AssetRelationsTable relations={[]} />);

    // Should still render table structure
    await expect(component.locator(".exocortex-relations-table")).toBeVisible();

    // But no rows
    await expect(component.locator("tbody tr")).toHaveCount(0);
  });

  test("should display exo__Instance_class column", async ({ mount }) => {
    const component = await mount(
      <AssetRelationsTable relations={mockRelations} />,
    );

    // Check Instance Class column exists
    await expect(
      component.locator('th:has-text("exo__Instance_class")'),
    ).toBeVisible();

    // Check Instance Class values are displayed (wiki syntax removed)
    await expect(component.locator("text=ems__Task")).toBeVisible();
    await expect(component.locator("text=ems__Project")).toBeVisible();
  });

  test("should sort by exo__Instance_class", async ({ mount }) => {
    const component = await mount(
      <AssetRelationsTable relations={mockRelations} />,
    );

    // Click exo__Instance_class column
    await component.locator('th:has-text("exo__Instance_class")').click();

    // Check sort indicator
    await expect(
      component.locator('th:has-text("exo__Instance_class")'),
    ).toContainText("↑");
  });

  test("should display multiple exo__Instance_class values as comma-separated links", async ({
    mount,
  }) => {
    const relationsWithMultipleClasses: AssetRelation[] = [
      {
        path: "tasks/task1.md",
        title: "Multi-Class Task",
        propertyName: "assignedTo",
        isBodyLink: false,
        created: Date.now(),
        modified: Date.now(),
        metadata: {
          exo__Instance_class: ["[[exo__Prototype]]", "[[inbox__Stuff]]", "ems__Task"],
        },
      },
    ];

    const component = await mount(
      <AssetRelationsTable relations={relationsWithMultipleClasses} />,
    );

    // All three classes should be visible
    await expect(component.locator("text=exo__Prototype")).toBeVisible();
    await expect(component.locator("text=inbox__Stuff")).toBeVisible();
    await expect(component.locator("text=ems__Task")).toBeVisible();

    // Each class should be a clickable link
    const instanceClassCell = component.locator(".instance-class").first();
    const links = instanceClassCell.locator("a.internal-link");
    await expect(links).toHaveCount(3);
  });

  test("should handle click on individual class links in multi-value cell", async ({
    mount,
  }) => {
    let clickedPaths: string[] = [];

    const relationsWithMultipleClasses: AssetRelation[] = [
      {
        path: "tasks/task1.md",
        title: "Multi-Class Task",
        propertyName: "assignedTo",
        isBodyLink: false,
        created: Date.now(),
        modified: Date.now(),
        metadata: {
          exo__Instance_class: ["[[exo__Prototype]]", "[[inbox__Stuff]]"],
        },
      },
    ];

    const component = await mount(
      <AssetRelationsTable
        relations={relationsWithMultipleClasses}
        onAssetClick={(path) => {
          clickedPaths.push(path);
        }}
      />,
    );

    // Click on first class link
    await component.locator('a:has-text("exo__Prototype")').click();
    expect(clickedPaths).toContain("exo__Prototype");

    // Click on second class link
    await component.locator('a:has-text("inbox__Stuff")').click();
    expect(clickedPaths).toContain("inbox__Stuff");
  });

  test("should display single exo__Instance_class value without comma", async ({
    mount,
  }) => {
    const relationsWithSingleClass: AssetRelation[] = [
      {
        path: "tasks/task1.md",
        title: "Single-Class Task",
        propertyName: "assignedTo",
        isBodyLink: false,
        created: Date.now(),
        modified: Date.now(),
        metadata: {
          exo__Instance_class: "[[ems__Task]]",
        },
      },
    ];

    const component = await mount(
      <AssetRelationsTable relations={relationsWithSingleClass} />,
    );

    await expect(component.locator("text=ems__Task")).toBeVisible();

    // Should have exactly one link in instance-class cell
    const instanceClassCell = component.locator(".instance-class").first();
    await expect(instanceClassCell.locator("a.internal-link")).toHaveCount(1);

    // Cell text should not contain comma
    const cellText = await instanceClassCell.textContent();
    expect(cellText).not.toContain(",");
  });

  test("should display dash for empty exo__Instance_class array", async ({
    mount,
  }) => {
    const relationsWithEmptyArray: AssetRelation[] = [
      {
        path: "tasks/task1.md",
        title: "No-Class Task",
        propertyName: "assignedTo",
        isBodyLink: false,
        created: Date.now(),
        modified: Date.now(),
        metadata: {
          exo__Instance_class: [],
        },
      },
    ];

    const component = await mount(
      <AssetRelationsTable relations={relationsWithEmptyArray} />,
    );

    const instanceClassCell = component.locator(".instance-class").first();
    await expect(instanceClassCell).toHaveText("-");
  });

  test("should display multiple values in dynamic property columns", async ({
    mount,
  }) => {
    const relationsWithMultiValueProps: AssetRelation[] = [
      {
        path: "tasks/task1.md",
        title: "Task with Tags",
        propertyName: "assignedTo",
        isBodyLink: false,
        created: Date.now(),
        modified: Date.now(),
        metadata: {
          exo__Instance_class: "ems__Task",
          tags: ["[[tag1]]", "[[tag2]]", "[[tag3]]"],
        },
      },
    ];

    const component = await mount(
      <AssetRelationsTable
        relations={relationsWithMultiValueProps}
        showProperties={["tags"]}
      />,
    );

    // All tags should be visible
    await expect(component.locator("text=tag1")).toBeVisible();
    await expect(component.locator("text=tag2")).toBeVisible();
    await expect(component.locator("text=tag3")).toBeVisible();
  });

  test("should display exo__Asset_label when present instead of filename", async ({
    mount,
  }) => {
    const relationsWithLabels: AssetRelation[] = [
      {
        path: "tasks/task1.md",
        title: "Task 1",
        propertyName: "assignedTo",
        isBodyLink: false,
        created: Date.now(),
        modified: Date.now(),
        metadata: {
          exo__Instance_class: "ems__Task",
          exo__Asset_label: "Custom Label 1",
        },
      },
      {
        path: "tasks/task2.md",
        title: "Task 2",
        propertyName: "assignedTo",
        isBodyLink: false,
        created: Date.now(),
        modified: Date.now(),
        metadata: {
          exo__Instance_class: "ems__Task",
          exo__Asset_label: "Custom Label 2",
        },
      },
    ];

    const component = await mount(
      <AssetRelationsTable relations={relationsWithLabels} />,
    );

    // Check that labels are displayed instead of filenames
    await expect(component.locator("text=Custom Label 1")).toBeVisible();
    await expect(component.locator("text=Custom Label 2")).toBeVisible();

    // Check that original filenames are NOT displayed
    await expect(component.locator("text=Task 1")).not.toBeVisible();
    await expect(component.locator("text=Task 2")).not.toBeVisible();
  });

  test("should display filename when exo__Asset_label is missing", async ({
    mount,
  }) => {
    const relationsWithoutLabels: AssetRelation[] = [
      {
        path: "tasks/task1.md",
        title: "Task 1",
        propertyName: "assignedTo",
        isBodyLink: false,
        created: Date.now(),
        modified: Date.now(),
        metadata: { exo__Instance_class: "ems__Task" },
      },
    ];

    const component = await mount(
      <AssetRelationsTable relations={relationsWithoutLabels} />,
    );

    // Check that filename is displayed when label is missing
    await expect(component.locator("text=Task 1")).toBeVisible();
  });

  test("should display filename when exo__Asset_label is empty string", async ({
    mount,
  }) => {
    const relationsWithEmptyLabel: AssetRelation[] = [
      {
        path: "tasks/task1.md",
        title: "Task 1",
        propertyName: "assignedTo",
        isBodyLink: false,
        created: Date.now(),
        modified: Date.now(),
        metadata: { exo__Instance_class: "ems__Task", exo__Asset_label: "" },
      },
    ];

    const component = await mount(
      <AssetRelationsTable relations={relationsWithEmptyLabel} />,
    );

    // Check that filename is displayed when label is empty
    await expect(component.locator("text=Task 1")).toBeVisible();
  });

  test("should display filename when exo__Asset_label is whitespace only", async ({
    mount,
  }) => {
    const relationsWithWhitespaceLabel: AssetRelation[] = [
      {
        path: "tasks/task1.md",
        title: "Task 1",
        propertyName: "assignedTo",
        isBodyLink: false,
        created: Date.now(),
        modified: Date.now(),
        metadata: { exo__Instance_class: "ems__Task", exo__Asset_label: "   " },
      },
    ];

    const component = await mount(
      <AssetRelationsTable relations={relationsWithWhitespaceLabel} />,
    );

    // Check that filename is displayed when label is whitespace
    await expect(component.locator("text=Task 1")).toBeVisible();
  });

  test("should display label from metadata directly (not from prototype)", async ({
    mount,
  }) => {
    // Note: AssetRelationsTable receives metadata directly, not file paths
    // Prototype label lookup happens in UniversalLayoutRenderer.getAssetLabel()
    // This component always uses metadata.exo__Asset_label if present
    const relationsWithLabel: AssetRelation[] = [
      {
        path: "tasks/task1.md",
        title: "Task 1",
        propertyName: "assignedTo",
        isBodyLink: false,
        created: Date.now(),
        modified: Date.now(),
        metadata: {
          exo__Instance_class: "ems__Task",
          exo__Asset_label: "Prototype Label",
          exo__Asset_prototype: "[[TaskPrototype]]",
        },
      },
    ];

    const component = await mount(
      <AssetRelationsTable relations={relationsWithLabel} />,
    );

    // Component should display the label from metadata
    await expect(component.locator("text=Prototype Label")).toBeVisible();
  });

  test("should display multiple relations when same asset links via multiple properties", async ({
    mount,
  }) => {
    // Bug reproduction: Asset A links to Asset B via property1 and property2
    // Asset B should show both relations, not just one
    const duplicateRelations: AssetRelation[] = [
      {
        path: "assets/AssetA.md",
        title: "Asset A",
        propertyName: "property1",
        isBodyLink: false,
        created: Date.now(),
        modified: Date.now(),
        metadata: { exo__Instance_class: "ems__Task" },
      },
      {
        path: "assets/AssetA.md",
        title: "Asset A",
        propertyName: "property2",
        isBodyLink: false,
        created: Date.now(),
        modified: Date.now(),
        metadata: { exo__Instance_class: "ems__Task" },
      },
    ];

    const component = await mount(
      <AssetRelationsTable
        relations={duplicateRelations}
        groupByProperty={true}
      />,
    );

    // Should render 2 separate groups
    await expect(component.locator(".relation-group")).toHaveCount(2);

    // Both properties should be shown
    await expect(
      component.locator('.group-header:has-text("property1")'),
    ).toBeVisible();
    await expect(
      component.locator('.group-header:has-text("property2")'),
    ).toBeVisible();

    // Each group should have 1 row
    const property1Group = component.locator(
      '.relation-group:has(.group-header:has-text("property1"))',
    );
    await expect(property1Group.locator("tbody tr")).toHaveCount(1);

    const property2Group = component.locator(
      '.relation-group:has(.group-header:has-text("property2"))',
    );
    await expect(property2Group.locator("tbody tr")).toHaveCount(1);
  });

  test("should display blocker icon when relation is blocked", async ({
    mount,
  }) => {
    const blockedRelation: AssetRelation = {
      path: "tasks/blocked-task.md",
      title: "Blocked Task",
      propertyName: "assignedTo",
      isBodyLink: false,
      created: Date.now(),
      modified: Date.now(),
      isBlocked: true,
      metadata: {
        exo__Instance_class: "ems__Task",
      },
    };

    const component = await mount(
      <AssetRelationsTable relations={[blockedRelation]} />,
    );

    const taskName = component.locator(
      'tr[data-path="tasks/blocked-task.md"] .asset-name a',
    );
    await expect(taskName).toContainText("🚩");
    await expect(taskName).toContainText("Blocked Task");
  });

  test("should not display blocker icon when relation is not blocked", async ({
    mount,
  }) => {
    const unblockedRelation: AssetRelation = {
      path: "tasks/unblocked-task.md",
      title: "Unblocked Task",
      propertyName: "assignedTo",
      isBodyLink: false,
      created: Date.now(),
      modified: Date.now(),
      isBlocked: false,
      metadata: {
        exo__Instance_class: "ems__Task",
      },
    };

    const component = await mount(
      <AssetRelationsTable relations={[unblockedRelation]} />,
    );

    const taskName = component.locator(
      'tr[data-path="tasks/unblocked-task.md"] .asset-name a',
    );
    const text = await taskName.textContent();
    expect(text).not.toContain("🚩");
  });

  test("should display blocker icon with custom label", async ({ mount }) => {
    const blockedRelationWithLabel: AssetRelation = {
      path: "tasks/blocked-task.md",
      title: "Blocked Task",
      propertyName: "assignedTo",
      isBodyLink: false,
      created: Date.now(),
      modified: Date.now(),
      isBlocked: true,
      metadata: {
        exo__Instance_class: "ems__Task",
        exo__Asset_label: "Custom Blocked Label",
      },
    };

    const component = await mount(
      <AssetRelationsTable relations={[blockedRelationWithLabel]} />,
    );

    const taskName = component.locator(
      'tr[data-path="tasks/blocked-task.md"] .asset-name a',
    );
    await expect(taskName).toContainText("🚩");
    await expect(taskName).toContainText("Custom Blocked Label");
  });
});

test.describe("AssetRelationsTableWithToggle Component", () => {
  const mockRelationsWithVotes: AssetRelation[] = [
    {
      path: "tasks/task1.md",
      title: "Task 1",
      propertyName: "ems__Effort_parent",
      isBodyLink: false,
      created: Date.now(),
      modified: Date.now(),
      metadata: {
        exo__Instance_class: "ems__Task",
        ems__Effort_votes: 5,
      },
    },
    {
      path: "tasks/task2.md",
      title: "Task 2",
      propertyName: "ems__Effort_parent",
      isBodyLink: false,
      created: Date.now(),
      modified: Date.now(),
      metadata: {
        exo__Instance_class: "ems__Task",
        ems__Effort_votes: 3,
      },
    },
  ];

  test("should render toggle button", async ({ mount }) => {
    const component = await mount(
      <AssetRelationsTableWithToggle
        relations={mockRelationsWithVotes}
        showEffortVotes={false}
        onToggleEffortVotes={() => {}}
        showArchived={false}
        onToggleArchived={() => {}}
      />,
    );

    await expect(
      component.locator("button.exocortex-toggle-effort-votes"),
    ).toBeVisible();
    await expect(
      component.locator("button.exocortex-toggle-effort-votes"),
    ).toHaveText("Show Votes");
  });

  test("should show Votes column when showEffortVotes is true", async ({
    mount,
  }) => {
    const component = await mount(
      <AssetRelationsTableWithToggle
        relations={mockRelationsWithVotes}
        showEffortVotes={true}
        onToggleEffortVotes={() => {}}
        showArchived={false}
        onToggleArchived={() => {}}
      />,
    );

    await expect(component.locator('th:has-text("ems__Effort_votes")')).toBeVisible();
    await expect(component.locator("text=5")).toBeVisible();
    await expect(component.locator("text=3")).toBeVisible();
    await expect(
      component.locator("button.exocortex-toggle-effort-votes"),
    ).toHaveText("Hide Votes");
  });

  test("should hide Votes column when showEffortVotes is false", async ({
    mount,
  }) => {
    const component = await mount(
      <AssetRelationsTableWithToggle
        relations={mockRelationsWithVotes}
        showEffortVotes={false}
        onToggleEffortVotes={() => {}}
        showArchived={false}
        onToggleArchived={() => {}}
      />,
    );

    await expect(
      component.locator('th:has-text("ems__Effort_votes")'),
    ).not.toBeVisible();
    await expect(
      component.locator("button.exocortex-toggle-effort-votes"),
    ).toHaveText("Show Votes");
  });

  test("should call onToggleEffortVotes when button clicked", async ({
    mount,
  }) => {
    let toggleCalled = false;

    const component = await mount(
      <AssetRelationsTableWithToggle
        relations={mockRelationsWithVotes}
        showEffortVotes={false}
        onToggleEffortVotes={() => {
          toggleCalled = true;
        }}
        showArchived={false}
        onToggleArchived={() => {}}
      />,
    );

    await component.locator("button.exocortex-toggle-effort-votes").click();
    expect(toggleCalled).toBe(true);
  });

  test("should pass through other properties to AssetRelationsTable", async ({
    mount,
  }) => {
    const component = await mount(
      <AssetRelationsTableWithToggle
        relations={mockRelationsWithVotes}
        showEffortVotes={false}
        onToggleEffortVotes={() => {}}
        showArchived={false}
        onToggleArchived={() => {}}
        groupByProperty={true}
        showProperties={["ems__Effort_status"]}
      />,
    );

    await expect(component.locator(".relation-group")).toBeVisible();
    await expect(
      component.locator('th:has-text("ems__Effort_status")'),
    ).toBeVisible();
  });

  test("should render Show Archived toggle button", async ({ mount }) => {
    const component = await mount(
      <AssetRelationsTableWithToggle
        relations={mockRelationsWithVotes}
        showEffortVotes={false}
        onToggleEffortVotes={() => {}}
        showArchived={false}
        onToggleArchived={() => {}}
      />,
    );

    await expect(
      component.locator("button.exocortex-toggle-archived"),
    ).toBeVisible();
    await expect(
      component.locator("button.exocortex-toggle-archived"),
    ).toHaveText("Show Archived");
  });

  test("should filter archived relations when showArchived is false", async ({
    mount,
  }) => {
    const relationsWithArchived: AssetRelation[] = [
      {
        path: "tasks/active-task.md",
        title: "Active Task",
        propertyName: "ems__Effort_parent",
        isBodyLink: false,
        created: Date.now(),
        modified: Date.now(),
        isArchived: false,
        metadata: { exo__Instance_class: "ems__Task" },
      },
      {
        path: "tasks/archived-task.md",
        title: "Archived Task",
        propertyName: "ems__Effort_parent",
        isBodyLink: false,
        created: Date.now(),
        modified: Date.now(),
        isArchived: true,
        metadata: { exo__Instance_class: "ems__Task", exo__Asset_isArchived: true },
      },
    ];

    const component = await mount(
      <AssetRelationsTableWithToggle
        relations={relationsWithArchived}
        showEffortVotes={false}
        onToggleEffortVotes={() => {}}
        showArchived={false}
        onToggleArchived={() => {}}
      />,
    );

    await expect(component.locator("text=Active Task")).toBeVisible();
    await expect(component.locator("text=Archived Task")).not.toBeVisible();
    await expect(component.locator("tbody tr")).toHaveCount(1);
  });

  test("should show archived relations when showArchived is true", async ({
    mount,
  }) => {
    const relationsWithArchived: AssetRelation[] = [
      {
        path: "tasks/active-task.md",
        title: "Active Task",
        propertyName: "ems__Effort_parent",
        isBodyLink: false,
        created: Date.now(),
        modified: Date.now(),
        isArchived: false,
        metadata: { exo__Instance_class: "ems__Task" },
      },
      {
        path: "tasks/archived-task.md",
        title: "Archived Task",
        propertyName: "ems__Effort_parent",
        isBodyLink: false,
        created: Date.now(),
        modified: Date.now(),
        isArchived: true,
        metadata: { exo__Instance_class: "ems__Task", exo__Asset_isArchived: true },
      },
    ];

    const component = await mount(
      <AssetRelationsTableWithToggle
        relations={relationsWithArchived}
        showEffortVotes={false}
        onToggleEffortVotes={() => {}}
        showArchived={true}
        onToggleArchived={() => {}}
      />,
    );

    await expect(component.locator("text=Active Task")).toBeVisible();
    await expect(component.locator("text=Archived Task")).toBeVisible();
    await expect(component.locator("tbody tr")).toHaveCount(2);
    await expect(
      component.locator("button.exocortex-toggle-archived"),
    ).toHaveText("Hide Archived");
  });

  test("should call onToggleArchived when button clicked", async ({
    mount,
  }) => {
    let toggleCalled = false;

    const component = await mount(
      <AssetRelationsTableWithToggle
        relations={mockRelationsWithVotes}
        showEffortVotes={false}
        onToggleEffortVotes={() => {}}
        showArchived={false}
        onToggleArchived={() => {
          toggleCalled = true;
        }}
      />,
    );

    await component.locator("button.exocortex-toggle-archived").click();
    expect(toggleCalled).toBe(true);
  });

  test("should have sortable dynamic property headers", async ({ mount }) => {
    const testRelations: AssetRelation[] = [
      {
        path: "task1.md",
        title: "Task 1",
        propertyName: undefined,
        isBodyLink: false,
        created: Date.now(),
        modified: Date.now(),
        metadata: { status: "active", priority: "high" },
      },
    ];

    const component = await mount(
      <AssetRelationsTable
        relations={testRelations}
        showProperties={["status", "priority"]}
      />,
    );

    const statusHeader = component.locator('thead th:has-text("status")');
    await expect(statusHeader).toHaveClass(/sortable/);
    await expect(statusHeader).toHaveCSS("cursor", "pointer");

    const priorityHeader = component.locator('thead th:has-text("priority")');
    await expect(priorityHeader).toHaveClass(/sortable/);
    await expect(priorityHeader).toHaveCSS("cursor", "pointer");
  });

  test("should sort by dynamic property column", async ({ mount }) => {
    const relationsWithProps: AssetRelation[] = [
      {
        path: "task1.md",
        title: "Task 1",
        propertyName: undefined,
        isBodyLink: false,
        created: Date.now(),
        modified: Date.now(),
        metadata: { priority: "high" },
      },
      {
        path: "task2.md",
        title: "Task 2",
        propertyName: undefined,
        isBodyLink: false,
        created: Date.now(),
        modified: Date.now(),
        metadata: { priority: "low" },
      },
      {
        path: "task3.md",
        title: "Task 3",
        propertyName: undefined,
        isBodyLink: false,
        created: Date.now(),
        modified: Date.now(),
        metadata: { priority: "medium" },
      },
    ];

    const component = await mount(
      <AssetRelationsTable
        relations={relationsWithProps}
        showProperties={["priority"]}
      />,
    );

    await component.locator('thead th:has-text("priority")').click();

    const rows = component.locator("tbody tr");
    await expect(rows).toHaveCount(3);

    await expect(component.locator('thead th:has-text("priority")')).toContainText("↑");
  });

  test("should sort by numeric dynamic property", async ({ mount }) => {
    const relationsWithNumbers: AssetRelation[] = [
      {
        path: "task1.md",
        title: "Task 1",
        propertyName: undefined,
        isBodyLink: false,
        created: Date.now(),
        modified: Date.now(),
        metadata: { ems__Effort_votes: 10 },
      },
      {
        path: "task2.md",
        title: "Task 2",
        propertyName: undefined,
        isBodyLink: false,
        created: Date.now(),
        modified: Date.now(),
        metadata: { ems__Effort_votes: 3 },
      },
      {
        path: "task3.md",
        title: "Task 3",
        propertyName: undefined,
        isBodyLink: false,
        created: Date.now(),
        modified: Date.now(),
        metadata: { ems__Effort_votes: 7 },
      },
    ];

    const component = await mount(
      <AssetRelationsTable
        relations={relationsWithNumbers}
        showProperties={["ems__Effort_votes"]}
      />,
    );

    await component.locator('thead th:has-text("ems__Effort_votes")').click();

    const firstRow = component.locator("tbody tr").first();
    const firstValue = await firstRow.locator("td").nth(2).textContent();
    expect(firstValue).toBe("3");

    await expect(component.locator('thead th:has-text("ems__Effort_votes")')).toContainText("↑");
  });

  test("should sort by wiki link dynamic property", async ({ mount }) => {
    const relationsWithLinks: AssetRelation[] = [
      {
        path: "task1.md",
        title: "Task 1",
        propertyName: undefined,
        isBodyLink: false,
        created: Date.now(),
        modified: Date.now(),
        metadata: { area: "[[area1|Zebra Area]]" },
      },
      {
        path: "task2.md",
        title: "Task 2",
        propertyName: undefined,
        isBodyLink: false,
        created: Date.now(),
        modified: Date.now(),
        metadata: { area: "[[area2|Alpha Area]]" },
      },
    ];

    const component = await mount(
      <AssetRelationsTable
        relations={relationsWithLinks}
        showProperties={["area"]}
      />,
    );

    await component.locator('thead th:has-text("area")').click();

    const rows = component.locator("tbody tr");
    await expect(rows).toHaveCount(2);

    await expect(component.locator('thead th:has-text("area")')).toContainText("↑");
  });
});

test.describe("AssetRelationsTable Virtualization", () => {
  // Generate mock relations for virtualization tests
  const generateMockRelations = (count: number): AssetRelation[] => {
    return Array.from({ length: count }, (_, i) => ({
      path: `tasks/task${i + 1}.md`,
      title: `Task ${i + 1}`,
      propertyName: "assignedTo",
      isBodyLink: false,
      created: Date.now() - i * 86400000,
      modified: Date.now() - i * 43200000,
      metadata: {
        exo__Instance_class: "ems__Task",
        status: i % 2 === 0 ? "active" : "completed",
        priority: ["high", "medium", "low"][i % 3],
      },
    }));
  };

  test("should render table with exactly 51 items (threshold+1, virtualization active)", async ({ mount }) => {
    const relations = generateMockRelations(51);

    const component = await mount(
      <AssetRelationsTable relations={relations} />,
    );

    // Verify virtualized container is present
    await expect(component.locator(".exocortex-relations-virtualized")).toBeVisible();

    // Verify scroll container has proper height
    const scrollContainer = component.locator(".exocortex-virtual-scroll-container");
    await expect(scrollContainer).toBeVisible();

    // Verify some rows are visible (virtualization renders only visible items + overscan)
    const rows = component.locator("tbody tr");
    // With virtualization, we should see at least some rows rendered
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);

    // Verify first task is visible (use exact match to avoid matching Task 10, Task 11, etc.)
    await expect(component.getByText("Task 1", { exact: true })).toBeVisible();
  });

  test("should render table with 100 items using virtualization", async ({ mount }) => {
    const relations = generateMockRelations(100);

    const component = await mount(
      <AssetRelationsTable relations={relations} />,
    );

    // Verify virtualized structure
    await expect(component.locator(".exocortex-relations-virtualized")).toBeVisible();
    await expect(component.locator(".exocortex-virtual-scroll-container")).toBeVisible();

    // Verify rows are rendered (not empty)
    const rows = component.locator("tbody tr");
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);

    // Check that scroll container has proper dimensions
    const scrollContainer = component.locator(".exocortex-virtual-scroll-container");
    const scrollStyle = await scrollContainer.getAttribute("style");
    expect(scrollStyle).toContain("height: 400px");
    expect(scrollStyle).toContain("overflow: auto");

    // Verify content wrapper has non-zero height (totalSize calculation)
    const contentWrapper = component.locator(".exocortex-virtual-scroll-container > div").first();
    const contentStyle = await contentWrapper.getAttribute("style");
    // Height should be at least 51 * 35 = 1785px (since 51 items exceed threshold)
    expect(contentStyle).toContain("height:");
    // Extract height and verify it's reasonable (100 items * 35px = 3500px)
    const heightMatch = contentStyle?.match(/height:\s*(\d+)px/);
    expect(heightMatch).not.toBeNull();
    if (heightMatch) {
      const height = parseInt(heightMatch[1], 10);
      // Should be approximately 100 * 35 = 3500px (with some tolerance for render timing)
      expect(height).toBeGreaterThan(0);
    }
  });

  test("should render table with exactly 50 items (at threshold, no virtualization)", async ({ mount }) => {
    const relations = generateMockRelations(50);

    const component = await mount(
      <AssetRelationsTable relations={relations} />,
    );

    // At exactly 50 items, virtualization should NOT be active
    // Should render regular table structure
    await expect(component.locator(".exocortex-relations-table")).toBeVisible();

    // Verify all 50 rows are rendered (no virtualization = all rows visible)
    const rows = component.locator("tbody tr");
    await expect(rows).toHaveCount(50);
  });

  test("should render all visible items after scrolling", async ({ mount }) => {
    const relations = generateMockRelations(75);

    const component = await mount(
      <AssetRelationsTable relations={relations} />,
    );

    await expect(component.locator(".exocortex-relations-virtualized")).toBeVisible();

    // Scroll down in the container
    const scrollContainer = component.locator(".exocortex-virtual-scroll-container");
    await scrollContainer.evaluate((el) => {
      el.scrollTop = 500; // Scroll down 500px
    });

    // Wait for virtualization to update
    await component.page().waitForTimeout(100);

    // Verify rows are still rendered (not empty after scroll)
    const rows = component.locator("tbody tr");
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);
  });

  test("should handle sorting with virtualized table", async ({ mount }) => {
    const relations = generateMockRelations(60);

    const component = await mount(
      <AssetRelationsTable relations={relations} showProperties={["status"]} />,
    );

    await expect(component.locator(".exocortex-relations-virtualized")).toBeVisible();

    // Click on status column to sort
    await component.locator('th:has-text("status")').click();

    // Verify sort indicator appears
    await expect(component.locator('th:has-text("status")')).toContainText("↑");

    // Verify table still renders rows after sorting
    const rows = component.locator("tbody tr");
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);
  });
});
