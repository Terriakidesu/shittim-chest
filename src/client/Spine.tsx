import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ChangeEvent } from "react";
import { IconCompress, IconExpand, IconPause, IconPlay, IconRotate } from "./components/icons";
import { LanguageSwitch } from "./components/LanguageSwitch";
import { SiteNav } from "./components/SiteNav";
import { ThemeSwitch } from "./components/ThemeSwitch";
import { asset } from "./api";
import { t, useLanguage } from "./i18n";
import {
  INTRO_ANIMATION,
  SpineRenderer,
  type SpineCameraMode,
  type SpineFiles,
  type SpineInteractionMode,
  type SpineInteractionOverlay,
  type SpineMeta,
  type SpineProgress,
} from "./spine/spineRuntime";
import type { SpineInteractionBundle, SpineInteractionProject } from "./spine/spineInteraction";
import characterIndexJson from "./spine/characters.json";
import { DEFAULT_EFFECTS_STRENGTH } from "./spine/spineEffects";

interface CharacterVariant {
  variant: string;
  directory: string;
  assetId?: string;
  devName?: string;
}

interface CharacterIndex {
  schemaVersion: number;
  characters: Record<string, CharacterVariant[]>;
}

const characterIndex = characterIndexJson as CharacterIndex;
const characterNames = Object.keys(characterIndex.characters).sort((a, b) => a.localeCompare(b));

interface AssetSource {
  getSetFiles: (directory: string) => Promise<SpineFiles>;
  getDirectories: () => Promise<string[]>;
}

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
};

// The async iterator is implemented by Chromium's File System Access API, but
// older TypeScript DOM declarations omit it from FileSystemDirectoryHandle.
type DirectoryHandleWithEntries = FileSystemDirectoryHandle & {
  entries: () => AsyncIterableIterator<[string, FileSystemHandle]>;
};

type WebkitFile = File & { webkitRelativePath?: string };

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : t("spine.error.unknown");
}

function sourceFromDirectory(handle: FileSystemDirectoryHandle): AssetSource {
  return {
    getDirectories: async () => {
      const directories: string[] = [];
      let hasAssetFiles = false;
      for await (const [name, entry] of (handle as DirectoryHandleWithEntries).entries()) {
        if (entry.kind === "directory") directories.push(name);
        else if (/\.(?:atlas|skel)$/i.test(name)) hasAssetFiles = true;
      }
      if (hasAssetFiles) directories.unshift(handle.name);
      return directories.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    },
    getSetFiles: async (directory) => {
      const set = handle.name === directory ? handle : await handle.getDirectoryHandle(directory);
      const files: SpineFiles = new Map();
      for await (const [name, entry] of (set as DirectoryHandleWithEntries).entries()) {
        if (entry.kind === "file") files.set(name, await (entry as FileSystemFileHandle).getFile());
      }
      return files;
    },
  };
}

function sourceFromInput(fileList: FileList): AssetSource {
  const rootName = (fileList[0] as WebkitFile | undefined)?.webkitRelativePath?.split("/")[0];
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
        directories.add(slash === -1 ? rootName ?? "" : path.slice(0, slash));
      }
      directories.delete("");
      return [...directories].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    },
    getSetFiles: async (directory) => {
      const prefix = `${directory}/`;
      return new Map(
        files
          .filter(({ path }) => rootName === directory || path.startsWith(prefix))
          .map(({ path, file }) => [rootName === directory ? path : path.slice(prefix.length), file]),
      );
    },
  };
}

export interface SpineViewportHandle {
  resetCamera: () => void;
  toggleFullscreen: () => Promise<void>;
  setAnimation: (animation: string) => void;
  setPlaying: (playing: boolean) => void;
  setSpeed: (speed: number) => void;
  setLoop: (loop: boolean) => void;
  setCameraMode: (mode: SpineCameraMode) => void;
  setInteractionMode: (mode: SpineInteractionMode) => void;
  triggerTalk: () => void;
  replayIntro: () => void;
  restartPlayback: () => void;
  seek: (time: number) => void;
}

