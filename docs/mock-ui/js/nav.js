/* Indore Spaces — visitor app (phone). All behaviour is deterministic and driven by js/engine.js.
   On a laptop the "walk" is a simulation; on a real phone the same state comes from marker scans + sensors. */
(function () {
  'use strict';
  const IS = window.IS;
  const $ = id => document.getElementById(id);
  const now = () => performance.now() / 1000;
  const V = IS.store.getPublished();
  const fl = id => (V.floors.find(f => f.id === id) || {}).name || id;
  const room = id => V.rooms.find(r => r.id === id);
  const poi = id => V.pois.find(p => p.id === id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const angDiff = (a, b) => ((((b - a) % 360) + 540) % 360) - 180;

  const st = {
    screen: 'city', mode: 'explore', user: null, route: null, options: [], optIdx: 0, target: null, place: null,
    s: 0, playing: true, mult: 2, lang: 'en', muted: false, prefs: { avoidStairs: false },
    trans: null, floorPrompt: null, spoken: {}, arOn: false, walked: 0, sinceMarker: 0, scans: 0, t0: 0,
    lastMarker: { id: null, at: 0 }, lostUntil: 0, autoConfirm: true, adSeen: {}, adCounted: {}, impressions: 0,
    pickLoc: false, yawDrag: 0, lookupAt: 0, offRoute: null, lastBus: 0, lastHud: 0, lastDemo: 0, routeVer: 0, arrived: null,
  };
  let mv = null, mini = null, ar = null, rec = null;

  /* ---------------- helpers ---------------- */
  function toast(msg, ms) { const t = $('ptoast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms || 2600); }
  function caption(text) { const c = $('caption'); c.textContent = '🔊 ' + text; c.classList.toggle('top', st.arOn); c.classList.add('show'); clearTimeout(caption._t); caption._t = setTimeout(() => c.classList.remove('show'), 5200); }
  function speak(text) {
    caption(text);
    if (st.muted || !('speechSynthesis' in window)) return;
    try {
      const u = new SpeechSynthesisUtterance(text), want = IS.LANGS[st.lang].speech;
      u.lang = want; const vs = speechSynthesis.getVoices();
      const v = vs.find(x => x.lang.replace('_', '-').toLowerCase() === want.toLowerCase()) || vs.find(x => x.lang.toLowerCase().startsWith(want.slice(0, 2)));
      if (v) u.voice = v; else if (st.lang !== 'en') return; // no matching voice on this device: caption only
      speechSynthesis.cancel(); speechSynthesis.speak(u);
    } catch (e) { /* ignore */ }
  }
  const ev = (kind, text) => IS.bus.send('event', { kind, text, at: Date.now() });
  const clock = sec => { const d = new Date(Date.now() + sec * 1000); return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
  function show(id) {
    document.querySelectorAll('.scr').forEach(s => s.classList.toggle('on', s.id === id));
    st.screen = id.replace('s-', '');
    $('statusbar').classList.toggle('light', id === 's-locate' || id === 's-ar');
  }
  function overlay(id, on) { $(id).classList.toggle('on', !!on); }
  function setMode(m) {
    st.mode = m; $('s-map').dataset.mode = m;
    document.querySelectorAll('#s-map [data-show]').forEach(el => { el.style.display = el.dataset.show.split(' ').includes(m) ? '' : 'none'; });
    $('scanBtn').style.display = 'none';
  }
  function placeOf(t) {
    if (t.room) { const r = room(t.room); return { kind: 'room', id: r.id, name: r.name, icon: r.icon || IS.CATS[r.cat].icon, floor: r.floor, x: r.x + r.w / 2, y: r.y + r.h / 2, sub: `${IS.CATS[r.cat].label} · ${fl(r.floor)}`, hours: r.hours, obj: r }; }
    const p = poi(t.poi); const k = IS.POI_KINDS[p.kind] || {}; return { kind: 'poi', id: p.id, name: p.name, icon: k.icon || '📍', floor: p.floor, x: p.x, y: p.y, sub: `${k.label || 'Point of interest'} · ${fl(p.floor)}`, hours: '', obj: p };
  }
  function nearName(u) {
    const r = V.rooms.find(x => x.floor === u.floor && u.x > x.x && u.x < x.x + x.w && u.y > x.y && u.y < x.y + x.h);
    if (r) return r.name;
    let best = null; V.rooms.forEach(x => { if (x.floor === u.floor) { const d = Math.hypot(x.door.x - u.x, x.door.y - u.y); if (!best || d < best.d) best = { d, n: x.short || x.name }; } });
    return best && best.d < 9 ? best.n : 'the corridor';
  }
  const fromPose = () => ({ floor: st.user.floor, x: st.user.x, y: st.user.y, heading: st.user.heading });
  function estimate(t) { const r = IS.route(V, fromPose(), t, st.prefs); return r && !r.error ? r : null; }
  function confOf(u) {
    if (!u) return { cls: 'bad', txt: '—' };
    if (u.stale) return { cls: 'bad', txt: 'Tracking lost' };
    if (u.acc <= 0.9) return { cls: 'good', txt: `±${u.acc.toFixed(1)} m` };
    if (u.acc <= 2.1) return { cls: 'mid', txt: `±${u.acc.toFixed(1)} m` };
    return { cls: 'bad', txt: `±${u.acc.toFixed(1)} m · scan marker` };
  }

  /* ---------------- city + locate ---------------- */
  function buildCity() {
    const list = $('venueList');
    const items = [
      { icon: '🏢', name: V.name, sub: `${V.type} · ${V.floors.length} floors mapped · v${V.version}`, live: true },
      { icon: '🛍️', name: 'Shopping mall (to be mapped)', sub: 'Shops, food court, parking', live: false },
      { icon: '✈️', name: 'Indore Airport', sub: 'Check-in, security, gates', live: false },
      { icon: '🚆', name: 'Indore Junction Railway Station', sub: 'Platforms, foot-over-bridges', live: false },
      { icon: '🚌', name: 'Sarwate Bus Stand', sub: 'Bays, ticket counters', live: false },
    ];
    list.innerHTML = items.map((v, i) => `<div class="vcard ${v.live ? '' : 'off'}" data-i="${i}"><div class="vi">${v.icon}</div><div style="flex:1"><b>${v.name}</b><small>${v.sub}</small></div><span class="pill ${v.live ? 'live' : 'soon'}">${v.live ? 'LIVE' : 'SOON'}</span></div>`).join('');
    list.querySelectorAll('.vcard').forEach(el => el.onclick = () => { if (el.dataset.i === '0') openLocate(); else toast('Not mapped yet — venue owners can add it from the Owner portal'); });
    $('pinOffice').onclick = openLocate;
    $('cityPill').onclick = () => toast('Demo: only the office is mapped. Tap the blue pin.');
  }
  function drawVfQR() {
    const g = $('vfQR'); let h = '<rect x="0" y="0" width="100" height="100" rx="6" fill="#fff"/>';
    const f = (x, y) => `<rect x="${x}" y="${y}" width="26" height="26" fill="#111"/><rect x="${x + 5}" y="${y + 5}" width="16" height="16" fill="#fff"/><rect x="${x + 9}" y="${y + 9}" width="8" height="8" fill="#111"/>`;
    h += f(6, 6) + f(68, 6) + f(6, 68);
    let seed = 7; for (let i = 0; i < 90; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; const x = 36 + (seed % 7) * 4, y = 6 + ((seed >> 4) % 22) * 4; if (x < 66) h += `<rect x="${x}" y="${y}" width="4" height="4" fill="#111"/>`; }
    g.innerHTML = h;
  }
  function openLocate() {
    show('s-locate'); drawVfQR();
    $('markerChips').innerHTML = V.markers.map(m => `<button class="mchip" data-id="${m.id}">${m.id}<small>${fl(m.floor).replace('Floor ', 'F')} · ${m.name}</small></button>`).join('');
    $('markerChips').querySelectorAll('.mchip').forEach(b => b.onclick = () => scanMarker(b.dataset.id, true));
  }
  function applyAnchor(m, snap) {
    const p = IS.poseFromMarker(m);
    st.user = Object.assign(st.user || {}, snap ? { floor: p.floor, x: p.x, y: p.y, heading: p.heading } : {}, { acc: 0.3, stale: false, markerId: m.id, markerAt: now() });
    st.lastMarker = { id: m.id, at: now() }; st.sinceMarker = 0; st.scans++;
    ev('scan', `Marker ${m.id} scanned — ${m.name} (${fl(m.floor)}) · ±0.3 m`);
  }
  function scanMarker(id, first) {
    const m = V.markers.find(x => x.id === id); if (!m) return;
    applyAnchor(m, true);
    toast(`✅ Marker ${m.id} recognised · ${fl(m.floor)} · ±0.3 m`);
    if (first || st.screen === 'locate') goMap();
    else { refreshAll(); if (st.route) replan(); }
  }

  /* ---------------- map ---------------- */
  function ensureMap() {
    if (mv) { mv.measure(); mv.render(); return; }
    mv = new IS.MapView($('mapbox'), V, { floor: st.user.floor, minScale: 3, maxScale: 42, layers: { pois: true, markers: false }, onSelect: onMapSelect, onUnfollow: () => { if (st.mode === 'nav') toast('Tap ◎ to re-centre'); } });
  }
  function goMap() {
    show('s-map'); setMode('explore'); ensureMap();
    mv.follow = false; mv.headingUp = false; mv.anchorY = 0.4; mv.rot = 0; mv.setFloor(st.user.floor); mv.setRoute(null, 0); mv.setSelected(null); mv.setUser(st.user); mv.centerOn(st.user.x, st.user.y, 9.5);
    buildFloors(); buildExplore();
  }
  function buildFloors() {
    const c = $('floorsCtl');
    c.innerHTML = [...V.floors].reverse().map(f => `<button data-f="${f.id}" class="${mv.floor === f.id ? 'on' : ''}">${f.short}${st.user && st.user.floor === f.id ? '<small>YOU</small>' : '<small>FLOOR</small>'}</button>`).join('');
    c.insertAdjacentHTML('beforeend', `<button id="langBtn" style="border-top:1px solid #edf0f5">🌐<small id="langBtnT">${{ en: 'EN', hi: 'HI', te: 'తె' }[st.lang]}</small></button>`);
    $('langBtn').onclick = () => setLang({ en: 'hi', hi: 'te', te: 'en' }[st.lang]);
    c.querySelectorAll('button[data-f]').forEach(b => b.onclick = () => { mv.setFloor(b.dataset.f); if (st.mode === 'nav') mv.follow = false; buildFloors(); });
  }
  function onMapSelect(item) {
    if (st.mode === 'nav') return;
    if (!item) { if (st.mode === 'place') { setMode('explore'); mv.setSelected(null); } return; }
    if (item.type === 'room') showPlace({ room: item.id }); else if (item.type === 'poi') showPlace({ poi: item.id });
  }
  function buildExplore() {
    const u = st.user, c = confOf(u);
    $('whereTxt').textContent = `You are on ${fl(u.floor)}`;
    $('whereSub').textContent = `Near ${nearName(u)} · ${u.markerId ? 'anchored by ' + u.markerId : 'approximate position'}`;
    $('confChip').className = 'conf ' + c.cls; $('confChip').textContent = c.txt;
    const qs = [{ room: 'F2-cafeteria' }, { nearest: 'washroom' }, { room: 'F1-everest' }, { room: 'F1-pantry' }, { room: 'F2-wellness' }];
    $('quickList').innerHTML = qs.map((q, i) => {
      let t = q, p;
      if (q.nearest) { const res = IS.intent(V, 'nearest washroom', { from: fromPose(), prefs: st.prefs }); t = res.target; p = placeOf(t); p.name = 'Nearest washroom'; p.icon = '🚻'; p.sub = `${placeOf(t).name} · ${fl(p.floor)}`; } else p = placeOf(t);
      const r = estimate(t);
      return `<div class="qrow" data-i="${i}"><div class="ic">${p.icon}</div><div class="t">${p.name}<small>${p.sub}</small></div><div class="r">${r ? IS.fmtTime(r.time) : '—'}</div></div>`;
    }).join('');
    $('quickList').querySelectorAll('.qrow').forEach((el, i) => el.onclick = () => { const q = qs[i]; const t = q.nearest ? IS.intent(V, 'nearest washroom', { from: fromPose(), prefs: st.prefs }).target : q; showPlace(t); });
    $('qchips').innerHTML = [['🍽️', 'Food'], ['🚻', 'Washrooms'], ['👥', 'Meeting rooms'], ['🛗', 'Lifts'], ['🪜', 'Stairs'], ['🏃', 'Exits']].map(c => `<button class="qchip" data-q="${c[1]}">${c[0]} ${c[1]}</button>`).join('');
    $('qchips').querySelectorAll('.qchip').forEach(b => b.onclick = () => openSearch(b.dataset.q.replace('Meeting rooms', 'Meeting').replace('Washrooms', 'washroom').replace('Exits', 'exit')));
  }

  /* ---------------- search ---------------- */
  function openSearch(q, pickLoc) {
    st.pickLoc = !!pickLoc; overlay('searchOv', true); const inp = $('seInput'); inp.value = q || ''; inp.placeholder = pickLoc ? 'Where are you right now?' : 'Search — try ‘canteen’, ‘khana’, ‘టాయిలెట్’'; renderResults(); setTimeout(() => inp.focus(), 50);
  }
  function renderResults() {
    const q = $('seInput').value.trim(); let rows;
    if (!q) {
      rows = V.rooms.filter(r => r.access !== 'staff').slice().sort((a, b) => (a.cat === 'food' ? -1 : 0) - (b.cat === 'food' ? -1 : 0)).slice(0, 8).map(r => ({ type: 'room', id: r.id, room: r }));
      $('seResults').innerHTML = '<div class="muted small" style="padding:10px 4px">Suggestions</div>';
    } else { rows = IS.search(V, q).slice(0, 12); $('seResults').innerHTML = rows.length ? '' : '<div class="muted" style="padding:24px 8px;text-align:center">No match. Try “canteen”, “toilet”, “Everest”…</div>'; }
    rows.forEach(r => {
      const t = r.type === 'room' ? { room: r.id } : { poi: r.id }, p = placeOf(t), est = st.user && !st.pickLoc ? estimate(t) : null;
      const d = document.createElement('div'); d.className = 'qrow';
      d.innerHTML = `<div class="ic">${p.icon}</div><div class="t">${p.name}<small>${p.sub}${p.obj.access === 'staff' ? ' · 🔒 staff only' : ''}</small></div><div class="r">${est ? IS.fmtTime(est.time) : ''}</div>`;
      d.onclick = () => { overlay('searchOv', false); if (st.pickLoc) { setLocationManually(p); } else showPlace(t); };
      $('seResults').appendChild(d);
    });
  }
  function setLocationManually(p) {
    const r = p.kind === 'room' ? p.obj : null; const x = r ? r.door.x : p.x, y = r ? r.door.y + (r.door.side === 'N' ? 1.2 : -1.2) : p.y;
    st.user = { floor: p.floor, x, y, heading: 90, acc: 4, stale: false, markerId: null, markerAt: 0 };
    st.pickLoc = false; toast('Approximate position set (±4 m). Scan a marker for exact.'); if (st.screen === 'locate') goMap(); else refreshAll();
  }

  /* ---------------- place + route preview ---------------- */
  function showPlace(t) {
    const p = placeOf(t); st.target = t; st.place = p; setMode('place');
    if (mv.floor !== p.floor) mv.setFloor(p.floor);
    mv.setRoute(null, 0); mv.setSelected(p.kind === 'room' ? p.id : null); mv.centerOn(p.x, p.y, 11); buildFloors();
    $('plIcon').textContent = p.icon; $('plName').textContent = p.name; $('plSub').textContent = p.sub;
    const r = estimate(t), tags = [];
    if (p.obj.access === 'staff') tags.push('<span class="badge fail">🔒 Staff only</span>');
    else if (r) tags.push(`<span class="badge info">⏱ ${IS.fmtTime(r.time)} away${r.via ? ' · via ' + r.via : ''}</span>`);
    if (p.hours) tags.push(`<span class="badge gray">🕘 ${p.hours}</span>`);
    if (p.obj.capacity) tags.push(`<span class="badge gray">👥 up to ${p.obj.capacity}</span>`);
    if (r && r.floors.length > 1) tags.push('<span class="badge ok">♿ lift route available</span>');
    $('plTags').innerHTML = tags.join('');
    $('plDirections').disabled = p.obj.access === 'staff';
  }
  function preview() {
    if (!st.target) return; const t = st.target; st.routeFrom = fromPose();
    let opts;
    if (st.prefs.avoidStairs) { const r = IS.route(V, fromPose(), t, { avoidStairs: true }); opts = r && !r.error ? [r] : []; if (r && r.error) return toast(r.error === 'restricted' ? 'That area is staff-only' : 'No route found'); }
    else { const res = IS.alternatives(V, fromPose(), t, st.prefs); if (!res.options.length) return toast(res.error === 'restricted' ? 'That area is staff-only' : 'No route found'); opts = res.options; }
    st.options = opts; st.optIdx = 0; setMode('preview'); applyOption(); $('pvName').textContent = st.place.name; $('pvAvoid').checked = st.prefs.avoidStairs;
    ev('route', `Route requested to ${st.place.name}`);
  }
  function applyOption() {
    const r = st.options[st.optIdx]; st.route = r; st.s = 0; st.routeTarget = st.target; pubRoute(r);
    mv.follow = false; mv.headingUp = false; mv.rot = 0; mv.anchorY = 0.34; mv.setFloor(st.user.floor); mv.setRoute(r, 0); mv.setUser(st.user); buildFloors();
    const pts = r.points.filter(p => p.floor === st.user.floor); const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const bw = Math.max(8, Math.max(...xs) - Math.min(...xs)) + 14, bh = Math.max(8, Math.max(...ys) - Math.min(...ys));
    mv.centerOn((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2, clamp(Math.min((mv.W - 70) / bw, (mv.H * 0.4) / bh), 4, 14));
    $('pvOpts').innerHTML = st.options.map((o, i) => {
      const lbl = o.via === 'stairs' ? '🪜 Via stairs' : o.via === 'lift' ? '🛗 Via lift' : '🚶 Same floor';
      const fast = i === 0 && st.options.length > 1 ? '<span class="badge ok">Fastest</span>' : o.via === 'lift' ? '<span class="badge info">♿ Accessible</span>' : '';
      return `<div class="opt ${i === st.optIdx ? 'on' : ''}" data-i="${i}"><div class="big">${IS.fmtTime(o.time)}</div><div style="flex:1"><b>${lbl}</b> ${fast}<small>${Math.round(o.walkDist)} m walking${o.via ? ' · 1 floor change' : ''}</small></div></div>`;
    }).join('');
    $('pvOpts').querySelectorAll('.opt').forEach(el => el.onclick = () => { st.optIdx = +el.dataset.i; applyOption(); });
    $('pvSteps').innerHTML = r.steps.map((s, i) => `<div><b>${i + 1}</b>${IS.stepAction(s, st.lang)}<span>${s.kind === 'arrive' || s.dist > 0.5 ? Math.round(s.dist) + ' m' : ''}</span></div>`).join('');
  }

  /* ---------------- navigation ---------------- */
  function startNav() {
    if (!st.route) return;
    setMode('nav'); st.s = 0; st.playing = true; st.spoken = {}; st.walked = 0; st.t0 = now(); st.arrived = null; st.trans = null; st.floorPrompt = null;
    mv.setFloor(st.user.floor); mv.follow = true; mv.headingUp = true; mv.anchorY = 0.66; mv.scale = 15; mv.setRoute(st.route, 0); buildFloors();
    $('dPlay').textContent = '⏸ Pause'; ev('nav', `Navigation started → ${st.route.destName} (${IS.fmtTime(st.route.time)}, via ${st.route.via || 'same floor'})`);
    speakStart(); updateBanner(); updateNavBar();
  }
  function speakStart() {
    const R = st.route, first = R.steps[0];
    if (first.initial) speak(IS.stepAction(first, st.lang) + '. ' + IS.thenText(R.steps[1].dist, st.lang) + '.');
    else speak(IS.walkText(first.dist, st.lang) + ', ' + IS.stepAction(first, st.lang).toLowerCase() + '.');
    st.spoken['0:far'] = true;
  }
  function stepIcon(step) { return step.kind === 'turn' ? (step.dir === 'left' ? '↰' : '↱') : step.kind === 'vertical' ? (step.via === 'lift' ? '🛗' : '🪜') : '📍'; }
  function updateBanner() {
    const R = st.route; if (!R) return; const nx = IS.nextStep(R, st.s), step = nx.step;
    const init = step.initial && st.s < 0.3;
    $('bnIco').textContent = stepIcon(step); $('bnDist').textContent = init || nx.remaining < 1.5 ? 'Now' : `${Math.round(nx.remaining)} m`;
    $('bnAct').textContent = IS.stepAction(step, st.lang);
    const nn = R.steps[nx.index + 1];
    $('bnThen').style.display = nn || init ? '' : 'none';
    $('bnThen').textContent = init ? IS.thenText(R.steps[1].dist, st.lang).replace(/^./, c => c.toUpperCase()) : nn ? `Then ${IS.stepAction(nn, st.lang).replace(/^./, c => c.toLowerCase())}` : '';
    $('arIco').textContent = $('bnIco').textContent; $('arDist').textContent = $('bnDist').textContent; $('arAct').textContent = $('bnAct').textContent;
    if (step.kind === 'arrive' && nx.remaining > 1.5) { $('bnAct').textContent = `${st.route.destName} ahead`; $('arAct').textContent = `${st.route.destName} ahead`; }
  }
  function updateNavBar() {
    const R = st.route; if (!R) return; const sec = IS.remainingSec(R, st.s), c = confOf(st.user);
    $('nbEta').textContent = IS.fmtTime(sec); $('nbMeta').textContent = `${Math.round(IS.remainingWalk(R, st.s))} m · arrive ${clock(sec)}`;
    $('navConf').className = 'conf ' + c.cls; $('navConf').textContent = c.txt;
    $('scanBtn').style.display = st.mode === 'nav' && st.user.acc > 1.8 && !st.arOn ? '' : 'none';
  }
  function speakProgress() {
    const R = st.route, nx = IS.nextStep(R, st.s), i = nx.index, step = nx.step;
    const far = `${i}:far`, near = `${i}:near`;
    if (step.kind === 'arrive') return;
    if (nx.remaining <= 15 && !st.spoken[far] && !(step.initial && st.s < 0.3)) { st.spoken[far] = true; speak(IS.stepSpeech(step, st.lang, nx.remaining)); }
    else if (nx.remaining <= 3.5 && !st.spoken[near]) { st.spoken[near] = true; st.spoken[far] = true; speak(IS.stepSpeech(step, st.lang, 0)); }
  }

  function beginTransition(pa) {
    const R = st.route, h = R.hops[pa.hop];
    st.s = R.cum[pa.hop]; st.trans = { hop: pa.hop, via: h.type, t: 0, dur: h.type === 'lift' ? 6 : 4.8, to: R.points[pa.hop + 1].floor };
    $('trIco').textContent = h.type === 'lift' ? '🛗' : '🪜'; $('trTitle').textContent = h.type === 'lift' ? 'Waiting for the lift…' : 'Taking the stairs…';
    $('trSub').textContent = `${fl(R.points[pa.hop].floor)} → ${fl(st.trans.to)}`; $('trBar').style.width = '0%'; overlay('transOv', true);
    speak(IS.stepSpeech(R.steps.find(s => s.kind === 'vertical' && Math.abs(s.sAt - st.s) < 0.6) || R.steps[1], st.lang, 0));
    ev('floor', `Leaving ${fl(R.points[pa.hop].floor)} by ${h.type}`);
  }
  function updateTransition(dt) {
    const T = st.trans; T.t += dt; $('trBar').style.width = Math.min(100, (T.t / T.dur) * 100) + '%';
    if (T.via === 'lift' && T.t > T.dur * 0.45) $('trTitle').textContent = 'Riding the lift…';
    if (T.t >= T.dur) {
      const R = st.route; st.s = R.cum[T.hop + 1] + 0.01; st.trans = null; overlay('transOv', false);
      const pa = IS.pointAt(R, st.s); st.user.floor = pa.floor; st.user.x = pa.x; st.user.y = pa.y; st.user.heading = pa.bearing; st.user.acc = Math.max(st.user.acc, 1.4); st.sinceMarker = 8;
      mv.setFloor(pa.floor); mv.setRoute(R, st.s); buildFloors();
      st.floorPrompt = { floor: pa.floor, until: now() + 3.4 };
      $('fpTitle').textContent = `Are you on ${fl(pa.floor)} now?`;
      $('fpYes').textContent = `Yes, ${fl(pa.floor)}`; $('fpSub').textContent = 'Floors can’t be sensed by a web app — scan the lobby marker or tap Yes.'; overlay('floorOv', true);
    }
  }
  function confirmFloor(how) {
    if (!st.floorPrompt) return; const f = st.floorPrompt.floor; st.floorPrompt = null; overlay('floorOv', false);
    const nm = IS.nearestMarker(V, f, st.user.x, st.user.y, 12);
    if (how === 'marker' && nm) { applyAnchor(nm.marker, false); toast(`📍 ${nm.marker.id} seen at the lobby → ${fl(f)} confirmed`); }
    else { st.user.acc = 1.4; toast(`${fl(f)} confirmed`); }
    ev('floor', `${fl(f)} confirmed (${how === 'marker' ? 'lobby marker' : 'user tap'})`);
    updateBanner();
    const R = st.route, nx = IS.nextStep(R, st.s); if (nx.step.kind !== 'arrive') speak(IS.stepSpeech(nx.step, st.lang, nx.remaining)); st.spoken[`${nx.index}:far`] = true;
  }

  function arrive() {
    const R = st.route; st.arrived = { name: R.destName, floor: R.destFloor, took: now() - st.t0, walked: st.walked };
    st.arOn = false; setMode('explore'); show('s-arrived');
    $('arrTitle').textContent = IS.arrivedText(R.destName, st.lang).replace(/\.$/, ''); $('arrSub').textContent = `${fl(R.destFloor)} · ${st.place ? st.place.sub.split(' · ')[0] : ''}`;
    $('arrStats').innerHTML = `<span class="chip">⏱ ${IS.fmtTime(R.time)}</span><span class="chip">🚶 ${Math.round(R.walkDist)} m</span><span class="chip">📍 ${st.scans} marker scan(s)</span><span class="chip">📣 ${st.impressions} ad(s) seen</span>`;
    speak(IS.arrivedText(R.destName, st.lang)); ev('arrive', `Arrived at ${R.destName}`);
    st.route = null; mv.setRoute(null, 0); mv.follow = false; pubRoute(null);
  }
  function endNav() {
    st.route = null; st.trans = null; st.floorPrompt = null; overlay('transOv', false); overlay('floorOv', false); st.arOn = false; show('s-map'); setMode('explore');
    mv.setRoute(null, 0); mv.follow = false; mv.headingUp = false; mv.rot = 0; mv.anchorY = 0.4; mv.setUser(st.user); mv.centerOn(st.user.x, st.user.y, 9.5); buildFloors(); buildExplore();
    ev('nav', 'Navigation ended'); pubRoute(null);
  }
  function pubRoute(r) { IS.bus.send('route', r ? { id: ++st.routeVer, from: st.routeFrom, target: st.routeTarget, via: r.via, destName: r.destName } : null); }
  function refreshAll() { if (!mv) return; mv.setUser(st.user); buildFloors(); if (st.mode === 'explore') buildExplore(); }

  /* ---------------- simulation tick ---------------- */
  let last = performance.now();
  // Browsers pause requestAnimationFrame in background tabs; a slow timer keeps the walk (and the dashboard feed) alive.
  function frame(tms) { tick(tms); requestAnimationFrame(frame); }
  setInterval(() => { if (document.hidden) tick(performance.now()); }, 400);
  function tick(tms) {
    const dt = Math.min(document.hidden ? 1.2 : 0.06, (tms - last) / 1000); last = tms; const t = tms / 1000;
    try {
      if (st.user && st.mode === 'nav' && st.route && st.screen !== 'arrived') simulate(dt, t);
      if (st.arOn) drawAR(dt, t);
      if (t - st.lastHud > 0.12) { st.lastHud = t; hud(); }
      if (t - st.lastBus > 0.2 && st.user) { st.lastBus = t; publish(); }
      if (t - st.lastDemo > 0.25) { st.lastDemo = t; demoPanel(); }
    } catch (e) { console.error('frame error:', e && e.stack || e); }
  }
  function simulate(dt, t) {
    const R = st.route, u = st.user;
    if (st.offRoute) { if (t > st.offRoute.until) rerouteNow(); return; }
    if (st.trans) { updateTransition(dt); return; }
    if (st.floorPrompt) { if (st.autoConfirm && now() > st.floorPrompt.until) confirmFloor('marker'); else $('fpAuto').textContent = st.autoConfirm ? `Auto-confirming from lobby marker in ${Math.max(0, Math.ceil(st.floorPrompt.until - now()))} s…` : ''; return; }
    const lost = now() < st.lostUntil;
    if (st.playing) { const adv = 1.3 * st.mult * dt; st.s = Math.min(R.total, st.s + adv); st.walked += adv; st.sinceMarker += adv; }
    let pa = IS.pointAt(R, st.s);
    if (pa.vertical) { beginTransition(pa); return; }
    u.x = pa.x; u.y = pa.y; u.floor = pa.floor; u.heading = (u.heading + angDiff(u.heading, pa.bearing) * Math.min(1, dt * 7) + 360) % 360;
    u.stale = lost; u.acc = lost ? Math.min(6, u.acc + dt * 0.8) : clamp(0.3 + 0.05 * st.sinceMarker, 0.3, 3.2);
    // passive re-anchoring only happens when the camera is on (AR mode)
    if (st.arOn && !lost) { const nm = IS.nearestMarker(V, u.floor, u.x, u.y, 2.6); if (nm && (nm.marker.id !== st.lastMarker.id || now() - st.lastMarker.at > 25)) { applyAnchor(nm.marker, false); toast(`📍 Re-anchored by ${nm.marker.id}`); } }
    mv.setUser(u); mv.setProgress(st.s);
    speakProgress(); updateBanner(); updateNavBar();
    if (st.s >= R.total - 0.05) arrive();
  }

  /* ---------------- AR ---------------- */
  function activeCampaigns() {
    const out = []; IS.store.getCampaigns().filter(c => c.status === 'active').forEach(c => c.walls.forEach(w => out.push(Object.assign({}, c, { wall: w }))));
    return out;
  }
  function enterAR() {
    if (!st.user) return; show('s-ar'); st.arOn = true; if (!ar) ar = new IS.ARView($('arcv'), V); ar.resize(); ar.setVenue(V);
    if (!mini) mini = new IS.MapView($('minimap'), V, { floor: st.user.floor, minScale: 4, maxScale: 30, labels: false, layers: { pois: false, labels: false } });
    mini.measure(); mini.follow = true; mini.headingUp = true; mini.anchorY = 0.62; mini.scale = 7; mini.setFloor(st.user.floor); mini.setRoute(st.route, st.s); mini.setUser(st.user);
    st.campaigns = activeCampaigns(); st.lookupAt = now() + 9; $('arPill').style.display = st.route ? '' : 'none';
    ev('ar', 'AR view opened');
  }
  function exitAR() { st.arOn = false; show('s-map'); if (mv) { mv.measure(); mv.render(); } }
  function drawAR(dt, t) {
    const u = st.user; if (!u) return; const R = st.route;
    ar.draw({
      floor: u.floor, x: u.x, y: u.y, heading: u.heading, route: R, progress: st.s, step: R ? IS.nextStep(R, st.s) : null, campaigns: st.campaigns, t, lang: st.lang,
      moving: st.mode === 'nav' && st.playing && !st.trans, dim: !!st.trans || !!st.floorPrompt,
      onAdSeen: (cp, d, frac) => {
        if (d < 10 && frac > 0.01) {
          st.adSeen[cp.id] = (st.adSeen[cp.id] || 0) + dt;
          if (st.adSeen[cp.id] >= 1.0 && now() - (st.adCounted[cp.id] || -999) > 90) { st.adCounted[cp.id] = now(); st.impressions++; IS.store.bump(cp.id, 'impressions'); ev('ad', `Ad impression: ${cp.brand} (${cp.type}) on wall ${cp.wall}`); }
        }
      },
    });
    mini.setFloor(u.floor); mini.setUser(u); if (R) mini.setProgress(st.s);
    if (now() > st.lookupAt && st.mode === 'nav' && st.playing) { st.lookupAt = now() + 30; $('lookup').classList.add('show'); setTimeout(() => $('lookup').classList.remove('show'), 2400); }
  }
  function hud() {
    if (!st.user) return; const c = confOf(st.user), u = st.user;
    if (st.arOn) {
      $('arTrk').className = 'trk ' + (c.cls === 'good' ? '' : c.cls); const ago = u.markerId ? Math.round(now() - st.lastMarker.at) : null;
      $('arTrkT').textContent = u.stale ? 'Tracking lost — move phone slowly or scan a marker' : `Tracking ${c.cls === 'good' ? 'good' : 'drifting'} · ${c.txt}${ago != null ? ` · ${u.markerId} ${ago}s ago` : ''}`;
    }
    if (st.mode === 'explore' && st.screen === 'map') { const ch = confOf(u); $('confChip').className = 'conf ' + ch.cls; $('confChip').textContent = ch.txt; }
  }
  function openAd(id) {
    const cp = IS.store.getCampaigns().find(c => c.id === id); if (!cp) return;
    IS.store.bump(id, 'taps'); ev('ad', `Ad tapped: ${cp.brand}`);
    $('adCard').style.background = `linear-gradient(135deg, ${cp.theme[0]}, ${cp.theme[1]})`;
    $('adCard').innerHTML = `<div class="small" style="font-weight:800;opacity:.85">SPONSORED · ${cp.type.toUpperCase()} · PLACEHOLDER BRAND</div><div style="font-size:13px;font-weight:700;margin-top:8px;opacity:.9">${cp.brand}</div><div style="font-size:24px;font-weight:800;margin:2px 0 8px">${cp.headline}</div><div style="font-size:13.5px">${cp.offer}</div>`;
    $('adCta').textContent = cp.cta; $('adCta').onclick = () => { overlay('adOv', false); if (cp.target) { exitAR(); setMode('explore'); showPlace({ room: cp.target }); preview(); } else toast('Offer saved to your wallet'); };
    overlay('adOv', true);
  }

  /* ---------------- voice ---------------- */
  const MSG = {
    goto: { en: n => `Okay, finding the best route to ${n}.`, hi: n => `Theek hai, ${n} ka sabse accha raasta dhoondh raha hoon.`, te: n => `సరే, ${n} కి ఉత్తమ మార్గాన్ని వెతుకుతున్నాను.` },
    show: { en: (n, f, t) => `${n} is on ${f}, about ${t} away. Tap Directions to go.`, hi: (n, f, t) => `${n} ${f} par hai, lagbhag ${t} door. Raasta jaanne ke liye Directions dabaiye.`, te: (n, f, t) => `${n} ${f} లో ఉంది, సుమారు ${t} దూరంలో. దారి కోసం Directions నొక్కండి.` },
    where: { en: (f, p) => `You are on ${f}, near ${p}.`, hi: (f, p) => `Aap ${f} par hain, ${p} ke paas.`, te: (f, p) => `మీరు ${f} లో ${p} దగ్గర ఉన్నారు.` },
    unknown: { en: () => 'Sorry, I didn’t catch that. Try “Where is the cafeteria?”', hi: () => 'Maaf kijiye, samajh nahi aaya. Try kijiye: “Cafeteria kahan hai?”', te: () => 'క్షమించండి, అర్థం కాలేదు. “క్యాంటీన్ ఎక్కడ ఉంది?” అని ప్రయత్నించండి.' },
    stop: { en: () => 'Navigation ended.', hi: () => 'Navigation band kar diya.', te: () => 'నావిగేషన్ ఆపివేశాను.' },
    pref: { en: () => 'Okay, I’ll avoid stairs.', hi: () => 'Theek hai, seedhiyon se bachenge.', te: () => 'సరే, మెట్లు నివారిస్తాను.' },
    restricted: { en: n => `${n} is staff-only, so I can’t route you there.`, hi: n => `${n} sirf staff ke liye hai, wahan raasta nahi de sakta.`, te: n => `${n} కేవలం సిబ్బందికి మాత్రమే, అక్కడికి మార్గం ఇవ్వలేను.` },
  };
  const EXAMPLES = { en: ['Where is the cafeteria?', 'Take me to Everest meeting room', 'Nearest washroom', 'Avoid stairs', 'Where am I?'], hi: ['Cafeteria kahan hai?', 'Mujhe canteen le chalo', 'Sabse paas ka washroom', 'Main kahan hoon?'], te: ['క్యాంటీన్ ఎక్కడ ఉంది?', 'నన్ను టాయిలెట్ కి తీసుకెళ్ళు', 'నేను ఎక్కడ ఉన్నాను?'] };
  function openVoice() { overlay('voiceOv', true); $('voChat').innerHTML = ''; langUI(); $('voState').textContent = 'Tap to speak'; }
  function bubble(txt, me) { const d = document.createElement('div'); d.className = 'bubble ' + (me ? 'me' : 'bot'); d.textContent = txt; $('voChat').appendChild(d); $('voChat').scrollTop = 1e6; }
  function processVoice(text) {
    text = (text || '').trim(); if (!text) return; bubble(text, true);
    const res = IS.intent(V, text, { from: st.user ? fromPose() : null, prefs: st.prefs }); let reply;
    ev('voice', `Voice: “${text}” → ${res.type}${res.name ? ' · ' + res.name : ''}`);
    if (res.type === 'goto') {
      const rr = IS.route(V, fromPose(), res.target, st.prefs);
      if (rr && rr.error === 'restricted') reply = MSG.restricted[st.lang](rr.name);
      else { reply = MSG.goto[st.lang](res.name); setTimeout(() => { overlay('voiceOv', false); if (st.arOn) exitAR(); if (st.mode === 'nav') endNav(); show('s-map'); setMode('explore'); showPlace(res.target); preview(); }, 1500); }
    } else if (res.type === 'show') {
      const p = placeOf(res.target), r = estimate(res.target); reply = MSG.show[st.lang](p.name, fl(p.floor), r ? IS.fmtTime(r.time) : '—');
      setTimeout(() => { overlay('voiceOv', false); if (st.arOn) exitAR(); show('s-map'); showPlace(res.target); }, 1800);
    } else if (res.type === 'whereami') reply = MSG.where[st.lang](fl(st.user.floor), nearName(st.user));
    else if (res.type === 'repeat') { if (st.route) { const nx = IS.nextStep(st.route, st.s); reply = IS.stepSpeech(nx.step, st.lang, nx.remaining); } else reply = MSG.unknown[st.lang](); }
    else if (res.type === 'stop') { reply = MSG.stop[st.lang](); if (st.mode === 'nav') setTimeout(() => { overlay('voiceOv', false); endNav(); }, 900); }
    else if (res.type === 'pref') { st.prefs.avoidStairs = true; reply = MSG.pref[st.lang](); if (st.mode === 'preview') { $('pvAvoid').checked = true; preview(); } }
    else reply = MSG.unknown[st.lang]();
    setTimeout(() => { bubble(reply, false); speak(reply); }, 350);
  }
  function startListening() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { $('voState').textContent = 'Speech recognition isn’t available in this browser — type or tap an example.'; return; }
    try { rec = new SR(); rec.lang = IS.LANGS[st.lang].speech; rec.interimResults = false; $('voMic').classList.add('listening'); $('voState').textContent = 'Listening…';
      rec.onresult = e => { $('voMic').classList.remove('listening'); $('voState').textContent = 'Tap to speak'; processVoice(e.results[0][0].transcript); };
      rec.onerror = () => { $('voMic').classList.remove('listening'); $('voState').textContent = 'Couldn’t hear that — try typing.'; };
      rec.onend = () => $('voMic').classList.remove('listening'); rec.start(); } catch (e) { $('voState').textContent = 'Microphone unavailable — type instead.'; }
  }

  /* ---------------- language ---------------- */
  function setLang(l) {
    st.lang = l; if ($('langBtnT')) $('langBtnT').textContent = { en: 'EN', hi: 'HI', te: 'తె' }[l]; langUI();
    document.querySelectorAll('#dLang button').forEach(b => b.classList.toggle('on', b.dataset.l === l));
    if (st.route) { updateBanner(); if (st.mode === 'preview') applyOption(); }
  }
  function langUI() {
    document.querySelectorAll('#voLang button').forEach(b => b.classList.toggle('on', b.dataset.l === st.lang));
    $('voEx').innerHTML = EXAMPLES[st.lang].map(e => `<button class="mchip" style="background:#eef2fd;border-color:#d5def8;color:#2f5bea">${e}</button>`).join('');
    $('voEx').querySelectorAll('button').forEach((b, i) => b.onclick = () => processVoice(EXAMPLES[st.lang][i]));
  }

  /* ---------------- wrong turn / reroute ---------------- */
  function wrongTurn() {
    if (st.mode !== 'nav' || !st.route || st.trans) return toast('Start navigation first');
    const u = st.user; if (Math.abs(u.y - 17) > 3) return toast('Wrong-turn demo works while in a corridor');
    const dir = Math.sin((u.heading * Math.PI) / 180) >= 0 ? -1 : 1; // walk the opposite way
    u.x = clamp(u.x + dir * 9, 2, 58); u.y = 17; u.heading = dir > 0 ? 90 : 270; u.acc = 2.4; st.sinceMarker = 30;
    mv.setUser(u); speak({ en: 'You are off the route. Recalculating.', hi: 'Aap route se hat gaye hain. Naya raasta dhoondh raha hoon.', te: 'మీరు మార్గం తప్పారు. కొత్త మార్గం వెతుకుతున్నాను.' }[st.lang]);
    st.offRoute = { until: now() + 1.8 }; $('bnIco').textContent = '⚠️'; $('bnDist').textContent = 'Off route'; $('bnAct').textContent = 'Recalculating…'; $('bnThen').style.display = 'none'; ev('offroute', `Off route by ~9 m — rerouting to ${st.route.destName}`);
  }
  function replan() {
    const dest = st.route.destRoom ? { room: st.route.destRoom } : st.target; if (!dest) return;
    st.routeFrom = fromPose(); const r = IS.route(V, st.routeFrom, dest, st.prefs); if (!r || r.error) return;
    st.route = r; st.s = 0; st.spoken = {}; st.routeTarget = dest; pubRoute(r);
    mv.setRoute(r, 0); if (st.mode === 'preview') { st.options = [r]; st.optIdx = 0; applyOption(); } else if (st.mode === 'nav') { mv.setFloor(st.user.floor); speakStart(); }
    toast('Route updated from your new position');
  }
  function rerouteNow() {
    st.offRoute = null; const dest = st.routeTarget || { room: st.route.destRoom }; st.routeFrom = fromPose(); const r = IS.route(V, st.routeFrom, dest, st.prefs);
    if (!r || r.error) return toast('Could not reroute'); st.route = r; st.s = 0; st.spoken = {}; st.routeTarget = dest; pubRoute(r);
    mv.setRoute(r, 0); toast('✔ New route found'); ev('reroute', `Rerouted — ${IS.fmtTime(r.time)} remaining`); speakStart();
  }

  /* ---------------- dashboard feed + demo panel ---------------- */
  function publish() {
    const u = st.user, R = st.route; let nxt = null, rem = null;
    if (R && st.mode === 'nav') { const nx = IS.nextStep(R, st.s); nxt = IS.stepAction(nx.step, st.lang); rem = Math.round(nx.remaining); }
    IS.bus.send('pose', { t: Date.now(), screen: st.screen, mode: st.mode, ar: st.arOn, user: u, s: st.s, total: R ? R.total : 0, next: nxt, nextDist: rem, eta: R ? IS.remainingSec(R, st.s) : null, dest: R ? R.destName : null, lang: st.lang, scans: st.scans, impressions: st.impressions, walked: st.walked, playing: st.playing, trans: st.trans ? st.trans.via : null, venue: V.name });
  }
  function demoPanel() {
    const u = st.user, R = st.route; const kv = $('dKV'); if (!kv) return;
    const rows = [['Screen', `${st.screen} · ${st.mode}${st.arOn ? ' · AR' : ''}`], ['Floor', u ? fl(u.floor) : '—'], ['Position', u ? `${u.x.toFixed(1)}, ${u.y.toFixed(1)} m` : '—'], ['Heading', u ? Math.round(u.heading) + '°' : '—'], ['Accuracy', u ? confOf(u).txt : '—'], ['Anchored by', u && u.markerId ? `${u.markerId} · ${Math.round(now() - st.lastMarker.at)} s ago` : 'none'], ['Progress', R ? `${st.s.toFixed(1)} / ${R.total.toFixed(1)}` : '—'], ['Route', R ? `${R.via || 'same floor'} · ${IS.fmtTime(R.time)}` : '—']];
    kv.innerHTML = rows.map(r => `<b>${r[0]}</b><span>${r[1]}</span>`).join('');
  }

  /* ---------------- wiring ---------------- */
  function wire() {
    buildCity();
    $('scanBtn').className = 'fab wide'; $('scanBtn').style.cssText = 'left:12px;bottom:96px;display:none'; $('scanBtn').textContent = '📍 Fix position';
    $('manualLoc').onclick = () => { openSearch('', true); };
    $('mapPill').onclick = e => { if (e.target.id !== 'mapMic') openSearch(''); };
    $('mapMic').onclick = e => { e.stopPropagation(); openVoice(); };
    $('seBack').onclick = () => { overlay('searchOv', false); st.pickLoc = false; };
    $('seInput').oninput = renderResults;
    $('seMic').onclick = () => { overlay('searchOv', false); openVoice(); };
    $('plClose').onclick = () => { setMode('explore'); mv.setSelected(null); };
    $('plDirections').onclick = preview;
    $('plSave').onclick = () => toast('Saved to your places');
    $('pvClose').onclick = () => { st.route = null; mv.setRoute(null, 0); pubRoute(null); showPlace(st.target); };
    $('pvStart').onclick = startNav;
    $('pvAvoid').onchange = e => { st.prefs.avoidStairs = e.target.checked; preview(); };
    $('navEnd').onclick = endNav;
    $('navAR').onclick = enterAR; $('expAR').onclick = enterAR;
    $('navMic').onclick = openVoice;
    $('navMute').onclick = () => { st.muted = !st.muted; $('navMute').textContent = st.muted ? '🔇' : '🔊'; $('dMute').checked = st.muted; toast(st.muted ? 'Voice muted (captions stay on)' : 'Voice on'); };
    $('navRecenter').onclick = () => { mv.follow = true; mv.headingUp = true; mv.setFloor(st.user.floor); buildFloors(); };
    $('expLocate').onclick = () => { mv.setFloor(st.user.floor); mv.centerOn(st.user.x, st.user.y, 10); buildFloors(); };
    $('scanBtn').onclick = () => { const nm = IS.nearestMarker(V, st.user.floor, st.user.x, st.user.y, 7); if (nm) { applyAnchor(nm.marker, false); toast(`✅ ${nm.marker.id} scanned — position fixed (±0.3 m)`); } else toast('No marker nearby — look for a sticker on a wall'); };
    $('arBack').onclick = exitAR;
    $('arMic').onclick = openVoice;
    $('arScan').onclick = () => { const nm = IS.nearestMarker(V, st.user.floor, st.user.x, st.user.y, 6); if (nm) { applyAnchor(nm.marker, false); toast(`✅ ${nm.marker.id} detected — re-anchored (±0.3 m)`); } else toast('No marker in view — walk towards a sticker'); };
    $('arcv').onclick = e => { const r = $('arcv').getBoundingClientRect(); const id = ar.hitTest(e.clientX - r.left, e.clientY - r.top); if (id) openAd(id); };
    let dragX = null; $('arcv').onpointerdown = e => { dragX = e.clientX; }; $('arcv').onpointermove = e => { if (dragX == null || (st.mode === 'nav' && st.playing)) return; st.user.heading = (st.user.heading + (e.clientX - dragX) * 0.3 + 360) % 360; dragX = e.clientX; }; window.addEventListener('pointerup', () => (dragX = null));
    $('adClose').onclick = $('adDim').onclick = () => overlay('adOv', false);
    $('voDim').onclick = () => overlay('voiceOv', false);
    $('voMic').onclick = startListening;
    $('voSend').onclick = () => { processVoice($('voInput').value); $('voInput').value = ''; };
    $('voInput').onkeydown = e => { if (e.key === 'Enter') $('voSend').onclick(); };
    document.querySelectorAll('#voLang button').forEach(b => b.onclick = () => setLang(b.dataset.l));
    $('fpYes').onclick = () => confirmFloor('tap'); $('fpScan').onclick = () => confirmFloor('marker');
    $('arrAgain').onclick = () => { show('s-map'); goMap(); openSearch(''); };
    $('arrDone').onclick = () => { goMap(); };
    // demo panel
    $('dMarker').innerHTML = V.markers.map(m => `<option value="${m.id}">${m.id} · ${fl(m.floor)} · ${m.name}</option>`).join('');
    $('dScan').onclick = () => { if (st.screen === 'city') openLocate(); scanMarker($('dMarker').value, st.screen === 'locate' || st.screen === 'city'); };
    $('dPlay').onclick = () => { st.playing = !st.playing; $('dPlay').textContent = st.playing ? '⏸ Pause' : '▶ Play'; };
    document.querySelectorAll('#dSpeed button').forEach(b => b.onclick = () => { st.mult = +b.dataset.m; document.querySelectorAll('#dSpeed button').forEach(x => x.classList.toggle('on', x === b)); });
    document.querySelectorAll('#dLang button').forEach(b => b.onclick = () => setLang(b.dataset.l));
    $('dAuto').onchange = e => (st.autoConfirm = e.target.checked);
    $('dMute').onchange = e => { st.muted = e.target.checked; $('navMute').textContent = st.muted ? '🔇' : '🔊'; };
    $('dNext').onclick = () => { if (st.mode !== 'nav' || !st.route) return toast('Start navigation first'); const nx = IS.nextStep(st.route, st.s); if (nx.step.sAt - 5 > st.s) st.s = nx.step.sAt - 5; };
    $('dWrong').onclick = wrongTurn;
    $('dLose').onclick = () => { st.lostUntil = now() + 5; toast('📡 Tracking lost for 5 s — drift grows; scan a marker to fix'); ev('tracking', 'Tracking lost (simulated)'); };
    $('dOpenDash').onclick = () => window.open('dashboard.html', 'is-dashboard', 'width=1280,height=820');
    $('dReset').onclick = () => { IS.store.resetAll(); location.href = 'nav.html'; };
    // fit phone to window
    const fit = () => { const k = Math.min(1, (window.innerHeight - 54 - 28) / 836); $('phoneWrap').style.setProperty('--k', k.toFixed(3)); };
    fit(); window.addEventListener('resize', fit);
    if ('speechSynthesis' in window) speechSynthesis.getVoices();
    setLang('en'); setMode('explore');
  }

  /* ---------------- deep links for demos / screenshots: nav.html#map | #preview | #nav | #ar | #arturn | #voice | #search ---------------- */
  function autoState(h) {
    if (!h) return;
    scanMarker('M01', true);
    if (h === 'map') return;
    if (h === 'search') return openSearch('can');
    if (h === 'voice') { openVoice(); return setTimeout(() => processVoice('Cafeteria kahan hai?'), 100); }
    showPlace({ room: 'F2-cafeteria' }); if (h === 'place') return;
    preview(); if (h === 'preview') return;
    startNav(); if (h === 'nav') { st.s = 6; return; }
    if (h === 'navf2') { st.s = 40; return; }
    if (h.startsWith('ar')) { st.s = h === 'arturn' ? 6 : h === 'arad' ? 4 : h === 'arf2' ? 50 : 1; const pa = IS.pointAt(st.route, st.s); Object.assign(st.user, { x: pa.x, y: pa.y, floor: pa.floor, heading: pa.bearing }); mv.setUser(st.user); st.playing = false; $('dPlay').textContent = '▶ Play'; enterAR(); }
  }
  wire(); requestAnimationFrame(frame);
  autoState((location.hash || '').slice(1));
})();
