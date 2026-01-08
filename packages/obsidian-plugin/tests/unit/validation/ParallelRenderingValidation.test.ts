/**
 * Parallel Rendering Validation Tests
 *
 * Validates that RdfButtonGroupsBuilder produces identical UI output
 * as hardcoded buttons by running both in parallel and comparing.
 *
 * Part of Legacy Code Cleanup Plan - Phase 2, Task 5
 *
 * @see https://github.com/kitelev/exocortex/issues/2006
 * @module tests/unit/validation
 */

import "reflect-metadata";
import { container } from "tsyringe";
import React from "react";
import { render } from "@testing-library/react";
import { RdfButtonGroupsBuilder } from "../../../src/presentation/builders/RdfButtonGroupsBuilder";
import { ActionButtonsGroup, ButtonGroup, ActionButton } from "../../../src/presentation/components/ActionButtonsGroup";
import { RdfButton, RdfButtonDefinition } from "../../../src/presentation/components/RdfButton";
import {
  DI_TOKENS,
  registerCoreServices,
  resetContainer,
} from "exocortex";

/**
 * Helper to create mock SolutionMapping compatible with SPARQLQueryService results.
 */
function createMockSolutionMapping(
  bindings: Record<string, string | undefined>
): { get: (key: string) => { value: string } | undefined } {
  return {
    get: (key: string) => {
      const value = bindings[key];
      if (value === undefined) {
        return undefined;
      }
      return { value };
    },
  };
}

/**
 * Test fixture: Hardcoded button definitions that match the old specialized components.
 * These represent the expected output that RDF buttons should match.
 */
const HARDCODED_BUTTON_GROUPS: ButtonGroup[] = [
  {
    id: "status-group",
    title: "Status",
    buttons: [
      {
        id: "start-effort",
        label: "Start Effort",
        variant: "primary",
        onClick: async () => {},
      },
      {
        id: "mark-done",
        label: "Done",
        variant: "success",
        onClick: async () => {},
      },
      {
        id: "archive",
        label: "Archive",
        variant: "secondary",
        onClick: async () => {},
      },
    ],
  },
  {
    id: "planning-group",
    title: "Planning",
    buttons: [
      {
        id: "plan-today",
        label: "Plan on Today",
        variant: "primary",
        onClick: async () => {},
      },
      {
        id: "shift-forward",
        label: "Shift Day +1",
        variant: "secondary",
        onClick: async () => {},
      },
      {
        id: "shift-backward",
        label: "Shift Day -1",
        variant: "secondary",
        onClick: async () => {},
      },
    ],
  },
  {
    id: "organization-group",
    title: "Organization",
    buttons: [
      {
        id: "move-todo",
        label: "Move to ToDo",
        variant: "secondary",
        onClick: async () => {},
      },
      {
        id: "move-backlog",
        label: "Move to Backlog",
        variant: "secondary",
        onClick: async () => {},
      },
      {
        id: "move-analysis",
        label: "Move to Analysis",
        variant: "secondary",
        onClick: async () => {},
      },
    ],
  },
];

/**
 * RDF triples that define button groups matching the hardcoded buttons.
 * These will be loaded by RdfButtonGroupsBuilder via SPARQL queries.
 */
const MOCK_RDF_BUTTON_GROUPS = [
  createMockSolutionMapping({
    group: "exo-ui:StatusGroup",
    label: "Status",
    order: "1",
  }),
  createMockSolutionMapping({
    group: "exo-ui:PlanningGroup",
    label: "Planning",
    order: "2",
  }),
  createMockSolutionMapping({
    group: "exo-ui:OrganizationGroup",
    label: "Organization",
    order: "3",
  }),
];

const MOCK_RDF_BUTTONS_STATUS = [
  createMockSolutionMapping({
    button: "exo-ui:StartEffortButton",
    label: "Start Effort",
    icon: "play",
    variant: "primary",
    order: "1",
    action: "exo-ui:StartEffortAction",
  }),
  createMockSolutionMapping({
    button: "exo-ui:MarkDoneButton",
    label: "Done",
    icon: "check",
    variant: "success",
    order: "2",
    action: "exo-ui:MarkDoneAction",
  }),
  createMockSolutionMapping({
    button: "exo-ui:ArchiveButton",
    label: "Archive",
    icon: "archive",
    variant: "secondary",
    order: "3",
    action: "exo-ui:ArchiveAction",
  }),
];

