import React, {
  useState,
  useCallback,
  useMemo,
  useRef,
  useId,
  useEffect,
} from "react";
import type { AssetRefCandidate } from "@plugin/presentation/builders/button-groups/DynamicCommandButtonGroupBuilder";

/**
 * T2 «Create Instance» (project bbe40f8c) — a **generic, reusable** fuzzy
 * reference-picker, extracted from the inline T1 `assetRef` field so any future
 * command/form can embed it without reimplementing the combobox.
 *
 * Contract (decoupled from `InputSchemaField` on purpose, so non-form callers
 * can use it too):
 *
 *   - `candidates`  — the assets the user may pick (one per class; the caller
 *                     resolves them, e.g. from `findAssetRefCandidates(app,
 *                     targetClassUid)` — parameterised by class).
 *   - `value`       — the committed value: a quoted wikilink `"[[<uid>]]"`, or
 *                     `""` when nothing is selected. The component round-trips
 *                     this: on mount it shows the matching candidate's label.
 *   - `onChange`    — called with the new committed value: `"[[<uid>]]"` when a
 *                     candidate is chosen, `""` while the user is typing (free
 *                     text never leaks into frontmatter).
 *   - `picker`      — `true` renders the fuzzy combobox; `false` degrades to a
 *                     plain text input (legacy `assetRef` with no target class).
 *
 * Accessibility: ARIA combobox pattern with full keyboard navigation —
 * ArrowDown/ArrowUp move the active option, Enter selects, Escape closes.
 * The listbox/options are wired via `aria-controls` / `aria-activedescendant`.
 */
export interface ReferencePickerProps {
  /** Stable id segment for `data-testid` (typically the form field name). */
  readonly name: string;
  /** Committed value — a quoted wikilink `"[[<uid>]]"` or `""`. */
  readonly value: string;
  /** Candidate assets to fuzzy-filter and select (label + uid). */
  readonly candidates: ReadonlyArray<AssetRefCandidate>;
  /** Receives the committed value: `"[[<uid>]]"` on select, `""` while typing. */
  readonly onChange: (value: string) => void;
  /**
   * `true` → fuzzy combobox; `false` → plain text passthrough (back-compat with
   * `assetRef` fields that declare no target class / supply no candidates).
   */
  readonly picker: boolean;
  /** Placeholder for the plain text passthrough mode (default below). */
  readonly placeholder?: string;
}

/** Wrap a bare UID as a quoted frontmatter wikilink (`"[[<uid>]]"`). */
export function toReferenceWikilink(uid: string): string {
  return `"[[${uid}]]"`;
}

/** Extract the bare UID from a committed `"[[<uid>]]"` value (or `null`). */
function bareUidOf(value: string): string | null {
  const m = /^"?\[\[([^|\]]+)(?:\|[^\]]*)?\]\]"?$/.exec(value.trim());
  return m ? m[1].trim() : null;
}

const MAX_VISIBLE_OPTIONS = 50;

export const ReferencePicker: React.FC<ReferencePickerProps> = ({
  name,
  value,
  candidates,
  onChange,
  picker,
  placeholder,
}) => {
  // Initial display text: if the committed value points at a known candidate,
  // show that candidate's label so a pre-filled / re-opened picker is readable.
  const initialQuery = useMemo(() => {
    const uid = bareUidOf(value);
    if (!uid) return "";
    const match = candidates.find((c) => c.uid === uid);
    return match ? match.label : "";
  }, [value, candidates]);

  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listboxId = useId();
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear any pending blur-close timer on unmount so it can't fire after the
  // host (modal/form) unmounts.
  useEffect(
    () => () => {
      if (blurTimer.current) clearTimeout(blurTimer.current);
    },
    [],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return candidates.slice(0, MAX_VISIBLE_OPTIONS);
    return candidates
      .filter((c) => c.label.toLowerCase().includes(q))
      .slice(0, MAX_VISIBLE_OPTIONS);
  }, [candidates, query]);

  const commit = useCallback(
    (candidate: AssetRefCandidate) => {
      onChange(toReferenceWikilink(candidate.uid));
      setQuery(candidate.label);
      setOpen(false);
      setActiveIndex(-1);
    },
    [onChange],
  );

  const handleInput = useCallback(
    (text: string) => {
      setQuery(text);
      setOpen(true);
      setActiveIndex(-1);
      // Clear the committed selection until a candidate is chosen, so free
      // text never leaks into frontmatter as a value.
      if (value) onChange("");
    },
    [onChange, value],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setOpen(true);
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        if (open && activeIndex >= 0 && activeIndex < filtered.length) {
          e.preventDefault();
          commit(filtered[activeIndex]);
        }
      } else if (e.key === "Escape") {
        setOpen(false);
        setActiveIndex(-1);
      }
    },
    [filtered, open, activeIndex, commit],
  );

  if (!picker) {
    // Plain text passthrough (legacy assetRef without candidates).
    return (
      <input
        type="text"
        className="dynamic-form-input"
        placeholder={placeholder ?? "asset reference..."}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={`field-${name}`}
      />
    );
  }

  return (
    <div className="dynamic-form-assetref">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && activeIndex >= 0
            ? `${listboxId}-opt-${activeIndex}`
            : undefined
        }
        className="dynamic-form-input"
        placeholder={placeholder ?? "Type to search…"}
        value={query}
        onChange={(e) => handleInput(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Delay so an option's mousedown can commit before blur closes.
          blurTimer.current = setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={handleKeyDown}
        data-testid={`field-${name}`}
      />
      {open && filtered.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="dynamic-form-assetref-options"
        >
          {filtered.map((candidate, idx) => (
            <li
              key={candidate.uid}
              id={`${listboxId}-opt-${idx}`}
              role="option"
              aria-selected={idx === activeIndex}
              className={
                idx === activeIndex
                  ? "dynamic-form-assetref-option is-active"
                  : "dynamic-form-assetref-option"
              }
              // onMouseDown (not onClick) so it fires before the input blur.
              onMouseDown={(e) => {
                e.preventDefault();
                if (blurTimer.current) clearTimeout(blurTimer.current);
                commit(candidate);
              }}
              data-testid={`option-${name}-${candidate.uid}`}
            >
              {candidate.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
