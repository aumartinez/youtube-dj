# YouTube DJ Mixer — feature document

Objective: build a working Vue 3 + Vite + JavaScript + SortableJS SPA with two YouTube decks,
a shared playlist, smart auto crossfade, localStorage persistence and no backend/API keys.
Branch: n/a (directory is not a git repository). Test runner: `npx vitest run` (Vitest + jsdom for the mount smoke test).

## Specs

- **S1** Two visible YouTube players (Deck A, Deck B), side by side, created with the official
  IFrame Player API (`https://www.youtube.com/iframe_api`, `window.YT.Player`).
- **S2** Each deck has Play, Pause and Stop. "Stop resets playback without advancing the playlist."
  Stop also clears the cued video so the next Play restarts from the beginning; the playlist pointer never moves.
- **S3** One shared playlist: add by YouTube URL, remove items, reorder upcoming videos via drag-and-drop (SortableJS).
- **S4** One smart Auto Crossfade button. Direction comes from the active deck: A → B or B → A.
  Selectable durations: 4, 8, 12, 16 seconds.
- **S5** Manual crossfader slider controls both player volumes: position 0 = Deck A at 100 / Deck B at 0,
  position 1 = A at 0 / B at 100.
- **S6** Crossfade starts the destination deck first when necessary, then uses `requestAnimationFrame`
  and interpolates volumes (A = (1-p)*100, B = p*100) over the selected duration.
- **S7** When the outgoing video ends naturally, cue the next available `queued` item into that deck
  without playing it (`cueVideoById` only). The other deck keeps playing untouched.
- **S8** Track item states `queued`, `loaded`, `playing`, `played`; one item can never be assigned to two
  decks, and a deck can only own one item. Reordering must not interrupt assigned videos.
- **S9** Persist playlist order, item states/assignments, fade duration and crossfader position in
  localStorage. On restore: cue videos only, never autoplay; any `playing` item restores as `loaded`.
- **S10** Handle: API loading failure (+ retry), player readiness, unavailable embeds (error codes
  2/5/100/101/150), empty queue, browser autoplay blocking (banner + gesture retry).
- **S11** Clean responsive dark DJ interface: two video panels, crossfader/auto-fade column, draggable playlist.
- **S12** No backend, no API keys. Modular code: pure `lib/` logic, a `stores/mixer.js` singleton,
  small components. Titles come from keyless oEmbed best-effort with a graceful fallback.
- **S13** Timed auto fade (new, opt-in): a separate toggle from the manual Auto Crossfade button.
  When enabled, the app polls the player clock and at the cue point — N seconds before the end
  ("before end") or an absolute timestamp ("at time") — runs the existing crossfade engine, which
  starts the other deck. Fires at most once per track, warns once when no next track exists,
  persists its settings, and never starts audio on reload.
- **S14** Deploy the production build to GitHub Pages with GitHub Actions (`build_type=workflow`,
  no `gh-pages` branch). The Vite `base` is derived from `GITHUB_REPOSITORY` so the project page
  resolves `/youtube-dj/assets/*`; `VITE_BASE` overrides it. `dist/` and `node_modules/` stay out of git.
- **S15** Every playlist row exposes `A` / `B` load buttons. Loading assigns that track to the deck
  and replaces the deck's current item (the replaced item returns to `queued`), preserving the
  transport: a playing deck keeps playing the replacement, a paused deck only cues it. A track
  playing on the other deck cannot be stolen; a cued one can move between decks.
- **S16** The mixer shows the crossfade direction as an explicit arrow between the A and B badges
  (it flips for B → A and pulses during a fade). Icons come from the Font Awesome 7 CDN and are
  decorative: every control keeps a text label. The crossfade button itself reads only
  "Auto crossfade" (or "Cancel fade"): the direction is stated once, in the strip below.
- **S18** First-run affordance: with an empty queue an empty deck shows "No tracks yet" and a
  button that scrolls to and focuses the add field; once the queue has tracks the same button
  becomes "Cue next track" and loads the first queued item without playing it.
- **S19** Auto-generated mixes (`list=RD…`, `start_radio=1`) are detected explicitly: a mix URL
  with a video adds that seed video and shows a warning that the list cannot be read; a mix URL
  without a video is rejected with the same explanation instead of waiting on a probe that will
  never return tracks.
