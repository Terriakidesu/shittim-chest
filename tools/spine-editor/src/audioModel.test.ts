import { expect, test } from "bun:test";
import { audioPlaybackDecision, decodedAudioTiming } from "./audioModel";

test("decoded audio timing replaces the guessed block and expands the sequence", () => {
  expect(decodedAudioTiming(2, 4.25, 5)).toEqual({ end: 6.25, duration: 6.25 });
  expect(decodedAudioTiming(2, 0, 5)).toBeNull();
  expect(decodedAudioTiming(Number.NaN, 2, 5)).toBeNull();
});

test("ended audio does not restart until the playhead re-enters or rewinds", () => {
  expect(audioPlaybackDecision({ active: true, playing: true, currentTime: 4.1, previousTime: 4, started: true, ended: true })).toEqual({ seek: false, play: false, started: true });
  expect(audioPlaybackDecision({ active: true, playing: true, currentTime: 2, previousTime: 4, started: true, ended: true })).toEqual({ seek: true, play: true, started: true });
  expect(audioPlaybackDecision({ active: false, playing: true, currentTime: 1, previousTime: 1, started: true, ended: false })).toEqual({ seek: false, play: false, started: false });
});
