import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties } from "react";
import { SpineRenderer, type SpineCameraPose, type SpineFiles, type SpineMeta, type SpineProgress } from "./spineRuntime";
import type { AssetSource } from "./spineAssets";
import { timelineLayerSampleTime, timelinePlaybackDuration, type SpineTimeline, type SpineTimelineLayer } from "./spineTimeline";

export interface SpineCompositionViewportHandle {
  resetCamera: () => void;
  toggleFullscreen: () => Promise<void>;
  restartPlayback: () => void;
  seek: (time: number) => void;
}

interface SpineCompositionViewportProps {
  source: AssetSource;
  timeline: SpineTimeline;
  currentTime: number;
  playing: boolean;
  speed: number;
  effectsStrength: number;
  onMeta: (meta: SpineMeta | null) => void;
  onProgress: (progress: SpineProgress) => void;
  onLoading: (loading: boolean) => void;
  onError: (error: Error | null) => void;
  onFinished: () => void;
}

interface CompositionLayerProps {
  layer: SpineTimelineLayer;
  files: SpineFiles | null;
  currentTime: number;
  sequenceId: string;
  openingMode: SpineTimeline["openingMode"];
  sharedCameraPose: SpineCameraPose | null;
  referenceCamera: boolean;
  resetCameraSignal: number;
  effectsStrength: number;
  onMeta: (layerId: string, meta: SpineMeta | null) => void;
  onCameraPose: (pose: SpineCameraPose) => void;
  onError: (value: string | null) => void;
}

function CompositionLayer({ layer, files, currentTime, sequenceId, openingMode, sharedCameraPose, referenceCamera, resetCameraSignal, effectsStrength, onMeta, onCameraPose, onError }: CompositionLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<SpineRenderer | null>(null);
  const [meta, setMeta] = useState<SpineMeta | null>(null);
  const onMetaRef = useRef(onMeta);
  const onCameraPoseRef = useRef(onCameraPose);
  const onErrorRef = useRef(onError);
  onMetaRef.current = onMeta;
  onCameraPoseRef.current = onCameraPose;
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
    renderer.setEffectsStrength(effectsStrength);
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

  useEffect(() => {
    rendererRef.current?.setEffectsStrength(effectsStrength);
  }, [effectsStrength]);

  useEffect(() => {
    if (resetCameraSignal > 0) rendererRef.current?.resetCamera();
  }, [resetCameraSignal]);

  const openingCharacter = sequenceId === "opening" && layer.role === "character";
  const intro = meta?.introAnimation;
  const introDuration = intro ? rendererRef.current?.getEditorAnimationInfo(intro).duration ?? 0 : 0;
  const useIntro = openingCharacter && openingMode !== "skip" && currentTime >= layer.start && currentTime - layer.start < introDuration;
  const animation = useIntro ? intro! : layer.animation || meta?.idleAnimation || meta?.animations[0] || "";
  const animationDuration = rendererRef.current?.getEditorAnimationInfo(animation).duration ?? 0;
  const talkCharacter = sequenceId.startsWith("talk-") && layer.role === "character" && layer.endMode !== "manual";
  const effectiveLoop = talkCharacter ? false : layer.loop;
  const time = timelineLayerSampleTime(layer, currentTime, sequenceId, openingMode, introDuration, animationDuration);
  useEffect(() => {
    if (!meta || !animation) return;
    rendererRef.current?.sampleEditorAnimation(animation, layer.faceAnimation ?? "", time, effectiveLoop, talkCharacter);
  }, [animation, effectiveLoop, layer.faceAnimation, meta, talkCharacter, time]);

  useEffect(() => {
    if (!referenceCamera && sharedCameraPose) rendererRef.current?.setCameraPose(sharedCameraPose);
  }, [referenceCamera, sharedCameraPose]);

  const visible = layer.enabled && currentTime >= layer.start && currentTime <= layer.end;
  const style: CSSProperties = {
    position: "absolute",
    inset: 0,
    zIndex: layer.order,
    opacity: visible ? layer.opacity : 0,
    visibility: visible ? "visible" : "hidden",
    transform: `translate(${layer.x}px, ${layer.y}px) scale(${layer.scale})`,
    transformOrigin: "center center",
    pointerEvents: "none",
  };
  return <canvas ref={canvasRef} className="spine-composition-layer" style={style} aria-label={`${layer.name} Spine layer`} />;
}

