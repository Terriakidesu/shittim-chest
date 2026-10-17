import type { Server } from "./api";

const KEY = "shittim-simulator-selection:v1";
export interface SimulatorSelection { server: Server; period: string; banner: number; }

export function readSelection(params: URLSearchParams): Partial<SimulatorSelection> {
  let saved: Partial<SimulatorSelection> = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {}; } catch { /* unavailable storage */ }
  const explicit = params.has("server") || params.has("period") || params.has("banner");
  if (explicit) return { server: params.get("server") === "JP" ? "JP" : "GL", period: params.get("period") ?? "", banner: Number(params.get("banner")) };
  return { server: saved.server === "JP" ? "JP" : "GL", period: typeof saved.period === "string" ? saved.period : "", banner: Number(saved.banner) };
}

export function saveSelection(selection: SimulatorSelection) {
  try { localStorage.setItem(KEY, JSON.stringify(selection)); } catch { /* unavailable storage */ }
}