const MOCK_RDF_BUTTONS_PLANNING = [
  createMockSolutionMapping({
    button: "exo-ui:PlanTodayButton",
    label: "Plan on Today",
    icon: "calendar",
    variant: "primary",
    order: "1",
    action: "exo-ui:PlanTodayAction",
  }),
  createMockSolutionMapping({
    button: "exo-ui:ShiftForwardButton",
    label: "Shift Day +1",
    icon: "arrow-right",
    variant: "secondary",
    order: "2",
    action: "exo-ui:ShiftForwardAction",
  }),
  createMockSolutionMapping({
    button: "exo-ui:ShiftBackwardButton",
    label: "Shift Day -1",
    icon: "arrow-left",
    variant: "secondary",
    order: "3",
    action: "exo-ui:ShiftBackwardAction",
  }),
];

const MOCK_RDF_BUTTONS_ORGANIZATION = [
  createMockSolutionMapping({
    button: "exo-ui:MoveToDoButton",
    label: "Move to ToDo",
    icon: "list",
    variant: "secondary",
    order: "1",
    action: "exo-ui:MoveToDoAction",
  }),
  createMockSolutionMapping({
    button: "exo-ui:MoveBacklogButton",
    label: "Move to Backlog",
    icon: "inbox",
    variant: "secondary",
    order: "2",
    action: "exo-ui:MoveBacklogAction",
  }),
  createMockSolutionMapping({
    button: "exo-ui:MoveAnalysisButton",
    label: "Move to Analysis",
    icon: "magnifying-glass",
    variant: "secondary",
    order: "3",
    action: "exo-ui:MoveAnalysisAction",
  }),
];

