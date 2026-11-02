import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { type SpineCameraPose, type SpineFiles, type SpineMeta } from "../../../src/client/spine/spineRuntime";
import { DEFAULT_TALK_MIX_DURATION, normalizeAnimationMixDuration } from "../../../src/client/spine/spineInteraction";
import {
  compositionDirectories,
  createTimelineLayer,
  ensureTimelineLayers,
  type EditorAnimationClip,
  type EditorProject,
  type EditorAudioClip,
  type EditorSubtitleCue,
  type EditorTimelineLayer,
  type TimelineLanguage,
  type TimelineLayerRole,
} from "./editorModel";
import type { DesktopAssetSource } from "./desktopSource";
import { manifestReferenceCandidates } from "../../../src/client/spine/spineManifest";
import { audioPlaybackDecision, clampAudioEnd, clampAudioStart, decodedAudioTiming } from "./audioModel";
import { animationClipEnd, animationEndForLayer, authoredTimelineEnd, deleteAnimationClipRipple, duplicateAnimationClipRipple, effectiveAnimationClips, extendTimelineDuration, insertAnimationClipRipple, linkAudioToSubtitle, linkedSubtitleForAudio, matchAudioAndSubtitleLength, moveAnimationClipRipple, nextTalkSequenceId, openingTimelineDuration, replaceSubtitleImport, resolveTimelineSnap, snapToTargets, splitCue, switchSequence, talkSequenceId } from "./sequenceModel";
import { advanceSpineTimeline, timelineActiveSubtitleTexts, timelineAudioPreloadsReady, timelineLayerAnimation, timelineMainAnimation, timelinePlaybackDuration, timelineSceneHidesCharacter, type SpineTimelineAudioPreloadState } from "../../../src/client/spine/spineTimeline";
import { SpineTimelineLayerCanvas } from "../../../src/client/spine/SpineTimelineLayerCanvas";
import { spineAudioPathCandidates } from "../../../src/client/spine/spineAudio";
import { serializeSubtitleDocument } from "./subtitleDocument";
import type { RecentFile } from "./recentFiles";
import { AssetPickerModal } from "./AssetPickerModal";
import { characterDirectoryLabel, type CharacterDirectoryInfo, type CharacterDirectoryLabels } from "./characterCatalog";
import { isTextEditingTarget } from "./editorKeyboard";
import { panStageView, resetStageView, zoomStageView, type StageView } from "./stageView";
import { zoomTimelineAtCursor } from "./timelineView";
import { SubtitleTextEditor } from "./SubtitleTextEditor";
import { TimelineSplitHandle } from "./TimelineSplitHandle";
import { DEFAULT_TIMELINE_PREVIEW_SHARE, normalizeTimelinePreviewShare, TIMELINE_LAYOUT_PREFERENCES_KEY } from "./timelineLayout";
import "./timelineSnapFeedback.css";
import { IconChevronDown, IconChevronLeft, IconChevronRight, IconExpand, IconLink, IconMinus, IconPause, IconPlay, IconPlus, IconSkipBack, IconSkipForward, IconSound, IconSync, IconUnlink } from "../../../src/client/components/icons";

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
  directoryLabels?: CharacterDirectoryLabels;
  directoryInfo?: Readonly<Record<string, CharacterDirectoryInfo>>;
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

function seconds(value: number): string {
  return `${value.toFixed(3)}s`;
}

function snapTime(value: number, snap: number, duration: number): number {
  const next = snap > 0 ? Math.round(value / snap) * snap : value;
  return Math.max(0, Math.min(duration, Number(next.toFixed(3))));
}

function readTimelinePreviewShare(): number {
  try {
    const stored = localStorage.getItem(TIMELINE_LAYOUT_PREFERENCES_KEY);
    if (!stored) return DEFAULT_TIMELINE_PREVIEW_SHARE;
    const preferences = JSON.parse(stored) as { previewShare?: unknown };
    return normalizeTimelinePreviewShare(preferences.previewShare);
  } catch {
    return DEFAULT_TIMELINE_PREVIEW_SHARE;
  }
}

type TimelineClipKind = "layer" | "animation" | "cue" | "audio";
type TimelineSelection = { kind: TimelineClipKind; id: string };
type TimelineDragKind = TimelineClipKind | "layer-start" | "layer-end" | "animation-start" | "animation-end" | "cue-start" | "cue-end" | "audio-start" | "audio-end";
interface TimelineDragItem extends TimelineSelection { start: number; end: number; linked?: boolean; sourceDuration?: number }
interface TimelineDragState {
  kind: TimelineDragKind;
  id: string;
  x: number;
  start: number;
  end: number;
  items: TimelineDragItem[];
}
interface TimelineSnapFeedback { time: number; delta: number; source: "target" | "grid" }
interface SelectedClipDetail extends TimelineSelection {
  label: string;
  start: number;
  end: number;
  enabled: boolean;
  removable: boolean;
}

interface AudioUrlRecord {
  path: string;
  source: DesktopAssetSource;
  url: string;
}

interface PendingAudioLoad {
  path: string;
  source: DesktopAssetSource;
}

function cueText(cue: EditorSubtitleCue, language: TimelineLanguage): string {
  return cue.text[language] || cue.text.en || cue.text.ja || cue.text.ko || "Untitled subtitle";
}

