// Le Fleur – Raum in 3D. Licht vorberechnet (bake.py → lightmap.png), alles andere hier.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const qs = new URLSearchParams(location.search);
const VQ = (() => { try { return new URL(import.meta.url).search || ''; } catch (e) { return ''; } })();   // ?v=… gegen alte Zwischenspeicher
const TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const [RL, RM] = await Promise.all(['leer', 'matcha'].map(v => fetch(`room_${v}.json` + VQ).then(r => r.json())));
const R = RM, S = R.spec, { W, L, H } = S;                  // Atlas-Aufteilung ist in beiden Varianten gleich
const [AW, AH] = R.atlas;
const OTHER = { 0: [1, 2], 1: [0, 2], 2: [0, 1] };
const QN = Object.fromEntries(R.quads.map(q => [q.name, q]));
const EYE = 1.62;

// ------------------------------------------------------------------ Grundgerüst
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = +(qs.get('tm') || 1.06);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0xeceeed);
const camera = new THREE.PerspectiveCamera(72, 1, 0.03, 80);
let needRender = true; const req = () => { needRender = true; };

// ------------------------------------------------------------------ Lichtkarten (leer + Matcha)
const s2l = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const EXPO = +(qs.get('exp') || 0.0017);                 // Bestrahlung -> Bildhelligkeit
async function loadLM(name, K) {
  const url = URL.createObjectURL(await fetch(`lm_${name}.png` + VQ).then(r => r.blob()));      // über blob: (erlaubt im Artifact-Rahmen)
  const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
  const tex = new THREE.Texture(img); tex.colorSpace = THREE.SRGBColorSpace; tex.channel = 1;
  tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.needsUpdate = true;
  const c = document.createElement('canvas'); c.width = AW; c.height = AH; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  return { tex, pix: g.getImageData(0, 0, AW, AH).data, K, LMI: Math.PI * EXPO / K };
}
const [LML, LMM] = await Promise.all([loadLM('leer', RL.lmK), loadLM('matcha', RM.lmK)]);
const LMS = { leer: LML, matcha: LMM };
let LOOK = qs.get('m') === 'leer' ? 'leer' : 'matcha', LM = LMS[LOOK];

function lmXY(q, p) {
  const [a, b] = OTHER[q.n];
  const fu = Math.min(1, Math.max(0, (p[a] - q.u[0]) / (q.u[1] - q.u[0]))), fv = Math.min(1, Math.max(0, (p[b] - q.v[0]) / (q.v[1] - q.v[0])));
  return [q.lm[0] + Math.min(q.nu - 0.5, Math.max(0.5, fu * q.nu)), q.lm[1] + Math.min(q.nv - 0.5, Math.max(0.5, fv * q.nv))];
}
const lmUV = (q, p) => { const [x, y] = lmXY(q, p); return [x / AW, 1 - y / AH]; };
function lmSample(q, p, lm = LML) {                         // Bestrahlung an einem Punkt (linear, schon mit EXPO)
  const lmPix = lm.pix;
  const [x, y] = lmXY(q, p); const x0 = Math.floor(x - 0.5), y0 = Math.floor(y - 0.5), fx = x - 0.5 - x0, fy = y - 0.5 - y0;
  const o = [0, 0, 0];
  for (const [dx, dy, w] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]]) {
    const i = ((y0 + dy) * AW + (x0 + dx)) * 4; for (let k = 0; k < 3; k++) o[k] += s2l(lmPix[i + k]) * w;
  }
  return o.map(v => v / lm.K * EXPO);
}

