/**
 * PoolableTypes Tests
 *
 * Tests for specialized poolable object implementations.
 */

import {
  RenderBatch,
  EventObject,
  ComputationBuffer,
  PoolableVector2D,
  PoolableRect,
  type NodePosition,
  type EdgePosition,
} from "../../../../../../src/presentation/renderers/graph/memory/PoolableTypes";

describe("RenderBatch", () => {
  let batch: RenderBatch;

  beforeEach(() => {
    batch = new RenderBatch(100, 200);
  });

  describe("constructor", () => {
    it("should create batch with default capacity", () => {
      const defaultBatch = new RenderBatch();
      expect(defaultBatch.getRemainingNodeCapacity()).toBe(1000);
      expect(defaultBatch.getRemainingEdgeCapacity()).toBe(2000);
    });

    it("should create batch with custom capacity", () => {
      expect(batch.getRemainingNodeCapacity()).toBe(100);
      expect(batch.getRemainingEdgeCapacity()).toBe(200);
    });
  });

  describe("addNode", () => {
    it("should add node to batch", () => {
      const node: NodePosition = {
        id: "node-1",
        x: 100,
        y: 200,
        radius: 8,
        color: 0xff0000,
        alpha: 1,
        zIndex: 0,
      };

      const result = batch.addNode(node);

      expect(result).toBe(true);
      expect(batch.getNodeCount()).toBe(1);
      expect(batch.getNodes()[0]).toEqual(node);
    });

    it("should reject node when at capacity", () => {
      const smallBatch = new RenderBatch(2, 2);

      smallBatch.addNode({ id: "1", x: 0, y: 0, radius: 1, color: 0, alpha: 1, zIndex: 0 });
      smallBatch.addNode({ id: "2", x: 0, y: 0, radius: 1, color: 0, alpha: 1, zIndex: 0 });

      const result = smallBatch.addNode({
        id: "3",
        x: 0,
        y: 0,
        radius: 1,
        color: 0,
        alpha: 1,
        zIndex: 0,
      });

      expect(result).toBe(false);
      expect(smallBatch.getNodeCount()).toBe(2);
    });

    it("should mark batch as dirty", () => {
      expect(batch.isDirty()).toBe(false);

      batch.addNode({ id: "1", x: 0, y: 0, radius: 1, color: 0, alpha: 1, zIndex: 0 });

      expect(batch.isDirty()).toBe(true);
    });
  });

  describe("addNodes", () => {
    it("should add multiple nodes", () => {
      const nodes: NodePosition[] = [
        { id: "1", x: 0, y: 0, radius: 1, color: 0, alpha: 1, zIndex: 0 },
        { id: "2", x: 10, y: 10, radius: 1, color: 0, alpha: 1, zIndex: 0 },
        { id: "3", x: 20, y: 20, radius: 1, color: 0, alpha: 1, zIndex: 0 },
      ];

      const added = batch.addNodes(nodes);

      expect(added).toBe(3);
      expect(batch.getNodeCount()).toBe(3);
    });

    it("should add up to capacity and return count", () => {
      const smallBatch = new RenderBatch(2, 2);
      const nodes: NodePosition[] = [
        { id: "1", x: 0, y: 0, radius: 1, color: 0, alpha: 1, zIndex: 0 },
        { id: "2", x: 0, y: 0, radius: 1, color: 0, alpha: 1, zIndex: 0 },
        { id: "3", x: 0, y: 0, radius: 1, color: 0, alpha: 1, zIndex: 0 },
      ];

      const added = smallBatch.addNodes(nodes);

      expect(added).toBe(2);
    });
  });

  describe("addEdge", () => {
    it("should add edge to batch", () => {
      const edge: EdgePosition = {
        id: "edge-1",
        sourceX: 0,
        sourceY: 0,
        targetX: 100,
        targetY: 100,
        color: 0x0000ff,
        alpha: 0.5,
        width: 2,
      };

      const result = batch.addEdge(edge);

      expect(result).toBe(true);
      expect(batch.getEdgeCount()).toBe(1);
      expect(batch.getEdges()[0]).toEqual(edge);
    });
  });

  describe("reset", () => {
    it("should clear nodes and edges", () => {
      batch.addNode({ id: "1", x: 0, y: 0, radius: 1, color: 0, alpha: 1, zIndex: 0 });
      batch.addEdge({
        id: "e1",
        sourceX: 0,
        sourceY: 0,
        targetX: 10,
        targetY: 10,
        color: 0,
        alpha: 1,
        width: 1,
      });
      batch.setFrameNumber(5);

      batch.reset();

      expect(batch.getNodeCount()).toBe(0);
      expect(batch.getEdgeCount()).toBe(0);
      expect(batch.getFrameNumber()).toBe(0);
      expect(batch.isDirty()).toBe(false);
    });
  });

  describe("capacity checks", () => {
    it("should check node capacity", () => {
      expect(batch.hasNodeCapacity()).toBe(true);

      // Fill up
      for (let i = 0; i < 100; i++) {
        batch.addNode({ id: `${i}`, x: 0, y: 0, radius: 1, color: 0, alpha: 1, zIndex: 0 });
      }

      expect(batch.hasNodeCapacity()).toBe(false);
    });

    it("should check edge capacity", () => {
      expect(batch.hasEdgeCapacity()).toBe(true);
    });

    it("should report remaining capacity", () => {
      batch.addNode({ id: "1", x: 0, y: 0, radius: 1, color: 0, alpha: 1, zIndex: 0 });
      batch.addEdge({
        id: "e1",
        sourceX: 0,
        sourceY: 0,
        targetX: 0,
        targetY: 0,
        color: 0,
        alpha: 1,
        width: 1,
      });

      expect(batch.getRemainingNodeCapacity()).toBe(99);
      expect(batch.getRemainingEdgeCapacity()).toBe(199);
    });
  });

  describe("frame management", () => {
    it("should track frame number", () => {
      batch.setFrameNumber(42);
      expect(batch.getFrameNumber()).toBe(42);
    });

    it("should have unique batch ID", () => {
      const batch2 = new RenderBatch();
      expect(batch.getBatchId()).not.toBe(batch2.getBatchId());
    });
  });

  describe("isEmpty", () => {
    it("should return true when empty", () => {
      expect(batch.isEmpty()).toBe(true);
    });

    it("should return false with nodes", () => {
      batch.addNode({ id: "1", x: 0, y: 0, radius: 1, color: 0, alpha: 1, zIndex: 0 });
      expect(batch.isEmpty()).toBe(false);
    });

    it("should return false with edges", () => {
      batch.addEdge({
        id: "e1",
        sourceX: 0,
        sourceY: 0,
        targetX: 0,
        targetY: 0,
        color: 0,
        alpha: 1,
        width: 1,
      });
      expect(batch.isEmpty()).toBe(false);
    });
  });
});

