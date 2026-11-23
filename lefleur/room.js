// Le Fleur – Raum in 3D. Licht vorberechnet (bake.py → lightmap.png), alles andere hier.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js';

const qs = new URLSearchParams(location.search);
const VQ = (() => { try { return new URL(import.meta.url).search || ''; } catch (e) { return ''; } })();   // ?v=… gegen alte Zwischenspeicher
const TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const R = await fetch('room.json' + VQ).then(r => r.json());
const S = R.spec, { W, L, H } = S;
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
renderer.toneMappingExposure = +(qs.get('tm') || 1.0);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0xeceeed);
const camera = new THREE.PerspectiveCamera(72, 1, 0.03, 80);
let needRender = true; const req = () => { needRender = true; };

// ------------------------------------------------------------------ Lichtkarte
const lmURL = URL.createObjectURL(await fetch('lightmap.png' + VQ).then(r => r.blob()));      // über blob: (erlaubt im Artifact-Rahmen)
const lmImg = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = lmURL; });
const lmTex = new THREE.Texture(lmImg); lmTex.colorSpace = THREE.SRGBColorSpace; lmTex.channel = 1;
lmTex.generateMipmaps = false; lmTex.minFilter = THREE.LinearFilter; lmTex.magFilter = THREE.LinearFilter; lmTex.needsUpdate = true;
const lmPix = (() => { const c = document.createElement('canvas'); c.width = AW; c.height = AH; const g = c.getContext('2d'); g.drawImage(lmImg, 0, 0); return g.getImageData(0, 0, AW, AH).data; })();
const s2l = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const EXPO = +(qs.get('exp') || 0.0017);                 // Bestrahlung -> Bildhelligkeit
const LMI = Math.PI * EXPO / R.lmK;

function lmXY(q, p) {
  const [a, b] = OTHER[q.n];
  const fu = Math.min(1, Math.max(0, (p[a] - q.u[0]) / (q.u[1] - q.u[0]))), fv = Math.min(1, Math.max(0, (p[b] - q.v[0]) / (q.v[1] - q.v[0])));
  return [q.lm[0] + Math.min(q.nu - 0.5, Math.max(0.5, fu * q.nu)), q.lm[1] + Math.min(q.nv - 0.5, Math.max(0.5, fv * q.nv))];
}
const lmUV = (q, p) => { const [x, y] = lmXY(q, p); return [x / AW, 1 - y / AH]; };
function lmSample(q, p) {                                   // Bestrahlung an einem Punkt (linear, schon mit EXPO)
  const [x, y] = lmXY(q, p); const x0 = Math.floor(x - 0.5), y0 = Math.floor(y - 0.5), fx = x - 0.5 - x0, fy = y - 0.5 - y0;
  const o = [0, 0, 0];
  for (const [dx, dy, w] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]]) {
    const i = ((y0 + dy) * AW + (x0 + dx)) * 4; for (let k = 0; k < 3; k++) o[k] += s2l(lmPix[i + k]) * w;
  }
  return o.map(v => v / R.lmK * EXPO);
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
function bakedMat(color, map = null, extra = {}) { return new THREE.MeshBasicMaterial({ color, map, lightMap: lmTex, lightMapIntensity: LMI, dithering: true, ...extra }); }
const MAT = {
  wall: bakedMat(lin(...R.alb.wall)), ceil: bakedMat(lin(...R.alb.ceil)),
  floor: bakedMat(lin(1, 1, 1), floorTex), stone: bakedMat(lin(1, 1, 1), stoneTex),
  window: bakedMat(lin(...R.alb.window)), wood: bakedMat(lin(1, 1, 1), woodTex), rad: bakedMat(lin(1, 1, 1).multiplyScalar(0.82), radTex),
  edoor: bakedMat(lin(...R.alb.edoor)),
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
  if (q.name === 'window') continue;                       // nur für die Lichtkarte – das Fenster wird unten gebaut
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
  g.computeVertexNormals(); add(new THREE.Mesh(hostUV(g, 'wallC'), MAT.wall), 'C');
  // Laibung (1,8 cm) – oben dunkler (zeigt nach unten), Seiten mittel
  const P = [], C = [], U1 = []; const ring = pts.slice(1).concat([pts[0]]);   // rechts unten -> Bogen -> links unten
  const order = [pts[1], ...pts.slice(2), pts[0]];
  for (let i = 0; i < order.length - 1; i++) {
    const a = order[i], b = order[i + 1]; const nx = -(b.y - a.y), ny = (b.x - a.x); const ln = Math.hypot(nx, ny) || 1;
    const f = 0.42 + 0.3 * (1 - Math.abs(ny / ln));                                         // Bogen oben (zeigt nach unten) dunkler
    for (const [p, z] of [[a, L], [b, L], [b, L + AR.rec], [a, L], [b, L + AR.rec], [a, L + AR.rec]]) { P.push(p.x, p.y, z); C.push(f, f, f); }
  }
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); lg.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  add(new THREE.Mesh(hostUV(lg, 'wallC'), bakedMat(lin(...R.alb.wall), null, { vertexColors: true, side: THREE.DoubleSide })), 'C');
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

