import type { CommandVisibilityContext } from "exocortex";
import {
  canCreateInstance,
  canCreateSubclass,
  inheritsFromPrototype,
  isPrototypeClass,
} from "exocortex";

describe("CommandVisibility - Instance/Subclass Commands", () => {
  describe("canCreateInstance", () => {
    it("should return true for ems__TaskPrototype", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__TaskPrototype]]",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateInstance(context)).toBe(true);
    });

    it("should return true for TaskPrototype without brackets", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "ems__TaskPrototype",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateInstance(context)).toBe(true);
    });

    it("should return false for ems__Task", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateInstance(context)).toBe(false);
    });

    it("should return false for ems__Area", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Area]]",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateInstance(context)).toBe(false);
    });

    it("should return false when instanceClass is null", () => {
      const context: CommandVisibilityContext = {
        instanceClass: null,
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateInstance(context)).toBe(false);
    });

    it("should return true for array with ems__TaskPrototype", () => {
      const context: CommandVisibilityContext = {
        instanceClass: ["[[ems__TaskPrototype]]", "[[SomeOtherClass]]"],
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateInstance(context)).toBe(true);
    });

    it("should return true for ems__MeetingPrototype", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__MeetingPrototype]]",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateInstance(context)).toBe(true);
    });

    it("should return true for exo__EventPrototype", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[exo__EventPrototype]]",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateInstance(context)).toBe(true);
    });

    it("should return true for EventPrototype without brackets", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "exo__EventPrototype",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateInstance(context)).toBe(true);
    });

    it("should return true for ems__ProjectPrototype", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__ProjectPrototype]]",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateInstance(context)).toBe(true);
    });

    it("should return true for ProjectPrototype without brackets", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "ems__ProjectPrototype",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateInstance(context)).toBe(true);
    });

    it("should return true for array with ems__ProjectPrototype", () => {
      const context: CommandVisibilityContext = {
        instanceClass: ["[[ems__ProjectPrototype]]", "[[SomeOtherClass]]"],
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateInstance(context)).toBe(true);
    });

    it("should return true for array with exo__EventPrototype", () => {
      const context: CommandVisibilityContext = {
        instanceClass: ["[[exo__EventPrototype]]", "[[SomeOtherClass]]"],
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateInstance(context)).toBe(true);
    });

    // Direct prototype inheritance via exo__Class_superClass
    describe("prototype inheritance via exo__Class_superClass", () => {
      it("should return true for class with exo__Class_superClass pointing to exo__Prototype", () => {
        const context: CommandVisibilityContext = {
          instanceClass: "[[exo__Class]]",
          currentStatus: null,
          metadata: {
            exo__Class_superClass: "[[exo__Prototype]]",
          },
          isArchived: false,
          currentFolder: "",
          expectedFolder: null,
        };
        expect(canCreateInstance(context)).toBe(true);
      });

      it("should return true for class with exo__Class_superClass without brackets", () => {
        const context: CommandVisibilityContext = {
          instanceClass: "exo__Class",
          currentStatus: null,
          metadata: {
            exo__Class_superClass: "exo__Prototype",
          },
          isArchived: false,
          currentFolder: "",
          expectedFolder: null,
        };
        expect(canCreateInstance(context)).toBe(true);
      });

      it("should return true for class with exo__Class_superClass as array containing exo__Prototype", () => {
        const context: CommandVisibilityContext = {
          instanceClass: "[[exo__Class]]",
          currentStatus: null,
          metadata: {
            exo__Class_superClass: ["[[exo__Prototype]]", "[[exo__Asset]]"],
          },
          isArchived: false,
          currentFolder: "",
          expectedFolder: null,
        };
        expect(canCreateInstance(context)).toBe(true);
      });

      it("should return false for class without exo__Prototype in superclass chain", () => {
        const context: CommandVisibilityContext = {
          instanceClass: "[[exo__Class]]",
          currentStatus: null,
          metadata: {
            exo__Class_superClass: "[[exo__Asset]]",
          },
          isArchived: false,
          currentFolder: "",
          expectedFolder: null,
        };
        expect(canCreateInstance(context)).toBe(false);
      });

      it("should return false for class without exo__Class_superClass property", () => {
        const context: CommandVisibilityContext = {
          instanceClass: "[[exo__Class]]",
          currentStatus: null,
          metadata: {},
          isArchived: false,
          currentFolder: "",
          expectedFolder: null,
        };
        expect(canCreateInstance(context)).toBe(false);
      });

      it("should return false for non-class asset even with exo__Prototype in metadata", () => {
        const context: CommandVisibilityContext = {
          instanceClass: "[[ems__Task]]",
          currentStatus: null,
          metadata: {
            exo__Class_superClass: "[[exo__Prototype]]",
          },
          isArchived: false,
          currentFolder: "",
          expectedFolder: null,
        };
        expect(canCreateInstance(context)).toBe(false);
      });
    });

    // Transitive prototype inheritance via flat namespace metadata
    describe("transitive prototype inheritance via flat namespace", () => {
      it("should return true for class with 2-level transitive inheritance from exo__Prototype", () => {
        const context: CommandVisibilityContext = {
          instanceClass: "[[exo__Class]]",
          currentStatus: null,
          metadata: {
            exo__Class_superClass: "[[custom__BasePrototype]]",
            "custom__BasePrototype__exo__Class_superClass": "[[exo__Prototype]]",
          },
          isArchived: false,
          currentFolder: "",
          expectedFolder: null,
        };
        expect(canCreateInstance(context)).toBe(true);
      });

      it("should return true for class with 3-level transitive inheritance from exo__Prototype", () => {
        const context: CommandVisibilityContext = {
          instanceClass: "[[exo__Class]]",
          currentStatus: null,
          metadata: {
            exo__Class_superClass: "[[custom__SpecificPrototype]]",
            "custom__SpecificPrototype__exo__Class_superClass": "[[custom__BasePrototype]]",
            "custom__BasePrototype__exo__Class_superClass": "[[exo__Prototype]]",
          },
          isArchived: false,
          currentFolder: "",
          expectedFolder: null,
        };
        expect(canCreateInstance(context)).toBe(true);
      });

      it("should return false for class with transitive inheritance not leading to exo__Prototype", () => {
        const context: CommandVisibilityContext = {
          instanceClass: "[[exo__Class]]",
          currentStatus: null,
          metadata: {
            exo__Class_superClass: "[[custom__MyClass]]",
            "custom__MyClass__exo__Class_superClass": "[[exo__Asset]]",
          },
          isArchived: false,
          currentFolder: "",
          expectedFolder: null,
        };
        expect(canCreateInstance(context)).toBe(false);
      });

      it("should handle circular inheritance gracefully and return false", () => {
        const context: CommandVisibilityContext = {
          instanceClass: "[[exo__Class]]",
          currentStatus: null,
          metadata: {
            exo__Class_superClass: "[[ClassA]]",
            "ClassA__exo__Class_superClass": "[[ClassB]]",
            "ClassB__exo__Class_superClass": "[[ClassA]]", // Circular
          },
          isArchived: false,
          currentFolder: "",
          expectedFolder: null,
        };
        expect(canCreateInstance(context)).toBe(false);
      });

      it("should find exo__Prototype via any path in multiple inheritance", () => {
        const context: CommandVisibilityContext = {
          instanceClass: "[[exo__Class]]",
          currentStatus: null,
          metadata: {
            exo__Class_superClass: ["[[PathA]]", "[[PathB]]"],
            "PathA__exo__Class_superClass": "[[exo__Asset]]", // Dead end
            "PathB__exo__Class_superClass": "[[exo__Prototype]]", // Found!
          },
          isArchived: false,
          currentFolder: "",
          expectedFolder: null,
        };
        expect(canCreateInstance(context)).toBe(true);
      });
    });
  });

  describe("canCreateSubclass", () => {
    it("should return true for exo__Class", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[exo__Class]]",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateSubclass(context)).toBe(true);
    });

    it("should return true for exo__Class without brackets", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "exo__Class",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateSubclass(context)).toBe(true);
    });

    it("should return false for ems__Task", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateSubclass(context)).toBe(false);
    });

    it("should return false when instanceClass is null", () => {
      const context: CommandVisibilityContext = {
        instanceClass: null,
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateSubclass(context)).toBe(false);
    });

    it("should return true for array with exo__Class", () => {
      const context: CommandVisibilityContext = {
        instanceClass: ["[[exo__Class]]", "[[SomeOtherClass]]"],
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateSubclass(context)).toBe(true);
    });

    it("should return false for array without exo__Class", () => {
      const context: CommandVisibilityContext = {
        instanceClass: ["[[ems__Task]]", "[[ems__Project]]"],
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateSubclass(context)).toBe(false);
    });
  });

  describe("inheritsFromPrototype helper", () => {
    describe("direct inheritance", () => {
      it("should return true when exo__Class_superClass contains exo__Prototype", () => {
        const metadata = {
          exo__Class_superClass: "[[exo__Prototype]]",
        };
        expect(inheritsFromPrototype(metadata)).toBe(true);
      });

      it("should return true for exo__Prototype without brackets", () => {
        const metadata = {
          exo__Class_superClass: "exo__Prototype",
        };
        expect(inheritsFromPrototype(metadata)).toBe(true);
      });

      it("should return true when exo__Class_superClass array contains exo__Prototype", () => {
        const metadata = {
          exo__Class_superClass: ["[[exo__Asset]]", "[[exo__Prototype]]"],
        };
        expect(inheritsFromPrototype(metadata)).toBe(true);
      });

      it("should return false when exo__Class_superClass does not contain exo__Prototype", () => {
        const metadata = {
          exo__Class_superClass: "[[exo__Asset]]",
        };
        expect(inheritsFromPrototype(metadata)).toBe(false);
      });

      it("should return false when exo__Class_superClass is missing", () => {
        const metadata = {};
        expect(inheritsFromPrototype(metadata)).toBe(false);
      });

      it("should return false when exo__Class_superClass is null", () => {
        const metadata = {
          exo__Class_superClass: null,
        };
        expect(inheritsFromPrototype(metadata)).toBe(false);
      });

      it("should handle quoted wiki-link format", () => {
        const metadata = {
          exo__Class_superClass: '"[[exo__Prototype]]"',
        };
        expect(inheritsFromPrototype(metadata)).toBe(true);
      });
    });

    describe("transitive inheritance (2-level hierarchy)", () => {
      it("should return true for 2-level inheritance chain via flat namespace", () => {
        // custom__MyPrototype -> custom__BasePrototype -> exo__Prototype
        const metadata = {
          exo__Class_superClass: "[[custom__BasePrototype]]",
          "custom__BasePrototype__exo__Class_superClass": "[[exo__Prototype]]",
        };
        expect(inheritsFromPrototype(metadata)).toBe(true);
      });

      it("should return true for 2-level chain without brackets", () => {
        const metadata = {
          exo__Class_superClass: "custom__BasePrototype",
          "custom__BasePrototype__exo__Class_superClass": "exo__Prototype",
        };
        expect(inheritsFromPrototype(metadata)).toBe(true);
      });

      it("should return true for 2-level chain with quoted values", () => {
        const metadata = {
          exo__Class_superClass: '"[[custom__BasePrototype]]"',
          "custom__BasePrototype__exo__Class_superClass": '"[[exo__Prototype]]"',
        };
        expect(inheritsFromPrototype(metadata)).toBe(true);
      });

      it("should return false for 2-level chain not ending in exo__Prototype", () => {
        const metadata = {
          exo__Class_superClass: "[[custom__BaseClass]]",
          "custom__BaseClass__exo__Class_superClass": "[[exo__Asset]]",
        };
        expect(inheritsFromPrototype(metadata)).toBe(false);
      });
    });

    describe("transitive inheritance (3-level hierarchy)", () => {
      it("should return true for 3-level inheritance chain", () => {
        // custom__DeepPrototype -> custom__MiddlePrototype -> custom__BasePrototype -> exo__Prototype
        const metadata = {
          exo__Class_superClass: "[[custom__MiddlePrototype]]",
          "custom__MiddlePrototype__exo__Class_superClass": "[[custom__BasePrototype]]",
          "custom__BasePrototype__exo__Class_superClass": "[[exo__Prototype]]",
        };
        expect(inheritsFromPrototype(metadata)).toBe(true);
      });

      it("should return false for 3-level chain not ending in exo__Prototype", () => {
        const metadata = {
          exo__Class_superClass: "[[custom__Level1]]",
          "custom__Level1__exo__Class_superClass": "[[custom__Level2]]",
          "custom__Level2__exo__Class_superClass": "[[exo__Asset]]",
        };
        expect(inheritsFromPrototype(metadata)).toBe(false);
      });
    });

    describe("circular inheritance handling", () => {
      it("should return false for circular inheritance (ClassA -> ClassB -> ClassA)", () => {
        const metadata = {
          exo__Class_superClass: "[[ClassA]]",
          "ClassA__exo__Class_superClass": "[[ClassB]]",
          "ClassB__exo__Class_superClass": "[[ClassA]]", // Circular reference
        };
        expect(inheritsFromPrototype(metadata)).toBe(false);
      });

      it("should return false for self-referencing class", () => {
        const metadata = {
          exo__Class_superClass: "[[SelfRef]]",
          "SelfRef__exo__Class_superClass": "[[SelfRef]]", // Self-reference
        };
        expect(inheritsFromPrototype(metadata)).toBe(false);
      });

      it("should still find exo__Prototype in circular chain if present", () => {
        const metadata = {
          exo__Class_superClass: "[[ClassA]]",
          "ClassA__exo__Class_superClass": ["[[ClassB]]", "[[exo__Prototype]]"],
          "ClassB__exo__Class_superClass": "[[ClassA]]", // Circular, but Prototype already found
        };
        expect(inheritsFromPrototype(metadata)).toBe(true);
      });
    });

    describe("max depth handling", () => {
      it("should stop at max depth to prevent infinite loops", () => {
        // Create a chain deeper than default maxDepth (10)
        const metadata: Record<string, any> = {
          exo__Class_superClass: "[[Level0]]",
        };
        for (let i = 0; i < 15; i++) {
          metadata[`Level${i}__exo__Class_superClass`] = `[[Level${i + 1}]]`;
        }
        // exo__Prototype at level 15, but maxDepth defaults to 10
        metadata["Level15__exo__Class_superClass"] = "[[exo__Prototype]]";

        expect(inheritsFromPrototype(metadata)).toBe(false);
      });

      it("should find exo__Prototype within max depth", () => {
        // Create a chain within maxDepth (10)
        const metadata: Record<string, any> = {
          exo__Class_superClass: "[[Level0]]",
        };
        for (let i = 0; i < 5; i++) {
          metadata[`Level${i}__exo__Class_superClass`] = `[[Level${i + 1}]]`;
        }
        // exo__Prototype at level 5, well within maxDepth
        metadata["Level5__exo__Class_superClass"] = "[[exo__Prototype]]";

        expect(inheritsFromPrototype(metadata)).toBe(true);
      });

      it("should respect custom maxDepth parameter", () => {
        const metadata = {
          exo__Class_superClass: "[[Level0]]",
          "Level0__exo__Class_superClass": "[[Level1]]",
          "Level1__exo__Class_superClass": "[[Level2]]",
          "Level2__exo__Class_superClass": "[[exo__Prototype]]",
        };

        // maxDepth=1 should not find exo__Prototype at depth 2
        expect(inheritsFromPrototype(metadata, 1)).toBe(false);

        // maxDepth=5 should find exo__Prototype
        expect(inheritsFromPrototype(metadata, 5)).toBe(true);
      });
    });

    describe("multiple inheritance paths", () => {
      it("should find exo__Prototype via any inheritance path", () => {
        const metadata = {
          exo__Class_superClass: ["[[PathA]]", "[[PathB]]"],
          "PathA__exo__Class_superClass": "[[exo__Asset]]", // Dead end
          "PathB__exo__Class_superClass": "[[exo__Prototype]]", // Found via PathB
        };
        expect(inheritsFromPrototype(metadata)).toBe(true);
      });

      it("should return false when all paths are dead ends", () => {
        const metadata = {
          exo__Class_superClass: ["[[PathA]]", "[[PathB]]"],
          "PathA__exo__Class_superClass": "[[exo__Asset]]",
          "PathB__exo__Class_superClass": "[[exo__Class]]",
        };
        expect(inheritsFromPrototype(metadata)).toBe(false);
      });
    });

    describe("missing parent metadata", () => {
      it("should return false when parent class metadata is missing", () => {
        const metadata = {
          exo__Class_superClass: "[[custom__UnknownClass]]",
          // No "custom__UnknownClass__exo__Class_superClass" defined
        };
        expect(inheritsFromPrototype(metadata)).toBe(false);
      });

      it("should continue traversal when some parents are missing", () => {
        const metadata = {
          exo__Class_superClass: ["[[PathMissing]]", "[[PathValid]]"],
          // "PathMissing__exo__Class_superClass" is not defined
          "PathValid__exo__Class_superClass": "[[exo__Prototype]]",
        };
        expect(inheritsFromPrototype(metadata)).toBe(true);
      });
    });
  });

  describe("isPrototypeClass helper", () => {
    describe("direct inheritance", () => {
      it("should return true for exo__Class with exo__Prototype superclass", () => {
        const instanceClass = "[[exo__Class]]";
        const metadata = {
          exo__Class_superClass: "[[exo__Prototype]]",
        };
        expect(isPrototypeClass(instanceClass, metadata)).toBe(true);
      });

      it("should return false for non-class asset", () => {
        const instanceClass = "[[ems__Task]]";
        const metadata = {
          exo__Class_superClass: "[[exo__Prototype]]",
        };
        expect(isPrototypeClass(instanceClass, metadata)).toBe(false);
      });

      it("should return false for class without prototype inheritance", () => {
        const instanceClass = "[[exo__Class]]";
        const metadata = {
          exo__Class_superClass: "[[exo__Asset]]",
        };
        expect(isPrototypeClass(instanceClass, metadata)).toBe(false);
      });

      it("should return false for class without superclass", () => {
        const instanceClass = "[[exo__Class]]";
        const metadata = {};
        expect(isPrototypeClass(instanceClass, metadata)).toBe(false);
      });

      it("should return false when instanceClass is null", () => {
        const instanceClass = null;
        const metadata = {
          exo__Class_superClass: "[[exo__Prototype]]",
        };
        expect(isPrototypeClass(instanceClass, metadata)).toBe(false);
      });

      it("should handle array instanceClass with exo__Class", () => {
        const instanceClass = ["[[exo__Class]]", "[[SomeOther]]"];
        const metadata = {
          exo__Class_superClass: "[[exo__Prototype]]",
        };
        expect(isPrototypeClass(instanceClass, metadata)).toBe(true);
      });
    });

    describe("transitive inheritance", () => {
      it("should return true for 2-level transitive inheritance", () => {
        const instanceClass = "[[exo__Class]]";
        const metadata = {
          exo__Class_superClass: "[[custom__BasePrototype]]",
          "custom__BasePrototype__exo__Class_superClass": "[[exo__Prototype]]",
        };
        expect(isPrototypeClass(instanceClass, metadata)).toBe(true);
      });

      it("should return true for 3-level transitive inheritance", () => {
        const instanceClass = "[[exo__Class]]";
        const metadata = {
          exo__Class_superClass: "[[custom__DeepPrototype]]",
          "custom__DeepPrototype__exo__Class_superClass": "[[custom__BasePrototype]]",
          "custom__BasePrototype__exo__Class_superClass": "[[exo__Prototype]]",
        };
        expect(isPrototypeClass(instanceClass, metadata)).toBe(true);
      });

      it("should return false for transitive inheritance not leading to exo__Prototype", () => {
        const instanceClass = "[[exo__Class]]";
        const metadata = {
          exo__Class_superClass: "[[custom__MyClass]]",
          "custom__MyClass__exo__Class_superClass": "[[exo__Asset]]",
        };
        expect(isPrototypeClass(instanceClass, metadata)).toBe(false);
      });

      it("should handle circular inheritance gracefully", () => {
        const instanceClass = "[[exo__Class]]";
        const metadata = {
          exo__Class_superClass: "[[ClassA]]",
          "ClassA__exo__Class_superClass": "[[ClassB]]",
          "ClassB__exo__Class_superClass": "[[ClassA]]", // Circular
        };
        expect(isPrototypeClass(instanceClass, metadata)).toBe(false);
      });
    });
  });
});
