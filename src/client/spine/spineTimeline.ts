import type { SpineMeta } from "./spineRuntime";

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
  /** Use the main character's matching animation and sample clock when available. */
  followMainAnimation?: boolean;
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

export interface SpineTimelineAudioPlaybackDecision {
  seek: boolean;
  play: boolean;
  started: boolean;
}

/** Keep timeline audio synchronized without restarting a clip every playhead frame. */
export function timelineAudioPlaybackDecision(input: {
  active: boolean;
  playing: boolean;
  currentTime: number;
  previousTime: number | undefined;
  started: boolean;
  ended: boolean;
}): SpineTimelineAudioPlaybackDecision {
  if (!input.active) return { seek: false, play: false, started: false };
  const rewound = input.previousTime !== undefined && input.currentTime < input.previousTime - 0.05;
  const entered = !input.started || rewound;
  return {
    seek: entered,
    play: input.playing && (entered || !input.ended),
    started: true,
  };
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
  /** Root-relative Spine set directories for every layer in this sequence. */
  assetPaths?: Record<string, string>;
  layers: SpineTimelineLayer[];
  subtitles: SpineTimelineSubtitle[];
  audio: SpineTimelineAudio[];
  language: SpineTimelineLanguage;
}

export interface SpineTimelineProject {
  timeline?: SpineTimeline;
  sequences?: Record<string, SpineTimeline>;
}

/** Idle is a runtime animation, not an alias for the opening timeline. */
export function timelineIdleAnimation(meta: Pick<SpineMeta, "idleAnimation" | "animations">): string {
  return meta.idleAnimation || meta.animations.find((name) => /^idle(?:_|$)/i.test(name)) || "";
}

/** A talk's idle tail stays visible until the sequence, not its clip, ends. */
export function timelineTalkIdleStart(layer: SpineTimelineLayer, animationDuration: number): number {
  return Math.max(layer.end, layer.start + Math.max(0, animationDuration - layer.animationOffset));
}

/** Resolve a localized cue using the same fallback order in the editor and viewer. */
export function timelineSubtitleText(cue: Pick<SpineTimelineSubtitle, "text">, language: SpineTimelineLanguage): string {
  return cue.text[language] || cue.text.en || cue.text.ja || cue.text.ko || "";
}

/** Return every active subtitle, preserving the authored timeline order. */
export function timelineActiveSubtitleTexts(timeline: Pick<SpineTimeline, "subtitles" | "language">, currentTime: number): string[] {
  return timeline.subtitles
    .filter((cue) => cue.enabled && currentTime >= cue.start && currentTime <= cue.end)
    .map((cue) => timelineSubtitleText(cue, timeline.language))
    .filter((text) => text.trim().length > 0);
}

export function timelineSequenceIds(project: SpineTimelineProject): string[] {
  const ids: string[] = [];
  if (project.timeline) ids.push(project.timeline.sequenceId);
  for (const id of Object.keys(project.sequences ?? {})) if (!ids.includes(id)) ids.push(id);
  return ids;
}

/** Return authored numbered talk sequences in playback order. */
export function timelineTalkSequenceIds(project: SpineTimelineProject): string[] {
  return timelineSequenceIds(project)
    .filter((id) => /^talk-\d+$/i.test(id))
    .sort((a, b) => Number(a.match(/\d+$/)?.[0] ?? 0) - Number(b.match(/\d+$/)?.[0] ?? 0));
}

export function timelineForSequence(project: SpineTimelineProject, sequenceId: string): SpineTimeline | null {
  if (project.timeline?.sequenceId === sequenceId) return project.timeline;
  return project.sequences?.[sequenceId] ?? null;
}

export function timelinePlaybackDuration(timeline: SpineTimeline, openingMinimumDuration = 0): number {
  const allLayerEnd = Math.max(0, ...timeline.layers.map((layer) => layer.end));
  const layerEnd = timeline.sequenceId === "opening" && timeline.durationMode !== "auto"
    ? Math.max(0, ...timeline.layers.filter((layer) => layer.endMode === "manual").map((layer) => layer.end))
    : allLayerEnd;
  const contentEnd = Math.max(0, ...timeline.subtitles.map((cue) => cue.end), ...timeline.audio.map((clip) => clip.end));
  if (timeline.sequenceId === "opening" && timeline.durationMode === "auto" && timeline.layers.length > 0) {
    // Automatic openings end at their last visible/authored endpoint. This
    // removes stale blank tail time left by an older import while the caller
    // can still protect an intro that has not yet reached its idle state.
    return Math.max(1, openingMinimumDuration, layerEnd, contentEnd);
  }
  return Math.max(1, timeline.duration, layerEnd, contentEnd);
}

/** Compute the deterministic sample clock shared by the editor and viewer. */
export function timelineLayerSampleTime(layer: Pick<SpineTimelineLayer, "start" | "animationOffset" | "loop" | "role">, currentTime: number, sequenceId: string, openingMode: SpineTimeline["openingMode"], introDuration: number, animationDuration: number): number {
  const openingCharacter = sequenceId === "opening" && layer.role === "character";
  const useIntro = openingCharacter && openingMode !== "skip" && currentTime >= layer.start && currentTime - layer.start < introDuration;
  const elapsed = Math.max(0, currentTime - layer.start);
  if (useIntro) return elapsed;
  const value = (openingCharacter ? Math.max(0, elapsed - introDuration) : elapsed) + layer.animationOffset;
  if (!animationDuration) return value;
  return layer.loop ? value % animationDuration : Math.min(value, animationDuration);
}

