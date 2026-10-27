import { useEffect, useState, useSyncExternalStore } from "react";
import { ThemeSwitch } from "./components/ThemeSwitch";
import { LanguageSwitch } from "./components/LanguageSwitch";
import { DecoShapes, IconPlay } from "./components/icons";
import { api, asset } from "./api";
import { link } from "./route";
import { getResolvedTheme, subscribeTheme } from "./theme";
import { t, useLanguage, studentName, type LangKey } from "./i18n";
import { currentBannerHeads, forecastNews, latestBannerNews, type BannerHeads, type LobbyNewsItem } from "./lobbyNews";
import { LobbyNews } from "./components/LobbyNews";
import "./lobby.css";

const destinations: { href: string; nameKey: LangKey; detailKey: LangKey; image: string; className: string }[] = [
  { href: link.calendar, nameKey: "lobby.name.calendar", detailKey: "lobby.detail.calendar", image: "calendar", className: "lobby-tile-calendar" },
  { href: link.simulator, nameKey: "lobby.name.gacha", detailKey: "lobby.detail.gacha", image: "gacha", className: "lobby-tile-gacha" },
  { href: link.about, nameKey: "lobby.name.about", detailKey: "lobby.detail.about", image: "about", className: "lobby-tile-about" },
];

export function Home() {
  // Language subscription keeps every label, date and news line current.
  useLanguage();
  // Keep the character random, independent of the selected theme. Changing
  // Light/Dark should change the room without swapping the lobby companion.
  const [variant] = useState<"day" | "night">(() => (Math.random() < 0.5 ? "day" : "night"));
  const isDay = variant === "day";
  const theme = useSyncExternalStore(subscribeTheme, getResolvedTheme, () => "light");
  // Forecast snapshot date, so the lobby shows the site's last update.
  const [updatedMs, setUpdatedMs] = useState<number | null>(null);
  const [news, setNews] = useState<LobbyNewsItem[]>([]);
  const [heads, setHeads] = useState<BannerHeads[]>([]);
  useEffect(() => {
    let live = true;
    api.status().then(
      (s) => { if (live) setUpdatedMs(s.exportedAtMs ?? null); },
      () => { /* keep the generic refresh note */ },
    );
    Promise.all([api.banners(0, Date.UTC(2100, 0, 1)), api.forecast()]).then(
      ([snapshot, forecast]) => {
        if (!live) return;
        const now = Date.now();
        setNews([...latestBannerNews(snapshot.banners, now), ...forecastNews(forecast.banners, now)]);
        setHeads(currentBannerHeads(snapshot.banners, now));
      },
      () => { /* A missing news snapshot must not block the lobby. */ },
    );
    return () => { live = false; };
  }, []);
  // Background via inline style so the URL stays base-relative: an absolute
  // `/ba-lobby/...` reference in CSS would break under a repository subpath.
  const background = asset(theme === "dark" ? "ba-lobby/classroom-night.webp" : "ba-lobby/classroom-day.webp");
  return <main className={`lobby lobby-${variant}`} style={{ backgroundImage: `url("${background}")` }}>
    <header className="lobby-topbar">
      <a className="lobby-brand" href={link.home} aria-label={t("lobby.homeAria")}><img src={asset("shittim-chest.svg")} width="34" height="42" alt="" /><h1>Shittim Chest</h1></a>
      <div className="lobby-toolbar"><LanguageSwitch /><ThemeSwitch /><a className="lobby-info" href={link.about} aria-label={t("lobby.infoAria")}>?</a></div>
    </header>
    <LobbyNews updatedMs={updatedMs} items={news} />

    <section className="lobby-scene" aria-label={t("lobby.sceneAria")}>
      <div className="lobby-characters lobby-single" role="img" aria-label={isDay ? t("lobby.aria.day") : t("lobby.aria.night")}>
        {isDay
          ? <img className="lobby-arona lobby-solo" src={asset("ba-lobby/arona.png")} alt="" width="779" height="1567" fetchPriority="high" decoding="async" />
          : <img className="lobby-plana lobby-solo" src={asset("ba-lobby/plana.png")} alt="" width="821" height="1566" fetchPriority="high" decoding="async" />}
      </div>

      <nav className="lobby-destinations" aria-label={t("lobby.destinationsAria")}>
        {destinations.slice(0, 2).map(item => <a key={item.href} className={`lobby-tile ${item.className}`} href={item.href}>
          <div className="lobby-tile-inner"><img src={asset(`ba-lobby/${item.image}.webp`)} alt="" width="504" height="389" />{item.image === "gacha" && heads.length > 0 && <div className="lobby-banner-heads">{heads.map((group) => <div className={`lobby-head-group heads-${group.server.toLowerCase()}`} key={group.server}><span>{group.server}</span><div>{group.students.map((student) => <img key={student.id} src={asset(student.avatar)} alt={studentName(student)} title={t(group.server === "GL" ? "lobby.headLive.global" : "lobby.headLive.japan", { name: studentName(student) })} width="64" height="64" />)}</div></div>)}</div>}<div className="lobby-tile-caption"><strong>{t(item.nameKey)}</strong><span>{t(item.detailKey)}</span></div><span className="lobby-tile-arrow" aria-hidden="true"><IconPlay /></span></div>
        </a>)}
        <div className="lobby-secondary-panel">
          <div className="lobby-panel-decoration" aria-hidden="true"><span /><DecoShapes /></div>
          {destinations.slice(2).map(item => <a key={item.href} className={`lobby-tile ${item.className}`} href={item.href}>
            <div className="lobby-tile-inner"><img src={asset(`ba-lobby/${item.image}.webp`)} alt="" width="504" height="389" /><div className="lobby-tile-caption"><strong>{t(item.nameKey)}</strong><span>{t(item.detailKey)}</span></div><span className="lobby-tile-arrow" aria-hidden="true"><IconPlay /></span></div>
          </a>)}
        </div>
      </nav>
    </section>
    <footer className="lobby-footer"><span>{t("footer.disclaimer")}</span><a href={link.about}>{t("lobby.footer.credits")}</a></footer>
  </main>;
}
