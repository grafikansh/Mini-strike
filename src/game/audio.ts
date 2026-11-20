// Zero-dependency procedural Web Audio SFX for MINI STRIKE 3D

let audioCtx: AudioContext | null = null;
let noiseBuffer: AudioBuffer | null = null;

function ensureContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;

  if (!audioCtx) {
    try {
      audioCtx = new Ctx();
      // Pre-build 0.1s white noise buffer once
      const length = Math.floor(audioCtx.sampleRate * 0.1);
      noiseBuffer = audioCtx.createBuffer(1, length, audioCtx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
    } catch {
      return null;
    }
  }

  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }

  return audioCtx;
}

export function unlockAudio(): void {
  ensureContext();
}

export function playShootSfx(): void {
  const ctx = ensureContext();
  if (!ctx || !noiseBuffer) return;

  const now = ctx.currentTime;
  const pitchJitter = 0.94 + Math.random() * 0.12;

  // Short crisp noise snap (MP5 suppressed/arcade punch)
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(1400 * pitchJitter, now);
  filter.Q.value = 1.2;

  const nGain = ctx.createGain();
  nGain.gain.setValueAtTime(0.16, now);
  nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.065);

  noise.connect(filter);
  filter.connect(nGain);
  nGain.connect(ctx.destination);
  noise.start(now);
  noise.stop(now + 0.07);

  // Low punch body
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(175 * pitchJitter, now);
  osc.frequency.exponentialRampToValueAtTime(52, now + 0.055);

  const oGain = ctx.createGain();
  oGain.gain.setValueAtTime(0.18, now);
  oGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

  osc.connect(oGain);
  oGain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.065);
}

export function playHitSfx(headshot = false): void {
  const ctx = ensureContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(headshot ? 1280 : 880, now);
  osc.frequency.exponentialRampToValueAtTime(headshot ? 720 : 480, now + 0.045);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.11, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.055);
}

export function playKillSfx(): void {
  const ctx = ensureContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(340, now);
  osc.frequency.exponentialRampToValueAtTime(110, now + 0.11);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.1, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.125);
}

export function playHurtSfx(): void {
  const ctx = ensureContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(135, now);
  osc.frequency.exponentialRampToValueAtTime(55, now + 0.12);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.16, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.135);
}
