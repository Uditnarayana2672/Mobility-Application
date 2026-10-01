/* Indore Spaces — SVG indoor map renderer shared by visitor app, editor and dashboard.
   World units are metres (x east, y south). Supports pan / pinch / wheel zoom, heading-up rotation,
   route + travelled trail, user dot with heading cone and accuracy ring, and editor layers. */
(function (g) {
  const IS = (g.IS = g.IS || {});
  const NS = 'http://www.w3.org/2000/svg';
  const S = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs || {}) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const angDiff = (a, b) => ((((b - a) % 360) + 540) % 360) - 180;

  class MapView {
    constructor(container, venue, opts) {
      this.c = container; this.v = venue;
      this.o = Object.assign({ floor: venue.floors[0].id, minScale: 2, maxScale: 60, anchorY: 0.5, labels: true, onSelect: null, onPointer: null, layers: {} }, opts);
      this.layers = Object.assign({ underlay: false, grid: false, doors: true, labels: true, pois: true, markers: false, walls: false, walknet: false }, this.o.layers);
      this.floor = this.o.floor; this.scale = 8; this.center = { x: 30, y: 18 }; this.rot = 0;
      this.follow = false; this.headingUp = false; this.user = null; this.route = null; this.progress = 0; this.selected = null; this.dest = null;
      this.fixed = []; this.roomEls = {}; this.W = 300; this.H = 300; this.anchorY = this.o.anchorY;
      this.svg = S('svg', { width: '100%', height: '100%', style: 'display:block;touch-action:none;user-select:none;background:#e9edf3' });
      this.c.innerHTML = ''; this.c.appendChild(this.svg);
      this.defs = S('defs', {}, this.svg);
      const pat = S('pattern', { id: 'hatch', width: 1.2, height: 1.2, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, this.defs);
      S('rect', { width: 1.2, height: 1.2, fill: 'none' }, pat); S('line', { x1: 0, y1: 0, x2: 0, y2: 1.2, stroke: '#d9707a', 'stroke-width': 0.35, opacity: 0.6 }, pat);
      this.world = S('g', {}, this.svg);
      this.bind();
      this.measure();
      if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { this.measure(); this.render(); }).observe(this.c);
      this.build(); this.fit();
    }

    measure() { const r = this.c.getBoundingClientRect(); this.W = r.width || 300; this.H = r.height || 300; }

    /* ----- static scene ----- */
    build() {
      const v = this.v, f = v.floors.find(x => x.id === this.floor) || v.floors[0];
      this.floorObj = f;
      this.world.innerHTML = ''; this.fixed = []; this.roomEls = {};
      const gU = S('g', {}, this.world), gGrid = S('g', {}, this.world), gPlate = S('g', {}, this.world), gRooms = S('g', {}, this.world), gDoors = S('g', {}, this.world), gNet = S('g', {}, this.world), gWalls = S('g', {}, this.world);
      this.gRoute = S('g', {}, this.world); this.gUserAcc = S('g', {}, this.world); this.gFix = S('g', {}, this.world);
      this.gU = gU; this.gGrid = gGrid; this.gDoors = gDoors; this.gNet = gNet; this.gWalls = gWalls;

      if (this.layers.underlay) this.drawUnderlay(gU, f);
      if (this.layers.grid) for (let i = 0; i <= f.w; i += 5) { S('line', { x1: i, y1: 0, x2: i, y2: f.h, stroke: '#cdd5e0', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke', opacity: 0.7 }, gGrid); }
      if (this.layers.grid) for (let j = 0; j <= f.h; j += 5) { S('line', { x1: 0, y1: j, x2: f.w, y2: j, stroke: '#cdd5e0', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke', opacity: 0.7 }, gGrid); }

      S('rect', { x: -0.4, y: -0.4, width: f.w + 0.8, height: f.h + 0.8, rx: 1, fill: '#f5f6f8', stroke: '#b8c1ce', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }, gPlate);
      v.corridors.filter(c => c.floor === f.id).forEach(c => {
        S('rect', { x: c.x, y: c.y, width: c.w, height: c.h, fill: '#ffffff', 'data-type': 'corridor', 'data-id': 'corridor' }, gPlate);
        S('line', { x1: c.x, y1: c.y + c.h / 2, x2: c.x + c.w, y2: c.y + c.h / 2, stroke: '#eef1f5', 'stroke-width': 1, 'stroke-dasharray': '6 6', 'vector-effect': 'non-scaling-stroke' }, gPlate);
      });
      v.rooms.filter(r => r.floor === f.id).forEach(r => {
        const cat = IS.CATS[r.cat] || IS.CATS.workspace;
        const rect = S('rect', { x: r.x, y: r.y, width: r.w, height: r.h, rx: 0.4, fill: cat.fill, stroke: cat.stroke, 'stroke-width': 1.3, 'vector-effect': 'non-scaling-stroke', 'data-type': 'room', 'data-id': r.id, style: 'cursor:pointer' }, gRooms);
        this.roomEls[r.id] = rect;
        if (r.cat === 'restricted') S('rect', { x: r.x, y: r.y, width: r.w, height: r.h, fill: 'url(#hatch)', 'pointer-events': 'none' }, gRooms);
        // door gap
        S('line', { x1: r.door.x - 0.7, y1: r.door.y, x2: r.door.x + 0.7, y2: r.door.y, stroke: '#fff', 'stroke-width': 0.7 }, gDoors);
        // labels
        const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
        const text = r.short || r.name;
        const icon = r.icon || cat.icon;
        const gi = S('g', {}, this.gFix); S('text', { 'text-anchor': 'middle', 'font-size': 17, y: 0, 'pointer-events': 'none' }, gi).textContent = icon;
        this.fixed.push({ g: gi, x: cx, y: cy, dy: this.o.labels ? -4 : 6, kind: 'room-icon', availW: r.w, availH: r.h, needW: 30, needH: 44, layer: 'labels' });
        const gl = S('g', {}, this.gFix);
        const t = S('text', { 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 600, fill: '#3a4658', stroke: '#fff', 'stroke-width': 3, 'paint-order': 'stroke', 'pointer-events': 'none', y: 0 }, gl); t.textContent = text;
        this.fixed.push({ g: gl, x: cx, y: cy, dy: 16, kind: 'room-label', availW: r.w, availH: r.h, needW: text.length * 6.3 + 6, needH: 30, layer: 'labels' });
      });
      // POIs
      if (this.layers.pois) v.pois.filter(p => p.floor === f.id).forEach(p => {
        const k = IS.POI_KINDS[p.kind] || { icon: '📍' };
        const gp = S('g', { 'data-type': 'poi', 'data-id': p.id, style: 'cursor:pointer' }, this.gFix);
        S('circle', { r: 10, fill: '#fff', stroke: '#c3cbd8', 'stroke-width': 1 }, gp);
        S('text', { 'text-anchor': 'middle', 'font-size': 12, y: 4.5 }, gp).textContent = k.icon;
        this.fixed.push({ g: gp, x: p.x, y: p.y, kind: 'poi', availW: 99, availH: 99, needW: 0, needH: 0, minScale: 7 });
      });
      // walk network
      if (this.layers.walknet) {
        const nodes = {}; v.nodes.forEach(n => (nodes[n.id] = n));
        v.edges.forEach(e => {
          const a = nodes[e.a], b = nodes[e.b]; if (!a || !b) return;
          if (e.type === 'walk' && a.floor === f.id && b.floor === f.id) S('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: '#0f9d8a', 'stroke-width': 2.5, 'vector-effect': 'non-scaling-stroke', opacity: 0.9 }, gNet);
        });
        v.nodes.filter(n => n.floor === f.id).forEach(n => {
          const gg = S('g', { 'data-type': 'node', 'data-id': n.id, style: 'cursor:pointer' }, this.gFix);
          S('circle', { r: n.kind === 'room' ? 5 : 3.6, fill: n.kind === 'corridor' ? '#0f9d8a' : n.kind === 'door' ? '#e8890c' : '#7c4dff', stroke: '#fff', 'stroke-width': 1.2 }, gg);
          this.fixed.push({ g: gg, x: n.x, y: n.y, kind: 'node', availW: 99, availH: 99, needW: 0, needH: 0 });
        });
      }
      // wall ad slots
      if (this.layers.walls) v.walls.filter(w => w.floor === f.id).forEach(w => {
        S('line', { x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, stroke: '#e8890c', 'stroke-width': 6, 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke', 'data-type': 'wall', 'data-id': w.id, style: 'cursor:pointer' }, gWalls);
        const mx = (w.x1 + w.x2) / 2, my = (w.y1 + w.y2) / 2;
        const ga = S('g', {}, this.gFix);
        S('path', { d: 'M0,-26 L5,-14 L0,-17 L-5,-14 Z', fill: '#e8890c', transform: `rotate(${w.normal})` }, ga);
        this.fixed.push({ g: ga, x: mx, y: my, kind: 'wall-arrow', noRot: true, availW: 99, availH: 99, needW: 0, needH: 0 });
        const gl = S('g', { 'data-type': 'wall', 'data-id': w.id, style: 'cursor:pointer' }, this.gFix);
        const lb = S('g', {}, gl); S('rect', { x: -17, y: -9, width: 34, height: 18, rx: 6, fill: '#e8890c' }, lb);
        S('text', { 'text-anchor': 'middle', y: 4, 'font-size': 10, 'font-weight': 700, fill: '#fff' }, lb).textContent = w.id;
        const nx = Math.sin((w.normal * Math.PI) / 180), ny = -Math.cos((w.normal * Math.PI) / 180);
        this.fixed.push({ g: gl, x: mx + nx * 0, y: my + ny * 0, kind: 'wall-label', dy: 0, availW: 99, availH: 99, needW: 0, needH: 0 });
      });
      // markers
      if (this.layers.markers) v.markers.filter(m => m.floor === f.id).forEach(m => {
        const ga = S('g', {}, this.gFix);
        S('path', { d: 'M0,-24 L4.5,-14 L0,-16.5 L-4.5,-14 Z', fill: '#2f5bea', transform: `rotate(${m.normal})` }, ga);
        this.fixed.push({ g: ga, x: m.x, y: m.y, kind: 'marker-arrow', noRot: true, availW: 99, availH: 99, needW: 0, needH: 0 });
        const gm = S('g', { 'data-type': 'marker', 'data-id': m.id, style: 'cursor:pointer' }, this.gFix);
        S('rect', { x: -10, y: -10, width: 20, height: 20, rx: 4, fill: '#fff', stroke: '#2f5bea', 'stroke-width': 2 }, gm);
        [[-7, -7], [2, -7], [-7, 2]].forEach(p => S('rect', { x: p[0], y: p[1], width: 5, height: 5, fill: '#14213d' }, gm));
        S('rect', { x: 2.5, y: 2.5, width: 3.5, height: 3.5, fill: '#14213d' }, gm);
        const tl = S('text', { y: 23, 'text-anchor': 'middle', 'font-size': 10, 'font-weight': 700, fill: '#2f5bea', stroke: '#fff', 'stroke-width': 3, 'paint-order': 'stroke' }, gm); tl.textContent = m.id;
        this.fixed.push({ g: gm, x: m.x, y: m.y, kind: 'marker', availW: 99, availH: 99, needW: 0, needH: 0 });
      });
      // route + user live layers
      this.buildRoute(); this.buildUser();
      this.render();
    }

    drawUnderlay(g0, f) {
      const gg = S('g', { opacity: 0.55, transform: `rotate(-0.7 ${f.w / 2} ${f.h / 2})` }, g0);
      S('rect', { x: -3, y: -3, width: f.w + 6, height: f.h + 6, fill: '#fbf7ec', stroke: '#c8bda0', 'stroke-width': 0.4 }, gg);
      this.v.rooms.filter(r => r.floor === f.id).forEach((r, i) => {
        const j = ((i * 37) % 7) / 10 - 0.3;
        S('rect', { x: r.x + 0.5 + j, y: r.y + 0.4 - j, width: r.w - 0.3, height: r.h + 0.2, fill: 'none', stroke: '#6b6350', 'stroke-width': 0.18 }, gg);
      });
      S('text', { x: 2, y: -0.8, 'font-size': 1.6, fill: '#a0392b', 'font-weight': 700 }, gg).textContent = `FIRE EVACUATION PLAN — ${f.name.toUpperCase()} (photo underlay)`;
      S('circle', { cx: 3, cy: 17, r: 0.8, fill: '#d93a3a' }, gg);
      S('text', { x: 4.2, y: 17.5, 'font-size': 1.3, fill: '#d93a3a', 'font-weight': 700 }, gg).textContent = 'YOU ARE HERE';
    }

    buildRoute() {
      this.gRoute.innerHTML = '';
      this.fixed.filter(x => x.kind === 'pin' || x.kind === 'pill').forEach(x => x.g.remove());
      this.fixed = this.fixed.filter(x => x.kind !== 'pin' && x.kind !== 'pill');
      const r = this.route; if (!r) return;
      const done = IS.routeRuns(r, 0, this.progress), todo = IS.routeRuns(r, this.progress, r.total);
      const draw = (runs, cas, col, w, dash) => runs.filter(x => x.floor === this.floor).forEach(run => {
        const d = run.pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
        if (cas) S('path', { d, fill: 'none', stroke: cas, 'stroke-width': w + 4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' }, this.gRoute);
        S('path', { d, fill: 'none', stroke: col, 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke', 'stroke-dasharray': dash || 'none' }, this.gRoute);
      });
      draw(done, '#fff', '#b4bccb', 6);
      draw(todo, '#fff', '#2f5bea', 6);
      // vertical connector pills + destination pin
      r.hops.forEach((h, i) => {
        if (h.type === 'walk') return;
        const a = r.points[i], b = r.points[i + 1];
        [[a, b], [b, a]].forEach(([p, q]) => {
          if (p.floor !== this.floor) return;
          const fl = (this.v.floors.find(x => x.id === q.floor) || {}).name;
          const gp = S('g', {}, this.gFix);
          const label = `${h.type === 'lift' ? '🛗 Lift' : '🪜 Stairs'} ${q.floor > p.floor ? '↑' : '↓'} ${fl}`;
          S('rect', { x: -4, y: -13, width: label.length * 6.2 + 8, height: 24, rx: 12, fill: '#7c4dff' }, gp);
          S('text', { x: 4, y: 3.5, 'font-size': 11, 'font-weight': 700, fill: '#fff' }, gp).textContent = label;
          this.fixed.push({ g: gp, x: p.x, y: p.y - 0, kind: 'pill', availW: 99, availH: 99, needW: 0, needH: 0, dx: -12, dy: -20 });
        });
      });
      const end = r.points[r.points.length - 1];
      if (end.floor === this.floor) {
        const gp = S('g', {}, this.gFix);
        S('path', { d: 'M0,0 C-12,-14 -12,-28 0,-28 C12,-28 12,-14 0,0 Z', fill: '#e8453c', stroke: '#fff', 'stroke-width': 2, transform: 'translate(0,0)' }, gp);
        S('circle', { cx: 0, cy: -19, r: 4.5, fill: '#fff' }, gp);
        this.fixed.push({ g: gp, x: end.x, y: end.y, kind: 'pin', availW: 99, availH: 99, needW: 0, needH: 0 });
      }
    }

    buildUser() {
      this.gUserAcc.innerHTML = '';
      this.userAcc = S('circle', { r: 1, fill: 'rgba(47,91,234,.14)', stroke: 'rgba(47,91,234,.35)', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke', visibility: 'hidden' }, this.gUserAcc);
      const gc = S('g', {}, this.gFix);
      this.userCone = S('path', { d: 'M0,0 L-26,-46 A52,52 0 0 1 26,-46 Z', fill: 'url(#cone)', opacity: 0.85 }, gc);
      if (!this.svg.querySelector('#cone')) {
        const lg = S('linearGradient', { id: 'cone', x1: 0, y1: 1, x2: 0, y2: 0 }, this.defs);
        S('stop', { offset: '0%', 'stop-color': '#2f5bea', 'stop-opacity': 0.55 }, lg); S('stop', { offset: '100%', 'stop-color': '#2f5bea', 'stop-opacity': 0 }, lg);
      }
      this.userConeG = gc;
      const gd = S('g', {}, this.gFix);
      this.userDot = S('circle', { r: 8.5, fill: '#2f5bea', stroke: '#fff', 'stroke-width': 3 }, gd);
      this.userEntries = [{ g: gc, x: -999, y: -999, kind: 'user-cone', noRot: true, availW: 99, availH: 99, needW: 0, needH: 0 }, { g: gd, x: -999, y: -999, kind: 'user-dot', availW: 99, availH: 99, needW: 0, needH: 0 }];
      this.userEntries.forEach(e => { this.fixed.push(e); e.g.style.display = 'none'; });
      this.applyUser();
    }

    /* ----- dynamic state ----- */
    setRoute(route, progress) { this.route = route; this.progress = progress || 0; this.buildRoute(); this.render(); }
    setProgress(p) { this.progress = p; if (this.route) { this.buildRouteLines(); } }
    buildRouteLines() { // cheap refresh of route colouring only
      if (this._rl && Math.abs(this._rl - this.progress) < 0.4) return;
      this._rl = this.progress; this.buildRoute(); this.render();
    }
    setUser(u) {
      this.user = u;
      if (u && this.follow) {
        if (u.floor !== this.floor) { this.floor = u.floor; this.build(); }
        this.center.x += (u.x - this.center.x) * 0.25; this.center.y += (u.y - this.center.y) * 0.25;
        if (this.headingUp) this.rot += angDiff(this.rot, -u.heading) * 0.18;
      }
      this.applyUser(); this.render();
    }
    applyUser() {
      const u = this.user; if (!this.userEntries) return;
      const show = !!u && u.floor === this.floor;
      this.userEntries.forEach(e => { e.g.style.display = show ? '' : 'none'; if (show) { e.x = u.x; e.y = u.y; } });
      this.userAcc.setAttribute('visibility', show ? 'visible' : 'hidden');
      if (show) {
        this.userAcc.setAttribute('cx', u.x); this.userAcc.setAttribute('cy', u.y); this.userAcc.setAttribute('r', Math.max(0.6, u.acc || 1));
        const stale = !!u.stale; const col = stale ? '#8a94a6' : '#2f5bea';
        this.userDot.setAttribute('fill', col);
        this.userAcc.setAttribute('fill', stale ? 'rgba(138,148,166,.16)' : 'rgba(47,91,234,.14)');
        this.userConeG.firstChild.setAttribute('transform', `rotate(${u.heading}) scale(${stale ? 1.5 : 1}, 1)`);
        this.userConeG.firstChild.setAttribute('fill', stale ? '#8a94a6' : 'url(#cone)');
        this.userConeG.firstChild.setAttribute('opacity', stale ? 0.25 : 0.85);
      }
    }
    setFloor(id) { if (id === this.floor) return; this.floor = id; this.build(); this.applyUser(); }
    setLayer(name, on) { this.layers[name] = on; this.build(); }
    setSelected(id) {
      if (this.selected && this.roomEls[this.selected]) { const r = this.v.rooms.find(x => x.id === this.selected); const cat = IS.CATS[r.cat] || IS.CATS.workspace; this.roomEls[this.selected].setAttribute('stroke', cat.stroke); this.roomEls[this.selected].setAttribute('stroke-width', 1.3); }
      this.selected = id;
      if (id && this.roomEls[id]) { this.roomEls[id].setAttribute('stroke', '#2f5bea'); this.roomEls[id].setAttribute('stroke-width', 3.5); this.roomEls[id].parentNode.appendChild(this.roomEls[id]); }
    }
    setVenue(v) { this.v = v; this.build(); }

    /* ----- view ----- */
    fit(pad) {
      const f = this.floorObj; pad = pad == null ? 28 : pad;
      this.scale = clamp(Math.min((this.W - pad * 2) / f.w, (this.H - pad * 2) / f.h), this.o.minScale, this.o.maxScale);
      this.center = { x: f.w / 2, y: f.h / 2 }; this.rot = 0; this.anchorY = 0.5; this.follow = false; this.render();
    }
    zoomBy(k) { this.scale = clamp(this.scale * k, this.o.minScale, this.o.maxScale); this.render(); }
    centerOn(x, y, scale) { this.center = { x, y }; if (scale) this.scale = clamp(scale, this.o.minScale, this.o.maxScale); this.render(); }
    screenToWorld(px, py) {
      const a = (-this.rot * Math.PI) / 180, dx = px - this.W / 2, dy = py - this.H * this.anchorY;
      return { x: this.center.x + (dx * Math.cos(a) - dy * Math.sin(a)) / this.scale, y: this.center.y + (dx * Math.sin(a) + dy * Math.cos(a)) / this.scale };
    }
    render() {
      this.world.setAttribute('transform', `translate(${this.W / 2},${this.H * this.anchorY}) rotate(${this.rot}) scale(${this.scale}) translate(${-this.center.x},${-this.center.y})`);
      const s = this.scale, inv = 1 / s;
      for (const e of this.fixed) {
        let vis = true;
        if (e.layer === 'labels' && !this.layers.labels) vis = false;
        if (e.minScale && s < e.minScale) vis = false;
        if (e.needW && (e.availW * s < e.needW || (e.needH && e.availH * s < e.needH))) vis = false;
        if (e.kind === 'user-cone' || e.kind === 'user-dot') { if (e.g.style.display === 'none') continue; }
        e.g.style.visibility = vis ? 'visible' : 'hidden';
        if (!vis) continue;
        const dx = (e.dx || 0), dy = (e.dy || 0);
        e.g.setAttribute('transform', `translate(${e.x},${e.y}) scale(${inv}) ${e.noRot ? '' : `rotate(${-this.rot})`} translate(${dx},${dy})`);
      }
    }

    /* ----- input ----- */
    bind() {
      const el = this.svg; const ptrs = new Map(); let drag = null, pinch = null, captured = false, moved = 0;
      const pos = ev => { const r = this.c.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
      el.addEventListener('pointerdown', ev => {
        try { el.setPointerCapture(ev.pointerId); } catch (e) { /* synthetic events */ } const p = pos(ev); ptrs.set(ev.pointerId, p); moved = 0;
        if (ptrs.size === 1) {
          captured = !!(this.o.onPointer && this.o.onPointer('down', this.screenToWorld(p.x, p.y), ev));
          drag = { x: p.x, y: p.y, cx: this.center.x, cy: this.center.y, t: ev.target };
        } else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: this.scale }; captured = false; }
      });
      el.addEventListener('pointermove', ev => {
        if (!ptrs.has(ev.pointerId)) { if (this.o.onPointer) this.o.onPointer('hover', this.screenToWorld(pos(ev).x, pos(ev).y), ev); return; }
        const p = pos(ev); ptrs.set(ev.pointerId, p);
        if (ptrs.size === 2 && pinch) { const [a, b] = [...ptrs.values()]; this.scale = clamp((pinch.s * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.d, this.o.minScale, this.o.maxScale); this.follow = false; this.render(); return; }
        if (!drag) return;
        moved = Math.max(moved, Math.hypot(p.x - drag.x, p.y - drag.y));
        if (captured) { this.o.onPointer('move', this.screenToWorld(p.x, p.y), ev); return; }
        if (moved > 4) {
          const a = (-this.rot * Math.PI) / 180, dx = (drag.x - p.x) / this.scale, dy = (drag.y - p.y) / this.scale;
          this.center = { x: drag.cx + dx * Math.cos(a) - dy * Math.sin(a), y: drag.cy + dx * Math.sin(a) + dy * Math.cos(a) };
          if (this.follow) { this.follow = false; if (this.o.onUnfollow) this.o.onUnfollow(); }
          this.render();
        }
      });
      const up = ev => {
        const p = pos(ev); ptrs.delete(ev.pointerId); if (ptrs.size < 2) pinch = null;
        if (ptrs.size === 0 && drag) {
          if (captured) this.o.onPointer('up', this.screenToWorld(p.x, p.y), ev);
          else if (moved <= 4) {
            const t = drag.t && drag.t.closest && drag.t.closest('[data-id]');
            if (this.o.onSelect) this.o.onSelect(t && t.getAttribute('data-type') !== 'corridor' ? { type: t.getAttribute('data-type'), id: t.getAttribute('data-id') } : null, this.screenToWorld(p.x, p.y), ev);
          }
          drag = null; captured = false;
        }
      };
      el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
      el.addEventListener('wheel', ev => {
        ev.preventDefault(); const p = pos(ev); const before = this.screenToWorld(p.x, p.y);
        this.scale = clamp(this.scale * (ev.deltaY < 0 ? 1.12 : 1 / 1.12), this.o.minScale, this.o.maxScale);
        if (!this.follow) { const after = this.screenToWorld(p.x, p.y); this.center.x += before.x - after.x; this.center.y += before.y - after.y; }
        this.render();
      }, { passive: false });
    }
  }
  IS.MapView = MapView;
})(typeof window !== 'undefined' ? window : globalThis);
