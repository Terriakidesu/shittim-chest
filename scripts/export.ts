#!/usr/bin/env bun
/**
 * Static export for the serverless GitHub Pages client.
 *
 * Rebuilds the whole forecast from the upstream sources (Blue Archive Wiki +
 * SchaleDB) and writes it as plain JSON under `public/data/`, then mirrors
 * every referenced artwork file under `public/img/`. The browser client only
 * ever reads these local files — it makes no API calls and hotlinks nothing.
 *
 * Run by hand (`bun run export`) and by the weekly forecast cron workflow:
 *   bun run scripts/export.ts [--skip-images] [--images-only] [--out public]
 *
 * The forecast model in `src/model/` is vendored from the full-stack
 * `blue-archive-gacha-calendar` project (config + domain + sources only; no
 * server, database or image-proxy code). Keep it in sync when that logic
 * changes — the DTO shapes below must match `src/client/api.ts`.
 */

import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { CONFIG, SCHOOL_EMBLEMS } from "../src/model/config";
import { BlueArchiveWikiSource } from "../src/model/sources/bawiki";
import { SchaleDbSource } from "../src/model/sources/schaledb";
import { WikiClubSource } from "../src/model/sources/wikiclubs";
import { CharacterIndex } from "../src/model/domain/characters";
import { normalizeAll } from "../src/model/domain/normalize";
import { splitRateup } from "../src/model/domain/characters";
import { buildBatches, indexBatches, type BatchIndex } from "../src/model/domain/batches";
import { matchBanners, matchSummary } from "../src/model/domain/match";
import { alignBatches, batchAnchors, type Alignment } from "../src/model/domain/align";
import { fitCadence, type CadenceModel } from "../src/model/domain/cadence";
import {
  buildForecastContext,
  currentLagDays,
  forecastJpBanners,
  type ForecastContext,
} from "../src/model/domain/forecast";
import type { Banner, Batch, Prediction } from "../src/model/domain/types";
import { buildCalibration } from "../src/model/domain/calibration";
import { verifiedTruth } from "../src/model/domain/evaluation";
import { fetchStudentProfiles, type StudentProfileDto } from "./student-profiles";
import { reuseRerunBannerImages } from "./banner-art";
import { applyOfficialGlobalSchedules } from "./official-schedules";

/* ------------------------------------------------------------------ */
/* Local (relative) artwork paths. No leading slash: the built site may */
/* live at a repository subpath, so every URL stays relative.          */
/* ------------------------------------------------------------------ */

const avatarPath = (id: number) => `img/avatar/${id}.webp`;
const portraitPath = (id: number) => `img/portrait/${id}.webp`;
const bannerPath = (file: string) => `img/banner/${file}`;

interface BannerDto {
  id: number;
  server: "JP" | "GL";
  type: string;
  code: string | null;
  rerun: boolean;
  limited: boolean;
  evergreen: boolean;
  startMs: number;
  endMs: number;
  characters: {
    id: number;
    name: string;
    school: string;
    starGrade: number;
    avatar: string;
    availability: "permanent" | "limited" | "event";
  }[];
  imageUrl: string | null;
  confirmedGlStartMs: number | null;
  prediction: Prediction | null;
  forecastStatus: "arrived" | "scheduled" | "estimated" | "unresolved";
}

interface Snapshot {
  studentProfiles: Map<number, StudentProfileDto>;
  banners: Banner[];
  batchIndex: BatchIndex;
  characters: CharacterIndex;
  alignment: Alignment;
  cadence: CadenceModel;
  predictions: Map<number, Prediction>;
  forecast: ForecastContext;
  fetchedAtMs: number;
  lagDays: number | null;
  matches: ReturnType<typeof matchSummary>;
  confirmed: Map<number, Banner>;
  unresolved: Set<number>;
  wikiMeta: { key: string; label: string; fetchedAtMs: number; lastModified?: string };
  schaleMeta: { key: string; label: string; fetchedAtMs: number; lastModified?: string };
  clubMeta?: { key: string; label: string; fetchedAtMs: number; lastModified?: string };
}

