import type { IFileSystemMetadataProvider } from "../interfaces/IFileSystemAdapter";
import type { ClassLabelToUidResolver } from "./GroundingExecutor";

/**
 * Issue #3258 — filesystem-frontmatter-backed {@link ClassLabelToUidResolver}.
 *
 * # Why a filesystem-frontmatter resolver, not a triple-store resolver
 *
 * `GroundingExecutor.executeCreateInstance` writes `exo__Instance_class` from
 * `grounding.targetClass`. The Obsidian plugin wires
 * {@link ../../obsidian-plugin/src/infrastructure/services/ObsidianClassLabelResolver
 * createObsidianClassLabelResolver}, which reads frontmatter via the metadata
 * cache rather than via the triple store — and that distinction is **load-
 * bearing**:
 *
 *   `NoteToRDFConverter.valueToRDFObject` (lines 1095-1100) substitutes
 *   class-shaped string literals like `"ems__Task"` with the canonical
 *   class IRI (`<https://exocortex.my/ontology/ems#Task>`) when emitting
 *   triples (Issue #2782/#2959). That substitution applies to predicate
 *   `exo:Asset_label` too, so a class TBox file's own label triple has an
 *   IRI object, not a Literal — meaning `CommandResolver.findUidByLabel`
 *   (#3212) and any other triple-store label lookup returns null for
 *   class-shaped labels. This is the same production gap the plugin's
 *   alias-index resolver was created (#3223) to bridge.
 *
 * The CLI must do equivalent work: scan vault frontmatter, find the asset
 * whose `exo__Asset_label` or `aliases` matches the requested label, return
 * its `exo__Asset_uid`. The shape mirrors the plugin resolver one-for-one
 * but reads from the filesystem rather than `app.metadataCache`.
 *
 * # Cost characteristics
 *
 * `findFilesByMetadata` walks every markdown file under the vault root once
 * per call, reading frontmatter via `js-yaml`. For typical vaults (<10k
 * files) this completes in well under a second; the resolver is invoked
 * once per `create_instance` execution (rare). If profiling later flags
 * this as hot, the obvious next step is to wrap with an aliasing index
 * built from the same triple store the CLI already maintains.
 */
export function createVaultFrontmatterClassLabelResolver(
  metadataProvider: IFileSystemMetadataProvider,
): ClassLabelToUidResolver {
  return async (label: string): Promise<string | null> => {
    if (!label) return null;

    // Primary: match by exo__Asset_label.
    const byLabel = await metadataProvider.findFilesByMetadata({
      exo__Asset_label: label,
    });
    if (byLabel.length > 0) {
      const fm = await metadataProvider.getFileMetadata(byLabel[0]);
      const uid = fm["exo__Asset_uid"];
      if (typeof uid === "string" && uid.length > 0) return uid;
    }

    // Secondary: match by aliases. `findFilesByMetadata` treats array values
    // by "any element equals", which matches the plugin resolver's aliases
    // array semantics. String-valued `aliases` are matched literally.
    const byAlias = await metadataProvider.findFilesByMetadata({
      aliases: label,
    });
    if (byAlias.length > 0) {
      const fm = await metadataProvider.getFileMetadata(byAlias[0]);
      const uid = fm["exo__Asset_uid"];
      if (typeof uid === "string" && uid.length > 0) return uid;
    }

    return null;
  };
}
