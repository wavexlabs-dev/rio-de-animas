// Synthesised soundscape: river, wind, rain, thunder, bells, crickets, birds, pole splashes
import { R } from './river.js';

export class Soundscape {
  constructor(world) {
    this.w = world;
    this.ctx = null;
    this.muted = false;
    this.started = false;
  }
  start() {
    if (this.started) { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.started = true;
    const ctx = this.ctx = new AC();
    const master = this.master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 3;
    master.connect(comp).connect(ctx.destination);
    // reverb (synthetic impulse)
    const rev = ctx.createConvolver();
    const len = ctx.sampleRate * 2.8;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
    rev.buffer = ir;
    this.revIn = ctx.createGain(); this.revIn.gain.value = 0.35;
    this.revIn.connect(rev).connect(master);
    // noise buffers
    const nb = (type) => {
      const b = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
      const d = b.getChannelData(0);
      let last = 0;
      for (let i = 0; i < d.length; i++) {
        const wht = Math.random() * 2 - 1;
        if (type === 'brown') { last = (last + 0.02 * wht) / 1.02; d[i] = last * 3.5; } else d[i] = wht;
      }
      return b;
    };
    this.white = nb('white'); this.brown = nb('brown');
    const loop = (buf) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };
    // river body
    this.riverG = ctx.createGain(); this.riverG.gain.value = 0.25;
    const rb = loop(this.brown);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    rb.connect(lp).connect(this.riverG).connect(master);
    // river babble
    this.babG = ctx.createGain(); this.babG.gain.value = 0.05;
    const bw = loop(this.white);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 1.2;
    this.babAM = ctx.createGain(); this.babAM.gain.value = 0.5;
    bw.connect(bp).connect(this.babAM).connect(this.babG).connect(master);
    this.babG.connect(this.revIn);
    // waterfall roar
    this.fallG = ctx.createGain(); this.fallG.gain.value = 0;
    const fw = loop(this.brown);
    const flp = ctx.createBiquadFilter(); flp.type = 'lowpass'; flp.frequency.value = 1400;
    fw.connect(flp).connect(this.fallG).connect(master);
    this.fallG.connect(this.revIn);
    // wind
    this.windG = ctx.createGain(); this.windG.gain.value = 0.05;
    const ww = loop(this.white);
    this.windF = ctx.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.frequency.value = 500; this.windF.Q.value = 0.7;
    ww.connect(this.windF).connect(this.windG).connect(master);
    // rain
    this.rainG = ctx.createGain(); this.rainG.gain.value = 0;
    const rw = loop(this.white);
    const rhp = ctx.createBiquadFilter(); rhp.type = 'highpass'; rhp.frequency.value = 1200;
    const rlp = ctx.createBiquadFilter(); rlp.type = 'lowpass'; rlp.frequency.value = 9000;
    rw.connect(rhp).connect(rlp).connect(this.rainG).connect(master);
    // crickets
    this.crG = ctx.createGain(); this.crG.gain.value = 0;
    this.crG.connect(master);
    for (let k = 0; k < 3; k++) {
      const o = ctx.createOscillator(); o.frequency.value = 4100 + k * 260; o.type = 'sine';
      const am = ctx.createGain(); am.gain.value = 0;
      const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 24 + k * 5;
      const lg = ctx.createGain(); lg.gain.value = 0.5;
      const chirp = ctx.createOscillator(); chirp.type = 'square'; chirp.frequency.value = 1.6 + k * 0.45;
      const cg = ctx.createGain(); cg.gain.value = 0.5;
      const mix = ctx.createGain(); mix.gain.value = 0;
      lfo.connect(lg).connect(am.gain);
      chirp.connect(cg).connect(mix.gain);
      o.connect(am).connect(mix);
      const pan = ctx.createStereoPanner(); pan.pan.value = (k - 1) * 0.7;
      mix.connect(pan).connect(this.crG);
      o.start(); lfo.start(); chirp.start();
    }
    this.nextChirp = 2;
  }
  toggle() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, this.ctx.currentTime, 0.1);
  }
  update(dt) {
    if (!this.ctx) return;
    const w = this.w, t = this.ctx.currentTime;
    const u = w.boat.u;
    const gorge = Math.min(1, Math.max(0, (u - 650) / 300));
    const fall = Math.max(0, 1 - Math.abs(R.FALL_U - u) / 180);
    this.riverG.gain.setTargetAtTime(0.18 + gorge * 0.12, t, 0.5);
    this.babAM.gain.setTargetAtTime(0.35 + 0.35 * Math.random(), t, 0.08);
    this.babG.gain.setTargetAtTime(0.035 + gorge * 0.05, t, 0.5);
    this.fallG.gain.setTargetAtTime(fall * fall * 0.6, t, 0.5);
    const wind = w.U ? 0 : 0;
    const gust = (w.windGust || 0.5);
    this.windG.gain.setTargetAtTime(0.02 + gust * 0.05 + w.tod.storm * 0.08, t, 0.4);
    this.windF.frequency.setTargetAtTime(380 + gust * 420, t, 0.6);
    this.rainG.gain.setTargetAtTime(w.tod.rain * 0.22, t, 0.6);
    this.crG.gain.setTargetAtTime(w.tod.night * (1 - w.tod.rain) * 0.012, t, 1.0);
    // daytime bird chirps
    this.nextChirp -= dt;
    if (this.nextChirp <= 0) {
      this.nextChirp = 0.8 + Math.random() * 4;
      if (w.tod.night < 0.3 && w.tod.rain < 0.3) this.chirp();
    }
  }
  chirp() {
    const ctx = this.ctx, t = ctx.currentTime;
    const n = 2 + Math.floor(Math.random() * 4);
    const base = 2200 + Math.random() * 1800;
    const pan = ctx.createStereoPanner(); pan.pan.value = Math.random() * 2 - 1;
    const g = ctx.createGain(); g.gain.value = 0;
    pan.connect(this.master); g.connect(pan); g.connect(this.revIn);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.connect(g);
    for (let i = 0; i < n; i++) {
      const s = t + i * 0.13;
      o.frequency.setValueAtTime(base, s);
      o.frequency.exponentialRampToValueAtTime(base * (1.3 + Math.random() * 0.4), s + 0.07);
      g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(0.012, s + 0.01); g.gain.exponentialRampToValueAtTime(0.0005, s + 0.1);
    }
    o.start(t); o.stop(t + n * 0.13 + 0.2);
  }
  thunder(delay, dist) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + Math.min(delay, 9);
    const vol = Math.min(0.9, 900 / (dist + 300));
    const s = ctx.createBufferSource(); s.buffer = this.brown;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(70, t + 4.5);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.08);
    for (let k = 1; k < 5; k++) g.gain.setTargetAtTime(vol * (0.4 + Math.random() * 0.6), t + k * 0.5 + Math.random() * 0.3, 0.2);
    g.gain.setTargetAtTime(0, t + 3.0, 1.2);
    s.connect(lp).connect(g).connect(this.master); g.connect(this.revIn);
    s.start(t, Math.random() * 2); s.stop(t + 9);
  }
  bell(b) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const d = this.w.cam.position.distanceTo(b.piv.position);
    const vol = Math.min(0.25, 22 / (d + 30));
    const f0 = [196, 247, 294][Math.floor((b.speed * 10) % 3)];
    const partials = [[0.5, 1.0, 5], [1.0, 0.8, 3.5], [1.19, 0.5, 2.5], [1.5, 0.35, 2.0], [2.0, 0.45, 1.6], [2.52, 0.2, 1.1], [3.0, 0.15, 0.8]];
    const out = ctx.createGain(); out.gain.value = vol;
    out.connect(this.master); out.connect(this.revIn);
    for (const [r, a, dec] of partials) {
      const o = ctx.createOscillator(); o.frequency.value = f0 * r * (1 + (Math.random() - 0.5) * 0.003);
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(a, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0008, t + dec);
      o.connect(g).connect(out); o.start(t); o.stop(t + dec + 0.1);
    }
  }
  // distance falloff for story sounds placed in the world
  near(p, k = 22) { return p ? Math.min(1, k / (this.w.cam.position.distanceTo(p) + 6)) : 1; }
  // soft struck-glass chime (a short arpeggio)
  chime(freqs, vol = 0.6, p) {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const out = ctx.createGain(); out.gain.value = 0.05 * vol * this.near(p);
    out.connect(this.master); out.connect(this.revIn);
    freqs.forEach((f, i) => {
      const t = t0 + i * 0.11;
      for (const [r, a, dec] of [[1, 1, 2.2], [2.76, 0.25, 0.9], [5.4, 0.08, 0.4]]) {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * r;
        const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(a, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0005, t + dec);
        o.connect(g).connect(out); o.start(t); o.stop(t + dec + 0.05);
      }
    });
  }
  // a small thing set down on the water
  plop(p) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, v = this.near(p, 14);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(620, t); o.frequency.exponentialRampToValueAtTime(180, t + 0.12);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05 * v, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.16);
    o.connect(g).connect(this.master); g.connect(this.revIn);
    o.start(t); o.stop(t + 0.2);
    this.splash(0.5 * v);
  }
  // wings / thrown petals: a soft papery flutter
  flutter(p, amt = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, v = this.near(p, 18) * amt;
    const s = ctx.createBufferSource(); s.buffer = this.white;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 0.8;
    const am = ctx.createGain(); am.gain.value = 0.5;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 17; const lg = ctx.createGain(); lg.gain.value = 0.5;
    lfo.connect(lg).connect(am.gain);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.03 * v, t + 0.15); g.gain.exponentialRampToValueAtTime(0.0005, t + 1.4 + amt);
    s.connect(bp).connect(am).connect(g).connect(this.master);
    s.start(t, Math.random() * 2); s.stop(t + 1.6 + amt); lfo.start(t); lfo.stop(t + 1.6 + amt);
  }
  splash(strength) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.white;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900 + Math.random() * 500; bp.Q.value = 1.5;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05 * strength, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    s.connect(bp).connect(g).connect(this.master);
    s.start(t, Math.random() * 3); s.stop(t + 0.4);
  }
}
