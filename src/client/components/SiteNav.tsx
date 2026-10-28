import { link } from "../route";
import { t, type LangKey } from "../i18n";

export type SiteNavPage = "home" | "calendar" | "simulator" | "about" | "spine";

const pages: [SiteNavPage, string, LangKey][] = [
  ["home", link.home, "nav.home"],
  ["calendar", link.calendar, "nav.calendar"],
  ["simulator", link.simulator, "nav.simulator"],
  ["spine", link.spine, "nav.spine"],
  ["about", link.about, "nav.about"],
];

export function SiteNav({ active }: { active: SiteNavPage }) {
  return <nav className="site-nav" aria-label={t("nav.aria")}>
    {pages.map(([page, href, key]) => <a key={page} className={page === "home" ? "site-nav-home" : undefined} href={href} aria-current={page === active ? "page" : undefined}>{t(key)}</a>)}
  </nav>;
}
