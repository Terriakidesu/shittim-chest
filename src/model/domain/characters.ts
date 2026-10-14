import type { Character } from "./types";

/**
 * Canonical character namespace shared by the wiki and SchaleDB.
 *
 * The wiki writes `Azusa (Swimsuit)`; SchaleDB writes `azusa_swimsuit`.
 * Normalising both to the same key makes the join exact.
 */
export function normalizeCharName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/＊/g, "*")
    .replace(/\*/g, "_")
    .replace(/[（(]/g, "_")
    .replace(/[）)]/g, "")
    .replace(/[\s·・]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/** Wiki rate-up fields pack multiple characters: `Kikyou (Swimsuit),Renge (Swimsuit)`. */
export function splitRateup(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(/[,、,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The wiki's display names use different variant words than SchaleDB's
 * canonical keys (`Neru (Bunny Girl)` vs `neru_bunnygirl`, `Yuuka
 * (Sportswear)` vs `yuuka_track`, `Arisu` vs `aris`). Without these, whole
 * banners resolve to zero characters: the calendar falls back to raw codes,
 * the detail shows no student profile, and the simulator's featured roster
 * breaks (no featured pulls, no spark exchange for that period).
 *
 * Aliases are a FALLBACK: exact SchaleDB keys always win, so a future
 * upstream rename silently takes precedence over this table.
 *
 * Deliberately absent: `shun_kid` (no SchaleDB counterpart — `shun_small`
 * is a different variant until proven otherwise) and `hoshino_battle`
 * (SchaleDB has two `hoshino_battle_*` rows; picking one would corrupt
 * pools). Both stay unresolved and are reported by the export script.
 */
const VARIANT_ALIASES: [RegExp, string][] = [
  [/_bunny_girl$/, "_bunnygirl"],
  [/_school_uniform$/, "_uniform"],
  [/_sportswear$/, "_track"],
  [/_camping$/, "_camp"],
  [/_riding$/, "_cycling"],
  [/^arisu(_|$)/, "aris$1"],
];

export function aliasKey(key: string): string | null {
  for (const [pattern, replacement] of VARIANT_ALIASES) {
    if (pattern.test(key)) return key.replace(pattern, replacement);
  }
  return null;
}

export class CharacterIndex {
  // Note: fields cannot share a name with methods, so the map is suffixed.
  private byIdMap = new Map<number, Character>();
  private byKey = new Map<string, Character>();

  constructor(chars: Iterable<Character> = []) {
    for (const ch of chars) {
      this.byIdMap.set(ch.id, ch);
      const key = normalizeCharName(ch.pathName);
      if (key) this.byKey.set(key, ch);
      // Also index the plain display name, which occasionally differs.
      const nameKey = normalizeCharName(ch.nameEn);
      if (nameKey && !this.byKey.has(nameKey)) this.byKey.set(nameKey, ch);
    }
  }

  get size() {
    return this.byIdMap.size;
  }

  byId(id: number): Character | undefined {
    return this.byIdMap.get(id);
  }

  resolve(raw: string | null): number[] {
    const ids: number[] = [];
    for (const part of splitRateup(raw)) {
      const ch =
        this.byKey.get(normalizeCharName(part)) ??
        this.resolveAlias(part);
      if (ch && !ids.includes(ch.id)) ids.push(ch.id);
    }
    return ids;
  }

  /** True when a rate-up name links to a known student, exactly or by alias. */
  has(raw: string): boolean {
    const key = normalizeCharName(raw);
    if (this.byKey.has(key)) return true;
    const alias = aliasKey(key);
    return alias != null && this.byKey.has(alias);
  }

  private resolveAlias(part: string) {
    const alias = aliasKey(normalizeCharName(part));
    return alias ? this.byKey.get(alias) : undefined;
  }

  getAll(): Character[] {
    return [...this.byIdMap.values()];
  }
}