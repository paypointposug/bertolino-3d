import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildExterior } from './exterior.js?v=11232347';

let dirty = true;
function requestRender() { dirty = true; }
const canvas = document.getElementById('c');
const isMobile = matchMedia('(pointer:coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 400);
camera.position.set(6.6, 1.6, 9.5);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(innerWidth, innerHeight);
Object.assign(labelRenderer.domElement.style, { position: 'fixed', inset: '0', pointerEvents: 'none' });
document.body.appendChild(labelRenderer.domElement);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(6.6, 2.6, 0);
controls.minDistance = 0.4;
controls.maxDistance = 400;   // Block-Übersicht
controls.maxPolarAngle = Math.PI * 0.8;
controls.screenSpacePanning = true;
// wie ein Foto: 1 Finger schiebt das Bild, 2 Finger zoomen genau an die Stelle zwischen den Fingern
controls.zoomSpeed = 1.15; controls.rotateSpeed = 0.75; controls.panSpeed = 1.0; controls.zoomToCursor = true;
controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };

// ---------- environment ----------
const pmrem = new THREE.PMREMGenerator(renderer);
const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environment = envTex;

function gradientTex(stops) {
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 256);
  stops.forEach(([p, col]) => gr.addColorStop(p, col)); g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const bgNight = gradientTex([[0, '#05070d'], [0.55, '#0c1222'], [1, '#1a2030']]);
const bgDay = gradientTex([[0, '#6f9fd6'], [0.6, '#b9d2ea'], [1, '#e8eef2']]);

// ---------- textures ----------
const manager = THREE.DefaultLoadingManager;
const loadbar = document.getElementById('loadbar');
manager.onProgress = (url, a, b) => { loadbar.style.width = Math.round(100 * a / Math.max(b, 1)) + '%'; requestRender(); };
const texLoader = new THREE.TextureLoader();
let manifest = {};
try { manifest = await (await fetch('tex/manifest.json?v=11232347', { cache: 'no-cache' })).json(); } catch (e) { manifest = {}; }
const maxAniso = renderer.capabilities.getMaxAnisotropy();
const texCache = new Map();
function tex(name, opts = {}) {
  if (!manifest[name]) return null;
  const key = name + JSON.stringify(opts);
  if (texCache.has(key)) return texCache.get(key);
  const t = texLoader.load('tex/' + name + '?v=11232347', () => requestRender());
  t.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = Math.min(maxAniso, 8);
  if (opts.repeat || opts.wrap) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  if (opts.repeat) t.repeat.set(opts.repeat[0], opts.repeat[1]);
  texCache.set(key, t);
  return t;
}

// ---------- build ----------
let frameCounter = 0;
const ctx = { frameId: () => frameCounter, resizeHooks: [], scene, tex, renderer, anisotropy: maxAniso, isMobile, modeHooks: [], dims: [], requestRender: () => requestRender() };
const ext = await buildExterior(ctx);
let interior = null;
try {
  const mod = await import('./interior.js?v=11232347');
  interior = mod.buildInterior(ctx);
} catch (e) { console.warn('Innenraum nicht geladen', e); }
let plan = null;
try { const pm = await import('./plan.js?v=11232347'); plan = pm.buildPlan(ctx); } catch (e) { console.warn('Planung nicht geladen', e); }

// ---------- views ----------
const V = {
  front:     { name: 'Vorne',          pos: [6.6, 1.6, 9.3],  target: [6.6, 2.75, 0], fov: 58 },
  links:     { name: 'Schräg links',   pos: [-3.2, 1.75, 6.2], target: [6.5, 2.6, 0], fov: 58 },
  rechts:    { name: 'Schräg rechts',  pos: [17.0, 1.75, 6.2], target: [6.5, 2.6, 0], fov: 58 },
  reklame:   { name: 'Blende',         pos: [6.6, 3.6, 7.0],  target: [6.6, 4.0, 0], fov: 55 },
  bertolino: { name: 'Bertolino-Fenster', pos: [9.85, 1.5, 3.5], target: [9.85, 1.55, -1], fov: 58 },
  haus:      { name: 'Ganzes Haus',    pos: [6.6, 4.2, 33.5], target: [6.6, 8.5, 0], fov: 41 },   // gegenüberliegender Gehweg, nicht auf der Fahrbahn
  tvBalken:  { name: 'TV am Balken',   pos: [4.4, 1.6, -0.6], target: [4.4, 2.6, -3.8], fov: 82, neu: true },
  tvTheke:   { name: 'TV über Theke',  pos: [4.3, 1.62, -1.95], target: [7.7, 2.75, -1.95], fov: 66, neu: true },
};
if (interior && interior.cameras) {
  if (interior.cameras.innen) V.innen = { name: 'Spätkauf innen', ...interior.cameras.innen };
  if (interior.cameras.kueche) V.kueche = { name: 'Küche', ...interior.cameras.kueche };
}
const order = ['front', 'reklame', 'links', 'rechts', 'bertolino', 'innen', 'tvBalken', 'kueche', 'tvTheke', 'haus'];
const bar = document.getElementById('views');
const btns = {};

V.block = { name: 'Block', pos: [-75, 105, 135], target: [45, 0, -55], fov: 50 };
let tween = null;
// Spielfigur (P) und Kamera dahinter (tp) – Logik weiter unten
const tp = { active: false, yaw: 0, el: 0.13, zoom: 1, t: 3.3, snap: false, stick: null, ptr: new Map(), mv: { x: 0, y: 0 } };
const P = { gy: 0, x: 5.6, z: 3.3, face: Math.PI, speed: 0, root: new THREE.Group(), mixer: null, act: {}, w: { idle: 1, walk: 0, run: 0 }, ready: false, settle: 0, mats: [] };
function goView(k, instant = false) {
  const v = V[k]; if (!v) return;
  if (window.__W && window.__W.control && window.__W.control.exit) window.__W.control.exit(true);
  curView = k; tp.active = false; placeForView(k);
  Object.values(btns).forEach(b => b.classList.remove('on')); if (btns[k]) btns[k].classList.add('on'); if (btns[k]) btns[k].scrollIntoView({ inline: 'center', behavior: 'smooth', block: 'nearest' });
  const to = { pos: new THREE.Vector3(...v.pos), target: new THREE.Vector3(...v.target), fov: fovFor(v.fov || 55) };
  if (camera.aspect < 0.8 && v.pos[2] > 0.5 && k !== 'haus' && k !== 'block') { // hochkant: draußen etwas zurück, damit mehr Fassade drauf ist
    to.pos.sub(to.target).multiplyScalar(1.4).add(to.target);
    if (to.pos.z > 10.6) to.pos.sub(to.target).multiplyScalar((10.6 - to.target.z) / (to.pos.z - to.target.z)).add(to.target); // nicht in die Fahrspur (fahrende Autos)
  }
  if (instant) { camera.position.copy(to.pos); controls.target.copy(to.target); camera.fov = to.fov; camera.updateProjectionMatrix(); controls.update(); requestRender(); return; }
  const from = { pos: camera.position.clone(), target: controls.target.clone(), fov: camera.fov };
  const inF = from.pos.z < -0.2, inT = to.pos.z < -0.2;
  if (inF !== inT) { // walk through a door instead of through walls / crates
    const inside = inT ? to : from; const d3 = inside.pos.x > 6.4;
    const wp = { pos: new THREE.Vector3(d3 ? 7.25 : 5.1, 1.7, 1.4), target: new THREE.Vector3(d3 ? 7.0 : 4.8, 1.6, -3), fov: (from.fov + to.fov) / 2 };
    tween = { t: 0, dur: 0.9, from, to: wp, next: { t: 0, dur: 1.0, from: wp, to } };
  } else tween = { t: 0, dur: 1.4, from, to };
}
function fovFor(v) { // keep horizontal framing on portrait / narrow screens and on very wide (phone landscape) screens
  const asp = camera.aspect;
  if (asp > 1.65) return Math.max(40, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(v) / 2) * 1.65 / asp)));
  if (asp >= 4 / 3) return v;
  const h = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(v) / 2) * 4 / 3);
  return Math.min(100, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(h / 2) / asp)));
}
// guided tour
let tour = null;
const tourBtn = document.createElement('button'); tourBtn.textContent = '▶ Rundgang';
function stopTour() { if (tour) { clearTimeout(tour); tour = null; tourBtn.classList.remove('on'); tourBtn.textContent = '▶ Rundgang'; if (typeof renderCard === 'function' && cardKey === 'lauf') renderCard(); } }
tourBtn.onclick = () => {
  if (tour) return stopTour();
  const seq = order.filter(k => V[k] && k !== 'haus' && (!V[k].neu || variant === 'neu')); let i = 0;
  tourBtn.classList.add('on'); tourBtn.textContent = '■ Stopp';
  const step = () => { goView(seq[i % seq.length]); i++; tour = setTimeout(step, 5200); };
  step();
};