interface SpineViewportProps {
  files: SpineFiles | null;
  directory: string;
  interactionProject: SpineInteractionProject | null;
  animation: string;
  playing: boolean;
  speed: number;
  loop: boolean;
  cameraMode: SpineCameraMode;
  interactionMode: SpineInteractionMode;
  showInteractionPoints: boolean;
  effectsStrength: number;
  onMeta: (meta: SpineMeta | null) => void;
  onProgress: (progress: SpineProgress) => void;
  onLoading: (loading: boolean) => void;
  onError: (error: Error | null) => void;
  onCameraMode: (mode: SpineCameraMode) => void;
}

const SpineViewport = forwardRef<SpineViewportHandle, SpineViewportProps>(function SpineViewport({
  files,
  directory,
  interactionProject,
  animation,
  playing,
  speed,
  loop,
  cameraMode,
  interactionMode,
  showInteractionPoints,
  effectsStrength,
  onMeta,
  onProgress,
  onLoading,
  onError,
  onCameraMode,
}, ref) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<SpineRenderer | null>(null);
  const [interactionOverlay, setInteractionOverlay] = useState<SpineInteractionOverlay>({ canvasWidth: 0, canvasHeight: 0, points: [] });
  const callbacks = useRef({ onMeta, onProgress, onLoading, onError, onCameraMode });
  callbacks.current = { onMeta, onProgress, onLoading, onError, onCameraMode };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const renderer = new SpineRenderer(canvas, {
        onMeta: (meta) => {
          callbacks.current.onMeta(meta);
        },
        onProgress: (progress) => callbacks.current.onProgress(progress),
        onLoading: (loading) => callbacks.current.onLoading(loading),
        onError: (error) => callbacks.current.onError(error),
        onCameraMode: (mode) => callbacks.current.onCameraMode(mode),
        onInteractionPoints: (overlay) => setInteractionOverlay(overlay),
      });
      rendererRef.current = renderer;
      return () => {
        renderer.dispose();
        rendererRef.current = null;
      };
    } catch (error) {
      callbacks.current.onError(new Error(errorMessage(error)));
    }
  }, []);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    if (files) void renderer.load(files, directory, interactionProject);
    else renderer.clear();
  }, [files, directory, interactionProject]);

  useEffect(() => rendererRef.current?.setAnimation(animation), [animation]);
  useEffect(() => rendererRef.current?.setPlaying(playing), [playing]);
  useEffect(() => rendererRef.current?.setSpeed(speed), [speed]);
  useEffect(() => rendererRef.current?.setLoop(loop), [loop]);
  useEffect(() => rendererRef.current?.setCameraMode(cameraMode), [cameraMode]);
  useEffect(() => rendererRef.current?.setInteractionMode(interactionMode), [interactionMode]);
  useEffect(() => rendererRef.current?.setEffectsStrength(effectsStrength), [effectsStrength]);
  useEffect(() => rendererRef.current?.setShowInteractionPoints(showInteractionPoints), [showInteractionPoints]);

  useImperativeHandle(ref, () => ({
    resetCamera: () => rendererRef.current?.resetCamera(),
    toggleFullscreen: async () => {
      const layout = stageRef.current?.closest<HTMLElement>(".spine-layout");
      if (layout && rendererRef.current) await rendererRef.current.toggleFullscreen(layout);
    },
    setAnimation: (value) => rendererRef.current?.setAnimation(value),
    setPlaying: (value) => rendererRef.current?.setPlaying(value),
    setSpeed: (value) => rendererRef.current?.setSpeed(value),
    setLoop: (value) => rendererRef.current?.setLoop(value),
    setCameraMode: (value) => rendererRef.current?.setCameraMode(value),
    setInteractionMode: (value) => rendererRef.current?.setInteractionMode(value),
    triggerTalk: () => rendererRef.current?.triggerTalk(),
    replayIntro: () => rendererRef.current?.replayIntro(),
    restartPlayback: () => rendererRef.current?.restartPlayback(),
    seek: (value) => rendererRef.current?.seek(value),
  }), []);

  const overlayWidth = interactionOverlay.canvasWidth;
  const overlayHeight = interactionOverlay.canvasHeight;
  const colors = { pat: "#ff668f", pinch: "#28c7ed", touch: "#ffc857" } as const;
  return <div ref={stageRef} className={`spine-stage${interactionMode === "interaction" ? " spine-stage-interaction" : ""}`}>
    <canvas ref={canvasRef} aria-label={t("spine.stageAria")} />
    {showInteractionPoints && interactionOverlay.points.length > 0 && overlayWidth > 0 && overlayHeight > 0 && <svg className="spine-interaction-overlay" viewBox={`0 0 ${overlayWidth} ${overlayHeight}`} preserveAspectRatio="none" aria-hidden="true">
      {interactionOverlay.points.map((point, index) => {
        const color = colors[point.kind];
        const matrix = `matrix(${point.axisXEndX - point.centerX} ${point.axisXEndY - point.centerY} ${point.axisYEndX - point.centerX} ${point.axisYEndY - point.centerY} ${point.centerX} ${point.centerY})`;
        return <g key={`${point.kind}-${index}`} className={`spine-interaction-point spine-interaction-point-${point.kind}`}>
          {point.shape === "ellipse" ? <ellipse transform={matrix} cx="0" cy="0" rx="1" ry="1" fill={color} fillOpacity=".14" stroke={color} strokeWidth="3" vectorEffect="non-scaling-stroke" /> : <rect transform={matrix} x="-1" y="-1" width="2" height="2" fill={color} fillOpacity=".14" stroke={color} strokeWidth="3" vectorEffect="non-scaling-stroke" />}
          <circle cx={point.centerX} cy={point.centerY} r="7" fill={color} fillOpacity=".9" stroke="#fff" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          <text x={point.centerX + 11} y={point.centerY - 10} fill={color} stroke="#10202d" strokeWidth="4" paintOrder="stroke" fontSize="18" fontWeight="700">{point.kind}</text>
        </g>;
      })}
    </svg>}
  </div>;
});

