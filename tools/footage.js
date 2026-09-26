// Teaser director: paste into the page (the story build) to render a ~71 s montage frame by frame and
// encode it to MP4 with WebCodecs (hardware H.264) + mp4-muxer. Drive it with __dir.run() (poll __dir.status()), then __dir.finish().
// With window.__peek set it only builds the shot list (tools/teaserpeek.mjs renders single frames of each shot headless).
(async () => {
  const w = window.__rio, s = w.story, T = w.THREE;
  const peek = !!window.__peek;
  const { Muxer, ArrayBufferTarget } = peek ? {} : await import('https://cdn.jsdelivr.net/npm/mp4-muxer@5/+esm');
  const W = 1920, H = 1080, FPS = 30, DT = 1 / FPS;
  if (!peek) { window.innerWidth = W; window.innerHeight = H; w.maxDpr = 1; }
  const RF = w.__RF || (w.__RF = w.renderFrame.bind(w));
  if (!peek) w.renderFrame = () => {};
  const V = (x, y, z) => new T.Vector3(x, y, z);
  const hot = s.hot;
  s.reset(); s.auto = false;
  const tap = (k) => () => s.play(hot[k], false);
  const drop = () => { for (let k = 0; k < 4 && !s.dropVeladora(); k++); };
  const strike = () => w.lightning && w.lightning.strike();
  const reset = (u, ph, o = {}) => {
    w.debugCam = false; s.comp.clear(); s.vel.clear();
    w.looping = false; w.didReset = false; w.fade = 0; w.bellRingT = 0;
    w.tod.phase = ph; w.boat.reset(u); w.chase.snap(); w.chase.userYaw = 0; w.chase.userPitch = 0; w.chase.userDist = 0;
    w.envTimer = 0; w.wet = o.wet || 0;
    if (o.bring) for (let i = 0; i < o.bring; i++) {
      const it = s.comp.spawn(w.boat.pos.clone().add(V((Math.random() - 0.5) * 9, 1.4 + Math.random() * 2.2, (Math.random() - 0.5) * 9)));
      it.mode = 2; it.a = 1;
    }
  };
  // camera sliding along the river bank in front of a scene, looking at it
  const dolly = (k, dist, side0, side1, up, lookY) => {
    let P0, P1, L;
    return (t, dur) => {
      const h = hot[k];
      if (!P0) {
        const dir = w.boat.pos.clone().sub(h.p); dir.y = 0; dir.normalize();
        const lat = V(-dir.z, 0, dir.x);
        const base = h.p.clone().addScaledVector(dir, dist); base.y = h.p.y + up;
        P0 = base.clone().addScaledVector(lat, side0); P1 = base.clone().addScaledVector(lat, side1);
        L = h.p.clone().add(V(0, lookY, 0));
      }
      const e = t / dur, k2 = e * e * (3 - 2 * e);
      w.debugCam = true;
      w.cam.position.lerpVectors(P0, P1, k2); w.cam.lookAt(L); w.shadowTarget = L.clone();
    };
  };
  // the same, but from straight out on the river (perpendicular to the bank at the scene)
  const perp = {};
  hot.forEach((h, k) => { w.boat.reset(h.u); const d = w.boat.pos.clone().sub(h.p); d.y = 0; perp[k] = d.normalize(); });
  const across = (k, dist, up, lookY, side0, side1) => (t, dur) => {
    const h = hot[k], dir = perp[k], lat = V(-dir.z, 0, dir.x);
    const e = t / dur, k2 = e * e * (3 - 2 * e);
    const P = h.p.clone().addScaledVector(dir, dist).addScaledVector(lat, side0 + (side1 - side0) * k2); P.y = h.p.y + up;
    const L = h.p.clone().add(V(0, lookY, 0));
    w.debugCam = true; w.cam.position.copy(P); w.cam.lookAt(L); w.shadowTarget = L.clone();
  };
  // from the trajinera, looking up at the church, then panning down to the alebrijes
  const church = () => (t, dur) => {
    const b = w.boat, bells = hot[2].p.clone().add(V(0, 6, 0)), ale = hot[3].p;
    const tgt = V(bells.x, bells.y - 9, bells.z).lerp(V(ale.x, ale.y + 1.5, ale.z), Math.min(1, Math.max(0, (t - 2.5) / 3)));
    w.debugCam = true;
    w.cam.position.copy(b.pos).addScaledVector(b.fwd, -3).add(V(0, 3.4, 0));
    w.cam.lookAt(tgt); w.shadowTarget = tgt.clone();
  };
  // around the trajinera, in its own frame (+z = bow): an arc in front of the painted arch
  const orbit = (p0, p1, look) => (t, dur) => {
    const e = t / dur, k2 = e * e * (3 - 2 * e), g = w.boat.group;
    g.updateMatrixWorld(true);
    const P = V(...p0).lerp(V(...p1), k2).applyMatrix4(g.matrixWorld), L = V(...look).applyMatrix4(g.matrixWorld);
    w.debugCam = true; w.cam.position.copy(P); w.cam.lookAt(L); w.shadowTarget = L.clone();
  };
  const shots = [
    { name: 'apertura', dur: 6, fadeIn: 1.2, setup: () => reset(22, 0.600) },
    { name: 'lupita', dur: 6, setup: () => reset(34, 0.62), cam: orbit([3.2, 2.0, 6.6], [-2.4, 1.8, 7.0], [0, 1.4, 1.6]) },
    { name: 'ofrenda', dur: 6, setup: () => reset(hot[0].u - 14, 0.645), cam: across(0, 9, 1.2, 0.2, -2, 2), ev: [[1.8, tap(0)]] },
    { name: 'nina', dur: 7, setup: () => reset(hot[1].u - 12, 0.69), cam: across(1, 4.0, 0.7, 0.25, 0.9, -0.9), ev: [[1.0, tap(1)]] },
    { name: 'iglesia', dur: 8, setup: () => reset(250, 0.846), cam: church(), ev: [[0.8, tap(2)], [4.3, tap(3)]] },
    { name: 'veladoras', dur: 7, setup: () => reset(300, 0.87), ev: [[0.4, drop], [1.8, drop], [3.2, drop], [4.6, drop]] },
    { name: 'tumba', dur: 6, setup: () => reset(hot[4].u - 10, 0.012), cam: across(4, 6.5, 1.2, 0.3, 1.8, -0.6), ev: [[0.8, tap(4)]] },
    { name: 'amanecer', dur: 5, setup: () => reset(492, 0.075, { bring: 14 }) },
    { name: 'monarcas', dur: 6, setup: () => reset(hot[5].u - 16, 0.19), cam: across(5, 13, 5.5, 2.0, -2.5, -0.5), ev: [[1.2, tap(5)]] },
    { name: 'tormenta', dur: 5, setup: () => reset(840, 0.47, { wet: 0.8 }), ev: [[1.6, strike], [3.8, strike]] },
    { name: 'cascada', dur: 9, fadeOut: 1.8, setup: () => reset(1034, 0.565, { bring: 26 }) },
  ];
  const PRE = 45, FADE = 0.35;
  const steps = [];
  shots.forEach((sh, si) => {
    for (let i = 0; i < PRE; i++) steps.push([si, -1, i]);
    const n = Math.round(sh.dur * FPS);
    for (let i = 0; i < n; i++) steps.push([si, 1, i]);
  });
  const total = steps.filter((x) => x[1] === 1).length;
  const PREs = PRE;
  if (peek) { window.__dir = { shots, PRE: PREs, FPS, FADE }; return { shots: shots.map((x) => x.name), total }; }
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: W, height: H }, fastStart: 'in-memory' });
  const D = { i: 0, frame: 0, total, err: null, ms: 0 };
  const enc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => { D.err = String(e); } });
  const cfg = { codec: 'avc1.640028', width: W, height: H, bitrate: 14e6, framerate: FPS, hardwareAcceleration: 'prefer-hardware', avc: { format: 'avc' } };
  const sup = await VideoEncoder.isConfigSupported(cfg);
  enc.configure(sup.supported ? cfg : Object.assign({}, cfg, { hardwareAcceleration: 'no-preference' }));
  let cur = -1, t = 0, fired = 0;
  // yields that background tabs do not throttle (timers are clamped to 1 s there)
  const mc = new MessageChannel();
  const yieldNow = () => new Promise((r) => { mc.port1.onmessage = () => r(); mc.port2.postMessage(0); });
  D.running = false;
  D.run = async (n = Infinity) => {
    D.running = true;
    const t0 = performance.now();
    let k = 0;
    while (k < n && D.i < steps.length && !D.stop) {
      while (enc.encodeQueueSize > 6) await yieldNow();
      const [si, rec, i] = steps[D.i];
      const sh = shots[si];
      if (si !== cur) { cur = si; sh.setup(); fired = 0; }
      t = rec === 1 ? i / FPS : 0;
      // hold the render settings the adaptive loop might have changed
      w.renderScale = 1; if (w.post.samples !== 4) w.post.setSamples(4); w.quality = 0;
      if (sh.cam) sh.cam(rec === 1 ? t : 0, sh.dur);
      if (rec === 1 && sh.ev) while (fired < sh.ev.length && sh.ev[fired][0] <= t) sh.ev[fired++][1]();
      if (rec === 1) {
        const fi = sh.fadeIn || FADE, fo = sh.fadeOut || FADE;
        w.fade = Math.max(0, Math.min(1, Math.max(1 - t / fi, (t - (sh.dur - fo)) / fo)));
      } else w.fade = 1;
      RF(DT);
      if (rec === 1) {
        const vf = new VideoFrame(w.r.domElement, { timestamp: Math.round(D.frame * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
        enc.encode(vf, { keyFrame: D.frame % 60 === 0 });
        vf.close();
        D.frame++;
      }
      D.i++; k++;
      if (k % 4 === 0) await yieldNow();
    }
    D.ms = Math.round(performance.now() - t0);
    D.running = false;
    return D.status();
  };
  D.status = () => ({ frame: D.frame, total, i: D.i, of: steps.length, q: enc.encodeQueueSize, ms: D.ms, err: D.err, size: w.r.domElement.width + 'x' + w.r.domElement.height, running: D.running });
  D.finish = async (name = 'rio-de-animas-teaser.mp4') => {
    await enc.flush();
    muxer.finalize();
    const buf = muxer.target.buffer;
    const url = URL.createObjectURL(new Blob([buf], { type: 'video/mp4' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
    return { bytes: buf.byteLength, name };
  };
  window.__dir = D;
  return { supported: sup.supported, total, steps: steps.length };
})()
