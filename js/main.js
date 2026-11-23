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
import { buildExterior } from './exterior.js';

let dirty = true;
function requestRender() { dirty = true; }
const canvas = document.getElementById('c');
const isMobile = matchMedia('(pointer:coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, isMobile ? 1.5 : 2));
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
controls.maxDistance = 60;
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
try { manifest = await (await fetch('tex/manifest.json', { cache: 'no-cache' })).json(); } catch (e) { manifest = {}; }
const maxAniso = renderer.capabilities.getMaxAnisotropy();
const texCache = new Map();
function tex(name, opts = {}) {
  if (!manifest[name]) return null;
  const key = name + JSON.stringify(opts);
  if (texCache.has(key)) return texCache.get(key);
  const t = texLoader.load('tex/' + name, () => requestRender());
  t.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = Math.min(maxAniso, isMobile ? 4 : 8);
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
  const mod = await import('./interior.js');
  interior = mod.buildInterior(ctx);
} catch (e) { console.warn('Innenraum nicht geladen', e); }
let plan = null;
try { const pm = await import('./plan.js'); plan = pm.buildPlan(ctx); } catch (e) { console.warn('Planung nicht geladen', e); }

// ---------- views ----------
const V = {
  front:     { name: 'Vorne',          pos: [6.6, 1.6, 9.3],  target: [6.6, 2.75, 0], fov: 58 },
  links:     { name: 'Schräg links',   pos: [-3.2, 1.75, 6.2], target: [6.5, 2.6, 0], fov: 58 },
  rechts:    { name: 'Schräg rechts',  pos: [17.0, 1.75, 6.2], target: [6.5, 2.6, 0], fov: 58 },
  reklame:   { name: 'Blende',         pos: [6.6, 3.6, 7.0],  target: [6.6, 4.0, 0], fov: 55 },
  bertolino: { name: 'Bertolino-Fenster', pos: [9.85, 1.5, 3.5], target: [9.85, 1.55, -1], fov: 58 },
  haus:      { name: 'Ganzes Haus',    pos: [6.6, 4.0, 26],   target: [6.6, 8.5, 0], fov: 50 },
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

let tween = null;
// Spielfigur (P) und Kamera dahinter (tp) – Logik weiter unten
const tp = { active: false, yaw: 0, el: 0.13, zoom: 1, t: 3.3, snap: false, stick: null, ptr: new Map(), mv: { x: 0, y: 0 } };
const P = { x: 5.6, z: 3.3, face: Math.PI, speed: 0, root: new THREE.Group(), mixer: null, act: {}, w: { idle: 1, walk: 0, run: 0 }, ready: false, settle: 0, mats: [] };
function goView(k, instant = false) {
  const v = V[k]; if (!v) return;
  curView = k; tp.active = false; placeForView(k);
  Object.values(btns).forEach(b => b.classList.remove('on')); if (btns[k]) btns[k].classList.add('on'); if (btns[k]) btns[k].scrollIntoView({ inline: 'center', behavior: 'smooth', block: 'nearest' });
  const to = { pos: new THREE.Vector3(...v.pos), target: new THREE.Vector3(...v.target), fov: fovFor(v.fov || 55) };
  if (camera.aspect < 0.8 && v.pos[2] > 0.5 && k !== 'haus') to.pos.sub(to.target).multiplyScalar(1.4).add(to.target); // hochkant: draußen etwas zurück, damit mehr Fassade drauf ist
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
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.9, 0.5, 0.85);
const composer = new EffectComposer(renderer);
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
{ const dn = document.getElementById('tDN'); if (dn) dn.onclick = () => { const night = document.getElementById('tNight').classList.contains('on'); setMode(night ? 'day' : 'night'); dn.textContent = night ? '☀️ Tag' : '🌙 Nacht'; }; }

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
// ---------- Leiste unten: 5 Schritte · eine Karte klappt auf (auch beim Antippen im Bild) und mit ✕ wieder zu ----------
let curView = 'front', spkCur = 'b', cardKey = null;
const cardEl = document.getElementById('opts'), stepsEl = document.getElementById('steps'), rotEl = document.getElementById('rot');
const STEPS = [
  { k: 'aussen', icon: '🏪', name: 'Außen', view: 'front' },
  { k: 'reklame', icon: '💡', name: 'Reklame', view: 'reklame' },
  { k: 'tvk', icon: '📺', name: 'TV Kasse', view: 'tvBalken' },
  { k: 'tvt', icon: '📺', name: 'TV Theke', view: 'tvTheke' },
  { k: 'lauf', icon: '🚶', name: 'Laufen' },
];
const TITLE = { aussen: 'Von außen ansehen', reklame: 'Spätkauf-Logo wählen', tvk: '5 Fernseher an der Kasse', tvt: '2 Fernseher über der Theke', lauf: 'Selbst durch den Laden laufen', night: 'Nightshop-Coffee-Logo', bert: 'Bertolino-Leuchtkasten', panel: 'Bertolino-Schriftzug' };
const stepBtns = {};
STEPS.forEach(s => { const b = document.createElement('button'); b.innerHTML = `<span class="i">${s.icon}</span>${s.name}`; b.onclick = () => selectStep(s.k, true); stepsEl.appendChild(b); stepBtns[s.k] = b; });
{ const b = document.createElement('button'); b.className = 'hide'; b.innerHTML = '<span class="i">▾</span>zu'; b.setAttribute('aria-label', 'Leiste zuklappen'); b.onclick = () => setUI(false); stepsEl.appendChild(b);
  const sh = document.getElementById('uishow'); if (sh) sh.onclick = () => setUI(true); }
function setUI(on) { document.body.classList.toggle('uioff', !on); requestRender(); }
function markStep(k) { Object.entries(stepBtns).forEach(([kk, b]) => b.classList.toggle('on', kk === k)); }
function needNeu() { if (variant !== 'neu') setVariant('neu'); }
function setSpk(k) { spkCur = k; ext.setSpk && ext.setSpk(k); requestRender(); }
window.__spk = (k) => setSpk(k);
function showZones() { const z = document.getElementById('zones'); if (z && isMobile) { z.style.display = ''; z.style.opacity = 1; clearTimeout(z._t); z._t = setTimeout(() => { z.style.opacity = 0; }, 6000); } }
function openCard(k) { if (['tvk', 'tvt', 'night', 'bert', 'panel'].includes(k)) needNeu(); cardKey = k; if (document.body.classList.contains('uioff')) setUI(true); if (stepBtns[k] && !tp.active) markStep(k); renderCard(); }
function closeCard() { cardKey = null; renderCard(); }
function renderCard() {
  cardEl.innerHTML = '';
  if (!cardKey) { cardEl.classList.add('off'); updateRot(); requestRender(); return; }
  cardEl.classList.remove('off');
  const hd = document.createElement('div'); hd.className = 'chead'; const tt = document.createElement('b'); tt.textContent = TITLE[cardKey]; hd.appendChild(tt);
  const x = document.createElement('button'); x.className = 'cx'; x.textContent = '✕'; x.setAttribute('aria-label', 'zuklappen'); x.onclick = closeCard; hd.appendChild(x); cardEl.appendChild(hd);
  const row = document.createElement('div'); row.className = 'crow'; cardEl.appendChild(row);
  const chip = (label, isOn, fn) => { const b = document.createElement('button'); b.textContent = label; if (isOn) b.classList.add('on'); b.onclick = fn; row.appendChild(b); return b; };
  const info = (txt) => { const d = document.createElement('div'); d.className = 'info'; d.textContent = txt; cardEl.appendChild(d); };
  const s = cardKey;
  if (s === 'aussen') {
    [['front', 'Vorne'], ['links', 'Links'], ['rechts', 'Rechts'], ['bertolino', 'Bertolino'], ['haus', 'Ganzes Haus']].forEach(([k, l]) => chip(l, !tp.active && curView === k, () => { markStep('aussen'); goView(k); renderCard(); }));
    chip('📏 Maße', dimGroup.visible, () => { document.getElementById('tDim').click(); renderCard(); });
  } else if (s === 'reklame') {
    [['alt', 'Wie jetzt'], ['a', 'Logo A'], ['b', 'Logo B'], ['c', 'Logo C']].forEach(([k, l]) => chip(l, variant === 'neu' && spkCur === k, () => { needNeu(); setSpk(k); renderCard(); }));
    info('Das Nasenschild links wechselt mit.');
  } else if (s === 'tvk' || s === 'tvt') {
    const area = s === 'tvk' ? 'balken' : 'theke'; const st = plan.state[area];
    [43, 50, 55].forEach(z => chip(z + ' Zoll', st.size === z, () => { needNeu(); plan.setTV(area, z, null); requestRender(); renderCard(); }));
    chip('Quer', st.orient === 'q', () => { needNeu(); plan.setTV(area, null, 'q'); requestRender(); renderCard(); });
    chip('Hoch', st.orient === 'h', () => { needNeu(); plan.setTV(area, null, 'h'); requestRender(); renderCard(); });
    const sz = plan.sizes[st.size]; const q = st.orient === 'q';
    const w = Math.round((q ? sz.w : sz.h) * 100), h = Math.round((q ? sz.h : sz.w) * 100), n = area === 'balken' ? 5 : 2;
    info(`${n} Fernseher · je ca. ${w} × ${h} cm · zusammen ca. ${((n * w + (n - 1) * 4) / 100).toFixed(2).replace('.', ',')} m breit`);
  } else if (s === 'lauf') {
    chip('Vor die Tür', false, () => { placePlayer(5.3, 3.2, Math.PI); tp.active = false; engage('snap'); showZones(); });
    chip('In den Laden', false, () => { placePlayer(4.9, -1.9, Math.PI); tp.active = false; engage('snap'); showZones(); });
    chip('Küche ansehen', !tp.active && curView === 'kueche', () => { goView('kueche'); renderCard(); });
    chip(tour ? '■ Stopp' : '▶ Rundgang', !!tour, () => { tourBtn.onclick(); renderCard(); });
    info(isMobile ? 'Linker Daumen = laufen · rechter Daumen = umschauen · Fernseher oder Schild antippen = Auswahl' : 'W A S D = laufen · Maus ziehen = umschauen · Fernseher oder Schild anklicken = Auswahl');
  } else if (s === 'night') { info('Rund, weiß leuchtend auf Schwarz · Ø ca. 1,50 m'); info('Ihr Logo ist sauber nachgezeichnet und fertig für den Werbetechniker.'); }
  else if (s === 'bert') { info('Leuchtkasten ca. 2,70 × 1,85 m · Logo Ø ca. 1,70 m'); info('Leuchtet von innen, Tag und Nacht gut zu sehen.'); }
  else if (s === 'panel') { info('Schriftzug auf der Platte unter dem Fenster · ca. 3,0 × 0,9 m'); }
  if (['night', 'bert', 'panel'].includes(s)) { chip('Vorher', variant !== 'neu', () => { setVariant('ist'); }); chip('Nachher', variant === 'neu', () => { setVariant('neu'); }); }
  updateRot(); requestRender();
}
function selectStep(k, move) {
  const s = STEPS.find(x => x.k === k); if (!s) return; markStep(k);
  if (k === 'lauf') { if (move) { tp.active = false; engage('behind'); showZones(); } cardKey = 'lauf'; renderCard(); return; }
  if (k !== 'aussen') needNeu();
  if (move) goView(s.view);
  cardKey = k; renderCard();
}
function updateRot() { if (!rotEl) return; const portrait = innerHeight > innerWidth * 1.1; rotEl.style.display = portrait && isMobile && !tp.active && (cardKey === 'tvk' || cardKey === 'tvt') ? 'block' : 'none'; }
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
{ const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0); NAV.d = g.getImageData(0, 0, im.width, im.height).data; NAV.W = im.width; NAV.H = im.height; NAV.ok = true; placePlayer(P.x, P.z, P.face); requestRender(); }; im.src = 'tex/nav.png'; }
function navAt(x, z, ch) {
  if (!NAV.ok) return ch === 0 ? !(z > 0.3 && z < 11 && x > -9 && x < 22) : false;
  const i = Math.floor((x - NAV.X0) / NAV.CS), j = Math.floor((z - NAV.Z0) / NAV.CS);
  if (i < 0 || j < 0 || i >= NAV.W || j >= NAV.H) return true;
  return NAV.d[(j * NAV.W + i) * 4 + ch] > 127;
}
const bodyFree = (x, z) => !navAt(x, z, 0), camFree = (x, z) => !navAt(x, z, 1);
function nearestFree(x, z) { if (bodyFree(x, z)) return [x, z]; for (let r = 0.1; r < 5; r += 0.1) for (let a = 0; a < 6.283; a += 0.26) { const nx = x + Math.cos(a) * r, nz = z + Math.sin(a) * r; if (bodyFree(nx, nz)) return [nx, nz]; } return [5.3, 3.0]; }
const ceilAt = (x, z) => z < -0.5 ? 2.35 : z < 0.3 ? 2.12 : z < 1.55 ? 2.28 : 30;

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
new GLTFLoader().load('models/person.glb', (g) => {
  const m = g.scene; m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; dress(o); } });
  const bb = new THREE.Box3().setFromObject(m); m.scale.setScalar(1.76 / Math.max(0.1, bb.max.y - bb.min.y));
  P.root.add(m); P.mixer = new THREE.AnimationMixer(m);
  for (const n of ['idle', 'walk', 'run']) { const clip = THREE.AnimationClip.findByName(g.animations, n); if (!clip) continue; const a = P.mixer.clipAction(clip); a.play(); a.setEffectiveWeight(n === 'idle' ? 1 : 0); P.act[n] = a; }
  P.mixer.update(0.3); P.ready = true; P.settle = 0.5; requestRender();
});
function placePlayer(x, z, face) { const [nx, nz] = nearestFree(x, z); P.x = nx; P.z = nz; if (face !== undefined) P.face = face; P.speed = 0; P.root.position.set(P.x, 0, P.z); P.root.rotation.y = P.face; P.settle = 0.4; }
// wo die Figur steht, wenn eine feste Ansicht gewählt wird (als Größenvergleich im Bild)
const SPOT = { front: [5.6, 3.3], links: [5.6, 3.3], rechts: [5.6, 3.3], haus: [5.6, 3.3], reklame: [6.4, 3.6], bertolino: [8.6, 2.4], innen: [4.9, -1.9], tvBalken: [5.2, -2.3], tvTheke: [6.3, -1.2], kueche: [7.0, -1.6] };
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
  P.root.position.set(P.x, 0, P.z); P.root.rotation.y = P.face;
  if (P.mixer) {
    const sp = P.speed, tw = { idle: sp < 0.25 ? 1 : 0, walk: sp >= 0.25 && sp < 3.0 ? 1 : 0, run: sp >= 3.0 ? 1 : 0 };
    for (const n in P.act) { P.w[n] += (tw[n] - P.w[n]) * Math.min(1, dt * 9); P.act[n].setEffectiveWeight(P.w[n]); }
    if (P.act.walk) P.act.walk.timeScale = THREE.MathUtils.clamp(sp / 1.55, 0.7, 1.5); if (P.act.run) P.act.run.timeScale = THREE.MathUtils.clamp(sp / 4.1, 0.8, 1.2);
    P.mixer.update(dt);
  }
  // Kamera: hinter/über der Schulter, weicht Wänden, Decke und Boden aus
  const ce = Math.cos(tp.el), se = Math.sin(tp.el), dxn = -Math.sin(tp.yaw) * ce, dzn = Math.cos(tp.yaw) * ce;
  let t = (inside ? 2.3 : 3.5) * tp.zoom;
  if (se < 0) t = Math.min(t, (HEAD - 0.32) / -se);
  for (let s = 0.2; s <= t + 0.001; s += 0.1) { const x = P.x + dxn * s, z = P.z + dzn * s; if (!camFree(x, z) || HEAD + se * s > ceilAt(x, z) || (P.z < -0.55 && z > -0.5)) { t = Math.max(0.3, s - 0.22); break; } }
  tp.t += (t - tp.t) * Math.min(1, dt * (t < tp.t ? 18 : 5));
  _want.set(P.x + dxn * tp.t, HEAD + se * tp.t, P.z + dzn * tp.t);
  if (tp.snap) { camera.position.copy(_want); tp.snap = false; } else camera.position.lerp(_want, Math.min(1, dt * 16));
  _look.set(P.x, HEAD + 0.22 - Math.min(0.2, Math.max(0, 1.4 - tp.t) * 0.3), P.z); camera.lookAt(_look); controls.target.copy(_look);
  const wantFov = camera.aspect < 1 ? 78 : 60; if (Math.abs(camera.fov - wantFov) > 0.05) { camera.fov += (wantFov - camera.fov) * Math.min(1, dt * 6); camera.updateProjectionMatrix(); }
  P.root.visible = P.ready && camera.position.distanceTo(_look) > 0.8;
  const busy = stickOn || held.size > (held.has('fast') ? 1 : 0) || tp.ptr.size > 0 || P.settle > 0 || camera.position.distanceToSquared(_want) > 1e-5 || Math.abs(tp.t - t) > 0.004;
  return busy;
}

