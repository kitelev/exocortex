/**
 * Phase 6.5 migration service — Knowledge/Focus dual-class assignment for
 * FocusProfile instances + relocation from `assetspaces/shared-identities/`
 * к `assetspaces/profiles/` (kitelev/exoas-profiles submodule).
 *
 * Per RFC 13da049f (Phase 6 consumer) + sibling onto-RFC 52f2acdd.
 *
 * Scope (intentionally narrow):
 *  - FocusProfile instances → relocate к profiles/ + add KnowledgeProfile class
 *  - ExoAssistant identity → relocate к exo/ (out of overnight scope, marked TODO)
 *  - Other shared-identities content → untouched (future migration phase)
 *
 * Idempotent: re-running against partially-migrated vault skips already-moved files.
 *
 * Defensive: dry-run output mirrors apply mode exactly. Apply mode requires
 * --apply flag + --profiles-dir pointing к exoas-profiles submodule working tree.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import * as path from "node:path";

/**
 * Pre-allocated UIDs from sibling onto-RFC 52f2acdd.
 */
export const KNOWLEDGE_PROFILE_CLASS_UID = "b8884976-596f-43d2-b7f4-3da518f825d4";
export const KNOWLEDGE_PROFILE_INCLUDES_UID = "4c118802-258d-47f6-8a4e-4b13e04077b2";
export const KNOWLEDGE_PROFILE_EXTENDS_UID = "a1f42d5a-237c-4104-83d5-152b4960f964";
export const KNOWLEDGE_PROFILE_ALWAYS_ON_OVERLAY_UID = "103dab8d-5a7c-46d2-a82a-f4db4b5aef3c";
export const FOCUS_PROFILE_CLASS_UID = "3de846cd-1f0e-4f98-8613-b8587aa15174";

export type MigrationAction =
  | { kind: "relocate-and-dual-class"; uid: string; label: string; srcPath: string; profilesDirPath: string }
  | { kind: "already-migrated"; uid: string; label: string; profilesDirPath: string }
  | { kind: "skip-not-focus-profile"; uid: string; label: string; srcPath: string };

export interface MigrationPlan {
  vaultPath: string;
  sharedIdentitiesPath: string;
  profilesDirPath: string;
  actions: MigrationAction[];
  summary: {
    relocate: number;
    alreadyMigrated: number;
    skipped: number;
  };
}

export interface PlanOptions {
  vaultPath: string;
  profilesDirRelative?: string;
}

export interface ApplyOptions extends PlanOptions {
  /** Defaults к dry-run if false. */
  apply: boolean;
}

export interface ApplyResult {
  plan: MigrationPlan;
  applied: Array<{ kind: string; uid: string; from: string; to: string }>;
  errors: Array<{ uid: string; srcPath: string; reason: string }>;
}

/**
 * Reads ALL .md files в `assetspaces/shared-identities/`, identifies which are
 * FocusProfile instances, and produces a migration plan.
 */
export class SharedIdentitiesProfileMigrationService {
  /**
   * Generate plan — read-only, no mutations.
   */
  generatePlan(opts: PlanOptions): MigrationPlan {
    const sharedPath = path.join(opts.vaultPath, "assetspaces", "shared-identities");
    const profilesRel = opts.profilesDirRelative ?? "assetspaces/profiles";
    const profilesPath = path.join(opts.vaultPath, profilesRel);

    const actions: MigrationAction[] = [];

    if (!existsSync(sharedPath)) {
      return {
        vaultPath: opts.vaultPath,
        sharedIdentitiesPath: sharedPath,
        profilesDirPath: profilesPath,
        actions,
        summary: { relocate: 0, alreadyMigrated: 0, skipped: 0 },
      };
    }

    const entries = readdirSync(sharedPath).filter((f) => f.endsWith(".md"));

    for (const fname of entries) {
      const srcPath = path.join(sharedPath, fname);
      const uid = fname.replace(/\.md$/, "");
      const { label, isFocusProfile } = this.parseSourceFile(srcPath);

      if (!isFocusProfile) {
        actions.push({ kind: "skip-not-focus-profile", uid, label, srcPath });
        continue;
      }

      const targetPath = path.join(profilesPath, fname);
      if (existsSync(targetPath)) {
        actions.push({ kind: "already-migrated", uid, label, profilesDirPath: targetPath });
        continue;
      }

      actions.push({ kind: "relocate-and-dual-class", uid, label, srcPath, profilesDirPath: targetPath });
    }

    return {
      vaultPath: opts.vaultPath,
      sharedIdentitiesPath: sharedPath,
      profilesDirPath: profilesPath,
      actions,
      summary: {
        relocate: actions.filter((a) => a.kind === "relocate-and-dual-class").length,
        alreadyMigrated: actions.filter((a) => a.kind === "already-migrated").length,
        skipped: actions.filter((a) => a.kind === "skip-not-focus-profile").length,
      },
    };
  }

