export type FootstepSurface = 'grass' | 'road' | 'wood' | 'water';

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private windGain: GainNode | null = null;
  private rainGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private initialized = false;
  private muted = false;

  init(): void {
    if (this.initialized) {
      if (this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return;
    }

    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;

    this.ctx = new AC();
    this.initialized = true;

    const bufSize = this.ctx.sampleRate * 2;
    this.noiseBuffer = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    // Wind loop
    const windSrc = this.ctx.createBufferSource();
    windSrc.buffer = this.noiseBuffer;
    windSrc.loop = true;
    const windFilter = this.ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 320;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0.03;
    windSrc.connect(windFilter).connect(this.windGain).connect(this.ctx.destination);
    windSrc.start();

    // Rain loop
    const rainSrc = this.ctx.createBufferSource();
    rainSrc.buffer = this.noiseBuffer;
    rainSrc.loop = true;
    const rainFilter = this.ctx.createBiquadFilter();
    rainFilter.type = 'bandpass';
    rainFilter.frequency.value = 1850;
    rainFilter.Q.value = 0.55;
    this.rainGain = this.ctx.createGain();
    this.rainGain.gain.value = 0;
    rainSrc.connect(rainFilter).connect(this.rainGain).connect(this.ctx.destination);
    rainSrc.start();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (!this.initialized || !this.ctx || !this.windGain || !this.rainGain) return;
    if (muted) {
      const now = this.ctx.currentTime;
      this.windGain.gain.setTargetAtTime(0, now, 0.08);
      this.rainGain.gain.setTargetAtTime(0, now, 0.08);
    }
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') {
      void this.ctx.suspend();
    }
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  updateAmbience(weather: string, windStrength: number): void {
    if (!this.initialized || !this.ctx || !this.windGain || !this.rainGain) return;
    const now = this.ctx.currentTime;
    if (this.muted) {
      this.windGain.gain.setTargetAtTime(0, now, 0.2);
      this.rainGain.gain.setTargetAtTime(0, now, 0.2);
      return;
    }
    const targetWind = 0.025 + windStrength * 0.085;
    const targetRain = weather === 'rain' ? 0.13 : weather === 'storm' ? 0.22 : 0;
    this.windGain.gain.setTargetAtTime(targetWind, now, 0.45);
    this.rainGain.gain.setTargetAtTime(targetRain, now, 0.45);
  }

  playFootstep(surface: FootstepSurface): void {
    if (!this.initialized || !this.ctx || this.muted) return;
    const now = this.ctx.currentTime;

    if (surface === 'wood') {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(135 + Math.random() * 28, now);
      osc.frequency.exponentialRampToValueAtTime(52, now + 0.085);
      gain.gain.setValueAtTime(0.13, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.095);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.1);
      return;
    }

    const dur = surface === 'water' ? 0.16 : 0.08;
    const buf = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * dur), this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    if (surface === 'water') {
      filter.type = 'bandpass';
      filter.frequency.value = 920 + Math.random() * 340;
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.008, now + dur);
    } else {
      filter.type = 'lowpass';
      filter.frequency.value = surface === 'road' ? 1650 : 640;
      gain.gain.setValueAtTime(surface === 'road' ? 0.1 : 0.065, now);
      gain.gain.exponentialRampToValueAtTime(0.005, now + dur);
    }

    src.connect(filter).connect(gain).connect(this.ctx.destination);
    src.start(now);
  }

  playImpact(strength = 1): void {
    if (!this.initialized || !this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110 + Math.random() * 16, now);
    osc.frequency.exponentialRampToValueAtTime(36, now + 0.14);
    gain.gain.setValueAtTime(Math.min(0.26, 0.11 * strength), now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  playGatherMushroom(): void {
    if (!this.initialized || !this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    // Soft mossy pluck + warm wooden chime
    const osc1 = this.ctx.createOscillator();
    const gain1 = this.ctx.createGain();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(360 + Math.random() * 45, now);
    osc1.frequency.exponentialRampToValueAtTime(590, now + 0.11);
    gain1.gain.setValueAtTime(0.14, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc1.connect(gain1).connect(this.ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.2);

    const osc2 = this.ctx.createOscillator();
    const gain2 = this.ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(720, now + 0.04);
    osc2.frequency.exponentialRampToValueAtTime(880, now + 0.16);
    gain2.gain.setValueAtTime(0.07, now + 0.04);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc2.connect(gain2).connect(this.ctx.destination);
    osc2.start(now + 0.04);
    osc2.stop(now + 0.23);
  }

  playThunder(): void {
    if (!this.initialized || !this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const dur = 2.5;
    const buf = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * dur), this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 1.45);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(190, now);
    filter.frequency.linearRampToValueAtTime(55, now + dur - 0.1);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.42, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + dur);
    src.connect(filter).connect(gain).connect(this.ctx.destination);
    src.start(now);
  }

  dispose(): void {
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
    this.initialized = false;
  }
}
