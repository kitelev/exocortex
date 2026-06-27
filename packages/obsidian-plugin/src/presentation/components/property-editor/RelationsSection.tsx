import React, { useMemo, useState, useCallback } from "react";
import type { AssetRefCandidate } from "@plugin/presentation/builders/button-groups/DynamicCommandButtonGroupBuilder";
import { ReferencePicker } from "@plugin/presentation/components/dynamic-form/ReferencePicker";
import type { RelationRow } from "./relationsEditorModel";

/**
 * RFC `93a0b2ee` Phase 3 / Task 3.1 — the Relations section embedded in the
 * property editor. Relations-only (NOT a general property editor): it lists the
 * open asset's outgoing inline + reified relations (deduplicated upstream by
 * {@link buildRelationRows}), lets the user create a new INLINE relation via a
 * range-scoped {@link ReferencePicker}, and delete a relation in place
 * (inline → frontmatter, reified → statement asset).
 *
 * Scope: list + create + delete. The reify/de-reify toggle is Task 3.2 — this
 * section never reifies; new relations are always inline.
 *
 * UI-pure: all data + writes arrive via props (the modal supplies the triple
 * store-backed reified rows, the range resolver, and the vault write callbacks),
 * so this component is testable with `@testing-library/react`.
 */

/** One predicate the user may create a relation with (a wikilink/object property of A's class). */
export interface PredicateOption {
  /** Frontmatter key written for the new inline relation (e.g. `ems__Effort_parent`). */
  readonly key: string;
  /** Human label shown in the predicate selector. */
  readonly label: string;
  /** The predicate's `exo:Property_range` class UID — scopes the target picker. */
  readonly rangeClassUid?: string;
}

export interface RelationsSectionProps {
  /** The unified, deduplicated outgoing relations (inline + reified). */
  readonly rows: RelationRow[];
  /** The predicates the user may create a relation with. */
  readonly predicateOptions: PredicateOption[];
  /** Resolve the picker candidates for a predicate's range class (range-scoped, NOT whole-vault). */
  readonly resolveCandidates: (rangeClassUid: string | undefined) => AssetRefCandidate[];
  /** Append a new INLINE relation `predicateKey → targetUid` to the open asset's frontmatter. */
  readonly onCreate: (predicateKey: string, targetUid: string) => void;
  /** Delete a relation in place (inline → frontmatter; reified → statement asset). */
  readonly onDelete: (row: RelationRow) => void;
  /**
   * RFC §C3 Task 3.2 — reify an INLINE relation into an `exo__Statement` asset
   * (the per-row "Reify" affordance). Omitted ⇒ the toggle is not offered (e.g.
   * no triple store reachable, or Task 3.1 back-compat).
   */
  readonly onReify?: (row: RelationRow) => void;
  /**
   * RFC §C3 Task 3.2 — de-reify a REIFIED relation back to inline (the per-row
   * "Un-reify" affordance). Omitted ⇒ the toggle is not offered.
   */
  readonly onDeReify?: (row: RelationRow) => void;
}

/** Factual reified marker (RFC §C2) — `reified · <AS>`, or a bare `reified`; `null` for inline. */
function markerText(row: RelationRow): string | null {
  if (row.kind !== "reified") return null;
  const as = row.assetSpace?.trim();
  return as ? `reified · ${as}` : "reified";
}

