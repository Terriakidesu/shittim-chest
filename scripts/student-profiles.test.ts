import { expect, test } from "bun:test";
import { parseRecruitmentDialogue, parseStudentProfile, plainWikiText } from "./student-profiles";
import { RECRUITMENT_TRANSLATIONS } from "./recruitment-translations";

test("missing English falls back to reviewed Japanese translation, preferring upstream English", () => {
  for (const [source, translated] of Object.entries(RECRUITMENT_TRANSLATIONS)) {
    const row = `|-\n| Gachaget\n| [[File:voice.ogg]]\n| lang="ja" | <p>${source}</p>\n| `;
    expect(parseRecruitmentDialogue(row)).toBe(translated);
    expect(parseRecruitmentDialogue(row + "<p>Official English.</p>")).toBe("Official English.");
  }
});

test("profile fields use combat class, not the separate damage/healer role", () => {
  const parsed = parseStudentProfile("{{Character\n| Id = 26003\n| CombatClass = Special\n| Role = Healer\n| WeaponType = AR\n| Birthday = January 6\n| LobbyIllustrator = \n| Voice = Suzumoto Akiho\n}}");
  expect(parsed?.id).toBe(26003);
  expect(parsed?.profile).toEqual({ tacticalRole: "Special", weaponType: "AR", birthday: "January 6", voiceActor: "Suzumoto Akiho", recruitmentDialogue: "" });
  expect(parseStudentProfile("{{Character\n| Id = nope\n}}")).toBeNull();
});

test("extracts only the English recruitment line and decodes wiki markup", () => {
  const audio = '|-\n| Gachaget\n| [[File:Serina_Gachaget.ogg]]\n| lang="ja" | <p>こんにちは</p>\n| <p>Is anyone in need of first aid?<br>I would be happy to help.</p>\n|-\n| Lobby_1\n| [[File:lobby.ogg]]\n| lang="ja" | <p>こんにちは</p>\n| <p>Not recruitment</p>\n|-\n';
  expect(parseRecruitmentDialogue(audio)).toBe("Is anyone in need of first aid? I would be happy to help.");
  expect(parseRecruitmentDialogue(audio.replace("<p>Is anyone in need of first aid?<br>I would be happy to help.</p>", ""))).toBe("");
  expect(parseRecruitmentDialogue(audio.replace("<p>Is anyone in need of first aid?<br>I would be happy to help.</p>", "Plain English. Ni・Ha・Ha・Ha!!"))).toBe("Plain English. Ni・Ha・Ha・Ha!!");
  expect(plainWikiText("<p>Sensei&#8212;er, &quot;my lord&quot;! [[Izuna|Nin nin]]!</p>")).toBe('Sensei—er, "my lord"! Nin nin!');
});

test("joins split Gachaget lines without substituting missing translations", () => {
  const row = (key: string, text: string) => `|-\n| ${key}\n| [[File:voice.ogg]]\n| lang="ja" | <p>こんにちは</p>\n| <p>${text}</p>\n`;
  expect(parseRecruitmentDialogue(row("Gachaget_1", "Hello!") + row("Gachaget_2", "I'm here."))).toBe("Hello! I'm here.");
  expect(parseRecruitmentDialogue(row("Gachaget", "{{Translation needed}}"))).toBe("");
  expect(parseRecruitmentDialogue(row("Gachaget", "こんにちは"))).toBe("");
});
