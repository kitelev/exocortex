import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";

jest.unstable_mockModule("exocortex", () => ({
  IEventBus: class {},
}));

const { NodeEventBus } = await import("../../../src/infrastructure/di/NodeEventBus.js");

describe("NodeEventBus", () => {
  let eventBus: InstanceType<typeof NodeEventBus>;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    eventBus = new NodeEventBus();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("subscribe()", () => {
    it("should subscribe to event", () => {
      const handler = jest.fn();
      eventBus.subscribe("testEvent", handler);
      eventBus.publish("testEvent", { data: "test" });

      expect(handler).toHaveBeenCalledWith({ data: "test" });
    });

    it("should return unsubscribe function", () => {
      const handler = jest.fn();
      const unsubscribe = eventBus.subscribe("testEvent", handler);

      unsubscribe();
      eventBus.publish("testEvent", { data: "test" });

      expect(handler).not.toHaveBeenCalled();
    });

    it("should support multiple handlers for same event", () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      eventBus.subscribe("testEvent", handler1);
      eventBus.subscribe("testEvent", handler2);
      eventBus.publish("testEvent", "data");

      expect(handler1).toHaveBeenCalledWith("data");
      expect(handler2).toHaveBeenCalledWith("data");
    });
  });

  describe("publish()", () => {
    it("should publish event to all subscribers", () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      eventBus.subscribe("testEvent", handler1);
      eventBus.subscribe("testEvent", handler2);

      eventBus.publish("testEvent", { value: 42 });

      expect(handler1).toHaveBeenCalledWith({ value: 42 });
      expect(handler2).toHaveBeenCalledWith({ value: 42 });
    });

    it("should not fail if no subscribers", () => {
      expect(() => {
        eventBus.publish("nonExistentEvent", "data");
      }).not.toThrow();
    });

    it("should catch handler errors and log them", () => {
      const errorHandler = jest.fn(() => {
        throw new Error("Handler error");
      });
      const normalHandler = jest.fn();

      eventBus.subscribe("testEvent", errorHandler);
      eventBus.subscribe("testEvent", normalHandler);

      eventBus.publish("testEvent", "data");

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[EventBus] Error in handler for event "testEvent"'),
        expect.any(Error)
      );
      // Other handlers should still be called
      expect(normalHandler).toHaveBeenCalledWith("data");
    });

    it("should support different data types", () => {
      const handler = jest.fn();
      eventBus.subscribe("testEvent", handler);

      eventBus.publish("testEvent", "string");
      expect(handler).toHaveBeenLastCalledWith("string");

      eventBus.publish("testEvent", 123);
      expect(handler).toHaveBeenLastCalledWith(123);

      eventBus.publish("testEvent", { complex: [1, 2, 3] });
      expect(handler).toHaveBeenLastCalledWith({ complex: [1, 2, 3] });
    });
  });

  describe("unsubscribe()", () => {
    it("should unsubscribe handler from event", () => {
      const handler = jest.fn();
      eventBus.subscribe("testEvent", handler);

      eventBus.unsubscribe("testEvent", handler);
      eventBus.publish("testEvent", "data");

      expect(handler).not.toHaveBeenCalled();
    });

    it("should only unsubscribe specified handler", () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      eventBus.subscribe("testEvent", handler1);
      eventBus.subscribe("testEvent", handler2);

      eventBus.unsubscribe("testEvent", handler1);
      eventBus.publish("testEvent", "data");

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalledWith("data");
    });

    it("should not fail if event has no handlers", () => {
      const handler = jest.fn();
      expect(() => {
        eventBus.unsubscribe("nonExistentEvent", handler);
      }).not.toThrow();
    });

    it("should clean up empty handler sets", () => {
      const handler = jest.fn();
      eventBus.subscribe("testEvent", handler);
      eventBus.unsubscribe("testEvent", handler);

      // After unsubscribing the only handler, publishing should work without handlers
      eventBus.publish("testEvent", "data");
      expect(handler).not.toHaveBeenCalled();
    });
  });
});
