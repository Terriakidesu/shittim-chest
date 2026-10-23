import { useCallback, useEffect, useState } from "react";
import { t, useLanguage } from "../i18n";
import { IconCompress, IconExpand } from "./icons";

/**
 * Fullscreen toggle for the recruitment simulator. Uses the Fullscreen API
 * on the document element (no dependency, works wherever the API exists).
 * Unsupported browsers (e.g. iPhone Safari) get no button rather than a
 * broken one. Entering fullscreen must come from a user gesture, so this
 * cannot be persisted or auto-applied on load.
 */
export function useFullscreen() {
  const [active, setActive] = useState(
    () => typeof document !== "undefined" && !!document.fullscreenElement,
  );
  const supported =
    typeof document !== "undefined" && !!document.fullscreenEnabled;

  useEffect(() => {
    const onChange = () => setActive(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggle = useCallback(async (landscape = false) => {
    // ScreenOrientation.lock is missing from older TS DOM libs; type the
    // capability structurally and treat it as best-effort regardless.
    const orientation = (
      typeof screen !== "undefined" ? screen.orientation : undefined
    ) as { lock?: (o: string) => Promise<void>; unlock?: () => void } | undefined;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        try {
          await orientation?.unlock?.();
        } catch {
          /* orientation unlock is best-effort */
        }
      } else {
        await document.documentElement.requestFullscreen();
        if (landscape) {
          try {
            await orientation?.lock?.("landscape");
          } catch {
            /* locked orientation is a bonus; portrait guard still applies */
          }
        }
      }
    } catch {
      /* entering fullscreen can fail outside gestures or in some webviews */
    }
  }, []);

  return { active, supported, toggle };
}

export function FullscreenButton({
  className = "",
  landscape = false,
}: {
  className?: string;
  landscape?: boolean;
}) {
  const { active, supported, toggle } = useFullscreen();
  useLanguage();
  if (!supported) return null;
  return (
    <button
      type="button"
      className={className}
      aria-pressed={active}
      aria-label={active ? t("a11y.fullscreenExit") : t("a11y.fullscreenEnter")}
      title={active ? t("a11y.fullscreenExit") : t("a11y.fullscreenEnter")}
      onClick={() => void toggle(landscape)}
    >
      {active ? <IconCompress /> : <IconExpand />}
    </button>
  );
}
