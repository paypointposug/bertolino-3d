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
function goView(k, instant = false) {
  const v = V[k]; if (!v) return;
  curView = k;
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
function stopTour() { if (tour) { clearTimeout(tour); tour = null; tourBtn.classList.remove('on'); tourBtn.textContent = '▶ Rundgang'; if (typeof renderOpts === 'function' && curStep === 'lauf') renderOpts(); } }
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
  if (typeof renderOpts === 'function' && optsEl) renderOpts();
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
// ---------- Einfache Präsentations-Leiste: unten 5 Schritte, darüber nur die passenden Knöpfe ----------
let curView = 'front', curStep = 'aussen', spkCur = 'b';
const optsEl = document.getElementById('opts'), stepsEl = document.getElementById('steps'), rotEl = document.getElementById('rot');
V.start = { name: 'Start', pos: [5.1, 1.65, 6.8], target: [5.1, 1.7, 0], fov: 68 };
const STEPS = [
  { k: 'aussen', icon: '🏪', name: 'Außen', view: 'front' },
  { k: 'reklame', icon: '💡', name: 'Reklame', view: 'reklame', neu: true },
  { k: 'tvk', icon: '📺', name: 'TV Kasse', view: 'tvBalken', neu: true },
  { k: 'tvt', icon: '📺', name: 'TV Theke', view: 'tvTheke', neu: true },
  { k: 'lauf', icon: '🚶', name: 'Laufen', view: 'start' },
];
const stepBtns = {};
STEPS.forEach(s => {
  const b = document.createElement('button'); b.innerHTML = `<span class="i">${s.icon}</span>${s.name}`;
  b.onclick = () => selectStep(s.k, true); stepsEl.appendChild(b); stepBtns[s.k] = b;
});
function chip(label, isOn, fn) { const b = document.createElement('button'); b.textContent = label; if (isOn) b.classList.add('on'); b.onclick = fn; optsEl.appendChild(b); return b; }
function infoLine(txt) { const d = document.createElement('div'); d.className = 'info'; d.textContent = txt; optsEl.appendChild(d); }
function needNeu() { if (variant !== 'neu') setVariant('neu'); }
function setSpk(k) { spkCur = k; ext.setSpk && ext.setSpk(k); requestRender(); }
window.__spk = (k) => setSpk(k);
function renderOpts() {
  optsEl.innerHTML = '';
  const s = curStep;
  if (s === 'aussen') {
    [['front', 'Vorne'], ['links', 'Links'], ['rechts', 'Rechts'], ['bertolino', 'Bertolino'], ['haus', 'Ganzes Haus']].forEach(([k, l]) => chip(l, curView === k, () => { goView(k); renderOpts(); }));
    chip('📏 Maße', dimGroup.visible, () => { document.getElementById('tDim').click(); renderOpts(); });
  } else if (s === 'reklame') {
    [['alt', 'Wie jetzt'], ['a', 'Logo A'], ['b', 'Logo B'], ['c', 'Logo C']].forEach(([k, l]) => chip(l, variant === 'neu' && spkCur === k, () => { needNeu(); setSpk(k); renderOpts(); }));
  } else if (s === 'tvk' || s === 'tvt') {
    const area = s === 'tvk' ? 'balken' : 'theke'; const st = plan.state[area];
    [43, 50, 55].forEach(z => chip(z + ' Zoll', st.size === z, () => { needNeu(); plan.setTV(area, z, null); requestRender(); renderOpts(); }));
    chip('Quer', st.orient === 'q', () => { needNeu(); plan.setTV(area, null, 'q'); requestRender(); renderOpts(); });
    chip('Hoch', st.orient === 'h', () => { needNeu(); plan.setTV(area, null, 'h'); requestRender(); renderOpts(); });
    const sz = plan.sizes[st.size]; const q = st.orient === 'q';
    const w = Math.round((q ? sz.w : sz.h) * 100), h = Math.round((q ? sz.h : sz.w) * 100), n = area === 'balken' ? 5 : 2;
    infoLine(`${n} Fernseher · je ca. ${w} × ${h} cm · zusammen ca. ${((n * w + (n - 1) * 4) / 100).toFixed(2).replace('.', ',')} m breit`);
  } else if (s === 'lauf') {
    [['start', 'Vor der Tür'], ['innen', 'Spätkauf innen'], ['kueche', 'Küche']].forEach(([k, l]) => chip(l, curView === k, () => { goView(k); renderOpts(); }));
    chip(tour ? '■ Stopp' : '▶ Rundgang', !!tour, () => { tourBtn.onclick(); renderOpts(); });
    infoLine('Linker Daumen = laufen · rechter Daumen = umschauen');
  }
  updateRot();
}
function selectStep(k, move) {
  const s = STEPS.find(x => x.k === k); if (!s) return;
  curStep = k; Object.entries(stepBtns).forEach(([kk, b]) => b.classList.toggle('on', kk === k));
  if (s.neu) needNeu();
  if (move) goView(s.view);
  if (k === 'lauf') { const z = document.getElementById('zones'); if (z && isMobile) { z.style.display = ''; z.style.opacity = 1; clearTimeout(z._t); z._t = setTimeout(() => { z.style.opacity = 0; }, 7000); } }
  renderOpts();
}
function updateRot() { if (!rotEl) return; const portrait = innerHeight > innerWidth * 1.1; rotEl.style.display = portrait && isMobile && (curStep === 'tvk' || curStep === 'tvt') ? 'block' : 'none'; }
addEventListener('resize', updateRot);

const startHash = (location.hash || '').slice(1);
setVariant(startHash === 'vorher' ? 'ist' : 'neu');
selectStep('aussen', false);
window.__variant = (v) => setVariant(v);
window.__tv = (area, size, orient) => { plan && plan.setTV(area, size, orient); };

// ---------- Laufen wie im Spiel (Konsole/Handy): linker Daumen = laufen, rechter Daumen = umschauen ----------
// Tastatur: W/S oder ↑/↓ = vor/zurück · A/D = seitlich · ←/→ = drehen · Maus ziehen = umschauen · Mausrad = vor/zurück
controls.enabled = false;
const held = new Set();
const KEYMAP = { ArrowUp: 'f', KeyW: 'f', ArrowDown: 'b', KeyS: 'b', KeyA: 'l', KeyD: 'r', ArrowLeft: 'tl', ArrowRight: 'tr', KeyQ: 'tl', KeyE: 'tr', PageUp: 'u', PageDown: 'd' };
const fp = { yaw: 0, pitch: 0, stick: null, look: new Map(), mv: { x: 0, y: 0 }, wheel: 0, active: false, eye: 1.65 };
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _m = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _p0 = new THREE.Vector3();
function takeOver() { // aktuelle Blickrichtung übernehmen, Kamerafahrt/Rundgang stoppen
  if (tween) tween = null; stopTour(); Object.values(btns).forEach(b => b.classList.remove('on'));
  _f.subVectors(controls.target, camera.position).normalize();
  fp.yaw = Math.atan2(_f.x, -_f.z); fp.pitch = Math.asin(THREE.MathUtils.clamp(_f.y, -1, 1)); fp.active = true;
  const h = document.getElementById('help'); if (h && !h.classList.contains('off')) h.classList.add('off');
}
addEventListener('keydown', (e) => { if (e.key === 'Shift') held.add('fast'); const k = KEYMAP[e.code]; if (!k) return; e.preventDefault(); if (!held.size || !fp.active) takeOver(); held.add(k); });
addEventListener('keyup', (e) => { const k = KEYMAP[e.code]; if (k) held.delete(k); if (e.key === 'Shift') held.delete('fast'); });
addEventListener('blur', () => { held.clear(); fp.stick = null; fp.look.clear(); fp.mv.x = fp.mv.y = 0; });
// Steuerkreis (erscheint dort, wo der linke Daumen aufsetzt)
const stickEl = document.createElement('div'); stickEl.className = 'stick'; stickEl.innerHTML = '<div class="stickk"></div>'; document.body.appendChild(stickEl);
const stickK = stickEl.firstChild; const SR = 62;
canvas.addEventListener('pointerdown', (e) => {
  takeOver(); try { canvas.setPointerCapture(e.pointerId); } catch (er) {}
  const leftSide = e.pointerType !== 'mouse' && e.clientX < innerWidth * 0.5;
  if (leftSide && !fp.stick) {
    fp.stick = { id: e.pointerId, x: e.clientX, y: e.clientY };
    stickEl.style.left = e.clientX + 'px'; stickEl.style.top = e.clientY + 'px'; stickEl.classList.add('on'); stickK.style.transform = '';
  } else fp.look.set(e.pointerId, { x: e.clientX, y: e.clientY });
  requestRender();
});
canvas.addEventListener('pointermove', (e) => {
  if (fp.stick && e.pointerId === fp.stick.id) {
    let dx = e.clientX - fp.stick.x, dy = e.clientY - fp.stick.y; const l = Math.hypot(dx, dy); if (l > SR) { dx *= SR / l; dy *= SR / l; }
    stickK.style.transform = `translate(${dx}px,${dy}px)`; fp.mv.x = dx / SR; fp.mv.y = dy / SR; return;
  }
  const L = fp.look.get(e.pointerId); if (!L) return;
  const k = (e.pointerType === 'mouse' ? 2.6 : 3.4) / Math.max(innerWidth, 600);
  fp.yaw += (e.clientX - L.x) * k; fp.pitch -= (e.clientY - L.y) * k * 0.85; fp.pitch = THREE.MathUtils.clamp(fp.pitch, -1.25, 1.25);
  L.x = e.clientX; L.y = e.clientY; dirty = true;
});
const endPtr = (e) => {
  if (fp.stick && e.pointerId === fp.stick.id) { fp.stick = null; fp.mv.x = fp.mv.y = 0; stickEl.classList.remove('on'); }
  fp.look.delete(e.pointerId);
};
canvas.addEventListener('pointerup', endPtr); canvas.addEventListener('pointercancel', endPtr);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); if (!fp.active) takeOver(); fp.wheel += -Math.sign(e.deltaY) * 0.45; }, { passive: false });
// Wände: von draußen nach drinnen nur durch die Türen
{ const H = document.getElementById('help'), ok = document.getElementById('helpOk');
  if (H && ok) { let seen = false; try { seen = localStorage.getItem('b3d_help2') === '1'; } catch (e) {} if (seen && !isMobile) H.classList.add('off');
    ok.onclick = () => { H.classList.add('off'); try { localStorage.setItem('b3d_help2', '1'); } catch (e) {} }; } }
