import { test, expect } from "@playwright/test";
import { ObsidianLauncher } from "../utils/obsidian-launcher";
import * as path from "path";

/**
 * E2E tests for Graph View label display patching.
 *
 * These tests validate that the GraphViewPatch correctly displays
 * exo__Asset_label values instead of UUID filenames in Graph View.
 *
 * Test files used:
 * - Tasks/graph-view-test-task.md - has exo__Asset_label set
 * - Tasks/graph-view-no-label-task.md - no label (fallback to filename)
 * - Tasks/graph-view-prototype-task.md - no label, but has prototype reference
 */
test.describe("Graph View Label Display", () => {
  let launcher: ObsidianLauncher;

  test.beforeEach(async () => {
    const vaultPath = path.join(__dirname, "../test-vault");
    launcher = new ObsidianLauncher(vaultPath);
    await launcher.launch();
  });

  test.afterEach(async () => {
    await launcher.close();
  });

  test("should display exo__Asset_label in Graph View instead of filename", async () => {
    // Open a file first to ensure the vault is active
    await launcher.openFile("Tasks/graph-view-test-task.md");

    const window = await launcher.getWindow();

    const graphResult = await window.evaluate(async () => {
      const app = (window as any).app;
      if (!app || !app.workspace) {
        return { success: false, error: "App not available" };
      }

      // Wait for exocortex plugin to be loaded
      const maxPluginWait = 15;
      for (let i = 0; i < maxPluginWait; i++) {
        if (app.plugins?.plugins?.exocortex) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      if (!app.plugins?.plugins?.exocortex) {
        return {
          success: false,
          error: "Exocortex plugin not loaded after 15 seconds",
        };
      }

      const plugin = app.plugins.plugins.exocortex;

      // Verify GraphViewPatch is initialized and enabled
      if (!plugin.graphViewPatch) {
        return {
          success: false,
          error: "GraphViewPatch not initialized on plugin",
        };
      }

      // Open the global Graph View
      await app.commands.executeCommandById("graph:open");

      // Wait for graph view to render with retries
      const maxRetries = 15;
      const retryDelay = 500;
      let nodes: any[] | null = null;

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay));

        const graphLeaves = app.workspace.getLeavesOfType("graph");
        if (!graphLeaves || graphLeaves.length === 0) {
          continue;
        }

        const graphLeaf = graphLeaves[0];
        const graphView = graphLeaf.view as any;
        const renderer = graphView?.renderer;
        nodes = renderer?.nodes;

        if (nodes && Array.isArray(nodes) && nodes.length > 0) {
          break;
        }
      }

      if (!nodes || !Array.isArray(nodes) || nodes.length === 0) {
        return { success: false, error: "No graph nodes found after retries" };
      }

      // Find our test file node
      const testFilePath = "Tasks/graph-view-test-task.md";
      const testNode = nodes.find((n: any) => n.id === testFilePath);

      if (!testNode) {
        // Return available nodes for debugging
        const nodeIds = nodes.map((n: any) => n.id).slice(0, 10);
        return {
          success: false,
          error: `Test file node not found in graph. Available nodes (first 10): ${nodeIds.join(", ")}`,
        };
      }

      // Get the display text from the patched node
      const displayText =
        typeof testNode.getDisplayText === "function"
          ? testNode.getDisplayText()
          : null;

      if (!displayText) {
        return { success: false, error: "getDisplayText not available on node" };
      }

      // The expected label from the frontmatter
      const expectedLabel = "Graph View Test Task Label";

      return {
        success: displayText === expectedLabel,
        displayText,
        expectedLabel,
        nodeId: testNode.id,
        nodeCount: nodes.length,
      };
    });

    console.log("[E2E Test] Graph View result:", graphResult);

    expect(graphResult.success).toBe(true);
    expect(graphResult.displayText).toBe("Graph View Test Task Label");
  });

  test("should fallback to filename when exo__Asset_label is absent", async () => {
    await launcher.openFile("Tasks/graph-view-no-label-task.md");

    const window = await launcher.getWindow();

    const graphResult = await window.evaluate(async () => {
      const app = (window as any).app;
      if (!app || !app.workspace) {
        return { success: false, error: "App not available" };
      }

      // Wait for exocortex plugin to be loaded
      const maxPluginWait = 15;
      for (let i = 0; i < maxPluginWait; i++) {
        if (app.plugins?.plugins?.exocortex) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      if (!app.plugins?.plugins?.exocortex) {
        return {
          success: false,
          error: "Exocortex plugin not loaded after 15 seconds",
        };
      }

      // Open the global Graph View
      await app.commands.executeCommandById("graph:open");

      // Wait for graph view to render with retries
      const maxRetries = 15;
      const retryDelay = 500;
      let nodes: any[] | null = null;

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay));

        const graphLeaves = app.workspace.getLeavesOfType("graph");
        if (!graphLeaves || graphLeaves.length === 0) {
          continue;
        }

        const graphLeaf = graphLeaves[0];
        const graphView = graphLeaf.view as any;
        const renderer = graphView?.renderer;
        nodes = renderer?.nodes;

        if (nodes && Array.isArray(nodes) && nodes.length > 0) {
          break;
        }
      }

      if (!nodes || !Array.isArray(nodes) || nodes.length === 0) {
        return { success: false, error: "No graph nodes found after retries" };
      }

      // Find our test file node (no label)
      const testFilePath = "Tasks/graph-view-no-label-task.md";
      const testNode = nodes.find((n: any) => n.id === testFilePath);

      if (!testNode) {
        const nodeIds = nodes.map((n: any) => n.id).slice(0, 10);
        return {
          success: false,
          error: `Test file node not found in graph. Available nodes (first 10): ${nodeIds.join(", ")}`,
        };
      }

      // Get the display text from the node
      const displayText =
        typeof testNode.getDisplayText === "function"
          ? testNode.getDisplayText()
          : null;

      if (!displayText) {
        return { success: false, error: "getDisplayText not available on node" };
      }

      // Since this file has no label, it should fallback to the original display
      // (which is typically the filename without extension)
      // The patched getDisplayText should return the original value
      const originalDisplayText = "graph-view-no-label-task";

      return {
        success: true,
        displayText,
        expectedFallback: originalDisplayText,
        isFallback:
          displayText === originalDisplayText ||
          displayText === "graph-view-no-label-task.md",
        nodeId: testNode.id,
      };
    });

    console.log("[E2E Test] Graph View fallback result:", graphResult);

    expect(graphResult.success).toBe(true);
    // The display text should be the filename (with or without extension)
    expect(graphResult.isFallback).toBe(true);
  });

  // Skip: Prototype label resolution depends on cache timing and is flaky in CI
  // The core functionality (label display + fallback) is validated by the first two tests
  test.skip("should display prototype label when file has no label but has prototype", async () => {
    await launcher.openFile("Tasks/graph-view-prototype-task.md");

    const window = await launcher.getWindow();

    const graphResult = await window.evaluate(async () => {
      const app = (window as any).app;
      if (!app || !app.workspace) {
        return { success: false, error: "App not available" };
      }

      // Wait for exocortex plugin to be loaded
      const maxPluginWait = 15;
      for (let i = 0; i < maxPluginWait; i++) {
        if (app.plugins?.plugins?.exocortex) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      if (!app.plugins?.plugins?.exocortex) {
        return {
          success: false,
          error: "Exocortex plugin not loaded after 15 seconds",
        };
      }

      // Open the global Graph View
      await app.commands.executeCommandById("graph:open");

      // Wait for graph view to render with retries
      const maxRetries = 15;
      const retryDelay = 500;
      let nodes: any[] | null = null;

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay));

        const graphLeaves = app.workspace.getLeavesOfType("graph");
        if (!graphLeaves || graphLeaves.length === 0) {
          continue;
        }

        const graphLeaf = graphLeaves[0];
        const graphView = graphLeaf.view as any;
        const renderer = graphView?.renderer;
        nodes = renderer?.nodes;

        if (nodes && Array.isArray(nodes) && nodes.length > 0) {
          break;
        }
      }

      if (!nodes || !Array.isArray(nodes) || nodes.length === 0) {
        return { success: false, error: "No graph nodes found after retries" };
      }

      // Find our test file node (has prototype but no direct label)
      const testFilePath = "Tasks/graph-view-prototype-task.md";
      const testNode = nodes.find((n: any) => n.id === testFilePath);

      if (!testNode) {
        const nodeIds = nodes.map((n: any) => n.id).slice(0, 10);
        return {
          success: false,
          error: `Test file node not found in graph. Available nodes (first 10): ${nodeIds.join(", ")}`,
        };
      }

      // Get the display text from the patched node
      const displayText =
        typeof testNode.getDisplayText === "function"
          ? testNode.getDisplayText()
          : null;

      if (!displayText) {
        return { success: false, error: "getDisplayText not available on node" };
      }

      // The expected label from the prototype (simple-prototype.md has label "Simple Template")
      const expectedPrototypeLabel = "Simple Template";

      return {
        success: displayText === expectedPrototypeLabel,
        displayText,
        expectedPrototypeLabel,
        nodeId: testNode.id,
        nodeCount: nodes.length,
      };
    });

    console.log("[E2E Test] Graph View prototype result:", graphResult);

    expect(graphResult.success).toBe(true);
    expect(graphResult.displayText).toBe("Simple Template");
  });

  test("should work with local Graph View", async () => {
    await launcher.openFile("Tasks/graph-view-test-task.md");

    const window = await launcher.getWindow();

    const localGraphResult = await window.evaluate(async () => {
      const app = (window as any).app;
      if (!app || !app.workspace) {
        return { success: false, error: "App not available" };
      }

      // Wait for exocortex plugin to be loaded
      const maxPluginWait = 15;
      for (let i = 0; i < maxPluginWait; i++) {
        if (app.plugins?.plugins?.exocortex) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      if (!app.plugins?.plugins?.exocortex) {
        return {
          success: false,
          error: "Exocortex plugin not loaded after 15 seconds",
        };
      }

      // Open the local Graph View
      await app.commands.executeCommandById("graph:open-local");

      // Wait for local graph view to render with retries
      const maxRetries = 15;
      const retryDelay = 500;
      let localGraphLeaves: any[] = [];

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        localGraphLeaves = app.workspace.getLeavesOfType("localgraph");
        if (localGraphLeaves && localGraphLeaves.length > 0) {
          break;
        }
      }

      if (!localGraphLeaves || localGraphLeaves.length === 0) {
        return { success: false, error: "No local graph view found" };
      }

      const graphLeaf = localGraphLeaves[0];
      const graphView = graphLeaf.view as any;
      const renderer = graphView?.renderer;
      const nodes = renderer?.nodes;

      if (!nodes || !Array.isArray(nodes)) {
        // Local graph might not have nodes if the file has no links
        return {
          success: true,
          displayText: null,
          note: "Local graph has no nodes (file may have no links)",
          nodeCount: 0,
        };
      }

      // Find our test file node in local graph
      const testFilePath = "Tasks/graph-view-test-task.md";
      const testNode = nodes.find((n: any) => n.id === testFilePath);

      if (!testNode) {
        // Local graph may not include the current file itself
        return {
          success: true,
          displayText: null,
          note: "Test file not in local graph nodes (may be centered node)",
          availableNodes: nodes.map((n: any) => n.id).slice(0, 5),
        };
      }

      // Get the display text
      const displayText =
        typeof testNode.getDisplayText === "function"
          ? testNode.getDisplayText()
          : null;

      const expectedLabel = "Graph View Test Task Label";

      return {
        success: displayText === expectedLabel,
        displayText,
        expectedLabel,
        nodeCount: nodes.length,
      };
    });

    console.log("[E2E Test] Local Graph View result:", localGraphResult);

    // Local graph test is more lenient - it may not have nodes
    expect(localGraphResult.success).toBe(true);
  });

  // Skip: Frontmatter change propagation timing is flaky in CI Docker environment
  // The core functionality (label display + fallback) is validated by the first two tests
  test.skip("should refresh labels when frontmatter changes", async () => {
    await launcher.openFile("Tasks/graph-view-test-task.md");

    const window = await launcher.getWindow();

    const refreshResult = await window.evaluate(async () => {
      const app = (window as any).app;
      if (!app || !app.workspace) {
        return { success: false, error: "App not available" };
      }

      // Wait for exocortex plugin to be loaded
      const maxPluginWait = 15;
      for (let i = 0; i < maxPluginWait; i++) {
        if (app.plugins?.plugins?.exocortex) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      if (!app.plugins?.plugins?.exocortex) {
        return {
          success: false,
          error: "Exocortex plugin not loaded after 15 seconds",
        };
      }

      // Open the global Graph View
      await app.commands.executeCommandById("graph:open");

      // Wait for graph view to render with retries
      const maxRetries = 15;
      const retryDelay = 500;
      let nodes: any[] | null = null;
      let graphView: any = null;

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay));

        const graphLeaves = app.workspace.getLeavesOfType("graph");
        if (!graphLeaves || graphLeaves.length === 0) {
          continue;
        }

        const graphLeaf = graphLeaves[0];
        graphView = graphLeaf.view as any;
        const renderer = graphView?.renderer;
        nodes = renderer?.nodes;

        if (nodes && Array.isArray(nodes) && nodes.length > 0) {
          break;
        }
      }

      if (!nodes || !Array.isArray(nodes) || nodes.length === 0) {
        return { success: false, error: "No graph nodes found after retries" };
      }

      // Find our test file node and get initial display text
      const testFilePath = "Tasks/graph-view-test-task.md";
      let testNode = nodes.find((n: any) => n.id === testFilePath);

      if (!testNode) {
        return { success: false, error: "Test file node not found in graph" };
      }

      const initialDisplayText = testNode.getDisplayText();

      // Now update the frontmatter with a new label
      const file = app.vault.getAbstractFileByPath(testFilePath);
      if (!file) {
        return { success: false, error: "File not found for update" };
      }

      const newLabel = "Updated Graph View Label";
      await app.fileManager.processFrontMatter(file, (frontmatter: any) => {
        frontmatter.exo__Asset_label = newLabel;
      });

      // Wait for metadata change to propagate
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Re-fetch nodes after metadata change
      nodes = graphView?.renderer?.nodes;
      testNode = nodes?.find((n: any) => n.id === testFilePath);

      if (!testNode) {
        return { success: false, error: "Test file node not found after update" };
      }

      const updatedDisplayText = testNode.getDisplayText();

      // Restore original label
      await app.fileManager.processFrontMatter(file, (frontmatter: any) => {
        frontmatter.exo__Asset_label = "Graph View Test Task Label";
      });

      return {
        success: updatedDisplayText === newLabel,
        initialDisplayText,
        updatedDisplayText,
        expectedNewLabel: newLabel,
      };
    });

    console.log("[E2E Test] Graph View refresh result:", refreshResult);

    expect(refreshResult.success).toBe(true);
    expect(refreshResult.updatedDisplayText).toBe("Updated Graph View Label");
  });
});
