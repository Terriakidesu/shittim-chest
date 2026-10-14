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
      const ch = this.byKey.get(normalizeCharName(part));
      if (ch && !ids.includes(ch.id)) ids.push(ch.id);
    }
    return ids;
  }

  getAll(): Character[] {
    return [...this.byIdMap.values()];
  }
}