- **S17** Paste a public playlist URL to import every track into the shared queue: a throwaway
  off-screen IFrame player (320×240, ≥200×200 per API requirements) cues the list and
  `getPlaylist()` enumerates it; new tracks are appended, duplicates skipped, titles fetched with
  bounded concurrency, and nothing autoplays. Private playlists are out of scope (needs the Data API).

## Tasks

| ID  | Spec      | Route | Status | Evidence |
|-----|-----------|-------|--------|----------|
| T1  | S3,S8     | inline | done   | `lib/youtube.js` + `lib/playlist.js`; 30 unit tests |
| T2  | S4,S5,S6  | inline | done   | `lib/crossfade.js`; 13 unit tests incl. fake-frame fade |
| T3  | S9        | inline | done   | `lib/storage.js`; 10 sanitization tests |
| T4  | S1,S2,S7,S10 | inline | done | `composables/useYouTubeApi.js`, `stores/mixer.js` |
| T5  | S11,S12   | inline | done   | 5 components, `App.vue`, 700-line dark CSS |
| T6  | S10,S11   | inline | done   | `App.smoke.test.js`: 10 jsdom tests with a stubbed YT player |
| T7  | all       | inline | done   | `npm run build` 23 modules, preview served, headless Edge shows 2 live YT iframes |
| T8  | S13       | inline | done   | `lib/autofade.js` (+tests), store trigger, mixer-panel UI, 85 tests total |
| T9  | S14       | inline | done   | Actions run green; live at https://aumartinez.github.io/youtube-dj/ (200, assets 200, 2 iframes) |
| T10 | S15,S16   | inline | done   | `loadTrackOnDeck`, row A/B buttons, `.direction` arrow, FA 7.3.1 icons; 89 tests |
| T11 | S16,S17   | inline | done   | concatenated button label, playlist import probe, proxy-safe titles; 96 tests |
| T12 | S18       | inline | done   | empty-deck CTA + `cueNextTrack`; 98 tests |
| T13 | S19       | inline | done   | `isMixUrl` detection + explicit warning/rejection; 101 tests |

## Log

**L1 (user request, verbatim)**

Build a working YouTube DJ mixer SPA using Vue 3, Vite, JavaScript, and SortableJS.
Requirements: 1. Two visible YouTube players (Deck A and Deck B), side by side, using the official
YouTube IFrame Player API. 2. Each deck has Play, Pause, and Stop controls. Stop resets playback
without advancing the playlist. 3. One shared playlist. Add videos by YouTube URL, remove items,
and reorder upcoming videos via drag-and-drop. 4. One smart Auto Crossfade button. Determine
direction from the active deck: A to B or B to A. Selectable fade durations: 4, 8, 12, 16 seconds.
5. Manual crossfader slider controls both player volumes. 6. Start the destination deck if necessary
before automatic crossfading. Use requestAnimationFrame and interpolate volumes over the selected
duration. 7. After the outgoing video naturally ends, cue the next available playlist item into that
deck without automatically playing it. Preserve the currently playing deck. 8. Track playlist states
(queued, loaded, playing, played) and prevent duplicate assignment. Reordering must not interrupt
already assigned videos. 9. Persist playlist order and settings in localStorage. Restore playback
safely without autoplay on page reload. 10. Handle YouTube API loading, player readiness, unavailable
embeds, errors, empty queue, and browser autoplay restrictions. 11. Create a clean responsive dark DJ
interface with two video panels, crossfader, and draggable playlist. 12. Use no backend and no API
keys. Keep code modular and maintainable. Implement the actual application, not a visual mockup.
Run the build and fix errors. Provide instructions for local testing.

**L2** Decisions: crossfader position is the single source of truth for both volumes; auto crossfade
snaps the crossfader to the source deck, starts the destination, then animates the position 0↔1, which
interpolates the two volumes linearly. Deck ownership is derived from `item.deck` + `item.state`, so
reordering can never disturb an assigned item. Stop/skip never advance a playlist pointer; the queue is
an explicit item-state machine.

