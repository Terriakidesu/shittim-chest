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
 * The two sources do not always arrive together. The wiki usually records the
 * batch within hours, while SchaleDB's student dump — the only place the
 * numeric ids, artwork and localized names come from — can lag by a day. The
 * wiki's `Rateup_character` then names a student that resolves to nothing, and
 * the banner ships with an empty pool: the calendar prints the raw code and
 * the simulator builds a period with no roster. `announcedPlaceholderCharacters`
 * covers that window by lending these placeholder characters to the real wiki
 * banner, which keeps the wiki's id, dates and banner art.
 *
 * Two deliberate refusals:
 *  - A provisional row that still has no wiki banner never reaches the
 *    simulator or `forecast.json`. It carries no resolved pool and no JP→GL
 *    prediction, and letting a date read off a news post into the alignment
 *    model would shift real forecasts. Once the wiki records the banner the
 *    date is upstream's, so the prediction is real even while the pool is
 *    still a placeholder.
 *
 * Character ids are negative on purpose: SchaleDB ids are positive, so a
 * placeholder can never collide with — or be mistaken for — a real student.
 * Their artwork lives under `public/img/announced/`, cropped from the student's
 * own `Student_Portrait_*` bust in the JP client (see `AVATAR_SOURCE`). Delete
 * those files once SchaleDB publishes the student; nothing else references
 * them.
 */

import { normalizeCharName, splitRateup } from "../src/model/domain/characters";

/** Widest gap between an announced start and the wiki's recorded one. */
const DEDUPE_TOLERANCE_MS = 36 * 60 * 60 * 1000;

/** Where the placeholder headshots came from, for attribution in the UI docs. */
export const AVATAR_SOURCE =
  "Cropped from the student's own Student_Portrait bust in the Blue Archive Japan " +
  "client (© NEXON Games & Yostar); replaced by SchaleDB artwork once published.";

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
 * maintenance ran 02:00–11:00 JST, so the wiki's recorded start is 11:00 JST
 * (02:00 UTC) — kept here in case the wiki row ever disappears again.
 *
 * The client already stores both outfits before SchaleDB lists them: they are
 * `CH0379` (ヒフミ, Hifumi) and `CH0380` (アズサ, Azusa) in the Addressables
 * catalog, so the headshots are cropped from
 * `uis-01_common-01_character-*_textures-2026-09-30_*.bundle` →
 * `Student_Portrait_CH0379` / `Student_Portrait_CH0380`.
 */
export const ANNOUNCED_BANNERS: AnnouncedBanner[] = [
  {
    id: -1,
    server: "JP",
    type: "LimitedGacha",
    code: "Hifumi_(Racing)_release",
    limited: false,
    startMs: Date.UTC(2026, 9, 28, 2, 0),
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
    startMs: Date.UTC(2026, 9, 28, 2, 0),
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

/**
 * Placeholder characters standing in for rate-up names the exporter could not
 * resolve, so a wiki banner is not left with an empty pool.
 *
 * The match is on `Rateup_character` spellings, normalised the same way the
 * SchaleDB join normalises them (`Hifumi (Racing)` → `hifumi_racing`), which is
 * why the announced table stores the wiki's display name rather than its code.
 * A name that does not appear in the table — a rerun sharing the batch, say —
 * simply contributes nothing.
 */
export function announcedPlaceholderCharacters(
  rateupRaw: string | null,
  rows: readonly AnnouncedBanner[] = ANNOUNCED_BANNERS,
): AnnouncedCharacter[] {
  const wanted = new Set(splitRateup(rateupRaw).map(normalizeCharName));
  if (!wanted.size) return [];
  const out: AnnouncedCharacter[] = [];
  for (const row of rows) {
    for (const character of row.characters) {
      if (wanted.has(normalizeCharName(character.name))) out.push(character);
    }
  }
  return out;
}

