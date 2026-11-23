// Spielmodus: Waffen aufheben, zielen, schießen – nur wenn W.gameMode an ist.
// Treffbar: Gegenstände, Häuser, Boden, Autos (W.shootables). Menschen NIE (Verkaufswerkzeug für einen echten Kunden):
// zeigt das Fadenkreuz auf eine Person, wird nicht geschossen – die Person hebt die Hände und rennt weg.
// Im Laden wird nicht geschossen; am Laden selbst (Fassade, Schilder, Fenster) bleiben keine Einschusslöcher.
export async function init(W) {
  const { THREE, scene, camera } = W;
  const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js');
  const MOBILE = !!W.isMobile;
  W.shootables = W.shootables || [];
  const rnd = (a, b) => a + Math.random() * (b - a);
  const V3 = () => new THREE.Vector3();

  // ================================================================ Waffen
  const GUNS = {
    pistol: { name: 'Pistole', short: 'Pistole', mag: 12, reserve: 60, rate: 0.17, auto: false, pellets: 1, spread: 0.0035, kick: 0.016, reload: 1.35, color: 0x58d2ff, flash: 0.32, long: false },
    shotgun: { name: 'Pumpgun', short: 'Pumpgun', mag: 6, reserve: 30, rate: 0.9, auto: false, pellets: 8, spread: 0.042, kick: 0.055, reload: 2.1, color: 0xffa23e, flash: 0.6, long: true },
    smg: { name: 'Maschinenpistole', short: 'MP', mag: 30, reserve: 150, rate: 0.085, auto: true, pellets: 1, spread: 0.011, kick: 0.009, reload: 1.8, color: 0x7dff8f, flash: 0.36, long: true },
  };
  const ORDER = ['pistol', 'smg', 'shotgun'];

  // ---------------- Modelle (prozedural, Ursprung = Griff in der Hand, +z = Lauf, +y = oben)
  const M = {
    steel: new THREE.MeshStandardMaterial({ color: 0x2a2c31, metalness: 0.85, roughness: 0.36 }),
    poly: new THREE.MeshStandardMaterial({ color: 0x16171a, metalness: 0.1, roughness: 0.62 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x5b3a22, metalness: 0.0, roughness: 0.5 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xc9a14a, metalness: 0.9, roughness: 0.3 }),
  };
  function bx(w, h, d, x, y, z, rx = 0) { const g = new THREE.BoxGeometry(w, h, d); if (rx) g.rotateX(rx); g.translate(x, y, z); return g; }
  function cy(r, len, x, y, z, seg = 10) { const g = new THREE.CylinderGeometry(r, r, len, seg); g.rotateX(Math.PI / 2); g.translate(x, y, z); return g; }
  function guard(x, y, z, w, s = 1) { const g = new THREE.TorusGeometry(0.022 * s, 0.0035 * s, 4, 10, Math.PI); g.rotateY(Math.PI / 2); g.rotateX(Math.PI); g.translate(x, y, z); return g; }
  function build(kind) {
    const G = new THREE.Group(); const parts = { steel: [], poly: [], wood: [] };
    if (kind === 'pistol') {
      parts.steel.push(bx(0.03, 0.03, 0.19, 0, 0.047, 0.035));                 // Schlitten
      parts.steel.push(cy(0.0065, 0.012, 0, 0.05, 0.133, 8));                 // Mündung
      parts.steel.push(bx(0.006, 0.008, 0.008, 0, 0.066, 0.12), bx(0.016, 0.007, 0.008, 0, 0.066, -0.05)); // Kimme/Korn
      parts.poly.push(bx(0.027, 0.022, 0.16, 0, 0.022, 0.04));                 // Rahmen
      parts.poly.push(bx(0.028, 0.11, 0.045, 0, -0.035, -0.012, -0.28));        // Griff
      parts.poly.push(guard(0, 0.012, 0.03, 0.02));
      parts.steel.push(bx(0.004, 0.018, 0.006, 0, 0.0, 0.028));                // Abzug
      G.userData.muzzle = new THREE.Vector3(0, 0.05, 0.142); G.userData.eject = new THREE.Vector3(0.018, 0.06, 0.05); G.userData.support = new THREE.Vector3(-0.02, -0.035, -0.01);
    } else if (kind === 'shotgun') {
      parts.steel.push(bx(0.04, 0.055, 0.2, 0, 0.04, 0.06));                    // Gehäuse
      parts.steel.push(cy(0.0105, 0.5, 0, 0.056, 0.41, 12));                    // Lauf
      parts.steel.push(cy(0.009, 0.4, 0, 0.03, 0.36, 10));                      // Magazinrohr
      parts.steel.push(bx(0.004, 0.012, 0.008, 0, 0.072, 0.65));                // Korn
      parts.wood.push(cy(0.021, 0.17, 0, 0.032, 0.39, 12));                     // Pumpe
      parts.wood.push(bx(0.034, 0.08, 0.06, 0, -0.03, -0.02, -0.35));           // Griff
      parts.wood.push(bx(0.036, 0.06, 0.28, 0, 0.0, -0.2, 0.12));               // Schaft
      parts.poly.push(bx(0.04, 0.09, 0.022, 0, -0.012, -0.345, 0.12));          // Schaftkappe
      parts.poly.push(guard(0, 0.012, 0.02, 0.02, 1.2));
      G.userData.muzzle = new THREE.Vector3(0, 0.056, 0.67); G.userData.eject = new THREE.Vector3(0.024, 0.05, 0.08); G.userData.support = new THREE.Vector3(0, 0.02, 0.39);
    } else {
      parts.steel.push(bx(0.036, 0.05, 0.27, 0, 0.042, 0.06));                  // Gehäuse
      parts.steel.push(cy(0.009, 0.09, 0, 0.05, 0.235, 10));                    // Lauf
      parts.steel.push(cy(0.013, 0.03, 0, 0.05, 0.27, 10));                     // Mündungsfeuerdämpfer
      parts.poly.push(bx(0.03, 0.17, 0.034, 0, -0.06, 0.1, 0.12));              // Magazin
      parts.poly.push(bx(0.03, 0.09, 0.04, 0, -0.03, -0.015, -0.3));            // Griff
      parts.poly.push(bx(0.032, 0.045, 0.11, 0, 0.02, 0.165));                  // Handschutz
      parts.steel.push(bx(0.012, 0.03, 0.2, 0, 0.03, -0.17), bx(0.03, 0.06, 0.016, 0, 0.012, -0.27)); // Klappschaft
      parts.steel.push(bx(0.008, 0.016, 0.012, 0, 0.074, 0.17), bx(0.018, 0.016, 0.012, 0, 0.074, -0.05)); // Visier
      parts.poly.push(guard(0, 0.012, 0.03, 0.02));
      G.userData.muzzle = new THREE.Vector3(0, 0.05, 0.29); G.userData.eject = new THREE.Vector3(0.02, 0.055, 0.08); G.userData.support = new THREE.Vector3(0, 0.0, 0.17);
    }
    for (const k in parts) if (parts[k].length) { const m = new THREE.Mesh(mergeGeometries(parts[k].map(g => g.toNonIndexed ? g.toNonIndexed() : g)), M[k]); m.castShadow = true; G.add(m); }
    G.userData.kind = kind;
    return G;
  }

  // ================================================================ Zustand
  const S = { inv: {}, cur: null, gun: null, aimHold: 0, trigger: false, cool: 0, reloading: 0, armed: false, insideWarned: 0, peopleWarned: 0, target: null, tick: 0 };
  const fxRoot = new THREE.Group(); fxRoot.userData.noRay = true; scene.add(fxRoot);
  // Effekte (Sprites, Leuchtspuren, Löcher …) nicht in die Umgebungsverdeckung (GTAO, nur Computer) – sonst dunkle Rechtecke
  W.noAO = W.noAO || new Set();
  { const gp = (W.composer && W.composer.passes || []).find(p => p.gtaoMaterial && p.overrideVisibility);
    if (gp && !gp.__noAO) { const orig = gp.overrideVisibility.bind(gp); gp.overrideVisibility = function () { orig(); for (const o of W.noAO) o.visible = false; }; gp.__noAO = true; } }
  const held = {}; for (const k of ORDER) { held[k] = build(k); held[k].visible = false; held[k].userData.noRay = true; fxRoot.add(held[k]); }

  // ---------------- Spielfigur-Knochen
  let PB = null;
  function bones() {
    if (PB) return PB; if (!W.P.ready) return null;
    const b = {}; W.P.root.traverse(o => { if (o.isBone) b[o.name.replace(/^mixamorig:?/, '')] = o; });
    if (!b.RightHand) return null;
    PB = { RA: b.RightArm, RF: b.RightForeArm, RH: b.RightHand, RM: b.RightHandMiddle1, LA: b.LeftArm, LF: b.LeftForeArm, LH: b.LeftHand, LM: b.LeftHandMiddle1, S2: b.Spine2, NK: b.Neck, HI: b.Hips };
    return PB;
  }
  const _a = V3(), _b = V3(), _c = V3(), _d = V3(), _e = V3(), _t = V3(), _wq = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _tq = new THREE.Quaternion();
  function aimBone(bone, child, dir, w = 1) {
    bone.getWorldPosition(_a); child.getWorldPosition(_b); _d.subVectors(_b, _a).normalize();
    _tq.setFromUnitVectors(_d, dir); bone.getWorldQuaternion(_wq); _tq.multiply(_wq);
    bone.parent.getWorldQuaternion(_pq); _tq.premultiply(_pq.invert());
    if (w >= 1) bone.quaternion.copy(_tq); else bone.quaternion.slerp(_tq, w);
    bone.updateMatrixWorld(true);
  }
  // Zwei-Knochen-IK: Oberarm A, Unterarm B, Hand C → Ziel t, Ellbogen Richtung pole
  const _ax = V3(), _pl = V3(), _el = V3(), _d1 = V3(), _d2 = V3();
  function ik2(A, B, C, t, pole) {
    A.getWorldPosition(_a); B.getWorldPosition(_b); C.getWorldPosition(_c);
    const l1 = _a.distanceTo(_b), l2 = _b.distanceTo(_c);
    _ax.subVectors(t, _a); let d = _ax.length(); _ax.normalize(); d = Math.min(Math.max(d, Math.abs(l1 - l2) + 1e-3), l1 + l2 - 1e-3);
    const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    _pl.subVectors(pole, _a); _pl.addScaledVector(_ax, -_pl.dot(_ax)).normalize();
    _el.copy(_a).addScaledVector(_ax, l1 * cosA).addScaledVector(_pl, l1 * sinA);
    aimBone(A, B, _d1.subVectors(_el, _a).normalize());
    B.getWorldPosition(_b); aimBone(B, C, _d2.subVectors(t, _b).normalize());
  }

  // ================================================================ Aufheben
  const pickups = [];
  const SPOTS = [ // Gehweg / Hauseingänge nahe am Laden
    { kind: 'pistol', x: 2.6, z: 5.4 },
    { kind: 'shotgun', x: -7.6, z: 1.3 },
    { kind: 'smg', x: 20.6, z: 1.6 },
  ];
  const ringTex = new THREE.CanvasTexture((() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 20, 64, 64, 63); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.62, 'rgba(255,255,255,0.05)'); gr.addColorStop(0.8, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.88, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return c; })());
  const glowTex = new THREE.CanvasTexture((() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.25)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return c; })());
  function makePickup(sp) {
    const g = new THREE.Group(); g.userData.noRay = true;
    const col = new THREE.Color(GUNS[sp.kind].color);
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: ringTex, color: col.clone().multiplyScalar(2.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    ring.position.y = 0.025; g.add(ring);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.5, 1.5, 20, 1, true).translate(0, 0.75, 0), new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { c: { value: col.clone().multiplyScalar(0.55) } },
      vertexShader: 'varying float vY; void main(){ vY = position.y / 1.5; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 c; varying float vY; void main(){ float e = pow(1.0 - vY, 3.0) * (0.35 + 0.65 * smoothstep(0.0, 0.12, vY)); gl_FragColor = vec4(c * e * 0.38, 1.0); }' }));
    g.add(beam);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: col.clone().multiplyScalar(1.4), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); glow.scale.setScalar(0.9); glow.position.y = 0.9; g.add(glow);
    const gun = build(sp.kind); gun.scale.setScalar(sp.kind === 'pistol' ? 1.9 : 1.45); gun.position.y = 0.9; g.add(gun);
    gun.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.emissive = col.clone(); o.material.emissiveIntensity = 0.22; } });
    let x = sp.x, z = sp.z;
    for (let r = 0; r < 3 && W.blocked(x, z); r += 0.2) for (let a = 0; a < 6.28; a += 0.5) { const nx = sp.x + Math.cos(a) * r, nz = sp.z + Math.sin(a) * r; if (!W.blocked(nx, nz)) { x = nx; z = nz; r = 9; break; } }
    g.position.set(x, W.groundY(x, z), z); g.visible = false; fxRoot.add(g);
    return { kind: sp.kind, g, gun, ring, beam, x, z, respawn: 0, t: Math.random() * 6 };
  }
  for (const sp of SPOTS) pickups.push(makePickup(sp));

  // ================================================================ HUD + Knöpfe
  const css = document.createElement('style');
  css.textContent = `
  #xh { position:fixed; left:50%; top:50%; width:46px; height:46px; margin:-23px 0 0 -23px; pointer-events:none; z-index:7; display:none; }
  body.armed #xh { display:block; }
  #xh svg { width:100%; height:100%; overflow:visible; filter:drop-shadow(0 0 2px rgba(0,0,0,.75)); }
  #xh .r { fill:none; stroke:rgba(255,255,255,.92); stroke-width:1.5; transition:stroke .12s; }
  #xh .k { stroke:rgba(255,255,255,.95); stroke-width:2; stroke-linecap:round; }
  #xh .dot { fill:#fff; } #xh .no { display:none; stroke:#ff6b6b; stroke-width:2.2; stroke-linecap:round; }
  #xh .rl { fill:none; stroke:#fff; stroke-width:2.4; stroke-dasharray:0 200; stroke-linecap:round; transform:rotate(-90deg); transform-origin:23px 23px; }
  #xh.hot .r, #xh.hot .k { stroke:#ffb35c; } #xh.hot .dot { fill:#ffb35c; }
  #xh.no .r, #xh.no .k { stroke:#ff6b6b; } #xh.no .no { display:block; } #xh.no .dot { fill:#ff6b6b; }
  body.aiming #xh { width:40px; height:40px; margin:-20px 0 0 -20px; }
  #ammo { display:none; align-items:center; gap:7px; padding:7px 12px 7px 10px; border-radius:9999px; font-weight:800; font-size:15px; letter-spacing:.2px; pointer-events:auto; touch-action:manipulation; user-select:none; -webkit-user-select:none; }
  body.armed.game #ammo { display:flex; }
  #ammo small { font-weight:600; opacity:.7; font-size:12px; } #ammo svg.ic { width:26px; height:22px; }
  #ammo.low b { color:#ffb35c; } #ammo.empty b { color:#ff6b6b; }
  .act.sel { background:rgba(255,255,255,.92)!important; color:#14161b!important; }
  @media (orientation:portrait) { body.armed:has(#opts:not(.off)) #actions { bottom:calc(222px + env(safe-area-inset-bottom)); } }
  .act.fire { color:#fff; } .act.fire svg.ic { stroke-width:2; }
  `;
  document.head.appendChild(css);
  const xh = document.createElement('div'); xh.id = 'xh';
  xh.innerHTML = `<svg viewBox="0 0 46 46"><circle class="r" cx="23" cy="23" r="11"/><circle class="rl" cx="23" cy="23" r="15"/><g class="ks"><path class="k" d="M23 4.5v6"/><path class="k" d="M23 35.5v6"/><path class="k" d="M4.5 23h6"/><path class="k" d="M35.5 23h6"/></g><circle class="dot" cx="23" cy="23" r="1.6"/><path class="no" d="M15 31L31 15"/></svg>`;
  document.body.appendChild(xh);
  const xhK = xh.querySelector('.ks'), xhRL = xh.querySelector('.rl');
  const GICON = {
    pistol: '<path d="M3 7.5h16.5v3.2H11l-1.2 1.3-1 5.5H5.2l1.1-5.6L3 10.7z"/><path d="M9.8 12.3c.3 1.3 1.2 1.9 2.3 1.9"/>',
    shotgun: '<path d="M1.5 9.5h21v2.2h-12l-2 1.8L4 15.6 1.5 14z"/><path d="M13 11.7v1.6h5v-1.6"/>',
    smg: '<path d="M3 8h14.5v1.6H21v1.8h-3.5v1.5h-4.2l-.8 5H10l.6-5H8.5L7.4 15H4.2l1.6-3.5H3z"/><path d="M13.3 12.9l1 4.8h2.4l-1.1-4.8"/>',
  };
  const svgI = (p) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
  let btnFire = null, btnAim = null, btnSwap = null, ammoEl = null;
  function ensureButtons() {
    if (btnFire) return;
    btnSwap = W.addButton({ id: 'swap', icon: GICON.pistol, label: 'Waffe', onDown: () => cycle() });
    btnAim = W.addButton({ id: 'aim', icon: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.2"/><path d="M12 1.8v3.4M12 18.8v3.4M1.8 12h3.4M18.8 12h3.4"/>', label: 'Zielen', onDown: () => setAim(!W.tp.aim) });
    btnFire = W.addButton({ id: 'fire', icon: '<circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="1.4"/><path d="M12 1.5v4.2M12 18.3v4.2M1.5 12h4.2M18.3 12h4.2"/>', label: 'Feuer', big: true, onDown: () => { S.trigger = true; pull(); }, onUp: () => { S.trigger = false; } });
    btnFire.el.classList.add('fire');
    const col = document.getElementById('actions');
    ammoEl = document.createElement('div'); ammoEl.id = 'ammo'; ammoEl.className = 'glass';
    ammoEl.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); reload(); });
    col.insertBefore(ammoEl, col.firstChild);
  }
  function setAim(on) { if (on && !S.armed) on = false; W.setAim(on); if (btnAim) btnAim.el.classList.toggle('sel', !!on); }
  let shownState = null;
  function syncUI() {
    const driving = !!W.control;
    const vis = W.gameMode && S.armed && !driving;
    const key = vis + '|' + S.cur + '|' + Object.keys(S.inv).length;
    document.body.classList.toggle('armed', vis);
    if (key === shownState) return; shownState = key;
    if (!btnFire && !vis) return;
    ensureButtons();
    btnFire.show(vis); btnAim.show(vis); btnSwap.show(vis && Object.keys(S.inv).length > 1);
    if (vis) btnSwap.set(svgI(GICON[S.cur]) + `<span>${GUNS[S.cur].short}</span>`);
    if (!vis && W.tp.aim) setAim(false);
    updAmmo();
  }
  function updAmmo() {
    if (!ammoEl) return; const k = S.cur; if (!k) { ammoEl.innerHTML = ''; return; }
    const inv = S.inv[k], G = GUNS[k];
    ammoEl.innerHTML = svgI(GICON[k]) + `<b>${S.reloading > 0 ? '…' : inv.mag}</b><small>/ ${inv.res}</small>`;
    ammoEl.classList.toggle('low', inv.mag > 0 && inv.mag <= Math.ceil(G.mag / 4)); ammoEl.classList.toggle('empty', inv.mag === 0);
  }

  // ================================================================ Ton (WebAudio, erst nach erster Berührung)
  const A = { ctx: null, out: null, noise: null, verb: null };
  function audio() {
    if (A.ctx) { if (A.ctx.state === 'suspended') A.ctx.resume(); return A.ctx; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    const c = new AC(); A.ctx = c;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6; comp.connect(c.destination);
    A.out = c.createGain(); A.out.gain.value = 0.55; A.out.connect(comp);
    const nb = c.createBuffer(1, c.sampleRate * 1.0, c.sampleRate); const d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; A.noise = nb;
    // Straßen-Hall: kurzes Impuls-Echo
    const len = c.sampleRate * 1.4, ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const x = ir.getChannelData(ch); for (let i = 0; i < len; i++) { const t = i / c.sampleRate; x[i] = (Math.random() * 2 - 1) * Math.pow(1 - t / 1.4, 3.2) * (t < 0.012 ? 0 : 1) * (1 + (Math.abs(t - 0.09) < 0.004 ? 2.5 : 0) + (Math.abs(t - 0.21) < 0.005 ? 1.6 : 0)); } }
    A.verb = c.createConvolver(); A.verb.buffer = ir; const vg = c.createGain(); vg.gain.value = 0.28; A.verb.connect(vg); vg.connect(A.out);
    return c;
  }
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) addEventListener(ev, () => { if (W.gameMode) audio(); }, { passive: true });
  function nz(t0, dur, type, f, q, g0, decay, dest = A.out, rate = 1) {
    const c = A.ctx, s = c.createBufferSource(); s.buffer = A.noise; s.playbackRate.value = rate;
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(g0, t0 + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
    s.connect(fl); fl.connect(g); g.connect(dest); if (dest === A.out && A.verb) g.connect(A.verb);
    s.start(t0, Math.random() * 0.5, dur); s.stop(t0 + dur + 0.05);
  }
  function tone(t0, f0, f1, dur, g0, type = 'sine', dest) {
    const c = A.ctx, o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(g0, t0 + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(dest || A.out); o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function sndShot(kind) {
    if (!audio()) return; const t = A.ctx.currentTime + 0.005, r = rnd(0.94, 1.06);
    if (kind === 'shotgun') {
      nz(t, 0.5, 'bandpass', 1500 * r, 0.7, 1.0, 0.16); nz(t, 0.7, 'lowpass', 700 * r, 0.5, 1.2, 0.5); tone(t, 140 * r, 38, 0.32, 1.1);
      setTimeout(() => { if (!A.ctx) return; const t2 = A.ctx.currentTime; nz(t2, 0.06, 'bandpass', 2400, 3, 0.35, 0.05); nz(t2 + 0.13, 0.07, 'bandpass', 1700, 3, 0.4, 0.06); }, 380);
    } else if (kind === 'smg') {
      nz(t, 0.2, 'bandpass', 2600 * r, 0.8, 0.65, 0.06); nz(t, 0.25, 'lowpass', 1100 * r, 0.6, 0.6, 0.16); tone(t, 170 * r, 60, 0.12, 0.6);
    } else {
      nz(t, 0.25, 'bandpass', 2200 * r, 0.8, 0.85, 0.08); nz(t, 0.35, 'lowpass', 950 * r, 0.6, 0.8, 0.24); tone(t, 150 * r, 48, 0.18, 0.8);
    }
    if (Math.random() < 0.8) setTimeout(() => { if (!A.ctx) return; const t3 = A.ctx.currentTime; tone(t3, rnd(3800, 5200), rnd(3000, 4000), 0.05, 0.05, 'sine'); tone(t3 + 0.09, rnd(4200, 5600), rnd(3200, 4200), 0.04, 0.035, 'sine'); }, rnd(420, 620));
  }
  function sndImpact(kind, dist) {
    if (!A.ctx) return; const t = A.ctx.currentTime + Math.min(0.25, dist / 340), v = Math.max(0.05, Math.min(1, 6 / (dist + 3)));
    if (kind === 'glass') { for (let i = 0; i < 5; i++) tone(t + i * 0.025 + Math.random() * 0.02, rnd(3000, 6500), rnd(2500, 5000), rnd(0.06, 0.16), 0.12 * v, 'triangle'); nz(t, 0.2, 'highpass', 4000, 0.6, 0.25 * v, 0.15); }
    else if (kind === 'metal') { tone(t, rnd(1800, 2600), rnd(1400, 2000), 0.18, 0.18 * v, 'triangle'); nz(t, 0.06, 'bandpass', 3500, 2, 0.3 * v, 0.05); if (Math.random() < 0.3) tone(t + 0.02, 3200, 900, 0.35, 0.06 * v, 'sine'); }
    else { nz(t, 0.08, 'bandpass', 900, 0.9, 0.35 * v, 0.07); if (Math.random() < 0.18) tone(t + 0.01, rnd(2600, 3400), rnd(900, 1300), 0.32, 0.05 * v, 'sine'); }
  }
  function sndClick(f = 2800, g = 0.25) { if (!audio()) return; const t = A.ctx.currentTime; nz(t, 0.03, 'bandpass', f, 4, g, 0.025); }
  function sndPickup() { if (!audio()) return; const t = A.ctx.currentTime; tone(t, 880, 880, 0.12, 0.12, 'triangle'); tone(t + 0.09, 1320, 1320, 0.2, 0.1, 'triangle'); sndClick(2200, 0.2); }

  // ================================================================ Effekte
  const fxTex = (draw) => { const c = document.createElement('canvas'); c.width = c.height = 64; draw(c.getContext('2d')); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
  // Partikel (Funken additiv, Staub/Splitter normal) – je ein Draw Call
  function particles(n, additive) {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 4), size = new Float32Array(n);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aCol', new THREE.BufferAttribute(col, 4)); g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { scale: { value: 600 }, light: { value: 1 } },
      vertexShader: 'attribute vec4 aCol; attribute float aSize; uniform float scale; varying vec4 vC; void main(){ vC = aCol; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = aSize * scale / max(0.2, -mv.z); gl_Position = projectionMatrix * mv; }',
      fragmentShader: additive ? 'varying vec4 vC; void main(){ vec2 p = gl_PointCoord - 0.5; float d = length(p); float a = 1.0 - smoothstep(0.0, 0.5, d); a *= a; gl_FragColor = vec4(vC.rgb * a * vC.a, 1.0); }'
        : 'uniform float light; varying vec4 vC; void main(){ vec2 p = gl_PointCoord - 0.5; float d = length(p); float a = (1.0 - smoothstep(0.12, 0.5, d)) * vC.a; if (a < 0.01) discard; gl_FragColor = vec4(vC.rgb * light, a); }' });
    const pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.userData.noRay = true; fxRoot.add(pts);
    const P = []; for (let i = 0; i < n; i++) P.push({ life: 0, max: 1, p: V3(), v: V3(), c: [1, 1, 1], s0: 0.02, s1: 0.02, a0: 1, grav: 9.8, drag: 0 });
    let head = 0;
    return {
      pts, spawn(o) { const q = P[head]; head = (head + 1) % n; q.life = o.life; q.max = o.life; q.p.copy(o.p); q.v.copy(o.v); q.c = o.c; q.s0 = o.s0; q.s1 = o.s1 ?? o.s0; q.a0 = o.a ?? 1; q.grav = o.grav ?? 9.8; q.drag = o.drag ?? 0; },
      update(dt) {
        let any = false;
        for (let i = 0; i < n; i++) { const q = P[i];
          if (q.life <= 0) { size[i] = 0; col[i * 4 + 3] = 0; continue; } any = true;
          q.life -= dt; q.v.y -= q.grav * dt; if (q.drag) q.v.multiplyScalar(Math.max(0, 1 - q.drag * dt)); q.p.addScaledVector(q.v, dt);
          if (q.p.y < -0.1 && q.v.y < 0) { q.p.y = -0.1; q.v.y *= -0.3; q.v.x *= 0.5; q.v.z *= 0.5; }
          const k = Math.max(0, q.life / q.max);
          pos[i * 3] = q.p.x; pos[i * 3 + 1] = q.p.y; pos[i * 3 + 2] = q.p.z;
          col[i * 4] = q.c[0]; col[i * 4 + 1] = q.c[1]; col[i * 4 + 2] = q.c[2]; col[i * 4 + 3] = q.a0 * (additive ? k * k : Math.min(1, k * 2.2));
          size[i] = q.s1 + (q.s0 - q.s1) * k;
        }
        g.attributes.position.needsUpdate = true; g.attributes.aCol.needsUpdate = true; g.attributes.aSize.needsUpdate = true;
        return any;
      },
    };
  }
  const sparks = particles(MOBILE ? 90 : 160, true), dust = particles(MOBILE ? 50 : 90, false);
  function updScale() { dust.pts.material.uniforms.light.value = W.night ? 0.16 : 0.7; const s = innerHeight * 0.5 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(2, W.renderer.getPixelRatio()); sparks.pts.material.uniforms.scale.value = s; dust.pts.material.uniforms.scale.value = s; }

  // Einschusslöcher (wiederverwendet)
  const holeTex = fxTex(g => { const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30); gr.addColorStop(0, 'rgba(10,9,8,1)'); gr.addColorStop(0.22, 'rgba(25,22,20,0.95)'); gr.addColorStop(0.38, 'rgba(70,64,58,0.55)'); gr.addColorStop(0.7, 'rgba(120,112,100,0.18)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    g.strokeStyle = 'rgba(30,26,22,0.6)'; g.lineWidth = 1.2; for (let i = 0; i < 7; i++) { const a = Math.random() * 6.28; g.beginPath(); g.moveTo(32 + Math.cos(a) * 6, 32 + Math.sin(a) * 6); g.lineTo(32 + Math.cos(a + 0.2) * rnd(12, 22), 32 + Math.sin(a + 0.2) * rnd(12, 22)); g.stroke(); } });
  const crackTex = fxTex(g => { g.strokeStyle = 'rgba(235,245,255,0.95)'; g.lineCap = 'round';
    for (let i = 0; i < 11; i++) { const a = i / 11 * 6.28 + Math.random() * 0.4; let x = 32, y = 32; g.lineWidth = 1.4; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 4; k++) { x += Math.cos(a + rnd(-0.3, 0.3)) * rnd(5, 9); y += Math.sin(a + rnd(-0.3, 0.3)) * rnd(5, 9); g.lineTo(x, y); } g.stroke(); }
    g.lineWidth = 1; for (const r of [7, 13, 19]) { g.beginPath(); for (let i = 0; i <= 12; i++) { const a = i / 12 * 6.28; const rr = r + rnd(-1.5, 1.5); if (i) g.lineTo(32 + Math.cos(a) * rr, 32 + Math.sin(a) * rr); else g.moveTo(32 + Math.cos(a) * rr, 32 + Math.sin(a) * rr); } g.globalAlpha = 0.55; g.stroke(); g.globalAlpha = 1; }
    g.fillStyle = 'rgba(20,24,30,0.9)'; g.beginPath(); g.arc(32, 32, 2.4, 0, 6.28); g.fill(); });
  function decals(tex, n, size, opts) {
    const m = new THREE.InstancedMesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial(Object.assign({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, roughness: 0.9, metalness: 0 }, opts)), n);
    m.count = 0; m.frustumCulled = false; m.userData.noRay = true; m.renderOrder = 3; fxRoot.add(m);
    let head = 0;
    return { m, add(p, nrm, s = 1) { const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), nrm); q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.random() * 6.28)); const mt = new THREE.Matrix4().compose(p.clone().addScaledVector(nrm, 0.006), q, new THREE.Vector3(s, s, s)); m.setMatrixAt(head, mt); head = (head + 1) % n; m.count = Math.max(m.count, head === 0 ? n : head); m.instanceMatrix.needsUpdate = true; },
      clear() { m.count = 0; head = 0; } };
  }
  const holes = decals(holeTex, MOBILE ? 40 : 80, 0.13, {});
  const cracks = decals(crackTex, 24, 0.42, { emissive: 0x9fb4c8, emissiveIntensity: 0.25, roughness: 0.2 });

  // Mündungsfeuer + Licht (Licht nur am Computer: jede Lampe kostet auf dem Handy Leistung)
  const flashTex = fxTex(g => { g.translate(32, 32); for (let i = 0; i < 7; i++) { g.rotate(6.28 / 7 + rnd(-0.15, 0.15)); const gr = g.createLinearGradient(0, 0, 30, 0); gr.addColorStop(0, 'rgba(255,240,200,1)'); gr.addColorStop(0.5, 'rgba(255,170,60,0.7)'); gr.addColorStop(1, 'rgba(255,120,20,0)'); g.fillStyle = gr; g.beginPath(); g.moveTo(0, -3.5); g.lineTo(rnd(20, 31), 0); g.lineTo(0, 3.5); g.fill(); }
    const r = g.createRadialGradient(0, 0, 0, 0, 0, 14); r.addColorStop(0, 'rgba(255,255,235,1)'); r.addColorStop(1, 'rgba(255,190,80,0)'); g.fillStyle = r; g.beginPath(); g.arc(0, 0, 14, 0, 6.28); g.fill(); });
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, color: new THREE.Color(3.2, 2.4, 1.5), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  flash.visible = false; flash.userData.noRay = true; fxRoot.add(flash);
  const flash2 = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, color: new THREE.Color(2.4, 1.7, 0.9), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  flash2.visible = false; flash2.userData.noRay = true; fxRoot.add(flash2);
  let flashLight = null;
  if (!MOBILE) { flashLight = new THREE.PointLight(0xffb060, 0, 7, 2); fxRoot.add(flashLight); }
  let flashT = 0;
  // Leuchtspuren: kurzer Lichtstrich, der mit ~300 m/s zum Ziel fliegt
  const tracerGeo = new THREE.CylinderGeometry(0.0035, 0.0035, 1, 5, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2);
  const tracers = []; for (let i = 0; i < 12; i++) { const m = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.9, 1.0), transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending })); m.visible = false; m.userData.noRay = true; m.userData.a = V3(); m.userData.b = V3(); m.userData.s = 0; m.userData.L = 0; fxRoot.add(m); tracers.push(m); }
  let trHead = 0;
  function tracer(from, to) { const L = from.distanceTo(to); if (L < 2) return; const m = tracers[trHead]; trHead = (trHead + 1) % tracers.length; m.userData.a.copy(from); m.userData.b.copy(to); m.userData.L = L; m.userData.s = 0.4; m.visible = true; m.position.copy(from); m.lookAt(to); m.scale.set(1, 1, 0.001); }
  function updTracers(dt) { let any = false; for (const m of tracers) { if (!m.visible) continue; any = true; const u = m.userData; const seg = Math.min(4, u.L * 0.5); u.s += 320 * dt; const head = Math.min(u.L, u.s), tail = Math.max(0, u.s - seg); if (tail >= u.L) { m.visible = false; continue; } m.position.copy(u.a).lerp(u.b, tail / u.L); m.scale.set(1, 1, Math.max(0.01, head - tail)); } return any; }
  // Hülsen
  const shellMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.02, 6), M.brass, 24); shellMesh.count = 0; shellMesh.frustumCulled = false; shellMesh.userData.noRay = true; fxRoot.add(shellMesh);
  const shells = []; let shHead = 0;
  function ejectShell(gun) { const p = gun.localToWorld(gun.userData.eject.clone()); const r = V3().setFromMatrixColumn(gun.matrixWorld, 0).normalize(); const u = V3().setFromMatrixColumn(gun.matrixWorld, 1).normalize();
    const s = { p, v: r.multiplyScalar(rnd(1.6, 2.6)).addScaledVector(u, rnd(1.2, 2)), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd(0, 6), rnd(0, 6), 0)), w: rnd(10, 25), life: 4 };
    shells[shHead] = s; shHead = (shHead + 1) % 24; shellMesh.count = Math.max(shellMesh.count, shells.length); }

  // ================================================================ Treffer-Suche (Strahl)
  // große Netze bekommen ein Raster (schnell auch am Handy), kleine gehen über three.js
  const GRID = new WeakMap(), _scl = V3(), _ray = new THREE.Ray(), _inv = new THREE.Matrix4(), _sph = new THREE.Sphere(), _box = new THREE.Box3(), _hp = V3(), _ta = V3(), _tb = V3(), _tc = V3(), _bh = V3();
  function getComp(attr, i, k) { return k === 0 ? attr.getX(i) : k === 1 ? attr.getY(i) : attr.getZ(i); }
  function gridFor(mesh) {
    let G = GRID.get(mesh); if (G !== undefined) return G;
    const g = mesh.geometry, pos = g.attributes.position, idx = g.index; const T = ((idx ? idx.count : pos.count) / 3) | 0;
    if (!g.boundingBox) g.computeBoundingBox(); const bb = g.boundingBox;
    const e = [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z], mn = [bb.min.x, bb.min.y, bb.min.z];
    const ord = [0, 1, 2].sort((i, j) => e[j] - e[i]); const AX = ord[0], BX = ord[1];
    const res = Math.max(4, Math.min(160, Math.ceil(Math.sqrt(T / 5))));
    const cs = Math.max(e[AX], 1e-4) / res; const na = Math.max(1, Math.ceil(e[AX] / cs)), nb = Math.max(1, Math.ceil(Math.max(e[BX], 1e-4) / cs));
    const vi = (t, k) => idx ? idx.getX(t * 3 + k) : t * 3 + k;
    const rect = new Int32Array(T * 4), cnt = new Int32Array(na * nb + 1);
    for (let t = 0; t < T; t++) {
      let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9;
      for (let k = 0; k < 3; k++) { const v = vi(t, k); const ca = getComp(pos, v, AX), cb = getComp(pos, v, BX); if (ca < a0) a0 = ca; if (ca > a1) a1 = ca; if (cb < b0) b0 = cb; if (cb > b1) b1 = cb; }
      const i0 = Math.max(0, Math.min(na - 1, Math.floor((a0 - mn[AX]) / cs))), i1 = Math.max(0, Math.min(na - 1, Math.floor((a1 - mn[AX]) / cs)));
      const j0 = Math.max(0, Math.min(nb - 1, Math.floor((b0 - mn[BX]) / cs))), j1 = Math.max(0, Math.min(nb - 1, Math.floor((b1 - mn[BX]) / cs)));
      rect[t * 4] = i0; rect[t * 4 + 1] = i1; rect[t * 4 + 2] = j0; rect[t * 4 + 3] = j1;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cnt[j * na + i + 1]++;
    }
    for (let i = 1; i < cnt.length; i++) cnt[i] += cnt[i - 1];
    const list = new Int32Array(cnt[cnt.length - 1]), fill = cnt.slice(0, na * nb);
    for (let t = 0; t < T; t++) for (let j = rect[t * 4 + 2]; j <= rect[t * 4 + 3]; j++) for (let i = rect[t * 4]; i <= rect[t * 4 + 1]; i++) list[fill[j * na + i]++] = t;
    G = { AX, BX, mn, cs, na, nb, cnt, list, vi, pos, bb };
    GRID.set(mesh, G); return G;
  }
  function triHit(G, t, ray, best) {
    const p = G.pos; let v = G.vi(t, 0); _ta.fromBufferAttribute(p, v); v = G.vi(t, 1); _tb.fromBufferAttribute(p, v); v = G.vi(t, 2); _tc.fromBufferAttribute(p, v);
    if (!ray.intersectTriangle(_ta, _tb, _tc, false, _hp)) return -1;
    const d = _hp.distanceTo(ray.origin); if (d < best.t) { best.t = d; best.tri = t; best.p.copy(_hp); best.n.subVectors(_tc, _tb).cross(_ta.clone().sub(_tb)).normalize(); } return d;
  }
  function gridRay(mesh, rayW, far) { // Ergebnis in Welt-Abstand
    const G = gridFor(mesh); _inv.copy(mesh.matrixWorld).invert(); _ray.copy(rayW).applyMatrix4(_inv);
    const ms = _scl.setFromMatrixScale(mesh.matrixWorld); const smin = Math.min(ms.x, ms.y, ms.z) || 1;
    if (!_ray.intersectBox(G.bb, _bh) && !G.bb.containsPoint(_ray.origin)) return null;
    const best = { t: Infinity, tri: -1, p: V3(), n: V3() };
    const o = [_ray.origin.x, _ray.origin.y, _ray.origin.z], d = [_ray.direction.x, _ray.direction.y, _ray.direction.z];
    let t0 = G.bb.containsPoint(_ray.origin) ? 0 : _bh.distanceTo(_ray.origin);
    const farL = far / smin + 1;
    const pa = o[G.AX] + d[G.AX] * t0, pb = o[G.BX] + d[G.BX] * t0;
    let i = Math.max(0, Math.min(G.na - 1, Math.floor((pa - G.mn[G.AX]) / G.cs))), j = Math.max(0, Math.min(G.nb - 1, Math.floor((pb - G.mn[G.BX]) / G.cs)));
    const da = d[G.AX], db = d[G.BX];
    const si = da > 0 ? 1 : -1, sj = db > 0 ? 1 : -1;
    const tdA = Math.abs(da) > 1e-9 ? G.cs / Math.abs(da) : Infinity, tdB = Math.abs(db) > 1e-9 ? G.cs / Math.abs(db) : Infinity;
    let tmA = Math.abs(da) > 1e-9 ? ((G.mn[G.AX] + (i + (da > 0 ? 1 : 0)) * G.cs) - o[G.AX]) / da : Infinity;
    let tmB = Math.abs(db) > 1e-9 ? ((G.mn[G.BX] + (j + (db > 0 ? 1 : 0)) * G.cs) - o[G.BX]) / db : Infinity;
    for (let guard = 0; guard < 4000; guard++) {
      const c = j * G.na + i; for (let k = G.cnt[c]; k < G.cnt[c + 1]; k++) triHit(G, G.list[k], _ray, best);
      const tExit = Math.min(tmA, tmB);
      if (best.t <= tExit || tExit > farL) break;
      if (tmA < tmB) { i += si; tmA += tdA; if (i < 0 || i >= G.na) break; } else { j += sj; tmB += tdB; if (j < 0 || j >= G.nb) break; }
    }
    if (best.tri < 0) return null;
    const pw = best.p.applyMatrix4(mesh.matrixWorld); const nw = best.n.transformDirection(mesh.matrixWorld);
    return { point: pw, normal: nw, distance: pw.distanceTo(rayW.origin), object: mesh };
  }
  // feste Teile der Szene: Weltkugeln einmal vorberechnen (alle 4 s neu), Instanzen einzeln
  let statics = [], sph = new Float32Array(0), insts = [], staticsT = 0;
  const _tm = new THREE.Matrix4(), _tmesh = new THREE.Mesh(), _c3 = V3();
  function gatherStatics() {
    const out = [], ins = []; const skip = new Set([W.P.root, fxRoot]);
    for (const s of W.shootables) skip.add(s);
    const walk = (o) => { if (skip.has(o) || o.userData.noRay || o.isSprite || o.isPoints || o.isLine || o.isLight) return;
      if (o.isMesh && !o.isSkinnedMesh && o.geometry && o.geometry.attributes.position && o.material && !Array.isArray(o.material) && o.material.visible !== false) (o.isInstancedMesh ? ins : out).push(o);
      for (const c of o.children) walk(c); };
    scene.updateMatrixWorld();
    walk(scene); statics = out; sph = new Float32Array(out.length * 4);
    out.forEach((m, i) => { const g = m.geometry; if (!g.boundingSphere) g.computeBoundingSphere(); _sph.copy(g.boundingSphere).applyMatrix4(m.matrixWorld); sph[i * 4] = _sph.center.x; sph[i * 4 + 1] = _sph.center.y; sph[i * 4 + 2] = _sph.center.z; sph[i * 4 + 3] = _sph.radius; });
    insts = ins.map(m => { const g = m.geometry; if (!g.boundingSphere) g.computeBoundingSphere(); const n = m.count, a = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) { m.getMatrixAt(i, _tm); _tm.premultiply(m.matrixWorld); _sph.copy(g.boundingSphere).applyMatrix4(_tm); a[i * 4] = _sph.center.x; a[i * 4 + 1] = _sph.center.y; a[i * 4 + 2] = _sph.center.z; a[i * 4 + 3] = _sph.radius; }
      return { m, a, n }; });
    staticsT = performance.now();
    warmQ = out.filter(m => !GRID.has(m) && (((m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3) | 0) > 150);
  }
  let warmQ = [];
  const shown = (o) => { while (o) { if (!o.visible) return false; o = o.parent; } return true; };
  const _rc = new THREE.Raycaster(), _hits = [];
  function sphereT(a, i, o, d, lim) { const vx = a[i] - o.x, vy = a[i + 1] - o.y, vz = a[i + 2] - o.z, r = a[i + 3]; const t = vx * d.x + vy * d.y + vz * d.z; if (t < -r) return false; const d2 = vx * vx + vy * vy + vz * vz - t * t; if (d2 > r * r) return false; return t - r <= lim; }
  // bewegliche Ziele (Autos, Passanten-Hüllen, Gegenstände mit onHit)
  function hostRay(ray, far, people) {
    _rc.ray.copy(ray); _rc.near = 0.05; _rc.far = far; _hits.length = 0; _rc.intersectObjects(W.shootables, true, _hits);
    for (const h of _hits) { const host = hostOf(h.object); if (!host) continue; if (host.userData.person && !people) continue; if (!shown(h.object)) continue;
      return { point: h.point, normal: h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : ray.direction.clone().negate(), distance: h.distance, object: h.object, host }; }
    return null;
  }
  // feste Szene (Häuser, Laden, Straße, Bäume …) + Boden
  function staticRay(ray, far) {
    if (performance.now() - staticsT > 4000) gatherStatics();
    const PF = S.prof; let best = null; const o = ray.origin, d = ray.direction;
    for (let i = 0; i < statics.length; i++) {
      const lim = best ? best.distance : far; if (!sphereT(sph, i * 4, o, d, lim)) continue;
      const m = statics[i]; if (!shown(m)) continue;
      const g = m.geometry; const T = ((g.index ? g.index.count : g.attributes.position.count) / 3) | 0; const tm0 = PF ? performance.now() : 0;
      let h = null;
      if (T > 150 && !g.morphAttributes.position) h = gridRay(m, ray, lim);
      else { _rc.ray.copy(ray); _rc.near = 0.05; _rc.far = lim; _hits.length = 0; m.raycast(_rc, _hits); if (_hits.length) { _hits.sort((a, b) => a.distance - b.distance); const x = _hits[0]; h = { point: x.point, normal: x.face ? x.face.normal.clone().transformDirection(m.matrixWorld) : d.clone().negate(), distance: x.distance, object: m }; } }
      if (PF) { const k = T > 150 ? 'grid' : 'small'; PF[k] = (PF[k] || 0) + performance.now() - tm0; }
      if (h && h.distance < lim && h.distance > 0.05) best = h;
    }
    for (const it of insts) {
      const m = it.m; if (!shown(m)) continue; const tm0 = PF ? performance.now() : 0;
      for (let i = 0; i < it.n; i++) {
        const lim = best ? best.distance : far; if (!sphereT(it.a, i * 4, o, d, lim)) continue;
        m.getMatrixAt(i, _tm); _tmesh.geometry = m.geometry; _tmesh.material = m.material; _tmesh.matrixWorld.multiplyMatrices(m.matrixWorld, _tm);
        _rc.ray.copy(ray); _rc.near = 0.05; _rc.far = lim; _hits.length = 0; _tmesh.raycast(_rc, _hits);
        if (_hits.length) { _hits.sort((a, b) => a.distance - b.distance); const x = _hits[0]; if (x.distance < lim) best = { point: x.point, normal: x.face ? x.face.normal.clone().transformDirection(_tmesh.matrixWorld) : d.clone().negate(), distance: x.distance, object: m, instanceId: i }; }
      }
      if (PF) PF.inst = (PF.inst || 0) + performance.now() - tm0;
    }
    if (!best && d.y < -0.01) { const t = (0 - o.y) / d.y; if (t < far) { const p = ray.at(t, V3()); p.y = W.groundY(p.x, p.z); best = { point: p, normal: V3().set(0, 1, 0), distance: t, object: null, ground: true }; } }
    return best;
  }
  function castRay(ray, far = 160, people = false) {
    const PF = S.prof, t0 = PF ? performance.now() : 0;
    const a = hostRay(ray, far, people);
    if (PF) PF.shoot = (PF.shoot || 0) + performance.now() - t0;
    const b = staticRay(ray, a ? a.distance : far);
    const best = b || a;
    if (best && best.normal.dot(ray.direction) > 0) best.normal.negate();
    return best;
  }
  function hostOf(o) { while (o) { if (o.userData && (o.userData.onHit || o.userData.person)) return o; o = o.parent; } return null; }
  function materialKind(h) {
    if (!h || !h.object) return 'stone';
    if (h.object.userData.glass) return 'glass';
    if (h.host && h.host.userData.kind === 'car') return 'metal';
    const m = h.object.material || {}; const nm = (h.object.name + ' ' + (m.name || '')).toLowerCase();
    if ((m.transparent && (m.opacity ?? 1) < 0.92) || m.transmission > 0 || /glas|glass|window|fenster|scheibe/.test(nm)) return 'glass';
    if ((m.metalness ?? 0) > 0.5 || /metal|stahl|car|auto|lack/.test(nm)) return 'metal';
    return 'stone';
  }
  const inShopFront = (p) => p.x > -0.7 && p.x < 24.7 && p.z > -1.2 && p.z < 1.7 && p.y > -0.3 && p.y < 7.6;
  const playerInShop = () => W.P.z < 0.3 && W.P.x > -0.5 && W.P.x < 24.5;

  // ================================================================ Schießen
  const _o = V3(), _dir = V3(), _mz = V3();
  function pull() {
    if (!W.gameMode || !S.armed || W.control) return;
    audio();
    if (S.cool > 0 || S.reloading > 0) return;
    fire();
  }
  function fire() {
    const k = S.cur, G = GUNS[k], inv = S.inv[k];
    if (playerInShop()) { if (performance.now() - S.insideWarned > 3000) { W.toast('Im Laden wird nicht geschossen'); S.insideWarned = performance.now(); } return; }
    if (inv.mag <= 0) { sndClick(3200, 0.3); S.cool = 0.25; if (inv.res > 0) reload(); else if (performance.now() - S.insideWarned > 2000) { W.toast('Keine Munition – neue Waffe aufheben'); S.insideWarned = performance.now(); } return; }
    // zeigt das Fadenkreuz auf einen Menschen: nicht schießen
    const center = W.aimRay(); const ch = castRay(center.ray, 70, true);
    if (ch && ch.host && ch.host.userData.person) {
      ch.host.userData.onHit && ch.host.userData.onHit({ point: ch.point, normal: ch.normal, object: ch.object, dir: center.ray.direction.clone(), blocked: true });
      if (performance.now() - S.peopleWarned > 3500) { W.toast('Auf Menschen wird nicht geschossen'); S.peopleWarned = performance.now(); }
      S.cool = 0.4; return;
    }
    inv.mag--; S.cool = G.rate; S.aimHold = 0.9;
    const gun = held[k]; gun.updateMatrixWorld(true); _mz.copy(gun.userData.muzzle); gun.localToWorld(_mz);
    let firstHit = null;
    for (let i = 0; i < G.pellets; i++) {
      const r = W.aimRay(); const sp = G.spread * (W.tp.aim ? 0.6 : 1.3);
      _dir.copy(r.ray.direction); const u = V3().crossVectors(_dir, V3().set(0, 1, 0)).normalize(), v = V3().crossVectors(u, _dir).normalize();
      const a = Math.random() * 6.283, rr = Math.sqrt(Math.random()) * sp; _dir.addScaledVector(u, Math.cos(a) * rr).addScaledVector(v, Math.sin(a) * rr).normalize();
      r.ray.direction.copy(_dir);
      const h = castRay(r.ray, 160, true);
      if (h && h.host && h.host.userData.person) { h.host.userData.onHit && h.host.userData.onHit({ point: h.point, dir: _dir.clone(), blocked: true }); tracer(_mz, r.ray.at(Math.min(h.distance + 25, 120), V3())); continue; } // knapp vorbei – nie treffen
      const end = h ? h.point : r.ray.at(120, V3());
      if (i === 0 || Math.random() < 0.35) tracer(_mz, end);
      if (h) { impact(h, _dir, i === 0); if (!firstHit) firstHit = h; }
    }
    // Mündungsfeuer, Rauch, Hülse, Rückstoß, Ton
    flash.position.copy(_mz); flash.material.rotation = Math.random() * 6.28; flash.scale.setScalar(G.flash * rnd(0.85, 1.15)); flash.visible = true;
    const fw = V3().setFromMatrixColumn(gun.matrixWorld, 2).normalize();
    flash2.position.copy(_mz).addScaledVector(fw, G.flash * 0.42); flash2.material.rotation = Math.random() * 6.28; flash2.scale.setScalar(G.flash * 0.62); flash2.visible = true;
    flashT = 0.045; if (flashLight) { flashLight.position.copy(_mz); flashLight.intensity = 14 * (G.long ? 1.4 : 1); }
    for (let i = 0; i < (G.long ? 5 : 3); i++) dust.spawn({ p: _mz, v: fw.clone().multiplyScalar(rnd(0.6, 1.6)).add(V3(rnd(-0.2, 0.2), rnd(0.1, 0.4), rnd(-0.2, 0.2))), life: rnd(0.5, 0.9), c: [0.75, 0.74, 0.72], s0: 0.05, s1: rnd(0.22, 0.38), a: 0.32, grav: -0.25, drag: 2.2 });
    for (let i = 0; i < 5; i++) sparks.spawn({ p: _mz, v: fw.clone().multiplyScalar(rnd(3, 7)).add(V3(rnd(-1, 1), rnd(-0.6, 1), rnd(-1, 1))), life: rnd(0.04, 0.1), c: [3, 2, 0.9], s0: 0.025, s1: 0.01, grav: 2 });
    if (k !== 'shotgun') ejectShell(gun); else setTimeout(() => { if (S.cur === 'shotgun') ejectShell(held.shotgun); }, 420);
    const kick = G.kick * (W.tp.aim ? 0.7 : 1); W.tp.el = Math.max(-0.8, W.tp.el - kick); S.recover = (S.recover || 0) + kick * 0.72; W.tp.yaw += rnd(-0.3, 0.3) * kick; S.shake = Math.min(0.06, (S.shake || 0) + kick * 0.9); S.bloom = Math.min(1, (S.bloom || 0) + (G.long ? 0.9 : 0.45));
    sndShot(k);
    W.emit('shot', { pos: { x: W.P.x, y: 1.4, z: W.P.z }, dir: { x: _dir.x, y: _dir.y, z: _dir.z }, hit: firstHit ? { x: firstHit.point.x, y: firstHit.point.y, z: firstHit.point.z } : null, weapon: k });
    updAmmo();
    if (inv.mag === 0 && inv.res > 0) setTimeout(reload, 260);
    W.requestRender();
  }
  function impact(h, dir, main) {
    const kind = h.ground ? 'stone' : materialKind(h);
    const p = h.point, n = h.normal;
    if (h.host && h.host.userData.onHit) { try { h.host.userData.onHit({ point: p.clone(), normal: n.clone(), object: h.object, dir: dir.clone() }); } catch (e) { console.warn(e); } }
    const protectedSpot = inShopFront(p);
    const refl = dir.clone().reflect(n);
    if (kind === 'metal' || (kind === 'stone' && Math.random() < 0.6)) for (let i = 0; i < (kind === 'metal' ? 9 : 5); i++) sparks.spawn({ p, v: refl.clone().multiplyScalar(rnd(1.5, 4.5)).add(V3(rnd(-1.4, 1.4), rnd(-0.5, 1.8), rnd(-1.4, 1.4))), life: rnd(0.15, 0.4), c: [3.2, 1.9, 0.6], s0: 0.028, s1: 0.008, grav: 9.8 });
    if (kind === 'glass') {
      for (let i = 0; i < 9; i++) dust.spawn({ p, v: n.clone().multiplyScalar(rnd(0.3, 1.4)).add(dir.clone().multiplyScalar(rnd(0.2, 1))).add(V3(rnd(-0.6, 0.6), rnd(-0.2, 0.8), rnd(-0.6, 0.6))), life: rnd(0.6, 1.1), c: [0.85, 0.92, 1.0], s0: 0.018, s1: 0.012, a: 0.9, grav: 9.8 });
      if (!protectedSpot && !h.host) cracks.add(p, n, rnd(0.8, 1.25));
    } else {
      const dc = h.ground ? [0.42, 0.4, 0.38] : [0.62, 0.58, 0.52];
      for (let i = 0; i < 4; i++) dust.spawn({ p, v: n.clone().multiplyScalar(rnd(0.4, 1.4)).add(V3(rnd(-0.4, 0.4), rnd(0, 0.5), rnd(-0.4, 0.4))), life: rnd(0.6, 1.2), c: dc, s0: 0.04, s1: rnd(0.25, 0.45), a: 0.5, grav: -0.2, drag: 2.5 });
      for (let i = 0; i < 4; i++) dust.spawn({ p, v: n.clone().multiplyScalar(rnd(1, 3)).add(V3(rnd(-1, 1), rnd(0, 2), rnd(-1, 1))), life: rnd(0.4, 0.8), c: [0.3, 0.28, 0.26], s0: 0.012, s1: 0.01, a: 1, grav: 9.8 });
      if (!protectedSpot && !h.host) holes.add(p, n, rnd(0.8, 1.2));
    }
    sndImpact(kind, h.distance);
  }
  function reload() {
    const k = S.cur; if (!k || S.reloading > 0) return; const inv = S.inv[k], G = GUNS[k];
    if (inv.mag >= G.mag || inv.res <= 0) return;
    S.reloading = G.reload; sndClick(1800, 0.3); setTimeout(() => sndClick(2400, 0.3), G.reload * 600); updAmmo();
  }
  function finishReload() { const k = S.cur, inv = S.inv[k], G = GUNS[k]; const n = Math.min(G.mag - inv.mag, inv.res); inv.mag += n; inv.res -= n; sndClick(3000, 0.35); updAmmo(); }
  function equip(k) {
    S.cur = k; S.armed = !!k; S.reloading = 0;
    for (const g in held) held[g].visible = false;
    syncUI(); updAmmo();
  }
  function cycle() { const have = ORDER.filter(k => S.inv[k]); if (have.length < 2) return; const i = have.indexOf(S.cur); equip(have[(i + 1) % have.length]); sndClick(1600, 0.25); W.toast(GUNS[S.cur].name); }
  function take(pu) {
    const k = pu.kind, G = GUNS[k];
    if (S.inv[k]) { S.inv[k].res = Math.min(G.reserve * 2, S.inv[k].res + G.mag * 2); W.toast(G.name + ': Munition +' + G.mag * 2); }
    else { S.inv[k] = { mag: G.mag, res: G.reserve }; W.toast(G.name + ' aufgenommen' + (MOBILE ? ' – Feuer-Knopf drücken' : ' – linke Maustaste = Feuer, rechte = Zielen')); }
    pu.g.visible = false; pu.respawn = 45; sndPickup();
    equip(k);
  }
  function gameOn(on) {
    for (const pu of pickups) { pu.g.visible = on; pu.respawn = 0; }
    if (!on) { S.inv = {}; equip(null); setAim(false); holes.clear(); cracks.clear(); S.trigger = false; }
    else { audio(); W.toast('Spielmodus: Waffen liegen auf dem Gehweg – hingehen zum Aufnehmen', 3200); }
    syncUI(); W.requestRender();
  }
  W.on('gamemode', gameOn);

  // Tastatur / Maus (Computer): links = Feuer, rechts = Zielen, R = Nachladen, 1-3 / Mausrad-Klick = Waffe wechseln
  const canvas = W.renderer.domElement;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || !W.gameMode || !S.armed || W.control) return;
    if (e.button === 0) { S.trigger = true; pull(); }
    else if (e.button === 2) setAim(true);
    else if (e.button === 1) { e.preventDefault(); cycle(); }
  });
  addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') return; if (e.button === 0) S.trigger = false; if (e.button === 2 && W.gameMode && S.armed) setAim(false); });
  canvas.addEventListener('contextmenu', (e) => { if (W.gameMode) e.preventDefault(); });
  addEventListener('keydown', (e) => {
    if (!W.gameMode || !S.armed || W.control) return;
    if (e.code === 'KeyR') reload();
    else if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') { const k = ORDER[+e.code.slice(5) - 1]; if (S.inv[k]) equip(k); }
    else if (e.code === 'Space') { if (!e.repeat) { S.trigger = true; pull(); } e.preventDefault(); }
  });
  addEventListener('keyup', (e) => { if (e.code === 'Space') S.trigger = false; });   // F = Einsteigen (traffic.js)

  // ================================================================ Pose + Waffe in der Hand
  const _fw = V3(), _rt = V3(), _up = V3().set(0, 1, 0), _aimP = V3(), _sh = V3(), _tgt = V3(), _pole = V3(), _gf = V3(), _gu = V3(), _gx = V3(), _hm = V3(), _mx = new THREE.Matrix4();
  function placeGun(gun, pos, fwd, up) {
    _gf.copy(fwd).normalize(); _gx.crossVectors(up, _gf).normalize(); _gu.crossVectors(_gf, _gx).normalize();
    _mx.makeBasis(_gx, _gu, _gf); gun.quaternion.setFromRotationMatrix(_mx); gun.position.copy(pos); gun.updateMatrixWorld(true);
  }
  function poseAndGun(dt) {
    const B = bones(); const k = S.cur; const gun = k ? held[k] : null;
    for (const g in held) held[g].visible = false;
    if (!B || !gun || !W.gameMode || W.control || !W.P.root.visible) return;
    const G = GUNS[k]; gun.visible = true;
    const P = W.P; P.root.updateMatrixWorld(true);
    const aiming = W.tp.aim || S.aimHold > 0;
    _fw.set(Math.sin(P.face), 0, Math.cos(P.face)); _rt.set(-Math.cos(P.face), 0, Math.sin(P.face));
    B.RA.getWorldPosition(_sh);
    if (aiming) {
      // Zielpunkt: Kamerastrahl in 25 m (Arme zielen dorthin, Kugel fliegt durch die Bildmitte)
      const r = S.testRay ? { ray: S.testRay } : W.aimRay(); _aimP.copy(r.ray.origin).addScaledVector(r.ray.direction, 25);
      if (S.aimHold > 0 && !W.tp.aim) { P.face = Math.atan2(r.ray.direction.x, r.ray.direction.z); P.root.rotation.y = P.face; P.root.updateMatrixWorld(true); _fw.set(Math.sin(P.face), 0, Math.cos(P.face)); _rt.set(-Math.cos(P.face), 0, Math.sin(P.face)); B.RA.getWorldPosition(_sh); }
      if (G.long) _tgt.copy(_sh).addScaledVector(_fw, 0.2).addScaledVector(_up, -0.07).addScaledVector(_rt, -0.04);
      else { B.LA.getWorldPosition(_tgt); _tgt.add(_sh).multiplyScalar(0.5).addScaledVector(_up, 0.13).addScaledVector(_rt, 0.07); const ad = V3().subVectors(_aimP, _tgt).normalize(); _tgt.addScaledVector(ad, 0.5); }
      const aimDir = V3().subVectors(_aimP, _tgt).normalize();
      if (G.long) { _tgt.addScaledVector(aimDir, 0.02); }
      _pole.copy(_sh).addScaledVector(_rt, 0.5).addScaledVector(_up, -0.6).addScaledVector(_fw, -0.1);
      ik2(B.RA, B.RF, B.RH, _tgt, _pole);
      aimBone(B.RH, B.RM, aimDir);
      // Waffe: Griff in der Hand
      B.RH.getWorldPosition(_hm); B.RM.getWorldPosition(_c);
      const palm = V3().subVectors(_c, _hm).multiplyScalar(0.55).add(_hm);
      placeGun(gun, palm.addScaledVector(_up, -0.005), aimDir, _up);
    } else if (G.long) { // tiefe Haltung, beide Hände
      _tgt.copy(_sh).addScaledVector(_fw, 0.24).addScaledVector(_up, -0.36).addScaledVector(_rt, 0.02);
      const gdir = V3().copy(_fw).multiplyScalar(0.8).addScaledVector(_up, -0.42).addScaledVector(_rt, -0.38).normalize();
      _pole.copy(_sh).addScaledVector(_rt, 0.5).addScaledVector(_up, -0.5).addScaledVector(_fw, -0.3);
      ik2(B.RA, B.RF, B.RH, _tgt, _pole); aimBone(B.RH, B.RM, gdir);
      B.RH.getWorldPosition(_hm); B.RM.getWorldPosition(_c); const palm = V3().subVectors(_c, _hm).multiplyScalar(0.55).add(_hm);
      placeGun(gun, palm, gdir, _up);
    } else { // Pistole locker in der Hand, Lauf nach unten-vorn
      B.RH.getWorldPosition(_hm); B.RM.getWorldPosition(_c); const fd = V3().subVectors(_c, _hm).normalize();
      const palm = V3().copy(fd).multiplyScalar(0.06).add(_hm);
      const gdir = fd.clone().multiplyScalar(0.75).addScaledVector(_fw, 0.6).normalize();
      placeGun(gun, palm, gdir, _fw);
    }
    // linke Hand an den Vorderschaft / unter den Griff
    if (aiming || G.long) {
      const sup = gun.localToWorld(gun.userData.support.clone());
      const lsh = B.LA.getWorldPosition(V3());
      _pole.copy(lsh).addScaledVector(_rt, -0.5).addScaledVector(_up, -0.7);
      ik2(B.LA, B.LF, B.LH, sup, _pole);
      aimBone(B.LH, B.LM, V3().setFromMatrixColumn(gun.matrixWorld, 2).normalize().addScaledVector(_rt, 0.5).normalize());
    }
  }

  // alle Effekt-Objekte (nicht die Waffen in der Hand) aus der Umgebungsverdeckung nehmen
  fxRoot.traverse(o => { if (o !== fxRoot && !Object.values(held).some(h => h === o || h.children.includes(o))) W.noAO.add(o); });
  // ================================================================ Schleife
  let lastAimCheck = 0;
  return {
    get state() { return S; }, castRay, guns: GUNS, pickups, test: { pull, fire, take, reload, equip, sparks, dust, flash, flash2, fxRoot },
    update(dt) {
      let busy = false;
      S.tick++;
      // Aufheben
      if (W.gameMode) {
        for (const pu of pickups) {
          if (!pu.g.visible) { if (pu.respawn > 0) { pu.respawn -= dt; if (pu.respawn <= 0) pu.g.visible = true; } continue; }
          pu.t += dt; pu.gun.rotation.y = pu.t * 1.6; pu.gun.position.y = 0.9 + Math.sin(pu.t * 2.2) * 0.06; pu.ring.material.opacity = 0.7 + Math.sin(pu.t * 3) * 0.3; busy = true;
          if (!W.control && W.tp.active && Math.hypot(W.P.x - pu.x, W.P.z - pu.z) < 1.0) take(pu);
        }
      }
      syncUI();
      if (W.gameMode) { if (performance.now() - staticsT > 4000 && S.armed) gatherStatics(); const t0 = performance.now(); while (warmQ.length && performance.now() - t0 < 2) gridFor(warmQ.pop()); }
      if (S.cool > 0) S.cool -= dt;
      if (S.reloading > 0) { S.reloading -= dt; const G = GUNS[S.cur]; xhRL.style.strokeDasharray = `${(1 - Math.max(0, S.reloading) / G.reload) * 94} 200`; if (S.reloading <= 0) { finishReload(); xhRL.style.strokeDasharray = '0 200'; } busy = true; }
      if (S.trigger && S.armed && GUNS[S.cur] && GUNS[S.cur].auto && S.cool <= 0 && S.reloading <= 0) fire();
      if (S.aimHold > 0) { S.aimHold -= dt; busy = true; }
      // Rückstoß erholen, Kamera wackeln
      if (S.recover > 0) { const r = Math.min(S.recover, dt * 0.35); W.tp.el += r; S.recover -= r; busy = true; }
      if (S.shake > 0) { camera.position.x += rnd(-1, 1) * S.shake * 0.25; camera.position.y += rnd(-1, 1) * S.shake * 0.25; S.shake = Math.max(0, S.shake - dt * 0.5); busy = true; }
      if (S.bloom > 0) S.bloom = Math.max(0, S.bloom - dt * 3);
      // Fadenkreuz: Ziel unter der Mitte prüfen (Menschen → nicht schießen, bedrohen)
      if (W.gameMode && S.armed && !W.control) {
        const spread = 4 + (S.bloom || 0) * 9 + (W.tp.aim ? 0 : 3) + Math.min(6, W.P.speed * 1.5);
        xhK.style.transform = ''; xh.style.setProperty('--sp', spread);
        xhK.querySelectorAll('.k').forEach((el, i) => { const dx = i === 2 ? -1 : i === 3 ? 1 : 0, dy = i === 0 ? -1 : i === 1 ? 1 : 0; el.setAttribute('transform', `translate(${dx * (spread - 4)} ${dy * (spread - 4)})`); });
        if (performance.now() - lastAimCheck > 140) {
          lastAimCheck = performance.now();
          const r = W.aimRay(); const hh = hostRay(r.ray, 60, true); const h = hh && !staticRay(r.ray, hh.distance - 0.05) ? hh : null;
          const st = h && h.host ? (h.host.userData.person ? 'no' : 'hot') : '';
          xh.classList.toggle('no', st === 'no'); xh.classList.toggle('hot', st === 'hot');
          if (st === 'no' && W.tp.aim && h.host.userData.npc) W.emit('threat', { npc: h.host.userData.npc });
        }
      }
      poseAndGun(dt);
      // Effekte (S.slowmo nur für Testbilder)
      const fdt = dt * (S.slowmo || 1);
      if (flashT > 0) { flashT -= fdt; busy = true; if (flashT <= 0) { flash.visible = false; flash2.visible = false; if (flashLight) flashLight.intensity = 0; } }
      if (updTracers(fdt)) busy = true;
      updScale();
      if (sparks.update(fdt)) busy = true; if (dust.update(fdt)) busy = true;
      if (shells.length) { let any = false; for (let i = 0; i < shells.length; i++) { const s = shells[i]; if (!s) continue; if (s.life > 0) { s.life -= fdt; any = true; s.v.y -= 9.8 * fdt; s.p.addScaledVector(s.v, fdt); const gy = W.groundY(s.p.x, s.p.z) + 0.005; if (s.p.y < gy) { s.p.y = gy; s.v.y = Math.abs(s.v.y) * 0.35; s.v.x *= 0.6; s.v.z *= 0.6; s.w *= 0.6; } s.q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(s.w * fdt, 0, s.w * fdt * 0.3))); }
        _mx.compose(s.p, s.q, V3().set(1, 1, 1)); shellMesh.setMatrixAt(i, _mx); } shellMesh.instanceMatrix.needsUpdate = true; if (any) busy = true; }
      return busy || (W.gameMode && S.armed);
    },
  };
}
