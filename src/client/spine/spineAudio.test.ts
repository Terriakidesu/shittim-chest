import { expect, test } from "bun:test";
import { spineAudioPathCandidates } from "./spineAudio";

test("audio path candidates are shared across browser and desktop sources", () => {
  expect(spineAudioPathCandidates("./audios\\voicelines\\Aru\\line.ogg")).toEqual([
    "audios/voicelines/Aru/line.ogg",
    "Aru/line.ogg",
    "voicelines/Aru/line.ogg",
    "line.ogg",
  ]);
});
