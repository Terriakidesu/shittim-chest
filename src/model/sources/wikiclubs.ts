import { CONFIG, WIKI_API } from "../config";
import type { SourceMeta, SourceResult } from "./types";

/**
 * Localised club names from the Blue Archive Wiki character pages.
 *
 * SchaleDB identifies a student's club by an internal key (`Kohshinjo68`,
 * `SPTF`, `GourmetClub`) — not something you can put in front of a reader. The
 * wiki's `{{Character}}` infobox carries the official Global/English club name
 * instead, keyed by the *same* numeric `Id` SchaleDB uses, so the two join
 * exactly.
 *
 * `Category:Characters` is the canonical roster: one page per student,
 * variants included, and the count tracks the SchaleDB dump.
 */

interface CharacterPage {
  title: string;
  revisions?: { slots?: { main?: { content?: string } } }[];
}

interface QueryResult {
  categorymembers?: { title: string }[];
  continue?: { cmcontinue?: string };
  pages?: CharacterPage[];
}

/** `{{Character\n| Key = value\n}}` — one per page, always newline-delimited. */
const CHARACTER_RE = /\{\{Character\s*\n([\s\S]*?)\n\}\}/;
const FIELD_RE = /\|\s*([A-Za-z_]+)\s*=\s*([^\n|]*)/g;

/** The wiki spells "not in a club" as a literal sentinel rather than blank. */
const NO_CLUB = "no club";

/** MediaWiki titles per request; 50 is the documented limit for non-bots. */
const BATCH = 50;

function field(body: string, name: string): string | null {
  for (const match of body.matchAll(FIELD_RE)) {
    if (match[1] === name) return match[2].trim();
  }
  return null;
}

/**
 * Pull the student id and club out of one character's wikitext. Returns null
 * when the page has no `{{Character}}` infobox or no usable id, so a
 * restructured page degrades to the SchaleDB key instead of poisoning the map.
 */
export function parseCharacterInfobox(
  wikitext: string,
): { id: number; club: string } | null {
  const template = CHARACTER_RE.exec(wikitext);
  if (!template) return null;
  const id = Number(field(template[1], "Id"));
  if (!Number.isInteger(id) || id <= 0) return null;
  const club = field(template[1], "Club") ?? "";
  return { id, club: club === NO_CLUB ? "" : club };
}

/** Every action=query response wraps its payload in a `query` envelope. */
async function api(params: Record<string, string>): Promise<QueryResult> {
  const url = new URL(WIKI_API);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const res = await fetch(url, { headers: { "User-Agent": CONFIG.userAgent } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${WIKI_API}`);
  const body = (await res.json()) as { query?: QueryResult };
  return body.query ?? {};
}

export class WikiClubSource {
  readonly key = "bluearchive.wiki/clubs";
  readonly label = "Blue Archive Wiki — student clubs";

  async fetchAll(): Promise<SourceResult<Map<number, string>>> {
    const records = new Map<number, string>();

    // The roster: every student page, base and variant alike.
    const titles: string[] = [];
    let cont: string | undefined;
    do {
      const query = await api({
        action: "query",
        list: "categorymembers",
        cmtitle: "Category:Characters",
        cmlimit: "500",
        cmtype: "page",
        format: "json",
        formatversion: "2",
        ...(cont ? { cmcontinue: cont } : {}),
      });
      for (const member of query.categorymembers ?? []) titles.push(member.title);
      cont = query.continue?.cmcontinue;
    } while (cont);

    for (let i = 0; i < titles.length; i += BATCH) {
      const query = await api({
        action: "query",
        prop: "revisions",
        rvprop: "content",
        rvslots: "main",
        titles: titles.slice(i, i + BATCH).join("|"),
        format: "json",
        formatversion: "2",
      });
      for (const page of query.pages ?? []) {
        const parsed = parseCharacterInfobox(
          page.revisions?.[0]?.slots?.main?.content ?? "",
        );
        if (parsed) records.set(parsed.id, parsed.club);
      }
    }

    // An empty result means the category moved, the API changed shape, or the
    // responses were error pages. Treat that as a failure rather than shipping
    // a snapshot whose clubs silently fall back to raw SchaleDB keys.
    if (!records.size) {
      throw new Error(`no student clubs parsed from ${titles.length} wiki pages`);
    }

    const meta: SourceMeta = {
      key: this.key,
      label: this.label,
      fetchedAtMs: Date.now(),
      changed: true,
    };
    return { records, meta };
  }
}
