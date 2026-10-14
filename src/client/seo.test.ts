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

  test("resolves the same from a sibling route document", () => {
    // Every route is a flat sibling of index.html, so a route file must reach
    // the same assets the lobby does. A subdirectory would break this.
    expect(
      absoluteFrom("https://terriakidesu.github.io/shittim-chest/calendar.html", "./og/calendar.png"),
    ).toBe("https://terriakidesu.github.io/shittim-chest/og/calendar.png");
    expect(
      absoluteFrom("https://terriakidesu.github.io/shittim-chest/about.html", "./data/status.json"),
    ).toBe("https://terriakidesu.github.io/shittim-chest/data/status.json");
  });

  test("ignores a trailing hash", () => {
    expect(absoluteFrom(`${PAGES}#/calendar`, "./og/calendar.png")).toBe(
      "https://terriakidesu.github.io/shittim-chest/og/calendar.png",
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

  test("share paths match the route documents that actually exist", () => {
    // A share path with no corresponding file is a dead canonical URL and a
    // preview with no metadata, and nothing else in the build would catch it.
    expect(ROUTE_META["/"].share).toBe("./");
    expect(ROUTE_META["/calendar"].share).toBe("./calendar.html");
    expect(ROUTE_META["/simulator"].share).toBe("./simulator.html");
    expect(ROUTE_META["/about"].share).toBe("./about.html");
  });

  test("image paths are the site's own social cards", () => {
    for (const route of routes) {
      const m = ROUTE_META[route];
      // A typo here yields a 404 social card that no local check would catch.
      expect(m.image).toStartWith("og/");
      expect(absoluteFrom(PAGES, "./" + m.image)).toEndWith(".png");
    }
  });
});
