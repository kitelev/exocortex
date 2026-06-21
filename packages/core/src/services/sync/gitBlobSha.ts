/**
 * Git blob SHA computation over an injected SHA-1 (ExoSync A1, D8/D22).
 *
 * Git addresses a blob as `sha1("blob <byte-length>\0" + content)`. Computing
 * this locally lets the ChangeDetector compare disk files against remote tree
 * entries WITHOUT a git binary — the same content-addressing GitHub reports in
 * `GET git/trees`.
 */

import type { Sha1Fn } from "./syncTypes";

/**
 * @param content UTF-8 text or raw bytes (Phase C binary attachments) —
 *   git addresses both identically: the hash is over the raw byte stream.
 */
export async function gitBlobSha(
  content: string | Uint8Array,
  sha1: Sha1Fn,
): Promise<string> {
  const encoder = new TextEncoder();
  const body = typeof content === "string" ? encoder.encode(content) : content;
  const header = encoder.encode(`blob ${body.byteLength}\0`);
  const framed = new Uint8Array(header.byteLength + body.byteLength);
  framed.set(header, 0);
  framed.set(body, header.byteLength);
  return sha1(framed);
}