// ---------- day / night ----------
// Kantenglättung nur am Computer (am Handy sorgt die höhere Pixeldichte dafür); abschaltbar mit ?msaa=0
const MSAA = (() => { const q = new URLSearchParams(location.search).get('msaa'); return q !== null ? Math.max(0, Math.min(8, +q || 0)) : (isMobile ? 0 : 4); })();
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.9, 0.5, 0.85);
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: MSAA }));
composer.setPixelRatio(renderer.getPixelRatio());
composer.setSize(innerWidth, innerHeight);
composer.addPass(new RenderPass(scene, camera));
const hiQ = !isMobile;
let gtao = null;
if (hiQ) {
  gtao = new GTAOPass(scene, camera, innerWidth, innerHeight);
  gtao.output = GTAOPass.OUTPUT.Default; gtao.blendIntensity = 0.85;
  gtao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: 12, distanceFallOff: 1.0 });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
  composer.addPass(gtao);
}
composer.addPass(bloom);
composer.addPass(new OutputPass());
const lookPass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, vig: { value: 0.32 }, grain: { value: 0.035 }, res: { value: new THREE.Vector2(innerWidth, innerHeight) },
    contrast: { value: 0.22 }, sat: { value: 1.08 }, shadowTint: { value: new THREE.Color(0.0, 0.012, 0.03) }, hiTint: { value: new THREE.Color(1.02, 1.0, 0.97) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float vig; uniform float grain; uniform vec2 res; uniform float contrast; uniform float sat; uniform vec3 shadowTint; uniform vec3 hiTint; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){ vec4 c = texture2D(tDiffuse, vUv); vec2 d = vUv - 0.5; d.x *= res.x / res.y;
      vec3 x = clamp(c.rgb, 0.0, 1.0);
      x = mix(x, x * x * (3.0 - 2.0 * x), contrast);
      float l = dot(x, vec3(0.2126, 0.7152, 0.0722));
      x = mix(vec3(l), x, sat);
      x += shadowTint * (1.0 - smoothstep(0.0, 0.35, l));
      x *= mix(vec3(1.0), hiTint, smoothstep(0.4, 1.0, l));
      c.rgb = x;
      float v = 1.0 - vig * smoothstep(0.35, 1.1, length(d)); c.rgb *= v;
      c.rgb += (h(vUv * res) - 0.5) * grain; gl_FragColor = c; }`
});
composer.addPass(lookPass);

let mode = 'night';
function setMode(m) {
  mode = m;
  const night = m === 'night';
  document.getElementById('tNight').classList.toggle('on', night);
  document.getElementById('tDay').classList.toggle('on', !night);
  scene.background = night ? bgNight : bgDay;
  scene.fog = night ? new THREE.FogExp2(0x0b0f1a, 0.012) : new THREE.FogExp2(0xc9d6e2, 0.006);
  scene.environmentIntensity = night ? 0.06 : 0.55;
  renderer.toneMappingExposure = night ? 0.95 : 0.85;
  bloom.strength = night ? 0.55 : 0.2;
  bloom.radius = night ? 0.45 : 0.3;
  bloom.threshold = night ? 0.9 : 1.6;
  lookPass.uniforms.contrast.value = night ? 0.22 : 0.15;
  lookPass.uniforms.sat.value = night ? 1.1 : 1.06;
  lookPass.uniforms.shadowTint.value.set(night ? 0.0 : 0.0, night ? 0.01 : 0.004, night ? 0.03 : 0.01);
  lookPass.uniforms.hiTint.value.set(night ? 1.02 : 1.03, 1.0, night ? 0.97 : 0.95);
  ctx.modeHooks.forEach(fn => fn(night));
  requestRender();
}
document.getElementById('tNight').onclick = () => setMode('night');
document.getElementById('tDay').onclick = () => setMode('day');
{ const dn = document.getElementById('tDN'); if (dn) dn.onclick = () => { const night = document.getElementById('tNight').classList.contains('on'); setMode(night ? 'day' : 'night'); dn.innerHTML = ic(night ? 'sun' : 'moon'); dn.setAttribute('aria-label', night ? 'Tag' : 'Nacht'); }; }

// ---------- dimensions ----------
const dimGroup = new THREE.Group(); dimGroup.visible = false; scene.add(dimGroup);
const dimMat = new THREE.LineBasicMaterial({ color: 0xffd21f, depthTest: false, transparent: true });
for (const d of ctx.dims) {
  const a = new THREE.Vector3(...d.a), b = new THREE.Vector3(...d.b);
  const dir = b.clone().sub(a).normalize();
  const n = new THREE.Vector3(...(d.n || [0, 0, 1])).multiplyScalar(0.08);
  const perp = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(...(d.n || [0, 0, 1]))).normalize().multiplyScalar(0.07);
  const pts = [a, b, a.clone().add(perp), a.clone().sub(perp), b.clone().add(perp), b.clone().sub(perp)];
  const g = new THREE.BufferGeometry().setFromPoints([pts[0], pts[1], pts[2], pts[3], pts[4], pts[5]]);
  const dg = new THREE.Group(); dg.userData.v = d.v || ''; dimGroup.add(dg);
  const line = new THREE.LineSegments(g, dimMat); line.renderOrder = 999; dg.add(line);
  const el = document.createElement('div'); el.className = 'lbl'; el.innerHTML = d.label;
  const o = new CSS2DObject(el); o.position.copy(a.clone().add(b).multiplyScalar(0.5).add(n)); dg.add(o);
}
document.getElementById('tDim').onclick = (e) => {
  dimGroup.visible = !dimGroup.visible; e.target.classList.toggle('on', dimGroup.visible);
  document.getElementById('dimnote').style.display = dimGroup.visible ? 'block' : 'none';
  if (!dimGroup.visible) labelRenderer.domElement.querySelectorAll('.lbl').forEach(n => n.style.display = 'none');
  requestRender();
};

// ---------- Vorher / Nachher + Fernseher-Auswahl ----------
let variant = 'neu';
const tVor = document.getElementById('tVor'), tNach = document.getElementById('tNach'), tvPanel = document.getElementById('tvpanel');
function setVariant(v) {
  variant = v; const neu = v === 'neu';
  tVor.classList.toggle('on', !neu); tNach.classList.toggle('on', neu);
  if (ext.setVariant) ext.setVariant(neu);
  if (plan) plan.setVariant(neu);
  tvPanel.style.display = 'none';
  dimGroup.children.forEach(dg => { dg.visible = !dg.userData.v || dg.userData.v === (neu ? 'neu' : 'ist'); });
  labelRenderer.domElement.querySelectorAll('.lbl').forEach(n => n.style.display = 'none');
  requestRender();
  if (typeof renderCard === 'function' && cardEl) renderCard();
}
tVor.onclick = () => setVariant('ist'); tNach.onclick = () => setVariant('neu');
function tvRow(area, label) {
  const row = document.createElement('div'); row.className = 'tvrow';
  row.innerHTML = `<span class="tvl">${label}</span>`;
  const mk = (txt, fn, isOn) => { const b = document.createElement('button'); b.textContent = txt; b.className = 'mini' + (isOn() ? ' on' : ''); b.onclick = () => { fn(); refresh(); }; b._on = isOn; row.appendChild(b); return b; };
  const st = () => plan.state[area];
  [43, 50, 55].forEach(z => mk(z + '″', () => plan.setTV(area, z, null), () => st().size === z));
  mk('quer', () => plan.setTV(area, null, 'q'), () => st().orient === 'q');
  mk('hoch', () => plan.setTV(area, null, 'h'), () => st().orient === 'h');
  const info = document.createElement('div'); info.className = 'tvinfo'; row.appendChild(info);
  function refresh() {
    row.querySelectorAll('button').forEach(b => b.classList.toggle('on', b._on()));
    const s = plan.sizes[st().size]; const w = Math.round((st().orient === 'q' ? s.w : s.h) * 100), h = Math.round((st().orient === 'q' ? s.h : s.w) * 100);
    info.textContent = `${st().size} Zoll = ca. ${w} × ${h} cm je Gerät`;
    requestRender();
  }
  refresh(); return row;
}
if (plan) {
  tvPanel.innerHTML = '<div class="tvh">Auswahl für den Kunden <span style="float:right;font-weight:400">▾</span></div>';
  tvPanel.querySelector('.tvh').onclick = () => { tvPanel.classList.toggle('min'); };
  { // Spätkauf-Logo
    const row = document.createElement('div'); row.className = 'tvrow'; row.innerHTML = '<span class="tvl">Spätkauf-Logo</span>';
    let cur = 'b'; const bs = []; ext.setSpk && ext.setSpk(cur);
    [['alt', 'Neon (jetzt)'], ['a', 'A'], ['b', 'B'], ['c', 'C']].forEach(([k, lab]) => { const b = document.createElement('button'); b.className = 'mini' + (k === cur ? ' on' : ''); b.textContent = lab; b.onclick = () => { cur = k; ext.setSpk && ext.setSpk(k); bs.forEach(x => x.classList.toggle('on', x === b)); requestRender(); }; bs.push(b); row.appendChild(b); });
    tvPanel.appendChild(row);
  }
  tvPanel.appendChild(tvRow('balken', 'TV 5× Balken'));
  tvPanel.appendChild(tvRow('theke', 'TV 2× Theke'));
  tvPanel.classList.add('min');
}
// ---------- Leiste unten (Glas, Icons): 5 Schritte · eine Karte klappt auf (auch beim Antippen im Bild) und mit ✕ wieder zu ----------
let curView = 'front', spkCur = 'b', cardKey = null;
const ICON = {"store": "<path d=\"M4 10.5V20h16v-9.5\"/><path d=\"M3 10l1.6-5h14.8L21 10a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0z\"/><path d=\"M10 20v-5h4v5\"/>", "bulb": "<path d=\"M9.5 18h5\"/><path d=\"M10.5 21h3\"/><path d=\"M12 3a6 6 0 0 0-4 10.5c.7.7 1.2 1.5 1.3 2.5h5.4c.1-1 .6-1.8 1.3-2.5A6 6 0 0 0 12 3z\"/>", "tv": "<rect x=\"3\" y=\"5\" width=\"18\" height=\"12\" rx=\"2\"/><path d=\"M8 21h8\"/><path d=\"M12 17v4\"/>", "walk": "<circle cx=\"13\" cy=\"4.3\" r=\"1.7\"/><path d=\"M9.5 21l2.2-6.2-2.4-2.6 1.2-4.9 3 .7 1.9 3 3 1\"/><path d=\"M10.5 7.3L7.4 9.2 6.8 12.6\"/><path d=\"M11.7 14.8l3.1 2.6 1 3.6\"/>", "down": "<path d=\"M6 9l6 6 6-6\"/>", "x": "<path d=\"M6 6l12 12M18 6L6 18\"/>", "menu": "<path d=\"M4 7h16M4 12h16M4 17h16\"/>", "quer": "<rect x=\"3\" y=\"7\" width=\"18\" height=\"10\" rx=\"1.8\"/>", "hoch": "<rect x=\"7\" y=\"3\" width=\"10\" height=\"18\" rx=\"1.8\"/>", "ruler": "<path d=\"M3 16L16 3l5 5L8 21z\"/><path d=\"M7.5 11.5l2 2M10.5 8.5l2 2M13.5 5.5l2 2\"/>", "moon": "<path d=\"M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z\"/>", "sun": "<circle cx=\"12\" cy=\"12\" r=\"4\"/><path d=\"M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4\"/>", "cup": "<path d=\"M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z\"/><path d=\"M16 10h1.5a2.5 2.5 0 0 1 0 5H16\"/><path d=\"M8 3v2.5M11.5 3v2.5\"/>", "pizza": "<path d=\"M12 21L3.5 6.5a17 17 0 0 1 17 0z\"/><circle cx=\"10\" cy=\"9.5\" r=\"1\"/><circle cx=\"14\" cy=\"11\" r=\"1\"/><circle cx=\"11.5\" cy=\"14.5\" r=\"1\"/>", "play": "<path d=\"M8 5l11 7-11 7z\"/>", "stop": "<rect x=\"6\" y=\"6\" width=\"12\" height=\"12\" rx=\"2\"/>", "joy": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><circle cx=\"12\" cy=\"12\" r=\"3.4\"/>", "eye": "<path d=\"M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z\"/><circle cx=\"12\" cy=\"12\" r=\"2.8\"/>", "tap": "<path d=\"M9 11V5.5a1.5 1.5 0 0 1 3 0V11\"/><path d=\"M12 10.5a1.5 1.5 0 0 1 3 0V12\"/><path d=\"M15 11.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-.5a5 5 0 0 1-4.2-2.3L5 15.6a1.5 1.5 0 0 1 2.4-1.8L9 15.5V11\"/>", "rot": "<rect x=\"8\" y=\"2.5\" width=\"8\" height=\"13\" rx=\"1.6\"/><path d=\"M4 17a9 9 0 0 0 15.5 2\"/><path d=\"M20 16v3.2h-3.2\"/>"};
const ic = (n) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICON[n]}</svg>`;
const cardEl = document.getElementById('opts'), stepsEl = document.getElementById('steps'), rotEl = document.getElementById('rot');
const STEPS = [
  { k: 'aussen', icon: 'store', name: 'Außen', view: 'front' },
  { k: 'reklame', icon: 'bulb', name: 'Reklame', view: 'reklame' },
  { k: 'tvk', icon: 'tv', name: 'TV Kasse', view: 'tvBalken' },
  { k: 'tvt', icon: 'tv', name: 'TV Theke', view: 'tvTheke' },
  { k: 'lauf', icon: 'walk', name: 'Laufen' },
];
const TITLE = { lbox: 'Leuchtkästen am Fenster', aussen: 'Ansicht', reklame: 'Spätkauf-Logo', tvk: '5 Fernseher · Kasse', tvt: '2 Fernseher · Theke', lauf: 'Laufen', night: 'Nightshop-Logo', bert: 'Bertolino-Leuchtkasten', panel: 'Bertolino-Schriftzug' };
const CICON = { lbox: 'bulb', aussen: 'store', reklame: 'bulb', tvk: 'tv', tvt: 'tv', lauf: 'walk', night: 'cup', bert: 'pizza', panel: 'pizza' };
const stepBtns = {};
STEPS.forEach(s => { const b = document.createElement('button'); b.dataset.k = s.k; b.innerHTML = ic(s.icon) + `<span>${s.name}</span>`; b.onclick = () => selectStep(s.k, true); stepsEl.appendChild(b); stepBtns[s.k] = b; });
{ const b = document.createElement('button'); b.className = 'hide'; b.innerHTML = ic('down'); b.setAttribute('aria-label', 'Leiste zuklappen'); b.onclick = () => setUI(false); stepsEl.appendChild(b);
  const sh = document.getElementById('uishow'); if (sh) sh.onclick = () => setUI(true); }
