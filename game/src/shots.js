// The screenshot scenes behind ?shot=start|play|play2|end. Each one plays the real
// rules forward from a fresh world for a fixed number of steps, steered by a simple
// autopilot (a grid path around the walls toward the sealed letter, then the
// green door; it sneaks near guards, flees to the nearest bush when chased, and
// throws one pebble on the second level), so the frame is what a short game
// really looks like and the same seed always gives the same frame.
import { STEP } from './config.js';
import { EVENT_LEVEL, EVENT_WIN } from './world.js';
import { SCREEN_LEVEL, SCREEN_OVER, SCREEN_PLAY, SCREEN_TITLE, SCREEN_VICTORY } from './render.js';

const START_SECONDS = 5;
const PLAY_SECONDS = 9;
const PLAY2_SECONDS = 12;
const END_LIMIT_SECONDS = 900;
const SAMPLE = STEP;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** The autopilot's memory: its planned path, what it is heading for, and hiding. */
function pilotMemory() {
  return { path: [], pathIdx: 0, targetKey: '', replanIn: 0, hiding: false, hideSince: 0 };
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** True when this guard's cone covers a point (range and angle only). */
function coneCoversPoint(guard, x, y) {
  const dx = x - guard.x;
  const dy = y - guard.y;
  const dist = Math.hypot(dx, dy);
  if (dist > guard.range) return false;
  return Math.abs(angleDiff(Math.atan2(dy, dx), guard.angle)) <= guard.fov / 2;
}

/** True when the courier stands inside this guard's cone (range and angle only). */
function inCone(state, guard) {
  return coneCoversPoint(guard, state.player.x, state.player.y);
}

function nearestBush(state) {
  const p = state.player;
  let best = null;
  let bestScore = Infinity;
  for (const bush of state.bushes) {
    const d = Math.hypot(bush.x - p.x, bush.y - p.y);
    // A bush a guard is looking at right now is no refuge at all.
    let danger = 0;
    for (const guard of state.guards) {
      if (coneCoversPoint(guard, bush.x, bush.y)) danger += 300;
    }
    const score = d + danger;
    if (score < bestScore) {
      bestScore = score;
      best = bush;
    }
  }
  return best;
}

/**
 * A coarse grid path (Dijkstra, 4-way) from the courier to a target, steering
 * around walls and crates — and around the guards' vision cones, which cost
 * extra, so the route prefers the dark. A cell counts as blocked when a wall
 * or crate overlaps it.
 */
function computePath(state, tx, ty) {
  const cell = 40;
  const cols = 32;
  const rows = 18;
  const blockers = state.walls.concat(state.crates);
  const blocked = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      const x = i * cell;
      const y = j * cell;
      for (const r of blockers) {
        if (x + cell - 14 > r.x && x + 14 < r.x + r.w && y + cell - 14 > r.y && y + 14 < r.y + r.h) {
          blocked[j * cols + i] = 1;
          break;
        }
      }
    }
  }
  // Cells a guard is looking at right now cost extra to walk through.
  const cost = new Float32Array(cols * rows).fill(1);
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      const cx = i * cell + cell / 2;
      const cy = j * cell + cell / 2;
      for (const guard of state.guards) {
        if (coneCoversPoint(guard, cx, cy)) cost[j * cols + i] += 25;
        else if (Math.hypot(guard.x - cx, guard.y - cy) < 100) cost[j * cols + i] += 4;
      }
    }
  }
  const startI = clamp(Math.floor(state.player.x / cell), 0, cols - 1);
  const startJ = clamp(Math.floor(state.player.y / cell), 0, rows - 1);
  const goalI = clamp(Math.floor(tx / cell), 0, cols - 1);
  const goalJ = clamp(Math.floor(ty / cell), 0, rows - 1);
  const start = startJ * cols + startI;
  const goal = goalJ * cols + goalI;
  const dist = new Float32Array(cols * rows).fill(Infinity);
  const prev = new Int32Array(cols * rows).fill(-1);
  const done = new Uint8Array(cols * rows);
  dist[start] = 0;
  prev[start] = start;
  for (let iter = 0; iter < cols * rows; iter += 1) {
    let cur = -1;
    let best = Infinity;
    for (let n = 0; n < cols * rows; n += 1) {
      if (!done[n] && dist[n] < best) {
        best = dist[n];
        cur = n;
      }
    }
    if (cur === -1 || cur === goal) break;
    done[cur] = 1;
    const ci = cur % cols;
    const cj = Math.floor(cur / cols);
    const neighbours = [
      [ci + 1, cj],
      [ci - 1, cj],
      [ci, cj + 1],
      [ci, cj - 1],
    ];
    for (const [ni, nj] of neighbours) {
      if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
      const n = nj * cols + ni;
      if (blocked[n] || done[n]) continue;
      const nd = dist[cur] + cost[n];
      if (nd < dist[n]) {
        dist[n] = nd;
        prev[n] = cur;
      }
    }
  }
  if (prev[goal] === -1) return [{ x: tx, y: ty }];
  const path = [];
  let cur = goal;
  while (cur !== start) {
    const ci = cur % cols;
    const cj = Math.floor(cur / cols);
    path.unshift({ x: ci * cell + cell / 2, y: cj * cell + cell / 2 });
    cur = prev[cur];
  }
  path.push({ x: tx, y: ty });
  return path;
}

