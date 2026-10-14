# Shittim Chest — static client (GitHub Pages)

A standalone, serverless, client-only build of the Blue Archive gacha
calendar. There is no API server, no database, and no hotlinking: the browser
reads pre-generated JSON and locally bundled artwork only.

The full-stack project (`blue-archive-gacha-calendar`) remains the home of the
forecast research, the simulator tuning, and the API server. This repository
ships the static subset that can be hosted on GitHub Pages.

## Layout

| Path | Purpose |
| --- | --- |
| `src/client/` | React app (calendar, simulator, lobby, about). Adapted from the full-stack `web/src`; all `/api/*` calls and absolute asset paths replaced with relative static paths. |
| `src/model/` | Vendored forecast model (`config` + `domain` + `sources`, no server/DB code). Rebuilds predictions from upstream data. |
| `scripts/export.ts` | Cron entry point: fetches the wiki + SchaleDB, assembles the forecast, writes `public/data/*.json`, mirrors artwork into `public/img/`. |
| `public/data/` | Generated forecast snapshots, committed by the weekly cron workflow. |
| `public/img/` | Locally bundled artwork (avatars, portraits, banners, mascots, emblems). The client never loads images from upstream hosts. |
| `public/ba-icons/`, `public/ba-lobby/`, `public/ba-sounds/` | Game-derived static assets with provenance notes (`SOURCES.md`, `manifest.json`). |
| `.github/workflows/pages.yml` | Builds with Vite and deploys to GitHub Pages. |
| `.github/workflows/forecast.yml` | Weekly cron: re-runs the export and commits fresh data. |

## Commands

```bash
bun install
bun run export     # rebuild public/data + public/img from upstream sources
bun run dev        # local dev server
bun run build      # static production build in dist/
bun run preview    # serve the production build locally
bun run typecheck  # strict type check
```

`bun run export --skip-images` refreshes the JSON without touching artwork.

## How updates work

Forecast data is not computed in the browser. Every Monday the `forecast`
workflow runs `bun run export` in CI, commits the refreshed
`public/data/*.json` (plus any new artwork) and pushes; the `pages` workflow
then redeploys. The calendar shows the snapshot date from `status.json`, so
stale data is visible rather than silent.

## Provenance & rights

Banner history: Blue Archive Wiki. Character metadata, portraits and
headshots: SchaleDB. Banner/mascot/emblem art: Blue Archive Wiki. Game icons
and recruitment SFX: original game assets — see `public/ba-icons/SOURCES.md`,
`public/ba-sounds/SOURCES.md`, and `public/ba-sounds/manifest.json`. The
lobby artwork notes are in `public/ba-lobby/SOURCES.md`.

Credits acknowledge sources; they do not grant redistribution permission.
Review the applicable source notices and rights before republishing. This is
an unofficial fan project, not affiliated with NEXON Games, NEXON, Yostar, or
the Blue Archive teams. Forecasts are estimates, not announcements.