function setUI(on) { document.body.classList.toggle('uioff', !on); requestRender(); }
function markStep(k) { Object.entries(stepBtns).forEach(([kk, b]) => b.classList.toggle('on', kk === k)); }
function needNeu() { if (variant !== 'neu') setVariant('neu'); }
function setSpk(k) { spkCur = k; ext.setSpk && ext.setSpk(k); requestRender(); }
window.__spk = (k) => setSpk(k);
function showZones() { const z = document.getElementById('zones'); if (z && isMobile) { z.style.display = ''; z.style.opacity = 1; clearTimeout(z._t); z._t = setTimeout(() => { z.style.opacity = 0; }, 6000); } }
function openCard(k) { if (['tvk', 'tvt', 'night', 'bert', 'panel', 'lbox'].includes(k)) needNeu(); cardKey = k; if (document.body.classList.contains('uioff')) setUI(true); if (stepBtns[k] && !tp.active) markStep(k); renderCard(); }
function closeCard() { cardKey = null; renderCard(); }
function renderCard() {
  cardEl.innerHTML = '';
  if (!cardKey) { cardEl.classList.add('off'); updateRot(); requestRender(); return; }
  cardEl.classList.remove('off');
  const s = cardKey;
  const hd = document.createElement('div'); hd.className = 'chead'; hd.innerHTML = ic(CICON[s]) + `<b>${TITLE[s]}</b>`;
  const x = document.createElement('button'); x.className = 'cx'; x.innerHTML = ic('x'); x.setAttribute('aria-label', 'zuklappen'); x.onclick = closeCard; hd.appendChild(x); cardEl.appendChild(hd);
  const row = document.createElement('div'); row.className = 'crow'; cardEl.appendChild(row);
  const seg = (cls) => { const d = document.createElement('div'); d.className = 'seg' + (cls ? ' ' + cls : ''); row.appendChild(d); return d; };
  const opt = (par, html, isOn, fn, label) => { const b = document.createElement('button'); b.innerHTML = html; if (label) { b.setAttribute('aria-label', label); b.title = label; } if (isOn) b.classList.add('on'); b.onclick = fn; par.appendChild(b); return b; };
  const info = (txt) => { const d = document.createElement('div'); d.className = 'info'; d.textContent = txt; cardEl.appendChild(d); };
  if (s === 'aussen') {
    const g = seg('tight');
    [['front', 'Vorne'], ['links', 'Links'], ['rechts', 'Rechts'], ['bertolino', 'Bertolino'], ['block', 'Block']].forEach(([k, l]) => opt(g, l, !tp.active && curView === k, () => { markStep('aussen'); goView(k); renderCard(); }));
    opt(seg('ic'), ic('ruler'), dimGroup.visible, () => { document.getElementById('tDim').click(); renderCard(); }, 'Maße');
  } else if (s === 'reklame') {
    const g = seg();
    [['alt', 'Jetzt'], ['a', 'A'], ['b', 'B'], ['c', 'C']].forEach(([k, l]) => opt(g, l, variant === 'neu' && spkCur === k, () => { needNeu(); setSpk(k); renderCard(); }, k === 'alt' ? 'Wie jetzt' : 'Logo ' + l));
  } else if (s === 'tvk' || s === 'tvt') {
    const area = s === 'tvk' ? 'balken' : 'theke'; const st = plan.state[area];
    const g = seg(); [43, 50, 55].forEach(z => opt(g, z + '″', st.size === z, () => { needNeu(); plan.setTV(area, z, null); requestRender(); renderCard(); }, z + ' Zoll'));
    const o = seg('ic');
    opt(o, ic('quer'), st.orient === 'q', () => { needNeu(); plan.setTV(area, null, 'q'); requestRender(); renderCard(); }, 'Quer');
    opt(o, ic('hoch'), st.orient === 'h', () => { needNeu(); plan.setTV(area, null, 'h'); requestRender(); renderCard(); }, 'Hoch');
    const sz = plan.sizes[st.size]; const q = st.orient === 'q';
    const w = Math.round((q ? sz.w : sz.h) * 100), h = Math.round((q ? sz.h : sz.w) * 100), n = area === 'balken' ? 5 : 2;
    info(`je ${w} × ${h} cm · zusammen ${((n * w + (n - 1) * 4) / 100).toFixed(2).replace('.', ',')} m breit`);
  } else if (s === 'lauf') {
    const g = seg();
    opt(g, 'Draußen', false, () => { placePlayer(5.3, 3.2, Math.PI); tp.active = false; engage('snap'); showZones(); });
    opt(g, 'Drinnen', false, () => { placePlayer(4.9, -1.9, Math.PI); tp.active = false; engage('snap'); showZones(); });
    opt(g, 'Küche', !tp.active && curView === 'kueche', () => { goView('kueche'); renderCard(); });
    opt(seg('ic'), ic(tour ? 'stop' : 'play'), !!tour, () => { tourBtn.onclick(); renderCard(); }, 'Rundgang');
    if (window.__W) { const gm = seg(); opt(gm, 'Spielmodus', window.__W.gameMode, () => { window.__W.setGameMode(!window.__W.gameMode); renderCard(); }, 'Spielmodus mit Waffen'); }
    info(isMobile ? 'Links laufen · rechts umschauen' : 'W A S D laufen · Maus umschauen');
  } else {
    info(s === 'lbox' ? 'links 0,60 × 2,20 m · rechts 1,10 × 2,25 m' : s === 'night' ? 'Rund, weiß leuchtend · Ø ca. 1,50 m' : s === 'bert' ? 'ca. 2,70 × 1,85 m · Logo Ø ca. 1,70 m' : 'Unter dem Fenster · ca. 3,0 × 0,9 m');
    const g = seg(); opt(g, 'Vorher', variant !== 'neu', () => { setVariant('ist'); }); opt(g, 'Nachher', variant === 'neu', () => { setVariant('neu'); });
  }
  updateRot(); requestRender();
}
function selectStep(k, move) {
  const s = STEPS.find(x => x.k === k); if (!s) return; markStep(k);
  if (k === 'lauf') { if (move) { tp.active = false; engage('behind'); showZones(); } cardKey = 'lauf'; renderCard(); return; }
  if (k !== 'aussen') needNeu();
  if (move) goView(s.view);
  cardKey = k; renderCard();
}
function updateRot() { if (!rotEl) return; const portrait = innerHeight > innerWidth * 1.1; rotEl.style.display = portrait && isMobile && !tp.active && (cardKey === 'tvk' || cardKey === 'tvt') ? 'flex' : 'none'; }
addEventListener('resize', updateRot);
window.__open = (k) => openCard(k); window.__tp = tp; window.__P = P; window.__tap = (x, y) => tapAt(x, y);

