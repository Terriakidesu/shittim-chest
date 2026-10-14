import { useState } from "react";
import { ThemeSwitch } from "./components/ThemeSwitch";
import "./lobby.css";

const destinations = [
  { href: "/calendar", name: "Calendar", detail: "JP schedules & Global forecasts", image: "calendar", className: "lobby-tile-calendar" },
  { href: "/simulator", name: "Gacha", detail: "Recruitment simulator", image: "gacha", className: "lobby-tile-gacha" },
  { href: "/about", name: "About", detail: "Sources & credits", image: "about", className: "lobby-tile-about" },
] as const;

export function Home() {
  // One random matching scene per page load: daytime with Arona,
  // or nighttime with Plana. Picked once, never re-rolled mid-visit.
  const [variant] = useState<"day" | "night">(() => (Math.random() < 0.5 ? "day" : "night"));
  const isDay = variant === "day";
  return <main className={`lobby lobby-${variant}`}>
    <header className="lobby-topbar">
      <a className="lobby-brand" href="/" aria-label="Shittim Chest home"><img src="/shittim-chest.svg" width="34" height="42" alt="" /><h1>Shittim Chest</h1></a>
      <div className="lobby-toolbar"><span className="lobby-project-label">UNOFFICIAL FAN PROJECT</span><ThemeSwitch /><a className="lobby-info" href="/about" aria-label="About and credits">?</a></div>
    </header>

    <section className="lobby-scene" aria-label="S.C.H.A.L.E. classroom">
      <div className="lobby-characters lobby-single" role="img" aria-label={isDay ? "Arona in the Shittim Chest classroom" : "Plana in the Shittim Chest classroom"}>
        {isDay
          ? <img className="lobby-arona lobby-solo" src="/ba-lobby/arona.png" alt="" width="779" height="1567" fetchPriority="high" decoding="async" />
          : <img className="lobby-plana lobby-solo" src="/ba-lobby/plana.png" alt="" width="821" height="1566" fetchPriority="high" decoding="async" />}
      </div>

      <nav className="lobby-destinations" aria-label="Main navigation">
        {destinations.slice(0, 2).map(item => <a key={item.href} className={`lobby-tile ${item.className}`} href={item.href}>
          <div className="lobby-tile-inner"><img src={`/ba-lobby/${item.image}.webp`} alt="" width="504" height="389" /><div className="lobby-tile-caption"><strong>{item.name}</strong><span>{item.detail}</span></div><span className="lobby-tile-arrow" aria-hidden="true">▶</span></div>
        </a>)}
        <div className="lobby-secondary-panel">
          <div className="lobby-panel-decoration" aria-hidden="true"><span />△ × + ○</div>
          {destinations.slice(2).map(item => <a key={item.href} className={`lobby-tile ${item.className}`} href={item.href}>
            <div className="lobby-tile-inner"><img src={`/ba-lobby/${item.image}.webp`} alt="" width="504" height="389" /><div className="lobby-tile-caption"><strong>{item.name}</strong><span>{item.detail}</span></div><span className="lobby-tile-arrow" aria-hidden="true">▶</span></div>
          </a>)}
          <p className="lobby-disclaimer">Forecasts are estimates.<br />Simulated recruitment uses no real currency.</p>
        </div>
      </nav>
    </section>
    <footer className="lobby-footer"><span>Blue Archive fan project · Game assets © their respective rights holders.</span><a href="/about">Credits &amp; disclaimer</a></footer>
  </main>;
}
