import { useEffect, useRef, useState } from "react";
import { link } from "../route";
import { newsUpdateLabel, type LobbyNewsItem } from "../lobbyNews";
import { IconChevronLeft, IconChevronRight, IconPlay } from "./icons";

export function LobbyNews({ updatedMs, items }: { updatedMs: number | null; items: LobbyNewsItem[] }) {
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
    setAnnouncement(`${items[next].label}: ${items[next].names}. ${items[next].dates}`);
  }
  if (!updated && !items.length) return null;
  return <aside className="lobby-news" aria-label="Latest updates" aria-roledescription="carousel">
    <div className="lobby-news-heading"><a href={link.calendar}>LATEST UPDATES <span aria-hidden="true">›</span></a>{updated && <span>Data updated <time dateTime={new Date(updatedMs!).toISOString()}>{updated}</time></span>}</div>
    <div className="lobby-news-body">
      <div className="lobby-news-window" tabIndex={0} aria-label="News cards. Use left and right arrow keys to browse." onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onMouseEnter={() => { if (window.matchMedia("(hover: hover)").matches) setHovered(true); }} onMouseLeave={() => setHovered(false)} onKeyDown={(event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); move(event.key === "ArrowRight" ? 1 : -1); }
      }} onTouchStart={(event) => { const point = event.touches[0]; touch.current = point ? { x: point.clientX, y: point.clientY } : null; }} onTouchCancel={() => { touch.current = null; }} onTouchEnd={(event) => {
        const point = event.changedTouches[0];
        if (point && touch.current) { const dx = point.clientX - touch.current.x, dy = point.clientY - touch.current.y; if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy)) move(dx < 0 ? 1 : -1); }
        touch.current = null;
      }}>
        {items.map((item, cardIndex) => <article className={`lobby-news-card news-${item.kind} ${cardIndex === currentIndex ? "is-current" : ""}`} key={item.key} aria-hidden={cardIndex !== currentIndex} aria-roledescription="slide" aria-label={`${cardIndex + 1} of ${items.length}`}>
          <strong className="lobby-news-badge">{item.label}</strong><p className="lobby-news-names">{item.names}</p><p className="lobby-news-dates">{item.dates}</p>
        </article>)}
        {!current && <p className="lobby-news-empty">Schedule and forecast data refreshed. Open the calendar for details.</p>}
      </div>
      {items.length > 1 && <div className="lobby-news-controls"><span aria-hidden="true">{currentIndex + 1} / {items.length}</span><div><button type="button" aria-label="Previous news card" title="Previous news card" onClick={() => move(-1)}><IconChevronLeft /></button><button type="button" aria-label={paused ? "Resume news cards" : "Pause news cards"} aria-pressed={paused} title={paused ? "Resume news cards" : "Pause news cards"} onClick={() => setPaused((old) => !old)}>{paused ? <IconPlay /> : <svg className="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h4v14H7zm6 0h4v14h-4z" /></svg>}</button><button type="button" aria-label="Next news card" title="Next news card" onClick={() => move(1)}><IconChevronRight /></button></div></div>}
    </div>
    <span className="sim-visually-hidden" role="status">{announcement}</span>
  </aside>;
}
