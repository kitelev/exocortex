import { test, expect } from "@playwright/experimental-ct-react";
import {
  AreaHierarchyTree,
  AreaNode,
} from "../../src/presentation/components/AreaHierarchyTree";
import "../../styles.css";

test.describe("AreaHierarchyTree Component", () => {
  const mockTreeSingleNode: AreaNode = {
    path: "areas/root.md",
    title: "root",
    label: "Root Area",
    isArchived: false,
    depth: 0,
    children: [],
  };

  const mockTreeWithChildren: AreaNode = {
    path: "areas/root.md",
    title: "root",
    label: "Root Area",
    isArchived: false,
    depth: 0,
    children: [
      {
        path: "areas/child1.md",
        title: "child1",
        label: "Child 1",
        isArchived: false,
        depth: 1,
        parentPath: "areas/root.md",
        children: [],
      },
      {
        path: "areas/child2.md",
        title: "child2",
        label: "Child 2",
        isArchived: false,
        depth: 1,
        parentPath: "areas/root.md",
        children: [],
      },
    ],
  };

  const mockTreeMultiLevel: AreaNode = {
    path: "areas/root.md",
    title: "root",
    label: "Root Area",
    isArchived: false,
    depth: 0,
    children: [
      {
        path: "areas/child1.md",
        title: "child1",
        label: "Child 1",
        isArchived: false,
        depth: 1,
        parentPath: "areas/root.md",
        children: [
          {
            path: "areas/grandchild1.md",
            title: "grandchild1",
            label: "Grandchild 1",
            isArchived: false,
            depth: 2,
            parentPath: "areas/child1.md",
            children: [],
          },
        ],
      },
    ],
  };

  const mockTreeWithArchived: AreaNode = {
    path: "areas/root.md",
    title: "root",
    label: "Root Area",
    isArchived: false,
    depth: 0,
    children: [
      {
        path: "areas/archived-child.md",
        title: "archived-child",
        label: "Archived Child",
        isArchived: true,
        depth: 1,
        parentPath: "areas/root.md",
        children: [],
      },
    ],
  };

  test("should not render when tree has no children", async ({ mount }) => {
    const component = await mount(
      <AreaHierarchyTree
        tree={mockTreeSingleNode}
        currentAreaPath="areas/root.md"
      />,
    );

    await expect(
      component.locator("table.exocortex-relation-table"),
    ).not.toBeVisible();
  });

  test("should render table structure with children", async ({ mount }) => {
    const component = await mount(
      <AreaHierarchyTree
        tree={mockTreeWithChildren}
        currentAreaPath="areas/root.md"
      />,
    );

    await expect(
      component.locator("table.exocortex-relation-table"),
    ).toBeVisible();
    await expect(component.locator("thead")).toBeVisible();
    await expect(component.locator("th")).toHaveCount(2);
    await expect(component.locator("th").first()).toHaveText("Area");
    await expect(component.locator("th").last()).toHaveText("Class");
  });

  test("should render only direct children, not root", async ({ mount }) => {
    const component = await mount(
      <AreaHierarchyTree
        tree={mockTreeWithChildren}
        currentAreaPath="areas/root.md"
      />,
    );

    await expect(component.locator("tbody tr")).toHaveCount(2);
    await expect(component.locator("text=Root Area")).not.toBeVisible();
    await expect(component.locator("text=Child 1")).toBeVisible();
    await expect(component.locator("text=Child 2")).toBeVisible();
  });

  test("should highlight current area", async ({ mount }) => {
    const component = await mount(
      <AreaHierarchyTree
        tree={mockTreeWithChildren}
        currentAreaPath="areas/child1.md"
      />,
    );

    const currentItem = component.locator(".area-tree-item.is-current");
    await expect(currentItem).toBeVisible();
    const currentLink = currentItem.locator(".area-tree-link");
    await expect(currentLink).toContainText("Child 1");
  });

  test("should display multi-level hierarchy with collapsible nodes", async ({
    mount,
  }) => {
    const component = await mount(
      <AreaHierarchyTree
        tree={mockTreeMultiLevel}
        currentAreaPath="areas/root.md"
      />,
    );

    // Initially only top-level children visible (collapsed by default)
    await expect(component.locator("tbody tr")).toHaveCount(1);
    await expect(
      component.locator('[data-href="areas/root.md"]'),
    ).not.toBeVisible();
    await expect(
      component.locator('[data-href="areas/child1.md"]'),
    ).toBeVisible();
    await expect(
      component.locator('[data-href="areas/grandchild1.md"]'),
    ).not.toBeVisible();
    
    // Expand to see grandchildren
    const toggle = component.locator(".area-tree-toggle").first();
    await toggle.click();
    await expect(
      component.locator('[data-href="areas/grandchild1.md"]'),
    ).toBeVisible();
  });

  test("should show indentation for hierarchy levels", async ({ mount }) => {
    const component = await mount(
      <AreaHierarchyTree
        tree={mockTreeMultiLevel}
        currentAreaPath="areas/root.md"
      />,
    );

    // Expand to see grandchildren
    const toggle = component.locator(".area-tree-toggle").first();
    await toggle.click();

    const childItem = component
      .locator('[data-area-path="areas/child1.md"]')
      .locator(".area-tree-item");
    const grandchildItem = component
      .locator('[data-area-path="areas/grandchild1.md"]')
      .locator(".area-tree-item");

    const childPadding = await childItem.evaluate((el) => {
      return parseInt(window.getComputedStyle(el).paddingLeft);
    });
    const grandchildPadding = await grandchildItem.evaluate((el) => {
      return parseInt(window.getComputedStyle(el).paddingLeft);
    });

    expect(childPadding).toBe(8); // 8px base + 0px for depth 0
    expect(grandchildPadding).toBe(28); // 8px base + 20px for depth 1
    expect(grandchildPadding).toBeGreaterThan(childPadding); // Visual hierarchy
  });

  test("should style archived child areas", async ({ mount }) => {
    const component = await mount(
      <AreaHierarchyTree
        tree={mockTreeWithArchived}
        currentAreaPath="areas/root.md"
      />,
    );

    const archivedItem = component.locator(".area-tree-item.is-archived");
    await expect(archivedItem).toBeVisible();
    const archivedLink = archivedItem.locator(".area-tree-link");
    await expect(archivedLink).toContainText("Archived Child");
  });

  test("should handle area click events", async ({ mount }) => {
    let clickedPath: string | null = null;

    const component = await mount(
      <AreaHierarchyTree
        tree={mockTreeWithChildren}
        currentAreaPath="areas/root.md"
        onAreaClick={(path) => {
          clickedPath = path;
        }}
      />,
    );

    const child1Link = component.locator('[data-href="areas/child1.md"]');
    await child1Link.click();

    expect(clickedPath).toBe("areas/child1.md");
  });

  test("should display label when available for child nodes", async ({
    mount,
  }) => {
    const treeWithLabel: AreaNode = {
      path: "areas/parent.md",
      title: "parent",
      label: "Parent",
      isArchived: false,
      depth: 0,
      children: [
        {
          path: "areas/child.md",
          title: "child",
          label: "Child Label",
          isArchived: false,
          depth: 1,
          parentPath: "areas/parent.md",
          children: [],
        },
      ],
    };

    const component = await mount(
      <AreaHierarchyTree
        tree={treeWithLabel}
        currentAreaPath="areas/parent.md"
      />,
    );

    await expect(
      component.locator("td:nth-child(1) .internal-link"),
    ).toContainText("Child Label");
  });

  test("should fallback to title when label is not available for child nodes", async ({
    mount,
  }) => {
    const treeWithoutLabel: AreaNode = {
      path: "areas/parent.md",
      title: "parent",
      isArchived: false,
      depth: 0,
      children: [
        {
          path: "areas/child.md",
          title: "child-title",
          isArchived: false,
          depth: 1,
          parentPath: "areas/parent.md",
          children: [],
        },
      ],
    };

    const component = await mount(
      <AreaHierarchyTree
        tree={treeWithoutLabel}
        currentAreaPath="areas/parent.md"
      />,
    );

    await expect(
      component.locator("td:nth-child(1) .internal-link"),
    ).toContainText("child-title");
  });

  test("should display ems__Area class for all child rows", async ({
    mount,
  }) => {
    const component = await mount(
      <AreaHierarchyTree
        tree={mockTreeWithChildren}
        currentAreaPath="areas/root.md"
      />,
    );

    const classLinks = component.locator("td:nth-child(2) .internal-link");
    await expect(classLinks).toHaveCount(2);
    await expect(classLinks.first()).toHaveText("ems__Area");
  });

  test("should display collapse/expand toggle for nodes with children", async ({
    mount,
  }) => {
    const component = await mount(
      <AreaHierarchyTree
        tree={mockTreeMultiLevel}
        currentAreaPath="areas/root.md"
      />,
    );

    const toggle = component.locator(".area-tree-toggle").first();
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveText("▶"); // Collapsed by default
  });

  test("should not display toggle for nodes without children", async ({
    mount,
  }) => {
    const component = await mount(
      <AreaHierarchyTree
        tree={mockTreeWithChildren}
        currentAreaPath="areas/root.md"
      />,
    );

    const toggles = component.locator(".area-tree-toggle");
    await expect(toggles).toHaveCount(0);
  });

  test("should expand children when toggle is clicked", async ({ mount }) => {
    const component = await mount(
      <AreaHierarchyTree
        tree={mockTreeMultiLevel}
        currentAreaPath="areas/root.md"
      />,
    );

    // Initially collapsed
    await expect(
      component.locator('[data-href="areas/grandchild1.md"]'),
    ).not.toBeVisible();

    const toggle = component.locator(".area-tree-toggle").first();
    await toggle.click();

    await expect(toggle).toHaveText("▼");
    await expect(
      component.locator('[data-href="areas/grandchild1.md"]'),
    ).toBeVisible();
  });

  test("should collapse children when toggle is clicked again", async ({
    mount,
  }) => {
    const component = await mount(
      <AreaHierarchyTree
        tree={mockTreeMultiLevel}
        currentAreaPath="areas/root.md"
      />,
    );

    const toggle = component.locator(".area-tree-toggle").first();

    // First click: expand
    await toggle.click();
    await expect(
      component.locator('[data-href="areas/grandchild1.md"]'),
    ).toBeVisible();
    await expect(toggle).toHaveText("▼");

    // Second click: collapse
    await toggle.click();
    await expect(
      component.locator('[data-href="areas/grandchild1.md"]'),
    ).not.toBeVisible();
    await expect(toggle).toHaveText("▶");
  });

  test("should maintain independent collapse states for different nodes", async ({
    mount,
  }) => {
    const treeWithMultipleBranches: AreaNode = {
      path: "areas/root.md",
      title: "root",
      label: "Root",
      isArchived: false,
      depth: 0,
      children: [
        {
          path: "areas/child1.md",
          title: "child1",
          label: "Child 1",
          isArchived: false,
          depth: 1,
          parentPath: "areas/root.md",
          children: [
            {
              path: "areas/grandchild1.md",
              title: "grandchild1",
              label: "Grandchild 1",
              isArchived: false,
              depth: 2,
              parentPath: "areas/child1.md",
              children: [],
            },
          ],
        },
        {
          path: "areas/child2.md",
          title: "child2",
          label: "Child 2",
          isArchived: false,
          depth: 1,
          parentPath: "areas/root.md",
          children: [
            {
              path: "areas/grandchild2.md",
              title: "grandchild2",
              label: "Grandchild 2",
              isArchived: false,
              depth: 2,
              parentPath: "areas/child2.md",
              children: [],
            },
          ],
        },
      ],
    };

    const component = await mount(
      <AreaHierarchyTree
        tree={treeWithMultipleBranches}
        currentAreaPath="areas/root.md"
      />,
    );

    const toggles = component.locator(".area-tree-toggle");
    await expect(toggles).toHaveCount(2);

    // Initially collapsed - expand both
    await toggles.nth(0).click();
    await toggles.nth(1).click();
    await expect(
      component.locator('[data-href="areas/grandchild1.md"]'),
    ).toBeVisible();
    await expect(
      component.locator('[data-href="areas/grandchild2.md"]'),
    ).toBeVisible();

    // Collapse first branch
    await toggles.nth(0).click();
    await expect(
      component.locator('[data-href="areas/grandchild1.md"]'),
    ).not.toBeVisible();
    await expect(
      component.locator('[data-href="areas/grandchild2.md"]'),
    ).toBeVisible();

    // Collapse second branch
    await toggles.nth(1).click();
    await expect(
      component.locator('[data-href="areas/grandchild1.md"]'),
    ).not.toBeVisible();
    await expect(
      component.locator('[data-href="areas/grandchild2.md"]'),
    ).not.toBeVisible();
  });
});
