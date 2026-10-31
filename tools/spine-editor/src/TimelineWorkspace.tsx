import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { SpineRenderer, type SpineCameraPose, type SpineFiles, type SpineMeta } from "../../../src/client/spine/spineRuntime";
import {
  compositionDirectories,
  createTimelineLayer,
  ensureTimelineLayers,
  type EditorProject,
  type EditorAudioClip,
  type EditorSubtitleCue,
  type EditorTimelineLayer,
  type TimelineLanguage,
  type TimelineLayerRole,
} from "./editorModel";
import type { DesktopAssetSource } from "./desktopSource";
import { audioPlaybackDecision, decodedAudioTiming } from "./audioModel";
import { animationEndForLayer, authoredTimelineEnd, extendTimelineDuration, openingPhaseTimings, replaceSubtitleImport, snapToTargets, splitCue, switchSequence, talkSequenceDuration, talkSequenceId, type OpeningPhaseTiming } from "./sequenceModel";
import { timelineLayerSampleTime } from "../../../src/client/spine/spineTimeline";
import { serializeSubtitleDocument } from "./subtitleDocument";
import type { RecentFile } from "./recentFiles";
import { AssetPickerModal } from "./AssetPickerModal";
import { isTextEditingTarget } from "./editorKeyboard";
import { panStageView, resetStageView, zoomStageView, type StageView } from "./stageView";

const TIMELINE_SCALE = 96;
const MIN_TIMELINE_DURATION = 1;

interface ImportedSubtitleEntry {
  start: number;
  end?: number;
  text: Record<TimelineLanguage, string>;
  audio: string[];
}

function AudioWaveform({ url, onDuration }: { url?: string; onDuration?: (duration: number) => void }) {
  const [peaks, setPeaks] = useState<number[]>([]);
  const onDurationRef = useRef(onDuration);
  onDurationRef.current = onDuration;
  useEffect(() => {
    if (!url) return;
    let live = true;
    const context = new AudioContext();
    void fetch(url).then((response) => response.arrayBuffer()).then((bytes) => context.decodeAudioData(bytes)).then((buffer) => {
      if (!live) return;
      onDurationRef.current?.(buffer.duration);
      const channel = buffer.getChannelData(0);
      const samples = Array.from({ length: 160 }, (_, index) => {
        const start = Math.floor(index * channel.length / 160);
        const end = Math.floor((index + 1) * channel.length / 160);
        let peak = 0;
        for (let sample = start; sample < end; sample++) peak = Math.max(peak, Math.abs(channel[sample]!));
        return peak;
      });
      setPeaks(samples);
    }).catch(() => undefined).finally(() => { void context.close(); });
    return () => { live = false; };
  }, [url]);
  return <svg className="timeline-waveform" viewBox="0 0 160 30" preserveAspectRatio="none" aria-label="Audio waveform">{peaks.map((peak, index) => <line key={index} x1={index} x2={index} y1={15 - peak * 14} y2={15 + peak * 14} stroke="#a6ffdb" strokeWidth="0.7" />)}</svg>;
}

interface TimelineWorkspaceProps {
  source: DesktopAssetSource | null;
  directory: string;
  directories: string[];
  project: EditorProject | null;
  initialSubtitlePath?: string | null;
  onSubtitleOpened: () => void;
  initialAudioPaths?: string[] | null;
  onAudioOpened: () => void;
  onRecentFile: (item: Omit<RecentFile, "lastOpened"> & { lastOpened?: number }) => void;
  onMutate: (mutator: (current: EditorProject) => EditorProject) => void;
  onLive: (mutator: (current: EditorProject) => EditorProject) => void;
  onBeginEdit: () => void;
  onSave: () => void | Promise<void>;
  onRegisterSave: (callback: ((getProject: () => EditorProject | null) => Promise<string[]>) | null) => void;
  onStatus: (value: string) => void;
  onError: (value: string | null) => void;
}

interface TimelineLayerCanvasProps {
  layer: EditorTimelineLayer;
  files: SpineFiles | null;
  currentTime: number;
  mainAnimation?: string;
  mainAnimationTime?: number;
  mainAnimationLoop?: boolean;
  openingMode?: "scene-first" | "direct" | "skip";
  sequenceId?: string;
  onMarkers: (markers: number[]) => void;
  sharedCameraPose: SpineCameraPose | null;
  referenceCamera: boolean;
  onMeta: (layerId: string, meta: SpineMeta | null) => void;
  onCameraPose: (pose: SpineCameraPose) => void;
  onAnimationDuration: (layerId: string, animation: string, duration: number) => void;
  onError: (value: string | null) => void;
}

function matchingAnimation(meta: SpineMeta, requested: string): string | null {
  if (!requested) return null;
  return meta.animations.find((name) => name.toLocaleLowerCase() === requested.toLocaleLowerCase()) ?? null;
}

function TimelineLayerCanvas({ layer, files, currentTime, mainAnimation, mainAnimationTime, mainAnimationLoop, sharedCameraPose, referenceCamera, onMeta, onCameraPose, onAnimationDuration, onError, openingMode, sequenceId, onMarkers }: TimelineLayerCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<SpineRenderer | null>(null);
  const [meta, setMeta] = useState<SpineMeta | null>(null);
  const onMetaRef = useRef(onMeta);
  const onCameraPoseRef = useRef(onCameraPose);
  const onAnimationDurationRef = useRef(onAnimationDuration);
  const onErrorRef = useRef(onError);
  onMetaRef.current = onMeta;
  onCameraPoseRef.current = onCameraPose;
  onAnimationDurationRef.current = onAnimationDuration;
  onErrorRef.current = onError;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new SpineRenderer(canvas, {
      onMeta: (value) => {
        setMeta(value);
        onMetaRef.current(layer.id, value);
        if (value) {
          for (const animation of [value.introAnimation, value.idleAnimation]) {
            if (!animation) continue;
            const duration = renderer.getEditorAnimationInfo(animation).duration;
            if (duration > 0) onAnimationDurationRef.current(layer.id, animation, duration);
          }
          renderer.setCameraMode("fit");
          if (referenceCamera) requestAnimationFrame(() => {
            const pose = renderer.getCameraPose();
            if (pose) onCameraPoseRef.current(pose);
          });
        }
      },
      onProgress: () => {},
      onLoading: () => {},
      onError: (value) => onErrorRef.current(value?.message ?? null),
    });
    renderer.setPlaying(false);
    renderer.setLoop(false);
    rendererRef.current = renderer;
    return () => {
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [layer.id, referenceCamera]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    if (files) void renderer.load(files, layer.directory);
    else renderer.clear();
    return () => renderer.clear();
  }, [files, layer.directory]);

  const opening = sequenceId === "opening";
  const openingCharacter = opening && layer.role === "character";
  const intro = meta?.introAnimation;
  const introLength = intro ? rendererRef.current?.getEditorAnimationInfo(intro).duration ?? 0 : 0;
  const useIntro = openingCharacter && openingMode !== "skip" && currentTime >= layer.start && currentTime - layer.start < introLength;
  const fallbackAnimation = layer.animation || meta?.idleAnimation || meta?.animations[0] || "";
  const followedAnimation = layer.followMainAnimation && meta && mainAnimation ? matchingAnimation(meta, mainAnimation) : null;
  const animation = followedAnimation || (useIntro ? intro! : fallbackAnimation);
  const animationDuration = rendererRef.current?.getEditorAnimationInfo(animation).duration ?? 0;
  const talkCharacter = sequenceId?.startsWith("talk-") && layer.role === "character" && layer.endMode !== "manual";
  const followMainClock = Boolean(layer.followMainAnimation && mainAnimationTime !== undefined);
  const effectiveLoop = followMainClock && mainAnimationLoop !== undefined ? mainAnimationLoop : talkCharacter ? false : layer.loop;
  const layerEnd = animationEndForLayer(talkCharacter ? { ...layer, loop: false } : layer, animationDuration);
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !meta || !animation) return;
    renderer.setPlaying(false);
    renderer.setLoop(false);
    if (meta.animations.includes(animation)) renderer.setAnimation(animation, true);
  }, [animation, meta]);

  useEffect(() => {
    if (animationDuration > 0 && animation) onAnimationDurationRef.current(layer.id, animation, animationDuration);
  }, [animation, animationDuration, layer.endMode, layer.id, layer.loop, layer.start, layer.animationOffset]);

  useEffect(() => {
    if (!meta) return;
    const renderer = rendererRef.current;
    const time = followMainClock
      ? mainAnimationTime!
      : timelineLayerSampleTime(layer, currentTime, sequenceId ?? "legacy", openingMode ?? "direct", introLength, animationDuration);
    renderer?.sampleEditorAnimation(animation, layer.faceAnimation ?? "", time, effectiveLoop, /^talk/i.test(animation));
    if (referenceCamera) onMarkers(renderer?.getEditorAnimationInfo(animation).markers ?? []);
  }, [animation, currentTime, effectiveLoop, followMainClock, layer, mainAnimationLoop, mainAnimationTime, meta, openingCharacter, openingMode, introLength, useIntro]);

  useEffect(() => {
    if (!referenceCamera && sharedCameraPose) rendererRef.current?.setCameraPose(sharedCameraPose);
  }, [referenceCamera, sharedCameraPose]);

  const visible = layer.enabled && currentTime >= layer.start && currentTime <= layerEnd;
  const style: CSSProperties = {
    zIndex: layer.order,
    opacity: visible ? layer.opacity : 0,
    visibility: visible ? "visible" : "hidden",
    transform: `translate(${layer.x}px, ${layer.y}px) scale(${layer.scale})`,
  };
  return <canvas ref={canvasRef} className="timeline-layer-canvas" style={style} aria-label={`${layer.name} Spine layer`} />;
}

function seconds(value: number): string {
  return `${value.toFixed(3)}s`;
}

function snapTime(value: number, snap: number, duration: number): number {
  const next = snap > 0 ? Math.round(value / snap) * snap : value;
  return Math.max(0, Math.min(duration, Number(next.toFixed(3))));
}

type TimelineClipKind = "layer" | "cue" | "audio";
type TimelineSelection = { kind: TimelineClipKind; id: string };
type TimelineDragKind = TimelineClipKind | "layer-start" | "layer-end" | "cue-start" | "cue-end" | "audio-start" | "audio-end";
interface TimelineDragItem extends TimelineSelection { start: number; end: number; linked?: boolean }
interface TimelineDragState {
  kind: TimelineDragKind;
  id: string;
  x: number;
  start: number;
  end: number;
  items: TimelineDragItem[];
}
interface SelectedClipDetail extends TimelineSelection {
  label: string;
  start: number;
  end: number;
  enabled: boolean;
  removable: boolean;
}

function cueText(cue: EditorSubtitleCue, language: TimelineLanguage): string {
  return cue.text[language] || cue.text.en || cue.text.ja || cue.text.ko || "Untitled subtitle";
}

function previewCueText(cue: EditorSubtitleCue, language: TimelineLanguage): string {
  return cue.text[language] || cue.text.en || cue.text.ja || cue.text.ko || "";
}

function roleLabel(role: TimelineLayerRole): string {
  return role === "background" ? "BG" : role === "scene" ? "SCENE" : role === "character" ? "CHAR" : "OVERLAY";
}

function openingPhaseLabel(id: OpeningPhaseTiming["id"]): string {
  return id === "scene" ? "Scene lead-in" : id === "intro" ? "Character intro" : "Idle hold";
}

function importedText(value: unknown): Record<TimelineLanguage, string> {
  if (!value || typeof value !== "object") return { en: "", ja: "", ko: "" };
  const item = value as Record<string, unknown>;
  const read = (...keys: string[]) => keys.map((key) => item[key]).find((candidate): candidate is string => typeof candidate === "string") ?? "";
  return { en: read("en", "EN"), ja: read("ja", "JA", "JR"), ko: read("ko", "KO", "KR") };
}

function subtitleTextKey(text: Record<TimelineLanguage, string>): string {
  return `${text.en}\u0000${text.ja}\u0000${text.ko}`;
}

