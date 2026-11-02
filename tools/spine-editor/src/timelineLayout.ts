export const TIMELINE_LAYOUT_PREFERENCES_KEY = "shittim-spine-editor:timeline-layout-preferences:v1";

export const DEFAULT_TIMELINE_PREVIEW_SHARE = 52;
export const MIN_TIMELINE_PREVIEW_SHARE = 25;
export const MAX_TIMELINE_PREVIEW_SHARE = 75;

export function clampTimelinePreviewShare(value: number): number {
  return Math.round(Math.min(MAX_TIMELINE_PREVIEW_SHARE, Math.max(MIN_TIMELINE_PREVIEW_SHARE, value)));
}

export function normalizeTimelinePreviewShare(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? clampTimelinePreviewShare(value)
    : DEFAULT_TIMELINE_PREVIEW_SHARE;
}
