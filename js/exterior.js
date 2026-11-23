import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Reflector } from 'three/addons/objects/Reflector.js';

// ------------------------------------------------------------------ helpers
const SHOP_W = 13.2;
function std(color, rough = 0.8, metal = 0, extra = {}) { return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra }); }
function boxGeo(w, h, d, x, y, z) { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g; }
// box with small chamfered edges (catches highlights instead of knife-sharp CG edges)
function bevGeo(w, h, d, x, y, z, r = 0.006) {
  const rr = Math.max(0.0005, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
  const g = new RoundedBoxGeometry(w, h, d, 1, rr); g.translate(x, y, z); return g;
}
function addBox(parent, mat, x0, x1, y0, y1, z0, z1, opts = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat);
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  if (opts.cast) m.castShadow = true; if (opts.receive !== false) m.receiveShadow = true;
  parent.add(m); return m;
}
function plane(parent, mat, cx, cy, z, w, h, ry = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(cx, cy, z); m.rotation.y = ry; parent.add(m); return m;
}
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function rand(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function roundRectShape(w, h, r) {
  const s = new THREE.Shape(); const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s;
}
function roundRectPath(w, h, r) { const s = roundRectShape(w, h, r); const p = new THREE.Path(); p.curves = s.curves; return p; }
const ni = (g) => (g.index ? g.toNonIndexed() : g);
function merge(gs) { const m = mergeGeometries(gs.map(ni)); if (!m) console.warn('merge failed'); return m; }
// cylinder between two points
const _up = new THREE.Vector3(0, 1, 0);
function cylBetween(a, b, r0, r1 = r0, seg = 8) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b); const d = B.clone().sub(A); const L = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, L, seg, 1); g.translate(0, L / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(_up, d.normalize()); g.applyQuaternion(q); g.translate(A.x, A.y, A.z); return g;
}
function xform(g, x, y, z, ry = 0, s = 1) { const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(_up, ry), new THREE.Vector3(s, s, s)); return g.clone().applyMatrix4(m); }

// equirectangular "street" environment (sky, houses across the road, street lamps) for exterior reflections
function streetEnv(night) {
  const W = 1024, H = 512;
  const t = canvasTex(W, H, (g) => {
    const sky = g.createLinearGradient(0, 0, 0, H / 2);
    if (night) { sky.addColorStop(0, '#010206'); sky.addColorStop(0.72, '#080b13'); sky.addColorStop(1, '#2a221c'); }
    else { sky.addColorStop(0, '#2a66b8'); sky.addColorStop(0.55, '#84aedb'); sky.addColorStop(1, '#dfe7ec'); }
    g.fillStyle = sky; g.fillRect(0, 0, W, H / 2 + 1);
    const gr = g.createLinearGradient(0, H / 2, 0, H);
    if (night) { gr.addColorStop(0, '#17140f'); gr.addColorStop(1, '#050505'); } else { gr.addColorStop(0, '#8e8b84'); gr.addColorStop(1, '#5b5955'); }
    g.fillStyle = gr; g.fillRect(0, H / 2, W, H / 2);
    const O = [6, 2.2, 0.6]; const D = 23; // nominal reflection point, opposite facade plane z
    const uv = (x, y, z) => { const dx = x - O[0], dy = y - O[1], dz = z - O[2]; const az = Math.atan2(dz, dx); const el = Math.atan2(dy, Math.hypot(dx, dz)); return [(az / (2 * Math.PI) + 0.5) * W, H / 2 - el / Math.PI * H]; };
    const quad = (pts, col) => { g.fillStyle = col; g.beginPath(); pts.forEach((p, i) => { const [u, v] = uv(...p); i ? g.lineTo(u, v) : g.moveTo(u, v); }); g.closePath(); g.fill(); };
    // opposite facades (z = D) + our own row (behind, z < 0)
    g.fillStyle = night ? '#0c0c0f' : '#ada392';
    for (let px = W / 2 + 1; px < W; px++) {
      const az = (px / W - 0.5) * 2 * Math.PI; const sz = Math.sin(az); if (sz < 0.02) continue;
      const dist = (D - O[2]) / sz; const el = Math.atan2(19.5 - O[1], dist); g.fillRect(px, H / 2 - el / Math.PI * H, 1, el / Math.PI * H + 1);
    }
    g.fillStyle = night ? '#09090b' : '#9d9483'; g.fillRect(0, H / 2 - 0.42 * H, W / 2, 0.42 * H + 1);
    const r = rand(night ? 77 : 78);
    for (let x = -60; x < 70; x += 2.35) for (let f = 0; f < 5; f++) {
      const y0 = 5.6 + f * 3.3, y1 = y0 + 2.0; const lit = night && r() < 0.16;
      const col = night ? (lit ? `rgba(${200 + r() * 55 | 0},${150 + r() * 50 | 0},${80 + r() * 40 | 0},1)` : '#050608') : (r() < 0.5 ? '#4a5a6c' : '#3a4654');
      quad([[x - 0.55, y0, D], [x + 0.55, y0, D], [x + 0.55, y1, D], [x - 0.55, y1, D]], col);
    }
    for (let x = -60; x < 70; x += 5 + r() * 4) { // ground-floor shops opposite
      const w = 2 + r() * 3; const lit = night ? r() < 0.55 : false;
      const col = night ? (lit ? ['#e8ecf2', '#ffd9a0', '#ff6a50', '#9fd8ff'][r() * 4 | 0] : '#0a0a0c') : '#2b3036';
      quad([[x, 0.4, D], [x + w, 0.4, D], [x + w, 3.0, D], [x, 3.0, D]], col);
    }
    if (night) { // street lamps along both kerbs + car lights
      for (const z of [7.3, 15.5]) for (let x = -45; x < 60; x += 26) {
        const [u, v] = uv(x, 7.4, z); const R = 10; const gg = g.createRadialGradient(u, v, 0, u, v, R);
        gg.addColorStop(0, 'rgba(255,236,200,1)'); gg.addColorStop(0.25, 'rgba(255,200,140,0.6)'); gg.addColorStop(1, 'rgba(255,180,120,0)'); g.fillStyle = gg; g.fillRect(u - R, v - R, 2 * R, 2 * R);
      }
    }
  });
  t.mapping = THREE.EquirectangularReflectionMapping; return t;
}

