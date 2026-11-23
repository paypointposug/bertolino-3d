// Innenraum Spätkauf + Bertolino (Müllerstraße 138 D) — three.js r170
// Koordinaten in Metern: x entlang Fassade, y oben, z zur Straße (+). Innenseite Außenwand z = −0.45.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// ------------------------------------------------------------------ layout constants
const ZI = -0.45;                       // inner face of facade wall
const OPEN_TOP = 2.35;                  // top edge of all storefront openings (facade update)
// NOTE: SPEC says ceiling 3.90 / back wall −11; the photo (innen.jpg) shows a lower ceiling (~3.5 m) and
// the fridge wall only ~3 m behind the Unterzug → photo wins.
const SP = { x0: 0.30, x1: 8.45, xP: 7.75, zB: -7.45, ceil: 3.50, zBk: -4.00, zFloor: -4.20, bY: 2.55, fz: -6.65 };
const KI = { x0: 7.75, xc: 8.45, x1: 12.0, zB: -2.90, ceil: 3.20 };
const OV = { x0: 10.40, x1: 12.0, z1: -5.50 };
const DOOR = { x0: 10.55, x1: 11.35, y1: 1.98 };
// light levels (point lights in candela, IBL factor for interior materials)
const LI = { sp: 4.2, k: 8.8, envN: 0.22, envD: 0.45 };

function rng32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

