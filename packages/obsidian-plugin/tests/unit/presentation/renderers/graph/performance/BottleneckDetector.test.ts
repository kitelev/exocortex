/**
 * Tests for BottleneckDetector - Automatic performance bottleneck detection
 *
 * @module presentation/renderers/graph/performance
 * @since 1.0.0
 */

import {
  BottleneckDetector,
  createBottleneckDetector,
  DEFAULT_DETECTOR_CONFIG,
  type BottleneckAnalysis,
} from "../../../../../../src/presentation/renderers/graph/performance/BottleneckDetector";
import type { PerformanceMetrics } from "../../../../../../src/presentation/renderers/graph/performance/PerformanceProfiler";

describe("BottleneckDetector", () => {
  let detector: BottleneckDetector;

  beforeEach(() => {
    detector = new BottleneckDetector();
  });

  afterEach(() => {
    detector.reset();
  });

  // Helper to create sample metrics
  function createMetrics(overrides: Partial<PerformanceMetrics> = {}): PerformanceMetrics {
    return {
      frameTime: 16,
      fps: 60,
      renderTime: 5,
      physicsTime: 3,
      layoutTime: 2,
      dataUpdateTime: 1,
      drawCalls: 100,
      triangleCount: 10000,
      visibleNodes: 1000,
      visibleEdges: 2000,
      memoryUsage: 100 * 1024 * 1024,
      timestamp: Date.now(),
      ...overrides,
    };
  }

  // Helper to create array of samples
  function createSamples(
    count: number,
    overrides: Partial<PerformanceMetrics> = {}
  ): PerformanceMetrics[] {
    return Array.from({ length: count }, (_, i) =>
      createMetrics({
        timestamp: Date.now() - (count - i) * 16,
        ...overrides,
      })
    );
  }

  describe("initialization", () => {
    it("should create with default config", () => {
      expect(detector).toBeInstanceOf(BottleneckDetector);
    });

    it("should accept custom config", () => {
      const custom = new BottleneckDetector({
        minSamples: 10,
        cpuBottleneckThreshold: 10,
      });
      expect(custom).toBeInstanceOf(BottleneckDetector);
    });
  });

  describe("analysis with insufficient samples", () => {
    it("should return empty analysis when samples are below minimum", () => {
      const samples = createSamples(10); // Less than default 30
      const analysis = detector.analyze(samples);

      expect(analysis.bottlenecks).toHaveLength(0);
      expect(analysis.healthScore).toBe(100);
    });
  });

  describe("CPU bottleneck detection", () => {
    it("should detect CPU overload", () => {
      const samples = createSamples(60, {
        physicsTime: 10,
        layoutTime: 5,
        dataUpdateTime: 3,
        frameTime: 25,
      });

      const analysis = detector.analyze(samples);

      const cpuBottleneck = analysis.bottlenecks.find(
        (b) => b.id === "cpu-overload"
      );
      expect(cpuBottleneck).toBeDefined();
      expect(cpuBottleneck?.category).toBe("cpu");
    });

    it("should not detect CPU bottleneck for fast frames", () => {
      const samples = createSamples(60, {
        physicsTime: 1,
        layoutTime: 1,
        dataUpdateTime: 1,
        frameTime: 8,
      });

      const analysis = detector.analyze(samples);

      const cpuBottleneck = analysis.bottlenecks.find(
        (b) => b.id === "cpu-overload"
      );
      expect(cpuBottleneck).toBeUndefined();
    });
  });

  describe("GPU bottleneck detection", () => {
    it("should detect excessive draw calls", () => {
      const samples = createSamples(60, {
        drawCalls: 500,
        triangleCount: 10000,
      });

      const analysis = detector.analyze(samples);

      const gpuBottleneck = analysis.bottlenecks.find(
        (b) => b.id === "gpu-draw-calls"
      );
      expect(gpuBottleneck).toBeDefined();
      expect(gpuBottleneck?.category).toBe("gpu");
    });

    it("should not detect GPU bottleneck for efficient draw calls", () => {
      const samples = createSamples(60, {
        drawCalls: 50,
        triangleCount: 50000,
      });

      const analysis = detector.analyze(samples);

      const gpuBottleneck = analysis.bottlenecks.find(
        (b) => b.id === "gpu-draw-calls"
      );
      expect(gpuBottleneck).toBeUndefined();
    });
  });

  describe("physics bottleneck detection", () => {
    it("should detect physics overhead", () => {
      const samples = createSamples(60, {
        physicsTime: 10,
        frameTime: 20,
      });

      const analysis = detector.analyze(samples);

      const physicsBottleneck = analysis.bottlenecks.find(
        (b) => b.id === "physics-overhead"
      );
      expect(physicsBottleneck).toBeDefined();
      expect(physicsBottleneck?.category).toBe("physics");
    });
  });

  describe("layout bottleneck detection", () => {
    it("should detect layout overhead", () => {
      const samples = createSamples(60, {
        layoutTime: 15,
        frameTime: 25,
      });

      const analysis = detector.analyze(samples);

      const layoutBottleneck = analysis.bottlenecks.find(
        (b) => b.id === "layout-overhead"
      );
      expect(layoutBottleneck).toBeDefined();
      expect(layoutBottleneck?.category).toBe("layout");
    });
  });

  describe("rendering bottleneck detection", () => {
    it("should detect too many visible elements", () => {
      const samples = createSamples(60, {
        visibleNodes: 75000,
        visibleEdges: 100000,
      });

      const analysis = detector.analyze(samples);

      const renderingBottleneck = analysis.bottlenecks.find(
        (b) => b.id === "too-many-visible"
      );
      expect(renderingBottleneck).toBeDefined();
      expect(renderingBottleneck?.category).toBe("rendering");
    });
  });

  describe("memory bottleneck detection", () => {
    it("should detect high memory usage", () => {
      const samples = createSamples(60, {
        memoryUsage: 600 * 1024 * 1024, // 600MB
      });

      const analysis = detector.analyze(samples);

      const memoryBottleneck = analysis.bottlenecks.find(
        (b) => b.id === "high-memory"
      );
      expect(memoryBottleneck).toBeDefined();
      expect(memoryBottleneck?.category).toBe("memory");
    });
  });

  describe("frame drops detection", () => {
    it("should detect frequent frame drops", () => {
      // 20% slow frames (>33ms)
      const samples = createSamples(60);
      for (let i = 0; i < 12; i++) {
        samples[i * 5].frameTime = 40;
      }

      const analysis = detector.analyze(samples);

      const frameDropsBottleneck = analysis.bottlenecks.find(
        (b) => b.id === "frame-drops"
      );
      expect(frameDropsBottleneck).toBeDefined();
      expect(frameDropsBottleneck?.category).toBe("general");
    });
  });

  describe("bottleneck sorting", () => {
    it("should sort bottlenecks by severity and impact", () => {
      const samples = createSamples(60, {
        physicsTime: 15,
        layoutTime: 12,
        drawCalls: 500,
        visibleNodes: 100000,
        frameTime: 40,
      });

      const analysis = detector.analyze(samples);

      // Should be sorted - higher severity first
      for (let i = 1; i < analysis.bottlenecks.length; i++) {
        const prev = analysis.bottlenecks[i - 1];
        const curr = analysis.bottlenecks[i];

        const severityOrder = {
          critical: 0,
          high: 1,
          medium: 2,
          low: 3,
          info: 4,
        };
        expect(severityOrder[prev.severity]).toBeLessThanOrEqual(
          severityOrder[curr.severity]
        );
      }
    });
  });

  describe("health score calculation", () => {
    it("should return high health score for good performance", () => {
      const samples = createSamples(60, {
        frameTime: 8,
        fps: 120,
        physicsTime: 1,
        renderTime: 2,
      });

      const analysis = detector.analyze(samples);

      expect(analysis.healthScore).toBeGreaterThan(80);
    });

    it("should return low health score for poor performance", () => {
      const samples = createSamples(60, {
        frameTime: 50,
        fps: 20,
        physicsTime: 20,
        visibleNodes: 100000,
        drawCalls: 500,
      });

      const analysis = detector.analyze(samples);

      expect(analysis.healthScore).toBeLessThan(50);
    });
  });

  describe("trend analysis", () => {
    it("should detect degrading performance trend", () => {
      const samples: PerformanceMetrics[] = [];
      // Create samples with increasing frame time
      for (let i = 0; i < 60; i++) {
        samples.push(
          createMetrics({
            frameTime: 10 + i * 0.5, // Increasing from 10 to 40ms
            timestamp: Date.now() - (60 - i) * 16,
          })
        );
      }

      const analysis = detector.analyze(samples);

      const frameTimeTrend = analysis.trends.find(
        (t) => t.metric === "frameTime"
      );
      expect(frameTimeTrend).toBeDefined();
      expect(frameTimeTrend?.direction).toBe("degrading");
    });

    it("should detect improving performance trend", () => {
      const samples: PerformanceMetrics[] = [];
      // Create samples with decreasing frame time
      for (let i = 0; i < 60; i++) {
        samples.push(
          createMetrics({
            frameTime: 40 - i * 0.5, // Decreasing from 40 to 10ms
            timestamp: Date.now() - (60 - i) * 16,
          })
        );
      }

      const analysis = detector.analyze(samples);

      const frameTimeTrend = analysis.trends.find(
        (t) => t.metric === "frameTime"
      );
      expect(frameTimeTrend).toBeDefined();
      expect(frameTimeTrend?.direction).toBe("improving");
    });

    it("should detect stable performance", () => {
      const samples = createSamples(60, { frameTime: 16 });

      const analysis = detector.analyze(samples);

      const frameTimeTrend = analysis.trends.find(
        (t) => t.metric === "frameTime"
      );
      expect(frameTimeTrend).toBeDefined();
      expect(frameTimeTrend?.direction).toBe("stable");
    });
  });

  describe("resource utilization", () => {
    it("should calculate CPU utilization estimate", () => {
      const samples = createSamples(60, {
        physicsTime: 8,
        layoutTime: 4,
        dataUpdateTime: 2,
      });

      const analysis = detector.analyze(samples);

      expect(analysis.resources.cpuEstimate).toBeGreaterThan(0);
      expect(analysis.resources.cpuEstimate).toBeLessThanOrEqual(100);
    });

    it("should calculate draw call efficiency", () => {
      const samples = createSamples(60, {
        drawCalls: 100,
        triangleCount: 50000,
      });

      const analysis = detector.analyze(samples);

      expect(analysis.resources.drawCallEfficiency).toBe(500); // 50000 / 100
    });
  });

  describe("recommendations", () => {
    it("should provide recommendations for detected bottlenecks", () => {
      const samples = createSamples(60, {
        physicsTime: 10,
        frameTime: 25,
      });

      const analysis = detector.analyze(samples);

      expect(analysis.topRecommendations.length).toBeGreaterThan(0);
    });

    it("should limit top recommendations count", () => {
      const samples = createSamples(60, {
        physicsTime: 15,
        layoutTime: 12,
        drawCalls: 500,
        visibleNodes: 100000,
        memoryUsage: 600 * 1024 * 1024,
      });

      const analysis = detector.analyze(samples);

      expect(analysis.topRecommendations.length).toBeLessThanOrEqual(5);
    });
  });

  describe("quick check", () => {
    it("should quickly identify no issues for good performance", () => {
      const metrics = createMetrics({
        frameTime: 10,
        physicsTime: 2,
        renderTime: 3,
      });

      const result = detector.quickCheck(metrics);

      expect(result.hasIssues).toBe(false);
      expect(result.mainBottleneck).toBeNull();
    });

    it("should quickly identify physics bottleneck", () => {
      const metrics = createMetrics({
        frameTime: 40,
        physicsTime: 25,
        renderTime: 5,
      });

      const result = detector.quickCheck(metrics);

      expect(result.hasIssues).toBe(true);
      expect(result.mainBottleneck).toBe("physics");
      expect(result.severity).toBe("high");
    });

    it("should quickly identify rendering bottleneck", () => {
      const metrics = createMetrics({
        frameTime: 40,
        physicsTime: 5,
        renderTime: 25,
      });

      const result = detector.quickCheck(metrics);

      expect(result.hasIssues).toBe(true);
      expect(result.mainBottleneck).toBe("rendering");
    });
  });

  describe("persistence tracking", () => {
    it("should track persistent bottlenecks", () => {
      const samples = createSamples(60, {
        physicsTime: 10,
        frameTime: 25,
      });

      // Analyze multiple times to build history
      for (let i = 0; i < 10; i++) {
        detector.analyze(samples);
      }

      const analysis = detector.analyze(samples);
      const physicsBottleneck = analysis.bottlenecks.find(
        (b) => b.id === "physics-overhead"
      );

      expect(physicsBottleneck?.persistent).toBe(true);
    });
  });

  describe("reset", () => {
    it("should clear bottleneck history on reset", () => {
      const samples = createSamples(60, {
        physicsTime: 10,
        frameTime: 25,
      });

      // Build up history
      for (let i = 0; i < 10; i++) {
        detector.analyze(samples);
      }

      detector.reset();

      // After reset, bottleneck should not be marked as persistent
      const analysis = detector.analyze(samples);
      const physicsBottleneck = analysis.bottlenecks.find(
        (b) => b.id === "physics-overhead"
      );

      expect(physicsBottleneck?.persistent).toBe(false);
    });
  });

  describe("factory function", () => {
    it("should create detector via factory", () => {
      const d = createBottleneckDetector({ minSamples: 10 });
      expect(d).toBeInstanceOf(BottleneckDetector);
    });
  });
});