// ------------------------------------------------------------------ Texturen (gezeichnet)
function cnv(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); return c; }
function rnd(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const maxAniso = renderer.capabilities.getMaxAnisotropy();
function tex(c, rx, ry, srgb = true) { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.anisotropy = Math.min(8, maxAniso); return t; }
// Feinsteinzeug 60 × 60, warmes Hellgrau, leicht wolkig (Fotos: Boden)
const TILE = 0.6, FT = 2.4;
const floorTex = tex(cnv(2048, 2048, (g, w, h) => {
  const r = rnd(7), px = w / FT;
  g.fillStyle = 'rgb(197,192,183)'; g.fillRect(0, 0, w, h);
  for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 4; tx++) {
    const v = (r() - 0.5) * 10; g.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 250 : 0},${v > 0 ? 240 : 0},${Math.abs(v) / 120})`; g.fillRect(tx * TILE * px, ty * TILE * px, TILE * px, TILE * px);
  }
  for (let i = 0; i < 2600; i++) {                          // Wolken
    const x = r() * w, y = r() * h, rr = 8 + r() * 70, d = r() < 0.5;
    const gr = g.createRadialGradient(x, y, 0, x, y, rr); gr.addColorStop(0, d ? 'rgba(120,112,100,0.05)' : 'rgba(255,252,245,0.06)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - rr, y - rr, 2 * rr, 2 * rr);
  }
  for (let i = 0; i < 9000; i++) { const x = r() * w, y = r() * h, c = 120 + r() * 120; g.fillStyle = `rgba(${c},${c - 4},${c - 10},0.25)`; g.fillRect(x, y, 1.3, 1.3); }
  g.fillStyle = 'rgb(160,154,144)';                         // Fugen 3 mm
  for (let k = 0; k <= 4; k++) { const p = k * TILE * px; g.fillRect(p - 1.6, 0, 3.2, h); g.fillRect(0, p - 1.6, w, 3.2); }
}), 1 / FT, 1 / FT);
const woodTex = tex(cnv(512, 2048, (g, w, h) => {          // Eiche-Optik, Maserung entlang v (Regal-Länge)
  const r = rnd(11); g.fillStyle = 'rgb(158,112,78)'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 140; i++) {
    const x = r() * w, a = 0.05 + r() * 0.12, wd = 1 + r() * 4, dark = r() < 0.6; g.strokeStyle = dark ? `rgba(80,48,28,${a})` : `rgba(210,170,130,${a})`; g.lineWidth = wd;
    g.beginPath(); let xx = x; g.moveTo(xx, 0); for (let y = 0; y <= h; y += 32) { xx += (r() - 0.5) * 3; g.lineTo(xx, y); } g.stroke();
  }
  for (let i = 0; i < 6; i++) { const y = r() * h, x = r() * w; g.fillStyle = 'rgba(90,55,30,0.18)'; g.beginPath(); g.ellipse(x, y, 6 + r() * 10, 30 + r() * 50, 0, 0, 6.3); g.fill(); }
}), 1 / 0.6, 1 / 2.4);
const stoneTex = tex(cnv(512, 512, (g, w, h) => { const r = rnd(5); g.fillStyle = 'rgb(118,120,124)'; g.fillRect(0, 0, w, h); for (let i = 0; i < 6000; i++) { const c = 60 + r() * 120; g.fillStyle = `rgba(${c},${c},${c + 4},0.55)`; g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); } }), 1 / 0.5, 1 / 0.5);
const radTex = tex(cnv(16, 256, (g, w, h) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 16) { const gr = g.createLinearGradient(0, y, 0, y + 16); gr.addColorStop(0, '#d9d9d7'); gr.addColorStop(0.25, '#ffffff'); gr.addColorStop(0.8, '#f4f4f2'); gr.addColorStop(1, '#c9c9c7'); g.fillStyle = gr; g.fillRect(0, y, w, 16); } }), 1, 1 / 0.533);
const slatTex = tex(cnv(16, 256, (g, w, h) => { for (let y = 0; y < h; y += 32) { const gr = g.createLinearGradient(0, y, 0, y + 32); gr.addColorStop(0, '#6d7479'); gr.addColorStop(0.12, '#a2a9ad'); gr.addColorStop(0.7, '#949b9f'); gr.addColorStop(0.92, '#7c8388'); gr.addColorStop(1, '#5f666b'); g.fillStyle = gr; g.fillRect(0, y, w, 32); } }), 1, 1 / 0.32);

// ------------------------------------------------------------------ Materialien
const lin = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace);
const BAKED = [];
function bakedMat(color, map = null, extra = {}) { const m = new THREE.MeshBasicMaterial({ color, map, lightMap: LM.tex, lightMapIntensity: LM.LMI, dithering: true, ...extra }); BAKED.push(m); return m; }
const C_WALL = lin(...RL.alb.wall), C_GREEN = lin(...S.GREEN), C_GREEN2 = lin(0.29, 0.385, 0.19);   // Bogen innen etwas kräftiger
const MAT = {
  wall: bakedMat(lin(...R.alb.wall)), ceil: bakedMat(lin(...R.alb.ceil)),
  floor: bakedMat(lin(1, 1, 1), floorTex), stone: bakedMat(lin(1, 1, 1), stoneTex),
  window: bakedMat(lin(...R.alb.window)), wood: bakedMat(lin(1, 1, 1), woodTex), rad: bakedMat(lin(1, 1, 1).multiplyScalar(0.82), radTex),
  edoor: bakedMat(lin(...R.alb.edoor)), paintC: bakedMat(C_WALL.clone()), archIn: bakedMat(C_WALL.clone()),
};
const WALLOF = (name) => name === 'floor' ? null : name.startsWith('wallA') || name.startsWith('ni_') || name === 'window' || name.startsWith('sill') || name === 'floor_niche' ? 'A'
  : name.startsWith('wallB') || name.startsWith('pas_') || name.startsWith('ves') || name === 'edoor' || name.endsWith('_pass') || name.endsWith('_ves') || name.startsWith('shelf') || name.startsWith('rad') ? 'B'
  : name.startsWith('wallC') ? 'C' : name.startsWith('wallD') ? 'D' : name.startsWith('ceil') ? 'top' : null;

const room = new THREE.Group(); scene.add(room);
const tagged = [];                                          // für die Ansicht von oben: Wand-Zugehörigkeit
function add(obj, wall) { obj.userData.wall = wall; room.add(obj); if (wall) tagged.push(obj); return obj; }

// Rechteck aus room.json (mit Lichtkarte) – optional mit Löchern (Bogen in Wand C)
function quadGeo(q, holes = null) {
  const [a, b] = OTHER[q.n]; const P = [], UV = [], UV1 = [], N = []; let idx;
  const put = (u, v) => { const p = [0, 0, 0]; p[q.n] = q.c; p[a] = u; p[b] = v; P.push(...p); UV.push(u, v); UV1.push(...lmUV(q, p)); const n = [0, 0, 0]; n[q.n] = q.s; N.push(...n); };
  if (!holes) { put(q.u[0], q.v[0]); put(q.u[1], q.v[0]); put(q.u[1], q.v[1]); put(q.u[0], q.v[1]); idx = [0, 1, 2, 0, 2, 3]; }
  else {
    const sh = new THREE.Shape([new THREE.Vector2(q.u[0], q.v[0]), new THREE.Vector2(q.u[1], q.v[0]), new THREE.Vector2(q.u[1], q.v[1]), new THREE.Vector2(q.u[0], q.v[1])]);
    for (const hp of holes) sh.holes.push(new THREE.Path(hp));
    const sg = new THREE.ShapeGeometry(sh, 24); const pp = sg.attributes.position;
    for (let i = 0; i < pp.count; i++) put(pp.getX(i), pp.getY(i));
    idx = Array.from(sg.index.array); sg.dispose();
  }
  // Vorderseite muss zur Normalen zeigen
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); g.setAttribute('uv1', new THREE.Float32BufferAttribute(UV1, 2));
  const v = (i) => new THREE.Vector3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
  const c = new THREE.Vector3().subVectors(v(idx[1]), v(idx[0])).cross(new THREE.Vector3().subVectors(v(idx[2]), v(idx[0])));
  if (c.getComponent(q.n) * q.s < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  g.setIndex(idx); return g;
}
// Bogen-Umriss (Wand C, in x/y)
const AR = S.ARCH, ar = AR.w / 2, BB = 0.075;              // Sockelleiste
function archPts(seg = 28) {
  const pts = [new THREE.Vector2(AR.cx - ar, BB), new THREE.Vector2(AR.cx + ar, BB)];
  for (let i = 0; i <= seg; i++) { const t = i / seg * Math.PI; pts.push(new THREE.Vector2(AR.cx + ar * Math.cos(t), AR.top - ar + ar * Math.sin(t))); }
  return pts;
}
for (const q of R.quads) {
  if (q.name === 'window' || q.f) continue;                // Fenster: nur für die Lichtkarte; Möbel: siehe Matcha-Entwurf
  const g = q.name === 'wallC' ? quadGeo(q, [archPts()]) : quadGeo(q);
  const m = new THREE.Mesh(g, MAT[q.mat]); m.name = q.name; add(m, WALLOF(q.name));
}
// UV für Teile, die auf einer gebackenen Fläche sitzen (Lichtkarte dieser Fläche übernehmen)
function hostUV(geo, host) {
  const q = QN[host], p = geo.attributes.position, uv1 = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { const [u, v] = lmUV(q, [p.getX(i), p.getY(i), p.getZ(i)]); uv1[i * 2] = u; uv1[i * 2 + 1] = v; }
  geo.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2)); return geo;
}
function boxG(x0, x1, y0, y1, z0, z1) { const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0); g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); return g; }
function hostBox(host, wall, mat, x0, x1, y0, y1, z0, z1) { return add(new THREE.Mesh(hostUV(boxG(x0, x1, y0, y1, z0, z1), host), mat), wall); }
const flatMat = (host, p, alb, extra = {}) => { const e = lmSample(QN[host], p); return new THREE.MeshBasicMaterial({ color: lin(alb[0] * e[0], alb[1] * e[1], alb[2] * e[2]), ...extra }); };

// ------------------------------------------------------------------ Bogen-Nische mit Neon „le Fleur“
{
  const pts = archPts(); const sh = new THREE.Shape(pts);
  const g = new THREE.ShapeGeometry(sh, 24); g.translate(0, 0, L + AR.rec);
  const idx = g.index.array; for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  g.computeVertexNormals(); add(new THREE.Mesh(hostUV(g, 'wallC'), MAT.archIn), 'C');
  // Laibung (1,8 cm) – oben dunkler (zeigt nach unten), Seiten mittel
  const P = [], C = [], U1 = []; const ring = pts.slice(1).concat([pts[0]]);   // rechts unten -> Bogen -> links unten
  const order = [pts[1], ...pts.slice(2), pts[0]];
  for (let i = 0; i < order.length - 1; i++) {
    const a = order[i], b = order[i + 1]; const nx = -(b.y - a.y), ny = (b.x - a.x); const ln = Math.hypot(nx, ny) || 1;
    const f = 0.42 + 0.3 * (1 - Math.abs(ny / ln));                                         // Bogen oben (zeigt nach unten) dunkler
    for (const [p, z] of [[a, L], [b, L], [b, L + AR.rec], [a, L], [b, L + AR.rec], [a, L + AR.rec]]) { P.push(p.x, p.y, z); C.push(f, f, f); }
  }
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); lg.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  MAT.reveal = bakedMat(C_WALL.clone(), null, { vertexColors: true, side: THREE.DoubleSide });
  add(new THREE.Mesh(hostUV(lg, 'wallC'), MAT.reveal), 'C');
}
await document.fonts.load('200px Sacramento').catch(() => {});
const neonOn = { v: true };
const neonMat = new THREE.MeshBasicMaterial({ transparent: true, toneMapped: false, depthWrite: false });
const neonGlowMat = new THREE.MeshBasicMaterial({ transparent: true, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending });
function drawNeon() {
  const on = neonOn.v;
  const c = cnv(1024, 360, (g, w, h) => {
    g.font = '230px Sacramento, "Segoe Script", cursive'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const tx = w / 2, ty = h / 2 + 12;
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.strokeStyle = 'rgba(235,240,240,0.10)'; g.lineWidth = 46; g.strokeText('le Fleur', tx, ty);   // Acryl-Platte
    g.strokeStyle = 'rgba(140,146,146,0.55)'; g.lineWidth = 2.5; g.strokeText('le Fleur', tx, ty);
    g.strokeStyle = 'rgba(120,124,124,0.75)'; g.lineWidth = 12; g.strokeText('le Fleur', tx, ty);          // Schlauch-Kante
    if (on) { g.shadowColor = 'rgba(255,240,215,0.9)'; g.shadowBlur = 10; }
    g.strokeStyle = on ? '#fff6e6' : '#eef0f0'; g.lineWidth = 8; g.strokeText('le Fleur', tx, ty); if (on) g.strokeText('le Fleur', tx, ty);
  });
  neonMat.map?.dispose(); neonMat.map = new THREE.CanvasTexture(c); neonMat.map.colorSpace = THREE.SRGBColorSpace; neonMat.needsUpdate = true;
  const sNeon = on ? 0.98 : 0.62; neonMat.color.setScalar(sNeon);
  neonGlowMat.opacity = on ? 0.16 : 0; req();
}
{
  const nx = AR.cx - 0.03, ny = 1.37, z = L + AR.rec - 0.03;            // vom Raum aus leicht rechts der Mitte
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.211), neonMat); sign.position.set(nx, ny, z); sign.rotation.y = Math.PI; sign.name = 'neon'; add(sign, 'C');
  const gc = cnv(256, 256, (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); gr.addColorStop(0, 'rgba(255,244,225,0.55)'); gr.addColorStop(0.45, 'rgba(255,240,220,0.18)'); gr.addColorStop(1, 'rgba(255,240,220,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  neonGlowMat.map = new THREE.CanvasTexture(gc);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.5), neonGlowMat); glow.position.set(nx, ny, L + AR.rec - 0.002); glow.rotation.y = Math.PI; add(glow, 'C');
  drawNeon();
  // Kabel zur Steckdose unten links in der Nische, mit Schnurschalter
  const cm = flatMat('wallC', [AR.cx + ar, 0.8, L], [0.86, 0.86, 0.86]);
  const xl = AR.cx + ar - 0.035, zc = L + AR.rec - 0.006;                // vom Raum aus linke Bogenkante
  add(new THREE.Mesh(boxG(nx + 0.27, xl, 1.315, 1.322, zc - 0.004, zc), cm), 'C');
  add(new THREE.Mesh(boxG(xl - 0.0035, xl + 0.0035, 0.2, 1.322, zc - 0.004, zc), cm), 'C');
  add(new THREE.Mesh(boxG(xl - 0.012, xl + 0.012, 0.82, 0.88, zc - 0.016, zc), flatMat('wallC', [xl, 0.85, L], [0.9, 0.9, 0.9])), 'C');
  add(new THREE.Mesh(new THREE.CircleGeometry(0.004, 12).rotateY(Math.PI).translate(xl, 0.86, zc - 0.0165), new THREE.MeshBasicMaterial({ color: 0x3aa0ff, toneMapped: false })), 'C');
}

// ------------------------------------------------------------------ Steckdosen und Schalter
const plateTex = (kind) => new THREE.CanvasTexture(cnv(128, 128, (g, w, h) => {
  g.fillStyle = '#f7f7f5'; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 3; g.strokeRect(10, 10, w - 20, h - 20);
  if (kind === 'socket') { const gr = g.createRadialGradient(64, 64, 8, 64, 64, 40); gr.addColorStop(0, '#d8d8d6'); gr.addColorStop(1, '#efefed'); g.fillStyle = gr; g.beginPath(); g.arc(64, 64, 38, 0, 7); g.fill(); g.fillStyle = '#555'; g.beginPath(); g.arc(50, 64, 6, 0, 7); g.arc(78, 64, 6, 0, 7); g.fill(); }
  else { g.fillStyle = '#fbfbf9'; g.fillRect(28, 22, 72, 84); g.strokeStyle = 'rgba(0,0,0,0.15)'; g.strokeRect(28, 22, 72, 84); }
}));
const TEXS = { socket: plateTex('socket'), switch: plateTex('switch') };
for (const t of Object.values(TEXS)) t.colorSpace = THREE.SRGBColorSpace;
function plate(host, wall, kind, p, count = 1, vertical = false, shift = 0) {
  const q = QN[host], n = q.n, s = q.s, e = lmSample(q, p), sz = 0.082;
  const mat = new THREE.MeshBasicMaterial({ map: TEXS[kind], color: lin(0.9 * e[0], 0.9 * e[1], 0.9 * e[2]) });
  const side = new THREE.MeshBasicMaterial({ color: lin(0.7 * e[0], 0.7 * e[1], 0.7 * e[2]) });
  for (let i = 0; i < count; i++) {
    const g = new THREE.BoxGeometry(sz, sz, 0.012);
    const m = new THREE.Mesh(g, [side, side, side, side, mat, side]);
    const off = (i - (count - 1) / 2) * sz;
    const pos = new THREE.Vector3(...p); pos.setComponent(n, q.c + s * 0.006 + shift);
    if (n === 2) { m.rotation.y = s > 0 ? 0 : Math.PI; if (vertical) pos.y += off; else pos.x += off * (s > 0 ? 1 : -1); }
    else { m.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2; if (vertical) pos.y += off; else pos.z += off * (s > 0 ? -1 : 1); }
    m.position.copy(pos); add(m, wall);
  }
}
plate('wallA_r', 'A', 'socket', [3.95, 0.27, 0], 2);
plate('wallD', 'D', 'socket', [0, 0.27, 0.28], 1);
plate('wallD', 'D', 'socket', [0, 0.27, 3.25], 2);
plate('wallD', 'D', 'socket', [0, 0.27, 4.9], 2);
plate('wallC', 'C', 'socket', [W - 0.32, 0.27, L], 2);
plate('wallC', 'C', 'socket', [AR.cx + ar - 0.07, 0.16, L], 1, false, AR.rec);
plate('wallB_b', 'B', 'switch', [W, 1.05, S.DOOR.z0 - 0.22], 2);
plate('ves_far_a', 'B', 'switch', [S.VES.x1, 1.05, 0.72], 2, true);

// ------------------------------------------------------------------ Sicherungskasten (Wand C)
{
  const P = S.PANEL, e = lmSample(QN.wallC, [P.cx, (P.y0 + P.y1) / 2, L]);
  const m = new THREE.MeshBasicMaterial({ color: lin(0.88 * e[0], 0.88 * e[1], 0.87 * e[2]) });
  const mr = new THREE.MeshBasicMaterial({ color: lin(0.66 * e[0], 0.66 * e[1], 0.66 * e[2]) });
  const g = boxG(P.cx - P.w / 2, P.cx + P.w / 2, P.y0, P.y1, L - 0.01, L);
  add(new THREE.Mesh(g, [mr, mr, mr, mr, mr, m]), 'C');
  const fr = 0.022; const inner = new THREE.MeshBasicMaterial({ color: lin(0.9 * e[0], 0.9 * e[1], 0.9 * e[2]) });
  add(new THREE.Mesh(boxG(P.cx - P.w / 2 + fr, P.cx + P.w / 2 - fr, P.y0 + fr, P.y1 - fr, L - 0.0125, L - 0.01), [mr, mr, mr, mr, mr, inner]), 'C');
  add(new THREE.Mesh(new THREE.CircleGeometry(0.009, 16).rotateY(Math.PI).translate(P.cx + P.w / 2 - 0.04, (P.y0 + P.y1) / 2 + 0.1, L - 0.0128), new THREE.MeshBasicMaterial({ color: lin(0.55 * e[0], 0.55 * e[1], 0.55 * e[2]) })), 'C');
}

// ------------------------------------------------------------------ Sockelleisten (Fliese)
{
  const bm = bakedMat(lin(0.92, 0.92, 0.92), floorTex);
  const T = 0.012;
  const seg = (host, wall, x0, x1, z0, z1) => hostBox(host, wall, bm, x0, x1, 0, BB, z0, z1);
  seg('wallD', 'D', 0, T, 0, L);
  seg('wallC', 'C', 0, W, L - T, L);
  seg('wallA_l', 'A', 0, S.NI.x0, 0, T); seg('wallA_r', 'A', S.NI.x1, W, 0, T);
  seg('ni_l', 'A', S.NI.x0, S.NI.x0 + T, -S.NI.d, 0); seg('ni_r', 'A', S.NI.x1 - T, S.NI.x1, -S.NI.d, 0);
  seg('ni_back_lo', 'A', S.NI.x0, S.NI.x1, -S.NI.d, -S.NI.d + T);
  seg('wallB_a', 'B', W - T, W, 0, S.PAS.z0); seg('wallB_b', 'B', W - T, W, S.PAS.z1, S.DOOR.z0 - S.DOOR.frame); seg('wallB_b', 'B', W - T, W, S.DOOR.z1 + S.DOOR.frame, L);
  seg('ves_far_a', 'B', S.VES.x1 - T, S.VES.x1, S.VES.z0, S.EDOOR.z0); seg('ves_side0', 'B', W + S.PAS.t, S.VES.x1, S.VES.z0, S.VES.z0 + T);
  seg('ves_side1', 'B', W + S.PAS.t, S.VES.x1, S.VES.z1 - T, S.VES.z1); seg('ves_near_r', 'B', W + S.PAS.t, W + S.PAS.t + T, S.PAS.z1, S.VES.z1);
}

// ------------------------------------------------------------------ Fenster mit Rollladen (Nischen-Rückwand z = -d)
{
  const N = S.NI, F = S.WIN, z = -N.d, y0 = S.SILL.y + S.SILL.t, y1 = F.y1, x0 = F.x0, x1 = F.x1;
  const fm = bakedMat(lin(0.86, 0.86, 0.85)); const fr = 0.068, sf = 0.078, xm = (x0 + x1) / 2;
  const B = (a, b, c, d, z0, z1) => hostBox('window', 'A', fm, a, b, c, d, z0, z1);
  B(x0, x1, y1 - fr, y1, z, z + 0.012); B(x0, x1, y0, y0 + fr, z, z + 0.012); B(x0, x0 + fr, y0, y1, z, z + 0.012); B(x1 - fr, x1, y0, y1, z, z + 0.012);
  for (const [a, b] of [[x0 + fr, xm - 0.002], [xm + 0.002, x1 - fr]]) {   // zwei Flügel
    B(a, b, y1 - fr - sf, y1 - fr, z + 0.006, z + 0.03); B(a, b, y0 + fr, y0 + fr + sf, z + 0.006, z + 0.03);
    B(a, a + sf, y0 + fr, y1 - fr, z + 0.006, z + 0.03); B(b - sf, b, y0 + fr, y1 - fr, z + 0.006, z + 0.03);
    // Glas: Rollladen dahinter, leichte Spiegelung davor
    const gx0 = a + sf, gx1 = b - sf, gy0 = y0 + fr + sf, gy1 = y1 - fr - sf;
    const e = lmSample(QN.window, [(gx0 + gx1) / 2, (gy0 + gy1) / 2, z]);
    const sl = new THREE.Mesh(new THREE.PlaneGeometry(gx1 - gx0, gy1 - gy0), new THREE.MeshBasicMaterial({ map: slatTex, color: lin(0.78 * e[0], 0.8 * e[1], 0.82 * e[2]) }));
    sl.geometry.attributes.uv.array.forEach((v, i, arr) => { if (i % 2 === 1) arr[i] = v * (gy1 - gy0); }); sl.position.set((gx0 + gx1) / 2, (gy0 + gy1) / 2, z - 0.06); add(sl, 'A');
    const gl = cnv(64, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, 'rgba(255,255,255,0.16)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.03)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.10)'); gr.addColorStop(1, 'rgba(255,255,255,0.02)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(gx1 - gx0, gy1 - gy0), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(gl), transparent: true, depthWrite: false }));
    glass.position.set((gx0 + gx1) / 2, (gy0 + gy1) / 2, z + 0.012); add(glass, 'A');
    // Griff (cremeweiß) am Mittelstoß
    const hx = a === x0 + fr ? b - sf / 2 : a + sf / 2, hy = (y0 + y1) / 2 - 0.05, eh = lmSample(QN.window, [hx, hy, z]);
    const hm = new THREE.MeshBasicMaterial({ color: lin(0.86 * eh[0], 0.83 * eh[1], 0.75 * eh[2]) });
    add(new THREE.Mesh(boxG(hx - 0.016, hx + 0.016, hy - 0.035, hy + 0.035, z + 0.03, z + 0.042), hm), 'A');
    add(new THREE.Mesh(boxG(hx - 0.009, hx + 0.009, hy - 0.13, hy, z + 0.042, z + 0.062), hm), 'A');
  }
  // Rollladengurt rechts mit Gurtwickler
  const bx = x1 + 0.12, eb = lmSample(QN.ni_back_r, [bx, 1.7, z]);
  add(new THREE.Mesh(boxG(bx - 0.011, bx + 0.011, 1.6, N.top, z + 0.004, z + 0.007), new THREE.MeshBasicMaterial({ color: lin(0.25 * eb[0], 0.25 * eb[1], 0.26 * eb[2]) })), 'A');
  add(new THREE.Mesh(boxG(bx - 0.03, bx + 0.03, 1.42, 1.62, z, z + 0.045), new THREE.MeshBasicMaterial({ color: lin(0.12 * eb[0], 0.12 * eb[1], 0.13 * eb[2]) })), 'A');
}

// ------------------------------------------------------------------ Tür (Wand B) und Eingangstür im Windfang
{
  const D = S.DOOR, x = W, e = lmSample(QN.wallB_b, [x, 1.0, (D.z0 + D.z1) / 2]);
  const white = bakedMat(lin(0.9, 0.9, 0.89)); const fr = D.frame;
  const B = (a, b, c, d, z0, z1, m = white) => hostBox('wallB_b', 'B', m, a, b, c, d, z0, z1);
  B(x - 0.014, x, 0, D.h + fr, D.z0 - fr, D.z0); B(x - 0.014, x, 0, D.h + fr, D.z1, D.z1 + fr); B(x - 0.014, x, D.h, D.h + fr, D.z0 - fr, D.z1 + fr);
  B(x - 0.006, x, 0.005, D.h - 0.003, D.z0 + 0.002, D.z1 - 0.002);
  // Fuge zwischen Blatt und Zarge
  const gap = new THREE.MeshBasicMaterial({ color: lin(0.35 * e[0], 0.35 * e[1], 0.35 * e[2]) });
  add(new THREE.Mesh(boxG(x - 0.0065, x - 0.0055, 0.005, D.h - 0.003, D.z1 - 0.004, D.z1 - 0.002), gap), 'B');
  add(new THREE.Mesh(boxG(x - 0.0065, x - 0.0055, 0.005, D.h - 0.003, D.z0 + 0.002, D.z0 + 0.004), gap), 'B');
  // Drücker (Edelstahl / Messing matt) + Schlüsselschild
  const hm = new THREE.MeshBasicMaterial({ color: lin(0.55 * e[0], 0.5 * e[1], 0.38 * e[2]) }), hz = D.z0 + 0.07;
  add(new THREE.Mesh(boxG(x - 0.012, x - 0.006, 0.98, 1.18, hz - 0.02, hz + 0.02), hm), 'B');
  add(new THREE.Mesh(boxG(x - 0.07, x - 0.012, 1.06, 1.082, hz - 0.011, hz + 0.011), hm), 'B');
  add(new THREE.Mesh(boxG(x - 0.075, x - 0.055, 1.06, 1.082, hz, hz + 0.13), hm), 'B');
  add(new THREE.Mesh(boxG(x - 0.0135, x - 0.012, 1.0, 1.03, hz - 0.004, hz + 0.004), new THREE.MeshBasicMaterial({ color: 0x1a1a1a })), 'B');
  // Eingangstür Alu/Glas (anthrazit) im Windfang
  const E2 = S.EDOOR, xf = S.VES.x1, ee = lmSample(QN.edoor, [xf, 1.1, (E2.z0 + E2.z1) / 2]);
  const al = new THREE.MeshBasicMaterial({ color: lin(0.11 * ee[0], 0.115 * ee[1], 0.12 * ee[2]) }), f2 = 0.07;
  const A2 = (a, b, c, d, z0, z1, m = al) => add(new THREE.Mesh(boxG(a, b, c, d, z0, z1), m), 'B');
  A2(xf - 0.05, xf, 0, E2.top, E2.z0, E2.z0 + f2); A2(xf - 0.05, xf, 0, E2.top, E2.z1 - f2, E2.z1); A2(xf - 0.05, xf, E2.top - f2, E2.top, E2.z0, E2.z1); A2(xf - 0.05, xf, 0, 0.12, E2.z0, E2.z1);
  const gc = cnv(64, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#2b3036'); gr.addColorStop(0.5, '#3a4148'); gr.addColorStop(1, '#22262b'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  const gm = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(gc) }); gm.map.colorSpace = THREE.SRGBColorSpace;
  const gp = new THREE.Mesh(new THREE.PlaneGeometry(E2.z1 - E2.z0 - 2 * f2, E2.top - 0.12 - f2), gm); gp.rotation.y = -Math.PI / 2; gp.position.set(xf - 0.03, (E2.top - f2 + 0.12) / 2, (E2.z0 + E2.z1) / 2); add(gp, 'B');
  A2(xf - 0.1, xf - 0.08, 0.75, 1.45, E2.z0 + 0.1, E2.z0 + 0.125, new THREE.MeshBasicMaterial({ color: lin(0.5 * ee[0], 0.5 * ee[1], 0.52 * ee[2]) }));
}

// ------------------------------------------------------------------ Regalträger (schwarz), Heizkörper-Ventil
{
  const SH = S.SHELF, bk = new THREE.MeshBasicMaterial({ color: 0x141414 }), yb = SH.y - SH.t;
  for (const z of [1.62, 2.18, 2.82, 3.40]) {
    add(new THREE.Mesh(boxG(W - 0.006, W, yb - 0.2, yb, z - 0.012, z + 0.012), bk), 'B');
    add(new THREE.Mesh(boxG(W - 0.24, W, yb - 0.006, yb, z - 0.012, z + 0.012), bk), 'B');
    const d = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.26, 0.02), bk); d.position.set(W - 0.1, yb - 0.095, z); d.rotation.z = 0.84; add(d, 'B');
  }
  const RD = S.RAD, e = lmSample(QN.rad_x0, [W - RD.gap - RD.d, RD.y1 - 0.1, RD.z1 - 0.05]);
  const vm = new THREE.MeshBasicMaterial({ color: lin(0.86 * e[0], 0.86 * e[1], 0.85 * e[2]) });
  const cyl = (r, h, x, y, z, rx = 0, rz = 0, m = vm) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 16), m); c.position.set(x, y, z); c.rotation.set(rx, 0, rz); return add(c, 'B'); };
  cyl(0.008, RD.y1 - 0.1, W - 0.07, (RD.y1 - 0.1) / 2, RD.z1 + 0.06);
  cyl(0.016, 0.05, W - 0.07, RD.y1 - 0.06, RD.z1 + 0.03, Math.PI / 2);
  cyl(0.026, 0.085, W - 0.07, RD.y1 - 0.06 + 0.0, RD.z1 + 0.03, 0, 0).position.y = RD.y1 + 0.02;
  cyl(0.011, RD.y0 + 0.02, W - 0.07, (RD.y0 + 0.02) / 2, RD.z0 + 0.05);
}

// ------------------------------------------------------------------ Deckenlampen (Einbau-Panels) mit Lichthof
const glows = [];
const glowTex = new THREE.CanvasTexture(cnv(128, 128, (g, w, h) => { const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.18, 'rgba(255,252,246,0.35)'); gr.addColorStop(0.5, 'rgba(255,250,240,0.06)'); gr.addColorStop(1, 'rgba(255,250,240,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }));
{
  const disc = new THREE.MeshBasicMaterial({ color: lin(1.6, 1.58, 1.52), toneMapped: false });
  const rim = new THREE.MeshBasicMaterial({ color: lin(0.62, 0.62, 0.6) });
  for (const [x, z] of S.LIGHTS) {
    const d = new THREE.Mesh(new THREE.CircleGeometry(0.083, 40), disc); d.rotation.x = Math.PI / 2; d.position.set(x, H - 0.003, z); add(d, 'top');
    const r = new THREE.Mesh(new THREE.RingGeometry(0.083, 0.093, 40), rim); r.rotation.x = Math.PI / 2; r.position.set(x, H - 0.002, z); add(r, 'top');
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, toneMapped: false, opacity: 0.45 }));
    sp.scale.set(0.3, 0.3, 1); sp.position.set(x, H - 0.012, z); sp.renderOrder = 5; sp.name = 'lglow'; add(sp, 'top'); glows.push(sp);
  }
}

// ------------------------------------------------------------------ Matcha-Entwurf (nur sichtbar im Modus „Matcha-Laden“)
const FURN = new THREE.Group(); scene.add(FURN);
function addF(obj, wall = null) { obj.userData.wall = wall; FURN.add(obj); if (wall) tagged.push(obj); return obj; }
const eAt = (host, p) => lmSample(QN[host], p, LMM);        // Licht im Entwurf an einem Punkt
const litMat = (host, p, alb, extra = {}) => { const e = eAt(host, p); return new THREE.MeshBasicMaterial({ color: lin(alb[0] * e[0], alb[1] * e[1], alb[2] * e[2]), ...extra }); };
function mergeGeos(list) {
  const P = [], N = [], U = [];
  for (let g of list) {
    if (g.index) g = g.toNonIndexed();
    const p = g.attributes.position.array, n = g.attributes.normal.array, u = g.attributes.uv ? g.attributes.uv.array : new Float32Array(p.length / 3 * 2);
    for (let i = 0; i < p.length; i++) P.push(p[i]); for (let i = 0; i < n.length; i++) N.push(n[i]); for (let i = 0; i < u.length; i++) U.push(u[i]);
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); m.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); m.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  return m;
}
// Helligkeit je Ecke aus der Flächenrichtung (oben hell, unten dunkel) – als Ersatz für echtes Licht bei kleinen Teilen
function shadeVC(geo, f) {
  const n = geo.attributes.normal, p = geo.attributes.position, c = new Float32Array(n.count * 3);
  for (let i = 0; i < n.count; i++) { const k = f(n.getX(i), n.getY(i), n.getZ(i), p.getX(i), p.getY(i), p.getZ(i), i); c[i * 3] = k[0] ?? k; c[i * 3 + 1] = k[1] ?? k; c[i * 3 + 2] = k[2] ?? k; }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3)); return geo;
}
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const faceK = (fx, fz, up = 0.96, down = 0.45, side = 0.62, back = 0.55) => (nx, ny, nz) => ny > 0.6 ? up : ny < -0.6 ? down : (nx * fx + nz * fz > 0.6 ? 1.0 : nx * fx + nz * fz < -0.6 ? back : side);
const roundK = (lo = 0.5, hi = 1.0) => (nx, ny, nz, x, y) => (ny > 0.6 ? hi : ny < -0.6 ? lo * 0.8 : lo + (hi - lo) * (0.55 + 0.45 * (nx * 0.3 - nz * 0.55)));

// --- Texturen
const oakH = tex(cnv(2048, 512, (g, w, h) => {              // Eiche hell, Maserung waagrecht (Arbeitsplatte)
  const r = rnd(21); g.fillStyle = 'rgb(203,168,126)'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 170; i++) {
    const y = r() * h, a = 0.04 + r() * 0.1, wd = 1 + r() * 3.5, dark = r() < 0.6; g.strokeStyle = dark ? `rgba(120,84,50,${a})` : `rgba(236,210,172,${a})`; g.lineWidth = wd;
    g.beginPath(); let yy = y; g.moveTo(0, yy); for (let x = 0; x <= w; x += 32) { yy += (r() - 0.5) * 2.4; g.lineTo(x, yy); } g.stroke();
  }
  for (let i = 0; i < 4; i++) { g.fillStyle = 'rgba(110,72,40,0.14)'; g.beginPath(); g.ellipse(r() * w, r() * h, 40 + r() * 60, 5 + r() * 6, 0, 0, 6.3); g.fill(); }
}), 1 / 2.0, 1 / 0.64);
const oakV = tex(cnv(256, 2048, (g, w, h) => {              // Eiche Lamellen, Maserung senkrecht
  const r = rnd(33); g.fillStyle = 'rgb(196,158,114)'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 90; i++) {
    const x = r() * w, a = 0.05 + r() * 0.12, wd = 1 + r() * 3, dark = r() < 0.6; g.strokeStyle = dark ? `rgba(112,76,44,${a})` : `rgba(232,204,166,${a})`; g.lineWidth = wd;
    g.beginPath(); let xx = x; g.moveTo(xx, 0); for (let y = 0; y <= h; y += 32) { xx += (r() - 0.5) * 2.5; g.lineTo(xx, y); } g.stroke();
  }
}), 1 / 0.3, 1 / 2.4);
const bambooTex = tex(cnv(512, 512, (g, w, h) => {          // Bambus-Latten (Bank), Latten entlang x
  const r = rnd(9); g.fillStyle = 'rgb(214,190,146)'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 64) {
    const gr = g.createLinearGradient(0, y, 0, y + 64); gr.addColorStop(0, 'rgba(120,90,50,0.55)'); gr.addColorStop(0.08, 'rgba(255,240,210,0.10)'); gr.addColorStop(0.85, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(120,90,50,0.45)');
    g.fillStyle = gr; g.fillRect(0, y, w, 64);
    for (let k = 0; k < 3; k++) { const x = (r() * w) | 0; g.fillStyle = 'rgba(150,110,60,0.35)'; g.fillRect(x, y + 4, 5, 56); }
    for (let k = 0; k < 40; k++) { g.fillStyle = `rgba(140,105,60,${0.05 + r() * 0.08})`; g.fillRect(0, y + r() * 64, w, 1); }
  }
}), 1 / 0.5, 1 / 0.5);
const fabricTex = tex(cnv(256, 256, (g, w, h) => {          // Leinen beige
  const r = rnd(4); g.fillStyle = 'rgb(226,215,194)'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 256; i += 2) { g.fillStyle = `rgba(150,130,100,${0.04 + r() * 0.05})`; g.fillRect(0, i, w, 1); g.fillRect(i, 0, 1, h); }
  for (let i = 0; i < 1500; i++) { g.fillStyle = `rgba(255,250,240,${r() * 0.12})`; g.fillRect(r() * w, r() * h, 2, 1); }
}), 1 / 0.25, 1 / 0.25);

// --- gebackene Möbel-Flächen aus room.json
const FMAT = {
  oakL: bakedMat(lin(1, 1, 1), oakH), whiteF: bakedMat(lin(0.8, 0.8, 0.79)), bamboo: bakedMat(lin(1, 1, 1), bambooTex),
  fabric: bakedMat(lin(1, 1, 1), fabricTex), shelfW: bakedMat(lin(0.86, 0.86, 0.85)), slatF: bakedMat(lin(0.03, 0.03, 0.03)),
};
for (const q of R.quads) {
  if (!q.f || q.mat === 'tableW' || q.mat === 'seat') continue;       // Tische/Stühle: nur Lichtfläche, rund gebaut unten
  const m = new THREE.Mesh(quadGeo(q), FMAT[q.mat]); m.name = q.name;
  addF(m, q.name.startsWith('m_pan') ? 'D' : q.name.startsWith('m_sh') ? 'C' : null);
}

// --- Holzlamellen (Akustikpaneel Eiche: Lamellen 27 mm auf schwarzem Filz)
function slats(host, plane, a0, a1, y0, y1, seed) {
  const pitch = 0.04, wdt = 0.027, dep = 0.012, n = Math.floor((a1 - a0) / pitch), off = a0 + ((a1 - a0) - n * pitch) / 2 + (pitch - wdt) / 2, r = rnd(seed), geos = [];
  for (let i = 0; i < n; i++) {
    const s0 = off + i * pitch, s1 = s0 + wdt, c0 = plane.s > 0 ? plane.c : plane.c - dep, c1 = plane.s > 0 ? plane.c + dep : plane.c;
    const g = plane.n === 'z' ? boxG(s0, s1, y0, y1, c0, c1) : boxG(c0, c1, y0, y1, s0, s1);
    const p = g.attributes.position, uv = g.attributes.uv, du = r() * 0.3, dv = r() * 2.4;
    for (let k = 0; k < p.count; k++) uv.setXY(k, (plane.n === 'z' ? p.getX(k) : p.getZ(k)) + du, p.getY(k) + dv);
    geos.push(g);
  }
  const fx = plane.n === 'x' ? plane.s : 0, fz = plane.n === 'z' ? plane.s : 0;
  const g = shadeVC(hostUV(mergeGeos(geos), host), faceK(fx, fz, 0.95, 0.5, 0.42, 0.4));
  return new THREE.Mesh(g, bakedMat(lin(1, 1, 1), oakV, { vertexColors: true }));
}
addF(slats('m_pan_x1', { n: 'x', c: S.PAN.x1, s: +1 }, S.PAN.z0, S.PAN.z1, 0.0, S.PAN.y1, 8), 'D');   // Lamellen an Wand D

// --- Bank-Gestell (STEGESUND, Bambus) und Naht zwischen den Polstern
{
  const B = S.BENCH, e = eAt('floor', [2.1, 0, 0.25]);
  const m = new THREE.MeshBasicMaterial({ color: lin(0.672 * e[0], 0.514 * e[1], 0.288 * e[2]), vertexColors: true }), geos = [];
  for (let i = 0; i <= 3; i++) {
    const x = B.x0 + i * 0.79 + (i === 0 ? 0.018 : i === 3 ? -0.018 : 0);
    for (const z of [B.z0 + 0.02, B.z1 - 0.02]) geos.push(boxG(x - 0.016, x + 0.016, 0, B.y0, z - 0.016, z + 0.016));
    geos.push(boxG(x - 0.012, x + 0.012, 0.07, 0.10, B.z0 + 0.02, B.z1 - 0.02));
  }
  addF(new THREE.Mesh(shadeVC(mergeGeos(geos), (nx, ny, nz, x, y) => (nz > 0.6 ? 0.95 : ny > 0.6 ? 0.9 : 0.6) * (0.55 + 0.45 * sm(0, 0.35, y))), m));
  const Cu = S.CUSH, xm = (Cu.x0 + Cu.x1) / 2, ec = eAt('m_cush_y1', [xm, Cu.y1, 0]);
  const sMat = new THREE.MeshBasicMaterial({ color: lin(0.35 * ec[0], 0.31 * ec[1], 0.25 * ec[2]) });
  addF(new THREE.Mesh(boxG(xm - 0.004, xm + 0.004, Cu.y0 + 0.004, Cu.y1 + 0.0015, Cu.z0, Cu.z1 + 0.0015), sMat));
}

// --- weiße Tulpentische (bleiben) und Stühle LISABO Esche
function tulip(cx, cz, rTop, yTop, host, rBase) {
  const top = new THREE.CylinderGeometry(rTop, rTop - 0.004, 0.02, 72).translate(cx, yTop - 0.01, cz);
  addF(new THREE.Mesh(shadeVC(hostUV(top, host), (nx, ny) => ny > 0.6 ? 1 : ny < -0.6 ? 0.45 : 0.72), bakedMat(lin(0.84, 0.84, 0.83), null, { vertexColors: true })));
  const pts = [[0.001, 0], [rBase, 0], [rBase, 0.01], [rBase * 0.7, 0.022], [rBase * 0.25, 0.06], [0.036, 0.14], [0.03, 0.32], [0.034, yTop - 0.16], [0.07, yTop - 0.05], [0.12, yTop - 0.022], [0.12, yTop - 0.02]].map(([r, y]) => new THREE.Vector2(r, y));
  const ped = new THREE.LatheGeometry(pts, 40).translate(cx, 0, cz);
  const e = eAt('floor', [cx + rTop + 0.2, 0, cz]);
  addF(new THREE.Mesh(shadeVC(ped, (nx, ny, nz, x, y) => (ny > 0.6 ? 0.85 : ny < -0.6 ? 0.35 : 0.62 + 0.18 * (nx * 0.4 - nz * 0.6)) * (0.5 + 0.5 * sm(0, yTop * 0.8, y))),
    new THREE.MeshBasicMaterial({ color: lin(0.84 * e[0], 0.84 * e[1], 0.83 * e[2]), vertexColors: true })));
  const sh = new THREE.Mesh(new THREE.CircleGeometry(rBase + 0.06, 40).rotateX(-Math.PI / 2).translate(cx, 0.0015, cz), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.55, color: 0x000000 }));
  addF(sh);
}
const blobTex = new THREE.CanvasTexture(cnv(128, 128, (g, w, h) => { const gr = g.createRadialGradient(64, 64, 10, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }));
S.TSMALL.forEach(([x, z], i) => tulip(x, z, 0.30, 0.74, `m_t${i}_y1`, 0.21));
tulip(S.TBIG[0], S.TBIG[1], 0.45, 0.75, 'm_tb_y1', 0.27);

function chairGeo() {
  const g = [], tilt = (geo, ax, az, y0) => { geo.translate(0, -y0, 0); geo.applyMatrix4(new THREE.Matrix4().makeShear(0, 0, ax, 0, az, 0)); geo.translate(0, y0, 0); return geo; };
  g.push(boxG(-0.22, 0.22, 0.43, 0.45, -0.195, 0.195));                                  // Sitz (Esche-Furnier)
  for (const [a, b, c, d] of [[-0.2, 0.2, -0.17, -0.155], [-0.2, 0.2, 0.155, 0.17]]) g.push(boxG(a, b, 0.39, 0.43, c, d));   // Zargen
  for (const x of [-0.2, 0.185]) g.push(boxG(x, x + 0.015, 0.39, 0.43, -0.16, 0.16));
  for (const sx of [-1, 1]) {
    g.push(tilt(boxG(sx * 0.195 - 0.016, sx * 0.195 + 0.016, 0, 0.43, 0.15, 0.18), 0, 0.05, 0.43));       // Vorderbeine
    g.push(tilt(boxG(sx * 0.195 - 0.016, sx * 0.195 + 0.016, 0, 0.80, -0.185, -0.155), 0, -0.07, 0.43)); // Hinterbeine bis Lehne
  }
  const back = new THREE.CylinderGeometry(0.5, 0.5, 0.12, 18, 1, true, Math.PI - 0.44, 0.88); back.translate(0, 0.72, 0.5 - 0.2); g.push(back);
  const back2 = new THREE.CylinderGeometry(0.488, 0.488, 0.12, 18, 1, true, Math.PI - 0.44, 0.88); back2.translate(0, 0.72, 0.5 - 0.2); g.push(back2);
  return shadeVC(mergeGeos(g), (nx, ny, nz, x, y) => (ny > 0.6 ? 1.0 : ny < -0.6 ? 0.4 : 0.66 + 0.18 * Math.abs(nz)) * (0.5 + 0.5 * sm(0, 0.4, y)));
}
const CHG = chairGeo();
const chairTex = tex(cnv(256, 1024, (g, w, h) => {                 // Esche hell, feine Maserung
  const r = rnd(44); g.fillStyle = 'rgb(222,202,170)'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 70; i++) { const x = r() * w, a = 0.05 + r() * 0.1; g.strokeStyle = r() < 0.6 ? `rgba(140,104,66,${a})` : `rgba(240,222,190,${a})`; g.lineWidth = 1 + r() * 2.5; g.beginPath(); let xx = x; g.moveTo(xx, 0); for (let y = 0; y <= h; y += 24) { xx += (r() - 0.5) * 2; g.lineTo(xx, y); } g.stroke(); }
}), 1, 1);
S.CHAIRS.forEach(([x, z], i) => {
  const e = eAt(`m_c${i}_y1`, [x, 0.45, z]);
  const m = new THREE.Mesh(CHG, new THREE.MeshBasicMaterial({ map: chairTex, color: lin(0.8 * e[0], 0.72 * e[1], 0.6 * e[2]), vertexColors: true, side: THREE.DoubleSide }));
  m.rotation.y = S.CHAIRS[i][2]; m.position.set(x, 0, z); addF(m);
  addF(new THREE.Mesh(new THREE.CircleGeometry(0.33, 32).rotateX(-Math.PI / 2).translate(x, 0.0012, z), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.35, color: 0x000000 })));
});

// --- Regalträger (Espe) und Deko auf den Regalen an Wand C
function cyl(r0, r1, h, x, y, z, mat, seg = 24) { return addF(new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, h, seg).translate(x, y + h / 2, z), mat), 'C'); }
{
  const [xa, xb] = S.SHX;
  for (const y of S.SHELVES) for (const x of [xa + 0.12, xb - 0.12]) {
    const sh = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.18, 0), new THREE.Vector2(0.17, -0.03), new THREE.Vector2(0.03, -0.15), new THREE.Vector2(0, -0.17)]);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.018, bevelEnabled: false }); g.rotateY(Math.PI / 2); g.translate(x - 0.009, y, L);
    addF(new THREE.Mesh(g, litMat('wallC', [x, y - 0.08, L], [0.68, 0.58, 0.44])), 'C');
  }
  const top = (y) => y + 0.025, eT = (x, y) => eAt('m_sh' + (y > (S.SHELVES[0] + S.SHELVES[1]) / 2 ? 1 : 0) + '_y1', [x, top(y), L - 0.1]);
  const mk = (x, y, alb) => { const e = eT(x, y); return new THREE.MeshBasicMaterial({ color: lin(alb[0] * e[0], alb[1] * e[1], alb[2] * e[2]), vertexColors: true }); };
  const tin = (x, y, z, alb, h = 0.11, r = 0.038) => { const g = shadeVC(new THREE.CylinderGeometry(r, r, h, 28).translate(x, top(y) + h / 2, z), roundK(0.55, 1)); addF(new THREE.Mesh(g, mk(x, y, alb)), 'C'); const lid = shadeVC(new THREE.CylinderGeometry(r + 0.002, r + 0.002, 0.018, 28).translate(x, top(y) + h + 0.006, z), roundK(0.55, 1)); addF(new THREE.Mesh(lid, mk(x, y, [alb[0] * 0.8, alb[1] * 0.8, alb[2] * 0.8])), 'C'); };
  const y2 = S.SHELVES[1], y1 = S.SHELVES[0];
  tin(0.53, y2, L - 0.1, [0.22, 0.36, 0.14]); tin(0.62, y2, L - 0.1, [0.8, 0.78, 0.72]); tin(0.71, y2, L - 0.1, [0.05, 0.05, 0.05]); tin(0.80, y2, L - 0.1, [0.22, 0.36, 0.14], 0.08, 0.034);
  const bowl = (x, y, alb, r = 0.065) => { const pts = [[0.001, 0], [r * 0.45, 0], [r * 0.5, 0.008], [r * 0.85, 0.03], [r, 0.07], [r * 0.93, 0.07], [r * 0.8, 0.035], [0.001, 0.012]].map(([a, b]) => new THREE.Vector2(a, b)); const g = shadeVC(new THREE.LatheGeometry(pts, 32).translate(x, top(y), L - 0.1), roundK(0.5, 1)); addF(new THREE.Mesh(g, mk(x, y, alb)), 'C'); };
  bowl(0.52, y1, [0.75, 0.72, 0.62]); bowl(0.68, y1, [0.36, 0.48, 0.32]); bowl(0.68, y1 + 0.072, [0.75, 0.72, 0.62], 0.058);
  // Matchabesen (Chasen) auf Halter
  { const x = 0.86, e = [0.68, 0.56, 0.36]; cyl(0.022, 0.03, 0.045, x, top(y1), L - 0.1, mk(x, y1, [0.85, 0.84, 0.8])); const g = new THREE.CylinderGeometry(0.028, 0.012, 0.06, 20, 1, true).translate(x, top(y1) + 0.075, L - 0.1); addF(new THREE.Mesh(g, mk(x, y1, e)), 'C'); cyl(0.012, 0.012, 0.05, x, top(y1) + 0.105, L - 0.1, mk(x, y1, e)); }
}

// --- Bilderrahmen RÖDALM (Menü an Wand C, Matcha-Bild an Wand D)
function frameOn(host, wall, axis, c, s, a0, a1, y0, y1, printTex) {
  const d = 0.035, b = 0.022, m = bakedMat(lin(0.87, 0.87, 0.86), null, { vertexColors: true }), geos = [];
  const B = (u0, u1, v0, v1, w0, w1) => axis === 'z' ? boxG(u0, u1, v0, v1, w0, w1) : boxG(w0, w1, v0, v1, u0, u1);
  const w0 = s < 0 ? c - d : c, w1 = s < 0 ? c : c + d;
  geos.push(B(a0, a1, y1 - b, y1, w0, w1), B(a0, a1, y0, y0 + b, w0, w1), B(a0, a0 + b, y0 + b, y1 - b, w0, w1), B(a1 - b, a1, y0 + b, y1 - b, w0, w1));
  const fx = axis === 'x' ? s : 0, fz = axis === 'z' ? s : 0;
  addF(new THREE.Mesh(shadeVC(hostUV(mergeGeos(geos), host), faceK(fx, fz, 0.9, 0.55, 0.7, 0.5)), m), wall);
  const pg = new THREE.PlaneGeometry(a1 - a0 - 2 * b, y1 - y0 - 2 * b);
  if (axis === 'z') { pg.rotateY(s < 0 ? Math.PI : 0); pg.translate((a0 + a1) / 2, (y0 + y1) / 2, c + s * 0.012); }
  else { pg.rotateY(s > 0 ? Math.PI / 2 : -Math.PI / 2); pg.translate(c + s * 0.012, (y0 + y1) / 2, (a0 + a1) / 2); }
  addF(new THREE.Mesh(hostUV(pg, host), bakedMat(lin(1, 1, 1), printTex)), wall);
}
const paper = (g, w, h) => { g.fillStyle = '#f3efe4'; g.fillRect(0, 0, w, h); const r = rnd(2); for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(120,100,70,${r() * 0.04})`; g.fillRect(r() * w, r() * h, 2, 2); } };
function enso(g, cx, cy, R, col, wd) {
  const r = rnd(12); g.strokeStyle = col; g.lineCap = 'round';
  for (let k = 0; k < 26; k++) { g.globalAlpha = 0.08 + r() * 0.1; g.lineWidth = wd * (0.4 + r() * 0.6); g.beginPath(); const a0 = -1.2 + r() * 0.08, a1 = a0 + 5.6 + r() * 0.15; g.arc(cx + (r() - 0.5) * 3, cy + (r() - 0.5) * 3, R + (r() - 0.5) * wd * 0.5, a0, a1); g.stroke(); }
  g.globalAlpha = 1;
}
const menuTex = new THREE.CanvasTexture(cnv(560, 800, (g, w, h) => {
  paper(g, w, h); g.fillStyle = '#2f3b2a'; g.textAlign = 'center';
  g.font = '86px Sacramento, cursive'; g.fillText('le Fleur', w / 2, 130);
  g.font = '600 20px Inter, sans-serif'; g.letterSpacing = '6px'; g.fillText('MATCHA BAR', w / 2, 180); g.letterSpacing = '0px';
  g.fillStyle = '#7d9460'; g.fillRect(w / 2 - 30, 206, 60, 3);
  const items = ['Matcha Latte', 'Iced Matcha', 'Matcha Tonic', 'Hojicha Latte', 'Matcha Lemonade', 'Mochi', 'Matcha Cheesecake'];
  g.font = '500 25px Inter, sans-serif'; g.fillStyle = '#2f3b2a'; g.textAlign = 'left';
  items.forEach((t, i) => { const y = 280 + i * 62; g.fillText(t, 70, y); g.fillStyle = 'rgba(47,59,42,0.25)'; g.fillRect(70, y + 16, w - 140, 1.5); g.fillStyle = '#2f3b2a'; });
  g.textAlign = 'center'; g.font = '500 16px Inter, sans-serif'; g.fillStyle = '#7d9460'; g.fillText('Beispiel-Karte', w / 2, h - 40);
})); menuTex.colorSpace = THREE.SRGBColorSpace;
const artTex = new THREE.CanvasTexture(cnv(560, 800, (g, w, h) => {
  paper(g, w, h); enso(g, w / 2, h * 0.43, 160, '#4f6a3a', 30);
  g.fillStyle = '#6f8a52'; g.beginPath(); g.ellipse(w / 2, h * 0.43 + 8, 70, 22, 0, 0, 6.3); g.fill();            // Schale mit Matcha
  g.fillStyle = '#e7e1d2'; g.beginPath(); g.moveTo(w / 2 - 92, h * 0.43); g.quadraticCurveTo(w / 2, h * 0.43 + 150, w / 2 + 92, h * 0.43); g.closePath(); g.fill();
  g.fillStyle = '#7e9a5e'; g.beginPath(); g.ellipse(w / 2, h * 0.43, 92, 22, 0, 0, 6.3); g.fill();
  g.fillStyle = '#2f3b2a'; g.textAlign = 'center'; g.font = '600 18px Inter, sans-serif'; g.letterSpacing = '8px'; g.fillText('MATCHA', w / 2, h - 110); g.letterSpacing = '0px';
})); artTex.colorSpace = THREE.SRGBColorSpace;
frameOn('wallC', 'C', 'z', L, -1, 2.42, 2.92, 1.12, 1.82, menuTex);
frameOn('wallD', 'D', 'x', 0, +1, 0.52, 1.02, 1.12, 1.82, artTex);

