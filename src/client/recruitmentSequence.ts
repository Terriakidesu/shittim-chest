// `opened` includes the current student, acknowledged by the next/skip gesture.
// Skipping must never silently discard an unseen, non-duplicate 3-star result.
export function nextUnseenPurple(results: readonly { rarity: number; duplicate: boolean }[], opened: number) {
  return results.findIndex((result, index) => index >= opened && result.rarity === 3 && !result.duplicate);
}
