import { BlendMode, MeshAttachment, RegionAttachment, type Bone, type Skeleton, type Slot } from "@esotericsoftware/spine-core";

export interface SceneBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AuthoredViewport extends SceneBounds {
  /** True when the viewport came from a named scene layer and backdrop. */
  authored: boolean;
  anchorX: number;
  anchorY: number;
}

const DEFAULT_ASPECT = 16 / 9;

function finiteBounds(bounds: SceneBounds | null): bounds is SceneBounds {
  return Boolean(bounds && [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) && bounds.width > 0 && bounds.height > 0);
}

function visibleAttachment(slot: Slot) {
  if (!slot.bone.active || slot.color.a * slot.getSkeleton().color.a <= 0.01 || slot.data.blendMode !== BlendMode.Normal) return null;
  const attachment = slot.getAttachment();
  if (!(attachment instanceof RegionAttachment || attachment instanceof MeshAttachment) || attachment.color.a <= 0.01) return null;
  const name = `${slot.data.name}/${attachment.name}`;
  // Some exported effects use normal blending rather than an additive slot.
  if (/(^|[\/_\s-])(fx|vfx|bloom|flare|glow|light|effect)([\/_\s-]|\d|$)/i.test(name)) return null;
  return attachment;
}

function attachmentBounds(slot: Slot): SceneBounds | null {
  const attachment = visibleAttachment(slot);
  if (!attachment) return null;
  const vertices = new Float32Array(attachment instanceof MeshAttachment ? attachment.worldVerticesLength : 8);
  if (attachment instanceof MeshAttachment) attachment.computeWorldVertices(slot, 0, vertices.length, vertices, 0, 2);
  else attachment.computeWorldVertices(slot, vertices, 0, 2);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < vertices.length; i += 2) {
    minX = Math.min(minX, vertices[i]!);
    minY = Math.min(minY, vertices[i + 1]!);
    maxX = Math.max(maxX, vertices[i]!);
    maxY = Math.max(maxY, vertices[i + 1]!);
  }
  const bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  return finiteBounds(bounds) ? bounds : null;
}

function unionBounds(bounds: SceneBounds[]): SceneBounds | null {
  if (bounds.length === 0) return null;
  const x = Math.min(...bounds.map((item) => item.x));
  const y = Math.min(...bounds.map((item) => item.y));
  const right = Math.max(...bounds.map((item) => item.x + item.width));
  const top = Math.max(...bounds.map((item) => item.y + item.height));
  const result = { x, y, width: right - x, height: top - y };
  return finiteBounds(result) ? result : null;
}

/**
 * These are scene containers, not the many PC_Layer12/PC_Layer20 bones used
 * for character parts. Exporters use both underscore and compact spellings,
 * so keep the useful prefixes but require a layer boundary for PC layers.
 */
function isSceneContainer(bone: Bone): boolean {
  const name = bone.data.name.trim();
  if (/^pc[ _-]?layer(?:$|[_-])/i.test(name)) return true;
  if (/^(?:\d+[_ -])?all[ _-]?layer(?:$|[_-]|\d)/i.test(name)) return true;
  if (/^(?:\d+[_ -])?(?:all[_ -]?camera(?:[_ -]?root)?|camera[_ -]?(?:pos|root)|main[_ -]?camera|background[_ -]?layer|full)$/i.test(name)) return true;
  return false;
}

function isBackdrop(slot: Slot): boolean {
  // Do not use the owning bone here. A character can be parented under a
  // bone named Background_Layer, and treating every child as background makes
  // the inferred width grow to the character's hair or foreground FX.
  const name = `${slot.data.name}/${slot.getAttachment()?.name ?? ""}`;
  return /(^|[\/_\s-])(bg|background|backgroud|sky|ground|floor|wall|sea|window|stage|room|building)([\/_\s-]|\d|$)/i.test(name);
}

function descendantOf(bone: Bone, ancestor: Bone): boolean {
  for (let current: Bone | null = bone; current; current = current.parent) {
    if (current === ancestor) return true;
  }
  return false;
}

function isCharacterContainer(bone: Bone): boolean {
  return /^(?:pc(?:[ _-]?layer)?|cha(?:racter)?[ _-]?root)$/i.test(bone.data.name.trim());
}

