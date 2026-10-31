import { expect, test } from "bun:test";
import { timelineForSequence, timelineLayerSampleTime, timelineSequenceIds, type SpineTimeline } from "./spineTimeline";

const character = { start: 1, animationOffset: 0.25, loop: false, role: "character" as const };

test("opening character samples idle time after the intro, matching editor timing", () => {
  expect(timelineLayerSampleTime(character, 1.5, "opening", "direct", 2, 3)).toBe(0.5);
  expect(timelineLayerSampleTime(character, 4, "opening", "direct", 2, 3)).toBe(1.25);
});

test("talk and looping layers use their saved offsets and animation clocks", () => {
  expect(timelineLayerSampleTime({ ...character, loop: true }, 4, "talk-1", "direct", 0, 3)).toBeCloseTo(0.25);
  expect(timelineLayerSampleTime({ ...character, role: "scene", loop: false }, 4, "opening", "direct", 2, 3)).toBe(3);
});

test("sequence helpers preserve the active timeline and stored sequence copies", () => {
  const active: SpineTimeline = { sequenceId: "talk-1", openingMode: "direct", sceneDuration: 3, openingIdleDuration: 3, durationMode: "manual", duration: 4, loop: false, layers: [], subtitles: [], audio: [], language: "en" };
  const opening: SpineTimeline = { ...active, sequenceId: "opening", duration: 8 };
  const project = { timeline: active, sequences: { opening } };
  expect(timelineSequenceIds(project)).toEqual(["talk-1", "opening"]);
  expect(timelineForSequence(project, "talk-1")).toBe(active);
  expect(timelineForSequence(project, "opening")).toBe(opening);
});
