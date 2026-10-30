import { readdir, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { AtlasAttachmentLoader, EventTimeline, SkeletonBinary, TextureAtlas } from "@esotericsoftware/spine-core";
import {
  ENGLISH_MEMORIAL_LOBBY_OVERRIDES,
  MEMORIAL_LOBBY_PART_OVERRIDES,
} from "./spine-voice-translations";

interface LegacyVoiceLine {
  id: string;
  audio?: unknown;
  JR?: unknown;
  EN?: unknown;
  KR?: unknown;
}

interface LegacyVoiceCharacter {
  character: string;
  variant?: string;
  directory: string;
  wikiPage?: string;
  lines: LegacyVoiceLine[];
}

interface LegacyManifest {
  schemaVersion?: number;
  type?: string;
  sources?: Record<string, string>;
  characters: LegacyVoiceCharacter[];
}

interface Subtitle {
  en: string;
  ja: string;
  ko: string;
}

interface VoicePart {
  index: number;
  audio: string[];
  subtitle: Subtitle;
  start?: number;
}

interface SubtitleLine {
  id: string;
  audio: string[];
  subtitle: Subtitle;
  animation?: string;
  markers?: number[];
  parts: VoicePart[];
}

interface CharacterSubtitleFile {
  schemaVersion: number;
  type: "Memorial Lobby subtitles";
  character: string;
  variant: string;
  directory: string;
  audioDirectory: string;
  wikiPage?: string;
  lines: SubtitleLine[];
}

interface CatalogEntry {
  character: string;
  variant: string;
  directory: string;
  file: string;
  audioDirectory: string;
}

interface MarkerSet {
  animations: Map<number, { name: string; markers: number[] }>;
  parsedFrom?: string;
}

const positionalArguments = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
const root = resolve(positionalArguments[0] ?? "D:\\Misc\\ba-spine");
const extractedRoot = resolve(positionalArguments[1] ?? "D:\\Misc\\BA-JP-extractor\\extracted\\Spines\\Memorial Lobby");
const voiceRoot = join(root, "audios", "voicelines");
const legacyPath = join(voiceRoot, "voicelines.json");
const catalogPath = join(voiceRoot, "index.json");

const text = (value: unknown): string => typeof value === "string" ? value : "";
const audioDurationCache = new Map<string, number | null>();

async function filesUnder(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else files.push(path);
  }
  return files;
}

function eventTimes(events: Array<{ time: number }>): number[] {
  const sorted = [...new Set(events.map((event) => event.time))].sort((a, b) => a - b);
  const result: number[] = [];
  for (const time of sorted) {
    if (result.length === 0 || time - result[result.length - 1]! > 0.05) result.push(time);
  }
  return result;
}

function animationNumber(name: string): number | null {
  const match = basename(name).match(/^talk[_ -]?(\d+)/i);
  return match ? Number(match[1]) : null;
}

