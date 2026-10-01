/* Indore Spaces — deterministic engine: graph, routing (time-based), turn instructions (en / Hinglish / Telugu),
   search, intent matching, route playback maths, map validation. No AI anywhere in here. */
(function (g) {
  const IS = (g.IS = g.IS || {});
  const WALK = 1.3; // m/s

  const rad = d => (d * Math.PI) / 180;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const bearingOf = (a, b) => ((Math.atan2(b.x - a.x, -(b.y - a.y)) * 180) / Math.PI + 360) % 360;
  const delta = d => ((((d + 180) % 360) + 360) % 360) - 180;
  IS.geo = { dist, bearingOf, delta, WALK };

  /* ---------- graph ---------- */
  function floorIdx(v, id) { return v.floors.findIndex(f => f.id === id); }

  IS.buildGraph = function (v) {
    const nodes = {}, adj = {};
    v.nodes.forEach(n => { nodes[n.id] = Object.assign({}, n); adj[n.id] = []; });
    v.edges.forEach(e => {
      const a = nodes[e.a], b = nodes[e.b];
      if (!a || !b) return;
      if (e.type === 'walk') {
        const d = dist(a, b);
        adj[a.id].push({ to: b.id, type: 'walk', len: d, sec: d / WALK });
        adj[b.id].push({ to: a.id, type: 'walk', len: d, sec: d / WALK });
      } else {
        const abUp = floorIdx(v, a.floor) < floorIdx(v, b.floor);
        const len = e.len || 6;
        adj[a.id].push({ to: b.id, type: e.type, len, sec: abUp ? e.upSec : e.downSec, up: abUp });
        adj[b.id].push({ to: a.id, type: e.type, len, sec: abUp ? e.downSec : e.upSec, up: !abUp });
      }
    });
    return { nodes, adj, v, tmp: 0 };
  };

  function roomAt(v, floor, x, y) {
    return v.rooms.find(r => r.floor === floor && x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h);
  }

  // Attach an arbitrary point to the walk network (inside a room -> its door; else snap to nearest corridor edge).
  IS.attachPoint = function (G, floor, x, y, tag) {
    const v = G.v;
    const id = `tmp:${tag}:${G.tmp++}`;
    const node = { id, floor, x, y, kind: 'tmp' };
    const room = roomAt(v, floor, x, y);
    if (room) {
      const door = G.nodes[`${room.id}:door`];
      G.nodes[id] = node; G.adj[id] = [];
      const d = dist(node, door);
      G.adj[id].push({ to: door.id, type: 'walk', len: d, sec: d / WALK });
      G.adj[door.id].push({ to: id, type: 'walk', len: d, sec: d / WALK });
      return id;
    }
    let best = null;
    Object.keys(G.adj).forEach(aId => {
      const a = G.nodes[aId];
      if (a.floor !== floor || a.kind !== 'corridor') return;
      G.adj[aId].forEach(h => {
        const b = G.nodes[h.to];
        if (h.type !== 'walk' || b.kind !== 'corridor' || b.floor !== floor || aId > h.to) return;
        const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / L2));
        const px = a.x + t * dx, py = a.y + t * dy, d = Math.hypot(x - px, y - py);
        if (!best || d < best.d) best = { d, aId, bId: h.to, t, px, py };
      });
    });
    if (!best) return null;
    let snapId;
    if (best.t < 0.001) snapId = best.aId;
    else if (best.t > 0.999) snapId = best.bId;
    else {
      snapId = `${id}s`;
      G.nodes[snapId] = { id: snapId, floor, x: best.px, y: best.py, kind: 'corridor' };
      G.adj[snapId] = [];
      G.adj[best.aId] = G.adj[best.aId].filter(h => h.to !== best.bId);
      G.adj[best.bId] = G.adj[best.bId].filter(h => h.to !== best.aId);
      link(G, snapId, best.aId); link(G, snapId, best.bId);
    }
    if (best.d <= 1.0) return snapId; // close enough: treat as standing on the corridor line
    G.nodes[id] = node; G.adj[id] = [];
    link(G, id, snapId);
    return id;
  };
  function link(G, a, b) {
    const d = dist(G.nodes[a], G.nodes[b]);
    G.adj[a].push({ to: b, type: 'walk', len: d, sec: d / WALK });
    G.adj[b].push({ to: a, type: 'walk', len: d, sec: d / WALK });
  }

  /* ---------- routing ---------- */
  function isRestricted(v, nodeId, G) {
    const n = G.nodes[nodeId];
    if (!n || !n.room) return false;
    const r = v.rooms.find(x => x.id === n.room);
    return r && r.access === 'staff';
  }

  // from: {floor,x,y,heading} | {node}      dest: {room:id} | {poi:id}
  IS.route = function (v, from, dest, prefsIn) {
    const prefs = Object.assign({ avoidStairs: false, avoidLifts: false }, prefsIn);
    const G = IS.buildGraph(v);
    const startId = from.node || IS.attachPoint(G, from.floor, from.x, from.y, 'start');
    let goalId, destName, destRoom = null, destFloor;
    if (dest.room) {
      destRoom = v.rooms.find(r => r.id === dest.room);
      if (!destRoom) return { error: 'unknown' };
      if (destRoom.access === 'staff') return { error: 'restricted', name: destRoom.name };
      goalId = destRoom.id; destName = destRoom.name; destFloor = destRoom.floor;
    } else {
      const p = v.pois.find(x => x.id === dest.poi);
      if (!p) return { error: 'unknown' };
      goalId = IS.attachPoint(G, p.floor, p.x, p.y, 'dest'); destName = p.name; destFloor = p.floor;
    }
    if (!startId || !goalId) return { error: 'unreachable' };
    // dijkstra
    const D = {}, prev = {}, open = new Set([startId]);
    D[startId] = 0;
    while (open.size) {
      let u = null; open.forEach(k => { if (u === null || D[k] < D[u]) u = k; });
      open.delete(u);
      if (u === goalId) break;
      for (const h of G.adj[u]) {
        if (h.type === 'stairs' && prefs.avoidStairs) continue;
        if (h.type === 'lift' && prefs.avoidLifts) continue;
        if (h.to !== goalId && isRestricted(v, h.to, G)) continue;
        const nd = D[u] + h.sec;
        if (D[h.to] === undefined || nd < D[h.to]) { D[h.to] = nd; prev[h.to] = { from: u, hop: h }; open.add(h.to); }
      }
    }
    if (D[goalId] === undefined) return { error: 'unreachable' };
    const hops = []; let cur = goalId;
    while (cur !== startId) { const p = prev[cur]; hops.unshift({ from: p.from, to: cur, type: p.hop.type, len: p.hop.len, sec: p.hop.sec, up: p.hop.up }); cur = p.from; }
    return compile(v, G, startId, hops, from.heading, destName, destRoom, destFloor);
  };

  function compile(v, G, startId, hops, startHeading, destName, destRoom, destFloor) {
    const pts = [{ node: startId, floor: G.nodes[startId].floor, x: G.nodes[startId].x, y: G.nodes[startId].y }];
    const cum = [0];
    hops.forEach(h => {
      const n = G.nodes[h.to];
      pts.push({ node: h.to, floor: n.floor, x: n.x, y: n.y });
      cum.push(cum[cum.length - 1] + h.len);
    });
    // steps
    const steps = []; let acc = 0, prevB = startHeading == null ? null : startHeading, afterV = false, lastVia = null;
    hops.forEach((h, i) => {
      const a = G.nodes[h.from], b = G.nodes[h.to];
      if (h.type === 'walk') {
        const bB = bearingOf(a, b);
        if (prevB != null) {
          const d = delta(bB - prevB);
          if (Math.abs(d) >= 30) {
            let into = null, landmark = null;
            if (b.kind === 'door') { const rm = v.rooms.find(r => r.id === b.room) || {}; into = rm.name && rm.name.length > 20 && rm.short ? rm.short : rm.name || null; }
            else if (!afterV && i > 0) {
              let bd = 7;
              v.nodes.forEach(n => { if (n.kind === 'door' && n.floor === a.floor && dist(n, a) < bd && n.id !== `${(v.rooms.find(r => r.id === destRoom?.id) || {}).id}:door`) { bd = dist(n, a); landmark = (v.rooms.find(r => r.id === n.room) || {}).name; } });
            }
            steps.push({ kind: 'turn', dir: d > 0 ? 'right' : 'left', angle: Math.abs(d), sAt: cum[i], dist: acc, into, landmark, afterV, via: lastVia, initial: i === 0, at: { floor: a.floor, x: a.x, y: a.y }, heading: bB });
            acc = 0; afterV = false;
          }
        }
        prevB = bB; acc += h.len;
      } else {
        steps.push({ kind: 'vertical', via: h.type, up: !!h.up, toFloor: b.floor, toFloorName: (v.floors.find(f => f.id === b.floor) || {}).name, sAt: cum[i], dist: acc, at: { floor: a.floor, x: a.x, y: a.y } });
        acc = 0; prevB = null; afterV = true; lastVia = h.type;
      }
    });
    steps.push({ kind: 'arrive', name: destName, sAt: cum[cum.length - 1], dist: acc, at: { floor: pts[pts.length - 1].floor, x: pts[pts.length - 1].x, y: pts[pts.length - 1].y } });
    const walkDist = hops.filter(h => h.type === 'walk').reduce((s, h) => s + h.len, 0);
    const via = (hops.find(h => h.type !== 'walk') || {}).type || null;
    return {
      hops, points: pts, cum, total: cum[cum.length - 1], steps,
      time: hops.reduce((s, h) => s + h.sec, 0), walkDist, via,
      destName, destRoom: destRoom ? destRoom.id : null, destFloor,
      floors: [...new Set(pts.map(p => p.floor))],
      startFloor: pts[0].floor,
    };
  }

  IS.alternatives = function (v, from, dest, prefs) {
    const out = [];
    const base = IS.route(v, from, dest, Object.assign({}, prefs, { avoidStairs: false, avoidLifts: false }));
    if (!base || base.error) return { error: base && base.error, options: [] };
    out.push(base);
    if (base.via) {
      const other = base.via === 'stairs' ? { avoidStairs: true } : { avoidLifts: true };
      const alt = IS.route(v, from, dest, Object.assign({}, prefs, other));
      if (alt && !alt.error) out.push(alt);
    }
    return { options: out };
  };

  /* ---------- playback maths ---------- */
  IS.pointAt = function (route, s) {
    s = Math.max(0, Math.min(route.total, s));
    let i = 0;
    while (i < route.hops.length - 1 && route.cum[i + 1] < s) i++;
    if (!route.hops.length) { const p = route.points[0]; return { floor: p.floor, x: p.x, y: p.y, bearing: 0, hop: 0 }; }
    const a = route.points[i], b = route.points[i + 1], h = route.hops[i];
    const t = h.len ? (s - route.cum[i]) / h.len : 1;
    if (h.type !== 'walk') {
      let bg = 0; for (let k = i - 1; k >= 0; k--) if (route.hops[k].type === 'walk') { bg = bearingOf(route.points[k], route.points[k + 1]); break; }
      return { floor: a.floor, x: a.x, y: a.y, bearing: bg, hop: i, vertical: { via: h.type, t, toFloor: b.floor, up: h.up } };
    }
    return { floor: a.floor, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, bearing: bearingOf(a, b), hop: i };
  };

  // runs of drawable polyline per floor between s0..s1
  IS.routeRuns = function (route, s0, s1) {
    const runs = [];
    for (let i = 0; i < route.hops.length; i++) {
      const h = route.hops[i];
      if (h.type !== 'walk') continue;
      const a = route.points[i], b = route.points[i + 1];
      const c0 = route.cum[i], c1 = route.cum[i + 1];
      if (c1 <= s0 || c0 >= s1) continue;
      const t0 = Math.max(0, (s0 - c0) / h.len), t1 = Math.min(1, (s1 - c0) / h.len);
      const p0 = { x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0 };
      const p1 = { x: a.x + (b.x - a.x) * t1, y: a.y + (b.y - a.y) * t1 };
      let run = runs[runs.length - 1];
      if (!run || run.floor !== a.floor || run.lastHop !== i - 1) { run = { floor: a.floor, pts: [p0], lastHop: i }; runs.push(run); }
      run.pts.push(p1); run.lastHop = i;
    }
    return runs;
  };

  IS.remainingSec = function (route, s) {
    let sec = 0;
    route.hops.forEach((h, i) => {
      const c0 = route.cum[i], c1 = route.cum[i + 1];
      if (c1 <= s) return;
      const frac = c0 >= s ? 1 : (c1 - s) / (c1 - c0 || 1);
      sec += h.sec * frac;
    });
    return sec;
  };
  IS.remainingWalk = function (route, s) {
    let m = 0;
    route.hops.forEach((h, i) => {
      if (h.type !== 'walk') return;
      const c0 = route.cum[i], c1 = route.cum[i + 1];
      if (c1 <= s) return;
      m += c0 >= s ? h.len : c1 - s;
    });
    return m;
  };

  // next manoeuvre ahead of progress s (initial turn counts while s≈0)
  IS.nextStep = function (route, s) {
    for (let i = 0; i < route.steps.length; i++) {
      const st = route.steps[i];
      if (st.sAt > s + 0.05 || (st.initial && s < 0.3)) return { step: st, index: i, remaining: Math.max(0, st.sAt - s) };
    }
    const last = route.steps[route.steps.length - 1];
    return { step: last, index: route.steps.length - 1, remaining: Math.max(0, route.total - s) };
  };

  IS.nearestMarker = function (v, floor, x, y, maxD) {
    let best = null;
    v.markers.forEach(m => {
      if (m.floor !== floor) return;
      const d = Math.hypot(m.x - x, m.y - y);
      if (d <= maxD && (!best || d < best.d)) best = { marker: m, d };
    });
    return best;
  };

  // pose of a person who just scanned a marker: 1.5 m in front of it, looking at it
  IS.poseFromMarker = function (m) {
    const nx = Math.sin(rad(m.normal)), ny = -Math.cos(rad(m.normal));
    return { floor: m.floor, x: m.x + nx * 1.5, y: m.y + ny * 1.5, heading: (m.normal + 180) % 360 };
  };

  /* ---------- instruction text ---------- */
  const T = {
    en: {
      viaWord: v => (v === 'lift' ? 'lift' : 'stairs'),
      turn(s) {
        const pre = s.afterV ? `leave the ${this.viaWord(s.via)}, then ` : '';
        return pre + `turn ${s.dir}` + (s.into ? ` into ${s.into}` : s.landmark ? ` near ${s.landmark}` : '');
      },
      vertical: s => `take the ${s.via === 'lift' ? 'lift' : 'stairs'} ${s.up ? 'up' : 'down'} to ${s.toFloorName}`,
      arrive: s => `arrive at ${s.name}`,
      inM: d => `In ${d} metres, `, now: 'Now, ', then: d => `then walk ${d} m`, walk: d => `Walk ${d} m`,
      arrived: n => `You have arrived at ${n}.`, straight: 'Continue straight',
    },
    hi: {
      viaWord: v => (v === 'lift' ? 'lift' : 'seedhiyon'),
      turn(s) {
        const pre = s.afterV ? `${this.viaWord(s.via)} se bahar nikal kar, ` : '';
        return pre + `${s.dir === 'left' ? 'baayein' : 'daayein'} mudiye` + (s.into ? ` (${s.into} ke andar)` : s.landmark ? ` (${s.landmark} ke paas)` : '');
      },
      vertical: s => `${s.via === 'lift' ? 'Lift' : 'Seedhiyon'} se ${s.toFloorName} par ${s.up ? 'upar' : 'neeche'} jaiye`,
      arrive: s => `${s.name} par pahunch jayenge`,
      inM: d => `${d} meter baad, `, now: 'Ab, ', then: d => `phir ${d} meter chaliye`, walk: d => `${d} meter chaliye`,
      arrived: n => `Aap ${n} par pahunch gaye hain.`, straight: 'Seedhe chaliye',
    },
    te: {
      viaWord: v => (v === 'lift' ? 'లిఫ్ట్' : 'మెట్ల'),
      turn(s) {
        const pre = s.afterV ? `${this.viaWord(s.via)} నుండి బయటకు వచ్చి, ` : '';
        return pre + `${s.dir === 'left' ? 'ఎడమవైపు' : 'కుడివైపు'} తిరగండి` + (s.into ? ` (${s.into} లోకి)` : s.landmark ? ` (${s.landmark} దగ్గర)` : '');
      },
      vertical: s => `${s.via === 'lift' ? 'లిఫ్ట్' : 'మెట్ల'} ద్వారా ${s.toFloorName} కి ${s.up ? 'పైకి' : 'కిందకి'} వెళ్లండి`,
      arrive: s => `${s.name} కి చేరుకుంటారు`,
      inM: d => `${d} మీటర్ల తర్వాత, `, now: 'ఇప్పుడు, ', then: d => `తర్వాత ${d} మీటర్లు నడవండి`, walk: d => `${d} మీటర్లు నడవండి`,
      arrived: n => `మీరు ${n} కి చేరుకున్నారు.`, straight: 'నేరుగా వెళ్ళండి',
    },
  };
  IS.LANGS = { en: { label: 'English', speech: 'en-IN' }, hi: { label: 'Hinglish', speech: 'hi-IN' }, te: { label: 'తెలుగు', speech: 'te-IN' } };
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const round = d => (d > 20 ? Math.round(d / 5) * 5 : Math.round(d));

  IS.stepAction = function (step, lang) {
    const t = T[lang] || T.en;
    if (step.kind === 'turn') return cap(t.turn(step));
    if (step.kind === 'vertical') return cap(t.vertical(step));
    return cap(t.arrive(step));
  };
  IS.stepSpeech = function (step, lang, remaining) {
    const t = T[lang] || T.en;
    const act = step.kind === 'turn' ? t.turn(step) : step.kind === 'vertical' ? t.vertical(step) : t.arrive(step);
    const pre = remaining < 3 ? t.now : t.inM(round(remaining));
    return pre + act + '.';
  };
  IS.walkText = (d, lang) => (T[lang] || T.en).walk(Math.round(d));
  IS.thenText = (d, lang) => (T[lang] || T.en).then(Math.round(d));
  IS.arrivedText = (n, lang) => (T[lang] || T.en).arrived(n);
  IS.fmtTime = sec => (sec < 55 ? `${Math.max(5, Math.round(sec / 5) * 5)} sec` : `${Math.round(sec / 30) / 2} min`);

  /* ---------- search & intent ---------- */
  function lev(a, b) {
    const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }
  IS.search = function (v, qRaw) {
    const q = (qRaw || '').toLowerCase().trim();
    if (!q) return [];
    const out = [];
    const words = q.split(/\s+/).filter(Boolean);
    v.rooms.forEach(r => {
      const name = r.name.toLowerCase();
      let sc = 0;
      if (name.startsWith(q)) sc = 95; else if (name.includes(q)) sc = 70;
      (r.aliases || []).forEach(al => {
        const a = al.toLowerCase();
        if (a === q) sc = Math.max(sc, 92);
        else if (q.length >= 2 && a.includes(q)) sc = Math.max(sc, 72);
        else if (a.length >= 3 && q.includes(a)) sc = Math.max(sc, 66);
        else words.forEach(w => { if (w.length >= 5 && a.length >= 5 && lev(w, a) <= 1) sc = Math.max(sc, 58); });
      });
      if (IS.CATS[r.cat] && IS.CATS[r.cat].label.toLowerCase().includes(q)) sc = Math.max(sc, 35);
      if (sc) out.push({ type: 'room', id: r.id, room: r, score: sc });
    });
    v.pois.forEach(p => {
      const kind = (IS.POI_KINDS[p.kind] || {}).label || '';
      let sc = 0;
      if (p.name.toLowerCase().includes(q) || kind.toLowerCase().includes(q)) sc = 50;
      if (sc) out.push({ type: 'poi', id: p.id, poi: p, score: sc });
    });
    return out.sort((a, b) => b.score - a.score);
  };

  const RE = {
    where: /(where am i|main kahan|mai kahan|mein kahan|నేను ఎక్కడ|मैं कहाँ)/i,
    repeat: /(repeat|dobara|phir se|once more|again|మళ్ళీ|మళ్లీ|फिर से)/i,
    stop: /(stop|cancel|band karo|end nav|ఆపు|रुको)/i,
    avoidStairs: /(avoid stairs|no stairs|without stairs|seedhi nahi|lift se|మెట్లు వద్దు|లిఫ్ట్ లో)/i,
    nearest: /(nearest|nearby|closest|paas|pass wala|దగ్గర|नज़दीक|नजदीक)/i,
    where_is: /(where|kahan|kidhar|ekkada|ఎక్కడ|कहाँ)/i,
    go: /(take me|le chalo|le jao|leke chalo|navigate|go to|directions|jana hai|jaana|తీసుకెళ్|వెళ్ళాలి|వెళ్లాలి|चलो|ले चलो)/i,
  };
  IS.intent = function (v, text, ctx) {
    const t = (text || '').trim();
    if (!t) return { type: 'unknown' };
    if (RE.stop.test(t)) return { type: 'stop' };
    if (RE.repeat.test(t)) return { type: 'repeat' };
    if (RE.where.test(t)) return { type: 'whereami' };
    if (RE.avoidStairs.test(t)) return { type: 'pref', avoidStairs: true };
    const res = IS.search(v, t.replace(RE.nearest, ' ').replace(RE.go, ' ').replace(RE.where_is, ' '));
    const best = res.find(r => r.score >= 55) || res[0];
    if (!best || best.score < 35) return { type: 'unknown' };
    if (RE.nearest.test(t) && best.type === 'room' && ctx && ctx.from) {
      const same = v.rooms.filter(r => r.access !== 'staff' && (r.cat === best.room.cat) && (best.room.kind ? r.kind === best.room.kind : true));
      let pick = null;
      same.forEach(r => { const rt = IS.route(v, ctx.from, { room: r.id }, ctx.prefs); if (rt && !rt.error && (!pick || rt.time < pick.time)) pick = { room: r, time: rt.time }; });
      if (pick) return { type: 'goto', nearest: true, target: { room: pick.room.id }, name: pick.room.name };
    }
    const target = best.type === 'room' ? { room: best.id } : { poi: best.id };
    const name = best.type === 'room' ? best.room.name : best.poi.name;
    if (RE.go.test(t) || !RE.where_is.test(t)) return { type: 'goto', target, name };
    return { type: 'show', target, name };
  };

  /* ---------- validation (used by the editor's publish checklist) ---------- */
  IS.validate = function (v) {
    const out = [];
    const add = (level, title, detail) => out.push({ level, title, detail });
    // scale
    if (v.scale && v.scale.calibrated) add('pass', 'Scale calibrated', v.scale.reference || '1 unit = 1 m');
    else add('fail', 'Scale not calibrated', 'Draw a line over a measured distance and enter its length in metres.');
    // reachability
    const G = IS.buildGraph(v); const seen = new Set(); const stack = [`${v.floors[0].id}:c0`];
    while (stack.length) { const k = stack.pop(); if (seen.has(k) || !G.adj[k]) continue; seen.add(k); G.adj[k].forEach(h => stack.push(h.to)); }
    const unreachable = v.rooms.filter(r => !seen.has(r.id));
    if (!unreachable.length) add('pass', `All ${v.rooms.length} rooms reachable from the entrance`, 'Every room has a door linked to the walk network.');
    else add('fail', `${unreachable.length} room(s) not reachable`, unreachable.map(r => r.name).join(', ') + ' — select the room and use “Connect to corridor”.');
    // floors connected
    const vert = v.edges.filter(e => e.type !== 'walk');
    const lifts = vert.filter(e => e.type === 'lift').length, stairs = vert.filter(e => e.type === 'stairs').length;
    const disconnectedFloors = v.floors.filter(f => !vert.some(e => (G.nodes[e.a] || {}).floor === f.id || (G.nodes[e.b] || {}).floor === f.id));
    if (v.floors.length > 1 && disconnectedFloors.length) add('fail', 'Floors not linked', disconnectedFloors.map(f => f.name).join(', ') + ' has no lift or stairs link.');
    else add('pass', 'Floors linked', `${lifts} lift link(s), ${stairs} staircase link(s).`);
    if (v.floors.length > 1 && !lifts) add('warn', 'No lift link', 'Wheelchair / stroller routing will fail between floors.');
    // markers
    const ids = v.markers.map(m => m.id); const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
    if (dup.length) add('fail', 'Duplicate marker IDs', [...new Set(dup)].join(', '));
    v.floors.forEach(f => {
      const n = v.markers.filter(m => m.floor === f.id).length;
      if (n < 3) add('warn', `${f.name}: only ${n} marker(s)`, 'Recommended 6–12 per floor (lift lobby, stairs door, junctions).');
      else add('pass', `${f.name}: ${n} markers placed`, 'Good coverage for re-anchoring.');
    });
    v.rooms.filter(r => r.kind === 'lift' || r.kind === 'stairs').forEach(r => {
      const near = v.markers.some(m => m.floor === r.floor && Math.hypot(m.x - r.door.x, m.y - r.door.y) < 6);
      if (!near) add('fail', `No marker near ${r.name} (${(v.floors.find(f => f.id === r.floor) || {}).name})`, 'Needed to confirm the floor after a lift or stairs ride.');
    });
    const farMarkers = v.markers.filter(m => { const dd = Math.abs(m.y - 17); return dd > 6; });
    if (farMarkers.length) add('warn', 'Markers far from corridors', farMarkers.map(m => m.id).join(', '));
    // walls
    v.walls.forEach(w => {
      const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
      if (len < 1.5) add('warn', `Ad slot ${w.id} is narrow (${len.toFixed(1)} m)`, 'Wider than 1.5 m looks better.');
      const door = v.rooms.find(r => r.floor === w.floor && r.door && ((Math.abs(w.y1 - r.door.y) < 0.1) && r.door.x > Math.min(w.x1, w.x2) - 0.6 && r.door.x < Math.max(w.x1, w.x2) + 0.6));
      if (door) add('fail', `Ad slot ${w.id} overlaps the door of ${door.name}`, 'Move the slot onto a blank wall segment.');
    });
    if (v.walls.length && !out.some(o => o.title.startsWith('Ad slot'))) add('pass', `${v.walls.length} ad slot(s) on blank walls`, 'Awaiting venue-owner approval flags.');
    const blank = v.rooms.filter(r => !r.name || !r.name.trim());
    if (blank.length) add('fail', 'Unnamed rooms', `${blank.length} room(s) have no name.`);
    return out;
  };
})(typeof window !== 'undefined' ? window : globalThis);
