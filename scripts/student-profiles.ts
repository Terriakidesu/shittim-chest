import { CONFIG, SCHALEDB_BASE, WIKI_API } from "../src/model/config";
import { RECRUITMENT_TRANSLATIONS } from "./recruitment-translations";

// Export-only enrichment: never imported by the browser or vendored model.
// Keep this DTO aligned with StudentProfile in src/client/api.ts.
export interface StudentProfileDto {
  tacticalRole: string;
  weaponType: string;
  birthday: string;
  voiceActor: string;
  recruitmentDialogue: string;
  /** Japanese recruitment line(s): the wiki table's own lang="ja" cells. */
  dialogueJp?: string;
  /** Korean recruitment line: SchaleDB's localized transcription of the same clip. */
  dialogueKr?: string;
}

interface WikiPage {
  title: string;
  revisions?: { slots?: { main?: { content?: string } } }[];
}

export function plainWikiText(value: string) {
  const entities: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", ndash: "–", mdash: "—", hellip: "…" };
  return value.replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, "")
    .replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, "$2")
    .replace(/<[^>]+>/g, " ").replace(/'{2,3}/g, "")
    .replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (entity, key: string) => {
      if (key.startsWith("#")) {
        const code = key[1].toLowerCase() === "x" ? parseInt(key.slice(2), 16) : Number(key.slice(1));
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
      }
      return entities[key] ?? entity;
    }).replace(/\s+/g, " ").trim();
}

export function parseStudentProfile(wikitext: string): { id: number; profile: StudentProfileDto } | null {
  const template = /\{\{Character\s*\n([\s\S]*?)\n\}\}/.exec(wikitext)?.[1];
  if (!template) return null;
  const fields = new Map([...template.matchAll(/^\|[ \t]*(\w+)[ \t]*=[ \t]*([^\n]*)/gm)].map((m) => [m[1], plainWikiText(m[2])]));
  const id = Number(fields.get("Id"));
  if (!Number.isInteger(id) || id <= 0) return null;
  return { id, profile: {
    tacticalRole: fields.get("CombatClass") ?? "",
    weaponType: fields.get("WeaponType") ?? "",
    birthday: fields.get("Birthday") ?? "",
    voiceActor: fields.get("Voice") ?? "",
    recruitmentDialogue: "",
  } };
}

/** One language pair for each Gachaget row: the Japanese source line the wiki
    table ships next to the English one. */
export interface GachaDialogue {
  en: string;
  ja: string;
}

