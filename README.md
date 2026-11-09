# YouTube DJ Mixer

Two-deck YouTube mixer built with **Vue 3 + Vite + JavaScript + SortableJS**.
No backend, no API keys, no build secrets: everything runs in the browser and the
queue lives in `localStorage`.

**Live:** https://aumartinez.github.io/youtube-dj/

## What it does

- **Two real YouTube players** (Deck A / Deck B) created with the official
  [IFrame Player API](https://developers.google.com/youtube/iframe_api_reference).
- **Play / Pause / Stop per deck.** Stop resets that deck's playback without
  advancing the playlist; the same track stays attached and restarts from zero.
- **Seek on the deck**: click or drag the progress bar to jump anywhere in the
  current video, or focus it and use ← / → for 5-second steps. Works while
  playing and while paused.
- **One shared playlist**: paste any YouTube link (`watch?v=`, `youtu.be`,
  `/shorts/`, `/embed/`, `/live/`, `music.youtube.com`, or a bare 11-char id),
  remove tracks, and drag the handle to reorder.
- **Import public playlists**: paste a `playlist?list=…` URL and the app
  enumerates it with a throwaway off-screen IFrame player (`cuePlaylist` →
  `getPlaylist`), appends every new track to the queue (deduped), and fetches
  titles. Public/unlisted only, still no API key, and nothing autoplays.
- **Repeat list**: a toggle in the playlist header. When the queue runs out it
  requeues every `played` track in list order and cues the first one again —
  it does not autoplay, matching the natural-end rule. **Requeue played** does
  the same on demand. Played rows are dimmed until they are requeued.
- **Smart auto crossfade**: direction follows the live deck (A → B or B → A),
  selectable 4 / 8 / 12 / 16 s, starts the destination deck first, then
  animates the crossfader with `requestAnimationFrame`, which interpolates both
  `setVolume()` values linearly over the chosen duration. The mixer shows the
  direction as an arrow between the A and B badges.
- **Load or replace a specific track**: every playlist row has `A` / `B` buttons.
  Loading onto a busy deck swaps its track (the replaced one goes back to the
  queue) and preserves the transport — a playing deck keeps playing the
  replacement, a paused deck just cues it. A track playing on the other deck
  cannot be stolen; a cued track can move between decks.
- **Timed auto fade (auto-DJ)**: a separate opt-in toggle. When enabled, the app
  watches the player clock and fires the same crossfade automatically at the cue
  point — either *N seconds before the track ends* or *at an exact timestamp*
  (e.g. `1:30`). It fires once per track, starts the next track on the other
  deck, and keeps chaining as tracks end. Settings are persisted; nothing plays
  on reload until you press Play.
- **Manual crossfader** is the single source of truth for both volumes:
  position `0` = A 100 % / B 0 %, position `1` = A 0 % / B 100 %.
- **Natural end behavior**: the finished deck retires its track and the set keeps
  rotating: the next queued item starts on the **other** deck, and the following
  one is preloaded into the finished deck (A → B → A). When the other deck is
  already playing, the next item is only cued so the mix is not interrupted.
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

1. On a fresh page the decks say **Add a track to start** — click it, paste a
   link, press **Add**. The row appears in the playlist; the deck button becomes
   **Cue next track**.
2. Press **Play** on Deck A: it takes the first queued track (or use **Cue next
   track** to load it without playing).
3. Paste a `https://www.youtube.com/playlist?list=…` URL and press **Add** to
   import a whole public playlist (duplicates are skipped).
4. Press **Auto crossfade A → B**: it assigns the second track to Deck B,
   starts it, and fades 4–16 s (your choice) from A to B. The mixer's arrow
   shows the direction it will take.
5. Use a row's **A** / **B** button to load or replace that deck's track — with
   a track playing, the swap keeps the deck playing; otherwise it stays cued.
5. Or flip **Timed auto fade** on, pick *Before end* `10` s (or *At track time*
   `90` s), and let it run: when Deck A reaches the cue it brings Deck B in by
   itself, then keeps chaining as each track ends.
6. Press **Stop** on a deck: playback resets, the queue does not move.
7. Let a track end naturally: the next track starts on the other deck and the
   following one is preloaded into the finished deck, so the decks alternate
   A → B → A. If the other deck is already live, it is only cued.
8. Drag playlist rows by the handle: assigned tracks keep their deck.
9. Turn on **Repeat list** when you reach the end: every played track is
   requeued in order and the first is cued again. **Requeue played** does it
   immediately.
10. Reload: the queue and settings return, everything is silent until you press
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

## Deployment (GitHub Pages)

`.github/workflows/deploy.yml` tests, builds and publishes on every push to `main`.
No `gh-pages` branch and no committed `dist/`.

- `vite.config.js` derives `base` from `GITHUB_REPOSITORY`, so the project page gets
  `/youtube-dj/` asset URLs while local dev and preview stay at `/`.
- Moving to a custom domain or a user page? Set `VITE_BASE` (for example `VITE_BASE=/`).
- The repository's Pages site is enabled with `build_type=workflow`, so the Actions
  job publishes directly. For your own fork: push to `main`, then **Settings → Pages**
  → source **GitHub Actions**, and re-run the workflow.

## Notes and limits

- Video titles come from a **keyless, best-effort** oEmbed request, with the
  player's own metadata and a stable fallback (`YouTube video <id>`) behind it.
  Some videos still refuse embedding (owner setting) — those surface an
  "Unavailable / embedding disabled" message with a Release button.
- Playback cannot be started without a user gesture. The app never fakes it;
  it shows a banner instead.
- Playlist import reads only **public/unlisted** playlists. Private playlists
  need the YouTube Data API (an API key + backend), which this app deliberately
  avoids. Very large playlists may truncate; the app tells you instead of
  silently doing nothing.
- **Auto-generated mixes and radios** (`list=RD…`, `start_radio=1`) cannot be
  enumerated by the player API — verified: cued or loaded, `getPlaylist()` stays
  empty. The app adds the referenced video and warns you; use a public `PL…`
  playlist for bulk import.
- Icons come from the Font Awesome 7 CDN (`cdn.jsdelivr.net`). If a blocker
  removes it, every control keeps its text label and still works.
- Crossfades keep running when the tab is hidden (a time-based watchdog replaces
  `requestAnimationFrame`, which browsers pause). Background browser throttling
  can still delay the cue check by about a second, longer after several minutes
  hidden.
- Clearing site data or `localStorage` resets the queue.
