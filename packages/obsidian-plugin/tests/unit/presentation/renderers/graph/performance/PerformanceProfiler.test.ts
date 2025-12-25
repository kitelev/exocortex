/**
 * Tests for PerformanceProfiler - Comprehensive performance profiling for graph visualization
 *
 * @module presentation/renderers/graph/performance
 * @since 1.0.0
 */

import {
  PerformanceProfiler,
  createPerformanceProfiler,
  getGlobalProfiler,
  resetGlobalProfiler,
  DEFAULT_PROFILER_OPTIONS,
  type PerformanceMetrics,
  type ProfilerEvent,
} from "../../../../../../src/presentation/renderers/graph/performance/PerformanceProfiler";

describe("PerformanceProfiler", () => {
  let profiler: PerformanceProfiler;

  beforeEach(() => {
    profiler = new PerformanceProfiler({ autoProfile: false });
  });

  afterEach(() => {
    profiler.dispose();
    resetGlobalProfiler();
  });

  describe("initialization", () => {
    it("should create with default options", () => {
      const p = new PerformanceProfiler();
      expect(p.getOptions().sampleSize).toBe(DEFAULT_PROFILER_OPTIONS.sampleSize);
      expect(p.getOptions().warningThreshold).toBe(DEFAULT_PROFILER_OPTIONS.warningThreshold);
      p.dispose();
    });

    it("should accept custom options", () => {
      const customOptions = {
        sampleSize: 30,
        warningThreshold: 20,
        criticalThreshold: 40,
      };
      const p = new PerformanceProfiler(customOptions);
      expect(p.getOptions().sampleSize).toBe(30);
      expect(p.getOptions().warningThreshold).toBe(20);
      expect(p.getOptions().criticalThreshold).toBe(40);
      p.dispose();
    });

    it("should start inactive when autoProfile is false", () => {
      expect(profiler.isProfilerActive()).toBe(false);
    });

    it("should start active when autoProfile is true", () => {
      const p = new PerformanceProfiler({ autoProfile: true });
      expect(p.isProfilerActive()).toBe(true);
      p.dispose();
    });
  });

  describe("frame profiling", () => {
    it("should record frame metrics", () => {
      profiler.beginFrame();
      profiler.endFrame();

      const metrics = profiler.getCurrentMetrics();
      expect(metrics).not.toBeNull();
      expect(metrics?.frameTime).toBeGreaterThanOrEqual(0);
      expect(metrics?.timestamp).toBeDefined();
    });

    it("should track multiple frames", () => {
      for (let i = 0; i < 5; i++) {
        profiler.beginFrame();
        profiler.endFrame();
      }

      expect(profiler.getSampleCount()).toBe(5);
    });

    it("should respect maxHistorySize", () => {
      const p = new PerformanceProfiler({
        autoProfile: false,
        maxHistorySize: 3,
      });

      for (let i = 0; i < 10; i++) {
        p.beginFrame();
        p.endFrame();
      }

      expect(p.getSampleCount()).toBe(3);
      p.dispose();
    });

    it("should auto-end previous frame if not closed", () => {
      profiler.beginFrame();
      profiler.beginFrame(); // Should auto-end the previous frame

      expect(profiler.getSampleCount()).toBe(1);
    });
  });

  describe("section timing", () => {
    it("should track render section time", () => {
      profiler.beginFrame();
      profiler.beginSection("render");
      // Simulate some work
      const start = performance.now();
      while (performance.now() - start < 1) {
        // busy wait for ~1ms
      }
      profiler.endSection("render");
      profiler.endFrame();

      const metrics = profiler.getCurrentMetrics();
      expect(metrics?.renderTime).toBeGreaterThan(0);
    });

    it("should track physics section time", () => {
      profiler.beginFrame();
      profiler.beginSection("physics");
      profiler.endSection("physics");
      profiler.endFrame();

      const metrics = profiler.getCurrentMetrics();
      expect(metrics?.physicsTime).toBeGreaterThanOrEqual(0);
    });

    it("should track layout section time", () => {
      profiler.beginFrame();
      profiler.beginSection("layout");
      profiler.endSection("layout");
      profiler.endFrame();

      const metrics = profiler.getCurrentMetrics();
      expect(metrics?.layoutTime).toBeGreaterThanOrEqual(0);
    });

    it("should track dataUpdate section time", () => {
      profiler.beginFrame();
      profiler.beginSection("dataUpdate");
      profiler.endSection("dataUpdate");
      profiler.endFrame();

      const metrics = profiler.getCurrentMetrics();
      expect(metrics?.dataUpdateTime).toBeGreaterThanOrEqual(0);
    });

    it("should accumulate multiple render sub-sections", () => {
      profiler.beginFrame();

      profiler.beginSection("nodeRender");
      profiler.endSection("nodeRender");

      profiler.beginSection("edgeRender");
      profiler.endSection("edgeRender");

      profiler.beginSection("labelRender");
      profiler.endSection("labelRender");

      profiler.endFrame();

      const metrics = profiler.getCurrentMetrics();
      expect(metrics?.renderTime).toBeGreaterThanOrEqual(0);
    });

    it("should auto-end previous section", () => {
      profiler.beginFrame();
      profiler.beginSection("render");
      profiler.beginSection("physics"); // Should auto-end render
      profiler.endSection("physics");
      profiler.endFrame();

      // Should not throw
      expect(profiler.getSampleCount()).toBe(1);
    });
  });

  describe("custom metrics", () => {
    it("should set draw call count", () => {
      profiler.beginFrame();
      profiler.setDrawCallCount(150);
      profiler.endFrame();

      const metrics = profiler.getCurrentMetrics();
      expect(metrics?.drawCalls).toBe(150);
    });

    it("should set triangle count", () => {
      profiler.beginFrame();
      profiler.setTriangleCount(50000);
      profiler.endFrame();

      const metrics = profiler.getCurrentMetrics();
      expect(metrics?.triangleCount).toBe(50000);
    });

    it("should set visible counts", () => {
      profiler.beginFrame();
      profiler.setVisibleCounts(5000, 8000);
      profiler.endFrame();

      const metrics = profiler.getCurrentMetrics();
      expect(metrics?.visibleNodes).toBe(5000);
      expect(metrics?.visibleEdges).toBe(8000);
    });
  });

  describe("average metrics", () => {
    it("should calculate average metrics", () => {
      for (let i = 0; i < 3; i++) {
        profiler.beginFrame();
        profiler.setVisibleCounts(1000 + i * 100, 2000);
        profiler.endFrame();
      }

      const avg = profiler.getAverageMetrics();
      expect(avg.visibleNodes).toBe(1100); // (1000 + 1100 + 1200) / 3
      expect(avg.visibleEdges).toBe(2000);
    });

    it("should return empty metrics when no samples", () => {
      const avg = profiler.getAverageMetrics();
      expect(avg.frameTime).toBe(0);
      expect(avg.fps).toBe(0);
    });
  });

  describe("frame analysis", () => {
    it("should analyze performance level", () => {
      // Record some fast frames
      for (let i = 0; i < 10; i++) {
        profiler.beginFrame();
        profiler.endFrame();
      }

      const analysis = profiler.getAnalysis();
      expect(analysis.level).toBeDefined();
      expect(["excellent", "good", "warning", "critical"]).toContain(
        analysis.level
      );
    });

    it("should calculate hit rates", () => {
      for (let i = 0; i < 10; i++) {
        profiler.beginFrame();
        profiler.endFrame();
      }

      const analysis = profiler.getAnalysis();
      expect(analysis.hitRate60).toBeGreaterThanOrEqual(0);
      expect(analysis.hitRate60).toBeLessThanOrEqual(100);
      expect(analysis.hitRate30).toBeGreaterThanOrEqual(0);
      expect(analysis.hitRate30).toBeLessThanOrEqual(100);
    });

    it("should identify bottleneck section", () => {
      profiler.beginFrame();
      profiler.beginSection("physics");
      // Simulate slow physics
      const start = performance.now();
      while (performance.now() - start < 5) {
        // busy wait
      }
      profiler.endSection("physics");
      profiler.endFrame();

      const analysis = profiler.getAnalysis();
      // Physics should be the bottleneck
      expect(analysis.bottleneck).toBe("physics");
      expect(analysis.bottleneckPercentage).toBeGreaterThan(0);
    });

    it("should return null bottleneck when no data", () => {
      const analysis = profiler.getAnalysis();
      expect(analysis.bottleneck).toBeNull();
    });
  });

  describe("event handling", () => {
    it("should emit frame events", () => {
      const frameEvents: ProfilerEvent[] = [];
      profiler.on("frame", (event) => frameEvents.push(event));

      profiler.beginFrame();
      profiler.endFrame();

      expect(frameEvents.length).toBe(1);
      expect(frameEvents[0].type).toBe("frame");
      expect(frameEvents[0].metrics).toBeDefined();
    });

    it("should emit warning events for slow frames", () => {
      const p = new PerformanceProfiler({
        autoProfile: false,
        warningThreshold: 0.1, // Very low threshold - 0.1ms
        criticalThreshold: 100, // High critical so we get warning, not critical
      });

      const warningEvents: ProfilerEvent[] = [];
      const frameEvents: ProfilerEvent[] = [];
      p.on("warning", (event) => warningEvents.push(event));
      p.on("frame", (event) => frameEvents.push(event));

      p.beginFrame();
      // Busy wait to ensure frame takes more than 0.1ms (reliable even on CI)
      const start = performance.now();
      while (performance.now() - start < 10) {
        // Busy wait for ~10ms to reliably exceed threshold
      }
      p.endFrame();

      // Debug: check frame time
      expect(frameEvents.length).toBe(1);
      const frameTime = frameEvents[0].metrics.frameTime;
      expect(frameTime).toBeGreaterThan(0.1);

      // Should emit warning since frameTime > warningThreshold and < criticalThreshold
      expect(warningEvents.length).toBeGreaterThanOrEqual(1);
      p.dispose();
    });

    it("should remove event listeners", () => {
      const events: ProfilerEvent[] = [];
      const listener = (event: ProfilerEvent) => events.push(event);

      profiler.on("frame", listener);
      profiler.off("frame", listener);

      profiler.beginFrame();
      profiler.endFrame();

      expect(events.length).toBe(0);
    });
  });

  describe("sample management", () => {
    it("should return samples in time range", () => {
      const now = Date.now();

      profiler.beginFrame();
      profiler.endFrame();

      const samples = profiler.getSamples(now - 1000, now + 1000);
      expect(samples.length).toBe(1);
    });

    it("should return all samples when no range specified", () => {
      for (let i = 0; i < 5; i++) {
        profiler.beginFrame();
        profiler.endFrame();
      }

      const samples = profiler.getSamples();
      expect(samples.length).toBe(5);
    });

    it("should reset samples", () => {
      for (let i = 0; i < 5; i++) {
        profiler.beginFrame();
        profiler.endFrame();
      }

      profiler.reset();
      expect(profiler.getSampleCount()).toBe(0);
    });
  });

  describe("auto report", () => {
    it("should start and stop auto report", () => {
      profiler.startAutoReport();
      expect(profiler.isProfilerActive()).toBe(true);

      profiler.stopAutoReport();
      expect(profiler.isProfilerActive()).toBe(false);
    });
  });

  describe("factory functions", () => {
    it("should create profiler via factory", () => {
      const p = createPerformanceProfiler({ sampleSize: 100 });
      expect(p).toBeInstanceOf(PerformanceProfiler);
      expect(p.getOptions().sampleSize).toBe(100);
      p.dispose();
    });

    it("should provide global profiler instance", () => {
      const global1 = getGlobalProfiler();
      const global2 = getGlobalProfiler();
      expect(global1).toBe(global2);
    });

    it("should reset global profiler", () => {
      const global1 = getGlobalProfiler();
      resetGlobalProfiler();
      const global2 = getGlobalProfiler();
      expect(global1).not.toBe(global2);
    });
  });
});