// --- Noren (japanischer Türvorhang) im Durchgang
{
  const z0 = 0.275, z1 = 1.075, yT = 2.20, yB = 0.92, xR = W + 0.035;
  const nt = new THREE.CanvasTexture(cnv(800, 1300, (g, w, h) => {
    g.fillStyle = '#55703f'; g.fillRect(0, 0, w, h); const r = rnd(8);
    for (let i = 0; i < h; i += 3) { g.fillStyle = `rgba(0,0,0,${0.03 + r() * 0.04})`; g.fillRect(0, i, w, 1); }
    for (let i = 0; i < w; i += 3) { g.fillStyle = `rgba(255,255,255,${0.015 + r() * 0.02})`; g.fillRect(i, 0, 1, h); }
    g.fillStyle = '#3f5530'; g.fillRect(0, 0, w, 70);                                          // Tunnel oben
    enso(g, w / 2, 470, 230, '#efe9da', 44);
    g.fillStyle = '#efe9da'; g.textAlign = 'center'; g.font = '150px Sacramento, cursive'; g.fillText('le Fleur', w / 2, 520);
    g.font = '600 34px Inter, sans-serif'; g.letterSpacing = '14px'; g.fillText('MATCHA', w / 2 + 7, 830); g.letterSpacing = '0px';
  })); nt.colorSpace = THREE.SRGBColorSpace;
  const eR = eAt('wallB_b', [W, 1.5, S.PAS.z1 + 0.15]), eV = lmSample(QN.ves_near_r, [W + S.PAS.t, 1.5, S.PAS.z1 + 0.25], LMM);
  const panel = (za, zb, ua, ub, x, side) => {
    const g = new THREE.PlaneGeometry(zb - za, yT - yB, 10, 1), p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) { uv.setX(i, ua + (ub - ua) * uv.getX(i)); p.setZ(i, Math.sin((p.getX(i) + za) * 22) * 0.006); }
    g.rotateY(side > 0 ? Math.PI / 2 : -Math.PI / 2);
    if (side > 0) g.translate(x, (yT + yB) / 2, (za + zb) / 2); else g.translate(x, (yT + yB) / 2, (za + zb) / 2);
    const e = side > 0 ? eV : eR;
    addF(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: nt, color: lin(0.92 * e[0], 0.92 * e[1], 0.92 * e[2]) })), 'B');
  };
  const zm = (z0 + z1) / 2;
  panel(z0, zm - 0.005, 0, 0.5, xR, -1); panel(zm + 0.005, z1, 0.5, 1, xR, -1);            // Raumseite (liest sich richtig)
  panel(zm + 0.005, z1, 0, 0.5, xR + 0.004, +1); panel(z0, zm - 0.005, 0.5, 1, xR + 0.004, +1);   // Windfang-Seite
  const rm = litMat('wallB_b', [W, 2.2, S.PAS.z1 + 0.1], [0.3, 0.2, 0.12]);
  addF(new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, S.PAS.z1 - S.PAS.z0, 12).rotateX(Math.PI / 2).translate(xR + 0.002, yT + 0.012, (S.PAS.z0 + S.PAS.z1) / 2), rm), 'B');
}