export function buildInterior(ctx) {
  const scene = ctx.scene;
  const isMobile = !!ctx.isMobile;
  const ANISO = Math.min(ctx.anisotropy || 4, isMobile ? 4 : 8);
  const tex = (n, o = {}) => { try { return ctx.tex ? ctx.tex(n, o) : null; } catch (e) { return null; } };
  const group = new THREE.Group(); group.name = 'interior';
  const R = rng32(20251122);
  const rr = (a, b) => a + (b - a) * R();
  const V3 = THREE.Vector3;

  // ------------------------------------------------------------------ helpers
  function canvasTex(w, h, draw, { srgb = true, wrap = false, rep = null } = {}) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); draw(g, w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = ANISO;
    if (wrap) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    if (rep) t.repeat.set(rep[0], rep[1]);
    return t;
  }
  const std = (color, rough = 0.8, metal = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
  const emisList = []; // [mat, nightFactor, dayFactor, baseColor]
  function glow(r, g, b, night = 1, day = 1) { const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(r * night, g * night, b * night) }); emisList.push([m, night, day, new THREE.Color(r, g, b)]); return m; }
  function screenMat(t, fallback, night = 1.0, day = 1.0) {
    const m = new THREE.MeshBasicMaterial(t ? { map: t, color: new THREE.Color(night, night, night) } : { color: new THREE.Color(fallback).multiplyScalar(night) });
    emisList.push([m, night, day, t ? new THREE.Color(1, 1, 1) : new THREE.Color(fallback)]); return m;
  }

  // geometry batching per material ------------------------------------------------
  const buckets = new Map();
  function prep(g) {
    if (g.index) g = g.toNonIndexed();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.clearGroups();
    return g;
  }
  function add(g, mat) { let b = buckets.get(mat); if (!b) { b = []; buckets.set(mat, b); } b.push(prep(g)); return g; }
  function quad(a, b, c, d, mat, u0 = 0, v0 = 0, u1 = 1, v1 = 1) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d], 3));
    const n = new V3().subVectors(new V3(...b), new V3(...a)).cross(new V3().subVectors(new V3(...d), new V3(...a))).normalize();
    g.setAttribute('normal', new THREE.Float32BufferAttribute([n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1], 2));
    if (mat) add(g, mat); return g;
  }
  // planes: s = uv scale (metres per texture repeat) or null for 0..1
  function wallX(x, z0, z1, y0, y1, face, mat, s = null, uo = 0) { // face +1 → normal +x
    const U = s ? [face > 0 ? -z1 / s + uo : z0 / s + uo, face > 0 ? -z0 / s + uo : z1 / s + uo, y0 / s, y1 / s] : [0, 1, 0, 1];
    if (face > 0) return quad([x, y0, z1], [x, y0, z0], [x, y1, z0], [x, y1, z1], mat, U[0], U[2], U[1], U[3]);
    return quad([x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0], mat, U[0], U[2], U[1], U[3]);
  }
  function wallZ(z, x0, x1, y0, y1, face, mat, s = null, uo = 0) { // face +1 → normal +z
    const U = s ? [face > 0 ? x0 / s + uo : -x1 / s + uo, face > 0 ? x1 / s + uo : -x0 / s + uo, y0 / s, y1 / s] : [0, 1, 0, 1];
    if (face > 0) return quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], mat, U[0], U[2], U[1], U[3]);
    return quad([x1, y0, z], [x0, y0, z], [x0, y1, z], [x1, y1, z], mat, U[0], U[2], U[1], U[3]);
  }
  function floorY(y, x0, x1, z0, z1, face, mat, s = null) { // face +1 → up
    const U = s ? [x0 / s, x1 / s, -z1 / s, -z0 / s] : [0, 1, 0, 1];
    if (face > 0) return quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], mat, U[0], U[2], U[1], U[3]);
    return quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], mat, U[0], U[2], U[1], U[3]);
  }
  function box(mat, x0, x1, y0, y1, z0, z1, m4 = null) {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0); g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    if (m4) g.applyMatrix4(m4); return add(g, mat);
  }
  function cyl(mat, rTop, rBot, h, seg, x, y, z, m4 = null, open = false) {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open); g.translate(x, y + h / 2, z);
    if (m4) g.applyMatrix4(m4); return add(g, mat);
  }
  function geoAt(g, mat, x, y, z, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    const m = new THREE.Matrix4().compose(new V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new V3(sx, sy, sz));
    g.applyMatrix4(m); return add(g, mat);
  }
  // separate meshes (textures / transparency)
  function mesh(g, mat, ro = 0) { const m = new THREE.Mesh(g, mat); if (ro) m.renderOrder = ro; group.add(m); return m; }
  function tplane(mat, w, h, x, y, z, ry = 0, ro = 0) { const g = new THREE.PlaneGeometry(w, h); const m = mesh(g, mat, ro); m.position.set(x, y, z); m.rotation.y = ry; return m; }

  // instancing ------------------------------------------------------------------------
  function instanced(geo, mat, list) { // list: [{m: Matrix4, c: Color|null}]
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((it, i) => { im.setMatrixAt(i, it.m); if (it.c) im.setColorAt(i, it.c); });
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere(); group.add(im); return im;
  }
  const I = (x, y, z, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0) => new THREE.Matrix4().compose(new V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new V3(sx, sy, sz));

  // ------------------------------------------------------------------ procedural textures
  const T = {};
  T.floorDark = canvasTex(512, 512, (g, w, h) => { // 2×2 tiles of 0.6 m (texture = 1.2 m)
    const r = rng32(5); g.fillStyle = '#2d2f31'; g.fillRect(0, 0, w, h);
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      const v = 70 + r() * 14 | 0; g.fillStyle = `rgb(${v},${v + 2},${v + 4})`; g.fillRect(i * 256 + 2, j * 256 + 2, 252, 252);
      for (let k = 0; k < 900; k++) { const a = r() * 0.09; g.fillStyle = r() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`; g.fillRect(i * 256 + 2 + r() * 250, j * 256 + 2 + r() * 250, 2 + r() * 5, 1 + r() * 3); }
      const gr = g.createLinearGradient(i * 256, j * 256, i * 256 + 256, j * 256 + 256); gr.addColorStop(0, 'rgba(255,255,255,0.05)'); gr.addColorStop(1, 'rgba(0,0,0,0.06)'); g.fillStyle = gr; g.fillRect(i * 256 + 2, j * 256 + 2, 252, 252);
    }
  }, { wrap: true });
  T.floorLight = canvasTex(512, 512, (g, w, h) => { // 4×4 tiles of 0.3 m
    const r = rng32(9); g.fillStyle = '#9d978d'; g.fillRect(0, 0, w, h);
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const v = 214 + r() * 12 | 0; g.fillStyle = `rgb(${v},${v - 5},${v - 14})`; g.fillRect(i * 128 + 2, j * 128 + 2, 124, 124);
      for (let k = 0; k < 160; k++) { g.fillStyle = `rgba(120,100,80,${r() * 0.08})`; g.fillRect(i * 128 + 2 + r() * 122, j * 128 + 2 + r() * 122, 2 + r() * 4, 2 + r() * 4); }
    }
  }, { wrap: true });
  T.floorKitchen = canvasTex(512, 512, (g, w, h) => { // 2×2 tiles 0.3 (texture 0.6 m)
    const r = rng32(13); g.fillStyle = '#1b1b1c'; g.fillRect(0, 0, w, h);
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      const v = 52 + r() * 10 | 0; g.fillStyle = `rgb(${v},${v},${v + 1})`; g.fillRect(i * 256 + 3, j * 256 + 3, 250, 250);
      for (let k = 0; k < 600; k++) { g.fillStyle = `rgba(255,255,255,${r() * 0.05})`; g.fillRect(i * 256 + 3 + r() * 246, j * 256 + 3 + r() * 246, 2, 2); }
    }
  }, { wrap: true });
  T.tileFallback = canvasTex(256, 256, (g, w, h) => { // 1×1 m: tiles 0.25 × 0.4
    g.fillStyle = '#b9b7b1'; g.fillRect(0, 0, w, h); const r = rng32(3);
    const tw = 64, th = 102.4;
    for (let y = 0; y < h; y += th) for (let x = 0; x < w; x += tw) { const v = 238 + r() * 10 | 0; g.fillStyle = `rgb(${v},${v},${v - 3})`; g.fillRect(x + 1.2, y + 1.2, tw - 2.4, th - 2.4); }
  }, { wrap: true });
  T.marble = canvasTex(512, 512, (g, w, h) => { // white marble with soft grey/gold veins (innen.jpg bistro table)
    const r = rng32(17); g.fillStyle = '#efece6'; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 5; k++) { const x = r() * w, y = r() * h, rad = 80 + r() * 120; const gr = g.createRadialGradient(x, y, 2, x, y, rad); gr.addColorStop(0, 'rgba(200,192,180,0.35)'); gr.addColorStop(1, 'rgba(200,192,180,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }
    const vein = (x, y, len, col, lw, blur) => { g.save(); g.filter = blur ? `blur(${blur}px)` : 'none'; g.strokeStyle = col; g.lineWidth = lw; g.lineCap = 'round'; g.beginPath(); g.moveTo(x, y);
      let a = r() * 6.28; for (let s2 = 0; s2 < len; s2++) { a += (r() - 0.5) * 0.7; const nx = x + Math.cos(a) * 26, ny = y + Math.sin(a) * 26; g.quadraticCurveTo((x + nx) / 2 + (r() - 0.5) * 10, (y + ny) / 2 + (r() - 0.5) * 10, nx, ny); x = nx; y = ny; } g.stroke(); g.restore(); };
    for (let k = 0; k < 7; k++) vein(r() * w, r() * h, 14, 'rgba(120,112,104,0.35)', 7, 4);
    for (let k = 0; k < 6; k++) vein(r() * w, r() * h, 12, 'rgba(170,130,70,0.45)', 4, 2);
    for (let k = 0; k < 10; k++) vein(r() * w, r() * h, 10, 'rgba(70,66,62,0.55)', 1.2, 0);
  });
  T.wood = canvasTex(512, 256, (g, w, h) => { // butcher block, strips along u
    const r = rng32(21); for (let y = 0; y < h; y += 16) {
      const v = r(); g.fillStyle = `rgb(${212 + v * 22 | 0},${178 + v * 22 | 0},${132 + v * 22 | 0})`; g.fillRect(0, y, w, 16);
      for (let k = 0; k < 30; k++) { g.fillStyle = `rgba(110,70,30,${r() * 0.12})`; g.fillRect(r() * w, y + r() * 16, 20 + r() * 80, 1); }
      g.fillStyle = 'rgba(80,50,20,0.25)'; g.fillRect(0, y, w, 1);
    }
  }, { wrap: true });
  T.woodPly = canvasTex(256, 256, (g, w, h) => { const r = rng32(23); g.fillStyle = '#cfa978'; g.fillRect(0, 0, w, h); for (let k = 0; k < 140; k++) { g.strokeStyle = `rgba(140,96,52,${0.08 + r() * 0.14})`; g.lineWidth = 1 + r() * 2; g.beginPath(); const y = r() * h; g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + (r() - 0.5) * 14, w * 0.6, y + (r() - 0.5) * 14, w, y + (r() - 0.5) * 10); g.stroke(); } }, { wrap: true });
  T.terrazzo = canvasTex(256, 256, (g, w, h) => { const r = rng32(29); g.fillStyle = '#e6e2da'; g.fillRect(0, 0, w, h); for (let k = 0; k < 1400; k++) { const v = 60 + r() * 120 | 0; g.fillStyle = `rgba(${v},${v - 4},${v - 8},${0.35 + r() * 0.5})`; const s = 0.8 + r() * 2.6; g.fillRect(r() * w, r() * h, s, s * (0.6 + r())); } }, { wrap: true });
  T.granite = canvasTex(256, 256, (g, w, h) => { const r = rng32(31); g.fillStyle = '#1c1c1e'; g.fillRect(0, 0, w, h); for (let k = 0; k < 2600; k++) { const v = 40 + r() * 90 | 0; g.fillStyle = `rgba(${v},${v},${v + 4},${r() * 0.7})`; g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); } }, { wrap: true });
  T.pizzaBox = canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = '#8f6c49'; g.fillRect(0, 0, w, h); const r = rng32(37);
    for (let k = 0; k < 400; k++) { g.fillStyle = `rgba(60,36,18,${r() * 0.12})`; g.fillRect(r() * w, r() * h, 2, 1); }
    g.fillStyle = 'rgba(40,22,12,0.85)'; g.font = 'bold 22px sans-serif'; g.textBaseline = 'middle'; g.fillText('PIZZA', 150, h / 2 + 2);
    g.font = 'italic 15px serif'; g.fillText('Buon Appetito', 26, h / 2 + 2);
    g.fillStyle = 'rgba(30,18,10,0.55)'; g.fillRect(0, 0, w, 3); g.fillRect(0, h - 3, w, 3);
  });
  T.label = canvasTex(64, 64, (g, w, h) => { // product box label (multiplied by instance colour)
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, w, 9); g.fillStyle = '#f4f4f4'; g.fillRect(0, 22, w, 20);
    g.fillStyle = '#9a9a9a'; g.fillRect(10, 27, 44, 4); g.fillRect(14, 34, 36, 3); g.fillStyle = '#bdbdbd'; g.fillRect(0, h - 6, w, 6);
  });
  T.can = canvasTex(64, 64, (g, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); g.fillStyle = '#cfcfcf'; g.fillRect(0, 0, w, 6); g.fillRect(0, h - 6, w, 6); g.fillStyle = '#e9e9e9'; g.fillRect(0, 24, w, 14); g.fillStyle = '#a0a0a0'; g.fillRect(6, 28, 30, 5); });
  T.ribs = canvasTex(64, 256, (g, w, h) => { for (let y = 0; y < h; y++) { const v = 128 + 120 * Math.sin(y / h * Math.PI * 2 * 16) | 0; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(0, y, w, 1); } }, { srgb: false, wrap: true });
  T.spiral = canvasTex(256, 64, (g, w, h) => { g.fillStyle = '#808080'; g.fillRect(0, 0, w, h); g.strokeStyle = '#ffffff'; g.lineWidth = 3; for (let x = -h; x < w + h; x += 21) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + h * 0.35, h); g.stroke(); } }, { srgb: false, wrap: true });
  T.lamella = canvasTex(256, 64, (g, w, h) => { g.fillStyle = '#2a2b2d'; g.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 8) { const gr = g.createLinearGradient(x, 0, x + 8, 0); gr.addColorStop(0, '#6d7074'); gr.addColorStop(0.5, '#b4b7ba'); gr.addColorStop(1, '#3b3d40'); g.fillStyle = gr; g.fillRect(x, 0, 6, h); } g.fillStyle = '#9da0a3'; g.fillRect(0, 0, w, 4); g.fillRect(0, h - 4, w, 4); g.fillRect(w / 2 - 2, 0, 4, h); });
  T.chain = canvasTex(256, 512, (g, w, h) => { // bead / chain curtain with alpha
    g.clearRect(0, 0, w, h); const r = rng32(41);
    for (let x = 3; x < w; x += 6.2) {
      const sway = (r() - 0.5) * 4; const bunch = x < 70 ? (70 - x) * 0.9 : 0;
      for (let y = 0; y < h; y += 5) {
        const t = y / h; const xx = x - bunch * Math.sin(t * Math.PI * 0.95) + sway * t;
        const gr = g.createRadialGradient(xx - 0.6, y - 0.6, 0.2, xx, y, 2.4); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(170,175,180,0.95)'); gr.addColorStop(1, 'rgba(70,72,76,0.0)');
        g.fillStyle = gr; g.beginPath(); g.arc(xx, y, 2.3, 0, Math.PI * 2); g.fill();
      }
    }
  });
  T.kasseSign = canvasTex(256, 168, (g, w, h) => { g.fillStyle = '#f7f7f4'; g.fillRect(0, 0, w, h); g.strokeStyle = '#222'; g.lineWidth = 5; g.strokeRect(10, 10, w - 20, h - 20); g.fillStyle = '#151515'; g.font = 'bold 66px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('KASSE', w / 2, h / 2 + 4); g.beginPath(); g.moveTo(24, h / 2); g.lineTo(44, h / 2 - 14); g.lineTo(44, h / 2 + 14); g.fill(); });
  T.preise = canvasTex(128, 180, (g, w, h) => { g.fillStyle = '#fbfbf8'; g.fillRect(0, 0, w, h); g.fillStyle = '#222'; g.font = 'bold 16px sans-serif'; g.fillText('PREISE', 30, 22); g.font = '9px sans-serif'; for (let i = 0; i < 14; i++) { g.fillRect(12, 36 + i * 10, 58 + (i * 37 % 30), 2); g.fillRect(96, 36 + i * 10, 18, 2); } });
  T.cafeNeon = canvasTex(256, 96, (g, w, h) => { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); g.shadowColor = '#ff3df0'; g.shadowBlur = 14; g.strokeStyle = '#ffb0ff'; g.lineWidth = 4; g.font = 'italic bold 54px sans-serif'; g.strokeText('Café', 92, 66); g.beginPath(); g.arc(46, 52, 18, 0, Math.PI); g.stroke(); g.strokeRect(28, 34, 36, 18); });
  T.posters = canvasTex(256, 256, (g, w, h) => { const r = rng32(43); g.fillStyle = '#8e9194'; g.fillRect(0, 0, w, h); for (let k = 0; k < 6; k++) { const x = 10 + r() * 180, y = 10 + r() * 170; g.fillStyle = '#f4f3ef'; g.fillRect(x, y, 50 + r() * 20, 66 + r() * 16); g.fillStyle = '#555'; for (let l = 0; l < 7; l++) g.fillRect(x + 6, y + 10 + l * 8, 36 + r() * 16, 2); } });
  T.pizzaFallback = canvasTex(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h); g.fillStyle = '#d7a868'; g.beginPath(); g.arc(128, 128, 124, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#c0392b'; g.beginPath(); g.arc(128, 128, 104, 0, Math.PI * 2); g.fill();
    const r = rng32(47); for (let k = 0; k < 40; k++) { g.fillStyle = `rgba(250,236,200,${0.6 + r() * 0.4})`; g.beginPath(); g.arc(128 + (r() - 0.5) * 170, 128 + (r() - 0.5) * 170, 6 + r() * 12, 0, Math.PI * 2); g.fill(); }
    for (let k = 0; k < 14; k++) { g.fillStyle = '#9c2a1c'; g.beginPath(); g.arc(128 + (r() - 0.5) * 160, 128 + (r() - 0.5) * 160, 10, 0, Math.PI * 2); g.fill(); }
  });
  T.fridgeFallback = canvasTex(128, 360, (g, w, h) => {
    g.fillStyle = '#eef3f6'; g.fillRect(0, 0, w, h); const r = rng32(53);
    const cols = ['#c8102e', '#1f6f2a', '#f2b600', '#0b4ea2', '#e86a10', '#6b2b14', '#e8e8e8', '#9b1b8a'];
    for (let s = 0; s < 6; s++) { const y0 = 14 + s * 56; g.fillStyle = '#b9c0c4'; g.fillRect(0, y0 + 50, w, 3); for (let x = 4; x < w - 8; x += 11) { g.fillStyle = cols[(r() * cols.length) | 0]; const bh = 30 + r() * 16; g.fillRect(x, y0 + 50 - bh, 9, bh); g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x + 1, y0 + 50 - bh, 2, bh); } }
    g.strokeStyle = '#d9dde0'; g.lineWidth = 6; g.strokeRect(0, 0, w, h);
  });
  T.shelfFallback = canvasTex(256, 384, (g, w, h) => {
    const r = rng32(59); g.fillStyle = '#e6e6e2'; g.fillRect(0, 0, w, h);
    const cols = ['#d62828', '#f77f00', '#fcbf49', '#003049', '#2a9d8f', '#e9c46a', '#264653', '#8338ec', '#ff006e', '#3a86ff', '#6a994e', '#bc4749'];
    for (let s = 0; s < 6; s++) { const y0 = 6 + s * 63; g.fillStyle = '#c9c9c6'; g.fillRect(0, y0 + 56, w, 6); let x = 2; while (x < w - 4) { const bw = 10 + r() * 22; const bh = 26 + r() * 26; g.fillStyle = cols[(r() * cols.length) | 0]; g.fillRect(x, y0 + 56 - bh, bw - 2, bh); g.fillStyle = 'rgba(255,255,255,0.4)'; g.fillRect(x + 2, y0 + 56 - bh + 4, bw - 6, 5); x += bw; } }
  });

  // ---- stock atlas: 4×4 cells, each cell = 0.40 × 0.40 m of real packaging (shrink-wrapped can trays, cartons,
  // retail facings, bottle packs). Replaces the old flat coloured blocks (looked like toy bricks).
  const STK = { S: 0.40, trayBlue: 0, trayBlack: 1, trayRed: 2, trayOrange: 3, carton: 4, cartonPrint: 5, cartonWhite: 6, cartonDark: 7, packA: 8, packB: 9, packC: 10, packD: 11, water: 12, trayGreen: 13, trayMix: 14, packE: 15 };
  T.stock = canvasTex(1024, 1024, (g) => {
    const r = rng32(777), C = 256, ppm = C / STK.S;
    const cell = (i, fn) => { const x0 = (i % 4) * C, y0 = Math.floor(i / 4) * C; g.save(); g.beginPath(); g.rect(x0, y0, C, C); g.clip(); g.translate(x0, y0); fn(); g.restore(); };
    const shadeCol = (hex, k) => { const c = new THREE.Color(hex).multiplyScalar(k); return `rgb(${Math.min(255, c.r * 255) | 0},${Math.min(255, c.g * 255) | 0},${Math.min(255, c.b * 255) | 0})`; };
    function can(x, y, w, h, body, deco) { // vertical cylinder, lit from front-left
      for (let i = 0; i < w; i++) { const n = (i + 0.5) / w * 2 - 1, k = 0.42 + 0.58 * Math.sqrt(1 - n * n); g.fillStyle = shadeCol(body, k); g.fillRect(x + i, y, 1, h); }
      if (deco) deco(x, y, w, h);
      const sp = g.createLinearGradient(x, 0, x + w, 0); sp.addColorStop(0, 'rgba(255,255,255,0)'); sp.addColorStop(0.28, 'rgba(255,255,255,0.0)'); sp.addColorStop(0.34, 'rgba(255,255,255,0.55)'); sp.addColorStop(0.42, 'rgba(255,255,255,0)'); sp.addColorStop(1, 'rgba(0,0,0,0.12)');
      g.fillStyle = sp; g.fillRect(x, y, w, h);
      g.fillStyle = 'rgba(205,208,212,1)'; g.fillRect(x + 1, y, w - 2, 3); g.fillStyle = 'rgba(120,122,126,1)'; g.fillRect(x + 2, y + 3, w - 4, 1);
    }
    function tray(body, band, deco, cansAcross = 6) { // 3 layers of shrink-wrapped 24-can trays
      g.fillStyle = '#1b1c1e'; g.fillRect(0, 0, C, C);
      const LH = 0.133 * ppm, BH = 0.034 * ppm, cw = C / cansAcross;
      for (let L = 0; L < 3; L++) {
        const yb = C - L * LH;
        for (let k = 0; k < cansAcross; k++) can(k * cw + 0.5, yb - LH + 2, cw - 1, LH - BH - 2, body, deco);
        g.fillStyle = band; g.fillRect(0, yb - BH, C, BH);
        g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(8 + r() * 60, yb - BH * 0.62, 50 + r() * 50, 3); g.fillRect(140 + r() * 40, yb - BH * 0.62, 30 + r() * 40, 3);
        g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, yb - BH, C, 1);
      }
      // shrink film: milky wash + diagonal glints + crumpled edges
      g.fillStyle = 'rgba(235,240,245,0.07)'; g.fillRect(0, 0, C, C);
      for (let k = 0; k < 9; k++) { g.strokeStyle = `rgba(255,255,255,${0.08 + r() * 0.18})`; g.lineWidth = 1 + r() * 3; g.beginPath(); const x = r() * C; g.moveTo(x, r() * C); g.lineTo(x + 30 + r() * 60, r() * C); g.stroke(); }
    }
    function carton(base, print, label) {
      g.fillStyle = base; g.fillRect(0, 0, C, C);
      for (let k = 0; k < 2500; k++) { g.fillStyle = r() < 0.5 ? `rgba(255,255,255,${r() * 0.05})` : `rgba(60,40,20,${r() * 0.07})`; g.fillRect(r() * C, r() * C, 1 + r() * 3, 1); }
      for (let y = 0; y < C; y += 3) { g.fillStyle = 'rgba(0,0,0,0.025)'; g.fillRect(0, y, C, 1); }
      // box edges every ~0.32 m (several boxes per cell), tape band
      for (const yy of [C * 0.22, C * 0.62]) { g.fillStyle = 'rgba(40,25,10,0.35)'; g.fillRect(0, yy, C, 2); g.fillStyle = 'rgba(230,215,180,0.35)'; g.fillRect(0, yy - 9, C, 7); }
      g.fillStyle = 'rgba(40,25,10,0.3)'; g.fillRect(C * 0.48, 0, 2, C);
      if (print) for (const [x, y] of [[18, C * 0.3], [C * 0.55, C * 0.7], [24, C * 0.75]]) {
        g.fillStyle = print; g.fillRect(x, y, 78, 34); g.fillStyle = 'rgba(255,255,255,0.85)'; g.font = 'bold 15px sans-serif'; g.fillText(label, x + 6, y + 22, 66);
        g.fillStyle = 'rgba(30,20,10,0.55)'; for (let l = 0; l < 3; l++) g.fillRect(x, y + 40 + l * 7, 50 + r() * 40, 2);
      }
      g.fillStyle = 'rgba(25,20,15,0.7)'; for (let b = 0; b < 26; b++) g.fillRect(C * 0.62 + b * 2.2, C * 0.36, r() < 0.5 ? 1 : 2, 16);
    }
    function facings(pal) { // shelf product facings (various packs) 5 columns × 2 rows
      g.fillStyle = '#2a2b2d'; g.fillRect(0, 0, C, C);
      for (let row = 0; row < 2; row++) {
        let x = 0; const yb = C - row * C / 2;
        while (x < C) {
          const w = 30 + r() * 34, h = 70 + r() * 50, col = pal[(r() * pal.length) | 0];
          const y0 = yb - h; g.fillStyle = col; g.fillRect(x + 1, y0, w - 2, h);
          const gr = g.createLinearGradient(x, 0, x + w, 0); gr.addColorStop(0, 'rgba(0,0,0,0.25)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.10)'); gr.addColorStop(1, 'rgba(0,0,0,0.3)'); g.fillStyle = gr; g.fillRect(x + 1, y0, w - 2, h);
          g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.8)' : 'rgba(250,235,190,0.8)'; g.fillRect(x + 4, y0 + h * 0.3, w - 8, h * 0.22);
          g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(x + 7, y0 + h * 0.35, w * 0.5, 3); g.fillRect(x + 7, y0 + h * 0.43, w * 0.35, 2);
          g.fillStyle = pal[(r() * pal.length) | 0]; g.beginPath(); g.arc(x + w / 2, y0 + h * 0.7, Math.min(w, h) * 0.17, 0, 7); g.fill();
          g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(x + 3, y0 + 2, 2, h - 4);
          x += w;
        }
        g.fillStyle = '#c9ccce'; g.fillRect(0, yb - 4, C, 4); g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(0, yb - C / 2, C, 3);
      }
    }
    const redBull = (x, y, w, h) => { g.fillStyle = 'rgba(205,212,220,0.85)'; for (let i = 0; i < w; i += 2) { g.fillRect(x + i, y, 1, h * 0.48); } g.fillStyle = 'rgba(200,30,40,0.9)'; g.beginPath(); g.arc(x + w / 2, y + h * 0.5, w * 0.16, 0, 7); g.fill(); g.fillStyle = 'rgba(240,190,30,0.9)'; g.fillRect(x + w * 0.3, y + h * 0.66, w * 0.4, 3); };
    const claw = (x, y, w, h) => { g.strokeStyle = 'rgba(120,220,60,0.85)'; g.lineWidth = 2; for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(x + w * (0.3 + k * 0.17), y + h * 0.18); g.lineTo(x + w * (0.25 + k * 0.17), y + h * 0.78); g.stroke(); } };
    const wave = (x, y, w, h) => { g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 3; g.beginPath(); g.moveTo(x, y + h * 0.62); g.bezierCurveTo(x + w * 0.4, y + h * 0.4, x + w * 0.6, y + h * 0.8, x + w, y + h * 0.55); g.stroke(); };
    const label = (c) => (x, y, w, h) => { g.fillStyle = c; g.fillRect(x, y + h * 0.3, w, h * 0.35); g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(x + w * 0.2, y + h * 0.45, w * 0.6, 2); };
    cell(STK.trayBlue, () => tray(0x2a3f8f, '#22357a', redBull));
    cell(STK.trayBlack, () => tray(0x161718, '#111214', claw));
    cell(STK.trayRed, () => tray(0xb0121a, '#a81019', wave));
    cell(STK.trayOrange, () => tray(0xe07a12, '#1f5aa6', label('rgba(30,90,170,0.9)')));
    cell(STK.trayGreen, () => tray(0x1f6a33, '#e9e6dc', label('rgba(240,238,230,0.95)')));
    cell(STK.trayMix, () => tray(0xd9dbdd, '#c7262d', label('rgba(200,30,40,0.9)')));
    cell(STK.carton, () => carton('#b38d61', '#7a2a24', 'SNACK'));
    cell(STK.cartonPrint, () => carton('#b08a5c', '#25476e', 'DRINKS'));
    cell(STK.cartonWhite, () => carton('#d9d6cf', '#2f6b3a', 'BIO'));
    cell(STK.cartonDark, () => carton('#8c6a45', null, ''));
    cell(STK.packA, () => facings(['#8d1d1f', '#c9a227', '#1d3a6b', '#e6e1d6', '#5b3a24', '#2f6b3a']));
    cell(STK.packB, () => facings(['#b5462a', '#e0c068', '#3b2a20', '#f0ede6', '#7a1f3d', '#2b4c7e']));
    cell(STK.packC, () => facings(['#264d73', '#d4d0c4', '#9e2a2b', '#e1a23a', '#3e5c35', '#59328a']));
    cell(STK.packD, () => facings(['#d8c9a3', '#6f4a2b', '#a33a2a', '#2d2d2f', '#c79a3b', '#ece7dc']));
    cell(STK.packE, () => facings(['#e6d34a', '#c7262d', '#f2f0ea', '#1f5aa6', '#e07a12', '#3d8b3d']));
    cell(STK.water, () => { // 6-packs of 1.5 l water bottles in film
      g.fillStyle = '#9fb0bc'; g.fillRect(0, 0, C, C);
      for (let L = 0; L < 2; L++) { const yb = C - L * 0.2 * ppm; for (let k = 0; k < 3; k++) { const x = 6 + k * 82; g.fillStyle = 'rgba(205,225,240,0.95)'; g.fillRect(x, yb - 120, 72, 118); g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(x + 12, yb - 116, 8, 110); g.fillStyle = '#1f5aa6'; g.fillRect(x + 4, yb - 72, 64, 26); g.fillStyle = '#fff'; g.fillRect(x + 14, yb - 64, 40, 6); g.fillStyle = '#2f73c9'; g.fillRect(x + 28, yb - 128, 16, 8); } }
      g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, 0, C, C);
    });
  });
  T.stock.anisotropy = ANISO;
  function stockBox(cell, x, y, z, w, h, d, ry = 0, rz = 0) { // y = bottom; atlas-mapped box (one shared material → one draw call)
    const g = new THREE.BoxGeometry(w, h, d); const uv = g.attributes.uv;
    const cu = (cell % 4) / 4, cv = 1 - (Math.floor(cell / 4) + 1) / 4, ins = 0.012;
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) {
      const sw = Math.min(1 - 2 * ins, dims[f][0] / STK.S), sh = Math.min(1 - 2 * ins, dims[f][1] / STK.S);
      const ou = ins + R() * (1 - 2 * ins - sw), ov = (f === 2 || f === 3) ? ins + R() * (1 - 2 * ins - sh) : ins;
      for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, cu + (ou + uv.getX(i) * sw) / 4, cv + (ov + uv.getY(i) * sh) / 4); }
    }
    g.translate(0, h / 2, 0); geoAt(g, M.stock, x, y, z, ry, 0, rz);
  }
  const trayCells = [STK.trayBlue, STK.trayBlack, STK.trayRed, STK.trayOrange, STK.trayGreen, STK.trayMix];
  const cartonCells = [STK.carton, STK.cartonPrint, STK.cartonWhite, STK.cartonDark];
  const packCells = [STK.packA, STK.packB, STK.packC, STK.packD, STK.packE];

  // ------------------------------------------------------------------ materials
  const M = {
    wallLight: std(0xd3d7d9, 0.92),
    wallGrey: std(0x8b8e91, 0.9),
    wallWhite: std(0xefeeeb, 0.92),
    ceiling: std(0xdedfdf, 0.95),
    ceilingK: std(0xf6eee2, 0.95),
    floorDark: std(0xffffff, 0.45, 0, { map: T.floorDark }),
    floorLight: std(0xffffff, 0.4, 0, { map: T.floorLight }),
    floorK: std(0xffffff, 0.55, 0, { map: T.floorKitchen }),
    steel: std(0xbfc2c5, 0.32, 1.0),
    steelB: std(0xb2b5b8, 0.42, 1.0),
    steelD: std(0x8f9296, 0.45, 0.9),
    alu: std(0xcfd2d4, 0.38, 0.95),
    black: std(0x161718, 0.55, 0.1),
    blackG: std(0x08090a, 0.22, 0.4),
    darkGrey: std(0x3b3d40, 0.6, 0.2),
    whiteP: std(0xf1f1ee, 0.5),
    whiteFr: std(0xe8e9e7, 0.45, 0.1),
    red: std(0xc41f28, 0.5),
    blue: std(0x1d4fb4, 0.45, 0.2),
    wood: std(0xffffff, 0.55, 0, { map: T.wood }),
    woodPly: std(0xffffff, 0.6, 0, { map: T.woodPly }),
    shelfWood: std(0xc9a77a, 0.6),
    granite: std(0xffffff, 0.22, 0.05, { map: T.granite }),
    terrazzo: std(0xffffff, 0.45, 0, { map: T.terrazzo }),
    marble: std(0xffffff, 0.18, 0, { map: T.marble }),
    cardboard: std(0xffffff, 0.85, 0, { map: T.pizzaBox }),
    kraft: std(0xa47b52, 0.85),
    rubber: std(0x111111, 0.8),
    grout: std(0x4b4d50, 0.9),
    velvet: new THREE.MeshPhysicalMaterial({ color: 0x6f6a63, roughness: 0.95, sheen: 0.5, sheenRoughness: 0.5, sheenColor: new THREE.Color(0x8a847b) }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xe6eff0, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.2 }),
    glassTop: new THREE.MeshPhysicalMaterial({ color: 0xd8ece6, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide }),
    acrylic: new THREE.MeshPhysicalMaterial({ color: 0xf4f7f8, roughness: 0.06, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, clearcoat: 1, clearcoatRoughness: 0.05, emissive: 0xffffff, emissiveIntensity: 0.32 }),
    lidGlass: new THREE.MeshPhysicalMaterial({ color: 0xe8f0f2, roughness: 0.04, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide, clearcoat: 1, clearcoatRoughness: 0.03 }),
    pumpkin: std(0xa85a26, 0.62), // muscat pumpkin: muted brown-orange (kueche.jpg)
    stem: std(0x5d4a2a, 0.8),
    plasticW: std(0xf4f4f2, 0.45),
    bucketG: std(0x7cc243, 0.5),
    duct: std(0xc8ccd0, 0.42, 1.0, { bumpMap: T.ribs, bumpScale: 1.2 }),
    spiral: std(0xc9cdd1, 0.32, 1.0, { bumpMap: T.spiral, bumpScale: 0.8 }),
    lamella: std(0xffffff, 0.5, 0.35, { map: T.lamella }),
    chairLeg: std(0x1d1e20, 0.45, 0.6),
    panGrey: std(0x8e9194, 0.5, 0.3),
    tubeOff: std(0xeef0f0, 0.3, 0.0),
    stock: std(0xffffff, 0.62, 0, { map: T.stock }),
  };
  // brushed stainless for the hoods (kueche.jpg: bright, satin, warm reflections — not dark grey)
  T.brushed = canvasTex(256, 256, (g, w, h) => { const r = rng32(71); g.fillStyle = '#d2d5d8'; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 900; k++) { const v = r() < 0.5 ? 255 : 120; g.fillStyle = `rgba(${v},${v},${v},${0.04 + r() * 0.08})`; g.fillRect(r() * w, r() * h, 20 + r() * 140, 1); }
    for (let k = 0; k < 6; k++) { const x = r() * w, y = r() * h, gr = g.createRadialGradient(x, y, 2, x, y, 30 + r() * 50); gr.addColorStop(0, 'rgba(150,145,135,0.12)'); gr.addColorStop(1, 'rgba(150,145,135,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); } }, { wrap: true });
  M.hood = new THREE.MeshStandardMaterial({ color: 0xf4f5f6, map: T.brushed, roughness: 0.36, metalness: 0.9 }); M.hood.userData.envK = 4.2;
  M.steel.userData.envK = 3.6; M.steelB.userData.envK = 3.4;
  // tiles (photo texture or fallback)
  const tileT = tex('tile_white.jpg', { wrap: true, repeat: [1, 1] });
  M.tiles = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: tileT || T.tileFallback, roughness: 0.32, clearcoat: 0.35, clearcoatRoughness: 0.2 });
  if (tileT) tileT.anisotropy = ANISO;

  // emissive / light fixtures
  const E = {
    tube: glow(1.0, 1.0, 1.04, 3.0, 2.6),
    tubeDim: glow(0.9, 0.93, 1.0, 2.2, 1.6),
    down: glow(1.0, 0.93, 0.82, 4.2, 3.0),
    fridgeLed: glow(0.9, 0.95, 1.0, 3.0, 2.2),
    oven: glow(1.0, 0.46, 0.14, 2.6, 2.0),
    ovenDim: glow(1.0, 0.55, 0.22, 0.9, 0.7),
    pendant: glow(1.0, 0.98, 0.95, 0.8, 0.85),
    displayLed: glow(0.95, 0.98, 1.0, 0.35, 0.4),
    chestLamp: glow(1.0, 0.9, 0.72, 2.2, 1.6),
    neonPink: null,
  };

  // ================================================================ SHELL: floors, ceilings, walls
  // floors
  floorY(0.002, SP.x0, SP.xP, SP.zFloor, ZI, 1, M.floorDark, 1.2);
  floorY(0.002, SP.xP, SP.x1, SP.zFloor, KI.zB, 1, M.floorDark, 1.2);
  floorY(0.002, SP.x0, SP.x1, SP.zB, SP.zFloor, 1, M.floorLight, 1.2);
  floorY(0.002, KI.x0, KI.x1, KI.zB, ZI, 1, M.floorK, 0.6);
  floorY(0.002, OV.x0, OV.x1, OV.z1, KI.zB, 1, M.floorK, 0.6);
  box(M.grout, SP.x0, SP.x1, 0, 0.003, SP.zFloor - 0.01, SP.zFloor + 0.01); // threshold strip
  // ceilings
  // ceilings get a baked 'bounce' glow (emissive map) around the lit tubes / downlights — innen.jpg shows an evenly
  // light-grey ceiling, kueche.jpg a warm cream ceiling; spot lights alone leave them dark.
  const worldUV = (g, X0, X1, Z0, Z1) => { const p = g.attributes.position, uv = g.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) - X0) / (X1 - X0), (p.getZ(i) - Z0) / (Z1 - Z0)); return g; };
  const glowTex = (X0, X1, Z0, Z1, base, items) => canvasTex(512, Math.round(512 * (Z1 - Z0) / (X1 - X0)), (g, w, h) => {
    const sx = w / (X1 - X0), sz = h / (Z1 - Z0); g.fillStyle = `rgb(${base},${base},${base})`; g.fillRect(0, 0, w, h);
    // soft falloff built from stacked, growing shapes (no ctx.filter → identical on iOS Safari < 18)
    const N = 14;
    for (const it of items) {
      g.save(); g.fillStyle = '#fff';
      for (let k = N; k >= 0; k--) {
        const e = it.blur * (k / N) * 1.6, a = it.a * (1 - k / N) ** 1.6; g.globalAlpha = Math.min(1, a / N * 3.2);
        if (it.r) { const R2 = it.r * 0.6 + e; g.beginPath(); g.arc((it.x - X0) * sx, h - (it.z - Z0) * sz, R2 * sx, 0, 7); g.fill(); }
        else g.fillRect((it.x0 + 0.2 - e - X0) * sx, h - (it.z1 - 0.25 + e - Z0) * sz, (it.x1 - it.x0 - 0.4 + 2 * e) * sx, (it.z1 - it.z0 - 0.5 + 2 * e) * sz);
      }
      g.restore();
    }
  }, { srgb: false });
  const tubeGlow = (x0, x1, z0, z1, a = 0.85) => ({ x0: x0 - 0.25, x1: x1 + 0.25, z0: z0 - 0.35, z1: z1 + 0.35, blur: 0.45, a });
  const spGlow = glowTex(SP.x0, SP.x1, SP.zB, ZI, 70, [
    tubeGlow(0.33, 1.64, -2.85, -2.85), tubeGlow(2.98, 4.27, -2.85, -2.85), tubeGlow(4.29, 5.62, -2.85, -2.85), tubeGlow(1.65, 2.96, -2.85, -2.85, 0.35), tubeGlow(5.63, 7.03, -2.85, -2.85, 0.35),
    tubeGlow(0.75, 7.2, -1.1, -1.1, 0.7), tubeGlow(7.62, 7.62, -3.75, -0.75, 0.75), tubeGlow(0.6, 8.05, -5.0, -5.0, 0.8), tubeGlow(0.6, 8.05, -6.2, -6.2, 0.8),
    { x: 4.6, z: -1.85, r: 0.5, blur: 0.4, a: 0.25 }]);
  const kGlow = glowTex(KI.x0, KI.x1, OV.z1, ZI, 85, [
    { x: 9.3, z: -1.9, r: 0.55, blur: 0.5, a: 0.9 }, { x: 10.6, z: -1.9, r: 0.55, blur: 0.5, a: 0.9 }, { x: 9.0, z: -2.55, r: 0.35, blur: 0.35, a: 0.7 }, { x: 10.2, z: -2.55, r: 0.35, blur: 0.35, a: 0.7 },
    { x: 11.4, z: -2.3, r: 0.5, blur: 0.45, a: 0.85 }, { x: 11.2, z: -1.55, r: 0.35, blur: 0.35, a: 0.7 }, { x: 11.2, z: -3.8, r: 0.9, blur: 0.6, a: 0.6 }]);
  M.ceiling.emissive.set(0xdfe3e6); M.ceiling.emissiveMap = spGlow; emisList.push([M.ceiling, 0.62, 0.5, null]);
  M.ceilingK.emissive.set(0xffe2bd); M.ceilingK.emissiveMap = kGlow; emisList.push([M.ceilingK, 0.78, 0.5, null]);
  // walls facing away from the down-pointing spots would go nearly black; a faint bounce term keeps them readable
  M.wallGrey.emissive.set(0x3a3c3e); M.wallLight.emissive.set(0x3c3f41); M.wallWhite.emissive.set(0x403f3c);
  for (const m of [M.wallGrey, M.wallLight, M.wallWhite]) emisList.push([m, 0.55, 0.35, null]);
  add(worldUV(floorY(SP.ceil, SP.x0, SP.xP, SP.zB, ZI, -1, null), SP.x0, SP.x1, SP.zB, ZI), M.ceiling);
  add(worldUV(floorY(SP.ceil, SP.xP, SP.x1, SP.zB, KI.zB, -1, null), SP.x0, SP.x1, SP.zB, ZI), M.ceiling);
  add(worldUV(floorY(KI.ceil, KI.x0, KI.x1, KI.zB, ZI, -1, null), KI.x0, KI.x1, OV.z1, ZI), M.ceilingK);
  add(worldUV(floorY(KI.ceil, OV.x0, OV.x1, OV.z1, KI.zB, -1, null), KI.x0, KI.x1, OV.z1, ZI), M.ceilingK);
  wallX(KI.x0, KI.zB, ZI, KI.ceil, SP.ceil, -1, M.wallWhite);           // step between ceilings
  wallZ(KI.zB, KI.x0, SP.x1, KI.ceil, SP.ceil, -1, M.wallWhite);
  const bandY = SP.ceil - 0.21; // white band under ceiling (as on Unterzug)
  // left wall
  wallX(SP.x0, SP.zB, ZI, 0, bandY, 1, M.wallLight);
  wallX(SP.x0, SP.zB, ZI, bandY, SP.ceil, 1, M.wallWhite);
  box(M.whiteP, SP.x0, SP.x0 + 0.02, 0, 0.08, SP.zB, ZI); // skirting
  // back wall (white, grey lower-left part)
  wallZ(SP.zB, SP.x0, SP.x1, 0, SP.ceil, 1, M.wallWhite);
  // right wall Spätkauf (behind cashier) x = 8.10, facing −x
  wallX(SP.x1, SP.zB, KI.zB, 0, bandY, -1, M.wallGrey);
  wallX(SP.x1, SP.zB, KI.zB, bandY, SP.ceil, -1, M.wallWhite);
  // facade inner cladding (above openings and below sills)
  wallZ(ZI - 0.002, SP.x0, KI.x0, OPEN_TOP, SP.ceil, -1, M.wallLight);
  wallZ(ZI - 0.002, 0.30, 1.30, 0, 0.25, -1, M.wallLight);
  wallZ(ZI - 0.002, 2.10, 4.10, 0, 0.45, -1, M.wallLight);
  wallZ(ZI - 0.002, 6.10, 6.75, 0, 0.45, -1, M.wallLight);
  wallZ(ZI - 0.002, KI.x0, 8.40, 0, KI.ceil, -1, M.wallWhite);
  wallZ(ZI - 0.002, 8.40, 11.40, OPEN_TOP, KI.ceil, -1, M.wallWhite);
  wallZ(ZI - 0.002, 8.40, 11.40, 0, 1.0, -1, M.wallWhite);
  wallZ(ZI - 0.002, 11.40, 11.60, 0, KI.ceil, -1, M.tiles, 1);

  // ---------------- kitchen walls
  const TILE_TOP = 2.55;
  // back wall z = −2.90 with door hole (starts at grey wall x = 8.10)
  for (const [x0, x1, y0, y1] of [[SP.x1, DOOR.x0, 0, TILE_TOP], [DOOR.x1, KI.x1, 0, TILE_TOP], [DOOR.x0, DOOR.x1, DOOR.y1, TILE_TOP]]) wallZ(KI.zB, x0, x1, y0, y1, 1, M.tiles, 1);
  wallZ(KI.zB, SP.x1, KI.x1, TILE_TOP, KI.ceil, 1, M.wallWhite);
  box(M.wallWhite, KI.x0, SP.x1, KI.ceil - 0.001, SP.ceil, KI.zB - 0.02, KI.zB); // lintel over cashier corner
  // door frame (black) + chain curtain
  box(M.black, DOOR.x0 - 0.05, DOOR.x0, 0, DOOR.y1 + 0.05, KI.zB - 0.12, KI.zB + 0.012);
  box(M.black, DOOR.x1, DOOR.x1 + 0.05, 0, DOOR.y1 + 0.05, KI.zB - 0.12, KI.zB + 0.012);
  box(M.black, DOOR.x0 - 0.05, DOOR.x1 + 0.05, DOOR.y1, DOOR.y1 + 0.05, KI.zB - 0.12, KI.zB + 0.012);
  {
    const cm = new THREE.MeshStandardMaterial({ map: T.chain, transparent: true, alphaTest: 0.25, metalness: 0.85, roughness: 0.3, side: THREE.DoubleSide, color: 0xe8ecef });
    const p = tplane(cm, DOOR.x1 - DOOR.x0, DOOR.y1 - 0.02, (DOOR.x0 + DOOR.x1) / 2, (DOOR.y1 - 0.02) / 2 + 0.01, KI.zB - 0.04); p.renderOrder = 3;
  }
  // Brandwand x = 12.0 (facing −x) + pilaster at facade
  wallX(KI.x1, KI.zB, -0.85, 0, TILE_TOP, -1, M.tiles, 1);
  wallX(KI.x1, KI.zB, -0.85, TILE_TOP, KI.ceil, -1, M.wallWhite);
  wallX(11.60, -0.85, ZI, 0, KI.ceil, -1, M.tiles, 1, 0.3);
  wallZ(-0.85, 11.60, KI.x1, 0, KI.ceil, -1, M.tiles, 1);
  // ---------------- oven room
  wallX(OV.x0, OV.z1, KI.zB, 0, KI.ceil, 1, M.tiles, 1);
  wallX(OV.x1, OV.z1, KI.zB, 0, KI.ceil, -1, M.tiles, 1);
  wallZ(OV.z1, OV.x0, OV.x1, 0, KI.ceil, 1, M.tiles, 1);
  wallZ(KI.zB - 0.12, OV.x0, DOOR.x0 - 0.05, 0, KI.ceil, -1, M.tiles, 1);
  wallZ(KI.zB - 0.12, DOOR.x1 + 0.05, OV.x1, 0, KI.ceil, -1, M.tiles, 1);
  wallX(DOOR.x0, KI.zB - 0.12, KI.zB, 0, DOOR.y1, 1, M.wallWhite); wallX(DOOR.x1, KI.zB - 0.12, KI.zB, 0, DOOR.y1, -1, M.wallWhite);

  // ================================================================ BULKHEAD (Unterzug) + pillar
  const PIL = { x0: 4.37, x1: 4.79 };
  {
    const bx0 = SP.x0, bx1 = SP.x1, by0 = SP.bY, by1 = SP.ceil, bz0 = SP.zBk - 0.2, bz1 = SP.zBk + 0.2;
    const greyTop = SP.ceil - 0.21;
    const bt = tex('int_bulkhead.jpg');
    const fallback = !bt ? canvasTex(1024, 160, (g, w, h) => {
      g.fillStyle = '#8f9295'; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(240,240,236,0.9)'; g.textAlign = 'center';
      g.font = '15px sans-serif'; g.fillText('KARTE o. BAR', w * 0.87, h * 0.15); g.fillText('Cash or Card', w * 0.87, h * 0.3);
      g.font = 'bold 44px sans-serif'; g.fillText('KASSE', w * 0.87, h * 0.6); g.font = '18px sans-serif'; g.fillText('Coffe Bar', w * 0.70, h * 0.78); g.fillText('↓', w * 0.87, h * 0.85); g.fillText('↓', w * 0.71, h * 0.92);
    }) : null;
    const bm = std(0xffffff, 0.9, 0, { map: bt || fallback });
    wallZ(bz1, bx0, bx1, by0, greyTop, 1, bm);
    wallZ(bz1, bx0, bx1, greyTop, by1, 1, M.wallWhite);
    box(M.whiteP, bx0, bx1, greyTop - 0.004, greyTop + 0.004, bz1, bz1 + 0.006);
    wallZ(bz0, bx0, bx1, by0, greyTop, -1, M.wallGrey); wallZ(bz0, bx0, bx1, greyTop, by1, -1, M.wallWhite);
    floorY(by0, bx0, bx1, bz0, bz1, -1, M.wallGrey);
    // pillar
    box(M.wallGrey, PIL.x0, PIL.x1, 0, by0, SP.zBk - 0.21, SP.zBk + 0.21);
    tplane(std(0xffffff, 0.9, 0, { map: T.preise }), 0.21, 0.30, (PIL.x0 + PIL.x1) / 2, 1.42, SP.zBk + 0.215);
    // security cameras
    const camG = () => { const g = new THREE.CylinderGeometry(0.035, 0.035, 0.12, 12); g.rotateX(Math.PI / 2); return g; };
    geoAt(camG(), M.plasticW, 0.55, by0 - 0.07, bz1 + 0.07, 0.4, 0.35);
    geoAt(camG(), M.plasticW, 7.95, greyTop - 0.25, bz1 + 0.07, -0.5, 0.35);
    box(M.plasticW, 0.5, 0.6, by0 - 0.03, by0, bz1, bz1 + 0.06); box(M.plasticW, 7.9, 8.0, greyTop - 0.21, greyTop - 0.18, bz1, bz1 + 0.06);
    // cable along underside
    box(M.black, bx0, bx1, by0 - 0.012, by0 - 0.004, bz1 - 0.03, bz1 - 0.022);
  }

  // ================================================================ CEILING LIGHTS (Spätkauf)
  function tubeFixture(x0, x1, z, y = SP.ceil, alongZ = false, mat = E.tube) {
    const L = Math.abs(x1 - x0), c = (x0 + x1) / 2;
    const base = new THREE.BoxGeometry(L, 0.035, 0.055); const tube = new THREE.CylinderGeometry(0.017, 0.017, L - 0.08, 10); tube.rotateZ(Math.PI / 2);
    const cap1 = new THREE.BoxGeometry(0.045, 0.05, 0.05), cap2 = cap1.clone();
    if (alongZ) { base.rotateY(Math.PI / 2); tube.rotateY(Math.PI / 2); }
    const off = alongZ ? [z, 0, c] : [c, 0, z];
    base.translate(off[0], y - 0.018, off[2]); add(base, M.whiteP);
    tube.translate(off[0], y - 0.05, off[2]); add(tube, mat);
    if (alongZ) { cap1.translate(z, y - 0.045, Math.max(x0, x1) - 0.03); cap2.translate(z, y - 0.045, Math.min(x0, x1) + 0.03); }
    else { cap1.translate(x0 + 0.03, y - 0.045, z); cap2.translate(x1 - 0.03, y - 0.045, z); }
    add(cap1, M.whiteP); add(cap2, M.whiteP);
  }
  // front row (innen.jpg): 5 battens butt-jointed at z ≈ −2.85, 2nd and 5th tube are off (only the white housing shows)
  { const xs = [0.32, 1.65, 2.97, 4.28, 5.63, 7.03]; for (let i = 0; i < 5; i++) tubeFixture(xs[i] + 0.01, xs[i + 1] - 0.01, -2.85, SP.ceil, false, (i === 1 || i === 4) ? M.tubeOff : E.tube); }
  for (let i = 0; i < 4; i++) tubeFixture(0.75 + i * 1.62, 0.75 + i * 1.62 + 1.55, -1.1);
  tubeFixture(-0.75, -2.3, 7.62, SP.ceil, true); tubeFixture(-2.4, -3.75, 7.62, SP.ceil, true);
  for (const z of [-5.0, -6.2]) for (let i = 0; i < 5; i++) tubeFixture(0.6 + i * 1.5, 0.6 + i * 1.5 + 1.45, z);
  // round pendant: flat clear acrylic lens (Ø ≈ 0.66 m) on one thin wire, bright polished rim (innen.jpg)
  {
    const px = 4.6, py = 3.09, pz = -1.85, r = 0.315;
    const top = new THREE.SphereGeometry(r / Math.sin(0.5), 48, 6, 0, Math.PI * 2, 0, 0.5); top.translate(0, -r / Math.tan(0.5), 0); top.scale(1, 0.55, 1); top.translate(px, py, pz);
    mesh(top, M.acrylic, 4);
    const bot = new THREE.SphereGeometry(r / Math.sin(0.5), 48, 6, 0, Math.PI * 2, 0, 0.5); bot.translate(0, -r / Math.tan(0.5), 0); bot.scale(1, -0.35, 1); bot.translate(px, py, pz);
    mesh(bot, M.acrylic, 4);
    const ring = new THREE.TorusGeometry(r, 0.006, 6, 72); ring.rotateX(Math.PI / 2); ring.translate(px, py, pz); add(ring, E.pendant);
    const ring2 = new THREE.TorusGeometry(r * 0.985, 0.004, 5, 72); ring2.rotateX(Math.PI / 2); ring2.translate(px, py - 0.006, pz); add(ring2, M.whiteP);
    cyl(M.whiteP, 0.03, 0.03, 0.012, 16, px, py + 0.055, pz); // small centre hub
    cyl(M.steelD, 0.0012, 0.0012, SP.ceil - py - 0.06, 3, px + 0.01, py + 0.06, pz);
    box(M.whiteP, px - 0.04, px + 0.04, SP.ceil - 0.015, SP.ceil, pz - 0.04, pz + 0.04);
  }
  // loose cables on ceiling (as in photo)
  { const c = new THREE.CatmullRomCurve3([new V3(5.2, SP.ceil - 0.01, ZI - 0.05), new V3(6.2, SP.ceil - 0.25, -1.6), new V3(7.3, SP.ceil - 0.35, -3.0), new V3(8.05, SP.bY + 0.2, -3.78)]); add(new THREE.TubeGeometry(c, 24, 0.004, 4, false), M.black); }

  // ================================================================ BEER CRATES
  const crateBrands = ['berliner', 'augustiner', 'becks', 'sternburg', 'peroni', 'rothaus', 'clubmate'];
  const crateFallback = { berliner: 0xe8e6df, augustiner: 0x24409a, becks: 0x2a7a3a, sternburg: 0xc62127, peroni: 0xeeeeec, rothaus: 0xc41e2a, clubmate: 0xf2c81a };
  const plainCrates = { heineken: 0x1f6b31, kasten: 0x1b1b1c, goesser: 0x1d5b32, orangina: 0x1d4f9e, estrella: 0x7a1519, grey: 0x6b6f73, green: 0x2f7d3b, benediktiner: 0x2c5ea8, polaplast: 0xe9e9e6 };
  const CR = { L: 0.40, D: 0.30, H: 0.30 };
  const plainLabel = { heineken: ['Heineken', '#ffffff', 'italic bold 46px serif'], kasten: ['KASTEN', '#ffffff', 'bold 50px sans-serif'], goesser: ['Gösser', '#f2e6b8', 'bold 50px serif'],
    orangina: ['ORANGINA', '#ffffff', 'bold 40px sans-serif'], estrella: ['Estrella Galicia', '#f4d9a0', 'bold 30px serif'], grey: ['', '#fff', '10px sans-serif'], green: ['Pilsener', '#f0f0e8', 'bold 44px serif'],
    benediktiner: ['Benediktiner', '#ffffff', 'italic bold 38px serif'], polaplast: ['polaplast', '#555555', '34px sans-serif'] };
  function plainCrateTex(b) { // simple brand crate side: coloured plastic, handle hole, ribs, label
    const col = new THREE.Color(plainCrates[b] ?? 0x777777).getStyle();
    return canvasTex(256, 192, (g, w, h) => {
      g.fillStyle = col; g.fillRect(0, 0, w, h);
      const sh = g.createLinearGradient(0, 0, 0, h); sh.addColorStop(0, 'rgba(255,255,255,0.12)'); sh.addColorStop(0.5, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.25)'); g.fillStyle = sh; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(0,0,0,0.55)'; g.beginPath(); g.roundRect ? g.roundRect(78, 16, 100, 30, 14) : g.rect(78, 16, 100, 30); g.fill();
      g.fillStyle = 'rgba(0,0,0,0.18)'; for (let x = 8; x < w; x += 24) g.fillRect(x, 60, 3, h - 70);
      g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 3; g.strokeRect(4, 4, w - 8, h - 8);
      const [t, c, f] = plainLabel[b] || ['', '#fff', '10px sans-serif'];
      if (t) { g.fillStyle = c; g.font = f; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, w / 2, h * 0.62, w - 20); }
    });
  }
  const crateGeo = (() => { // 4 sides + bottom; long sides u 0..1, short sides u .125..0.875
    const L = CR.L / 2, D = CR.D / 2, H = CR.H;
    const gs = [];
    gs.push(quad([-L, 0, D], [L, 0, D], [L, H, D], [-L, H, D], null, 0, 0, 1, 1));
    gs.push(quad([L, 0, -D], [-L, 0, -D], [-L, H, -D], [L, H, -D], null, 0, 0, 1, 1));
    gs.push(quad([L, 0, D], [L, 0, -D], [L, H, -D], [L, H, D], null, 0.125, 0, 0.875, 1));
    gs.push(quad([-L, 0, -D], [-L, 0, D], [-L, H, D], [-L, H, -D], null, 0.125, 0, 0.875, 1));
    return mergeGeometries(gs);
  })();
  const crateLists = {}; const crateTops = []; const necks = []; const caps = [];
  function crate(brand, x, y, z, ry, top = false) {
    (crateLists[brand] ||= []).push({ m: I(x, y, z, 1, 1, 1, ry), c: new THREE.Color().setScalar(0.84 + R() * 0.16) });
    if (top) {
      crateTops.push({ m: I(x, y + CR.H - 0.035, z, 1, 1, 1, ry), c: null });
      if (brand !== 'kasten' && brand !== 'polaplast' && R() < 0.9) {
        const green = brand === 'becks' || brand === 'heineken' || brand === 'peroni' || brand === 'goesser';
        const glass = green ? new THREE.Color(0x1f4a22) : brand === 'clubmate' ? new THREE.Color(0x5a3a12) : new THREE.Color(0x3d230e);
        const capC = { berliner: 0xc8102e, augustiner: 0xd8d4c8, becks: 0x2a7a3a, sternburg: 0xc0c0c0, peroni: 0x1c3f94, rothaus: 0xd8b04a, clubmate: 0xe2c044, heineken: 0x1f7a33, goesser: 0x1d5b32, estrella: 0xc8102e }[brand] ?? 0xb8b8b8;
        const c = Math.cos(ry), s = Math.sin(ry);
        for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) {
          if (R() < 0.08) continue;
          const lx = -0.16 + i * 0.08, lz = -0.105 + j * 0.07;
          const wx = x + lx * c + lz * s, wz = z - lx * s + lz * c;
          const hy = y + CR.H - 0.05;
          necks.push({ m: I(wx, hy, wz, 1, 1, 1, 0, (R() - 0.5) * 0.05, (R() - 0.5) * 0.05), c: glass });
          caps.push({ m: I(wx, hy + 0.105, wz), c: new THREE.Color(capC) });
        }
      }
    }
  }
  function stack(x, z, n, brands, ry = 0, y0 = 0) {
    for (let k = 0; k < n; k++) {
      const b = Array.isArray(brands) ? brands[Math.min(k, brands.length - 1)] : brands;
      crate(b, x + (R() - 0.5) * 0.025, y0 + k * CR.H, z + (R() - 0.5) * 0.025, ry + (R() - 0.5) * 0.04, k === n - 1);
    }
  }
  const pick = (arr) => arr[(R() * arr.length) | 0];
  const rep = (b, n, top) => { const a = Array(n).fill(b); if (top) a[n - 1] = top; return a; };
  const beer = ['berliner', 'augustiner', 'becks', 'sternburg', 'rothaus', 'heineken', 'goesser', 'estrella', 'peroni', 'green', 'benediktiner'];
  // near cluster (bottom-left of photo) — keep x > 2.7 in front free (Langnese / table / chairs)
  for (const [x, z, n, b] of [[1.93, -2.3, 2, 'orangina'], [2.35, -2.3, 2, 'sternburg'], [1.94, -2.62, 3, 'berliner'], [2.36, -2.62, 3, 'augustiner'], [1.5, -2.6, 2, 'grey']]) stack(x, z, n, b);
  stack(2.78, -2.78, 3, 'berliner'); stack(2.8, -3.1, 4, 'sternburg');
  // mid field (z ≈ −3.0 … −3.5): 4–6 high, only left of x ≈ 3.2
  for (let i = 0; i < 7; i++) { const x = 0.62 + i * 0.42; for (let j = 0; j < 2; j++) { if (x > 2.6 && j === 0) continue; const b = x > 3.0 ? pick(['kasten', 'kasten', 'green', 'becks']) : pick(beer); const n = 4 + (R() * 3 | 0); stack(x, -3.15 - j * 0.32, n, rep(b, n, R() < 0.3 ? pick(beer) : null)); } }
  // crate wall up to 7 high (z ≈ −3.9 … −4.3)
  for (let i = 0; i < 7; i++) { const x = 0.62 + i * 0.42; for (let j = 0; j < 2; j++) { const b = pick(beer); stack(x, -3.95 - j * 0.32, 6 + (R() < 0.45 ? 1 : 0), rep(b, 7, R() < 0.35 ? pick(beer) : null)); } }
  // row D behind bulkhead line (left back): Peroni / Estrella / Kasten tops
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) { const b = pick(['kasten', 'heineken', 'becks', 'berliner', 'goesser', 'estrella']); stack(0.62 + i * 0.42, -4.62 - j * 0.32, 6 + (R() < 0.5 ? 1 : 0), rep(b, 7, pick(['peroni', 'estrella', 'polaplast', 'peroni']))); }
  // left wall packs near front
  stack(0.55, -1.0, 4, ['orangina', 'orangina', 'grey', 'kasten'], Math.PI / 2); stack(0.55, -1.42, 3, 'orangina', Math.PI / 2);
  // Club-Mate: 2 columns × 5 on pallet (short side to the front), two deep
  box(M.woodPly, 3.62, 4.34, 0, 0.13, -4.55, -3.67);
  for (const x of [3.78, 4.18]) for (const z of [-3.88, -4.30]) stack(x, z, 5, 'clubmate', Math.PI / 2, 0.13);
  // stacks near D2 (seen from street through the door)
  stack(2.97, -0.78, 6, ['becks', 'becks', 'becks', 'heineken', 'heineken', 'kasten'], Math.PI / 2);
  stack(2.97, -1.20, 5, ['berliner', 'berliner', 'berliner', 'berliner', 'augustiner'], Math.PI / 2);
  stack(2.55, -0.80, 5, 'goesser', Math.PI / 2); stack(2.55, -1.22, 6, 'rothaus', Math.PI / 2);
  // Sternburg crates with KASSE sign at aisle entrance
  stack(5.95, -3.3, 3, 'sternburg', Math.PI / 2);
  {
    for (const [b, list] of Object.entries(crateLists)) {
      let mat;
      if (crateBrands.includes(b)) {
        const t = tex(`crate_${b}.jpg`);
        // rothaus texture reads mauve/pink under the cool tubes → pull it back to the real crate red
        mat = t ? std(b === 'rothaus' ? 0xffb2a0 : 0xffffff, 0.6, 0, { map: t }) : std(crateFallback[b], 0.55);
      } else mat = std(0xffffff, 0.6, 0, { map: plainCrateTex(b) });
      instanced(crateGeo, mat, list);
    }
    const topG = new THREE.PlaneGeometry(CR.L - 0.02, CR.D - 0.02); topG.rotateX(-Math.PI / 2);
    instanced(topG, std(0x1a1a1b, 0.8), crateTops);
    const neckG = new THREE.CylinderGeometry(0.012, 0.022, 0.12, 7, 1, true); neckG.translate(0, 0.045, 0);
    instanced(neckG, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.15, metalness: 0.1 }), necks);
    const capG = new THREE.CylinderGeometry(0.0145, 0.0145, 0.012, 8); instanced(capG, std(0xffffff, 0.35, 0.7), caps);
  }

  // ================================================================ PRODUCTS (atlas-mapped packaging, bags, balls)
  function rowBoxes(x0, x1, y, z, depth, hMin, hMax, alongZ = false, gap = 0.005, wMin = 0.06, wMax = 0.16, cells = packCells) {
    let p = x0;
    while (p < x1 - wMin) {
      const w = Math.min(rr(wMin, wMax), x1 - p), h = rr(hMin, hMax), cl = pick(cells);
      if (alongZ) stockBox(cl, z, y, p + w / 2, w - gap, h, depth, Math.PI / 2 + (R() - 0.5) * 0.04);
      else stockBox(cl, p + w / 2, y, z, w - gap, h, depth, (R() - 0.5) * 0.04);
      p += w;
    }
  }
  // pillow-shaped bags (chips, nuts, gummies): instanced, foil texture tinted per instance
  const bags = [];
  const bagCols = [0xe3b52a, 0xc9302c, 0xd77a2a, 0x4f7d3a, 0x7a5232, 0x2c4f8f, 0xe9d9a8, 0x8a2f5a];
  const bagC = (list) => new THREE.Color(pick(list || bagCols)).multiplyScalar(0.85 + R() * 0.15);
  // small round items (lollipop heads): instanced spheres
  const balls = [];
  // pizza boxes (instanced)
  const pbList = [];
  function pbStack(x, z, n, y0 = 2.62, size = 0.33, lean = 0.012) {
    let dx = 0, dz = 0;
    for (let k = 0; k < n; k++) { dx += (R() - 0.5) * lean; dz += (R() - 0.5) * lean; pbList.push({ m: I(x + dx, y0 + 0.022 + k * 0.045, z + dz, size, 0.043, size, (R() - 0.5) * 0.06), c: new THREE.Color().setScalar(0.85 + R() * 0.15) }); }
  }

  // ================================================================ FRIDGES
  {
    const doorT = [tex('int_fridge_door.jpg'), tex('int_fridge_door2.jpg')];
    const doorMats = doorT.map((t) => {
      const map = t || T.fridgeFallback;
      return new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.18, metalness: 0.0 });
    });
    doorMats.forEach(m => emisList.push([m, 1.15, 0.85, null]));
    // innen.jpg: glass doors end ~1.7 m, lit header above, wooden board on top at ~1.86 m (camera fit)
    const DW = 0.70, DY0 = 0.10, DY1 = 1.72, TOP = 1.86, VCROP = 1 - (DY1 - DY0) / 2.0;
    const doorGeo = () => { const g = new THREE.PlaneGeometry(DW - 0.02, DY1 - DY0); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, VCROP + uv.getY(i) * (1 - VCROP)); return g; };
    // back row
    const bx0 = 2.25, nB = 8, fz = SP.fz;
    box(M.whiteFr, bx0 - 0.03, bx0 + nB * DW + 0.03, 0, TOP, SP.zB, fz - 0.01);
    for (let i = 0; i < nB; i++) {
      const x = bx0 + i * DW;
      const g = doorGeo(); g.translate(x + DW / 2, (DY0 + DY1) / 2, fz + 0.002); mesh(g, doorMats[i % 2]);
      box(M.alu, x + DW - 0.012, x + DW + 0.012, DY0, DY1, fz, fz + 0.025); // mullion
      box(M.steelD, x + 0.035, x + 0.05, 0.85, 1.6, fz + 0.03, fz + 0.06); // handle
    }
    box(M.alu, bx0 - 0.03, bx0, DY0, DY1, fz, fz + 0.025);
    box(M.whiteFr, bx0 - 0.03, bx0 + nB * DW + 0.03, DY1, TOP, fz, fz + 0.03);
    box(E.fridgeLed, bx0, bx0 + nB * DW, DY1 + 0.01, DY1 + 0.03, fz + 0.031, fz + 0.033); // lit header strip
    // top-of-fridge wooden board + reserve stock (shrink-wrapped can trays, cartons, water packs) in real packaging look
    box(M.shelfWood, bx0 - 0.05, bx0 + nB * DW + 0.05, TOP, TOP + 0.03, SP.zB, fz + 0.06);
    function stockStack(x, z, wMax, ry = 0) { // one column of reserve stock, bottom at TOP + 0.03
      let y = TOP + 0.03; const n = 1 + (R() * 3 | 0); const kind = R();
      for (let k = 0; k < n; k++) {
        if (kind < 0.55) { const L = R() < 0.6 ? 1 : 2; const w = Math.min(wMax, 0.4), d = 0.27; stockBox(pick(trayCells), x, y, z, w - 0.01, 0.133 * L, d, ry + (R() - 0.5) * 0.08); y += 0.133 * L; }
        else if (kind < 0.85) { const h = rr(0.18, 0.32), w = Math.min(wMax, rr(0.28, 0.4)); stockBox(pick(cartonCells), x, y, z, w - 0.01, h, rr(0.26, 0.36), ry + (R() - 0.5) * 0.08); y += h; }
        else { stockBox(STK.water, x, y, z, Math.min(wMax, 0.36) - 0.01, 0.2, 0.25, ry + (R() - 0.5) * 0.06); y += 0.2; }
      }
    }
    for (let x = bx0 + 0.18; x < bx0 + nB * DW - 0.2; x += rr(0.36, 0.44)) { if (x > 2.85 && x < 3.6) continue; stockStack(x, fz - 0.2 - R() * 0.08, 0.4); }
    // tall tower of black energy-drink trays (top centre-left in innen.jpg, x ≈ 2.9–3.5)
    for (let k = 0; k < 6; k++) stockBox(STK.trayBlack, 3.22 + (R() - 0.5) * 0.03, TOP + 0.03 + k * 0.133, fz - 0.22, 0.4, 0.133, 0.27, (R() - 0.5) * 0.06);
    stockBox(STK.trayBlue, 3.22, TOP + 0.03 + 6 * 0.133, fz - 0.22, 0.4, 0.133, 0.27, 0.05);
    // left row (facing +x)
    const lx = 2.05, lz0 = -5.25, nL = 2;
    box(M.whiteFr, 1.25, lx - 0.01, 0, TOP, lz0 - nL * DW - 0.03, lz0 + 0.03);
    box(M.whiteFr, 1.25, bx0, 0, TOP, fz - 0.01, lz0 - nL * DW); // corner fill
    for (let i = 0; i < nL; i++) {
      const z = lz0 - i * DW;
      const g = doorGeo(); g.rotateY(Math.PI / 2); g.translate(lx + 0.002, (DY0 + DY1) / 2, z - DW / 2); mesh(g, doorMats[(i + 1) % 2]);
      box(M.alu, lx, lx + 0.025, DY0, DY1, z - DW - 0.012, z - DW + 0.012);
      box(M.steelD, lx + 0.03, lx + 0.06, 0.85, 1.6, z - 0.05, z - 0.035);
    }
    box(M.alu, lx, lx + 0.025, DY0, DY1, lz0, lz0 + 0.03);
    box(M.whiteFr, lx - 0.01, lx + 0.03, DY1, TOP, lz0 - nL * DW, lz0 + 0.03);
    box(M.shelfWood, 1.2, lx + 0.06, TOP, TOP + 0.03, lz0 - nL * DW, lz0 + 0.05);
    for (let z = lz0 - 0.2; z > lz0 - nL * DW + 0.2; z -= rr(0.36, 0.44)) stockStack(lx - 0.3, z, 0.4, Math.PI / 2);
    // small TV on back wall above fridges (innen.jpg: right of the column, x ≈ 7.5) + fire alarm + outlet
    box(M.blackG, 7.16, 7.82, 2.58, 2.96, SP.zB + 0.01, SP.zB + 0.06);
    tplane(screenMat(null, 0x16222e, 1.0, 1.0), 0.62, 0.34, 7.49, 2.77, SP.zB + 0.062);
    box(std(0xb3241f, 0.5), 4.05, 4.15, 2.8, 2.9, SP.zB, SP.zB + 0.05);
    box(M.plasticW, 4.4, 4.55, 2.82, 2.9, SP.zB, SP.zB + 0.02);
  }

  // ================================================================ GONDOLA + HARIBO + KASSE
  {
    const st = tex('int_shelf_snacks.jpg', { wrap: true });
    const shelfMat = std(0xffffff, 0.75, 0, { map: st || T.shelfFallback });
    if (!st) { T.shelfFallback.wrapS = T.shelfFallback.wrapT = THREE.RepeatWrapping; }
    // shelf unit with product-photo faces: faces listed as [x or z, face dir, axis]
    function shelfUnit(x0, x1, z0, z1, y1, faces, uo = 0) {
      const gy0 = 0.1, gs = [];
      for (const f of faces) {
        let g; const Lx = x1 - x0, Lz = z1 - z0;
        if (f === '-x') g = quad([x0, gy0, z0], [x0, gy0, z1], [x0, y1, z1], [x0, y1, z0], null, uo, 0, uo + Lz / 1.2, (y1 - gy0) / 1.75);
        if (f === '+x') g = quad([x1, gy0, z1], [x1, gy0, z0], [x1, y1, z0], [x1, y1, z1], null, uo + 0.37, 0, uo + 0.37 + Lz / 1.2, (y1 - gy0) / 1.75);
        if (f === '+z') g = quad([x0, gy0, z1], [x1, gy0, z1], [x1, y1, z1], [x0, y1, z1], null, uo + 0.6, 0, uo + 0.6 + Lx / 1.2, (y1 - gy0) / 1.75);
        if (f === '-z') g = quad([x1, gy0, z0], [x0, gy0, z0], [x0, y1, z0], [x1, y1, z0], null, uo + 0.2, 0, uo + 0.2 + Lx / 1.2, (y1 - gy0) / 1.75);
        gs.push(g);
      }
      mesh(mergeGeometries(gs), shelfMat);
      box(M.darkGrey, x0 + 0.01, x1 - 0.01, 0, gy0, z0 + 0.01, z1 - 0.01);
      box(M.steelD, x0 - 0.02, x1 + 0.02, y1, y1 + 0.05, z0 - 0.02, z1 + 0.02);
      for (let y = 0.45; y < y1 - 0.1; y += 0.36) {
        if (faces.includes('-x')) box(M.whiteP, x0 - 0.05, x0, y - 0.03, y, z0, z1);
        if (faces.includes('+x')) box(M.whiteP, x1, x1 + 0.05, y - 0.03, y, z0, z1);
        if (faces.includes('+z')) box(M.whiteP, x0, x1, y - 0.03, y, z1, z1 + 0.05);
      }
      return y1 + 0.05;
    }
    // gondola left of aisle (double-sided)
    const gt = shelfUnit(4.88, 5.42, -6.1, -4.45, 1.75, ['-x', '+x', '+z']);
    rowBoxes(-6.05, -4.5, gt, 5.15, 0.42, 0.12, 0.3, true, 0.01, 0.15, 0.3);
    // shelf unit right of aisle (faces aisle, −x)
    const rt = shelfUnit(6.12, 6.55, -6.1, -4.36, 1.55, ['-x', '+z'], 0.5);
    rowBoxes(-6.05, -4.4, rt, 6.33, 0.36, 0.1, 0.26, true, 0.01, 0.1, 0.22);

    // Haribo stand
    const ht = tex('int_haribo.png');
    const hm = ht ? new THREE.MeshStandardMaterial({ map: ht, alphaTest: 0.35, roughness: 0.6, side: THREE.DoubleSide }) : std(0x1d4fb4, 0.5);
    const hx = 5.12, hz = -3.05, hry = -0.12;
    tplane(hm, 0.35, 1.6, hx, 0.84, hz, hry);
    { const g = new THREE.BoxGeometry(0.03, 1.62, 0.03); geoAt(g.clone(), M.blue, hx - 0.17 * Math.cos(hry), 0.81, hz - 0.03 + 0.17 * Math.sin(hry), hry); geoAt(g, M.blue, hx + 0.17 * Math.cos(hry), 0.81, hz - 0.03 - 0.17 * Math.sin(hry), hry); }
    geoAt(new THREE.BoxGeometry(0.5, 0.04, 0.42), M.blue, hx, 0.02, hz - 0.15, hry);
    // gummy bags on pegs (back side of the stand, mostly hidden)
    for (let k = 0; k < 10; k++) bags.push({ m: I(hx + rr(-0.12, 0.12), rr(0.4, 1.4), hz - 0.07, 0.11, 0.17, 0.035, hry, 0, (R() - 0.5) * 0.15), c: bagC([0xe9c12a, 0xd03a2a, 0xe07a2a, 0xd9658c, 0x5f9a3a]) });

    // ---- Kasse counter (Spätkauf): customer side faces −x
    // innen.jpg shows the counter's steel END face at z ≈ −2.75 with the meray displays in front of it, and kueche.jpg
    // was shot from x ≈ 6.5 / z ≈ −2.2 → the counter runs from the Unterzug line back, not into the passage to Bertolino
    const kx0 = 6.12, kx1 = 6.72, kz0 = -4.3, kz1 = -2.75, ky = 1.0;
    box(M.steelB, kx0, kx1, 0.06, ky, kz0, kz1);
    box(M.black, kx0 + 0.03, kx1 - 0.03, 0, 0.06, kz0 + 0.03, kz1 - 0.03);
    box(M.darkGrey, kx0 - 0.04, kx1 + 0.02, ky, ky + 0.035, kz0 - 0.02, kz1 + 0.03);
    // register monitor (faces cashier, +x) + customer display, card terminal
    box(M.black, 6.48, 6.66, ky + 0.035, ky + 0.06, -3.85, -3.65);
    geoAt(new THREE.BoxGeometry(0.3, 0.21, 0.025), M.blackG, 6.55, ky + 0.22, -3.75, Math.PI / 2 - 0.25, -0.22);
    cyl(M.black, 0.012, 0.02, 0.12, 8, 6.58, ky + 0.035, -3.75);
    geoAt(new THREE.BoxGeometry(0.08, 0.04, 0.16), M.darkGrey, 6.25, ky + 0.055, -3.35, 0.3, 0.3);
    // lollipop stand (red tower with wrapped lollipop heads)
    { const lpx = 6.32, lpz = -2.98;
      cyl(M.red, 0.07, 0.09, 0.05, 16, lpx, ky + 0.035, lpz); cyl(M.red, 0.018, 0.018, 0.22, 8, lpx, ky + 0.08, lpz);
      const ball = new THREE.SphereGeometry(0.1, 16, 12); ball.translate(lpx, ky + 0.38, lpz); add(ball, M.red);
      const lc = [0xd8342c, 0xe9a23b, 0xe9d34a, 0xd9658c, 0x6aa84f, 0xf2efe6, 0x7b3f8c];
      for (let k = 0; k < 70; k++) { const th = R() * Math.PI * 2, ph = 0.15 + R() * Math.PI * 0.8; const d = new V3(Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)); balls.push({ m: I(lpx + d.x * 0.115, ky + 0.38 + d.y * 0.115, lpz + d.z * 0.115, 1, 0.9, 1, th, ph), c: new THREE.Color(pick(lc)).multiplyScalar(0.8 + R() * 0.2) }); } }
    rowBoxes(-4.25, -3.95, ky + 0.035, 6.28, 0.16, 0.08, 0.2, true, 0.01, 0.08, 0.16);
    rowBoxes(-3.25, -3.12, ky + 0.035, 6.3, 0.2, 0.1, 0.22, true, 0.01, 0.1, 0.18);
    // shelf over counter (coffee / sweets), cashier side
    // KASSE sign on Sternburg crates
    tplane(std(0xffffff, 0.8, 0, { map: T.kasseSign }), 0.3, 0.2, 5.95, 1.02, -3.09);
    box(M.kraft, 5.79, 6.11, 0.9, 0.92, -3.5, -3.11);
    // pink "Café" neon on counter shelf
    { const nm = new THREE.MeshBasicMaterial({ map: T.cafeNeon, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(0.85, 0.85, 0.85) }); emisList.push([nm, 0.85, 0.7, new THREE.Color(1, 1, 1)]); tplane(nm, 0.3, 0.115, 6.5, 1.13, -2.82, -0.35, 6); }

    // ---- behind cashier: cigarette display + back counter on wall x = 8.10
    const cig = tex('int_cigs.jpg');
    const cigMat = std(0xffffff, 0.6, 0, { map: cig || T.shelfFallback, emissive: 0xffffff, emissiveMap: cig || T.shelfFallback, emissiveIntensity: 0.12 });
    emisList.push([cigMat, 0.12, 0.0, null]);
    { const g = new THREE.PlaneGeometry(1.2, 0.8); g.rotateY(-Math.PI / 2); g.translate(SP.x1 - 0.2, 1.85, -5.15); mesh(g, cigMat); }
    box(M.black, SP.x1 - 0.22, SP.x1, 1.43, 1.45, -5.78, -4.52); box(M.black, SP.x1 - 0.22, SP.x1, 2.25, 2.27, -5.78, -4.52);
    box(M.black, SP.x1 - 0.22, SP.x1, 1.45, 2.25, -5.78, -5.75); box(M.black, SP.x1 - 0.22, SP.x1, 1.45, 2.25, -4.55, -4.52);
    box(M.steelB, SP.x1 - 0.55, SP.x1, 0, 0.9, -6.45, -4.5); box(M.darkGrey, SP.x1 - 0.57, SP.x1, 0.9, 0.93, -6.47, -4.48);
    rowBoxes(-6.4, -4.55, 0.93, SP.x1 - 0.3, 0.3, 0.12, 0.3, true, 0.01, 0.1, 0.2);
    for (const y of [2.5, 2.8]) { box(M.whiteP, SP.x1 - 0.3, SP.x1, y - 0.02, y, -6.4, -4.5); rowBoxes(-6.35, -4.55, y, SP.x1 - 0.15, 0.22, 0.12, 0.24, true, 0.01, 0.06, 0.12); }
    for (const y of [1.55, 1.9, 2.25]) { box(M.whiteP, SP.x1 - 0.28, SP.x1, y - 0.02, y, -6.5, -5.85); rowBoxes(-6.48, -5.87, y, SP.x1 - 0.14, 0.22, 0.12, 0.3, true, 0.008, 0.05, 0.12); }
    // grey menu wall (Bertolino chalk menu) facing the passage, behind Landi
    const mt = tex('kitchen_menu_wall.jpg');
    const menuMat = mt ? std(0xffffff, 0.92, 0, { map: mt }) : std(0x80868a, 0.92);
    { const g = new THREE.PlaneGeometry(1.4, 1.4); g.rotateY(-Math.PI / 2); g.translate(SP.x1 - 0.004, 1.72, -3.62); mesh(g, menuMat); }
    // notices on wall
    { const g = new THREE.PlaneGeometry(0.6, 0.6); g.rotateY(-Math.PI / 2); g.translate(SP.x1 - 0.004, 1.3, -6.75); mesh(g, std(0xffffff, 0.9, 0, { map: T.posters })); }
    // hanging TV in cashier corner (Bertolino menu); from the street only its back is seen
    { const tg = new THREE.Group(); tg.position.set(8.15, 2.78, -3.42); tg.rotation.y = -2.05; group.add(tg);
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.47, 0.055), M.blackG); tg.add(body);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.76, 0.43), screenMat(tex('tv_pizza.jpg'), 0xb04030, 0.9, 1.0)); scr.position.z = 0.031; tg.add(scr);
      const vesa = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.04), M.black); vesa.position.z = -0.05; tg.add(vesa);
      cyl(M.black, 0.02, 0.02, SP.ceil - 2.78, 8, 8.15 + 0.05, 2.78, -3.42 - 0.03); }
    // flex duct near ceiling at back right (visible under Unterzug)
    { const g = new THREE.CylinderGeometry(0.17, 0.17, 2.55, 20, 1, true); g.rotateZ(Math.PI / 2); g.translate(6.83, SP.ceil - 0.3, -4.5); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * 6); add(g, M.duct);
      const curve = new THREE.QuadraticBezierCurve3(new V3(5.56, SP.ceil - 0.3, -4.5), new V3(5.3, SP.ceil - 0.3, -4.5), new V3(5.3, SP.ceil + 0.02, -4.5)); add(new THREE.TubeGeometry(curve, 10, 0.17, 16, false), M.duct); }

    // ---- meray displays + snack basket rack (in front of counter)
    const mtx2 = tex('int_meray.png');
    const meMat = mtx2 ? new THREE.MeshStandardMaterial({ map: mtx2, alphaTest: 0.35, roughness: 0.55, side: THREE.DoubleSide }) : std(0xc8202a, 0.5);
    const wire = std(0xb51d22, 0.5, 0.4);
    // innen.jpg (right edge): tall red meray wire rack in front of the counter — 'meray' header, nut bags on hooks,
    // chip baskets at the bottom — and a separate red cardboard panel (meray / since 1978 / handful of love) in front of it
    const L2W = (grp, lx, ly, lz, sx, sy, sz, ry = 0, rx = 0, rz = 0) => grp.matrixWorld.clone().multiply(I(lx, ly, lz, sx, sy, sz, ry, rx, rz));
    function merayRack(x, z, ry, w = 0.46) {
      const grp = new THREE.Group(); grp.position.set(x, 0, z); grp.rotation.y = ry; group.add(grp); grp.updateMatrixWorld(true);
      const part = (geo, mat, lx, ly, lz) => { geo.translate(lx, ly, lz); geo.applyMatrix4(grp.matrixWorld); add(geo, mat); };
      for (const sx of [-1, 1]) part(new THREE.BoxGeometry(0.018, 1.86, 0.018), wire, sx * w / 2, 0.93, -0.12);
      for (const y of [1.0, 1.25, 1.5]) part(new THREE.BoxGeometry(w, 0.012, 0.012), wire, 0, y, -0.12);
      // header plate with the logo from the cardboard texture
      if (mtx2) { const hg = new THREE.PlaneGeometry(w + 0.04, 0.17); const uv = hg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.04 + uv.getX(i) * 0.92, 0.885 + uv.getY(i) * 0.095); const hm2 = new THREE.Mesh(hg, meMat); hm2.position.set(0, 1.78, -0.11); grp.add(hm2); }
      part(new THREE.BoxGeometry(w + 0.04, 0.17, 0.015), M.red, 0, 1.78, -0.125);
      // hanging nut bags (3 rows × 4)
      for (const y of [1.0, 1.25, 1.5]) for (let k = 0; k < 4; k++) bags.push({ m: L2W(grp, -w / 2 + 0.07 + k * (w - 0.14) / 3 + (R() - 0.5) * 0.02, y - 0.1, -0.09, 0.1, 0.18, 0.035, (R() - 0.5) * 0.3, 0.12, (R() - 0.5) * 0.1), c: bagC([0x7a5232, 0x9a6b3c, 0x5f7a3a, 0xb0402e, 0xc69a4a]) });
      // chip baskets
      for (const y of [0.15, 0.45, 0.75]) {
        part(new THREE.BoxGeometry(w, 0.01, 0.36), wire, 0, y, 0.06);
        part(new THREE.BoxGeometry(w, 0.09, 0.01), wire, 0, y + 0.045, 0.24);
        for (let k = 0; k < 6; k++) bags.push({ m: L2W(grp, rr(-w / 2 + 0.08, w / 2 - 0.08), y + 0.1, rr(-0.06, 0.16), 0.15, 0.2, 0.05, (R() - 0.5) * 0.8, -0.45 + (R() - 0.5) * 0.3, (R() - 0.5) * 0.4), c: bagC([0xe3b52a, 0xd8342c, 0xe9c43f, 0xd77a2a, 0xc9302c]) });
      }
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) part(new THREE.BoxGeometry(0.014, 0.95, 0.014), wire, dx * w / 2, 0.475, 0.06 + dz * 0.18);
      return grp;
    }
    function merayPanel(x, z, ry, y0 = 0.3, h = 1.5, w = 0.36) {
      const grp = new THREE.Group(); grp.position.set(x, 0, z); grp.rotation.y = ry; group.add(grp);
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), meMat); p.position.set(0, y0 + h / 2, 0.0); grp.add(p);
      const back = new THREE.Mesh(new THREE.BoxGeometry(w * 0.94, h * 0.97, 0.03), M.red); back.position.set(0, y0 + h / 2, -0.02); grp.add(back);
      for (const sx of [-1, 1]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.02, y0 + 0.02, 0.02), wire); leg.position.set(sx * w * 0.4, (y0 + 0.02) / 2, -0.03); grp.add(leg); }
      return grp;
    }
    merayRack(6.02, -2.38, -0.55);
    merayPanel(6.0, -1.98, -0.62, 0.32, 1.42, 0.34);
  }

  // ================================================================ COFFEE CORNER + LANGNESE + TV in W2
  {
    // marble bistro table
    const tx = 4.3, tz = -2.3;
    const top = new THREE.CylinderGeometry(0.31, 0.31, 0.022, 40); top.translate(tx, 0.745, tz); mesh(top, M.marble);
    const rim = new THREE.TorusGeometry(0.31, 0.012, 6, 40); rim.rotateX(Math.PI / 2); rim.translate(tx, 0.745, tz); add(rim, M.chairLeg);
    cyl(M.chairLeg, 0.03, 0.03, 0.72, 10, tx, 0.02, tz);
    for (const a of [0, Math.PI / 2]) { const g = new THREE.BoxGeometry(0.5, 0.025, 0.05); geoAt(g, M.chairLeg, tx, 0.0125, tz, a); }
    // velvet chairs
    const seatG = new RoundedBoxGeometry(0.48, 0.12, 0.46, 3, 0.05);
    const backG = new RoundedBoxGeometry(0.48, 0.52, 0.1, 3, 0.045);
    const skirtG = new RoundedBoxGeometry(0.46, 0.32, 0.44, 2, 0.04);
    function chair(x, z, ry) {
      const c = Math.cos(ry), s = Math.sin(ry); const P = (lx, ly, lz) => [x + lx * c + lz * s, ly, z - lx * s + lz * c];
      geoAt(seatG.clone(), M.velvet, ...P(0, 0.47, 0), ry);
      geoAt(backG.clone(), M.velvet, ...P(0, 0.8, -0.2), ry, -0.1);
      geoAt(skirtG.clone(), M.velvet, ...P(0, 0.24, 0), ry);
      for (const [lx, lz] of [[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.18], [0.19, 0.18]]) cyl(M.chairLeg, 0.012, 0.012, 0.08, 6, ...P(lx, 0, lz));
    }
    chair(3.62, -2.12, 2.2);   // front-left, faces table
    chair(4.9, -2.98, -0.55);  // behind right
    chair(5.12, -2.28, -1.75); // right
    // Langnese chest (front faces +z): red body, light-grey plastic top frame, lit well with ice-cream boxes,
    // two curved sliding glass lids (innen.jpg: bright warm glow under the glass)
    const lx0 = 3.52, lx1 = 4.82, lz0 = -3.58, lz1 = -2.92, fy0 = 0.1, fy1 = 0.80, ly1 = 0.86;
    const lt = tex('int_langnese.jpg');
    const lfront = std(0xffffff, 0.42, 0, lt ? { map: lt } : { color: 0xd12a2e });
    wallZ(lz1 + 0.002, lx0, lx1, lt ? 0.02 : fy0, fy1, 1, lfront);
    wallX(lx0, lz0, lz1, fy0, fy1, -1, M.red); wallX(lx1, lz0, lz1, fy0, fy1, 1, M.red); wallZ(lz0, lx0, lx1, fy0, fy1, -1, M.red);
    box(M.darkGrey, lx0 + 0.02, lx1 - 0.02, 0, fy0, lz0 + 0.02, lz1 - 0.02);
    const frameM = std(0xd5d8da, 0.35, 0.05);
    const fw = 0.055; // top frame (rim) all around + centre rail
    box(frameM, lx0 - 0.012, lx1 + 0.012, fy1, ly1, lz1 - fw, lz1 + 0.012); box(frameM, lx0 - 0.012, lx1 + 0.012, fy1, ly1, lz0 - 0.012, lz0 + fw);
    box(frameM, lx0 - 0.012, lx0 + fw, fy1, ly1, lz0, lz1); box(frameM, lx1 - fw, lx1 + 0.012, fy1, ly1, lz0, lz1);
    // white liner of the well
    const liner = std(0xd3d7d8, 0.5);
    wallZ(lz1 - fw, lx0 + fw, lx1 - fw, 0.5, fy1 + 0.04, -1, liner); wallZ(lz0 + fw, lx0 + fw, lx1 - fw, 0.5, fy1 + 0.04, 1, liner);
    wallX(lx0 + fw, lz0 + fw, lz1 - fw, 0.5, fy1 + 0.04, 1, liner); wallX(lx1 - fw, lz0 + fw, lz1 - fw, 0.5, fy1 + 0.04, -1, liner);
    // ice-cream boxes in the well (lit by the lid lamp)
    const icT = canvasTex(512, 256, (g, w, h) => { const r = rng32(61); g.fillStyle = '#b9b2a4'; g.fillRect(0, 0, w, h);
      for (let k = 0; k < 90; k++) { const x = r() * w, y = r() * h, bw = 44 + r() * 50, bh = 26 + r() * 30; g.fillStyle = pick(['#b9282c', '#e2c04a', '#2f5fa8', '#f1ede4', '#6b3e26', '#d77a9a', '#3d7a3d', '#d9792b', '#e9e3d0']); g.fillRect(x, y, bw, bh);
        g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(x + 3, y + 3, bw * 0.5, 4); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, y + bh - 3, bw, 3); g.fillRect(x + bw - 3, y, 3, bh); } });
    const icM = new THREE.MeshStandardMaterial({ map: icT, emissiveMap: icT, emissive: 0xffe2b0, emissiveIntensity: 0.55, roughness: 0.6 }); emisList.push([icM, 0.55, 0.35, null]);
    floorY(0.72, lx0 + fw, lx1 - fw, lz0 + fw, lz1 - fw, 1, icM);
    // lid lamp along the centre rail
    box(frameM, (lx0 + lx1) / 2 - 0.02, (lx0 + lx1) / 2 + 0.02, fy1, ly1 + 0.015, lz0, lz1);
    box(E.chestLamp, lx0 + fw, lx1 - fw, ly1 - 0.03, ly1 - 0.012, lz0 + fw + 0.01, lz0 + fw + 0.03);
    // curved glass lids (cylindrical, axis along x), slightly bulged above the frame
    const lidR = 0.62, lidA = Math.asin(((lz1 - lz0) / 2 - fw * 0.5) / lidR), lidY = ly1 - lidR * Math.cos(lidA);
    for (const [a, b] of [[lx0 + fw * 0.6, (lx0 + lx1) / 2 - 0.01], [(lx0 + lx1) / 2 + 0.01, lx1 - fw * 0.6]]) {
      const g = new THREE.CylinderGeometry(lidR, lidR, b - a, 32, 1, true, -lidA, 2 * lidA); g.rotateZ(Math.PI / 2); g.rotateX(-Math.PI / 2); g.translate((a + b) / 2, lidY, (lz0 + lz1) / 2);
      mesh(g, M.lidGlass, 5);
      // alu edge profiles of the sliding lids
      for (const x of [a, b]) { const t = new THREE.TorusGeometry(lidR, 0.007, 4, 20, 2 * lidA); t.rotateZ(Math.PI / 2 - lidA); t.rotateY(Math.PI / 2); t.translate(x, lidY, (lz0 + lz1) / 2); add(t, M.alu); }
    }
    box(std(0x58a34a, 0.6), lx0 + 0.12, lx0 + 0.24, fy1 - 0.06, fy1 - 0.02, lz1 + 0.003, lz1 + 0.006);
    // TV in W2 (screen to street)
    const tv = tex('tv_pizza.jpg');
    const tvx0 = 2.16, tvx1 = 3.44, ty0 = 1.15, ty1 = 1.88, tzS = -0.425;
    box(M.blackG, tvx0 - 0.015, tvx1 + 0.015, ty0 - 0.015, ty1 + 0.015, tzS - 0.06, tzS - 0.002);
    const tvM = screenMat(tv, 0xb04030, 1.05, 1.15);
    tplane(tvM, tvx1 - tvx0, ty1 - ty0, (tvx0 + tvx1) / 2, (ty0 + ty1) / 2, tzS);
    box(M.black, 2.74, 2.86, 0.0, ty0, tzS - 0.18, tzS - 0.08); box(M.black, 2.45, 3.15, 0, 0.03, -0.95, -0.5); box(M.black, 2.68, 2.92, 1.25, 1.55, tzS - 0.1, tzS - 0.06);
  }

  // ================================================================ LEFT WALL table + misc front
  {
    const t0 = -2.0, t1 = -1.55;
    box(M.woodPly, 0.32, 1.05, 0.72, 0.76, -2.35, -1.6);
    for (const [x, z] of [[0.36, -2.3], [1.0, -2.3], [0.36, -1.65], [1.0, -1.65]]) box(M.woodPly, x - 0.02, x + 0.02, 0, 0.72, z - 0.02, z + 0.02);
    const pw = new THREE.MeshPhysicalMaterial({ color: 0xeef2f5, roughness: 0.25, transparent: true, opacity: 0.55, depthWrite: false });
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { const x = 0.5 + i * 0.3, z = -1.8 - j * 0.3; box(M.plasticW, x - 0.13, x + 0.13, 0.76, 0.96, z - 0.13, z + 0.13); }
    { const g = new RoundedBoxGeometry(0.72, 0.36, 0.7, 2, 0.06); g.translate(0.68, 1.08, -1.97); mesh(g, pw, 5); }
    // purple box on wall shelf
    box(M.whiteP, 0.3, 0.6, 1.98, 2.0, -2.9, -2.2); box(std(0x5b2a86, 0.6), 0.32, 0.6, 2.0, 2.55, -2.85, -2.45);
    // water bottle packs on wall shelf
    box(M.whiteP, 0.3, 0.62, 1.45, 1.47, -1.5, -0.6);
    for (let j = 0; j < 3; j++) box(M.plasticW, 0.32, 0.6, 1.47, 1.75, -1.45 + j * 0.28, -1.2 + j * 0.28);
  }

  // ================================================================ BERTOLINO counter (glass display)
  {
    const cx0 = KI.x0, cx1 = KI.xc, cz0 = -3.12, cz1 = -1.08, rEnd = (cx1 - cx0) / 2, ccx = (cx0 + cx1) / 2;
    const baseH = 0.88, ledgeH = 0.93, glassTopY = 1.26;
    // straight base, customer face terrazzo
    wallX(cx0, cz0, cz1, 0.1, baseH, -1, M.terrazzo, 0.5);
    box(M.black, cx0 + 0.04, cx1, 0, 0.1, cz0, cz1);
    box(M.steelB, cx0 + 0.02, cx1, 0.1, baseH, cz0, cz0 + 0.02);
    // curved end (half cylinder towards facade)
    { const g = new THREE.CylinderGeometry(rEnd, rEnd, baseH - 0.1, 28, 1, true, -Math.PI / 2, Math.PI); g.translate(ccx, 0.1 + (baseH - 0.1) / 2, cz1); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2.2, uv.getY(i) * 1.6); add(g, M.terrazzo); }
    { const g = new THREE.CylinderGeometry(rEnd - 0.04, rEnd - 0.04, 0.1, 28, 1, true, -Math.PI / 2, Math.PI); g.translate(ccx, 0.05, cz1); add(g, M.black); }
    // granite ledge
    { const s = new THREE.Shape(); s.moveTo(cx0 - 0.06, cz0); s.lineTo(cx0 - 0.06, cz1); s.absarc(ccx, cz1, rEnd + 0.06, Math.PI, 0, true); s.lineTo(cx1 + 0.02, cz0); s.lineTo(cx0 - 0.06, cz0);
      const g = new THREE.ExtrudeGeometry(s, { depth: ledgeH - baseH, bevelEnabled: false, curveSegments: 20 }); g.rotateX(Math.PI / 2); g.translate(0, ledgeH, 0);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1.5, uv.getY(i) * 1.5); add(g, M.granite); }
    // cooled well: GN pans with vegetables
    box(M.steelB, cx0 + 0.05, cx1 - 0.08, ledgeH, ledgeH + 0.01, cz0 + 0.04, cz1 + 0.15);
    // GN pans with toppings: painted topping textures (grilled zucchini, peppers, onions, mushrooms, salami, olives …)
    const vegT = canvasTex(512, 512, (g, w, h) => {
      const r = rng32(91), C = 256;
      const blob = (x, y, rx, ry, col, a = 0) => { g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = col; g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, 7); g.fill(); g.restore(); };
      const kinds = [
        (x0, y0) => { for (let k = 0; k < 70; k++) { const x = x0 + r() * C, y = y0 + r() * C, a = r() * 3; blob(x, y, 20, 13, '#2f5a22', a); blob(x, y, 16, 10, '#b9c98a', a); for (let s2 = -1; s2 <= 1; s2++) blob(x + s2 * 6, y, 2, 9, 'rgba(60,40,20,0.55)', a); } },          // grilled zucchini
        (x0, y0) => { for (let k = 0; k < 120; k++) { const x = x0 + r() * C, y = y0 + r() * C; blob(x, y, 15, 4, pick(['#b8261c', '#c7891c', '#d8b22a', '#8a1c15']), r() * 3); } },                                                     // pepper strips
        (x0, y0) => { for (let k = 0; k < 90; k++) { const x = x0 + r() * C, y = y0 + r() * C, a = r() * 3; g.strokeStyle = pick(['#e9e3d2', '#d9cfe0', '#8c4f7a']); g.lineWidth = 3; g.beginPath(); g.ellipse(x, y, 10 + r() * 8, 6, a, 0, 5); g.stroke(); } }, // onion rings
        (x0, y0) => { for (let k = 0; k < 90; k++) { const x = x0 + r() * C, y = y0 + r() * C, a = r() * 3; blob(x, y, 13, 10, '#cdb896', a); blob(x, y + 6, 5, 7, '#a88e66', a); } },                                             // mushrooms
        (x0, y0) => { for (let k = 0; k < 60; k++) { const x = x0 + r() * C, y = y0 + r() * C; blob(x, y, 17, 17, '#9c2a22'); for (let d = 0; d < 6; d++) blob(x + (r() - 0.5) * 22, y + (r() - 0.5) * 22, 2.5, 2.5, '#e8c9b5'); } },        // salami
        (x0, y0) => { for (let k = 0; k < 160; k++) blob(x0 + r() * C, y0 + r() * C, 7, 6, '#1d1a17'); for (let k = 0; k < 60; k++) blob(x0 + r() * C, y0 + r() * C, 2, 2, '#6b5a3a'); },                                     // olives
        (x0, y0) => { for (let k = 0; k < 140; k++) blob(x0 + r() * C, y0 + r() * C, 6, 5, '#e9c33a', r() * 3); },                                                                                                         // corn
        (x0, y0) => { for (let k = 0; k < 90; k++) blob(x0 + r() * C, y0 + r() * C, 12 + r() * 6, 8, pick(['#d9c3a6', '#c9ae8c', '#e2d3bd']), r() * 3); },                                                                // tuna / cheese
      ];
      g.fillStyle = '#6d6f72'; g.fillRect(0, 0, w, h);
      // 2 kinds per quadrant (left / right half of each 256 cell) → 8 toppings
      for (let q = 0; q < 4; q++) { const x0 = (q % 2) * C, y0 = Math.floor(q / 2) * C; g.save(); g.beginPath(); g.rect(x0, y0, C, C); g.clip(); g.fillStyle = '#4f4a42'; g.fillRect(x0, y0, C, C); kinds[q * 2](x0, y0); g.restore();
        g.save(); g.beginPath(); g.rect(x0 + C / 2, y0, C / 2, C); g.clip(); g.fillStyle = '#4f4a42'; g.fillRect(x0 + C / 2, y0, C / 2, C); kinds[q * 2 + 1](x0, y0); g.restore(); }
      g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(0, 0, w, h);
    });
    const vegM = std(0xffffff, 0.55, 0, { map: vegT });
    let vk = 0;
    for (let z = cz0 + 0.1; z < cz1 + 0.12; z += 0.27) {
      box(M.panGrey, cx0 + 0.12, cx1 - 0.14, ledgeH + 0.01, ledgeH + 0.07, z, z + 0.24);
      // two half-size GN inserts per row, each a different topping (top surface slightly mounded)
      for (const [a, b] of [[cx0 + 0.13, (cx0 + cx1) / 2 - 0.035], [(cx0 + cx1) / 2 - 0.025, cx1 - 0.15]]) {
        const k = vk++ % 8, u0 = (k >> 1) % 2 * 0.5 + (k % 2) * 0.25, v0 = 0.5 - Math.floor((k >> 1) / 2) * 0.5;
        const g = new THREE.PlaneGeometry(b - a, 0.22, 3, 3); const p = g.attributes.position, uv = g.attributes.uv;
        for (let i = 0; i < p.count; i++) { const ex = Math.abs(p.getX(i)) / ((b - a) / 2), ey = Math.abs(p.getY(i)) / 0.11; p.setZ(i, 0.012 * (1 - Math.max(ex, ey) ** 2)); uv.setXY(i, u0 + uv.getX(i) * 0.25, v0 + uv.getY(i) * 0.5); }
        g.computeVertexNormals(); g.rotateX(-Math.PI / 2); g.translate((a + b) / 2, ledgeH + 0.066, z + 0.12); add(g, vegM);
      }
    }
    // spring onions / zucchini lying near the round end
    for (let k = 0; k < 6; k++) { const g = new THREE.CylinderGeometry(0.012, 0.012, 0.32, 6); g.rotateZ(Math.PI / 2); geoAt(g, std(0x6fae3a, 0.6), rr(cx0 + 0.15, cx1 - 0.15), ledgeH + 0.08, rr(cz1 - 0.15, cz1 + 0.05), rr(-0.4, 0.4)); }
    // display glass: vertical front (customer side), glass top, curved end, end panels
    const gl = [];
    { const g = new THREE.PlaneGeometry(cz1 - cz0, glassTopY - ledgeH); g.rotateY(-Math.PI / 2); g.translate(cx0 + 0.005, (ledgeH + glassTopY) / 2, (cz0 + cz1) / 2); gl.push(g); }
    { const g = new THREE.CylinderGeometry(rEnd - 0.005, rEnd - 0.005, glassTopY - ledgeH, 28, 1, true, -Math.PI / 2, Math.PI); g.translate(ccx, (ledgeH + glassTopY) / 2, cz1); gl.push(g); }
    { const g = new THREE.PlaneGeometry(cx1 - cx0, cz1 - cz0); g.rotateX(-Math.PI / 2); g.translate(ccx, glassTopY, (cz0 + cz1) / 2); gl.push(g);
      const c = new THREE.CircleGeometry(rEnd, 28, 0, Math.PI); c.rotateX(-Math.PI / 2); c.translate(ccx, glassTopY, cz1); gl.push(c); }
    { const g = new THREE.PlaneGeometry(cx1 - cx0, glassTopY - ledgeH); g.translate(ccx, (ledgeH + glassTopY) / 2, cz0 + 0.01); gl.push(g); }
    mesh(mergeGeometries(gl.map(prep)), M.glassTop, 5);
    // steel rails along glass
    { const g = new THREE.CylinderGeometry(0.008, 0.008, cz1 - cz0, 6); g.rotateX(Math.PI / 2); g.translate(cx0 + 0.005, glassTopY, (cz0 + cz1) / 2); add(g, M.steel);
      const t = new THREE.TorusGeometry(rEnd, 0.008, 5, 24, Math.PI); t.rotateX(Math.PI / 2); t.rotateY(Math.PI); t.translate(ccx, glassTopY, cz1); add(t, M.steel); }
    // LED strip inside display
    box(E.displayLed, cx0 + 0.1, cx0 + 0.13, glassTopY - 0.015, glassTopY - 0.005, cz0 + 0.05, cz1);
    // staff side: steel work shelf + upper glass shelf
    box(M.steelB, cx1, cx1 + 0.35, 0.86, 0.9, KI.zB + 0.02, -0.95);
    box(M.steelB, cx1 + 0.01, cx1 + 0.34, 0.05, 0.86, KI.zB + 0.02, -0.95);
    // items on staff shelf (deli containers, bowls)
    for (let k = 0; k < 6; k++) cyl(std(0xc9cfcf, 0.3), 0.06, 0.055, 0.1, 12, cx1 + 0.17, 0.9, KI.zB + 0.17 + k * 0.28); // translucent deli tubs

    // --- items on glass top
    // Landi POS (screen faces −x)
    const lsT = tex('landi_screen.jpg');
    const lsM = screenMat(lsT, 0xdfe7ee, 1.0, 1.0);
    {
      const lx = 8.12, lz = -2.92, ly = glassTopY;
      box(M.black, lx - 0.14, lx + 0.14, ly, ly + 0.012, lz - 0.11, lz + 0.11);
      box(M.black, lx + 0.03, lx + 0.07, ly, ly + 0.2, lz - 0.03, lz + 0.03);
      const scr = new THREE.Group(); scr.position.set(lx, ly + 0.3, lz); scr.rotation.set(0, -Math.PI / 2, 0); group.add(scr);
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.37, 0.23, 0.025), M.blackG); scr.add(body);
      body.rotation.x = -0.12;
      const sp = new THREE.Mesh(new THREE.PlaneGeometry(0.345, 0.194), lsM); sp.position.set(0, 0, 0.0135); body.add(sp);
      // receipt printer + card terminal
      box(M.black, 7.92, 8.14, ly, ly + 0.11, -2.66, -2.52);
      geoAt(new THREE.BoxGeometry(0.08, 0.035, 0.16), M.darkGrey, 7.88, ly + 0.03, -2.36, 0.2, 0.25);
    }
    // salt, pepper, pepper mill, oil, paper
    {
      const ly = glassTopY;
      // kueche.jpg: napkins, pepper mill, shakers, ketchup, chili oil and a plate stand along the staff-side edge (x ≈ 8.3)
      floorY(ly + 0.002, 8.12, 8.42, -3.08, -2.86, 1, std(0xe4e2dc, 0.85));
      const shG = new THREE.CylinderGeometry(0.022, 0.024, 0.085, 14);
      geoAt(shG.clone(), M.glassTop, 8.3, ly + 0.045, -2.7); geoAt(shG.clone(), M.glassTop, 8.34, ly + 0.045, -2.64);
      cyl(std(0xf5f5f2, 0.6), 0.019, 0.019, 0.05, 10, 8.3, ly + 0.005, -2.7); cyl(std(0x4a3a2a, 0.8), 0.019, 0.019, 0.05, 10, 8.34, ly + 0.005, -2.64);
      cyl(M.steel, 0.024, 0.024, 0.02, 12, 8.3, ly + 0.088, -2.7); cyl(M.steel, 0.024, 0.024, 0.02, 12, 8.34, ly + 0.088, -2.64);
      // pepper mill (dark wood)
      const pts = [[0.0, 0], [0.032, 0], [0.034, 0.03], [0.026, 0.09], [0.03, 0.14], [0.022, 0.17], [0.014, 0.2], [0.0, 0.21]].map(p => new THREE.Vector2(p[0], p[1]));
      geoAt(new THREE.LatheGeometry(pts, 14), std(0x1e1512, 0.35), 8.32, ly, -2.78);
      // oil bottle with chili
      const ob = [[0, 0], [0.032, 0], [0.034, 0.16], [0.012, 0.21], [0.012, 0.25], [0, 0.25]].map(p => new THREE.Vector2(p[0], p[1]));
      const obm = new THREE.Mesh(new THREE.LatheGeometry(ob, 16), new THREE.MeshPhysicalMaterial({ color: 0xc9a21a, roughness: 0.1, transparent: true, opacity: 0.75, depthWrite: false })); obm.position.set(8.3, ly, -2.48); obm.renderOrder = 5; group.add(obm);
      cyl(M.steel, 0.034, 0.034, 0.16, 16, 8.36, ly, -2.42, null, true);
      cyl(std(0x9b1b12, 0.5), 0.03, 0.03, 0.15, 12, 8.36, ly, -2.58); // ketchup
      // plate
      const pl = new THREE.CylinderGeometry(0.12, 0.08, 0.02, 24); pl.translate(8.3, ly + 0.01, -2.3); add(pl, std(0xf4f4f2, 0.3));
      cyl(std(0xdcc9a3, 0.8), 0.07, 0.08, 0.012, 16, 8.3, ly + 0.02, -2.3);
    }
    // ONLY CARD sign inside display facing customers
    {
      const ot = tex('sign_only_card.png');
      const om = ot ? new THREE.MeshStandardMaterial({ map: ot, alphaTest: 0.3, roughness: 0.8 }) : std(0x1a1c1c, 0.8);
      const g = new THREE.PlaneGeometry(0.45, 0.3); g.rotateY(-Math.PI / 2); g.rotateZ(0); const m = mesh(g, om); m.position.set(cx0 + 0.07, ledgeH + 0.16, -2.22); m.rotation.z = 0.0;
    }
    // pumpkin + wire rack near round end
    {
      const pts = []; for (let i = 0; i <= 16; i++) { const t = i / 16; const a = t * Math.PI; pts.push(new THREE.Vector2(Math.sin(a) * 0.15, -Math.cos(a) * 0.1)); }
      const pg = new THREE.LatheGeometry(pts, 36); const p = pg.attributes.position;
      for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); const a = Math.atan2(z, x); const k = 1 + 0.07 * Math.cos(a * 10); p.setX(i, x * k); p.setZ(i, z * k); }
      pg.computeVertexNormals(); pg.translate(8.1, glassTopY + 0.1, -1.12); add(pg, M.pumpkin);
      cyl(M.stem, 0.012, 0.018, 0.06, 6, 8.1, glassTopY + 0.19, -1.12);
      // wire rack
      for (let k = 0; k < 6; k++) cyl(M.steel, 0.003, 0.003, 0.16, 4, 7.95 + k * 0.045, glassTopY, -1.42);
      box(M.steel, 7.93, 8.2, glassTopY, glassTopY + 0.006, -1.46, -1.36);
      geoAt(new THREE.PlaneGeometry(0.2, 0.14), std(0xf6f6f4, 0.8), 8.06, glassTopY + 0.08, -1.4, 0, -0.2);
    }
  }

  // ================================================================ KITCHEN fixtures
  {
    // --- wooden pizza counter at window B
    const px0 = 8.45, px1 = 11.38, pz0 = -1.05, pz1 = ZI - 0.005, top = 1.02;
    { const g = new THREE.BoxGeometry(px1 - px0, 0.05, pz1 - pz0); g.translate((px0 + px1) / 2, top - 0.025, (pz0 + pz1) / 2); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (px1 - px0) / 1.4, uv.getY(i) * 0.6); add(g, M.wood); }
    { const g = new THREE.BoxGeometry(px1 - px0, 0.1, 0.035); g.translate((px0 + px1) / 2, top + 0.05, pz0 + 0.0175); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 0.2); add(g, M.wood); }
    wallZ(pz0, px0, px1, 0.08, top - 0.05, -1, M.woodPly, 1.2);
    box(M.black, px0, px1, 0, 0.08, pz0 + 0.04, pz1);
    // glass sneeze guard at left end
    { const g = new THREE.PlaneGeometry(0.5, 0.45); g.rotateY(Math.PI / 2); g.translate(px0 + 0.03, top + 0.22, -0.76); mesh(g, M.glassTop, 5); }
    // pizzas
    const pzT = [1, 2, 3, 4].map(i => tex(`pizza_${i}.png`));
    const pizzaMats = pzT.map(t => new THREE.MeshStandardMaterial({ map: t || T.pizzaFallback, alphaTest: 0.4, roughness: 0.7 }));
    const pizzas = [[9.25, -0.72, 0, 0.30], [9.72, -0.78, 1, 0.33], [10.2, -0.70, 2, 0.31], [10.62, -0.80, 3, 0.33], [10.98, -0.66, 0, 0.29], [11.08, -0.9, 1, 0.31]];
    const crust = [];
    for (const [x, z, k, d] of pizzas) {
      const g = new THREE.CircleGeometry(d / 2, 32); g.rotateX(-Math.PI / 2); g.rotateY(R() * 6.28); g.translate(x, top + 0.012, z); mesh(g, pizzaMats[k]);
      crust.push({ m: I(x, top + 0.005, z, d / 2 * 0.97, 0.01, d / 2 * 0.97), c: null });
    }
    instanced(new THREE.CylinderGeometry(1, 1, 1, 24), std(0xcf9d5e, 0.8), crust);
    // pizza cutter (red handle)
    box(std(0xb01818, 0.5), 9.95, 10.12, top, top + 0.02, -0.98, -0.95);

    // --- lamella hood over window (sloped soffit above)
    const hx0 = 10.42, hx1 = 11.36, hz0 = -1.25, hz1 = ZI - 0.01;
    box(M.hood, hx0, hx1, 2.2, 2.4, hz0, hz1);
    // sloped skirt front (towards kitchen)
    { const y0 = 1.97, y1 = 2.2;
      const P = [[hx0, y1, hz0], [hx1, y1, hz0], [hx1, y0, hz0 + 0.12], [hx0, y0, hz0 + 0.12]];
      quad(P[3], P[2], P[1], P[0], M.hood);
      quad([hx0, y0 + 0.01, hz0 + 0.12], [hx1, y0 + 0.01, hz0 + 0.12], [hx1, y0 + 0.01, hz1], [hx0, y0 + 0.01, hz1], M.lamella, 0, 0, 6, 1);
      wallX(hx0, hz0, hz1, y0, y1, -1, M.hood); wallX(hx1, hz0, hz1, y0, y1, 1, M.hood);
      // lamella filters on underside (visible from street)
      const lm = M.lamella; const fg = new THREE.PlaneGeometry(hx1 - hx0 - 0.1, 0.42); fg.rotateX(Math.PI / 2 - 0.5); fg.translate((hx0 + hx1) / 2, y0 + 0.11, (hz0 + hz1) / 2 + 0.02);
      const uv = fg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 4); M.lamella.map.wrapS = THREE.RepeatWrapping; add(fg, lm);
    }
    // soffit above hood towards ceiling (white, sloped)
    add(worldUV(quad([8.40, KI.ceil, -1.35], [KI.x1, KI.ceil, -1.35], [KI.x1, 2.82, ZI], [8.40, 2.82, ZI], null), KI.x0, KI.x1, OV.z1, ZI), M.ceilingK);
    // small LED flood light on hood
    box(M.black, 11.12, 11.22, 2.1, 2.18, -1.3, -1.25);
    // flex elbow above window hood
    { const c = new THREE.QuadraticBezierCurve3(new V3(10.55, 2.4, -0.98), new V3(10.55, 2.66, -0.98), new V3(10.55, 2.66, -1.3)); add(new THREE.TubeGeometry(c, 10, 0.13, 14, false), M.duct); }

    // --- back wall hood with pizza boxes + elbow + spiral duct
    const bh = { x0: 9.22, x1: 10.56, y0: 1.93, y1: 2.35, z0: KI.zB, z1: -2.2 };
    box(M.hood, bh.x0, bh.x1, bh.y0 + 0.08, bh.y1, bh.z0, bh.z1);
    { // flared lower skirt
      quad([bh.x0, bh.y0, bh.z1 + 0.03], [bh.x1, bh.y0, bh.z1 + 0.03], [bh.x1, bh.y0 + 0.08, bh.z1], [bh.x0, bh.y0 + 0.08, bh.z1], M.hood);
      wallX(bh.x0, bh.z0, bh.z1 + 0.03, bh.y0, bh.y0 + 0.08, -1, M.hood); wallX(bh.x1, bh.z0, bh.z1 + 0.03, bh.y0, bh.y0 + 0.08, 1, M.hood);
      floorY(bh.y0 + 0.005, bh.x0, bh.x1, bh.z0, bh.z1 + 0.03, -1, M.lamella);
    }
    // ladle hanging
    cyl(M.steel, 0.004, 0.004, 0.36, 4, 10.42, bh.y0 - 0.36, bh.z1 + 0.06);
    { const g = new THREE.SphereGeometry(0.045, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2); g.translate(10.42, bh.y0 - 0.36, bh.z1 + 0.06); add(g, M.steel); }
    // elbow from hood top into back wall
    { const c = new THREE.QuadraticBezierCurve3(new V3(9.45, bh.y1 - 0.02, -2.5), new V3(9.45, 2.8, -2.5), new V3(9.45, 2.8, KI.zB + 0.02)); add(new THREE.TubeGeometry(c, 12, 0.13, 16, false), M.spiral); cyl(M.spiral, 0.135, 0.135, 0.06, 16, 9.45, bh.y1 - 0.02, -2.48); }
    // spiral duct along z towards window hood
    { const g = new THREE.CylinderGeometry(0.13, 0.13, 1.0, 18, 1, true); g.rotateX(Math.PI / 2); g.translate(10.55, 2.66, -1.8); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 5); add(g, M.spiral);
      const c = new THREE.QuadraticBezierCurve3(new V3(10.45, bh.y1 - 0.02, -2.45), new V3(10.55, 2.66, -2.45), new V3(10.55, 2.66, -2.3)); add(new THREE.TubeGeometry(c, 8, 0.13, 14, false), M.spiral); }
    // pizza box stacks on hood
    pbStack(9.82, -2.56, 10, bh.y1); pbStack(10.18, -2.55, 9, bh.y1); pbStack(9.83, -2.42, 4, bh.y1 + 10 * 0.045, 0.32, 0.03);
    // --- worktable along back wall (under hood)
    box(M.steelB, 8.55, 10.5, 0.86, 0.9, KI.zB, -2.3);
    box(M.steelB, 8.56, 10.49, 0.18, 0.2, KI.zB, -2.32);
    for (const x of [8.58, 10.47]) for (const z of [-2.33, -2.87]) box(M.steelB, x - 0.02, x + 0.02, 0, 0.86, z - 0.02, z + 0.02);
    cyl(M.steel, 0.14, 0.14, 0.24, 24, 9.0, 0.9, -2.62, null, false);
    cyl(M.steelB, 0.13, 0.13, 0.12, 20, 9.2, 0.9, -2.58);
    box(M.plasticW, 8.7, 9.0, 0.9, 1.05, -2.8, -2.5);
    for (let k = 0; k < 3; k++) cyl(M.plasticW, 0.12, 0.12, 0.22, 16, 8.85 + k * 0.42, 0.2, -2.6);
    // wall items: foil dispenser, outlets, cables, rail, soap
    box(M.steelB, 8.95, 9.4, 1.32, 1.46, KI.zB, KI.zB + 0.13); { const fg2 = new THREE.CylinderGeometry(0.03, 0.03, 0.4, 10); fg2.rotateZ(Math.PI / 2); fg2.translate(9.175, 1.4, KI.zB + 0.07); add(fg2, std(0xd8dadd, 0.3, 1)); }
    box(M.plasticW, 8.72, 8.78, 1.35, 1.55, KI.zB, KI.zB + 0.04);
    box(M.steel, 8.65, 9.45, 1.72, 1.74, KI.zB, KI.zB + 0.03);
    box(M.plasticW, 10.15, 10.27, 1.15, 1.3, KI.zB, KI.zB + 0.06);

    // --- Brandwand: worktop + shelves
    const wx0 = 11.40, wx1 = KI.x1, wz0 = KI.zB, wz1 = -1.08;
    { const g = new THREE.BoxGeometry(wx1 - wx0, 0.05, wz1 - wz0); g.translate((wx0 + wx1) / 2, 0.905, (wz0 + wz1) / 2); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1.3, uv.getY(i) * 0.4); add(g, M.wood); }
    box(M.steelB, wx0 + 0.02, wx1, 0.2, 0.22, wz0, wz1);
    for (const z of [wz0 + 0.03, wz1 - 0.03, (wz0 + wz1) / 2]) box(M.steelB, wx0 + 0.02, wx0 + 0.06, 0, 0.88, z - 0.02, z + 0.02);
    cyl(M.plasticW, 0.12, 0.11, 0.24, 16, 11.7, 0.22, -2.05); cyl(M.bucketG, 0.11, 0.1, 0.06, 16, 11.7, 0.46, -2.05);
    cyl(std(0x5b5f63, 0.6, 0.3), 0.16, 0.13, 0.14, 18, 11.72, 0.22, -1.55);
    // green bowl + small items on worktop
    { const pts = [[0.0, 0], [0.1, 0.0], [0.15, 0.04], [0.17, 0.11], [0.165, 0.11], [0.0, 0.11]].map(p => new THREE.Vector2(p[0], p[1])); geoAt(new THREE.LatheGeometry(pts, 24), std(0xb7d63a, 0.4), 11.66, 0.93, -1.78); }
    box(std(0xf5f5f3, 0.6), 11.5, 11.85, 0.93, 0.95, -2.12, -1.95);
    cyl(M.steel, 0.03, 0.03, 0.09, 12, 11.62, 0.93, -1.48);
    // slicer near corner
    box(M.steelD, 11.55, 11.9, 0.93, 1.12, -2.78, -2.5); geoAt(new THREE.CylinderGeometry(0.12, 0.12, 0.02, 24), M.steel, 11.6, 1.1, -2.64, 0, 0, Math.PI / 2 - 0.3);
    // steel wall shelves
    const shelf = (y, za, zb, d = 0.32) => { box(M.steelB, wx1 - d, wx1, y - 0.025, y, za, zb); box(M.steelB, wx1 - d, wx1 - d + 0.012, y, y + 0.03, za, zb); for (const z of [za + 0.06, zb - 0.06]) box(M.steelB, wx1 - 0.25, wx1, y - 0.2, y - 0.025, z - 0.01, z + 0.01); };
    shelf(1.62, -2.86, -2.0); shelf(1.30, -2.86, -2.0);
    shelf(1.84, -1.88, -1.12); shelf(1.56, -1.88, -1.12); shelf(1.28, -1.88, -1.12);
    // contents
    pbStack(11.82, -2.65, 6, 1.62, 0.33); pbStack(11.83, -2.25, 4, 1.62, 0.33); pbStack(11.82, -2.43, 3, 1.62 + 6 * 0.045, 0.33);
    box(M.kraft, 11.72, 11.98, 1.3, 1.42, -2.6, -2.1); box(std(0xe8e2d4, 0.8), 11.74, 11.98, 1.3, 1.36, -2.05, -2.0);
    for (let k = 0; k < 4; k++) cyl(std(0xfafafa, 0.35), 0.11, 0.1, 0.02 * (2 + k % 3), 20, 11.84, 1.56, -1.75 + (k > 1 ? 0.27 : 0), null);
    box(M.plasticW, 11.74, 11.96, 1.56, 1.76, -1.45, -1.2);
    { const g = new THREE.CylinderGeometry(0.09, 0.09, 0.05, 20); g.rotateZ(Math.PI / 2); g.translate(11.88, 1.68, -1.55); add(g, M.plasticW); box(M.plasticW, 11.8, 11.97, 1.56, 1.62, -1.62, -1.48); }
    for (let k = 0; k < 5; k++) cyl(M.plasticW, 0.05, 0.05, rr(0.08, 0.18), 12, 11.84, 1.84, -1.82 + k * 0.14);
    for (let k = 0; k < 4; k++) cyl(M.plasticW, 0.06, 0.06, 0.08, 12, 11.85, 1.28, -1.8 + k * 0.17);
    // outlets/soap dispenser on Brandwand
    box(M.plasticW, wx1 - 0.04, wx1, 1.05, 1.18, -1.55, -1.4); box(M.plasticW, wx1 - 0.08, wx1, 1.0, 1.22, -2.75 + 0.42, -2.75 + 0.55);
    // camera
    { const g = new THREE.CylinderGeometry(0.03, 0.03, 0.13, 10); g.rotateZ(Math.PI / 2); g.translate(11.8, 2.95, -1.0); add(g, M.plasticW); }

    // --- downlights in kitchen ceiling
    const dl = [[9.3, -1.9, 0.1], [10.6, -1.9, 0.1], [9.0, -2.55, 0.05], [10.2, -2.55, 0.05], [11.4, -2.3, 0.1], [11.2, -1.55, 0.05]];
    for (const [x, z, r] of dl) { const g = new THREE.CircleGeometry(r, 20); g.rotateX(Math.PI / 2); g.translate(x, KI.ceil - 0.004, z); add(g, E.down); const ring = new THREE.TorusGeometry(r + 0.008, 0.008, 4, 20); ring.rotateX(Math.PI / 2); ring.translate(x, KI.ceil - 0.006, z); add(ring, M.whiteP); }
    // LED tube over counter / passage (Spätkauf ceiling)
    tubeFixture(-0.8, -2.6, 7.1, SP.ceil, true);
  }

  // ================================================================ OVEN ROOM: 2-deck pizza oven
  {
    const ox0 = 10.58, ox1 = 11.82, oz = -4.15, odepth = 1.1;
    // stand
    for (const x of [ox0 + 0.05, ox1 - 0.05]) for (const z of [oz - 0.05, oz - odepth + 0.05]) box(M.steelB, x - 0.03, x + 0.03, 0, 0.72, z - 0.03, z + 0.03);
    box(M.steelB, ox0, ox1, 0.2, 0.23, oz - odepth, oz);
    // body
    box(M.steelB, ox0, ox1, 0.72, 1.78, oz - odepth, oz - 0.02);
    // decks: doors with small windows
    for (const y of [0.78, 1.26]) {
      box(M.steel, ox0 + 0.02, ox1 - 0.25, y, y + 0.42, oz - 0.02, oz + 0.025);
      box(M.blackG, ox0 + 0.25, ox1 - 0.48, y + 0.14, y + 0.3, oz + 0.025, oz + 0.03);
      box(E.oven, ox0 + 0.27, ox1 - 0.50, y + 0.16, y + 0.28, oz + 0.031, oz + 0.033);
      { const hg = new THREE.CylinderGeometry(0.012, 0.012, ox1 - ox0 - 0.5, 8); hg.rotateZ(Math.PI / 2); hg.translate(ox0 + 0.12 + (ox1 - ox0 - 0.5) / 2, y + 0.36, oz + 0.07); add(hg, M.steel); }
      box(M.black, ox1 - 0.24, ox1 - 0.02, y + 0.02, y + 0.4, oz - 0.02, oz + 0.02);
      box(E.ovenDim, ox1 - 0.18, ox1 - 0.08, y + 0.28, y + 0.34, oz + 0.021, oz + 0.023);
    }
    // top + flue
    box(M.steelB, ox0 - 0.02, ox1 + 0.02, 1.78, 1.84, oz - odepth - 0.02, oz + 0.04);
    cyl(M.steel, 0.08, 0.08, KI.ceil - 1.84, 14, (ox0 + ox1) / 2, 1.84, oz - 0.7);
    // shelf above in oven room
    box(M.steelB, OV.x0 + 0.02, OV.x0 + 0.4, 1.95, 1.98, -4.9, -3.1);
    pbStack(OV.x0 + 0.2, -3.5, 7, 1.98, 0.33); pbStack(OV.x0 + 0.2, -4.4, 5, 1.98, 0.33);
    // peel leaning
    geoAt(new THREE.BoxGeometry(0.02, 1.4, 0.03), M.woodPly, OV.x0 + 0.12, 0.7, -3.3, 0, 0, 0.08);
    geoAt(new THREE.BoxGeometry(0.005, 0.32, 0.3), M.steel, OV.x0 + 0.1, 0.12, -3.3, 0, 0, 0.08);
    instanced(new THREE.BoxGeometry(1, 1, 1), M.cardboard, pbList);
  }

  // ---------------- instanced bags (pillow geometry, crinkled foil print tinted per instance) + small balls
  {
    const bagT = canvasTex(128, 192, (g, w, h) => {
      const r = rng32(101); g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, 0, w, 14); g.fillRect(0, h - 12, w, 12);            // crimped seals
      for (let y = 2; y < 14; y += 3) { g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(0, y, w, 1); }
      g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.ellipse(w / 2, h * 0.36, w * 0.36, h * 0.12, -0.15, 0, 7); g.fill();   // logo field
      g.fillStyle = 'rgba(30,20,15,0.75)'; g.font = 'bold 22px sans-serif'; g.textAlign = 'center'; g.fillText('~~~', w / 2, h * 0.39);
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.ellipse(w / 2, h * 0.7, w * 0.3, h * 0.13, 0, 0, 7); g.fill();               // product picture
      g.fillStyle = 'rgba(255,240,200,0.35)'; for (let k = 0; k < 9; k++) g.fillRect(w * 0.3 + r() * w * 0.4, h * 0.62 + r() * h * 0.15, 6, 4);
      for (let k = 0; k < 26; k++) { g.strokeStyle = `rgba(255,255,255,${0.1 + r() * 0.3})`; g.lineWidth = 1 + r() * 2; g.beginPath(); const x = r() * w, y = 14 + r() * (h - 26); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 30, y + 10 + r() * 30); g.stroke(); }
    });
    const bagG = (() => { const g = new THREE.BoxGeometry(1, 1, 1, 6, 8, 1); const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const x = p.getX(i) * 2, y = p.getY(i) * 2; const k = Math.max(0, (1 - x ** 4) * (1 - y ** 6)); p.setZ(i, p.getZ(i) * (0.15 + 0.85 * Math.sqrt(k))); p.setX(i, p.getX(i) * (1 - 0.06 * (1 - y * y))); }
      g.computeVertexNormals(); return g; })();
    instanced(bagG, new THREE.MeshStandardMaterial({ color: 0xffffff, map: bagT, roughness: 0.38, metalness: 0.15 }), bags);
    instanced(new THREE.SphereGeometry(0.02, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25 }), balls);
  }

  // ================================================================ merge buckets
  for (const [mat, list] of buckets) {
    if (!list.length) continue;
    const g = mergeGeometries(list, false);
    if (!g) { console.warn('merge failed', mat); continue; }
    const m = new THREE.Mesh(g, mat);
    if (mat.transparent) m.renderOrder = 5;
    group.add(m);
  }

  // ================================================================ LIGHTS (max 8)
  const lights = [];
  function pl(color, intensity, x, y, z, distance = 0, decay = 2) { const l = new THREE.PointLight(color, intensity, distance, decay); l.position.set(x, y, z); l.castShadow = false; group.add(l); lights.push([l, intensity]); return l; }
  function spot(color, intensity, x, y, z, tx, ty, tz, angle = 1.05, distance = 7.5, decay = 1) {
    const l = new THREE.SpotLight(color, intensity, distance, angle, 0.6, decay); l.position.set(x, y, z); l.target.position.set(tx, ty, tz); l.castShadow = false;
    group.add(l); group.add(l.target); lights.push([l, intensity]); return l;
  }
  const sy = SP.ceil - 0.12;
  spot(0xeef3ff, LI.sp * 0.8, 2.4, sy, -2.6, 2.4, 0, -2.8, 1.2);  // Spätkauf front left
  spot(0xeef3ff, LI.sp * 0.8, 6.8, sy, -2.7, 6.8, 0, -2.9, 1.2);  // Spätkauf front right / Kasse + passage
  spot(0xeef3ff, LI.sp * 0.9, 2.8, sy, -5.4, 2.8, 0, -5.6, 1.2);  // back left
  spot(0xeef3ff, LI.sp * 0.9, 6.4, sy, -5.3, 6.4, 0, -5.5, 1.2);  // back right
  spot(0xffdcb8, LI.k, 10.1, KI.ceil - 0.08, -1.8, 10.3, 0, -1.9, 1.3, 7);   // kitchen (warm-white downlights)
  spot(0xfff0dc, LI.k * 0.45, 10.55, 1.92, -0.8, 10.2, 0, -0.8, 1.15, 3.5, 2);   // LED flood on the window hood (neutral white)
  pl(0xffd5a0, LI.k * 0.5, 11.2, 2.3, -3.7, 4.5, 1.5);                        // oven room
  pl(0xe6f2ff, LI.sp * 0.25, 4.6, 1.1, -5.4, 4.5, 1.5);                       // fridge glow on floor

  // ================================================================ interior IBL (independent of scene.environmentIntensity)
  let envTex = scene.environment || null;
  if (!envTex && ctx.renderer) { try { const pm = new THREE.PMREMGenerator(ctx.renderer); envTex = pm.fromScene(new RoomEnvironment(), 0.04).texture; } catch (e) { envTex = null; } }
  // metals + glass reflect a painted 'shop interior' environment (white ceiling with tubes/downlights, tiled walls, dark
  // window band, dark floor) instead of the generic RoomEnvironment → bright satin stainless like in kueche.jpg
  let shopEnv = null;
  if (ctx.renderer) { try {
    const eq = canvasTex(1024, 512, (g, w, h) => {
      const r = rng32(303); const hz = h * 0.5;
      const sky = g.createLinearGradient(0, 0, 0, hz); sky.addColorStop(0, '#f4efe6'); sky.addColorStop(1, '#d9d3c8'); g.fillStyle = sky; g.fillRect(0, 0, w, hz);
      for (let k = 0; k < 18; k++) { const x = r() * w, y = 20 + r() * (hz * 0.6); g.save(); g.filter = 'blur(6px)'; g.fillStyle = '#ffffff'; if (k % 3) { g.beginPath(); g.ellipse(x, y, 14, 9, 0, 0, 7); g.fill(); } else g.fillRect(x, y, 120, 8); g.restore(); }
      g.fillStyle = '#e6e2da'; g.fillRect(0, hz, w, h * 0.16);                                   // tiled walls
      g.strokeStyle = 'rgba(150,145,138,0.5)'; for (let x = 0; x < w; x += 18) { g.beginPath(); g.moveTo(x, hz); g.lineTo(x, hz + h * 0.16); g.stroke(); }
      g.fillStyle = '#1c2230'; g.fillRect(w * 0.70, hz - h * 0.12, w * 0.16, h * 0.24);             // window / street band
      for (let k = 0; k < 40; k++) { g.fillStyle = pick(['#b9322c', '#e0b84a', '#3a5f9a', '#4f7d3a', '#8a6a48']); g.fillRect(r() * w * 0.65, hz + h * 0.02 + r() * h * 0.1, 10 + r() * 30, 6 + r() * 14); }
      const fl = g.createLinearGradient(0, hz + h * 0.16, 0, h); fl.addColorStop(0, '#5a5856'); fl.addColorStop(1, '#2a2a2a'); g.fillStyle = fl; g.fillRect(0, hz + h * 0.16, w, h);
    });
    eq.mapping = THREE.EquirectangularReflectionMapping;
    const pm = new THREE.PMREMGenerator(ctx.renderer); shopEnv = pm.fromEquirectangular(eq).texture; pm.dispose();
  } catch (e) { shopEnv = null; } }
  const litMats = new Set();
  group.traverse(o => { if (o.isMesh && o.material && (o.material.isMeshStandardMaterial)) litMats.add(o.material); });
  M.ceiling.userData.envK = 0.7; M.ceilingK.userData.envK = 0.8; M.glassTop.userData.envK = 0.4; M.lidGlass.userData.envK = 1.0;
  for (const m of litMats) {
    m.userData.envK = m.userData.envK ?? (m.transparent ? 1.2 : (m.metalness > 0.5 ? 2.6 : 1.0));
    const shiny = shopEnv && (m.metalness > 0.5 || m.transparent || m === M.tiles);
    const e2 = shiny ? shopEnv : envTex; if (e2) { m.envMap = e2; m.needsUpdate = true; }
  }

  // ================================================================ mode hook (night/day)
  const hook = (night) => {
    for (const [m, n, d, base] of emisList) {
      const k = night ? n : d;
      if (m.isMeshBasicMaterial) m.color.copy(base).multiplyScalar(k);
      else m.emissiveIntensity = k;
    }
    for (const [l, i] of lights) l.intensity = i * (night ? 1 : 0.85);
    const e = night ? LI.envN : LI.envD;
    for (const m of litMats) m.envMapIntensity = e * m.userData.envK;
  };
  if (ctx.modeHooks) ctx.modeHooks.push(hook);
  hook(true);

  scene.add(group);
  return {
    group,
    cameras: {
      // fitted to innen.jpg (PnP on Unterzug, Stütze, Club-Mate, Kühlschrank-Sockel; f ≈ 870 px @ 2000×1500): photographer in door D2, phone at ~1.8 m
      // (camera kept just inside the facade's inner face so the D2 door jamb never cuts into the frame; fov widened to keep the framing)
      innen: { pos: [4.24, 1.82, -0.48], target: [4.31, 2.59, -5.42], fov: 85 },
      // fitted to kueche.jpg (PnP on Landi, hoods, wall shelves, pumpkin): standing in the passage in front of the glass counter
      kueche: { pos: [6.51, 1.8, -2.23], target: [11.42, 2.36, -1.43], fov: 60 },
    },
  };
}
