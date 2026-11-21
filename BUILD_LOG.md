# BUILD LOG — LAMPLIGHT, The Courier's Run (best-stealth-game-20261121-1759)

## What was built
Original top-down 2D stealth game, all code written from scratch (starter only
read for structure; its Block Dodger game was not copied). 1280x720 canvas,
ES modules, no libraries, no network requests, WebAudio-synthesised sounds.

- 3 hand-designed levels (The Garden Wall, The Lantern Court, The Viceroy's
  Vault), 2/4/4 guards with waypoint patrols, pause-and-scan, vision cones
  raycast against walls (walls genuinely cut the cone), suspicion meter with
  suspicious/alert/investigate states, chase + hunt memory, noise radius when
  walking, sneak (Shift) slow + quiet + smaller detection, pebble distraction
  (Q, 3/level, nearest guard investigates), bushes (hide unless guard <55px)
  and shadow zones (detection x0.45), sealed letters (main ★ + optional),
  exit door locked until the sealed letter is taken, score/timer/attempts(3),
  HUD (objective, detection bar, score, timer, letters, pebbles, hearts),
  title / pause / level-clear / game-over / victory screens.
- Deterministic seeds (`?seed=N`); `?shot=start|play|play2|end` stages scenes
  via a Dijkstra autopilot (cone-avoiding routes, waits for patrols, hides in
  bushes) and sets `window.__shotReady` after two paints.

## Files
- `game/index.html`, `game/src/{config,random,input,world,render,shots,audio,main}.js`
- `vendor/makefun-game.ts` (kit copy, unchanged), `main.ts`, `serve.ts`,
  `LICENSE` (MIT), `README.md` (3 live make.fun badges),
  `.makefun/owner.json`, `shots.json`, `screenshots/{1-start,2-play,3-play2,4-end}.png`

## Test results (Node smoke test, `~/workspace/makefun/lamplight-tests/test.mjs`)
14/14 passed: vision in cone+LOS seen, suspicion rises, wall blocks LOS,
bush hides (suspicion stays 0), shadow slows detection, main-letter pickup
sets objective, exit completes level (locked without objective), advance loads
next level, caught loses an attempt, pebble lures nearest guard to
investigate, corner-slide escapes a crate corner.
- Patrol audit: every guard visits 32–56 distinct cells in 60s (no wedged
  patrols after layout fixes).
- End autopilot: an earlier Dijkstra version genuinely won all 3 levels on
  seeds 7/11/42 in the probe harness (47–73s, scores 2655–2915); after the
  later hide/retreat tuning it dies in level 1's left corridor on seed 7
  (caught 3x by t=45) and the shipped `stageShot('end')` run falls back to
  the staged `completeAll()` victory state. The victory screenshot is a real
  render of the real win state either way.
- Play shot (seed 7): completes level 1 in 12.5s; shot taken at 9s mid-action.
  Play2 (seed 7): mid-action, score 100, one guard investigating.

## Screenshots (real renders, headless Chromium via CDP, 0 console errors)
> Superseded by the Reviser pass below (2026-11-22): all four frames were
> re-taken after the autopilot/render fixes. The descriptions and sizes in
> this section are the first build's; the Reviser section has the current ones.
- `1-start.png` 113,764 B — title screen over level 1
- `2-play.png` 161,835 B — level 1, big vision cone, player near the sealed letter
- `3-play2.png` 158,476 B — level 2, player HIDDEN in a bush, suspicious guard, NOTICED meter
- `4-end.png` 113,707 B — victory screen, "THE LAST LETTER DELIVERED"
- All 1280x720, all ≤256 KiB (2-play/3-play2 palette-quantised with PIL to fit;
  1-start/4-end quantised for margin). Visually inspected: all four read
  clearly as a stealth game (cones, cover, letters, exit).

## Verification
- `mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts` succeeds;
  `out/dossier.json` 808,727 B (<1.5 MiB), `out/game` + `out/screenshots`
  copied, 14 files, 1.4 MB total. (The `out/` dir was removed afterwards so
  it does not pollute the repo.)
- `node --check` passes on all 8 game modules. No `http(s):` URLs, no
  `fetch`/`XMLHttpRequest`/`WebSocket`/dynamic `import()` anywhere in `game/`.
- Plain (non-shot) load in headless Chromium: title renders, status line set,
  no exceptions.
- Note: this VM's Chromium blocks `http://` loopback
  (ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS) and needs a WebGL domain-policy
  file to start; screenshots were taken via `file://` with
  `--allow-file-access-from-files` plus the policy switches — the game itself
  serves fine over HTTP (`node serve.ts`, curl 200).

## Reviser pass (2026-11-22 ~02:00 WIB, independent second pass)

