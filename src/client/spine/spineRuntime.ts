import {
  AtlasAttachmentLoader,
  AnimationState,
  AnimationStateData,
  Physics,
  Skeleton,
  SkeletonBinary,
  TextureAtlas,
} from "@esotericsoftware/spine-core";
import {
  GLTexture,
  ManagedWebGLRenderingContext,
  ResizeMode,
  SceneRenderer,
} from "@esotericsoftware/spine-webgl";
import { authoredViewport, fitScene, sceneBounds, type SceneBounds } from "./spineCamera";
import { DEFAULT_EFFECTS_STRENGTH, drawWithEffectsStrength } from "./spineEffects";

export const INTRO_ANIMATION = "__intro__";
export type SpineCameraMode = "fit" | "fill" | "game";

export type SpineFiles = Map<string, File>;

export interface SpineMeta {
  animations: string[];
  defaultAnimation: string;
  introAnimation: string | null;
  idleAnimation: string | null;
  duration: number;
  hasGameCamera: boolean;
}

export interface SpineProgress {
  time: number;
  duration: number;
  animation: string | null;
}

export interface SpineRendererCallbacks {
  onMeta: (meta: SpineMeta | null) => void;
  onProgress: (progress: SpineProgress) => void;
  onLoading: (loading: boolean) => void;
  onError: (error: Error | null) => void;
  onCameraMode?: (mode: SpineCameraMode) => void;
}

interface LoadedBundle {
  atlas: TextureAtlas;
  images: Array<HTMLImageElement | ImageBitmap>;
  skeleton: Skeleton;
  state: AnimationState;
  meta: SpineMeta;
  bounds: SceneBounds;
  viewport: SceneBounds;
}

interface CameraPose {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
}

function basename(path: string): string {
  return path.replaceAll("\\", "/").split("/").pop() ?? path;
}

function fileNamed(files: SpineFiles, wanted: string): File | undefined {
  const target = basename(wanted).toLowerCase();
  for (const [path, file] of files) {
    if (basename(path).toLowerCase() === target) return file;
  }
  return undefined;
}

function filesWithExtension(files: SpineFiles, extension: string): File[] {
  return [...files.entries()]
    .filter(([path]) => basename(path).toLowerCase().endsWith(extension))
    .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .map(([, file]) => file);
}

function errorFrom(value: unknown): Error {
  if (value instanceof Error) return value;
  return new Error(typeof value === "string" ? value : "Could not load the Spine asset.");
}

/** Pick the authored opening animation without relying on one exact suffix. */
export function findIntroAnimation(animations: string[]): string | null {
  return animations.find((name) => /^start[_ -]?idle(?:[_ -]?(?:0?1))?$/i.test(name)) ?? null;
}

/** Prefer the normal idle, then accommodate older/variant lobby exports. */
export function findIdleAnimation(animations: string[]): string | null {
  for (const preferred of ["Idle_01", "Idle", "Idle_1"]) {
    const found = animations.find((name) => name === preferred);
    if (found) return found;
  }
  return animations.find((name) => /^idle(?:[_ -].*)?$/i.test(name)) ?? null;
}

