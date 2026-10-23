# AGENTS.md

Static, serverless Blue Archive gacha calendar. Bun + Vite + React. Published to GitHub Pages from the `gh-pages` branch. No repo-defined CI, no server, no database — the only automated build is GitHub's own Pages deployment for that branch.

## Hard constraints

**Never introduce absolute paths or cross-origin URLs in `src/client/`.** The site is served from a repo subpath (`https://<user>.github.io/<repo>/`) and may move to a root domain. Vite `base` is `"./"` and every runtime fetch/asset goes through `asset()` in `src/client/api.ts`. The invariant holds today:

```bash
grep -rn 'src="/\|href="/\|fetch("/' src/client   # no matches
```

Note the `-r`: without it grep errors with "Is a directory" and looks like a
pass.

**Never add a network call to the client.** It reads only `public/data/*.json` and `public/img/`, which the export commits. No `/api/*` exists.

**Routes are path-based** (`/calendar`, `/simulator`, `/about`), and each route is a real document at the repo root — `index.html`, `calendar.html`, `simulator.html`, `about.html` — listed as Vite build inputs. **Keep them flat siblings of `index.html`; never move one into a subdirectory.** A trailing slash or a subdirectory makes every relative asset URL (`./assets/...`, `./data/...`) resolve one level too deep, and the failure is silent: the HTML loads, the JS 404s, the page renders blank. `src/client/route.ts` matches on the trailing path segment so both `/calendar` and `/calendar.html` resolve; GitHub Pages serves the former from the latter.

**Route metadata is duplicated on purpose, in two places that must stay in sync.** `og:image` has to be an absolute URL and static HTML cannot compute it, so the origin is hardcoded in five files: `index.html`, the three route documents, and `sitemap.xml`. A domain change means editing all five. `src/client/seo.ts` (`ROUTE_META`) holds the same copy and applies it at runtime, resolving against `location.href` so it follows the domain by itself. Nothing checks that the two agree. The cards in `public/og/` are **not** build output — they are prepared offline from `scripts/og/template.html`, so changing a card means re-rendering it, not rebuilding.

**`redirectLegacyHash()` in `route.ts` must stay wired into `main.tsx`.** Old `/#/simulator` links resolve to a perfectly valid `/`, so `public/404.html` never runs for them — without the JS redirect they silently land on the lobby.

**An exception thrown inside a `useEffect` unmounts the entire app**, because the render root is unguarded. `absoluteFrom` in `seo.ts` is pure and unit-tested precisely because an earlier version silently threw on boot and blanked the page.

**`src/model/` is vendored** from the full-stack `blue-archive-gacha-calendar` project. Keep it free of server/DB code, and keep changes in sync with that repo.

## The DTO contract

`scripts/export.ts` writes `public/data/*.json`; `src/client/api.ts` declares the matching interfaces (`CharacterRecord`, `Banner`, `Status`, `ForecastResponse`). **They are not generated and not checked — changing a shape in one without the other fails silently at runtime.** Change both together. The same holds for `StudentProfile` (`src/client/api.ts`) vs `StudentProfileDto` (`scripts/student-profiles.ts`), which both carry the optional localized dialogue fields (`dialogueJp`, `dialogueKr`).

`public/data/*.json` and `public/img/` are committed build artifacts. Regenerate with `bun run export`, or refresh only the profile+dialogue fields with `bun run scripts/student-profiles.ts`. Hand-editing them is pointless since the next export overwrites them.

## Data sources and joins

Three upstream sources across two hosts, assembled in `buildSnapshot()`
(`scripts/export.ts`):

- **Blue Archive Wiki, banner history** — `BlueArchiveWikiSource` reads the
  yearly `Banners_of_YYYY` wikitext subpages.
- **Blue Archive Wiki, club names** — `WikiClubSource` reads the `Club` field
  of each `{{Character}}` infobox.
- **SchaleDB** (`{jp,en,kr}/students.min.json`) — `SchaleDbSource` supplies
  the student roster, IDs, schools and artwork; the `jp`/`kr` dumps add
  localized `Name` spellings (`nameJp`/`nameKr`) onto every character record.

Everything joins on the **shared numeric student `Id`**. Two traps:

- SchaleDB's `Club` is an **internal key** (`Kohshinjo68`, `SPTF`, `GourmetClub`) and must never reach the UI. The official English name comes from the wiki's `{{Character}}` infobox via `WikiClubSource`. A wiki failure falls back to the raw key on purpose — watch the `club names : N/278` line in the export log.
- The JP SchaleDB dump localizes `Name` to Japanese. `en` records win on naming while absorbing release flags.

Wiki rate-up names rarely match SchaleDB keys; `VARIANT_ALIASES` in `src/model/domain/characters.ts` bridges them. **The export prints `unresolved rate-ups`** — a new spelling upstream shows up there before it breaks a banner.

Localized data rides the same numeric-ID joins. Recruitment dialogue is per-language on the profile: `dialogueJp` is the wiki audio table's own `lang="ja"` cell (same multi-line join as the English `Gachaget` text) and `dialogueKr` is the `CharacterGetIdle1` transcription from SchaleDB `{kr}/voice.min.json` — the same obtained clip, not an unrelated line. When a source fails, the line falls back to English (and the export warns); it must never fall back to an invented substitute. Watch the `student profiles: N; recruitment dialogue: N/278 (ja N, kr N)` line in the export log.

