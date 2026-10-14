/**
 * Hash routing for the static site.
 *
 * GitHub Pages serves static files with no rewrite rules, so client-side
 * routes live in the URL hash (`#/calendar`, `#/simulator`, `#/about`)
 * instead of the path. Relative fetches and asset URLs are unaffected by the
 * hash, which keeps the `./` Vite base working from any page.
 */

export type Route = "/" | "/calendar" | "/simulator" | "/about";

export function currentRoute(): Route {
  const hash = window.location.hash.replace(/^#/, "");
  const path = (hash.split("?")[0] || "/").replace(/\/$/, "") || "/";
  if (path === "/about") return "/about";
  if (path === "/simulator") return "/simulator";
  if (path === "/") return "/";
  return "/calendar";
}

/** Query string carried in the hash, e.g. `#/simulator?server=JP&banner=3`. */
export function hashQuery(): URLSearchParams {
  const hash = window.location.hash.replace(/^#/, "");
  const q = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  return new URLSearchParams(q);
}

export const link = {
  home: "#/",
  calendar: "#/calendar",
  simulator: "#/simulator",
  about: "#/about",
};
