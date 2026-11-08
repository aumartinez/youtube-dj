# HANDOFF — YouTube DJ Mixer

**Status:** shipped and stable (session of 2026-11-07 → 2026-11-08)
**Live:** https://aumartinez.github.io/youtube-dj/
**Repo:** https://github.com/aumartinez/youtube-dj (public)
**Head:** `6329e36`
**Latest daily log:** `.handoffs/handoff-2026-11-08.md`
**Detailed spec + log:** `odd/tasks/youtube-dj-mixer.md`
**User-facing docs:** `README.md`

## What it is

A two-deck YouTube DJ mixer SPA: Vue 3 + Vite + JavaScript + SortableJS, no backend, no API keys.
Two official IFrame players, one shared playlist with drag-and-drop and public-playlist import,
manual crossfader, auto crossfade (4/8/12/16 s) and an opt-in timed auto fade. State persists in
`localStorage` and restores cued-only, never autoplaying.

## Run and verify

```bash
npm install
npm run dev        # http://localhost:5173 (needs an HTTP origin, not file://)
npm test           # 107 tests
npm run build      # dist/
npm run preview    # http://localhost:4173
```

Deploy: push to `main` → GitHub Actions tests, builds, publishes to Pages.

## Active files

- `src/stores/mixer.js` — transport, crossfade, timed fade, playlist import, persistence.
- `src/lib/crossfade.js` — volume math and the rAF + hidden-tab-watchdog fade runner.
- `src/lib/playlist.js` — item states and deck ownership.
- `src/lib/youtube.js` — video/playlist/mix URL parsing.
- `src/lib/storage.js` — versioned persist/sanitize.
- `src/components/*.vue` — deck panels, mixer, playlist, notices.
- `.github/workflows/deploy.yml` — Pages pipeline.
- `odd/tasks/youtube-dj-mixer.md` — S1–S21 specs, T1–T15 tasks, L1–L12 log.

## Verified capabilities

107 tests green; production build clean; Actions deploy green; live URL 200 with two real
YouTube iframes. Verified in a real browser: public playlist import (14 tracks, real titles),
per-row deck loading, direction arrow, timed auto fade trigger, mix detection with inline warning.

## Known limits

Auto-generated mixes (`RD…`) cannot be enumerated (no list exposed to the API); private playlists
are unreadable; some videos refuse embedding (101/150); playback needs a user gesture; background
timer throttling can delay a cue slightly; icons come from a CDN; state is per browser; no LICENSE.

## Primary blocker

None.

## Next safe action

Decide whether expanding `RD…` mixes is worth a small VPS/serverless endpoint. If not, the app is
feature-complete; optionally add an MIT `LICENSE`.
