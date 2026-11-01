import { expect, test } from "bun:test";
import { timelineIdleAnimation, timelineTalkIdleStart, timelineTalkInProgress } from "./spineTimeline";

test("idle playback selects Idle_XX, never the opening or talk animation", () => {
  expect(timelineIdleAnimation({ idleAnimation: "Idle_01", animations: ["Start_Idle_01", "Idle_01", "Talk_01_M"] })).toBe("Idle_01");
  expect(timelineIdleAnimation({ idleAnimation: null, animations: ["Start_Idle_01", "Idle_02"] })).toBe("Idle_02");
  expect(timelineIdleAnimation({ idleAnimation: null, animations: ["Start_Idle_01"] })).toBe("");
});
import { advanceSpineTimeline, normalizeSpineTimeline, timelineActiveAnimationClip, timelineActiveSubtitleTexts, timelineAnimationNeedsIdleUnderlay, timelineAudioPlaybackDecision, timelineAudioPreloadsReady, timelineForSequence, timelineLayerAnimation, timelineLayerPlaybackEnd, timelineLayerSampleTime, timelineMainAnimation, timelinePlaybackDuration, timelineSceneHidesCharacter, timelineSequenceIds, timelineTalkSequenceIds, type SpineTimeline, type SpineTimelineLayer } from "./spineTimeline";

const character = { start: 1, animationOffset: 0.25, loop: false, role: "character" as const };

const meta = {
  animations: ["Idle", "Talk_01_M", "Intro", "Start_Idle", "Scene", "Start_Idle_2"],
  introAnimation: "Intro",
  idleAnimation: "Idle",
};

test("Aru's shortened talk layer does not truncate its body animation before the idle tail", () => {
  expect(timelineTalkIdleStart(layer({ start: 0, end: 15.1 }), 15.333)).toBe(15.333);
  expect(timelineTalkIdleStart(layer({ start: 0, end: 16 }), 15.333)).toBe(16);
});

test("authored talks remain in progress until the idle tail starts", () => {
  expect(timelineTalkInProgress("talk-1", "none")).toBe(true);
  expect(timelineTalkInProgress("talk-1", "persistent")).toBe(false);
  expect(timelineTalkInProgress("opening", "none")).toBe(false);
});

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

test("authored talk sequences are ordered numerically for autoplay", () => {
  const project = {
    timeline: { sequenceId: "talk-10" } as SpineTimeline,
    sequences: { "talk-2": {} as SpineTimeline, "talk-1": {} as SpineTimeline, legacy: {} as SpineTimeline },
  };
  expect(timelineTalkSequenceIds(project)).toEqual(["talk-1", "talk-2", "talk-10"]);
});

test("talk playback includes a saved layer that extends the nominal duration", () => {
  const timeline: SpineTimeline = { sequenceId: "talk-1", openingMode: "direct", sceneDuration: 3, openingIdleDuration: 3, durationMode: "manual", duration: 4, loop: false, layers: [{ id: "layer", name: "Airi", role: "character", directory: "Airi_home", enabled: true, animation: "Talk_01_M", start: 0, end: 6, animationOffset: 0, loop: false, x: 0, y: 0, scale: 1, opacity: 1, order: 1 }], subtitles: [], audio: [], language: "en" };
  expect(timelinePlaybackDuration(timeline)).toBe(6);
  expect(timelinePlaybackDuration(timeline, 0, undefined, 0.4)).toBe(6.4);
});

test("saved subtitle and audio endpoints keep a composition alive", () => {
  const timeline: SpineTimeline = { sequenceId: "opening", openingMode: "direct", sceneDuration: 3, openingIdleDuration: 3, durationMode: "manual", duration: 4, loop: false, layers: [], subtitles: [{ id: "cue", start: 9, end: 11, enabled: true, text: { en: "Late", ja: "", ko: "" } }], audio: [{ id: "audio", name: "voice.ogg", path: "voice.ogg", start: 9, end: 12, enabled: true, volume: 1 }], language: "en" };
  expect(timelinePlaybackDuration(timeline)).toBe(12);
});

test("automatic openings trim stale blank time after their last layer", () => {
  const timeline: SpineTimeline = {
    sequenceId: "opening",
    openingMode: "scene-first",
    sceneDuration: 4.6,
    openingIdleDuration: 3,
    durationMode: "auto",
    duration: 19.266,
    loop: false,
    layers: [
      { ...layer({ role: "character", start: 4.6, end: 17.8, endMode: "manual" }) },
      { ...layer({ role: "scene", start: 0, end: 4.7, endMode: "manual" }) },
    ],
    subtitles: [{ id: "cue", start: 9, end: 12.9, enabled: true, text: { en: "Hello", ja: "", ko: "" } }],
    audio: [],
    language: "en",
  };
  expect(timelinePlaybackDuration(timeline, 16.267)).toBe(17.8);
});

test("shared timeline clock advances and completes the same way for editor and viewer", () => {
  expect(advanceSpineTimeline(1, 0.5, 2, 3, false)).toEqual({ time: 2, finished: false });
  expect(advanceSpineTimeline(2.75, 0.3, 1, 3, false)).toEqual({ time: 3, finished: true });
  expect(advanceSpineTimeline(2.75, 0.5, 1, 3, true)).toEqual({ time: 0.25, finished: false });
});

