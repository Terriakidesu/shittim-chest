import {
  AtlasAttachmentLoader,
  AnimationState,
  AnimationStateData,
  Bone,
  Physics,
  Skeleton,
  SkeletonBinary,
  TextureAtlas,
  Vector2,
} from "@esotericsoftware/spine-core";
import {
  GLTexture,
  ManagedWebGLRenderingContext,
  ResizeMode,
  SceneRenderer,
  Vector3,
} from "@esotericsoftware/spine-webgl";
import { authoredViewport, fitScene, interactionHit, sceneBounds, type SceneBounds } from "./spineCamera";
import { DEFAULT_EFFECTS_STRENGTH, drawWithEffectsStrength } from "./spineEffects";
import { findInteractionProfile, type SpineAnimationPair, type SpineInteractionProfile } from "./spineInteraction";

export const INTRO_ANIMATION = "__intro__";
export const EYE_FOLLOW_DELAY = 0.3;
const MAX_EYE_FOLLOW_RANGE = 64;
export type SpineCameraMode = "fit" | "fill" | "game";
export type SpineInteractionMode = "free" | "interaction";

export type SpineFiles = Map<string, File>;

export interface SpineMeta {
  animations: string[];
  defaultAnimation: string;
  introAnimation: string | null;
  idleAnimation: string | null;
  duration: number;
  hasGameCamera: boolean;
  interaction: SpineInteractionMeta;
}

export interface SpineProgress {
  time: number;
  duration: number;
  animation: string | null;
}

export interface SpineInteractionMeta {
  hasEyeFollow: boolean;
  canPat: boolean;
  talkCount: number;
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
  interaction: SpineInteractionProfile;
  eyeTarget: EyeTarget | null;
  touchTarget: InteractionTarget | null;
}

interface InteractionTarget {
  bone: Bone;
  baseX: number;
  baseY: number;
}

interface EyeTarget extends InteractionTarget {
  rangeX: number;
  rangeY: number;
}

type SpineInteractionState = "idle" | "look" | "lookRelease" | "pat" | "patRelease" | "talk";

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

function findEyeTarget(skeleton: Skeleton): Bone | null {
  const exact = ["Touch_Eye_Key", "Touch_Eye_key", "Touch_Eye"];
  for (const wanted of exact) {
    const found = skeleton.findBone(wanted);
    if (found) return found;
  }
  return skeleton.bones.find((bone) => /^touch[ _-]?eye(?:[ _-]?key)?$/i.test(bone.data.name)) ?? null;
}

function findTouchTarget(skeleton: Skeleton): Bone | null {
  const exact = ["Touch_Point_Key", "Touch_Point_key", "Touch_Point"];
  for (const wanted of exact) {
    const found = skeleton.findBone(wanted);
    if (found) return found;
  }
  return skeleton.bones.find((bone) => /^touch[ _-]?point(?:[ _-]?key)?$/i.test(bone.data.name)) ?? null;
}

function targetState(bone: Bone): InteractionTarget {
  return { bone, baseX: bone.x, baseY: bone.y };
}

