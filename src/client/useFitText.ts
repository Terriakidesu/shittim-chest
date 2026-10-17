import { useLayoutEffect, type RefObject } from "react";

/** Largest readable size that fits, without expanding the nameplate. */
export function fittingFontSize(preferred: number, minimum: number, fits: (size: number) => boolean) {
  if (fits(preferred)) return preferred;
  let low = Math.min(minimum, preferred);
  let high = preferred;
  for (let step = 0; step < 12; step++) {
    const middle = (low + high) / 2;
    if (fits(middle)) low = middle;
    else high = middle;
  }
  return low;
}

/** The child span retains its intrinsic width, while the heading has a fixed
 * available box. Refit on resize/rotation and after the actual font loads. */
export function useFitText(ref: RefObject<HTMLElement | null>, text: string) {
  useLayoutEffect(() => {
    const element = ref.current;
    const content = element?.querySelector("span");
    if (!element || !content) return;
    let live = true;
    const fit = () => {
      if (!live || !element.clientWidth || !element.clientHeight) return;
      element.style.removeProperty("--fit-font-size");
      const style = getComputedStyle(element);
      const width = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 3;
      const preferred = parseFloat(style.fontSize);
      const size = fittingFontSize(preferred, 10, (candidate) => {
        element.style.setProperty("--fit-font-size", `${candidate}px`);
        return content.scrollWidth <= width && content.offsetHeight <= element.clientHeight;
      });
      element.style.setProperty("--fit-font-size", `${size}px`);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    void document.fonts.ready.then(fit);
    document.fonts.addEventListener("loadingdone", fit);
    return () => {
      live = false;
      observer.disconnect();
      document.fonts.removeEventListener("loadingdone", fit);
    };
  }, [ref, text]);
}
