import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { asset } from "../api";
import { filterPeriods, periodDates, periodDetail, periodNames, periodSummary, type PeriodOption } from "../periodPickerOptions";
import { t, useLanguage } from "../i18n";
import { IconCheck, IconChevronDown, IconClose } from "./icons";

const SHEET_QUERY = "(max-width: 640px), (hover: none) and (pointer: coarse)";

export function PeriodPicker({ options, value, disabled, onChange }: { options: PeriodOption[]; value: string; disabled: boolean; onChange: (value: string) => void }) {
  useLanguage();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [year, setYear] = useState("");
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<CSSProperties>({});
  const [sheet, setSheet] = useState(() => window.matchMedia(SHEET_QUERY).matches);
  const selected = options.find((option) => option.value === value);
  const years = [...new Set(options.map((option) => option.year))].sort((a, b) => b - a);
  const filtered = filterPeriods(options, query, year);
  const activeIndex = Math.min(active, filtered.length - 1);

  function close(restoreFocus = false) {
    popup.current?.hidePopover();
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }
  function choose(option: PeriodOption) { onChange(option.value); close(true); }
  function place() {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const mobile = window.matchMedia(SHEET_QUERY).matches;
    setSheet(mobile);
    const viewport = window.visualViewport;
    const availableHeight = viewport?.height ?? window.innerHeight;
    const offsetTop = viewport?.offsetTop ?? 0;
    if (mobile) {
      const height = Math.min(620, availableHeight * .88);
      setPosition({ width: viewport?.width ?? window.innerWidth, height, maxHeight: height, left: viewport?.offsetLeft ?? 0, top: offsetTop + availableHeight - height });
      return;
    }
    const width = Math.min(480, Math.max(rect.width, 380), window.innerWidth - 24);
    const below = offsetTop + availableHeight - rect.bottom - 14;
    const above = rect.top - offsetTop - 14;
    const downward = below >= 300 || below >= above;
    const height = Math.min(540, Math.max(120, downward ? below : above));
    setPosition({ width, maxHeight: height, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top: downward ? rect.bottom + 6 : Math.max(offsetTop + 8, rect.top - height - 6) });
  }
  useEffect(() => {
    if (!open) return;
    const scroll = (event: Event) => { if (!(event.target instanceof Node) || !popup.current?.contains(event.target)) place(); };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", scroll, true);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", scroll, true);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [open]);
  useEffect(() => {
    if (!open || !sheet) return;
    const rootOverflow = document.documentElement.style.overflow;
    const bodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => { document.documentElement.style.overflow = rootOverflow; document.body.style.overflow = bodyOverflow; };
  }, [open, sheet]);
  useEffect(() => { if (disabled) close(); }, [disabled]);
  useEffect(() => {
    if (!open || activeIndex < 0 || !list.current) return;
    const row = document.getElementById(`${id}-option-${activeIndex}`)?.getBoundingClientRect();
    const bounds = list.current.getBoundingClientRect();
    if (row && row.top < bounds.top) list.current.scrollTop += row.top - bounds.top;
    else if (row && row.bottom > bounds.bottom) list.current.scrollTop += row.bottom - bounds.bottom;
  }, [open, activeIndex, query, year, id]);

  return <div className="period-picker">
    <span className="sim-field-label" id={`${id}-label`}>{t("period.label")}</span>
    <button type="button" ref={trigger} className="period-picker-trigger" disabled={disabled} aria-labelledby={`${id}-label ${id}-value`} aria-haspopup="dialog" aria-expanded={open} aria-controls={`${id}-popup`} title={selected ? `${periodDates(selected).full}\n${periodNames(selected)}` : undefined} onClick={() => {
      if (open) close();
      else {
        setQuery(""); setYear(""); setActive(Math.max(0, options.findIndex((option) => option.value === value))); place(); popup.current?.showPopover();
      }
    }}><span id={`${id}-value`}><strong>{selected ? periodDates(selected).short : t("period.choose")}</strong><span>{selected && periodSummary(selected)}</span><small>{selected && periodDetail(selected)}</small></span><b aria-hidden="true"><IconChevronDown /></b></button>
    <div ref={popup} id={`${id}-popup`} className="period-picker-popup" role="dialog" aria-modal={sheet || undefined} aria-labelledby={`${id}-title`} tabIndex={-1} popover="auto" style={position} onToggle={(event) => {
      const visible = event.currentTarget.matches(":popover-open"); setOpen(visible);
      if (visible) {
        if (window.matchMedia(SHEET_QUERY).matches) popup.current?.focus({ preventScroll: true });
        else search.current?.focus({ preventScroll: true });
      }
    }} onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
      if (event.key === "Tab" && sheet) {
        const controls = [...(popup.current?.querySelectorAll<HTMLElement>("button, input, select") ?? [])];
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === popup.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <div className="period-picker-heading"><strong id={`${id}-title`}>{t("period.choose")}</strong><button type="button" aria-label={t("period.closeAria")} onClick={() => close(true)}><IconClose /></button></div>
      <div className="period-picker-search"><label htmlFor={`${id}-search`}>{t("period.searchLabel")}</label><div className="period-picker-filters"><input ref={search} id={`${id}-search`} type="search" placeholder={t("period.searchPlaceholder")} autoComplete="off" value={query} role="combobox" aria-expanded={open} aria-autocomplete="list" aria-controls={`${id}-list`} aria-activedescendant={activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined} onChange={(event) => { setQuery(event.target.value); setActive(0); }} onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); if (filtered[activeIndex]) choose(filtered[activeIndex]); }
        else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          setActive(event.key === "Home" ? 0 : event.key === "End" ? filtered.length - 1 : Math.max(0, Math.min(filtered.length - 1, activeIndex + (event.key === "ArrowDown" ? 1 : -1))));
        }
      }} /><select aria-label={t("period.yearAria")} value={year} onChange={(event) => { setYear(event.target.value); setActive(0); }}><option value="">{t("period.allYears")}</option>{years.map((item) => <option key={item} value={item}>{item}</option>)}</select></div></div>
      <div ref={list} className="period-picker-list" id={`${id}-list`} role="listbox" aria-label={t("period.listAria")}>
        {filtered.map((option, index) => {
          const optionDates = periodDates(option);
          return <div role="option" id={`${id}-option-${index}`} aria-label={`${optionDates.full}, ${periodNames(option)}, ${periodDetail(option)}`} aria-selected={option.value === value} className={`period-picker-option ${index === activeIndex ? "is-active" : ""}`} key={option.value} title={periodNames(option)} onPointerDown={(event) => { if (event.pointerType === "mouse") event.preventDefault(); }} onClick={() => choose(option)}>
          <div className="period-picker-portraits" aria-hidden="true">{option.students.slice(0, 2).map((student) => <img key={student.id} src={asset(`img/avatar/${student.id}.webp`)} alt="" loading="lazy" />)}</div>
          <div className="period-picker-option-copy"><strong>{optionDates.short}</strong><span>{periodNames(option).replaceAll(" / ", " · ")}</span><small>{periodDetail(option)}</small></div>
          {option.value === value && <b aria-label={t("period.selectedAria")}><IconCheck /></b>}
        </div>;
        })}
        {!filtered.length && <div className="period-picker-empty"><strong>{t("period.emptyHeading")}</strong><span>{t("period.emptySub")}</span><button type="button" onClick={() => { setQuery(""); setYear(""); setActive(0); }}>{t("period.clear")}</button></div>}
      </div>
      <p className="period-picker-count" role="status">{t(filtered.length === 1 ? "period.one" : "period.many", { n: filtered.length })}<span className="period-picker-keyboard-hint">{t("period.hint")}</span></p>
    </div>
  </div>;
}
