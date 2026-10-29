import type { SpineEditorBone } from "../../../src/client/spine/spineRuntime";
import { findInteractionProfile } from "../../../src/client/spine/spineInteraction";
import { cheekControlNames } from "../../../src/client/spine/spinePinch";

export const EDITOR_SCHEMA_VERSION = 1;

export type EditorTrigger = "press" | "hold" | "drag";
export type EditorShape = "ellipse" | "rectangle";

export interface EditorRegion {
  id: string;
  name: string;
  enabled: boolean;
  shape: EditorShape;
  anchorBone: string | null;
  offsetX: number;
  offsetY: number;
  radiusX: number;
  radiusY: number;
  rotation: number;
  placement?: "head-v1" | "cheek-v1" | "needs-head" | "manual";
}

export interface EditorInteraction {
  id: string;
  name: string;
  color: string;
  enabled: boolean;
  trigger: EditorTrigger;
  startAnimation: string;
  followAnimation: string;
  endAnimation: string;
  faceStartAnimation: string;
  faceFollowAnimation: string;
  faceEndAnimation: string;
  followTargetBone: string | null;
  sensitivity: number;
  limitX: number;
  limitY: number;
  smoothing: number;
  regions: EditorRegion[];
}

export interface EditorProject {
  schemaVersion: number;
  name: string;
  assetDirectory: string;
  interactions: EditorInteraction[];
  selectedInteractionId: string | null;
  selectedRegionId: string | null;
  selectedBonePath: string | null;
  showBones: boolean;
  showBoneNames: boolean;
  showConstraints: boolean;
  showInactiveBones: boolean;
}

export type EditorViewSettings = Pick<EditorProject, "showBones" | "showBoneNames" | "showConstraints" | "showInactiveBones">;

export const DEFAULT_EDITOR_VIEW_SETTINGS: EditorViewSettings = {
  showBones: true,
  showBoneNames: false,
  showConstraints: true,
  showInactiveBones: false,
};

export const EDITOR_VIEW_SETTINGS_KEY = `shittim-spine-editor:view-settings:v${EDITOR_SCHEMA_VERSION}`;

export function viewSettingsFromProject(project: Pick<EditorProject, keyof EditorViewSettings>): EditorViewSettings {
  return {
    showBones: project.showBones,
    showBoneNames: project.showBoneNames,
    showConstraints: project.showConstraints,
    showInactiveBones: project.showInactiveBones,
  };
}

export function normalizeViewSettings(value: unknown): EditorViewSettings | null {
  if (!value || typeof value !== "object") return null;
  const settings = value as Partial<EditorViewSettings>;
  return {
    showBones: settings.showBones !== false,
    showBoneNames: settings.showBoneNames === true,
    showConstraints: settings.showConstraints !== false,
    showInactiveBones: settings.showInactiveBones === true,
  };
}

export type EditorValidationKind = "missing-animation" | "missing-bone" | "overlap" | "head-detection";

export interface EditorValidationWarning {
  id: string;
  kind: EditorValidationKind;
  interactionId: string;
  regionId: string | null;
  otherInteractionId?: string;
  otherRegionId?: string;
  message: string;
}

const COLORS = ["#28c7ed", "#ff668f", "#ffc857", "#a78bfa", "#61d095", "#ff9f43"];

