import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties } from "react";
import { SpineRenderer, type SpineCameraPose, type SpineFiles, type SpineInteractionMode, type SpineInteractionOverlay, type SpineMeta, type SpineProgress } from "./spineRuntime";
import type { AssetSource } from "./spineAssets";
import type { SpineInteractionProject } from "./spineInteraction";
import { timelineIdleAnimation, timelineTalkIdleStart } from "./spineTimeline";
import { timelineActiveSubtitleTexts, timelineAnimationNeedsIdleUnderlay, timelineAudioPlaybackDecision, timelineLayerAnimation, timelineLayerPlaybackEnd, timelineLayerSampleTime, timelineMainAnimation, timelinePlaybackDuration, type SpineTimeline, type SpineTimelineLayer } from "./spineTimeline";

export interface SpineCompositionViewportHandle {
  resetCamera: () => void;
  toggleFullscreen: () => Promise<void>;
  restartPlayback: () => void;
  seek: (time: number) => void;
  triggerTalk: (animation?: string) => void;
  setTalkAudioPending: (pending: boolean) => void;
  startIntroAudio: () => void;
}

interface SpineCompositionViewportProps {
  source: AssetSource;
  timeline: SpineTimeline;
  interactionMode: SpineInteractionMode;
  interactionProject: SpineInteractionProject | null;
  showInteractionPoints: boolean;
  currentTime: number;
  playing: boolean;
  speed: number;
  effectsStrength: number;
  idleMode?: "none" | "persistent" | "bridge";
  onMeta: (meta: SpineMeta | null) => void;
  onProgress: (progress: SpineProgress) => void;
  onLoading: (loading: boolean) => void;
  onError: (error: Error | null) => void;
  onFinished: () => void;
  onTalk: (index: number, animation: string, eventCount: number) => boolean;
  onTalkClip: (index: number, clipIndex: number) => void;
  onIntro: (animation: string, eventCount: number) => boolean;
  onIntroClip: (clipIndex: number) => void;
}

interface CompositionLayerProps {
  layer: SpineTimelineLayer;
  files: SpineFiles | null;
  interactionEnabled: boolean;
  interactionProject: SpineInteractionProject | null;
  showInteractionPoints: boolean;
  currentTime: number;
  mainAnimation?: string;
  mainAnimationTime?: number;
  mainAnimationLoop?: boolean;
  sequenceId: string;
  openingMode: SpineTimeline["openingMode"];
  sharedCameraPose: SpineCameraPose | null;
  referenceCamera: boolean;
  resetCameraSignal: number;
  effectsStrength: number;
  idleMode: "none" | "persistent" | "bridge";
  onMeta: (layerId: string, meta: SpineMeta | null) => void;
  onAnimationDuration: (layerId: string, animation: string, duration: number) => void;
  onInteractionPoints: (layerId: string, overlay: SpineInteractionOverlay) => void;
  onRenderer: (layerId: string, renderer: SpineRenderer | null) => void;
  onCameraPose: (pose: SpineCameraPose) => void;
  onTalk: (index: number, animation: string, eventCount: number) => boolean;
  onTalkClip: (index: number, clipIndex: number) => void;
  onIntro: (animation: string, eventCount: number) => boolean;
  onIntroClip: (clipIndex: number) => void;
  onError: (value: string | null) => void;
}

