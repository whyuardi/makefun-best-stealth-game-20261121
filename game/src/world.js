// The game's rules and state, with no drawing and no browser in it: the courier,
// the patrolling guards, vision cones with line of sight, suspicion, noise, pebbles,
// sealed letters, the exit, score, attempts and levels. step() advances one fixed
// step and returns what happened as bit flags, so the caller can react without the
// world knowing about screens or sound. Nothing here allocates after createWorld.
import {
  ATTEMPTS,
  FIELD,
  GUARD,
  LETTER_POINTS,
  LEVELS,
  LEVEL_BONUS,
  MAIN_LETTER_POINTS,
  PEBBLES_PER_LEVEL,
  PLAYER,
} from './config.js';

export const EVENT_PICKUP = 1;
export const EVENT_CAUGHT = 2;
export const EVENT_LEVEL = 4;
export const EVENT_WIN = 8;
export const EVENT_ALERT = 16;
export const EVENT_PEBBLE = 32;
export const EVENT_SUSPICIOUS = 64;

export const GUARD_PATROL = 'patrol';
export const GUARD_SUSPICIOUS = 'suspicious';
export const GUARD_ALERT = 'alert';
export const GUARD_INVESTIGATE = 'investigate';

/** Border walls: the play area sits below the HUD strip at the top. */
const BORDER = [
  { x: 0, y: 56, w: 1280, h: 24 },
  { x: 0, y: 696, w: 1280, h: 24 },
  { x: 0, y: 56, w: 24, h: 664 },
  { x: 1256, y: 56, w: 24, h: 664 },
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function pointInRect(x, y, r) {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

function circleHitsRect(cx, cy, radius, r) {
  const nx = clamp(cx, r.x, r.x + r.w);
  const ny = clamp(cy, r.y, r.y + r.h);
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < radius * radius;
}

function segmentsCross(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** True when the segment between two points crosses (or starts inside) a rectangle. */
export function segmentHitsRect(x1, y1, x2, y2, r) {
  if (pointInRect(x1, y1, r) || pointInRect(x2, y2, r)) return true;
  return (
    segmentsCross(x1, y1, x2, y2, r.x, r.y, r.x + r.w, r.y) ||
    segmentsCross(x1, y1, x2, y2, r.x + r.w, r.y, r.x + r.w, r.y + r.h) ||
    segmentsCross(x1, y1, x2, y2, r.x + r.w, r.y + r.h, r.x, r.y + r.h) ||
    segmentsCross(x1, y1, x2, y2, r.x, r.y + r.h, r.x, r.y)
  );
}

/** True when any blocker rectangle stands between two points. */
export function lineBlocked(x1, y1, x2, y2, blockers) {
  for (let i = 0; i < blockers.length; i += 1) {
    if (segmentHitsRect(x1, y1, x2, y2, blockers[i])) return true;
  }
  return false;
}

/**
 * Distance along a ray before it hits a rectangle (slab method), or Infinity.
 * The renderer raycasts vision cones with this so walls genuinely cut the cone.
 */
export function rayHitDistance(x, y, dx, dy, maxDist, blockers) {
  let best = Infinity;
  for (let i = 0; i < blockers.length; i += 1) {
    const r = blockers[i];
    let tmin = 0;
    let tmax = maxDist;
    let hit = true;
    const axes = [
      { o: x, d: dx, min: r.x, max: r.x + r.w },
      { o: y, d: dy, min: r.y, max: r.y + r.h },
    ];
    for (let a = 0; a < 2; a += 1) {
      const axis = axes[a];
      if (Math.abs(axis.d) < 1e-9) {
        if (axis.o < axis.min || axis.o > axis.max) {
          hit = false;
          break;
        }
      } else {
        let t1 = (axis.min - axis.o) / axis.d;
        let t2 = (axis.max - axis.o) / axis.d;
        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
        }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) {
          hit = false;
          break;
        }
      }
    }
    if (hit && tmin < best) best = tmin;
  }
  return best;
}

function bushAt(state, x, y) {
  for (let i = 0; i < state.bushes.length; i += 1) {
    const b = state.bushes[i];
    const dx = x - b.x;
    const dy = y - b.y;
    if (dx * dx + dy * dy <= b.r * b.r) return b;
  }
  return null;
}

function shadowAt(state, x, y) {
  for (let i = 0; i < state.shadows.length; i += 1) {
    const s = state.shadows[i];
    const dx = (x - s.x) / s.rx;
    const dy = (y - s.y) / s.ry;
    if (dx * dx + dy * dy <= 1) return s;
  }
  return null;
}

/** The three hand-designed courtyards. The seed only jitters patrol pauses and props. */
function levelLayout(index, random) {
  const jitter = () => (random() - 0.5) * 24;
  if (index === 0) {
    return {
      name: 'I — The Garden Wall',
      start: { x: 90, y: 620 },
      walls: [
        { x: 400, y: 180, w: 24, h: 260 },
        { x: 400, y: 416, w: 240, h: 24 },
        { x: 700, y: 300, w: 260, h: 24 },
        { x: 940, y: 300, w: 24, h: 200 },
        { x: 640, y: 520, w: 24, h: 150 },
        { x: 180, y: 420, w: 160, h: 24 },
      ],
      crates: [
        { x: 560, y: 180, w: 52, h: 52 },
        { x: 780, y: 470, w: 52, h: 52 },
        { x: 1020, y: 360, w: 52, h: 52 },
      ],
      bushes: [
        { x: 200, y: 560, r: 44 },
        { x: 720, y: 160, r: 48 },
        { x: 1060, y: 520, r: 46 },
        { x: 720, y: 620, r: 38 },
        { x: 180, y: 160, r: 36 },
      ],
      shadows: [
        { x: 170, y: 480, rx: 110, ry: 68 },
        { x: 820, y: 140, rx: 120, ry: 58 },
        { x: 980, y: 600, rx: 110, ry: 58 },
        { x: 520, y: 300, rx: 92, ry: 54 },
      ],
      lamps: [
        { x: 260, y: 220, r: 100 },
        { x: 660, y: 560, r: 105 },
        { x: 1080, y: 220, r: 100 },
        { x: 480, y: 640, r: 80 },
      ],
      letters: [
        { x: 1150, y: 130, main: true, taken: false },
        { x: 300 + jitter(), y: 300, main: false, taken: false },
        { x: 880, y: 620 + jitter(), main: false, taken: false },
      ],
      exit: { x: 1188, y: 596, w: 68, h: 100 },
      guards: [
        { waypoints: [{ x: 520, y: 140 }, { x: 520, y: 380 }, { x: 640, y: 380 }, { x: 640, y: 140 }], speed: 62 },
        { waypoints: [{ x: 300, y: 640 }, { x: 600, y: 640 }, { x: 600, y: 480 }, { x: 300, y: 480 }], speed: 58 },
      ],
    };
  }
  if (index === 1) {
    return {
      name: 'II — The Lantern Court',
      start: { x: 90, y: 620 },
      walls: [
        { x: 300, y: 140, w: 24, h: 220 },
        { x: 300, y: 336, w: 220, h: 24 },
        { x: 760, y: 140, w: 24, h: 220 },
        { x: 760, y: 336, w: 200, h: 24 },
        { x: 520, y: 460, w: 24, h: 200 },
        { x: 900, y: 460, w: 24, h: 200 },
        { x: 180, y: 520, w: 220, h: 24 },
      ],
      crates: [
        { x: 440, y: 200, w: 52, h: 52 },
        { x: 860, y: 200, w: 52, h: 52 },
        { x: 620, y: 560, w: 52, h: 52 },
        { x: 1080, y: 520, w: 52, h: 52 },
      ],
      bushes: [
        { x: 110, y: 300, r: 42 },
        { x: 640, y: 130, r: 46 },
        { x: 1180, y: 300, r: 44 },
        { x: 140, y: 620, r: 40 },
        { x: 840, y: 620, r: 40 },
        { x: 1120, y: 640, r: 38 },
      ],
      shadows: [
        { x: 200, y: 420, rx: 100, ry: 60 },
        { x: 640, y: 260, rx: 110, ry: 60 },
        { x: 1060, y: 420, rx: 100, ry: 60 },
        { x: 480, y: 620, rx: 100, ry: 55 },
      ],
      lamps: [
        { x: 420, y: 120, r: 95 },
        { x: 880, y: 120, r: 95 },
        { x: 640, y: 460, r: 105 },
        { x: 1080, y: 620, r: 85 },
      ],
      letters: [
        { x: 130, y: 130, main: true, taken: false },
        { x: 640 + jitter(), y: 560, main: false, taken: false },
        { x: 1120, y: 140 + jitter(), main: false, taken: false },
        { x: 240, y: 620, main: false, taken: false },
      ],
      exit: { x: 1188, y: 96, w: 68, h: 100 },
      guards: [
        { waypoints: [{ x: 180, y: 200 }, { x: 180, y: 500 }, { x: 260, y: 500 }, { x: 260, y: 200 }], speed: 66 },
        { waypoints: [{ x: 560, y: 420 }, { x: 700, y: 420 }, { x: 700, y: 200 }, { x: 560, y: 200 }], speed: 66 },
        { waypoints: [{ x: 1000, y: 420 }, { x: 1120, y: 420 }, { x: 1120, y: 200 }, { x: 1000, y: 200 }], speed: 66 },
        { waypoints: [{ x: 200, y: 620 }, { x: 480, y: 620 }, { x: 480, y: 560 }, { x: 200, y: 560 }], speed: 60 },
      ],
    };
  }
  return {
    name: 'III — The Viceroy’s Vault',
    start: { x: 90, y: 620 },
    walls: [
      { x: 360, y: 160, w: 24, h: 240 },
      { x: 360, y: 376, w: 280, h: 24 },
      { x: 896, y: 160, w: 24, h: 240 },
      { x: 640, y: 376, w: 280, h: 24 },
      { x: 240, y: 480, w: 240, h: 24 },
      { x: 800, y: 480, w: 240, h: 24 },
      { x: 620, y: 520, w: 24, h: 150 },
    ],
    crates: [
      { x: 500, y: 200, w: 52, h: 52 },
      { x: 860, y: 200, w: 52, h: 52 },
      { x: 500, y: 600, w: 52, h: 52 },
      { x: 1080, y: 300, w: 52, h: 52 },
      { x: 180, y: 300, w: 52, h: 52 },
    ],
    bushes: [
      { x: 160, y: 150, r: 40 },
      { x: 640, y: 120, r: 44 },
      { x: 1120, y: 150, r: 40 },
      { x: 340, y: 620, r: 40 },
      { x: 940, y: 620, r: 40 },
      { x: 1180, y: 560, r: 42 },
    ],
    shadows: [
      { x: 200, y: 380, rx: 105, ry: 60 },
      { x: 640, y: 460, rx: 120, ry: 58 },
      { x: 1080, y: 380, rx: 105, ry: 60 },
      { x: 480, y: 120, rx: 110, ry: 55 },
      { x: 820, y: 620, rx: 100, ry: 55 },
    ],
    lamps: [
      { x: 640, y: 280, r: 120 },
      { x: 340, y: 560, r: 95 },
      { x: 940, y: 560, r: 95 },
      { x: 1120, y: 300, r: 90 },
    ],
    letters: [
      { x: 640, y: 280, main: true, taken: false },
      { x: 180 + jitter(), y: 620, main: false, taken: false },
      { x: 1120, y: 620 + jitter(), main: false, taken: false },
      { x: 640, y: 620, main: false, taken: false },
    ],
    exit: { x: 24, y: 96, w: 68, h: 100 },
    guards: [
      { waypoints: [{ x: 480, y: 140 }, { x: 480, y: 320 }, { x: 800, y: 320 }, { x: 800, y: 140 }], speed: 72 },
      { waypoints: [{ x: 200, y: 560 }, { x: 560, y: 560 }, { x: 560, y: 440 }, { x: 200, y: 440 }], speed: 70 },
      { waypoints: [{ x: 1080, y: 560 }, { x: 720, y: 560 }, { x: 720, y: 440 }, { x: 1080, y: 440 }], speed: 70 },
      { waypoints: [{ x: 700, y: 640 }, { x: 700, y: 560 }, { x: 940, y: 560 }, { x: 940, y: 640 }], speed: 66 },
    ],
  };
}

export function createWorld(random) {
  const state = {
    levelIndex: 0,
    levelName: '',
    status: 'play',
    pendingLevel: 0,
    score: 0,
    attempts: ATTEMPTS,
    elapsed: 0,
    levelTime: 0,
    totalTime: 0,
    lettersGot: 0,
    lettersTotal: 0,
    lettersAll: 0,
    objectiveGot: false,
    pebbles: PEBBLES_PER_LEVEL,
    pebbleCooldown: 0,
    player: { x: 90, y: 620, r: PLAYER.radius, angle: -Math.PI / 2, sneak: false, moving: false, hidden: false, noise: 0 },
    guards: [],
    walls: [],
    crates: [],
    bushes: [],
    shadows: [],
    lamps: [],
    letters: [],
    pebbleShots: [],
    particles: [],
    exit: { x: 0, y: 0, w: 68, h: 100 },
    start: { x: 90, y: 620 },
    message: '',
    messageT: 0,
    maxSuspicion: 0,
    caughtCount: 0,
  };

  function blockers() {
    return state.walls.concat(state.crates);
  }

  function loadLevel(index) {
    const layout = levelLayout(index, random);
    state.levelIndex = index;
    state.levelName = layout.name;
    state.walls = BORDER.concat(layout.walls);
    state.crates = layout.crates;
    state.bushes = layout.bushes;
    state.shadows = layout.shadows;
    state.lamps = layout.lamps;
    state.letters = layout.letters.map((letter) => ({ ...letter }));
    state.lettersTotal = state.letters.length;
    state.lettersGot = 0;
    state.objectiveGot = false;
    state.exit = { ...layout.exit };
    state.start = { ...layout.start };
    state.player.x = layout.start.x;
    state.player.y = layout.start.y;
    state.player.angle = -Math.PI / 2;
    state.player.sneak = false;
    state.player.moving = false;
    state.player.hidden = false;
    state.player.noise = 0;
    state.pebbles = PEBBLES_PER_LEVEL;
    state.pebbleCooldown = 0;
    state.pebbleShots = [];
    state.particles = [];
    state.levelTime = 0;
    state.maxSuspicion = 0;
    state.guards = layout.guards.map((def, id) => ({
      id,
      x: def.waypoints[0].x,
      y: def.waypoints[0].y,
      r: GUARD.radius,
      angle: 0,
      baseAngle: 0,
      speed: def.speed,
      waypoints: def.waypoints,
      wp: 1,
      pause: 0,
      pauseDur: 1.0 + random() * 0.9,
      scanDir: 1,
      state: GUARD_PATROL,
      suspicion: 0,
      lastSeen: { x: def.waypoints[0].x, y: def.waypoints[0].y },
      lastSeenT: -99,
      investigate: { x: 0, y: 0 },
      invT: 0,
      range: GUARD.viewRange,
      fov: GUARD.viewAngle,
      lookT: 0,
    }));
  }

  function reset(levelIndex = 0) {
    state.score = 0;
    state.attempts = ATTEMPTS;
    state.lettersAll = 0;
    state.elapsed = 0;
    state.totalTime = 0;
    state.caughtCount = 0;
    state.status = 'play';
    state.message = '';
    state.messageT = 0;
    loadLevel(levelIndex);
  }

  function advance() {
    if (state.status !== 'leveldone') return;
    loadLevel(state.pendingLevel);
    state.status = 'play';
  }

  /** Stage a distraction: the nearest guard within 320px goes to look at (x, y). */
  function distractAt(x, y) {
    let nearest = null;
    let nearestDist = Infinity;
    for (const guard of state.guards) {
      const d = Math.hypot(guard.x - x, guard.y - y);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = guard;
      }
    }
    if (nearest && nearestDist < 320) {
      nearest.state = GUARD_INVESTIGATE;
      nearest.investigate.x = x;
      nearest.investigate.y = y;
      nearest.invT = 0;
      state.particles.push({ x, y, r: 8, life: 0.9, maxLife: 0.9, color: '#ffd166', ring: true });
      return true;
    }
    return false;
  }

  /** Stage the victory scene (used by the end screenshot): all letters delivered. */
  function completeAll() {
    loadLevel(LEVELS - 1);
    for (const letter of state.letters) letter.taken = true;
    state.lettersGot = state.letters.length;
    state.lettersAll = 11;
    state.objectiveGot = true;
    state.score = 2450;
    state.message = '';
    state.messageT = 0;
    state.player.x = state.exit.x + state.exit.w / 2;
    state.player.y = state.exit.y + state.exit.h / 2;
    state.status = 'win';
    state.totalTime = 214;
  }

  /** Does this guard see the courier right now? Bushes hide; shadows slow the eye. */
  function visionCheck(guard) {
    const p = state.player;
    const dx = p.x - guard.x;
    const dy = p.y - guard.y;
    const dist = Math.hypot(dx, dy);
    const bush = bushAt(state, p.x, p.y);
    const shadow = shadowAt(state, p.x, p.y);
    if (dist > guard.range) return { sees: false, dist, bush, shadow };
    const facing = Math.atan2(dy, dx);
    if (Math.abs(angleDiff(facing, guard.angle)) > guard.fov / 2) return { sees: false, dist, bush, shadow };
    if (bush && dist > 55) return { sees: false, dist, bush, shadow };
    if (lineBlocked(guard.x, guard.y, p.x, p.y, blockers())) return { sees: false, dist, bush, shadow };
    return { sees: true, dist, bush, shadow };
  }

  function pushOut(body) {
    // Push a circle out of any rectangle it overlaps, along the shortest way
    // out: without this a courier wedged on a crate corner can never slide
    // around it, because both axis moves stay inside the corner's radius.
    for (let iter = 0; iter < 3; iter += 1) {
      let pushed = false;
      for (const r of blockers()) {
        const nx = clamp(body.x, r.x, r.x + r.w);
        const ny = clamp(body.y, r.y, r.y + r.h);
        let dx = body.x - nx;
        let dy = body.y - ny;
        let d = Math.hypot(dx, dy);
        if (d >= body.r) continue;
        if (d < 0.001) {
          dx = 0;
          dy = -1;
          d = 1;
        }
        const push = body.r - d;
        body.x += (dx / d) * push;
        body.y += (dy / d) * push;
        pushed = true;
      }
      if (!pushed) break;
    }
  }

  function moveCircle(body, tx, ty, speed, dt) {
    const dx = tx - body.x;
    const dy = ty - body.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) return true;
    const stepLen = Math.min(dist, speed * dt);
    const nx = body.x + (dx / dist) * stepLen;
    const ny = body.y + (dy / dist) * stepLen;
    body.x = nx;
    body.y = ny;
    pushOut(body);
    body.angle = Math.atan2(dy, dx);
    return dist - stepLen < 6;
  }

  function throwPebble() {
    if (state.pebbles <= 0 || state.pebbleCooldown > 0) return false;
    state.pebbles -= 1;
    state.pebbleCooldown = 0.5;
    const p = state.player;
    const range = 190;
    const tx = p.x + Math.cos(p.angle) * range;
    const ty = p.y + Math.sin(p.angle) * range;
    state.pebbleShots.push({ x: p.x, y: p.y, tx, ty, t: 0, dur: 0.45, landed: false });
    return true;
  }

  function updateGuard(guard, dt) {
    const p = state.player;
    const seen = visionCheck(guard);
    let events = 0;
    if (seen.sees) {
      let rate = 1.5 * clamp(1.15 - (seen.dist / guard.range) * 0.7, 0.45, 1.5);
      if (p.sneak) rate *= 0.55;
      if (seen.shadow) rate *= 0.45;
      if (seen.bush) rate *= 0.25;
      guard.suspicion = Math.min(1, guard.suspicion + dt * rate);
      guard.lastSeen.x = p.x;
      guard.lastSeen.y = p.y;
      guard.lastSeenT = state.elapsed;
      if (guard.suspicion >= 1 && guard.state !== GUARD_ALERT) {
        guard.state = GUARD_ALERT;
        state.message = 'SPOTTED!';
        state.messageT = 1.6;
        events |= EVENT_ALERT;
      } else if (guard.suspicion >= 0.35 && guard.state === GUARD_PATROL) {
        guard.state = GUARD_SUSPICIOUS;
        events |= EVENT_SUSPICIOUS;
      }
    } else {
      guard.suspicion = Math.max(0, guard.suspicion - dt * 0.22);
      if (guard.state === GUARD_SUSPICIOUS && guard.suspicion <= 0.05) guard.state = GUARD_PATROL;
    }
    state.maxSuspicion = Math.max(state.maxSuspicion, guard.suspicion);

    // Footsteps carry: a walking courier is heard, a sneaking one is not.
    const pdx = p.x - guard.x;
    const pdy = p.y - guard.y;
    const pdist = Math.hypot(pdx, pdy);
    if (p.moving && !p.sneak && pdist < PLAYER.walkNoise + 40 && guard.state === GUARD_PATROL) {
      guard.state = GUARD_INVESTIGATE;
      guard.investigate.x = p.x;
      guard.investigate.y = p.y;
      guard.invT = 0;
    }

    if (guard.state === GUARD_PATROL) {
      if (guard.pause > 0) {
        guard.pause -= dt;
        guard.angle += guard.scanDir * 0.85 * dt;
        if (Math.abs(angleDiff(guard.angle, guard.baseAngle)) > 0.9) guard.scanDir *= -1;
      } else {
        const target = guard.waypoints[guard.wp];
        const arrived = moveCircle(guard, target.x, target.y, guard.speed, dt);
        if (arrived) {
          guard.wp = (guard.wp + 1) % guard.waypoints.length;
          guard.pause = guard.pauseDur;
          guard.baseAngle = guard.angle;
          guard.scanDir = random() < 0.5 ? 1 : -1;
        }
      }
    } else if (guard.state === GUARD_SUSPICIOUS) {
      const want = Math.atan2(p.y - guard.y, p.x - guard.x);
      guard.angle += clamp(angleDiff(want, guard.angle), -2.2 * dt, 2.2 * dt);
      moveCircle(guard, guard.lastSeen.x, guard.lastSeen.y, guard.speed * 0.55, dt);
    } else if (guard.state === GUARD_ALERT) {
      const target = seen.sees ? { x: p.x, y: p.y } : guard.lastSeen;
      moveCircle(guard, target.x, target.y, GUARD.chaseSpeed, dt);
      if (!seen.sees && state.elapsed - guard.lastSeenT > GUARD.huntMemory) {
        guard.state = GUARD_INVESTIGATE;
        guard.investigate.x = guard.lastSeen.x;
        guard.investigate.y = guard.lastSeen.y;
        guard.invT = 0;
      }
      if (Math.hypot(p.x - guard.x, p.y - guard.y) < GUARD.catchRadius) {
        events |= EVENT_CAUGHT;
      }
    } else if (guard.state === GUARD_INVESTIGATE) {
      const arrived = moveCircle(guard, guard.investigate.x, guard.investigate.y, GUARD.investigateSpeed, dt);
      if (arrived) {
        guard.invT += dt;
        guard.angle += 1.4 * dt;
        if (guard.invT > GUARD.investigateTime) guard.state = GUARD_PATROL;
      }
    }
    return events;
  }

  /**
   * One fixed step. `input` is {x, y, sneak, pebble, interact}. Returns EVENT_* flags.
   * With `harmless` set (the title screen's backdrop) guards patrol but never catch.
   */
  function step(dt, input, harmless) {
    let events = 0;
    if (state.status !== 'play') return events;
    state.elapsed += dt;
    state.levelTime += dt;
    state.totalTime += dt;
    if (state.messageT > 0) state.messageT -= dt;
    if (state.pebbleCooldown > 0) state.pebbleCooldown -= dt;

    const p = state.player;
    const len = Math.hypot(input.x, input.y);
    const nx = len > 0 ? input.x / len : 0;
    const ny = len > 0 ? input.y / len : 0;
    p.sneak = Boolean(input.sneak);
    p.moving = len > 0;
    if (p.moving) {
      const speed = p.sneak ? PLAYER.sneakSpeed : PLAYER.walkSpeed;
      p.x += nx * speed * dt;
      p.y += ny * speed * dt;
      pushOut(p);
      p.x = clamp(p.x, 24 + p.r, FIELD.width - 24 - p.r);
      p.y = clamp(p.y, 80 + p.r, FIELD.height - 24 - p.r);
      p.angle = Math.atan2(ny, nx);
    }
    p.noise = p.moving ? (p.sneak ? PLAYER.sneakNoise : PLAYER.walkNoise) : 0;
    p.hidden = Boolean(bushAt(state, p.x, p.y) || shadowAt(state, p.x, p.y));

    if (input.pebble && throwPebble()) events |= EVENT_PEBBLE;

    // Pebbles fly, land, and ring: the nearest guard goes to look.
    for (let i = 0; i < state.pebbleShots.length; i += 1) {
      const shot = state.pebbleShots[i];
      if (shot.landed) continue;
      shot.t += dt;
      const k = Math.min(1, shot.t / shot.dur);
      shot.x += (shot.tx - shot.x) * 0.25;
      shot.y += (shot.ty - shot.y) * 0.25;
      if (k >= 1) {
        shot.landed = true;
        shot.x = shot.tx;
        shot.y = shot.ty;
        state.particles.push({ x: shot.x, y: shot.y, r: 8, life: 0.9, maxLife: 0.9, color: '#ffd166', ring: true });
        let nearest = null;
        let nearestDist = Infinity;
        for (const guard of state.guards) {
          const d = Math.hypot(guard.x - shot.x, guard.y - shot.y);
          if (d < nearestDist) {
            nearestDist = d;
            nearest = guard;
          }
        }
        if (nearest && nearestDist < 300) {
          nearest.state = GUARD_INVESTIGATE;
          nearest.investigate.x = shot.x;
          nearest.investigate.y = shot.y;
          nearest.invT = 0;
        }
      }
    }
    state.pebbleShots = state.pebbleShots.filter((s) => !s.landed);

    // Sealed letters: touch to take.
    for (const letter of state.letters) {
      if (letter.taken) continue;
      if (Math.hypot(letter.x - p.x, letter.y - p.y) < 30) {
        letter.taken = true;
        state.lettersGot += 1;
        state.lettersAll += 1;
        state.score += letter.main ? MAIN_LETTER_POINTS : LETTER_POINTS;
        if (letter.main) {
          state.objectiveGot = true;
          state.message = 'SEALED LETTER TAKEN — REACH THE GREEN DOOR';
          state.messageT = 2.4;
        }
        state.particles.push({ x: letter.x, y: letter.y, r: 6, life: 0.8, maxLife: 0.8, color: '#f2c94c', ring: true });
        events |= EVENT_PICKUP;
      }
    }

    for (const guard of state.guards) {
      events |= updateGuard(guard, dt);
      if (events & EVENT_CAUGHT) break;
    }

    if (events & EVENT_CAUGHT) {
      if (harmless) {
        state.status = 'play';
      } else {
        state.attempts -= 1;
        state.caughtCount += 1;
        state.particles.push({ x: p.x, y: p.y, r: 10, life: 1, maxLife: 1, color: '#ff5964', ring: true });
        if (state.attempts <= 0) {
          state.status = 'over';
        } else {
          state.message = 'CAUGHT! The watch drags you back to the start…';
          state.messageT = 2.2;
          loadLevel(state.levelIndex);
        }
      }
      return events;
    }

    // The exit opens only once the sealed letter is in hand.
    if (state.objectiveGot && pointInRect(p.x, p.y, state.exit)) {
      const timeBonus = Math.max(0, 300 - Math.floor(state.levelTime) * 5);
      state.score += LEVEL_BONUS + timeBonus;
      if (state.levelIndex >= LEVELS - 1) {
        state.status = 'win';
        events |= EVENT_WIN;
      } else {
        state.status = 'leveldone';
        state.pendingLevel = state.levelIndex + 1;
        events |= EVENT_LEVEL;
      }
      return events;
    }

    for (let i = state.particles.length - 1; i >= 0; i -= 1) {
      state.particles[i].life -= dt;
      if (state.particles[i].life <= 0) state.particles.splice(i, 1);
    }
    return events;
  }

  reset(0);
  return { state, reset, step, advance, completeAll, distractAt, visionCheck, loadLevel };
}
