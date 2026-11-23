// Verkehr für den Block Müllerstraße / Seestraße / Genter Straße / Brüsseler Straße
// - Autos prozedural (Profil-Loft mit Rundungen, Scheiben, Lampen, Felgen), instanziert = wenige Draw Calls
// - Verkehr auf W.city.edges: Spuren, weiche Kurven an Kreuzungen, Abstand halten, Ampeln (W.signals)
// - Parker an den Bordsteinen, selbst fahren (Einsteigen / Aussteigen), Treffer (Scheibe splittert, Alarm), leiser Ton
// Koordinaten wie das Laden-Modell: x entlang Müllerstraße, z zur Straße, y oben. Kurs (yaw) wie rotation.y: vorwärts = (sin yaw, cos yaw).
import * as THREE from 'three';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const wrapA = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const hdg = (dx, dz) => Math.atan2(dx, dz);
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function pickW(rnd, list) { let s = 0; for (const it of list) s += it[1]; let r = rnd() * s; for (const it of list) { r -= it[1]; if (r <= 0) return it[0]; } return list[list.length - 1][0]; }
function pchip(keys) {
  const n = keys.length, xs = keys.map(k => k[0]), ys = keys.map(k => k[1]), h = [], d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) { h[i] = xs[i + 1] - xs[i]; d[i] = (ys[i + 1] - ys[i]) / h[i]; }
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) { if (d[i - 1] * d[i] <= 0) m[i] = 0; else { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]); } }
  return (x) => {
    if (x <= xs[0]) return ys[0]; if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const t = (x - xs[i]) / h[i], t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1];
  };
}
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

// ===================================================================================== Texturen
function makeAtlas() {
  const S = 512, cc = canvas(S, S), g = cc.getContext('2d'), cr = canvas(S, S), h = cr.getContext('2d');
  g.fillStyle = '#101010'; g.fillRect(0, 0, S, S); h.fillStyle = 'rgb(0,220,0)'; h.fillRect(0, 0, S, S);
  const SW = {}, RG = {};
  const list = [
    ['under', '#070707', 0.95, 0], ['black_plastic', '#141517', 0.62, 0], ['black_gloss', '#08090a', 0.14, 0.15], ['rubber', '#171717', 0.93, 0],
    ['alloy', '#aeb2b6', 0.3, 0.9], ['chrome', '#e4e6e8', 0.08, 1], ['head_lens', '#d2d8de', 0.05, 0.85], ['tail_lens', '#6a0709', 0.12, 0.1],
    ['ind_lens', '#b25a06', 0.2, 0.1], ['interior', '#1b1b1d', 0.9, 0], ['sign_yellow', '#f1cf35', 0.45, 0], ['grey_plastic', '#6a6d71', 0.6, 0],
    ['white', '#e9e9e9', 0.5, 0], ['dark_metal', '#2b2d30', 0.45, 0.6], ['mirror', '#9aa3ab', 0.04, 1], ['led', '#1a1206', 0.3, 0],
  ];
  list.forEach(([n, col, r, m], i) => { const x = (i % 8) * 64, y = Math.floor(i / 8) * 64; g.fillStyle = col; g.fillRect(x, y, 64, 64); h.fillStyle = `rgb(0,${Math.round(r * 255)},${Math.round(m * 255)})`; h.fillRect(x, y, 64, 64); SW[n] = [(x + 32) / S, 1 - (y + 32) / S]; });
  const region = (name, x, y, w, hh) => { RG[name] = [x / S, 1 - (y + hh) / S, (x + w) / S, 1 - y / S]; };
  // Kennzeichen (fiktiv)
  ['B·KA 482', 'B·LE 3315', 'B·MW 1907', 'B·TX 2611'].forEach((t, i) => {
    const x = i * 128, y = 128;
    g.fillStyle = '#1b1b1b'; g.fillRect(x, y, 128, 32); g.fillStyle = '#f3f3ef'; g.fillRect(x + 1, y + 1, 126, 30);
    g.fillStyle = '#1d3f9e'; g.fillRect(x + 2, y + 2, 13, 28); g.fillStyle = '#fff'; g.font = 'bold 9px sans-serif'; g.textAlign = 'center'; g.fillText('D', x + 8.5, y + 27);
    g.fillStyle = '#f6c400'; for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; g.fillRect(x + 8 + Math.cos(a) * 3.5, y + 11 + Math.sin(a) * 3.5, 1.2, 1.2); }
    g.fillStyle = '#111'; g.font = 'bold 19px "DIN Alternate", "Arial Narrow", sans-serif'; g.fillText(t, x + 71, y + 23);
    h.fillStyle = 'rgb(0,120,0)'; h.fillRect(x, y, 128, 32); region('plate' + i, x, y, 128, 32);
  });
  { // Kühlergrill (Lamellen)
    const x = 0, y = 160; g.fillStyle = '#0a0a0b'; g.fillRect(x, y, 128, 64);
    for (let k = 0; k < 8; k++) { g.fillStyle = '#26282b'; g.fillRect(x + 2, y + 4 + k * 7.5, 124, 3.2); }
    g.fillStyle = '#c9ccd0'; g.fillRect(x, y, 128, 2); g.fillRect(x, y + 62, 128, 2);
    h.fillStyle = 'rgb(0,110,90)'; h.fillRect(x, y, 128, 64); h.fillStyle = 'rgb(0,20,255)'; h.fillRect(x, y, 128, 2); h.fillRect(x, y + 62, 128, 2);
    region('grille', x, y, 128, 64);
  }
  { // Waben-Grill
    const x = 128, y = 160; g.fillStyle = '#09090a'; g.fillRect(x, y, 128, 64); g.strokeStyle = '#2a2c2f'; g.lineWidth = 1.6;
    for (let j = 0; j < 9; j++) for (let i = 0; i < 18; i++) { const cx = x + 4 + i * 7.2 + (j % 2) * 3.6, cy = y + 4 + j * 6.6; g.beginPath(); for (let k = 0; k < 6; k++) { const a = k / 6 * TAU + Math.PI / 6; g.lineTo(cx + Math.cos(a) * 3.4, cy + Math.sin(a) * 3.4); } g.closePath(); g.stroke(); }
    h.fillStyle = 'rgb(0,90,60)'; h.fillRect(x, y, 128, 64); region('honey', x, y, 128, 64);
  }
  { // Taxi-Dachschild
    const x = 256, y = 160; g.fillStyle = '#f4d23a'; g.fillRect(x, y, 128, 48); g.fillStyle = '#121212'; g.font = 'bold 34px Arial, sans-serif'; g.textAlign = 'center'; g.fillText('TAXI', x + 64, y + 37);
    h.fillStyle = 'rgb(0,90,0)'; h.fillRect(x, y, 128, 48); region('taxi', x, y, 128, 48);
  }
  { // Bus-Zielanzeige
    const x = 384, y = 160; g.fillStyle = '#0c0a06'; g.fillRect(x, y, 128, 32); g.fillStyle = '#ffae2a'; g.font = 'bold 16px "Arial Narrow", Arial, sans-serif'; g.textAlign = 'left'; g.fillText('120  Wedding', x + 6, y + 22);
    h.fillStyle = 'rgb(0,60,0)'; h.fillRect(x, y, 128, 32); region('busdisp', x, y, 128, 32);
  }
  { // Felge
    const x = 0, y = 256, cx = x + 64, cy = y + 64;
    const rg = g.createRadialGradient(cx, cy, 40, cx, cy, 64); rg.addColorStop(0, '#9da1a5'); rg.addColorStop(0.8, '#d5d8db'); rg.addColorStop(1, '#6a6d70');
    g.fillStyle = '#141516'; g.fillRect(x, y, 128, 128); g.fillStyle = rg; g.beginPath(); g.arc(cx, cy, 64, 0, TAU); g.fill();
    g.fillStyle = '#1c1d1f'; g.beginPath(); g.arc(cx, cy, 55, 0, TAU); g.fill();
    g.fillStyle = '#4c4f52'; g.beginPath(); g.arc(cx, cy, 40, 0, TAU); g.fill(); g.fillStyle = '#26282a'; g.beginPath(); g.arc(cx, cy, 20, 0, TAU); g.fill();
    g.fillStyle = '#3a1f1a'; g.fillRect(cx + 26, cy - 14, 12, 28);
    h.fillStyle = 'rgb(0,175,40)'; h.fillRect(x, y, 128, 128); h.fillStyle = 'rgb(0,70,235)'; h.beginPath(); h.arc(cx, cy, 64, 0, TAU); h.fill(); h.fillStyle = 'rgb(0,170,60)'; h.beginPath(); h.arc(cx, cy, 55, 0, TAU); h.fill();
    for (let k = 0; k < 5; k++) for (const s of [-1, 1]) {
      const a = k / 5 * TAU + s * 0.11, a2 = k / 5 * TAU + s * 0.2;
      const p = [[cx + Math.cos(a - s * 0.18) * 12, cy + Math.sin(a - s * 0.18) * 12], [cx + Math.cos(a) * 12, cy + Math.sin(a) * 12], [cx + Math.cos(a2) * 57, cy + Math.sin(a2) * 57], [cx + Math.cos(a2 - s * 0.12) * 57, cy + Math.sin(a2 - s * 0.12) * 57]];
      const sp = g.createLinearGradient(cx, cy, cx + Math.cos(a) * 57, cy + Math.sin(a) * 57); sp.addColorStop(0, '#8e9296'); sp.addColorStop(1, '#d9dcdf');
      g.fillStyle = sp; g.beginPath(); p.forEach(q => g.lineTo(q[0], q[1])); g.closePath(); g.fill();
      h.fillStyle = 'rgb(0,70,235)'; h.beginPath(); p.forEach(q => h.lineTo(q[0], q[1])); h.closePath(); h.fill();
    }
    g.fillStyle = '#b4b8bc'; g.beginPath(); g.arc(cx, cy, 14, 0, TAU); g.fill(); g.fillStyle = '#2a2c2f'; g.beginPath(); g.arc(cx, cy, 6.5, 0, TAU); g.fill();
    g.fillStyle = '#5c6064'; for (let k = 0; k < 5; k++) { const a = (k + 0.5) / 5 * TAU; g.beginPath(); g.arc(cx + Math.cos(a) * 10, cy + Math.sin(a) * 10, 1.7, 0, TAU); g.fill(); }
    h.fillStyle = 'rgb(0,70,235)'; h.beginPath(); h.arc(cx, cy, 14, 0, TAU); h.fill();
    region('rim', x, y, 128, 128);
  }
  { // Stahlfelge mit Radkappe (Lieferwagen)
    const x = 128, y = 256, cx = x + 64, cy = y + 64; g.fillStyle = '#141516'; g.fillRect(x, y, 128, 128);
    g.fillStyle = '#bfc3c7'; g.beginPath(); g.arc(cx, cy, 62, 0, TAU); g.fill(); g.fillStyle = '#9fa3a7'; g.beginPath(); g.arc(cx, cy, 46, 0, TAU); g.fill();
    g.fillStyle = '#2b2d30'; for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; g.beginPath(); g.ellipse(cx + Math.cos(a) * 52, cy + Math.sin(a) * 52, 6, 3.5, a, 0, TAU); g.fill(); }
    g.fillStyle = '#d4d7da'; g.beginPath(); g.arc(cx, cy, 16, 0, TAU); g.fill();
    h.fillStyle = 'rgb(0,90,220)'; h.fillRect(x, y, 128, 128); region('steel', x, y, 128, 128);
  }
  const tex = new THREE.CanvasTexture(cc); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const rm = new THREE.CanvasTexture(cr); rm.colorSpace = THREE.NoColorSpace;
  return { tex, rm, SW, RG };
}
function softTex(w, h, fn) { const c = canvas(w, h); fn(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
function envCanvas(night) {
  const W = 1024, H = 512, c = canvas(W, H), g = c.getContext('2d'), r = mulberry(night ? 9 : 7);
  let gr = g.createLinearGradient(0, 0, 0, H / 2);
  if (night) { gr.addColorStop(0, '#020308'); gr.addColorStop(0.7, '#0a1020'); gr.addColorStop(1, '#1b2335'); } else { gr.addColorStop(0, '#5a82b0'); gr.addColorStop(0.6, '#a7bfd8'); gr.addColorStop(1, '#e4e9ee'); }
  g.fillStyle = gr; g.fillRect(0, 0, W, H / 2);
  gr = g.createLinearGradient(0, H / 2, 0, H); if (night) { gr.addColorStop(0, '#0b0b0d'); gr.addColorStop(1, '#030303'); } else { gr.addColorStop(0, '#5d5f61'); gr.addColorStop(1, '#2c2d2e'); }
  g.fillStyle = gr; g.fillRect(0, H / 2, W, H / 2);
  for (let x = 0; x < W;) { // Häuserreihe am Horizont
    const w = 40 + r() * 70, hh = 45 + r() * 70; g.fillStyle = night ? '#07080b' : ['#8f877a', '#a39b8b', '#7f786d', '#b2a996'][r() * 4 | 0]; g.fillRect(x, H / 2 - hh, w, hh + 2);
    for (let wy = H / 2 - hh + 8; wy < H / 2 - 6; wy += 11) for (let wx = x + 5; wx < x + w - 6; wx += 9) { const lit = night && r() < 0.18; g.fillStyle = night ? (lit ? '#e0a860' : '#050608') : (r() < 0.5 ? '#4b5b6d' : '#3a4655'); g.fillRect(wx, wy, 4, 6); }
    x += w;
  }
  if (night) for (let x = 20; x < W; x += 70 + r() * 50) { const y = H / 2 - 30 - r() * 15, R = 10; const gg = g.createRadialGradient(x, y, 0, x, y, R); gg.addColorStop(0, 'rgba(255,240,210,1)'); gg.addColorStop(0.3, 'rgba(255,190,120,0.7)'); gg.addColorStop(1, 'rgba(255,170,100,0)'); g.fillStyle = gg; g.fillRect(x - R, y - R, 2 * R, 2 * R); }
  else { const gg = g.createRadialGradient(330, 70, 0, 330, 70, 40); gg.addColorStop(0, 'rgba(255,253,240,1)'); gg.addColorStop(1, 'rgba(255,250,230,0)'); g.fillStyle = gg; g.fillRect(290, 30, 80, 80); }
  return c;
}

// ===================================================================================== Geometrie-Bauer
class GB {
  constructor() { this.p = []; this.n = []; this.u = []; this.c = []; }
  v(p, n, uv, c) { this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]); this.u.push(uv[0], uv[1]); this.c.push(c, c, c); }
  tri(a, b, c, na, nb, nc, ua, ub, uc, ca = 1, cb = 1, cc = 1) {
    const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2], e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
    const fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x, ar = fx * fx + fy * fy + fz * fz;
    if (ar < 1e-14) return;
    if (fx * (na[0] + nb[0] + nc[0]) + fy * (na[1] + nb[1] + nc[1]) + fz * (na[2] + nb[2] + nc[2]) < 0) { this.v(a, na, ua, ca); this.v(c, nc, uc, cc); this.v(b, nb, ub, cb); }
    else { this.v(a, na, ua, ca); this.v(b, nb, ub, cb); this.v(c, nc, uc, cc); }
  }
  box(cx, cy, cz, sx, sy, sz, uvf, col = 1, ry = 0) {
    const cr = Math.cos(ry), sr = Math.sin(ry);
    const rot = (x, y, z) => [x * cr + z * sr, y, -x * sr + z * cr];
    const F = [['px', [1, 0, 0], [0, 0, -1], [0, 1, 0]], ['nx', [-1, 0, 0], [0, 0, 1], [0, 1, 0]], ['py', [0, 1, 0], [1, 0, 0], [0, 0, -1]], ['ny', [0, -1, 0], [1, 0, 0], [0, 0, 1]], ['pz', [0, 0, 1], [1, 0, 0], [0, 1, 0]], ['nz', [0, 0, -1], [-1, 0, 0], [0, 1, 0]]];
    for (const [name, n, t, b] of F) {
      const f = uvf(name); if (f === null) continue;
      const cor = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, bb]) => {
        const lx = (n[0] * 0.5 + (t[0] * a + b[0] * bb) * 0.5) * sx, ly = (n[1] * 0.5 + (t[1] * a + b[1] * bb) * 0.5) * sy, lz = (n[2] * 0.5 + (t[2] * a + b[2] * bb) * 0.5) * sz;
        const q = rot(lx, ly, lz); return [q[0] + cx, q[1] + cy, q[2] + cz];
      });
      const nn = rot(n[0], n[1], n[2]);
      const uv = f.rect ? [[f.rect[0], f.rect[1]], [f.rect[2], f.rect[1]], [f.rect[2], f.rect[3]], [f.rect[0], f.rect[3]]] : [f.uv, f.uv, f.uv, f.uv];
      this.tri(cor[0], cor[1], cor[2], nn, nn, nn, uv[0], uv[1], uv[2], col, col, col); this.tri(cor[0], cor[2], cor[3], nn, nn, nn, uv[0], uv[2], uv[3], col, col, col);
    }
  }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere(); return g;
  }
}

