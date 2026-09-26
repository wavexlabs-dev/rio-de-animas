import * as THREE from 'three';

const VS = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function passMat(fs, uniforms) {
  return new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false });
}

export class Post {
  constructor(renderer) {
    this.r = renderer;
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.qscene = new THREE.Scene();
    this.qscene.add(this.quad);
    this.qcam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const hf = THREE.HalfFloatType;
    this.samples = 2;
    this.rtMain = new THREE.WebGLRenderTarget(4, 4, { type: hf, samples: this.samples, depthBuffer: true });
    this.rtMain.depthTexture = new THREE.DepthTexture(4, 4, THREE.FloatType);
    this.rtCopy = new THREE.WebGLRenderTarget(4, 4, { type: hf, depthBuffer: false });
    this.rtRefl = new THREE.WebGLRenderTarget(4, 4, { type: hf, depthBuffer: true, samples: 0 });
    this.rtRays = [0, 1].map(() => new THREE.WebGLRenderTarget(4, 4, { type: hf, depthBuffer: false }));
    this.bloomDown = [];
    this.bloomUp = [];
    for (let i = 0; i < 6; i++) {
      this.bloomDown.push(new THREE.WebGLRenderTarget(4, 4, { type: hf, depthBuffer: false }));
      this.bloomUp.push(new THREE.WebGLRenderTarget(4, 4, { type: hf, depthBuffer: false }));
    }
    for (const rt of [this.rtCopy, this.rtRefl, ...this.rtRays, ...this.bloomDown, ...this.bloomUp]) {
      rt.texture.minFilter = THREE.LinearFilter; rt.texture.magFilter = THREE.LinearFilter; rt.texture.generateMipmaps = false;
    }
    this.copyMat = passMat(/* glsl */`
      uniform sampler2D tColor; uniform sampler2D tDepth; uniform float uNear, uFar;
      varying vec2 vUv;
      void main() {
        float d = texture2D(tDepth, vUv).x;
        float z = d * 2.0 - 1.0;
        float lin = (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
        if (d >= 0.99999) lin = 60000.0;
        gl_FragColor = vec4(texture2D(tColor, vUv).rgb, lin);
      }`, { tColor: { value: null }, tDepth: { value: null }, uNear: { value: 0.1 }, uFar: { value: 1000 } });
    this.downMat = passMat(/* glsl */`
      uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThresh; uniform float uFirst;
      varying vec2 vUv;
      vec3 s(vec2 o) { return texture2D(tSrc, vUv + o * uTexel).rgb; }
      void main() {
        vec3 a = s(vec2(-2,-2)), b = s(vec2(0,-2)), c = s(vec2(2,-2));
        vec3 d = s(vec2(-1,-1)), e = s(vec2(1,-1));
        vec3 f = s(vec2(-2,0)), g = s(vec2(0,0)), h = s(vec2(2,0));
        vec3 i = s(vec2(-1,1)), j = s(vec2(1,1));
        vec3 k = s(vec2(-2,2)), l = s(vec2(0,2)), m = s(vec2(2,2));
        vec3 col = g * 0.125 + (a + c + k + m) * 0.03125 + (b + f + h + l) * 0.0625 + (d + e + i + j) * 0.125;
        if (uFirst > 0.5) {
          // max first: on Apple GPUs max(NaN, 0) = 0 while min(NaN, 60) = 60, so a stray NaN pixel stays dark instead of blooming
          col = min(max(col, vec3(0.0)), vec3(60.0));
          float br = max(col.r, max(col.g, col.b));
          float soft = clamp(br - uThresh + 0.5, 0.0, 1.0);
          soft = soft * soft * 0.5;
          float contrib = max(soft, br - uThresh) / max(br, 1e-4);
          col *= contrib;
        }
        gl_FragColor = vec4(col, 1.0);
      }`, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThresh: { value: 1.0 }, uFirst: { value: 0 } });
    this.upMat = passMat(/* glsl */`
      uniform sampler2D tSrc; uniform sampler2D tBase; uniform vec2 uTexel; uniform float uRadius;
      varying vec2 vUv;
      void main() {
        vec2 t = uTexel * uRadius;
        vec3 c = texture2D(tSrc, vUv + vec2(-t.x, -t.y)).rgb + texture2D(tSrc, vUv + vec2(0.0, -t.y)).rgb * 2.0 + texture2D(tSrc, vUv + vec2(t.x, -t.y)).rgb
               + texture2D(tSrc, vUv + vec2(-t.x, 0.0)).rgb * 2.0 + texture2D(tSrc, vUv).rgb * 4.0 + texture2D(tSrc, vUv + vec2(t.x, 0.0)).rgb * 2.0
               + texture2D(tSrc, vUv + vec2(-t.x, t.y)).rgb + texture2D(tSrc, vUv + vec2(0.0, t.y)).rgb * 2.0 + texture2D(tSrc, vUv + vec2(t.x, t.y)).rgb;
        gl_FragColor = vec4(c / 16.0 + texture2D(tBase, vUv).rgb, 1.0);
      }`, { tSrc: { value: null }, tBase: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1 } });
    this.raysMaskMat = passMat(/* glsl */`
      uniform sampler2D tCopy; uniform vec2 uSun; uniform float uAspect; uniform float uFar;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D(tCopy, vUv);
        float sky = smoothstep(uFar * 0.6, uFar * 0.95, c.a);
        vec2 dv = (vUv - uSun) * vec2(uAspect, 1.0);
        float fall = exp(-dot(dv, dv) * 3.5);
        float lum = dot(c.rgb, vec3(0.3, 0.5, 0.2));
        gl_FragColor = vec4(vec3(min(lum, 8.0) * sky * fall + sky * fall * 0.15), 1.0);
      }`, { tCopy: { value: null }, uSun: { value: new THREE.Vector2() }, uAspect: { value: 1 }, uFar: { value: 1000 } });
    this.raysBlurMat = passMat(/* glsl */`
      uniform sampler2D tSrc; uniform vec2 uSun; uniform float uStep;
      varying vec2 vUv;
      void main() {
        vec2 dir = (uSun - vUv) * uStep / 28.0;
        vec2 p = vUv;
        vec3 acc = vec3(0.0);
        float w = 1.0, tw = 0.0;
        float jit = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453);
        p += dir * jit;
        for (int i = 0; i < 28; i++) { acc += texture2D(tSrc, p).rgb * w; tw += w; w *= 0.96; p += dir; }
        gl_FragColor = vec4(acc / tw, 1.0);
      }`, { tSrc: { value: null }, uSun: { value: new THREE.Vector2() }, uStep: { value: 1 } });
    this.compMat = passMat(/* glsl */`
      uniform sampler2D tMain; uniform sampler2D tBloom; uniform sampler2D tRays;
      uniform float uExposure, uBloom, uRays, uSat, uCon, uFade, uVig, uTime, uFlash, uFxaa; uniform vec2 uTexel;
      uniform vec3 uLift, uGain, uRaysCol, uFadeCol;
      varying vec2 vUv;
      vec3 RRTAndODTFit(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
      vec3 aces(vec3 c) {
        const mat3 inM = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
        const mat3 outM = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
        c = inM * c; c = RRTAndODTFit(c); c = outM * c; return clamp(c, 0.0, 1.0);
      }
      vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
      // FXAA (console variant) on HDR input, used when the scene target runs without MSAA
      vec3 fxaa(vec2 uv, vec2 px) {
        vec3 nw = texture2D(tMain, uv + vec2(-1.0, -1.0) * px).rgb, ne = texture2D(tMain, uv + vec2(1.0, -1.0) * px).rgb;
        vec3 sw = texture2D(tMain, uv + vec2(-1.0, 1.0) * px).rgb, se = texture2D(tMain, uv + vec2(1.0, 1.0) * px).rgb;
        vec3 m = texture2D(tMain, uv).rgb;
        const vec3 LW = vec3(0.299, 0.587, 0.114);
        float lnw = dot(nw / (1.0 + nw), LW), lne = dot(ne / (1.0 + ne), LW), lsw = dot(sw / (1.0 + sw), LW), lse = dot(se / (1.0 + se), LW), lm = dot(m / (1.0 + m), LW);
        float lmin = min(lm, min(min(lnw, lne), min(lsw, lse))), lmax = max(lm, max(max(lnw, lne), max(lsw, lse)));
        if (lmax - lmin < 0.03) return m;
        vec2 dir = vec2(-((lnw + lne) - (lsw + lse)), (lnw + lsw) - (lne + lse));
        float red = max((lnw + lne + lsw + lse) * 0.03125, 1.0 / 128.0);
        dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + red), vec2(-8.0), vec2(8.0)) * px;
        vec3 a = 0.5 * (texture2D(tMain, uv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tMain, uv + dir * (2.0 / 3.0 - 0.5)).rgb);
        vec3 b = a * 0.5 + 0.25 * (texture2D(tMain, uv - dir * 0.5).rgb + texture2D(tMain, uv + dir * 0.5).rgb);
        float lb = dot(b / (1.0 + b), LW);
        return (lb < lmin || lb > lmax) ? a : b;
      }
      void main() {
        vec3 c = uFxaa > 0.5 ? fxaa(vUv, uTexel) : texture2D(tMain, vUv).rgb;
        c += texture2D(tBloom, vUv).rgb * uBloom;
        c += texture2D(tRays, vUv).rgb * uRaysCol * uRays;
        c *= uExposure * (1.0 + uFlash * 0.6);
        c = mix(c, uFadeCol, uFade);
        c = aces(c * 1.05);
        c = toSRGB(c);
        // grade (display space)
        c = c * uGain + uLift * (1.0 - c);
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, uSat);
        c = (c - 0.5) * uCon + 0.5;
        vec2 q = vUv - 0.5;
        c *= 1.0 - dot(q, q) * uVig;
        float n = fract(sin(dot(vUv * 1000.0 + uTime, vec2(12.9898, 78.233))) * 43758.5453);
        c += (n - 0.5) / 180.0;
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
      }`, {
      tMain: { value: null }, tBloom: { value: null }, tRays: { value: null },
      uFxaa: { value: 0 }, uTexel: { value: new THREE.Vector2(1, 1) },
      uExposure: { value: 1 }, uBloom: { value: 0.5 }, uRays: { value: 0.5 }, uSat: { value: 1 }, uCon: { value: 1 }, uFade: { value: 0 }, uVig: { value: 0.9 }, uTime: { value: 0 }, uFlash: { value: 0 },
      uLift: { value: new THREE.Vector3() }, uGain: { value: new THREE.Vector3(1, 1, 1) }, uRaysCol: { value: new THREE.Color(1, 0.8, 0.6) }, uFadeCol: { value: new THREE.Color(0.8, 0.8, 0.8) },
    });
    this.w = 4; this.h = 4;
  }
  setSize(w, h) {
    w = Math.max(4, Math.round(w)); h = Math.max(4, Math.round(h));
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.rtMain.setSize(w, h);
    this.rtMain.depthTexture.image.width = w; this.rtMain.depthTexture.image.height = h;
    this.rtCopy.setSize(w, h);
    this.rtRefl.setSize(Math.round(w * 0.42), Math.round(h * 0.42));
    for (const rt of this.rtRays) rt.setSize(Math.round(w / 4), Math.round(h / 4));
    let bw = Math.round(w / 2), bh = Math.round(h / 2);
    for (let i = 0; i < this.bloomDown.length; i++) {
      this.bloomDown[i].setSize(Math.max(2, bw), Math.max(2, bh));
      this.bloomUp[i].setSize(Math.max(2, bw), Math.max(2, bh));
      bw = Math.round(bw / 2); bh = Math.round(bh / 2);
    }
  }
  pass(mat, target) {
    this.quad.material = mat;
    this.r.setRenderTarget(target);
    this.r.render(this.qscene, this.qcam);
  }
  copy(camera) {
    const m = this.copyMat;
    m.uniforms.tColor.value = this.rtMain.texture;
    m.uniforms.tDepth.value = this.rtMain.depthTexture;
    m.uniforms.uNear.value = camera.near; m.uniforms.uFar.value = camera.far;
    this.pass(m, this.rtCopy);
  }
  rays(sunScreen, sunVisible) {
    const m = this.raysMaskMat;
    m.uniforms.tCopy.value = this.rtCopy.texture;
    m.uniforms.uSun.value.copy(sunScreen);
    m.uniforms.uAspect.value = this.w / this.h;
    m.uniforms.uFar.value = 50000;
    this.pass(m, this.rtRays[0]);
    const b = this.raysBlurMat;
    b.uniforms.uSun.value.copy(sunScreen);
    b.uniforms.tSrc.value = this.rtRays[0].texture; b.uniforms.uStep.value = 1.0;
    this.pass(b, this.rtRays[1]);
    b.uniforms.tSrc.value = this.rtRays[1].texture; b.uniforms.uStep.value = 0.35;
    this.pass(b, this.rtRays[0]);
    return this.rtRays[0].texture;
  }
  bloom(thresh) {
    const d = this.downMat;
    let src = this.rtMain.texture, sw = this.w, sh = this.h;
    for (let i = 0; i < this.bloomDown.length; i++) {
      d.uniforms.tSrc.value = src;
      d.uniforms.uTexel.value.set(1 / sw, 1 / sh);
      d.uniforms.uFirst.value = i === 0 ? 1 : 0;
      d.uniforms.uThresh.value = thresh;
      this.pass(d, this.bloomDown[i]);
      src = this.bloomDown[i].texture; sw = this.bloomDown[i].width; sh = this.bloomDown[i].height;
    }
    const u = this.upMat;
    let prev = this.bloomDown[this.bloomDown.length - 1].texture;
    for (let i = this.bloomDown.length - 2; i >= 0; i--) {
      u.uniforms.tSrc.value = prev;
      u.uniforms.tBase.value = this.bloomDown[i].texture;
      const t = this.bloomDown[i + 1];
      u.uniforms.uTexel.value.set(1 / t.width, 1 / t.height);
      u.uniforms.uRadius.value = 1.0;
      this.pass(u, this.bloomUp[i]);
      prev = this.bloomUp[i].texture;
    }
    return prev;
  }
  // MSAA level of the scene target (0 switches the composite to FXAA)
  setSamples(n) {
    if (n === this.samples) return;
    this.samples = n;
    this.rtMain.samples = n;
    this.rtMain.dispose();
    this.compMat.uniforms.uFxaa.value = n === 0 ? 1 : 0;
  }
  composite(opts, raysTex, bloomTex) {
    const m = this.compMat;
    m.uniforms.uTexel.value.set(1 / this.w, 1 / this.h);
    m.uniforms.tMain.value = this.rtMain.texture;
    m.uniforms.tBloom.value = bloomTex;
    m.uniforms.tRays.value = raysTex;
    Object.assign(m.uniforms.uExposure, { value: opts.exposure });
    m.uniforms.uBloom.value = opts.bloom;
    m.uniforms.uRays.value = opts.rays;
    m.uniforms.uSat.value = opts.sat;
    m.uniforms.uCon.value = opts.con;
    m.uniforms.uFade.value = opts.fade;
    m.uniforms.uFlash.value = opts.flash || 0;
    m.uniforms.uTime.value = opts.time % 100;
    m.uniforms.uLift.value.fromArray(opts.lift);
    m.uniforms.uGain.value.fromArray(opts.gain);
    m.uniforms.uRaysCol.value.copy(opts.raysCol);
    m.uniforms.uFadeCol.value.copy(opts.fadeCol);
    this.pass(m, null);
  }
}