// --- Hängeleuchten SINNERLIG (Bambus, warm)
const weaveTex = new THREE.CanvasTexture(cnv(512, 256, (g, w, h) => {
  g.clearRect(0, 0, w, h); g.strokeStyle = 'rgba(232,208,168,1)'; g.lineWidth = 7;
  for (let i = -h; i < w + h; i += 15) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + h * 0.55, h); g.stroke(); g.beginPath(); g.moveTo(i, h); g.lineTo(i + h * 0.55, 0); g.stroke(); }
  g.fillStyle = 'rgba(222,196,152,1)'; g.fillRect(0, 0, w, 10); g.fillRect(0, h - 10, w, 10);
})); weaveTex.colorSpace = THREE.SRGBColorSpace; weaveTex.wrapS = THREE.RepeatWrapping; weaveTex.repeat.set(3, 1);
const warmGlow = new THREE.CanvasTexture(cnv(128, 128, (g, w, h) => { const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,214,160,0.9)'); gr.addColorStop(0.3, 'rgba(255,200,140,0.3)'); gr.addColorStop(1, 'rgba(255,190,130,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }));
for (const [x, z, yb] of S.PENDANTS) {
  const pts = [[0.135, 0.0], [0.133, 0.05], [0.125, 0.10], [0.105, 0.145], [0.075, 0.175], [0.04, 0.19]].map(([r, y]) => new THREE.Vector2(r, y));
  const shade = new THREE.Mesh(new THREE.LatheGeometry(pts, 48).translate(x, yb, z), new THREE.MeshBasicMaterial({ map: weaveTex, alphaTest: 0.45, side: THREE.DoubleSide, color: lin(1.12, 0.98, 0.78) }));
  addF(shade, 'top');
  addF(new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12).translate(x, yb + 0.1, z), new THREE.MeshBasicMaterial({ color: lin(3.2, 2.6, 1.8), toneMapped: false })), 'top');
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: warmGlow, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.55 }));
  sp.scale.set(0.55, 0.55, 1); sp.position.set(x, yb + 0.09, z); addF(sp, 'top');
  const cm = new THREE.MeshBasicMaterial({ color: 0x1b1b1b });
  addF(new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0025, H - yb - 0.19, 6).translate(x, (H + yb + 0.19) / 2, z), cm), 'top');
  const ec = lmSample(QN.ceil, [x, H, z], LMM);
  addF(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.018, 24).translate(x, H - 0.009, z), new THREE.MeshBasicMaterial({ color: lin(0.8 * ec[0], 0.8 * ec[1], 0.8 * ec[2]) })), 'top');
}

