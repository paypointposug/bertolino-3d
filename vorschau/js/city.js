// Stadt-Block Müllerstraße / Seestraße / Genter Straße / Brüsseler Straße (Daten: OpenStreetMap, © OpenStreetMap-Mitwirkende, ODbL)
// Häuser mit Berliner Altbau-Fassaden (Atlas-Shader), Fahrbahn + Markierungen, Bordsteine, Gehwege, Tram, Bäume, Laternen, Ampeln,
// U-Bahn-Eingänge, Haltestellen, Stadtmöbel, Himmel/Nebel, Sonnenschatten folgt der Figur. Bauplan: city/SPEC_STADT.md
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const VQ = (() => { try { return new URL(import.meta.url).search || ''; } catch (e) { return ''; } })();   // ?v=… der Website-Fassung
const hash = (s) => { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
function rng(seed) { let s = (seed * 2147483647) >>> 0 || 1; return () => { s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909); s ^= s >>> 16; return (s >>> 0) / 4294967296; }; }
const ringArea = (r) => { let a = 0; for (let i = 0, n = r.length; i < n; i++) { const p = r[i], q = r[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
function inRing(r, x, z) { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if (((a[1] > z) !== (b[1] > z)) && (x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0])) c = !c; } return c; }
const inPoly = (pl, x, z) => inRing(pl.p, x, z) && !pl.holes.some(h => inRing(h, x, z));
const merge = (arr) => { const g = mergeGeometries(arr.filter(Boolean), false); arr.forEach(a => a && a.dispose()); return g; };

export async function init(W) {
  const { scene, camera, renderer, ctx, ext, isMobile } = W;
  const t0 = performance.now();
  const getJSON = (u) => fetch(u).then(r => { if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); });
  const [CJ, CV] = await Promise.all([W.city ? Promise.resolve(W.city) : getJSON('city/city.json?v=11232145'), getJSON('city/city_vis.json' + VQ)]);
  const root = new THREE.Group(); root.name = 'city'; scene.add(root);
  camera.far = Math.max(camera.far, 1500); camera.updateProjectionMatrix();
  const FAR_LAYER = 2; camera.layers.enable(FAR_LAYER);          // Fernbereich + Kleinkram: nicht in der nassen Spiegelung
  const farOnly = (o) => { o.layers.set(FAR_LAYER); return o; };
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const TL = new THREE.TextureLoader();
  function T(name, o = {}) {
    const t = TL.load('tex/' + name + VQ, () => W.requestRender());
    t.colorSpace = o.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace; t.anisotropy = o.aniso ?? maxAniso;
    if (o.wrap !== false) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }
  const U = { night: { value: 1 }, time: { value: 0 }, lampTex: { value: null }, lampRect: { value: new THREE.Vector4(CV.ground.X0, CV.ground.Z0, CV.ground.W * CV.ground.CS, CV.ground.H * CV.ground.CS) } };
  const modeHooks = []; let isNight = true;
  ctx.modeHooks.push((night) => { isNight = night; U.night.value = night ? 1 : 0; modeHooks.forEach(fn => fn(night)); });
  const env = ext && ext.envs ? ext.envs : null;
  const envFor = (night) => env ? (night ? env.night : env.day) : null;
  const pbrMats = [];       // Umgebungs-Spiegelung je Tag/Nacht wie beim Laden-Modell
  function std(color, rough = 0.85, metal = 0, o = {}) { const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...o }); pbrMats.push(m); return m; }
  modeHooks.push((night) => { for (const m of pbrMats) { const e = envFor(night); if (e) { m.envMap = e; m.envMapIntensity = night ? (m.userData.envN ?? 0.6) : (m.userData.envD ?? 0.55); } } });

  // Platzhalter des Laden-Modells (alte Straße, Markierungen, Nachbar-Attrappen) ausblenden
  if (ext && ext.standIn) for (const o of ext.standIn) o.visible = false;
  if (ext && ext.reflector) ext.reflector.frustumCulled = false;   // Spiegelung auch für die Stadt-Fahrbahn aktuell halten

  // ================================================================ Lichtkarte der Laternen (0,5 m/px über der Region): Boden + Fassaden nachts
  const lampCanvas = document.createElement('canvas'); lampCanvas.width = CV.ground.W; lampCanvas.height = CV.ground.H;
  const lampTex = new THREE.CanvasTexture(lampCanvas); lampTex.colorSpace = THREE.NoColorSpace; lampTex.flipY = false; lampTex.minFilter = THREE.LinearFilter; lampTex.generateMipmaps = false;
  U.lampTex.value = lampTex;
  const lampOn = CV.lamps.map(() => true);
  function drawLampMap() {
    const g = lampCanvas.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, lampCanvas.width, lampCanvas.height);
    g.globalCompositeOperation = 'lighter';
    const k = 1 / CV.ground.CS;
    CV.lamps.forEach((l, i) => {
      if (!lampOn[i]) return;
      const hx = l[0] + Math.cos(l[2]) * 1.25, hz = l[1] + Math.sin(l[2]) * 1.25;
      const px = (hx - CV.ground.X0) * k, pz = (hz - CV.ground.Z0) * k, R = 12 * k;
      const gr = g.createRadialGradient(px, pz, 0, px, pz, R);
      gr.addColorStop(0, 'rgba(255,220,170,1)'); gr.addColorStop(0.1, 'rgba(255,210,160,0.9)'); gr.addColorStop(0.28, 'rgba(240,180,120,0.45)'); gr.addColorStop(0.55, 'rgba(210,150,100,0.14)'); gr.addColorStop(1, 'rgba(200,140,90,0)');
      g.fillStyle = gr; g.fillRect(px - R, pz - R, 2 * R, 2 * R);
    });
    g.globalCompositeOperation = 'source-over'; lampTex.needsUpdate = true;
  }
  drawLampMap();
  const LAMP_GLSL = `
    uniform sampler2D lampTex; uniform vec4 lampRect; uniform float uNight;
    vec3 lampAt(vec2 xz) { vec2 q = (xz - lampRect.xy) / lampRect.zw; if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) return vec3(0.0); return texture2D(lampTex, q).rgb; }`;
  const addLampUniforms = (sh) => { sh.uniforms.lampTex = U.lampTex; sh.uniforms.lampRect = U.lampRect; sh.uniforms.uNight = U.night; };

  // ================================================================ HÄUSER
  const atlasA = T('city_fac_alb.jpg', { wrap: false }), atlasN = T('city_fac_nrm.jpg', { srgb: false, wrap: false }), atlasM = T('city_fac_msk.png', { srgb: false, wrap: false });
  const facMat = new THREE.MeshStandardMaterial({ map: atlasA, normalMap: atlasN, roughnessMap: atlasM, roughness: 1, metalness: 0, vertexColors: true, normalScale: new THREE.Vector2(1, 1) });
  facMat.userData.envN = 0.9; facMat.userData.envD = 0.8; pbrMats.push(facMat);
  facMat.onBeforeCompile = (sh) => {
    addLampUniforms(sh);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 fa; attribute vec4 fb; attribute vec3 tcol; flat varying vec4 vFa; flat varying vec4 vFb; flat varying vec3 vTc; varying vec2 vFu; varying vec3 vWp;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvFa = fa; vFb = fb; vTc = tcol; vFu = uv;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      flat varying vec4 vFa; flat varying vec4 vFb; flat varying vec3 vTc; varying vec2 vFu; varying vec3 vWp;
      ${LAMP_GLSL}
      float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      vec2 aUV; vec2 aGx; vec2 aGy; float aGround; float aWin;
      void atlasSetup() {
        float st = vFa.x, wt = vFa.y, sd = vFa.z, nb = vFa.w;
        float EGH = vFb.x, FH = vFb.y, CS = vFb.z, TOPH = vFb.w;
        float u = vFu.x, hm = vFu.y; float bay = floor(u); float fu = clamp(fract(u), 0.004, 0.996);
        vec2 du = vec2(dFdx(u), dFdy(u)), dh = vec2(dFdx(hm), dFdy(hm));
        float col = 0.0, rowTop = 0.0, hPx = 384.0, fv = 0.0, vs = 1.0; aGround = 0.0; aWin = 0.0;
        if (hm >= CS) {                                     // Hauptgesims / Traufe
          rowTop = wt < 1.5 ? 1792.0 : 1920.0; hPx = 128.0; col = wt < 1.5 ? st : floor(sd * 7.99);
          vs = 1.0 / max(0.2, TOPH - CS); fv = (hm - CS) * vs;
        } else if (hm < EGH) {                              // Erdgeschoss
          aGround = 1.0; hPx = 512.0; vs = 1.0 / EGH; fv = hm * vs;
          float e = nb >= 3.0 ? floor(nb * 0.5 + (sd - 0.5) * 0.9) : -1.0;   // Hauseingang
          float k;
          if (wt < 0.5) {                                   // Geschäftsstraße: Läden paarweise, Eingang dazwischen
            if (bay == e) k = h21(vec2(sd, 3.1)) < 0.25 ? 15.0 : 12.0 + floor(h21(vec2(sd, 1.7)) * 1.99);
            else {
              float side = bay < e ? 0.0 : 1.0; float j = bay < e ? bay : bay - e - 1.0; float n = bay < e ? e : nb - e - 1.0;
              if (e < 0.0) { j = bay; n = nb; side = 0.0; }
              float pr = floor(j * 0.5); float hf = mod(j, 2.0);
              if (hf < 0.5 && j >= n - 1.0) k = 14.0;    // einzelne Restachse: Wohnungsfenster
              else { float s = floor(h21(vec2(sd * 7.0 + side, pr)) * 6.0); k = (s > 4.5 ? 10.0 : s * 2.0) + hf; }
            }
          } else if (wt < 1.5) {                            // Wohnstraße
            if (bay == e) k = h21(vec2(sd, 3.1)) < 0.3 ? 15.0 : 12.0 + floor(h21(vec2(sd, 1.7)) * 1.99);
            else if (h21(vec2(sd, 9.0)) < 0.25 && bay < 2.0 && nb > 3.0) k = (floor(h21(vec2(sd, 5.0)) * 4.99) * 2.0) + bay;
            else k = 14.0;
          } else k = 14.0;
          col = mod(k, 8.0); rowTop = 768.0 + floor(k / 8.0) * 512.0;
        } else {                                            // Obergeschosse
          float f = (hm - EGH) / FH; float fl = floor(f); fv = fract(f); vs = 1.0 / FH;
          aWin = 1.0 + fl;
          if (wt < 1.5) { rowTop = 0.0; col = st; }
          else if (wt < 2.5) { rowTop = 384.0; col = h21(vec2(sd, 2.0)) < 0.2 ? 7.0 : floor(sd * 3.99); }
          else { rowTop = 384.0; col = 4.0 + floor(h21(vec2(sd, 4.0)) * 2.99); }
        }
        aUV = vec2((col + fu) * 256.0, rowTop + (1.0 - fv) * hPx) / 2048.0; aUV.y = 1.0 - aUV.y;
        aGx = vec2(du.x * 256.0, -dh.x * vs * hPx) / 2048.0; aGy = vec2(du.y * 256.0, -dh.y * vs * hPx) / 2048.0;
        aWin = aWin > 0.5 ? h21(vec2(bay + sd * 31.0, aWin + sd * 17.0)) : -1.0;
      }`)
      .replace('#include <map_fragment>', `atlasSetup();
        vec4 tA = textureGrad(map, aUV, aGx, aGy); vec4 tM = textureGrad(roughnessMap, aUV, aGx, aGy);
        float glassM = smoothstep(0.35, 0.8, tM.g); float signBg = smoothstep(0.78, 0.95, tM.b); float signTx = (1.0 - signBg) * smoothstep(0.3, 0.45, tM.b) * (1.0 - smoothstep(0.62, 0.7, tM.b));
        vec3 alb = tA.rgb;
        alb = mix(alb * vColor.rgb, alb, max(glassM, max(signBg, signTx)));
        alb = mix(alb, vTc * (0.25 + dot(tA.rgb, vec3(0.33)) * 0.9), signBg);
        if (aWin >= 0.0) alb *= mix(1.0, 0.75 + aWin * 0.5, glassM);
        alb *= 0.9 + 0.1 * smoothstep(0.0, 0.6, vFu.y);
        diffuseColor.rgb *= alb;`)
      .replace('#include <color_fragment>', '')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(tM.r, mix(0.07, 0.12, aGround), glassM);')
      .replace('#include <normal_fragment_maps>', `{ vec3 mapN = textureGrad(normalMap, aUV, aGx, aGy).xyz * 2.0 - 1.0; mapN.xy *= normalScale * (1.0 - glassM); normal = normalize(tbn * mapN); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (uNight > 0.5) {
          float lum = dot(textureGrad(map, aUV, aGx * 10.0 + vec2(0.004, 0.0), aGy * 10.0 + vec2(0.0, 0.004)).rgb, vec3(0.3, 0.5, 0.2));
          float lit = aWin >= 0.0 ? step(aWin, 0.36) : 0.0;
          vec3 lc = mix(vec3(1.0, 0.72, 0.42), vec3(0.92, 0.88, 0.8), step(0.5, fract(aWin * 7.13)));
          lc = mix(lc, vec3(0.55, 0.65, 1.0), step(0.86, fract(aWin * 3.7)) * 0.7);
          totalEmissiveRadiance += glassM * lit * lc * (0.32 + lum * 1.25);
          totalEmissiveRadiance += glassM * aGround * tA.rgb * (vFa.y < 1.5 ? (h21(vec2(floor(floor(vFu.x) * 0.5), vFa.z * 13.0)) < 0.8 ? 0.75 : 0.06) : 0.3);
          totalEmissiveRadiance += signTx * vec3(1.0, 0.97, 0.9) * 1.05 + signBg * vTc * 0.28;
          vec3 la = lampAt(vWp.xz + normalize(vec2(vNormalW.x, vNormalW.z) + 1e-4) * 1.2);
          totalEmissiveRadiance += diffuseColor.rgb * la * 1.1 * (1.0 - smoothstep(3.0, 13.0, vFu.y)) * (1.0 - glassM * 0.5);
        }`)
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nvec3 vNormalW = inverseTransformDirection(normal, viewMatrix);');
  };
  facMat.customProgramCacheKey = () => 'cityFacade2';

  const TYPE = { M: 0, S: 1, C: 2, P: 3 };
  const SIGN = [0x1d5e3a, 0x8e1b1b, 0x1c2f5c, 0x18181a, 0xd9d4c4, 0xc7951e, 0xb4501c, 0x1f6c72, 0x5b2a6e, 0x2c2c2c];
  const STYLE_TINT = [[1, 1, 1], [1, 1, 1], [1, 0.99, 0.96], [1, 0.98, 0.97], [1, 1, 1], [1, 1, 1], [0.98, 1, 0.98], [1, 1, 1]];
  const _c = new THREE.Color();
  function buildingGeos(list, wallsList) {
    const pos = [], nrm = [], uv = [], fa = [], fb = [], tc = [], col = [], idx = [];
    const trim = [], roofs = [], slopes = [], chim = [];
    list.forEach((b, bi) => {
      const ws = wallsList[bi]; if (!ws) return;
      const sd = hash(b.id), r = rng(Math.floor(sd * 1e6) + 7);
      const style = b.st ?? Math.floor(sd * 8), L = b.lv || 5, y0 = b.y0 || 0, y1 = b.h, TOPH = y1 - y0;
      const egh = L === 1 ? TOPH : 4.55 + r() * 0.5, cs = L >= 3 ? TOPH - 1.0 : TOPH, fh = (cs - egh) / Math.max(1, L - 1);
      const tint = STYLE_TINT[style] || [1, 1, 1]; const j = 0.94 + r() * 0.1;
      const tcc = _c.set(SIGN[Math.floor(r() * SIGN.length)]).clone();
      const rings = [b.p, ...(b.holes || [])];
      const area = Math.abs(ringArea(b.p));
      rings.forEach((ring, ri) => {
        const A = ringArea(ring), n = ring.length;
        for (let k = 0; k < n; k++) {
          let t = ws[ri] ? ws[ri][k] : 'C'; if (!t || t === 'X') continue;
          let a = ring[k], c = ring[(k + 1) % n];
          let dx = c[0] - a[0], dz = c[1] - a[1]; const len = Math.hypot(dx, dz); if (len < 0.05) continue;
          let nx = dz / len, nz = -dx / len; if (A < 0) { nx = -nx; nz = -nz; } if (ri > 0) { nx = -nx; nz = -nz; }
          if (dx * nz - dz * nx < 0) { const s = a; a = c; c = s; dx = -dx; dz = -dz; }
          if ((t === 'M' || t === 'S') && len < 1.6) t = 'C';
          if (t === 'C' && len < 1.3) t = 'P';
          const ty = TYPE[t]; const street = ty < 2;
          const bw = style === 7 && street ? 2.9 : street ? 2.4 : 2.7;
          const nb = Math.max(1, Math.round(len / bw));
          const EGH = street ? egh : 0, CSx = street ? cs : TOPH - 0.55, FH = street ? fh : (TOPH - 0.55) / Math.max(1, L);
          const base = pos.length / 3;
          pos.push(a[0], y0, a[1], c[0], y0, c[1], c[0], y1, c[1], a[0], y1, a[1]);
          for (let q = 0; q < 4; q++) { nrm.push(nx, 0, nz); fa.push(style, ty, sd, nb); fb.push(EGH, FH, CSx, TOPH); tc.push(tcc.r, tcc.g, tcc.b); col.push(tint[0] * j, tint[1] * j, tint[2] * j); }
          uv.push(0, 0, nb, 0, nb, TOPH, 0, TOPH);
          idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
          // Gesimse als echte Vorsprünge (Schattenkanten): EG-Gesims + Hauptgesims
          if (street && L >= 2) {
            const ux = dx / len, uz = dz / len;
            const ledge = (yA, yB, d) => { const g = new THREE.BoxGeometry(len + d * 0.2, yB - yA, d); g.rotateY(Math.atan2(-uz, ux)); g.translate((a[0] + c[0]) / 2 + nx * d / 2, y0 + (yA + yB) / 2, (a[1] + c[1]) / 2 + nz * d / 2); return g; };
            trim.push(ledge(egh - 0.02, egh + 0.16, 0.12));
            if (L >= 3) { trim.push(ledge(TOPH - 0.32, TOPH - 0.02, 0.42)); trim.push(ledge(TOPH - 0.5, TOPH - 0.32, 0.2)); }
          }
          if (t === 'P' && r() < 0.35 && len > 4 && L >= 3) {   // Schornstein an der Brandwand
            const s = 0.2 + r() * 0.6; chim.push([a[0] + dx * s - nx * 0.5, y1, a[1] + dz * s - nz * 0.5, Math.atan2(-dz, dx), 0.8 + r() * 0.5]);
          }
        }
      });
      // Mansarddach entlang der Straßenwände, Ecken als Grat (keine Zacken)
      const dep = Math.min(2.8, Math.sqrt(area) / 3.2), rise = dep * 0.95;
      if (L >= 3 && dep > 1.2) {
        const ring = b.p, A = ringArea(ring), n = ring.length, E = [];
        for (let k = 0; k < n; k++) { const a = ring[k], c = ring[(k + 1) % n]; const dx = c[0] - a[0], dz = c[1] - a[1], len = Math.hypot(dx, dz) || 1;
          let nx = dz / len, nz = -dx / len; if (A < 0) { nx = -nx; nz = -nz; } const t = ws[0] ? ws[0][k] : 'C'; E.push({ sl: (t === 'M' || t === 'S') && len >= 1.6, nx, nz }); }
        const inner = (i, e) => { const e0 = E[(i - 1 + n) % n], e1 = E[i % n], v = ring[i % n];
          if (e0.sl && e1.sl) { const d = 1 + e0.nx * e1.nx + e0.nz * e1.nz; if (d > 0.35) return [v[0] - (e0.nx + e1.nx) / d * dep, v[1] - (e0.nz + e1.nz) / d * dep, true]; }
          return [v[0] - e.nx * dep, v[1] - e.nz * dep, false]; };
        const P = [], UV = [];
        const tri = (p0, p1, p2, u) => { P.push(...p0, ...p1, ...p2); UV.push(...u); };
        for (let k = 0; k < n; k++) { const e = E[k]; if (!e.sl) continue;
          const a = ring[k], c = ring[(k + 1) % n]; const [iax, iaz, ja] = inner(k, e), [icx, icz, jc] = inner(k + 1, e);
          const len = Math.hypot(c[0] - a[0], c[1] - a[1]), sl = Math.hypot(dep, rise);
          const A0 = [a[0], y1, a[1]], C0 = [c[0], y1, c[1]], AI = [iax, y1 + rise, iaz], CI = [icx, y1 + rise, icz];
          tri(A0, C0, CI, [0, 0, len / 4, 0, len / 4, sl / 4]); tri(A0, CI, AI, [0, 0, len / 4, sl / 4, 0, sl / 4]);
          if (!ja) tri(A0, AI, [iax, y1, iaz], [0, 0, 0, sl / 4, dep / 4, 0]);
          if (!jc) tri(C0, [icx, y1, icz], CI, [0, 0, dep / 4, 0, 0, sl / 4]);
        }
        if (P.length) { const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); sg.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); sg.computeVertexNormals();
          const rc = 0.8 + r() * 0.35; sg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(P.length).fill(rc), 3)); slopes.push(sg); }
      }
      // Flachdach
      try {
        const sh = new THREE.Shape(b.p.map(p => new THREE.Vector2(p[0], -p[1])));
        for (const h of b.holes || []) sh.holes.push(new THREE.Path(h.map(p => new THREE.Vector2(p[0], -p[1]))));
        const g = new THREE.ShapeGeometry(sh); g.rotateX(-Math.PI / 2); g.translate(0, y1 + 0.02, 0);
        const rk = r(), cv = 0.75 + r() * 0.4; const cc = rk < 0.22 ? [1.45 * cv, 0.78 * cv, 0.6 * cv] : rk < 0.3 ? [0.82 * cv, 0.95 * cv, 0.78 * cv] : [cv, cv, cv * 1.02];   // Teerpappe / Ziegelrot / Kies-grün
        const ca = new Float32Array(g.attributes.position.count * 3); for (let i = 0; i < ca.length; i += 3) { ca[i] = cc[0]; ca[i + 1] = cc[1]; ca[i + 2] = cc[2]; } g.setAttribute('color', new THREE.BufferAttribute(ca, 3));
        g.deleteAttribute('uv'); roofs.push(g);
      } catch (e) { /* kaputte Grundrisse überspringen */ }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('fa', new THREE.Float32BufferAttribute(fa, 4)); g.setAttribute('fb', new THREE.Float32BufferAttribute(fb, 4));
    g.setAttribute('tcol', new THREE.Float32BufferAttribute(tc, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
    g.computeBoundingSphere(); g.computeBoundingBox();
    return { fac: g, trim: trim.length ? merge(trim) : null, roof: roofs.length ? merge(roofs) : null, slope: slopes.length ? merge(slopes) : null, chim };
  }
  const trimMat = std(0xd9d0bf, 0.88); const roofMat = std(0xffffff, 0.92, 0, { map: T('city_flat.jpg'), vertexColors: true });
  const slopeMat = std(0xffffff, 0.8, 0, { map: T('city_roof.jpg'), vertexColors: true });
  slopeMat.side = THREE.DoubleSide;
  // Dach-Textur in Weltkoordinaten (Flachdach hat keine UV)
  roofMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vRw;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvRw = (modelMatrix * vec4(transformed, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vRw;').replace('#include <map_fragment>', 'diffuseColor *= texture2D(map, vRw / 6.0);');
  };
  const allChim = [];
  function addBuildings(list, walls, far) {
    const G = buildingGeos(list, walls);
    const m = new THREE.Mesh(G.fac, facMat); m.castShadow = true; m.receiveShadow = true; m.name = far ? 'facFar' : 'fac'; root.add(m); if (far) farOnly(m);
    if (G.trim) { const t = new THREE.Mesh(G.trim, trimMat); t.castShadow = !far; t.receiveShadow = true; root.add(t); if (far) farOnly(t); }
    if (G.roof) { const t = new THREE.Mesh(G.roof, roofMat); t.receiveShadow = true; root.add(t); if (far) farOnly(t); }
    if (G.slope) { const t = new THREE.Mesh(G.slope, slopeMat); t.castShadow = !far; t.receiveShadow = true; root.add(t); if (far) farOnly(t); }
    allChim.push(...G.chim);
    return m;
  }
  addBuildings(CJ.buildings, CV.walls, false);
  // Fernbereich in 4 Viertel (Sichtbarkeit / Sortierung)
  { const q = [[], [], [], []], qw = [[], [], [], []];
    CV.far.forEach((b, i) => { const cx = b.p.reduce((s, p) => s + p[0], 0) / b.p.length, cz = b.p.reduce((s, p) => s + p[1], 0) / b.p.length; const k = (cx > 50 ? 1 : 0) + (cz > -50 ? 2 : 0); q[k].push(b); qw[k].push(CV.farWalls[i]); });
    q.forEach((l, k) => { if (l.length) addBuildings(l, qw[k], true); }); }
  if (allChim.length) {
    const cg = new THREE.BoxGeometry(0.55, 1, 0.9); cg.translate(0, 0.5, 0);
    const cm = new THREE.InstancedMesh(cg, std(0x8a5a48, 0.9), allChim.length); const o = new THREE.Object3D();
    allChim.forEach((c, i) => { o.position.set(c[0], c[1], c[2]); o.rotation.set(0, c[3], 0); o.scale.set(1, c[4], 1); o.updateMatrix(); cm.setMatrixAt(i, o.matrix); });
    cm.castShadow = true; root.add(cm);
  }

  // ================================================================ BODEN
  function shapeGeo(polys, y) {
    const gs = [];
    for (const pl of polys) {
      try {
        const sh = new THREE.Shape(pl.p.map(p => new THREE.Vector2(p[0], -p[1])));
        for (const h of pl.holes || []) sh.holes.push(new THREE.Path(h.map(p => new THREE.Vector2(p[0], -p[1]))));
        const g = new THREE.ShapeGeometry(sh); g.rotateX(-Math.PI / 2); g.translate(0, y, 0); g.deleteAttribute('uv'); gs.push(g);
      } catch (e) {}
    }
    return gs.length ? merge(gs) : null;
  }
  const wetBase = (sh, k) => { if (ext && ext.wetShader) ext.wetShader(sh, k); };
  // Gehweg: Platten + Mosaikstreifen (an Bordstein und Hauswand), Ausrichtung nach Straße (Boden-Info-Bild)
  const gtex = TL.load('city/ground.png' + VQ, () => W.requestRender()); gtex.colorSpace = THREE.NoColorSpace; gtex.flipY = false; gtex.minFilter = THREE.LinearFilter; gtex.generateMipmaps = false;
  const slabT = ctx.tex('sidewalk_slab.jpg', { repeat: [1, 1] }) || T('city_asphalt.jpg'), mosT = ctx.tex('sidewalk_mosaic.jpg', { repeat: [1, 1] }) || T('city_asphalt.jpg');
  const macroT = T('city_macro.jpg', { srgb: false });
  const walkMat = std(0xaeaca7, 0.85, 0, { map: slabT });
  walkMat.userData.wet = true;
  walkMat.onBeforeCompile = (sh) => {
    addLampUniforms(sh); sh.uniforms.gTex = { value: gtex }; sh.uniforms.mosT = { value: mosT }; sh.uniforms.macT = { value: macroT };
    sh.uniforms.gRect = { value: new THREE.Vector4(CV.ground.X0, CV.ground.Z0, CV.ground.W * CV.ground.CS, CV.ground.H * CV.ground.CS) };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGw;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGw = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vGw; uniform sampler2D gTex; uniform sampler2D mosT; uniform sampler2D macT; uniform vec4 gRect; ${LAMP_GLSL}`)
      .replace('#include <map_fragment>', `
        vec2 gq = (vGw.xz - gRect.xy) / gRect.zw; float inR = step(0.0, gq.x) * step(0.0, gq.y) * step(gq.x, 1.0) * step(gq.y, 1.0);
        vec4 gf = texture2D(gTex, clamp(gq, 0.0, 1.0));
        float dC = mix(99.0, gf.r * 255.0 / 20.0, inR), dB = mix(99.0, gf.g * 255.0 / 20.0, inR);
        float th = inR * (gf.b - 0.5) * 1.5707963;
        mat2 R = mat2(cos(th), -sin(th), sin(th), cos(th)); vec2 ruv = R * vGw.xz;
        float mos = max(1.0 - step(0.82, dC), 1.0 - step(0.45, dB));
        vec3 slab = texture2D(map, ruv / 2.0).rgb; vec3 mo = texture2D(mosT, ruv).rgb * vec3(1.18, 1.16, 1.1);
        vec3 mc = texture2D(macT, vGw.xz / 37.0).rgb;
        vec3 gc = mix(slab, mo, mos) * (0.88 + 0.24 * mc.r) * (1.0 - 0.06 * mc.g);
        diffuseColor.rgb *= gc;`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\nif (uNight > 0.5) totalEmissiveRadiance += diffuseColor.rgb * lampAt(vGw.xz) * 2.4;');
    wetBase(sh, 0.1);
  };
  walkMat.customProgramCacheKey = () => 'cityWalk1';
  { const g = shapeGeo(CV.walk, 0.0); if (g) { const m = new THREE.Mesh(g, walkMat); m.receiveShadow = true; m.name = 'walk'; root.add(m); if (ext && ext.addWet) ext.addWet(m); } }

  // Fahrbahn
  const asphT = T('city_asphalt.jpg');
  const roadMat = std(0xffffff, 0.82, 0, { map: asphT });
  roadMat.userData.wet = true;
  roadMat.onBeforeCompile = (sh) => {
    addLampUniforms(sh); sh.uniforms.macT = { value: macroT };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGw;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGw = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vGw; uniform sampler2D macT; ${LAMP_GLSL}`)
      .replace('#include <map_fragment>', `
        vec3 mc = texture2D(macT, vGw.xz / 53.0).rgb; vec3 mc2 = texture2D(macT, vGw.xz / 11.0).rgb;
        vec3 ac = texture2D(map, vGw.xz / 8.0).rgb * (0.82 + 0.3 * mc.r) * (0.93 + 0.12 * mc2.g);
        diffuseColor.rgb *= ac;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * (0.85 + 0.3 * mc.b);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\nif (uNight > 0.5) totalEmissiveRadiance += diffuseColor.rgb * lampAt(vGw.xz) * 3.2;');
    wetBase(sh, 0.3);
  };
  roadMat.customProgramCacheKey = () => 'cityRoad1';
  { const g = shapeGeo([...CJ.asphalt, ...CV.farAsphalt], -0.14); if (g) { const m = new THREE.Mesh(g, roadMat); m.receiveShadow = true; m.name = 'road'; root.add(m); if (ext && ext.addWet) ext.addWet(m); } }

  // ================================================================ BORDSTEINE (Profil wie im Modell: Fase zur Fahrbahn)
  const curbMat = std(0x8e8c85, 0.78, 0, { side: THREE.DoubleSide });
  curbMat.onBeforeCompile = (sh) => {
    addLampUniforms(sh); sh.uniforms.macT = { value: macroT };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGw;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGw = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vGw; uniform sampler2D macT; ${LAMP_GLSL}`)
      .replace('#include <map_fragment>', 'vec3 mc = texture2D(macT, vGw.xz / 3.1 + vGw.y).rgb; diffuseColor.rgb *= 0.8 + 0.35 * mc.r; float joint = smoothstep(0.0, 0.03, abs(fract((vGw.x + vGw.z) / 1.0) - 0.5) - 0.47); diffuseColor.rgb *= 1.0 - 0.35 * joint;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\nif (uNight > 0.5) totalEmissiveRadiance += diffuseColor.rgb * lampAt(vGw.xz) * 2.2;');
  };
  curbMat.customProgramCacheKey = () => 'cityCurb1';
  const roadPolys = CJ.asphalt;
  const inRoad = (x, z) => roadPolys.some(pl => inPoly(pl, x, z));
  function sweep(lines, prof, yBase, sideFn) {      // Profil (d quer zum Gehweg, y) entlang Linien
    const pos = [], idx = [];
    for (const L0 of lines) {
      if (L0.length < 2) continue;
      const closed = Math.hypot(L0[0][0] - L0[L0.length - 1][0], L0[0][1] - L0[L0.length - 1][1]) < 0.01;
      const L = closed ? L0.slice(0, -1) : L0; const n = L.length; if (n < 2) continue;
      // Seite: Gehweg = Seite ohne Fahrbahn
      const a = L[0], b = L[1]; const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2; const sgn = sideFn(mx + (-dz / l) * 0.6, mz + (dx / l) * 0.6) ? -1 : 1;   // links (−dz,dx) Fahrbahn? dann rechts
      const base = pos.length / 3; const np = prof.length;
      for (let i = 0; i < n; i++) {
        const p = L[i], pp = L[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], pn = L[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
        let t1x = p[0] - pp[0], t1z = p[1] - pp[1], t2x = pn[0] - p[0], t2z = pn[1] - p[1];
        const l1 = Math.hypot(t1x, t1z) || 1, l2 = Math.hypot(t2x, t2z) || 1; t1x /= l1; t1z /= l1; t2x /= l2; t2z /= l2;
        if (i === 0 && !closed) { t1x = t2x; t1z = t2z; } if (i === n - 1 && !closed) { t2x = t1x; t2z = t1z; }
        let nx = -(t1z + t2z), nz = (t1x + t2x); const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
        const cosA = Math.max(0.35, nx * -t2z + nz * t2x); const k = sgn / cosA;
        for (const [d, y] of prof) pos.push(p[0] + nx * d * k, yBase + y, p[1] + nz * d * k);
      }
      const segs = closed ? n : n - 1;
      for (let i = 0; i < segs; i++) {
        const i2 = (i + 1) % n;
        for (let j = 0; j < np - 1; j++) {
          const a0 = base + i * np + j, a1 = base + i * np + j + 1, b0 = base + i2 * np + j, b1 = base + i2 * np + j + 1;
          if (sgn > 0) idx.push(a0, b0, b1, a0, b1, a1); else idx.push(a0, b1, b0, a0, a1, b1);
        }
      }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
  }
  const CURB = [[0, -0.16], [0, -0.05], [0.06, 0.0], [0.25, 0.0], [0.27, -0.02]];
  { const g = sweep([...CJ.curbs, ...(CV.farCurbs || [])], CURB, 0, (x, z) => inRoad(x, z) || CV.farAsphalt.some(pl => inPoly(pl, x, z)));
    const m = new THREE.Mesh(g, curbMat); m.receiveShadow = true; m.castShadow = false; m.name = 'curbs'; root.add(m); }

  // ================================================================ MARKIERUNGEN
  const mk = { pos: [] };
  const MY = -0.135;
  function quad(ax, az, bx, bz, w) { const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz); if (l < 0.01) return; const nx = -dz / l * w / 2, nz = dx / l * w / 2;
    mk.pos.push(ax - nx, MY, az - nz, bx + nx, MY, bz + nz, bx - nx, MY, bz - nz, ax - nx, MY, az - nz, ax + nx, MY, az + nz, bx + nx, MY, bz + nz); }
  function polyLen(P) { let s = 0; for (let i = 1; i < P.length; i++) s += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); return s; }
  function at(P, s) { // Punkt + Richtung bei Bogenlänge s
    for (let i = 1; i < P.length; i++) { const l = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); if (s <= l || i === P.length - 1) { const t = l ? Math.min(1, s / l) : 0; return [P[i - 1][0] + (P[i][0] - P[i - 1][0]) * t, P[i - 1][1] + (P[i][1] - P[i - 1][1]) * t, (P[i][0] - P[i - 1][0]) / (l || 1), (P[i][1] - P[i - 1][1]) / (l || 1)]; } s -= l; }
    return [P[0][0], P[0][1], 1, 0];
  }
  function offsetPts(P, off) { return P.map((p, i) => { const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)]; const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1; return [p[0] - dz / l * off, p[1] + dx / l * off]; }); }
  function stroke(P, w, dash, gap, s0 = 0, s1 = Infinity) {
    const L = Math.min(polyLen(P), s1); let s = s0;
    while (s < L) { const e = Math.min(L, s + (dash || L)); const st = Math.max(0.5, Math.min(2, e - s)); let a = at(P, s);
      for (let q = s + st; q <= e + 1e-6; q += st) { const b = at(P, Math.min(q, e)); quad(a[0], a[1], b[0], b[1], w); a = b; }
      s = e + (gap || 0); if (!dash) break; }
  }
  // Knoten, an denen mehrere Straßen zusammenkommen (dort keine Längsmarkierung)
  const nodeWays = new Map(); for (const e of CJ.edges) for (const nd of [e.from, e.to]) { if (!nodeWays.has(nd)) nodeWays.set(nd, new Set()); nodeWays.get(nd).add(e.name || e.w); }
  const isJ = (nd) => (nodeWays.get(nd) || new Set()).size > 1;
  for (const e of CJ.edges) {
    if (e.hw !== 'primary') continue;
    const L = polyLen(e.lanes[0]); const s0 = isJ(e.from) ? 13 : 0, s1 = L - (isJ(e.to) ? 13 : 0); if (s1 - s0 < 3) continue;
    const nl = e.lanes.length;
    for (let i = 0; i < nl - 1; i++) { const mid = e.lanes[i].map((p, k) => [(p[0] + e.lanes[i + 1][k][0]) / 2, (p[1] + e.lanes[i + 1][k][1]) / 2]); stroke(mid, 0.12, 3, 6, s0, s1); }
    stroke(offsetPts(e.lanes[nl - 1], 1.72), 0.15, 0, 0, s0, s1);                         // Rand-/Parkstreifenlinie
    const ow = !CJ.edges.some(o => o.w === e.w && o.from === e.to && o.to === e.from);
    if (ow) stroke(offsetPts(e.lanes[0], -1.7), 0.15, 0, 0, s0, s1);                         // Einbahn: linke Randlinie
  }
  // Haltelinien
  for (const e of CJ.edges) { const sg = e.sig; if (!sg) continue;
    const L0 = e.lanes[0], Ln = e.lanes[e.lanes.length - 1]; const a = at(L0, sg.s), b = at(Ln, sg.s);
    const ax = a[0] + a[3] * 1.7, az = a[1] - a[2] * 1.7, bx = b[0] - b[3] * 1.65, bz = b[1] + b[2] * 1.65;
    quad(ax, az, bx, bz, 0.5); }
  // Fußgängerfurten (Ampel) bzw. Zebrastreifen
  const zebraPts = CJ.points.crossing.filter(c => c[2] === 'uncontrolled' || c[2] === 'zebra');
  for (const w of CJ.walk) { if (!w.cross) continue;
    const P = w.pts, L = polyLen(P); const mid = at(P, L / 2);
    const zebra = zebraPts.some(c => Math.hypot(c[0] - mid[0], c[1] - mid[1]) < 6);
    if (zebra) { for (let k = -1.75; k <= 1.76; k += 1.0) { const Q = offsetPts(P, k); stroke(Q, 0.5, 0, 0, 0.3, L - 0.3); } continue; }
    for (const off of [-2.1, 2.1]) { const Q = offsetPts(P, off); let s = 0.3; while (s < L - 0.3) { const a = at(Q, s), b = at(Q, s + 0.5); if (inRoad((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)) quad(a[0], a[1], b[0], b[1], 0.12); s += 0.7; } }
  }
  // gemalter Mittelstreifen (Sperrfläche): Umriss + Schraffur
  for (const md of CJ.medians) {
    const R = md.p; const n = R.length;
    for (let i = 0; i < n; i++) { const a = R[i], b = R[(i + 1) % n]; quad(a[0], a[1], b[0], b[1], 0.14); }
    let x0 = 1e9, x1 = -1e9; for (const p of R) { x0 = Math.min(x0, p[0] + p[1]); x1 = Math.max(x1, p[0] + p[1]); }
    for (let c = x0 + 1.2; c < x1; c += 2.4) {    // Linien x + z = c (45°)
      const hits = [];
      for (let i = 0; i < n; i++) { const a = R[i], b = R[(i + 1) % n]; const fa = a[0] + a[1] - c, fb = b[0] + b[1] - c; if ((fa > 0) !== (fb > 0)) { const t = fa / (fa - fb); hits.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); } }
      hits.sort((p, q) => p[0] - q[0]); for (let k = 0; k + 1 < hits.length; k += 2) quad(hits[k][0], hits[k][1], hits[k + 1][0], hits[k + 1][1], 0.3);
    }
  }
  const markMat = std(0xe6e4dc, 0.55, 0, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  markMat.userData.wet = true;
  markMat.onBeforeCompile = (sh) => {
    addLampUniforms(sh); sh.uniforms.macT = { value: macroT };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGw;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGw = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vGw; uniform sampler2D macT; ${LAMP_GLSL}`)
      .replace('#include <map_fragment>', 'vec3 mc = texture2D(macT, vGw.xz / 4.0).rgb; vec3 mc2 = texture2D(macT, vGw.xz * 1.7).rgb; diffuseColor.rgb *= mix(0.42, 1.0, smoothstep(0.25, 0.6, mc.r * 0.6 + mc2.g * 0.6));')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\nif (uNight > 0.5) totalEmissiveRadiance += diffuseColor.rgb * lampAt(vGw.xz) * 2.6;');
    wetBase(sh, 0.25);
  };
  markMat.customProgramCacheKey = () => 'cityMark1';
  { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(mk.pos, 3)); g.computeVertexNormals();
    const m = new THREE.Mesh(g, markMat); m.receiveShadow = true; m.name = 'markings'; root.add(m); if (ext && ext.addWet) ext.addWet(m); }

  // ================================================================ TRAM: Rasengleis + Schienen
  function canvasTex(w, h, draw, srgb = true) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = maxAniso; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; }
  const grassT = canvasTex(256, 256, (g, w, h) => { const r = rng(5); g.fillStyle = '#4c6a2c'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) { const v = r(); g.fillStyle = `rgba(${60 + v * 70 | 0},${90 + v * 60 | 0},${30 + v * 30 | 0},0.6)`; g.fillRect(r() * w, r() * h, 1 + r() * 1.5, 2 + r() * 4); }
    for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(120,110,80,${0.15 + r() * 0.2})`; g.beginPath(); g.arc(r() * w, r() * h, 3 + r() * 9, 0, 6.3); g.fill(); } });
  const grassMat = std(0xffffff, 0.95, 0, { map: grassT });
  grassMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGw;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGw = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vGw; uniform sampler2D macT;').replace('#include <map_fragment>', 'diffuseColor.rgb *= texture2D(map, vGw.xz / 2.3).rgb * (0.8 + 0.4 * texture2D(macT, vGw.xz / 23.0).r);');
    sh.uniforms.macT = { value: macroT };
  };
  grassMat.customProgramCacheKey = () => 'cityGrass1';
  { const g = shapeGeo([...CJ.trackbed, ...(CV.farTrack || [])], -0.03); if (g) { const m = new THREE.Mesh(g, grassMat); m.receiveShadow = true; root.add(m); } }
  { const rp = []; const RW = 0.075;
    for (const T0 of [...CJ.tram, ...(CV.farTram || [])]) {
      const L = polyLen(T0);
      for (const off of [-0.7175, 0.7175]) {
        const P = offsetPts(T0, off); let a = at(P, 0); let ya = inRoad(a[0], a[1]) ? -0.135 : 0.02;
        for (let s = 1.5; s <= L + 1e-6; s += 1.5) { const b = at(P, Math.min(s, L)); const yb = inRoad(b[0], b[1]) ? -0.135 : 0.02;
          const nx = -b[3] * RW / 2, nz = b[2] * RW / 2;
          rp.push(a[0] - nx, ya, a[1] - nz, b[0] + nx, yb, b[1] + nz, b[0] - nx, yb, b[1] - nz, a[0] - nx, ya, a[1] - nz, a[0] + nx, ya, a[1] + nz, b[0] + nx, yb, b[1] + nz);
          rp.push(a[0] + nx, ya, a[1] + nz, b[0] + nx, yb, b[1] + nz, b[0] + nx, yb - 0.09, b[1] + nz, a[0] + nx, ya, a[1] + nz, b[0] + nx, yb - 0.09, b[1] + nz, a[0] + nx, ya - 0.09, a[1] + nz);
          rp.push(a[0] - nx, ya, a[1] - nz, a[0] - nx, ya - 0.09, a[1] - nz, b[0] - nx, yb - 0.09, b[1] - nz, a[0] - nx, ya, a[1] - nz, b[0] - nx, yb - 0.09, b[1] - nz, b[0] - nx, yb, b[1] - nz);
          a = b; ya = yb; }
      }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3)); g.computeVertexNormals();
    const m = new THREE.Mesh(g, std(0xb8bcc0, 0.28, 0.95, { side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })); m.name = 'rails'; root.add(m); }

  // ================================================================ STADTMÖBEL: statische Teile in EINEM Netz (Farbe/Rauheit/Metall je Ecke)
  const PB = []; const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _yax = new THREE.Vector3(0, 1, 0);
  function put(geo, col, rough, metal, x, y, z, a = 0, sx = 1, sy = 1, sz = 1) {
    _q.setFromAxisAngle(_yax, -a); _m4.compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz)); geo.applyMatrix4(_m4);
    if (geo.index) geo = geo.toNonIndexed(); geo.deleteAttribute('uv');
    const n = geo.attributes.position.count; const c = new THREE.Color(col);
    const ca = new Float32Array(n * 3), pa = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { ca[i * 3] = c.r; ca[i * 3 + 1] = c.g; ca[i * 3 + 2] = c.b; pa[i * 2] = rough; pa[i * 2 + 1] = metal; }
    geo.setAttribute('color', new THREE.BufferAttribute(ca, 3)); geo.setAttribute('pr', new THREE.BufferAttribute(pa, 2)); PB.push(geo); return geo;
  }
  // lokale Teile: lx = vorwärts (Blickrichtung a), lz = seitlich; Weltlage über (x, z, a)
  const LX = (x, z, a, lx, lz) => [x + Math.cos(a) * lx - Math.sin(a) * lz, z + Math.sin(a) * lx + Math.cos(a) * lz];
  function boxAt(w, h, d, x, z, a, lx, ly, lz, col, rough = 0.7, metal = 0, ra = 0) { const [wx, wz] = LX(x, z, a, lx, lz); return put(new THREE.BoxGeometry(w, h, d), col, rough, metal, wx, ly, wz, a + ra); }
  function cylAt(r0, r1, h, x, z, a, lx, ly, lz, col, rough = 0.5, metal = 0.6, seg = 10) { const [wx, wz] = LX(x, z, a, lx, lz); const g = new THREE.CylinderGeometry(r1, r0, h, seg); g.translate(0, h / 2, 0); return put(g, col, rough, metal, wx, ly, wz, a); }
  function tube(p0, p1, r, col, rough = 0.5, metal = 0.6, seg = 8) { const a = new THREE.Vector3(...p0), b = new THREE.Vector3(...p1); const d = b.clone().sub(a); const L = d.length(); const g = new THREE.CylinderGeometry(r, r, L, seg); g.translate(0, L / 2, 0);
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(_yax, d.normalize()))); g.translate(a.x, a.y, a.z); return put(g, col, rough, metal, 0, 0, 0); }
  const shootables = []; const blocked = [];
  // ---- Laternen (Berliner Mastleuchte, Arm über die Fahrbahn)
  const lampHead = [];
  CV.lamps.forEach((l, i) => {
    const [x, z, a] = l; const POLE = 0x3b4044;
    cylAt(0.13, 0.12, 0.9, x, z, a, 0, 0, 0, POLE, 0.55, 0.6, 12); cylAt(0.105, 0.072, 7.9, x, z, a, 0, 0, 0, POLE, 0.5, 0.6, 12);
    const [ax0, az0] = LX(x, z, a, 0.02, 0), [ax1, az1] = LX(x, z, a, 1.55, 0);
    tube([ax0, 7.82, az0], [ax1, 7.98, az1], 0.045, POLE);
    boxAt(0.78, 0.12, 0.34, x, z, a, 1.72, 7.94, 0, 0x2c3034, 0.45, 0.6);
    const [hx, hz] = LX(x, z, a, 1.72, 0); lampHead.push([hx, 7.875, hz, a]);
  });
  // ---- Ampeln
  const heads = [];   // {kind, c, ax, lens: [instanzen]}
  for (const [x, z, hs] of CV.poles) {
    const G = 0x50565a;
    cylAt(0.075, 0.065, 3.75, x, z, 0, 0, 0, 0, G, 0.55, 0.5, 10); cylAt(0.09, 0.09, 0.05, x, z, 0, 0, 3.75, 0, G);
    hs.forEach((h, k) => {
      const [kind, ang, c, ax] = h; const car = kind === 'c';
      const yC = car ? 2.95 - k * 1.1 : 2.25 + (k > 0 ? 0.75 : 0);
      const hw = car ? 0.3 : 0.28, hh = car ? 0.95 : 0.64;
      boxAt(0.22, hh, hw, x, z, ang, 0.2, yC - hh / 2, 0, 0x1c1e20, 0.5, 0.3);
      if (car) boxAt(0.02, hh + 0.36, hw + 0.36, x, z, ang, 0.09, yC - hh / 2 - 0.18, 0, 0x101112, 0.6, 0.1);
      boxAt(0.18, 0.05, 0.05, x, z, ang, 0.1, yC - 0.1, 0, G);
      const lenses = [];
      const n = car ? 3 : 2;
      for (let j = 0; j < n; j++) {
        const ly = car ? yC - 0.16 - j * 0.31 : yC - 0.16 - j * 0.32;
        boxAt(0.12, 0.025, 0.22, x, z, ang, 0.36, ly + 0.13, 0, 0x141516, 0.5, 0.3);       // Schute
        const [px, pz] = LX(x, z, ang, 0.315, 0); lenses.push([px, ly, pz, ang]);
      }
      heads.push({ car, c, ax, lenses, st: '' });
    });
    blocked.push([x, z]);
  }
  // ---- Mülleimer (BSR-orange), Poller, Fahrradbügel, Bänke, Stromkästen, Litfaßsäulen
  for (const [x, z] of CV.bollards) { cylAt(0.085, 0.07, 0.92, x, z, 0, 0, 0, 0, 0x2f3236, 0.5, 0.5, 10); cylAt(0.072, 0.072, 0.07, x, z, 0, 0, 0.72, 0, 0xd8d8d0, 0.35, 0.2, 10); }
  for (const [x, z, a] of CV.bikes) for (let k = -1.5; k <= 1.5; k += 1) {
    const [bx, bz] = LX(x, z, a, 0, k * 0.9); const [p0x, p0z] = LX(bx, bz, a, -0.38, 0), [p1x, p1z] = LX(bx, bz, a, 0.38, 0);
    tube([p0x, 0, p0z], [p0x, 0.72, p0z], 0.03, 0x8e9396, 0.35, 0.8); tube([p1x, 0, p1z], [p1x, 0.72, p1z], 0.03, 0x8e9396, 0.35, 0.8); tube([p0x, 0.72, p0z], [p1x, 0.72, p1z], 0.03, 0x8e9396, 0.35, 0.8); }
  for (const [x, z, a] of CV.benches) {
    for (let k = 0; k < 4; k++) boxAt(0.09, 0.035, 1.8, x, z, a, -0.18 + k * 0.11, 0.44, 0, 0x7a5236, 0.75, 0);
    for (let k = 0; k < 2; k++) boxAt(0.035, 0.1, 1.8, x, z, a, -0.3, 0.6 + k * 0.14, 0, 0x7a5236, 0.75, 0);
    for (const s of [-0.75, 0.75]) { boxAt(0.5, 0.06, 0.06, x, z, a, -0.05, 0.4, s, 0x2a2d30, 0.5, 0.7); boxAt(0.06, 0.42, 0.06, x, z, a, 0.12, 0, s, 0x2a2d30, 0.5, 0.7); boxAt(0.06, 0.75, 0.06, x, z, a, -0.25, 0, s, 0x2a2d30, 0.5, 0.7); }
  }
  for (const [x, z, a] of CV.boxes) { boxAt(0.36, 1.25, 0.9, x, z, a, 0, 0.625, 0, 0xa8a698, 0.7, 0.1); boxAt(0.4, 0.06, 0.95, x, z, a, 0, 1.27, 0, 0x8e8c80, 0.6, 0.1); }
  for (const [x, z] of CV.columns) { cylAt(0.68, 0.68, 0.25, x, z, 0, 0, 0, 0, 0x2a3a30, 0.6, 0.3, 24); cylAt(0.68, 0.7, 0.12, x, z, 0, 0, 3.35, 0, 0x2a3a30, 0.6, 0.3, 24);
    const dg = new THREE.SphereGeometry(0.66, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2); dg.scale(1, 0.55, 1); put(dg, 0x2c4034, 0.5, 0.4, x, 3.47, z); cylAt(0.05, 0.02, 0.35, x, z, 0, 0, 3.8, 0, 0xb09048, 0.4, 0.8, 8); }
  // ---- Haltestellen-Wartehallen (lx = zur Fahrbahn)
  const glassPanels = [];   // [x0..] Glasscheiben (zerspringen)
  for (const [x, z, a] of CV.shelters) {
    const ST = 0x6c7276;
    for (const [lx, lz] of [[-0.72, -2.1], [-0.72, 2.1], [0.55, -2.1], [0.55, 2.1]]) boxAt(0.07, 2.45, 0.07, x, z, a, lx, 1.225, lz, ST, 0.4, 0.8);
    boxAt(1.65, 0.1, 4.45, x, z, a, -0.08, 2.48, 0, 0x3a3e42, 0.5, 0.5); boxAt(1.7, 0.03, 4.5, x, z, a, -0.08, 2.545, 0, 0x2a2d30, 0.6, 0.4);
    boxAt(0.4, 0.05, 2.0, x, z, a, -0.48, 0.46, -0.6, 0x9aa0a4, 0.35, 0.8); boxAt(0.05, 0.46, 0.05, x, z, a, -0.48, 0.23, -1.5, ST); boxAt(0.05, 0.46, 0.05, x, z, a, -0.48, 0.23, 0.3, ST);
    boxAt(0.18, 1.85, 1.25, x, z, a, -0.08, 1.2, 2.12, 0x3a3e42, 0.5, 0.5);     // Werbevitrine (Rahmen)
    glassPanels.push({ x, z, a, lx: -0.72, lz: 0, w: 4.15, h: 2.0, ax: 'z' }, { x, z, a, lx: -0.08, lz: -2.1, w: 1.2, h: 2.0, ax: 'x' });
    const [sx, sz] = LX(x, z, a, 1.0, -2.6); cylAt(0.04, 0.035, 2.75, sx, sz, 0, 0, 0, 0, 0x8a9094, 0.4, 0.8, 8);
    boxAt(0.06, 0.55, 0.38, sx, sz, a, 0.05, 1.3, 0, 0xdedede, 0.5, 0.1);      // Fahrplan
    blocked.push([x, z]);
  }
  // ---- U-Bahn-Eingänge: Schacht, Treppe, Geländer, U-Schild
  const ubLights = [];
  for (const [x, z, o] of CV.ubahn) {
    const TIL = 0xd8d2c2, CON = 0x8c8a84, RAIL = 0x223a2c;
    for (const s of [-1, 1]) boxAt(6.9, 3.8, 0.12, x, z, 0, 0, -1.9, s * 1.26, TIL, 0.4, 0);   // Längswände (innen)
    boxAt(0.12, 3.8, 2.52, x, z, 0, -o * 3.51, -1.9, 0, TIL, 0.4, 0);                         // Stirnwand
    const N = 19, run = 0.29, rise = 0.175;
    for (let i = 0; i < N; i++) { const lx = o * (3.45 - (i + 0.5) * run); boxAt(run, 3.8 - (i + 1) * rise, 2.4, x, z, 0, lx, -(i + 1) * rise - (3.8 - (i + 1) * rise) / 2, 0, CON, 0.85, 0); }
    boxAt(6.9 - N * run, 0.3, 2.4, x, z, 0, -o * (3.45 - (6.9 - N * run) / 2), -3.48, 0, CON, 0.85, 0);
    // Geländer an drei Seiten
    const H = 1.05, cor = [[o * 3.5, -1.33], [-o * 3.5, -1.33], [-o * 3.5, 1.33], [o * 3.5, 1.33]];
    for (let e = 0; e < 3; e++) { const [ax, az] = cor[e], [bx, bz] = cor[e + 1]; const L = Math.hypot(bx - ax, bz - az); const n = Math.max(1, Math.round(L / 1.15));
      for (let k = 0; k <= n; k++) { const px = ax + (bx - ax) * k / n, pz = az + (bz - az) * k / n; boxAt(0.05, H, 0.05, x, z, 0, px, H / 2, pz, RAIL, 0.5, 0.6); }
      const [wx0, wz0] = LX(x, z, 0, ax, az), [wx1, wz1] = LX(x, z, 0, bx, bz);
      tube([wx0, H, wz0], [wx1, H, wz1], 0.03, RAIL); tube([wx0, 0.55, wz0], [wx1, 0.55, wz1], 0.018, RAIL); tube([wx0, 0.12, wz0], [wx1, 0.12, wz1], 0.018, RAIL); }
    const [ux, uz] = LX(x, z, 0, o * 3.75, 1.55); cylAt(0.05, 0.045, 2.75, ux, uz, 0, 0, 0, 0, 0x2c3a46, 0.5, 0.6, 8);
    ubLights.push([x, z, o, ux, uz]);
  }
  // ---- Straßennamen an Laternen/Masten
  const signPlates = [];
  for (const [x, z, n1, n2] of CV.names) signPlates.push([x, z, n1], [x, z, n2]);
  { // Mischmaterial: Rauheit/Metall je Ecke
    const g = merge(PB); g.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1 }); mat.userData.envN = 0.5; mat.userData.envD = 0.7; pbrMats.push(mat);
    mat.onBeforeCompile = (sh) => {
      addLampUniforms(sh);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 pr; varying vec2 vPr; varying vec3 vGw;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvPr = pr; vGw = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec2 vPr; varying vec3 vGw; ${LAMP_GLSL}`)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vPr.x;').replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vPr.y;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\nif (uNight > 0.5) totalEmissiveRadiance += diffuseColor.rgb * lampAt(vGw.xz) * 1.6 * (1.0 - smoothstep(2.0, 9.0, vGw.y));');
    };
    mat.customProgramCacheKey = () => 'cityProps1';
    const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; m.name = 'props'; root.add(m);
  }

  // ---- Schilder-Atlas (U, H, Werbung, Straßennamen) – eine Textur, ein Netz
  const SA = document.createElement('canvas'); SA.width = 1024; SA.height = 1024;
  { const g = SA.getContext('2d');
    g.fillStyle = '#1556a6'; g.fillRect(8, 8, 240, 240); g.fillStyle = '#fff'; g.font = 'bold 190px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('U', 128, 140);
    g.fillStyle = '#f2c500'; g.beginPath(); g.arc(384, 128, 118, 0, 6.3); g.fill(); g.strokeStyle = '#1b7a3a'; g.lineWidth = 12; g.stroke(); g.fillStyle = '#1b7a3a'; g.font = 'bold 170px Arial, sans-serif'; g.fillText('H', 384, 138);
    const ad = (x0, c1, c2, t1, t2) => { const gr = g.createLinearGradient(x0, 0, x0 + 256, 256); gr.addColorStop(0, c1); gr.addColorStop(1, c2); g.fillStyle = gr; g.fillRect(x0, 0, 256, 256);
      g.fillStyle = 'rgba(255,255,255,0.18)'; for (let k = 0; k < 6; k++) { g.beginPath(); g.arc(x0 + 40 + k * 37, 70 + (k % 3) * 30, 18 + k * 4, 0, 6.3); g.fill(); }
      g.fillStyle = '#fff'; g.font = 'bold 38px Arial, sans-serif'; g.fillText(t1, x0 + 128, 170); g.font = '22px Arial, sans-serif'; g.fillText(t2, x0 + 128, 210); };
    ad(512, '#e2513b', '#7a1d4f', 'SOMMERFEST', 'Sa · Leopoldplatz'); ad(768, '#1d7a8a', '#14304e', 'KIEZKINO', 'jeden Donnerstag');
    const names = [...new Set(signPlates.map(p => p[2]))].slice(0, 8);
    names.forEach((n, i) => { const x0 = (i % 2) * 512, y0 = 256 + Math.floor(i / 2) * 128; g.fillStyle = '#f4f4ee'; g.fillRect(x0 + 6, y0 + 6, 500, 116); g.strokeStyle = '#111'; g.lineWidth = 6; g.strokeRect(x0 + 14, y0 + 14, 484, 100);
      g.fillStyle = '#111'; g.font = 'bold 54px "DejaVu Sans Condensed", Arial Narrow, Arial, sans-serif'; g.fillText(n, x0 + 256, y0 + 66, 460); });
    SA.names = names;
  }
  const saTex = new THREE.CanvasTexture(SA); saTex.colorSpace = THREE.SRGBColorSpace; saTex.anisotropy = maxAniso;
  { const pos = [], uv = [], nrm = [], emi = [];
    const quadAt = (cx, cy, cz, a, w, h, u0, v0, u1, v1, e = 0, both = true) => {   // senkrechte Tafel, Normale = (cos a, sin a)
      const tx = -Math.sin(a), tz = Math.cos(a), nx = Math.cos(a), nz = Math.sin(a);
      for (const side of both ? [1, -1] : [1]) {
        const off = side * 0.012, sx = side * tx * w / 2, sz = side * tz * w / 2;
        const P = [[cx - sx + nx * off, cy - h / 2, cz - sz + nz * off], [cx + sx + nx * off, cy - h / 2, cz + sz + nz * off], [cx + sx + nx * off, cy + h / 2, cz + sz + nz * off], [cx - sx + nx * off, cy + h / 2, cz - sz + nz * off]];
        const UV = side > 0 ? [[u0, v0], [u1, v0], [u1, v1], [u0, v1]] : [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
        for (const k of [0, 1, 2, 0, 2, 3]) { pos.push(...P[k]); uv.push(UV[k][0], 1 - UV[k][1]); nrm.push(nx * side, 0, nz * side); emi.push(e); }
      }
    };
    for (const [x, z, o, ux, uz] of ubLights) { quadAt(ux, 2.75, uz, 0, 0.62, 0.62, 0, 0.25, 0.25, 0); quadAt(ux, 2.75, uz, Math.PI / 2, 0.62, 0.62, 0, 0.25, 0.25, 0); }
    CV.shelters.forEach(([x, z, a], i) => { const [sx, sz] = LX(x, z, a, 1.0, -2.6); quadAt(sx, 2.55, sz, a + Math.PI / 2, 0.46, 0.46, 0.25, 0.25, 0.5, 0); quadAt(sx, 2.55, sz, a, 0.46, 0.46, 0.25, 0.25, 0.5, 0);
      const [px, pz] = LX(x, z, a, -0.08, 2.12); const k = i % 2; quadAt(px, 1.2, pz, a + Math.PI / 2, 1.12, 1.72, 0.5 + k * 0.25, 0.25, 0.75 + k * 0.25, 0, 1); });
    signPlates.forEach(([x, z, n], i) => { const k = SA.names.indexOf(n); if (k < 0) return; const u0 = (k % 2) * 0.5, v0 = 0.25 + Math.floor(k / 2) * 0.125;
      quadAt(x, 3.05 + (i % 2) * 0.32, z, (i % 2) ? 0 : Math.PI / 2, 0.95, 0.24, u0, v0 + 0.125, u0 + 0.5, v0, 0); });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); g.setAttribute('emi', new THREE.Float32BufferAttribute(emi, 1));
    const mat = std(0xffffff, 0.45, 0, { map: saTex });
    mat.onBeforeCompile = (sh) => { sh.uniforms.uNight = U.night;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float emi; varying float vEmi;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvEmi = emi;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vEmi; uniform float uNight;').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * (vEmi * mix(0.35, 1.6, uNight) + uNight * 0.12);'); };
    mat.customProgramCacheKey = () => 'citySigns1';
    const m = new THREE.Mesh(g, mat); m.name = 'signs'; root.add(m); }

  // ---- Glasscheiben der Wartehallen (zerspringen bei Treffer)
  const glassGeo = new THREE.BufferGeometry(); const gp = [];
  glassPanels.forEach((p, i) => { const { x, z, a, lx, lz, w, h, ax } = p; const pa = ax === 'z' ? a + Math.PI / 2 : a; const [cx, cz] = LX(x, z, a, lx, lz); const tx = -Math.sin(pa), tz = Math.cos(pa);
    const P = [[cx - tx * w / 2, 0.25, cz - tz * w / 2], [cx + tx * w / 2, 0.25, cz + tz * w / 2], [cx + tx * w / 2, 0.25 + h, cz + tz * w / 2], [cx - tx * w / 2, 0.25 + h, cz - tz * w / 2]];
    p.i0 = gp.length / 3; p.c = [cx, 0.25 + h / 2, cz]; for (const k of [0, 1, 2, 0, 2, 3]) gp.push(...P[k]); });
  glassGeo.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3)); glassGeo.computeVertexNormals();
  const glassMesh = new THREE.Mesh(glassGeo, std(0x9fb4b0, 0.04, 0, { transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
  glassMesh.material.userData.envN = 1.4; glassMesh.material.userData.envD = 1.6; glassMesh.renderOrder = 3; glassMesh.name = 'shelterGlass'; root.add(glassMesh);

  // ---- Leuchtkörper der Laternen + Ampel-Linsen (Instanzen, Farbe je Zustand)
  const _o = new THREE.Object3D();
  const lensLamp = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.62, 0.26).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff }), lampHead.length);
  lampHead.forEach(([x, y, z, a], i) => { _o.position.set(x, y, z); _o.rotation.set(0, -a, 0); _o.updateMatrix(); lensLamp.setMatrixAt(i, _o.matrix); lensLamp.setColorAt(i, new THREE.Color(1, 0.9, 0.75)); });
  lensLamp.name = 'lampLens'; root.add(lensLamp);
  { const sph = new THREE.Sphere(), hp = new THREE.Vector3();          // Treffer: Kugel um jeden Leuchtenkopf (leichter zu treffen als die flache Linse)
    lensLamp.raycast = (rc, out) => { lampHead.forEach(([x, y, z], i) => { sph.center.set(x, y + 0.05, z); sph.radius = 0.5; if (rc.ray.intersectSphere(sph, hp)) { const d = rc.ray.origin.distanceTo(hp); if (d >= rc.near && d <= rc.far) out.push({ distance: d, point: hp.clone(), object: lensLamp, instanceId: i, face: null }); } }); }; }
  const LAMP_ON = new THREE.Color(14, 11.5, 8.2), LAMP_DAY = new THREE.Color(0.55, 0.55, 0.52), LAMP_OFF = new THREE.Color(0.05, 0.05, 0.05);
  function setLampColors() { lampHead.forEach((h, i) => lensLamp.setColorAt(i, lampOn[i] ? (isNight ? LAMP_ON : LAMP_DAY) : LAMP_OFF)); lensLamp.instanceColor.needsUpdate = true; }
  modeHooks.push(setLampColors);
  const pedTex = (green) => canvasTex(64, 64, (g, w, h) => { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff';
    if (green) { g.beginPath(); g.arc(33, 12, 6, 0, 6.3); g.fill(); g.fillRect(27, 18, 11, 20); g.beginPath(); g.moveTo(28, 36); g.lineTo(18, 56); g.lineTo(24, 58); g.lineTo(33, 40); g.lineTo(40, 57); g.lineTo(46, 54); g.lineTo(37, 36); g.fill(); g.fillRect(16, 22, 12, 5); g.fillRect(36, 22, 12, 5); }
    else { g.beginPath(); g.arc(32, 11, 6, 0, 6.3); g.fill(); g.fillRect(25, 18, 14, 22); g.fillRect(14, 20, 36, 7); g.fillRect(26, 40, 5, 18); g.fillRect(33, 40, 5, 18); } });
  const lensSets = { car: [], pr: [], pg: [] };
  heads.forEach((h, hi) => { if (h.car) h.lenses.forEach((L, j) => lensSets.car.push([...L, hi, j])); else { lensSets.pr.push([...h.lenses[0], hi, 0]); lensSets.pg.push([...h.lenses[1], hi, 1]); } });
  const mkLens = (list, geo, map) => { const m = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, map: map || null }), Math.max(1, list.length)); m.count = list.length;
    list.forEach(([x, y, z, a], i) => { _o.position.set(x, y, z); _o.rotation.set(0, Math.PI / 2 - a, 0); _o.updateMatrix(); m.setMatrixAt(i, _o.matrix); m.setColorAt(i, new THREE.Color(0.05, 0.05, 0.05)); });
    root.add(m); return m; };
  const lensCar = mkLens(lensSets.car, new THREE.CircleGeometry(0.1, 16)), lensPR = mkLens(lensSets.pr, new THREE.PlaneGeometry(0.22, 0.22), pedTex(false)), lensPG = mkLens(lensSets.pg, new THREE.PlaneGeometry(0.22, 0.22), pedTex(true));
  const LC = { r: new THREE.Color(4.2, 0.18, 0.08), y: new THREE.Color(4.0, 1.9, 0.1), g: new THREE.Color(0.15, 3.4, 1.6), off: [new THREE.Color(0.09, 0.015, 0.01), new THREE.Color(0.09, 0.06, 0.01), new THREE.Color(0.01, 0.07, 0.04)] };
  // Ampel-Zeitplan (falls traffic.js keinen liefert): 38 s Umlauf je Gruppe, Achse 0 grün 0–15 s, Achse 1 grün 20–34 s
  const fallbackSignals = {
    state(c, ax) { const t = (U.time.value + c * 7.3) % 38; if (ax === 0) return t < 15 ? 'g' : t < 18 ? 'y' : t >= 37 ? 'ry' : 'r'; return t >= 20 && t < 34 ? 'g' : t >= 34 && t < 37 ? 'y' : t >= 18 && t < 20 ? (t >= 19 ? 'ry' : 'r') : 'r'; },
    ped(c, ax) { const t = (U.time.value + c * 7.3) % 38; return ax === 0 ? t < 11 : t >= 20 && t < 30; },
  };
  function updateSignals() {
    const S = (W.signals && W.signals.state) ? W.signals : fallbackSignals;
    let ci = 0, pi = 0, ch = false;
    for (const h of heads) {
      if (h.car) { let st = S.state(h.c, h.ax) || 'r';
        if (st !== h.st) { h.st = st; ch = true; const on = [st === 'r' || st === 'ry', st === 'y' || st === 'ry', st === 'g'];
          for (let j = 0; j < 3; j++) lensCar.setColorAt(ci + j, on[j] ? [LC.r, LC.y, LC.g][j] : LC.off[j]); }
        ci += 3; }
      else { const go = !!S.ped(h.c, h.ax); const st = go ? 'g' : 'r';
        if (st !== h.st) { h.st = st; ch = true; lensPR.setColorAt(pi, go ? LC.off[0] : new THREE.Color(3.4, 0.15, 0.08)); lensPG.setColorAt(pi, go ? new THREE.Color(0.2, 3.0, 1.4) : LC.off[2]); }
        pi++; }
    }
    if (ch) { for (const m of [lensCar, lensPR, lensPG]) if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    return ch;
  }
  updateSignals();

  // ---- Mülleimer (Instanzen, wackeln bei Treffer)
  const binGeo = (() => { const b = new THREE.CylinderGeometry(0.21, 0.19, 0.62, 16); b.translate(0, 0.62, 0); const c = new THREE.Color(0xe86a10);
    const p = new THREE.CylinderGeometry(0.035, 0.035, 0.95, 8); p.translate(-0.24, 0.475, 0); const r = new THREE.CylinderGeometry(0.215, 0.215, 0.05, 16); r.translate(0, 0.94, 0);
    const parts = [[b, c], [p, new THREE.Color(0x60666a)], [r, new THREE.Color(0xd45a08)]].map(([g, cc]) => { g.deleteAttribute('uv'); const n = g.attributes.position.count; const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) cc.toArray(a, i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; });
    return mergeGeometries(parts); })();
  const bins = new THREE.InstancedMesh(binGeo, std(0xffffff, 0.55, 0.05, { vertexColors: true }), CV.bins.length);
  const binState = CV.bins.map(([x, z], i) => ({ x, z, a: hash(i + 'b') * 6.28, w: 0, t: 0 }));
  function placeBin(i) { const b = binState[i]; _o.position.set(b.x, 0, b.z); _o.rotation.set(Math.sin(b.t * 18) * b.w * 0.25, b.a, Math.cos(b.t * 15) * b.w * 0.2); _o.updateMatrix(); bins.setMatrixAt(i, _o.matrix); }
  binState.forEach((b, i) => placeBin(i)); bins.castShadow = true; bins.receiveShadow = true; bins.name = 'bins'; root.add(bins);

  // ---- Bäume: Stamm + Krone aus Blatt-Karten (Instanzen)
  const trees = CJ.points.tree;
  { const tg = []; const bark = new THREE.CylinderGeometry(0.13, 0.2, 4.4, 8, 1, true); bark.translate(0, 2.2, 0); tg.push(bark);
    const br = rng(31);
    for (let k = 0; k < 7; k++) { const a = k * 0.9 + br() * 0.5, len = 2.6 + br() * 1.4, tilt = 0.45 + br() * 0.45; const g = new THREE.CylinderGeometry(0.03, 0.075, len, 5, 1, true); g.translate(0, len / 2, 0); g.rotateZ(tilt); g.rotateY(a); g.translate(0, 3.6 + k * 0.25, 0); tg.push(g); }
    const trunk = mergeGeometries(tg);
    const barkT = T('city_bark.jpg'); barkT.repeat.set(2, 2.5);
    const trunkM = new THREE.InstancedMesh(trunk, std(0x8a8279, 0.95, 0, { map: barkT }), trees.length);
    // Krone: 5 Büschel aus Blatt-Karten, Normalen radial (weiches Licht)
    const cp = [], cn = [], cu = [], r = rng(77); const C = new THREE.Vector3(0, 8.2, 0);
    const clumps = [[0, 8.9, 0, 2.3], [1.7, 7.9, 0.6, 1.9], [-1.5, 7.7, 0.9, 1.9], [0.4, 7.6, -1.8, 1.9], [-0.6, 7.0, -0.4, 1.8], [0.2, 6.6, 1.7, 1.6], [-1.9, 8.3, -1.2, 1.6]];
    for (const [cx, cy, cz, cr] of clumps) for (let k = 0; k < 10; k++) {
      const d = new THREE.Vector3(r() * 2 - 1, r() * 1.5 - 0.45, r() * 2 - 1).normalize();
      const c = new THREE.Vector3(cx, cy, cz).addScaledVector(d, cr * (0.45 + r() * 0.35));
      const sz = 1.5 + r() * 0.9; const up = new THREE.Vector3(r() - 0.5, 1, r() - 0.5).normalize();
      const nrm = d.clone().lerp(new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5), 0.35).normalize();
      const right = new THREE.Vector3().crossVectors(up, nrm).normalize(); const u2 = new THREE.Vector3().crossVectors(nrm, right).normalize();
      const P = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b2]) => c.clone().addScaledVector(right, a * sz / 2).addScaledVector(u2, b2 * sz / 2));
      for (const q of [0, 1, 2, 0, 2, 3]) { cp.push(P[q].x, P[q].y, P[q].z); const nn = P[q].clone().sub(C).normalize(); cn.push(nn.x, nn.y, nn.z); cu.push([0, 1, 1, 0][q], [0, 0, 1, 1][q]); }
    }
    const crown = new THREE.BufferGeometry(); crown.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3)); crown.setAttribute('normal', new THREE.Float32BufferAttribute(cn, 3)); crown.setAttribute('uv', new THREE.Float32BufferAttribute(cu, 2));
    const leafT = T('city_leaves.png', { wrap: false });
    const leafM = std(0xffffff, 0.9, 0, { map: leafT, alphaTest: 0.42, side: THREE.DoubleSide }); leafM.userData.envN = 0.2; leafM.userData.envD = 0.35;
    leafM.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * 0.06;'); };
    const crownM = new THREE.InstancedMesh(crown, leafM, trees.length);
    trees.forEach((t, i) => { const h = hash(i + 'tree'), s = 0.85 + h * 0.4;
      _o.position.set(t[0], 0, t[1]); _o.rotation.set(0, h * 40, 0); _o.scale.setScalar(s); _o.updateMatrix(); trunkM.setMatrixAt(i, _o.matrix); crownM.setMatrixAt(i, _o.matrix);
      const c = new THREE.Color().setHSL(0.22 + hash(i + 'c') * 0.07, 0.35 + hash(i + 's') * 0.2, 0.42 + hash(i + 'l') * 0.15); crownM.setColorAt(i, c); });
    trunkM.castShadow = crownM.castShadow = true; trunkM.receiveShadow = crownM.receiveShadow = true; trunkM.name = 'trunks'; crownM.name = 'crowns';
    root.add(trunkM, crownM);
    // Baumscheiben
    const pitT = canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#5a5a56'; g.fillRect(0, 0, w, h); g.fillStyle = '#3c3024'; g.fillRect(10, 10, w - 20, h - 20); const rr = rng(3);
      for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(${70 + rr() * 60 | 0},${55 + rr() * 40 | 0},${30 + rr() * 20 | 0},0.7)`; g.fillRect(10 + rr() * (w - 20), 10 + rr() * (h - 20), 2 + rr() * 3, 2 + rr() * 3); }
      for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(${90 + rr() * 50 | 0},${120 + rr() * 40 | 0},50,0.6)`; g.fillRect(10 + rr() * (w - 20), 10 + rr() * (h - 20), 3, 3); } });
    const pit = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.5, 1.5).rotateX(-Math.PI / 2), std(0xffffff, 0.95, 0, { map: pitT, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), trees.length);
    trees.forEach((t, i) => { _o.position.set(t[0], 0.004, t[1]); _o.rotation.set(0, 0, 0); _o.scale.setScalar(1); _o.updateMatrix(); pit.setMatrixAt(i, _o.matrix); });
    pit.receiveShadow = true; root.add(pit);
  }

  // ---- Splitter / Funken (für Treffer)
  const PN = 90; const parts = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.07, 0.07), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthWrite: false }), PN);
  const pState = Array.from({ length: PN }, () => ({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), c: new THREE.Color(), r: 0 }));
  let pNext = 0; parts.count = PN; for (let i = 0; i < PN; i++) { _o.position.set(0, -50, 0); _o.updateMatrix(); parts.setMatrixAt(i, _o.matrix); parts.setColorAt(i, new THREE.Color(1, 1, 1)); }
  parts.frustumCulled = false; root.add(parts);
  function burst(pt, n, color, speed = 3, up = 2) { for (let k = 0; k < n; k++) { const s = pState[pNext]; pNext = (pNext + 1) % PN; s.life = 0.8 + Math.random() * 0.8; s.p.copy(pt); s.v.set((Math.random() - 0.5) * speed, Math.random() * up, (Math.random() - 0.5) * speed); s.c.copy(color); s.r = Math.random() * 6; } partsActive = true; }
  let partsActive = false;
  function updateParts(dt) { if (!partsActive) return false; let any = false;
    pState.forEach((s, i) => { if (s.life <= 0) return; s.life -= dt; s.v.y -= 9.8 * dt; s.p.addScaledVector(s.v, dt); const gy = W.groundY ? W.groundY(s.p.x, s.p.z) : 0; if (s.p.y < gy + 0.01) { s.p.y = gy + 0.01; s.v.set(0, 0, 0); }
      _o.position.copy(s.p); _o.rotation.set(s.r, s.r * 1.3, 0); _o.scale.setScalar(s.life > 0 ? 1 : 0.001); _o.updateMatrix(); parts.setMatrixAt(i, _o.matrix); parts.setColorAt(i, s.c); any = any || s.life > 0; });
    parts.instanceMatrix.needsUpdate = true; if (parts.instanceColor) parts.instanceColor.needsUpdate = true; partsActive = any; return true; }

  // ---- Treffer (combat.js): Laterne aus, Mülleimer wackelt, Glas zerspringt
  const nearestIdx = (list, p, f) => { let best = -1, bd = 1e9; list.forEach((it, i) => { const [x, y, z] = f(it); const d = (x - p.x) ** 2 + (y - p.y) ** 2 + (z - p.z) ** 2; if (d < bd) { bd = d; best = i; } }); return best; };
  lensLamp.userData.onHit = (hit) => { const i = hit.instanceId ?? nearestIdx(lampHead, hit.point, h => [h[0], h[1], h[2]]); if (i < 0 || !lampOn[i]) return;
    lampOn[i] = false; setLampColors(); drawLampMap(); burst(hit.point, 14, new THREE.Color(1.6, 1.4, 1.1), 2.5, 1); W.requestRender(); };
  bins.userData.onHit = (hit) => { const i = hit.instanceId ?? nearestIdx(binState, hit.point, b => [b.x, 0.6, b.z]); if (i < 0) return; binState[i].w = 1; binState[i].t = 0; burst(hit.point, 6, new THREE.Color(0.9, 0.5, 0.1), 2, 1.5); wobbling = true; };
  let wobbling = false;
  glassMesh.userData.onHit = (hit) => { const i = nearestIdx(glassPanels, hit.point, p => p.c); const p = glassPanels[i]; if (!p || p.broken) return; p.broken = true;
    const pa = glassGeo.attributes.position; for (let k = 0; k < 6; k++) pa.setXYZ(p.i0 + k, 0, -100, 0); pa.needsUpdate = true; glassGeo.computeBoundingSphere();
    for (let k = 0; k < 4; k++) burst(new THREE.Vector3(p.c[0] + (Math.random() - 0.5) * 1.5, p.c[1] + (Math.random() - 0.3), p.c[2] + (Math.random() - 0.5) * 1.5), 10, new THREE.Color(0.75, 0.9, 0.95), 2.5, 1.2);
    W.emit && W.emit('glass', { pos: hit.point }); W.requestRender(); };
  shootables.push(lensLamp, bins, glassMesh);
  function registerShootables() { if (!W.shootables) W.shootables = []; for (const o of shootables) if (!W.shootables.includes(o)) W.shootables.push(o); }
  registerShootables();
  modeHooks.push((night) => { lensLamp.visible = true; });

  // ================================================================ HIMMEL, NEBEL
  const sky = new THREE.Mesh(new THREE.SphereGeometry(370, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { night: U.night, macT: { value: macroT }, sunDir: { value: new THREE.Vector3(-15, 18, 21).normalize() }, hor: { value: new THREE.Color() }, zen: { value: new THREE.Color() } },
    vertexShader: 'varying vec3 vD; void main() { vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w * 0.99999; }',
    fragmentShader: `uniform float night; uniform sampler2D macT; uniform vec3 sunDir; uniform vec3 hor; uniform vec3 zen; varying vec3 vD;
      void main() {
        vec3 d = normalize(vD); float y = max(d.y, 0.0);
        vec3 c = mix(hor, zen, pow(y, 0.55));
        float sd = max(dot(d, sunDir), 0.0);
        c += (1.0 - night) * (vec3(1.0, 0.86, 0.62) * pow(sd, 6.0) * 0.35 + vec3(1.0, 0.95, 0.85) * pow(sd, 400.0) * 6.0);
        vec2 cu = d.xz / (d.y + 0.12) * 0.22;
        float cl = texture2D(macT, cu * 0.5).r * 0.65 + texture2D(macT, cu * 1.7 + 0.3).g * 0.35;
        cl = smoothstep(0.5, 0.85, cl) * smoothstep(0.0, 0.25, d.y);
        vec3 ccol = mix(vec3(1.0, 0.99, 0.97) * (0.85 + 0.25 * sd), vec3(0.13, 0.085, 0.06), night);
        c = mix(c, ccol, cl * mix(0.8, 0.55, night));
        if (d.y < 0.0) c = hor;
        gl_FragColor = vec4(c, 1.0);
      }` }));
  sky.renderOrder = -100; sky.frustumCulled = false; sky.onBeforeRender = (r, s, cam) => { sky.position.copy(cam.position); sky.updateMatrixWorld(); };
  root.add(sky);
  const lin = (hex) => new THREE.Color(hex);
  const SKY = { day: { hor: lin(0xc6d4e2), zen: lin(0x3f78c4), fog: 0.0042 }, night: { hor: lin(0x1d1a24), zen: lin(0x03050b), fog: 0.0072 } };
  modeHooks.push((night) => {
    const k = night ? SKY.night : SKY.day;
    sky.material.uniforms.hor.value.copy(k.hor); sky.material.uniforms.zen.value.copy(k.zen);
    if (scene.fog) { scene.fog.color.copy(k.hor); scene.fog.density = k.fog; }
    fogBase = k.fog; fogY = -1;
  });
  let fogBase = 0.0042, fogY = -1;
  function aerialFog() {      // von oben klarere Sicht (Dunst liegt unten)
    if (!scene.fog) return false;
    const y = Math.round(camera.position.y); if (y === fogY) return false; fogY = y;
    scene.fog.density = fogBase * THREE.MathUtils.lerp(1, 0.45, THREE.MathUtils.smoothstep(y, 12, 120)); return true;
  }

  // ================================================================ SONNE: Schatten folgt der Figur / dem Blickpunkt
  const sun = ext && ext.sun; const SUN_DIR = new THREE.Vector3(-15, 21, 21).normalize();
  const _f = new THREE.Vector3();
  let sunKey = '';
  function followSun() {
    if (!sun || isNight) return false;
    const tp = W.tp, P = W.P;
    const focus = tp && tp.active ? _f.set(P.x, 0, P.z) : _f.copy(W.controls.target).setY(0);
    const dist = camera.position.distanceTo(focus);
    const half = THREE.MathUtils.clamp(dist * 1.1, 17, 150);
    const snap = half * 2 / sun.shadow.mapSize.x * 4;
    const cx = Math.round(focus.x / snap) * snap, cz = Math.round(focus.z / snap) * snap;
    const key = cx + ',' + cz + ',' + Math.round(half);
    if (key === sunKey) return false; sunKey = key;
    const near = Math.abs(focus.x - 6) < 14 && Math.abs(focus.z - 3) < 10 && dist < 22;
    const cam = sun.shadow.camera;
    if (near && !(tp && tp.active)) { sun.target.position.set(6, 3, 1); sun.position.set(6 - 15, 21, 1 + 21); Object.assign(cam, { left: -17, right: 17, top: 13, bottom: -11, near: 1, far: 80 }); }
    else { sun.target.position.set(cx, 0, cz); sun.position.copy(SUN_DIR).multiplyScalar(90).add(sun.target.position); Object.assign(cam, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 220 }); }
    sun.shadow.bias = near ? -0.0004 : -0.0008; sun.shadow.normalBias = near ? 0.025 : 0.05 * half / 17;
    cam.updateProjectionMatrix(); sun.target.updateMatrixWorld(); sun.updateMatrixWorld();
    return true;
  }

  // ================================================================ OSM-Hinweis (Lizenz)
  { const d = document.createElement('div'); d.id = 'osmCredit'; d.textContent = 'Kartendaten © OpenStreetMap-Mitwirkende';
    Object.assign(d.style, { position: 'fixed', right: '8px', top: 'calc(env(safe-area-inset-top, 0px) + ' + (isMobile ? 70 : 64) + 'px)', font: '9px/1.2 system-ui, sans-serif', color: 'rgba(255,255,255,0.5)', textShadow: '0 1px 2px rgba(0,0,0,0.7)', pointerEvents: 'none', zIndex: 5 });
    document.body.appendChild(d); }

  // ================================================================ Rückgabe
  console.log('[city] gebaut in', Math.round(performance.now() - t0), 'ms');
  let regT = 0;
  return { update(dt) {
    U.time.value += dt;
    let busy = false;
    if (followSun()) W.requestRender();
    aerialFog();
    if (updateSignals()) W.requestRender();          // nur neu zeichnen, nicht als „Bewegung“ melden (sonst Auflösungswechsel am Handy)
    if (updateParts(dt)) busy = true;
    if (wobbling) { wobbling = false; binState.forEach((b, i) => { if (b.w > 0) { b.t += dt; b.w = Math.max(0, b.w - dt * 0.9); placeBin(i); wobbling = true; } }); bins.instanceMatrix.needsUpdate = true; busy = true; }
    if ((regT += dt) > 1) { regT = 0; registerShootables(); }
    return busy;
  } };
}