/**
 * Steer the courier along its planned path: toward the sealed letter, then the
 * exit; sneak near guards, flee to the nearest bush when chased.
 */
function autopilot(state, mem, time) {
  const p = state.player;
  const maxSuspicion = Math.max(0, ...state.guards.map((guard) => guard.suspicion));
  const chased = state.guards.some((guard) => guard.state === 'alert' && Math.hypot(guard.x - p.x, guard.y - p.y) < 220);

  // Chased by a guard that knows exactly where the courier is: a bush will
  // not save them — a guard closer than 55px sees straight into it — so do
  // not hide. Run for the farthest cover instead (a bush, or an inner corner
  // of the courtyard) and only think about hiding once the chase breaks.
  // The flee target is picked fresh every step, so the courier keeps moving
  // away from the hunter instead of being pinned against a wall.
  let flee = null;
  if (chased) {
    mem.hiding = false;
    const chaser = state.guards.find((guard) => guard.state === 'alert' && Math.hypot(guard.x - p.x, guard.y - p.y) < 220);
    if (chaser) {
      const candidates = state.bushes.map((b) => ({ x: b.x, y: b.y }));
      candidates.push({ x: 90, y: 130 }, { x: 1190, y: 130 }, { x: 90, y: 620 }, { x: 1190, y: 620 });
      let bestScore = -Infinity;
      for (const cand of candidates) {
        let score = Math.hypot(cand.x - chaser.x, cand.y - chaser.y);
        for (const guard of state.guards) {
          if (coneCoversPoint(guard, cand.x, cand.y)) score -= 300;
        }
        score -= Math.hypot(cand.x - p.x, cand.y - p.y) * 0.3;
        // Never flee to where the courier already stands: reaching the spot
        // and stopping there lets the hunter close in and catch them against
        // the wall. Keep moving while the chase is on.
        if (Math.hypot(cand.x - p.x, cand.y - p.y) < 80) score -= 500;
        if (score > bestScore) {
          bestScore = score;
          flee = cand;
        }
      }
    }
  }

  // Seen, or about to be: dive for the nearest bush and sit still until the
  // watch calms down. A bush hides the courier completely. Run, don't sneak,
  // when a guard is actively chasing — sneaking is slower than the chase.
  // (Only when not chased: hiding from a guard that is already on top of the
  // courier just waits to be caught at point-blank range.)
  if (maxSuspicion > 0.25 && !chased && !mem.hiding) {
    mem.hiding = true;
    mem.hideSince = time;
  }
  if (mem.hiding) {
    // Leave the bush once nobody is looking at the courier and nobody is
    // right on top of it — or after a few seconds, since a guard that has
    // walked on has forgotten the courier by then.
    const guardNear = state.guards.some((guard) => Math.hypot(guard.x - p.x, guard.y - p.y) < 90);
    const watched = state.guards.some((guard) => coneCoversPoint(guard, p.x, p.y));
    if ((maxSuspicion < 0.08 && !chased && !guardNear && !watched) || time - mem.hideSince > 4) {
      mem.hiding = false;
    } else {
      const bush = nearestBush(state);
      if (bush && Math.hypot(bush.x - p.x, bush.y - p.y) < bush.r * 0.6) {
        return { x: 0, y: 0, sneak: true, pebble: false, interact: false };
      }
      if (bush) {
        const dx = bush.x - p.x;
        const dy = bush.y - p.y;
        const dist = Math.hypot(dx, dy);
        return { x: dx / dist, y: dy / dist, sneak: !chased, pebble: false, interact: false };
      }
    }
  }

  // Caught in the light and not hidden: back out of the cone at once,
  // away from the guard watching you, instead of pushing through it.
  for (const guard of state.guards) {
    if (guard.suspicion > 0.05 && inCone(state, guard) && !p.hidden) {
      const awayX = p.x - guard.x;
      const awayY = p.y - guard.y;
      const awayDist = Math.hypot(awayX, awayY) || 1;
      return { x: awayX / awayDist, y: awayY / awayDist, sneak: false, pebble: false, interact: false };
    }
  }

  let tx;
  let ty;
  let key;
  if (flee) {
    tx = flee.x;
    ty = flee.y;
    key = 'flee';
  } else if (!state.objectiveGot) {
    const main = state.letters.find((letter) => letter.main && !letter.taken);
    tx = main ? main.x : p.x;
    ty = main ? main.y : p.y;
    key = 'main';
  } else {
    tx = state.exit.x + state.exit.w / 2;
    ty = state.exit.y + state.exit.h / 2;
    key = 'exit';
  }

  mem.replanIn -= STEP;
  if (key !== mem.targetKey || mem.replanIn <= 0 || mem.pathIdx >= mem.path.length) {
    mem.path = computePath(state, tx, ty);
    mem.pathIdx = 0;
    mem.targetKey = key;
    mem.replanIn = 0.75;
  }
  while (mem.pathIdx < mem.path.length) {
    const node = mem.path[mem.pathIdx];
    if (Math.hypot(node.x - p.x, node.y - p.y) < 18) mem.pathIdx += 1;
    else break;
  }
  const node = mem.path[Math.min(mem.pathIdx, mem.path.length - 1)] ?? { x: tx, y: ty };
  let dx = node.x - p.x;
  let dy = node.y - p.y;
  const dist = Math.hypot(dx, dy);
  if (dist > 1) {
    dx /= dist;
    dy /= dist;
  }
  // Sneak only when the watch is calm and a guard could actually see the
  // courier — inside a cone or very close. When suspicion is already high,
  // run: sneaking is slower than a chasing guard. Fleeing is always a run.
  // The sneak radius (160) sits beyond a walking courier's hearing range
  // (135): sneaking only inside 130px walks the courier straight into a
  // guard's ears, and the noise pulls the whole watch down on them.
  const hot = flee !== null || maxSuspicion > 0.35 || state.guards.some((guard) => guard.state === 'alert');
  let sneak = false;
  if (!hot) {
    for (const guard of state.guards) {
      const dist = Math.hypot(guard.x - p.x, guard.y - p.y);
      if (inCone(state, guard) || dist < 160) {
        sneak = true;
        break;
      }
    }
  }
  // Patience: if a guard's cone covers the ground ahead, hold still and let
  // the patrol pass instead of walking into the light. Never wait while
  // fleeing — standing still is what gets the courier caught.
  const aheadX = p.x + dx * 90;
  const aheadY = p.y + dy * 90;
  for (const guard of state.guards) {
    if (!flee && Math.hypot(guard.x - p.x, guard.y - p.y) < 240 && coneCoversPoint(guard, aheadX, aheadY)) {
      return { x: 0, y: 0, sneak: true, pebble: false, interact: false };
    }
  }
  return { x: dx, y: dy, sneak, pebble: false, interact: false };
}

