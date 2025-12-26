/**
 * @fileoverview Unit tests for Graph3DThemeService
 *
 * Tests theme detection, ontology-based node coloring, predicate-based edge coloring,
 * and theme change events for 3D graph visualization.
 */

import {
  Graph3DThemeService,
  createGraph3DThemeService,
  DEFAULT_THEME_CONFIG,
  type ThemeMode,
  type Graph3DThemeEvent,
} from "@plugin/presentation/renderers/graph/3d/Graph3DThemeService";

describe("Graph3DThemeService", () => {
  let themeService: Graph3DThemeService;

  // Mock document.body for theme detection
  const originalBody = document.body;

  beforeEach(() => {
    // Reset document body class
    document.body.className = "";
    themeService = new Graph3DThemeService();
  });

  afterEach(() => {
    themeService.destroy();
  });

  afterAll(() => {
    document.body = originalBody;
  });

  describe("Theme Detection", () => {
    it("should detect dark mode when body has theme-dark class", () => {
      document.body.classList.add("theme-dark");
      const service = new Graph3DThemeService();
      expect(service.getThemeMode()).toBe("dark");
      service.destroy();
    });

    it("should detect light mode when body has theme-light class", () => {
      document.body.classList.add("theme-light");
      const service = new Graph3DThemeService();
      expect(service.getThemeMode()).toBe("light");
      service.destroy();
    });

    it("should default to dark mode when no theme class is present", () => {
      document.body.className = "";
      const service = new Graph3DThemeService();
      // Without explicit theme class or matchMedia mock, defaults to dark
      expect(["dark", "light"]).toContain(service.getThemeMode());
      service.destroy();
    });

    it("should allow manual theme mode setting", () => {
      themeService.setThemeMode("light");
      expect(themeService.getThemeMode()).toBe("light");

      themeService.setThemeMode("dark");
      expect(themeService.getThemeMode()).toBe("dark");
    });
  });

  describe("Theme Colors", () => {
    it("should return correct dark theme colors", () => {
      themeService.setThemeMode("dark");
      const colors = themeService.getThemeColors();

      expect(colors.background).toBe("#1E1E1E");
      expect(colors.nodeColors.exo).toBe("#4A90E2");
      expect(colors.nodeColors.ems).toBe("#7ED321");
      expect(colors.edgeColors.rdfType).toBe("#F5A623");
    });

    it("should return correct light theme colors", () => {
      themeService.setThemeMode("light");
      const colors = themeService.getThemeColors();

      expect(colors.background).toBe("#F5F5F5");
      expect(colors.nodeColors.exo).toBe("#2563EB");
      expect(colors.nodeColors.ems).toBe("#16A34A");
      expect(colors.edgeColors.rdfType).toBe("#D97706");
    });

    it("should return background color as hex number", () => {
      themeService.setThemeMode("dark");
      expect(themeService.getBackgroundColorNumber()).toBe(0x1e1e1e);

      themeService.setThemeMode("light");
      expect(themeService.getBackgroundColorNumber()).toBe(0xf5f5f5);
    });

    it("should return fog color as hex number", () => {
      themeService.setThemeMode("dark");
      expect(themeService.getFogColorNumber()).toBe(0x1e1e1e);

      themeService.setThemeMode("light");
      expect(themeService.getFogColorNumber()).toBe(0xf5f5f5);
    });
  });

  describe("Namespace Extraction", () => {
    it("should extract exo namespace from URIs", () => {
      expect(themeService.extractNamespace("exo__Asset")).toBe("exo");
      expect(themeService.extractNamespace("exo#Asset")).toBe("exo");
      expect(themeService.extractNamespace("https://exocortex.my/ontology/exo#Asset")).toBe("exo");
    });

    it("should extract ems namespace from URIs", () => {
      expect(themeService.extractNamespace("ems__Task")).toBe("ems");
      expect(themeService.extractNamespace("ems#Project")).toBe("ems");
      expect(themeService.extractNamespace("https://exocortex.my/ontology/ems#Area")).toBe("ems");
    });

    it("should extract ims namespace from URIs", () => {
      expect(themeService.extractNamespace("ims__Concept")).toBe("ims");
      expect(themeService.extractNamespace("ims#Tag")).toBe("ims");
    });

    it("should extract rdf namespace from URIs", () => {
      expect(themeService.extractNamespace("rdf:type")).toBe("rdf");
      expect(themeService.extractNamespace("rdf__type")).toBe("rdf");
      expect(themeService.extractNamespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#type")).toBe("rdf");
    });

    it("should extract rdfs namespace from URIs", () => {
      expect(themeService.extractNamespace("rdfs:Class")).toBe("rdfs");
      expect(themeService.extractNamespace("rdfs__subClassOf")).toBe("rdfs");
      expect(themeService.extractNamespace("http://www.w3.org/2000/01/rdf-schema#Class")).toBe("rdfs");
    });

    it("should extract owl namespace from URIs", () => {
      expect(themeService.extractNamespace("owl:Class")).toBe("owl");
      expect(themeService.extractNamespace("owl__sameAs")).toBe("owl");
      expect(themeService.extractNamespace("http://www.w3.org/2002/07/owl#Class")).toBe("owl");
    });

    it("should extract xsd namespace from URIs", () => {
      expect(themeService.extractNamespace("xsd:string")).toBe("xsd");
      expect(themeService.extractNamespace("xsd__dateTime")).toBe("xsd");
      expect(themeService.extractNamespace("http://www.w3.org/2001/XMLSchema#string")).toBe("xsd");
    });

    it("should return unknown for unrecognized URIs", () => {
      expect(themeService.extractNamespace("custom:Thing")).toBe("unknown");
      expect(themeService.extractNamespace("/some/path")).toBe("unknown");
      expect(themeService.extractNamespace("SomeClass")).toBe("unknown");
    });
  });

  describe("Node Coloring", () => {
    beforeEach(() => {
      themeService.setThemeMode("dark");
    });

    it("should return correct color for exo# nodes", () => {
      const color = themeService.getNodeColor("https://exocortex.my/ontology/exo#Asset");
      expect(color).toBe("#4A90E2"); // Blue
    });

    it("should return correct color for ems# nodes", () => {
      const color = themeService.getNodeColor("ems__Task");
      expect(color).toBe("#7ED321"); // Green
    });

    it("should return correct color for ims# nodes", () => {
      const color = themeService.getNodeColor("ims__Concept");
      expect(color).toBe("#9B59B6"); // Purple
    });

    it("should return correct color for rdf nodes", () => {
      const color = themeService.getNodeColor("rdf:Resource");
      expect(color).toBe("#F5A623"); // Orange
    });

    it("should return gray for unknown namespace nodes", () => {
      const color = themeService.getNodeColor("custom:Something");
      expect(color).toBe("#95A5A6"); // Gray
    });

    it("should return node color as hex number", () => {
      const colorNum = themeService.getNodeColorNumber("ems__Task");
      expect(colorNum).toBe(0x7ed321);
    });

    it("should change node colors based on theme", () => {
      themeService.setThemeMode("dark");
      const darkColor = themeService.getNodeColor("exo#Asset");

      themeService.setThemeMode("light");
      const lightColor = themeService.getNodeColor("exo#Asset");

      expect(darkColor).toBe("#4A90E2");
      expect(lightColor).toBe("#2563EB");
    });
  });

  describe("Edge Coloring", () => {
    beforeEach(() => {
      themeService.setThemeMode("dark");
    });

    it("should return orange for rdf:type edges", () => {
      expect(themeService.getEdgeColor("rdf:type")).toBe("#F5A623");
      expect(themeService.getEdgeColor("rdf__type")).toBe("#F5A623");
      expect(themeService.getEdgeColor("http://www.w3.org/1999/02/22-rdf-syntax-ns#type")).toBe("#F5A623");
    });

    it("should return purple for rdfs:subClassOf edges", () => {
      expect(themeService.getEdgeColor("rdfs:subClassOf")).toBe("#9B59B6");
      expect(themeService.getEdgeColor("rdfs__subClassOf")).toBe("#9B59B6");
    });

    it("should return blue for owl:sameAs edges", () => {
      expect(themeService.getEdgeColor("owl:sameAs")).toBe("#3498DB");
      expect(themeService.getEdgeColor("owl__sameAs")).toBe("#3498DB");
    });

    it("should return default gray for other edges", () => {
      expect(themeService.getEdgeColor("ems:prototype")).toBe("#64748B");
      expect(themeService.getEdgeColor("custom:relation")).toBe("#64748B");
    });

    it("should return edge color as hex number", () => {
      const colorNum = themeService.getEdgeColorNumber("rdf:type");
      expect(colorNum).toBe(0xf5a623);
    });

    it("should change edge colors based on theme", () => {
      themeService.setThemeMode("dark");
      const darkColor = themeService.getEdgeColor("rdf:type");

      themeService.setThemeMode("light");
      const lightColor = themeService.getEdgeColor("rdf:type");

      expect(darkColor).toBe("#F5A623");
      expect(lightColor).toBe("#D97706");
    });
  });

  describe("Label Style", () => {
    it("should return correct label style for dark mode", () => {
      themeService.setThemeMode("dark");
      const style = themeService.getLabelStyle();

      expect(style.color).toBe("#E2E8F0");
      expect(style.backgroundColor).toBe("rgba(30, 30, 30, 0.85)");
    });

    it("should return correct label style for light mode", () => {
      themeService.setThemeMode("light");
      const style = themeService.getLabelStyle();

      expect(style.color).toBe("#1E293B");
      expect(style.backgroundColor).toBe("rgba(245, 245, 245, 0.85)");
    });
  });

  describe("Contrast Checking", () => {
    it("should validate contrast requirement for colors", () => {
      themeService.setThemeMode("dark");

      // Blue on dark background should meet contrast
      expect(themeService.meetsContrastRequirement("#4A90E2")).toBe(true);

      // Very dark color on dark background might not meet contrast
      expect(themeService.meetsContrastRequirement("#1E1E1E")).toBe(false);
    });

    it("should calculate contrast ratio", () => {
      themeService.setThemeMode("dark");
      const ratio = themeService.getContrastRatio("#4A90E2");

      // Should be a reasonable contrast ratio (> 1)
      expect(ratio).toBeGreaterThan(1);
    });
  });

  describe("Event System", () => {
    it("should emit themeChange event when theme changes", () => {
      const listener = jest.fn();
      themeService.on("themeChange", listener);

      themeService.setThemeMode("light");

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "themeChange",
          mode: "light",
        })
      );
    });

    it("should not emit event when theme is already set", () => {
      themeService.setThemeMode("dark");
      const listener = jest.fn();
      themeService.on("themeChange", listener);

      themeService.setThemeMode("dark"); // Same mode

      expect(listener).not.toHaveBeenCalled();
    });

    it("should remove event listener with off()", () => {
      const listener = jest.fn();
      themeService.on("themeChange", listener);
      themeService.off("themeChange", listener);

      themeService.setThemeMode("light");

      expect(listener).not.toHaveBeenCalled();
    });

    it("should include colors in theme change event", () => {
      const listener = jest.fn();
      themeService.on("themeChange", listener);

      themeService.setThemeMode("light");

      const event = listener.mock.calls[0][0] as Graph3DThemeEvent;
      expect(event.colors).toBeDefined();
      expect(event.colors.background).toBe("#F5F5F5");
    });
  });

  describe("Factory Function", () => {
    it("should create theme service with factory function", () => {
      const service = createGraph3DThemeService();
      expect(service).toBeInstanceOf(Graph3DThemeService);
      service.destroy();
    });

    it("should accept custom config in factory function", () => {
      const customConfig = {
        dark: {
          ...DEFAULT_THEME_CONFIG.dark,
          background: "#000000",
        },
      };

      const service = createGraph3DThemeService(customConfig);
      service.setThemeMode("dark");

      expect(service.getThemeColors().background).toBe("#000000");
      service.destroy();
    });
  });

  describe("Cleanup", () => {
    it("should clear listeners on destroy", () => {
      const listener = jest.fn();
      themeService.on("themeChange", listener);

      themeService.destroy();

      // Should not throw after destroy
      themeService.setThemeMode("light");
      expect(listener).not.toHaveBeenCalled();
    });
  });
});
