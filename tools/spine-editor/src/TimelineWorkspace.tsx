import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
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
import { animationEndForLayer, snapToTargets, splitCue, switchSequence, talkSequenceId } from "./sequenceModel";
import { serializeSubtitleDocument } from "./subtitleDocument";

const TIMELINE_SCALE = 96;
const MIN_TIMELINE_DURATION = 1;

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
  onMutate: (mutator: (current: EditorProject) => EditorProject) => void;
  onLive: (mutator: (current: EditorProject) => EditorProject) => void;
  onBeginEdit: () => void;
  onSave: () => void | Promise<void>;
  onRegisterSave: (callback: (() => Promise<void>) | null) => void;
  help: boolean;
  onStatus: (value: string) => void;
  onError: (value: string | null) => void;
}

interface TimelineLayerCanvasProps {
  layer: EditorTimelineLayer;
  files: SpineFiles | null;
  currentTime: number;
  openingMode?: "scene-first" | "direct" | "skip";
  sceneDuration?: number;
  sequenceId?: string;
  onMarkers: (markers: number[]) => void;
  sharedCameraPose: SpineCameraPose | null;
  referenceCamera: boolean;
  onMeta: (layerId: string, meta: SpineMeta | null) => void;
  onCameraPose: (pose: SpineCameraPose) => void;
  onAnimationDuration: (layerId: string, animation: string, duration: number) => void;
  onError: (value: string | null) => void;
}

function localTime(layer: EditorTimelineLayer, currentTime: number, meta: SpineMeta | null): number {
  const duration = meta?.duration ?? 0;
  if (currentTime < layer.start || currentTime > layer.end) return 0;
  const elapsed = Math.max(0, currentTime - layer.start + layer.animationOffset);
  if (!duration) return elapsed;
  return layer.loop ? elapsed % duration : Math.min(elapsed, duration);
}

function TimelineLayerCanvas({ layer, files, currentTime, sharedCameraPose, referenceCamera, onMeta, onCameraPose, onAnimationDuration, onError, openingMode, sceneDuration = 3, sequenceId, onMarkers }: TimelineLayerCanvasProps) {
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
  const introStart = openingMode === "scene-first" ? sceneDuration : 0;
  const intro = meta?.introAnimation;
  const introLength = intro ? rendererRef.current?.getEditorAnimationInfo(intro).duration ?? 0 : 0;
  const useIntro = opening && openingMode !== "skip" && layer.role === "character" && currentTime - introStart < introLength;
  const animation = useIntro ? intro! : layer.animation || meta?.idleAnimation || meta?.animations[0] || "";
  const animationDuration = rendererRef.current?.getEditorAnimationInfo(animation).duration ?? 0;
  const layerEnd = animationEndForLayer(layer, animationDuration);
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
    const time = opening && layer.role === "character" ? Math.max(0, currentTime - introStart - (useIntro ? 0 : introLength)) : Math.max(0, currentTime - layer.start + layer.animationOffset);
    renderer?.sampleEditorAnimation(animation, layer.faceAnimation ?? "", time, layer.loop, /^talk/i.test(animation));
    if (referenceCamera) onMarkers(renderer?.getEditorAnimationInfo(animation).markers ?? []);
  }, [animation, currentTime, layer, meta, opening, introStart, introLength, useIntro]);

  useEffect(() => {
    if (!referenceCamera && sharedCameraPose) rendererRef.current?.setCameraPose(sharedCameraPose);
  }, [referenceCamera, sharedCameraPose]);

  const visible = layer.enabled && currentTime >= layer.start && currentTime <= layerEnd && !(opening && openingMode === "scene-first" && layer.role === "character" && currentTime < sceneDuration);
  const style: CSSProperties = {
    zIndex: layer.order,
    opacity: visible ? layer.opacity : 0,
    visibility: visible ? "visible" : "hidden",
    transform: `translate(${layer.x}px, ${layer.y}px) scale(${layer.scale})`,
  };
  return <canvas ref={canvasRef} className="timeline-layer-canvas" style={style} aria-label={`${layer.name} Spine layer`} />;
}

function seconds(value: number): string {
  return `${value.toFixed(2)}s`;
}

