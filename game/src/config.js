// LAMPLIGHT — The Courier's Run: every tuning number and colour in one place.
// The playfield is a fixed 1280x720 logical area; the renderer scales it to the
// window, so no rule below depends on the screen size.

export const FIELD = { width: 1280, height: 720 };

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

export const PLAYER = {
  radius: 13,
  walkSpeed: 168,
  sneakSpeed: 88,
  /** Noise radius while walking; sneaking is nearly silent. */
  walkNoise: 95,
  sneakNoise: 22,
};

export const GUARD = {
  radius: 14,
  patrolSpeed: 62,
  chaseSpeed: 148,
  investigateSpeed: 96,
  /** How far a guard can see, in pixels. */
  viewRange: 215,
  /** Full vision-cone angle, in radians. */
  viewAngle: 1.15,
  catchRadius: 24,
  /** Seconds a guard keeps hunting after losing sight before giving up. */
  huntMemory: 3.0,
  /** Seconds a guard studies a pebble landing spot. */
  investigateTime: 2.6,
};

export const LEVELS = 3;
export const ATTEMPTS = 3;
export const PEBBLES_PER_LEVEL = 3;
export const LETTER_POINTS = 100;
export const MAIN_LETTER_POINTS = 250;
export const LEVEL_BONUS = 400;

/** Where the best score is kept between visits (this browser only). */
export const BEST_KEY = 'lamplight.best';

export const PALETTE = {
  backdrop: '#0a0d16',
  floorA: '#232838',
  floorB: '#202434',
  floorLine: '#2c3247',
  carpet: '#3d232b',
  carpetEdge: '#54303a',
  wall: '#3a4157',
  wallTop: '#565f7d',
  wallShadow: '#12141d',
  bush: '#1f4d2e',
  bushLight: '#2f6b3f',
  bushDark: '#143522',
  shadowZone: '#0d1020',
  lampGlow: '#ffd27a',
  crate: '#6b4a2a',
  crateEdge: '#8a6136',
  letter: '#f4ead2',
  letterGold: '#f2c94c',
  exit: '#39d98a',
  exitLocked: '#8b93a3',
  player: '#2ec4b6',
  playerDark: '#1d7f78',
  scarf: '#e63946',
  guard: '#3d5a80',
  guardDark: '#293f5c',
  guardCap: '#1c2b44',
  cone: '#ffd166',
  coneAlert: '#ff5964',
  coneSuspicious: '#ff9f1c',
  hud: '#10131f',
  hudEdge: '#2a3049',
  text: '#eef1f5',
  muted: '#9aa3b8',
  gold: '#f2c94c',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
