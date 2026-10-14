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

Routes live in the URL hash (`#/calendar`, `#/simulator`, `#/about`), so no
server rewrite rules are needed. `public/404.html` forwards legacy
path-based links (`/calendar`, `/simulator?...`, `/about`) to their hash
equivalents.

## SEO and social previews

Because a URL fragment never reaches the server, `/#/calendar` and `/#/about`
are the *same document* to any crawler, and social scrapers parse raw HTML
without running JavaScript. So each route also has a real static document
carrying its own metadata:

| Route | Share/crawl URL | Social image |
| --- | --- | --- |
| Lobby | `/` | `public/og/home.png` |
| Calendar | `/calendar.html` | `public/og/calendar.png` |
| Simulator | `/simulator.html` | `public/og/simulator.png` |
| About | `/about.html` | `public/og/about.png` |

The `public/*.html` shims hold the crawler-visible title, description,
canonical, Open Graph and Twitter tags, then forward to the matching hash
route. `src/client/seo.ts` holds the same copy in `ROUTE_META` and applies it
on in-app navigation. **Edit both together** — nothing checks that they agree.
`public/robots.txt` and `public/sitemap.xml` list only the static entries.

Two things to know before touching this area:

- **`og:image` must be absolute and a static shim cannot compute it**, so
  `index.html`, the three shims and `sitemap.xml` hardcode
  `https://terriakidesu.github.io/shittim-chest/`. A domain change means
  updating all five. The runtime copy in `seo.ts` resolves against
  `location.href` instead, so it follows the domain by itself.
- **The cards in `public/og/` are prepared offline, not built.** They render
  from `scripts/og/template.html`, which documents the exact steps; each card's
  background reuses that route's lobby art from `public/ba-lobby/`.

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
