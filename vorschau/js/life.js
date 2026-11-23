// Leben im Block (Helfer „Leben“, 23.11.2026)
// • Straßenbahn auf der Seestraße: 5-teiliger Niederflur-Zug (Flexity-artig, gelb, ohne Logo), Linie „M13“,
//   fährt auf den echten Gleisen (city.json tram + city_vis.json farTram) in beide Richtungen, hält am Bahnsteig,
//   Türen öffnen zur Bahnsteig-Seite, klingelt, hält an Ampeln (W.signals), bremst vor Autos / Menschen auf dem Gleis, Licht nachts.
// • Bahnsteige (Wartehalle, H-Schild, Bank), Oberleitung mit Masten.
// • Tauben auf dem Gehweg (nicken, picken), fliegen auf, wenn man nah kommt / ein Auto kommt / geschossen wird; nachts schlafen sie (weg).
// Schnittstellen: W.obstacles (Wagenkästen {x,z,yaw,len,wid,v,kind:'tram'}), W.stops (Haltestellen) + Ereignis 'doors' {stop, open, pts, kind}.
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const hdg = (dx, dz) => Math.atan2(dx, dz);
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------------------------------------------------------------------------------------------- Linien-Helfer
function mkLine(pts) {
  const n = pts.length, xs = new Float64Array(n), zs = new Float64Array(n), cum = new Float64Array(n);
  for (let i = 0; i < n; i++) { xs[i] = pts[i][0]; zs[i] = pts[i][1]; if (i) cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]); }
  return { xs, zs, cum, len: cum[n - 1], h: 0 };
}
function lineAt(L, s, o) {
  s = clamp(s, 0, L.len); const c = L.cum; let lo = 0, hi = c.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= s) lo = m; else hi = m; }
  const d = c[lo + 1] - c[lo] || 1, t = (s - c[lo]) / d, dx = (L.xs[lo + 1] - L.xs[lo]) / d, dz = (L.zs[lo + 1] - L.zs[lo]) / d;
  o.x = L.xs[lo] + (L.xs[lo + 1] - L.xs[lo]) * t; o.z = L.zs[lo] + (L.zs[lo + 1] - L.zs[lo]) * t; o.dx = dx; o.dz = dz; return o;
}
function lineProject(L, x, z, s0 = 0, s1 = Infinity) {
  let best = 1e18, bs = 0;
  for (let i = 0; i < L.xs.length - 1; i++) {
    if (L.cum[i + 1] < s0 || L.cum[i] > s1) continue;
    const ax = L.xs[i], az = L.zs[i], dx = L.xs[i + 1] - ax, dz = L.zs[i + 1] - az, l2 = dx * dx + dz * dz || 1;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1), px = ax + dx * t - x, pz = az + dz * t - z, d = px * px + pz * pz;
    if (d < best) { best = d; bs = L.cum[i] + t * Math.sqrt(l2); }
  }
  return [bs, Math.sqrt(best)];
}
// Polylinie gleichmäßig abtasten und Ecken leicht runden (Gleis-Bögen)
function smoothLine(pts, step = 1) {
  const L = mkLine(pts), n = Math.max(2, Math.ceil(L.len / step)), out = [], o = {};
  for (let i = 0; i <= n; i++) { lineAt(L, L.len * i / n, o); out.push([o.x, o.z]); }
  for (let pass = 0; pass < 4; pass++) for (let i = 1; i < out.length - 1; i++) { out[i] = [(out[i - 1][0] + out[i][0] * 2 + out[i + 1][0]) / 4, (out[i - 1][1] + out[i][1] * 2 + out[i + 1][1]) / 4]; }
  return out;
}
function joinPts(...lines) {
  const out = [];
  for (const l of lines) { if (!l || !l.length) continue; for (const p of l) { const q = out[out.length - 1]; if (q && Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.6) continue; out.push([p[0], p[1]]); } }
  return out;
}
const cvs = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

// ---------------------------------------------------------------------------------------------- Straßenbahn: Maße
const TW = 2.40, TH = 3.40, ND = 0.95, GAP = 0.42;
const SECS = [{ cab: true, len: 8.2, door: -1.15 }, { len: 7.2, door: 0 }, { len: 7.2, door: 0, panto: true }, { len: 7.2, door: 0 }, { cab: true, rev: true, len: 8.2, door: -1.15 }];
const T_LEN = ND * 2 + SECS.reduce((a, b) => a + b.len, 0) + GAP * (SECS.length - 1);
// Querschnitt (rechte Hälfte, unten → oben), Stütze y = über Schienen-Oberkante
const OUT = [[1.08, 0.14], [1.20, 0.40], [1.20, 1.00], [1.175, 2.62], [1.13, 3.00], [1.02, 3.22], [0.80, 3.35], [0.40, 3.40]];
const OUTL = [...OUT, ...OUT.slice().reverse().map(([x, y]) => [-x, y])];

