import type { Banner, CharacterRecord, Server } from "./api";

export type SimulatorSystem = "spark" | "charge";
export type PullSource = "pyroxene" | "ticket";

// Shunling (Swimsuit) is the alternate form unlocked by Shun (Swimsuit),
// not a second recruit or a separately weighted off-rate student.
export function recruitmentStudentId(id: number) { return id === 10144 ? 10143 : id; }

/** The JP changeover date. Global remains legacy in the historical data set. */
export const NEW_SYSTEM_CUTOFF = Date.UTC(2026, 6, 29, 2);
export const PULL_COST = 120;
export const TEN_PULL_COST = 1_200;

export interface RecruitmentPeriod {
  key: string;
  server: Server;
  startMs: number;
  endMs: number;
  banners: Banner[];
  limited: boolean;
  poolKind: "regular" | "limited";
  defaultSystem: SimulatorSystem;
  systemReason: string;
}

export interface RewardMilestone {
  at: number;
  label: string;
  ticket?: number;
}

export const RECRUITMENT_REWARDS: RewardMilestone[] = [
  { at: 10, label: "Advanced Blu-ray choice ×2" },
  { at: 30, label: "Eligma ×10" },
  { at: 50, label: "Advanced tech-note choice ×5" },
  { at: 70, label: "Limited 10-recruitment ticket", ticket: 1 },
  { at: 90, label: "Gift box ×2" },
  { at: 110, label: "Eligma ×20" },
  { at: 130, label: "Limited 10-recruitment ticket", ticket: 1 },
  { at: 150, label: "Limited 10-recruitment ticket", ticket: 1 },
  { at: 170, label: "Limited 10-recruitment ticket", ticket: 1 },
  { at: 190, label: "Superior tech-note choice ×5" },
  { at: 210, label: "Advanced Blu-ray choice ×2" },
  { at: 230, label: "Eligma ×10" },
  { at: 250, label: "Advanced tech-note choice ×5" },
  { at: 270, label: "Limited 10-recruitment ticket", ticket: 1 },
  { at: 290, label: "Gift box ×2" },
  { at: 310, label: "Eligma ×20" },
  { at: 330, label: "Limited 10-recruitment ticket", ticket: 1 },
  { at: 350, label: "Limited 10-recruitment ticket", ticket: 1 },
  { at: 370, label: "Limited 10-recruitment ticket", ticket: 1 },
  { at: 390, label: "Superior tech-note choice ×5" },
];

export interface SimulatorState {
  periodKey: string;
  bannerId: number;
  system: SimulatorSystem;
  points: number;
  regularCharge: number;
  limitedCharge: number;
  recruitmentCount: number;
  tickets: number;
  ticketExpiresAt: number | null;
  totalPulls: number;
  pyroxeneSpent: number;
  ticketPulls: number;
  ownedIds: number[];
  duplicateCounts: Record<string, number>;
  rarityCounts: Record<"1" | "2" | "3", number>;
  featuredHits: number;
}

export interface PullResult {
  student: CharacterRecord;
  rarity: 1 | 2 | 3;
  featured: boolean;
  duplicate: boolean;
  source: PullSource;
  forced: "none" | "two-star" | "soft-pity" | "hard-pity";
}

export type PoolGroup = "pickup" | "fes" | "regular";
export type RecruitmentRarity = 1 | 2 | 3;

export interface RecruitmentPoolEntry {
  student: CharacterRecord;
  group: PoolGroup;
  rarity: RecruitmentRarity;
  /** Per-student probability as a percentage, e.g. 0.7 means 0.7%. */
  rate: number;
}

export interface RecruitmentPool {
  students: CharacterRecord[];
  entries: RecruitmentPoolEntry[];
  isFes: boolean;
  rarityRates: Record<"1" | "2" | "3", number>;
}

