import { Physics, Vector2, type Bone, type Skeleton } from "@esotericsoftware/spine-core";
import { cheekControlNames } from "./spinePinch";
import type { SpineInteractionKind } from "./spineInteraction";

export interface SpineMotionInteraction {
  startAnimation: string;
  followTargetBone: string | null;
  sensitivity: number;
  limitX: number;
  limitY: number;
  smoothing: number;
  /** Local parent-space translation axes. Missing legacy fields mean both. */
  allowX?: boolean;
  allowY?: boolean;
  rotationEnabled?: boolean;
  rotationAxis?: "x" | "y";
  rotationMin?: number;
  rotationMax?: number;
}

export interface SpineMotionPoint {
  x: number;
  y: number;
}

interface MotionTarget {
  bone: Bone;
  directCheek: boolean;
  legacyCheek: boolean;
  baseX: number;
  baseY: number;
  baseRotation: number;
  restoreX: number;
  restoreY: number;
  restoreRotation: number;
  constraints: Array<{ constraint: Skeleton["transformConstraints"][number]; mixX: number; mixY: number }>;
}

export interface SpineInteractionMotionState {
  interaction: SpineMotionInteraction | null;
  kind: SpineInteractionKind | null;
  origin: SpineMotionPoint | null;
  offset: SpineMotionPoint;
  target: MotionTarget | null;
  resolvedTargetBonePath: string | null;
  rotation: number;
}

const DEFAULT_SENSITIVITY = 0.25;
const DEFAULT_SMOOTHING = 8;
const DEFAULT_LIMIT_X = 90;
const DEFAULT_LIMIT_Y = 65;

function bonePath(bone: Bone): string {
  const names: string[] = [];
  for (let current: Bone | null = bone; current; current = current.parent) names.unshift(current.data.name);
  return names.join("/");
}

function findBonePath(skeleton: Skeleton, path: string | null): Bone | null {
  if (!path) return null;
  return skeleton.bones.find((bone) => bonePath(bone) === path) ?? null;
}