function interactionSlots(skeleton: Skeleton): Slot[] {
  const scene = activeScene(skeleton, anchorPoint(skeleton));
  const available = scene?.slots ?? skeleton.drawOrder;
  const containers = skeleton.bones
    .filter(isCharacterContainer)
    .sort((a, b) => boneDepth(b) - boneDepth(a));
  for (const container of containers) {
    const slots = available.filter((slot) => descendantOf(slot.bone, container));
    if (slots.length > 0) return slots;
  }
  return available;
}

function boneDepth(bone: Bone): number {
  let depth = 0;
  for (let current = bone.parent; current; current = current.parent) depth += 1;
  return depth;
}

function hasBackdrop(skeleton: Skeleton, container: Bone): boolean {
  return skeleton.slots.some((slot) => descendantOf(slot.bone, container) && isBackdrop(slot) && slot.getAttachment() !== null);
}

function sceneSlots(skeleton: Skeleton, container: Bone): Slot[] {
  return skeleton.slots.filter((slot) => {
    if (!descendantOf(slot.bone, container)) return false;
    // A parent layer may contain several complete cuts. Keep the parent's own
    // attachments, but do not let a child's offstage backdrop leak into its
    // bounds. The child is evaluated as its own scene candidate below.
    for (let current: Bone | null = slot.bone; current && current !== container; current = current.parent) {
      if (!current) break;
      if (isSceneContainer(current) && hasBackdrop(skeleton, current)) return false;
    }
    return true;
  });
}

function sceneInfo(skeleton: Skeleton, container: Bone) {
  const slots = sceneSlots(skeleton, container);
  const visualBounds: SceneBounds[] = [];
  const backdropBounds: SceneBounds[] = [];
  for (const slot of slots) {
    const bounds = attachmentBounds(slot);
    if (!bounds) continue;
    visualBounds.push(bounds);
    if (isBackdrop(slot)) backdropBounds.push(bounds);
  }
  return {
    container,
    slots,
    bounds: unionBounds(visualBounds),
    // A scene can be assembled from several background pieces. The union is
    // useful for artwork bounds, but the widest authored backdrop is the best
    // signal for the camera width and avoids spanning decorative pieces or
    // multiple cuts.
    backdrop: backdropBounds.sort((a, b) => {
      // Atlas/export rounding can make equal-width backdrop cuts differ by a
      // fraction of a Spine unit. Do not let that noise beat the taller cut.
      const widthDelta = b.width - a.width;
      return Math.abs(widthDelta) > 1 ? widthDelta : b.height - a.height;
    })[0] ?? null,
    depth: boneDepth(container),
  };
}

function anchorPoint(skeleton: Skeleton): { x: number; y: number } {
  const root = skeleton.bones[0];
  // Some exports wrap the entire scene rig in a Scale/offset bone. Searching
  // only root children silently anchors those lobbies at (0, 0), below the
  // artwork. Resolve the outermost actual scene rig through such wrappers.
  const containers = skeleton.bones.filter((bone) => isSceneContainer(bone) && hasBackdrop(skeleton, bone));
  const byHierarchy = (a: Bone, b: Bone) => boneDepth(a) - boneDepth(b)
    || Math.hypot(a.worldX - (root?.worldX ?? 0), a.worldY - (root?.worldY ?? 0))
      - Math.hypot(b.worldX - (root?.worldX ?? 0), b.worldY - (root?.worldY ?? 0));
  const cameraRoot = containers
    .filter((bone) => /camera|cam/i.test(bone.data.name))
    .sort(byHierarchy)[0];
  const layerRoot = containers.sort(byHierarchy)[0];
  const point = cameraRoot ?? layerRoot ?? root;
  return { x: point?.worldX ?? 0, y: point?.worldY ?? 0 };
}

function activeScene(skeleton: Skeleton, anchor: { x: number; y: number }) {
  const candidates = skeleton.bones
    .filter((bone) => isSceneContainer(bone))
    .map((bone) => sceneInfo(skeleton, bone))
    // A PC layer can contain a perfectly valid character-sized bounds while
    // still being only one child of the lobby. Require an owned backdrop so a
    // character layer never wins the same-anchor/deeper-container tie.
    .filter((info) => info.bounds && info.backdrop)
    .sort((a, b) => {
      const distanceA = Math.hypot(a.container.worldX - anchor.x, a.container.worldY - anchor.y);
      const distanceB = Math.hypot(b.container.worldX - anchor.x, b.container.worldY - anchor.y);
      // A child scene at the same authored anchor is more specific than the
      // layer that contains it. This is what separates All_Layer_00/01 cuts.
      return distanceA - distanceB || b.depth - a.depth || (b.backdrop?.width ?? 0) - (a.backdrop?.width ?? 0);
    });
  return candidates[0] ?? null;
}

