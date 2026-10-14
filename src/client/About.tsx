import { ThemeSwitch } from "./components/ThemeSwitch";
import { IconChevronLeft } from "./components/icons";
import { asset } from "./api";
import { link } from "./route";

const icons = [
  ["Pyroxene", "Currency_Icon_Gem.png"],
  ["Single-recruitment ticket", "Item_Icon_RecruitTicket_Normal_1.png"],
  ["Ten-recruitment ticket", "Item_Icon_RecruitTicket_Normal_10.png"],
  ["Recruitment Points", "Item_Icon_RecruitCoin_0.png"],
  ["S.C.H.A.L.E. emblem", "Schale.png"],
] as const;

const software = [
  ["React & React DOM", "Interface and rendering", "https://react.dev/", "MIT", "https://github.com/facebook/react/blob/main/LICENSE"],
  ["Bun", "Weekly forecast export, package management, and tests", "https://bun.sh/", "MIT (with third-party notices)", "https://github.com/oven-sh/bun/blob/main/LICENSE.md"],
  ["Vite & its React plugin", "Frontend development and production build", "https://vite.dev/", "MIT", "https://github.com/vitejs/vite/blob/main/LICENSE"],
  ["TypeScript", "Type checking", "https://www.typescriptlang.org/", "Apache-2.0", "https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt"],
  ["GitHub Pages & Actions", "Static hosting and the weekly forecast refresh", "https://docs.github.com/en/pages", "Service terms apply", "https://docs.github.com/en/site-policy/github-terms/github-terms-of-service"],
] as const;

