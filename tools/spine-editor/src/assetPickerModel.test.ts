import { describe, expect, test } from "bun:test";
import { initialPickerIndex, movePickerIndex } from "./assetPickerModel";

describe("asset picker keyboard navigation", () => {
  test("starts on the selected option or first result", () => {
    expect(initialPickerIndex(2, 4)).toBe(2);
    expect(initialPickerIndex(-1, 4)).toBe(0);
    expect(initialPickerIndex(0, 0)).toBe(-1);
  });

  test("arrow navigation stays inside the result list", () => {
    expect(movePickerIndex(0, -1, 3)).toBe(0);
    expect(movePickerIndex(0, 1, 3)).toBe(1);
    expect(movePickerIndex(2, 1, 3)).toBe(2);
    expect(movePickerIndex(0, 1, 0)).toBe(-1);
  });
});
