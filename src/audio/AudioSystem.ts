import { AudioSettings, FlightTelemetry } from '../types';
import { clamp } from '../utils/noise';

const AUDIO_STORAGE_KEY = 'dream_flight_audio_v1';

// Peaceful F-Lydian / D-minor9 dreamy chord voicings (Hz) — 100% original procedural composition
const DREAM_CHORDS: number[][] = [
  [174.61, 261.63, 329.63, 392.0],  // Fmaj7
  [146.83, 220.0, 261.63, 329.63],  // Dm9
  [196.0, 293.66, 349.23, 440.0],   // G6/9
  [130.81, 196.0, 246.94, 329.63],  // Cmaj7
];

const MELODY_NOTES: number[] = [523.25, 587.33, 659.25, 783.99, 880.0, 659.25, 587.33, 440.0];

export class AudioSystem {
  public settings: AudioSettings = {
    masterEnabled: true,
    engineVolume: 0.42,
    ambientVolume: 0.55,
    musicVolume: 0.48,
    musicMuted: false,
  };

  private ctx: AudioContext | null = null;
  private initialized = false;

  // Engine nodes
  private engineGain!: GainNode;
  private engineOsc1!: OscillatorNode;
  private engineOsc2!: OscillatorNode;
  private engineFilter!: BiquadFilterNode;

  // Wind / Ambient nodes
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private ambientAirGain!: GainNode;

  // Generative music bus
  private musicMasterGain!: GainNode;
  private chordIndex = 0;
  private chordTimer = 0;
  private noteTimer = 2.5;

  constructor() {
    this.loadSettings();
  }

  private loadSettings(): void {
    try {
      const raw = localStorage.getItem(AUDIO_STORAGE_KEY);
      if (raw) {
        this.settings = { ...this.settings, ...JSON.parse(raw) };
      }
    } catch {
      // Ignore
    }
  }

  public saveSettings(): void {
    try {
      localStorage.setItem(AUDIO_STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // Ignore
    }
  }

  public unlockAndStart(): void {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.setupGraph();
      this.initialized = true;
      // Trigger opening warm ambient pad chord gently
      this.playDreamPadChord(DREAM_CHORDS[0], 7.5);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  private createNoiseBuffer(ctx: AudioContext, seconds = 3): AudioBuffer {
    const sampleRate = ctx.sampleRate;
    const len = sampleRate * seconds;
    const buffer = ctx.createBuffer(1, len, sampleRate);
    const data = buffer.getChannelData(0);
    // Smooth pink-brown filtered noise so wind sounds silky & soothing, never harsh static!
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + white * 0.029;
      b1 = 0.985 * b1 + white * 0.032;
      b2 = 0.95 * b2 + white * 0.048;
      data[i] = clamp((b0 + b1 + b2) * 0.42, -1, 1);
    }
    return buffer;
  }

  private setupGraph(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;

    // 1. Gentle Light-Aircraft Engine & Propeller Hum
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.0;

    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 210;
    this.engineFilter.Q.value = 1.4;

    this.engineOsc1 = ctx.createOscillator();
    this.engineOsc1.type = 'sawtooth';
    this.engineOsc1.frequency.value = 58;

    this.engineOsc2 = ctx.createOscillator();
    this.engineOsc2.type = 'triangle';
    this.engineOsc2.frequency.value = 116;

    const osc2SubGain = ctx.createGain();
    osc2SubGain.gain.value = 0.45;

    this.engineOsc1.connect(this.engineFilter);
    this.engineOsc2.connect(osc2SubGain);
    osc2SubGain.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(ctx.destination);

    this.engineOsc1.start();
    this.engineOsc2.start();

    // 2. Soft Aerodynamic Wind & High-Altitude Breeze
    const noiseBuf = this.createNoiseBuffer(ctx, 4);
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = noiseBuf;
    windSrc.loop = true;

    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 340;
    this.windFilter.Q.value = 0.65;

    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.0;

    windSrc.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(ctx.destination);
    windSrc.start();

    // Subtle open-sky ambient air layer
    const airSrc = ctx.createBufferSource();
    airSrc.buffer = noiseBuf;
    airSrc.loop = true;
    const airFilter = ctx.createBiquadFilter();
    airFilter.type = 'lowpass';
    airFilter.frequency.value = 190;
    this.ambientAirGain = ctx.createGain();
    this.ambientAirGain.gain.value = 0.0;

    airSrc.connect(airFilter);
    airFilter.connect(this.ambientAirGain);
    this.ambientAirGain.connect(ctx.destination);
    airSrc.start();

    // 3. Generative Ambient Music Master Bus
    this.musicMasterGain = ctx.createGain();
    this.musicMasterGain.gain.value = this.settings.musicMuted ? 0 : this.settings.musicVolume * 0.24;
    this.musicMasterGain.connect(ctx.destination);
  }

  private playDreamPadChord(freqs: number[], durationSec: number): void {
    if (!this.ctx || !this.initialized) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    for (const f of freqs) {
      const osc = ctx.createOscillator();
      const oscDetune = ctx.createOscillator();
      osc.type = 'sine';
      oscDetune.type = 'triangle';
      osc.frequency.value = f;
      oscDetune.frequency.value = f * 1.0025;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 620;

      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, now);
      env.gain.linearRampToValueAtTime(0.11, now + durationSec * 0.34);
      env.gain.linearRampToValueAtTime(0.08, now + durationSec * 0.68);
      env.gain.exponentialRampToValueAtTime(0.0001, now + durationSec + 1.4);

      const triScale = ctx.createGain();
      triScale.gain.value = 0.22;

      osc.connect(filter);
      oscDetune.connect(triScale);
      triScale.connect(filter);
      filter.connect(env);
      env.connect(this.musicMasterGain);

      osc.start(now);
      oscDetune.start(now);
      osc.stop(now + durationSec + 1.5);
      oscDetune.stop(now + durationSec + 1.5);
    }
  }

