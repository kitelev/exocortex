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

  /**
   * ToBacklogButton with UpdatePropertyAction Tests (Issue #1422)
   *
   * Tests for ToBacklogButton which transitions an effort from Draft/ToDo → Backlog.
   * Uses UpdatePropertyAction to set ems:Effort_status to ems:EffortStatusBacklog.
   *
   * RDF Definition:
   * ```turtle
   * ems-ui:ToBacklogButton a exo-ui:Button ;
   *     rdfs:label "To Backlog" ;
   *     exo-ui:Button_icon "archive" ;
   *     exo-ui:Button_variant "secondary" ;
   *     exo-ui:Button_group exo-ui:StatusButtonGroup ;
   *     exo-ui:Button_order 5 ;
   *     exo-ui:Button_action ems-ui:ToBacklogAction ;
   *     exo-ui:Button_condition ems-ui:CanMoveToBacklogCondition .
   *
   * ems-ui:ToBacklogAction a exo-ui:UpdatePropertyAction ;
   *     exo-ui:Action_targetProperty ems:Effort_status ;
   *     exo-ui:Action_targetValue ems:EffortStatusBacklog ;
   *     exo-ui:Action_headless true .
   *
   * ems-ui:CanMoveToBacklogCondition a exo-ui:Condition ;
   *     exo-ui:Condition_sparql """
   *         ASK {
   *             ?asset a ems:Effort .
   *             ?asset ems:Effort_status ?status .
   *             FILTER(?status IN (ems:EffortStatusDraft, ems:EffortStatusToDo))
   *         }
   *     """ .
   * ```
   *
   * @see https://github.com/kitelev/exocortex/issues/1422
   */
  describe("ToBacklogButton with UpdatePropertyAction (Issue #1422)", () => {
    it("should load ToBacklogButton with secondary variant and archive icon from RDF", async () => {
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
            button: "https://exocortex.my/ontology/ems-ui#ToBacklogButton",
            label: "To Backlog",
            icon: "archive",
            variant: "secondary",
            order: "5",
            action: "https://exocortex.my/ontology/ems-ui#ToBacklogAction",
            condition: "https://exocortex.my/ontology/ems-ui#CanMoveToBacklogCondition",
          }),
        ]);

      // Condition passes (asset is in Draft or ToDo status)
      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      const groups = await builder.buildButtonGroups("test:draft-task");

      expect(groups).toHaveLength(1);
      expect(groups[0].buttons).toHaveLength(1);

      const toBacklogButton = groups[0].buttons[0];
      expect(toBacklogButton.label).toBe("To Backlog");
      expect(toBacklogButton.icon).toBe("archive");
      expect(toBacklogButton.variant).toBe("secondary");
    });

    it("should hide ToBacklogButton when CanMoveToBacklogCondition is false (asset in Doing)", async () => {
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
            button: "https://exocortex.my/ontology/ems-ui#ToBacklogButton",
            label: "To Backlog",
            icon: "archive",
            variant: "secondary",
            action: "https://exocortex.my/ontology/ems-ui#ToBacklogAction",
            condition: "https://exocortex.my/ontology/ems-ui#CanMoveToBacklogCondition",
          }),
        ]);

      // Condition fails (asset is NOT in Draft/ToDo status - it's in Doing)
      mockConditionEvaluator.evaluate.mockResolvedValue(false);

      const groups = await builder.buildButtonGroups("test:doing-task");

      // Group should be empty because ToBacklogButton is filtered out
      expect(groups).toHaveLength(0);
    });

    it("should execute ToBacklogAction through ActionInterpreter when clicked", async () => {
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
            button: "https://exocortex.my/ontology/ems-ui#ToBacklogButton",
            label: "To Backlog",
            action: "https://exocortex.my/ontology/ems-ui#ToBacklogAction",
            condition: "https://exocortex.my/ontology/ems-ui#CanMoveToBacklogCondition",
          }),
        ]);

      mockConditionEvaluator.evaluate.mockResolvedValue(true);
      mockActionInterpreter.execute.mockResolvedValue({
        success: true,
        refresh: true,
      });

      const assetUri = "https://exocortex.my/vault/draft-task.md";
      const groups = await builder.buildButtonGroups(assetUri);
      const toBacklogButton = groups[0].buttons[0];

      // Click the ToBacklogButton
      await toBacklogButton.onClick();

      // ActionInterpreter should be called with ToBacklogAction URI
      expect(mockActionInterpreter.execute).toHaveBeenCalledWith(
        "https://exocortex.my/ontology/ems-ui#ToBacklogAction",
        { currentAsset: assetUri },
      );
    });

    it("should evaluate CanMoveToBacklogCondition with correct asset URI", async () => {
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
            button: "https://exocortex.my/ontology/ems-ui#ToBacklogButton",
            label: "To Backlog",
            action: "https://exocortex.my/ontology/ems-ui#ToBacklogAction",
            condition: "https://exocortex.my/ontology/ems-ui#CanMoveToBacklogCondition",
          }),
        ]);

      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      await builder.buildButtonGroups(assetUri);

      // ConditionEvaluator should be called with CanMoveToBacklogCondition and asset URI
      expect(mockConditionEvaluator.evaluate).toHaveBeenCalledWith(
        "https://exocortex.my/ontology/ems-ui#CanMoveToBacklogCondition",
        assetUri,
      );
    });

    it("should show ToBacklogButton for Draft asset", async () => {
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
            button: "https://exocortex.my/ontology/ems-ui#ToBacklogButton",
            label: "To Backlog",
            icon: "archive",
            variant: "secondary",
            order: "5",
            action: "https://exocortex.my/ontology/ems-ui#ToBacklogAction",
            condition: "https://exocortex.my/ontology/ems-ui#CanMoveToBacklogCondition",
          }),
        ]);

      // CanMoveToBacklogCondition passes (asset is in Draft status)
      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      const groups = await builder.buildButtonGroups("test:draft-task");

      expect(groups).toHaveLength(1);
      expect(groups[0].buttons).toHaveLength(1);
      expect(groups[0].buttons[0].label).toBe("To Backlog");
    });

    it("should show ToBacklogButton for ToDo asset", async () => {
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
            button: "https://exocortex.my/ontology/ems-ui#ToBacklogButton",
            label: "To Backlog",
            icon: "archive",
            variant: "secondary",
            order: "5",
            action: "https://exocortex.my/ontology/ems-ui#ToBacklogAction",
            condition: "https://exocortex.my/ontology/ems-ui#CanMoveToBacklogCondition",
          }),
        ]);

      // CanMoveToBacklogCondition passes (asset is in ToDo status)
      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      const groups = await builder.buildButtonGroups("test:todo-task");

      expect(groups).toHaveLength(1);
      expect(groups[0].buttons).toHaveLength(1);
      expect(groups[0].buttons[0].label).toBe("To Backlog");
    });

    it("should show ToBacklogButton at order 5 before StartButton", async () => {
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
            button: "https://exocortex.my/ontology/ems-ui#ToBacklogButton",
            label: "To Backlog",
            icon: "archive",
            variant: "secondary",
            order: "5",
            action: "https://exocortex.my/ontology/ems-ui#ToBacklogAction",
            condition: "https://exocortex.my/ontology/ems-ui#CanMoveToBacklogCondition",
          }),
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#StartButton",
            label: "Start",
            icon: "play",
            variant: "primary",
            order: "10",
            action: "https://exocortex.my/ontology/ems-ui#StartAction",
            condition: "https://exocortex.my/ontology/ems-ui#IsToDoCondition",
          }),
        ]);

      // Both conditions pass for ToDo asset
      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      const groups = await builder.buildButtonGroups("test:todo-task");

      expect(groups).toHaveLength(1);
      expect(groups[0].buttons).toHaveLength(2);
      // ToBacklog should come before Start (order 5 vs 10)
      expect(groups[0].buttons[0].label).toBe("To Backlog");
      expect(groups[0].buttons[1].label).toBe("Start");
    });
  });

  /**
   * ScheduleButton with UpdatePropertyAction Tests (Issue #1422)
   *
   * Tests for ScheduleButton which transitions an effort from Backlog → ToDo.
   * Uses UpdatePropertyAction to set ems:Effort_status to ems:EffortStatusToDo.
   *
   * RDF Definition:
   * ```turtle
   * ems-ui:ScheduleButton a exo-ui:Button ;
   *     rdfs:label "Schedule" ;
   *     exo-ui:Button_icon "calendar" ;
   *     exo-ui:Button_variant "primary" ;
   *     exo-ui:Button_group exo-ui:StatusButtonGroup ;
   *     exo-ui:Button_order 8 ;
   *     exo-ui:Button_action ems-ui:ScheduleAction ;
   *     exo-ui:Button_condition ems-ui:IsBacklogCondition .
   *
   * ems-ui:ScheduleAction a exo-ui:UpdatePropertyAction ;
   *     exo-ui:Action_targetProperty ems:Effort_status ;
   *     exo-ui:Action_targetValue ems:EffortStatusToDo ;
   *     exo-ui:Action_headless true .
   *
   * ems-ui:IsBacklogCondition a exo-ui:Condition ;
   *     exo-ui:Condition_hasProperty ems:Effort_status ;
   *     exo-ui:Condition_propertyValue ems:EffortStatusBacklog .
   * ```
   *
   * @see https://github.com/kitelev/exocortex/issues/1422
   */
  describe("ScheduleButton with UpdatePropertyAction (Issue #1422)", () => {
    it("should load ScheduleButton with primary variant and calendar icon from RDF", async () => {
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
            button: "https://exocortex.my/ontology/ems-ui#ScheduleButton",
            label: "Schedule",
            icon: "calendar",
            variant: "primary",
            order: "8",
            action: "https://exocortex.my/ontology/ems-ui#ScheduleAction",
            condition: "https://exocortex.my/ontology/ems-ui#IsBacklogCondition",
          }),
        ]);

      // Condition passes (asset is in Backlog status)
      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      const groups = await builder.buildButtonGroups("test:backlog-task");

      expect(groups).toHaveLength(1);
      expect(groups[0].buttons).toHaveLength(1);

      const scheduleButton = groups[0].buttons[0];
      expect(scheduleButton.label).toBe("Schedule");
      expect(scheduleButton.icon).toBe("calendar");
      expect(scheduleButton.variant).toBe("primary");
    });

    it("should hide ScheduleButton when IsBacklogCondition is false (asset not in Backlog)", async () => {
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
            button: "https://exocortex.my/ontology/ems-ui#ScheduleButton",
            label: "Schedule",
            icon: "calendar",
            variant: "primary",
            action: "https://exocortex.my/ontology/ems-ui#ScheduleAction",
            condition: "https://exocortex.my/ontology/ems-ui#IsBacklogCondition",
          }),
        ]);

      // Condition fails (asset is NOT in Backlog status)
      mockConditionEvaluator.evaluate.mockResolvedValue(false);

      const groups = await builder.buildButtonGroups("test:todo-task");

      // Group should be empty because ScheduleButton is filtered out
      expect(groups).toHaveLength(0);
    });

    it("should execute ScheduleAction through ActionInterpreter when clicked", async () => {
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
            button: "https://exocortex.my/ontology/ems-ui#ScheduleButton",
            label: "Schedule",
            action: "https://exocortex.my/ontology/ems-ui#ScheduleAction",
            condition: "https://exocortex.my/ontology/ems-ui#IsBacklogCondition",
          }),
        ]);

      mockConditionEvaluator.evaluate.mockResolvedValue(true);
      mockActionInterpreter.execute.mockResolvedValue({
        success: true,
        refresh: true,
      });

      const assetUri = "https://exocortex.my/vault/backlog-task.md";
      const groups = await builder.buildButtonGroups(assetUri);
      const scheduleButton = groups[0].buttons[0];

      // Click the ScheduleButton
      await scheduleButton.onClick();

      // ActionInterpreter should be called with ScheduleAction URI
      expect(mockActionInterpreter.execute).toHaveBeenCalledWith(
        "https://exocortex.my/ontology/ems-ui#ScheduleAction",
        { currentAsset: assetUri },
      );
    });

    it("should evaluate IsBacklogCondition with correct asset URI", async () => {
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
            button: "https://exocortex.my/ontology/ems-ui#ScheduleButton",
            label: "Schedule",
            action: "https://exocortex.my/ontology/ems-ui#ScheduleAction",
            condition: "https://exocortex.my/ontology/ems-ui#IsBacklogCondition",
          }),
        ]);

      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      await builder.buildButtonGroups(assetUri);

      // ConditionEvaluator should be called with IsBacklogCondition and asset URI
      expect(mockConditionEvaluator.evaluate).toHaveBeenCalledWith(
        "https://exocortex.my/ontology/ems-ui#IsBacklogCondition",
        assetUri,
      );
    });

    it("should show ScheduleButton only for Backlog assets, not Draft/ToDo", async () => {
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
            button: "https://exocortex.my/ontology/ems-ui#ScheduleButton",
            label: "Schedule",
            icon: "calendar",
            variant: "primary",
            order: "8",
            action: "https://exocortex.my/ontology/ems-ui#ScheduleAction",
            condition: "https://exocortex.my/ontology/ems-ui#IsBacklogCondition",
          }),
        ]);

      // IsBacklogCondition fails (asset is in ToDo status, not Backlog)
      mockConditionEvaluator.evaluate.mockResolvedValue(false);

      const groups = await builder.buildButtonGroups("test:todo-task");

      expect(groups).toHaveLength(0);
    });

    it("should show ScheduleButton at order 8 between ToBacklogButton and StartButton", async () => {
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
            button: "https://exocortex.my/ontology/ems-ui#ToBacklogButton",
            label: "To Backlog",
            icon: "archive",
            variant: "secondary",
            order: "5",
            action: "https://exocortex.my/ontology/ems-ui#ToBacklogAction",
            condition: "https://exocortex.my/ontology/ems-ui#CanMoveToBacklogCondition",
          }),
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#ScheduleButton",
            label: "Schedule",
            icon: "calendar",
            variant: "primary",
            order: "8",
            action: "https://exocortex.my/ontology/ems-ui#ScheduleAction",
            condition: "https://exocortex.my/ontology/ems-ui#IsBacklogCondition",
          }),
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#StartButton",
            label: "Start",
            icon: "play",
            variant: "primary",
            order: "10",
            action: "https://exocortex.my/ontology/ems-ui#StartAction",
            condition: "https://exocortex.my/ontology/ems-ui#IsToDoCondition",
          }),
        ]);

      // All conditions pass - theoretical scenario for order testing
      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      const groups = await builder.buildButtonGroups("test:task");

      expect(groups).toHaveLength(1);
      expect(groups[0].buttons).toHaveLength(3);
      // Buttons should be in order: ToBacklog (5), Schedule (8), Start (10)
      expect(groups[0].buttons[0].label).toBe("To Backlog");
      expect(groups[0].buttons[1].label).toBe("Schedule");
      expect(groups[0].buttons[2].label).toBe("Start");
    });

    it("should show both ToBacklogButton and ScheduleButton on Backlog asset", async () => {
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
            button: "https://exocortex.my/ontology/ems-ui#ToBacklogButton",
            label: "To Backlog",
            icon: "archive",
            variant: "secondary",
            order: "5",
            action: "https://exocortex.my/ontology/ems-ui#ToBacklogAction",
            condition: "https://exocortex.my/ontology/ems-ui#CanMoveToBacklogCondition",
          }),
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#ScheduleButton",
            label: "Schedule",
            icon: "calendar",
            variant: "primary",
            order: "8",
            action: "https://exocortex.my/ontology/ems-ui#ScheduleAction",
            condition: "https://exocortex.my/ontology/ems-ui#IsBacklogCondition",
          }),
        ]);

      // For Backlog asset: CanMoveToBacklogCondition = false (already in Backlog), IsBacklogCondition = true
      mockConditionEvaluator.evaluate
        .mockResolvedValueOnce(false)  // CanMoveToBacklogCondition fails (already Backlog)
        .mockResolvedValueOnce(true);  // IsBacklogCondition passes

      const groups = await builder.buildButtonGroups("test:backlog-task");

      expect(groups).toHaveLength(1);
      expect(groups[0].buttons).toHaveLength(1);
      expect(groups[0].buttons[0].label).toBe("Schedule");
    });
  });

  /**
   * CreateTaskButton with CreateAssetAction Tests (Issue #1423)
   *
   * Tests for CreateTaskButton which uses CreateAssetAction to create a new Task.
   * This is a Creation Button (not Status Button) - always visible and uses UI modal.
   *
   * RDF Definition:
   * ```turtle
   * ems-ui:CreateTaskButton a exo-ui:Button ;
   *     rdfs:label "Create Task" ;
   *     exo-ui:Button_icon "plus-circle" ;
   *     exo-ui:Button_variant "primary" ;
   *     exo-ui:Button_group exo-ui:CreationButtonGroup ;
   *     exo-ui:Button_order 10 ;
   *     exo-ui:Button_tooltip "Create a new task" ;
   *     exo-ui:Button_action ems-ui:CreateTaskAction ;
   *     exo-ui:Button_condition exo-ui:AlwaysVisible .
   *
   * ems-ui:CreateTaskAction a exo-ui:CreateAssetAction ;
   *     exo-ui:Action_targetClass ems:Task ;
   *     exo-ui:Action_template ems:DefaultTaskTemplate ;
   *     exo-ui:Action_location "01 Inbox/" ;
   *     exo-ui:Action_headless false .
   * ```
   *
   * @see https://github.com/kitelev/exocortex/issues/1423
   */
  describe("CreateTaskButton with CreateAssetAction (Issue #1423)", () => {
    it("should load CreateTaskButton with primary variant and plus-circle icon from RDF", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#CreationButtonGroup",
            label: "Creation",
            order: "2",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#CreateTaskButton",
            label: "Create Task",
            icon: "plus-circle",
            variant: "primary",
            order: "10",
            action: "https://exocortex.my/ontology/ems-ui#CreateTaskAction",
            condition: "https://exocortex.my/ontology/exo-ui#AlwaysVisible",
            tooltip: "Create a new task",
          }),
        ]);

      // AlwaysVisible condition always passes
      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      const groups = await builder.buildButtonGroups("test:some-asset");

      expect(groups).toHaveLength(1);
      expect(groups[0].id).toBe("https://exocortex.my/ontology/exo-ui#CreationButtonGroup");
      expect(groups[0].title).toBe("Creation");
      expect(groups[0].buttons).toHaveLength(1);

      const createTaskButton = groups[0].buttons[0];
      expect(createTaskButton.label).toBe("Create Task");
      expect(createTaskButton.icon).toBe("plus-circle");
      expect(createTaskButton.variant).toBe("primary");
      expect(createTaskButton.tooltip).toBe("Create a new task");
    });

    it("should show CreateTaskButton for any asset type (AlwaysVisible condition)", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#CreationButtonGroup",
            label: "Creation",
            order: "2",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#CreateTaskButton",
            label: "Create Task",
            icon: "plus-circle",
            variant: "primary",
            action: "https://exocortex.my/ontology/ems-ui#CreateTaskAction",
            condition: "https://exocortex.my/ontology/exo-ui#AlwaysVisible",
          }),
        ]);

      // AlwaysVisible always evaluates to true
      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      // Test with different asset types - should always show
      const groups1 = await builder.buildButtonGroups("test:project-asset");
      expect(groups1).toHaveLength(1);
      expect(groups1[0].buttons[0].label).toBe("Create Task");

      // Reset mocks for next test
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#CreationButtonGroup",
            label: "Creation",
            order: "2",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#CreateTaskButton",
            label: "Create Task",
            icon: "plus-circle",
            variant: "primary",
            action: "https://exocortex.my/ontology/ems-ui#CreateTaskAction",
            condition: "https://exocortex.my/ontology/exo-ui#AlwaysVisible",
          }),
        ]);

      const groups2 = await builder.buildButtonGroups("test:area-asset");
      expect(groups2).toHaveLength(1);
      expect(groups2[0].buttons[0].label).toBe("Create Task");
    });

    it("should execute CreateTaskAction through ActionInterpreter when clicked", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#CreationButtonGroup",
            label: "Creation",
            order: "2",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#CreateTaskButton",
            label: "Create Task",
            action: "https://exocortex.my/ontology/ems-ui#CreateTaskAction",
            condition: "https://exocortex.my/ontology/exo-ui#AlwaysVisible",
          }),
        ]);

      mockConditionEvaluator.evaluate.mockResolvedValue(true);
      mockActionInterpreter.execute.mockResolvedValue({
        success: true,
        refresh: true,
        navigateTo: { path: "01 Inbox/New Task.md" } as any,
      });

      const assetUri = "https://exocortex.my/vault/current-project.md";
      const groups = await builder.buildButtonGroups(assetUri);
      const createTaskButton = groups[0].buttons[0];

      // Click the CreateTaskButton
      await createTaskButton.onClick();

      // ActionInterpreter should be called with CreateTaskAction URI
      expect(mockActionInterpreter.execute).toHaveBeenCalledWith(
        "https://exocortex.my/ontology/ems-ui#CreateTaskAction",
        { currentAsset: assetUri },
      );
    });

    it("should evaluate AlwaysVisible condition with correct asset URI", async () => {
      const assetUri = "https://exocortex.my/vault/my-project.md";

      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#CreationButtonGroup",
            label: "Creation",
            order: "2",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#CreateTaskButton",
            label: "Create Task",
            action: "https://exocortex.my/ontology/ems-ui#CreateTaskAction",
            condition: "https://exocortex.my/ontology/exo-ui#AlwaysVisible",
          }),
        ]);

      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      await builder.buildButtonGroups(assetUri);

      // ConditionEvaluator should be called with AlwaysVisible and asset URI
      expect(mockConditionEvaluator.evaluate).toHaveBeenCalledWith(
        "https://exocortex.my/ontology/exo-ui#AlwaysVisible",
        assetUri,
      );
    });

    it("should place CreateTaskButton in CreationButtonGroup separate from StatusButtonGroup", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#StatusButtonGroup",
            label: "Status",
            order: "1",
          }),
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#CreationButtonGroup",
            label: "Creation",
            order: "2",
          }),
        ])
        // StatusButtonGroup buttons
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
        ])
        // CreationButtonGroup buttons
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#CreateTaskButton",
            label: "Create Task",
            icon: "plus-circle",
            variant: "primary",
            order: "10",
            action: "https://exocortex.my/ontology/ems-ui#CreateTaskAction",
            condition: "https://exocortex.my/ontology/exo-ui#AlwaysVisible",
          }),
        ]);

      // All conditions pass
      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      const groups = await builder.buildButtonGroups("test:todo-task");

      expect(groups).toHaveLength(2);
      expect(groups[0].title).toBe("Status");
      expect(groups[0].buttons[0].label).toBe("Start");
      expect(groups[1].title).toBe("Creation");
      expect(groups[1].buttons[0].label).toBe("Create Task");
    });

    it("should show CreateTaskButton alongside status buttons for ToDo task", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#StatusButtonGroup",
            label: "Status",
            order: "1",
          }),
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#CreationButtonGroup",
            label: "Creation",
            order: "2",
          }),
        ])
        // StatusButtonGroup: StartButton visible for ToDo
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
        ])
        // CreationButtonGroup: CreateTaskButton always visible
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#CreateTaskButton",
            label: "Create Task",
            icon: "plus-circle",
            variant: "primary",
            order: "10",
            action: "https://exocortex.my/ontology/ems-ui#CreateTaskAction",
            condition: "https://exocortex.my/ontology/exo-ui#AlwaysVisible",
          }),
        ]);

      // For ToDo task: IsToDoCondition = true, IsDoingCondition = false, AlwaysVisible = true
      mockConditionEvaluator.evaluate
        .mockResolvedValueOnce(true)   // IsToDoCondition passes (Start visible)
        .mockResolvedValueOnce(false)  // IsDoingCondition fails (Done hidden)
        .mockResolvedValueOnce(true);  // AlwaysVisible passes (Create Task visible)

      const groups = await builder.buildButtonGroups("test:todo-task");

      expect(groups).toHaveLength(2);
      // Status group has only Start button
      expect(groups[0].title).toBe("Status");
      expect(groups[0].buttons).toHaveLength(1);
      expect(groups[0].buttons[0].label).toBe("Start");
      // Creation group has Create Task button
      expect(groups[1].title).toBe("Creation");
      expect(groups[1].buttons).toHaveLength(1);
      expect(groups[1].buttons[0].label).toBe("Create Task");
    });

    it("should show multiple creation buttons in CreationButtonGroup", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#CreationButtonGroup",
            label: "Creation",
            order: "2",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#CreateTaskButton",
            label: "Create Task",
            icon: "plus-circle",
            variant: "primary",
            order: "10",
            action: "https://exocortex.my/ontology/ems-ui#CreateTaskAction",
            condition: "https://exocortex.my/ontology/exo-ui#AlwaysVisible",
          }),
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#CreateProjectButton",
            label: "Create Project",
            icon: "folder-plus",
            variant: "primary",
            order: "20",
            action: "https://exocortex.my/ontology/ems-ui#CreateProjectAction",
            condition: "https://exocortex.my/ontology/exo-ui#AlwaysVisible",
          }),
        ]);

      // Both conditions pass (AlwaysVisible)
      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      const groups = await builder.buildButtonGroups("test:project");

      expect(groups).toHaveLength(1);
      expect(groups[0].title).toBe("Creation");
      expect(groups[0].buttons).toHaveLength(2);
      // Buttons should be in order: Create Task (10), Create Project (20)
      expect(groups[0].buttons[0].label).toBe("Create Task");
      expect(groups[0].buttons[1].label).toBe("Create Project");
    });
  });

  /**
   * CreateProjectButton with CreateAssetAction Tests (Issue #1424)
   *
   * Tests for CreateProjectButton which uses CreateAssetAction to create a new Project.
   * This is a Creation Button (not Status Button) - always visible and uses UI modal.
   *
   * RDF Definition:
   * ```turtle
   * ems-ui:CreateProjectButton a exo-ui:Button ;
   *     rdfs:label "Create Project" ;
   *     exo-ui:Button_icon "folder-plus" ;
   *     exo-ui:Button_variant "primary" ;
   *     exo-ui:Button_group exo-ui:CreationButtonGroup ;
   *     exo-ui:Button_order 20 ;
   *     exo-ui:Button_tooltip "Create a new project" ;
   *     exo-ui:Button_action ems-ui:CreateProjectAction ;
   *     exo-ui:Button_condition exo-ui:AlwaysVisible .
   *
   * ems-ui:CreateProjectAction a exo-ui:CreateAssetAction ;
   *     exo-ui:Action_targetClass ems:Project ;
   *     exo-ui:Action_template ems:DefaultProjectTemplate ;
   *     exo-ui:Action_headless false .
   * ```
   *
   * @see https://github.com/kitelev/exocortex/issues/1424
   */
  describe("CreateProjectButton with CreateAssetAction (Issue #1424)", () => {
    it("should load CreateProjectButton with primary variant and folder-plus icon from RDF", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#CreationButtonGroup",
            label: "Creation",
            order: "2",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#CreateProjectButton",
            label: "Create Project",
            icon: "folder-plus",
            variant: "primary",
            order: "20",
            action: "https://exocortex.my/ontology/ems-ui#CreateProjectAction",
            condition: "https://exocortex.my/ontology/exo-ui#AlwaysVisible",
            tooltip: "Create a new project",
          }),
        ]);

      // AlwaysVisible condition always passes
      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      const groups = await builder.buildButtonGroups("test:some-asset");

      expect(groups).toHaveLength(1);
      expect(groups[0].id).toBe("https://exocortex.my/ontology/exo-ui#CreationButtonGroup");
      expect(groups[0].title).toBe("Creation");
      expect(groups[0].buttons).toHaveLength(1);

      const createProjectButton = groups[0].buttons[0];
      expect(createProjectButton.label).toBe("Create Project");
      expect(createProjectButton.icon).toBe("folder-plus");
      expect(createProjectButton.variant).toBe("primary");
      expect(createProjectButton.tooltip).toBe("Create a new project");
    });

    it("should show CreateProjectButton for any asset type (AlwaysVisible condition)", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#CreationButtonGroup",
            label: "Creation",
            order: "2",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#CreateProjectButton",
            label: "Create Project",
            icon: "folder-plus",
            variant: "primary",
            action: "https://exocortex.my/ontology/ems-ui#CreateProjectAction",
            condition: "https://exocortex.my/ontology/exo-ui#AlwaysVisible",
          }),
        ]);

      // AlwaysVisible always evaluates to true
      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      // Test with different asset types - should always show
      const groups1 = await builder.buildButtonGroups("test:task-asset");
      expect(groups1).toHaveLength(1);
      expect(groups1[0].buttons[0].label).toBe("Create Project");

      // Reset mocks for next test
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#CreationButtonGroup",
            label: "Creation",
            order: "2",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#CreateProjectButton",
            label: "Create Project",
            icon: "folder-plus",
            variant: "primary",
            action: "https://exocortex.my/ontology/ems-ui#CreateProjectAction",
            condition: "https://exocortex.my/ontology/exo-ui#AlwaysVisible",
          }),
        ]);

      const groups2 = await builder.buildButtonGroups("test:area-asset");
      expect(groups2).toHaveLength(1);
      expect(groups2[0].buttons[0].label).toBe("Create Project");
    });

    it("should execute CreateProjectAction through ActionInterpreter when clicked", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#CreationButtonGroup",
            label: "Creation",
            order: "2",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#CreateProjectButton",
            label: "Create Project",
            action: "https://exocortex.my/ontology/ems-ui#CreateProjectAction",
            condition: "https://exocortex.my/ontology/exo-ui#AlwaysVisible",
          }),
        ]);

      mockConditionEvaluator.evaluate.mockResolvedValue(true);
      mockActionInterpreter.execute.mockResolvedValue({
        success: true,
        refresh: true,
        navigateTo: { path: "02 Projects/New Project.md" } as any,
      });

      const assetUri = "https://exocortex.my/vault/current-area.md";
      const groups = await builder.buildButtonGroups(assetUri);
      const createProjectButton = groups[0].buttons[0];

      // Click the CreateProjectButton
      await createProjectButton.onClick();

      // ActionInterpreter should be called with CreateProjectAction URI
      expect(mockActionInterpreter.execute).toHaveBeenCalledWith(
        "https://exocortex.my/ontology/ems-ui#CreateProjectAction",
        { currentAsset: assetUri },
      );
    });

    it("should evaluate AlwaysVisible condition with correct asset URI", async () => {
      const assetUri = "https://exocortex.my/vault/my-area.md";

      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#CreationButtonGroup",
            label: "Creation",
            order: "2",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#CreateProjectButton",
            label: "Create Project",
            action: "https://exocortex.my/ontology/ems-ui#CreateProjectAction",
            condition: "https://exocortex.my/ontology/exo-ui#AlwaysVisible",
          }),
        ]);

      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      await builder.buildButtonGroups(assetUri);

      // ConditionEvaluator should be called with AlwaysVisible and asset URI
      expect(mockConditionEvaluator.evaluate).toHaveBeenCalledWith(
        "https://exocortex.my/ontology/exo-ui#AlwaysVisible",
        assetUri,
      );
    });

    it("should show CreateProjectButton at order 20 after CreateTaskButton in CreationButtonGroup", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#CreationButtonGroup",
            label: "Creation",
            order: "2",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#CreateTaskButton",
            label: "Create Task",
            icon: "plus-circle",
            variant: "primary",
            order: "10",
            action: "https://exocortex.my/ontology/ems-ui#CreateTaskAction",
            condition: "https://exocortex.my/ontology/exo-ui#AlwaysVisible",
          }),
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#CreateProjectButton",
            label: "Create Project",
            icon: "folder-plus",
            variant: "primary",
            order: "20",
            action: "https://exocortex.my/ontology/ems-ui#CreateProjectAction",
            condition: "https://exocortex.my/ontology/exo-ui#AlwaysVisible",
          }),
        ]);

      // Both conditions pass (AlwaysVisible)
      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      const groups = await builder.buildButtonGroups("test:asset");

      expect(groups).toHaveLength(1);
      expect(groups[0].buttons).toHaveLength(2);
      // CreateTask (10) should come before CreateProject (20)
      expect(groups[0].buttons[0].label).toBe("Create Task");
      expect(groups[0].buttons[1].label).toBe("Create Project");
    });

    it("should show CreateProjectButton alongside status buttons for ToDo task", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#StatusButtonGroup",
            label: "Status",
            order: "1",
          }),
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#CreationButtonGroup",
            label: "Creation",
            order: "2",
          }),
        ])
        // StatusButtonGroup buttons
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
        ])
        // CreationButtonGroup buttons
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#CreateProjectButton",
            label: "Create Project",
            icon: "folder-plus",
            variant: "primary",
            order: "20",
            action: "https://exocortex.my/ontology/ems-ui#CreateProjectAction",
            condition: "https://exocortex.my/ontology/exo-ui#AlwaysVisible",
          }),
        ]);

      // IsToDoCondition = true, AlwaysVisible = true
      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      const groups = await builder.buildButtonGroups("test:todo-task");

      expect(groups).toHaveLength(2);
      expect(groups[0].title).toBe("Status");
      expect(groups[0].buttons[0].label).toBe("Start");
      expect(groups[1].title).toBe("Creation");
      expect(groups[1].buttons[0].label).toBe("Create Project");
    });
  });

  /**
   * CreateAreaButton with CreateAssetAction Tests (Issue #1424)
   *
   * Tests for CreateAreaButton which uses CreateAssetAction to create a new Area.
   * This is a Creation Button (not Status Button) - always visible and uses UI modal.
   *
   * RDF Definition:
   * ```turtle
   * ems-ui:CreateAreaButton a exo-ui:Button ;
   *     rdfs:label "Create Area" ;
   *     exo-ui:Button_icon "layout" ;
   *     exo-ui:Button_variant "primary" ;
   *     exo-ui:Button_group exo-ui:CreationButtonGroup ;
   *     exo-ui:Button_order 30 ;
   *     exo-ui:Button_tooltip "Create a new area" ;
   *     exo-ui:Button_action ems-ui:CreateAreaAction ;
   *     exo-ui:Button_condition exo-ui:AlwaysVisible .
   *
   * ems-ui:CreateAreaAction a exo-ui:CreateAssetAction ;
   *     exo-ui:Action_targetClass ems:Area ;
   *     exo-ui:Action_template ems:DefaultAreaTemplate ;
   *     exo-ui:Action_headless false .
   * ```
   *
   * @see https://github.com/kitelev/exocortex/issues/1424
   */
  describe("CreateAreaButton with CreateAssetAction (Issue #1424)", () => {
    it("should load CreateAreaButton with primary variant and layout icon from RDF", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#CreationButtonGroup",
            label: "Creation",
            order: "2",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#CreateAreaButton",
            label: "Create Area",
            icon: "layout",
            variant: "primary",
            order: "30",
            action: "https://exocortex.my/ontology/ems-ui#CreateAreaAction",
            condition: "https://exocortex.my/ontology/exo-ui#AlwaysVisible",
            tooltip: "Create a new area",
          }),
        ]);

      // AlwaysVisible condition always passes
      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      const groups = await builder.buildButtonGroups("test:some-asset");

      expect(groups).toHaveLength(1);
      expect(groups[0].id).toBe("https://exocortex.my/ontology/exo-ui#CreationButtonGroup");
      expect(groups[0].title).toBe("Creation");
      expect(groups[0].buttons).toHaveLength(1);

      const createAreaButton = groups[0].buttons[0];
      expect(createAreaButton.label).toBe("Create Area");
      expect(createAreaButton.icon).toBe("layout");
      expect(createAreaButton.variant).toBe("primary");
      expect(createAreaButton.tooltip).toBe("Create a new area");
    });

    it("should show CreateAreaButton for any asset type (AlwaysVisible condition)", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#CreationButtonGroup",
            label: "Creation",
            order: "2",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#CreateAreaButton",
            label: "Create Area",
            icon: "layout",
            variant: "primary",
            action: "https://exocortex.my/ontology/ems-ui#CreateAreaAction",
            condition: "https://exocortex.my/ontology/exo-ui#AlwaysVisible",
          }),
        ]);

      // AlwaysVisible always evaluates to true
      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      // Test with different asset types - should always show
      const groups1 = await builder.buildButtonGroups("test:task-asset");
      expect(groups1).toHaveLength(1);
      expect(groups1[0].buttons[0].label).toBe("Create Area");

      // Reset mocks for next test
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#CreationButtonGroup",
            label: "Creation",
            order: "2",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#CreateAreaButton",
            label: "Create Area",
            icon: "layout",
            variant: "primary",
            action: "https://exocortex.my/ontology/ems-ui#CreateAreaAction",
            condition: "https://exocortex.my/ontology/exo-ui#AlwaysVisible",
          }),
        ]);

      const groups2 = await builder.buildButtonGroups("test:project-asset");
      expect(groups2).toHaveLength(1);
      expect(groups2[0].buttons[0].label).toBe("Create Area");
    });

    it("should execute CreateAreaAction through ActionInterpreter when clicked", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#CreationButtonGroup",
            label: "Creation",
            order: "2",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#CreateAreaButton",
            label: "Create Area",
            action: "https://exocortex.my/ontology/ems-ui#CreateAreaAction",
            condition: "https://exocortex.my/ontology/exo-ui#AlwaysVisible",
          }),
        ]);

      mockConditionEvaluator.evaluate.mockResolvedValue(true);
      mockActionInterpreter.execute.mockResolvedValue({
        success: true,
        refresh: true,
        navigateTo: { path: "03 Areas/New Area.md" } as any,
      });

      const assetUri = "https://exocortex.my/vault/current-project.md";
      const groups = await builder.buildButtonGroups(assetUri);
      const createAreaButton = groups[0].buttons[0];

      // Click the CreateAreaButton
      await createAreaButton.onClick();

      // ActionInterpreter should be called with CreateAreaAction URI
      expect(mockActionInterpreter.execute).toHaveBeenCalledWith(
        "https://exocortex.my/ontology/ems-ui#CreateAreaAction",
        { currentAsset: assetUri },
      );
    });

    it("should evaluate AlwaysVisible condition with correct asset URI", async () => {
      const assetUri = "https://exocortex.my/vault/my-project.md";

      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#CreationButtonGroup",
            label: "Creation",
            order: "2",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#CreateAreaButton",
            label: "Create Area",
            action: "https://exocortex.my/ontology/ems-ui#CreateAreaAction",
            condition: "https://exocortex.my/ontology/exo-ui#AlwaysVisible",
          }),
        ]);

      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      await builder.buildButtonGroups(assetUri);

      // ConditionEvaluator should be called with AlwaysVisible and asset URI
      expect(mockConditionEvaluator.evaluate).toHaveBeenCalledWith(
        "https://exocortex.my/ontology/exo-ui#AlwaysVisible",
        assetUri,
      );
    });

    it("should show CreateAreaButton at order 30 after CreateTaskButton and CreateProjectButton", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#CreationButtonGroup",
            label: "Creation",
            order: "2",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#CreateTaskButton",
            label: "Create Task",
            icon: "plus-circle",
            variant: "primary",
            order: "10",
            action: "https://exocortex.my/ontology/ems-ui#CreateTaskAction",
            condition: "https://exocortex.my/ontology/exo-ui#AlwaysVisible",
          }),
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#CreateProjectButton",
            label: "Create Project",
            icon: "folder-plus",
            variant: "primary",
            order: "20",
            action: "https://exocortex.my/ontology/ems-ui#CreateProjectAction",
            condition: "https://exocortex.my/ontology/exo-ui#AlwaysVisible",
          }),
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#CreateAreaButton",
            label: "Create Area",
            icon: "layout",
            variant: "primary",
            order: "30",
            action: "https://exocortex.my/ontology/ems-ui#CreateAreaAction",
            condition: "https://exocortex.my/ontology/exo-ui#AlwaysVisible",
          }),
        ]);

      // All conditions pass (AlwaysVisible)
      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      const groups = await builder.buildButtonGroups("test:asset");

      expect(groups).toHaveLength(1);
      expect(groups[0].buttons).toHaveLength(3);
      // Order: CreateTask (10), CreateProject (20), CreateArea (30)
      expect(groups[0].buttons[0].label).toBe("Create Task");
      expect(groups[0].buttons[1].label).toBe("Create Project");
      expect(groups[0].buttons[2].label).toBe("Create Area");
    });

    it("should show CreateAreaButton alongside status buttons for Doing task", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#StatusButtonGroup",
            label: "Status",
            order: "1",
          }),
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#CreationButtonGroup",
            label: "Creation",
            order: "2",
          }),
        ])
        // StatusButtonGroup buttons
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
        ])
        // CreationButtonGroup buttons
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#CreateAreaButton",
            label: "Create Area",
            icon: "layout",
            variant: "primary",
            order: "30",
            action: "https://exocortex.my/ontology/ems-ui#CreateAreaAction",
            condition: "https://exocortex.my/ontology/exo-ui#AlwaysVisible",
          }),
        ]);

      // All conditions pass
      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      const groups = await builder.buildButtonGroups("test:doing-task");

      expect(groups).toHaveLength(2);
      expect(groups[0].title).toBe("Status");
      expect(groups[0].buttons).toHaveLength(2);
      expect(groups[0].buttons[0].label).toBe("Pause");
      expect(groups[0].buttons[1].label).toBe("Done");
      expect(groups[1].title).toBe("Creation");
      expect(groups[1].buttons).toHaveLength(1);
      expect(groups[1].buttons[0].label).toBe("Create Area");
    });

    it("should show all creation buttons together in CreationButtonGroup", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#CreationButtonGroup",
            label: "Creation",
            order: "2",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#CreateTaskButton",
            label: "Create Task",
            icon: "plus-circle",
            variant: "primary",
            order: "10",
            action: "https://exocortex.my/ontology/ems-ui#CreateTaskAction",
            condition: "https://exocortex.my/ontology/exo-ui#AlwaysVisible",
            tooltip: "Create a new task",
          }),
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#CreateProjectButton",
            label: "Create Project",
            icon: "folder-plus",
            variant: "primary",
            order: "20",
            action: "https://exocortex.my/ontology/ems-ui#CreateProjectAction",
            condition: "https://exocortex.my/ontology/exo-ui#AlwaysVisible",
            tooltip: "Create a new project",
          }),
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#CreateAreaButton",
            label: "Create Area",
            icon: "layout",
            variant: "primary",
            order: "30",
            action: "https://exocortex.my/ontology/ems-ui#CreateAreaAction",
            condition: "https://exocortex.my/ontology/exo-ui#AlwaysVisible",
            tooltip: "Create a new area",
          }),
        ]);

      // All conditions pass (AlwaysVisible)
      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      const groups = await builder.buildButtonGroups("test:any-asset");

      expect(groups).toHaveLength(1);
      expect(groups[0].title).toBe("Creation");
      expect(groups[0].buttons).toHaveLength(3);

      // Verify all creation buttons are present with correct properties
      const taskButton = groups[0].buttons[0];
      expect(taskButton.label).toBe("Create Task");
      expect(taskButton.icon).toBe("plus-circle");
      expect(taskButton.tooltip).toBe("Create a new task");

      const projectButton = groups[0].buttons[1];
      expect(projectButton.label).toBe("Create Project");
      expect(projectButton.icon).toBe("folder-plus");
      expect(projectButton.tooltip).toBe("Create a new project");

      const areaButton = groups[0].buttons[2];
      expect(areaButton.label).toBe("Create Area");
      expect(areaButton.icon).toBe("layout");
      expect(areaButton.tooltip).toBe("Create a new area");
    });
  });

  /**
   * PlanTodayButton with UpdatePropertyAction Tests (Issue #1425)
   *
   * Tests for PlanTodayButton which sets ems:Effort_plannedStartTimestamp to today's start.
   * This is a Planning Button visible for any Effort NOT already planned for today.
   *
   * RDF Definition:
   * ```turtle
   * ems-ui:PlanTodayButton a exo-ui:Button ;
   *     rdfs:label "Plan on Today" ;
   *     exo-ui:Button_icon "calendar" ;
   *     exo-ui:Button_variant "warning" ;
   *     exo-ui:Button_group exo-ui:PlanningButtonGroup ;
   *     exo-ui:Button_order 10 ;
   *     exo-ui:Button_tooltip "Plan this effort for today" ;
   *     exo-ui:Button_action ems-ui:PlanTodayAction ;
   *     exo-ui:Button_condition ems-ui:CanPlanOnTodayCondition .
   *
   * ems-ui:PlanTodayAction a exo-ui:UpdatePropertyAction ;
   *     exo-ui:Action_targetProperty ems:Effort_plannedStartTimestamp ;
   *     exo-ui:Action_targetValue "{{todayStartTimestamp}}" ;
   *     exo-ui:Action_headless true .
   *
   * ems-ui:CanPlanOnTodayCondition a exo-ui:Condition ;
   *     exo-ui:Condition_sparql """
   *         ASK {
   *             ?asset a ems:Effort .
   *             FILTER NOT EXISTS {
   *                 ?asset ems:Effort_plannedStartTimestamp ?ts .
   *                 FILTER(STRSTARTS(STR(?ts), "{{today}}"))
   *             }
   *         }
   *     """ .
   * ```
   *
   * @see https://github.com/kitelev/exocortex/issues/1425
   */
  describe("PlanTodayButton with UpdatePropertyAction (Issue #1425)", () => {
    it("should load PlanTodayButton with warning variant and calendar icon from RDF", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#PlanningButtonGroup",
            label: "Planning",
            order: "3",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#PlanTodayButton",
            label: "Plan on Today",
            icon: "calendar",
            variant: "warning",
            order: "10",
            action: "https://exocortex.my/ontology/ems-ui#PlanTodayAction",
            condition: "https://exocortex.my/ontology/ems-ui#CanPlanOnTodayCondition",
            tooltip: "Plan this effort for today",
          }),
        ]);

      // Condition passes (effort NOT already planned for today)
      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      const groups = await builder.buildButtonGroups("test:unplanned-task");

      expect(groups).toHaveLength(1);
      expect(groups[0].id).toBe("https://exocortex.my/ontology/exo-ui#PlanningButtonGroup");
      expect(groups[0].title).toBe("Planning");
      expect(groups[0].buttons).toHaveLength(1);

      const planTodayButton = groups[0].buttons[0];
      expect(planTodayButton.label).toBe("Plan on Today");
      expect(planTodayButton.icon).toBe("calendar");
      expect(planTodayButton.variant).toBe("warning");
      expect(planTodayButton.tooltip).toBe("Plan this effort for today");
    });

    it("should hide PlanTodayButton when CanPlanOnTodayCondition is false (already planned for today)", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#PlanningButtonGroup",
            label: "Planning",
            order: "3",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#PlanTodayButton",
            label: "Plan on Today",
            icon: "calendar",
            variant: "warning",
            action: "https://exocortex.my/ontology/ems-ui#PlanTodayAction",
            condition: "https://exocortex.my/ontology/ems-ui#CanPlanOnTodayCondition",
          }),
        ]);

      // Condition fails (effort IS already planned for today)
      mockConditionEvaluator.evaluate.mockResolvedValue(false);

      const groups = await builder.buildButtonGroups("test:already-planned-task");

      // Group should be empty because PlanTodayButton is filtered out
      expect(groups).toHaveLength(0);
    });

    it("should execute PlanTodayAction through ActionInterpreter when clicked", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#PlanningButtonGroup",
            label: "Planning",
            order: "3",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#PlanTodayButton",
            label: "Plan on Today",
            action: "https://exocortex.my/ontology/ems-ui#PlanTodayAction",
            condition: "https://exocortex.my/ontology/ems-ui#CanPlanOnTodayCondition",
          }),
        ]);

      mockConditionEvaluator.evaluate.mockResolvedValue(true);
      mockActionInterpreter.execute.mockResolvedValue({
        success: true,
        refresh: true,
      });

      const assetUri = "https://exocortex.my/vault/unplanned-task.md";
      const groups = await builder.buildButtonGroups(assetUri);
      const planTodayButton = groups[0].buttons[0];

      // Click the PlanTodayButton
      await planTodayButton.onClick();

      // ActionInterpreter should be called with PlanTodayAction URI
      expect(mockActionInterpreter.execute).toHaveBeenCalledWith(
        "https://exocortex.my/ontology/ems-ui#PlanTodayAction",
        { currentAsset: assetUri },
      );
    });

    it("should evaluate CanPlanOnTodayCondition with correct asset URI", async () => {
      const assetUri = "https://exocortex.my/vault/my-effort.md";

      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#PlanningButtonGroup",
            label: "Planning",
            order: "3",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#PlanTodayButton",
            label: "Plan on Today",
            action: "https://exocortex.my/ontology/ems-ui#PlanTodayAction",
            condition: "https://exocortex.my/ontology/ems-ui#CanPlanOnTodayCondition",
          }),
        ]);

      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      await builder.buildButtonGroups(assetUri);

      // ConditionEvaluator should be called with CanPlanOnTodayCondition and asset URI
      expect(mockConditionEvaluator.evaluate).toHaveBeenCalledWith(
        "https://exocortex.my/ontology/ems-ui#CanPlanOnTodayCondition",
        assetUri,
      );
    });

    it("should show PlanTodayButton for Task that is NOT planned for today", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#PlanningButtonGroup",
            label: "Planning",
            order: "3",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#PlanTodayButton",
            label: "Plan on Today",
            icon: "calendar",
            variant: "warning",
            order: "10",
            action: "https://exocortex.my/ontology/ems-ui#PlanTodayAction",
            condition: "https://exocortex.my/ontology/ems-ui#CanPlanOnTodayCondition",
          }),
        ]);

      // CanPlanOnTodayCondition passes (task is NOT planned for today)
      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      const groups = await builder.buildButtonGroups("test:backlog-task");

      expect(groups).toHaveLength(1);
      expect(groups[0].buttons).toHaveLength(1);
      expect(groups[0].buttons[0].label).toBe("Plan on Today");
    });

    it("should show PlanTodayButton for Project that is NOT planned for today", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#PlanningButtonGroup",
            label: "Planning",
            order: "3",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#PlanTodayButton",
            label: "Plan on Today",
            icon: "calendar",
            variant: "warning",
            order: "10",
            action: "https://exocortex.my/ontology/ems-ui#PlanTodayAction",
            condition: "https://exocortex.my/ontology/ems-ui#CanPlanOnTodayCondition",
          }),
        ]);

      // CanPlanOnTodayCondition passes (project is NOT planned for today)
      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      const groups = await builder.buildButtonGroups("test:project");

      expect(groups).toHaveLength(1);
      expect(groups[0].buttons).toHaveLength(1);
      expect(groups[0].buttons[0].label).toBe("Plan on Today");
    });
  });

  /**
   * PlanEveningButton with UpdatePropertyAction Tests (Issue #1425)
   *
   * Tests for PlanEveningButton which sets ems:Effort_plannedStartTimestamp to 19:00 today.
   * This is a Planning Button visible for Task/Meeting with Backlog status.
   *
   * RDF Definition:
   * ```turtle
   * ems-ui:PlanEveningButton a exo-ui:Button ;
   *     rdfs:label "Plan for Evening (19:00)" ;
   *     exo-ui:Button_icon "moon" ;
   *     exo-ui:Button_variant "warning" ;
   *     exo-ui:Button_group exo-ui:PlanningButtonGroup ;
   *     exo-ui:Button_order 20 ;
   *     exo-ui:Button_tooltip "Plan this effort for this evening at 19:00" ;
   *     exo-ui:Button_action ems-ui:PlanEveningAction ;
   *     exo-ui:Button_condition ems-ui:CanPlanForEveningCondition .
   *
   * ems-ui:PlanEveningAction a exo-ui:UpdatePropertyAction ;
   *     exo-ui:Action_targetProperty ems:Effort_plannedStartTimestamp ;
   *     exo-ui:Action_targetValue "{{eveningTimestamp}}" ;
   *     exo-ui:Action_headless true .
   *
   * ems-ui:CanPlanForEveningCondition a exo-ui:Condition ;
   *     exo-ui:Condition_sparql """
   *         ASK {
   *             { ?asset a ems:Task } UNION { ?asset a ems:Meeting }
   *             ?asset ems:Effort_status ems:EffortStatusBacklog .
   *         }
   *     """ .
   * ```
   *
   * @see https://github.com/kitelev/exocortex/issues/1425
   */
  describe("PlanEveningButton with UpdatePropertyAction (Issue #1425)", () => {
    it("should load PlanEveningButton with warning variant and moon icon from RDF", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#PlanningButtonGroup",
            label: "Planning",
            order: "3",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#PlanEveningButton",
            label: "Plan for Evening (19:00)",
            icon: "moon",
            variant: "warning",
            order: "20",
            action: "https://exocortex.my/ontology/ems-ui#PlanEveningAction",
            condition: "https://exocortex.my/ontology/ems-ui#CanPlanForEveningCondition",
            tooltip: "Plan this effort for this evening at 19:00",
          }),
        ]);

      // Condition passes (Task/Meeting with Backlog status)
      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      const groups = await builder.buildButtonGroups("test:backlog-task");

      expect(groups).toHaveLength(1);
      expect(groups[0].id).toBe("https://exocortex.my/ontology/exo-ui#PlanningButtonGroup");
      expect(groups[0].title).toBe("Planning");
      expect(groups[0].buttons).toHaveLength(1);

      const planEveningButton = groups[0].buttons[0];
      expect(planEveningButton.label).toBe("Plan for Evening (19:00)");
      expect(planEveningButton.icon).toBe("moon");
      expect(planEveningButton.variant).toBe("warning");
      expect(planEveningButton.tooltip).toBe("Plan this effort for this evening at 19:00");
    });

    it("should hide PlanEveningButton when CanPlanForEveningCondition is false (not Backlog status)", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#PlanningButtonGroup",
            label: "Planning",
            order: "3",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#PlanEveningButton",
            label: "Plan for Evening (19:00)",
            icon: "moon",
            variant: "warning",
            action: "https://exocortex.my/ontology/ems-ui#PlanEveningAction",
            condition: "https://exocortex.my/ontology/ems-ui#CanPlanForEveningCondition",
          }),
        ]);

      // Condition fails (task is NOT in Backlog status)
      mockConditionEvaluator.evaluate.mockResolvedValue(false);

      const groups = await builder.buildButtonGroups("test:doing-task");

      // Group should be empty because PlanEveningButton is filtered out
      expect(groups).toHaveLength(0);
    });

    it("should execute PlanEveningAction through ActionInterpreter when clicked", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#PlanningButtonGroup",
            label: "Planning",
            order: "3",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#PlanEveningButton",
            label: "Plan for Evening (19:00)",
            action: "https://exocortex.my/ontology/ems-ui#PlanEveningAction",
            condition: "https://exocortex.my/ontology/ems-ui#CanPlanForEveningCondition",
          }),
        ]);

      mockConditionEvaluator.evaluate.mockResolvedValue(true);
      mockActionInterpreter.execute.mockResolvedValue({
        success: true,
        refresh: true,
      });

      const assetUri = "https://exocortex.my/vault/backlog-task.md";
      const groups = await builder.buildButtonGroups(assetUri);
      const planEveningButton = groups[0].buttons[0];

      // Click the PlanEveningButton
      await planEveningButton.onClick();

      // ActionInterpreter should be called with PlanEveningAction URI
      expect(mockActionInterpreter.execute).toHaveBeenCalledWith(
        "https://exocortex.my/ontology/ems-ui#PlanEveningAction",
        { currentAsset: assetUri },
      );
    });

    it("should evaluate CanPlanForEveningCondition with correct asset URI", async () => {
      const assetUri = "https://exocortex.my/vault/my-effort.md";

      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#PlanningButtonGroup",
            label: "Planning",
            order: "3",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#PlanEveningButton",
            label: "Plan for Evening (19:00)",
            action: "https://exocortex.my/ontology/ems-ui#PlanEveningAction",
            condition: "https://exocortex.my/ontology/ems-ui#CanPlanForEveningCondition",
          }),
        ]);

      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      await builder.buildButtonGroups(assetUri);

      // ConditionEvaluator should be called with CanPlanForEveningCondition and asset URI
      expect(mockConditionEvaluator.evaluate).toHaveBeenCalledWith(
        "https://exocortex.my/ontology/ems-ui#CanPlanForEveningCondition",
        assetUri,
      );
    });

    it("should show PlanEveningButton for Task with Backlog status", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#PlanningButtonGroup",
            label: "Planning",
            order: "3",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#PlanEveningButton",
            label: "Plan for Evening (19:00)",
            icon: "moon",
            variant: "warning",
            order: "20",
            action: "https://exocortex.my/ontology/ems-ui#PlanEveningAction",
            condition: "https://exocortex.my/ontology/ems-ui#CanPlanForEveningCondition",
          }),
        ]);

      // CanPlanForEveningCondition passes (Task with Backlog status)
      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      const groups = await builder.buildButtonGroups("test:backlog-task");

      expect(groups).toHaveLength(1);
      expect(groups[0].buttons).toHaveLength(1);
      expect(groups[0].buttons[0].label).toBe("Plan for Evening (19:00)");
    });

    it("should show PlanEveningButton for Meeting with Backlog status", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#PlanningButtonGroup",
            label: "Planning",
            order: "3",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#PlanEveningButton",
            label: "Plan for Evening (19:00)",
            icon: "moon",
            variant: "warning",
            order: "20",
            action: "https://exocortex.my/ontology/ems-ui#PlanEveningAction",
            condition: "https://exocortex.my/ontology/ems-ui#CanPlanForEveningCondition",
          }),
        ]);

      // CanPlanForEveningCondition passes (Meeting with Backlog status)
      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      const groups = await builder.buildButtonGroups("test:backlog-meeting");

      expect(groups).toHaveLength(1);
      expect(groups[0].buttons).toHaveLength(1);
      expect(groups[0].buttons[0].label).toBe("Plan for Evening (19:00)");
    });

    it("should hide PlanEveningButton for Project (only Task/Meeting allowed)", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#PlanningButtonGroup",
            label: "Planning",
            order: "3",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#PlanEveningButton",
            label: "Plan for Evening (19:00)",
            icon: "moon",
            variant: "warning",
            action: "https://exocortex.my/ontology/ems-ui#PlanEveningAction",
            condition: "https://exocortex.my/ontology/ems-ui#CanPlanForEveningCondition",
          }),
        ]);

      // Condition fails (Project is NOT Task/Meeting)
      mockConditionEvaluator.evaluate.mockResolvedValue(false);

      const groups = await builder.buildButtonGroups("test:backlog-project");

      // Group should be empty because PlanEveningButton is filtered out
      expect(groups).toHaveLength(0);
    });

    it("should show both PlanTodayButton and PlanEveningButton in PlanningButtonGroup", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#PlanningButtonGroup",
            label: "Planning",
            order: "3",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#PlanTodayButton",
            label: "Plan on Today",
            icon: "calendar",
            variant: "warning",
            order: "10",
            action: "https://exocortex.my/ontology/ems-ui#PlanTodayAction",
            condition: "https://exocortex.my/ontology/ems-ui#CanPlanOnTodayCondition",
          }),
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#PlanEveningButton",
            label: "Plan for Evening (19:00)",
            icon: "moon",
            variant: "warning",
            order: "20",
            action: "https://exocortex.my/ontology/ems-ui#PlanEveningAction",
            condition: "https://exocortex.my/ontology/ems-ui#CanPlanForEveningCondition",
          }),
        ]);

      // Both conditions pass (Task in Backlog, not yet planned for today)
      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      const groups = await builder.buildButtonGroups("test:backlog-task");

      expect(groups).toHaveLength(1);
      expect(groups[0].title).toBe("Planning");
      expect(groups[0].buttons).toHaveLength(2);
      // Buttons should be in order: Plan on Today (10), Plan for Evening (20)
      expect(groups[0].buttons[0].label).toBe("Plan on Today");
      expect(groups[0].buttons[1].label).toBe("Plan for Evening (19:00)");
    });

    it("should show PlanTodayButton but hide PlanEveningButton for ToDo Task (not Backlog)", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#PlanningButtonGroup",
            label: "Planning",
            order: "3",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#PlanTodayButton",
            label: "Plan on Today",
            icon: "calendar",
            variant: "warning",
            order: "10",
            action: "https://exocortex.my/ontology/ems-ui#PlanTodayAction",
            condition: "https://exocortex.my/ontology/ems-ui#CanPlanOnTodayCondition",
          }),
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#PlanEveningButton",
            label: "Plan for Evening (19:00)",
            icon: "moon",
            variant: "warning",
            order: "20",
            action: "https://exocortex.my/ontology/ems-ui#PlanEveningAction",
            condition: "https://exocortex.my/ontology/ems-ui#CanPlanForEveningCondition",
          }),
        ]);

      // For ToDo Task: CanPlanOnTodayCondition = true, CanPlanForEveningCondition = false
      mockConditionEvaluator.evaluate
        .mockResolvedValueOnce(true)   // CanPlanOnTodayCondition passes
        .mockResolvedValueOnce(false); // CanPlanForEveningCondition fails (not Backlog)

      const groups = await builder.buildButtonGroups("test:todo-task");

      expect(groups).toHaveLength(1);
      expect(groups[0].buttons).toHaveLength(1);
      expect(groups[0].buttons[0].label).toBe("Plan on Today");
    });
  });

  /**
   * ShiftForwardButton with CompositeAction Tests (Issue #1426)
   *
   * Tests for ShiftForwardButton which uses CompositeAction to shift
   * plannedStartTimestamp from today to tomorrow (next day).
   * This is a Planning Button visible for any Effort that is planned for today.
   *
   * RDF Definition:
   * ```turtle
   * ems-ui:ShiftForwardButton a exo-ui:Button ;
   *     rdfs:label "Shift Forward" ;
   *     exo-ui:Button_icon "chevron-right" ;
   *     exo-ui:Button_variant "warning" ;
   *     exo-ui:Button_group exo-ui:PlanningButtonGroup ;
   *     exo-ui:Button_order 30 ;
   *     exo-ui:Button_tooltip "Shift this effort to tomorrow" ;
   *     exo-ui:Button_action ems-ui:ShiftForwardAction ;
   *     exo-ui:Button_condition ems-ui:CanShiftForwardCondition .
   *
   * ems-ui:ShiftForwardAction a exo-ui:CompositeAction ;
   *     exo-ui:Action_actions (ems-ui:ClearPlannedStartTimestampAction ems-ui:SetTomorrowTimestampAction) ;
   *     exo-ui:Action_headless true .
   *
   * ems-ui:ClearPlannedStartTimestampAction a exo-ui:UpdatePropertyAction ;
   *     exo-ui:Action_targetProperty ems:Effort_plannedStartTimestamp ;
   *     exo-ui:Action_targetValue "" .
   *
   * ems-ui:SetTomorrowTimestampAction a exo-ui:UpdatePropertyAction ;
   *     exo-ui:Action_targetProperty ems:Effort_plannedStartTimestamp ;
   *     exo-ui:Action_targetValue "{{tomorrowStartTimestamp}}" .
   *
   * ems-ui:CanShiftForwardCondition a exo-ui:Condition ;
   *     exo-ui:Condition_sparql """
   *         ASK {
   *             ?asset a ems:Effort .
   *             ?asset ems:Effort_plannedStartTimestamp ?ts .
   *             FILTER(STRSTARTS(STR(?ts), "{{today}}"))
   *         }
   *     """ .
   * ```
   *
   * @see https://github.com/kitelev/exocortex/issues/1426
   */
  describe("ShiftForwardButton with CompositeAction (Issue #1426)", () => {
    it("should load ShiftForwardButton with warning variant and chevron-right icon from RDF", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#PlanningButtonGroup",
            label: "Planning",
            order: "3",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#ShiftForwardButton",
            label: "Shift Forward",
            icon: "chevron-right",
            variant: "warning",
            order: "30",
            action: "https://exocortex.my/ontology/ems-ui#ShiftForwardAction",
            condition: "https://exocortex.my/ontology/ems-ui#CanShiftForwardCondition",
            tooltip: "Shift this effort to tomorrow",
          }),
        ]);

      // Condition passes (effort IS planned for today)
      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      const groups = await builder.buildButtonGroups("test:today-planned-task");

      expect(groups).toHaveLength(1);
      expect(groups[0].id).toBe("https://exocortex.my/ontology/exo-ui#PlanningButtonGroup");
      expect(groups[0].title).toBe("Planning");
      expect(groups[0].buttons).toHaveLength(1);

      const shiftForwardButton = groups[0].buttons[0];
      expect(shiftForwardButton.label).toBe("Shift Forward");
      expect(shiftForwardButton.icon).toBe("chevron-right");
      expect(shiftForwardButton.variant).toBe("warning");
      expect(shiftForwardButton.tooltip).toBe("Shift this effort to tomorrow");
    });

    it("should hide ShiftForwardButton when CanShiftForwardCondition is false (not planned for today)", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#PlanningButtonGroup",
            label: "Planning",
            order: "3",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#ShiftForwardButton",
            label: "Shift Forward",
            icon: "chevron-right",
            variant: "warning",
            action: "https://exocortex.my/ontology/ems-ui#ShiftForwardAction",
            condition: "https://exocortex.my/ontology/ems-ui#CanShiftForwardCondition",
          }),
        ]);

      // Condition fails (effort is NOT planned for today)
      mockConditionEvaluator.evaluate.mockResolvedValue(false);

      const groups = await builder.buildButtonGroups("test:unplanned-task");

      // Group should be empty because ShiftForwardButton is filtered out
      expect(groups).toHaveLength(0);
    });

    it("should execute ShiftForwardAction (CompositeAction) through ActionInterpreter when clicked", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#PlanningButtonGroup",
            label: "Planning",
            order: "3",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#ShiftForwardButton",
            label: "Shift Forward",
            action: "https://exocortex.my/ontology/ems-ui#ShiftForwardAction",
            condition: "https://exocortex.my/ontology/ems-ui#CanShiftForwardCondition",
          }),
        ]);

      mockConditionEvaluator.evaluate.mockResolvedValue(true);
      mockActionInterpreter.execute.mockResolvedValue({
        success: true,
        refresh: true,
      });

      const assetUri = "https://exocortex.my/vault/today-task.md";
      const groups = await builder.buildButtonGroups(assetUri);
      const shiftForwardButton = groups[0].buttons[0];

      // Click the ShiftForwardButton
      await shiftForwardButton.onClick();

      // ActionInterpreter should be called with ShiftForwardAction URI
      expect(mockActionInterpreter.execute).toHaveBeenCalledWith(
        "https://exocortex.my/ontology/ems-ui#ShiftForwardAction",
        { currentAsset: assetUri },
      );
    });

    it("should evaluate CanShiftForwardCondition with correct asset URI", async () => {
      const assetUri = "https://exocortex.my/vault/my-effort.md";

      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#PlanningButtonGroup",
            label: "Planning",
            order: "3",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#ShiftForwardButton",
            label: "Shift Forward",
            action: "https://exocortex.my/ontology/ems-ui#ShiftForwardAction",
            condition: "https://exocortex.my/ontology/ems-ui#CanShiftForwardCondition",
          }),
        ]);

      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      await builder.buildButtonGroups(assetUri);

      // ConditionEvaluator should be called with CanShiftForwardCondition and asset URI
      expect(mockConditionEvaluator.evaluate).toHaveBeenCalledWith(
        "https://exocortex.my/ontology/ems-ui#CanShiftForwardCondition",
        assetUri,
      );
    });

    it("should show ShiftForwardButton for Task that IS planned for today", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#PlanningButtonGroup",
            label: "Planning",
            order: "3",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#ShiftForwardButton",
            label: "Shift Forward",
            icon: "chevron-right",
            variant: "warning",
            order: "30",
            action: "https://exocortex.my/ontology/ems-ui#ShiftForwardAction",
            condition: "https://exocortex.my/ontology/ems-ui#CanShiftForwardCondition",
          }),
        ]);

      // CanShiftForwardCondition passes (task IS planned for today)
      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      const groups = await builder.buildButtonGroups("test:today-task");

      expect(groups).toHaveLength(1);
      expect(groups[0].buttons).toHaveLength(1);
      expect(groups[0].buttons[0].label).toBe("Shift Forward");
    });

    it("should show ShiftForwardButton for Project that IS planned for today", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#PlanningButtonGroup",
            label: "Planning",
            order: "3",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#ShiftForwardButton",
            label: "Shift Forward",
            icon: "chevron-right",
            variant: "warning",
            order: "30",
            action: "https://exocortex.my/ontology/ems-ui#ShiftForwardAction",
            condition: "https://exocortex.my/ontology/ems-ui#CanShiftForwardCondition",
          }),
        ]);

      // CanShiftForwardCondition passes (project IS planned for today)
      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      const groups = await builder.buildButtonGroups("test:today-project");

      expect(groups).toHaveLength(1);
      expect(groups[0].buttons).toHaveLength(1);
      expect(groups[0].buttons[0].label).toBe("Shift Forward");
    });
  });

  /**
   * ShiftForwardButton integration with other Planning Buttons (Issue #1426)
   *
   * Tests for ShiftForwardButton appearing alongside PlanTodayButton and PlanEveningButton
   * in the PlanningButtonGroup based on different conditions.
   */
  describe("ShiftForwardButton integration with Planning Buttons (Issue #1426)", () => {
    it("should show all Planning buttons when asset has no planned timestamp and is in Backlog", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#PlanningButtonGroup",
            label: "Planning",
            order: "3",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#PlanTodayButton",
            label: "Plan on Today",
            icon: "calendar",
            variant: "warning",
            order: "10",
            action: "https://exocortex.my/ontology/ems-ui#PlanTodayAction",
            condition: "https://exocortex.my/ontology/ems-ui#CanPlanOnTodayCondition",
          }),
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#PlanEveningButton",
            label: "Plan for Evening (19:00)",
            icon: "moon",
            variant: "warning",
            order: "20",
            action: "https://exocortex.my/ontology/ems-ui#PlanEveningAction",
            condition: "https://exocortex.my/ontology/ems-ui#CanPlanForEveningCondition",
          }),
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#ShiftForwardButton",
            label: "Shift Forward",
            icon: "chevron-right",
            variant: "warning",
            order: "30",
            action: "https://exocortex.my/ontology/ems-ui#ShiftForwardAction",
            condition: "https://exocortex.my/ontology/ems-ui#CanShiftForwardCondition",
          }),
        ]);

      // All conditions pass for this scenario
      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      const groups = await builder.buildButtonGroups("test:backlog-task");

      expect(groups).toHaveLength(1);
      expect(groups[0].title).toBe("Planning");
      expect(groups[0].buttons).toHaveLength(3);
      // Buttons should be in order: Plan on Today (10), Plan for Evening (20), Shift Forward (30)
      expect(groups[0].buttons[0].label).toBe("Plan on Today");
      expect(groups[0].buttons[1].label).toBe("Plan for Evening (19:00)");
      expect(groups[0].buttons[2].label).toBe("Shift Forward");
    });

    it("should show only ShiftForwardButton when asset is planned for today (not Backlog)", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#PlanningButtonGroup",
            label: "Planning",
            order: "3",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#PlanTodayButton",
            label: "Plan on Today",
            icon: "calendar",
            variant: "warning",
            order: "10",
            action: "https://exocortex.my/ontology/ems-ui#PlanTodayAction",
            condition: "https://exocortex.my/ontology/ems-ui#CanPlanOnTodayCondition",
          }),
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#PlanEveningButton",
            label: "Plan for Evening (19:00)",
            icon: "moon",
            variant: "warning",
            order: "20",
            action: "https://exocortex.my/ontology/ems-ui#PlanEveningAction",
            condition: "https://exocortex.my/ontology/ems-ui#CanPlanForEveningCondition",
          }),
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#ShiftForwardButton",
            label: "Shift Forward",
            icon: "chevron-right",
            variant: "warning",
            order: "30",
            action: "https://exocortex.my/ontology/ems-ui#ShiftForwardAction",
            condition: "https://exocortex.my/ontology/ems-ui#CanShiftForwardCondition",
          }),
        ]);

      // For asset planned for today:
      // - CanPlanOnTodayCondition = false (already planned for today)
      // - CanPlanForEveningCondition = false (not Backlog)
      // - CanShiftForwardCondition = true (IS planned for today)
      mockConditionEvaluator.evaluate
        .mockResolvedValueOnce(false)  // CanPlanOnTodayCondition fails
        .mockResolvedValueOnce(false)  // CanPlanForEveningCondition fails
        .mockResolvedValueOnce(true);  // CanShiftForwardCondition passes

      const groups = await builder.buildButtonGroups("test:today-planned-task");

      expect(groups).toHaveLength(1);
      expect(groups[0].buttons).toHaveLength(1);
      expect(groups[0].buttons[0].label).toBe("Shift Forward");
    });

    it("should show PlanTodayButton but hide ShiftForwardButton when asset is not planned yet", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#PlanningButtonGroup",
            label: "Planning",
            order: "3",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#PlanTodayButton",
            label: "Plan on Today",
            icon: "calendar",
            variant: "warning",
            order: "10",
            action: "https://exocortex.my/ontology/ems-ui#PlanTodayAction",
            condition: "https://exocortex.my/ontology/ems-ui#CanPlanOnTodayCondition",
          }),
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#ShiftForwardButton",
            label: "Shift Forward",
            icon: "chevron-right",
            variant: "warning",
            order: "30",
            action: "https://exocortex.my/ontology/ems-ui#ShiftForwardAction",
            condition: "https://exocortex.my/ontology/ems-ui#CanShiftForwardCondition",
          }),
        ]);

      // For unplanned asset:
      // - CanPlanOnTodayCondition = true (not planned for today)
      // - CanShiftForwardCondition = false (not planned for today)
      mockConditionEvaluator.evaluate
        .mockResolvedValueOnce(true)   // CanPlanOnTodayCondition passes
        .mockResolvedValueOnce(false); // CanShiftForwardCondition fails

      const groups = await builder.buildButtonGroups("test:unplanned-task");

      expect(groups).toHaveLength(1);
      expect(groups[0].buttons).toHaveLength(1);
      expect(groups[0].buttons[0].label).toBe("Plan on Today");
    });
  });
});
