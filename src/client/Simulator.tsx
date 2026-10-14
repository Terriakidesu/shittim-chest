import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { api, asset, emblemUrl, type Banner, type CharacterRecord, type Server } from "./api";
import { IconChevronLeft, IconChevronRight, IconClose, IconRotate, IconStar, Stars } from "./components/icons";
import { hashQuery, link } from "./route";
import { REQUEST_REVEAL_PEAK_MS, useRecruitmentAudio, type RecruitmentPlayback, type RecruitmentSound } from "./recruitmentAudio";
import { CARD_FLIP_MS, DISPATCH_DEPARTURE_MS, RESULTS_SETTLE_MS, cardImpactMs, portraitEntranceMs } from "./recruitmentTiming";
import { ThemeSwitch } from "./components/ThemeSwitch";
import { FullscreenButton } from "./components/Fullscreen";
import { PeriodPicker } from "./components/PeriodPicker";
import {
  activeCharge,
  bannerPoolKind,
  buildRecruitmentPeriods,
  buildStudentPool,
  exchangeSpark,
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
  type RecruitmentPeriod,
  type SimulatorState,
  type SimulatorSystem,
} from "./gachaRules";

type Mode = "historical" | SimulatorSystem;
type Phase = "idle" | "arriving" | "signing" | "dispatching" | "envelopes" | "results";
const SIMULATOR_STORAGE_VERSION = 4;
const REVEAL_HOLD_MS: Record<1 | 2 | 3, number> = { 1: 1800, 2: 2200, 3: 3000 };
const DUPLICATE_HOLD_MS: Record<1 | 2 | 3, number> = { 1: 820, 2: 1240, 3: 1900 };
const PORTRAIT_TOUCH_QUERY = "(orientation: portrait) and (hover: none) and (pointer: coarse)";

function revealHoldMs(result: PullResult | undefined) {
  return (result?.duplicate ? DUPLICATE_HOLD_MS : REVEAL_HOLD_MS)[result?.rarity ?? 1];
}