export function parseGachaDialogue(wikitext: string): GachaDialogue {
  const enLines: string[] = [];
  const jaLines: string[] = [];
  for (const row of wikitext.split(/(?:^|\n)\|-\s*\n/)) {
    if (!/^\|\s*Gachaget(?:_\d+)?\s*\n/i.test(row)) continue;
    const cells = row.split(/\n\|\s*/);
    if (cells.length < 4) continue;
    const japanese = cells.find((cell) => /^lang="ja"\s*\|/i.test(cell));
    const source = plainWikiText((japanese ?? "").replace(/^lang="ja"\s*\|\s*/i, ""));
    if (source && !/\{\{/i.test(source)) jaLines.push(source);
    // Prefer wiki English; otherwise use a reviewed translation of this exact
    // Japanese recruitment line, never an unrelated voice line.
    const english = cells[cells.length - 1];
    const text = plainWikiText(english.replace(/^lang="en"\s*\|\s*/i, ""));
    if (text && !/[\u3041-\u3096\u30a1-\u30fa\u3400-\u9fff]/u.test(text) && !/translation needed|untranslated|\{\{/i.test(text)) enLines.push(text);
    else {
      const translated = RECRUITMENT_TRANSLATIONS[source];
      if (translated && !enLines.includes(translated)) enLines.push(translated);
    }
  }
  return { en: enLines.join(" "), ja: jaLines.join(" ") };
}

/** SchaleDB carries localized transcriptions of each character's obtained-clip
    (`CharacterGetIdle1` — the same voice line as the wiki's Gachaget row). The
    `kr` dump is the only source for the Korean line; `en`/`jp` have wiki text. */
async function fetchSchaleTranslations(): Promise<Map<number, string>> {
  const res = await fetch(`${SCHALEDB_BASE}/kr/voice.min.json`, { headers: { "User-Agent": CONFIG.userAgent } });
  if (!res.ok) throw new Error(`Student profiles: SchaleDB kr voice returned ${res.status}`);
  const payload = await res.json() as Record<string, { Normal?: { Group?: string; Transcription?: string }[] }>;
  const lines = new Map<number, string>();
  for (const [id, entry] of Object.entries(payload)) {
    const line = entry?.Normal?.find((clip) => clip.Group === "CharacterGetIdle1" && clip.Transcription?.trim())?.Transcription?.trim();
    if (line) lines.set(Number(id), line);
  }
  if (!lines.size) throw new Error("Student profiles: SchaleDB kr voice had no usable transcriptions");
  return lines;
}

async function query(params: Record<string, string>) {
  const url = new URL(WIKI_API);
  for (const [key, value] of Object.entries({ action: "query", format: "json", formatversion: "2", ...params })) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { "User-Agent": CONFIG.userAgent }, signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Student profiles: wiki returned ${response.status}`);
  const result = await response.json() as {
    error?: { info: string };
    continue?: { cmcontinue: string };
    query?: { categorymembers?: { title: string }[]; pages?: WikiPage[] };
  };
  if (result.error) throw new Error(result.error.info);
  return result;
}

export async function fetchStudentProfiles() {
  const titles: string[] = [];
  let continuation: string | undefined;
  do {
    const result = await query({ list: "categorymembers", cmtitle: "Category:Characters", cmlimit: "500", cmtype: "page", ...(continuation ? { cmcontinue: continuation } : {}) });
    titles.push(...(result.query?.categorymembers ?? []).map((p) => p.title));
    continuation = result.continue?.cmcontinue;
  } while (continuation);
  if (!titles.length) throw new Error("No wiki students found for profile export");

  const records = new Map<number, StudentProfileDto>();
  const idsByTitle = new Map<string, number>();
  const pages = async (batch: string[]) => (await query({ prop: "revisions", rvprop: "content", rvslots: "main", titles: batch.join("|") })).query?.pages ?? [];
  for (let i = 0; i < titles.length; i += 50) {
    for (const page of await pages(titles.slice(i, i + 50))) {
      const parsed = parseStudentProfile(page.revisions?.[0]?.slots?.main?.content ?? "");
      if (!parsed) continue;
      records.set(parsed.id, parsed.profile);
      idsByTitle.set(`${page.title}/audio`, parsed.id);
    }
  }
  if (!records.size) throw new Error("No usable student profile infoboxes found");

  // The Korean line has no wiki table; SchaleDB's localized transcription of
  // the same obtained clip fills it. A failure must not lose the wiki text.
  let schaleLines = new Map<number, string>();
  try {
    schaleLines = await fetchSchaleTranslations();
  } catch (err) {
    console.warn(`Korean recruitment dialogue unavailable (${err}); Korean falls back to English`);
  }

  const audioTitles = [...idsByTitle.keys()];
  for (let i = 0; i < audioTitles.length; i += 50) {
    for (const page of await pages(audioTitles.slice(i, i + 50))) {
      const id = idsByTitle.get(page.title);
      if (id === undefined) continue;
      const dialogue = parseGachaDialogue(page.revisions?.[0]?.slots?.main?.content ?? "");
      // Alternate forms can share an ID and have no separate audio page.
      if (dialogue.en) {
        const profile = records.get(id)!;
        profile.recruitmentDialogue = dialogue.en;
        if (dialogue.ja) profile.dialogueJp = dialogue.ja;
        if (schaleLines.has(id)) profile.dialogueKr = schaleLines.get(id);
      }
    }
  }
  // Combat/age-switch forms share their base form's recruitment voice line.
  for (const [form, base] of [[10099, 10098], [10144, 10143]]) {
    const profile = records.get(form);
    const source = records.get(base);
    if (profile && source) {
      if (!profile.recruitmentDialogue) profile.recruitmentDialogue = source.recruitmentDialogue ?? "";
      if (source.dialogueJp && !profile.dialogueJp) profile.dialogueJp = source.dialogueJp;
      if (source.dialogueKr && !profile.dialogueKr) profile.dialogueKr = source.dialogueKr;
    }
  }
  const values = [...records.values()];
  const count = (key: keyof StudentProfileDto) => values.filter((p) => p[key]).length;
  console.log(`student profiles: ${records.size}; recruitment dialogue: ${count("recruitmentDialogue")}/${records.size} (ja ${count("dialogueJp")}, kr ${count("dialogueKr")})`);
  return records;
}

// Targeted regeneration avoids refreshing unrelated banner/forecast artifacts.
if (import.meta.main) {
  const file = Bun.file("public/data/characters.json");
  const snapshot = await file.json() as { characters: { id: number; profile?: StudentProfileDto }[] };
  const profiles = await fetchStudentProfiles();
  for (const student of snapshot.characters) {
    const profile = profiles.get(student.id);
    if (profile) student.profile = profile;
  }
  await Bun.write(file, JSON.stringify(snapshot));
}
