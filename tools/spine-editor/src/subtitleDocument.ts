import type { EditorTimeline } from "./editorModel";

/** Apply all timeline cues for one character back onto an imported subtitle document. */
export function applyTimelinesToSubtitleDocument(
  document: Record<string, unknown>,
  directory: string,
  timelines: readonly EditorTimeline[],
): Record<string, unknown> {
  const next = structuredClone(document) as Record<string, unknown>;
  const character = Array.isArray(next.characters)
    ? next.characters.find((item) => item && typeof item === "object" && (item as Record<string, unknown>).directory === directory) as Record<string, unknown> | undefined
    : next;
  const lines = character && Array.isArray(character.lines) ? character.lines as Record<string, unknown>[] : [];
  for (const line of lines) {
    const lineId = String(line.id ?? "");
    const cues = timelines.flatMap((item) => item.subtitles.filter((cue) => cue.lineId === lineId)).sort((a, b) => a.start - b.start);
    if (!cues.length) continue;
    const parts = Array.isArray(line.parts)
      ? line.parts.filter((part): part is Record<string, unknown> => Boolean(part && typeof part === "object"))
      : [];
    if (parts.length) {
      for (const [index, cue] of cues.entries()) {
        const part = parts[index];
        if (!part) continue;
        part.subtitle = { ...cue.text };
        part.start = cue.start;
        part.end = cue.end;
      }
    } else {
      line.subtitle = { ...cues[0]!.text };
    }
    line.markers = cues.map((cue) => cue.start);
  }
  return next;
}

export function serializeSubtitleDocument(
  document: Record<string, unknown>,
  directory: string,
  timelines: readonly EditorTimeline[],
): string {
  return `${JSON.stringify(applyTimelinesToSubtitleDocument(document, directory, timelines), null, 2)}\n`;
}
