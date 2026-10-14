import { CONFIG, WIKI_BASE, WIKI_PAGES, type Server } from "../config";
import type { RawWikiBanner, SourceMeta, SourceResult } from "./types";

/**
 * Blue Archive Wiki (Miraheze MediaWiki).
 *
 * The wiki exposes full banner history as plain wikitext in yearly subpages:
 *   Banner List/Banners_of_2026
 *   Banner List (Global)/Banners_of_2026
 *
 * Each record is a `{{Banner|...}}` template. This is far more robust than
 * scraping the rendered tables, and the MediaWiki *Cargo* API is unusable here
 * (it throws MWException on StartDate/EndDate), so wikitext is the way in.
 */

const FIELD_MAP: Record<string, keyof RawWikiBanner> = {
  Id: "id",
  Server: "server",
  Code: "code",
  Type: "type",
  CrossregionId: "crossregionId",
  NameJP: "nameJp",
  NameEN: "nameEn",
  Image: "image",
  Rateup_character: "rateupCharacter",
  Rerun: "rerun",
  Limited: "limited",
  Start_date: "startDate",
  End_date: "endDate",
  Notes: "notes",
};

/** `{{Banner\n| Key = value\n}}` — the closing brace is always on its own line. */
const BANNER_RE = /\{\{Banner\s*\n([\s\S]*?)\n\}\}/g;
const FIELD_RE = /\|\s*([A-Za-z_]+)\s*=\s*([^\n|]*)/g;

export function parseBannerWikitext(
  wikitext: string,
): RawWikiBanner[] {
  const out: RawWikiBanner[] = [];
  for (const match of wikitext.matchAll(BANNER_RE)) {
    const body = match[1];
    const rec = {} as Record<string, string>;
    for (const field of body.matchAll(FIELD_RE)) {
      const key = FIELD_MAP[field[1]];
      if (key) rec[key] = field[2].trim();
    }
    // A usable record must at least identify a server and a window.
    if (!rec.server || !rec.startDate) continue;
    out.push(rec as unknown as RawWikiBanner);
  }
  return out;
}

export function wikiUrl(title: string) {
  return `${WIKI_BASE}?title=${encodeURIComponent(title)}&action=raw`;
}

async function fetchPage(
  title: string,
  since: string | undefined,
): Promise<{ text: string; meta: SourceMeta }> {
  const headers: Record<string, string> = {
    "User-Agent": CONFIG.userAgent,
  };
  if (since) headers["If-Modified-Since"] = since;

  const res = await fetch(wikiUrl(title), { headers });
  const meta: SourceMeta = {
    key: `wiki:${title}`,
    label: `Blue Archive Wiki — ${title}`,
    fetchedAtMs: Date.now(),
    changed: res.status !== 304,
  };
  const lastModified = res.headers.get("last-modified");
  if (lastModified) meta.lastModified = lastModified;

  // MediaWiki serves an HTML 404 page with a 200 for missing titles; a year
  // subpage that has not been created yet returns no banners.
  if (!res.ok) {
    return { text: "", meta };
  }
  const text = await res.text();
  if (text.trimStart().startsWith("<!DOCTYPE html")) {
    return { text: "", meta: { ...meta, changed: false } };
  }
  return { text, meta };
}

export class BlueArchiveWikiSource {
  readonly key = "bluearchive.wiki";
  readonly label = "Blue Archive Wiki";

  async fetchAll(opts: { since?: string } = {}): Promise<
    SourceResult<RawWikiBanner[]>
  > {
    const records: RawWikiBanner[] = [];
    const metas: SourceMeta[] = [];

    for (const page of WIKI_PAGES) {
      const { text, meta } = await fetchPage(page.title, opts.since);
      records.push(...parseBannerWikitext(text));
      metas.push(meta);
    }

    // Keep banners for the requested server only.
    const latest = Math.max(...metas.map((m) => m.fetchedAtMs), 0);
    return {
      records,
      meta: {
        key: this.key,
        label: this.label,
        fetchedAtMs: latest || Date.now(),
        lastModified: metas.find((m) => m.lastModified)?.lastModified,
        changed: metas.some((m) => m.changed),
      },
    };
  }
}

export const serverFromWiki = (value: string): Server =>
  value.trim().toUpperCase() === "GL" ? "GL" : "JP";