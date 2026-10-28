/**
 * Path-based routing for the static site.
 *
 * These used to live in the URL hash. That was fine for a single-page app but
 * fatal for sharing: a fragment is never sent to the server, so `/#/calendar`
 * and `/#/simulator` are the same bytes to any crawler or social scraper, and
 * every shared link produced the same preview. Now each route is a real
 * document - index.html, calendar.html, simulator.html, about.html - so the
 * server can return route-specific metadata.
 *
 * Two consequences worth remembering:
 *
 * - Navigation between routes is a real page load, not a client-side swap.
 *   That is the trade for correct link previews. A `pushState` router would
 *   restore SPA smoothness, but then the served HTML is only correct on a cold
 *   load, and preview bots rarely do a cold load of an in-app URL.
 * - Route documents are flat siblings of index.html, never
 *   `calendar/index.html`. A subdirectory would make every relative asset URL
 *   (`./assets/...`, `./data/...`) resolve one level too deep.
 */

export type Route = "/" | "/calendar" | "/simulator" | "/about" | "/spine";

/**
 * Resolve a pathname to a route. Matches on the trailing segment so it works
 * under any subpath and for both the extensionless and `.html` forms, which
 * GitHub Pages serves interchangeably. Anything unrecognised falls back to the
 * lobby; unknown paths are handled separately by public/404.html.
 */
export function routeFromPath(pathname: string): Route {
  const clean = pathname.replace(/\/+$/, "") || "/";
  if (/(^|\/)calendar(\.html)?$/i.test(clean)) return "/calendar";
  if (/(^|\/)simulator(\.html)?$/i.test(clean)) return "/simulator";
  if (/(^|\/)about(\.html)?$/i.test(clean)) return "/about";
  if (/(^|\/)spine(\.html)?$/i.test(clean)) return "/spine";
  return "/";
}

export function currentRoute(): Route {
  return routeFromPath(window.location.pathname);
}

/**
 * Deep-link parameters, e.g. `simulator.html?server=JP&banner=3`. These are
 * read-only: the app never rewrites the query, so a change to it is always a
 * fresh page load and the views below mount naturally.
 */
export function query(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

/**
 * Send a pre-migration hash link to its path equivalent.
 *
 * Links like `.../shittim-chest/#/simulator` were shared while the app routed
 * by fragment, and they are still out in the wild. They now resolve to the
 * lobby, because the path is a perfectly valid `/` and public/404.html never
 * gets a chance to run. Runs before the first paint, so the visitor lands on
 * the page they actually linked to.
 *
 * Crawlers need no help here: they never received the fragment either, which is
 * the entire reason the routes moved in the first place.
 */
export function redirectLegacyHash() {
  const match = /^#\/?(calendar|simulator|about|spine)\b/i.exec(window.location.hash);
  if (!match) return;
  const target = new URL(`./${match[1]}.html`, window.location.href);
  target.hash = "";
  target.search = window.location.search;
  window.location.replace(target.href);
}

/**
 * In-app navigation targets. All relative, so they survive a subpath deploy;
 * they resolve against whatever route document the user is currently on,
 * because every route file is a flat sibling of index.html.
 */
export const link = {
  home: "./",
  calendar: "./calendar.html",
  simulator: "./simulator.html",
  about: "./about.html",
  spine: "./spine.html",
};
