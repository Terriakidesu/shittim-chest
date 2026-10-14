import { useEffect, useMemo, useRef, useState } from "react";
import { ThemeSwitch } from "./components/ThemeSwitch";
import {
  api,
  asset,
  emblemUrl,
  schoolColor,
  type Banner,
  type ForecastResponse,
  type Status,
} from "./api";
import { link } from "./route";
import {
  MONTH_NAMES,
  WEEKDAYS,
  ZONES,
  formatClock,
  formatDay,
  formatShort,
  monthGrid,
  todayKey,
  type TimeZone,
} from "./dates";
import {
  Arona,
  BannerChip,
  Plana,
  PredictedChip,
  buildBuckets,
  buildPredictionBuckets,
  pickAronaLine,
  pickPlanaLine,
} from "./components/Mascots";

type ServerFilter = "both" | "JP" | "GL" | "expected";
type TypeFilter = "all" | "PickupGacha" | "LimitedGacha" | "FesGacha";

const TYPE_LABELS: Record<string, string> = {
  all: "All types",
  PickupGacha: "Pick-up",
  LimitedGacha: "Limited",
  FesGacha: "Festival",
};

const PAGE_SIZE = 6;
const CHIP_LIMIT = 3;
const EST_CHIP_LIMIT = 2;

export function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [forecast, setForecast] = useState<ForecastResponse | null>(null);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [zone, setZone] = useState<TimeZone>("local");
  const [serverFilter, setServerFilter] = useState<ServerFilter>("both");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Banner | null>(null);
  const [cursor, setCursor] = useState(() => todayKey("UTC"));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [mobileView, setMobileView] = useState<"agenda" | "month">("agenda");
  const detailDialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 640px)");
    const syncDialog = () => {
      const dialog = detailDialog.current;
      if (!dialog) return;
      if (selected && media.matches && !dialog.open) dialog.showModal();
      else if ((!selected || !media.matches) && dialog.open) dialog.close();
    };
    syncDialog();
    media.addEventListener("change", syncDialog);
    return () => media.removeEventListener("change", syncDialog);
  }, [selected]);

  const tz =
    zone === "local"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
      : zone;
  const today = todayKey(tz);
  const [year, month] = cursor.split("-").map(Number);

  async function load() {
    try {
      // The calendar needs every banner in the window; the forecast endpoint
      // only returns JP banners still in flight. Fetch wide enough that month
      // navigation back through history stays populated.
      const from = Date.now() - 400 * 86_400_000;
      const to = Date.now() + 300 * 86_400_000;
      const [s, f, b] = await Promise.all([
        api.status(),
        api.forecast(),
        api.banners(from, to),
      ]);
      setStatus(s);
      setForecast(f);
      setBanners(b.banners);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    setExpanded(new Set());
    setPage(0);
  }, [cursor, serverFilter, typeFilter, query, zone]);

  // Keep the sidebar scrolled to the top so a newly selected banner's detail
  // is in view rather than below the fold.
  useEffect(() => {
    if (!selected) return;
    document.querySelector(".side")?.scrollTo({ top: 0, behavior: "smooth" });
  }, [selected]);

  async function onRefresh() {
    // No server to trigger — re-read the static snapshot (picks up a newly
    // deployed export without a full page reload).
    setRefreshing(true);
    try {
      await api.refresh();
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setRefreshing(false);
    }
  }

  const query_ = query.trim().toLowerCase();
  const textMatches = (b: Banner) => {
    if (typeFilter !== "all" && b.type !== typeFilter) return false;
    if (!query_) return true;
    return b.characters
      .map((c) => c.name)
      .concat(b.code ?? "")
      .join(" ")
      .toLowerCase()
      .includes(query_);
  };

  const matches = useCallbackFilter((b: Banner) => {
    if (b.evergreen) return false;
    if (serverFilter === "JP" && b.server !== "JP") return false;
    if (serverFilter === "GL" && b.server !== "GL") return false;
    if (serverFilter === "expected" && !b.prediction) return false;
    return textMatches(b);
  }, [serverFilter, textMatches]);

  const realBanners = useMemo(() => banners.filter(matches), [banners, matches]);
  const predictedBanners = useMemo(
    () => banners.filter((b) => b.prediction && matches(b) && (b.prediction.method !== "scheduled" || serverFilter === "expected")),
    [banners, matches],
  );

  const grid = useMemo(() => monthGrid(year, month), [year, month]);
  const dayKeys = useMemo(() => grid.map((c) => c.key), [grid]);
  const buckets = useMemo(
    () => buildBuckets(realBanners, tz, dayKeys),
    [realBanners, tz, dayKeys],
  );
  const predictions = useMemo(
    () => buildPredictionBuckets(predictedBanners, tz, dayKeys),
    [predictedBanners, tz, dayKeys],
  );

  const showReal = serverFilter !== "expected";
  const nowMs = Date.now();
  const liveCount = realBanners.filter(
    (b) => b.startMs <= nowMs && b.endMs > nowMs,
  ).length;

  const shift = (delta: number) => {
    setCursor(
      new Date(Date.UTC(year, month - 1 + delta, 1))
        .toISOString()
        .slice(0, 7) + "-01",
    );
  };

  const toggleDay = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  /*
    Every row here is by definition a JP banner still in flight, so the
    server filter does not apply — but type and search should.
  */
  const flightRows = useMemo(
    () =>
      (forecast?.banners ?? [])
        .filter(textMatches)
        .sort(
          (a, b) =>
            (a.prediction?.expectedMs ?? 0) - (b.prediction?.expectedMs ?? 0),
        ),
    [forecast, textMatches],
  );

  const pages = Math.max(1, Math.ceil(flightRows.length / PAGE_SIZE));
  const pageRows = flightRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const aronaLine = pickAronaLine(status, liveCount, forecast?.count ?? 0);
  const planaLine = pickPlanaLine(status, selected, (ms) => formatDay(ms, tz));

  // The snapshot carries its export time; data age is derived from it rather
  // than from a server's fetch clock. Stale snapshots stay visible as stale.
  const dataAgeDays =
    status?.exportedAtMs != null
      ? (Date.now() - status.exportedAtMs) / 86_400_000
      : (status?.dataAgeDays ?? null);
  const isStale =
    dataAgeDays != null && status != null
      ? dataAgeDays >= status.refreshIntervalDays
      : !!status?.stale;

  return (
    <div className={`app mobile-${mobileView}`}>
      <div className="topbar">
        <div>
          <div className="title">
            <img className="mark" src={asset("shittim-chest.svg")} alt="Shittim Chest emblem" width="44" height="52" />
            <h1>
              Shittim Chest <span className="sub">Gacha Calendar</span>
            </h1>
          </div>
          <p className="tagline">
            Live on the Japanese server, and when Global is expected to catch up.
          </p>
          <a className="simulator-link" href={link.simulator}>Open recruitment simulator ↗</a>
          <div className="calendar-theme"><ThemeSwitch /><a className="about-link" href={link.about}>About &amp; credits</a></div>
        </div>
        <div className="pills">
          <div className="pill accent" title="Median lag at the frontier">
            <span className="k">JP → GL lag</span>
            <span className="v">
              {status?.model?.currentLagDays != null
                ? `${status.model.currentLagDays}d`
                : "—"}
            </span>
          </div>
          <div className="pill" title="JP banners not yet on Global">
            <span className="k">Awaiting Global</span>
            <span className="v">{forecast?.count ?? "—"}</span>
          </div>
          <div className="pill" title="Global's median gap between updates">
            <span className="k">Update cadence</span>
            <span className="v">
              {status?.model ? `~${status.model.medianIntervalDays}d` : "—"}
            </span>
          </div>
        </div>
      </div>

      <div className={`syncbar ${isStale ? "is-stale" : ""}`} role="status">
        <span className="dot" />
        {dataAgeDays == null
          ? "Connecting…"
          : `Updated ${dataAgeDays < 1 ? "today" : `${Math.round(dataAgeDays)}d ago`} · forecasts refresh weekly`}
        <button className="btn" onClick={onRefresh} disabled={refreshing}>
          <span>{refreshing ? "Reloading…" : "Reload"}</span>
        </button>
      </div>

      {error && <div className="alert" role="alert">Could not load the forecast data: {error}</div>}

      <section className="controls">
        <div className="tabs" role="group" aria-label="Server filter">
          {(["both", "JP", "GL", "expected"] as ServerFilter[]).map((s) => (
            <button
              key={s}
              className={serverFilter === s ? "on" : ""}
              aria-pressed={serverFilter === s}
              onClick={() => setServerFilter(s)}
            >
              <span>{s === "both" ? "Both" : s === "JP" ? "JP" : s === "GL" ? "Global" : "Expected"}</span>
            </button>
          ))}
        </div>
        <select
          aria-label="Banner type"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
        >
          {Object.entries(TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select aria-label="Time zone" value={zone} onChange={(e) => setZone(e.target.value as TimeZone)}>
          {ZONES.map((z) => (
            <option key={z.id} value={z.id}>{z.label}</option>
          ))}
        </select>
        <input
          className="search"
          type="search"
          aria-label="Search characters"
          placeholder="Search character…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </section>

      <main className="layout">
        <section className="panel calendar">
          <div className="calendar-head">
            <button className="nav" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
            <h2>{MONTH_NAMES[month - 1]} {year}</h2>
            <button className="nav" onClick={() => shift(1)} aria-label="Next month">›</button>
            <button className="btn ghost" onClick={() => setCursor(today)}>
              <span>Today</span>
            </button>
          </div>
          <div className="calendar-meta">
            <span><i className="live-dot" /> Recruitment schedule <span className="zone-label">· {zone === "local" ? "Your local time" : zone === "Asia/Tokyo" ? "Japan time (JST)" : "UTC"}</span></span>
            <div className="view-switch" role="group" aria-label="Calendar view">
              <button aria-pressed={mobileView === "agenda"} onClick={() => setMobileView("agenda")}>Agenda</button>
              <button aria-pressed={mobileView === "month"} onClick={() => setMobileView("month")}>Month</button>
            </div>
          </div>
          <div className="weekdays">
            {WEEKDAYS.map((w) => <div key={w}>{w}</div>)}
          </div>
          <div className="days">
            {grid.map((cell) => {
              const bucket = buckets.get(cell.key);
              const starting = showReal ? (bucket?.starting ?? []) : [];
              const ongoing = bucket?.ongoing ?? [];
              const est = predictions.get(cell.key) ?? [];
              const isOpen = expanded.has(cell.key);
              const realLimit = isOpen ? starting.length : CHIP_LIMIT;
              const estLimit = isOpen ? est.length : EST_CHIP_LIMIT;
              const hiddenReal = Math.max(0, starting.length - realLimit);
              const hiddenEst = Math.max(0, est.length - estLimit);
              const hidden = hiddenReal + hiddenEst;
              const collapsible =
                starting.length > CHIP_LIMIT || est.length > EST_CHIP_LIMIT;

              return (
                <div
                  key={cell.key}
                  className={`day ${starting.length || est.length ? "has-events" : ""} ${cell.inMonth ? "" : "muted"} ${cell.key === today ? "today" : ""} ${isOpen ? "open" : ""}`}
                >
                  <div className="daynum">
                    <span><span className="day-label">{WEEKDAYS[(new Date(`${cell.key}T12:00:00Z`).getUTCDay() + 6) % 7]} </span>{cell.day}<span className="today-label">{cell.key === today ? "Today" : ""}</span></span>
                    {est.length > 0 && (
                      <span className="est-badge" title="Predicted Global arrivals">
                        ~{est.length}
                      </span>
                    )}
                  </div>

                  {ongoing.length > 0 && (
                    <div className="ongoing" title={`${ongoing.length} running`}>
                      <span style={{ background: barColor(ongoing[0]) }} />
                      <span style={{ background: barColor(ongoing[1] ?? ongoing[0]) }} />
                      <span style={{ background: barColor(ongoing[2] ?? ongoing[0]) }} />
                    </div>
                  )}

                  <div className="chips">
                    {starting.slice(0, realLimit).map((b) => (
                      <BannerChip
                        key={`${b.server}-${b.id}`}
                        banner={b}
                        selected={selected?.server === b.server && selected.id === b.id}
                        onClick={() => setSelected(b)}
                      />
                    ))}
                  </div>

                  {est.length > 0 && (
                    <div className="est-group">
                      <div className="est-label">Expected Global</div>
                      <div className="chips">
                        {est.slice(0, estLimit).map((b) => (
                          <PredictedChip
                            key={`est-${b.id}`}
                            banner={b}
                            selected={selected?.id === b.id && selected.server === "JP"}
                            onClick={() => setSelected(b)}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {hidden > 0 && (
                    <button
                      className="more"
                      onClick={() => toggleDay(cell.key)}
                      aria-expanded="false"
                    >
                      +{hidden} more
                    </button>
                  )}
                  {isOpen && collapsible && (
                    <button
                      className="more collapse"
                      onClick={() => toggleDay(cell.key)}
                      aria-expanded="true"
                    >
                      show less
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {!grid.some((cell) => cell.inMonth && ((showReal && (buckets.get(cell.key)?.starting.length ?? 0) > 0) || (predictions.get(cell.key)?.length ?? 0) > 0)) && (
            <div className="agenda-empty">No banner arrivals this month match your filters.</div>
          )}
          <div className="legend">
            <span><i className="sw jp" /> JP banner</span>
            <span><i className="sw gl" /> Global banner</span>
            <span><i className="sw est" /> Expected Global</span>
            <span>Colour = school</span>
          </div>
        </section>

        <aside className="side">
          <Detail banner={selected} tz={tz} onClose={() => setSelected(null)} />

          <section className="panel">
            <div className="phead pink">
              <span className="lead" />
              Global forecast
              <span className="section-note">Estimates</span>
            </div>
            <div className="pbody rows">
              {pageRows.length === 0 ? (
                <div className="empty">Nothing in flight right now.</div>
              ) : (
                pageRows.map((b) => {
                  const p = b.prediction;
                  const who = b.characters[0];
                  return (
                    <button
                      key={b.id}
                      className={`row ${selected?.id === b.id ? "is-selected" : ""}`}
                      onClick={() => setSelected(b)}
                    >
                      {who && <img src={asset(who.avatar)} alt="" loading="lazy" />}
                      <span className="meta">
                        <span className="name">
                          {b.characters.map((c) => c.name).join(", ") || b.code}
                        </span>
                        <span className="sub">
                          {p ? formatDay(p.expectedMs, tz) : ""}
                        </span>
                        {p && <span className="range">{p.method === "scheduled" ? "Scheduled on wiki" : `${p.calibrationSamples ? "90% target range" : "Uncalibrated range"} · ${formatShort(p.p05Ms, tz)}–${formatShort(p.p95Ms, tz)}`}</span>}
                      </span>
                      <span
                        className={`count ${(p?.confidence ?? 0) >= 0.8 ? "calm" : (p?.confidence ?? 0) >= 0.6 ? "" : "faint"}`}
                        title={p?.method === "scheduled" ? "Wiki schedule, not independently verified" : "Historical accuracy within ±7 days, not probability of this exact date"}
                        aria-label={p?.confidence != null ? `${Math.round(p.confidence * 100)}% historical accuracy within seven days` : "No calibrated probability"}
                      >
                        {p?.method === "scheduled" ? "Wiki" : p?.confidence != null ? `${Math.round(p.confidence * 100)}%` : "—"}
                        <small className="prob-label">{p?.method === "scheduled" ? "Scheduled" : "±7 days"}</small>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            {pages > 1 && (
              <Pager page={page} pages={pages} onChange={setPage} />
            )}
          </section>

          <details className="panel projections">
            <summary className="phead cyan">
              <span className="lead" />
              Projected Global updates
              <span className="section-note">Forecast</span>
            </summary>
            <div className="pbody rows">
              {(forecast?.projectedBatches ?? []).slice(0, 7).map((p) => (
                <div key={p.index} className="row static">
                  <span className="meta">
                    <span className="name">Update +{p.step}</span>
                  </span>
                  <span className="count faint">{formatDay(p.startMs, tz)}</span>
                </div>
              ))}
              {(!forecast || forecast.projectedBatches.length === 0) && (
                <div className="empty">No projections available.</div>
              )}
            </div>
          </details>
          {(forecast?.unresolvedBanners.length ?? 0) > 0 && (
            <details className="panel projections">
              <summary className="phead"><span className="lead" />Unresolved history<span className="section-note">{forecast!.unresolvedBanners.length}</span></summary>
              <p className="hint">These JP banners lack a reliable Global match. They are not assumed to have arrived, but there is insufficient evidence to assign a new date.</p>
              <div className="rows">{forecast!.unresolvedBanners.slice(-30).reverse().map(b => <button key={b.id} className="row" onClick={() => setSelected(b)}><span className="meta"><span className="name">{b.characters.map(c => c.name).join(", ") || b.code}</span><span className="sub">JP · {formatDay(b.startMs, tz)}</span></span></button>)}</div>
              {forecast!.unresolvedBanners.length > 30 && <p className="hint">Showing 30 records; the full unresolved set is available through the forecast API.</p>}
            </details>
          )}
        </aside>
      </main>
      <dialog ref={detailDialog} className="detail-sheet" aria-label="Banner details" onCancel={() => setSelected(null)} onClick={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
        <Detail banner={selected} tz={tz} onClose={() => setSelected(null)} />
      </dialog>

      {/* Guide strip: the mascots live here rather than floating over the
          calendar and sidebar, where they used to block content. */}
      <section className="guide">
        <Arona line={aronaLine} />
        <div className="guide-credits">
          <span className="schale-signature"><img src={asset("schale.svg?v=2")} alt="S.C.H.A.L.E. emblem" width="26" height="30" /> S.C.H.A.L.E. / SHITTIM CHEST</span>
          Banner history from the{" "}
          <a href="https://bluearchive.wiki/wiki/Banner_List" target="_blank" rel="noreferrer">
            Blue Archive Wiki
          </a>
          ; portraits from{" "}
          <a href="https://schaledb.com" target="_blank" rel="noreferrer">SchaleDB</a>.
          <span className="est-note">
            Estimates use JP history. Wiki schedules are labeled separately; neither replaces official announcements.
          </span>
        </div>
        <Plana line={planaLine} />
      </section>
    </div>
  );
}

/** Tiny helper so the filter predicate stays referentially stable. */
function useCallbackFilter<T>(fn: (v: T) => boolean, deps: unknown[]) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => fn, deps);
}

function Pager({
  page,
  pages,
  onChange,
}: {
  page: number;
  pages: number;
  onChange: (p: number) => void;
}) {
  return (
    <div className="pager">
      <button
        className="pbtn"
        disabled={page === 0}
        onClick={() => onChange(page - 1)}
        aria-label="Previous page"
      >
        ‹
      </button>
      <span className="pinfo">
        Page {page + 1} / {pages}
      </span>
      <button
        className="pbtn"
        disabled={page >= pages - 1}
        onClick={() => onChange(page + 1)}
        aria-label="Next page"
      >
        ›
      </button>
    </div>
  );
}

function barColor(b: Banner) {
  const who = b.characters[0];
  return who ? schoolColor(who.school) : "#8e9aa8";
}

/**
 * School emblem where the wiki publishes one, otherwise the school's colour.
 * The emblems are monochrome dark navy, so dark mode inverts them.
 */
function SchoolMark({ school, size = 13 }: { school: string; size?: number }) {
  const src = emblemUrl(school);
  if (!src) {
    return (
      <i
        className="school-dot"
        style={{ background: schoolColor(school), width: size - 3, height: size - 3 }}
      />
    );
  }
  return (
    <img
      className="school-emblem"
      src={src}
      alt=""
      style={{ width: size, height: size }}
      onError={(e) => {
        // Fall back to the colour dot if the local cache ever misses.
        (e.currentTarget as HTMLImageElement).style.display = "none";
      }}
    />
  );
}

function Detail({
  banner,
  tz,
  onClose,
}: {
  banner: Banner | null;
  tz: string;
  onClose: () => void;
}) {
  return (
    <section className="panel">
      <div className="phead">
        <span className="lead" />
        {banner ? "Banner detail" : "Select a banner"}
        {banner ? (
          <button className="nav" onClick={onClose} aria-label="Close" style={{ marginLeft: "auto" }}>
            ×
          </button>
        ) : (
          <span className="section-note">Details</span>
        )}
      </div>
      <div className="pbody">
        {!banner && (
          <div className="hint">
            Pick a banner from the calendar to see its window, school and the
            predicted Global arrival.
          </div>
        )}
        {banner && <DetailBody banner={banner} tz={tz} />}
      </div>
    </section>
  );
}

function DetailBody({ banner, tz }: { banner: Banner; tz: string }) {
  const p = banner.prediction;
  const who = banner.characters[0];
  const whoName = banner.characters.map((c) => c.name).join(", ") || banner.code;
  const typeLabel = banner.type.replace(/Gacha$/, "");

  return (
    <>
      {banner.imageUrl && <img className="detail-art" src={asset(banner.imageUrl)} alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />}

      {/* Identity, tags and school on one line — the art already shows the
          character, so a second avatar block is wasted height. */}
      <div className="detail-id">
        {who && <img src={asset(who.avatar)} alt="" className="detail-face" />}
        <div className="detail-idtext">
          <div className="detail-name">{whoName}</div>
          <div className="detail-tags">
            <span className={`tag ${banner.server === "JP" ? "jp" : "gl"}`}>
              {banner.server === "JP" ? "JP" : "GLOBAL"}
            </span>
            <span className="tag soft">{typeLabel}</span>
            {banner.rerun && <span className="tag rerun">RERUN</span>}
            {banner.limited && <span className="tag limit">LIMITED</span>}
            {who && (
              <span className="tag school" title={who.school}>
                <SchoolMark school={who.school} />
                {who.school}
              </span>
            )}
          </div>
        </div>
      </div>

      <dl className="detail-grid">
        <dt>{banner.server === "JP" ? "JP window" : "Global window"}</dt>
        <dd>
          {formatDay(banner.startMs, tz)}
          <span className="clock">{formatClock(banner.startMs, tz)}</span>
          <span className="arrow">→</span>
          {formatDay(banner.endMs, tz)}
        </dd>

        {banner.confirmedGlStartMs != null && (
          <>
            <dt>Arrived on Global</dt>
            <dd className="good">{formatDay(banner.confirmedGlStartMs, tz)}</dd>
          </>
        )}

        {p && (
          <>
            <dt>{p.method === "scheduled" ? "Scheduled" : "Expected"}</dt>
            <dd className="est">{formatDay(p.expectedMs, tz)}</dd>
            <dt>{p.method === "scheduled" ? "Wiki date" : p.calibrationSamples ? "90% target range" : "Fallback range"}</dt>
            <dd>
              {formatShort(p.p05Ms, tz)} <span className="arrow">→</span>{" "}
              {formatShort(p.p95Ms, tz)}
            </dd>
            <dt>Within ±7 days</dt>
            <dd className="conf">
              <span className="meter">
                <span style={{ width: `${Math.round((p.confidence ?? 0) * 100)}%` }} />
              </span>
              {p.confidence == null ? "Not calibrated" : `${Math.round(p.confidence * 100)}% historically`}
            </dd>
            <dt>Evidence</dt><dd>{p.calibrationSamples ? `${p.calibrationSamples} update outcomes` : p.method === "scheduled" ? "Wiki schedule" : "Insufficient calibration"}</dd>
          </>
        )}
      </dl>

      {p && <p className="disclaimer">{p.explanation} {p.method !== "scheduled" && "Estimate only, not an announcement."}</p>}
      {!p && banner.forecastStatus === "unresolved" && <p className="disclaimer">No reliable Global correspondence or date estimate is available.</p>}
      <a className="sim-detail-link" href={`#/simulator?server=${banner.server}&period=${encodeURIComponent(`${banner.server}:${banner.startMs}`)}&banner=${banner.id}`}>Open this period in the recruitment simulator ↗</a>
    </>
  );
}