const startHash = (location.hash || '').slice(1);
setVariant(startHash === 'vorher' ? 'ist' : 'neu');
selectStep('aussen', false);
window.__variant = (v) => setVariant(v);
window.__tv = (area, size, orient) => { plan && plan.setTV(area, size, orient); };

// ---------- Spielfigur mit Kamera dahinter (wie Konsole): linker Daumen = laufen, rechter Daumen = Kamera drehen ----------
// Tastatur: W A S D / ↑ ↓ = laufen · ← → = Kamera drehen · Shift = rennen · Maus ziehen = umschauen · Mausrad = näher/weiter
controls.enabled = false;
const held = new Set();
const KEYMAP = { ArrowUp: 'f', KeyW: 'f', ArrowDown: 'b', KeyS: 'b', KeyA: 'l', KeyD: 'r', ArrowLeft: 'tl', ArrowRight: 'tr', KeyQ: 'tl', KeyE: 'tr' };
const _f = new THREE.Vector3(), _m = new THREE.Vector3(), _want = new THREE.Vector3(), _look = new THREE.Vector3();
const HEAD = 1.6;

// Begehbarkeits-Karte (tex/nav.png: R = Person gesperrt, G = Kamera gesperrt; 0,1 m je Pixel)
const NAV = { ok: false, X0: -14, Z0: -9, CS: 0.1, W: 0, H: 0, d: null };
{ const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0); NAV.d = g.getImageData(0, 0, im.width, im.height).data; NAV.W = im.width; NAV.H = im.height; NAV.ok = true; placePlayer(P.x, P.z, P.face); requestRender(); }; im.src = 'tex/nav.png?v=11232347'; }
// grobe Stadt-Karte (city/nav_city.png, 0,25 m: R = Person/Auto gesperrt, G = Kamera gesperrt, B = Fahrbahn)
const CNAV = { ok: false, X0: 0, Z0: 0, CS: 0.25, W: 0, H: 0, d: null };
fetch('city/city.json?v=11232347').then(r => r.ok ? r.json() : null).then(cj => { if (!cj) return; window.__cityJSON = cj; Object.assign(CNAV, { X0: cj.nav.X0, Z0: cj.nav.Z0, CS: cj.nav.CS });
  const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0); CNAV.d = g.getImageData(0, 0, im.width, im.height).data; CNAV.W = im.width; CNAV.H = im.height; CNAV.ok = true; requestRender(); }; im.src = 'city/nav_city.png?v=11232347'; }).catch(() => {});
