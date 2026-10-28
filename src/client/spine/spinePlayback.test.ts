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
});