function bannerBatchMap(batches: Batch[], server: "JP" | "GL") {
  const map = new Map<number, number>();
  for (const b of batches) {
    if (b.server !== server) continue;
    for (const id of b.bannerIds) map.set(id, b.index);
  }
  return map;
}

function toDto(banner: Banner, snap: Snapshot): BannerDto {
  const prediction =
    banner.server === "JP" ? (snap.predictions.get(banner.id) ?? null) : null;
  const confirmed =
    banner.server === "JP" ? snap.confirmed.get(banner.id) : undefined;
  return {
    id: banner.id,
    server: banner.server,
    type: banner.type,
    code: banner.code,
    rerun: banner.rerun,
    limited: banner.limited,
    evergreen: banner.evergreen,
    startMs: banner.startMs,
    endMs: banner.endMs,
    characters: banner.characterIds
      .map((id) => snap.characters.byId(id))
      .filter((c): c is NonNullable<typeof c> => Boolean(c))
      .map((c) => ({
        id: c.id,
        name: c.nameEn,
        nameJp: c.nameJp,
        nameKr: c.nameKr,
        school: c.school,
        starGrade: c.starGrade,
        avatar: avatarPath(c.id),
        availability: c.availability,
      })),
    imageUrl: banner.imageFile ? bannerPath(banner.imageFile) : null,
    confirmedGlStartMs: confirmed?.startMs ?? null,
    prediction,
    forecastStatus: confirmed
      ? "arrived"
      : prediction?.method === "scheduled"
        ? "scheduled"
        : prediction
          ? "estimated"
          : banner.server === "GL"
            ? banner.startMs > Date.now()
              ? "scheduled"
              : "arrived"
            : "unresolved",
  };
}

