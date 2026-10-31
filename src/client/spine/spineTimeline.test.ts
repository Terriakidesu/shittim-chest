import { expect, test } from "bun:test";
import { normalizeSpineTimeline, timelineActiveSubtitleTexts, timelineAnimationNeedsIdleUnderlay, timelineAudioPlaybackDecision, timelineForSequence, timelineLayerAnimation, timelineLayerPlaybackEnd, timelineLayerSampleTime, timelineMainAnimation, timelinePlaybackDuration, timelineSequenceIds, type SpineTimeline, type SpineTimelineLayer } from "./spineTimeline";

const character = { start: 1, animationOffset: 0.25, loop: false, role: "character" as const };

const meta = {
  animations: ["Idle", "Talk_01_M", "Intro"],
  introAnimation: "Intro",
  idleAnimation: "Idle",
};

function layer(overrides: Partial<SpineTimelineLayer> = {}): SpineTimelineLayer {
  return {
    id: "layer",
    name: "Layer",
    role: "character",
    directory: "Layer_home",
    enabled: true,
    animation: "Idle",
    start: 0,
    end: 4,
    animationOffset: 0,
    loop: true,
    x: 0,
    y: 0,
    scale: 1,
    opacity: 1,
    order: 1,
    ...overrides,
  };
}

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

test("talk playback includes a saved layer that extends the nominal duration", () => {
  const timeline: SpineTimeline = { sequenceId: "talk-1", openingMode: "direct", sceneDuration: 3, openingIdleDuration: 3, durationMode: "manual", duration: 4, loop: false, layers: [{ id: "layer", name: "Airi", role: "character", directory: "Airi_home", enabled: true, animation: "Talk_01_M", start: 0, end: 6, animationOffset: 0, loop: false, x: 0, y: 0, scale: 1, opacity: 1, order: 1 }], subtitles: [], audio: [], language: "en" };
  expect(timelinePlaybackDuration(timeline)).toBe(6);
});

test("saved subtitle and audio endpoints keep a composition alive", () => {
  const timeline: SpineTimeline = { sequenceId: "opening", openingMode: "direct", sceneDuration: 3, openingIdleDuration: 3, durationMode: "manual", duration: 4, loop: false, layers: [], subtitles: [{ id: "cue", start: 9, end: 11, enabled: true, text: { en: "Late", ja: "", ko: "" } }], audio: [{ id: "audio", name: "voice.ogg", path: "voice.ogg", start: 9, end: 12, enabled: true, volume: 1 }], language: "en" };
  expect(timelinePlaybackDuration(timeline)).toBe(12);
});

test("background layers follow the main animation by name and clock", () => {
  const background = layer({ role: "background", animation: "Fallback", followMainAnimation: true, directory: "Layer_bg" });
  expect(timelineLayerAnimation(background, meta, "talk_01_m", 2, "talk-1", "direct", 0)).toBe("Talk_01_M");
  expect(timelineMainAnimation(layer({ animation: "Talk_01_M" }), meta, 2, "talk-1", "direct", 0, 3)).toMatchObject({ animation: "Talk_01_M", time: 2, loop: false });
});

test("opening intro and post-intro clocks are shared by the main layer", () => {
  const opening = timelineMainAnimation(layer({ animation: "Idle" }), meta, 1, "opening", "direct", 2, 3);
  expect(opening).toMatchObject({ animation: "Intro", time: 1, useIntro: true });
  const idle = timelineMainAnimation(layer({ animation: "Idle" }), meta, 3, "opening", "direct", 2, 3);
  expect(idle).toMatchObject({ animation: "Idle", time: 1, useIntro: false });
});

test("non-looping layer endpoints use the authored animation offset", () => {
  expect(timelineLayerPlaybackEnd(layer({ loop: false, animationOffset: 0.5 }), 3)).toBe(2.5);
  expect(timelineLayerPlaybackEnd(layer({ loop: true, end: 9 }), 3)).toBe(9);
});

test("subtitle fallback returns every simultaneous active cue", () => {
  const timeline: Pick<SpineTimeline, "subtitles" | "language"> = {
    language: "ja",
    subtitles: [
      { id: "one", start: 1, end: 3, enabled: true, text: { en: "One", ja: "", ko: "" } },
      { id: "two", start: 2, end: 4, enabled: true, text: { en: "Two", ja: "二", ko: "" } },
      { id: "off", start: 1, end: 4, enabled: false, text: { en: "Off", ja: "", ko: "" } },
    ],
  };
  expect(timelineActiveSubtitleTexts(timeline, 2)).toEqual(["One", "二"]);
});

test("legacy background layers opt into main animation following", () => {
  const normalized = normalizeSpineTimeline({ duration: 4, layers: [{ directory: "Scene_bg", role: "background" }] });
  expect(normalized?.layers[0]?.followMainAnimation).toBe(true);
  const explicit = normalizeSpineTimeline({ duration: 4, layers: [{ directory: "Scene_bg", role: "background", followMainAnimation: false }] });
  expect(explicit?.layers[0]?.followMainAnimation).toBe(false);
});

test("timeline audio playback only seeks when entering or rewinding", () => {
  expect(timelineAudioPlaybackDecision({ active: true, playing: true, currentTime: 2, previousTime: 1.9, started: true, ended: false })).toEqual({ seek: false, play: true, started: true });
  expect(timelineAudioPlaybackDecision({ active: true, playing: true, currentTime: 1, previousTime: 2, started: true, ended: true })).toEqual({ seek: true, play: true, started: true });
  expect(timelineAudioPlaybackDecision({ active: false, playing: true, currentTime: 3, previousTime: 2, started: true, ended: false })).toEqual({ seek: false, play: false, started: false });
});

test("talk animation underlay behavior is shared by both previews", () => {
  expect(timelineAnimationNeedsIdleUnderlay("Talk_01_M")).toBe(true);
  expect(timelineAnimationNeedsIdleUnderlay("Idle")).toBe(false);
});