function runLevel(world, seconds, mem, withPebble) {
  let events = 0;
  let thrown = false;
  for (let t = 0; t < seconds; t += SAMPLE) {
    const input = autopilot(world.state, mem, t);
    // Throw the pebble the moment a guard closes in, so the distraction is
    // visible in the frame instead of landing in an empty courtyard.
    if (withPebble && !thrown) {
      for (const guard of world.state.guards) {
        if (Math.hypot(guard.x - world.state.player.x, guard.y - world.state.player.y) < 260) {
          input.pebble = true;
          thrown = true;
          break;
        }
      }
    }
    events |= world.step(SAMPLE, input, false);
    if (world.state.status !== 'play') break;
  }
  return events;
}

/**
 * Set `world` to the named scene (start, play, play2 or end; any other name is
 * start) and return the screen to draw over it and the best score to show.
 */
export function stageShot(name, world) {
  if (name === 'play') {
    world.reset(0);
    const mem = pilotMemory();
    runLevel(world, PLAY_SECONDS, mem, false);
    return { screen: world.state.status === 'over' ? SCREEN_OVER : SCREEN_PLAY, best: world.state.score };
  }
  if (name === 'play2') {
    world.reset(1);
    const mem = pilotMemory();
    runLevel(world, PLAY2_SECONDS, mem, true);
    // Stage the distraction moment: a pebble rings out near the courier and
    // the nearest guard turns to investigate it, "…" over its head.
    const p = world.state.player;
    if (!world.state.guards.some((guard) => guard.state === 'investigate')) {
      world.distractAt(p.x + 60, p.y + 120);
    }
    for (let t = 0; t < 1.5; t += SAMPLE) {
      world.step(SAMPLE, { x: 0, y: 0, sneak: true, pebble: false, interact: false }, false);
      if (world.state.status !== 'play') break;
    }
    return { screen: world.state.status === 'over' ? SCREEN_OVER : SCREEN_PLAY, best: world.state.score };
  }
  if (name === 'end') {
    world.reset(0);
    const mem = pilotMemory();
    let won = false;
    for (let t = 0; t < END_LIMIT_SECONDS; t += SAMPLE) {
      if (world.state.status === 'leveldone') {
        world.advance();
        continue;
      }
      if (world.state.status === 'win') {
        won = true;
        break;
      }
      if (world.state.status === 'over') break;
      const input = autopilot(world.state, mem, t);
      world.step(SAMPLE, input, false);
    }
    if (!won) world.completeAll();
    return { screen: SCREEN_VICTORY, best: world.state.score };
  }
  world.reset(0);
  for (let t = 0; t < START_SECONDS; t += SAMPLE) {
    world.step(SAMPLE, { x: 0, y: 0, sneak: false, pebble: false, interact: false }, true);
  }
  return { screen: SCREEN_TITLE, best: 0 };
}

export { EVENT_LEVEL, EVENT_WIN, SCREEN_LEVEL, autopilot, pilotMemory };
