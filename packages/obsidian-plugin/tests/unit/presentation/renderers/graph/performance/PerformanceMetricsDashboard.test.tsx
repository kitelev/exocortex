/**
 * Tests for PerformanceMetricsDashboard - React component for performance visualization
 *
 * @module presentation/renderers/graph/performance
 * @since 1.0.0
 */

import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  PerformanceMetricsDashboard,
  PerformanceDashboardButton,
  DEFAULT_DASHBOARD_CONFIG,
  type PerformanceMetricsDashboardProps,
} from "../../../../../../src/presentation/renderers/graph/performance/PerformanceMetricsDashboard";
import type { PerformanceMetrics, FrameAnalysis } from "../../../../../../src/presentation/renderers/graph/performance/PerformanceProfiler";
import type { BottleneckAnalysis } from "../../../../../../src/presentation/renderers/graph/performance/BottleneckDetector";

// Mock metrics for testing
const mockMetrics: PerformanceMetrics = {
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
};

const mockAnalysis: FrameAnalysis = {
  level: "good",
  fps: 60,
  avgFrameTime: 16,
  variance: 1,
  hitRate60: 95,
  hitRate30: 100,
  bottleneck: null,
  bottleneckPercentage: 0,
};

const mockBottleneckAnalysis: BottleneckAnalysis = {
  bottlenecks: [],
  trends: [],
  resources: {
    cpuEstimate: 50,
    gpuEstimate: 50,
    memoryMB: 100,
    drawCallEfficiency: 500,
    visibilityRatio: 1,
  },
  healthScore: 85,
  topRecommendations: [],
  timestamp: Date.now(),
};

