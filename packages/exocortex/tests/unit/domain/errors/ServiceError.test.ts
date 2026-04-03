import { describe, it, expect } from "@jest/globals";
import { ServiceError } from "../../../../src/domain/errors/ServiceError";
import { ApplicationError } from "../../../../src/domain/errors/ApplicationError";
import { ErrorCode } from "../../../../src/domain/errors/ErrorCode";

describe("ServiceError", () => {
  it("should create error with correct code", () => {
    const error = new ServiceError("Service initialization failed");
    expect(error.code).toBe(ErrorCode.INTERNAL_ERROR);
  });

  it("should not be retriable", () => {
    const error = new ServiceError("Internal failure");
    expect(error.retriable).toBe(false);
  });

  it("should have service-specific guidance", () => {
    const error = new ServiceError("Dependency not available");
    expect(error.guidance).toContain("internal service error");
    expect(error.guidance).toContain("service initialization");
  });

  it("should extend ApplicationError", () => {
    const error = new ServiceError("Test");
    expect(error).toBeInstanceOf(ApplicationError);
    expect(error).toBeInstanceOf(Error);
  });

  it("should accept context", () => {
    const error = new ServiceError("Failed", { service: "TaskService" });
    expect(error.context).toEqual({ service: "TaskService" });
  });

  it("should have correct name", () => {
    const error = new ServiceError("Test");
    expect(error.name).toBe("ServiceError");
  });

  it("should have timestamp", () => {
    const error = new ServiceError("Test");
    expect(error.timestamp).toBeInstanceOf(Date);
  });

  it("should format correctly", () => {
    const error = new ServiceError("Config missing", { key: "API_KEY" });
    const formatted = error.format();
    expect(formatted).toContain("ServiceError");
    expect(formatted).toContain("Config missing");
    expect(formatted).toContain("API_KEY");
  });

  it("should serialize to JSON", () => {
    const error = new ServiceError("Serialization test");
    const json = error.toJSON();
    expect(json.name).toBe("ServiceError");
    expect(json.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(json.retriable).toBe(false);
  });

  it("should work without context", () => {
    const error = new ServiceError("No context");
    expect(error.context).toBeUndefined();
    const formatted = error.format();
    expect(formatted).not.toContain("📋 Context:");
  });
});
