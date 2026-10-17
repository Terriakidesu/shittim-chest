import { CONFIG, WIKI_API } from "../src/model/config";
import { RECRUITMENT_TRANSLATIONS } from "./recruitment-translations";

// Export-only enrichment: never imported by the browser or vendored model.
// Keep this DTO aligned with StudentProfile in src/client/api.ts.
export interface StudentProfileDto {
  tacticalRole: string;
  weaponType: string;
  birthday: string;
  voiceActor: string;
  recruitmentDialogue: string;
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

export function parseRecruitmentDialogue(wikitext: string) {
  const lines: string[] = [];
  for (const row of wikitext.split(/(?:^|\n)\|-\s*\n/)) {
    if (!/^\|\s*Gachaget(?:_\d+)?\s*\n/i.test(row)) continue;
    const cells = row.split(/\n\|\s*/);
    // Prefer wiki English; otherwise use a reviewed translation of this exact
    // Japanese recruitment line, never an unrelated voice line.
    const english = cells[cells.length - 1];
    if (cells.length < 4) continue;
    const text = plainWikiText(english.replace(/^lang="en"\s*\|\s*/i, ""));
    if (text && !/[\u3041-\u3096\u30a1-\u30fa\u3400-\u9fff]/u.test(text) && !/translation needed|untranslated|\{\{/i.test(text)) lines.push(text);
    else {
      const japanese = cells.find((cell) => /^lang="ja"\s*\|/i.test(cell));
      const source = plainWikiText((japanese ?? "").replace(/^lang="ja"\s*\|\s*/i, ""));
      const translated = RECRUITMENT_TRANSLATIONS[source];
      if (translated) lines.push(translated);
    }
  }
  return lines.join(" ");
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
  const audioTitles = [...idsByTitle.keys()];
  for (let i = 0; i < audioTitles.length; i += 50) {
    for (const page of await pages(audioTitles.slice(i, i + 50))) {
      const id = idsByTitle.get(page.title);
      if (id === undefined) continue;
      const dialogue = parseRecruitmentDialogue(page.revisions?.[0]?.slots?.main?.content ?? "");
      // Alternate forms can share an ID and have no separate audio page.
      if (dialogue) records.get(id)!.recruitmentDialogue = dialogue;
    }
  }
  // Combat/age-switch forms share their base form's recruitment voice line.
  for (const [form, base] of [[10099, 10098], [10144, 10143]]) {
    const profile = records.get(form);
    if (profile && !profile.recruitmentDialogue) profile.recruitmentDialogue = records.get(base)?.recruitmentDialogue ?? "";
  }
  console.log(`student profiles: ${records.size}; recruitment dialogue: ${[...records.values()].filter((p) => p.recruitmentDialogue).length}/${records.size}`);
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
