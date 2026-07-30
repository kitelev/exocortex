import { basename, extname } from "path";
import {
  NoteToRDFConverter,
  parseYamlFrontmatterTolerant,
  DomainTriple,
  type IFile,
} from "@kitelev/exocortex-core";
import { FileSystemVaultAdapter } from "../adapters/FileSystemVaultAdapter.js";
import {
  runShapesValidation,
  applyLegacyExceptionFilter,
  filterReportToStagedFocusNodes,
} from "../commands/validate-schema.js";
import type { ShaclConformanceViolation } from "../utils/errors/ShaclConformanceError.js";

/**
 * The candidate-scoped verdict of a SHACL-lite conformance run.
 */
export interface CandidateConformanceResult {
  /** Gating `sh:Violation` results whose focus node IS the candidate. */
  violations: ShaclConformanceViolation[];
  /**
   * Non-gating `sh:Warning` results for the candidate — unresolvable /
   * cross-vault / symbolic references that open-world semantics cannot
   * hard-fail (issue #3488). Surfaced, never blocking.
   */
  warnings: ShaclConformanceViolation[];
}

/** Matches the frontmatter block of an assembled asset (same regex the adapter uses). */
const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---/;

/**
 * Runs the SAME SHACL-lite pipeline as `validate schema --shapes-mode` against a
 * single **not-yet-written** candidate asset, scoped to that candidate's own
 * violations (project 38800c80 W3).
 *
 * ## Why this exists
 *
 * A CLI `create` runs through Bash, so the PreToolUse Write/Edit hooks never
 * fire. `create` already re-implements three of the four guarantees those hooks
 * give — co-location by `exo__Asset_isDefinedBy` (#3520/#3934), dangling
 * wikilink VALUE rejection (`WikilinkValidator`), and unknown property NAME
 * rejection (`PropertyNameValidator`, RFC 430e84f1). The fourth, SHACL-lite
 * conformance, had no CLI counterpart: the `ShapeRegistry` `create` already
 * loads is used only for cardinality-aware property *serialization*
 * (#3099/#3179), never for validation. The opt-in `create --validate` flag
 * closes that last gap.
 *
 * ## Design
 *
 * - **Reuse, do not re-implement.** The verdict comes from the very functions
 *   `validate schema --shapes-mode` uses (`runShapesValidation` —
 *   `ShapeLoader.loadFromRDFGraph` + `TripleClassHierarchy` — then
 *   `applyLegacyExceptionFilter`), so the CLI verdict is *by construction*
 *   identical to the hook's, and a shapes-semantics change lands in both at
 *   once. The Write-path hook gets the same answer by writing a temp file into
 *   the vault and filtering violations to that file's focus node; this class
 *   does the equivalent entirely in memory.
 * - **Pre-write.** The candidate's triples are produced from the exact bytes a
 *   real write would produce (`GenericAssetCreationService.buildAsset`), parsed
 *   with the SAME tolerant YAML parser `FileSystemVaultAdapter.getFrontmatter`
 *   uses, and converted through the production
 *   `NoteToRDFConverter.convertNoteFromFrontmatter` (documented to accept a
 *   synthetic `IFile` — only `path`/`basename` are read). Nothing touches disk.
 * - **Candidate-scoped.** LOAD-BEARING: without the focus-node filter every
 *   create would fail on any vault that already has violations elsewhere
 *   (vault-tbank has 7). Mirrors the hook's temp-file filter
 *   (`filterReportToStagedFocusNodes`, #3245).
 * - **Severity parity.** Only `sh:Violation` gates; `sh:Warning` is surfaced but
 *   never blocks — the same exit-code semantics `shapes-mode` applies (#3488).
 */
export class CandidateShaclValidator {
  constructor(private readonly vaultPath: string) {}

  /**
   * Validate one candidate asset that has NOT been written yet.
   *
   * @param relPath - Vault-relative path the asset WOULD be written to
   *                  (`<folder>/<uid>.md`), used as the focus-node key.
   * @param content - The exact bytes the write would produce.
   */
  async validateCandidate(
    relPath: string,
    content: string,
  ): Promise<CandidateConformanceResult> {
    const adapter = new FileSystemVaultAdapter(this.vaultPath);
    const converter = new NoteToRDFConverter(adapter);

    // Vault context: the shapes (TBox) plus every existing asset, so `sh:class`
    // range checks can resolve the candidate's references.
    const vaultTriples = (await converter.convertVault()) as DomainTriple[];

    // Candidate triples from the assembled bytes — no temp file, no disk write.
    const candidateTriples = (await converter.convertNoteFromFrontmatter(
      syntheticFile(relPath),
      extractFrontmatter(content),
    )) as DomainTriple[];

    const allTriples = [...vaultTriples, ...candidateTriples];
    const rawReport = await runShapesValidation(this.vaultPath, allTriples);
    const report = applyLegacyExceptionFilter(allTriples, rawReport);
    const scoped = filterReportToStagedFocusNodes(
      report,
      new Set([relPath]),
    );

    const violations: ShaclConformanceViolation[] = [];
    const warnings: ShaclConformanceViolation[] = [];
    for (const v of scoped.violations) {
      const entry: ShaclConformanceViolation = {
        propertyPath: iriToFrontmatterKey(v.propertyPath),
        propertyIri: v.propertyPath,
        constraint: String(v.constraint),
        message: v.message,
        ...(v.actualValue !== undefined ? { actualValue: v.actualValue } : {}),
        ...(v.expectedRange !== undefined
          ? { expectedRange: v.expectedRange }
          : {}),
      };
      if (v.severity === "sh:Violation") {
        violations.push(entry);
      } else {
        warnings.push(entry);
      }
    }

    return { violations, warnings };
  }
}

/**
 * `https://exocortex.my/ontology/<ns>#<Local>` → `<ns>__<Local>` — the
 * frontmatter KEY the caller typed, so a reported violation maps straight back
 * to the offending `--property` flag. Namespace-agnostic on purpose (unlike
 * `uriToKey`, which is limited to the curated `NAMESPACE_PREFIX_MAP` and would
 * return null for any newer namespace). Returns the raw IRI unchanged when the
 * path is not an Exocortex ontology term (a foreign/W3C predicate).
 */
function iriToFrontmatterKey(iri: string): string {
  const match = iri.match(
    /^https:\/\/exocortex\.my\/ontology\/([A-Za-z][A-Za-z0-9_]*)#(.+)$/,
  );
  return match ? `${match[1]}__${match[2]}` : iri;
}

/**
 * A minimal `IFile` for a path that does not exist on disk yet.
 * `convertNoteFromFrontmatter` reads only `path` / `basename`.
 */
function syntheticFile(relPath: string): IFile {
  const name = basename(relPath);
  return {
    path: relPath,
    basename: basename(relPath, extname(relPath)),
    name,
    parent: null,
  };
}

/**
 * Parse the candidate's frontmatter with the SAME tolerant parser
 * `FileSystemVaultAdapter.getFrontmatter` applies when reading a real file back,
 * so the candidate's triples equal the ones a post-write `convertVault` would
 * emit. Returns `null` when the content has no frontmatter block (the converter
 * then yields no triples — nothing to validate).
 */
function extractFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(FRONTMATTER_REGEX);
  if (!match) return null;
  return parseYamlFrontmatterTolerant(match[1]) as Record<
    string,
    unknown
  > | null;
}
