import { ensureTimelineLayers, type EditorProject, type EditorTimeline, type EditorTimelineLayer } from "./editorModel";
import { timelineLayerPlaybackEnd } from "../../../src/client/spine/spineTimeline";

export type OpeningPhaseId = "scene" | "intro" | "idle";

export interface OpeningPhaseTiming {
  id: OpeningPhaseId;
  start: number;
  end: number;
}

/** Resolve a non-looping layer's visible end from the actual Spine animation. */
export function animationEndForLayer(layer: Pick<EditorTimelineLayer, "start" | "end" | "endMode" | "loop" | "animationOffset">, animationDuration: number): number {
  return timelineLayerPlaybackEnd(layer, animationDuration);
}

/** Talk playback is bounded by its character animations, never by subtitle/audio clips. */
export function talkSequenceDuration(
  layers: readonly EditorTimelineLayer[],
  animationDurations: Readonly<Record<string, number>>,
  animationForLayer: (layer: EditorTimelineLayer) => string,
): number {
  const characters = layers.filter((layer) => layer.role === "character");
  if (characters.length === 0) return 1;
  return Math.max(1, ...characters.map((layer) => animationEndForLayer(
    layer.endMode === "manual" ? layer : { ...layer, loop: false },
    animationDurations[`${layer.id}:${animationForLayer(layer)}`] ?? 0,
  )));
}

/** Find the latest authored subtitle/audio or manually-sized layer endpoint. */
export function authoredTimelineEnd(timeline: Pick<EditorTimeline, "layers" | "subtitles" | "audio">): number {
  return Math.max(
    0,
    ...timeline.layers.filter((layer) => layer.endMode === "manual").map((layer) => layer.end),
    ...timeline.subtitles.map((cue) => cue.end),
    ...timeline.audio.map((clip) => clip.end),
  );
}

/**
 * Resolve an automatic opening's meaningful endpoint.
 *
 * The old importer could leave the saved duration longer than every visible
 * layer, which made the viewer display a blank tail after the character had
 * already reached idle. Keep the real intro and authored content, then trim
 * only the unused remainder.
 */
export function openingTimelineDuration(
  timeline: Pick<EditorTimeline, "layers" | "subtitles" | "audio" | "openingMode" | "sceneDuration">,
  introDuration: number,
  layerEndFor: (layer: EditorTimelineLayer) => number = (layer) => layer.end,
): number {
  const character = timeline.layers.find((layer) => layer.role === "character");
  const introStart = character
    ? Math.max(0, character.start)
    : timeline.openingMode === "scene-first" ? Math.max(0, timeline.sceneDuration ?? 0) : 0;
  const introEnd = introStart + (timeline.openingMode === "skip" ? 0 : Math.max(0, introDuration));
  const layerEnd = Math.max(0, ...timeline.layers.map(layerEndFor));
  const contentEnd = Math.max(0, ...timeline.subtitles.map((cue) => cue.end), ...timeline.audio.map((clip) => clip.end));
  return Math.max(1, introEnd, layerEnd, contentEnd);
}

/** Preserve a timeline extension made by authored content without changing its mode. */
export function extendTimelineDuration(timeline: EditorTimeline): EditorTimeline {
  const duration = Math.max(1, timeline.duration, authoredTimelineEnd(timeline));
  return duration === timeline.duration ? timeline : { ...timeline, duration };
}

/** Move an audio clip and its nearest subtitle cue from the same imported line together. */
export function moveAudioClip(timeline: EditorTimeline, id: string, start: number): EditorTimeline {
  const clip = timeline.audio.find((item) => item.id === id);
  if (!clip) return timeline;
  const nextStart = Math.max(0, start);
  const delta = nextStart - clip.start;
  const audio = timeline.audio.map((item) => item.id === id
    ? { ...item, start: nextStart, end: Math.max(nextStart + 0.01, item.end + delta) }
    : item);
  if (Math.abs(delta) < 0.000001 || !clip.lineId) return extendTimelineDuration({ ...timeline, audio });

  let linkedIndex = -1;
  let linkedDistance = Number.POSITIVE_INFINITY;
  timeline.subtitles.forEach((cue, index) => {
    if (cue.lineId !== clip.lineId) return;
    const distance = Math.abs(cue.start - clip.start);
    if (distance < linkedDistance) {
      linkedIndex = index;
      linkedDistance = distance;
    }
  });
  if (linkedIndex < 0) return extendTimelineDuration({ ...timeline, audio });
  const subtitles = timeline.subtitles.map((cue, index) => index === linkedIndex
    ? { ...cue, start: Math.max(0, cue.start + delta), end: Math.max(cue.start + delta + 0.01, cue.end + delta) }
    : cue);
  return extendTimelineDuration({ ...timeline, audio, subtitles });
}

