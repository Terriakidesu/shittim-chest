import { link } from "../route";

export function SiteFooter() {
  return <footer className="site-footer">
    <nav aria-label="Site navigation"><a href={link.home}>Lobby</a><a href={link.calendar}>Calendar</a><a href={link.simulator}>Recruitment simulator</a><a href={link.about}>About, credits &amp; disclaimer</a></nav>
    <p>Unofficial Blue Archive fan project. Game assets belong to their respective rights holders. Forecasts and simulated recruitment are not official game information.</p>
  </footer>;
}
