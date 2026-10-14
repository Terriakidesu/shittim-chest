import type { Banner, Match } from "./types";
import { median } from "./align";

const DAY = 86_400_000;
export function baseCode(code: string | null): string | null {
  return code ? code.replace(/_rerun\d+$/, "") : null;
}
function ordinal(code: string | null) { return Number(code?.match(/_rerun(\d+)$/)?.[1] ?? 0); }
function rerun(b: Banner) { return b.rerun || /_rerun\d+$/.test(b.code ?? ""); }
function compatible(j: Banner, g: Banner) {
  const lag = (g.startMs - j.startMs) / DAY;
  return !j.evergreen && !g.evergreen && lag > 0 && lag <= 900 && rerun(j) === rerun(g) && j.type === g.type;
}

/** Reserve unique exact identities BEFORE any weaker match can claim them. */
export function matchBanners(jp: Banner[], gl: Banner[]): Match[] {
  const used = new Set<number>();
  const result = new Map<number, Match>();
  const jCodes = new Map<string, Banner[]>();
  const gCodes = new Map<string, Banner[]>();
  for (const [list, map] of [[jp, jCodes], [gl, gCodes]] as const) {
    for (const b of list) if (b.code) map.set(b.code, [...(map.get(b.code) ?? []), b]);
  }
  const proven: { jpMs: number; glMs: number; lag: number }[] = [];
  for (const j of jp) {
    const candidates = j.code ? gCodes.get(j.code) : undefined;
    if (!j.code || jCodes.get(j.code)?.length !== 1 || candidates?.length !== 1) continue;
    const g = candidates[0];
    if (!compatible(j, g)) continue;
    result.set(j.id, { jpBannerId: j.id, glBannerId: g.id, confidence: 1, method: "code" });
    used.add(g.id);
    proven.push({ jpMs: j.startMs, glMs: g.startMs, lag: (g.startMs - j.startMs) / DAY });
  }
  const sorted = [...jp].sort((a, b) => a.startMs - b.startMs || a.id - b.id);
  for (const j of sorted) {
    if (result.has(j.id)) continue;
    // Estimate the local era's lag, not the earliest occurrence of this student.
    const neighbours = [...proven].sort((a, b) => Math.abs(a.jpMs - j.startMs) - Math.abs(b.jpMs - j.startMs)).slice(0, 12);
    const lag = neighbours.length ? median(neighbours.map(p => p.lag)) : null;
    function pick(candidates: Banner[]) {
      const ranked = candidates.filter(g => !used.has(g.id) && compatible(j, g))
        .map(g => ({ g, score: lag == null ? (g.startMs - j.startMs) / DAY : Math.abs((g.startMs - j.startMs) / DAY - lag) + Math.abs(ordinal(g.code) - ordinal(j.code)) * 7 }))
        .sort((a, b) => a.score - b.score);
      if (!ranked.length || (ranked.length > 1 && ranked[1].score - ranked[0].score < 7)) return null;
      if (lag != null && ranked[0].score > 60) return null;
      return ranked[0].g;
    }
    let g = j.code && rerun(j) ? pick(gl.filter(g => rerun(g) && baseCode(g.code) === baseCode(j.code) && Math.abs(ordinal(g.code) - ordinal(j.code)) <= 2)) : null;
    let method: Match["method"] = g ? "rerun-ordinal" : "none";
    // Different explicit codes are not evidence of the same occurrence.
    if (!g && j.characterIds.length) {
      g = pick(gl.filter(g => (!j.code || !g.code) && g.characterIds.length === j.characterIds.length && j.characterIds.every(id => g.characterIds.includes(id))));
      if (g) method = "character";
    }
    if (g) used.add(g.id);
    result.set(j.id, { jpBannerId: j.id, glBannerId: g?.id ?? null, confidence: g ? (method === "rerun-ordinal" ? .7 : .5) : 0, method });
  }
  return [...result.values()].sort((a, b) => a.jpBannerId - b.jpBannerId);
}

export function matchSummary(matches: Match[]) {
  const by = (method: Match["method"]) => matches.filter(m => m.method === method).length;
  return { total: matches.length, code: by("code"), rerunOrdinal: by("rerun-ordinal"), character: by("character"), unmatched: by("none") };
}
