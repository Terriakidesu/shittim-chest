import { describe, expect, test } from "bun:test";
import type { SpineEditorBone } from "../../../src/client/spine/spineRuntime";
import {
  createProject,
  isLegacyPinchRegion,
  normalizeProject,
  normalizeViewSettings,
  repairPinchRegions,
  validateProject,
  type EditorProject,
} from "./editorModel";

function bone(path: string, name = path.split("/").pop()!, x = 0, y = 0): SpineEditorBone {
  return {
    path,
    name,
    parentPath: null,
    x,
    y,
    endX: x + 10,
    endY: y,
    screenX: x,
    screenY: y,
    screenEndX: x + 10,
    screenEndY: y,
    screenLocalXEndX: x + 1,
    screenLocalXEndY: y,
    screenLocalYEndX: x,
    screenLocalYEndY: y + 1,
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    length: 10,
    rotation: 0,
    active: true,
  };
}

describe("Spine editor project model", () => {
  test("an intentionally empty project survives save/load", () => {
    const empty = normalizeProject({ schemaVersion: 1, interactions: [] }, "test");
    expect(empty?.interactions).toEqual([]);
    expect(empty?.selectedInteractionId).toBeNull();
    expect(empty?.selectedRegionId).toBeNull();
  });
  test("detects supported interaction presets and keeps bone-relative regions", () => {
    const project = createProject("Airi_home", ["Idle_01", "Touch_01_M", "Touch_02_M", "TouchEnd_01_M", "Pinch_01_M", "Pat2_01_M", "Pat2_02_M"], [bone("root"), bone("root/Touch_Point", "Touch_Point")]);
    expect(project.interactions.map((item) => item.name)).toEqual(["Touch", "Cheek pinch", "Patting"]);
    expect(project.interactions[0]?.startAnimation).toBe("Touch_01_M");
    expect(project.interactions[0]?.followAnimation).toBe("Touch_02_M");
    expect(project.interactions[0]?.endAnimation).toBe("TouchEnd_01_M");
    expect(project.interactions[0]?.regions[0]?.anchorBone).toBe("root/Touch_Point");
  });

  test("pat presets use release animations rather than selecting the unchanged start name", () => {
    const project = createProject("test", ["Idle_01", "Pat_01_M", "Pat_01_A", "PatEnd_01_M", "PatEnd_01_A"], []);
    expect(project.interactions[0]?.endAnimation).toBe("PatEnd_01_M");
    expect(project.interactions[0]?.faceEndAnimation).toBe("PatEnd_01_A");
  });

  test("normalizes imported projects and repairs stale selections", () => {
    const project = normalizeProject({
      schemaVersion: 1,
      name: "Imported",
      interactions: [{
        id: "touch",
        name: "Touch",
        regions: [{ id: "hand", name: "Hand", shape: "rectangle", anchorBone: "root/hand", offsetX: 12, offsetY: -4, radiusX: 80, radiusY: 40, rotation: 12 }],
      }],
      selectedInteractionId: "deleted",
      selectedRegionId: "deleted",
    }, "Airi_home");
    expect(project?.selectedInteractionId).toBe("touch");
    expect(project?.selectedRegionId).toBe("hand");
    expect(project?.interactions[0]?.regions[0]).toMatchObject({
      shape: "rectangle",
      anchorBone: "root/hand",
      offsetX: 12,
      offsetY: -4,
      radiusX: 80,
      radiusY: 40,
      rotation: 12,
    });
    expect(normalizeProject({ schemaVersion: 99, interactions: [{ id: "x" }] }, "Airi_home")).toBeNull();
  });

  test("normalizes shared bone display settings", () => {
    expect(normalizeViewSettings({ showBones: false, showBoneNames: true, showConstraints: false, showInactiveBones: true })).toEqual({
      showBones: false,
      showBoneNames: true,
      showConstraints: false,
      showInactiveBones: true,
    });
    expect(normalizeViewSettings(null)).toBeNull();
  });

  test("places pinch regions on cheek controls and repairs the old Touch_Point default", () => {
    const animations = ["Idle_01", "Pinch_01_M", "Pinch_02_M", "PinchEnd_01_M"];
    const touchOnly = [bone("root/Touch_Point", "Touch_Point")];
    const cheekControls = [...touchOnly, bone("root/L_chin_rot", "L_chin_rot"), bone("root/R_chin_rot", "R_chin_rot")];
    const keyedControls = [
      ...touchOnly,
      bone("root/Touch_Point/Touch_Point_Key", "Touch_Point_Key"),
      ...cheekControls.slice(1),
    ];
    const detected = createProject("Kei_home", animations, cheekControls).interactions[0]!;
    expect(detected.regions.map((region) => region.anchorBone)).toEqual(["root/L_chin_rot", "root/R_chin_rot"]);
    expect(detected.regions.map((region) => region.placement)).toEqual(["cheek-v1", "cheek-v1"]);
    expect(createProject("Kei_home", animations, keyedControls).interactions[0]?.followTargetBone).toBe("root/Touch_Point/Touch_Point_Key");

    const legacy = createProject("Kei_home", animations, touchOnly);
    const oldRegion = legacy.interactions[0]!.regions[0]!;
    expect(isLegacyPinchRegion(legacy, oldRegion)).toBe(true);
    const repaired = repairPinchRegions(legacy, keyedControls);
    expect(repaired.repaired).toBe(1);
    expect(repaired.project.interactions[0]?.followTargetBone).toBe("root/Touch_Point/Touch_Point_Key");
    expect(repaired.project.interactions[0]?.regions.map((region) => region.name)).toEqual(["Left cheek", "Right cheek"]);
  });

  test("reports missing references and overlapping enabled regions", () => {
    const project = normalizeProject({
      schemaVersion: 1,
      interactions: [
        {
          id: "left",
          name: "Left",
          startAnimation: "Missing_Start",
          followTargetBone: "root/missing",
          regions: [{ id: "left-region", name: "Left region", anchorBone: "root", radiusX: 40, radiusY: 40 }],
        },
        {
          id: "right",
          name: "Right",
          regions: [{ id: "right-region", name: "Right region", anchorBone: "root", offsetX: 10, radiusX: 40, radiusY: 40 }],
        },
      ],
    }, "Airi_home") as EditorProject;
    const warnings = validateProject(project, ["Idle_01"], [bone("root")]);
    expect(warnings.map((warning) => warning.kind)).toEqual(["missing-animation", "missing-bone", "overlap"]);
    expect(warnings[2]?.message).toContain("overlaps");
  });
});
