import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { api, asset, type Banner, type CharacterRecord, type Server } from "./api";
import { nextUnseenPurple } from "./recruitmentSequence";
import { readSelection, saveSelection } from "./simulatorSelection";
import { IconClose, IconRotate, IconSound, IconStar, Stars } from "./components/icons";
import { query } from "./route";
import { REQUEST_REVEAL_PEAK_MS, useRecruitmentAudio, type RecruitmentPlayback, type RecruitmentSound } from "./recruitmentAudio";
import { CARD_FLIP_MS, CARD_SPREAD_MS, DISPATCH_DEPARTURE_MS, RESULTS_SETTLE_MS, cardImpactMs, portraitEntranceMs } from "./recruitmentTiming";
import { bannerNames, getLanguage, localeFor, studentName, t, translateModelString, useLanguage } from "./i18n";
import { StudentIntroduction } from "./components/StudentIntroduction";
import { ThemeSwitch } from "./components/ThemeSwitch";
import { FullscreenButton } from "./components/Fullscreen";
import { SiteNav } from "./components/SiteNav";
import { PeriodPicker } from "./components/PeriodPicker";
import { LanguageSwitch } from "./components/LanguageSwitch";
import { periodOption } from "./periodPickerOptions";
import {
  activeCharge,
  bannerPoolKind,
  buildRecruitmentPeriods,
  buildRecruitmentPool,
  resolveSparkExchange,
  historicalSystem,
  makeInitialState,
  normalizeRecruitmentCollection,
  recruitmentStudentId,
  PULL_COST,
  RECRUITMENT_REWARDS,
  resolvePulls,
  switchPeriod,
  TEN_PULL_COST,
  type PullResult,
  type PoolGroup,
  type RecruitmentPool,
  type RecruitmentPeriod,
  type SimulatorState,
  type SimulatorSystem,
} from "./gachaRules";

type Mode = "historical" | SimulatorSystem;
type Phase = "idle" | "arriving" | "signing" | "fakeout" | "dispatching" | "envelopes" | "results";
type FakeoutPreview = "blue" | "gold";
const SIMULATOR_STORAGE_VERSION = 4;
const FAKEOUT_CHANCE = 0.1;
const FAKEOUT_REVEAL_DELAY_MS = 160;
const FAKEOUT_REVEAL_MS = 950;
const PORTRAIT_TOUCH_QUERY = "(orientation: portrait) and (hover: none) and (pointer: coarse)";

function rollFakeoutPreview(results: PullResult[]): FakeoutPreview | null {
  if (!results.some((result) => result.rarity === 3) || Math.random() >= FAKEOUT_CHANCE) return null;
  return Math.random() < 0.5 ? "blue" : "gold";
}

