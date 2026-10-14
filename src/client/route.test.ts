import { describe, expect, test } from "bun:test";
import { link, routeFromPath } from "./route";

/**
 * Routes are matched on the trailing path segment so the resolver works under
 * any subpath and for both URL forms GitHub Pages serves interchangeably
 * (`/calendar` resolves to calendar.html).
 */
const SUB = "https://terriakidesu.github.io/shittim-chest";

describe("routeFromPath", () => {
  test("resolves each route document", () => {
    expect(routeFromPath("/calendar.html")).toBe("/calendar");
    expect(routeFromPath("/simulator.html")).toBe("/simulator");
    expect(routeFromPath("/about.html")).toBe("/about");
  });

  test("resolves the extensionless form Pages serves", () => {
    expect(routeFromPath("/calendar")).toBe("/calendar");
    expect(routeFromPath("/simulator")).toBe("/simulator");
    expect(routeFromPath("/about")).toBe("/about");
  });

  test("resolves under a repository subpath", () => {
    expect(routeFromPath("/shittim-chest/calendar.html")).toBe("/calendar");
    expect(routeFromPath("/shittim-chest/calendar")).toBe("/calendar");
  });

  test("tolerates a trailing slash and mixed case", () => {
    expect(routeFromPath("/calendar/")).toBe("/calendar");
    expect(routeFromPath("/Calendar.html")).toBe("/calendar");
  });

  test("treats the lobby and anything unknown as home", () => {
    expect(routeFromPath("/")).toBe("/");
    expect(routeFromPath("/index.html")).toBe("/");
    expect(routeFromPath("/shittim-chest/")).toBe("/");
    expect(routeFromPath("/nope.html")).toBe("/");
  });

  test("does not match a route name that is only a prefix", () => {
    // /calendar-export is not the calendar.
    expect(routeFromPath("/calendar-export.html")).toBe("/");
    expect(routeFromPath("/abouts.html")).toBe("/");
  });

  test("ignores a legacy hash route left in the path", () => {
    // A pre-migration link like /shittim-chest/#/simulator arrives with the
    // fragment intact; pathname still resolves to the lobby and public/404.html
    // forwards it. routeFromPath must not guess from an empty pathname.
    expect(routeFromPath("/shittim-chest/")).toBe("/");
  });
});

describe("link", () => {
  test("are relative so they survive a subpath deploy", () => {
    for (const href of Object.values(link)) {
      expect(href).toStartWith("./");
    }
  });

  test("point at the flat route documents", () => {
    expect(link.home).toBe("./");
    expect(link.calendar).toBe("./calendar.html");
    expect(link.simulator).toBe("./simulator.html");
    expect(link.about).toBe("./about.html");
  });

  test("resolve to the right route from any route document", () => {
    // Because every route file is a sibling of index.html, a relative link
    // resolves identically from each of them.
    for (const from of ["index.html", "calendar.html", "simulator.html", "about.html"]) {
      const href = new URL(link.calendar, `${SUB}/${from}`);
      expect(href.pathname).toBe("/shittim-chest/calendar.html");
      expect(routeFromPath(href.pathname)).toBe("/calendar");
    }
  });
});