function roleLabel(role: TimelineLayerRole): string {
  return role === "background" ? "BG" : role === "scene" ? "SCENE" : role === "character" ? "CHAR" : "OVERLAY";
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

async function findAudioFile(source: DesktopAssetSource, path: string): Promise<File | null> {
  for (const candidate of spineAudioPathCandidates(path)) {
    const file = await source.getFile(candidate);
    if (file) return file;
  }
  return null;
}

export function TimelineWorkspace({ source, directory, directories, directoryLabels = {}, directoryInfo = {}, project, initialSubtitlePath, onSubtitleOpened, initialAudioPaths, onAudioOpened, onRecentFile, onMutate, onLive, onBeginEdit, onSave, onRegisterSave, onStatus, onError }: TimelineWorkspaceProps) {
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [previewUntil, setPreviewUntil] = useState<number | null>(null);
  const [talkAutoplayActive, setTalkAutoplayActive] = useState(false);
  const [loopTalkList, setLoopTalkList] = useState(false);
  const [pauseBetweenTalks, setPauseBetweenTalks] = useState(0.35);
  const [pendingTalkSequence, setPendingTalkSequence] = useState<string | null>(null);
  const [metas, setMetas] = useState<Record<string, SpineMeta | null>>({});
  const [sharedCameraPose, setSharedCameraPose] = useState<SpineCameraPose | null>(null);
  const [files, setFiles] = useState<Record<string, SpineFiles | null>>({});
  const [animationDurations, setAnimationDurations] = useState<Record<string, number>>({});
  const [zoom, setZoom] = useState(1);
  const [previewShare, setPreviewShare] = useState(readTimelinePreviewShare);
  const [stageView, setStageView] = useState<StageView>(() => resetStageView());
  const [stagePanning, setStagePanning] = useState(false);
  const [markers, setMarkers] = useState<number[]>([]);
  const [dragSnapFeedback, setDragSnapFeedback] = useState<TimelineSnapFeedback | null>(null);
  const [inspector, setInspector] = useState<"sequence" | "layer" | "animation" | "cue" | "audio" | "multi">("sequence");
  const scrollRef = useRef<HTMLDivElement>(null);
  const stageWrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const stagePanRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const addMenuRef = useRef<HTMLDetailsElement>(null);
  const scrubRef = useRef<number | null>(null);
  const [selectedClips, setSelectedClips] = useState<TimelineSelection[]>([]);
  const [selectedAudioId, setSelectedAudioId] = useState<string | null>(null);
  const [layerPickerOpen, setLayerPickerOpen] = useState(false);
  const audioElementsRef = useRef<Record<string, HTMLAudioElement | null>>({});
  const audioUrlsRef = useRef<Record<string, string>>({});
  const audioUrlRecordsRef = useRef<Record<string, AudioUrlRecord>>({});
  const pendingAudioLoadsRef = useRef<Record<string, PendingAudioLoad>>({});
  const audioStartedRef = useRef<Record<string, boolean>>({});
  const audioPreviousTimeRef = useRef<Record<string, number | undefined>>({});
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});
  const [audioDurations, setAudioDurations] = useState<Record<string, number>>({});
  const [audioPreloadStates, setAudioPreloadStates] = useState<Record<string, SpineTimelineAudioPreloadState>>({});
  const [missingAudio, setMissingAudio] = useState<string[]>([]);
  const dragRef = useRef<TimelineDragState | null>(null);
  const subtitleDocumentsRef = useRef<Record<string, Record<string, unknown>>>({});
  const projectRef = useRef<EditorProject | null>(project);
  const sourceRef = useRef<DesktopAssetSource | null>(source);
  const directoryRef = useRef(directory);
  const subtitleSaveQueueRef = useRef(Promise.resolve());
  const currentTimeRef = useRef(currentTime);
  const talkAutoplayTimerRef = useRef<number | null>(null);
  const onMutateRef = useRef(onMutate);
  const sequenceContextRef = useRef({ animations: [] as string[], directories: [] as string[] });
  const saveSubtitleDocumentsRef = useRef<(getProject: () => EditorProject | null) => Promise<string[]>>(async () => []);
  const onRegisterSaveRef = useRef(onRegisterSave);
  const timelineKeydownRef = useRef<(event: KeyboardEvent) => void>(() => undefined);
  const openedSubtitleRef = useRef("");
  const openedAudioRef = useRef("");
  projectRef.current = project;
  currentTimeRef.current = currentTime;
  sourceRef.current = source;
  directoryRef.current = directory;
  onMutateRef.current = onMutate;
  onRegisterSaveRef.current = onRegisterSave;

  useEffect(() => {
    try {
      localStorage.setItem(TIMELINE_LAYOUT_PREFERENCES_KEY, JSON.stringify({ previewShare }));
    } catch { /* The split remains adjustable for this session. */ }
  }, [previewShare]);

  function pauseAudioElement(id: string) {
    const audio = audioElementsRef.current[id];
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
  }

  function setAudioPreloadState(id: string, state: SpineTimelineAudioPreloadState) {
    setAudioPreloadStates((value) => value[id] === state ? value : { ...value, [id]: state });
  }

  function clearAudioUrl(id: string) {
    const record = audioUrlRecordsRef.current[id];
    if (record) {
      URL.revokeObjectURL(record.url);
      delete audioUrlRecordsRef.current[id];
    } else {
      const url = audioUrlsRef.current[id];
      if (url) URL.revokeObjectURL(url);
    }
    delete audioUrlsRef.current[id];
    delete audioStartedRef.current[id];
    delete audioPreviousTimeRef.current[id];
    delete pendingAudioLoadsRef.current[id];
    setAudioPreloadState(id, "loading");
    pauseAudioElement(id);
    setAudioUrls((value) => {
      if (!(id in value)) return value;
      const next = { ...value };
      delete next[id];
      return next;
    });
  }

  function storeAudioUrl(id: string, path: string, url: string, nextSource: DesktopAssetSource) {
    const previous = audioUrlRecordsRef.current[id];
    if (previous && previous.url !== url) {
      URL.revokeObjectURL(previous.url);
      pauseAudioElement(id);
    }
    audioUrlRecordsRef.current[id] = { path, source: nextSource, url };
    audioUrlsRef.current[id] = url;
    audioStartedRef.current[id] = false;
    audioPreviousTimeRef.current[id] = undefined;
    setAudioPreloadState(id, "loading");
    setAudioUrls((value) => value[id] === url ? value : { ...value, [id]: url });
  }

  const timeline = project?.timeline ?? null;
  const audioLoadKey = (timeline?.audio ?? []).map((clip) => `${clip.id}:${clip.path}`).join("|");
  const audioPreloadIdentityRef = useRef({ source, key: audioLoadKey });
  const audioPreloadsReady = audioPreloadIdentityRef.current.source === source
    && audioPreloadIdentityRef.current.key === audioLoadKey
    && timelineAudioPreloadsReady(timeline?.audio ?? [], audioPreloadStates);
  const discovered = useMemo(() => directory ? compositionDirectories(directory, directories) : [], [directory, directories]);
  const displayLayers = useMemo(() => [...(timeline?.layers ?? [])].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)), [timeline?.layers]);
  const selectedLayer = timeline?.layers.find((layer) => layer.id === timeline.selectedLayerId) ?? null;
  const selectedCue = timeline?.subtitles.find((cue) => cue.id === timeline.selectedCueId) ?? null;
  const selectedCueIndex = selectedCue && timeline ? timeline.subtitles.findIndex((cue) => cue.id === selectedCue.id) : -1;
  const selectedAudio = timeline?.audio.find((clip) => clip.id === selectedAudioId) ?? null;
  function layerAnimationClips(layer: EditorTimelineLayer, value = timeline): EditorAnimationClip[] {
    if (!value) return [];
    const meta = metas[layer.id] ?? null;
    const intro = meta?.introAnimation ? animationDurations[`${layer.id}:${meta.introAnimation}`] ?? 0 : 0;
    return effectiveAnimationClips(layer, value, meta, intro);
  }
  function findAnimationClip(clipId: string, value = timeline): { layer: EditorTimelineLayer; clip: EditorAnimationClip } | null {
    for (const layer of value?.layers ?? []) {
      const clip = layerAnimationClips(layer, value).find((item) => item.id === clipId);
      if (clip) return { layer, clip };
    }
    return null;
  }
  const selectedAnimation = selectedClips.find((item) => item.kind === "animation");
  const selectedAnimationClip = selectedAnimation ? findAnimationClip(selectedAnimation.id) : null;
  const layerDirectoriesKey = displayLayers.map((layer) => layer.directory).join("|");
  const layerAssetPathsKey = JSON.stringify(displayLayers.map((layer) => [layer.directory, project?.timeline.assetPaths?.[layer.directory] ?? null]));
  const characterMeta = displayLayers.map((layer) => layer.role === "character" ? metas[layer.id] : null).find(Boolean);
  const characterLayer = displayLayers.find((layer) => layer.role === "character");
  const animations = characterMeta?.animations ?? [];
  const sequenceIds = useMemo(() => [...new Set(["opening", ...animations.filter((name) => /talk[_ -]?\d+/i.test(name)).map(talkSequenceId), ...Object.keys(project?.sequences ?? {}).filter((id) => id !== "legacy")])], [animations, project?.sequences]);
  const talkSequenceIds = useMemo(() => sequenceIds.filter((id) => /^talk-\d+$/i.test(id))
    .sort((a, b) => Number(a.match(/\d+$/)?.[0] ?? 0) - Number(b.match(/\d+$/)?.[0] ?? 0)), [sequenceIds]);
  sequenceContextRef.current = { animations, directories };
  const isTalkSequence = /^talk-\d+$/i.test(timeline?.sequenceId ?? "");

  function layerAnimation(layer: EditorTimelineLayer): string {
    const meta = metas[layer.id];
    if (!meta || !timeline) return layer.animation || meta?.idleAnimation || meta?.animations[0] || "";
    const intro = meta.introAnimation ? animationDurations[`${layer.id}:${meta.introAnimation}`] ?? 0 : 0;
    return timelineLayerAnimation(layer, meta, undefined, currentTime, timeline.sequenceId ?? "legacy", timeline.openingMode ?? "direct", intro);
  }

  function layerEnd(layer: EditorTimelineLayer): number {
    if (!layer.enabled) return 0;
    const talkCharacter = timeline?.sequenceId?.startsWith("talk-") && layer.role === "character" && layer.endMode !== "manual";
    const playbackLayer = talkCharacter ? { ...layer, loop: false } : layer;
    const clips = layerAnimationClips(playbackLayer);
    const enabledClips = clips.filter((clip) => clip.enabled !== false);
    if (enabledClips.length > 0) return Math.max(0, ...enabledClips.map((clip) => animationClipEnd(clip, animationDurations[`${layer.id}:${clip.animation}`] ?? 0)));
    if (Array.isArray(layer.animationClips)) return 0;
    const animationDuration = animationDurations[`${layer.id}:${layerAnimation(layer)}`] ?? 0;
    return animationEndForLayer(talkCharacter ? { ...layer, loop: false } : layer, animationDuration);
  }

  const openingMode = timeline?.openingMode ?? "direct";
  const introAnimation = characterMeta?.introAnimation ?? "";
  const introDuration = characterLayer && introAnimation ? animationDurations[`${characterLayer.id}:${introAnimation}`] ?? 0 : 0;
  const openingIntroStart = timeline?.sequenceId === "opening"
    ? Math.max(0, characterLayer?.start ?? timeline?.sceneDuration ?? 0)
    : 0;
  const explicitAnimationClips = displayLayers.some((layer) => Array.isArray(layer.animationClips));
  const openingIdleDuration = Math.max(0, timeline?.openingIdleDuration ?? 3);
  const mainCharacterAnimation = characterLayer ? layerAnimation(characterLayer) : "";
  const mainCharacterDuration = characterLayer && mainCharacterAnimation ? animationDurations[`${characterLayer.id}:${mainCharacterAnimation}`] ?? 0 : 0;
  const mainAnimationState = characterLayer && characterMeta && timeline
    ? timelineMainAnimation(characterLayer, characterMeta, currentTime, timeline.sequenceId ?? "legacy", openingMode, introDuration, mainCharacterDuration)
    : null;
  const mainAnimation = mainAnimationState?.animation ?? "";
  const mainAnimationTime = mainAnimationState?.time;
  const mainAnimationLoop = mainAnimationState?.loop;
  const talkMixDuration = normalizeAnimationMixDuration(project?.talkMixDuration, DEFAULT_TALK_MIX_DURATION);
  const openingAutoDuration = timeline?.sequenceId === "opening"
    ? openingTimelineDuration(timeline, introDuration, layerEnd)
    : 0;
  const duration = timeline
    ? timelinePlaybackDuration(timeline, timeline.sequenceId === "opening" && !explicitAnimationClips ? openingIntroStart + (openingMode === "skip" ? 0 : introDuration) : 0, layerEnd, talkMixDuration)
    : MIN_TIMELINE_DURATION;
  const autoTalkDuration = timeline && isTalkSequence
    ? timelinePlaybackDuration({ ...timeline, durationMode: "auto" }, 0, layerEnd, talkMixDuration)
    : 0;
  const talkBlendOutStart = isTalkSequence ? duration - talkMixDuration : undefined;
  const trackWidth = Math.max(640, duration * TIMELINE_SCALE * zoom + 48);
  const openingCharacterClips = timeline?.sequenceId === "opening" && characterLayer ? layerAnimationClips(characterLayer) : [];
  const characterHidden = timeline ? timelineSceneHidesCharacter(timeline, currentTime) : false;

  useEffect(() => {
    if (!timeline || timeline.sequenceId !== "opening" || timeline.durationMode !== "auto" || !characterMeta || (introAnimation && introDuration <= 0)) return;
    if (Math.abs(timeline.duration - openingAutoDuration) < 0.01) return;
    updateTimeline((value) => ({ ...value, duration: openingAutoDuration }), false);
  }, [characterMeta, duration, openingAutoDuration, introAnimation, introDuration, timeline]);

  useEffect(() => {
    if (!timeline || !isTalkSequence || timeline.durationMode !== "auto") return;
    const nextDuration = Math.max(1, autoTalkDuration - talkMixDuration);
    if (Math.abs(timeline.duration - nextDuration) < 0.01) return;
    updateTimeline((value) => ({ ...value, duration: nextDuration }), false);
  }, [autoTalkDuration, isTalkSequence, talkMixDuration, timeline]);

  function onAnimationDuration(layerId: string, animation: string, animationDuration: number) {
    const key = `${layerId}:${animation}`;
    setAnimationDurations((value) => value[key] === animationDuration ? value : { ...value, [key]: animationDuration });
    const currentTimeline = timeline;
    const currentLayer = currentTimeline?.layers.find((layer) => layer.id === layerId);
    if (!currentTimeline || !currentLayer) return;
    if (Array.isArray(currentLayer.animationClips)) {
      const nextClips = currentLayer.animationClips.map((clip) => {
        if (clip.animation !== animation || clip.endMode === "manual" || clip.loop) return clip;
        const end = animationClipEnd(clip, animationDuration);
        return Math.abs(clip.end - end) < 0.01 ? clip : { ...clip, end };
      });
      if (nextClips.every((clip, index) => clip === currentLayer.animationClips![index])) return;
      updateTimeline((value) => ({
        ...value,
        layers: value.layers.map((layer) => layer.id === layerId ? { ...layer, animationClips: nextClips } : layer),
        duration: Math.max(value.duration, ...nextClips.map((clip) => clip.end)),
      }), false);
      return;
    }
    if (currentLayer.endMode === "manual") return;
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
    if (talkAutoplayTimerRef.current !== null) window.clearTimeout(talkAutoplayTimerRef.current);
    talkAutoplayTimerRef.current = null;
    setPendingTalkSequence(null);
    setTalkAutoplayActive(false);
    onMutate((current) => switchSequence(current, id, animations, directories));
    currentTimeRef.current = 0;
    setCurrentTime(0); setPlaying(false); setPreviewUntil(null); setSelectedClips([]); setSelectedAudioId(null); setInspector("sequence");
  }

  function startTalkAutoplay() {
    const selected = talkSequenceIds.includes(timeline?.sequenceId ?? "") ? timeline?.sequenceId : talkSequenceIds[0];
    if (!selected) return;
    if (talkAutoplayTimerRef.current !== null) window.clearTimeout(talkAutoplayTimerRef.current);
    talkAutoplayTimerRef.current = null;
    setPendingTalkSequence(null);
    setTalkAutoplayActive(true);
    setPreviewUntil(null);
    currentTimeRef.current = 0;
    setCurrentTime(0);
    if (timeline?.sequenceId !== selected) onMutate((current) => switchSequence(current, selected, animations, directories));
    setPlaying(true);
  }

  function replayTalkSequence() {
    if (!isTalkSequence) return;
    if (talkAutoplayTimerRef.current !== null) window.clearTimeout(talkAutoplayTimerRef.current);
    talkAutoplayTimerRef.current = null;
    setPendingTalkSequence(null);
    setPreviewUntil(null);
    currentTimeRef.current = 0;
    setCurrentTime(0);
    setPlaying(true);
  }

  function stopTalkAutoplay() {
    if (talkAutoplayTimerRef.current !== null) window.clearTimeout(talkAutoplayTimerRef.current);
    talkAutoplayTimerRef.current = null;
    setPendingTalkSequence(null);
    setTalkAutoplayActive(false);
    setPreviewUntil(null);
    setPlaying(false);
    currentTimeRef.current = 0;
    setCurrentTime(0);
  }

  function previewOpeningClip(clip: EditorAnimationClip) {
    if (!characterLayer) return;
    previewAnimationClip(characterLayer, clip);
  }

  function previewAnimationClip(layer: EditorTimelineLayer, clip: EditorAnimationClip) {
    const end = animationClipEnd(clip, animationDurations[`${layer.id}:${clip.animation}`] ?? 0);
    setCurrentTime(clip.start);
    setPreviewUntil(Math.max(clip.start + 0.01, end));
    setPlaying(true);
  }

  function stepOpeningClip(direction: -1 | 1) {
    if (!openingCharacterClips.length) return;
    const index = openingCharacterClips.findIndex((clip) => currentTime >= clip.start && currentTime < animationClipEnd(clip, animationDurations[`${characterLayer?.id}:${clip.animation}`] ?? 0));
    const next = openingCharacterClips[Math.max(0, Math.min(openingCharacterClips.length - 1, (index < 0 ? 0 : index) + direction))];
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
        const assetPath = project?.timeline.assetPaths?.[layer.directory];
        const files = assetPath && source.getSetFilesAtPath
          ? await source.getSetFilesAtPath(assetPath)
          : await source.getSetFiles(layer.directory);
        return [layer.directory, files] as const;
      } catch (value) {
        if (!cancelled) onError(`${layer.directory}: ${value instanceof Error ? value.message : String(value)}`);
        return [layer.directory, null] as const;
      }
    })).then((entries) => {
      if (!cancelled) setFiles(Object.fromEntries(entries));
    });
    return () => { cancelled = true; };
  }, [layerAssetPathsKey, layerDirectoriesKey, onError, source]);

  useEffect(() => {
    const clips = timeline?.audio ?? [];
    audioPreloadIdentityRef.current = { source, key: audioLoadKey };
    const wanted = new Set(clips.map((clip) => clip.id));
    for (const id of Object.keys(audioUrlRecordsRef.current)) {
      if (wanted.has(id)) continue;
      clearAudioUrl(id);
    }
    for (const id of Object.keys(pendingAudioLoadsRef.current)) {
      if (!wanted.has(id)) delete pendingAudioLoadsRef.current[id];
    }
    setMissingAudio((value) => {
      const next = value.filter((path) => clips.some((clip) => clip.path === path));
      return next.length === value.length ? value : next;
    });
    setAudioPreloadStates((value) => {
      const next: Record<string, SpineTimelineAudioPreloadState> = {};
      for (const clip of clips) {
        const record = audioUrlRecordsRef.current[clip.id];
        const resourceMatches = record?.path === clip.path && record.source === source;
        next[clip.id] = resourceMatches
          ? value[clip.id] ?? (audioElementsRef.current[clip.id]?.readyState && audioElementsRef.current[clip.id]!.readyState >= 3 ? "ready" : "loading")
          : "loading";
      }
      return Object.keys(next).length === Object.keys(value).length && Object.keys(next).every((id) => next[id] === value[id]) ? value : next;
    });
    for (const clip of clips) {
      const record = audioUrlRecordsRef.current[clip.id];
      if (record && record.path === clip.path && record.source === source) {
        const audio = audioElementsRef.current[clip.id];
        const readiness = audio?.readyState !== undefined && audio.readyState >= 3 ? "ready" : "loading";
        if (audioPreloadStates[clip.id] !== "missing") setAudioPreloadState(clip.id, readiness);
        continue;
      }
      if (record) clearAudioUrl(clip.id);
      else if (audioPreloadStates[clip.id] === "missing") setAudioPreloadState(clip.id, "loading");
      if (!source) {
        delete pendingAudioLoadsRef.current[clip.id];
        setAudioPreloadState(clip.id, "missing");
        continue;
      }
      const pending = pendingAudioLoadsRef.current[clip.id];
      if (pending?.path === clip.path && pending.source === source) continue;
      const request: PendingAudioLoad = { path: clip.path, source };
      pendingAudioLoadsRef.current[clip.id] = request;
      void findAudioFile(source, clip.path).then((file) => {
        if (pendingAudioLoadsRef.current[clip.id] !== request) return;
        delete pendingAudioLoadsRef.current[clip.id];
        const currentClip = projectRef.current?.timeline.audio.find((item) => item.id === clip.id);
        if (sourceRef.current !== source || currentClip?.path !== clip.path) return;
        if (!file) {
          setMissingAudio((value) => value.includes(clip.path) ? value : [...value, clip.path]);
          setAudioPreloadState(clip.id, "missing");
          return;
        }
        setMissingAudio((value) => value.filter((path) => path !== clip.path));
        storeAudioUrl(clip.id, clip.path, URL.createObjectURL(file), source);
      }).catch(() => {
        if (pendingAudioLoadsRef.current[clip.id] !== request) return;
        delete pendingAudioLoadsRef.current[clip.id];
        if (sourceRef.current === source && projectRef.current?.timeline.audio.some((item) => item.id === clip.id && item.path === clip.path)) {
          setMissingAudio((value) => value.includes(clip.path) ? value : [...value, clip.path]);
          setAudioPreloadState(clip.id, "missing");
        }
      });
    }
  }, [audioLoadKey, source, timeline?.audio]);

  useEffect(() => () => {
    for (const record of Object.values(audioUrlRecordsRef.current)) URL.revokeObjectURL(record.url);
    for (const audio of Object.values(audioElementsRef.current)) audio?.pause();
    audioUrlsRef.current = {};
    audioUrlRecordsRef.current = {};
    pendingAudioLoadsRef.current = {};
  }, []);

  useEffect(() => {
    audioStartedRef.current = {};
    audioPreviousTimeRef.current = {};
    setAudioDurations({});
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
    if (!Number.isFinite(decodedDuration) || decodedDuration <= 0) return;
    setAudioDurations((value) => value[id] === decodedDuration ? value : { ...value, [id]: decodedDuration });
    if (!clip?.autoEnd) return;
    const timing = decodedAudioTiming(clip.start, decodedDuration);
    if (!timing) return;
    const linked = linkedSubtitleForAudio(currentTimeline, clip);
    const linkedTimingMatches = !linked || (Math.abs(linked.start - clip.start) < 0.01 && Math.abs(linked.end - timing.end) < 0.01);
    if (Math.abs(clip.end - timing.end) < 0.01 && linkedTimingMatches) return;
    updateTimeline((value) => matchAudioAndSubtitleLength(value, id, decodedDuration), false);
  }

  useEffect(() => {
    if (!audioPreloadsReady) {
      Object.values(audioElementsRef.current).forEach((audio) => audio?.pause());
      return;
    }
    for (const clip of timeline?.audio ?? []) {
      const audio = audioElementsRef.current[clip.id];
      if (!audio) continue;
      if (audioPreloadStates[clip.id] === "missing") {
        audio.pause();
        audioStartedRef.current[clip.id] = false;
        audioPreviousTimeRef.current[clip.id] = undefined;
        continue;
      }
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
  }, [audioPreloadsReady, audioUrls, currentTime, playing, speed, timeline?.audio]);

  useEffect(() => {
    if (!playing || !audioPreloadsReady) return;
    let previous = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const delta = Math.min(0.1, Math.max(0, (now - previous) / 1000));
      previous = now;
      const stopAt = previewUntil === null ? duration : Math.min(duration, previewUntil);
      const advanced = advanceSpineTimeline(currentTimeRef.current, delta, speed, stopAt, previewUntil === null && Boolean(timeline?.loop) && !talkAutoplayActive);
      currentTimeRef.current = advanced.time;
      setCurrentTime(advanced.time);
      if (advanced.finished) {
        setPlaying(false);
        if (previewUntil !== null) setPreviewUntil(null);
        else if (talkAutoplayActive && isTalkSequence && timeline?.sequenceId) {
          const next = nextTalkSequenceId(talkSequenceIds, timeline.sequenceId, loopTalkList);
          if (next) setPendingTalkSequence(next);
          else setTalkAutoplayActive(false);
        }
      } else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [audioPreloadsReady, duration, isTalkSequence, loopTalkList, playing, previewUntil, speed, talkAutoplayActive, talkSequenceIds, timeline?.audio, timeline?.loop, timeline?.sequenceId]);

  useEffect(() => {
    if (!pendingTalkSequence || !talkAutoplayActive) return;
    const timer = window.setTimeout(() => {
      talkAutoplayTimerRef.current = null;
      const context = sequenceContextRef.current;
      onMutateRef.current((current) => switchSequence(current, pendingTalkSequence, context.animations, context.directories));
      currentTimeRef.current = 0;
      setCurrentTime(0);
      setPreviewUntil(null);
      setPendingTalkSequence(null);
      setPlaying(true);
    }, Math.max(0, pauseBetweenTalks * 1000));
    talkAutoplayTimerRef.current = timer;
    return () => {
      window.clearTimeout(timer);
      if (talkAutoplayTimerRef.current === timer) talkAutoplayTimerRef.current = null;
    };
  }, [pauseBetweenTalks, pendingTalkSequence, talkAutoplayActive]);

  useEffect(() => () => {
    if (talkAutoplayTimerRef.current !== null) window.clearTimeout(talkAutoplayTimerRef.current);
  }, []);

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
        const serialized = serializeSubtitleDocument(document, current.assetDirectory, timelines);
        await currentSource.saveText(path, serialized);
        const record = await currentSource.getManifest?.(directoryRef.current);
        const legacyPath = record?.manifest.legacySubtitles
          ? manifestReferenceCandidates(record, record.manifest.legacySubtitles)[0]
          : undefined;
        if (legacyPath && legacyPath !== path) await currentSource.saveText(legacyPath, serialized);
        saved.push(path);
      }
      return saved;
    };
    const queued = subtitleSaveQueueRef.current.then(save, save);
    subtitleSaveQueueRef.current = queued.then(() => undefined, () => undefined);
    return queued;
  }

  saveSubtitleDocumentsRef.current = saveSubtitleDocuments;

  useEffect(() => {
    onRegisterSaveRef.current((getProject) => saveSubtitleDocumentsRef.current(getProject));
    return () => onRegisterSaveRef.current(null);
  }, []);

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

  function updateTalkMixDuration(value: number) {
    if (!Number.isFinite(value)) return;
    onMutate((current) => ({ ...current, talkMixDuration: Math.max(0, Math.min(2, value)) }));
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

  function updateAnimationClip(layerId: string, clipId: string, patch: Partial<EditorAnimationClip>, history = true) {
    updateTimeline((value) => {
      const layers = value.layers.map((layer) => {
        if (layer.id !== layerId) return layer;
        const clips = layerAnimationClips(layer, value);
        return { ...layer, animationClips: clips.map((clip) => clip.id === clipId ? { ...clip, ...patch } : clip) };
      });
      const end = Math.max(0, ...layers.map((layer) => Math.max(0, ...layerAnimationClips(layer, value).map((clip) => animationClipEnd(clip, animationDurations[`${layer.id}:${clip.animation}`] ?? 0)))));
      return extendTimelineDuration({ ...value, layers, duration: Math.max(value.duration, end) });
    }, history);
  }

  function moveAnimationClipTo(layerId: string, clipId: string, start: number) {
    updateTimeline((value) => {
      const owner = value.layers.find((layer) => layer.id === layerId);
      if (!owner) return value;
      const clips = layerAnimationClips(owner, value);
      const targets = value.layers.flatMap((layer) => layerAnimationClips(layer, value).filter((clip) => clip.id !== clipId).flatMap((clip) => [clip.start, clip.end]));
      const moved = moveAnimationClipRipple(clips, clipId, start, value.snap, targets);
      const layers = value.layers.map((layer) => layer.id === layerId ? { ...layer, animationClips: moved } : layer);
      return extendTimelineDuration({ ...value, layers, duration: Math.max(value.duration, ...moved.map((clip) => clip.end)) });
    });
  }

  function addAnimationClip(layerId = timeline?.selectedLayerId ?? characterLayer?.id ?? "") {
    if (!timeline || !layerId) return;
    const layer = timeline.layers.find((item) => item.id === layerId);
    const meta = layer ? metas[layer.id] : null;
    if (!layer || !meta) {
      onStatus("Wait for the selected Spine layer to finish loading before adding an animation clip.");
      return;
    }
    const animation = meta.idleAnimation || meta.animations.find((name) => /^idle(?:_|$)/i.test(name)) || meta.animations[0] || "";
    const start = snapTime(currentTime, timeline.snap, Number.POSITIVE_INFINITY);
    const duration = Math.max(0.1, animationDurations[`${layer.id}:${animation}`] ?? (timeline.sequenceId === "opening" ? openingIdleDuration || 3 : 2));
    const loop = /^idle(?:_|$)/i.test(animation);
    const clip: EditorAnimationClip = {
      id: `animation-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
      animation,
      start,
      end: start + (loop ? Math.max(duration, timeline.sequenceId === "opening" ? openingIdleDuration || 3 : duration) : duration),
      endMode: "auto",
      animationOffset: 0,
      loop,
      enabled: true,
      ...(timeline.sequenceId === "opening" && layer.role === "character" && loop ? { continueAfterOpening: true } : {}),
    };
    const clips = insertAnimationClipRipple(layerAnimationClips(layer), clip);
    updateTimeline((value) => ({ ...value, layers: value.layers.map((item) => item.id === layer.id ? { ...item, animationClips: clips } : item), selectedLayerId: layer.id }));
    setSelectedClips([{ kind: "animation", id: clip.id }]);
    setSelectedAudioId(null);
    setInspector("animation");
    onStatus(`Added ${animation || "animation"} at ${seconds(start)}.`);
  }

  function duplicateSelectedAnimationClip() {
    if (!selectedAnimationClip) return;
    const id = `animation-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
    updateTimeline((value) => {
      const layer = value.layers.find((item) => item.id === selectedAnimationClip.layer.id);
      if (!layer) return value;
      const clips = duplicateAnimationClipRipple(layerAnimationClips(layer, value), selectedAnimationClip.clip.id, id);
      return { ...value, layers: value.layers.map((item) => item.id === layer.id ? { ...item, animationClips: clips } : item) };
    });
    setSelectedClips([{ kind: "animation", id }]);
    setInspector("animation");
  }

  function updateCue(id: string, patch: Partial<EditorSubtitleCue>, history = true) {
    updateTimeline((value) => extendTimelineDuration({ ...value, subtitles: value.subtitles.map((cue) => cue.id === id ? { ...cue, ...patch } : cue) }), history);
  }

  function updateAudio(id: string, patch: Partial<EditorAudioClip>, history = true) {
    updateTimeline((value) => extendTimelineDuration({ ...value, audio: value.audio.map((clip) => clip.id === id ? { ...clip, ...patch } : clip) }), history);
  }

  function setAudioSubtitleLink(audioId: string, subtitleId: string | null) {
    updateTimeline((value) => linkAudioToSubtitle(value, audioId, subtitleId));
    setPreviewUntil(null);
  }

  function matchSelectedAudioLength() {
    if (!selectedAudio || selectedAudioDuration === undefined) {
      onStatus("Decode the audio first before matching its length.");
      return;
    }
    const linked = timeline ? linkedSubtitleForAudio(timeline, selectedAudio) : null;
    updateTimeline((value) => matchAudioAndSubtitleLength(value, selectedAudio.id, selectedAudioDuration));
    onStatus(linked ? "Matched the audio clip and linked subtitle to the source duration." : "Matched the audio clip to the source duration.");
  }

  function previewSelectedAudio() {
    if (!selectedAudio) return;
    setCurrentTime(selectedAudio.start);
    setPreviewUntil(selectedAudio.end);
    setPlaying(true);
  }

  function addAudioFiles(selected: Array<{ path: string; file: File }>) {
    if (!selected.length || !timeline || !source) return;
    const clips = selected.map(({ path, file }, index): EditorAudioClip => {
      const id = `audio-file-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`;
      const start = snapTime(currentTime + index * 0.01, timeline.snap, Number.POSITIVE_INFINITY);
      storeAudioUrl(id, path, URL.createObjectURL(file), source);
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
    } else if (selection.kind === "animation") {
      const found = findAnimationClip(selection.id);
      if (!found) return;
      setSelectedAudioId(null);
      setInspector("animation");
      updateTimeline((value) => ({ ...value, selectedLayerId: found.layer.id, selectedCueId: null }), false);
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
    if (!selected.length || !timeline || !source) return;
    const missing = timeline.audio.filter((clip) => missingAudio.includes(clip.path) && !audioUrlsRef.current[clip.id]);
    const used = new Set<string>();
    let linked = 0;
    for (const { path, file } of selected) {
      const fileName = (path.split(/[\\/]/).pop() ?? path).toLocaleLowerCase();
      const clip = missing.find((candidate) => !used.has(candidate.id) && (candidate.path.split(/[\\/]/).pop() ?? candidate.path).toLocaleLowerCase() === fileName);
      if (!clip) continue;
      used.add(clip.id);
      delete pendingAudioLoadsRef.current[clip.id];
      storeAudioUrl(clip.id, clip.path, URL.createObjectURL(file), source);
      setMissingAudio((value) => value.filter((path) => path !== clip.path));
      linked += 1;
    }
    onStatus(linked ? `Relinked ${linked} audio clip${linked === 1 ? "" : "s"}.` : "No selected audio filenames matched the missing clips.");
  }

  function deleteCue() {
    if (!selectedCue) return;
    updateTimeline((value) => {
      const subtitles = value.subtitles.filter((cue) => cue.id !== selectedCue.id);
      const audio = value.audio.map((clip) => clip.subtitleId === selectedCue.id ? { ...clip, subtitleId: null } : clip);
      return { ...value, subtitles, audio, selectedCueId: null };
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
    const animations = new Set(selectedClips.filter((item) => item.kind === "animation").map((item) => item.id));
    const cues = new Set(selectedClips.filter((item) => item.kind === "cue").map((item) => item.id));
    const audio = new Set(selectedClips.filter((item) => item.kind === "audio").map((item) => item.id));
    const removableLayers = new Set(timeline.layers.filter((layer) => layers.has(layer.id) && layer.role !== "character").map((layer) => layer.id));
    updateTimeline((value) => ({
      ...value,
      layers: value.layers.filter((layer) => !removableLayers.has(layer.id)).map((layer) => {
        const clips = layerAnimationClips(layer, value);
        const selected = clips.filter((clip) => animations.has(clip.id));
        if (!selected.length) return layer;
        return { ...layer, animationClips: selected.reduce((current, clip) => deleteAnimationClipRipple(current, clip.id), clips) };
      }),
      subtitles: value.subtitles.filter((cue) => !cues.has(cue.id)),
      audio: value.audio.filter((clip) => !audio.has(clip.id)).map((clip) => clip.subtitleId && cues.has(clip.subtitleId) ? { ...clip, subtitleId: null } : clip),
      selectedLayerId: removableLayers.has(value.selectedLayerId ?? "") ? null : value.selectedLayerId,
      selectedCueId: cues.has(value.selectedCueId ?? "") ? null : value.selectedCueId,
    }));
    for (const id of audio) {
      clearAudioUrl(id);
    }
    setSelectedClips([]);
    setSelectedAudioId(null);
    setInspector("sequence");
  }

  function setSelectedClipsEnabled(enabled: boolean) {
    if (!selectedClips.length) return;
    const layers = new Set(selectedClips.filter((item) => item.kind === "layer").map((item) => item.id));
    const animations = new Set(selectedClips.filter((item) => item.kind === "animation").map((item) => item.id));
    const cues = new Set(selectedClips.filter((item) => item.kind === "cue").map((item) => item.id));
    const audio = new Set(selectedClips.filter((item) => item.kind === "audio").map((item) => item.id));
    updateTimeline((value) => ({
      ...value,
      layers: value.layers.map((layer) => {
        const clips = layerAnimationClips(layer, value);
        const hasAnimationSelection = clips.some((clip) => animations.has(clip.id));
        if (!layers.has(layer.id) && !hasAnimationSelection) return layer;
        return {
          ...layer,
          ...(layers.has(layer.id) ? { enabled } : {}),
          ...(hasAnimationSelection ? { animationClips: clips.map((clip) => animations.has(clip.id) ? { ...clip, enabled } : clip) } : {}),
        };
      }),
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
    if (selection.kind === "animation") {
      const found = findAnimationClip(selection.id);
      return found ? { ...selection, start: found.clip.start, end: animationClipEnd(found.clip, animationDurations[`${found.layer.id}:${found.clip.animation}`] ?? 0) } : null;
    }
    if (selection.kind === "cue") {
      const cue = timeline.subtitles.find((item) => item.id === selection.id);
      return cue ? { ...selection, start: cue.start, end: cue.end } : null;
    }
    const audio = timeline.audio.find((item) => item.id === selection.id);
    return audio ? { ...selection, start: audio.start, end: audio.end, sourceDuration: audioDurations[audio.id] } : null;
  }

  function linkedSubtitleItems(items: TimelineDragItem[]): TimelineDragItem[] {
    if (!timeline) return [];
    const existing = new Set(items.filter((item) => item.kind === "cue").map((item) => item.id));
    return items.flatMap((item) => {
      if (item.kind !== "audio" || !item.linked) return [];
      const clip = timeline.audio.find((candidate) => candidate.id === item.id);
      if (!clip) return [];
      const cue = linkedSubtitleForAudio(timeline, clip);
      if (!cue) return [];
      if (existing.has(cue.id)) return [];
      existing.add(cue.id);
      return [{ kind: "cue" as const, id: cue.id, start: cue.start, end: cue.end, linked: true }];
    });
  }

  function beginDrag(event: ReactPointerEvent<HTMLElement>, kind: TimelineDragKind, id: string, start: number, end: number, selection: TimelineSelection[] = selectedClips) {
    event.stopPropagation();
    setDragSnapFeedback(null);
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
    const selectedAnimationIds = new Set(drag.items.filter((item) => item.kind === "animation").map((item) => item.id));
    const selectedAudioIds = new Set(drag.items.filter((item) => item.kind === "audio").map((item) => item.id));
    const animationTargets = timeline.layers.flatMap((layer) => layerAnimationClips(layer).filter((clip) => !selectedAnimationIds.has(clip.id)).flatMap((clip) => [clip.start, clip.end]));
    const audioTargets = timeline.audio.filter((clip) => !selectedAudioIds.has(clip.id)).flatMap((clip) => [clip.start, clip.end]);
    const targets = [...markers, currentTime, ...animationTargets, ...audioTargets, ...timeline.subtitles.filter((cue) => !selectedCueIds.has(cue.id)).flatMap((cue) => [cue.start, cue.end])];
    const resizeAnchor = drag.kind.endsWith("-end") ? drag.end : drag.start;
    const snapResolution = resolveTimelineSnap(resizeAnchor + delta, event.altKey ? 0 : timeline.snap, event.altKey ? [] : targets);
    const snappedDelta = snapResolution.value - resizeAnchor;
    const moveItems = drag.items.filter((item) => !item.linked || !resize);
    const moveDelta = resize ? snappedDelta : Math.max(-Math.min(...moveItems.map((item) => item.start)), snappedDelta);
    setDragSnapFeedback(snapResolution.source ? { time: snapResolution.value, delta: resize ? snappedDelta : moveDelta, source: snapResolution.source } : null);

    updateTimeline((value) => {
      let layers = value.layers;
      let subtitles = value.subtitles;
      let audio = value.audio;
      let sceneDuration = value.sceneDuration;
      for (const item of drag.items) {
        if (resize && (item.kind !== resizeKind || item.linked)) continue;
        if (!resize) {
          const start = Math.max(0, item.start + moveDelta);
          const length = item.kind === "audio" && item.sourceDuration !== undefined
            ? Math.min(item.end - item.start, Math.max(0.01, item.sourceDuration))
            : item.end - item.start;
          const end = Math.max(start + 0.01, start + length);
          if (item.kind === "layer") {
            layers = layers.map((layer) => layer.id === item.id ? { ...layer, start, end } : layer);
            if (value.sequenceId === "opening" && value.openingMode === "scene-first" && layers.find((layer) => layer.id === item.id)?.role === "character") sceneDuration = start;
          } else if (item.kind === "animation") {
            if (item.id !== drag.id) continue;
            const owner = layers.find((layer) => layerAnimationClips(layer, value).some((clip) => clip.id === item.id));
            if (!owner) continue;
            let clips = moveAnimationClipRipple(layerAnimationClips(owner, value), item.id, item.start + moveDelta, 0, targets);
            const selectedItems = drag.items.filter((candidate) => candidate.kind === "animation" && clips.some((clip) => clip.id === candidate.id));
            if (selectedItems.length > 1) clips = clips.map((clip) => {
              const selectedItem = selectedItems.find((candidate) => candidate.id === clip.id);
              if (!selectedItem) return clip;
              const nextStart = Math.max(0, selectedItem.start + moveDelta);
              return { ...clip, start: nextStart, end: nextStart + (selectedItem.end - selectedItem.start) };
            });
            layers = layers.map((layer) => layer.id === owner.id ? { ...layer, animationClips: clips } : layer);
          }
          else if (item.kind === "cue") subtitles = subtitles.map((cue) => cue.id === item.id ? { ...cue, start, end } : cue);
          else audio = audio.map((clip) => clip.id === item.id ? { ...clip, start, end } : clip);
        } else if (drag.kind.endsWith("-start")) {
          const start = item.kind === "audio" && item.sourceDuration !== undefined
            ? clampAudioStart(item.end, item.start + moveDelta, item.sourceDuration)
            : Math.min(Math.max(0, item.start + moveDelta), item.end - 0.01);
          if (item.kind === "layer") {
            layers = layers.map((layer) => layer.id === item.id ? { ...layer, start } : layer);
            if (value.sequenceId === "opening" && value.openingMode === "scene-first" && layers.find((layer) => layer.id === item.id)?.role === "character") sceneDuration = start;
          } else if (item.kind === "animation") {
            const owner = layers.find((layer) => layerAnimationClips(layer, value).some((clip) => clip.id === item.id));
            if (!owner) continue;
            const clips = layerAnimationClips(owner, value).map((clip) => clip.id === item.id
              ? { ...clip, start, animationOffset: Math.max(0, clip.animationOffset + start - clip.start) }
              : clip);
            layers = layers.map((layer) => layer.id === owner.id ? { ...layer, animationClips: clips } : layer);
          } else if (item.kind === "cue") subtitles = subtitles.map((cue) => cue.id === item.id ? { ...cue, start } : cue);
          else audio = audio.map((clip) => clip.id === item.id ? { ...clip, start } : clip);
        } else {
          const requestedEnd = Math.max(item.start + 0.01, item.end + moveDelta);
          const end = item.kind === "audio" && item.sourceDuration !== undefined
            ? clampAudioEnd(item.start, requestedEnd, item.sourceDuration)
            : requestedEnd;
          if (item.kind === "layer") layers = layers.map((layer) => layer.id === item.id ? { ...layer, endMode: "manual", end } : layer);
          else if (item.kind === "animation") {
            const owner = layers.find((layer) => layerAnimationClips(layer, value).some((clip) => clip.id === item.id));
            if (!owner) continue;
            const clips = layerAnimationClips(owner, value).map((clip) => clip.id === item.id ? { ...clip, endMode: "manual" as const, end } : clip);
            layers = layers.map((layer) => layer.id === owner.id ? { ...layer, animationClips: clips } : layer);
          }
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
    setDragSnapFeedback(null);
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
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const scroller = event.currentTarget;
      const rect = scroller.getBoundingClientRect();
      if (!rect.width) return;
      const next = zoomTimelineAtCursor(zoom, scroller.scrollLeft, event.clientX - rect.left, event.deltaY, event.deltaMode, scroller.clientHeight);
      if (next.zoom === zoom) return;
      scroller.scrollLeft = next.scrollLeft;
      setZoom(next.zoom);
      return;
    }
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

  timelineKeydownRef.current = (event: KeyboardEvent) => {
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

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => timelineKeydownRef.current(event);
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);

  if (!project || !timeline) return <div className="timeline-empty"><strong>Open a Spine asset folder first</strong><span>The timeline uses the selected character set plus matching <code>_bg</code> and <code>_scene</code> directories.</span></div>;

  const availableLayerDirectories = directories.filter((item) => !timeline.layers.some((layer) => layer.directory === item));
  const activeSubtitleTexts = timelineActiveSubtitleTexts(timeline, currentTime);
  const selectedClipDetails: SelectedClipDetail[] = [];
  for (const selection of selectedClips) {
    if (selection.kind === "layer") {
      const layer = timeline.layers.find((item) => item.id === selection.id);
      if (layer) selectedClipDetails.push({ ...selection, label: layer.name, start: layer.start, end: layerEnd(layer), enabled: layer.enabled, removable: layer.role !== "character" });
    } else if (selection.kind === "animation") {
      const found = findAnimationClip(selection.id);
      if (found) selectedClipDetails.push({ ...selection, label: found.clip.animation || "Animation", start: found.clip.start, end: animationClipEnd(found.clip, animationDurations[`${found.layer.id}:${found.clip.animation}`] ?? 0), enabled: found.clip.enabled !== false, removable: true });
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
    ["animation", selectedClipDetails.filter((item) => item.kind === "animation").length, "animation"],
    ["cue", selectedClipDetails.filter((item) => item.kind === "cue").length, "subtitle"],
    ["audio", selectedClipDetails.filter((item) => item.kind === "audio").length, "audio"],
  ] as const).filter(([, count]) => count > 0).map(([, count, label]) => `${count} ${label}${count === 1 ? "" : "s"}`).join(" · ");
  const deletableSelectionCount = selectedClipDetails.filter((item) => item.removable).length;
  const selectedAudioDuration = selectedAudio ? audioDurations[selectedAudio.id] : undefined;
  const selectedAudioLinkedSubtitle = selectedAudio && timeline ? linkedSubtitleForAudio(timeline, selectedAudio) : null;
  const selectedAudioLinkCandidate = selectedAudioLinkedSubtitle ?? (selectedAudio && timeline
    ? [...timeline.subtitles].sort((a, b) => Math.abs(a.start - selectedAudio.start) - Math.abs(b.start - selectedAudio.start))[0] ?? null
    : null);
  const selectedAudioMaximumEnd = selectedAudio && selectedAudioDuration !== undefined
    ? clampAudioEnd(selectedAudio.start, Number.POSITIVE_INFINITY, selectedAudioDuration)
    : undefined;
  const selectedAudioMinimumStart = selectedAudio && selectedAudioDuration !== undefined
    ? clampAudioStart(selectedAudio.end, Number.NEGATIVE_INFINITY, selectedAudioDuration)
    : 0;

  return <>
    <div className="timeline-workspace">
      <aside className="editor-panel sequence-browser">
        <div className="editor-section">
          <div className="editor-section-title"><strong>Sequences</strong><span>{sequenceIds.length}</span></div>
          <div className="timeline-talk-playlist-actions">
            {talkAutoplayActive
              ? <button className="editor-preview-button danger" type="button" onClick={stopTalkAutoplay}>Stop Talk autoplay</button>
              : <button className="editor-button" type="button" disabled={!talkSequenceIds.length} onClick={startTalkAutoplay}><IconPlay /> Play Talk list</button>}
          </div>
          <div className="sequence-list">
            {sequenceIds.map((id) => <button key={id} className={`sequence-button${timeline.sequenceId === id ? " active" : ""}`} onClick={() => chooseSequence(id)}><strong>{id === "opening" ? "Opening" : `Talk ${id.replace("talk-", "").padStart(2, "0")}`}</strong></button>)}
            {(!timeline.sequenceId || timeline.sequenceId === "legacy") && <button className="sequence-button active"><strong>Recovered composition</strong></button>}
          </div>
        </div>
      </aside>
       <section className="timeline-main">
          <div className="sequence-heading"><div><strong>{timeline.sequenceId === "opening" ? "Opening / Intro" : timeline.sequenceId?.startsWith("talk-") ? `Talk ${timeline.sequenceId.replace("talk-", "")}` : "Recovered composition"}</strong><small>{timeline.sequenceId === "opening" ? "Arrange character and scene animation clips on their own tracks." : "Synchronized Spine composition"}</small></div>{(timeline.sequenceId === "opening" || isTalkSequence) && <span className="opening-duration-badge">{timeline.durationMode === "auto" ? "AUTO" : "MANUAL"} · {seconds(duration)}</span>}</div>
          {timeline.sequenceId === "opening" && <div className="opening-phase-strip" aria-label="Opening animation clips">
            {openingCharacterClips.map((clip, index) => {
              const end = animationClipEnd(clip, animationDurations[`${characterLayer?.id}:${clip.animation}`] ?? 0);
              return <button key={clip.id} className={`opening-phase${currentTime >= clip.start && currentTime < end ? " is-active" : ""}`} onClick={() => previewOpeningClip(clip)} title={`Preview ${clip.animation || `Animation ${index + 1}`}`}>
                <span><b>{clip.animation || `Animation ${index + 1}`}</b><small>{seconds(clip.start)}–{seconds(end)}{clip.continueAfterOpening ? " · continues" : ""}</small></span><i><IconPlay /></i>
              </button>;
            })}
          </div>}
         <div className="timeline-stage-wrap" ref={stageWrapRef} style={{ flex: `${previewShare} 1 0` }}>
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
                    {displayLayers.map((layer) => <SpineTimelineLayerCanvas key={layer.id} layer={layer} files={files[layer.directory] ?? null} currentTime={currentTime} mainAnimation={mainAnimation} mainAnimationTime={mainAnimationTime} mainAnimationLoop={mainAnimationLoop} sequenceId={timeline.sequenceId} openingMode={timeline.openingMode} talkMixDuration={talkMixDuration} talkBlendOutStart={talkBlendOutStart} characterHidden={characterHidden} onMarkers={(next) => setMarkers((old) => old.join() === next.join() ? old : next)} sharedCameraPose={sharedCameraPose} referenceCamera={layer.role === "character"} onMeta={(id, meta) => setMetas((value) => ({ ...value, [id]: meta }))} onCameraPose={setSharedCameraPose} onAnimationDuration={onAnimationDuration} onError={onError} />)}
                  {timeline.audio.map((clip) => <audio key={clip.id} ref={(element) => { audioElementsRef.current[clip.id] = element; }} src={audioUrls[clip.id]} preload="auto" onLoadedMetadata={(event) => applyDecodedAudioDuration(clip.id, event.currentTarget.duration)} onCanPlay={() => setAudioPreloadState(clip.id, "ready")} onError={() => { setMissingAudio((value) => value.includes(clip.path) ? value : [...value, clip.path]); setAudioPreloadState(clip.id, "missing"); }} />)}
                  {!displayLayers.length && <div className="timeline-empty"><strong>No layers</strong><span>Add a Spine set from the Add menu.</span></div>}
               </div>
               {activeSubtitleTexts.length > 0 && <div className="timeline-subtitle-preview" aria-live="polite">
                 {activeSubtitleTexts.map((text, index) => <div key={`${index}-${text}`}>{text}</div>)}
               </div>}
               <div className="timeline-stage-controls" aria-label="Preview canvas controls" onPointerDown={(event) => event.stopPropagation()}>
                <button type="button" className="editor-icon-button" aria-label="Zoom out preview" title="Zoom out" onClick={() => zoomStageBy(0.8)}><IconMinus /></button>
               <output className="timeline-stage-scale" aria-label="Preview zoom">{Math.round(stageView.scale * 100)}%</output>
                <button type="button" className="editor-icon-button" aria-label="Zoom in preview" title="Zoom in" onClick={() => zoomStageBy(1.25)}><IconPlus /></button>
               <button type="button" className="editor-button" onClick={resetStagePan} title="Center the preview without changing zoom">Reset pan</button>
               <button type="button" className="editor-button" onClick={fitStage} title="Reset preview zoom and center the stage">Fit preview</button>
             </div>
             <span className="timeline-stage-hint" aria-live="polite">{stagePanning ? "Release to stop panning" : "Drag to pan · Wheel to zoom"}</span>
            </div>
         </div>

         <div className="timeline-transport">
              <button className="editor-icon-button" aria-label={playing ? "Pause sequence" : "Play sequence"} onClick={() => { setPreviewUntil(null); setPlaying((value) => !value); }}>{playing ? <IconPause /> : <IconPlay />}</button>
              <button className="editor-button" onClick={() => { setPreviewUntil(null); setCurrentTime(0); setPlaying(false); }}><IconSkipBack /> Start</button>
              {isTalkSequence && <>
                <button className="editor-button" onClick={replayTalkSequence} title="Restart this Talk from the beginning"><IconSkipBack /> Replay Talk</button>
                <button className="editor-preview-button danger" onClick={stopTalkAutoplay} title="Stop playback and cancel Talk autoplay">Stop</button>
              </>}
             {timeline.sequenceId === "opening" && <><button className="editor-button" onClick={() => stepOpeningClip(-1)} disabled={!openingCharacterClips.length}><IconChevronLeft /> Clip</button><button className="editor-button" onClick={() => stepOpeningClip(1)} disabled={!openingCharacterClips.length}>Clip <IconChevronRight /></button></>}
             <button className="editor-button" onClick={() => { setPreviewUntil(null); setCurrentTime(duration); setPlaying(false); }}>End <IconSkipForward /></button>
          <label className="editor-speed">Speed <input type="number" min="0.1" max="3" step="0.1" value={speed} onChange={(event) => setSpeed(Math.max(0.1, Number(event.target.value) || 1))} /></label>
          <label className="timeline-loop"><input type="checkbox" checked={timeline.loop} onChange={(event) => updateTimeline((value) => ({ ...value, loop: event.target.checked }))} /> Loop</label>
          <span className="editor-time">{seconds(currentTime)} / {seconds(duration)}</span>
        </div>

          <TimelineSplitHandle value={previewShare} onChange={setPreviewShare} getFlexibleHeight={() => (stageWrapRef.current?.getBoundingClientRect().height ?? 0) + (scrollRef.current?.getBoundingClientRect().height ?? 0)} />

          <div className="timeline-editor-scroll" ref={scrollRef} style={{ flex: `${100 - previewShare} 1 0` }} onWheel={scrollTimeline}>
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
                <div className="timeline-track-label" title={layer.directory}><b>{roleLabel(layer.role)}</b><button type="button" onClick={() => { setSelectedClips([{ kind: "layer", id: layer.id }]); focusTimelineClip({ kind: "layer", id: layer.id }); }}>{layer.name}</button></div>
                 <div className={`timeline-track timeline-layer-track${layer.id === timeline.selectedLayerId ? " is-selected" : ""}`} onPointerDown={seekFromEvent}>
                    {layerAnimationClips(layer).map((clip) => {
                      const end = animationClipEnd(clip, animationDurations[`${layer.id}:${clip.animation}`] ?? 0);
                      const selected = isClipSelected("animation", clip.id);
                      return <div key={clip.id} className={`timeline-layer-clip timeline-animation-clip${selected ? " is-selected" : ""}${clip.enabled === false ? " is-disabled" : ""}${clip.continueAfterOpening ? " is-continuing" : ""}`} title={`${clip.animation || "Animation"} · drag to move; drag an edge to trim${clip.continueAfterOpening ? " · continues after opening" : ""}`} style={{ left: clip.start * TIMELINE_SCALE * zoom, width: Math.max(8, (end - clip.start) * TIMELINE_SCALE * zoom), zIndex: layer.order }} onPointerDown={(event) => { const selection = selectTimelineClip({ kind: "animation", id: clip.id }, event); if (selection) beginDrag(event, "animation", clip.id, clip.start, end, selection); }}>
                        <button type="button" className="timeline-clip-start-handle" aria-label={`Trim ${clip.animation} start`} title="Drag to trim the start" onPointerDown={(event) => { event.stopPropagation(); const selection = selectTimelineClip({ kind: "animation", id: clip.id }, event); if (selection) beginDrag(event, "animation-start", clip.id, clip.start, end, selection); }} />
                        <button type="button" className="timeline-clip-end-handle" aria-label={`Trim ${clip.animation} end`} title="Drag to trim the end" onPointerDown={(event) => { event.stopPropagation(); const selection = selectTimelineClip({ kind: "animation", id: clip.id }, event); if (selection) beginDrag(event, "animation-end", clip.id, clip.start, end, selection); }} />
                        <span className="timeline-layer-name">{layer.followMainAnimation ? `Follow · ${clip.animation || "main"}` : clip.animation || "Animation"}</span>
                      </div>;
                    })}
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
                   {timeline.audio.map((clip) => <div key={clip.id} className={`timeline-audio-clip${isClipSelected("audio", clip.id) || clip.id === selectedAudio?.id ? " is-selected" : ""}${clip.enabled ? "" : " is-disabled"}`} title="Drag to move the audio; drag an edge to change its timing. Shift/Ctrl-click to select multiple." style={{ left: clip.start * TIMELINE_SCALE * zoom, width: Math.max(12, (clip.end - clip.start) * TIMELINE_SCALE * zoom) }} onPointerDown={(event) => { const selection = selectTimelineClip({ kind: "audio", id: clip.id }, event); if (selection) beginDrag(event, "audio", clip.id, clip.start, clip.end, selection); }}><button type="button" className="timeline-clip-start-handle" aria-label={`Move ${clip.name} start`} title="Drag to change start time" onPointerDown={(event) => { event.stopPropagation(); const selection = selectTimelineClip({ kind: "audio", id: clip.id }, event); if (selection) beginDrag(event, "audio-start", clip.id, clip.start, clip.end, selection); }} /><button type="button" className="timeline-clip-end-handle" aria-label={`Move ${clip.name} end`} title="Drag to change end time" onPointerDown={(event) => { event.stopPropagation(); const selection = selectTimelineClip({ kind: "audio", id: clip.id }, event); if (selection) beginDrag(event, "audio-end", clip.id, clip.start, clip.end, selection); }} /><AudioWaveform url={audioUrls[clip.id]} onDuration={(value) => applyDecodedAudioDuration(clip.id, value)} /><span><IconSound /> {clip.name}</span></div>)}
                <i className="timeline-playhead" style={{ left: currentTime * TIMELINE_SCALE * zoom }} />
              </div>
            </div>
             {dragSnapFeedback && <div className={"timeline-snap-feedback is-" + dragSnapFeedback.source} aria-hidden="true" style={{ left: 116 + dragSnapFeedback.time * TIMELINE_SCALE * zoom }}>
               <span>{dragSnapFeedback.source === "target" ? "SNAP" : "GRID"} {seconds(dragSnapFeedback.time)} · Δ {dragSnapFeedback.delta < 0 ? "−" : "+"}{Math.abs(dragSnapFeedback.delta).toFixed(3)}s</span>
             </div>}
          </div>
         </div>
         <div className="timeline-bottom-tools">
           <label>Snap <select value={timeline.snap} onChange={(event) => updateTimeline((value) => ({ ...value, snap: Number(event.target.value) }))}><option value="0">Off</option><option value="0.01">10 ms</option><option value="0.1">100 ms</option><option value="0.25">250 ms</option><option value="0.5">500 ms</option></select></label>
           <label>Timeline scale <input aria-label="Timeline scale" type="range" min="0.1" max="3" step="0.1" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
            <button className="editor-button" onClick={fitTimeline} title="Fit the full sequence in the timeline (F)"><IconExpand /> Fit timeline (F)</button>
             <details ref={addMenuRef} className="timeline-add-menu">
               <summary className="editor-button"><IconPlus /> Add <IconChevronDown /></summary>
              <div className="timeline-add-menu-popover">
                 <button className="editor-button" onClick={() => { closeAddMenu(); addAnimationClip(); }} disabled={!metas[selectedLayer?.id ?? characterLayer?.id ?? ""]}>Animation clip</button>
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
            <label>{timeline.sequenceId === "opening" ? "Total duration (s)" : isTalkSequence ? "Total Talk playback (s)" : "Length (s)"}<input type="number" min="1" step="0.1" value={Number(duration.toFixed(3))} disabled={(timeline.sequenceId === "opening" || isTalkSequence) && timeline.durationMode === "auto"} onChange={(event) => updateTimeline((value) => ({ ...value, durationMode: value.sequenceId === "opening" || /^talk-\d+$/i.test(value.sequenceId ?? "") ? "manual" : value.durationMode, duration: Math.max(1, (Number(event.target.value) || 1) - (isTalkSequence ? talkMixDuration : 0)) }))} /></label>
            <label><span className="timeline-inline-check"><input type="checkbox" checked={timeline.loop} onChange={(event) => updateTimeline((value) => ({ ...value, loop: event.target.checked }))} /> Loop sequence</span></label>
            {isTalkSequence && <>
              <div className="editor-subheading">Talk playback</div>
              <label><span className="timeline-inline-check"><input type="checkbox" checked={timeline.durationMode === "auto"} onChange={(event) => updateTimeline((value) => ({ ...value, durationMode: event.target.checked ? "auto" : "manual", duration: Math.max(1, autoTalkDuration - talkMixDuration) }))} /> Automatic total duration</span><small className="editor-field-hint">{timeline.durationMode === "auto" ? `Fits enabled animation, voice, and subtitle endpoints: ${seconds(autoTalkDuration)}.` : "Manual override"}</small></label>
              <label><span className="timeline-inline-check"><input type="checkbox" checked={talkAutoplayActive} onChange={(event) => event.target.checked ? startTalkAutoplay() : stopTalkAutoplay()} /> Autoplay numbered Talks</span><small className="editor-field-hint">Waits for the animation, enabled voice clips, and subtitles to finish before advancing.</small></label>
              <div className="editor-two-fields">
                <label>Pause between Talks (s)<input type="number" min="0" max="10" step="0.1" value={pauseBetweenTalks} onChange={(event) => setPauseBetweenTalks(Math.max(0, Math.min(10, Number(event.target.value) || 0)))} /></label>
                <label><span className="timeline-inline-check"><input type="checkbox" checked={loopTalkList} onChange={(event) => setLoopTalkList(event.target.checked)} /> Loop Talk list</span></label>
              </div>
              <label>Talk blend in / out (s)<input aria-label="Talk animation blend duration in seconds" type="number" min="0" max="2" step="0.05" value={project?.talkMixDuration ?? DEFAULT_TALK_MIX_DURATION} onChange={(event) => updateTalkMixDuration(Number(event.target.value))} /><small className="editor-field-hint">Shared by runtime Talk playback and the timeline preview.</small></label>
            </>}
             {timeline.sequenceId === "opening" && <div className="opening-flow-editor">
              <div className="editor-subheading">Animation clips</div>
              <p className="editor-muted">Each Spine asset keeps one loaded skeleton. Add clips to its track, then drag to reorder; later clips ripple with it.</p>
              <div className="timeline-batch-actions">
                <button className="editor-button" disabled={!characterLayer || !metas[characterLayer.id]} onClick={() => characterLayer && addAnimationClip(characterLayer.id)}><IconPlus /> Character clip</button>
                {selectedLayer && selectedLayer.id !== characterLayer?.id && <button className="editor-button" disabled={!metas[selectedLayer.id]} onClick={() => addAnimationClip(selectedLayer.id)}><IconPlus /> {selectedLayer.name} clip</button>}
              </div>
              <div className="opening-phase-summary">{openingCharacterClips.map((clip) => <button key={clip.id} onClick={() => previewOpeningClip(clip)}><b>{clip.animation || "Animation"}</b><span>{seconds(animationClipEnd(clip, animationDurations[`${characterLayer?.id}:${clip.animation}`] ?? 0) - clip.start)}</span></button>)}</div>
              <label><span className="timeline-inline-check"><input type="checkbox" checked={timeline.durationMode === "auto"} onChange={(event) => updateTimeline((value) => ({ ...value, durationMode: event.target.checked ? "auto" : "manual", duration: event.target.checked ? openingAutoDuration : value.duration }))} /> Automatic total duration</span><small className="editor-field-hint">{timeline.durationMode === "auto" ? `Updates to ${seconds(openingAutoDuration)} from the last clip.` : "Manual override"}</small></label>
              <p className="editor-muted">Mark the final looping character clip “Continue after opening” to keep it running when interaction controls take over. Scene clips can hide the character for their duration.</p>
            </div>}
          <div className="timeline-context-summary"><span>Layers <b>{displayLayers.length}</b></span><span>Subtitles <b>{timeline.subtitles.length}</b></span><span>Audio <b>{timeline.audio.length}</b></span></div>
           <p className="editor-muted">Select a clip in the timeline to edit its properties. Add content from the <b>Add</b> menu.</p>
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
              {selectedClipDetails.map((item) => <div key={`${item.kind}-${item.id}`}><span className={`timeline-selection-kind ${item.kind}`}>{item.kind === "cue" ? "SUB" : item.kind === "audio" ? "AUD" : item.kind === "animation" ? "ANIM" : "SPN"}</span><span title={item.label}>{item.label}</span><small>{seconds(item.start)}–{seconds(item.end)}{!item.removable ? " · main character" : ""}</small></div>)}
           </div>
          </section>}

          {inspector === "animation" && selectedAnimationClip && <section className="editor-section editor-inspector">
            <div className="editor-section-title"><strong>Animation clip</strong><span><i className={`timeline-role-dot ${selectedAnimationClip.layer.role}`} /> {selectedAnimationClip.layer.name}</span></div>
            <div className="editor-two-fields"><button className="editor-button" onClick={duplicateSelectedAnimationClip}>Duplicate</button><button className="editor-preview-button danger" onClick={deleteSelectedClips}>Delete clip</button></div>
            <label>Animation<select value={selectedAnimationClip.clip.animation} onChange={(event) => {
              const animation = event.target.value;
              const duration = animationDurations[`${selectedAnimationClip.layer.id}:${animation}`] ?? 0;
              updateAnimationClip(selectedAnimationClip.layer.id, selectedAnimationClip.clip.id, {
                animation,
                ...(selectedAnimationClip.clip.endMode !== "manual" && !selectedAnimationClip.clip.loop && duration > 0
                  ? { end: selectedAnimationClip.clip.start + Math.max(0.01, duration - selectedAnimationClip.clip.animationOffset) }
                  : {}),
              });
            }}><option value="">Auto fallback</option>{(metas[selectedAnimationClip.layer.id]?.animations ?? []).map((animation) => <option key={animation} value={animation}>{animation}</option>)}</select></label>
            <label>Face / secondary animation<select value={selectedAnimationClip.clip.faceAnimation ?? ""} onChange={(event) => updateAnimationClip(selectedAnimationClip.layer.id, selectedAnimationClip.clip.id, { faceAnimation: event.target.value })}><option value="">Layer default / none</option>{(metas[selectedAnimationClip.layer.id]?.animations ?? []).map((animation) => <option key={animation} value={animation}>{animation}</option>)}</select></label>
            <div className="editor-two-fields"><label>Start (s)<input type="number" min="0" step="0.001" value={Number(selectedAnimationClip.clip.start.toFixed(3))} onChange={(event) => moveAnimationClipTo(selectedAnimationClip.layer.id, selectedAnimationClip.clip.id, Math.max(0, Number(event.target.value) || 0))} /></label><label>End (s)<input type="number" min={selectedAnimationClip.clip.start + 0.01} step="0.001" value={Number(animationClipEnd(selectedAnimationClip.clip, animationDurations[`${selectedAnimationClip.layer.id}:${selectedAnimationClip.clip.animation}`] ?? 0).toFixed(3))} onChange={(event) => updateAnimationClip(selectedAnimationClip.layer.id, selectedAnimationClip.clip.id, { endMode: "manual", end: Math.max(selectedAnimationClip.clip.start + 0.01, Number(event.target.value) || selectedAnimationClip.clip.start + 0.01) })} /></label></div>
            <label><span className="timeline-inline-check"><input type="checkbox" checked={selectedAnimationClip.clip.endMode !== "manual"} onChange={(event) => {
              const duration = animationDurations[`${selectedAnimationClip.layer.id}:${selectedAnimationClip.clip.animation}`] ?? 0;
              updateAnimationClip(selectedAnimationClip.layer.id, selectedAnimationClip.clip.id, { endMode: event.target.checked ? "auto" : "manual", ...(event.target.checked ? { end: animationClipEnd(selectedAnimationClip.clip, duration) } : {}) });
            }} /> Use Spine animation end</span></label>
            <div className="editor-two-fields"><label>Animation offset (s)<input type="number" min="0" step="0.001" value={Number(selectedAnimationClip.clip.animationOffset.toFixed(3))} onChange={(event) => {
              const animationOffset = Math.max(0, Number(event.target.value) || 0);
              const duration = animationDurations[`${selectedAnimationClip.layer.id}:${selectedAnimationClip.clip.animation}`] ?? 0;
              updateAnimationClip(selectedAnimationClip.layer.id, selectedAnimationClip.clip.id, { animationOffset, ...(selectedAnimationClip.clip.endMode !== "manual" && !selectedAnimationClip.clip.loop && duration > 0 ? { end: selectedAnimationClip.clip.start + Math.max(0.01, duration - animationOffset) } : {}) });
            }} /></label><label><span>Playback</span><span className="timeline-inline-check"><input type="checkbox" checked={selectedAnimationClip.clip.loop} onChange={(event) => updateAnimationClip(selectedAnimationClip.layer.id, selectedAnimationClip.clip.id, { loop: event.target.checked })} /> Loop</span></label></div>
            {timeline.sequenceId === "opening" && selectedAnimationClip.layer.role === "character" && <label><span className="timeline-inline-check"><input type="checkbox" checked={selectedAnimationClip.clip.continueAfterOpening === true} onChange={(event) => updateAnimationClip(selectedAnimationClip.layer.id, selectedAnimationClip.clip.id, { continueAfterOpening: event.target.checked })} /> Continue after opening</span><small className="editor-field-hint">Keeps this animation playing through the interaction-idle handoff.</small></label>}
            {timeline.sequenceId === "opening" && selectedAnimationClip.layer.role === "scene" && <label><span className="timeline-inline-check"><input type="checkbox" checked={selectedAnimationClip.clip.hideCharacter === true} onChange={(event) => updateAnimationClip(selectedAnimationClip.layer.id, selectedAnimationClip.clip.id, { hideCharacter: event.target.checked })} /> Hide character during this scene clip</span><small className="editor-field-hint">When unchecked, the scene and character play together.</small></label>}
            <label><span className="timeline-inline-check"><input type="checkbox" checked={selectedAnimationClip.clip.enabled !== false} onChange={(event) => updateAnimationClip(selectedAnimationClip.layer.id, selectedAnimationClip.clip.id, { enabled: event.target.checked })} /> Enabled</span></label>
            <div className="editor-two-fields subtitle-actions"><button className="editor-button" onClick={() => previewAnimationClip(selectedAnimationClip.layer, selectedAnimationClip.clip)}><IconPlay /> Preview clip</button><span className="editor-field-hint">Drag the body to move; drag either edge to trim.</span></div>
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
           <SubtitleTextEditor
             cueNumber={selectedCueIndex + 1}
             language={timeline.language}
             text={selectedCue.text}
             onLanguageChange={(language) => updateTimeline((value) => ({ ...value, language }))}
             onTextChange={(language, text) => updateCue(selectedCue.id, { text: { ...selectedCue.text, [language]: text } })}
           />
          <div className="editor-two-fields subtitle-actions"><button className="editor-button" onClick={() => updateTimeline((value) => splitCue(value, selectedCue.id, currentTime))}>Split (S)</button><button className="editor-button" onClick={duplicateCue}>Duplicate</button><button className="editor-button" onClick={() => { setCurrentTime(selectedCue.start); setPreviewUntil(selectedCue.end); setPlaying(true); }}>Preview cue</button></div>
          <div className="editor-two-fields"><label><span className="timeline-inline-check"><input type="checkbox" checked={selectedCue.enabled} onChange={(event) => updateCue(selectedCue.id, { enabled: event.target.checked })} /> Visible</span></label><button className="editor-preview-button danger" onClick={deleteCue}>Delete cue</button></div>
        </section>}

        {inspector === "audio" && selectedAudio && <section className="editor-section editor-inspector">
          <div className="editor-section-title"><strong>Audio clip</strong><span>{seconds(selectedAudio.start)}–{seconds(selectedAudio.end)}</span></div>
          <label>Name<input value={selectedAudio.name} onChange={(event) => updateAudio(selectedAudio.id, { name: event.target.value })} /></label>
             <div className="editor-two-fields"><label>Start (s)<input type="number" min={selectedAudioMinimumStart} step="0.001" value={Number(selectedAudio.start.toFixed(3))} onChange={(event) => updateAudio(selectedAudio.id, { start: selectedAudioDuration !== undefined ? clampAudioStart(selectedAudio.end, Number(event.target.value) || 0, selectedAudioDuration) : Math.min(selectedAudio.end - 0.01, Math.max(0, Number(event.target.value) || 0)) })} /></label><label>End (s)<input type="number" min="0.01" max={selectedAudioMaximumEnd} step="0.001" value={Number(selectedAudio.end.toFixed(3))} onChange={(event) => updateAudio(selectedAudio.id, { autoEnd: false, end: selectedAudioDuration !== undefined ? clampAudioEnd(selectedAudio.start, Number(event.target.value) || selectedAudio.start + 0.01, selectedAudioDuration) : Math.max(selectedAudio.start + 0.01, Number(event.target.value) || selectedAudio.start + 0.01) })} /></label></div>
             {selectedAudioDuration !== undefined && <small className="editor-field-hint">Source duration: {seconds(selectedAudioDuration)}. The clip cannot be extended past its source.</small>}
           <label>Volume · {Math.round(selectedAudio.volume * 100)}%<input type="range" min="0" max="1" step="0.01" value={selectedAudio.volume} onChange={(event) => updateAudio(selectedAudio.id, { volume: Number(event.target.value) })} /></label>
           <label><span className="timeline-inline-check"><input type="checkbox" checked={selectedAudio.enabled} onChange={(event) => updateAudio(selectedAudio.id, { enabled: event.target.checked })} /> Enabled</span></label>
           <label>Linked subtitle<select aria-label="Linked subtitle" value={selectedAudio.subtitleId === null ? "__none__" : selectedAudio.subtitleId ?? selectedAudioLinkedSubtitle?.id ?? "__none__"} onChange={(event) => setAudioSubtitleLink(selectedAudio.id, event.target.value === "__none__" ? null : event.target.value)}>
             <option value="__none__">No linked subtitle</option>
             {timeline.subtitles.map((cue) => <option key={cue.id} value={cue.id}>{seconds(cue.start)} · {cueText(cue, timeline.language)}</option>)}
           </select><small className="editor-field-hint">{selectedAudio.subtitleId === undefined && selectedAudioLinkedSubtitle ? "Imported line link; Link subtitle saves an explicit relationship." : "Moving the audio moves its linked subtitle."}</small></label>
           <div className="timeline-audio-actions">
             <button className="editor-button" type="button" disabled={!selectedAudioLinkCandidate} onClick={() => selectedAudioLinkCandidate && setAudioSubtitleLink(selectedAudio.id, selectedAudioLinkCandidate.id)} title="Link the nearest subtitle, or make the current legacy link explicit"><IconLink /> {selectedAudioLinkedSubtitle ? "Link subtitle" : "Link nearest"}</button>
             <button className="editor-button" type="button" disabled={!selectedAudioLinkedSubtitle && selectedAudio.subtitleId == null} onClick={() => setAudioSubtitleLink(selectedAudio.id, null)} title="Remove the audio/subtitle relationship"><IconUnlink /> Unlink</button>
             <button className="editor-button" type="button" disabled={selectedAudioDuration === undefined} onClick={matchSelectedAudioLength} title="Set this clip and its linked subtitle to the decoded source duration"><IconSync /> Match source</button>
             <button className="editor-button" type="button" onClick={previewSelectedAudio} title="Preview this clip"><IconPlay /> Preview</button>
           </div>
           {selectedAudioLinkedSubtitle && <p className="editor-muted timeline-audio-link-note">Linked to “{cueText(selectedAudioLinkedSubtitle, timeline.language)}” · {seconds(selectedAudioLinkedSubtitle.start)}–{seconds(selectedAudioLinkedSubtitle.end)}</p>}
           {missingAudio.includes(selectedAudio.path) && <><p className="editor-error">Audio file is missing from the selected asset root.</p><button className="editor-button" onClick={() => void relinkAudio()}>Relink audio</button></>}
          <button className="editor-preview-button danger" onClick={deleteAudio}>Delete clip</button>
          <p className="editor-muted" title={selectedAudio.path}>{selectedAudio.path}</p>
        </section>}

        {((inspector === "layer" && !selectedLayer) || (inspector === "animation" && !selectedAnimationClip) || (inspector === "cue" && !selectedCue) || (inspector === "audio" && !selectedAudio)) && <div className="timeline-empty timeline-inspector-empty"><strong>Select a clip</strong><span>Choose a layer, animation, subtitle, or audio clip in the timeline.</span></div>}
      </aside>
    </div>
     <AssetPickerModal open={layerPickerOpen} title="Add Spine layer" eyebrow="TIMELINE LAYER" description="Search the loaded catalog and add another background, scene, character, or overlay set." directories={availableLayerDirectories} assetRoot={source?.rootPath ?? ""} directoryInfo={directoryInfo} emptyLabel="Every available asset set is already on this timeline." renderLabel={(item) => characterDirectoryLabel(item, directoryLabels)} getSearchText={(item) => characterDirectoryLabel(item, directoryLabels)} onClose={() => setLayerPickerOpen(false)} onSelect={(next) => { setLayerPickerOpen(false); addLayer(next); }} />
  </>;
}