// ------------------------------------------------------------------ main
export async function buildExterior(ctx) {
  const { scene, tex } = ctx;
  let ext_setVariant = () => {}; let ext_setSpk = () => {}; let ledScale = 1, lastNight = true;
  const look = { neu: false, spk: 'alt' }; const lookHooks = []; const applyLook = () => lookHooks.forEach(fn => fn(look));
  const root = new THREE.Group(); root.name = 'exterior'; scene.add(root);
  const hooks = ctx.modeHooks;

  const font = await new Promise((res, rej) => new FontLoader().load('fonts/rc_bold.json', res, undefined, rej));

  // ---------------- materials
  const M = {
    plaster: std(0xcfc6b6, 0.93),
    plasterTrim: std(0xe2dccf, 0.86),
    neighborL: std(0x9e9a92, 0.93),
    neighborTrim: std(0xb2ada4, 0.88),
    neighborR: std(0xc9bfa9, 0.92),
    anth: std(0x222326, 0.62, 0.25),
    black: std(0x0d0e10, 0.42, 0.35),
    fascia: std(0x07080a, 0.32, 0.3),
    alu: std(0xb4b8bc, 0.32, 0.85),
    aluDark: std(0x2a2c30, 0.4, 0.7),
    winWhite: std(0xeceae4, 0.5),
    stone: std(0x6e6a64, 0.85),
    curb: std(0x9a9890, 0.78),
    asphalt: std(0x2b2c2e, 0.95),
    awning: new THREE.MeshStandardMaterial({ color: 0x8e1a28, roughness: 0.9, side: THREE.DoubleSide }),
    metalBlack: std(0x161616, 0.45, 0.65),
    woodLight: std(0xa07446, 0.62),
    redFrame: std(0xb0201f, 0.45, 0.1),
    zinc: std(0x7c8184, 0.5, 0.75),
  };
  // clear glass: only the reflection is added on top of whatever is behind (correct for clear float glass)
  const glassRefl = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.04, metalness: 0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  glassRefl.userData.envK = 2.2; glassRefl.userData.envDay = 7; // by day the street outshines the shop: reflections dominate
  const glassReflDS = glassRefl.clone(); glassReflDS.side = THREE.DoubleSide; glassReflDS.userData.envK = 2.2; glassReflDS.userData.envDay = 7;
  const plTex = tex('facade_plaster.jpg', { repeat: [0.5, 0.5] });
  if (plTex) { for (const k of ['plaster', 'plasterTrim', 'neighborL', 'neighborTrim', 'neighborR']) { M[k].map = plTex; M[k].needsUpdate = true; } M.plaster.color.set(0xe6dfd5); M.plasterTrim.color.set(0xfaf6ee); M.neighborL.color.set(0xb9b5ae); M.neighborTrim.color.set(0xcdc8c0); M.neighborR.color.set(0xf0e8d8); }

  // emissive registry: [material, nightIntensity, dayIntensity]
  const emis = [];
  function emissive(mat, night, day) { emis.push([mat, night, day]); return mat; }
  function glowMat(r, g, b, night, day) { // unlit HDR colour for neon / LEDs
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b) });
    m.userData.base = new THREE.Color(r, g, b); m.userData.n = night; m.userData.d = day; emis.push([m, null, null]); return m;
  }
  function glowReg(m, n, d) { m.userData.base = new THREE.Color(1, 1, 1); m.userData.n = n; m.userData.d = d; emis.push([m, null, null]); return m; }
  hooks.push((night) => {
    for (const [m, n, d] of emis) {
      if (n === null) m.color.copy(m.userData.base).multiplyScalar(night ? m.userData.n : m.userData.d);
      else m.emissiveIntensity = night ? n : d;
    }
  });

  // ---------------- facade grime (world-space multiply map: soot over the shop, run-off under sills, mottling)
  const GX0 = -11, GW = 35, GH = 20;
  const AX = []; for (let i = -1; i < 11; i++) AX.push(2.09 + i * 2.3); // own house window axes (photo: regular 2.3 m grid)
  const AXL = [-1.55, -3.95, -6.35, -8.75];                               // left neighbour
  const grimeTex = canvasTex(1024, 512, (g, w, h) => {
    const X = (x) => (x - GX0) / GW * w, Y = (y) => (GH - y) / GH * h;
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    const r = rand(99);
    for (let i = 0; i < 260; i++) { const x = r() * w, y = r() * h, rad = 8 + r() * 60; const gg = g.createRadialGradient(x, y, 0, x, y, rad); const a = 0.02 + r() * 0.04; gg.addColorStop(0, `rgba(70,60,50,${a})`); gg.addColorStop(1, 'rgba(70,60,50,0)'); g.fillStyle = gg; g.fillRect(x - rad, y - rad, 2 * rad, 2 * rad); }
    // soot band above the shop sign and under the eaves
    let gg = g.createLinearGradient(0, Y(7.2), 0, Y(5.0)); gg.addColorStop(0, 'rgba(40,35,30,0)'); gg.addColorStop(1, 'rgba(40,35,30,0.24)'); g.fillStyle = gg; g.fillRect(0, Y(7.2), w, Y(5.0) - Y(7.2));
    gg = g.createLinearGradient(0, Y(19.2), 0, Y(17.4)); gg.addColorStop(0, 'rgba(40,35,30,0.35)'); gg.addColorStop(1, 'rgba(40,35,30,0)'); g.fillStyle = gg; g.fillRect(0, Y(19.2), w, Y(17.4) - Y(19.2));
    // splash zone at pavement level (neighbour shops)
    gg = g.createLinearGradient(0, Y(0.7), 0, Y(0)); gg.addColorStop(0, 'rgba(30,28,25,0)'); gg.addColorStop(1, 'rgba(30,28,25,0.45)'); g.fillStyle = gg; g.fillRect(0, Y(0.7), w, Y(0) - Y(0.7));
    // run-off streaks under every sill
    const streak = (cx, ytop, len, wd, a) => { const gs = g.createLinearGradient(0, Y(ytop), 0, Y(ytop - len)); gs.addColorStop(0, `rgba(55,48,40,${a})`); gs.addColorStop(1, 'rgba(55,48,40,0)'); g.fillStyle = gs; g.fillRect(X(cx - wd / 2), Y(ytop), X(cx + wd / 2) - X(cx - wd / 2), Y(ytop - len) - Y(ytop)); };
    for (let f = 0; f < 4; f++) for (const ax of [...AX, ...AXL]) {
      const sill = (ax > 0.3 ? 5.30 : 5.55) + f * 3.4 + 0.65;
      streak(ax, sill, 0.9 + r() * 1.2, 1.1, 0.07 + r() * 0.07);
      for (const s of [-0.5, 0.5]) streak(ax + s + (r() - 0.5) * 0.1, sill, 1.5 + r() * 1.5, 0.08, 0.18 + r() * 0.12);
    }
    streak(0.3, 18.9, 13.8, 0.35, 0.18); // along the downpipe
  }, false);
  grimeTex.minFilter = THREE.LinearMipmapLinearFilter; grimeTex.generateMipmaps = true;
  function addGrime(mat) {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.grimeMap = { value: grimeTex }; sh.uniforms.grimeRect = { value: new THREE.Vector3(GX0, GW, GH) };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGW;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D grimeMap; uniform vec3 grimeRect; varying vec3 vGW;')
        .replace('#include <map_fragment>', '#include <map_fragment>\n{ vec2 guv = vec2((vGW.x - grimeRect.x) / grimeRect.y, vGW.y / grimeRect.z); diffuseColor.rgb *= texture2D(grimeMap, guv).r; }');
    };
    mat.customProgramCacheKey = () => 'grime';
  }
  for (const k of ['plaster', 'plasterTrim', 'neighborL', 'neighborTrim']) addGrime(M[k]);

  // ================================================================ WET GROUND REFLECTIONS (night)
  const wet = { value: 0.0 };
  const reflMatrix = { value: new THREE.Matrix4() };
  const reflScale = ctx.isMobile ? 0.35 : 0.5;
  const reflector = new Reflector(new THREE.PlaneGeometry(60, 40), {
    textureWidth: Math.round(innerWidth * reflScale), textureHeight: Math.round(innerHeight * reflScale), clipBias: 0.02, multisample: 0,
  });
  reflector.rotation.x = -Math.PI / 2; reflector.position.set(6, 0.0, 10); reflector.updateMatrixWorld(true);
  reflector.material.colorWrite = false; reflector.material.depthWrite = false; reflector.renderOrder = -10;
  const rt = reflector.getRenderTarget(); rt.texture.generateMipmaps = true; rt.texture.minFilter = THREE.LinearMipmapLinearFilter;
  const reflTex = { value: rt.texture };
  const origBR = reflector.onBeforeRender; let lastFrame = -1; let wetMeshes = null; const invW = new THREE.Matrix4();
  reflector.onBeforeRender = function (r, sc, cam) {
    const f = ctx.frameId ? ctx.frameId() : 0; if (f === lastFrame) return; lastFrame = f;
    if (!wetMeshes) { wetMeshes = []; root.traverse(o => { if (o.isMesh && o.material && o.material.userData && o.material.userData.wet) wetMeshes.push(o); }); }
    for (const o of wetMeshes) o.visible = false;
    origBR.call(this, r, sc, cam);
    for (const o of wetMeshes) o.visible = true;
    invW.copy(reflector.matrixWorld).invert();
    reflMatrix.value.copy(reflector.material.uniforms.textureMatrix.value).multiply(invW);
  };
  root.add(reflector);
  ctx.resizeHooks = ctx.resizeHooks || [];
  ctx.resizeHooks.push((w, h) => rt.setSize(Math.round(w * reflScale), Math.round(h * reflScale)));
  const maskTex = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h); const r = rand(21);
    for (let i = 0; i < 55; i++) { const x = r() * w, y = r() * h, rad = 16 + r() * 80; const grd = g.createRadialGradient(x, y, 0, x, y, rad); grd.addColorStop(0, `rgba(255,255,255,${0.3 + r() * 0.5})`); grd.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = grd; g.save(); g.translate(x, y); g.scale(1 + r(), 0.6 + r() * 0.6); g.translate(-x, -y); g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill(); g.restore(); }
  }, false);
  maskTex.wrapS = maskTex.wrapT = THREE.RepeatWrapping;
  function wetPatch(mat, base = 0.35) {
    mat.userData.wet = true;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.reflTex = reflTex; sh.uniforms.reflMatrix = reflMatrix; sh.uniforms.wet = wet; sh.uniforms.wetMask = { value: maskTex }; sh.uniforms.wetBase = { value: base };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform mat4 reflMatrix;\nvarying vec4 vRefl;\nvarying vec3 vWPosR;')
        .replace('#include <fog_vertex>', '#include <fog_vertex>\n{ vec4 wpR = modelMatrix * vec4(transformed, 1.0); vRefl = reflMatrix * wpR; vWPosR = wpR.xyz; }');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D reflTex; uniform sampler2D wetMask; uniform float wet; uniform float wetBase; varying vec4 vRefl; varying vec3 vWPosR;')
        .replace('#include <opaque_fragment>', `
        if (wet > 0.001) {
          vec2 ruv = vRefl.xy / vRefl.w;
          float m = texture2D(wetMask, vWPosR.xz * 0.09).r;
          float puddle = smoothstep(0.4, 0.8, m);
          float NdV = clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0);
          float fres = 0.04 + 0.96 * pow(1.0 - NdV, 5.0);
          float lod = mix(4.2, 1.6, puddle);
          float streak = mix(0.026, 0.008, puddle);
          vec3 rc = vec3(0.0);
          for (int i = -3; i <= 3; i++) rc += textureLod(reflTex, ruv + vec2(0.0, float(i) * streak), lod).rgb;
          rc /= 7.0;
          float k = wet * mix(wetBase, 0.85, puddle) * mix(0.3, 1.0, fres);
          outgoingLight = outgoingLight * (1.0 - 0.25 * wet * (0.4 + puddle)) + rc * k;
        }
        #include <opaque_fragment>`);
    };
    mat.customProgramCacheKey = () => 'wet' + base;
  }
  hooks.push((night) => { wet.value = night ? 0.55 : 0.0; reflector.visible = night; });

  // ================================================================ GROUND
  const slabTex = tex('sidewalk_slab.jpg', { repeat: [1, 1] });
  const mosTex = tex('sidewalk_mosaic.jpg', { repeat: [1, 1] });
  const sideMat = std(0x8f8d88, 0.9); const mosMat = std(0x77746e, 0.95);
  if (slabTex) { sideMat.map = slabTex; sideMat.color.set(0xffffff); }
  if (mosTex) { mosMat.map = mosTex; mosMat.color.set(0xffffff); }
  wetPatch(sideMat, 0.1); wetPatch(mosMat, 0.08); wetPatch(M.asphalt, 0.3); sideMat.roughness = 0.85; sideMat.color.set(0xaeaca7); mosMat.color.set(0xd8d4cc); M.asphalt.roughness = 0.82;
  {
    const X0 = -12, X1 = 25;
    const g = new THREE.PlaneGeometry(X1 - X0, 6.58); g.rotateX(-Math.PI / 2); g.translate((X0 + X1) / 2, 0, 0.42 + 3.29);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (X1 - X0) / 2, uv.getY(i) * 6.58 / 2);
    const m = new THREE.Mesh(g, sideMat); m.receiveShadow = true; root.add(m);
    // mosaic strips: along the house and along the kerb
    const mg = [];
    for (const [z0, z1] of [[0, 0.42], [7.0, 7.55]]) {
      const g2 = new THREE.PlaneGeometry(X1 - X0, z1 - z0); g2.rotateX(-Math.PI / 2); g2.translate((X0 + X1) / 2, 0.002, (z0 + z1) / 2);
      const uv2 = g2.attributes.uv; for (let i = 0; i < uv2.count; i++) uv2.setXY(i, uv2.getX(i) * (X1 - X0), uv2.getY(i) * (z1 - z0));
      mg.push(g2);
    }
    // gutter (Rinne) of setts in the road along the kerb
    { const g3 = new THREE.PlaneGeometry(X1 - X0, 0.32); g3.rotateX(-Math.PI / 2); g3.translate((X0 + X1) / 2, -0.138, 7.96); const u3 = g3.attributes.uv; for (let i = 0; i < u3.count; i++) u3.setXY(i, u3.getX(i) * (X1 - X0) * 1.3, u3.getY(i) * 0.32 * 1.3); mg.push(g3); }
    const mm = new THREE.Mesh(merge(mg), mosMat); mm.receiveShadow = true; root.add(mm);
    // kerb stone with chamfered top edge (profile extruded along x)
    { const s = new THREE.Shape(); s.moveTo(7.55, 0.0); s.lineTo(7.74, 0.0); s.lineTo(7.8, -0.05); s.lineTo(7.8, -0.16); s.lineTo(7.55, -0.16); s.lineTo(7.55, 0);
      const eg = new THREE.ExtrudeGeometry(s, { depth: X1 - X0, bevelEnabled: false }); eg.rotateY(-Math.PI / 2); eg.translate(X1, 0, 0); /* shape x -> world z, extrusion -> world x */ const k = new THREE.Mesh(eg, M.curb); k.receiveShadow = true; k.castShadow = true; root.add(k); }
    // road
    const road = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0, 30), M.asphalt); road.rotation.x = -Math.PI / 2; road.position.set((X0 + X1) / 2, -0.14, 7.8 + 15); road.receiveShadow = true; root.add(road);
    const asTex = canvasTex(256, 256, (g, w, h) => { const r = rand(7); g.fillStyle = '#3a3b3d'; g.fillRect(0, 0, w, h); for (let i = 0; i < 6000; i++) { const v = 40 + r() * 50 | 0; g.fillStyle = `rgb(${v},${v},${v + 2})`; g.fillRect(r() * w, r() * h, 1.5, 1.5); } for (let i = 0; i < 30; i++) { g.strokeStyle = `rgba(20,20,22,${0.2 + r() * 0.3})`; g.lineWidth = 1; g.beginPath(); let x = r() * w, y = r() * h; g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 30; y += (r() - 0.5) * 30; g.lineTo(x, y); } g.stroke(); } });
    asTex.wrapS = asTex.wrapT = THREE.RepeatWrapping; asTex.repeat.set(18, 15); M.asphalt.map = asTex; M.asphalt.color.set(0x9a9a9a);
    // markings: parking-lane edge + dashed centre line (one merged mesh)
    const dash = std(0xd9d6cc, 0.7); const dg = [];
    for (let x = X0; x < X1; x += 6) dg.push(boxGeo(3, 0.004, 0.12, x + 1.5, -0.137, 14.26));
    dg.push(boxGeo(X1 - X0, 0.004, 0.12, (X0 + X1) / 2, -0.137, 10.06));
    root.add(new THREE.Mesh(merge(dg), dash));
    // cast-iron gratings: gully in the gutter, small vents on the house strip, door mat at D3
    const iron = std(0x1d1e1f, 0.55, 0.6);
    const grTex = canvasTex(128, 64, (g, w, h) => { g.fillStyle = '#5a5b5c'; g.fillRect(0, 0, w, h); g.fillStyle = '#060606'; for (let x = 8; x < w - 6; x += 9) g.fillRect(x, 7, 5, h - 14); });
    const grMat = std(0xffffff, 0.5, 0.6, { map: grTex });
    const gg = [];
    for (const [x, z, w, d] of [[-3.2, 7.96, 0.5, 0.3], [16.8, 7.96, 0.5, 0.3], [7.15, 0.24, 0.32, 0.18], [10.6, 0.22, 0.3, 0.16], [11.0, 0.22, 0.3, 0.16]]) { const p = new THREE.PlaneGeometry(w, d); p.rotateX(-Math.PI / 2); p.translate(x, z > 7 ? -0.136 : 0.004, z); gg.push(p); }
    root.add(new THREE.Mesh(merge(gg), grMat));
    { const mat = new THREE.Mesh(new RoundedBoxGeometry(0.78, 0.012, 0.5, 1, 0.005), std(0x1b1c1e, 0.95)); mat.position.set(7.25, 0.006, 0.36); mat.receiveShadow = true; root.add(mat); void iron; }
    // basement light prisms under the Bertolino window (row of glass prism tiles)
    {
      const kt = canvasTex(1024, 128, (g, w, h) => {
        g.fillStyle = '#6f6d68'; g.fillRect(0, 0, w, h); const r = rand(5);
        const n = 22; const cw = w / n;
        for (let j = 0; j < 2; j++) for (let i = 0; i < n; i++) {
          const x = i * cw + 4, y = j * h / 2 + 4, ww = cw - 8, hh = h / 2 - 8;
          const v = j ? 85 + r() * 60 : 55 + r() * 40; g.fillStyle = `rgb(${v * 1.02 | 0},${v | 0},${v * 0.92 | 0})`; g.fillRect(x, y, ww, hh);
          const gg2 = g.createLinearGradient(x, y, x + ww, y + hh); gg2.addColorStop(0, 'rgba(255,255,255,0.35)'); gg2.addColorStop(0.5, 'rgba(255,255,255,0)'); gg2.addColorStop(1, 'rgba(0,0,0,0.25)'); g.fillStyle = gg2; g.fillRect(x, y, ww, hh);
        }
      });
      const p = new THREE.PlaneGeometry(2.95, 0.3); p.rotateX(-Math.PI / 2); p.translate(9.9, 0.004, 0.24);
      const km = new THREE.Mesh(p, std(0xb0b0b0, 0.25, 0.0, { map: kt })); km.receiveShadow = true; root.add(km);
    }
  }

  // ================================================================ FACADE
  const EG_TOP = 5.30; // first floor level (own house)
  const WALL_SPLIT = 5.06; // ground-floor wall ends at the sign top, upper facade starts there
  const openings = [
    { id: 'W1', x0: 0.30, x1: 1.30, y0: 0.25, y1: 2.35, frame: 'alu' },
    { id: 'D1', x0: 1.30, x1: 2.10, y0: 0.00, y1: 2.35, frame: 'aluL', door: true },
    { id: 'W2', x0: 2.10, x1: 4.10, y0: 0.45, y1: 2.35, frame: 'alu' },
    { id: 'D2', x0: 4.10, x1: 6.10, y0: 0.00, y1: 2.35, frame: 'alu', door: true },
    { id: 'W3', x0: 6.10, x1: 6.75, y0: 0.45, y1: 2.35, frame: 'alu' },
    { id: 'D3', x0: 6.75, x1: 7.75, y0: 0.00, y1: 2.35, frame: 'alu', door: true },
    { id: 'B',  x0: 8.40, x1: 11.40, y0: 1.00, y1: 2.35, frame: 'black' },
  ];
  const nb = [
    { x0: -8.6, x1: -5.2, y0: 0.55, y1: 2.6 }, { x0: -4.4, x1: -3.3, y0: 0.0, y1: 2.6 }, { x0: -2.6, x1: -0.6, y0: 0.55, y1: 2.6 },
    { x0: 14.0, x1: 15.0, y0: 0.0, y1: 2.6 }, { x0: 15.6, x1: 18.6, y0: 0.55, y1: 2.6 }, { x0: 19.6, x1: 23.6, y0: 0.55, y1: 2.6 },
  ];
  const FLOOR_H = 3.4, NFLOORS = 4, TOP = EG_TOP + NFLOORS * FLOOR_H; // 18.9
  const WIN_W = 1.02;
  const X0 = -11, X1 = 24, XB = 0.30; // XB: boundary to the left neighbour (downpipe)
  const EG_TOP_L = 5.55;              // left neighbour: slightly different storey heights

  // ground-floor wall with storefront holes
  {
    const s = new THREE.Shape(); s.moveTo(X0, 0); s.lineTo(X1, 0); s.lineTo(X1, WALL_SPLIT); s.lineTo(X0, WALL_SPLIT); s.lineTo(X0, 0);
    for (const o of [...openings, ...nb]) { const h = new THREE.Path(); h.moveTo(o.x0, o.y0); h.lineTo(o.x0, o.y1); h.lineTo(o.x1, o.y1); h.lineTo(o.x1, o.y0); h.lineTo(o.x0, o.y0); s.holes.push(h); }
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.45, bevelEnabled: false }); g.translate(0, 0, -0.45);
    const m = new THREE.Mesh(g, [M.plaster, M.plaster]); m.receiveShadow = true; m.castShadow = true; root.add(m);
    const cg = [];
    for (const [a, b] of [[-0.0, 0.30], [7.75, 8.40], [11.40, 13.2]]) cg.push(bevGeo(b - a, 2.35, 0.045, (a + b) / 2, 2.35 / 2, 0.0025, 0.008));
    cg.push(bevGeo(13.2, 0.71, 0.05, 6.6, 2.705, 0.005, 0.008)); // header band
    cg.push(bevGeo(3.0, 0.10, 0.07, 9.9, 0.05, 0.015, 0.01));     // plinth under bertolino panel
    const cm = new THREE.Mesh(merge(cg), M.anth); cm.receiveShadow = true; root.add(cm);
  }
  // upper facades: own house (x > XB) and left neighbour (x < XB), windows as holes
  const upper = [];
  function facadeShape(x0, x1, y0, y1, wins) {
    const s = new THREE.Shape(); s.moveTo(x0, y0); s.lineTo(x1, y0); s.lineTo(x1, y1); s.lineTo(x0, y1); s.lineTo(x0, y0);
    for (const w of wins) { const h = new THREE.Path(); h.moveTo(w.x0, w.y0); h.lineTo(w.x0, w.y1); h.lineTo(w.x1, w.y1); h.lineTo(w.x1, w.y0); h.lineTo(w.x0, w.y0); s.holes.push(h); }
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.45, bevelEnabled: false }); g.translate(0, 0, -0.45); return g;
  }
  {
    const own = [], left = [];
    for (let f = 0; f < NFLOORS; f++) {
      const fy = EG_TOP + f * FLOOR_H;
      for (const ax of AX) {
        if (ax - WIN_W / 2 < XB + 0.25 || ax + WIN_W / 2 > X1 - 0.2) continue;
        const french = f === 0 && (Math.abs(ax - 6.69) < 0.1 || Math.abs(ax - 8.99) < 0.1);
        const w = { x0: ax - WIN_W / 2, x1: ax + WIN_W / 2, y0: french ? 5.22 : fy + 0.65, y1: fy + 2.85, french, floor: f, ax, own: true };
        own.push(w); upper.push(w);
      }
      const fyl = EG_TOP_L + f * FLOOR_H;
      for (const ax of AXL) { const w = { x0: ax - 0.55, x1: ax + 0.55, y0: fyl + 0.85, y1: fyl + 2.85, french: false, floor: f, ax, own: false }; left.push(w); upper.push(w); }
    }
    const mo = new THREE.Mesh(facadeShape(XB, X1, WALL_SPLIT, TOP, own), [M.plaster, M.plaster]); mo.receiveShadow = true; mo.castShadow = true; root.add(mo);
    const ml = new THREE.Mesh(facadeShape(X0, XB, WALL_SPLIT, TOP + 0.6, left), [M.neighborL, M.neighborL]); ml.receiveShadow = true; ml.castShadow = true; root.add(ml);
  }
  // far neighbour buildings (cheap, textured)
  {
    const nTex = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#b9b2a6'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#d8d1c3'; g.fillRect(0, 236, w, 20);
      g.fillStyle = '#e8e2d6'; g.fillRect(70, 40, 116, 170);
      g.fillStyle = '#191b20'; g.fillRect(80, 48, 96, 156);
      g.fillStyle = '#e8e2d6'; g.fillRect(124, 48, 8, 156); g.fillRect(80, 92, 96, 7);
    });
    nTex.wrapS = nTex.wrapT = THREE.RepeatWrapping;
    for (const [a, b, top, col] of [[-45, X0, TOP + 1.2, 0xd0c8bc], [X1, 55, TOP - 1.0, 0xe0d8c6]]) {
      const t = nTex.clone(); t.needsUpdate = true; t.repeat.set((b - a) / 2.3, (top - EG_TOP) / FLOOR_H);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(b - a, top - EG_TOP), std(col, 0.92, 0, { map: t }));
      m.position.set((a + b) / 2, (EG_TOP + top) / 2, 0.0); root.add(m);
      const eg = new THREE.Mesh(new THREE.PlaneGeometry(b - a, EG_TOP), std(0x55575a, 0.7)); eg.position.set((a + b) / 2, EG_TOP / 2, 0.0); root.add(eg);
      addBox(root, M.plasterTrim, a, b, top, top + 0.4, 0, 0.3);
    }
  }
  // cornices + window dressings (merged, one mesh per house)
  {
    const trim = [], trimL = [];
    const band = (arr, xa, xb, y, h, d) => arr.push(bevGeo(xb - xa, h, d, (xa + xb) / 2, y + h / 2, d / 2, 0.012));
    band(trim, XB, X1, 5.06, 0.16, 0.10);                      // ledge directly on the shop sign (french windows stand on it)
    for (let f = 1; f < NFLOORS; f++) band(trim, XB, X1, EG_TOP + f * FLOOR_H - 0.06, 0.14, 0.07);
    band(trim, XB, X1, TOP - 0.05, 0.25, 0.12); band(trim, XB, X1, TOP + 0.2, 0.35, 0.42); band(trim, XB, X1, TOP + 0.55, 0.12, 0.55);
    band(trimL, X0, XB, 5.06, 0.40, 0.08);
    for (let f = 1; f < NFLOORS; f++) band(trimL, X0, XB, EG_TOP_L + f * FLOOR_H - 0.1, 0.18, 0.06);
    band(trimL, X0, XB, TOP + 0.3, 0.3, 0.3);
    for (const w of upper) {
      const T = w.own ? trim : trimL; const fw = w.own ? 0.14 : 0.1;
      T.push(bevGeo(fw, w.y1 - w.y0 + fw, 0.05, w.x0 - fw / 2, (w.y0 + w.y1) / 2 + fw / 2, 0.025));
      T.push(bevGeo(fw, w.y1 - w.y0 + fw, 0.05, w.x1 + fw / 2, (w.y0 + w.y1) / 2 + fw / 2, 0.025));
      T.push(bevGeo(w.x1 - w.x0 + 2 * fw, fw, 0.05, (w.x0 + w.x1) / 2, w.y1 + fw / 2, 0.025));
      if (!w.french) T.push(bevGeo(w.x1 - w.x0 + 0.3, 0.06, 0.12, (w.x0 + w.x1) / 2, w.y0 - 0.03, 0.06, 0.01));
      if (w.own && w.floor === 0) { // 1st floor: pilaster strips + hood
        for (const sx of [w.x0 - fw - 0.07, w.x1 + fw + 0.07]) T.push(bevGeo(0.1, w.y1 - w.y0 + 0.25, 0.035, sx, (w.y0 + w.y1) / 2 + 0.12, 0.018));
        T.push(bevGeo(w.x1 - w.x0 + 0.6, 0.1, 0.15, (w.x0 + w.x1) / 2, w.y1 + fw + 0.05, 0.075, 0.015));
        T.push(bevGeo(w.x1 - w.x0 + 0.45, 0.05, 0.1, (w.x0 + w.x1) / 2, w.y1 + fw + 0.125, 0.05));
      }
      // reveal (window jambs, slightly darker because of the trim material)
    }
    const m = new THREE.Mesh(merge(trim), M.plasterTrim); m.castShadow = true; m.receiveShadow = true; root.add(m);
    const ml = new THREE.Mesh(merge(trimL), M.neighborTrim); ml.castShadow = true; ml.receiveShadow = true; root.add(ml);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(X1 - X0, 0.1, 6), std(0x4a3a35, 0.9));
    roof.position.set((X0 + X1) / 2, TOP + 0.9 + 2.0, -2.6); roof.rotation.x = 0.62; root.add(roof);
    // downpipe on the house boundary (runs down behind the shop sign)
    const pg = [cylBetween([XB, 5.0, 0.075], [XB, TOP + 0.3, 0.075], 0.05, 0.05, 12)];
    for (let y = 6.2; y < TOP; y += 2.0) pg.push(boxGeo(0.13, 0.035, 0.08, XB, y, 0.04));
    pg.push(cylBetween([XB, TOP + 0.3, 0.075], [XB, TOP + 0.55, 0.35], 0.05, 0.05, 12));
    const pm = new THREE.Mesh(merge(pg), M.zinc); pm.castShadow = true; root.add(pm);
  }
  // upper windows: white frames, reflective glass, curtains, dark rooms
  {
    const curtTex = tex('curtain.jpg');
    const curtMat = std(0xb9b4aa, 0.95, 0, curtTex ? { map: curtTex, color: 0xa8a399 } : {});
    const curtLit = std(0xa8a399, 0.9, 0, { emissive: 0xffb860, emissiveIntensity: 0.0, ...(curtTex ? { map: curtTex, emissiveMap: curtTex } : {}) });
    emissive(curtLit, 0.35, 0.0);
    const drapeMat = std(0x5d4f45, 0.95);
    const frames = []; const glassG = []; const curtG = []; const curtLitG = []; const drapes = []; const rail = []; const panels = [];
    const r = rand(3);
    for (const w of upper) {
      const z = -0.16, t = 0.06, W = w.x1 - w.x0, H = w.y1 - w.y0;
      const cx = (w.x0 + w.x1) / 2;
      frames.push(bevGeo(t, H, 0.08, w.x0 + t / 2, (w.y0 + w.y1) / 2, z, 0.008)); frames.push(bevGeo(t, H, 0.08, w.x1 - t / 2, (w.y0 + w.y1) / 2, z, 0.008));
      frames.push(bevGeo(W, t, 0.08, cx, w.y1 - t / 2, z, 0.008)); frames.push(bevGeo(W, t, 0.08, cx, w.y0 + t / 2, z, 0.008));
      const tr = w.y1 - 0.62; // transom (Oberlicht)
      frames.push(bevGeo(W, t * 1.1, 0.075, cx, tr, z + 0.005, 0.008));
      frames.push(bevGeo(t * 0.9, tr - w.y0, 0.075, cx, (w.y0 + tr) / 2, z + 0.005, 0.008));
      frames.push(bevGeo(t * 0.7, w.y1 - tr, 0.06, cx, (tr + w.y1) / 2, z, 0.006));
      const gy0 = w.french ? w.y0 + 0.55 : w.y0;
      if (!w.french) { const bar = gy0 + (tr - gy0) * 0.5; frames.push(bevGeo(W, 0.035, 0.05, cx, bar, z, 0.005)); }
      else { // panelled lower door leaves + low white railing in front
        panels.push(bevGeo(W - 0.04, 0.55, 0.05, cx, w.y0 + 0.275, z - 0.005, 0.006));
        for (const sx of [-1, 1]) for (let k = -1; k <= 1; k++) panels.push(bevGeo(0.05, 0.4, 0.012, cx + sx * W / 4 + k * 0.12, w.y0 + 0.275, z + 0.026, 0.004));
        const ry0 = w.y0 + 0.52, ry1 = w.y0 + 0.9;
        rail.push(bevGeo(W + 0.1, 0.04, 0.04, cx, ry1, 0.07, 0.008)); rail.push(bevGeo(W + 0.1, 0.03, 0.03, cx, ry0, 0.07, 0.006));
        for (const sx of [-1, 1]) rail.push(bevGeo(0.04, ry1 - ry0 + 0.04, 0.04, cx + sx * (W / 2 + 0.03), (ry0 + ry1) / 2, 0.07, 0.008));
        for (let i = 1; i < 10; i++) rail.push(boxGeo(0.016, ry1 - ry0, 0.016, w.x0 - 0.05 + i * (W + 0.1) / 10, (ry0 + ry1) / 2, 0.07));
      }
      glassG.push((() => { const g = new THREE.PlaneGeometry(W - 0.04, w.y1 - gy0 - 0.04); g.translate(cx, (gy0 + w.y1) / 2, z - 0.01); return g; })());
      const lit = w.floor > 0 && r() < 0.14; const kind = r();
      const ch = (w.y1 - gy0) * 0.92, cyy = (w.y1 + gy0) / 2;
      if (lit || kind < (w.floor === 0 ? 0.8 : 0.5)) { const cg = new THREE.PlaneGeometry(W * 0.94, ch); cg.translate(cx, cyy, z - 0.1); (lit ? curtLitG : curtG).push(cg); }
      else if (kind < 0.8) { for (const sx of [-1, 1]) { const dg = new THREE.PlaneGeometry(W * 0.26, ch); dg.translate(cx + sx * W * 0.34, cyy, z - 0.09); drapes.push(dg); } }
    }
    root.add(new THREE.Mesh(merge(frames), M.winWhite));
    root.add(new THREE.Mesh(merge([...panels, ...rail]), M.winWhite));
    const gm = new THREE.Mesh(merge(glassG), glassRefl.clone()); gm.material.userData.envK = 1.6; gm.material.userData.envDay = 5; gm.renderOrder = 3; root.add(gm);
    if (curtG.length) root.add(new THREE.Mesh(merge(curtG), curtMat));
    if (curtLitG.length) root.add(new THREE.Mesh(merge(curtLitG), curtLit));
    if (drapes.length) root.add(new THREE.Mesh(merge(drapes), drapeMat));
    // dark rooms behind the windows (so we don't see through)
    const back = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0, TOP - WALL_SPLIT), std(0x14120f, 1));
    back.position.set((X0 + X1) / 2, (WALL_SPLIT + TOP) / 2, -0.62); root.add(back);
  }
  // neighbour storefronts (dark glass + shutters)
  {
    const shutterTex = canvasTex(64, 256, (g, w, h) => { for (let y = 0; y < h; y += 8) { g.fillStyle = '#8d9196'; g.fillRect(0, y, w, 6); g.fillStyle = '#5d6166'; g.fillRect(0, y + 6, w, 2); } });
    shutterTex.wrapS = shutterTex.wrapT = THREE.RepeatWrapping;
    const shMat = std(0xffffff, 0.6, 0.5, { map: shutterTex });
    const nbFrame = [], nbGlass = [];
    for (const o of nb) {
      const W = o.x1 - o.x0, H = o.y1 - o.y0;
      nbFrame.push(boxGeo(W, 0.05, 0.1, (o.x0 + o.x1) / 2, o.y1 - 0.025, -0.15));
      const half = o.x0 < 0 ? 0.62 : 0.4;
      const t = shutterTex.clone(); t.needsUpdate = true; t.repeat.set(W / 0.5, H * half / 0.5);
      const sm = shMat.clone(); sm.map = t;
      plane(root, sm, (o.x0 + o.x1) / 2, o.y1 - H * half / 2, -0.08, W, H * half);
      const gg = new THREE.PlaneGeometry(W, H - H * half); gg.translate((o.x0 + o.x1) / 2, (o.y0 + o.y1 - H * half) / 2, -0.12); nbGlass.push(gg);
    }
    root.add(new THREE.Mesh(merge(nbFrame), M.aluDark));
    root.add(new THREE.Mesh(merge(nbGlass), glassRefl));
    addBox(root, std(0x3a3d42, 0.6, 0.3), -9, -0.02, 2.9, 4.3, 0, 0.08);
    addBox(root, std(0xe9e6df, 0.6), 13.25, 24, 3.0, 4.1, 0, 0.06);
    // dark neighbour shop interiors + solid party walls (so nobody looks into our shop through the neighbours' glass)
    const nbIn = std(0x16171a, 0.95);
    addBox(root, nbIn, -11, -0.32, 0, 3.2, -1.7, -1.6); addBox(root, nbIn, -11, -0.32, 3.1, 3.2, -1.6, -0.45);
    addBox(root, nbIn, 13.25, 24, 0, 3.2, -1.7, -1.6); addBox(root, nbIn, 13.25, 24, 3.1, 3.2, -1.6, -0.45);
    addBox(root, nbIn, -0.32, 0.28, 0, 5.3, -12, -0.45);
    addBox(root, nbIn, 12.02, 13.25, 0, 5.3, -12, -0.45);
  }

  // ================================================================ STOREFRONT
  const store = new THREE.Group(); store.name = 'storefront'; root.add(store);
  {
    const ft = 0.055; // frame width
    const frameGeo = { alu: [], aluL: [], black: [] };
    const glassGeo = [];
    const zf = -0.10;
    for (const o of openings) {
      const fg = frameGeo[o.frame];
      const W = o.x1 - o.x0, H = o.y1 - o.y0, cx = (o.x0 + o.x1) / 2, cy = (o.y0 + o.y1) / 2;
      fg.push(bevGeo(ft, H, 0.08, o.x0 + ft / 2, cy, zf)); fg.push(bevGeo(ft, H, 0.08, o.x1 - ft / 2, cy, zf));
      fg.push(bevGeo(W, ft, 0.08, cx, o.y1 - ft / 2, zf)); if (!o.door) fg.push(bevGeo(W, ft * 1.4, 0.08, cx, o.y0 + ft * 0.7, zf));
      if (o.id === 'D3') continue; // open door, leaf added separately
      if (o.id === 'D2') { // double door: 2 leaves + transom
        for (const [a, b] of [[o.x0, cx], [cx, o.x1]]) {
          const lw = b - a; const lx = (a + b) / 2;
          fg.push(bevGeo(0.07, 2.12, 0.06, a + 0.035 + ft, 1.06, zf + 0.02)); fg.push(bevGeo(0.07, 2.12, 0.06, b - 0.035 - ft, 1.06, zf + 0.02));
          fg.push(bevGeo(lw - 2 * ft, 0.07, 0.06, lx, 2.12, zf + 0.02)); fg.push(bevGeo(lw - 2 * ft, 0.12, 0.06, lx, 0.06, zf + 0.02));
        }
        fg.push(bevGeo(W, 0.05, 0.08, cx, 2.17, zf));
        for (const hx of [cx - 0.12, cx + 0.12]) { fg.push(cylBetween([hx, 0.6, zf + 0.09], [hx, 1.5, zf + 0.09], 0.014, 0.014, 8)); for (const hy of [0.65, 1.45]) fg.push(boxGeo(0.02, 0.02, 0.08, hx, hy, zf + 0.05)); }
      }
      if (o.id === 'D1') {
        fg.push(bevGeo(W, 0.14, 0.06, cx, 0.07, zf + 0.02)); fg.push(bevGeo(W, 0.05, 0.08, cx, 2.12, zf));
        fg.push(cylBetween([o.x1 - 0.13, 0.75, zf + 0.09], [o.x1 - 0.13, 1.35, zf + 0.09], 0.013, 0.013, 8));
      }
      const g = new THREE.PlaneGeometry(W - 2 * ft, H - 2 * ft); g.translate(cx, cy, zf); glassGeo.push(g);
    }
    store.add(new THREE.Mesh(merge(frameGeo.alu), M.alu));
    store.add(new THREE.Mesh(merge(frameGeo.aluL), std(0xe3e4e2, 0.38, 0.6)));
    store.add(new THREE.Mesh(merge(frameGeo.black), M.black));
    const gl = new THREE.Mesh(merge(glassGeo), glassRefl); gl.renderOrder = 5; store.add(gl);
    // D3 open leaf (hinged on right side, swung inwards)
    const leaf = new THREE.Group(); leaf.position.set(7.70, 0, -0.14); leaf.rotation.y = -1.45; store.add(leaf);
    leaf.add(new THREE.Mesh(merge([bevGeo(0.95, 0.06, 0.06, -0.475, 0.03, 0), bevGeo(0.95, 0.08, 0.06, -0.475, 2.26, 0), bevGeo(0.06, 2.3, 0.06, -0.92, 1.15, 0), bevGeo(0.06, 2.3, 0.06, -0.03, 1.15, 0)]), M.alu));
    plane(leaf, glassReflDS, -0.475, 1.15, 0, 0.83, 2.16).renderOrder = 5;
    // thresholds
    store.add(new THREE.Mesh(merge(openings.filter(o => o.door).map(o => bevGeo(o.x1 - o.x0, 0.02, 0.2, (o.x0 + o.x1) / 2, 0.01, -0.1, 0.004))), M.alu));

    // --- graphics on/behind glass
    const tPlane = (name, cx, cy, z, w, h, opts = {}) => {
      const t = tex(name); if (!t) return null;
      const m = new THREE.MeshStandardMaterial({ map: t, transparent: !!opts.alpha, alphaTest: opts.alpha ? 0.02 : 0, roughness: opts.rough ?? 0.8, side: opts.side ?? THREE.FrontSide, depthWrite: !opts.alpha });
      if (opts.emissive) { m.emissive = new THREE.Color(0xffffff); m.emissiveMap = t; emissive(m, opts.emissive[0], opts.emissive[1]); }
      const p = plane(store, m, cx, cy, z, w, h); if (opts.alpha) p.renderOrder = 6; return p;
    };
    tPlane('w1_pasta.png', 0.80, 1.30, -0.085, 0.90, 1.98, { alpha: true, emissive: [0.15, 0.0] });
    tPlane('w3_list.png', 6.425, 1.40, -0.085, 0.56, 1.72, { alpha: true, emissive: [0.12, 0.0] });
    tPlane('d2_posters.png', 5.62, 1.22, -0.075, 0.80, 1.40, { alpha: true });
    tPlane('w2_sign.png', 2.72, 2.16, -0.13, 1.12, 0.27, { alpha: true });
    tPlane('pier_stickers.jpg', 0.15, 1.12, 0.028, 0.30, 2.24);
    const openT = tex('open_neon.png');
    if (openT) { const m = glowReg(new THREE.MeshBasicMaterial({ map: openT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), 3.2, 1.4); const p = plane(store, m, 3.55, 2.17, -0.14, 0.46, 0.21); p.renderOrder = 7; }
    const d1T = tex('d1_neon.png');
    if (d1T) { const m = glowReg(new THREE.MeshBasicMaterial({ map: d1T, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), 2.6, 1.2); const p = plane(store, m, 1.72, 1.76, -0.13, 0.36, 0.27); p.renderOrder = 7; }

    // --- Bertolino panel + boards
    const panelT = tex('panel_bertolino.jpg');
    const panelM0 = panelT ? std(0xffffff, 0.85, 0, { map: panelT }) : std(0x232527, 0.85);
    const panelMesh = plane(store, panelM0, 9.9, 0.55, 0.052, 3.0, 0.9);
    const panelNT = tex('plan_panel_bertolino.jpg');
    if (panelNT) { const panelM1 = std(0xffffff, 0.5, 0, { map: panelNT }); lookHooks.push((lk) => { panelMesh.material = lk.neu ? panelM1 : panelM0; }); }
    const board = (name, x0, x1, y0, y1, z, frameMat, fallback) => {
      const t = tex(name); const W = x1 - x0, H = y1 - y0;
      const g = new THREE.Group(); g.position.set((x0 + x1) / 2, (y0 + y1) / 2, z); store.add(g);
      const fm = new THREE.Mesh(bevGeo(W, H, 0.025, 0, 0, -0.0125, 0.006), frameMat); fm.castShadow = true; fm.receiveShadow = true; g.add(fm);
      plane(g, t ? std(0xffffff, 0.55, 0, { map: t }) : std(fallback, 0.6), 0, 0, 0.0015, W, H);
      return g;
    };
    board('board_pasta_white.jpg', 7.58, 8.30, 1.74, 2.62, 0.06, M.black, 0xf2f2ee);
    { const g = board('board_ciao_black.jpg', 7.66, 8.28, 0.0, 1.39, 0.0, std(0x7a5534, 0.6), 0x1d1f1f); g.position.z = 0.17; g.rotation.x = -0.1; g.position.y = 0.70; }
    board('board_hallo_white.jpg', 11.55, 12.64, 0.25, 2.49, 0.05, M.black, 0xf2f2ee);
    // small LED flood light on top of the HALLO board (visible in fenster.jpg)
    {
      const lg = [bevGeo(0.13, 0.08, 0.06, 0, 0, 0, 0.01), cylBetween([0, -0.02, -0.03], [0, -0.02, -0.12], 0.012, 0.012, 6)];
      const lamp = new THREE.Mesh(merge(lg), M.metalBlack); lamp.position.set(12.25, 2.58, 0.2); lamp.rotation.x = 0.7; store.add(lamp);
      const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.05), glowMat(1, 0.97, 0.92, 8, 0.6)); lens.position.set(12.25, 2.545, 0.228); lens.rotation.x = Math.PI / 2 + 0.7; store.add(lens);
      const L = new THREE.SpotLight(0xfff2e0, 0, 4, 0.75, 0.85, 1.6); L.position.set(12.25, 2.52, 0.26); L.target.position.set(12.1, 1.1, 0.05); root.add(L, L.target);
      hooks.push((night) => { L.intensity = night ? 2.5 : 0; });
    }
  }

  // ================================================================ FASCIA (Blende)
  const fasc = new THREE.Group(); fasc.name = 'fascia'; root.add(fasc); let stripMesh = null;
  const FZ = 0.12;
  {
    const fm = new THREE.Mesh(merge([bevGeo(SHOP_W, 1.99, FZ, SHOP_W / 2, (3.06 + 5.05) / 2, FZ / 2, 0.012)]), M.fascia); fm.receiveShadow = true; fasc.add(fm);
    fasc.add(new THREE.Mesh(bevGeo(SHOP_W + 0.02, 0.05, FZ + 0.03, SHOP_W / 2, 5.035, (FZ + 0.03) / 2, 0.008), M.aluDark)); // top cap
    // product strip
    const st = tex('strip_products.jpg');
    const stMat = std(0x777777, 0.6, 0, st ? { map: st, color: 0xffffff, emissive: 0xffffff, emissiveMap: st, emissiveIntensity: 0 } : {});
    if (st) emissive(stMat, 0.32, 0.0);
    stripMesh = plane(fasc, stMat, (0.26 + 8.35) / 2, 3.24, FZ + 0.002, 8.09, 0.36);
  }

  // ---- 3D letters with neon outline
  const signIst = new THREE.Group(); signIst.name = 'blende-vorher'; fasc.add(signIst);
  const signNeu = new THREE.Group(); signNeu.name = 'blende-nachher'; fasc.add(signNeu); signNeu.visible = false;
  function letters({ text, x0, x1, baseY, capH, z, depth, faceMat, sideMat, neon, tubeR, glow, parent = fasc }) {
    const size = capH * 1000 / font.data.capHeight;
    const shapes = font.generateShapes(text, size);
    const geo = new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.003, bevelSegments: 1, curveSegments: 8 });
    geo.computeBoundingBox();
    const bb = geo.boundingBox; const sx = (x1 - x0) / (bb.max.x - bb.min.x);
    const tf = new THREE.Matrix4().makeTranslation(x0 - bb.min.x * sx, baseY, z).multiply(new THREE.Matrix4().makeScale(sx, 1, 1));
    geo.applyMatrix4(tf); geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, [faceMat, sideMat]); mesh.castShadow = true; parent.add(mesh);
    const tubes = []; const contours = [];
    for (const sh of shapes) {
      const paths = [sh.getPoints(10), ...sh.holes.map(h => h.getPoints(10))];
      for (const pts of paths) {
        const p3 = pts.map(p => new THREE.Vector3(p.x, p.y, 0).applyMatrix4(tf).setZ(z + depth + tubeR * 0.6));
        if (p3.length > 2 && p3[0].distanceTo(p3[p3.length - 1]) < 1e-4) p3.pop();
        const path = new THREE.CurvePath();
        for (let i = 0; i < p3.length; i++) path.add(new THREE.LineCurve3(p3[i], p3[(i + 1) % p3.length]));
        tubes.push(new THREE.TubeGeometry(path, Math.max(24, p3.length * 4), tubeR, 6, true));
        contours.push(p3);
      }
    }
    const neonMesh = new THREE.Mesh(merge(tubes), neon); parent.add(neonMesh);
    if (glow) { // light spill of the tubes on the black fascia (soft, two radii)
      const pad = glow.pad; const gx0 = x0 - pad, gx1 = x1 + pad, gy0 = baseY - pad, gy1 = baseY + capH * 1.2 + pad;
      const PX = Math.min(140, 2048 / (gx1 - gx0)); const W = Math.round((gx1 - gx0) * PX), H = Math.round((gy1 - gy0) * PX);
      const t = canvasTex(W, H, (g) => {
        g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.lineJoin = 'round';
        const strokeAll = () => { for (const c of contours) { g.beginPath(); c.forEach((p, i) => { const X = (p.x - gx0) * PX, Y = (gy1 - p.y) * PX; i ? g.lineTo(X, Y) : g.moveTo(X, Y); }); g.closePath(); g.stroke(); } };
        // blurred strokes only (shadow-offset trick works on every mobile browser, unlike ctx.filter)
        const blurStroke = (lw, blur, alpha) => { g.save(); g.strokeStyle = glow.css; g.shadowColor = glow.css; g.shadowBlur = blur; g.shadowOffsetX = 20000; g.globalAlpha = alpha; g.lineWidth = lw; g.translate(-20000, 0); strokeAll(); g.restore(); };
        blurStroke(glow.lw * 2.5, glow.blur, 0.55); blurStroke(glow.lw, glow.blur * 0.35, 0.9);
      });
      const m = glowReg(new THREE.MeshBasicMaterial({ map: t, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), glow.n, glow.d);
      const p = plane(parent, m, (gx0 + gx1) / 2, (gy0 + gy1) / 2, FZ + 0.004, gx1 - gx0, gy1 - gy0); p.renderOrder = 4;
    }
    return { mesh, contours };
  }
  const redNeon = glowMat(1.0, 0.03, 0.022, 2.1, 1.2);
  const whiteNeon = glowMat(1.0, 0.97, 0.95, 1.8, 1.0);
  const spkFace = std(0x3c070c, 0.5, 0.15, { emissive: 0xff1a10, emissiveIntensity: 0 }); emissive(spkFace, 0.035, 0.0);
  letters({ text: 'SPÄTKAUF', x0: 2.39, x1: 8.34, baseY: 3.55, capH: 1.06, z: FZ, depth: 0.10,
    faceMat: spkFace, sideMat: std(0x26080b, 0.55, 0.3), neon: redNeon, tubeR: 0.022,
    glow: { pad: 0.35, css: '#ff1608', lw: 7, blur: 22, n: 0.32, d: 0.0 }, parent: signIst });
  const weFace = std(0x3a0812, 0.5, 0.1, { emissive: 0xffffff, emissiveIntensity: 0 }); emissive(weFace, 0.01, 0.0);
  letters({ text: 'WEINE', x0: 0.48, x1: 2.10, baseY: 3.93, capH: 0.48, z: FZ, depth: 0.07,
    faceMat: weFace, sideMat: std(0x220407, 0.6, 0.2), neon: whiteNeon, tubeR: 0.011,
    glow: { pad: 0.2, css: '#fff1ec', lw: 4, blur: 14, n: 0.2, d: 0.0 }, parent: signIst });
  ctx.dims.push({ a: [2.39, 3.45, 0.3], b: [8.34, 3.45, 0.3], label: '<b>Schriftzug</b><br>ca. 5,95 m', v: 'ist' });

  // ---- LED light box: front cover missing, bare LED modules on a white back plate inside an alu rim
  {
    const W = 1.45, H = 0.95, cx = (9.71 + 11.16) / 2, cy = (3.35 + 4.30) / 2, D = 0.13, R = 0.12;
    const rimShape = roundRectShape(W, H, R); rimShape.holes.push(roundRectPath(W - 0.05, H - 0.05, R - 0.025));
    const rim = new THREE.Mesh(new THREE.ExtrudeGeometry(rimShape, { depth: D, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1, curveSegments: 10 }), std(0xd7dbe0, 0.3, 0.85));
    rim.position.set(cx, cy, FZ); signIst.add(rim);
    const ledTex = canvasTex(1024, 672, (g, w, h) => {
      g.fillStyle = '#3a3e44'; g.fillRect(0, 0, w, h);
      const r = rand(11); const rows = 9, cols = 7;
      g.strokeStyle = '#1a1c20'; g.lineWidth = 3;
      for (let j = 0; j < rows; j++) { const y = 40 + j * (h - 80) / (rows - 1); g.beginPath(); g.moveTo(20, y + 18); for (let i = 0; i <= 20; i++) g.lineTo(20 + i * (w - 40) / 20, y + 18 + Math.sin(i * 1.7 + j) * 4); g.stroke(); }
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const x = 70 + i * (w - 140) / (cols - 1) + (r() - 0.5) * 14, y = 40 + j * (h - 80) / (rows - 1) + (r() - 0.5) * 6;
        g.fillStyle = '#e9ecef'; g.fillRect(x - 40, y - 11, 80, 22); // module carrier
        for (let k = -1; k <= 1; k++) { const gg = g.createRadialGradient(x + k * 24, y, 1, x + k * 24, y, 14); gg.addColorStop(0, '#ffffff'); gg.addColorStop(0.5, '#ffffff'); gg.addColorStop(1, 'rgba(255,255,255,0.0)'); g.fillStyle = gg; g.fillRect(x + k * 24 - 14, y - 14, 28, 28); }
      }
      g.fillStyle = '#16181b'; g.fillRect(w * 0.47, h * 0.36, 90, 22); // power supply
      g.strokeStyle = '#121212'; g.lineWidth = 4; g.beginPath(); g.moveTo(w * 0.55, h * 0.4); g.bezierCurveTo(w * 0.53, h * 0.65, w * 0.6, h * 0.8, w * 0.57, h); g.stroke();
    });
    const bp = new THREE.ShapeGeometry(roundRectShape(W - 0.05, H - 0.05, R - 0.025));
    { const uv = bp.attributes.uv, pos = bp.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + (W - 0.05) / 2) / (W - 0.05), (pos.getY(i) + (H - 0.05) / 2) / (H - 0.05)); }
    const plateTex = canvasTex(512, 336, (g, w, h) => {
      g.fillStyle = '#c4c8cc'; g.fillRect(0, 0, w, h); const rows = 9, cols = 7; const r = rand(11);
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const x = (70 + i * (1024 - 140) / (cols - 1) + (r() - 0.5) * 14) / 2, y = (40 + j * (672 - 80) / (rows - 1) + (r() - 0.5) * 6) / 2; g.fillStyle = '#eceeef'; g.fillRect(x - 20, y - 5.5, 40, 11); g.fillStyle = '#fbfbf6'; for (let k = -1; k <= 1; k++) g.fillRect(x + k * 12 - 4, y - 4, 8, 8); }
      g.fillStyle = '#1c1e21'; g.fillRect(w * 0.47, h * 0.36, 45, 11);
    });
    const plateMat = std(0xffffff, 0.45, 0.2, { map: plateTex, emissive: 0xffffff, emissiveMap: ledTex, emissiveIntensity: 0 }); emissive(plateMat, 2.4, 0.5);
    const face = new THREE.Mesh(bp, plateMat);
    face.position.set(cx, cy, FZ + 0.012); signIst.add(face);
    // LED strip running round the inside of the rim (bright outline in the photo)
    const ringS = roundRectShape(W - 0.055, H - 0.055, R - 0.028); ringS.holes.push(roundRectPath(W - 0.085, H - 0.085, R - 0.043));
    const ring = new THREE.Mesh(new THREE.ShapeGeometry(ringS, 10), glowMat(1, 1, 1, 3.5, 1.2)); ring.position.set(cx, cy, FZ + D - 0.01); signIst.add(ring);
    // spill of the bare LEDs on the black fascia
    const halo = canvasTex(256, 256, (g) => { const grd = g.createRadialGradient(128, 128, 30, 128, 128, 128); grd.addColorStop(0, 'rgba(205,220,255,0.75)'); grd.addColorStop(0.35, 'rgba(150,175,235,0.22)'); grd.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = grd; g.fillRect(0, 0, 256, 256); });
    const hm = glowReg(new THREE.MeshBasicMaterial({ map: halo, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), 0.5, 0.0);
    plane(signIst, hm, cx, cy, FZ + 0.005, 4.4, 2.6).renderOrder = 4;
    ctx.dims.push({ a: [9.71, 4.42, 0.3], b: [11.16, 4.42, 0.3], label: '<b>Leuchtkasten</b><br>ca. 1,45 × 0,95 m', v: 'ist' });
  }

  // ================================================================ NACHHER: neue Blende (Plan Kunde 23.11.2026)
  // WEINE weg · SPÄTKAUF nach links · rechts daneben rundes Nightshop-Coffee-Logo (weiß leuchtend auf Schwarz) · Leuchtkasten mit Bertolino-Logo C2
  const NEU = { spk0: 0.62, spk1: 6.57, logoCx: 7.85, logoCy: 4.22, logoR: 0.75, boxCx: 10.65, boxCy: 4.05 };
  {
    // Spätkauf-Logo: 'alt' = bisheriger roter Neon-Schriftzug, a/b/c = neue Vorschläge (Kunde wählt)
    const spk = { alt: new THREE.Group(), a: new THREE.Group(), b: new THREE.Group(), c: new THREE.Group() };
    Object.values(spk).forEach(g => signNeu.add(g));
    letters({ text: 'SPÄTKAUF', x0: NEU.spk0, x1: NEU.spk1, baseY: 3.55, capH: 1.06, z: FZ, depth: 0.10,
      faceMat: spkFace, sideMat: std(0x26080b, 0.55, 0.3), neon: redNeon, tubeR: 0.022,
      glow: { pad: 0.35, css: '#ff1608', lw: 7, blur: 22, n: 0.32, d: 0.0 }, parent: spk.alt });
    const LW = NEU.spk1 - NEU.spk0, LH = 1.50, LCX = (NEU.spk0 + NEU.spk1) / 2, LCY = 3.45 + LH / 2;
    const spkCfg = { a: { n: 1.25, d: 0.25, g: 0.55, depth: 0.05 }, b: { n: 1.7, d: 0.35, g: 0.75, depth: 0.02 }, c: { n: 0.55, d: 0.12, g: 0.35, depth: 0.09 } };
    for (const k of ['a', 'b', 'c']) {
      const t = tex(`plan_spk_${k}.png`), tg = tex(`plan_spk_${k}_glow.png`); const cfg = spkCfg[k];
      if (!t) continue;
      if (k !== 'b') { // Buchstaben/Band haben Tiefe: dunkle Rückseite leicht versetzt
        const back = new THREE.Mesh(new THREE.PlaneGeometry(LW, LH), new THREE.MeshStandardMaterial({ color: 0x0a0a0a, map: t, alphaTest: 0.35, transparent: false, roughness: 0.6 }));
        back.material.color.set(k === 'c' ? 0x6b5a14 : 0x1a1a1a); back.position.set(LCX + 0.006, LCY - 0.008, FZ + 0.004); spk[k].add(back);
      }
      const m = new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0, transparent: true, alphaTest: 0.02, roughness: 0.3, depthWrite: false });
      emissive(m, cfg.n, cfg.d);
      const pl = plane(spk[k], m, LCX, LCY, FZ + cfg.depth, LW, LH); pl.renderOrder = 5;
      if (tg) { const gm = glowReg(new THREE.MeshBasicMaterial({ map: tg, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), cfg.g, 0.0); plane(spk[k], gm, LCX, LCY, FZ + 0.003, LW * 1.02, LH * 1.04).renderOrder = 4; }
    }
    ext_setSpk = (k) => { Object.entries(spk).forEach(([kk, g]) => g.visible = kk === k); look.spk = k; applyLook(); ctx.requestRender && ctx.requestRender(); };
    ext_setSpk('alt');
    ctx.dims.push({ a: [NEU.spk0, 3.45, 0.3], b: [NEU.spk1, 3.45, 0.3], label: '<b>Schriftzug</b><br>ca. 5,95 m', v: 'neu' });
    // round sign: black acrylic face, white lines lit (LED backlight behind opal-white line film)
    const R = NEU.logoR, D = 0.09;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, D, 96, 1), std(0x0b0b0d, 0.35, 0.5));
    body.rotation.x = Math.PI / 2; body.position.set(NEU.logoCx, NEU.logoCy, FZ + D / 2); signNeu.add(body);
    const rimG = new THREE.TorusGeometry(R - 0.004, 0.009, 8, 128); const rim = new THREE.Mesh(rimG, std(0x2c2e31, 0.3, 0.8)); rim.position.set(NEU.logoCx, NEU.logoCy, FZ + D); signNeu.add(rim);
    const lt = tex('plan_nightshop_sign.jpg');
    const faceM = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25, metalness: 0.0, map: lt || null, emissive: 0xffffff, emissiveMap: lt || null, emissiveIntensity: 0 });
    emissive(faceM, 1.15, 0.25);
    const face = new THREE.Mesh(new THREE.CircleGeometry(R - 0.012, 96), faceM); face.position.set(NEU.logoCx, NEU.logoCy, FZ + D + 0.001); signNeu.add(face);
    const halo = canvasTex(256, 256, (g) => { const grd = g.createRadialGradient(128, 128, 70, 128, 128, 128); grd.addColorStop(0, 'rgba(255,255,255,0.0)'); grd.addColorStop(0.62, 'rgba(235,240,255,0.16)'); grd.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = grd; g.fillRect(0, 0, 256, 256); });
    const hm = glowReg(new THREE.MeshBasicMaterial({ map: halo, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), 0.35, 0.0);
    plane(signNeu, hm, NEU.logoCx, NEU.logoCy, FZ + 0.004, R * 2.9, R * 2.9).renderOrder = 4;
    ctx.dims.push({ a: [NEU.logoCx - R, NEU.logoCy - R - 0.08, 0.3], b: [NEU.logoCx + R, NEU.logoCy - R - 0.08, 0.3], label: '<b>Logo Nightshop</b><br>Ø ca. 1,50 m', v: 'neu' });
    // Bertolino light box: same housing, closed printed acrylic front (logo C2 on yellow rays)
    const W = 2.70, H = 1.86, BD = 0.14, BR = 0.14;
    const housing = new THREE.Mesh(new THREE.ExtrudeGeometry(roundRectShape(W, H, BR), { depth: BD, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1, curveSegments: 10 }), std(0xd7dbe0, 0.3, 0.85));
    housing.position.set(NEU.boxCx, NEU.boxCy, FZ); signNeu.add(housing);
    const bt = tex('plan_box_bertolino.jpg');
    const fg = new THREE.ShapeGeometry(roundRectShape(W - 0.05, H - 0.05, BR - 0.025), 10);
    { const uv = fg.attributes.uv, pos = fg.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + (W - 0.05) / 2) / (W - 0.05), (pos.getY(i) + (H - 0.05) / 2) / (H - 0.05)); }
    const bm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2, map: bt || null, emissive: 0xffffff, emissiveMap: bt || null, emissiveIntensity: 0 });
    emissive(bm, 0.32, 0.1);
    const bf = new THREE.Mesh(fg, bm); bf.position.set(NEU.boxCx, NEU.boxCy, FZ + BD + 0.005); signNeu.add(bf);
    const bh = canvasTex(256, 256, (g) => { const grd = g.createRadialGradient(128, 128, 40, 128, 128, 128); grd.addColorStop(0, 'rgba(255,240,160,0.22)'); grd.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = grd; g.fillRect(0, 0, 256, 256); });
    const bhm = glowReg(new THREE.MeshBasicMaterial({ map: bh, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), 0.3, 0.0);
    plane(signNeu, bhm, NEU.boxCx, NEU.boxCy, FZ + 0.005, 4.4, 3.0).renderOrder = 4;
    ctx.dims.push({ a: [9.30, 5.12, 0.3], b: [12.00, 5.12, 0.3], label: '<b>Leuchtkasten Bertolino</b><br>ca. 2,70 × 1,85 m · Logo Ø 1,70 m', v: 'neu' });
  }
  ext_setVariant = (neu) => { if (stripMesh) stripMesh.visible = !neu; signIst.visible = !neu; signNeu.visible = !!neu; ledScale = neu ? 0.15 : 1; if (typeof ledL !== 'undefined') ledL.intensity = (lastNight ? 1.2 : 0) * ledScale; look.neu = !!neu; applyLook(); };

  ctx.dims.push({ a: [0, 5.2, 0.3], b: [SHOP_W, 5.2, 0.3], label: '<b>Blende gesamt</b><br>ca. 13,2 × 2,0 m' });
  ctx.dims.push({ a: [SHOP_W + 0.25, 3.06, 0.2], b: [SHOP_W + 0.25, 5.05, 0.2], label: 'Höhe Blende<br>ca. 2,0 m', n: [1, 0, 0] });

  // ---- projecting sign (Nasenschild)
  {
    const t = tex('nasenschild.png');
    const ns = new THREE.Group(); ns.position.set(0.06, (3.74 + 4.99) / 2, FZ + 0.08 + 0.85 / 2); fasc.add(ns);
    const W = 0.85, H = 1.25, D = 0.16;
    const faceMat = t ? new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.9, roughness: 0.4 }) : std(0xd8287a, 0.5, 0, { emissive: 0xd8287a, emissiveIntensity: 0.6 });
    emissive(faceMat, t ? 0.9 : 0.6, 0.15);
    const side = std(0xdedede, 0.4, 0.6);
    const box = new THREE.Mesh(new THREE.BoxGeometry(D, H, W), [faceMat, faceMat, side, side, side, side]);
    ns.add(box);
    const nsCfg = { a: [0.95, 0.2], b: [1.05, 0.2], c: [0.8, 0.25] }; const nsM = {};
    for (const k of ['a', 'b', 'c']) { const tk = tex(`plan_ns_${k}.jpg`); if (tk) nsM[k] = emissive(new THREE.MeshStandardMaterial({ map: tk, emissive: 0xffffff, emissiveMap: tk, emissiveIntensity: 0, roughness: 0.35 }), ...nsCfg[k]); }
    lookHooks.push((lk) => { const m = (lk.neu && nsM[lk.spk]) || faceMat; box.material[0] = m; box.material[1] = m; });
    ns.add(new THREE.Mesh(merge([bevGeo(0.06, 0.06, 0.1, 0, H / 2 + 0.03, -W / 2), bevGeo(0.06, 0.06, 0.1, 0, -H / 2 - 0.03, -W / 2), bevGeo(0.03, 0.03, W, 0, H / 2 + 0.03, 0)]), M.alu));
    ctx.dims.push({ a: [0.2, 3.74, FZ + 0.08], b: [0.2, 3.74, FZ + 0.93], label: 'Nasenschild<br>ca. 0,85 × 1,25 m', n: [1, 0, 0] });
  }

  // ================================================================ AWNING (folding-arm awning, two 6.6 m units)
  // geometry checked against fassade.jpg: valance hides the top of the shop windows, OPEN sign just visible below it
  const AW = { yTop: 3.01, zTop: FZ + 0.06, yFront: 2.45, zFront: 1.38, val: 0.25 };
  {
    const aw = new THREE.Group(); aw.name = 'markise'; root.add(aw);
    const { yTop, zTop, yFront, zFront, val } = AW;
    const fabTex = canvasTex(2048, 256, (c, w, h) => {
      const r = rand(5);
      c.fillStyle = '#8a1a27'; c.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x++) { const v = (r() - 0.5) * 16; c.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 180 : 0},${v > 0 ? 180 : 0},${Math.abs(v) / 255})`; c.fillRect(x, 0, 1, h); }
      const px = w / SHOP_W;
      for (let x = 1.2; x < SHOP_W; x += 1.2) { c.fillStyle = 'rgba(40,0,8,0.35)'; c.fillRect(x * px - 1, 0, 2, h); c.fillStyle = 'rgba(255,160,160,0.08)'; c.fillRect(x * px + 1, 0, 2, h); }
      c.fillStyle = 'rgba(15,0,4,0.7)'; c.fillRect(6.6 * px - 3, 0, 6, h); // gap between the two units
      for (let i = 0; i < 70; i++) { const x = r() * w, len = h * (0.15 + r() * 0.5); const gg = c.createLinearGradient(0, 0, 0, len); gg.addColorStop(0, `rgba(30,10,10,${0.08 + r() * 0.12})`); gg.addColorStop(1, 'rgba(30,10,10,0)'); c.fillStyle = gg; c.fillRect(x, 0, 3 + r() * 10, len); }
      const gg = c.createLinearGradient(0, 0, 0, h); gg.addColorStop(0, 'rgba(0,0,0,0.12)'); gg.addColorStop(0.15, 'rgba(0,0,0,0)'); c.fillStyle = gg; c.fillRect(0, 0, w, h);
    });
    M.awning.map = fabTex; M.awning.color.set(0xffffff);
    // fabric: v = 0 at the front bar, 1 at the cassette; slight belly between bar and cassette
    const g = new THREE.PlaneGeometry(SHOP_W, 1, 66, 10);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + SHOP_W / 2; const v = pos.getY(i) + 0.5; const k = 1 - v;
      const z = zTop + (zFront - zTop) * k; const y = yTop + (yFront - yTop) * k - Math.sin(k * Math.PI) * 0.045 * (0.75 + 0.25 * Math.sin(x * 0.9));
      pos.setXYZ(i, x, y, z);
    }
    g.computeVertexNormals();
    const fab = new THREE.Mesh(g, M.awning); fab.castShadow = true; fab.receiveShadow = true; aw.add(fab);
    // light of SPÄTKAUF neon / WEINE / LED box on the upper side of the fabric: strongest at the wall, fading to the front bar
    const mkGlowT = (segs) => canvasTex(1024, 64, (c, w, h) => {
      const px = w / SHOP_W; c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
      const seg = (x0, x1, col, a) => { const gx = c.createLinearGradient(x0 * px, 0, x1 * px, 0); gx.addColorStop(0, `rgba(${col},0)`); gx.addColorStop(0.15, `rgba(${col},${a})`); gx.addColorStop(0.85, `rgba(${col},${a})`); gx.addColorStop(1, `rgba(${col},0)`); c.fillStyle = gx; c.fillRect(x0 * px, 0, (x1 - x0) * px, h); };
      segs.forEach(sg => seg(...sg));
      c.globalCompositeOperation = 'multiply'; const gv = c.createLinearGradient(0, 0, 0, h); gv.addColorStop(0, '#ffffff'); gv.addColorStop(0.45, '#7a7a7a'); gv.addColorStop(1, '#262626'); c.fillStyle = gv; c.fillRect(0, 0, w, h);
    });
    const glowT = mkGlowT([[0.0, 2.4, '255,200,205', 0.35], [1.8, 9.0, '255,36,24', 1.0], [8.6, 12.4, '205,220,255', 0.75]]);
    const tail = [[6.9, 8.8, '235,240,255', 0.45], [9.3, 12.0, '255,230,140', 0.45]];
    const glowNeu = {
      alt: mkGlowT([[0.2, 7.0, '255,36,24', 1.0], ...tail]),
      a: mkGlowT([[0.2, 7.0, '255,250,245', 0.7], [0.3, 1.9, '255,40,40', 0.6], ...tail]),
      b: mkGlowT([[0.6, 6.9, '255,60,130', 0.9], ...tail]),
      c: mkGlowT([[0.3, 6.9, '255,220,90', 0.6], ...tail]),
    };
    const gGeo = g.clone(); { const p = gGeo.attributes.position, n = gGeo.attributes.normal; for (let i = 0; i < p.count; i++) { const sgn = n.getY(i) > 0 ? 1 : -1; p.setXYZ(i, p.getX(i) + n.getX(i) * 0.006 * sgn, p.getY(i) + n.getY(i) * 0.006 * sgn, p.getZ(i) + n.getZ(i) * 0.006 * sgn); } }
    const gMat = glowReg(new THREE.MeshBasicMaterial({ map: glowT, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), 0.55, 0.0);
    lookHooks.push((lk) => { gMat.map = lk.neu ? glowNeu[lk.spk] : glowT; gMat.needsUpdate = true; });
    // only the upper side gets the glow: pick the side whose normal points up
    gMat.side = (g.attributes.normal.getY(0) > 0) ? THREE.FrontSide : THREE.BackSide;
    const gm = new THREE.Mesh(gGeo, gMat); gm.renderOrder = 4; aw.add(gm);
    // valance with hem
    const vg = new THREE.PlaneGeometry(SHOP_W, val, 66, 1); vg.translate(SHOP_W / 2, yFront - val / 2 - 0.03, zFront + 0.035);
    { const p = vg.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + Math.sin(p.getX(i) * 2.1) * 0.004); vg.computeVertexNormals(); const uv = vg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * 0.3); }
    const vm = new THREE.Mesh(vg, M.awning); vm.castShadow = true; aw.add(vm);
    // hardware: front bar, cassette, folding arms (under the fabric), wall brackets
    const hw = [];
    hw.push(bevGeo(SHOP_W, 0.075, 0.07, SHOP_W / 2, yFront - 0.01, zFront, 0.012));
    hw.push(bevGeo(SHOP_W + 0.04, 0.12, 0.15, SHOP_W / 2, yTop + 0.0, FZ + 0.075, 0.02));
    for (const x of [0.35, 4.5, 6.45, 6.75, 8.7, 12.85]) {
      const a = new THREE.Vector3(x, yTop - 0.09, FZ + 0.1), b = new THREE.Vector3(x, yFront - 0.06, zFront - 0.04);
      const m = a.clone().lerp(b, 0.5); m.y -= 0.07; m.x += (x < 6.6 ? 0.12 : -0.12);
      hw.push(cylBetween(a.toArray(), m.toArray(), 0.022, 0.02, 8)); hw.push(cylBetween(m.toArray(), b.toArray(), 0.02, 0.018, 8));
      hw.push(bevGeo(0.07, 0.07, 0.07, m.x, m.y, m.z, 0.015)); hw.push(bevGeo(0.1, 0.16, 0.05, x, yTop - 0.1, FZ + 0.06, 0.01));
    }
    const hm = new THREE.Mesh(merge(hw), std(0x8f9398, 0.4, 0.75)); hm.castShadow = true; aw.add(hm);
    ctx.dims.push({ a: [0, yFront - val - 0.08, zFront + 0.06], b: [SHOP_W, yFront - val - 0.08, zFront + 0.06], label: '<b>Markise</b> ca. 13,2 m, Volant ca. 25 cm' });
  }

  ctx.dims.push({ a: [8.40, 2.32, 0.08], b: [11.40, 2.32, 0.08], label: 'Fenster Bertolino ca. 3,0 × 1,25 m' });
  ctx.dims.push({ a: [2.10, 0.35, 0.08], b: [4.10, 0.35, 0.08], label: 'Schaufenster ca. 2,0 m' });

  // ================================================================ STREET FURNITURE (positions from fassade.jpg / fenster.jpg)
  const furn = new THREE.Group(); furn.name = 'moebel'; root.add(furn);
  const shadowBlobs = [];
  // --- bistro tables (grey stone-look top, black cross base): merged
  {
    const tops = [], metal = [];
    for (const [x, z] of [[2.05, 0.9], [2.7, 0.5], [3.3, 1.55], [3.9, 0.9]]) {
      tops.push(xform(new THREE.CylinderGeometry(0.3, 0.3, 0.022, 36), x, 0.742, z));
      metal.push(xform(new THREE.CylinderGeometry(0.305, 0.3, 0.03, 36, 1, true), x, 0.735, z));
      metal.push(cylBetween([x, 0.03, z], [x, 0.72, z], 0.024, 0.024, 10));
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.4; metal.push(cylBetween([x, 0.05, z], [x + Math.cos(a) * 0.27, 0.015, z + Math.sin(a) * 0.27], 0.014, 0.014, 6)); }
      shadowBlobs.push([x, z, 0.75]);
    }
    const tt = canvasTex(256, 256, (g, w, h) => { const r = rand(31); g.fillStyle = '#8e8a84'; g.fillRect(0, 0, w, h); for (let i = 0; i < 3000; i++) { const v = 90 + r() * 90 | 0; g.fillStyle = `rgba(${v},${v - 4},${v - 8},0.6)`; g.fillRect(r() * w, r() * h, 2, 2); } });
    const tm = new THREE.Mesh(merge(tops), std(0x9a9a9a, 0.5, 0, { map: tt })); tm.castShadow = true; tm.receiveShadow = true; furn.add(tm);
    const mm = new THREE.Mesh(merge(metal), M.metalBlack); mm.castShadow = true; furn.add(mm);
  }
  // --- yellow plastic tub armchairs (one cream), merged per colour
  {
    const parts = [];
    const seat = new RoundedBoxGeometry(0.46, 0.035, 0.42, 2, 0.014); seat.translate(0, 0.44, 0.0); parts.push(seat);
    const R = 0.235, zc = -0.03, armL = 0.19, N = 44; const top = [];
    const shellPos = [], shellUv = [], idx = [];
    const Ltot = 2 * armL + Math.PI * R;
    for (let i = 0; i <= N; i++) {
      const s = i / N; let d = s * Ltot, x, z, nx, nz;
      if (d < armL) { x = R; z = zc + armL - d; nx = 1; nz = 0; }
      else if (d < armL + Math.PI * R) { const a = (d - armL) / R; x = R * Math.cos(a); z = zc - R * Math.sin(a); nx = Math.cos(a); nz = -Math.sin(a); }
      else { x = -R; z = zc + (d - armL - Math.PI * R); nx = -1; nz = 0; }
      const back = Math.pow(Math.max(0, Math.sin(Math.PI * s)), 1.6);
      const hgt = 0.63 + 0.17 * back; const lean = 0.012 + 0.07 * back;
      shellPos.push(x * 0.97, 0.455, z * 0.97 - 0.005, x + nx * lean, hgt, z + nz * lean);
      shellUv.push(s, 0, s, 1); top.push(new THREE.Vector3(x + nx * lean, hgt, z + nz * lean));
      if (i < N) { const b = i * 2; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
    }
    const shell = new THREE.BufferGeometry(); shell.setAttribute('position', new THREE.Float32BufferAttribute(shellPos, 3)); shell.setAttribute('uv', new THREE.Float32BufferAttribute(shellUv, 2)); shell.setIndex(idx); shell.computeVertexNormals(); parts.push(shell);
    parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(top), 48, 0.016, 6, false));
    for (const [lx, lz] of [[-0.2, -0.17], [0.2, -0.17], [-0.2, 0.17], [0.2, 0.17]]) parts.push(cylBetween([lx, 0.43, lz], [lx * 1.18, 0, lz * 1.25], 0.026, 0.02, 8));
    const chairGeo = merge(parts);
    const yel = [], cream = [];
    for (const [x, z, ry, c] of [[1.25, 0.65, Math.PI * 0.45, 0], [2.3, 0.22, 0.1, 0], [3.05, 0.2, -0.15, 0], [3.6, 0.42, 0.25, 0], [4.25, 1.85, -Math.PI * 0.55, 0], [1.65, 1.5, Math.PI * 0.3, 0], [2.15, 1.38, Math.PI * 0.95, 1]]) {
      (c ? cream : yel).push(xform(chairGeo, x, 0, z, ry)); shadowBlobs.push([x, z, 0.7]);
    }
    const cy = new THREE.Mesh(merge(yel), std(0xffc81a, 0.4, 0, { side: THREE.DoubleSide })); cy.castShadow = true; cy.receiveShadow = true; furn.add(cy);
    const cc = new THREE.Mesh(merge(cream), std(0xe0d8c4, 0.5, 0, { side: THREE.DoubleSide })); cc.castShadow = true; cc.receiveShadow = true; furn.add(cc);
  }
  // --- yellow bin at the double door, black ashtray column next to the red A-frame
  {
    const yb = std(0xd9cb14, 0.42);
    const bg = [xform(new THREE.CylinderGeometry(0.22, 0.19, 0.62, 24), 4.4, 0.62, 0.32), xform(new THREE.SphereGeometry(0.225, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.45, 1), 4.4, 0.93, 0.32)];
    furn.add(new THREE.Mesh(merge(bg), yb));
    const pg = [cylBetween([4.4, 0, 0.32], [4.4, 0.32, 0.32], 0.03, 0.03, 8), xform(new THREE.CylinderGeometry(0.125, 0.12, 0.72, 20), 6.62, 0.36, 1.42), xform(new THREE.CylinderGeometry(0.135, 0.13, 0.04, 20), 6.62, 0.74, 1.42)];
    furn.add(new THREE.Mesh(merge(pg), std(0x111213, 0.5, 0.5)));
    shadowBlobs.push([4.4, 0.32, 0.5], [6.62, 1.42, 0.4]);
  }
  // --- A-frames (Kundenstopper) and the swing sign on a water base
  function aFrame(x, z, ry, frameMat, faceA, faceB, w = 0.6, h = 0.95) {
    const fr = 0.035, ang = 0.2; const fg = [], bA = [], bB = [];
    for (const s of [1, -1]) {
      const m = new THREE.Matrix4().makeRotationY(s < 0 ? Math.PI : 0).multiply(new THREE.Matrix4().makeTranslation(0, 0, h * Math.sin(ang))).multiply(new THREE.Matrix4().makeRotationX(-ang)); // tops meet, feet apart
      const parts = [bevGeo(fr, h, 0.025, -w / 2 + fr / 2, h / 2, 0.0125), bevGeo(fr, h, 0.025, w / 2 - fr / 2, h / 2, 0.0125), bevGeo(w, fr, 0.025, 0, h - fr / 2, 0.0125), bevGeo(w, fr, 0.025, 0, 0.08 + fr / 2, 0.0125)];
      for (const p of parts) fg.push(p.applyMatrix4(m));
      const pl = new THREE.PlaneGeometry(w - 2 * fr, h - 0.08 - fr); pl.translate(0, (h + 0.08 - fr) / 2, 0.026); pl.applyMatrix4(m); (s > 0 ? bA : bB).push(pl);
    }
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; furn.add(g);
    const fm = new THREE.Mesh(merge(fg), frameMat); fm.castShadow = true; g.add(fm);
    const a = new THREE.Mesh(merge(bA), faceA); a.castShadow = true; g.add(a);
    const b = new THREE.Mesh(merge(bB), faceB); b.castShadow = true; g.add(b);
    shadowBlobs.push([x, z, 0.8]); return g;
  }
  const whiteBoard = std(0xd8d6cf, 0.55);
  const awT = tex('aframe_white.jpg'); const awMat = awT ? std(0xffffff, 0.55, 0, { map: awT }) : whiteBoard;
  aFrame(6.5, 1.15, -Math.PI / 2 + 0.25, M.redFrame, whiteBoard, whiteBoard, 0.6, 1.05);   // red, seen side-on in fassade.jpg
  aFrame(8.4, 1.8, -1.45, M.woodLight, awMat, awMat, 0.55, 0.85);                         // wooden, "…LINO / …ETITO"
  {
    const x = 11.5, z = 1.45, ry = -0.45; const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; furn.add(g);
    const base = new THREE.Mesh(merge([new RoundedBoxGeometry(0.82, 0.13, 0.5, 3, 0.05).translate(0, 0.065, 0), new RoundedBoxGeometry(0.4, 0.08, 0.2, 2, 0.03).translate(0, 0.15, 0)]), std(0x8b8c88, 0.62)); base.castShadow = true; base.receiveShadow = true; g.add(base);
    const hwg = [cylBetween([-0.2, 0.17, 0], [-0.2, 0.31, 0], 0.025, 0.025, 8), cylBetween([0.2, 0.17, 0], [0.2, 0.31, 0], 0.025, 0.025, 8), bevGeo(0.64, 0.95, 0.03, 0, 0.31 + 0.475, 0, 0.008)];
    const hwm = new THREE.Mesh(merge(hwg), M.alu); hwm.castShadow = true; g.add(hwm);
    const bt = tex('aframe_blue.jpg'); const bm = bt ? std(0xffffff, 0.5, 0, { map: bt }) : std(0x9cc6d6, 0.6);
    plane(g, bm, 0, 0.785, 0.017, 0.6, 0.9); plane(g, bm, 0, 0.785, -0.017, 0.6, 0.9, Math.PI);
    shadowBlobs.push([x, z, 0.9]);
  }
  // --- high tables with square red/white gingham cloths draped over a round top
  {
    const check = canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = '#efeae2'; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(122,14,30,0.66)'; g.fillRect(0, 0, w / 2, h); g.fillRect(0, 0, w, h / 2);
      const r = rand(9); for (let i = 0; i < 700; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.06})`; g.fillRect(r() * w, r() * h, 1, 1); }
    });
    check.wrapS = check.wrapT = THREE.RepeatWrapping;
    const cloth = new THREE.MeshStandardMaterial({ map: check, color: 0xb4aca6, roughness: 0.92, side: THREE.DoubleSide });
    const clothGeo = (seed) => {
      const S = 1.32, N = 40, Rt = 0.4; const r = rand(seed); const ph = r() * 6, ph2 = r() * 6;
      const g = new THREE.PlaneGeometry(S, S, N, N); g.rotateX(-Math.PI / 2);
      const p = g.attributes.position, uv = g.attributes.uv;
      for (let i = 0; i < p.count; i++) {
        const u = p.getX(i), v = p.getZ(i); const d = Math.hypot(u, v), a = Math.atan2(v, u);
        uv.setXY(i, (u / S + 0.5) * 14, (v / S + 0.5) * 14);
        if (d <= Rt) { p.setXYZ(i, u, 0, v); continue; }
        const s = d - Rt; const edge = Math.min(1, s / 0.04);
        const fold = (0.035 * Math.sin(a * 8 + ph) + 0.02 * Math.sin(a * 13 + ph2)) * Math.min(1, s / 0.25);
        const rr = Rt + 0.012 * edge + fold + 0.05 * s;
        p.setXYZ(i, Math.cos(a) * rr, -(s - 0.012 * edge) - 0.006 * Math.sin(a * 5 + ph), Math.sin(a) * rr);
      }
      g.computeVertexNormals(); return g;
    };
    const cg = [], mg = [];
    for (const [x, z, seed, rot] of [[8.35, 0.8, 1, 0.3], [10.95, 0.85, 2, 0.7]]) {
      cg.push(xform(clothGeo(seed), x, 1.105, z, rot));
      mg.push(cylBetween([x, 0.2, z], [x, 1.08, z], 0.03, 0.03, 10));
      for (let i = 0; i < 4; i++) { const a = rot + i * Math.PI / 2; const ex = x + Math.cos(a) * 0.3, ez = z + Math.sin(a) * 0.3; mg.push(cylBetween([x, 0.22, z], [x + Math.cos(a) * 0.24, 0.035, z + Math.sin(a) * 0.24], 0.015, 0.015, 6)); mg.push(cylBetween([x + Math.cos(a) * 0.24, 0.035, z + Math.sin(a) * 0.24], [ex, 0.02, ez], 0.015, 0.015, 6)); }
      shadowBlobs.push([x, z, 1.0]);
    }
    const cm = new THREE.Mesh(merge(cg), cloth); cm.castShadow = true; cm.receiveShadow = true; furn.add(cm);
    const mm = new THREE.Mesh(merge(mg), M.metalBlack); mm.castShadow = true; furn.add(mm);
  }
  // --- street lamps (Berlin mast lights at the kerb)
  const lamps = [];
  {
    const lg = [], lensG = [];
    for (const x of [-6.5, 19.5]) {
      lg.push(cylBetween([x, 0, 7.25], [x, 7.6, 7.25], 0.1, 0.07, 12)); lg.push(cylBetween([x, 0, 7.25], [x, 0.9, 7.25], 0.13, 0.12, 12));
      lg.push(boxGeo(0.08, 0.08, 1.4, x, 7.55, 6.65)); lg.push(bevGeo(0.35, 0.08, 0.7, x, 7.5, 6.05, 0.02));
      const lens = new THREE.PlaneGeometry(0.3, 0.6); lens.rotateX(Math.PI / 2); lens.translate(x, 7.455, 6.05); lensG.push(lens);
      const L = new THREE.SpotLight(0xffe7c8, 0, 30, 0.95, 0.6, 1.6); L.position.set(x, 7.4, 6.05); L.target.position.set(x + (x < 0 ? 4 : -4), 0, 3.0); L.castShadow = true; L.shadow.mapSize.set(ctx.isMobile ? 512 : 1024, ctx.isMobile ? 512 : 1024); L.shadow.bias = -0.0015; L.shadow.normalBias = 0.06; L.shadow.camera.near = 1; L.shadow.camera.far = 20; root.add(L, L.target); lamps.push(L);
    }
    const lm = new THREE.Mesh(merge(lg), std(0x3d4246, 0.5, 0.6)); lm.castShadow = true; furn.add(lm);
    furn.add(new THREE.Mesh(merge(lensG), glowMat(1, 0.95, 0.85, 6, 0)));
  }
  // parked car hint at the far right edge
  {
    const car = new THREE.Group(); car.position.set(21.5, -0.14, 8.9); furn.add(car);
    const body = new THREE.Mesh(new RoundedBoxGeometry(4.3, 0.75, 1.8, 3, 0.2), std(0x22262c, 0.3, 0.7)); body.position.y = 0.7; car.add(body);
    const cab = new THREE.Mesh(new RoundedBoxGeometry(2.3, 0.6, 1.6, 3, 0.25), std(0x111418, 0.1, 0.5)); cab.position.set(-0.2, 1.3, 0); car.add(cab);
    const wg = []; for (const [x, z] of [[-1.35, 0.85], [1.35, 0.85], [-1.35, -0.85], [1.35, -0.85]]) { const w = new THREE.CylinderGeometry(0.33, 0.33, 0.22, 20); w.rotateX(Math.PI / 2); w.translate(x, 0.33, z); wg.push(w); }
    car.add(new THREE.Mesh(merge(wg), std(0x0c0c0c, 0.8)));
    const tg = []; for (const z of [-0.65, 0.65]) tg.push(boxGeo(0.04, 0.1, 0.35, -2.16, 0.85, z)); car.add(new THREE.Mesh(merge(tg), glowMat(1, 0.05, 0.05, 3, 0.3)));
  }
  furn.traverse(o => { if (o.isMesh) { o.castShadow = o.castShadow || false; o.receiveShadow = true; } });
  // soft contact shadows (help at night when there are no real shadows)
  {
    const sh = canvasTex(128, 128, (g) => { const grd = g.createRadialGradient(64, 64, 4, 64, 64, 64); grd.addColorStop(0, 'rgba(0,0,0,0.7)'); grd.addColorStop(0.55, 'rgba(0,0,0,0.3)'); grd.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = grd; g.fillRect(0, 0, 128, 128); });
    const shMat = new THREE.MeshBasicMaterial({ map: sh, transparent: true, depthWrite: false, opacity: 0.65 });
    const geos = shadowBlobs.map(([x, z, s]) => { const g = new THREE.PlaneGeometry(s, s); g.rotateX(-Math.PI / 2); g.translate(x, 0.005, z); return g; });
    const m = new THREE.Mesh(merge(geos), shMat); m.renderOrder = 1; furn.add(m);
  }

  // ================================================================ LIGHTS
  const hemi = new THREE.HemisphereLight(0x9fb4d8, 0x2a2622, 0.5); root.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0da, 0); sun.position.set(6 - 15, 21, 1 + 21); sun.target.position.set(6, 3, 1);
  sun.castShadow = true; sun.shadow.mapSize.set(ctx.isMobile ? 1024 : 2048, ctx.isMobile ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -17, right: 17, top: 13, bottom: -11, near: 1, far: 80 }); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.025;
  root.add(sun, sun.target);
  // shop light spill onto the pavement (cool LED): spots just behind the glass, aimed outwards/down
  const spill = [];
  for (const [x, i, zt, ang] of [[1.2, 12, 2.6, 0.9], [3.1, 13, 2.6, 0.9], [5.1, 13, 2.6, 0.9], [7.25, 8, 2.6, 0.9], [9.9, 9, 4.6, 0.5]]) {
    const L = new THREE.SpotLight(x > 9 ? 0xf2f5ff : 0xfff5ea, 0, 10, ang, 0.9, 1.4); L.position.set(x, 2.28, -0.16); L.target.position.set(x, 0, zt);
    root.add(L, L.target); spill.push([L, i]);
  }
  // neon red light onto awning top + fascia
  const neonL = [];
  for (const [x, i] of [[3.6, 0.35], [6.6, 0.35]]) { const L = new THREE.PointLight(0xff2414, 0, 2.2, 1.6); L.position.set(x, 4.3, 0.75); root.add(L); neonL.push([L, i]); }
  const NEONCOL = { alt: [0xff2414, 1], a: [0xfff4ee, 0.8], b: [0xff2fa8, 1.1], c: [0xffd84a, 0.6] };
  lookHooks.push((lk) => { neonL.forEach(([L], j) => { const [col, k] = lk.neu ? NEONCOL[lk.spk] : NEONCOL.alt; L.color.set(col); L.userData.k = k; L.position.x = lk.neu ? [2.0, 5.0][j] : [3.6, 6.6][j]; L.intensity = (lastNight ? neonL[j][1] : 0) * k; }); });
  const ledL = new THREE.PointLight(0xd6e4ff, 0, 2.6, 1.6); ledL.position.set(10.45, 3.95, 0.7); root.add(ledL);
  const nsL = new THREE.PointLight(0xff3c9a, 0, 3, 2); nsL.position.set(0.6, 4.3, 0.6); root.add(nsL);
  const fill = new THREE.SpotLight(0xffe4cc, 0, 0, 0.48, 1.0, 0); fill.position.set(6.5, -3, 22); fill.target.position.set(6.5, 6, 0); root.add(fill, fill.target);

  hooks.push((night) => {
    hemi.intensity = night ? 0.08 : 0.38;
    hemi.color.set(night ? 0x6f86b8 : 0xc4d8f4); hemi.groundColor.set(night ? 0x1a1714 : 0x7a7064);
    sun.intensity = night ? 0 : 3.5; sun.castShadow = !night;
    lamps.forEach(L => { L.intensity = night ? 34 : 0; L.castShadow = night && !ctx.isMobile; });
    spill.forEach(([L, i]) => L.intensity = night ? i : 0);
    neonL.forEach(([L, i]) => L.intensity = (night ? i : 0.0) * (L.userData.k ?? 1));
    lastNight = night; ledL.intensity = (night ? 1.2 : 0) * ledScale; nsL.intensity = night ? 0.5 : 0; fill.intensity = night ? 0.8 : 0;
    M.awning.color.set(night ? 0xd09aa0 : 0xe8c8cc); sideMat.color.set(night ? 0xaeaca7 : 0xc9c7c1);
  });

  root.traverse(o => { if (o.isMesh && !o.material.isMeshBasicMaterial && o !== reflector) o.receiveShadow = true; });

  // ================================================================ ENVIRONMENT for all exterior PBR materials
  {
    const envDay = streetEnv(false), envNight = streetEnv(true);
    const mats = new Set();
    root.traverse(o => { if (!o.isMesh) return; for (const m of (Array.isArray(o.material) ? o.material : [o.material])) if (m && m.isMeshStandardMaterial) mats.add(m); });
    for (const m of mats) { m.envMap = envNight; if (m.userData.envK === undefined) m.userData.envK = 1; }
    hooks.push((night) => { for (const m of mats) { m.envMap = night ? envNight : envDay; m.envMapIntensity = night ? m.userData.envK : (m.userData.envDay ?? m.userData.envK * 0.6); } });
  }

  // debug: draw-call / triangle budget of the exterior
  window.__extStats = () => { let calls = 0, tris = 0; root.traverseVisible(o => { if (o.isMesh) { const g = o.geometry; const n = g.index ? g.index.count : g.attributes.position.count; calls += Array.isArray(o.material) ? Math.max(1, g.groups.length) : 1; tris += n / 3; } }); return { calls, tris: Math.round(tris) }; };

  return { root, animate: () => false, setVariant: (n) => ext_setVariant(n), setSpk: (k) => ext_setSpk(k) };
}
