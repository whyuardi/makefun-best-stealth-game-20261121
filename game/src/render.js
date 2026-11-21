// Drawing only: the world's state and the current screen in, pixels out. The
// 1280x720 playfield is scaled to fit the window and centred, the margin filled
// with the backdrop colour. Canvas shapes and gradients only — no images, no
// fonts loaded over the network — so the game is fully self-contained.
import { FIELD, FONT, PALETTE } from './config.js';
import { GUARD_ALERT, GUARD_INVESTIGATE, GUARD_SUSPICIOUS, rayHitDistance } from './world.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_LEVEL = 'level';
export const SCREEN_OVER = 'over';
export const SCREEN_VICTORY = 'victory';

const PANEL = { width: 640, top: 150, line: 32, bottom: 76 };
const TILE = 40;

function hashTile(i, j) {
  let h = (i * 374761393 + j * 668265263) | 0;
  h = (h ^ (h >> 13)) | 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

export function createRenderer(canvas) {
  const context = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0 };
  const fonts = new Map();

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(window.innerWidth * ratio);
    const height = Math.round(window.innerHeight * ratio);
    canvas.width = width;
    canvas.height = height;
    view.scale = Math.min(width / FIELD.width, height / FIELD.height);
    view.x = (width - FIELD.width * view.scale) / 2;
    view.y = (height - FIELD.height * view.scale) / 2;
  }

  function text(value, x, y, size, color, align, baseline) {
    if (!fonts.has(size)) fonts.set(size, `600 ${size}px ${FONT}`);
    context.font = fonts.get(size);
    context.fillStyle = color;
    context.textAlign = align ?? 'left';
    context.textBaseline = baseline ?? 'alphabetic';
    context.fillText(value, x, y);
  }

  function circle(x, y, r, color) {
    context.fillStyle = color;
    context.beginPath();
    context.arc(x, y, r, 0, Math.PI * 2);
    context.fill();
  }

  function drawFloor(state) {
    for (let j = 0; j < FIELD.height / TILE; j += 1) {
      for (let i = 0; i < FIELD.width / TILE; i += 1) {
        const x = i * TILE;
        const y = j * TILE;
        context.fillStyle = (i + j) % 2 === 0 ? PALETTE.floorA : PALETTE.floorB;
        context.fillRect(x, y, TILE, TILE);
        const h = hashTile(i, j);
        if (h < 0.07) {
          context.fillStyle = 'rgba(255,255,255,0.05)';
          context.fillRect(x + 8 + h * 200, y + 10 + h * 120, 5, 3);
        }
      }
    }
    context.strokeStyle = PALETTE.floorLine;
    context.lineWidth = 1;
    context.globalAlpha = 0.5;
    for (let x = 0; x <= FIELD.width; x += TILE) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, FIELD.height);
      context.stroke();
    }
    for (let y = 0; y <= FIELD.height; y += TILE) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(FIELD.width, y);
      context.stroke();
    }
    context.globalAlpha = 1;
    // A worn carpet runner down the middle of each courtyard.
    context.fillStyle = PALETTE.carpet;
    context.fillRect(596, 56, 88, 640);
    context.fillStyle = PALETTE.carpetEdge;
    context.fillRect(596, 56, 4, 640);
    context.fillRect(680, 56, 4, 640);
  }

  function drawShadowZones(state) {
    for (const s of state.shadows) {
      const g = context.createRadialGradient(s.x, s.y, 4, s.x, s.y, Math.max(s.rx, s.ry));
      g.addColorStop(0, 'rgba(6,8,20,0.62)');
      g.addColorStop(0.8, 'rgba(6,8,20,0.45)');
      g.addColorStop(1, 'rgba(6,8,20,0)');
      context.fillStyle = g;
      context.beginPath();
      context.ellipse(s.x, s.y, s.rx, s.ry, 0, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = 'rgba(120,140,200,0.25)';
      context.lineWidth = 1.5;
      context.setLineDash([6, 6]);
      context.beginPath();
      context.ellipse(s.x, s.y, s.rx, s.ry, 0, 0, Math.PI * 2);
      context.stroke();
      context.setLineDash([]);
      text('SHADOW', s.x, s.y - s.ry + 16, 11, 'rgba(150,170,220,0.55)', 'center');
    }
  }

  function drawLamps(state) {
    context.globalCompositeOperation = 'lighter';
    for (const lamp of state.lamps) {
      const g = context.createRadialGradient(lamp.x, lamp.y, 6, lamp.x, lamp.y, lamp.r);
      g.addColorStop(0, 'rgba(255,210,122,0.30)');
      g.addColorStop(0.6, 'rgba(255,190,90,0.12)');
      g.addColorStop(1, 'rgba(255,190,90,0)');
      context.fillStyle = g;
      context.beginPath();
      context.arc(lamp.x, lamp.y, lamp.r, 0, Math.PI * 2);
      context.fill();
    }
    context.globalCompositeOperation = 'source-over';
    for (const lamp of state.lamps) {
      circle(lamp.x, lamp.y, 7, '#3a2f18');
      circle(lamp.x, lamp.y, 5, PALETTE.lampGlow);
      circle(lamp.x, lamp.y, 2.5, '#fff6d8');
    }
  }

  function drawBushes(state) {
    for (const b of state.bushes) {
      circle(b.x + 3, b.y + 4, b.r, 'rgba(0,0,0,0.35)');
      circle(b.x, b.y, b.r, PALETTE.bushDark);
      circle(b.x - b.r * 0.35, b.y - b.r * 0.2, b.r * 0.55, PALETTE.bush);
      circle(b.x + b.r * 0.3, b.y + b.r * 0.25, b.r * 0.5, PALETTE.bushLight);
      circle(b.x + b.r * 0.1, b.y - b.r * 0.35, b.r * 0.42, PALETTE.bush);
      context.strokeStyle = 'rgba(180,255,190,0.18)';
      context.lineWidth = 1.5;
      context.beginPath();
      context.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      context.stroke();
    }
  }

  function drawCrates(state) {
    for (const c of state.crates) {
      context.fillStyle = 'rgba(0,0,0,0.4)';
      context.fillRect(c.x + 4, c.y + 5, c.w, c.h);
      context.fillStyle = PALETTE.crate;
      context.fillRect(c.x, c.y, c.w, c.h);
      context.strokeStyle = PALETTE.crateEdge;
      context.lineWidth = 3;
      context.strokeRect(c.x + 2, c.y + 2, c.w - 4, c.h - 4);
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(c.x, c.y);
      context.lineTo(c.x + c.w, c.y + c.h);
      context.moveTo(c.x + c.w, c.y);
      context.lineTo(c.x, c.y + c.h);
      context.stroke();
    }
  }

  function drawWalls(state) {
    for (const w of state.walls) {
      context.fillStyle = PALETTE.wallShadow;
      context.fillRect(w.x + 5, w.y + 7, w.w, w.h);
      context.fillStyle = PALETTE.wall;
      context.fillRect(w.x, w.y, w.w, w.h);
      context.fillStyle = PALETTE.wallTop;
      context.fillRect(w.x, w.y, w.w, 4);
      context.fillRect(w.x, w.y, 4, w.h);
      context.strokeStyle = 'rgba(0,0,0,0.35)';
      context.lineWidth = 1;
      context.strokeRect(w.x + 0.5, w.y + 0.5, w.w - 1, w.h - 1);
    }
  }

  function drawCone(guard, blockers) {
    const rays = 18;
    const points = [];
    for (let i = 0; i <= rays; i += 1) {
      const a = guard.angle - guard.fov / 2 + (guard.fov * i) / rays;
      const d = Math.min(guard.range, rayHitDistance(guard.x, guard.y, Math.cos(a), Math.sin(a), guard.range, blockers));
      points.push([guard.x + Math.cos(a) * d, guard.y + Math.sin(a) * d]);
    }
    const base =
      guard.state === GUARD_ALERT ? '255,89,100' : guard.state === GUARD_SUSPICIOUS ? '255,159,28' : '255,209,102';
    const g = context.createRadialGradient(guard.x, guard.y, 8, guard.x, guard.y, guard.range);
    g.addColorStop(0, `rgba(${base},0.48)`);
    g.addColorStop(0.7, `rgba(${base},0.24)`);
    g.addColorStop(1, `rgba(${base},0)`);
    context.fillStyle = g;
    context.beginPath();
    context.moveTo(guard.x, guard.y);
    for (const [x, y] of points) context.lineTo(x, y);
    context.closePath();
    context.fill();
    context.strokeStyle = `rgba(${base},0.55)`;
    context.lineWidth = 2;
    context.stroke();
  }

  function drawLetters(state) {
    for (const letter of state.letters) {
      if (letter.taken) continue;
      if (letter.main) {
        const pulse = 0.5 + 0.3 * Math.sin(state.elapsed * 4);
        const g = context.createRadialGradient(letter.x, letter.y, 2, letter.x, letter.y, 34);
        g.addColorStop(0, `rgba(242,201,76,${0.45 * pulse})`);
        g.addColorStop(1, 'rgba(242,201,76,0)');
        context.fillStyle = g;
        context.beginPath();
        context.arc(letter.x, letter.y, 34, 0, Math.PI * 2);
        context.fill();
      }
      context.save();
      context.translate(letter.x, letter.y);
      context.rotate(letter.main ? -0.12 : 0.1);
      context.fillStyle = 'rgba(0,0,0,0.4)';
      context.fillRect(-10, -6, 24, 18);
      context.fillStyle = letter.main ? PALETTE.letterGold : PALETTE.letter;
      context.fillRect(-12, -9, 24, 18);
      context.strokeStyle = '#8a7a4a';
      context.lineWidth = 1.5;
      context.strokeRect(-12, -9, 24, 18);
      context.beginPath();
      context.moveTo(-12, -9);
      context.lineTo(0, 1);
      context.lineTo(12, -9);
      context.stroke();
      context.restore();
      if (letter.main) text('★', letter.x, letter.y - 20, 15, PALETTE.letterGold, 'center');
    }
  }

  function drawExit(state) {
    const e = state.exit;
    const open = state.objectiveGot;
    const glow = context.createRadialGradient(e.x + e.w / 2, e.y + e.h / 2, 4, e.x + e.w / 2, e.y + e.h / 2, 70);
    glow.addColorStop(0, open ? 'rgba(57,217,138,0.5)' : 'rgba(139,147,163,0.25)');
    glow.addColorStop(1, 'rgba(57,217,138,0)');
    context.fillStyle = glow;
    context.fillRect(e.x - 30, e.y - 30, e.w + 60, e.h + 60);
    context.fillStyle = 'rgba(0,0,0,0.45)';
    context.fillRect(e.x + 3, e.y + 4, e.w, e.h);
    context.fillStyle = open ? '#1d7a4c' : '#3a4157';
    context.fillRect(e.x, e.y, e.w, e.h);
    context.strokeStyle = open ? PALETTE.exit : PALETTE.exitLocked;
    context.lineWidth = 3;
    context.strokeRect(e.x, e.y, e.w, e.h);
    context.beginPath();
    context.moveTo(e.x + e.w / 2, e.y);
    context.lineTo(e.x + e.w / 2, e.y + e.h);
    context.stroke();
    if (!open) {
      circle(e.x + e.w / 2, e.y + e.h / 2, 9, PALETTE.letterGold);
      context.fillStyle = '#3a2f18';
      context.fillRect(e.x + e.w / 2 - 2, e.y + e.h / 2 - 1, 4, 8);
    }
    text('EXIT', e.x + e.w / 2, e.y - 10, 15, open ? PALETTE.exit : PALETTE.muted, 'center');
    if (open) {
      const bob = Math.sin(state.elapsed * 3) * 4;
      text('▼', e.x + e.w / 2, e.y - 28 + bob, 16, PALETTE.exit, 'center');
    }
  }

  function drawGuards(state) {
    const blockers = state.walls.concat(state.crates);
    for (const guard of state.guards) drawCone(guard, blockers);
    for (const guard of state.guards) {
      context.fillStyle = 'rgba(0,0,0,0.4)';
      context.beginPath();
      context.ellipse(guard.x + 3, guard.y + 4, 15, 11, 0, 0, Math.PI * 2);
      context.fill();
      circle(guard.x, guard.y, 14, PALETTE.guardDark);
      circle(guard.x, guard.y, 12, PALETTE.guard);
      // Cap and facing nose.
      context.fillStyle = PALETTE.guardCap;
      context.beginPath();
      context.arc(guard.x, guard.y, 12, guard.angle - 1.9, guard.angle - 1.25);
      context.lineTo(guard.x, guard.y);
      context.fill();
      context.strokeStyle = '#dbe4f0';
      context.lineWidth = 2.5;
      context.beginPath();
      context.moveTo(guard.x + Math.cos(guard.angle) * 6, guard.y + Math.sin(guard.angle) * 6);
      context.lineTo(guard.x + Math.cos(guard.angle) * 17, guard.y + Math.sin(guard.angle) * 17);
      context.stroke();
      // Eyes: two dots perpendicular to the facing.
      const px = Math.cos(guard.angle + Math.PI / 2);
      const py = Math.sin(guard.angle + Math.PI / 2);
      circle(guard.x + Math.cos(guard.angle) * 5 + px * 4.5, guard.y + Math.sin(guard.angle) * 5 + py * 4.5, 1.8, '#fff');
      circle(guard.x + Math.cos(guard.angle) * 5 - px * 4.5, guard.y + Math.sin(guard.angle) * 5 - py * 4.5, 1.8, '#fff');
      // State bubble: ! when chasing, ? when suspicious, … when investigating.
      let mark = '';
      let markColor = '';
      if (guard.state === GUARD_ALERT) {
        mark = '!';
        markColor = '#ff5964';
      } else if (guard.state === GUARD_SUSPICIOUS) {
        mark = '?';
        markColor = '#ff9f1c';
      } else if (guard.state === GUARD_INVESTIGATE) {
        mark = '…';
        markColor = '#ffd166';
      }
      // Bigger bubble and glyph than before: the old 11px bubble hid the
      // ellipsis entirely at full-screen scale.
      if (mark) {
        circle(guard.x, guard.y - 28, 13, 'rgba(10,12,20,0.85)');
        context.strokeStyle = markColor;
        context.lineWidth = 1.5;
        context.beginPath();
        context.arc(guard.x, guard.y - 28, 13, 0, Math.PI * 2);
        context.stroke();
        text(mark, guard.x, guard.y - 21, 17, markColor, 'center');
      }
      // Suspicion arc under a guard that is starting to notice.
      if (guard.suspicion > 0.05 && guard.state !== GUARD_ALERT) {
        context.strokeStyle = guard.suspicion > 0.6 ? '#ff5964' : '#ff9f1c';
        context.lineWidth = 3;
        context.beginPath();
        context.arc(guard.x, guard.y, 19, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * guard.suspicion);
        context.stroke();
      }
    }
  }

  function drawPlayer(state) {
    const p = state.player;
    if (p.moving && p.noise > 0) {
      const pulse = 0.55 + 0.45 * Math.sin(state.elapsed * 5);
      context.strokeStyle = p.sneak ? 'rgba(46,196,182,0.25)' : `rgba(255,209,102,${0.35 * pulse})`;
      context.lineWidth = 1.5;
      context.setLineDash([4, 6]);
      context.beginPath();
      context.arc(p.x, p.y, p.noise, 0, Math.PI * 2);
      context.stroke();
      context.setLineDash([]);
    }
    context.fillStyle = 'rgba(0,0,0,0.45)';
    context.beginPath();
    context.ellipse(p.x + 3, p.y + 4, 14, 10, 0, 0, Math.PI * 2);
    context.fill();
    // A soft teal glow so the courier always reads against the dark floor.
    const glow = context.createRadialGradient(p.x, p.y, 2, p.x, p.y, 26);
    glow.addColorStop(0, 'rgba(46,196,182,0.28)');
    glow.addColorStop(1, 'rgba(46,196,182,0)');
    context.fillStyle = glow;
    context.beginPath();
    context.arc(p.x, p.y, 26, 0, Math.PI * 2);
    context.fill();
    if (p.sneak) {
      context.fillStyle = PALETTE.playerDark;
      context.beginPath();
      context.ellipse(p.x, p.y, 13, 9, 0, 0, Math.PI * 2);
      context.fill();
    } else {
      circle(p.x, p.y, 13, PALETTE.playerDark);
      circle(p.x, p.y, 11, PALETTE.player);
    }
    // A pale rim so the courier reads instantly against the dark floor,
    // even inside a shadow zone where the teal alone goes muddy.
    context.strokeStyle = 'rgba(232,255,246,0.9)';
    context.lineWidth = 2;
    context.beginPath();
    context.arc(p.x, p.y, 13, 0, Math.PI * 2);
    context.stroke();
    // Hood: darker arc on the facing side, face shadow, red scarf.
    context.fillStyle = PALETTE.playerDark;
    context.beginPath();
    context.arc(p.x, p.y, 11, p.angle - 1.1, p.angle + 1.1);
    context.lineTo(p.x, p.y);
    context.fill();
    circle(p.x + Math.cos(p.angle) * 4, p.y + Math.sin(p.angle) * 4, 4.5, '#0e2a28');
    context.strokeStyle = PALETTE.scarf;
    context.lineWidth = 3;
    context.beginPath();
    context.arc(p.x, p.y, 12, p.angle + 1.9, p.angle + 2.6);
    context.stroke();
    if (p.hidden) {
      text('HIDDEN', p.x, p.y - 22, 11, '#9fe8c9', 'center');
    }
  }

  function drawParticles(state) {
    for (const part of state.particles) {
      const k = part.life / part.maxLife;
      if (part.ring) {
        context.strokeStyle = part.color;
        context.globalAlpha = k;
        context.lineWidth = 3;
        context.beginPath();
        context.arc(part.x, part.y, part.r + (1 - k) * 46, 0, Math.PI * 2);
        context.stroke();
        context.globalAlpha = 1;
      } else {
        context.globalAlpha = k;
        circle(part.x, part.y, part.r, part.color);
        context.globalAlpha = 1;
      }
    }
    for (const shot of state.pebbleShots) {
      if (shot.landed) continue;
      circle(shot.x, shot.y, 4, '#cfd6e4');
      circle(shot.x - 1, shot.y - 1, 1.5, '#fff');
    }
  }

  function drawVignette() {
    const g = context.createRadialGradient(640, 360, 300, 640, 360, 780);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.42)');
    context.fillStyle = g;
    context.fillRect(0, 0, FIELD.width, FIELD.height);
  }

  function drawField(state) {
    drawFloor(state);
    drawShadowZones(state);
    drawLamps(state);
    drawBushes(state);
    drawCrates(state);
    drawWalls(state);
    drawLetters(state);
    drawExit(state);
    drawGuards(state);
    drawPlayer(state);
    drawParticles(state);
    drawVignette();
  }

  function drawHud(state, screen) {
    context.fillStyle = PALETTE.hud;
    context.fillRect(0, 0, FIELD.width, 56);
    context.fillStyle = PALETTE.gold;
    context.fillRect(0, 56, FIELD.width, 2);
    text('LAMPLIGHT', 20, 34, 20, PALETTE.gold, 'left');
    text(state.levelName, 170, 34, 15, PALETTE.muted, 'left');
    const objective = state.objectiveGot ? 'Sealed letter ✓ — reach the green EXIT' : 'Steal the sealed letter ★, then reach the EXIT';
    text(objective, 640, 22, 15, state.objectiveGot ? PALETTE.exit : PALETTE.text, 'center');
    // Suspicion meter: the worst any guard currently feels.
    let worst = 0;
    for (const guard of state.guards) worst = Math.max(worst, guard.suspicion);
    const label = worst >= 1 ? 'SPOTTED!' : worst >= 0.35 ? 'SUSPICIOUS' : worst > 0.05 ? 'NOTICED' : 'UNSEEN';
    const color = worst >= 1 ? '#ff5964' : worst >= 0.35 ? '#ff9f1c' : worst > 0.05 ? '#ffd166' : '#39d98a';
    text('DETECTION', 480, 48, 11, PALETTE.muted, 'left');
    context.fillStyle = '#1c2133';
    context.fillRect(560, 38, 160, 12);
    context.fillStyle = color;
    context.fillRect(560, 38, 160 * worst, 12);
    context.strokeStyle = PALETTE.hudEdge;
    context.lineWidth = 1;
    context.strokeRect(560.5, 38.5, 160, 12);
    text(label, 728, 48, 11, color, 'left');
    text(`Score ${state.score}`, 1010, 24, 16, PALETTE.text, 'left');
    // On the victory screen the level clock is a fresh 0:00 (the last level
    // was just loaded for the backdrop); the run's total time is the honest one.
    const shownTime = screen === SCREEN_VICTORY ? state.totalTime : state.levelTime;
    const mins = Math.floor(shownTime / 60);
    const secs = Math.floor(shownTime % 60);
    text(`⏱ ${mins}:${String(secs).padStart(2, '0')}`, 1010, 46, 13, PALETTE.muted, 'left');
    text(`✉ ${state.lettersGot}/${state.lettersTotal}`, 1140, 24, 16, PALETTE.text, 'left');
    text(`● ${state.pebbles}  ♥ ${'♥'.repeat(state.attempts)}${'♡'.repeat(3 - state.attempts)}`, 1140, 46, 13, PALETTE.muted, 'left');
    if (state.messageT > 0) {
      const w = 560;
      context.fillStyle = 'rgba(10,12,20,0.88)';
      context.fillRect((FIELD.width - w) / 2, 68, w, 34);
      context.strokeStyle = PALETTE.gold;
      context.lineWidth = 1.5;
      context.strokeRect((FIELD.width - w) / 2, 68, w, 34);
      text(state.message, FIELD.width / 2, 91, 16, PALETTE.gold, 'center');
    }
  }

  function drawPanel(title, lines, prompt, accent, titleSize) {
    context.fillStyle = 'rgba(6,8,16,0.66)';
    context.fillRect(0, 0, FIELD.width, FIELD.height);
    const height = PANEL.top + lines.length * PANEL.line + PANEL.bottom;
    const x = (FIELD.width - PANEL.width) / 2;
    const y = (FIELD.height - height) / 2;
    context.fillStyle = '#171b29';
    context.fillRect(x, y, PANEL.width, height);
    context.strokeStyle = accent ?? PALETTE.gold;
    context.lineWidth = 2;
    context.strokeRect(x, y, PANEL.width, height);
    context.fillStyle = PALETTE.gold;
    context.fillRect(x, y, PANEL.width, 4);
    text(title, FIELD.width / 2, y + 82, titleSize ?? 46, PALETTE.text, 'center');
    for (let index = 0; index < lines.length; index += 1) {
      text(lines[index], FIELD.width / 2, y + PANEL.top + index * PANEL.line, 20, PALETTE.muted, 'center');
    }
    const blink = Math.floor(stateElapsed * 2) % 2 === 0;
    if (blink) text(prompt, FIELD.width / 2, y + height - 38, 22, PALETTE.gold, 'center');
  }

  let stateElapsed = 0;

  /** Paint one frame: the field, then the HUD or a panel for the screen the game is on. */
  function draw(state, screen, best) {
    stateElapsed = state.elapsed;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = PALETTE.backdrop;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    drawField(state);
    if (screen === SCREEN_TITLE) {
      const lines = [
        'You are the courier. Three courtyards, three sealed letters,',
        'one green door each — and guards who watch the lamplight.',
        '',
        'WASD / arrows — move      Shift — sneak (slow, silent)',
        'Q — throw a pebble to distract      Step into the green door',
        'Hide in bushes and shadow. Running is loud,',
        'and being seen is worse.',
        '',
        `Best score: ${best}`,
      ];
      drawPanel('LAMPLIGHT', lines, 'Press Space or click to begin', PALETTE.gold);
      text('— The Courier’s Run —', FIELD.width / 2, 148, 20, PALETTE.gold, 'center');
      return;
    }
    drawHud(state, screen);
    if (screen === SCREEN_PAUSED) {
      drawPanel('Paused', ['The guards wait in the lamplight.'], 'Press P to resume');
    } else if (screen === SCREEN_LEVEL) {
      drawPanel('Level clear — unseen!', [
        `${state.levelName} done. Score ${state.score}.`,
        `Letters ${state.lettersGot}/${state.lettersTotal} · Time ${Math.floor(state.totalTime)}s`,
        'The next courtyard is darker, and the watch is thicker.',
      ], 'Press Space for the next level');
    } else if (screen === SCREEN_OVER) {
      drawPanel('Caught in the lamplight', [
        `The watch found you. Score ${state.score}. Best ${best}.`,
        'The letters stay sealed — for now.',
      ], 'Press Space to try again', '#ff5964');
    } else if (screen === SCREEN_VICTORY) {
      drawPanel('THE LAST LETTER DELIVERED', [
        `All three courtyards crossed unseen. Score ${state.score}.`,
        `Letters collected ${state.lettersAll} · Total time ${Math.floor(state.totalTime)}s · Best ${best}`,
        'The city sleeps. The courier walks home in the dark.',
      ], 'Press Space to play again', PALETTE.exit, 36);
    }
  }

  resize();
  window.addEventListener('resize', resize);
  return { draw };
}
