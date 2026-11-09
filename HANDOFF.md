# HANDOFF — YouTube DJ Mixer

**Status:** shipped and stable (sessions of 2026-11-07 → 2026-11-09)
**Live:** https://aumartinez.github.io/youtube-dj/
**Repo:** https://github.com/aumartinez/youtube-dj (public)
**Head:** `245b057` + uncommitted crossfade-direction fix
**Latest daily log:** `.handoffs/handoff-2026-11-09.md`
**Detailed spec + log:** `odd/tasks/youtube-dj-mixer.md`
**User-facing docs:** `README.md`

## What it is

A two-deck YouTube DJ mixer SPA: Vue 3 + Vite + JavaScript + SortableJS, no backend, no API keys.
Two official IFrame players, one shared playlist with drag-and-drop and public-playlist import,
manual crossfader, auto crossfade (4/8/12/16 s), opt-in timed auto fade, repeat list, shuffle, and
seekable deck progress. Natural end rotates decks: the next track starts on the other deck and the
following one is preloaded into the finished deck; when the other deck is live it only cues. State
persists in `localStorage` and restores cued-only, never autoplaying.

## Run and verify

```bash
npm install
npm run dev        # http://localhost:5173 (needs an HTTP origin, not file://)
npm test           # 129 tests
npm run build      # dist/
npm run preview    # http://localhost:4173
```

Deploy: push to `main` → GitHub Actions tests, builds, publishes to Pages.

## Active files

- `src/stores/mixer.js` — transport, crossfade, timed fade, repeat/requeue, seek, import, persistence.
- `src/lib/crossfade.js` — volume math and the rAF + hidden-tab-watchdog fade runner.
- `src/lib/playlist.js` — item states, deck ownership, `requeuePlayed`.
- `src/lib/youtube.js` — video/playlist/mix URL parsing.
- `src/lib/storage.js` — versioned persist/sanitize (fade, autoFade, repeatList).
- `src/components/DeckPanel.vue` — video, transport, seek slider.
- `src/components/PlaylistPanel.vue` — add/import, drag order, repeat/requeue/clear.
- `src/components/CrossfaderPanel.vue` — durations, auto fade, direction, timed fade.
- `.github/workflows/deploy.yml` — Pages pipeline.
- `odd/tasks/youtube-dj-mixer.md` — S1–S23 specs, T1–T19 tasks, L1–L18 log.

## Verified capabilities

129 tests green; production build clean; Actions deploy green; live URL 200 with two real YouTube
iframes. Verified in a real browser: public playlist import (14 tracks, real titles), per-row deck
loading, direction arrow, timed auto fade, background fade after a refresh, repeat/requeue with
played rows, and the seek slider (`role="slider"`, `aria-label="Seek Deck A"`). The natural-end
rotation is covered by tests: the next track starts on the other deck, the following one preloads
into the finished deck, and only cues when the other deck is live. Shuffle selection (random among
unplayed, never re-picking played) and its persistence are covered by unit and store tests.
Playlist drag-and-drop initialization is covered by a mocked-Sortable test (create on an empty
queue plus the `onEnd` reorder handler). Crossfade direction now follows the audible deck
(`crossfadeSourceDeck`): a deck playing at volume 0 does not become the source, and the preview,
timed cue and fade all agree; covered by unit and jsdom tests.

## Known limits

Auto-generated mixes (`RD…`) cannot be enumerated (no list exposed to the API); private playlists
are unreadable; some videos refuse embedding (101/150); playback needs a user gesture; background
timer throttling can delay a cue slightly; icons come from a CDN; state is per browser; no LICENSE.

**Cache note:** after a deploy, hard-refresh before judging a fix — a stale bundle once produced a
false "still broken" report.

## Recent commits

- `245b057` fix: initialize playlist drag-and-drop when the list appears
- `6bad061` feat: add a shuffle toggle for random unplayed selections
- `76bd3e5` feat: rotate decks on natural end and preload the next track
- `6cdabe3` feat: continue playback when the only playing deck ends
- `b9c72c1` feat: make the deck progress bar seekable

## Primary blocker

None.

## Next safe action

Decide whether expanding `RD…` mixes is worth a small VPS/serverless endpoint. If not, the app is
feature-complete; optionally add an MIT `LICENSE`.
