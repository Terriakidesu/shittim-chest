import { useEffect, useMemo, useRef, useState } from "react";
import { ThemeSwitch } from "./components/ThemeSwitch";
import { LanguageSwitch } from "./components/LanguageSwitch";
import { IconChevronLeft, IconChevronRight, IconClose, IconExternal } from "./components/icons";
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
import { SiteNav } from "./components/SiteNav";
import {
  ZONES,
  formatClock,
  formatDay,
  formatMonthHeading,
  formatShort,
  monthGrid,
  todayKey,
  type TimeZone,
} from "./dates";
import {
  t,
  useLanguage,
  weekdays,
  typeLabel as bannerTypeLabel,
  schoolName as schoolLabel,
  studentName,
  translateModelString,
  type LangKey,
} from "./i18n";
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

const TYPE_OPTIONS: TypeFilter[] = ["all", "PickupGacha", "LimitedGacha", "FesGacha"];
const TYPE_KEYS: Record<TypeFilter, LangKey> = {
  all: "cal.type.all",
  PickupGacha: "cal.type.pickup",
  LimitedGacha: "cal.type.limited",
  FesGacha: "cal.type.festival",
};
const SERVER_KEYS: Record<ServerFilter, LangKey> = {
  both: "cal.filter.both",
  JP: "cal.filter.jp",
  GL: "cal.filter.gl",
  expected: "cal.filter.expected",
};
const ZONE_KEYS: Record<TimeZone, LangKey> = {
  local: "zone.local",
  "Asia/Tokyo": "zone.jst",
  UTC: "zone.utc",
};
const META_ZONE_KEYS: Record<TimeZone, LangKey> = {
  local: "cal.zone.local",
  "Asia/Tokyo": "cal.zone.jst",
  UTC: "zone.utc",
};

const PAGE_SIZE = 6;
const CHIP_LIMIT = 3;
const EST_CHIP_LIMIT = 2;

