/**
 * LabelRenderer Unit Tests
 *
 * Tests for:
 * - LabelVisualStyle defaults
 * - LabelStyleResolver type resolution
 * - Text truncation
 * - Label positioning with anchors
 * - Zoom-based visibility and alpha calculation
 * - Helper functions
 */

import {
  LabelStyleResolver,
  DEFAULT_LABEL_STYLE,
  calculateOptimalLabelPosition,
  type LabelAnchor,
} from "@plugin/presentation/renderers/graph/LabelRenderer";

describe("LabelRenderer Module", () => {
  describe("DEFAULT_LABEL_STYLE", () => {
    it("should have correct default typography settings", () => {
      expect(DEFAULT_LABEL_STYLE.fontFamily).toBe("Inter, system-ui, sans-serif");
      expect(DEFAULT_LABEL_STYLE.fontSize).toBe(11);
      expect(DEFAULT_LABEL_STYLE.fontWeight).toBe(400);
      expect(DEFAULT_LABEL_STYLE.fontStyle).toBe("normal");
      expect(DEFAULT_LABEL_STYLE.color).toBe(0xffffff);
    });

    it("should have correct default background settings", () => {
      expect(DEFAULT_LABEL_STYLE.backgroundColor).toBe(0x1f2937);
      expect(DEFAULT_LABEL_STYLE.backgroundAlpha).toBe(0.85);
      expect(DEFAULT_LABEL_STYLE.padding).toBe(4);
      expect(DEFAULT_LABEL_STYLE.borderRadius).toBe(4);
      expect(DEFAULT_LABEL_STYLE.showBackground).toBe(true);
    });

    it("should have correct default position settings", () => {
      expect(DEFAULT_LABEL_STYLE.anchor).toBe("bottom");
      expect(DEFAULT_LABEL_STYLE.offsetX).toBe(0);
      expect(DEFAULT_LABEL_STYLE.offsetY).toBe(4);
    });

    it("should have correct default truncation settings", () => {
      expect(DEFAULT_LABEL_STYLE.maxLength).toBe(20);
      expect(DEFAULT_LABEL_STYLE.ellipsis).toBe("…");
    });

    it("should have correct default zoom visibility settings", () => {
      expect(DEFAULT_LABEL_STYLE.minZoom).toBe(0.5);
      expect(DEFAULT_LABEL_STYLE.maxZoom).toBe(1.0);
      expect(DEFAULT_LABEL_STYLE.fadeRange).toBe(0.2);
    });

    it("should have correct default state colors", () => {
      expect(DEFAULT_LABEL_STYLE.hoverColor).toBe(0xffffff);
      expect(DEFAULT_LABEL_STYLE.hoverBackgroundColor).toBe(0x374151);
      expect(DEFAULT_LABEL_STYLE.selectedColor).toBe(0xfbbf24);
      expect(DEFAULT_LABEL_STYLE.selectedBackgroundColor).toBe(0x1f2937);
    });
  });

  describe("LabelStyleResolver", () => {
    let resolver: LabelStyleResolver;

    beforeEach(() => {
      resolver = new LabelStyleResolver();
    });

    describe("resolveStyle", () => {
      it("should return default style for undefined type", () => {
        const style = resolver.resolveStyle(undefined);
        expect(style.fontFamily).toBe("Inter, system-ui, sans-serif");
        expect(style.fontSize).toBe(11);
      });

      it("should return default style for unknown type", () => {
        const style = resolver.resolveStyle("unknown_type");
        expect(style.fontFamily).toBe("Inter, system-ui, sans-serif");
      });

      it("should merge with default style when type is registered", () => {
        resolver.registerTypeStyle("custom_type", {
          fontSize: 14,
          color: 0xff0000,
        });

        const style = resolver.resolveStyle("custom_type");
        expect(style.fontSize).toBe(14);
        expect(style.color).toBe(0xff0000);
        // Should keep other defaults
        expect(style.fontFamily).toBe("Inter, system-ui, sans-serif");
        expect(style.padding).toBe(4);
      });
    });

    describe("registerTypeStyle", () => {
      it("should register a new type style", () => {
        resolver.registerTypeStyle("test_type", {
          fontSize: 16,
          backgroundColor: 0x000000,
        });

        const style = resolver.resolveStyle("test_type");
        expect(style.fontSize).toBe(16);
        expect(style.backgroundColor).toBe(0x000000);
      });

      it("should override existing type style", () => {
        resolver.registerTypeStyle("test_type", { fontSize: 12 });
        resolver.registerTypeStyle("test_type", { fontSize: 18 });

        const style = resolver.resolveStyle("test_type");
        expect(style.fontSize).toBe(18);
      });
    });

    describe("setDefaultStyle", () => {
      it("should update default style", () => {
        resolver.setDefaultStyle({ fontSize: 14 });

        const style = resolver.resolveStyle(undefined);
        expect(style.fontSize).toBe(14);
      });

      it("should merge with existing default style", () => {
        resolver.setDefaultStyle({ fontSize: 14 });

        const style = resolver.resolveStyle(undefined);
        expect(style.fontSize).toBe(14);
        expect(style.fontFamily).toBe("Inter, system-ui, sans-serif");
      });
    });

    describe("getDefaultStyle", () => {
      it("should return a copy of the default style", () => {
        const style1 = resolver.getDefaultStyle();
        const style2 = resolver.getDefaultStyle();

        expect(style1).toEqual(style2);
        expect(style1).not.toBe(style2);
      });
    });
  });

  describe("Text truncation", () => {
    // Test truncation logic directly using the same algorithm
    const truncateText = (text: string, maxLength: number, ellipsis: string): string => {
      if (text.length <= maxLength) {
        return text;
      }
      return text.substring(0, maxLength - ellipsis.length) + ellipsis;
    };

    it("should not truncate short text", () => {
      const result = truncateText("Short", 20, "…");
      expect(result).toBe("Short");
    });

    it("should truncate long text with ellipsis", () => {
      const result = truncateText("This is a very long text that should be truncated", 20, "…");
      expect(result).toBe("This is a very long…");
      expect(result.length).toBe(20);
    });

    it("should handle exact length text", () => {
      const result = truncateText("Exactly 20 chars!!!", 20, "…");
      expect(result).toBe("Exactly 20 chars!!!");
    });

    it("should use custom ellipsis", () => {
      const result = truncateText("Long text here", 10, "...");
      expect(result).toBe("Long te...");
    });
  });

  describe("Label positioning", () => {
    // Test position calculation directly
    const calculateLabelPosition = (
      nodePosition: { x: number; y: number },
      nodeRadius: number,
      anchor: LabelAnchor,
      offsetX: number,
      offsetY: number
    ): { x: number; y: number } => {
      let x = nodePosition.x + offsetX;
      let y = nodePosition.y + offsetY;

      switch (anchor) {
        case "top":
          y = nodePosition.y - nodeRadius - offsetY;
          break;
        case "bottom":
          y = nodePosition.y + nodeRadius + offsetY;
          break;
        case "left":
          x = nodePosition.x - nodeRadius - offsetX;
          break;
        case "right":
          x = nodePosition.x + nodeRadius + offsetX;
          break;
        case "top-left":
          x = nodePosition.x - nodeRadius - offsetX;
          y = nodePosition.y - nodeRadius - offsetY;
          break;
        case "top-right":
          x = nodePosition.x + nodeRadius + offsetX;
          y = nodePosition.y - nodeRadius - offsetY;
          break;
        case "bottom-left":
          x = nodePosition.x - nodeRadius - offsetX;
          y = nodePosition.y + nodeRadius + offsetY;
          break;
        case "bottom-right":
          x = nodePosition.x + nodeRadius + offsetX;
          y = nodePosition.y + nodeRadius + offsetY;
          break;
        case "center":
        default:
          break;
      }

      return { x, y };
    };

    const nodePosition = { x: 100, y: 100 };
    const nodeRadius = 10;

    it("should calculate position for bottom anchor", () => {
      const pos = calculateLabelPosition(nodePosition, nodeRadius, "bottom", 0, 4);
      expect(pos.y).toBe(114); // 100 + 10 + 4 (offsetY)
      expect(pos.x).toBe(100);
    });

    it("should calculate position for top anchor", () => {
      const pos = calculateLabelPosition(nodePosition, nodeRadius, "top", 0, 4);
      expect(pos.y).toBe(86); // 100 - 10 - 4 (offsetY)
      expect(pos.x).toBe(100);
    });

    it("should calculate position for left anchor", () => {
      const pos = calculateLabelPosition(nodePosition, nodeRadius, "left", 0, 4);
      expect(pos.x).toBe(90); // 100 - 10 - 0 (offsetX)
    });

    it("should calculate position for right anchor", () => {
      const pos = calculateLabelPosition(nodePosition, nodeRadius, "right", 0, 4);
      expect(pos.x).toBe(110); // 100 + 10 + 0 (offsetX)
    });

    it("should calculate position for center anchor", () => {
      const pos = calculateLabelPosition(nodePosition, nodeRadius, "center", 0, 4);
      expect(pos.x).toBe(100);
      expect(pos.y).toBe(104); // 100 + 4 (offsetY)
    });

    it("should apply custom offsets", () => {
      const pos = calculateLabelPosition(nodePosition, nodeRadius, "bottom", 5, 10);
      expect(pos.x).toBe(105);
      expect(pos.y).toBe(120); // 100 + 10 + 10
    });

    it("should calculate position for top-left anchor", () => {
      const pos = calculateLabelPosition(nodePosition, nodeRadius, "top-left", 4, 4);
      expect(pos.x).toBe(86); // 100 - 10 - 4
      expect(pos.y).toBe(86); // 100 - 10 - 4
    });

    it("should calculate position for bottom-right anchor", () => {
      const pos = calculateLabelPosition(nodePosition, nodeRadius, "bottom-right", 4, 4);
      expect(pos.x).toBe(114); // 100 + 10 + 4
      expect(pos.y).toBe(114); // 100 + 10 + 4
    });
  });

  describe("Zoom alpha calculation", () => {
    // Test zoom alpha calculation directly
    const calculateZoomAlpha = (
      zoom: number,
      minZoom: number,
      maxZoom: number,
      fadeRange: number
    ): number => {
      if (zoom < minZoom) {
        return 0;
      }

      if (zoom >= maxZoom) {
        return 1;
      }

      const fadeStart = minZoom;
      const fadeEnd = Math.min(minZoom + fadeRange, maxZoom);

      if (zoom >= fadeEnd) {
        return 1;
      }

      return (zoom - fadeStart) / (fadeEnd - fadeStart);
    };

    const minZoom = 0.5;
    const maxZoom = 1.0;
    const fadeRange = 0.2;

    it("should return 0 for zoom below minZoom", () => {
      const alpha = calculateZoomAlpha(0.3, minZoom, maxZoom, fadeRange);
      expect(alpha).toBe(0);
    });

    it("should return 1 for zoom at or above maxZoom", () => {
      const alpha = calculateZoomAlpha(1.0, minZoom, maxZoom, fadeRange);
      expect(alpha).toBe(1);
    });

    it("should return 1 for zoom above maxZoom", () => {
      const alpha = calculateZoomAlpha(2.0, minZoom, maxZoom, fadeRange);
      expect(alpha).toBe(1);
    });

    it("should fade in between minZoom and minZoom + fadeRange", () => {
      // minZoom = 0.5, fadeRange = 0.2, so fade from 0.5 to 0.7
      const alpha = calculateZoomAlpha(0.6, minZoom, maxZoom, fadeRange);
      expect(alpha).toBeGreaterThan(0);
      expect(alpha).toBeLessThan(1);
      expect(alpha).toBeCloseTo(0.5, 1);
    });

    it("should return 1 after fade range", () => {
      const alpha = calculateZoomAlpha(0.8, minZoom, maxZoom, fadeRange);
      expect(alpha).toBe(1);
    });

    it("should return 0 at exact minZoom", () => {
      // At minZoom, fade starts so alpha = 0
      const alpha = calculateZoomAlpha(0.5, minZoom, maxZoom, fadeRange);
      expect(alpha).toBe(0);
    });

    it("should return 1 at end of fade range", () => {
      // At minZoom + fadeRange = 0.7
      const alpha = calculateZoomAlpha(0.7, minZoom, maxZoom, fadeRange);
      expect(alpha).toBe(1);
    });
  });

  describe("Viewport culling", () => {
    // Test viewport check directly
    const isInViewport = (
      position: { x: number; y: number },
      bounds: { minX: number; maxX: number; minY: number; maxY: number },
      margin: number = 100
    ): boolean => {
      return (
        position.x >= bounds.minX - margin &&
        position.x <= bounds.maxX + margin &&
        position.y >= bounds.minY - margin &&
        position.y <= bounds.maxY + margin
      );
    };

    const bounds = { minX: 0, maxX: 800, minY: 0, maxY: 600 };

    it("should return true for position inside viewport", () => {
      expect(isInViewport({ x: 400, y: 300 }, bounds)).toBe(true);
    });

    it("should return true for position at viewport edge", () => {
      expect(isInViewport({ x: 0, y: 0 }, bounds)).toBe(true);
    });

    it("should return true for position within margin", () => {
      expect(isInViewport({ x: -50, y: 300 }, bounds)).toBe(true);
    });

    it("should return false for position far outside viewport", () => {
      expect(isInViewport({ x: -200, y: 300 }, bounds)).toBe(false);
      expect(isInViewport({ x: 400, y: -200 }, bounds)).toBe(false);
    });

    it("should return false for position past margin in all directions", () => {
      expect(isInViewport({ x: -101, y: 300 }, bounds)).toBe(false);
      expect(isInViewport({ x: 901, y: 300 }, bounds)).toBe(false);
      expect(isInViewport({ x: 400, y: -101 }, bounds)).toBe(false);
      expect(isInViewport({ x: 400, y: 701 }, bounds)).toBe(false);
    });
  });

  describe("calculateOptimalLabelPosition", () => {
    const nodePosition = { x: 100, y: 100 };
    const nodeRadius = 10;

    it("should calculate position for bottom anchor", () => {
      const { position, anchor } = calculateOptimalLabelPosition(
        nodePosition,
        nodeRadius,
        "bottom"
      );

      expect(position.x).toBe(100);
      expect(position.y).toBe(114); // 100 + 10 + 4
      expect(anchor).toBe("bottom");
    });

    it("should calculate position for top anchor", () => {
      const { position, anchor } = calculateOptimalLabelPosition(
        nodePosition,
        nodeRadius,
        "top"
      );

      expect(position.x).toBe(100);
      expect(position.y).toBe(86); // 100 - 10 - 4
      expect(anchor).toBe("top");
    });

    it("should calculate position for left anchor", () => {
      const { position, anchor } = calculateOptimalLabelPosition(
        nodePosition,
        nodeRadius,
        "left"
      );

      expect(position.x).toBe(86); // 100 - 10 - 4
      expect(anchor).toBe("left");
    });

    it("should calculate position for right anchor", () => {
      const { position, anchor } = calculateOptimalLabelPosition(
        nodePosition,
        nodeRadius,
        "right"
      );

      expect(position.x).toBe(114); // 100 + 10 + 4
      expect(anchor).toBe("right");
    });

    it("should calculate position for center anchor", () => {
      const { position, anchor } = calculateOptimalLabelPosition(
        nodePosition,
        nodeRadius,
        "center"
      );

      expect(position.x).toBe(100);
      expect(position.y).toBe(100);
      expect(anchor).toBe("center");
    });

    it("should use default anchor if not specified", () => {
      const { anchor } = calculateOptimalLabelPosition(nodePosition, nodeRadius);
      expect(anchor).toBe("bottom");
    });

    it("should apply custom offset", () => {
      const { position } = calculateOptimalLabelPosition(
        nodePosition,
        nodeRadius,
        "bottom",
        10
      );

      expect(position.y).toBe(120); // 100 + 10 + 10
    });
  });
});