export interface SimulationContext {
  period: RecruitmentPeriod;
  banner: Banner;
  pool: CharacterRecord[];
  /** Built once by the UI and shared by the pool dialog and pull resolver. */
  recruitmentPool?: RecruitmentPool;
}

export interface SimulationOutcome {
  state: SimulatorState;
  results: PullResult[];
  rewards: RewardMilestone[];
}

/** Idempotent migration for sessions that recruited the linked forms separately. */
export function normalizeRecruitmentCollection(state: SimulatorState): SimulatorState {
  const ownedIds = [...new Set(state.ownedIds.map(recruitmentStudentId))];
  const duplicateCounts: Record<string, number> = {};
  for (const [id, count] of Object.entries(state.duplicateCounts)) {
    const key = recruitmentStudentId(Number(id));
    duplicateCounts[key] = (duplicateCounts[key] ?? 0) + count;
  }
  if (state.ownedIds.includes(10143) && state.ownedIds.includes(10144)) {
    duplicateCounts[10143] = (duplicateCounts[10143] ?? 0) + 1;
  }
  return { ...state, ownedIds, duplicateCounts };
}

function isArchive(banner: Banner) {
  return banner.type.startsWith("SelectPickup");
}

function isSelectableBanner(banner: Banner) {
  // Large roster rows are selectable archive/encore lists rather than
  // simultaneous 0.7% rate-ups. The wiki currently labels Encore rows as
  // Unknown in the source snapshot.
  return isArchive(banner) || banner.characters.length > 3;
}

function isFesBanner(banner: Banner) {
  return banner.type === "FesGacha" || banner.type === "SelectPickupFesGacha";
}

function isFesArchive(banner: Banner) {
  return banner.type === "SelectPickupFesGacha";
}

export function bannerPoolKind(banner: Banner): "regular" | "limited" {
  return banner.limited || banner.type.includes("Limited") || isFesBanner(banner) ? "limited" : "regular";
}

function systemForBanner(server: Server, startMs: number, banner: Banner): { system: SimulatorSystem; reason: string } {
  if (isArchive(banner)) {
    return { system: "spark", reason: "Archive/select-pickup banners retain the 200-point exchange." };
  }
  if (server === "JP" && startMs >= NEW_SYSTEM_CUTOFF) {
    return { system: "charge", reason: "JP banner after the 5.5 Anniversary recruitment overhaul." };
  }
  if (server === "GL") {
    return { system: "spark", reason: "Global historical banners use the 200-point system in this data set." };
  }
  return { system: "spark", reason: "Banner predates the Recruitment Charge overhaul." };
}

export function historicalSystem(period: RecruitmentPeriod, banner: Banner) {
  return systemForBanner(period.server, period.startMs, banner);
}

/** Group banners by the date they appeared together in the game. */
export function buildRecruitmentPeriods(banners: Banner[], server: Server): RecruitmentPeriod[] {
  const groups = new Map<number, Banner[]>();
  for (const banner of banners) {
    if (banner.server !== server || banner.evergreen) continue;
    const list = groups.get(banner.startMs) ?? [];
    list.push(banner);
    groups.set(banner.startMs, list);
  }
  return [...groups.entries()]
    .map(([startMs, grouped]) => {
      const sorted = [...grouped].sort((a, b) => a.id - b.id);
      const endMs = Math.max(...sorted.map((b) => b.endMs));
      const limited = sorted.some((banner) => bannerPoolKind(banner) === "limited");
      const system = systemForBanner(server, startMs, sorted[0]);
      return {
        key: `${server}:${startMs}`,
        server,
        startMs,
        endMs,
        banners: sorted,
        limited,
        poolKind: limited ? "limited" : "regular",
        defaultSystem: system.system,
        systemReason: system.reason,
      } satisfies RecruitmentPeriod;
    })
    .sort((a, b) => b.startMs - a.startMs);
}

