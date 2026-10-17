// Shared by visual animation and audio scheduling; values are milliseconds.
export const DISPATCH_DEPARTURE_MS = 240;
export const RESULTS_SETTLE_MS = 180;
export const CARD_SPREAD_MS = 1600;
export const CARD_FLIP_MS = { 1: 2500, 2: 2500, 3: 2500 } as const;

// The reference flip reaches 180deg at the 90% keyframe. Find its 90deg
// crossing on cubic-bezier(.51, -.33, .38, 1.05), not halfway through time.
function flipMidpoint() {
  const cubic = (t: number, a: number, b: number) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 32; i++) {
    const middle = (low + high) / 2;
    if (cubic(middle, -.33, 1.05) < .5) low = middle;
    else high = middle;
  }
  return cubic((low + high) / 2, .51, .38) * .9;
}
const FLIP_MIDPOINT = flipMidpoint();
export function cardImpactMs(rarity: 1 | 2 | 3) { return CARD_FLIP_MS[rarity] * FLIP_MIDPOINT; }
export function portraitEntranceMs(rarity: 1 | 2 | 3) { return cardImpactMs(rarity) + 160; }
