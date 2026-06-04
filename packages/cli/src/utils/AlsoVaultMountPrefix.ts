/**
 * Issue #3219 — when a user invokes
 *   `exocortex sparql query --vault <primary> --also <root>/assetspaces/<sub>`
 * the `--also` path is rooted at an AssetSpace subdirectory. Without a mount
 * prefix the synthesised subject IRIs lose the `assetspaces/<sub>/` segment
 * (file.path is relative to the adapter root → bare `<file>.md`) and cannot
 * be joined with primary-vault subject IRIs that include the full path.
 *
 * The mount-prefix heuristic recognises the canonical
 *   `<anything>/assetspaces/<single-segment>(/?)$`
 * pattern and reports the matching `assetspaces/<single-segment>` so the
 * caller can pass it to `NoteToRDFConverter` as `subjectIriPrefix`.
 *
 * Returns an empty string when the path does not match — for any other
 * `--also` layout the legacy zero-prefix behaviour is preserved (backward
 * compatibility with existing test fixtures and user vaults that pass full
 * vault roots via `--also`).
 */
import { resolve } from "path";

const ASSETSPACES_SUFFIX_RE = /\/assetspaces\/([^/]+)\/?$/;

export function deriveSubjectIriPrefix(alsoPath: string): string {
  const normalised = resolve(alsoPath).replace(/\\/g, "/");
  const match = ASSETSPACES_SUFFIX_RE.exec(normalised);
  if (!match) return "";
  return `assetspaces/${match[1]}`;
}
