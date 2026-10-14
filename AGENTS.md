# AGENTS.md

Static, serverless Blue Archive gacha calendar. Bun + Vite + React. Deployed to GitHub Pages via a `gh-pages` branch — no CI, no server, no database.

## Hard constraints

**Never introduce absolute paths or cross-origin URLs in `src/client/`.** The site is served from a repo subpath (`https://<user>.github.io/<repo>/`) and may move to a root domain. Vite `base` is `"./"` and every runtime fetch/asset goes through `asset()` in `src/client/api.ts`. `grep -n 'src="/\|href="/\|fetch("/' src/client` currently returns nothing — keep it that way.

**Never add a network call to the client.** It reads only `public/data/*.json` and `public/img/`, which the export commits. No `/api/*` exists.

**Routes are path-based** (`/calendar`, `/simulator`, `/about`), and each route is a real document at the repo root — `index.html`, `calendar.html`, `simulator.html`, `about.html` — listed as Vite build inputs. **Keep them flat siblings of `index.html`; never move one into a subdirectory.** A trailing slash or a subdirectory makes every relative asset URL (`./assets/...`, `./data/...`) resolve one level too deep, and the failure is silent: the HTML loads, the JS 404s, the page renders blank. `src/client/route.ts` matches on the trailing path segment so both `/calendar` and `/calendar.html` resolve; GitHub Pages serves the former from the latter.

**Route metadata is duplicated on purpose, in two places that must stay in sync.** `og:image` has to be an absolute URL and static HTML cannot compute it, so the origin is hardcoded in five files: `index.html`, the three route documents, and `sitemap.xml`. A domain change means editing all five. `src/client/seo.ts` (`ROUTE_META`) holds the same copy and applies it at runtime, resolving against `location.href` so it follows the domain by itself. Nothing checks that the two agree.

**`redirectLegacyHash()` in `route.ts` must stay wired into `main.tsx`.** Old `/#/simulator` links resolve to a perfectly valid `/`, so `public/404.html` never runs for them — without the JS redirect they silently land on the lobby.

**An exception thrown inside a `useEffect` unmounts the entire app**, because the render root is unguarded. `absoluteFrom` in `seo.ts` is pure and unit-tested precisely because an earlier version silently threw on boot and blanked the page.

**`src/model/` is vendored** from the full-stack `blue-archive-gacha-calendar` project. Keep it free of server/DB code, and keep changes in sync with that repo.

## The DTO contract

`scripts/export.ts` writes `public/data/*.json`; `src/client/api.ts` declares the matching interfaces (`CharacterRecord`, `Banner`, `Status`, `ForecastResponse`). **They are not generated and not checked — changing a shape in one without the other fails silently at runtime.** Change both together.

`public/data/*.json` and `public/img/` are committed build artifacts. Regenerate with `bun run export`; hand-editing them is pointless since the next export overwrites them.

## Data sources and joins

Three upstream sources, assembled in `buildSnapshot()` (`scripts/export.ts`):

- **Blue Archive Wiki** — banner history (yearly `Banners_of_YYYY` wikitext subpages) and, via `WikiClubSource`, localized club names.
- **SchaleDB** (`{jp,en,kr}/students.min.json`) — the student roster, IDs, schools, artwork.

Everything joins on the **shared numeric student `Id`**. Two traps:

- SchaleDB's `Club` is an **internal key** (`Kohshinjo68`, `SPTF`, `GourmetClub`) and must never reach the UI. The official English name comes from the wiki's `{{Character}}` infobox via `WikiClubSource`. A wiki failure falls back to the raw key on purpose — watch the `club names : N/278` line in the export log.
- The JP SchaleDB dump localizes `Name` to Japanese. `en` records win on naming while absorbing release flags.

Wiki rate-up names rarely match SchaleDB keys; `VARIANT_ALIASES` in `src/model/domain/characters.ts` bridges them. **The export prints `unresolved rate-ups`** — a new spelling upstream shows up there before it breaks a banner.

## Commands

```bash
bun run typecheck   # tsc --noEmit, covers src + scripts + vite.config.ts
bun run test        # bun test
bun run export --skip-images   # refresh JSON only, no artwork (network required)
```

Focused runs: `bun test src/model` (dir or file path both work). Tests are colocated `*.test.ts` using `bun:test`.

**There is no linter, formatter, or test framework beyond `bun:test`** — nothing is installed for them. Don't try to run or add `lint`/`format`; match surrounding style by hand. Order is `typecheck` then `test`.

## Deploy gotcha

`bash scripts/deploy-branch.sh` builds and force-pushes `dist/` to `gh-pages`. **Its success does not mean the site is updated** — GitHub Pages deploys asynchronously and took ~90s to pick up a push in practice. Verify by comparing the asset hash in the live `index.html` against the branch:

```bash
curl -s https://raw.githubusercontent.com/Terriakidesu/shittim-chest/gh-pages/data/characters.json
```

`scripts/weekly-refresh.sh` = export → commit `public/data` + `public/img` → deploy. It only stages data paths, so source changes must already be committed.

## Client notes

- `Simulator.tsx` (761 lines) and `gachaRules.ts` (600) are the bulk of the app; `gachaRules.ts` is a pure, separately tested recruitment model.
- Simulator state (owned students, counters) persists in `localStorage` under `shittim-simulator:v<VERSION>:<system>:<periodKey>` — a **versioned** key, so a state-shape change needs a bump plus a migration path (`loadSaved` / `migrateRarityCounts`), or returning players silently lose their collection.
- The simulator is mounted once per page load now that routes are real documents, so there is no `key={hash}` remount hack and no `hashchange` listener. The app never calls `history.pushState`, so the query string is read-only.
- `gachaRules.ts` synthesizes minimal `CharacterRecord`s with `club: ""` for banner-only characters; the intro card renders nothing for an empty club, which is the intended no-club case.
- To reproduce GitHub Pages' URL resolution locally (extensionless URLs, `404.html` fallback — neither of which `vite preview` does), run `python3 scripts/pageslike-server.py dist 4328`. It caught a `//` protocol-relative redirect bug in `404.html` that no other check surfaced.

## README drift

`README.md` still documents `.github/workflows/pages.yml` and `forecast.yml`. **Those files were deleted** (commit `e3de43a`) — this repo's own Actions runners are unavailable, so the weekly refresh runs from the separate `Terriakidesu/shittim-chest-cron` repo, or locally via `weekly-refresh.sh`. Trust the scripts over the README here.