test("background layers follow the main animation by name and clock", () => {
  const background = layer({ role: "background", animation: "Fallback", followMainAnimation: true, directory: "Layer_bg" });
  expect(timelineLayerAnimation(background, meta, "talk_01_m", 2, "talk-1", "direct", 0)).toBe("Talk_01_M");
  expect(timelineMainAnimation(layer({ animation: "Talk_01_M" }), meta, 2, "talk-1", "direct", 0, 3)).toMatchObject({ animation: "Talk_01_M", time: 2, loop: false });
  const clipMain = layer({ animationClips: [
    { id: "main", animation: "Start_Idle_2", start: 2, end: 3, animationOffset: 0.1, loop: false },
  ] });
  const clipBackground = layer({ role: "background", directory: "Layer_bg", followMainAnimation: true, animationClips: [
    { id: "bg", animation: "Idle", start: 0, end: 4, animationOffset: 0, loop: true },
  ] });
  const mainState = timelineMainAnimation(clipMain, meta, 2.5, "opening", "direct", 0, 1);
  expect(timelineLayerAnimation(clipBackground, meta, mainState.animation, 2.5, "opening", "direct", 0)).toBe("Start_Idle_2");
  expect(mainState.time).toBeCloseTo(0.6);
});

test("opening intro and post-intro clocks are shared by the main layer", () => {
  const opening = timelineMainAnimation(layer({ animation: "Idle" }), meta, 1, "opening", "direct", 2, 3);
  expect(opening).toMatchObject({ animation: "Intro", time: 1, useIntro: true });
  const idle = timelineMainAnimation(layer({ animation: "Idle" }), meta, 3, "opening", "direct", 2, 3);
  expect(idle).toMatchObject({ animation: "Idle", time: 1, useIntro: false });
});

test("clip-based openings resolve a CH0184-style sequence and continue its final idle", () => {
  const clips = [
    { id: "start-idle", animation: "Start_Idle", start: 0, end: 1, animationOffset: 0, loop: false },
    { id: "scene", animation: "Scene", start: 1, end: 2, animationOffset: 0, loop: false },
    { id: "start-idle-2", animation: "Start_Idle_2", start: 2, end: 3, animationOffset: 0, loop: false },
    { id: "idle", animation: "Idle", start: 3, end: 4, animationOffset: 0, loop: true, continueAfterOpening: true },
  ];
  const main = layer({ animationClips: clips });
  expect([0.5, 1.5, 2.5, 3.5].map((time) => timelineLayerAnimation(main, meta, undefined, time, "opening", "direct", 0))).toEqual([
    "Start_Idle", "Scene", "Start_Idle_2", "Idle",
  ]);
  expect(timelineActiveAnimationClip(main, meta, 2.5, "opening", "direct", 0)?.id).toBe("start-idle-2");
  expect(timelineMainAnimation(main, meta, 3.5, "opening", "direct", 0, 2)).toMatchObject({ animation: "Idle", time: 0.5, loop: true });
  expect(timelineMainAnimation(main, meta, 5.5, "opening", "direct", 0, 2, true)).toMatchObject({ animation: "Idle", time: 0.5, loop: true });
  expect(timelinePlaybackDuration({ sequenceId: "opening", durationMode: "auto", duration: 9, layers: [main], subtitles: [], audio: [] })).toBe(4);
});

test("legacy opening layers synthesize their previous intro-to-idle timing", () => {
  const oldLayer = layer({ start: 1, end: 5, animation: "Idle", animationOffset: 0.25, loop: true });
  expect(timelineLayerAnimation(oldLayer, meta, undefined, 2, "opening", "direct", 2)).toBe("Intro");
  expect(timelineLayerAnimation(oldLayer, meta, undefined, 3.5, "opening", "direct", 2)).toBe("Idle");
  expect(timelineActiveAnimationClip(oldLayer, meta, 3.5, "opening", "direct", 2)).toMatchObject({ start: 3, end: 5, animationOffset: 0.25, continueAfterOpening: true });
});

test("scene clips explicitly hide the character only while active", () => {
  const scene = layer({
    role: "scene",
    animationClips: [{ id: "scene", animation: "Scene", start: 1, end: 3, animationOffset: 0, loop: false, hideCharacter: true }],
  });
  expect(timelineSceneHidesCharacter({ layers: [scene] }, 2)).toBe(true);
  expect(timelineSceneHidesCharacter({ layers: [scene] }, 3)).toBe(false);
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

test("timeline playback waits for enabled audio preloads but tolerates missing clips", () => {
  const clips = [
    { id: "ready", enabled: true },
    { id: "missing", enabled: true },
    { id: "disabled", enabled: false },
  ];
  expect(timelineAudioPreloadsReady(clips, { ready: "ready", missing: "missing", disabled: "loading" })).toBe(true);
  expect(timelineAudioPreloadsReady(clips, { ready: "loading", missing: "missing", disabled: "loading" })).toBe(false);
  expect(timelineAudioPreloadsReady([], {})).toBe(true);
});

test("talk animation underlay behavior is shared by both previews", () => {
  expect(timelineAnimationNeedsIdleUnderlay("Talk_01_M")).toBe(true);
  expect(timelineAnimationNeedsIdleUnderlay("Idle")).toBe(false);
});
