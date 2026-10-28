/**
 * Per-route document metadata.
 *
 * Two things have to be kept in step, because the site routes by URL fragment
 * and fragments are never sent to the server:
 *
 * 1. The static shims in `public/*.html` (`calendar.html`, `simulator.html`,
 *    `about.html`) carry the metadata a crawler actually reads. Social scrapers
 *    and search engines fetch raw HTML and never execute JavaScript, so
 *    client-side updates alone are invisible to them. Each shim forwards to the
 *    matching hash route, which is why those `.html` paths are the shareable
 *    ones.
 * 2. This module keeps the live document's metadata correct while the user
 *    navigates in-app, so the tab title, a copied address, and the static shims
 *    all describe the same route.
 *
 * `og:image` must be an absolute URL, so it is resolved against the page's own
 * location at runtime. The static shims cannot do that and hardcode the origin
 * instead - update those literals if the site ever moves to another domain.
 */

import { asset } from "./api";
import { getLanguage, message, type LangKey } from "./i18n";
import type { Route } from "./route";

export interface RouteMeta {
  title: string;
  description: string;
  /** Crawler-visible document for this route; also the canonical URL. */
  share: string;
  /** Social card image, relative to the site root. */
  image: string;
  imageAlt: string;
}

export const ROUTE_META: Record<Route, RouteMeta> = {
  "/": {
    title: "Shittim Chest — Blue Archive Gacha Calendar",
    description:
      "Blue Archive gacha banner calendar: what is live now on JP and Global, and when Global is expected to catch up.",
    share: "./",
    image: "og/home.png",
    imageAlt: "Shittim Chest — the Blue Archive gacha calendar",
  },
  "/calendar": {
    title: "Gacha Calendar — Shittim Chest",
    description:
      "Every JP and Global gacha banner on one calendar: what is live now, and when Global is expected to catch up.",
    share: "./calendar.html",
    image: "og/calendar.png",
    imageAlt:
      "The Shittim Chest gacha calendar, showing JP and Global banner history",
  },
  "/simulator": {
    title: "Recruitment Simulator — Shittim Chest",
    description:
      "Pull for a historical JP or Global banner and watch featured rates, pity and recruitment charge resolve. Simulation only — no real currency.",
    share: "./simulator.html",
    image: "og/simulator.png",
    imageAlt: "The Shittim Chest recruitment simulator",
  },
  "/about": {
    title: "About & Credits — Shittim Chest",
    description:
      "Where the banner data and artwork come from, who maintains them, and the limits of an unofficial fan forecast.",
    share: "./about.html",
    image: "og/about.png",
    imageAlt: "Credits and data sources for Shittim Chest",
  },
  "/spine": {
    title: "Spine Lobby Viewer — Shittim Chest",
    description:
      "Preview Blue Archive lobby Spine animations from a local game asset folder, grouped by character and variant.",
    share: "./spine.html",
    image: "og/about.png",
    imageAlt: "The Shittim Chest Spine lobby viewer",
  },
};

const SITE_NAME = "Shittim Chest";

/** Route document → dictionary key suffix (`seo.title.<suffix>` etc.). */
const ROUTE_SEO_SUFFIX: Record<Route, string> = {
  "/": "home",
  "/calendar": "calendar",
  "/simulator": "simulator",
  "/about": "about",
  "/spine": "spine",
};

/**
 * Metadata actually applied to the live document. Structural fields
 * (`share`, `image`) always come from `ROUTE_META` — the static English
 * `og:image` there is duplicated on purpose, since the HTML shims cannot
 * resolve absolute URLs — while the textual fields follow the interface
 * language when it is not English. Crawlers still see the English static
 * shims; this only changes what the running browser displays.
 */
function routeMeta(route: Route): RouteMeta {
  const base = ROUTE_META[route];
  const language = getLanguage();
  if (language === "en") return base;
  const suffix = ROUTE_SEO_SUFFIX[route];
  return {
    ...base,
    title: message(language, `seo.title.${suffix}` as LangKey),
    description: message(language, `seo.desc.${suffix}` as LangKey),
    imageAlt: message(language, `seo.alt.${suffix}` as LangKey),
  };
}

/**
 * Absolute URL for a site-relative `path`, given the current page's `href`.
 *
 * Derived from the document rather than from `import.meta.env.BASE_URL`: this
 * build sets `base: "./"`, so BASE_URL is the relative string `"./"` and
 * concatenating it onto `location.origin` produces an invalid URL
 * (`http://host./`) that throws. Resolving against the document handles the
 * repository subpath, a custom domain, and a trailing `#fragment` at once.
 */
export function absoluteFrom(href: string, path: string): string {
  return new URL(path, new URL(".", href)).href;
}

/** Absolute URL for a site-relative path, safe inside a meta `content`. */
export const absolute = (path: string) => absoluteFrom(location.href, path);

function upsert<T extends Element>(selector: string, create: () => T): T {
  const existing = document.head.querySelector<T>(selector);
  if (existing) return existing;
  const el = create();
  document.head.appendChild(el);
  return el;
}

function meta(selector: string, attrs: Record<string, string>) {
  const el = upsert<HTMLMetaElement>(selector, () =>
    document.createElement("meta"),
  );
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

function link(rel: string, href: string) {
  const el = upsert<HTMLLinkElement>(
    `link[rel="${rel}"]`,
    () => document.createElement("link"),
  );
  el.setAttribute("rel", rel);
  el.setAttribute("href", href);
  return el;
}

/**
 * Point the document at `route`'s metadata. Safe to call on every navigation:
 * existing tags are updated in place rather than duplicated.
 */
export function applySeo(route: Route) {
  const m = routeMeta(route);
  const url = absolute(m.share);
  const image = absolute(asset(m.image));

  document.title = m.title;
  meta('meta[name="description"]', {
    name: "description",
    content: m.description,
  });

  link("canonical", url);
  link("icon", asset("shittim-chest.svg"));

  for (const [property, content] of [
    ["og:type", "website"],
    ["og:site_name", SITE_NAME],
    ["og:title", m.title],
    ["og:description", m.description],
    ["og:url", url],
    ["og:image", image],
    ["og:image:width", "1200"],
    ["og:image:height", "630"],
    ["og:image:alt", m.imageAlt],
  ] as const) {
    meta(`meta[property="${property}"]`, { property, content });
  }

  // summary_large_image renders the 1200x630 card instead of a tiny thumbnail.
  for (const [name, content] of [
    ["twitter:card", "summary_large_image"],
    ["twitter:title", m.title],
    ["twitter:description", m.description],
    ["twitter:image", image],
    ["twitter:image:alt", m.imageAlt],
  ] as const) {
    meta(`meta[name="${name}"]`, { name, content });
  }
}
