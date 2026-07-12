import { DateFormatter, extractAssetReference } from "@kitelev/exocortex-core";
import type {
  IGroundingService,
  IVaultAdapter,
  IFile,
  IFileSystemWriter,
  UserInput,
} from "@kitelev/exocortex-core";

/**
 * `instantiatePrototypeSubtree` — generic `service_call` grounding that clones a
 * whole WBS **prototype subtree** into a concrete instance graph in one shot.
 *
 * Issue kitelev/exocortex#3881 (Gap 3). Motivating use case: the quarterly
 * review-sheet (`ems__ProjectPrototype` «Ревьюшница {{сотрудник}} {{квартал}}»
 * `d4b5bbf8` + 9 `ems__TaskPrototype`/`ems__WaitingCheckTaskPrototype` children
 * with an `ems__Effort_blocker` chain). One click deploys the whole 10-node
 * subgraph for one employee × one quarter — but the mechanism is domain-agnostic
 * (any prototype subtree, any substitution params).
 *
 * The command is a button ON the root prototype, so `targetIRI` = the root. The
 * command's `inputSchema` collects the substitution params (e.g. `сотрудник`,
 * `квартал`) — each an asset ref.
 *
 * Per node it:
 *  - **discovers** the subtree = root + all descendants reachable via
 *    `ems__EffortPrototype_parentEffortPrototype` (transitive BFS);
 *  - **derives the instance class** by stripping the `Prototype` suffix from the
 *    prototype node's class label (the existing `createCreateAssetService`
 *    convention): `ems__ProjectPrototype`→`ems__Project`,
 *    `ems__TaskPrototype`→`ems__Task`,
 *    `ems__WaitingCheckTaskPrototype`→`ems__WaitingCheckTask`;
 *  - **substitutes** every `{{key}}` in the label/aliases with the resolved label
 *    of `userInput[key]` (person label, quarter label, …);
 *  - **re-maps** the `ems__Effort_blocker` edge onto the CLONED sibling (not the
 *    prototype) via a prototype-uid → new-instance-uid map;
 *  - links children to the root INSTANCE via `ems__Effort_parent` (WBS
 *    containment) and records provenance via `exo__Asset_prototype` → the source
 *    prototype node;
 *  - on the root, adds **structured `exo__Asset_relates`** for every non-Project
 *    ref-param (person + quarter — differentiated by target class, req #3881
 *    Fork A) and sets `ems__Effort_parent` to a Project-classed ref-param when
 *    one is supplied, else standalone (Fork B).
 *
 * Storage-agnostic: all reads go through `IVaultAdapter` (`getAllFiles` +
 * `getFrontmatter`), all writes through `IFileSystemWriter.createFile`, so the
 * plugin (Obsidian) and CLI (Node fs) runtimes produce identical state.
 */

const BACKLOG_STATUS_UID = "753a44d5-846c-4b82-9196-4fd9a4d48777";
const PARENT_PROTOTYPE_KEY = "ems__EffortPrototype_parentEffortPrototype";
// The `exo__Class` metaclass — an asset is a CLASS DEFINITION iff its
// `exo__Instance_class` is this metaclass. Used to resolve an instance-class
// LABEL (e.g. «ems__Project») back to the class asset's UID so the written
// `exo__Instance_class` ref is the canonical UID-alias form `[[uid|label]]`
// (what `apply create-task` writes) rather than a DANGLING symbolic-label
// `[[ems__Project]]` (class files are UID-named, so `ems__Project.md` does not
// exist → Obsidian shows a broken link). Issue #3908.
const CLASS_METACLASS_UID = "8619c4fc-64f1-4869-b17e-e34186cacca9";

interface IndexEntry {
  file: IFile;
  fm: Record<string, unknown>;
  uid: string;
}

// The local `extractRef` was a 4th re-implementation of the canonical
// `extractAssetReference` (`packages/core/src/utilities/extractAssetReference.ts`,
// created specifically to de-triplicate this exact helper — audit #3384 finding
// H4). De-duplicated per issue #3896 (M4): import the canonical one instead of
// maintaining a divergent copy. (It returns `string | null` where the local one
// returned `string | undefined` — semantically identical at every guarded
// callsite here.)

