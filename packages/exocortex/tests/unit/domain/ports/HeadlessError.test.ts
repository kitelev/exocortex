import { HeadlessError } from "../../../../src/domain/ports/IUIProvider";

describe("HeadlessError", () => {
  it("should format message correctly with action and CLI alternative", () => {
    const error = new HeadlessError("Show Modal", '--reason "text"');

    expect(error.message).toBe(
      '"Show Modal" requires UI. CLI alternative: --reason "text"'
    );
    expect(error.action).toBe("Show Modal");
    expect(error.cliAlternative).toBe('--reason "text"');
    expect(error.name).toBe("HeadlessError");
  });

  it("should be an instance of Error", () => {
    const error = new HeadlessError("Test Action", "--test");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(HeadlessError);
  });

  it("should have correct properties accessible", () => {
    const error = new HeadlessError(
      "Input modal: title",
      "Use CLI argument instead"
    );

    expect(error.action).toBe("Input modal: title");
    expect(error.cliAlternative).toBe("Use CLI argument instead");
  });

  it("should work with empty CLI alternative", () => {
    const error = new HeadlessError("Navigate to asset", "");

    expect(error.message).toBe(
      '"Navigate to asset" requires UI. CLI alternative: '
    );
    expect(error.cliAlternative).toBe("");
  });

  it("should preserve stack trace", () => {
    const error = new HeadlessError("Action", "Alternative");

    expect(error.stack).toBeDefined();
    expect(error.stack).toContain("HeadlessError");
  });

  it("should be throwable and catchable", () => {
    expect(() => {
      throw new HeadlessError("Test", "Use --test");
    }).toThrow(HeadlessError);
  });

  it("should be catchable with error message check", () => {
    expect(() => {
      throw new HeadlessError("Interactive Selection", "--select option");
    }).toThrow('"Interactive Selection" requires UI');
  });
});