// ===================================================================================== Fahrzeugtypen
// z von hinten (-L/2) nach vorn (+L/2). top/belt/yb: Stützpunkte [z, y]. zones: Flächen (Scheiben, Lampen, Grill …)
const TOP = ['top'], UP = ['upper', 'upper2'], UP1 = ['upper'];
const TYPES = [
  { id: 'klein', name: 'Kleinwagen', L: 4.07, W: 1.75, wb: 2.56, zf: 1.215, r: 0.31, tw: 0.195, k: 0.33, rb: 0.11, rt: 0.11, crown: 0.02, fz: 0.46, rz: 0.30, pp: 2.6, flare: 0.016, bulge: 0.01, crease: 0.004, plate: 0, rim: 'rim',
    top: [[-2.035, 0.80], [-2.02, 0.98], [-1.96, 1.17], [-1.80, 1.34], [-1.52, 1.43], [-0.6, 1.455], [0.22, 1.45], [0.55, 1.30], [0.92, 1.02], [1.20, 0.975], [1.62, 0.915], [1.88, 0.85], [1.99, 0.75], [2.035, 0.60]],
    belt: [[-2.035, 0.97], [-1.4, 0.99], [0, 0.965], [1.0, 0.945], [2.035, 0.84]],
    yb: [[-2.035, 0.44], [-1.85, 0.34], [-1.6, 0.30], [1.55, 0.30], [1.85, 0.33], [2.035, 0.40]],
    seams: [0.84, -0.30, -0.98], ws: [0.26, 0.90], roof: [-1.50, 0.24], cowl: 0.92,
    zones: [
      { m: 'glass', cat: TOP, z: [0.26, 0.90] },
      { m: 'glass', cat: TOP, z: [-1.93, -1.50] },
      { m: 'black_gloss', cat: UP, z: [-0.36, -0.24] },
      { m: 'glass', cat: UP, z: [-1.30, 0.80] },
      { m: 'black_plastic', cat: ['lowcorner', 'side0'], z: [1.75, 2.04] }, { m: 'black_plastic', cat: ['lowcorner', 'side0'], z: [-2.04, -1.80] },
    ],
    lamps: [
      { m: 'head_lens', f: 1, x: [0.40, 0.77], y: [0.67, 0.80], g: 'head' }, { m: 'ind_lens', f: 1, x: [0.77, 0.83], y: [0.67, 0.76], g: 'indF', nx: 1, ny: 1 },
      { m: 'grille', uv: 'honey', f: 1, x: [-0.36, 0.36], y: [0.57, 0.67], nx: 4, ny: 1 }, { m: 'black_plastic', uv: 'honey', f: 1, x: [-0.56, 0.56], y: [0.42, 0.50], nx: 8, ny: 1 },
      { m: 'tail_lens', f: -1, x: [0.46, 0.80], y: [0.86, 0.99], g: 'tail' }, { m: 'ind_lens', f: -1, x: [0.46, 0.54], y: [0.80, 0.86], g: 'indR', nx: 1, ny: 1 },
      { m: 'glass', f: -1, x: [-0.58, 0.58], y: [1.04, 1.30], nx: 8, ny: 3 }, { m: 'tail_lens', f: -1, x: [-0.16, 0.16], y: [1.33, 1.355], g: 'brake3', nx: 2, ny: 1 },
    ],
  },
  { id: 'limo', name: 'Limousine', L: 4.76, W: 1.83, wb: 2.85, zf: 1.45, r: 0.33, tw: 0.215, k: 0.36, rb: 0.12, rt: 0.11, crown: 0.025, fz: 0.55, rz: 0.42, pp: 2.6, flare: 0.02, bulge: 0.012, crease: 0.005, plate: 1, rim: 'rim',
    top: [[-2.38, 0.74], [-2.33, 0.92], [-2.18, 0.99], [-1.75, 1.02], [-1.50, 1.05], [-1.02, 1.34], [-0.70, 1.425], [-0.20, 1.445], [0.30, 1.43], [0.62, 1.30], [1.00, 1.03], [1.30, 0.98], [1.85, 0.92], [2.22, 0.84], [2.33, 0.74], [2.38, 0.60]],
    belt: [[-2.38, 0.92], [-1.6, 1.00], [-0.5, 0.99], [1.0, 0.97], [2.38, 0.86]],
    yb: [[-2.38, 0.46], [-2.2, 0.36], [-1.95, 0.31], [1.95, 0.31], [2.2, 0.35], [2.38, 0.42]],
    seams: [0.93, -0.10, -0.96], ws: [0.33, 0.98], roof: [-0.66, 0.33], cowl: 1.0,
    zones: [
      { m: 'glass', cat: TOP, z: [0.33, 0.98] },
      { m: 'glass', cat: TOP, z: [-1.47, -0.68] },
      { m: 'black_gloss', cat: UP, z: [-0.16, -0.04] },
      { m: 'glass', cat: UP, z: [-1.02, 0.86] },
      { m: 'black_plastic', cat: ['lowcorner', 'side0'], z: [2.05, 2.39] }, { m: 'black_plastic', cat: ['lowcorner', 'side0'], z: [-2.39, -2.1] },
    ],
    lamps: [
      { m: 'head_lens', f: 1, x: [0.44, 0.83], y: [0.69, 0.80], g: 'head' }, { m: 'ind_lens', f: 1, x: [0.83, 0.88], y: [0.69, 0.77], g: 'indF', nx: 1, ny: 1 },
      { m: 'grille', uv: 'grille', f: 1, x: [-0.40, 0.40], y: [0.58, 0.69], nx: 4, ny: 1 }, { m: 'black_plastic', uv: 'honey', f: 1, x: [-0.62, 0.62], y: [0.44, 0.51], nx: 8, ny: 1 },
      { m: 'tail_lens', f: -1, x: [0.42, 0.86], y: [0.85, 0.97], g: 'tail' }, { m: 'ind_lens', f: -1, x: [0.42, 0.50], y: [0.79, 0.85], g: 'indR', nx: 1, ny: 1 },
      { m: 'tail_lens', f: -1, x: [-0.18, 0.18], y: [1.025, 1.04], g: 'brake3', nx: 2, ny: 1 },
    ],
  },
  { id: 'kombi', name: 'Kombi', L: 4.78, W: 1.83, wb: 2.79, zf: 1.47, r: 0.33, tw: 0.215, k: 0.34, rb: 0.12, rt: 0.11, crown: 0.02, fz: 0.55, rz: 0.30, pp: 2.6, flare: 0.02, bulge: 0.012, crease: 0.005, plate: 2, rim: 'rim',
    top: [[-2.39, 0.82], [-2.37, 1.02], [-2.31, 1.30], [-2.18, 1.42], [-1.90, 1.465], [-0.6, 1.475], [0.28, 1.45], [0.60, 1.31], [1.00, 1.04], [1.30, 0.99], [1.85, 0.93], [2.24, 0.85], [2.34, 0.75], [2.39, 0.60]],
    belt: [[-2.39, 1.00], [-1.6, 1.01], [0.0, 0.99], [1.0, 0.97], [2.39, 0.86]],
    yb: [[-2.39, 0.46], [-2.2, 0.36], [-1.95, 0.32], [1.95, 0.31], [2.2, 0.35], [2.39, 0.42]],
    seams: [0.95, -0.08, -0.92], ws: [0.31, 0.98], roof: [-2.0, 0.31], cowl: 1.0,
    zones: [
      { m: 'glass', cat: TOP, z: [0.31, 0.98] },
      { m: 'black_gloss', cat: UP, z: [-0.14, -0.02] },
      { m: 'black_gloss', cat: UP, z: [-1.16, -1.06] },
      { m: 'glass', cat: UP, z: [-2.02, 0.86] },
      { m: 'black_plastic', cat: ['lowcorner', 'side0'], z: [2.05, 2.40] }, { m: 'black_plastic', cat: ['lowcorner', 'side0'], z: [-2.40, -2.12] },
    ],
    lamps: [
      { m: 'head_lens', f: 1, x: [0.44, 0.83], y: [0.69, 0.80], g: 'head' }, { m: 'ind_lens', f: 1, x: [0.83, 0.88], y: [0.69, 0.77], g: 'indF', nx: 1, ny: 1 },
      { m: 'grille', uv: 'grille', f: 1, x: [-0.40, 0.40], y: [0.58, 0.69], nx: 4, ny: 1 }, { m: 'black_plastic', uv: 'honey', f: 1, x: [-0.62, 0.62], y: [0.44, 0.51], nx: 8, ny: 1 },
      { m: 'tail_lens', f: -1, x: [0.50, 0.86], y: [0.88, 1.06], g: 'tail' }, { m: 'ind_lens', f: -1, x: [0.50, 0.58], y: [0.82, 0.88], g: 'indR', nx: 1, ny: 1 },
      { m: 'glass', f: -1, x: [-0.62, 0.62], y: [1.08, 1.38], nx: 8, ny: 3 }, { m: 'tail_lens', f: -1, x: [-0.18, 0.18], y: [1.405, 1.43], g: 'brake3', nx: 2, ny: 1 },
    ],
  },
  { id: 'suv', name: 'SUV', L: 4.51, W: 1.86, wb: 2.68, zf: 1.355, r: 0.36, tw: 0.235, k: 0.30, rb: 0.12, rt: 0.13, crown: 0.02, fz: 0.50, rz: 0.32, pp: 2.6, flare: 0.022, bulge: 0.012, crease: 0.006, plate: 3, rim: 'rim', clad: true,
    top: [[-2.255, 0.88], [-2.24, 1.06], [-2.20, 1.22], [-2.10, 1.48], [-1.90, 1.62], [-1.0, 1.665], [0.30, 1.655], [0.62, 1.50], [1.02, 1.17], [1.35, 1.12], [1.85, 1.06], [2.15, 0.98], [2.23, 0.86], [2.255, 0.70]],
    belt: [[-2.255, 1.13], [-1.5, 1.14], [0, 1.12], [1.0, 1.10], [2.255, 1.0]],
    yb: [[-2.255, 0.56], [-2.05, 0.44], [-1.8, 0.40], [1.75, 0.40], [2.0, 0.44], [2.255, 0.52]],
    seams: [0.93, -0.12, -0.94], ws: [0.33, 1.0], roof: [-1.9, 0.33], cowl: 1.02,
    zones: [
      { m: 'glass', cat: TOP, z: [0.33, 1.0] },
      { m: 'glass', cat: TOP, z: [-2.12, -1.92] },
      { m: 'black_gloss', cat: UP, z: [-0.18, -0.06] },
      { m: 'black_gloss', cat: UP, z: [-1.10, -0.98] },
      { m: 'glass', cat: UP, z: [-1.86, 0.88] },
      { m: 'black_plastic', cat: ['side0'], z: [-2.26, 2.26] },
    ],
    lamps: [
      { m: 'head_lens', f: 1, x: [0.46, 0.86], y: [0.84, 0.95], g: 'head' }, { m: 'ind_lens', f: 1, x: [0.86, 0.90], y: [0.84, 0.92], g: 'indF', nx: 1, ny: 1 },
      { m: 'grille', uv: 'honey', f: 1, x: [-0.44, 0.44], y: [0.68, 0.84], nx: 4, ny: 2 }, { m: 'black_plastic', uv: 'honey', f: 1, x: [-0.66, 0.66], y: [0.54, 0.60], nx: 8, ny: 1 },
      { m: 'tail_lens', f: -1, x: [0.48, 0.88], y: [1.00, 1.12], g: 'tail' }, { m: 'ind_lens', f: -1, x: [0.48, 0.56], y: [0.94, 1.0], g: 'indR', nx: 1, ny: 1 },
      { m: 'glass', f: -1, x: [-0.62, 0.62], y: [1.24, 1.52], nx: 8, ny: 3 }, { m: 'tail_lens', f: -1, x: [-0.18, 0.18], y: [1.56, 1.585], g: 'brake3', nx: 2, ny: 1 },
    ],
  },
  { id: 'van', name: 'Lieferwagen', L: 5.93, W: 2.02, wb: 3.66, zf: 1.945, r: 0.36, tw: 0.225, k: 0.07, rb: 0.14, rt: 0.16, crown: 0.02, fz: 0.42, rz: 0.10, pp: 2.4, flare: 0.012, bulge: 0.008, crease: 0.004, plate: 0, rim: 'steel', win: 0.66,
    top: [[-2.965, 2.30], [-2.95, 2.48], [-2.86, 2.55], [1.15, 2.56], [1.35, 2.42], [1.55, 2.06], [2.22, 1.30], [2.65, 1.20], [2.90, 1.05], [2.965, 0.80]],
    belt: [[-2.965, 1.26], [1.6, 1.27], [2.2, 1.24], [2.965, 1.05]],
    yb: [[-2.965, 0.50], [-2.8, 0.44], [2.6, 0.42], [2.8, 0.46], [2.965, 0.54]],
    seams: [1.02, -0.05, 0.92], ws: [1.58, 2.18], roof: [-2.9, 1.3], cowl: 2.2,
    zones: [
      { m: 'glass', cat: TOP, z: [1.56, 2.18] },
      { m: 'glass', cat: UP1, z: [1.05, 2.05] },
      { m: 'black_plastic', cat: ['lowcorner', 'side0'], z: [2.6, 2.97] }, { m: 'black_plastic', cat: ['lowcorner', 'side0'], z: [-2.97, -2.8] },
      { m: 'black_plastic', cat: ['side1'], z: [-2.6, 2.6] },
    ],
    lamps: [
      { m: 'head_lens', f: 1, x: [0.52, 0.90], y: [0.90, 1.05], g: 'head' }, { m: 'ind_lens', f: 1, x: [0.90, 0.96], y: [0.90, 1.0], g: 'indF', nx: 1, ny: 1 },
      { m: 'grille', uv: 'grille', f: 1, x: [-0.50, 0.50], y: [0.74, 0.90], nx: 4, ny: 2 }, { m: 'black_plastic', f: 1, x: [-0.86, 0.86], y: [0.56, 0.64], nx: 8, ny: 1 },
      { m: 'tail_lens', f: -1, x: [0.88, 0.98], y: [0.78, 1.28], g: 'tail', nx: 1, ny: 3 }, { m: 'ind_lens', f: -1, x: [0.88, 0.98], y: [1.28, 1.40], g: 'indR', nx: 1, ny: 1 },
      { m: 'glass', f: -1, x: [0.06, 0.84], y: [1.55, 2.22], nx: 5, ny: 3 }, { m: 'tail_lens', f: -1, x: [-0.20, 0.20], y: [2.44, 2.47], g: 'brake3', nx: 2, ny: 1 },
    ],
  },
  { id: 'taxi', name: 'Taxi', L: 4.92, W: 1.85, wb: 2.94, zf: 1.52, r: 0.33, tw: 0.215, k: 0.36, rb: 0.12, rt: 0.11, crown: 0.025, fz: 0.56, rz: 0.42, pp: 2.6, flare: 0.02, bulge: 0.012, crease: 0.005, plate: 3, rim: 'rim', taxi: true,
    top: [[-2.46, 0.74], [-2.41, 0.93], [-2.25, 1.00], [-1.80, 1.03], [-1.55, 1.06], [-1.05, 1.35], [-0.72, 1.44], [-0.20, 1.46], [0.30, 1.445], [0.64, 1.31], [1.04, 1.04], [1.36, 0.99], [1.90, 0.93], [2.30, 0.85], [2.41, 0.75], [2.46, 0.60]],
    belt: [[-2.46, 0.93], [-1.6, 1.00], [-0.5, 0.99], [1.0, 0.97], [2.46, 0.86]],
    yb: [[-2.46, 0.46], [-2.25, 0.36], [-2.0, 0.31], [2.0, 0.31], [2.25, 0.35], [2.46, 0.42]],
    seams: [0.97, -0.10, -1.0], ws: [0.33, 1.02], roof: [-0.70, 0.33], cowl: 1.04,
    zones: [
      { m: 'glass', cat: TOP, z: [0.33, 1.02] },
      { m: 'glass', cat: TOP, z: [-1.52, -0.70] },
      { m: 'black_gloss', cat: UP, z: [-0.16, -0.04] },
      { m: 'glass', cat: UP, z: [-1.05, 0.90] },
      { m: 'black_plastic', cat: ['lowcorner', 'side0'], z: [2.12, 2.47] }, { m: 'black_plastic', cat: ['lowcorner', 'side0'], z: [-2.47, -2.18] },
    ],
    lamps: [
      { m: 'head_lens', f: 1, x: [0.46, 0.84], y: [0.69, 0.80], g: 'head' }, { m: 'ind_lens', f: 1, x: [0.84, 0.89], y: [0.69, 0.77], g: 'indF', nx: 1, ny: 1 },
      { m: 'grille', uv: 'grille', f: 1, x: [-0.40, 0.40], y: [0.58, 0.69], nx: 4, ny: 1 }, { m: 'black_plastic', uv: 'honey', f: 1, x: [-0.62, 0.62], y: [0.44, 0.51], nx: 8, ny: 1 },
      { m: 'tail_lens', f: -1, x: [0.42, 0.87], y: [0.85, 0.97], g: 'tail' }, { m: 'ind_lens', f: -1, x: [0.42, 0.50], y: [0.79, 0.85], g: 'indR', nx: 1, ny: 1 },
      { m: 'tail_lens', f: -1, x: [-0.18, 0.18], y: [1.035, 1.05], g: 'brake3', nx: 2, ny: 1 },
    ],
  },
  { id: 'bus', name: 'BVG-Bus', L: 12.0, W: 2.55, wb: 5.95, zf: 3.30, r: 0.50, tw: 0.30, k: 0.04, rb: 0.10, rt: 0.22, crown: 0.02, fz: 0.32, rz: 0.22, pp: 2.2, flare: 0, bulge: 0.006, crease: 0.0, plate: 3, rim: 'steel', win: 1.62, step: 0.9, bus: true, lampDepth: 0.6,
    top: [[-6.0, 2.80], [-5.96, 2.98], [-5.80, 3.05], [5.62, 3.05], [5.86, 2.96], [5.97, 2.72], [6.0, 2.45]],
    belt: [[-6.0, 1.16], [6.0, 1.12]],
    yb: [[-6.0, 0.40], [-5.8, 0.32], [5.8, 0.30], [6.0, 0.36]],
    seams: [], ws: [9, 9], roof: [-5.8, 5.6], cowl: 5.9,
    zones: [
      { m: 'glass', nz: 'f', y: [0.82, 2.46], ax: [0, 1.22] },
      { m: 'black_gloss', cat: UP1, z: [-3.10, -2.98] }, { m: 'black_gloss', cat: UP1, z: [-0.60, -0.48] }, { m: 'black_gloss', cat: UP1, z: [1.90, 2.02] },
      { m: 'black_gloss', cat: UP1, z: [3.65, 3.77] },
      { m: 'glass', cat: UP1, z: [-5.55, 5.75] },
      { m: 'black_plastic', nz: 'f', y: [0, 0.42] },
      { m: 'black_plastic', nz: 'r', y: [0, 0.50] },
    ],
    lamps: [
      { m: 'head_lens', f: 1, x: [0.64, 1.12], y: [0.50, 0.70], g: 'head' }, { m: 'ind_lens', f: 1, x: [1.12, 1.20], y: [0.50, 0.64], g: 'indF', nx: 1, ny: 1 },
      { m: 'led', uv: 'busdisp', f: 1, x: [-1.0, 1.0], y: [2.50, 2.70], g: 'disp', nx: 8, ny: 1 },
      { m: 'tail_lens', f: -1, x: [0.88, 1.18], y: [0.58, 1.02], g: 'tail', nx: 2, ny: 2 }, { m: 'ind_lens', f: -1, x: [0.88, 1.18], y: [1.02, 1.12], g: 'indR', nx: 2, ny: 1 },
      { m: 'glass', f: -1, x: [-1.0, 1.0], y: [1.60, 2.60], nx: 6, ny: 3 }, { m: 'tail_lens', f: -1, x: [-0.3, 0.3], y: [2.84, 2.88], g: 'brake3', nx: 2, ny: 1 },
    ],
  },
];
TYPES.forEach((t, i) => { t.idx = i; t.zr = t.zf - t.wb; t.zMid = (t.zf + t.zr) / 2; t.H = Math.max(...t.top.map(k => k[1])); t.bus = !!t.bus; });
// Zweiräder (Fahrrad, E-Roller): eigene Darstellung, fahren auf denselben Spuren am rechten Rand (Helfer „Leben“)
const SMALL = [
  { id: 'bike', name: 'Fahrrad', L: 1.75, W: 0.62, wb: 1.08, zf: 0.54, r: 0.34, H: 1.8, vmax: 5.6, lat: 0.95, small: true },
  { id: 'scooter', name: 'E-Roller', L: 1.15, W: 0.56, wb: 0.86, zf: 0.43, r: 0.1, H: 1.9, vmax: 5.2, lat: 0.95, small: true },
];
SMALL.forEach((t, i) => { t.zr = t.zf - t.wb; t.zMid = (t.zf + t.zr) / 2; t.bus = false; t.idx = -1 - i; t.beltAt = () => 0.9; t.wAt = () => t.W / 2; });

// Karosserie als Loft: Querschnitte (gerundet, eingezogene Fensterpartie) entlang der Länge
function buildBody(T, A, lo = false) {
  const L = T.L, hw = T.W / 2, r = T.r, archR = r + 0.075;
  const top = pchip(T.top), belt = pchip(T.belt), ybk = pchip(T.yb);
  const zF0 = L / 2 - T.fz, zR0 = -L / 2 + T.rz, axles = [T.zf, T.zr];
  const planW = (z) => { let u = 0; if (z > zF0) u = (z - zF0) / T.fz; else if (z < zR0) u = (zR0 - z) / T.rz; u = clamp(u, 0, 1); return hw * Math.pow(Math.max(0, 1 - Math.pow(u, T.pp)), 1 / T.pp); };
  const wAt = (z) => { const w0 = planW(z); let f = 0; for (const za of axles) f += Math.exp(-(((z - za) / 0.55) ** 2)); return w0 + T.flare * f * (w0 / hw); };
  const ybAt = (z) => { let y = ybk(z); for (const za of axles) { const d = z - za; if (Math.abs(d) < archR) y = Math.max(y, r + Math.sqrt(archR * archR - d * d)); } return y; };
  T.planW = planW; T.wAt = wAt; T.topF = top; T.beltF = belt;
  // Stationen
  const crit = [], opt = [];
  for (const f of (lo ? [0, 0.45, 0.8, 0.95, 1] : [0, 0.12, 0.3, 0.5, 0.68, 0.83, 0.93, 0.98, 1])) crit.push(zF0 + T.fz * f, zR0 - T.rz * f);
  if (!lo) { for (const zn of T.zones) if (zn.z) crit.push(zn.z[0], zn.z[1]); for (const s of T.seams) crit.push(s - 0.014, s, s + 0.014); }
  const nMid = Math.max(2, Math.round((zF0 - zR0) / ((T.step || 0.42) * (lo ? 2 : 1.25))));
  for (let i = 1; i < nMid; i++) opt.push(zR0 + (zF0 - zR0) * i / nMid);
  for (const za of axles) for (const f of (lo ? [-0.85, 0, 0.85] : [-1, -0.75, 0, 0.75, 1])) opt.push(za + f * archR);
  if (!lo) for (const k of T.top) opt.push(k[0]); else for (const k of T.top) if (Math.abs(k[0]) < L / 2 - 0.3) opt.push(k[0]);
  let zs = crit.filter(z => z >= -L / 2 - 1e-6 && z <= L / 2 + 1e-6).map(z => clamp(z, -L / 2, L / 2)).sort((a, b) => a - b);
  zs = zs.filter((z, i) => i === 0 || z - zs[i - 1] > 0.004);
  const fixed = zs.slice();
  const gapMin = lo ? 0.18 : 0.07;
  for (const z of opt) { if (z <= -L / 2 + 0.02 || z >= L / 2 - 0.02) continue; if (fixed.every(q => Math.abs(q - z) > gapMin) && zs.every(q => Math.abs(q - z) > gapMin * 0.7)) zs.push(z); }
  zs.sort((a, b) => a - b);
  const seamC = new Set(T.seams.map(s => zs.findIndex(z => Math.abs(z - s) < 1e-6)));
  // Querschnitte
  const NH = lo ? 8 : 14, NR = 2 * NH - 2;
  const AO = lo ? [0.45, 0.72, 1, 1, 1, 1, 1, 1] : [0.42, 0.55, 0.68, 0.8, 0.9, 0.97, 1, 1, 1, 1, 1, 1, 1, 1];
  const CAT = lo ? ['bottom', 'side1', 'side3', 'upper', 'upper2', 'topcorner', 'top'] : ['bottom', 'lowcorner', 'side0', 'side1', 'side2', 'side3', 'side4', 'upper', 'upper2', 'topcorner', 'topcorner', 'top', 'top'];
  const G = [], BE = [];
  for (const z of zs) {
    const w = wAt(z), yb = ybAt(z), yt = top(z);
    const rt = Math.min(T.rt, w * 0.45, Math.max(0.005, (yt - yb) * 0.3)), yU = yt - rt;
    let bE = Math.min(belt(z), yU);
    const rb = Math.min(T.rb, w * 0.45, Math.max(0.004, (bE - yb) * 0.4)), L0 = yb + rb;
    if (bE < L0) bE = L0;
    const lv = (d) => Math.max(L0, bE - d);
    const side = (y) => { const f = bE > L0 + 1e-4 ? (y - L0) / (bE - L0) : 0; return w + T.bulge * Math.sin(Math.PI * clamp(f, 0, 1)) * (w / hw); };
    const xAt = (y) => (y <= bE ? side(y) : w - Math.min(T.k * (y - bE), w * 0.5));
    const yU1 = Math.min(yU, bE + (T.win || 9)), xU = xAt(yU);
    const s0 = lv(0.36);
    const half = lo ? [[0, yb], [w, L0], [side((L0 + bE) / 2), (L0 + bE) / 2], [w, bE], [xAt(yU1), yU1], [xU, yU], [xU - rt, yt], [0, yt + T.crown]] : [[0, yb], [w - rb + rb * 0.7071, yb + rb - rb * 0.7071], [w, L0], [side((L0 + s0) / 2), (L0 + s0) / 2], [side(s0), s0], [side(lv(0.22)), lv(0.22)], [side(lv(0.09)) + T.crease * (w / hw), lv(0.09)], [w, bE],
      [xAt(yU1), yU1], [xU, yU], [xU - rt + rt * 0.7071, yU + rt * 0.7071], [xU - rt, yt], [(xU - rt) * 0.5, yt + T.crown * 0.75], [0, yt + T.crown]];
    const ring = [];
    for (let fi = 0; fi < NR; fi++) { const hi = fi < NH ? fi : NR - fi; const q = half[hi]; ring.push([fi < NH ? q[0] : -q[0], q[1], z, hi]); }
    G.push(ring); BE.push(bE);
  }
  const NS = zs.length;
  const N = G.map((ring, i) => ring.map((p, fi) => {
    const a = G[i][(fi + 1) % NR], b = G[i][(fi + NR - 1) % NR], c = G[Math.min(NS - 1, i + 1)][fi], d = G[Math.max(0, i - 1)][fi];
    const rx = a[0] - b[0], ry = a[1] - b[1], rz = a[2] - b[2], sx = c[0] - d[0], sy = c[1] - d[1], sz = c[2] - d[2];
    let nx = ry * sz - rz * sy, ny = rz * sx - rx * sz, nz = rx * sy - ry * sx; const l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) return [0, 0, p[2] > 0 ? 1 : -1];
    nx /= l; ny /= l; nz /= l;
    if (i === 0 || i === NS - 1) { const e = p[2] > 0 ? 1 : -1; const k = 0.5; nx *= 1 - k; ny *= 1 - k; nz = nz * (1 - k) + e * k; const m = Math.hypot(nx, ny, nz); return [nx / m, ny / m, nz / m]; }
    return [nx, ny, nz];
  }));
  const col = (i, fi) => { const p = G[i][fi]; const hi = p[3]; let c = AO[hi]; if (!lo && seamC.has(i) && hi >= 2 && hi <= 7) c *= 0.3; for (const za of axles) if (Math.abs(p[2] - za) < archR + 0.03 && hi <= (lo ? 1 : 3)) c *= 0.55; return c; };
  const paint = new GB(), glass = new GB(), trim = new GB();
  const beltAt = (z) => { let i = 0; while (i < NS - 2 && zs[i + 1] < z) i++; const t = clamp((z - zs[i]) / Math.max(1e-6, zs[i + 1] - zs[i]), 0, 1); return lerp(BE[i], BE[i + 1], t); };
  const halfIdx = (f) => (f < NH ? f : NR - f);
  const catOf = (fi) => CAT[Math.min(halfIdx(fi), halfIdx((fi + 1) % NR))];
  for (let i = 0; i < NS - 1; i++) for (let fi = 0; fi < NR; fi++) {
    const fj = (fi + 1) % NR, a = G[i][fi], b = G[i + 1][fi], c = G[i + 1][fj], d = G[i][fj];
    const cx = (a[0] + b[0] + c[0] + d[0]) / 4, cy = (a[1] + b[1] + c[1] + d[1]) / 4, cz = (a[2] + b[2] + c[2] + d[2]) / 4;
    const na = N[i][fi], nb = N[i + 1][fi], nc = N[i + 1][fj], nd = N[i][fj];
    let qx = na[0] + nb[0] + nc[0] + nd[0], qy = na[1] + nb[1] + nc[1] + nd[1], qz = na[2] + nb[2] + nc[2] + nd[2]; const ql = Math.hypot(qx, qy, qz) || 1; qx /= ql; qy /= ql; qz /= ql;
    const cat = catOf(fi);
    let m = cat === 'bottom' ? 'under' : cat === 'lowcorner' && T.clad ? 'black_plastic' : 'paint', zn = null;
    if (cat !== 'bottom') for (const Z of T.zones) {
      if (Z.cat && !Z.cat.includes(cat)) continue;
      if (Z.z && (cz < Z.z[0] || cz > Z.z[1])) continue;
      if (Z.y && (cy < Z.y[0] || cy > Z.y[1])) continue;
      if (Z.ax && (Math.abs(cx) < Z.ax[0] || Math.abs(cx) > Z.ax[1])) continue;
      if (Z.nz === 'f' && qz < 0.45) continue; if (Z.nz === 'r' && qz > -0.45) continue;
      if (Z.m === 'glass' && !Z.nz && cat !== 'top' && cy < beltAt(cz) + 0.01) continue;
      m = Z.m; zn = Z; break;
    }
    const verts = [a, b, c, d], nrm = [na, nb, nc, nd];
    if (lo) { const z0 = [0, 0]; const k = m === 'paint' ? null : m === 'glass' ? 0.035 : m === 'tail_lens' ? 0.12 : 0.06; const cl = k === null ? [col(i, fi), col(i + 1, fi), col(i + 1, fj), col(i, fj)] : [k, k, k, k]; paint.tri(a, c, b, na, nc, nb, z0, z0, z0, cl[0], cl[2], cl[1]); paint.tri(a, d, c, na, nd, nc, z0, z0, z0, cl[0], cl[3], cl[2]); continue; }
    if (m === 'paint') { const cl = [col(i, fi), col(i + 1, fi), col(i + 1, fj), col(i, fj)]; const z0 = [0, 0]; paint.tri(a, c, b, na, nc, nb, z0, z0, z0, cl[0], cl[2], cl[1]); paint.tri(a, d, c, na, nd, nc, z0, z0, z0, cl[0], cl[3], cl[2]); }
    else if (m === 'glass') { const z0 = [0, 0]; glass.tri(a, c, b, na, nc, nb, z0, z0, z0); glass.tri(a, d, c, na, nd, nc, z0, z0, z0); }
    else {
      let uv;
      if (zn && zn.uv) { const R = A.RG[zn.uv], x1 = zn.ax ? zn.ax[1] : hw, y0 = zn.y ? zn.y[0] : 0, y1 = zn.y ? zn.y[1] : 1, back = qz < 0; uv = verts.map(p => { const u = back ? (p[0] + x1) / (2 * x1) : (x1 - p[0]) / (2 * x1), v = (p[1] - y0) / (y1 - y0); return [lerp(R[0], R[2], clamp(u, 0, 1)), lerp(R[1], R[3], clamp(v, 0, 1))]; }); }
      else { const s = A.SW[m] || A.SW.black_plastic; uv = [s, s, s, s]; }
      trim.tri(a, c, b, na, nc, nb, uv[0], uv[2], uv[1]); trim.tri(a, d, c, na, nd, nc, uv[0], uv[3], uv[2]);
    }
    void verts; void nrm;
  }
  // Lampen, Grill, Heckscheibe: saubere Flächen, per Strahl auf die Karosserie gelegt
  const SW = A.SW, sw = (n) => () => ({ uv: SW[n] });
  if (lo) { // grobe Räder (8-eckig) + dunkle Heckscheibe, alles in einem Netz
    const hw2 = hw - T.tw / 2 - 0.012, z0 = [0, 0];
    for (const [wx, wz] of [[hw2, T.zf], [-hw2, T.zf], [hw2, T.zr], [-hw2, T.zr]]) for (let k = 0; k < 8; k++) {
      const a0 = k / 8 * TAU, a1 = (k + 1) / 8 * TAU, y0 = r + Math.cos(a0) * r, y1 = r + Math.cos(a1) * r, q0 = wz + Math.sin(a0) * r, q1 = wz + Math.sin(a1) * r, xo = wx + Math.sign(wx) * T.tw / 2, xi = wx - Math.sign(wx) * T.tw / 2;
      const n0 = [0, Math.cos(a0), Math.sin(a0)], n1 = [0, Math.cos(a1), Math.sin(a1)], ns = [Math.sign(wx), 0, 0];
      paint.tri([xo, y0, q0], [xi, y0, q0], [xi, y1, q1], n0, n0, n1, z0, z0, z0, 0.05, 0.05, 0.05); paint.tri([xo, y0, q0], [xi, y1, q1], [xo, y1, q1], n0, n1, n1, z0, z0, z0, 0.05, 0.05, 0.05);
      paint.tri([xo, r, wz], [xo, y0, q0], [xo, y1, q1], ns, ns, ns, z0, z0, z0, 0.25, 0.25, 0.25);
    }
    for (const lp of T.lamps || []) if (lp.m === 'glass') { const yy = (lp.y[0] + lp.y[1]) / 2, zz = lp.f * (L / 2 - 0.03); paint.box(0, yy, zz, lp.x[1] * 2 - 0.1, lp.y[1] - lp.y[0], 0.08, () => ({ uv: [0, 0] }), 0.035); }
    return { lod: paint.geo() };
  }
  {
    const all = new GB(); all.p = paint.p.concat(glass.p, trim.p); all.n = paint.n.concat(glass.n, trim.n); all.u = paint.u.concat(glass.u, trim.u); all.c = paint.c.concat(glass.c, trim.c);
    const probe = new THREE.Mesh(all.geo(), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })), rc = new THREE.Raycaster(), o3 = new THREE.Vector3(), d3 = new THREE.Vector3();
    const cast = (x, y, f) => { o3.set(x, y, f * (L / 2 + 2)); d3.set(0, 0, -f); rc.set(o3, d3); const h = rc.intersectObject(probe, false)[0]; if (!h || Math.abs(h.point.z) < L / 2 - (T.lampDepth || 0.5)) return null; const n = h.face.normal.clone(); if (n.z * f < 0) n.negate(); return { p: h.point.clone(), n }; };
    const hitAt = (x, y, f) => { const h = cast(x, y, f) || cast(x + 0.004, y, f) || cast(x - 0.004, y, f); if (h) h.p.x = x; return h; };
    T.anchors = {};
    for (const lp of T.lamps || []) {
      const sides = lp.x[0] < 0 ? [1] : [1, -1], nx = lp.nx || 5, ny = lp.ny || 2;
      for (const sd of sides) {
        const G2 = [];
        for (let j = 0; j <= ny; j++) { const row = []; for (let i = 0; i <= nx; i++) row.push(hitAt(sd * lerp(lp.x[0], lp.x[1], i / nx), lerp(lp.y[0], lp.y[1], j / ny), lp.f)); G2.push(row); }
        const isG = lp.m === 'glass', gb = isG ? glass : trim, off = isG ? 0.004 : 0.006;
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
          const q = [G2[j][i], G2[j][i + 1], G2[j + 1][i + 1], G2[j + 1][i]]; if (q.some(v => !v)) continue;
          const P = q.map(v => [v.p.x + v.n.x * off, v.p.y + v.n.y * off, v.p.z + v.n.z * off]), Nn = q.map(v => [v.n.x, v.n.y, v.n.z]);
          const ii = [i, i + 1, i + 1, i], jj = [j, j, j + 1, j + 1];
          let uv; if (lp.uv) { const R = A.RG[lp.uv]; uv = ii.map((a, k) => { let u = a / nx; if (lp.f * sd > 0) u = 1 - u; return [lerp(R[0], R[2], u), lerp(R[1], R[3], jj[k] / ny)]; }); } else { const s0 = isG ? [0, 0] : (SW[lp.m] || SW.black_plastic); uv = [s0, s0, s0, s0]; }
          gb.tri(P[0], P[1], P[2], Nn[0], Nn[1], Nn[2], uv[0], uv[1], uv[2]); gb.tri(P[0], P[2], P[3], Nn[0], Nn[2], Nn[3], uv[0], uv[2], uv[3]);
        }
        if (lp.g) {
          const c = hitAt(sd * (lp.x[0] + lp.x[1]) / 2, (lp.y[0] + lp.y[1]) / 2, lp.f); if (!c) continue;
          const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), c.n);
          (T.anchors[lp.g] = T.anchors[lp.g] || []).push({ p: c.p.clone().addScaledVector(c.n, 0.014), n: c.n, q, w: Math.abs(lp.x[1] - lp.x[0]) * 0.95, h: (lp.y[1] - lp.y[0]) * 0.9, side: sd * (lp.x[0] < 0 ? 0 : 1) });
        }
      }
    }
  }
  // Anbauteile
  const wz = (z) => wAt(z);
  { // Spiegel
    const zm = T.cowl - 0.12, ym = beltAt(zm) + (T.bus ? 1.1 : 0.11), xm = wz(zm);
    for (const s of [-1, 1]) {
      if (T.bus) { trim.box(s * (xm + 0.12), ym + 0.35, zm + 0.25, 0.05, 0.05, 0.6, sw('black_plastic')); trim.box(s * (xm + 0.18), ym, zm + 0.5, 0.12, 0.38, 0.06, sw('black_gloss')); continue; }
      paint.box(s * (xm + 0.085), ym, zm, 0.15, 0.095, 0.075, () => ({ uv: [0, 0] }), 0.95);
      trim.box(s * (xm + 0.02), ym - 0.03, zm + 0.01, 0.06, 0.035, 0.06, sw('black_plastic'));
      trim.box(s * (xm + 0.085), ym, zm - 0.04, 0.13, 0.078, 0.006, sw('mirror'));
    }
  }
  if (!T.bus) { // Türgriffe
    const doors = T.seams.length >= 3 ? [(T.seams[0] + T.seams[1]) / 2 - 0.12, (T.seams[1] + T.seams[2]) / 2 - 0.1] : [T.seams[0] - 0.3];
    if (T.id === 'van') doors.length = 1, doors[0] = 1.35;
    for (const zd of doors) { const y = beltAt(zd) - 0.08, x = wz(zd); for (const s of [-1, 1]) trim.box(s * (x + 0.006), y, zd, 0.018, 0.028, 0.16, sw(T.taxi || T.id === 'limo' ? 'chrome' : 'black_gloss')); }
    // Scheibenwischer
    const zw = T.ws[1] - 0.06, yw = top(zw) + 0.02; for (const s of [-1, 1]) trim.box(s * 0.25, yw, zw, 0.58, 0.018, 0.02, sw('black_plastic'), 1, s * 0.1);
    // Antenne
    if (T.id !== 'van') { const za = T.roof[0] + 0.12; trim.box(0, top(za) + T.crown + 0.03, za, 0.05, 0.06, 0.16, sw('black_gloss')); }
  }
  { // Kennzeichen vorn/hinten
    const R = A.RG['plate' + T.plate], yF = (ybAt(L / 2) + top(L / 2)) / 2, yR = T.bus ? 0.70 : Math.min((ybAt(-L / 2) + top(-L / 2)) / 2 + 0.02, ybAt(-L / 2) + 0.25);
    const pf = (rect) => (f) => (f === 'pz' || f === 'nz' ? { rect } : { uv: SW.black_plastic });
    trim.box(0, yF, L / 2 - 0.004, 0.52, 0.115, 0.014, pf(R)); trim.box(0, yR, -L / 2 + 0.004, 0.52, 0.115, 0.014, pf(R));
  }
  { // Unterboden gegen Durchblick
    const xi = hw - (T.tw + 0.08);
    trim.box(0, (0.16 + T.yb[2][1]) / 2, (T.zf + T.zr) / 2, 2 * xi, T.yb[2][1] - 0.14, Math.max(0.3, T.wb - 2 * archR - 0.06), sw('under'));
    trim.box(0, (0.2 + T.yb[2][1]) / 2, (T.zf + archR + zF0) / 2 + 0.02, 2 * (xi - 0.05), T.yb[2][1] - 0.16, Math.max(0.1, zF0 - T.zf - archR), sw('under'));
    trim.box(0, (0.2 + T.yb[2][1]) / 2, (T.zr - archR + zR0) / 2 - 0.02, 2 * (xi - 0.05), T.yb[2][1] - 0.16, Math.max(0.1, T.zr - archR - zR0), sw('under'));
  }
  if (!T.bus && T.id !== 'van') trim.box(hw * 0.5, ybAt(-L / 2 + 0.12) - 0.03, -L / 2 + 0.14, 0.07, 0.055, 0.14, sw('dark_metal')); // Auspuff
  if (T.taxi) { const z = (T.roof[0] + T.roof[1]) / 2 + 0.1, y = top(z) + T.crown + 0.08; trim.box(0, y, z, 0.44, 0.15, 0.12, (f) => (f === 'pz' || f === 'nz' ? { rect: A.RG.taxi } : { uv: SW.sign_yellow })); trim.box(0, y - 0.085, z, 0.3, 0.02, 0.1, sw('black_plastic')); T.signY = y; T.signZ = z; }
  if (T.id === 'suv') for (const s of [-1, 1]) { const z0 = T.roof[0] + 0.1, z1 = T.roof[1] - 0.05, zc = (z0 + z1) / 2, xr = wz(zc) - T.k * (top(zc) - beltAt(zc)) - 0.16; trim.box(s * xr, top(zc) + 0.035, zc, 0.035, 0.04, z1 - z0, sw('alloy')); }
  if (T.bus) { trim.box(0, 3.19, -0.8, 1.9, 0.28, 3.0, sw('white')); trim.box(0, 3.12, -4.8, 1.6, 0.16, 1.4, sw('grey_plastic')); trim.box(0, 0.9, -5.98, 1.6, 0.5, 0.05, sw('black_plastic')); }
  // Stoßfänger-Kanten / Lampenfassungen als Licht-Ankerpunkte
  const zSurf = (x, front) => { const zone = front ? T.fz : T.rz, u = Math.pow(Math.max(0, 1 - Math.pow(Math.min(0.999, Math.abs(x) / hw), T.pp)), 1 / T.pp); return front ? zF0 + zone * u : zR0 - zone * u; };
  T.zSurf = zSurf; T.beltAt = beltAt; T.ybAt = ybAt;
  return { paint: paint.geo(), glass: glass.geo(), trim: trim.geo(), stations: NS };
}