export function Simulator() {
  const [server, setServer] = useState<Server>(() => requestedServer());
  const [banners, setBanners] = useState<Banner[]>([]);
  const [characters, setCharacters] = useState<CharacterRecord[]>([]);
  const [periodKey, setPeriodKey] = useState(() => hashQuery().get("period") ?? "");
  const [mode, setMode] = useState<Mode>("historical");
  const [state, setState] = useState<SimulatorState | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [results, setResults] = useState<PullResult[]>([]);
  const [recruitmentSource, setRecruitmentSource] = useState<"pyroxene" | "ticket">("pyroxene");
  const [rewards, setRewards] = useState<{ at: number; label: string; ticket?: number }[]>([]);
  const [revealIndex, setRevealIndex] = useState(0);
  const [preRevealState, setPreRevealState] = useState<SimulatorState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sparkOpen, setSparkOpen] = useState(false);
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
        if (!result.duplicate && !reducedMotion) cues.push({ at: portraitEntranceMs(result.rarity), cue: `UI_Gacha_Sqr_${tier}` as RecruitmentSound, layer: true, volume: .9 });
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
  const requestedBannerId = Number(hashQuery().get("banner"));
  const defaultBanner = period?.banners.find((banner) => banner.id === requestedBannerId) ?? period?.banners[0];
  const selectedBanner = period?.banners.find((banner) => banner.id === state?.bannerId) ?? defaultBanner;
  const pool = useMemo(() => period ? buildStudentPool(characters, banners, period, selectedBanner?.id) : [], [characters, banners, period, selectedBanner?.id]);

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
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
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
      setBanners(bannerResponse.banners);
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
  }, [state]);

  useEffect(() => {
    // Warm headshots behind the signing screen so the flip never waits on art.
    for (const result of results) {
      const image = new Image();
      image.src = asset(`img/avatar/${result.student.id}.webp`);
      if (!result.duplicate) {
        const portrait = new Image();
        portrait.src = asset(`img/portrait/${result.student.id}.webp`);
      }
    }
  }, [results]);

  useEffect(() => {
    if (phase !== "dispatching" || portraitBlocked) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => setPhase("envelopes"), reducedMotion ? 0 : 1100);
    return () => window.clearTimeout(timer);
  }, [phase, portraitBlocked]);

  useEffect(() => {
    if (phase !== "envelopes" || portraitBlocked) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (revealIndex >= results.length) {
      // Keep the last card on stage until its flip/glow has fully finished.
      const timer = window.setTimeout(() => {
        setPreRevealState(null);
        setPhase("results");
      }, reducedMotion ? 0 : revealHoldMs(results[results.length - 1]) + 200);
      return () => window.clearTimeout(timer);
    }
    const previous = results[revealIndex - 1];
    const delay = reducedMotion ? 80 : revealIndex === 0 ? 1100 : revealHoldMs(previous);
    const timer = window.setTimeout(() => setRevealIndex((index) => index + 1), delay);
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

  function recruit(count: 1 | 10, source: "pyroxene" | "ticket" = "pyroxene") {
    if (!state || !period || !selectedBanner || phase === "arriving" || phase === "signing" || phase === "dispatching" || phase === "envelopes") return;
    try {
      const outcome = resolvePulls(state, { period, banner: selectedBanner, pool }, count, source);
      setPreRevealState(state);
      setState(outcome.state);
      setResults(outcome.results);
      setRecruitmentSource(source);
      setRewards(outcome.rewards);
      setRevealIndex(0);
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
    setState(exchangeSpark(state, { period, banner, pool }, studentId));
    setSparkOpen(false);
    setResults([]);
    setRewards([]);
    setError(null);
  }

  function reset() {
    if (!period || !selectedBanner) return;
    setState(makeInitialState(period, selectedBanner.id, effectiveSystem));
    setPhase("idle");
    setResults([]);
    setRewards([]);
    setRevealIndex(0);
    setPreRevealState(null);
    setError(null);
  }

  function skipAnimation() {
    if (phase === "arriving" || phase === "signing" || phase === "dispatching" || phase === "envelopes") {
      stopSound(65);
      setRevealIndex(results.length);
      setPreRevealState(null);
      setPhase("results");
    }
  }

  function confirmResults() {
    setResults([]);
    setPhase("idle");
    setRevealIndex(0);
  }

  function advanceReveal() {
    if (phase !== "envelopes" || revealIndex === 0) return;
    if (revealIndex >= results.length) skipAnimation();
    else { stopSound(65, true); setRevealIndex((index) => index + 1); }
  }

  const busy = phase === "arriving" || phase === "signing" || phase === "dispatching" || phase === "envelopes";
  const charge = state && period ? activeCharge(state, period, selectedBanner) : 0;
  // The simulator has no wall-clock banner session: historical periods may be
  // replayed long after their real expiry date. Keep the expiry timestamp in
  // the state for display/auditing, but allow the simulated ticket to be used.
  const ticketExpired = false;

  return (
    <div className="sim-app" onPointerDownCapture={unlockSound} onKeyDownCapture={unlockSound}>
      <LandscapeGuard />
      <header className="sim-topbar">
        <div className="sim-brand">
          <a className="back-link" href={link.calendar}><IconChevronLeft /> Calendar</a>
          <div className="sim-title-line">
            <img src={asset("ba-icons/schale.png")} alt="" width="38" height="44" />
            <div><h1>Recruitment</h1><p>Historical recruitment simulator</p></div>
          </div>
        </div>
        <div className="sim-top-note"><span>No real currency · results are local</span><a className="about-link" href={link.about}>About &amp; credits</a><ThemeSwitch /><button className="sim-sound-toggle sim-secondary" aria-pressed={!muted} onClick={toggleSound}>{muted ? "Sound: Off" : "Sound: On"}</button><FullscreenButton className="sim-sound-toggle sim-secondary" landscape /></div>
      </header>

      {error && <div className="sim-alert" role="alert">{error.replace(/^Error: /, "")}</div>}
      {loading && <div className="sim-loading">Loading historical recruitment periods…</div>}
      {!loading && !period && <div className="sim-loading">No recruitment periods are available.</div>}

      {period && selectedBanner && state && (
        <div className="sim-layout">
          <aside className="sim-sidebar">
            <div className="sim-sidebar-head"><span className="sim-kicker">Recruitment archive</span><strong>Choose a period</strong></div>
            <div className="sim-server-tabs" role="group" aria-label="Recruitment server">
              {(["GL", "JP"] as Server[]).map((candidate) => <button disabled={busy} key={candidate} className={server === candidate ? "on" : ""} onClick={() => chooseServer(candidate)}>{candidate === "GL" ? "Global" : "Japan"}</button>)}
            </div>
            <PeriodPicker disabled={busy} value={period.key} onChange={choosePeriod} options={periods.map((candidate) => ({ value: candidate.key, dates: periodLabel(candidate), names: [...new Set(candidate.banners.flatMap((banner) => banner.characters.map((student) => student.name)))].join(" / ") || "Unnamed pick-up", detail: `${candidate.banners.length} banner${candidate.banners.length === 1 ? "" : "s"} · ${candidate.server === "GL" ? "Global" : "Japan"}` }))} />
            <p className="sim-period-note">{historical?.reason ?? period.systemReason}</p>
            <div className="sim-info-box"><strong>Same period, separate banners.</strong><span>Changing tabs changes the featured target, not the set of banners that ran together. Shared counters follow the selected ruleset.</span></div>
          </aside>

          <main className="sim-main">
            {phase === "idle" && <section className="sim-hero">
              <div className="sim-hero-art">{selectedBanner.characters[0] ? <img className="sim-featured-portrait" src={asset(`img/portrait/${selectedBanner.characters[0].id}.webp`)} alt={selectedBanner.characters[0].name} onError={(event) => { event.currentTarget.style.display = "none"; }} /> : <div className="sim-art-placeholder"><span>SHITTIM CHEST</span></div>}{selectedBanner.imageUrl && <img className="sim-featured-banner" src={asset(selectedBanner.imageUrl)} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} />}</div>
              <div className="sim-hero-copy">
                <div className="sim-period-banners" role="group" aria-label="Concurrent recruitment banners">
                  {period.banners.map((banner) => <button key={banner.id} aria-pressed={selectedBanner.id === banner.id} aria-label={`${banner.characters.map((student) => student.name).join(" / ") || banner.code} · ${banner.rerun ? "Rerun" : "Pick-up"}${banner.limited ? " · Limited" : ""}`} title={`${banner.characters.map((student) => student.name).join(" / ") || banner.code} · ${banner.rerun ? "Rerun" : "Pick-up"}${banner.limited ? " · Limited" : ""}`} className={`sim-banner-tab ${selectedBanner.id === banner.id ? "on" : ""}`} onClick={() => chooseBanner(banner.id)}>
                    {banner.imageUrl ? <img className="sim-tab-banner-art" src={asset(banner.imageUrl)} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : banner.characters[0] && <img src={asset(banner.characters[0].avatar)} alt="" />}
                    {!banner.imageUrl && <span><strong>{banner.characters.map((student) => student.name).join(" / ") || banner.code}</strong><small>{banner.rerun ? "Rerun" : "Pick-up"}{banner.limited ? " · Limited" : ""}</small></span>}
                  </button>)}
                </div>
                <span className="sim-kicker">{server === "JP" ? "Japan" : "Global"} · Recruitment</span>
                <p className="sim-banner-dates">{formatDate(period.startMs)} — {formatDate(period.endMs)}</p>
                <h2>{selectedBanner.characters.map((student) => student.name).join(" / ") || selectedBanner.code}</h2>
                <strong className="sim-pickup-heading">{selectedBanner.type.includes("Fes") ? "Fest Recruitment" : selectedBanner.type === "SelectPickupGacha" ? "Archive Recruitment" : selectedBanner.limited ? "Unique Pick-Up Recruitment" : "Pick-Up Recruitment"}</strong>
                <p className="sim-guarantee">One 2<IconStar /> or higher student guaranteed in every ten recruitments!</p>
                <div className="sim-tags"><span className={`sim-tag ${effectiveSystem === "charge" ? "charge" : "spark"}`}>{mode === "historical" ? `Historical · ${systemLabel(effectiveSystem)}` : `What-if · ${systemLabel(effectiveSystem)}`}</span><span className="sim-tag">{effectiveSystem === "charge" ? bannerPoolKind(selectedBanner) === "limited" ? "Limited Recruitment Charge" : "Recruitment Charge" : selectedBanner.limited ? "Unique Pick-Up" : "Pick-Up"}</span></div>
                <div className="sim-buttons sim-game-pulls"><button className="sim-secondary" onClick={() => recruit(1)}><GameIcon name="pyroxene" className="sim-pull-icon" /><span><small><GameIcon name="pyroxene" /> {PULL_COST} Pyroxene</small>Recruit ×1</span></button><button className="sim-primary" onClick={() => recruit(10)}><GameIcon name="pyroxene" className="sim-pull-icon" /><span><small><GameIcon name="pyroxene" /> {TEN_PULL_COST.toLocaleString()} Pyroxene</small>Recruit ×10</span></button>{effectiveSystem === "charge" && <button className="sim-ticket" disabled={state.tickets < 1 || ticketExpired} onClick={() => recruit(10, "ticket")}><GameIcon name="recruitment-10" />Use free ×10 <small>{state.tickets} tickets{state.ticketExpiresAt ? ` · expires ${formatDate(state.ticketExpiresAt)}` : ""}</small></button>}</div>
                <Progress state={state} banner={selectedBanner} charge={charge} />
                {effectiveSystem === "spark" && <button className="sim-secondary sim-select-student" onClick={() => setSparkOpen(true)}>Select Student</button>}
                <details className="sim-rate-info"><summary>Rate Info</summary><p>1<IconStar /> {selectedBanner.type.includes("Fes") ? "75.5" : "78.5"}% · 2<IconStar /> 18.5% · 3<IconStar /> {selectedBanner.type.includes("Fes") ? "6" : "3"}%</p><p>Featured 3<IconStar /> rate: 0.7% total. The tenth student in a ten-pull is 2<IconStar /> or higher. Historical pools are approximate.</p></details>
              </div>
            </section>}

            <details className="sim-rules panel-like">
              <summary>Simulator settings &amp; session statistics</summary>
              <div className="sim-section-head"><div><span className="sim-kicker">Ruleset</span><h3>How should this period work?</h3></div><button disabled={busy} className="sim-reset" onClick={reset}>Reset session</button></div>
              <div className="sim-mode-tabs" role="group" aria-label="Simulator ruleset">
                <button disabled={busy} className={mode === "historical" ? "on" : ""} onClick={() => changeMode("historical")}><strong>Historical</strong><small>{systemLabel(historical?.system ?? period.defaultSystem)} for this banner/date</small></button>
                <button disabled={busy} className={mode === "spark" ? "on" : ""} onClick={() => changeMode("spark")}><strong>200-point spark</strong><small>Legacy what-if mode</small></button>
                <button disabled={busy} className={mode === "charge" ? "on" : ""} onClick={() => changeMode("charge")}><strong>Recruitment Charge</strong><small>100 soft · 200 featured guarantee</small></button>
              </div>
              <p className="sim-session-stats"><GameIcon name="pyroxene" /> {state.pyroxeneSpent.toLocaleString()} simulated Pyroxene spent · {state.totalPulls} pulls · {state.ticketPulls} from tickets</p>
            </details>

            {effectiveSystem === "charge" && <RewardTrack count={state.recruitmentCount} rewards={rewards} />}

            {phase !== "idle" && <dialog ref={cinematicRef} className={`sim-stage panel-like phase-${phase} preview-rarity-${Math.max(1, ...results.map((result) => result.rarity))}`} aria-label="Recruitment" onCancel={(event) => { event.preventDefault(); if (portraitBlocked) return; if (busy) skipAnimation(); else confirmResults(); }}>
              <LandscapeGuard />
              {phase !== "results" && <RecruitmentAtmosphere arriving={phase === "arriving"} submitted={phase === "dispatching"} />}
              <div className="sim-cinematic-title"><GameIcon name="schale" /><span>{phase === "results" ? "Recruitment Results" : "Recruitment"}</span></div>
              <button className="sim-sound-toggle sim-secondary" aria-pressed={!muted} onClick={toggleSound}>{muted ? "Sound: Off" : "Sound: On"}</button>
              <FullscreenButton className="sim-sound-toggle sim-secondary" landscape />
              {busy && <button className="sim-skip" onClick={skipAnimation}>Skip animation</button>}
              {(phase === "arriving" || phase === "signing" || phase === "dispatching") && <RecruitmentContract results={results} arrivalPeakMs={arrivalPeakMs} arriving={phase === "arriving"} submitted={phase === "dispatching"} paused={portraitBlocked} onOpen={() => setPhase("dispatching")} />}
              {phase === "dispatching" && <div className="sim-dispatch" role="status"><div className="dispatch-orbit" aria-hidden="true" /><div className="dispatch-envelope"><div className="dispatch-application" aria-hidden="true"><GameIcon name="schale" /></div>{recruitmentSource === "ticket" && <GameIcon name="recruitment-10" className="dispatch-ticket" />}</div><strong>Recruitment authorized</strong><small>Delivering student applications…</small></div>}
              {phase === "envelopes" && <RevealGrid results={results} revealIndex={revealIndex} onNext={advanceReveal} />}
              {phase === "results" && <Results results={results} counterLabel={state.system === "spark" ? "Recruitment Points" : "Recruitment Charge"} counterValue={state.system === "spark" ? state.points : charge} onConfirm={confirmResults} onRecruitAgain={() => recruit(results.length === 1 ? 1 : 10)} />}
            </dialog>}

            {sparkOpen && <SparkSelection period={period} points={state.points} onExchange={exchange} onClose={() => setSparkOpen(false)} />}

            <Collection state={preRevealState ?? state} students={ownedStudents(preRevealState ?? state, characters, pool)} />


            <section className="sim-footnote"><span>Pool is an approximate historical reconstruction from the calendar data.</span><span>Event/welfare students are never recruitable; limited-only students appear only when featured.</span><span>Rates: 1<IconStar /> {selectedBanner.type.includes("Fes") ? "75.5" : "78.5"}% · 2<IconStar /> 18.5% · 3<IconStar /> {selectedBanner.type.includes("Fes") ? "6" : "3"}%.</span><span>Free tickets advance Charge, but do not recursively advance the recruitment-count reward track.</span></section>
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
    <div className="recruitment-horizon" /><div className="recruitment-scene-flash" />
  </div>;
}

function LandscapeGuard() {
  return <div className="sim-orientation-guard" role="status"><GameIcon name="schale" /><div className="sim-rotate-device" aria-hidden="true"><IconRotate /></div><h2>Rotate your device</h2><p>Recruitment is designed for landscape.<br />Turn your phone sideways to continue.</p><FullscreenButton className="sim-sound-toggle sim-secondary" landscape /><small>Your recruitment is paused while in portrait.</small></div>;
}

function SparkSelection({ period, points, onExchange, onClose }: { period: RecruitmentPeriod; points: number; onExchange: (studentId: number) => void; onClose: () => void }) {
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
    <header><h2 id="spark-selection-title">Select Student</h2><button className="sim-secondary" aria-label="Close student selection" onClick={onClose}><IconClose /></button></header>
    <p>Use 200 Recruitment Points to recruit a student featured in this period.</p><div className="sim-spark-balance"><GameIcon name="recruitment-points" /><strong>{points.toLocaleString()} Recruitment Points</strong></div>
    <div className="sim-spark-roster">{students.map((student) => <article key={student.id}><img src={asset(`img/avatar/${student.id}.webp`)} alt="" /><strong>{student.name}</strong><span><Stars n={student.starGrade} /></span><button className="sim-primary" disabled={points < 200} onClick={() => onExchange(student.id)}>Recruit · 200 points</button></article>)}</div>
    {points < 200 && <small>You need {200 - points} more Recruitment Points.</small>}<button className="sim-secondary" onClick={onClose}>Cancel</button>
  </dialog>;
}

function RecruitmentContract({ results, arrivalPeakMs, arriving, submitted, paused, onOpen }: { results: PullResult[]; arrivalPeakMs: number; arriving: boolean; submitted: boolean; paused: boolean; onOpen: () => void }) {
  const [strokes, setStrokes] = useState<string[]>([]);
  const [pendingOpen, setPendingOpen] = useState(false);
  const signingDelay = useRef(650);
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  useEffect(() => {
    if (!pendingOpen || arriving || submitted || paused) return;
    const start = performance.now();
    const timer = window.setTimeout(() => { setPendingOpen(false); openRef.current(); }, signingDelay.current);
    return () => {
      window.clearTimeout(timer);
      signingDelay.current = Math.max(0, signingDelay.current - (performance.now() - start));
    };
  }, [pendingOpen, arriving, submitted, paused]);
  const signButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (!arriving && !submitted) signButton.current?.focus(); }, [arriving, submitted]);
  const maxRarity = Math.max(...results.map((result) => result.rarity));
  return <div className={`sim-contract ${arriving ? "is-arriving" : ""} ${submitted ? "is-submitted" : ""}`} style={{ "--request-arrival-duration": `${arrivalPeakMs}ms` } as CSSProperties} aria-busy={arriving}><div className={`contract-aura max-rarity-${maxRarity}`} aria-hidden="true">{maxRarity >= 2 && Array.from({ length: maxRarity === 3 ? 8 : 4 }, (_, index) => <i key={index} style={{ animationDelay: `${index * 180}ms` }} />)}</div>
    <div className="contract-impact" aria-hidden="true"><span className="contract-impact-diamond" />{Array.from({ length: 8 }, (_, index) => <b key={index} style={{ "--impact-angle": `${index * 45 + 22.5}deg` } as CSSProperties} />)}</div>
    <div className={`contract-paper max-rarity-${maxRarity}`}>
    <div className="contract-watermark" aria-hidden="true"><GameIcon name="schale" /></div>
    <div className="contract-authorization-seal" aria-hidden="true">S.C.H.A.L.E.<b>AUTHORIZED</b><span>RECRUITMENT REQUEST</span></div>
    <div className="contract-document-head"><GameIcon name="schale" /><span>S.C.H.A.L.E.<small>Federal Investigation Club</small></span><span className="contract-stamp">CONFIDENTIAL</span></div>
    <span className="sim-kicker">Student recruitment application</span><strong>Recruitment Request</strong>
    <div className="contract-document-lines" aria-hidden="true"><i /><i /><i /></div>
    <div className="contract-request"><span>Requested students</span><b>{results.length.toString().padStart(2, "0")}</b></div>
    <small>Sensei, please authorize this recruitment.</small>
    <div className="contract-signature"><span>Signature <b>{arriving ? "Receiving…" : <><Stars n={maxRarity} /> · Highest rarity</>}</b></span><svg className="signature-pad" viewBox="0 0 320 100" aria-label="Signature drawing area; release to open after a short delay, or use Sign and open" onPointerDown={(event) => { if (arriving || submitted || paused || !event.isPrimary) return; setPendingOpen(false); event.currentTarget.setPointerCapture(event.pointerId); const rect = event.currentTarget.getBoundingClientRect(); setStrokes((previous) => [...previous, `M ${(event.clientX - rect.left) * 320 / rect.width} ${(event.clientY - rect.top) * 100 / rect.height}`]); }} onPointerMove={(event) => { if (arriving || submitted || paused || !event.currentTarget.hasPointerCapture(event.pointerId)) return; const rect = event.currentTarget.getBoundingClientRect(); const point = ` L ${(event.clientX - rect.left) * 320 / rect.width} ${(event.clientY - rect.top) * 100 / rect.height}`; setStrokes((previous) => previous.map((stroke, index) => index === previous.length - 1 ? stroke + point : stroke)); }} onPointerUp={(event) => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; event.currentTarget.releasePointerCapture(event.pointerId); if (arriving || submitted || paused) return; signingDelay.current = 650; setPendingOpen(true); }} onPointerCancel={() => setPendingOpen(false)}>
      {!strokes.length && <text x="160" y="58" textAnchor="middle">Sign here</text>}{strokes.map((stroke, index) => <path key={index} d={stroke} />)}
    </svg><button disabled={arriving || submitted || paused} className="sim-reset" onClick={() => { setPendingOpen(false); setStrokes([]); }}>Clear signature</button><small className="signature-hint" aria-live="polite">{pendingOpen ? "Authorizing…" : "Sign, then release to authorize"}</small></div>
    <button ref={signButton} disabled={arriving || submitted} className="sim-primary" onClick={onOpen}>{arriving ? "Receiving request…" : submitted ? "Authorized" : "Sign & open"}</button>
  </div></div>;
}

function Progress({ state, banner, charge }: { state: SimulatorState; banner: Banner; charge: number }) {
  if (state.system === "spark") return <section className="sim-progress panel-like"><div className="sim-progress-head"><div><span className="sim-kicker">Legacy protection</span><strong><GameIcon name="recruitment-points" /> Recruitment Points</strong></div><b>{state.points}<small>/ 200</small></b></div><div className="sim-bar spark-bar"><span style={{ width: `${Math.min(state.points, 200) / 2}%` }} /></div><p>At 200 points, choose one featured student. Points are shared by the banners shown in this period.</p></section>;
  const kind = bannerPoolKind(banner) === "limited" ? "Limited" : "Regular";
  return <section className="sim-progress panel-like"><div className="sim-progress-head"><div><span className="sim-kicker">{kind} Recruitment Charge</span><strong>Featured pity progress</strong></div><b>{charge}<small>/ 200</small></b></div><div className="sim-bar charge-bar"><span style={{ width: `${charge / 2}%` }} /><i className="soft-marker">100<br /><small>50% featured</small></i><i className="hard-marker">200<br /><small>guaranteed</small></i></div><p>Charge carries into the next same-type pick-up period. Pulling the selected featured student resets this counter.</p></section>;
}

function RewardTrack({ count, rewards }: { count: number; rewards: { at: number; label: string; ticket?: number }[] }) {
  const ticketCount = rewards.reduce((sum, reward) => sum + (reward.ticket ?? 0), 0);
  return <section className="sim-reward panel-like"><div className="sim-section-head"><div><span className="sim-kicker">New-system bonus</span><h3>Recruitment-count rewards</h3></div><span className="sim-reward-count">{count} pulls{ticketCount ? ` · +${ticketCount} ticket${ticketCount === 1 ? "" : "s"}` : ""}</span></div><div className="sim-reward-track">{RECRUITMENT_REWARDS.map((reward) => <div key={reward.at} className={`reward-step ${count >= reward.at ? "done" : ""}`}><span>{reward.at}</span><i />{reward.ticket ? <strong>×10</strong> : <small>item</small>}</div>)}</div><p>Milestones reset with the recruitment period. Tickets earned at 70, 130, 150, 170, 270, 330, 350 and 370 eligible pulls expire 40 days after the period starts.</p></section>;
}

function StudentIntroduction({ result }: { result: PullResult }) {
  return <div className={`student-introduction rarity-${result.rarity}`} style={{ animationDuration: `${REVEAL_HOLD_MS[result.rarity] - portraitEntranceMs(result.rarity)}ms`, animationDelay: `${portraitEntranceMs(result.rarity)}ms` }} aria-label={`${result.student.name}, ${result.rarity} star`}>
    <div className="student-intro-backdrop" aria-hidden="true" />
    <img className="student-intro-portrait" src={asset(`img/portrait/${result.student.id}.webp`)} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} />
    <div className="student-intro-school">{result.student.school && <>{emblemUrl(result.student.school) && <img src={emblemUrl(result.student.school)!} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} />}<span>{result.student.school}</span></>}</div>
    <div className="student-intro-nameplate"><span className="student-intro-status">New{result.featured ? " · Pick-Up!" : ""}</span><span className="student-intro-stars"><Stars n={result.rarity} /></span><h2>{result.student.name}</h2>{result.student.club && <p>{result.student.club}</p>}</div>
  </div>;
}

