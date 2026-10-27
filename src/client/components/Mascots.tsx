import type { Banner, Status } from "../api";
import { asset, schoolColor } from "../api";
import { dayKey } from "../dates";
import { bannerNames, t, typeLabel } from "../i18n";

/**
 * Arona and Plana, kept strictly in their own voices.
 *
 * Arona is casual and sleepy — soft plain forms like 〜だよ. Plana is polite
 * and precise, and closes with 〜です. Neither borrows the other's tic.
 */

const ARONA = asset("img/mascot/arona.png");
const PLANA = asset("img/mascot/plana.png");

export function Arona({ line }: { line: string }) {
  return (
    <div className="mascot mascot-arona">
      <img src={ARONA} alt="" loading="lazy" />
      <div className="speech" role="status">{line}</div>
    </div>
  );
}

export function Plana({ line }: { line: string }) {
  return (
    <div className="mascot mascot-plana">
      <div className="speech" role="status">{line}</div>
      <img src={PLANA} alt="" loading="lazy" />
    </div>
  );
}

export function pickAronaLine(
  status: Status | null,
  live: number,
  inFlight: number,
): string {
  if (!status) return t("arona.opening");
  if (status.stale) {
    return t("arona.stale");
  }
  if (live > 0 && inFlight > 0) {
    return t("arona.liveFlight", { live, inFlight });
  }
  if (live > 0) return t("arona.live", { live });
  if (inFlight > 0) return t("arona.flight", { inFlight });
  return t("arona.synced");
}

export function pickPlanaLine(
  status: Status | null,
  selected: Banner | null,
  formatDate: (ms: number) => string,
): string {
  if (selected?.prediction) {
    const p = selected.prediction;
    return t("plana.range", {
      date: formatDate(p.expectedMs),
      from: formatDate(p.p05Ms),
      to: formatDate(p.p95Ms),
    });
  }
  if (selected) return selected.forecastStatus === "unresolved" ? t("plana.unresolved") : t("plana.recorded");
  if (!status?.model) return t("plana.awaiting");
  return t("plana.lag", { days: status.model.currentLagDays ?? "?" });
}

/* ------------------------------------------------------------------ */

export interface DayBucket {
  starting: Banner[];
  ongoing: Banner[];
}

/** Real banners that start on a given day. */
export function buildBuckets(
  banners: Banner[],
  tz: string,
  days: string[],
): Map<string, DayBucket> {
  const map = new Map<string, DayBucket>();
  for (const d of days) map.set(d, { starting: [], ongoing: [] });

  for (const b of banners) {
    const startKey = dayKey(b.startMs, tz);
    const bucket = map.get(startKey);
    if (bucket) bucket.starting.push(b);

    // Mark every day the banner is still running inside the visible range.
    let cursor = startKey;
    let guard = 0;
    while (guard++ < 400) {
      if (map.has(cursor)) {
        const b2 = map.get(cursor)!;
        if (cursor !== startKey) b2.ongoing.push(b);
      }
      if (cursor >= dayKey(b.endMs, tz)) break;
      const [y, m, d] = cursor.split("-").map(Number);
      cursor = new Date(Date.UTC(y, m - 1, d) + 86_400_000)
        .toISOString()
        .slice(0, 10);
    }
  }
  return map;
}

/**
 * Predicted Global arrivals, bucketed onto the day we expect them to land.
 * This is what puts the forecast *on the calendar* rather than only in a
 * side panel.
 */
export function buildPredictionBuckets(
  banners: Banner[],
  tz: string,
  days: string[],
): Map<string, Banner[]> {
  const map = new Map<string, Banner[]>();
  for (const d of days) map.set(d, []);
  for (const b of banners) {
    const when = b.prediction?.expectedMs;
    if (when == null) continue;
    const key = dayKey(when, tz);
    map.get(key)?.push(b);
  }
  return map;
}

function label(b: Banner) {
  return bannerNames(b);
}

export function BannerChip({
  banner,
  onClick,
  selected,
}: {
  banner: Banner;
  onClick?: () => void;
  selected?: boolean;
}) {
  const who = banner.characters[0];
  const color = who ? schoolColor(who.school) : "#8e9aa8";
  return (
    <button
      type="button"
      className={`chip chip-${banner.server.toLowerCase()} ${banner.provisional ? "chip-provisional" : ""} ${selected ? "is-selected" : ""}`}
      style={{ ["--chip" as string]: color }}
      onClick={onClick}
      aria-pressed={!!selected}
      title={`${banner.server === "JP" ? t("chip.server.jp") : t("chip.server.gl")} · ${label(banner)} — ${typeLabel(banner.type)}${banner.provisional ? ` · ${t("chip.title.announced")}` : ""}`}
    >
      {who && <img src={asset(who.avatar)} alt="" loading="lazy" />}
      <span className="chip-name">{label(banner)}</span>
      <span className="chip-server">{banner.server === "JP" ? "JP" : "GL"}</span>
      {banner.prediction && <span className="chip-flag">~</span>}
      {banner.provisional && <span className="chip-flag" aria-label={t("cal.tag.announced")}>!</span>}
    </button>
  );
}

/** Predicted or officially scheduled Global arrival. */
export function PredictedChip({
  banner,
  onClick,
  selected,
}: {
  banner: Banner;
  onClick?: () => void;
  selected?: boolean;
}) {
  const p = banner.prediction;
  const who = banner.characters[0];
  const confidence = p?.confidence;
  const official = p?.method === "scheduled" && p.source === "official";
  return (
    <button
      type="button"
      className={`chip chip-est ${selected ? "is-selected" : ""}`}
      onClick={onClick}
      aria-pressed={!!selected}
      title={official ? t("chip.title.official") : p?.method === "scheduled" ? t("chip.title.scheduled") : confidence != null ? t("chip.title.confidence", { n: Math.round(confidence * 100) }) : t("chip.title.uncalibrated")}
    >
      {who && <img src={asset(who.avatar)} alt="" loading="lazy" />}
      <span className="chip-name">{label(banner)}</span>
      <span className="chip-conf">{official ? "✓" : p?.method === "scheduled" ? "Wiki" : "~"}</span>
    </button>
  );
}
