import React, { useMemo, useState, useCallback } from "react";
import type { AssetRefCandidate } from "@plugin/presentation/builders/button-groups/DynamicCommandButtonGroupBuilder";
import { ReferencePicker } from "@plugin/presentation/components/dynamic-form/ReferencePicker";
import type { RelationRow } from "./relationsEditorModel";
import type { ReifyDestination } from "./reifyModel";

/**
 * RFC `93a0b2ee` Phase 3 — the Relations section embedded in the property editor.
 *
 * Task 3.1 (list + create + delete), Task 3.2 (the reify/de-reify toggle), and
 * Task 3.3 (this file's safety/privacy hardening) compose here:
 *
 *  - **de-reify strong-confirm** — de-reify is privacy-destructive (it deletes the
 *    backing `exo__Statement` and restores the relation inline → it will travel on
 *    share). The ↩ affordance opens a STRONG confirm dialog whose confirm button is
 *    DISABLED until the user checks «Понимаю: связь станет видимой при шаринге», so
 *    an accidental click can never de-reify.
 *  - **object-side read-only** — an incoming reified relation (the open asset A is
 *    the statement's `_object`) is shown read-only: the marker is visible but the
 *    toggle is disabled and labelled «изменит <subject>» (toggling would edit the
 *    subject's file, not A's).
 *  - **destination-AssetSpace picker** — the ↗ reify affordance opens a picker of the
 *    writable mounted AssetSpaces (default = the эталон junction); the chosen anchor
 *    is where the new private statement is created.
 *
 * UI-pure: all data + writes arrive via props (the modal supplies the triple
 * store-backed reified rows, the range resolver, the destination resolver, and the
 * vault write callbacks), so this component is testable with `@testing-library/react`.
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
  /** The unified, deduplicated relations (outgoing inline + reified, then incoming read-only). */
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
   * RFC §C3 Task 3.2/3.3 — reify an INLINE relation into an `exo__Statement` asset
   * (the per-row "Reify" affordance), into the chosen destination AssetSpace anchor.
   * Omitted ⇒ the toggle is not offered (e.g. no triple store reachable, or Task 3.1
   * back-compat).
   */
  readonly onReify?: (row: RelationRow, anchorUid: string) => void;
  /**
   * RFC §C3 Task 3.3 — resolve the destination AssetSpaces the reify picker offers
   * (default first). Called when the user opens the reify picker (lazy). Omitted ⇒
   * the reify affordance is not offered (a destination cannot be chosen).
   */
  readonly resolveReifyDestinations?: () => ReifyDestination[];
  /**
   * RFC §C3 Task 3.2 — de-reify a REIFIED relation back to inline (the per-row
   * "Un-reify" affordance). Invoked ONLY after the Task 3.3 strong-confirm is
   * acknowledged. Omitted ⇒ the toggle is not offered.
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
  resolveReifyDestinations,
  onDeReify,
}) => {
  const [predicateKey, setPredicateKey] = useState<string>(
    () => predicateOptions[0]?.key ?? "",
  );
  // Committed picker value: a quoted wikilink `"[[<uid>]]"` or `""`.
  const [targetValue, setTargetValue] = useState<string>("");

  // RFC §C3 Task 3.3 — de-reify strong-confirm gate. `confirmingDeReify` holds the
  // row pending confirmation; `deReifyAck` mirrors the acknowledgement checkbox and
  // gates the confirm button (an unchecked box can never de-reify).
  const [confirmingDeReify, setConfirmingDeReify] = useState<RelationRow | null>(null);
  const [deReifyAck, setDeReifyAck] = useState<boolean>(false);

  // RFC §C3 Task 3.3 — destination-AssetSpace picker. `reifyingRow` holds the row
  // being reified; `reifyDestinations` is the offered list; `chosenAnchor` the
  // selected anchor UID (defaults to the first / эталон).
  const [reifyingRow, setReifyingRow] = useState<RelationRow | null>(null);
  const [reifyDestinations, setReifyDestinations] = useState<ReifyDestination[]>([]);
  const [chosenAnchor, setChosenAnchor] = useState<string>("");

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

  // ---- Task 3.3 — open the reify destination picker (lazy destination resolve). ----
  const openReifyPicker = useCallback(
    (row: RelationRow) => {
      // Only one dialog at a time — close any pending de-reify confirm.
      setConfirmingDeReify(null);
      setDeReifyAck(false);
      const dests = resolveReifyDestinations ? resolveReifyDestinations() : [];
      setReifyDestinations(dests);
      setChosenAnchor(dests[0]?.anchorUid ?? "");
      setReifyingRow(row);
    },
    [resolveReifyDestinations],
  );

  const cancelReify = useCallback(() => {
    setReifyingRow(null);
    setReifyDestinations([]);
    setChosenAnchor("");
  }, []);

  const confirmReify = useCallback(() => {
    if (!reifyingRow || !chosenAnchor || !onReify) return;
    onReify(reifyingRow, chosenAnchor);
    cancelReify();
  }, [reifyingRow, chosenAnchor, onReify, cancelReify]);

  // ---- Task 3.3 — open the de-reify strong-confirm (acknowledgement reset). ----
  const openDeReifyConfirm = useCallback((row: RelationRow) => {
    // Only one dialog at a time — close any pending reify picker.
    setReifyingRow(null);
    setDeReifyAck(false);
    setConfirmingDeReify(row);
  }, []);

  const cancelDeReify = useCallback(() => {
    setConfirmingDeReify(null);
    setDeReifyAck(false);
  }, []);

  const confirmDeReify = useCallback(() => {
    // Hard gate: never de-reify without the explicit acknowledgement (an accidental
    // click — or a programmatic confirm with the box unchecked — is a no-op).
    if (!confirmingDeReify || !deReifyAck || !onDeReify) return;
    onDeReify(confirmingDeReify);
    cancelDeReify();
  }, [confirmingDeReify, deReifyAck, onDeReify, cancelDeReify]);

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
            const incoming = row.direction === "incoming";
            const readOnly = row.readOnly === true;
            return (
              <li
                key={`${row.predicateKey}-${row.objectUid ?? row.objectDisplay}-${row.direction ?? "outgoing"}-${idx}`}
                className="property-editor-relation-row"
                data-testid="relation-row"
                data-kind={row.kind}
                data-direction={row.direction ?? "outgoing"}
                data-readonly={readOnly ? "true" : "false"}
              >
                <span className="property-editor-relation-predicate">
                  {row.predicateLabel}
                </span>
                <span className="property-editor-relation-arrow">
                  {incoming ? " ← " : " → "}
                </span>
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

                {readOnly ? (
                  // Object-side read-only (Task 3.3): the relation is owned by the
                  // subject — toggling it from here would edit the subject's file.
                  // Show a disabled, explanatory affordance; no delete from this side.
                  <span
                    className="property-editor-relation-readonly"
                    data-testid="relation-toggle-readonly"
                    aria-disabled="true"
                    title={`Только владелец связи может её менять — действие изменит ${row.ownerDisplay ?? "ассет владельца"}, не открытый ассет.`}
                  >
                    {`изменит ${row.ownerDisplay ?? "владельца"}`}
                  </span>
                ) : (
                  <>
                    {onReify && resolveReifyDestinations && row.kind === "inline" && (
                      <button
                        type="button"
                        className="property-editor-relation-reify clickable-icon"
                        aria-label={`Reify relation ${row.predicateLabel} → ${row.objectDisplay} into a statement asset`}
                        title="Reify — move this relation into a separate statement asset (choose its AssetSpace; it will no longer travel inline)."
                        data-testid="relation-reify"
                        onClick={() => openReifyPicker(row)}
                      >
                        ↗
                      </button>
                    )}
                    {onDeReify && row.kind === "reified" && (
                      <button
                        type="button"
                        className="property-editor-relation-dereify clickable-icon"
                        aria-label={`Return relation ${row.predicateLabel} → ${row.objectDisplay} to inline`}
                        title="Un-reify — return this relation to inline frontmatter (it will travel on share). Requires confirmation."
                        data-testid="relation-dereify"
                        onClick={() => openDeReifyConfirm(row)}
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
                  </>
                )}
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

      {/* RFC §C3 Task 3.3 — reify destination-AssetSpace picker (privacy choice). */}
      {reifyingRow && (
        <div
          className="property-editor-relation-dialog property-editor-reify-dialog"
          data-testid="reify-destination-dialog"
          role="dialog"
          aria-label="Choose the destination AssetSpace for the reified relation"
        >
          <p className="property-editor-relation-dialog-title">
            Вынести связь в statement-ассет
          </p>
          <p className="property-editor-relation-dialog-body">
            {`${reifyingRow.predicateLabel} → ${reifyingRow.objectDisplay}`}
          </p>
          <p className="property-editor-relation-dialog-label">Куда (AssetSpace назначения):</p>
          <ul
            className="property-editor-reify-destinations"
            data-testid="reify-destination-list"
          >
            {reifyDestinations.map((d) => (
              <li key={d.anchorUid}>
                <label className="property-editor-reify-destination">
                  <input
                    type="radio"
                    name="reify-destination"
                    value={d.anchorUid}
                    checked={chosenAnchor === d.anchorUid}
                    onChange={() => setChosenAnchor(d.anchorUid)}
                    data-testid={`reify-destination-${d.anchorUid}`}
                  />
                  <span className="property-editor-reify-destination-label">
                    {d.label}
                    {d.assetSpace ? ` · ${d.assetSpace}` : ""}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <p className="property-editor-relation-dialog-warn">
            ⚠ inline-копия будет удалена из открытого ассета.
          </p>
          <div className="modal-button-container property-editor-relation-dialog-actions">
            <button
              type="button"
              className="property-editor-reify-cancel"
              data-testid="reify-cancel"
              onClick={cancelReify}
            >
              Отмена
            </button>
            <button
              type="button"
              className="mod-cta property-editor-reify-confirm"
              data-testid="reify-confirm"
              disabled={!chosenAnchor}
              onClick={confirmReify}
            >
              Вынести
            </button>
          </div>
        </div>
      )}

      {/* RFC §C3 Task 3.3 — de-reify STRONG confirmation (privacy downgrade gate). */}
      {confirmingDeReify && (
        <div
          className="property-editor-relation-dialog property-editor-dereify-dialog mod-warning"
          data-testid="dereify-confirm-dialog"
          role="dialog"
          aria-label="Confirm returning the relation to inline (it will become public on share)"
        >
          <p className="property-editor-relation-dialog-title">
            ⚠ Вернуть связь в inline
          </p>
          <p className="property-editor-relation-dialog-body">
            {`${confirmingDeReify.predicateLabel} → ${confirmingDeReify.objectDisplay}`}
          </p>
          <p className="property-editor-relation-dialog-warn" data-testid="dereify-warning">
            {`Сейчас связь вынесена в statement-ассет${
              confirmingDeReify.assetSpace ? ` (${confirmingDeReify.assetSpace})` : ""
            }. После: statement-ассет будет удалён, а связь вернётся inline в открытый ассет — и будет шариться вместе с ним.`}
          </p>
          <label className="property-editor-dereify-ack">
            <input
              type="checkbox"
              checked={deReifyAck}
              onChange={(e) => setDeReifyAck(e.target.checked)}
              data-testid="dereify-ack-checkbox"
            />
            <span>Понимаю: связь станет видимой при шаринге</span>
          </label>
          <div className="modal-button-container property-editor-relation-dialog-actions">
            <button
              type="button"
              className="property-editor-dereify-cancel"
              data-testid="dereify-cancel"
              onClick={cancelDeReify}
            >
              Отмена
            </button>
            <button
              type="button"
              className="mod-warning property-editor-dereify-confirm"
              data-testid="dereify-confirm"
              disabled={!deReifyAck}
              onClick={confirmDeReify}
            >
              Вернуть в inline
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