// --- Pflanzen (FEJKA, künstlich)
const leafTex = (kind) => { const t = new THREE.CanvasTexture(cnv(128, 256, (g, w, h) => {
  g.clearRect(0, 0, w, h); g.fillStyle = '#fff'; g.beginPath();
  if (kind === 'fig') { g.moveTo(w / 2, 8); g.quadraticCurveTo(w - 6, h * 0.45, w / 2, h - 8); g.quadraticCurveTo(6, h * 0.45, w / 2, 8); }
  else if (kind === 'paddle') { g.moveTo(w / 2, 4); g.bezierCurveTo(w - 2, h * 0.2, w - 4, h * 0.8, w / 2, h - 4); g.bezierCurveTo(4, h * 0.8, 2, h * 0.2, w / 2, 4); }
  else if (kind === 'blade') { g.moveTo(6, h); g.quadraticCurveTo(w * 0.42, h * 0.3, w / 2, 2); g.quadraticCurveTo(w * 0.58, h * 0.3, w - 6, h); }
  else { g.arc(w / 2, h / 2, w / 2 - 4, 0, 6.3); }
  g.fill();
  g.globalCompositeOperation = 'source-atop'; const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, '#cfd8c4'); gr.addColorStop(0.5, '#ffffff'); gr.addColorStop(1, '#bfcab2'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 3; g.beginPath(); g.moveTo(w / 2, 6); g.lineTo(w / 2, h - 6); g.stroke();
  if (kind === 'round') { g.globalCompositeOperation = 'destination-out'; g.lineWidth = 7; for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(k < 2 ? 2 : w - 2, h * (0.3 + 0.2 * (k % 2))); g.lineTo(w / 2 + (k < 2 ? -14 : 14), h * (0.38 + 0.2 * (k % 2))); g.stroke(); } }
})); t.colorSpace = THREE.SRGBColorSpace; return t; };
const LEAF = { fig: leafTex('fig'), paddle: leafTex('paddle'), blade: leafTex('blade'), round: leafTex('round') };
function plant(x, z, y0, kind, size, seed, wall = null, potR = 0.1, potH = 0.19) {
  const r = rnd(seed), P = [], U = [], Cc = [];
  const leaf = (cx, cy, cz, len, wid, yaw, pitch, roll) => {
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
    const v = [[-wid / 2, 0], [wid / 2, 0], [wid / 2, len], [-wid / 2, len]].map(([a, b]) => new THREE.Vector3(a, b, 0).applyMatrix4(m).add(new THREE.Vector3(cx, cy, cz)));
    const k = (0.72 + r() * 0.35) * (0.8 + 0.35 * Math.min(1, (cy - y0) / Math.max(0.3, size)));
    for (const i of [0, 1, 2, 0, 2, 3]) { P.push(v[i].x, v[i].y, v[i].z); U.push(i === 1 || i === 2 ? 1 : 0, i >= 2 ? 1 : 0); Cc.push(k * 0.95, k, k * 0.9); }
  };
  const base = y0 + potH;
  if (kind === 'fig') for (let i = 0; i < 1500; i++) { const a = r() * 6.28, h = 0.3 + Math.pow(r(), 0.7) * 0.7, rr = Math.sqrt(r()) * 0.34 * Math.sin(Math.PI * Math.min(1, (h - 0.2) * 1.25)) + 0.05; leaf(x + Math.cos(a) * rr, base + h * size, z + Math.sin(a) * rr, 0.095, 0.05, r() * 6.28, -0.5 - r() * 1.7, (r() - 0.5)); }
  if (kind === 'paddle') for (let i = 0; i < 11; i++) { const a = r() * 6.28, t = 0.15 + r() * 0.35, h = size * (0.45 + r() * 0.3); leaf(x + Math.cos(a) * t * 0.35, base + h, z + Math.sin(a) * t * 0.35, 0.36, 0.13, -Math.PI / 2 - a, -t * 1.4, 0); leaf(x + Math.cos(a) * 0.01, base, z + Math.sin(a) * 0.01, h, 0.012, -Math.PI / 2 - a, -t * 0.55, 0); }
  if (kind === 'round') for (let i = 0; i < 7; i++) { const a = i / 7 * 6.28 + r(), t = 0.5 + r() * 0.5; leaf(x, base, z, size * (0.5 + r() * 0.4), 0.008, -Math.PI / 2 - a, -t * 0.8, 0); leaf(x + Math.cos(a) * 0.12 * t, base + size * (0.45 + r() * 0.35), z + Math.sin(a) * 0.12 * t, 0.13, 0.13, -Math.PI / 2 - a, -1.1 - r() * 0.5, 0); }
  if (kind === 'palm') for (let i = 0; i < 9; i++) { const a = r() * 6.28, t = 0.3 + r() * 0.6; for (let k = 0; k < 9; k++) { const f = k / 9; leaf(x + Math.cos(a) * f * 0.18 * t, base + size * (0.3 + 0.55 * f * (1 - 0.4 * f)), z + Math.sin(a) * f * 0.18 * t, 0.13, 0.024, -Math.PI / 2 - a + (k % 2 ? 1 : -1) * 0.9, -0.5 - f, 0); } }
  if (kind === 'grass') for (let i = 0; i < 60; i++) { const a = r() * 6.28; leaf(x + (r() - 0.5) * 0.03, base, z + (r() - 0.5) * 0.03, size * (0.6 + r() * 0.5), 0.018, a, -0.15 - r() * 0.4, 0); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3));
  const e = y0 > 0.2 ? [0.9, 0.9, 0.9].map((v, i) => v * eAt('floor', [W / 2, 0, L / 2])[i]) : eAt('floor', [x, 0, z]);
  const alb = kind === 'fig' ? [0.16, 0.3, 0.08] : kind === 'grass' ? [0.22, 0.32, 0.1] : [0.11, 0.24, 0.08];
  addF(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: LEAF[kind === 'fig' ? 'fig' : kind === 'paddle' ? 'paddle' : kind === 'round' ? 'round' : 'blade'], alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true, color: lin(alb[0] * e[0] * 1.3, alb[1] * e[1] * 1.3, alb[2] * e[2] * 1.3) })), wall);
  if (kind === 'fig') {                                         // Stämmchen
    const tm = new THREE.MeshBasicMaterial({ color: lin(0.25 * e[0], 0.18 * e[1], 0.12 * e[2]) });
    for (let k = 0; k < 3; k++) { const a = k * 2.1; const c = new THREE.CatmullRomCurve3([new THREE.Vector3(x, base - 0.02, z), new THREE.Vector3(x + Math.cos(a) * 0.04, base + 0.4 * size, z + Math.sin(a) * 0.04), new THREE.Vector3(x + Math.cos(a + 1) * 0.07, base + 0.75 * size, z + Math.sin(a + 1) * 0.07)]); addF(new THREE.Mesh(new THREE.TubeGeometry(c, 12, 0.012, 6), tm), wall); }
  }
  const pg = shadeVC(new THREE.CylinderGeometry(potR, potR * 0.82, potH, 32).translate(x, y0 + potH / 2, z), roundK(0.45, 0.9));
  addF(new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ color: lin(0.07 * e[0], 0.07 * e[1], 0.075 * e[2]), vertexColors: true })), wall);
  addF(new THREE.Mesh(new THREE.CircleGeometry(potR * 0.97, 24).rotateX(-Math.PI / 2).translate(x, y0 + potH - 0.012, z), new THREE.MeshBasicMaterial({ color: lin(0.05 * e[0], 0.04 * e[1], 0.03 * e[2]) })), wall);
  if (y0 < 0.01) addF(new THREE.Mesh(new THREE.CircleGeometry(potR + 0.12, 32).rotateX(-Math.PI / 2).translate(x, 0.0012, z), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.5, color: 0x000000 })));
}
plant(0.33, 0.36, 0, 'fig', 1.45, 3, null, 0.105, 0.2);                  // Birkenfeige, Ecke am Fenster
plant(3.455, -0.14, 0, 'paddle', 1.05, 4, null, 0.115, 0.22);           // Paradiesvogelblume, rechts in der Nische
plant(W - 0.15, 3.48, S.SHELF.y, 'palm', 0.42, 5, 'B', 0.06, 0.11);    // Areca auf der Stehbar
plant(W - 0.15, 1.56, S.SHELF.y, 'round', 0.3, 6, 'B', 0.06, 0.11);    // Monstera auf der Stehbar
plant(1.08, L - 0.1, S.SHELVES[1] + 0.025, 'grass', 0.22, 7, 'C', 0.045, 0.08);  // Gras oben im Regal

