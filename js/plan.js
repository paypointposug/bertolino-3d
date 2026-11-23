// "Nachher"-Planung innen: 5 Fernseher am Unterzug (Spätkauf) + 2 Fernseher über der Bertolino-Theke
// Größe (43/50/55 Zoll) und Ausrichtung (quer/hochkant) je Bereich umschaltbar.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Außenmaße ohne Fuß (typische aktuelle 4K-Fernseher, z. B. TCL P69K-Serie), Meter
export const TV_SIZES = {
  43: { w: 0.963, h: 0.561, d: 0.078 },
  50: { w: 1.116, h: 0.649, d: 0.080 },
  55: { w: 1.229, h: 0.713, d: 0.082 },
};

const BALKEN = { x0: 0.30, x1: 8.45, xc: 4.375, zFace: -3.80, yBot: 2.55, yTop: 3.29 }; // grauer Unterzug, Vorderseite zur Tür
const THEKE = { x: 7.62, zc: -1.95, yTop: 3.16, z0: -0.75, z1: -3.12 };       // über der Glastheke, Bildschirm zum Laden (−x)

export function buildPlan(ctx) {
  const { scene, tex } = ctx;
  const group = new THREE.Group(); group.name = 'plan-innen'; scene.add(group);
  const state = { balken: { size: 50, orient: 'q' }, theke: { size: 50, orient: 'q' } };
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.35, metalness: 0.4 });
  const backMat = new THREE.MeshStandardMaterial({ color: 0x202124, roughness: 0.6, metalness: 0.2 });
  const mountMat = new THREE.MeshStandardMaterial({ color: 0x2a2b2e, roughness: 0.45, metalness: 0.7 });
  const screens = {};
  // Bildschirm: nur die Zollzahl in Blau (noch kein Inhalt/Design)
  const screenMat = (size, orient) => {
    const id = size + '_' + orient;
    if (screens[id]) return screens[id];
    const W = orient === 'q' ? 1024 : 576, H = orient === 'q' ? 576 : 1024;
    const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#0b0f17'); bg.addColorStop(1, '#05070b'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.fillStyle = '#2f8cff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const fs = Math.round(Math.min(W, H) * 0.36);
    g.font = `700 ${fs}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    g.fillText(String(size), W / 2, H / 2 - fs * 0.22);
    g.font = `600 ${Math.round(fs * 0.36)}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    g.fillText('Zoll', W / 2, H / 2 + fs * 0.5);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    const m = new THREE.MeshBasicMaterial({ map: t });
    screens[id] = m; return m;
  };
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x000000, roughness: 0.18, metalness: 0, transparent: true, opacity: 0.12, clearcoat: 1, depthWrite: false });

  // one TV centred at origin, screen facing +z, given orientation
  function tvMesh(size, orient, key) {
    const s = TV_SIZES[size]; const g = new THREE.Group();
    const W = orient === 'q' ? s.w : s.h, H = orient === 'q' ? s.h : s.w;
    const body = new THREE.Mesh(new RoundedBoxGeometry(W, H, s.d * 0.55, 2, 0.006), bodyMat); body.position.z = s.d * 0.225; g.add(body);
    const back = new THREE.Mesh(new RoundedBoxGeometry(W * 0.7, H * 0.7, s.d * 0.5, 2, 0.02), backMat); back.position.z = -s.d * 0.05; g.add(back);
    const bez = 0.008;
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(W - 2 * bez, H - 2 * bez), screenMat(size, orient)); scr.position.z = s.d * 0.5 + 0.0015; g.add(scr);
    const gl = new THREE.Mesh(new THREE.PlaneGeometry(W - 2 * bez, H - 2 * bez), glassMat); gl.position.z = s.d * 0.5 + 0.003; gl.renderOrder = 6; g.add(gl);
    g.userData.W = W; g.userData.H = H; g.userData.D = s.d;
    g.traverse(o => { if (o.isMesh) o.castShadow = false; });
    return g;
  }

  const areas = { balken: new THREE.Group(), theke: new THREE.Group() };
  group.add(areas.balken, areas.theke);
  const clear = (g) => { while (g.children.length) { const c = g.children.pop(); c.traverse(o => { if (o.isMesh && o.geometry) o.geometry.dispose(); }); } };

  function buildBalken() {
    const g = areas.balken; clear(g); const { size, orient } = state.balken;
    const keys = ['b1', 'b2', 'b3', 'b4', 'b5'];
    const s0 = TV_SIZES[size]; const Wt = orient === 'q' ? s0.w : s0.h; const gap = 0.04;
    const total = keys.length * Wt + (keys.length - 1) * gap; const xStart = BALKEN.xc - total / 2;
    keys.forEach((k, i) => {
      const tv = tvMesh(size, orient, k);
      const W = tv.userData.W, H = tv.userData.H, D = tv.userData.D;
      const cx = xStart + Wt / 2 + i * (Wt + gap);
      const cy = orient === 'q' ? (BALKEN.yBot + BALKEN.yTop) / 2 : BALKEN.yTop - 0.03 - H / 2;
      tv.position.set(cx, cy, BALKEN.zFace + 0.035 + D * 0.05);
      g.add(tv);
      // flat wall mount (rails), visible only from the side
      const m = new THREE.Mesh(new THREE.BoxGeometry(Math.min(0.5, W * 0.5), 0.04, 0.035), mountMat);
      m.position.set(cx, Math.min(cy + H * 0.25, BALKEN.yTop - 0.04), BALKEN.zFace + 0.0175); g.add(m);
      const m2 = m.clone(); m2.position.y = Math.max(cy - H * 0.25, BALKEN.yBot + 0.04); if (orient === 'q') g.add(m2);
    });
  }
  function buildTheke() {
    const g = areas.theke; clear(g); const { size, orient } = state.theke;
    const keys = ['t1', 't2']; // t1 links (tiefer im Laden), t2 rechts (Fenster)
    const s = TV_SIZES[size]; const W = orient === 'q' ? s.w : s.h; const H = orient === 'q' ? s.h : s.w;
    const gap = 0.04; const tilt = 0.10;
    keys.forEach((k, i) => {
      const tv = tvMesh(size, orient, k);
      const zc = THEKE.zc + (i === 0 ? -1 : 1) * (W / 2 + gap / 2);
      const cy = THEKE.yTop - H / 2;
      const holder = new THREE.Group(); holder.position.set(THEKE.x, cy, zc); holder.rotation.y = -Math.PI / 2; g.add(holder);
      tv.rotation.x = tilt; holder.add(tv);
      // ceiling mount: pole to the soffit + plate
      const top = 3.50; const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, top - THEKE.yTop + 0.02, 10), mountMat);
      pole.position.set(THEKE.x + 0.06, (top + THEKE.yTop) / 2 - 0.02, zc); g.add(pole);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.012, 0.16), mountMat); plate.position.set(THEKE.x + 0.06, top - 0.006, zc); g.add(plate);
    });
  }
  buildBalken(); buildTheke();

  function setTV(area, size, orient) {
    if (size) state[area].size = size; if (orient) state[area].orient = orient;
    area === 'balken' ? buildBalken() : buildTheke();
    ctx.requestRender && ctx.requestRender();
  }
  function setVariant(neu) { group.visible = !!neu; }
  return { group, setTV, setVariant, state, sizes: TV_SIZES };
}
