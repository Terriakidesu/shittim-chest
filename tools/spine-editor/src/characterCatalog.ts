export type CharacterDirectoryLabels = Readonly<Record<string, string>>;

interface CharacterVariantRecord {
  variant?: unknown;
  directory?: unknown;
  assetId?: unknown;
}

interface CharacterExtraRecord {
  type?: unknown;
  directory?: unknown;
}

interface CharacterRecord {
  variants?: unknown;
  extras?: unknown;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function prettyExtraType(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** Build display names for asset directories from a ba-spine character catalog. */
export function parseCharacterDirectoryLabels(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const root = value as { characters?: unknown };
  if (!root.characters || typeof root.characters !== "object" || Array.isArray(root.characters)) return {};

  const labels: Record<string, string> = {};
  for (const [name, rawCharacter] of Object.entries(root.characters as Record<string, unknown>)) {
    if (!rawCharacter || typeof rawCharacter !== "object" || Array.isArray(rawCharacter)) continue;
    const character = rawCharacter as CharacterRecord;
    if (Array.isArray(character.variants)) {
      for (const rawVariant of character.variants) {
        if (!rawVariant || typeof rawVariant !== "object" || Array.isArray(rawVariant)) continue;
        const variant = rawVariant as CharacterVariantRecord;
        const directory = text(variant.directory);
        if (!directory) continue;
        const assetId = text(variant.assetId);
        const variantName = text(variant.variant);
        labels[directory] = `${name}${variantName && variantName !== "Base" ? ` ${variantName}` : ""}${assetId ? ` (${assetId})` : ""}`;
      }
    }
    if (Array.isArray(character.extras)) {
      for (const rawExtra of character.extras) {
        if (!rawExtra || typeof rawExtra !== "object" || Array.isArray(rawExtra)) continue;
        const extra = rawExtra as CharacterExtraRecord;
        const directory = text(extra.directory);
        if (!directory) continue;
        const type = text(extra.type);
        labels[directory] = type ? `${name} ${prettyExtraType(type)}` : name;
      }
    }
  }
  return labels;
}

export function characterDirectoryLabel(directory: string, labels: CharacterDirectoryLabels): string {
  return labels[directory] ?? directory;
}