## Interface localization (en/ja/ko)

`src/client/i18n/` holds the dictionaries and store. `en.ts` is the source of
truth; `ja.ts` and `ko.ts` are typed `Record<keyof typeof en, string>`, so a
renamed or dropped English key fails typecheck. `i18n.test.ts` re-checks key
parity at runtime (key order is irrelevant) and that translated placeholders
stay equal; `cal.guide.suffix` is the only sanctioned empty string — a CJK
glue artifact. `t()` falls back to the English
string, so a key can ship before its translations land.

- Every user-facing string goes through `t()`; localized *data* (student
  names, schools, clubs, the intro-card dialogue, banner type labels) goes
  through the helpers in `i18n/index.ts` (`studentName`, `studentDialogue`,
  `schoolName`, `clubName`, `bannerNames`, `typeLabel`,
  `translateModelString` for strings minted inside the pure model).
  Components must not branch on the language themselves — add a helper.
- Dates and numbers format via `localeFor(getLanguage())` (`store.ts`).
  Internal keys stay `YYYY-MM-DD` and the timezone picker is a separate
  concern; the language only picks the display locale.
- `setLanguage()` persists under `shittim-language` and keeps `<html lang>`
  in sync; `initializeLanguage()` runs on boot. Components that localize must
  call the `useLanguage()` hook (`useSyncExternalStore`) to re-render.
- A `LanguageSwitch` sits on every page. Never fold the language into the
  simulator's persisted `localStorage` key: switching languages must not wipe
  a collection or counters. Tests that flip the language must restore it
  (try/finally — bun's `expect()` takes no message argument).
- Static `<head>` metadata (`index.html`, the three route documents,
  `sitemap.xml`) stays English-only; only `applySeo` localizes it, at runtime.
- Decorative English is untranslated on purpose: contract/document seals, the
  "SHITTIM CHEST" placeholder, "Pick Up!" card labels, source/software names
  and license identifiers, `<code>` tokens, STRIKER/SPECIAL and other AR
  game-term codes, and the recruitment voice audio itself.
- Localized today: all UI strings plus student names and recruitment
  dialogues. The intro card's birthday and CV credit are still English —
  localizing them means new profile fields joined by student ID, not
  dictionary keys.

## Commands

```bash
bun run typecheck   # tsc --noEmit, covers src + scripts + vite.config.ts
bun run test        # bun test
bun run export --skip-images   # refresh JSON only, no artwork (network required)
bun run scripts/student-profiles.ts   # refresh profiles+dialogues only, into the existing characters.json (network)
```

Focused runs: `bun test src/model` (dir or file path both work). Tests are colocated `*.test.ts` using `bun:test`.

**There is no linter, formatter, or test framework beyond `bun:test`** — nothing is installed for them. Don't try to run or add `lint`/`format`; match surrounding style by hand. Order is `typecheck` then `test`.

## Deploy

`bash scripts/deploy-branch.sh` builds and force-pushes `dist/` to `gh-pages`. **Its exit code does not mean the site is updated.** Pages builds asynchronously, and the wait has ranged from ~90s to 5m+ across deploys. Watch the actual run rather than guessing:

```bash
gh api repos/Terriakidesu/shittim-chest/pages --jq '.status'   # "building" -> "built"
gh run list --repo Terriakidesu/shittim-chest --limit 3
```

Then confirm the live document references the build you just pushed:

```bash
git show origin/gh-pages:index.html | grep -oE 'assets/[A-Za-z0-9_.-]*\.js'
curl -s "https://terriakidesu.github.io/shittim-chest/index.html" | grep -oE 'assets/[A-Za-z0-9_.-]*\.js'
```

Do not grep for a hardcoded asset filename. The entry chunk is named after the
build input key in `vite.config.ts` (`main-*.js`), and hardcoding it already
caused a check to poll for a file that cannot exist, reporting "not deployed"
for five minutes while Pages was building normally.

`scripts/weekly-refresh.sh` = export → commit `public/data` + `public/img` → deploy. It only stages data paths, so source changes must already be committed.

## Client notes

- `Simulator.tsx` (~760 lines) and `gachaRules.ts` (~600) are the bulk of the app; `gachaRules.ts` is a pure, separately tested recruitment model.
- Simulator state (owned students, counters) persists in `localStorage` under `shittim-simulator:v<VERSION>:<system>:<periodKey>` — a **versioned** key, so a state-shape change needs a bump plus a migration path (`loadSaved` / `migrateRarityCounts`), or returning players silently lose their collection.
- The simulator is mounted once per page load now that routes are real documents, so there is no `key={hash}` remount hack and no `hashchange` listener. The app never calls `history.pushState`, so the query string is read-only.
- `gachaRules.ts` synthesizes minimal `CharacterRecord`s with `club: ""` for banner-only characters; the intro card renders nothing for an empty club, which is the intended no-club case.
- To reproduce GitHub Pages' URL resolution locally (extensionless URLs, `404.html` fallback — neither of which `vite preview` does), run `python3 scripts/pageslike-server.py dist 4328`. It caught a `//` protocol-relative redirect bug in `404.html` that no other check surfaced.