function RevealGrid({ results, revealIndex, onNext }: { results: PullResult[]; revealIndex: number; onNext: () => void }) {
  const current = results[revealIndex - 1];
  return <div className="sim-reveal sim-animated-reveal">{current && <div className={`reveal-ambient rarity-${current.rarity}`} key={`ambient-${revealIndex}`} aria-hidden="true" />}<div className="sim-reveal-heading"><span className="sim-kicker">Recruitment in progress</span><strong>{revealIndex} / {results.length} envelopes opened</strong></div><div className="sim-result-grid">{results.map((result, index) => {
    const opened = index < revealIndex;
    return <div className={`reveal-slot rarity-${result.rarity} ${opened ? "is-open" : ""} ${index === revealIndex - 1 ? "is-current" : ""}`} style={{ animationDelay: `${index * 45}ms`, "--envelope-land-delay": `${index * 45 + 450}ms`, "--card-flip-duration": `${CARD_FLIP_MS[result.rarity]}ms`, "--card-impact-delay": `${cardImpactMs(result.rarity)}ms` } as CSSProperties} key={`${result.student.id}-${index}`}>
      <div className="reveal-card-turn"><div className="reveal-face reveal-front" aria-hidden={opened}><ResultCard result={result} hidden /></div><div className="reveal-face reveal-back" aria-hidden={!opened}>{opened && <ResultCard result={result} hidden={false} />}</div></div>
      {opened && <div className="reveal-effects" aria-hidden="true"><div className="reveal-impact" /><div className="reveal-edge-sweep" /><div className="reveal-glint" />{result.rarity >= 2 && <><div className="reveal-ring" /><div className="reveal-sparkles">{Array.from({ length: result.rarity === 3 ? 8 : 4 }, (_, particle) => <i key={particle} />)}</div></>}{result.rarity === 3 && <><div className="reveal-rays" /><div className="reveal-diamond" /></>}</div>}
    </div>;
  })}</div>{current && !current.duplicate && <StudentIntroduction result={current} key={`introduction-${revealIndex}`} />}<div className="sim-reveal-caption" aria-live="polite">{current ? <div className={`reveal-student-caption rarity-${current.rarity}`} key={revealIndex}><span><Stars n={current.rarity} /></span><strong>{current.student.name}</strong><small>{current.featured ? "Pick-up!" : current.duplicate ? "Already recruited" : "New student"}</small></div> : <span className="sim-kicker">Opening recruitment requests…</span>}</div><button className="sim-reveal-next sim-secondary" disabled={!current} onClick={onNext}>{revealIndex === results.length ? "View results" : "Next student"} <IconChevronRight /></button></div>;
}