function cnavAt(x, z, ch) {
  if (!CNAV.ok) return ch === 2 ? false : !(z > -0.2 && z < 40 && x > -60 && x < 140);
  const i = Math.floor((x - CNAV.X0) / CNAV.CS), j = Math.floor((z - CNAV.Z0) / CNAV.CS);
  if (i < 0 || j < 0 || i >= CNAV.W || j >= CNAV.H) return ch !== 2;
  return CNAV.d[(j * CNAV.W + i) * 4 + ch] > 127;
}
const inFine = (x, z) => NAV.ok && x >= NAV.X0 + 0.2 && z >= NAV.Z0 + 0.2 && x < NAV.X0 + NAV.W * NAV.CS - 0.2 && z < NAV.Z0 + NAV.H * NAV.CS - 0.2;
function navAt(x, z, ch) {
  if (!NAV.ok) return ch === 0 ? !(z > 0.3 && z < 11 && x > -9 && x < 22) : false;
  if (!inFine(x, z)) return cnavAt(x, z, ch === 0 ? 0 : 1);
  const i = Math.floor((x - NAV.X0) / NAV.CS), j = Math.floor((z - NAV.Z0) / NAV.CS);
  const f = NAV.d[(j * NAV.W + i) * 4 + ch] > 127;
  if (f || z < 0.4 || (x > -9 && x < 22 && z < 11.5)) return f;
  return cnavAt(x, z, ch === 0 ? 0 : 1);   // Rand des alten Spielfelds: Stadt-Karte (Bäume, Masten, Häuser)
}
const groundY = (x, z) => { const lg = window.__W && window.__W.lifeGround ? window.__W.lifeGround(x, z) : 0; return lg > 0 ? lg : (cnavAt(x, z, 2) ? -0.14 : 0); };   // Bahnsteig (life.js)
const bodyFree = (x, z) => !navAt(x, z, 0) && !(window.__W && window.__W.lifeBlocked && window.__W.lifeBlocked(x, z)), camFree = (x, z) => !navAt(x, z, 1);
function nearestFree(x, z) { if (bodyFree(x, z)) return [x, z]; for (let r = 0.1; r < 5; r += 0.1) for (let a = 0; a < 6.283; a += 0.26) { const nx = x + Math.cos(a) * r, nz = z + Math.sin(a) * r; if (bodyFree(nx, nz)) return [nx, nz]; } return [5.3, 3.0]; }
const ceilAt = (x, z) => (x < -11.5 || x > 24.5) ? 60 : z < -0.5 ? 2.35 : z < 0.3 ? 2.12 : z < 1.55 ? 2.28 : 60;

// Figur
function dress(mesh) { // Kleidung über die Knochen einfärben: Kopf/Hände Haut, Oberteil blau, Hose dunkel, Schuhe weiß
  const geo = mesh.geometry, si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight; if (!si || !mesh.skeleton) return;
  const bones = mesh.skeleton.bones, col = new Float32Array(si.count * 3);
  const SKIN = new THREE.Color(0xc48a66), TOP = new THREE.Color(0x1b8fd6), LEG = new THREE.Color(0x232a3a), SHOE = new THREE.Color(0xeeeeee), HAIR = new THREE.Color(0x2a1d16);
  const pos = geo.attributes.position; let ymax = -1e9; for (let i = 0; i < pos.count; i++) ymax = Math.max(ymax, pos.getY(i));
  for (let i = 0; i < si.count; i++) {
    let best = 0, bw = -1; for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
    const n = bones[best] ? bones[best].name : '';
    let c = /Head/.test(n) ? SKIN : /Neck|Hand/.test(n) ? SKIN : /Foot|Toe/.test(n) ? SHOE : /UpLeg|Leg|Hips/.test(n) ? LEG : TOP;
    if (/Head/.test(n) && pos.getY(i) > ymax - (ymax * 0.055)) c = HAIR;
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  mesh.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0, emissive: 0xffffff, emissiveIntensity: 0 });
  mesh.material.emissiveMap = null; P.mats.push(mesh.material);
}
{ // weicher Schatten unter den Füßen
  const t = new THREE.CanvasTexture((() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 6, 64, 64, 62); gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.22)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return c; })());
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.0), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false })); sh.rotation.x = -Math.PI / 2; sh.position.y = 0.02; sh.renderOrder = 2; P.root.add(sh);
}
scene.add(P.root);
Promise.all([new Promise((res, rej) => new GLTFLoader().load('models/person.glb?v=11232347', res, undefined, rej)), fetch('models/anim.json?v=11232347').then(r => r.json())]).then(([g, anim]) => {
  const m = g.scene; m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; if (o.material.map) { o.material.map.anisotropy = Math.min(maxAniso, 8); o.material.metalness = 0; o.material.roughness = 0.82; o.material.envMapIntensity = 0.7; } else dress(o); } });
  const bb = new THREE.Box3().setFromObject(m); m.scale.setScalar(1.70 / Math.max(0.1, bb.max.y - bb.min.y));
  P.root.add(m); P.mixer = new THREE.AnimationMixer(m);
  for (const n of ['idle', 'walk', 'run']) { if (!anim[n]) continue; const clip = THREE.AnimationClip.parse(anim[n]); clip.uuid = THREE.MathUtils.generateUUID(); const a = P.mixer.clipAction(clip); a.play(); a.setEffectiveWeight(n === 'idle' ? 1 : 0); P.act[n] = a; }
  P.mixer.update(0.3); P.ready = true; P.settle = 0.5; requestRender();
}).catch(e => console.warn('Figur nicht geladen', e));
function placePlayer(x, z, face) { const [nx, nz] = nearestFree(x, z); P.x = nx; P.z = nz; if (face !== undefined) P.face = face; P.speed = 0; P.root.position.set(P.x, 0, P.z); P.root.rotation.y = P.face; P.settle = 0.4; }
// wo die Figur steht, wenn eine feste Ansicht gewählt wird (als Größenvergleich im Bild)
const SPOT = { front: [5.6, 3.3], links: [5.6, 3.3], rechts: [5.6, 3.3], haus: [5.6, 3.3], reklame: [6.4, 3.6], bertolino: [12.9, 3.4], innen: [4.9, -1.9], tvBalken: [5.2, -2.3], tvTheke: [6.3, -1.2], kueche: [7.0, -1.6] };
function placeForView(k) { const s = SPOT[k]; if (!s) return; const v = V[k]; placePlayer(s[0], s[1], Math.atan2(v.target[0] - s[0], v.target[2] - s[1])); }

