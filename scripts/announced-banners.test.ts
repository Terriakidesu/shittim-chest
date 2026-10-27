import { expect, test } from "bun:test";
import {
  ANNOUNCED_BANNERS,
  pendingAnnouncedBanners,
  type AnnouncedBanner,
} from "./announced-banners";

const HOUR = 3_600_000;
const start = Date.UTC(2026, 9, 28, 10, 0);
const end = Date.UTC(2026, 10, 11, 1, 59);

const row = (over: Partial<AnnouncedBanner> = {}): AnnouncedBanner => ({
  id: -1,
  server: "JP",
  type: "LimitedGacha",
  code: "Test_release",
  limited: true,
  startMs: start,
  endMs: end,
  announcedAtMs: start - 24 * HOUR,
  characters: [],
  ...over,
});

test("the shipped table stays inside the announced window", () => {
  for (const banner of ANNOUNCED_BANNERS) {
    expect(banner.server).toBe("JP");
    expect(banner.endMs).toBeGreaterThan(banner.startMs);
    expect(banner.announcedAtMs).toBeLessThan(banner.startMs);
    // Negative ids keep placeholders away from SchaleDB's positive ids.
    expect(banner.id).toBeLessThan(0);
    expect(banner.characters.length).toBeGreaterThan(0);
    for (const c of banner.characters) {
      expect(c.id).toBeLessThan(0);
      expect(c.avatar.startsWith("img/announced/")).toBe(true);
    }
  }
  // The two rows are the same update, so they share a window.
  const [a, b] = ANNOUNCED_BANNERS;
  expect(a.startMs).toBe(b.startMs);
  expect(a.endMs).toBe(b.endMs);
});

test("a row is pending while no wiki banner starts near it", () => {
  const now = start - 5 * HOUR;
  expect(pendingAnnouncedBanners([], now, [row()])).toHaveLength(1);
  // A banner a week earlier is an unrelated rotation.
  const earlier = [{ server: "JP" as const, startMs: start - 7 * 24 * HOUR, evergreen: false }];
  expect(pendingAnnouncedBanners(earlier, now, [row()])).toHaveLength(1);
});

test("the wiki catching up retires the row despite a different start clock", () => {
  const now = start + HOUR;
  // The wiki records the batch at 11:00 JST, the announcement implies 19:00.
  const caughtUp = [{ server: "JP" as const, startMs: start - 8 * HOUR, evergreen: false }];
  expect(pendingAnnouncedBanners(caughtUp, now, [row()])).toEqual([]);
});

test("a Global banner never retires a Japanese announcement", () => {
  const now = start + HOUR;
  const gl = [{ server: "GL" as const, startMs: start, evergreen: false }];
  expect(pendingAnnouncedBanners(gl, now, [row()])).toHaveLength(1);
});

test("evergreen select banners cannot swallow an announcement", () => {
  const now = start + HOUR;
  const evergreen = [{ server: "JP" as const, startMs: start, evergreen: true }];
  expect(pendingAnnouncedBanners(evergreen, now, [row()])).toHaveLength(1);
});

test("rows expire after their own window closes", () => {
  expect(pendingAnnouncedBanners([], end - 1, [row()])).toHaveLength(1);
  expect(pendingAnnouncedBanners([], end, [row()])).toEqual([]);
});