describe("EventObject", () => {
  let event: EventObject;

  beforeEach(() => {
    event = new EventObject();
  });

  describe("setters and getters", () => {
    it("should set and get type", () => {
      event.setType("nodeClick");
      expect(event.getType()).toBe("nodeClick");
    });

    it("should set and get target ID", () => {
      event.setTargetId("node-123");
      expect(event.getTargetId()).toBe("node-123");
    });

    it("should set and get position", () => {
      event.setPosition(100, 200);
      expect(event.getX()).toBe(100);
      expect(event.getY()).toBe(200);
    });

    it("should set and get world position", () => {
      event.setWorldPosition(500, 600);
      expect(event.getWorldX()).toBe(500);
      expect(event.getWorldY()).toBe(600);
    });

    it("should set and get timestamp", () => {
      event.setTimestamp(12345);
      expect(event.getTimestamp()).toBe(12345);
    });

    it("should set and get modifiers", () => {
      event.setModifiers(true, false, true);
      expect(event.isShiftKey()).toBe(true);
      expect(event.isCtrlKey()).toBe(false);
      expect(event.isAltKey()).toBe(true);
    });

    it("should set and get button", () => {
      event.setButton(2);
      expect(event.getButton()).toBe(2);
    });

    it("should set and get delta", () => {
      event.setDelta(10, -20);
      expect(event.getDeltaX()).toBe(10);
      expect(event.getDeltaY()).toBe(-20);
    });

    it("should set and get scale", () => {
      event.setScale(1.5);
      expect(event.getScale()).toBe(1.5);
    });

    it("should set and get custom data", () => {
      event.setData("custom", { foo: "bar" });
      expect(event.getData<{ foo: string }>("custom")).toEqual({ foo: "bar" });
    });
  });

  describe("chaining", () => {
    it("should support method chaining", () => {
      event
        .setType("nodeHover")
        .setTargetId("node-1")
        .setPosition(10, 20)
        .setModifiers(true, false, false);

      expect(event.getType()).toBe("nodeHover");
      expect(event.getTargetId()).toBe("node-1");
      expect(event.getX()).toBe(10);
      expect(event.isShiftKey()).toBe(true);
    });
  });

  describe("consume", () => {
    it("should mark event as consumed", () => {
      expect(event.isConsumed()).toBe(false);
      event.consume();
      expect(event.isConsumed()).toBe(true);
    });
  });

  describe("reset", () => {
    it("should reset all properties", () => {
      event
        .setType("nodeClick")
        .setTargetId("node-1")
        .setPosition(100, 200)
        .setModifiers(true, true, true)
        .setData("foo", "bar");
      event.consume();

      event.reset();

      expect(event.getType()).toBe("custom");
      expect(event.getTargetId()).toBe("");
      expect(event.getX()).toBe(0);
      expect(event.getY()).toBe(0);
      expect(event.isShiftKey()).toBe(false);
      expect(event.isConsumed()).toBe(false);
      expect(event.getData("foo")).toBeUndefined();
    });
  });

  describe("initFromMouseEvent", () => {
    it("should initialize from mouse event", () => {
      const mouseEvent = {
        clientX: 150,
        clientY: 250,
        timeStamp: 1000,
        shiftKey: true,
        ctrlKey: false,
        metaKey: true, // Cmd on Mac
        altKey: false,
        button: 0,
      } as MouseEvent;

      event.initFromMouseEvent(mouseEvent, "nodeClick");

      expect(event.getType()).toBe("nodeClick");
      expect(event.getX()).toBe(150);
      expect(event.getY()).toBe(250);
      expect(event.getTimestamp()).toBe(1000);
      expect(event.isShiftKey()).toBe(true);
      expect(event.isCtrlKey()).toBe(true); // metaKey should map to ctrl
      expect(event.isAltKey()).toBe(false);
      expect(event.getButton()).toBe(0);
    });
  });

  describe("initFromWheelEvent", () => {
    it("should initialize from wheel event", () => {
      const wheelEvent = {
        clientX: 200,
        clientY: 300,
        timeStamp: 2000,
        deltaX: 5,
        deltaY: -10,
        shiftKey: false,
        ctrlKey: true,
        metaKey: false,
        altKey: true,
      } as WheelEvent;

      event.initFromWheelEvent(wheelEvent);

      expect(event.getType()).toBe("canvasZoom");
      expect(event.getX()).toBe(200);
      expect(event.getY()).toBe(300);
      expect(event.getDeltaX()).toBe(5);
      expect(event.getDeltaY()).toBe(-10);
      expect(event.isCtrlKey()).toBe(true);
      expect(event.isAltKey()).toBe(true);
    });
  });
});

