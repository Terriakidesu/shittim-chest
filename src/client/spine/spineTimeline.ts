export type SpineTimelineLayerRole = "character" | "scene" | "background" | "overlay";
export type SpineTimelineLanguage = "en" | "ja" | "ko";

export interface SpineTimelineLayer {
  id: string;
  name: string;
  role: SpineTimelineLayerRole;
  directory: string;
  enabled: boolean;
  animation: string;
  faceAnimation?: string;
  start: number;
  end: number;
  endMode?: "auto" | "manual";
  animationOffset: number;
  loop: boolean;
  x: number;
  y: number;
  scale: number;
  opacity: number;
  order: number;
}

export interface SpineTimelineSubtitle {
  id: string;
  start: number;
  end: number;
  enabled: boolean;
  text: Record<SpineTimelineLanguage, string>;
}

export interface SpineTimelineAudio {
  id: string;
  name: string;
  path: string;
  start: number;
  end: number;
  enabled: boolean;
  volume: number;
}

export interface SpineTimeline {
  sequenceId: string;
  openingMode: "scene-first" | "direct" | "skip";
  sceneDuration: number;
  openingIdleDuration: number;
  durationMode: "auto" | "manual";
  duration: number;
  loop: boolean;
  layersInitialized?: boolean;
  layers: SpineTimelineLayer[];
  subtitles: SpineTimelineSubtitle[];
  audio: SpineTimelineAudio[];
  language: SpineTimelineLanguage;
}

export interface SpineTimelineProject {
  timeline?: SpineTimeline;
  sequences?: Record<string, SpineTimeline>;
}

export function timelineSequenceIds(project: SpineTimelineProject): string[] {
  const ids: string[] = [];
  if (project.timeline) ids.push(project.timeline.sequenceId);
  for (const id of Object.keys(project.sequences ?? {})) if (!ids.includes(id)) ids.push(id);
  return ids;
}

export function timelineForSequence(project: SpineTimelineProject, sequenceId: string): SpineTimeline | null {
  if (project.timeline?.sequenceId === sequenceId) return project.timeline;
  return project.sequences?.[sequenceId] ?? null;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nonNegative(value: unknown, fallback: number): number {
  return Math.max(0, finiteNumber(value, fallback));
}

function positive(value: unknown, fallback: number): number {
  const result = finiteNumber(value, fallback);
  return result > 0 ? result : fallback;
}

function timelineRole(value: unknown): SpineTimelineLayerRole {
  return value === "scene" || value === "background" || value === "overlay" ? value : "character";
}

function timelineLanguage(value: unknown): SpineTimelineLanguage {
  return value === "ja" || value === "ko" ? value : "en";
}

function timelineText(value: unknown): Record<SpineTimelineLanguage, string> {
  if (!value || typeof value !== "object") return { en: "", ja: "", ko: "" };
  const text = value as Record<string, unknown>;
  const read = (...keys: string[]) => keys.map((key) => text[key]).find((item): item is string => typeof item === "string") ?? "";
  return { en: read("en", "EN"), ja: read("ja", "JA", "JR"), ko: read("ko", "KO", "KR") };
}

function normalizeLayer(value: unknown, index: number, duration: number): SpineTimelineLayer | null {
  if (!value || typeof value !== "object") return null;
  const layer = value as Partial<SpineTimelineLayer>;
  const directory = stringValue(layer.directory);
  if (!directory) return null;
  const start = nonNegative(layer.start, 0);
  return {
    id: stringValue(layer.id, `timeline-layer-${index + 1}`),
    name: stringValue(layer.name, directory),
    role: timelineRole(layer.role),
    directory,
    enabled: layer.enabled !== false,
    animation: stringValue(layer.animation),
    ...(typeof layer.faceAnimation === "string" ? { faceAnimation: layer.faceAnimation } : {}),
    start,
    end: Math.max(start, finiteNumber(layer.end, duration)),
    ...(layer.endMode === "manual" ? { endMode: "manual" as const } : layer.endMode === "auto" ? { endMode: "auto" as const } : {}),
    animationOffset: nonNegative(layer.animationOffset, 0),
    loop: layer.loop !== false,
    x: finiteNumber(layer.x, 0),
    y: finiteNumber(layer.y, 0),
    scale: positive(layer.scale, 1),
    opacity: Math.max(0, Math.min(1, finiteNumber(layer.opacity, 1))),
    order: finiteNumber(layer.order, index),
  };
}

function normalizeSubtitle(value: unknown, index: number, duration: number): SpineTimelineSubtitle | null {
  if (!value || typeof value !== "object") return null;
  const cue = value as Partial<SpineTimelineSubtitle>;
  const start = Math.max(0, Math.min(duration, finiteNumber(cue.start, 0)));
  return {
    id: stringValue(cue.id, `subtitle-${index + 1}`),
    start,
    end: Math.max(start, Math.min(duration, finiteNumber(cue.end, start + 2))),
    enabled: cue.enabled !== false,
    text: timelineText(cue.text),
  };
}

function normalizeAudio(value: unknown, index: number, duration: number): SpineTimelineAudio | null {
  if (!value || typeof value !== "object") return null;
  const clip = value as Partial<SpineTimelineAudio>;
  const path = stringValue(clip.path);
  if (!path) return null;
  const start = Math.max(0, Math.min(duration, finiteNumber(clip.start, 0)));
  return {
    id: stringValue(clip.id, `audio-${index + 1}`),
    name: stringValue(clip.name, path.split(/[\\/]/).pop() ?? path),
    path,
    start,
    end: Math.max(start, Math.min(duration, finiteNumber(clip.end, start + 2))),
    enabled: clip.enabled !== false,
    volume: Math.max(0, Math.min(1, finiteNumber(clip.volume, 1))),
  };
}

export function normalizeSpineTimeline(value: unknown): SpineTimeline | null {
  if (!value || typeof value !== "object") return null;
  const timeline = value as Partial<SpineTimeline>;
  const duration = Math.max(1, finiteNumber(timeline.duration, 12));
  return {
    sequenceId: stringValue(timeline.sequenceId, "legacy"),
    openingMode: timeline.openingMode === "scene-first" || timeline.openingMode === "skip" ? timeline.openingMode : "direct",
    sceneDuration: nonNegative(timeline.sceneDuration, 3),
    openingIdleDuration: nonNegative(timeline.openingIdleDuration, 3),
    durationMode: timeline.durationMode === "auto" ? "auto" : "manual",
    duration,
    loop: timeline.loop !== false,
    ...(typeof timeline.layersInitialized === "boolean" ? { layersInitialized: timeline.layersInitialized } : {}),
    layers: (Array.isArray(timeline.layers) ? timeline.layers : [])
      .map((layer, index) => normalizeLayer(layer, index, duration))
      .filter((layer): layer is SpineTimelineLayer => layer !== null),
    subtitles: (Array.isArray(timeline.subtitles) ? timeline.subtitles : [])
      .map((cue, index) => normalizeSubtitle(cue, index, duration))
      .filter((cue): cue is SpineTimelineSubtitle => cue !== null),
    audio: (Array.isArray(timeline.audio) ? timeline.audio : [])
      .map((clip, index) => normalizeAudio(clip, index, duration))
      .filter((clip): clip is SpineTimelineAudio => clip !== null),
    language: timelineLanguage(timeline.language),
  };
}
