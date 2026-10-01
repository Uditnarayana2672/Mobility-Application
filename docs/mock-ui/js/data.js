/* Indore Spaces — venue data, storage and cross-tab bus.
   The default venue is a PLACEHOLDER for the user's real office (2 accessible floors).
   Units are metres. x = east, y = south (screen-style), bearing 0 = north (up), clockwise. */
(function (g) {
  const IS = (g.IS = g.IS || {});

  IS.CATS = {
    reception:  { label: 'Reception',     fill: '#dbe7fd', stroke: '#7aa2f0', icon: '🛎️' },
    meeting:    { label: 'Meeting room',  fill: '#d5eedd', stroke: '#6fbf8b', icon: '👥' },
    workspace:  { label: 'Workspace',     fill: '#eceff3', stroke: '#a9b4c2', icon: '💻' },
    food:       { label: 'Food & drink',  fill: '#fde4cf', stroke: '#f0a35e', icon: '🍽️' },
    washroom:   { label: 'Washroom',      fill: '#d0edf3', stroke: '#59b8cc', icon: '🚻' },
    vertical:   { label: 'Lift & stairs', fill: '#e5dcf6', stroke: '#9b82d6', icon: '🛗' },
    restricted: { label: 'Restricted',    fill: '#f8d7da', stroke: '#d9707a', icon: '🔒' },
    training:   { label: 'Training',      fill: '#fff0c4', stroke: '#e3bd4c', icon: '🎓' },
    admin:      { label: 'Admin',         fill: '#e0e4f7', stroke: '#8d98d8', icon: '🗂️' },
    wellness:   { label: 'Wellness',      fill: '#d9f0e0', stroke: '#69b98a', icon: '🧘' },
  };

  IS.POI_KINDS = {
    entrance: { icon: '🚪', label: 'Main entrance' },
    exit:     { icon: '🏃', label: 'Fire exit' },
    water:    { icon: '💧', label: 'Drinking water' },
    printer:  { icon: '🖨️', label: 'Printer' },
    coffee:   { icon: '☕', label: 'Coffee counter' },
    firstaid: { icon: '🩺', label: 'First aid' },
    atm:      { icon: '🏧', label: 'ATM' },
  };

  /* ---------- default venue ---------- */
  IS.defaultVenue = function () {
    const CY = 17; // corridor centre line
    const v = {
      id: 'office-hq',
      name: 'Demo Office · Tower A',
      type: 'Office / Tech park',
      city: 'Indore',
      address: 'Placeholder address, Indore (replace with your office)',
      latlng: [22.7196, 75.8577],
      version: 1,
      status: 'published',
      scale: { metersPerUnit: 1, calibrated: true, reference: 'Corridor length 60 m (placeholder)' },
      floors: [
        { id: 'F1', name: 'Floor 1', short: '1', elevation: 0, w: 60, h: 36 },
        { id: 'F2', name: 'Floor 2', short: '2', elevation: 4, w: 60, h: 36 },
      ],
      corridors: [
        { floor: 'F1', x: 0, y: 15, w: 60, h: 4 },
        { floor: 'F2', x: 0, y: 15, w: 60, h: 4 },
      ],
      rooms: [], nodes: [], edges: [], markers: [], walls: [], pois: [],
    };

    const R = (id, floor, name, cat, x, y, w, h, extra) => {
      const side = y + h === 15 ? 'N' : 'S';
      v.rooms.push(Object.assign({
        id, floor, name, cat, x, y, w, h,
        door: { x: x + w / 2, y: side === 'N' ? 15 : 19, side },
        aliases: [], hours: '9:00 – 19:00', access: 'public', short: null,
      }, extra || {}));
    };

    // Floor 1
    R('F1-reception', 'F1', 'Reception & Lobby', 'reception', 0, 0, 14, 15, { short: 'Reception', aliases: ['reception', 'lobby', 'front desk', 'रिसेप्शन', 'రిసెప్షన్'] });
    R('F1-everest', 'F1', 'Meeting Room Everest', 'meeting', 14, 0, 12, 15, { short: 'Everest', capacity: 10, aliases: ['everest', 'meeting', 'एवरेस्ट', 'ఎవరెస్ట్'] });
    R('F1-kailash', 'F1', 'Meeting Room Kailash', 'meeting', 26, 0, 12, 15, { short: 'Kailash', capacity: 8, aliases: ['kailash', 'kailas', 'meeting', 'కైలాష్'] });
    R('F1-wsa', 'F1', 'Open Workspace A', 'workspace', 38, 0, 22, 15, { short: 'Workspace A', hours: '24×7 (card access)', aliases: ['workspace', 'desk', 'bay', 'my desk', 'work area', 'వర్క్‌స్పేస్'] });
    R('F1-wash', 'F1', 'Washrooms', 'washroom', 0, 19, 9, 17, { hours: '24×7', aliases: ['washroom', 'toilet', 'restroom', 'bathroom', 'loo', 'shauchalay', 'वॉशरूम', 'టాయిలెట్', 'వాష్‌రూమ్', 'బాత్రూమ్'] });
    R('F1-lift', 'F1', 'Lift Lobby (Lifts A & B)', 'vertical', 9, 19, 10, 17, { short: 'Lifts', icon: '🛗', kind: 'lift', hours: '24×7', aliases: ['lift', 'elevator', 'లిఫ్ట్', 'लिफ्ट'] });
    R('F1-stairs', 'F1', 'Staircase S1', 'vertical', 19, 19, 8, 17, { short: 'Stairs S1', icon: '🪜', kind: 'stairs', hours: '24×7', aliases: ['stairs', 'staircase', 'seedhi', 'seedhiyan', 'మెట్లు', 'सीढ़ी'] });
    R('F1-pantry', 'F1', 'Pantry', 'food', 27, 19, 10, 17, { aliases: ['pantry', 'tea', 'chai', 'coffee', 'water', 'चाय', 'పాంట్రీ', 'టీ'] });
    R('F1-training', 'F1', 'Training Room', 'training', 37, 19, 12, 17, { short: 'Training', capacity: 24, aliases: ['training', 'classroom', 'ట్రైనింగ్'] });
    R('F1-server', 'F1', 'Server Room', 'restricted', 49, 19, 11, 17, { short: 'Server', access: 'staff', hours: 'Staff only', aliases: ['server', 'data room', 'సర్వర్'] });

    // Floor 2
    R('F2-himalaya', 'F2', 'Meeting Room Himalaya', 'meeting', 0, 0, 14, 15, { short: 'Himalaya', capacity: 12, aliases: ['himalaya', 'meeting', 'హిమాలయ'] });
    R('F2-cafeteria', 'F2', 'Cafeteria', 'food', 14, 0, 24, 15, { hours: '8:00 – 20:00', aliases: ['cafeteria', 'canteen', 'cafe', 'food', 'khana', 'bhojan', 'lunch', 'tiffin', 'कैंटीन', 'खाना', 'కేఫ్‌టేరియా', 'క్యాంటీన్', 'క్యాంటిన్', 'భోజనం', 'కేఫ్'] });
    R('F2-hr', 'F2', 'HR & Admin', 'admin', 38, 0, 10, 15, { short: 'HR', aliases: ['hr', 'human resources', 'admin', 'హెచ్ఆర్'] });
    R('F2-wsb', 'F2', 'Open Workspace B', 'workspace', 48, 0, 12, 15, { short: 'Workspace B', hours: '24×7 (card access)', aliases: ['workspace', 'desk', 'bay', 'work area', 'వర్క్‌స్పేస్'] });
    R('F2-wash', 'F2', 'Washrooms', 'washroom', 0, 19, 9, 17, { hours: '24×7', aliases: ['washroom', 'toilet', 'restroom', 'bathroom', 'loo', 'shauchalay', 'वॉशरूम', 'టాయిలెట్', 'వాష్‌రూమ్', 'బాత్రూమ్'] });
    R('F2-lift', 'F2', 'Lift Lobby (Lifts A & B)', 'vertical', 9, 19, 10, 17, { short: 'Lifts', icon: '🛗', kind: 'lift', hours: '24×7', aliases: ['lift', 'elevator', 'లిఫ్ట్', 'लिफ्ट'] });
    R('F2-stairs', 'F2', 'Staircase S1', 'vertical', 19, 19, 8, 17, { short: 'Stairs S1', icon: '🪜', kind: 'stairs', hours: '24×7', aliases: ['stairs', 'staircase', 'seedhi', 'seedhiyan', 'మెట్లు', 'सीढ़ी'] });
    R('F2-pantry', 'F2', 'Pantry', 'food', 27, 19, 10, 17, { aliases: ['pantry', 'tea', 'chai', 'coffee', 'water', 'चाय', 'పాంట్రీ', 'టీ'] });
    R('F2-quiet', 'F2', 'Phone Booths & Quiet Zone', 'workspace', 37, 19, 12, 17, { short: 'Quiet Zone', aliases: ['quiet', 'phone booth', 'call'] });
    R('F2-wellness', 'F2', 'Wellness Room', 'wellness', 49, 19, 11, 17, { short: 'Wellness', aliases: ['wellness', 'yoga', 'rest', 'meditation', 'వెల్నెస్'] });

    // Markers (QR/ArUco stickers). normal = bearing the sticker faces (into the corridor).
    const M = (id, floor, name, x, y, normal, note) => v.markers.push({ id, floor, name, x, y, z: 1.4, normal, note: note || '' });
    M('M01', 'F1', 'Main entrance / Reception', 3, 15, 180, 'On reception wall beside the entrance');
    M('M02', 'F1', 'Lift lobby (Floor 1)', 11, 19, 0, 'Beside the lift lobby doorway');
    M('M03', 'F1', 'Stairs door (Floor 1)', 21, 19, 0, 'Next to the staircase door');
    M('M04', 'F1', 'East corridor junction', 45, 15, 180, 'Outside Open Workspace A');
    M('M05', 'F2', 'Stairs door (Floor 2)', 21, 19, 0, 'Next to the staircase door');
    M('M06', 'F2', 'Lift lobby (Floor 2)', 11, 19, 0, 'Beside the lift lobby doorway');
    M('M07', 'F2', 'Cafeteria entrance', 29, 15, 180, 'On the wall beside the cafeteria door');
    M('M08', 'F2', 'East corridor junction', 45, 15, 180, 'Outside HR & Admin');

    // Wall ad slots (surveyed blank walls). normal = bearing the wall faces.
    const W = (id, floor, label, x1, y1, x2, y2, normal) => v.walls.push({ id, floor, label, x1, y1, x2, y2, normal, bottom: 1.0, height: 1.6, approved: true });
    W('W01', 'F1', 'Blank wall outside Everest', 15, 15, 18, 15, 180);
    W('W02', 'F1', 'Corridor wall near Training Room', 38.5, 19, 41.5, 19, 0);
    W('W03', 'F2', 'Wall near Cafeteria (south side)', 28, 19, 31, 19, 0);

    // POIs
    const P = (id, floor, kind, name, x, y) => v.pois.push({ id, floor, kind, name, x, y });
    P('P01', 'F1', 'entrance', 'Main Entrance', 1, 17);
    P('P02', 'F1', 'water', 'Water cooler', 33, 16);
    P('P03', 'F1', 'printer', 'Printer', 41, 16);
    P('P04', 'F1', 'exit', 'Fire exit', 59, 17);
    P('P05', 'F2', 'coffee', 'Coffee counter', 30, 3);
    P('P06', 'F2', 'water', 'Water cooler', 33, 16);
    P('P07', 'F2', 'exit', 'Fire exit', 59, 17);
    P('P08', 'F2', 'firstaid', 'First aid', 44, 16);

    // Walk network (what the editor's "Walk path" tool produces)
    const xsByFloor = {};
    v.floors.forEach(f => (xsByFloor[f.id] = new Set([0, 60])));
    v.rooms.forEach(r => xsByFloor[r.floor].add(r.door.x));
    v.markers.forEach(m => xsByFloor[m.floor].add(m.x));
    v.floors.forEach(f => {
      const xs = [...xsByFloor[f.id]].sort((a, b) => a - b);
      xs.forEach(x => v.nodes.push({ id: `${f.id}:c${x}`, floor: f.id, x, y: CY, kind: 'corridor' }));
      for (let i = 0; i < xs.length - 1; i++) v.edges.push({ a: `${f.id}:c${xs[i]}`, b: `${f.id}:c${xs[i + 1]}`, type: 'walk' });
    });
    v.rooms.forEach(r => {
      v.nodes.push({ id: `${r.id}:door`, floor: r.floor, x: r.door.x, y: r.door.y, kind: 'door', room: r.id });
      v.nodes.push({ id: r.id, floor: r.floor, x: r.x + r.w / 2, y: r.y + r.h / 2, kind: 'room', room: r.id });
      v.edges.push({ a: `${r.floor}:c${r.door.x}`, b: `${r.id}:door`, type: 'walk' });
      v.edges.push({ a: `${r.id}:door`, b: r.id, type: 'walk' });
    });
    // vertical links
    v.edges.push({ a: 'F1-stairs', b: 'F2-stairs', type: 'stairs', len: 6, upSec: 18, downSec: 12 });
    v.edges.push({ a: 'F1-lift', b: 'F2-lift', type: 'lift', len: 6, upSec: 44, downSec: 44 });
    return v;
  };

  /* ---------- default ad campaigns (placeholder brands) ---------- */
  IS.defaultCampaigns = function () {
    return [
      { id: 'C1', name: 'Fresh Brews launch', brand: 'BrewBox Coffee', type: 'video', theme: ['#ff7a18', '#af002d'], headline: 'Fresh brews. 2nd cup free.', offer: 'Show this screen at the Cafeteria coffee counter — 2nd cup free until 6 PM.', cta: 'Route to Cafeteria', target: 'F2-cafeteria', walls: ['W01'], status: 'active', start: '2026-10-01', end: '2026-12-31', hours: '09:00–19:00', budget: 12000, stats: { impressions: 412, taps: 37, dwell: 6.4 } },
      { id: 'C2', name: 'Join the 6 AM club', brand: 'FitNova Fitness', type: 'image', theme: ['#4facfe', '#00c6a7'], headline: '30% off annual membership', offer: 'Corporate members get 30% off. Walk-in trial pass at the front desk.', cta: 'Learn more', target: null, walls: ['W02'], status: 'active', start: '2026-10-01', end: '2026-11-30', hours: '09:00–21:00', budget: 8000, stats: { impressions: 233, taps: 12, dwell: 3.1 } },
      { id: 'C3', name: 'Lunch combo', brand: 'SnackHub', type: 'image', theme: ['#f7971e', '#ffd200'], headline: 'Lunch combo ₹99', offer: 'Thali + chaas at the Cafeteria, 12–3 PM. Placeholder offer.', cta: 'Route to Cafeteria', target: 'F2-cafeteria', walls: ['W03'], status: 'active', start: '2026-10-01', end: '2026-12-31', hours: '11:30–15:30', budget: 5000, stats: { impressions: 158, taps: 21, dwell: 4.2 } },
    ];
  };

  /* ---------- storage (localStorage with in-memory fallback) ---------- */
  const mem = {};
  function lsGet(k) { try { const s = g.localStorage.getItem(k); return s == null ? (mem[k] ?? null) : s; } catch (e) { return mem[k] ?? null; } }
  function lsSet(k, val) { mem[k] = val; try { g.localStorage.setItem(k, val); } catch (e) { /* ignore */ } }
  function lsDel(k) { delete mem[k]; try { g.localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  const parse = s => { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } };

  IS.store = {
    getPublished() { return parse(lsGet('is.venue.published')) || IS.defaultVenue(); },
    getDraft() { return parse(lsGet('is.venue.draft')) || this.getPublished(); },
    hasDraft() { return !!lsGet('is.venue.draft'); },
    saveDraft(v) { v.status = 'draft'; lsSet('is.venue.draft', JSON.stringify(v)); },
    publish(v) {
      const prev = parse(lsGet('is.venue.published'));
      v.version = (prev ? prev.version : 1) + 1; v.status = 'published'; v.publishedAt = new Date().toISOString();
      lsSet('is.venue.published', JSON.stringify(v)); lsDel('is.venue.draft');
      return v;
    },
    resetVenue() { lsDel('is.venue.published'); lsDel('is.venue.draft'); },
    getCampaigns() { return parse(lsGet('is.campaigns')) || IS.defaultCampaigns(); },
    saveCampaigns(c) { lsSet('is.campaigns', JSON.stringify(c)); },
    bump(campaignId, key, by) {
      const cs = this.getCampaigns(); const c = cs.find(x => x.id === campaignId);
      if (c) { c.stats[key] = +(c.stats[key] + (by == null ? 1 : by)).toFixed(1); this.saveCampaigns(cs); }
    },
    resetAll() { ['is.venue.published', 'is.venue.draft', 'is.campaigns', 'is.live.pose', 'is.live.route', 'is.live.event'].forEach(lsDel); },
  };

  /* ---------- cross-tab bus (phone view -> laptop dashboard) ---------- */
  const listeners = {};
  let bc = null;
  try { bc = new BroadcastChannel('indore-spaces'); } catch (e) { bc = null; }
  const seen = new Set();
  function dispatch(msg) { if (!msg || seen.has(msg.id)) return; seen.add(msg.id); if (seen.size > 200) seen.delete(seen.values().next().value); (listeners[msg.type] || []).forEach(fn => fn(msg.payload)); }
  if (bc) bc.onmessage = e => dispatch(e.data);
  try {
    g.addEventListener('storage', e => {
      if (e.key === 'is.bus' && e.newValue) { const m = parse(e.newValue); if (m) dispatch(m); }
    });
  } catch (e) { /* node */ }
  IS.bus = {
    send(type, payload) {
      const msg = { type, payload, t: Date.now(), id: Math.random().toString(36).slice(2) };
      if (bc) bc.postMessage(msg);
      lsSet('is.bus', JSON.stringify(msg));
      lsSet('is.live.' + type, JSON.stringify(msg));
    },
    on(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
  };

  /* ---------- tiny UI helpers shared by laptop pages ---------- */
  IS.toast = function (msg, ms) {
    if (typeof document === 'undefined') return;
    let w = document.querySelector('.toast-wrap');
    if (!w) { w = document.createElement('div'); w.className = 'toast-wrap'; document.body.appendChild(w); }
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; w.appendChild(t);
    setTimeout(() => t.remove(), ms || 2800);
  };
  IS.topbar = function (active) {
    const links = [['index.html', 'Home', 'home'], ['nav.html', 'Visitor app', 'nav'], ['owner.html', 'Owner portal', 'owner'], ['editor.html', 'Map editor', 'editor'], ['ads.html', 'Ads portal', 'ads'], ['markers.html', 'Marker sheet', 'markers'], ['dashboard.html', 'Live dashboard', 'dashboard']];
    return `<div class="topbar"><a class="brand" href="index.html"><i></i>Indore Spaces</a>${links.map(l => `<a class="nav ${l[2] === active ? 'on' : ''}" href="${l[0]}">${l[1]}</a>`).join('')}<div class="right"><span>Mock UI · demo data</span></div></div>`;
  };
})(typeof window !== 'undefined' ? window : globalThis);
