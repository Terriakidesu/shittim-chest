import { asset } from "../api";
import { link } from "../route";
import { newsDate, newsDateRange, newsUpdateLabel, type LobbyNewsItem } from "../lobbyNews";
import { t, useLanguage, studentName, type LangKey } from "../i18n";

/** Faces per card. The first card leads the strip and carries one more. */
const LEAD_FACES = 3;
const ROW_FACES = 2;

/** Badge text, built at render so a language switch is immediate. */
function badge(item: LobbyNewsItem) {
  // Forecast and scheduled cards announce a Global arrival, so their scope is
  // naturally Global; window cards name the server the window belongs to.
  const scope = item.kind === "forecast" || item.kind === "scheduled"
    ? t("news.global")
    : t(item.server === "JP" ? "news.japan" : "news.global");
  const state = item.announced
    ? t("news.announced")
    : item.kind === "scheduled" && item.official ? t("news.confirmed") : t(`news.${item.kind}` as LangKey);
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

/** Featured names; the faces below carry the rest of the pool. */
function headline(item: LobbyNewsItem) {
  return item.students.slice(0, 2).map(({ student }) => studentName(student)).join(" · ");
}

/** Full roster, read out instead of the truncated headline. */
function spokenNames(item: LobbyNewsItem) {
  return item.students.map(({ student }) => studentName(student)).join(", ");
}

function Faces({ item, limit }: { item: LobbyNewsItem; limit: number }) {
  const withArt = item.students.filter(({ student }) => student.avatar);
  const shown = withArt.slice(0, limit);
  if (!shown.length) return null;
  const extra = withArt.length - shown.length;
  return (
    <span className="lobby-news-faces" aria-hidden="true">
      {shown.map(({ student }) => (
        <img key={student.id} src={asset(student.avatar)} alt="" width="40" height="40" loading="lazy" decoding="async" />
      ))}
      {extra > 0 && <span className="lobby-news-more">+{extra}</span>}
    </span>
  );
}

/**
 * Three static updates instead of a carousel: nothing rotates away before it
 * is read, there are no transport controls to explain, and every card is a
 * link to the calendar. `topUpdates` does the ordering.
 */
export function LobbyNews({ updatedMs, items }: { updatedMs: number | null; items: LobbyNewsItem[] }) {
  useLanguage();
  const updated = newsUpdateLabel(updatedMs);
  if (!updated && !items.length) return null;
  return <aside className="lobby-news" aria-label={t("news.aria")}>
    <div className="lobby-news-heading">
      <a href={link.calendar}>{t("news.heading")} <span aria-hidden="true">›</span></a>
      {updated && <span>{t("news.dataUpdated", { date: updated })}</span>}
    </div>
    <div className="lobby-news-body">
      {!items.length && <p className="lobby-news-empty">{t("news.empty")}</p>}
      {items.map((item, index) => {
        const lead = index === 0;
        const rerun = item.students.length > 0 && item.students.every(({ rerun }) => rerun);
        return (
          <a
            key={item.key}
            className={`lobby-news-item news-${item.kind}${item.announced ? " is-announced" : ""}${lead ? " is-lead" : ""}`}
            href={link.calendar}
            aria-label={`${badge(item)}: ${spokenNames(item)}. ${dates(item)}`}
          >
            <span className="lobby-news-tags">
              <span className="lobby-news-badge">{badge(item)}</span>
              {rerun && <span className="lobby-news-rerun">{t("news.rerun")}</span>}
            </span>
            <Faces item={item} limit={lead ? LEAD_FACES : ROW_FACES} />
            <strong className="lobby-news-names">{headline(item)}</strong>
            <span className="lobby-news-dates">{dates(item)}</span>
          </a>
        );
      })}
    </div>
  </aside>;
}
