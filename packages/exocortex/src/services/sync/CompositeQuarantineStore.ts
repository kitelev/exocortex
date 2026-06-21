/**
 * ExoSync composite quarantine sink — fan-out one {@link QuarantinePort} call
 * to several members.
 *
 * Bridges the device-local conflict cache (offline-resolution foundation) and
 * the OPTIONAL synced quarantine repo while both coexist: when the user has a
 * quarantine repo configured, the engine writes to BOTH — the device-local
 * cache (so the resolver works offline) AND the synced repo (so the
 * cross-device unresolved-count keeps working). When no repo is configured the
 * factory wires the cache directly and this composite is not used.
 *
 * Zero-loss ordering: EVERY member is attempted even when an earlier one throws
 * (a network failure of the synced repo must NOT skip the local cache write, on
 * which offline durability now depends). The FIRST error is re-thrown after all
 * members ran — so the device-local cache (placed first) is always written, yet
 * a synced-store failure still surfaces to the engine, which degrades it to a
 * warning / withholds a destructive file-mode apply (conservative, no loss).
 */

import type { QuarantineEntry, QuarantinePort } from "./syncTypes";

export class CompositeQuarantineStore implements QuarantinePort {
  private readonly members: readonly QuarantinePort[];

  /** Members are attempted in order; place the durability-critical one first. */
  constructor(members: readonly QuarantinePort[]) {
    this.members = members;
  }

  async quarantine(entry: QuarantineEntry): Promise<void> {
    await this.quarantineAll([entry]);
  }

  async quarantineAll(entries: QuarantineEntry[]): Promise<void> {
    if (entries.length === 0) return;
    let firstErr: unknown;
    for (const member of this.members) {
      try {
        if (member.quarantineAll !== undefined) {
          await member.quarantineAll(entries);
        } else {
          for (const entry of entries) await member.quarantine(entry);
        }
      } catch (err) {
        if (firstErr === undefined) firstErr = err;
      }
    }
    if (firstErr !== undefined) {
      throw firstErr instanceof Error ? firstErr : new Error(String(firstErr));
    }
  }

  async markResolved(repoKey: string, path: string): Promise<void> {
    let firstErr: unknown;
    for (const member of this.members) {
      try {
        await member.markResolved?.(repoKey, path);
      } catch (err) {
        if (firstErr === undefined) firstErr = err;
      }
    }
    if (firstErr !== undefined) {
      throw firstErr instanceof Error ? firstErr : new Error(String(firstErr));
    }
  }
}