// --- mehr Deko an den Wänden: Bildergalerie über der Stehbar, Bilder an Wand A und C, 2 Regale an Wand D
function mistyTex(seed) {
  const t = new THREE.CanvasTexture(cnv(500, 700, (g, w, h) => {
    paper(g, w, h); const r = rnd(seed), sunX = w * (0.25 + r() * 0.5), sunY = h * (0.22 + r() * 0.12);
    g.fillStyle = seed % 2 ? 'rgba(196,120,96,0.55)' : 'rgba(120,150,96,0.45)'; g.beginPath(); g.arc(sunX, sunY, 34 + r() * 16, 0, 6.3); g.fill();
    for (let k = 0; k < 5; k++) {                              // Bergketten, hinten hell, vorne dunkel, mit Nebel
      const base = h * (0.42 + k * 0.1), a = 0.16 + k * 0.15, col = `rgba(${70 - k * 8},${84 - k * 6},${72 - k * 8},${a})`;
      g.fillStyle = col; g.beginPath(); g.moveTo(0, h); let y = base - r() * 60; g.lineTo(0, y);
      for (let x = 0; x <= w; x += 10) { y += (r() - 0.5) * 26 + Math.sin(x / (60 + k * 20) + seed) * 3; y = Math.min(base + 40, Math.max(base - 140 + k * 10, y)); g.lineTo(x, y); }
      g.lineTo(w, h); g.closePath(); g.fill();
      const fg = g.createLinearGradient(0, base - 10, 0, base + 70); fg.addColorStop(0, 'rgba(243,239,228,0)'); fg.addColorStop(1, 'rgba(243,239,228,0.85)'); g.fillStyle = fg; g.fillRect(0, base - 10, w, 80);
    }
    g.fillStyle = 'rgba(47,59,42,0.55)'; g.font = '500 13px Inter, sans-serif'; g.letterSpacing = '5px'; g.textAlign = 'center'; g.fillText('MISTY MORNING', w / 2, h - 34); g.letterSpacing = '0px';
  })); t.colorSpace = THREE.SRGBColorSpace; return t;
}
[1.92, 2.52, 3.12].forEach((zc, i) => frameOn('wallB_b', 'B', 'x', W, -1, zc - 0.25, zc + 0.25, 1.30, 2.00, mistyTex(31 + i)));   // Galerie über der Stehbar
frameOn('wallA_r', 'A', 'z', 0, +1, 3.86, 4.36, 1.12, 1.82, mistyTex(41));                                                    // neben der Fensternische
frameOn('wallC', 'C', 'z', L, -1, 3.78, 4.28, 1.12, 1.82, mistyTex(52));                                                       // grüne Wand, neben dem Kasten
// Hängepflanze (FEJKA hängend): Topf + Ranken, die über die Kante nach unten fallen
function trailing(x, y0, z, out, seed, wall, e) {
  const r = rnd(seed), P = [], U = [], Cc = [], potR = 0.05, potH = 0.085;
  const leaf = (cx, cy, cz, len, wid, yaw, pitch) => {
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
    const v = [[-wid / 2, 0], [wid / 2, 0], [wid / 2, len], [-wid / 2, len]].map(([a, b]) => new THREE.Vector3(a, b, 0).applyMatrix4(m).add(new THREE.Vector3(cx, cy, cz)));
    const k = 0.75 + r() * 0.35;
    for (const i of [0, 1, 2, 0, 2, 3]) { P.push(v[i].x, v[i].y, v[i].z); U.push(i === 1 || i === 2 ? 1 : 0, i >= 2 ? 1 : 0); Cc.push(k * 0.95, k, k * 0.9); }
  };
  for (let v = 0; v < 9; v++) {
    const side = (r() - 0.5) * 2, lenV = 0.18 + r() * 0.42, sx = out[0] === 0 ? side * 0.07 : 0, sz = out[2] === 0 ? side * 0.07 : 0;
    for (let t = 0; t < 1; t += 0.05) {
      const reach = Math.min(1, t * 4) * 0.07, drop = Math.max(0, t - 0.2) * lenV * 1.25 - Math.min(t, 0.2) * -0.04;
      const px = x + out[0] * reach + sx * (0.6 + t * 0.4), pz = z + out[2] * reach + sz * (0.6 + t * 0.4), py = y0 + potH + 0.01 - drop;
      leaf(px + (r() - 0.5) * 0.02, py, pz + (r() - 0.5) * 0.02, 0.045, 0.035, r() * 6.28, -0.3 - r() * 1.2);
    }
  }
  for (let i = 0; i < 18; i++) { const a = r() * 6.28; leaf(x + Math.cos(a) * 0.03, y0 + potH, z + Math.sin(a) * 0.03, 0.05, 0.04, -Math.PI / 2 - a, -0.5 - r() * 0.6); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3));
  addF(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: LEAF.fig, alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true, color: lin(0.14 * e[0] * 1.3, 0.29 * e[1] * 1.3, 0.09 * e[2] * 1.3) })), wall);
  addF(new THREE.Mesh(shadeVC(new THREE.CylinderGeometry(potR, potR * 0.82, potH, 24).translate(x, y0 + potH / 2, z), roundK(0.5, 0.95)), new THREE.MeshBasicMaterial({ color: lin(0.8 * e[0], 0.78 * e[1], 0.74 * e[2]), vertexColors: true })), wall);
}
{
  const eC = eAt('m_sh0_y1', [1.06, S.SHELVES[0], L - 0.1]);
  trailing(1.07, S.SHELVES[0] + 0.025, L - 0.1, [0, 0, -1], 61, 'C', eC);
  // zwei Regale an Wand D (zwischen Lamellen und Bogenwand)
  const z0 = 3.55, z1 = 4.35, shelfM = bakedMat(lin(0.86, 0.86, 0.85), null, { vertexColors: true });
  for (const [k, y] of [[0, 1.42], [1, 1.82]]) {
    addF(new THREE.Mesh(shadeVC(hostUV(boxG(0, 0.2, y, y + 0.025, z0, z1), 'wallD'), faceK(1, 0, 1.15, 0.45, 0.7, 0.6)), shelfM), 'D');
    for (const z of [z0 + 0.12, z1 - 0.12]) {
      const sh = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.18, 0), new THREE.Vector2(0.17, -0.03), new THREE.Vector2(0.03, -0.15), new THREE.Vector2(0, -0.17)]);
      const g = new THREE.ExtrudeGeometry(sh, { depth: 0.018, bevelEnabled: false }); g.translate(0, y, z - 0.009);
      addF(new THREE.Mesh(g, litMat('wallD', [0.01, y - 0.08, z], [0.68, 0.58, 0.44])), 'D');
    }
    const e = eAt('wallD', [0, y + 0.2, (z0 + z1) / 2]).map(v => v * 1.15), top = y + 0.025;
    const mm = (alb) => new THREE.MeshBasicMaterial({ color: lin(alb[0] * e[0], alb[1] * e[1], alb[2] * e[2]), vertexColors: true });
    trailing(0.1, top, k ? 3.7 : 4.15, [1, 0, 0], 70 + k, 'D', e);
    if (k) { for (const [z, alb, h] of [[3.95, [0.22, 0.36, 0.14], 0.11], [4.04, [0.8, 0.78, 0.72], 0.11], [4.13, [0.05, 0.05, 0.05], 0.09]]) addF(new THREE.Mesh(shadeVC(new THREE.CylinderGeometry(0.036, 0.036, h, 24).translate(0.1, top + h / 2, z), roundK(0.55, 1)), mm(alb)), 'D'); }
    else {
      const pts = [[0.001, 0], [0.03, 0], [0.034, 0.008], [0.058, 0.03], [0.065, 0.07], [0.058, 0.07], [0.048, 0.035], [0.001, 0.012]].map(([a, b]) => new THREE.Vector2(a, b));
      addF(new THREE.Mesh(shadeVC(new THREE.LatheGeometry(pts, 28).translate(0.1, top, 3.72), roundK(0.5, 1)), mm([0.36, 0.48, 0.32])), 'D');
      addF(new THREE.Mesh(shadeVC(new THREE.CylinderGeometry(0.03, 0.045, 0.16, 24).translate(0.1, top + 0.08, 3.86), roundK(0.5, 1)), mm([0.75, 0.72, 0.62])), 'D');   // Vase
      for (let b = 0; b < 3; b++) addF(new THREE.Mesh(boxG(0.03, 0.18, top + b * 0.028, top + b * 0.028 + 0.026, 3.9 + b * 0.004, 4.12 - b * 0.006), mm([[0.85, 0.83, 0.78], [0.3, 0.42, 0.28], [0.12, 0.12, 0.12]][b])), 'D');   // Bücher
    }
  }
}

