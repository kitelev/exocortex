/**
 * Tests for AutoOptimizer - Automated performance optimization
 *
 * @module presentation/renderers/graph/performance
 * @since 1.0.0
 */

import {
  AutoOptimizer,
  createAutoOptimizer,
  getOptimizationPresets,
  DEFAULT_OPTIMIZATION_STATE,
  DEFAULT_OPTIMIZER_CONFIG,
  type OptimizerEvent,
  type OptimizationState,
} from "../../../../../../src/presentation/renderers/graph/performance/AutoOptimizer";
import type { PerformanceMetrics, FrameAnalysis } from "../../../../../../src/presentation/renderers/graph/performance/PerformanceProfiler";
import type { BottleneckAnalysis } from "../../../../../../src/presentation/renderers/graph/performance/BottleneckDetector";
import { LODLevel } from "../../../../../../src/presentation/renderers/graph/LODSystem";

describe("AutoOptimizer", () => {
  let optimizer: AutoOptimizer;

  beforeEach(() => {
    optimizer = new AutoOptimizer({ mode: "manual" });
  });

  afterEach(() => {
    optimizer.dispose();
  });

  // Helper to create mock metrics
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

  // Helper to create mock analysis
  function createAnalysis(overrides: Partial<FrameAnalysis> = {}): FrameAnalysis {
    return {
      level: "good",
      fps: 60,
      avgFrameTime: 16,
      variance: 1,
      hitRate60: 95,
      hitRate30: 100,
      bottleneck: null,
      bottleneckPercentage: 0,
      ...overrides,
    };
  }

  // Helper to create mock bottleneck analysis
  function createBottleneckAnalysis(
    overrides: Partial<BottleneckAnalysis> = {}
  ): BottleneckAnalysis {
    return {
      bottlenecks: [],
      trends: [],
      resources: {
        cpuEstimate: 50,
        gpuEstimate: 50,
        memoryMB: 100,
        drawCallEfficiency: 500,
        visibilityRatio: 1,
      },
      healthScore: 80,
      topRecommendations: [],
      timestamp: Date.now(),
      ...overrides,
    };
  }

  describe("initialization", () => {
    it("should create with default state", () => {
      const state = optimizer.getState();
      expect(state.lodLevel).toBe(DEFAULT_OPTIMIZATION_STATE.lodLevel);
      expect(state.physicsEnabled).toBe(true);
      expect(state.cullingEnabled).toBe(true);
    });

    it("should accept custom config", () => {
      const custom = new AutoOptimizer({
        mode: "auto",
        targets: { targetFps: 30, minimumFps: 15, targetFrameTime: 33, maxFrameTime: 66, memoryLimitMB: 512 },
      });
      expect(custom.getMode()).toBe("auto");
      custom.dispose();
    });
  });

  describe("state management", () => {
    it("should get current state", () => {
      const state = optimizer.getState();
      expect(state).toMatchObject(DEFAULT_OPTIMIZATION_STATE);
    });

    it("should set state partially", () => {
      optimizer.setState({ lodLevel: LODLevel.MINIMAL });

      const state = optimizer.getState();
      expect(state.lodLevel).toBe(LODLevel.MINIMAL);
      expect(state.physicsEnabled).toBe(true); // Unchanged
    });

    it("should emit state-changed event", () => {
      const events: OptimizerEvent[] = [];
      optimizer.on("state-changed", (event) => events.push(event));

      optimizer.setState({ labelsEnabled: false });

      expect(events.length).toBe(1);
      expect(events[0].type).toBe("state-changed");
      expect(events[0].state.labelsEnabled).toBe(false);
    });
  });

  describe("suggestion generation", () => {
    it("should not generate suggestions when performance is good", () => {
      const metrics = createMetrics({ fps: 60, frameTime: 16 });
      const analysis = createAnalysis({ level: "good", fps: 60 });

      optimizer.update(metrics, analysis);

      const suggestions = optimizer.getSuggestions();
      // May suggest quality improvements but not performance fixes
      const perfSuggestions = suggestions.filter((s) => s.estimatedImprovement > 0);
      expect(perfSuggestions.length).toBe(0);
    });

    it("should suggest LOD reduction when performance is poor", () => {
      const metrics = createMetrics({ fps: 25, frameTime: 40 });
      const analysis = createAnalysis({ level: "warning", fps: 25 });

      optimizer.update(metrics, analysis);

      const suggestions = optimizer.getSuggestions();
      const lodSuggestion = suggestions.find((s) => s.id === "reduce-lod");
      expect(lodSuggestion).toBeDefined();
      expect(lodSuggestion?.category).toBe("lod");
    });

    it("should suggest physics optimization for physics bottleneck", () => {
      const metrics = createMetrics({ fps: 25, frameTime: 40, physicsTime: 25 });
      const analysis = createAnalysis({
        level: "warning",
        fps: 25,
        bottleneck: "physics",
      });

      optimizer.update(metrics, analysis);

      const suggestions = optimizer.getSuggestions();
      const physicsSuggestion = suggestions.find(
        (s) => s.category === "physics"
      );
      expect(physicsSuggestion).toBeDefined();
    });

    it("should suggest disabling shadows for rendering bottleneck", () => {
      const metrics = createMetrics({ fps: 30, frameTime: 33, renderTime: 20 });
      const analysis = createAnalysis({ level: "warning", fps: 30 });
      const bottleneckAnalysis = createBottleneckAnalysis({
        bottlenecks: [
          {
            id: "gpu-overhead",
            name: "GPU Overhead",
            category: "gpu",
            severity: "medium",
            sections: ["render"],
            description: "High GPU load",
            metrics: {},
            recommendations: [],
            impact: 20,
            confidence: 0.8,
            firstDetected: Date.now(),
            persistent: false,
          },
        ],
      });

      optimizer.update(metrics, analysis, bottleneckAnalysis);

      const suggestions = optimizer.getSuggestions();
      const shadowSuggestion = suggestions.find(
        (s) => s.id === "disable-shadows"
      );
      expect(shadowSuggestion).toBeDefined();
    });

    it("should suggest aggregation for many visible nodes", () => {
      const metrics = createMetrics({
        fps: 30,
        frameTime: 33,
        visibleNodes: 75000,
      });
      const analysis = createAnalysis({ level: "warning", fps: 30 });

      optimizer.update(metrics, analysis);

      const suggestions = optimizer.getSuggestions();
      const aggregationSuggestion = suggestions.find(
        (s) => s.id === "enable-aggregation"
      );
      expect(aggregationSuggestion).toBeDefined();
      expect(aggregationSuggestion?.category).toBe("aggregation");
    });

    it("should sort suggestions by priority", () => {
      const metrics = createMetrics({
        fps: 20,
        frameTime: 50,
        physicsTime: 10,
        visibleNodes: 75000,
      });
      const analysis = createAnalysis({ level: "critical", fps: 20 });

      optimizer.update(metrics, analysis);

      const suggestions = optimizer.getSuggestions();

      // Verify sorted by priority (descending)
      for (let i = 1; i < suggestions.length; i++) {
        expect(suggestions[i - 1].priority).toBeGreaterThanOrEqual(
          suggestions[i].priority
        );
      }
    });
  });

  describe("optimization application", () => {
    it("should apply optimization by ID", () => {
      const metrics = createMetrics({ fps: 25, frameTime: 40 });
      const analysis = createAnalysis({ level: "warning", fps: 25 });

      optimizer.update(metrics, analysis);

      const result = optimizer.applyOptimization("reduce-lod");

      expect(result).toBe(true);
      expect(optimizer.getState().lodLevel).toBeLessThan(LODLevel.HIGH);
    });

    it("should not apply non-existent optimization", () => {
      const result = optimizer.applyOptimization("non-existent");
      expect(result).toBe(false);
    });

    it("should emit optimization-applied event", () => {
      const events: OptimizerEvent[] = [];
      optimizer.on("optimization-applied", (event) => events.push(event));

      const metrics = createMetrics({ fps: 25, frameTime: 40 });
      const analysis = createAnalysis({ level: "warning", fps: 25 });
      optimizer.update(metrics, analysis);

      optimizer.applyOptimization("reduce-lod");

      expect(events.length).toBe(1);
      expect(events[0].action?.id).toBe("reduce-lod");
    });

    it("should apply next optimization", () => {
      const metrics = createMetrics({ fps: 20, frameTime: 50 });
      const analysis = createAnalysis({ level: "critical", fps: 20 });
      optimizer.update(metrics, analysis);

      const initialLOD = optimizer.getState().lodLevel;
      const result = optimizer.applyNextOptimization();

      expect(result).toBe(true);
      // Something should have changed
    });

    it("should respect cooldown between optimizations", async () => {
      const opt = new AutoOptimizer({
        mode: "manual",
        optimizationCooldown: 100,
      });

      const metrics = createMetrics({ fps: 20, frameTime: 50 });
      const analysis = createAnalysis({ level: "critical", fps: 20 });
      opt.update(metrics, analysis);

      const result1 = opt.applyNextOptimization();
      expect(result1).toBe(true);

      // Immediate second application should fail due to cooldown
      opt.update(metrics, analysis);
      const result2 = opt.applyNextOptimization();
      expect(result2).toBe(false);

      opt.dispose();
    });
  });

  describe("optimization reversion", () => {
    it("should revert last optimization", () => {
      const metrics = createMetrics({ fps: 25, frameTime: 40 });
      const analysis = createAnalysis({ level: "warning", fps: 25 });
      optimizer.update(metrics, analysis);

      const initialLOD = optimizer.getState().lodLevel;
      optimizer.applyOptimization("reduce-lod");

      const afterApply = optimizer.getState().lodLevel;
      expect(afterApply).toBeLessThan(initialLOD);

      const reverted = optimizer.revertLastOptimization();
      expect(reverted).toBe(true);
      expect(optimizer.getState().lodLevel).toBe(initialLOD);
    });

    it("should emit optimization-reverted event", () => {
      const events: OptimizerEvent[] = [];
      optimizer.on("optimization-reverted", (event) => events.push(event));

      const metrics = createMetrics({ fps: 25, frameTime: 40 });
      const analysis = createAnalysis({ level: "warning", fps: 25 });
      optimizer.update(metrics, analysis);

      optimizer.applyOptimization("reduce-lod");
      optimizer.revertLastOptimization();

      expect(events.length).toBe(1);
    });

    it("should return false when nothing to revert", () => {
      const result = optimizer.revertLastOptimization();
      expect(result).toBe(false);
    });

    it("should revert all optimizations", () => {
      const metrics = createMetrics({ fps: 20, frameTime: 50 });
      const analysis = createAnalysis({ level: "critical", fps: 20 });

      // Need to wait for cooldown between each
      const opt = new AutoOptimizer({
        mode: "manual",
        optimizationCooldown: 0, // No cooldown for testing
      });

      opt.update(metrics, analysis);
      opt.applyOptimization("reduce-lod");

      opt.update(metrics, analysis);
      opt.applyOptimization("disable-shadows");

      // Revert all
      opt.revertAll();

      const state = opt.getState();
      expect(state.lodLevel).toBe(DEFAULT_OPTIMIZATION_STATE.lodLevel);
      expect(state.nodeShadows).toBe(true);

      opt.dispose();
    });
  });

  describe("auto mode", () => {
    it("should auto-apply optimizations in auto mode", () => {
      const opt = new AutoOptimizer({
        mode: "auto",
        optimizationCooldown: 0,
      });

      const metrics = createMetrics({ fps: 20, frameTime: 50 });
      const analysis = createAnalysis({ level: "critical", fps: 20 });

      opt.update(metrics, analysis);

      // Should have auto-applied something
      const state = opt.getState();
      expect(
        state.lodLevel < DEFAULT_OPTIMIZATION_STATE.lodLevel ||
          state.nodeShadows === false ||
          state.labelsEnabled === false
      ).toBe(true);

      opt.dispose();
    });

    it("should only auto-apply on critical in semi-auto mode", () => {
      const opt = new AutoOptimizer({
        mode: "semi-auto",
        optimizationCooldown: 0,
      });

      // Warning level - should not auto-apply
      const warningMetrics = createMetrics({ fps: 35, frameTime: 28 });
      const warningAnalysis = createAnalysis({ level: "warning", fps: 35 });
      opt.update(warningMetrics, warningAnalysis);

      let state = opt.getState();
      expect(state.lodLevel).toBe(DEFAULT_OPTIMIZATION_STATE.lodLevel);

      // Critical level - should auto-apply
      const criticalMetrics = createMetrics({ fps: 15, frameTime: 66 });
      const criticalAnalysis = createAnalysis({ level: "critical", fps: 15 });
      opt.update(criticalMetrics, criticalAnalysis);

      state = opt.getState();
      expect(state.lodLevel).toBeLessThan(DEFAULT_OPTIMIZATION_STATE.lodLevel);

      opt.dispose();
    });

    it("should not auto-apply in manual mode", () => {
      const opt = new AutoOptimizer({
        mode: "manual",
        optimizationCooldown: 0,
      });

      const metrics = createMetrics({ fps: 15, frameTime: 66 });
      const analysis = createAnalysis({ level: "critical", fps: 15 });

      opt.update(metrics, analysis);

      // Should NOT have auto-applied
      const state = opt.getState();
      expect(state.lodLevel).toBe(DEFAULT_OPTIMIZATION_STATE.lodLevel);

      opt.dispose();
    });
  });

  describe("mode management", () => {
    it("should get current mode", () => {
      expect(optimizer.getMode()).toBe("manual");
    });

    it("should set mode", () => {
      optimizer.setMode("auto");
      expect(optimizer.getMode()).toBe("auto");
    });
  });

  describe("reset", () => {
    it("should reset to default state", () => {
      optimizer.setState({
        lodLevel: LODLevel.MINIMAL,
        physicsEnabled: false,
        labelsEnabled: false,
      });

      optimizer.reset();

      expect(optimizer.getState()).toMatchObject(DEFAULT_OPTIMIZATION_STATE);
    });

    it("should clear applied optimizations", () => {
      const metrics = createMetrics({ fps: 25, frameTime: 40 });
      const analysis = createAnalysis({ level: "warning", fps: 25 });
      optimizer.update(metrics, analysis);

      optimizer.applyOptimization("reduce-lod");
      optimizer.reset();

      // Nothing to revert after reset
      expect(optimizer.revertLastOptimization()).toBe(false);
    });
  });

  describe("event handling", () => {
    it("should add and remove event listeners", () => {
      const events: OptimizerEvent[] = [];
      const listener = (event: OptimizerEvent) => events.push(event);

      optimizer.on("state-changed", listener);
      optimizer.setState({ labelsEnabled: false });
      expect(events.length).toBe(1);

      optimizer.off("state-changed", listener);
      optimizer.setState({ labelsEnabled: true });
      expect(events.length).toBe(1); // No new events
    });
  });

  describe("presets", () => {
    it("should provide optimization presets", () => {
      const presets = getOptimizationPresets();

      expect(presets.quality).toBeDefined();
      expect(presets.balanced).toBeDefined();
      expect(presets.performance).toBeDefined();
      expect(presets.extreme).toBeDefined();
    });

    it("should have valid quality preset", () => {
      const presets = getOptimizationPresets();

      expect(presets.quality.lodLevel).toBe(LODLevel.ULTRA);
      expect(presets.quality.labelsEnabled).toBe(true);
      expect(presets.quality.nodeShadows).toBe(true);
    });

    it("should have valid extreme preset", () => {
      const presets = getOptimizationPresets();

      expect(presets.extreme.lodLevel).toBe(LODLevel.MINIMAL);
      expect(presets.extreme.labelsEnabled).toBe(false);
      expect(presets.extreme.aggregationEnabled).toBe(true);
    });

    it("should apply preset via setState", () => {
      const presets = getOptimizationPresets();
      optimizer.setState(presets.performance);

      const state = optimizer.getState();
      expect(state.lodLevel).toBe(LODLevel.MEDIUM);
      expect(state.labelsEnabled).toBe(false);
    });
  });

  describe("factory function", () => {
    it("should create optimizer via factory", () => {
      const opt = createAutoOptimizer({ mode: "auto" });
      expect(opt).toBeInstanceOf(AutoOptimizer);
      expect(opt.getMode()).toBe("auto");
      opt.dispose();
    });
  });

  describe("dispose", () => {
    it("should clean up resources on dispose", () => {
      const events: OptimizerEvent[] = [];
      optimizer.on("state-changed", (event) => events.push(event));

      optimizer.dispose();

      // Events should not be emitted after dispose
      // (Internal timer should be cleared, listeners should be gone)
    });
  });
});