function collapseDuplicateEntries(entries: ImportedSubtitleEntry[]): ImportedSubtitleEntry[] {
  const result: ImportedSubtitleEntry[] = [];
  for (const entry of entries) {
    const previousIndex = result.findIndex((previous) => Math.abs(previous.start - entry.start) < 0.0001 && subtitleTextKey(previous.text) === subtitleTextKey(entry.text));
    if (previousIndex < 0) result.push(entry);
    else if ((entry.end ?? Number.NEGATIVE_INFINITY) > (result[previousIndex]!.end ?? Number.NEGATIVE_INFINITY)) result[previousIndex] = entry;
  }
  return result;
}

function preferredAudioPath(alternatives: string[]): string[] {
  const global = alternatives.filter((path) => /_GL_/i.test(path));
  const base = alternatives.filter((path) => !/_(GL|JP|KR)_/i.test(path));
  const candidates = global.length ? global : base.length ? base : alternatives.filter((path) => /_JP_/i.test(path));
  return candidates.length ? [candidates[0]!] : alternatives.slice(0, 1);
}

function importedSubtitleCues(value: unknown): { cues: EditorSubtitleCue[]; audio: EditorAudioClip[]; duration: number } {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const lines = Array.isArray(source.lines)
    ? source.lines
    : Array.isArray(source.characters)
      ? (source.characters.find((item) => item && typeof item === "object" && (item as Record<string, unknown>).directory === source.directory) as Record<string, unknown> | undefined)?.lines
      : [];
  if (!Array.isArray(lines)) return { cues: [], audio: [], duration: 0 };
  const cues: EditorSubtitleCue[] = [];
  const audio: EditorAudioClip[] = [];
  const audioDirectory = typeof source.audioDirectory === "string" ? source.audioDirectory.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "") : "";
  const audioPath = (value: string) => {
    const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
    if (normalized.toLocaleLowerCase().startsWith("audios/")) return normalized;
    return `audios/voicelines/${audioDirectory && !normalized.includes("/") ? `${audioDirectory}/` : ""}${normalized}`;
  };
  let duration = 0;
  lines.forEach((candidate, lineIndex) => {
    if (!candidate || typeof candidate !== "object") return;
    const line = candidate as Record<string, unknown>;
    const parts = Array.isArray(line.parts) ? line.parts.filter((part) => part && typeof part === "object") as Record<string, unknown>[] : [];
    const markers = Array.isArray(line.markers) ? line.markers.filter((marker): marker is number => typeof marker === "number" && Number.isFinite(marker)) : [];
    const entries = (parts.length > 0
      ? parts.map((part, index) => ({
        start: typeof part.start === "number" && Number.isFinite(part.start) ? part.start : markers[index] ?? lineIndex * 2 + index * 2,
        end: typeof part.end === "number" && Number.isFinite(part.end) ? part.end : undefined,
        text: importedText(part.subtitle ?? part.text ?? line.subtitle ?? line.text),
        audio: Array.isArray(part.audio) ? part.audio.filter((item): item is string => typeof item === "string") : [],
      }))
      : [{ start: markers[0] ?? lineIndex * 2, end: undefined, text: importedText(line.subtitle ?? line.text ?? line), audio: Array.isArray(line.audio) ? line.audio.filter((item): item is string => typeof item === "string") : [] }]) as ImportedSubtitleEntry[];
    const compactEntries = collapseDuplicateEntries(entries);
    compactEntries.forEach((entry, index) => {
      const nextStart = compactEntries[index + 1]?.start;
      const end = Math.max(entry.start + 0.05, entry.end ?? nextStart ?? entry.start + 2);
      const cue: EditorSubtitleCue = {
        id: `subtitle-import-${lineIndex}-${index}-${Math.random().toString(36).slice(2, 8)}`,
        start: Math.max(0, entry.start),
        end,
        enabled: true,
        text: entry.text,
      };
      cues.push(cue);
      duration = Math.max(duration, end);
      preferredAudioPath(entry.audio).forEach((path, audioIndex) => {
        const start = entry.start + audioIndex * 0.01;
        audio.push({
          id: `audio-import-${lineIndex}-${index}-${audioIndex}-${Math.random().toString(36).slice(2, 8)}`,
          name: path.split(/[\\/]/).pop() ?? path,
          path: audioPath(path),
          autoEnd: true,
          start,
          end,
          enabled: true,
          volume: 1,
        });
      });
    });
  });
  return { cues, audio, duration };
}

