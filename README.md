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
bun run test       # bun test unit tests
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

Routes are path-based (`/calendar`, `/simulator`, `/about`) because GitHub
Pages has no rewrite rules, and each route is a real document so it can carry
its own metadata. See "Routing and SEO" below. `public/404.html` forwards
trailing-slash and legacy hash URLs.

## Routing and SEO

Routes are **path-based**: `/`, `/calendar`, `/simulator`, `/about`. GitHub
Pages serves an extensionless URL from the matching `.html` file, so
`/calendar` and `/calendar.html` are the same document and both work.

This was not always so — the app originally routed by URL fragment. A fragment
is never sent to the server, which made `/#/calendar` and `/#/simulator` the
same bytes to any crawler, and every shared link produced the same preview. Now
each route is a real document and carries its own:

| Route | Share/crawl URL | Social image |
| --- | --- | --- |
| Lobby | `/` | `public/og/home.png` |
| Calendar | `/calendar` | `public/og/calendar.png` |
| Simulator | `/simulator` | `public/og/simulator.png` |
| About | `/about` | `public/og/about.png` |

Two things follow from this and are easy to break:

- **Route documents are flat siblings of `index.html`**, never
  `calendar/index.html`, and they are Vite build entries (see `vite.config.ts`).
  A subdirectory would make every relative asset URL (`./assets/...`,
  `./data/...`) resolve one level too deep. All four entries load the same
  `main.tsx`, and Rollup emits one shared chunk, so the extra entries cost three
  small HTML files and no duplicated JavaScript.
- **`og:image` must be absolute, and static HTML cannot compute it**, so the
  origin is hardcoded in five files: `index.html`, the three route documents,
  and `sitemap.xml`. A domain change means editing all five. The runtime copy in
  `src/client/seo.ts` resolves against `location.href` instead, so it follows
  the domain by itself. Nothing checks that the two copies agree.

`public/404.html` forwards the shapes that still need handling: trailing-slash
URLs (`/calendar/`) and pre-migration hash links. `src/client/route.ts`
(`redirectLegacyHash`) catches the hash case in JS, because `/#/simulator`
resolves to a valid `/` and never reaches `404.html` at all.

Navigation between routes is a real page load. That is the trade for correct
previews; a `pushState` router would restore SPA smoothness, but the served
HTML would then only be right on a cold load.

The cards in `public/og/` are prepared offline from `scripts/og/template.html`,
which documents the exact steps. To exercise Pages' own URL resolution
(extensionless files, `404.html` fallback) locally, use
`python3 scripts/pageslike-server.py dist 4328` — `vite preview` does not
reproduce either behaviour.

## Provenance & rights

Banner history: Blue Archive Wiki. Character metadata, portraits and
headshots: SchaleDB. Club names: the Blue Archive Wiki's character infoboxes,
joined to SchaleDB students by their shared numeric ID (SchaleDB exposes only
internal club keys such as `Kohshinjo68`). Banner/mascot/emblem art: Blue
Archive Wiki. Game icons
and recruitment SFX: original game assets — see `public/ba-icons/SOURCES.md`,
`public/ba-sounds/SOURCES.md`, and `public/ba-sounds/manifest.json`. The
lobby artwork notes are in `public/ba-lobby/SOURCES.md`.

Credits acknowledge sources; they do not grant redistribution permission.
Review the applicable source notices and rights before republishing. This is
an unofficial fan project, not affiliated with NEXON Games, NEXON, Yostar, or
the Blue Archive teams. Forecasts are estimates, not announcements.

## License

The source code in `src/` and `scripts/` is MIT licensed — see
[`LICENSE`](LICENSE). That grant covers code only: the bundled game assets
under `public/img/`, `public/ba-icons/`, `public/ba-lobby/`, and
`public/ba-sounds/`, plus the generated `public/data/*.json`, are third-party
material under their own upstream terms and are **not** covered by the MIT
license. See the scope table in `LICENSE` and the per-file `SOURCES.md` notes
before republishing anything from this repository.
