import type { Server } from "../config";

/** Raw row as it appears in the wiki wikitext, before normalisation. */
export interface RawWikiBanner {
  id: string;
  server: string;
  code: string;
  type: string;
  crossregionId: string;
  nameJp: string;
  nameEn: string;
  image: string;
  rateupCharacter: string;
  rerun: string;
  limited: string;
  startDate: string;
  endDate: string;
  notes: string;
}

export interface SourceMeta {
  key: string;
  label: string;
  fetchedAtMs: number;
  /** Conditional-GET validators, so refreshes can be near-free. */
  etag?: string;
  lastModified?: string;
  changed: boolean;
}

/**
 * `T` is whatever the source actually yields — an array for the wiki, a Map for
 * SchaleDB — so the caller does not have to unpack nested generics.
 */
export interface SourceResult<T> {
  records: T;
  meta: SourceMeta;
}

export interface BannerSource {
  readonly key: string;
  /** Human-facing label, shown in the UI provenance line. */
  readonly label: string;
  fetchAll(opts?: { since?: string }): Promise<SourceResult<RawWikiBanner[]>>;
}

/** Maps a student id to its localised club name. */
export interface ClubSource {
  readonly key: string;
  readonly label: string;
  fetchAll(): Promise<SourceResult<Map<number, string>>>;
}

export type { Server };