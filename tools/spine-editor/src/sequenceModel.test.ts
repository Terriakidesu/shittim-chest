import { expect, test } from "bun:test";
import { createProject, normalizeProject } from "./editorModel";
import { animationEndForLayer, snapToTargets, splitCue, switchSequence, talkSequenceId } from "./sequenceModel";

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
