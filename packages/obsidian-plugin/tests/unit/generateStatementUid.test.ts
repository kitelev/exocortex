import { generateStatementUid } from "../../src/presentation/modals/PropertyEditorModal";

/**
 * @req:d8ac0a94-d1aa-4cc4-b4af-471898dc15a1
 *
 * The statement-asset UID generator must draw randomness from a crypto-secure
 * source (crypto.randomUUID / crypto.getRandomValues) — NEVER Math.random
 * (CodeQL js/insecure-randomness, alert 313). Behaviour preserved: a valid
 * lowercase RFC-4122 v4 UUID.
 */
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("generateStatementUid", () => {
  const realCrypto = globalThis.crypto;

  afterEach(() => {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: realCrypto,
    });
    jest.restoreAllMocks();
  });

  it("returns a valid lowercase v4 UUID via crypto.randomUUID (primary path)", () => {
    const id = generateStatementUid();
    expect(id).toMatch(UUID_V4);
    expect(id).toBe(id.toLowerCase());
  });

  it("@req:d8ac0a94-d1aa-4cc4-b4af-471898dc15a1 falls back to crypto.getRandomValues — never Math.random — when randomUUID is unavailable", () => {
    // Simulate an environment (e.g. an older mobile WebView) where crypto exists
    // but crypto.randomUUID does not — forcing the fallback path.
    const getRandomValues = jest.fn((arr: Uint8Array) => {
      for (let i = 0; i < arr.length; i++) arr[i] = (i * 37 + 11) & 0xff;
      return arr;
    });
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: { getRandomValues },
    });
    const mathRandom = jest.spyOn(Math, "random");

    const id = generateStatementUid();

    // crypto-secure source was used …
    expect(getRandomValues).toHaveBeenCalled();
    // … and the insecure source was NOT (this assertion is what reverts to RED
    // on the old Math.random fallback).
    expect(mathRandom).not.toHaveBeenCalled();
    // … behaviour preserved: still a valid lowercase v4 UUID.
    expect(id).toMatch(UUID_V4);
  });
});
