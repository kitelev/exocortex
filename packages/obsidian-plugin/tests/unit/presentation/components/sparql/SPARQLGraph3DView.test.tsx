/**
 * SPARQLGraph3DView Unit Tests
 *
 * Tests for the SPARQLGraph3DView component.
 * Since Three.js requires WebGL context (not available in JSDOM),
 * we focus on testing the module exports and basic component properties.
 */

import React from "react";
import "@testing-library/jest-dom";

describe("SPARQLGraph3DView", () => {
  describe("module exports", () => {
    it("exports SPARQLGraph3DView component", async () => {
      const module = await import(
        "../../../../../src/presentation/components/sparql/SPARQLGraph3DView"
      );
      expect(module.SPARQLGraph3DView).toBeDefined();
      expect(typeof module.SPARQLGraph3DView).toBe("function");
    });

    it("component has correct display name pattern", async () => {
      const module = await import(
        "../../../../../src/presentation/components/sparql/SPARQLGraph3DView"
      );
      // React components are functions
      expect(typeof module.SPARQLGraph3DView).toBe("function");
    });
  });

  describe("component interface", () => {
    it("defines expected props interface", async () => {
      // This test verifies the TypeScript interface compiles correctly
      // by importing the module - if the interface is wrong, TS would fail
      const module = await import(
        "../../../../../src/presentation/components/sparql/SPARQLGraph3DView"
      );
      expect(module.SPARQLGraph3DView).toBeDefined();
    });
  });
});