function formatSeconds(value: number) {
  return value.toFixed(2);
}

function interactionProjectMap(value: unknown): Map<string, SpineInteractionProject> {
  if (!value || typeof value !== "object") return new Map();
  const bundle = value as Partial<SpineInteractionBundle>;
  if (!Array.isArray(bundle.projects)) return new Map();
  return new Map(
    bundle.projects
      .filter((project): project is SpineInteractionProject => Boolean(project && typeof project === "object" && typeof project.assetDirectory === "string" && Array.isArray(project.interactions)))
      .map((project) => [project.assetDirectory, project]),
  );
}

export function Spine() {
  useLanguage();
  const firstCharacter = characterNames[0] ?? "";
  const [selectedCharacter, setSelectedCharacter] = useState(firstCharacter);
  const [selectedDirectory, setSelectedDirectory] = useState(characterIndex.characters[firstCharacter]?.[0]?.directory ?? "");
  const [characterSearch, setCharacterSearch] = useState("");
  const [source, setSource] = useState<AssetSource | null>(null);
  const [availableDirectories, setAvailableDirectories] = useState<Set<string> | null>(null);
  const [setFiles, setSetFiles] = useState<SpineFiles | null>(null);
  const [interactionProjects, setInteractionProjects] = useState<Map<string, SpineInteractionProject>>(() => new Map());
  const [setLoading, setSetLoading] = useState(false);
  const [rendererLoading, setRendererLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<SpineMeta | null>(null);
  const [animation, setAnimation] = useState("");
  const [playing, setPlaying] = useState(true);
  const [loop, setLoop] = useState(true);
  const [cameraMode, setCameraMode] = useState<SpineCameraMode>("fill");
  const [interactionMode, setInteractionMode] = useState<SpineInteractionMode>("free");
  const [showInteractionPoints, setShowInteractionPoints] = useState(false);
  const [showFullscreenControls, setShowFullscreenControls] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [effectsStrength, setEffectsStrength] = useState(DEFAULT_EFFECTS_STRENGTH);
  const [progress, setProgress] = useState<SpineProgress>({ time: 0, duration: 0, animation: null });
  const [fullscreen, setFullscreen] = useState(false);
  const [showFullscreenSidebar, setShowFullscreenSidebar] = useState(true);
  const [showFullscreenOptions, setShowFullscreenOptions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<SpineViewportHandle>(null);
  const stagePointer = useRef<{ x: number; y: number } | null>(null);
  const freeCameraMode = useRef<SpineCameraMode>("fill");
  const freePlaying = useRef(true);
  const freeLoop = useRef(true);
  const freeSpeed = useRef(1);

  useEffect(() => {
    const controller = new AbortController();
    fetch(asset("data/spine-interactions/spine-interactions.all.json"), { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`Interaction data: ${response.status}`)))
      .then((value) => setInteractionProjects(interactionProjectMap(value)))
      .catch((reason) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) setInteractionProjects(new Map());
      });
    return () => controller.abort();
  }, []);

  // React's DOM typings do not expose the non-standard directory attribute,
  // and React may omit an unknown JSX prop. Set it on the actual input so the
  // fallback opens a directory chooser rather than a single-file chooser.
  useEffect(() => {
    inputRef.current?.setAttribute("webkitdirectory", "");
  }, []);

  const allVariants = characterIndex.characters[selectedCharacter] ?? [];
  const variants = source && availableDirectories
    ? allVariants.filter((variant) => availableDirectories.has(variant.directory))
    : [];
  const loadedCharacters = useMemo(() => {
    if (!source) return [];
    if (!availableDirectories) return [];
    return characterNames.filter((name) => characterIndex.characters[name]?.some((variant) => availableDirectories.has(variant.directory)));
  }, [availableDirectories, source]);
  const filteredCharacters = useMemo(() => {
    const query = characterSearch.trim().toLocaleLowerCase();
    return query ? loadedCharacters.filter((name) => name.toLocaleLowerCase().includes(query)) : loadedCharacters;
  }, [characterSearch, loadedCharacters]);
  const selectedVariant = variants.find((variant) => variant.directory === selectedDirectory) ?? variants[0];
  const selectedDirectoryName = selectedVariant?.directory ?? "";
  const selectedInteractionProject = interactionProjects.get(selectedDirectoryName) ?? null;
  const isLoading = setLoading || rendererLoading || Boolean(source && !availableDirectories);
  const animationOptions = meta
    ? [
      ...(meta.introAnimation && meta.idleAnimation ? [INTRO_ANIMATION] : []),
      ...meta.animations,
    ]
    : [];

  useEffect(() => {
    if (!source) {
      setAvailableDirectories(null);
      return;
    }
    let live = true;
    source.getDirectories().then(
      (directories) => {
        if (live) setAvailableDirectories(new Set(directories));
      },
      (reason) => {
        if (!live) return;
        setAvailableDirectories(new Set());
        setError(t("spine.error.folder", { error: errorMessage(reason) }));
      },
    );
    return () => { live = false; };
  }, [source]);

  useEffect(() => {
    if (!source || !selectedDirectoryName || !availableDirectories?.has(selectedDirectoryName)) {
      setSetFiles(null);
      setSetLoading(false);
      return;
    }
    let live = true;
    setSetFiles(null);
    setSetLoading(true);
    setError(null);
    source.getSetFiles(selectedDirectoryName).then(
      (files) => {
        if (!live) return;
        setSetFiles(files);
        setSetLoading(false);
      },
      (reason) => {
        if (!live) return;
        setSetLoading(false);
        setError(t("spine.error.loadSet", { error: errorMessage(reason) }));
      },
    );
    return () => { live = false; };
  }, [availableDirectories, source, selectedDirectoryName]);

  useEffect(() => {
    if (!source || !availableDirectories) return;
    const nextCharacter = characterNames.find((name) => characterIndex.characters[name]?.some((variant) => availableDirectories.has(variant.directory)));
    const selectedIsLoaded = characterIndex.characters[selectedCharacter]?.some((variant) => availableDirectories.has(variant.directory));
    if (selectedIsLoaded) return;
    const nextVariant = nextCharacter ? characterIndex.characters[nextCharacter]?.find((variant) => availableDirectories.has(variant.directory)) : undefined;
    setSelectedCharacter(nextCharacter ?? "");
    setSelectedDirectory(nextVariant?.directory ?? "");
    setMeta(null);
    setError(null);
  }, [availableDirectories, selectedCharacter, source]);

  useEffect(() => {
    const onFullscreen = () => {
      const active = Boolean(document.fullscreenElement);
      setFullscreen(active);
      setShowFullscreenSidebar(!active);
      setShowFullscreenOptions(false);
      setShowFullscreenControls(true);
    };
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => document.removeEventListener("fullscreenchange", onFullscreen);
  }, []);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, select, textarea, [contenteditable]")) return;
      if (event.key.toLowerCase() === "h") {
        event.preventDefault();
        setShowFullscreenControls((shown) => !shown);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  const chooseFolder = async () => {
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
    if (!picker) {
      const input = inputRef.current;
      if (!input) return;
      input.value = "";
      input.click();
      return;
    }
    try {
      const handle = await picker.call(window);
      setSource(sourceFromDirectory(handle));
      setAvailableDirectories(null);
      setSetFiles(null);
      setMeta(null);
      setError(null);
    } catch (reason) {
      // A cancelled picker is a normal interaction, not an error state.
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError(t("spine.error.folder", { error: errorMessage(reason) }));
    }
  };

  const onInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (!event.currentTarget.files?.length) return;
    setSource(sourceFromInput(event.currentTarget.files));
    setAvailableDirectories(null);
    setSetFiles(null);
    setMeta(null);
    setError(null);
  };

  const selectCharacter = (name: string) => {
    const first = characterIndex.characters[name]?.find((variant) => !availableDirectories || availableDirectories.has(variant.directory));
    setSelectedCharacter(name);
    setSelectedDirectory(first?.directory ?? "");
    setMeta(null);
    setError(null);
  };

  const selectAnimation = (value: string) => {
    setAnimation(value);
    viewportRef.current?.setAnimation(value);
    setProgress((current) => ({ ...current, time: 0 }));
  };

  const selectInteractionMode = (value: SpineInteractionMode) => {
    if (value === interactionMode) return;
    if (value === "interaction") {
      freeCameraMode.current = cameraMode;
      freePlaying.current = playing;
      freeLoop.current = loop;
      freeSpeed.current = speed;
      setCameraMode("game");
      setPlaying(true);
      setLoop(true);
      setSpeed(1);
    } else {
      setCameraMode(freeCameraMode.current);
      setPlaying(freePlaying.current);
      setLoop(freeLoop.current);
      setSpeed(freeSpeed.current);
    }
    setInteractionMode(value);
    viewportRef.current?.setInteractionMode(value);
  };

  const interactionReady = interactionMode === "interaction"
    && Boolean(meta)
    && progress.animation !== null
    && (!(meta?.introAnimation && meta.idleAnimation) || progress.animation !== meta.introAnimation);

  const togglePlayback = () => setPlaying((value) => !value);

  const restartPlayback = () => {
    setPlaying(true);
    setProgress((current) => ({ ...current, time: 0 }));
    viewportRef.current?.restartPlayback();
  };

  return <main className="spine-page">
    <SiteNav active="spine" />
    <header className="spine-header">
      <div>
        <span className="spine-kicker">Shittim Chest / Spine 4.2</span>
        <h1>{t("spine.title")}</h1>
        <p>{t("spine.subtitle")}</p>
      </div>
      <div className="spine-header-tools"><LanguageSwitch /><ThemeSwitch /></div>
    </header>

    <section className={`spine-source${source ? " is-connected" : ""}`} aria-labelledby="spine-source-title">
      <div className="spine-source-copy">
        <h2 id="spine-source-title">{t("spine.source.heading")}</h2>
        <p>{source ? t("spine.source.ready") : t("spine.source.hint")}</p>
        <small>{t("spine.source.localOnly")}</small>
      </div>
      <div className="spine-source-action">
        <button className="btn ghost" type="button" onClick={chooseFolder}><span>{t(source ? "spine.source.change" : "spine.source.choose")}</span></button>
         <input ref={inputRef} type="file" multiple hidden onChange={onInputChange} />
      </div>
    </section>

    {error && <div className="alert spine-alert" role="alert">{error}</div>}

    <div className={`spine-layout${showFullscreenSidebar ? "" : " spine-sidebar-hidden"}`}>
      <aside id="spine-sidebar" className="spine-sidebar">
        <section className="spine-selector panel">
          <div className="phead"><span className="lead" />{t("spine.characters")}</div>
          <input
            className="search spine-character-search"
            value={characterSearch}
            onChange={(event) => setCharacterSearch(event.target.value)}
            placeholder={t("spine.characterSearch")}
            aria-label={t("spine.characterSearchAria")}
          />
          <div className="spine-character-count">{t("spine.characterCount", { n: filteredCharacters.length })}</div>
          <div className="spine-character-list" role="listbox" aria-label={t("spine.charactersAria")}>
            {filteredCharacters.map((name) => {
               const count = characterIndex.characters[name]?.filter((variant) => availableDirectories?.has(variant.directory)).length ?? 0;
              return <button
                key={name}
                type="button"
                role="option"
                aria-selected={name === selectedCharacter}
                className={name === selectedCharacter ? "is-selected" : undefined}
                onClick={() => selectCharacter(name)}
              >
                <span>{name}</span><small>{count}</small>
              </button>;
            })}
            {filteredCharacters.length === 0 && <p className="hint">{source && !availableDirectories ? t("spine.loading") : t("spine.noCharacters")}</p>}
          </div>
        </section>

        <section className="spine-selector panel">
          <div className="phead"><span className="lead" />{selectedCharacter}</div>
          <label className="spine-field">
            <span>{t("spine.variant")}</span>
            <select value={selectedDirectoryName} onChange={(event) => { setSelectedDirectory(event.target.value); setMeta(null); }} aria-label={t("spine.variantAria")}>
              {variants.map((variant) => <option key={variant.directory} value={variant.directory}>{variant.variant}</option>)}
            </select>
          </label>
          <details className="spine-set-meta"><summary>{t("spine.assetDetails")}</summary><div>
            <code>{selectedDirectoryName}</code>
            {selectedVariant?.assetId && <span>{selectedVariant.assetId}</span>}
          </div></details>
        </section>
      </aside>

      <section className={`spine-workspace${showFullscreenControls ? "" : " spine-controls-hidden"}`} aria-label={t("spine.viewerAria")}>
        <div className="spine-workspace-heading">
          <div><strong>{selectedCharacter}</strong><span>{selectedVariant?.variant}</span></div>
          <small>{t(meta ? "spine.preview.ready" : "spine.preview.waiting")}</small>
        </div>
        <div className="spine-stage-frame" onPointerDown={(event) => {
          stagePointer.current = { x: event.clientX, y: event.clientY };
        }} onPointerUp={(event) => {
          const start = stagePointer.current;
          stagePointer.current = null;
          if (fullscreen && interactionMode === "free" && start && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 5) {
            setShowFullscreenControls((shown) => !shown);
          }
        }} onPointerCancel={() => { stagePointer.current = null; }}>
          <SpineViewport
            ref={viewportRef}
            files={setFiles}
            directory={selectedDirectoryName}
            interactionProject={selectedInteractionProject}
            animation={animation}
            playing={playing}
            speed={speed}
            loop={loop}
            cameraMode={cameraMode}
            interactionMode={interactionMode}
            showInteractionPoints={showInteractionPoints}
            effectsStrength={effectsStrength}
            onMeta={(next) => {
              setMeta(next);
              setAnimation(next?.defaultAnimation ?? "");
              setCameraMode(interactionMode === "interaction" ? "game" : next?.hasGameCamera ? "game" : "fill");
              if (!next) setProgress({ time: 0, duration: 0, animation: null });
            }}
            onProgress={setProgress}
            onLoading={setRendererLoading}
            onError={(next) => setError(next ? t("spine.error.render", { error: next.message }) : null)}
            onCameraMode={(mode) => setCameraMode(interactionMode === "interaction" ? "game" : mode)}
          />
          {!source && <div className="spine-stage-empty"><strong>{t("spine.empty.heading")}</strong><span>{t("spine.empty.body")}</span></div>}
          {source && !setFiles && !error && <div className="spine-stage-empty"><strong>{isLoading ? t("spine.loading") : t("spine.empty.set")}</strong><span>{isLoading ? t("spine.loadingDetail") : selectedDirectoryName}</span></div>}
          {isLoading && setFiles && <div className="spine-loading" aria-live="polite">{t("spine.loading")}</div>}
          <div className="spine-stage-hint">{t(interactionMode === "interaction" ? "spine.interactionHint" : "spine.stageHint")}</div>
        </div>

        <div id="spine-playback-controls" className={`spine-controls${showFullscreenOptions ? " spine-options-open" : ""}`} aria-label={t("spine.controlsAria")}>
          <div className="spine-scrubber-row">
            <button className="spine-fullscreen-only spine-compact-button spine-character-button" type="button" aria-expanded={showFullscreenSidebar} aria-controls="spine-sidebar" onClick={() => setShowFullscreenSidebar((shown) => !shown)} title={t(showFullscreenSidebar ? "spine.sidebar.hide" : "spine.sidebar.show")}>
              {selectedCharacter || t("spine.characters")} <span>▾</span>
            </button>
            <button className="spine-icon-button" type="button" onClick={togglePlayback} disabled={!meta || interactionMode === "interaction"} aria-label={t(playing ? "spine.pause" : "spine.play")} title={t(playing ? "spine.pause" : "spine.play")}>
              {playing ? <IconPause /> : <IconPlay />}
            </button>
            <button className="spine-restart-button" type="button" disabled={!meta || interactionMode === "interaction"} onClick={restartPlayback} aria-label={t("spine.restart")} title={t("spine.restart")}><IconRotate /><span>{t("spine.restart")}</span></button>
            <input
              className="spine-scrubber"
              type="range"
              min="0"
              max={progress.duration || 0.01}
              step="0.01"
              value={Math.min(progress.time, progress.duration || 0.01)}
              disabled={!meta || interactionMode === "interaction"}
              onChange={(event) => viewportRef.current?.seek(Number(event.target.value))}
              aria-label={t("spine.scrubber")}
            />
            <span className="spine-time" aria-live="off">{formatSeconds(progress.time)} / {formatSeconds(progress.duration)}s</span>
            <button className="spine-fullscreen-only spine-compact-button spine-controls-toggle" type="button" aria-expanded={showFullscreenControls} aria-controls="spine-playback-controls" onClick={() => setShowFullscreenControls((shown) => !shown)}>
              {t(showFullscreenControls ? "spine.controls.hide" : "spine.controls.show")}
            </button>
            <button className="spine-fullscreen-only spine-compact-button" type="button" aria-expanded={showFullscreenOptions} aria-controls="spine-options" onClick={() => setShowFullscreenOptions((shown) => !shown)}>{t("spine.options")}</button>
            <button className="spine-fullscreen-only spine-compact-button" type="button" onClick={() => void viewportRef.current?.toggleFullscreen()} aria-label={t("a11y.fullscreenExit")} title={t("a11y.fullscreenExit")}><IconCompress /></button>
          </div>
          <div id="spine-options" className="spine-control-row">
            <label className="spine-field spine-mode-field">
              <span>{t("spine.mode")}</span>
              <select value={interactionMode} onChange={(event) => selectInteractionMode(event.target.value as SpineInteractionMode)} aria-label={t("spine.modeAria")}>
                <option value="free">{t("spine.mode.free")}</option>
                <option value="interaction">{t("spine.mode.interaction")}</option>
              </select>
            </label>
            <label className="spine-field spine-animation-field">
              <span>{t("spine.animation")}</span>
              <select value={animation} onChange={(event) => selectAnimation(event.target.value)} disabled={!meta || interactionMode === "interaction"} aria-label={t("spine.animationAria")}>
                {animationOptions.map((name) => <option key={name} value={name}>{name === INTRO_ANIMATION ? t("spine.introIdle") : name}</option>)}
              </select>
            </label>
            <label className="spine-field spine-camera-field">
              <span>{t("spine.camera")}</span>
              <select value={interactionMode === "interaction" ? "game" : cameraMode} onChange={(event) => setCameraMode(event.target.value as SpineCameraMode)} disabled={interactionMode === "interaction"} aria-label={t("spine.cameraAria")}>
                <option value="fill">{t("spine.camera.fill")}</option>
                <option value="fit">{t("spine.camera.fit")}</option>
                {(meta?.hasGameCamera || interactionMode === "interaction") && <option value="game">{t("spine.camera.game")}</option>}
              </select>
            </label>
            <label className="spine-field spine-speed-field">
              <span>{t("spine.speed")}</span>
              <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))} disabled={interactionMode === "interaction"} aria-label={t("spine.speedAria")}>
                {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => <option key={value} value={value}>{value}×</option>)}
              </select>
            </label>
            <label className="spine-check"><input type="checkbox" checked={loop} disabled={interactionMode === "interaction"} onChange={(event) => setLoop(event.target.checked)} />{t("spine.loop")}</label>
            <label className="spine-check"><input type="checkbox" checked={showInteractionPoints} onChange={(event) => setShowInteractionPoints(event.target.checked)} />{t("spine.showInteractionPoints")}</label>
            {interactionReady && meta?.interaction.talkCount ? <button className="btn ghost spine-action-button spine-interaction-action" type="button" onClick={() => viewportRef.current?.triggerTalk()} aria-label={t("spine.talkAria")}><span>{t("spine.talk")}</span><small>{meta.interaction.talkCount}</small></button> : null}
            <label className="spine-field spine-effects-field">
              <span>{t("spine.effects")}</span>
              <input type="range" min="0" max="1" step="0.05" value={effectsStrength} onChange={(event) => setEffectsStrength(Number(event.target.value))} aria-label={t("spine.effects")} title={t("spine.effects.hint")} />
              <output>{Math.round(effectsStrength * 100)}%</output>
            </label>
            <button className="btn ghost spine-action-button" type="button" disabled={interactionMode === "interaction"} onClick={() => viewportRef.current?.resetCamera()}><span>{t("spine.resetView")}</span></button>
            <button className="btn ghost spine-action-button" type="button" onClick={() => void viewportRef.current?.toggleFullscreen()} aria-label={t(fullscreen ? "a11y.fullscreenExit" : "a11y.fullscreenEnter")}>
              <span>{fullscreen ? <IconCompress /> : <IconExpand />} {t("spine.fullscreen")}</span>
            </button>
          </div>
        </div>
        <p className="spine-caption">{meta ? t("spine.loaded", { animations: meta.animations.length }) : t("spine.caption")}</p>
      </section>
    </div>
  </main>;
}