export function Simulator() {
  // One subscription at the root: every sub-component below re-renders with it,
  // including open dialogs and the cinematic overlay.
  useLanguage();
  const [initialSelection] = useState(() => readSelection(query()));
  const [server, setServer] = useState<Server>(() => initialSelection.server ?? "GL");
  const [banners, setBanners] = useState<Banner[]>([]);
  const [characters, setCharacters] = useState<CharacterRecord[]>([]);
  const [periodKey, setPeriodKey] = useState(() => initialSelection.period ?? "");
  const [mode, setMode] = useState<Mode>("historical");
  const [state, setState] = useState<SimulatorState | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [results, setResults] = useState<PullResult[]>([]);
  const [recruitmentSource, setRecruitmentSource] = useState<"pyroxene" | "ticket">("pyroxene");
  const [rewards, setRewards] = useState<{ at: number; label: string; ticket?: number }[]>([]);
  const [revealIndex, setRevealIndex] = useState(0);
  const [skipRequested, setSkipRequested] = useState(false);
  const [revealReady, setRevealReady] = useState(false);
  const [preRevealState, setPreRevealState] = useState<SimulatorState | null>(null);
  const [fakeoutPreview, setFakeoutPreview] = useState<FakeoutPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sparkOpen, setSparkOpen] = useState(false);
  const [poolOpen, setPoolOpen] = useState(false);
  const cinematicRef = useRef<HTMLDialogElement>(null);
  const cinematicOpen = phase !== "idle";
  const [portraitBlocked, setPortraitBlocked] = useState(() => window.matchMedia(PORTRAIT_TOUCH_QUERY).matches);
  const { muted, toggle: toggleSound, unlock: unlockSound, play: playSound, stop: stopSound } = useRecruitmentAudio(portraitBlocked);
  const lastSoundScene = useRef("");
  const cueTimeline = useRef({ scene: "", elapsed: 0, played: new Set<string>() });
  const arrivalPlayback = useRef<RecruitmentPlayback | undefined>(undefined);
  const arrivalElapsed = useRef(0);
  const [arrivalPeakMs, setArrivalPeakMs] = useState(REQUEST_REVEAL_PEAK_MS);

  useEffect(() => {
    const scene = `${phase}:${revealIndex}`;
    if (lastSoundScene.current === scene) return;
    lastSoundScene.current = scene;
    if (phase === "idle") stopSound();
    else if (phase === "arriving") {
      arrivalPlayback.current = playSound("UI_Gacha_Normal_02b");
      setArrivalPeakMs(arrivalPlayback.current?.peakMs ?? REQUEST_REVEAL_PEAK_MS);
    }
  }, [phase, revealIndex, results, playSound, stopSound]);

  useEffect(() => {
    if (phase !== "arriving" || portraitBlocked) return;
    let lastTick = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const playback = arrivalPlayback.current;
      const audioElapsed = playback?.elapsedMs();
      // Follow the actual audio clock when available, including browser resume
      // latency. Muting/missing audio falls back to the same visual timeline.
      arrivalElapsed.current = audioElapsed != null ? audioElapsed : arrivalElapsed.current + now - lastTick;
      lastTick = now;
      if (arrivalElapsed.current >= (playback?.peakMs ?? REQUEST_REVEAL_PEAK_MS)) setPhase("signing");
      else frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [phase, portraitBlocked]);

  useEffect(() => {
    const scene = `${phase}:${revealIndex}`;
    if (cueTimeline.current.scene !== scene) cueTimeline.current = { scene, elapsed: 0, played: new Set() };
    if (portraitBlocked) return;
    const timeline = cueTimeline.current;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cues: { at: number; cue: RecruitmentSound; layer?: boolean; volume?: number }[] = [];
    if (phase === "dispatching") cues.push({ at: reducedMotion ? 0 : DISPATCH_DEPARTURE_MS, cue: "UI_Gacha_Normal_04" });
    if (phase === "envelopes" && revealIndex > 0) {
      const result = results[revealIndex - 1];
      if (result) {
        const tier = result.rarity === 3 ? "SSR" : result.rarity === 2 ? "SR" : "R";
        cues.push({ at: reducedMotion ? 0 : cardImpactMs(result.rarity), cue: `UI_Gacha_Result_${tier}` as RecruitmentSound, volume: result.rarity === 1 ? .85 : 1 });
        if (!reducedMotion) cues.push({ at: portraitEntranceMs(result.rarity), cue: `UI_Gacha_Sqr_${tier}` as RecruitmentSound, layer: true, volume: .9 });
      }
    }
    if (phase === "results") cues.push({ at: reducedMotion ? 0 : RESULTS_SETTLE_MS, cue: results.length === 1 ? "UI_Gacha_Result1_01" : "UI_Gacha_Result10_01", volume: .8 });
    if (!cues.length) return;
    let lastTick = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      timeline.elapsed += now - lastTick;
      lastTick = now;
      for (const { at, cue, layer, volume } of cues) {
        if (timeline.elapsed >= at && !timeline.played.has(cue)) {
          timeline.played.add(cue);
          playSound(cue, layer, volume);
        }
      }
      if (timeline.played.size < cues.length) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [phase, revealIndex, results, portraitBlocked, playSound]);

  const periods = useMemo(() => buildRecruitmentPeriods(banners, server), [banners, server]);
  const period = periods.find((candidate) => candidate.key === periodKey) ?? periods[0];
  const historical = period && period.banners[0] ? historicalSystem(period, period.banners.find((banner) => banner.id === state?.bannerId) ?? period.banners[0]) : null;
  const effectiveSystem: SimulatorSystem = mode === "historical" ? (historical?.system ?? "spark") : mode;
  const requestedBannerId = initialSelection.banner;
  const defaultBanner = period?.banners.find((banner) => banner.id === requestedBannerId) ?? period?.banners[0];
  const selectedBanner = period?.banners.find((banner) => banner.id === state?.bannerId) ?? defaultBanner;
  const recruitmentPool = useMemo(() => period ? buildRecruitmentPool(characters, banners, period, selectedBanner?.id) : null, [characters, banners, period, selectedBanner?.id]);
  const pool = recruitmentPool?.students ?? [];

  useEffect(() => {
    const media = window.matchMedia(PORTRAIT_TOUCH_QUERY);
    const update = () => setPortraitBlocked(media.matches);
    media.addEventListener("change", update);
    update();
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!cinematicOpen) return;
    cinematicRef.current?.showModal();
    const previousOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
      window.requestAnimationFrame(() => {
        if (!document.querySelector("dialog:modal")) document.querySelector<HTMLButtonElement>(".sim-game-pulls .sim-primary")?.focus();
      });
    };
  }, [cinematicOpen]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    Promise.all([
      api.banners(0, Date.UTC(2100, 0, 1)),
      api.characters(),
    ]).then(([bannerResponse, characterResponse]) => {
      if (!live) return;
      // Announced-only banners have no resolved student pool, so they cannot
      // back a period (empty roster, no spark exchange). Calendar only.
      setBanners(bannerResponse.banners.filter((banner) => !banner.provisional));
      setCharacters(characterResponse.characters);
      setLoading(false);
    }).catch((e) => {
      if (live) {
        setError(String(e));
        setLoading(false);
      }
    });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!period || state || !selectedBanner || !characters.length) return;
    setPeriodKey(period.key);
    setState(loadSaved(period, selectedBanner.id, effectiveSystem, characters));
  }, [period, state, selectedBanner, effectiveSystem, characters]);

  useEffect(() => {
    if (!state) return;
    try { localStorage.setItem(storageKey(state.system, state.periodKey), JSON.stringify(state)); } catch { /* private browsing */ }
    saveSelection({ server, period: state.periodKey, banner: state.bannerId });
    const url = new URL(window.location.href);
    url.searchParams.set("server", server);
    url.searchParams.set("period", state.periodKey);
    url.searchParams.set("banner", String(state.bannerId));
    window.history.replaceState(null, "", url);
  }, [state, server]);

  useEffect(() => {
    // Warm headshots behind the signing screen so the flip never waits on art.
    for (const result of results) {
      const image = new Image();
      image.src = asset(`img/avatar/${result.student.id}.webp`);
      const portrait = new Image();
      portrait.src = asset(`img/portrait/${result.student.id}.webp`);
    }
  }, [results]);

  useEffect(() => {
    if (phase !== "fakeout") return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => setPhase("dispatching"), reducedMotion ? 0 : FAKEOUT_REVEAL_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== "dispatching" || portraitBlocked) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => setPhase("envelopes"), reducedMotion ? 0 : 1100);
    return () => window.clearTimeout(timer);
  }, [phase, portraitBlocked]);

  useEffect(() => {
    setRevealReady(false);
    if (phase !== "envelopes" || portraitBlocked) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Only the initial spread advances automatically. Every student waits for input.
    const current = results[revealIndex - 1];
    const delay = reducedMotion ? 0 : current ? portraitEntranceMs(current.rarity) + 250 : CARD_SPREAD_MS;
    const timer = window.setTimeout(() => {
      if (revealIndex === 0) setRevealIndex(1);
      else setRevealReady(true);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [phase, revealIndex, results, portraitBlocked]);

  function chooseServer(nextServer: Server) {
    const nextPeriods = buildRecruitmentPeriods(banners, nextServer);
    const next = nextPeriods[0];
    if (!next) return;
    setServer(nextServer);
    setPeriodKey(next.key);
    setState(preserveSession(makeInitialState(next, next.banners[0].id, mode === "historical" ? historicalSystem(next, next.banners[0]).system : mode), state));
    setPhase("idle");
    setResults([]);
    setRewards([]);
    setRevealIndex(0);
    setFakeoutPreview(null);
    setPreRevealState(null);
  }

  function choosePeriod(key: string) {
    const next = periods.find((candidate) => candidate.key === key);
    if (!next || !state) return;
    const nextSystem = mode === "historical" ? historicalSystem(next, next.banners[0]).system : mode;
    setPeriodKey(key);
    setState(switchPeriod(state, next, next.banners[0].id, nextSystem));
    setPhase("idle");
    setResults([]);
    setRewards([]);
    setRevealIndex(0);
    setFakeoutPreview(null);
    setPreRevealState(null);
  }

  function changeMode(nextMode: Mode) {
    if (!period || !selectedBanner) return;
    setMode(nextMode);
    setState(preserveSession(makeInitialState(period, selectedBanner.id, nextMode === "historical" ? historicalSystem(period, selectedBanner).system : nextMode), state));
    setPhase("idle");
    setResults([]);
    setRewards([]);
    setRevealIndex(0);
    setFakeoutPreview(null);
    setPreRevealState(null);
    setError(null);
  }

  function chooseBanner(id: number) {
    if (!period) return;
    const banner = period.banners.find((candidate) => candidate.id === id);
    if (!banner) return;
    const nextSystem = mode === "historical" ? historicalSystem(period, banner).system : mode;
    setState((previous) => {
      if (!previous) return previous;
      const changedRules = previous.system !== nextSystem;
      return changedRules
        ? preserveSession(makeInitialState(period, id, nextSystem), previous)
        : { ...previous, bannerId: id };
    });
  }

  function recruit(count: 1 | 10, requested: "pyroxene" | "ticket" = "pyroxene") {
    if (!state || !period || !selectedBanner || phase === "arriving" || phase === "signing" || phase === "fakeout" || phase === "dispatching" || phase === "envelopes") return;
    // Charge-system tickets are spent automatically: a ten-pull consumes a
    // held ticket instead of Pyroxene, so the cost never rises while tickets
    // last. Ticket pulls earn no Pyroxene-track rewards by design.
    const source = requested === "pyroxene" && count === 10 && state.system === "charge" && state.tickets > 0 ? "ticket" : requested;
    try {
      const outcome = resolvePulls(state, { period, banner: selectedBanner, pool, recruitmentPool: recruitmentPool ?? undefined }, count, source);
      setPreRevealState(state);
      setFakeoutPreview(rollFakeoutPreview(outcome.results));
      setState(outcome.state);
      setResults(outcome.results);
      setRecruitmentSource(source);
      setRewards(outcome.rewards);
      setRevealIndex(0);
      setSkipRequested(false);
      setError(null);
      arrivalElapsed.current = 0;
      arrivalPlayback.current = undefined;
      setArrivalPeakMs(REQUEST_REVEAL_PEAK_MS);
      setPhase("arriving");
    } catch (e) {
      setError(String(e));
    }
  }

  function exchange(studentId: number) {
    if (!state || !period || !selectedBanner || state.points < 200) return;
    const banner = period.banners.find((candidate) => candidate.characters.some((student) => student.id === studentId));
    if (!banner) return;
    try {
      const outcome = resolveSparkExchange(state, { period, banner, pool, recruitmentPool: recruitmentPool ?? undefined }, studentId);
      unlockSound();
      setPreRevealState(state);
      setState(outcome.state);
      setSparkOpen(false);
      setResults(outcome.results);
      setRewards([]);
      setFakeoutPreview(null);
      setSkipRequested(false);
      setRevealReady(false);
      setRevealIndex(1);
      setPhase("envelopes");
      setError(null);
    } catch (e) { setError(String(e)); }
  }

  function reset() {
    if (!period || !selectedBanner) return;
    setState(makeInitialState(period, selectedBanner.id, effectiveSystem));
    setPhase("idle");
    setResults([]);
    setRewards([]);
    setRevealIndex(0);
    setFakeoutPreview(null);
    setPreRevealState(null);
    setError(null);
  }

  function skipAnimation() {
    if (phase === "arriving" || phase === "signing" || phase === "fakeout" || phase === "dispatching" || phase === "envelopes") {
      if (portraitBlocked) return;
      const current = phase === "envelopes" ? results[revealIndex - 1] : undefined;
      if (current?.rarity === 3 && !current.duplicate && !revealReady) return;
      stopSound(65);
      const next = nextUnseenPurple(results, revealIndex);
      setSkipRequested(true);
      setFakeoutPreview(null);
      if (next !== -1) {
        setRevealReady(false);
        setRevealIndex(next + 1);
        setPhase("envelopes");
      } else finishReveal();
    }
  }

  function finishReveal() {
    setPreRevealState(null);
    setFakeoutPreview(null);
    setPhase("results");
  }

  function confirmResults() {
    setResults([]);
    setFakeoutPreview(null);
    setPhase("idle");
    setRevealIndex(0);
  }

  function advanceReveal() {
    if (phase !== "envelopes" || revealIndex === 0 || !revealReady || portraitBlocked) return;
    stopSound(65, true);
    const next = skipRequested ? nextUnseenPurple(results, revealIndex) : revealIndex < results.length ? revealIndex : -1;
    if (next === -1) finishReveal();
    else { setRevealReady(false); setRevealIndex(next + 1); }
  }

  const busy = phase === "arriving" || phase === "signing" || phase === "fakeout" || phase === "dispatching" || phase === "envelopes";
  const charge = state && period ? activeCharge(state, period, selectedBanner) : 0;
  // A Charge ten-pull spends a held ticket before Pyroxene (see recruit).
  const autoTicket = !!state && state.system === "charge" && state.tickets > 0;
  // The simulator has no wall-clock banner session: historical periods may be
  // replayed long after their real expiry date. Keep the expiry timestamp in
  // the state for display/auditing, but allow the simulated ticket to be used.
  const ticketExpired = false;
  const resultRarity = Math.max(1, ...results.map((result) => result.rarity));
  const fakeoutVisible = !!fakeoutPreview && (phase === "arriving" || phase === "signing");
  const stageRarity = fakeoutVisible ? fakeoutPreview === "gold" ? 2 : 1 : resultRarity;
  const fakeoutStageClass = fakeoutPreview && (phase === "arriving" || phase === "signing" || phase === "fakeout" || phase === "dispatching")
    ? `fakeout-preview-${fakeoutPreview}${phase === "fakeout" ? " fakeout-revealing" : phase === "dispatching" ? " fakeout-revealed" : ""}`
    : "";

  return (
    <div className="sim-app" onPointerDownCapture={unlockSound} onKeyDownCapture={unlockSound}>
      <LandscapeGuard />
      <SiteNav active="simulator" />
      <header className="sim-topbar">
        <div className="sim-brand">
          <div className="sim-title-line">
            <img src={asset("ba-icons/schale.png")} alt="" width="38" height="44" />
            <div><h1>{t("sim.title")}</h1><p>{t("sim.subtitle")}</p></div>
          </div>
        </div>
        <div className="sim-top-note"><span>{t("sim.note")}</span><LanguageSwitch /><ThemeSwitch /><button className="sim-sound-toggle sim-secondary" aria-label={muted ? t("sim.soundOn") : t("sim.soundOff")} title={muted ? t("sim.soundOn") : t("sim.soundOff")} aria-pressed={!muted} onClick={toggleSound}><IconSound muted={muted} /></button><FullscreenButton className="sim-sound-toggle sim-secondary" landscape /></div>
      </header>

      {/* Model errors are English strings from gachaRules; translating at render
          time keeps the alert live under a language switch. */}
      {error && <div className="sim-alert" role="alert">{translateModelString(error.replace(/^Error: /, ""))}</div>}
      {loading && <div className="sim-loading">{t("sim.loading")}</div>}
      {!loading && !period && <div className="sim-loading">{t("sim.noPeriods")}</div>}

      {period && selectedBanner && state && (
        <div className="sim-layout">
          <aside className="sim-sidebar">
            <div className="sim-sidebar-head"><span className="sim-kicker">{t("sim.archiveKicker")}</span><strong>{t("sim.choosePeriod")}</strong></div>
            <div className="sim-server-tabs" role="group" aria-label={t("sim.serverAria")}>
              {(["GL", "JP"] as Server[]).map((candidate) => <button disabled={busy} key={candidate} className={server === candidate ? "on" : ""} onClick={() => chooseServer(candidate)}>{candidate === "GL" ? t("sim.server.global") : t("sim.server.japan")}</button>)}
            </div>
            <PeriodPicker disabled={busy} value={period.key} onChange={choosePeriod} options={periods.map(periodOption)} />
            <p className="sim-period-note">{translateModelString(historical?.reason ?? period.systemReason)}</p>
            <div className="sim-info-box"><strong>{t("sim.infoHeading")}</strong><span>{t("sim.infoBody")}</span></div>
          </aside>

          <main className="sim-main">
            {phase === "idle" && <section className="sim-hero">
              <div className="sim-hero-art">{selectedBanner.characters[0] ? <img key={selectedBanner.characters[0].id} className="sim-featured-portrait" src={asset(`img/portrait/${selectedBanner.characters[0].id}.webp`)} alt={studentName(selectedBanner.characters[0])} onLoad={(event) => { const image = event.currentTarget; image.classList.toggle("sim-featured-portrait-wide", image.naturalWidth > image.naturalHeight); }} onError={(event) => { event.currentTarget.style.display = "none"; }} /> : <div className="sim-art-placeholder"><span>SHITTIM CHEST</span></div>}{selectedBanner.imageUrl && <img className="sim-featured-banner" src={asset(selectedBanner.imageUrl)} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} />}</div>
              <div className="sim-hero-copy">
                <div className="sim-period-banners" role="group" aria-label={t("sim.bannersAria")}>
                  {period.banners.map((banner) => <button key={banner.id} aria-pressed={selectedBanner.id === banner.id} aria-label={`${bannerNames(banner, " / ")} · ${banner.rerun ? t("sim.tab.rerun") : t("sim.tab.pickup")}${banner.limited ? t("sim.tab.limitedSuffix") : ""}`} title={`${bannerNames(banner, " / ")} · ${banner.rerun ? t("sim.tab.rerun") : t("sim.tab.pickup")}${banner.limited ? t("sim.tab.limitedSuffix") : ""}`} className={`sim-banner-tab ${selectedBanner.id === banner.id ? "on" : ""}`} onClick={() => chooseBanner(banner.id)}>
                    {banner.imageUrl ? <img className="sim-tab-banner-art" src={asset(banner.imageUrl)} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : banner.characters[0] && <img src={asset(banner.characters[0].avatar)} alt="" />}
                    {!banner.imageUrl && <span><strong>{bannerNames(banner, " / ")}</strong><small>{banner.rerun ? t("sim.tab.rerun") : t("sim.tab.pickup")}{banner.limited ? t("sim.tab.limitedSuffix") : ""}</small></span>}
                  </button>)}
                </div>
                <span className="sim-kicker">{server === "JP" ? t("sim.server.japan") : t("sim.server.global")} · {t("sim.title")}</span>
                <p className="sim-banner-dates">{formatDate(period.startMs)} — {formatDate(period.endMs)}</p>
                <h2>{bannerNames(selectedBanner, " / ")}</h2>
                <strong className="sim-pickup-heading">{selectedBanner.type.includes("Fes") ? t("sim.pickup.fes") : selectedBanner.type === "SelectPickupGacha" ? t("sim.pickup.archive") : selectedBanner.limited ? t("sim.pickup.unique") : t("sim.pickup.regular")}</strong>
                <p className="sim-guarantee">{t("sim.guarantee", { star: "★" })}</p>
                <div className="sim-tags"><span className={`sim-tag ${effectiveSystem === "charge" ? "charge" : "spark"}`}>{mode === "historical" ? t("sim.tag.historical", { system: systemLabel(effectiveSystem) }) : t("sim.tag.whatif", { system: systemLabel(effectiveSystem) })}</span><span className="sim-tag">{effectiveSystem === "charge" ? bannerPoolKind(selectedBanner) === "limited" ? t("sim.chargeTag.limited") : t("sim.mode.charge") : selectedBanner.limited ? t("sim.tag.unique") : t("sim.tag.pickup")}</span></div>
                <div className="sim-buttons sim-game-pulls"><button className="sim-secondary" onClick={() => recruit(1)}><GameIcon name="pyroxene" className="sim-pull-icon" /><span><small><GameIcon name="pyroxene" /> {t("sim.cost.pyroxene", { n: PULL_COST.toLocaleString() })}</small>{t("sim.pull1")}</span></button><button className="sim-primary" onClick={() => recruit(10)}>{autoTicket ? <GameIcon name="recruitment-10" className="sim-pull-icon" /> : <GameIcon name="pyroxene" className="sim-pull-icon" />}<span><small>{autoTicket ? t("sim.cost.tickets", { n: state.tickets }) : <><GameIcon name="pyroxene" /> {t("sim.cost.pyroxene", { n: TEN_PULL_COST.toLocaleString() })}</>}</small>{t("sim.pull10")}</span></button>{effectiveSystem === "charge" && <button className="sim-ticket" disabled={state.tickets < 1 || ticketExpired} onClick={() => recruit(10, "ticket")}><GameIcon name="recruitment-10" />{t("sim.useTicket")} <small>{state.ticketExpiresAt ? t("sim.ticketsExpire", { n: state.tickets, date: formatDate(state.ticketExpiresAt) }) : t("sim.ticketsCount", { n: state.tickets })}</small></button>}</div>
                <Progress state={state} banner={selectedBanner} charge={charge} />
                {effectiveSystem === "spark" && <button className="sim-secondary sim-select-student" onClick={() => setSparkOpen(true)}>{t("sim.selectStudent")}</button>}
                <div className="sim-pool-actions"><button className="sim-secondary sim-pool-button" onClick={() => setPoolOpen(true)}>{t("sim.viewPool")}</button><details className="sim-rate-info"><summary>{t("sim.rateInfo")}</summary><p>{t("sim.rates.line", { star: "★", r1: formatPoolRate(recruitmentPool?.rarityRates["1"] ?? 78.5), r2: formatPoolRate(recruitmentPool?.rarityRates["2"] ?? 18.5), r3: formatPoolRate(recruitmentPool?.rarityRates["3"] ?? 3) })}</p><p>{recruitmentPool?.isFes ? t("sim.rates.fes") : t("sim.rates.regular")} {t("sim.rates.guarantee", { star: "★" })}</p></details></div>
              </div>
            </section>}

            <details className="sim-rules panel-like">
              <summary>{t("sim.settingsSummary")}</summary>
              <div className="sim-section-head"><div><span className="sim-kicker">{t("sim.rulesetsKicker")}</span><h3>{t("sim.rulesetsHeading")}</h3></div><button disabled={busy} className="sim-reset" onClick={reset}>{t("sim.reset")}</button></div>
              <div className="sim-mode-tabs" role="group" aria-label={t("sim.modeAria")}>
                <button disabled={busy} className={mode === "historical" ? "on" : ""} onClick={() => changeMode("historical")}><strong>{t("sim.mode.historical")}</strong><small>{t("sim.mode.historicalNote", { system: systemLabel(historical?.system ?? period.defaultSystem) })}</small></button>
                <button disabled={busy} className={mode === "spark" ? "on" : ""} onClick={() => changeMode("spark")}><strong>{t("sim.mode.spark")}</strong><small>{t("sim.mode.sparkNote")}</small></button>
                <button disabled={busy} className={mode === "charge" ? "on" : ""} onClick={() => changeMode("charge")}><strong>{t("sim.mode.charge")}</strong><small>{t("sim.mode.chargeNote")}</small></button>
              </div>
              <p className="sim-session-stats"><GameIcon name="pyroxene" /> {t("sim.sessionStats", { pyroxene: state.pyroxeneSpent.toLocaleString(), pulls: state.totalPulls, tickets: state.ticketPulls })}</p>
            </details>

            {effectiveSystem === "charge" && <RewardTrack count={state.recruitmentCount} rewards={rewards} />}

            {phase !== "idle" && <dialog ref={cinematicRef} className={`sim-stage panel-like phase-${phase} preview-rarity-${stageRarity} ${fakeoutStageClass}`} aria-label={t("sim.stageAria")} onCancel={(event) => { event.preventDefault(); if (portraitBlocked) return; if (busy) skipAnimation(); else confirmResults(); }}>
              <LandscapeGuard />
              {phase !== "results" && phase !== "envelopes" && <RecruitmentAtmosphere key={phase === "fakeout" ? "fakeout-reveal" : "atmosphere"} arriving={phase === "arriving"} submitted={phase === "dispatching"} />}
              <div className="sim-cinematic-title"><GameIcon name="schale" /><span>{phase === "results" ? t("sim.stage.results") : t("sim.title")}</span></div>
              <div className="sim-stage-controls">
                {busy && <button className="sim-skip" disabled={portraitBlocked || (phase === "envelopes" && results[revealIndex - 1]?.rarity === 3 && !results[revealIndex - 1]?.duplicate && !revealReady)} onClick={skipAnimation}>{t("sim.skip")}</button>}
                <button className="sim-sound-toggle sim-secondary" aria-label={muted ? t("sim.soundOn") : t("sim.soundOff")} title={muted ? t("sim.soundOn") : t("sim.soundOff")} aria-pressed={!muted} onClick={toggleSound}><IconSound muted={muted} /></button>
                <FullscreenButton className="sim-sound-toggle sim-secondary" landscape />
              </div>
              {(phase === "arriving" || phase === "signing" || phase === "fakeout" || phase === "dispatching") && <RecruitmentContract results={results} fakeout={fakeoutPreview} arrivalPeakMs={arrivalPeakMs} arriving={phase === "arriving"} revealing={phase === "fakeout"} submitted={phase === "dispatching"} paused={portraitBlocked} onOpen={() => setPhase(fakeoutPreview ? "fakeout" : "dispatching")} />}
              {phase === "dispatching" && <div className="sim-dispatch" role="status"><div className="dispatch-orbit" aria-hidden="true" /><div className="dispatch-envelope"><div className="dispatch-application" aria-hidden="true"><GameIcon name="schale" /></div>{recruitmentSource === "ticket" && <GameIcon name="recruitment-10" className="dispatch-ticket" />}</div><strong>{t("sim.dispatch.heading")}</strong><small>{t("sim.dispatch.sub")}</small></div>}
              {phase === "envelopes" && <RevealGrid results={results} revealIndex={revealIndex} ready={revealReady} onNext={advanceReveal} />}
              {phase === "results" && <Results results={results} banner={selectedBanner} system={state.system} counterValue={state.system === "spark" ? state.points : charge} ticket={state.system === "charge" && results.length === 10 && state.tickets > 0} onConfirm={confirmResults} onRecruitAgain={() => recruit(results.length === 1 ? 1 : 10)} />}
            </dialog>}

            {sparkOpen && <SparkSelection period={period} points={state.points} onExchange={exchange} onClose={() => setSparkOpen(false)} />}
            {poolOpen && selectedBanner && recruitmentPool && <BannerPoolDialog banner={selectedBanner} period={period} pool={recruitmentPool} onClose={() => setPoolOpen(false)} />}

            <Collection state={preRevealState ?? state} students={ownedStudents(preRevealState ?? state, characters, pool)} />


            <section className="sim-footnote"><span>{t("sim.footnote.pool")}</span><span>{t("sim.footnote.exclusions")}</span><span>{t("sim.footnote.rates", { star: "★", r1: formatPoolRate(recruitmentPool?.rarityRates["1"] ?? 78.5), r2: formatPoolRate(recruitmentPool?.rarityRates["2"] ?? 18.5), r3: formatPoolRate(recruitmentPool?.rarityRates["3"] ?? 3) })}</span><span>{t("sim.footnote.tickets")}</span></section>
          </main>
        </div>
      )}
    </div>
  );
}

function GameIcon({ name, className = "" }: { name: "pyroxene" | "recruitment-1" | "recruitment-10" | "recruitment-points" | "schale"; className?: string }) {
  return <img className={`ba-game-icon ${className}`} src={asset(`ba-icons/${name}.png`)} alt="" aria-hidden="true" />;
}

function RecruitmentAtmosphere({ arriving, submitted }: { arriving: boolean; submitted: boolean }) {
  return <div className={`recruitment-atmosphere ${arriving ? "is-neutral" : "is-revealed"} ${submitted ? "is-authorized" : ""}`} aria-hidden="true">
    <div className="recruitment-color-field" />
    <div className="recruitment-trails">{Array.from({ length: 12 }, (_, index) => <b key={index} style={{ left: `${index * 9 - 8}%`, top: `${(index * 23) % 95}%`, animationDelay: `${-index * .37}s`, animationDuration: `${2.4 + index % 3 * .6}s` }} />)}</div>
    <div className="recruitment-geometry">{Array.from({ length: 7 }, (_, index) => <span key={index} style={{ left: `${8 + index * 14}%`, top: `${12 + index % 3 * 30}%`, animationDelay: `${-index * .6}s` }} />)}</div>
    <div className="recruitment-sparkle-field">{Array.from({ length: 30 }, (_, index) => <i key={index} style={{ left: `${4 + index * 37 % 92}%`, top: `${6 + index * 29 % 88}%`, width: `${6 + index % 4 * 3}px`, animationDelay: `${-index * .23}s`, animationDuration: `${1.7 + index % 5 * .31}s` }} />)}</div>
    <div className="recruitment-purple-diamond" /><div className="recruitment-horizon" /><div className="recruitment-scene-flash" />
  </div>;
}

function LandscapeGuard() {
  useLanguage();
  return <div className="sim-orientation-guard" role="status"><GameIcon name="schale" /><div className="sim-rotate-device" aria-hidden="true"><IconRotate /></div><h2>{t("sim.rotate.heading")}</h2><p>{t("sim.rotate.line1")}<br />{t("sim.rotate.line2")}</p><FullscreenButton className="sim-sound-toggle sim-secondary" landscape /><small>{t("sim.rotate.note")}</small></div>;
}

function SparkSelection({ period, points, onExchange, onClose }: { period: RecruitmentPeriod; points: number; onExchange: (studentId: number) => void; onClose: () => void }) {
  useLanguage();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const students = [...new Map(period.banners.flatMap((banner) => banner.characters).filter((student) => student.availability !== "event").map((student) => [recruitmentStudentId(student.id), { ...student, id: recruitmentStudentId(student.id) }])).values()];
  useEffect(() => {
    dialogRef.current?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);
  return <dialog ref={dialogRef} className="sim-spark-dialog" aria-labelledby="spark-selection-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <LandscapeGuard />
    <header><h2 id="spark-selection-title">{t("sim.selectStudent")}</h2><button className="sim-secondary" aria-label={t("sim.sparkClose")} onClick={onClose}><IconClose /></button></header>
    <p>{t("sim.spark.intro")}</p><div className="sim-spark-balance"><GameIcon name="recruitment-points" /><strong>{t("sim.spark.balance", { n: points.toLocaleString() })}</strong></div>
    <div className="sim-spark-roster">{students.map((student) => <article key={student.id}><img src={asset(`img/avatar/${student.id}.webp`)} alt="" /><strong>{studentName(student)}</strong><span><Stars n={student.starGrade} /></span><button className="sim-primary" disabled={points < 200} onClick={() => onExchange(student.id)}>{t("sim.spark.exchange")}</button></article>)}</div>
    {points < 200 && <small>{t("sim.spark.needMore", { n: 200 - points })}</small>}<button className="sim-secondary" onClick={onClose}>{t("sim.cancel")}</button>
  </dialog>;
}

function BannerPoolDialog({ banner, period, pool, onClose }: { banner: Banner; period: RecruitmentPeriod; pool: RecruitmentPool; onClose: () => void }) {
  useLanguage();
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      window.requestAnimationFrame(() => {
        if (!document.querySelector("dialog:modal")) document.querySelector<HTMLButtonElement>(".sim-pool-button")?.focus();
      });
    };
  }, []);

  const groups: { key: PoolGroup; labelKey: "sim.pool.pickup" | "sim.pool.fes" | "sim.pool.regular"; descriptionKey: "sim.pool.pickupDesc" | "sim.pool.fesDesc" | "sim.pool.regularDesc" }[] = [
    { key: "pickup", labelKey: "sim.pool.pickup", descriptionKey: "sim.pool.pickupDesc" },
    { key: "fes", labelKey: "sim.pool.fes", descriptionKey: "sim.pool.fesDesc" },
    { key: "regular", labelKey: "sim.pool.regular", descriptionKey: "sim.pool.regularDesc" },
  ];
  const title = bannerNames(banner, " / ") || t("sim.pool.fallbackTitle");
  const entriesTotal = pool.entries.reduce((sum, entry) => sum + entry.rate, 0);

  return <dialog ref={dialogRef} className="sim-pool-dialog" aria-labelledby="pool-dialog-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header>
      <div><span className="sim-kicker">{t("sim.pool.kicker", { server: period.server === "JP" ? t("sim.server.japan") : t("sim.server.global"), date: formatDate(period.startMs) })}</span><h2 id="pool-dialog-title">{t("sim.pool.title")}</h2><p>{title}</p></div>
      <button className="sim-secondary" aria-label={t("sim.pool.closeAria")} onClick={onClose}><IconClose /></button>
    </header>
    <div className="sim-pool-summary" aria-label={t("sim.pool.summaryAria")}>
      {(["1", "2", "3"] as const).map((rarity) => <div key={rarity} className={`sim-pool-summary-rarity rarity-${rarity}`}><strong>{rarity}<IconStar /></strong><b>{formatPoolRate(pool.rarityRates[rarity])}%</b><small>{t("sim.pool.totalSuffix")}</small></div>)}
    </div>
    <p className="sim-pool-note">{t("sim.pool.note", { total: formatPoolRate(entriesTotal), star: "★" })}</p>
    <div className="sim-pool-groups">
      {groups.map((group) => {
        const groupEntries = pool.entries.filter((entry) => entry.group === group.key);
        if (!groupEntries.length) return null;
        const groupTotal = groupEntries.reduce((sum, entry) => sum + entry.rate, 0);
        return <section className={`sim-pool-group sim-pool-group-${group.key}`} key={group.key}>
          <header><div><h3>{t(group.labelKey)}</h3><p>{t(group.descriptionKey)}</p></div><strong>{formatPoolRate(groupTotal)}% {t("sim.pool.totalSuffix")}</strong></header>
          {([3, 2, 1] as const).map((rarity) => {
            const entries = groupEntries.filter((entry) => entry.rarity === rarity);
            if (!entries.length) return null;
            return <div className={`sim-pool-rarity rarity-${rarity}`} key={rarity}>
              <h4><Stars n={rarity} /><span>{t("sim.pool.rarityCount", { n: rarity, star: "★" })}</span><small>{entries.length}</small></h4>
              <ul>{entries.map((entry) => <li key={entry.student.id}><img src={asset(`img/avatar/${entry.student.id}.webp`)} alt="" loading="lazy" /><span>{studentName(entry.student)}</span><b>{formatPoolRate(entry.rate)}%</b></li>)}</ul>
            </div>;
          })}
        </section>;
      })}
    </div>
    <p className="sim-pool-source">{t("sim.pool.sourcePrefix")}<a href="https://bluearchive.wiki/wiki/Recruitment_(Gacha)" target="_blank" rel="noreferrer">{t("sim.pool.sourceLink")}</a>{t("sim.pool.sourceSuffix")}</p>
    <button className="sim-secondary sim-pool-close" onClick={onClose}>{t("sim.pool.close")}</button>
  </dialog>;
}