function eyeTargetState(skeleton: Skeleton, touchTarget: InteractionTarget | null): EyeTarget | null {
  const bone = findEyeTarget(skeleton);
  if (!bone) return null;
  const distance = touchTarget ? Math.hypot(bone.worldX - touchTarget.bone.worldX, bone.worldY - touchTarget.bone.worldY) : MAX_EYE_FOLLOW_RANGE;
  const range = Math.max(24, Math.min(MAX_EYE_FOLLOW_RANGE, distance * 0.4));
  return { ...targetState(bone), rangeX: range, rangeY: range * 0.75 };
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
    const interaction = findInteractionProfile(animations);
    const defaultAnimation = introAnimation && idleAnimation ? INTRO_ANIMATION : idleAnimation ?? animations[0] ?? "";
    const meta: SpineMeta = {
      animations,
      defaultAnimation,
      introAnimation,
      idleAnimation,
      duration: 0,
      hasGameCamera: false,
      interaction: {
        hasEyeFollow: Boolean(findEyeTarget(skeleton)),
        canPat: Boolean(interaction.pat),
        talkCount: interaction.talks.length,
      },
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
    const touchTargetBone = findTouchTarget(skeleton);
    const touchTarget = touchTargetBone ? targetState(touchTargetBone) : null;
    const eyeTarget = eyeTargetState(skeleton, touchTarget);
    renderer.resize(ResizeMode.Expand);
    return { atlas, images, skeleton, state, meta, bounds, viewport, interaction, eyeTarget, touchTarget };
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
  private interactionMode: SpineInteractionMode = "free";
  private freeAnimationSelection = "";
  private freeCameraMode: SpineCameraMode = "fill";
  private interactionPointer: { x: number; y: number } | null = null;
  private pointerInside = false;
  private interactionState: SpineInteractionState = "idle";
  private interactionTrackName: string | null = null;
  private interactionReady = false;
  private eyeFollowHold = 0;
  private talkIndex = 0;
  private interactionFollowWorld: { x: number; y: number } | null = null;
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
      if (this.interactionMode === "interaction") this.enterInteraction();
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
    this.interactionPointer = null;
    this.pointerInside = false;
    this.interactionState = "idle";
    this.interactionTrackName = null;
    this.interactionReady = false;
    this.eyeFollowHold = 0;
    this.interactionFollowWorld = null;
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
    if (this.interactionMode === "interaction" && mode !== "game") return;
    if (this.cameraMode === mode) return;
    this.cameraMode = mode;
    this.pendingFit = true;
  }

  setInteractionMode(mode: SpineInteractionMode) {
    if (this.interactionMode === mode) {
      if (mode === "interaction" && this.cameraMode !== "game") {
        this.cameraMode = "game";
        this.pendingFit = true;
        this.callbacks.onCameraMode?.("game");
      }
      return;
    }

    this.interactionMode = mode;
    this.interactionPointer = null;
    this.pointerInside = false;
    this.interactionState = "idle";
    this.interactionTrackName = null;
    this.interactionReady = false;
    this.eyeFollowHold = 0;
    this.interactionFollowWorld = null;
    if (mode === "interaction") {
      this.freeAnimationSelection = this.animationSelection;
      this.freeCameraMode = this.cameraMode;
      this.cameraMode = "game";
      this.pendingFit = true;
      this.callbacks.onCameraMode?.("game");
      this.enterInteraction();
    } else {
      this.clearInteractionTracks();
      this.cameraMode = this.freeCameraMode;
      this.pendingFit = true;
      this.callbacks.onCameraMode?.(this.cameraMode);
      const selection = this.freeAnimationSelection || this.animationSelection;
      this.animationSelection = selection;
      this.applyBaseAnimation(selection, true);
    }
  }

  triggerTalk() {
    if (this.interactionMode !== "interaction" || this.interactionState !== "idle" || !this.interactionReady || !this.bundle || this.bundle.interaction.talks.length === 0) return;
    const pair = this.bundle.interaction.talks[this.talkIndex % this.bundle.interaction.talks.length]!;
    this.talkIndex = (this.talkIndex + 1) % this.bundle.interaction.talks.length;
    this.interactionState = "talk";
    this.interactionTrackName = pair.main;
    this.eyeFollowHold = 0;
    this.resetInteractionTargets();
    this.clearOverlay(3);
    this.clearOverlay(4);
    this.playOverlayPair(pair, 5, 6, false, true);
  }

  setAnimation(animation: string, restart = false) {
    if (!this.bundle || !animation || (!restart && animation === this.animationSelection)) return;
    if (this.interactionMode === "interaction") return;
    this.animationSelection = animation;
    this.applyBaseAnimation(animation, restart);
  }

  private applyBaseAnimation(animation: string, _restart = false) {
    const bundle = this.bundle;
    if (!bundle || !animation) return;
    const { skeleton, state, meta } = bundle;
    skeleton.setToSetupPose();
    state.clearTracks();
    if (animation === INTRO_ANIMATION && meta.introAnimation && meta.idleAnimation) {
      const intro = state.setAnimation(0, meta.introAnimation, false);
      state.addAnimation(0, meta.idleAnimation, this.interactionMode === "interaction" ? true : this.loop, 0);
      meta.duration = intro.animation?.duration ?? 0;
    } else {
      const entry = state.setAnimation(0, animation, this.interactionMode === "interaction" ? true : this.loop);
      meta.duration = entry.animation?.duration ?? 0;
    }
    state.apply(skeleton);
    skeleton.updateWorldTransform(Physics.update);
    if (bundle.eyeTarget) {
      bundle.eyeTarget.baseX = bundle.eyeTarget.bone.x;
      bundle.eyeTarget.baseY = bundle.eyeTarget.bone.y;
    }
    if (bundle.touchTarget) {
      bundle.touchTarget.baseX = bundle.touchTarget.bone.x;
      bundle.touchTarget.baseY = bundle.touchTarget.bone.y;
    }
    this.interactionFollowWorld = null;
  }

  private enterInteraction() {
    const bundle = this.bundle;
    if (!bundle) return;
    this.playing = true;
    this.interactionState = "idle";
    this.interactionTrackName = null;
    this.eyeFollowHold = 0;
    this.interactionFollowWorld = null;
    this.interactionReady = !(bundle.meta.introAnimation && bundle.meta.idleAnimation);
    const selection = bundle.meta.introAnimation && bundle.meta.idleAnimation ? INTRO_ANIMATION : bundle.meta.idleAnimation ?? bundle.meta.animations[0] ?? "";
    this.animationSelection = selection;
    this.applyBaseAnimation(selection, true);
  }

  private clearInteractionTracks() {
    const state = this.bundle?.state;
    if (!state) return;
    for (const track of [1, 2, 3, 4, 5, 6]) state.clearTrack(track);
    if (this.bundle) {
      state.apply(this.bundle.skeleton);
      this.bundle.skeleton.updateWorldTransform(Physics.update);
    }
  }

  private resetInteractionTargets() {
    const bundle = this.bundle;
    if (!bundle) return;
    for (const target of [bundle.eyeTarget, bundle.touchTarget]) {
      if (!target) continue;
      target.bone.x = target.baseX;
      target.bone.y = target.baseY;
    }
    this.interactionFollowWorld = null;
    bundle.skeleton.updateWorldTransform(Physics.pose);
  }

  private clearOverlay(track: number) {
    const state = this.bundle?.state;
    if (!state) return;
    state.clearTrack(track);
  }

  private playOverlayPair(pair: SpineAnimationPair, mainTrack: number, faceTrack: number, loop: boolean, clearAfter: boolean) {
    const bundle = this.bundle;
    if (!bundle) return;
    const main = bundle.state.setAnimation(mainTrack, pair.main, loop);
    if (clearAfter && !loop) bundle.state.addEmptyAnimation(mainTrack, 0, 0);
    if (pair.face) {
      bundle.state.setAnimation(faceTrack, pair.face, loop);
      if (clearAfter && !loop) bundle.state.addEmptyAnimation(faceTrack, 0, 0);
    } else {
      bundle.state.clearTrack(faceTrack);
    }
    // Keep the local variable meaningful for zero-duration authored poses.
    main.trackTime = Math.max(0, main.trackTime);
  }

  private beginLook() {
    const bundle = this.bundle;
    if (!bundle?.eyeTarget || this.interactionState !== "idle") return;
    const profile = bundle.interaction.look;
    this.interactionState = "look";
    this.interactionTrackName = profile?.start.main ?? null;
    if (profile) this.playOverlayPair(profile.start, 1, 2, false, false);
  }

  private endLook() {
    const bundle = this.bundle;
    if (!bundle || this.interactionState !== "look") return;
    this.resetInteractionTargets();
    const end = bundle.interaction.look?.end;
    if (end) {
      this.interactionState = "lookRelease";
      this.interactionTrackName = end.main;
      this.playOverlayPair(end, 1, 2, false, true);
    } else {
      this.clearOverlay(1);
      this.clearOverlay(2);
      this.interactionState = "idle";
      this.interactionTrackName = null;
    }
  }

  private beginPat(): boolean {
    const bundle = this.bundle;
    const pat = bundle?.interaction.pat;
    if ((!pat && !bundle?.touchTarget) || this.interactionState !== "idle") return false;
    this.interactionState = "pat";
    this.interactionTrackName = pat?.hold.main ?? null;
    this.eyeFollowHold = 0;
    if (pat) {
      this.clearOverlay(5);
      this.clearOverlay(6);
      this.playOverlayPair(pat.hold, 3, 4, false, false);
    }
    return true;
  }

  private endPat() {
    const bundle = this.bundle;
    if (!bundle || this.interactionState !== "pat") return;
    this.resetInteractionTargets();
    const release = bundle.interaction.pat?.release;
    if (release) {
      this.interactionState = "patRelease";
      this.interactionTrackName = release.main;
      this.playOverlayPair(release, 3, 4, false, true);
    } else {
      this.clearOverlay(3);
      this.clearOverlay(4);
      this.interactionState = "idle";
      this.interactionTrackName = null;
    }
  }

  private finishInteractionState() {
    const bundle = this.bundle;
    if (!bundle || !this.interactionTrackName) return;
    const track = this.interactionState === "lookRelease" ? 1 : this.interactionState === "patRelease" ? 3 : this.interactionState === "talk" ? 5 : -1;
    if (track < 0) return;
    const current = bundle.state.getCurrent(track);
    if (current?.animation?.name === this.interactionTrackName) return;
    this.interactionState = "idle";
    this.interactionTrackName = null;
    this.eyeFollowHold = 0;
    this.resetInteractionTargets();
  }

  restartPlayback() {
    if (!this.bundle) return;
    this.playing = true;
    if (this.interactionMode === "interaction") this.enterInteraction();
    else this.setAnimation(this.animationSelection, true);
  }

  replayIntro() {
    if (this.interactionMode === "interaction") {
      this.enterInteraction();
      return;
    }
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
    if (bundle.eyeTarget) {
      bundle.eyeTarget.baseX = bundle.eyeTarget.bone.x;
      bundle.eyeTarget.baseY = bundle.eyeTarget.bone.y;
    }
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
        if (this.interactionMode === "interaction") {
          const wasInteractionReady = this.interactionReady;
          const entry = bundle.state.getCurrent(0);
          if (!(bundle.meta.introAnimation && bundle.meta.idleAnimation) || entry?.animation?.name !== bundle.meta.introAnimation) this.interactionReady = true;
          if (!wasInteractionReady && this.interactionReady) this.eyeFollowHold = 0;
          this.finishInteractionState();
          if (this.interactionReady) {
            if (this.interactionState === "idle" && this.interactionPointer) {
              this.eyeFollowHold = Math.min(EYE_FOLLOW_DELAY, this.eyeFollowHold + delta);
              if (this.eyeFollowHold >= EYE_FOLLOW_DELAY) {
                this.beginLook();
              }
            } else if (this.interactionState === "look") {
              this.applyEyeFollow(delta);
            } else if (this.interactionState === "pat") {
              this.applyTouchFollow(delta);
            } else if (this.interactionState === "idle") {
              this.eyeFollowHold = 0;
            }
          }
        }
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
    this.canvas.addEventListener("pointerenter", this.onPointerEnter);
    this.canvas.addEventListener("pointerleave", this.onPointerLeave);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
  }

  private unbindCameraControls() {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("pointerenter", this.onPointerEnter);
    this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
    this.canvas.removeEventListener("wheel", this.onWheel);
  }

  private onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    if (this.interactionMode === "interaction") {
      this.pointerInside = true;
      this.updateInteractionPointer(event);
      if (!this.interactionReady) return;
      if (this.interactionState !== "idle") return;
      if (this.isInteractionHit(event) && this.beginPat()) this.canvas.setPointerCapture(event.pointerId);
      return;
    }
    this.useManualCamera();
    this.dragging = true;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
    this.canvas.setPointerCapture(event.pointerId);
  };

  private onPointerMove = (event: PointerEvent) => {
    if (this.interactionMode === "interaction") {
      this.pointerInside = true;
      this.updateInteractionPointer(event);
      return;
    }
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
    if (this.interactionMode === "interaction") {
      const rect = this.canvas.getBoundingClientRect();
      this.pointerInside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
      if (!this.pointerInside) this.interactionPointer = null;
      this.endPat();
      if (!this.pointerInside) this.endLook();
      if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
      return;
    }
    this.dragging = false;
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
  };

  private onPointerEnter = (event: PointerEvent) => {
    if (this.interactionMode !== "interaction") return;
    this.pointerInside = true;
    this.updateInteractionPointer(event);
  };

  private onPointerLeave = (event: PointerEvent) => {
    if (this.interactionMode !== "interaction") return;
    this.pointerInside = false;
    this.interactionPointer = null;
    this.eyeFollowHold = 0;
    if (!this.canvas.hasPointerCapture(event.pointerId)) this.endLook();
  };

  private updateInteractionPointer(event: PointerEvent) {
    if (!this.bundle) return;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const world = this.pointerWorldFromEvent(event);
    const wasOverCharacter = Boolean(this.interactionPointer);
    this.interactionPointer = world && interactionHit(this.bundle.skeleton, world.x, world.y) ? {
      x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
    } : null;
    if (!this.interactionReady) {
      this.eyeFollowHold = 0;
      return;
    }
    if (!this.interactionPointer) {
      this.eyeFollowHold = 0;
      this.endLook();
    } else if (!wasOverCharacter) {
      this.eyeFollowHold = 0;
    }
  }

  private pointerWorld(): Vector3 | null {
    const pointer = this.interactionPointer;
    const rect = this.canvas.getBoundingClientRect();
    if (!pointer || rect.width <= 0 || rect.height <= 0 || this.canvas.width <= 0 || this.canvas.height <= 0) return null;
    const dprX = this.canvas.width / rect.width;
    const dprY = this.canvas.height / rect.height;
    return this.renderer.camera.screenToWorld(new Vector3(pointer.x * dprX, pointer.y * dprY, 0), this.canvas.width, this.canvas.height);
  }

  private isInteractionHit(event: PointerEvent): boolean {
    const bundle = this.bundle;
    if (!bundle) return false;
    const point = this.pointerWorldFromEvent(event);
    if (!point) return false;
    return interactionHit(bundle.skeleton, point.x, point.y);
  }

  private pointerWorldFromEvent(event: PointerEvent): Vector3 | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || this.canvas.width <= 0 || this.canvas.height <= 0) return null;
    const dprX = this.canvas.width / rect.width;
    const dprY = this.canvas.height / rect.height;
    return this.renderer.camera.screenToWorld(new Vector3(
      (event.clientX - rect.left) * dprX,
      (event.clientY - rect.top) * dprY,
      0,
    ), this.canvas.width, this.canvas.height);
  }

  private applyEyeFollow(delta: number) {
    const bundle = this.bundle;
    const eyeTarget = bundle?.eyeTarget;
    if (!bundle || !eyeTarget) return;
    const base = eyeTarget.bone.parent
      ? eyeTarget.bone.parent.localToWorld(new Vector2(eyeTarget.baseX, eyeTarget.baseY))
      : new Vector2(eyeTarget.baseX + bundle.skeleton.x, eyeTarget.baseY + bundle.skeleton.y);
    const pointer = this.pointerWorld();
    const desired = pointer
      ? {
        x: base.x + Math.max(-eyeTarget.rangeX, Math.min(eyeTarget.rangeX, pointer.x - base.x)),
        y: base.y + Math.max(-eyeTarget.rangeY, Math.min(eyeTarget.rangeY, pointer.y - base.y)),
      }
      : base;
    const current = this.interactionFollowWorld ?? { x: eyeTarget.bone.worldX, y: eyeTarget.bone.worldY };
    const amount = Math.min(1, Math.max(0.08, delta * (pointer ? 14 : 10)));
    current.x += (desired.x - current.x) * amount;
    current.y += (desired.y - current.y) * amount;
    this.interactionFollowWorld = current;
    const local = eyeTarget.bone.parent
      ? eyeTarget.bone.parent.worldToLocal(new Vector2(current.x, current.y))
      : new Vector2(current.x - bundle.skeleton.x, current.y - bundle.skeleton.y);
    eyeTarget.bone.x = local.x;
    eyeTarget.bone.y = local.y;
    // The authored Touch_Eye constraints consume the target bone during the
    // world-transform pass. Re-run that pass after moving the target so the
    // eyes, brows and Touch_Point followers respond in the same frame.
    bundle.skeleton.updateWorldTransform(Physics.pose);
  }

  private applyTouchFollow(delta: number) {
    const bundle = this.bundle;
    const touchTarget = bundle?.touchTarget;
    if (!bundle || !touchTarget) return;
    const base = touchTarget.bone.parent
      ? touchTarget.bone.parent.localToWorld(new Vector2(touchTarget.baseX, touchTarget.baseY))
      : new Vector2(touchTarget.baseX + bundle.skeleton.x, touchTarget.baseY + bundle.skeleton.y);
    const pointer = this.pointerWorld() ?? base;
    const amount = Math.min(1, Math.max(0.12, delta * 18));
    const current = this.interactionFollowWorld ?? { x: touchTarget.bone.worldX, y: touchTarget.bone.worldY };
    current.x += (pointer.x - current.x) * amount;
    current.y += (pointer.y - current.y) * amount;
    this.interactionFollowWorld = current;
    const local = touchTarget.bone.parent
      ? touchTarget.bone.parent.worldToLocal(new Vector2(current.x, current.y))
      : new Vector2(current.x - bundle.skeleton.x, current.y - bundle.skeleton.y);
    touchTarget.bone.x = local.x;
    touchTarget.bone.y = local.y;
    bundle.skeleton.updateWorldTransform(Physics.pose);
  }

  private onWheel = (event: WheelEvent) => {
    if (!this.bundle) return;
    event.preventDefault();
    if (this.interactionMode === "interaction") return;
    this.useManualCamera();
    const camera = this.renderer.camera;
    camera.zoom = Math.max(0.02, Math.min(50, camera.zoom * Math.exp(event.deltaY * 0.001)));
    camera.update();
  };

  private useManualCamera() {
    if (this.interactionMode === "interaction") return;
    if (this.cameraMode !== "game") return;
    this.cameraMode = "fit";
    this.callbacks.onCameraMode?.("fit");
  }
}
