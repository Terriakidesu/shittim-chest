import type { SpineEditorBone } from "../../../src/client/spine/spineRuntime";

export interface BoneTreeRow {
  bone: SpineEditorBone;
  depth: number;
  hasChildren: boolean;
  isLastSibling: boolean;
  ancestorContinues: boolean[];
  matches: boolean;
  contextOnly: boolean;
}

function ancestorsOf(bone: SpineEditorBone, byPath: Map<string, SpineEditorBone>): SpineEditorBone[] {
  const ancestors: SpineEditorBone[] = [];
  const visited = new Set<string>([bone.path]);
  let parentPath = bone.parentPath;
  while (parentPath && !visited.has(parentPath)) {
    visited.add(parentPath);
    const parent = byPath.get(parentPath);
    if (!parent) break;
    ancestors.unshift(parent);
    parentPath = parent.parentPath;
  }
  return ancestors;
}

/** Build the visible rows for the rig tree while retaining ancestors as context. */
export function buildBoneTreeRows(
  bones: SpineEditorBone[],
  collapsed: ReadonlySet<string>,
  search: string,
  showInactive = false,
): BoneTreeRow[] {
  const byPath = new Map(bones.map((bone) => [bone.path, bone]));
  const ancestorMap = new Map(bones.map((bone) => [bone.path, ancestorsOf(bone, byPath)]));
  const eligible = bones.filter((bone) => showInactive || bone.active);
  const eligiblePaths = new Set(eligible.map((bone) => bone.path));
  const query = search.trim().toLocaleLowerCase();
  const matches = new Set<string>();
  const included = new Set<string>();

  if (query) {
    for (const bone of eligible) {
      if (!`${bone.name} ${bone.path}`.toLocaleLowerCase().includes(query)) continue;
      matches.add(bone.path);
      included.add(bone.path);
      for (const ancestor of ancestorMap.get(bone.path) ?? []) included.add(ancestor.path);
    }
  } else {
    for (const bone of eligible) {
      included.add(bone.path);
      for (const ancestor of ancestorMap.get(bone.path) ?? []) included.add(ancestor.path);
    }
  }

  const candidates = bones.filter((bone) => included.has(bone.path));
  const children = new Map<string, SpineEditorBone[]>();
  for (const bone of candidates) {
    const parent = bone.parentPath ?? "";
    const siblings = children.get(parent) ?? [];
    siblings.push(bone);
    children.set(parent, siblings);
  }
  const siblingPositions = new Map<string, { isLast: boolean }>();
  for (const siblings of children.values()) {
    siblings.forEach((bone, index) => siblingPositions.set(bone.path, { isLast: index === siblings.length - 1 }));
  }

  const visible = query
    ? candidates
    : candidates.filter((bone) => !(ancestorMap.get(bone.path) ?? []).some((ancestor) => collapsed.has(ancestor.path)));

  return visible.map((bone) => {
    const ancestors = ancestorMap.get(bone.path) ?? [];
    return {
      bone,
      depth: ancestors.length,
      hasChildren: (children.get(bone.path) ?? []).length > 0,
      isLastSibling: siblingPositions.get(bone.path)?.isLast ?? true,
      ancestorContinues: ancestors.map((ancestor) => !(siblingPositions.get(ancestor.path)?.isLast ?? true)),
      matches: matches.has(bone.path),
      contextOnly: !eligiblePaths.has(bone.path),
    };
  });
}

/** Match exact/name-prefix/name-substring before path-only hits, without truncating results. */
export function rankBoneMatches(bones: SpineEditorBone[], search: string): SpineEditorBone[] {
  const query = search.trim().toLocaleLowerCase();
  if (!query) return bones;

  return bones
    .map((bone, index) => {
      const name = bone.name.toLocaleLowerCase();
      const path = bone.path.toLocaleLowerCase();
      const score = name === query ? 0
        : name.startsWith(query) ? 1
          : name.includes(query) ? 2
            : path.split("/").some((part) => part === query) ? 3
              : path.includes(query) ? 4
                : Number.POSITIVE_INFINITY;
      return { bone, index, score };
    })
    .filter((result) => Number.isFinite(result.score))
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .map((result) => result.bone);
}