function snapTime(value: number, snap: number, duration: number): number {
  const next = snap > 0 ? Math.round(value / snap) * snap : value;
  return Math.max(0, Math.min(duration, Number(next.toFixed(3))));
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
    const entries = parts.length > 0
      ? parts.map((part, index) => ({
        start: typeof part.start === "number" && Number.isFinite(part.start) ? part.start : markers[index] ?? lineIndex * 2 + index * 2,
        text: importedText(part.subtitle ?? part.text ?? line.subtitle ?? line.text),
        audio: Array.isArray(part.audio) ? part.audio.filter((item): item is string => typeof item === "string") : [],
      }))
      : [{ start: markers[0] ?? lineIndex * 2, text: importedText(line.subtitle ?? line.text ?? line), audio: Array.isArray(line.audio) ? line.audio.filter((item): item is string => typeof item === "string") : [] }];
    entries.forEach((entry, index) => {
      const nextStart = entries[index + 1]?.start;
      const end = Math.max(entry.start + 0.05, nextStart ?? entry.start + 2);
      const cue: EditorSubtitleCue = {
        id: `subtitle-import-${lineIndex}-${index}-${Math.random().toString(36).slice(2, 8)}`,
        start: Math.max(0, entry.start),
        end,
        enabled: true,
        text: entry.text,
      };
      cues.push(cue);
      duration = Math.max(duration, end);
      const alternatives = entry.audio;
      const global = alternatives.filter((path) => /_GL_/i.test(path));
      const base = alternatives.filter((path) => !/_(GL|JP|KR)_/i.test(path));
      const chosen = global.length ? global : base.length ? base : alternatives.filter((path) => /_JP_/i.test(path));
      (chosen.length ? chosen : alternatives.slice(0, 1)).forEach((path, audioIndex) => {
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

export function TimelineWorkspace({ source, directory, directories, project, onMutate, onLive, onBeginEdit, onSave, onRegisterSave, help, onStatus, onError }: TimelineWorkspaceProps) {
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [metas, setMetas] = useState<Record<string, SpineMeta | null>>({});
  const [sharedCameraPose, setSharedCameraPose] = useState<SpineCameraPose | null>(null);
  const [files, setFiles] = useState<Record<string, SpineFiles | null>>({});
  const [animationDurations, setAnimationDurations] = useState<Record<string, number>>({});
  const [layerSearch, setLayerSearch] = useState("");
  const [zoom, setZoom] = useState(1);
  const [markers, setMarkers] = useState<number[]>([]);
  const [inspector, setInspector] = useState<"sequence" | "layer" | "cue" | "audio">("sequence");
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrubRef = useRef(false);
  const [selectedAudioId, setSelectedAudioId] = useState<string | null>(null);
  const audioElementsRef = useRef<Record<string, HTMLAudioElement | null>>({});
  const audioUrlsRef = useRef<Record<string, string>>({});
  const audioStartedRef = useRef<Record<string, boolean>>({});
  const audioPreviousTimeRef = useRef<Record<string, number | undefined>>({});
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});
  const [missingAudio, setMissingAudio] = useState<string[]>([]);
  const dragRef = useRef<{ kind: "layer" | "cue" | "cue-start" | "cue-end" | "audio"; id: string; x: number; start: number; end: number } | null>(null);
  const initializedLayersRef = useRef("");
  const subtitleDocumentsRef = useRef<Record<string, Record<string, unknown>>>({});

  const timeline = project?.timeline ?? null;
  const duration = Math.max(MIN_TIMELINE_DURATION, timeline?.duration ?? 12);
  const discovered = useMemo(() => directory ? compositionDirectories(directory, directories) : [], [directory, directories]);
  const displayLayers = useMemo(() => [...(timeline?.layers ?? [])].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)), [timeline?.layers]);
  const visibleLayers = displayLayers.filter((layer) => !layerSearch.trim() || `${layer.name} ${layer.role}`.toLocaleLowerCase().includes(layerSearch.trim().toLocaleLowerCase()));
  const selectedLayer = timeline?.layers.find((layer) => layer.id === timeline.selectedLayerId) ?? displayLayers.at(-1) ?? null;
  const selectedCue = timeline?.subtitles.find((cue) => cue.id === timeline.selectedCueId) ?? timeline?.subtitles[0] ?? null;
  const selectedCueIndex = selectedCue && timeline ? timeline.subtitles.findIndex((cue) => cue.id === selectedCue.id) : -1;
  const selectedAudio = timeline?.audio.find((clip) => clip.id === selectedAudioId) ?? timeline?.audio[0] ?? null;
  const layerDirectoriesKey = displayLayers.map((layer) => layer.directory).join("|");
  const trackWidth = Math.max(640, duration * TIMELINE_SCALE * zoom + 48);
  const characterMeta = displayLayers.map((layer) => layer.role === "character" ? metas[layer.id] : null).find(Boolean);
  const animations = characterMeta?.animations ?? [];
  const sequenceIds = [...new Set(["opening", ...animations.filter((name) => /talk[_ -]?\d+/i.test(name)).map(talkSequenceId), ...Object.keys(project?.sequences ?? {}).filter((id) => id !== "legacy")])];

  function layerAnimation(layer: EditorTimelineLayer): string {
    return layer.animation || metas[layer.id]?.idleAnimation || metas[layer.id]?.animations[0] || "";
  }

  function layerEnd(layer: EditorTimelineLayer): number {
    return animationEndForLayer(layer, animationDurations[`${layer.id}:${layerAnimation(layer)}`] ?? 0);
  }

  function onAnimationDuration(layerId: string, animation: string, animationDuration: number) {
    const key = `${layerId}:${animation}`;
    setAnimationDurations((value) => value[key] === animationDuration ? value : { ...value, [key]: animationDuration });
    const currentTimeline = timeline;
    const currentLayer = currentTimeline?.layers.find((layer) => layer.id === layerId);
    if (!currentTimeline || !currentLayer || currentLayer.loop || currentLayer.endMode === "manual") return;
    const nextEnd = animationEndForLayer(currentLayer, animationDuration);
    if (Math.abs(currentLayer.end - nextEnd) < 0.01 && currentTimeline.duration >= nextEnd) return;
    updateTimeline((value) => ({
      ...value,
      duration: Math.max(value.duration, nextEnd),
      layers: value.layers.map((layer) => layer.id === layerId && !layer.loop && layer.endMode !== "manual" ? { ...layer, end: animationEndForLayer(layer, animationDuration) } : layer),
    }), false);
  }

  function chooseSequence(id: string) {
    onMutate((current) => switchSequence(current, id, animations, directories));
    setCurrentTime(0); setPlaying(false); setInspector("sequence");
  }

  useEffect(() => {
    if (!project || !directory) return;
    const ensured = ensureTimelineLayers(project.timeline, directory, directories);
    const before = project.timeline.layers.map((layer) => layer.directory).join("|");
    const after = ensured.layers.map((layer) => layer.directory).join("|");
    const key = `${directory}:${after}`;
    if (before !== after && initializedLayersRef.current !== key) {
      initializedLayersRef.current = key;
      onLive((current) => ({ ...current, timeline: ensureTimelineLayers(current.timeline, directory, directories) }));
      onStatus(`Discovered ${ensured.layers.length} synchronized Spine layers.`);
    }
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

  function applyDecodedAudioDuration(id: string, decodedDuration: number) {
    const currentTimeline = timeline;
    const clip = currentTimeline?.audio.find((item) => item.id === id);
    if (!currentTimeline) return;
    if (!clip?.autoEnd) return;
    const timing = decodedAudioTiming(clip.start, decodedDuration, currentTimeline.duration);
    if (!timing) return;
    if (Math.abs(clip.end - timing.end) < 0.01 && currentTimeline.duration >= timing.duration) return;
    updateTimeline((value) => ({
      ...value,
      duration: Math.max(value.duration, timing.duration),
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
        if (next < duration) return next;
        if (timeline?.loop) return next % duration;
        setPlaying(false);
        return duration;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [duration, playing, speed, timeline?.loop]);

  useEffect(() => {
    if (!timeline) return;
    setCurrentTime((value) => Math.min(value, duration));
  }, [directory, duration, timeline]);

  function projectTimelines() {
    return project ? [project.timeline, ...Object.values(project.sequences ?? {})] : [];
  }

  async function saveSubtitleDocuments() {
    if (!project || !source) return;
    const timelines = projectTimelines();
    const paths = new Set(timelines.map((item) => item.subtitlePath).filter((path): path is string => Boolean(path)));
    for (const path of paths) {
      const document = subtitleDocumentsRef.current[path];
      if (document) await source.saveText(path, serializeSubtitleDocument(document, directory, timelines));
    }
  }

  useEffect(() => {
    onRegisterSave(saveSubtitleDocuments);
    return () => onRegisterSave(null);
  });

  useEffect(() => {
    if (!project || !source || Object.keys(subtitleDocumentsRef.current).length === 0) return;
    const timer = window.setTimeout(() => {
      void saveSubtitleDocuments().then(() => onStatus("Subtitle changes saved directly to the source JSON."));
    }, 450);
    return () => window.clearTimeout(timer);
  }, [onStatus, project, source]);

  function updateTimeline(mutator: (timeline: EditorProject["timeline"]) => EditorProject["timeline"], history = true) {
    const callback = history ? onMutate : onLive;
    callback((current) => ({ ...current, timeline: mutator(current.timeline) }));
  }

  function updateLayer(id: string, patch: Partial<EditorTimelineLayer>, history = true) {
    updateTimeline((value) => ({ ...value, layers: value.layers.map((layer) => layer.id === id ? { ...layer, ...patch } : layer) }), history);
  }

  function updateCue(id: string, patch: Partial<EditorSubtitleCue>, history = true) {
    updateTimeline((value) => ({ ...value, subtitles: value.subtitles.map((cue) => cue.id === id ? { ...cue, ...patch } : cue) }), history);
  }

  function updateAudio(id: string, patch: Partial<EditorAudioClip>, history = true) {
    updateTimeline((value) => ({ ...value, audio: value.audio.map((clip) => clip.id === id ? { ...clip, ...patch } : clip) }), history);
  }

  function setSelectedLayer(id: string) {
    setInspector("layer"); updateTimeline((value) => ({ ...value, selectedLayerId: id }), false);
  }

  function setSelectedCue(id: string | null) {
    setInspector("cue"); updateTimeline((value) => ({ ...value, selectedCueId: id }), false);
  }

  function addCue() {
    if (!timeline) return;
    const start = Math.min(duration - 0.05, snapTime(currentTime, timeline.snap, duration));
    setInspector("cue");
    const cue: EditorSubtitleCue = {
      id: `subtitle-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
      start,
      end: Math.min(duration, start + 2),
      enabled: true,
      text: { en: "", ja: "", ko: "" },
    };
    updateTimeline((value) => ({ ...value, subtitles: [...value.subtitles, cue], selectedCueId: cue.id }));
    onStatus(`Subtitle cue added at ${seconds(start)}.`);
  }

  async function importSubtitles() {
    try {
      let raw: Record<string, unknown>;
      let subtitlePath: string | undefined;
      if (!source) return;
      const selected = await source.openText();
      if (!selected) return;
      raw = JSON.parse(selected.content) as Record<string, unknown>;
      subtitlePath = selected.path;
      subtitleDocumentsRef.current[subtitlePath] = structuredClone(raw);
      const sourceFile = Array.isArray(raw.characters) ? raw.characters.find((item) => (item as Record<string, unknown>).directory === directory) as Record<string, unknown> : raw;
      if (!sourceFile || !Array.isArray(sourceFile.lines)) throw new Error("No matching character subtitle lines found.");
      let count = 0;
      onMutate((current) => {
        let next = current;
        const original = current.timeline.sequenceId ?? "opening";
        for (const candidate of sourceFile.lines as Record<string, unknown>[]) {
          const number = String(candidate.id ?? "").match(/(\d+)$/)?.[1];
          if (number === undefined) continue;
          const id = Number(number) === 0 ? "opening" : `talk-${Number(number)}`;
          next = switchSequence(next, id, animations, directories);
          const imported = importedSubtitleCues({ ...sourceFile, lines: [candidate] });
           next = { ...next, timeline: { ...next.timeline, subtitlePath: subtitlePath ?? next.timeline.subtitlePath, duration: Math.max(1, imported.duration), subtitles: imported.cues.map((cue) => ({ ...cue, lineId: String(candidate.id) })), audio: imported.audio.map((clip) => ({ ...clip, lineId: String(candidate.id) })), selectedCueId: imported.cues[0]?.id ?? null } };
          count += imported.cues.length;
        }
        return switchSequence(next, original, animations, directories);
      });
      onStatus(`Imported ${count} cues into separate talk timelines.${subtitlePath ? " Source JSON is now linked for direct saves." : " Original files unchanged."}`);
    } catch (value) {
      onError(value instanceof Error ? value.message : String(value));
    }
  }

  async function selectAudioFiles(): Promise<Array<{ path: string; file: File }>> {
    if (!source) return [];
    try {
      const paths = await source.openAudio();
      return (await Promise.all(paths.map(async (path) => ({ path, file: await source.getFile(path) })))).filter((entry): entry is { path: string; file: File } => entry.file !== null);
    } catch (value) {
      onError(value instanceof Error ? value.message : String(value));
      return [];
    }
  }

  async function importAudio() {
    const selected = await selectAudioFiles();
    if (!selected.length) return;
    const clips = selected.map(({ path, file }, index): EditorAudioClip => {
      const id = `audio-file-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`;
      const start = snapTime(currentTime + index * 0.01, timeline?.snap ?? 0.1, duration);
      const url = URL.createObjectURL(file);
      audioUrlsRef.current[id] = url;
      setAudioUrls((value) => ({ ...value, [id]: url }));
      return { id, name: path.split(/[\\/]/).pop() ?? path, path, autoEnd: true, start, end: Math.min(duration, start + 2), enabled: true, volume: 1 };
    });
    updateTimeline((value) => ({ ...value, audio: [...value.audio, ...clips] }));
    setSelectedAudioId(clips[0]?.id ?? null);
    onStatus(`Added ${clips.length} local audio clip${clips.length === 1 ? "" : "s"}.`);
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
      return { ...value, subtitles, selectedCueId: subtitles[0]?.id ?? null };
    });
  }

  function deleteAudio() {
    if (!selectedAudio) return;
    updateTimeline((value) => {
      const audio = value.audio.filter((clip) => clip.id !== selectedAudio.id);
      return { ...value, audio };
    });
    setSelectedAudioId(null);
  }

  function addLayer(directoryToAdd: string) {
    if (!timeline || !directoryToAdd || timeline.layers.some((layer) => layer.directory === directoryToAdd)) return;
    const found = discovered.find((item) => item.directory === directoryToAdd);
    const role = found?.role ?? (/_scene$/i.test(directoryToAdd) ? "scene" : /_bg$/i.test(directoryToAdd) ? "background" : "overlay");
    const layer = createTimelineLayer(directoryToAdd, role, timeline.layers.length, duration);
    updateTimeline((value) => ({ ...value, layers: [...value.layers, layer], selectedLayerId: layer.id }));
    onStatus(`Added ${directoryToAdd} as a ${role} layer.`);
  }

  function removeLayer() {
    if (!selectedLayer || selectedLayer.role === "character") return;
    updateTimeline((value) => {
      const layers = value.layers.filter((layer) => layer.id !== selectedLayer.id);
      return { ...value, layers, selectedLayerId: layers.at(-1)?.id ?? null };
    });
  }

  function beginDrag(event: ReactPointerEvent<HTMLElement>, kind: "layer" | "cue" | "cue-start" | "cue-end" | "audio", id: string, start: number, end: number) {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { kind, id, x: event.clientX, start, end };
    onBeginEdit();
  }

  function moveDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || !timeline) return;
    const delta = (event.clientX - drag.x) / (TIMELINE_SCALE * zoom);
    const targets = [...markers, ...timeline.subtitles.filter((cue) => cue.id !== drag.id).flatMap((cue) => [cue.start, cue.end])];
    const snap = (value: number) => Math.max(0, Math.min(duration, snapToTargets(value, event.altKey ? 0 : timeline.snap, event.altKey ? [] : targets)));
    if (drag.kind === "layer") {
      const length = drag.end - drag.start;
      const start = Math.min(duration - length, snap(drag.start + delta));
      updateLayer(drag.id, { start: Math.max(0, start), end: Math.max(start + 0.01, start + length) }, false);
    } else if (drag.kind === "audio") {
      const length = drag.end - drag.start;
      const start = Math.min(duration - length, snap(drag.start + delta));
      updateAudio(drag.id, { start: Math.max(0, start), end: Math.max(start + 0.01, start + length) }, false);
    } else {
      const start = drag.kind === "cue" ? Math.min(duration - (drag.end - drag.start), snap(drag.start + delta)) : drag.start;
      const end = drag.kind === "cue" ? Math.min(duration, start + drag.end - drag.start) : drag.end;
      if (drag.kind === "cue-start") updateCue(drag.id, { start: Math.min(snap(drag.start + delta), drag.end - 0.01) }, false);
      else if (drag.kind === "cue-end") updateCue(drag.id, { end: Math.max(snap(drag.end + delta), drag.start + 0.01) }, false);
      else updateCue(drag.id, { start, end: Math.max(start + 0.01, end) }, false);
    }
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current && event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
  }

  function seekFromEvent(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest(".timeline-cue, .timeline-layer-clip, .timeline-audio-clip")) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubRef.current = true;
    const rect = event.currentTarget.getBoundingClientRect();
    const value = (event.clientX - rect.left) / (TIMELINE_SCALE * zoom);
    setCurrentTime(snapTime(value, timeline?.snap ?? 0.1, duration));
    setPlaying(false);
  }

  function scrubMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!scrubRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setCurrentTime(Math.max(0, Math.min(duration, (event.clientX - rect.left) / (TIMELINE_SCALE * zoom))));
  }

  function duplicateCue() {
    if (!selectedCue) return;
    const length = selectedCue.end - selectedCue.start;
    const start = Math.min(duration - length, selectedCue.end);
    const cue = { ...selectedCue, id: crypto.randomUUID(), start, end: start + length, text: { ...selectedCue.text } };
    updateTimeline((value) => ({ ...value, subtitles: [...value.subtitles, cue], selectedCueId: cue.id }));
  }

  function fitTimeline() { setZoom(Math.max(0.1, ((scrollRef.current?.clientWidth ?? 900) - 160) / (duration * TIMELINE_SCALE))); }

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest("input, textarea, select, [contenteditable=true]")) return;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && ["z", "y"].includes(key)) return;
      if ((event.ctrlKey || event.metaKey) && key === "s") { event.preventDefault(); void saveSubtitleDocuments().then(() => onSave()); }
      else if (key === " ") { event.preventDefault(); setPlaying((value) => !value); }
      else if (key === "arrowleft" || key === "arrowright") { event.preventDefault(); setPlaying(false); setCurrentTime((value) => Math.max(0, Math.min(duration, value + (key === "arrowright" ? 1 : -1) * (event.shiftKey ? 10 : 1) / 60))); }
      else if (key === "home" || key === "end") { event.preventDefault(); setPlaying(false); setCurrentTime(key === "home" ? 0 : duration); }
      else if (key === "delete" || key === "backspace") { event.preventDefault(); if (inspector === "cue") deleteCue(); else if (inspector === "audio") deleteAudio(); }
      else if ((event.ctrlKey || event.metaKey) && key === "d") { event.preventDefault(); duplicateCue(); }
      else if (key === "s" && selectedCue) updateTimeline((value) => splitCue(value, selectedCue.id, currentTime));
      else if (key === "f") fitTimeline();
       else if (key === "escape") setPlaying(false);
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });

  if (!project || !timeline) return <div className="timeline-empty"><strong>Open a Spine asset folder first</strong><span>The timeline uses the selected character set plus matching <code>_bg</code> and <code>_scene</code> directories.</span></div>;

  return (
    <div className="timeline-workspace">
      <aside className="editor-panel sequence-browser">
        <div className="editor-section"><span className="editor-kicker">LOBBY DIRECTOR</span><h2>Sequences</h2><p className="editor-muted">Edit each talk on its own clock. Opening controls the entry into the lobby.</p>
          {sequenceIds.map((id) => <button key={id} className={`sequence-button${timeline.sequenceId === id ? " active" : ""}`} onClick={() => chooseSequence(id)}><strong>{id === "opening" ? "◈ Opening" : `♫ Talk ${id.replace("talk-", "").padStart(2, "0")}`}</strong><small>{id === "opening" ? "Scene → Intro → Idle" : "Body · Face · Voice · Subtitles"}</small></button>)}
          {(!timeline.sequenceId || timeline.sequenceId === "legacy") && <button className="sequence-button active"><strong>Recovered composition</strong><small>Existing edits kept separately</small></button>}
          <button className="editor-button" onClick={() => void importSubtitles()}>Import character subtitles</button>
        </div>
      </aside>
      <section className="timeline-main">
        <div className="sequence-heading"><div><strong>{timeline.sequenceId === "opening" ? "Opening sequence" : timeline.sequenceId?.startsWith("talk-") ? `Talk ${timeline.sequenceId.replace("talk-", "")}` : "Recovered composition"}</strong><small>Non-destructive authoring · local time</small></div><button className="editor-button" onClick={() => setInspector("sequence")}>Sequence settings</button></div>
        {help && <div className="editor-help">Space Play/pause · ←/→ Frame · Shift+←/→ 10 frames · Home/End · S Split subtitle · Ctrl/⌘ D Duplicate · Delete Remove · F Fit · Ctrl/⌘ Z Undo · Ctrl/⌘ S Save</div>}
        <div className="timeline-stage-wrap">
          <div className="timeline-stage">
             {displayLayers.map((layer) => <TimelineLayerCanvas key={layer.id} layer={layer} files={files[layer.directory] ?? null} currentTime={currentTime} sequenceId={timeline.sequenceId} openingMode={timeline.openingMode} sceneDuration={timeline.sceneDuration} onMarkers={(next) => setMarkers((old) => old.join() === next.join() ? old : next)} sharedCameraPose={sharedCameraPose} referenceCamera={layer.role === "character"} onMeta={(id, meta) => setMetas((value) => ({ ...value, [id]: meta }))} onCameraPose={setSharedCameraPose} onAnimationDuration={onAnimationDuration} onError={onError} />)}
            {timeline.audio.map((clip) => <audio key={clip.id} ref={(element) => { audioElementsRef.current[clip.id] = element; }} src={audioUrls[clip.id]} preload="auto" onLoadedMetadata={(event) => applyDecodedAudioDuration(clip.id, event.currentTarget.duration)} />)}
            <div className="timeline-subtitle-preview" aria-live="polite">
              {timeline.subtitles.filter((cue) => cue.enabled && currentTime >= cue.start && currentTime <= cue.end).map((cue) => <div key={cue.id}>{cueText(cue, timeline.language)}</div>)}
            </div>
            {!displayLayers.length && <div className="timeline-empty"><strong>No layers</strong><span>Add a Spine set from the layer inspector.</span></div>}
            <div className="timeline-stage-badge">{seconds(currentTime)} / {seconds(duration)} · {displayLayers.length} Spine layers</div>
          </div>
        </div>

        <div className="timeline-transport">
          <button className="editor-icon-button" onClick={() => setPlaying((value) => !value)}>{playing ? "❚❚" : "▶"}</button>
          <button className="editor-button" onClick={() => { setCurrentTime(0); setPlaying(false); }}>⏮ Start</button>
          <button className="editor-button" onClick={() => { setCurrentTime(duration); setPlaying(false); }}>End ⏭</button>
          <label className="editor-speed">Speed <input type="number" min="0.1" max="3" step="0.1" value={speed} onChange={(event) => setSpeed(Math.max(0.1, Number(event.target.value) || 1))} /></label>
          <label className="timeline-loop"><input type="checkbox" checked={timeline.loop} onChange={(event) => updateTimeline((value) => ({ ...value, loop: event.target.checked }))} /> Loop</label>
          <span className="editor-time">{seconds(currentTime)} / {seconds(duration)}</span>
        </div>

        <input className="sequence-scrubber" aria-label="Sequence playhead" type="range" min="0" max={duration} step={1 / 60} value={currentTime} onChange={(event) => { setPlaying(false); setCurrentTime(Number(event.target.value)); }} />

        <div className="timeline-editor-scroll" ref={scrollRef}>
        <div className="timeline-ruler-row" style={{ minWidth: trackWidth + 116 }}>
          <div className="timeline-track-label">TRACKS</div>
          <div className="timeline-track timeline-ruler" style={{ width: trackWidth }} onPointerDown={seekFromEvent} onPointerMove={scrubMove} onPointerUp={() => { scrubRef.current = false; }} onPointerCancel={() => { scrubRef.current = false; }}>
            {Array.from({ length: Math.ceil(duration) + 1 }, (_, index) => <span key={index} style={{ left: index * TIMELINE_SCALE * zoom }}>{index}s</span>)}
            <i className="timeline-playhead" style={{ left: currentTime * TIMELINE_SCALE * zoom }} />
            {markers.map((time, index) => <i key={index} title={`Spine event ${time.toFixed(3)}s`} className="sequence-marker" style={{ left: time * TIMELINE_SCALE * zoom }} />)}
          </div>
        </div>
          <div className="timeline-track-rows" style={{ minWidth: trackWidth + 116 }} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
                {visibleLayers.map((layer) => <div className="timeline-row" key={layer.id}>
               <div className="timeline-track-label" title={layer.directory}><b>{roleLabel(layer.role)}</b><span>{layer.name}</span></div>
               <div className={`timeline-track timeline-layer-track${layer.id === timeline.selectedLayerId ? " is-selected" : ""}`} onPointerDown={seekFromEvent}>
                 <div className="timeline-layer-clip" style={{ left: layer.start * TIMELINE_SCALE * zoom, width: Math.max(8, (layerEnd(layer) - layer.start) * TIMELINE_SCALE * zoom), zIndex: layer.order }} onPointerDown={(event) => { setSelectedLayer(layer.id); beginDrag(event, "layer", layer.id, layer.start, layerEnd(layer)); }}>
                   <span>{layer.animation || metas[layer.id]?.idleAnimation || "Animation"}</span>
                 </div>
                 <i className="timeline-playhead" style={{ left: currentTime * TIMELINE_SCALE * zoom }} />
               </div>
              </div>)}
            <div className="timeline-row subtitle-row">
              <div className="timeline-track-label"><b>SUBS</b><span>{timeline.language.toUpperCase()}</span></div>
              <div className="timeline-track timeline-subtitle-track" onPointerDown={seekFromEvent}>
                {timeline.subtitles.map((cue) => <div key={cue.id} className={`timeline-cue${cue.id === timeline.selectedCueId ? " is-selected" : ""}${cue.enabled ? "" : " is-disabled"}`} style={{ left: cue.start * TIMELINE_SCALE * zoom, width: Math.max(12, (cue.end - cue.start) * TIMELINE_SCALE * zoom) }} onPointerDown={(event) => { setSelectedCue(cue.id); beginDrag(event, "cue", cue.id, cue.start, cue.end); }}>
                  <button className="timeline-cue-handle left" aria-label="Move subtitle start" onPointerDown={(event) => { event.stopPropagation(); setSelectedCue(cue.id); beginDrag(event, "cue-start", cue.id, cue.start, cue.end); }} />
                  <span>{cueText(cue, timeline.language)}</span>
                  <button className="timeline-cue-handle right" aria-label="Move subtitle end" onPointerDown={(event) => { event.stopPropagation(); setSelectedCue(cue.id); beginDrag(event, "cue-end", cue.id, cue.start, cue.end); }} />
                </div>)}
                <i className="timeline-playhead" style={{ left: currentTime * TIMELINE_SCALE * zoom }} />
              </div>
            </div>
            <div className="timeline-row audio-row">
              <div className="timeline-track-label"><b>AUDIO</b><span>{timeline.audio.length} clip{timeline.audio.length === 1 ? "" : "s"}</span></div>
              <div className="timeline-track timeline-audio-track" onPointerDown={seekFromEvent}>
                {timeline.audio.map((clip) => <div key={clip.id} className={`timeline-audio-clip${clip.id === selectedAudio?.id ? " is-selected" : ""}${clip.enabled ? "" : " is-disabled"}`} style={{ left: clip.start * TIMELINE_SCALE * zoom, width: Math.max(12, (clip.end - clip.start) * TIMELINE_SCALE * zoom) }} onPointerDown={(event) => { setInspector("audio"); setSelectedAudioId(clip.id); beginDrag(event, "audio", clip.id, clip.start, clip.end); }}><AudioWaveform url={audioUrls[clip.id]} onDuration={(value) => applyDecodedAudioDuration(clip.id, value)} /><span>♫ {clip.name}</span></div>)}
                <i className="timeline-playhead" style={{ left: currentTime * TIMELINE_SCALE * zoom }} />
              </div>
            </div>
          </div>
        </div>
        <div className="timeline-bottom-tools">
          <label>Timeline length <input type="number" min="1" step="0.1" value={timeline.duration} onChange={(event) => updateTimeline((value) => ({ ...value, duration: Math.max(1, Number(event.target.value) || 1) }))} /> s</label>
          <label>Snap <select value={timeline.snap} onChange={(event) => updateTimeline((value) => ({ ...value, snap: Number(event.target.value) }))}><option value="0">Off</option><option value="0.01">10 ms</option><option value="0.1">100 ms</option><option value="0.25">250 ms</option><option value="0.5">500 ms</option></select></label>
          <label>Zoom <input type="range" min="0.5" max="3" step="0.1" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
          <button className="editor-button" onClick={addCue}>＋ Subtitle cue</button>
          <button className="editor-button" onClick={fitTimeline}>Fit timeline (F)</button>
          <button className="editor-button" onClick={() => void importAudio()}>＋ Audio</button>
        </div>
      </section>

      <aside className="editor-panel timeline-inspector">
        {inspector === "sequence" && <section className="editor-section editor-inspector"><h2>Sequence</h2>
          {timeline.sequenceId === "opening" && <><label>Opening flow<select value={timeline.openingMode ?? "direct"} onChange={(event) => updateTimeline((value) => ({ ...value, openingMode: event.target.value as "direct" | "scene-first" | "skip" }))}><option value="scene-first">Scene first → Intro → Idle</option><option value="direct">Direct Intro → Idle</option><option value="skip">Skip intro → Idle</option></select></label>{timeline.openingMode === "scene-first" && <label>Scene lead-in (seconds)<input type="number" min="0" step="0.1" value={timeline.sceneDuration ?? 3} onChange={(event) => updateTimeline((value) => ({ ...value, sceneDuration: Math.max(0, Number(event.target.value)) }))} /></label>}</>}
          <p className="editor-muted">Select a layer, subtitle, or voice clip to edit its properties. Space plays this sequence once unless Loop is enabled.</p>
          {timeline.subtitles.some((cue, index, all) => all.some((other, j) => index !== j && cue.start < other.end && cue.end > other.start)) && <p className="editor-error">Overlapping subtitle cues: review timing before export.</p>}
        </section>}
        <section className="editor-section">
          <div className="editor-section-title"><strong>Composition layers</strong><span>{displayLayers.length}</span></div>
          <input className="editor-search" placeholder="Filter layers…" value={layerSearch} onChange={(event) => setLayerSearch(event.target.value)} />
          <div className="timeline-layer-list">
            {visibleLayers.map((layer) => <button key={layer.id} className={layer.id === timeline.selectedLayerId ? "is-selected" : ""} onClick={() => setSelectedLayer(layer.id)}><i className={`timeline-role-dot ${layer.role}`} /><span>{layer.name}</span><small>{roleLabel(layer.role)}</small></button>)}
          </div>
          <div className="timeline-add-layer"><select value="" onChange={(event) => { addLayer(event.target.value); event.target.value = ""; }}><option value="">＋ Add Spine layer…</option>{directories.filter((item) => !timeline.layers.some((layer) => layer.directory === item)).map((item) => <option key={item} value={item}>{item}</option>)}</select></div>
        </section>

        {inspector === "layer" && selectedLayer && <section className="editor-section editor-inspector">
          <div className="editor-section-title"><strong>Layer</strong><button className="danger" onClick={removeLayer} disabled={selectedLayer.role === "character"}>Remove</button></div>
          <label>Name<input value={selectedLayer.name} onChange={(event) => updateLayer(selectedLayer.id, { name: event.target.value })} /></label>
          <div className="editor-two-fields"><label>Role<select value={selectedLayer.role} onChange={(event) => updateLayer(selectedLayer.id, { role: event.target.value as TimelineLayerRole })}><option value="background">Background</option><option value="scene">Scene</option><option value="character">Character</option><option value="overlay">Overlay</option></select></label><label>Order<input type="number" min="0" step="1" value={selectedLayer.order} onChange={(event) => updateLayer(selectedLayer.id, { order: Math.max(0, Number(event.target.value) || 0) })} /></label></div>
           <label>Animation<select value={selectedLayer.animation || metas[selectedLayer.id]?.idleAnimation || ""} onChange={(event) => updateLayer(selectedLayer.id, { animation: event.target.value })}><option value="">Auto idle</option>{(metas[selectedLayer.id]?.animations ?? []).map((animation) => <option key={animation} value={animation}>{animation}</option>)}</select></label>
           <label>Face / secondary animation<select value={selectedLayer.faceAnimation ?? ""} onChange={(event) => updateLayer(selectedLayer.id, { faceAnimation: event.target.value })}><option value="">None</option>{(metas[selectedLayer.id]?.animations ?? []).map((name) => <option key={name}>{name}</option>)}</select></label>
           <div className="editor-two-fields"><label>Start (s)<input type="number" min="0" step="0.01" value={selectedLayer.start} onChange={(event) => updateLayer(selectedLayer.id, { start: Math.max(0, Number(event.target.value) || 0) })} /></label><label>End (s)<input type="number" min="0.01" step="0.01" value={selectedLayer.end} onChange={(event) => updateLayer(selectedLayer.id, { endMode: "manual", end: Math.max(selectedLayer.start + 0.01, Number(event.target.value) || selectedLayer.start + 0.01) })} /></label></div>
           <label><span className="timeline-inline-check"><input type="checkbox" checked={selectedLayer.endMode !== "manual"} onChange={(event) => updateLayer(selectedLayer.id, { endMode: event.target.checked ? "auto" : "manual" })} /> Use Spine animation end</span></label>
          <div className="editor-two-fields"><label>Animation offset<input type="number" min="0" step="0.01" value={selectedLayer.animationOffset} onChange={(event) => updateLayer(selectedLayer.id, { animationOffset: Math.max(0, Number(event.target.value) || 0) })} /></label><label><span>Playback</span><span className="timeline-inline-check"><input type="checkbox" checked={selectedLayer.loop} onChange={(event) => updateLayer(selectedLayer.id, { loop: event.target.checked })} /> Loop</span></label></div>
          <details><summary>Advanced transforms</summary><div className="editor-three-fields"><label>X<input type="number" step="1" value={selectedLayer.x} onChange={(event) => updateLayer(selectedLayer.id, { x: Number(event.target.value) || 0 })} /></label><label>Y<input type="number" step="1" value={selectedLayer.y} onChange={(event) => updateLayer(selectedLayer.id, { y: Number(event.target.value) || 0 })} /></label><label>Scale<input type="number" min="0.01" step="0.01" value={selectedLayer.scale} onChange={(event) => updateLayer(selectedLayer.id, { scale: Math.max(0.01, Number(event.target.value) || 0.01) })} /></label></div></details>
          <label>Opacity · {Math.round(selectedLayer.opacity * 100)}%<input type="range" min="0" max="1" step="0.01" value={selectedLayer.opacity} onChange={(event) => updateLayer(selectedLayer.id, { opacity: Number(event.target.value) })} /></label>
          <label><span className="timeline-inline-check"><input type="checkbox" checked={selectedLayer.enabled} onChange={(event) => updateLayer(selectedLayer.id, { enabled: event.target.checked })} /> Visible</span></label>
        </section>}

        <section className="editor-section editor-inspector">
          <div className="editor-section-title"><strong>Subtitles</strong><span>{timeline.subtitles.length}</span></div>
          <div className="subtitle-card-tabs" role="tablist" aria-label="Subtitle cues">
            {timeline.subtitles.map((cue, index) => <button key={cue.id} role="tab" aria-selected={cue.id === timeline.selectedCueId} className={`subtitle-card-tab${cue.id === timeline.selectedCueId ? " is-selected" : ""}`} onClick={() => setSelectedCue(cue.id)}>
              <strong>Subtitle #{index + 1}</strong>
              <small>{seconds(cue.start)}–{seconds(cue.end)}</small>
            </button>)}
          </div>
          {!timeline.subtitles.length && <p className="editor-muted">Add a subtitle cue to create Subtitle #1. Each card has its own timing and EN, JA, and KO fields.</p>}
          {inspector === "cue" && selectedCue && <div className="subtitle-editor-card">
            <div className="subtitle-editor-heading"><strong>Subtitle #{selectedCueIndex + 1}</strong><span>{seconds(selectedCue.start)}–{seconds(selectedCue.end)}</span></div>
            <div className="editor-two-fields subtitle-actions"><button className="editor-button" onClick={() => updateCue(selectedCue.id, { start: Math.min(currentTime, selectedCue.end - 0.01) })}>Start at playhead</button><button className="editor-button" onClick={() => updateCue(selectedCue.id, { end: Math.max(currentTime, selectedCue.start + 0.01) })}>End at playhead</button></div>
            <div className="editor-two-fields"><label>Start (s)<input aria-label="Subtitle start" type="number" min="0" step="0.01" value={selectedCue.start} onChange={(event) => updateCue(selectedCue.id, { start: Math.max(0, Math.min(selectedCue.end - 0.01, Number(event.target.value) || 0)) })} /></label><label>End (s)<input aria-label="Subtitle end" type="number" min="0.01" step="0.01" value={selectedCue.end} onChange={(event) => updateCue(selectedCue.id, { end: Math.max(selectedCue.start + 0.01, Math.min(duration, Number(event.target.value) || selectedCue.start + 0.01)) })} /></label></div>
            <div className="subtitle-language-grid">
              {(["en", "ja", "ko"] as const).map((language) => <label className={`subtitle-language-field subtitle-language-${language}`} key={language}><span>{language.toUpperCase()}</span><textarea aria-label={`${language.toUpperCase()} Subtitle #${selectedCueIndex + 1}`} className="timeline-textarea" value={selectedCue.text[language]} onChange={(event) => updateCue(selectedCue.id, { text: { ...selectedCue.text, [language]: event.target.value } })} /></label>)}
            </div>
            <div className="subtitle-preview-language"><span>Preview language</span><div className="timeline-language-tabs">{(["en", "ja", "ko"] as const).map((language) => <button key={language} className={timeline.language === language ? "is-selected" : ""} onClick={() => updateTimeline((value) => ({ ...value, language }))}>{language.toUpperCase()}</button>)}</div></div>
            <div className="editor-two-fields subtitle-actions"><button className="editor-button" onClick={() => updateTimeline((value) => splitCue(value, selectedCue.id, currentTime))}>Split (S)</button><button className="editor-button" onClick={duplicateCue}>Duplicate</button><button className="editor-button" onClick={() => { setCurrentTime(selectedCue.start); setPlaying(true); }}>Preview cue</button></div>
            <div className="editor-two-fields"><label><span className="timeline-inline-check"><input type="checkbox" checked={selectedCue.enabled} onChange={(event) => updateCue(selectedCue.id, { enabled: event.target.checked })} /> Visible</span></label><button className="editor-preview-button" onClick={deleteCue}>Delete cue</button></div>
          </div>}
        </section>

        <section className="editor-section editor-inspector">
          <div className="editor-section-title"><strong>Audio clips</strong><span>{timeline.audio.length}</span></div>
          {!timeline.audio.length && <p className="editor-muted">Import audio files or import a subtitle JSON containing audio paths.</p>}
          {timeline.audio.length > 0 && <div className="timeline-audio-list">{timeline.audio.map((clip) => <button key={clip.id} className={clip.id === selectedAudio?.id ? "is-selected" : ""} onClick={() => { setInspector("audio"); setSelectedAudioId(clip.id); }}><span>{seconds(clip.start)}–{seconds(clip.end)}</span><small>{clip.name}</small></button>)}</div>}
          {missingAudio.filter((path) => timeline.audio.some((clip) => clip.path === path)).length > 0 && <><p className="editor-error">Some audio files are outside the selected source. Open the parent asset root containing <code>lobbies/</code> and <code>audios/voicelines/</code>, or relink matching files for this session.</p><button className="editor-button" onClick={() => void relinkAudio()}>Relink missing audio</button></>}
          {inspector === "audio" && selectedAudio && <>
            <label>Name<input value={selectedAudio.name} onChange={(event) => updateAudio(selectedAudio.id, { name: event.target.value })} /></label>
            <div className="editor-two-fields"><label>Start (s)<input type="number" min="0" step="0.01" value={selectedAudio.start} onChange={(event) => updateAudio(selectedAudio.id, { start: Math.max(0, Math.min(selectedAudio.end - 0.01, Number(event.target.value) || 0)) })} /></label><label>End (s)<input type="number" min="0.01" step="0.01" value={selectedAudio.end} onChange={(event) => updateAudio(selectedAudio.id, { end: Math.max(selectedAudio.start + 0.01, Math.min(duration, Number(event.target.value) || selectedAudio.start + 0.01)) })} /></label></div>
            <label>Volume · {Math.round(selectedAudio.volume * 100)}%<input type="range" min="0" max="1" step="0.01" value={selectedAudio.volume} onChange={(event) => updateAudio(selectedAudio.id, { volume: Number(event.target.value) })} /></label>
            <div className="editor-two-fields"><label><span className="timeline-inline-check"><input type="checkbox" checked={selectedAudio.enabled} onChange={(event) => updateAudio(selectedAudio.id, { enabled: event.target.checked })} /> Enabled</span></label><button className="editor-preview-button" onClick={deleteAudio}>Delete clip</button></div>
            <p className="editor-muted">{selectedAudio.path}</p>
          </>}
        </section>
      </aside>
    </div>
  );
}