function firstSeenByStudent(banners: Banner[], server: Server) {
  const firstSeen = new Map<number, number>();
  for (const banner of banners) {
    if (banner.server !== server) continue;
    for (const student of banner.characters) {
      const id = recruitmentStudentId(student.id);
      const current = firstSeen.get(id);
      if (current == null || banner.startMs < current) firstSeen.set(id, banner.startMs);
    }
  }
  return firstSeen;
}

function archivedAtByStudent(banners: Banner[], server: Server, fesOnly = false) {
  const archivedAt = new Map<number, number>();
  for (const banner of banners) {
    if (banner.server !== server || !isArchive(banner) || (fesOnly && !isFesArchive(banner))) continue;
    for (const student of banner.characters) {
      const id = recruitmentStudentId(student.id);
      const current = archivedAt.get(id);
      if (current == null || banner.startMs < current) archivedAt.set(id, banner.startMs);
    }
  }
  return archivedAt;
}

function availableAt(student: CharacterRecord, period: RecruitmentPeriod, firstSeen: Map<number, number>) {
  const flag = student.releasedOn?.[period.server === "JP" ? "jp" : "gl"];
  const first = firstSeen.get(recruitmentStudentId(student.id));
  // SchaleDB's release flag can lag the wiki banner snapshot for a newly
  // announced banner. A dated banner row is stronger evidence that the unit
  // is recruitable; an unreleased unit with no banner evidence stays excluded.
  if (flag === false && (first == null || first > period.startMs)) return false;
  // Missing first-seen dates are the launch roster (or a synthetic test record);
  // dated banner evidence still prevents a later student leaking backwards.
  return first == null || first <= period.startMs;
}

/** Anniversary students that remained in the live Fes pool at this date. */
function fesStudentsAt(banners: Banner[], period: RecruitmentPeriod) {
  const archivedAt = archivedAtByStudent(banners, period.server, true);
  const ids = new Set<number>();
  for (const banner of banners) {
    if (banner.server !== period.server || banner.type !== "FesGacha" || banner.startMs > period.startMs) continue;
    for (const student of banner.characters) {
      const id = recruitmentStudentId(student.id);
      if ((archivedAt.get(id) ?? Number.POSITIVE_INFINITY) > period.startMs) ids.add(id);
    }
  }
  return ids;
}

/**
 * Reconstruct the students available at a historical banner date.
 *
 * The source character dump is current, so `releasedOn` is essential for
 * students that have not appeared in a banner row yet (especially future GL
 * students). Banner first-seen dates provide the finer historical cutoff for
 * students that have already debuted.
 */
export function buildStudentPool(all: CharacterRecord[], banners: Banner[], period: RecruitmentPeriod, selectedBannerId?: number): CharacterRecord[] {
  const firstSeen = firstSeenByStudent(banners, period.server);
  const archivedAt = archivedAtByStudent(banners, period.server);
  const limitedSeen = new Set<number>();
  const standardSeen = new Set<number>();
  for (const banner of banners) {
    if (banner.server !== period.server) continue;
    for (const student of banner.characters) {
      const id = recruitmentStudentId(student.id);
      if (isLimitedBanner(banner)) limitedSeen.add(id);
      if (isStandardPoolBanner(banner)) standardSeen.add(id);
    }
  }

  const selected = period.banners.find((banner) => banner.id === selectedBannerId) ?? period.banners[0];
  const selectedIsArchive = selected ? isArchive(selected) : false;
  const selectedIsFes = !!selected && isFesBanner(selected) && !isFesArchive(selected);
  const fesIds = selectedIsFes ? fesStudentsAt(banners, period) : new Set<number>();
  // A student that has only appeared on Limited/Festival banners is not part
  // of the ordinary off-rate pool. Fes anniversary students are the deliberate
  // exception while a Fes banner is active.
  const limitedOnly = new Set([
    ...[...limitedSeen].filter((id) => !standardSeen.has(id)),
    ...all.filter((student) => student.availability === "limited").map((student) => recruitmentStudentId(student.id)),
  ]);
  const pool = all.filter((student) => {
    const id = recruitmentStudentId(student.id);
    if (student.id !== id) return false;
    if (student.starGrade < 1 || student.starGrade > 3) return false;
    if (student.availability === "event") return false;
    if (!availableAt(student, period, firstSeen)) return false;
    if (!selectedIsArchive && (archivedAt.get(id) ?? Number.POSITIVE_INFINITY) <= period.startMs) return false;
    if (limitedOnly.has(id) && !(selectedIsFes && fesIds.has(id))) return false;
    return true;
  });

  const allById = new Map(all.map((student) => [student.id, student]));
  const featured: CharacterRecord[] = (selected?.characters ?? [])
    .map((student) => allById.get(recruitmentStudentId(student.id)) ?? ({
      ...student,
      id: recruitmentStudentId(student.id),
      pathName: "",
      club: "",
    }))
    .filter((student) => student.availability !== "event" && availableAt(student, period, firstSeen));
  const byId = new Map(pool.map((student) => [student.id, student]));
  for (const student of featured) if (!byId.has(student.id)) byId.set(student.id, student);
  return [...byId.values()];
}

