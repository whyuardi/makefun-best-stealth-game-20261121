// Boot and the one loop: input is read every frame, the world advances in fixed
// 1/60 s steps (several in a slow frame, none in a fast one), and the renderer
// paints what is there. The game moves between six screens: title, play, paused,
// level clear, game over and victory.
//
// ?seed=N fixes the patrols and props. ?shot=start|play|play2|end (with &seed=N)
// stages that scene instead of running the loop, paints it twice and sets
// window.__shotReady for a screenshot.
import { BEST_KEY, STEP } from './config.js';
import { createRandom } from './random.js';
import { createWorld, EVENT_ALERT, EVENT_CAUGHT, EVENT_LEVEL, EVENT_PEBBLE, EVENT_PICKUP, EVENT_SUSPICIOUS, EVENT_WIN } from './world.js';
import { ACTION_CONFIRM, ACTION_PAUSE, ACTION_PEBBLE, createInput } from './input.js';
import { createAudio } from './audio.js';
import { createRenderer, SCREEN_LEVEL, SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE, SCREEN_VICTORY } from './render.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped, not replayed. */
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const world = createWorld(createRandom(seed));
const renderer = createRenderer(canvas);
const audio = createAudio();

function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage can be off (private windows): the best score then lasts this visit only.
  }
}

function runShot(name) {
  const scene = stageShot(name, world);
  let painted = 0;
  function paint() {
    renderer.draw(world.state, scene.screen, scene.best);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let screen = SCREEN_TITLE;
  let best = readBest();
  let accumulator = 0;
  let last = performance.now();
  let lastX = world.state.player.x;
  let lastY = world.state.player.y;
  let stepDistance = 0;

  // Screen readers (and anyone watching the page's text) hear the screen changes and each catch.
  function announce(message) {
    status.textContent = message;
  }

  function startGame() {
    world.reset();
    accumulator = 0;
    lastX = world.state.player.x;
    lastY = world.state.player.y;
    stepDistance = 0;
    screen = SCREEN_PLAY;
    announce('Playing. Three attempts. Steal the sealed letter, then reach the green door.');
  }

  function endGame() {
    screen = SCREEN_OVER;
    if (world.state.score > best) {
      best = world.state.score;
      saveBest(best);
    }
    announce(`Caught. Score ${world.state.score}. Best ${best}.`);
  }

  function winGame() {
    screen = SCREEN_VICTORY;
    if (world.state.score > best) {
      best = world.state.score;
      saveBest(best);
    }
    announce(`All three letters delivered. Score ${world.state.score}. Best ${best}.`);
  }

  function handleActions() {
    const actions = input.takeActions();
    if (actions & ACTION_CONFIRM) {
      if (screen === SCREEN_TITLE || screen === SCREEN_OVER || screen === SCREEN_VICTORY) {
        audio.click();
        startGame();
      } else if (screen === SCREEN_LEVEL) {
        audio.click();
        world.advance();
        screen = SCREEN_PLAY;
        announce(`Level ${world.state.levelIndex + 1}. ${world.state.levelName}.`);
      } else if (screen === SCREEN_PAUSED) {
        screen = SCREEN_PLAY;
        announce('Playing.');
      }
    } else if (actions & ACTION_PAUSE) {
      if (screen === SCREEN_PLAY) {
        screen = SCREEN_PAUSED;
        announce('Paused.');
      } else if (screen === SCREEN_PAUSED) {
        screen = SCREEN_PLAY;
        announce('Playing.');
      }
    }
    return actions;
  }

  function stepGame(actions) {
    const vector = input.vector();
    const events = world.step(STEP, {
      x: vector.x,
      y: vector.y,
      sneak: vector.sneak,
      pebble: Boolean(actions & ACTION_PEBBLE),
      interact: false,
    }, false);
    const player = world.state.player;
    stepDistance += Math.hypot(player.x - lastX, player.y - lastY);
    lastX = player.x;
    lastY = player.y;
    if (stepDistance > 34) {
      stepDistance = 0;
      if (player.moving) audio.step(player.sneak);
    }
    if (events & EVENT_PICKUP) audio.pickup();
    if (events & EVENT_ALERT) audio.alert();
    else if (events & EVENT_SUSPICIOUS) audio.suspicious();
    if (events & EVENT_PEBBLE) audio.pebble();
    if (events & EVENT_CAUGHT) {
      audio.caught();
      if (world.state.status === 'over') endGame();
      else announce(`Caught! ${world.state.attempts} attempts left.`);
    }
    if (events & EVENT_WIN) {
      audio.success();
      winGame();
    } else if (events & EVENT_LEVEL) {
      audio.success();
      screen = SCREEN_LEVEL;
      announce(`${world.state.levelName} clear. Score ${world.state.score}.`);
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    const actions = handleActions();
    if (screen === SCREEN_TITLE) {
      while (accumulator >= STEP) {
        world.step(STEP, { x: 0, y: 0, sneak: false, pebble: false, interact: false }, true);
        accumulator -= STEP;
      }
    } else if (screen === SCREEN_PLAY) {
      while (accumulator >= STEP && screen === SCREEN_PLAY) {
        stepGame(actions);
        accumulator -= STEP;
      }
      if (screen !== SCREEN_PLAY) accumulator = 0;
    } else {
      accumulator = 0;
    }
    renderer.draw(world.state, screen, best);
  }

  // Leaving the tab pauses a running game rather than letting guards hunt unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    }
  });

  announce('Lamplight, the Courier’s Run. Press Space or click to start.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