function CompositionLayer({ layer, files, interactionEnabled, interactionProject, showInteractionPoints, currentTime, mainAnimation, mainAnimationTime, mainAnimationLoop, sequenceId, openingMode, idleMode, sharedCameraPose, referenceCamera, resetCameraSignal, effectsStrength, onMeta, onAnimationDuration, onInteractionPoints, onRenderer, onCameraPose, onTalk, onTalkClip, onIntro, onIntroClip, onError }: CompositionLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<SpineRenderer | null>(null);
  const [meta, setMeta] = useState<SpineMeta | null>(null);
  const onMetaRef = useRef(onMeta);
  const onAnimationDurationRef = useRef(onAnimationDuration);
  const onInteractionPointsRef = useRef(onInteractionPoints);
  const onRendererRef = useRef(onRenderer);
  const onCameraPoseRef = useRef(onCameraPose);
  const onTalkRef = useRef(onTalk);
  const onTalkClipRef = useRef(onTalkClip);
  const onIntroRef = useRef(onIntro);
  const onIntroClipRef = useRef(onIntroClip);
  const onErrorRef = useRef(onError);
  onMetaRef.current = onMeta;
  onAnimationDurationRef.current = onAnimationDuration;
  onInteractionPointsRef.current = onInteractionPoints;
  onRendererRef.current = onRenderer;
  onCameraPoseRef.current = onCameraPose;
  onTalkRef.current = onTalk;
  onTalkClipRef.current = onTalkClip;
  onIntroRef.current = onIntro;
  onIntroClipRef.current = onIntroClip;
  onErrorRef.current = onError;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: SpineRenderer;
    try {
      renderer = new SpineRenderer(canvas, {
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
        onInteractionPoints: (value) => onInteractionPointsRef.current(layer.id, value),
        onTalk: (index, animation, eventCount) => onTalkRef.current(index, animation, eventCount),
        onTalkClip: (index, clipIndex) => onTalkClipRef.current(index, clipIndex),
        onIntro: (animation, eventCount) => onIntroRef.current(animation, eventCount),
        onIntroClip: (clipIndex) => onIntroClipRef.current(clipIndex),
      });
    } catch (value) {
      onErrorRef.current(value instanceof Error ? value.message : String(value));
      return;
    }
    renderer.setPlaying(false);
    renderer.setLoop(false);
    renderer.setEffectsStrength(effectsStrength);
    rendererRef.current = renderer;
    onRendererRef.current(layer.id, renderer);
    return () => {
      onRendererRef.current(layer.id, null);
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [layer.id, referenceCamera]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    if (files) void renderer.load(files, layer.directory, interactionProject);
    else renderer.clear();
    return () => renderer.clear();
  }, [files, interactionProject, layer.directory]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setInteractionMode(interactionEnabled ? "interaction" : "free");
    renderer.setShowInteractionPoints(showInteractionPoints);
  }, [interactionEnabled, showInteractionPoints]);

  useEffect(() => {
    rendererRef.current?.setEffectsStrength(effectsStrength);
  }, [effectsStrength]);

  useEffect(() => {
    if (resetCameraSignal > 0) rendererRef.current?.resetCamera();
  }, [resetCameraSignal]);

  const intro = meta?.introAnimation;
  const introDuration = intro ? rendererRef.current?.getEditorAnimationInfo(intro).duration ?? 0 : 0;
  const authoredAnimation = meta ? timelineLayerAnimation(layer, meta, mainAnimation, currentTime, sequenceId, openingMode, introDuration) : "";
  const authoredDuration = authoredAnimation ? rendererRef.current?.getEditorAnimationInfo(authoredAnimation).duration ?? 0 : 0;
  const talkLayer = sequenceId.startsWith("talk-") && (layer.role === "character" || layer.role === "background");
  const idleTailStart = timelineTalkIdleStart(layer, authoredDuration);
  const idleTail = talkLayer && currentTime >= idleTailStart;
  const idle = idleMode !== "none" || idleTail;
  const animation = meta ? idle ? timelineIdleAnimation(meta) : authoredAnimation : "";
  const animationDuration = animation ? rendererRef.current?.getEditorAnimationInfo(animation).duration ?? 0 : 0;
  const talkCharacter = sequenceId.startsWith("talk-") && layer.role === "character" && layer.endMode !== "manual";
  const followMainClock = Boolean(layer.followMainAnimation && mainAnimationTime !== undefined);
  const effectiveLoop = idle || (followMainClock && mainAnimationLoop !== undefined ? mainAnimationLoop : talkCharacter ? false : layer.loop);
  const time = idle ? idleTail && idleMode === "none" ? currentTime - idleTailStart : currentTime : followMainClock
    ? mainAnimationTime!
    : timelineLayerSampleTime(layer, currentTime, sequenceId, openingMode, introDuration, animationDuration);
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !meta || !animation || !meta.animations.some((name) => name === animation)) return;
    // Prime the layer selection before deterministic sampling. This keeps the
    // composition renderer's lifecycle identical to the editor preview when a
    // followed layer switches from its fallback to the main animation.
    renderer.setAnimation(animation, true);
  }, [animation, meta]);

  useEffect(() => {
    if (!meta || !animation) return;
    rendererRef.current?.sampleEditorAnimation(animation, idle ? "" : layer.faceAnimation ?? "", time, effectiveLoop, timelineAnimationNeedsIdleUnderlay(animation), interactionEnabled);
  }, [animation, effectiveLoop, followMainClock, idle, interactionEnabled, layer.faceAnimation, mainAnimationLoop, mainAnimationTime, meta, openingMode, sequenceId, talkCharacter, time]);

  useEffect(() => {
    if (animationDuration > 0 && animation) onAnimationDurationRef.current(layer.id, animation, animationDuration);
  }, [animation, animationDuration, layer.id]);

  useEffect(() => {
    if (!referenceCamera && sharedCameraPose) rendererRef.current?.setCameraPose(sharedCameraPose);
  }, [referenceCamera, sharedCameraPose]);

  const layerEnd = timelineLayerPlaybackEnd(talkCharacter ? { ...layer, loop: false } : layer, animationDuration);
  const visible = layer.enabled && (idle ? layer.role === "character" || layer.role === "background" : currentTime >= layer.start && (talkLayer || currentTime <= layerEnd));
  const style: CSSProperties = {
    position: "absolute",
    inset: 0,
    zIndex: layer.order,
    opacity: visible ? layer.opacity : 0,
    visibility: visible ? "visible" : "hidden",
    transform: `translate(${layer.x}px, ${layer.y}px) scale(${layer.scale})`,
    transformOrigin: "center center",
    pointerEvents: interactionEnabled && visible ? "auto" : "none",
  };
  return <canvas ref={canvasRef} className="spine-composition-layer" style={style} data-animation={animation} data-sample-time={time} aria-label={`${layer.name} Spine layer`} />;
}