describe("ComputationBuffer", () => {
  let buffer: ComputationBuffer;

  beforeEach(() => {
    buffer = new ComputationBuffer(1024, 1024 * 1024);
  });

  describe("constructor", () => {
    it("should create buffer with initial capacity", () => {
      expect(buffer.getByteLength()).toBe(1024);
    });

    it("should use default capacities", () => {
      const defaultBuffer = new ComputationBuffer();
      expect(defaultBuffer.getByteLength()).toBe(4096);
    });
  });

  describe("resize", () => {
    it("should resize buffer to accommodate elements", () => {
      const success = buffer.resize(512);

      expect(success).toBe(true);
      expect(buffer.getSize()).toBe(512);
      // 512 float32 = 2048 bytes, buffer should grow
    });

    it("should fail if exceeds max capacity", () => {
      const smallBuffer = new ComputationBuffer(1024, 4096);
      const success = smallBuffer.resize(2000); // 2000 * 4 = 8000 bytes > 4096

      expect(success).toBe(false);
    });

    it("should grow buffer by doubling", () => {
      buffer.resize(512); // Needs 2048 bytes
      expect(buffer.getByteLength()).toBeGreaterThanOrEqual(2048);
    });
  });

  describe("typed array views", () => {
    it("should provide Float32Array view", () => {
      const view = buffer.getFloat32Array();
      expect(view).toBeInstanceOf(Float32Array);
      expect(buffer.getBufferType()).toBe("float32");
    });

    it("should provide Float64Array view", () => {
      const view = buffer.getFloat64Array();
      expect(view).toBeInstanceOf(Float64Array);
      expect(buffer.getBufferType()).toBe("float64");
    });

    it("should provide Int32Array view", () => {
      const view = buffer.getInt32Array();
      expect(view).toBeInstanceOf(Int32Array);
      expect(buffer.getBufferType()).toBe("int32");
    });

    it("should provide Uint32Array view", () => {
      const view = buffer.getUint32Array();
      expect(view).toBeInstanceOf(Uint32Array);
      expect(buffer.getBufferType()).toBe("uint32");
    });

    it("should provide Uint8Array view", () => {
      const view = buffer.getUint8Array();
      expect(view).toBeInstanceOf(Uint8Array);
      expect(buffer.getBufferType()).toBe("uint8");
    });
  });

  describe("fill", () => {
    it("should fill buffer with value", () => {
      buffer.resize(10);
      buffer.fill(42);

      const view = buffer.getFloat32Array();
      for (let i = 0; i < 10; i++) {
        expect(view[i]).toBe(42);
      }
    });

    it("should fill range", () => {
      buffer.resize(10);
      buffer.fill(0); // Clear
      buffer.fill(99, 2, 5);

      const view = buffer.getFloat32Array();
      expect(view[0]).toBe(0);
      expect(view[1]).toBe(0);
      expect(view[2]).toBe(99);
      expect(view[3]).toBe(99);
      expect(view[4]).toBe(99);
      expect(view[5]).toBe(0);
    });
  });

  describe("copyFrom", () => {
    it("should copy from another buffer", () => {
      const source = new ComputationBuffer();
      source.resize(10);
      source.getFloat32Array()[0] = 123;
      source.getFloat32Array()[1] = 456;

      buffer.copyFrom(source);

      expect(buffer.getFloat32Array()[0]).toBe(123);
      expect(buffer.getFloat32Array()[1]).toBe(456);
    });
  });

  describe("reset", () => {
    it("should reset size and type", () => {
      buffer.resize(100);
      buffer.getInt32Array(); // Change type
      buffer.getFloat32Array()[0] = 999;

      buffer.reset();

      expect(buffer.getSize()).toBe(0);
      expect(buffer.getBufferType()).toBe("float32");
      // Buffer should be zeroed
      expect(buffer.getFloat32Array()[0]).toBe(0);
    });
  });

  describe("capacity", () => {
    it("should report capacity for current type", () => {
      // 1024 bytes / 4 bytes per float32 = 256 elements
      expect(buffer.getCapacity()).toBe(256);

      buffer.getFloat64Array();
      // 1024 bytes / 8 bytes per float64 = 128 elements
      expect(buffer.getCapacity()).toBe(128);
    });
  });

  describe("raw buffer", () => {
    it("should expose raw ArrayBuffer", () => {
      const raw = buffer.getRawBuffer();
      expect(raw).toBeInstanceOf(ArrayBuffer);
    });
  });
});

