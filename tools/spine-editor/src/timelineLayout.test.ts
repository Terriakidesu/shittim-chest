import { expect, test } from "bun:test";
import { clampTimelinePreviewShare, DEFAULT_TIMELINE_PREVIEW_SHARE, normalizeTimelinePreviewShare } from "./timelineLayout";

test("timeline preview split stays within usable bounds", () => {
  expect(clampTimelinePreviewShare(12)).toBe(25);
  expect(clampTimelinePreviewShare(52.6)).toBe(53);
  expect(clampTimelinePreviewShare(90)).toBe(75);
});

test("timeline preview split preferences reject invalid values", () => {
  expect(normalizeTimelinePreviewShare(undefined)).toBe(DEFAULT_TIMELINE_PREVIEW_SHARE);
  expect(normalizeTimelinePreviewShare(Number.NaN)).toBe(DEFAULT_TIMELINE_PREVIEW_SHARE);
  expect(normalizeTimelinePreviewShare(34)).toBe(34);
});
