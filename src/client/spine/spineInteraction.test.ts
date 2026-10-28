import { describe, expect, test } from "bun:test";
import { findInteractionProfile } from "./spineInteraction";

describe("Spine lobby interaction data", () => {
  test("pairs the game M/A tracks and their pat release", () => {
    const profile = findInteractionProfile([
      "Idle_01", "Pat_01_M", "Pat_01_A", "PatEnd_01_M", "PatEnd_01_A",
      "Look_01_M", "LookEnd_01_M", "LookEnd_01_A", "Talk_02_M", "Talk_02_A", "Talk_01_M", "Talk_01_A",
    ]);
    expect(profile.pat).toEqual({
      hold: { main: "Pat_01_M", face: "Pat_01_A" },
      release: { main: "PatEnd_01_M", face: "PatEnd_01_A" },
    });
    expect(profile.look).toEqual({
      start: { main: "Look_01_M", face: null },
      end: { main: "LookEnd_01_M", face: "LookEnd_01_A" },
    });
    expect(profile.talks).toEqual([
      { main: "Talk_01_M", face: "Talk_01_A" },
      { main: "Talk_02_M", face: "Talk_02_A" },
    ]);
  });

  test("falls back to Touch and Pat2 naming used by newer home sets", () => {
    const profile = findInteractionProfile(["Touch_01_M", "TouchEnd_01_M", "Pat2_01_M", "Pat2End_01_M", "Pat2_02_M"]);
    expect(profile.pat?.hold.main).toBe("Pat2_01_M");
    expect(profile.pat?.release?.main).toBe("Pat2End_01_M");
  });

  test("ignores developer and nested duplicate talk tracks when root tracks exist", () => {
    const profile = findInteractionProfile(["Dev/Talk_01_M", "Dev/Talk_01_A", "Talk_01_M", "Talk_01_A", "talk2/Talk_01_M"]);
    expect(profile.talks).toEqual([{ main: "Talk_01_M", face: "Talk_01_A" }]);
  });
});