function audioPathCandidates(path: string): string[] {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+/g, "/");
  const withoutAudioRoot = normalized.replace(/^audios\/voicelines\//i, "");
  const withoutAudios = normalized.replace(/^audios\//i, "");
  const basename = normalized.split("/").at(-1) ?? normalized;
  return [...new Set([normalized, withoutAudioRoot, withoutAudios, basename])].filter(Boolean);
}

async function findAudioFile(source: DesktopAssetSource, path: string): Promise<File | null> {
  for (const candidate of audioPathCandidates(path)) {
    const file = await source.getFile(candidate);
    if (file) return file;
  }
  return null;
}

export function TimelineWorkspace({ source, directory, directories, project, initialSubtitlePath, onSubtitleOpened, initialAudioPaths, onAudioOpened, onRecentFile, onMutate, onLive, onBeginEdit, onSave, onRegisterSave, onStatus, onError }: TimelineWorkspaceProps) {
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [previewUntil, setPreviewUntil] = useState<number | null>(null);
  const [metas, setMetas] = useState<Record<string, SpineMeta | null>>({});
  const [sharedCameraPose, setSharedCameraPose] = useState<SpineCameraPose | null>(null);
  const [files, setFiles] = useState<Record<string, SpineFiles | null>>({});
  const [animationDurations, setAnimationDurations] = useState<Record<string, number>>({});
  const [zoom, setZoom] = useState(1);
  const [stageView, setStageView] = useState<StageView>(() => resetStageView());
  const [stagePanning, setStagePanning] = useState(false);
  const [markers, setMarkers] = useState<number[]>([]);
  const [inspector, setInspector] = useState<"sequence" | "layer" | "cue" | "audio" | "multi">("sequence");
  const scrollRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const stagePanRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const addMenuRef = useRef<HTMLDetailsElement>(null);
  const scrubRef = useRef<number | null>(null);
  const [selectedClips, setSelectedClips] = useState<TimelineSelection[]>([]);
  const [selectedAudioId, setSelectedAudioId] = useState<string | null>(null);
  const [layerPickerOpen, setLayerPickerOpen] = useState(false);
  const audioElementsRef = useRef<Record<string, HTMLAudioElement | null>>({});
  const audioUrlsRef = useRef<Record<string, string>>({});
  const audioStartedRef = useRef<Record<string, boolean>>({});
  const audioPreviousTimeRef = useRef<Record<string, number | undefined>>({});
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});
  const [missingAudio, setMissingAudio] = useState<string[]>([]);
  const dragRef = useRef<TimelineDragState | null>(null);
  const subtitleDocumentsRef = useRef<Record<string, Record<string, unknown>>>({});
  const projectRef = useRef<EditorProject | null>(project);
  const sourceRef = useRef<DesktopAssetSource | null>(source);
  const subtitleSaveQueueRef = useRef(Promise.resolve());
  const openedSubtitleRef = useRef("");
  const openedAudioRef = useRef("");
  projectRef.current = project;
  sourceRef.current = source;

  const timeline = project?.timeline ?? null;
  const discovered = useMemo(() => directory ? compositionDirectories(directory, directories) : [], [directory, directories]);
  const displayLayers = useMemo(() => [...(timeline?.layers ?? [])].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)), [timeline?.layers]);
  const selectedLayer = timeline?.layers.find((layer) => layer.id === timeline.selectedLayerId) ?? null;
  const selectedCue = timeline?.subtitles.find((cue) => cue.id === timeline.selectedCueId) ?? null;
  const selectedCueIndex = selectedCue && timeline ? timeline.subtitles.findIndex((cue) => cue.id === selectedCue.id) : -1;
  const selectedAudio = timeline?.audio.find((clip) => clip.id === selectedAudioId) ?? null;
  const layerDirectoriesKey = displayLayers.map((layer) => layer.directory).join("|");
  const characterMeta = displayLayers.map((layer) => layer.role === "character" ? metas[layer.id] : null).find(Boolean);
  const characterLayer = displayLayers.find((layer) => layer.role === "character");
  const animations = characterMeta?.animations ?? [];
  const sequenceIds = [...new Set(["opening", ...animations.filter((name) => /talk[_ -]?\d+/i.test(name)).map(talkSequenceId), ...Object.keys(project?.sequences ?? {}).filter((id) => id !== "legacy")])];

  function layerAnimation(layer: EditorTimelineLayer): string {
    return layer.animation || metas[layer.id]?.idleAnimation || metas[layer.id]?.animations[0] || "";
  }

  function layerEnd(layer: EditorTimelineLayer): number {
    const animationDuration = animationDurations[`${layer.id}:${layerAnimation(layer)}`] ?? 0;
    const talkCharacter = timeline?.sequenceId?.startsWith("talk-") && layer.role === "character" && layer.endMode !== "manual";
    return animationEndForLayer(talkCharacter ? { ...layer, loop: false } : layer, animationDuration);
  }

  const openingMode = timeline?.openingMode ?? "direct";
  const introAnimation = characterMeta?.introAnimation ?? "";
  const introDuration = characterLayer && introAnimation ? animationDurations[`${characterLayer.id}:${introAnimation}`] ?? 0 : 0;
  const openingIntroStart = timeline?.sequenceId === "opening"
    ? Math.max(0, characterLayer?.start ?? timeline?.sceneDuration ?? 0)
    : 0;
  const openingIdleDuration = Math.max(0, timeline?.openingIdleDuration ?? 3);
  const openingNaturalDuration = Math.max(MIN_TIMELINE_DURATION, openingIntroStart + (openingMode === "skip" ? 0 : introDuration) + openingIdleDuration);
  const mainCharacterAnimation = characterLayer ? layerAnimation(characterLayer) : "";
  const mainCharacterDuration = characterLayer && mainCharacterAnimation ? animationDurations[`${characterLayer.id}:${mainCharacterAnimation}`] ?? 0 : 0;
  const mainUsesIntro = Boolean(timeline?.sequenceId === "opening" && openingMode !== "skip" && characterLayer && introAnimation && currentTime >= characterLayer.start && currentTime - characterLayer.start < introDuration);
  const mainAnimation = mainUsesIntro ? introAnimation : mainCharacterAnimation;
  const mainAnimationTime = characterLayer && timeline
    ? timelineLayerSampleTime(characterLayer, currentTime, timeline.sequenceId ?? "legacy", openingMode, introDuration, mainCharacterDuration)
    : undefined;
  const mainAnimationLoop = characterLayer
    ? timeline?.sequenceId?.startsWith("talk-") && characterLayer.endMode !== "manual" ? false : characterLayer.loop
    : undefined;
  const authoredEnd = timeline ? authoredTimelineEnd(timeline) : 0;
  const openingManualLayerEnd = timeline?.sequenceId === "opening"
    ? Math.max(0, ...timeline.layers.filter((layer) => layer.endMode === "manual").map((layer) => layer.end))
    : 0;
  const openingAutoDuration = Math.max(openingNaturalDuration, authoredEnd, openingManualLayerEnd);
  const talkLayers = timeline?.sequenceId?.startsWith("talk-") ? displayLayers.filter((layer) => layer.role === "character") : [];
  const talkNaturalDuration = talkLayers.length > 0 ? talkSequenceDuration(talkLayers, animationDurations, layerAnimation) : 0;
  const duration = timeline?.sequenceId === "opening"
    ? Math.max(MIN_TIMELINE_DURATION, timeline.duration ?? 12, authoredEnd, openingManualLayerEnd)
    : talkLayers.length > 0
      ? Math.max(MIN_TIMELINE_DURATION, timeline?.duration ?? 1, talkNaturalDuration, authoredEnd)
      : Math.max(MIN_TIMELINE_DURATION, timeline?.duration ?? 12, authoredEnd, ...displayLayers.map(layerEnd));
  const trackWidth = Math.max(640, duration * TIMELINE_SCALE * zoom + 48);
  const openingPhases = timeline?.sequenceId === "opening" ? openingPhaseTimings(openingMode, timeline.sceneDuration ?? 3, introDuration, duration, openingIntroStart) : [];

  useEffect(() => {
    if (!timeline || timeline.sequenceId !== "opening" || timeline.durationMode !== "auto" || !characterMeta || (introAnimation && introDuration <= 0)) return;
    if (Math.abs(timeline.duration - openingAutoDuration) < 0.01) return;
    updateTimeline((value) => ({ ...value, duration: openingAutoDuration }), false);
  }, [characterMeta, duration, openingAutoDuration, introAnimation, introDuration, timeline]);

  function onAnimationDuration(layerId: string, animation: string, animationDuration: number) {
    const key = `${layerId}:${animation}`;
    setAnimationDurations((value) => value[key] === animationDuration ? value : { ...value, [key]: animationDuration });
    const currentTimeline = timeline;
    const currentLayer = currentTimeline?.layers.find((layer) => layer.id === layerId);
    if (!currentTimeline || !currentLayer || currentLayer.endMode === "manual") return;
    const talkCharacter = currentTimeline.sequenceId?.startsWith("talk-") && currentLayer.role === "character";
    if (!talkCharacter && currentLayer.loop) return;
    const effectiveLayer = talkCharacter ? { ...currentLayer, loop: false } : currentLayer;
    const nextEnd = animationEndForLayer(effectiveLayer, animationDuration);
    const currentTalkDuration = talkCharacter
      ? Math.max(MIN_TIMELINE_DURATION, ...currentTimeline.layers.filter((layer) => layer.role === "character").map((layer) => layer.id === layerId ? nextEnd : layer.end))
      : 0;
    const nextDuration = talkCharacter
      ? Math.max(MIN_TIMELINE_DURATION, currentTimeline.duration, currentTalkDuration, authoredTimelineEnd(currentTimeline))
      : Math.max(currentTimeline.duration, nextEnd);
    const layerNeedsUpdate = Math.abs(currentLayer.end - nextEnd) >= 0.01 || (talkCharacter && currentLayer.loop);
    const durationNeedsUpdate = Math.abs(currentTimeline.duration - nextDuration) >= 0.01;
    if (!layerNeedsUpdate && !durationNeedsUpdate) return;
    updateTimeline((value) => ({
      ...value,
      layers: value.layers.map((layer) => layer.id === layerId && layer.endMode !== "manual" ? { ...layer, loop: talkCharacter ? false : layer.loop, end: nextEnd } : layer),
      duration: talkCharacter
        ? Math.max(MIN_TIMELINE_DURATION, value.duration, ...value.layers.filter((layer) => layer.role === "character").map((layer) => layer.id === layerId ? nextEnd : layer.end), authoredTimelineEnd(value))
        : Math.max(value.duration, nextEnd),
    }), false);
  }

  function chooseSequence(id: string) {
    onMutate((current) => switchSequence(current, id, animations, directories));
    setCurrentTime(0); setPlaying(false); setPreviewUntil(null); setSelectedClips([]); setSelectedAudioId(null); setInspector("sequence");
  }

  function previewOpeningPhase(phase: OpeningPhaseTiming) {
    setCurrentTime(phase.start);
    setPreviewUntil(Math.max(phase.start + 0.01, phase.end));
    setPlaying(true);
    setInspector("sequence");
  }

  function stepOpeningPhase(direction: -1 | 1) {
    if (!openingPhases.length) return;
    const index = openingPhases.findIndex((phase) => currentTime >= phase.start && currentTime < phase.end);
    const next = openingPhases[Math.max(0, Math.min(openingPhases.length - 1, (index < 0 ? 0 : index) + direction))];
    if (next) { setCurrentTime(next.start); setPlaying(false); setPreviewUntil(null); }
  }

  useEffect(() => {
    if (!project || !directory || project.timeline.layersInitialized) return;
    const ensured = ensureTimelineLayers(project.timeline, directory, directories);
    onLive((current) => ({ ...current, timeline: ensureTimelineLayers(current.timeline, directory, directories) }));
    onStatus(`Initialized ${ensured.layers.length} synchronized Spine layers.`);
  }, [directories, directory, onLive, onStatus, project]);

  useEffect(() => {
    if (!source || displayLayers.length === 0) {
      setFiles({});
      return;
    }
    let cancelled = false;
    setFiles({});
    void Promise.all(displayLayers.map(async (layer) => {
      try {
        return [layer.directory, await source.getSetFiles(layer.directory)] as const;
      } catch (value) {
        if (!cancelled) onError(`${layer.directory}: ${value instanceof Error ? value.message : String(value)}`);
        return [layer.directory, null] as const;
      }
    })).then((entries) => {
      if (!cancelled) setFiles(Object.fromEntries(entries));
    });
    return () => { cancelled = true; };
  }, [layerDirectoriesKey, onError, source]);

  useEffect(() => {
    const clips = timeline?.audio ?? [];
    const wanted = new Set(clips.map((clip) => clip.id));
    const removed: string[] = [];
    for (const [id, url] of Object.entries(audioUrlsRef.current)) {
      if (wanted.has(id)) continue;
      URL.revokeObjectURL(url);
      delete audioUrlsRef.current[id];
      delete audioStartedRef.current[id];
      delete audioPreviousTimeRef.current[id];
      removed.push(id);
    }
    if (removed.length > 0) setAudioUrls((value) => {
      const next = { ...value };
      removed.forEach((id) => delete next[id]);
      return next;
    });
    let cancelled = false;
    for (const clip of clips) {
      if (audioUrlsRef.current[clip.id] || !source) continue;
      void findAudioFile(source, clip.path).then((file) => {
        if (cancelled) return;
        if (!file) { setMissingAudio((value) => value.includes(clip.path) ? value : [...value, clip.path]); return; }
        setMissingAudio((value) => value.filter((path) => path !== clip.path));
        const url = URL.createObjectURL(file);
        audioUrlsRef.current[clip.id] = url;
        setAudioUrls((value) => ({ ...value, [clip.id]: url }));
      }).catch(() => undefined);
    }
    return () => { cancelled = true; };
  }, [source, timeline?.audio]);

  useEffect(() => () => {
    for (const url of Object.values(audioUrlsRef.current)) URL.revokeObjectURL(url);
    audioUrlsRef.current = {};
    for (const audio of Object.values(audioElementsRef.current)) audio?.pause();
  }, []);

  useEffect(() => {
    audioStartedRef.current = {};
    audioPreviousTimeRef.current = {};
  }, [directory, source, timeline?.sequenceId]);

  useEffect(() => {
    subtitleDocumentsRef.current = {};
  }, [directory, source]);

  useEffect(() => {
    if (!initialSubtitlePath) openedSubtitleRef.current = "";
  }, [initialSubtitlePath]);

  useEffect(() => {
    if (!initialAudioPaths?.length) openedAudioRef.current = "";
  }, [initialAudioPaths]);

  useEffect(() => {
    if (!initialSubtitlePath || !source || !project) return;
    const key = `${source.rootPath}:${directory}:${initialSubtitlePath}`;
    if (openedSubtitleRef.current === key) return;
    openedSubtitleRef.current = key;
    void source.readText(initialSubtitlePath).then((content) => {
      if (!content) throw new Error(`Recent subtitle file is missing: ${initialSubtitlePath}`);
      return importSubtitleFile({ path: initialSubtitlePath, content });
    }).then(() => onSubtitleOpened()).catch((value) => onError(value instanceof Error ? value.message : String(value)));
  }, [directory, initialSubtitlePath, onError, onSubtitleOpened, project, source]);

  function applyDecodedAudioDuration(id: string, decodedDuration: number) {
    const currentTimeline = timeline;
    const clip = currentTimeline?.audio.find((item) => item.id === id);
    if (!currentTimeline) return;
    if (!clip?.autoEnd) return;
    const timing = decodedAudioTiming(clip.start, decodedDuration);
    if (!timing) return;
    if (Math.abs(clip.end - timing.end) < 0.01) return;
    updateTimeline((value) => extendTimelineDuration({
      ...value,
      audio: value.audio.map((item) => item.id === id ? { ...item, end: timing.end } : item),
    }), false);
  }

  useEffect(() => {
    for (const clip of timeline?.audio ?? []) {
      const audio = audioElementsRef.current[clip.id];
      if (!audio) continue;
      audio.volume = clip.volume;
      audio.playbackRate = speed;
      const active = clip.enabled && currentTime >= clip.start && currentTime <= clip.end;
      const decision = audioPlaybackDecision({
        active,
        playing,
        currentTime,
        previousTime: audioPreviousTimeRef.current[clip.id],
        started: audioStartedRef.current[clip.id] === true,
        ended: audio.ended,
      });
      audioPreviousTimeRef.current[clip.id] = currentTime;
      audioStartedRef.current[clip.id] = decision.started;
      if (!active) { audio.pause(); continue; }
      const local = Math.max(0, currentTime - clip.start);
      if (decision.seek || Math.abs(audio.currentTime - local) > 0.08) audio.currentTime = local;
      if (decision.play) void audio.play().catch(() => undefined);
      else audio.pause();
    }
  }, [currentTime, playing, speed, timeline?.audio, audioUrls]);

  useEffect(() => {
    if (!playing) return;
    let previous = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const delta = Math.min(0.1, Math.max(0, (now - previous) / 1000));
      previous = now;
      setCurrentTime((value) => {
        const next = value + delta * speed;
        const stopAt = previewUntil === null ? duration : Math.min(duration, previewUntil);
        if (next < stopAt) return next;
        if (previewUntil !== null) {
          setPreviewUntil(null);
          setPlaying(false);
          return stopAt;
        }
        if (timeline?.loop) return next % duration;
        setPlaying(false);
        return duration;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [duration, playing, previewUntil, speed, timeline?.loop]);

  useEffect(() => {
    if (!timeline) return;
    setCurrentTime((value) => Math.min(value, duration));
  }, [directory, duration, timeline]);

  function projectTimelines(current: EditorProject) {
    const activeId = current.timeline.sequenceId;
    return [current.timeline, ...Object.entries(current.sequences ?? {})
      .filter(([id, timeline]) => id !== activeId && timeline.sequenceId !== activeId)
      .map(([, timeline]) => timeline)];
  }

  async function saveSubtitleDocuments(getProject: () => EditorProject | null = () => projectRef.current): Promise<string[]> {
    const save = async (): Promise<string[]> => {
      const current = getProject();
      const currentSource = sourceRef.current;
      if (!current || !currentSource) return [];
      const timelines = projectTimelines(current);
      const paths = new Set(timelines.map((item) => item.subtitlePath).filter((path): path is string => Boolean(path)));
      const saved: string[] = [];
      for (const path of paths) {
        let document = subtitleDocumentsRef.current[path];
        if (!document) {
          const file = await currentSource.getFile(path);
          if (!file) throw new Error(`Linked subtitle file not found: ${path}`);
          const parsed = JSON.parse(await file.text()) as unknown;
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`Linked subtitle file is not a JSON object: ${path}`);
          document = parsed as Record<string, unknown>;
          subtitleDocumentsRef.current[path] = structuredClone(document);
        }
        await currentSource.saveText(path, serializeSubtitleDocument(document, current.assetDirectory, timelines));
        saved.push(path);
      }
      return saved;
    };
    const queued = subtitleSaveQueueRef.current.then(save, save);
    subtitleSaveQueueRef.current = queued.then(() => undefined, () => undefined);
    return queued;
  }

  useEffect(() => {
    onRegisterSave((getProject) => saveSubtitleDocuments(getProject));
    return () => onRegisterSave(null);
  });

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      const menu = addMenuRef.current;
      if (!menu?.open || (event.target instanceof Node && menu.contains(event.target))) return;
      menu.open = false;
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);

  useEffect(() => {
    if (!project || !source || Object.keys(subtitleDocumentsRef.current).length === 0) return;
    const timer = window.setTimeout(() => {
      void saveSubtitleDocuments().then((paths) => {
        if (paths.length > 0) onStatus("Subtitle changes saved directly to the source JSON.");
      }).catch((value) => onError(value instanceof Error ? value.message : String(value)));
    }, 450);
    return () => window.clearTimeout(timer);
  }, [onError, onStatus, project, source]);

  function updateTimeline(mutator: (timeline: EditorProject["timeline"]) => EditorProject["timeline"], history = true) {
    const callback = history ? onMutate : onLive;
    callback((current) => ({ ...current, timeline: mutator(current.timeline) }));
  }

  function updateLayer(id: string, patch: Partial<EditorTimelineLayer>, history = true) {
    updateTimeline((value) => {
      const selected = value.layers.find((layer) => layer.id === id);
      const layers = value.layers.map((layer) => layer.id === id ? { ...layer, ...patch } : layer);
      const openingCharacter = value.sequenceId === "opening" && selected?.role === "character" && patch.start !== undefined;
      const next = {
        ...value,
        layers,
        ...(openingCharacter && value.openingMode === "scene-first" ? { sceneDuration: Math.max(0, patch.start ?? selected.start) } : {}),
      };
      if (patch.end === undefined) return next;
      const changed = layers.find((layer) => layer.id === id);
      return { ...next, duration: Math.max(next.duration, changed?.end ?? next.duration) };
    }, history);
  }

  function updateCue(id: string, patch: Partial<EditorSubtitleCue>, history = true) {
    updateTimeline((value) => extendTimelineDuration({ ...value, subtitles: value.subtitles.map((cue) => cue.id === id ? { ...cue, ...patch } : cue) }), history);
  }

  function updateAudio(id: string, patch: Partial<EditorAudioClip>, history = true) {
    updateTimeline((value) => extendTimelineDuration({ ...value, audio: value.audio.map((clip) => clip.id === id ? { ...clip, ...patch } : clip) }), history);
  }

  function addAudioFiles(selected: Array<{ path: string; file: File }>) {
    if (!selected.length || !timeline) return;
    const clips = selected.map(({ path, file }, index): EditorAudioClip => {
      const id = `audio-file-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`;
      const start = snapTime(currentTime + index * 0.01, timeline.snap, Number.POSITIVE_INFINITY);
      const url = URL.createObjectURL(file);
      audioUrlsRef.current[id] = url;
      setAudioUrls((value) => ({ ...value, [id]: url }));
      return { id, name: path.split(/[\\/]/).pop() ?? path, path, autoEnd: true, start, end: start + 2, enabled: true, volume: 1 };
    });
    updateTimeline((value) => extendTimelineDuration({ ...value, audio: [...value.audio, ...clips] }));
    if (clips.length === 1) {
      setSelectedAudio(clips[0]!.id);
    } else if (clips.length > 1) {
      setPreviewUntil(null);
      setSelectedClips(clips.map((clip) => ({ kind: "audio" as const, id: clip.id })));
      setSelectedAudioId(clips[0]!.id);
      setInspector("multi");
      updateTimeline((value) => ({ ...value, selectedLayerId: null, selectedCueId: null }), false);
    }
    onStatus(`Added ${clips.length} local audio clip${clips.length === 1 ? "" : "s"}.`);
  }

  useEffect(() => {
    if (!initialAudioPaths?.length || !source || !project || !timeline) return;
    const key = `${source.rootPath}:${directory}:${initialAudioPaths.join("|")}`;
    if (openedAudioRef.current === key) return;
    openedAudioRef.current = key;
    void Promise.all(initialAudioPaths.map(async (path) => {
      const file = await findAudioFile(source, path);
      if (!file) throw new Error(`Recent audio file is missing: ${path}`);
      return { path, file };
    })).then((selected) => {
      addAudioFiles(selected);
      onAudioOpened();
    }).catch((value) => onError(value instanceof Error ? value.message : String(value)));
  }, [directory, initialAudioPaths, onAudioOpened, onError, project, source, timeline]);

  function isClipSelected(kind: TimelineClipKind, id: string): boolean {
    return selectedClips.some((item) => item.kind === kind && item.id === id);
  }

  function focusTimelineClip(selection: TimelineSelection) {
    setPreviewUntil(null);
    if (selection.kind === "layer") {
      setSelectedAudioId(null);
      setInspector("layer");
      updateTimeline((value) => ({ ...value, selectedLayerId: selection.id, selectedCueId: null }), false);
    } else if (selection.kind === "cue") {
      setSelectedAudioId(null);
      setInspector("cue");
      updateTimeline((value) => ({ ...value, selectedLayerId: null, selectedCueId: selection.id }), false);
    } else {
      setSelectedAudioId(selection.id);
      setInspector("audio");
      updateTimeline((value) => ({ ...value, selectedLayerId: null, selectedCueId: null }), false);
    }
  }

  function clearTimelineSelection() {
    setSelectedClips([]);
    setSelectedAudioId(null);
    setInspector("sequence");
    updateTimeline((value) => ({ ...value, selectedLayerId: null, selectedCueId: null }), false);
  }

  function selectTimelineClip(selection: TimelineSelection, event: ReactPointerEvent<HTMLElement>): TimelineSelection[] | null {
    event.stopPropagation();
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    if (additive) {
      const exists = isClipSelected(selection.kind, selection.id);
      const next = exists
        ? selectedClips.filter((item) => item.kind !== selection.kind || item.id !== selection.id)
        : [...selectedClips, selection];
      setSelectedClips(next);
      if (next.length === 0) clearTimelineSelection();
      else {
        focusTimelineClip(next.at(-1)!);
        if (next.length > 1) setInspector("multi");
      }
      return null;
    }

    const next = isClipSelected(selection.kind, selection.id) ? selectedClips : [selection];
    setSelectedClips(next);
    focusTimelineClip(selection);
    if (next.length > 1) setInspector("multi");
    return next;
  }

  function setSelectedAudio(id: string | null) {
    if (!id) { clearTimelineSelection(); return; }
    const selection = { kind: "audio" as const, id };
    setSelectedClips([selection]);
    focusTimelineClip(selection);
  }

  function closeAddMenu() {
    if (addMenuRef.current) addMenuRef.current.open = false;
  }

  function addCue() {
    if (!timeline) return;
    const start = snapTime(currentTime, timeline.snap, Number.POSITIVE_INFINITY);
    setInspector("cue");
    setPreviewUntil(null);
    const cue: EditorSubtitleCue = {
      id: `subtitle-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
      start,
      end: start + 2,
      enabled: true,
      text: { en: "", ja: "", ko: "" },
    };
    setSelectedClips([{ kind: "cue", id: cue.id }]);
    updateTimeline((value) => extendTimelineDuration({ ...value, subtitles: [...value.subtitles, cue], selectedCueId: cue.id }));
    onStatus(`Subtitle cue added at ${seconds(start)}.`);
  }

  async function importSubtitleFile(selected: { path: string; content: string }) {
    try {
      const raw = JSON.parse(selected.content) as Record<string, unknown>;
      const subtitlePath = selected.path;
      subtitleDocumentsRef.current[subtitlePath] = structuredClone(raw);
      const sourceFile = Array.isArray(raw.characters) ? raw.characters.find((item) => (item as Record<string, unknown>).directory === directory) as Record<string, unknown> : raw;
      if (!sourceFile || !Array.isArray(sourceFile.lines)) throw new Error("No matching character subtitle lines found.");
      let count = 0;
      subtitleDocumentsRef.current = { [subtitlePath]: structuredClone(raw) };
      onMutate((current) => {
        let next = replaceSubtitleImport(current, subtitlePath);
        const original = current.timeline.sequenceId ?? "opening";
        for (const candidate of sourceFile.lines as Record<string, unknown>[]) {
          const number = String(candidate.id ?? "").match(/(\d+)$/)?.[1];
          if (number === undefined) continue;
          const id = Number(number) === 0 ? "opening" : `talk-${Number(number)}`;
          next = switchSequence(next, id, animations, directories);
          const imported = importedSubtitleCues({ ...sourceFile, lines: [candidate] });
        next = { ...next, timeline: extendTimelineDuration({ ...next.timeline, subtitlePath, duration: Math.max(next.timeline.duration, imported.duration), subtitles: imported.cues.map((cue) => ({ ...cue, lineId: String(candidate.id) })), audio: imported.audio.map((clip) => ({ ...clip, lineId: String(candidate.id) })), selectedCueId: imported.cues[0]?.id ?? null }) };
          count += imported.cues.length;
        }
        return switchSequence(next, original, animations, directories);
      });
      if (source) onRecentFile({ kind: "subtitle", path: subtitlePath, rootPath: source.rootPath, label: subtitlePath.split(/[\\/]/).pop() ?? subtitlePath, directory });
      onStatus(`Replaced the previous subtitle/audio import with ${count} cue${count === 1 ? "" : "s"}.${subtitlePath ? " Source JSON is now linked for direct saves." : " Original files unchanged."}`);
    } catch (value) {
      onError(value instanceof Error ? value.message : String(value));
    }
  }

  async function importSubtitles() {
    if (!source) return;
    try {
      const selected = await source.openText();
      if (selected) await importSubtitleFile(selected);
    } catch (value) {
      onError(value instanceof Error ? value.message : String(value));
    }
  }

  async function selectAudioFiles(): Promise<Array<{ path: string; file: File }>> {
    if (!source) return [];
    try {
      const paths = await source.openAudio();
      paths.forEach((path) => onRecentFile({ kind: "audio", path, rootPath: source.rootPath, label: path.split(/[\\/]/).pop() ?? path, directory }));
      return (await Promise.all(paths.map(async (path) => ({ path, file: await source.getFile(path) })))).filter((entry): entry is { path: string; file: File } => entry.file !== null);
    } catch (value) {
      onError(value instanceof Error ? value.message : String(value));
      return [];
    }
  }

  async function importAudio() {
    const selected = await selectAudioFiles();
    addAudioFiles(selected);
  }

  async function relinkAudio() {
    const selected = await selectAudioFiles();
    if (!selected.length || !timeline) return;
    const missing = timeline.audio.filter((clip) => missingAudio.includes(clip.path) && !audioUrlsRef.current[clip.id]);
    const used = new Set<string>();
    let linked = 0;
    for (const { path, file } of selected) {
      const fileName = (path.split(/[\\/]/).pop() ?? path).toLocaleLowerCase();
      const clip = missing.find((candidate) => !used.has(candidate.id) && (candidate.path.split(/[\\/]/).pop() ?? candidate.path).toLocaleLowerCase() === fileName);
      if (!clip) continue;
      used.add(clip.id);
      audioUrlsRef.current[clip.id] = URL.createObjectURL(file);
      setAudioUrls((value) => ({ ...value, [clip.id]: audioUrlsRef.current[clip.id]! }));
      setMissingAudio((value) => value.filter((path) => path !== clip.path));
      linked += 1;
    }
    onStatus(linked ? `Relinked ${linked} audio clip${linked === 1 ? "" : "s"}.` : "No selected audio filenames matched the missing clips.");
  }

  function deleteCue() {
    if (!selectedCue) return;
    updateTimeline((value) => {
      const subtitles = value.subtitles.filter((cue) => cue.id !== selectedCue.id);
      return { ...value, subtitles, selectedCueId: null };
    });
    setSelectedClips([]);
    setInspector("sequence");
  }

  function deleteAudio() {
    if (!selectedAudio) return;
    updateTimeline((value) => {
      const audio = value.audio.filter((clip) => clip.id !== selectedAudio.id);
      return { ...value, audio };
    });
    setSelectedClips([]);
    setSelectedAudioId(null);
    setInspector("sequence");
  }

  function deleteSelectedClips() {
    if (!selectedClips.length || !timeline) return;
    const layers = new Set(selectedClips.filter((item) => item.kind === "layer").map((item) => item.id));
    const cues = new Set(selectedClips.filter((item) => item.kind === "cue").map((item) => item.id));
    const audio = new Set(selectedClips.filter((item) => item.kind === "audio").map((item) => item.id));
    const removableLayers = new Set(timeline.layers.filter((layer) => layers.has(layer.id) && layer.role !== "character").map((layer) => layer.id));
    updateTimeline((value) => ({
      ...value,
      layers: value.layers.filter((layer) => !removableLayers.has(layer.id)),
      subtitles: value.subtitles.filter((cue) => !cues.has(cue.id)),
      audio: value.audio.filter((clip) => !audio.has(clip.id)),
      selectedLayerId: removableLayers.has(value.selectedLayerId ?? "") ? null : value.selectedLayerId,
      selectedCueId: cues.has(value.selectedCueId ?? "") ? null : value.selectedCueId,
    }));
    for (const id of audio) {
      const url = audioUrlsRef.current[id];
      if (url) URL.revokeObjectURL(url);
      delete audioUrlsRef.current[id];
      delete audioElementsRef.current[id];
    }
    setSelectedClips([]);
    setSelectedAudioId(null);
    setInspector("sequence");
  }

  function setSelectedClipsEnabled(enabled: boolean) {
    if (!selectedClips.length) return;
    const layers = new Set(selectedClips.filter((item) => item.kind === "layer").map((item) => item.id));
    const cues = new Set(selectedClips.filter((item) => item.kind === "cue").map((item) => item.id));
    const audio = new Set(selectedClips.filter((item) => item.kind === "audio").map((item) => item.id));
    updateTimeline((value) => ({
      ...value,
      layers: value.layers.map((layer) => layers.has(layer.id) ? { ...layer, enabled } : layer),
      subtitles: value.subtitles.map((cue) => cues.has(cue.id) ? { ...cue, enabled } : cue),
      audio: value.audio.map((clip) => audio.has(clip.id) ? { ...clip, enabled } : clip),
    }));
  }

  function addLayer(directoryToAdd: string) {
    if (!timeline || !directoryToAdd || timeline.layers.some((layer) => layer.directory === directoryToAdd)) return;
    const found = discovered.find((item) => item.directory === directoryToAdd);
    const role = found?.role ?? (/_scene$/i.test(directoryToAdd) ? "scene" : /_bg$/i.test(directoryToAdd) ? "background" : "overlay");
    const layer = createTimelineLayer(directoryToAdd, role, timeline.layers.length, duration);
    updateTimeline((value) => ({ ...value, layers: [...value.layers, layer], selectedLayerId: layer.id }));
    setSelectedClips([{ kind: "layer", id: layer.id }]);
    setInspector("layer");
    onStatus(`Added ${directoryToAdd} as a ${role} layer.`);
  }

  function removeLayer() {
    if (!selectedLayer || selectedLayer.role === "character") return;
    const nextLayer = timeline?.layers.filter((layer) => layer.id !== selectedLayer.id).at(-1) ?? null;
    updateTimeline((value) => {
      const layers = value.layers.filter((layer) => layer.id !== selectedLayer.id);
      return { ...value, layers, selectedLayerId: layers.at(-1)?.id ?? null };
    });
    setSelectedClips(nextLayer ? [{ kind: "layer", id: nextLayer.id }] : []);
    setInspector(nextLayer ? "layer" : "sequence");
  }

  function dragClipKind(kind: TimelineDragKind): TimelineClipKind {
    return kind.endsWith("-start") || kind.endsWith("-end") ? kind.slice(0, kind.lastIndexOf("-")) as TimelineClipKind : kind as TimelineClipKind;
  }

  function dragItem(selection: TimelineSelection): TimelineDragItem | null {
    if (!timeline) return null;
    if (selection.kind === "layer") {
      const layer = timeline.layers.find((item) => item.id === selection.id);
      return layer ? { ...selection, start: layer.start, end: layerEnd(layer) } : null;
    }
    if (selection.kind === "cue") {
      const cue = timeline.subtitles.find((item) => item.id === selection.id);
      return cue ? { ...selection, start: cue.start, end: cue.end } : null;
    }
    const audio = timeline.audio.find((item) => item.id === selection.id);
    return audio ? { ...selection, start: audio.start, end: audio.end } : null;
  }

  function linkedSubtitleItems(items: TimelineDragItem[]): TimelineDragItem[] {
    if (!timeline) return [];
    const existing = new Set(items.filter((item) => item.kind === "cue").map((item) => item.id));
    return items.flatMap((item) => {
      if (item.kind !== "audio" || !item.linked) return [];
      const clip = timeline.audio.find((candidate) => candidate.id === item.id);
      if (!clip?.lineId) return [];
      const cue = timeline.subtitles
        .filter((candidate) => candidate.lineId === clip.lineId && !existing.has(candidate.id))
        .sort((a, b) => Math.abs(a.start - clip.start) - Math.abs(b.start - clip.start))[0];
      if (!cue) return [];
      existing.add(cue.id);
      return [{ kind: "cue" as const, id: cue.id, start: cue.start, end: cue.end, linked: true }];
    });
  }

  function beginDrag(event: ReactPointerEvent<HTMLElement>, kind: TimelineDragKind, id: string, start: number, end: number, selection: TimelineSelection[] = selectedClips) {
    event.stopPropagation();
    const captureTarget = event.currentTarget.closest(".timeline-track-rows") as HTMLElement | null;
    (captureTarget ?? event.currentTarget).setPointerCapture(event.pointerId);
    const clipKind = dragClipKind(kind);
    const selected = selection.some((item) => item.kind === clipKind && item.id === id) ? selection : [{ kind: clipKind, id }];
    const items = selected.map((item) => dragItem(item)).filter((item): item is TimelineDragItem => item !== null);
    if (!items.some((item) => item.kind === clipKind && item.id === id)) items.push({ kind: clipKind, id, start, end });
    if (kind === "audio") items.push(...linkedSubtitleItems(items.map((item) => item.kind === "audio" ? { ...item, linked: true } : item)));
    dragRef.current = { kind, id, x: event.clientX, start, end, items };
    onBeginEdit();
  }

  function moveDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || !timeline) return;
    const delta = (event.clientX - drag.x) / (TIMELINE_SCALE * zoom);
    const resize = drag.kind !== dragClipKind(drag.kind);
    const resizeKind = dragClipKind(drag.kind);
    const selectedCueIds = new Set(drag.items.filter((item) => item.kind === "cue" && !item.linked).map((item) => item.id));
    const targets = [...markers, ...timeline.subtitles.filter((cue) => !selectedCueIds.has(cue.id)).flatMap((cue) => [cue.start, cue.end])];
    const snap = (value: number) => Math.max(0, snapToTargets(value, event.altKey ? 0 : timeline.snap, event.altKey ? [] : targets));
    const resizeAnchor = drag.kind.endsWith("-end") ? drag.end : drag.start;
    const snappedDelta = snap(resizeAnchor + delta) - resizeAnchor;
    const moveItems = drag.items.filter((item) => !item.linked || !resize);
    const moveDelta = resize ? snappedDelta : Math.max(-Math.min(...moveItems.map((item) => item.start)), snappedDelta);

    updateTimeline((value) => {
      let layers = value.layers;
      let subtitles = value.subtitles;
      let audio = value.audio;
      let sceneDuration = value.sceneDuration;
      for (const item of drag.items) {
        if (resize && (item.kind !== resizeKind || item.linked)) continue;
        if (!resize) {
          const start = Math.max(0, item.start + moveDelta);
          const end = Math.max(start + 0.01, item.end + moveDelta);
          if (item.kind === "layer") {
            layers = layers.map((layer) => layer.id === item.id ? { ...layer, start, end } : layer);
            if (value.sequenceId === "opening" && value.openingMode === "scene-first" && layers.find((layer) => layer.id === item.id)?.role === "character") sceneDuration = start;
          }
          else if (item.kind === "cue") subtitles = subtitles.map((cue) => cue.id === item.id ? { ...cue, start, end } : cue);
          else audio = audio.map((clip) => clip.id === item.id ? { ...clip, start, end } : clip);
        } else if (drag.kind.endsWith("-start")) {
          const start = Math.min(Math.max(0, item.start + moveDelta), item.end - 0.01);
          if (item.kind === "layer") {
            layers = layers.map((layer) => layer.id === item.id ? { ...layer, start } : layer);
            if (value.sequenceId === "opening" && value.openingMode === "scene-first" && layers.find((layer) => layer.id === item.id)?.role === "character") sceneDuration = start;
          } else if (item.kind === "cue") subtitles = subtitles.map((cue) => cue.id === item.id ? { ...cue, start } : cue);
          else audio = audio.map((clip) => clip.id === item.id ? { ...clip, start } : clip);
        } else {
          const end = Math.max(item.start + 0.01, item.end + moveDelta);
          if (item.kind === "layer") layers = layers.map((layer) => layer.id === item.id ? { ...layer, endMode: "manual", end } : layer);
          else if (item.kind === "cue") subtitles = subtitles.map((cue) => cue.id === item.id ? { ...cue, end } : cue);
          else audio = audio.map((clip) => clip.id === item.id ? { ...clip, autoEnd: false, end } : clip);
        }
      }
      return extendTimelineDuration({ ...value, layers, subtitles, audio, sceneDuration, duration: Math.max(value.duration, ...layers.map((layer) => layer.end)) });
    }, false);
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current && event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
  }

  function seekFromEvent(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest(".timeline-cue, .timeline-layer-clip, .timeline-audio-clip")) return;
    if (event.button !== 0) return;
    event.preventDefault();
    setInspector("sequence");
    setPreviewUntil(null);
    setSelectedClips([]);
    setSelectedAudioId(null);
    updateTimeline((value) => ({ ...value, selectedLayerId: null, selectedCueId: null }), false);
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubRef.current = event.pointerId;
    const rect = event.currentTarget.getBoundingClientRect();
    const value = (event.clientX - rect.left) / (TIMELINE_SCALE * zoom);
    setCurrentTime(snapTime(value, timeline?.snap ?? 0.1, duration));
    setPlaying(false);
  }

  function scrubMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (scrubRef.current !== event.pointerId) return;
    setPreviewUntil(null);
    const rect = event.currentTarget.getBoundingClientRect();
    setCurrentTime(Math.max(0, Math.min(duration, (event.clientX - rect.left) / (TIMELINE_SCALE * zoom))));
  }

  function endScrub(event: ReactPointerEvent<HTMLDivElement>) {
    if (scrubRef.current !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    scrubRef.current = null;
  }

  function scrollTimeline(event: ReactWheelEvent<HTMLDivElement>) {
    const delta = event.deltaX || (event.shiftKey ? event.deltaY : 0);
    if (!delta) return;
    event.currentTarget.scrollLeft += delta;
    event.preventDefault();
  }

  function beginStagePan(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest(".timeline-stage-controls"))) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    stagePanRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    setStagePanning(true);
  }

  function moveStagePan(event: ReactPointerEvent<HTMLDivElement>) {
    const pan = stagePanRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - pan.x;
    const deltaY = event.clientY - pan.y;
    if (deltaX === 0 && deltaY === 0) return;
    stagePanRef.current = { pointerId: pan.pointerId, x: event.clientX, y: event.clientY };
    setStageView((value) => panStageView(value, deltaX, deltaY));
  }

  function endStagePan(event: ReactPointerEvent<HTMLDivElement>) {
    const pan = stagePanRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    stagePanRef.current = null;
    setStagePanning(false);
  }

  function zoomStageAtCursor(event: ReactWheelEvent<HTMLDivElement>) {
    if (event.target instanceof Element && event.target.closest(".timeline-stage-controls")) return;
    const stage = event.currentTarget;
    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * rect.height : event.deltaY;
    const factor = Math.exp(-delta * 0.0015);
    setStageView((value) => zoomStageView(value, value.scale * factor, { x: event.clientX - rect.left, y: event.clientY - rect.top }, { width: rect.width, height: rect.height }));
    event.preventDefault();
  }

  function zoomStageBy(factor: number) {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    setStageView((value) => zoomStageView(value, value.scale * factor, { x: rect.width / 2, y: rect.height / 2 }, { width: rect.width, height: rect.height }));
  }

  function resetStagePan() {
    setStageView((value) => ({ ...value, x: 0, y: 0 }));
  }

  function fitStage() {
    setStageView(resetStageView());
  }

  function duplicateCue() {
    if (!selectedCue) return;
    const length = selectedCue.end - selectedCue.start;
    const start = selectedCue.end;
    const cue = { ...selectedCue, id: crypto.randomUUID(), start, end: start + length, text: { ...selectedCue.text } };
    updateTimeline((value) => extendTimelineDuration({ ...value, subtitles: [...value.subtitles, cue], selectedCueId: cue.id }));
    setSelectedClips([{ kind: "cue", id: cue.id }]);
    setInspector("cue");
  }

  function fitTimeline() { setZoom(Math.max(0.1, ((scrollRef.current?.clientWidth ?? 900) - 124) / (duration * TIMELINE_SCALE))); }

  useEffect(() => {
    const frame = requestAnimationFrame(fitTimeline);
    return () => cancelAnimationFrame(frame);
  }, [directory, timeline?.sequenceId]);

  useEffect(() => {
    stagePanRef.current = null;
    setStagePanning(false);
    setStageView(resetStageView());
    setSelectedClips([]);
  }, [directory, timeline?.sequenceId]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (isTextEditingTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && ["z", "y"].includes(key)) return;
      if ((event.ctrlKey || event.metaKey) && key === "s") { event.preventDefault(); void onSave(); }
      else if (key === " ") { event.preventDefault(); setPlaying((value) => !value); }
      else if (key === "arrowleft" || key === "arrowright") { event.preventDefault(); setPlaying(false); setCurrentTime((value) => Math.max(0, Math.min(duration, value + (key === "arrowright" ? 1 : -1) * (event.shiftKey ? 10 : 1) / 60))); }
      else if (key === "home" || key === "end") { event.preventDefault(); setPlaying(false); setCurrentTime(key === "home" ? 0 : duration); }
      else if (key === "delete" || key === "backspace") { event.preventDefault(); if (selectedClips.length > 0) deleteSelectedClips(); else if (inspector === "cue") deleteCue(); else if (inspector === "audio") deleteAudio(); }
      else if ((event.ctrlKey || event.metaKey) && key === "d") { event.preventDefault(); duplicateCue(); }
      else if (key === "s" && selectedCue) updateTimeline((value) => splitCue(value, selectedCue.id, currentTime));
      else if (key === "f") fitTimeline();
      else if (key === "escape") { setPlaying(false); clearTimelineSelection(); }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });

  if (!project || !timeline) return <div className="timeline-empty"><strong>Open a Spine asset folder first</strong><span>The timeline uses the selected character set plus matching <code>_bg</code> and <code>_scene</code> directories.</span></div>;

  const availableLayerDirectories = directories.filter((item) => !timeline.layers.some((layer) => layer.directory === item));
  const activeSubtitleTexts = timeline.subtitles
    .filter((cue) => cue.enabled && currentTime >= cue.start && currentTime <= cue.end)
    .map((cue) => previewCueText(cue, timeline.language))
    .filter((text) => text.trim().length > 0);
  const selectedClipDetails: SelectedClipDetail[] = [];
  for (const selection of selectedClips) {
    if (selection.kind === "layer") {
      const layer = timeline.layers.find((item) => item.id === selection.id);
      if (layer) selectedClipDetails.push({ ...selection, label: layer.name, start: layer.start, end: layerEnd(layer), enabled: layer.enabled, removable: layer.role !== "character" });
    } else if (selection.kind === "cue") {
      const cue = timeline.subtitles.find((item) => item.id === selection.id);
      if (cue) selectedClipDetails.push({ ...selection, label: cueText(cue, timeline.language) || "Subtitle cue", start: cue.start, end: cue.end, enabled: cue.enabled, removable: true });
    } else {
      const clip = timeline.audio.find((item) => item.id === selection.id);
      if (clip) selectedClipDetails.push({ ...selection, label: clip.name, start: clip.start, end: clip.end, enabled: clip.enabled, removable: true });
    }
  }
  const selectedTypeSummary = ([
    ["layer", selectedClipDetails.filter((item) => item.kind === "layer").length, "layer"],
    ["cue", selectedClipDetails.filter((item) => item.kind === "cue").length, "subtitle"],
    ["audio", selectedClipDetails.filter((item) => item.kind === "audio").length, "audio"],
  ] as const).filter(([, count]) => count > 0).map(([, count, label]) => `${count} ${label}${count === 1 ? "" : "s"}`).join(" · ");
  const deletableSelectionCount = selectedClipDetails.filter((item) => item.removable).length;

  return <>
    <div className="timeline-workspace">
      <aside className="editor-panel sequence-browser">
        <div className="editor-section">
          <div className="editor-section-title"><strong>Sequences</strong><span>{sequenceIds.length}</span></div>
          <div className="sequence-list">
            {sequenceIds.map((id) => <button key={id} className={`sequence-button${timeline.sequenceId === id ? " active" : ""}`} onClick={() => chooseSequence(id)}><strong>{id === "opening" ? "Opening" : `Talk ${id.replace("talk-", "").padStart(2, "0")}`}</strong></button>)}
            {(!timeline.sequenceId || timeline.sequenceId === "legacy") && <button className="sequence-button active"><strong>Recovered composition</strong></button>}
          </div>
        </div>
      </aside>
       <section className="timeline-main">
         <div className="sequence-heading"><div><strong>{timeline.sequenceId === "opening" ? "Opening / Intro" : timeline.sequenceId?.startsWith("talk-") ? `Talk ${timeline.sequenceId.replace("talk-", "")}` : "Recovered composition"}</strong><small>{timeline.sequenceId === "opening" ? "Compose the scene, character entrance, and idle hold." : "Synchronized Spine composition"}</small></div>{timeline.sequenceId === "opening" && <span className="opening-duration-badge">{timeline.durationMode === "auto" ? "AUTO" : "MANUAL"} · {seconds(duration)}</span>}</div>
         {timeline.sequenceId === "opening" && <div className="opening-phase-strip" aria-label="Opening phases">
           {openingPhases.map((phase) => <button key={phase.id} className={`opening-phase${currentTime >= phase.start && currentTime < phase.end ? " is-active" : ""}`} onClick={() => previewOpeningPhase(phase)} title={`Preview ${openingPhaseLabel(phase.id)}`}>
             <span><b>{openingPhaseLabel(phase.id)}</b><small>{seconds(phase.start)}–{seconds(phase.end)}</small></span><i>▶</i>
           </button>)}
         </div>}
         <div className="timeline-stage-wrap">
           <div
             ref={stageRef}
             className={`timeline-stage${stagePanning ? " is-panning" : ""}`}
             role="application"
             aria-label="Timeline preview canvas. Drag to pan and use the mouse wheel to zoom."
             onPointerDown={beginStagePan}
             onPointerMove={moveStagePan}
             onPointerUp={endStagePan}
             onPointerCancel={endStagePan}
             onWheel={zoomStageAtCursor}
             >
               <div className="timeline-stage-content" style={{ transform: `translate3d(${stageView.x}px, ${stageView.y}px, 0) scale(${stageView.scale})` }}>
                 {displayLayers.map((layer) => <TimelineLayerCanvas key={layer.id} layer={layer} files={files[layer.directory] ?? null} currentTime={currentTime} mainAnimation={mainAnimation} mainAnimationTime={mainAnimationTime} mainAnimationLoop={mainAnimationLoop} sequenceId={timeline.sequenceId} openingMode={timeline.openingMode} onMarkers={(next) => setMarkers((old) => old.join() === next.join() ? old : next)} sharedCameraPose={sharedCameraPose} referenceCamera={layer.role === "character"} onMeta={(id, meta) => setMetas((value) => ({ ...value, [id]: meta }))} onCameraPose={setSharedCameraPose} onAnimationDuration={onAnimationDuration} onError={onError} />)}
                 {timeline.audio.map((clip) => <audio key={clip.id} ref={(element) => { audioElementsRef.current[clip.id] = element; }} src={audioUrls[clip.id]} preload="auto" onLoadedMetadata={(event) => applyDecodedAudioDuration(clip.id, event.currentTarget.duration)} />)}
                 {!displayLayers.length && <div className="timeline-empty"><strong>No layers</strong><span>Add a Spine set from the ＋ Add menu.</span></div>}
               </div>
               {activeSubtitleTexts.length > 0 && <div className="timeline-subtitle-preview" aria-live="polite">
                 {activeSubtitleTexts.map((text, index) => <div key={`${index}-${text}`}>{text}</div>)}
               </div>}
               <div className="timeline-stage-controls" aria-label="Preview canvas controls" onPointerDown={(event) => event.stopPropagation()}>
               <button type="button" className="editor-icon-button" aria-label="Zoom out preview" title="Zoom out" onClick={() => zoomStageBy(0.8)}>−</button>
               <output className="timeline-stage-scale" aria-label="Preview zoom">{Math.round(stageView.scale * 100)}%</output>
               <button type="button" className="editor-icon-button" aria-label="Zoom in preview" title="Zoom in" onClick={() => zoomStageBy(1.25)}>＋</button>
               <button type="button" className="editor-button" onClick={resetStagePan} title="Center the preview without changing zoom">Reset pan</button>
               <button type="button" className="editor-button" onClick={fitStage} title="Reset zoom and center the preview">Fit</button>
             </div>
             <span className="timeline-stage-hint" aria-live="polite">{stagePanning ? "Release to stop panning" : "Drag to pan · Wheel to zoom"}</span>
            </div>
         </div>

         <div className="timeline-transport">
            <button className="editor-icon-button" aria-label={playing ? "Pause sequence" : "Play sequence"} onClick={() => { setPreviewUntil(null); setPlaying((value) => !value); }}>{playing ? "❚❚" : "▶"}</button>
            <button className="editor-button" onClick={() => { setPreviewUntil(null); setCurrentTime(0); setPlaying(false); }}>⏮ Start</button>
           {timeline.sequenceId === "opening" && <><button className="editor-button" onClick={() => stepOpeningPhase(-1)} disabled={!openingPhases.length}>◀ Phase</button><button className="editor-button" onClick={() => stepOpeningPhase(1)} disabled={!openingPhases.length}>Phase ▶</button></>}
            <button className="editor-button" onClick={() => { setPreviewUntil(null); setCurrentTime(duration); setPlaying(false); }}>End ⏭</button>
          <label className="editor-speed">Speed <input type="number" min="0.1" max="3" step="0.1" value={speed} onChange={(event) => setSpeed(Math.max(0.1, Number(event.target.value) || 1))} /></label>
          <label className="timeline-loop"><input type="checkbox" checked={timeline.loop} onChange={(event) => updateTimeline((value) => ({ ...value, loop: event.target.checked }))} /> Loop</label>
          <span className="editor-time">{seconds(currentTime)} / {seconds(duration)}</span>
        </div>

          <div className="timeline-editor-scroll" ref={scrollRef} onWheel={scrollTimeline}>
        <div className="timeline-ruler-row" style={{ minWidth: trackWidth + 116 }}>
          <div className="timeline-track-label">TRACKS</div>
           <div className="timeline-track timeline-ruler" style={{ width: trackWidth }} onPointerDown={seekFromEvent} onPointerMove={scrubMove} onPointerUp={endScrub} onPointerCancel={endScrub}>
            {Array.from({ length: Math.ceil(duration) + 1 }, (_, index) => <span key={index} style={{ left: index * TIMELINE_SCALE * zoom }}>{index}s</span>)}
            <i className="timeline-playhead" style={{ left: currentTime * TIMELINE_SCALE * zoom }} />
            {markers.map((time, index) => <i key={index} title={`Spine event ${time.toFixed(3)}s`} className="sequence-marker" style={{ left: time * TIMELINE_SCALE * zoom }} />)}
          </div>
        </div>
          <div className="timeline-track-rows" style={{ minWidth: trackWidth + 116 }} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
                {displayLayers.map((layer) => <div className="timeline-row" key={layer.id}>
               <div className="timeline-track-label" title={layer.directory}><b>{roleLabel(layer.role)}</b><span>{layer.name}</span></div>
                <div className={`timeline-track timeline-layer-track${layer.id === timeline.selectedLayerId ? " is-selected" : ""}`} onPointerDown={seekFromEvent}>
                    <div className={`timeline-layer-clip${isClipSelected("layer", layer.id) || layer.id === timeline.selectedLayerId ? " is-selected" : ""}`} title="Drag to move the layer; drag an edge to change its timing. Shift/Ctrl-click to select multiple." style={{ left: layer.start * TIMELINE_SCALE * zoom, width: Math.max(8, (layerEnd(layer) - layer.start) * TIMELINE_SCALE * zoom), zIndex: layer.order }} onPointerDown={(event) => { const selection = selectTimelineClip({ kind: "layer", id: layer.id }, event); if (selection) beginDrag(event, "layer", layer.id, layer.start, layerEnd(layer), selection); }}>
                     {timeline.sequenceId === "opening" && layer.role === "character" && introDuration > 0 && <>
                       <i className="timeline-layer-phase intro" style={{ width: Math.min(layerEnd(layer) - layer.start, introDuration) * TIMELINE_SCALE * zoom }} title={`Intro · ${seconds(introDuration)} actual Spine duration`}>INTRO</i>
                       <i className="timeline-layer-phase idle" style={{ left: introDuration * TIMELINE_SCALE * zoom, width: Math.max(0, layerEnd(layer) - layer.start - introDuration) * TIMELINE_SCALE * zoom }} title="Idle hold">IDLE</i>
                     </>}
                      <button type="button" className="timeline-clip-start-handle" aria-label={`Move ${layer.name} start`} title="Drag to change start time" onPointerDown={(event) => { event.stopPropagation(); const selection = selectTimelineClip({ kind: "layer", id: layer.id }, event); if (selection) beginDrag(event, "layer-start", layer.id, layer.start, layerEnd(layer), selection); }} />
                      <button type="button" className="timeline-clip-end-handle" aria-label={`Move ${layer.name} end`} title="Drag to change end time" onPointerDown={(event) => { event.stopPropagation(); const selection = selectTimelineClip({ kind: "layer", id: layer.id }, event); if (selection) beginDrag(event, "layer-end", layer.id, layer.start, layerEnd(layer), selection); }} />
                      <span className="timeline-layer-name">{layer.followMainAnimation ? "Follow main" : layer.animation || metas[layer.id]?.idleAnimation || "Animation"}</span>
                   </div>
                 <i className="timeline-playhead" style={{ left: currentTime * TIMELINE_SCALE * zoom }} />
               </div>
              </div>)}
            <div className="timeline-row subtitle-row">
              <div className="timeline-track-label"><b>SUBS</b><span>{timeline.language.toUpperCase()}</span></div>
              <div className="timeline-track timeline-subtitle-track" onPointerDown={seekFromEvent}>
                 {timeline.subtitles.map((cue) => <div key={cue.id} className={`timeline-cue${isClipSelected("cue", cue.id) || cue.id === timeline.selectedCueId ? " is-selected" : ""}${cue.enabled ? "" : " is-disabled"}`} style={{ left: cue.start * TIMELINE_SCALE * zoom, width: Math.max(12, (cue.end - cue.start) * TIMELINE_SCALE * zoom) }} onPointerDown={(event) => { const selection = selectTimelineClip({ kind: "cue", id: cue.id }, event); if (selection) beginDrag(event, "cue", cue.id, cue.start, cue.end, selection); }}>
                   <button className="timeline-cue-handle left" aria-label="Move subtitle start" onPointerDown={(event) => { event.stopPropagation(); const selection = selectTimelineClip({ kind: "cue", id: cue.id }, event); if (selection) beginDrag(event, "cue-start", cue.id, cue.start, cue.end, selection); }} />
                   <span>{cueText(cue, timeline.language)}</span>
                   <button className="timeline-cue-handle right" aria-label="Move subtitle end" onPointerDown={(event) => { event.stopPropagation(); const selection = selectTimelineClip({ kind: "cue", id: cue.id }, event); if (selection) beginDrag(event, "cue-end", cue.id, cue.start, cue.end, selection); }} />
                </div>)}
                <i className="timeline-playhead" style={{ left: currentTime * TIMELINE_SCALE * zoom }} />
              </div>
            </div>
            <div className="timeline-row audio-row">
              <div className="timeline-track-label"><b>AUDIO</b><span>{timeline.audio.length} clip{timeline.audio.length === 1 ? "" : "s"}</span></div>
              <div className="timeline-track timeline-audio-track" onPointerDown={seekFromEvent}>
                  {timeline.audio.map((clip) => <div key={clip.id} className={`timeline-audio-clip${isClipSelected("audio", clip.id) || clip.id === selectedAudio?.id ? " is-selected" : ""}${clip.enabled ? "" : " is-disabled"}`} title="Drag to move the audio; drag an edge to change its timing. Shift/Ctrl-click to select multiple." style={{ left: clip.start * TIMELINE_SCALE * zoom, width: Math.max(12, (clip.end - clip.start) * TIMELINE_SCALE * zoom) }} onPointerDown={(event) => { const selection = selectTimelineClip({ kind: "audio", id: clip.id }, event); if (selection) beginDrag(event, "audio", clip.id, clip.start, clip.end, selection); }}><button type="button" className="timeline-clip-start-handle" aria-label={`Move ${clip.name} start`} title="Drag to change start time" onPointerDown={(event) => { event.stopPropagation(); const selection = selectTimelineClip({ kind: "audio", id: clip.id }, event); if (selection) beginDrag(event, "audio-start", clip.id, clip.start, clip.end, selection); }} /><button type="button" className="timeline-clip-end-handle" aria-label={`Move ${clip.name} end`} title="Drag to change end time" onPointerDown={(event) => { event.stopPropagation(); const selection = selectTimelineClip({ kind: "audio", id: clip.id }, event); if (selection) beginDrag(event, "audio-end", clip.id, clip.start, clip.end, selection); }} /><AudioWaveform url={audioUrls[clip.id]} onDuration={(value) => applyDecodedAudioDuration(clip.id, value)} /><span>♫ {clip.name}</span></div>)}
                <i className="timeline-playhead" style={{ left: currentTime * TIMELINE_SCALE * zoom }} />
              </div>
            </div>
          </div>
         </div>
         <div className="timeline-bottom-tools">
           <label>Snap <select value={timeline.snap} onChange={(event) => updateTimeline((value) => ({ ...value, snap: Number(event.target.value) }))}><option value="0">Off</option><option value="0.01">10 ms</option><option value="0.1">100 ms</option><option value="0.25">250 ms</option><option value="0.5">500 ms</option></select></label>
           <label>Zoom <input type="range" min="0.5" max="3" step="0.1" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
           <button className="editor-button" onClick={fitTimeline}>Fit (F)</button>
            <details ref={addMenuRef} className="timeline-add-menu">
              <summary className="editor-button">＋ Add</summary>
              <div className="timeline-add-menu-popover">
                <button className="editor-button" onClick={() => { closeAddMenu(); addCue(); }}>Subtitle cue</button>
                <button className="editor-button" onClick={() => { closeAddMenu(); void importAudio(); }}>Audio files</button>
                <button className="editor-button" onClick={() => { closeAddMenu(); void importSubtitles(); }}>Import subtitles</button>
                <button className="editor-button" onClick={() => { closeAddMenu(); setLayerPickerOpen(true); }} disabled={!availableLayerDirectories.length}>Choose Spine layer…</button>
              </div>
            </details>
         </div>
      </section>

      <aside className="editor-panel timeline-inspector">
         {inspector === "sequence" && <section className="editor-section editor-inspector">
          <div className="editor-section-title"><strong>Sequence settings</strong><span>{seconds(duration)}</span></div>
            <label>{timeline.sequenceId === "opening" ? "Total duration (s)" : "Length (s)"}<input type="number" min="1" step="0.1" value={Number(duration.toFixed(3))} disabled={timeline.sequenceId === "opening" && timeline.durationMode === "auto"} onChange={(event) => updateTimeline((value) => ({ ...value, durationMode: value.sequenceId === "opening" ? "manual" : value.durationMode, duration: Math.max(1, Number(event.target.value) || 1) }))} /></label>
           <label><span className="timeline-inline-check"><input type="checkbox" checked={timeline.loop} onChange={(event) => updateTimeline((value) => ({ ...value, loop: event.target.checked }))} /> Loop sequence</span></label>
           {timeline.sequenceId === "opening" && <div className="opening-flow-editor">
             <div className="editor-subheading">Opening flow</div>
             <p className="editor-muted">Preview and tune each phase without guessing where the character entrance begins.</p>
              <label>Flow preset<select value={timeline.openingMode ?? "direct"} onChange={(event) => updateTimeline((value) => {
                const openingMode = event.target.value as "direct" | "scene-first" | "skip";
                const start = Math.max(0, value.sceneDuration ?? 3);
                return { ...value, openingMode, layers: openingMode === "scene-first" ? value.layers.map((layer) => layer.role === "character" ? { ...layer, start } : layer) : value.layers };
              })}><option value="scene-first">Scene → Intro → Idle</option><option value="direct">Intro → Idle</option><option value="skip">Idle only</option></select></label>
              {timeline.openingMode === "scene-first" && <label>Scene lead-in / intro start (s)<input type="number" min="0" step="0.1" value={Number((characterLayer?.start ?? timeline.sceneDuration ?? 0).toFixed(3))} onChange={(event) => updateTimeline((value) => {
                const start = Math.max(0, Number(event.target.value) || 0);
                return { ...value, sceneDuration: start, layers: value.layers.map((layer) => layer.role === "character" ? { ...layer, start } : layer) };
              })} /></label>}
             <div className="opening-intro-card"><span>Character intro animation</span><strong>{introAnimation || "No intro animation"}</strong><small>{introAnimation ? introDuration > 0 ? `${seconds(introDuration)} actual Spine duration` : "Reading Spine animation duration…" : "This asset set will go straight to idle."}</small></div>
              <div className="editor-two-fields"><label>Idle hold (s)<input type="number" min="0" step="0.1" value={Number(openingIdleDuration.toFixed(3))} onChange={(event) => updateTimeline((value) => {
                const idle = Math.max(0, Number(event.target.value) || 0);
                const start = value.layers.find((layer) => layer.role === "character")?.start ?? value.sceneDuration ?? 0;
                return { ...value, openingIdleDuration: idle, duration: value.durationMode === "auto" ? value.duration : Math.max(1, start + (value.openingMode === "skip" ? 0 : introDuration) + idle) };
              })} /></label><label><span className="timeline-inline-check"><input type="checkbox" checked={timeline.durationMode === "auto"} onChange={(event) => updateTimeline((value) => ({ ...value, durationMode: event.target.checked ? "auto" : "manual", duration: event.target.checked ? openingAutoDuration : value.duration }))} /> Automatic total</span><small className="editor-field-hint">{timeline.durationMode === "auto" ? `Updates to ${seconds(openingAutoDuration)}` : "Manual override"}</small></label></div>
             <div className="opening-phase-summary">{openingPhases.map((phase) => <button key={phase.id} onClick={() => previewOpeningPhase(phase)}><b>{openingPhaseLabel(phase.id)}</b><span>{seconds(phase.end - phase.start)}</span></button>)}</div>
           </div>}
          <div className="timeline-context-summary"><span>Layers <b>{displayLayers.length}</b></span><span>Subtitles <b>{timeline.subtitles.length}</b></span><span>Audio <b>{timeline.audio.length}</b></span></div>
          <p className="editor-muted">Select a clip in the timeline to edit its properties. Add content from the <b>＋ Add</b> menu.</p>
           {timeline.subtitles.some((cue, index, all) => all.some((other, j) => index !== j && cue.start < other.end && cue.end > other.start)) && <p className="editor-error">Overlapping subtitle cues: review timing before export.</p>}
         </section>}

         {inspector === "multi" && <section className="editor-section editor-inspector">
           <div className="editor-section-title"><strong>{selectedClipDetails.length} clips selected</strong><span>{selectedTypeSummary}</span></div>
           <p className="editor-muted">Drag any selected clip to move the group. Drag an edge to resize selected clips of the same type. Linked audio and subtitle timing moves together.</p>
           <div className="timeline-batch-actions">
             <button className="editor-button" onClick={() => setSelectedClipsEnabled(true)}>Enable all</button>
             <button className="editor-button" onClick={() => setSelectedClipsEnabled(false)}>Disable all</button>
           </div>
           <div className="timeline-batch-actions">
             <button className="editor-button" onClick={clearTimelineSelection}>Clear selection</button>
             <button className="editor-preview-button danger" disabled={!deletableSelectionCount} onClick={deleteSelectedClips}>Delete selected</button>
           </div>
           <div className="timeline-selection-list" aria-label="Selected clips">
             {selectedClipDetails.map((item) => <div key={`${item.kind}-${item.id}`}><span className={`timeline-selection-kind ${item.kind}`}>{item.kind === "cue" ? "SUB" : item.kind === "audio" ? "AUD" : "SPN"}</span><span title={item.label}>{item.label}</span><small>{seconds(item.start)}–{seconds(item.end)}{!item.removable ? " · main character" : ""}</small></div>)}
           </div>
         </section>}

         {inspector === "layer" && selectedLayer && <section className="editor-section editor-inspector">
          <div className="editor-section-title"><strong>Layer</strong><span><i className={`timeline-role-dot ${selectedLayer.role}`} /> {roleLabel(selectedLayer.role)} <button className="danger" onClick={removeLayer} disabled={selectedLayer.role === "character"}>Remove</button></span></div>
          <label>Name<input value={selectedLayer.name} onChange={(event) => updateLayer(selectedLayer.id, { name: event.target.value })} /></label>
          <div className="editor-two-fields"><label>Role<select value={selectedLayer.role} onChange={(event) => updateLayer(selectedLayer.id, { role: event.target.value as TimelineLayerRole })}><option value="background">Background</option><option value="scene">Scene</option><option value="character">Character</option><option value="overlay">Overlay</option></select></label><label>Order<input type="number" min="0" step="1" value={selectedLayer.order} onChange={(event) => updateLayer(selectedLayer.id, { order: Math.max(0, Number(event.target.value) || 0) })} /></label></div>
          <label>{selectedLayer.followMainAnimation ? "Fallback animation" : "Animation"}<select value={selectedLayer.animation || metas[selectedLayer.id]?.idleAnimation || ""} onChange={(event) => updateLayer(selectedLayer.id, { animation: event.target.value })}><option value="">Auto idle</option>{(metas[selectedLayer.id]?.animations ?? []).map((animation) => <option key={animation} value={animation}>{animation}</option>)}</select></label>
          {selectedLayer.role !== "character" && <label><span className="timeline-inline-check"><input type="checkbox" checked={selectedLayer.followMainAnimation === true} onChange={(event) => updateLayer(selectedLayer.id, { followMainAnimation: event.target.checked })} /> Follow main character animation</span><small className="editor-field-hint">Uses a matching animation and clock when available.</small></label>}
          <label>Face / secondary animation<select value={selectedLayer.faceAnimation ?? ""} onChange={(event) => updateLayer(selectedLayer.id, { faceAnimation: event.target.value })}><option value="">None</option>{(metas[selectedLayer.id]?.animations ?? []).map((name) => <option key={name}>{name}</option>)}</select></label>
          <div className="editor-two-fields"><label>Start (s)<input type="number" min="0" step="0.001" value={Number(selectedLayer.start.toFixed(3))} onChange={(event) => updateLayer(selectedLayer.id, { start: Math.max(0, Number(event.target.value) || 0) })} /></label><label>End (s)<input type="number" min="0.01" step="0.001" value={Number(selectedLayer.end.toFixed(3))} onChange={(event) => updateLayer(selectedLayer.id, { endMode: "manual", end: Math.max(selectedLayer.start + 0.01, Number(event.target.value) || selectedLayer.start + 0.01) })} /></label></div>
          <label><span className="timeline-inline-check"><input type="checkbox" checked={selectedLayer.endMode !== "manual"} onChange={(event) => updateLayer(selectedLayer.id, { endMode: event.target.checked ? "auto" : "manual" })} /> Use Spine animation end</span></label>
          <div className="editor-two-fields"><label>Animation offset (s)<input type="number" min="0" step="0.001" value={Number(selectedLayer.animationOffset.toFixed(3))} onChange={(event) => updateLayer(selectedLayer.id, { animationOffset: Math.max(0, Number(event.target.value) || 0) })} /></label><label><span>Playback</span><span className="timeline-inline-check"><input type="checkbox" checked={selectedLayer.loop} onChange={(event) => updateLayer(selectedLayer.id, { loop: event.target.checked })} /> Loop</span></label></div>
          <details><summary>Advanced transforms</summary><div className="editor-three-fields"><label>X<input type="number" step="1" value={selectedLayer.x} onChange={(event) => updateLayer(selectedLayer.id, { x: Number(event.target.value) || 0 })} /></label><label>Y<input type="number" step="1" value={selectedLayer.y} onChange={(event) => updateLayer(selectedLayer.id, { y: Number(event.target.value) || 0 })} /></label><label>Scale<input type="number" min="0.01" step="0.01" value={selectedLayer.scale} onChange={(event) => updateLayer(selectedLayer.id, { scale: Math.max(0.01, Number(event.target.value) || 0.01) })} /></label></div></details>
          <label>Opacity · {Math.round(selectedLayer.opacity * 100)}%<input type="range" min="0" max="1" step="0.01" value={selectedLayer.opacity} onChange={(event) => updateLayer(selectedLayer.id, { opacity: Number(event.target.value) })} /></label>
          <label><span className="timeline-inline-check"><input type="checkbox" checked={selectedLayer.enabled} onChange={(event) => updateLayer(selectedLayer.id, { enabled: event.target.checked })} /> Visible</span></label>
        </section>}

        {inspector === "cue" && selectedCue && <section className="editor-section editor-inspector">
          <div className="editor-section-title"><strong>Subtitle #{selectedCueIndex + 1}</strong><span>{seconds(selectedCue.start)}–{seconds(selectedCue.end)}</span></div>
          <div className="editor-two-fields subtitle-actions"><button className="editor-button" onClick={() => updateCue(selectedCue.id, { start: Math.min(currentTime, selectedCue.end - 0.01) })}>Start at playhead</button><button className="editor-button" onClick={() => updateCue(selectedCue.id, { end: Math.max(currentTime, selectedCue.start + 0.01) })}>End at playhead</button></div>
           <div className="editor-two-fields"><label>Start (s)<input aria-label="Subtitle start" type="number" min="0" step="0.001" value={Number(selectedCue.start.toFixed(3))} onChange={(event) => updateCue(selectedCue.id, { start: Math.max(0, Math.min(selectedCue.end - 0.01, Number(event.target.value) || 0)) })} /></label><label>End (s)<input aria-label="Subtitle end" type="number" min="0.01" step="0.001" value={Number(selectedCue.end.toFixed(3))} onChange={(event) => updateCue(selectedCue.id, { end: Math.max(selectedCue.start + 0.01, Number(event.target.value) || selectedCue.start + 0.01) })} /></label></div>
          <div className="subtitle-language-grid">{(["en", "ja", "ko"] as const).map((language) => <label className={`subtitle-language-field subtitle-language-${language}`} key={language}><span>{language.toUpperCase()}</span><textarea aria-label={`${language.toUpperCase()} Subtitle #${selectedCueIndex + 1}`} className="timeline-textarea" value={selectedCue.text[language]} onChange={(event) => updateCue(selectedCue.id, { text: { ...selectedCue.text, [language]: event.target.value } })} /></label>)}</div>
          <div className="subtitle-preview-language"><span>Preview language</span><div className="timeline-language-tabs">{(["en", "ja", "ko"] as const).map((language) => <button key={language} className={timeline.language === language ? "is-selected" : ""} onClick={() => updateTimeline((value) => ({ ...value, language }))}>{language.toUpperCase()}</button>)}</div></div>
          <div className="editor-two-fields subtitle-actions"><button className="editor-button" onClick={() => updateTimeline((value) => splitCue(value, selectedCue.id, currentTime))}>Split (S)</button><button className="editor-button" onClick={duplicateCue}>Duplicate</button><button className="editor-button" onClick={() => { setCurrentTime(selectedCue.start); setPreviewUntil(selectedCue.end); setPlaying(true); }}>Preview cue</button></div>
          <div className="editor-two-fields"><label><span className="timeline-inline-check"><input type="checkbox" checked={selectedCue.enabled} onChange={(event) => updateCue(selectedCue.id, { enabled: event.target.checked })} /> Visible</span></label><button className="editor-preview-button danger" onClick={deleteCue}>Delete cue</button></div>
        </section>}

        {inspector === "audio" && selectedAudio && <section className="editor-section editor-inspector">
          <div className="editor-section-title"><strong>Audio clip</strong><span>{seconds(selectedAudio.start)}–{seconds(selectedAudio.end)}</span></div>
          <label>Name<input value={selectedAudio.name} onChange={(event) => updateAudio(selectedAudio.id, { name: event.target.value })} /></label>
            <div className="editor-two-fields"><label>Start (s)<input type="number" min="0" step="0.001" value={Number(selectedAudio.start.toFixed(3))} onChange={(event) => updateAudio(selectedAudio.id, { start: Math.max(0, Math.min(selectedAudio.end - 0.01, Number(event.target.value) || 0)) })} /></label><label>End (s)<input type="number" min="0.01" step="0.001" value={Number(selectedAudio.end.toFixed(3))} onChange={(event) => updateAudio(selectedAudio.id, { autoEnd: false, end: Math.max(selectedAudio.start + 0.01, Number(event.target.value) || selectedAudio.start + 0.01) })} /></label></div>
          <label>Volume · {Math.round(selectedAudio.volume * 100)}%<input type="range" min="0" max="1" step="0.01" value={selectedAudio.volume} onChange={(event) => updateAudio(selectedAudio.id, { volume: Number(event.target.value) })} /></label>
          <label><span className="timeline-inline-check"><input type="checkbox" checked={selectedAudio.enabled} onChange={(event) => updateAudio(selectedAudio.id, { enabled: event.target.checked })} /> Enabled</span></label>
          {missingAudio.includes(selectedAudio.path) && <><p className="editor-error">Audio file is missing from the selected asset root.</p><button className="editor-button" onClick={() => void relinkAudio()}>Relink audio</button></>}
          <button className="editor-preview-button danger" onClick={deleteAudio}>Delete clip</button>
          <p className="editor-muted" title={selectedAudio.path}>{selectedAudio.path}</p>
        </section>}

        {((inspector === "layer" && !selectedLayer) || (inspector === "cue" && !selectedCue) || (inspector === "audio" && !selectedAudio)) && <div className="timeline-empty timeline-inspector-empty"><strong>Select a clip</strong><span>Choose a layer, subtitle, or audio clip in the timeline.</span></div>}
      </aside>
    </div>
    <AssetPickerModal open={layerPickerOpen} title="Add Spine layer" eyebrow="TIMELINE LAYER" description="Search the loaded catalog and add another background, scene, character, or overlay set." directories={availableLayerDirectories} emptyLabel="Every available asset set is already on this timeline." onClose={() => setLayerPickerOpen(false)} onSelect={(next) => { setLayerPickerOpen(false); addLayer(next); }} />
  </>;
}