**L3 (verification, 2026-11-07)**
- RED observed: 4 lib suites failed with missing modules. GREEN: 58 unit tests.
- Added `src/App.smoke.test.js` (jsdom + stubbed `window.YT`): 10 integration tests; total 68 passing.
- `npm run build`: 23 modules transformed, dist emitted (130 kB JS / 15.7 kB CSS).
- `npm run preview` + headless Edge DOM dump: HTTP 200, Vue mounted, pill reads "YouTube API ready",
  exactly 2 `youtube.com/embed` iframes with `enablejsapi`, empty-queue state rendered, no API banner.
- Fix found during review: the IFrame API replaces its target element with an `<iframe>`, so the player
  mounts into an untracked child node created by `DeckPanel`; this avoids Vue patch/teardown contention
  and stale player reuse on HMR. `attachDeckContainer` destroys a player bound to an old host.
- Directory is not a git repository; no `git init` and no work-unit commits were made without being asked.
- Risk line: Risk: none (new isolated app; no migrations, auth, shared contracts or concurrency).

**L4 (user request, verbatim, 2026-11-07)**

"This is cool, can you add it an auto cross fader (new one) that will run automatically if enabled,
when the track reaches a timestamp then start the next one?"

Decisions: implemented as an opt-in "Timed auto fade" toggle next to the manual button, with two
trigger modes because "reaches a timestamp" is ambiguous: `before-end` (N seconds left, default 10)
and `at-time` (absolute playhead timestamp, default 60 s). The store polls the player clock every
250 ms (same loop as the progress bars), fires the existing `autoCrossfade()` path once per item id
(`autoFadeRuntime.firedFor`), warns once when the queue has no next track, and resets the fire guard
on Stop/eject so a replayed track can cue again. Settings persist inside `settings.autoFade`;
`enabled` persisting is safe because a restored deck is always cued, never playing.

**L5 (verification after S13)**
- RED observed: `lib/autofade.js` missing + storage autoFade undefined (2 failing).
- 85 tests pass (6 files), including a jsdom test that advances the fake player clock to the cue and
  asserts Deck B starts and the fade is active.
- `npm run build` re-run clean; headless Edge confirms the new "Timed auto fade" control renders.

**L6 (user request, verbatim, 2026-11-07)**

"how do I push this to a github page?"

Decisions: Pages via GitHub Actions with `build_type=workflow` (no `gh-pages` branch, no committed
`dist/`). `vite.config.js` derives `base` from `GITHUB_REPOSITORY` (`/youtube-dj/`) with `VITE_BASE`
as the escape hatch, so local dev stays at `/`. The workflow runs `npm ci`, `npm test`, `npm run build`,
then `configure-pages` + `upload-pages-artifact` + `deploy-pages`; `concurrency: pages` cancels stale
runs. The Pages site was created through the API with `build_type=workflow`.

Evidence: run `42419606618` green end to end; `https://aumartinez.github.io/youtube-dj/` returns 200
with the app title, `/youtube-dj/assets/index-DFS3iN4r.js` returns 200, and headless Edge renders the
mounted app with 2 YouTube iframes and "YouTube API ready".

Housekeeping: an unrelated harness-generated `.atl/` skill-registry folder was accidentally staged in
the CI commit; removed from the index in a follow-up commit and added to `.gitignore`.

**L7 (user request, verbatim, 2026-11-07)**

"the player has a few flaws? I am not able to replace the current track? auto crossfade should have an
arrow to show the direction of the crossfade thing, and if you need to add icons, you could use the
fontawesome cdn bro/"

Decisions:
- Added `loadTrackOnDeck(itemId, deckId)` plus per-row `A` / `B` buttons. Replacement returns the old
  item to `queued`; the deck keeps its transport (playing stays playing, paused stays cued). A track
  playing on the other deck is locked (disabled button + toast); a cued track can move.
- Added `.direction`: A badge, arrow icon (flips right for A→B, left for B→A), B badge, and a
  "Next crossfade / Crossfading" caption; it pulses and shows percent during a fade. Also added
  endpoint arrows to the crossfader labels.
- Icons from Font Awesome 7.3.1 via jsDelivr CSS in `index.html` (verified 200 and every used class
  exists). Text labels remain on every button, so a blocked CDN degrades gracefully.

