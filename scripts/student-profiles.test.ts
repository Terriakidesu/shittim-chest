import { expect, test } from "bun:test";
import { parseGachaDialogue, parseStudentProfile, plainWikiText } from "./student-profiles";
import { RECRUITMENT_TRANSLATIONS } from "./recruitment-translations";

test("missing English falls back to reviewed Japanese translation, preferring upstream English", () => {
  for (const [source, translated] of Object.entries(RECRUITMENT_TRANSLATIONS)) {
    const row = `|-\n| Gachaget\n| [[File:voice.ogg]]\n| lang="ja" | <p>${source}</p>\n| `;
    expect(parseGachaDialogue(row).en).toBe(translated);
    // The Japanese cell text is preserved verbatim (tags stripped).
    expect(parseGachaDialogue(row).ja).toBe(plainWikiText(`<p>${source}</p>`));
    expect(parseGachaDialogue(row + "<p>Official English.</p>").en).toBe("Official English.");
  }
});

test("profile fields use combat class, not the separate damage/healer role", () => {
  const parsed = parseStudentProfile("{{Character\n| Id = 26003\n| CombatClass = Special\n| Role = Healer\n| WeaponType = AR\n| Birthday = January 6\n| LobbyIllustrator = \n| Voice = Suzumoto Akiho\n}}");
  expect(parsed?.id).toBe(26003);
  expect(parsed?.profile).toEqual({
    tacticalRole: "Special",
    weaponType: "AR",
    birthday: "January 6",
    voiceActor: "Suzumoto Akiho",
    recruitmentDialogue: "",
  });
  expect(parseStudentProfile("{{Character\n| Id = nope\n}}")).toBeNull();
});

test("extracts the English and Japanese recruitment lines and decodes wiki markup", () => {
  const audio = '|-\n| Gachaget\n| [[File:Serina_Gachaget.ogg]]\n| lang="ja" | <p>こんにちは。応急処置は・お任せ・ください</p>\n| <p>Is anyone in need of first aid?<br>I would be happy to help.</p>\n|-\n| Lobby_1\n| [[File:lobby.ogg]]\n| lang="ja" | <p>こんにちは</p>\n| <p>Not recruitment</p>\n|-\n';
  const dialogue = parseGachaDialogue(audio);
  expect(dialogue.en).toBe("Is anyone in need of first aid? I would be happy to help.");
  expect(dialogue.ja).toBe("こんにちは。応急処置は・お任せ・ください");
  expect(parseGachaDialogue(audio.replace("<p>Is anyone in need of first aid?<br>I would be happy to help.</p>", "")).en).toBe("");
  expect(parseGachaDialogue(audio.replace("<p>こんにちは。応急処置は・お任せ・ください</p>", "")).ja).toBe("");
});

test("joins split Gachaget lines without substituting missing translations", () => {
  const row = (key: string, text: string) => `|-\n| ${key}\n| [[File:voice.ogg]]\n| lang="ja" | <p>こんにちは</p>\n| <p>${text}</p>\n`;
  const joined = parseGachaDialogue(row("Gachaget_1", "Hello!") + row("Gachaget_2", "I'm here."));
  expect(joined.en).toBe("Hello! I'm here.");
  expect(joined.ja).toBe("こんにちは こんにちは");
  // A translation-needed row still yields its Japanese source, but no English.
  const untranslated = parseGachaDialogue(row("Gachaget", "{{Translation needed}}"));
  expect(untranslated.en).toBe("");
  expect(untranslated.ja).toBe("こんにちは");
  // Japanese-only text in the English slot never leaks into the English line.
  expect(parseGachaDialogue(row("Gachaget", "こんにちは")).en).toBe("");
});