/** Frame the active authored scene, not the offstage siblings in a multi-cut lobby. */
export function sceneBounds(skeleton: Skeleton): SceneBounds {
  const authored = activeScene(skeleton, anchorPoint(skeleton));
  if (authored?.bounds && finiteBounds(authored.bounds)) return authored.bounds;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const backgrounds: SceneBounds[] = [];
  for (const slot of skeleton.drawOrder) {
    const bounds = attachmentBounds(slot);
    if (!bounds) continue;
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
    if (isBackdrop(slot)) backgrounds.push(bounds);
  }
  const mainBackground = backgrounds.sort((a, b) => b.width * b.height - a.width * a.height)[0];
  if (mainBackground) return mainBackground;
  if (![minX, minY, maxX, maxY].every(Number.isFinite) || maxX <= minX || maxY <= minY) return skeleton.getBoundsRect();
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Bounds used for game-like taps, excluding authored backdrops and FX. */
export function interactionBounds(skeleton: Skeleton): SceneBounds | null {
  const bounds = interactionSlots(skeleton)
    .filter((slot) => !isBackdrop(slot))
    .map(attachmentBounds)
    .filter((item): item is SceneBounds => Boolean(item));
  return unionBounds(bounds);
}

/** Test a world-space pointer against the authored character attachments. */
export function interactionHit(skeleton: Skeleton, x: number, y: number): boolean {
  return interactionSlots(skeleton)
    .filter((slot) => !isBackdrop(slot))
    .map((slot) => attachmentBounds(slot))
    .some((bounds) => Boolean(bounds && x >= bounds.x && x <= bounds.x + bounds.width && y >= bounds.y && y <= bounds.y + bounds.height));
}

/**
 * Lobby exports do not carry Unity's Camera component. They do carry the
 * authored scene hierarchy: a root/layer anchor, a backdrop-sized attachment,
 * and sibling cut layers. Use that data for the viewer's fixed camera instead
 * of fitting every attachment in the skeleton.
 */
export function authoredViewport(skeleton: Skeleton, anchorSkeleton: Skeleton = skeleton): AuthoredViewport {
  const rigAnchor = anchorPoint(anchorSkeleton);
  const scene = activeScene(skeleton, rigAnchor);
  const backdrop = scene?.backdrop;
  const setupContainer = scene ? anchorSkeleton.bones[scene.container.data.index] : undefined;
  const anchorBackdrop = setupContainer && anchorSkeleton !== skeleton
    ? sceneInfo(anchorSkeleton, setupContainer).backdrop ?? backdrop : backdrop;
  const fallback = scene?.bounds ?? sceneBounds(skeleton);
  // Older lobbies place independent character/background/FX layers at staging
  // offsets, not at the camera center. If the chosen rig origin is outside its
  // backdrop, it cannot frame that scene. Recover the missing coordinate from
  // the main backdrop, not from the union of offstage props and effect pieces.
  const anchor = {
    x: anchorBackdrop && (rigAnchor.x < anchorBackdrop.x - 0.01 || rigAnchor.x > anchorBackdrop.x + anchorBackdrop.width + 0.01)
      ? anchorBackdrop.x + anchorBackdrop.width / 2 : rigAnchor.x,
    y: anchorBackdrop && (rigAnchor.y < anchorBackdrop.y - 0.01 || rigAnchor.y > anchorBackdrop.y + anchorBackdrop.height + 0.01)
      ? anchorBackdrop.y + anchorBackdrop.height / 2 : rigAnchor.y,
  };
  const width = backdrop?.width ?? fallback.width;
  const height = width / DEFAULT_ASPECT;
  return {
    x: anchor.x - width / 2,
    y: anchor.y - height / 2,
    width,
    height,
    authored: Boolean(scene && backdrop && width > 0),
    anchorX: anchor.x,
    anchorY: anchor.y,
  };
}

export function fitScene(bounds: SceneBounds, viewportWidth: number, viewportHeight: number, fill = false) {
  const widthScale = Math.max(bounds.width, 1) / viewportWidth;
  const heightScale = Math.max(bounds.height, 1) / viewportHeight;
  const zoom = fill ? Math.min(widthScale, heightScale) : Math.max(widthScale, heightScale) * 1.02;
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
    zoom,
  };
}
