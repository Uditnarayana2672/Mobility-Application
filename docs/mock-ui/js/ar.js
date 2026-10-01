/* Indore Spaces — simulated AR camera view.
   A tiny pinhole-camera renderer (canvas 2D) that draws the REAL venue geometry from the user's current pose:
   walls, doors with signs, floor chevrons along the route, a 3D turn arrow, destination pin and wall ads.
   In the real build this layer is replaced by three.js + WebXR over the live camera feed; the data it consumes is identical. */
(function (g) {
  const IS = (g.IS = g.IS || {});
  const rad = d => (d * Math.PI) / 180;
  const CAM_H = 1.45, WALL_H = 2.8, NEAR = 0.25;

  class ARView {
    constructor(canvas, venue) {
      this.cv = canvas; this.ctx = canvas.getContext('2d'); this.v = venue;
      this.tex = document.createElement('canvas'); this.tex.width = 320; this.tex.height = 180; this.tctx = this.tex.getContext('2d');
      this.hits = []; this.cache = {}; this.W = 300; this.H = 600; this.dpr = 1;
      if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
      this.resize();
    }
    setVenue(v) { this.v = v; this.cache = {}; }
    resize() {
      const r = this.cv.parentElement.getBoundingClientRect(); this.dpr = Math.min(2, window.devicePixelRatio || 1);
      this.W = Math.max(100, r.width); this.H = Math.max(100, r.height);
      this.cv.width = this.W * this.dpr; this.cv.height = this.H * this.dpr; this.cv.style.width = this.W + 'px'; this.cv.style.height = this.H + 'px';
    }
    wallsFor(floor) {
      if (this.cache[floor]) return this.cache[floor];
      const v = this.v, segs = [], doors = [];
      v.rooms.filter(r => r.floor === floor).forEach(r => {
        const edges = [[r.x, r.y, r.x + r.w, r.y], [r.x + r.w, r.y, r.x + r.w, r.y + r.h], [r.x + r.w, r.y + r.h, r.x, r.y + r.h], [r.x, r.y + r.h, r.x, r.y]];
        edges.forEach(e => {
          const horizontal = e[1] === e[3]; const onDoorEdge = horizontal && Math.abs(e[1] - r.door.y) < 0.01;
          const a0 = horizontal ? Math.min(e[0], e[2]) : Math.min(e[1], e[3]), a1 = horizontal ? Math.max(e[0], e[2]) : Math.max(e[1], e[3]);
          const cuts = onDoorEdge ? [[a0, r.door.x - 0.7], [r.door.x + 0.7, a1]] : [[a0, a1]];
          cuts.forEach(([s0, s1]) => {
            const n = Math.max(1, Math.ceil((s1 - s0) / 2));
            for (let i = 0; i < n; i++) {
              const p0 = s0 + ((s1 - s0) * i) / n, p1 = s0 + ((s1 - s0) * (i + 1)) / n;
              segs.push(horizontal ? { x1: p0, y1: e[1], x2: p1, y2: e[1], room: r } : { x1: e[0], y1: p0, x2: e[0], y2: p1, room: r });
            }
          });
        });
        doors.push({ room: r, x: r.door.x, y: r.door.y, horizontal: true });
      });
      // corridor end caps
      [0, 60].forEach(x => segs.push({ x1: x, y1: 15, x2: x, y2: 19, room: null, cap: true }));
      return (this.cache[floor] = { segs, doors });
    }

    /* camera */
    cam(pose) {
      const h = rad(pose.heading); this.c = { x: pose.x, y: pose.y, fx: Math.sin(h), fy: -Math.cos(h), rx: Math.cos(h), ry: Math.sin(h), th: rad(pose.pitch == null ? 6 : pose.pitch), z: CAM_H + (pose.bob || 0), F: Math.min(this.H * 0.55, this.W * 1.25) };
      this.c.ct = Math.cos(this.c.th); this.c.st = Math.sin(this.c.th);
    }
    toCam(x, y, z) {
      const c = this.c, dx = x - c.x, dy = y - c.y, zf = dx * c.fx + dy * c.fy, xr = dx * c.rx + dy * c.ry, zu = z - c.z;
      return { x: xr, y: zf * c.st + zu * c.ct, z: zf * c.ct - zu * c.st };
    }
    proj(p) { const F = this.c.F; return { x: this.W / 2 + (F * p.x) / p.z, y: this.H * 0.5 - (F * p.y) / p.z }; }
    clipPoly(pts) { // clip camera-space polygon against near plane
      const out = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length], ain = a.z >= NEAR, bin = b.z >= NEAR;
        if (ain) out.push(a);
        if (ain !== bin) { const t = (NEAR - a.z) / (b.z - a.z); out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: NEAR }); }
      }
      return out;
    }
    poly(world, fill, stroke, alpha) {
      const cp = this.clipPoly(world.map(p => this.toCam(p[0], p[1], p[2])));
      if (cp.length < 3) return null;
      const sp = cp.map(p => this.proj(p)), ctx = this.ctx;
      ctx.beginPath(); sp.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath();
      if (alpha != null) ctx.globalAlpha = alpha;
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
      ctx.globalAlpha = 1; return sp;
    }
    line(a, b, stroke, lw) {
      let p = this.toCam(a[0], a[1], a[2]), q = this.toCam(b[0], b[1], b[2]);
      if (p.z < NEAR && q.z < NEAR) return;
      if (p.z < NEAR) { const t = (NEAR - p.z) / (q.z - p.z); p = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, z: NEAR }; }
      if (q.z < NEAR) { const t = (NEAR - q.z) / (p.z - q.z); q = { x: q.x + (p.x - q.x) * t, y: q.y + (p.y - q.y) * t, z: NEAR }; }
      const A = this.proj(p), B = this.proj(q), ctx = this.ctx;
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke();
    }
    label(text, x, y, z, size, bg, fg) {
      const p = this.toCam(x, y, z); if (p.z < 0.6 || p.z > 40) return null;
      const s = this.proj(p), px = Math.max(9, Math.min(22, (size * this.c.F) / p.z)), ctx = this.ctx;
      if (s.x < -80 || s.x > this.W + 80) return null;
      ctx.font = `700 ${px}px 'Segoe UI',Roboto,'Noto Sans Telugu',sans-serif`; const tw = ctx.measureText(text).width + px * 1.1;
      ctx.fillStyle = bg || 'rgba(15,27,61,.82)'; const r = px * 0.55; ctx.beginPath(); ctx.roundRect(s.x - tw / 2, s.y - px * 0.95, tw, px * 1.7, r); ctx.fill();
      ctx.fillStyle = fg || '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, s.x, s.y - px * 0.1);
      return s;
    }

    /* ad texture (drawn each frame so videos animate) */
    drawAdTexture(camp, t) {
      const c = this.tctx, W = 320, H = 180, th = camp.theme || ['#4facfe', '#00c6a7'];
      const gr = c.createLinearGradient(0, 0, W, H); gr.addColorStop(0, th[0]); gr.addColorStop(1, th[1]); c.fillStyle = gr; c.fillRect(0, 0, W, H);
      if (camp.type === 'video') {
        for (let i = 0; i < 6; i++) { const a = t * 0.9 + i * 1.05; c.fillStyle = `rgba(255,255,255,${0.10 + 0.05 * Math.sin(a * 2)})`; c.beginPath(); c.arc(W * (0.15 + 0.7 * ((i * 0.37 + t * 0.06) % 1)), H * (0.5 + 0.35 * Math.sin(a)), 22 + 10 * Math.sin(a * 1.3), 0, 7); c.fill(); }
        c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(0, H - 14, W, 14); c.fillStyle = '#fff'; c.fillRect(0, H - 14, W * ((t * 0.12) % 1), 14);
        c.fillStyle = 'rgba(0,0,0,.5)'; c.beginPath(); c.roundRect(10, 10, 62, 22, 11); c.fill(); c.fillStyle = '#fff'; c.font = '700 12px sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText('▶ VIDEO', 20, 21);
      } else {
        c.fillStyle = 'rgba(255,255,255,.14)'; c.beginPath(); c.arc(W - 40, 40, 70, 0, 7); c.fill(); c.beginPath(); c.arc(30, H + 10, 80, 0, 7); c.fill();
      }
      c.fillStyle = '#fff'; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
      c.font = '700 13px sans-serif'; c.globalAlpha = 0.9; c.fillText(camp.brand.toUpperCase(), 16, camp.type === 'video' ? 62 : 38); c.globalAlpha = 1;
      c.font = '800 28px sans-serif'; const words = camp.headline.split(' '); let line = '', y = camp.type === 'video' ? 96 : 76;
      words.forEach(w => { const test = line + w + ' '; if (c.measureText(test).width > W - 36 && line) { c.fillText(line, 16, y); line = w + ' '; y += 32; } else line = test; });
      c.fillText(line, 16, y);
      c.font = '700 11px sans-serif'; c.globalAlpha = 0.85; c.fillText('SPONSORED · PLACEHOLDER BRAND', 16, H - (camp.type === 'video' ? 24 : 12)); c.globalAlpha = 1;
      return this.tex;
    }

    /* main frame.  s = { floor, x, y, heading, route, progress, step, campaigns, t, dim, onImpression } */
    draw(s) {
      const ctx = this.ctx, W = this.W, H = this.H; this.hits = [];
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.cam({ x: s.x, y: s.y, heading: s.heading, bob: Math.sin(s.t * 6.5) * 0.012 * (s.moving ? 1 : 0), pitch: 6 });
      const horizon = H * 0.5 - this.c.F * Math.tan(this.c.th);
      // ceiling & floor backdrop
      let gr = ctx.createLinearGradient(0, 0, 0, horizon); gr.addColorStop(0, '#2b323d'); gr.addColorStop(1, '#8b95a3'); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, Math.max(0, horizon));
      gr = ctx.createLinearGradient(0, horizon, 0, H); gr.addColorStop(0, '#9aa3ae'); gr.addColorStop(1, '#4b535e'); ctx.fillStyle = gr; ctx.fillRect(0, horizon, W, H - horizon);
      // floor tile lines
      const fl = this.v.floors.find(f => f.id === s.floor) || this.v.floors[0];
      for (let gx = 0; gx <= fl.w; gx += 2) this.line([gx, 0, 0], [gx, fl.h, 0], 'rgba(255,255,255,.10)', 1);
      for (let gy = 0; gy <= fl.h; gy += 2) this.line([0, gy, 0], [fl.w, gy, 0], 'rgba(255,255,255,.10)', 1);

      // route chevrons (on floor, under walls)
      const route = s.route; let turnArrow = null;
      if (route && !s.dim) {
        const here = s.progress;
        for (let d = 1.2, i = 0; d < 26 && here + d < route.total; d += 1.7, i++) {
          const pa = IS.pointAt(route, here + d);
          if (pa.floor !== s.floor || pa.vertical) break;
          const pb = IS.pointAt(route, here + d + 0.4); const b = rad(pa.bearing); const fx = Math.sin(b), fy = -Math.cos(b), rx = Math.cos(b), ry = Math.sin(b);
          const L = [[0.42, 0], [-0.2, 0.55], [-0.46, 0.55], [0.16, 0], [-0.46, -0.55], [-0.2, -0.55]].map(p => [pa.x + fx * p[0] + rx * p[1], pa.y + fy * p[0] + ry * p[1], 0.03]);
          const fade = Math.max(0, 1 - d / 26); const pulse = 0.55 + 0.45 * Math.sin(s.t * 4.5 - i * 0.7);
          this.poly(L, `rgba(34,211,238,${(0.35 + 0.55 * pulse) * (0.4 + 0.6 * fade)})`, 'rgba(255,255,255,.55)');
          if (pb.floor !== s.floor) break;
        }
        // turn arrow on the floor at the upcoming turn
        const nx = s.step;
        if (nx && nx.step.kind === 'turn' && nx.remaining < 16 && nx.remaining > 0.5) {
          const at = nx.step.sAt, p0 = IS.pointAt(route, at - 3), p1 = IS.pointAt(route, at), p2 = IS.pointAt(route, at + 3.2);
          if (p1.floor === s.floor && p2.floor === s.floor) turnArrow = { p0, p1, p2, step: nx };
        }
      }

      // sorted scene items: wall panels, doors, ads
      const { segs } = this.wallsFor(s.floor), items = [];
      const dd = (x, y) => Math.hypot(x - s.x, y - s.y);
      segs.forEach(sg => { const d = dd((sg.x1 + sg.x2) / 2, (sg.y1 + sg.y2) / 2); if (d < 34) items.push({ d, k: 'wall', sg }); });
      this.wallsFor(s.floor).doors.forEach(dr => { const d = dd(dr.x, dr.y); if (d < 34) items.push({ d: d - 0.05, k: 'door', dr }); });
      (s.campaigns || []).forEach(cp => {
        const w = this.v.walls.find(x => x.id === cp.wall); if (!w || w.floor !== s.floor) return;
        const mx = (w.x1 + w.x2) / 2, my = (w.y1 + w.y2) / 2, nrm = [Math.sin(rad(w.normal)), -Math.cos(rad(w.normal))];
        if ((s.x - mx) * nrm[0] + (s.y - my) * nrm[1] <= 0.2) return; // wall faces away
        const d = dd(mx, my); if (d < 40) items.push({ d: d - 0.2, k: 'ad', w, cp, mx, my, nrm });
      });
      items.sort((a, b) => b.d - a.d);
      const walkRooms = {};
      items.forEach(it => {
        if (it.k === 'wall') {
          const sg = it.sg, L = Math.max(34, 74 - it.d * 1.6); const cat = sg.room ? (IS.CATS[sg.room.cat] || {}) : {};
          const horiz = sg.y1 === sg.y2; const base = sg.cap ? `hsl(215 12% ${L - 8}%)` : `hsl(${horiz ? 38 : 42} ${horiz ? 14 : 12}% ${horiz ? L : L - 5}%)`;
          const sp = this.poly([[sg.x1, sg.y1, 0], [sg.x2, sg.y2, 0], [sg.x2, sg.y2, WALL_H], [sg.x1, sg.y1, WALL_H]], base, 'rgba(0,0,0,.10)');
          // skirting + accent band
          this.poly([[sg.x1, sg.y1, 0], [sg.x2, sg.y2, 0], [sg.x2, sg.y2, 0.12], [sg.x1, sg.y1, 0.12]], `hsl(30 8% ${L - 22}%)`);
          if (cat.stroke && !sg.cap) this.poly([[sg.x1, sg.y1, 1.0], [sg.x2, sg.y2, 1.0], [sg.x2, sg.y2, 1.06], [sg.x1, sg.y1, 1.06]], cat.stroke, null, 0.55);
        } else if (it.k === 'door') {
          const r = it.dr.room, dx = it.dr.x, dy = it.dr.y, L = Math.max(30, 58 - it.d * 1.2);
          const frame = r.cat === 'vertical' ? `hsl(265 30% ${L - 6}%)` : `hsl(28 40% ${L - 14}%)`;
          const inward = r.door.side === 'N' ? -1 : 1; // doorways are drawn open so you can see through them
          this.poly([[dx - 0.7, dy, 0], [dx - 0.62, dy, 0], [dx - 0.62, dy, 2.15], [dx - 0.7, dy, 2.15]], frame);
          this.poly([[dx + 0.62, dy, 0], [dx + 0.7, dy, 0], [dx + 0.7, dy, 2.15], [dx + 0.62, dy, 2.15]], frame);
          this.poly([[dx - 0.7, dy, 2.08], [dx + 0.7, dy, 2.08], [dx + 0.7, dy, 2.15], [dx - 0.7, dy, 2.15]], frame);
          this.poly([[dx - 0.7, dy, 2.15], [dx + 0.7, dy, 2.15], [dx + 0.7, dy, WALL_H], [dx - 0.7, dy, WALL_H]], `hsl(40 12% ${L + 10}%)`);
          const nm = r.short || r.name; const tint = (IS.CATS[r.cat] || {}).stroke || '#7aa2f0';
          if (it.d < 22) this.label(`${r.icon || (IS.CATS[r.cat] || {}).icon || ''} ${nm}`, dx, dy - inward * 0.0, 2.45, 0.2, tint + 'ee', '#fff');
        } else if (it.k === 'ad') {
          const { w, cp, mx, my, nrm } = it; const hw = Math.hypot(w.x2 - w.x1, w.y2 - w.y1) / 2;
          const rv = [nrm[1], -nrm[0]]; // right vector when facing the wall
          const o = 0.04, ox = nrm[0] * o, oy = nrm[1] * o;
          const TL = [mx - rv[0] * hw + ox, my - rv[1] * hw + oy, w.bottom + w.height], TR = [mx + rv[0] * hw + ox, my + rv[1] * hw + oy, w.bottom + w.height];
          const BL = [mx - rv[0] * hw + ox, my - rv[1] * hw + oy, w.bottom], BR = [mx + rv[0] * hw + ox, my + rv[1] * hw + oy, w.bottom];
          const c = [TL, TR, BR, BL].map(p => this.toCam(p[0], p[1], p[2]));
          if (c.some(p => p.z < 0.3)) return;
          const P = c.map(p => this.proj(p)); const tex = this.drawAdTexture(cp, s.t);
          ctx.save(); ctx.beginPath(); P.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.clip();
          ctx.setTransform(this.dpr * (P[1].x - P[0].x) / 320, this.dpr * (P[1].y - P[0].y) / 320, this.dpr * (P[3].x - P[0].x) / 180, this.dpr * (P[3].y - P[0].y) / 180, this.dpr * P[0].x, this.dpr * P[0].y);
          ctx.drawImage(tex, 0, 0); ctx.restore(); ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
          ctx.beginPath(); P.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2; ctx.stroke();
          this.hits.push({ id: cp.id, poly: P });
          const area = Math.abs((P[1].x - P[0].x) * (P[3].y - P[0].y));
          if (s.onAdSeen) s.onAdSeen(cp, it.d, area / (W * H));
          if (it.d < 12) this.label('Tap for offer', mx + ox, my + oy, w.bottom - 0.25, 0.17, 'rgba(255,255,255,.92)', '#14213d');
        }
      });

      // 3D turn arrow (hovering ribbon) + billboard
      if (turnArrow) this.drawTurnArrow(turnArrow, s);
      // vertical-circulation / destination billboards
      const nx = s.step;
      if (nx && (nx.step.kind === 'vertical' || nx.step.kind === 'arrive') && nx.remaining < 24 && route) {
        const at = nx.step.at; const txt = nx.step.kind === 'vertical' ? `${nx.step.via === 'lift' ? '🛗' : '🪜'} ${nx.step.via === 'lift' ? 'Lifts' : 'Stairs S1'} ahead` : `📍 ${nx.step.name}`;
        const tgt = nx.step.kind === 'vertical' ? { x: at.x, y: at.y > 17 ? 19 : 15 } : { x: route.points[route.points.length - 2].x, y: route.points[route.points.length - 2].y };
        this.pin(tgt.x, tgt.y, nx.step.kind === 'arrive' ? 2.9 : 3.3, txt, s.t);
      }
      // dim overlay (lift / stairs)
      if (s.dim) { ctx.fillStyle = 'rgba(8,12,24,.72)'; ctx.fillRect(0, 0, W, H); }
      // camera grain + vignette to feel like a live feed
      const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.35)'); ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    }

    pin(x, y, z, text, t) {
      const p = this.toCam(x, y, z + Math.sin(t * 3) * 0.08); if (p.z < 0.8) return;
      const s = this.proj(p), px = Math.max(11, Math.min(20, (0.2 * this.c.F) / p.z)), ctx = this.ctx;
      ctx.font = `800 ${px}px 'Segoe UI',Roboto,sans-serif`; const tw = ctx.measureText(text).width + px * 1.6;
      ctx.fillStyle = '#e8453c'; ctx.beginPath(); ctx.roundRect(s.x - tw / 2, s.y - px * 1.1, tw, px * 2.2, px * 1.1); ctx.fill();
      ctx.beginPath(); ctx.moveTo(s.x - px * 0.5, s.y + px * 1.05); ctx.lineTo(s.x, s.y + px * 1.9); ctx.lineTo(s.x + px * 0.5, s.y + px * 1.05); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, s.x, s.y);
    }

    drawTurnArrow(ta, s) {
      const { p0, p1, p2 } = ta; const pts = [p0, p1, p2];
      const left = [], right = [], w = 0.32;
      pts.forEach((p, i) => {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(2, i + 1)]; let dx = b.x - a.x, dy = b.y - a.y; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
        left.push([p.x - dy * w, p.y + dx * w, 0.06]); right.push([p.x + dy * w, p.y - dx * w, 0.06]);
      });
      // arrow head at the end
      let dx = p2.x - p1.x, dy = p2.y - p1.y; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
      const tip = [p2.x + dx * 1.3, p2.y + dy * 1.3, 0.06], hl = [p2.x - dy * 0.85, p2.y + dx * 0.85, 0.06], hr = [p2.x + dy * 0.85, p2.y - dx * 0.85, 0.06];
      const ribbon = [left[0], left[1], left[2], right[2], right[1], right[0]];
      const pulse = 0.75 + 0.25 * Math.sin(s.t * 6);
      this.poly(ribbon, `rgba(255,196,0,${pulse})`, 'rgba(255,255,255,.9)');
      this.poly([hl, tip, hr], `rgba(255,196,0,${pulse})`, 'rgba(255,255,255,.9)');
      const goLeft = ta.step.step.dir === 'left', lang = s.lang || 'en';
      const word = { en: goLeft ? 'Turn left' : 'Turn right', hi: goLeft ? 'Baayein mudiye' : 'Daayein mudiye', te: goLeft ? 'ఎడమవైపు' : 'కుడివైపు' }[lang];
      this.label(`${goLeft ? '↰' : '↱'} ${word} · ${Math.round(ta.step.remaining)} m`, p1.x, p1.y, 1.8, 0.2, 'rgba(255,196,0,.96)', '#2a2000');
    }

    hitTest(px, py) {
      for (let i = this.hits.length - 1; i >= 0; i--) {
        const P = this.hits[i].poly; let inside = false;
        for (let a = 0, b = P.length - 1; a < P.length; b = a++) { if ((P[a].y > py) !== (P[b].y > py) && px < ((P[b].x - P[a].x) * (py - P[a].y)) / (P[b].y - P[a].y) + P[a].x) inside = !inside; }
        if (inside) return this.hits[i].id;
      }
      return null;
    }
  }
  IS.ARView = ARView;
})(typeof window !== 'undefined' ? window : globalThis);