/** Talk/Sound events in the binary Spine skeleton are authoritative. */
function markersForAnimation(animation: { timelines: unknown[] }, number: number): number[] {
  const events = animation.timelines
    .filter((timeline): timeline is EventTimeline => timeline instanceof EventTimeline)
    .flatMap((timeline) => timeline.events);
  const talk = events.filter((event) => event.data.name.toLocaleLowerCase() === "talk");
  const sound = events.filter((event) => /^sound\//i.test(event.data.name));
  const matchingSound = sound.filter((event) => new RegExp(`memoriallobby_${number}(?:_|$)`, "i").test(basename(event.data.name)));
  if (matchingSound.length > 0) {
    const soundTimes = eventTimes(matchingSound);
    const pairedTalk = talk.filter((event) => soundTimes.some((time) => Math.abs(time - event.time) <= 0.001));
    return eventTimes(pairedTalk.length > 0 ? pairedTalk : matchingSound);
  }
  return eventTimes(talk.length > 0 ? talk : sound);
}

function markerAnimationName(name: string, number: number): boolean {
  return animationNumber(name) === number && /(?:^|[_ -])m(?:$|[_ -])/i.test(basename(name));
}

async function parseMarkerSet(directory: string): Promise<MarkerSet> {
  // The extractor can omit a lobby set or place a dependent skeleton beside
  // it. Prefer the extracted copy, then fall back to the corresponding flat
  // lobby set; both are local files and the latter also covers CH0060_home.
  const candidateRoots = [...new Set([
    join(extractedRoot, directory),
    join(root, "lobbies", directory),
  ])];
  for (const candidateRoot of candidateRoots) {
    const files = await filesUnder(candidateRoot);
    const skeletons = files.filter((path) => path.toLocaleLowerCase().endsWith(".skel"));
    const atlases = files.filter((path) => path.toLocaleLowerCase().endsWith(".atlas"));
    const preferredSkeletons = [...skeletons].sort((a, b) => {
      const wanted = `${directory}.skel`.toLocaleLowerCase();
      return Number(basename(b).toLocaleLowerCase() === wanted) - Number(basename(a).toLocaleLowerCase() === wanted) || a.localeCompare(b);
    });

    for (const skeletonPath of preferredSkeletons) {
      const siblingAtlas = atlases.find((path) => dirname(path) === dirname(skeletonPath));
      const atlasPath = siblingAtlas ?? atlases[0];
      if (!atlasPath) continue;
      let atlas: TextureAtlas | null = null;
      try {
        atlas = new TextureAtlas(await readFile(atlasPath, "utf8"));
        const data = new SkeletonBinary(new AtlasAttachmentLoader(atlas)).readSkeletonData(await readFile(skeletonPath));
        const animations = new Map<number, { name: string; markers: number[] }>();
        for (const animation of data.animations) {
          const number = animationNumber(animation.name);
          if (number === null || !markerAnimationName(animation.name, number)) continue;
          const markers = markersForAnimation(animation, number);
          const current = animations.get(number);
          if (!current || markers.length > current.markers.length) animations.set(number, { name: animation.name, markers });
        }
        if (animations.size > 0) return { animations, parsedFrom: skeletonPath };
      } catch (error) {
        console.warn(`markers : unable to parse ${skeletonPath}: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        atlas?.dispose();
      }
    }
  }
  return { animations: new Map() };
}

function audioGroups(value: unknown): string[][] {
  if (!Array.isArray(value)) return [];
  const groups = new Map<string, string[]>();
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0) continue;
    const file = basename(item.replaceAll("\\", "/"));
    // A few records contain both the default (JP) and GL pack. They are one
    // logical clip, not two subtitles; keep both files in the same part.
    const key = file.toLocaleLowerCase().replace(/_(?:gl|kr|jp)(?=_|\.)/g, "");
    const group = groups.get(key);
    if (group) group.push(file);
    else groups.set(key, [file]);
  }
  return [...groups.values()];
}

function isClosingCharacter(value: string): boolean {
  return value.length === 1 && ")]}>」』】》）〕〉》”’\"'".includes(value);
}

interface TranscriptUnit {
  text: string;
  separator: string;
}

/** Keep source line wrapping, but split at actual sentence punctuation too. */
function transcriptUnits(value: string): TranscriptUnit[] {
  const normalized = value.replaceAll("\r\n", "\n").trim();
  if (!normalized) return [];
  const units: TranscriptUnit[] = [];
  let current = "";
  let separator = "";
  const push = () => {
    const unit = current.trim();
    if (unit) {
      units.push({ text: unit, separator: separator.includes("\n") ? "\n" : separator ? " " : "" });
      separator = "";
    }
    current = "";
  };
  for (let index = 0; index < normalized.length; index++) {
    const character = normalized[index]!;
    if (character === "\n") {
      push();
      separator = "\n";
      continue;
    }
    if (current.length === 0 && /\s/.test(character)) {
      separator += character;
      continue;
    }
    current += character;
    const next = normalized[index + 1] ?? "";
    const previous = normalized[index - 1] ?? "";
    let boundary = false;
    if ("。！？!?".includes(character)) {
      boundary = true;
    } else if (character === ".") {
      boundary = next !== "." && (next === "" || /\s/.test(next));
    } else if (character === "…") {
      boundary = next !== "…" && (next === "" || next === "\n" || isClosingCharacter(next));
    }
    if (!boundary) continue;
    while (isClosingCharacter(normalized[index + 1] ?? "")) {
      index++;
      current += normalized[index]!;
    }
    // A period in a decimal or an abbreviation is not a subtitle boundary.
    if (character === "." && /[A-Za-z0-9]/.test(previous) && /[A-Za-z0-9]/.test(next)) continue;
    push();
  }
  push();
  return units;
}

function unitWeight(value: string): number {
  return Math.max(1, [...value].filter((character) => !/\s/.test(character)).length);
}

/**
 * Assign sentence units to audio parts. The OGG durations are the only
 * reliable indication of where a wiki transcript's display line wrapping
 * belongs, so boundaries are chosen to track cumulative spoken-text weight.
 */
function transcriptParts(value: string, count: number, durations: number[]): string[] {
  if (count === 0 || !value.trim()) return Array.from({ length: count }, () => "");
  const units = transcriptUnits(value);
  if (count === 1) return [value.replaceAll("\r\n", "\n").trim()];
  if (units.length === 0) return Array.from({ length: count }, () => "");
  if (units.length <= count) return [
    ...units.map((unit) => unit.text),
    ...Array.from({ length: count - units.length }, () => ""),
  ];

  const weights = units.map((unit) => unitWeight(unit.text));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const usableDurations = durations.length === count && durations.every((duration) => duration > 0)
    ? durations
    : Array.from({ length: count }, () => 1);
  const totalDuration = usableDurations.reduce((sum, duration) => sum + duration, 0);
  const prefixWeights = [0];
  for (const weight of weights) prefixWeights.push(prefixWeights.at(-1)! + weight);
  const prefixDurations = [0];
  for (const duration of usableDurations) prefixDurations.push(prefixDurations.at(-1)! + duration);

  // Dynamic programming chooses every boundary at once, ensuring that every
  // audio part receives at least one unit and that long clips receive more
  // transcript text than short clips.
  const costs = Array.from({ length: count + 1 }, () => Array<number>(units.length + 1).fill(Number.POSITIVE_INFINITY));
  const previous = Array.from({ length: count + 1 }, () => Array<number>(units.length + 1).fill(-1));
  costs[0]![0] = 0;
  for (let part = 1; part <= count; part++) {
    for (let end = part; end <= units.length - (count - part); end++) {
      const target = prefixDurations[part]! / totalDuration;
      for (let start = part - 1; start < end; start++) {
        if (!Number.isFinite(costs[part - 1]![start]!)) continue;
        const fraction = prefixWeights[end]! / totalWeight;
        const cost = costs[part - 1]![start]! + (fraction - target) ** 2;
        if (cost < costs[part]![end]!) {
          costs[part]![end] = cost;
          previous[part]![end] = start;
        }
      }
    }
  }
  const boundaries = Array<number>(count + 1).fill(units.length);
  let end = units.length;
  for (let part = count; part > 0; part--) {
    boundaries[part] = end;
    end = previous[part]![end]!;
  }
  boundaries[0] = 0;
  return Array.from({ length: count }, (_, index) => units
    .slice(boundaries[index]!, boundaries[index + 1]!)
    .map((unit, unitIndex) => unitIndex === 0 ? unit.text : `${unit.separator}${unit.text}`)
    .join(""));
}

async function oggDuration(path: string): Promise<number | null> {
  if (audioDurationCache.has(path)) return audioDurationCache.get(path)!;
  try {
    const bytes = Buffer.from(await readFile(path));
    const signature = Buffer.from([1, 118, 111, 114, 98, 105, 115]);
    const identification = bytes.indexOf(signature);
    if (identification < 0 || identification + 16 > bytes.length) {
      audioDurationCache.set(path, null);
      return null;
    }
    const sampleRate = bytes.readUInt32LE(identification + 12);
    if (!sampleRate) {
      audioDurationCache.set(path, null);
      return null;
    }
    let samples = 0n;
    for (let index = 0; index + 27 < bytes.length;) {
      if (bytes[index] !== 0x4f || bytes[index + 1] !== 0x67 || bytes[index + 2] !== 0x67 || bytes[index + 3] !== 0x53) {
        index++;
        continue;
      }
      const segmentCount = bytes[index + 26]!;
      const segmentTableEnd = index + 27 + segmentCount;
      if (segmentTableEnd > bytes.length) break;
      let bodyLength = 0;
      for (let segment = 0; segment < segmentCount; segment++) bodyLength += bytes[index + 27 + segment]!;
      const pageEnd = segmentTableEnd + bodyLength;
      if (pageEnd > bytes.length) break;
      const granule = bytes.readBigInt64LE(index + 6);
      if (granule > samples) samples = granule;
      index = pageEnd;
    }
    const duration = Number(samples) / sampleRate;
    const result = Number.isFinite(duration) && duration > 0 ? duration : null;
    audioDurationCache.set(path, result);
    return result;
  } catch {
    audioDurationCache.set(path, null);
    return null;
  }
}

async function groupDurations(groups: string[][], audioDirectory: string): Promise<number[]> {
  const durations = await Promise.all(groups.map(async (group) => {
    for (const file of group) {
      const duration = await oggDuration(join(voiceRoot, audioDirectory, file));
      if (duration !== null) return duration;
    }
    return null;
  }));
  return durations.map((duration) => duration ?? 1);
}

function partOverride(directory: string, id: string, language: keyof Subtitle, fallback: string[]): string[] {
  return MEMORIAL_LOBBY_PART_OVERRIDES[directory]?.[id]?.[language] ?? fallback;
}

async function buildLine(line: LegacyVoiceLine, markers: MarkerSet, audioDirectory: string, directory: string): Promise<SubtitleLine | null> {
  if (typeof line.id !== "string") return null;
  // MemorialLobby_0 is the opening trigger, not one of the numbered Talk
  // animations. Keep its audio in the per-character file even though its
  // source manifest has no transcript; the viewer uses it for intro audio.
  const groups = audioGroups(line.audio);
  if (groups.length === 0) return null;
  const number = Number(line.id.match(/(\d+)$/)?.[1] ?? Number.NaN);
  const marker = Number.isFinite(number) ? markers.animations.get(number) : undefined;
  const durations = await groupDurations(groups, audioDirectory);
  const en = partOverride(directory, line.id, "en", transcriptParts(text(line.EN), groups.length, durations));
  const ja = partOverride(directory, line.id, "ja", transcriptParts(text(line.JR), groups.length, durations));
  const ko = partOverride(directory, line.id, "ko", transcriptParts(text(line.KR), groups.length, durations));
  const parts = groups.map((audio, index): VoicePart => ({
    index: index + 1,
    audio,
    subtitle: { en: en[index] ?? "", ja: ja[index] ?? "", ko: ko[index] ?? "" },
    ...(marker?.markers[index] === undefined ? {} : { start: marker.markers[index] }),
  }));
  return {
    id: line.id,
    audio: groups.flat(),
    subtitle: { en: text(line.EN), ja: text(line.JR), ko: text(line.KR) },
    ...(marker ? { animation: marker.name, ...(marker.markers.length > 0 ? { markers: marker.markers } : {}) } : {}),
    parts,
  };
}

/**
 * Repartition already-generated subtitle files without reparsing Spine.
 * Marker extraction is expensive, and the generated files already contain
 * the authoritative marker times; this mode is useful when only transcript
 * boundaries need to be reviewed or corrected.
 */
async function repartitionExisting(): Promise<void> {
  const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as { characters?: CatalogEntry[] };
  const start = Number(process.argv.find((argument) => argument.startsWith("--repartition-start="))?.split("=", 2)[1] ?? 0);
  const count = Number(process.argv.find((argument) => argument.startsWith("--repartition-count="))?.split("=", 2)[1] ?? Number.POSITIVE_INFINITY);
  const entries = (catalog.characters ?? []).slice(
    Number.isFinite(start) && start >= 0 ? start : 0,
    Number.isFinite(count) && count >= 0 ? (Number.isFinite(start) && start >= 0 ? start : 0) + count : undefined,
  );
  let files = 0;
  let lines = 0;
  for (const entry of entries) {
    const path = join(voiceRoot, entry.file);
    const file = JSON.parse(await readFile(path, "utf8")) as CharacterSubtitleFile;
    const audioDirectory = file.audioDirectory || entry.audioDirectory || file.character;
    for (const line of file.lines) {
      if (!Array.isArray(line.parts) || line.parts.length === 0) continue;
      const groups = line.parts.map((part) => part.audio);
      const durations = await groupDurations(groups, audioDirectory);
      const source = line.subtitle ?? { en: "", ja: "", ko: "" };
      const en = partOverride(entry.directory, line.id, "en", transcriptParts(source.en, groups.length, durations));
      const ja = partOverride(entry.directory, line.id, "ja", transcriptParts(source.ja, groups.length, durations));
      const ko = partOverride(entry.directory, line.id, "ko", transcriptParts(source.ko, groups.length, durations));
      line.parts = line.parts.map((part, index) => ({
        ...part,
        subtitle: {
          en: en[index] ?? "",
          ja: ja[index] ?? "",
          ko: ko[index] ?? "",
        },
      }));
      lines++;
    }
    await writeFile(path, `${JSON.stringify(file, null, 2)}\n`, "utf8");
    files++;
  }
  console.log(`repartitioned subtitle files : ${files} (start ${start}, count ${entries.length})`);
  console.log(`repartitioned subtitle lines : ${lines}`);
}

async function main() {
  const manifest = JSON.parse(await readFile(legacyPath, "utf8")) as LegacyManifest;
  await mkdir(voiceRoot, { recursive: true });
  const translatedCharacters = manifest.characters.map((character) => {
    const overrides = ENGLISH_MEMORIAL_LOBBY_OVERRIDES[character.directory] ?? {};
    return {
      ...character,
      lines: character.lines.map((line) => ({
        ...line,
        ...(overrides[line.id] ? { EN: overrides[line.id] } : {}),
      })),
    };
  });
  await writeFile(legacyPath, `${JSON.stringify({ ...manifest, characters: translatedCharacters }, null, 2)}\n`, "utf8");
  const catalog: CatalogEntry[] = [];
  let markerSets = 0;
  let markerMismatches = 0;
  let unparsed = 0;

  for (const translatedCharacter of translatedCharacters) {
    const firstAudio = translatedCharacter.lines.flatMap((line) => Array.isArray(line.audio) ? line.audio : []).find((path): path is string => typeof path === "string");
    const audioDirectory = firstAudio?.replaceAll("\\", "/").split("/")[0] ?? translatedCharacter.character;
    const markerSet = await parseMarkerSet(translatedCharacter.directory);
    if (markerSet.animations.size > 0) markerSets++;
    else unparsed++;
    const lines = (await Promise.all(translatedCharacter.lines
      .map((line) => buildLine(line, markerSet, audioDirectory, translatedCharacter.directory))))
      .filter((line): line is SubtitleLine => line !== null);
    for (const line of lines) {
      const markerCount = line.markers?.length;
      const partCount = line.parts.length;
      if (markerCount !== undefined && markerCount !== partCount) {
        markerMismatches++;
        console.warn(`markers : ${translatedCharacter.directory}/${line.id} has ${markerCount} markers for ${partCount} audio parts`);
      }
    }
    const file: CharacterSubtitleFile = {
      schemaVersion: 2,
      type: "Memorial Lobby subtitles",
      character: translatedCharacter.character,
      variant: translatedCharacter.variant ?? "Base",
      directory: translatedCharacter.directory,
      audioDirectory,
      ...(translatedCharacter.wikiPage ? { wikiPage: translatedCharacter.wikiPage } : {}),
      lines,
    };
    const outputDirectory = join(voiceRoot, audioDirectory);
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(join(outputDirectory, "subtitles.json"), `${JSON.stringify(file, null, 2)}\n`, "utf8");
    catalog.push({
      character: file.character,
      variant: file.variant,
      directory: file.directory,
      file: `${audioDirectory}/subtitles.json`,
      audioDirectory,
    });
  }

  await writeFile(catalogPath, `${JSON.stringify({
    schemaVersion: 2,
    type: "Memorial Lobby subtitle catalog",
    characters: catalog,
  }, null, 2)}\n`, "utf8");
  console.log(`subtitle files : ${catalog.length}`);
  console.log(`marker sets   : ${markerSets}`);
  console.log(`unparsed sets : ${unparsed}`);
  console.log(`marker mismatches : ${markerMismatches}`);
}

if (process.argv.includes("--repartition-only")) await repartitionExisting();
else await main();
