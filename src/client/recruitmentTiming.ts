// Shared by visual animation and audio scheduling; values are milliseconds.
export const DISPATCH_DEPARTURE_MS = 240;
export const RESULTS_SETTLE_MS = 180;
export const CARD_FLIP_MS = { 1: 560, 2: 660, 3: 780 } as const;
export function cardImpactMs(rarity: 1 | 2 | 3) { return CARD_FLIP_MS[rarity] / 2; }
export function portraitEntranceMs(rarity: 1 | 2 | 3) { return cardImpactMs(rarity) + 160; }