// Kamera hinter die Figur holen
function engage(behind) {
  if (tween) tween = null; stopTour();
  if (!tp.active) {
    const dx = P.x - camera.position.x, dz = P.z - camera.position.z, dy = camera.position.y - HEAD, far = Math.hypot(dx, dz);
    if (behind || far > 9 || far < 0.5) { tp.yaw = Math.atan2(Math.sin(P.face), -Math.cos(P.face)); tp.el = 0.13; tp.snap = far > 9 || behind === 'snap'; }
    else { tp.yaw = Math.atan2(dx, -dz); tp.el = THREE.MathUtils.clamp(Math.atan2(dy, far), -0.15, 0.5); tp.snap = false; }
    tp.active = true;
  }
  const h = document.getElementById('help'); if (h && !h.classList.contains('off')) h.classList.add('off');
  if (typeof markStep === 'function') markStep('lauf');
  requestRender();
}
addEventListener('keydown', (e) => { if (e.key === 'Shift') held.add('fast'); const k = KEYMAP[e.code]; if (!k) return; e.preventDefault(); if (!tp.active) engage(); held.add(k); });
addEventListener('keyup', (e) => { const k = KEYMAP[e.code]; if (k) held.delete(k); if (e.key === 'Shift') held.delete('fast'); });
addEventListener('blur', () => { held.clear(); tp.stick = null; tp.ptr.clear(); tp.mv.x = tp.mv.y = 0; });
// Steuerkreis (erscheint dort, wo der linke Daumen aufsetzt)
const stickEl = document.createElement('div'); stickEl.className = 'stick'; stickEl.innerHTML = '<div class="stickk"></div>'; document.body.appendChild(stickEl);
const stickK = stickEl.firstChild; const SR = 62;
canvas.addEventListener('pointerdown', (e) => {
  try { canvas.setPointerCapture(e.pointerId); } catch (er) {}
  const left = e.pointerType !== 'mouse' && e.clientX < innerWidth * 0.5 && !tp.stick;
  const p = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: performance.now(), moved: false, role: left ? 'stick' : 'look' };
  tp.ptr.set(e.pointerId, p);
  if (left) { tp.stick = e.pointerId; stickEl.style.left = e.clientX + 'px'; stickEl.style.top = e.clientY + 'px'; stickEl.classList.add('on'); stickK.style.transform = ''; }
});
canvas.addEventListener('pointermove', (e) => {
  const p = tp.ptr.get(e.pointerId); if (!p) return;
  if (!p.moved) { if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < 9) return; p.moved = true; engage(); p.x = e.clientX; p.y = e.clientY; }
  if (p.role === 'stick') {
    let dx = e.clientX - p.x0, dy = e.clientY - p.y0; const l = Math.hypot(dx, dy); if (l > SR) { dx *= SR / l; dy *= SR / l; }
    stickK.style.transform = `translate(${dx}px,${dy}px)`; tp.mv.x = dx / SR; tp.mv.y = dy / SR;
  } else {
    const k = (e.pointerType === 'mouse' ? 2.6 : 3.6) / Math.max(innerWidth, 600);
    tp.yaw += (e.clientX - p.x) * k; tp.el = THREE.MathUtils.clamp(tp.el + (e.clientY - p.y) * k * 0.8, -0.8, 1.15);
    p.x = e.clientX; p.y = e.clientY; dirty = true;
  }
});
const endPtr = (e) => {
  const p = tp.ptr.get(e.pointerId); if (!p) return; tp.ptr.delete(e.pointerId);
  if (tp.stick === e.pointerId) { tp.stick = null; tp.mv.x = tp.mv.y = 0; stickEl.classList.remove('on'); }
  if (e.type === 'pointerup' && !p.moved && performance.now() - p.t0 < 500) tapAt(e.clientX, e.clientY);
};
canvas.addEventListener('pointerup', endPtr); canvas.addEventListener('pointercancel', endPtr);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); if (!tp.active) engage(); tp.zoom = THREE.MathUtils.clamp(tp.zoom * (e.deltaY > 0 ? 1.12 : 0.89), 0.55, 2.2); requestRender(); }, { passive: false });
const angLerp = (a, b, t) => { let d = (b - a) % 6.283185; if (d > Math.PI) d -= 6.283185; if (d < -Math.PI) d += 6.283185; return a + d * t; };

function play(dt) {
  const W = window.__W; if (W && W.control) return W.control.update(dt) !== false;
  if (!tp.active) { // feste Ansicht: Figur steht still; nur einblenden/ausblenden
    const vis = P.ready && camera.position.distanceTo(_m.set(P.x, HEAD, P.z)) > 1.1; if (P.root.visible !== vis) { P.root.visible = vis; return true; }
    if (P.settle > 0 && P.mixer) { P.settle -= dt; P.mixer.update(dt); return true; }
    return false;
  }
  const stickOn = Math.hypot(tp.mv.x, tp.mv.y) > 0.14;
  let fwd = 0, side = 0, turn = 0;
  if (stickOn) { fwd = -tp.mv.y; side = tp.mv.x; }
  if (held.has('f')) fwd += 1; if (held.has('b')) fwd -= 1; if (held.has('r')) side += 1; if (held.has('l')) side -= 1;
  if (held.has('tl')) turn -= 1; if (held.has('tr')) turn += 1;
  tp.yaw += turn * 1.9 * dt;
  const mag = Math.min(1, Math.hypot(fwd, side)); const inside = P.z < 0.3;
  let target = 0;
  if (mag > 0.14) { const run = !inside && (held.has('fast') || (stickOn && mag > 0.93)); target = run ? 3.9 : 1.15 + 0.9 * mag; }
  P.speed += (target - P.speed) * Math.min(1, dt * 9);
  if (mag > 0.14) {
    const fx = Math.sin(tp.yaw), fz = -Math.cos(tp.yaw), rx = Math.cos(tp.yaw), rz = Math.sin(tp.yaw);
    let mx = fx * fwd + rx * side, mz = fz * fwd + rz * side; const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
    P.face = angLerp(P.face, Math.atan2(mx, mz), Math.min(1, dt * 11));
    const st = P.speed * dt, nx = P.x + mx * st, nz = P.z + mz * st;
    if (bodyFree(nx, nz)) { P.x = nx; P.z = nz; }
    else { // Hindernis: erst an der Tür "einfädeln", sonst seitlich vorbeigleiten
      let done = false;
      if (P.z > -1.0 && P.z < 1.6 && Math.abs(mz) > 0.35) { const dc = Math.abs(P.x - 4.7) < Math.abs(P.x - 7.25) ? 4.7 : 7.25; const off = dc - P.x; if (Math.abs(off) < 1.5 && Math.abs(off) > 0.02) { const sx = P.x + Math.sign(off) * Math.min(Math.abs(off), st); if (bodyFree(sx, P.z)) { P.x = sx; done = true; } } }
      if (!done) for (const a of [0.6, -0.6, 1.15, -1.15]) { const ca = Math.cos(a), sa = Math.sin(a), ax = mx * ca - mz * sa, az = mx * sa + mz * ca, tx = P.x + ax * st * 0.8, tz = P.z + az * st * 0.8; if (bodyFree(tx, tz)) { P.x = tx; P.z = tz; done = true; break; } }
      if (!done) P.speed *= 0.5;
    }
    P.settle = 0.45; if (cardKey === 'lauf') closeCard();
  } else if (P.settle > 0) P.settle -= dt;
  P.gy += (groundY(P.x, P.z) - P.gy) * Math.min(1, dt * 12);
  if (tp.aim) P.face = angLerp(P.face, Math.atan2(Math.sin(tp.yaw), -Math.cos(tp.yaw)), Math.min(1, dt * 14));
  P.root.position.set(P.x, P.gy, P.z); P.root.rotation.y = P.face;
  if (P.mixer) {
    const sp = P.speed, tw = { idle: sp < 0.25 ? 1 : 0, walk: sp >= 0.25 && sp < 3.0 ? 1 : 0, run: sp >= 3.0 ? 1 : 0 };
    for (const n in P.act) { P.w[n] += (tw[n] - P.w[n]) * Math.min(1, dt * 9); P.act[n].setEffectiveWeight(P.w[n]); }
    if (P.act.walk) P.act.walk.timeScale = THREE.MathUtils.clamp(sp / 1.55, 0.7, 1.5); if (P.act.run) P.act.run.timeScale = THREE.MathUtils.clamp(sp / 4.1, 0.8, 1.2);
    P.mixer.update(dt);
  }
  // Kamera: hinter/über der Schulter, weicht Wänden, Decke und Boden aus
  const ce = Math.cos(tp.el), se = Math.sin(tp.el), dxn = -Math.sin(tp.yaw) * ce, dzn = Math.cos(tp.yaw) * ce;
  let t = (tp.aim ? 1.55 : inside ? 2.3 : 3.5) * tp.zoom;
  if (se < 0) t = Math.min(t, (HEAD - 0.32) / -se);
  for (let s = 0.2; s <= t + 0.001; s += 0.1) { const x = P.x + dxn * s, z = P.z + dzn * s; if (!camFree(x, z) || HEAD + se * s > ceilAt(x, z) || (P.z < -0.55 && z > -0.5)) { t = Math.max(0.3, s - 0.22); break; } }
  tp.t += (t - tp.t) * Math.min(1, dt * (t < tp.t ? 18 : 5));
  _want.set(P.x + dxn * tp.t, HEAD + se * tp.t, P.z + dzn * tp.t);
  // ist die Kamera nah dran (enger Laden), über die rechte Schulter schauen, damit der Kopf nicht das Bild verdeckt
  const sh = tp.aim ? 0.75 : THREE.MathUtils.clamp(1.9 - tp.t, 0, 1) * 0.42, shx = Math.cos(tp.yaw) * sh, shz = Math.sin(tp.yaw) * sh;
  if (sh > 0.01 && camFree(_want.x + shx, _want.z + shz)) { _want.x += shx; _want.z += shz; }
  if (tp.snap) { camera.position.copy(_want); tp.snap = false; } else camera.position.lerp(_want, Math.min(1, dt * 16));
  _look.set(P.x + shx * 0.75, HEAD + 0.22 - Math.min(0.2, Math.max(0, 1.4 - tp.t) * 0.3), P.z + shz * 0.75); camera.lookAt(_look); controls.target.copy(_look);
  const wantFov = tp.aim ? (camera.aspect < 1 ? 62 : 46) : camera.aspect < 1 ? 78 : 60; if (Math.abs(camera.fov - wantFov) > 0.05) { camera.fov += (wantFov - camera.fov) * Math.min(1, dt * 6); camera.updateProjectionMatrix(); }
  P.root.visible = P.ready && camera.position.distanceTo(_look) > 0.8;
  const busy = stickOn || held.size > (held.has('fast') ? 1 : 0) || tp.ptr.size > 0 || P.settle > 0 || camera.position.distanceToSquared(_want) > 1e-5 || Math.abs(tp.t - t) > 0.004;
  return busy;
}

