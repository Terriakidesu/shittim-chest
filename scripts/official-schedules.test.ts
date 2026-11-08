import { expect, test } from "bun:test";
import type { Banner, Prediction } from "../src/model/domain/types";
import { applyOfficialGlobalSchedules } from "./official-schedules";

const jp = (code: string, id: number): Banner => ({
  id,
  server: "JP",
  code,
  type: "LimitedGacha",
  rateupRaw: code,
  characterIds: [id],
  rerun: true,
  limited: true,
  startMs: Date.UTC(2026, 6, 8),
  endMs: Date.UTC(2026, 6, 22),
  evergreen: false,
  imageFile: null,
  nameJp: null,
  nameEn: null,
  notes: null,
});

test("the complete October 27 batch replaces estimates", () => {
  const codes = [
    "Hikari_rerun1",
    "Nozomi_rerun1",
    "Saori_(Swimsuit)_rerun2",
    "Hiyori_(Swimsuit)_rerun2",
    "Misaki_(Swimsuit)_rerun1",
  ];
  const banners = codes.map((code, index) => jp(code, 1024 + index));
  const predictions = new Map<number, Prediction>([
    [1024, { bannerId: 1024, expectedMs: 1, p05Ms: 1, p95Ms: 1, confidence: .9, confidenceToleranceDays: 7, intervalCoverage: .9, calibrationSamples: 20, method: "recent-lag", explanation: "estimate", glBatchIndex: 1, glBatchStartMs: 1 }],
  ]);
  applyOfficialGlobalSchedules(banners, predictions, new Map());
  for (const id of banners.map((banner) => banner.id)) {
    const prediction = predictions.get(id)!;
    expect(prediction.expectedMs).toBe(Date.UTC(2026, 9, 27, 2));
    expect(prediction.p05Ms).toBe(prediction.expectedMs);
    expect(prediction.p95Ms).toBe(prediction.expectedMs);
    expect(prediction.method).toBe("scheduled");
    expect(prediction.source).toBe("official");
  }
});

test("the November 10 swimsuit pickups replace the November 17 estimates", () => {
  const codes = ["Makoto_(Swimsuit)_release", "Satsuki_(Swimsuit)_release"];
  const banners = codes.map((code, index) => jp(code, 1040 + index));
  const nov10 = Date.UTC(2026, 10, 10, 2);
  const predictions = new Map<number, Prediction>(
    banners.map((banner) => [
      banner.id,
      {
        bannerId: banner.id,
        expectedMs: Date.UTC(2026, 10, 17, 2),
        p05Ms: Date.UTC(2026, 9, 27, 2),
        p95Ms: Date.UTC(2026, 11, 1, 2),
        confidence: .9,
        confidenceToleranceDays: 7,
        intervalCoverage: .9,
        calibrationSamples: 71,
        method: "recent-lag",
        explanation: "estimate",
        glBatchIndex: 179,
        glBatchStartMs: Date.UTC(2026, 10, 17, 2),
      },
    ]),
  );

  applyOfficialGlobalSchedules(
    banners,
    predictions,
    new Map(),
    [
      { index: 178, step: 1, startMs: nov10, endMs: nov10 + 14 * 86_400_000 },
      {
        index: 179,
        step: 2,
        startMs: Date.UTC(2026, 10, 17, 2),
        endMs: Date.UTC(2026, 10, 17, 2) + 14 * 86_400_000,
      },
    ],
  );

  for (const banner of banners) {
    const prediction = predictions.get(banner.id)!;
    expect(prediction.expectedMs).toBe(nov10);
    expect(prediction.p05Ms).toBe(nov10);
    expect(prediction.p95Ms).toBe(nov10);
    expect(prediction.method).toBe("scheduled");
    expect(prediction.source).toBe("official");
    expect(prediction.glBatchIndex).toBe(178);
    expect(prediction.glBatchStartMs).toBe(nov10);
  }
});

test("an already arrived Global match is not overridden", () => {
  const banner = jp("Hikari_rerun1", 1024);
  const predictions = new Map<number, Prediction>();
  applyOfficialGlobalSchedules([banner], predictions, new Map([[1024, { ...banner, server: "GL" }]]));
  expect(predictions).toEqual(new Map());
});
