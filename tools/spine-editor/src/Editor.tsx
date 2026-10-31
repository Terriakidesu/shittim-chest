import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  SpineRenderer,
  type SpineEditorFrame,
  type SpineFiles,
  type SpineLoadProgress,
  type SpineMeta,
  type SpineProgress,
} from "../../../src/client/spine/spineRuntime";
import {
  blankInteraction,
  blankRegion,
  cloneProject,
  createProject,
  DEFAULT_EDITOR_VIEW_SETTINGS,
  EDITOR_VIEW_SETTINGS_KEY,
  normalizeProject,
  normalizeViewSettings,
  projectStorageKey,
  repairPinchRegions,
  validateProject,
  type EditorInteraction,
  type EditorProject,
  type EditorRegion,
  type EditorViewSettings,
} from "./editorModel";
import "./editor.css";
import { InteractionPreview, type InteractionPreviewDebug } from "./preview";
import { hitRegion, inversePoint, regionMatrix, screenToWorld } from "./geometry";
import { findInteractionProfile } from "../../../src/client/spine/spineInteraction";
import { detectHeadRegion, repairPatRegions, type HeadRegion } from "./headRegion";
import { TimelineWorkspace } from "./TimelineWorkspace";
import { LEGACY_PROJECT_STORAGE_PREFIX } from "./editorModel";
import { chooseDesktopProject, chooseDesktopSource, chooseDesktopSourceAt, type DesktopAssetSource } from "./desktopSource";
import { normalizeRecentFiles, RECENT_FILES_KEY, rememberRecentFile, removeRecentFile, type RecentFile, type RecentFileKind } from "./recentFiles";
import { AssetPickerModal } from "./AssetPickerModal";
import { editorProjectPath } from "./editorStorage";
import { pendingProjectForDirectory, readSavedEditorProject } from "./editorProject";

function displayName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function nativePath(root: string, relativePath: string): string {
  const separator = root.includes("\\") ? "\\" : "/";
  return `${root.replace(/[\\/]+$/, "")}${separator}${relativePath.replaceAll("/", separator)}`;
}

function readStoredViewSettings(): EditorViewSettings {
  try {
    const stored = localStorage.getItem(EDITOR_VIEW_SETTINGS_KEY);
    return (stored ? normalizeViewSettings(JSON.parse(stored) as unknown) : null) ?? DEFAULT_EDITOR_VIEW_SETTINGS;
  } catch {
    return DEFAULT_EDITOR_VIEW_SETTINGS;
  }
}

function readRecentFiles(): RecentFile[] {
  try {
    const stored = localStorage.getItem(RECENT_FILES_KEY);
    return normalizeRecentFiles(stored ? JSON.parse(stored) as unknown : null);
  } catch {
    return [];
  }
}

function recentKindLabel(kind: RecentFileKind): string {
  return kind === "folder" ? "ASSET ROOT" : kind === "project" ? "PROJECT" : kind === "subtitle" ? "SUBTITLE" : "AUDIO";
}

interface BoneOverlayProps {
  frame: SpineEditorFrame | null;
  project: EditorProject | null;
  viewSettings: EditorViewSettings;
  motionLimits: MotionLimitOverlay | null;
  onSelectBone: (path: string) => void;
  onSelectRegion: (interactionId: string, regionId: string) => void;
  onBeginRegionDrag: () => void;
  onDragRegion: (interactionId: string, regionId: string, x: number, y: number) => void;
  tool: "select" | "pan" | "draw";
  onChangeRegion: (interactionId: string, regionId: string, patch: Partial<EditorRegion>) => void;
}

interface MotionLimitOverlay {
  targetBonePath: string | null;
  limitX: number;
  limitY: number;
  allowX: boolean;
  allowY: boolean;
  rotationEnabled: boolean;
  rotationMin: number;
  rotationMax: number;
}

interface RegionGeometry {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rotation: number;
}

interface RegionAnchor {
  screenX: number;
  screenY: number;
  screenLocalXEndX: number;
  screenLocalXEndY: number;
  screenLocalYEndX: number;
  screenLocalYEndY: number;
}

function regionAnchor(frame: SpineEditorFrame, region: EditorRegion): RegionAnchor {
  const bone = frame.bones.find((item) => item.path === region.anchorBone);
  if (bone) return bone;
  return {
    screenX: frame.screenOriginX,
    screenY: frame.screenOriginY,
    screenLocalXEndX: frame.screenUnitXEndX,
    screenLocalXEndY: frame.screenUnitXEndY,
    screenLocalYEndX: frame.screenUnitYEndX,
    screenLocalYEndY: frame.screenUnitYEndY,
  };
}

function regionGeometry(frame: SpineEditorFrame, region: EditorRegion): RegionGeometry {
  const anchor = regionAnchor(frame, region);
  const xAxis = { x: anchor.screenLocalXEndX - anchor.screenX, y: anchor.screenLocalXEndY - anchor.screenY };
  const yAxis = { x: anchor.screenLocalYEndX - anchor.screenX, y: anchor.screenLocalYEndY - anchor.screenY };
  return {
    cx: anchor.screenX + xAxis.x * region.offsetX + yAxis.x * region.offsetY,
    cy: anchor.screenY + xAxis.y * region.offsetX + yAxis.y * region.offsetY,
    rx: Math.max(3, Math.hypot(xAxis.x, xAxis.y) * region.radiusX),
    ry: Math.max(3, Math.hypot(yAxis.x, yAxis.y) * region.radiusY),
    rotation: Math.atan2(xAxis.y, xAxis.x) * 180 / Math.PI + region.rotation,
  };
}

function motionLimitGeometry(frame: SpineEditorFrame, overlay: MotionLimitOverlay) {
  const target = frame.bones.find((bone) => bone.path === overlay.targetBonePath);
  if (!target) return null;
  const parent = frame.bones.find((bone) => bone.path === target.parentPath);
  const xAxis = parent
    ? { x: parent.screenLocalXEndX - parent.screenX, y: parent.screenLocalXEndY - parent.screenY }
    : { x: frame.screenUnitXEndX - frame.screenOriginX, y: frame.screenUnitXEndY - frame.screenOriginY };
  const yAxis = parent
    ? { x: parent.screenLocalYEndX - parent.screenX, y: parent.screenLocalYEndY - parent.screenY }
    : { x: frame.screenUnitYEndX - frame.screenOriginX, y: frame.screenUnitYEndY - frame.screenOriginY };
  return {
    centerX: target.screenX,
    centerY: target.screenY,
    radiusX: Math.max(8, Math.hypot(xAxis.x, xAxis.y) * Math.max(1, overlay.limitX)),
    radiusY: Math.max(8, Math.hypot(yAxis.x, yAxis.y) * Math.max(1, overlay.limitY)),
    rotation: Math.atan2(xAxis.y, xAxis.x) * 180 / Math.PI,
    boneEndX: target.screenEndX,
    boneEndY: target.screenEndY,
    boneRotation: Math.atan2(target.screenEndY - target.screenY, target.screenEndX - target.screenX) * 180 / Math.PI,
    rotationRadius: Math.max(18, Math.min(48, Math.max(Math.hypot(xAxis.x, xAxis.y) * Math.max(1, overlay.limitX), Math.hypot(yAxis.x, yAxis.y) * Math.max(1, overlay.limitY)) * 0.35)),
  };
}

