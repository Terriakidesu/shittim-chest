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
| `index.html`, `calendar.html`, `simulator.html`, `about.html` | One document per route, each carrying its own title/social metadata. Flat siblings by necessity — see "Routing and SEO". Built by Vite as separate inputs. |
| `scripts/export.ts` | Cron entry point: fetches the wiki + SchaleDB, assembles the forecast, writes `public/data/*.json`, mirrors artwork into `public/img/`. |
| `scripts/deploy-branch.sh` | Builds and publishes `dist/` to the `gh-pages` branch (no Actions needed). |
| `scripts/weekly-refresh.sh` | Weekly refresh: export → commit to `main` → republish `gh-pages`. |
| `scripts/og/template.html` | Source for the social card images in `public/og/`. Rendered offline, not built. |
| `scripts/pageslike-server.py` | Serves `dist/` the way GitHub Pages does (extensionless URLs, `404.html` fallback), for local routing checks. |
| [`shittim-chest-cron`](https://github.com/Terriakides/shittim-chest-cron) | Org-hosted scheduler that runs `weekly-refresh.sh`, for when this repo's own Actions runners are unavailable. |
| `public/data/` | Generated forecast snapshots, committed by the weekly refresh. |
| `public/img/` | Locally bundled artwork (avatars, portraits, banners, mascots, emblems). The client never loads images from upstream hosts. |
| `public/og/` | Per-route Open Graph / Twitter card images (1200×630), prepared offline. |
| `public/ba-icons/`, `public/ba-lobby/`, `public/ba-sounds/` | Game-derived static assets with provenance notes (`SOURCES.md`, `manifest.json`). |
| `public/ba-cards/` | Recruitment card and star recreations by Terriakidesu, with their upstream asset notice and local source notes. |
| `AGENTS.md` | Notes for agents working in this repository. |

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
Both `export` variants need network access.
Student reveal profiles (combat class, weapon, birthday, voice actor and English
recruitment dialogue) come from wiki character infoboxes and `/audio` pages,
joined by numeric student ID. `bun run scripts/student-profiles.ts` regenerates
only the profile fields in `public/data/characters.json`, without refreshing
the calendar or artwork. Missing upstream dialogue is omitted, never invented.

To exercise the routing locally the way GitHub Pages resolves it — extensionless
URLs and the `404.html` fallback, neither of which `bun run preview` reproduces:

```bash
bun run build && python3 scripts/pageslike-server.py dist 4328
```

## How updates work

Forecast data is not computed in the browser. It is rebuilt by
`scripts/export.ts` and refreshed weekly by `scripts/weekly-refresh.sh`
(export → commit `public/data` + `public/img` → republish `gh-pages`). The same
script is used by both schedulers; only the trigger differs:

- **Org-hosted:** the
  [`shittim-chest-cron`](https://github.com/Terriakides/shittim-chest-cron)
  repository runs `weekly-refresh.sh` on organization runners, because this
  account's own Actions runners are unavailable. This is the current path.
- **Local:** point a cron at the script directly —
  `17 3 * * 1 cd /path/to/shittim-chest && bash scripts/weekly-refresh.sh`.

This repository contains no GitHub Actions workflows of its own.

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

Step 2 finishing does not mean the site is updated: Pages builds
asynchronously, which has taken anywhere from about a minute to over five
minutes. Check `Settings → Pages` (or `gh api repos/<owner>/<repo>/pages
--jq .status`) for `built` before assuming a change went out.

## Routing and SEO

Routes are **path-based**: `/`, `/calendar`, `/simulator`, `/spine`, `/about`. GitHub
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
| Spine viewer | `/spine` | `public/og/about.png` |
| About | `/about` | `public/og/about.png` |

Two things follow from this and are easy to break:

- **Route documents are flat siblings of `index.html`**, never
  `calendar/index.html`, and they are Vite build entries (see `vite.config.ts`).
  A subdirectory would make every relative asset URL (`./assets/...`,
  `./data/...`) resolve one level too deep. All five entries load the same
  `main.tsx`, and Rollup emits one shared chunk, so the extra entries cost four
  small HTML files and no duplicated JavaScript.
- **`og:image` must be absolute, and static HTML cannot compute it**, so the
  origin is hardcoded in six files: `index.html`, the four route documents,
  and `sitemap.xml`. A domain change means editing all six. The runtime copy in
  `src/client/seo.ts` resolves against `location.href` instead, so it follows
  the domain by itself. Nothing checks that the two copies agree.

The Spine viewer is intentionally local-only. Choose the directory containing
the exported Spine assets in a Chromium browser; the page reads the selected
`.atlas`, `.png`, and `.skel` files through
the File System Access API and never uploads them. The character and variant
grouping index is bundled at `src/client/spine/characters.json`.

`public/404.html` forwards the shapes that still need handling: trailing-slash
URLs (`/calendar/`) and pre-migration hash links. `src/client/route.ts`
(`redirectLegacyHash`) catches the hash case in JS, because `/#/simulator`
resolves to a valid `/` and never reaches `404.html` at all.

Navigation between routes is a real page load. That is the trade for correct
previews; a `pushState` router would restore SPA smoothness, but the served
HTML would then only be right on a cold load.

The cards in `public/og/` are prepared offline from `scripts/og/template.html`,
which documents the exact steps.

## Provenance & rights

Banner history: Blue Archive Wiki. Character metadata, portraits and
headshots: SchaleDB. Club names: the Blue Archive Wiki's character infoboxes,
joined to SchaleDB students by their shared numeric ID (SchaleDB exposes only
internal club keys such as `Kohshinjo68`). Banner, mascot and emblem art: Blue
Archive Wiki. Game icons and recruitment SFX: original game assets — see
`public/ba-icons/SOURCES.md`, `public/ba-sounds/SOURCES.md`, and
`public/ba-sounds/manifest.json`. The lobby artwork notes are in
`public/ba-lobby/SOURCES.md`.

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

The recreated recruitment cards and stars in `public/ba-cards/` are released
by Terriakidesu under **CC0 1.0 Universal**, with no attribution required.
See [`public/ba-cards/ASSET-LICENSE.md`](public/ba-cards/ASSET-LICENSE.md).
This dedication covers only Terriakidesu's rights in those recreations, not
third-party artwork, trademarks, or other game assets.