  private playSoftCelestaNote(freq: number): void {
    if (!this.ctx || !this.initialized) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(0.075, now + 0.045);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 3.6);

    osc.connect(env);
    env.connect(this.musicMasterGain);
    osc.start(now);
    osc.stop(now + 3.7);
  }

  public playUiChime(higher = false): void {
    if (!this.ctx || !this.initialized || !this.settings.masterEnabled) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(higher ? 659.25 : 523.25, now);
    osc.frequency.exponentialRampToValueAtTime(higher ? 880.0 : 659.25, now + 0.09);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.055, now + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.24);
  }

  public update(dt: number, telemetry: FlightTelemetry, paused: boolean, inMenu: boolean): void {
    if (!this.ctx || !this.initialized) return;
    const now = this.ctx.currentTime;

    if (!this.settings.masterEnabled || paused) {
      this.engineGain.gain.setTargetAtTime(0, now, 0.08);
      this.windGain.gain.setTargetAtTime(0, now, 0.08);
      this.ambientAirGain.gain.setTargetAtTime(0, now, 0.08);
      this.musicMasterGain.gain.setTargetAtTime(0, now, 0.12);
      return;
    }

    const menuAtten = inMenu ? 0.38 : 1.0;

    // 1. Update peaceful engine RPM pitch & warmth
    const baseFreq = 46 + telemetry.rpmNormalized * 52;
    this.engineOsc1.frequency.setTargetAtTime(baseFreq, now, 0.08);
    this.engineOsc2.frequency.setTargetAtTime(baseFreq * 2.0, now, 0.08);
    this.engineFilter.frequency.setTargetAtTime(150 + telemetry.rpmNormalized * 240, now, 0.1);
    const targetEngGain = this.settings.engineVolume * (0.04 + telemetry.rpmNormalized * 0.095) * menuAtten;
    this.engineGain.gain.setTargetAtTime(targetEngGain, now, 0.1);

    // 2. Update silky aerodynamic wind + cloud-entry hush/shimmer
    const speedNorm = clamp(telemetry.airspeedKts / 150, 0, 1.2);
    const bankRush = clamp(Math.abs(telemetry.rollDeg) / 60, 0, 1) * 0.25;
    const cloudSoften = 1.0 - telemetry.cloudDensity * 0.22;
    this.windFilter.frequency.setTargetAtTime((240 + speedNorm * 420 + bankRush * 160) * cloudSoften, now, 0.12);
    const targetWindGain = this.settings.ambientVolume * (0.03 + speedNorm * 0.14 + telemetry.cloudDensity * 0.05) * menuAtten;
    this.windGain.gain.setTargetAtTime(targetWindGain, now, 0.12);
    this.ambientAirGain.gain.setTargetAtTime(this.settings.ambientVolume * 0.055, now, 0.2);

    // 3. Generative Ambient Music progression
    const musicTarget = this.settings.musicMuted ? 0 : this.settings.musicVolume * 0.28;
    this.musicMasterGain.gain.setTargetAtTime(musicTarget, now, 0.25);

    if (!this.settings.musicMuted && this.settings.musicVolume > 0.01) {
      this.chordTimer += dt;
      if (this.chordTimer >= 8.2) {
        this.chordTimer = 0;
        this.chordIndex = (this.chordIndex + 1) % DREAM_CHORDS.length;
        this.playDreamPadChord(DREAM_CHORDS[this.chordIndex], 8.2);
      }

      this.noteTimer -= dt;
      if (this.noteTimer <= 0) {
        this.noteTimer = 2.4 + Math.random() * 3.2;
        const note = MELODY_NOTES[Math.floor(Math.random() * MELODY_NOTES.length)];
        this.playSoftCelestaNote(note);
      }
    }
  }
}