// ------------------------------------------------------------------ Steuerung
const st = { x: W / 2, z: L - 0.9, yaw: 0, pitch: -0.05, mode: 'walk', orbit: { th: 0.75, ph: 0.9, r: 8.2 } };
const keys = {}; let walkTo = null, tween = null, joy = null, look = null;
const RECTS = [[0.3, W - 0.3, 0.3, L - 0.3], [W - 0.35, W + S.PAS.t + 0.4, S.PAS.z0 + 0.3, S.PAS.z1 - 0.3], [W + S.PAS.t + 0.0, S.VES.x1 - 0.3, S.VES.z0 + 0.3, S.VES.z1 - 0.3]];
const free = (x, z) => RECTS.some(r => x >= r[0] && x <= r[1] && z >= r[2] && z <= r[3]) && !(x > W - 0.45 && x < W && z > S.SHELF.z0 - 0.1 && z < S.SHELF.z1 + 0.1);
function moveBy(dx, dz) { if (free(st.x + dx, st.z + dz)) { st.x += dx; st.z += dz; return true; } if (free(st.x + dx, st.z)) { st.x += dx; return true; } if (free(st.x, st.z + dz)) { st.z += dz; return true; } return false; }
const VIEWS = {
  fenster: { x: W / 2, z: L - 0.5, yaw: 0 }, eingang: { x: 0.5, z: 2.7, yaw: -Math.PI / 2 },
  bogen: { x: W / 2 - 0.2, z: 0.5, yaw: Math.PI }, wand: { x: W - 0.55, z: 2.6, yaw: Math.PI / 2 },
};
// yaw: 0 = Blick nach -z (Fenster); Blickrichtung = (-sin yaw, -cos yaw)
function go(name) {
  document.querySelectorAll('#views button').forEach(b => b.classList.toggle('on', b.dataset.v === name));
  if (name === 'oben') { setMode('top'); return; }
  const v = VIEWS[name]; if (st.mode !== 'walk') setMode('walk');
  let dy = v.yaw - st.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  tween = { t: 0, from: { x: st.x, z: st.z, yaw: st.yaw, pitch: st.pitch }, to: { x: v.x, z: v.z, yaw: st.yaw + dy, pitch: -0.05 } }; walkTo = null; req();
}
function setMode(m) {
  st.mode = m; document.body.classList.toggle('top', m === 'top');
  if (m === 'walk') { for (const o of tagged) o.visible = true; dims.forEach(d => d.el.style.display = 'none'); }
  else { const v = st; v.orbit.th = Math.atan2(st.x - W / 2 + 0.01, st.z - L / 2 + 0.01) ; }
  req();
}
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
  const w = innerWidth, h = innerHeight, a = w / h; renderer.setSize(w, h, false); camera.aspect = a;
  camera.fov = Math.min(100, Math.max(64, 2 * Math.atan(Math.tan(32 * Math.PI / 180) / a) * 180 / Math.PI)); camera.updateProjectionMatrix(); req();
}
addEventListener('resize', resize); resize();
const clock = new THREE.Clock(); const tmp = new THREE.Vector3();
const ease = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
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
  if (active || needRender || st.mode === 'top' && ptrs.size) { renderer.render(scene, camera); needRender = active; }
}
go('fenster'); tween = null; Object.assign(st, { x: W / 2, z: L - 0.75, yaw: 0, pitch: -0.05 });
frame();
window.__room = { st, go, camera, renderer, scene, req, setNeon: (v) => { neonOn.v = v; drawNeon(); } };
document.body.classList.add('ready');
