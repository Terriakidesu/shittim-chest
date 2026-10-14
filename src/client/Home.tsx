import { useEffect, useState } from "react";
import { ThemeSwitch } from "./components/ThemeSwitch";
import { DecoShapes, IconPlay } from "./components/icons";
import { api, asset } from "./api";
import { link } from "./route";
import "./lobby.css";

const destinations = [
  { href: link.calendar, name: "Calendar", detail: "JP schedules & Global forecasts", image: "calendar", className: "lobby-tile-calendar" },
  { href: link.simulator, name: "Gacha", detail: "Recruitment simulator", image: "gacha", className: "lobby-tile-gacha" },
  { href: link.about, name: "About", detail: "Sources & credits", image: "about", className: "lobby-tile-about" },
] as const;

export function Home() {
  // One random matching scene per page load: daytime with Arona,
  // or nighttime with Plana. Picked once, never re-rolled mid-visit.
  const [variant] = useState<"day" | "night">(() => (Math.random() < 0.5 ? "day" : "night"));
  const isDay = variant === "day";
  // Forecast snapshot date, so the lobby shows the site's last update.
  const [updatedMs, setUpdatedMs] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    api.status().then(
      (s) => { if (live) setUpdatedMs(s.exportedAtMs ?? null); },
      () => { /* keep the generic refresh note */ },
    );
    return () => { live = false; };
  }, []);
  const updatedLabel =
    updatedMs != null
      ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(updatedMs)
      : null;
  // Background via inline style so the URL stays base-relative: an absolute
  // `/ba-lobby/...` reference in CSS would break under a repository subpath.
  const background = asset(isDay ? "ba-lobby/classroom-day.webp" : "ba-lobby/classroom-night.webp");
  return <main className={`lobby lobby-${variant}`} style={{ backgroundImage: `url("${background}")` }}>
    <header className="lobby-topbar">
      <a className="lobby-brand" href={link.home} aria-label="Shittim Chest home"><img src={asset("shittim-chest.svg")} width="34" height="42" alt="" /><h1>Shittim Chest</h1></a>
      <div className="lobby-toolbar"><span className="lobby-project-label">UNOFFICIAL FAN PROJECT</span><ThemeSwitch /><a className="lobby-info" href={link.about} aria-label="About and credits">?</a></div>
    </header>

    <section className="lobby-scene" aria-label="S.C.H.A.L.E. classroom">
      <div className="lobby-characters lobby-single" role="img" aria-label={isDay ? "Arona in the Shittim Chest classroom" : "Plana in the Shittim Chest classroom"}>
        {isDay
          ? <img className="lobby-arona lobby-solo" src={asset("ba-lobby/arona.png")} alt="" width="779" height="1567" fetchPriority="high" decoding="async" />
          : <img className="lobby-plana lobby-solo" src={asset("ba-lobby/plana.png")} alt="" width="821" height="1566" fetchPriority="high" decoding="async" />}
      </div>

      <nav className="lobby-destinations" aria-label="Main navigation">
        {destinations.slice(0, 2).map(item => <a key={item.href} className={`lobby-tile ${item.className}`} href={item.href}>
          <div className="lobby-tile-inner"><img src={asset(`ba-lobby/${item.image}.webp`)} alt="" width="504" height="389" /><div className="lobby-tile-caption"><strong>{item.name}</strong><span>{item.detail}</span></div><span className="lobby-tile-arrow" aria-hidden="true"><IconPlay /></span></div>
        </a>)}
        <div className="lobby-secondary-panel">
          <div className="lobby-panel-decoration" aria-hidden="true"><span /><DecoShapes /></div>
          {destinations.slice(2).map(item => <a key={item.href} className={`lobby-tile ${item.className}`} href={item.href}>
            <div className="lobby-tile-inner"><img src={asset(`ba-lobby/${item.image}.webp`)} alt="" width="504" height="389" /><div className="lobby-tile-caption"><strong>{item.name}</strong><span>{item.detail}</span></div><span className="lobby-tile-arrow" aria-hidden="true"><IconPlay /></span></div>
          </a>)}
          <p className="lobby-disclaimer">Forecasts are estimates.<br />Simulated recruitment uses no real currency.<br />{updatedLabel ? `Forecast data updated ${updatedLabel}.` : "Forecast data refreshes weekly."}</p>
        </div>
      </nav>
    </section>
    <footer className="lobby-footer"><span>Blue Archive fan project · Game assets © their respective rights holders.</span><a href={link.about}>Credits &amp; disclaimer</a></footer>
  </main>;
}