function cheekBones(skeleton: Skeleton): Bone[] {
  const names = cheekControlNames(skeleton.bones.map((bone) => ({ name: bone.data.name, parentName: bone.parent?.data.name ?? null })));
  return names.map((name) => skeleton.findBone(name)).filter((bone): bone is Bone => Boolean(bone));
}

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function finiteSigned(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Keep headpat motion from pulling beyond the next rig bone's local Y range. */
function limitHeadpatLocalY(target: Bone, world: Vector2, limitY: number): Vector2 {
  if (target.children.length === 0) return world;
  const next = target.children[0]!;
  const origin = next.localToWorld(new Vector2(0, 0));
  const local = next.worldToLocal(new Vector2(origin.x + world.x, origin.y + world.y));
  const constrainedY = Math.max(-limitY, Math.min(limitY, local.y));
  if (constrainedY === local.y) return world;
  const constrained = next.localToWorld(new Vector2(local.x, constrainedY));
  return new Vector2(constrained.x - origin.x, constrained.y - origin.y);
}

function defaultInteraction(fallbackLimits?: SpineMotionPoint): SpineMotionInteraction {
  return {
    startAnimation: "",
    followTargetBone: null,
    sensitivity: DEFAULT_SENSITIVITY,
    limitX: fallbackLimits?.x ?? DEFAULT_LIMIT_X,
    limitY: fallbackLimits?.y ?? DEFAULT_LIMIT_Y,
    smoothing: DEFAULT_SMOOTHING,
    allowX: true,
    allowY: true,
    rotationEnabled: false,
    rotationAxis: "x",
    rotationMin: -15,
    rotationMax: 15,
  };
}

export function createInteractionMotionState(): SpineInteractionMotionState {
  return {
    interaction: null,
    kind: null,
    origin: null,
    offset: { x: 0, y: 0 },
    target: null,
    resolvedTargetBonePath: null,
    rotation: 0,
  };
}

/** Restore the pose and constraint mixes that existed before the last motion frame. */
export function beforeInteractionMotion(state: SpineInteractionMotionState): void {
  const target = state.target;
  if (!target) return;
  target.bone.x = target.restoreX;
  target.bone.y = target.restoreY;
  target.bone.rotation = target.restoreRotation;
  for (const item of target.constraints) {
    item.constraint.mixX = item.mixX;
    item.constraint.mixY = item.mixY;
  }
}

/** Cancel motion and leave the skeleton ready for its normal animation pose. */
export function resetInteractionMotion(state: SpineInteractionMotionState): void {
  beforeInteractionMotion(state);
  state.interaction = null;
  state.kind = null;
  state.origin = null;
  state.offset = { x: 0, y: 0 };
  state.target = null;
  state.resolvedTargetBonePath = null;
  state.rotation = 0;
}

/** Begin a gesture. The actual bone is resolved after the start animation is applied. */
export function beginInteractionMotion(
  state: SpineInteractionMotionState,
  interaction: SpineMotionInteraction,
  kind: SpineInteractionKind,
  origin: SpineMotionPoint | null,
): void {
  resetInteractionMotion(state);
  state.interaction = interaction;
  state.kind = kind;
  state.origin = origin ? { ...origin } : null;
}

function resolveTarget(state: SpineInteractionMotionState, skeleton: Skeleton, pointer: SpineMotionPoint, fallbackTarget: Bone | null): MotionTarget | null {
  const interaction = state.interaction ?? defaultInteraction();
  const configured = findBonePath(skeleton, interaction.followTargetBone);
  let target = configured;
  let directCheek = false;
  let legacyCheek = false;
  if (state.kind === "pinch") {
    const cheeks = cheekBones(skeleton);
    const configuredIsCheek = Boolean(configured && cheeks.includes(configured));
    if (configuredIsCheek) {
      directCheek = true;
    } else if (cheeks.length > 0) {
      target = cheeks.slice().sort((a, b) => Math.hypot(a.worldX - pointer.x, a.worldY - pointer.y) - Math.hypot(b.worldX - pointer.x, b.worldY - pointer.y))[0] ?? null;
      directCheek = Boolean(target);
      legacyCheek = directCheek;
    }
  }
  target ??= fallbackTarget;
  if (!target) return null;
  const motionTarget: MotionTarget = {
    bone: target,
    directCheek,
    legacyCheek,
    baseX: target.x,
    baseY: target.y,
    baseRotation: target.rotation,
    restoreX: target.x,
    restoreY: target.y,
    restoreRotation: target.rotation,
    constraints: [],
  };
  if (directCheek) {
    for (const constraint of skeleton.transformConstraints) {
      if (constraint.bones.includes(target)) motionTarget.constraints.push({ constraint, mixX: constraint.mixX, mixY: constraint.mixY });
    }
  }
  state.target = motionTarget;
  state.resolvedTargetBonePath = bonePath(target);
  return motionTarget;
}

/** Apply the same relative, bounded, smoothed motion used by the editor and viewer. */
export function applyInteractionMotion(
  state: SpineInteractionMotionState,
  skeleton: Skeleton,
  pointer: SpineMotionPoint | null,
  delta: number,
  fallbackTarget: Bone | null = null,
  fallbackLimits?: SpineMotionPoint,
): boolean {
  if (!pointer) return false;
  const interaction = state.interaction ?? defaultInteraction(fallbackLimits);
  const target = state.target ?? resolveTarget(state, skeleton, pointer, fallbackTarget);
  if (!target) return false;

  // The animation has already been applied for this frame. Save that pose so
  // beforeInteractionMotion can remove only this frame's input on the next one.
  if (target.directCheek) {
    target.restoreX = target.bone.x;
    target.restoreY = target.bone.y;
    target.restoreRotation = target.bone.rotation;
  } else {
    target.restoreX = target.baseX;
    target.restoreY = target.baseY;
    target.restoreRotation = target.baseRotation;
  }
  for (const item of target.constraints) {
    item.constraint.mixX = 0;
    item.constraint.mixY = 0;
  }

  const origin = state.origin ?? pointer;
  const sensitivity = target.legacyCheek && interaction.sensitivity === DEFAULT_SENSITIVITY && interaction.limitX === DEFAULT_LIMIT_X && interaction.limitY === DEFAULT_LIMIT_Y && interaction.allowX !== false && interaction.allowY !== false && interaction.rotationEnabled !== true
    ? 1
    : finitePositive(interaction.sensitivity, DEFAULT_SENSITIVITY);
  let world = new Vector2(
    (pointer.x - origin.x) * sensitivity,
    (pointer.y - origin.y) * sensitivity,
  );
  let limitX = finitePositive(interaction.limitX, fallbackLimits?.x ?? DEFAULT_LIMIT_X);
  let limitY = finitePositive(interaction.limitY, fallbackLimits?.y ?? DEFAULT_LIMIT_Y);
  if (state.kind === "pat") world = limitHeadpatLocalY(target.bone, world, limitY);
  const cheeks = target.directCheek ? cheekBones(skeleton) : [];
  const other = target.directCheek ? (cheeks.find((bone) => bone !== target.bone) ?? target.bone.parent ?? null) : null;
  if (other) {
    const dx = target.bone.worldX - other.worldX;
    const dy = target.bone.worldY - other.worldY;
    const length = Math.hypot(dx, dy);
    if (length > 0) {
      // These are the editor's generated defaults. Keep custom authored limits
      // untouched while preventing small rigs from receiving a full-size pull.
      if (interaction.limitX === DEFAULT_LIMIT_X && interaction.limitY === DEFAULT_LIMIT_Y) {
        const span = cheeks.length > 1 ? length : length * 2;
        limitX = Math.min(limitX, span * 0.18);
        limitY = Math.min(limitY, span * 0.12);
      }
      const inward = Math.min(0, (world.x * dx + world.y * dy) / length);
      world.x -= inward * dx / length;
      world.y -= inward * dy / length;
    }
  }

  const parent = target.bone.parent;
  const parentOrigin = parent?.localToWorld(new Vector2(0, 0));
  const local = parent
    ? parent.worldToLocal(new Vector2((parentOrigin?.x ?? parent.worldX) + world.x, (parentOrigin?.y ?? parent.worldY) + world.y))
    : world;
  const rawLocal = { x: local.x, y: local.y };
  const constrainedLocal = {
    x: interaction.allowX === false ? 0 : rawLocal.x,
    y: interaction.allowY === false ? 0 : rawLocal.y,
  };
  const nx = constrainedLocal.x / limitX;
  const ny = constrainedLocal.y / limitY;
  const distance = Math.max(1, Math.hypot(nx, ny));
  const desired = {
    x: nx / distance * limitX,
    y: ny / distance * limitY,
  };
  const smoothing = finitePositive(interaction.smoothing, DEFAULT_SMOOTHING);
  const amount = 1 - Math.exp(-smoothing * Math.max(0, delta));
  state.offset.x += (desired.x - state.offset.x) * amount;
  state.offset.y += (desired.y - state.offset.y) * amount;

  const rotationInput = Math.max(-1, Math.min(1, (interaction.rotationAxis === "y" ? rawLocal.y / limitY : rawLocal.x / limitX)));
  const rotationMin = Math.min(0, finiteSigned(interaction.rotationMin, -15));
  const rotationMax = Math.max(0, finiteSigned(interaction.rotationMax, 15));
  const desiredRotation = interaction.rotationEnabled === true
    ? rotationInput < 0 ? rotationInput * Math.abs(rotationMin) : rotationInput * rotationMax
    : 0;
  state.rotation += (desiredRotation - state.rotation) * amount;

  if (target.directCheek) {
    const baseWorld = new Vector2(target.bone.worldX, target.bone.worldY);
    const baseLocal = parent ? parent.worldToLocal(new Vector2(baseWorld.x, baseWorld.y)) : baseWorld;
    const desiredWorld = parent
      ? parent.localToWorld(new Vector2(baseLocal.x + state.offset.x, baseLocal.y + state.offset.y))
      : new Vector2(baseWorld.x + state.offset.x, baseWorld.y + state.offset.y);
    const desiredX = desiredWorld.x;
    const desiredY = desiredWorld.y;
    for (let iteration = 0; iteration < 4; iteration += 1) {
      const position = new Vector2(desiredX, desiredY);
      if (parent) parent.worldToLocal(position);
      target.bone.x = position.x;
      target.bone.y = position.y;
      target.bone.rotation = target.baseRotation + state.rotation;
      skeleton.updateWorldTransform(Physics.pose);
      if (Math.hypot(target.bone.worldX - desiredX, target.bone.worldY - desiredY) < 0.01) break;
    }
  } else {
    target.bone.x = target.baseX + state.offset.x;
    target.bone.y = target.baseY + state.offset.y;
    target.bone.rotation = target.baseRotation + state.rotation;
    skeleton.updateWorldTransform(Physics.pose);
  }
  return true;
}