export function App() {
  // Language subscription: every string below is built at render, so a switch
  // relocalizes the calendar, sidebar and mascots without remounting state.
  useLanguage();
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
    // Search every spelling a user might type: English plus the localized
    // dumps (so Japanese input matches under ja and Korean under ko).
    return b.characters
      .flatMap((c) => [c.name, c.nameJp, c.nameKr])
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
    () => banners.filter((b) => b.prediction && matches(b) && (b.prediction.method !== "scheduled" || serverFilter === "expected" || b.prediction.source === "official")),
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

  const predictionLabel = (rows: Banner[]) => {
    const confirmed = rows.filter((b) => b.prediction?.source === "official").length;
    return confirmed === 0
      ? t("cal.predict.expected")
      : confirmed === rows.length
        ? t("cal.predict.confirmed")
        : t("cal.predict.mixed");
  };

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
      <SiteNav active="calendar" />
      <div className="topbar">
        <div>
          <div className="title">
            <img className="mark" src={asset("shittim-chest.svg")} alt="Shittim Chest emblem" width="44" height="52" />
            <h1>
              Shittim Chest <span className="sub">{t("cal.subtitle")}</span>
            </h1>
          </div>
          <p className="tagline">
            {t("cal.tagline")}
          </p>
          <a className="simulator-link" href={link.simulator}>{t("cal.openSim")} <IconExternal /></a>
          <div className="calendar-theme"><LanguageSwitch /><ThemeSwitch /><a className="about-link" href={link.about}>{t("cal.aboutLink")}</a></div>
        </div>
        <div className="pills">
          <div className="pill accent" title={t("cal.lagTitle")}>
            <span className="k">{t("cal.lag")}</span>
            <span className="v">
              {status?.model?.currentLagDays != null
                ? t("cal.lagDays", { n: status.model.currentLagDays, unit: t("cal.dayUnit") })
                : "—"}
            </span>
          </div>
          <div className="pill" title={t("cal.awaitingTitle")}>
            <span className="k">{t("cal.awaiting")}</span>
            <span className="v">{forecast?.count ?? "—"}</span>
          </div>
          <div className="pill" title={t("cal.cadenceTitle")}>
            <span className="k">{t("cal.cadence")}</span>
            <span className="v">
              {status?.model ? `~${status.model.medianIntervalDays}${t("cal.dayUnit")}` : "—"}
            </span>
          </div>
        </div>
      </div>

      <div className={`syncbar ${isStale ? "is-stale" : ""}`} role="status">
        <span className="dot" />
        {dataAgeDays == null
          ? t("cal.connecting")
          : `${dataAgeDays < 1 ? t("cal.updatedToday") : t("cal.updatedAgo", { n: Math.round(dataAgeDays) })}${t("cal.syncCadence")}`}
        <button className="btn" onClick={onRefresh} disabled={refreshing}>
          <span>{refreshing ? t("cal.reloading") : t("cal.reload")}</span>
        </button>
      </div>

      {error && <div className="alert" role="alert">{t("cal.loadError", { error })}</div>}

      <section className="controls">
        <div className="tabs" role="group" aria-label={t("cal.filterAria")}>
          {(["both", "JP", "GL", "expected"] as ServerFilter[]).map((s) => (
            <button
              key={s}
              className={serverFilter === s ? "on" : ""}
              aria-pressed={serverFilter === s}
              onClick={() => setServerFilter(s)}
            >
              <span>{t(SERVER_KEYS[s])}</span>
            </button>
          ))}
        </div>
        <select
          aria-label={t("cal.typeFilterAria")}
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
        >
          {TYPE_OPTIONS.map((k) => (
            <option key={k} value={k}>{t(TYPE_KEYS[k])}</option>
          ))}
        </select>
        <select aria-label={t("cal.zoneFilterAria")} value={zone} onChange={(e) => setZone(e.target.value as TimeZone)}>
          {ZONES.map((z) => (
            <option key={z.id} value={z.id}>{t(ZONE_KEYS[z.id])}</option>
          ))}
        </select>
        <input
          className="search"
          type="search"
          aria-label={t("cal.searchAria")}
          placeholder={t("cal.searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </section>

      <main className="layout">
        <section className="panel calendar">
          <div className="calendar-head">
            <button className="nav" onClick={() => shift(-1)} aria-label={t("cal.prevMonth")}><IconChevronLeft /></button>
            <h2>{formatMonthHeading(year, month)}</h2>
            <button className="nav" onClick={() => shift(1)} aria-label={t("cal.nextMonth")}><IconChevronRight /></button>
            <button className="btn ghost" onClick={() => setCursor(today)}>
              <span>{t("cal.today")}</span>
            </button>
          </div>
          <div className="calendar-meta">
            <span><i className="live-dot" /> {t("cal.schedule")} <span className="zone-label">· {t(META_ZONE_KEYS[zone])}</span></span>
            <div className="view-switch" role="group" aria-label={t("cal.viewAria")}>
              <button aria-pressed={mobileView === "agenda"} onClick={() => setMobileView("agenda")}>{t("cal.view.agenda")}</button>
              <button aria-pressed={mobileView === "month"} onClick={() => setMobileView("month")}>{t("cal.view.month")}</button>
            </div>
          </div>
          <div className="weekdays">
            {weekdays().map((w) => <div key={w}>{w}</div>)}
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
                    <span><span className="day-label">{weekdays()[(new Date(`${cell.key}T12:00:00Z`).getUTCDay() + 6) % 7]} </span>{cell.day}<span className="today-label">{cell.key === today ? t("cal.today") : ""}</span></span>
                    {est.length > 0 && (
                      <span className="est-badge" title={t("cal.estTitle")}>
                        ~{est.length}
                      </span>
                    )}
                  </div>

                  {ongoing.length > 0 && (
                    <div className="ongoing" title={t("cal.ongoingTitle", { n: ongoing.length })}>
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
                        <div className="est-label">{predictionLabel(est)}</div>
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
                      {t("cal.more", { n: hidden })}
                    </button>
                  )}
                  {isOpen && collapsible && (
                    <button
                      className="more collapse"
                      onClick={() => toggleDay(cell.key)}
                      aria-expanded="true"
                    >
                      {t("cal.less")}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {!grid.some((cell) => cell.inMonth && ((showReal && (buckets.get(cell.key)?.starting.length ?? 0) > 0) || (predictions.get(cell.key)?.length ?? 0) > 0)) && (
            <div className="agenda-empty">{t("cal.emptyMonth")}</div>
          )}
          <div className="legend">
            <span><i className="sw jp" /> {t("cal.legend.jp")}</span>
            <span><i className="sw gl" /> {t("cal.legend.gl")}</span>
            <span><i className="sw est" /> {t("cal.legend.est")}</span>
            <span>{t("cal.legend.color")}</span>
          </div>
        </section>

        <aside className="side">
          <Detail banner={selected} tz={tz} onClose={() => setSelected(null)} />

          <section className="panel">
            <div className="phead pink">
              <span className="lead" />
              {t("cal.side.forecast")}
              <span className="section-note">{t("cal.side.estimates")}</span>
            </div>
            <div className="pbody rows">
              {pageRows.length === 0 ? (
                <div className="empty">{t("cal.side.empty")}</div>
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
                          {b.characters.map((c) => studentName(c)).join(", ") || b.code}
                        </span>
                        <span className="sub">
                          {p ? formatDay(p.expectedMs, tz) : ""}
                        </span>
                        {p && <span className="range">{p.method === "scheduled" ? (p.source === "official" ? t("cal.row.official") : t("cal.row.wiki")) : `${p.calibrationSamples ? t("cal.row.range") : t("cal.row.uncalibrated")} · ${formatShort(p.p05Ms, tz)}–${formatShort(p.p95Ms, tz)}`}</span>}
                      </span>
                      <span
                        className={`count ${(p?.confidence ?? 0) >= 0.8 ? "calm" : (p?.confidence ?? 0) >= 0.6 ? "" : "faint"}`}
                        title={p?.method === "scheduled" ? (p.source === "official" ? t("cal.row.title.official") : t("cal.row.title.wiki")) : t("cal.row.title.estimate")}
                        aria-label={p?.confidence != null ? t("cal.row.accuracyAria", { n: Math.round(p.confidence * 100) }) : t("cal.row.noProbabilityAria")}
                      >
                        {p?.method === "scheduled" ? (p.source === "official" ? t("cal.cell.official") : t("cal.cell.wiki")) : p?.confidence != null ? `${Math.round(p.confidence * 100)}%` : "—"}
                        <small className="prob-label">{p?.method === "scheduled" ? (p.source === "official" ? t("cal.cell.confirmed") : t("cal.cell.scheduled")) : t("cal.cell.pm7")}</small>
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
              {t("cal.projections")}
              <span className="section-note">{t("cal.projectionsNote")}</span>
            </summary>
            <div className="pbody rows">
              {(forecast?.projectedBatches ?? []).slice(0, 7).map((p) => (
                <div key={p.index} className="row static">
                  <span className="meta">
                    <span className="name">{t("cal.update", { n: p.step })}</span>
                  </span>
                  <span className="count faint">{formatDay(p.startMs, tz)}</span>
                </div>
              ))}
              {(!forecast || forecast.projectedBatches.length === 0) && (
                <div className="empty">{t("cal.projectionsEmpty")}</div>
              )}
            </div>
          </details>
          {(forecast?.unresolvedBanners.length ?? 0) > 0 && (
            <details className="panel projections">
              <summary className="phead"><span className="lead" />{t("cal.unresolved")}<span className="section-note">{forecast!.unresolvedBanners.length}</span></summary>
              <p className="hint">{t("cal.unresolvedHint")}</p>
              <div className="rows">{forecast!.unresolvedBanners.slice(-30).reverse().map(b => <button key={b.id} className="row" onClick={() => setSelected(b)}><span className="meta"><span className="name">{b.characters.map(c => studentName(c)).join(", ") || b.code}</span><span className="sub">{t("chip.server.jp")} · {formatDay(b.startMs, tz)}</span></span></button>)}</div>
              {forecast!.unresolvedBanners.length > 30 && <p className="hint">{t("cal.unresolvedShowing")}</p>}
            </details>
          )}
        </aside>
      </main>
      <dialog ref={detailDialog} className="detail-sheet" aria-label={t("cal.detailSheetAria")} onCancel={() => setSelected(null)} onClick={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
        <Detail banner={selected} tz={tz} onClose={() => setSelected(null)} />
      </dialog>

      {/* Guide strip: the mascots live here rather than floating over the
          calendar and sidebar, where they used to block content. */}
      <section className="guide">
        <Arona line={aronaLine} />
        <div className="guide-credits">
          <span className="schale-signature"><img src={asset("schale.svg?v=2")} alt="S.C.H.A.L.E. emblem" width="26" height="30" /> S.C.H.A.L.E. / SHITTIM CHEST</span>
          {t("cal.guide.prefix")}{" "}
          <a href="https://bluearchive.wiki/wiki/Banner_List" target="_blank" rel="noreferrer">
            {t("cal.guide.wikiLink")}
          </a>
          {t("cal.guide.middle")}{" "}
          <a href="https://schaledb.com" target="_blank" rel="noreferrer">{t("cal.guide.schaleLink")}</a>{t("cal.guide.suffix")}
          <span className="est-note">
            {t("cal.estNote")}
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
        aria-label={t("cal.prevPage")}
      >
        <IconChevronLeft />
      </button>
      <span className="pinfo">
        {t("cal.page", { index: page + 1, pages })}
      </span>
      <button
        className="pbtn"
        disabled={page >= pages - 1}
        onClick={() => onChange(page + 1)}
        aria-label={t("cal.nextPage")}
      >
        <IconChevronRight />
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
        {banner ? t("cal.detail") : t("cal.select")}
        {banner ? (
          <button className="nav" onClick={onClose} aria-label={t("cal.close")} style={{ marginLeft: "auto" }}>
            <IconClose />
          </button>
        ) : (
          <span className="section-note">{t("cal.details")}</span>
        )}
      </div>
      <div className="pbody">
        {!banner && (
          <div className="hint">
            {t("cal.detailHint")}
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
  const whoName = banner.characters.map((c) => studentName(c)).join(", ") || banner.code;
  const label = bannerTypeLabel(banner.type);

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
              {banner.server === "JP" ? t("cal.tag.jp") : t("cal.tag.global")}
            </span>
            <span className="tag soft">{label}</span>
            {banner.provisional && <span className="tag announced">{t("cal.tag.announced")}</span>}
            {banner.rerun && <span className="tag rerun">{t("cal.tag.rerun")}</span>}
            {banner.limited && <span className="tag limit">{t("cal.tag.limited")}</span>}
            {who && (
              <span className="tag school" title={who.school}>
                <SchoolMark school={who.school} />
                {schoolLabel(who.school)}
              </span>
            )}
          </div>
        </div>
      </div>

      <dl className="detail-grid">
        <dt>{banner.server === "JP" ? t("cal.jpWindow") : t("cal.glWindow")}</dt>
        <dd>
          {formatDay(banner.startMs, tz)}
          <span className="clock">{formatClock(banner.startMs, tz)}</span>
          <span className="arrow">→</span>
          {formatDay(banner.endMs, tz)}
        </dd>

        {banner.confirmedGlStartMs != null && (
          <>
            <dt>{t("cal.arrived")}</dt>
            <dd className="good">{formatDay(banner.confirmedGlStartMs, tz)}</dd>
          </>
        )}

        {p && (
          <>
            <dt>{p.method === "scheduled" ? t("cal.scheduledDt") : t("cal.expectedDt")}</dt>
            <dd className="est">{formatDay(p.expectedMs, tz)}</dd>
            <dt>{p.method === "scheduled" ? (p.source === "official" ? t("cal.dateOfficial") : t("cal.dateWiki")) : p.calibrationSamples ? t("cal.rangeTarget") : t("cal.rangeFallback")}</dt>
            <dd>
              {formatShort(p.p05Ms, tz)} <span className="arrow">→</span>{" "}
              {formatShort(p.p95Ms, tz)}
            </dd>
            <dt>{t("cal.within7")}</dt>
            <dd className="conf">
              <span className="meter">
                <span style={{ width: `${Math.round((p.confidence ?? 0) * 100)}%` }} />
              </span>
              {p.confidence == null ? t("cal.notCalibrated") : t("cal.historically", { n: Math.round(p.confidence * 100) })}
            </dd>
            <dt>{t("cal.evidence")}</dt><dd>{p.calibrationSamples ? t("cal.evidence.updates", { n: p.calibrationSamples }) : p.method === "scheduled" ? (p.source === "official" ? t("cal.evidence.official") : t("cal.evidence.wiki")) : t("cal.evidence.insufficient")}</dd>
          </>
        )}
      </dl>

      {p && <p className="disclaimer">{translateModelString(p.explanation)}{p.method !== "scheduled" && ` ${t("cal.disclaimer.estimate")}`}</p>}
      {banner.provisional && <p className="disclaimer">{t("cal.disclaimer.announced")}</p>}
      {!banner.provisional && !p && banner.forecastStatus === "unresolved" && <p className="disclaimer">{t("cal.disclaimer.unresolved")}</p>}
      {/* Path-based link (not a legacy `#/...` fragment): a fragment-only change
          never triggers a navigation, so the deep-link params were silent.
          Provisional banners have no simulator period, so the link would only
          land on the newest unrelated batch. */}
      {!banner.provisional && (
        <a className="sim-detail-link" href={`${link.simulator}?server=${banner.server}&period=${encodeURIComponent(`${banner.server}:${banner.startMs}`)}&banner=${banner.id}`}>{t("cal.openPeriod")} <IconExternal /></a>
      )}
    </>
  );
}
