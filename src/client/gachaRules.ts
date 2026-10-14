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

export interface SimulationContext {
  period: RecruitmentPeriod;
  banner: Banner;
  pool: CharacterRecord[];
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

export function bannerPoolKind(banner: Banner): "regular" | "limited" {
  return banner.limited || banner.type.includes("Limited") || banner.type.includes("Fes") || banner.type.includes("SelectPickupFes") ? "limited" : "regular";
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

/**
 * The source does not publish a complete historical rate table. Use students
 * that were available by the selected period and mark the UI as approximate.
 * SchaleDB's event classification excludes welfare/event-only students even
 * when they have no usable banner row, while old permanent launch students
 * without a recorded rate-up remain eligible.
 */
export function buildStudentPool(all: CharacterRecord[], banners: Banner[], period: RecruitmentPeriod, selectedBannerId?: number): CharacterRecord[] {
  const firstSeen = new Map<number, number>();
  const archivedAt = new Map<number, number>();
  const limitedSeen = new Set<number>();
  const standardSeen = new Set<number>();
  for (const banner of banners) {
    if (banner.server !== period.server) continue;
    for (const student of banner.characters) {
      const id = recruitmentStudentId(student.id);
      const current = firstSeen.get(id);
      if (current == null || banner.startMs < current) firstSeen.set(id, banner.startMs);
      if (isArchive(banner)) {
        const archived = archivedAt.get(id);
        if (archived == null || banner.startMs < archived) archivedAt.set(id, banner.startMs);
      }
      if (isLimitedBanner(banner)) limitedSeen.add(id);
      if (isStandardPoolBanner(banner)) standardSeen.add(id);
    }
  }
  // A student that has only ever appeared on Limited/Festival banners is not
  // part of the ordinary off-rate pool. The source has reliable banner types
  // but does not publish a separate limited flag for every student, so infer
  // this from the historical appearances and keep the result explicitly
  // approximate in the UI.
  const limitedOnly = new Set([
    ...[...limitedSeen].filter((id) => !standardSeen.has(id)),
    ...all.filter((student) => student.availability === "limited").map((student) => student.id),
  ]);
  const selected = period.banners.find((banner) => banner.id === selectedBannerId) ?? period.banners[0];
  const selectedIsArchive = selected ? isArchive(selected) : false;
  const pool = all.filter((student) => {
    if (student.id !== recruitmentStudentId(student.id)) return false;
    if (student.starGrade < 1 || student.starGrade > 3) return false;
    if (student.availability === "event") return false;
    if (!selectedIsArchive && (archivedAt.get(student.id) ?? Number.POSITIVE_INFINITY) <= period.startMs) return false;
    if (limitedOnly.has(student.id)) return false;
    const first = firstSeen.get(student.id);
    return first == null || first <= period.startMs;
  });
  const allById = new Map(all.map((student) => [student.id, student]));
  const featured: CharacterRecord[] = (selected?.characters ?? []).map((student) => allById.get(recruitmentStudentId(student.id)) ?? ({
    ...student,
    id: recruitmentStudentId(student.id),
    pathName: "",
    club: "",
  })).filter((student) => student.availability !== "event");
  const byId = new Map(pool.map((student) => [student.id, student]));
  for (const student of featured) if (!byId.has(student.id)) byId.set(student.id, student);
  return [...byId.values()];
}

function isLimitedBanner(banner: Banner) {
  return banner.limited || banner.type === "LimitedGacha" || banner.type === "FesGacha" || banner.type === "SelectPickupFesGacha";
}

function isStandardPoolBanner(banner: Banner) {
  // Select-pickup/archive rows can contain old limited students too, so they
  // are not evidence that a student belongs to the ordinary off-rate pool.
  return banner.type === "PickupGacha";
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

function pick<T>(items: T[], rng: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
}

function selectedFeatured(context: SimulationContext) {
  const byId = new Map(context.pool.map((student) => [student.id, student]));
  const students = context.banner.characters.filter((student) => student.availability !== "event").map((student) => byId.get(recruitmentStudentId(student.id)) ?? ({
    ...student,
    id: recruitmentStudentId(student.id),
    pathName: "",
    club: "",
  }));
  return [...new Map(students.map((student) => [student.id, student])).values()];
}

function randomStudent(context: SimulationContext, rarity: 1 | 2 | 3, rng: () => number, featuredChance: number): { student: CharacterRecord; featured: boolean } {
  const featured = selectedFeatured(context).filter((student) => student.starGrade === rarity);
  if (rarity === 3 && featured.length && rng() < featuredChance) {
    return { student: pick(featured, rng), featured: true };
  }
  const selectedIds = new Set(selectedFeatured(context).map((student) => student.id));
  const other = context.pool.filter((student) => student.starGrade === rarity && !selectedIds.has(student.id));
  if (other.length) return { student: pick(other, rng), featured: false };
  if (featured.length) return { student: pick(featured, rng), featured: true };
  return { student: pick(context.pool, rng), featured: false };
}

function drawOne(state: SimulatorState, context: SimulationContext, source: PullSource, tenIndex: number, rng: () => number): { state: SimulatorState; result: PullResult } {
  const limitedPool = bannerPoolKind(context.banner) === "limited";
  const beforeCharge = limitedPool ? state.limitedCharge : state.regularCharge;
  const chargePull = state.system === "charge" ? beforeCharge + 1 : beforeCharge;
  const hard = state.system === "charge" && chargePull >= 200;
  const soft = state.system === "charge" && beforeCharge < 100 && chargePull >= 100;
  const forcedTwo = tenIndex === 9;
  const threeRate = context.banner.type.includes("Fes") ? 0.06 : 0.03;
  let rarity: 1 | 2 | 3;
  let forced: PullResult["forced"] = "none";
  let forceFeatured = false;

  if (hard) {
    rarity = 3;
    forced = "hard-pity";
    forceFeatured = true;
  } else if (soft) {
    rarity = 3;
    forced = "soft-pity";
    forceFeatured = rng() < 0.5;
  } else if (forcedTwo) {
    rarity = rng() < threeRate / (threeRate + 0.185) ? 3 : 2;
    forced = "two-star";
  } else {
    const roll = rng();
    rarity = roll < threeRate ? 3 : roll < threeRate + 0.185 ? 2 : 1;
  }

  const selected = selectedFeatured(context).filter((student) => student.starGrade === rarity);
  let student: CharacterRecord;
  let featured = false;
  if (forceFeatured && selected.length) {
    student = pick(selected, rng);
    featured = true;
  } else {
    const featuredChance = rarity === 3 ? Math.min(1, (0.007 * selected.length) / threeRate) : 0;
    const drawn = randomStudent(context, rarity, rng, featuredChance);
    student = drawn.student;
    featured = drawn.featured;
  }

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
  const student = selectedFeatured(context).find((candidate) => candidate.id === recruitmentStudentId(studentId));
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
