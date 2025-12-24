/**
 * Unit tests for Physics Worker types and constants
 */

import {
  BYTES_PER_NODE,
  FLOATS_PER_NODE,
  NODE_OFFSET,
  STATE_BUFFER_SIZE,
  STATE_OFFSET,
} from "../../../../../src/presentation/stores/physicsWorkerStore/types";

describe("Physics Worker Constants", () => {
  describe("Node buffer layout", () => {
    it("should define correct bytes per node", () => {
      // 8 floats * 4 bytes = 32 bytes
      expect(BYTES_PER_NODE).toBe(32);
    });

    it("should define correct floats per node", () => {
      expect(FLOATS_PER_NODE).toBe(8);
    });

    it("should have sequential node offsets", () => {
      expect(NODE_OFFSET.X).toBe(0);
      expect(NODE_OFFSET.Y).toBe(1);
      expect(NODE_OFFSET.VX).toBe(2);
      expect(NODE_OFFSET.VY).toBe(3);
      expect(NODE_OFFSET.FX).toBe(4);
      expect(NODE_OFFSET.FY).toBe(5);
      expect(NODE_OFFSET.RADIUS).toBe(6);
      expect(NODE_OFFSET.MASS).toBe(7);
    });

    it("should have all node offsets within bounds", () => {
      const offsets = Object.values(NODE_OFFSET);
      for (const offset of offsets) {
        expect(offset).toBeGreaterThanOrEqual(0);
        expect(offset).toBeLessThan(FLOATS_PER_NODE);
      }
    });
  });

  describe("State buffer layout", () => {
    it("should define correct state buffer size", () => {
      // 4 floats * 4 bytes = 16 bytes
      expect(STATE_BUFFER_SIZE).toBe(16);
    });

    it("should have sequential state offsets", () => {
      expect(STATE_OFFSET.ALPHA).toBe(0);
      expect(STATE_OFFSET.ALPHA_TARGET).toBe(1);
      expect(STATE_OFFSET.ALPHA_MIN).toBe(2);
      expect(STATE_OFFSET.RUNNING).toBe(3);
    });

    it("should have all state offsets within bounds", () => {
      const offsets = Object.values(STATE_OFFSET);
      for (const offset of offsets) {
        expect(offset).toBeGreaterThanOrEqual(0);
        expect(offset).toBeLessThan(STATE_BUFFER_SIZE / 4); // 4 floats
      }
    });
  });

  describe("Buffer calculations", () => {
    it("should calculate correct buffer size for nodes", () => {
      const nodeCount = 100;
      const expectedSize = nodeCount * BYTES_PER_NODE;
      expect(expectedSize).toBe(3200);
    });

    it("should calculate correct offset for node at index", () => {
      const nodeIndex = 5;
      const expectedOffset = nodeIndex * FLOATS_PER_NODE;
      expect(expectedOffset).toBe(40);
    });

    it("should access correct property at node offset", () => {
      const nodeIndex = 3;
      const baseOffset = nodeIndex * FLOATS_PER_NODE;
      const xOffset = baseOffset + NODE_OFFSET.X;
      const yOffset = baseOffset + NODE_OFFSET.Y;
      const radiusOffset = baseOffset + NODE_OFFSET.RADIUS;

      expect(xOffset).toBe(24);
      expect(yOffset).toBe(25);
      expect(radiusOffset).toBe(30);
    });
  });
});
