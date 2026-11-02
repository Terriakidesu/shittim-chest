export function movePickerIndex(index: number, direction: -1 | 1, count: number): number {
  if (count <= 0) return -1;
  return Math.max(0, Math.min(count - 1, index + direction));
}

export function initialPickerIndex(selectedIndex: number, count: number): number {
  if (count <= 0) return -1;
  return Math.max(0, Math.min(count - 1, selectedIndex >= 0 ? selectedIndex : 0));
}