const DOORS = [[1.30, 2.10], [4.10, 6.10], [6.75, 7.75]];
function walkable(x, z) {
  if (z >= 0.25) return x > -14 && x < 27 && z < 22;                       // Straße / Gehweg
  if (z <= -0.6) return x > 0.55 && x < 11.7 && z > -7.1 && (x < 7.6 || z > -2.6); // Spätkauf + Bertolino-Küche
  return DOORS.some(([a, b]) => x > a + 0.22 && x < b - 0.22);              // im Türrahmen
}
function walk(dt) {
  const stickOn = Math.hypot(fp.mv.x, fp.mv.y) > 0.12;
  const keys = held.size && !(held.size === 1 && held.has('fast'));
  const looking = fp.look.size > 0;
  if (!fp.active || (!stickOn && !keys && !looking && Math.abs(fp.wheel) < 0.01)) return false;
  // Bewegung relativ zur Blickrichtung (nur waagerecht)
  _f.set(Math.sin(fp.yaw), 0, -Math.cos(fp.yaw)); _r.crossVectors(_f, _up);
  let fwd = 0, side = 0, turn = 0, rise = 0;
  if (stickOn) { const m = Math.min(1, Math.hypot(fp.mv.x, fp.mv.y)); fwd = -fp.mv.y; side = fp.mv.x; const n = Math.hypot(fwd, side) || 1; fwd *= m / n; side *= m / n; }
  if (held.has('f')) fwd += 1; if (held.has('b')) fwd -= 1; if (held.has('r')) side += 1; if (held.has('l')) side -= 1;
  if (held.has('tl')) turn -= 1; if (held.has('tr')) turn += 1; if (held.has('u')) rise += 1; if (held.has('d')) rise -= 1;
  const speed = held.has('fast') ? 4.5 : 2.4;
  _m.set(0, 0, 0).addScaledVector(_f, fwd * speed * dt).addScaledVector(_r, side * speed * dt);
  if (Math.abs(fp.wheel) > 0.01) { const st = fp.wheel * Math.min(1, dt * 8); _m.addScaledVector(_f, st); fp.wheel -= st; }
  fp.yaw += turn * 1.7 * dt;
  const moving = _m.lengthSq() > 1e-8;
  if (moving) {
    _p0.copy(camera.position); const nx = _p0.x + _m.x, nz = _p0.z + _m.z;
    if (!walkable(_p0.x, _p0.z) || walkable(nx, nz)) { camera.position.x = nx; camera.position.z = nz; }
    else if (walkable(nx, _p0.z)) camera.position.x = nx;      // an der Wand entlang rutschen
    else if (walkable(_p0.x, nz)) camera.position.z = nz;
    // beim Laufen auf Augenhöhe (1,65 m) gleiten
    if (!rise) camera.position.y += (fp.eye - camera.position.y) * Math.min(1, dt * 2.5);
  }
  if (rise) camera.position.y = THREE.MathUtils.clamp(camera.position.y + rise * 1.5 * dt, 0.9, 20);
  // Blickpunkt vor die Kamera setzen
  _m.set(Math.sin(fp.yaw) * Math.cos(fp.pitch), Math.sin(fp.pitch), -Math.cos(fp.yaw) * Math.cos(fp.pitch));
  controls.target.copy(camera.position).addScaledVector(_m, 2.0);
  return true;
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
  if (walk(dt)) dirty = true;
  if (controls.update()) dirty = true;
  { const d = camera.position.distanceTo(controls.target); if (d < 0.6) { _m.subVectors(controls.target, camera.position).normalize(); controls.target.copy(camera.position).addScaledVector(_m, 1.1); controls.update(); dirty = true; } }
  if (camera.position.y < 0.9) { const d = 0.9 - camera.position.y; camera.position.y += d; controls.target.y += d; dirty = true; }
  { const px = THREE.MathUtils.clamp(camera.position.x, -14, 27), pz = THREE.MathUtils.clamp(camera.position.z, -12, 24), py = Math.min(camera.position.y, 26); if (px !== camera.position.x || pz !== camera.position.z || py !== camera.position.y) { _m.set(px - camera.position.x, py - camera.position.y, pz - camera.position.z); camera.position.add(_m); controls.target.add(_m); dirty = true; } }
  frameCounter++;
  if (ext.animate && ext.animate(dt)) dirty = true;
  if (!dirty) return;
  dirty = false;
  composer.render();
  if (dimGroup.visible) labelRenderer.render(scene, camera);
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
document.getElementById('hint').textContent = isMobile ? 'Links = laufen · rechts = umschauen' : 'W A S D / Pfeile = laufen · Maus ziehen = umschauen · Mausrad = vor/zurück';

setTimeout(() => { const h = document.getElementById('hint'); if (h) h.style.opacity = 0; }, 9000);
if (isMobile) { const h = document.getElementById('hint'); if (h) h.style.display = 'none'; }
{ const z = document.getElementById('zones'); if (z) { if (!isMobile) z.style.display = 'none'; else setTimeout(() => { z.style.opacity = 0; }, 20000); } }
addEventListener('resize', () => { if (curView && V[curView] && !fp.active) goView(curView, true); });

// hooks for automated screenshots
window.__setView = (v, m) => {
  frameCounter++;
  if (m) setMode(m);
  if (typeof v === 'string') goView(v, true);
  else { camera.position.set(...v.pos); controls.target.set(...v.target); camera.fov = v.fov || 55; camera.updateProjectionMatrix(); controls.update(); }
  composer.render();
  if (dimGroup.visible) labelRenderer.render(scene, camera);
};
window.__scene = scene; window.__camera = camera;
window.__stats = () => { composer.render(); return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, geos: renderer.info.memory.geometries, texs: renderer.info.memory.textures }; };
window.__dims = (on) => { dimGroup.visible = on; document.getElementById('tDim').classList.toggle('on', on); };
