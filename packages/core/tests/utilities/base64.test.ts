/**
 * Issue #3486: iOS WebKit has no Node `Buffer` global — bare `Buffer`
 * references in packages/core broke the entire mobile ExoSync leg
 * («Can't find variable: Buffer», 6/14 repos errored, pushed 0 pulled 0).
 *
 * These tests pin the platform-neutral base64 helpers that replace the
 * `Buffer` call sites:
 *  - roundtrips: UTF-8 (ASCII / cyrillic / emoji), binary, empty;
 *  - whitespace tolerance (GitHub blob API embeds newlines in base64);
 *  - missing-padding tolerance;
 *  - BIT-EXACT output equivalence with the previous `Buffer` path
 *    (Buffer IS available here — jest runs in Node; it stays banned in
 *    src by archgate MOBILE-003);
 *  - mobile runtime simulation: helpers work with the `Buffer` global
 *    deleted (mirrors the iOS webview).
 */
import {
  bytesToBase64,
  base64ToBytes,
  base64ToUtf8,
  utf8ToBase64,
} from "../../src/utilities/base64";

const utf8Samples = [
  "",
  "hello world",
  "Кириллица: Алматы, Казахстан",
  "emoji: 🚀🧠🇰🇿 combining: é ñ ü",
  "mixed\nnewlines\tand\ttabs",
  '{"frontmatter":"exo__Asset_label","value":"Задача"}',
];

function allBytes(): Uint8Array {
  const bytes = new Uint8Array(256);
  for (let i = 0; i < 256; i++) bytes[i] = i;
  return bytes;
}

describe("base64 helpers (Issue #3486 — platform-neutral, no Buffer)", () => {
  describe("UTF-8 roundtrip", () => {
    it.each(utf8Samples)("roundtrips %j", (text) => {
      expect(base64ToUtf8(utf8ToBase64(text))).toBe(text);
    });
  });

  describe("binary roundtrip", () => {
    it("roundtrips all 256 byte values", () => {
      const bytes = allBytes();
      expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    });

    it("roundtrips a large pseudo-random payload (chunking path)", () => {
      // > 0x8000 to exercise the chunked encoder (stack-safe fromCharCode).
      const bytes = new Uint8Array(200_000);
      for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) % 256;
      expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    });

    it("roundtrips empty bytes", () => {
      expect(bytesToBase64(new Uint8Array(0))).toBe("");
      expect(base64ToBytes("")).toEqual(new Uint8Array(0));
    });
  });

  describe("whitespace tolerance (GitHub blob API embeds newlines)", () => {
    it("decodes base64 with embedded newlines to the same text", () => {
      const clean = utf8ToBase64("Кириллица + emoji 🚀 across GitHub blobs");
      const withNewlines = clean.replace(/(.{8})/g, "$1\n");
      expect(base64ToUtf8(withNewlines)).toBe(
        "Кириллица + emoji 🚀 across GitHub blobs",
      );
    });

    it("decodes base64 with mixed whitespace (spaces, tabs, CRLF)", () => {
      const clean = bytesToBase64(allBytes());
      const noisy = clean.replace(/(.{10})/g, "$1\r\n \t");
      expect(base64ToBytes(noisy)).toEqual(allBytes());
    });
  });

  describe("padding tolerance", () => {
    it("decodes unpadded base64 (length % 4 === 2 and 3)", () => {
      // "QQ" → "A" (needs ==), "QUI" → "AB" (needs =)
      expect(base64ToUtf8("QQ")).toBe("A");
      expect(base64ToUtf8("QUI")).toBe("AB");
    });

    it("throws on impossible base64 length (length % 4 === 1)", () => {
      expect(() => base64ToBytes("QQQQQ")).toThrow();
    });

    it("throws on invalid base64 characters (fail-loud, unlike Buffer)", () => {
      expect(() => base64ToBytes("Q!Q@")).toThrow();
    });
  });

  describe("BOM preservation (bit-exact with Buffer.toString)", () => {
    it("keeps a leading UTF-8 BOM as U+FEFF like Buffer did", () => {
      const bomBytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]); // BOM + "hi"
      const b64 = bytesToBase64(bomBytes);
      expect(base64ToUtf8(b64)).toBe(Buffer.from(bomBytes).toString("utf-8"));
      expect(base64ToUtf8(b64)).toBe("﻿hi");
    });

    it("roundtrips a string starting with U+FEFF", () => {
      const text = "﻿frontmatter";
      expect(base64ToUtf8(utf8ToBase64(text))).toBe(text);
    });
  });

  describe("output equivalence with the previous Buffer path", () => {
    it.each(utf8Samples)(
      "utf8ToBase64(%j) === Buffer.from(text, 'utf-8').toString('base64')",
      (text) => {
        expect(utf8ToBase64(text)).toBe(
          Buffer.from(text, "utf-8").toString("base64"),
        );
      },
    );

    it("bytesToBase64 matches Buffer.from(bytes).toString('base64')", () => {
      const bytes = allBytes();
      expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
    });

    it("base64ToUtf8 matches Buffer.from(b64, 'base64').toString('utf-8') incl. lone-surrogate U+FFFD", () => {
      // Lone surrogate encodes as U+FFFD in both TextEncoder and Buffer.
      const tricky = "lone \uD800 surrogate";
      const viaBuffer = Buffer.from(tricky, "utf-8").toString("base64");
      expect(utf8ToBase64(tricky)).toBe(viaBuffer);
      expect(base64ToUtf8(viaBuffer)).toBe(
        Buffer.from(viaBuffer, "base64").toString("utf-8"),
      );
    });
  });

  describe("mobile runtime simulation (no Buffer global, like iOS WebKit)", () => {
    it("all four helpers work with the Buffer global deleted", () => {
      const saved = globalThis.Buffer;
      try {
        delete (globalThis as { Buffer?: unknown }).Buffer;
        const text = "Кириллица 🚀 без Buffer";
        const b64 = utf8ToBase64(text);
        expect(base64ToUtf8(b64)).toBe(text);
        const bytes = new Uint8Array([0, 1, 2, 250, 255]);
        expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
      } finally {
        (globalThis as { Buffer?: unknown }).Buffer = saved;
      }
    });
  });
});