/** The alias part of `[[uid|alias]]`, if present. */
function extractAlias(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const m = value.match(/\[\[[^\]|]+\|([^\]]+)\]\]/);
  return m ? m[1].trim() : undefined;
}

/**
 * Read a scalar frontmatter value as plain text, stripping a single layer of
 * surrounding quotes. The Obsidian adapter (metadataCache) already returns
 * unquoted values; the CLI adapter may surface the raw quoted YAML scalar — so
 * we normalise defensively (a label read twice must not accumulate quotes).
 */
function plainScalar(value: unknown): string {
  const raw = String(firstValue(value) ?? "");
  const m = raw.match(/^"(.*)"$|^'(.*)'$/);
  return m ? (m[1] ?? m[2] ?? "") : raw;
}

function firstValue(v: unknown): unknown {
  return Array.isArray(v) ? v[0] : v;
}

/** UID from an `obsidian://vault/…/<uid>.md` IRI, a bare path, or a bare uid. */
function uidFromIRI(iri: string): string {
  const noQuery = iri.replace(/\.md$/, "");
  const last = noQuery.substring(noQuery.lastIndexOf("/") + 1);
  return decodeURIComponent(last);
}

export function createInstantiatePrototypeSubtreeService(
  vaultAdapter: IVaultAdapter,
  fsAdapter: IFileSystemWriter,
): IGroundingService {
  return {
    async execute(targetIRI: string, userInput?: UserInput): Promise<void> {
      // 1. Index the vault once: uid → {file, frontmatter}.
      const byUid = new Map<string, IndexEntry>();
      for (const file of vaultAdapter.getAllFiles()) {
        const fm = vaultAdapter.getFrontmatter(file) as Record<
          string,
          unknown
        > | null;
        if (!fm) continue;
        const uid = (fm.exo__Asset_uid as string | undefined) ?? file.basename;
        byUid.set(uid, { file, fm, uid });
      }

      // Resolve a class ref to its label. Alias-form (`[[uid|ems__Project]]`)
      // wins; a UID-form ref resolves via uid→label; a symbolic ref
      // (`[[ems__Project]]`) IS already the label, so use it verbatim.
      const classLabel = (classRef: unknown): string | undefined => {
        const alias = extractAlias(firstValue(classRef));
        if (alias) return alias;
        const ref = extractAssetReference(firstValue(classRef));
        if (!ref) return undefined;
        const entry = byUid.get(ref);
        return entry ? plainScalar(entry.fm.exo__Asset_label) : ref;
      };

      // Resolve an instance-class LABEL (e.g. «ems__Project») to the UID of its
      // class-DEFINITION asset — the UID-named file whose `exo__Asset_label` is
      // that label AND whose `exo__Instance_class` is the `exo__Class` metaclass.
      // Strict: only a genuine class definition qualifies (never a same-labelled
      // instance), so a miss means a genuinely absent class → fail-loud below.
      // The class def is always co-mounted with the prototype it clones (the M1
      // pre-pass already resolves the prototype's own bare-UID class ref via the
      // same TBox).
      const classUidByLabel = (label: string): string | undefined => {
        for (const [uid, entry] of byUid) {
          if (plainScalar(entry.fm.exo__Asset_label) !== label) continue;
          const isClassDef =
            extractAssetReference(firstValue(entry.fm.exo__Instance_class)) ===
            CLASS_METACLASS_UID;
          if (isClassDef) return uid;
        }
        return undefined;
      };

      // 2. Resolve the root prototype.
      const rootUid = uidFromIRI(targetIRI);
      const root = byUid.get(rootUid);
      if (!root) {
        throw new Error(
          `instantiatePrototypeSubtree: root prototype not found for target "${targetIRI}" (uid ${rootUid})`,
        );
      }

      // 3. BFS-discover the subtree via parentEffortPrototype (transitive).
      const subtree = new Set<string>([rootUid]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const [uid, entry] of byUid) {
          if (subtree.has(uid)) continue;
          const parentUid = extractAssetReference(firstValue(entry.fm[PARENT_PROTOTYPE_KEY]));
          if (parentUid && subtree.has(parentUid)) {
            subtree.add(uid);
            grew = true;
          }
        }
      }

      // 4. prototype-uid → new-instance-uid.
      const instUid = new Map<string, string>();
      for (const uid of subtree) instUid.set(uid, crypto.randomUUID());

      // 5. Resolve substitution params + classify ref-params (Fork A/B).
      //    `{{key}}` → resolved label of userInput[key]; person/quarter refs →
      //    root `exo__Asset_relates`; Project-classed ref → root Effort_parent.
      const substitutions: Record<string, string> = {};
      const relatesRefs: string[] = [];
      let parentEffortRef: string | undefined;
      for (const [key, raw] of Object.entries(userInput ?? {})) {
        if (raw == null) continue;
        if (key === "label" || key === "body") continue;
        const refUid = extractAssetReference(firstValue(raw));
        const target = refUid ? byUid.get(refUid) : undefined;
        if (target) {
          const targetLabel = target.fm.exo__Asset_label
            ? plainScalar(target.fm.exo__Asset_label)
            : undefined;
          substitutions[key] = targetLabel ?? String(raw);
          const clsLabel = classLabel(target.fm.exo__Instance_class) ?? "";
          if (clsLabel.includes("Project")) {
            if (!parentEffortRef) parentEffortRef = refUid ?? undefined;
          } else {
            relatesRefs.push(refUid as string);
          }
        } else {
          // Raw scalar param (e.g. a quarter typed as text) — substitute literally.
          substitutions[key] = String(raw);
        }
      }

      const substitute = (text: unknown): string => {
        let s = String(text ?? "");
        for (const [key, val] of Object.entries(substitutions)) {
          s = s.split(`{{${key}}}`).join(val);
        }
        return s;
      };

      // M2 idempotency guard (issue #3896): refuse to re-deploy the same subtree.
      // A prior deployment is an existing instance whose `exo__Asset_prototype` is
      // this root prototype AND whose `exo__Asset_relates` set equals the current
      // ref-params (person + quarter + any non-Project ref). An accidental
      // double-click therefore aborts with an explicit error instead of silently
      // generating a second full N-node subgraph. A different ref-param set (a
      // different employee/quarter) is NOT blocked.
      const relatesSet = new Set(relatesRefs);
      for (const entry of byUid.values()) {
        const protoRef = extractAssetReference(
          firstValue(entry.fm.exo__Asset_prototype),
        );
        if (protoRef !== rootUid) continue;
        const rel = entry.fm.exo__Asset_relates;
        const existingRelates = new Set(
          (Array.isArray(rel) ? rel : rel != null ? [rel] : [])
            .map((r) => extractAssetReference(r))
            .filter((r): r is string => r != null),
        );
        if (
          existingRelates.size === relatesSet.size &&
          [...relatesSet].every((r) => existingRelates.has(r))
        ) {
          throw new Error(
            `instantiatePrototypeSubtree: already deployed — an instance of prototype ${rootUid} with the same ref-params [${[...relatesSet].join(", ")}] already exists (${entry.file.path}). Refusing to duplicate the subgraph.`,
          );
        }
      }

      // M1 fail-loud pre-pass (issue #3896, extended #3908): resolve every node's
      // canonical instance-class ref BEFORE any write, so a malformed subtree (a
      // node whose `exo__Instance_class` is missing/unresolvable) OR an absent
      // class definition aborts the whole deployment instead of silently writing
      // a dangling class wikilink. Two dangling forms are prevented:
      //   (a) `[[undefined]]` — the prototype's own class is unresolvable;
      //   (b) `[[ems__Project]]` — the derived instance-class LABEL cannot be
      //       resolved to its UID-named class file (#3908). Both are dangling in
      //       Obsidian. The map caches `[[uid|label]]` per node for the write
      //       loop. No-null for a domain output; atomic — zero partial state.
      const instClassRef = new Map<string, string>();
      for (const protoUid of subtree) {
        const entry = byUid.get(protoUid);
        if (!entry) continue;
        const protoClassLabel = classLabel(entry.fm.exo__Instance_class);
        const instClassLabel =
          protoClassLabel && protoClassLabel.endsWith("Prototype")
            ? protoClassLabel.slice(0, -"Prototype".length)
            : protoClassLabel;
        if (!instClassLabel) {
          throw new Error(
            `instantiatePrototypeSubtree: cannot resolve instance class for subtree node ${protoUid} (${entry.file.path}) — its exo__Instance_class is missing or unresolvable. Aborting so no asset is written with a dangling [[undefined]] class.`,
          );
        }
        const classUid = classUidByLabel(instClassLabel);
        if (!classUid) {
          throw new Error(
            `instantiatePrototypeSubtree: cannot resolve class UID for instance class «${instClassLabel}» (subtree node ${protoUid}, ${entry.file.path}) — no class-definition asset with that label is loaded. Aborting so no asset is written with a dangling [[${instClassLabel}]] class wikilink.`,
          );
        }
        instClassRef.set(protoUid, `[[${classUid}|${instClassLabel}]]`);
      }

      // 6. Write each instance. Co-locate in the prototype node's folder.
      const createdAt = DateFormatter.toISOTimestamp(new Date());
      // Deterministic order (root first) so any read-back is stable.
      const ordered = [rootUid, ...[...subtree].filter((u) => u !== rootUid)];
      for (const protoUid of ordered) {
        const entry = byUid.get(protoUid);
        if (!entry) continue;
        const { file, fm } = entry;
        const newUid = instUid.get(protoUid) as string;

        // Canonical `[[uid|label]]` class ref, resolved + validated in the M1
        // pre-pass (#3908) — never a dangling `[[label]]` symbolic ref.
        const classRef = instClassRef.get(protoUid) as string;

        const label = substitute(plainScalar(fm.exo__Asset_label));

        const lines: string[] = ["---", `exo__Asset_uid: ${newUid}`];
        if (fm.exo__Asset_isDefinedBy) {
          lines.push(
            `exo__Asset_isDefinedBy: "[[${extractAssetReference(firstValue(fm.exo__Asset_isDefinedBy))}]]"`,
          );
        }
        lines.push(
          `exo__Asset_createdAt: ${createdAt}`,
          `exo__Asset_updatedAt: ${createdAt}`,
          "exo__Instance_class:",
          `  - "${classRef}"`,
          `exo__Asset_label: ${JSON.stringify(label)}`,
          "aliases:",
          `  - ${JSON.stringify(label)}`,
          `exo__Asset_prototype: "[[${protoUid}]]"`,
          `ems__Effort_status: "[[${BACKLOG_STATUS_UID}]]"`,
        );

        // Blocker re-map onto the cloned sibling (fall back to original if the
        // blocker target is outside the subtree).
        const blockerUid = extractAssetReference(firstValue(fm.ems__Effort_blocker));
        if (blockerUid) {
          const mapped = instUid.get(blockerUid) ?? blockerUid;
          lines.push(`ems__Effort_blocker: "[[${mapped}]]"`);
        }

        if (protoUid === rootUid) {
          if (relatesRefs.length > 0) {
            lines.push("exo__Asset_relates:");
            for (const ref of relatesRefs) lines.push(`  - "[[${ref}]]"`);
          }
          if (parentEffortRef) {
            lines.push(`ems__Effort_parent: "[[${parentEffortRef}]]"`);
          }
        } else {
          // WBS containment: every non-root clone parents to the root instance.
          lines.push(
            `ems__Effort_parent: "[[${instUid.get(rootUid) as string}]]"`,
          );
        }

        lines.push("---", "");
        const content = lines.join("\n");

        const slash = file.path.lastIndexOf("/");
        const folder = slash >= 0 ? file.path.substring(0, slash) : "";
        const filePath = folder ? `${folder}/${newUid}.md` : `${newUid}.md`;
        await fsAdapter.createFile(filePath, content);
      }
    },
  };
}