describe("PoolableVector2D", () => {
  let vec: PoolableVector2D;

  beforeEach(() => {
    vec = new PoolableVector2D();
  });

  describe("basic operations", () => {
    it("should set values", () => {
      vec.set(10, 20);
      expect(vec.x).toBe(10);
      expect(vec.y).toBe(20);
    });

    it("should add vectors", () => {
      vec.set(10, 20);
      const other = new PoolableVector2D();
      other.set(5, 10);

      vec.add(other);

      expect(vec.x).toBe(15);
      expect(vec.y).toBe(30);
    });

    it("should subtract vectors", () => {
      vec.set(10, 20);
      const other = new PoolableVector2D();
      other.set(3, 5);

      vec.subtract(other);

      expect(vec.x).toBe(7);
      expect(vec.y).toBe(15);
    });

    it("should multiply by scalar", () => {
      vec.set(10, 20);
      vec.multiply(2);

      expect(vec.x).toBe(20);
      expect(vec.y).toBe(40);
    });

    it("should divide by scalar", () => {
      vec.set(10, 20);
      vec.divide(2);

      expect(vec.x).toBe(5);
      expect(vec.y).toBe(10);
    });

    it("should handle division by zero", () => {
      vec.set(10, 20);
      vec.divide(0);

      expect(vec.x).toBe(10);
      expect(vec.y).toBe(20);
    });
  });

  describe("magnitude", () => {
    it("should calculate magnitude", () => {
      vec.set(3, 4);
      expect(vec.magnitude()).toBe(5);
    });

    it("should calculate magnitude squared", () => {
      vec.set(3, 4);
      expect(vec.magnitudeSquared()).toBe(25);
    });
  });

  describe("normalize", () => {
    it("should normalize vector", () => {
      vec.set(3, 4);
      vec.normalize();

      expect(vec.magnitude()).toBeCloseTo(1, 10);
      expect(vec.x).toBeCloseTo(0.6, 10);
      expect(vec.y).toBeCloseTo(0.8, 10);
    });

    it("should handle zero vector", () => {
      vec.set(0, 0);
      vec.normalize();

      expect(vec.x).toBe(0);
      expect(vec.y).toBe(0);
    });
  });

  describe("distance", () => {
    it("should calculate distance", () => {
      vec.set(0, 0);
      const other = new PoolableVector2D();
      other.set(3, 4);

      expect(vec.distance(other)).toBe(5);
    });

    it("should calculate distance squared", () => {
      vec.set(0, 0);
      const other = new PoolableVector2D();
      other.set(3, 4);

      expect(vec.distanceSquared(other)).toBe(25);
    });
  });

  describe("dot product", () => {
    it("should calculate dot product", () => {
      vec.set(2, 3);
      const other = new PoolableVector2D();
      other.set(4, 5);

      expect(vec.dot(other)).toBe(23); // 2*4 + 3*5
    });
  });

  describe("clone and copy", () => {
    it("should clone vector", () => {
      vec.set(10, 20);
      const clone = vec.clone();

      expect(clone.x).toBe(10);
      expect(clone.y).toBe(20);
      expect(clone).not.toBe(vec);
    });

    it("should copy from other vector", () => {
      const other = new PoolableVector2D();
      other.set(99, 88);

      vec.copyFrom(other);

      expect(vec.x).toBe(99);
      expect(vec.y).toBe(88);
    });
  });

  describe("reset", () => {
    it("should reset to zero", () => {
      vec.set(100, 200);
      vec.reset();

      expect(vec.x).toBe(0);
      expect(vec.y).toBe(0);
    });
  });
});