function RecruitmentContract({ results, fakeout, arrivalPeakMs, arriving, revealing, submitted, paused, onOpen }: { results: PullResult[]; fakeout: FakeoutPreview | null; arrivalPeakMs: number; arriving: boolean; revealing: boolean; submitted: boolean; paused: boolean; onOpen: () => void }) {
  const [strokes, setStrokes] = useState<string[]>([]);
  const [pendingOpen, setPendingOpen] = useState(false);
  const signingDelay = useRef(650);
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  useEffect(() => {
    if (!pendingOpen || arriving || revealing || submitted || paused) return;
    const start = performance.now();
    const timer = window.setTimeout(() => { setPendingOpen(false); openRef.current(); }, signingDelay.current);
    return () => {
      window.clearTimeout(timer);
      signingDelay.current = Math.max(0, signingDelay.current - (performance.now() - start));
    };
  }, [pendingOpen, arriving, revealing, submitted, paused]);
  const signButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (!arriving && !revealing && !submitted) signButton.current?.focus(); }, [arriving, revealing, submitted]);
  const maxRarity = Math.max(...results.map((result) => result.rarity));
  const displayRarity = fakeout && !revealing && !submitted ? fakeout === "gold" ? 2 : 1 : maxRarity;
  return <div className={`sim-contract ${arriving ? "is-arriving" : ""} ${revealing ? "is-revealing" : ""} ${submitted ? "is-submitted" : ""}`} style={{ "--request-arrival-duration": `${arrivalPeakMs}ms` } as CSSProperties} aria-busy={arriving || revealing}><div key={revealing ? "fakeout-aura" : "normal-aura"} className={`contract-aura max-rarity-${displayRarity}`} aria-hidden="true">{displayRarity >= 2 && Array.from({ length: displayRarity === 3 ? 8 : 4 }, (_, index) => <i key={index} style={{ animationDelay: `${(revealing ? FAKEOUT_REVEAL_DELAY_MS : 0) + index * 180}ms` }} />)}</div>
    <div key={revealing ? "fakeout-impact" : "normal-impact"} className="contract-impact" aria-hidden="true"><span className="contract-impact-diamond" />{Array.from({ length: 8 }, (_, index) => <b key={index} style={{ "--impact-angle": `${index * 45 + 22.5}deg` } as CSSProperties} />)}</div>
    <div className={`contract-paper max-rarity-${displayRarity}`}>
    <div className="contract-watermark" aria-hidden="true"><GameIcon name="schale" /></div>
    <div className="contract-authorization-seal" aria-hidden="true">S.C.H.A.L.E.<b>AUTHORIZED</b><span>RECRUITMENT REQUEST</span></div>
    <div className="contract-document-head"><GameIcon name="schale" /><span>S.C.H.A.L.E.<small>Federal Investigation Club</small></span><span className="contract-stamp">CONFIDENTIAL</span></div>
    <span className="sim-kicker">{t("sim.contract.kicker")}</span><strong>{t("sim.contract.heading")}</strong>
    <div className="contract-document-lines" aria-hidden="true"><i /><i /><i /></div>
    <div className="contract-request"><span>{t("sim.contract.requested")}</span><b>{results.length.toString().padStart(2, "0")}</b></div>
    <small>{t("sim.contract.prompt")}</small>
    <div className="contract-signature"><span>{t("sim.contract.signature")} <b>{arriving ? t("sim.contract.receiving") : <><Stars n={displayRarity} />{t("sim.contract.highest")}</>}</b></span><svg className="signature-pad" viewBox="0 0 320 100" aria-label={t("sim.contract.padAria")} onPointerDown={(event) => { if (arriving || revealing || submitted || paused || !event.isPrimary) return; setPendingOpen(false); event.currentTarget.setPointerCapture(event.pointerId); const rect = event.currentTarget.getBoundingClientRect(); setStrokes((previous) => [...previous, `M ${(event.clientX - rect.left) * 320 / rect.width} ${(event.clientY - rect.top) * 100 / rect.height}`]); }} onPointerMove={(event) => { if (arriving || revealing || submitted || paused || !event.currentTarget.hasPointerCapture(event.pointerId)) return; const rect = event.currentTarget.getBoundingClientRect(); const point = ` L ${(event.clientX - rect.left) * 320 / rect.width} ${(event.clientY - rect.top) * 100 / rect.height}`; setStrokes((previous) => previous.map((stroke, index) => index === previous.length - 1 ? stroke + point : stroke)); }} onPointerUp={(event) => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; event.currentTarget.releasePointerCapture(event.pointerId); if (arriving || revealing || submitted || paused) return; signingDelay.current = 650; setPendingOpen(true); }} onPointerCancel={() => setPendingOpen(false)}>
      {!strokes.length && <text x="160" y="58" textAnchor="middle">{t("sim.contract.signHere")}</text>}{strokes.map((stroke, index) => <path key={index} d={stroke} />)}
    </svg><button disabled={arriving || revealing || submitted || paused} className="sim-reset" onClick={() => { setPendingOpen(false); setStrokes([]); }}>{t("sim.contract.clear")}</button><small className="signature-hint" aria-live="polite">{pendingOpen ? t("sim.contract.authorizing") : revealing ? t("sim.contract.revealing") : t("sim.contract.signRelease")}</small></div>
    <button ref={signButton} disabled={arriving || revealing || submitted} className="sim-primary" onClick={onOpen}>{arriving ? t("sim.contract.btn.receiving") : revealing ? t("sim.contract.btn.revealing") : submitted ? t("sim.contract.btn.authorized") : t("sim.contract.btn.signOpen")}</button>
  </div></div>;
}