export const RelationsSection: React.FC<RelationsSectionProps> = ({
  rows,
  predicateOptions,
  resolveCandidates,
  onCreate,
  onDelete,
  onReify,
  onDeReify,
}) => {
  const [predicateKey, setPredicateKey] = useState<string>(
    () => predicateOptions[0]?.key ?? "",
  );
  // Committed picker value: a quoted wikilink `"[[<uid>]]"` or `""`.
  const [targetValue, setTargetValue] = useState<string>("");

  const selectedPredicate = useMemo(
    () => predicateOptions.find((p) => p.key === predicateKey),
    [predicateOptions, predicateKey],
  );

  const candidates = useMemo(
    () => resolveCandidates(selectedPredicate?.rangeClassUid),
    [resolveCandidates, selectedPredicate],
  );

  const targetUid = useMemo(() => {
    const m = /\[\[([^|\]]+)(?:\|[^\]]*)?\]\]/.exec(targetValue);
    return m ? m[1].trim() : null;
  }, [targetValue]);

  const handlePredicateChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setPredicateKey(e.target.value);
      // Clear the target — candidates change with the predicate's range.
      setTargetValue("");
    },
    [],
  );

  const handleAdd = useCallback(() => {
    if (!predicateKey || !targetUid) return;
    onCreate(predicateKey, targetUid);
    setTargetValue("");
  }, [predicateKey, targetUid, onCreate]);

  const canAdd = predicateKey.length > 0 && targetUid !== null;

  return (
    <div className="property-editor-section property-editor-relations-section">
      <h3 className="property-editor-section-title">Relations</h3>

      {rows.length === 0 ? (
        <p className="property-editor-relations-empty" data-testid="relations-empty">
          No outgoing relations.
        </p>
      ) : (
        <ul className="property-editor-relations-list" data-testid="relations-list">
          {rows.map((row, idx) => {
            const marker = markerText(row);
            return (
              <li
                key={`${row.predicateKey}-${row.objectUid ?? row.objectDisplay}-${idx}`}
                className="property-editor-relation-row"
                data-testid="relation-row"
                data-kind={row.kind}
              >
                <span className="property-editor-relation-predicate">
                  {row.predicateLabel}
                </span>
                <span className="property-editor-relation-arrow"> → </span>
                <span className="property-editor-relation-target">
                  {row.objectDisplay}
                </span>
                {marker && (
                  <span
                    className="exocortex-reified-marker property-editor-relation-marker"
                    title="Связь вынесена в statement-ассет (фактически — где лежит). Приватность зависит от того, шарится ли этот AssetSpace."
                  >
                    {marker}
                  </span>
                )}
                {onReify && row.kind === "inline" && (
                  <button
                    type="button"
                    className="property-editor-relation-reify clickable-icon"
                    aria-label={`Reify relation ${row.predicateLabel} → ${row.objectDisplay} into a statement asset`}
                    title="Reify — move this relation into a separate statement asset (it will no longer travel inline)."
                    data-testid="relation-reify"
                    onClick={() => onReify(row)}
                  >
                    ↗
                  </button>
                )}
                {onDeReify && row.kind === "reified" && (
                  <button
                    type="button"
                    className="property-editor-relation-dereify clickable-icon"
                    aria-label={`Return relation ${row.predicateLabel} → ${row.objectDisplay} to inline`}
                    title="Un-reify — return this relation to inline frontmatter (it will travel on share)."
                    data-testid="relation-dereify"
                    onClick={() => onDeReify(row)}
                  >
                    ↩
                  </button>
                )}
                <button
                  type="button"
                  className="property-editor-relation-delete clickable-icon"
                  aria-label={`Delete relation ${row.predicateLabel} → ${row.objectDisplay}`}
                  data-testid="relation-delete"
                  onClick={() => onDelete(row)}
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {predicateOptions.length > 0 && (
        <div className="property-editor-relation-create" data-testid="relation-create">
          <select
            className="property-editor-relation-predicate-select dropdown"
            value={predicateKey}
            onChange={handlePredicateChange}
            aria-label="Relation predicate"
            data-testid="relation-predicate-select"
          >
            {predicateOptions.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
          <ReferencePicker
            name="relation-target"
            value={targetValue}
            candidates={candidates}
            onChange={setTargetValue}
            picker={true}
            placeholder="Type to search target…"
          />
          <button
            type="button"
            className="mod-cta property-editor-relation-add"
            disabled={!canAdd}
            onClick={handleAdd}
            data-testid="relation-add"
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
};
