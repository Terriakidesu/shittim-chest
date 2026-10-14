import type { Banner, Status } from "../api";
import { schoolColor } from "../api";
import { dayKey } from "../dates";

/**
 * Arona and Plana, kept strictly in their own voices.
 *
 * Arona is casual and sleepy — soft plain forms like 〜だよ. Plana is polite
 * and precise, and closes with 〜です. Neither borrows the other's tic.
 */

const ARONA = "/api/img/mascot/arona";
const PLANA = "/api/img/mascot/plana";

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
  if (!status) return "Opening the Shittim Chest〜…";
  if (status.stale) {
    return `Sensei, the data's gone stale. Should I refresh〜？`;
  }
  if (live > 0 && inFlight > 0) {
    return `${live} banners running right now, and ${inFlight} still waiting on Global〜`;
  }
  if (live > 0) return `${live} banners live right now〜`;
  if (inFlight > 0) return `${inFlight} banners still in flight〜`;
  return "All caught up. Global and JP are in sync〜";
}

export function pickPlanaLine(
  status: Status | null,
  selected: Banner | null,
  formatDate: (ms: number) => string,
): string {
  if (selected?.prediction) {
    const p = selected.prediction;
    return `Global is expected around ${formatDate(
      p.expectedMs,
    )}, with a forecast range of ${formatDate(p.p05Ms)} to ${formatDate(p.p95Ms)}.`;
  }
  if (selected) return selected.forecastStatus === "unresolved" ? "There is insufficient evidence to estimate this banner's Global arrival." : "That banner has a recorded Global date.";
  if (!status?.model) return "Awaiting forecast data.";
  return `The current JP-to-Global lag is ${status.model.currentLagDays} days. Forecast rows show the estimated 90% date range.`;
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
  return b.characters.length
    ? b.characters.map((c) => c.name).join(", ")
    : (b.code ?? "Banner");
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
      className={`chip chip-${banner.server.toLowerCase()} ${selected ? "is-selected" : ""}`}
      style={{ ["--chip" as string]: color }}
      onClick={onClick}
      aria-pressed={!!selected}
      title={`${banner.server === "JP" ? "JP" : "Global"} · ${label(banner)} — ${banner.type}`}
    >
      {who && <img src={who.avatar} alt="" loading="lazy" />}
      <span className="chip-name">{label(banner)}</span>
      <span className="chip-server">{banner.server === "JP" ? "JP" : "GL"}</span>
      {banner.prediction && <span className="chip-flag">~</span>}
    </button>
  );
}

/** Predicted Global arrival, always marked as an estimate. */
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
  return (
    <button
      type="button"
      className={`chip chip-est ${selected ? "is-selected" : ""}`}
      onClick={onClick}
      aria-pressed={!!selected}
      title={p?.method === "scheduled" ? "Scheduled on the wiki" : confidence != null ? `Expected on Global — ${Math.round(confidence * 100)}% historical accuracy within ±7 days` : "Expected on Global — insufficient calibration"}
    >
      {who && <img src={who.avatar} alt="" loading="lazy" />}
      <span className="chip-name">{label(banner)}</span>
      <span className="chip-conf">{p?.method === "scheduled" ? "Wiki" : "~"}</span>
    </button>
  );
}