function audioPathCandidates(path: string): string[] {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+/g, "/");
  const withoutAudioRoot = normalized.replace(/^audios\/voicelines\//i, "");
  const withoutAudios = normalized.replace(/^audios\//i, "");
  const basename = normalized.split("/").at(-1) ?? normalized;
  return [...new Set([normalized, withoutAudioRoot, withoutAudios, basename])].filter(Boolean);
}

export const SpineCompositionViewport = forwardRef<SpineCompositionViewportHandle, SpineCompositionViewportProps>(function SpineCompositionViewport({ source, timeline, currentTime, playing, speed, effectsStrength, onMeta, onProgress, onLoading, onError, onFinished }, ref) {
  const stageRef = useRef<HTMLDivElement>(null);
  const currentTimeRef = useRef(currentTime);
  const finishedRef = useRef(false);
  const onProgressRef = useRef(onProgress);
  const onFinishedRef = useRef(onFinished);
  const onLoadingRef = useRef(onLoading);
  const onErrorRef = useRef(onError);
  const [files, setFiles] = useState<Record<string, SpineFiles | null>>({});
  const [sharedCameraPose, setSharedCameraPose] = useState<SpineCameraPose | null>(null);
  const [resetCameraSignal, setResetCameraSignal] = useState(0);
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});
  const audioElementsRef = useRef<Record<string, HTMLAudioElement | null>>({});
  currentTimeRef.current = currentTime;
  onProgressRef.current = onProgress;
  onFinishedRef.current = onFinished;
  onLoadingRef.current = onLoading;
  onErrorRef.current = onError;

  const layers = useMemo(() => [...timeline.layers].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)), [timeline.layers]);
  const referenceLayerId = layers.find((layer) => layer.role === "character")?.id ?? layers[0]?.id ?? "";
  const directoriesKey = [...new Set(layers.map((layer) => layer.directory))].join("|");
  const audioKey = timeline.audio.map((clip) => `${clip.id}:${clip.path}`).join("|");

  useEffect(() => {
    let live = true;
    const directories = [...new Set(layers.map((layer) => layer.directory))];
    setFiles({});
    setSharedCameraPose(null);
    if (!directories.length) {
      onLoadingRef.current(false);
      return () => { live = false; };
    }
    onLoadingRef.current(true);
    void Promise.all(directories.map(async (item) => [item, await source.getSetFiles(item)] as const)).then((entries) => {
      if (!live) return;
      setFiles(Object.fromEntries(entries));
      onLoadingRef.current(false);
    }).catch((reason) => {
      if (!live) return;
      onLoadingRef.current(false);
      onErrorRef.current(reason instanceof Error ? reason : new Error(String(reason)));
    });
    return () => { live = false; };
  // The layer directory key keeps this request scoped to the saved composition.
  // eslint is intentionally not part of this repository; keep the dependency explicit.
  }, [directoriesKey, layers, source]);

  useEffect(() => {
    let live = true;
    const urls: Record<string, string> = {};
    setAudioUrls({});
    void Promise.all(timeline.audio.map(async (clip) => {
      for (const candidate of audioPathCandidates(clip.path)) {
        const file = await source.getFile(candidate);
        if (file) {
          urls[clip.id] = URL.createObjectURL(file);
          break;
        }
      }
    })).then(() => {
      if (live) setAudioUrls(urls);
      else Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
    });
    return () => {
      live = false;
      Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [audioKey, source, timeline.audio]);

  useEffect(() => {
    const duration = timelinePlaybackDuration(timeline);
    const time = Math.max(0, Math.min(duration, currentTimeRef.current));
    currentTimeRef.current = time;
    onProgressRef.current({ time, duration, animation: null });
  }, [timeline.sequenceId, timeline.duration]);

  useEffect(() => {
    if (!playing) {
      Object.values(audioElementsRef.current).forEach((audio) => audio?.pause());
      return;
    }
    for (const clip of timeline.audio) {
      const audio = audioElementsRef.current[clip.id];
      if (!audio || !clip.enabled) continue;
      audio.volume = clip.volume;
      const active = currentTime >= clip.start && currentTime < clip.end;
      if (!active) {
        audio.pause();
        continue;
      }
      const local = Math.max(0, currentTime - clip.start);
      if (Math.abs(audio.currentTime - local) > 0.15) audio.currentTime = local;
      void audio.play().catch(() => undefined);
    }
  }, [currentTime, playing, timeline.audio]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let previous = 0;
    finishedRef.current = false;
    const tick = (now: number) => {
      if (!previous) previous = now;
      const elapsed = Math.max(0, (now - previous) / 1000) * speed;
      previous = now;
      const duration = timelinePlaybackDuration(timeline);
      let next = currentTimeRef.current + elapsed;
      if (next >= duration) {
        if (timeline.loop) next %= duration;
        else {
          next = duration;
          if (!finishedRef.current) {
            finishedRef.current = true;
            onFinishedRef.current();
          }
          currentTimeRef.current = next;
          onProgressRef.current({ time: next, duration, animation: null });
          return;
        }
      }
      currentTimeRef.current = next;
      onProgressRef.current({ time: next, duration, animation: null });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, timeline]);

  useImperativeHandle(ref, () => ({
    resetCamera: () => setResetCameraSignal((value) => value + 1),
    toggleFullscreen: async () => {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (stageRef.current?.requestFullscreen) await stageRef.current.requestFullscreen();
    },
    restartPlayback: () => onProgressRef.current({ time: 0, duration: timelinePlaybackDuration(timeline), animation: null }),
    seek: (time) => onProgressRef.current({ time: Math.max(0, Math.min(timelinePlaybackDuration(timeline), time)), duration: timelinePlaybackDuration(timeline), animation: null }),
  }), [timeline]);

  const subtitle = timeline.subtitles
    .filter((cue) => cue.enabled && currentTime >= cue.start && currentTime <= cue.end)
    .at(-1);
  const subtitleText = subtitle?.text[timeline.language] || subtitle?.text.en || subtitle?.text.ja || subtitle?.text.ko || "";
  return <div ref={stageRef} className="spine-stage spine-stage-composition">
    {layers.map((layer) => <CompositionLayer key={layer.id} layer={layer} files={files[layer.directory] ?? null} currentTime={currentTime} sequenceId={timeline.sequenceId} openingMode={timeline.openingMode} sharedCameraPose={sharedCameraPose} referenceCamera={layer.id === referenceLayerId} resetCameraSignal={resetCameraSignal} effectsStrength={effectsStrength} onMeta={(id, value) => { if (id === referenceLayerId) onMeta(value); }} onCameraPose={setSharedCameraPose} onError={(value) => onError(value ? new Error(value) : null)} />)}
    {subtitleText && <div className="spine-dialogue" aria-live="polite">{subtitleText}</div>}
    {timeline.audio.map((clip) => <audio key={clip.id} ref={(element) => { audioElementsRef.current[clip.id] = element; }} src={audioUrls[clip.id]} preload="auto" />)}
  </div>;
});