// --- Barhocker DALFRED (schwarz, 63–74 cm) an der Stehbar
{
  const g = [];
  g.push(new THREE.CylinderGeometry(0.17, 0.165, 0.045, 32).translate(0, 0.735, 0));          // Sitz
  g.push(new THREE.CylinderGeometry(0.026, 0.026, 0.5, 14).translate(0, 0.46, 0));             // Säule
  g.push(new THREE.TorusGeometry(0.17, 0.009, 8, 32).rotateX(Math.PI / 2).translate(0, 0.3, 0));   // Fußring
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.785, leg = new THREE.CylinderGeometry(0.011, 0.013, 0.46, 8); leg.translate(0, 0.23, 0); leg.applyMatrix4(new THREE.Matrix4().makeRotationZ(0.36)); leg.applyMatrix4(new THREE.Matrix4().makeRotationY(a)); g.push(leg); }
  const geo = shadeVC(mergeGeos(g), (nx, ny, nz, x, y) => (ny > 0.6 ? 1.0 : ny < -0.6 ? 0.35 : 0.55 + 0.3 * Math.abs(nx)) * (0.5 + 0.5 * sm(0, 0.6, y)));
  for (const [x, z] of S.STOOLS) {
    const e = eAt('floor', [x - 0.35, 0, z]);
    addF(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: lin(0.09 * e[0], 0.09 * e[1], 0.095 * e[2]), vertexColors: true }))).position.set(x, 0, z);
    addF(new THREE.Mesh(new THREE.CircleGeometry(0.3, 32).rotateX(-Math.PI / 2).translate(x, 0.0012, z), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.35, color: 0x000000 })));
  }
}
FURN.visible = LOOK === 'matcha';

// ------------------------------------------------------------------ Einkaufsliste – nur intern: liste.json liegt nur im Artifact, nicht auf der Website
const eur = (v) => v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
fetch('liste.json' + VQ).then(r => r.ok ? r.json() : null).then(J => {
  if (!J || !J.groups) return;
  const total = Math.round(J.groups.reduce((s, [, rows]) => s + rows.reduce((a, [n, , p]) => a + n * p, 0), 0) * 100) / 100;
  let h = '';
  for (const [grp, rows] of J.groups) {
    h += `<h3>${grp}</h3>`;
    for (const [n, name, p, shop, url] of rows) h += `<div class="row"><span class="n">${n}×</span><span class="nm">${name}<a href="${url}" target="_blank" rel="noopener">${shop}</a></span><span class="p">${eur(n * p)}</span></div>`;
  }
  document.getElementById('sheetBody').innerHTML = h;
  document.getElementById('sheetSub').textContent = J.sub;
  document.getElementById('sheetNote').textContent = J.note;
  document.getElementById('sum').textContent = eur(total);
  document.getElementById('rest').textContent = eur(J.budget - total);
  document.getElementById('listSum').textContent = eur(total);
  document.body.classList.add('haslist');
}).catch(e => console.warn('Liste:', e && e.message));

