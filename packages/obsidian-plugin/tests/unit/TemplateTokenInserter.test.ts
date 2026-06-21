import type { Editor } from "obsidian";
import {
  clearResolvers,
  installDefaultResolvers,
  registerResolver,
} from "@kitelev/exocortex-core";
import {
  TEMPLATE_TOKEN_CHOICES,
  type TemplateTokenChoice,
  insertTemplateToken,
  resolveTokenValue,
} from "../../src/infrastructure/adapters/TemplateTokenInserter";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LOCAL_ISO_NO_TZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Minimal Editor double — only `replaceSelection` is exercised by the inserter. */
function fakeEditor(): Editor & { replaceSelection: jest.Mock } {
  return { replaceSelection: jest.fn() } as unknown as Editor & {
    replaceSelection: jest.Mock;
  };
}

describe("TemplateTokenInserter", () => {
  beforeEach(() => {
    // Reset to the real default vocabulary before each test — mirrors how the
    // registry is populated in production (GroundingExecutor / inserter import).
    clearResolvers();
    installDefaultResolvers();
  });

  describe("TEMPLATE_TOKEN_CHOICES (interview Q1 menu set)", () => {
    it("offers exactly the 3 MVP tokens with the confirmed resolver ids", () => {
      expect(TEMPLATE_TOKEN_CHOICES).toHaveLength(3);
      expect(TEMPLATE_TOKEN_CHOICES.map((c) => c.resolverId)).toEqual([
        "randomUUIDv4",
        "nowTimestamp",
        "nowDate",
      ]);
      expect(TEMPLATE_TOKEN_CHOICES.map((c) => c.label)).toEqual([
        "Random UUID",
        "Current Timestamp",
        "Current Date",
      ]);
    });

    it("is frozen (callers cannot mutate the shared list)", () => {
      expect(Object.isFrozen(TEMPLATE_TOKEN_CHOICES)).toBe(true);
    });
  });

  describe("resolveTokenValue (reuses the shared registry — Q6)", () => {
    it("Random UUID → bare lowercase v4 UUID (Q2)", () => {
      expect(resolveTokenValue("randomUUIDv4")).toMatch(UUID_V4);
    });

    it("Current Timestamp → local ISO, no timezone (Q3)", () => {
      expect(resolveTokenValue("nowTimestamp")).toMatch(LOCAL_ISO_NO_TZ);
    });

    it("Current Date → local YYYY-MM-DD (Q1)", () => {
      expect(resolveTokenValue("nowDate")).toMatch(LOCAL_DATE);
    });

    it("throws (fail-loud) for an unregistered resolver id", () => {
      expect(() => resolveTokenValue("does-not-exist")).toThrow(
        /no resolver registered/i,
      );
    });

    it("throws when a resolver yields a non-scalar (array) value", () => {
      registerResolver("listy", () => ["a", "b"]);
      expect(() => resolveTokenValue("listy")).toThrow(/scalar string/i);
    });
  });

  describe("insertTemplateToken", () => {
    it("inserts the resolved value at the cursor via editor.replaceSelection", () => {
      // Deterministic resolver so the asserted insert value is exact
      // (revert-verify discipline: change the resolver → the asserted value
      // changes; the inserter must pass exactly what the registry produced).
      registerResolver("fixed", () => "FIXED-TOKEN-VALUE");
      const choice: TemplateTokenChoice = {
        id: "fixed",
        label: "Fixed",
        resolverId: "fixed",
        description: "fixed for test",
      };
      const editor = fakeEditor();

      const returned = insertTemplateToken(editor, choice);

      expect(editor.replaceSelection).toHaveBeenCalledTimes(1);
      expect(editor.replaceSelection).toHaveBeenCalledWith("FIXED-TOKEN-VALUE");
      expect(returned).toBe("FIXED-TOKEN-VALUE");
    });

    it("passes the EXACT resolved value through to the editor for a real token", () => {
      // No fixed stub — the real randomUUIDv4 resolver produces a fresh value;
      // the inserter must insert that same value (returned === inserted).
      const editor = fakeEditor();
      const inserted = insertTemplateToken(editor, TEMPLATE_TOKEN_CHOICES[0]);

      expect(inserted).toMatch(UUID_V4);
      expect(editor.replaceSelection).toHaveBeenCalledWith(inserted);
    });

    it("does not insert when the resolver is missing (throws before write)", () => {
      const editor = fakeEditor();
      const badChoice: TemplateTokenChoice = {
        id: "x",
        label: "X",
        resolverId: "missing",
        description: "",
      };
      expect(() => insertTemplateToken(editor, badChoice)).toThrow();
      expect(editor.replaceSelection).not.toHaveBeenCalled();
    });
  });
});
