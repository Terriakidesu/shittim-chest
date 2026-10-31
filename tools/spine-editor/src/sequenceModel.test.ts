import { expect, test } from "bun:test";
import { createProject, normalizeProject } from "./editorModel";
import { animationEndForLayer, authoredTimelineEnd, extendTimelineDuration, moveAudioClip, openingPhaseTimings, snapToTargets, splitCue, switchSequence, talkSequenceDuration, talkSequenceId } from "./sequenceModel";

test("talk sequences pair body and face and isolate subtitle clocks", () => {
  const animations = ["Idle_01", "Talk_01_M", "Talk_01_A", "Talk_02_M", "Talk_02_A"];
  let project = switchSequence(createProject("Airi_home", animations, []), "talk-1", animations, []);
  project.timeline.subtitles.push({ id: "one", start: 1, end: 3, enabled: true, text: { en: "First talk", ja: "", ko: "" } });
  expect(project.timeline.layers[0]?.faceAnimation).toBe("Talk_01_A");
  project = switchSequence(project, "talk-2", animations, []);
  expect(project.timeline.subtitles).toEqual([]);
  expect(project.timeline.layers[0]?.animation).toBe("Talk_02_M");
  project = switchSequence(project, "talk-1", animations, []);
  expect(project.timeline.subtitles[0]?.text.en).toBe("First talk");
  const restored = normalizeProject(JSON.parse(JSON.stringify(project)), "Airi_home")!;
  expect(restored.timeline.sequenceId).toBe("talk-1");
  expect(restored.sequences?.["talk-2"]?.layers[0]?.faceAnimation).toBe("Talk_02_A");
});

test("reselecting a talk sequence keeps its current imported edits", () => {
  const animations = ["Idle_01", "Talk_01_M", "Talk_01_A"];
  let project = switchSequence(createProject("Airi_home", animations, []), "talk-1", animations, []);
  project.timeline.subtitles = [{ id: "latest", lineId: "talk-1", start: 0, end: 2, enabled: true, text: { en: "Latest", ja: "", ko: "" } }];
  project.timeline.audio = [{ id: "long-audio", lineId: "talk-1", name: "voice.ogg", path: "voice.ogg", start: 0, end: 20, enabled: true, volume: 1 }];
  project = switchSequence(project, "talk-1", animations, []);
  expect(project.timeline.subtitles[0]?.text.en).toBe("Latest");
  expect(project.timeline.audio[0]?.end).toBe(20);
  expect(project.timeline.layers[0]?.loop).toBe(false);
});

test("each sequence preserves intentional layer deletions while new sequences initialize discovered layers", () => {
  const directories = ["Momoi_home", "Momoi_scene"];
  let project = switchSequence(createProject("Momoi_home", [], []), "opening", [], directories);
  project = switchSequence(project, "talk-1", [], directories);
  const scene = project.timeline.layers.find((layer) => layer.role === "scene");
  expect(scene).toBeDefined();
  project = {
    ...project,
    timeline: {
      ...project.timeline,
      layers: project.timeline.layers.filter((layer) => layer.id !== scene?.id),
    },
  };

  project = switchSequence(project, "talk-2", [], directories);
  expect(project.timeline.layers.some((layer) => layer.role === "scene")).toBe(true);
  project = switchSequence(project, "talk-1", [], directories);
  expect(project.timeline.layers.some((layer) => layer.role === "scene")).toBe(false);
  const reloaded = normalizeProject(JSON.parse(JSON.stringify(project)), "Momoi_home")!;
  expect(reloaded.timeline.layersInitialized).toBe(true);
  expect(reloaded.timeline.layers.some((layer) => layer.role === "scene")).toBe(false);
});

test("opening choices persist and old compositions remain recoverable", () => {
  const old = createProject("Akari_home", [], []);
  old.timeline.duration = 33;
  let project = switchSequence(old, "opening", [], ["Akari_home", "akari_bg", "akari_scene"]);
  project.timeline.openingMode = "scene-first";
  project.timeline.sceneDuration = 4;
  project = switchSequence(project, "talk-1", [], []);
  project = switchSequence(project, "opening", [], []);
  expect(project.timeline.openingMode).toBe("scene-first");
  expect(project.timeline.sceneDuration).toBe(4);
  expect(project.sequences?.legacy?.duration).toBe(33);
  expect(project.timeline.layers.map((item) => item.directory)).toContain("akari_scene");
});