function isLimitedBanner(banner: Banner) {
  return banner.limited || banner.type === "LimitedGacha" || isFesBanner(banner);
}

function isStandardPoolBanner(banner: Banner) {
  // Select-pickup/archive rows can contain old limited students too, so they
  // are not evidence that a student belongs to the ordinary off-rate pool.
  return banner.type === "PickupGacha";
}

function distinctStudents(students: CharacterRecord[]) {
  return [...new Map(students.map((student) => [recruitmentStudentId(student.id), { ...student, id: recruitmentStudentId(student.id) }])).values()];
}

function addPoolEntries(entries: RecruitmentPoolEntry[], group: PoolGroup, students: CharacterRecord[], totalRate: number) {
  if (!students.length || totalRate <= 0) return;
  const rate = totalRate / students.length;
  for (const student of students) {
    entries.push({ student, group, rarity: student.starGrade as RecruitmentRarity, rate });
  }
}

/** Build the canonical per-student table used by both the dialog and pulls. */
export function buildRecruitmentPool(all: CharacterRecord[], banners: Banner[], period: RecruitmentPeriod, selectedBannerId?: number): RecruitmentPool {
  const students = buildStudentPool(all, banners, period, selectedBannerId);
  const selected = period.banners.find((banner) => banner.id === selectedBannerId) ?? period.banners[0];
  const isFes = !!selected && isFesBanner(selected) && !isFesArchive(selected);
  const selectedIds = new Set((selected?.characters ?? []).map((student) => recruitmentStudentId(student.id)));
  const fesIds = isFes ? fesStudentsAt(banners, period) : new Set<number>();
  const pickup = students.filter((student) => selectedIds.has(student.id));
  const fes = students.filter((student) => fesIds.has(student.id) && !selectedIds.has(student.id) && student.starGrade === 3);
  const regular = students.filter((student) => !selectedIds.has(student.id) && !fesIds.has(student.id));
  const regularByRarity = (rarity: RecruitmentRarity) => regular.filter((student) => student.starGrade === rarity);
  const oneRate = isFes ? 75.5 : 78.5;
  const twoRate = 18.5;
  const threeRate = isFes ? 6 : 3;
  const selectable = !!selected && isSelectableBanner(selected);
  const pickup3 = pickup.filter((student) => student.starGrade === 3);
  const pickup2 = pickup.filter((student) => student.starGrade === 2);
  let pickupRate = selectable ? (pickup3.length ? 0.7 : 0) : pickup3.length * 0.7;
  let pickupTwoRate = selectable ? (pickup2.length ? 0.7 : 0) : Math.min(twoRate, pickup2.length * 3);
  let fesRate = isFes && fes.length ? 0.9 : 0;
  let regularThreeRate = threeRate - pickupRate - fesRate;
  let regularTwoRate = twoRate - pickupTwoRate;

  // The first Fes can have no previous anniversary student. Preserve the full
  // six-percent 3★ total by folding the unused 0.9% into the regular pool.
  if (isFes && !fes.length) {
    regularThreeRate = threeRate - pickupRate;
    fesRate = 0;
  }
  // Keep synthetic/minimal pools drawable without inventing a student: move a
  // missing category's share into the closest available 3★ category.
  if (!regularByRarity(3).length && regularThreeRate > 0) {
    if (fes.length) fesRate += regularThreeRate;
    else if (pickup3.length) pickupRate += regularThreeRate;
    regularThreeRate = 0;
  }
  if (!regularByRarity(2).length && regularTwoRate > 0) {
    if (pickup2.length) pickupTwoRate += regularTwoRate;
    regularTwoRate = 0;
  }

  const entries: RecruitmentPoolEntry[] = [];
  addPoolEntries(entries, "pickup", pickup3, pickupRate);
  addPoolEntries(entries, "pickup", pickup2, pickupTwoRate);
  addPoolEntries(entries, "fes", fes, fesRate);
  addPoolEntries(entries, "regular", regularByRarity(3), regularThreeRate);
  addPoolEntries(entries, "regular", regularByRarity(2), regularTwoRate);
  addPoolEntries(entries, "regular", regularByRarity(1), oneRate);

  return {
    students,
    entries,
    isFes,
    rarityRates: { "1": oneRate, "2": 18.5, "3": threeRate },
  };
}