export function About() {
  return <main className="about-page">
    <header className="about-header">
      <div><a className="back-link" href={link.calendar}><IconChevronLeft /> Calendar</a><span className="sim-kicker">Shittim Chest</span><h1>About &amp; credits</h1><p>An unofficial Blue Archive calendar, Global arrival forecast, and recruitment simulator.</p></div>
      <ThemeSwitch />
    </header>

    <section className="about-disclaimer" aria-labelledby="about-disclaimer-title">
      <h2 id="about-disclaimer-title">Unofficial fan project</h2>
      <p>This website is not affiliated with, endorsed by, or sponsored by NEXON Games, NEXON, Yostar, or the Blue Archive development and publishing teams. Blue Archive, its characters, names, logos, illustrations, UI assets, and sound effects belong to their respective rights holders.</p>
      <p>Credits acknowledge the original sources; they do not grant permission to reuse or redistribute third-party assets. No ownership of those assets is claimed, and no blanket license for them is granted by this project.</p>
    </section>

    <nav className="about-contents" aria-label="About page sections"><a href="#data-credits">Data</a><a href="#asset-credits">Artwork &amp; audio</a><a href="#project-credits">Project &amp; tools</a><a href="#limitations">Limitations</a><a href="#local-data">Local data</a></nav>

    <section id="data-credits" className="about-section">
      <h2>Data sources &amp; community contributors</h2>
      <dl className="about-credits">
        <div><dt><a href="https://bluearchive.wiki/wiki/Banner_List">Blue Archive Wiki — Japanese banners</a><br /><a href="https://bluearchive.wiki/wiki/Banner_List_(Global)">Blue Archive Wiki — Global banners</a></dt><dd>Banner dates, featured students, banner types, and artwork references, maintained by the wiki’s editors and community. This app parses and normalizes the yearly banner-list pages; forecasts are computed by this project, not supplied by the wiki.</dd></div>
        <div><dt><a href="https://schaledb.com/">SchaleDB</a></dt><dd>Student names and IDs, schools, clubs, rarity and availability metadata, character portraits, and headshots. Thanks to the SchaleDB maintainers and contributors for this community resource.</dd></div>
      </dl>
      <p>Blue Archive Wiki identifies its text license as <a href="https://creativecommons.org/licenses/by-sa/4.0/">Creative Commons Attribution-ShareAlike 4.0 International</a>. Applicable wiki text retains that license; game artwork and other non-text assets have separate rights and source-file notices. See the linked source pages and their revision histories for contributors and original material.</p>
    </section>

    <section id="asset-credits" className="about-section">
      <h2>Artwork, icons &amp; recruitment sound</h2>
      <dl className="about-credits">
        <div><dt>Blue Archive / NEXON Games, NEXON &amp; Yostar</dt><dd>Original game characters, student artwork, banner illustrations, school and S.C.H.A.L.E. emblems, recruitment icons, and game sound effects. Copyright and trademark rights remain with the respective creators and rights holders.</dd></div>
        <div><dt>Portraits &amp; headshots</dt><dd>Original game illustrations sourced through <a href="https://schaledb.com/">SchaleDB</a>. The app locally caches artwork for display; caching does not change its ownership or license.</dd></div>
        <div><dt>Banners, mascots &amp; school emblems</dt><dd>Sourced through <a href="https://bluearchive.wiki/">Blue Archive Wiki</a>, including <a href="https://bluearchive.wiki/wiki/File:Arona.png">Arona</a> and <a href="https://bluearchive.wiki/wiki/File:Plana.png">Plana</a>. Original creators retain their rights; individual wiki file pages provide source and licensing context.</dd></div>
        <div><dt>Static lobby artwork</dt><dd>Arona and Plana are transparent PNG poses rendered offline from the game’s Spine 2D character assets. The classroom/ocean background is also flattened offline, and the navigation uses original game tile artwork. The homepage ships only static images, with no Spine runtime, canvas, or animation loop. See the <a href={asset("ba-lobby/SOURCES.md")}>asset bundle and preparation notes</a>. Original game assets remain the property of their respective rights holders.</dd></div>
        <div><dt>Original game icons</dt><dd><ul>{icons.map(([name, file]) => <li key={file}><a href={`https://bluearchive.wiki/wiki/File:${file}`}>{name}</a></li>)}</ul><a href={asset("ba-icons/SOURCES.md")}>Local icon source notes</a>.</dd></div>
        <div><dt>Authentic recruitment SFX</dt><dd>Ten original gacha clips, extracted read-only from locally installed JP and Global game recruitment bundles and converted to MP3. No game installation files were modified. These are not synthesized effects, story SFX, music, or audio taken from a YouTube recording. See the <a href={asset("ba-sounds/SOURCES.md")}>audio source and cue notes</a> and <a href={asset("ba-sounds/manifest.json")}>per-file provenance and checksum manifest</a>.</dd></div>
        <div><dt>Animation reference — Adelheid GG</dt><dd><a href="https://www.youtube.com/watch?v=6QZgCI4jlSQ">“Blue Archive Summoning Animation”</a> informed the signing, rarity reveal, and envelope-spread timing and visual direction. The video is a reference, not an embedded recording or a shipped audio asset. The recruitment simulator remains a custom 2D approximation; the lobby uses static artwork.</dd></div>
      </dl>
    </section>

    <section id="project-credits" className="about-section">
      <h2>Project &amp; software acknowledgments</h2>
      <p>Shittim Chest is maintained by <a href="https://github.com/Terriakidesu">Terriakidesu</a>. Calendar presentation, forecasting logic, simulator rules, custom controls, and 2D effects are this project’s fan-made implementation. Thank you to community members who maintain the sources and report corrections.</p>
      <p>Arona and Plana’s on-page status messages are fan-written interface text, not official game dialogue or recorded voice lines. School colors and simplified interface marks are presentation choices, not claims of official branding.</p>
      <div className="about-software">{software.map(([name, purpose, url, license, licenseUrl]) => <div key={name}><h3><a href={url}>{name}</a></h3><p>{purpose}</p><a href={licenseUrl}>{license} · upstream license</a></div>)}</div>
      <p>Additional development and asset-preparation tools include <a href="https://www.python.org/">Python</a>, <a href="https://github.com/K0lb3/UnityPy">UnityPy</a>, <a href="https://numpy.org/">NumPy</a>, <a href="https://ffmpeg.org/">FFmpeg</a>, <a href="https://lame.sourceforge.io/">LAME</a>, and <a href="https://playwright.dev/">Playwright</a>. The <a href="https://github.com/EsotericSoftware/spine-runtimes/tree/4.2">Spine 4.2 WebGL runtime</a> was used only during offline image preparation; it is not included in the website. These tools are not the source or owner of the game assets. Dependencies and tools retain their own licenses and third-party notices.</p>
      <p>Companion package notices include <a href="https://github.com/vitejs/vite-plugin-react/blob/main/LICENSE">Vite’s React plugin</a> and <a href="https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/LICENSE">DefinitelyTyped’s React type definitions</a>. The forecast model is shared with the full-stack research project; its Elysia/SQLite server components are not part of this static site.</p>
      <p>Typography uses system fonts such as Segoe UI and Noto Sans JP where available; font files are not bundled by this app.</p>
    </section>

    <section id="limitations" className="about-section">
      <h2>Forecast &amp; simulator disclaimer</h2>
      <ul className="about-limitations">
        <li><strong>Predictions are not announcements.</strong> Global arrival estimates and uncertainty ranges are based on community data and past schedules. They may be wrong, delayed, stale, or changed by the publisher. Historical accuracy does not guarantee future results. Check official in-game notices before making plans or spending money.</li>
        <li><strong>Historical recruitment pools are approximate.</strong> Complete historical rate tables are not available from the sources. Pool eligibility, archive transitions, featured rates, pity rules, and what-if modes are reconstructed models, not authoritative game rules. The simulator is not a replacement for the live banner’s Rate Info.</li>
        <li><strong>No real recruitment or rewards.</strong> Results are generated locally for entertainment. Simulated Pyroxene, tickets, points, students, and rewards have no monetary value and do not transfer to a game account. The simulator neither predicts nor influences actual game pulls.</li>
        <li><strong>No guarantee of accuracy or availability.</strong> Dates, translations, assets, and features can contain mistakes or become unavailable. Dates depend on the selected timezone. This project is provided as-is; credits and source links do not imply endorsement or permission from their owners.</li>
      </ul>
    </section>

    <section id="local-data" className="about-section">
      <h2>Local progress &amp; corrections</h2>
      <p>Simulated collections, session counters, and theme/sound preferences are stored in this browser’s local storage. No game login or account credentials are required. Clearing site data removes that local progress; it is not synced to a Blue Archive account.</p>
      <p>There is no application server: calendar data and artwork are static files, refreshed weekly by automation from the credited sources. The static host may log web requests. Outbound links lead to third-party services with their own policies.</p>
      <p>For factual corrections, missing attribution, or rights-holder concerns, contact the maintainer through <a href="https://github.com/Terriakidesu">their GitHub profile</a> with the affected page or asset and the relevant source. Credit does not replace permission; identified rights concerns should be reviewed and the affected material corrected or removed as appropriate.</p>
    </section>
  </main>;
}