  /**
   * Execute plan (apply mode). Writes к both vault и profilesDir.
   * Idempotent: re-running на already-migrated state = no-op.
   *
   * IMPORTANT: caller must ensure `profilesDir` is a fresh git working tree
   * for `kitelev/exoas-profiles` repo. This service does NOT call git.
   * Commit + push happens via wrapping command after success.
   */
  apply(opts: ApplyOptions): ApplyResult {
    const plan = this.generatePlan(opts);
    const applied: ApplyResult["applied"] = [];
    const errors: ApplyResult["errors"] = [];

    if (!opts.apply) {
      return { plan, applied, errors };
    }

    // Ensure profiles dir exists.
    if (!existsSync(plan.profilesDirPath)) {
      mkdirSync(plan.profilesDirPath, { recursive: true });
    }

    for (const action of plan.actions) {
      if (action.kind !== "relocate-and-dual-class") continue;

      try {
        const transformed = this.transformProfileFile(action.srcPath);
        writeFileSync(action.profilesDirPath, transformed, "utf8");
        // Delete original AFTER successful write (atomic semantic).
        renameSync(action.srcPath, action.srcPath + ".migrated-backup");
        applied.push({
          kind: "relocate-and-dual-class",
          uid: action.uid,
          from: action.srcPath,
          to: action.profilesDirPath,
        });
      } catch (err) {
        errors.push({
          uid: action.uid,
          srcPath: action.srcPath,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { plan, applied, errors };
  }

  /**
   * Normalize EOL + strip UTF-8 BOM. Defensive against CRLF (Windows / некоторые
   * Obsidian Sync клиенты) и BOM-prefixed files (legacy migration scripts).
   * Per PR #3359 code-reviewer round-1 HIGH findings.
   */
  private normalizeContent(raw: string): string {
    return raw.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  }

  /**
   * Parse just enough frontmatter к determine class membership + label.
   * Avoids full YAML parser dependency; relies on regex против UID-form
   * wikilinks + label-form fallback.
   */
  private parseSourceFile(srcPath: string): { label: string; isFocusProfile: boolean } {
    const content = this.normalizeContent(readFileSync(srcPath, "utf8"));
    const frontmatterMatch = content.match(/^---\n([\s\S]+?)\n---/);
    if (frontmatterMatch === null) {
      return { label: "<no-frontmatter>", isFocusProfile: false };
    }
    const fm = frontmatterMatch[1];
    const labelMatch = fm.match(/^exo__Asset_label:\s*(.+)$/m);
    const label = labelMatch !== null ? labelMatch[1].trim() : "<no-label>";

    // exo__Instance_class can be array OR string. FocusProfile detection:
    // (a) UID-form: contains FOCUS_PROFILE_CLASS_UID
    // (b) Label-form: contains `exo__FocusProfile`
    const isFocusProfile =
      fm.includes(FOCUS_PROFILE_CLASS_UID) ||
      /exo__Instance_class:\s*[\s\S]*?\[\[exo__FocusProfile/.test(fm);

    return { label, isFocusProfile };
  }

  /**
   * Transform FocusProfile source file → dual-class (KnowledgeProfile + FocusProfile).
   *
   * Rules per RFC 13da049f §Backward compat:
   * 1. Add `[[<KP-class-uid>]]` к `exo__Instance_class` array (preserve FocusProfile)
   * 2. Copy `exo__FocusProfile_includes` к `exo__KnowledgeProfile_includes` (same list)
   * 3. Copy `exo__FocusProfile_extends` к `exo__KnowledgeProfile_extends` если present
   * 4. Copy `exo__FocusProfile_alwaysOnOverlay` к `exo__KnowledgeProfile_alwaysOnOverlay` если present
   * 5. Preserve original FocusProfile_* properties (no removal — dual semantic)
   *
   * Idempotent: skips transformation if KnowledgeProfile class already added.
   */
  private transformProfileFile(srcPath: string): string {
    const content = this.normalizeContent(readFileSync(srcPath, "utf8"));
    const fmMatch = content.match(/^(---\n[\s\S]+?\n---)(\n[\s\S]*)?$/);
    if (fmMatch === null) {
      throw new Error(`Source file ${srcPath} has no parseable frontmatter`);
    }
    const fm = fmMatch[1];
    const body = fmMatch[2] ?? "";

    // Already dual-class? Skip transformation.
    if (fm.includes(KNOWLEDGE_PROFILE_CLASS_UID)) {
      return content;
    }

    // Add KnowledgeProfile UID к Instance_class array.
    let newFm = fm.replace(
      /(exo__Instance_class:\s*\n((?:\s+-\s+.+\n)+))/,
      (_match, _full, items: string) => {
        const newLine = `  - "[[${KNOWLEDGE_PROFILE_CLASS_UID}]]"\n`;
        return `exo__Instance_class:\n${newLine}${items}`;
      },
    );

    // Add KnowledgeProfile_includes mirroring FocusProfile_includes.
    const includesMatch = newFm.match(/(exo__FocusProfile_includes:\s*\n((?:\s+-\s+.+\n)+))/);
    if (includesMatch !== null) {
      const includesList = includesMatch[2];
      const knowledgeIncludes = `exo__KnowledgeProfile_includes:\n${includesList}`;
      newFm = newFm.replace(includesMatch[1], `${includesMatch[1]}${knowledgeIncludes}`);
    }

    // Mirror _extends (single-value property).
    const extendsMatch = newFm.match(/(exo__FocusProfile_extends:\s*.+\n)/);
    if (extendsMatch !== null) {
      const value = extendsMatch[1].replace("FocusProfile_extends", "KnowledgeProfile_extends");
      newFm = newFm.replace(extendsMatch[1], `${extendsMatch[1]}${value}`);
    }

    // Mirror _alwaysOnOverlay.
    const overlayMatch = newFm.match(/(exo__FocusProfile_alwaysOnOverlay:\s*\n((?:\s+-\s+.+\n)+))/);
    if (overlayMatch !== null) {
      const overlayList = overlayMatch[2];
      const knowledgeOverlay = `exo__KnowledgeProfile_alwaysOnOverlay:\n${overlayList}`;
      newFm = newFm.replace(overlayMatch[1], `${overlayMatch[1]}${knowledgeOverlay}`);
    }

    return newFm + body;
  }
}