async function buildSnapshot(): Promise<Snapshot> {
  const wiki = new BlueArchiveWikiSource();
  const schale = new SchaleDbSource();
  const clubs = new WikiClubSource();
  const [wikiRes, schaleRes, clubRes, studentProfiles] = await Promise.all([
    wiki.fetchAll(),
    schale.fetchAll(),
    // Club names are cosmetic: a wiki hiccup must not fail the whole export,
    // so fall back to the SchaleDB keys rather than propagating the error.
    clubs.fetchAll().catch((err) => {
      console.warn(`club names unavailable (${err}); keeping SchaleDB keys`);
      return null;
    }),
    fetchStudentProfiles().catch(async (err) => {
      console.warn(`student profiles unavailable (${err}); preserving the last exported profiles`);
      const cached = await Bun.file(join(outDir, "data/characters.json")).json().catch(() => ({ characters: [] })) as { characters: { id: number; profile?: StudentProfileDto }[] };
      return new Map(cached.characters.filter((c) => c.profile).map((c) => [c.id, c.profile!]));
    }),
  ]);

  // SchaleDB's `Club` is an internal key (`Kohshinjo68`); the wiki's student
  // infobox has the official English name under the same id.
  let named = 0;
  const characters = new CharacterIndex(
    [...schaleRes.records.values()].map((c) => {
      const club = clubRes?.records.get(c.id);
      if (club !== undefined) named++;
      return { ...c, club: club ?? c.club };
    }),
  );
  if (clubRes && named < characters.size) {
    console.warn(
      `club names    : ${named}/${characters.size} — the rest keep SchaleDB keys`,
    );
  }
  const cachedBannerImages = new Set(
    await readdir(join(outDir, "img/banner")).catch(() => [] as string[]),
  );
  const banners = reuseRerunBannerImages(
    normalizeAll(wikiRes.records, characters),
    cachedBannerImages,
  );
  const asOfMs = Date.now();

  const batches = buildBatches(banners.filter((b) => b.server === "JP" || b.startMs <= asOfMs));
  const batchIndex = indexBatches(batches);
  const jp = banners.filter((b) => b.server === "JP");
  const gl = banners.filter((b) => b.server === "GL" && b.startMs <= asOfMs);
  const matches = matchBanners(jp, gl);
  const jpBatchOfBanner = bannerBatchMap(batches, "JP");
  const glBatchOfBanner = bannerBatchMap(batches, "GL");
  const anchors = batchAnchors(matches, jpBatchOfBanner, glBatchOfBanner);
  const alignment = alignBatches(batchIndex.JP, batchIndex.GL, anchors);
  const cadence = fitCadence(batchIndex.GL);
  const forecast = buildForecastContext(
    alignment,
    batchIndex.JP,
    batchIndex.GL,
    cadence,
    0,
    asOfMs,
    buildCalibration(banners, asOfMs),
  );

  const glById = new Map(gl.map((b) => [b.id, b]));
  const confirmed = new Map<number, Banner>();
  for (const m of matches) {
    if (m.glBannerId == null) continue;
    const glBanner = glById.get(m.glBannerId);
    if (glBanner) confirmed.set(m.jpBannerId, glBanner);
  }
  const predictions = forecastJpBanners(forecast, jp, jpBatchOfBanner, {
    confirmedIds: new Set(confirmed.keys()),
  });
  for (const [jpId, glBanner] of verifiedTruth(banners)) {
    if (glBanner.startMs <= asOfMs) continue;
      predictions.set(jpId, {
      bannerId: jpId,
      expectedMs: glBanner.startMs,
      p05Ms: glBanner.startMs,
      p95Ms: glBanner.startMs,
      confidence: null,
      confidenceToleranceDays: 7,
      intervalCoverage: 1,
      calibrationSamples: 0,
        method: "scheduled",
        source: "wiki",
        explanation:
        "Scheduled date recorded on the Blue Archive Wiki (not independently verified against an official announcement).",
      glBatchIndex: null,
      glBatchStartMs: glBanner.startMs,
      });
  }
  applyOfficialGlobalSchedules(banners, predictions, confirmed);
  const unresolved = new Set(
    jp.filter((b) => !b.evergreen && !confirmed.has(b.id) && !predictions.has(b.id)).map((b) => b.id),
  );

  return {
    studentProfiles,
    banners,
    batchIndex,
    characters,
    alignment,
    cadence,
    predictions,
    forecast,
    fetchedAtMs: Date.now(),
    lagDays: currentLagDays(alignment),
    matches: matchSummary(matches),
    confirmed,
    unresolved,
    wikiMeta: {
      key: wikiRes.meta.key,
      label: wikiRes.meta.label,
      fetchedAtMs: wikiRes.meta.fetchedAtMs,
      lastModified: wikiRes.meta.lastModified,
    },
    schaleMeta: {
      key: schaleRes.meta.key,
      label: schaleRes.meta.label,
      fetchedAtMs: schaleRes.meta.fetchedAtMs,
    },
    // Omitted when the club fetch failed: the snapshot then carries SchaleDB
    // keys, and the provenance line should say so.
    ...(clubRes
      ? {
          clubMeta: {
            key: clubRes.meta.key,
            label: clubRes.meta.label,
            fetchedAtMs: clubRes.meta.fetchedAtMs,
          },
        }
      : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Image mirror                                                        */
/* ------------------------------------------------------------------ */

const MAX_BYTES = 8 * 1024 * 1024;

async function fileOk(path: string): Promise<boolean> {
  try {
    return (await stat(path)).size > 0;
  } catch {
    return false;
  }
}

async function download(url: string, path: string): Promise<"ok" | "skip" | "fail"> {
  if (await fileOk(path)) return "skip";
  try {
    const res = await fetch(url, { headers: { "User-Agent": CONFIG.userAgent } });
    if (!res.ok) return "fail";
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > MAX_BYTES) return "fail";
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > MAX_BYTES) return "fail";
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, buf);
    return "ok";
  } catch {
    return "fail";
  }
}

