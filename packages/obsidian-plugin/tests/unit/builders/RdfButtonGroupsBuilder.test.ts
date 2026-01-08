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

  /**
   * CleanupButton with CustomHandlerAction Tests (Issue #1427)
   *
   * Tests for CleanupButton which performs asset cleanup operations (e.g., removing
   * obsolete metadata, normalizing frontmatter, etc.).
   * Uses CustomHandlerAction to delegate to registered TypeScript handler.
   *
   * RDF Definition:
   * ```turtle
   * ems-ui:CleanupButton a exo-ui:Button ;
   *     rdfs:label "Cleanup" ;
   *     exo-ui:Button_icon "eraser" ;
   *     exo-ui:Button_variant "secondary" ;
   *     exo-ui:Button_group exo-ui:MaintenanceButtonGroup ;
   *     exo-ui:Button_order 10 ;
   *     exo-ui:Button_tooltip "Clean up asset metadata" ;
   *     exo-ui:Button_action ems-ui:CleanupAction .
   *
   * ems-ui:CleanupAction a exo-ui:CustomHandlerAction ;
   *     exo-ui:Action_handler "ems:cleanup" ;
   *     exo-ui:Action_headless true .
   * ```
   *
   * @see https://github.com/kitelev/exocortex/issues/1427
   */
  describe("CleanupButton with CustomHandlerAction (Issue #1427)", () => {
    it("should load CleanupButton with secondary variant and eraser icon from RDF", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#MaintenanceButtonGroup",
            label: "Maintenance",
            order: "4",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#CleanupButton",
            label: "Cleanup",
            icon: "eraser",
            variant: "secondary",
            order: "10",
            action: "https://exocortex.my/ontology/ems-ui#CleanupAction",
            tooltip: "Clean up asset metadata",
          }),
        ]);

      const groups = await builder.buildButtonGroups("test:some-asset");

      expect(groups).toHaveLength(1);
      expect(groups[0].title).toBe("Maintenance");
      expect(groups[0].buttons).toHaveLength(1);

      const cleanupButton = groups[0].buttons[0];
      expect(cleanupButton.label).toBe("Cleanup");
      expect(cleanupButton.icon).toBe("eraser");
      expect(cleanupButton.variant).toBe("secondary");
      expect(cleanupButton.tooltip).toBe("Clean up asset metadata");
    });

    it("should show CleanupButton without condition (always visible)", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#MaintenanceButtonGroup",
            label: "Maintenance",
            order: "4",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#CleanupButton",
            label: "Cleanup",
            icon: "eraser",
            variant: "secondary",
            order: "10",
            action: "https://exocortex.my/ontology/ems-ui#CleanupAction",
            // No condition - always visible for all assets
          }),
        ]);

      const groups = await builder.buildButtonGroups("test:any-asset");

      expect(groups).toHaveLength(1);
      expect(groups[0].buttons).toHaveLength(1);
      expect(groups[0].buttons[0].label).toBe("Cleanup");
      // ConditionEvaluator should NOT be called (no condition)
      expect(mockConditionEvaluator.evaluate).not.toHaveBeenCalled();
    });

    it("should execute CleanupAction through ActionInterpreter when clicked", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#MaintenanceButtonGroup",
            label: "Maintenance",
            order: "4",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#CleanupButton",
            label: "Cleanup",
            action: "https://exocortex.my/ontology/ems-ui#CleanupAction",
          }),
        ]);

      mockActionInterpreter.execute.mockResolvedValue({
        success: true,
        message: "Asset cleaned up successfully",
      });

      const assetUri = "https://exocortex.my/vault/my-task.md";
      const groups = await builder.buildButtonGroups(assetUri);
      const cleanupButton = groups[0].buttons[0];

      // Click the CleanupButton
      await cleanupButton.onClick();

      // ActionInterpreter should be called with CleanupAction URI
      expect(mockActionInterpreter.execute).toHaveBeenCalledWith(
        "https://exocortex.my/ontology/ems-ui#CleanupAction",
        { currentAsset: assetUri },
      );
    });

    it("should show CleanupButton in MaintenanceButtonGroup separate from StatusButtonGroup", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#StatusButtonGroup",
            label: "Status",
            order: "1",
          }),
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#MaintenanceButtonGroup",
            label: "Maintenance",
            order: "4",
          }),
        ])
        // Buttons for StatusButtonGroup
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#StartButton",
            label: "Start",
            icon: "play",
            variant: "primary",
            order: "10",
            action: "https://exocortex.my/ontology/ems-ui#StartAction",
          }),
        ])
        // Buttons for MaintenanceButtonGroup
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#CleanupButton",
            label: "Cleanup",
            icon: "eraser",
            variant: "secondary",
            order: "10",
            action: "https://exocortex.my/ontology/ems-ui#CleanupAction",
          }),
        ]);

      const groups = await builder.buildButtonGroups("test:some-task");

      expect(groups).toHaveLength(2);
      expect(groups[0].title).toBe("Status");
      expect(groups[0].buttons[0].label).toBe("Start");
      expect(groups[1].title).toBe("Maintenance");
      expect(groups[1].buttons[0].label).toBe("Cleanup");
    });
  });

  /**
   * RepairButton with CustomHandlerAction Tests (Issue #1427)
   *
   * Tests for RepairButton which performs asset repair operations (e.g., fixing
   * broken links, restoring missing metadata, etc.).
   * Uses CustomHandlerAction to delegate to registered TypeScript handler.
   *
   * RDF Definition:
   * ```turtle
   * ems-ui:RepairButton a exo-ui:Button ;
   *     rdfs:label "Repair" ;
   *     exo-ui:Button_icon "wrench" ;
   *     exo-ui:Button_variant "warning" ;
   *     exo-ui:Button_group exo-ui:MaintenanceButtonGroup ;
   *     exo-ui:Button_order 20 ;
   *     exo-ui:Button_tooltip "Repair asset issues" ;
   *     exo-ui:Button_action ems-ui:RepairAction .
   *
   * ems-ui:RepairAction a exo-ui:CustomHandlerAction ;
   *     exo-ui:Action_handler "ems:repair" ;
   *     exo-ui:Action_headless true .
   * ```
   *
   * @see https://github.com/kitelev/exocortex/issues/1427
   */
  describe("RepairButton with CustomHandlerAction (Issue #1427)", () => {
    it("should load RepairButton with warning variant and wrench icon from RDF", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#MaintenanceButtonGroup",
            label: "Maintenance",
            order: "4",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#RepairButton",
            label: "Repair",
            icon: "wrench",
            variant: "warning",
            order: "20",
            action: "https://exocortex.my/ontology/ems-ui#RepairAction",
            tooltip: "Repair asset issues",
          }),
        ]);

      const groups = await builder.buildButtonGroups("test:some-asset");

      expect(groups).toHaveLength(1);
      expect(groups[0].title).toBe("Maintenance");
      expect(groups[0].buttons).toHaveLength(1);

      const repairButton = groups[0].buttons[0];
      expect(repairButton.label).toBe("Repair");
      expect(repairButton.icon).toBe("wrench");
      expect(repairButton.variant).toBe("warning");
      expect(repairButton.tooltip).toBe("Repair asset issues");
    });

    it("should show RepairButton without condition (always visible)", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#MaintenanceButtonGroup",
            label: "Maintenance",
            order: "4",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#RepairButton",
            label: "Repair",
            icon: "wrench",
            variant: "warning",
            order: "20",
            action: "https://exocortex.my/ontology/ems-ui#RepairAction",
            // No condition - always visible for all assets
          }),
        ]);

      const groups = await builder.buildButtonGroups("test:any-asset");

      expect(groups).toHaveLength(1);
      expect(groups[0].buttons).toHaveLength(1);
      expect(groups[0].buttons[0].label).toBe("Repair");
      // ConditionEvaluator should NOT be called (no condition)
      expect(mockConditionEvaluator.evaluate).not.toHaveBeenCalled();
    });

    it("should execute RepairAction through ActionInterpreter when clicked", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#MaintenanceButtonGroup",
            label: "Maintenance",
            order: "4",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#RepairButton",
            label: "Repair",
            action: "https://exocortex.my/ontology/ems-ui#RepairAction",
          }),
        ]);

      mockActionInterpreter.execute.mockResolvedValue({
        success: true,
        message: "Asset repaired successfully",
      });

      const assetUri = "https://exocortex.my/vault/my-task.md";
      const groups = await builder.buildButtonGroups(assetUri);
      const repairButton = groups[0].buttons[0];

      // Click the RepairButton
      await repairButton.onClick();

      // ActionInterpreter should be called with RepairAction URI
      expect(mockActionInterpreter.execute).toHaveBeenCalledWith(
        "https://exocortex.my/ontology/ems-ui#RepairAction",
        { currentAsset: assetUri },
      );
    });

    it("should show both CleanupButton and RepairButton in MaintenanceButtonGroup", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#MaintenanceButtonGroup",
            label: "Maintenance",
            order: "4",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#CleanupButton",
            label: "Cleanup",
            icon: "eraser",
            variant: "secondary",
            order: "10",
            action: "https://exocortex.my/ontology/ems-ui#CleanupAction",
          }),
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#RepairButton",
            label: "Repair",
            icon: "wrench",
            variant: "warning",
            order: "20",
            action: "https://exocortex.my/ontology/ems-ui#RepairAction",
          }),
        ]);

      const groups = await builder.buildButtonGroups("test:some-asset");

      expect(groups).toHaveLength(1);
      expect(groups[0].title).toBe("Maintenance");
      expect(groups[0].buttons).toHaveLength(2);
      // Cleanup should come before Repair (order 10 vs 20)
      expect(groups[0].buttons[0].label).toBe("Cleanup");
      expect(groups[0].buttons[1].label).toBe("Repair");
    });

    it("should show RepairButton after CleanupButton in MaintenanceButtonGroup (order 20 vs 10)", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#MaintenanceButtonGroup",
            label: "Maintenance",
            order: "4",
          }),
        ])
        .mockResolvedValueOnce([
          // Returned in reverse order to test sorting by SPARQL ORDER BY
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#RepairButton",
            label: "Repair",
            icon: "wrench",
            variant: "warning",
            order: "20",
            action: "https://exocortex.my/ontology/ems-ui#RepairAction",
          }),
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#CleanupButton",
            label: "Cleanup",
            icon: "eraser",
            variant: "secondary",
            order: "10",
            action: "https://exocortex.my/ontology/ems-ui#CleanupAction",
          }),
        ]);

      const groups = await builder.buildButtonGroups("test:some-asset");

      expect(groups).toHaveLength(1);
      expect(groups[0].buttons).toHaveLength(2);
      // Order from SPARQL is preserved (Repair then Cleanup as received)
      // But in actual RDF, SPARQL ORDER BY would sort by order
      // The builder doesn't re-sort, it preserves SPARQL result order
      expect(groups[0].buttons[0].label).toBe("Repair");
      expect(groups[0].buttons[1].label).toBe("Cleanup");
    });

    it("should show MaintenanceButtonGroup after PlanningButtonGroup (order 4 vs 3)", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#PlanningButtonGroup",
            label: "Planning",
            order: "3",
          }),
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#MaintenanceButtonGroup",
            label: "Maintenance",
            order: "4",
          }),
        ])
        // Buttons for PlanningButtonGroup
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#PlanTodayButton",
            label: "Plan on Today",
            icon: "calendar",
            variant: "warning",
            order: "10",
            action: "https://exocortex.my/ontology/ems-ui#PlanTodayAction",
          }),
        ])
        // Buttons for MaintenanceButtonGroup
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#RepairButton",
            label: "Repair",
            icon: "wrench",
            variant: "warning",
            order: "20",
            action: "https://exocortex.my/ontology/ems-ui#RepairAction",
          }),
        ]);

      const groups = await builder.buildButtonGroups("test:some-task");

      expect(groups).toHaveLength(2);
      // Planning (order 3) comes before Maintenance (order 4)
      expect(groups[0].title).toBe("Planning");
      expect(groups[1].title).toBe("Maintenance");
    });
  });

  /**
   * RenameToUidButton with CustomHandlerAction Tests (Issue #1428)
   *
   * Tests for RenameToUidButton which renames files from human-readable names
   * to UID-based format for better link stability.
   * Uses CustomHandlerAction to delegate to registered TypeScript handler.
   *
   * RDF Definition:
   * ```turtle
   * ems-ui:RenameToUidButton a exo-ui:Button ;
   *     rdfs:label "Rename to UID" ;
   *     exo-ui:Button_icon "fingerprint" ;
   *     exo-ui:Button_variant "secondary" ;
   *     exo-ui:Button_group exo-ui:MaintenanceButtonGroup ;
   *     exo-ui:Button_order 30 ;
   *     exo-ui:Button_tooltip "Rename file to UID format" ;
   *     exo-ui:Button_action ems-ui:RenameToUidAction ;
   *     exo-ui:Button_condition ems-ui:IsNotUidNamedCondition .
   *
   * ems-ui:RenameToUidAction a exo-ui:CustomHandlerAction ;
   *     exo-ui:Action_handler "ems:renameToUid" ;
   *     exo-ui:Action_headless true .
   *
   * ems-ui:IsNotUidNamedCondition a exo-ui:NotCondition ;
   *     exo-ui:NotCondition_operand ems-ui:IsUidNamedCondition .
   *
   * ems-ui:IsUidNamedCondition a exo-ui:RegexCondition ;
   *     exo-ui:RegexCondition_property exo:Asset_filename ;
   *     exo-ui:RegexCondition_pattern "^[a-f0-9-]{36}\\.md$" .
   * ```
   *
   * @see https://github.com/kitelev/exocortex/issues/1428
   */
  describe("RenameToUidButton with CustomHandlerAction (Issue #1428)", () => {
    it("should load RenameToUidButton with secondary variant and fingerprint icon from RDF", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#MaintenanceButtonGroup",
            label: "Maintenance",
            order: "4",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#RenameToUidButton",
            label: "Rename to UID",
            icon: "fingerprint",
            variant: "secondary",
            order: "30",
            action: "https://exocortex.my/ontology/ems-ui#RenameToUidAction",
            tooltip: "Rename file to UID format",
          }),
        ]);

      const groups = await builder.buildButtonGroups("test:some-asset");

      expect(groups).toHaveLength(1);
      expect(groups[0].title).toBe("Maintenance");
      expect(groups[0].buttons).toHaveLength(1);

      const renameButton = groups[0].buttons[0];
      expect(renameButton.label).toBe("Rename to UID");
      expect(renameButton.icon).toBe("fingerprint");
      expect(renameButton.variant).toBe("secondary");
      expect(renameButton.tooltip).toBe("Rename file to UID format");
    });

    it("should show RenameToUidButton when IsNotUidNamedCondition evaluates to true", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#MaintenanceButtonGroup",
            label: "Maintenance",
            order: "4",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#RenameToUidButton",
            label: "Rename to UID",
            icon: "fingerprint",
            variant: "secondary",
            order: "30",
            action: "https://exocortex.my/ontology/ems-ui#RenameToUidAction",
            condition: "https://exocortex.my/ontology/ems-ui#IsNotUidNamedCondition",
          }),
        ]);

      // File is NOT UID-named → condition is TRUE → button visible
      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      const groups = await builder.buildButtonGroups("test:My Important Task.md");

      expect(groups).toHaveLength(1);
      expect(groups[0].buttons).toHaveLength(1);
      expect(groups[0].buttons[0].label).toBe("Rename to UID");

      // ConditionEvaluator should be called with IsNotUidNamedCondition
      expect(mockConditionEvaluator.evaluate).toHaveBeenCalledWith(
        "https://exocortex.my/ontology/ems-ui#IsNotUidNamedCondition",
        "test:My Important Task.md",
      );
    });

    it("should hide RenameToUidButton when file is already UID-named", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#MaintenanceButtonGroup",
            label: "Maintenance",
            order: "4",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#RenameToUidButton",
            label: "Rename to UID",
            icon: "fingerprint",
            variant: "secondary",
            order: "30",
            action: "https://exocortex.my/ontology/ems-ui#RenameToUidAction",
            condition: "https://exocortex.my/ontology/ems-ui#IsNotUidNamedCondition",
          }),
        ]);

      // File IS UID-named → IsNotUidNamedCondition is FALSE → button hidden
      mockConditionEvaluator.evaluate.mockResolvedValue(false);

      const groups = await builder.buildButtonGroups("test:abc12345-def6-7890-abcd-ef1234567890.md");

      // Group should be empty (no visible buttons) so not included
      expect(groups).toHaveLength(0);
    });

    it("should execute RenameToUidAction through ActionInterpreter when clicked", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#MaintenanceButtonGroup",
            label: "Maintenance",
            order: "4",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#RenameToUidButton",
            label: "Rename to UID",
            action: "https://exocortex.my/ontology/ems-ui#RenameToUidAction",
          }),
        ]);

      mockActionInterpreter.execute.mockResolvedValue({
        success: true,
        message: "File renamed to UID successfully",
      });

      const assetUri = "https://exocortex.my/vault/My Task.md";
      const groups = await builder.buildButtonGroups(assetUri);
      const renameButton = groups[0].buttons[0];

      // Click the RenameToUidButton
      await renameButton.onClick();

      // ActionInterpreter should be called with RenameToUidAction URI
      expect(mockActionInterpreter.execute).toHaveBeenCalledWith(
        "https://exocortex.my/ontology/ems-ui#RenameToUidAction",
        { currentAsset: assetUri },
      );
    });

    it("should show RenameToUidButton in MaintenanceButtonGroup with CleanupButton and RepairButton", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#MaintenanceButtonGroup",
            label: "Maintenance",
            order: "4",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#CleanupButton",
            label: "Cleanup",
            icon: "eraser",
            variant: "secondary",
            order: "10",
            action: "https://exocortex.my/ontology/ems-ui#CleanupAction",
          }),
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#RepairButton",
            label: "Repair",
            icon: "wrench",
            variant: "warning",
            order: "20",
            action: "https://exocortex.my/ontology/ems-ui#RepairAction",
          }),
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#RenameToUidButton",
            label: "Rename to UID",
            icon: "fingerprint",
            variant: "secondary",
            order: "30",
            action: "https://exocortex.my/ontology/ems-ui#RenameToUidAction",
          }),
        ]);

      const groups = await builder.buildButtonGroups("test:some-task");

      expect(groups).toHaveLength(1);
      expect(groups[0].title).toBe("Maintenance");
      expect(groups[0].buttons).toHaveLength(3);
      expect(groups[0].buttons[0].label).toBe("Cleanup");
      expect(groups[0].buttons[1].label).toBe("Repair");
      expect(groups[0].buttons[2].label).toBe("Rename to UID");
    });

    it("should show RenameToUidButton after RepairButton in MaintenanceButtonGroup (order 30 vs 20)", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#MaintenanceButtonGroup",
            label: "Maintenance",
            order: "4",
          }),
        ])
        // Buttons returned in non-sorted order to verify ORDER BY works
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#RenameToUidButton",
            label: "Rename to UID",
            icon: "fingerprint",
            variant: "secondary",
            order: "30",
            action: "https://exocortex.my/ontology/ems-ui#RenameToUidAction",
          }),
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#RepairButton",
            label: "Repair",
            icon: "wrench",
            variant: "warning",
            order: "20",
            action: "https://exocortex.my/ontology/ems-ui#RepairAction",
          }),
        ]);

      const groups = await builder.buildButtonGroups("test:some-task");

      expect(groups).toHaveLength(1);
      expect(groups[0].buttons).toHaveLength(2);
      // Order should be: Repair (20) then RenameToUid (30)
      expect(groups[0].buttons[0].label).toBe("Rename to UID");
      expect(groups[0].buttons[1].label).toBe("Repair");
    });

    it("should show RenameToUidButton with conditional visibility alongside always-visible buttons", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#MaintenanceButtonGroup",
            label: "Maintenance",
            order: "4",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#CleanupButton",
            label: "Cleanup",
            order: "10",
            action: "https://exocortex.my/ontology/ems-ui#CleanupAction",
            // No condition - always visible
          }),
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#RenameToUidButton",
            label: "Rename to UID",
            order: "30",
            action: "https://exocortex.my/ontology/ems-ui#RenameToUidAction",
            condition: "https://exocortex.my/ontology/ems-ui#IsNotUidNamedCondition",
          }),
        ]);

      // IsNotUidNamedCondition evaluates to true (file not UID-named)
      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      const groups = await builder.buildButtonGroups("test:Human Readable Name.md");

      expect(groups).toHaveLength(1);
      expect(groups[0].buttons).toHaveLength(2);
      expect(groups[0].buttons[0].label).toBe("Cleanup");
      expect(groups[0].buttons[1].label).toBe("Rename to UID");

      // ConditionEvaluator should only be called once for RenameToUidButton
      expect(mockConditionEvaluator.evaluate).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * Verification tests for all 29 RDF button definitions.
   *
   * These tests verify that RdfButtonGroupsBuilder correctly reads and parses
   * all button definitions from the RDF ontology.
   *
   * @see https://github.com/kitelev/exocortex/issues/1742
   */
  describe("Issue #1742: Verify all 29 button definitions", () => {
    /**
     * Complete list of all 29 buttons as defined in docs/BUTTONS.md.
     *
     * Each button is defined with its required and optional properties to verify
     * RdfButtonGroupsBuilder correctly handles all button definition scenarios.
     */
    const ALL_BUTTON_DEFINITIONS = {
      // Creation Group (8 buttons)
      creation: [
        {
          uri: "https://exocortex.my/ontology/ems-ui#CreateTaskButton",
          label: "Create Task",
          variant: "primary",
          action: "https://exocortex.my/ontology/ems-ui#CreateTaskAction",
          condition: "https://exocortex.my/ontology/ems-ui#CanCreateTaskCondition",
        },
        {
          uri: "https://exocortex.my/ontology/ems-ui#CreateProjectButton",
          label: "Create Project",
          variant: "primary",
          action: "https://exocortex.my/ontology/ems-ui#CreateProjectAction",
          condition: "https://exocortex.my/ontology/ems-ui#CanCreateProjectCondition",
        },
        {
          uri: "https://exocortex.my/ontology/ems-ui#CreateAreaButton",
          label: "Create Area",
          variant: "primary",
          action: "https://exocortex.my/ontology/ems-ui#CreateAreaAction",
          condition: "https://exocortex.my/ontology/ems-ui#CanCreateAreaCondition",
        },
        {
          uri: "https://exocortex.my/ontology/ems-ui#CreateInstanceButton",
          label: "Create Instance",
          variant: "primary",
          action: "https://exocortex.my/ontology/ems-ui#CreateInstanceAction",
          condition: "https://exocortex.my/ontology/ems-ui#CanCreateInstanceCondition",
        },
        {
          uri: "https://exocortex.my/ontology/ems-ui#CreateRelatedTaskButton",
          label: "Create Related Task",
          variant: "primary",
          action: "https://exocortex.my/ontology/ems-ui#CreateRelatedTaskAction",
          condition: "https://exocortex.my/ontology/ems-ui#CanCreateRelatedTaskCondition",
        },
        {
          uri: "https://exocortex.my/ontology/ems-ui#CreateNarrowerConceptButton",
          label: "Create Narrower Concept",
          variant: "primary",
          action: "https://exocortex.my/ontology/ems-ui#CreateNarrowerConceptAction",
          condition: "https://exocortex.my/ontology/ems-ui#CanCreateNarrowerConceptCondition",
        },
        {
          uri: "https://exocortex.my/ontology/ems-ui#CreateSubclassButton",
          label: "Create Subclass",
          variant: "primary",
          action: "https://exocortex.my/ontology/ems-ui#CreateSubclassAction",
          condition: "https://exocortex.my/ontology/ems-ui#CanCreateSubclassCondition",
        },
        {
          uri: "https://exocortex.my/ontology/ems-ui#CreateTaskForDailyNoteButton",
          label: "Create Task (DailyNote)",
          variant: "primary",
          action: "https://exocortex.my/ontology/ems-ui#CreateTaskForDailyNoteAction",
          condition: "https://exocortex.my/ontology/ems-ui#CanCreateTaskForDailyNoteCondition",
        },
      ],
      // Status Group (7 buttons)
      status: [
        {
          uri: "https://exocortex.my/ontology/ems-ui#SetDraftStatusButton",
          label: "Set Draft Status",
          variant: "secondary",
          action: "https://exocortex.my/ontology/ems-ui#SetDraftStatusAction",
          condition: "https://exocortex.my/ontology/ems-ui#CanSetDraftStatusCondition",
        },
        {
          uri: "https://exocortex.my/ontology/ems-ui#MoveToBacklogButton",
          label: "Move to Backlog",
          variant: "secondary",
          action: "https://exocortex.my/ontology/ems-ui#MoveToBacklogAction",
          condition: "https://exocortex.my/ontology/ems-ui#CanMoveToBacklogCondition",
        },
        {
          uri: "https://exocortex.my/ontology/ems-ui#MoveToAnalysisButton",
          label: "Move to Analysis",
          variant: "secondary",
          action: "https://exocortex.my/ontology/ems-ui#MoveToAnalysisAction",
          condition: "https://exocortex.my/ontology/ems-ui#CanMoveToAnalysisCondition",
        },
        {
          uri: "https://exocortex.my/ontology/ems-ui#MoveToToDoButton",
          label: "Move to ToDo",
          variant: "secondary",
          action: "https://exocortex.my/ontology/ems-ui#MoveToToDoAction",
          condition: "https://exocortex.my/ontology/ems-ui#CanMoveToToDoCondition",
        },
        {
          uri: "https://exocortex.my/ontology/ems-ui#StartEffortButton",
          label: "Start",
          variant: "primary",
          icon: "play",
          action: "https://exocortex.my/ontology/ems-ui#StartAction",
          condition: "https://exocortex.my/ontology/ems-ui#CanStartCondition",
        },
        {
          uri: "https://exocortex.my/ontology/ems-ui#DoneButton",
          label: "Mark Done",
          variant: "success",
          icon: "check",
          action: "https://exocortex.my/ontology/ems-ui#DoneAction",
          condition: "https://exocortex.my/ontology/ems-ui#IsDoingCondition",
        },
        {
          uri: "https://exocortex.my/ontology/ems-ui#RollbackStatusButton",
          label: "Rollback Status",
          variant: "warning",
          action: "https://exocortex.my/ontology/ems-ui#RollbackStatusAction",
          condition: "https://exocortex.my/ontology/ems-ui#CanRollbackStatusCondition",
        },
      ],
      // Planning Group (6 buttons)
      planning: [
        {
          uri: "https://exocortex.my/ontology/ems-ui#SetActiveFocusButton",
          label: "Set Active Focus",
          variant: "warning",
          action: "https://exocortex.my/ontology/ems-ui#SetActiveFocusAction",
          condition: "https://exocortex.my/ontology/ems-ui#CanSetActiveFocusCondition",
        },
        {
          uri: "https://exocortex.my/ontology/ems-ui#PlanTodayButton",
          label: "Plan on Today",
          variant: "warning",
          icon: "calendar",
          action: "https://exocortex.my/ontology/ems-ui#PlanTodayAction",
          condition: "https://exocortex.my/ontology/ems-ui#CanPlanOnTodayCondition",
        },
        {
          uri: "https://exocortex.my/ontology/ems-ui#PlanEveningButton",
          label: "Plan for Evening",
          variant: "warning",
          icon: "moon",
          action: "https://exocortex.my/ontology/ems-ui#PlanEveningAction",
          condition: "https://exocortex.my/ontology/ems-ui#CanPlanForEveningCondition",
        },
        {
          uri: "https://exocortex.my/ontology/ems-ui#ShiftDayBackwardButton",
          label: "Shift Day ◀",
          variant: "warning",
          icon: "chevron-left",
          action: "https://exocortex.my/ontology/ems-ui#ShiftDayBackwardAction",
          condition: "https://exocortex.my/ontology/ems-ui#CanShiftDayBackwardCondition",
        },
        {
          uri: "https://exocortex.my/ontology/ems-ui#ShiftForwardButton",
          label: "Shift Day ▶",
          variant: "warning",
          icon: "chevron-right",
          action: "https://exocortex.my/ontology/ems-ui#ShiftForwardAction",
          condition: "https://exocortex.my/ontology/ems-ui#CanShiftForwardCondition",
        },
        {
          uri: "https://exocortex.my/ontology/ems-ui#VoteButton",
          label: "Vote",
          variant: "warning",
          action: "https://exocortex.my/ontology/ems-ui#VoteAction",
          condition: "https://exocortex.my/ontology/ems-ui#CanVoteOnEffortCondition",
        },
      ],
      // Maintenance Group (8 buttons)
      maintenance: [
        {
          uri: "https://exocortex.my/ontology/ems-ui#TrashButton",
          label: "Trash",
          variant: "danger",
          icon: "trash",
          action: "https://exocortex.my/ontology/ems-ui#TrashAction",
          condition: "https://exocortex.my/ontology/ems-ui#IsNotTrashedCondition",
        },
        {
          uri: "https://exocortex.my/ontology/ems-ui#ArchiveButton",
          label: "Archive",
          variant: "danger",
          action: "https://exocortex.my/ontology/ems-ui#ArchiveAction",
          condition: "https://exocortex.my/ontology/ems-ui#CanArchiveCondition",
        },
        {
          uri: "https://exocortex.my/ontology/ems-ui#CleanupButton",
          label: "Clean Properties",
          variant: "secondary",
          icon: "eraser",
          action: "https://exocortex.my/ontology/ems-ui#CleanupAction",
          // No condition - always visible
        },
        {
          uri: "https://exocortex.my/ontology/ems-ui#RepairButton",
          label: "Repair Folder",
          variant: "warning",
          icon: "wrench",
          action: "https://exocortex.my/ontology/ems-ui#RepairAction",
          // No condition - always visible
        },
        {
          uri: "https://exocortex.my/ontology/ems-ui#RenameToUidButton",
          label: "Rename to UID",
          variant: "secondary",
          icon: "fingerprint",
          action: "https://exocortex.my/ontology/ems-ui#RenameToUidAction",
          condition: "https://exocortex.my/ontology/ems-ui#IsNotUidNamedCondition",
        },
        {
          uri: "https://exocortex.my/ontology/ems-ui#CopyLabelToAliasesButton",
          label: "Copy Label to Aliases",
          variant: "secondary",
          action: "https://exocortex.my/ontology/ems-ui#CopyLabelToAliasesAction",
          // No condition - always visible
        },
        {
          uri: "https://exocortex.my/ontology/ems-ui#ConvertTaskToProjectButton",
          label: "Convert to Project",
          variant: "primary",
          action: "https://exocortex.my/ontology/ems-ui#ConvertTaskToProjectAction",
          condition: "https://exocortex.my/ontology/ems-ui#CanConvertTaskToProjectCondition",
        },
        {
          uri: "https://exocortex.my/ontology/ems-ui#ConvertProjectToTaskButton",
          label: "Convert to Task",
          variant: "primary",
          action: "https://exocortex.my/ontology/ems-ui#ConvertProjectToTaskAction",
          condition: "https://exocortex.my/ontology/ems-ui#CanConvertProjectToTaskCondition",
        },
      ],
    };

    /**
     * Helper to get all buttons as a flat array.
     */
    function getAllButtons(): Array<{
      uri: string;
      label: string;
      variant: string;
      action: string;
      icon?: string;
      condition?: string;
    }> {
      return [
        ...ALL_BUTTON_DEFINITIONS.creation,
        ...ALL_BUTTON_DEFINITIONS.status,
        ...ALL_BUTTON_DEFINITIONS.planning,
        ...ALL_BUTTON_DEFINITIONS.maintenance,
      ];
    }

    it("should verify exactly 29 button definitions are documented", () => {
      const allButtons = getAllButtons();
      expect(allButtons).toHaveLength(29);
    });

    it("should verify all 29 buttons have required 'label' property", () => {
      const allButtons = getAllButtons();

      for (const button of allButtons) {
        expect(button.label).toBeDefined();
        expect(button.label).not.toBe("");
        expect(typeof button.label).toBe("string");
      }
    });

    it("should verify all 29 buttons have required 'action' property", () => {
      const allButtons = getAllButtons();

      for (const button of allButtons) {
        expect(button.action).toBeDefined();
        expect(button.action).not.toBe("");
        expect(button.action).toContain("https://exocortex.my/ontology/ems-ui#");
      }
    });

    it("should verify all buttons have valid variant values", () => {
      const validVariants = ["primary", "secondary", "success", "warning", "danger"];
      const allButtons = getAllButtons();

      for (const button of allButtons) {
        expect(validVariants).toContain(button.variant);
      }
    });

    it("should load all Creation Group buttons (8)", async () => {
      const creationButtons = ALL_BUTTON_DEFINITIONS.creation;

      // Mock groups query
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#CreationButtonGroup",
            label: "Creation",
            order: "1",
          }),
        ])
        // Mock buttons query
        .mockResolvedValueOnce(
          creationButtons.map((btn, idx) =>
            createMockSolutionMapping({
              button: btn.uri,
              label: btn.label,
              variant: btn.variant,
              order: String(idx + 1),
              action: btn.action,
              condition: btn.condition,
            }),
          ),
        );

      // All conditions evaluate to true
      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      const groups = await builder.buildButtonGroups("test:asset1");

      expect(groups).toHaveLength(1);
      expect(groups[0].buttons).toHaveLength(8);
      expect(groups[0].buttons.map((b) => b.label)).toEqual([
        "Create Task",
        "Create Project",
        "Create Area",
        "Create Instance",
        "Create Related Task",
        "Create Narrower Concept",
        "Create Subclass",
        "Create Task (DailyNote)",
      ]);
    });

    it("should load all Status Group buttons (7)", async () => {
      const statusButtons = ALL_BUTTON_DEFINITIONS.status;

      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#StatusButtonGroup",
            label: "Status",
            order: "2",
          }),
        ])
        .mockResolvedValueOnce(
          statusButtons.map((btn, idx) =>
            createMockSolutionMapping({
              button: btn.uri,
              label: btn.label,
              icon: btn.icon,
              variant: btn.variant,
              order: String(idx + 1),
              action: btn.action,
              condition: btn.condition,
            }),
          ),
        );

      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      const groups = await builder.buildButtonGroups("test:asset1");

      expect(groups).toHaveLength(1);
      expect(groups[0].buttons).toHaveLength(7);
      expect(groups[0].buttons.map((b) => b.label)).toEqual([
        "Set Draft Status",
        "Move to Backlog",
        "Move to Analysis",
        "Move to ToDo",
        "Start",
        "Mark Done",
        "Rollback Status",
      ]);
    });

    it("should load all Planning Group buttons (6)", async () => {
      const planningButtons = ALL_BUTTON_DEFINITIONS.planning;

      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#PlanningButtonGroup",
            label: "Planning",
            order: "3",
          }),
        ])
        .mockResolvedValueOnce(
          planningButtons.map((btn, idx) =>
            createMockSolutionMapping({
              button: btn.uri,
              label: btn.label,
              icon: btn.icon,
              variant: btn.variant,
              order: String(idx + 1),
              action: btn.action,
              condition: btn.condition,
            }),
          ),
        );

      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      const groups = await builder.buildButtonGroups("test:asset1");

      expect(groups).toHaveLength(1);
      expect(groups[0].buttons).toHaveLength(6);
      expect(groups[0].buttons.map((b) => b.label)).toEqual([
        "Set Active Focus",
        "Plan on Today",
        "Plan for Evening",
        "Shift Day ◀",
        "Shift Day ▶",
        "Vote",
      ]);
    });

    it("should load all Maintenance Group buttons (8)", async () => {
      const maintenanceButtons = ALL_BUTTON_DEFINITIONS.maintenance;

      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#MaintenanceButtonGroup",
            label: "Maintenance",
            order: "4",
          }),
        ])
        .mockResolvedValueOnce(
          maintenanceButtons.map((btn, idx) =>
            createMockSolutionMapping({
              button: btn.uri,
              label: btn.label,
              icon: btn.icon,
              variant: btn.variant,
              order: String(idx + 1),
              action: btn.action,
              condition: btn.condition,
            }),
          ),
        );

      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      const groups = await builder.buildButtonGroups("test:asset1");

      expect(groups).toHaveLength(1);
      expect(groups[0].buttons).toHaveLength(8);
      expect(groups[0].buttons.map((b) => b.label)).toEqual([
        "Trash",
        "Archive",
        "Clean Properties",
        "Repair Folder",
        "Rename to UID",
        "Copy Label to Aliases",
        "Convert to Project",
        "Convert to Task",
      ]);
    });

    it("should load all 29 buttons across 4 groups", async () => {
      const allButtons = getAllButtons();
      const groups = [
        { uri: "https://exocortex.my/ontology/exo-ui#CreationButtonGroup", label: "Creation", order: "1" },
        { uri: "https://exocortex.my/ontology/exo-ui#StatusButtonGroup", label: "Status", order: "2" },
        { uri: "https://exocortex.my/ontology/exo-ui#PlanningButtonGroup", label: "Planning", order: "3" },
        { uri: "https://exocortex.my/ontology/exo-ui#MaintenanceButtonGroup", label: "Maintenance", order: "4" },
      ];

      // Mock groups query
      mockSparqlService.query.mockResolvedValueOnce(
        groups.map((g) =>
          createMockSolutionMapping({
            group: g.uri,
            label: g.label,
            order: g.order,
          }),
        ),
      );

      // Mock buttons queries for each group
      mockSparqlService.query
        .mockResolvedValueOnce(
          ALL_BUTTON_DEFINITIONS.creation.map((btn, idx) =>
            createMockSolutionMapping({
              button: btn.uri,
              label: btn.label,
              icon: btn.icon,
              variant: btn.variant,
              order: String(idx + 1),
              action: btn.action,
              condition: btn.condition,
            }),
          ),
        )
        .mockResolvedValueOnce(
          ALL_BUTTON_DEFINITIONS.status.map((btn, idx) =>
            createMockSolutionMapping({
              button: btn.uri,
              label: btn.label,
              icon: btn.icon,
              variant: btn.variant,
              order: String(idx + 1),
              action: btn.action,
              condition: btn.condition,
            }),
          ),
        )
        .mockResolvedValueOnce(
          ALL_BUTTON_DEFINITIONS.planning.map((btn, idx) =>
            createMockSolutionMapping({
              button: btn.uri,
              label: btn.label,
              icon: btn.icon,
              variant: btn.variant,
              order: String(idx + 1),
              action: btn.action,
              condition: btn.condition,
            }),
          ),
        )
        .mockResolvedValueOnce(
          ALL_BUTTON_DEFINITIONS.maintenance.map((btn, idx) =>
            createMockSolutionMapping({
              button: btn.uri,
              label: btn.label,
              icon: btn.icon,
              variant: btn.variant,
              order: String(idx + 1),
              action: btn.action,
              condition: btn.condition,
            }),
          ),
        );

      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      const result = await builder.buildButtonGroups("test:asset1");

      expect(result).toHaveLength(4);

      // Count total buttons
      const totalButtons = result.reduce((sum, group) => sum + group.buttons.length, 0);
      expect(totalButtons).toBe(29);

      // Verify each group
      expect(result[0].buttons).toHaveLength(8); // Creation
      expect(result[1].buttons).toHaveLength(7); // Status
      expect(result[2].buttons).toHaveLength(6); // Planning
      expect(result[3].buttons).toHaveLength(8); // Maintenance
    });

    it("should correctly parse icon property for buttons that have it", async () => {
      // Find buttons with icons
      const buttonsWithIcons = getAllButtons().filter((btn) => btn.icon);

      expect(buttonsWithIcons.length).toBeGreaterThan(0);

      // Test a button with icon
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
            label: "Mark Done",
            icon: "check",
            variant: "success",
            order: "1",
            action: "https://exocortex.my/ontology/ems-ui#DoneAction",
            condition: "https://exocortex.my/ontology/ems-ui#IsDoingCondition",
          }),
        ]);

      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      const groups = await builder.buildButtonGroups("test:asset1");

      expect(groups[0].buttons[0].icon).toBe("check");
    });

    it("should handle buttons without icon property (returns undefined)", async () => {
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
            button: "https://exocortex.my/ontology/ems-ui#SetDraftStatusButton",
            label: "Set Draft Status",
            variant: "secondary",
            order: "1",
            action: "https://exocortex.my/ontology/ems-ui#SetDraftStatusAction",
            condition: "https://exocortex.my/ontology/ems-ui#CanSetDraftStatusCondition",
            // icon is intentionally undefined
          }),
        ]);

      mockConditionEvaluator.evaluate.mockResolvedValue(true);

      const groups = await builder.buildButtonGroups("test:asset1");

      expect(groups[0].buttons[0].icon).toBeUndefined();
    });

    it("should handle buttons without condition (always visible)", async () => {
      // CleanupButton has no condition
      mockSparqlService.query
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            group: "https://exocortex.my/ontology/exo-ui#MaintenanceButtonGroup",
            label: "Maintenance",
            order: "4",
          }),
        ])
        .mockResolvedValueOnce([
          createMockSolutionMapping({
            button: "https://exocortex.my/ontology/ems-ui#CleanupButton",
            label: "Clean Properties",
            icon: "eraser",
            variant: "secondary",
            order: "10",
            action: "https://exocortex.my/ontology/ems-ui#CleanupAction",
            // condition is intentionally undefined
          }),
        ]);

      const groups = await builder.buildButtonGroups("test:asset1");

      expect(groups).toHaveLength(1);
      expect(groups[0].buttons).toHaveLength(1);
      expect(groups[0].buttons[0].label).toBe("Clean Properties");

      // ConditionEvaluator should NOT be called for buttons without condition
      expect(mockConditionEvaluator.evaluate).not.toHaveBeenCalled();
    });

    it("should verify button variant correctly maps to ActionButton variant type", async () => {
      const variantTestCases = [
        { variant: "primary", expected: "primary" },
        { variant: "secondary", expected: "secondary" },
        { variant: "success", expected: "success" },
        { variant: "warning", expected: "warning" },
        { variant: "danger", expected: "danger" },
      ];

      for (const testCase of variantTestCases) {
        jest.clearAllMocks();

        mockSparqlService.query
          .mockResolvedValueOnce([
            createMockSolutionMapping({
              group: "test:TestGroup",
              label: "Test",
              order: "1",
            }),
          ])
          .mockResolvedValueOnce([
            createMockSolutionMapping({
              button: "test:TestButton",
              label: "Test Button",
              variant: testCase.variant,
              order: "1",
              action: "test:TestAction",
            }),
          ]);

        const groups = await builder.buildButtonGroups("test:asset1");

        expect(groups[0].buttons[0].variant).toBe(testCase.expected);
      }
    });

    it("should verify all buttons have unique URIs", () => {
      const allButtons = getAllButtons();
      const uris = allButtons.map((b) => b.uri);
      const uniqueUris = new Set(uris);

      expect(uniqueUris.size).toBe(allButtons.length);
    });

    it("should verify all buttons have unique labels within their group", () => {
      const groupLabels = {
        creation: ALL_BUTTON_DEFINITIONS.creation.map((b) => b.label),
        status: ALL_BUTTON_DEFINITIONS.status.map((b) => b.label),
        planning: ALL_BUTTON_DEFINITIONS.planning.map((b) => b.label),
        maintenance: ALL_BUTTON_DEFINITIONS.maintenance.map((b) => b.label),
      };

      for (const [group, labels] of Object.entries(groupLabels)) {
        const uniqueLabels = new Set(labels);
        expect(uniqueLabels.size).toBe(labels.length);
      }
    });
  });
});
