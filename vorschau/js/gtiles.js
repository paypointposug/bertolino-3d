// Echte Häuser aus Google Photorealistic 3D Tiles (Map Tiles API) – ersetzt die ausgedachten Häuser aus city.js.
// Straßen, Gehwege, Bäume, Laternen, Ampeln bleiben unsere eigenen (scharf, nachts nass/beleuchtet);
// alles von Google auf Straßen/Gehwegen/Höfen (Autos, Bäume, Menschen aus den Luftbildern) wird flach unter unseren Boden gedrückt.
// Abschalten: ?g=0 · Schlüssel nur für https://paypointposug.github.io/bertolino-3d/* freigegeben.
// STAND 23.11.2026: Google liefert 403 – 3D-Kacheln sind seit 8.7.2025 für Projekte mit EU-Rechnungsadresse gesperrt.
// Modul bleibt als Vorlage für das offene Berliner 3D-Mesh (gleiche Ausrichtung, Flachdrücken, Fassaden-Ausschnitt).
import * as THREE from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { TilesRenderer, GoogleCloudAuthPlugin, GLTFExtensionsPlugin, TileCompressionPlugin, UnloadTilesPlugin } from './lib3dtiles.js?v=11232338';

const KEY = 'AIzaSyD0ZH9VMA45dPEq1YX8uFcGXJmHB_9-_eA';   // Browser-Schlüssel, nur Map Tiles API, nur diese Website, Tageslimit 100 Sitzungen

