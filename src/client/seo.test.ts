import { describe, expect, test } from "bun:test";
import { absoluteFrom, ROUTE_META } from "./seo";
import type { Route } from "./route";

/**
 * `absoluteFrom` is pure, so the subpath and fragment cases that a deployed
 * Pages site actually hits can be pinned here. Getting this wrong produced an
 * `http://host./` base that threw on boot and blanked the whole app.
 */
const PAGES = "https://terriakidesu.github.io/shittim-chest/index.html";

describe("absoluteFrom", () => {
  test("resolves a site-relative path against the document", () => {
    expect(absoluteFrom(PAGES, "./og/home.png")).toBe(
      "https://terriakidesu.github.io/shittim-chest/og/home.png",
    );
  });

  test("does not double up the subpath when served from a shim", () => {
    expect(
      absoluteFrom("https://terriakidesu.github.io/shittim-chest/calendar.html", "./calendar.html"),
    ).toBe("https://terriakidesu.github.io/shittim-chest/calendar.html");
  });

  test("ignores the hash fragment", () => {
    expect(absoluteFrom(`${PAGES}#/simulator`, "./og/simulator.png")).toBe(
      "https://terriakidesu.github.io/shittim-chest/og/simulator.png",
    );
  });

  test("works from a bare directory URL with no index.html", () => {
    expect(
      absoluteFrom("https://terriakidesu.github.io/shittim-chest/", "./"),
    ).toBe("https://terriakidesu.github.io/shittim-chest/");
  });

  test("works for a custom root domain", () => {
    expect(
      absoluteFrom("https://shittim.example/index.html", "./og/about.png"),
    ).toBe("https://shittim.example/og/about.png");
  });
});

describe("ROUTE_META", () => {
  const routes: Route[] = ["/", "/calendar", "/simulator", "/about"];

  test("every route has a complete entry", () => {
    for (const route of routes) {
      const m = ROUTE_META[route];
      expect(m.title.length).toBeGreaterThan(0);
      expect(m.description.length).toBeGreaterThan(0);
      expect(m.image.endsWith(".png")).toBe(true);
      expect(m.imageAlt.length).toBeGreaterThan(0);
    }
  });

  test("descriptions are distinct per route", () => {
    const seen = new Set(routes.map((r) => ROUTE_META[r].description));
    expect(seen.size).toBe(routes.length);
  });

  test("share paths and image paths are the site's own shims", () => {
    for (const route of routes) {
      const m = ROUTE_META[route];
      expect(m.share).toStartWith("./");
      // A typo here yields a 404 social card that no local check would catch.
      expect(m.image).toStartWith("og/");
    }
  });
});