// Rad (Reifen + Felge), Achse = x, Felgenseite = +x, Radius 0.33, Breite 0.21
function buildWheel(A, region) {
  const gb = new GB(), R = 0.33, Wd = 0.21, Ri = 0.232, seg = 16, SW = A.SW, RG = A.RG[region];
  const prof = [[Ri, -Wd * 0.47], [R - 0.03, -Wd / 2], [R, -Wd * 0.34], [R, Wd * 0.34], [R - 0.03, Wd / 2], [Ri, Wd * 0.47]];
  const segN = []; for (let j = 0; j < prof.length - 1; j++) { const dr = prof[j + 1][0] - prof[j][0], dx = prof[j + 1][1] - prof[j][1], l = Math.hypot(dr, dx); segN.push([-dr / l, dx / l]); }
  const vN = prof.map((_, j) => { const a = segN[Math.max(0, j - 1)], b = segN[Math.min(segN.length - 1, j)]; const x = a[0] + b[0], r = a[1] + b[1], l = Math.hypot(x, r); return [x / l, r / l]; });
  const P = (j, ang) => [prof[j][1], prof[j][0] * Math.cos(ang), prof[j][0] * Math.sin(ang)], Nn = (j, ang) => [vN[j][0], vN[j][1] * Math.cos(ang), vN[j][1] * Math.sin(ang)];
  for (let i = 0; i < seg; i++) { const a0 = i / seg * TAU, a1 = (i + 1) / seg * TAU; for (let j = 0; j < prof.length - 1; j++) { const s = SW.rubber; gb.tri(P(j, a0), P(j + 1, a0), P(j + 1, a1), Nn(j, a0), Nn(j + 1, a0), Nn(j + 1, a1), s, s, s); gb.tri(P(j, a0), P(j + 1, a1), P(j, a1), Nn(j, a0), Nn(j + 1, a1), Nn(j, a1), s, s, s); } }
  const ruv = (y, z) => [lerp(RG[0], RG[2], 0.5 + 0.5 * z / Ri), lerp(RG[1], RG[3], 0.5 + 0.5 * y / Ri)];
  const xo = Wd * 0.40, xc = Wd * 0.26;
  for (let i = 0; i < seg; i++) { // Felge leicht schüsselförmig
    const a0 = i / seg * TAU, a1 = (i + 1) / seg * TAU, p0 = [xo, Ri * Math.cos(a0), Ri * Math.sin(a0)], p1 = [xo, Ri * Math.cos(a1), Ri * Math.sin(a1)], c = [xc, 0, 0];
    gb.tri(c, p0, p1, [1, 0, 0], [0.92, 0.39 * Math.cos(a0), 0.39 * Math.sin(a0)], [0.92, 0.39 * Math.cos(a1), 0.39 * Math.sin(a1)], ruv(0, 0), ruv(p0[1], p0[2]), ruv(p1[1], p1[2]));
    const q0 = [-Wd * 0.47, Ri * Math.cos(a0), Ri * Math.sin(a0)], q1 = [-Wd * 0.47, Ri * Math.cos(a1), Ri * Math.sin(a1)], s = SW.under;
    gb.tri([-Wd * 0.47, 0, 0], q1, q0, [-1, 0, 0], [-1, 0, 0], [-1, 0, 0], s, s, s);
  }
  return gb.geo();
}

// ===================================================================================== Bausatz (auch für Testseiten)
export function createCarKit(renderer) {
  const A = makeAtlas();
  const pm = new THREE.PMREMGenerator(renderer);
  const envT = (night) => { const t = new THREE.CanvasTexture(envCanvas(night)); t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace; const e = pm.fromEquirectangular(t).texture; t.dispose(); return e; };
  const env = { day: envT(false), night: envT(true) }; pm.dispose();
  const mats = {
    paint: new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.32, roughness: 0.36, clearcoat: 1, clearcoatRoughness: 0.06, envMap: env.day, envMapIntensity: 1.0 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0a0e13, metalness: 0.1, roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0.02, envMap: env.day, envMapIntensity: 1.35 }),
    trim: new THREE.MeshStandardMaterial({ map: A.tex, roughnessMap: A.rm, metalnessMap: A.rm, roughness: 1, metalness: 1, envMap: env.day, envMapIntensity: 0.9 }),
  };
  const types = TYPES.map(T => ({ T, ...buildBody(T, A), lod: buildBody(T, A, true).lod }));
  mats.lod = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.3, roughness: 0.35, envMap: env.day, envMapIntensity: 1.0 });
  const wheel = { rim: buildWheel(A, 'rim'), steel: buildWheel(A, 'steel') };
  function setNight(night) {
    const e = night ? env.night : env.day;
    mats.paint.envMap = e; mats.glass.envMap = e; mats.trim.envMap = e; mats.lod.envMap = e;
    mats.paint.envMapIntensity = night ? 0.9 : 1.0; mats.glass.envMapIntensity = night ? 1.6 : 1.35; mats.trim.envMapIntensity = night ? 0.7 : 0.9;
  }
  return { A, env, mats, types, wheel, setNight, TYPES };
}

const PAINT = [['#2b2d30', 12], ['#4a4d52', 10], ['#6d7176', 6], ['#0c0d0f', 18], ['#f2f2f0', 16], ['#c4c6c8', 12], ['#1d3557', 6], ['#2f5d8a', 3], ['#8b1a1a', 4], ['#5a1f24', 2], ['#2e3b2f', 2], ['#8c7b62', 2], ['#d9d4c7', 1], ['#3a6b5e', 1], ['#e0a100', 0.5]];
const VANPAINT = [['#f4f4f2', 14], ['#c4c6c8', 3], ['#1c2026', 2], ['#1d3557', 1.5], ['#b9b2a3', 1]];
function paintFor(rnd, T) { const hex = T.id === 'taxi' ? '#efe4bf' : T.bus ? '#f2c200' : pickW(rnd, T.id === 'van' ? VANPAINT : PAINT); return new THREE.Color(hex); }