describe("PoolableRect", () => {
  let rect: PoolableRect;

  beforeEach(() => {
    rect = new PoolableRect();
  });

  describe("basic operations", () => {
    it("should set values", () => {
      rect.set(10, 20, 100, 50);

      expect(rect.x).toBe(10);
      expect(rect.y).toBe(20);
      expect(rect.width).toBe(100);
      expect(rect.height).toBe(50);
    });

    it("should set from bounds", () => {
      rect.setFromBounds(10, 20, 110, 70);

      expect(rect.x).toBe(10);
      expect(rect.y).toBe(20);
      expect(rect.width).toBe(100);
      expect(rect.height).toBe(50);
    });
  });

  describe("edges", () => {
    it("should return correct edges", () => {
      rect.set(10, 20, 100, 50);

      expect(rect.left).toBe(10);
      expect(rect.right).toBe(110);
      expect(rect.top).toBe(20);
      expect(rect.bottom).toBe(70);
    });
  });

  describe("center", () => {
    it("should calculate center", () => {
      rect.set(10, 20, 100, 50);

      expect(rect.centerX).toBe(60);
      expect(rect.centerY).toBe(45);
    });
  });

  describe("containsPoint", () => {
    it("should detect point inside", () => {
      rect.set(0, 0, 100, 100);

      expect(rect.containsPoint(50, 50)).toBe(true);
      expect(rect.containsPoint(0, 0)).toBe(true);
      expect(rect.containsPoint(100, 100)).toBe(true);
    });

    it("should detect point outside", () => {
      rect.set(0, 0, 100, 100);

      expect(rect.containsPoint(-1, 50)).toBe(false);
      expect(rect.containsPoint(50, 101)).toBe(false);
    });
  });

  describe("intersects", () => {
    it("should detect intersection", () => {
      rect.set(0, 0, 100, 100);
      const other = new PoolableRect();
      other.set(50, 50, 100, 100);

      expect(rect.intersects(other)).toBe(true);
    });

    it("should detect no intersection", () => {
      rect.set(0, 0, 100, 100);
      const other = new PoolableRect();
      other.set(200, 200, 100, 100);

      expect(rect.intersects(other)).toBe(false);
    });

    it("should handle edge cases", () => {
      rect.set(0, 0, 100, 100);
      const touching = new PoolableRect();
      touching.set(100, 0, 100, 100); // Touching at edge

      expect(rect.intersects(touching)).toBe(true);
    });
  });

  describe("expand", () => {
    it("should expand by padding", () => {
      rect.set(10, 20, 100, 50);
      rect.expand(5);

      expect(rect.x).toBe(5);
      expect(rect.y).toBe(15);
      expect(rect.width).toBe(110);
      expect(rect.height).toBe(60);
    });
  });

  describe("union", () => {
    it("should create union of rectangles", () => {
      rect.set(0, 0, 100, 100);
      const other = new PoolableRect();
      other.set(50, 50, 100, 100);

      rect.union(other);

      expect(rect.x).toBe(0);
      expect(rect.y).toBe(0);
      expect(rect.right).toBe(150);
      expect(rect.bottom).toBe(150);
    });
  });

  describe("copyFrom", () => {
    it("should copy from other rect", () => {
      const other = new PoolableRect();
      other.set(99, 88, 77, 66);

      rect.copyFrom(other);

      expect(rect.x).toBe(99);
      expect(rect.y).toBe(88);
      expect(rect.width).toBe(77);
      expect(rect.height).toBe(66);
    });
  });

  describe("reset", () => {
    it("should reset to zero", () => {
      rect.set(10, 20, 100, 50);
      rect.reset();

      expect(rect.x).toBe(0);
      expect(rect.y).toBe(0);
      expect(rect.width).toBe(0);
      expect(rect.height).toBe(0);
    });
  });
});
