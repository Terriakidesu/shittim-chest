import type { RawWikiBanner } from "../sources/types";
import { serverFromWiki } from "../sources/bawiki";
import type { Server } from "../config";
import { CharacterIndex } from "./characters";
import {
  isEvergreen,
  type Banner,
  type BannerType,
} from "./types";

const KNOWN_TYPES: BannerType[] = [
  "PickupGacha",
  "LimitedGacha",
  "FesGacha",
  "SelectPickupGacha",
  "SelectPickupFesGacha",
];

const toType = (raw: string | undefined): BannerType => {
  const t = (raw ?? "").trim() as BannerType;
  return KNOWN_TYPES.includes(t) ? t : "Unknown";
};

const truthy = (raw: string | undefined) =>
  /^(yes|true|1)$/i.test((raw ?? "").trim());

const text = (raw: string | null | undefined) => raw?.trim() || null;

/**
 * The wiki writes ISO-8601 with a bare numeric offset (`2025-01-08T11:00+09`).
 * `Date.parse` rejects that form because ISO offsets need `+HH:MM`, so widen it
 * before parsing rather than depending on engine leniency.
 */
export function parseWikiInstant(raw: string): number {
  const text = raw.trim();
  const widened = text.replace(
    /([+-]\d{2})$/,
    (_m, off: string) => `${off}:00`,
  );
  const ms = Date.parse(widened);
  if (Number.isFinite(ms)) return ms;
  throw new Error(`Unparseable timestamp from wiki: ${JSON.stringify(raw)}`);
}

export function normalizeBanner(
  raw: RawWikiBanner,
  chars: CharacterIndex,
): Banner | null {
  const id = Number(raw.id);
  if (!Number.isFinite(id)) return null;

  let startMs: number;
  let endMs: number;
  try {
    startMs = parseWikiInstant(raw.startDate);
    endMs = parseWikiInstant(raw.endDate);
  } catch {
    return null;
  }

  const server: Server = serverFromWiki(raw.server);
  const rateupRaw = raw.rateupCharacter?.trim() || null;

  return {
    id,
    server,
    code: text(raw.code),
    type: toType(raw.type),
    rateupRaw: text(rateupRaw),
    characterIds: chars.resolve(rateupRaw),
    rerun: truthy(raw.rerun),
    limited: truthy(raw.limited),
    startMs,
    endMs,
    evergreen: isEvergreen(endMs, startMs),
    imageFile: text(raw.image),
    nameJp: text(raw.nameJp),
    nameEn: text(raw.nameEn),
    notes: text(raw.notes),
  };
}

export function normalizeAll(
  raws: RawWikiBanner[],
  chars: CharacterIndex,
): Banner[] {
  const out: Banner[] = [];
  const seen = new Set<string>();
  for (const raw of raws) {
    const b = normalizeBanner(raw, chars);
    if (!b) continue;
    const key = `${b.server}:${b.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(b);
  }
  out.sort((a, b) => a.startMs - b.startMs || a.id - b.id);
  return out;
}