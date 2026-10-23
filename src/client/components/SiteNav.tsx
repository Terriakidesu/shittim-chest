import { link } from "../route";

export type SiteNavPage = "home" | "calendar" | "simulator" | "about";

const pages = [
  ["home", link.home, "Lobby"],
  ["calendar", link.calendar, "Calendar"],
  ["simulator", link.simulator, "Simulator"],
  ["about", link.about, "About"],
] as const;

export function SiteNav({ active }: { active: SiteNavPage }) {
  return <nav className="site-nav" aria-label="Primary navigation">
    {pages.map(([page, href, label]) => <a key={page} className={page === "home" ? "site-nav-home" : undefined} href={href} aria-current={page === active ? "page" : undefined}>{label}</a>)}
  </nav>;
}