function audioPathCandidates(path: string): string[] {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+/g, "/");
  const withoutAudioRoot = normalized.replace(/^audios\/voicelines\//i, "");
  const withoutAudios = normalized.replace(/^audios\//i, "");
  const basename = normalized.split("/").at(-1) ?? normalized;
  return [...new Set([normalized, withoutAudioRoot, withoutAudios, basename])].filter(Boolean);
}

export const SpineCompositionViewport = forwardRef<SpineCompositionViewportHandle, SpineCompositionViewportProps>(function SpineCompositionViewport({ source, timeline, interactionMode, interactionProject, showInteractionPoints, currentTime, playing, speed, effectsStrength, idleMode = "none", onMeta, onProgress, onLoading, onError, onFinished, onTalk, onTalkClip, onIntro, onIntroClip }, ref) {
  const stageRef = useRef<HTMLDivElement>(null);
  const currentTimeRef = useRef(currentTime);
  const phaseRef = useRef<{ timeline: SpineTimeline | null; idleMode: "none" | "persistent" | "bridge" }>({ timeline: null, idleMode: "none" });
  const finishedRef = useRef(false);
  const onProgressRef = useRef(onProgress);
  const onFinishedRef = useRef(onFinished);
  const onLoadingRef = useRef(onLoading);
  const onErrorRef = useRef(onError);
  const [files, setFiles] = useState<Record<string, SpineFiles | null>>({});
  const [metas, setMetas] = useState<Record<string, SpineMeta | null>>({});
  const [animationDurations, setAnimationDurations] = useState<Record<string, number>>({});
  const [sharedCameraPose, setSharedCameraPose] = useState<SpineCameraPose | null>(null);
  const [interactionOverlay, setInteractionOverlay] = useState<SpineInteractionOverlay>({ canvasWidth: 0, canvasHeight: 0, points: [] });
  const [resetCameraSignal, setResetCameraSignal] = useState(0);
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});
  const audioElementsRef = useRef<Record<string, HTMLAudioElement | null>>({});
  const talkRendererRef = useRef<SpineRenderer | null>(null);
  const audioStartedRef = useRef<Record<string, boolean>>({});
  const audioPreviousTimeRef = useRef<Record<string, number | undefined>>({});
  const fileCacheRef = useRef(new Map<string, Promise<SpineFiles | null>>());
  onProgressRef.current = onProgress;
  onFinishedRef.current = onFinished;
  onLoadingRef.current = onLoading;
  onErrorRef.current = onError;

  const layers = useMemo(() => [...timeline.layers].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)), [timeline.layers]);
  const referenceLayerId = layers.find((layer) => layer.role === "character")?.id ?? layers[0]?.id ?? "";
  const characterLayer = layers.find((layer) => layer.role === "character");
  const characterMeta = characterLayer ? metas[characterLayer.id] ?? null : null;
  const introAnimation = characterMeta?.introAnimation ?? "";
  const introDuration = characterLayer && introAnimation
    ? animationDurations[`${characterLayer.id}:${introAnimation}`] ?? 0
    : 0;
  const mainAnimationName = characterLayer
    ? characterLayer.animation || characterMeta?.idleAnimation || characterMeta?.animations[0] || ""
    : "";
  const mainAnimationDuration = characterLayer && mainAnimationName
    ? animationDurations[`${characterLayer.id}:${mainAnimationName}`] ?? 0
    : 0;
  const openingMinimumDuration = timeline.sequenceId === "opening" && characterLayer
    ? characterLayer.start + (timeline.openingMode === "skip" ? 0 : introDuration)
    : 0;
  const playbackDuration = idleMode !== "none" ? Math.max(0.01, timeline.openingIdleDuration) : timelinePlaybackDuration(timeline, openingMinimumDuration);
  const openingIdleStart = idleMode === "none" && timeline.sequenceId === "opening" && characterLayer
    ? characterLayer.start + (timeline.openingMode === "skip" ? 0 : introDuration)
    : 0;
  const openingIdleActive = idleMode !== "none";
  const effectiveCurrentTime = idleMode === "persistent" && openingIdleActive
    ? Math.max(currentTime, currentTimeRef.current, openingIdleStart)
    : openingIdleActive
      ? Math.max(currentTime, openingIdleStart)
      : currentTime;
  const mainAnimationState = characterLayer && characterMeta
    ? timelineMainAnimation(characterLayer, characterMeta, effectiveCurrentTime, timeline.sequenceId, timeline.openingMode, introDuration, mainAnimationDuration)
    : null;
  const progressAnimation = mainAnimationState?.animation ?? null;
  // Do not consume an opening while the saved composition is still loading.
  // The page starts in autoplay mode, so advancing the shared playhead before
  // every layer has a renderer/meta would skip a short editor-authored intro.
  const compositionReady = layers.length > 0 && layers.every((layer) => Boolean(files[layer.directory] && metas[layer.id]));
  const directoriesKey = [...new Set(layers.map((layer) => layer.directory))].join("|");
  const assetPathsKey = JSON.stringify(timeline.assetPaths ?? {});
  const audioKey = timeline.audio.map((clip) => `${clip.id}:${clip.path}`).join("|");

  useEffect(() => { fileCacheRef.current.clear(); }, [source]);

  useEffect(() => {
    let live = true;
    const directories = [...new Set(layers.map((layer) => layer.directory))];
    if (!directories.length) {
      onLoadingRef.current(false);
      return () => { live = false; };
    }
    onLoadingRef.current(true);
    void Promise.all(directories.map(async (item) => {
      const assetPath = timeline.assetPaths?.[item];
      const key = assetPath ?? item;
      let pending = fileCacheRef.current.get(key);
      if (!pending) {
        pending = assetPath && source.getSetFilesAtPath ? source.getSetFilesAtPath(assetPath) : source.getSetFiles(item);
        fileCacheRef.current.set(key, pending);
      }
      const files = await pending;
      return [item, files] as const;
    })).then((entries) => {
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
  }, [assetPathsKey, directoriesKey, source]);

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
    const previous = phaseRef.current;
    const timelineChanged = previous.timeline !== timeline;
    const modeChanged = previous.idleMode !== idleMode;
    const idle = idleMode !== "none";
    let report = false;

    if (timelineChanged) {
      currentTimeRef.current = idle ? openingIdleStart : 0;
      report = true;
    } else if (modeChanged) {
      if (idleMode === "bridge") currentTimeRef.current = openingIdleStart;
      else if (idleMode === "persistent") currentTimeRef.current = Math.max(currentTimeRef.current, currentTime, openingIdleStart);
      else currentTimeRef.current = currentTime;
      report = true;
    } else if (idle && currentTimeRef.current < openingIdleStart) {
      // Intro metadata may arrive after the opening has switched to idle.
      // Move the clock forward to the measured idle boundary, never back to
      // the opening start.
      currentTimeRef.current = openingIdleStart;
      report = true;
    }

    phaseRef.current = { timeline, idleMode };
    if (report) {
      const time = idleMode === "persistent"
        ? Math.min(playbackDuration, Math.max(openingIdleStart, currentTimeRef.current))
        : Math.min(playbackDuration, Math.max(0, currentTimeRef.current));
      onProgressRef.current({ time, duration: playbackDuration, animation: progressAnimation });
    }
  }, [currentTime, idleMode, openingIdleStart, playbackDuration, progressAnimation, timeline]);

  useEffect(() => {
    if (idleMode === "persistent") return;
    currentTimeRef.current = idleMode === "bridge"
      ? Math.max(currentTime, openingIdleStart)
      : currentTime;
  }, [currentTime, idleMode, openingIdleStart, timeline]);

  useEffect(() => {
    const duration = playbackDuration;
    const time = idleMode === "persistent"
      ? Math.min(duration, Math.max(openingIdleStart, currentTimeRef.current))
      : Math.max(0, Math.min(duration, currentTimeRef.current));
    if (idleMode !== "persistent") currentTimeRef.current = time;
    onProgressRef.current({ time, duration, animation: progressAnimation });
  }, [idleMode, openingIdleStart, playbackDuration, progressAnimation, timeline]);

  useEffect(() => {
    setInteractionOverlay({ canvasWidth: 0, canvasHeight: 0, points: [] });
  }, [directoriesKey, interactionMode, showInteractionPoints, timeline.sequenceId]);

  useEffect(() => {
    audioStartedRef.current = {};
    audioPreviousTimeRef.current = {};
  }, [audioKey, timeline.sequenceId]);

  useEffect(() => {
    if (!compositionReady || !playing) Object.values(audioElementsRef.current).forEach((audio) => audio?.pause());
    if (!compositionReady) return;
    for (const clip of timeline.audio) {
      const audio = audioElementsRef.current[clip.id];
      if (!audio) continue;
      audio.volume = clip.volume;
      audio.playbackRate = speed;
      const active = idleMode === "none" && clip.enabled && effectiveCurrentTime >= clip.start && effectiveCurrentTime <= clip.end;
      const decision = timelineAudioPlaybackDecision({
        active,
        playing,
        currentTime: effectiveCurrentTime,
        previousTime: audioPreviousTimeRef.current[clip.id],
        started: audioStartedRef.current[clip.id] === true,
        ended: audio.ended,
      });
      audioPreviousTimeRef.current[clip.id] = effectiveCurrentTime;
      audioStartedRef.current[clip.id] = decision.started;
      if (!active) {
        audio.pause();
        continue;
      }
      const local = Math.max(0, effectiveCurrentTime - clip.start);
      if (decision.seek || Math.abs(audio.currentTime - local) > 0.08) audio.currentTime = local;
      if (decision.play) void audio.play().catch(() => undefined);
      else audio.pause();
    }
  }, [compositionReady, effectiveCurrentTime, idleMode, playing, speed, timeline.audio]);

  useEffect(() => {
    if (!playing || !compositionReady) return;
    let frame = 0;
    let previous = 0;
    finishedRef.current = false;
    const tick = (now: number) => {
      if (!previous) previous = now;
      const elapsed = Math.max(0, (now - previous) / 1000) * speed;
      previous = now;
      const duration = playbackDuration;
      let next = currentTimeRef.current + elapsed;
      if (idleMode === "persistent") {
        // Persistent idle is a continuation of the opening clock, not a loop
        // back to time zero. Let the authored idle animation and background
        // clocks keep advancing past the opening's one-shot endpoint.
        currentTimeRef.current = next;
        onProgressRef.current({ time: next, duration, animation: characterMeta?.idleAnimation ?? progressAnimation });
        frame = requestAnimationFrame(tick);
        return;
      }
      if (next >= duration) {
        if (timeline.loop && idleMode === "none") next %= duration;
        else {
          next = duration;
          const finish = !finishedRef.current;
          finishedRef.current = true;
          currentTimeRef.current = next;
          onProgressRef.current({ time: next, duration, animation: progressAnimation });
          if (finish) onFinishedRef.current();
          return;
        }
      }
      currentTimeRef.current = next;
      onProgressRef.current({ time: next, duration, animation: progressAnimation });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [compositionReady, idleMode, playbackDuration, playing, progressAnimation, speed, timeline]);

  useImperativeHandle(ref, () => ({
    resetCamera: () => setResetCameraSignal((value) => value + 1),
    toggleFullscreen: async () => {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (stageRef.current?.requestFullscreen) await stageRef.current.requestFullscreen();
    },
    restartPlayback: () => {
      if (interactionMode === "interaction") talkRendererRef.current?.restartPlayback();
      const restartTime = idleMode !== "none" && timeline.sequenceId === "opening" ? openingIdleStart : 0;
      currentTimeRef.current = restartTime;
      onProgressRef.current({ time: restartTime, duration: playbackDuration, animation: progressAnimation });
    },
    seek: (time) => {
      const next = idleMode !== "none" && timeline.sequenceId === "opening"
        ? Math.max(openingIdleStart, Math.min(playbackDuration, time))
        : Math.max(0, Math.min(playbackDuration, time));
      currentTimeRef.current = next;
      onProgressRef.current({ time: next, duration: playbackDuration, animation: progressAnimation });
    },
    triggerTalk: (animation) => talkRendererRef.current?.triggerTalk(animation),
    setTalkAudioPending: (pending) => talkRendererRef.current?.setTalkAudioPending(pending),
    startIntroAudio: () => talkRendererRef.current?.startIntroAudio(),
  }), [idleMode, interactionMode, layers, openingIdleStart, playbackDuration, progressAnimation, referenceLayerId, timeline]);

  const activeSubtitleTexts = idleMode === "none" ? timelineActiveSubtitleTexts(timeline, effectiveCurrentTime) : [];
  const interactionLayer = layers.find((layer) => layer.id === referenceLayerId);
  const interactionOverlayStyle: CSSProperties = interactionLayer
    ? {
      position: "absolute",
      inset: 0,
      zIndex: 2,
      transform: `translate(${interactionLayer.x}px, ${interactionLayer.y}px) scale(${interactionLayer.scale})`,
      transformOrigin: "center center",
      pointerEvents: "none",
    }
    : {};
  const interactionColors = { pat: "#ff668f", pinch: "#28c7ed", touch: "#ffc857" } as const;
  return <div ref={stageRef} className={`spine-stage spine-stage-composition${interactionMode === "interaction" ? " spine-stage-interaction" : ""}`}>
     {layers.map((layer) => <CompositionLayer key={layer.id} layer={layer} files={files[layer.directory] ?? null} interactionEnabled={interactionMode === "interaction" && layer.id === referenceLayerId} interactionProject={layer.id === referenceLayerId ? interactionProject : null} showInteractionPoints={showInteractionPoints} currentTime={effectiveCurrentTime} mainAnimation={mainAnimationState?.animation} mainAnimationTime={mainAnimationState?.time} mainAnimationLoop={mainAnimationState?.loop} sequenceId={timeline.sequenceId} openingMode={timeline.openingMode} idleMode={idleMode} sharedCameraPose={sharedCameraPose} referenceCamera={layer.id === referenceLayerId} resetCameraSignal={resetCameraSignal} effectsStrength={effectsStrength} onMeta={(id, value) => { setMetas((current) => current[id] === value ? current : { ...current, [id]: value }); if (id === referenceLayerId) onMeta(value); }} onAnimationDuration={(id, animation, duration) => setAnimationDurations((current) => current[`${id}:${animation}`] === duration ? current : { ...current, [`${id}:${animation}`]: duration })} onInteractionPoints={(id, value) => { if (id === referenceLayerId) setInteractionOverlay(value); }} onRenderer={(id, value) => { if (id === referenceLayerId) talkRendererRef.current = value; }} onCameraPose={setSharedCameraPose} onTalk={onTalk} onTalkClip={onTalkClip} onIntro={onIntro} onIntroClip={onIntroClip} onError={(value) => onError(value ? new Error(value) : null)} />)}
    {showInteractionPoints && interactionOverlay.points.length > 0 && interactionOverlay.canvasWidth > 0 && interactionOverlay.canvasHeight > 0 && <svg className="spine-interaction-overlay" style={interactionOverlayStyle} viewBox={`0 0 ${interactionOverlay.canvasWidth} ${interactionOverlay.canvasHeight}`} preserveAspectRatio="none" aria-hidden="true">
      {interactionOverlay.points.map((point, index) => {
        const color = interactionColors[point.kind];
        const matrix = `matrix(${point.axisXEndX - point.centerX} ${point.axisXEndY - point.centerY} ${point.axisYEndX - point.centerX} ${point.axisYEndY - point.centerY} ${point.centerX} ${point.centerY})`;
        return <g key={`${point.kind}-${index}`} className={`spine-interaction-point spine-interaction-point-${point.kind}`}>
          {point.shape === "ellipse" ? <ellipse transform={matrix} cx="0" cy="0" rx="1" ry="1" fill={color} fillOpacity=".14" stroke={color} strokeWidth="3" vectorEffect="non-scaling-stroke" /> : <rect transform={matrix} x="-1" y="-1" width="2" height="2" fill={color} fillOpacity=".14" stroke={color} strokeWidth="3" vectorEffect="non-scaling-stroke" />}
          <circle cx={point.centerX} cy={point.centerY} r="7" fill={color} fillOpacity=".9" stroke="#fff" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          <text x={point.centerX + 11} y={point.centerY - 10} fill={color} stroke="#10202d" strokeWidth="4" paintOrder="stroke" fontSize="18" fontWeight="700">{point.kind}</text>
        </g>;
      })}
    </svg>}
    {activeSubtitleTexts.length > 0 && <div className="spine-dialogue" aria-live="polite">{activeSubtitleTexts.map((text, index) => <div key={`${index}-${text}`}>{text}</div>)}</div>}
    {timeline.audio.map((clip) => <audio key={clip.id} ref={(element) => { audioElementsRef.current[clip.id] = element; }} src={audioUrls[clip.id]} preload="auto" />)}
  </div>;
});
