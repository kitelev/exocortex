/**
 * 3D Types Unit Tests
 *
 * Tests for 3D graph visualization types and default configurations.
 */

import {
  DEFAULT_SCENE_3D_CONFIG,
  DEFAULT_NODE_3D_STYLE,
  DEFAULT_EDGE_3D_STYLE,
  DEFAULT_LABEL_3D_STYLE,
  DEFAULT_ORBIT_CONTROLS_CONFIG,
  DEFAULT_FORCE_SIMULATION_3D_CONFIG,
} from "@plugin/presentation/renderers/graph/3d/types3d";

describe("3D Graph Types", () => {
  describe("DEFAULT_SCENE_3D_CONFIG", () => {
    it("has valid background color", () => {
      expect(DEFAULT_SCENE_3D_CONFIG.backgroundColor).toBe(0x1a1a2e);
    });

    it("has valid light intensities", () => {
      expect(DEFAULT_SCENE_3D_CONFIG.ambientLightIntensity).toBeGreaterThan(0);
      expect(DEFAULT_SCENE_3D_CONFIG.ambientLightIntensity).toBeLessThanOrEqual(1);
      expect(DEFAULT_SCENE_3D_CONFIG.directionalLightIntensity).toBeGreaterThan(0);
      expect(DEFAULT_SCENE_3D_CONFIG.directionalLightIntensity).toBeLessThanOrEqual(1);
    });

    it("has valid camera settings", () => {
      expect(DEFAULT_SCENE_3D_CONFIG.cameraFov).toBeGreaterThan(0);
      expect(DEFAULT_SCENE_3D_CONFIG.cameraFov).toBeLessThan(180);
      expect(DEFAULT_SCENE_3D_CONFIG.cameraNear).toBeGreaterThan(0);
      expect(DEFAULT_SCENE_3D_CONFIG.cameraFar).toBeGreaterThan(DEFAULT_SCENE_3D_CONFIG.cameraNear);
    });

    it("has valid fog settings", () => {
      expect(DEFAULT_SCENE_3D_CONFIG.enableFog).toBe(true);
      expect(DEFAULT_SCENE_3D_CONFIG.fogNear).toBeGreaterThan(0);
      expect(DEFAULT_SCENE_3D_CONFIG.fogFar).toBeGreaterThan(DEFAULT_SCENE_3D_CONFIG.fogNear);
    });

    it("has valid pixel ratio", () => {
      expect(DEFAULT_SCENE_3D_CONFIG.pixelRatio).toBeGreaterThan(0);
      expect(DEFAULT_SCENE_3D_CONFIG.pixelRatio).toBeLessThanOrEqual(2);
    });
  });

  describe("DEFAULT_NODE_3D_STYLE", () => {
    it("has valid radius", () => {
      expect(DEFAULT_NODE_3D_STYLE.radius).toBeGreaterThan(0);
    });

    it("has valid color", () => {
      expect(DEFAULT_NODE_3D_STYLE.color).toBe(0x6366f1);
    });

    it("has valid material properties", () => {
      expect(DEFAULT_NODE_3D_STYLE.roughness).toBeGreaterThanOrEqual(0);
      expect(DEFAULT_NODE_3D_STYLE.roughness).toBeLessThanOrEqual(1);
      expect(DEFAULT_NODE_3D_STYLE.metalness).toBeGreaterThanOrEqual(0);
      expect(DEFAULT_NODE_3D_STYLE.metalness).toBeLessThanOrEqual(1);
    });

    it("has valid segment count for sphere geometry", () => {
      expect(DEFAULT_NODE_3D_STYLE.segments).toBeGreaterThanOrEqual(3);
    });
  });

  describe("DEFAULT_EDGE_3D_STYLE", () => {
    it("has valid line width", () => {
      expect(DEFAULT_EDGE_3D_STYLE.lineWidth).toBeGreaterThan(0);
    });

    it("has valid color", () => {
      expect(DEFAULT_EDGE_3D_STYLE.color).toBe(0x64748b);
    });

    it("has valid opacity", () => {
      expect(DEFAULT_EDGE_3D_STYLE.opacity).toBeGreaterThan(0);
      expect(DEFAULT_EDGE_3D_STYLE.opacity).toBeLessThanOrEqual(1);
    });

    it("has tube settings when useTube is enabled", () => {
      expect(DEFAULT_EDGE_3D_STYLE.tubeRadius).toBeGreaterThan(0);
      expect(DEFAULT_EDGE_3D_STYLE.tubeSegments).toBeGreaterThanOrEqual(3);
    });
  });

  describe("DEFAULT_LABEL_3D_STYLE", () => {
    it("has valid font settings", () => {
      expect(DEFAULT_LABEL_3D_STYLE.fontSize).toBeGreaterThan(0);
      expect(DEFAULT_LABEL_3D_STYLE.fontFamily).toBeTruthy();
    });

    it("has valid color", () => {
      expect(DEFAULT_LABEL_3D_STYLE.color).toBe("#e2e8f0");
    });

    it("has billboard enabled by default", () => {
      expect(DEFAULT_LABEL_3D_STYLE.billboard).toBe(true);
    });

    it("has valid scale", () => {
      expect(DEFAULT_LABEL_3D_STYLE.scale).toBeGreaterThan(0);
    });
  });

  describe("DEFAULT_ORBIT_CONTROLS_CONFIG", () => {
    it("has interaction controls enabled", () => {
      expect(DEFAULT_ORBIT_CONTROLS_CONFIG.enableRotate).toBe(true);
      expect(DEFAULT_ORBIT_CONTROLS_CONFIG.enableZoom).toBe(true);
      expect(DEFAULT_ORBIT_CONTROLS_CONFIG.enablePan).toBe(true);
    });

    it("has damping enabled for smooth interactions", () => {
      expect(DEFAULT_ORBIT_CONTROLS_CONFIG.enableDamping).toBe(true);
      expect(DEFAULT_ORBIT_CONTROLS_CONFIG.dampingFactor).toBeGreaterThan(0);
      expect(DEFAULT_ORBIT_CONTROLS_CONFIG.dampingFactor).toBeLessThan(1);
    });

    it("has valid distance limits", () => {
      expect(DEFAULT_ORBIT_CONTROLS_CONFIG.minDistance).toBeGreaterThan(0);
      expect(DEFAULT_ORBIT_CONTROLS_CONFIG.maxDistance).toBeGreaterThan(
        DEFAULT_ORBIT_CONTROLS_CONFIG.minDistance
      );
    });

    it("has valid polar angle limits", () => {
      expect(DEFAULT_ORBIT_CONTROLS_CONFIG.minPolarAngle).toBeGreaterThanOrEqual(0);
      expect(DEFAULT_ORBIT_CONTROLS_CONFIG.maxPolarAngle).toBeLessThanOrEqual(Math.PI);
    });

    it("has auto-rotate disabled by default", () => {
      expect(DEFAULT_ORBIT_CONTROLS_CONFIG.autoRotate).toBe(false);
    });
  });

  describe("DEFAULT_FORCE_SIMULATION_3D_CONFIG", () => {
    it("has valid charge strength (negative for repulsion)", () => {
      expect(DEFAULT_FORCE_SIMULATION_3D_CONFIG.chargeStrength).toBeLessThan(0);
    });

    it("has valid link distance", () => {
      expect(DEFAULT_FORCE_SIMULATION_3D_CONFIG.linkDistance).toBeGreaterThan(0);
    });

    it("has valid center strength", () => {
      expect(DEFAULT_FORCE_SIMULATION_3D_CONFIG.centerStrength).toBeGreaterThan(0);
      expect(DEFAULT_FORCE_SIMULATION_3D_CONFIG.centerStrength).toBeLessThanOrEqual(1);
    });

    it("has valid alpha settings for convergence", () => {
      expect(DEFAULT_FORCE_SIMULATION_3D_CONFIG.alpha).toBe(1);
      expect(DEFAULT_FORCE_SIMULATION_3D_CONFIG.alphaTarget).toBe(0);
      expect(DEFAULT_FORCE_SIMULATION_3D_CONFIG.alphaDecay).toBeGreaterThan(0);
      expect(DEFAULT_FORCE_SIMULATION_3D_CONFIG.alphaMin).toBeGreaterThan(0);
      expect(DEFAULT_FORCE_SIMULATION_3D_CONFIG.alphaMin).toBeLessThan(
        DEFAULT_FORCE_SIMULATION_3D_CONFIG.alpha
      );
    });

    it("has valid velocity decay", () => {
      expect(DEFAULT_FORCE_SIMULATION_3D_CONFIG.velocityDecay).toBeGreaterThan(0);
      expect(DEFAULT_FORCE_SIMULATION_3D_CONFIG.velocityDecay).toBeLessThan(1);
    });

    it("has Barnes-Hut optimization enabled", () => {
      expect(DEFAULT_FORCE_SIMULATION_3D_CONFIG.useBarnesHut).toBe(true);
      expect(DEFAULT_FORCE_SIMULATION_3D_CONFIG.theta).toBeGreaterThan(0);
      expect(DEFAULT_FORCE_SIMULATION_3D_CONFIG.theta).toBeLessThan(2);
    });
  });
});