function arcPath(cx: number, cy: number, radius: number, startDegrees: number, endDegrees: number): string {
  const point = (degrees: number) => {
    const radians = degrees * Math.PI / 180;
    return { x: cx + Math.cos(radians) * radius, y: cy + Math.sin(radians) * radius };
  };
  const start = point(startDegrees);
  const end = point(endDegrees);
  const largeArc = Math.abs(endDegrees - startDegrees) > 180 ? 1 : 0;
  const sweep = endDegrees >= startDegrees ? 1 : 0;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} ${sweep} ${end.x} ${end.y}`;
}

function BoneOverlay({ frame, project, viewSettings, motionLimits, tool, onSelectBone, onSelectRegion, onBeginRegionDrag, onDragRegion, onChangeRegion }: BoneOverlayProps) {
  const drag = useRef<{ interactionId: string; regionId: string; startX: number; startY: number; offsetX: number; offsetY: number; frame: SpineEditorFrame } | null>(null);
  const handleDrag = useRef<{ interactionId: string; region: EditorRegion; frame: SpineEditorFrame; kind: "resize" | "rotate" } | null>(null);
  if (!frame || !project) return null;
  const bones = frame.bones.filter((bone) => viewSettings.showInactiveBones || bone.active);
  const selectedBone = project.selectedBonePath;
  const regions = project.interactions.flatMap((interaction) => interaction.regions.map((region) => ({ interaction, region })));
  const motion = motionLimits ? motionLimitGeometry(frame, motionLimits) : null;

  const move = (event: ReactPointerEvent<SVGSVGElement>) => {
    const handle = handleDrag.current;
    if (handle) {
      const rect = event.currentTarget.getBoundingClientRect();
      const x = (event.clientX - rect.left) * frame.canvasWidth / rect.width;
      const y = (event.clientY - rect.top) * frame.canvasHeight / rect.height;
      const point = inversePoint(regionMatrix(handle.frame, handle.region), x, y);
      if (!point) return;
      onChangeRegion(handle.interactionId, handle.region.id, handle.kind === "resize"
        ? { radiusX: Math.max(1, Math.abs(point.x)), radiusY: Math.max(1, Math.abs(point.y)) }
        : { rotation: Math.round(handle.region.rotation + Math.atan2(point.y, point.x) * 180 / Math.PI - 90) });
      return;
    }
    const current = drag.current;
    if (!current) return;
    const region = project.interactions.flatMap((item) => item.regions).find((item) => item.id === current.regionId);
    if (!region) return;
    const target = regionAnchor(current.frame, region);
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = (event.clientX - current.startX) * frame.canvasWidth / rect.width;
    const dy = (event.clientY - current.startY) * frame.canvasHeight / rect.height;
    const ax = target.screenLocalXEndX - target.screenX;
    const ay = target.screenLocalXEndY - target.screenY;
    const bx = target.screenLocalYEndX - target.screenX;
    const by = target.screenLocalYEndY - target.screenY;
    const determinant = ax * by - bx * ay;
    if (Math.abs(determinant) < 0.0001) return;
    const localX = current.offsetX + (dx * by - bx * dy) / determinant;
    const localY = current.offsetY + (ax * dy - dx * ay) / determinant;
    onDragRegion(current.interactionId, current.regionId, localX, localY);
  };

  return (
    <svg
      className={`editor-overlay tool-${tool}`}
      viewBox={`0 0 ${frame.canvasWidth} ${frame.canvasHeight}`}
      preserveAspectRatio="none"
      onPointerMove={move}
      onPointerUp={() => { drag.current = null; handleDrag.current = null; }}
      onPointerCancel={() => { drag.current = null; handleDrag.current = null; }}
      aria-label="Spine editing overlay"
    >
      <defs>
        <marker id="editor-motion-arrow" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto" markerUnits="strokeWidth">
          <path d="M 0 0 L 7 3.5 L 0 7 z" fill="var(--editor-pink)" />
        </marker>
      </defs>
      {motion && <g className="editor-motion-gizmo" aria-label="Local movement and rotation limits">
        <g className="editor-motion-translation" transform={`rotate(${motion.rotation} ${motion.centerX} ${motion.centerY})`}>
          <ellipse cx={motion.centerX} cy={motion.centerY} rx={motion.radiusX} ry={motion.radiusY} />
          <line className={motionLimits?.allowX ? "is-enabled" : "is-locked"} x1={motion.centerX - motion.radiusX} y1={motion.centerY} x2={motion.centerX + motion.radiusX} y2={motion.centerY} />
          <line className={motionLimits?.allowY ? "is-enabled" : "is-locked"} x1={motion.centerX} y1={motion.centerY - motion.radiusY} x2={motion.centerX} y2={motion.centerY + motion.radiusY} />
          <circle className={motionLimits?.allowX ? "is-enabled" : "is-locked"} cx={motion.centerX + motion.radiusX} cy={motion.centerY} r={4} />
          <circle className={motionLimits?.allowY ? "is-enabled" : "is-locked"} cx={motion.centerX} cy={motion.centerY - motion.radiusY} r={4} />
          <text className="editor-motion-label x" x={motion.centerX + motion.radiusX + 7} y={motion.centerY + 4}>X</text>
          <text className="editor-motion-label y" x={motion.centerX + 5} y={motion.centerY - motion.radiusY - 6}>Y</text>
        </g>
        <line className="editor-motion-bone" x1={motion.centerX} y1={motion.centerY} x2={motion.boneEndX} y2={motion.boneEndY} />
        {motionLimits?.rotationEnabled && <path className="editor-motion-rotation" d={arcPath(motion.centerX, motion.centerY, motion.rotationRadius, motion.boneRotation - motionLimits.rotationMax, motion.boneRotation - motionLimits.rotationMin)} />}
        <circle className={motionLimits?.rotationEnabled ? "editor-motion-rotation-handle is-enabled" : "editor-motion-rotation-handle is-locked"} cx={motion.centerX} cy={motion.centerY} r={6} />
        <text className="editor-motion-label rotation" x={motion.centerX + motion.rotationRadius + 5} y={motion.centerY - 5}>R</text>
      </g>}
      {viewSettings.showBones && bones.map((bone) => (
        <g key={bone.path} className={`editor-bone${bone.path === selectedBone ? " is-selected" : ""}`}>
          <line x1={bone.screenX} y1={bone.screenY} x2={bone.screenEndX} y2={bone.screenEndY} onClick={() => onSelectBone(bone.path)} />
          <circle cx={bone.screenX} cy={bone.screenY} r={bone.path === selectedBone ? 6 : 3} onClick={() => onSelectBone(bone.path)} />
          {viewSettings.showBoneNames && <text x={bone.screenX + 7} y={bone.screenY - 5}>{bone.name}</text>}
        </g>
      ))}
      {viewSettings.showConstraints && frame.constraints.map((constraint) => {
        const target = bones.find((bone) => bone.name === constraint.target);
        if (!target) return null;
        return constraint.bones.map((boneName) => {
          const bone = bones.find((item) => item.name === boneName);
          if (!bone) return null;
          return <line key={`${constraint.name}-${bone.path}`} className="editor-constraint" x1={target.screenX} y1={target.screenY} x2={bone.screenX} y2={bone.screenY} />;
        });
      })}
      {regions.filter(({ region }) => region.enabled).map(({ interaction, region }) => {
        const geometry = regionGeometry(frame, region);
        const matrix = regionMatrix(frame, region);
        const transform = `matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`;
        const selected = project.selectedInteractionId === interaction.id && project.selectedRegionId === region.id;
        const startDrag = (event: ReactPointerEvent<SVGElement>) => {
          event.stopPropagation();
          (event.currentTarget as SVGElement & { setPointerCapture: (pointerId: number) => void }).setPointerCapture(event.pointerId);
          onSelectRegion(interaction.id, region.id);
          onBeginRegionDrag();
          drag.current = { interactionId: interaction.id, regionId: region.id, startX: event.clientX, startY: event.clientY, offsetX: region.offsetX, offsetY: region.offsetY, frame };
        };
        const shape = region.shape === "rectangle"
          ? <rect
              x={-region.radiusX}
              y={-region.radiusY}
              width={region.radiusX * 2}
              height={region.radiusY * 2}
              transform={transform}
              vectorEffect="non-scaling-stroke"
              onPointerDown={startDrag}
              onClick={(event) => { event.stopPropagation(); onSelectRegion(interaction.id, region.id); }}
            />
          : <ellipse
              cx={0}
              cy={0}
              rx={region.radiusX}
              ry={region.radiusY}
              transform={transform}
              vectorEffect="non-scaling-stroke"
              onPointerDown={startDrag}
              onClick={(event) => { event.stopPropagation(); onSelectRegion(interaction.id, region.id); }}
            />;
        return (
          <g key={`${interaction.id}-${region.id}`} className={`editor-region${selected ? " is-selected" : ""}`} style={{ color: interaction.color }}>
            {shape}
            {selected && <text x={geometry.cx} y={geometry.cy}>{region.name}</text>}
            {selected && tool === "select" && (["resize", "rotate"] as const).map((kind) => {
              const localX = kind === "resize" ? region.radiusX : 0;
              const localY = region.radiusY + (kind === "rotate" ? 35 : 0);
              return <circle key={kind} className={`editor-handle ${kind}`} cx={matrix.e + matrix.a * localX + matrix.c * localY} cy={matrix.f + matrix.b * localX + matrix.d * localY} r={7} onPointerDown={(event) => {
                event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); onBeginRegionDrag();
                handleDrag.current = { interactionId: interaction.id, region: { ...region }, frame, kind };
              }}><title>{kind === "resize" ? "Drag to resize" : "Drag to rotate"}</title></circle>;
            })}
          </g>
        );
      })}
    </svg>
  );
}

export function Editor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<SpineRenderer | null>(null);
  const metaRef = useRef<SpineMeta | null>(null);
  const directoryRef = useRef("");
  const projectRef = useRef<EditorProject | null>(null);
  const initializedAssetRef = useRef("");
  const previewRef = useRef(new InteractionPreview());
  const stageRef = useRef<HTMLDivElement>(null);
  const testPointerRef = useRef<number | null>(null);
  const headRegionRef = useRef<HeadRegion | null>(null);
  const headDetectionDone = useRef(false);
  const drawRef = useRef<{ x: number; y: number } | null>(null);
  const [drawBox, setDrawBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const panelDragRef = useRef<{ side: "left" | "right"; x: number; width: number } | null>(null);
  const [leftWidth, setLeftWidth] = useState(220);
  const [rightWidth, setRightWidth] = useState(320);
  const [testing, setTesting] = useState(false);
  const [tool, setTool] = useState<"select" | "pan" | "draw">("select");
  const [inspectorTab, setInspectorTab] = useState<"region" | "animation" | "movement">("region");
  const [showTestRegions, setShowTestRegions] = useState(true);
  const [previewDebug, setPreviewDebug] = useState<InteractionPreviewDebug>(() => previewRef.current.debug);
  const [leftHidden, setLeftHidden] = useState(false);
  const [rightHidden, setRightHidden] = useState(false);
  const [help, setHelp] = useState(false);
  const [workspace, setWorkspace] = useState<"interaction" | "timeline">("interaction");
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [previewStatus, setPreviewStatus] = useState("Idle");
  const [source, setSource] = useState<DesktopAssetSource | null>(null);
  const [directories, setDirectories] = useState<string[]>([]);
  const [directory, setDirectory] = useState("");
  const [files, setFiles] = useState<SpineFiles | null>(null);
  const [meta, setMeta] = useState<SpineMeta | null>(null);
  const [frame, setFrame] = useState<SpineEditorFrame | null>(null);
  const [progress, setProgress] = useState<SpineProgress>({ time: 0, duration: 0, animation: null });
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [selectedAnimation, setSelectedAnimation] = useState("");
  const [project, setProject] = useState<EditorProject | null>(null);
  const timelineSaveRef = useRef<((getProject: () => EditorProject | null) => Promise<string[]>) | null>(null);
  const sourceRef = useRef<DesktopAssetSource | null>(source);
  const projectSaveQueueRef = useRef(Promise.resolve());
  const pendingProjectRef = useRef<EditorProject | null>(null);
  const [viewSettings, setViewSettings] = useState<EditorViewSettings>(() => readStoredViewSettings());
  const [undo, setUndo] = useState<EditorProject[]>([]);
  const [redo, setRedo] = useState<EditorProject[]>([]);
  const [boneSearch, setBoneSearch] = useState("");
  const [targetBoneSearch, setTargetBoneSearch] = useState("");
  const [collapsedBones, setCollapsedBones] = useState<Set<string>>(() => new Set());
  const [interactionSearch, setInteractionSearch] = useState("");
  const [status, setStatus] = useState("Open a Spine asset folder to begin.");
  const [error, setError] = useState<string | null>(null);
  const [assetLoading, setAssetLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState<SpineLoadProgress>({ loaded: 0, total: 1, label: "Preparing asset set" });
  const [saveState, setSaveState] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>(() => readRecentFiles());
  const [pendingSubtitlePath, setPendingSubtitlePath] = useState<string | null>(null);
  const [pendingAudioPaths, setPendingAudioPaths] = useState<string[] | null>(null);
  const recentFilesRef = useRef<RecentFile[]>(recentFiles);

  projectRef.current = project;
  directoryRef.current = directory;
  metaRef.current = meta;
  sourceRef.current = source;
  recentFilesRef.current = recentFiles;
  const viewSettingsRef = useRef<EditorViewSettings>(viewSettings);
  viewSettingsRef.current = viewSettings;

  function withCurrentViewSettings(next: EditorProject): EditorProject {
    return { ...next, ...viewSettingsRef.current };
  }

  const callbacksRef = useRef({
    onMeta: (value: SpineMeta | null) => {},
    onFrame: (value: SpineEditorFrame) => {},
  });
  callbacksRef.current.onMeta = (value) => {
    metaRef.current = value;
    setMeta(value);
    if (!value) {
      headRegionRef.current = null;
      headDetectionDone.current = false;
      setFrame(null);
      setProject(null);
      initializedAssetRef.current = "";
      return;
    }
    const initialAnimation = value.idleAnimation ?? value.defaultAnimation;
    setSelectedAnimation(initialAnimation);
    if (initialAnimation) rendererRef.current?.setAnimation(initialAnimation, true);
  };
  callbacksRef.current.onFrame = (value) => {
    setFrame(value);
    const preview = previewRef.current;
    setProgress(preview.phase !== "idle" ? { ...preview.progress, animation: preview.phase } : { time: value.duration > 0 ? value.time % value.duration : 0, duration: value.duration, animation: value.animation });
    const loadedMeta = metaRef.current;
    const key = `${directoryRef.current}:${loadedMeta?.animations.join("|") ?? ""}`;
    if (loadedMeta && key !== initializedAssetRef.current) {
      initializedAssetRef.current = key;
      let restored: EditorProject | null = null;
      try {
         const stored = localStorage.getItem(projectStorageKey(directoryRef.current))
           ?? localStorage.getItem(`${LEGACY_PROJECT_STORAGE_PREFIX}${directoryRef.current}`);
        restored = stored ? normalizeProject(JSON.parse(stored) as unknown, directoryRef.current) : null;
      } catch {
        restored = null;
      }
       const original = restored ?? createProject(directoryRef.current, loadedMeta.animations, value.bones);
        const pending = pendingProjectForDirectory(pendingProjectRef.current, directoryRef.current);
       if (pending) pendingProjectRef.current = null;
       const loadedProject = pending ?? original;
       const repair = repairPatRegions(loadedProject, headRegionRef.current);
      const pinchRepair = repairPinchRegions(repair.project, value.bones);
      const next = withCurrentViewSettings(pinchRepair.project);
      projectRef.current = next;
      setProject(next);
      setUndo(restored && repair.repaired ? [restored] : []);
      setRedo([]);
      setStatus(repair.repaired ? `${restored ? "Restored project; repaired" : "Detected"} ${repair.repaired} head region(s). Custom regions kept.` : repair.unresolved ? "Head detection needs review. Uncertain default patting regions were disabled, not guessed." : restored ? "Restored local project." : "Created detected interaction presets.");
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new SpineRenderer(canvas, {
      onBeforeEditorUpdate: () => previewRef.current.beforeUpdate(),
      onEditorUpdate: (delta, skeleton, state) => {
        if (!headDetectionDone.current) {
          headRegionRef.current = detectHeadRegion(skeleton);
          headDetectionDone.current = true;
        }
        previewRef.current.update(delta, skeleton, state);
        const preview = previewRef.current;
        const debug = preview.debug;
        setPreviewDebug(debug);
        setPreviewStatus(debug.phase === "idle" ? "Idle" : `${debug.phase} · ${debug.interactionName} · ${debug.regionName}`);
      },
      onMeta: (value) => callbacksRef.current.onMeta(value),
      onProgress: () => {},
      onLoading: (value) => {
        setAssetLoading(value);
        if (value) setStatus("Loading Spine asset…");
      },
      onLoadProgress: (value) => setLoadProgress(value),
      onError: (value) => {
        setAssetLoading(false);
        setError(value?.message ?? null);
      },
      onEditorFrame: (value) => callbacksRef.current.onFrame(value),
    });
    rendererRef.current = renderer;
    return () => {
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!source || !directory) return;
    let cancelled = false;
    setTesting(false);
    previewRef.current.reset();
    rendererRef.current?.clear();
    setAssetLoading(true);
    setLoadProgress({ loaded: 0, total: 1, label: "Reading asset files" });
    setFiles(null);
    void source.getSetFiles(directory).then((value) => { if (!cancelled) setFiles(value); }).catch((value) => {
      if (!cancelled) {
        setAssetLoading(false);
        setError(value instanceof Error ? value.message : String(value));
      }
    });
    return () => { cancelled = true; };
  }, [source, directory]);

  useEffect(() => {
    if (!files || !directory) return;
    rendererRef.current?.load(files, directory);
    rendererRef.current?.setCameraMode("fit");
  }, [files]);

  useEffect(() => {
    rendererRef.current?.setPlaying(playing);
  }, [playing]);

  useEffect(() => {
    rendererRef.current?.setSpeed(speed);
  }, [speed]);

  useEffect(() => { resetPreview(); }, [testing]);

  useEffect(() => {
    if (selectedAnimation) rendererRef.current?.setAnimation(selectedAnimation);
  }, [selectedAnimation]);

  useEffect(() => {
    // Directory selection commits before the new asset/project finishes loading.
    // Never autosave the previous student's project under the new student's key.
    if (!project || !directory || project.assetDirectory !== directory) return;
    try { localStorage.setItem(projectStorageKey(directory), JSON.stringify(project)); }
    catch { setError("Recovery storage is unavailable. Save files to keep your changes."); }
  }, [project, directory]);

  useEffect(() => {
    if (!viewSettings) return;
    try { localStorage.setItem(EDITOR_VIEW_SETTINGS_KEY, JSON.stringify(viewSettings)); }
    catch { /* Display preferences are still useful for this session. */ }
  }, [viewSettings]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (saveState !== "dirty") return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [saveState]);

  // Rebound each render so keyboard actions always use current selections/history.
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest("input, select, textarea, [contenteditable=true]")) return;
      const key = event.key.toLowerCase();
      const modifier = event.ctrlKey || event.metaKey;
      if (workspace === "timeline" && key !== "?" && key !== "escape" && !(modifier && ["z", "y"].includes(key))) return;
      if (modifier && key === "z") { event.preventDefault(); event.shiftKey ? redoProject() : undoProject(); }
      else if (modifier && key === "y") { event.preventDefault(); redoProject(); }
      else if (modifier && key === "s") { event.preventDefault(); void saveProject(); }
      else if (modifier && key === "d") { event.preventDefault(); duplicateRegion(); }
      else if (key === "escape") { resetPreview(); setTesting(false); setTool("select"); setHelp(false); }
      else if (key === "t") toggleTest();
      else if (key === "v") { setTesting(false); setTool("select"); }
      else if (key === "h") { setTesting(false); setTool("pan"); }
      else if (key === "r") { setTesting(false); setTool("draw"); }
      else if (key === "f") rendererRef.current?.resetCamera();
      else if (key === "b") updateViewSetting("showBones", !(viewSettingsRef.current ?? DEFAULT_EDITOR_VIEW_SETTINGS).showBones);
      else if (key === " ") { event.preventDefault(); if (!testing) setPlaying((value) => !value); }
      else if (key === "?") setHelp((value) => !value);
      else if ((key === "delete" || key === "backspace") && !testing && projectRef.current?.selectedRegionId) { event.preventDefault(); deleteRegion(); }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });

  useEffect(() => {
    const release = () => { previewRef.current.release(); testPointerRef.current = null; drawRef.current = null; setDrawBox(null); };
    window.addEventListener("blur", release);
    return () => window.removeEventListener("blur", release);
  }, []);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!testing || testPointerRef.current !== event.pointerId || !frame) return;
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect?.width || !rect.height) return;
      const point = { x: (event.clientX - rect.left) * frame.canvasWidth / rect.width, y: (event.clientY - rect.top) * frame.canvasHeight / rect.height };
      const world = screenToWorld(frame, point.x, point.y);
      if (world) previewRef.current.move(world.x, world.y);
    };
    const finish = (event: PointerEvent) => {
      if (testPointerRef.current !== event.pointerId) return;
      testPointerRef.current = null;
      previewRef.current.release();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [frame, testing]);

  function recordRecentFile(item: Omit<RecentFile, "lastOpened"> & { lastOpened?: number }) {
    const next = rememberRecentFile(recentFilesRef.current, item);
    recentFilesRef.current = next;
    setRecentFiles(next);
    try { localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(next)); }
    catch { /* Recent files are a convenience, never a reason to block opening. */ }
  }

  function forgetRecentFile(item: Pick<RecentFile, "kind" | "rootPath" | "path">) {
    const next = removeRecentFile(recentFilesRef.current, item);
    recentFilesRef.current = next;
    setRecentFiles(next);
    try { localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(next)); }
    catch { /* Recent files are a convenience, never a reason to block opening. */ }
  }

  async function confirmOpen(): Promise<boolean> {
    if (saveState !== "dirty") return true;
    if (!window.confirm("This project has unsaved changes. Open another file without saving?")) return false;
    return true;
  }

  async function useSource(next: DesktopAssetSource, preferredDirectory?: string) {
    const found = await next.getDirectories();
    if (found.length === 0) throw new Error("No Spine asset directories were found.");
    if (preferredDirectory && !found.includes(preferredDirectory)) throw new Error(`The project references missing Spine set “${preferredDirectory}”.`);
    const selectedDirectory = preferredDirectory && found.includes(preferredDirectory) ? preferredDirectory : found[0]!;
    const pending = pendingProjectRef.current;
    if (!pending || pending.assetDirectory !== selectedDirectory) {
      pendingProjectRef.current = await readSavedEditorProject(next, selectedDirectory, (message) => setError(message));
    }
    setSource(next);
    setDirectories(found);
    setDirectory(selectedDirectory);
    recordRecentFile({ kind: "folder", path: next.rootPath, rootPath: next.rootPath, label: displayName(next.rootPath), directory: selectedDirectory });
    setError(null);
    setSaveState("idle");
    setSavedAt(null);
  }

  async function openFolder() {
    if (!(await confirmOpen())) return;
    try {
      const next = await chooseDesktopSource();
      if (next) {
        pendingProjectRef.current = null;
        setPendingSubtitlePath(null);
        setPendingAudioPaths(null);
        await useSource(next);
      }
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  }

  async function openProjectFile() {
    if (!(await confirmOpen())) return;
    try {
      const selected = await chooseDesktopProject();
      if (!selected) return;
      const raw = JSON.parse(selected.file.content) as Record<string, unknown>;
      const assetDirectory = typeof raw.assetDirectory === "string" ? raw.assetDirectory : "";
      if (!assetDirectory) throw new Error("This project file does not identify an asset set.");
      const restored = normalizeProject(raw, assetDirectory);
      if (!restored) throw new Error("The selected file is not a compatible Spine editor project.");
      pendingProjectRef.current = restored;
      setPendingSubtitlePath(null);
      setPendingAudioPaths(null);
      recordRecentFile({ kind: "project", path: selected.file.path, rootPath: selected.source.rootPath, label: displayName(selected.file.path), directory: restored.assetDirectory });
      await useSource(selected.source, restored.assetDirectory);
      setWorkspace("interaction");
      setStatus(`Opened project ${displayName(selected.file.path)}.`);
    } catch (value) {
      pendingProjectRef.current = null;
      setError(value instanceof Error ? value.message : String(value));
    }
  }

  async function openRecentFile(item: RecentFile) {
    if (!(await confirmOpen())) return;
    try {
      const next = await chooseDesktopSourceAt(item.rootPath);
      if (!next) return;
      if (item.kind === "project") {
        const content = await next.readText(item.path);
        if (!content) throw new Error(`Recent project file is missing: ${item.path}`);
        const raw = JSON.parse(content) as Record<string, unknown>;
        const assetDirectory = typeof raw.assetDirectory === "string" ? raw.assetDirectory : item.directory ?? "";
        const restored = normalizeProject(raw, assetDirectory);
        if (!restored) throw new Error("The recent file is not a compatible Spine editor project.");
        pendingProjectRef.current = restored;
        setPendingSubtitlePath(null);
        setPendingAudioPaths(null);
        recordRecentFile({ ...item, directory: restored.assetDirectory });
        await useSource(next, restored.assetDirectory);
        setWorkspace("interaction");
        setStatus(`Reopened project ${item.label}.`);
      } else {
        pendingProjectRef.current = null;
        setPendingSubtitlePath(null);
        setPendingAudioPaths(null);
        await useSource(next, item.directory);
        recordRecentFile(item);
        if (item.kind === "subtitle") {
          setPendingSubtitlePath(item.path);
          setPendingAudioPaths(null);
          setWorkspace("timeline");
          setStatus(`Ready to import ${item.label} into the timeline.`);
        } else if (item.kind === "audio") {
          setPendingAudioPaths([item.path]);
          setWorkspace("timeline");
          setStatus(`Loading ${item.label} into the timeline…`);
        } else {
          setPendingAudioPaths(null);
          setStatus(`Reopened ${item.label}. Use Add → Audio files to place it on the timeline.`);
        }
      }
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  }

  async function changeDirectory(next: string) {
    if (!next || next === directory) return;
    if (saveState === "dirty" && !window.confirm("This project has unsaved changes. Switch asset sets without saving?")) return;
    pendingProjectRef.current = source ? await readSavedEditorProject(source, next, (message) => setError(message)) : null;
    setDirectory(next);
    setSaveState("idle");
    setSavedAt(null);
    setError(null);
    setPendingSubtitlePath(null);
    setPendingAudioPaths(null);
    setStatus(`Loading ${displayName(next)}…`);
  }

  function mutate(mutator: (current: EditorProject) => EditorProject) {
    const current = projectRef.current;
    if (!current) return;
    const next = mutator(cloneProject(current));
    setUndo((items) => [...items.slice(-49), current]);
    setRedo([]);
    projectRef.current = next;
    setProject(next);
    setSaveState("dirty");
  }

  function live(mutator: (current: EditorProject) => EditorProject) {
    const current = projectRef.current;
    if (!current) return;
    const next = mutator(cloneProject(current));
    projectRef.current = next;
    setProject(next);
    setSaveState("dirty");
  }

  function beginTimelineEdit() {
    if (!projectRef.current) return;
    setUndo((items) => [...items.slice(-49), projectRef.current!]);
    setRedo([]);
  }

  function updateViewSetting(field: keyof EditorViewSettings, value: boolean) {
    const nextSettings = { ...(viewSettingsRef.current ?? DEFAULT_EDITOR_VIEW_SETTINGS), [field]: value };
    viewSettingsRef.current = nextSettings;
    setViewSettings(nextSettings);
    live((current) => ({ ...current, ...nextSettings }));
  }

  function undoProject() {
    const current = projectRef.current;
    const previous = undo.at(-1);
    if (!current || !previous) return;
    setRedo((items) => [...items.slice(-49), current]);
    setUndo((items) => items.slice(0, -1));
    const next = withCurrentViewSettings(previous);
    projectRef.current = next;
    setProject(next);
    setSaveState("dirty");
  }

  function redoProject() {
    const current = projectRef.current;
    const next = redo.at(-1);
    if (!current || !next) return;
    setUndo((items) => [...items.slice(-49), current]);
    setRedo((items) => items.slice(0, -1));
    const applied = withCurrentViewSettings(next);
    projectRef.current = applied;
    setProject(applied);
    setSaveState("dirty");
  }

  async function saveProject() {
    const save = async () => {
      const current = projectRef.current ?? project;
      const saveSource = sourceRef.current;
      const saveDirectory = directoryRef.current;
      if (!current || !saveSource || current.assetDirectory !== saveDirectory) return;
      setSaveState("saving");
      setError(null);
      try {
        const getCurrentProject = () => projectRef.current ?? current;
        const subtitlePaths = await timelineSaveRef.current?.(getCurrentProject) ?? [];
        const latest = getCurrentProject();
        if (sourceRef.current !== saveSource || directoryRef.current !== saveDirectory || latest.assetDirectory !== saveDirectory) return;
        const projectPath = editorProjectPath(saveDirectory);
        await saveSource.saveText(projectPath, `${JSON.stringify(latest, null, 2)}\n`);
        recordRecentFile({ kind: "project", path: projectPath, rootPath: saveSource.rootPath, label: displayName(projectPath), directory: saveDirectory });
        setSaveState("saved");
        setSavedAt(Date.now());
        const subtitleMessage = subtitlePaths.length > 0
          ? ` · Linked subtitles: ${subtitlePaths.map((path) => nativePath(saveSource.rootPath, path)).join(", ")}`
          : " · No linked subtitle files";
        setStatus(`Saved project: ${nativePath(saveSource.rootPath, projectPath)}${subtitleMessage}`);
      } catch (value) {
        setSaveState("error");
        setError(value instanceof Error ? value.message : String(value));
      }
    };
    const queued = projectSaveQueueRef.current.then(save, save);
    projectSaveQueueRef.current = queued.then(() => undefined, () => undefined);
    return queued;
  }

  const selectedInteraction = project?.interactions.find((item) => item.id === project.selectedInteractionId) ?? null;
  const selectedRegion = selectedInteraction?.regions.find((item) => item.id === project?.selectedRegionId) ?? null;
  const displaySettings = viewSettings;
  const visibleBones = useMemo(() => {
    const query = boneSearch.trim().toLocaleLowerCase();
    const bones = frame?.bones.filter((bone) => displaySettings.showInactiveBones || bone.active) ?? [];
    if (!query) {
      return bones.filter((bone) => !bone.path.split("/").slice(0, -1).some((_, index, parts) => collapsedBones.has(parts.slice(0, index + 1).join("/"))));
    }
    const matches = new Set<string>();
    for (const bone of bones) {
      if (!`${bone.name} ${bone.path}`.toLocaleLowerCase().includes(query)) continue;
      const parts = bone.path.split("/");
      parts.forEach((_, index) => matches.add(parts.slice(0, index + 1).join("/")));
    }
    return bones.filter((bone) => matches.has(bone.path));
  }, [boneSearch, collapsedBones, displaySettings.showInactiveBones, frame]);
  const visibleInteractions = project?.interactions.filter((item) => !interactionSearch.trim() || item.name.toLocaleLowerCase().includes(interactionSearch.trim().toLocaleLowerCase())) ?? [];
  const targetBoneOptions = useMemo(() => {
    const bones = frame?.bones ?? [];
    const query = targetBoneSearch.trim().toLocaleLowerCase();
    if (!query) return selectedInteraction?.followTargetBone ? bones.filter((bone) => bone.path === selectedInteraction.followTargetBone) : [];
    return bones.filter((bone) => `${bone.name} ${bone.path}`.toLocaleLowerCase().includes(query)).slice(0, 80);
  }, [frame, selectedInteraction?.followTargetBone, targetBoneSearch]);
  const validationWarnings = useMemo(() => project && meta && frame ? validateProject(project, meta.animations, frame.bones) : [], [frame, meta, project]);
  const renderedViewSettings = testing ? { ...displaySettings, showBones: false, showConstraints: false } : displaySettings;

  function toggleBone(path: string) {
    setCollapsedBones((value) => {
      const next = new Set(value);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }

  function revealSelectedBone() {
    const path = project?.selectedBonePath;
    if (!path) return;
    const parts = path.split("/");
    setCollapsedBones((value) => {
      const next = new Set(value);
      parts.forEach((_, index) => next.delete(parts.slice(0, index + 1).join("/")));
      return next;
    });
  }

  function updateInteraction(field: keyof EditorInteraction, value: string | number | boolean | null) {
    if (!selectedInteraction) return;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return;
      if (field === "smoothing") value = Math.max(0.1, value);
      else if (field === "rotationMin") value = Math.min(0, Math.max(-180, value));
      else if (field === "rotationMax") value = Math.max(0, Math.min(180, value));
      else value = Math.max(0, value);
    }
    mutate((current) => ({
      ...current,
      interactions: current.interactions.map((item) => item.id === selectedInteraction.id ? { ...item, [field]: value } : item),
    }));
  }

  function updateRegion(field: keyof EditorRegion, value: string | number | boolean | null) {
    if (!selectedInteraction || !selectedRegion) return;
    mutate((current) => ({
      ...current,
      interactions: current.interactions.map((interaction) => interaction.id !== selectedInteraction.id ? interaction : {
        ...interaction,
        regions: interaction.regions.map((region) => region.id === selectedRegion.id ? { ...region, [field]: value, placement: "manual" } : region),
      }),
    }));
  }

  function selectInteraction(id: string) {
    mutate((current) => {
      const item = current.interactions.find((interaction) => interaction.id === id);
      return { ...current, selectedInteractionId: id, selectedRegionId: item?.regions[0]?.id ?? null };
    });
  }

  function addInteraction() {
    if (!project || !frame || !meta) return;
    const item = blankInteraction(meta.animations, frame.bones, project.interactions.length);
    mutate((current) => ({ ...current, interactions: [...current.interactions, item], selectedInteractionId: item.id, selectedRegionId: item.regions[0]?.id ?? null }));
  }

  function deleteInteraction() {
    if (!selectedInteraction) return;
    mutate((current) => {
      const remaining = current.interactions.filter((item) => item.id !== selectedInteraction.id);
      const next = remaining[0];
      return { ...current, interactions: remaining, selectedInteractionId: next?.id ?? null, selectedRegionId: next?.regions[0]?.id ?? null };
    });
  }

  function addRegion() {
    if (!selectedInteraction || !frame || !project) return;
    const anchor = frame.bones.find((bone) => bone.path === project.selectedBonePath) ?? frame.bones[0];
    const item = blankRegion(anchor, selectedInteraction.regions.length);
    mutate((current) => ({
      ...current,
      interactions: current.interactions.map((interaction) => interaction.id === selectedInteraction.id ? { ...interaction, regions: [...interaction.regions, item] } : interaction),
      selectedRegionId: item.id,
    }));
  }

  function deleteRegion() {
    if (!selectedInteraction || !selectedRegion) return;
    mutate((current) => ({
      ...current,
      interactions: current.interactions.map((interaction) => interaction.id === selectedInteraction.id ? { ...interaction, regions: interaction.regions.filter((region) => region.id !== selectedRegion.id) } : interaction),
      selectedRegionId: null,
    }));
  }

  function playAnimation(name: string) {
    if (!name) return;
    rendererRef.current?.setAnimation(name, true);
    setSelectedAnimation(name);
    setPlaying(true);
  }

  function previewPhase(label: string, body: string, face: string, loop: boolean) {
    if (!body && !face) {
      setStatus(`${label} has no animation assigned.`);
      return;
    }
    rendererRef.current?.previewEditorPhase(body, face, loop);
    setPlaying(true);
    setStatus(`Previewing ${label}: ${body || "no body track"}${face ? ` + ${face}` : ""}.`);
  }

  function resetPreview() {
    previewRef.current.reset();
    setPreviewDebug(previewRef.current.debug);
    const idle = metaRef.current?.idleAnimation ?? metaRef.current?.defaultAnimation;
    if (idle) { rendererRef.current?.setAnimation(idle, true); setSelectedAnimation(idle); }
    setPlaying(true);
  }

  function toggleTest() {
    resetPreview();
    setTesting((value) => !value);
  }

  function duplicateRegion() {
    if (!selectedRegion || !selectedInteraction) return;
    const copy = { ...selectedRegion, id: crypto.randomUUID(), name: `${selectedRegion.name} copy`, offsetX: selectedRegion.offsetX + 20, placement: "manual" as const };
    mutate((current) => ({ ...current, selectedRegionId: copy.id, interactions: current.interactions.map((item) => item.id === selectedInteraction.id ? { ...item, regions: [...item.regions, copy] } : item) }));
  }

  function duplicateInteraction() {
    if (!selectedInteraction) return;
    const copy = structuredClone(selectedInteraction);
    copy.id = crypto.randomUUID(); copy.name += " copy";
    copy.regions = copy.regions.map((region) => ({ ...region, id: crypto.randomUUID(), placement: "manual" }));
    mutate((current) => ({ ...current, interactions: [...current.interactions, copy], selectedInteractionId: copy.id, selectedRegionId: copy.regions[0]?.id ?? null }));
  }

  function detectPhases() {
    if (!meta || !selectedInteraction) return;
    const profile = findInteractionProfile(meta.animations);
    const action = [profile.pat, profile.touch, profile.pinch].find((item) => item?.start.main === selectedInteraction.startAnimation);
    if (!action) { setStatus("Choose a detected Pat, Touch, or Pinch start animation first, then detect its phases."); return; }
    mutate((current) => ({ ...current, interactions: current.interactions.map((item) => item.id === selectedInteraction.id ? { ...item, startAnimation: action.start.main, followAnimation: action.follow.main, endAnimation: action.release?.main ?? "", faceStartAnimation: action.start.face ?? "", faceFollowAnimation: action.follow.face ?? "", faceEndAnimation: action.release?.face ?? "" } : item) }));
    setStatus("Detected body and face phases. Regions and movement settings were kept.");
  }

  function stagePoint(event: ReactPointerEvent<HTMLElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!frame || !rect.width || !rect.height) return null;
    return { x: (event.clientX - rect.left) * frame.canvasWidth / rect.width, y: (event.clientY - rect.top) * frame.canvasHeight / rect.height };
  }

  function stagePress(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !frame || !project) return;
    const point = stagePoint(event);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const world = screenToWorld(frame, point.x, point.y);
    if (!world) return;
    if (testing) {
      const hit = hitRegion(frame, project, point.x, point.y);
      if (hit) {
        testPointerRef.current = event.pointerId;
        previewRef.current.press(hit.interaction, hit.region.name, world.x, world.y);
        setStatus(`Testing ${hit.interaction.name}. Release to return to idle.`);
      } else setStatus("No enabled region here. Turn on hit regions or draw one in Edit mode.");
    } else { drawRef.current = world; setDrawBox({ x: point.x, y: point.y, width: 0, height: 0 }); setStatus("Drag out a region, then release."); }
  }

  function stageMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!frame) return;
    const point = stagePoint(event);
    const world = point && screenToWorld(frame, point.x, point.y);
    if (world && testing) previewRef.current.move(world.x, world.y);
    if (!testing && drawRef.current && point) {
      const start = drawRef.current;
      const x = frame.screenOriginX + (frame.screenUnitXEndX - frame.screenOriginX) * start.x + (frame.screenUnitYEndX - frame.screenOriginX) * start.y;
      const y = frame.screenOriginY + (frame.screenUnitXEndY - frame.screenOriginY) * start.x + (frame.screenUnitYEndY - frame.screenOriginY) * start.y;
      setDrawBox({ x: Math.min(x, point.x), y: Math.min(y, point.y), width: Math.abs(point.x - x), height: Math.abs(point.y - y) });
    }
  }

  function stageRelease(event: ReactPointerEvent<HTMLDivElement>) {
    if (testing && testPointerRef.current === event.pointerId) {
      testPointerRef.current = null;
      previewRef.current.release();
    }
    const start = drawRef.current;
    drawRef.current = null;
    setDrawBox(null);
    if (!testing && start && frame && selectedInteraction) {
      const point = stagePoint(event);
      const end = point && screenToWorld(frame, point.x, point.y);
      if (end && Math.hypot(end.x - start.x, end.y - start.y) > 5) {
        const region = { ...blankRegion(undefined, selectedInteraction.regions.length), placement: "manual" as const, offsetX: (start.x + end.x) / 2, offsetY: (start.y + end.y) / 2, radiusX: Math.max(5, Math.abs(end.x - start.x) / 2), radiusY: Math.max(5, Math.abs(end.y - start.y) / 2) };
        mutate((current) => ({ ...current, selectedRegionId: region.id, interactions: current.interactions.map((item) => item.id === selectedInteraction.id ? { ...item, regions: [...item.regions, region] } : item) }));
        setTool("select"); setInspectorTab("region"); setStatus("Region drawn. Drag to move; use the handles to resize or rotate.");
      }
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function anchorToSelected() {
    if (!selectedRegion || !selectedInteraction || !frame || !project?.selectedBonePath) return;
    const center = regionMatrix(frame, selectedRegion);
    const next = { ...selectedRegion, anchorBone: project.selectedBonePath, offsetX: 0, offsetY: 0, rotation: 0 };
    const offset = inversePoint(regionMatrix(frame, next), center.e, center.f);
    if (!offset) return;
    mutate((current) => ({ ...current, interactions: current.interactions.map((item) => item.id === selectedInteraction.id ? { ...item, regions: item.regions.map((region) => region.id === selectedRegion.id ? { ...region, anchorBone: next.anchorBone, offsetX: offset.x, offsetY: offset.y, placement: "manual" } : region) } : item) }));
  }

  function snapRegionToHead() {
    if (!selectedRegion || !selectedInteraction || !headRegionRef.current) return;
    const head = headRegionRef.current;
    mutate((current) => ({ ...current, interactions: current.interactions.map((item) => item.id === selectedInteraction.id ? { ...item, regions: item.regions.map((region) => region.id === selectedRegion.id ? { ...region, ...head, enabled: true, placement: "manual" } : region) } : item) }));
    setStatus("Region fitted to detected head artwork. Movement target was not changed.");
  }

  const assetLoaded = Boolean(source && directory && files && frame && project);
  const loadPercent = Math.round(Math.max(0, Math.min(1, loadProgress.total > 0 ? loadProgress.loaded / loadProgress.total : 0)) * 100);
  const saveLabel = saveState === "saving"
    ? "Saving…"
    : saveState === "dirty"
      ? "Unsaved changes"
      : saveState === "error"
        ? "Save failed"
        : savedAt
           ? `Saved ${new Date(savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
           : "Ready to save";

  function recentPath(item: RecentFile): string {
    return item.kind === "folder" ? item.rootPath : nativePath(item.rootPath, item.path);
  }

  function recentList(limit = 6) {
    if (recentFiles.length === 0) return <p className="editor-muted editor-recent-empty">No recent files yet.</p>;
    return <div className="editor-recent-list">
      {recentFiles.slice(0, limit).map((item) => <div className="editor-recent-item" key={`${item.kind}:${item.rootPath}:${item.path}`}>
        <button className="editor-recent-open" title={recentPath(item)} onClick={() => void openRecentFile(item)}>
          <span className={`editor-recent-icon kind-${item.kind}`}>{item.kind === "folder" ? "▰" : item.kind === "project" ? "◇" : item.kind === "subtitle" ? "≡" : "♫"}</span>
          <span><b>{item.label}</b><small>{recentKindLabel(item.kind)} · {displayName(item.rootPath)}</small></span>
        </button>
        <button className="editor-recent-remove" aria-label={`Remove ${item.label} from recent files`} title="Remove from recent files" onClick={() => forgetRecentFile(item)}>×</button>
      </div>)}
      {recentFiles.length > limit && <span className="editor-recent-more">{recentFiles.length - limit} more in Open menu</span>}
    </div>;
  }

  return (
    <div className={`editor-app${testing ? " is-testing" : ""}`}>
      <header className="editor-header">
        <div className="editor-brand">
          <span className="editor-kicker">SHITTIM CHEST · SPINE 4.2</span>
          <h1>{workspace === "timeline" ? "Timeline Composer" : "Interaction Studio"}</h1>
        </div>
        <div className="editor-actions">
          <div className="editor-workspace-tabs" role="tablist" aria-label="Editor workspace">
            <button className={`editor-button${workspace === "interaction" ? " active" : ""}`} role="tab" aria-selected={workspace === "interaction"} onClick={() => setWorkspace("interaction")}>Interactions</button>
            <button className={`editor-button${workspace === "timeline" ? " active" : ""}`} role="tab" aria-selected={workspace === "timeline"} onClick={() => setWorkspace("timeline")} disabled={!assetLoaded}>Timeline</button>
          </div>
          <div className="editor-asset-picker"><span>Set</span><button className="editor-asset-picker-button" type="button" aria-haspopup="dialog" aria-expanded={assetPickerOpen} onClick={() => setAssetPickerOpen(true)} disabled={!directories.length} title={directory || "Open a folder first"}><span>{directory || "Open a folder…"}</span><b aria-hidden="true">⌄</b></button></div>
          <details className="editor-open-menu">
            <summary className="editor-button">Open ▾</summary>
            <div className="editor-open-menu-popover">
              <button className="editor-button" onClick={() => void openFolder()}>Asset folder…</button>
              <button className="editor-button" onClick={() => void openProjectFile()}>Project file…</button>
              <div className="editor-open-menu-heading"><span>Recently opened</span>{recentFiles.length > 0 && <button onClick={() => { recentFilesRef.current = []; setRecentFiles([]); try { localStorage.removeItem(RECENT_FILES_KEY); } catch { /* optional */ } }}>Clear</button>}</div>
              {recentList(8)}
            </div>
          </details>
          <span className={`editor-save-state is-${saveState}`} aria-live="polite">● {saveLabel}</span>
          <button className="editor-button editor-save-button" onClick={() => void saveProject()} disabled={!assetLoaded || saveState === "saving"}>Save files</button>
          <button className="editor-button" onClick={() => setHelp((value) => !value)} title="Keyboard shortcuts (?)">? Help</button>
        </div>
      </header>
      <AssetPickerModal open={assetPickerOpen} title="Switch character or asset set" eyebrow="CHARACTER / ASSET SET" description="Search the loaded Spine catalog, then choose the set to edit." directories={directories} selected={directory} onClose={() => setAssetPickerOpen(false)} onSelect={(next) => { setAssetPickerOpen(false); changeDirectory(next); }} />

      {help && <div className="editor-help" role="region" aria-label="Editor help"><strong>Shortcuts</strong>{workspace === "timeline" ? <span>Space Play/pause · ←/→ Frame · Shift+←/→ 10 frames · Home/End · S Split subtitle · Ctrl/⌘ D Duplicate · Delete Remove · F Fit · Ctrl/⌘ S Save</span> : <><span>Draw a hit region → choose animations → Test → press, hold, drag, release.</span><span>V Select · H Pan · R Draw · T Test · F Fit · B Bones · Space Play/pause · Esc Idle/Edit</span><span>Ctrl/⌘ Z Undo · Shift Z Redo · Ctrl/⌘ D Duplicate · Delete Remove region · Ctrl/⌘ S Save</span></>}<button className="editor-button" onClick={() => setHelp(false)}>Close</button></div>}
      <main className={`editor-layout${leftHidden ? " hide-left" : ""}${rightHidden ? " hide-right" : ""}${!assetLoaded ? " is-loading" : ""}`} style={{ position: workspace === "timeline" ? "absolute" : undefined, visibility: workspace === "timeline" ? "hidden" : undefined, inset: workspace === "timeline" ? "100px 0 40px" : undefined, pointerEvents: workspace === "timeline" ? "none" : undefined, gridTemplateColumns: `${leftHidden ? "" : `${leftWidth}px `}minmax(180px, 1fr)${rightHidden ? "" : ` ${rightWidth}px`}` }}>
        {assetLoaded && (["left", "right"] as const).filter((side) => side === "left" ? !leftHidden : !rightHidden).map((side) => <div key={side} className={`editor-panel-resizer ${side}`} role="separator" aria-label={`Resize ${side} panel`} aria-orientation="vertical" tabIndex={0} style={side === "left" ? { left: leftWidth + 7 } : { right: rightWidth + 7 }} onDoubleClick={() => side === "left" ? setLeftWidth(220) : setRightWidth(320)} onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault(); const delta = event.key === "ArrowRight" ? 10 : -10;
          side === "left" ? setLeftWidth((value) => Math.max(160, Math.min(380, value + delta))) : setRightWidth((value) => Math.max(260, Math.min(460, value - delta)));
        }} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); panelDragRef.current = { side, x: event.clientX, width: side === "left" ? leftWidth : rightWidth }; }} onPointerMove={(event) => {
          const drag = panelDragRef.current;
          if (!drag) return;
          const dx = event.clientX - drag.x;
          drag.side === "left" ? setLeftWidth(Math.max(160, Math.min(380, drag.width + dx))) : setRightWidth(Math.max(260, Math.min(460, drag.width - dx)));
        }} onPointerUp={() => { panelDragRef.current = null; }} onPointerCancel={() => { panelDragRef.current = null; }} />)}
        <aside className="editor-panel editor-left-panel" hidden={!assetLoaded || leftHidden}>
          <section className="editor-section editor-bone-section">
            <div className="editor-section-title"><strong>Rig hierarchy</strong><span>{visibleBones.length}/{frame?.bones.length ?? 0}</span></div>
            <input className="editor-search" value={boneSearch} onChange={(event) => setBoneSearch(event.target.value)} placeholder="Search bones…" />
            <div className="editor-bone-list">
              {visibleBones.map((bone) => {
                const depth = bone.path.split("/").length - 1;
                const hasChildren = frame?.bones.some((candidate) => candidate.path.startsWith(`${bone.path}/`)) ?? false;
                const collapsed = collapsedBones.has(bone.path);
                return <div key={bone.path} className="editor-bone-row" style={{ paddingLeft: `${Math.min(32, depth * 12)}px` }}>
                  <button className="editor-bone-toggle" disabled={!hasChildren} aria-label={`${collapsed ? "Expand" : "Collapse"} ${bone.name}`} aria-expanded={hasChildren ? !collapsed : undefined} onClick={() => toggleBone(bone.path)}>{hasChildren ? collapsed ? "▸" : "▾" : "·"}</button>
                  <button className={`editor-bone-item${project?.selectedBonePath === bone.path ? " is-selected" : ""}`} title={bone.path} onClick={() => live((current) => ({ ...current, selectedBonePath: bone.path }))}>
                    <span className="editor-bone-dot" />{bone.name}
                  </button>
                </div>;
              })}
            </div>
          </section>
          <details className="editor-section editor-constraints">
            <summary className="editor-section-title"><strong>Constraints</strong><span>{frame?.constraints.length ?? 0}</span></summary>
            <div className="editor-constraint-list">
              {frame?.constraints.map((constraint) => <div key={`${constraint.type}-${constraint.name}`}><b>{constraint.type}</b> {constraint.name}<small>{constraint.target || "physics"}</small></div>)}
              {!frame?.constraints.length && <p className="editor-muted">No constraints in this skeleton.</p>}
            </div>
          </details>
        </aside>

        <section className="editor-center">
          {!assetLoaded && <div className="editor-start editor-start-overlay" aria-live="polite">
            <div className="editor-start-card">
              <span className="editor-kicker">DESKTOP WORKSPACE</span>
              <strong>{error && source && directory ? "Could not load asset set" : source && directory ? "Loading asset set…" : "Open a Spine asset folder"}</strong>
              <span>{error && source && directory ? error : source && directory ? "Reading the selected .atlas, .skel, and texture files." : "Choose the local folder containing your Spine lobby assets to begin."}</span>
              {source && directory && !error && <div className="editor-load-progress" role="progressbar" aria-label="Asset loading progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={loadPercent}>
                <progress value={loadPercent} max={100} />
                <span>{loadProgress.label} · {loadPercent}%</span>
              </div>}
              <div className="editor-start-actions">
                <button className="editor-button editor-start-button" onClick={() => void openFolder()}>{source && directory ? "Choose another folder" : "Open asset folder"}</button>
                <button className="editor-button editor-start-secondary" onClick={() => void openProjectFile()}>Open project file</button>
              </div>
              {recentFiles.length > 0 && <section className="editor-recent-start"><div className="editor-section-title"><strong>Recently opened</strong><button onClick={() => { recentFilesRef.current = []; setRecentFiles([]); try { localStorage.removeItem(RECENT_FILES_KEY); } catch { /* optional */ } }}>Clear</button></div>{recentList(5)}</section>}
            </div>
          </div>}
          <div className="editor-toolbar" role="toolbar" aria-label="Canvas tools">
            <button className="editor-button" onClick={() => setLeftHidden((value) => !value)} title="Toggle bone panel">☰ Bones</button>
            <button className={`editor-button${!testing && tool === "select" ? " active" : ""}`} onClick={() => { setTesting(false); setTool("select"); }} title="Select and transform regions (V)">Select</button>
            <button className={`editor-button${!testing && tool === "pan" ? " active" : ""}`} onClick={() => { setTesting(false); setTool("pan"); }} title="Drag canvas to pan; wheel to zoom (H)">Pan</button>
            <button className={`editor-button${!testing && tool === "draw" ? " active" : ""}`} disabled={!selectedInteraction} onClick={() => { setTesting(false); setTool("draw"); setStatus("Click and drag on the canvas to draw a hit region."); }} title="Draw a hit region (R)">Draw region</button>
            <button className={`editor-button${testing ? " active test" : ""}`} onClick={toggleTest} disabled={!project} title="Run the full authored interaction (T)">{testing ? "● Test" : "▶ Test"}</button>
            <button className="editor-button" onClick={() => rendererRef.current?.resetCamera()} title="Fit artwork to canvas (F)">Fit</button>
            <details className="editor-overlay-menu">
              <summary className="editor-button">Overlays ▾</summary>
              <div className="editor-overlay-menu-popover">
                <label><input type="checkbox" checked={displaySettings.showBones} onChange={(event) => updateViewSetting("showBones", event.target.checked)} /> Bones</label>
                <label><input type="checkbox" checked={displaySettings.showBoneNames} onChange={(event) => updateViewSetting("showBoneNames", event.target.checked)} /> Names</label>
                <label><input type="checkbox" checked={displaySettings.showConstraints} onChange={(event) => updateViewSetting("showConstraints", event.target.checked)} /> Constraints</label>
                <label><input type="checkbox" checked={displaySettings.showInactiveBones} onChange={(event) => updateViewSetting("showInactiveBones", event.target.checked)} /> Inactive bones</label>
              </div>
            </details>
            <button className="editor-button" onClick={resetPreview} disabled={!meta}>Reset idle</button>
            <button className="editor-button" onClick={() => setRightHidden((value) => !value)} title="Toggle inspector">Inspector ☰</button>
          </div>
          <div className="editor-stage" ref={stageRef} onDoubleClick={(event) => { if (!testing && event.target === canvasRef.current) rendererRef.current?.resetCamera(); }}>
            <canvas ref={canvasRef} aria-label="Spine editor canvas" />
            {(!testing || showTestRegions) && <BoneOverlay
               frame={frame}
               project={testing && project ? { ...project, selectedRegionId: null } : project}
               viewSettings={renderedViewSettings}
               motionLimits={!testing && inspectorTab === "movement" && selectedInteraction?.followTargetBone ? { targetBonePath: selectedInteraction.followTargetBone, limitX: selectedInteraction.limitX, limitY: selectedInteraction.limitY, allowX: selectedInteraction.allowX, allowY: selectedInteraction.allowY, rotationEnabled: selectedInteraction.rotationEnabled, rotationMin: selectedInteraction.rotationMin, rotationMax: selectedInteraction.rotationMax } : null}
               tool={testing ? "pan" : tool}
              onSelectBone={(path) => live((current) => ({ ...current, selectedBonePath: path }))}
              onSelectRegion={(interactionId, regionId) => live((current) => ({ ...current, selectedInteractionId: interactionId, selectedRegionId: regionId }))}
              onBeginRegionDrag={() => { if (projectRef.current) setUndo((items) => [...items.slice(-49), projectRef.current!]); setRedo([]); }}
              onChangeRegion={(interactionId, regionId, patch) => live((current) => ({ ...current, interactions: current.interactions.map((item) => item.id === interactionId ? { ...item, regions: item.regions.map((region) => region.id === regionId ? { ...region, ...patch, placement: "manual" } : region) } : item) }))}
              onDragRegion={(interactionId, regionId, x, y) => live((current) => ({
                ...current,
                interactions: current.interactions.map((interaction) => interaction.id !== interactionId ? interaction : {
                  ...interaction,
                   regions: interaction.regions.map((region) => region.id === regionId ? { ...region, offsetX: x, offsetY: y, placement: "manual" } : region),
                }),
              }))}
            />}
            {(testing || tool === "draw") && <div className={`editor-input-surface${testing ? " testing" : " drawing"}`} aria-label={testing ? "Interaction test surface" : "Draw region surface"} onPointerDown={stagePress} onPointerMove={stageMove} onPointerUp={stageRelease} onPointerCancel={(event) => { if (!testing || testPointerRef.current === event.pointerId) { testPointerRef.current = null; previewRef.current.release(); } drawRef.current = null; setDrawBox(null); }} />}
            {drawBox && frame && <svg className="editor-draw-ghost" viewBox={`0 0 ${frame.canvasWidth} ${frame.canvasHeight}`} preserveAspectRatio="none"><ellipse cx={drawBox.x + drawBox.width / 2} cy={drawBox.y + drawBox.height / 2} rx={drawBox.width / 2} ry={drawBox.height / 2} /></svg>}
            {!frame && <div className="editor-empty"><strong>Open a Spine asset folder</strong><span>The desktop editor reads .atlas, .skel, and local texture files from the selected root.</span></div>}
            {frame && <div className="editor-canvas-badge">{frame.animation ?? "No animation"} · {frame.bones.length} bones</div>}
             {(testing || tool !== "select") && <div className="editor-stage-hint">{testing ? `${previewStatus} · Press a region, hold/drag, release` : tool === "draw" ? "Drag to draw a new region" : "Drag to pan · Wheel to zoom · F to fit"}</div>}
          </div>
           {testing && <div className="editor-testbar">
             <div className="editor-debug-status"><strong aria-live="polite">{previewStatus}</strong><span>{previewDebug.held ? "Held" : previewDebug.phase === "idle" ? "Ready" : "Released"}</span></div>
             <div className="editor-debug-grid" aria-label="Interaction debugger">
               <span>Interaction <b>{previewDebug.interactionName || "—"}</b></span>
               <span>Region <b>{previewDebug.regionName || "—"}</b></span>
               <span>Phase <b>{previewDebug.phase}</b></span>
               <span>Body <b>{previewDebug.bodyAnimation || "—"}</b></span>
               <span>Face <b>{previewDebug.faceAnimation || "—"}</b></span>
               <span>Target <b title={previewDebug.targetBonePath ?? ""}>{previewDebug.targetBonePath?.split("/").pop() ?? "—"}</b></span>
               <span>Offset <b>{previewDebug.offsetX.toFixed(1)}, {previewDebug.offsetY.toFixed(1)}</b></span>
               <span>Rotation <b>{previewDebug.rotation.toFixed(1)}°</b></span>
             </div>
             <label><input type="checkbox" checked={showTestRegions} onChange={(event) => setShowTestRegions(event.target.checked)} /> Hit regions</label>
           </div>}
          <div className="editor-timeline">
            <div className="editor-timeline-top">
              <button className="editor-icon-button" title="Play/pause (Space)" onClick={() => { const next = !playing; setPlaying(next); rendererRef.current?.setPlaying(next); }} disabled={!frame || testing}>{playing ? "❚❚" : "▶"}</button>
              <select aria-label="Preview animation" value={selectedAnimation} onChange={(event) => { setSelectedAnimation(event.target.value); rendererRef.current?.setAnimation(event.target.value, true); }} disabled={!meta || testing}>
                {meta?.animations.map((animation) => <option key={animation} value={animation}>{animation}</option>)}
              </select>
              <label className="editor-speed">Speed <input type="number" min="0.1" max="3" step="0.1" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} /></label>
              <span className="editor-time">{progress.time.toFixed(2)} / {progress.duration.toFixed(2)}s</span>
            </div>
            <input aria-label="Animation position" className="editor-range" type="range" min="0" max={Math.max(0.001, progress.duration)} step="0.001" value={Math.min(progress.time, progress.duration)} onChange={(event) => { setPlaying(false); rendererRef.current?.seek(Number(event.target.value)); }} disabled={!frame || testing} />
          </div>
        </section>

        <aside className={`editor-panel editor-right-panel tab-${inspectorTab}`} hidden={!assetLoaded || rightHidden}>
           <nav className="editor-tabs" aria-label="Inspector sections">{(["region", "animation", "movement"] as const).map((tab) => <button key={tab} aria-pressed={inspectorTab === tab} onClick={(event) => { setInspectorTab(tab); event.currentTarget.closest("aside")?.scrollTo({ top: 0 }); }}>{tab === "region" ? "Region" : tab === "animation" ? "Animation" : "Movement"}</button>)}</nav>
          <section className="editor-section editor-interactions-section">
            <div className="editor-section-title"><strong>Interactions</strong><button onClick={addInteraction} disabled={!project || !frame}>＋ Add</button></div>
            <input className="editor-search" value={interactionSearch} onChange={(event) => setInteractionSearch(event.target.value)} placeholder="Filter interactions…" />
            <div className="editor-interaction-list">
              {visibleInteractions.map((item) => <button key={item.id} className={item.id === project?.selectedInteractionId ? "is-selected" : ""} onClick={() => selectInteraction(item.id)}><i style={{ background: item.color }} />{item.name}<small>{item.regions.length} region{item.regions.length === 1 ? "" : "s"}</small></button>)}
            </div>
          </section>
          <details className={`editor-section editor-validation${validationWarnings.length ? " has-warnings" : ""}`}>
            <summary>{validationWarnings.length ? `${validationWarnings.length} checks to review` : "✓ Project checks passed"}</summary>
            <div className="editor-section-title"><strong>Validation</strong><span>{validationWarnings.length ? `${validationWarnings.length} warning${validationWarnings.length === 1 ? "" : "s"}` : "Ready"}</span></div>
            {validationWarnings.length === 0
              ? <p className="editor-muted">No missing animations, bones, or overlapping regions.</p>
              : <div className="editor-validation-list">{validationWarnings.map((warning) => <div key={warning.id}><b>{warning.kind.replace("-", " ")}</b><span>{warning.message}</span></div>)}</div>}
          </details>
           {selectedInteraction && <section className="editor-section editor-inspector">
             <div className="editor-section-title"><strong>Interaction</strong><span><button onClick={duplicateInteraction} title="Duplicate interaction and its regions">Duplicate</button> <button className="danger" onClick={() => { if (confirm("Delete this interaction and all its regions?")) deleteInteraction(); }}>Delete</button></span></div>
             <details className="editor-interaction-settings" open={inspectorTab !== "region"}>
               <summary>Interaction settings</summary>
               <div className="editor-settings-body">
             <label>Name<input value={selectedInteraction.name} onChange={(event) => updateInteraction("name", event.target.value)} /></label>
             <div className="editor-two-fields"><label>Trigger<select value={selectedInteraction.trigger} onChange={(event) => updateInteraction("trigger", event.target.value)}><option value="press">Press</option><option value="hold">Hold</option><option value="drag">Drag</option></select></label><label>Color<input type="color" value={selectedInteraction.color} onChange={(event) => updateInteraction("color", event.target.value)} /></label></div>
             <label><input type="checkbox" checked={selectedInteraction.enabled} onChange={(event) => updateInteraction("enabled", event.target.checked)} /> Enabled</label>
              <div className="editor-animation-fields">
              <div className="editor-subheading">On press → While held → On release</div>
              <p className="editor-muted">Body and face tracks play together over idle. Test runs the complete sequence.</p>
              <button className="editor-preview-button" onClick={detectPhases}>Auto-detect phases from press animation</button>
              <div className="editor-phase-strip" aria-label="Interaction animation phases">
                {[
                  { label: "On press", body: selectedInteraction.startAnimation, face: selectedInteraction.faceStartAnimation, loop: false },
                  { label: "While held", body: selectedInteraction.followAnimation, face: selectedInteraction.faceFollowAnimation, loop: true },
                  { label: "On release", body: selectedInteraction.endAnimation, face: selectedInteraction.faceEndAnimation, loop: false },
                ].map((phase) => <article className="editor-phase-card" key={phase.label}>
                  <div><strong>{phase.label}</strong><button className="editor-preview-button" disabled={testing || (!phase.body && !phase.face)} onClick={() => previewPhase(phase.label, phase.body, phase.face, phase.loop)}>Preview</button></div>
                  <span>{phase.body || "No body animation"}</span>
                  <small>{phase.face ? `Face · ${phase.face}` : "No face track"}{phase.loop ? " · loops" : ""}</small>
                </article>)}
              </div>
              <label>On press<select value={selectedInteraction.startAnimation} onChange={(event) => updateInteraction("startAnimation", event.target.value)}><option value="">None</option>{meta?.animations.map((animation) => <option key={animation} value={animation}>{animation}</option>)}</select></label>
             <label>While held (loops)<select value={selectedInteraction.followAnimation} onChange={(event) => updateInteraction("followAnimation", event.target.value)}><option value="">None</option>{meta?.animations.map((animation) => <option key={animation} value={animation}>{animation}</option>)}</select></label>
             <label>On release<select value={selectedInteraction.endAnimation} onChange={(event) => updateInteraction("endAnimation", event.target.value)}><option value="">None</option>{meta?.animations.map((animation) => <option key={animation} value={animation}>{animation}</option>)}</select></label>
            <details className="editor-advanced-phases"><summary>Face / secondary tracks</summary><div>
              <label>Start<select value={selectedInteraction.faceStartAnimation} onChange={(event) => updateInteraction("faceStartAnimation", event.target.value)}><option value="">None</option>{meta?.animations.map((animation) => <option key={animation} value={animation}>{animation}</option>)}</select></label>
              <label>Follow<select value={selectedInteraction.faceFollowAnimation} onChange={(event) => updateInteraction("faceFollowAnimation", event.target.value)}><option value="">None</option>{meta?.animations.map((animation) => <option key={animation} value={animation}>{animation}</option>)}</select></label>
              <label>End<select value={selectedInteraction.faceEndAnimation} onChange={(event) => updateInteraction("faceEndAnimation", event.target.value)}><option value="">None</option>{meta?.animations.map((animation) => <option key={animation} value={animation}>{animation}</option>)}</select></label>
            </div></details>
             <div className="editor-two-fields"><button className="editor-preview-button" disabled={testing} onClick={() => playAnimation(selectedInteraction.startAnimation)}>Preview press</button><button className="editor-preview-button" onClick={toggleTest}>{testing ? "Exit test" : "Test full interaction"}</button></div>
              </div>
              <div className="editor-movement-fields">
              <div className="editor-subheading">Drag response</div>
              <p className="editor-muted">Movement is relative to the initial press. Limits are in the target bone's parent space.</p>
             <div className="editor-bone-picker">
               <label>Target bone search<input value={targetBoneSearch} onChange={(event) => setTargetBoneSearch(event.target.value)} placeholder="Search name or path…" /></label>
               <div className="editor-bone-picker-list">
                 <button type="button" className={!selectedInteraction.followTargetBone ? "is-selected" : ""} onClick={() => updateInteraction("followTargetBone", null)}>None</button>
                 {targetBoneOptions.map((bone) => <button type="button" key={bone.path} className={selectedInteraction.followTargetBone === bone.path ? "is-selected" : ""} title={bone.path} onClick={() => updateInteraction("followTargetBone", bone.path)}><span>{bone.name}</span><small>{bone.path}</small></button>)}
                 {targetBoneSearch.trim() && targetBoneOptions.length === 0 && <p className="editor-muted">No matching bones.</p>}
                 {!targetBoneSearch.trim() && <p className="editor-field-hint">{selectedInteraction.followTargetBone ? `Type to search the ${frame?.bones.length ?? 0}-bone rig.` : "Type to choose a target bone."}</p>}
               </div>
             </div>
               <div className="editor-three-fields"><label>Sensitivity<input type="number" min="0" max="2" step="0.05" value={selectedInteraction.sensitivity} onChange={(event) => updateInteraction("sensitivity", Number(event.target.value))} /></label><label>Limit X<input type="number" min="0" step="1" value={selectedInteraction.limitX} onChange={(event) => updateInteraction("limitX", Number(event.target.value))} /></label><label>Limit Y<input type="number" min="0" step="1" value={selectedInteraction.limitY} onChange={(event) => updateInteraction("limitY", Number(event.target.value))} /></label></div>
              <div className="editor-subheading">Local bone constraints</div>
              <p className="editor-muted">Translation uses the target parent’s local axes. Rotation is relative to the animated bone pose.</p>
              <div className="editor-axis-checks" aria-label="Translation axes">
                <span>Translation axes</span>
                <label><input type="checkbox" checked={selectedInteraction.allowX} onChange={(event) => updateInteraction("allowX", event.target.checked)} /> Local X</label>
                <label><input type="checkbox" checked={selectedInteraction.allowY} onChange={(event) => updateInteraction("allowY", event.target.checked)} /> Local Y</label>
              </div>
              <div className="editor-two-fields">
                <label><span className="timeline-inline-check"><input type="checkbox" checked={selectedInteraction.rotationEnabled} onChange={(event) => updateInteraction("rotationEnabled", event.target.checked)} /> Local rotation</span><small className="editor-field-hint">The R gizmo shows the active range.</small></label>
                <label>Rotation input<select value={selectedInteraction.rotationAxis} disabled={!selectedInteraction.rotationEnabled} onChange={(event) => updateInteraction("rotationAxis", event.target.value)}><option value="x">Local X drag</option><option value="y">Local Y drag</option></select></label>
              </div>
              <div className="editor-two-fields"><label>Min rotation °<input type="number" min="-180" max="0" step="1" disabled={!selectedInteraction.rotationEnabled} value={selectedInteraction.rotationMin} onChange={(event) => updateInteraction("rotationMin", Number(event.target.value))} /></label><label>Max rotation °<input type="number" min="0" max="180" step="1" disabled={!selectedInteraction.rotationEnabled} value={selectedInteraction.rotationMax} onChange={(event) => updateInteraction("rotationMax", Number(event.target.value))} /></label></div>
              <label>Smoothing · {selectedInteraction.smoothing.toFixed(1)} (higher = faster response)<input type="range" min="1" max="24" step="0.5" value={selectedInteraction.smoothing} onChange={(event) => updateInteraction("smoothing", Number(event.target.value))} /></label>
              <button className="editor-preview-button" disabled={!project?.selectedBonePath} onClick={() => updateInteraction("followTargetBone", project?.selectedBonePath ?? null)}>Use selected bone as movement target</button>
              </div>
               </div>
             </details>
              <div className="editor-region-fields">
             <div className="editor-subheading editor-region-heading"><span>Hit regions</span><button onClick={addRegion}>＋ Add region</button></div>
            <div className="editor-region-list">
              {selectedInteraction.regions.map((region) => <button key={region.id} className={region.id === project?.selectedRegionId ? "is-selected" : ""} onClick={() => live((current) => ({ ...current, selectedRegionId: region.id }))}><i style={{ background: selectedInteraction.color }} />{region.name}<small>{region.shape}</small></button>)}
              {!selectedInteraction.regions.length && <p className="editor-muted">No hit regions. Add one to make this interaction clickable.</p>}
             </div>
              </div>
           </section>}
           {inspectorTab === "region" && selectedRegion && selectedInteraction && <section className="editor-section editor-inspector">
             <div className="editor-section-title"><strong>Region</strong><span><button onClick={duplicateRegion}>Duplicate</button> <button className="danger" onClick={deleteRegion}>Delete</button></span></div>
            <label>Name<input value={selectedRegion.name} onChange={(event) => updateRegion("name", event.target.value)} /></label>
            <div className="editor-two-fields"><label>Shape<select value={selectedRegion.shape} onChange={(event) => updateRegion("shape", event.target.value)}><option value="ellipse">Ellipse</option><option value="rectangle">Rectangle</option></select></label><label>Anchor<select value={selectedRegion.anchorBone ?? ""} onChange={(event) => updateRegion("anchorBone", event.target.value || null)}><option value="">World</option>{frame?.bones.map((bone) => <option key={bone.path} value={bone.path}>{bone.name}</option>)}</select></label></div>
             <details><summary>Position & size (advanced)</summary><div className="editor-three-fields"><label>Offset X<input type="number" step="1" value={Number(selectedRegion.offsetX.toFixed(2))} onChange={(event) => updateRegion("offsetX", Number(event.target.value))} /></label><label>Offset Y<input type="number" step="1" value={Number(selectedRegion.offsetY.toFixed(2))} onChange={(event) => updateRegion("offsetY", Number(event.target.value))} /></label><label>Rotate °<input type="number" step="1" value={Number(selectedRegion.rotation.toFixed(1))} onChange={(event) => updateRegion("rotation", Number(event.target.value))} /></label></div>
             <div className="editor-two-fields"><label>Radius X<input type="number" min="1" step="1" value={Number(selectedRegion.radiusX.toFixed(2))} onChange={(event) => updateRegion("radiusX", Math.max(1, Number(event.target.value)))} /></label><label>Radius Y<input type="number" min="1" step="1" value={Number(selectedRegion.radiusY.toFixed(2))} onChange={(event) => updateRegion("radiusY", Math.max(1, Number(event.target.value)))} /></label></div></details>
            <label><input type="checkbox" checked={selectedRegion.enabled} onChange={(event) => updateRegion("enabled", event.target.checked)} /> Enabled</label>
             <button className="editor-preview-button" disabled={!project?.selectedBonePath} onClick={anchorToSelected}>Anchor to selected bone (keep position)</button>
             <button className="editor-preview-button" disabled={!headRegionRef.current} onClick={snapRegionToHead}>Fit region to detected head</button>
             <button className="editor-preview-button" onClick={() => mutate((current) => ({ ...current, interactions: current.interactions.map((item) => item.id === selectedInteraction.id ? { ...item, regions: item.regions.map((region) => region.id === selectedRegion.id ? { ...region, offsetX: 0, offsetY: 0 } : region) } : item) }))}>Center on anchor</button>
             <p className="editor-muted">Select a bone on the canvas or in the left panel, then anchor here. Resize and rotate using canvas handles.</p>
          </section>}
        </aside>
      </main>
      {workspace === "timeline" && assetLoaded && <TimelineWorkspace source={source} directory={directory} directories={directories} project={project} initialSubtitlePath={pendingSubtitlePath} onSubtitleOpened={() => setPendingSubtitlePath(null)} initialAudioPaths={pendingAudioPaths} onAudioOpened={() => setPendingAudioPaths(null)} onRecentFile={recordRecentFile} onMutate={mutate} onLive={live} onBeginEdit={beginTimelineEdit} onSave={() => saveProject()} onRegisterSave={(callback) => { timelineSaveRef.current = callback; }} onStatus={setStatus} onError={setError} />}
      <footer className="editor-statusbar">
        <span className={error ? "editor-error" : ""}>{error ?? status}</span>
        <span>{directory ? `${displayName(directory)} · ${files?.size ?? 0} files` : "No asset loaded"} · {testing ? "TEST MODE" : workspace === "timeline" ? "TIMELINE" : "EDIT MODE"}</span>
      </footer>
    </div>
  );
}