export function makeInitialState(period: RecruitmentPeriod, bannerId: number, system: SimulatorSystem): SimulatorState {
  return {
    periodKey: period.key,
    bannerId,
    system,
    points: 0,
    regularCharge: 0,
    limitedCharge: 0,
    recruitmentCount: 0,
    tickets: 0,
    ticketExpiresAt: null,
    totalPulls: 0,
    pyroxeneSpent: 0,
    ticketPulls: 0,
    ownedIds: [],
    duplicateCounts: {},
    rarityCounts: { "1": 0, "2": 0, "3": 0 },
    featuredHits: 0,
  };
}

/** Preserve new-system charge when moving to another concurrent period. */
export function switchPeriod(state: SimulatorState, period: RecruitmentPeriod, bannerId: number, system: SimulatorSystem): SimulatorState {
  const keepCharge = state.system === "charge" && system === "charge";
  const keepTickets = keepCharge && state.ticketExpiresAt != null && state.ticketExpiresAt >= period.startMs;
  return {
    ...state,
    periodKey: period.key,
    bannerId,
    system,
    points: 0,
    recruitmentCount: 0,
    tickets: keepTickets ? state.tickets : 0,
    ticketExpiresAt: keepTickets ? state.ticketExpiresAt : null,
    regularCharge: keepCharge ? state.regularCharge : 0,
    limitedCharge: keepCharge ? state.limitedCharge : 0,
  };
}

function featuredFromBanner(context: SimulationContext) {
  const byId = new Map(context.pool.map((student) => [student.id, student]));
  const students = context.banner.characters
    .filter((student) => student.availability !== "event")
    .map((student) => byId.get(recruitmentStudentId(student.id)) ?? ({
      ...student,
      id: recruitmentStudentId(student.id),
      pathName: "",
      club: "",
    }));
  return distinctStudents(students);
}

function fallbackRecruitmentPool(context: SimulationContext): RecruitmentPool {
  const pickup = featuredFromBanner(context);
  return makeFallbackDistribution(distinctStudents([...context.pool, ...pickup]), pickup, context.banner.type.includes("Fes"), isSelectableBanner(context.banner));
}

