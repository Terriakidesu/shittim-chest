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
| `scripts/deploy-branch.sh` | Builds and publishes `dist/` to the `gh-pages` branch (no Actions needed). |
| `scripts/weekly-refresh.sh` | Local weekly cron: export → commit to `main` → republish `gh-pages`. |
| [`shittim-chest-cron`](https://github.com/Terriakides/shittim-chest-cron) | Org-hosted variant of the same refresh, for when this repo's own Actions runners are unavailable. |
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

Forecast data is not computed in the browser. It refreshes weekly by one of
two routes (same script, different scheduler):

- **With GitHub Actions:** the `forecast` workflow runs `bun run export` in
  CI every Monday, commits the refreshed `public/data/*.json` (plus any new
  artwork) and pushes; the `pages` workflow then redeploys.
- **Without GitHub Actions:** run `bash scripts/weekly-refresh.sh` from a
  local cron (`17 3 * * 1 cd /path/to/shittim-chest && bash
  scripts/weekly-refresh.sh`). It exports, commits to `main`, and
  republishes the `gh-pages` branch via `scripts/deploy-branch.sh`.

The calendar shows the snapshot date from `status.json`, so stale data is
visible rather than silent.

## Deploying to GitHub Pages

Primary method is **branch-based** and needs no GitHub Actions:

1. Push this repository to GitHub (default branch `main`).
2. Publish the built site: `bash scripts/deploy-branch.sh`. It runs
   `bun run build` and pushes `dist/` to the `gh-pages` branch.
3. Open **Settings → Pages** and set **Source** to **Deploy from a branch**,
   branch `gh-pages`, folder `/ (root)`. All URLs are relative, so a
   `user.github.io/repo` subpath works as-is (`.nojekyll` is shipped).

Automation currently runs outside this repo: the
[`shittim-chest-cron`](https://github.com/Terriakides/shittim-chest-cron)
repo hosts the same weekly refresh on organization runners (this account's
own Actions runners are unavailable). It checks this repo out with a stored
token and runs `scripts/weekly-refresh.sh`, so no workflow files are needed
here. Without any Actions access, use the local weekly refresh instead
(next section).

Routes live in the URL hash (`#/calendar`, `#/simulator`, `#/about`), so no
server rewrite rules are needed. `public/404.html` forwards legacy
path-based links (`/calendar`, `/simulator?...`, `/about`) to their hash
equivalents.

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
