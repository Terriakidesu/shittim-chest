import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";

export interface AssetPickerModalProps {
  open: boolean;
  title: string;
  eyebrow?: string;
  description?: string;
  directories: readonly string[];
  selected?: string;
  emptyLabel?: string;
  renderLabel?: (directory: string) => ReactNode;
  getSearchText?: (directory: string) => string;
  onClose: () => void;
  onSelect: (directory: string) => void;
}

function matches(directory: string, query: string, searchText?: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return !normalizedQuery || `${directory} ${searchText ?? ""}`.toLocaleLowerCase().includes(normalizedQuery);
}

export function AssetPickerModal({ open, title, eyebrow = "CHOOSE ASSET SET", description, directories, selected, emptyLabel = "No matching asset sets.", renderLabel, getSearchText, onClose, onSelect }: AssetPickerModalProps) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const filtered = useMemo(() => directories.filter((directory) => matches(directory, query, getSearchText?.(directory))), [directories, getSearchText, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    requestAnimationFrame(() => searchRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  function chooseFirst(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || !filtered[0]) return;
    event.preventDefault();
    onSelect(filtered[0]);
  }

  if (!open) return null;

  return <div className="editor-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="editor-modal" role="dialog" aria-modal="true" aria-labelledby="asset-picker-title" onMouseDown={(event) => event.stopPropagation()}>
      <header className="editor-modal-header">
        <div>
          <span className="editor-kicker">{eyebrow}</span>
          <h2 id="asset-picker-title">{title}</h2>
          {description && <p>{description}</p>}
        </div>
        <button className="editor-modal-close" type="button" aria-label="Close asset picker" onClick={onClose}>×</button>
      </header>
      <label className="editor-modal-search"><span aria-hidden="true">⌕</span><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={chooseFirst} placeholder="Search asset sets…" aria-label="Search asset sets" /></label>
      <div className="editor-modal-count">{filtered.length} of {directories.length} asset sets{query && <span> · Enter opens the first match</span>}</div>
      <div className="editor-modal-list" role="listbox" aria-label={title}>
        {filtered.map((directory) => <button key={directory} type="button" role="option" aria-selected={directory === selected} className={`editor-modal-option${directory === selected ? " is-selected" : ""}`} onClick={() => onSelect(directory)}>
          <span className="editor-modal-option-icon">{directory === selected ? "✓" : "◇"}</span>
          <span className="editor-modal-option-label">{renderLabel ? renderLabel(directory) : directory}</span>
          <span className="editor-modal-option-arrow">›</span>
        </button>)}
        {filtered.length === 0 && <div className="editor-modal-empty">{emptyLabel}</div>}
      </div>
    </section>
  </div>;
}
