import { useEffect, useRef, useState, type CSSProperties } from "react";
import { SpineRenderer, type SpineCameraPose, type SpineFiles, type SpineInteractionOverlay, type SpineMeta } from "./spineRuntime";
import type { SpineInteractionProject } from "./spineInteraction";
import { timelineIdleAnimation, timelineTalkIdleStart, timelineAnimationNeedsIdleUnderlay, timelineLayerAnimation, timelineLayerPlaybackEnd, timelineLayerSampleTime, type SpineTimeline, type SpineTimelineLayer } from "./spineTimeline";

export interface SpineTimelineLayerCanvasProps {
  layer: SpineTimelineLayer;
  files: SpineFiles | null;
  currentTime: number;
  mainAnimation?: string;
  mainAnimationTime?: number;
  mainAnimationLoop?: boolean;
  openingMode?: SpineTimeline["openingMode"];
  sequenceId?: string;
  idleMode?: "none" | "persistent" | "bridge";
  interactionEnabled?: boolean;
  interactionProject?: SpineInteractionProject | null;
  showInteractionPoints?: boolean;
  effectsStrength?: number;
  resetCameraSignal?: number;
  sharedCameraPose: SpineCameraPose | null;
  referenceCamera: boolean;
  onMeta: (layerId: string, meta: SpineMeta | null) => void;
  onCameraPose: (pose: SpineCameraPose) => void;
  onAnimationDuration: (layerId: string, animation: string, duration: number) => void;
  onMarkers?: (markers: number[]) => void;
  onInteractionPoints?: (layerId: string, overlay: SpineInteractionOverlay) => void;
  onRenderer?: (layerId: string, renderer: SpineRenderer | null) => void;
  onTalk?: (index: number, animation: string, eventCount: number) => boolean;
  onTalkClip?: (index: number, clipIndex: number) => void;
  onIntro?: (animation: string, eventCount: number) => boolean;
  onIntroClip?: (clipIndex: number) => void;
  onError: (value: string | null) => void;
}

/**
 * The single viewer/editor implementation of a timeline Spine layer.
 *
 * Keep renderer lifecycle, deterministic sampling, talk tails, idle phases,
 * interaction preservation, and visibility in this component. The two UIs
 * should provide state and callbacks, not fork playback rules.
 */
export function SpineTimelineLayerCanvas({ layer, files, currentTime, mainAnimation, mainAnimationTime, mainAnimationLoop, openingMode = "direct", sequenceId = "legacy", idleMode = "none", interactionEnabled = false, interactionProject = null, showInteractionPoints = false, effectsStrength, resetCameraSignal = 0, sharedCameraPose, referenceCamera, onMeta, onCameraPose, onAnimationDuration, onMarkers, onInteractionPoints, onRenderer, onTalk, onTalkClip, onIntro, onIntroClip, onError }: SpineTimelineLayerCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<SpineRenderer | null>(null);
  const [meta, setMeta] = useState<SpineMeta | null>(null);
  const onMetaRef = useRef(onMeta);
  const onCameraPoseRef = useRef(onCameraPose);
  const onAnimationDurationRef = useRef(onAnimationDuration);
  const onMarkersRef = useRef(onMarkers);
  const onInteractionPointsRef = useRef(onInteractionPoints);
  const onRendererRef = useRef(onRenderer);
  const onTalkRef = useRef(onTalk);
  const onTalkClipRef = useRef(onTalkClip);
  const onIntroRef = useRef(onIntro);
  const onIntroClipRef = useRef(onIntroClip);
  const onErrorRef = useRef(onError);
  onMetaRef.current = onMeta;
  onCameraPoseRef.current = onCameraPose;
  onAnimationDurationRef.current = onAnimationDuration;
  onMarkersRef.current = onMarkers;
  onInteractionPointsRef.current = onInteractionPoints;
  onRendererRef.current = onRenderer;
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
          if (!value) return;
          for (const animationName of [value.introAnimation, value.idleAnimation]) {
            if (!animationName) continue;
            const duration = renderer.getEditorAnimationInfo(animationName).duration;
            if (duration > 0) onAnimationDurationRef.current(layer.id, animationName, duration);
          }
          renderer.setCameraMode("fit");
          if (referenceCamera) requestAnimationFrame(() => {
            const pose = renderer.getCameraPose();
            if (pose) onCameraPoseRef.current(pose);
          });
        },
        onProgress: () => {},
        onLoading: () => {},
        onError: (value) => onErrorRef.current(value?.message ?? null),
        onInteractionPoints: (value) => onInteractionPointsRef.current?.(layer.id, value),
        onTalk: (index, animation, eventCount) => onTalkRef.current?.(index, animation, eventCount) ?? false,
        onTalkClip: (index, clipIndex) => onTalkClipRef.current?.(index, clipIndex),
        onIntro: (animation, eventCount) => onIntroRef.current?.(animation, eventCount) ?? false,
        onIntroClip: (clipIndex) => onIntroClipRef.current?.(clipIndex),
      });
    } catch (value) {
      onErrorRef.current(value instanceof Error ? value.message : String(value));
      return;
    }
    renderer.setPlaying(false);
    renderer.setLoop(false);
    if (effectsStrength !== undefined) renderer.setEffectsStrength(effectsStrength);
    rendererRef.current = renderer;
    onRendererRef.current?.(layer.id, renderer);
    return () => {
      onRendererRef.current?.(layer.id, null);
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
    if (effectsStrength !== undefined) rendererRef.current?.setEffectsStrength(effectsStrength);
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
  const time = idle
    ? idleTail && idleMode === "none" ? currentTime - idleTailStart : currentTime
    : followMainClock
      ? mainAnimationTime!
      : timelineLayerSampleTime(layer, currentTime, sequenceId, openingMode, introDuration, animationDuration);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !meta || !animation || !meta.animations.some((name) => name === animation)) return;
    renderer.setAnimation(animation, true);
  }, [animation, meta]);

  useEffect(() => {
    if (!meta || !animation) return;
    const renderer = rendererRef.current;
    renderer?.sampleEditorAnimation(animation, idle ? "" : layer.faceAnimation ?? "", time, effectiveLoop, timelineAnimationNeedsIdleUnderlay(animation), interactionEnabled);
    if (referenceCamera) onMarkersRef.current?.(renderer?.getEditorAnimationInfo(animation).markers ?? []);
  }, [animation, effectiveLoop, followMainClock, idle, interactionEnabled, layer.faceAnimation, mainAnimationLoop, mainAnimationTime, meta, openingMode, referenceCamera, sequenceId, talkCharacter, time]);

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
  return <canvas ref={canvasRef} className="spine-timeline-layer-canvas" style={style} data-animation={animation} data-sample-time={time} aria-label={`${layer.name} Spine layer`} />;
}