async function mirrorImages(
  snap: Snapshot,
  imgDir: string,
  concurrency = 8,
): Promise<{ ok: number; skipped: number; failed: string[] }> {
  const jobs: { url: string; path: string }[] = [];
  const ids = snap.characters.getAll().map((c) => c.id);
  for (const id of ids) {
    jobs.push({
      url: `https://schaledb.com/images/student/icon/${id}.webp`,
      path: join(imgDir, "avatar", `${id}.webp`),
    });
    jobs.push({
      url: `https://schaledb.com/images/student/portrait/${id}.webp`,
      path: join(imgDir, "portrait", `${id}.webp`),
    });
  }
  const bannerFiles = new Set(
    snap.banners.map((b) => b.imageFile).filter((f): f is string => Boolean(f)),
  );
  for (const file of bannerFiles) {
    jobs.push({
      url: `https://bluearchive.wiki/wiki/Special:Redirect/file/${encodeURIComponent(file)}`,
      path: join(imgDir, "banner", file),
    });
  }
  jobs.push(
    { url: "https://bluearchive.wiki/wiki/Special:Redirect/file/Arona.png", path: join(imgDir, "mascot", "arona.png") },
    { url: "https://bluearchive.wiki/wiki/Special:Redirect/file/Plana.png", path: join(imgDir, "mascot", "plana.png") },
  );
  for (const file of Object.values(SCHOOL_EMBLEMS)) {
    jobs.push({
      url: `https://bluearchive.wiki/wiki/Special:Redirect/file/${encodeURIComponent(file)}`,
      path: join(imgDir, "emblem", file.toLowerCase()),
    });
  }

  let ok = 0;
  let skipped = 0;
  const failed: string[] = [];
  const queue = [...jobs];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (;;) {
        const job = queue.shift();
        if (!job) return;
        const res = await download(job.url, job.path);
        if (res === "ok") ok++;
        else if (res === "skip") skipped++;
        else failed.push(job.path);
      }
    }),
  );
  return { ok, skipped, failed };
}

