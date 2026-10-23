import type { Banner } from "../src/model/domain/types";

function characterKey(banner: Banner) {
  return [...banner.characterIds].sort((a, b) => a - b).join(",");
}

/**
 * Rerun rows sometimes arrive before the wiki has uploaded a new lobby image.
 * Their historical banner art is still the correct visual fallback, so choose
 * the most recent earlier row with the same rate-up roster.
 */
export function reuseRerunBannerImages(
  banners: Banner[],
  availableImageFiles?: ReadonlySet<string>,
): Banner[] {
  const history = [...banners].sort((a, b) => a.startMs - b.startMs || a.id - b.id);
  return banners.map((banner) => {
    if (!banner.rerun) return banner;
    // A non-empty wiki field is not enough: the wiki can publish the row
    // before the corresponding file exists. Keep a cached current image when
    // it is already available, otherwise use the historical fallback below.
    if (banner.imageFile && (availableImageFiles == null || availableImageFiles.has(banner.imageFile))) return banner;
    const key = characterKey(banner);
    if (!key) return banner;
    const previous = history
      .filter((candidate) =>
        candidate.server === banner.server &&
        candidate.startMs < banner.startMs &&
        Boolean(candidate.imageFile) &&
        characterKey(candidate) === key,
      )
      .at(-1);
    return previous?.imageFile && previous.imageFile !== banner.imageFile
      ? { ...banner, imageFile: previous.imageFile }
      : banner;
  });
}