Evidence: 89 tests (4 new: replace-while-playing, move-cued-to-other-deck, no-steal-while-playing,
direction arrow flips); `npm run build` clean; headless Edge with CDP added 3 tracks, cued one on
Deck A via the row button, and reported 3 rows / 6 load buttons / 1 active / 1 disabled / state
`loaded` / no error, with the arrow and icons rendered in a screenshot.

**L8 (user request, verbatim, 2026-11-07)**

"you added bloated content to the auto crossfade button, if you already have below the button a label
signaling the direction of the crossfade, you can leave the button only as "crossfade" without the
gibberish you left, a two side arrow, auto crossfade (correct), B -> A?"

Decisions:
- Button label is now exactly "Auto crossfade" (with the two-way arrow icon) or "Cancel fade" while
  running. No source/target/percent in it: the `.direction` strip below already states
  "Next crossfade A → B" and flips to B → A when Deck B is live.
- Also delivered the approved public-playlist import: `collectPlaylistIds` mounts a throwaway
  320×240 player off-screen, cues the list, polls `getPlaylist()` (verified: 14 IDs), appends
  deduped tracks, fetches titles with concurrency 4, and always tears the probe down. The add field
  routes playlist URLs through `submitUrl` → `importPlaylist`.

Bug found and fixed: imported/single titles were written to the raw item object instead of its
reactive proxy, so rows kept the fallback title until some other interaction re-rendered them
(14/14 oEmbed calls were 200). `addTrack` and `importPlaylist` now keep the proxies from
`state.items`, with a regression test that asserts the fetched title renders without interaction.

Evidence: 96 tests. CDP against the built app imported a real public playlist: 14 rows, titles
"Google I/O '26 Keynote" etc., no `playlist__import` banner left, probe iframe gone (2 iframes =
the two decks), button text exactly "Auto crossfade".

**L9 (user request, verbatim, 2026-11-07)**

"Load a track, look, there is no track loaded in any deck, how do I "load" the first one?"
then: "you probably didnt understand me, how do I load a track in the initial state?"

The real gap: on a fresh page the queue is empty, so nothing can be cued, and the deck only said
"press Play". Decisions:
- `cueNextTrack(deckId)` loads the first queued item onto an idle deck without playing it.
- An empty deck now shows "No tracks yet — paste a YouTube link below to start." with an
  "Add a track to start" button that scrolls to and focuses `.playlist__input`. Once the queue is
  non-empty the same button reads "Cue next track".
- Row A/B buttons are always deck-colored (pink/cyan) so they read as "send to that deck".

Evidence: 98 tests, including a first-run test asserting the CTA focuses the add field and a cue
test asserting the deck stays `loaded`/not playing. CDP on a fresh profile: initial overlay text
correct, click focused `playlist__input`, after adding one track the button became "Cue next track",
clicking it on Deck B produced title "YouTube Developers Live…", state `loaded`, not playing.

**L10 (user reports, verbatim, 2026-11-07)**

"This is list URL: https://www.youtube.com/watch?v=o7lC8JAWWEA&list=RDo7lC8JAWWEA&start_radio=1"
then "it is not getting added?" / "it only adds the first item from the list".

Finding (verified four ways with throwaway probe pages, including a muted `loadPlaylist` with
autoplay enabled): this is an auto-generated radio/mix (`list=RD…`, `start_radio=1`). `cuePlaylist`
leaves the player in state 5 with `getPlaylist()` returning 0 ids; `loadPlaylist` also returns 0 ids
after 20 s, and even muted it stays in state 5 with 0 ids. YouTube does not expose mix track lists to
the IFrame API, so no keyless client can enumerate them; `list`/`index` are just YouTube frontend
routing params, and the public Data API does not serve auto-generated mixes.

Decision: add `isMixUrl` (`list` starting with `RD`, or `start_radio=1`). A mix URL that carries a
video still adds that single video, plus a persistent inline warning that the list cannot be read
(not a toast that disappears). A mix URL without a video is rejected immediately with the same
explanation, instead of a 12 s probe ending in a generic "no public tracks" error.

Evidence: 101 tests, including the exact reported URL (adds exactly one row for `o7lC8JAWWEA` and
renders `.playlist__warning`) and a mix-only URL (rejected, queue untouched).
