import { describe, expect, test } from "bun:test";
import { parseCharacterInfobox } from "./wikiclubs";

/** Trimmed from a real `bluearchive.wiki` character page. */
const ARU = `{{Character
| Id = 10000
| DevName = Aru_default
| Wikiname = Aru
| School = Gehenna
| Club = Problem Solver 68
| Age = 16
}}

'''Rikuhachima Aru''' is a second-year student.`;

describe("parseCharacterInfobox", () => {
  test("reads the student id and the official club name", () => {
    expect(parseCharacterInfobox(ARU)).toEqual({
      id: 10000,
      club: "Problem Solver 68",
    });
  });

  test("returns null without a Character infobox", () => {
    expect(parseCharacterInfobox("'''Aru''' is a student.")).toBeNull();
    expect(parseCharacterInfobox("")).toBeNull();
  });

  test("ignores fields belonging to other templates", () => {
    // A navbox further down the page can carry its own `Club` field; only the
    // leading `{{Character` block counts.
    const text = `${ARU}\n{{CharacterVariants|Aru}}\n| Club = Not A Club\n`;
    expect(parseCharacterInfobox(text)?.club).toBe("Problem Solver 68");
  });

  test("normalises the 'no club' sentinel to an empty name", () => {
    const text = "{{Character\n| Id = 26001\n| Club = no club\n}}";
    expect(parseCharacterInfobox(text)).toEqual({ id: 26001, club: "" });
  });

  test("treats a missing club as empty rather than a raw field", () => {
    expect(parseCharacterInfobox("{{Character\n| Id = 10000\n}}")).toEqual({
      id: 10000,
      club: "",
    });
  });

  test("rejects a page with no usable id", () => {
    expect(parseCharacterInfobox("{{Character\n| Club = Veritas\n}}")).toBeNull();
    expect(
      parseCharacterInfobox("{{Character\n| Id = not-a-number\n| Club = Veritas\n}}"),
    ).toBeNull();
  });
});
