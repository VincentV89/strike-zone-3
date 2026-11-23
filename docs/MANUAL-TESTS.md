# StrikeZone — Manual Tests

These scripts cover the checks no automated tool on the build runtime can perform: real pointer lock, a GPU frame, audible sound and the deployed round. A script counts as evidence only after a person runs it and records the result in `verification/manual-results.json`; then `npm run report` picks it up. The agent never writes a manual result.

## Recording a result

Add one object per run to `results` in `verification/manual-results.json`:

```json
{
  "schemaVersion": 1,
  "results": [
    {
      "id": "MT-03",
      "tester": "Riley",
      "date": "2026-11-20",
      "browser": "Chrome",
      "browserVersion": "142.0",
      "hardware": "Desktop, RTX 3060, 1920x1080",
      "outcome": "pass",
      "notes": "Resume hint appeared after a quick Esc."
    }
  ]
}
```

`id` is one of MT-01..MT-07, `date` is `YYYY-MM-DD`, `outcome` is `pass` or `fail`. Strings are at most 500 characters (`tester` at most 80). The newest dated entry per id wins. Entries that break these rules are listed as rejected in the report.

## Common preconditions

- Desktop Chrome (current), 1920×1080 display, a mouse, speakers or headphones.
- A local production build (`npm run build && npx vite preview`) or the deployed URL. MT-05 uses the test build (`npm run build:test && npx vite preview --outDir dist-test`) for the profiler overlay.
- DevTools open on the Console tab with "Preserve log" on. `console.warn('[strikezone] …')` lines are diagnostics; any red error or uncaught exception fails a script.

## MT-01 — Load, one round, one restart, zero console errors

Covers GV-01 and GV-28 (story-browser-console-clean). Automated by `npm run e2e`; run this script for a real GPU and real pointer lock.

1. Open the game. The main menu appears.
2. Choose Desert Compound, 5 enemies, Normal. Press **Start Game**.
3. Wait for loading to reach 100 %, click **Click to deploy**. The pointer locks and a 3 second countdown runs.
4. Play until the round ends (Victory, Defeat or Time Expired). The end-of-round screen shows.
5. Press **Play Again**. A new round starts without a page reload.
6. Repeat steps 2–5 on Industrial Warehouse.

Pass: no console error and no uncaught exception at any step.

## MT-02 — Lit 3D scene, death reaction, weapon feedback

Covers GV-02 and RQ-08.

1. Start a round on each map with Medium graphics.
2. Look around: the map is lit, has textured surfaces and casts shadows.
3. Fire the rifle at a wall: a muzzle flash shows, the weapon kicks back, an impact mark appears.
4. Reload: the reload animation plays for its whole duration.
5. Hit a bot: a hit marker shows; a headshot shows a distinct marker. Kill a bot: it topples over and stays down, darker.

Pass: every step behaves as described on both maps.

## MT-03 — Real pointer lock, pause and the Ready gate

Covers GV-05.

1. Start a round. At the Ready gate click **Click to deploy**: the cursor disappears and mouse movement turns the view.
2. Press Esc: the pointer is released and Pause opens. Bots and the timer stop.
3. Press **Resume** immediately (within about 1 s): if the browser refuses the lock, the game stays paused with a "click again" hint. Click **Resume** again: the round continues with no catch-up burst.
4. Alt-Tab away and back: the game is paused.
5. Finish the round: the pointer is unlocked on the end-of-round screen.

Pass: all five behave as described; the game never runs unpaused without the lock.

## MT-04 — Deployed URL is playable

Covers DV-05. Needs a deployed stack (`npm run smoke` in live mode).

1. Open the CloudFront URL from `reports/cdk-outputs.json` over HTTPS.
2. Run MT-01 steps 2–5 on one map.
3. Refresh the page during the menu: the game reloads without errors.
4. Open `<url>/some/deep/route`: the game loads instead of an S3 error.

Pass: all four steps succeed with no console error.

## MT-05 — Frame rate per graphics preset and context loss

Covers PF-05 (req-performance-budget). Uses `dist-test/` with `?seams=bypass-lock&seams=overlay` (the overlay shows FPS and per-section timings), or DevTools Performance on the production build.

1. For each preset (Low, Medium, High), play 60 s with 5 bots and 60 s with 20 bots on each map. Note the FPS range from the overlay.
2. Target: 60 FPS at 1080p with 5 bots on Medium; stable play (no sustained drop below 30 FPS) with 20 bots on Low.
3. In the Console run `document.querySelector('canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()`: the round pauses with a restoring message. Then call `.restoreContext()` on the same extension: the round can resume.

