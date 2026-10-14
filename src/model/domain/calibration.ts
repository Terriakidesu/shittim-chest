import { evaluateAt, verifiedTruth } from "./evaluation";
import type { CalibrationRecord } from "./forecast";
import type { Banner } from "./types";

const DAY = 86_400_000;
/** Reconstruct past forecasts; only outcomes already realised as of now are available. */
export function buildCalibration(banners: Banner[], asOfMs: number): CalibrationRecord[] {
  const realised = banners.filter(b => b.startMs <= asOfMs);
  const truth = verifiedTruth(realised);
  const records: CalibrationRecord[] = [];
  for (let cutoff = asOfMs - 730 * DAY; cutoff < asOfMs - 14 * DAY; cutoff += 28 * DAY) {
    const result = evaluateAt(realised, cutoff, truth);
    records.push(...result.candidates.filter(s => s.truthMs <= asOfMs));
  }
  return records;
}