export function openingPhaseTimings(mode: "scene-first" | "direct" | "skip", sceneDuration: number, introDuration: number, totalDuration: number, introStartOverride?: number): OpeningPhaseTiming[] {
  const phases: OpeningPhaseTiming[] = [];
  const safeScene = Math.max(0, sceneDuration);
  const safeIntro = mode === "skip" ? 0 : Math.max(0, introDuration);
  const sceneEnd = Math.max(0, introStartOverride ?? safeScene);
  let cursor = mode === "scene-first" ? sceneEnd : Math.max(0, introStartOverride ?? 0);
  if (mode === "scene-first" && sceneEnd > 0) {
    phases.push({ id: "scene", start: 0, end: sceneEnd });
  }
  if (safeIntro > 0) {
    phases.push({ id: "intro", start: cursor, end: cursor + safeIntro });
    cursor += safeIntro;
  }
  phases.push({ id: "idle", start: cursor, end: Math.max(cursor, totalDuration) });
  return phases;
}

export function talkSequenceId(animation: string): string {
  const number = animation.match(/talk[_ -]?(\d+)/i)?.[1];
  return number ? `talk-${Number(number)}` : "opening";
}

export function switchSequence(project: EditorProject, id: string, animations: string[], directories: string[]): EditorProject {
  const previousId = project.timeline.sequenceId ?? "legacy";
  const sequences = { ...project.sequences };
  if (previousId !== id) sequences[previousId] = structuredClone(project.timeline);
  let next = previousId === id ? structuredClone(project.timeline) : sequences[id];
  if (!next) {
    const number = id.replace("talk-", "");
    const main = animations.find((name) => talkSequenceId(name) === id && /_m$/i.test(name));
    const face = animations.find((name) => talkSequenceId(name) === id && /_a$/i.test(name));
    const animation = id === "opening" ? "" : main ?? animations.find((name) => talkSequenceId(name) === id) ?? `Talk_${number.padStart(2, "0")}_M`;
    next = {
      ...structuredClone(project.timeline), sequenceId: id, duration: id === "opening" ? 12 : 1, loop: false,
      openingMode: "direct", sceneDuration: 3, openingIdleDuration: 3, durationMode: id === "opening" ? "auto" : "manual",
      layersInitialized: false,
      subtitles: [], audio: [], selectedCueId: null,
      layers: project.timeline.layers.map((layer) => ({ ...layer, start: 0, end: 12, animation: layer.role === "character" ? animation : "", faceAnimation: layer.role === "character" ? face ?? "" : "", loop: id === "opening" })),
    };
  }
  if (id.startsWith("talk-")) {
    next = {
      ...next,
      layers: next.layers.map((layer) => layer.role === "character" && layer.endMode !== "manual" ? { ...layer, loop: false } : layer),
    };
  }
  if (id === "opening") {
    next = { ...next, openingIdleDuration: next.openingIdleDuration ?? 3, durationMode: next.durationMode ?? "manual" };
  }
  return { ...project, sequences, timeline: ensureTimelineLayers(next, project.assetDirectory, directories) };
}

/** Replace the imported subtitle/audio payload while preserving authored sequence and layer settings. */
export function replaceSubtitleImport(project: EditorProject, subtitlePath: string): EditorProject {
  const replace = (timeline: EditorTimeline): EditorTimeline => ({
    ...structuredClone(timeline),
    subtitlePath,
    subtitles: [],
    audio: [],
    selectedCueId: null,
  });
  return {
    ...project,
    timeline: replace(project.timeline),
    sequences: project.sequences
      ? Object.fromEntries(Object.entries(project.sequences).map(([id, timeline]) => [id, replace(timeline)]))
      : project.sequences,
  };
}

export function splitCue(timeline: EditorTimeline, id: string, time: number): EditorTimeline {
  const cue = timeline.subtitles.find((item) => item.id === id);
  if (!cue || time <= cue.start || time >= cue.end) return timeline;
  return { ...timeline, subtitles: timeline.subtitles.flatMap((item) => item.id === id ? [{ ...item, end: time }, { ...item, id: crypto.randomUUID(), start: time, text: { ...item.text } }] : [item]) };
}

export function snapToTargets(value: number, interval: number, targets: number[], tolerance = 0.08): number {
  const closest = targets.reduce((best, target) => Math.abs(target - value) < Math.abs(best - value) ? target : best, Infinity);
  return Math.abs(closest - value) <= tolerance ? closest : interval > 0 ? Math.round(value / interval) * interval : value;
}