function Progress({ state, banner, charge }: { state: SimulatorState; banner: Banner; charge: number }) {
  if (state.system === "spark") return <section className="sim-progress panel-like"><div className="sim-progress-head"><div><span className="sim-kicker">{t("sim.spark.kicker")}</span><strong><GameIcon name="recruitment-points" /> {t("sim.spark.heading")}</strong></div><b>{state.points.toLocaleString()}</b></div><div className="sim-bar spark-bar"><span style={{ width: `${Math.min(state.points, 200) / 2}%` }} /></div><p>{t("sim.spark.note")}</p></section>;
  return <ChargeProgress banner={banner} charge={charge} />;
}

function ChargeProgress({ banner, charge }: { banner: Banner; charge: number }) {
  const kind = bannerPoolKind(banner) === "limited" ? t("sim.charge.limited") : t("sim.charge.regular");
  return <section className="sim-progress sim-charge-progress" aria-label={t("sim.charge.ariaValue", { kind, n: charge })}>
    <div className="sim-charge-track">
      <strong className="sim-charge-total">{t("sim.charge.total", { n: charge })}</strong>
      <div className="sim-charge-reward at-100"><div className="sim-charge-card random-student"><img src={asset("ba-cards/Gacha-Purple.webp")} alt="" /><b>?</b><small>×1</small></div></div>
      <div className="sim-charge-reward at-200"><div className="sim-charge-card"><img src={asset(`img/avatar/${banner.characters[0]?.id}.webp`)} alt={banner.characters[0] ? studentName(banner.characters[0]) : t("sim.featured")} /><small>×1</small></div></div>
      <div className="sim-charge-meter" role="progressbar" aria-label={t("sim.charge.meterAria")} aria-valuenow={charge} aria-valuemin={0} aria-valuemax={200}><span style={{ width: `${Math.min(charge, 200) / 2}%` }} /></div>
      <span className="sim-charge-marker at-100">100</span><span className="sim-charge-marker at-200">200</span>
    </div>
    <p className="sim-charge-reset">{t("sim.charge.note")}</p>
    <details className="sim-charge-details"><summary aria-label={t("sim.charge.detailsTitle")} title={t("sim.charge.detailsTitle")}><svg viewBox="0 0 24 24" className="icon" aria-hidden="true"><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6" /></svg></summary><p>{t("sim.charge.details", { kind, star: "★" })}</p></details>
  </section>;
}

