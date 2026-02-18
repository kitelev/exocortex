import { FunctionReplacer } from "../../../../src/infrastructure/utils/FunctionReplacer";

describe("FunctionReplacer", () => {
  interface TestTarget {
    getValue(): string;
    multiply(a: number, b: number): number;
  }

  let target: TestTarget;
  let targetPrototype: TestTarget;

  beforeEach(() => {
    targetPrototype = {
      getValue: function () {
        return "original";
      },
      multiply: function (a: number, b: number) {
        return a * b;
      },
    };
    target = Object.create(targetPrototype);
  });

  describe("create", () => {
    it("should create a FunctionReplacer instance", () => {
      const replacer = FunctionReplacer.create(
        targetPrototype,
        "getValue",
        {},
        function (_args, _defaultArgs, vanilla) {
          return vanilla.call(this);
        }
      );

      expect(replacer).toBeInstanceOf(FunctionReplacer);
    });

    it("should throw error if method is not a function", () => {
      const invalidTarget = { notAFunction: "string" };

      expect(() => {
        FunctionReplacer.create(
          invalidTarget as unknown as { notAFunction: () => string },
          "notAFunction" as "notAFunction",
          {},
          function () {
            return "";
          }
        );
      }).toThrow("Method notAFunction is not a function");
    });
  });

  describe("enable", () => {
    it("should replace the method with custom implementation", () => {
      const replacer = FunctionReplacer.create(
        targetPrototype,
        "getValue",
        { prefix: "custom-" },
        function (args, _defaultArgs, vanilla) {
          return args.prefix + vanilla.call(this);
        }
      );

      expect(target.getValue()).toBe("original");

      replacer.enable();

      expect(target.getValue()).toBe("custom-original");
    });

    it("should return true on first enable", () => {
      const replacer = FunctionReplacer.create(
        targetPrototype,
        "getValue",
        {},
        function () {
          return "replaced";
        }
      );

      const result = replacer.enable();

      expect(result).toBe(true);
    });

    it("should return false if already enabled", () => {
      const replacer = FunctionReplacer.create(
        targetPrototype,
        "getValue",
        {},
        function () {
          return "replaced";
        }
      );

      replacer.enable();
      const result = replacer.enable();

      expect(result).toBe(false);
    });

    it("should preserve this context in replacement", () => {
      interface ContextTarget {
        name: string;
        getName(): string;
      }

      const contextPrototype: ContextTarget = {
        name: "test",
        getName: function () {
          return this.name;
        },
      };

      const contextTarget: ContextTarget = Object.create(contextPrototype);
      contextTarget.name = "instance-name";

      const replacer = FunctionReplacer.create(
        contextPrototype,
        "getName",
        { suffix: "-modified" },
        function (args, _defaultArgs, vanilla) {
          return vanilla.call(this) + args.suffix;
        }
      );

      replacer.enable();

      expect(contextTarget.getName()).toBe("instance-name-modified");
    });

    it("should pass arguments to implementation", () => {
      const replacer = FunctionReplacer.create(
        targetPrototype,
        "multiply",
        { factor: 10 },
        function (args, defaultArgs, vanilla) {
          const [a, b] = defaultArgs as [number, number];
          return vanilla.call(this, a, b) * args.factor;
        }
      );

      replacer.enable();

      expect(target.multiply(2, 3)).toBe(60); // (2 * 3) * 10
    });
  });

  describe("disable", () => {
    it("should restore original method", () => {
      const replacer = FunctionReplacer.create(
        targetPrototype,
        "getValue",
        {},
        function () {
          return "replaced";
        }
      );

      replacer.enable();
      expect(target.getValue()).toBe("replaced");

      replacer.disable();
      expect(target.getValue()).toBe("original");
    });

    it("should do nothing if not enabled", () => {
      const replacer = FunctionReplacer.create(
        targetPrototype,
        "getValue",
        {},
        function () {
          return "replaced";
        }
      );

      expect(() => replacer.disable()).not.toThrow();
      expect(target.getValue()).toBe("original");
    });

    it("should allow re-enabling after disable", () => {
      const replacer = FunctionReplacer.create(
        targetPrototype,
        "getValue",
        {},
        function () {
          return "replaced";
        }
      );

      replacer.enable();
      replacer.disable();

      const result = replacer.enable();

      expect(result).toBe(true);
      expect(target.getValue()).toBe("replaced");
    });
  });

  describe("isEnabled", () => {
    it("should return false when not enabled", () => {
      const replacer = FunctionReplacer.create(
        targetPrototype,
        "getValue",
        {},
        function () {
          return "replaced";
        }
      );

      expect(replacer.isEnabled()).toBe(false);
    });

    it("should return true when enabled", () => {
      const replacer = FunctionReplacer.create(
        targetPrototype,
        "getValue",
        {},
        function () {
          return "replaced";
        }
      );

      replacer.enable();

      expect(replacer.isEnabled()).toBe(true);
    });

    it("should return false after disable", () => {
      const replacer = FunctionReplacer.create(
        targetPrototype,
        "getValue",
        {},
        function () {
          return "replaced";
        }
      );

      replacer.enable();
      replacer.disable();

      expect(replacer.isEnabled()).toBe(false);
    });
  });

  describe("getTarget", () => {
    it("should return the target object", () => {
      const replacer = FunctionReplacer.create(
        targetPrototype,
        "getValue",
        {},
        function () {
          return "replaced";
        }
      );

      expect(replacer.getTarget()).toBe(targetPrototype);
    });
  });

  describe("real-world scenario: Graph node patching", () => {
    interface GraphNode {
      id: string;
      getDisplayText(): string;
    }

    it("should work for Graph View node prototype patching", () => {
      const graphNodePrototype: GraphNode = {
        id: "",
        getDisplayText: function () {
          return this.id;
        },
      };

      const node1: GraphNode = Object.create(graphNodePrototype);
      node1.id = "file1.md";

      const node2: GraphNode = Object.create(graphNodePrototype);
      node2.id = "file2.md";

      const labelResolver = {
        resolve: (id: string): string | null => {
          const labels: Record<string, string> = {
            "file1.md": "My First Document",
            "file2.md": "Another Document",
          };
          return labels[id] ?? null;
        },
      };

      const replacer = FunctionReplacer.create(
        graphNodePrototype,
        "getDisplayText",
        { resolver: labelResolver },
        function (args, _defaultArgs, vanilla) {
          const label = args.resolver.resolve(this.id);
          return label ?? vanilla.call(this);
        }
      );

      // Before enabling
      expect(node1.getDisplayText()).toBe("file1.md");
      expect(node2.getDisplayText()).toBe("file2.md");

      replacer.enable();

      // After enabling - labels are resolved
      expect(node1.getDisplayText()).toBe("My First Document");
      expect(node2.getDisplayText()).toBe("Another Document");

      // Node without label falls back to original
      const node3: GraphNode = Object.create(graphNodePrototype);
      node3.id = "unknown.md";
      expect(node3.getDisplayText()).toBe("unknown.md");

      replacer.disable();

      // After disabling - original behavior restored
      expect(node1.getDisplayText()).toBe("file1.md");
      expect(node2.getDisplayText()).toBe("file2.md");
    });
  });
});
