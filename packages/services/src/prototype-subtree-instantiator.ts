import { DateFormatter } from "@kitelev/exocortex-core";
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

interface IndexEntry {
  file: IFile;
  fm: Record<string, unknown>;
  uid: string;
}

/** Strip surrounding quotes + `[[ ]]` + optional `|alias`, return the target UID/ref. */
function extractRef(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  let v = value.trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
  }
  const m = v.match(/^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/);
  if (m) return m[1].trim();
  return v || undefined;
}

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
        const ref = extractRef(firstValue(classRef));
        if (!ref) return undefined;
        const entry = byUid.get(ref);
        return entry ? plainScalar(entry.fm.exo__Asset_label) : ref;
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
          const parentUid = extractRef(firstValue(entry.fm[PARENT_PROTOTYPE_KEY]));
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
        const refUid = extractRef(firstValue(raw));
        const target = refUid ? byUid.get(refUid) : undefined;
        if (target) {
          const targetLabel = target.fm.exo__Asset_label
            ? plainScalar(target.fm.exo__Asset_label)
            : undefined;
          substitutions[key] = targetLabel ?? String(raw);
          const clsLabel = classLabel(target.fm.exo__Instance_class) ?? "";
          if (clsLabel.includes("Project")) {
            if (!parentEffortRef) parentEffortRef = refUid;
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

      // 6. Write each instance. Co-locate in the prototype node's folder.
      const createdAt = DateFormatter.toISOTimestamp(new Date());
      // Deterministic order (root first) so any read-back is stable.
      const ordered = [rootUid, ...[...subtree].filter((u) => u !== rootUid)];
      for (const protoUid of ordered) {
        const entry = byUid.get(protoUid);
        if (!entry) continue;
        const { file, fm } = entry;
        const newUid = instUid.get(protoUid) as string;

        const protoClassLabel = classLabel(fm.exo__Instance_class);
        const instClassLabel =
          protoClassLabel && protoClassLabel.endsWith("Prototype")
            ? protoClassLabel.slice(0, -"Prototype".length)
            : protoClassLabel;

        const label = substitute(plainScalar(fm.exo__Asset_label));

        const lines: string[] = ["---", `exo__Asset_uid: ${newUid}`];
        if (fm.exo__Asset_isDefinedBy) {
          lines.push(
            `exo__Asset_isDefinedBy: "[[${extractRef(firstValue(fm.exo__Asset_isDefinedBy))}]]"`,
          );
        }
        lines.push(
          `exo__Asset_createdAt: ${createdAt}`,
          `exo__Asset_updatedAt: ${createdAt}`,
          "exo__Instance_class:",
          `  - "[[${instClassLabel}]]"`,
          `exo__Asset_label: ${JSON.stringify(label)}`,
          "aliases:",
          `  - ${JSON.stringify(label)}`,
          `exo__Asset_prototype: "[[${protoUid}]]"`,
          `ems__Effort_status: "[[${BACKLOG_STATUS_UID}]]"`,
        );

        // Blocker re-map onto the cloned sibling (fall back to original if the
        // blocker target is outside the subtree).
        const blockerUid = extractRef(firstValue(fm.ems__Effort_blocker));
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
