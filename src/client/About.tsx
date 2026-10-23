import { ThemeSwitch } from "./components/ThemeSwitch";
import { IconChevronLeft } from "./components/icons";
import { asset } from "./api";
import { link } from "./route";
import { t, useLanguage, type LangKey } from "./i18n";
import { LanguageSwitch } from "./components/LanguageSwitch";
import { SiteNav } from "./components/SiteNav";

const icons: [LangKey, string][] = [
  ["about.icon.pyroxene", "Currency_Icon_Gem.png"],
  ["about.icon.ticket1", "Item_Icon_RecruitTicket_Normal_1.png"],
  ["about.icon.ticket10", "Item_Icon_RecruitTicket_Normal_10.png"],
  ["about.icon.points", "Item_Icon_RecruitCoin_0.png"],
  ["about.icon.emblem", "Schale.png"],
];

/** Software names and license identifiers stay untranslated; only the purpose
    sentence localizes (`about.soft.purpose.*`). */
const software: [string, LangKey, string, string, string][] = [
  ["React & React DOM", "about.soft.purpose.react", "https://react.dev/", "MIT", "https://github.com/facebook/react/blob/main/LICENSE"],
  ["Bun", "about.soft.purpose.bun", "https://bun.sh/", "MIT (with third-party notices)", "https://github.com/oven-sh/bun/blob/main/LICENSE.md"],
  ["Vite & its React plugin", "about.soft.purpose.vite", "https://vite.dev/", "MIT", "https://github.com/vitejs/vite/blob/main/LICENSE"],
  ["TypeScript", "about.soft.purpose.ts", "https://www.typescriptlang.org/", "Apache-2.0", "https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt"],
  ["GitHub Pages & Actions", "about.soft.purpose.gh", "https://docs.github.com/en/pages", "Service terms apply", "https://docs.github.com/en/site-policy/github-terms/github-terms-of-service"],
];

