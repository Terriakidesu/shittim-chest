import { expect, test } from "bun:test";
import { createProject } from "./editorModel";
import { serializeSubtitleDocument } from "./subtitleDocument";

test("subtitle direct-save serialization updates matching parts without mutating the imported document", () => {
  const document = {
    characters: [{
      directory: "Airi_home",
      lines: [{
        id: "talk-1",
        parts: [{ subtitle: { en: "Old one" }, start: 0, end: 1 }, { subtitle: { en: "Old two" }, start: 1, end: 2 }],
      }, { id: "untouched", subtitle: { en: "Keep me" } }],
    }],
  };
  const first = createProject("Airi_home", [], []).timeline;
  first.subtitles = [
    { id: "cue-1", lineId: "talk-1", start: 0.25, end: 1.5, enabled: true, text: { en: "New one", ja: "新しい一", ko: "새 하나" } },
    { id: "cue-2", lineId: "talk-1", start: 1.6, end: 3.25, enabled: true, text: { en: "New two", ja: "新しい二", ko: "새 둘" } },
  ];
  const second = createProject("Airi_home", [], []).timeline;
  second.subtitles = [{ id: "cue-3", lineId: "untouched", start: 4, end: 5, enabled: true, text: { en: "Moved", ja: "", ko: "" } }];

  const saved = JSON.parse(serializeSubtitleDocument(document, "Airi_home", [first, second])) as {
    characters: Array<{ lines: Array<{ parts?: Array<Record<string, unknown>>; subtitle?: Record<string, string>; markers?: number[] }> }>;
  };
  const parts = saved.characters[0]!.lines[0]!.parts!;
  expect(parts[0]).toMatchObject({ start: 0.25, end: 1.5, subtitle: { en: "New one", ja: "新しい一", ko: "새 하나" } });
  expect(parts[1]).toMatchObject({ start: 1.6, end: 3.25, subtitle: { en: "New two", ja: "新しい二", ko: "새 둘" } });
  expect(saved.characters[0]!.lines[0]!.markers).toEqual([0.25, 1.6]);
  expect(saved.characters[0]!.lines[1]!.subtitle).toMatchObject({ en: "Moved" });
  expect(document.characters[0]!.lines[0]!.parts![0]!.subtitle).toEqual({ en: "Old one" });
});