export async function init(W) {
  const Q = new URLSearchParams(location.search);
  if (Q.get('g') === '0') return null;
  const { scene, camera, renderer } = W;
  const isMobile = W.isMobile;

  // ---------- Bezugssystem: Google (ECEF) -> Laden-Koordinaten (wie city/frame.py, gleiche Näherung wie die OSM-Daten)
  const LAT0 = 52.5494924, LON0 = 13.3532458, KX = 67691.00909111742, KY = 110574;
  const U = [-0.7341256419277045, 0.6790136536655472], NR = [0.6790136536655472, 0.7341256419277045], O = [8.06732126947754, -6.3612481137678945];
  const A = 6378137, E2 = 6.69437999014e-3, d2r = Math.PI / 180;
  const la = LAT0 * d2r, lo = LON0 * d2r, sla = Math.sin(la), cla = Math.cos(la), slo = Math.sin(lo), clo = Math.cos(lo);
  const Nn = A / Math.sqrt(1 - E2 * sla * sla), Mm = A * (1 - E2) / Math.pow(1 - E2 * sla * sla, 1.5);
  const sE = KX / (d2r * Nn * cla), sN = KY / (d2r * Mm);
  let H0 = +(Q.get('gh') || 76.2);                       // Ellipsoid-Höhe Gehweg (wird unten nachgemessen)
  const e = new THREE.Vector3(-slo, clo, 0), n = new THREE.Vector3(-sla * clo, -sla * slo, cla), u = new THREE.Vector3(cla * clo, cla * slo, sla);
  const M = new THREE.Matrix4();
  function buildM() {
    const P0 = new THREE.Vector3((Nn + H0) * cla * clo, (Nn + H0) * cla * slo, (Nn * (1 - E2) + H0) * sla);
    const rx = e.clone().multiplyScalar(sE * U[0]).add(n.clone().multiplyScalar(sN * U[1]));
    const rz = e.clone().multiplyScalar(sE * NR[0]).add(n.clone().multiplyScalar(sN * NR[1]));
    const ry = u;
    const cx = -rx.dot(P0) - (O[0] * U[0] + O[1] * U[1]);
    const cz = -rz.dot(P0) - (O[0] * NR[0] + O[1] * NR[1]);
    const cy = -ry.dot(P0);
    M.set(rx.x, rx.y, rx.z, cx, ry.x, ry.y, ry.z, cy, rz.x, rz.y, rz.z, cz, 0, 0, 0, 1);
  }
  buildM();

  // ---------- Maske: wo flach drücken (Straßen/Gehwege/Höfe)
  const MASK = await (async () => {
    try {
      const meta = await fetch('city/gflat.json').then(r => r.json());
      const im = new Image(); im.src = 'city/gflat.png'; await im.decode();
      const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0);
      const d = g.getImageData(0, 0, im.width, im.height).data; const bits = new Uint8Array(im.width * im.height);
      for (let i = 0; i < bits.length; i++) bits[i] = d[i * 4] > 127 ? 1 : 0;
      return { ...meta, bits };
    } catch (er) { console.warn('gflat fehlt', er); return null; }
  })();
  const flatAt = (x, z) => { if (!MASK) return false; const i = Math.floor((x - MASK.X0) / MASK.CS), j = Math.floor((z - MASK.Z0) / MASK.CS); if (i < 0 || j < 0 || i >= MASK.W || j >= MASK.H) return false; return MASK.bits[j * MASK.W + i] === 1; };
  const FLAT_Y = -0.42;

  // ---------- Kacheln
  const tiles = new TilesRenderer();
  tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: KEY, autoRefreshToken: true }));
  const draco = new DRACOLoader();
  let dpath = 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/';
  try { if (import.meta.resolve) dpath = import.meta.resolve('three/addons/libs/draco/gltf/'); } catch (er) {}
  draco.setDecoderPath(dpath);
  tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco }));
  tiles.registerPlugin(new TileCompressionPlugin({ disableMipmaps: false }));   // Mipmaps an: sonst flimmern Fassaden auf Augenhöhe
  tiles.registerPlugin(new UnloadTilesPlugin());
  tiles.errorTarget = isMobile ? 14 : 8;               // kleiner = schärfer (mehr Daten)
  tiles.lruCache.minSize = 900; tiles.lruCache.maxSize = isMobile ? 1400 : 2600;
  tiles.group.matrixAutoUpdate = false; tiles.group.matrix.copy(M); tiles.group.updateMatrixWorld(true);
  tiles.group.name = 'gtiles';
  scene.add(tiles.group);
  camera.layers.enable(2);
  tiles.setCamera(camera); tiles.setResolutionFromRenderer(camera, renderer);
  W.resizeHooks?.push?.(() => tiles.setResolutionFromRenderer(camera, renderer));
  addEventListener('resize', () => tiles.setResolutionFromRenderer(camera, renderer));

  // Laden-Fassade: Google-Geometrie vor/in unserem Modell ausschneiden (unser Foto-Modell ist genauer)
  renderer.localClippingEnabled = true;
  const CB = { x0: -11.3, x1: 24.3, y0: -3, y1: 19.4, z0: -2.4, z1: 1.8 };
  const clip = [new THREE.Plane(new THREE.Vector3(1, 0, 0), -CB.x1), new THREE.Plane(new THREE.Vector3(-1, 0, 0), CB.x0),
    new THREE.Plane(new THREE.Vector3(0, 1, 0), -CB.y1), new THREE.Plane(new THREE.Vector3(0, -1, 0), CB.y0),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), -CB.z1), new THREE.Plane(new THREE.Vector3(0, 0, -1), CB.z0)];

  // Materialien: unbeleuchtet (Fotos haben ihr Licht schon), nachts abgedunkelt
  const mats = new Set();
  let night = !!W.night;
  const tint = () => { for (const m of mats) { if (night) m.color.setRGB(0.085, 0.095, 0.13); else m.color.setRGB(1.08, 1.07, 1.05); } };
  W.ctx?.modeHooks?.push?.((nt) => { night = nt; tint(); });

  // Flachdrücken + Messung der Bodenhöhe
  const orig = new Map();                // geometry -> Original-Positionen (für Neuberechnung nach Höhenkorrektur)
  const live = new Set();                // aktuell geladene Kachel-Szenen
  const samples = []; let calibrated = Q.has('gh');
  const _A = new THREE.Matrix4(), _Ai = new THREE.Matrix4(), _p = new THREE.Vector3();
  function process(sceneObj, sample) {
    sceneObj.updateMatrixWorld(true);
    const parentInv = new THREE.Matrix4();
    if (sceneObj.parent) parentInv.copy(sceneObj.parent.matrixWorld).invert();
    sceneObj.traverse(c => {
      if (!c.isMesh || !c.geometry) return;
      const pos = c.geometry.attributes.position; if (!pos) return;
      let o = orig.get(c.geometry); if (!o) { o = pos.array.slice(); orig.set(c.geometry, o); }
      // Kachel-lokal -> Gruppe(ECEF) -> Laden
      _A.copy(c.matrixWorld); if (sceneObj.parent) _A.premultiply(parentInv); _A.premultiply(M); _Ai.copy(_A).invert();
      c.geometry.boundingSphere || c.geometry.computeBoundingSphere();
      const fine = c.geometry.boundingSphere.radius < 120;
      const arr = pos.array, isz = pos.itemSize; let changed = false;
      for (let i = 0, k = 0; i < pos.count; i++, k += isz) {
        _p.set(o[k], o[k + 1], o[k + 2]).applyMatrix4(_A);
        if (sample && fine && _p.x > -40 && _p.x < 90 && _p.z > 9.5 && _p.z < 29 && samples.length < 60000) samples.push(_p.y);
        if (flatAt(_p.x, _p.z)) { _p.y = FLAT_Y; _p.applyMatrix4(_Ai); arr[k] = _p.x; arr[k + 1] = _p.y; arr[k + 2] = _p.z; changed = true; }
        else if (arr[k] !== o[k] || arr[k + 1] !== o[k + 1] || arr[k + 2] !== o[k + 2]) { arr[k] = o[k]; arr[k + 1] = o[k + 1]; arr[k + 2] = o[k + 2]; changed = true; }
      }
      if (changed) { pos.needsUpdate = true; c.geometry.computeBoundingSphere(); c.geometry.computeBoundingBox?.(); }
      // Material
      const old = c.material; const map = old && old.map;
      if (!c.userData.__gt) {
        const m = new THREE.MeshBasicMaterial({ map, side: THREE.FrontSide, clippingPlanes: clip, clipIntersection: true });
        if (map) map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        c.material = m; c.userData.__gt = true; mats.add(m); if (old && old !== m) old.dispose?.();
        c.castShadow = false; c.receiveShadow = false;
        if (isMobile) c.layers.set(2);   // am Handy nicht in der nassen Spiegelung (spart die Hälfte)
      }
    });
    tint();
  }
  tiles.addEventListener('load-model', ({ scene: s }) => { live.add(s); process(s, !calibrated); maybeCalibrate(); W.requestRender(); });
  tiles.addEventListener('dispose-model', ({ scene: s }) => { live.delete(s); s.traverse(c => { if (c.material) mats.delete(c.material); if (c.geometry) orig.delete(c.geometry); }); });
  tiles.addEventListener('needs-render', () => W.requestRender());
  tiles.addEventListener('needs-update', () => W.requestRender());

  function maybeCalibrate() {
    if (calibrated || samples.length < 4000) return;
    const s = samples.slice().sort((a, b) => a - b); const ground = s[Math.floor(s.length * 0.12)];
    const dy = ground - (-0.16);
    calibrated = true;
    if (Math.abs(dy) > 0.03) { H0 += dy; buildM(); tiles.group.matrix.copy(M); tiles.group.updateMatrixWorld(true); for (const sc of live) process(sc, false); }
    console.info('[gtiles] Boden kalibriert: Ellipsoid-Höhe', H0.toFixed(2), 'Korrektur', dy.toFixed(2), 'm aus', s.length, 'Punkten');
    W.gtiles.H0 = H0;
  }

  // Quellenangabe (Pflicht): Google + Datenquellen
  const attr = document.createElement('div'); attr.id = 'gattr';
  attr.style.cssText = 'position:fixed;left:8px;bottom:calc(4px + env(safe-area-inset-bottom));z-index:5;font:600 10px/1.25 system-ui,-apple-system,sans-serif;color:rgba(255,255,255,.85);text-shadow:0 1px 2px rgba(0,0,0,.7);pointer-events:none;max-width:60vw';
  document.body.appendChild(attr);
  const attrTarget = []; let lastAttr = '';
  function updAttr() {
    attrTarget.length = 0; try { tiles.getAttributions(attrTarget); } catch (er) {}
    const txt = attrTarget.filter(a => a.type === 'string').map(a => a.value).join(' ');
    const html = attrTarget.length ? `<span style="font:700 12px/1 'Product Sans',system-ui,sans-serif;letter-spacing:-.2px">Google</span> · ${txt.replace(/</g, '&lt;')}` : '';
    if (html !== lastAttr) { attr.innerHTML = html; lastAttr = html; }
  }

  // Häuser aus city.js: unsichtbar, werfen aber weiter Schatten (passt grob zu den echten Häusern)
  let swapped = false;
  function hideCityHouses() {
    if (swapped) return; const root = scene.getObjectByName('city'); if (!root) return;
    const ghost = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    for (const nm of ['fac', 'roofs']) { const m = root.getObjectByName(nm); if (m) { m.material = ghost; m.castShadow = true; } }
    const sky = root.children.find(c => c.name === 'sky' || c.userData?.sky); // Himmel bleibt
    swapped = true; W.emit('gtiles', true);
  }
  let errs = 0;
  tiles.addEventListener('load-error', (ev) => { errs++; if (errs === 1) console.warn('[gtiles] Ladefehler', ev?.error || ev); if (errs > 6 && !swapped) { console.warn('[gtiles] aus – Fallback auf eigene Häuser'); tiles.group.visible = false; } });
  tiles.addEventListener('load-tile-set', () => { /* Wurzel geladen */ });

  let tAttr = 0, firstModels = 0;
  tiles.addEventListener('load-model', () => { firstModels++; if (firstModels === 6) hideCityHouses(); });

  W.gtiles = { tiles, H0, M, setH: (h) => { H0 = h; buildM(); tiles.group.matrix.copy(M); tiles.group.updateMatrixWorld(true); for (const sc of live) process(sc, false); W.requestRender(); }, stats: () => ({ loaded: live.size, mats: mats.size, visible: tiles.visibleTiles.size, downloading: tiles.stats?.downloading, parsing: tiles.stats?.parsing, H0 }) };
  window.__gtiles = W.gtiles;

  return {
    update(dt) {
      camera.updateMatrixWorld();
      tiles.update();
      tAttr += dt; if (tAttr > 0.5) { tAttr = 0; updAttr(); }
      const st = tiles.stats || {};
      return (st.downloading || 0) + (st.parsing || 0) > 0;
    },
  };
}