export function About() {
  useLanguage();
  return <main className="about-page">
    <SiteNav active="about" />
    <header className="about-header">
      <div><a className="back-link" href={link.calendar}><IconChevronLeft /> {t("nav.calendar")}</a><span className="sim-kicker">Shittim Chest</span><h1>{t("about.title")}</h1><p>{t("about.sub")}</p></div>
      <div className="about-header-tools"><LanguageSwitch /><ThemeSwitch /></div>
    </header>

    <section className="about-disclaimer" aria-labelledby="about-disclaimer-title">
      <h2 id="about-disclaimer-title">{t("about.disclaimer.heading")}</h2>
      <p>{t("about.disclaimer.p1")}</p>
      <p>{t("about.disclaimer.p2")}</p>
    </section>

    <nav className="about-contents" aria-label={t("about.nav.aria")}><a href="#data-credits">{t("about.nav.data")}</a><a href="#asset-credits">{t("about.nav.assets")}</a><a href="#project-credits">{t("about.nav.project")}</a><a href="#limitations">{t("about.nav.limits")}</a><a href="#local-data">{t("about.nav.local")}</a></nav>

    <section id="data-credits" className="about-section">
      <h2>{t("about.data.heading")}</h2>
      <dl className="about-credits">
        <div><dt><a href="https://bluearchive.wiki/wiki/Banner_List">{t("about.data.wiki.dt1")}</a><br /><a href="https://bluearchive.wiki/wiki/Banner_List_(Global)">{t("about.data.wiki.dt2")}</a></dt><dd>{t("about.data.wiki.dd")}</dd></div>
        <div><dt><a href="https://bluearchive.wiki/wiki/Category:Characters">{t("about.data.clubs.dt")}</a></dt><dd>{t("about.data.clubs.dd1")}<code>Club</code>{t("about.data.clubs.dd2")}<code>Kohshinjo68</code>{t("about.data.clubs.dd3")}</dd></div>
        <div><dt><a href="https://schaledb.com/">{t("about.data.schale.dt")}</a></dt><dd>{t("about.data.schale.dd")}</dd></div>
      </dl>
      <p>{t("about.data.license.p1")}<a href="https://creativecommons.org/licenses/by-sa/4.0/">{t("about.data.license.link")}</a>{t("about.data.license.p2")}</p>
      <p>{t("about.data.mit.p1")}<code>LICENSE</code>{t("about.data.mit.p2")}</p>
    </section>

    <section id="asset-credits" className="about-section">
      <h2>{t("about.assets.heading")}</h2>
      <dl className="about-credits">
        <div><dt>{t("about.assets.nexon.dt")}</dt><dd>{t("about.assets.nexon.dd")}</dd></div>
        <div><dt>{t("about.assets.portraits.dt")}</dt><dd>{t("about.assets.portraits.dd1")}<a href="https://schaledb.com/">SchaleDB</a>{t("about.assets.portraits.dd2")}</dd></div>
        <div><dt>{t("about.assets.banners.dt")}</dt><dd>{t("about.assets.banners.dd1")}<a href="https://bluearchive.wiki/">Blue Archive Wiki</a>{t("about.assets.banners.dd2")}<a href="https://bluearchive.wiki/wiki/File:Arona.png">{t("about.assets.banners.linkArona")}</a>{t("about.assets.banners.middle")}<a href="https://bluearchive.wiki/wiki/File:Plana.png">{t("about.assets.banners.linkPlana")}</a>{t("about.assets.banners.dd3")}</dd></div>
        <div><dt>{t("about.assets.lobby.dt")}</dt><dd>{t("about.assets.lobby.dd1")}<a href={asset("ba-lobby/SOURCES.md")}>{t("about.assets.lobby.link")}</a>{t("about.assets.lobby.dd2")}</dd></div>
        <div><dt>{t("about.assets.icons.dt")}</dt><dd><ul>{icons.map(([nameKey, file]) => <li key={file}><a href={`https://bluearchive.wiki/wiki/File:${file}`}>{t(nameKey)}</a></li>)}</ul><a href={asset("ba-icons/SOURCES.md")}>{t("about.assets.icons.note")}</a>{t("about.assets.icons.tail")}</dd></div>
        <div><dt>{t("about.assets.sfx.dt")}</dt><dd>{t("about.assets.sfx.dd1")}<a href={asset("ba-sounds/SOURCES.md")}>{t("about.assets.sfx.link1")}</a>{t("about.assets.sfx.middle")}<a href={asset("ba-sounds/manifest.json")}>{t("about.assets.sfx.link2")}</a>{t("about.assets.sfx.dd2")}</dd></div>
        <div><dt>{t("about.assets.cards.dt")}</dt><dd>{t("about.assets.cards.dd1")}<a href={asset("ba-cards/SOURCES.md")}>{t("about.assets.cards.link1")}</a>{t("about.assets.cards.middle")}<a href={asset("ba-cards/ASSET-LICENSE.md")}>{t("about.assets.cards.link2")}</a>{t("about.assets.cards.dd2")}</dd></div>
        <div><dt>{t("about.assets.profiles.dt")}</dt><dd>{t("about.assets.profiles.dd")}</dd></div>
        <div><dt>{t("about.assets.animation.dt")}</dt><dd><a href="https://www.youtube.com/watch?v=6QZgCI4jlSQ">{t("about.assets.animation.link")}</a>{t("about.assets.animation.dd")}</dd></div>
      </dl>
    </section>

    <section id="project-credits" className="about-section">
      <h2>{t("about.project.heading")}</h2>
      <p>{t("about.project.p1")}<a href="https://github.com/Terriakidesu">{t("about.project.maintainer")}</a>{t("about.project.p2")}</p>
      <p>{t("about.project.p3")}</p>
      <div className="about-software">{software.map(([name, purposeKey, url, license, licenseUrl]) => <div key={name}><h3><a href={url}>{name}</a></h3><p>{t(purposeKey)}</p><a href={licenseUrl}>{license}{t("about.soft.upstream")}</a></div>)}</div>
      <p>{t("about.project.tools.p1")}<a href="https://www.python.org/">Python</a>, <a href="https://github.com/K0lb3/UnityPy">UnityPy</a>, <a href="https://numpy.org/">NumPy</a>, <a href="https://ffmpeg.org/">FFmpeg</a>, <a href="https://lame.sourceforge.io/">LAME</a>, and <a href="https://playwright.dev/">Playwright</a>{t("about.project.tools.p2")}<a href="https://github.com/EsotericSoftware/spine-runtimes/tree/4.2">{t("about.project.tools.linkSpine")}</a>{t("about.project.tools.p3")}</p>
      <p>{t("about.project.notices.p1")}<a href="https://github.com/vitejs/vite-plugin-react/blob/main/LICENSE">{t("about.project.notices.linkVite")}</a>{t("about.project.notices.middle")}<a href="https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/LICENSE">{t("about.project.notices.linkTypes")}</a>{t("about.project.notices.p2")}</p>
      <p>{t("about.project.typography")}</p>
    </section>

    <section id="limitations" className="about-section">
      <h2>{t("about.limits.heading")}</h2>
      <ul className="about-limitations">
        <li><strong>{t("about.limits.p1.h")}</strong>{t("about.limits.p1.b")}</li>
        <li><strong>{t("about.limits.p2.h")}</strong>{t("about.limits.p2.b")}</li>
        <li><strong>{t("about.limits.p3.h")}</strong>{t("about.limits.p3.b")}</li>
        <li><strong>{t("about.limits.p4.h")}</strong>{t("about.limits.p4.b")}</li>
      </ul>
    </section>

    <section id="local-data" className="about-section">
      <h2>{t("about.local.heading")}</h2>
      <p>{t("about.local.p1")}</p>
      <p>{t("about.local.p2")}</p>
      <p>{t("about.local.p3.h")}<a href="https://github.com/Terriakidesu">{t("about.local.p3.link")}</a>{t("about.local.p3.b")}</p>
    </section>
  </main>;
}
