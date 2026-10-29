import { describe, expect, test } from "bun:test";
import { BoneData, Physics, Skeleton, SkeletonData } from "@esotericsoftware/spine-core";
import { applyInteractionMotion, beginInteractionMotion, createInteractionMotionState } from "./spineInteractionMotion";

describe("Spine interaction motion", () => {
  test("limits headpat movement against the first child bone local Y axis", () => {
    const data = new SkeletonData();
    const root = new BoneData(0, "root", null);
    const target = new BoneData(1, "Touch_Point", root);
    const next = new BoneData(2, "Touch_Point_Key", target);
    next.rotation = 90;
    data.bones.push(root, target, next);
    const skeleton = new Skeleton(data);
    skeleton.updateWorldTransform(Physics.pose);
    const targetBone = skeleton.findBone("Touch_Point")!;
    const nextBone = skeleton.findBone("Touch_Point_Key")!;
    const state = createInteractionMotionState();
    beginInteractionMotion(state, {
      startAnimation: "",
      followTargetBone: "root/Touch_Point",
      sensitivity: 1,
      limitX: 1000,
      limitY: 10,
      smoothing: 1000,
    }, "pat", { x: 0, y: 0 });

    applyInteractionMotion(state, skeleton, { x: 100, y: 0 }, 1);

    expect(targetBone.x).toBeCloseTo(10, 2);
    expect(targetBone.y).toBeCloseTo(0, 2);
    expect(nextBone.worldX).toBeCloseTo(10, 2);
  });
});