function Results({ results, counterLabel, counterValue, onConfirm, onRecruitAgain }: { results: PullResult[]; counterLabel: string; counterValue: number; onConfirm: () => void; onRecruitAgain: () => void }) {
  if (!results.length) return <div className="sim-empty-stage"><GameIcon name="schale" /><strong>Ready for recruitment</strong><span>Choose the banner and ruleset, then authorize a pull.</span></div>;
  return <div className="sim-reveal sim-results-screen"><div className="sim-reveal-heading"><span className="sim-kicker">Recruitment complete</span><span className="sim-result-source">{results.length} student{results.length === 1 ? "" : "s"} recruited</span></div><div className={`sim-result-grid ${results.length === 1 ? "single-result" : ""}`}>{results.map((result, index) => <ResultCard key={`${result.student.id}-${index}`} result={result} hidden={false} />)}</div><div className="sim-result-actions"><button autoFocus className="sim-result-confirm" onClick={onConfirm}>Confirm</button><button className="sim-result-again" onClick={onRecruitAgain}><span>Recruit Again <small>{results.length === 1 ? "×1" : "×10"}</small></span><span className="result-again-cost"><GameIcon name="pyroxene" />{(results.length === 1 ? PULL_COST : TEN_PULL_COST).toLocaleString()}</span></button><div className="sim-result-counter" aria-label={`${counterLabel}: ${counterValue} of 200`}>{counterLabel === "Recruitment Points" && <GameIcon name="recruitment-points" />}<span>{counterLabel}</span><strong>{counterValue}<small>/ 200</small></strong></div></div></div>;
}