function RewardTrack({ count, rewards }: { count: number; rewards: { at: number; label: string; ticket?: number }[] }) {
  const ticketCount = rewards.reduce((sum, reward) => sum + (reward.ticket ?? 0), 0);
  return <section className="sim-reward panel-like"><div className="sim-section-head"><div><span className="sim-kicker">{t("sim.rewards.kicker")}</span><h3>{t("sim.rewards.heading")}</h3></div><span className="sim-reward-count">{t("sim.rewards.count", { n: count })}{ticketCount ? (ticketCount === 1 ? t("sim.rewards.withTickets1", { n: ticketCount }) : t("sim.rewards.withTicketsMany", { n: ticketCount })) : ""}</span></div><div className="sim-reward-track">{RECRUITMENT_REWARDS.map((reward) => <div key={reward.at} className={`reward-step ${count >= reward.at ? "done" : ""}`}><span>{reward.at}</span><i />{reward.ticket ? <strong>×10</strong> : <small>{t("sim.rewards.item")}</small>}</div>)}</div><p>{t("sim.rewards.note")}</p></section>;
}

function RevealGrid({ results, revealIndex, ready, onNext }: { results: PullResult[]; revealIndex: number; ready: boolean; onNext: () => void }) {
  const current = results[revealIndex - 1];
  return <div className="sim-reveal sim-animated-reveal"><div className="sim-reveal-heading"><span className="sim-kicker">{t("sim.reveal.kicker")}</span><strong>{t("sim.reveal.opened", { index: revealIndex, total: results.length })}</strong></div><div className="sim-result-grid">{results.map((result, index) => {
    const opened = index < revealIndex;
    return <div className={`reveal-slot rarity-${result.rarity} ${opened ? "is-open" : ""} ${index === revealIndex - 1 ? "is-current" : ""}`} style={{ animationDelay: `${index * 100}ms`, "--envelope-land-delay": `${index * 100 + 296.5}ms`, "--card-flip-duration": `${CARD_FLIP_MS[result.rarity]}ms`, "--card-impact-delay": `${cardImpactMs(result.rarity)}ms` } as CSSProperties} key={`${result.student.id}-${index}`}>
      <div className="reveal-card-turn"><div className="reveal-face reveal-front" aria-hidden={opened}><ResultCard result={result} hidden /></div><div className="reveal-face reveal-back" aria-hidden={!opened}>{opened && <ResultCard result={result} hidden={false} />}</div></div>
      {result.rarity >= 2 && <div className="recruitment-landing" aria-hidden="true"><span className="recruitment-landing-outline" />{result.rarity === 3 && <span className="recruitment-landing-outline is-thick" />}</div>}
    </div>;
  })}</div>{current && <StudentIntroduction result={current} ready={ready} onNext={onNext} key={`introduction-${revealIndex}`} />}<div className="sim-reveal-caption" aria-live="polite">{current ? <span>{studentName(current.student)} · {current.rarity}★ · {current.duplicate ? t("sim.reveal.duplicate") : t("sim.reveal.new")}</span> : <span className="sim-kicker">{t("sim.reveal.opening")}</span>}</div></div>;
}

