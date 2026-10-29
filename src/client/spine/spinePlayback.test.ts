import { describe, expect, test } from "bun:test";
import { Animation, AnimationState, AnimationStateData, BoneData, Skeleton, SkeletonData } from "@esotericsoftware/spine-core";
import { findIdleAnimation, findIntroAnimation, INTRO_ANIMATION, SpineRenderer } from "./spineRuntime";

function playback(selection: string) {
  const data = new SkeletonData();
  data.bones.push(new BoneData(0, "root", null));
  data.animations.push(new Animation("Start_Idle_01", [], 2), new Animation("Idle_01", [], 4));
  const state = new AnimationState(new AnimationStateData(data));
  state.setAnimation(0, "Idle_01", true).trackTime = 3;
  const renderer = Object.assign(Object.create(SpineRenderer.prototype), {
    playing: false,
    loop: true,
    animationSelection: selection,
    bundle: {
      state,
      skeleton: new Skeleton(data),
      meta: { introAnimation: "Start_Idle_01", idleAnimation: "Idle_01" },
    },
  }) as SpineRenderer;
  return { renderer, state };
}

describe("Spine restart playback", () => {
  test("recognizes the alternate Konoka idle name", () => {
    expect(findIntroAnimation(["Dummy", "Start_Idle_01", "Idle"])).toBe("Start_Idle_01");
    expect(findIdleAnimation(["Dummy", "Start_Idle_01", "Idle"])).toBe("Idle");
  });

  test("prefers the normal idle when a set also has idle variants", () => {
    expect(findIntroAnimation(["Start_Idle_1", "Idle_01", "Idle_01_R"])).toBe("Start_Idle_1");
    expect(findIdleAnimation(["Start_Idle_1", "Idle_01", "Idle_01_R"])).toBe("Idle_01");
    expect(findIntroAnimation(["Dev/Dev_Start_Idle_01", "Idle_01"])).toBeNull();
  });

  test("restarts the intro after the queued idle has already begun", () => {
    const { renderer, state } = playback(INTRO_ANIMATION);
    renderer.restartPlayback();
    const entry = state.getCurrent(0)!;
    expect(entry.animation?.name).toBe("Start_Idle_01");
    expect(entry.trackTime).toBe(0);
    expect(entry.loop).toBe(false);
    expect(entry.next?.animation?.name).toBe("Idle_01");
    expect(entry.next?.loop).toBe(true);
  });

  test("restarts an unchanged standalone selection instead of ignoring it", () => {
    const { renderer, state } = playback("Idle_01");
    renderer.restartPlayback();
    expect(state.getCurrent(0)?.animation?.name).toBe("Idle_01");
    expect(state.getCurrent(0)?.trackTime).toBe(0);
    expect(state.getCurrent(0)?.next).toBeNull();
  });

  test("limits touch-target deformation when the pointer is far outside the rig", () => {
    const data = new SkeletonData();
    const root = new BoneData(0, "root", null);
    const touchPoint = new BoneData(1, "Touch_Point", root);
    data.bones.push(root, touchPoint);
    const skeleton = new Skeleton(data);
    skeleton.updateWorldTransform(0 as never);
    const target = skeleton.findBone("Touch_Point")!;
    const renderer = Object.assign(Object.create(SpineRenderer.prototype), {
      bundle: { skeleton, touchTarget: { bone: target, baseX: 0, baseY: 0, rangeX: 100, rangeY: 50 } },
      pointerWorld: () => ({ x: 1000, y: -1000 }),
      touchPointerOrigin: { x: 0, y: 0 },
      interactionFollowWorld: null,
    }) as any;
    renderer.applyTouchFollow(1);
    expect(target.x).toBeGreaterThan(0);
    expect(target.y).toBeLessThan(0);
    expect(Math.hypot(target.x / 100, target.y / 50)).toBeLessThanOrEqual(1);
    expect(target.x).toBeCloseTo(100 / Math.sqrt(5), 1);
    expect(target.y).toBeCloseTo(-100 / Math.sqrt(5), 1);
  });

  test("eases touch-target movement toward the clamp instead of jumping there", () => {
    const data = new SkeletonData();
    const root = new BoneData(0, "root", null);
    const touchPoint = new BoneData(1, "Touch_Point", root);
    data.bones.push(root, touchPoint);
    const skeleton = new Skeleton(data);
    skeleton.updateWorldTransform(0 as never);
    const target = skeleton.findBone("Touch_Point")!;
    const renderer = Object.assign(Object.create(SpineRenderer.prototype), {
      bundle: { skeleton, touchTarget: { bone: target, baseX: 0, baseY: 0, rangeX: 100, rangeY: 50 } },
      pointerWorld: () => ({ x: 1000, y: -1000 }),
      touchPointerOrigin: { x: 0, y: 0 },
      interactionFollowWorld: null,
    }) as any;
    renderer.applyTouchFollow(1 / 60);
    const firstX = target.x;
    renderer.applyTouchFollow(1 / 60);
    expect(firstX).toBeGreaterThan(0);
    expect(firstX).toBeLessThan(100);
    expect(target.x).toBeGreaterThan(firstX);
    expect(target.x).toBeLessThan(100);
  });

  test("a stationary press preserves the pose and only relative dragging deforms it", () => {
    const data = new SkeletonData();
    const root = new BoneData(0, "root", null);
    root.scaleX = 2;
    root.scaleY = 2;
    const point = new BoneData(1, "Touch_Point", root);
    point.x = 20;
    point.y = 30;
    data.bones.push(root, point);
    const skeleton = new Skeleton(data);
    skeleton.updateWorldTransform(0 as never);
    const target = skeleton.findBone("Touch_Point")!;
    const pointer = { x: 1000, y: -1000 };
    const renderer = Object.assign(Object.create(SpineRenderer.prototype), {
      bundle: { skeleton, touchTarget: { bone: target, baseX: 20, baseY: 30, rangeX: 90, rangeY: 65 } },
      pointerWorld: () => pointer,
    }) as any;
    renderer.applyTouchFollow(1);
    expect(target.x).toBeCloseTo(20, 4);
    expect(target.y).toBeCloseTo(30, 4);
    pointer.x += 80;
    renderer.applyTouchFollow(1);
    // 80 world units * 25% sensitivity / 2x parent scale = 10 local units.
    expect(target.x).toBeCloseTo(30, 1);
    expect(target.y).toBeCloseTo(30, 4);
    root.x = 500;
    skeleton.bones[0]!.x = root.x;
    skeleton.updateWorldTransform(0 as never);
    renderer.applyTouchFollow(1);
    expect(target.x).toBeCloseTo(30, 1);
  });

  test("runs touch start, follow, release, then returns to idle", () => {
    const data = new SkeletonData();
    data.bones.push(new BoneData(0, "root", null));
    data.animations.push(
      new Animation("Touch_01_M", [], 0.5),
      new Animation("Touch_02_M", [], 1),
      new Animation("TouchEnd_01_M", [], 0.25),
    );
    const skeleton = new Skeleton(data);
    const state = new AnimationState(new AnimationStateData(data));
    state.setAnimation(3, "Touch_01_M", false);
    state.update(0.5);
    state.apply(skeleton);
    const renderer = Object.assign(Object.create(SpineRenderer.prototype), {
      bundle: {
        state,
        skeleton,
        interaction: {
          touch: {
            start: { main: "Touch_01_M", face: null },
            follow: { main: "Touch_02_M", face: null },
            release: { main: "TouchEnd_01_M", face: null },
          },
        },
      },
      interactionState: "touchStart",
      interactionTrackName: "Touch_01_M",
      interactionPointerHeld: true,
      interactionPressedKind: "touch",
      interactionFollowWorld: null,
    }) as any;

    renderer.finishInteractionState();
    expect(state.getCurrent(3)?.animation?.name).toBe("Touch_02_M");
    expect(state.getCurrent(3)?.loop).toBe(true);

    renderer.interactionPointerHeld = false;
    renderer.interactionPressedKind = null;
    renderer.endGesture();
    expect(state.getCurrent(3)?.animation?.name).toBe("TouchEnd_01_M");

    state.update(0.25);
    state.apply(skeleton);
    renderer.finishInteractionState();
    expect(renderer.interactionState).toBe("idle");
  });
});
