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

**Routes are path-based** (`/calendar`, `/simulator`, `/spine`, `/about`), and each route is a real document at the repo root — `index.html`, `calendar.html`, `simulator.html`, `spine.html`, `about.html` — listed as Vite build inputs. **Keep them flat siblings of `index.html`; never move one into a subdirectory.** A trailing slash or a subdirectory makes every relative asset URL (`./assets/...`, `./data/...`) resolve one level too deep, and the failure is silent: the HTML loads, the JS 404s, the page renders blank. `src/client/route.ts` matches on the trailing path segment so both `/calendar` and `/calendar.html` resolve; GitHub Pages serves the former from the latter.

**Route metadata is duplicated on purpose, in two places that must stay in sync.** `og:image` has to be an absolute URL and static HTML cannot compute it, so the origin is hardcoded in six files: `index.html`, the four route documents, and `sitemap.xml`. A domain change means editing all six. `src/client/seo.ts` (`ROUTE_META`) holds the same copy and applies it at runtime, resolving against `location.href` so it follows the domain by itself. Nothing checks that the two agree. The cards in `public/og/` are **not** build output — they are prepared offline from `scripts/og/template.html`, so changing a card means re-rendering it, not rebuilding.

**`redirectLegacyHash()` in `route.ts` must stay wired into `main.tsx`.** Old `/#/simulator` links resolve to a perfectly valid `/`, so `public/404.html` never runs for them — without the JS redirect they silently land on the lobby.

**An exception thrown inside a `useEffect` unmounts the entire app**, because the render root is unguarded. `absoluteFrom` in `seo.ts` is pure and unit-tested precisely because an earlier version silently threw on boot and blanked the page.

**`src/model/` is vendored** from the full-stack `blue-archive-gacha-calendar` project. Keep it free of server/DB code, and keep changes in sync with that repo.

## The DTO contract

`scripts/export.ts` writes `public/data/*.json`; `src/client/api.ts` declares the matching interfaces (`CharacterRecord`, `Banner`, `Status`, `ForecastResponse`). **They are not generated and not checked — changing a shape in one without the other fails silently at runtime.** Change both together. The same holds for `StudentProfile` (`src/client/api.ts`) vs `StudentProfileDto` (`scripts/student-profiles.ts`), which both carry the optional localized dialogue fields (`dialogueJp`, `dialogueKr`).

`public/data/*.json` and `public/img/` are committed build artifacts. Regenerate with `bun run export`, or refresh only the profile+dialogue fields with `bun run scripts/student-profiles.ts`. Hand-editing them is pointless since the next export overwrites them.

## Announced-only banners

A new pickup is announced on the JP news feed hours before the wiki or SchaleDB
has the student, so `scripts/announced-banners.ts` keeps a small hand-written
table of those rows and `scripts/export.ts` merges them into `banners.json` with
`provisional: true`.

- **The game is the authority; SchaleDB is a mirror.** Both upstream sources lag
  the JP client: the wiki needs someone to transcribe the news post, and
  SchaleDB's roster is machine-mirrored from data it can only publish once it
  has it. When the client already ships the student — live pickups, real
  artwork — neither lag is evidence that anything is "announced", and the copy
  must not say so. The one thing the client cannot supply is the numeric student
  id: those live in `TableBundles`, which are all encrypted (6,523 files, no
  `UnityFS` header), while the Addressables artwork and the costume ids
  (`CH####`) are plain bundles. So art and existence come from the game; ids,
  stats, birthdays and clubs still join through SchaleDB.
- **The two upstream sources do not arrive together.** The wiki usually records
  the batch within hours; SchaleDB — the only source of numeric ids, downloaded
  artwork and localized names — can trail it by a day. In that window the wiki
  row's `Rateup_character` resolves to nothing, so `toDto()` grafts the matching
  announced characters onto the *real wiki banner* (`announcedPlaceholderCharacters`,
  matched on the normalised display name) and marks it `provisional`. The wiki
  keeps its id, dates, type and banner art; only the pool is a placeholder.
  Otherwise the banner ships with an empty roster: the calendar prints the raw
  code, the lobby card has no faces, and the simulator lists a period with
  nothing in it.
- **`provisional` is two different situations, split by the banner id**
  (`isAnnouncedOnly(banner) = provisional && id < 0`). A *grafted* row keeps the
  wiki's positive id: it is live and scheduled, and its student comes from the
  announced table until the roster join catches up, so it gets
  `cal.tag.pending` ("NEW"), `cal.disclaimer.pending` and a
  solid badge. A *hand-kept* row has a negative id: the wiki has not recorded it
  at all, so it gets `cal.tag.announced` ("ANNOUNCED"), `cal.disclaimer.announced`
  and a dashed badge. The disclaimers differ on purpose — one explains that the
  game shipped the student, the other that dates come from a maintenance notice.
- **Negative ids.** Announcement rows and their characters use ids like `-1`;
  SchaleDB ids are positive, so a placeholder can never collide with a real
  student.