// ------------------------------------------------------------------ Steuerung
const st = { x: W / 2, z: L - 0.9, yaw: 0, pitch: -0.05, mode: 'walk', orbit: { th: 0.75, ph: 0.9, r: 8.2 } };
const keys = {}; let walkTo = null, tween = null, joy = null, look = null;
const RECTS = [[0.3, W - 0.3, 0.3, L - 0.3], [W - 0.35, W + S.PAS.t + 0.4, S.PAS.z0 + 0.3, S.PAS.z1 - 0.3], [W + S.PAS.t + 0.0, S.VES.x1 - 0.3, S.VES.z0 + 0.3, S.VES.z1 - 0.3]];
const BLOCK = [[0.0, 3.4, 0.0, 1.45], [0.0, 1.0, 1.45, 3.15], [1.0, 2.65, 3.55, 5.2], [3.8, 4.6, 1.65, 3.4]];   // Fenster, Tisch Wand D, großer Tisch, Barhocker
const inR = (r, x, z) => x >= r[0] && x <= r[1] && z >= r[2] && z <= r[3];
const free = (x, z) => RECTS.some(r => inR(r, x, z)) && !(x > W - 0.45 && x < W && z > S.SHELF.z0 - 0.1 && z < S.SHELF.z1 + 0.1) && !(LOOK === 'matcha' && BLOCK.some(r => inR(r, x, z)));
function moveBy(dx, dz) { if (free(st.x + dx, st.z + dz)) { st.x += dx; st.z += dz; return true; } if (free(st.x + dx, st.z)) { st.x += dx; return true; } if (free(st.x, st.z + dz)) { st.z += dz; return true; } return false; }
const VIEWS_L = {
  fenster: { x: W / 2, z: L - 0.5, yaw: 0 }, eingang: { x: 0.5, z: 2.7, yaw: -Math.PI / 2 },
  bogen: { x: W / 2 - 0.2, z: 0.5, yaw: Math.PI }, wand: { x: W - 0.55, z: 2.6, yaw: Math.PI / 2 },
};
const VIEWS_M = {                                            // im Entwurf: Standpunkte zwischen den Möbeln
  fenster: { x: 3.3, z: 4.55, yaw: 0.32, pitch: -0.12 }, eingang: { x: 3.62, z: 0.72, yaw: 2.76, pitch: -0.1 },
  bogen: { x: 2.5, z: 2.0, yaw: Math.PI + 0.12, pitch: -0.05 }, wand: { x: 3.5, z: 2.3, yaw: Math.PI / 2, pitch: -0.08 },
};
let VIEWS = LOOK === 'matcha' ? VIEWS_M : VIEWS_L;
const START = { leer: 'fenster', matcha: 'eingang' };
// yaw: 0 = Blick nach -z (Fenster); Blickrichtung = (-sin yaw, -cos yaw)
function go(name) {
  document.querySelectorAll('#views button').forEach(b => b.classList.toggle('on', b.dataset.v === name));
  if (name === 'oben') { setMode('top'); return; }
  const v = VIEWS[name]; if (st.mode !== 'walk') setMode('walk');
  let dy = v.yaw - st.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  tween = { t: 0, from: { x: st.x, z: st.z, yaw: st.yaw, pitch: st.pitch }, to: { x: v.x, z: v.z, yaw: st.yaw + dy, pitch: v.pitch ?? -0.05 } }; walkTo = null; req();
}
function setMode(m) {
  st.mode = m; document.body.classList.toggle('top', m === 'top');
  if (m === 'walk') { for (const o of tagged) o.visible = true; dims.forEach(d => d.el.style.display = 'none'); }
  else { const v = st; v.orbit.th = Math.atan2(st.x - W / 2 + 0.01, st.z - L / 2 + 0.01) ; }
  req();
}
function setLook(m, jump = true) {
  LOOK = m; LM = LMS[m]; VIEWS = m === 'matcha' ? VIEWS_M : VIEWS_L;
  for (const mt of BAKED) { mt.lightMap = LM.tex; mt.lightMapIntensity = LM.LMI; }
  const mt = m === 'matcha';
  MAT.paintC.color.copy(mt ? C_GREEN : C_WALL); MAT.archIn.color.copy(mt ? C_GREEN2 : C_WALL); MAT.reveal.color.copy(mt ? C_GREEN2 : C_WALL);
  FURN.visible = mt; document.body.classList.toggle('matcha', mt);
  document.querySelectorAll('#look button').forEach(b => b.classList.toggle('on', b.dataset.l === m));
  document.getElementById('sub').textContent = mt ? 'Gastraum · Matcha-Entwurf' : 'Raum jetzt';
  if (!mt) closeSheet();
  if (jump && st.mode === 'walk' && !free(st.x, st.z)) { const v = VIEWS[START[m]]; Object.assign(st, { x: v.x, z: v.z, yaw: v.yaw, pitch: v.pitch ?? -0.05 }); walkTo = null; tween = null; }
  req();
}
const sheet = document.getElementById('sheet');
function closeSheet() { sheet.classList.remove('open'); }
document.getElementById('listBtn').addEventListener('click', () => { sheet.classList.toggle('open'); hideHint(); });
document.getElementById('sheetX').addEventListener('click', closeSheet);
document.querySelectorAll('#look button').forEach(b => b.addEventListener('click', () => { hideHint(); setLook(b.dataset.l); }));
canvas.addEventListener('contextmenu', e => e.preventDefault());
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function tapAt(cx, cy) {
  if (st.mode !== 'walk') return;
  const r = canvas.getBoundingClientRect(); ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera);
  const neon = room.getObjectByName('neon'); if (ray.intersectObject(neon).length) { neonOn.v = !neonOn.v; drawNeon(); return; }
  const d = ray.ray.direction, o = ray.ray.origin; if (d.y > -0.02) return;
  const t = -o.y / d.y, x = o.x + d.x * t, z = o.z + d.z * t;
  let tx = x, tz = z; for (let i = 0; i < 40 && !free(tx, tz); i++) { tx += (st.x - tx) * 0.1; tz += (st.z - tz) * 0.1; }
  if (free(tx, tz)) { walkTo = { x: tx, z: tz }; tween = null; hideHint(); req(); }
}
const ptrs = new Map(); let pinch0 = 0;
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: false });
  const r = canvas.getBoundingClientRect();
  if (st.mode === 'walk' && e.pointerType === 'touch' && e.clientX - r.left < r.width * 0.42 && e.clientY - r.top > r.height * 0.45 && !joy) { joy = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0 }; showJoy(e.clientX, e.clientY, 0, 0); }
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); }
  hideHint();
});
canvas.addEventListener('pointermove', (e) => {
  const p = ptrs.get(e.pointerId); if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
  if (Math.hypot(p.x - p.x0, p.y - p.y0) > 8) p.moved = true;
  if (joy && joy.id === e.pointerId) { const jx = e.clientX - joy.x0, jy = e.clientY - joy.y0, l = Math.hypot(jx, jy), m = Math.min(l, 55) / (l || 1); joy.dx = jx * m / 55; joy.dy = jy * m / 55; showJoy(joy.x0, joy.y0, jx * m, jy * m); req(); return; }
  if (ptrs.size === 2 && st.mode === 'top') { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch0) st.orbit.r = Math.min(16, Math.max(4.5, st.orbit.r * pinch0 / d)); pinch0 = d; req(); return; }
  const k = e.pointerType === 'touch' ? 0.0045 : 0.0038;
  if (st.mode === 'walk') { st.yaw -= dx * k; st.pitch = Math.max(-1.25, Math.min(1.25, st.pitch - dy * k)); tween = null; }   // Blick folgt dem Finger (nicht gespiegelt)
  else { st.orbit.th -= dx * 0.008; st.orbit.ph = Math.max(0.25, Math.min(1.35, st.orbit.ph - dy * 0.006)); }
  req();
});
const endPtr = (e) => {
  const p = ptrs.get(e.pointerId); ptrs.delete(e.pointerId);
  if (joy && joy.id === e.pointerId) { joy = null; hideJoy(); return; }
  if (p && !p.moved && performance.now() - p.t0 < 450) tapAt(e.clientX, e.clientY);
};
canvas.addEventListener('pointerup', endPtr); canvas.addEventListener('pointercancel', endPtr);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); if (st.mode === 'top') st.orbit.r = Math.min(16, Math.max(4.5, st.orbit.r * (1 + e.deltaY * 0.001))); else { camera.fov = Math.min(80, Math.max(40, camera.fov + e.deltaY * 0.02)); camera.updateProjectionMatrix(); } req(); }, { passive: false });
addEventListener('keydown', (e) => { keys[e.code] = true; if (/Arrow|Key[WASD]/.test(e.code)) { hideHint(); e.preventDefault(); } req(); });
addEventListener('keyup', (e) => { keys[e.code] = false; });
const joyEl = document.getElementById('joy'), knob = joyEl.firstElementChild;
function showJoy(x, y, kx, ky) { joyEl.style.display = 'block'; joyEl.style.left = x + 'px'; joyEl.style.top = y + 'px'; knob.style.transform = `translate(${kx}px,${ky}px)`; }
function hideJoy() { joyEl.style.display = 'none'; }
const hint = document.getElementById('hint');
hint.querySelector('.t').textContent = TOUCH ? 'Wischen: umschauen · Auf den Boden tippen: hinlaufen · Links unten ziehen: laufen' : 'W A S D oder Pfeile: laufen · Maus ziehen: umschauen · Klick auf den Boden: hinlaufen';
let hintT = setTimeout(hideHint, 9000);
function hideHint() { hint.classList.add('gone'); clearTimeout(hintT); }
document.querySelectorAll('#views button').forEach(b => b.addEventListener('click', () => { hideHint(); go(b.dataset.v); }));

// Maße (Ansicht von oben)
const fmt = (v) => 'ca. ' + v.toFixed(2).replace('.', ',') + ' m';
const dims = [[W / 2, 0.02, -0.05, fmt(W)], [W / 2, 0.02, L + 0.05, fmt(W)], [-0.05, 0.02, L / 2, fmt(L)], [W + 0.05, 0.02, L / 2 + 1.0, fmt(L)], [0, H, 0, 'Höhe ' + fmt(H)]]
  .map(([x, y, z, t]) => { const el = document.createElement('div'); el.className = 'dim'; el.textContent = t; document.body.appendChild(el); return { p: new THREE.Vector3(x, y, z), el }; });

// ------------------------------------------------------------------ Schleife
function resize() {                                         // Hochformat: genug Breite sehen (waagrecht ca. 64°)
  const w = innerWidth, h = innerHeight, a = w / h; renderer.setSize(w, h, false); if (typeof composer !== 'undefined') { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); } camera.aspect = a;
  camera.fov = Math.min(100, Math.max(64, 2 * Math.atan(Math.tan(32 * Math.PI / 180) / a) * 180 / Math.PI)); camera.updateProjectionMatrix(); req();
}
// ------------------------------------------------------------------ Nachbearbeitung (realistischer: Kontaktschatten, Leuchten, Kamera-Look)
const DPR = Math.min(devicePixelRatio || 1, 2);
const rt = new THREE.WebGLRenderTarget(innerWidth * DPR, innerHeight * DPR, { type: THREE.HalfFloatType, samples: TOUCH ? 2 : 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const AOS = TOUCH ? 0.5 : 0.75;                                    // AO in geringerer Auflösung (Handy schonen)
const gtao = new GTAOPass(scene, camera, innerWidth * DPR * AOS, innerHeight * DPR * AOS, undefined, { radius: 0.32, distanceExponent: 1.4, thickness: 1.2, scale: 1.0 }, { radius: 6, rings: 2, samples: 12 });
gtao.blendIntensity = 0.7;
{ const ss = gtao.setSize.bind(gtao); gtao.setSize = (w, h) => ss(Math.round(w * AOS), Math.round(h * AOS)); }
gtao.overrideVisibility = function () {                             // Blätter, Glas, Leuchtflächen nicht als Klötze mitrechnen
  const cache = this._visibilityCache;
  this.scene.traverse((o) => { cache.set(o, o.visible); if (o.isPoints || o.isLine || o.isSprite) o.visible = false; else if (o.isMesh && !Array.isArray(o.material) && (o.material.transparent || o.material.alphaTest > 0)) o.visible = false; });
};
composer.addPass(gtao);
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.28, 0.55, 0.9);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const finish = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uSeed: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uSeed; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uSeed) * 43758.5453); }
    void main(){ vec4 c = texture2D(tDiffuse, vUv); vec2 d = vUv - 0.5; float v = smoothstep(0.9, 0.28, length(d * vec2(1.0, 0.9)));
      c.rgb *= mix(0.93, 1.0, v); c.rgb += (h(gl_FragCoord.xy) - 0.5) * 0.022; gl_FragColor = c; }`,
});
composer.addPass(finish);
const FX = qs.get('fx'); let slow = 0;
if (FX === 'off') { gtao.enabled = false; bloom.enabled = false; }
addEventListener('resize', resize); resize();
const clock = new THREE.Clock(); const tmp = new THREE.Vector3();
const ease = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
function frame() {
  requestAnimationFrame(frame);
  const rawDt = clock.getDelta(), dt = Math.min(0.05, rawDt);
  if (FX !== 'hi' && gtao.enabled && rawDt > 0.045 && rawDt < 0.5 && (ptrs.size || walkTo || tween || joy)) { if (++slow > 25) { gtao.enabled = false; bloom.enabled = false; req(); } } else if (rawDt < 0.03) slow = Math.max(0, slow - 1);
  let active = false;
  if (st.mode === 'walk') {
    let f = 0, s = 0, turn = 0;
    if (keys.KeyW || keys.ArrowUp) f += 1; if (keys.KeyS || keys.ArrowDown) f -= 1; if (keys.KeyA) s -= 1; if (keys.KeyD) s += 1;
    if (keys.ArrowLeft) turn += 1; if (keys.ArrowRight) turn -= 1;
    if (joy) { f -= joy.dy; s += joy.dx; }
    if (turn) { st.yaw -= turn * dt * 1.6; active = true; }
    if (f || s) {
      const sp = 1.5 * dt, sy = Math.sin(st.yaw), cy = Math.cos(st.yaw);
      moveBy((-sy * f + cy * s) * sp, (-cy * f - sy * s) * sp); walkTo = null; tween = null; active = true;
    }
    if (walkTo) {
      const dx = walkTo.x - st.x, dz = walkTo.z - st.z, d = Math.hypot(dx, dz);
      if (d < 0.03) walkTo = null; else { const sp = Math.min(d, 1.6 * dt * Math.min(1, d * 1.5 + 0.35)); if (!moveBy(dx / d * sp, dz / d * sp)) walkTo = null; active = true; }
    }
    if (tween) {
      tween.t = Math.min(1, tween.t + dt / 0.9); const k = ease(tween.t);
      for (const key of ['x', 'z', 'yaw', 'pitch']) st[key] = tween.from[key] + (tween.to[key] - tween.from[key]) * k;
      if (tween.t >= 1) tween = null; active = true;
    }
    camera.position.set(st.x, EYE, st.z);
    for (const g of glows) g.visible = st.x < W + 0.1;
    camera.rotation.set(0, 0, 0); camera.rotateY(st.yaw); camera.rotateX(st.pitch);
  } else {
    const o = st.orbit, cx = W / 2, cz = L / 2;
    camera.position.set(cx + o.r * Math.sin(o.th) * Math.sin(o.ph), o.r * Math.cos(o.ph) + 0.6, cz + o.r * Math.cos(o.th) * Math.sin(o.ph));
    camera.lookAt(cx, 0.6, cz);
    const c = camera.position;
    const vis = { A: c.z > 0.05, B: c.x < W - 0.05, C: c.z < L - 0.05, D: c.x > 0.05, top: false };
    for (const obj of tagged) obj.visible = vis[obj.userData.wall] ?? true;
    { let far = null, fd = -1; for (const [x, z] of [[0, 0], [W, 0], [0, L], [W, L]]) { const dd = (c.x - x) ** 2 + (c.z - z) ** 2; if (dd > fd) { fd = dd; far = [x, z]; } } dims[4].p.set(far[0], H + 0.05, far[1]); }
    for (const d of dims) {
      tmp.copy(d.p).project(camera); const on = tmp.z < 1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1;
      d.el.style.display = on ? 'block' : 'none'; d.el.style.transform = `translate(${(tmp.x + 1) / 2 * innerWidth}px,${(1 - tmp.y) / 2 * innerHeight}px) translate(-50%,-50%)`;
    }
  }
  if (active || needRender || st.mode === 'top' && ptrs.size) { composer.render(); needRender = active; }
}
setLook(LOOK, false);
if (LOOK === 'matcha') { go('eingang'); tween = null; const v = VIEWS_M.eingang; Object.assign(st, { x: v.x, z: v.z, yaw: v.yaw, pitch: v.pitch }); }
else { go('fenster'); tween = null; Object.assign(st, { x: W / 2, z: L - 0.75, yaw: 0, pitch: -0.05 }); }
frame();
window.__room = { st, go, camera, renderer, scene, req, setLook, gtao, bloom, composer, setNeon: (v) => { neonOn.v = v; drawNeon(); } };
document.body.classList.add('ready');