{ const H = document.getElementById('help'), ok = document.getElementById('helpOk'); if (H && ok) ok.onclick = () => { H.classList.add('off'); closeCard(); engage('behind'); showZones(); }; }

// ---------- antippen: Fernseher, Schilder, Leuchtkästen → Karte klappt auf ----------
const HOT = [
  { k: 'tvk', icon: 'tv', at: [4.375, 2.42, -3.72], side: 'in', box: [0.3, 2.45, -3.95, 8.45, 3.4, -3.6], neu: true },
  { k: 'tvt', icon: 'tv', at: [7.55, 2.3, -1.95], side: 'in', box: [7.3, 2.3, -3.2, 7.8, 3.3, -0.7], neu: true },
  { k: 'reklame', icon: 'bulb', at: [6.35, 3.42, 0.3], side: 'out', box: [0.5, 3.35, 0.05, 6.7, 5.0, 0.4] },
  { k: 'reklame', icon: 'bulb', at: [0.06, 4.37, 0.65], side: 'out', box: [-0.1, 3.7, 0.15, 0.25, 5.05, 1.1], nomark: true },
  { k: 'night', icon: 'cup', at: [8.47, 3.52, 0.32], side: 'out', box: [7.05, 3.4, 0.05, 8.65, 5.0, 0.4], neu: true },
  { k: 'bert', icon: 'pizza', at: [11.9, 3.2, 0.34], side: 'out', box: [9.3, 3.1, 0.05, 12.0, 5.0, 0.45], neu: true },
  { k: 'lbox', icon: 'bulb', at: [12.72, 2.3, 0.2], side: 'out', box: [11.5, 0.2, 0.0, 12.7, 2.55, 0.25], neu: true },
  { k: 'lbox', icon: 'bulb', at: [8.07, 1.3, 0.2], side: 'out', box: [7.75, 0.1, 0.0, 8.4, 2.36, 0.25], neu: true, nomark: true },
  { k: 'panel', icon: 'pizza', at: [9.9, 0.6, 0.12], side: 'out', box: [8.4, 0.1, 0.0, 11.4, 1.0, 0.2], neu: true, nomark: true },
];
const hotsEl = document.getElementById('hots'); const ray = new THREE.Raycaster(); const _v2 = new THREE.Vector2(), _p3 = new THREE.Vector3();
HOT.forEach(h => { h.b3 = new THREE.Box3(new THREE.Vector3(h.box[0], h.box[1], h.box[2]), new THREE.Vector3(h.box[3], h.box[4], h.box[5])); h.p = new THREE.Vector3(...h.at);
  if (!h.nomark && hotsEl) { const b = document.createElement('button'); b.className = 'hot'; b.innerHTML = ic(h.icon); b.onclick = () => openCard(h.k); hotsEl.appendChild(b); h.el = b; } });
const W_ctl = () => !!(window.__W && window.__W.control);
const isIn = () => tp.active ? P.z < 0.2 : camera.position.z < 0.3;
const hotOK = (h) => (!h.neu || variant === 'neu') && (h.side === 'out' ? !isIn() : isIn());
function tapAt(x, y) {
  if (document.body.classList.contains('armed') || W_ctl()) return;   // mit Waffe / im Auto keine Karten per Tipp
  _v2.set(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1); ray.setFromCamera(_v2, camera);
  let best = null, bd = 30;
  for (const h of HOT) { if (!hotOK(h)) continue; const hit = ray.ray.intersectBox(h.b3, _p3); if (hit) { const d = hit.distanceTo(camera.position); if (d < bd) { bd = d; best = h; } } }
  if (best) openCard(best.k); else if (cardKey) closeCard();
}
function updateHot() {
  for (const h of HOT) { if (!h.el) continue;
    let show = hotOK(h) && cardKey !== h.k && !document.body.classList.contains('uioff');
    if (show) { _p3.copy(h.p).project(camera); const d = h.p.distanceTo(camera.position); show = _p3.z < 1 && Math.abs(_p3.x) < 0.94 && _p3.y > -0.5 && _p3.y < 0.8 && d < 17 && d > 1.2;
      if (show) { h.el.style.transform = `translate(${((_p3.x + 1) / 2 * innerWidth).toFixed(1)}px,${((1 - _p3.y) / 2 * innerHeight).toFixed(1)}px)`; } }
    if (h.shown !== show) { h.shown = show; h.el.style.display = show ? 'block' : 'none'; }
  }
}