describe("PerformanceMetricsDashboard", () => {
  const defaultProps: PerformanceMetricsDashboardProps = {
    metrics: mockMetrics,
    analysis: mockAnalysis,
    bottleneckAnalysis: mockBottleneckAnalysis,
  };

  describe("rendering", () => {
    it("should render without crashing", () => {
      render(<PerformanceMetricsDashboard {...defaultProps} />);
      expect(screen.getByText("Performance")).toBeInTheDocument();
    });

    it("should display FPS", () => {
      render(<PerformanceMetricsDashboard {...defaultProps} />);
      expect(screen.getByText("60")).toBeInTheDocument();
    });

    it("should display health score", () => {
      render(<PerformanceMetricsDashboard {...defaultProps} />);
      expect(screen.getByText("85")).toBeInTheDocument();
    });

    it("should display frame time", () => {
      render(<PerformanceMetricsDashboard {...defaultProps} />);
      expect(screen.getByText("Frame Time")).toBeInTheDocument();
    });

    it("should show timing breakdown labels", () => {
      render(<PerformanceMetricsDashboard {...defaultProps} />);
      expect(screen.getByText("Render")).toBeInTheDocument();
      expect(screen.getByText("Physics")).toBeInTheDocument();
      expect(screen.getByText("Layout")).toBeInTheDocument();
      expect(screen.getByText("Data")).toBeInTheDocument();
    });
  });

  describe("collapsed state", () => {
    it("should render collapsed view when isCollapsed is true", () => {
      render(
        <PerformanceMetricsDashboard {...defaultProps} isCollapsed={true} />
      );
      // Collapsed view shows minimal info
      expect(screen.getByText("60 FPS")).toBeInTheDocument();
      expect(screen.queryByText("Performance")).not.toBeInTheDocument();
    });

    it("should call onToggleCollapse when collapsed view is clicked", () => {
      const onToggle = jest.fn();
      render(
        <PerformanceMetricsDashboard
          {...defaultProps}
          isCollapsed={true}
          onToggleCollapse={onToggle}
        />
      );

      fireEvent.click(screen.getByText("60 FPS"));
      expect(onToggle).toHaveBeenCalledTimes(1);
    });
  });

  describe("details view", () => {
    it("should show detailed stats when showDetails is true", () => {
      render(
        <PerformanceMetricsDashboard {...defaultProps} showDetails={true} />
      );
      expect(screen.getByText("Visible Nodes")).toBeInTheDocument();
      expect(screen.getByText("Visible Edges")).toBeInTheDocument();
      expect(screen.getByText("Draw Calls")).toBeInTheDocument();
      expect(screen.getByText("Triangles")).toBeInTheDocument();
    });

    it("should not show detailed stats when showDetails is false", () => {
      render(
        <PerformanceMetricsDashboard {...defaultProps} showDetails={false} />
      );
      expect(screen.queryByText("Visible Nodes")).not.toBeInTheDocument();
    });

    it("should call onToggleDetails when detail button is clicked", () => {
      const onToggle = jest.fn();
      render(
        <PerformanceMetricsDashboard
          {...defaultProps}
          onToggleDetails={onToggle}
        />
      );

      // Find and click the details toggle button
      const buttons = screen.getAllByRole("button");
      const detailButton = buttons.find((b) => b.textContent === "+");
      if (detailButton) {
        fireEvent.click(detailButton);
        expect(onToggle).toHaveBeenCalledTimes(1);
      }
    });
  });

  describe("no metrics state", () => {
    it("should show no metrics message when metrics is null", () => {
      render(
        <PerformanceMetricsDashboard
          metrics={null}
          analysis={null}
          bottleneckAnalysis={null}
        />
      );
      expect(screen.getByText("No metrics available")).toBeInTheDocument();
    });
  });

  describe("bottleneck display", () => {
    it("should display bottleneck alerts when present", () => {
      const propsWithBottleneck: PerformanceMetricsDashboardProps = {
        ...defaultProps,
        bottleneckAnalysis: {
          ...mockBottleneckAnalysis,
          bottlenecks: [
            {
              id: "test-bottleneck",
              name: "Test Bottleneck",
              category: "cpu",
              severity: "medium",
              sections: ["physics"],
              description: "Test description",
              metrics: {},
              recommendations: ["Fix this", "Do that"],
              impact: 25,
              confidence: 0.9,
              firstDetected: Date.now(),
              persistent: false,
            },
          ],
        },
      };

      render(<PerformanceMetricsDashboard {...propsWithBottleneck} />);
      expect(screen.getByText("Test Bottleneck")).toBeInTheDocument();
      expect(screen.getByText("25% impact")).toBeInTheDocument();
    });

    it("should expand bottleneck details on click", () => {
      const propsWithBottleneck: PerformanceMetricsDashboardProps = {
        ...defaultProps,
        bottleneckAnalysis: {
          ...mockBottleneckAnalysis,
          bottlenecks: [
            {
              id: "test-bottleneck",
              name: "Test Bottleneck",
              category: "cpu",
              severity: "medium",
              sections: ["physics"],
              description: "Test description",
              metrics: {},
              recommendations: ["Fix this"],
              impact: 25,
              confidence: 0.9,
              firstDetected: Date.now(),
              persistent: false,
            },
          ],
        },
      };

      render(<PerformanceMetricsDashboard {...propsWithBottleneck} />);

      // Click to expand
      fireEvent.click(screen.getByText("Test Bottleneck"));

      // Should show description and recommendations
      expect(screen.getByText("Test description")).toBeInTheDocument();
      expect(screen.getByText("Fix this")).toBeInTheDocument();
    });
  });

  describe("memory display", () => {
    it("should display memory usage when available", () => {
      render(<PerformanceMetricsDashboard {...defaultProps} />);
      expect(screen.getByText("Memory")).toBeInTheDocument();
    });

    it("should not display memory when memoryUsage is 0", () => {
      const propsNoMemory: PerformanceMetricsDashboardProps = {
        ...defaultProps,
        metrics: { ...mockMetrics, memoryUsage: 0 },
      };

      render(<PerformanceMetricsDashboard {...propsNoMemory} />);
      expect(screen.queryByText("Memory")).not.toBeInTheDocument();
    });
  });

  describe("historical samples", () => {
    it("should accept historical samples for trends", () => {
      const historicalSamples = Array.from({ length: 60 }, (_, i) => ({
        ...mockMetrics,
        timestamp: Date.now() - (60 - i) * 16,
        fps: 55 + Math.random() * 10,
      }));

      // Should not throw
      render(
        <PerformanceMetricsDashboard
          {...defaultProps}
          historicalSamples={historicalSamples}
        />
      );
    });
  });

  describe("configuration", () => {
    it("should respect config options", () => {
      render(
        <PerformanceMetricsDashboard
          {...defaultProps}
          config={{
            ...DEFAULT_DASHBOARD_CONFIG,
            showMemory: false,
            showBottlenecks: false,
          }}
        />
      );

      expect(screen.queryByText("Memory")).not.toBeInTheDocument();
    });
  });
});

describe("PerformanceDashboardButton", () => {
  it("should render button", () => {
    render(
      <PerformanceDashboardButton isVisible={false} onToggle={() => {}} />
    );
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("should display FPS when provided", () => {
    render(
      <PerformanceDashboardButton
        isVisible={false}
        onToggle={() => {}}
        fps={60}
      />
    );
    expect(screen.getByText("60")).toBeInTheDocument();
  });

  it("should call onToggle when clicked", () => {
    const onToggle = jest.fn();
    render(
      <PerformanceDashboardButton isVisible={false} onToggle={onToggle} />
    );

    fireEvent.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("should show different style when visible", () => {
    const { rerender } = render(
      <PerformanceDashboardButton isVisible={false} onToggle={() => {}} />
    );

    const button1 = screen.getByRole("button");
    const style1 = button1.style.backgroundColor;

    rerender(
      <PerformanceDashboardButton isVisible={true} onToggle={() => {}} />
    );

    const button2 = screen.getByRole("button");
    const style2 = button2.style.backgroundColor;

    expect(style1).not.toBe(style2);
  });
});