### What the first pass got wrong, found by tracing
- **Level 2 was unwinnable by the autopilot: 0/5 seeds, game over at ~33s,
  score 0.** Root cause, traced step by step: the autopilot only sneaked
  within 130px of a guard, but a walking courier is heard within 135px —
  so leaving the spawn it walked straight into guard 3's ears (spawn
  (90,620), guard 3 starts at (201,620)). The noise pulled guard 3 onto the
  courier, and the old "hide when chased" rule then sat the courier in the
  (140,620) bush while an alert guard closed to <55px — inside a bush a
  guard that close sees straight through it. Caught three times in the same
  corner. A sneaking human could always win level 2; the autopilot just
  didn't sneak.
- **The title screen advertised a dead control:** "E — slip through the
  door", but `main.js` hard-codes `interact: false` and nothing reads the E
  key. `ACTION_INTERACT` existed in `input.js` with no consumer.
- **Guard state bubbles were illegible:** the 11px bubble hid the "…"
  (investigate) glyph entirely at full-screen scale.
- **The courier was hard to find at a glance**, especially inside a shadow
  zone where the teal goes muddy.
- **Victory HUD showed 0:00** while the panel said "Total time 214s"
  (fresh level clock on the win backdrop).
- **Minor code bugs:** landed pebble shots were never removed
  (`filter((s) => !s.landed || state.elapsed < 999999)` is always true);
  a no-op `state.attempts = state.attempts;` line in the caught branch.

### Fixes
- `game/src/shots.js` — autopilot: sneak radius 130 → 160px (beyond the
  135px hearing range, with a comment saying why); when chased, do NOT hide
  in a bush — flee to the farthest cover instead, and never flee to a spot
  the courier already stands on (that pinned them against a wall while the
  hunter closed in). Hiding now only triggers when not chased.
- `game/src/render.js` — title line now reads "Step into the green door";
  state bubbles 11px/15px font → 13px/17px; courier gets a pale rim so it
  reads against the dark floor; victory HUD shows total time (0:41) instead
  of the fresh level clock (0:00).
- `game/src/world.js` — landed pebble shots are actually removed;
  no-op attempts line deleted.
- `game/src/input.js` — dead `ACTION_INTERACT` / `KeyE` plumbing removed.
- No level layout was changed: the levels were fair for a sneaking player;
  the autopilot was the broken part.

### Results after the pass
- Per-level autopilot probe, 5 seeds (7/11/42/99/123), before → after:
  level 1 5/5 (12.9s) → 5/5 (13.5–13.6s); level 2 0/5 (OVER ~33s) →
  **5/5 (15.5–17.8s)**; level 3 4/5 (29–137s, one OVER) → **5/5
  (11.8–14.2s)**. Zero catches in any run.
- `stageShot('end')` now **genuinely wins all three levels** on seeds
  7/11/42 (scores 2640–2650, total time 41–43s, 3 attempts left, 3 main
  letters) — the `completeAll()` staged fallback is no longer needed on
  these seeds, though it stays in code as a safety net.
- Node smoke test still 14/14. `node --check` passes on all 8 modules.
- Screenshots re-taken (headless Chromium via CDP, file://, 0 console
  errors on all 4) and re-quantised; all 1280x720, all ≤256 KiB:
  `1-start.png` 113,898 B — title, corrected controls line, courier
  visible bottom-left; `2-play.png` 161,823 B — level 1 at 0:09, courier
  HIDDEN in the top-right shadow with the pale rim, big vision cone, ★
  letter visible; `3-play2.png` 156,028 B — level 2, score 250, objective
  done, exit open, courier sneaking to the door, investigating guard with
  a now-legible "…" bubble; `4-end.png` 117,008 B — real victory, score
  2650, total time 41s, HUD timer 0:41.
- `mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts` succeeds;
  `out/dossier.json` 812,577 B (<1.5 MiB), `out/` 1.5 MB with game +
  screenshots; `out/` removed afterwards. No `http(s):` URLs, no
  `fetch`/`XMLHttpRequest`/`WebSocket`/dynamic `import()` in `game/`.

### Still weak (for the parent, not blockers)
- The autopilot collects only the 3 main letters (no optional letters), so
  the victory panel honestly says "Letters collected 3" where the staged
  version said 11. A human completionist collects more; the panel copy
  still holds ("All three courtyards crossed unseen").
- The end-shot victory still falls back to `completeAll()` if the autopilot
  ever fails on an untested seed; seeds 7/11/42 genuinely win.
- The "…" and "?" bubbles are legible now but remain the smallest marks on
  the field; at a glance they are easy to confuse with each other.
- Level 2's spawn still punishes walking harshly (guard 3 hears a walking
  courier within a second of leaving the start). That is the intended
  lesson — the title screen teaches sneak first — but a first-time player
  who walks will lose an attempt learning it.

## Known limits / for the parent
- Do NOT bundle/submit from this subagent's report — repo creation, bundle,
  and submit are the parent's job. No secrets in any file.
- The end-shot autopilot is the weakest link (level 1 corridor); the shipped
  end screenshot uses the staged victory state when the autopilot does not win.
