import { useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  SpineRenderer,
  type SpineEditorFrame,
  type SpineFiles,
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
  EDITOR_SCHEMA_VERSION,
  normalizeProject,
  normalizeViewSettings,
  projectStorageKey,
  repairPinchRegions,
  validateProject,
  viewSettingsFromProject,
  type EditorInteraction,
  type EditorProject,
  type EditorRegion,
  type EditorViewSettings,
} from "./editorModel";
import "./editor.css";
import { InteractionPreview } from "./preview";
import { hitRegion, inversePoint, regionMatrix, screenToWorld } from "./geometry";
import { findInteractionProfile } from "../../../src/client/spine/spineInteraction";
import { detectHeadRegion, repairPatRegions, repairSavedHeadRegions, undoSavedHeadRepair, HEAD_REPAIR_BACKUP, type HeadRegion } from "./headRegion";

interface AssetSource {
  getDirectories: () => Promise<string[]>;
  getSetFiles: (directory: string) => Promise<SpineFiles>;
}

type DirectoryPickerWindow = Window & { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> };
type DirectoryHandleWithEntries = FileSystemDirectoryHandle & { entries: () => AsyncIterableIterator<[string, FileSystemHandle]> };
type WebkitFile = File & { webkitRelativePath?: string };

function sourceFromDirectory(handle: FileSystemDirectoryHandle): AssetSource {
  return {
    getDirectories: async () => {
      const directories: string[] = [];
      let hasRootAssets = false;
      for await (const [name, entry] of (handle as DirectoryHandleWithEntries).entries()) {
        if (entry.kind === "directory") directories.push(name);
        else if (/\.(?:atlas|skel)$/i.test(name)) hasRootAssets = true;
      }
      if (hasRootAssets) directories.unshift(handle.name);
      return directories.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    },
    getSetFiles: async (directory) => {
      const folder = handle.name === directory ? handle : await handle.getDirectoryHandle(directory);
      const files: SpineFiles = new Map();
      for await (const [name, entry] of (folder as DirectoryHandleWithEntries).entries()) {
        if (entry.kind === "file") files.set(name, await (entry as FileSystemFileHandle).getFile());
      }
      return files;
    },
  };
}

function sourceFromInput(fileList: FileList): AssetSource {
  const rootName = (fileList[0] as WebkitFile | undefined)?.webkitRelativePath?.split("/")[0];
  const importedName = rootName || "Imported set";
  const files = [...fileList].map((file) => {
    const path = (file as WebkitFile).webkitRelativePath || file.name;
    const slash = path.indexOf("/");
    return { path: slash === -1 ? path : path.slice(slash + 1), file };
  });
  return {
    getDirectories: async () => {
      const directories = new Set<string>();
      for (const { path } of files) {
        const slash = path.indexOf("/");
        directories.add(slash === -1 ? importedName : path.slice(0, slash));
      }
      directories.delete("");
      return [...directories].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    },
    getSetFiles: async (directory) => {
      const prefix = `${directory}/`;
      const rootSelection = !rootName || rootName === directory;
      return new Map(
        files
          .filter(({ path }) => rootSelection || path.startsWith(prefix))
          .map(({ path, file }) => [rootSelection ? path : path.slice(prefix.length), file]),
      );
    },
  };
}

function displayName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function readStoredViewSettings(): EditorViewSettings | null {
  try {
    const stored = localStorage.getItem(EDITOR_VIEW_SETTINGS_KEY);
    return stored ? normalizeViewSettings(JSON.parse(stored) as unknown) : null;
  } catch {
    return null;
  }
}

const PROJECT_STORAGE_PREFIX = projectStorageKey("");