// ===================================================================================== Haupt-Modul
export async function init(W) {
  const scene = W.scene, camera = W.camera, isMobile = !!W.isMobile;
  const LOD_D = isMobile ? 42 : 60;
  const MAXMOV = isMobile ? 16 : 28, R_SPAWN = isMobile ? 150 : 185, R_DESPAWN = R_SPAWN + 18, MAXPARK = isMobile ? 46 : 130;
  const rnd = mulberry(20261123);
  let simT = 0;
  W.cars = []; if (!Array.isArray(W.shootables)) W.shootables = [];

  // ---------------------------------------------------------------- Ampeln
  const SIG = { ctl: new Map(), ready: false };
  const sigCtl = (c) => SIG.ctl.get(c) || { off: (c * 13.7) % 46, gA: 18, gB: 18 };
  function sigState(c, ax) {
    const k = sigCtl(c), cyc = k.gA + k.gB + 10; let t = (simT + k.off) % cyc; if (t < 0) t += cyc;
    let a = 'r', b = 'r';
    if (t < k.gA) a = 'g'; else if (t < k.gA + 3) a = 'y'; else if (t < k.gA + 5) { /* alle rot */ } else if (t < k.gA + 5 + k.gB) b = 'g'; else if (t < k.gA + 8 + k.gB) b = 'y';
    return ax ? b : a;
  }
  function sigRemain(c, ax) { const k = sigCtl(c), cyc = k.gA + k.gB + 10; let t = (simT + k.off) % cyc; if (t < 0) t += cyc; const s0 = ax ? k.gA + 5 : 0, e = s0 + (ax ? k.gB : k.gA); return t >= s0 && t < e ? e - t : 0; }
  // ped(gruppe, achse): Fußgänger, die ENTLANG dieser Achse gehen (also die Straße der anderen Achse queren), haben Grün
  W.signals = { state: (c, ax) => sigState(c | 0, ax ? 1 : 0), ped: (c, ax) => { ax = ax ? 1 : 0; return sigState(c | 0, ax) === 'g' && sigState(c | 0, 1 - ax) === 'r' && sigRemain(c | 0, ax) > 4; }, cross: (c, roadAx) => { roadAx = roadAx ? 1 : 0; return sigState(c | 0, roadAx) === 'r' && sigState(c | 0, 1 - roadAx) === 'g' && sigRemain(c | 0, 1 - roadAx) > 4; }, remain: (c, ax) => sigRemain(c | 0, ax ? 1 : 0) };

  // ---------------------------------------------------------------- Bausatz + Effekte
  const kit = createCarKit(W.renderer);
  const NIGHT = { on: !!W.night };
  kit.setNight(NIGHT.on);
  const glowTex = softTex(64, 32, (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  const poolTex = softTex(128, 128, (g, w, h) => { // weicher Lichtkegel, Ränder ganz aus
    const im = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const d = y / (h - 1), u = (x / (w - 1)) * 2 - 1, spread = 0.28 + 0.72 * Math.sqrt(d), lat = Math.max(0, 1 - (u / spread) ** 2);   // Zeile 0 = am Auto
      const along = (1 - Math.exp(-d * 9)) * Math.pow(1 - d, 1.4), a = Math.pow(lat, 1.5) * along * 1.9;
      const i = (y * w + x) * 4; im.data[i] = im.data[i + 1] = im.data[i + 2] = 255; im.data[i + 3] = Math.min(255, a * 255);
    }
    g.putImageData(im, 0, 0);
  });
  const shadowTex = softTex(64, 128, (g, w, h) => { g.filter = 'blur(9px)'; g.fillStyle = 'rgba(0,0,0,0.9)'; g.beginPath(); g.roundRect(13, 15, w - 26, h - 30, 12); g.fill(); });
  const crackTex = softTex(256, 256, (g, w) => {
    const r = mulberry(5), c = w / 2; g.strokeStyle = 'rgba(235,242,248,0.9)'; g.lineCap = 'round';
    for (let i = 0; i < 17; i++) { let a = r() * TAU, x = c, y = c; g.lineWidth = 1.6; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 7; k++) { a += (r() - 0.5) * 0.5; const s = 10 + r() * 16; x += Math.cos(a) * s; y += Math.sin(a) * s; g.lineTo(x, y); } g.stroke(); }
    for (let ring = 1; ring < 4; ring++) { g.lineWidth = 1; g.beginPath(); for (let k = 0; k <= 22; k++) { const a = k / 22 * TAU, rr = ring * 24 + r() * 7; g[k ? 'lineTo' : 'moveTo'](c + Math.cos(a) * rr, c + Math.sin(a) * rr); } g.stroke(); }
    const gr = g.createRadialGradient(c, c, 0, c, c, 16); gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(c - 16, c - 16, 32, 32);
  });
  const holeTex = softTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 30); gr.addColorStop(0, 'rgba(5,5,5,1)'); gr.addColorStop(0.28, 'rgba(10,10,10,1)'); gr.addColorStop(0.36, 'rgba(160,165,170,0.95)'); gr.addColorStop(0.55, 'rgba(70,70,70,0.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });

  // ---------------------------------------------------------------- Zustand
  const cars = [];           // alle Autos (fahrend, geparkt, Spieler)
  let nextId = 1;
  const meshes = { body: [], lod: [], wheels: null, shadow: null, lights: null, pools: null, decals: null, holes: null, sparks: null };
  const root = new THREE.Group(); root.name = 'traffic'; scene.add(root);
  const hitRoot = new THREE.Group(); hitRoot.name = 'trafficHit'; hitRoot.visible = false; scene.add(hitRoot);   // nur für Strahlen (Treffer), nie gezeichnet
  const hitMat = new THREE.MeshBasicMaterial({ visible: false }), boxGeo = new THREE.BoxGeometry(1, 1, 1);
  let net = null;          // Straßennetz (nach city.json)
  let ready = false;

  // ---------------------------------------------------------------- Straßennetz
  function prepLane(pts) {
    const n = pts.length, xs = new Float64Array(n), zs = new Float64Array(n), cum = new Float64Array(n);
    for (let i = 0; i < n; i++) { xs[i] = pts[i][0]; zs[i] = pts[i][1]; if (i) cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]); }
    return { xs, zs, cum, len: cum[n - 1] };
  }
  function laneAt(ln, s, out) {
    s = clamp(s, 0, ln.len); let i = 0; const c = ln.cum; let lo = 0, hi = c.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= s) lo = m; else hi = m; } i = lo;
    const d = c[i + 1] - c[i] || 1, t = (s - c[i]) / d, dx = (ln.xs[i + 1] - ln.xs[i]) / d, dz = (ln.zs[i + 1] - ln.zs[i]) / d;
    out.x = ln.xs[i] + (ln.xs[i + 1] - ln.xs[i]) * t; out.z = ln.zs[i] + (ln.zs[i + 1] - ln.zs[i]) * t; out.dx = dx; out.dz = dz; return out;
  }
  function laneSlice(ln, s0, s1) {
    const xs = [], zs = [], o = {}; laneAt(ln, s0, o); xs.push(o.x); zs.push(o.z);
    for (let i = 0; i < ln.cum.length; i++) if (ln.cum[i] > s0 + 0.05 && ln.cum[i] < s1 - 0.05) { xs.push(ln.xs[i]); zs.push(ln.zs[i]); }
    laneAt(ln, s1, o); xs.push(o.x); zs.push(o.z); return [xs, zs];
  }
  function resample(pts, step) { const ln = prepLane(pts), n = Math.max(1, Math.ceil(ln.len / step)), out = [], o = {}; for (let i = 0; i <= n; i++) { laneAt(ln, ln.len * i / n, o); out.push([o.x, o.z]); } return out; }
  // Wo eine Straße am Knoten in zwei Richtungsfahrbahnen aufgeht, liegen die OSM-Spuren dort vertauscht und kreuzen den Gegenverkehr.
  // Abhilfe: die Spuren der Richtungsfahrbahn am Knoten seitlich auf die Spuren der zweispurigen Straße schieben und auslaufen lassen.
  function fixSplits(raw) {
    const key = (e) => e.w + ':' + e.from + '>' + e.to, twin = new Set(raw.map(e => e.w + ':' + e.to + '>' + e.from));
    const twoWay = raw.map(e => twin.has(key(e)));
    const lanes = raw.map(e => e.lanes.map(l => l.map(p => [p[0], p[1]])));
    const dirAt = (L, end) => { const n = L.length, a = end ? L[n - 2] : L[0], b = end ? L[n - 1] : L[1], d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / d, (b[1] - a[1]) / d]; };
    raw.forEach((E, i) => {
      if (twoWay[i]) return;
      for (const atStart of [true, false]) {
        const node = atStart ? E.from : E.to, L0 = lanes[i][0], dE = dirAt(L0, !atStart), pE = atStart ? L0[0] : L0[L0.length - 1];
        let best = null;
        raw.forEach((T, j) => {
          if (j === i || !twoWay[j]) return; if ((atStart ? T.to : T.from) !== node) return;
          const LT = lanes[j][0], dT = dirAt(LT, atStart); if (dT[0] * dE[0] + dT[1] * dE[1] < 0.75) return;
          const pT = atStart ? LT[LT.length - 1] : LT[0], rx = -dE[1], rz = dE[0], sh = (pT[0] - pE[0]) * rx + (pT[1] - pE[1]) * rz;
          if (Math.abs(sh) > 1.2 && Math.abs(sh) < 9 && (!best || Math.abs(sh) > Math.abs(best))) best = sh;
        });
        if (best === null) continue;
        const len = prepLane(L0).len, taper = Math.min(len * 0.92, 28);
        lanes[i] = lanes[i].map(l => {
          const pts = resample(l, 1.5), ln = prepLane(pts);
          return pts.map((p, k) => { const s0 = ln.cum[k], d = atStart ? s0 : ln.len - s0, w = Math.max(0, 1 - d / taper), f = w * w * (3 - 2 * w), dd = dirAt(pts, false); void dd;
            const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)], dl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, rx = -(b[1] - a[1]) / dl, rz = (b[0] - a[0]) / dl;
            return [p[0] + rx * best * f, p[1] + rz * best * f]; });
        });
      }
    });
    return lanes;
  }
  function setupNet(cj) {
    const [rx0, rz0, rx1, rz1] = cj.frame.region;
    const fixed = fixSplits(cj.edges);
    const E = cj.edges.map((e, i) => { const L = fixed[i].map(prepLane); return { i, raw: e, L, len: L[0].len, v: e.v || 13.9, prim: e.hw !== 'residential' && e.hw !== 'living_street', name: e.name, sig: e.sig || null, next: e.next || [], from: e.from, to: e.to }; });
    const o = {};
    for (const e of E) { const l0 = e.L[0]; laneAt(l0, 0, o); e.sdx = o.dx; e.sdz = o.dz; e.sx = o.x; e.sz = o.z; laneAt(l0, l0.len, o); e.edx = o.dx; e.edz = o.dz; e.ex = o.x; e.ez = o.z; }
    for (const e of E) { const l0 = e.L[0], m = l0.len / 2, q = {}; laneAt(l0, m, o); const rx = -o.dz, rz = o.dx, bx = o.x, bz = o.z; let best = 0, bv = -1e9; e.L.forEach((ln, k) => { laneAt(ln, Math.min(m, ln.len / 2), q); const v = (q.x - bx) * rx + (q.z - bz) * rz; if (v > bv) { bv = v; best = k; } }); e.rk = best; }
    // Ampel-Gruppen zusammenfassen (beide Hälften einer Doppelkreuzung schalten gemeinsam)
    const sg = cj.signals || [], par = sg.map((_, i) => i), find = (i) => (par[i] === i ? i : (par[i] = find(par[i])));
    for (let i = 0; i < sg.length; i++) for (let j = i + 1; j < sg.length; j++) if (Math.hypot(sg[i].c[0] - sg[j].c[0], sg[i].c[1] - sg[j].c[1]) < 65) par[find(j)] = find(i);
    const axes = new Map(); for (const e of E) if (e.sig) { const r = find(e.sig.c); if (!axes.has(r)) axes.set(r, new Set()); axes.get(r).add(e.sig.ax); }
    for (let i = 0; i < sg.length; i++) { const r = find(i), ax = axes.get(r) || new Set([0, 1]); const both = ax.has(0) && ax.has(1); const k = { off: (r * 17.3) % 46, gA: both ? 18 : ax.has(0) ? 24 : 11, gB: both ? 18 : ax.has(1) ? 24 : 11 }; SIG.ctl.set(i, k); }
    SIG.ready = true;
    // Haltelinien: nur wenn die Ampel-Gruppe vor uns liegt
    for (const e of E) if (e.sig) { const c = sg[e.sig.c]; laneAt(e.L[0], e.sig.s, o); e.sigOK = !!c && ((c.c[0] - o.x) * o.dx + (c.c[1] - o.z) * o.dz) > -2; }
    // Abzweige (ohne Wenden)
    for (const e of E) {
      e.ch = [];
      for (const n of e.next) { const N = E[n]; if (!N) continue; const ang = wrapA(hdg(N.sdx, N.sdz) - hdg(e.edx, e.edz)); if (Math.abs(ang) > 2.3) continue; let w = (N.prim ? 3 : 1) * (Math.abs(ang) < 0.45 ? 2.6 : 1); e.ch.push([n, w]); }
    }
    // Knoten (Kreuzungen) für Parkverbot
    const nodes = new Map(); const addN = (id, x, z, b) => { if (!nodes.has(id)) nodes.set(id, { x: 0, z: 0, n: 0, b: [] }); const q = nodes.get(id); q.x += x; q.z += z; q.n++; q.b.push(b); };
    for (const e of E) { const l = e.L[0], m = l.xs.length - 1; addN(e.from, l.xs[0], l.zs[0], hdg(e.sdx, e.sdz)); addN(e.to, l.xs[m], l.zs[m], hdg(-e.edx, -e.edz)); }
    const junc = [];
    for (const q of nodes.values()) { const b = q.b.map(a => (a + TAU) % TAU).sort((x, y) => x - y); let arms = 0; for (let i = 0; i < b.length; i++) { const nx = i === b.length - 1 ? b[0] + TAU : b[i + 1]; if (nx - b[i] > 0.45) arms++; } if (b.length && arms === 0) arms = 1; if (arms >= 3) junc.push([q.x / q.n, q.z / q.n]); }
    // Spawn-Tabelle: Abschnitte im Gebiet
    const spawn = []; const inR = (x, z, m) => x > rx0 + m && x < rx1 - m && z > rz0 + m && z < rz1 - m;
    for (const e of E) {
      if (e.len < 22) continue; const l0 = e.L[0]; let a = -1, b = -1;
      for (let s = 6; s < e.len - 12; s += 2) { laneAt(l0, s, o); if (inR(o.x, o.z, 8)) { if (a < 0) a = s; b = s; } }
      if (a >= 0 && b - a > 4) spawn.push({ e: e.i, a, b, w: (b - a) * (e.prim ? 2.6 : 1) });
    }
    net = { E, region: [rx0, rz0, rx1, rz1], junc, spawn, spawnBus: spawn.filter(q => E[q.e].prim), cj };
  }
  const PDBG = {};
  const inRegion = (x, z, m = 0) => { const r = net.region; return x > r[0] - m && x < r[2] + m && z > r[1] - m && z < r[3] + m; };

  // ---------------------------------------------------------------- Pfad eines Autos
  class Path {
    constructor() { this.segs = []; this.tail = 0; this.ended = false; this.stops = []; this.bstops = []; this.h = 0; }
    add(xs, zs, meta) {
      const n = xs.length; if (n < 2) return null; const cum = new Float64Array(n);
      for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
      if (cum[n - 1] < 0.02) return null;
      const seg = Object.assign({ xs, zs, cum, len: cum[n - 1], s0: this.tail }, meta); this.segs.push(seg); this.tail += seg.len; return seg;
    }
    at(s, out) {
      const S = this.segs; if (!S.length) return out;
      if (s <= S[0].s0) { const g = S[0], d = g.cum[1] || 1, dx = (g.xs[1] - g.xs[0]) / d, dz = (g.zs[1] - g.zs[0]) / d, t = s - g.s0; out.x = g.xs[0] + dx * t; out.z = g.zs[0] + dz * t; out.dx = dx; out.dz = dz; out.seg = g; return out; }
      if (s >= this.tail) { const g = S[S.length - 1], n = g.xs.length, d = (g.cum[n - 1] - g.cum[n - 2]) || 1, dx = (g.xs[n - 1] - g.xs[n - 2]) / d, dz = (g.zs[n - 1] - g.zs[n - 2]) / d, t = s - this.tail; out.x = g.xs[n - 1] + dx * t; out.z = g.zs[n - 1] + dz * t; out.dx = dx; out.dz = dz; out.seg = g; return out; }
      let k = Math.min(this.h, S.length - 1); while (k > 0 && S[k].s0 > s) k--; while (k < S.length - 1 && S[k].s0 + S[k].len < s) k++;
      this.h = k; const g = S[k], ls = s - g.s0, c = g.cum; let lo = 0, hi = c.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= ls) lo = m; else hi = m; }
      const d = c[lo + 1] - c[lo] || 1, t = (ls - c[lo]) / d, dx = (g.xs[lo + 1] - g.xs[lo]) / d, dz = (g.zs[lo + 1] - g.zs[lo]) / d;
      out.x = g.xs[lo] + (g.xs[lo + 1] - g.xs[lo]) * t; out.z = g.zs[lo] + (g.zs[lo + 1] - g.zs[lo]) * t; out.dx = dx; out.dz = dz; out.seg = g; return out;
    }
    drop(sMin) { while (this.segs.length > 1 && this.segs[0].s0 + this.segs[0].len < sMin) { this.segs.shift(); this.h = Math.max(0, this.h - 1); } while (this.stops.length && this.stops[0].s < sMin) this.stops.shift(); while (this.bstops.length && this.bstops[0].s < sMin) this.bstops.shift(); }
  }
  const mapLane = (nA, a, nB) => nB - 1 - Math.min(nA - 1 - a, nB - 1);
  const _o = {}, _o2 = {}, _o3 = {};
  function appendLane(car, e, k, t0, t1) {
    const E = net.E[e], ln = E.L[k]; if (t1 - t0 < 0.05) return;
    const [xs, zs] = laneSlice(ln, t0, t1);
    const seg = car.path.add(xs, zs, { kind: 'lane', e, k, vmax: E.v * car.drv, turn: 0 });
    if (seg && E.sig && E.sigOK && E.sig.s >= t0 - 0.01 && E.sig.s <= t1 + 0.3) car.path.stops.push({ s: seg.s0 + clamp(E.sig.s - t0, 0, seg.len), c: E.sig.c, ax: E.sig.ax });
    if (seg && car.T.bus && BUS.stops.length) for (const st of BUS.stops) if (st.e === e && st.k === k && st.s >= t0 - 0.01 && st.s <= t1 + 0.3) car.path.bstops.push({ s: seg.s0 + clamp(st.s - t0, 0, seg.len), st, done: false });
  }
  function appendConn(car, ax, az, adx, adz, bx, bz, bdx, bdz) {
    const D = Math.hypot(bx - ax, bz - az), h = D * 0.4, n = Math.max(3, Math.ceil(D / 1.0));
    const p1x = ax + adx * h, p1z = az + adz * h, p2x = bx - bdx * h, p2z = bz - bdz * h, xs = [], zs = [];
    for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; xs.push(u * u * u * ax + 3 * u * u * t * p1x + 3 * u * t * t * p2x + t * t * t * bx); zs.push(u * u * u * az + 3 * u * u * t * p1z + 3 * u * t * t * p2z + t * t * t * bz); }
    const turn = wrapA(hdg(bdx, bdz) - hdg(adx, adz)), len = Math.max(D, 1);
    const kap = Math.abs(turn) / len, vmax = clamp(Math.sqrt(2.6 / Math.max(kap, 1e-4)), 3.5, 14);
    car.path.add(xs, zs, { kind: 'conn', vmax, turn });
  }
  function chooseNext(car, E) {
    if (car.T.bus) { let best = null, bw = -1e9; for (const [n] of E.ch) { const N = net.E[n], ang = Math.abs(wrapA(hdg(N.sdx, N.sdz) - hdg(E.edx, E.edz))), w = (N.name === E.name ? 3 : 0) + (N.prim ? 1 : 0) - ang * 2; if (w > bw) { bw = w; best = n; } } if (best !== null) return best; }
    if (car.target && E.ch.length) { let best = null, bd = 1e9; for (const [n] of E.ch) { const N = net.E[n], d = Math.hypot(N.ex - car.target.x, N.ez - car.target.z) + car.rnd() * (car.emerg && car.emerg.patrol > 0 ? 70 : 20); if (d < bd) { bd = d; best = n; } } if (best !== null) return best; }
    return pickW(car.rnd, E.ch);
  }
  function plan(car) {
    let guard = 0;
    while (!car.path.ended && car.path.tail < car.s + 75 && guard++ < 8) {
      const pd = car.pend, E = net.E[pd.e], lnA = E.L[pd.k];
      if (!E.ch.length) { appendLane(car, pd.e, pd.k, pd.t0, lnA.len); car.path.ended = true; break; }
      let n = chooseNext(car, E), skip = false;
      const N = net.E[n];
      if (N.len < 20 && !N.sig && N.ch.length) {
        const n2 = chooseNext(car, N), N2 = net.E[n2], kN = mapLane(E.L.length, pd.k, N.L.length), k2 = mapLane(N.L.length, kN, N2.L.length);
        laneAt(lnA, lnA.len, _o); laneAt(N2.L[k2], 0, _o2); laneAt(N.L[kN], N.len / 2, _o3);
        const sx = _o2.x - _o.x, sz = _o2.z - _o.z, sl = Math.hypot(sx, sz) || 1, dev = Math.abs(((_o3.x - _o.x) * sz - (_o3.z - _o.z) * sx) / sl);
        if (dev > 1.0) { n = n2; skip = true; }
      }
      const NN = net.E[n], kB = car.T.bus || car.T.small ? NN.rk : mapLane(E.L.length, pd.k, NN.L.length), lnB = NN.L[kB];
      laneAt(lnA, lnA.len, _o); laneAt(lnB, 0, _o2);
      const gap = Math.hypot(_o2.x - _o.x, _o2.z - _o.z), ang = Math.abs(wrapA(hdg(_o2.dx, _o2.dz) - hdg(_o.dx, _o.dz)));
      let tA = 0, tB = 0;
      if (skip || gap > 0.35 || ang > 0.12) {
        const R = clamp(4 + gap * 0.55 + ang * 3, 4, 11);
        tA = Math.min(R, Math.max(0, (lnA.len - pd.t0) * 0.45));
        if (E.sig && E.sigOK && E.sig.s > pd.t0) tA = Math.min(tA, Math.max(0.2, lnA.len - E.sig.s - 0.2));
        tB = Math.min(R, lnB.len * 0.45);
      }
      appendLane(car, pd.e, pd.k, pd.t0, lnA.len - tA);
      if (tA > 0 || tB > 0) { laneAt(lnA, lnA.len - tA, _o); laneAt(lnB, tB, _o2); appendConn(car, _o.x, _o.z, _o.dx, _o.dz, _o2.x, _o2.z, _o2.dx, _o2.dz); }
      car.pend = { e: n, k: kB, t0: tB };
    }
  }

  // ---------------------------------------------------------------- Instanzen
  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(0, 0, 0, 'YXZ'), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3(1, 1, 1), tmpC = new THREE.Color();
  const qSteer = new THREE.Quaternion(), qSpin = new THREE.Quaternion(), qFlip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI), AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0);
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  function buildMeshes(capPerType) {
    kit.types.forEach((ty, ti) => {
      const cap = capPerType[ti];
      const mk = (geo, mat, cast) => { const m = new THREE.InstancedMesh(geo, mat, cap); m.count = 0; m.frustumCulled = false; m.castShadow = cast && !isMobile; m.receiveShadow = true; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(m); return m; };
      const paint = mk(ty.paint, kit.mats.paint, true), glass = mk(ty.glass, kit.mats.glass, false), trim = mk(ty.trim, kit.mats.trim, false);
      paint.setColorAt(0, tmpC.set(0xffffff)); paint.instanceColor.setUsage(THREE.DynamicDrawUsage);
      meshes.body[ti] = { paint, glass, trim, cars: [] };
      const lod = mk(ty.lod, kit.mats.lod, false); lod.setColorAt(0, tmpC.set(0xffffff)); lod.instanceColor.setUsage(THREE.DynamicDrawUsage); lod.receiveShadow = false;
      meshes.lod[ti] = { mesh: lod, cars: [] };
    });
    const totalCap = capPerType.reduce((a, b) => a + b, 0) + 4;
    const wm = (geo) => { const m = new THREE.InstancedMesh(geo, kit.mats.trim, totalCap * 4); m.count = 0; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = true; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(m); return { m, cars: [] }; };
    meshes.wheels = { rim: wm(kit.wheel.rim), steel: wm(kit.wheel.steel) };
    const sg = new THREE.PlaneGeometry(1, 1); sg.rotateX(-Math.PI / 2);
    meshes.shadow = new THREE.InstancedMesh(sg, new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.8, color: 0x000000, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), totalCap); meshes.shadow.count = 0; meshes.shadow.frustumCulled = false; meshes.shadow.renderOrder = 2; root.add(meshes.shadow); meshes.shadowCars = [];
    const lg = new THREE.PlaneGeometry(1, 1);
    meshes.lights = new THREE.InstancedMesh(lg, new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffffff, fog: false }), 700); meshes.lights.count = 0; meshes.lights.frustumCulled = false; meshes.lights.renderOrder = 5; root.add(meshes.lights);
    meshes.lights.setColorAt(0, tmpC.set(0)); meshes.lights.instanceMatrix.setUsage(THREE.DynamicDrawUsage); meshes.lights.instanceColor.setUsage(THREE.DynamicDrawUsage);
    const pg = new THREE.PlaneGeometry(1, 1); pg.rotateX(-Math.PI / 2);
    meshes.pools = new THREE.InstancedMesh(pg, new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), 120); meshes.pools.count = 0; meshes.pools.frustumCulled = false; meshes.pools.renderOrder = 3; root.add(meshes.pools);
    meshes.pools.setColorAt(0, tmpC.set(0)); meshes.pools.instanceColor.setUsage(THREE.DynamicDrawUsage);
    const dg = new THREE.PlaneGeometry(1, 1);
    meshes.decals = new THREE.InstancedMesh(dg, new THREE.MeshBasicMaterial({ map: crackTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), 40); meshes.decals.count = 0; meshes.decals.frustumCulled = false; meshes.decals.renderOrder = 4; root.add(meshes.decals);
    meshes.holes = new THREE.InstancedMesh(dg, new THREE.MeshBasicMaterial({ map: holeTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), 80); meshes.holes.count = 0; meshes.holes.frustumCulled = false; meshes.holes.renderOrder = 4; root.add(meshes.holes);
    const spg = new THREE.BoxGeometry(0.014, 0.014, 0.09);
    meshes.sparks = new THREE.InstancedMesh(spg, new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.2, 0.6), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: true }), 120); meshes.sparks.count = 0; meshes.sparks.frustumCulled = false; meshes.sparks.visible = false; root.add(meshes.sparks);
  }
  function attach(car) {
    if (car.small) return;
    if (car.far) { const ml = meshes.lod[car.ti]; car.slot = ml.cars.length; ml.cars.push(car); ml.mesh.setColorAt(car.slot, car.color); ml.mesh.instanceColor.needsUpdate = true; ml.mesh.count = ml.cars.length; }
    else {
      const mb = meshes.body[car.ti]; car.slot = mb.cars.length; mb.cars.push(car);
      mb.paint.setColorAt(car.slot, car.color); mb.paint.instanceColor.needsUpdate = true;
      for (const k of ['paint', 'glass', 'trim']) mb[k].count = mb.cars.length;
      const wh = meshes.wheels[car.T.rim === 'steel' ? 'steel' : 'rim']; car.wslot = wh.cars.length; wh.cars.push(car); wh.m.count = wh.cars.length * 4;
    }
    if (car.shslot === undefined || car.shslot < 0) { car.shslot = meshes.shadowCars.length; meshes.shadowCars.push(car); meshes.shadow.count = meshes.shadowCars.length; }
    car.dirty = true;
  }
  function detach(car, keepShadow) {
    if (car.small) return;
    if (car.far) {
      const ml = meshes.lod[car.ti], last = ml.cars.pop();
      if (last !== car) { ml.cars[car.slot] = last; last.slot = car.slot; ml.mesh.setColorAt(last.slot, last.color); ml.mesh.instanceColor.needsUpdate = true; last.dirty = true; }
      ml.mesh.count = ml.cars.length;
    } else {
      const mb = meshes.body[car.ti], last = mb.cars.pop();
      if (last !== car) { mb.cars[car.slot] = last; last.slot = car.slot; mb.paint.setColorAt(last.slot, last.color); mb.paint.instanceColor.needsUpdate = true; last.dirty = true; }
      for (const k of ['paint', 'glass', 'trim']) mb[k].count = mb.cars.length;
      const wh = meshes.wheels[car.T.rim === 'steel' ? 'steel' : 'rim'], lw = wh.cars.pop(); if (lw !== car) { wh.cars[car.wslot] = lw; lw.wslot = car.wslot; lw.dirty = true; } wh.m.count = wh.cars.length * 4;
    }
    if (!keepShadow) { const ls = meshes.shadowCars.pop(); if (ls !== car) { meshes.shadowCars[car.shslot] = ls; ls.shslot = car.shslot; ls.dirty = true; } meshes.shadow.count = meshes.shadowCars.length; car.shslot = -1; }
  }
  function setFar(car, far) { if (car.small || car.far === far) return; detach(car, true); car.far = far; attach(car); }
  const flags = { body: new Set(), lod: new Set(), wheels: false, shadow: false };
  function writeCar(car) {
    if (car.small) { tmpQ.setFromAxisAngle(AY, car.yaw); tmpV.set(car.x, car.wy, car.z); tmpS.set(1, 1, 1); car.mat.compose(tmpV, tmpQ, tmpS); car.grp.position.set(car.x, car.wy, car.z); car.grp.rotation.set(0, car.yaw, 0); car.grp.updateMatrixWorld(true); car.pub.pos.set(car.x, car.y, car.z); car.pub.yaw = car.yaw; car.pub.speed = car.v; car.dirty = false; return; }
    const T = car.T, mb = meshes.body[car.ti];
    tmpE.set(car.pitch, car.yaw, car.roll, 'YXZ'); tmpQ.setFromEuler(tmpE); tmpV.set(car.x, car.y, car.z); tmpS.set(1, 1, 1); tmpM.compose(tmpV, tmpQ, tmpS);
    car.mat.copy(tmpM);
    if (car.far) { meshes.lod[car.ti].mesh.setMatrixAt(car.slot, tmpM); flags.lod.add(car.ti); }
    else {
    mb.paint.setMatrixAt(car.slot, tmpM); mb.glass.setMatrixAt(car.slot, tmpM); mb.trim.setMatrixAt(car.slot, tmpM); flags.body.add(car.ti);
    // Räder
    const wh = meshes.wheels[T.rim === 'steel' ? 'steel' : 'rim'], hw = T.W / 2 - T.tw / 2 - 0.012, sc = T.r / 0.33, sx = T.tw / 0.21;
    const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
    for (let w = 0; w < 4; w++) {
      const left = w % 2 === 0, front = w < 2, lx = left ? hw : -hw, lz = front ? T.zf : T.zr;
      tmpV.set(car.x + lx * cy + lz * sy, car.wy + T.r, car.z - lx * sy + lz * cy);
      tmpQ.setFromAxisAngle(AY, car.yaw + (front ? car.steer : 0)); if (!left) tmpQ.multiply(qFlip);
      qSpin.setFromAxisAngle(AX, left ? car.spin : -car.spin); tmpQ.multiply(qSpin);
      tmpS.set(sx, sc, sc); tmpM.compose(tmpV, tmpQ, tmpS); wh.m.setMatrixAt(car.wslot * 4 + w, tmpM);
    }
    flags.wheels = true;
    }
    // Schatten
    tmpQ.setFromAxisAngle(AY, car.yaw); tmpV.set(car.x, car.wy + 0.012, car.z); tmpS.set(T.W + 0.5, 1, T.L + 0.7); tmpM.compose(tmpV, tmpQ, tmpS); meshes.shadow.setMatrixAt(car.shslot, tmpM); flags.shadow = true;
    // Treffer-Kästen
    car.grp.position.set(car.x, car.wy, car.z); car.grp.rotation.set(0, car.yaw, 0); car.grp.updateMatrix(); car.grp.updateMatrixWorld(true);
    car.pub.pos.set(car.x, car.y, car.z); car.pub.yaw = car.yaw; car.pub.speed = car.v;
    car.dirty = false;
  }
  function flush() {
    for (const mb of meshes.body) { const v = mb.cars.length > 0; mb.paint.visible = mb.glass.visible = mb.trim.visible = v; }
    for (const ml of meshes.lod) ml.mesh.visible = ml.cars.length > 0;
    meshes.wheels.rim.m.visible = meshes.wheels.rim.cars.length > 0; meshes.wheels.steel.m.visible = meshes.wheels.steel.cars.length > 0;
    meshes.decals.visible = meshes.decals.count > 0; meshes.holes.visible = meshes.holes.count > 0; meshes.lights.visible = meshes.lights.count > 0;
    for (const ti of flags.body) { const mb = meshes.body[ti]; mb.paint.instanceMatrix.needsUpdate = true; mb.glass.instanceMatrix.needsUpdate = true; mb.trim.instanceMatrix.needsUpdate = true; }
    flags.body.clear();
    for (const ti of flags.lod) meshes.lod[ti].mesh.instanceMatrix.needsUpdate = true; flags.lod.clear();
    if (flags.wheels) { meshes.wheels.rim.m.instanceMatrix.needsUpdate = true; meshes.wheels.steel.m.instanceMatrix.needsUpdate = true; flags.wheels = false; }
    if (flags.shadow) { meshes.shadow.instanceMatrix.needsUpdate = true; flags.shadow = false; }
  }

  // ---------------------------------------------------------------- Autos anlegen
  function makeCar(ti, color, x, z, yaw, kind, Tover) {
    const T = Tover || TYPES[ti];
    const car = { id: nextId++, ti, T, color, kind, x, z, y: -0.14, wy: -0.14, yaw, pitch: 0, roll: 0, v: 0, a: 0, steer: 0, spin: rnd() * TAU, mat: new THREE.Matrix4(),
      rnd: mulberry((rnd() * 1e9) | 0), drv: 0.9 + rnd() * 0.18, brake: false, blink: 0, hazard: 0, alarm: 0, headOn: false, rev: false, flash: 0, bump: 0, shotBrake: 0, waitX: 0, ignore: new Map(), honkT: 0, stuck: 0, blockP: 0, dead: false };
    car.pub = { pos: new THREE.Vector3(x, -0.14, z), yaw, speed: 0, len: T.L, wid: T.W, parked: kind === 'park', id: car.id, type: T.id, car };
    if (T.small) { // Fahrer ist ein Mensch: Treffer-Kapsel nur als „Person“ (combat.js schießt nicht auf Menschen)
      car.small = true; car.lat = T.lat; const g = new THREE.Group(); const px = new THREE.Mesh(riderProxyGeo, hitMat); px.userData.person = true; px.userData.onHit = () => { car.shotBrake = 3; }; g.add(px); hitRoot.add(g); car.grp = g; car.hit = [px]; W.shootables.push(px);
      car.far = false; cars.push(car); W.cars.push(car.pub); car.y = car.wy = groundY(x, z); writeCar(car); return car;
    }
    // Treffer-Kästen: Rumpf + Fensterpartie
    const g = new THREE.Group(); g.matrixAutoUpdate = true;
    const bt = T.beltAt(0), body = new THREE.Mesh(boxGeo, hitMat); body.scale.set(T.W, bt - 0.12, T.L - 0.05); body.position.set(0, (bt + 0.12) / 2, 0);
    const zc0 = T.bus ? -T.L / 2 + 0.2 : T.roof[0] - 0.35, zc1 = T.bus ? T.L / 2 - 0.1 : T.cowl + 0.05, ytop = T.H - 0.02, wc = T.W - 2 * T.k * (ytop - bt) - 0.04;
    const cab = new THREE.Mesh(boxGeo, hitMat); cab.scale.set(wc, ytop - bt, zc1 - zc0); cab.position.set(0, (ytop + bt) / 2, (zc0 + zc1) / 2);
    const onHit = (hit) => carHit(car, hit);
    body.userData.onHit = onHit; cab.userData.onHit = onHit; body.userData.kind = cab.userData.kind = 'car'; body.userData.car = cab.userData.car = car.pub; cab.userData.glass = true;
    g.add(body, cab); hitRoot.add(g); car.grp = g; car.hit = [body, cab];
    W.shootables.push(body, cab);
    car.far = Math.hypot(x - camera.position.x, z - camera.position.z) > LOD_D;
    cars.push(car); attach(car); W.cars.push(car.pub);
    car.y = car.wy = groundY(x, z);
    writeCar(car);
    return car;
  }
  function removeCar(car) {
    if (car.dead) return; car.dead = true;
    if (car.small) smallCount = Math.max(0, smallCount - 1);
    if (car.emerg) emergCount = Math.max(0, emergCount - 1);
    detach(car); const i = cars.indexOf(car); if (i >= 0) cars.splice(i, 1);
    const j = W.cars.indexOf(car.pub); if (j >= 0) W.cars.splice(j, 1);
    for (const h of car.hit) { const k = W.shootables.indexOf(h); if (k >= 0) W.shootables.splice(k, 1); }
    hitRoot.remove(car.grp); decals.removeCar(car); sfx.stopAlarm(car);
  }
  const groundY = (x, z) => { const y = W.groundY ? W.groundY(x, z) : -0.14; return y; };
  const TYPEW_MOVE = [[0, 24], [1, 22], [2, 20], [3, 17], [4, 9], [5, 6]];
  const TYPEW_PARK = [[0, 28], [1, 21], [2, 22], [3, 19], [4, 7], [5, 3]];
  let busCount = 0, smallCount = 0, emergCount = 0;
  function spawnAI(initial, opt = {}) {
    if (!net) return false;
    const Tsm = opt.T || null;
    for (let tries = 0; tries < 18; tries++) {
      const pool = opt.bus ? net.spawnBus : net.spawn; if (!pool || !pool.length) return false;
      const sp = pickW(rnd, pool.map(q => [q, q.w])), E = net.E[sp.e], k = (opt.bus || Tsm) ? E.rk : (rnd() * E.L.length) | 0, ln = E.L[k], s = lerp(sp.a, sp.b, rnd());
      laneAt(ln, s, _o);
      const dc = Math.hypot(_o.x - camera.position.x, _o.z - camera.position.z);
      if (dc > R_SPAWN) continue;
      if (!initial && (dc < 55 || (dc < 120 && inView(_o.x, 1, _o.z)))) continue;
      if (opt.target) { const dd = Math.hypot(_o.x - opt.target.x, _o.z - opt.target.z); if (dd < 70 || dd > 200) continue; }
      let free = true; for (const c of cars) if (Math.abs(c.x - _o.x) < 14 && Math.abs(c.z - _o.z) < 14 && Math.hypot(c.x - _o.x, c.z - _o.z) < (c.kind === 'park' ? 4 : 13)) { free = false; break; }
      if (!free) continue;
      const ti = Tsm ? -1 : opt.bus ? 6 : opt.ti ?? pickW(rnd, TYPEW_MOVE);
      const T = Tsm || TYPES[ti];
      const car = makeCar(ti, opt.color || (Tsm ? new THREE.Color(pickW(rnd, BIKECOL)) : paintFor(rnd, T)), _o.x, _o.z, hdg(_o.dx, _o.dz), 'ai', Tsm);
      if (T.bus) busCount++; if (Tsm) { smallCount++; car.rider = riderLook(); car.crank = rnd() * TAU; }
      if (opt.emerg) { car.emerg = Object.assign({ lights: true, siren: true, patrol: 0, t: 0 }, opt.emerg); emergCount++; car.drv = 1.08; }
      if (opt.target) car.target = opt.target;
      car.path = new Path(); car.s = 0; car.pend = { e: E.i, k, t0: s + 0.001 };
      car.path.add([_o.x - _o.dx * 0.01, _o.x], [_o.z - _o.dz * 0.01, _o.z], { kind: 'lane', e: E.i, k, vmax: E.v * car.drv, turn: 0 });
      car.s = car.path.tail; plan(car);
      car.v = Math.min(E.v * car.drv * 0.8, Tsm ? T.vmax : 9); car.lights = true;
      poseAI(car, 0); writeCar(car);
      return car;
    }
    return false;
  }

  // ---------------------------------------------------------------- Parker an den Bordsteinen
  function pip(poly, x, z) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
  function onAsphalt(x, z) { for (const a of net.cj.asphalt) { if (pip(a.p, x, z)) { for (const h of a.holes || []) if (pip(h, x, z)) return false; return true; } } return false; }
  function placeParked() {
    const cj = net.cj, out = [], pts = cj.points || {};
    const avoid = []; for (const j of net.junc) avoid.push([j[0], j[1], 13]);
    for (const c of pts.crossing || []) avoid.push([c[0], c[1], 7]); for (const b of pts.bus_stop || []) avoid.push([b[0], b[1], 18]); for (const t of pts.traffic_signals || []) avoid.push([t[0], t[1], 8]);
    const laneHalf = (e) => (e.prim ? 1.45 : 0.95);
    const tooCloseLane = (x, z) => { for (const e of net.E) for (const ln of e.L) { const lim = 0.9 + laneHalf(e); for (let i = 0; i < ln.xs.length - 1; i++) { const ax = ln.xs[i], az = ln.zs[i], bx = ln.xs[i + 1], bz = ln.zs[i + 1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1; const t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1); const px = ax + dx * t - x, pz = az + dz * t - z; if (px * px + pz * pz < lim * lim) return true; } } return false; };
    const nearestDir = (x, z) => { let best = 1e9, dx = 1, dz = 0; for (const e of net.E) for (const ln of e.L) for (let i = 0; i < ln.xs.length - 1; i++) { const mx = (ln.xs[i] + ln.xs[i + 1]) / 2, mz = (ln.zs[i] + ln.zs[i + 1]) / 2, d = (mx - x) ** 2 + (mz - z) ** 2; if (d < best) { best = d; const l = Math.hypot(ln.xs[i + 1] - ln.xs[i], ln.zs[i + 1] - ln.zs[i]) || 1; dx = (ln.xs[i + 1] - ln.xs[i]) / l; dz = (ln.zs[i + 1] - ln.zs[i]) / l; } } return [dx, dz]; };
    const rr = mulberry(777); const why = { cand: 0, side: 0, region: 0, shop: 0, avoid: 0, asph: 0, lane: 0, ok: 0 }; PDBG.why = why;
    for (const cb of cj.curbs || []) {
      let acc = 0;
      for (let i = 0; i < cb.length - 1; i++) {
        const ax = cb[i][0], az = cb[i][1], bx = cb[i + 1][0], bz = cb[i + 1][1], sl = Math.hypot(bx - ax, bz - az); if (sl < 0.5) continue;
        const tx = (bx - ax) / sl, tz = (bz - az) / sl, nx = -tz, nz = tx;
        for (let s = acc; s < sl; ) {
          const ti = pickW(rr, TYPEW_PARK), T = TYPES[ti], gapB = 0.7 + rr() * 1.1, need = T.L;
          const sm = s + need / 2;
          if (sm + need / 2 > sl) { acc = Math.max(0, s - sl); break; }
          const px = ax + tx * sm, pz = az + tz * sm;
          s += need + gapB;
          if (rr() < 0.1) { s += 4 + rr() * 6; continue; }
          why.cand++;
          let side = 0; if (onAsphalt(px + nx * 1.6, pz + nz * 1.6)) side = 1; else if (onAsphalt(px - nx * 1.6, pz - nz * 1.6)) side = -1; if (!side) { why.side++; continue; }
          const cx = px + nx * side * (T.W / 2 + 0.18), cz = pz + nz * side * (T.W / 2 + 0.18);
          if (!inRegion(cx, cz, -6)) { why.region++; continue; }
          if (cx > -13 && cx < 26 && cz < 12) { why.shop++; continue; }  // vor dem Laden frei lassen
          if (avoid.some(a => (a[0] - cx) ** 2 + (a[1] - cz) ** 2 < a[2] * a[2])) { why.avoid++; continue; }
          let ok = true; for (const f of [-0.46, 0.46]) for (const q of [-0.4, 0.4]) { const qx = cx + tx * T.L * f + nx * T.W * q, qz = cz + tz * T.L * f + nz * T.W * q; if (!onAsphalt(qx, qz)) ok = false; }
          if (!ok) { why.asph++; continue; } if (tooCloseLane(cx, cz)) { why.lane++; continue; } why.ok++;
          const [ldx, ldz] = nearestDir(cx, cz); const dir = (tx * ldx + tz * ldz) >= 0 ? 1 : -1;
          out.push({ ti, x: cx, z: cz, yaw: hdg(tx * dir, tz * dir) });
        }
      }
    }
    // nach Nähe zum Laden ordnen, begrenzen
    out.sort((a, b) => Math.hypot(a.x - 6, a.z - 20) - Math.hypot(b.x - 6, b.z - 20));
    const list = out.slice(0, MAXPARK);
    list.push({ ti: 2, x: 21.5, z: 8.95, yaw: -Math.PI / 2, color: new THREE.Color('#22262c') }); // ersetzt den alten Platzhalter vor dem Laden
    return list;
  }

  // ---------------------------------------------------------------- Sichtbarkeit
  const frus = new THREE.Frustum(), pmat = new THREE.Matrix4(), sph = new THREE.Sphere();
  function updFrustum() { pmat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frus.setFromProjectionMatrix(pmat); }
  function inView(x, y, z, r = 4) { sph.center.set(x, y, z); sph.radius = r; return frus.intersectsSphere(sph); }

  // ---------------------------------------------------------------- KI fahren
  const SAMP = 30, SD = 1.5;
  function sampleAhead(car) {
    if (!car.sx) { car.sx = new Float32Array(SAMP); car.sz = new Float32Array(SAMP); }
    const sF = car.s + (car.T.L / 2 - car.T.zMid) + 0.2;
    for (let i = 0; i < SAMP; i++) { car.path.at(sF + i * SD, _o); car.sx[i] = _o.x; car.sz[i] = _o.z; }
    car.sF = sF;
  }
  function corridorHit(car, x, z, r) { // Abstand entlang meines Weges bis zum Hindernis (oder -1)
    const lim = car.T.W / 2 + r + 0.3, l2 = lim * lim;
    if ((car.sx[0] - x) ** 2 + (car.sz[0] - z) ** 2 > 3000) return -1;
    for (let i = 0; i < SAMP; i++) { const dx = car.sx[i] - x, dz = car.sz[i] - z; if (dx * dx + dz * dz < l2) return i * SD; }
    return -1;
  }
  function circles(c) { const T = c.T, f = (T.L / 2 - T.W / 2), sx = Math.sin(c.yaw), cz = Math.cos(c.yaw); return [c.x + sx * f, c.z + cz * f, c.x - sx * f, c.z - cz * f, T.W / 2]; }
  function poseAI(car, dt) {
    const T = car.T, h = T.wb / 2;
    car.path.at(car.s + h, _o); const fx = _o.x, fz = _o.z, fdx = _o.dx, fdz = _o.dz;
    car.path.at(car.s - h, _o2); const rx = _o2.x, rz = _o2.z;
    const yaw = hdg(fx - rx, fz - rz);
    const mx = (fx + rx) / 2, mz = (fz + rz) / 2, sy = Math.sin(yaw), cy = Math.cos(yaw);
    car.x = mx - sy * T.zMid; car.z = mz - cy * T.zMid;
    { const want = T.small ? T.lat : (car.passWant || 0) + (car.pullK || 0) * 1.15 + (car.emerg && car.emerg.siren ? -0.35 : 0); car.lat = (car.lat || 0) + (want - (car.lat || 0)) * Math.min(1, (dt || 1) * 1.4); car.x += -cy * car.lat; car.z += sy * car.lat; }
    const dyaw = wrapA(yaw - car.yaw); car.yaw = yaw;
    car.steer = clamp(wrapA(hdg(fdx, fdz) - yaw), -0.6, 0.6);
    const gy = groundY(car.x, car.z); car.wy += (gy - car.wy) * Math.min(1, dt * 10 + (dt === 0 ? 1 : 0)); car.y = car.wy;
    car.pitch += (clamp(-car.a * 0.0045, -0.022, 0.022) - car.pitch) * Math.min(1, dt * 6);
    car.roll += (clamp((dt > 0 ? dyaw / dt : 0) * car.v * 0.004, -0.03, 0.03) - car.roll) * Math.min(1, dt * 5);
    car.spin += car.v * dt / T.r;
  }
  function driveAI(car, dt) {
    const T = car.T, EM = car.emerg;
    if (car.dwell) { dwellStep(car, dt); poseAI(car, dt); return; }
    if (car.leave) { leaveStep(car, dt); return; }
    // gewünschte Geschwindigkeit (Tempo-Grenze, Kurven voraus)
    let vdes = 30, blink = 0; const sF = car.sF;
    for (const g of car.path.segs) { if (g.s0 > sF + 60) break; if (g.s0 + g.len < car.s - T.wb) continue; const d = Math.max(0, g.s0 - sF); vdes = Math.min(vdes, Math.sqrt(g.vmax * g.vmax + 2 * 2.2 * d)); if (g.kind === 'conn' && Math.abs(g.turn) > 0.5 && g.s0 - sF < 32 && g.s0 + g.len > car.s - T.wb / 2) blink = g.turn > 0 ? 1 : -1; }
    if (T.small) vdes = Math.min(vdes, T.vmax * car.drv);
    if (EM && EM.siren) vdes *= 1.2;
    if (EM && EM.patrol > 0) vdes = Math.min(vdes, 6.5);
    if (car.shotBrake > 0 || car.hijack || car.bump > 0) vdes = 0;
    if (car.pullK > 0.05) vdes = vdes * (1 - car.pullK) + 0.4 * car.pullK;
    car.blink = blink;
    // Hindernisse
    let gap = 1e9, vl = 0, lim = null;
    for (const st of car.path.stops) {
      if (st.s > sF + 60) break;
      const s = sigState(st.c, st.ax), d = st.s - sF - 0.4;
      if (st.s < sF) continue;
      if (EM && EM.siren) { if (s !== 'g' && d < 20) vdes = Math.min(vdes, 6.0); break; }   // mit Blaulicht vorsichtig über Rot
      if ((s === 'r' && d > car.v * car.v / 12 * 0.6 - 0.5) || (s === 'y' && d > car.v * car.v / 7 + 1.5)) { if (d < gap) { gap = d; vl = 0; lim = 'sig'; } }
      break;
    }
    if (T.bus) for (const b of car.path.bstops) {   // Bushaltestelle
      if (b.done) continue; const d = b.s - sF; if (d < -2) { b.done = true; continue; } if (d > 90) break;
      if (d < 45) car.blink = -1;
      if (d - 0.2 < gap) { gap = d - 0.2; vl = 0; lim = b; }
      break;
    }
    const myC = circles(car);
    car.passWant = 0;
    for (const o of cars) {
      if (o === car || o.dead) continue;
      if (o.kind === 'park' && !o.onLane) continue;
      const dx0 = o.x - car.x, dz0 = o.z - car.z; if (dx0 * dx0 + dz0 * dz0 > 3600) continue;
      if (car.ignore.has(o.id) && car.ignore.get(o.id) > simT) continue;
      if (o.small && !T.small && o.v > 1.2 && Math.abs(wrapA(o.yaw - car.yaw)) < 0.7) { const ah = dx0 * Math.sin(car.yaw) + dz0 * Math.cos(car.yaw); if (ah > -2.5 && ah < 24) { car.passWant = -0.75; continue; } }   // Rad überholen
      if (EM && EM.siren && (o.pullK || 0) > 0.45 && Math.abs(wrapA(o.yaw - car.yaw)) < 0.7) continue;   // macht Platz
      const oc = circles(o); let d = corridorHit(car, oc[0], oc[1], oc[4]); const d2 = corridorHit(car, oc[2], oc[3], oc[4]); if (d < 0 || (d2 >= 0 && d2 < d)) d = d2;
      if (d < 0) continue;
      const rel = Math.abs(wrapA(o.yaw - car.yaw));
      let g, v = 0;
      if (rel < 0.7) {
        const ahead = (o.x - car.x) * Math.sin(car.yaw) + (o.z - car.z) * Math.cos(car.yaw);
        if (ahead < -0.3 || (Math.abs(ahead) <= 0.3 && o.id > car.id)) continue;   // daneben/hinter mir: nicht warten (Einfädeln)
        g = d - 0.2; v = o.v * Math.cos(rel);
      }
      else {
        if (o.kind === 'ai' && o.sx) { let back = corridorHit(o, myC[0], myC[1], myC[4]); const b2 = corridorHit(o, myC[2], myC[3], myC[4]); if (back < 0 || (b2 >= 0 && b2 < back)) back = b2; if (back >= 0 && (back < d - 0.5 || (Math.abs(back - d) <= 0.5 && o.id < car.id))) { /* ich warte */ } else if (back >= 0) continue; }
        g = d - 0.4;
      }
      if (g < gap) { gap = g; vl = v; lim = o; }
    }
    if (!W.control && W.P) { const d = corridorHit(car, W.P.x, W.P.z, 0.45); if (d >= 0 && d - 0.5 < gap) { gap = d - 0.5; vl = 0; lim = 'player'; } }
    if (Array.isArray(W.npcs)) for (const n of W.npcs) { const p = n.pos || n; if (!p) continue; const dx = p.x - car.x, dz = p.z - car.z; if (dx * dx + dz * dz > 2500) continue; const d = corridorHit(car, p.x, p.z, n.radius || 0.35); if (d >= 0 && d - 0.6 < gap) { gap = d - 0.6; vl = 0; lim = 'npc'; } }
    if (Array.isArray(W.obstacles)) for (const o of W.obstacles) {   // Straßenbahn-Wagenkästen
      const dx = o.x - car.x, dz = o.z - car.z; if (dx * dx + dz * dz > 3600) continue;
      const hl = (o.len || 7) / 2 - (o.wid || 2.4) / 2, sy = Math.sin(o.yaw), cy = Math.cos(o.yaw); let d = -1;
      for (const f of [-1, -0.5, 0, 0.5, 1]) { const h = corridorHit(car, o.x + sy * hl * f, o.z + cy * hl * f, (o.wid || 2.4) / 2); if (h >= 0 && (d < 0 || h < d)) d = h; }
      if (d >= 0 && d - 0.6 < gap) { gap = d - 0.6; vl = 0; lim = 'tram'; }
    }
    if (car.path.ended) { const d = car.path.tail - sF - 1; if (d < gap) { gap = d; vl = 0; lim = car.parkTo ? 'park' : 'end'; } }
    // IDM
    const v0 = Math.max(0.1, vdes), aMax = T.small ? 1.1 : T.bus ? 1.1 : 1.7, b = 2.4, s0 = lim === 'sig' || (lim && lim.st) || lim === 'park' ? 0.3 : lim === 'player' || lim === 'npc' ? 1.2 : T.small ? 1.2 : 2.0, Th = T.small ? 0.8 : 1.15;
    let a = aMax * (1 - Math.pow(Math.min(car.v / v0, 2), 4));
    if (gap < 1e8) { const ss = s0 + Math.max(0, car.v * Th + car.v * (car.v - vl) / (2 * Math.sqrt(aMax * b))); a -= aMax * (ss / Math.max(gap, 0.05)) ** 2; }
    if (car.shotBrake > 0 || car.hijack) a = Math.min(a, -6);
    a = clamp(a, -9, aMax);
    if (gap < 0.25 && lim !== null) { car.v = 0; a = 0; }
    car.v = Math.max(0, car.v + a * dt); car.a = a;
    car.s += car.v * dt;
    car.brake = a < -0.7 || car.v < 0.15;
    // warten / Stau auflösen / hupen
    if (car.v < 0.3) {
      if (lim && typeof lim === 'object' && (Math.abs(wrapA(lim.yaw - car.yaw)) > 0.7 || (lim.lim === car && car.id < lim.id))) { car.waitX += dt; if (car.waitX > 4) { car.ignore.set(lim.id, simT + 3); car.waitX = 0; } }
      else if (lim && typeof lim === 'object' && lim.v < 0.3 && lim.stuck > 14) { car.waitX += dt; if (car.waitX > 10) { car.ignore.set(lim.id, simT + 2); car.waitX = 0; } } else car.waitX = 0;
      if (lim !== 'sig') car.stuck += dt;
      if (lim && typeof lim === 'object' && lim.kind !== 'ai' && car.stuck > 3 && simT > car.honkT) { sfx.horn(car, 0.35 + car.rnd() * 0.3); car.honkT = simT + 5 + car.rnd() * 4; }
      if (lim === 'player') { car.blockP += dt; if (car.blockP > 1.6 && simT > car.honkT) { sfx.horn(car, 0.45); car.honkT = simT + 3.5 + car.rnd() * 2; } } else car.blockP = 0;
    } else { car.waitX = 0; car.stuck = Math.max(0, car.stuck - dt * 2); car.blockP = 0; }
    car.lim = lim;
    if (lim && typeof lim === 'object' && lim.st && gap < 0.7 && car.v < 0.2) { car.v = 0; car.dwell = { b: lim, t: 0, dur: 10 + car.rnd() * 5, open: false }; }
    if (lim === 'park' && gap < 0.5 && car.v < 0.25) { finishPark(car); return; }
    car.path.drop(car.s - T.wb - 12);
    plan(car);
    poseAI(car, dt);
  }

  // ---------------------------------------------------------------- selbst fahren
  const ICON_CAR = '<path d="M5 16.5h14"/><path d="M4 16.5V13l1.8-4.2A2 2 0 0 1 7.6 7.5h8.8a2 2 0 0 1 1.8 1.3L20 13v3.5"/><path d="M4 13h16"/><circle cx="7.5" cy="17" r="1.6"/><circle cx="16.5" cy="17" r="1.6"/>';
  const ICON_OUT = '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 16l-4-4 4-4"/><path d="M6 12h10"/>';
  const ICON_HORN = '<path d="M4 10v4h3l5 4V6L7 10z"/><path d="M16 9a4 4 0 0 1 0 6"/><path d="M18.5 6.5a7.5 7.5 0 0 1 0 11"/>';
  const btnIn = W.addButton ? W.addButton({ id: 'carIn', icon: ICON_CAR, label: 'Einsteigen', big: true, onDown: () => tryEnter() }) : null;
  const btnOut = W.addButton ? W.addButton({ id: 'carOut', icon: ICON_OUT, label: 'Aussteigen', onDown: () => requestExit() }) : null;
  const btnHorn = W.addButton ? W.addButton({ id: 'carHorn', icon: ICON_HORN, label: 'Hupe', onDown: () => { if (drive.car) sfx.horn(drive.car, 0.6, true); } }) : null;
  const drive = { car: null, vx: 0, vz: 0, camYaw: 0, camEl: 0.2, userT: 0, lastYaw: 0, lastEl: 0, exitReq: false, snap: true, crashT: 0, pend: null, hand: false };
  let nearCar = null, nearT = 0;
  function nearestCar(px, pz, maxD) {
    let best = null, bd = maxD;
    for (const c of cars) { if (c.kind === 'player' || c.small) continue; const dx = px - c.x, dz = pz - c.z; if (dx * dx + dz * dz > 100) continue; const sy = Math.sin(c.yaw), cy = Math.cos(c.yaw); const lz = dx * sy + dz * cy, lx = dx * cy - dz * sy; const ex = Math.max(0, Math.abs(lx) - c.T.W / 2), ez = Math.max(0, Math.abs(lz) - c.T.L / 2); const d = Math.hypot(ex, ez); if (d < bd) { bd = d; best = c; } }
    return best;
  }
  function tryEnter() {
    if (drive.car || !W.P || !nearCar) return;
    const c = nearCar;
    if (c.kind === 'ai' && c.v > 0.6) { c.hijack = true; drive.pend = c; W.toast && W.toast('Auto hält an …', 1400); return; }
    takeCar(c);
  }
  function takeCar(c) {
    if (c.kind === 'ai') { c.path = null; if (c.T.bus) busCount = Math.max(0, busCount - 1); if (c.emerg) { c.emerg.siren = false; c.emerg.lights = false; } c.dwell = null; c.leave = null; if (c.doorK) c.doorK = 0; }
    c.kind = 'player'; c.pub.parked = false; c.hijack = false; c.alarm = 0; c.hazard = 0; sfx.stopAlarm(c); drive.pend = null;
    setFar(c, false); drive.car = c; const sy = Math.sin(c.yaw), cy = Math.cos(c.yaw); drive.vx = sy * c.v; drive.vz = cy * c.v; drive.exitReq = false; drive.snap = true;
    drive.camYaw = Math.PI - c.yaw; drive.camEl = 0.2; drive.userT = 0;
    W.tp.active = true; W.tp.yaw = drive.camYaw; W.tp.el = drive.camEl; drive.lastYaw = W.tp.yaw; drive.lastEl = W.tp.el;
    if (W.P.root) W.P.root.visible = false;
    W.control = control; c.lights = true;
    btnIn && btnIn.show(false); btnOut && btnOut.show(true); btnHorn && btnHorn.show(true);
    W.toast && W.toast(W.isMobile ? 'Linker Daumen = lenken + Gas · rechts = umschauen' : 'W/S = Gas/Bremse · A/D = lenken · Leertaste = Handbremse · F = aussteigen', 3200);
    sfx.engineStart();
    W.emit && W.emit('car', { in: true, car: c.pub });
  }
  function requestExit() { if (!drive.car) return; if (Math.abs(carSpeed()) > 2.5) { drive.exitReq = true; return; } doExit(false); }
  function carSpeed() { const c = drive.car; return c ? drive.vx * Math.sin(c.yaw) + drive.vz * Math.cos(c.yaw) : 0; }
  function doExit(silent) {
    const c = drive.car; if (!c) return; drive.car = null; drive.exitReq = false;
    c.kind = 'park'; c.v = 0; c.pub.parked = true; c.lights = false; c.brake = false;
    c.onLane = laneDist(c.x, c.z) < 2.4;
    const lx = Math.cos(c.yaw), lz = -Math.sin(c.yaw), off = c.T.W / 2 + 0.55;
    let px = c.x + lx * off + Math.sin(c.yaw) * 0.4, pz = c.z + lz * off + Math.cos(c.yaw) * 0.4;
    if (W.blocked && W.blocked(px, pz, 'body')) { px = c.x - lx * off; pz = c.z - lz * off; }
    W.control = null; sfx.engineStop();
    if (W.placePlayer) W.placePlayer(px, pz, c.yaw);
    if (!silent) { W.tp.yaw = drive.camYaw; W.tp.el = 0.13; W.tp.active = true; if (W.P.root) W.P.root.visible = true; }
    btnOut && btnOut.show(false); btnHorn && btnHorn.show(false);
    writeCar(c);
    W.emit && W.emit('car', { in: false, car: c.pub });
  }
  function laneDist(x, z) { let best = 1e9; for (const e of net.E) for (const ln of e.L) for (let i = 0; i < ln.xs.length - 1; i++) { const ax = ln.xs[i], az = ln.zs[i], dx = ln.xs[i + 1] - ax, dz = ln.zs[i + 1] - az, l2 = dx * dx + dz * dz || 1, t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1), d = Math.hypot(ax + dx * t - x, az + dz * t - z); if (d < best) best = d; } return best; }
  const control = {
    update(dt) { driveUpdate(dt); return true; },
    exit(silent) { if (drive.car) doExit(!!silent); },
  };
  addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (e.code === 'KeyF') { if (drive.car) requestExit(); else if (nearCar) tryEnter(); }
    if (e.code === 'KeyH' && drive.car) sfx.horn(drive.car, 0.5, true);
    if (e.code === 'Space' && drive.car) { drive.hand = true; e.preventDefault(); }
  });
  addEventListener('keyup', (e) => { if (e.code === 'Space') drive.hand = false; });
  const _look = new THREE.Vector3(), _want = new THREE.Vector3();
  // Fahrbahn ist für Autos immer frei (die Fein-Karte des Ladens sperrt dort ihre Ränder), sonst Häuser/Bäume/Masten/Ladenwände
  function blockedAt(x, z) { if (!W.blocked) return false; if (W.groundY && W.groundY(x, z) < -0.07) return false; return W.blocked(x, z, 'body'); }
  function carPts(T, x, z, yaw) { const sy = Math.sin(yaw), cy = Math.cos(yaw), hw = T.W / 2 - 0.06, hl = T.L / 2 - 0.06, out = []; for (const [lx, lz] of [[hw, hl], [-hw, hl], [hw, -hl], [-hw, -hl], [0, hl + 0.04], [0, -hl - 0.04], [hw, 0], [-hw, 0], [hw, hl * 0.5], [-hw, hl * 0.5], [hw, -hl * 0.5], [-hw, -hl * 0.5]]) out.push([x + lx * cy + lz * sy, z - lx * sy + lz * cy]); return out; }
  function obbOverlap(a, ax, az, ayaw, b) { // grob: Ecken von a in b oder umgekehrt
    const test = (pts, o) => { const sy = Math.sin(o.yaw), cy = Math.cos(o.yaw); for (const p of pts) { const dx = p[0] - o.x, dz = p[1] - o.z, lz = dx * sy + dz * cy, lx = dx * cy - dz * sy; if (Math.abs(lx) < o.T.W / 2 + 0.03 && Math.abs(lz) < o.T.L / 2 + 0.03) return true; } return false; };
    return test(carPts(a.T, ax, az, ayaw), b) || test(carPts(b.T, b.x, b.z, b.yaw), { x: ax, z: az, yaw: ayaw, T: a.T });
  }
  function driveUpdate(dt) {
    const c = drive.car, T = c.T, held = W.held || new Set(), mv = W.stick || { x: 0, y: 0 }, tp = W.tp;
    // Kamera-Eingabe (rechter Daumen / Maus)
    if (Math.abs(tp.yaw - drive.lastYaw) > 1e-5 || Math.abs(tp.el - drive.lastEl) > 1e-5) { drive.camYaw += tp.yaw - drive.lastYaw; drive.camEl = clamp(drive.camEl + (tp.el - drive.lastEl), -0.05, 0.85); drive.userT = 1.8; }
    let fx = Math.sin(c.yaw), fz = Math.cos(c.yaw), lx = Math.cos(c.yaw), lz = -Math.sin(c.yaw);
    let vf = drive.vx * fx + drive.vz * fz, vlat = drive.vx * lx + drive.vz * lz;
    // Eingabe
    let thr = 0, brk = 0, st = 0;
    if (held.has('f')) thr = 1; if (held.has('b')) { if (vf > 0.6) brk = 1; else thr = -1; }
    if (held.has('r') || held.has('tr')) st += 1; if (held.has('l') || held.has('tl')) st -= 1;
    const sm = Math.hypot(mv.x, mv.y);
    if (sm > 0.15) {
      const cyw = drive.camYaw, cfx = Math.sin(cyw), cfz = -Math.cos(cyw), crx = Math.cos(cyw), crz = Math.sin(cyw);
      let dx = cfx * -mv.y + crx * mv.x, dz = cfz * -mv.y + crz * mv.x; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
      const mag = clamp((sm - 0.15) / 0.7, 0.25, 1), yd = wrapA(hdg(dx, dz) - c.yaw);
      if (Math.abs(yd) < 1.95) { if (vf < -1) brk = mag; else { thr = mag * (0.45 + 0.55 * Math.max(0, Math.cos(yd))); st = clamp(-yd / 0.55, -1, 1); } }
      else { if (vf > 1) brk = mag; else { thr = -mag * 0.8; st = clamp(wrapA(hdg(dx, dz) - (c.yaw + Math.PI)) / 0.55, -1, 1); } }
    }
    if (drive.exitReq) { thr = 0; brk = 1; if (Math.abs(vf) < 0.8) { doExit(false); return; } }
    // Längs
    let acc = 0;
    if (thr > 0) acc += thr * (vf < -0.3 ? 10 : Math.max(1.0, 6.4 - vf * 0.19));
    if (thr < 0) acc += thr * (vf > 0.3 ? 10 : 4.2);
    if (brk > 0) acc -= Math.sign(vf) * brk * 11;
    if (drive.hand) acc -= Math.sign(vf) * 4.5;
    acc -= vf * Math.abs(vf) * 0.0017 + vf * 0.05 + (thr === 0 ? Math.sign(vf) * 0.35 : 0);
    const vfOld = vf; vf += acc * dt;
    if ((thr === 0 || brk > 0) && Math.sign(vf) !== Math.sign(vfOld) && vfOld !== 0) vf = 0;
    vf = clamp(vf, -7.5, 31);
    // Lenkung
    const smax = 0.6 / (1 + Math.abs(vf) / 13);
    c.steer += clamp(-st * smax - c.steer, -3.4 * dt, 3.4 * dt);
    const yawRate = vf * Math.tan(c.steer) / T.wb;
    const slide = drive.hand || (Math.abs(vf) > 15 && Math.abs(st) > 0.85);
    vlat *= Math.exp(-(slide ? 1.8 : 9) * dt);
    c.yaw = wrapA(c.yaw + yawRate * dt * (slide ? 1.25 : 1));
    drive.vx = fx * vf + lx * vlat; drive.vz = fz * vf + lz * vlat;
    // Bewegung + Zusammenstöße
    const nx = c.x + drive.vx * dt, nz = c.z + drive.vz * dt;
    let hitN = null, hitSp = 0;
    const pts = carPts(T, nx, nz, c.yaw), old = carPts(T, c.x, c.z, c.yaw); let bx = 0, bz = 0, bn = 0;
    for (let k = 0; k < pts.length; k++) { const p = pts[k]; if (blockedAt(p[0], p[1]) && !blockedAt(old[k][0], old[k][1])) { bx += nx - p[0]; bz += nz - p[1]; bn++; } }   // schon gesperrte Stellen dürfen verlassen werden
    if (bn) { const l = Math.hypot(bx, bz) || 1; hitN = [bx / l, bz / l]; }
    let other = null;
    if (!hitN) for (const o of cars) { if (o === c || o.dead) continue; if (Math.abs(o.x - nx) > 9 || Math.abs(o.z - nz) > 9) continue; if (obbOverlap(c, nx, nz, c.yaw, o)) { other = o; const dx = nx - o.x, dz = nz - o.z, l = Math.hypot(dx, dz) || 1; hitN = [dx / l, dz / l]; if (o.small) { drive.vx *= 0.1; drive.vz *= 0.1; o.shotBrake = 3; } break; } }
    if (!hitN && Array.isArray(W.obstacles)) for (const o of W.obstacles) { if (Math.abs(o.x - nx) > 12 || Math.abs(o.z - nz) > 12) continue; const ob = { x: o.x, z: o.z, yaw: o.yaw, T: { W: o.wid || 2.4, L: o.len || 7 } }; if (obbOverlap(c, nx, nz, c.yaw, ob)) { const dx = nx - o.x, dz = nz - o.z, l = Math.hypot(dx, dz) || 1; hitN = [dx / l, dz / l]; break; } }
    if (!hitN && Array.isArray(W.npcs)) for (const n of W.npcs) { const p = n.pos || n; if (!p) continue; const dx = nx - p.x, dz = nz - p.z; if (dx * dx + dz * dz > 40) continue; const sy = Math.sin(c.yaw), cy = Math.cos(c.yaw), qx = p.x - nx, qz = p.z - nz, llz = qx * sy + qz * cy, llx = qx * cy - qz * sy; const ex = Math.max(0, Math.abs(llx) - T.W / 2), ez = Math.max(0, Math.abs(llz) - T.L / 2); if (Math.hypot(ex, ez) < (n.radius || 0.35) + 0.15) { const l = Math.hypot(dx, dz) || 1; hitN = [dx / l, dz / l]; drive.vx *= 0.1; drive.vz *= 0.1; break; } }
    if (hitN) {
      const vn = drive.vx * hitN[0] + drive.vz * hitN[1];
      if (vn < 0) { drive.vx -= 1.35 * vn * hitN[0]; drive.vz -= 1.35 * vn * hitN[1]; hitSp = -vn; }
      drive.vx *= 0.7; drive.vz *= 0.7;
      c.x += hitN[0] * 0.03; c.z += hitN[1] * 0.03;
      if (hitSp > 2.5 && simT > drive.crashT) { sfx.crash(Math.min(1, hitSp / 12)); drive.crashT = simT + 0.4; }
      if (other) { if (other.kind === 'ai') { other.bump = 3; other.hazard = Math.max(other.hazard, 4); if (simT > other.honkT) { sfx.horn(other, 0.5); other.honkT = simT + 3; } } else if (other.kind === 'park' && hitSp > 3.5 && other.alarm <= 0) startAlarm(other); }
      const still = carPts(T, c.x, c.z, c.yaw).some(p => blockedAt(p[0], p[1]));
      if (still) { drive.stuckT = (drive.stuckT || 0) + dt; if (drive.stuckT > 1.2) { c.x += hitN[0] * 0.25; c.z += hitN[1] * 0.25; } } else drive.stuckT = 0;
    } else { c.x = nx; c.z = nz; drive.stuckT = 0; }
    c.v = vf; c.a = acc; c.brake = brk > 0 || (vf > -0.1 && vf < 0.1 && thr === 0); c.rev = vf < -0.3;
    c.blink = st > 0.6 && Math.abs(vf) < 9 ? -1 : st < -0.6 && Math.abs(vf) < 9 ? 1 : 0;
    const gy = groundY(c.x, c.z); c.wy += (gy - c.wy) * Math.min(1, dt * 14); c.y = c.wy;
    c.pitch += (clamp(-acc * 0.005, -0.03, 0.03) - c.pitch) * Math.min(1, dt * 6);
    c.roll += (clamp(yawRate * vf * 0.006, -0.05, 0.05) - c.roll) * Math.min(1, dt * 5);
    c.spin += vf * dt / T.r;
    writeCar(c);
    // Spielfigur mitführen (für andere Module)
    const P = W.P; if (P) { P.x = c.x; P.z = c.z; P.gy = c.y; P.face = c.yaw; P.speed = Math.abs(vf); if (P.root) { P.root.position.set(c.x, c.y, c.z); P.root.visible = false; } }
    // Kamera
    if (drive.userT > 0) drive.userT -= dt; else if (Math.abs(vf) > 1.2) { const behind = Math.PI - c.yaw; drive.camYaw += wrapA(behind - drive.camYaw) * Math.min(1, dt * 2.2); drive.camEl += (0.2 - drive.camEl) * Math.min(1, dt * 1.5); }
    const big = T.bus ? 1.9 : T.id === 'van' ? 1.35 : 1, ce = Math.cos(drive.camEl), se = Math.sin(drive.camEl);
    const dirx = -Math.sin(drive.camYaw) * ce, dirz = Math.cos(drive.camYaw) * ce;
    _look.set(c.x, c.y + T.H * 0.72 + 0.25 + (camera.aspect < 1 ? 0.5 : 0), c.z);
    const port = camera.aspect < 1, ce2 = port ? 1.45 : 1;
    let dist = (5.6 * big * ce2 + Math.min(1.6, Math.abs(vf) * 0.05)) * (tp.zoom || 1);
    for (let s = 1.2; s <= dist; s += 0.25) { const x = _look.x + dirx * s, z = _look.z + dirz * s; if (W.blocked && W.blocked(x, z, 'cam')) { dist = Math.max(1.2, s - 0.45); break; } }
    _want.set(_look.x + dirx * dist, Math.max(c.y + 0.6, _look.y + se * dist), _look.z + dirz * dist);
    if (drive.snap) { camera.position.copy(_want); drive.snap = false; } else camera.position.lerp(_want, Math.min(1, dt * 10));
    const lead = camera.aspect < 1 ? 3.2 : 1.2; _look.x += fx * lead; _look.z += fz * lead; camera.lookAt(_look); if (W.controls) W.controls.target.copy(_look);
    const wantFov = (camera.aspect < 1 ? 76 : 62) + clamp(Math.abs(vf) * 0.32, 0, 9); if (Math.abs(camera.fov - wantFov) > 0.05) { camera.fov += (wantFov - camera.fov) * Math.min(1, dt * 4); camera.updateProjectionMatrix(); }
    tp.yaw = drive.camYaw; tp.el = drive.camEl; drive.lastYaw = tp.yaw; drive.lastEl = tp.el;
    sfx.engine(Math.abs(vf), thr, Math.abs(vlat));
  }
  // Spielfigur nicht durch Autos laufen lassen
  function pushPlayer() {
    const P = W.P; if (!P || W.control) return;
    for (const c of cars) {
      const dx = P.x - c.x, dz = P.z - c.z; if (dx * dx + dz * dz > 64) continue;
      const sy = Math.sin(c.yaw), cy = Math.cos(c.yaw), lz = dx * sy + dz * cy, lx = dx * cy - dz * sy, hw = c.T.W / 2 + 0.32, hl = c.T.L / 2 + 0.32;
      if (Math.abs(lx) < hw && Math.abs(lz) < hl) {
        let nlx = lx, nlz = lz; if (hw - Math.abs(lx) < hl - Math.abs(lz)) nlx = Math.sign(lx || 1) * hw; else nlz = Math.sign(lz || 1) * hl;
        const nx = c.x + nlx * cy + nlz * sy, nz = c.z - nlx * sy + nlz * cy;
        if (!W.blocked || !W.blocked(nx, nz, 'body')) { P.x = nx; P.z = nz; if (P.root) P.root.position.x = nx, P.root.position.z = nz; }
      }
    }
  }

  // ================================================================= Helfer „Leben“: Bus-Halt, Fahrer, Zweiräder, Einsatzfahrzeuge, Parken
  const BUS = { stops: [], t: 25 + Math.random() * 20 };
  const EMG = { t: 150 + Math.random() * 90 };
  const COP = { car: null, due: -1, cool: 0, last: null, shots: 0 };
  const PARK = { t: 35 + Math.random() * 30, free: [] };
  const MAXSMALL = isMobile ? 4 : 7;
  const BIKECOL = [['#1d1f22', 6], ['#e9e9e6', 3], ['#2c4a6e', 2], ['#7a1c1c', 2], ['#2f5233', 1.5], ['#9b9ea2', 2], ['#c7a443', 1]];
  const JACKET = ['#1f2329', '#2a3646', '#5b2a2a', '#3c4a3a', '#7b6a55', '#c9c4ba', '#30343b', '#5d6168', '#1a2a44', '#8a3d1e', '#c8b27e'];
  const PANTS = ['#1c2230', '#23262c', '#3a3f47', '#2c3e5c', '#4a4236', '#15171b'];
  const SKIN = ['#f0c9a8', '#e3b18c', '#c98e62', '#a86d47', '#7a4a2c', '#f3d2b8'];
  const riderLook = () => ({ jacket: new THREE.Color(JACKET[(rnd() * JACKET.length) | 0]), pants: new THREE.Color(PANTS[(rnd() * PANTS.length) | 0]), skin: new THREE.Color(SKIN[(rnd() * SKIN.length) | 0]) });
  const riderProxyGeo = new THREE.CapsuleGeometry(0.32, 1.05, 2, 6).translate(0, 1.05, 0);
  // ---- Bushaltestellen (aus city_vis.json: Wartehallen) → Halt auf der rechten Spur
  function buildBusStops(shelters) {
    if (!net || BUS.stops.length) return;
    shelters.forEach((sh, i) => {
      let best = null;
      for (const e of net.E) {
        if (!e.prim) continue; const ln = e.L[e.rk];
        let bs = 0, bd = 1e9; for (let j = 0; j < ln.xs.length - 1; j++) { const ax = ln.xs[j], az = ln.zs[j], dx = ln.xs[j + 1] - ax, dz = ln.zs[j + 1] - az, l2 = dx * dx + dz * dz || 1, t = clamp(((sh[0] - ax) * dx + (sh[1] - az) * dz) / l2, 0, 1), d = Math.hypot(ax + dx * t - sh[0], az + dz * t - sh[1]); if (d < bd) { bd = d; bs = ln.cum[j] + t * Math.sqrt(l2); } }
        if (bd > 11) continue;
        laneAt(ln, bs, _o); const side = (sh[0] - _o.x) * (-_o.dz) + (sh[1] - _o.z) * _o.dx; if (side < 1.2) continue;
        if (!best || bd < best.d) best = { e: e.i, k: e.rk, s: bs, d: bd };
      }
      if (!best) return;
      const ln = net.E[best.e].L[best.k]; laneAt(ln, best.s, _o); const rx = -_o.dz, rz = _o.dx;
      // Haltepunkt (Front) 3 m hinter der Wartehalle – ggf. auf der nächsten Kante derselben Straße
      let E0 = net.E[best.e], sS = best.s + 3.2, guard = 0;
      while (sS > E0.L[E0.rk].len - 0.3 && guard++ < 6) { let nx = null, bw = -1e9; for (const [n] of E0.ch) { const N = net.E[n], w = (N.name === E0.name ? 3 : 0) - Math.abs(wrapA(hdg(N.sdx, N.sdz) - hdg(E0.edx, E0.edz))) * 2; if (w > bw) { bw = w; nx = N; } } if (!nx) break; sS -= E0.L[E0.rk].len; E0 = nx; }
      sS = clamp(sS, 0.3, E0.L[E0.rk].len - 0.3);
      const st = { id: 'bus' + i, e: E0.i, k: E0.rk, s: sS, x: sh[0], z: sh[1] };
      const wait = []; for (let t = -6; t <= 4.5; t += 1.5) { const off = Math.max(2.6, best.d - 0.9 + rnd() * 0.7), p = [_o.x + _o.dx * t + rx * off, _o.z + _o.dz * t + rz * off]; if (!(W.groundY && W.groundY(p[0], p[1]) < -0.07) && !(W.blocked && W.blocked(p[0], p[1], 'body'))) wait.push(p); }
      st.pub = { id: st.id, kind: 'bus', x: sh[0], z: sh[1], yaw: hdg(_o.dx, _o.dz), side: [rx, rz], wait, ends: [], h: 0 };
      BUS.stops.push(st); W.stops = W.stops || []; W.stops.push(st.pub);
    });
  }
  const BUSDOOR = [5.05, 0.72, -3.7];
  function busDoorPts(c) { const sy = Math.sin(c.yaw), cy = Math.cos(c.yaw), out = []; for (const z of BUSDOOR) { const lx = -(c.T.W / 2 + 0.55); out.push([c.x + lx * cy + z * sy, c.z - lx * sy + z * cy]); } return out; }
  function dwellStep(car, dt) {
    const D = car.dwell; D.t += dt; car.v = 0; car.a = 0; car.brake = true;
    car.blink = D.t > D.dur - 2.5 ? 1 : 0;
    if (D.t > 1.0 && !D.open && D.t < D.dur - 2.6) { D.open = true; W.emit && W.emit('doors', { stop: D.b.st.id, open: true, pts: busDoorPts(car), kind: 'bus', id: car.id }); }
    if (D.t > D.dur - 2.6 && D.open) { D.open = false; W.emit && W.emit('doors', { stop: D.b.st.id, open: false, pts: busDoorPts(car), kind: 'bus', id: car.id }); }
    if (D.t >= D.dur && (car.doorK || 0) < 0.02) { D.b.done = true; car.dwell = null; }
  }
  // ---- Ausparken: Parker wird zum fahrenden Auto (Blinker links, wartet auf Lücke)
  function nearestLaneFor(c) {
    let best = null;
    for (const e of net.E) { const ln = e.L[e.rk]; for (let j = 0; j < ln.xs.length - 1; j++) { const ax = ln.xs[j], az = ln.zs[j], dx = ln.xs[j + 1] - ax, dz = ln.zs[j + 1] - az, l = Math.hypot(dx, dz) || 1; const t = clamp(((c.x - ax) * dx + (c.z - az) * dz) / (l * l), 0, 1), d = Math.hypot(ax + dx * t - c.x, az + dz * t - c.z); if (d > 5) continue; if ((dx / l) * Math.sin(c.yaw) + (dz / l) * Math.cos(c.yaw) < 0.85) continue; if (!best || d < best.d) best = { e: e.i, k: e.rk, s: ln.cum[j] + t * l, d }; } }
    return best;
  }
  function startLeave(c) {
    const L = nearestLaneFor(c); if (!L) return false; const E = net.E[L.e], ln = E.L[L.k]; const s1 = L.s + 9; if (s1 > ln.len - 2 || !E.ch.length) return false;
    c.leave = { t: 0, lane: L, s1 }; c.kind = 'ai'; c.pub.parked = false; c.lights = true; c.blink = 1; c.onLane = true;
    PARK.free.push({ x: c.x, z: c.z, yaw: c.yaw, ti: c.ti, T: c.T, t: simT });
    return true;
  }
  function leaveStep(c, dt) {
    const Lv = c.leave; Lv.t += dt; c.blink = 1; c.brake = Lv.t < 1.5;
    if (Lv.t < 1.5) return writeCar(c);
    if (!Lv.go) { // Lücke im fließenden Verkehr abwarten
      const ln = net.E[Lv.lane.e].L[Lv.lane.k]; laneAt(ln, Lv.lane.s, _o); let clear = true;
      for (const o of cars) { if (o === c || o.kind !== 'ai' || o.small) continue; const dx = _o.x - o.x, dz = _o.z - o.z, d = Math.hypot(dx, dz); if (d > 32) continue; const ah = dx * Math.sin(o.yaw) + dz * Math.cos(o.yaw); if (ah > -3 && Math.abs(wrapA(o.yaw - c.yaw)) < 0.7) { clear = false; break; } }
      if (!clear && Lv.t < 25) return writeCar(c);
      Lv.go = true;
      const E = net.E[Lv.lane.e], ln2 = E.L[Lv.lane.k]; laneAt(ln2, Lv.s1, _o2);
      const T = c.T, fx = Math.sin(c.yaw), fz = Math.cos(c.yaw), rax = c.x + fx * T.zr, raz = c.z + fz * T.zr, fax = c.x + fx * T.zf, faz = c.z + fz * T.zf;
      c.path = new Path(); c.path.add([rax - fx * 0.5, fax], [raz - fz * 0.5, faz], { kind: 'lane', vmax: 4, turn: 0 }); c.s = 0.5 + T.wb / 2;
      appendConn(c, fax, faz, fx, fz, _o2.x, _o2.z, _o2.dx, _o2.dz); c.path.segs[c.path.segs.length - 1].vmax = 4.5;
      c.pend = { e: Lv.lane.e, k: Lv.lane.k, t0: Lv.s1 + 0.001 }; plan(c);
      c.leave = null; c.v = 0.5; c.blink = 1; sampleAhead(c);
    }
  }
  // ---- Einparken: ein fahrendes Auto nimmt eine freie Lücke vor sich (Blinker rechts)
  function tryPark() {
    const fr = PARK.free.filter(f => simT - f.t > 8); if (!fr.length) return;
    for (const f of fr) {
      for (const c of cars) {
        if (c.kind !== 'ai' || c.small || c.T.bus || c.emerg || c.dwell || c.parkTo || c.v < 2 || c.ti !== f.ti && f.T.L + 0.3 < c.T.L) continue;
        const dx = f.x - c.x, dz = f.z - c.z, d = Math.hypot(dx, dz); if (d < 14 || d > 34) continue;
        const ah = dx * Math.sin(c.yaw) + dz * Math.cos(c.yaw); if (ah < 12) continue; if (Math.abs(wrapA(f.yaw - c.yaw)) > 0.35) continue;
        const lat = -dx * Math.cos(c.yaw) + dz * Math.sin(c.yaw); if (lat < 1.2 || lat > 4.6) continue;   // rechts der Fahrbahn
        // Weg: ab jetzt geradeaus bis kurz davor, dann in die Lücke
        const T = c.T; c.path.at(c.s + T.wb / 2, _o); const sx = _o.x, sz = _o.z, sdx = _o.dx, sdz = _o.dz;
        const fx = Math.sin(f.yaw), fz = Math.cos(f.yaw), tx = f.x + fx * T.zf, tz = f.z + fz * T.zf;
        const p = new Path(); p.add([sx - sdx * (T.wb + 0.5), sx], [sz - sdz * (T.wb + 0.5), sz], { kind: 'lane', vmax: 8, turn: 0 });
        appendConn({ path: p }, sx, sz, sdx, sdz, tx, tz, fx, fz); p.segs[p.segs.length - 1].vmax = 3.0;
        const ext = (T.L / 2 - T.zf) + 1.25; p.add([tx, tx + fx * ext], [tz, tz + fz * ext], { kind: 'lane', vmax: 1.5, turn: 0 });
        p.ended = true; c.path = p; c.s = T.wb / 2 + 0.5; c.pend = null; c.parkTo = f; c.blink = -1; sampleAhead(c);
        PARK.free.splice(PARK.free.indexOf(f), 1); return;
      }
    }
  }
  function finishPark(c) {
    const f = c.parkTo; c.parkTo = null; c.kind = 'park'; c.v = 0; c.pub.parked = true; c.lights = false; c.brake = false; c.blink = 0; c.onLane = false; c.path = null;
    if (f) { c.x = f.x; c.z = f.z; c.yaw = f.yaw; } c.lat = 0; writeCar(c);
  }
  // ---- Zusatz-Netze: Fahrer + Lenkrad, Bustüren, Blaulicht-Balken + Beschriftung, Zweiräder mit Fahrern
  const XM = {};
  function vcol(geo, hex) { const c = new THREE.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3); for (let k = 0; k < n; k++) { a[k * 3] = c.r; a[k * 3 + 1] = c.g; a[k * 3 + 2] = c.b; } geo.setAttribute('color', new THREE.BufferAttribute(a, 3)); return geo.index ? geo.toNonIndexed() : geo; }
  function bar(a, b, r, hex, seg = 6) { const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), l = d.length(); const g = new THREE.CylinderGeometry(r, r, l, seg, 1); g.translate(0, l / 2, 0); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())); g.translate(A.x, A.y, A.z); return vcol(g, hex); }
  function cap(a, b, r, hex) { const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), l = d.length(); const g = new THREE.CapsuleGeometry(r, Math.max(0.01, l), 3, 8); g.translate(0, l / 2, 0); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())); g.translate(A.x, A.y, A.z); return vcol(g, hex); }
  function ball(c, r, hex, sx = 1, sy = 1, sz = 1) { const g = new THREE.SphereGeometry(r, 12, 8); g.scale(sx, sy, sz); g.translate(...c); return vcol(g, hex); }
  function boxv(c, s, hex) { const g = new THREE.BoxGeometry(...s); g.translate(...c); return vcol(g, hex); }
  let mergeG = null;
  async function buildExtra() {
    if (XM.ok) return; const BGU = await import('three/addons/utils/BufferGeometryUtils.js'); mergeG = BGU.mergeGeometries;
    const vm = (o = {}) => new THREE.MeshStandardMaterial(Object.assign({ vertexColors: true, roughness: 0.75, metalness: 0 }, o));
    const mk = (geo, mat, cap, cast = false) => { const m = new THREE.InstancedMesh(geo, mat, cap); m.count = 0; m.frustumCulled = false; m.castShadow = cast && !isMobile; m.receiveShadow = true; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(m); return m; };
    // Fahrer (Oberkörper + Kopf + Arme), Hüfte = Ursprung, Blick +z
    const drv = mergeG([cap([0, 0.05, 0], [0, 0.42, -0.02], 0.17, '#ffffff'), ball([0, 0.68, 0.0], 0.1, '#d9b08f', 0.9, 1.08, 1), ball([0, 0.74, -0.02], 0.104, '#2a2420', 0.95, 0.7, 1),
      cap([0.17, 0.5, 0], [0.2, 0.32, 0.24], 0.05, '#ffffff'), cap([-0.17, 0.5, 0], [-0.2, 0.32, 0.24], 0.05, '#ffffff'), cap([0.2, 0.32, 0.24], [0.16, 0.4, 0.42], 0.045, '#ffffff'), cap([-0.2, 0.32, 0.24], [-0.16, 0.4, 0.42], 0.045, '#ffffff')]);
    XM.drv = mk(drv, vm(), 80); XM.drv.setColorAt(0, tmpC.set(0xffffff));
    const sw = new THREE.TorusGeometry(0.18, 0.02, 6, 18); XM.sw = mk(vcol(sw, '#151515'), vm({ roughness: 0.6 }), 80);
    // Bustür-Flügel
    const dtex = (() => { const c = document.createElement('canvas'); c.width = 128; c.height = 256; const g = c.getContext('2d'); g.fillStyle = '#f2c200'; g.fillRect(0, 0, 128, 256); g.fillStyle = '#121416'; g.fillRect(8, 8, 112, 236); const gr = g.createLinearGradient(0, 10, 0, 240); gr.addColorStop(0, '#7f8f99'); gr.addColorStop(0.4, '#4a5962'); gr.addColorStop(1, '#283037'); g.fillStyle = gr; g.fillRect(14, 14, 100, 224); g.fillStyle = '#c8c8c8'; g.fillRect(14, 120, 100, 4); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
    const dg = new THREE.PlaneGeometry(0.6, 2.05); dg.translate(0, 0.35 + 1.025, 0);
    XM.door = mk(dg, new THREE.MeshStandardMaterial({ map: dtex, roughness: 0.25, metalness: 0.1, side: THREE.DoubleSide }), 6 * 6);
    // Blaulicht-Balken + Beschriftung
    XM.bar = mk(mergeG([boxv([0, 0.06, 0], [1.1, 0.12, 0.3], '#1d2f7a'), boxv([0, 0.0, 0], [1.16, 0.03, 0.34], '#1a1a1a')]), vm({ roughness: 0.3, emissive: 0x0a1550, emissiveIntensity: 0.6 }), 8);
    const livery = (bg, fg, txt, stripe) => { const c = document.createElement('canvas'); c.width = 1024; c.height = 96; const g = c.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, 1024, 96); if (stripe) { g.fillStyle = stripe; for (let x = 0; x < 1024; x += 48) g.fillRect(x, 0, 24, 14), g.fillRect(x + 24, 82, 24, 14); } g.fillStyle = fg; g.font = 'bold 60px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, 512, 50); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
    const lg = new THREE.PlaneGeometry(1, 1);
    XM.livP = mk(lg, new THREE.MeshStandardMaterial({ map: livery('#1b3f94', '#ffffff', 'POLIZEI', null), roughness: 0.35, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2 }), 8);
    XM.livA = mk(lg, new THREE.MeshStandardMaterial({ map: livery('#d8261c', '#ffffff', 'RETTUNGSDIENST', '#f2c200'), roughness: 0.35, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2 }), 8);
    // Fahrrad (Rahmen, Sattel, Lenker); Ursprung = Boden unter Tretlager, +z = vorn, +x = links
    const R = 0.34, wb = 1.08, RA = [0, R, -wb / 2], FA = [0, R, wb / 2], BB = [0, 0.3, -0.02], S = [0, 0.86, -0.2], H1 = [0, 0.94, 0.37], H0 = [0, 0.74, 0.43];
    const bike = mergeG([bar(BB, S, 0.018, '#ffffff'), bar(S, H1, 0.018, '#ffffff'), bar(BB, H0, 0.022, '#ffffff'), bar(H0, H1, 0.024, '#ffffff'),
      bar([0.05, R, -wb / 2], S, 0.011, '#ffffff'), bar([-0.05, R, -wb / 2], S, 0.011, '#ffffff'), bar([0.05, R, -wb / 2], BB, 0.012, '#ffffff'), bar([-0.05, R, -wb / 2], BB, 0.012, '#ffffff'),
      bar([0.045, R, wb / 2], H0, 0.012, '#ffffff'), bar([-0.045, R, wb / 2], H0, 0.012, '#ffffff'), bar(S, [0, 0.99, -0.24], 0.013, '#9a9ea2'), boxv([0, 1.0, -0.26], [0.13, 0.05, 0.25], '#141414'),
      bar(H1, [0, 1.02, 0.34], 0.013, '#9a9ea2'), bar([-0.28, 1.02, 0.36], [0.28, 1.02, 0.36], 0.012, '#2a2a2a'), bar([0.2, 1.02, 0.36], [0.28, 1.02, 0.36], 0.018, '#111111'), bar([-0.2, 1.02, 0.36], [-0.28, 1.02, 0.36], 0.018, '#111111'),
      boxv([0, R + 0.38, -wb / 2 - 0.05], [0.12, 0.012, 0.42], '#202020'), boxv([0, 0.62, -0.62], [0.18, 0.02, 0.32], '#3a3a3a'), ball([0, 0.3, -0.02], 0.05, '#555555'), boxv([0, 0.96, 0.47], [0.08, 0.06, 0.04], '#e8e8e8')]);
    XM.bike = mk(bike, vm({ roughness: 0.45, metalness: 0.4 }), 12, true); XM.bike.setColorAt(0, tmpC.set(0xffffff));
    const wheel = (r, t) => { const parts = [vcol(new THREE.TorusGeometry(r, t, 6, 28), '#151515'), vcol(new THREE.TorusGeometry(r - t * 1.2, t * 0.35, 4, 28), '#a8acb0')]; for (let k = 0; k < 8 && r > 0.2; k++) { const a = k / 8 * Math.PI; parts.push(bar([Math.cos(a) * (r - t), Math.sin(a) * (r - t), 0], [-Math.cos(a) * (r - t), -Math.sin(a) * (r - t), 0], 0.0025, '#b8bcc0', 3)); } const g = mergeG(parts); g.rotateY(Math.PI / 2); return g; };
    XM.wheel = mk(wheel(0.33, 0.022), vm({ roughness: 0.6 }), 24); XM.swheel = mk(wheel(0.1, 0.028), vm({ roughness: 0.6 }), 12);
    const scoot = mergeG([boxv([0, 0.12, 0], [0.16, 0.045, 0.78], '#202326'), bar([0, 0.12, 0.36], [0, 1.06, 0.42], 0.02, '#2b2f33'), bar([-0.24, 1.06, 0.42], [0.24, 1.06, 0.42], 0.014, '#1a1a1a'), boxv([0, 0.18, -0.4], [0.1, 0.03, 0.1], '#2b2f33'), boxv([0, 1.0, 0.44], [0.06, 0.05, 0.03], '#e8e8e8')]);
    XM.scoot = mk(scoot, vm({ roughness: 0.5, metalness: 0.3 }), 6, true);
    // Fahrer auf dem Rad (Oberkörper vorgebeugt) und auf dem Roller (aufrecht): Hüfte = Ursprung
    const torso = (lean, hand) => mergeG([cap([0, 0.02, 0], [0, 0.5 * Math.cos(lean), 0.5 * Math.sin(lean)], 0.15, '#ffffff'), ball([0, 0.52 * Math.cos(lean) - 0.02, 0.52 * Math.sin(lean)], 0.165, '#ffffff', 1.25, 0.7, 0.85),
      ...[1, -1].flatMap(s => { const sh = [s * 0.19, 0.48 * Math.cos(lean), 0.48 * Math.sin(lean)], el = [s * 0.23, (sh[1] + hand[1]) / 2 - 0.04, (sh[2] + hand[2]) / 2 + 0.02], hd = [s * hand[0], hand[1], hand[2]]; return [cap(sh, el, 0.05, '#ffffff'), cap(el, hd, 0.045, '#ffffff')]; })]);
    XM.tBike = mk(torso(0.42, [0.25, 0.02, 0.6]), vm(), 12, true); XM.tScoot = mk(torso(0.06, [0.24, 0.04, 0.47]), vm(), 6, true);
    const head = (lean, hand) => mergeG([ball([0, 0.72 * Math.cos(lean) + 0.04, 0.72 * Math.sin(lean)], 0.105, '#ffffff', 0.92, 1.06, 1.0), ball([0, 0.72 * Math.cos(lean) + 0.1, 0.72 * Math.sin(lean) - 0.02], 0.11, '#2b231e', 0.97, 0.72, 1.03), ball([hand[0], hand[1], hand[2]], 0.045, '#ffffff'), ball([-hand[0], hand[1], hand[2]], 0.045, '#ffffff')]);
    XM.hBike = mk(head(0.42, [0.25, 0.02, 0.6]), vm(), 12); XM.hScoot = mk(head(0.06, [0.24, 0.04, 0.47]), vm(), 6);
    const thigh = mergeG([cap([0, 0, 0], [0, -0.45, 0], 0.07, '#ffffff')]), shin = mergeG([cap([0, 0, 0], [0, -0.43, 0], 0.055, '#ffffff'), boxv([0, -0.47, 0.05], [0.09, 0.07, 0.24], '#1b1b1b')]);
    XM.thigh = mk(thigh, vm(), 36, true); XM.shin = mk(shin, vm(), 36, true);
    for (const k of ['tBike', 'tScoot', 'hBike', 'hScoot', 'thigh', 'shin']) XM[k].setColorAt(0, tmpC.set(0xffffff));
    XM.ok = true;
  }
  const _xm = new THREE.Matrix4(), _xq = new THREE.Quaternion(), _xv = new THREE.Vector3(), _xs = new THREE.Vector3(1, 1, 1), _xa = new THREE.Vector3(), _xb = new THREE.Vector3(), _xd = new THREE.Vector3(), _xm2 = new THREE.Matrix4(), _xe = new THREE.Euler(), YDN = new THREE.Vector3(0, -1, 0);
  function drvPos(T) { if (T._drv) return T._drv; let r; if (T.bus) r = { x: 0.78, y: 0.98, z: T.L / 2 - 1.35, sw: [0.78, 1.38, T.L / 2 - 0.9], tilt: -1.2 }; else { const z = T.ws[0] - 0.62, b = T.beltAt(z); r = { x: T.W * 0.2, y: b - 0.43, z, sw: [T.W * 0.2, b - 0.04, z + 0.42], tilt: -0.75 }; } return (T._drv = r); }
  const LIMB = { a: 0.45, b: 0.47 };
  function legIK(hip, foot, out) { // Knie im Fahrzeug-Raum: Hüfte, Fuß → Knie (nach vorn gebeugt)
    const dy = foot[1] - hip[1], dz = foot[2] - hip[2], d = Math.min(Math.hypot(dy, dz), LIMB.a + LIMB.b - 0.005), ang = Math.atan2(dz, dy), c = clamp((LIMB.a * LIMB.a + d * d - LIMB.b * LIMB.b) / (2 * LIMB.a * d), -1, 1), k = ang - Math.acos(c);
    out[0] = hip[0]; out[1] = hip[1] + Math.cos(k) * LIMB.a; out[2] = hip[2] + Math.sin(k) * LIMB.a; return out;
  }
  function limbMat(m, from, to, base) { _xa.set(...from).applyMatrix4(base); _xb.set(...to).applyMatrix4(base); _xd.subVectors(_xb, _xa).normalize(); _xq.setFromUnitVectors(YDN, _xd); m.compose(_xa, _xq, _xs.set(1, 1, 1)); return m; }
  function writeExtras(dt) {
    if (!XM.ok) return;
    const cam = camera.position; let nd = 0, nsw = 0, ndo = 0, nb = 0, nlp = 0, nla = 0, nbk = 0, nwh = 0, nsc = 0, nsw2 = 0, ntb = 0, nts = 0, nhb = 0, nhs = 0, nth = 0, nsh = 0;
    const knee = [0, 0, 0];
    for (const c of cars) {
      if (c.dead) continue;
      const d2 = (c.x - cam.x) ** 2 + (c.z - cam.z) ** 2;
      if (c.small) {
        if (d2 > 95 * 95 || !inView(c.x, 1, c.z, 2)) continue;
        const T = c.T, bike = T.id === 'bike'; c.crank = (c.crank || 0) + (bike ? c.v / 2.1 : 0) * dt;
        _xq.setFromAxisAngle(AY, c.yaw); _xm.compose(_xv.set(c.x, c.wy, c.z), _xq, _xs.set(1, 1, 1));
        if (bike) { XM.bike.setMatrixAt(nbk, _xm); XM.bike.setColorAt(nbk++, c.color); } else XM.scoot.setMatrixAt(nsc++, _xm);
        for (const zf of bike ? [-T.wb / 2, T.wb / 2] : [-0.43, 0.43]) { _xm2.makeRotationX(c.spin); _xm2.setPosition(0, bike ? T.r : 0.1, zf); _xm2.premultiply(_xm); (bike ? XM.wheel : XM.swheel).setMatrixAt(bike ? nwh++ : nsw2++, _xm2); }
        const hip = bike ? [0, 0.99, -0.24] : [0, 1.0, -0.02], RL = c.rider;
        _xm2.makeTranslation(...hip).premultiply(_xm);
        if (bike) { XM.tBike.setMatrixAt(ntb, _xm2); XM.tBike.setColorAt(ntb++, RL.jacket); XM.hBike.setMatrixAt(nhb, _xm2); XM.hBike.setColorAt(nhb++, RL.skin); }
        else { XM.tScoot.setMatrixAt(nts, _xm2); XM.tScoot.setColorAt(nts++, RL.jacket); XM.hScoot.setMatrixAt(nhs, _xm2); XM.hScoot.setColorAt(nhs++, RL.skin); }
        for (const s of [1, -1]) {
          const h = [s * 0.1, hip[1], hip[2]]; let f;
          if (bike) { const a = c.crank + (s > 0 ? 0 : Math.PI); f = [s * 0.13, 0.3 + 0.17 * Math.cos(a) + 0.06, -0.02 + 0.17 * Math.sin(a)]; }
          else f = [s * 0.07, 0.2, s > 0 ? 0.14 : -0.18];
          legIK(h, f, knee);
          XM.thigh.setMatrixAt(nth, limbMat(_xm2, h, knee, _xm)); XM.thigh.setColorAt(nth++, RL.pants);
          XM.shin.setMatrixAt(nsh, limbMat(_xm2, knee, f, _xm)); XM.shin.setColorAt(nsh++, RL.pants);
        }
        continue;
      }
      if (c.far || d2 > 80 * 80) continue;
      const T = c.T, near = inView(c.x, 1, c.z, T.L);
      if (!near) continue;
      if ((c.kind === 'ai' || c.kind === 'player') && nd < 80) {
        const D = drvPos(T);
        _xm.makeTranslation(D.x, c.wy - c.y + D.y, D.z).premultiply(c.mat); XM.drv.setMatrixAt(nd, _xm); XM.drv.setColorAt(nd++, tmpC.setHex(c.emerg && c.emerg.type === 'police' ? 0x223355 : [0x2a2d33, 0x3b3f47, 0x55504a, 0x1d2532, 0x6b6e73][c.id % 5]));
        _xe.set(D.tilt, 0, (c.steer || 0) * 5.5, 'XYZ'); _xq.setFromEuler(_xe); _xm2.compose(_xv.set(...D.sw), _xq, _xs.set(1, 1, 1)); _xm2.premultiply(c.mat); XM.sw.setMatrixAt(nsw++, _xm2);
      }
      if (T.bus && ndo + 6 <= 36) {
        const k = c.doorK || 0, outw = Math.min(1, k / 0.3) * 0.1, sl = clamp((k - 0.3) / 0.7, 0, 1) * 0.5;
        for (const z of BUSDOOR) for (const lf of [-1, 1]) { _xq.setFromAxisAngle(AY, -Math.PI / 2); _xm2.compose(_xv.set(-(T.W / 2 + 0.012 + outw), 0, z + lf * (0.3 + sl)), _xq, _xs.set(lf > 0 ? -1 : 1, 1, 1)); _xm2.premultiply(c.mat); XM.door.setMatrixAt(ndo++, _xm2); }
      }
      if (c.emerg && nb < 8) {
        const z = c.emerg.barZ ?? 0; _xm2.makeTranslation(0, (T.H || 1.5) + 0.02, z).premultiply(c.mat); XM.bar.setMatrixAt(nb++, _xm2);
        const pol = c.emerg.type === 'police', M = pol ? XM.livP : XM.livA, y = pol ? T.beltAt(0) - 0.2 : 1.05, len = pol ? T.L * 0.62 : 4.2, h = pol ? 0.24 : 0.34;
        for (const s of [1, -1]) { if ((pol ? nlp : nla) >= 8) break; _xq.setFromAxisAngle(AY, s * Math.PI / 2); _xm2.compose(_xv.set(s * (T.wAt(0) + 0.006), y, -0.1), _xq, _xs.set(len, h, 1)); _xm2.premultiply(c.mat); M.setMatrixAt(pol ? nlp++ : nla++, _xm2); }
      }
    }
    const fin = (m, n, col) => { m.count = n; m.visible = n > 0; if (n) { m.instanceMatrix.needsUpdate = true; if (col && m.instanceColor) m.instanceColor.needsUpdate = true; } };
    fin(XM.drv, nd, true); fin(XM.sw, nsw); fin(XM.door, ndo); fin(XM.bar, nb); fin(XM.livP, nlp); fin(XM.livA, nla);
    fin(XM.bike, nbk, true); fin(XM.wheel, nwh); fin(XM.scoot, nsc); fin(XM.swheel, nsw2); fin(XM.tBike, ntb, true); fin(XM.tScoot, nts, true); fin(XM.hBike, nhb, true); fin(XM.hScoot, nhs, true); fin(XM.thigh, nth, true); fin(XM.shin, nsh, true);
  }
  // ---- Einsatzfahrzeuge (selten, mit Blaulicht + Martinshorn) und Polizei-Streife nach Schüssen
  function spawnEmergency(type, target) {
    const pol = type === 'police', ti = pol ? 2 : 4;
    const car = spawnAI(false, { ti, color: new THREE.Color(pol ? '#e6e9ec' : '#f3f3f1'), emerg: { type, siren: true, lights: true, barZ: pol ? (TYPES[2].roof[0] + TYPES[2].roof[1]) / 2 + 0.25 : TYPES[4].roof[1] - 0.25 }, target });
    return car;
  }
  function updateEmergency(dt) {
    // Platz machen: Autos vor einem Einsatzfahrzeug (gleiche Richtung, bis 45 m) fahren rechts ran
    const em = cars.filter(c => c.emerg && c.emerg.siren && c.kind === 'ai');
    for (const c of cars) {
      if (c.kind !== 'ai' || c.small || c.emerg) continue; let want = 0;
      for (const e of em) { const dx = c.x - e.x, dz = c.z - e.z; if (dx * dx + dz * dz > 2500) continue; if (Math.abs(wrapA(c.yaw - e.yaw)) > 0.7) continue; const ah = dx * Math.sin(e.yaw) + dz * Math.cos(e.yaw), lat = Math.abs(-dx * Math.cos(e.yaw) + dz * Math.sin(e.yaw)); if (ah > 2 && ah < 45 && lat < 4) { want = 1; break; } }
      c.pullK = clamp((c.pullK || 0) + (want ? 0.9 : -0.45) * dt, 0, 1);
    }
    for (const c of cars) if (c.emerg) {
      const E = c.emerg; E.t += dt;
      if (E.type === 'police' && c.target) {
        const d = Math.hypot(c.x - c.target.x, c.z - c.target.z);
        if (E.siren && d < 45) { E.siren = false; E.patrol = 75; }      // angekommen: ohne Horn langsam Streife fahren
        if (E.patrol > 0) { E.patrol -= dt; if (E.patrol <= 0) { E.lights = false; c.target = null; } }
      }
    }
    // Martinshorn: nächstes Fahrzeug mit Horn
    let near = null, nd = 160; for (const c of em) { const d = Math.hypot(c.x - camera.position.x, c.z - camera.position.z); if (d < nd) { nd = d; near = c; } }
    sfx.siren(near);
    // selten ein Einsatz einfach so
    EMG.t -= dt;
    if (EMG.t <= 0) { EMG.t = (isMobile ? 210 : 170) + Math.random() * 110; if (emergCount < 1) spawnEmergency(Math.random() < 0.5 ? 'police' : 'amb', null); }
    // Polizei nach Schüssen (Spielmodus): kommt mit Horn, fährt dann ruhig Streife – greift nie an
    if (COP.due >= 0) { COP.due -= dt; if (COP.due < 0) { const t = COP.last || { x: W.P.x, z: W.P.z }; const c = spawnEmergency('police', { x: t.x, z: t.z }); if (c) { COP.car = c; } else COP.due = 4; COP.cool = simT + 150; } }
    if (COP.car && (COP.car.dead || COP.car.kind !== 'ai')) COP.car = null;
  }

  // ---------------------------------------------------------------- Lichter
  const COL = { blue: [0.25, 0.55, 4.2], blueDim: [0.02, 0.05, 0.35], bike: [1.6, 1.55, 1.4], bikeR: [1.3, 0.05, 0.03], head: [2.3, 2.15, 1.95], drl: [1.5, 1.6, 1.7], tail: [1.3, 0.06, 0.03], brake: [3.8, 0.18, 0.08], ind: [3.2, 1.25, 0.08], rev: [2.0, 2.0, 2.0], taxi: [2.4, 1.9, 0.6], disp: [2.6, 1.3, 0.25] };
  let LI = 0, PI = 0; const lightM = () => meshes.lights, poolM = () => meshes.pools;
  function addLight(c, lx, ly, lz, w, h, back, col, k = 1) {
    if (LI >= 700) return; const s = c.mat;
    tmpQ.setFromAxisAngle(AY, back ? Math.PI : 0); tmpV.set(lx, ly, lz); tmpS.set(w, h, 1); tmpM.compose(tmpV, tmpQ, tmpS); tmpM.premultiply(s);
    lightM().setMatrixAt(LI, tmpM); lightM().setColorAt(LI, tmpC.setRGB(col[0] * k, col[1] * k, col[2] * k)); LI++;
  }
  function addPool(c, back, col, len, wid) {
    if (PI >= 120) return; const sy = Math.sin(c.yaw), cy = Math.cos(c.yaw), off = back ? -(c.T.L / 2 + len * 0.42) : c.T.L / 2 + len * 0.48;
    tmpQ.setFromAxisAngle(AY, c.yaw + (back ? Math.PI : 0)); tmpV.set(c.x + sy * off, c.wy + 0.02, c.z + cy * off); tmpS.set(wid, 1, len); tmpM.compose(tmpV, tmpQ, tmpS);
    poolM().setMatrixAt(PI, tmpM); poolM().setColorAt(PI, tmpC.setRGB(col[0], col[1], col[2])); PI++;
  }
  function addA(c, a, col, k = 1, sw = 1, sh = 1, dy = 0, dx = 0) {
    if (LI >= 700) return;
    tmpV.copy(a.p); tmpV.y += dy; tmpV.x += dx; tmpS.set(a.w * sw, a.h * sh, 1); tmpM.compose(tmpV, a.q, tmpS); tmpM.premultiply(c.mat);
    lightM().setMatrixAt(LI, tmpM); lightM().setColorAt(LI, tmpC.setRGB(col[0] * k, col[1] * k, col[2] * k)); LI++;
  }
  function carLights(c, blinkOn, night, camNear) {
    if (c.small) { if (night) { addLight(c, 0, 0.98, c.T.L / 2 - 0.12, 0.16, 0.12, false, COL.bike, 1); addLight(c, 0, 0.78, -c.T.L / 2 + 0.06, 0.12, 0.1, true, COL.bikeR, 1); } return; }
    if (c.emerg && c.emerg.lights) {
      const y = (c.T.H || 1.5) + 0.2, z = c.emerg.barZ ?? 0, ph = Math.floor(simT * 7 + c.id) % 2 === 0, ph2 = Math.floor(simT * 7 + c.id + 0.5) % 2 === 0;
      for (const back of [false, true]) { addLight(c, 0.33, y, z + (back ? -0.17 : 0.17), 0.7, 0.45, back, ph ? COL.blue : COL.blueDim, 1); addLight(c, -0.33, y, z + (back ? -0.17 : 0.17), 0.7, 0.45, back, ph2 ? COL.blue : COL.blueDim, 1); }
      if (night && camNear && ph) addPool(c, false, [0.0, 0.03, 0.22], 7, 7);
    }
    const T = c.T, An = T.anchors, lit = c.kind !== 'park' && c.lights, hzd = c.hazard > 0 || c.alarm > 0;
    if (lit) {
      for (const a of An.head || []) { if (night) addA(c, a, COL.head, 1, 1.05, 1.15); else addA(c, a, COL.drl, 0.75, 0.9, 0.28, a.h * 0.32); }
      for (const a of An.tail || []) { if (night || c.brake) addA(c, a, c.brake ? COL.brake : COL.tail, c.brake && !night ? 0.8 : 1); if (c.rev) addA(c, a, COL.rev, 1, 0.3, 0.6, 0, -a.side * a.w * 0.3); }
      if (c.brake) for (const a of An.brake3 || []) addA(c, a, COL.brake, 0.8, 1, 2.2);
      if (night && camNear) addPool(c, false, [0.2, 0.185, 0.155], T.bus ? 12 : 10, T.W * 2.4);
      if (night && c.brake && camNear) addPool(c, true, [0.16, 0.01, 0.005], 3.4, T.W * 1.5);
      if (T.taxi && night) addLight(c, 0, T.signY, T.signZ + 0.065, 0.42, 0.13, false, COL.taxi, 0.7), addLight(c, 0, T.signY, T.signZ - 0.065, 0.42, 0.13, true, COL.taxi, 0.7);
      for (const a of An.disp || []) addA(c, a, COL.disp, night ? 1 : 0.6);
    } else if (T.taxi && night && c.kind === 'park' && c.id % 3 === 0) addLight(c, 0, T.signY, T.signZ + 0.065, 0.42, 0.13, false, COL.taxi, 0.5);
    const bl = hzd ? 2 : c.blink;
    if (bl && blinkOn) for (const g of ['indF', 'indR']) for (const a of An[g] || []) { if (bl !== 2 && Math.sign(a.side) !== Math.sign(bl)) continue; addA(c, a, COL.ind, 1, 1.4, 1.3); }
    if (c.alarm > 0 && blinkOn) for (const a of An.head || []) addA(c, a, COL.head, 0.8);
  }

  // ---------------------------------------------------------------- Treffer, Splitter, Alarm
  const decals = {
    list: [],
    add(car, glassHit, lp, ln) { // lp: lokaler Punkt, ln: lokale Normale
      if (this.list.length > 110) this.list.shift();
      this.list.push({ car, glass: glassHit, m: new THREE.Matrix4().compose(new THREE.Vector3(lp.x + ln.x * 0.012, lp.y + ln.y * 0.012, lp.z + ln.z * 0.012), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), ln), new THREE.Vector3(1, 1, 1).multiplyScalar(glassHit ? 0.32 + Math.random() * 0.2 : 0.07)), rot: Math.random() * TAU });
    },
    removeCar(car) { this.list = this.list.filter(d => d.car !== car); },
    write() {
      let nd = 0, nh = 0; const dm = meshes.decals, hm = meshes.holes;
      for (const d of this.list) { tmpM.multiplyMatrices(d.car.mat, d.m); if (d.glass) { if (nd < 40) dm.setMatrixAt(nd++, tmpM); } else if (nh < 80) hm.setMatrixAt(nh++, tmpM); }
      dm.count = nd; hm.count = nh; if (nd) dm.instanceMatrix.needsUpdate = true; if (nh) hm.instanceMatrix.needsUpdate = true;
    },
  };
  const sparks = { p: [], add(pt, n, k = 12) { for (let i = 0; i < k; i++) { const v = new THREE.Vector3(n.x + (Math.random() - 0.5) * 1.4, n.y + Math.random() * 0.9, n.z + (Math.random() - 0.5) * 1.4).normalize().multiplyScalar(2 + Math.random() * 5); this.p.push({ x: pt.x, y: pt.y, z: pt.z, v, t: 0.18 + Math.random() * 0.25 }); } if (this.p.length > 120) this.p.splice(0, this.p.length - 120); } };
  function updSparks(dt) {
    const m = meshes.sparks; let n = 0;
    for (const s of sparks.p) { s.t -= dt; if (s.t <= 0) continue; s.v.y -= 9.8 * dt; s.x += s.v.x * dt; s.y += s.v.y * dt; s.z += s.v.z * dt; tmpQ.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tmpV.copy(s.v).normalize()); tmpS.set(1, 1, 1); tmpM.compose(tmpV.set(s.x, s.y, s.z), tmpQ, tmpS); m.setMatrixAt(n++, tmpM); }
    sparks.p = sparks.p.filter(s => s.t > 0); m.count = n; m.visible = n > 0; if (n) m.instanceMatrix.needsUpdate = true; return n > 0;
  }
  const _inv = new THREE.Matrix4();
  function carHit(car, hit) {
    if (!hit || !hit.point || car.dead) return;
    _inv.copy(car.grp.matrixWorld).invert();
    const lp = hit.point.clone().applyMatrix4(_inv), T = car.T;
    const bt = T.beltAt(clamp(lp.z, -T.L / 2, T.L / 2));
    const isGlass = lp.y > bt + 0.03 && lp.y < T.H - 0.04 && !T.bus || (T.bus && lp.y > 1.1 && lp.y < 2.8);
    // Normale + Lage auf der echten Karosserie
    const ln = new THREE.Vector3(), zc = clamp(lp.z, -T.L / 2 + 0.05, T.L / 2 - 0.05), sideD = T.wAt(zc) - Math.abs(lp.x), endD = T.L / 2 - Math.abs(lp.z);
    if (endD < 0.3 && (lp.y < bt + 0.05 || T.bus)) { ln.set(0, 0, Math.sign(lp.z) || 1); lp.z = T.zSurf(lp.x, lp.z > 0) + Math.sign(lp.z) * 0.004; }
    else if (lp.y > bt - 0.02 && sideD > 0.24 && !T.bus) { const sl = (T.topF(zc + 0.03) - T.topF(zc - 0.03)) / 0.06; ln.set(0, 1, -sl).normalize(); lp.y = T.topF(zc) + T.crown * 0.8; }
    else { const sx = Math.sign(lp.x) || 1; ln.set(sx, isGlass ? T.k : 0, 0).normalize(); lp.x = sx * (isGlass ? T.wAt(zc) - T.k * Math.max(0, lp.y - bt) : T.wAt(zc) + 0.004); }
    decals.add(car, isGlass, lp, ln);
    const wn = ln.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(AY, car.yaw));
    if (!isGlass) sparks.add(hit.point, wn);
    sfx.impact(car, isGlass);
    if (car.kind === 'park' && car.alarm <= 0) startAlarm(car);
    if (car.kind === 'ai') { car.shotBrake = 10; car.hazard = 10; }
    W.requestRender && W.requestRender();
  }
  function startAlarm(car) { car.alarm = 9; sfx.alarm(car); }
  if (W.on) {
    W.on('shot', (d) => {
      const p = d && d.pos; if (!p) return;
      if (W.gameMode) { COP.last = { x: p.x, z: p.z }; COP.shots++; if (!COP.car && COP.due < 0 && simT > COP.cool) COP.due = 16 + Math.random() * 12; }
      for (const c of cars) {
        const dd = Math.hypot(c.x - p.x, c.z - p.z);
        if (c.kind === 'ai' && dd < 35) { c.shotBrake = Math.max(c.shotBrake, 2.5 + Math.random() * 2); if (Math.random() < 0.45 && simT > c.honkT) { sfx.horn(c, 0.5 + Math.random() * 0.4); c.honkT = simT + 2.5; } }
        else if (c.kind === 'park' && dd < 10 && c.alarm <= 0 && Math.random() < 0.2) startAlarm(c);
      }
    });
    W.on('explosion', (d) => { const p = d && d.pos; if (!p) return; const R = (d.r || 8) * 1.5; for (const c of cars) if (Math.hypot(c.x - p.x, c.z - p.z) < R) { if (c.kind === 'park') startAlarm(c); else if (c.kind === 'ai') { c.shotBrake = 6; c.hazard = 8; } } });
  }

  // ---------------------------------------------------------------- Ton (WebAudio, leise, erst nach Berührung)
  const sfx = (() => {
    const A = { ctx: null, master: null, noise: null, eng: null, amb: null, alarms: new Map() };
    function unlock() {
      if (A.ctx) { if (A.ctx.state === 'suspended') A.ctx.resume(); return; }
      try {
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
        A.ctx = new AC(); A.master = A.ctx.createGain(); A.master.gain.value = 0.55; A.master.connect(A.ctx.destination);
        const len = A.ctx.sampleRate * 2, buf = A.ctx.createBuffer(1, len, A.ctx.sampleRate), d = buf.getChannelData(0); let b0 = 0, b1 = 0, b2 = 0;
        for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0527; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
        A.noise = buf;
        const src = A.ctx.createBufferSource(); src.buffer = buf; src.loop = true; const lp = A.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; const g = A.ctx.createGain(); g.gain.value = 0; src.connect(lp).connect(g).connect(A.master); src.start(); A.amb = g;
      } catch (e) { A.ctx = null; }
    }
    for (const ev of ['pointerdown', 'keydown', 'touchend']) addEventListener(ev, unlock, { capture: true, passive: true });
    const ok = () => A.ctx && A.ctx.state === 'running';
    function spatial(x, z, base) {
      const dx = x - camera.position.x, dz = z - camera.position.z, d = Math.hypot(dx, dz);
      const g = base / (1 + Math.pow(d / 9, 1.3)); camera.getWorldDirection(tmpV); const rx = -tmpV.z, rz = tmpV.x, rl = Math.hypot(rx, rz) || 1;
      const pan = clamp((dx * rx + dz * rz) / rl / (d + 2), -0.85, 0.85); return { g, pan, d };
    }
    function out(gNode, pan) { if (A.ctx.createStereoPanner) { const p = A.ctx.createStereoPanner(); p.pan.value = pan; gNode.connect(p).connect(A.master); } else gNode.connect(A.master); }
    return {
      horn(car, dur = 0.45, own = false) {
        if (!ok()) return; const sp = own ? { g: 0.11, pan: 0 } : spatial(car.x, car.z, 0.16); if (sp.g < 0.004) return;
        const t = A.ctx.currentTime, g = A.ctx.createGain(), lp = A.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(sp.g, t + 0.015); g.gain.setValueAtTime(sp.g, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 0.06);
        const f = car.T.bus ? 300 : car.T.id === 'klein' ? 470 : 405 + (car.id % 5) * 12;
        for (const fr of [f, f * 1.26]) { const o = A.ctx.createOscillator(); o.type = 'square'; o.frequency.value = fr; o.connect(lp); o.start(t); o.stop(t + dur + 0.08); }
        lp.connect(g); out(g, sp.pan);
      },
      alarm(car) {
        if (!ok() || A.alarms.has(car)) return; const sp = spatial(car.x, car.z, 0.07); if (sp.g < 0.003) return;
        const t = A.ctx.currentTime, dur = 8, o = A.ctx.createOscillator(), g = A.ctx.createGain(), lp = A.ctx.createBiquadFilter(); o.type = 'sawtooth'; lp.type = 'lowpass'; lp.frequency.value = 3000;
        for (let k = 0; k < dur * 2; k++) { o.frequency.setValueAtTime(k % 2 ? 1250 : 720, t + k * 0.5); o.frequency.linearRampToValueAtTime(k % 2 ? 720 : 1250, t + k * 0.5 + 0.45); }
        g.gain.setValueAtTime(sp.g, t); g.gain.setValueAtTime(sp.g, t + dur - 0.2); g.gain.linearRampToValueAtTime(0, t + dur);
        o.connect(lp).connect(g); out(g, sp.pan); o.start(t); o.stop(t + dur); A.alarms.set(car, { o, g }); o.onended = () => A.alarms.delete(car);
      },
      stopAlarm(car) { const a = A.alarms.get(car); if (a) { try { a.o.stop(); } catch (e) { /* schon aus */ } A.alarms.delete(car); } },
      impact(car, glassHit) {
        if (!ok() || !A.noise) return; const sp = spatial(car.x, car.z, glassHit ? 0.25 : 0.18); const t = A.ctx.currentTime;
        const s = A.ctx.createBufferSource(); s.buffer = A.noise; const bp = A.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = glassHit ? 5200 : 2600; bp.Q.value = glassHit ? 0.8 : 3; const g = A.ctx.createGain(); g.gain.setValueAtTime(sp.g, t); g.gain.exponentialRampToValueAtTime(0.0005, t + (glassHit ? 0.35 : 0.12));
        s.connect(bp).connect(g); out(g, sp.pan); s.start(t, Math.random()); s.stop(t + 0.4);
        if (!glassHit) { const o = A.ctx.createOscillator(); o.frequency.value = 2900 + Math.random() * 600; const g2 = A.ctx.createGain(); g2.gain.setValueAtTime(sp.g * 0.4, t); g2.gain.exponentialRampToValueAtTime(0.0005, t + 0.25); o.connect(g2); out(g2, sp.pan); o.start(t); o.stop(t + 0.26); }
      },
      crash(k) {
        if (!ok() || !A.noise) return; const t = A.ctx.currentTime, s = A.ctx.createBufferSource(); s.buffer = A.noise; const lp = A.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; const g = A.ctx.createGain(); g.gain.setValueAtTime(0.25 * k, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.4);
        s.connect(lp).connect(g).connect(A.master); s.start(t, Math.random()); s.stop(t + 0.45);
      },
      engineStart() {
        if (!ok() || A.eng) return; const t = A.ctx.currentTime;
        const o1 = A.ctx.createOscillator(), o2 = A.ctx.createOscillator(), lp = A.ctx.createBiquadFilter(), g = A.ctx.createGain(); o1.type = 'sawtooth'; o2.type = 'square'; lp.type = 'lowpass'; lp.frequency.value = 400; g.gain.value = 0;
        const ns = A.ctx.createBufferSource(); ns.buffer = A.noise; ns.loop = true; const bp = A.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1700; bp.Q.value = 1.2; const gs = A.ctx.createGain(); gs.gain.value = 0;
        o1.connect(lp); o2.connect(lp); lp.connect(g).connect(A.master); ns.connect(bp).connect(gs).connect(A.master);
        o1.start(t); o2.start(t); ns.start(t); g.gain.linearRampToValueAtTime(0.05, t + 0.3); A.eng = { o1, o2, lp, g, ns, gs };
      },
      engineStop() { if (!A.eng) return; const e = A.eng, t = A.ctx.currentTime; e.g.gain.setTargetAtTime(0, t, 0.08); e.gs.gain.setTargetAtTime(0, t, 0.05); setTimeout(() => { try { e.o1.stop(); e.o2.stop(); e.ns.stop(); } catch (er) { /* aus */ } }, 400); A.eng = null; },
      engine(v, thr, slip) {
        if (!A.eng) { if (ok() && drive.car) this.engineStart(); return; }
        const gears = [0, 7, 13, 19, 25, 40]; let gi = 0; while (gi < 4 && v > gears[gi + 1]) gi++; const rpm = clamp((v - gears[gi]) / (gears[gi + 1] - gears[gi]), 0, 1) * 0.75 + 0.25 * (gi ? 1 : 0.4) + Math.abs(thr) * 0.08;
        const f = 32 + rpm * 95, t = A.ctx.currentTime, e = A.eng;
        e.o1.frequency.setTargetAtTime(f, t, 0.05); e.o2.frequency.setTargetAtTime(f * 0.5, t, 0.05); e.lp.frequency.setTargetAtTime(260 + rpm * 900 + Math.abs(thr) * 300, t, 0.08); e.g.gain.setTargetAtTime(0.035 + Math.abs(thr) * 0.03, t, 0.1);
        e.gs.gain.setTargetAtTime(slip > 2.2 ? clamp((slip - 2.2) * 0.04, 0, 0.12) : 0, t, 0.06);
      },
      ambience(level) { if (A.amb && ok()) A.amb.gain.setTargetAtTime(level, A.ctx.currentTime, 0.4); },
      siren(car) { // Martinshorn (tatü-tata) des nächsten Einsatzfahrzeugs; car = null → aus
        if (!ok()) return; const t = A.ctx.currentTime;
        if (!car) { if (A.sir) A.sir.g.gain.setTargetAtTime(0, t, 0.3); return; }
        if (!A.sir) { const o = A.ctx.createOscillator(), o2 = A.ctx.createOscillator(), lp = A.ctx.createBiquadFilter(), g = A.ctx.createGain(); o.type = 'sawtooth'; o2.type = 'square'; lp.type = 'lowpass'; lp.frequency.value = 2200; g.gain.value = 0; o.connect(lp); o2.connect(lp); const pn = A.ctx.createStereoPanner ? A.ctx.createStereoPanner() : null; lp.connect(g); if (pn) g.connect(pn).connect(A.master); else g.connect(A.master); o.start(); o2.start(); A.sir = { o, o2, g, pn, next: 0, hi: false }; }
        const S = A.sir, sp = spatial(car.x, car.z, 0.075);
        if (t > S.next) { S.hi = !S.hi; const f = S.hi ? 622 : 466; S.o.frequency.setValueAtTime(f, t); S.o2.frequency.setValueAtTime(f, t); S.next = t + 0.66; }
        S.g.gain.setTargetAtTime(sp.g, t, 0.15); if (S.pn) S.pn.pan.setTargetAtTime(sp.pan, t, 0.15);
      },
    };
  })();

  // ---------------------------------------------------------------- Tag / Nacht
  if (W.ctx && W.ctx.modeHooks) W.ctx.modeHooks.push((night) => { NIGHT.on = !!night; kit.setNight(NIGHT.on); });

  // ---------------------------------------------------------------- Start, sobald city.json da ist
  function setup(cj) {
    if (ready || !cj || !cj.edges) return;
    setupNet(cj);
    const parked = placeParked();
    const cap = TYPES.map((t, i) => parked.filter(p => p.ti === i).length + MAXMOV + 6);
    buildMeshes(cap);
    for (const p of parked) { const T = TYPES[p.ti]; const c = makeCar(p.ti, p.color || paintFor(rnd, T), p.x, p.z, p.yaw, 'park'); c.onLane = false; c.grp.matrixAutoUpdate = false; c.grp.updateMatrix(); c.grp.updateMatrixWorld(true); }
    // alten Platzhalter-Parker des Laden-Modells ausblenden (wird oben durch ein echtes Auto ersetzt)
    scene.traverse(o => { if (o.isGroup && o !== root && Math.abs(o.position.x - 21.5) < 0.01 && Math.abs(o.position.z - 8.9) < 0.01 && Math.abs(o.position.y + 0.14) < 0.01) o.visible = false; });
    updFrustum();
    for (let i = 0; i < MAXMOV; i++) spawnAI(true);
    buildExtra().catch(e => console.warn('traffic extras', e));
    fetch('city/city_vis.json').then(r => r.ok ? r.json() : null).then(v => { if (v && v.shelters) buildBusStops(v.shelters); }).catch(() => {});
    for (let i = 0; i < Math.ceil(MAXSMALL / 2); i++) spawnAI(true, { T: SMALL[i % 3 === 2 ? 1 : 0] });
    ready = true; flush();
    W.requestRender && W.requestRender();
  }
  if (W.city) setup(W.city); else if (window.__cityJSON) setup(window.__cityJSON);
  if (W.on) W.on('city', (cj) => setup(cj));

  // ---------------------------------------------------------------- pro Bild
  let spawnT = 0, nearChk = 0, blinkT = 0, ambT = 0, lodT = 0;
  function update(dt) {
    simT += dt;
    if (!ready) return false;
    dt = Math.min(dt, 0.05);
    updFrustum();
    const cam = camera.position;
    // KI: erst alle Blickpfade, dann fahren
    for (const c of cars) if (c.kind === 'ai' && c.path) sampleAhead(c);
    let moving = 0;
    for (const c of cars) {
      if (c.kind === 'ai' && c.leave) { leaveStep(c, dt); if (c.leave) { moving++; continue; } }
      if (c.kind === 'ai') {
        c.shotBrake = Math.max(0, c.shotBrake - dt); c.bump = Math.max(0, c.bump - dt);
        if (c.hijack && drive.pend === c) { const P = W.P; if (!P || Math.hypot(P.x - c.x, P.z - c.z) > 7) { c.hijack = false; drive.pend = null; } }
        driveAI(c, dt); moving++;
        if (c.hijack && c.v < 0.4 && drive.pend === c) takeCar(c);
        else writeCar(c);
      }
      if (c.hazard > 0) c.hazard -= dt;
      if (c.alarm > 0) { c.alarm -= dt; if (c.alarm <= 0) sfx.stopAlarm(c); }
      if (c.dirty) writeCar(c);
    }
    // aufräumen + nachfüllen
    spawnT -= dt;
    if (spawnT <= 0) {
      spawnT = 0.4;
      for (const c of cars.slice()) if (c.kind === 'ai' && !c.leave && c.path) {
        const d = Math.hypot(c.x - cam.x, c.z - cam.z), seen = d < 140 && inView(c.x, 1, c.z, c.T.L);
        if (!inRegion(c.x, c.z, 14) || (d > R_DESPAWN && !seen) || (c.path.ended && !c.parkTo && c.sF >= c.path.tail - 1.5) || (c.stuck > 45 && !seen)) { if (c.T.bus) busCount = Math.max(0, busCount - 1); removeCar(c); }
      }
      let n = cars.filter(c => c.kind === 'ai' && !c.small && !c.emerg && !c.T.bus).length; let k = 0;
      while (n < MAXMOV && k++ < 3) { if (spawnAI(false)) n++; else break; }
      if (smallCount < MAXSMALL && Math.random() < 0.5) spawnAI(false, { T: SMALL[Math.random() < 0.3 ? 1 : 0] });
    }
    // Buslinie (alle ~1 min), Einsatzfahrzeuge, Aus-/Einparken
    BUS.t -= dt; if (BUS.t <= 0) { BUS.t = (isMobile ? 70 : 55) + Math.random() * 25; if (busCount < (isMobile ? 1 : 2)) spawnAI(false, { bus: true }); }
    updateEmergency(dt);
    PARK.t -= dt;
    if (PARK.t <= 0) {
      PARK.t = (isMobile ? 45 : 32) + Math.random() * 25;
      const cand = cars.filter(c => c.kind === 'park' && !c.alarm && c.ti !== 6 && Math.hypot(c.x - cam.x, c.z - cam.z) < 70 && Math.hypot(c.x - cam.x, c.z - cam.z) > 12 && !(c.x > -14 && c.x < 27 && c.z < 12));
      if (cand.length) startLeave(cand[(Math.random() * cand.length) | 0]);
    }
    if (PARK.free.length) { tryPark(); PARK.free = PARK.free.filter(f => simT - f.t < 120); }
    for (const c of cars) { if (c.dwell || c.doorK) { const w = c.dwell && c.dwell.open ? 1 : 0; c.doorK = clamp((c.doorK || 0) + (w ? 1 : -1) * dt / 1.4, 0, 1); } }
    // Detailstufe nach Entfernung (mit Puffer)
    lodT -= dt;
    if (lodT <= 0) { lodT = 0.25; for (const c of cars) { if (c.kind === 'player' || c.small) continue; const d = Math.hypot(c.x - cam.x, c.z - cam.z), want = c.far ? d > LOD_D - 6 : d > LOD_D + 6; if (want !== c.far) { setFar(c, want); writeCar(c); } } }
    // Einsteigen-Knopf
    nearChk -= dt;
    if (nearChk <= 0 && !drive.car) {
      nearChk = 0.2; const P = W.P;
      nearCar = P && W.tp && W.tp.active && !W.tp.aim ? nearestCar(P.x, P.z, 2.2) : null;
      if (btnIn) btnIn.show(!!nearCar && !drive.pend);
    }
    pushPlayer();
    // Lichter
    blinkT += dt; const blinkOn = (blinkT % 0.8) < 0.42; LI = 0; PI = 0;
    for (const c of cars) {
      if (c.kind === 'park' && c.alarm <= 0 && c.hazard <= 0 && !(c.T.taxi && NIGHT.on) && !c.leave) continue;
      const dx = c.x - cam.x, dz = c.z - cam.z, d2 = dx * dx + dz * dz; if (d2 > 160 * 160) continue;
      if (!inView(c.x, 1, c.z, c.T.L + (NIGHT.on ? 9 : 1))) continue;
      carLights(c, blinkOn, NIGHT.on, d2 < 90 * 90);
    }
    meshes.lights.count = LI; meshes.pools.count = PI;
    if (LI) { meshes.lights.instanceMatrix.needsUpdate = true; meshes.lights.instanceColor.needsUpdate = true; }
    if (PI) { meshes.pools.instanceMatrix.needsUpdate = true; meshes.pools.instanceColor.needsUpdate = true; }
    meshes.pools.visible = PI > 0;
    decals.write();
    writeExtras(dt);
    const sp = updSparks(dt);
    flush();
    // Straßenlärm
    ambT -= dt; if (ambT <= 0) { ambT = 0.15; let lv = 0; for (const c of cars) if (c.kind === 'ai') { const d = Math.hypot(c.x - cam.x, c.z - cam.z); lv += (c.v / 14) / (1 + d * d / 120); } const inside = cam.z < -0.3 && cam.x > -11 && cam.x < 24; sfx.ambience(clamp(lv * 0.03, 0, 0.045) * (inside ? 0.3 : 1)); }
    // Test-Hilfen
    return moving > 0 || sp || cars.some(c => c.alarm > 0 || c.hazard > 0 || (c.emerg && c.emerg.lights));
  }

  // Für Tests in der Konsole
  window.__traffic = {
    cars, PDBG, get net() { return net; }, get simT() { return simT; }, signals: W.signals, drive, types: TYPES, meshes,
    busStops: BUS, cop: COP, spawnEmergency: (t, tg) => spawnEmergency(t || 'police', tg || null), spawnBike: (k) => spawnAI(true, { T: SMALL[k ? 1 : 0] }), spawnBus: () => spawnAI(true, { bus: true }), leaveOne: () => { const c = cars.find(q => q.kind === 'park' && Math.hypot(q.x - camera.position.x, q.z - camera.position.z) < 60); return c ? startLeave(c) : false; },
    stats() { const ai = cars.filter(c => c.kind === 'ai'); return { ai: ai.length, small: ai.filter(c => c.small).length, bus: ai.filter(c => c.T.bus).length, dwell: ai.filter(c => c.dwell).length, emerg: ai.filter(c => c.emerg).length, pull: ai.filter(c => c.pullK > 0.5).length, leaving: ai.filter(c => c.leave).length, parking: ai.filter(c => c.parkTo).length, stops: BUS.stops.length, park: cars.filter(c => c.kind === 'park').length, player: drive.car ? drive.car.id : 0, moving: ai.filter(c => c.v > 0.5).length, atRed: ai.filter(c => c.lim === 'sig' && c.v < 0.3).length, lights: meshes.lights ? meshes.lights.count : 0 }; },
    enterNearest() { const P = W.P; nearCar = nearestCar(P.x, P.z, 6); if (nearCar) { if (nearCar.kind === 'ai') { nearCar.v = 0; } takeCar(nearCar); return true; } return false; },
    exit() { requestExit(); },
    hitTest(i = 0, glassHit = true) { const c = cars.filter(q => q.kind === 'park')[i]; if (!c) return null; const p = new THREE.Vector3(c.T.W / 2 + 0.01, glassHit ? c.T.beltAt(0) + 0.2 : 0.6, 0).applyMatrix4(c.grp.matrixWorld); carHit(c, { point: p }); return { x: c.x, z: c.z, yaw: c.yaw }; },
  };
  return { update };
}