function Results({ results, banner, system, counterValue, ticket, onConfirm, onRecruitAgain }: { results: PullResult[]; banner: Banner; system: SimulatorSystem; counterValue: number; ticket: boolean; onConfirm: () => void; onRecruitAgain: () => void }) {
  if (!results.length) return <div className="sim-empty-stage"><GameIcon name="schale" /><strong>{t("sim.empty.heading")}</strong><span>{t("sim.empty.sub")}</span></div>;
  return <div className="sim-reveal sim-results-screen">
    <div className="sim-reveal-heading"><span className="sim-kicker">{t("sim.results.kicker")}</span><span className="sim-result-source">{results.length === 1 ? t("sim.results.one", { n: results.length }) : t("sim.results.many", { n: results.length })}</span></div>
    <div className={`sim-result-grid ${results.length === 1 ? "single-result" : ""}`}>{results.map((result, index) => <ResultCard key={`${result.student.id}-${index}`} result={result} hidden={false} index={index + 1} />)}</div>
    <div className="sim-result-actions">
      <div className="sim-result-buttons">
        <button autoFocus className="sim-result-confirm" onClick={onConfirm}><span>{t("sim.confirm")}</span></button>
        {results[0].source !== "points" && <button className="sim-result-again" onClick={onRecruitAgain} aria-label={ticket ? t("sim.againAria.ticket") : t("sim.againAria.pyroxene", { n: (results.length === 1 ? PULL_COST : TEN_PULL_COST).toLocaleString() })}>
          <span>{t("sim.again")} <small>{results.length === 1 ? "×1" : "×10"}</small></span>
          {ticket ? <span className="result-again-cost"><GameIcon name="recruitment-10" />{t("sim.again.ticketCost")}</span> : <span className="result-again-cost"><GameIcon name="pyroxene" />{(results.length === 1 ? PULL_COST : TEN_PULL_COST).toLocaleString()}</span>}
        </button>}
      </div>
      {system === "charge" ? <div className="sim-result-charge"><ChargeProgress banner={banner} charge={counterValue} /></div> : <div className="sim-result-counter" aria-label={t("sim.spark.ariaValue", { n: counterValue })}><GameIcon name="recruitment-points" /><span>{t("sim.spark.heading")}</span><strong>{counterValue.toLocaleString()}</strong></div>}
    </div>
  </div>;
}

