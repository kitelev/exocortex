/**
 * RdfButtonGroupsBuilder Unit Tests
 *
 * Tests for RDF-driven button groups loading with condition filtering.
 *
 * @see https://github.com/kitelev/exocortex/issues/1417
 */

import "reflect-metadata";
import {
  RdfButtonGroupsBuilder,
  ActionInterpreter,
  ConditionEvaluator,
} from "../../../src/presentation/builders/RdfButtonGroupsBuilder";
import { SPARQLQueryService } from "../../../src/application/services/SPARQLQueryService";
import { App } from "obsidian";

/**
 * Helper to create a mock SolutionMapping that behaves like the real class.
 * The real SolutionMapping uses .get(variableName) to retrieve values.
 */
function createMockSolutionMapping(bindings: Record<string, string | undefined>): { get: (key: string) => { value: string } | undefined } {
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

// Mock SPARQLQueryService
jest.mock("../../../src/application/services/SPARQLQueryService", () => ({
  SPARQLQueryService: jest.fn().mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockResolvedValue([]),
    refresh: jest.fn().mockResolvedValue(undefined),
    dispose: jest.fn(),
    getTripleStore: jest.fn(),
  })),
}));

// Mock LoggerFactory - use arrow function without jest.fn() to survive clearAllMocks
jest.mock("../../../src/adapters/logging/LoggerFactory", () => ({
  LoggerFactory: {
    create: () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

describe("RdfButtonGroupsBuilder", () => {
  let mockApp: App;
  let mockSparqlService: jest.Mocked<SPARQLQueryService>;
  let mockActionInterpreter: jest.Mocked<ActionInterpreter>;
  let mockConditionEvaluator: jest.Mocked<ConditionEvaluator>;
  let builder: RdfButtonGroupsBuilder;

  beforeEach(() => {
    jest.clearAllMocks();

    mockApp = {
      vault: {
        getMarkdownFiles: jest.fn().mockReturnValue([]),
        getName: jest.fn().mockReturnValue("Test Vault"),
      },
      metadataCache: {
        getFileCache: jest.fn(),
      },
      workspace: {
        getActiveFile: jest.fn(),
      },
    } as unknown as App;

    mockSparqlService = new SPARQLQueryService(
      mockApp,
    ) as jest.Mocked<SPARQLQueryService>;
    mockSparqlService.query = jest.fn().mockResolvedValue([]);
    mockSparqlService.initialize = jest.fn().mockResolvedValue(undefined);

    mockActionInterpreter = {
      execute: jest.fn().mockResolvedValue({ success: true }),
    } as unknown as jest.Mocked<ActionInterpreter>;

    mockConditionEvaluator = {
      evaluate: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<ConditionEvaluator>;

    builder = new RdfButtonGroupsBuilder(
      mockSparqlService,
      mockActionInterpreter,
      mockConditionEvaluator,
    );
  });

  describe("constructor", () => {
    it("should create instance with sparql service, action interpreter, and condition evaluator", () => {
      expect(builder).toBeInstanceOf(RdfButtonGroupsBuilder);
    });
  });

  describe("buildButtonGroups", () => {
    it("should return empty array when no button groups in RDF", async () => {
      mockSparqlService.query.mockResolvedValue([]);

      const groups = await builder.buildButtonGroups("test:asset1");

      expect(groups).toEqual([]);
    });

    it("should load button groups from RDF", async () => {
      // First query: button groups
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "test:StatusGroup",
            label: "Status",
            order: "1",
          }),
        ])
        // Second query: buttons for StatusGroup
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "test:StartButton",
            label: "Start",
            icon: "play",
            variant: "primary",
            order: "1",
            action: "test:StartAction",
          }),
        ]);

      const groups = await builder.buildButtonGroups("test:asset1");

      expect(groups).toHaveLength(1);
      expect(groups[0].id).toBe("test:StatusGroup");
      expect(groups[0].title).toBe("Status");
    });

    it("should filter buttons by condition", async () => {
      // First query: button groups
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "test:StatusGroup",
            label: "Status",
            order: "1",
          }),
        ])
        // Second query: buttons with conditions
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "test:StartButton",
            label: "Start",
            action: "test:StartAction",
            condition: "test:IsToDoCondition",
          }),
          createMockSolutionMapping({
            button: "test:DoneButton",
            label: "Done",
            action: "test:DoneAction",
            condition: "test:IsDoingCondition",
          }),
        ]);

      // First button condition: true, second: false
      mockConditionEvaluator.evaluate
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      const groups = await builder.buildButtonGroups("test:asset1");

      expect(groups).toHaveLength(1);
      expect(groups[0].buttons).toHaveLength(1);
      expect(groups[0].buttons[0].label).toBe("Start");
    });

    it("should include buttons without condition (always visible)", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "test:MaintenanceGroup",
            label: "Maintenance",
            order: "1",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "test:CleanupButton",
            label: "Cleanup",
            action: "test:CleanupAction",
            // No condition - always visible
          }),
        ]);

      const groups = await builder.buildButtonGroups("test:asset1");

      expect(groups).toHaveLength(1);
      expect(groups[0].buttons).toHaveLength(1);
      expect(groups[0].buttons[0].label).toBe("Cleanup");
    });

    it("should exclude empty groups (all buttons filtered)", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "test:StatusGroup",
            label: "Status",
            order: "1",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "test:StartButton",
            label: "Start",
            action: "test:StartAction",
            condition: "test:NeverTrueCondition",
          }),
        ]);

      // All conditions false
      mockConditionEvaluator.evaluate.mockResolvedValue(false);

      const groups = await builder.buildButtonGroups("test:asset1");

      expect(groups).toHaveLength(0);
    });

    it("should preserve button order from RDF", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "test:StatusGroup",
            label: "Status",
            order: "1",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "test:Button3",
            label: "Third",
            action: "test:Action3",
            order: "3",
          }),
          createMockSolutionMapping({
            button: "test:Button1",
            label: "First",
            action: "test:Action1",
            order: "1",
          }),
          createMockSolutionMapping({
            button: "test:Button2",
            label: "Second",
            action: "test:Action2",
            order: "2",
          }),
        ]);

      const groups = await builder.buildButtonGroups("test:asset1");

      // Buttons should be sorted by order from SPARQL ORDER BY
      expect(groups[0].buttons[0].label).toBe("Third");
      expect(groups[0].buttons[1].label).toBe("First");
      expect(groups[0].buttons[2].label).toBe("Second");
    });
  });

  describe("onClick executes ActionInterpreter", () => {
    it("should execute action through ActionInterpreter when button clicked", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "test:StatusGroup",
            label: "Status",
            order: "1",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "test:StartButton",
            label: "Start",
            action: "test:StartAction",
          }),
        ]);

      const groups = await builder.buildButtonGroups("test:asset1");
      const startButton = groups[0].buttons[0];

      // Click the button
      await startButton.onClick();

      expect(mockActionInterpreter.execute).toHaveBeenCalledWith(
        "test:StartAction",
        { currentAsset: "test:asset1" },
      );
    });

    it("should pass currentAsset context to ActionInterpreter", async () => {
      const assetUri = "https://exocortex.my/vault/my-task.md";

      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "test:StatusGroup",
            label: "Status",
            order: "1",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "test:DoneButton",
            label: "Done",
            action: "test:MarkDoneAction",
          }),
        ]);

      const groups = await builder.buildButtonGroups(assetUri);
      await groups[0].buttons[0].onClick();

      expect(mockActionInterpreter.execute).toHaveBeenCalledWith(
        "test:MarkDoneAction",
        { currentAsset: assetUri },
      );
    });
  });

  describe("button properties", () => {
    it("should parse button variant from RDF", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "test:StatusGroup",
            label: "Status",
            order: "1",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "test:DangerButton",
            label: "Delete",
            action: "test:DeleteAction",
            variant: "danger",
          }),
        ]);

      const groups = await builder.buildButtonGroups("test:asset1");

      expect(groups[0].buttons[0].variant).toBe("danger");
    });

    it("should default variant to secondary when not specified", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "test:StatusGroup",
            label: "Status",
            order: "1",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "test:Button",
            label: "Action",
            action: "test:Action",
            // No variant
          }),
        ]);

      const groups = await builder.buildButtonGroups("test:asset1");

      expect(groups[0].buttons[0].variant).toBe("secondary");
    });

    it("should parse icon from RDF", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "test:StatusGroup",
            label: "Status",
            order: "1",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "test:PlayButton",
            label: "Play",
            action: "test:PlayAction",
            icon: "play-circle",
          }),
        ]);

      const groups = await builder.buildButtonGroups("test:asset1");

      expect(groups[0].buttons[0].icon).toBe("play-circle");
    });

    it("should parse tooltip from RDF", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "test:StatusGroup",
            label: "Status",
            order: "1",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "test:HelpButton",
            label: "Help",
            action: "test:HelpAction",
            tooltip: "Click for help",
          }),
        ]);

      const groups = await builder.buildButtonGroups("test:asset1");

      expect(groups[0].buttons[0].tooltip).toBe("Click for help");
    });
  });

  describe("multiple button groups", () => {
    it("should load multiple button groups", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "test:StatusGroup",
            label: "Status",
            order: "1",
          }),
          createMockSolutionMapping({
            group: "test:PlanningGroup",
            label: "Planning",
            order: "2",
          }),
        ])
        // Buttons for StatusGroup
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "test:StartButton",
            label: "Start",
            action: "test:StartAction",
          }),
        ])
        // Buttons for PlanningGroup
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "test:PlanButton",
            label: "Plan Today",
            action: "test:PlanAction",
          }),
        ]);

      const groups = await builder.buildButtonGroups("test:asset1");

      expect(groups).toHaveLength(2);
      expect(groups[0].title).toBe("Status");
      expect(groups[1].title).toBe("Planning");
    });

    it("should preserve group order from RDF", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "test:ThirdGroup",
            label: "Third",
            order: "3",
          }),
          createMockSolutionMapping({
            group: "test:FirstGroup",
            label: "First",
            order: "1",
          }),
          createMockSolutionMapping({
            group: "test:SecondGroup",
            label: "Second",
            order: "2",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "test:B1",
            label: "B1",
            action: "test:A1",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "test:B2",
            label: "B2",
            action: "test:A2",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "test:B3",
            label: "B3",
            action: "test:A3",
          }),
        ]);

      const groups = await builder.buildButtonGroups("test:asset1");

      // Groups should be in order from SPARQL ORDER BY
      expect(groups[0].title).toBe("Third");
      expect(groups[1].title).toBe("First");
      expect(groups[2].title).toBe("Second");
    });
  });

  describe("error handling", () => {
    it("should handle SPARQL query errors gracefully", async () => {
      mockSparqlService.query.mockRejectedValue(new Error("SPARQL error"));

      const groups = await builder.buildButtonGroups("test:asset1");

      expect(groups).toEqual([]);
    });

    it("should handle condition evaluation errors gracefully", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "test:StatusGroup",
            label: "Status",
            order: "1",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "test:Button",
            label: "Action",
            action: "test:Action",
            condition: "test:BadCondition",
          }),
        ]);

      mockConditionEvaluator.evaluate.mockRejectedValue(
        new Error("Condition error"),
      );

      const groups = await builder.buildButtonGroups("test:asset1");

      // Button with failed condition should be excluded
      expect(groups).toHaveLength(0);
    });
  });

  /**
   * DoneButton with CompositeAction Tests (Issue #1419)
   *
   * Tests for DoneButton which uses CompositeAction to execute
   * multiple sub-actions (SetStatusDoneAction + SetEndTimestampAction).
   *
   * RDF Definition:
   * ```turtle
   * ems-ui:DoneButton a exo-ui:Button ;
   *     rdfs:label "Done" ;
   *     exo-ui:Button_icon "check" ;
   *     exo-ui:Button_variant "success" ;
   *     exo-ui:Button_group exo-ui:StatusButtonGroup ;
   *     exo-ui:Button_order 20 ;
   *     exo-ui:Button_tooltip "Mark as completed" ;
   *     exo-ui:Button_action ems-ui:DoneAction ;
   *     exo-ui:Button_condition ems-ui:IsDoingCondition .
   *
   * ems-ui:DoneAction a exo-ui:CompositeAction ;
   *     exo-ui:Action_actions (ems-ui:SetStatusDoneAction ems-ui:SetEndTimestampAction) ;
   *     exo-ui:Action_headless true .
   * ```
   *
   * @see https://github.com/kitelev/exocortex/issues/1419
   */
  describe("DoneButton with CompositeAction (Issue #1419)", () => {
    it("should load DoneButton with success variant and check icon from RDF", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#StatusButtonGroup",
            label: "Status",
            order: "1",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#DoneButton",
            label: "Done",
            icon: "check",
            variant: "success",
            order: "20",
            action: "https://exocortex.my/ontology/ems-ui#DoneAction",
            condition: "https://exocortex.my/ontology/ems-ui#IsDoingCondition",
            tooltip: "Mark as completed",
          }),
        ]);

      // Condition passes (asset is in "Doing" status)
      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      const groups = await builder.buildButtonGroups("test:effort-doing-task");

      expect(groups).toHaveLength(1);
      expect(groups[0].buttons).toHaveLength(1);

      const doneButton = groups[0].buttons[0];
      expect(doneButton.label).toBe("Done");
      expect(doneButton.icon).toBe("check");
      expect(doneButton.variant).toBe("success");
      expect(doneButton.tooltip).toBe("Mark as completed");
    });

    it("should hide DoneButton when IsDoingCondition is false", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#StatusButtonGroup",
            label: "Status",
            order: "1",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#DoneButton",
            label: "Done",
            icon: "check",
            variant: "success",
            action: "https://exocortex.my/ontology/ems-ui#DoneAction",
            condition: "https://exocortex.my/ontology/ems-ui#IsDoingCondition",
          }),
        ]);

      // Condition fails (asset is NOT in "Doing" status)
      mockConditionEvaluator.evaluate.mockResolvedValue(false);

      const groups = await builder.buildButtonGroups("test:todo-task");

      // Group should be empty because DoneButton is filtered out
      expect(groups).toHaveLength(0);
    });

    it("should execute DoneAction (CompositeAction) through ActionInterpreter when clicked", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#StatusButtonGroup",
            label: "Status",
            order: "1",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#DoneButton",
            label: "Done",
            action: "https://exocortex.my/ontology/ems-ui#DoneAction",
            condition: "https://exocortex.my/ontology/ems-ui#IsDoingCondition",
          }),
        ]);

      mockConditionEvaluator.evaluate.mockResolvedValue(true);
      mockActionInterpreter.execute.mockResolvedValue({
        success: true,
        refresh: true,
      });

      const assetUri = "https://exocortex.my/vault/doing-task.md";
      const groups = await builder.buildButtonGroups(assetUri);
      const doneButton = groups[0].buttons[0];

      // Click the DoneButton
      await doneButton.onClick();

      // ActionInterpreter should be called with DoneAction URI
      expect(mockActionInterpreter.execute).toHaveBeenCalledWith(
        "https://exocortex.my/ontology/ems-ui#DoneAction",
        { currentAsset: assetUri },
      );
    });

    it("should evaluate IsDoingCondition with correct asset URI", async () => {
      const assetUri = "https://exocortex.my/vault/my-effort.md";

      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#StatusButtonGroup",
            label: "Status",
            order: "1",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#DoneButton",
            label: "Done",
            action: "https://exocortex.my/ontology/ems-ui#DoneAction",
            condition: "https://exocortex.my/ontology/ems-ui#IsDoingCondition",
          }),
        ]);

      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      await builder.buildButtonGroups(assetUri);

      // ConditionEvaluator should be called with IsDoingCondition and asset URI
      expect(mockConditionEvaluator.evaluate).toHaveBeenCalledWith(
        "https://exocortex.my/ontology/ems-ui#IsDoingCondition",
        assetUri,
      );
    });

    it("should show both StartButton and DoneButton when their conditions match different assets", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#StatusButtonGroup",
            label: "Status",
            order: "1",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#StartButton",
            label: "Start",
            icon: "play",
            variant: "primary",
            order: "10",
            action: "https://exocortex.my/ontology/ems-ui#StartAction",
            condition: "https://exocortex.my/ontology/ems-ui#IsToDoCondition",
          }),
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#DoneButton",
            label: "Done",
            icon: "check",
            variant: "success",
            order: "20",
            action: "https://exocortex.my/ontology/ems-ui#DoneAction",
            condition: "https://exocortex.my/ontology/ems-ui#IsDoingCondition",
          }),
        ]);

      // For this test: IsToDoCondition = true (asset is ToDo), IsDoingCondition = false
      mockConditionEvaluator.evaluate
        .mockResolvedValueOnce(true)  // IsToDoCondition passes
        .mockResolvedValueOnce(false); // IsDoingCondition fails

      const groups = await builder.buildButtonGroups("test:todo-task");

      expect(groups).toHaveLength(1);
      expect(groups[0].buttons).toHaveLength(1);
      expect(groups[0].buttons[0].label).toBe("Start");
    });
  });

  /**
   * PauseButton with UpdatePropertyAction Tests (Issue #1420)
   *
   * Tests for PauseButton which transitions an effort from Doing → ToDo.
   * Uses UpdatePropertyAction to set ems:Effort_status to ems:EffortStatusToDo.
   *
   * RDF Definition:
   * ```turtle
   * ems-ui:PauseButton a exo-ui:Button ;
   *     rdfs:label "Pause" ;
   *     exo-ui:Button_icon "pause" ;
   *     exo-ui:Button_variant "warning" ;
   *     exo-ui:Button_group exo-ui:StatusButtonGroup ;
   *     exo-ui:Button_order 15 ;
   *     exo-ui:Button_action ems-ui:PauseAction ;
   *     exo-ui:Button_condition ems-ui:IsDoingCondition .
   *
   * ems-ui:PauseAction a exo-ui:UpdatePropertyAction ;
   *     exo-ui:Action_targetProperty ems:Effort_status ;
   *     exo-ui:Action_targetValue ems:EffortStatusToDo ;
   *     exo-ui:Action_headless true .
   * ```
   *
   * @see https://github.com/kitelev/exocortex/issues/1420
   */
  describe("PauseButton with UpdatePropertyAction (Issue #1420)", () => {
    it("should load PauseButton with warning variant and pause icon from RDF", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#StatusButtonGroup",
            label: "Status",
            order: "1",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#PauseButton",
            label: "Pause",
            icon: "pause",
            variant: "warning",
            order: "15",
            action: "https://exocortex.my/ontology/ems-ui#PauseAction",
            condition: "https://exocortex.my/ontology/ems-ui#IsDoingCondition",
          }),
        ]);

      // Condition passes (asset is in "Doing" status)
      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      const groups = await builder.buildButtonGroups("test:effort-doing-task");

      expect(groups).toHaveLength(1);
      expect(groups[0].buttons).toHaveLength(1);

      const pauseButton = groups[0].buttons[0];
      expect(pauseButton.label).toBe("Pause");
      expect(pauseButton.icon).toBe("pause");
      expect(pauseButton.variant).toBe("warning");
    });

    it("should hide PauseButton when IsDoingCondition is false", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#StatusButtonGroup",
            label: "Status",
            order: "1",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#PauseButton",
            label: "Pause",
            icon: "pause",
            variant: "warning",
            action: "https://exocortex.my/ontology/ems-ui#PauseAction",
            condition: "https://exocortex.my/ontology/ems-ui#IsDoingCondition",
          }),
        ]);

      // Condition fails (asset is NOT in "Doing" status)
      mockConditionEvaluator.evaluate.mockResolvedValue(false);

      const groups = await builder.buildButtonGroups("test:todo-task");

      // Group should be empty because PauseButton is filtered out
      expect(groups).toHaveLength(0);
    });

    it("should execute PauseAction through ActionInterpreter when clicked", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#StatusButtonGroup",
            label: "Status",
            order: "1",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#PauseButton",
            label: "Pause",
            action: "https://exocortex.my/ontology/ems-ui#PauseAction",
            condition: "https://exocortex.my/ontology/ems-ui#IsDoingCondition",
          }),
        ]);

      mockConditionEvaluator.evaluate.mockResolvedValue(true);
      mockActionInterpreter.execute.mockResolvedValue({
        success: true,
        refresh: true,
      });

      const assetUri = "https://exocortex.my/vault/doing-task.md";
      const groups = await builder.buildButtonGroups(assetUri);
      const pauseButton = groups[0].buttons[0];

      // Click the PauseButton
      await pauseButton.onClick();

      // ActionInterpreter should be called with PauseAction URI
      expect(mockActionInterpreter.execute).toHaveBeenCalledWith(
        "https://exocortex.my/ontology/ems-ui#PauseAction",
        { currentAsset: assetUri },
      );
    });

    it("should evaluate IsDoingCondition with correct asset URI", async () => {
      const assetUri = "https://exocortex.my/vault/my-effort.md";

      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#StatusButtonGroup",
            label: "Status",
            order: "1",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#PauseButton",
            label: "Pause",
            action: "https://exocortex.my/ontology/ems-ui#PauseAction",
            condition: "https://exocortex.my/ontology/ems-ui#IsDoingCondition",
          }),
        ]);

      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      await builder.buildButtonGroups(assetUri);

      // ConditionEvaluator should be called with IsDoingCondition and asset URI
      expect(mockConditionEvaluator.evaluate).toHaveBeenCalledWith(
        "https://exocortex.my/ontology/ems-ui#IsDoingCondition",
        assetUri,
      );
    });

    it("should show both PauseButton and DoneButton for Doing asset (same condition)", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#StatusButtonGroup",
            label: "Status",
            order: "1",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#PauseButton",
            label: "Pause",
            icon: "pause",
            variant: "warning",
            order: "15",
            action: "https://exocortex.my/ontology/ems-ui#PauseAction",
            condition: "https://exocortex.my/ontology/ems-ui#IsDoingCondition",
          }),
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#DoneButton",
            label: "Done",
            icon: "check",
            variant: "success",
            order: "20",
            action: "https://exocortex.my/ontology/ems-ui#DoneAction",
            condition: "https://exocortex.my/ontology/ems-ui#IsDoingCondition",
          }),
        ]);

      // Both buttons share IsDoingCondition = true
      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      const groups = await builder.buildButtonGroups("test:doing-task");

      expect(groups).toHaveLength(1);
      expect(groups[0].buttons).toHaveLength(2);
      // Both Pause and Done should be visible
      expect(groups[0].buttons[0].label).toBe("Pause");
      expect(groups[0].buttons[1].label).toBe("Done");
    });

    it("should show StartButton but hide PauseButton and DoneButton for ToDo asset", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#StatusButtonGroup",
            label: "Status",
            order: "1",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#StartButton",
            label: "Start",
            icon: "play",
            variant: "primary",
            order: "10",
            action: "https://exocortex.my/ontology/ems-ui#StartAction",
            condition: "https://exocortex.my/ontology/ems-ui#IsToDoCondition",
          }),
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#PauseButton",
            label: "Pause",
            icon: "pause",
            variant: "warning",
            order: "15",
            action: "https://exocortex.my/ontology/ems-ui#PauseAction",
            condition: "https://exocortex.my/ontology/ems-ui#IsDoingCondition",
          }),
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#DoneButton",
            label: "Done",
            icon: "check",
            variant: "success",
            order: "20",
            action: "https://exocortex.my/ontology/ems-ui#DoneAction",
            condition: "https://exocortex.my/ontology/ems-ui#IsDoingCondition",
          }),
        ]);

      // For ToDo asset: IsToDoCondition = true, IsDoingCondition = false
      mockConditionEvaluator.evaluate
        .mockResolvedValueOnce(true)   // IsToDoCondition passes (Start visible)
        .mockResolvedValueOnce(false)  // IsDoingCondition fails (Pause hidden)
        .mockResolvedValueOnce(false); // IsDoingCondition fails (Done hidden)

      const groups = await builder.buildButtonGroups("test:todo-task");

      expect(groups).toHaveLength(1);
      expect(groups[0].buttons).toHaveLength(1);
      expect(groups[0].buttons[0].label).toBe("Start");
    });

    it("should hide StartButton but show PauseButton and DoneButton for Doing asset", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#StatusButtonGroup",
            label: "Status",
            order: "1",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#StartButton",
            label: "Start",
            icon: "play",
            variant: "primary",
            order: "10",
            action: "https://exocortex.my/ontology/ems-ui#StartAction",
            condition: "https://exocortex.my/ontology/ems-ui#IsToDoCondition",
          }),
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#PauseButton",
            label: "Pause",
            icon: "pause",
            variant: "warning",
            order: "15",
            action: "https://exocortex.my/ontology/ems-ui#PauseAction",
            condition: "https://exocortex.my/ontology/ems-ui#IsDoingCondition",
          }),
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#DoneButton",
            label: "Done",
            icon: "check",
            variant: "success",
            order: "20",
            action: "https://exocortex.my/ontology/ems-ui#DoneAction",
            condition: "https://exocortex.my/ontology/ems-ui#IsDoingCondition",
          }),
        ]);

      // For Doing asset: IsToDoCondition = false, IsDoingCondition = true
      mockConditionEvaluator.evaluate
        .mockResolvedValueOnce(false)  // IsToDoCondition fails (Start hidden)
        .mockResolvedValueOnce(true)   // IsDoingCondition passes (Pause visible)
        .mockResolvedValueOnce(true);  // IsDoingCondition passes (Done visible)

      const groups = await builder.buildButtonGroups("test:doing-task");

      expect(groups).toHaveLength(1);
      expect(groups[0].buttons).toHaveLength(2);
      expect(groups[0].buttons[0].label).toBe("Pause");
      expect(groups[0].buttons[1].label).toBe("Done");
    });
  });

  /**
   * TrashButton with ShowModalAction Tests (Issue #1421)
   *
   * Tests for TrashButton which uses CompositeAction containing:
   * - ShowTrashReasonModal (ShowModalAction for input)
   * - SetStatusTrashedAction (UpdatePropertyAction for ems:Effort_status → ems:EffortStatusTrashed)
   *
   * Key difference from other buttons: Action_headless = false (UI-only!)
   * In CLI mode, this will throw HeadlessError with Action_cliAlternative suggestion.
   *
   * RDF Definition:
   * ```turtle
   * ems-ui:TrashButton a exo-ui:Button ;
   *     rdfs:label "Trash" ;
   *     exo-ui:Button_icon "trash" ;
   *     exo-ui:Button_variant "danger" ;
   *     exo-ui:Button_group exo-ui:StatusButtonGroup ;
   *     exo-ui:Button_order 100 ;
   *     exo-ui:Button_action ems-ui:TrashAction ;
   *     exo-ui:Button_condition ems-ui:IsNotTrashedCondition .
   *
   * ems-ui:TrashAction a exo-ui:CompositeAction ;
   *     exo-ui:Action_actions (ems-ui:ShowTrashReasonModal ems-ui:SetStatusTrashedAction) ;
   *     exo-ui:Action_headless false .
   *
   * ems-ui:ShowTrashReasonModal a exo-ui:ShowModalAction ;
   *     exo-ui:Action_modalType "input" ;
   *     exo-ui:Action_modalParams "{\"title\": \"Trash Reason\", \"placeholder\": \"Why are you trashing this?\"}" ;
   *     exo-ui:Action_cliAlternative "--reason \"text\"" .
   *
   * ems-ui:SetStatusTrashedAction a exo-ui:UpdatePropertyAction ;
   *     exo-ui:Action_targetProperty ems:Effort_status ;
   *     exo-ui:Action_targetValue ems:EffortStatusTrashed .
   *
   * ems-ui:IsNotTrashedCondition a exo-ui:Condition ;
   *     exo-ui:Condition_not ems-ui:IsTrashedCondition .
   * ```
   *
   * @see https://github.com/kitelev/exocortex/issues/1421
   */
  describe("TrashButton with ShowModalAction (Issue #1421)", () => {
    it("should load TrashButton with danger variant and trash icon from RDF", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#StatusButtonGroup",
            label: "Status",
            order: "1",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#TrashButton",
            label: "Trash",
            icon: "trash",
            variant: "danger",
            order: "100",
            action: "https://exocortex.my/ontology/ems-ui#TrashAction",
            condition: "https://exocortex.my/ontology/ems-ui#IsNotTrashedCondition",
          }),
        ]);

      // Condition passes (asset is NOT trashed)
      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      const groups = await builder.buildButtonGroups("test:active-task");

      expect(groups).toHaveLength(1);
      expect(groups[0].buttons).toHaveLength(1);

      const trashButton = groups[0].buttons[0];
      expect(trashButton.label).toBe("Trash");
      expect(trashButton.icon).toBe("trash");
      expect(trashButton.variant).toBe("danger");
    });

    it("should hide TrashButton when IsNotTrashedCondition is false (asset already trashed)", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#StatusButtonGroup",
            label: "Status",
            order: "1",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#TrashButton",
            label: "Trash",
            icon: "trash",
            variant: "danger",
            action: "https://exocortex.my/ontology/ems-ui#TrashAction",
            condition: "https://exocortex.my/ontology/ems-ui#IsNotTrashedCondition",
          }),
        ]);

      // Condition fails (asset IS already trashed)
      mockConditionEvaluator.evaluate.mockResolvedValue(false);

      const groups = await builder.buildButtonGroups("test:trashed-task");

      // Group should be empty because TrashButton is filtered out
      expect(groups).toHaveLength(0);
    });

    it("should execute TrashAction (CompositeAction with ShowModalAction) through ActionInterpreter when clicked", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#StatusButtonGroup",
            label: "Status",
            order: "1",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#TrashButton",
            label: "Trash",
            action: "https://exocortex.my/ontology/ems-ui#TrashAction",
            condition: "https://exocortex.my/ontology/ems-ui#IsNotTrashedCondition",
          }),
        ]);

      mockConditionEvaluator.evaluate.mockResolvedValue(true);
      mockActionInterpreter.execute.mockResolvedValue({
        success: true,
        refresh: true,
      });

      const assetUri = "https://exocortex.my/vault/active-task.md";
      const groups = await builder.buildButtonGroups(assetUri);
      const trashButton = groups[0].buttons[0];

      // Click the TrashButton
      await trashButton.onClick();

      // ActionInterpreter should be called with TrashAction URI
      expect(mockActionInterpreter.execute).toHaveBeenCalledWith(
        "https://exocortex.my/ontology/ems-ui#TrashAction",
        { currentAsset: assetUri },
      );
    });

    it("should evaluate IsNotTrashedCondition with correct asset URI", async () => {
      const assetUri = "https://exocortex.my/vault/my-effort.md";

      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#StatusButtonGroup",
            label: "Status",
            order: "1",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#TrashButton",
            label: "Trash",
            action: "https://exocortex.my/ontology/ems-ui#TrashAction",
            condition: "https://exocortex.my/ontology/ems-ui#IsNotTrashedCondition",
          }),
        ]);

      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      await builder.buildButtonGroups(assetUri);

      // ConditionEvaluator should be called with IsNotTrashedCondition and asset URI
      expect(mockConditionEvaluator.evaluate).toHaveBeenCalledWith(
        "https://exocortex.my/ontology/ems-ui#IsNotTrashedCondition",
        assetUri,
      );
    });

    it("should show TrashButton at high order (100) after other status buttons", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#StatusButtonGroup",
            label: "Status",
            order: "1",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#StartButton",
            label: "Start",
            icon: "play",
            variant: "primary",
            order: "10",
            action: "https://exocortex.my/ontology/ems-ui#StartAction",
            condition: "https://exocortex.my/ontology/ems-ui#IsToDoCondition",
          }),
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#TrashButton",
            label: "Trash",
            icon: "trash",
            variant: "danger",
            order: "100",
            action: "https://exocortex.my/ontology/ems-ui#TrashAction",
            condition: "https://exocortex.my/ontology/ems-ui#IsNotTrashedCondition",
          }),
        ]);

      // Both conditions pass
      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      const groups = await builder.buildButtonGroups("test:todo-task");

      expect(groups).toHaveLength(1);
      expect(groups[0].buttons).toHaveLength(2);
      // Start should come before Trash (order 10 vs 100)
      expect(groups[0].buttons[0].label).toBe("Start");
      expect(groups[0].buttons[1].label).toBe("Trash");
    });

    it("should show TrashButton for any non-trashed status (Draft, Backlog, ToDo, Doing, Done)", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#StatusButtonGroup",
            label: "Status",
            order: "1",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#TrashButton",
            label: "Trash",
            icon: "trash",
            variant: "danger",
            action: "https://exocortex.my/ontology/ems-ui#TrashAction",
            condition: "https://exocortex.my/ontology/ems-ui#IsNotTrashedCondition",
          }),
        ]);

      // IsNotTrashedCondition passes (asset is in Draft status, NOT trashed)
      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      const groups = await builder.buildButtonGroups("test:draft-task");

      expect(groups).toHaveLength(1);
      expect(groups[0].buttons).toHaveLength(1);
      expect(groups[0].buttons[0].label).toBe("Trash");
    });
  });
});
