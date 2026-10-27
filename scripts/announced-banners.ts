/**
 * Banners an official announcement has revealed before the wiki and SchaleDB
 * carry them.
 *
 * Normal flow: the Blue Archive Wiki lists a banner, SchaleDB has the student,
 * and `buildSnapshot()` joins them. On the day a new pickup is announced there
 * is a window — usually a few hours, up to a day — where the official JP news
 * post exists but neither upstream source knows the students yet. During that
 * window the site would silently show nothing for the upcoming rotation.
 *
 * This table closes that gap. Rows are hand-kept (the same pattern as
 * `OFFICIAL_GLOBAL_SCHEDULES`), merged into `banners.json` with
 * `provisional: true`, and dropped automatically once the wiki catches up,
 * measured by start-day proximity rather than a code match: the wiki's code
 * for a brand-new student is itself a guess until SchaleDB publishes it.
 *
 * Two deliberate refusals:
 *  - Provisional rows never reach the simulator. A banner without a real
 *    student pool cannot support a spark exchange, and an empty period in the
 *    picker is worse than no period.
 *  - Provisional rows never reach `forecast.json`. They carry no JP→GL
 *    prediction, and letting them into the alignment model would shift real
 *    forecasts on the strength of a date we read off a news post.
 *
 * Character ids are negative on purpose: SchaleDB ids are positive, so a
 * placeholder can never collide with — or be mistaken for — a real student.
 * Their artwork lives under `public/img/announced/`, cropped from the official
 * promo art for the announcement (see `AVATAR_SOURCE`). When the real student
 * arrives the placeholder row drops out and those files should be deleted.
 */

/** Widest gap between an announced start and the wiki's recorded one. */
const DEDUPE_TOLERANCE_MS = 36 * 60 * 60 * 1000;

/** Where the placeholder headshots came from, for attribution in the UI docs. */
export const AVATAR_SOURCE =
  "Cropped from the official Blue Archive Japan pickup announcement artwork " +
  "(© NEXON Games & Yostar); replaced by SchaleDB artwork once published.";

export interface AnnouncedCharacter {
  id: number;
  name: string;
  nameJp: string;
  nameKr: string;
  school: string;
  starGrade: number;
  /** Relative path under `public/`, like the exported avatars. */
  avatar: string;
  availability: "permanent" | "limited" | "event";
}

export interface AnnouncedBanner {
  /** Negative so it can never be confused with a wiki banner id. */
  id: number;
  server: "JP" | "GL";
  type: "PickupGacha" | "LimitedGacha" | "FesGacha";
  code: string;
  /**
   * The wiki's `Limited` field is never set in practice — every limited pickup
   * in the export is `LimitedGacha` with `limited: false`. Announced rows follow
   * that convention so they don't sprout a badge no real banner ever has.
   */
  limited: boolean;
  startMs: number;
  endMs: number;
  /** When the announcement went out; shown as provenance in the detail panel. */
  announcedAtMs: number;
  characters: AnnouncedCharacter[];
}

/**
 * The 10/28 maintenance batch: two limited pickups, both Trinity Racing forms.
 * Announced by the JP news post of 2026-10-27 13:55 JST (04:55 UTC); the
 * maintenance window (11:00–19:00 JST) puts the start at 19:00 JST, ending
 * 11/11 10:59 JST.
 */
export const ANNOUNCED_BANNERS: AnnouncedBanner[] = [
  {
    id: -1,
    server: "JP",
    type: "LimitedGacha",
    code: "Hifumi_(Racing)_release",
    limited: false,
    startMs: Date.UTC(2026, 9, 28, 10, 0),
    endMs: Date.UTC(2026, 10, 11, 1, 59),
    announcedAtMs: Date.UTC(2026, 9, 27, 4, 55),
    characters: [
      {
        id: -1,
        name: "Hifumi (Racing)",
        nameJp: "ヒフミ(レーシング)",
        nameKr: "히후미(레이싱)",
        school: "Trinity",
        starGrade: 3,
        avatar: "img/announced/hifumi-racing.webp",
        availability: "limited",
      },
    ],
  },
  {
    id: -2,
    server: "JP",
    type: "LimitedGacha",
    code: "Azusa_(Racing)_release",
    limited: false,
    startMs: Date.UTC(2026, 9, 28, 10, 0),
    endMs: Date.UTC(2026, 10, 11, 1, 59),
    announcedAtMs: Date.UTC(2026, 9, 27, 4, 55),
    characters: [
      {
        id: -2,
        name: "Azusa (Racing)",
        nameJp: "アズサ(レーシング)",
        nameKr: "아즈사(레이싱)",
        school: "Trinity",
        starGrade: 3,
        avatar: "img/announced/azusa-racing.webp",
        availability: "limited",
      },
    ],
  },
];

interface ExistingBanner {
  server: "JP" | "GL";
  startMs: number;
  evergreen: boolean;
}

/**
 * Announced rows that the wiki still does not have, and that have not expired.
 *
 * A row counts as "arrived" when the same server has a real banner starting
 * within `DEDUPE_TOLERANCE_MS` of the announced start. The announced times come
 * from a maintenance window and the wiki usually records the batch an hour or
 * so apart, so an exact timestamp match would never fire; a whole-day match is
 * also wrong, because a same-day rerun is a different banner.
 */
export function pendingAnnouncedBanners(
  existing: readonly ExistingBanner[],
  nowMs: number,
  rows: readonly AnnouncedBanner[] = ANNOUNCED_BANNERS,
): AnnouncedBanner[] {
  const taken = existing.filter((b) => !b.evergreen);
  return rows.filter(
    (row) =>
      row.endMs > nowMs &&
      !taken.some(
        (b) =>
          b.server === row.server &&
          Math.abs(b.startMs - row.startMs) <= DEDUPE_TOLERANCE_MS,
      ),
  );
}