function makeFallbackDistribution(students: CharacterRecord[], pickup: CharacterRecord[], isFes: boolean, selectable = false): RecruitmentPool {
  const selectedIds = new Set(pickup.map((student) => student.id));
  const three = students.filter((student) => student.starGrade === 3 && !selectedIds.has(student.id));
  const entries: RecruitmentPoolEntry[] = [];
  const oneRate = isFes ? 75.5 : 78.5;
  const twoRate = 18.5;
  const threeRate = isFes ? 6 : 3;
  const pickup3 = pickup.filter((student) => student.starGrade === 3);
  const pickup2 = pickup.filter((student) => student.starGrade === 2);
  const pickupRate = selectable ? (pickup3.length ? 0.7 : 0) : Math.min(threeRate, pickup3.length * 0.7);
  const pickupTwoRate = selectable ? (pickup2.length ? 0.7 : 0) : Math.min(twoRate, pickup2.length * 3);
  addPoolEntries(entries, "pickup", pickup3, pickupRate);
  addPoolEntries(entries, "pickup", pickup2, pickupTwoRate);
  addPoolEntries(entries, "regular", three, Math.max(0, threeRate - pickupRate));
  addPoolEntries(entries, "regular", students.filter((student) => student.starGrade === 2 && !selectedIds.has(student.id)), Math.max(0, twoRate - pickupTwoRate));
  addPoolEntries(entries, "regular", students.filter((student) => student.starGrade === 1), oneRate);
  return { students, entries, isFes, rarityRates: { "1": oneRate, "2": twoRate, "3": threeRate } };
}

function selectedPool(context: SimulationContext) {
  return context.recruitmentPool ?? fallbackRecruitmentPool(context);
}

function weightedPick(entries: RecruitmentPoolEntry[], rng: () => number) {
  if (!entries.length) return undefined;
  const total = entries.reduce((sum, entry) => sum + Math.max(0, entry.rate), 0);
  if (total <= 0) return entries[entries.length - 1];
  let target = rng() * total;
  for (const entry of entries) {
    target -= Math.max(0, entry.rate);
    if (target < 0) return entry;
  }
  return entries[entries.length - 1];
}

function drawOne(state: SimulatorState, context: SimulationContext, source: PullSource, tenIndex: number, rng: () => number): { state: SimulatorState; result: PullResult } {
  const limitedPool = bannerPoolKind(context.banner) === "limited";
  const beforeCharge = limitedPool ? state.limitedCharge : state.regularCharge;
  const chargePull = state.system === "charge" ? beforeCharge + 1 : beforeCharge;
  const hard = state.system === "charge" && chargePull >= 200;
  const soft = state.system === "charge" && beforeCharge < 100 && chargePull >= 100;
  const forcedTwo = tenIndex === 9;
  const pool = selectedPool(context);
  const entries3 = pool.entries.filter((entry) => entry.rarity === 3);
  const pickup3 = entries3.filter((entry) => entry.group === "pickup");
  let forced: PullResult["forced"] = "none";
  let candidates: RecruitmentPoolEntry[];
  let forceFeatured = false;

  if (hard) {
    forced = "hard-pity";
    forceFeatured = true;
    candidates = pickup3.length ? pickup3 : entries3;
  } else if (soft) {
    forced = "soft-pity";
    forceFeatured = rng() < 0.5;
    candidates = forceFeatured && pickup3.length ? pickup3 : entries3;
  } else if (forcedTwo) {
    forced = "two-star";
    candidates = pool.entries.filter((entry) => entry.rarity >= 2);
  } else {
    candidates = pool.entries;
  }

  const drawn = weightedPick(candidates, rng);
  if (!drawn) throw new Error("This banner has no recruitable students in the historical pool.");
  const rarity = drawn.rarity;
  const student = drawn.student;
  const featured = drawn.group === "pickup";

  let next = {
    ...state,
    totalPulls: state.totalPulls + 1,
    pyroxeneSpent: state.pyroxeneSpent + (source === "pyroxene" ? PULL_COST : 0),
    ticketPulls: state.ticketPulls + (source === "ticket" ? 1 : 0),
    rarityCounts: {
      ...state.rarityCounts,
      [String(rarity)]: state.rarityCounts[String(rarity) as "1" | "2" | "3"] + 1,
    },
    featuredHits: state.featuredHits + (featured ? 1 : 0),
  };
  if (state.system === "spark") {
    next.points = Math.min(200, state.points + 1);
  } else if (limitedPool) {
    next.limitedCharge = featured ? 0 : Math.min(200, chargePull);
  } else {
    next.regularCharge = featured ? 0 : Math.min(200, chargePull);
  }

  const duplicate = next.ownedIds.includes(student.id);
  if (!duplicate) next.ownedIds = [...next.ownedIds, student.id];
  next.duplicateCounts = { ...next.duplicateCounts, [student.id]: (next.duplicateCounts[student.id] ?? 0) + (duplicate ? 1 : 0) };
  return {
    state: next,
    result: { student, rarity, featured, duplicate, source, forced },
  };
}

