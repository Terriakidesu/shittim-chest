import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { IconCheck, IconChevronRight, IconClose, IconFolder, IconSearch } from "../../../src/client/components/icons";
import { initialPickerIndex, movePickerIndex } from "./assetPickerModel";

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
  const pickerId = useId();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const filtered = useMemo(() => directories.filter((directory) => matches(directory, query, getSearchText?.(directory))), [directories, getSearchText, query]);

  useEffect(() => {
    if (open) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setQuery("");
      setActiveIndex(initialPickerIndex(directories.indexOf(selected ?? ""), directories.length));
      requestAnimationFrame(() => searchRef.current?.focus());
      return;
    }
    returnFocusRef.current?.focus();
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

  useEffect(() => {
    setActiveIndex((index) => initialPickerIndex(index, filtered.length));
  }, [filtered.length]);

  useEffect(() => {
    if (activeIndex >= 0) optionRefs.current[activeIndex]?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, filtered.length, query]);

  function handleSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => movePickerIndex(index, 1, filtered.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => movePickerIndex(index, -1, filtered.length));
    } else if (event.key === "Home" && filtered.length > 0) {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End" && filtered.length > 0) {
      event.preventDefault();
      setActiveIndex(filtered.length - 1);
    } else if (event.key === "Enter" && filtered[activeIndex]) {
      event.preventDefault();
      onSelect(filtered[activeIndex]);
    }
  }

  function keepFocusInDialog(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") return;
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])") ?? [])];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  if (!open) return null;

  return <div className="editor-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="editor-modal" role="dialog" aria-modal="true" aria-labelledby="asset-picker-title" onMouseDown={(event) => event.stopPropagation()} onKeyDown={keepFocusInDialog}>
      <header className="editor-modal-header">
        <div>
          <span className="editor-kicker">{eyebrow}</span>
          <h2 id="asset-picker-title">{title}</h2>
          {description && <p>{description}</p>}
        </div>
         <button className="editor-modal-close" type="button" aria-label="Close asset picker" onClick={onClose}><IconClose /></button>
      </header>
       <label className="editor-modal-search"><IconSearch /><input ref={searchRef} role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls={`${pickerId}-list`} aria-activedescendant={activeIndex >= 0 ? `${pickerId}-option-${activeIndex}` : undefined} value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }} onKeyDown={handleSearchKeyDown} placeholder="Search asset sets…" aria-label="Search asset sets" /></label>
       <div className="editor-modal-count" aria-live="polite">{filtered.length} of {directories.length} asset sets{query && <span> · ↑/↓ choose, Enter opens</span>}</div>
       <div className="editor-modal-list" id={`${pickerId}-list`} role="listbox" aria-label={title}>
         {filtered.map((directory, index) => <button ref={(element) => { optionRefs.current[index] = element; }} id={`${pickerId}-option-${index}`} key={directory} type="button" role="option" tabIndex={-1} aria-selected={directory === selected} className={`editor-modal-option${directory === selected ? " is-selected" : ""}${index === activeIndex ? " is-active" : ""}`} onMouseEnter={() => setActiveIndex(index)} onClick={() => onSelect(directory)}>
           <span className="editor-modal-option-icon">{directory === selected ? <IconCheck /> : <IconFolder />}</span>
           <span className="editor-modal-option-label">{renderLabel ? renderLabel(directory) : directory}</span>
           <span className="editor-modal-option-arrow"><IconChevronRight /></span>
        </button>)}
        {filtered.length === 0 && <div className="editor-modal-empty">{emptyLabel}</div>}
      </div>
    </section>
  </div>;
}