- **The placeholder carries the details the roster join would have supplied.**
  `AnnouncedCharacter` has `club` and a `profile` shaped like `StudentProfile`
  (role, weapon, birthday, CV, recruitment line), so the reveal card is not
  blank for the first day. For the 10/28 pair they come from the wiki's
  `{{Character}}` infobox plus each `.../audio` page's `Gachaget` row — the same
  values the in-game screens show — with the English line a reviewed entry in
  `scripts/recruitment-translations.ts` keyed on the exact Japanese text.
  `dialogueKr` stays empty until SchaleDB's `kr/voice.min.json` carries the clip,
  so Korean falls back to English rather than inventing a translation. The wiki
  now knows both ids (`10153`, `20063`), but the rows stay negative: the roster
  that feeds names and artwork still lacks them, and a positive id would send
  `portrait()` to a nonexistent `img/portrait/10153.webp`. `gachaRules` keeps
  `club`/`profile` when it synthesizes the pool entry, because there is no
  roster record to join.
- **Headshots** live in `public/img/announced/`, cropped from the student's own
  `Student_Portrait_*` bust in the JP client (© NEXON Games & Yostar). The client
  is the fastest real source: SchaleDB can trail an update by a day, but the
  store assets are already on disk, and for a not-yet-listed student they are
  filed under the costume's `CH####` id rather than a name — the 10/28 Racing
  forms are `CH0379` (ヒフミ) and `CH0380` (アズサ), whose portraits sit in
  `uis-01_common-01_character-*_textures-*.bundle` next to the named students'.
  The full illustrations come from the same outfit's Spine character set
  instead (`assets-_mx-spinecharacters-ch0379_spr-*` / `ch0380_spr-*`). An atlas
  is 2048² of loose body parts, so it is not a texture you can just unpack: the
  skeleton is Spine 4.2.33 binary, and the standing figure has to be composed by
  running it through the Spine 4.2 runtime at its setup pose and trimming to the
  alpha bounds. That is what SchaleDB's own `img/portrait/<id>.webp` files are
  made of, so the result lines up with the other 278 instead of being a waist-up
  crop. Do not reach for `uis-01_common-34_minigame-tankracing-*`
  (`TankRacing_LobbyChar_*`) — those are lobby CGs, character plus background.
  Delete these files once SchaleDB publishes the real artwork; nothing else
  references them.
- **Every image path goes through a helper**, because an announced student has no
  numeric id to build one from. `headshot(student)` returns the 120px crop for
  negative ids and `img/avatar/<id>.webp` otherwise; `portrait(student)` returns
  the DTO's own `characters[].portrait` when present and `img/portrait/<id>.webp`
  otherwise. Building either path inline by hand 404s silently for these rows.
- **The simulator admits any banner with a non-empty pool**
  (`Simulator.tsx` filters on `characters.length`), so a grafted row is
  simulable like any other: the pool is complete — the game shipped the student
  and the announced table names the rate-up — even though the profile is not.
  An *empty* pool still stays out; a period with nothing in it cannot back a
  spark exchange. A *hand-kept* row (negative id) also stays out of
  `forecast.json` — it has no JP→GL prediction, and letting a date read off a
  news post into the alignment model would shift real forecasts. A *grafted* row
  does carry a prediction, because its date is upstream's by then, so it appears
  in the forecast like any other wiki banner.
- **The lobby strip** shows a provisional batch as `announced` only when it is
  hand-kept *and* has not opened: `announcedNews()` needs
  `isAnnouncedOnly(banner)` and skips rows whose `startMs` has passed, since
  `latestBannerNews()` already reports them as `live`. A wiki-recorded batch is a
  normal upcoming/live period from the start — its pool merely comes from the
  announced table — so it is never labelled an announcement.
- **Dedupe is start-day proximity, not code matching** (`pendingAnnouncedBanners`):
  any wiki banner on the same server starting within 36 h retires the row. The
  announced start comes from a maintenance window and the wiki usually records
  the batch a few hours apart, and the wiki's code for a brand-new student is
  itself a guess until SchaleDB publishes it.
- The export log prints `announced : N provisional, M superseded or expired` and
  `placeholder : N wiki banners with announced characters` — a row that never
  clears means the dedupe drifted or the wiki spelled the student differently
  (check the `unresolved rate-ups` line below it), and a `placeholder` count that
  stays at 1 after SchaleDB catches up means the name stopped matching.
- `cal.tag.announced` / `cal.tag.pending` / `cal.disclaimer.*` / `chip.title.*`
  are the localized strings (en/ja/ko); the detail panel hides the simulator
  deep link only when the pool is empty, since a banner with no rate-ups has no
  period to open.

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
  It is a mirror, not the authority: a student the game already ships can be
  missing here for a day, which is the announced-placeholder case above — those
  rows take their artwork from the JP client instead.

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
- Static `<head>` metadata (`index.html`, the four route documents,
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
