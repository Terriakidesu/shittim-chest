import { describe, expect, test } from "bun:test";
import { nextUnseenPurple } from "./recruitmentSequence";
import { CARD_FLIP_MS, CARD_SPREAD_MS, cardImpactMs, portraitEntranceMs } from "./recruitmentTiming";

describe("skip recruitment", () => {
  const results = [
    { rarity: 1, duplicate: false },
    { rarity: 3, duplicate: true },
    { rarity: 3, duplicate: false },
    { rarity: 2, duplicate: false },
    { rarity: 3, duplicate: false },
  ];
  test("stops at the first new purple, ignoring duplicates and lower rarities", () => {
    expect(nextUnseenPurple(results, 0)).toBe(2);
  });
  test("continues to each remaining new purple after acknowledgment", () => {
    expect(nextUnseenPurple(results, 3)).toBe(4);
    expect(nextUnseenPurple(results, 5)).toBe(-1);
  });
  test("handles empty and single-pull batches", () => {
    expect(nextUnseenPurple([], 0)).toBe(-1);
    expect(nextUnseenPurple([{ rarity: 3, duplicate: false }], 0)).toBe(0);
    expect(nextUnseenPurple([{ rarity: 3, duplicate: true }], 0)).toBe(-1);
  });
});

test("reference timing leaves the spread settled and aligns the nonlinear flip", () => {
  expect(CARD_SPREAD_MS).toBeGreaterThanOrEqual(9 * 100 + 700);
  for (const rarity of [1, 2, 3] as const) {
    expect(cardImpactMs(rarity)).toBeGreaterThan(0);
    expect(cardImpactMs(rarity)).toBeLessThan(CARD_FLIP_MS[rarity] / 2);
    expect(portraitEntranceMs(rarity)).toBeGreaterThan(cardImpactMs(rarity));
    expect(portraitEntranceMs(rarity)).toBeLessThan(CARD_FLIP_MS[rarity]);
  }
});