function ResultCard({ result, hidden, index }: { result: PullResult; hidden: boolean; index?: number }) {
  if (hidden) return <div className={`result-card sealed rarity-${result.rarity}`}><img className="recruitment-card-front" src={asset(`ba-cards/Gacha-${result.rarity === 3 ? "Purple" : result.rarity === 2 ? "Gold" : "Blue"}.webp`)} alt="" /></div>;
  const status = result.featured ? (result.duplicate ? t("sim.card.status.pickup") : t("sim.card.status.newPickup")) : result.duplicate ? t("sim.card.status.duplicate") : t("sim.card.status.new");
  return <article className={`result-card recruitment-result rarity-${result.rarity} ${result.featured ? "featured" : ""}`} data-index={index?.toString().padStart(2, "0")} aria-label={t("sim.card.aria", { name: studentName(result.student), stars: result.rarity, status })} title={studentName(result.student)}>
    <div className="recruitment-result-inner">
      <div className="result-card-art"><img src={asset(`img/avatar/${result.student.id}.webp`)} alt="" /></div>
      <span className={`result-rarity-strip rarity-${result.rarity}`} aria-hidden="true">{Array.from({ length: result.rarity }, (_, star) => <img key={star} src={asset("ba-cards/Star.webp")} alt="" />)}</span>
    </div>
    {result.featured ? <span className="result-pickup-label">{result.duplicate ? <b>Pick Up!</b> : <>New<br /><b>Pick Up!</b></>}</span> : !result.duplicate && <span className="result-new-label">New</span>}
    <div className="result-info sim-visually-hidden"><b>{studentName(result.student)}</b><span><Stars n={result.rarity} /> {status}</span>{result.forced !== "none" && <small>{result.forced === "hard-pity" ? t("sim.forced.hard") : result.forced === "soft-pity" ? t("sim.forced.soft") : t("sim.forced.ten")}</small>}</div>
  </article>;
}

