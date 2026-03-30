import {
  isCommandFrontmatter,
  isPreconditionFrontmatter,
  isGroundingFrontmatter,
  isCommandBindingFrontmatter,
} from "../../../../src/domain/models/CommandDefinition";
import { GroundingType } from "../../../../src/domain/constants/GroundingType";

describe("CommandDefinition", () => {
  describe("domain model structure", () => {
    it("should represent minimal command with required fields", () => {
      const cmd = {
        id: "cmd-remove-start",
        name: "Remove start timestamp",
        grounding: {
          id: "gnd-remove-start",
          label: "Delete startTimestamp",
          type: GroundingType.PROPERTY_DELETE,
          targetProperty: "ems__Effort_startTimestamp",
        },
      };

      expect(cmd.id).toBe("cmd-remove-start");
      expect(cmd.grounding.type).toBe("property_delete");
    });

    it("should represent full command with all optional fields", () => {
      const cmd = {
        id: "cmd-remove-start",
        name: "Remove start timestamp",
        icon: "clock-x",
        precondition: {
          id: "pre-has-start",
          label: "Has start timestamp",
          sparqlAsk: "ASK { $target ems:Effort_startTimestamp ?ts }",
        },
        grounding: {
          id: "gnd-remove-start",
          label: "Delete startTimestamp",
          type: GroundingType.PROPERTY_DELETE,
          targetProperty: "ems__Effort_startTimestamp",
        },
        confirmMessage: "Remove start timestamp?",
        successMessage: "Start timestamp removed",
        category: "maintenance",
      };

      expect(cmd.icon).toBe("clock-x");
      expect(cmd.precondition.sparqlAsk).toContain("ASK");
      expect(cmd.category).toBe("maintenance");
    });
  });

  describe("PreconditionDefinition", () => {
    it("should represent SPARQL ASK precondition", () => {
      const pre = {
        id: "pre-has-start",
        label: "Asset has startTimestamp",
        sparqlAsk:
          "PREFIX ems: <https://exocortex.my/ontology/ems#> ASK { $target ems:Effort_startTimestamp ?ts . }",
      };

      expect(pre.sparqlAsk).toContain("ASK");
    });
  });

  describe("GroundingDefinition variants", () => {
    it("should represent property_delete grounding", () => {
      const gnd = {
        id: "gnd-remove-start",
        label: "Delete startTimestamp",
        type: GroundingType.PROPERTY_DELETE,
        targetProperty: "ems__Effort_startTimestamp",
      };

      expect(gnd.type).toBe(GroundingType.PROPERTY_DELETE);
      expect(gnd.targetProperty).toBe("ems__Effort_startTimestamp");
    });

    it("should represent property_set grounding", () => {
      const gnd = {
        id: "gnd-set-status",
        label: "Set status to Doing",
        type: GroundingType.PROPERTY_SET,
        targetProperty: "ems__Effort_status",
        targetValue: '"[[ems__EffortStatusDoing]]"',
      };

      expect(gnd.type).toBe(GroundingType.PROPERTY_SET);
      expect(gnd.targetValue).toContain("EffortStatusDoing");
    });

    it("should represent sparql_update grounding", () => {
      const gnd = {
        id: "gnd-sparql",
        label: "SPARQL update",
        type: GroundingType.SPARQL_UPDATE,
        sparqlUpdate:
          "DELETE { $target ems:Effort_startTimestamp ?ts } WHERE { $target ems:Effort_startTimestamp ?ts }",
      };

      expect(gnd.type).toBe(GroundingType.SPARQL_UPDATE);
      expect(gnd.sparqlUpdate).toContain("DELETE");
    });

    it("should represent composite grounding with steps", () => {
      const step1 = {
        id: "gnd-set-status",
        label: "Set status",
        type: GroundingType.PROPERTY_SET,
        targetProperty: "ems__Effort_status",
        targetValue: '"[[ems__EffortStatusDoing]]"',
      };

      const step2 = {
        id: "gnd-set-start",
        label: "Set start timestamp",
        type: GroundingType.PROPERTY_SET,
        targetProperty: "ems__Effort_startTimestamp",
        targetValue: "$now",
      };

      const composite = {
        id: "gnd-composite",
        label: "Start effort",
        type: GroundingType.COMPOSITE,
        steps: [step1, step2],
      };

      expect(composite.type).toBe(GroundingType.COMPOSITE);
      expect(composite.steps).toHaveLength(2);
    });

    it("should represent service_call grounding", () => {
      const gnd = {
        id: "gnd-service",
        label: "Call service",
        type: GroundingType.SERVICE_CALL,
      };

      expect(gnd.type).toBe(GroundingType.SERVICE_CALL);
    });
  });

  describe("CommandBindingDefinition", () => {
    it("should represent binding with targetClass", () => {
      const binding = {
        id: "bind-remove-start-tasks",
        label: "Remove start for all tasks",
        commandRef: "cmd-remove-start",
        targetClass: "ems__Task",
      };

      expect(binding.targetClass).toBe("ems__Task");
    });

    it("should represent binding with targetPrototype and display options", () => {
      const binding = {
        id: "bind-remove-start-pokurit",
        label: "Remove start for Pokurit",
        commandRef: "cmd-remove-start",
        targetPrototype: "a717a21b-a960-4795-9caa-04aeaba730ee",
        position: "inline",
        order: 50,
        group: "maintenance",
      };

      expect(binding.targetPrototype).toBe("a717a21b-a960-4795-9caa-04aeaba730ee");
      expect(binding.position).toBe("inline");
      expect(binding.order).toBe(50);
    });

    it("should represent binding with targetAsset", () => {
      const binding = {
        id: "bind-specific",
        label: "Binding for specific asset",
        commandRef: "cmd-remove-start",
        targetAsset: "some-asset-uid",
      };

      expect(binding.targetAsset).toBe("some-asset-uid");
    });

    it("should represent binding with overriding precondition", () => {
      const binding = {
        id: "bind-with-pre",
        label: "Binding with custom precondition",
        commandRef: "cmd-start",
        targetClass: "ems__Task",
        precondition: {
          id: "pre-task-backlog",
          label: "Task is in Backlog",
          sparqlAsk: "ASK { $target ems:Effort_status ems:EffortStatusBacklog }",
        },
      };

      expect(binding.precondition).toBeDefined();
      expect(binding.precondition.sparqlAsk).toContain("Backlog");
    });
  });

  describe("type guards", () => {
    describe("isCommandFrontmatter", () => {
      it("should return true for valid command frontmatter (array class)", () => {
        const fm = {
          exo__Instance_class: ["[[exocmd__Command]]"],
          exo__Asset_uid: "cmd-test",
          exo__Asset_label: "Test Command",
        };

        expect(isCommandFrontmatter(fm)).toBe(true);
      });

      it("should return true for plain string class (no wikilink)", () => {
        const fm = {
          exo__Instance_class: "exocmd__Command",
        };

        expect(isCommandFrontmatter(fm)).toBe(true);
      });

      it("should return true for wikilink with label", () => {
        const fm = {
          exo__Instance_class: ["[[exocmd__Command|Dynamic Command]]"],
        };

        expect(isCommandFrontmatter(fm)).toBe(true);
      });

      it("should return false for different class", () => {
        const fm = {
          exo__Instance_class: ["[[ems__Task]]"],
        };

        expect(isCommandFrontmatter(fm)).toBe(false);
      });

      it("should return false for missing exo__Instance_class", () => {
        const fm = {
          exo__Asset_uid: "test",
        };

        expect(isCommandFrontmatter(fm)).toBe(false);
      });

      it("should return false for null instance class", () => {
        const fm = {
          exo__Instance_class: null,
        };

        expect(isCommandFrontmatter(fm)).toBe(false);
      });

      it("should return false for non-string array items", () => {
        const fm = {
          exo__Instance_class: [123, true],
        };

        expect(isCommandFrontmatter(fm)).toBe(false);
      });
    });

    describe("isPreconditionFrontmatter", () => {
      it("should return true for valid precondition frontmatter", () => {
        const fm = {
          exo__Instance_class: ["[[exocmd__Precondition]]"],
        };

        expect(isPreconditionFrontmatter(fm)).toBe(true);
      });

      it("should return false for command frontmatter", () => {
        const fm = {
          exo__Instance_class: ["[[exocmd__Command]]"],
        };

        expect(isPreconditionFrontmatter(fm)).toBe(false);
      });
    });

    describe("isGroundingFrontmatter", () => {
      it("should return true for valid grounding frontmatter", () => {
        const fm = {
          exo__Instance_class: ["[[exocmd__Grounding]]"],
        };

        expect(isGroundingFrontmatter(fm)).toBe(true);
      });

      it("should return false for empty frontmatter", () => {
        expect(isGroundingFrontmatter({})).toBe(false);
      });
    });

    describe("isCommandBindingFrontmatter", () => {
      it("should return true for valid binding frontmatter", () => {
        const fm = {
          exo__Instance_class: ["[[exocmd__CommandBinding]]"],
        };

        expect(isCommandBindingFrontmatter(fm)).toBe(true);
      });

      it("should return false for grounding frontmatter", () => {
        const fm = {
          exo__Instance_class: ["[[exocmd__Grounding]]"],
        };

        expect(isCommandBindingFrontmatter(fm)).toBe(false);
      });
    });

    describe("exact class matching (no false positives)", () => {
      it("should not match CommandBinding when checking for Command", () => {
        const fm = {
          exo__Instance_class: ["[[exocmd__CommandBinding]]"],
        };

        expect(isCommandFrontmatter(fm)).toBe(false);
      });

      it("should handle multi-class frontmatter correctly", () => {
        const fm = {
          exo__Instance_class: [
            "[[exo__Asset]]",
            "[[exocmd__Command]]",
          ],
        };

        expect(isCommandFrontmatter(fm)).toBe(true);
        expect(isPreconditionFrontmatter(fm)).toBe(false);
      });
    });
  });
});