async function loadImage(file: File): Promise<HTMLImageElement | ImageBitmap> {
  if (typeof createImageBitmap === "function") {
    // Normalize the atlas pages to premultiplied alpha before WebGL sees
    // them. The Spine PMA path is required by screen/additive VFX slots;
    // mixing straight pixels with that path creates white or hard-edged
    // rectangles around otherwise transparent effects.
    return createImageBitmap(file, { premultiplyAlpha: "premultiply", colorSpaceConversion: "none" });
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function closeImage(image: HTMLImageElement | ImageBitmap) {
  if ("close" in image && typeof image.close === "function") image.close();
}

function disposeBundle(bundle: LoadedBundle) {
  bundle.atlas.dispose();
  for (const image of bundle.images) closeImage(image);
}

function findPreferredSkeleton(files: File[], directoryName: string): File[] {
  const wanted = `${directoryName}.skel`.toLowerCase();
  return [...files].sort((a, b) => {
    const aName = a.name.toLowerCase();
    const bName = b.name.toLowerCase();
    const aPreferred = aName === wanted || aName === `${directoryName.replace(/_home$/i, "")}_home.skel`.toLowerCase();
    const bPreferred = bName === wanted || bName === `${directoryName.replace(/_home$/i, "")}_home.skel`.toLowerCase();
    return Number(bPreferred) - Number(aPreferred) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

async function readSkeleton(
  files: SpineFiles,
  atlas: TextureAtlas,
  directoryName: string,
): Promise<{ skeleton: Skeleton; animations: string[] }> {
  const candidates = findPreferredSkeleton(filesWithExtension(files, ".skel"), directoryName);
  if (candidates.length === 0) throw new Error("This set does not contain a .skel file.");

  const loader = new SkeletonBinary(new AtlasAttachmentLoader(atlas));
  const failures: string[] = [];
  let fallback: { skeleton: Skeleton; animations: string[] } | null = null;

  for (const file of candidates) {
    try {
      const data = loader.readSkeletonData(await file.arrayBuffer());
      const animations = data.animations.map((animation) => animation.name);
      const parsed = { skeleton: new Skeleton(data), animations };
      // Lobby sets can carry a second scene/background skeleton. The lobby
      // skeleton is the one with Idle_01 or the intro-to-idle animation.
       if (findIdleAnimation(animations) || findIntroAnimation(animations)) return parsed;
      fallback ??= parsed;
    } catch (error) {
      failures.push(`${file.name}: ${errorFrom(error).message}`);
    }
  }

  if (fallback) return fallback;
  throw new Error(`No usable lobby skeleton was found. ${failures.join(" ")}`);
}

async function loadBundle(files: SpineFiles, directoryName: string, renderer: SceneRenderer, context: ManagedWebGLRenderingContext): Promise<LoadedBundle> {
  const atlasFile = filesWithExtension(files, ".atlas")[0];
  if (!atlasFile) throw new Error("This set does not contain an .atlas file.");

  const atlas = new TextureAtlas(await atlasFile.text());
  const images: Array<HTMLImageElement | ImageBitmap> = [];
  try {
    for (const page of atlas.pages) {
      const imageFile = fileNamed(files, page.name);
      if (!imageFile) throw new Error(`The atlas page “${page.name}” is missing.`);
      const image = await loadImage(imageFile);
      // ImageBitmap was premultiplied during decode. The fallback HTML
      // image is still straight-alpha, so ask WebGL to normalize that path
      // before uploading it as well.
      const imageIsBitmap = typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap;
      context.gl.pixelStorei(context.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !imageIsBitmap);
      const texture = new GLTexture(context, image);
      texture.setFilters(page.minFilter, page.magFilter);
      texture.setWraps(page.uWrap, page.vWrap);
      page.setTexture(texture);
      images.push(image);
    }

    const { skeleton, animations } = await readSkeleton(files, atlas, directoryName);
    skeleton.setToSetupPose();
    skeleton.updateWorldTransform(Physics.update);
    // A bone named "camera" in these exports is usually an animated art/layer
    // parent, not a Unity Camera component. Keep setup pose as the fixed
    // authored viewport anchor while the animation moves the artwork through it.
    const setupSkeleton = new Skeleton(skeleton.data);
    setupSkeleton.setToSetupPose();
    setupSkeleton.updateWorldTransform(Physics.update);
    const stateData = new AnimationStateData(skeleton.data);
    // Draw-order timelines are discrete. Mixing intro and idle poses can
    // leave slots visually interleaved for a few frames, so switch between
    // lobby animations without a cross-fade.
    stateData.defaultMix = 0;
    const state = new AnimationState(stateData);
    const introAnimation = findIntroAnimation(animations);
    const idleAnimation = findIdleAnimation(animations);
    const defaultAnimation = introAnimation && idleAnimation ? INTRO_ANIMATION : idleAnimation ?? animations[0] ?? "";
    const meta: SpineMeta = {
      animations,
      defaultAnimation,
      introAnimation,
      idleAnimation,
      duration: 0,
      hasGameCamera: false,
    };

    // Start in the same pose the game uses when opening a lobby card.
    if (defaultAnimation === INTRO_ANIMATION) {
      const intro = state.setAnimation(0, introAnimation!, false);
      state.addAnimation(0, idleAnimation!, true, 0);
      meta.duration = intro.animation?.duration ?? 0;
    } else if (defaultAnimation) {
      const entry = state.setAnimation(0, defaultAnimation, true);
      meta.duration = entry.animation?.duration ?? 0;
    }
    // Use an independent idle pose for framing: the intro can begin zoomed
    // out, with invisible attachments or artwork outside the final scene.
    const framingSkeleton = new Skeleton(skeleton.data);
    const framingState = new AnimationState(stateData);
    const framingAnimation = idleAnimation ?? animations[0];
    if (framingAnimation) {
      framingState.setAnimation(0, framingAnimation, false);
      framingState.apply(framingSkeleton);
    }
    framingSkeleton.updateWorldTransform(Physics.update);
    const bounds = sceneBounds(framingSkeleton);
    const viewport = authoredViewport(framingSkeleton, setupSkeleton);
    meta.hasGameCamera = viewport.authored;
    state.apply(skeleton);
    skeleton.updateWorldTransform(Physics.update);
    renderer.resize(ResizeMode.Expand);
    return { atlas, images, skeleton, state, meta, bounds, viewport };
  } catch (error) {
    atlas.dispose();
    for (const image of images) closeImage(image);
    throw error;
  }
}

export class SpineRenderer {
  private readonly context: ManagedWebGLRenderingContext;
  private readonly renderer: SceneRenderer;
  private readonly canvas: HTMLCanvasElement;
  private readonly callbacks: SpineRendererCallbacks;
  private bundle: LoadedBundle | null = null;
  private animationSelection = "";
  private playing = true;
  private loop = true;
  private speed = 1;
  private effectsStrength = DEFAULT_EFFECTS_STRENGTH;
  private cameraMode: SpineCameraMode = "fill";
  private fitCameraPose: CameraPose | null = null;
  private pendingFit = false;
  private raf = 0;
  private previousFrame = 0;
  private loadSerial = 0;
  private destroyed = false;
  private dragging = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private readonly resizeObserver: ResizeObserver;

  constructor(canvas: HTMLCanvasElement, callbacks: SpineRendererCallbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.context = new ManagedWebGLRenderingContext(canvas, {
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
    });
    this.renderer = new SceneRenderer(canvas, this.context, true);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.bindCameraControls();
    this.raf = requestAnimationFrame(this.render);
  }

  async load(files: SpineFiles, directoryName: string) {
    const serial = ++this.loadSerial;
    this.disposeBundle();
    this.fitCameraPose = null;
    this.callbacks.onMeta(null);
    this.callbacks.onError(null);
    this.callbacks.onLoading(true);
    this.animationSelection = "";

    try {
      const bundle = await loadBundle(files, directoryName, this.renderer, this.context);
      if (serial !== this.loadSerial || this.destroyed) {
        disposeBundle(bundle);
        return;
      }
      this.bundle = bundle;
      const initialEntry = bundle.state.getCurrent(0);
      if (initialEntry) {
        if (initialEntry.animation?.name !== bundle.meta.introAnimation) initialEntry.loop = this.loop;
        if (initialEntry.next) initialEntry.next.loop = this.loop;
      }
      this.animationSelection = bundle.meta.defaultAnimation;
      this.pendingFit = true;
      this.callbacks.onMeta(bundle.meta);
      this.callbacks.onLoading(false);
    } catch (error) {
      if (serial !== this.loadSerial || this.destroyed) return;
      this.callbacks.onLoading(false);
      this.callbacks.onError(errorFrom(error));
    }
  }

  clear() {
    ++this.loadSerial;
    this.disposeBundle();
    this.fitCameraPose = null;
    this.callbacks.onMeta(null);
    this.callbacks.onProgress({ time: 0, duration: 0, animation: null });
    this.callbacks.onLoading(false);
  }

  setPlaying(playing: boolean) {
    this.playing = playing;
  }

  setSpeed(speed: number) {
    this.speed = Math.max(0.1, Math.min(3, speed));
  }

  setEffectsStrength(strength: number) {
    this.effectsStrength = Number.isFinite(strength) ? Math.max(0, Math.min(1, strength)) : DEFAULT_EFFECTS_STRENGTH;
  }

  setLoop(loop: boolean) {
    this.loop = loop;
    const entry = this.bundle?.state.getCurrent(0);
    if (entry) {
       if (entry.animation?.name !== this.bundle?.meta.introAnimation) entry.loop = loop;
      if (entry.next) entry.next.loop = loop;
    }
  }

  setCameraMode(mode: SpineCameraMode) {
    if (this.cameraMode === mode) return;
    this.cameraMode = mode;
    this.pendingFit = true;
  }

  setAnimation(animation: string, restart = false) {
    if (!this.bundle || !animation || (!restart && animation === this.animationSelection)) return;
    this.animationSelection = animation;
    const { skeleton, state, meta } = this.bundle;
    skeleton.setToSetupPose();
    state.clearTracks();
    if (animation === INTRO_ANIMATION && meta.introAnimation && meta.idleAnimation) {
      state.setAnimation(0, meta.introAnimation, false);
      state.addAnimation(0, meta.idleAnimation, this.loop, 0);
    } else {
      state.setAnimation(0, animation, this.loop);
    }
    state.apply(skeleton);
    skeleton.updateWorldTransform(Physics.update);
  }

  restartPlayback() {
    if (!this.bundle) return;
    this.playing = true;
    this.setAnimation(this.animationSelection, true);
  }

  replayIntro() {
    const bundle = this.bundle;
    const introAnimation = bundle?.meta.introAnimation;
    const idleAnimation = bundle?.meta.idleAnimation;
    if (!bundle || !introAnimation || !idleAnimation) return;
    this.playing = true;
    this.animationSelection = INTRO_ANIMATION;
    const { skeleton, state } = bundle;
    skeleton.setToSetupPose();
    state.clearTracks();
    state.setAnimation(0, introAnimation, false);
    state.addAnimation(0, idleAnimation, this.loop, 0);
    state.apply(skeleton);
    skeleton.updateWorldTransform(Physics.update);
    this.pendingFit = true;
  }

  seek(time: number) {
    const entry = this.bundle?.state.getCurrent(0);
    if (!entry) return;
    entry.trackTime = Math.max(0, Math.min(entry.animation?.duration ?? 0, time));
    entry.trackLast = -1;
  }

  resetCamera() {
    this.pendingFit = true;
  }

  async toggleFullscreen(element: HTMLElement) {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else if (element.requestFullscreen) {
      await element.requestFullscreen();
    }
  }

  dispose() {
    this.destroyed = true;
    ++this.loadSerial;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.unbindCameraControls();
    this.disposeBundle();
    this.renderer.dispose();
    this.context.dispose();
  }

  private disposeBundle() {
    if (!this.bundle) return;
    disposeBundle(this.bundle);
    this.bundle = null;
  }

  private resize() {
    if (this.destroyed) return;
    const oldWidth = this.renderer.camera.viewportWidth;
    const oldHeight = this.renderer.camera.viewportHeight;
    const oldFit = this.fitCameraPose;
    const camera = this.renderer.camera;
    const oldZoom = camera.zoom;
    const offsetX = oldFit ? camera.position.x - oldFit.x : 0;
    const offsetY = oldFit ? camera.position.y - oldFit.y : 0;
    this.renderer.resize(ResizeMode.Expand);
    const resized = oldWidth !== camera.viewportWidth || oldHeight !== camera.viewportHeight;
    if (this.bundle && (this.pendingFit || resized) && this.canvas.width > 0 && this.canvas.height > 0) {
      const preserveManual = resized && !this.pendingFit && oldFit && this.cameraMode !== "game";
      this.fitCamera();
      if (preserveManual && this.fitCameraPose) {
        const oldBaseZoom = Math.max(oldFit.scaleX, oldFit.scaleY);
        camera.zoom *= oldZoom / oldBaseZoom;
        camera.position.x += offsetX;
        camera.position.y += offsetY;
        camera.update();
      }
      this.pendingFit = false;
    }
  }

  private fitCamera() {
    const bundle = this.bundle;
    if (!bundle || this.renderer.camera.viewportWidth <= 0 || this.renderer.camera.viewportHeight <= 0) return;
    const camera = this.renderer.camera;
    const bounds = this.cameraMode === "game" ? bundle.viewport : bundle.bounds;
    const fit = fitScene(bounds, camera.viewportWidth, camera.viewportHeight, this.cameraMode !== "fit");
    this.fitCameraPose = {
      x: fit.x,
      y: fit.y,
      scaleX: fit.zoom,
      scaleY: fit.zoom,
    };
    camera.position.x = this.fitCameraPose.x;
    camera.position.y = this.fitCameraPose.y;
    camera.zoom = Math.max(this.fitCameraPose.scaleX, this.fitCameraPose.scaleY);
    camera.update();
  }

  private render = (now: number) => {
    if (this.destroyed) return;
    const delta = this.previousFrame ? Math.min((now - this.previousFrame) / 1000, 0.1) : 0;
    this.previousFrame = now;

    try {
      this.resize();
      const bundle = this.bundle;
      if (bundle) {
        if (this.playing) bundle.state.update(delta * this.speed);
        bundle.state.apply(bundle.skeleton);
        bundle.skeleton.updateWorldTransform(Physics.update);
      }

      const gl = this.context.gl;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (bundle) {
        this.renderer.begin();
        // Match the premultiplied atlas pixels and preserve Spine slot blend
        // modes, including the VFX layers used by lobby animations.
        drawWithEffectsStrength(bundle.skeleton, this.effectsStrength, () => this.renderer.drawSkeleton(bundle.skeleton, true));
        this.renderer.end();
        const entry = bundle.state.getCurrent(0);
        const duration = entry?.animation?.duration ?? bundle.meta.duration;
        this.callbacks.onProgress({
          time: Math.min(entry?.trackTime ?? 0, duration),
          duration,
          animation: entry?.animation?.name ?? null,
        });
      }
    } catch (error) {
      // A malformed local asset should report an error instead of throwing from
      // requestAnimationFrame and taking down the whole React root.
      this.callbacks.onError(errorFrom(error));
      this.disposeBundle();
      this.callbacks.onMeta(null);
      this.callbacks.onProgress({ time: 0, duration: 0, animation: null });
    }

    this.raf = requestAnimationFrame(this.render);
  };

  private bindCameraControls() {
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerUp);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
  }

  private unbindCameraControls() {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
  }

  private onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    this.useManualCamera();
    this.dragging = true;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
    this.canvas.setPointerCapture(event.pointerId);
  };

  private onPointerMove = (event: PointerEvent) => {
    if (!this.dragging || !this.bundle) return;
    const dx = event.clientX - this.lastPointerX;
    const dy = event.clientY - this.lastPointerY;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = rect.width > 0 ? this.canvas.width / rect.width : 1;
    const unitsPerPixel = this.renderer.camera.zoom * dpr;
    this.renderer.camera.position.x -= dx * unitsPerPixel;
    this.renderer.camera.position.y += dy * unitsPerPixel;
    this.renderer.camera.update();
  };

  private onPointerUp = (event: PointerEvent) => {
    this.dragging = false;
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
  };

  private onWheel = (event: WheelEvent) => {
    if (!this.bundle) return;
    event.preventDefault();
    this.useManualCamera();
    const camera = this.renderer.camera;
    camera.zoom = Math.max(0.02, Math.min(50, camera.zoom * Math.exp(event.deltaY * 0.001)));
    camera.update();
  };

  private useManualCamera() {
    if (this.cameraMode !== "game") return;
    this.cameraMode = "fit";
    this.callbacks.onCameraMode?.("fit");
  }
}