Pass: the targets in step 2 hold and step 3 behaves as described. Record the FPS figures in `notes`.

## MT-06 — Audio listening script

Covers AU-01 (req-audio, req-spatial-audio).

1. Start a round with Master 80 and Effects 100. Before any click, no sound plays.
2. Fire each weapon, reload, walk, jump and land: each has its own sound.
3. Hit a bot, take damage, kill a bot: hit, hurt and death cues play.
4. Stand still while a bot fires from your left, then from your right: the sound pans to that side and is quieter at a distance.
5. Win or lose: the victory or defeat cue plays. Menu clicks play a short confirm or back sound.
6. Set Master to 0, then Effects to 0: both make the game silent.

Pass: every step is audible as described and step 6 is silent.

## MT-07 — Keyboard-only menus

Covers AX-01 (req-menu-accessibility).

1. Without the mouse, use Tab, Shift+Tab, the arrow keys, Space and Enter to set up a match, open Settings, Controls, About and History, and start a round.
2. A visible focus ring is on every focused control.
3. In Pause, Esc never resumes; Enter on **Resume** does.

Pass: every menu action is reachable and focus is always visible.

## Browser test setup (for `npm run e2e`)

The build runtime has no root and no Chromium system libraries, so the browser and its libraries live under `$HOME/scratch`, outside the repository:

```sh
PLAYWRIGHT_BROWSERS_PATH=$HOME/scratch/ms-playwright npx playwright install chromium-headless-shell
A=$HOME/scratch/apt; mkdir -p $A/lists/partial $A/cache/archives/partial
OPTS="-o Dir::State::Lists=$A/lists -o Dir::Cache=$A/cache -o Debug::NoLocking=1"
apt-get $OPTS update
mkdir -p $HOME/scratch/debs && cd $HOME/scratch/debs
apt-get $OPTS download libglib2.0-0 libx11-6 libxcomposite1 libxdamage1 libxext6 libxfixes3 \
  libxrandr2 libasound2 libatk1.0-0 libatspi2.0-0 libdbus-1-3 libgbm1 libnspr4 libnss3 libxcb1 \
  libxkbcommon0 libxau6 libxdmcp6 libdrm2 libwayland-server0 libexpat1 libffi8 libpcre2-8-0 \
  libmount1 libselinux1 libblkid1 libxi6 libxrender1 libsystemd0 libbsd0 libmd0 \
  libatk-bridge2.0-0 libcups2 libpango-1.0-0 libcairo2 libxshmfence1 libgcc-s1
for d in *.deb; do dpkg -x "$d" $HOME/scratch/chromium-libs; done
```

`playwright.config.ts` reads the libraries from `SZ_CHROMIUM_LIBS` (default `$HOME/scratch/chromium-libs`) and sets `LD_LIBRARY_PATH` for the browser process only. On a desktop with Chromium dependencies installed, `npx playwright install chromium-headless-shell` alone is enough. WebGL in headless Chromium is software-rendered (SwiftShader), so `npm run e2e` never measures performance.

## Graphics uplift checks (MT-G1..MT-G3)

These are recorded only by a person, in `verification/manual-results.json`. Use Chrome desktop at 1920×1080 on the target hardware class (GTX 1660 / RX 580). Open the production URL, or `npm run build && npx vite preview --config vite.preview.config.ts` locally.

- **MT-G1 visual sign-off.** Seed 42, Medium, 5 bots, on both maps. Take four shots per map: the spawn view, a courtyard or hall interior, a long sight line toward the backdrop, and a close-up of a bot and of the held rifle. Compare them with the reference image (`.aidlc/references/…png`) for sky and fog mood, ground and wall PBR detail, dressing density, prop silhouettes, skinned bots and the weapon model. Record pass or fail with notes. `npm run e2e` (and the CI e2e job artifact `e2e-reports-<sha>`) also saves `reports/playwright/signoff-<map>.png`, one live-round SwiftShader frame per map; use it as a first look only, because software rendering is not the target GPU.
- **MT-G2 60 FPS on Medium with 10 bots.** Run a full round on each map with the dev overlay (`npm run build:test` bundle with `?seams=overlay`, or the browser performance panel on production) and read the frame time. Pass means the median is at or below 16.7 ms and the 1 % low is at or above 50 FPS. Also record the `textureFormats` the overlay lists (BC7 is expected on desktop).
- **MT-G3 60 FPS on Low with 20 bots.** As MT-G2, on Low with 20 bots.
- Also confirm that no `[strikezone] render/asset-*` or `app/csp-violation` warning appears in the console.