function Collection({ state, students }: { state: SimulatorState; students: CharacterRecord[] }) {
  const duplicateTotal = Object.values(state.duplicateCounts).reduce((sum, count) => sum + count, 0);
  const groups = ([3, 2, 1] as const).map((rarity) => ({ rarity, students: students.filter((student) => student.starGrade === rarity) })).filter((group) => group.students.length);
  return <section className="sim-collection panel-like">
    <div className="sim-section-head"><div><span className="sim-kicker">{t("sim.collection.kicker")}</span><h3>{t("sim.collection.heading")}</h3></div><span className="sim-reward-count">{t("sim.collection.uniques", { n: students.length })} · {duplicateTotal === 1 ? t("sim.collection.duplicate1", { n: duplicateTotal }) : t("sim.collection.duplicates", { n: duplicateTotal })} · {t("sim.collection.featured", { n: state.featuredHits })}</span></div>
    <RarityDistribution counts={state.rarityCounts} total={rarityTotal(state.rarityCounts)} label={t("sim.distribution.tracked")} />
    {students.length ? <div className="collection-rarity-groups">{groups.map((group) => <section className={`collection-rarity-group rarity-group-${group.rarity}`} key={group.rarity}>
      <div className="collection-rarity-head"><strong><Stars n={group.rarity} />{t("sim.collection.students")}</strong><span>{t("sim.collection.uniques", { n: group.students.length })}</span></div>
      <div className="collection-grid">{group.students.map((student) => <article className="collection-student" key={student.id}>
        <img src={asset(student.avatar)} alt="" /><div><strong>{studentName(student)}</strong><small><Stars n={student.starGrade} />{state.duplicateCounts[student.id] ? ` · ×${state.duplicateCounts[student.id] + 1}` : t("sim.collection.new")}</small></div>
        {student.id === 10143 && <div className="collection-linked-form"><img src={asset("img/avatar/10144.webp")} alt="" /><span>{t("sim.collection.linkedLabel")}<strong>{t("sim.collection.linkedName")}</strong><small>{t("sim.collection.linkedSub")}</small></span></div>}
      </article>)}</div>
    </section>)}</div> : <p className="sim-collection-empty">{t("sim.collection.empty")}</p>}
  </section>;
}

function RarityDistribution({ counts, total, label = t("sim.distribution.default"), compact = false }: { counts: Record<"1" | "2" | "3", number>; total: number; label?: string; compact?: boolean }) {
  return <div className={`rarity-distribution ${compact ? "compact" : ""}`} aria-label={label}><span className="sim-kicker">{label}</span><div className="rarity-bars">{(["1", "2", "3"] as const).map((rarity) => { const count = counts[rarity] ?? 0; const percent = total ? Math.round(count / total * 100) : 0; return <div className={`rarity-bar rarity-${rarity}`} key={rarity}><div className="rarity-bar-label"><b><Stars n={Number(rarity)} /></b><strong>{count}</strong><small>{percent}%</small></div><span><i style={{ width: `${percent}%` }} /></span></div>; })}</div></div>;
}

function rarityTotal(counts: Record<"1" | "2" | "3", number>) {
  return counts["1"] + counts["2"] + counts["3"];
}

function loadSaved(period: RecruitmentPeriod, bannerId: number, system: SimulatorSystem, students: CharacterRecord[]) {
  const initial = makeInitialState(period, bannerId, system);
  try {
    const raw = localStorage.getItem(storageKey(system, period.key));
    if (!raw) return initial;
    const saved = JSON.parse(raw) as Partial<SimulatorState>;
    const savedRarityCounts = { ...initial.rarityCounts, ...(saved.rarityCounts ?? {}) };
    const trackedRarities = rarityTotal(savedRarityCounts);
    const rarityCounts = saved.totalPulls && trackedRarities === 0
      ? migrateRarityCounts(saved, students)
      : savedRarityCounts;
    return normalizeRecruitmentCollection({
      ...initial,
      ...saved,
      periodKey: period.key,
      bannerId,
      system,
      rarityCounts,
      featuredHits: saved.featuredHits ?? 0,
    });
  } catch {
    return initial;
  }
}

function storageKey(system: SimulatorSystem, periodKey: string) {
  return `shittim-simulator:v${SIMULATOR_STORAGE_VERSION}:${system}:${periodKey}`;
}

function migrateRarityCounts(saved: Partial<SimulatorState>, students: CharacterRecord[]) {
  const byId = new Map(students.map((student) => [student.id, student]));
  const counts: Record<"1" | "2" | "3", number> = { "1": 0, "2": 0, "3": 0 };
  for (const rawId of saved.ownedIds ?? []) {
    const id = Number(rawId);
    const student = byId.get(id);
    if (!student || student.starGrade < 1 || student.starGrade > 3) continue;
    const copies = 1 + (saved.duplicateCounts?.[String(id)] ?? 0);
    counts[String(student.starGrade) as "1" | "2" | "3"] += copies;
  }
  return counts;
}

function preserveSession(next: SimulatorState, previous: SimulatorState | null) {
  if (!previous) return next;
  return {
    ...next,
    ownedIds: previous.ownedIds,
    duplicateCounts: previous.duplicateCounts,
    totalPulls: previous.totalPulls,
    pyroxeneSpent: previous.pyroxeneSpent,
    ticketPulls: previous.ticketPulls,
    rarityCounts: previous.rarityCounts,
    featuredHits: previous.featuredHits,
  };
}

function ownedStudents(state: SimulatorState, characters: CharacterRecord[], pool: CharacterRecord[]) {
  const byId = new Map([...characters, ...pool].map((student) => [student.id, student]));
  return state.ownedIds.map((id) => byId.get(id)).filter((student): student is CharacterRecord => !!student);
}

function formatDate(ms: number) {
  return new Intl.DateTimeFormat(localeFor(getLanguage()), { month: "short", day: "numeric", year: "numeric" }).format(ms);
}

function formatPoolRate(rate: number) {
  const digits = rate >= 1 ? 1 : rate >= 0.1 ? 2 : 3;
  return rate.toFixed(digits).replace(/\.0+$|(?<=\.[0-9])0+$/, "");
}

function systemLabel(system: SimulatorSystem) {
  return t(system === "charge" ? "sim.mode.charge" : "sim.mode.spark");
}