function id(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function exact(animations: string[], name: string): string {
  return animations.find((animation) => animation.toLocaleLowerCase() === name.toLocaleLowerCase()) ?? "";
}

function faceVariant(animations: string[], main: string): string {
  if (!main) return "";
  const candidates = [main.replace(/_m(?=_|$)/i, "_A"), `${main}_A`].filter((candidate) => candidate !== main);
  return candidates.map((candidate) => exact(animations, candidate)).find(Boolean) ?? "";
}

function first(animations: string[], pattern: RegExp): string {
  return animations.find((animation) => pattern.test(animation)) ?? "";
}

function nextAnimation(animations: string[], start: string): string {
  if (!start) return "";
  const match = start.match(/^(.*?)(\d+)(?=_[A-Za-z]+$|$)/);
  if (!match) return start;
  const next = `${match[1]}${String(Number(match[2]) + 1).padStart(match[2].length, "0")}${start.slice(match[0].length)}`;
  return exact(animations, next) || start;
}

function endAnimation(animations: string[], start: string, kind: string): string {
  if (!start) return "";
  const base = start.split("/").pop() ?? start;
  const directory = start.includes("/") ? `${start.slice(0, start.lastIndexOf("/") + 1)}` : "";
  const variants = kind === "touch"
    ? [base.replace(/^touch/i, "TouchEnd"), base.replace(/^touch/i, "Touch_End")]
    : kind === "pinch"
      ? [base.replace(/^pinch/i, "PinchEnd"), base.replace(/^pinch/i, "Pinch_End")]
      : [base.replace(/^pat2/i, "Pat2End"), base.replace(/^pat/i, "PatEnd"), base.replace(/^pat2/i, "PatEnd2")];
  return variants
    .filter((candidate) => candidate !== base)
    .map((candidate) => exact(animations, candidate) || exact(animations, `${directory}${candidate}`))
    .find(Boolean) ?? "";
}

function findBone(bones: SpineEditorBone[], pattern: RegExp): SpineEditorBone | undefined {
  return bones.find((bone) => pattern.test(bone.name));
}

function findTouchTargetBone(bones: SpineEditorBone[]): SpineEditorBone | undefined {
  return bones.find((bone) => /^touch[ _-]?point[ _-]?key$/i.test(bone.name))
    ?? bones.find((bone) => /^touch[ _-]?point$/i.test(bone.name))
    ?? findBone(bones, /^touch[ _-]?point(?:[ _-]?key)?$/i);
}

/** Prefer the named left/right cheek controls, including rigs that call them chin bones. */
export function cheekRegionBones(bones: SpineEditorBone[]): SpineEditorBone[] {
  const names = cheekControlNames(bones.map((bone) => ({ name: bone.name, parentName: bone.parentPath?.split("/").pop() ?? null })));
  return names.map((name) => bones.find((bone) => bone.name === name)!);
}

function region(name: string, anchorBone: SpineEditorBone | undefined): EditorRegion {
  return {
    id: id("region"),
    name,
    enabled: true,
    shape: "ellipse",
    anchorBone: anchorBone?.path ?? null,
    offsetX: 0,
    offsetY: 0,
    radiusX: 120,
    radiusY: 90,
    rotation: 0,
  };
}

function interaction(
  name: string,
  kind: string,
  animations: string[],
  bones: SpineEditorBone[],
  colorIndex: number,
): EditorInteraction {
  const detected = kind === "touch" || kind === "pinch" || kind === "pat" ? findInteractionProfile(animations)[kind] : null;
  const start = kind === "custom" ? "" : detected?.start.main ?? (kind === "touch"
    ? exact(animations, "Touch_01_M") || first(animations, /^touch[_ -]?\d+_m/i)
    : kind === "pinch"
      ? exact(animations, "Pinch_01_M") || exact(animations, "Pinch_01") || first(animations, /^pinch[_ -]?\d+/i)
       : exact(animations, "Pat_01_M") || first(animations, /(?:^|\/)pat(?:2)?[_ -]?\d+_m/i));
  const anchor = findTouchTargetBone(bones) ?? bones[0];
  const cheekBones = cheekRegionBones(bones);
  const regions = kind === "pinch"
    ? (cheekBones.length > 0 ? cheekBones.map((bone, index) => ({ ...region(cheekBones.length === 1 ? "Cheek area" : index === 0 ? "Left cheek" : "Right cheek", bone), placement: "cheek-v1" as const })) : [region("Cheek area", anchor)])
    : [region(kind === "touch" ? "Touch area" : "Patting area", anchor)];
  return {
    id: id("interaction"),
    name,
    color: COLORS[colorIndex % COLORS.length]!,
    enabled: true,
    trigger: "hold",
    startAnimation: start,
    followAnimation: detected?.follow.main ?? nextAnimation(animations, start),
    endAnimation: detected?.release?.main ?? endAnimation(animations, start, kind),
    faceStartAnimation: detected?.start.face ?? faceVariant(animations, start),
    faceFollowAnimation: detected?.follow.face ?? faceVariant(animations, nextAnimation(animations, start)),
    faceEndAnimation: detected?.release?.face ?? faceVariant(animations, endAnimation(animations, start, kind)),
    followTargetBone: anchor?.path ?? null,
    sensitivity: 0.25,
    limitX: 90,
    limitY: 65,
    smoothing: 8,
    regions,
  };
}

export function createProject(directory: string, animations: string[], bones: SpineEditorBone[]): EditorProject {
  const interactions: EditorInteraction[] = [];
  const profile = findInteractionProfile(animations);
  if (profile.touch) interactions.push(interaction("Touch", "touch", animations, bones, interactions.length));
  if (profile.pinch) interactions.push(interaction("Cheek pinch", "pinch", animations, bones, interactions.length));
  if (profile.pat) interactions.push(interaction("Patting", "pat", animations, bones, interactions.length));
  if (interactions.length === 0) interactions.push(interaction("New interaction", "custom", animations, bones, 0));
  return {
    schemaVersion: EDITOR_SCHEMA_VERSION,
    name: `${directory} interactions`,
    assetDirectory: directory,
    interactions,
    selectedInteractionId: interactions[0]?.id ?? null,
    selectedRegionId: interactions[0]?.regions[0]?.id ?? null,
    selectedBonePath: bones[0]?.path ?? null,
    ...DEFAULT_EDITOR_VIEW_SETTINGS,
  };
}

export function blankInteraction(animations: string[], bones: SpineEditorBone[], index: number): EditorInteraction {
  return interaction(`Interaction ${index + 1}`, "custom", animations, bones, index);
}

export function blankRegion(anchorBone: SpineEditorBone | undefined, index: number): EditorRegion {
  return { ...region(`Region ${index + 1}`, anchorBone), radiusX: 100, radiusY: 75 };
}

export function normalizeProject(value: unknown, directory: string): EditorProject | null {
  if (!value || typeof value !== "object") return null;
  const project = value as Partial<EditorProject> & { schemaVersion?: unknown };
  if (!Array.isArray(project.interactions)) return null;
  const schemaVersion = Number(project.schemaVersion);
  if (Number.isFinite(schemaVersion) && schemaVersion > EDITOR_SCHEMA_VERSION) return null;
  const interactions = (project.interactions as unknown[])
    .filter((item) => Boolean(item && typeof item === "object"))
    .map((item, index) => normalizeInteraction(item as Partial<EditorInteraction>, index))
    .filter((item): item is EditorInteraction => item !== null);
  const requestedInteraction = typeof project.selectedInteractionId === "string" ? project.selectedInteractionId : "";
  const selectedInteractionId = interactions.some((item) => item.id === requestedInteraction) ? requestedInteraction : interactions[0]?.id ?? null;
  const selectedInteraction = interactions.find((item) => item.id === selectedInteractionId);
  const requestedRegion = typeof project.selectedRegionId === "string" ? project.selectedRegionId : "";
  const selectedRegionId = selectedInteraction?.regions.some((item) => item.id === requestedRegion)
    ? requestedRegion
    : selectedInteraction?.regions[0]?.id ?? null;
  return {
    schemaVersion: Number.isFinite(schemaVersion) && schemaVersion > 0 ? schemaVersion : EDITOR_SCHEMA_VERSION,
    name: typeof project.name === "string" ? project.name : `${directory} interactions`,
    assetDirectory: directory,
    interactions,
    selectedInteractionId,
    selectedRegionId,
    selectedBonePath: typeof project.selectedBonePath === "string" ? project.selectedBonePath : null,
    showBones: project.showBones !== false,
    showBoneNames: project.showBoneNames === true,
    showConstraints: project.showConstraints !== false,
    showInactiveBones: project.showInactiveBones === true,
  };
}

/** Detect the original single Touch_Point pinch default, not authored regions. */
export function isLegacyPinchRegion(project: EditorProject, region: EditorRegion): boolean {
  const interaction = project.interactions.find((item) => item.regions.some((candidate) => candidate.id === region.id));
  return Boolean(interaction && /(?:^|\/)(?:s_)?pinch[_ -]?\d+(?:_|$)/i.test(interaction.startAnimation)
    && region.name === "Cheek area" && region.shape === "ellipse" && region.rotation === 0
    && region.offsetX === 0 && region.offsetY === 0 && region.radiusX === 120 && region.radiusY === 90
    && region.enabled && !region.placement
    && region.anchorBone === interaction.followTargetBone);
}

/** Move untouched legacy pinch defaults onto the rig's actual left/right cheek controls. */
export function repairPinchRegions(project: EditorProject, bones: SpineEditorBone[]) {
  const cheekBones = cheekRegionBones(bones);
  if (cheekBones.length === 0) return { project, repaired: 0 };
  const touchTarget = findTouchTargetBone(bones);
  const legacyTouchTarget = bones.find((bone) => /^touch[ _-]?point$/i.test(bone.name));
  let repaired = 0;
  const next: EditorProject = {
    ...project,
    interactions: project.interactions.map((interaction) => {
      const legacy = interaction.regions.find((region) => isLegacyPinchRegion(project, region));
      if (!legacy) return interaction;
      repaired++;
      const replacements = cheekBones.map((bone, index) => ({
        ...legacy,
        id: index === 0 ? legacy.id : id("region"),
        name: cheekBones.length > 1 ? (index === 0 ? "Left cheek" : "Right cheek") : "Cheek area",
        anchorBone: bone.path,
        placement: "cheek-v1" as const,
      }));
      return {
        ...interaction,
        followTargetBone: interaction.followTargetBone === legacyTouchTarget?.path && touchTarget
          ? touchTarget.path
          : interaction.followTargetBone,
        regions: interaction.regions.flatMap((region) => region.id === legacy.id ? replacements : [region]),
      };
    }),
  };
  return { project: next, repaired };
}

function finiteNumber(value: unknown, fallback: number, minimum = -Infinity): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= minimum ? number : fallback;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeRegion(value: Partial<EditorRegion>, index: number): EditorRegion {
  const shape = value.shape === "rectangle" ? "rectangle" : "ellipse";
  return {
    id: stringValue(value.id, id("region")),
    name: stringValue(value.name, `Region ${index + 1}`),
    enabled: value.enabled !== false,
    shape,
    anchorBone: typeof value.anchorBone === "string" && value.anchorBone ? value.anchorBone : null,
    offsetX: finiteNumber(value.offsetX, 0),
    offsetY: finiteNumber(value.offsetY, 0),
    radiusX: finiteNumber(value.radiusX, 100, 1),
    radiusY: finiteNumber(value.radiusY, 75, 1),
    rotation: finiteNumber(value.rotation, 0),
     placement: value.placement === "head-v1" || value.placement === "cheek-v1" || value.placement === "needs-head" || value.placement === "manual" ? value.placement : undefined,
  };
}

function normalizeInteraction(value: Partial<EditorInteraction>, index: number): EditorInteraction | null {
  const rawRegions = Array.isArray(value.regions) ? value.regions as unknown[] : [];
  const regions = rawRegions
    .filter((item) => Boolean(item && typeof item === "object"))
    .map((item, regionIndex) => normalizeRegion(item as Partial<EditorRegion>, regionIndex));
  const trigger: EditorTrigger = value.trigger === "press" || value.trigger === "drag" ? value.trigger : "hold";
  return {
    id: stringValue(value.id, id("interaction")),
    name: stringValue(value.name, `Interaction ${index + 1}`),
    color: stringValue(value.color, COLORS[index % COLORS.length]!),
    enabled: value.enabled !== false,
    trigger,
    startAnimation: stringValue(value.startAnimation, ""),
    followAnimation: stringValue(value.followAnimation, ""),
    endAnimation: stringValue(value.endAnimation, ""),
    faceStartAnimation: stringValue(value.faceStartAnimation, ""),
    faceFollowAnimation: stringValue(value.faceFollowAnimation, ""),
    faceEndAnimation: stringValue(value.faceEndAnimation, ""),
    followTargetBone: typeof value.followTargetBone === "string" && value.followTargetBone ? value.followTargetBone : null,
    sensitivity: finiteNumber(value.sensitivity, 0.25, 0),
    limitX: finiteNumber(value.limitX, 90, 0),
    limitY: finiteNumber(value.limitY, 65, 0),
    smoothing: finiteNumber(value.smoothing, 8, 0.1),
    regions,
  };
}

function regionWorldCircle(region: EditorRegion, bones: Map<string, SpineEditorBone>) {
  const bone = region.anchorBone ? bones.get(region.anchorBone) : undefined;
  if (!bone) {
    return { x: region.offsetX, y: region.offsetY, radius: Math.max(region.radiusX, region.radiusY) };
  }
  const scaleX = Math.hypot(bone.a, bone.c);
  const scaleY = Math.hypot(bone.b, bone.d);
  return {
    x: bone.x + bone.a * region.offsetX + bone.b * region.offsetY,
    y: bone.y + bone.c * region.offsetX + bone.d * region.offsetY,
    radius: Math.max(region.radiusX * scaleX, region.radiusY * scaleY),
  };
}

/** Return authoring issues that would make a runtime project incomplete or ambiguous. */
export function validateProject(project: EditorProject, animations: string[], bones: SpineEditorBone[]): EditorValidationWarning[] {
  const warnings: EditorValidationWarning[] = [];
  const animationNames = new Set(animations.map((animation) => animation.toLocaleLowerCase()));
  const boneMap = new Map(bones.map((bone) => [bone.path, bone]));
  const regions: Array<{ interaction: EditorInteraction; region: EditorRegion }> = [];

  for (const interaction of project.interactions) {
    for (const field of ["startAnimation", "followAnimation", "endAnimation", "faceStartAnimation", "faceFollowAnimation", "faceEndAnimation"] as const) {
      const animation = interaction[field];
      if (animation && !animationNames.has(animation.toLocaleLowerCase())) {
        warnings.push({
          id: `animation:${interaction.id}:${field}`,
          kind: "missing-animation",
          interactionId: interaction.id,
          regionId: null,
          message: `${interaction.name}: ${field.replace(/Animation$/, "")} animation “${animation}” is missing from this asset.`,
        });
      }
    }
    if (interaction.followTargetBone && !boneMap.has(interaction.followTargetBone)) {
      warnings.push({
        id: `bone:${interaction.id}:target`,
        kind: "missing-bone",
        interactionId: interaction.id,
        regionId: null,
        message: `${interaction.name}: follow target bone “${interaction.followTargetBone}” is missing from this asset.`,
      });
    }
    for (const region of interaction.regions) {
      if (region.placement === "needs-head") warnings.push({ id: `head:${interaction.id}:${region.id}`, kind: "head-detection", interactionId: interaction.id, regionId: region.id, message: `${interaction.name}: no reliable head artwork was detected. Default region is disabled; draw or position it before enabling.` });
      regions.push({ interaction, region });
      if (region.anchorBone && !boneMap.has(region.anchorBone)) {
        warnings.push({
          id: `bone:${interaction.id}:${region.id}`,
          kind: "missing-bone",
          interactionId: interaction.id,
          regionId: region.id,
          message: `${interaction.name} / ${region.name}: anchor bone “${region.anchorBone}” is missing from this asset.`,
        });
      }
    }
  }

  for (let firstIndex = 0; firstIndex < regions.length; firstIndex += 1) {
    const firstRegion = regions[firstIndex]!;
    if (!firstRegion.region.enabled || (firstRegion.region.anchorBone && !boneMap.has(firstRegion.region.anchorBone))) continue;
    const firstCircle = regionWorldCircle(firstRegion.region, boneMap);
    for (let secondIndex = firstIndex + 1; secondIndex < regions.length; secondIndex += 1) {
      const secondRegion = regions[secondIndex]!;
      if (!secondRegion.region.enabled || (secondRegion.region.anchorBone && !boneMap.has(secondRegion.region.anchorBone))) continue;
      const secondCircle = regionWorldCircle(secondRegion.region, boneMap);
      if (Math.hypot(firstCircle.x - secondCircle.x, firstCircle.y - secondCircle.y) >= firstCircle.radius + secondCircle.radius) continue;
      warnings.push({
        id: `overlap:${firstRegion.interaction.id}:${firstRegion.region.id}:${secondRegion.interaction.id}:${secondRegion.region.id}`,
        kind: "overlap",
        interactionId: firstRegion.interaction.id,
        regionId: firstRegion.region.id,
        otherInteractionId: secondRegion.interaction.id,
        otherRegionId: secondRegion.region.id,
        message: `${firstRegion.interaction.name} / ${firstRegion.region.name} overlaps ${secondRegion.interaction.name} / ${secondRegion.region.name}.`,
      });
    }
  }
  return warnings;
}

export function cloneProject(project: EditorProject): EditorProject {
  return JSON.parse(JSON.stringify(project)) as EditorProject;
}

export function projectStorageKey(directory: string): string {
  return `shittim-spine-editor:v${EDITOR_SCHEMA_VERSION}:${directory}`;
}