// ---------- loop ----------
controls.addEventListener('start', () => { tween = null; stopTour(); Object.values(btns).forEach(b => b.classList.remove('on')); });
const clock = new THREE.Clock();
function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
const RES = { can: isMobile && devicePixelRatio > 1.2, hi: false, idle: 0, ema: 0.02, lo: Math.min(devicePixelRatio, 2), top: Math.min(devicePixelRatio, 2.5) };
function setRes(hi) { RES.hi = hi; const pr = hi ? RES.top : RES.lo; renderer.setPixelRatio(pr); composer.setPixelRatio(pr); }
window.__res = RES;
const _shopC = new THREE.Vector3(6, 1.5, -3.5);
const INMESH = interior && interior.group ? { far: false } : null;
if (INMESH) { const ls = []; interior.group.traverse(o => { if (o.isLight) ls.push(o); }); // Lichter raus aus der Gruppe, damit Ausblenden keine Shader neu baut
  ls.forEach(l => { scene.attach(l); if (l.target && l.target.parent && l.target.parent !== scene) scene.attach(l.target); }); }
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.1);
  if (tween) {
    tween.t += dt / tween.dur; const k = ease(Math.min(tween.t, 1));
    camera.position.lerpVectors(tween.from.pos, tween.to.pos, k);
    controls.target.lerpVectors(tween.from.target, tween.to.target, k);
    camera.fov = tween.from.fov + (tween.to.fov - tween.from.fov) * k; camera.updateProjectionMatrix();
    if (tween.t >= 1) tween = tween.next || null; dirty = true;
  }
  let moving = !!tween;
  if (play(dt)) { dirty = true; moving = true; }
  for (const k in W.addons) { const a = W.addons[k]; try { if (a.update && a.update(dt)) { dirty = true; moving = true; } } catch (er) { a.__err = (a.__err || 0) + 1; if (a.__err < 4) console.warn('Erweiterung', k, er); if (a.__err > 30) delete W.addons[k]; } }
  if (!tp.active && controls.update()) dirty = true;
  if (RES.can) { if (moving) { RES.idle = 0; if (RES.hi) setRes(false); else if (window.__ready) { RES.ema = RES.ema * 0.92 + dt * 0.08; if (RES.ema > 0.045 && RES.lo > 1) { RES.lo = Math.max(1, RES.lo - 0.25); RES.ema = 0.028; setRes(false); } } } else { RES.idle += dt; if (!RES.hi && RES.idle > 0.4) { setRes(true); dirty = true; } } }
  if (camera.position.y < 0.3) { camera.position.y = 0.3; dirty = true; }
  if (INMESH) { const d = camera.position.distanceTo(_shopC), far = INMESH.far ? d > 36 : d > 42; if (far !== INMESH.far) { INMESH.far = far; interior.group.visible = !far; dirty = true; } } // Innenraum in der Ferne aus (spart ~300 Draw Calls)
  frameCounter++;
  if (ext.animate && ext.animate(dt)) dirty = true;
  if (!dirty) return;
  dirty = false;
  composer.render();
  if (dimGroup.visible) labelRenderer.render(scene, camera);
  updateHot();
}
function onResize() {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
  labelRenderer.setSize(innerWidth, innerHeight); lookPass.uniforms.res.value.set(innerWidth, innerHeight);
  ctx.resizeHooks.forEach(fn => fn(innerWidth, innerHeight)); requestRender();
}
addEventListener('resize', onResize);


// ================================================================ ERWEITERUNGEN: Stadt-Block, Verkehr, Passanten, Spiel
// Jedes Modul js/<name>.js exportiert  async init(W)  und gibt  { update(dt) -> true wenn sich etwas bewegt }  zurück.
// Auswahl per URL: ?addons=city,traffic  (Standard: alle). Fehler in einem Modul stoppen die Seite nicht.
const W = {
  THREE, scene, camera, renderer, composer, controls, ctx, ext, isMobile, P, tp, held, HEAD,
  get variant() { return variant; }, get night() { return document.getElementById('tNight').classList.contains('on'); },
  engage, placePlayer, requestRender, groundY,
  blocked: (x, z, kind = 'body') => kind === 'cam' ? !camFree(x, z) : !bodyFree(x, z),   // 'body' = Person/Auto, 'cam' = nur Häuser
  city: null,                 // city.json (sobald geladen)
  control: null,              // { update(dt) -> busy, exit(silent) }  übernimmt Steuerung + Kamera (z. B. Auto fahren)
  addons: {}, gameMode: false,
  stick: tp.mv,               // linker Daumen / WASD: {x, y} in -1..1 (y < 0 = vor)
  aimRay(out) { const r = out || new THREE.Raycaster(); r.setFromCamera({ x: 0, y: 0 }, camera); return r; },
  setAim(on) { tp.aim = !!on; document.body.classList.toggle('aiming', !!on); requestRender(); },
  ICON, ic,
  _ev: new EventTarget(),
  on(type, fn) { this._ev.addEventListener(type, (e) => fn(e.detail)); },
  emit(type, detail) { this._ev.dispatchEvent(new CustomEvent(type, { detail })); },
  setGameMode(on) { this.gameMode = !!on; document.body.classList.toggle('game', this.gameMode); this.emit('gamemode', this.gameMode); requestRender(); },
  // Knopf rechts unten (Glas, rund). opts: { id, icon (Name aus ICON oder SVG-Pfade), label, onDown, onUp, big }
  addButton(opts) {
    let col = document.getElementById('actions'); if (!col) { col = document.createElement('div'); col.id = 'actions'; document.body.appendChild(col); }
    if (opts.icon && !ICON[opts.icon] && opts.icon.includes('<')) ICON['x_' + opts.id] = opts.icon;
    const b = document.createElement('button'); b.className = 'act glass' + (opts.big ? ' big' : ''); b.id = 'act_' + opts.id;
    b.innerHTML = ic(ICON[opts.icon] ? opts.icon : 'x_' + opts.id) + (opts.label ? `<span>${opts.label}</span>` : ''); b.setAttribute('aria-label', opts.label || opts.id);
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); try { b.setPointerCapture(e.pointerId); } catch (er) {} b.classList.add('down'); opts.onDown && opts.onDown(e); requestRender(); });
    const up = (e) => { b.classList.remove('down'); opts.onUp && opts.onUp(e); requestRender(); };
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
    b.style.display = 'none'; col.appendChild(b);
    return { el: b, show(on) { b.style.display = on ? '' : 'none'; }, set(html) { b.innerHTML = html; } };
  },
  toast(msg, ms = 1800) { let t = document.getElementById('toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'glass'; document.body.appendChild(t); } t.textContent = msg; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), ms); },
};
window.__W = W;
fetch('city/city.json?v=11232347').then(r => r.ok ? r.json() : null).then(cj => { if (cj) { W.city = cj; W.emit('city', cj); } }).catch(() => {});
{
  const q = new URLSearchParams(location.search).get('addons');   // Berlin-Mesh (bmesh) nur mit ?b=1 – am Handy unbrauchbar
  const list = (q ?? ('city,' + (new URLSearchParams(location.search).get('b') === '1' ? 'bmesh,' : '') + 'traffic,people,combat,life')).split(',').map(s => s.trim()).filter(Boolean);
  for (const name of list) {
    try { const m = await import(`./${name}.js?v=11232347`); const inst = m.init ? await m.init(W) : null; if (inst) W.addons[name] = inst; }
    catch (e) { console.warn('Erweiterung nicht geladen:', name, e); }
  }
}

setMode(new URLSearchParams(location.search).get('mode') || (W.gtiles || W.bmesh ? 'day' : 'night'));   // echte Google-Häuser sind Tagesfotos -> Start bei Tag
const startView = (location.hash || '').slice(1);
goView(V[startView] ? startView : 'front', true);
frame();

let hidden = false;
function hideLoad() { if (hidden) return; hidden = true; const l = document.getElementById('load'); l.style.opacity = 0; setTimeout(() => l.remove(), 600); window.__ready = true; requestRender(); }
manager.onLoad = () => setTimeout(hideLoad, 150);
setTimeout(hideLoad, 9000);
if (!Object.keys(manifest).length) setTimeout(hideLoad, 300);
document.getElementById('hint').textContent = isMobile ? 'Links = laufen · rechts = umschauen' : 'W A S D = laufen · Maus ziehen = umschauen · anklicken = Auswahl';

setTimeout(() => { const h = document.getElementById('hint'); if (h) h.style.opacity = 0; }, 9000);
if (isMobile) { const h = document.getElementById('hint'); if (h) h.style.display = 'none'; }
{ const z = document.getElementById('zones'); if (z) { if (!isMobile) z.style.display = 'none'; else setTimeout(() => { z.style.opacity = 0; }, 20000); } }
addEventListener('resize', () => { if (curView && V[curView] && !tp.active) goView(curView, true); });

// hooks for automated screenshots
window.__setView = (v, m) => {
  frameCounter++;
  if (m) setMode(m);
  if (typeof v === 'string') goView(v, true);
  else { camera.position.set(...v.pos); controls.target.set(...v.target); camera.fov = v.fov || 55; camera.updateProjectionMatrix(); controls.update(); }
  P.root.visible = P.ready && camera.position.distanceTo(P.root.position) > 1.3;
  composer.render();
  if (dimGroup.visible) labelRenderer.render(scene, camera);
  updateHot();
};
window.__scene = scene; window.__camera = camera;
window.__stats = () => { composer.render(); return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, geos: renderer.info.memory.geometries, texs: renderer.info.memory.textures }; };
window.__dims = (on) => { dimGroup.visible = on; document.getElementById('tDim').classList.toggle('on', on); };
