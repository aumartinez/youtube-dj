# YouTube DJ Mixer

Two-deck YouTube mixer built with **Vue 3 + Vite + JavaScript + SortableJS**.
No backend, no API keys, no build secrets: everything runs in the browser and the
queue lives in `localStorage`.

## What it does

- **Two real YouTube players** (Deck A / Deck B) created with the official
  [IFrame Player API](https://developers.google.com/youtube/iframe_api_reference).
- **Play / Pause / Stop per deck.** Stop resets that deck's playback without
  advancing the playlist; the same track stays attached and restarts from zero.
- **One shared playlist**: paste any YouTube link (`watch?v=`, `youtu.be`,
  `/shorts/`, `/embed/`, `/live/`, `music.youtube.com`, or a bare 11-char id),
  remove tracks, and drag the handle to reorder.
- **Smart auto crossfade**: direction follows the live deck (A → B or B → A),
  selectable 4 / 8 / 12 / 16 s, starts the destination deck first, then
  animates the crossfader with `requestAnimationFrame`, which interpolates both
  `setVolume()` values linearly over the chosen duration.
- **Timed auto fade (auto-DJ)**: a separate opt-in toggle. When enabled, the app
  watches the player clock and fires the same crossfade automatically at the cue
  point — either *N seconds before the track ends* or *at an exact timestamp*
  (e.g. `1:30`). It fires once per track, starts the next track on the other
  deck, and keeps chaining as tracks end. Settings are persisted; nothing plays
  on reload until you press Play.
- **Manual crossfader** is the single source of truth for both volumes:
  position `0` = A 100 % / B 0 %, position `1` = A 0 % / B 100 %.
- **Natural end behavior**: when a video ends, that deck's item becomes
  `played`, the next `queued` item is **cued (not played)** into the same deck,
  and the other deck keeps playing untouched.
- **Item states**: `queued → loaded → playing → played`, with deck ownership
  stored on the item. One item can never be assigned to two decks, and
  reordering cannot interrupt a loaded/playing track.
- **Persistence** of order, states, deck assignments, fade duration and fader
  position. On reload, tracks are cued silently — never autoplayed.
- **Failure handling**: API load failure + retry, player readiness, unavailable
  embeds (error codes 2/5/100/101/150), empty queue, and a browser-autoplay
  banner with a gesture-based retry.

## Local testing

Requirements: Node.js 18+ (built and tested on Node 22), a modern browser, and
internet access for the YouTube player.

```bash
npm install
npm run dev
```

Open the printed URL (default http://localhost:5173). Use `localhost`, not a
`file://` path — the IFrame API needs a real HTTP origin.

Production build and preview:

```bash
npm run build
npm run preview   # http://localhost:4173
```

Unit + integration tests (Vitest; the mount test uses jsdom and a stubbed
`window.YT`, so it needs no network):

```bash
npm test
```

## Try it

1. Paste `https://www.youtube.com/watch?v=dQw4w9WgXcQ` → **Add track**, then
   add a second link.
2. Press **Play** on Deck A: it takes the first queued track.
3. Press **Auto crossfade A → B**: it assigns the second track to Deck B,
   starts it, and fades 4–16 s (your choice) from A to B.
4. Or flip **Timed auto fade** on, pick *Before end* `10` s (or *At track time*
   `90` s), and let it run: when Deck A reaches the cue it brings Deck B in by
   itself, then keeps chaining as each track ends.
5. Press **Stop** on a deck: playback resets, the queue does not move.
6. Let a track end naturally: the next queued item is cued into that deck in a
   paused state; the other deck is untouched.
7. Drag playlist rows by the handle: assigned tracks keep their deck.
8. Reload: the queue and settings return, everything is silent until you press
   Play (browser autoplay policy).

## Architecture

```text
src/
  lib/
    youtube.js       pure URL parsing, thumbnails, oEmbed URL, clock formatting
    playlist.js      item state machine + deck assignment (no duplication)
    crossfade.js     volume math + requestAnimationFrame fade runner
    autofade.js      timed cue logic (before-end / at-time), pure and testable
    storage.js       serialize / sanitize / restore localStorage
  composables/
    useYouTubeApi.js singleton IFrame API loader (timeout, retry, polling)
  stores/
    mixer.js         reactive singleton: players, commands, fade, persistence
  components/
    DeckPanel.vue        video frame, Play/Pause/Stop, progress, volume meter
    CrossfaderPanel.vue  duration chips, auto crossfade, manual fader
    PlaylistPanel.vue    add form + SortableJS list
    PlaylistTrack.vue    row with state/deck badges
    NoticeStack.vue      toasts
  App.vue            layout + API/autoplay banners
```

The YouTube `YT.Player` instances live outside Vue's reactive state on purpose,
and each player is mounted into an untracked child node because the IFrame API
replaces its target element with an `<iframe>`.

## Notes and limits

- Video titles come from a **keyless, best-effort** oEmbed request, with the
  player's own metadata and a stable fallback (`YouTube video <id>`) behind it.
  Some videos still refuse embedding (owner setting) — those surface an
  "Unavailable / embedding disabled" message with a Release button.
- Playback cannot be started without a user gesture. The app never fakes it;
  it shows a banner instead.
- Clearing site data or `localStorage` resets the queue.
