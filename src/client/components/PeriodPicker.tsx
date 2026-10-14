import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { IconCheck, IconChevronDown } from "./icons";

export interface PeriodOption { value: string; dates: string; names: string; detail: string }

export function PeriodPicker({ options, value, disabled, onChange }: { options: PeriodOption[]; value: string; disabled: boolean; onChange: (value: string) => void }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<CSSProperties>({});
  const selected = options.find((option) => option.value === value);
  const filtered = options.filter((option) => `${option.dates} ${option.names} ${option.detail}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const activeIndex = Math.min(active, filtered.length - 1);

  function close(restoreFocus = false) {
    popup.current?.hidePopover();
    if (restoreFocus) trigger.current?.focus();
  }
  function choose(option: PeriodOption) { onChange(option.value); close(true); }
  function place() {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(520, Math.max(rect.width, 360), window.innerWidth - 24);
    const below = window.innerHeight - rect.bottom - 14;
    const above = rect.top - 14;
    const downward = below >= 220 || below >= above;
    const height = Math.min(460, Math.max(120, downward ? below : above));
    setPosition({ width, maxHeight: height, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top: downward ? rect.bottom + 6 : Math.max(8, rect.top - height - 6) });
  }
  useEffect(() => {
    if (!open) return;
    const resize = () => {
      if (window.matchMedia("(orientation: portrait) and (hover: none) and (pointer: coarse)").matches) popup.current?.hidePopover();
      else place();
    };
    window.addEventListener("resize", resize);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", resize); window.removeEventListener("scroll", place, true); };
  }, [open]);
  useEffect(() => { if (disabled) popup.current?.hidePopover(); }, [disabled]);
  useEffect(() => {
    if (open && activeIndex >= 0) document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, query, id]);

  return <div className="period-picker">
    <span className="sim-field-label" id={`${id}-label`}>In-game period</span>
    <button type="button" ref={trigger} className="period-picker-trigger" disabled={disabled} aria-labelledby={`${id}-label ${id}-value`} aria-haspopup="dialog" aria-expanded={open} aria-controls={`${id}-popup`} onClick={() => {
      if (open) close();
      else {
        setQuery(""); setActive(Math.max(0, options.findIndex((option) => option.value === value))); place(); popup.current?.showPopover();
      }
    }}><span id={`${id}-value`}><strong>{selected?.dates ?? "Choose a period"}</strong><span>{selected?.names}</span><small>{selected?.detail}</small></span><b aria-hidden="true"><IconChevronDown /></b></button>
    <div ref={popup} id={`${id}-popup`} className="period-picker-popup" role="dialog" aria-label="Choose recruitment period" popover="auto" style={position} onToggle={(event) => {
      const visible = event.currentTarget.matches(":popover-open"); setOpen(visible);
      if (visible) search.current?.focus();
    }}>
      <div className="period-picker-search"><label htmlFor={`${id}-search`}>Find a banner or date</label><input ref={search} id={`${id}-search`} type="search" placeholder="Student name, month, year…" value={query} role="combobox" aria-expanded={open} aria-autocomplete="list" aria-controls={`${id}-list`} aria-activedescendant={activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined} onChange={(event) => { setQuery(event.target.value); setActive(0); }} onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
        else if (event.key === "Enter") { event.preventDefault(); if (filtered[activeIndex]) choose(filtered[activeIndex]); }
        else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          setActive(event.key === "Home" ? 0 : event.key === "End" ? filtered.length - 1 : Math.max(0, Math.min(filtered.length - 1, activeIndex + (event.key === "ArrowDown" ? 1 : -1))));
        }
      }} /></div>
      <div className="period-picker-list" id={`${id}-list`} role="listbox" aria-label="Recruitment periods">
        {filtered.map((option, index) => <div role="option" id={`${id}-option-${index}`} aria-selected={option.value === value} className={`period-picker-option ${index === activeIndex ? "is-active" : ""}`} key={option.value} onPointerDown={(event) => { if (event.pointerType === "mouse") event.preventDefault(); }} onClick={() => choose(option)}>
          <div><strong>{option.dates}</strong>{option.value === value && <b aria-label="Selected"><IconCheck /></b>}</div><span>{option.names}</span><small>{option.detail}</small>
        </div>)}
      </div>
      <p className="period-picker-count" role="status">{filtered.length ? `${filtered.length} periods · ↑ ↓ to browse · Enter to select` : "No matching periods. Try another name or date."}</p>
    </div>
  </div>;
}