async function cacheStats(imgDir: string) {
  const out: Record<string, { files: number; bytes: number }> = {};
  for (const kind of ["avatar", "portrait", "banner", "mascot", "emblem"]) {
    let files = 0;
    let bytes = 0;
    try {
      for (const entry of await readdir(join(imgDir, kind))) {
        try {
          const s = await stat(join(imgDir, kind, entry));
          if (s.isFile()) {
            files++;
            bytes += s.size;
          }
        } catch {
          /* racing cron runs; ignore */
        }
      }
    } catch {
      /* directory may not exist yet */
    }
    out[kind] = { files, bytes };
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

const args = new Set(process.argv.slice(2));
let outDir = "public";
for (const a of process.argv.slice(2)) {
  if (a.startsWith("--out=")) outDir = a.slice("--out=".length);
}
const skipImages = args.has("--skip-images");
const imagesOnly = args.has("--images-only");

const dataDir = join(outDir, "data");
const imgDir = join(outDir, "img");
await mkdir(dataDir, { recursive: true });

if (!imagesOnly) {
  const snap = await buildSnapshot();
  const byId = new Map(snap.banners.map((b) => [b.id, b]));
  const dto = (b: Banner) => toDto(b, snap);

  const forecastRows = [...snap.predictions.values()]
    .filter((p) => byId.has(p.bannerId))
    .sort((a, b) => a.expectedMs - b.expectedMs)
    .map((p) => dto(byId.get(p.bannerId)!));

  const status = {
    ok: true,
    staticSite: true,
    stale: false,
    dueForRefresh: false,
    refreshIntervalDays: CONFIG.refreshIntervalDays,
    dataAgeDays: 0,
    exportedAtMs: snap.fetchedAtMs,
    sources: [
      { ...snap.wikiMeta, lastModified: snap.wikiMeta.lastModified ?? null },
      { ...snap.schaleMeta, lastModified: null },
      ...(snap.clubMeta ? [{ ...snap.clubMeta, lastModified: null }] : []),
    ],
    model: {
      currentLagDays: snap.lagDays,
      jpBatches: snap.batchIndex.JP.length,
      glBatches: snap.batchIndex.GL.length,
      absorption: snap.alignment.advance.absorption,
      residual: snap.alignment.advance.residual,
      frontierJpBatch: snap.alignment.advance.frontierJp,
      frontierGlBatch: snap.alignment.advance.frontierGl,
      medianIntervalDays: snap.cadence.medianInterval,
      matches: snap.matches,
      inFlight: snap.predictions.size,
      unresolved: snap.unresolved.size,
      scheduled: [...snap.predictions.values()].filter((p) => p.method === "scheduled").length,
      calibrationRecords: snap.forecast.calibration.length,
      preferredWeekdays: snap.cadence.preferredDays,
    },
  };

  const banners = {
    from: 0,
    to: Date.UTC(2100, 0, 1),
    count: snap.banners.length,
    banners: snap.banners.map(dto),
  };

  const forecast = {
    currentLagDays: snap.lagDays,
    count: forecastRows.length,
    projectedBatches: snap.forecast.glProjected.slice(0, 20).map((b) => ({
      index: b.index,
      step: b.step,
      startMs: b.startMs,
    })),
    banners: forecastRows,
    unresolvedBanners: snap.banners
      .filter((b) => b.server === "JP" && snap.unresolved.has(b.id))
      .map(dto),
  };

  const characters = {
    characters: snap.characters.getAll().map((c) => ({
      id: c.id,
      name: c.nameEn,
      nameJp: c.nameJp,
      nameKr: c.nameKr,
      pathName: c.pathName,
      school: c.school,
      club: c.club,
      starGrade: c.starGrade,
      avatar: portraitPath(c.id),
      availability: c.availability,
      releasedOn: c.releasedOn,
      ...(snap.studentProfiles.has(c.id) ? { profile: snap.studentProfiles.get(c.id) } : {}),
    })),
  };

  await writeFile(join(dataDir, "status.json"), JSON.stringify(status, null, 2));
  await writeFile(join(dataDir, "banners.json"), JSON.stringify(banners));
  await writeFile(join(dataDir, "forecast.json"), JSON.stringify(forecast));
  await writeFile(join(dataDir, "characters.json"), JSON.stringify(characters));

  const jp = snap.banners.filter((b) => b.server === "JP");
  const gl = snap.banners.filter((b) => b.server === "GL");
  console.log("\n=== static export ===");
  console.log(`JP banners   : ${jp.length}`);
  console.log(`GL banners   : ${gl.length}`);
  console.log(`characters   : ${snap.characters.size}`);
  console.log(
    `club names   : ${snap.clubMeta ? "wiki" : "SCHALEDB KEYS (wiki fetch failed)"}`,
  );
  console.log(`JP batches   : ${snap.batchIndex.JP.length}`);
  console.log(`GL batches   : ${snap.batchIndex.GL.length}`);
  console.log(`current lag  : ${snap.lagDays} days`);
  console.log(`predictions  : ${snap.predictions.size} JP banners in flight`);

  // Rate-up names that link to no student (not even by alias). New variant
  // spellings appear regularly; surface them here instead of silently
  // shipping code-only banners with broken simulator rosters.
  const unresolved = new Map<string, string[]>();
  for (const b of snap.banners) {
    for (const part of splitRateup(b.rateupRaw)) {
      if (!snap.characters.has(part)) {
        const list = unresolved.get(part) ?? [];
        if (list.length < 3) list.push(`${b.server}:${b.id}`);
        unresolved.set(part, list);
      }
    }
  }
  console.log(`unresolved rate-ups: ${unresolved.size}`);
  for (const [name, examples] of unresolved) {
    console.log(`  no student: ${JSON.stringify(name)} (e.g. ${examples.join(", ")})`);
  }

  if (!skipImages) {
    const res = await mirrorImages(snap, imgDir);
    console.log(`images       : ${res.ok} downloaded, ${res.skipped} cached, ${res.failed.length} failed`);
    for (const f of res.failed.slice(0, 20)) console.log(`  missing: ${f}`);
    if (res.failed.length > 20) console.log(`  ... and ${res.failed.length - 20} more`);
  }
  console.log(`image cache  :`, await cacheStats(imgDir));
} else {
  console.log("--images-only is not supported; run a full export instead.");
  process.exit(1);
}