function ResultCard({ result, hidden }: { result: PullResult; hidden: boolean }) {
  if (hidden) return <div className={`result-card sealed rarity-${result.rarity}`}><div className="result-card-art"><div className="envelope-mark"><GameIcon name="schale" /></div></div><span className="sealed-label">Open</span></div>;
  const status = result.featured ? (result.duplicate ? "Pick-up" : "New Pick-up") : result.duplicate ? "Duplicate" : "New student";
  return <article className={`result-card rarity-${result.rarity} ${result.featured ? "featured" : ""}`} aria-label={`${result.student.name}, ${result.rarity} star, ${status}`} title={result.student.name}><div className="result-card-art"><img src={asset(`img/avatar/${result.student.id}.webp`)} alt="" />{result.featured ? <span className="result-pickup-label">{result.duplicate ? "Pick-up!" : <>New<br /><b>Pick-up!</b></>}</span> : !result.duplicate && <span className="result-new-label">New</span>}<span className={`result-rarity-strip rarity-${result.rarity}`}><Stars n={result.rarity} /></span></div><div className="result-info sim-visually-hidden"><b>{result.student.name}</b><span><Stars n={result.rarity} /> {status}</span>{result.forced !== "none" && <small>{result.forced === "hard-pity" ? "200 Charge guarantee" : result.forced === "soft-pity" ? "100 Charge check" : "10th pull guarantee"}</small>}</div></article>;
}