describe("Parallel Rendering Validation: RDF vs Hardcoded Buttons", () => {
  let mockSparqlQueryService: any;
  let mockActionInterpreter: any;
  let mockConditionEvaluator: any;

  beforeEach(() => {
    resetContainer();

    const mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    const mockVault = {
      create: jest.fn().mockResolvedValue({ path: "test-task.md" }),
      read: jest.fn().mockResolvedValue(""),
      modify: jest.fn().mockResolvedValue(undefined),
      getAllFiles: jest.fn().mockReturnValue([]),
      getFrontmatter: jest.fn().mockReturnValue({}),
      exists: jest.fn().mockResolvedValue(true),
      updateFrontmatter: jest.fn().mockResolvedValue(undefined),
    };

    container.register(DI_TOKENS.IVaultAdapter, { useValue: mockVault });
    container.register(DI_TOKENS.ILogger, { useValue: mockLogger });
    registerCoreServices();

    // Mock SPARQL query service to return RDF button definitions
    mockSparqlQueryService = {
      initialize: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockImplementation((query: string) => {
        // Return button groups
        if (query.includes("SELECT ?group")) {
          return Promise.resolve(MOCK_RDF_BUTTON_GROUPS);
        }

        // Return buttons for specific group
        if (query.includes("exo-ui:StatusGroup")) {
          return Promise.resolve(MOCK_RDF_BUTTONS_STATUS);
        }
        if (query.includes("exo-ui:PlanningGroup")) {
          return Promise.resolve(MOCK_RDF_BUTTONS_PLANNING);
        }
        if (query.includes("exo-ui:OrganizationGroup")) {
          return Promise.resolve(MOCK_RDF_BUTTONS_ORGANIZATION);
        }

        return Promise.resolve([]);
      }),
      refresh: jest.fn().mockResolvedValue(undefined),
      dispose: jest.fn(),
    };

    // Mock action interpreter (no-op for validation tests)
    mockActionInterpreter = {
      execute: jest.fn().mockResolvedValue({ success: true }),
    };

    // Mock condition evaluator (always true - all buttons visible)
    mockConditionEvaluator = {
      evaluate: jest.fn().mockResolvedValue(true),
    };
  });

  afterEach(() => {
    resetContainer();
  });

  describe("Button Group Structure Validation", () => {
    it("should produce the same number of button groups", async () => {
      const builder = new RdfButtonGroupsBuilder(
        mockSparqlQueryService,
        mockActionInterpreter,
        mockConditionEvaluator
      );

      const rdfGroups = await builder.buildButtonGroups("test:asset1");

      expect(rdfGroups.length).toBe(HARDCODED_BUTTON_GROUPS.length);
    });

    it("should produce groups with matching titles", async () => {
      const builder = new RdfButtonGroupsBuilder(
        mockSparqlQueryService,
        mockActionInterpreter,
        mockConditionEvaluator
      );

      const rdfGroups = await builder.buildButtonGroups("test:asset1");

      const rdfTitles = rdfGroups.map((g) => g.title).sort();
      const hardcodedTitles = HARDCODED_BUTTON_GROUPS.map((g) => g.title).sort();

      expect(rdfTitles).toEqual(hardcodedTitles);
    });

    it("should produce the same number of buttons per group", async () => {
      const builder = new RdfButtonGroupsBuilder(
        mockSparqlQueryService,
        mockActionInterpreter,
        mockConditionEvaluator
      );

      const rdfGroups = await builder.buildButtonGroups("test:asset1");

      // Sort groups by title for consistent comparison
      const sortedRdf = [...rdfGroups].sort((a, b) => a.title.localeCompare(b.title));
      const sortedHardcoded = [...HARDCODED_BUTTON_GROUPS].sort((a, b) => a.title.localeCompare(b.title));

      for (let i = 0; i < sortedRdf.length; i++) {
        expect(sortedRdf[i].buttons.length).toBe(sortedHardcoded[i].buttons.length);
      }
    });
  });

  describe("Button Property Validation", () => {
    it("should produce buttons with matching labels", async () => {
      const builder = new RdfButtonGroupsBuilder(
        mockSparqlQueryService,
        mockActionInterpreter,
        mockConditionEvaluator
      );

      const rdfGroups = await builder.buildButtonGroups("test:asset1");

      // Collect all button labels from RDF groups
      const rdfLabels = rdfGroups
        .flatMap((g) => g.buttons)
        .map((b) => b.label)
        .sort();

      // Collect all button labels from hardcoded groups
      const hardcodedLabels = HARDCODED_BUTTON_GROUPS
        .flatMap((g) => g.buttons)
        .map((b) => b.label)
        .sort();

      expect(rdfLabels).toEqual(hardcodedLabels);
    });

    it("should produce buttons with matching variants", async () => {
      const builder = new RdfButtonGroupsBuilder(
        mockSparqlQueryService,
        mockActionInterpreter,
        mockConditionEvaluator
      );

      const rdfGroups = await builder.buildButtonGroups("test:asset1");

      // For each hardcoded button, find matching RDF button and compare variant
      for (const hardcodedGroup of HARDCODED_BUTTON_GROUPS) {
        const rdfGroup = rdfGroups.find((g) => g.title === hardcodedGroup.title);
        expect(rdfGroup).toBeDefined();

        for (const hardcodedButton of hardcodedGroup.buttons) {
          const rdfButton = rdfGroup!.buttons.find((b) => b.label === hardcodedButton.label);
          expect(rdfButton).toBeDefined();
          expect(rdfButton!.variant).toBe(hardcodedButton.variant);
        }
      }
    });
  });

  describe("DOM Output Comparison", () => {
    it("should render identical container structure", async () => {
      const builder = new RdfButtonGroupsBuilder(
        mockSparqlQueryService,
        mockActionInterpreter,
        mockConditionEvaluator
      );

      const rdfGroups = await builder.buildButtonGroups("test:asset1");

      // Render RDF-driven buttons
      const { container: rdfContainer } = render(
        React.createElement(ActionButtonsGroup, { groups: rdfGroups })
      );

      // Render hardcoded buttons
      const { container: hardcodedContainer } = render(
        React.createElement(ActionButtonsGroup, { groups: HARDCODED_BUTTON_GROUPS })
      );

      // Compare container class
      const rdfRoot = rdfContainer.querySelector(".exocortex-action-buttons-container");
      const hardcodedRoot = hardcodedContainer.querySelector(".exocortex-action-buttons-container");

      expect(rdfRoot).toBeDefined();
      expect(hardcodedRoot).toBeDefined();

      // Compare number of button groups rendered
      const rdfGroupElements = rdfContainer.querySelectorAll(".exocortex-button-group");
      const hardcodedGroupElements = hardcodedContainer.querySelectorAll(".exocortex-button-group");

      expect(rdfGroupElements.length).toBe(hardcodedGroupElements.length);
    });

    it("should render identical button elements", async () => {
      const builder = new RdfButtonGroupsBuilder(
        mockSparqlQueryService,
        mockActionInterpreter,
        mockConditionEvaluator
      );

      const rdfGroups = await builder.buildButtonGroups("test:asset1");

      // Render RDF-driven buttons
      const { container: rdfContainer } = render(
        React.createElement(ActionButtonsGroup, { groups: rdfGroups })
      );

      // Render hardcoded buttons
      const { container: hardcodedContainer } = render(
        React.createElement(ActionButtonsGroup, { groups: HARDCODED_BUTTON_GROUPS })
      );

      // Compare total number of buttons
      const rdfButtons = rdfContainer.querySelectorAll(".exocortex-action-button");
      const hardcodedButtons = hardcodedContainer.querySelectorAll(".exocortex-action-button");

      expect(rdfButtons.length).toBe(hardcodedButtons.length);

      // Compare button text content
      const rdfButtonTexts = Array.from(rdfButtons).map((b) => b.textContent).sort();
      const hardcodedButtonTexts = Array.from(hardcodedButtons).map((b) => b.textContent).sort();

      expect(rdfButtonTexts).toEqual(hardcodedButtonTexts);
    });

    it("should render identical button variant classes", async () => {
      const builder = new RdfButtonGroupsBuilder(
        mockSparqlQueryService,
        mockActionInterpreter,
        mockConditionEvaluator
      );

      const rdfGroups = await builder.buildButtonGroups("test:asset1");

      // Render RDF-driven buttons
      const { container: rdfContainer } = render(
        React.createElement(ActionButtonsGroup, { groups: rdfGroups })
      );

      // Render hardcoded buttons
      const { container: hardcodedContainer } = render(
        React.createElement(ActionButtonsGroup, { groups: HARDCODED_BUTTON_GROUPS })
      );

      // Compare button classes by collecting all variant classes
      const rdfButtonClasses = Array.from(rdfContainer.querySelectorAll(".exocortex-action-button"))
        .map((b) => {
          const classes = Array.from(b.classList);
          return classes.find((c) => c.startsWith("exocortex-action-button--"));
        })
        .filter(Boolean)
        .sort();

      const hardcodedButtonClasses = Array.from(hardcodedContainer.querySelectorAll(".exocortex-action-button"))
        .map((b) => {
          const classes = Array.from(b.classList);
          return classes.find((c) => c.startsWith("exocortex-action-button--"));
        })
        .filter(Boolean)
        .sort();

      expect(rdfButtonClasses).toEqual(hardcodedButtonClasses);
    });

    it("should render group titles in identical order", async () => {
      const builder = new RdfButtonGroupsBuilder(
        mockSparqlQueryService,
        mockActionInterpreter,
        mockConditionEvaluator
      );

      const rdfGroups = await builder.buildButtonGroups("test:asset1");

      // Render RDF-driven buttons
      const { container: rdfContainer } = render(
        React.createElement(ActionButtonsGroup, { groups: rdfGroups })
      );

      // Render hardcoded buttons
      const { container: hardcodedContainer } = render(
        React.createElement(ActionButtonsGroup, { groups: HARDCODED_BUTTON_GROUPS })
      );

      // Compare group titles in order
      const rdfTitles = Array.from(rdfContainer.querySelectorAll(".exocortex-button-group-title"))
        .map((t) => t.textContent);

      const hardcodedTitles = Array.from(hardcodedContainer.querySelectorAll(".exocortex-button-group-title"))
        .map((t) => t.textContent);

      expect(rdfTitles).toEqual(hardcodedTitles);
    });
  });

  describe("Button Visibility with Conditions", () => {
    it("should hide buttons when condition evaluates to false", async () => {
      // Configure condition evaluator to hide some buttons
      mockConditionEvaluator.evaluate = jest.fn()
        .mockImplementation((conditionUri: string) => {
          // Hide "Archive" button by failing its condition
          if (conditionUri.includes("Archive")) {
            return Promise.resolve(false);
          }
          return Promise.resolve(true);
        });

      // Need to set up mock query service to return conditions
      mockSparqlQueryService.query = jest.fn().mockImplementation((query: string) => {
        if (query.includes("SELECT ?group")) {
          return Promise.resolve(MOCK_RDF_BUTTON_GROUPS);
        }

        if (query.includes("exo-ui:StatusGroup")) {
          // Add condition to Archive button
          return Promise.resolve([
            createMockSolutionMapping({
              button: "exo-ui:StartEffortButton",
              label: "Start Effort",
              variant: "primary",
              order: "1",
              action: "exo-ui:StartEffortAction",
            }),
            createMockSolutionMapping({
              button: "exo-ui:MarkDoneButton",
              label: "Done",
              variant: "success",
              order: "2",
              action: "exo-ui:MarkDoneAction",
            }),
            createMockSolutionMapping({
              button: "exo-ui:ArchiveButton",
              label: "Archive",
              variant: "secondary",
              order: "3",
              action: "exo-ui:ArchiveAction",
              condition: "exo-ui:ArchiveCondition", // This will be evaluated to false
            }),
          ]);
        }
        if (query.includes("exo-ui:PlanningGroup")) {
          return Promise.resolve(MOCK_RDF_BUTTONS_PLANNING);
        }
        if (query.includes("exo-ui:OrganizationGroup")) {
          return Promise.resolve(MOCK_RDF_BUTTONS_ORGANIZATION);
        }

        return Promise.resolve([]);
      });

      const builder = new RdfButtonGroupsBuilder(
        mockSparqlQueryService,
        mockActionInterpreter,
        mockConditionEvaluator
      );

      const rdfGroups = await builder.buildButtonGroups("test:asset1");

      // Status group should have 2 buttons (Archive hidden by condition)
      const statusGroup = rdfGroups.find((g) => g.title === "Status");
      expect(statusGroup?.buttons.length).toBe(2);
      expect(statusGroup?.buttons.map((b) => b.label)).not.toContain("Archive");
    });
  });

  describe("Error Handling", () => {
    it("should return empty groups when SPARQL query fails", async () => {
      mockSparqlQueryService.query = jest.fn().mockRejectedValue(new Error("SPARQL error"));

      const builder = new RdfButtonGroupsBuilder(
        mockSparqlQueryService,
        mockActionInterpreter,
        mockConditionEvaluator
      );

      const rdfGroups = await builder.buildButtonGroups("test:asset1");

      expect(rdfGroups).toEqual([]);
    });

    it("should skip button when condition evaluation fails", async () => {
      mockConditionEvaluator.evaluate = jest.fn().mockRejectedValue(new Error("Condition error"));

      mockSparqlQueryService.query = jest.fn().mockImplementation((query: string) => {
        if (query.includes("SELECT ?group")) {
          return Promise.resolve([
            createMockSolutionMapping({
              group: "exo-ui:StatusGroup",
              label: "Status",
              order: "1",
            }),
          ]);
        }

        if (query.includes("exo-ui:StatusGroup")) {
          return Promise.resolve([
            createMockSolutionMapping({
              button: "exo-ui:StartEffortButton",
              label: "Start Effort",
              variant: "primary",
              order: "1",
              action: "exo-ui:StartEffortAction",
              condition: "exo-ui:StartCondition", // Will fail evaluation
            }),
          ]);
        }

        return Promise.resolve([]);
      });

      const builder = new RdfButtonGroupsBuilder(
        mockSparqlQueryService,
        mockActionInterpreter,
        mockConditionEvaluator
      );

      const rdfGroups = await builder.buildButtonGroups("test:asset1");

      // Status group should have 0 buttons (button skipped due to condition error)
      expect(rdfGroups.length).toBe(0); // Empty because all buttons in group were skipped
    });
  });

  describe("RdfButton Component Rendering", () => {
    it("should render RdfButton with correct props from RDF definition", () => {
      const definition: RdfButtonDefinition = {
        uri: "exo-ui:StartEffortButton",
        label: "Start Effort",
        icon: "play",
        variant: "primary",
        tooltip: "Start working on this task",
        action: "exo-ui:StartEffortAction",
      };

      const onClick = jest.fn();

      const { container } = render(
        React.createElement(RdfButton, { definition, onClick })
      );

      const button = container.querySelector("button");
      expect(button).toBeDefined();
      expect(button?.textContent).toContain("Start Effort");
      expect(button?.classList.contains("exocortex-rdf-button--primary")).toBe(true);
      expect(button?.title).toBe("Start working on this task");
    });

    it("should render RdfButton with icon when specified", () => {
      const definition: RdfButtonDefinition = {
        uri: "exo-ui:TestButton",
        label: "Test",
        icon: "check",
        action: "exo-ui:TestAction",
      };

      const { container } = render(
        React.createElement(RdfButton, { definition, onClick: jest.fn() })
      );

      const icon = container.querySelector(".exocortex-rdf-button-icon");
      expect(icon).toBeDefined();
      expect(icon?.textContent).toBe("check");
    });

    it("should trigger onClick with definition when clicked", async () => {
      const definition: RdfButtonDefinition = {
        uri: "exo-ui:StartEffortButton",
        label: "Start Effort",
        action: "exo-ui:StartEffortAction",
      };

      const onClick = jest.fn();

      const { container } = render(
        React.createElement(RdfButton, { definition, onClick })
      );

      const button = container.querySelector("button");
      button?.click();

      expect(onClick).toHaveBeenCalledWith(definition);
    });
  });
});