{ const H = document.getElementById('help'), ok = document.getElementById('helpOk'); if (H && ok) ok.onclick = () => { H.classList.add('off'); closeCard(); engage('behind'); showZones(); }; }

// ---------- antippen: Fernseher, Schilder, Leuchtkästen → Karte klappt auf ----------
const HOT = [
  { k: 'tvk', icon: '📺', at: [4.375, 2.95, -3.72], side: 'in', box: [0.3, 2.45, -3.95, 8.45, 3.4, -3.6], neu: true },
  { k: 'tvt', icon: '📺', at: [7.55, 2.8, -1.95], side: 'in', box: [7.3, 2.3, -3.2, 7.8, 3.3, -0.7], neu: true },
  { k: 'reklame', icon: '💡', at: [3.6, 4.2, 0.3], side: 'out', box: [0.5, 3.35, 0.05, 6.7, 5.0, 0.4] },
  { k: 'reklame', icon: '💡', at: [0.06, 4.37, 0.65], side: 'out', box: [-0.1, 3.7, 0.15, 0.25, 5.05, 1.1], nomark: true },
  { k: 'night', icon: '☕', at: [7.85, 4.22, 0.32], side: 'out', box: [7.05, 3.4, 0.05, 8.65, 5.0, 0.4], neu: true },
  { k: 'bert', icon: '🍕', at: [10.65, 4.05, 0.34], side: 'out', box: [9.3, 3.1, 0.05, 12.0, 5.0, 0.45], neu: true },
  { k: 'panel', icon: '🍕', at: [9.9, 0.6, 0.12], side: 'out', box: [8.4, 0.1, 0.0, 11.4, 1.0, 0.2], neu: true, nomark: true },
];
const hotsEl = document.getElementById('hots'); const ray = new THREE.Raycaster(); const _v2 = new THREE.Vector2(), _p3 = new THREE.Vector3();
HOT.forEach(h => { h.b3 = new THREE.Box3(new THREE.Vector3(h.box[0], h.box[1], h.box[2]), new THREE.Vector3(h.box[3], h.box[4], h.box[5])); h.p = new THREE.Vector3(...h.at);
  if (!h.nomark && hotsEl) { const b = document.createElement('button'); b.className = 'hot'; b.textContent = h.icon; b.onclick = () => openCard(h.k); hotsEl.appendChild(b); h.el = b; } });
const isIn = () => tp.active ? P.z < 0.2 : camera.position.z < 0.3;
const hotOK = (h) => (!h.neu || variant === 'neu') && (h.side === 'out' ? !isIn() : isIn());
function tapAt(x, y) {
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
  if (play(dt)) dirty = true;
  if (!tp.active && controls.update()) dirty = true;
  if (camera.position.y < 0.3) { camera.position.y = 0.3; dirty = true; }
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

setMode('night');
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
