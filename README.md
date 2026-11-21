# LAMPLIGHT — The Courier's Run

[![make.fun · best-stealth-game-20261121-1759](https://make.fun/badge/best-stealth-game-20261121-1759.svg)](https://make.fun/bounty/best-stealth-game-20261121-1759?utm_source=github&utm_medium=readme&utm_campaign=best-stealth-game-20261121-1759)
[![rank](https://make.fun/badge/best-stealth-game-20261121-1759/whyuardi/makefun-best-stealth-game-20261121/rank.svg)](https://make.fun/bounty/best-stealth-game-20261121-1759/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-stealth-game-20261121-1759)
[![reward](https://make.fun/badge/best-stealth-game-20261121-1759/whyuardi/makefun-best-stealth-game-20261121/reward.svg)](https://make.fun/bounty/best-stealth-game-20261121-1759?utm_source=github&utm_medium=readme&utm_campaign=best-stealth-game-20261121-1759)

A top-down 2D stealth game. You are the courier: cross three lamplit
courtyards unseen, steal each sealed letter, and slip out through the green
door. Guards patrol with real vision cones — walls and crates block their
sight, bushes and shadow hide you, running is loud, and a thrown pebble can
pull a guard away from your path. Get spotted and the whole watch comes
running; break line of sight and vanish into the dark again.

## How to play

- **Objective:** pick up the glowing sealed letter (★), then reach the green
  EXIT door. Optional letters add score. Three levels, three attempts.
- **Detection:** a guard's suspicion fills while you are inside its vision
  cone with a clear line of sight. At full suspicion it chases you; if it
  touches you, you are caught and dragged back to the start.
- **Hiding:** bushes hide you completely (unless a guard is very close) and
  shadow zones slow detection. Break line of sight to cool suspicion down.
- **Noise:** walking is heard nearby; sneaking is slow and nearly silent.
  Throw a pebble (Q) to lure the nearest guard to where it lands.

## Controls

| Key | Action |
| --- | --- |
| W A S D / arrows | Move |
| Shift | Sneak (slow, quiet, harder to spot) |
| Q | Throw a pebble (limited per level) |
| Space / click | Confirm, start, next level |
| P / Esc | Pause |

## Run it

```sh
node serve.ts
# open http://localhost:8080
```

No build step, no network requests, no audio files — all art is drawn on
canvas and all sounds are synthesised with WebAudio. `?seed=N` fixes the
patrols; `?shot=start|play|play2|end` stages a screenshot scene.
