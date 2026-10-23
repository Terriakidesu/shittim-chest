import { useEffect, useRef, useState } from "react";
import { link } from "../route";
import { newsDate, newsDateRange, newsUpdateLabel, type LobbyNewsItem } from "../lobbyNews";
import { t, useLanguage, studentName, type LangKey } from "../i18n";
import { IconChevronLeft, IconChevronRight, IconPlay } from "./icons";

/** Badge text and dates, built at render so a language switch is immediate. */
function badge(item: LobbyNewsItem) {
  // Forecast and scheduled cards announce a Global arrival, so their scope is
  // naturally Global; window cards name the server the window belongs to.
  const scope = item.kind === "forecast" || item.kind === "scheduled"
    ? t("news.global")
    : t(item.server === "JP" ? "news.japan" : "news.global");
  const state = item.kind === "scheduled" && item.official ? t("news.confirmed") : t(`news.${item.kind}` as LangKey);
  return `${scope} · ${state}`;
}

function dates(item: LobbyNewsItem) {
  if (item.kind === "forecast" && item.expectedMs != null && item.lowerMs != null && item.upperMs != null) {
    return t("news.expectedAt", {
      date: newsDate(item.expectedMs),
      range: newsDateRange(item.lowerMs, item.upperMs),
    });
  }
  if (item.kind === "scheduled" && item.expectedMs != null) {
    return t(item.official ? "news.confirmedAt" : "news.scheduledAt", { date: newsDate(item.expectedMs) });
  }
  return newsDateRange(item.startMs ?? 0, item.endMs ?? 0);
}

function names(item: LobbyNewsItem) {
  return item.students
    .map(({ student, rerun }) => `${studentName(student)}${rerun ? t("news.rerun") : ""}`)
    .join(" · ");
}

export function LobbyNews({ updatedMs, items }: { updatedMs: number | null; items: LobbyNewsItem[] }) {
  useLanguage();
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [index, setIndex] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const touch = useRef<{ x: number; y: number } | null>(null);
  const [hidden, setHidden] = useState(() => document.hidden);
  const currentIndex = items.length ? index % items.length : 0;
  const current = items[currentIndex];
  const updated = newsUpdateLabel(updatedMs);

  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => {
    if (paused || hovered || focused || hidden || items.length < 2) return;
    const timer = window.setTimeout(() => setIndex((old) => (old + 1) % items.length), 8000);
    return () => window.clearTimeout(timer);
  }, [paused, hovered, focused, hidden, index, items.length]);

  function move(delta: number) {
    if (!items.length) return;
    const next = (currentIndex + delta + items.length) % items.length;
    setIndex(next);
    setAnnouncement(`${badge(items[next])}: ${names(items[next])}. ${dates(items[next])}`);
  }
  if (!updated && !items.length) return null;
  return <aside className="lobby-news" aria-label={t("news.aria")} aria-roledescription="carousel">
    <div className="lobby-news-heading"><a href={link.calendar}>{t("news.heading")} <span aria-hidden="true">›</span></a>{updated && <span>{t("news.dataUpdated", { date: updated })}</span>}</div>
    <div className="lobby-news-body">
      <div className="lobby-news-window" tabIndex={0} aria-label={t("news.windowAria")} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onMouseEnter={() => { if (window.matchMedia("(hover: hover)").matches) setHovered(true); }} onMouseLeave={() => setHovered(false)} onKeyDown={(event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); move(event.key === "ArrowRight" ? 1 : -1); }
      }} onTouchStart={(event) => { const point = event.touches[0]; touch.current = point ? { x: point.clientX, y: point.clientY } : null; }} onTouchCancel={() => { touch.current = null; }} onTouchEnd={(event) => {
        const point = event.changedTouches[0];
        if (point && touch.current) { const dx = point.clientX - touch.current.x, dy = point.clientY - touch.current.y; if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy)) move(dx < 0 ? 1 : -1); }
        touch.current = null;
      }}>
        {items.map((item, cardIndex) => <article className={`lobby-news-card news-${item.kind} ${cardIndex === currentIndex ? "is-current" : ""}`} key={item.key} aria-hidden={cardIndex !== currentIndex} aria-roledescription="slide" aria-label={t("news.count", { index: cardIndex + 1, total: items.length })}>
          <strong className="lobby-news-badge">{badge(item)}</strong><p className="lobby-news-names">{names(item)}</p><p className="lobby-news-dates">{dates(item)}</p>
        </article>)}
        {!current && <p className="lobby-news-empty">{t("news.empty")}</p>}
      </div>
      {items.length > 1 && <div className="lobby-news-controls"><span aria-hidden="true">{t("news.count", { index: currentIndex + 1, total: items.length })}</span><div><button type="button" aria-label={t("news.prev")} title={t("news.prev")} onClick={() => move(-1)}><IconChevronLeft /></button><button type="button" aria-label={paused ? t("news.resume") : t("news.pause")} aria-pressed={paused} title={paused ? t("news.resume") : t("news.pause")} onClick={() => setPaused((old) => !old)}>{paused ? <IconPlay /> : <svg className="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h4v14H7zm6 0h4v14h-4z" /></svg>}</button><button type="button" aria-label={t("news.next")} title={t("news.next")} onClick={() => move(1)}><IconChevronRight /></button></div></div>}
    </div>
    <span className="sim-visually-hidden" role="status">{announcement}</span>
  </aside>;
}