/** Resolve the visible endpoint used by both timeline previews. */
export function timelineLayerPlaybackEnd(layer: Pick<SpineTimelineLayer, "start" | "end" | "endMode" | "loop" | "animationOffset">, animationDuration: number): number {
  if (layer.loop || layer.endMode === "manual" || !Number.isFinite(animationDuration) || animationDuration <= 0) return layer.end;
  return Math.max(layer.start + 0.01, layer.start + Math.max(0.01, animationDuration - Math.max(0, layer.animationOffset)));
}

/** Talk tracks retain the character's idle body underneath the authored motion. */
export function timelineAnimationNeedsIdleUnderlay(animation: string): boolean {
  return /^talk/i.test(animation);
}

function exactAnimation(animations: readonly string[], requested: string): string | null {
  if (!requested) return null;
  return animations.find((name) => name.toLocaleLowerCase() === requested.toLocaleLowerCase()) ?? null;
}

/** Resolve the animation used by a timeline layer in both the editor and viewer. */
export function timelineLayerAnimation(layer: SpineTimelineLayer, meta: Pick<SpineMeta, "animations" | "introAnimation" | "idleAnimation">, mainAnimation: string | undefined, currentTime: number, sequenceId: string, openingMode: SpineTimeline["openingMode"], introDuration: number): string {
  const openingCharacter = sequenceId === "opening" && layer.role === "character";
  const useIntro = openingCharacter && openingMode !== "skip" && Boolean(meta.introAnimation) && currentTime >= layer.start && currentTime - layer.start < introDuration;
  const fallback = layer.animation || meta.idleAnimation || meta.animations[0] || "";
  const followed = layer.followMainAnimation && mainAnimation ? exactAnimation(meta.animations, mainAnimation) : null;
  if (followed) return followed;
  if (useIntro && meta.introAnimation) return exactAnimation(meta.animations, meta.introAnimation) ?? fallback;
  return fallback;
}

export interface TimelineMainAnimationState {
  animation: string;
  time: number;
  loop: boolean;
  useIntro: boolean;
}

/** Resolve the main character animation and clock shared by all following layers. */
export function timelineMainAnimation(layer: SpineTimelineLayer, meta: Pick<SpineMeta, "animations" | "introAnimation" | "idleAnimation">, currentTime: number, sequenceId: string, openingMode: SpineTimeline["openingMode"], introDuration: number, animationDuration: number): TimelineMainAnimationState {
  const openingCharacter = sequenceId === "opening" && layer.role === "character";
  const useIntro = openingCharacter && openingMode !== "skip" && Boolean(meta.introAnimation) && currentTime >= layer.start && currentTime - layer.start < introDuration;
  const animation = useIntro && meta.introAnimation ? meta.introAnimation : layer.animation || meta.idleAnimation || meta.animations[0] || "";
  const talkCharacter = sequenceId.startsWith("talk-") && layer.role === "character" && layer.endMode !== "manual";
  return {
    animation,
    time: timelineLayerSampleTime(layer, currentTime, sequenceId, openingMode, introDuration, animationDuration),
    loop: talkCharacter ? false : layer.loop,
    useIntro,
  };
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
  const role = timelineRole(layer.role);
  return {
    id: stringValue(layer.id, `timeline-layer-${index + 1}`),
    name: stringValue(layer.name, directory),
    role,
    directory,
    enabled: layer.enabled !== false,
    animation: stringValue(layer.animation),
    ...(typeof layer.faceAnimation === "string" ? { faceAnimation: layer.faceAnimation } : {}),
    followMainAnimation: layer.followMainAnimation === undefined ? role === "background" : layer.followMainAnimation === true,
    start,
    end: Math.max(start + 0.01, finiteNumber(layer.end, duration)),
    ...(layer.endMode === "manual" ? { endMode: "manual" as const } : layer.endMode === "auto" ? { endMode: "auto" as const } : {}),
    animationOffset: nonNegative(layer.animationOffset, 0),
    loop: layer.loop !== false,
    x: finiteNumber(layer.x, 0),
    y: finiteNumber(layer.y, 0),
    scale: Math.max(0.01, finiteNumber(layer.scale, 1)),
    opacity: Math.max(0, Math.min(1, finiteNumber(layer.opacity, 1))),
    order: Math.max(0, finiteNumber(layer.order, index)),
  };
}

function normalizeSubtitle(value: unknown, index: number, duration: number): SpineTimelineSubtitle | null {
  if (!value || typeof value !== "object") return null;
  const cue = value as Partial<SpineTimelineSubtitle>;
  const start = Math.max(0, finiteNumber(cue.start, 0));
  return {
    id: stringValue(cue.id, `subtitle-${index + 1}`),
    start,
    end: Math.max(start + 0.01, finiteNumber(cue.end, Math.min(duration, start + 2))),
    enabled: cue.enabled !== false,
    text: timelineText(cue.text),
  };
}

function normalizeAudio(value: unknown, index: number, duration: number): SpineTimelineAudio | null {
  if (!value || typeof value !== "object") return null;
  const clip = value as Partial<SpineTimelineAudio>;
  const path = stringValue(clip.path);
  if (!path) return null;
  const start = Math.max(0, finiteNumber(clip.start, 0));
  return {
    id: stringValue(clip.id, `audio-${index + 1}`),
    name: stringValue(clip.name, path.split(/[\\/]/).pop() ?? path),
    path,
    start,
    end: Math.max(start + 0.01, finiteNumber(clip.end, Math.min(duration, start + 2))),
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
    ...(timeline.assetPaths && typeof timeline.assetPaths === "object" && !Array.isArray(timeline.assetPaths)
      ? { assetPaths: Object.fromEntries(Object.entries(timeline.assetPaths).filter((entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string" && entry[1].trim().length > 0)) }
      : {}),
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