function readStoredProjects(current: EditorProject | null): EditorProject[] {
  const projects = new Map<string, EditorProject>();
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(PROJECT_STORAGE_PREFIX)) continue;
      const directory = key.slice(PROJECT_STORAGE_PREFIX.length);
      if (!directory) continue;
      const stored = localStorage.getItem(key);
      const normalized = stored ? normalizeProject(JSON.parse(stored) as unknown, directory) : null;
      if (normalized) projects.set(directory, normalized);
    }
  } catch {
    // A single malformed or unavailable storage entry should not block export.
  }
  if (current?.assetDirectory) projects.set(current.assetDirectory, current);
  return [...projects.values()].sort((a, b) => a.assetDirectory.localeCompare(b.assetDirectory, undefined, { sensitivity: "base" }));
}

interface BoneOverlayProps {
  frame: SpineEditorFrame | null;
  project: EditorProject | null;
  viewSettings: EditorViewSettings;
  onSelectBone: (path: string) => void;
  onSelectRegion: (interactionId: string, regionId: string) => void;
  onBeginRegionDrag: () => void;
  onDragRegion: (interactionId: string, regionId: string, x: number, y: number) => void;
  tool: "select" | "pan" | "draw";
  onChangeRegion: (interactionId: string, regionId: string, patch: Partial<EditorRegion>) => void;
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

function BoneOverlay({ frame, project, viewSettings, tool, onSelectBone, onSelectRegion, onBeginRegionDrag, onDragRegion, onChangeRegion }: BoneOverlayProps) {
  const drag = useRef<{ interactionId: string; regionId: string; startX: number; startY: number; offsetX: number; offsetY: number; frame: SpineEditorFrame } | null>(null);
  const handleDrag = useRef<{ interactionId: string; region: EditorRegion; frame: SpineEditorFrame; kind: "resize" | "rotate" } | null>(null);
  if (!frame || !project) return null;
  const bones = frame.bones.filter((bone) => viewSettings.showInactiveBones || bone.active);
  const selectedBone = project.selectedBonePath;
  const regions = project.interactions.flatMap((interaction) => interaction.regions.map((region) => ({ interaction, region })));

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
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
  const repairAbortRef = useRef<AbortController | null>(null);
  const [repairing, setRepairing] = useState(false);
  const [hasRepairBackup, setHasRepairBackup] = useState(() => { try { return Boolean(localStorage.getItem(HEAD_REPAIR_BACKUP)); } catch { return false; } });
  const drawRef = useRef<{ x: number; y: number } | null>(null);
  const [drawBox, setDrawBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const panelDragRef = useRef<{ side: "left" | "right"; x: number; width: number } | null>(null);
  const [leftWidth, setLeftWidth] = useState(220);
  const [rightWidth, setRightWidth] = useState(320);
  const [testing, setTesting] = useState(false);
  const [tool, setTool] = useState<"select" | "pan" | "draw">("select");
  const [inspectorTab, setInspectorTab] = useState<"region" | "animation" | "movement">("region");
  const [showTestRegions, setShowTestRegions] = useState(true);
  const [leftHidden, setLeftHidden] = useState(false);
  const [rightHidden, setRightHidden] = useState(false);
  const [help, setHelp] = useState(false);
  const [assetSearch, setAssetSearch] = useState("");
  const [previewStatus, setPreviewStatus] = useState("Idle");
  const [source, setSource] = useState<AssetSource | null>(null);
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
  const [viewSettings, setViewSettings] = useState<EditorViewSettings | null>(() => readStoredViewSettings());
  const [undo, setUndo] = useState<EditorProject[]>([]);
  const [redo, setRedo] = useState<EditorProject[]>([]);
  const [boneSearch, setBoneSearch] = useState("");
  const [interactionSearch, setInteractionSearch] = useState("");
  const [status, setStatus] = useState("Open a Spine asset folder to begin.");
  const [error, setError] = useState<string | null>(null);

  projectRef.current = project;
  directoryRef.current = directory;
  metaRef.current = meta;
  const viewSettingsRef = useRef<EditorViewSettings | null>(viewSettings);
  viewSettingsRef.current = viewSettings;

  function withCurrentViewSettings(next: EditorProject): EditorProject {
    const settings = viewSettingsRef.current ?? viewSettingsFromProject(next);
    if (!viewSettingsRef.current) {
      viewSettingsRef.current = settings;
      setViewSettings(settings);
    }
    return { ...next, ...settings };
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
        const stored = localStorage.getItem(projectStorageKey(directoryRef.current));
        restored = stored ? normalizeProject(JSON.parse(stored) as unknown, directoryRef.current) : null;
      } catch {
        restored = null;
      }
      const original = restored ?? createProject(directoryRef.current, loadedMeta.animations, value.bones);
      const repair = repairPatRegions(original, headRegionRef.current);
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
        setPreviewStatus(preview.phase === "idle" ? "Idle" : `${preview.phase} · ${preview.interaction?.name} · ${preview.regionName}`);
      },
      onMeta: (value) => callbacksRef.current.onMeta(value),
      onProgress: () => {},
      onLoading: (value) => { if (value) setStatus("Loading Spine asset…"); },
      onError: (value) => setError(value?.message ?? null),
      onEditorFrame: (value) => callbacksRef.current.onFrame(value),
    });
    rendererRef.current = renderer;
    return () => {
      repairAbortRef.current?.abort();
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!source || !directory) return;
    repairAbortRef.current?.abort();
    let cancelled = false;
    setTesting(false);
    previewRef.current.reset();
    rendererRef.current?.clear();
    setFiles(null);
    void source.getSetFiles(directory).then((value) => { if (!cancelled) setFiles(value); }).catch((value) => { if (!cancelled) setError(String(value)); });
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
    catch { setError("Browser storage is full or unavailable. Export JSON to keep your changes."); }
  }, [project, directory]);

  useEffect(() => {
    if (!viewSettings) return;
    try { localStorage.setItem(EDITOR_VIEW_SETTINGS_KEY, JSON.stringify(viewSettings)); }
    catch { /* Display preferences are still useful for this session. */ }
  }, [viewSettings]);

  // Rebound each render so keyboard actions always use current selections/history.
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest("input, select, textarea, [contenteditable=true]")) return;
      const key = event.key.toLowerCase();
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && key === "z") { event.preventDefault(); event.shiftKey ? redoProject() : undoProject(); }
      else if (modifier && key === "y") { event.preventDefault(); redoProject(); }
      else if (modifier && key === "s") { event.preventDefault(); exportProject(); }
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

  async function useSource(next: AssetSource) {
    try {
      const found = await next.getDirectories();
      if (found.length === 0) throw new Error("No Spine asset directories were found.");
      setSource(next);
      setDirectories(found);
      setDirectory(found[0]!);
      setError(null);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  }

  async function openFolder() {
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
    if (picker) {
      try {
        await useSource(sourceFromDirectory(await picker()));
      } catch (value) {
        if ((value as DOMException)?.name !== "AbortError") setError(String(value));
      }
    } else {
      fileInputRef.current?.click();
    }
  }

  function onFolderInput(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files?.length) void useSource(sourceFromInput(event.target.files));
    event.target.value = "";
  }

  function mutate(mutator: (current: EditorProject) => EditorProject) {
    const current = projectRef.current;
    if (!current) return;
    const next = mutator(cloneProject(current));
    setUndo((items) => [...items.slice(-49), current]);
    setRedo([]);
    projectRef.current = next;
    setProject(next);
  }

  function live(mutator: (current: EditorProject) => EditorProject) {
    const current = projectRef.current;
    if (!current) return;
    const next = mutator(cloneProject(current));
    projectRef.current = next;
    setProject(next);
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
  }

  function exportProject() {
    if (!project) return;
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${displayName(directory || "spine-project")}.interactions.json`;
    link.click();
    URL.revokeObjectURL(url);
    setStatus("Project exported.");
  }

  function exportAllProjects() {
    const projects = readStoredProjects(projectRef.current);
    if (projects.length === 0) {
      setStatus("No saved projects to export.");
      return;
    }
    const bundle = { schemaVersion: EDITOR_SCHEMA_VERSION, projects };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "spine-interactions.all.json";
    link.click();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${projects.length} project${projects.length === 1 ? "" : "s"}.`);
  }

  function loadLocal() {
    if (!directory) return;
    try {
      const stored = localStorage.getItem(projectStorageKey(directory));
      const normalized = stored ? normalizeProject(JSON.parse(stored) as unknown, directory) : null;
      const repaired = normalized ? repairPinchRegions(repairPatRegions(normalized, headRegionRef.current).project, frame?.bones ?? []).project : null;
      if (!repaired) {
        setStatus("No saved project exists for this asset set.");
        return;
      }
      const next = withCurrentViewSettings(repaired);
      projectRef.current = next;
      setProject(next);
      setUndo([]);
      setRedo([]);
      setStatus("Loaded local project.");
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  }

  function resetProject() {
    if (!meta || !frame || !directory) return;
    const detected = repairPatRegions(createProject(directory, meta.animations, frame.bones), headRegionRef.current).project;
    const next = withCurrentViewSettings(repairPinchRegions(detected, frame.bones).project);
    if (projectRef.current) setUndo((items) => [...items.slice(-49), projectRef.current!]);
    setRedo([]);
    projectRef.current = next;
    setProject(next);
    setStatus("Reset to detected presets.");
  }

  async function importProject(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const imported = normalizeProject(JSON.parse(await file.text()) as unknown, directory || "imported");
      if (!imported) throw new Error("This is not a valid interaction project.");
      const next = withCurrentViewSettings(frame ? repairPinchRegions(imported, frame.bones).project : imported);
      projectRef.current = next;
      setProject(next);
      setUndo([]);
      setRedo([]);
      setStatus("Project imported.");
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  }

  const selectedInteraction = project?.interactions.find((item) => item.id === project.selectedInteractionId) ?? null;
  const selectedRegion = selectedInteraction?.regions.find((item) => item.id === project?.selectedRegionId) ?? null;
  const visibleBones = useMemo(() => {
    const query = boneSearch.trim().toLocaleLowerCase();
    return frame?.bones.filter((bone) => !query || `${bone.name} ${bone.path}`.toLocaleLowerCase().includes(query)) ?? [];
  }, [boneSearch, frame]);
  const visibleInteractions = project?.interactions.filter((item) => !interactionSearch.trim() || item.name.toLocaleLowerCase().includes(interactionSearch.trim().toLocaleLowerCase())) ?? [];
  const validationWarnings = useMemo(() => project && meta && frame ? validateProject(project, meta.animations, frame.bones) : [], [frame, meta, project]);
  const displaySettings = viewSettings ?? (project ? viewSettingsFromProject(project) : DEFAULT_EDITOR_VIEW_SETTINGS);
  const renderedViewSettings = testing ? { ...displaySettings, showBones: false, showConstraints: false } : displaySettings;

  function updateInteraction(field: keyof EditorInteraction, value: string | number | boolean | null) {
    if (!selectedInteraction) return;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return;
      value = Math.max(field === "smoothing" ? 0.1 : 0, value);
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

  function resetPreview() {
    previewRef.current.reset();
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

  async function repairAllSaved() {
    if (!source || repairing) return;
    const controller = new AbortController();
    repairAbortRef.current = controller;
    setRepairing(true);
    try {
      const result = await repairSavedHeadRegions(source, directories, controller.signal, setStatus);
      const currentKey = directory ? projectStorageKey(directory) : "";
      const currentSaved = currentKey ? localStorage.getItem(currentKey) : null;
      if (currentSaved) {
        const currentProject = normalizeProject(JSON.parse(currentSaved) as unknown, directory);
        if (currentProject) {
          const next = withCurrentViewSettings(frame ? repairPinchRegions(currentProject, frame.bones).project : currentProject);
          projectRef.current = next;
          setProject(next);
          setUndo([]);
          setRedo([]);
        }
      }
      setHasRepairBackup(Boolean(localStorage.getItem(HEAD_REPAIR_BACKUP)));
      setStatus(`${result.cancelled ? "Stopped. " : ""}Head repair: ${result.repaired} repaired, ${result.unresolved} need review, ${result.kept} kept, ${result.failed} failed. Custom regions unchanged.`);
    } catch (value) { setError(String(value)); }
    finally { setRepairing(false); repairAbortRef.current = null; }
  }

  function undoBulkRepair() {
    try {
      const result = undoSavedHeadRepair();
      setHasRepairBackup(Boolean(localStorage.getItem(HEAD_REPAIR_BACKUP)));
      setStatus(`Bulk backup restored: ${result.restored} projects. ${result.kept} subsequently edited projects kept.`);
    } catch (value) { setError(String(value)); }
  }

  function snapRegionToHead() {
    if (!selectedRegion || !selectedInteraction || !headRegionRef.current) return;
    const head = headRegionRef.current;
    mutate((current) => ({ ...current, interactions: current.interactions.map((item) => item.id === selectedInteraction.id ? { ...item, regions: item.regions.map((region) => region.id === selectedRegion.id ? { ...region, ...head, enabled: true, placement: "manual" } : region) } : item) }));
    setStatus("Region fitted to detected head artwork. Movement target was not changed.");
  }

  return (
    <div className={`editor-app${testing ? " is-testing" : ""}`}>
      <header className="editor-header">
        <div>
          <span className="editor-kicker">PRIVATE TOOL · SPINE 4.2</span>
          <h1>Interaction Studio</h1>
        </div>
        <div className="editor-actions">
          <button className="editor-button" onClick={openFolder}>Open asset folder</button>
          <span className="editor-autosave">● Autosaves locally</span>
          <button className="editor-button" onClick={loadLocal} disabled={!directory}>Load local</button>
            <button className="editor-button" onClick={exportProject} disabled={!project}>Export JSON</button>
            <button className="editor-button" onClick={exportAllProjects}>Export all</button>
          <button className="editor-button" onClick={() => { if (confirm("Replace this project with detected presets? You can undo this.")) resetProject(); }} disabled={!meta || !frame}>Reset detected</button>
          <button className="editor-button" onClick={() => projectInputRef.current?.click()}>Import JSON</button>
          <button className="editor-button" disabled={!source} onClick={() => repairing ? repairAbortRef.current?.abort() : void repairAllSaved()} title="Repair untouched default patting regions across all saved sets in the open folder">{repairing ? "Stop repair" : "Repair saved defaults"}</button>
          {hasRepairBackup && <button className="editor-button" disabled={repairing} onClick={undoBulkRepair}>Undo bulk repair</button>}
          <button className="editor-button" onClick={() => setHelp((value) => !value)} title="Keyboard shortcuts (?)">? Help</button>
          <input ref={fileInputRef} className="editor-hidden" type="file" multiple onChange={onFolderInput} {...({ webkitdirectory: "" } as Record<string, string>)} />
          <input ref={projectInputRef} className="editor-hidden" type="file" accept="application/json,.json" onChange={importProject} />
        </div>
      </header>

      <div className="editor-statusbar">
        <span className={error ? "editor-error" : ""}>{error ?? status}</span>
        <span>{directory ? `${displayName(directory)} · ${files?.size ?? 0} files` : "No asset loaded"}</span>
      </div>

      {help && <div className="editor-help" role="region" aria-label="Editor help"><strong>Quick guide</strong><span>Draw a hit region → choose animations → Test → press, hold, drag, release.</span><span>V Select · H Pan · R Draw · T Test · F Fit · B Bones · Space Play/pause · Esc Idle/Edit</span><span>Ctrl/⌘ Z Undo · Shift Z Redo · D Duplicate region · S Export · Delete Remove region</span><button className="editor-button" onClick={() => setHelp(false)}>Close help</button></div>}
      <main className={`editor-layout${leftHidden ? " hide-left" : ""}${rightHidden ? " hide-right" : ""}`} style={{ gridTemplateColumns: `${leftHidden ? "" : `${leftWidth}px `}minmax(180px, 1fr)${rightHidden ? "" : ` ${rightWidth}px`}` }}>
        {(["left", "right"] as const).filter((side) => side === "left" ? !leftHidden : !rightHidden).map((side) => <div key={side} className={`editor-panel-resizer ${side}`} role="separator" aria-label={`Resize ${side} panel`} aria-orientation="vertical" tabIndex={0} style={side === "left" ? { left: leftWidth + 7 } : { right: rightWidth + 7 }} onDoubleClick={() => side === "left" ? setLeftWidth(220) : setRightWidth(320)} onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault(); const delta = event.key === "ArrowRight" ? 10 : -10;
          side === "left" ? setLeftWidth((value) => Math.max(160, Math.min(380, value + delta))) : setRightWidth((value) => Math.max(260, Math.min(460, value - delta)));
        }} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); panelDragRef.current = { side, x: event.clientX, width: side === "left" ? leftWidth : rightWidth }; }} onPointerMove={(event) => {
          const drag = panelDragRef.current;
          if (!drag) return;
          const dx = event.clientX - drag.x;
          drag.side === "left" ? setLeftWidth(Math.max(160, Math.min(380, drag.width + dx))) : setRightWidth(Math.max(260, Math.min(460, drag.width - dx)));
        }} onPointerUp={() => { panelDragRef.current = null; }} onPointerCancel={() => { panelDragRef.current = null; }} />)}
        <aside className="editor-panel editor-left-panel" hidden={leftHidden}>
          <section className="editor-section">
            <div className="editor-section-title"><strong>Asset set</strong><span>{directories.length}</span></div>
            <input className="editor-search" placeholder="Find asset set…" aria-label="Find asset set" value={assetSearch} onChange={(event) => setAssetSearch(event.target.value)} />
            <select value={directory} onChange={(event) => setDirectory(event.target.value)} disabled={!directories.length}>
              {!directories.length && <option value="">Open a folder…</option>}
              {directories.filter((item) => item === directory || item.toLowerCase().includes(assetSearch.toLowerCase())).map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </section>
          <section className="editor-section editor-bone-section">
            <div className="editor-section-title"><strong>Bones</strong><span>{visibleBones.length}/{frame?.bones.length ?? 0}</span></div>
            <input className="editor-search" value={boneSearch} onChange={(event) => setBoneSearch(event.target.value)} placeholder="Search bones…" />
            <div className="editor-checks">
              <label><input type="checkbox" checked={displaySettings.showBones} onChange={(event) => updateViewSetting("showBones", event.target.checked)} /> Show bones</label>
              <label><input type="checkbox" checked={displaySettings.showBoneNames} onChange={(event) => updateViewSetting("showBoneNames", event.target.checked)} /> Names</label>
              <label><input type="checkbox" checked={displaySettings.showConstraints} onChange={(event) => updateViewSetting("showConstraints", event.target.checked)} /> Constraints</label>
              <label><input type="checkbox" checked={displaySettings.showInactiveBones} onChange={(event) => updateViewSetting("showInactiveBones", event.target.checked)} /> Inactive</label>
            </div>
            <div className="editor-bone-list">
              {visibleBones.map((bone) => {
                const depth = bone.path.split("/").length - 1;
                return <button key={bone.path} className={project?.selectedBonePath === bone.path ? "is-selected" : ""} style={{ paddingLeft: `${10 + depth * 14}px` }} onClick={() => live((current) => ({ ...current, selectedBonePath: bone.path }))}>
                  <span className="editor-bone-dot" />{bone.name}<small>{bone.length.toFixed(0)}</small>
                </button>;
              })}
            </div>
          </section>
          <section className="editor-section">
            <div className="editor-section-title"><strong>Constraints</strong><span>{frame?.constraints.length ?? 0}</span></div>
            <div className="editor-constraint-list">
              {frame?.constraints.map((constraint) => <div key={`${constraint.type}-${constraint.name}`}><b>{constraint.type}</b> {constraint.name}<small>{constraint.target || "physics"}</small></div>)}
              {!frame?.constraints.length && <p className="editor-muted">No constraints in this skeleton.</p>}
            </div>
          </section>
        </aside>

        <section className="editor-center">
          <div className="editor-toolbar" role="toolbar" aria-label="Canvas tools">
            <button className="editor-button" onClick={() => setLeftHidden((value) => !value)} title="Toggle bone panel">☰ Bones</button>
            <button className={`editor-button${!testing && tool === "select" ? " active" : ""}`} onClick={() => { setTesting(false); setTool("select"); }} title="Select and transform regions (V)">Select</button>
            <button className={`editor-button${!testing && tool === "pan" ? " active" : ""}`} onClick={() => { setTesting(false); setTool("pan"); }} title="Drag canvas to pan; wheel to zoom (H)">Pan</button>
            <button className={`editor-button${!testing && tool === "draw" ? " active" : ""}`} disabled={!selectedInteraction} onClick={() => { setTesting(false); setTool("draw"); setStatus("Click and drag on the canvas to draw a hit region."); }} title="Draw a hit region (R)">Draw region</button>
            <button className={`editor-button${testing ? " active test" : ""}`} onClick={toggleTest} disabled={!project} title="Run the full authored interaction (T)">{testing ? "● Test" : "▶ Test"}</button>
            <button className="editor-button" onClick={() => rendererRef.current?.resetCamera()} title="Fit artwork to canvas (F)">Fit</button>
            <button className="editor-button" onClick={resetPreview} disabled={!meta}>Reset idle</button>
            <button className="editor-button" onClick={() => setRightHidden((value) => !value)} title="Toggle inspector">Inspector ☰</button>
          </div>
          <div className="editor-stage" ref={stageRef} onDoubleClick={(event) => { if (!testing && event.target === canvasRef.current) rendererRef.current?.resetCamera(); }}>
            <canvas ref={canvasRef} aria-label="Spine editor canvas" />
            {(!testing || showTestRegions) && <BoneOverlay
              frame={frame}
              project={testing && project ? { ...project, selectedRegionId: null } : project}
              viewSettings={renderedViewSettings}
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
            {!frame && <div className="editor-empty"><strong>Open a Spine asset folder</strong><span>The editor reads .atlas, .skel, and local texture files directly in your browser.</span></div>}
            {frame && <div className="editor-canvas-badge">{frame.animation ?? "No animation"} · {frame.bones.length} bones</div>}
            <div className="editor-stage-hint">{testing ? `${previewStatus} · Press a region, hold/drag, release` : tool === "draw" ? "Drag to draw a new region" : tool === "pan" ? "Drag to pan · Wheel to zoom · F to fit" : "Drag region to move · Corner to resize · Round handle to rotate"}</div>
          </div>
          {testing && <div className="editor-testbar"><strong aria-live="polite">{previewStatus}</strong><label><input type="checkbox" checked={showTestRegions} onChange={(event) => setShowTestRegions(event.target.checked)} /> Hit regions</label><span>Target: {previewRef.current.interaction?.followTargetBone?.split("/").pop() ?? "—"}</span></div>}
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

        <aside className={`editor-panel editor-right-panel tab-${inspectorTab}`} hidden={rightHidden}>
          <nav className="editor-tabs" aria-label="Inspector sections">{(["region", "animation", "movement"] as const).map((tab) => <button key={tab} aria-pressed={inspectorTab === tab} onClick={(event) => { setInspectorTab(tab); event.currentTarget.closest("aside")?.scrollTo({ top: 0 }); }}>{tab === "region" ? "Regions" : tab === "animation" ? "Animations" : "Movement"}</button>)}</nav>
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
            <label>Name<input value={selectedInteraction.name} onChange={(event) => updateInteraction("name", event.target.value)} /></label>
            <div className="editor-two-fields"><label>Trigger<select value={selectedInteraction.trigger} onChange={(event) => updateInteraction("trigger", event.target.value)}><option value="press">Press</option><option value="hold">Hold</option><option value="drag">Drag</option></select></label><label>Color<input type="color" value={selectedInteraction.color} onChange={(event) => updateInteraction("color", event.target.value)} /></label></div>
            <label><input type="checkbox" checked={selectedInteraction.enabled} onChange={(event) => updateInteraction("enabled", event.target.checked)} /> Enabled</label>
             <div className="editor-animation-fields">
             <div className="editor-subheading">On press → While held → On release</div>
             <p className="editor-muted">Body and face tracks play together over idle. Test runs the complete sequence.</p>
             <button className="editor-preview-button" onClick={detectPhases}>Auto-detect phases from press animation</button>
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
            <label>Target bone<select value={selectedInteraction.followTargetBone ?? ""} onChange={(event) => updateInteraction("followTargetBone", event.target.value || null)}><option value="">None</option>{frame?.bones.map((bone) => <option key={bone.path} value={bone.path}>{bone.path}</option>)}</select></label>
            <div className="editor-three-fields"><label>Sensitivity<input type="number" min="0" max="2" step="0.05" value={selectedInteraction.sensitivity} onChange={(event) => updateInteraction("sensitivity", Number(event.target.value))} /></label><label>Limit X<input type="number" min="0" step="1" value={selectedInteraction.limitX} onChange={(event) => updateInteraction("limitX", Number(event.target.value))} /></label><label>Limit Y<input type="number" min="0" step="1" value={selectedInteraction.limitY} onChange={(event) => updateInteraction("limitY", Number(event.target.value))} /></label></div>
             <label>Smoothing · {selectedInteraction.smoothing.toFixed(1)} (higher = faster response)<input type="range" min="1" max="24" step="0.5" value={selectedInteraction.smoothing} onChange={(event) => updateInteraction("smoothing", Number(event.target.value))} /></label>
             <button className="editor-preview-button" disabled={!project?.selectedBonePath} onClick={() => updateInteraction("followTargetBone", project?.selectedBonePath ?? null)}>Use selected bone as movement target</button>
             </div>
             <div className="editor-region-fields">
             <div className="editor-subheading editor-region-heading"><span>Hit regions</span><button onClick={addRegion}>＋ Add region</button></div>
            <div className="editor-region-list">
              {selectedInteraction.regions.map((region) => <button key={region.id} className={region.id === project?.selectedRegionId ? "is-selected" : ""} onClick={() => live((current) => ({ ...current, selectedRegionId: region.id }))}><i style={{ background: selectedInteraction.color }} />{region.name}<small>{region.shape}</small></button>)}
              {!selectedInteraction.regions.length && <p className="editor-muted">No hit regions. Add one to make this interaction clickable.</p>}
             </div>
             <button className="editor-preview-button" onClick={() => { setTesting(false); setTool("draw"); }}>Draw a region on canvas</button>
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
      <footer className="editor-footer"><span>Local only · {testing ? "TEST MODE" : "EDIT MODE"} · ? for shortcuts</span><span><button onClick={undoProject} disabled={!undo.length} title="Ctrl/⌘ Z">Undo</button><button onClick={redoProject} disabled={!redo.length} title="Ctrl/⌘ Shift Z">Redo</button></span></footer>
    </div>
  );
}