function milestonesBetween(before: number, after: number) {
  return RECRUITMENT_REWARDS.filter((reward) => reward.at > before && reward.at <= after);
}

/** Resolve all results before the reveal animation starts. */
export function resolvePulls(state: SimulatorState, context: SimulationContext, count: 1 | 10, source: PullSource, rng = Math.random): SimulationOutcome {
  if (source === "ticket" && state.tickets < 1) throw new Error("No limited 10-recruitment ticket available.");
  if (source === "ticket" && count !== 10) throw new Error("Recruitment tickets can only be used for ten-pulls.");
  let next = normalizeRecruitmentCollection(state);
  if (source === "ticket") {
    next.tickets -= 1;
    if (next.tickets === 0) next.ticketExpiresAt = null;
  }
  const results: PullResult[] = [];
  for (let i = 0; i < count; i++) {
    const drawn = drawOne(next, context, source, count === 10 ? i : -1, rng);
    next = drawn.state;
    results.push(drawn.result);
  }
  const beforeCount = state.recruitmentCount;
  // The official reward track is for eligible paid/Pyroxene recruitment. A
  // free ticket advances Charge but does not recursively earn more tickets.
  if (source === "pyroxene" && state.system === "charge") {
    next.recruitmentCount += count;
  }
  const rewards = source === "pyroxene" && state.system === "charge"
    ? milestonesBetween(beforeCount, next.recruitmentCount)
    : [];
  const ticketReward = rewards.reduce((sum, reward) => sum + (reward.ticket ?? 0), 0);
  if (ticketReward) {
    next.tickets += ticketReward;
    next.ticketExpiresAt = context.period.startMs + 40 * 86_400_000;
  }
  return { state: next, results, rewards };
}

export function exchangeSpark(state: SimulatorState, context: SimulationContext, studentId: number): SimulatorState {
  if (state.system !== "spark" || state.points < 200) throw new Error("200 Recruitment Points are required to exchange.");
  const student = featuredFromBanner(context).find((candidate) => candidate.id === recruitmentStudentId(studentId));
  if (!student) throw new Error("Choose a student currently featured on this period.");
  state = normalizeRecruitmentCollection(state);
  const duplicate = state.ownedIds.includes(student.id);
  return {
    ...state,
    points: state.points - 200,
    ownedIds: duplicate ? state.ownedIds : [...state.ownedIds, student.id],
    duplicateCounts: { ...state.duplicateCounts, [student.id]: (state.duplicateCounts[student.id] ?? 0) + (duplicate ? 1 : 0) },
  };
}

export function activeCharge(state: SimulatorState, period: RecruitmentPeriod, banner?: Banner) {
  return (banner ? bannerPoolKind(banner) : period.poolKind) === "limited" ? state.limitedCharge : state.regularCharge;
}

export function nextReward(count: number) {
  return RECRUITMENT_REWARDS.find((reward) => reward.at > count) ?? null;
}