test("split preserves all languages and snapping favors nearby markers", () => {
  const timeline = createProject("test", [], []).timeline;
  timeline.subtitles = [{ id: "cue", start: 1, end: 4, enabled: true, text: { en: "Hello", ja: "はい", ko: "네" } }];
  const split = splitCue(timeline, "cue", 2);
  expect(split.subtitles.map((cue) => [cue.start, cue.end])).toEqual([[1, 2], [2, 4]]);
  expect(split.subtitles[1]?.text.ko).toBe("네");
  expect(splitCue(timeline, "cue", 5)).toBe(timeline);
  expect(snapToTargets(1.03, 0.1, [1.05])).toBe(1.05);
  expect(talkSequenceId("Talk_05_A")).toBe("talk-5");
});

test("non-looping timeline layers follow the real Spine duration unless manually overridden", () => {
  const layer = { start: 1, end: 12, endMode: "auto" as const, loop: false, animationOffset: 0 };
  expect(animationEndForLayer(layer, 4.5)).toBe(5.5);
  expect(animationEndForLayer({ ...layer, animationOffset: 1 }, 4.5)).toBe(4.5);
  expect(animationEndForLayer({ ...layer, loop: true }, 4.5)).toBe(12);
  expect(animationEndForLayer({ ...layer, endMode: "manual", end: 3 }, 4.5)).toBe(3);
});

test("talk playback duration follows character animation instead of a long audio clip", () => {
  const layer = { ...createProject("Airi_home", [], []).timeline.layers[0]!, animation: "Talk_01_M", end: 20, loop: true };
  expect(talkSequenceDuration([layer], { [`${layer.id}:Talk_01_M`]: 2.75 }, () => "Talk_01_M")).toBe(2.75);
});

test("authored timeline content can extend the saved duration", () => {
  const timeline = createProject("Airi_home", [], []).timeline;
  timeline.subtitles = [{ id: "cue", start: 8, end: 11, enabled: true, text: { en: "Late", ja: "", ko: "" } }];
  timeline.audio = [{ id: "audio", name: "voice.ogg", path: "voice.ogg", start: 8, end: 12, enabled: true, volume: 1 }];
  expect(authoredTimelineEnd(timeline)).toBe(12);
  expect(extendTimelineDuration({ ...timeline, duration: 4 }).duration).toBe(12);
});

test("moving linked audio moves its nearest subtitle cue but not unlinked cues", () => {
  const timeline = createProject("Airi_home", [], []).timeline;
  timeline.audio = [
    { id: "linked", lineId: "talk-1", name: "linked.ogg", path: "linked.ogg", start: 1, end: 3, enabled: true, volume: 1 },
    { id: "free", name: "free.ogg", path: "free.ogg", start: 1, end: 3, enabled: true, volume: 1 },
  ];
  timeline.subtitles = [
    { id: "linked-cue", lineId: "talk-1", start: 1, end: 2, enabled: true, text: { en: "Linked", ja: "", ko: "" } },
    { id: "free-cue", start: 1, end: 2, enabled: true, text: { en: "Free", ja: "", ko: "" } },
  ];
  const moved = moveAudioClip(timeline, "linked", 4);
  expect(moved.audio.find((clip) => clip.id === "linked")).toMatchObject({ start: 4, end: 6 });
  expect(moved.subtitles.find((cue) => cue.id === "linked-cue")).toMatchObject({ start: 4, end: 5 });
  expect(moved.subtitles.find((cue) => cue.id === "free-cue")).toMatchObject({ start: 1, end: 2 });
});

test("opening phases keep scene, intro, and idle boundaries explicit", () => {
  expect(openingPhaseTimings("scene-first", 3, 2.5, 10)).toEqual([
    { id: "scene", start: 0, end: 3 },
    { id: "intro", start: 3, end: 5.5 },
    { id: "idle", start: 5.5, end: 10 },
  ]);
  expect(openingPhaseTimings("skip", 3, 2.5, 4)).toEqual([{ id: "idle", start: 0, end: 4 }]);
});

test("opening phases follow the character clip start instead of a fixed lead-in", () => {
  expect(openingPhaseTimings("scene-first", 3, 2.5, 10, 1.5)).toEqual([
    { id: "scene", start: 0, end: 1.5 },
    { id: "intro", start: 1.5, end: 4 },
    { id: "idle", start: 4, end: 10 },
  ]);
  expect(openingPhaseTimings("direct", 0, 2.5, 10, 1.5)).toEqual([
    { id: "intro", start: 1.5, end: 4 },
    { id: "idle", start: 4, end: 10 },
  ]);
});
