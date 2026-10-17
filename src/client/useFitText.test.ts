import { expect, test } from "bun:test";
import { fittingFontSize } from "./useFitText";

test("short names keep their preferred size", () => {
  expect(fittingFontSize(46, 10, (size) => size * 4 <= 300)).toBe(46);
});

test("long names shrink to the available width instead of wrapping", () => {
  const size = fittingFontSize(46, 10, (candidate) => candidate * 15 <= 330);
  expect(size).toBeGreaterThan(21.98);
  expect(size).toBeLessThanOrEqual(22);
});

test("resizing can grow names back and the height limit is respected", () => {
  expect(fittingFontSize(46, 10, (size) => size <= 20)).toBeLessThanOrEqual(20);
  expect(fittingFontSize(46, 10, (size) => size <= 50)).toBe(46);
  expect(fittingFontSize(46, 10, () => false)).toBe(10);
});