export async function init(W) {
  const { THREE, scene, camera } = W;
  const MOBILE = !!W.isMobile;
  const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js');
  const root = new THREE.Group(); root.name = 'life'; scene.add(root);
  W.obstacles = W.obstacles || [];
  W.stops = W.stops || [];
  W.shootables = W.shootables || [];
  const rnd = mulberry(4711);
  const NIGHT = { on: !!W.night };
  const maxAniso = W.renderer && W.renderer.capabilities ? Math.min(8, W.renderer.capabilities.getMaxAnisotropy()) : 4;
  const railY = (x, z) => (W.groundY && W.groundY(x, z) < -0.07 ? -0.135 : 0.02);

  // ============================================================================================ Ton
  const sfx = (() => {
    const A = { ctx: null, master: null, noise: null };
    function unlock() {
      if (A.ctx) { if (A.ctx.state === 'suspended') A.ctx.resume(); return; }
      try {
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
        A.ctx = new AC(); A.master = A.ctx.createGain(); A.master.gain.value = 0.55; A.master.connect(A.ctx.destination);
        const len = A.ctx.sampleRate, buf = A.ctx.createBuffer(1, len, A.ctx.sampleRate), d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; A.noise = buf;
      } catch (e) { A.ctx = null; }
    }
    for (const ev of ['pointerdown', 'keydown', 'touchend']) addEventListener(ev, unlock, { capture: true, passive: true });
    const ok = () => A.ctx && A.ctx.state === 'running';
    const _d = new THREE.Vector3();
    function spatial(x, z, base) {
      const dx = x - camera.position.x, dz = z - camera.position.z, d = Math.hypot(dx, dz);
      const g = base / (1 + Math.pow(d / 10, 1.3)); camera.getWorldDirection(_d); const rx = -_d.z, rz = _d.x, rl = Math.hypot(rx, rz) || 1;
      return { g, pan: clamp((dx * rx + dz * rz) / rl / (d + 2), -0.85, 0.85) };
    }
    function out(node, pan) { if (A.ctx.createStereoPanner) { const p = A.ctx.createStereoPanner(); p.pan.value = pan; node.connect(p).connect(A.master); } else node.connect(A.master); }
    return {
      bell(x, z, n = 2) { // Straßenbahn-Klingel: helles „Ding-ding“
        if (!ok()) return; const sp = spatial(x, z, 0.22); if (sp.g < 0.004) return; const t0 = A.ctx.currentTime;
        for (let k = 0; k < n; k++) {
          const t = t0 + k * 0.2, g = A.ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(sp.g, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0004, t + 0.9);
          for (const [f, a] of [[1870, 1], [2830, 0.45], [4470, 0.2]]) { const o = A.ctx.createOscillator(); o.frequency.value = f; const ga = A.ctx.createGain(); ga.gain.value = a; o.connect(ga).connect(g); o.start(t); o.stop(t + 0.95); }
          out(g, sp.pan);
        }
      },
      flutter(x, z) { // Tauben fliegen auf
        if (!ok() || !A.noise) return; const sp = spatial(x, z, 0.12); if (sp.g < 0.004) return; const t0 = A.ctx.currentTime;
        for (let k = 0; k < 7; k++) { const t = t0 + k * 0.055 + Math.random() * 0.03, s = A.ctx.createBufferSource(); s.buffer = A.noise; const bp = A.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900 + Math.random() * 500; bp.Q.value = 0.9; const g = A.ctx.createGain(); g.gain.setValueAtTime(sp.g * (1 - k * 0.1), t); g.gain.exponentialRampToValueAtTime(0.0004, t + 0.07); s.connect(bp).connect(g); out(g, sp.pan); s.start(t, Math.random() * 0.8); s.stop(t + 0.08); }
      },
      hum: (() => { let h = null; return (x, z, v) => { // leises Fahrgeräusch der nächsten Bahn
        if (!ok()) return; if (!h) { const o = A.ctx.createOscillator(), o2 = A.ctx.createOscillator(), lp = A.ctx.createBiquadFilter(), g = A.ctx.createGain(); o.type = 'sawtooth'; o2.type = 'triangle'; lp.type = 'lowpass'; lp.frequency.value = 520; g.gain.value = 0; o.connect(lp); o2.connect(lp); lp.connect(g); const p = A.ctx.createStereoPanner ? A.ctx.createStereoPanner() : null; if (p) { g.connect(p).connect(A.master); } else g.connect(A.master); o.start(); o2.start(); h = { o, o2, g, p }; }
        const sp = spatial(x, z, 0.05 * clamp(v / 8, 0, 1.2)), t = A.ctx.currentTime;
        h.g.gain.setTargetAtTime(sp.g, t, 0.25); h.o.frequency.setTargetAtTime(60 + v * 9, t, 0.3); h.o2.frequency.setTargetAtTime(120 + v * 21, t, 0.3); if (h.p) h.p.pan.setTargetAtTime(sp.pan, t, 0.2);
      }; })(),
    };
  })();

  // ============================================================================================ Texturen der Bahn
  function sideAtlas() {
    const S = 2048, H = 1024, c = cvs(S, H), g = c.getContext('2d'), e = cvs(S, H), ge = e.getContext('2d'), r = cvs(S, H), gr = r.getContext('2d');
    ge.fillStyle = '#000'; ge.fillRect(0, 0, S, H); gr.fillStyle = 'rgb(0,120,40)'; gr.fillRect(0, 0, S, H);
    const rows = [{ top: 0, sec: SECS[0] }, { top: 512, sec: SECS[1] }];
    for (const { top, sec } of rows) {
      const len = sec.len, PX = (zm) => (zm + len / 2) / len * S, PY = (ym) => top + (1 - ym / TH) * 512;
      const rect = (ctx, z0, z1, y0, y1) => ctx.fillRect(PX(z0), PY(y1), PX(z1) - PX(z0), PY(y0) - PY(y1));
      // Lack
      const grd = g.createLinearGradient(0, PY(3.0), 0, PY(0.4)); grd.addColorStop(0, '#f6cc12'); grd.addColorStop(1, '#e6b800');
      g.fillStyle = grd; g.fillRect(0, top, S, 512);
      g.fillStyle = '#a4a7a9'; rect(g, -len / 2, len / 2, 3.08, 3.45); gr.fillStyle = 'rgb(0,150,60)'; rect(gr, -len / 2, len / 2, 3.08, 3.45);   // Dach
      g.fillStyle = '#2b2c2e'; rect(g, -len / 2, len / 2, 0.0, 0.42); gr.fillStyle = 'rgb(0,200,10)'; rect(gr, -len / 2, len / 2, 0, 0.42);    // Schürze
      g.fillStyle = '#1a1a1a'; rect(g, -len / 2, len / 2, 0.42, 0.46);
      // Fensterband (schwarz) mit Scheiben
      g.fillStyle = '#16191b'; rect(g, -len / 2, len / 2, 1.0, 2.64); gr.fillStyle = 'rgb(0,70,40)'; rect(gr, -len / 2, len / 2, 1.0, 2.64);
      const dz = sec.door, dw = 0.7;   // Tür-Mitte, halbe Breite
      const cabZ = sec.cab ? len / 2 - 1.55 : Infinity;
      let z = -len / 2 + 0.25;
      const winList = [];
      while (z < len / 2 - 0.2) {
        let w = 1.32; let z1 = Math.min(z + w, len / 2 - 0.2);
        if (z1 > dz - dw - 0.12 && z < dz + dw + 0.12) { z = dz + dw + 0.2; continue; }
        if (z1 > dz - dw - 0.12 && z < dz - dw) z1 = dz - dw - 0.16;
        if (sec.cab && z1 > cabZ - 0.1) z1 = cabZ - 0.18;
        if (z1 - z > 0.4) winList.push([z, z1]);
        z = z1 + 0.13;
        if (sec.cab && z >= cabZ - 0.2) break;
      }
      for (const [a, b] of winList) {
        const wg = g.createLinearGradient(0, PY(2.56), 0, PY(1.08)); wg.addColorStop(0, '#7d8d97'); wg.addColorStop(0.3, '#4f5f69'); wg.addColorStop(0.62, '#36434c'); wg.addColorStop(1, '#2a343b');
        g.fillStyle = wg; rect(g, a, b, 1.08, 2.56); gr.fillStyle = 'rgb(0,22,0)'; rect(gr, a, b, 1.08, 2.56);
        // Innenraum: Sitzlehnen, Haltestangen, Deckenlicht
        g.fillStyle = 'rgba(25,30,34,0.55)'; for (let zz = a + 0.15; zz < b - 0.25; zz += 0.48) { g.beginPath(); g.roundRect(PX(zz), PY(1.52), PX(zz + 0.36) - PX(zz), PY(1.08) - PY(1.52), 6); g.fill(); }
        g.fillStyle = 'rgba(200,205,200,0.35)'; for (let zz = a + 0.55; zz < b - 0.2; zz += 0.9) g.fillRect(PX(zz), PY(2.52), 3, PY(1.1) - PY(2.52));
        g.fillStyle = 'rgba(230,235,235,0.25)'; rect(g, a, b, 2.42, 2.5);
        g.fillStyle = 'rgba(255,255,255,0.09)'; g.beginPath(); g.moveTo(PX(a + 0.1), PY(2.54)); g.lineTo(PX(a + 0.55), PY(2.54)); g.lineTo(PX(a + 0.25), PY(1.12)); g.lineTo(PX(a + 0.05), PY(1.12)); g.fill();
        // Innenraum nachts: warmes Licht, oben heller
        const eg = ge.createLinearGradient(0, PY(2.56), 0, PY(1.08)); eg.addColorStop(0, '#fff1d6'); eg.addColorStop(1, '#a08a66'); ge.fillStyle = eg; rect(ge, a + 0.03, b - 0.03, 1.1, 2.54);
        g.fillStyle = 'rgba(0,0,0,0.35)'; rect(g, a, b, 1.08, 1.12); // Haltestange-Schatten unten
      }
      if (sec.cab) { // Führerstand-Seitenfenster
        { const wg = g.createLinearGradient(0, PY(2.5), 0, PY(1.25)); wg.addColorStop(0, '#76858f'); wg.addColorStop(1, '#2c363d'); g.fillStyle = wg; } rect(g, cabZ, len / 2 - 0.12, 1.25, 2.5); gr.fillStyle = 'rgb(0,22,0)'; rect(gr, cabZ, len / 2 - 0.12, 1.25, 2.5);
        g.fillStyle = '#0d0f11'; rect(g, cabZ - 0.08, cabZ, 1.0, 2.64);
      }
      // Türöffnung (dahinter Innenraum, Türflügel kommen als eigene Teile davor)
      g.fillStyle = '#121315'; rect(g, dz - dw, dz + dw, 0.33, 2.44); g.fillStyle = '#5d5f61'; rect(g, dz - dw, dz + dw, 0.33, 0.40);
      { const ig = g.createLinearGradient(0, PY(2.4), 0, PY(0.4)); ig.addColorStop(0, '#3b3e41'); ig.addColorStop(1, '#17181a'); g.fillStyle = ig; rect(g, dz - dw + 0.05, dz + dw - 0.05, 0.42, 2.4); g.fillStyle = '#b8b9b4'; rect(g, dz - 0.02, dz + 0.02, 0.42, 2.38); }
      ge.fillStyle = '#806e52'; rect(ge, dz - dw + 0.05, dz + dw - 0.05, 0.42, 2.4);
      g.fillStyle = '#0b0b0c'; rect(g, dz - dw - 0.04, dz - dw, 0.3, 2.48); rect(g, dz + dw, dz + dw + 0.04, 0.3, 2.48); rect(g, dz - dw - 0.04, dz + dw + 0.04, 2.44, 2.5);
      // Zierlinie + Lüftungsgitter
      g.fillStyle = 'rgba(30,30,30,0.5)'; rect(g, -len / 2, len / 2, 2.98, 3.0);
      g.fillStyle = '#5f6163'; for (let k = 0; k < 6; k++) rect(g, len / 2 - 1.2 + k * 0.12, len / 2 - 1.14 + k * 0.12, 2.75, 2.92);
      // Fahrgastinfo (kleine Linienanzeige neben der Tür)
      g.fillStyle = '#111'; rect(g, dz + dw + 0.15, dz + dw + 0.95, 2.70, 2.92); g.fillStyle = '#ff9d1f'; g.font = 'bold 26px "Arial Narrow", Arial, sans-serif'; g.textBaseline = 'middle'; g.fillText('M13', PX(dz + dw + 0.2), PY(2.81));
      ge.fillStyle = '#ff9d1f'; rect(ge, dz + dw + 0.18, dz + dw + 0.62, 2.74, 2.88);
      // leichter Schmutz unten
      const dg = g.createLinearGradient(0, PY(1.0), 0, PY(0.42)); dg.addColorStop(0, 'rgba(60,50,30,0)'); dg.addColorStop(1, 'rgba(60,50,30,0.22)'); g.fillStyle = dg; rect(g, -len / 2, len / 2, 0.42, 1.0);
    }
    const mk = (cc, srgb) => { const t = new THREE.CanvasTexture(cc); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = maxAniso; return t; };
    return { map: mk(c, true), em: mk(e, true), rm: mk(r, false) };
  }
  function frontAtlas() {
    const S = 1024, c = cvs(S, S), g = c.getContext('2d'), e = cvs(S, S), ge = e.getContext('2d'), r = cvs(S, S), gr = r.getContext('2d');
    g.fillStyle = '#e8b800'; g.fillRect(0, 0, S, S); ge.fillStyle = '#000'; ge.fillRect(0, 0, S, S); gr.fillStyle = 'rgb(0,120,40)'; gr.fillRect(0, 0, S, S);
    const front = (ox, dest) => {
      const PX = (x) => ox + (0.5 + x / 2.6) * 512, PY = (y) => (1 - y / 3.5) * 512;
      const R = (ctx, x0, x1, y0, y1, rad = 0) => { ctx.beginPath(); ctx.roundRect(PX(x0), PY(y1), PX(x1) - PX(x0), PY(y0) - PY(y1), rad); ctx.fill(); };
      const grd = g.createLinearGradient(0, PY(3.4), 0, PY(0)); grd.addColorStop(0, '#f6cd16'); grd.addColorStop(1, '#e2b400'); g.fillStyle = grd; g.fillRect(ox, 0, 512, 512);
      g.fillStyle = '#c9cbcc'; R(g, -1.3, 1.3, 3.18, 3.5);
      g.fillStyle = '#26272a'; R(g, -1.3, 1.3, 0, 0.44); gr.fillStyle = 'rgb(0,200,10)'; R(gr, -1.3, 1.3, 0, 0.44);
      g.fillStyle = '#0c0d0f'; R(g, -1.14, 1.14, 1.18, 3.08, 26);                               // schwarzer Rahmen
      const wg = g.createLinearGradient(0, PY(3), 0, PY(1.3)); wg.addColorStop(0, '#7f8e98'); wg.addColorStop(0.35, '#4d5c66'); wg.addColorStop(1, '#27313a');
      g.fillStyle = wg; R(g, -1.04, 1.04, 1.28, 2.98, 22); gr.fillStyle = 'rgb(0,20,0)'; R(gr, -1.04, 1.04, 1.28, 2.98, 22);
      g.fillStyle = 'rgba(30,34,38,0.6)'; R(g, -0.95, -0.25, 1.3, 1.62, 8); g.fillStyle = 'rgba(30,34,38,0.5)'; R(g, -0.55, -0.35, 1.6, 1.95, 30);  // Fahrerpult + Fahrer
      g.fillStyle = 'rgba(255,255,255,0.08)'; g.beginPath(); g.moveTo(PX(-0.9), PY(2.95)); g.lineTo(PX(-0.2), PY(2.95)); g.lineTo(PX(-0.7), PY(1.35)); g.lineTo(PX(-0.98), PY(1.35)); g.fill();
      // Zielanzeige
      g.fillStyle = '#060606'; R(g, -0.92, 0.92, 2.66, 2.94, 4);
      for (const ctx of [g, ge]) { ctx.fillStyle = '#ffa221'; ctx.font = 'bold 30px "Arial Narrow", Arial, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText('M13', PX(-0.86), PY(2.8)); ctx.font = 'bold 22px "Arial Narrow", Arial, sans-serif'; ctx.fillText(dest, PX(-0.42), PY(2.8)); }
      // Scheinwerfer + Rücklichter
      for (const s of [-1, 1]) {
        g.fillStyle = '#0d0e10'; R(g, s > 0 ? 0.56 : -1.02, s > 0 ? 1.02 : -0.56, 0.6, 0.84, 8);
        g.fillStyle = '#dfe5ea'; R(g, s > 0 ? 0.6 : -0.9, s > 0 ? 0.9 : -0.6, 0.64, 0.80, 7); gr.fillStyle = 'rgb(0,20,200)'; R(gr, s > 0 ? 0.6 : -0.9, s > 0 ? 0.9 : -0.6, 0.64, 0.80, 7);
        ge.fillStyle = '#fff8e8'; R(ge, s > 0 ? 0.62 : -0.88, s > 0 ? 0.88 : -0.62, 0.66, 0.78, 6);
        g.fillStyle = '#7b0b0d'; R(g, s > 0 ? 0.91 : -0.99, s > 0 ? 0.99 : -0.91, 0.64, 0.80, 3);
      }
      g.fillStyle = '#1c1d20'; R(g, -0.32, 0.32, 0.18, 0.5, 10);   // Kupplungsklappe
      g.fillStyle = 'rgba(0,0,0,0.25)'; R(g, -1.3, 1.3, 1.02, 1.06);
    };
    front(0, 'S Warschauer Str.'); front(512, 'Virchow-Klinikum');
    { // Türflügel: 256 × 512 Pixel = 0,66 × 2,08 m
      const ox = 0, oy = 512, PX = (u) => ox + u * 256, PY = (v) => oy + (1 - v) * 512;
      g.fillStyle = '#e4b600'; g.fillRect(ox, oy, 256, 512);
      g.fillStyle = '#16191b'; g.fillRect(PX(0.06), PY(0.97), PX(0.94) - PX(0.06), PY(0.08) - PY(0.97));
      const wg = g.createLinearGradient(0, PY(0.95), 0, PY(0.1)); wg.addColorStop(0, '#7a8992'); wg.addColorStop(0.35, '#4b5a63'); wg.addColorStop(1, '#2b353c'); g.fillStyle = wg; g.fillRect(PX(0.1), PY(0.95), PX(0.9) - PX(0.1), PY(0.12) - PY(0.95));
      gr.fillStyle = 'rgb(0,22,0)'; gr.fillRect(PX(0.1), PY(0.95), PX(0.9) - PX(0.1), PY(0.12) - PY(0.95));
      g.fillStyle = '#bfc2c3'; g.fillRect(PX(0.1), PY(0.55), PX(0.9) - PX(0.1), 4);
      ge.fillStyle = '#7d6a4d'; ge.fillRect(PX(0.15), PY(0.92), PX(0.85) - PX(0.15), PY(0.33) - PY(0.92));
      g.fillStyle = '#111'; g.fillRect(PX(0.95), oy, 13, 512); g.fillStyle = '#2b2c2e'; g.fillRect(ox, PY(0.06), 256, PY(0) - PY(0.06));
      g.fillStyle = '#1f7a3b'; g.beginPath(); g.arc(PX(0.8), PY(0.5), 9, 0, TAU); g.fill(); ge.fillStyle = '#2f9a4c'; ge.beginPath(); ge.arc(PX(0.8), PY(0.5), 7, 0, TAU); ge.fill();
    }
    const mk = (cc, srgb) => { const t = new THREE.CanvasTexture(cc); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = maxAniso; return t; };
    return { map: mk(c, true), em: mk(e, true), rm: mk(r, false) };
  }

  // ============================================================================================ Geometrie der Bahn
  function outlineNormals(ol) { // je Ecke gemittelte Normale (außer an den Unterkanten: scharf)
    const n = ol.length, segN = [];
    for (let i = 0; i < n; i++) { const a = ol[i], b = ol[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; segN.push([dy / l, -dx / l]); }
    return { segN };
  }
  function sectionGeo(sec) {
    const len = sec.len, z0 = -len / 2, z1 = len / 2, rowV = sec.cab ? 0.5 : 0, n = OUTL.length, { segN } = outlineNormals(OUTL);
    const pos = [], nor = [], uv = [];
    const V = (y) => rowV + clamp(y / TH, 0, 0.999) * 0.5;
    const sharpAt = (i) => i === 0 || i === n - 1 || i === OUT.length - 1 + 0 && false;
    for (let i = 0; i < n; i++) {
      const a = OUTL[i], b = OUTL[(i + 1) % n];
      const bottom = i === n - 1;   // Unterseite
      let na = segN[i], nb = segN[i];
      if (!bottom) {
        const pa = segN[(i - 1 + n) % n], pb = segN[(i + 1) % n];
        if (i !== 0) { na = [(na[0] + pa[0]) / 2, (na[1] + pa[1]) / 2]; }
        if (i + 1 !== n - 1) { nb = [(nb[0] + pb[0]) / 2, (nb[1] + pb[1]) / 2]; }
      }
      void sharpAt;
      const la = Math.hypot(na[0], na[1]) || 1, lb = Math.hypot(nb[0], nb[1]) || 1;
      const quad = [[a, z0, na, la, 0], [b, z0, nb, lb, 0], [b, z1, nb, lb, 1], [a, z0, na, la, 0], [b, z1, nb, lb, 1], [a, z1, na, la, 1]];
      // Dreiecke so, dass die Außenseite nach außen zeigt
      for (const [p, z, nn, l, u] of quad) {
        pos.push(p[0], p[1], z); nor.push(nn[0] / l, nn[1] / l, 0);
        uv.push(bottom ? 0.5 : u, bottom ? rowV + 0.01 : V(p[1]));
      }
    }
    // Stirnflächen (bei Mittelteilen in den Bälgen versteckt; bei Kopfteilen hinten)
    for (const [z, nz] of [[z0, -1], [z1, 1]]) {
      if (sec.cab && nz > 0) continue;
      for (let i = 0; i < n; i++) { const a = OUTL[i], b = OUTL[(i + 1) % n]; const tri = nz > 0 ? [[0, 1.8], a, b] : [[0, 1.8], b, a]; for (const p of tri) { pos.push(p[0], p[1], z); nor.push(0, 0, nz); uv.push(0.5, rowV + 0.02); } }
    }
    let g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    // Dachaufbauten (Klima / Stromrichter)
    const parts = [g];
    const roofBox = (w, h, d, z) => { const b = new THREE.BoxGeometry(w, h, d, 1, 1, 1); b.translate(0, TH + h / 2 - 0.02, z); const u = b.attributes.uv; for (let k = 0; k < u.count; k++) u.setXY(k, 0.5, rowV + 0.49); return b; };
    if (sec.cab) parts.push(roofBox(1.3, 0.22, 2.0, -0.9)); else parts.push(roofBox(1.4, 0.26, 2.6, sec.panto ? -2.0 : 0.2));
    g = mergeGeometries(parts.map(p => p.index ? p.toNonIndexed() : p));
    g.computeBoundingSphere(); return g;
  }
  function noseGeo(dest) {
    const n = OUTL.length, rings = [0, 0.25, 0.5, 0.72, 0.88, 1];
    const f = (y) => (y < 1.15 ? 1 : 1 - 0.45 * Math.pow((y - 1.15) / (TH - 1.15), 1.15));
    const P = (p, t) => { const sx = 1 - 0.075 * t * t, k = f(p[1]); const y = p[1] - 0.05 * t * t * Math.pow(p[1] / TH, 6); return [p[0] * sx, y, ND * t * k]; };
    const UV = (x, y) => [((0.5 + x / 2.6) * 0.5) + (dest ? 0.5 : 0), 0.5 + clamp(y / 3.5, 0, 1) * 0.5];
    const pos = [], uv = [];
    for (let r = 0; r < rings.length - 1; r++) for (let i = 0; i < n; i++) {
      const a = OUTL[i], b = OUTL[(i + 1) % n];
      const A0 = P(a, rings[r]), B0 = P(b, rings[r]), A1 = P(a, rings[r + 1]), B1 = P(b, rings[r + 1]);
      for (const q of [A0, B0, B1, A0, B1, A1]) { pos.push(q[0], q[1], q[2]); const u = UV(q[0], q[1]); uv.push(u[0], u[1]); }
    }
    const cz = P([0, 1.8], 1);
    for (let i = 0; i < n; i++) { const a = P(OUTL[i], 1), b = P(OUTL[(i + 1) % n], 1); for (const q of [[0, 1.8, cz[2]], a, b]) { pos.push(q[0], q[1], q[2]); const u = UV(q[0], q[1]); uv.push(u[0], u[1]); } }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals(); g.computeBoundingSphere(); return g;
  }
  function doorGeo() { const g = new THREE.PlaneGeometry(0.66, 2.08); g.translate(0, 0.33 + 1.04, 0); const u = g.attributes.uv; for (let k = 0; k < u.count; k++) u.setXY(k, u.getX(k) * 0.25, u.getY(k) * 0.5); return g; }
  function pantoGeo() {
    const parts = [];
    const bar = (x0, y0, z0, x1, y1, z1, r) => { const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1), d = b.clone().sub(a), l = d.length(); const c = new THREE.CylinderGeometry(r, r, l, 6); c.translate(0, l / 2, 0); c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())); c.translate(a.x, a.y, a.z); parts.push(c); };
    const base = new THREE.BoxGeometry(1.2, 0.12, 1.4); base.translate(0, TH + 0.06, 0); parts.push(base);
    for (const s of [-0.35, 0.35]) bar(s, TH + 0.12, -0.5, s * 0.4, TH + 1.25, 0.55, 0.03);   // Unterarm
    for (const s of [-0.25, 0.25]) bar(s * 0.4 / 0.25 * 0.35, TH + 1.25, 0.55, s, TH + 2.28, -0.05, 0.022); // Oberarm
    bar(-0.8, TH + 2.3, -0.05, 0.8, TH + 2.3, -0.05, 0.03);  // Schleifleiste
    for (const s of [-1, 1]) bar(s * 0.8, TH + 2.3, -0.05, s * 0.95, TH + 2.2, -0.05, 0.02);
    for (const s of [-0.4, 0.4]) { const iso = new THREE.CylinderGeometry(0.05, 0.06, 0.16, 8); iso.translate(s, TH + 0.2, 0.55); parts.push(iso); }
    const g = mergeGeometries(parts.map(p => p.index ? p.toNonIndexed() : p)); g.computeBoundingSphere(); return g;
  }

  // ============================================================================================ Bahn: Netze
  const side = sideAtlas(), front = frontAtlas();
  const bodyMat = new THREE.MeshStandardMaterial({ map: side.map, roughnessMap: side.rm, metalnessMap: side.rm, emissiveMap: side.em, emissive: 0xffffff, emissiveIntensity: 0, roughness: 1, metalness: 1, envMapIntensity: 0.9 });
  const frontMat = new THREE.MeshStandardMaterial({ map: front.map, roughnessMap: front.rm, metalnessMap: front.rm, emissiveMap: front.em, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 1, metalness: 1, side: THREE.DoubleSide, envMapIntensity: 0.9 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.85, metalness: 0.1 });
  const jointMat = new THREE.MeshStandardMaterial({ color: 0x3a3b3d, roughness: 0.92, metalness: 0 });
  const pantoMat = new THREE.MeshStandardMaterial({ color: 0x3b3e42, roughness: 0.5, metalness: 0.6 });
  const MAXT = MOBILE ? 2 : 3;
  const mkI = (geo, mat, cap, cast = true) => { const m = new THREE.InstancedMesh(geo, mat, cap); m.count = 0; m.frustumCulled = false; m.castShadow = cast && !MOBILE; m.receiveShadow = true; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(m); return m; };
  const TM = {
    cab: mkI(sectionGeo(SECS[0]), bodyMat, MAXT * 2),
    mid: mkI(sectionGeo(SECS[1]), bodyMat, MAXT * 3),
    noseA: mkI(noseGeo(0), frontMat, MAXT * 2), noseB: mkI(noseGeo(1), frontMat, MAXT * 2),
    door: mkI(doorGeo(), frontMat, MAXT * 5 * 4, false),
    joint: mkI(new THREE.BoxGeometry(2.08, 2.75, GAP + 0.16).translate(0, 1.68, 0), jointMat, MAXT * 4),
    bogie: mkI(new THREE.BoxGeometry(2.05, 0.42, 2.3).translate(0, 0.36, 0), darkMat, MAXT * 5),
    panto: mkI(pantoGeo(), pantoMat, MAXT),
  };
  // Lichter (Glühen): eine Instanz-Fläche je Lampe
  const glowTex = (() => { const c = cvs(64, 64), g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 1, 32, 32, 31); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const glow = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), MAXT * 8);
  glow.count = 0; glow.frustumCulled = false; glow.renderOrder = 5; glow.instanceMatrix.setUsage(THREE.DynamicDrawUsage); glow.setColorAt(0, new THREE.Color(0)); root.add(glow);
  W.noAO = W.noAO || new Set(); W.noAO.add(glow);
  const pool = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0x6b5f48, polygonOffset: true, polygonOffsetFactor: -3 }), MAXT * 2);
  pool.count = 0; pool.frustumCulled = false; pool.renderOrder = 3; pool.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(pool); W.noAO.add(pool);

  // ============================================================================================ Netz (Gleise, Halte, Ampeln) – sobald city.json + city_vis.json da sind
  let cj = null, cv = null, ready = false;
  const tracks = {};        // A: Richtung +z (stadtauswärts nach NO), B: Richtung −z
  const trams = [];
  let nextId = 1;
  const _o = {}, _o2 = {};
  function setup() {
    if (ready || !cj || !cv) return;
    if (!cj.tram || cj.tram.length < 4) { ready = true; return; }
    const ft = cv.farTram || [];
    const A = joinPts(ft[0], cj.tram[0], cj.tram[2], ft[2]), B = joinPts(ft[3], cj.tram[3], cj.tram[1], ft[1]);
    for (const [k, pts, dest] of [['A', A, 0], ['B', B, 1]]) {
      const L = mkLine(smoothLine(pts, 1.0)); L.key = k; L.dest = dest; L.stops = []; L.sig = []; tracks[k] = L;
    }
    // Ampel-Haltelinien: wo das Gleis in eine Fahrbahn einfährt, 2 m davor; Ampel-Gruppe in der Nähe
    const sg = cj.signals || [];
    for (const L of Object.values(tracks)) {
      let prev = null;
      for (let s = 0; s < L.len; s += 0.5) {
        lineAt(L, s, _o); const onRoad = W.groundY && W.groundY(_o.x, _o.z) < -0.07;
        if (prev === false && onRoad) {
          let best = -1, bd = 45; for (let i = 0; i < sg.length; i++) { const d = Math.hypot(sg[i].c[0] - _o.x, sg[i].c[1] - _o.z); if (d < bd) { bd = d; best = i; } }
          L.sig.push({ s: Math.max(0, s - 2.2), c: best, ax: Math.abs(_o.dz) > Math.abs(_o.dx) ? 1 : 0 });
        }
        prev = onRoad;
      }
    }
    // Bahnsteige an den Haltestellen-Punkten
    const pts = (cj.points && cj.points.tram_stop) || [];
    pts.forEach((p, i) => {
      let L = null, ps = 0, pd = 1e9; for (const T of Object.values(tracks)) { const [s, d] = lineProject(T, p[0], p[1]); if (d < pd) { pd = d; L = T; ps = s; } }
      if (!L || pd > 6) return;
      const sig = L.sig.find(q => q.s > ps); let sF = ps + 20.5; if (sig && sig.s - 1.0 < sF) sF = sig.s - 1.0;
      const st = { id: 'tram' + i, kind: 'tram', L, sF, s0: sF - T_LEN - 1.5, s1: sF + 1.0 };
      L.stops.push(st); L.stops.sort((a, b) => a.sF - b.sF);
      buildPlatform(st);
    });
    buildCatenary();
    // erste Bahnen: je Richtung eine irgendwo unterwegs (nicht im Blick am Laden)
    for (const k of ['A', 'B']) { const L = tracks[k]; spawnTram(k, L.len * (0.25 + rnd() * 0.35)); }
    sched.A = 40 + rnd() * 30; sched.B = 60 + rnd() * 30;
    ready = true; W.requestRender && W.requestRender();
  }
  const sched = { A: 0, B: 0 };
  function spawnTram(k, sFront) {
    const L = tracks[k]; if (!L) return null;
    if (trams.length >= MAXT) return null;
    sFront = sFront ?? T_LEN + 0.5;
    for (const t of trams) if (t.L === L && Math.abs(t.s - sFront) < T_LEN + 25) return null;
    const t = { id: nextId++, L, s: sFront, v: sFront > T_LEN + 5 ? 9 : 11, state: 'run', dwell: 0, dwellT: 0, stop: null, doorK: 0, doorWant: 0, served: new Set(), bellT: 0, secs: SECS.map(() => ({ x: 0, z: 0, y: 0, yaw: 0, len: 0, v: 0, kind: 'tram' })), blockT: 0 };
    for (const st of L.stops) if (st.sF < sFront - 1) t.served.add(st.id);
    trams.push(t); return t;
  }

  // ---------------------------------------------------------------- Bahnsteig + Wartehalle + Schild
  const platGeo = [], shelterGeo = [], glassGeo = [], signGeo = [];
  const platMat = (() => {
    const c = cvs(256, 256), g = c.getContext('2d'), r = mulberry(17);
    g.fillStyle = '#a7a59f'; g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 32) for (let x = 0; x < 256; x += 32) { const v = 150 + r() * 30 | 0; g.fillStyle = `rgb(${v},${v - 2},${v - 6})`; g.fillRect(x + 1, y + 1, 30, 30); }
    for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.08})`; g.fillRect(r() * 256, r() * 256, 1.5, 1.5); }
    g.fillStyle = '#ece9df'; g.fillRect(0, 0, 12, 256);                       // weiße Kante (u = 0 = Gleisseite)
    g.fillStyle = '#d7d2c2'; g.fillRect(22, 0, 34, 256); g.fillStyle = '#c3bead'; for (let y = 0; y < 256; y += 8) g.fillRect(22, y, 34, 3); // Rillenplatten
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = maxAniso;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.88, metalness: 0 });
  })();
  const PLATS = [], SHELT = [], _o3 = {};
  // Höhe über Boden (Bahnsteig) und Sperre (Wartehallen) – für Passanten / Spielfigur
  W.lifeGround = (x, z) => {
    for (const p of PLATS) { if (Math.abs(x - p.cx) > p.r || Math.abs(z - p.cz) > p.r) continue; const [s] = lineProject(p.L, x, z, p.s0 - 2, p.s1 + 2); if (s < p.s0 || s > p.s1) continue; lineAt(p.L, s, _o3); const lat = (x - _o3.x) * (-_o3.dz) + (z - _o3.z) * _o3.dx; if (lat > p.o0 - 0.02 && lat < p.o1 + 0.02) return p.h; }
    return 0;
  };
  W.lifeBlocked = (x, z) => { for (const b of SHELT) { const dx = x - b.x, dz = z - b.z; if (dx * dx + dz * dz > 16) continue; const lx = dx * b.c - dz * b.s, lz = dx * b.s + dz * b.c; if (Math.abs(lx - b.ox) < b.hw && Math.abs(lz) < b.hl) return true; } return false; };
  function buildPlatform(st) {
    const L = st.L, o0 = 1.36, o1 = 3.9, h = 0.22, step = 2;
    { lineAt(L, (st.s0 + st.s1) / 2, _o3); const ox = _o3.x - _o3.dz * 2.6, oz = _o3.z + _o3.dx * 2.6; PLATS.push({ L, s0: st.s0, s1: st.s1, o0, o1, h, cx: ox, cz: oz, r: (st.s1 - st.s0) / 2 + 4 }); }
    const pos = [], uv = [];
    const P = (s, off) => { lineAt(L, s, _o); return [_o.x - _o.dz * off, _o.z + _o.dx * off]; };   // rechts = (-dz, dx)
    const q = (a, b, c, d, ua, ub, uc, ud) => { for (const [p, u] of [[a, ua], [b, ub], [c, uc], [a, ua], [c, uc], [d, ud]]) { pos.push(p[0], p[1], p[2]); uv.push(u[0], u[1]); } };
    for (let s = st.s0; s < st.s1 - 0.01; s += step) {
      const s2 = Math.min(st.s1, s + step), a0 = P(s, o0), a1 = P(s, o1), b0 = P(s2, o0), b1 = P(s2, o1);
      const ya = 0.0, v0 = s / 8, v1 = s2 / 8;
      q([a0[0], h, a0[1]], [a1[0], h, a1[1]], [b1[0], h, b1[1]], [b0[0], h, b0[1]], [0, v0], [1, v0], [1, v1], [0, v1]);
      q([a0[0], ya - 0.05, a0[1]], [a0[0], h, a0[1]], [b0[0], h, b0[1]], [b0[0], ya - 0.05, b0[1]], [0.95, v0], [0.99, v0], [0.99, v1], [0.95, v1]);
      q([a1[0], h, a1[1]], [a1[0], ya - 0.05, a1[1]], [b1[0], ya - 0.05, b1[1]], [b1[0], h, b1[1]], [0.95, v0], [0.99, v0], [0.99, v1], [0.95, v1]);
    }
    for (const s of [st.s0, st.s1]) { const a0 = P(s, o0), a1 = P(s, o1), fw = s === st.s1; const A0 = [a0[0], h, a0[1]], A1 = [a1[0], h, a1[1]], B0 = [a0[0], -0.05, a0[1]], B1 = [a1[0], -0.05, a1[1]]; if (fw) q(A0, B0, B1, A1, [0.95, 0], [0.99, 0], [0.99, 0.1], [0.95, 0.1]); else q(A0, A1, B1, B0, [0.95, 0], [0.99, 0], [0.99, 0.1], [0.95, 0.1]); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals(); platGeo.push(g);
    // Wartehalle (4 m) in der Mitte, Rückwand zur Außenseite
    const sm = (st.s0 + st.s1) / 2 + 3; lineAt(L, sm, _o); const yaw = hdg(_o.dx, _o.dz);
    const cx = _o.x - _o.dz * 3.05, cz = _o.z + _o.dx * 3.05;
    { const yw = hdg(_o.dx, _o.dz); SHELT.push({ x: cx, z: cz, c: Math.cos(yw), s: Math.sin(yw), ox: 0.4, hw: 0.45, hl: 2.15 }); }
    const m4 = new THREE.Matrix4().compose(new THREE.Vector3(cx, h, cz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
    const add = (arr, geo, col) => { geo.applyMatrix4(m4); if (col) { const c = new THREE.Color(col), n = geo.attributes.position.count, a = new Float32Array(n * 3); for (let k = 0; k < n; k++) { a[k * 3] = c.r; a[k * 3 + 1] = c.g; a[k * 3 + 2] = c.b; } geo.setAttribute('color', new THREE.BufferAttribute(a, 3)); } arr.push(geo.index ? geo.toNonIndexed() : geo); };
    // lokale Achsen: x = nach rechts (außen), z = Fahrtrichtung
    add(shelterGeo, new THREE.BoxGeometry(1.7, 0.08, 4.4).translate(0.05, 2.42, 0), '#3a3d40');
    for (const zz of [-2.05, 2.05]) for (const xx of [-0.65, 0.7]) add(shelterGeo, new THREE.BoxGeometry(0.07, 2.4, 0.07).translate(xx, 1.2, zz), '#2f3235');
    add(shelterGeo, new THREE.BoxGeometry(0.42, 0.05, 2.2).translate(0.45, 0.46, 0), '#6b4a2f');            // Bank
    for (const zz of [-0.9, 0.9]) add(shelterGeo, new THREE.BoxGeometry(0.05, 0.44, 0.05).translate(0.45, 0.22, zz), '#2f3235');
    add(shelterGeo, new THREE.BoxGeometry(0.5, 1.75, 0.12).translate(0.45, 1.25, 2.55), '#1b4f8a');           // Fahrplan-Vitrine
    add(shelterGeo, new THREE.BoxGeometry(0.44, 1.55, 0.13).translate(0.45, 1.25, 2.55), '#e8e6df');
    add(glassGeo, new THREE.BoxGeometry(0.02, 2.1, 4.1).translate(0.72, 1.2, 0));
    add(glassGeo, new THREE.BoxGeometry(1.32, 2.1, 0.02).translate(0.05, 1.2, -2.05));
    // H-Schild am Mast (gelber Kreis, grünes H) + Name
    { const sx = -0.1, sz = -6.5; add(shelterGeo, new THREE.CylinderGeometry(0.045, 0.05, 2.9, 8).translate(sx + 0.85, 1.45, sz), '#8e9296');
      const d = new THREE.CylinderGeometry(0.3, 0.3, 0.025, 28); d.rotateZ(Math.PI / 2); d.translate(sx + 0.85, 2.75, sz); const uvs = d.attributes.uv, ps = d.attributes.position; for (let k = 0; k < uvs.count; k++) { uvs.setXY(k, 0.25 + (ps.getZ(k) - sz) / 0.6 * 0.5 * 0.98, 0.5 + (ps.getY(k) - 2.75) / 0.6 * 0.98); } add(signGeo, d);
      const b = new THREE.BoxGeometry(0.03, 0.2, 0.62); b.translate(sx + 0.85, 2.33, sz); const ub = b.attributes.uv, pb = b.attributes.position; for (let k = 0; k < ub.count; k++) ub.setXY(k, 0.5 + 0.02 + (pb.getZ(k) - sz + 0.31) / 0.62 * 0.46, 0.4 + (pb.getY(k) - 2.23) / 0.2 * 0.2); add(signGeo, b); }
    // Haltestelle für Passanten (people.js)
    const wait = []; for (let s = st.s0 + 4; s < st.s1 - 3; s += 2.6) { const p = P(s, 2.2 + rnd() * 1.0); wait.push([p[0], p[1]]); }
    const pa = P(st.s0 + 1, 2.6), pb = P(st.s1 - 1, 2.6); lineAt(L, (st.s0 + st.s1) / 2, _o);
    st.pub = { id: st.id, kind: 'tram', x: (pa[0] + pb[0]) / 2, z: (pa[1] + pb[1]) / 2, yaw: hdg(_o.dx, _o.dz), side: [-_o.dz, _o.dx], len: st.s1 - st.s0, wait, ends: [pa, pb], h: 0.22 };
    W.stops.push(st.pub);
  }
  const signTex = (() => {
    const c = cvs(512, 256), g = c.getContext('2d');
    g.fillStyle = '#f4f4f0'; g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#f4c400'; g.beginPath(); g.arc(128, 128, 124, 0, TAU); g.fill(); g.strokeStyle = '#0d8a3c'; g.lineWidth = 10; g.stroke();
    g.fillStyle = '#0d8a3c'; g.font = 'bold 170px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('H', 128, 138);
    g.fillStyle = '#16365f'; g.fillRect(256, 0, 256, 256); g.fillStyle = '#fff'; g.font = 'bold 40px Arial, sans-serif'; g.fillText('U Seestr.', 384, 128 + 64); g.font = 'bold 30px Arial, sans-serif'; g.fillStyle = '#ffd21a'; g.fillText('M13', 384, 128 + 20);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  function finishPlatforms() {
    if (platGeo.length) { const m = new THREE.Mesh(mergeGeometries(platGeo), platMat); m.receiveShadow = true; m.name = 'bahnsteige'; root.add(m); }
    if (shelterGeo.length) { const m = new THREE.Mesh(mergeGeometries(shelterGeo), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35 })); m.castShadow = !MOBILE; m.receiveShadow = true; root.add(m); }
    if (glassGeo.length) { const m = new THREE.Mesh(mergeGeometries(glassGeo), new THREE.MeshStandardMaterial({ color: 0xbfd2dc, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false })); m.renderOrder = 3; root.add(m); }
    if (signGeo.length) { const m = new THREE.Mesh(mergeGeometries(signGeo), new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.5 })); root.add(m); }
  }

  // ---------------------------------------------------------------- Oberleitung
  function buildCatenary() {
    const A = tracks.A, B = tracks.B; if (!A || !B) return;
    const poles = [], arms = [], wire = [];
    const WY = 5.65;
    const roadNear = (x, z) => { for (const [dx, dz] of [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]]) if (W.groundY && W.groundY(x + dx, z + dz) < -0.07) return true; return false; };
    const poleS = [];
    for (let s = 6; s < A.len - 6; s += 31) {
      lineAt(A, s, _o); const [sb, d] = lineProject(B, _o.x, _o.z); if (d > 5.5 || d < 2) continue; lineAt(B, sb, _o2);
      const px = (_o.x + _o2.x) / 2, pz = (_o.z + _o2.z) / 2; if (roadNear(px, pz)) continue;
      poles.push([px, pz]); poleS.push([s, sb]);
      const y0 = railY(px, pz);
      for (const q of [_o, _o2]) { const dx = q.x - px, dz = q.z - pz, l = Math.hypot(dx, dz); arms.push({ x: px + dx / 2, z: pz + dz / 2, y: y0 + 6.25, len: l + 0.3, yaw: hdg(dx, dz) }); }
    }
    for (const L of [A, B]) {
      let prev = null, k = 0;
      for (let s = 0; s <= L.len; s += 6) { lineAt(L, s, _o); const st = ((k++ % 10) < 5 ? 1 : -1) * 0.18; const p = [_o.x - _o.dz * st, railY(_o.x, _o.z) + WY, _o.z + _o.dx * st]; if (prev) wire.push(...prev, ...p); prev = p; }
    }
    const pg = new THREE.CylinderGeometry(0.1, 0.13, 7.0, 10).translate(0, 3.5, 0);
    const pm = new THREE.InstancedMesh(pg, new THREE.MeshStandardMaterial({ color: 0x55605a, roughness: 0.6, metalness: 0.5 }), Math.max(1, poles.length)); pm.castShadow = !MOBILE; pm.receiveShadow = true;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1), AY = new THREE.Vector3(0, 1, 0);
    poles.forEach((p, i) => { m4.compose(v.set(p[0], railY(p[0], p[1]), p[1]), q.identity(), sc.set(1, 1, 1)); pm.setMatrixAt(i, m4); }); pm.count = poles.length; root.add(pm);
    const ag = new THREE.BoxGeometry(0.07, 0.09, 1);
    const am = new THREE.InstancedMesh(ag, new THREE.MeshStandardMaterial({ color: 0x55605a, roughness: 0.6, metalness: 0.5 }), Math.max(1, arms.length));
    arms.forEach((a, i) => { m4.compose(v.set(a.x, a.y, a.z), q.setFromAxisAngle(AY, a.yaw), sc.set(1, 1, a.len)); am.setMatrixAt(i, m4); }); am.count = arms.length; root.add(am);
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
    const wm = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x1c1d1f, transparent: true, opacity: 0.85 })); wm.frustumCulled = false; root.add(wm);
    finishPlatforms();
  }

  // ---------------------------------------------------------------- Bahn bewegen
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _c = new THREE.Color(), AY = new THREE.Vector3(0, 1, 0), _m2 = new THREE.Matrix4();
  function poseTram(t) {
    let cur = t.s - ND;
    t.secs.forEach((P, i) => {
      const sec = SECS[i], f = cur, r = cur - sec.len;
      lineAt(t.L, f, _o); lineAt(t.L, r, _o2);
      P.x = (_o.x + _o2.x) / 2; P.z = (_o.z + _o2.z) / 2; P.yaw = hdg(_o.x - _o2.x, _o.z - _o2.z); P.y = railY(P.x, P.z); P.len = sec.len; P.wid = TW; P.v = t.v;
      P.sf = f; P.sr = r;
      cur = r - GAP;
    });
  }
  // Hindernis-Abstand voraus auf dem Gleis (Autos, Menschen, Spielfigur)
  function aheadBlock(t) {
    const L = t.L, pts = [];
    for (let k = 0; k <= 22; k++) { lineAt(L, t.s + k * 2.2, _o); pts.push(_o.x, _o.z); }
    let gap = Infinity, who = null;
    const test = (x, z, r, kind) => {
      if ((x - pts[0]) ** 2 + (z - pts[1]) ** 2 > 3000) return;
      for (let k = 0; k <= 22; k++) { const dx = pts[k * 2] - x, dz = pts[k * 2 + 1] - z; if (dx * dx + dz * dz < (1.3 + r) ** 2) { const d = k * 2.2 - r - 1.8; if (d < gap) { gap = d; who = kind; } return; } }
    };
    if (Array.isArray(W.cars)) for (const c of W.cars) { const p = c.pos; if (!p) continue; const hl = (c.len || 4.4) / 2, sy = Math.sin(c.yaw || 0), cy = Math.cos(c.yaw || 0); test(p.x + sy * hl * 0.6, p.z + cy * hl * 0.6, 1.0, 'car'); test(p.x - sy * hl * 0.6, p.z - cy * hl * 0.6, 1.0, 'car'); }
    if (Array.isArray(W.npcs)) for (const n of W.npcs) { const p = n.pos || n; if (p) test(p.x, p.z, 0.35, 'npc'); }
    if (W.P && !W.control) test(W.P.x, W.P.z, 0.4, 'player');
    for (const o of trams) { if (o === t || o.L !== t.L || o.s <= t.s) continue; const d = (o.s - T_LEN) - t.s - 6; if (d < gap) { gap = d; who = 'tram'; } }
    return [gap, who];
  }
  function driveTram(t, dt) {
    const L = t.L, vmax = 13.0, acc = 1.0, dec = 1.25;
    if (t.state === 'dwell') {
      t.dwell += dt; t.v = 0;
      if (t.dwell > 1.0 && t.doorWant === 0 && t.dwell < t.dwellT - 3) { t.doorWant = 1; emitDoors(t, true); }
      if (t.dwell > t.dwellT - 3 && t.doorWant === 1) { t.doorWant = 0; emitDoors(t, false); }
      if (t.dwell > t.dwellT - 0.6 && !t.belled) { t.belled = true; sfx.bell(t.secs[0].x, t.secs[0].z, 2); }
      if (t.dwell >= t.dwellT && t.doorK < 0.02) { t.state = 'run'; t.served.add(t.stop.id); t.stop = null; }
      return;
    }
    let gap = Infinity, kind = null;
    for (const st of L.stops) { if (t.served.has(st.id) || st.sF < t.s - 1.5) continue; const d = st.sF - t.s; if (d < gap) { gap = d; kind = st; } break; }
    for (const q of L.sig) {
      if (q.s < t.s - 0.3) continue; const d = q.s - t.s; if (d > 90) break;
      const sgl = W.signals && q.c >= 0 ? W.signals.state(q.c, q.ax) : 'g';
      if (sgl === 'r' || (sgl === 'y' && d > t.v * t.v / (2 * 2.2) + 1)) { if (d - 0.3 < gap) { gap = d - 0.3; kind = 'sig'; } }
      break;
    }
    const [bg, who] = aheadBlock(t);
    if (bg < gap) { gap = bg; kind = who; }
    t.why = typeof kind === 'object' && kind ? 'halt' : kind; t.gap = gap;
    if ((kind === 'car' || kind === 'npc' || kind === 'player') && gap < 26 && t.bellT <= 0 && t.v > 0.5) { sfx.bell(t.secs[0].x, t.secs[0].z, 3); t.bellT = 4 + rnd() * 2; }
    if (kind === 'player' || kind === 'npc' || kind === 'car') t.blockT += dt; else t.blockT = 0;
    let vdes = vmax;
    if (gap < Infinity) vdes = Math.min(vdes, Math.sqrt(Math.max(0, 2 * dec * Math.max(0, gap))));
    if (t.v > vdes) t.v = Math.max(vdes, t.v - (gap < 6 ? 3.2 : 2.0) * dt); else t.v = Math.min(vdes, t.v + acc * dt);
    if (gap < 0.25) t.v = 0;
    t.s += t.v * dt;
    if (kind && typeof kind === 'object' && kind.kind === 'tram' && gap < 0.4 && t.v < 0.05) { t.state = 'dwell'; t.dwell = 0; t.dwellT = 13 + rnd() * 6; t.stop = kind; t.belled = false; }
  }
  function doorWorld(t, onlyPlatform) {
    const pts = [];
    t.secs.forEach((P, i) => {
      const sec = SECS[i], yaw = P.yaw + (sec.rev ? Math.PI : 0), sy = Math.sin(yaw), cy = Math.cos(yaw);
      const sideL = sec.rev ? 1 : -1;      // lokale Seite, die rechts in Fahrtrichtung liegt
      for (const sd of onlyPlatform ? [sideL] : [-1, 1]) {
        const lx = sd * (TW / 2 + 0.7), lz = sec.door;
        pts.push([P.x + lx * cy + lz * sy, P.z - lx * sy + lz * cy]);
      }
    });
    return pts;
  }
  function emitDoors(t, open) { if (!t.stop) return; W.emit && W.emit('doors', { stop: t.stop.id, open, pts: doorWorld(t, true), kind: 'tram', id: t.id }); if (W.requestRender) W.requestRender(); }

  // ---------------------------------------------------------------- Bahn zeichnen
  function writeTrams(blinkOn) {
    let nc = 0, nm = 0, na = 0, nb = 0, nd = 0, nj = 0, ng = 0, np = 0, nl = 0, npl = 0;
    const night = NIGHT.on;
    const cam = camera.position;
    W.obstacles.length = 0;
    for (const t of trams) {
      const dCam = Math.hypot(t.secs[2].x - cam.x, t.secs[2].z - cam.z);
      t.secs.forEach((P, i) => {
        const sec = SECS[i], yaw = P.yaw + (sec.rev ? Math.PI : 0);
        W.obstacles.push(P);
        _q.setFromAxisAngle(AY, yaw); _m.compose(_v.set(P.x, P.y, P.z), _q, _s.set(1, 1, 1));
        if (sec.cab) { TM.cab.setMatrixAt(nc++, _m); _m2.makeTranslation(0, 0, sec.len / 2).premultiply(_m); (t.L.dest ? TM.noseB : TM.noseA).setMatrixAt(t.L.dest ? nb++ : na++, _m2); }
        else TM.mid.setMatrixAt(nm++, _m);
        _m2.makeTranslation(0, 0, sec.cab ? (sec.len / 2 - 2.2) * (1) : 0).premultiply(_m); TM.bogie.setMatrixAt(nl++, _m2);
        if (sec.panto) TM.panto.setMatrixAt(np++, _m);
        // Türen: je Seite zwei Flügel
        if (dCam < 120) {
          const sideL = sec.rev ? 1 : -1;
          for (const sd of [-1, 1]) {
            const k = sd === sideL ? t.doorK : 0, outw = Math.min(1, k / 0.3) * 0.11, slide = clamp((k - 0.3) / 0.7, 0, 1) * 0.66;
            for (const lf of [-1, 1]) {
              _q.setFromAxisAngle(AY, yaw + sd * Math.PI / 2);
              _v.set(sd * (1.205 + outw), 0, sec.door + lf * (0.33 + slide)).applyAxisAngle(AY, yaw); _v.x += P.x; _v.y = P.y; _v.z += P.z;
              _m2.compose(_v, _q, _s.set(lf > 0 ? -1 : 1, 1, 1)); TM.door.setMatrixAt(nd++, _m2);
            }
          }
        }
        // Lichter
        if (sec.cab && dCam < 220) {
          const frontEnd = !sec.rev, sy = Math.sin(yaw), cy = Math.cos(yaw), zf = sec.len / 2 + ND + 0.03;
          for (const s of [-1, 1]) {
            _v.set(s * 0.76, P.y + 0.72, 0); const lx = _v.x, lz = zf; const wx = P.x + lx * Math.cos(yaw) + lz * sy, wz = P.z - lx * Math.sin(yaw) + lz * cy;
            _q.setFromAxisAngle(AY, yaw); _m2.compose(_v.set(wx, P.y + 0.72, wz), _q, _s.set(night ? 1.1 : 0.5, night ? 0.6 : 0.3, 1));
            glow.setMatrixAt(ng, _m2); glow.setColorAt(ng++, frontEnd ? _c.setRGB(night ? 2.0 : 0.9, night ? 1.9 : 0.85, night ? 1.7 : 0.8) : _c.setRGB(night ? 1.2 : 0.35, 0.03, 0.02));
          }
          if (night && frontEnd && dCam < 90) { _q.setFromAxisAngle(AY, yaw); _m2.compose(_v.set(P.x + sy * (zf + 6), P.y + 0.03, P.z + cy * (zf + 6)), _q, _s.set(4.2, 1, 11)); pool.setMatrixAt(npl++, _m2); }
        }
      });
      // Bälge zwischen den Wagenkästen
      for (let i = 0; i < SECS.length - 1; i++) {
        const sm = t.secs[i].sr - GAP / 2; lineAt(t.L, sm, _o); _q.setFromAxisAngle(AY, hdg(_o.dx, _o.dz)); _m.compose(_v.set(_o.x, railY(_o.x, _o.z), _o.z), _q, _s.set(1, 1, 1)); TM.joint.setMatrixAt(nj++, _m);
      }
    }
    const set = (m, n) => { m.count = n; m.visible = n > 0; if (n) m.instanceMatrix.needsUpdate = true; };
    set(TM.cab, nc); set(TM.mid, nm); set(TM.noseA, na); set(TM.noseB, nb); set(TM.door, nd); set(TM.joint, nj); set(TM.bogie, nl); set(TM.panto, np);
    glow.count = ng; glow.visible = ng > 0; if (ng) { glow.instanceMatrix.needsUpdate = true; glow.instanceColor.needsUpdate = true; }
    pool.count = npl; pool.visible = npl > 0; if (npl) pool.instanceMatrix.needsUpdate = true;
    void blinkOn;
  }
  // Glühen zur Kamera drehen (Billboard um die eigene Lage)
  function pushPlayer() {
    const P = W.P; if (!P || W.control) return;
    for (const t of trams) for (const S of t.secs) {
      const dx = P.x - S.x, dz = P.z - S.z; if (dx * dx + dz * dz > 40) continue;
      const sy = Math.sin(S.yaw), cy = Math.cos(S.yaw), lz = dx * sy + dz * cy, lx = dx * cy - dz * sy, hw = TW / 2 + 0.32, hl = S.len / 2 + 0.6;
      if (Math.abs(lx) < hw && Math.abs(lz) < hl) {
        let nlx = lx, nlz = lz; if (hw - Math.abs(lx) < hl - Math.abs(lz)) nlx = Math.sign(lx || 1) * hw; else nlz = Math.sign(lz || 1) * hl;
        const nx = S.x + nlx * cy + nlz * sy, nz = S.z - nlx * sy + nlz * cy; P.x = nx; P.z = nz; if (P.root) { P.root.position.x = nx; P.root.position.z = nz; }
      }
    }
  }

  // ============================================================================================ Tauben
  const PG = { birds: [], flocks: [], spots: [] };
  const MAXB = MOBILE ? 9 : 16;
  const pigeonGeo = (() => {
    const col = (geo, hex) => { const c = new THREE.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3); for (let k = 0; k < n; k++) { a[k * 3] = c.r; a[k * 3 + 1] = c.g; a[k * 3 + 2] = c.b; } geo.setAttribute('color', new THREE.BufferAttribute(a, 3)); return geo.index ? geo.toNonIndexed() : geo; };
    const body = new THREE.SphereGeometry(1, 12, 8); body.scale(0.072, 0.068, 0.13); body.translate(0, 0.125, -0.01);
    const breast = new THREE.SphereGeometry(1, 10, 6); breast.scale(0.062, 0.06, 0.06); breast.translate(0, 0.14, 0.07);
    const tail = new THREE.BoxGeometry(0.07, 0.012, 0.11); tail.rotateX(-0.25); tail.translate(0, 0.12, -0.17);
    const wingF = new THREE.SphereGeometry(1, 8, 6); wingF.scale(0.074, 0.05, 0.12); wingF.translate(0, 0.142, -0.035);  // angelegte Flügel (Rücken)
    const legs = []; for (const s of [-1, 1]) { const l = new THREE.CylinderGeometry(0.006, 0.006, 0.07, 5); l.translate(s * 0.022, 0.035, 0.005); legs.push(col(l, '#b8645e')); }
    const B = mergeGeometries([col(body, '#7f838c'), col(breast, '#6f7480'), col(tail, '#3f4249'), col(wingF, '#9aa0a8'), ...legs]);
    const head = new THREE.SphereGeometry(1, 10, 8); head.scale(0.038, 0.04, 0.042); head.translate(0, 0.062, 0.045);
    const neck = new THREE.SphereGeometry(1, 8, 6); neck.scale(0.045, 0.055, 0.045); neck.translate(0, 0.02, 0.02);
    const beak = new THREE.ConeGeometry(0.008, 0.028, 6); beak.rotateX(Math.PI / 2); beak.translate(0, 0.058, 0.094);
    const eye = new THREE.SphereGeometry(0.0075, 6, 4); const e1 = eye.clone().translate(0.03, 0.07, 0.065), e2 = eye.clone().translate(-0.03, 0.07, 0.065);
    const H = mergeGeometries([col(head, '#7b808a'), col(neck, '#5b6f68'), col(beak, '#2a2a2a'), col(e1, '#d07a1c'), col(e2, '#d07a1c')]);
    const wing = new THREE.BufferGeometry();
    wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.06, 0.30, 0, -0.02, 0, 0, -0.1, 0, 0, 0.06, 0.24, 0, 0.05, 0.30, 0, -0.02], 3));
    wing.setAttribute('color', new THREE.Float32BufferAttribute([0.62, 0.64, 0.67, 0.25, 0.26, 0.28, 0.55, 0.57, 0.6, 0.62, 0.64, 0.67, 0.4, 0.42, 0.45, 0.25, 0.26, 0.28], 3));
    wing.computeVertexNormals();
    return { B, H, wing };
  })();
  const birdMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  const wingMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  const BM = {
    body: new THREE.InstancedMesh(pigeonGeo.B, birdMat, MAXB), head: new THREE.InstancedMesh(pigeonGeo.H, birdMat, MAXB),
    wl: new THREE.InstancedMesh(pigeonGeo.wing, wingMat, MAXB), wr: new THREE.InstancedMesh(pigeonGeo.wing, wingMat, MAXB),
  };
  for (const m of Object.values(BM)) { m.count = 0; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = true; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(m); }
  BM.body.setColorAt(0, _c.set(0xffffff)); BM.head.setColorAt(0, _c.set(0xffffff));
  const BIRDCOL = ['#ffffff', '#ffffff', '#ffffff', '#f0f0f0', '#c9c2b8', '#ffffff', '#efe5dc', '#8a8e96'];
  function pigeonSpots() {
    const out = [];
    // vor dem Laden + an den Tischen (Krümel), Haltestellen
    for (const p of [[1.6, 2.6], [3.0, 2.7], [8.6, 4.3], [13.5, 4.4], [17.5, 4.0], [-4.5, 4.2], [-9.0, 3.8], [22, 4.4]]) out.push(p);
    if (cj && cj.walk) for (const w of cj.walk) { if (w.cross) continue; const L = mkLine(w.pts); for (let s = 4; s < L.len; s += 17) { lineAt(L, s, _o); out.push([_o.x, _o.z]); } }
    return out.filter(([x, z]) => !(W.groundY && W.groundY(x, z) < -0.07) && !(W.blocked && W.blocked(x, z, 'body')));
  }
  function focus() { const tp = W.tp; if (tp && tp.active) return [W.P.x, W.P.z]; const t = W.controls ? W.controls.target : camera.position; return [t.x, t.z]; }
  function freeSpot(x, z) { return !(W.groundY && W.groundY(x, z) < -0.07) && !(W.blocked && W.blocked(x, z, 'body')); }
  function makeFlock(cx, cz, n) {
    const f = { x: cx, z: cz, birds: [], calm: 0 };
    for (let i = 0; i < n && PG.birds.length < MAXB; i++) {
      let x = cx, z = cz; for (let k = 0; k < 6; k++) { const a = rnd() * TAU, r = rnd() * 1.6; if (freeSpot(cx + Math.cos(a) * r, cz + Math.sin(a) * r)) { x = cx + Math.cos(a) * r; z = cz + Math.sin(a) * r; break; } }
      const b = { f, x, z, y: 0, yaw: rnd() * TAU, st: 'ground', walk: 0, peck: 0, ph: rnd() * 10, fly: null, col: BIRDCOL[(rnd() * BIRDCOL.length) | 0], sc: 0.92 + rnd() * 0.16, pitch: 0, bob: 0 };
      f.birds.push(b); PG.birds.push(b);
    }
    PG.flocks.push(f); return f;
  }
  function scatter(f, fromX, fromZ) {
    const [fx, fz] = focus();
    let best = null, bs = -1e9;
    for (let k = 0; k < 14; k++) {
      const sp = PG.spots[(rnd() * PG.spots.length) | 0]; if (!sp) break; const d = Math.hypot(sp[0] - f.x, sp[1] - f.z); if (d < 12 || d > 45) continue;
      const away = Math.hypot(sp[0] - fromX, sp[1] - fromZ), nearF = Math.hypot(sp[0] - fx, sp[1] - fz); const sc = away - Math.abs(d - 25) * 0.4 - (nearF > 70 ? 50 : 0); if (sc > bs) { bs = sc; best = sp; }
    }
    if (!best) { const a = Math.atan2(f.z - fromZ, f.x - fromX); best = [f.x + Math.cos(a) * 22, f.z + Math.sin(a) * 22]; }
    sfx.flutter(f.x, f.z);
    f.x = best[0]; f.z = best[1]; f.calm = 4;
    for (const b of f.birds) {
      if (b.st === 'fly') continue;
      const a = rnd() * TAU, r = rnd() * 1.5, tx = best[0] + Math.cos(a) * r, tz = best[1] + Math.sin(a) * r, d = Math.hypot(tx - b.x, tz - b.z);
      b.fly = { x0: b.x, z0: b.z, x1: tx, z1: tz, t: -rnd() * 0.35, dur: Math.max(2.2, d / (5.5 + rnd() * 1.5)), h: 2.5 + rnd() * 3 + d * 0.05 };
      b.st = 'fly';
    }
  }
  W.on && W.on('shot', (d) => { const p = d && d.pos; if (!p) return; for (const f of PG.flocks) if (Math.hypot(f.x - p.x, f.z - p.z) < 45) scatter(f, p.x, p.z); });
  W.on && W.on('explosion', (d) => { const p = d && d.pos; if (!p) return; for (const f of PG.flocks) if (Math.hypot(f.x - p.x, f.z - p.z) < 60) scatter(f, p.x, p.z); });
  let flockT = 0; const _eu = new THREE.Euler(), _mir = new THREE.Matrix4().makeScale(-1, 1, 1);
  function updatePigeons(dt) {
    const night = NIGHT.on, [fx, fz] = focus();
    // Schwärme auffüllen / entfernen
    flockT -= dt;
    if (flockT <= 0) {
      flockT = 1.5;
      for (const f of PG.flocks.slice()) if (Math.hypot(f.x - fx, f.z - fz) > 85 || night) { PG.flocks.splice(PG.flocks.indexOf(f), 1); PG.birds = PG.birds.filter(b => b.f !== f); }
      if (!night && PG.spots.length) {
        const want = MOBILE ? 2 : 3;
        let guard = 0;
        while (PG.flocks.length < want && PG.birds.length < MAXB - 3 && guard++ < 10) {
          // Lieblingsplatz vor dem Laden zuerst, sonst zufällig in der Nähe (außer Sicht)
          let sp = null;
          if (!PG.flocks.some(f => Math.hypot(f.x - 2.3, f.z - 2.7) < 8) && Math.hypot(fx - 5, fz - 3) < 60 && guard === 1) sp = [2.3, 2.7];
          for (let k = 0; !sp && k < 20; k++) { const c = PG.spots[(rnd() * PG.spots.length) | 0]; const d = Math.hypot(c[0] - fx, c[1] - fz); if (d > 14 && d < 55 && !PG.flocks.some(f => Math.hypot(f.x - c[0], f.z - c[1]) < 15)) sp = c; }
          if (!sp) break; makeFlock(sp[0], sp[1], 3 + ((rnd() * 4) | 0));
        }
      }
    }
    // Gefahr erkennen
    const P = W.P, pv = P ? Math.abs(P.speed || 0) : 0;
    for (const f of PG.flocks) {
      f.calm = Math.max(0, f.calm - dt); if (f.calm > 0) continue;
      let threat = null;
      if (P && !W.control) { const d = Math.hypot(P.x - f.x, P.z - f.z); if (d < (pv > 2.6 ? 4.2 : 2.4)) threat = [P.x, P.z]; }
      if (!threat && Array.isArray(W.cars)) for (const c of W.cars) { if (Math.abs(c.speed || 0) < 2) continue; const d = Math.hypot(c.pos.x - f.x, c.pos.z - f.z); if (d < 3.6) { threat = [c.pos.x, c.pos.z]; break; } }
      if (!threat && Array.isArray(W.npcs)) for (const n of W.npcs) { const p = n.pos; if (!p) continue; if (Math.hypot(p.x - f.x, p.z - f.z) < 1.0) { threat = [p.x, p.z]; break; } }
      if (threat) scatter(f, threat[0], threat[1]);
    }
    // Vögel
    const cam = camera.position;
    let n = 0;
    for (const b of PG.birds) {
      b.ph += dt;
      if (b.st === 'ground') {
        if (b.walk > 0) {
          b.walk -= dt; const sp = 0.32;
          const nx = b.x + Math.sin(b.yaw) * sp * dt, nz = b.z + Math.cos(b.yaw) * sp * dt;
          if (Math.hypot(nx - b.f.x, nz - b.f.z) > 2.2 || !freeSpot(nx, nz)) b.yaw += Math.PI * (0.6 + rnd() * 0.4); else { b.x = nx; b.z = nz; }
          b.bob = Math.sin(b.ph * 13) ; b.pitch = 0;
        } else {
          b.peck -= dt; b.bob *= 0.8;
          b.pitch = b.peck > 0 ? Math.max(0, Math.sin(b.ph * 9)) * 0.9 : 0;
          if (b.peck < -0.6) { if (rnd() < 0.55) { b.walk = 0.6 + rnd() * 1.6; b.yaw += (rnd() - 0.5) * 2.4; } else b.peck = 0.4 + rnd() * 1.2; }
        }
        b.y = W.groundY ? W.groundY(b.x, b.z) : 0;
      } else if (b.fly) {
        const F = b.fly; F.t += dt;
        const k = clamp(F.t / F.dur, 0, 1), e = k * k * (3 - 2 * k);
        const nx = lerp(F.x0, F.x1, e), nz = lerp(F.z0, F.z1, e);
        if (F.t > 0) { b.yaw = hdg(F.x1 - F.x0, F.z1 - F.z0); }
        b.x = nx; b.z = nz; b.y = Math.sin(Math.PI * k) * F.h + (W.groundY ? W.groundY(nx, nz) : 0) * (1 - k);
        if (F.t >= F.dur) { b.st = 'ground'; b.fly = null; b.walk = 0; b.peck = 0.5; b.y = W.groundY ? W.groundY(b.x, b.z) : 0; }
      }
      // zeichnen (nur nah)
      const dc = Math.hypot(b.x - cam.x, b.z - cam.z); if (dc > 60) continue;
      const flying = b.st === 'fly' && b.fly && b.fly.t > 0, k = flying ? clamp(b.fly.t / b.fly.dur, 0, 1) : 0;
      const tilt = flying ? (k < 0.25 ? -0.5 : k > 0.8 ? -0.6 : 0.05) : 0;
      _q.setFromEuler(_eu.set(tilt, b.yaw, 0, 'YXZ')); _m.compose(_v.set(b.x, b.y, b.z), _q, _s.setScalar(b.sc));
      BM.body.setMatrixAt(n, _m); BM.body.setColorAt(n, _c.set(b.col));
      // Kopf: Nicken beim Gehen (vor/zurück), Picken (nach unten)
      _m2.makeRotationX(b.pitch * 1.1); _m2.setPosition(0, 0.15 - b.pitch * 0.03, 0.075 + b.bob * 0.018); _m2.premultiply(_m);
      BM.head.setMatrixAt(n, _m2); BM.head.setColorAt(n, _c.set(b.col));
      if (flying) {
        const fl = Math.sin(b.ph * (k > 0.35 && k < 0.75 ? 9 : 22)) * (k > 0.35 && k < 0.75 ? 0.5 : 1.0);
        for (const [m, s] of [[BM.wr, 1], [BM.wl, -1]]) { _m2.makeRotationZ(s * fl * 0.95); if (s < 0) _m2.multiply(_mir); _m2.setPosition(s * 0.045, 0.15, 0.01); _m2.premultiply(_m); m.setMatrixAt(n, _m2); }
      } else { _m2.makeScale(0, 0, 0); BM.wl.setMatrixAt(n, _m2); BM.wr.setMatrixAt(n, _m2); }
      n++;
    }
    for (const m of Object.values(BM)) { m.count = n; m.visible = n > 0; if (n) m.instanceMatrix.needsUpdate = true; }
    if (n) { BM.body.instanceColor.needsUpdate = true; BM.head.instanceColor.needsUpdate = true; }
    return n > 0;
  }

  // ============================================================================================ Tag / Nacht
  function setNight(on) { NIGHT.on = !!on; bodyMat.emissiveIntensity = on ? 0.75 : 0; frontMat.emissiveIntensity = on ? 1.5 : 0.8; }
  setNight(NIGHT.on);
  if (W.ctx && W.ctx.modeHooks) W.ctx.modeHooks.push((night) => setNight(night));

  // ============================================================================================ Laden der Daten
  const onCity = (c) => { cj = c; setup(); };
  if (W.city) onCity(W.city); else if (window.__cityJSON) onCity(window.__cityJSON);
  W.on && W.on('city', onCity);
  fetch('city/city_vis.json').then(r => r.ok ? r.json() : null).then(v => { cv = v || {}; setup(); }).catch(() => { cv = {}; setup(); });

  // ============================================================================================ pro Bild
  let spotsDone = false;
  const api = {
    trams, tracks, get T_LEN() { return T_LEN; },
    spawn: (k, s) => spawnTram(k, s),
    birds: PG,
    stats() { return { trams: trams.map(t => ({ id: t.id, dir: t.L.key, s: Math.round(t.s), v: +t.v.toFixed(1), st: t.state, door: +t.doorK.toFixed(2), why: t.why, gap: t.gap === Infinity ? -1 : +(t.gap || 0).toFixed(1) })), birds: PG.birds.length, flocks: PG.flocks.length }; },
    scatterAll() { for (const f of PG.flocks) scatter(f, W.P.x, W.P.z); },
    atStop(k = 'A', open = true) { const L = tracks[k], st = L && L.stops[0]; if (!st) return null; let t = trams.find(q => q.L === L) || spawnTram(k, st.sF); if (!t) return null; t.s = st.sF; t.v = 0; t.state = 'dwell'; t.stop = st; t.dwell = open ? 2 : 0; t.dwellT = 40; t.doorWant = open ? 1 : 0; t.doorK = open ? 1 : 0; t.belled = false; poseTram(t); return st.pub; },
    flockAt(x, z, n = 6) { return !!makeFlock(x, z, n); },
  };
  window.__life = api;
  return {
    api,
    update(dt) {
      if (!ready) return false;
      dt = Math.min(dt, 0.05);
      if (!spotsDone) { PG.spots = pigeonSpots(); spotsDone = true; }
      // Fahrplan
      for (const k of ['A', 'B']) { sched[k] -= dt; if (sched[k] <= 0) { sched[k] = (MOBILE ? 70 : 55) + rnd() * 25; spawnTram(k); } }
      let busy = false;
      for (const t of trams.slice()) {
        driveTram(t, dt);
        t.bellT -= dt;
        const want = t.doorWant; t.doorK = clamp(t.doorK + (want ? 1 : -1) * dt / 1.6, 0, 1);
        poseTram(t);
        if (t.s - T_LEN > t.L.len + 2) { trams.splice(trams.indexOf(t), 1); continue; }
        if (t.v > 0.05 || (t.doorK > 0 && t.doorK < 1)) busy = true;
      }
      // nächste Bahn: Fahrgeräusch
      let near = null, nd = 1e9; for (const t of trams) { const d = Math.hypot(t.secs[2].x - camera.position.x, t.secs[2].z - camera.position.z); if (d < nd) { nd = d; near = t; } }
      if (near) sfx.hum(near.secs[2].x, near.secs[2].z, near.v); else sfx.hum(0, 0, 0);
      writeTrams();
      pushPlayer();
      if (updatePigeons(dt)) busy = true;
      return busy;
    },
  };
}
