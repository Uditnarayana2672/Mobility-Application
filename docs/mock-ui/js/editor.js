/* Indore Spaces — map editor (venue-owner tool). Edits the venue package, validates it, and publishes it to the visitor app. */
(function () {
  'use strict';
  const IS = window.IS, $ = id => document.getElementById(id);
  let V = IS.store.getDraft(), floor = V.floors[0].id, tool = 'select', sel = null, chain = null, drag = null, roomDraft = null, scaleA = null, tab = 'props';
  const hist = [JSON.stringify(V)]; let hi = 0, saveT = null;
  const fl = id => (V.floors.find(f => f.id === id) || {}).name || id;
  const round1 = n => Math.round(n * 10) / 10;
  const uid = p => p + Math.random().toString(36).slice(2, 6);

  const TOOLS = [
    ['select', '🖱️', 'Select', 'Click an item to edit it. Drag markers to move them. Drag the canvas to pan, scroll to zoom.'],
    ['room', '▭', 'Room', 'Drag a rectangle to draw a room. (Polygon rooms arrive in the real editor.) A new room is NOT walkable until you connect it.'],
    ['walk', '〰️', 'Walk path', 'Click along the corridor centre-line to lay walkable nodes. Click near an existing node to join it. Esc / double-click ends the chain.'],
    ['marker', '▣', 'Marker', 'Click a wall to place a printable QR/ArUco marker sticker. Each one fixes position, direction and floor for visitors.'],
    ['wall', '🖼️', 'Ad slot', 'Click a blank wall to add a surveyed ad slot (never over doors, exits or signs).'],
    ['poi', '📍', 'POI', 'Click to drop a point of interest (water, printer, exit…).'],
    ['scale', '📏', 'Scale', 'Click two points on something you measured in real life, then enter its length in metres.'],
  ];
  const LAYERS = [['underlay', 'Floor-plan photo'], ['grid', 'Grid'], ['walknet', 'Walk network'], ['markers', 'Markers'], ['walls', 'Ad slots'], ['labels', 'Labels']];
  const layers = { underlay: true, grid: true, walknet: true, markers: true, walls: true, pois: true, labels: true };

  const mv = new IS.MapView($('canvas'), V, { floor, minScale: 3, maxScale: 40, layers, onSelect, onPointer });
  let live = null; // temp preview svg
  const NS = 'http://www.w3.org/2000/svg';

  /* ---------- history / persistence ---------- */
  function commit(label) {
    hist.length = hi + 1; hist.push(JSON.stringify(V)); if (hist.length > 60) hist.shift(); hi = hist.length - 1;
    $('saveState').textContent = 'Saving…'; clearTimeout(saveT); saveT = setTimeout(() => { IS.store.saveDraft(V); $('saveState').textContent = 'All changes saved to draft'; }, 250);
    refresh(true);
  }
  function restore(i) { hi = i; V = JSON.parse(hist[i]); mv.setVenue(V); sel = null; IS.store.saveDraft(V); refresh(true); }
  $('undo').onclick = () => { if (hi > 0) restore(hi - 1); };
  $('redo').onclick = () => { if (hi < hist.length - 1) restore(hi + 1); };
  $('resetBtn').onclick = () => { if (confirm('Discard the draft and reload the sample office?')) { IS.store.resetVenue(); location.reload(); } };

  /* ---------- toolbar / layers / floors ---------- */
  function buildTools() {
    $('tools').innerHTML = TOOLS.map((t, i) => `<button class="tool ${t[0] === tool ? 'on' : ''} ${i === 6 ? 'sep' : ''}" data-t="${t[0]}" title="${t[2]}"><span>${t[1]}</span><small>${t[2]}</small></button>`).join('');
    $('tools').querySelectorAll('.tool').forEach(b => b.onclick = () => setTool(b.dataset.t));
    $('hint').textContent = TOOLS.find(t => t[0] === tool)[3];
    mv.c.style.cursor = tool === 'select' ? '' : 'crosshair';
  }
  function setTool(t) { tool = t; chain = null; scaleA = null; clearLive(); buildTools(); renderProps(); }
  function buildLayers() {
    $('layerBar').innerHTML = LAYERS.map(l => `<label class="pill-sw"><input type="checkbox" data-l="${l[0]}" ${layers[l[0]] ? 'checked' : ''}>${l[1]}</label>`).join('') + `<span class="muted small" style="margin-left:6px">POI icon:</span><select id="poiKind" style="width:auto;padding:3px 6px;font-size:12px">${Object.entries(IS.POI_KINDS).map(([k, v]) => `<option value="${k}">${v.icon} ${v.label}</option>`).join('')}</select>`;
    $('layerBar').querySelectorAll('input').forEach(i => i.onchange = () => { layers[i.dataset.l] = i.checked; mv.layers[i.dataset.l] = i.checked; mv.build(); reselect(); });
  }
  function buildFloors() {
    $('floorSeg').innerHTML = V.floors.map(f => `<button data-f="${f.id}" class="${f.id === floor ? 'on' : ''}">${f.name}</button>`).join('');
    $('floorSeg').querySelectorAll('button').forEach(b => b.onclick = () => { floor = b.dataset.f; chain = null; mv.setFloor(floor); mv.fit(); buildFloors(); reselect(); });
  }
  $('addFloor').onclick = () => {
    const n = V.floors.length + 1, id = 'F' + n; V.floors.push({ id, name: 'Floor ' + n, short: String(n), elevation: (n - 1) * 4, w: 60, h: 36 }); V.corridors.push({ floor: id, x: 0, y: 15, w: 60, h: 4 });
    V.nodes.push({ id: `${id}:c0`, floor: id, x: 0, y: 17, kind: 'corridor' }, { id: `${id}:c60`, floor: id, x: 60, y: 17, kind: 'corridor' }); V.edges.push({ a: `${id}:c0`, b: `${id}:c60`, type: 'walk' });
    floor = id; mv.setVenue(V); mv.setFloor(id); commit(); buildFloors(); IS.toast(`Added ${id}. Draw rooms, then link it with a lift or stairs.`);
  };
  function buildLegend() { $('legend').innerHTML = '<b style="display:block;margin-bottom:4px">Legend</b>' + Object.values(IS.CATS).map(c => `<span style="display:inline-block;margin-right:8px;white-space:nowrap"><i style="display:inline-block;width:11px;height:11px;border-radius:3px;background:${c.fill};border:1px solid ${c.stroke};vertical-align:-1px"></i> ${c.label}</span>`).join(''); }

  /* ---------- live overlay (rubber band etc.) ---------- */
  function clearLive() { if (live) { live.remove(); live = null; } }
  function drawLive(el) { clearLive(); live = el; mv.world.appendChild(el); }
  function mk(tag, attrs) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }

  /* ---------- pointer handling ---------- */
  function onPointer(phase, pt, ev) {
    if (tool === 'room') {
      if (phase === 'down') { roomDraft = { x0: pt.x, y0: pt.y }; return true; }
      if (phase === 'move' && roomDraft) { drawLive(mk('rect', { x: Math.min(roomDraft.x0, pt.x), y: Math.min(roomDraft.y0, pt.y), width: Math.abs(pt.x - roomDraft.x0), height: Math.abs(pt.y - roomDraft.y0), fill: 'rgba(47,91,234,.18)', stroke: '#2f5bea', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke', 'stroke-dasharray': '5 4' })); }
      if (phase === 'up' && roomDraft) { addRoom(roomDraft.x0, roomDraft.y0, pt.x, pt.y); roomDraft = null; clearLive(); }
      return false;
    }
    if (tool === 'select') {
      if (phase === 'down') {
        const el = ev.target.closest && ev.target.closest('[data-type="marker"],[data-type="wall"]');
        if (el) { const t = el.getAttribute('data-type'), id = el.getAttribute('data-id'); drag = { t, id, moved: false }; select({ type: t, id }); return true; }
      } else if (phase === 'move' && drag) {
        drag.moved = true; const gx = round1(pt.x), gy = round1(pt.y);
        if (drag.t === 'marker') { const m = V.markers.find(x => x.id === drag.id); m.x = gx; m.y = gy; }
        else { const w = V.walls.find(x => x.id === drag.id), cx = (w.x1 + w.x2) / 2, cy = (w.y1 + w.y2) / 2; w.x1 += gx - cx; w.x2 += gx - cx; w.y1 += gy - cy; w.y2 += gy - cy; }
        mv.build(); mv.setSelected(null);
      } else if (phase === 'up' && drag) { if (drag.moved) commit(); drag = null; }
      return !!drag;
    }
    if (tool === 'walk' && phase === 'hover' && chain) {
      const a = V.nodes.find(n => n.id === chain); if (a) drawLive(mk('line', { x1: a.x, y1: a.y, x2: pt.x, y2: pt.y, stroke: '#0f9d8a', 'stroke-width': 2.5, 'stroke-dasharray': '4 4', 'vector-effect': 'non-scaling-stroke' }));
    }
    if (tool === 'scale' && phase === 'hover' && scaleA) drawLive(mk('line', { x1: scaleA.x, y1: scaleA.y, x2: pt.x, y2: pt.y, stroke: '#d93a3a', 'stroke-width': 2.5, 'vector-effect': 'non-scaling-stroke' }));
    return false;
  }
  function onSelect(item, pt) {
    if (tool === 'select') { select(item); return; }
    if (tool === 'walk') return clickWalk(pt);
    if (tool === 'marker') return addMarker(pt);
    if (tool === 'wall') return addWall(pt);
    if (tool === 'poi') return addPoi(pt);
    if (tool === 'scale') return clickScale(pt);
  }
  window.addEventListener('keydown', e => {
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    if (e.key === 'Escape') { chain = null; scaleA = null; clearLive(); }
    if (e.key === 'Delete' || e.key === 'Backspace') { if (sel) removeSel(); }
    const k = { v: 'select', r: 'room', w: 'walk', m: 'marker', a: 'wall', p: 'poi', s: 'scale' }[e.key.toLowerCase()];
    if (k && !e.ctrlKey && !e.metaKey) setTool(k);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); $('undo').click(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); $('redo').click(); }
  });
  mv.c.addEventListener('dblclick', () => { if (tool === 'walk') { chain = null; clearLive(); } });

  /* ---------- creation tools ---------- */
  function addRoom(x0, y0, x1, y1) {
    let x = Math.round(Math.min(x0, x1)), y = Math.round(Math.min(y0, y1)), w = Math.round(Math.abs(x1 - x0)), h = Math.round(Math.abs(y1 - y0));
    if (w < 3 || h < 3) return IS.toast('Too small — drag a bigger rectangle');
    const side = y + h <= 17 ? 'N' : 'S'; const id = `${floor}-${uid('r')}`;
    V.rooms.push({ id, floor, name: 'New room', cat: 'workspace', x, y, w, h, door: { x: x + w / 2, y: side === 'N' ? 15 : 19, side }, aliases: [], hours: '9:00 – 19:00', access: 'public', short: null });
    mv.setVenue(V); commit(); select({ type: 'room', id }); IS.toast('Room drawn. It is not walkable yet — press “Connect to corridor”.');
  }
  function snapNode(pt) { let best = null; V.nodes.forEach(n => { if (n.floor !== floor) return; const d = Math.hypot(n.x - pt.x, n.y - pt.y); if (d < 1.2 && (!best || d < best.d)) best = { d, n }; }); return best && best.n; }
  function clickWalk(pt) {
    let n = snapNode(pt);
    if (!n) { n = { id: `${floor}:${uid('n')}`, floor, x: round1(pt.x), y: round1(pt.y), kind: 'corridor' }; V.nodes.push(n); }
    if (chain && chain !== n.id && !V.edges.some(e => (e.a === chain && e.b === n.id) || (e.b === chain && e.a === n.id))) V.edges.push({ a: chain, b: n.id, type: 'walk' });
    chain = n.id; mv.setVenue(V); commit();
  }
  function addMarker(pt) {
    const nums = V.markers.map(m => +m.id.slice(1)).filter(Boolean); const id = 'M' + String(Math.max(0, ...nums) + 1).padStart(2, '0');
    const north = pt.y < 17; const m = { id, floor, name: 'New marker', x: round1(pt.x), y: north ? 15 : 19, z: 1.4, normal: north ? 180 : 0, note: '' };
    V.markers.push(m); mv.setVenue(V); commit(); select({ type: 'marker', id }); IS.toast(`Marker ${id} placed on the wall. Print it from the Marker sheet.`);
  }
  function addWall(pt) {
    const nums = V.walls.map(w => +w.id.slice(1)).filter(Boolean); const id = 'W' + String(Math.max(0, ...nums) + 1).padStart(2, '0'); const north = pt.y < 17, y = north ? 15 : 19;
    V.walls.push({ id, floor, label: 'New blank wall', x1: round1(pt.x - 1.5), y1: y, x2: round1(pt.x + 1.5), y2: y, normal: north ? 180 : 0, bottom: 1.0, height: 1.6, approved: false });
    mv.setVenue(V); commit(); select({ type: 'wall', id });
  }
  function addPoi(pt) { const kind = $('poiKind').value; const id = uid('P'); V.pois.push({ id, floor, kind, name: IS.POI_KINDS[kind].label, x: round1(pt.x), y: round1(pt.y) }); mv.setVenue(V); commit(); select({ type: 'poi', id }); }
  function clickScale(pt) {
    if (!scaleA) { scaleA = { x: pt.x, y: pt.y }; return; }
    const d = Math.hypot(pt.x - scaleA.x, pt.y - scaleA.y); $('scUnits').textContent = d.toFixed(1); $('scMetres').value = d.toFixed(1); $('scaleModal').classList.add('open'); scaleA.d = d;
  }
  $('scCancel').onclick = () => { $('scaleModal').classList.remove('open'); scaleA = null; clearLive(); };
  $('scOk').onclick = () => {
    const m = +$('scMetres').value; if (!(m > 0)) return; V.scale = { metersPerUnit: +(m / scaleA.d).toFixed(4), calibrated: true, reference: `Drew ${scaleA.d.toFixed(1)} units = ${m} m` };
    $('scaleModal').classList.remove('open'); scaleA = null; clearLive(); commit(); IS.toast(`Scale set: 1 unit = ${V.scale.metersPerUnit} m`);
  };

  /* ---------- selection + properties ---------- */
  function select(item) { sel = item; mv.setSelected(item && item.type === 'room' ? item.id : null); tab = 'props'; setTab('props'); renderProps(); }
  function reselect() { if (sel && sel.type === 'room') mv.setSelected(sel.id); }
  function removeSel() {
    if (!sel) return;
    if (sel.type === 'room') { const id = sel.id; V.rooms = V.rooms.filter(r => r.id !== id); V.nodes = V.nodes.filter(n => n.room !== id && n.id !== id); V.edges = V.edges.filter(e => e.a !== id && e.b !== id && e.a !== id + ':door' && e.b !== id + ':door'); }
    else if (sel.type === 'marker') V.markers = V.markers.filter(m => m.id !== sel.id);
    else if (sel.type === 'wall') V.walls = V.walls.filter(w => w.id !== sel.id);
    else if (sel.type === 'poi') V.pois = V.pois.filter(p => p.id !== sel.id);
    else if (sel.type === 'node') { V.nodes = V.nodes.filter(n => n.id !== sel.id); V.edges = V.edges.filter(e => e.a !== sel.id && e.b !== sel.id); }
    sel = null; mv.setVenue(V); commit();
  }
  function connectRoom(r) {
    const doorId = `${r.id}:door`, nodeId = r.id;
    if (!V.nodes.some(n => n.id === doorId)) V.nodes.push({ id: doorId, floor: r.floor, x: r.door.x, y: r.door.y, kind: 'door', room: r.id });
    if (!V.nodes.some(n => n.id === nodeId)) V.nodes.push({ id: nodeId, floor: r.floor, x: r.x + r.w / 2, y: r.y + r.h / 2, kind: 'room', room: r.id });
    const link = (a, b) => { if (!V.edges.some(e => (e.a === a && e.b === b) || (e.a === b && e.b === a))) V.edges.push({ a, b, type: 'walk' }); };
    link(doorId, nodeId);
    // corridor node at door x
    let cn = V.nodes.find(n => n.floor === r.floor && n.kind === 'corridor' && Math.abs(n.y - 17) < 0.01 && Math.abs(n.x - r.door.x) < 0.01);
    if (!cn) {
      cn = { id: `${r.floor}:c${r.door.x}`, floor: r.floor, x: r.door.x, y: 17, kind: 'corridor' };
      const e = V.edges.find(e => { const a = V.nodes.find(n => n.id === e.a), b = V.nodes.find(n => n.id === e.b); return e.type === 'walk' && a && b && a.floor === r.floor && b.floor === r.floor && Math.abs(a.y - 17) < 0.01 && Math.abs(b.y - 17) < 0.01 && Math.min(a.x, b.x) < cn.x && Math.max(a.x, b.x) > cn.x; });
      if (e) { V.edges = V.edges.filter(x => x !== e); V.nodes.push(cn); link(e.a, cn.id); link(cn.id, e.b); } else V.nodes.push(cn);
    }
    link(cn.id, doorId); mv.setVenue(V); commit(); IS.toast(`${r.name} is now connected to the corridor.`);
  }
  const field = (label, html) => `<label class="f">${label}</label>${html}`;
  function renderProps() {
    const box = $('tab-props');
    if (!sel) {
      const rooms = V.rooms.filter(r => r.floor === floor).length;
      box.innerHTML = `<h3>${V.name}</h3><p class="muted">${V.type} · ${V.floors.length} floors · version ${V.version}${IS.store.hasDraft() ? ' · <b>unpublished changes</b>' : ''}</p>
        <div class="kvs"><div class="card flat kpi"><b>${V.rooms.length}</b><span>rooms</span></div><div class="card flat kpi"><b>${V.markers.length}</b><span>markers</span></div><div class="card flat kpi"><b>${V.walls.length}</b><span>ad slots</span></div><div class="card flat kpi"><b>${V.nodes.length}</b><span>walk nodes</span></div></div>
        <h4 style="margin-top:16px">Scale</h4><p class="small">${V.scale.calibrated ? '✅ ' + V.scale.reference + ` (1 unit = ${V.scale.metersPerUnit} m)` : '⚠️ Not calibrated'}</p>
        <h4 style="margin-top:12px">How to map your office</h4><ol class="small muted" style="padding-left:18px;line-height:1.7"><li>Photo of fire-evacuation plan → underlay</li><li>Calibrate scale with a measured corridor</li><li>Draw rooms, then the walk path</li><li>Place markers (lift lobbies + stairs first)</li><li>Survey blank walls for ad slots</li><li>Validate → Publish</li></ol><p class="small muted">${rooms} room(s) on ${fl(floor)}. Click anything on the map to edit it.</p>`;
      return;
    }
    if (sel.type === 'room') {
      const r = V.rooms.find(x => x.id === sel.id); if (!r) return;
      const reachable = IS.validate(V).every(v => !(v.level === 'fail' && v.detail && v.detail.includes(r.name) && v.title.includes('not reachable')));
      box.innerHTML = `<div class="row"><span style="font-size:24px">${r.icon || IS.CATS[r.cat].icon}</span><h3 style="margin:0">${r.name}</h3></div><p class="muted small">${fl(r.floor)} · ${r.w}×${r.h} m · id ${r.id}</p>
        ${reachable ? '<span class="badge ok">✔ connected to walk network</span>' : '<span class="badge fail">✖ not reachable</span> <button class="btn small teal" id="connBtn">Connect to corridor</button>'}
        ${field('Name', `<input type="text" id="f-name" value="${r.name.replace(/"/g, '&quot;')}">`)}
        ${field('Short label on map', `<input type="text" id="f-short" value="${r.short || ''}">`)}
        ${field('Category', `<select id="f-cat">${Object.entries(IS.CATS).map(([k, c]) => `<option value="${k}" ${k === r.cat ? 'selected' : ''}>${c.icon} ${c.label}</option>`).join('')}</select>`)}
        <div class="kvs"><div>${field('Opening hours', `<input type="text" id="f-hours" value="${r.hours || ''}">`)}</div><div>${field('Access', `<select id="f-access"><option value="public" ${r.access !== 'staff' ? 'selected' : ''}>Public</option><option value="staff" ${r.access === 'staff' ? 'selected' : ''}>Staff only</option></select>`)}</div></div>
        ${field('Search aliases (comma-separated; Hinglish / Telugu welcome)', `<input type="text" id="f-alias" value="${(r.aliases || []).join(', ')}">`)}
        <div class="row" style="margin-top:14px"><button class="btn danger" id="delBtn">🗑 Delete room</button></div>`;
      const bind = (id, fn) => { const e = $(id); if (e) e.onchange = e.oninput = () => { fn(e.value); }; };
      bind('f-name', v => { r.name = v; }); bind('f-short', v => { r.short = v || null; }); bind('f-cat', v => { r.cat = v; }); bind('f-hours', v => { r.hours = v; }); bind('f-access', v => { r.access = v; }); bind('f-alias', v => { r.aliases = v.split(',').map(s => s.trim()).filter(Boolean); });
      box.querySelectorAll('input,select').forEach(e => e.addEventListener('change', () => { mv.setVenue(V); mv.setSelected(r.id); commit(); }));
      if ($('connBtn')) $('connBtn').onclick = () => connectRoom(r);
    } else if (sel.type === 'marker') {
      const m = V.markers.find(x => x.id === sel.id); if (!m) return;
      box.innerHTML = `<div class="row"><span style="font-size:24px">▣</span><h3 style="margin:0">Marker ${m.id}</h3></div><p class="muted small">${fl(m.floor)} · QR / ArUco sticker</p>
        ${field('Name / location', `<input type="text" id="f-name" value="${m.name}">`)}
        <div class="kvs"><div>${field('X (m)', `<input type="number" step="0.1" id="f-x" value="${m.x}">`)}</div><div>${field('Y (m)', `<input type="number" step="0.1" id="f-y" value="${m.y}">`)}</div><div>${field('Height (m)', `<input type="number" step="0.1" id="f-z" value="${m.z}">`)}</div><div>${field('Faces', `<select id="f-n">${[[0, 'North'], [90, 'East'], [180, 'South'], [270, 'West']].map(o => `<option value="${o[0]}" ${o[0] === m.normal ? 'selected' : ''}>${o[1]}</option>`).join('')}</select>`)}</div></div>
        ${field('Placement note for the installer', `<input type="text" id="f-note" value="${m.note || ''}">`)}
        <p class="small muted" style="margin-top:10px">Visitors who scan this get: floor = <b>${fl(m.floor)}</b>, position ±0.3 m and the direction they face.</p>
        <div class="row" style="margin-top:10px"><a class="btn" href="markers.html?id=${m.id}">🖨 Print this marker</a><button class="btn danger" id="delBtn">🗑 Delete</button></div>`;
      const set = (id, fn) => { $(id).onchange = () => { fn($(id).value); mv.setVenue(V); commit(); }; };
      set('f-name', v => (m.name = v)); set('f-x', v => (m.x = +v)); set('f-y', v => (m.y = +v)); set('f-z', v => (m.z = +v)); set('f-n', v => (m.normal = +v)); set('f-note', v => (m.note = v));
    } else if (sel.type === 'wall') {
      const w = V.walls.find(x => x.id === sel.id); if (!w) return; const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1); const camps = IS.store.getCampaigns().filter(c => c.walls.includes(w.id));
      box.innerHTML = `<div class="row"><span style="font-size:24px">🖼️</span><h3 style="margin:0">Ad slot ${w.id}</h3></div><p class="muted small">${fl(w.floor)} · ${len.toFixed(1)} m wide × ${w.height} m high</p>
        ${field('Label', `<input type="text" id="f-label" value="${w.label}">`)}
        <div class="kvs"><div>${field('Width (m)', `<input type="number" step="0.1" id="f-w" value="${len.toFixed(1)}">`)}</div><div>${field('Height (m)', `<input type="number" step="0.1" id="f-h" value="${w.height}">`)}</div><div>${field('Bottom edge (m)', `<input type="number" step="0.1" id="f-b" value="${w.bottom}">`)}</div><div>${field('Faces', `<select id="f-n">${[[0, 'North'], [90, 'East'], [180, 'South'], [270, 'West']].map(o => `<option value="${o[0]}" ${o[0] === w.normal ? 'selected' : ''}>${o[1]}</option>`).join('')}</select>`)}</div></div>
        <div class="row" style="margin-top:12px"><label class="switch"><input type="checkbox" id="f-ok" ${w.approved ? 'checked' : ''}><i></i></label><span>Venue owner approved this wall for ads</span></div>
        <h4 style="margin-top:14px">Campaigns using this slot</h4>${camps.length ? camps.map(c => `<div class="row small" style="padding:4px 0"><span class="badge ${c.status === 'active' ? 'ok' : 'gray'}">${c.status}</span> <b>${c.brand}</b> · ${c.type}</div>`).join('') : '<p class="small muted">None yet — <a href="ads.html">assign one in the Ads portal</a>.</p>'}
        <div class="row" style="margin-top:12px"><button class="btn danger" id="delBtn">🗑 Delete slot</button></div>`;
      const set = (id, fn) => { $(id).onchange = () => { fn($(id).value); mv.setVenue(V); commit(); }; };
      set('f-label', v => (w.label = v)); set('f-h', v => (w.height = +v)); set('f-b', v => (w.bottom = +v)); set('f-n', v => (w.normal = +v));
      set('f-w', v => { const c = (w.x1 + w.x2) / 2, half = +v / 2; w.x1 = c - half; w.x2 = c + half; });
      $('f-ok').onchange = e => { w.approved = e.target.checked; commit(); };
    } else if (sel.type === 'poi') {
      const p = V.pois.find(x => x.id === sel.id); if (!p) return;
      box.innerHTML = `<div class="row"><span style="font-size:24px">${(IS.POI_KINDS[p.kind] || {}).icon}</span><h3 style="margin:0">${p.name}</h3></div>${field('Name', `<input type="text" id="f-name" value="${p.name}">`)}${field('Kind', `<select id="f-kind">${Object.entries(IS.POI_KINDS).map(([k, v]) => `<option value="${k}" ${k === p.kind ? 'selected' : ''}>${v.icon} ${v.label}</option>`).join('')}</select>`)}<div class="row" style="margin-top:14px"><button class="btn danger" id="delBtn">🗑 Delete</button></div>`;
      $('f-name').onchange = e => { p.name = e.target.value; mv.setVenue(V); commit(); }; $('f-kind').onchange = e => { p.kind = e.target.value; mv.setVenue(V); commit(); };
    } else if (sel.type === 'node') {
      const n = V.nodes.find(x => x.id === sel.id); if (!n) return; box.innerHTML = `<h3>Walk node</h3><p class="muted small">${n.kind} · ${fl(n.floor)} · (${n.x}, ${n.y}) · ${V.edges.filter(e => e.a === n.id || e.b === n.id).length} link(s)</p><div class="row"><button class="btn danger" id="delBtn">🗑 Delete node</button></div>`;
    }
    if ($('delBtn')) $('delBtn').onclick = removeSel;
  }

  /* ---------- checklist, JSON, publish ---------- */
  function setTab(t) {
    tab = t; document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
    ['props', 'check', 'json'].forEach(k => ($('tab-' + k).style.display = k === t ? '' : 'none'));
    if (t === 'check') renderCheck(); if (t === 'json') $('jsonBox').value = JSON.stringify(V, null, 1);
  }
  document.querySelectorAll('.tabs button').forEach(b => (b.onclick = () => setTab(b.dataset.t)));
  function renderCheck() {
    const res = IS.validate(V); const fails = res.filter(r => r.level === 'fail').length, warns = res.filter(r => r.level === 'warn').length;
    $('tab-check').innerHTML = `<div class="row" style="margin-bottom:8px"><span class="badge ${fails ? 'fail' : 'ok'}">${fails ? fails + ' blocking' : 'Ready to publish'}</span>${warns ? `<span class="badge warn">${warns} warning(s)</span>` : ''}</div>` +
      res.map(r => `<div class="check"><div class="dot ${r.level}">${r.level === 'pass' ? '✓' : r.level === 'warn' ? '!' : '✕'}</div><div><b>${r.title}</b><div class="small muted">${r.detail || ''}</div></div></div>`).join('');
    return res;
  }
  function refresh(full) {
    $('venueName').textContent = V.name; $('verBadge').textContent = IS.store.hasDraft() ? `v${V.version} + draft` : `v${V.version} published`;
    const fails = IS.validate(V).filter(r => r.level === 'fail').length; const c = $('failCnt'); c.style.display = fails ? '' : 'none'; c.textContent = fails;
    $('publishBtn').disabled = false; $('publishBtn').title = fails ? 'Fix blocking issues first' : 'Publish to the visitor app';
    if (full) { if (tab === 'check') renderCheck(); if (tab === 'json') $('jsonBox').value = JSON.stringify(V, null, 1); renderProps(); }
  }
  $('checkBtn').onclick = () => setTab('check');
  $('publishBtn').onclick = () => {
    const res = IS.validate(V), fails = res.filter(r => r.level === 'fail');
    if (fails.length) { setTab('check'); return IS.toast(`Cannot publish: ${fails.length} blocking issue(s)`, 3600); }
    const pub = IS.store.publish(JSON.parse(JSON.stringify(V))); V.version = pub.version; V.status = 'published'; refresh(true);
    IS.toast(`🚀 Published v${pub.version} — the visitor app now uses this map`, 4500); $('saveState').innerHTML = `Published v${pub.version} · <a href="nav.html">open visitor app →</a>`;
  };
  $('dlJson').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(V, null, 2)], { type: 'application/json' })); a.download = `${V.id}-v${V.version}.json`; a.click(); };

  buildTools(); buildLayers(); buildFloors(); buildLegend(); refresh(true);
  const q = new URLSearchParams(location.search);
  if (q.get('sel')) { const [t, id] = q.get('sel').split(':'); select({ type: t, id }); const it = (t === 'wall' ? V.walls : V.markers).find(x => x.id === id); if (it) { floor = it.floor; mv.setFloor(floor); buildFloors(); mv.centerOn(it.x || it.x1, it.y || it.y1, 14); } }
  if (q.get('tab')) setTab(q.get('tab'));
})();
