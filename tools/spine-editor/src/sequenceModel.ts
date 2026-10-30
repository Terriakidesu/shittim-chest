import { ensureTimelineLayers, type EditorProject, type EditorTimeline, type EditorTimelineLayer } from "./editorModel";

/** Resolve a non-looping layer's visible end from the actual Spine animation. */
export function animationEndForLayer(layer: Pick<EditorTimelineLayer, "start" | "end" | "endMode" | "loop" | "animationOffset">, animationDuration: number): number {
  if (layer.loop || layer.endMode === "manual" || !Number.isFinite(animationDuration) || animationDuration <= 0) return layer.end;
  return Math.max(layer.start + 0.01, layer.start + Math.max(0.01, animationDuration - Math.max(0, layer.animationOffset)));
}

export function talkSequenceId(animation: string): string {
  const number = animation.match(/talk[_ -]?(\d+)/i)?.[1];
  return number ? `talk-${Number(number)}` : "opening";
}

export function switchSequence(project: EditorProject, id: string, animations: string[], directories: string[]): EditorProject {
  const previousId = project.timeline.sequenceId ?? "legacy";
  const sequences = { ...project.sequences, [previousId]: structuredClone(project.timeline) };
  let next = sequences[id];
  if (!next) {
    const number = id.replace("talk-", "");
    const main = animations.find((name) => talkSequenceId(name) === id && /_m$/i.test(name));
    const face = animations.find((name) => talkSequenceId(name) === id && /_a$/i.test(name));
    const animation = id === "opening" ? "" : main ?? animations.find((name) => talkSequenceId(name) === id) ?? `Talk_${number.padStart(2, "0")}_M`;
    next = {
      ...structuredClone(project.timeline), sequenceId: id, duration: 12, loop: false,
      openingMode: "direct", sceneDuration: 3,
      subtitles: [], audio: [], selectedCueId: null,
      layers: project.timeline.layers.map((layer) => ({ ...layer, start: 0, end: 12, animation: layer.role === "character" ? animation : "", faceAnimation: layer.role === "character" ? face ?? "" : "", loop: id === "opening" })),
    };
  }
  return { ...project, sequences, timeline: ensureTimelineLayers(next, project.assetDirectory, directories) };
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
