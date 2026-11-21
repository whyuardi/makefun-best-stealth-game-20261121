// Synthesised sound only: every effect is built from WebAudio oscillators, so the
// game ships no audio files and makes no network request. The context is created
// lazily on the first user gesture; until then every call is a silent no-op.

export function createAudio() {
  let context = null;
  let master = null;
  let stepFlip = false;

  function ensure() {
    if (context) return true;
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return false;
      context = new Ctor();
      master = context.createGain();
      master.gain.value = 0.16;
      master.connect(context.destination);
      return true;
    } catch {
      return false;
    }
  }

  function tone(freq, dur, type, vol, slideTo) {
    if (!ensure()) return;
    try {
      if (context.state === 'suspended') void context.resume();
      const now = context.currentTime;
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), now + dur);
      gain.gain.setValueAtTime(vol, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
      osc.connect(gain);
      gain.connect(master);
      osc.start(now);
      osc.stop(now + dur + 0.02);
    } catch {
      // Sound is garnish: a failure here must never break the game.
    }
  }

  function noiseBurst(dur, vol, low) {
    if (!ensure()) return;
    try {
      const now = context.currentTime;
      const len = Math.max(1, Math.floor(context.sampleRate * dur));
      const buffer = context.createBuffer(1, len, context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const source = context.createBufferSource();
      source.buffer = buffer;
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = low;
      const gain = context.createGain();
      gain.gain.value = vol;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      source.start(now);
    } catch {
      // See tone(): sound must never break the game.
    }
  }

  return {
    /** Soft alternating footstep taps, quieter while sneaking. */
    step(sneak) {
      stepFlip = !stepFlip;
      if (sneak) noiseBurst(0.05, 0.25, 500);
      else tone(stepFlip ? 150 : 120, 0.07, 'sine', sneak ? 0.15 : 0.4, 90);
    },
    /** Two-note rising sting when a guard spots the courier. */
    alert() {
      tone(220, 0.16, 'sawtooth', 0.5, 330);
      setTimeout(() => tone(440, 0.28, 'sawtooth', 0.45, 660), 130);
    },
    /** A guard grows suspicious: a single questioning blip. */
    suspicious() {
      tone(520, 0.12, 'triangle', 0.35, 620);
    },
    /** Bright chime when a sealed letter is picked up. */
    pickup() {
      tone(660, 0.12, 'sine', 0.5);
      setTimeout(() => tone(990, 0.2, 'sine', 0.45), 90);
    },
    /** Pebble tick against stone. */
    pebble() {
      noiseBurst(0.06, 0.5, 2400);
      tone(1400, 0.05, 'square', 0.15, 900);
    },
    /** Low thud when caught. */
    caught() {
      tone(160, 0.35, 'sawtooth', 0.55, 60);
      noiseBurst(0.2, 0.4, 300);
    },
    /** Little fanfare when a level is cleared. */
    success() {
      [523, 659, 784, 1047].forEach((freq, i) => {
        setTimeout(() => tone(freq, 0.22, 'triangle', 0.45), i * 110);
      });
    },
    click() {
      tone(800, 0.05, 'sine', 0.3, 600);
    },
  };
}