function Collection({ state, students }: { state: SimulatorState; students: CharacterRecord[] }) {
  const duplicateTotal = Object.values(state.duplicateCounts).reduce((sum, count) => sum + count, 0);
  const groups = ([3, 2, 1] as const).map((rarity) => ({ rarity, students: students.filter((student) => student.starGrade === rarity) })).filter((group) => group.students.length);
  return <section className="sim-collection panel-like">
    <div className="sim-section-head"><div><span className="sim-kicker">Session collection</span><h3>Students obtained</h3></div><span className="sim-reward-count">{students.length} unique · {duplicateTotal} duplicate{duplicateTotal === 1 ? "" : "s"} · {state.featuredHits} featured</span></div>
    <RarityDistribution counts={state.rarityCounts} total={rarityTotal(state.rarityCounts)} label="Tracked rarity distribution" />
    {students.length ? <div className="collection-rarity-groups">{groups.map((group) => <section className={`collection-rarity-group rarity-group-${group.rarity}`} key={group.rarity}>
      <div className="collection-rarity-head"><strong><Stars n={group.rarity} /> Students</strong><span>{group.students.length} unique</span></div>
      <div className="collection-grid">{group.students.map((student) => <article className="collection-student" key={student.id}>
        <img src={asset(student.avatar)} alt="" /><div><strong>{student.name}</strong><small><Stars n={student.starGrade} />{state.duplicateCounts[student.id] ? ` · ×${state.duplicateCounts[student.id] + 1}` : " · New"}</small></div>
        {student.id === 10143 && <div className="collection-linked-form"><img src={asset("img/avatar/10144.webp")} alt="" /><span>Also unlocked<strong>Shunling (Swimsuit)</strong><small>Alternate form · same recruit</small></span></div>}
      </article>)}</div>
    </section>)}</div> : <p className="sim-collection-empty">No students obtained yet. Your collection will appear here after the first reveal.</p>}
  </section>;
}

function RarityDistribution({ counts, total, label = "Rarity distribution", compact = false }: { counts: Record<"1" | "2" | "3", number>; total: number; label?: string; compact?: boolean }) {
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

function periodLabel(period: RecruitmentPeriod) {
  return `${formatDate(period.startMs)} — ${formatDate(period.endMs)}`;
}

function formatDate(ms: number) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(ms);
}

function systemLabel(system: SimulatorSystem) {
  return system === "charge" ? "Recruitment Charge" : "200-point spark";
}

function requestedServer(): Server {
  return hashQuery().get("server") === "JP" ? "JP" : "GL";
}
