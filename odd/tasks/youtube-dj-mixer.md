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
